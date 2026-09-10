import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import {
  WalletAutotradeConfig,
  SolanaNetwork,
  AutotradeMode,
  KillSwitchRule,
  WalletDiagnostics,
  SignalTradeTriggerRequest,
  SignalTradeResult,
  Position,
  LivePortfolioTelemetry,
  OneClickEnrollRequest,
  OneClickEnrollResult,
  OneClickExitRequest,
  OneClickExitResult,
} from '../types.ts';
import { GrokBotEngine } from './grokBotEngine.ts';
import { EngineCoordinator } from './engineCoordinator.ts';
import { ExitEngine } from './exitEngine.ts';
import { JupiterService, SOL_MINT, USDC_MINT } from './jupiterService.ts';
import {
  solToLamports,
  lamportsToSol,
  toTokenHumanAmount,
  toTokenBaseUnits,
  getOnChainTokenBalance,
  getOnChainTokenDecimals,
} from './decimalSafeUtils.ts';
import { TradeSafetyValidator } from './tradeSafetyValidator.ts';
import type { SignalExecutionGuard } from './entryExecutionGuard.ts';
import { estimateRoundTripCostPct } from './executionCost.ts';

const SOL_USD_ESTIMATE = 170.0;
const KEYPAIR_FILE_PATH = path.join(process.cwd(), '.secure_trading_keypair.json');

const DEFAULT_KILL_SWITCH_RULES: KillSwitchRule[] = [
  {
    id: 'RULE_DRAWDOWN',
    name: 'Rapid Portfolio Drawdown',
    enabled: true,
    triggerCondition: 'Hourly drawdown exceeds risk ceiling',
    thresholdValue: 15,
    unit: '%',
    description: 'Instantly flattens active trades if portfolio drops >15% within a 60-minute window to avoid cascading liquidations.',
  },
  {
    id: 'RULE_LOSS_STREAK',
    name: 'Consecutive Loss Circuit Breaker',
    enabled: true,
    triggerCondition: 'Consecutive stop-outs reach limit',
    thresholdValue: 3,
    unit: 'trades',
    description: 'Halts autonomous sniper if 3 back-to-back snipes get stopped out, indicating toxic adverse market conditions.',
  },
  {
    id: 'RULE_BALANCE_FLOOR',
    name: 'Minimum Gas Reserve Floor',
    enabled: true,
    triggerCondition: 'Wallet balance drops below floor',
    thresholdValue: 0.025,
    unit: 'SOL',
    description: 'Freezes all buying if SOL balance approaches reserve floor to guarantee rent and fee coverage.',
  },
  {
    id: 'RULE_RPC_LATENCY',
    name: 'Mempool / RPC Congestion Spike',
    enabled: true,
    triggerCondition: 'Network flight latency exceeds limit',
    thresholdValue: 1800,
    unit: 'ms',
    description: 'Stops automated execution if Solana network confirmation lag exceeds 1.8s to avoid stale slippage execution.',
  },
  {
    id: 'RULE_WHALE_DUMP',
    name: 'Instant Liquidity Rug Defense',
    enabled: true,
    triggerCondition: 'Pool LP or dev sell volume surge',
    thresholdValue: 35,
    unit: '% pool',
    description: 'Triggers emergency dump of a position if dev wallet or whale sells >35% of liquidity in a single transaction slot.',
  },
];

export class WalletManager {
  private static instance: WalletManager;

  // Dedicated Trading Keypair held strictly in the secure worker process
  private dedicatedKeypair: Keypair | null = null;
  private inFlightExits = new Set<string>();
  private buyInFlight = false;

  private config: WalletAutotradeConfig = {
    walletAddress: null,
    walletName: 'None',
    isConnected: false,
    network: 'mainnet-beta',
    rpcEndpoint: 'https://api.mainnet-beta.solana.com',
    balanceSol: 0,
    balanceUsd: 0,
    gasReserveSol: 0.025,
    allocatedCapitalSol: 0.08,
    allocatedCapitalUsd: 13.60,
    autotradeMode: 'OFF',

    // SL and Risk Defaults
    defaultStopLossPct: -12.0,
    trailingStopTriggerPct: 25.0,
    trailingStopDistancePct: 10.0,
    takeProfitTier1Pct: 45.0,
    takeProfitTier2Pct: 110.0,

    // Sizing Limits
    targetTradeSizeSol: 0.02,
    minTradeSizeSol: 0.01,
    maxTradeSizeSol: 0.50,
    maxOpenPositions: 6,
    maxDailyDrawdownPct: 15.0,
    maxDailyLossSol: 1.0,
    maxSlippagePct: 2.5,

    // Kill Switch
    killSwitchActive: false,
    killSwitchTriggeredReason: undefined,
    killSwitchTriggeredAt: undefined,
    killSwitchRules: DEFAULT_KILL_SWITCH_RULES,

    // Enabled Signal Sources
    enabledSignalSources: [
      'WHALE_BUYS',
      'PUMP_FUN_CURVE',
      'RAYDIUM_LP_BURN',
      'SMART_WALLETS',
      'SENTIMENT_SURGES',
    ],
    minSignalScore: 70,

    // Dedicated Keypair Metadata
    hasDedicatedKeypair: false,
    keypairSource: 'NONE',
    keypairPublicKey: null,

    // Preflight Status
    lastPreflightPassed: false,
    lastPreflightTimestamp: undefined,
  };

  private lastBalanceCheck: number = 0;

  private constructor() {
    this.initDedicatedKeypair();

    // Background balance refresh periodically if connected
    setInterval(() => {
      if (this.config.isConnected && this.config.walletAddress) {
        this.refreshBalance().catch(() => {});
      }
    }, 15000);
  }

  public static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  /**
   * Initializes the dedicated trading keypair from env or secure local storage
   */
  private initDedicatedKeypair(): void {
    try {
      // 1. Check environment variable
      const envKey = process.env.SOLANA_TRADING_PRIVATE_KEY;
      if (envKey) {
        let secretKey: Uint8Array;
        if (envKey.startsWith('[') && envKey.endsWith(']')) {
          secretKey = Uint8Array.from(JSON.parse(envKey));
        } else {
          secretKey = bs58.decode(envKey.trim());
        }
        this.dedicatedKeypair = Keypair.fromSecretKey(secretKey);
        const pubkeyStr = this.dedicatedKeypair.publicKey.toBase58();
        this.config.hasDedicatedKeypair = true;
        this.config.keypairSource = 'ENV';
        this.config.keypairPublicKey = pubkeyStr;
        this.config.walletAddress = pubkeyStr;
        this.config.walletName = 'Phantom (Dedicated Trading Sub-Account)';
        this.config.isConnected = true;
        console.log(`[WalletManager] Loaded dedicated keypair from ENV: ${pubkeyStr}`);
        return;
      }

      // 2. Check secure file
      if (fs.existsSync(KEYPAIR_FILE_PATH)) {
        const raw = fs.readFileSync(KEYPAIR_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.dedicatedKeypair = Keypair.fromSecretKey(Uint8Array.from(parsed));
          const pubkeyStr = this.dedicatedKeypair.publicKey.toBase58();
          this.config.hasDedicatedKeypair = true;
          this.config.keypairSource = 'SECURE_FILE';
          this.config.keypairPublicKey = pubkeyStr;
          this.config.walletAddress = pubkeyStr;
          this.config.walletName = 'Phantom (Dedicated Trading Sub-Account)';
          this.config.isConnected = true;
          console.log(`[WalletManager] Loaded dedicated keypair from secure file: ${pubkeyStr}`);
          return;
        }
      }
    } catch (err) {
      console.warn('[WalletManager] Notice during keypair initialization:', err);
    }
  }

  /**
   * Get public config (Private key is NEVER returned)
   */
  public getConfig(): WalletAutotradeConfig {
    return {
      ...this.config,
      hasDedicatedKeypair: Boolean(this.dedicatedKeypair),
      keypairPublicKey: this.dedicatedKeypair ? this.dedicatedKeypair.publicKey.toBase58() : null,
    };
  }

  /**
   * Returns dedicated keypair for backend worker execution only
   */
  public getDedicatedKeypair(): Keypair | null {
    return this.dedicatedKeypair;
  }

  /**
   * Setup Dedicated Trading Keypair (Server Worker Only)
   * - If privateKeyBase58 is provided, imports and securely stores it.
   * - If not provided, generates a brand new keypair and returns base58 one-time for Phantom import.
   */
  public async setupDedicatedKeypair(privateKeyBase58?: string): Promise<{
    success: boolean;
    address: string;
    privateKeyBase58?: string;
    isNew: boolean;
    error?: string;
  }> {
    try {
      let keypair: Keypair;
      let isNew = false;
      let oneTimeExportKey: string | undefined = undefined;

      if (privateKeyBase58 && privateKeyBase58.trim()) {
        const trimmed = privateKeyBase58.trim();
        let secretKey: Uint8Array;
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          secretKey = Uint8Array.from(JSON.parse(trimmed));
        } else {
          secretKey = bs58.decode(trimmed);
        }
        keypair = Keypair.fromSecretKey(secretKey);
      } else {
        keypair = Keypair.generate();
        isNew = true;
        oneTimeExportKey = bs58.encode(keypair.secretKey);
      }

      // Save secret key bytes securely to local server file
      fs.writeFileSync(KEYPAIR_FILE_PATH, JSON.stringify(Array.from(keypair.secretKey)), {
        mode: 0o600,
      });

      this.dedicatedKeypair = keypair;
      const pubkeyStr = keypair.publicKey.toBase58();

      this.config.walletAddress = pubkeyStr;
      this.config.walletName = 'Phantom (Dedicated Trading Sub-Account)';
      this.config.isConnected = true;
      this.config.hasDedicatedKeypair = true;
      this.config.keypairSource = 'SECURE_FILE';
      this.config.keypairPublicKey = pubkeyStr;

      await this.refreshBalance();

      return {
        success: true,
        address: pubkeyStr,
        privateKeyBase58: oneTimeExportKey,
        isNew,
      };
    } catch (err: any) {
      return {
        success: false,
        address: '',
        isNew: false,
        error: `Failed to configure dedicated keypair: ${err.message || err}`,
      };
    }
  }

  /**
   * Updates preflight diagnostic pass status
   */
  public updatePreflightStatus(passed: boolean, timestamp: number): void {
    this.config.lastPreflightPassed = passed;
    this.config.lastPreflightTimestamp = timestamp;
  }

  /**
   * Clears/resets the dedicated keypair from disk and worker memory
   */
  public resetDedicatedKeypair(): { success: boolean; config: WalletAutotradeConfig } {
    try {
      if (fs.existsSync(KEYPAIR_FILE_PATH)) {
        fs.unlinkSync(KEYPAIR_FILE_PATH);
      }
    } catch (err) {
      console.warn('[WalletManager] Failed to delete keypair file:', err);
    }
    this.dedicatedKeypair = null;
    this.config.hasDedicatedKeypair = false;
    this.config.keypairSource = 'NONE';
    this.config.keypairPublicKey = null;
    this.config.lastPreflightPassed = false;
    return {
      success: true,
      config: this.getConfig(),
    };
  }

  /**
   * Sets the dedicated keypair public key as the active trading wallet address
   */
  public async useDedicatedKeypairAsActiveAddress(): Promise<{ success: boolean; config: WalletAutotradeConfig; error?: string }> {
    if (!this.dedicatedKeypair) {
      return {
        success: false,
        config: this.getConfig(),
        error: 'No dedicated keypair loaded in worker. Generate or import a keypair first.',
      };
    }
    const pubkeyStr = this.dedicatedKeypair.publicKey.toBase58();
    this.config.walletAddress = pubkeyStr;
    this.config.walletName = 'Phantom (Dedicated Trading Sub-Account)';
    this.config.isConnected = true;
    this.config.hasDedicatedKeypair = true;
    this.config.keypairPublicKey = pubkeyStr;
    await this.refreshBalance();
    return {
      success: true,
      config: this.getConfig(),
    };
  }

  public async connectWallet(
    walletAddress: string,
    walletName: string = 'Solana Wallet',
    network: SolanaNetwork = 'mainnet-beta',
    rpcEndpoint?: string
  ): Promise<{ success: boolean; config: WalletAutotradeConfig; error?: string }> {
    try {
      const pubkey = new PublicKey(walletAddress);
      const cleanAddress = pubkey.toBase58();
      const chosenRpc = rpcEndpoint || (network === 'devnet' ? clusterApiUrl('devnet') : 'https://api.mainnet-beta.solana.com');

      this.config.walletAddress = cleanAddress;
      this.config.walletName = walletName;
      this.config.isConnected = true;
      this.config.network = network;
      this.config.rpcEndpoint = chosenRpc;

      // If address matches loaded keypair, update keypairPublicKey
      if (this.dedicatedKeypair && this.dedicatedKeypair.publicKey.toBase58() === cleanAddress) {
        this.config.hasDedicatedKeypair = true;
        this.config.keypairPublicKey = cleanAddress;
      }

      await this.refreshBalance();

      return {
        success: true,
        config: this.getConfig(),
      };
    } catch (err: any) {
      return {
        success: false,
        config: this.getConfig(),
        error: `Invalid Solana wallet address: ${err.message || err}`,
      };
    }
  }

  public disconnectWallet(): { success: boolean; config: WalletAutotradeConfig } {
    this.config.walletAddress = null;
    this.config.walletName = 'None';
    this.config.isConnected = false;
    this.config.balanceSol = 0;
    this.config.balanceUsd = 0;
    this.config.autotradeMode = 'OFF';
    this.config.lastPreflightPassed = false;
    return {
      success: true,
      config: this.getConfig(),
    };
  }

  public updateConfig(updates: Partial<WalletAutotradeConfig>): WalletAutotradeConfig {
    this.config = {
      ...this.config,
      ...updates,
      gasReserveSol: updates.gasReserveSol !== undefined ? Math.max(0.005, updates.gasReserveSol) : this.config.gasReserveSol,
      targetTradeSizeSol: updates.targetTradeSizeSol !== undefined ? Math.max(0.005, updates.targetTradeSizeSol) : this.config.targetTradeSizeSol,
      minTradeSizeSol: updates.minTradeSizeSol !== undefined ? Math.max(0.005, updates.minTradeSizeSol) : this.config.minTradeSizeSol,
      maxTradeSizeSol: updates.maxTradeSizeSol !== undefined ? Math.max(this.config.minTradeSizeSol, updates.maxTradeSizeSol) : this.config.maxTradeSizeSol,
      defaultStopLossPct: updates.defaultStopLossPct !== undefined ? -Math.abs(updates.defaultStopLossPct) : this.config.defaultStopLossPct,
      enabledSignalSources: Array.isArray(updates.enabledSignalSources)
        ? updates.enabledSignalSources
        : this.config.enabledSignalSources,
    };

    if (updates.allocatedCapitalSol !== undefined) {
      this.config.allocatedCapitalSol = Math.max(0, Number(updates.allocatedCapitalSol.toFixed(4)));
      this.config.allocatedCapitalUsd = Number((this.config.allocatedCapitalSol * SOL_USD_ESTIMATE).toFixed(2));
    }

    return this.getConfig();
  }

  public async refreshBalance(): Promise<{ balanceSol: number; balanceUsd: number }> {
    if (!this.config.walletAddress) {
      return { balanceSol: 0, balanceUsd: 0 };
    }

    try {
      const pubkey = new PublicKey(this.config.walletAddress);
      const connection = new Connection(this.config.rpcEndpoint, 'confirmed');
      const lamports = await connection.getBalance(pubkey, 'confirmed');
      const sol = lamports / LAMPORTS_PER_SOL;
      const usd = Number((sol * SOL_USD_ESTIMATE).toFixed(2));

      this.config.balanceSol = sol;
      this.config.balanceUsd = usd;
      this.lastBalanceCheck = Date.now();

      // Synchronize EngineCoordinator cash with on-chain balance
      try {
        const coord = EngineCoordinator.getInstance();
        coord.portfolio.cashSol = sol;
        coord.recalculatePortfolio();
      } catch {
        // Ignored
      }

      const maxAllocatable = Math.max(0, Number((sol - this.config.gasReserveSol).toFixed(4)));
      if (this.config.allocatedCapitalSol === 0 || this.config.allocatedCapitalSol > maxAllocatable) {
        this.config.allocatedCapitalSol = maxAllocatable;
        this.config.allocatedCapitalUsd = Number((maxAllocatable * SOL_USD_ESTIMATE).toFixed(2));
      }

      // Check balance floor kill switch
      const balanceRule = this.config.killSwitchRules.find((r) => r.id === 'RULE_BALANCE_FLOOR');
      if (balanceRule?.enabled && sol < balanceRule.thresholdValue && this.config.autotradeMode !== 'OFF') {
        void this.triggerKillSwitch(`Automated trigger: Balance ${sol} SOL fell below ${balanceRule.thresholdValue} SOL floor`).catch(() => {});
      }

      return { balanceSol: sol, balanceUsd: usd };
    } catch {
      this.lastBalanceCheck = 0;
      return { balanceSol: this.config.balanceSol, balanceUsd: this.config.balanceUsd };
    }
  }

  public async triggerKillSwitch(reason: string): Promise<{ success: boolean; config: WalletAutotradeConfig; closedCount: number; message: string }> {
    this.config.killSwitchActive = true;
    this.config.killSwitchTriggeredReason = reason;
    this.config.killSwitchTriggeredAt = Date.now();
    this.config.autotradeMode = 'OFF';
    const flattened = await this.flattenAllRealTrades();
    return { ...flattened, config: this.getConfig() };
  }

  public resetKillSwitch(): { success: boolean; config: WalletAutotradeConfig } {
    this.config.killSwitchActive = false;
    this.config.killSwitchTriggeredReason = undefined;
    this.config.killSwitchTriggeredAt = undefined;
    return { success: true, config: this.getConfig() };
  }

  public async flattenAllRealTrades(): Promise<{ success: boolean; closedCount: number; message: string }> {
    const positions = [...EngineCoordinator.getInstance().activePositions].filter(p => p.isRealWalletTrade);
    let closedCount = 0;
    const failures: string[] = [];
    for (const position of positions) {
      try {
        const result = await this.oneClickExit({ positionId: position.id, pctToExit: 100, reason: 'OPERATOR OR KILL SWITCH FLATTEN' });
        if (result.success && result.isFullyClosed) closedCount++;
        else failures.push(`${position.id}: ${result.error || 'not fully settled'}`);
      } catch (error: any) { failures.push(`${position.id}: ${error.message}`); }
    }
    return { success: failures.length === 0, closedCount,
      message: `Confirmed ${closedCount}/${positions.length} exits.${failures.length ? ` Retained unresolved positions: ${failures.join('; ')}` : ''}` };
  }

  public setMaxOpenPositions(limit: number): WalletAutotradeConfig {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid open position limit');
    this.config.maxOpenPositions = limit;
    return this.getConfig();
  }

  public getPendingExecutions() { return JupiterService.getPendingExecutions(); }

  private assertWalletProvenance(position?: Position): void {
    if (process.env.ENABLE_LIVE_TRADING !== 'true') throw new Error('ENABLE_LIVE_TRADING must explicitly equal true');
    if (!this.dedicatedKeypair || !this.config.isConnected || this.config.network !== 'mainnet-beta') throw new Error('Live mainnet signing wallet unavailable');
    const owner = this.dedicatedKeypair.publicKey.toBase58();
    if (this.config.walletAddress !== owner) throw new Error('Active wallet differs from dedicated signer');
    if (position && (!position.isRealWalletTrade || position.isSimulated || position.executionType !== 'LIVE_ON_CHAIN' ||
        position.walletAddress !== owner || position.status !== 'OPEN')) throw new Error('Paper, foreign-wallet or non-open position cannot be sold live');
  }

  private assertBuyAllowed(req: OneClickEnrollRequest): void {
    this.assertWalletProvenance();
    const c = this.config;
    const coordinator = EngineCoordinator.getInstance();
    if (coordinator.config.mode !== 'LIVE' || coordinator.riskLimits.circuitBreakerActive || c.killSwitchActive ||
        !['FULL_AUTONOMOUS', 'SEMI_AUTONOMOUS'].includes(c.autotradeMode) || !c.lastPreflightPassed) throw new Error('Live buy blocked by mode, preflight or circuit breaker');
    const values = [req.sizeSol, c.minTradeSizeSol, c.maxTradeSizeSol, c.gasReserveSol, c.allocatedCapitalSol,
      c.balanceSol, c.maxOpenPositions, c.maxSlippagePct, c.maxDailyLossSol, c.maxDailyDrawdownPct];
    if (values.some(v => !Number.isFinite(v) || v < 0) || req.sizeSol <= 0) throw new Error('Invalid buy size or risk configuration');
    const amount = lamportsToSol(solToLamports(req.sizeSol));
    if (amount < c.minTradeSizeSol || amount > c.maxTradeSizeSol) throw new Error('Trade size outside configured limits');
    const slippage = req.slippageBps ?? Math.floor(c.maxSlippagePct * 100);
    if (!Number.isInteger(slippage) || slippage < 0 || slippage > c.maxSlippagePct * 100 ||
        !Number.isFinite(coordinator.riskLimits.maxSlippagePercent) || coordinator.riskLimits.maxSlippagePercent <= 0 ||
        slippage > coordinator.riskLimits.maxSlippagePercent * 100) throw new Error('Invalid buy slippage');
    if (Date.now() - this.lastBalanceCheck > 15_000 || !this.lastBalanceCheck) throw new Error('Fresh on-chain balance required');
    if (amount + c.gasReserveSol + 0.003 > c.balanceSol) throw new Error('Insufficient cash after gas, fee and rent reserve');
    const open = coordinator.activePositions.filter(p => p.isRealWalletTrade && p.status === 'OPEN');
    const limits = coordinator.riskLimits;
    if (![limits.maxPositionPercent, limits.maxTokenExposurePercent, limits.maxOpenPositions, limits.maxTradeLossSol]
      .every(v => Number.isFinite(v) && v > 0) ||
        amount > coordinator.portfolio.equitySol * Math.min(limits.maxPositionPercent, limits.maxTokenExposurePercent) ||
        amount > limits.maxTradeLossSol || open.length >= limits.maxOpenPositions) throw new Error('System position, exposure or loss cap exceeded');
    if (open.length >= c.maxOpenPositions || open.some(p => p.tokenMint === req.tokenMint)) throw new Error('Open-position or duplicate-mint limit');
    if (open.reduce((n, p) => n + p.costBasisSol, 0) + amount > c.allocatedCapitalSol) throw new Error('Allocated capital cap exceeded');
    if (coordinator.portfolio.dailyRealizedPnlSol <= -c.maxDailyLossSol ||
        coordinator.portfolio.currentDrawdownPct >= c.maxDailyDrawdownPct ||
        coordinator.portfolio.consecutiveLosses >= coordinator.riskLimits.maxConsecutiveLosses) throw new Error('Wallet loss limit reached');
    if (JupiterService.hasPendingExecution(c.walletAddress!)) throw new Error('Pending wallet execution requires reconciliation before buying');
  }

  public async oneClickEnroll(req: OneClickEnrollRequest, signalGuard?: SignalExecutionGuard): Promise<OneClickEnrollResult> {
    const timestamp = Date.now();
    const failure = (error: string, txSignature?: string): OneClickEnrollResult => ({ success: false, tokenMint: req.tokenMint,
      symbol: req.symbol, sizeSol: req.sizeSol, timestamp, error, txSignature });
    if (this.buyInFlight) return failure('Another wallet buy is in progress');
    this.buyInFlight = true;
    try {
      const coordinator = EngineCoordinator.getInstance();
      if (!signalGuard && coordinator.candidateTokens?.some(c => c.metadata.mint === req.tokenMint)) {
        signalGuard = coordinator.createSignalGuard(req.tokenMint);
      }
      this.assertWalletProvenance();
      await this.refreshBalance();
      this.assertBuyAllowed(req);
      const signer = this.dedicatedKeypair!;
      const endpoint = this.config.rpcEndpoint;
      const connection = new Connection(endpoint, 'confirmed');
      const amount = solToLamports(req.sizeSol);
      const slippageBps = req.slippageBps ?? Math.floor(this.config.maxSlippagePct * 100);
      const quote = await JupiterService.fetchQuote({ inputMint: SOL_MINT, outputMint: req.tokenMint, amountLamports: amount, slippageBps });
      if (!quote.success || !quote.data) return failure(quote.error || 'Buy route unavailable');
      const valid = await TradeSafetyValidator.validateQuote(connection, { intended_action: 'BUY', intended_token_mint: req.tokenMint,
        intended_sol_lamports: amount, quote_response: quote.data, wallet_pubkey: signer.publicKey.toBase58(), max_slippage_bps: slippageBps });
      if (signalGuard) {
        const worstPrice = req.sizeSol / toTokenHumanAmount(quote.data.otherAmountThreshold, valid.token_decimals);
        if (!Number.isFinite(worstPrice) || worstPrice > signalGuard.maxEntryPriceSol) return failure('Execution price exceeds the no-chase entry ceiling');
        if (signalGuard.validateQuote) {
          const exit = await JupiterService.fetchQuote({ inputMint: req.tokenMint, outputMint: SOL_MINT,
            amountLamports: BigInt(quote.data.otherAmountThreshold), slippageBps });
          if (!exit.success || !exit.data) return failure('No executable exit quote for final entry size');
          await TradeSafetyValidator.validateQuote(connection, { intended_action: 'SELL', intended_token_mint: req.tokenMint,
            intended_token_base_units: BigInt(quote.data.otherAmountThreshold), quote_response: exit.data,
            wallet_pubkey: signer.publicKey.toBase58(), max_slippage_bps: slippageBps });
          const exitBuild = await JupiterService.buildSwapTransaction(exit.data, signer.publicKey.toBase58(), 150_000);
          if (!exitBuild.success || !exitBuild.versionedTx) return failure('Exit route cannot be built by the configured executor');
          await JupiterService.attestTransaction(connection, exitBuild.versionedTx, { action: 'SELL', tokenMint: req.tokenMint,
            walletAddress: signer.publicKey.toBase58(), inputBaseUnits: quote.data.otherAmountThreshold,
            minimumOutputBaseUnits: exit.data.otherAmountThreshold });
          signalGuard.validateQuote({ now: Date.now(), quoteFetchedAt: quote.data.fetchedAt,
            exitQuoteFetchedAt: exit.data.fetchedAt, worstEntryPriceSol: worstPrice,
            roundTripCostPct: estimateRoundTripCostPct(req.sizeSol, lamportsToSol(exit.data.otherAmountThreshold)) });
        }
      }
      const built = await JupiterService.buildSwapTransaction(quote.data, signer.publicKey.toBase58(), 150_000);
      if (!built.success || !built.versionedTx) return failure(built.error || 'Buy build failed');
      await this.refreshBalance();
      const finalGuard = () => {
        if (this.dedicatedKeypair !== signer || this.config.rpcEndpoint !== endpoint) throw new Error('Signing context changed');
        this.assertBuyAllowed(req);
        signalGuard?.validate();
      };
      finalGuard();
      const result = await JupiterService.signAndExecuteSwap(connection, built.versionedTx, signer, built.lastValidBlockHeight, {
        action: 'BUY', tokenMint: req.tokenMint, walletAddress: signer.publicKey.toBase58(), tokenDecimals: valid.token_decimals,
        inputBaseUnits: amount.toString(), minimumOutputBaseUnits: quote.data.otherAmountThreshold,
        quoteFetchedAt: quote.data.fetchedAt, finalGuard,
      });
      if (!result.success || result.status !== 'CONFIRMED' || !result.txSignature || !result.fill) return failure(result.error || 'Confirmed fill metadata required', result.txSignature);
      const tokens = toTokenHumanAmount(result.fill.tokenBaseUnits, result.fill.tokenDecimals);
      const actualCost = lamportsToSol(result.fill.solLamports);
      if (!Number.isFinite(tokens) || tokens <= 0 || !Number.isFinite(actualCost) || actualCost <= 0) return failure('Invalid confirmed fill; reconciliation required', result.txSignature);
      const price = actualCost / tokens;
      const ladder = ExitEngine.createLadder(price);
      const position: Position & { sizeBaseUnits: string; tokenDecimals: number; peakPriceSol: number } = {
        id: `POS_LIVE_${result.txSignature}`, tokenMint: req.tokenMint, symbol: req.symbol, name: req.name || req.symbol,
        entryPriceSol: price, entryPriceUsd: price * SOL_USD_ESTIMATE, currentPriceSol: price, currentPriceUsd: price * SOL_USD_ESTIMATE,
        peakPriceSol: price, peakPriceUsd: price * SOL_USD_ESTIMATE, lowestPriceUsd: price * SOL_USD_ESTIMATE,
        sizeTokens: tokens, sizeBaseUnits: result.fill.tokenBaseUnits, tokenDecimals: result.fill.tokenDecimals,
        costBasisSol: actualCost, currentValueSol: actualCost, unrealizedPnlSol: 0, unrealizedPnlPct: 0, realizedPnlSol: 0,
        enteredAt: timestamp, holdingSec: 0, stopLossPriceSol: price * (1 + this.config.defaultStopLossPct / 100),
        takeProfitLadder: [
          { targetPriceSol: price * (1 + this.config.takeProfitTier1Pct / 100), pctToSell: 50, filled: false },
          { targetPriceSol: price * (1 + this.config.takeProfitTier2Pct / 100), pctToSell: 50, filled: false },
        ], trailingStopPriceSol: ladder.trailingStopPriceSol, trailingActivated: false, status: 'OPEN',
        isRealWalletTrade: true, executionType: 'LIVE_ON_CHAIN', isSimulated: false, walletAddress: signer.publicKey.toBase58(),
        executionVenue: 'Jupiter DEX / Solana Mainnet', txSignature: result.txSignature, solscanUrl: result.explorerUrl,
        executionHistory: [{ action: 'BUY', priceSol: price, tokens, pnlSol: 0, timestamp, txSignature: result.txSignature }],
      };
      coordinator.activePositions.unshift(position);
      coordinator.portfolio.cashSol -= actualCost;
      this.config.balanceSol = Math.max(0, this.config.balanceSol - actualCost);
      coordinator.recalculatePortfolio();
      coordinator.persistSettlement(result.txSignature);
      JupiterService.acknowledgeSettlement(result.txSignature);
      return { success: true, txSignature: result.txSignature, explorerUrl: result.explorerUrl, positionId: position.id,
        tokenMint: req.tokenMint, symbol: req.symbol, sizeSol: actualCost, tokensReceived: tokens, priceSol: price, timestamp };
    } catch (error: any) { return failure(error.message); }
    finally { this.buyInFlight = false; }
  }

  public async oneClickExit(req: OneClickExitRequest & { tierIndex?: number }): Promise<OneClickExitResult> {
    const timestamp = Date.now();
    const coordinator = EngineCoordinator.getInstance();
    const position = coordinator.activePositions.find(p => p.id === req.positionId) as (Position & { sizeBaseUnits?: string; tokenDecimals?: number }) | undefined;
    const failure = (error: string, txSignature?: string): OneClickExitResult => ({ success: false, positionId: req.positionId,
      symbol: position?.symbol || 'UNKNOWN', isFullyClosed: false, timestamp, error, txSignature });
    if (!position) return failure('Position not found');
    if (this.inFlightExits.has(position.tokenMint)) return failure('Exit already in progress for this mint');
    this.inFlightExits.add(position.tokenMint);
    try {
      this.assertWalletProvenance(position);
      const pct = req.pctToExit ?? 100;
      if (!Number.isInteger(pct) || pct <= 0 || pct > 100) return failure('Invalid exit percentage');
      const slippage = req.slippageBps ?? Math.floor(this.config.maxSlippagePct * 100);
      if (!Number.isInteger(slippage) || slippage < 0 || slippage > this.config.maxSlippagePct * 100) return failure('Invalid exit slippage');
      if (!position.sizeBaseUnits || !/^[1-9][0-9]*$/.test(position.sizeBaseUnits) || !Number.isInteger(position.tokenDecimals)) {
        return failure('Exact position base units and verified decimals required; reconcile legacy position before selling');
      }
      if (!Number.isFinite(position.sizeTokens) || position.sizeTokens <= 0 || !Number.isFinite(position.costBasisSol) || position.costBasisSol < 0 ||
          !Number.isFinite(position.currentPriceSol) || position.currentPriceSol <= 0) return failure('Invalid position accounting');
      const originalUnits = BigInt(position.sizeBaseUnits);
      const originalBasis = position.costBasisSol;
      const units = originalUnits * BigInt(pct) / 100n;
      if (units <= 0n) return failure('Exit rounds to zero base units');
      if (req.tierIndex !== undefined && (!Number.isInteger(req.tierIndex) || !position.takeProfitLadder[req.tierIndex] || position.takeProfitLadder[req.tierIndex].filled)) return failure('Invalid or already-filled take-profit tier');
      const signer = this.dedicatedKeypair!;
      const endpoint = this.config.rpcEndpoint;
      const finalGuard = () => {
        this.assertWalletProvenance(position);
        if (this.dedicatedKeypair !== signer || this.config.rpcEndpoint !== endpoint ||
            !coordinator.activePositions.includes(position) || position.sizeBaseUnits !== originalUnits.toString() || position.costBasisSol !== originalBasis) throw new Error('Exit signing context changed');
      };
      const result = await JupiterService.executeRealSellSwap(new Connection(endpoint, 'confirmed'), signer,
        position.tokenMint, units, slippage, 100, finalGuard);
      if (!result.success || result.status !== 'CONFIRMED' || !result.txSignature || !result.fill) return failure(result.error || 'Confirmed fill metadata required', result.txSignature);
      const soldUnits = BigInt(result.fill.tokenBaseUnits);
      if (soldUnits <= 0n || soldUnits > originalUnits || result.fill.tokenDecimals !== position.tokenDecimals) return failure('Unverifiable filled position quantity; reconciliation required', result.txSignature);
      const tokensSold = toTokenHumanAmount(soldUnits, result.fill.tokenDecimals);
      const proceeds = lamportsToSol(result.fill.solLamports);
      if (!Number.isFinite(proceeds) || proceeds <= 0) return failure('Unverifiable proceeds; reconciliation required', result.txSignature);
      const basis = originalBasis * Number(soldUnits) / Number(originalUnits);
      const pnl = proceeds - basis;
      const remaining = originalUnits - soldUnits;
      const fullyClosed = remaining === 0n;
      position.sizeBaseUnits = remaining.toString();
      position.sizeTokens = toTokenHumanAmount(remaining, result.fill.tokenDecimals);
      position.costBasisSol = fullyClosed ? 0 : originalBasis - basis;
      position.currentValueSol = position.sizeTokens * position.currentPriceSol;
      position.unrealizedPnlSol = position.currentValueSol - position.costBasisSol;
      position.unrealizedPnlPct = position.costBasisSol > 0 ? position.unrealizedPnlSol / position.costBasisSol * 100 : 0;
      position.realizedPnlSol += pnl;
      position.executionHistory.push({ action: fullyClosed ? 'SELL' : 'SCALE_OUT', priceSol: proceeds / tokensSold,
        tokens: tokensSold, pnlSol: pnl, timestamp, txSignature: result.txSignature });
      if (req.tierIndex !== undefined && soldUnits === units) position.takeProfitLadder[req.tierIndex].filled = true;
      coordinator.portfolio.cashSol += proceeds;
      coordinator.portfolio.dailyRealizedPnlSol += pnl;
      coordinator.portfolio.totalRealizedPnlSol += pnl;
      this.config.balanceSol += proceeds;
      if (fullyClosed) {
        position.status = 'CLOSED'; position.closedAt = timestamp; position.exitReason = req.reason || '1_CLICK_MARKET_EXIT';
        position.exitTxSignature = result.txSignature; position.exitSolscanUrl = result.explorerUrl;
        coordinator.activePositions = coordinator.activePositions.filter(p => p !== position);
        coordinator.closedPositions.unshift(position);
        coordinator.portfolio.consecutiveLosses = position.realizedPnlSol < 0 ? coordinator.portfolio.consecutiveLosses + 1 : 0;
      }
      coordinator.recalculatePortfolio();
      coordinator.persistSettlement(result.txSignature);
      JupiterService.acknowledgeSettlement(result.txSignature);
      return { success: true, positionId: position.id, symbol: position.symbol, txSignature: result.txSignature, explorerUrl: result.explorerUrl,
        solReceived: proceeds, tokensSold, remainingTokens: position.sizeTokens, isFullyClosed: fullyClosed,
        message: 'Settled confirmed on-chain fill', timestamp };
    } catch (error: any) { return failure(error.message); }
    finally { this.inFlightExits.delete(position.tokenMint); }
  }

  public async executeTradeExit(
    positionId: string,
    action: 'FLATTEN_100' | 'SCALE_OUT_50' | 'BREAKEVEN_SL' | 'CUSTOM_SL_TP',
    params?: { customStopLossPct?: number; customTakeProfitPct?: number }
  ): Promise<{ success: boolean; message: string; position?: Position; txSignature?: string; explorerUrl?: string }> {
    if (action === 'FLATTEN_100') {
      const exitRes = await this.oneClickExit({ positionId, pctToExit: 100 });
      return {
        success: exitRes.success,
        message: exitRes.message || exitRes.error || 'Flatten failed',
        txSignature: exitRes.txSignature,
        explorerUrl: exitRes.explorerUrl,
      };
    }

    if (action === 'SCALE_OUT_50') {
      const exitRes = await this.oneClickExit({ positionId, pctToExit: 50 });
      return {
        success: exitRes.success,
        message: exitRes.message || exitRes.error || 'Scale out failed',
        txSignature: exitRes.txSignature,
        explorerUrl: exitRes.explorerUrl,
      };
    }

    const coordinator = EngineCoordinator.getInstance();
    const coordPos = coordinator.activePositions.find((p) => p.id === positionId);

    if (coordPos) {
      if (action === 'BREAKEVEN_SL') {
        coordPos.trailingStopPriceSol = coordPos.entryPriceSol;
        coordPos.trailingActivated = true;
        return {
          success: true,
          message: `Adjusted stop loss for $${coordPos.symbol} to entry price (${coordPos.entryPriceSol.toFixed(8)} SOL).`,
          position: coordPos,
        };
      }

      if (action === 'CUSTOM_SL_TP') {
        const slPct = params?.customStopLossPct ?? -10;
        const tpPct = params?.customTakeProfitPct;
        if (!Number.isFinite(slPct) || slPct <= -100 || slPct > 0 || (tpPct !== undefined && (!Number.isFinite(tpPct) || tpPct <= 0))) return { success: false, message: 'Invalid custom stop or take-profit percentage' };
        coordPos.stopLossPriceSol = coordPos.entryPriceSol * (1 + slPct / 100);
        if (tpPct !== undefined) coordPos.takeProfitLadder = [{ targetPriceSol: coordPos.entryPriceSol * (1 + tpPct / 100), pctToSell: 100, filled: false }];
        return {
          success: true,
          message: `Custom SL updated for $${coordPos.symbol} to ${slPct}%.`,
          position: coordPos,
        };
      }
    }

    return {
      success: false,
      message: `Active trade position ${positionId} not found.`,
    };
  }

  /**
   * Scans all SPL and Token-2022 on-chain token accounts owned by the trading wallet,
   * and executes a Jupiter sell swap for each non-zero token back into pure SOL.
   */
  public async reclaimAllTokenHoldingsToSol(): Promise<{
    success: boolean; swappedCount: number; totalSolReclaimed: number;
    results: { mint: string; amountUi: number; solReceived: number; txSignature?: string; error?: string }[];
  }> {
    // Untracked wallet balances are not positions. Never liquidate them as a shortcut.
    const positions = [...EngineCoordinator.getInstance().activePositions].filter(p => p.isRealWalletTrade);
    const results = [];
    for (const position of positions) {
      const amountUi = position.sizeTokens;
      const result = await this.oneClickExit({ positionId: position.id, pctToExit: 100, reason: 'RECLAIM_TRACKED_POSITION' });
      results.push({ mint: position.tokenMint, amountUi, solReceived: result.solReceived ?? 0,
        txSignature: result.txSignature, error: result.error });
    }
    return { success: results.every(r => !r.error), swappedCount: results.filter(r => r.solReceived > 0).length,
      totalSolReclaimed: results.reduce((n, r) => n + r.solReceived, 0), results };
  }

  public async runDiagnostics(): Promise<WalletDiagnostics & { pendingExecutions: ReturnType<typeof JupiterService.getPendingExecutions> }> {
    let rpcLatencyMs = 0;
    let rpcStatus: 'OPTIMAL' | 'DEGRADED' | 'DOWN' = 'OPTIMAL';
    let currentSlot = 0;
    let accountExists = false;
    let rentExempt = false;

    try {
      const connection = new Connection(this.config.rpcEndpoint, 'confirmed');
      const t0 = Date.now();
      currentSlot = await connection.getSlot('confirmed');
      rpcLatencyMs = Date.now() - t0;
      if (rpcLatencyMs > 1200) {
        rpcStatus = 'DEGRADED';
      }
    } catch {
      rpcLatencyMs = 0;
      rpcStatus = 'DOWN';
      currentSlot = 0;
    }

    await this.refreshBalance();
    const balanceSol = this.config.balanceSol;
    const balanceUsd = this.config.balanceUsd;
    const gasReserve = this.config.gasReserveSol;
    const tradeableSol = Math.max(0, Number((balanceSol - gasReserve).toFixed(4)));

    accountExists = Boolean(this.config.walletAddress && this.config.isConnected);
    rentExempt = balanceSol >= 0.002;

    const checks: { name: string; status: 'PASS' | 'WARN' | 'FAIL'; message: string }[] = [
      { name: 'Live transaction instruction attestation', status: 'FAIL', message: 'Live signing blocked until instruction-level intent verification and durable accounting reconciliation are implemented.' },
    ];

    if (rpcStatus === 'OPTIMAL') {
      checks.push({
        name: 'Solana RPC Node Latency',
        status: 'PASS',
        message: `Connected to ${this.config.network} (${rpcLatencyMs}ms latency). Current slot #${currentSlot.toLocaleString()}.`,
      });
    } else {
      checks.push({
        name: 'Solana RPC Node Latency',
        status: 'WARN',
        message: `Network latency is ${rpcLatencyMs}ms.`,
      });
    }

    if (this.config.walletAddress && this.config.isConnected) {
      checks.push({
        name: 'Dedicated Trading Wallet Registered',
        status: 'PASS',
        message: `Address: ${this.config.walletAddress} (Viewable in Phantom)`,
      });
    } else {
      checks.push({
        name: 'Dedicated Trading Wallet Registered',
        status: 'FAIL',
        message: 'No trading wallet registered. Setup dedicated keypair in Step 1.',
      });
    }

    if (balanceSol >= gasReserve + this.config.minTradeSizeSol) {
      checks.push({
        name: 'SOL Liquidity & Gas Reserve',
        status: 'PASS',
        message: `${balanceSol.toFixed(3)} SOL available. ${tradeableSol.toFixed(3)} SOL tradeable above ${gasReserve} SOL gas floor.`,
      });
    } else {
      checks.push({
        name: 'SOL Liquidity & Gas Reserve',
        status: 'FAIL',
        message: `Insufficient SOL (${balanceSol} SOL). Deposit min ${(gasReserve + this.config.minTradeSizeSol).toFixed(3)} SOL in Phantom.`,
      });
    }

    if (this.config.killSwitchActive) {
      checks.push({
        name: 'Circuit Breaker Status',
        status: 'FAIL',
        message: `Kill switch active: "${this.config.killSwitchTriggeredReason || 'Engaged'}".`,
      });
    } else {
      checks.push({
        name: 'Circuit Breaker Status',
        status: 'PASS',
        message: `Circuit breakers armed. Max slippage: ${this.config.maxSlippagePct}%.`,
      });
    }

    const passCount = checks.filter((c) => c.status === 'PASS').length;
    const warnCount = checks.filter((c) => c.status === 'WARN').length;
    const readinessScore = Math.round(passCount * 25 + warnCount * 10);
    const canAutotrade = false; // Instruction-level transaction attestation is not implemented.

    return {
      timestamp: Date.now(),
      pendingExecutions: this.getPendingExecutions(),
      rpcLatencyMs,
      rpcStatus,
      currentSlot,
      accountExists,
      rentExempt,
      balanceSol,
      balanceUsd,
      gasReserveSol: gasReserve,
      tradeableSol,
      readinessScore,
      canAutotrade,
      checks,
    };
  }

  public async requestDevnetAirdrop(): Promise<{ success: boolean; txSignature?: string; error?: string; newBalance?: number }> {
    if (this.config.network !== 'devnet') {
      return {
        success: false,
        error: 'Airdrops are only available on the Solana Devnet cluster. Switch to Devnet first.',
      };
    }
    if (!this.config.walletAddress) {
      return { success: false, error: 'No wallet connected to receive airdrop.' };
    }

    try {
      const pubkey = new PublicKey(this.config.walletAddress);
      const connection = new Connection(this.config.rpcEndpoint, 'confirmed');
      const sig = await connection.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      await this.refreshBalance();

      return {
        success: true,
        txSignature: sig,
        newBalance: this.config.balanceSol,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Devnet faucet error: ${err.message || err}`,
      };
    }
  }

  /**
   * Executes a real on-chain trade (LIVE) or simulated paper trade (PAPER).
   * ZERO silent fallbacks!
   */
  public async executeSignalTrade(request: SignalTradeTriggerRequest, signalGuard?: SignalExecutionGuard): Promise<SignalTradeResult> {
    let result: OneClickEnrollResult;
    const sizeSol = request.recommendedSizeSol ?? this.config.targetTradeSizeSol;
    try {
      if (this.buyInFlight) throw new Error('Another wallet buy is in progress');
      signalGuard ??= EngineCoordinator.getInstance().createSignalGuard(request.tokenMint);
      result = await this.oneClickEnroll({ tokenMint: request.tokenMint, symbol: request.symbol, name: request.name,
        sizeSol, slippageBps: Math.floor(Math.min(this.config.maxSlippagePct, EngineCoordinator.getInstance().riskLimits.maxSlippagePercent) * 100),
        priceSol: request.priceSol, priceUsd: request.priceUsd }, signalGuard);
    } catch (error) {
      result = { success: false, tokenMint: request.tokenMint, symbol: request.symbol, sizeSol, timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Signal authorization failed' };
    }
    return { ...result, priceSol: result.priceSol ?? 0, slippagePct: this.config.maxSlippagePct,
      priorityFeeSol: 0, mode: this.config.autotradeMode,
      executionType: result.success ? 'LIVE_ON_CHAIN' : undefined, isSimulated: false };
  }

  /**
   * Preflight Dry-run / Real Micro-Trade Test
   */
  public async executePreflightTestSwap(
    tokenMint: string = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    sizeSol?: number
  ): Promise<SignalTradeResult> {
    const symbol = tokenMint.startsWith('Dez') ? 'BONK' : 'TEST_ALPHA';
    const result = await this.oneClickEnroll({ tokenMint, symbol, name: 'Operator preflight test',
      sizeSol: sizeSol ?? this.config.minTradeSizeSol });
    return { ...result, priceSol: result.priceSol ?? 0, slippagePct: this.config.maxSlippagePct,
      priorityFeeSol: 0, mode: this.config.autotradeMode,
      executionType: result.success ? 'LIVE_ON_CHAIN' : undefined, isSimulated: false };
  }

  /**
   * Telemetry isolating live on-chain portfolio from paper simulation
   */
  public getLivePortfolioTelemetry(): LivePortfolioTelemetry {
    const coordinator = EngineCoordinator.getInstance();
    const livePositions = coordinator.activePositions.filter(
      (p) => p.isRealWalletTrade && p.status === 'OPEN'
    );
    const exposureSol = livePositions.reduce((sum, p) => sum + p.costBasisSol, 0);
    const unrealizedPnlSol = livePositions.reduce((sum, p) => sum + p.unrealizedPnlSol, 0);
    const dailyRealizedPnlSol = coordinator.portfolio.dailyRealizedPnlSol;

    return {
      onChainSolBalance: this.config.balanceSol,
      allocatedCapitalSol: this.config.allocatedCapitalSol,
      activeLiveExposureSol: Number(exposureSol.toFixed(4)),
      dailyRealizedPnlSol: Number(dailyRealizedPnlSol.toFixed(4)),
      totalRealizedPnlSol: Number(coordinator.portfolio.totalRealizedPnlSol.toFixed(4)),
      unrealizedPnlSol: Number(unrealizedPnlSol.toFixed(4)),
      openPositionsCount: livePositions.length,
      lastOnChainSync: this.lastBalanceCheck,
    };
  }
}
