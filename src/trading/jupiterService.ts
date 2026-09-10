import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';
import path from 'node:path';
import { lamportsToSol, toTokenHumanAmount, getOnChainTokenBalance } from './decimalSafeUtils.ts';
import { attestSwap } from './swapAttestation.ts';
import { TradeSafetyValidator } from './tradeSafetyValidator.ts';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amountLamports: number | bigint | string;
  slippageBps?: number;
}
export interface JupiterQuoteResult {
  success: boolean;
  data?: any;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: number;
  routePlanSummary?: string;
  error?: string;
}
export interface JupiterSwapBuildResult {
  success: boolean;
  swapTransactionBase64?: string;
  versionedTx?: VersionedTransaction;
  lastValidBlockHeight?: number;
  error?: string;
}
export interface JupiterSimulationResult {
  success: boolean;
  unitsConsumed?: number;
  logs?: string[];
  err?: any;
  error?: string;
}
export interface ConfirmedFill {
  tokenBaseUnits: string;
  tokenDecimals: number;
  solLamports: string;
  feeLamports: number;
}
export interface JupiterLiveExecutionResult {
  success: boolean;
  status?: 'REJECTED' | 'FAILED' | 'UNKNOWN' | 'CONFIRMED';
  txSignature?: string;
  explorerUrl?: string;
  fill?: ConfirmedFill;
  inAmountSol?: number;
  outAmountSol?: number;
  solReceived?: number;
  outAmountTokens?: number;
  tokensSold?: number;
  error?: string;
}
export interface ExecutionContext {
  action: 'BUY' | 'SELL';
  tokenMint: string;
  walletAddress: string;
  tokenDecimals: number;
  inputBaseUnits: string;
  minimumOutputBaseUnits: string;
  quoteFetchedAt: number;
  // Called immediately before signing, after every asynchronous guard has finished.
  finalGuard: () => void;
}
export interface PendingExecution {
  signature: string;
  walletAddress: string;
  tokenMint: string;
  action: 'BUY' | 'SELL';
  blockhash: string;
  lastValidBlockHeight: number;
  status: 'UNKNOWN' | 'CONFIRMED';
  submittedAt: number;
  error?: string;
}

export class JupiterService {
  public static attestTransaction = attestSwap;
  private static JUPITER_QUOTE_API = 'https://api.jup.ag/swap/v1/quote';
  private static JUPITER_SWAP_API = 'https://api.jup.ag/swap/v1/swap';
  private static pending: Map<string, PendingExecution> | null = null;
  private static journalPath = path.join(process.cwd(), '.execution-pending.json');

  private static loadPending(): Map<string, PendingExecution> {
    if (!this.pending) {
      const rows = fs.existsSync(this.journalPath) ? JSON.parse(fs.readFileSync(this.journalPath, 'utf8')) : [];
      if (!Array.isArray(rows) || rows.some(r => !r.signature || !r.tokenMint || !r.walletAddress)) {
        throw new Error('Pending execution journal is invalid; live execution blocked');
      }
      this.pending = new Map(rows.map(r => [r.signature, r]));
    }
    return this.pending;
  }
  private static persistPending(): void {
    const tmp = `${this.journalPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.loadPending().values()]), { mode: 0o600 });
    const fd = fs.openSync(tmp, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.journalPath);
    const dir = fs.openSync(path.dirname(this.journalPath), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
  public static getPendingExecutions(): PendingExecution[] {
    return [...this.loadPending().values()].map(p => ({ ...p }));
  }
  public static hasPendingExecution(wallet: string, mint?: string): boolean {
    return this.getPendingExecutions().some(p => p.walletAddress === wallet && (!mint || p.tokenMint === mint));
  }
  public static acknowledgeSettlement(signature: string): void {
    const pending = this.loadPending().get(signature);
    if (!pending) return;
    if (pending.status !== 'CONFIRMED') throw new Error('Unconfirmed execution cannot be cleared');
    this.loadPending().delete(signature);
    this.persistPending();
  }
  // UNKNOWN signatures remain blocked until transaction-specific accounting is reconciled.

  public static async fetchQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult> {
    try {
      const { inputMint, outputMint, amountLamports, slippageBps = 150 } = params;
      if (!/^[1-9][0-9]*$/.test(String(amountLamports)) ||
          (typeof amountLamports === 'number' && !Number.isSafeInteger(amountLamports)) ||
          !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5000) {
        throw new Error('Invalid exact input amount or slippage');
      }
      const url = new URL(this.JUPITER_QUOTE_API);
      url.searchParams.set('inputMint', inputMint);
      url.searchParams.set('outputMint', outputMint);
      url.searchParams.set('amount', String(amountLamports));
      url.searchParams.set('slippageBps', String(slippageBps));
      url.searchParams.set('restrictIntermediateTokens', 'true');
      url.searchParams.set('onlyDirectRoutes', 'true');
      const response = await fetch(url, { headers: { Accept: 'application/json',
        ...(process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {}) }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Jupiter quote HTTP ${response.status}`);
      const data = await response.json();
      if (!data?.outAmount || !Array.isArray(data.routePlan)) throw new Error('Malformed quote');
      Object.defineProperty(data, 'fetchedAt', { value: Date.now(), enumerable: false });
      return { success: true, data, inAmount: data.inAmount, outAmount: data.outAmount,
        priceImpactPct: Number(data.priceImpactPct),
        routePlanSummary: data.routePlan.map((r: any) => r.swapInfo?.label || 'DEX').join(' -> ') };
    } catch (err: any) { return { success: false, error: err.message }; }
  }

  public static async buildSwapTransaction(quoteResponse: any, userPublicKey: string, priorityFeeLamports = 100_000): Promise<JupiterSwapBuildResult> {
    try {
      const response = await fetch(this.JUPITER_SWAP_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json',
          ...(process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {}) },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true, useSharedAccounts: false,
          dynamicComputeUnitLimit: true, prioritizationFeeLamports: priorityFeeLamports }),
      });
      if (!response.ok) throw new Error(`Jupiter swap HTTP ${response.status}`);
      const data = await response.json();
      if (!data.swapTransaction || !Number.isSafeInteger(data.lastValidBlockHeight) || data.lastValidBlockHeight <= 0) {
        throw new Error('Swap payload missing transaction or original validity window');
      }
      return { success: true, swapTransactionBase64: data.swapTransaction,
        versionedTx: VersionedTransaction.deserialize(Buffer.from(data.swapTransaction, 'base64')),
        lastValidBlockHeight: data.lastValidBlockHeight };
    } catch (err: any) { return { success: false, error: err.message }; }
  }

  public static async simulateSwap(connection: Connection, versionedTx: VersionedTransaction): Promise<JupiterSimulationResult> {
    try {
      const sim = await connection.simulateTransaction(versionedTx, { sigVerify: false, replaceRecentBlockhash: true });
      return { success: !sim.value.err, err: sim.value.err, logs: sim.value.logs || [],
        unitsConsumed: sim.value.unitsConsumed, error: sim.value.err ? JSON.stringify(sim.value.err) : undefined };
    } catch (err: any) { return { success: false, error: err.message }; }
  }

  public static readConfirmedFill(transaction: any, context: ExecutionContext): ConfirmedFill {
    const meta = transaction?.meta;
    if (!meta || meta.err || !Array.isArray(meta.preTokenBalances) || !Array.isArray(meta.postTokenBalances)) {
      throw new Error('Confirmed transaction fill metadata unavailable');
    }
    const staticKeys = transaction.transaction.message.staticAccountKeys ?? transaction.transaction.message.accountKeys;
    const keys = [...staticKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
    const index = keys.findIndex((k: any) => (k.pubkey ?? k).toString() === context.walletAddress);
    if (index !== 0 || !Number.isSafeInteger(meta.preBalances[index]) || !Number.isSafeInteger(meta.postBalances[index]) ||
        !Number.isSafeInteger(meta.fee) || meta.fee < 0) throw new Error('Unverifiable native balance delta');
    const sum = (rows: any[]): bigint => rows.reduce<bigint>((n: bigint, row: any) => {
      if (row.mint !== context.tokenMint || row.owner !== context.walletAddress) return n;
      if (row.uiTokenAmount.decimals !== context.tokenDecimals || !/^[0-9]+$/.test(row.uiTokenAmount.amount)) {
        throw new Error('Unverifiable token balance delta');
      }
      return n + BigInt(row.uiTokenAmount.amount);
    }, 0n);
    const tokenDelta = sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
    const nativeDelta = BigInt(meta.postBalances[index]) - BigInt(meta.preBalances[index]);
    const tokens = context.action === 'BUY' ? tokenDelta : -tokenDelta;
    // Native cash delta includes network fees and account rent, never quoted proceeds.
    const sol = context.action === 'BUY' ? -nativeDelta : nativeDelta;
    if (tokens <= 0n || sol <= 0n) throw new Error('Non-positive actual fill');
    if (context.action === 'SELL' && tokens !== BigInt(context.inputBaseUnits)) throw new Error('Sell fill differs from exact position quantity');
    if (context.action === 'BUY' && tokens < BigInt(context.minimumOutputBaseUnits)) throw new Error('Buy fill below minimum output');
    return { tokenBaseUnits: tokens.toString(), tokenDecimals: context.tokenDecimals, solLamports: sol.toString(), feeLamports: meta.fee };
  }

  public static async signAndExecuteSwap(connection: Connection, versionedTx: VersionedTransaction, keypair: Keypair,
    lastValidBlockHeight?: number, context?: ExecutionContext): Promise<JupiterLiveExecutionResult> {
    let signature: string | undefined;
    let pending: PendingExecution | undefined;
    try {
      if (process.env.ENABLE_LIVE_TRADING !== 'true') throw new Error('ENABLE_LIVE_TRADING must explicitly equal true');
      if (!context || !Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight! <= 0) throw new Error('Missing guarded execution context or original block height');
      if (context.walletAddress !== keypair.publicKey.toBase58()) throw new Error('Foreign signing wallet');
      if (this.hasPendingExecution(context.walletAddress, context.action === 'BUY' ? undefined : context.tokenMint)) throw new Error('Pending execution requires reconciliation');
      await this.attestTransaction(connection, versionedTx, context);
      if (!Number.isFinite(context.quoteFetchedAt) || Date.now() - context.quoteFetchedAt > TradeSafetyValidator.MAX_QUOTE_AGE_MS || context.quoteFetchedAt > Date.now()) throw new Error('Stale quote at signer');
      TradeSafetyValidator.validateCompiledTransaction({ versioned_tx: versionedTx, wallet_pubkey: context.walletAddress,
        intended_action: context.action, intended_token_mint: context.tokenMint });
      context.finalGuard();
      TradeSafetyValidator.validateCompiledTransaction({ versioned_tx: versionedTx, wallet_pubkey: context.walletAddress,
        intended_action: context.action, intended_token_mint: context.tokenMint });
      versionedTx.sign([keypair]);
      signature = bs58.encode(versionedTx.signatures[0]);
      pending = { signature, walletAddress: context.walletAddress, tokenMint: context.tokenMint, action: context.action,
        blockhash: versionedTx.message.recentBlockhash, lastValidBlockHeight: lastValidBlockHeight!, status: 'UNKNOWN', submittedAt: Date.now() };
      this.loadPending().set(signature, pending);
      this.persistPending();
      const txid = await connection.sendRawTransaction(versionedTx.serialize(), { skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' });
      if (txid !== signature) throw new Error('RPC returned a different signature');
      const confirmation = await connection.confirmTransaction({ signature, blockhash: pending.blockhash,
        lastValidBlockHeight: pending.lastValidBlockHeight }, 'confirmed');
      if (confirmation.value.err) {
        this.loadPending().delete(signature);
        this.persistPending();
        return { success: false, status: 'FAILED', txSignature: signature, error: JSON.stringify(confirmation.value.err) };
      }
      const transaction = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      const fill = this.readConfirmedFill(transaction, context);
      pending.status = 'CONFIRMED';
      this.persistPending();
      return { success: true, status: 'CONFIRMED', txSignature: signature, explorerUrl: `https://solscan.io/tx/${signature}`, fill };
    } catch (err: any) {
      if (pending) {
        pending.error = err.message;
        // Retain even when RPC send itself throws: the signed bytes may have reached a node.
        this.loadPending().set(pending.signature, pending);
        try { this.persistPending(); } catch { /* Keep the process-local block if disk fails. */ }
      }
      return { success: false, status: signature ? 'UNKNOWN' : 'REJECTED', txSignature: signature, error: err.message };
    }
  }

  public static async executeDevnetRealMicroTrade(_connection: Connection, _keypair: Keypair, _memoText?: string): Promise<JupiterLiveExecutionResult> {
    return { success: false, status: 'REJECTED', error: 'Devnet self-transfers are not token trades; live swap unavailable' };
  }

  public static async executeRealSellSwap(connection: Connection, keypair: Keypair, tokenMint: string,
    tokenBaseUnits: bigint | string | number = 0n, slippageBps = 250, pctToExit = 100,
    finalGuard?: () => void): Promise<JupiterLiveExecutionResult> {
    try {
      if (process.env.ENABLE_LIVE_TRADING !== 'true' || !finalGuard) throw new Error('Live sell requires explicit interlock and wallet provenance guard');
      // Caller supplies the exact already-sized slice; never derive it from the whole wallet.
      if (typeof tokenBaseUnits === 'number' || !/^[1-9][0-9]*$/.test(String(tokenBaseUnits)) || pctToExit !== 100) {
        throw new Error('Sell requires exact positive position base units, not human tokens or a wallet percentage');
      }
      const amount = BigInt(tokenBaseUnits);
      const owner = keypair.publicKey.toBase58();
      if (this.hasPendingExecution(owner, tokenMint)) throw new Error('Pending execution requires reconciliation');
      finalGuard();
      const balance = await getOnChainTokenBalance(connection, keypair.publicKey, new PublicKey(tokenMint));
      if (balance.total_base_units < amount) throw new Error('Position quantity exceeds verified wallet balance');
      const quote = await this.fetchQuote({ inputMint: tokenMint, outputMint: SOL_MINT, amountLamports: amount, slippageBps });
      if (!quote.success || !quote.data) throw new Error(quote.error || 'Sell route unavailable');
      const valid = await TradeSafetyValidator.validateQuote(connection, { intended_action: 'SELL', intended_token_mint: tokenMint,
        intended_token_base_units: amount, quote_response: quote.data, wallet_pubkey: owner, max_slippage_bps: slippageBps });
      if (valid.token_decimals !== balance.decimals) throw new Error('Mint decimals inconsistent');
      const built = await this.buildSwapTransaction(quote.data, owner);
      if (!built.success || !built.versionedTx) throw new Error(built.error || 'Sell build failed');
      const result = await this.signAndExecuteSwap(connection, built.versionedTx, keypair, built.lastValidBlockHeight, {
        action: 'SELL', tokenMint, walletAddress: owner, tokenDecimals: balance.decimals,
        inputBaseUnits: amount.toString(), minimumOutputBaseUnits: quote.data.otherAmountThreshold,
        quoteFetchedAt: quote.data.fetchedAt, finalGuard,
      });
      if (result.success && result.fill) {
        result.tokensSold = toTokenHumanAmount(result.fill.tokenBaseUnits, result.fill.tokenDecimals);
        result.solReceived = lamportsToSol(result.fill.solLamports);
        result.outAmountSol = result.solReceived;
      }
      return result;
    } catch (err: any) { return { success: false, status: 'REJECTED', error: err.message }; }
  }
}
