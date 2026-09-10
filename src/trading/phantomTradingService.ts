import { randomUUID } from 'node:crypto';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { SystemMode, type Position, type WalletAutotradeConfig } from '../types.ts';
import type { EngineCoordinator } from './engineCoordinator.ts';
import type { SignalExecutionGuard } from './entryExecutionGuard.ts';
import { JupiterService, SOL_MINT, type ExecutionContext, type JupiterLiveExecutionResult } from './jupiterService.ts';
import { TradeSafetyValidator } from './tradeSafetyValidator.ts';
import { getOnChainTokenBalance, lamportsToSol, solToLamports, toTokenHumanAmount } from './decimalSafeUtils.ts';
import { estimateRoundTripCostPct } from './executionCost.ts';
import { ExitEngine } from './exitEngine.ts';
import { verifyPhantomSignature } from './phantomSignature.ts';

export const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export interface PhantomPrepareRequest {
  walletAddress: string; action: 'BUY' | 'SELL'; tokenMint?: string; symbol?: string; name?: string;
  sizeSol?: number; positionId?: string; pctToExit?: 100 | 50;
  requireEarlySignal?: boolean; manualRiskAcknowledged?: boolean;
}
type Wallet = { getConfig(): WalletAutotradeConfig; updateConfig(config: Partial<WalletAutotradeConfig>): WalletAutotradeConfig };
type Coordinator = Pick<EngineCoordinator, 'config' | 'riskLimits' | 'portfolio' | 'activePositions' | 'closedPositions' |
  'setMode' | 'createSignalGuard' | 'recalculatePortfolio' | 'persistSettlement' | 'hasSettledSignature'>;
export interface PhantomDependencies {
  wallet: Wallet; coordinator: Coordinator;
  connection?: (endpoint: string) => Connection;
  executor?: Pick<typeof JupiterService, 'fetchQuote' | 'buildSwapTransaction' | 'attestTransaction' |
    'executeExternallySignedSwap' | 'hasPendingExecution' | 'acknowledgeSettlement'>;
  now?: () => number;
  liveEnabled?: () => boolean;
}
interface Intent {
  id: string; request: PhantomPrepareRequest; owner: string; mint: string; endpoint: string;
  connection: Connection; message: Uint8Array; transaction: VersionedTransaction; height: number;
  input: string; decimals: number; quote: any; expiresAt: number; epoch: number;
  guard?: SignalExecutionGuard; position?: Position; originalUnits?: string; originalBasis?: number;
  balanceSol: number; balanceAt: number; slippageBps: number;
  status: 'PREPARED' | 'SUBMITTING';
}

export class PhantomTradingService {
  private intents = new Map<string, Intent>();
  private busyWallets = new Set<string>();
  private preparing = new Set<string>();
  private enabledOwner?: string;
  private epoch = 0;
  private readonly executor: NonNullable<PhantomDependencies['executor']>;
  private readonly now: () => number;
  private readonly liveEnabled: () => boolean;
  constructor(private readonly deps: PhantomDependencies) {
    this.executor = deps.executor ?? JupiterService;
    this.now = deps.now ?? Date.now;
    this.liveEnabled = deps.liveEnabled ?? (() => process.env.ENABLE_LIVE_TRADING === 'true');
  }

  invalidateConnection(): void {
    this.epoch++;
    this.enabledOwner = undefined;
    for (const [id, intent] of this.intents) if (intent.status === 'PREPARED') this.intents.delete(id);
  }

  enable(input: { walletAddress: string; confirmLiveDisclaimer: boolean }) {
    if (input.confirmLiveDisclaimer !== true) throw new Error('Explicit live-trading risk acknowledgement required');
    this.assertOwner(input.walletAddress);
    this.deps.wallet.updateConfig({ autotradeMode: 'OFF' });
    const result = this.deps.coordinator.setMode(SystemMode.LIVE);
    if (!result.success) throw new Error(result.message);
    this.invalidateConnection();
    this.enabledOwner = input.walletAddress;
    return { success: true, mode: SystemMode.LIVE, signingMethod: 'PHANTOM', autotradeMode: 'OFF',
      message: 'Manual Phantom approval enabled. Every trade requires a new wallet signature; automatic exits are unavailable.' };
  }

  private assertOwner(owner: string, endpoint?: string): WalletAutotradeConfig {
    if (!this.liveEnabled()) throw new Error('Phantom live trading is disabled. Set ENABLE_LIVE_TRADING=true locally on the server and restart; no environment setting was changed.');
    const config = this.deps.wallet.getConfig();
    if (typeof owner !== 'string' || new PublicKey(owner).toBase58() !== owner || !config.isConnected || config.walletAddress !== owner) {
      throw new Error('Connected wallet does not match the Phantom owner');
    }
    if (config.network !== 'mainnet-beta' || (endpoint !== undefined && config.rpcEndpoint !== endpoint)) throw new Error('Phantom requires the unchanged mainnet-beta connection');
    return config;
  }

  private cleanup(): void {
    for (const [id, intent] of this.intents) if (intent.status === 'PREPARED' && this.now() >= intent.expiresAt) this.intents.delete(id);
  }

  private assertCurrent(intent: Intent): void {
    const c = this.assertOwner(intent.owner, intent.endpoint);
    if (intent.epoch !== this.epoch || this.intents.get(intent.id) !== intent) throw new Error('Phantom approval cancelled or wallet connection changed');
    if (this.now() >= intent.expiresAt || this.now() < intent.quote.fetchedAt) throw new Error('Phantom approval or quote expired; prepare a new trade');
    if (this.executor.hasPendingExecution(intent.owner)) throw new Error('Pending wallet execution requires reconciliation; do not retry');
    if (![c.maxSlippagePct, this.deps.coordinator.riskLimits.maxSlippagePercent].every(v => Number.isFinite(v) && v >= 0) ||
        intent.slippageBps > c.maxSlippagePct * 100 || intent.slippageBps > this.deps.coordinator.riskLimits.maxSlippagePercent * 100) throw new Error('Slippage limit changed');
    if (this.now() - intent.balanceAt > 3000 || this.now() < intent.balanceAt) throw new Error('Fresh on-chain balance required');
    if (intent.request.action === 'BUY') {
      if (this.enabledOwner !== intent.owner || c.autotradeMode !== 'OFF') throw new Error('Explicit manual Phantom enable required; dedicated autotrade must be OFF');
      this.assertBuyRisk(intent);
      intent.guard?.validate();
    } else {
      if (![SystemMode.LIVE, SystemMode.EMERGENCY_STOP].includes(this.deps.coordinator.config.mode) && !c.killSwitchActive) {
        throw new Error('Live mode or a protective emergency exit is required');
      }
      const p = intent.position!;
      if (![p.sizeTokens, p.costBasisSol, p.currentPriceSol, p.realizedPnlSol].every(Number.isFinite) ||
          p.sizeTokens <= 0 || p.costBasisSol < 0 || p.currentPriceSol <= 0) throw new Error('Invalid tracked position accounting');
      if (!this.deps.coordinator.activePositions.includes(p) || !p.isRealWalletTrade || p.isSimulated || p.executionType !== 'LIVE_ON_CHAIN' ||
          p.walletAddress !== intent.owner || p.status !== 'OPEN' || p.tokenMint !== intent.mint ||
          p.sizeBaseUnits !== intent.originalUnits || p.costBasisSol !== intent.originalBasis || p.tokenDecimals !== intent.decimals) {
        throw new Error('Tracked position ownership or exact accounting changed');
      }
      if (intent.balanceSol < 0.003) throw new Error('Insufficient verified SOL for exit fees');
    }
  }

  private assertBuyRisk(intent: Intent): void {
    const c = this.deps.wallet.getConfig(), coordinator = this.deps.coordinator, r = coordinator.riskLimits;
    const p = coordinator.portfolio, amount = lamportsToSol(intent.input);
    if (coordinator.config.mode !== SystemMode.LIVE || r.circuitBreakerActive || c.killSwitchActive) throw new Error('Live buy blocked by mode or circuit breaker');
    const values = [c.minTradeSizeSol, c.maxTradeSizeSol, c.gasReserveSol, c.allocatedCapitalSol, c.maxOpenPositions,
      c.maxSlippagePct, c.maxDailyLossSol, c.maxDailyDrawdownPct, p.equitySol, p.dailyRealizedPnlSol,
      p.currentDrawdownPct, p.consecutiveLosses, r.maxPositionPercent, r.maxTokenExposurePercent, r.maxOpenPositions,
      r.maxTradeLossSol, r.maxDailyLossSol, r.maxConsecutiveLosses, r.maxSlippagePercent];
    if (values.some(v => !Number.isFinite(v)) || values.some((v, i) => i !== 9 && v < 0) ||
        ![r.maxPositionPercent, r.maxTokenExposurePercent, r.maxOpenPositions, r.maxTradeLossSol, r.maxDailyLossSol, r.maxConsecutiveLosses].every(v => v > 0) ||
        r.maxPositionPercent > 1 || r.maxTokenExposurePercent > 1) throw new Error('Invalid risk configuration');
    if (![c.defaultStopLossPct, c.takeProfitTier1Pct, c.takeProfitTier2Pct].every(Number.isFinite) ||
        c.defaultStopLossPct <= -100 || c.defaultStopLossPct >= 0 || c.takeProfitTier1Pct <= 0 || c.takeProfitTier2Pct <= 0) throw new Error('Invalid SOL stop or take-profit configuration');
    if (amount < c.minTradeSizeSol || amount > c.maxTradeSizeSol || amount <= 0) throw new Error('Trade size outside configured limits');
    if (amount + c.gasReserveSol + 0.003 > intent.balanceSol) throw new Error('Insufficient cash after gas, fee and rent reserve');
    const open = coordinator.activePositions.filter(position => position.isRealWalletTrade && position.status === 'OPEN');
    if (open.some(position => !Number.isFinite(position.costBasisSol) || position.costBasisSol < 0)) throw new Error('Invalid open-position accounting');
    if (open.length >= c.maxOpenPositions || open.length >= r.maxOpenPositions || open.some(position => position.tokenMint === intent.mint)) throw new Error('Open-position or duplicate-mint limit');
    if (open.reduce((sum, position) => sum + position.costBasisSol, 0) + amount > c.allocatedCapitalSol) throw new Error('Allocated capital cap exceeded');
    if (amount > p.equitySol * Math.min(r.maxPositionPercent, r.maxTokenExposurePercent) || amount > r.maxTradeLossSol) throw new Error('System position, exposure or loss cap exceeded');
    if (p.dailyRealizedPnlSol <= -Math.min(c.maxDailyLossSol, r.maxDailyLossSol) || p.currentDrawdownPct >= c.maxDailyDrawdownPct ||
        p.consecutiveLosses >= r.maxConsecutiveLosses) throw new Error('Wallet loss limit reached');
  }

  private async refresh(intent: Intent): Promise<void> {
    this.assertOwner(intent.owner, intent.endpoint);
    let balanceAt = this.now();
    const [genesis, lamports] = await Promise.all([intent.connection.getGenesisHash(),
      intent.connection.getBalance(new PublicKey(intent.owner), 'confirmed').then(value => { balanceAt = this.now(); return value; })]);
    if (genesis !== MAINNET_GENESIS_HASH) throw new Error('RPC is not Solana mainnet-beta');
    if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error('Unverifiable on-chain SOL balance');
    if (intent.request.action === 'SELL') {
      const balance = await getOnChainTokenBalance(intent.connection, new PublicKey(intent.owner), new PublicKey(intent.mint));
      if (balance.decimals !== intent.decimals || balance.total_base_units < BigInt(intent.input)) throw new Error('Tracked token units exceed verified wallet balance or decimals changed');
    }
    this.assertOwner(intent.owner, intent.endpoint);
    intent.balanceSol = lamportsToSol(lamports); intent.balanceAt = balanceAt;
    this.deps.wallet.updateConfig({ balanceSol: intent.balanceSol });
    this.deps.coordinator.portfolio.cashSol = intent.balanceSol;
    this.deps.coordinator.recalculatePortfolio();
  }

  private async validateQuote(intent: Intent) {
    const result = await TradeSafetyValidator.validateQuote(intent.connection, {
      intended_action: intent.request.action, intended_token_mint: intent.mint, wallet_pubkey: intent.owner,
      intended_sol_lamports: intent.request.action === 'BUY' ? BigInt(intent.input) : undefined,
      intended_token_base_units: intent.request.action === 'SELL' ? BigInt(intent.input) : undefined,
      quote_response: intent.quote, max_slippage_bps: intent.slippageBps,
    });
    if (intent.decimals !== -1 && result.token_decimals !== intent.decimals) throw new Error('Mint decimals changed');
    intent.decimals = result.token_decimals;
  }

  private context(intent: Intent): ExecutionContext {
    return { action: intent.request.action, tokenMint: intent.mint, walletAddress: intent.owner, tokenDecimals: intent.decimals,
      inputBaseUnits: intent.input, minimumOutputBaseUnits: intent.quote.otherAmountThreshold,
      quoteFetchedAt: intent.quote.fetchedAt, finalGuard: () => this.assertCurrent(intent),
      isSignatureSettled: signature => this.deps.coordinator.hasSettledSignature(signature) };
  }

  async prepare(request: PhantomPrepareRequest) {
    this.cleanup();
    if (!['BUY', 'SELL'].includes(request.action)) throw new Error('Invalid Phantom trade action');
    const c = this.assertOwner(request.walletAddress);
    if (this.executor.hasPendingExecution(request.walletAddress)) throw new Error('Pending wallet execution requires reconciliation; do not retry');
    if (this.preparing.has(request.walletAddress) || this.busyWallets.has(request.walletAddress)) throw new Error('Wallet trade already in progress');
    if (this.intents.size + this.preparing.size >= 128 || [...this.intents.values()].filter(i => i.owner === request.walletAddress).length >= 4) throw new Error('Too many prepared Phantom approvals; cancel unused approvals');
    if (request.action === 'BUY' && (this.enabledOwner !== request.walletAddress || this.deps.coordinator.config.mode !== SystemMode.LIVE)) throw new Error('Explicit manual Phantom live enable required');
    if (request.action === 'BUY' && request.requireEarlySignal !== true &&
        (request.requireEarlySignal !== false || request.manualRiskAcknowledged !== true)) throw new Error('Manual swaps require requireEarlySignal:false and manualRiskAcknowledged:true');
    const epoch = this.epoch;
    this.preparing.add(request.walletAddress);
    let intent: Intent | undefined;
    try {
      const position = request.action === 'SELL' ? this.deps.coordinator.activePositions.find(p => p.id === request.positionId) : undefined;
      if (request.action === 'SELL' && (!position || !position.sizeBaseUnits || !/^[1-9][0-9]*$/.test(position.sizeBaseUnits) ||
          !Number.isInteger(position.tokenDecimals) || ![50, 100].includes(request.pctToExit ?? 100))) throw new Error('SELL requires a tracked position with exact units/decimals and a 50 or 100 percent exit');
      const mint = request.action === 'SELL' ? position!.tokenMint : request.tokenMint;
      if (!mint || new PublicKey(mint).toBase58() !== mint || mint === SOL_MINT || (request.tokenMint && request.tokenMint !== mint)) throw new Error('Invalid or mismatched token mint');
      const input = request.action === 'BUY' ? solToLamports(request.sizeSol!) : BigInt(position!.sizeBaseUnits!) * BigInt(request.pctToExit ?? 100) / 100n;
      if (input <= 0n) throw new Error('Trade rounds to zero base units');
      const slippageBps = Math.floor(Math.min(c.maxSlippagePct, this.deps.coordinator.riskLimits.maxSlippagePercent) * 100);
      if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5000) throw new Error('Invalid slippage configuration');
      const guard = request.action === 'BUY' && request.requireEarlySignal === true ? this.deps.coordinator.createSignalGuard(mint) : undefined;
      const startedAt = this.now();
      const connection = (this.deps.connection ?? (endpoint => new Connection(endpoint, 'confirmed')))(c.rpcEndpoint);
      intent = { id: randomUUID(), request: { ...request }, owner: request.walletAddress, mint, endpoint: c.rpcEndpoint,
        connection, message: new Uint8Array(), transaction: undefined!, height: 0, input: input.toString(),
        decimals: position?.tokenDecimals ?? -1, quote: { fetchedAt: startedAt }, expiresAt: startedAt + (guard ? 3000 : 15000), epoch,
        guard, position, originalUnits: position?.sizeBaseUnits, originalBasis: position?.costBasisSol,
        balanceSol: 0, balanceAt: 0, slippageBps, status: 'PREPARED' };
      this.intents.set(intent.id, intent);
      await this.refresh(intent);
      // The signal guard requires the contemporaneous round trip, built below.
      if (request.action === 'BUY') this.assertBuyRisk(intent);
      else this.assertCurrent(intent);
      const quote = await this.executor.fetchQuote({ inputMint: request.action === 'BUY' ? SOL_MINT : mint,
        outputMint: request.action === 'BUY' ? mint : SOL_MINT, amountLamports: input, slippageBps });
      if (!quote.success || !quote.data || !Number.isFinite(quote.data.fetchedAt)) throw new Error(quote.error || 'Fresh executable quote unavailable');
      intent.quote = quote.data;
      intent.expiresAt = Math.min(intent.expiresAt, quote.data.fetchedAt + (guard ? 3000 : 15000));
      await this.validateQuote(intent);
      if (guard) {
        const worstPrice = lamportsToSol(input) / toTokenHumanAmount(quote.data.otherAmountThreshold, intent.decimals);
        if (!Number.isFinite(worstPrice) || worstPrice > guard.maxEntryPriceSol) throw new Error('Execution price exceeds the no-chase entry ceiling');
        if (!guard.validateQuote) throw new Error('Executable round-trip signal guard required');
        const exit = await this.executor.fetchQuote({ inputMint: mint, outputMint: SOL_MINT, amountLamports: quote.data.otherAmountThreshold, slippageBps });
        if (!exit.success || !exit.data || !Number.isFinite(exit.data.fetchedAt)) throw new Error('No contemporaneous executable exit quote');
        await TradeSafetyValidator.validateQuote(connection, { intended_action: 'SELL', intended_token_mint: mint,
          intended_token_base_units: BigInt(quote.data.otherAmountThreshold), quote_response: exit.data, wallet_pubkey: intent.owner, max_slippage_bps: slippageBps });
        const exitBuild = await this.executor.buildSwapTransaction(exit.data, intent.owner, 150000);
        if (!exitBuild.success || !exitBuild.versionedTx) throw new Error('Exit route cannot be built');
        await this.executor.attestTransaction(connection, exitBuild.versionedTx, { action: 'SELL', tokenMint: mint,
          walletAddress: intent.owner, inputBaseUnits: quote.data.otherAmountThreshold, minimumOutputBaseUnits: exit.data.otherAmountThreshold });
        guard.validateQuote({ now: this.now(), quoteFetchedAt: quote.data.fetchedAt, exitQuoteFetchedAt: exit.data.fetchedAt,
          worstEntryPriceSol: worstPrice, roundTripCostPct: estimateRoundTripCostPct(lamportsToSol(input), lamportsToSol(exit.data.otherAmountThreshold)) });
      }
      const built = await this.executor.buildSwapTransaction(quote.data, intent.owner, 150000);
      if (!built.success || !built.versionedTx || !Number.isSafeInteger(built.lastValidBlockHeight) || built.lastValidBlockHeight! <= 0) throw new Error(built.error || 'Unsigned swap build unavailable');
      intent.transaction = built.versionedTx; intent.height = built.lastValidBlockHeight!;
      if (built.versionedTx.signatures.some(signature => signature.some(byte => byte !== 0))) throw new Error('Swap builder returned a signed transaction');
      await this.executor.attestTransaction(connection, built.versionedTx, this.context(intent));
      TradeSafetyValidator.validateCompiledTransaction({ versioned_tx: built.versionedTx, wallet_pubkey: intent.owner, intended_action: request.action, intended_token_mint: mint });
      intent.message = Uint8Array.from(built.versionedTx.message.serialize());
      await this.refresh(intent);
      this.assertCurrent(intent);
      return { success: true, approvalId: intent.id, transactionBase64: Buffer.from(built.versionedTx.serialize()).toString('base64'),
        expiresAt: intent.expiresAt, action: request.action, tokenMint: mint, walletAddress: intent.owner, network: 'mainnet-beta',
        summary: request.action === 'SELL' ? `MANUAL EXIT: Sell ${request.pctToExit ?? 100}% of tracked ${position!.symbol} position only. Phantom approval required.` :
          guard ? `STRATEGY BUY: ${lamportsToSol(input)} SOL for ${request.symbol || mint}. Early-signal, no-chase and executable round-trip checks apply; Phantom approval required.` :
            `MANUAL SWAP: ${lamportsToSol(input)} SOL for ${request.symbol || mint}. Transaction/risk limits checked, but no calibrated early signal or full launch-safety approval. Automatic stop-loss exits are unavailable; every exit needs Phantom approval.` };
    } catch (error) {
      if (intent) this.intents.delete(intent.id);
      throw error;
    } finally { this.preparing.delete(request.walletAddress); }
  }

  cancel(approvalId: string) {
    const intent = this.intents.get(approvalId);
    if (intent?.status === 'SUBMITTING') throw new Error('Approval already submitted; pending execution cannot be cancelled');
    this.intents.delete(approvalId);
    return { success: true };
  }

  async submit(input: { approvalId: string; signedTransactionBase64: string }) {
    this.cleanup();
    const intent = this.intents.get(input.approvalId);
    if (!intent || intent.status !== 'PREPARED') return { success: false, error: 'Unknown, expired or already consumed Phantom approval', timestamp: this.now() };
    if (this.busyWallets.has(intent.owner)) return { success: false, error: 'Another wallet submission is in progress', timestamp: this.now() };
    let tx: VersionedTransaction;
    try {
      if (typeof input.signedTransactionBase64 !== 'string' || input.signedTransactionBase64.length > 2200 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(input.signedTransactionBase64)) throw new Error('Invalid signed Phantom transaction encoding');
      tx = VersionedTransaction.deserialize(Buffer.from(input.signedTransactionBase64, 'base64'));
      verifyPhantomSignature(tx, intent.owner, intent.message);
    } catch (error) {
      return this.failure(intent, error instanceof Error ? error.message : 'Invalid Phantom signature');
    }
    intent.status = 'SUBMITTING'; this.busyWallets.add(intent.owner);
    let result: JupiterLiveExecutionResult | undefined;
    try {
      await this.validateQuote(intent);
      await this.refresh(intent);
      this.assertCurrent(intent);
      result = await this.executor.executeExternallySignedSwap(intent.connection, tx, intent.height, this.context(intent), intent.message, async () => {
        await this.validateQuote(intent);
        await this.refresh(intent);
        this.assertCurrent(intent);
      });
      if (!result.success || result.status !== 'CONFIRMED' || !result.fill || !result.txSignature) {
        return this.failure(intent, result.error || 'Confirmed fill unavailable; reconciliation required', result);
      }
      return this.settle(intent, result);
    } catch (error) { return this.failure(intent, error instanceof Error ? error.message : 'Phantom submission failed', result); }
    finally { this.intents.delete(intent.id); this.busyWallets.delete(intent.owner); }
  }

  private failure(intent: Intent, error: string, result?: JupiterLiveExecutionResult) {
    return { success: false, error, txSignature: result?.txSignature, status: result?.status === 'FAILED' ? 'FAILED' : result?.txSignature ? 'UNKNOWN' : 'REJECTED',
      tokenMint: intent.mint, symbol: intent.request.symbol || intent.position?.symbol || intent.mint,
      positionId: intent.position?.id, sizeSol: intent.request.sizeSol, isFullyClosed: false, timestamp: this.now() };
  }

  private settle(intent: Intent, result: JupiterLiveExecutionResult) {
    const fill = result.fill!, signature = result.txSignature!, timestamp = this.now(), coordinator = this.deps.coordinator;
    if (coordinator.hasSettledSignature(signature)) throw new Error('Transaction signature already settled; duplicate accounting rejected');
    const units = BigInt(fill.tokenBaseUnits), sol = lamportsToSol(fill.solLamports), tokens = toTokenHumanAmount(units, fill.tokenDecimals);
    if (units <= 0n || !Number.isFinite(sol) || sol <= 0 || !Number.isFinite(tokens) || tokens <= 0 || fill.tokenDecimals !== intent.decimals ||
        (intent.request.action === 'SELL' && units !== BigInt(intent.input)) ||
        (intent.request.action === 'BUY' && units < BigInt(intent.quote.otherAmountThreshold))) throw new Error('Invalid confirmed fill; reconciliation required');
    let response: Record<string, unknown>;
    if (intent.request.action === 'BUY') {
      const price = sol / tokens, c = this.deps.wallet.getConfig(), ladder = ExitEngine.createLadder(price);
      const position: Position = {
        id: `POS_LIVE_${signature}`, tokenMint: intent.mint, symbol: intent.request.symbol || intent.mint, name: intent.request.name || intent.request.symbol || intent.mint,
        entryPriceSol: price, currentPriceSol: price, peakPriceSol: price,
        entryPriceUsd: 0, currentPriceUsd: 0, peakPriceUsd: 0, lowestPriceUsd: 0,
        sizeTokens: tokens, sizeBaseUnits: units.toString(), tokenDecimals: fill.tokenDecimals,
        costBasisSol: sol, currentValueSol: sol, unrealizedPnlSol: 0, unrealizedPnlPct: 0, realizedPnlSol: 0,
        enteredAt: timestamp, holdingSec: 0, stopLossPriceSol: price * (1 + c.defaultStopLossPct / 100),
        takeProfitLadder: [{ targetPriceSol: price * (1 + c.takeProfitTier1Pct / 100), pctToSell: 50, filled: false },
          { targetPriceSol: price * (1 + c.takeProfitTier2Pct / 100), pctToSell: 50, filled: false }],
        trailingStopPriceSol: ladder.trailingStopPriceSol, trailingActivated: false, status: 'OPEN',
        isRealWalletTrade: true, executionType: 'LIVE_ON_CHAIN', isSimulated: false, walletAddress: intent.owner,
        signingMethod: 'PHANTOM', exitApprovalRequired: true, exitApprovalReason: 'Every exit requires explicit Phantom approval; stops are recommendations, not automatic protection',
        executionVenue: 'Jupiter DEX / Solana Mainnet', txSignature: signature, solscanUrl: result.explorerUrl,
        executionHistory: [{ action: 'BUY', priceSol: price, tokens, pnlSol: 0, timestamp, txSignature: signature }],
      };
      coordinator.activePositions.unshift(position);
      coordinator.portfolio.cashSol = intent.balanceSol - sol;
      response = { positionId: position.id, tokenMint: intent.mint, symbol: position.symbol, sizeSol: sol, tokensReceived: tokens, priceSol: price };
    } else {
      const position = intent.position!, original = BigInt(intent.originalUnits!), remaining = original - units;
      if (remaining < 0n || position.sizeBaseUnits !== intent.originalUnits || position.costBasisSol !== intent.originalBasis) throw new Error('Settlement position changed; reconciliation required');
      const basis = intent.originalBasis! * Number(units) / Number(original), pnl = sol - basis;
      position.sizeBaseUnits = remaining.toString(); position.sizeTokens = toTokenHumanAmount(remaining, fill.tokenDecimals);
      position.costBasisSol = remaining === 0n ? 0 : intent.originalBasis! - basis;
      position.currentValueSol = position.sizeTokens * position.currentPriceSol;
      position.unrealizedPnlSol = position.currentValueSol - position.costBasisSol;
      position.unrealizedPnlPct = position.costBasisSol > 0 ? position.unrealizedPnlSol / position.costBasisSol * 100 : 0;
      position.realizedPnlSol += pnl;
      position.executionHistory.push({ action: remaining === 0n ? 'SELL' : 'SCALE_OUT', priceSol: sol / tokens, tokens, pnlSol: pnl, timestamp, txSignature: signature });
      coordinator.portfolio.cashSol = intent.balanceSol + sol;
      coordinator.portfolio.dailyRealizedPnlSol += pnl; coordinator.portfolio.totalRealizedPnlSol += pnl;
      if (remaining === 0n) {
        position.status = 'CLOSED'; position.closedAt = timestamp; position.exitReason = 'PHANTOM_APPROVED_EXIT';
        position.exitTxSignature = signature; position.exitSolscanUrl = result.explorerUrl;
        position.exitApprovalRequired = false; position.exitApprovalReason = undefined;
        coordinator.activePositions = coordinator.activePositions.filter(p => p !== position); coordinator.closedPositions.unshift(position);
        coordinator.portfolio.consecutiveLosses = position.realizedPnlSol < 0 ? coordinator.portfolio.consecutiveLosses + 1 : 0;
      }
      response = { positionId: position.id, symbol: position.symbol, solReceived: sol, tokensSold: tokens,
        remainingTokens: position.sizeTokens, isFullyClosed: remaining === 0n };
    }
    // Do not overwrite a newly connected owner's balance while confirmation was in flight.
    if (this.deps.wallet.getConfig().walletAddress === intent.owner) this.deps.wallet.updateConfig({ balanceSol: coordinator.portfolio.cashSol });
    coordinator.recalculatePortfolio();
    coordinator.persistSettlement(signature);
    this.executor.acknowledgeSettlement(signature);
    return { success: true, ...response, txSignature: signature, explorerUrl: result.explorerUrl,
      message: 'Settled confirmed on-chain fill; native cash deltas include fees and rent', timestamp };
  }
}
