import { PublicKey } from '@solana/web3.js';
import type { SwapTick } from './microstructureEngine.ts';

export interface LaunchEvent {
  mint: string;
  symbol: string;
  name: string;
  creator: string;
  poolAddress: string;
  signature: string;
  detectedAt: number;
  initialPriceSol: number;
  unsupportedMode: boolean;
}

export interface FeedStatus {
  state: 'DISABLED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';
  tradeFlowEnabled: boolean;
  lastMessageAt?: number;
  launchesReceived: number;
  tradesReceived: number;
  droppedEvents: number;
  trackedTokens: number;
  error?: string;
}

interface FeedOptions {
  disabledReason?: string;
  enabled: boolean;
  apiKey?: string;
  enableTrades: boolean;
  maxTrackedTokens?: number;
  maxAgeMs?: number;
}

const validAddress = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { return new PublicKey(value).toBase58() === value; } catch { return false; }
};
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** One connection, bounded subscriptions, no token-list polling or synthetic fallbacks. */
export class LiveTokenFeedService {
  private static instance: LiveTokenFeedService;
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private expiryTimer?: NodeJS.Timeout;
  private stopped = true;
  private retries = 0;
  private tokens = new Map<string, LaunchEvent>();
  private signatures = new Set<string>();
  private launchListeners: ((launch: LaunchEvent) => void)[] = [];
  private tradeListeners: ((mint: string, tick: SwapTick) => void)[] = [];
  private gapListeners: ((reason: string) => void)[] = [];
  private status: FeedStatus;

  constructor(private options: FeedOptions) {
    this.status = {
      state: 'DISABLED', error: options.enabled ? undefined : options.disabledReason,
      tradeFlowEnabled: !!options.apiKey && options.enableTrades,
      launchesReceived: 0, tradesReceived: 0, droppedEvents: 0, trackedTokens: 0,
    };
  }

  static getInstance(): LiveTokenFeedService {
    return this.instance ??= new LiveTokenFeedService({
      disabledReason: 'Launch discovery is disabled. Manual swaps are available under Real Wallet / Phantom. Automated signals still need a configured market feed.',
      enabled: process.env.EARLY_FEED_ENABLED === 'true' && process.env.EARLY_FEED_PROVIDER === 'PUMPPORTAL',
      apiKey: process.env.PUMPPORTAL_API_KEY,
      enableTrades: process.env.PUMPPORTAL_ENABLE_TRADES === 'true',
    });
  }

  onLaunch(listener: (launch: LaunchEvent) => void): void { this.launchListeners.push(listener); }
  onTrade(listener: (mint: string, tick: SwapTick) => void): void { this.tradeListeners.push(listener); }
  onGap(listener: (reason: string) => void): void { this.gapListeners.push(listener); }
  getStatus(): FeedStatus { return { ...this.status, trackedTokens: this.tokens.size }; }

  start(): void {
    if (!this.stopped || !this.options.enabled) return;
    this.stopped = false;
    this.connect();
    this.expiryTimer = setInterval(() => this.expire(Date.now()), 1000);
    this.expiryTimer.unref();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.expiryTimer);
    this.socket?.close();
    this.status.state = 'DISABLED';
  }

  private connect(): void {
    this.status.state = this.retries ? 'RECONNECTING' : 'CONNECTING';
    const endpoint = new URL('wss://pumpportal.fun/api/data');
    if (this.options.apiKey) endpoint.searchParams.set('api-key', this.options.apiKey);
    const ws = this.socket = new WebSocket(endpoint);
    const connectTimeout = setTimeout(() => ws.close(), 10_000);
    ws.onopen = () => {
      clearTimeout(connectTimeout);
      this.retries = 0;
      this.status.state = 'CONNECTED';
      this.status.error = this.status.tradeFlowEnabled ? undefined : 'Discovery only: funded API key and explicit metered trade opt-in required for signals';
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    };
    ws.onmessage = event => {
      try { this.acceptMessage(JSON.parse(String(event.data))); }
      catch { this.status.droppedEvents++; }
    };
    ws.onerror = () => { this.status.error = 'Launch stream connection failed'; };
    ws.onclose = () => {
      clearTimeout(connectTimeout);
      if (this.stopped) return;
      this.status.state = 'RECONNECTING';
      this.status.error = 'Stream gap: existing candidates invalidated; waiting for new launches';
      this.gapListeners.forEach(listener => listener(this.status.error!));
      this.tokens.clear();
      const delay = Math.min(30_000, 1000 * 2 ** this.retries++);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
      this.reconnectTimer.unref();
    };
  }

  // Public for deterministic provider-fixture replay. Only the socket invokes this in production.
  acceptMessage(data: any, now = Date.now()): void {
    this.status.lastMessageAt = now;
    if (data?.errors || data?.error) {
      this.status.state = 'ERROR';
      this.status.error = 'Provider rejected subscription or data request';
      this.gapListeners.forEach(listener => listener(this.status.error!));
      return;
    }
    if (!data || !['create', 'buy', 'sell'].includes(data.txType)) return;
    if (!validAddress(data.mint) || !validAddress(data.traderPublicKey) ||
        typeof data.signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(data.signature)) {
      this.status.droppedEvents++; return;
    }
    const key = `${data.signature}:${data.mint}:${data.txType}`;
    if (this.signatures.has(key)) return;
    this.signatures.add(key);
    if (this.signatures.size > 20_000) this.signatures.delete(this.signatures.values().next().value!);
    this.expire(now);
    if (data.txType === 'create') {
      if (this.tokens.has(data.mint)) return;
      if (!validAddress(data.bondingCurveKey) || !positive(data.vSolInBondingCurve) || !positive(data.vTokensInBondingCurve)) {
        this.status.droppedEvents++; return;
      }
      if (this.tokens.size >= (this.options.maxTrackedTokens ?? 100)) {
        // Keep observing existing candidates rather than resetting their confirmation windows under load.
        this.status.droppedEvents++; return;
      }
      const launch: LaunchEvent = {
        mint: data.mint, name: String(data.name || '').slice(0, 80), symbol: String(data.symbol || '').slice(0, 16),
        creator: data.traderPublicKey, signature: data.signature, poolAddress: data.bondingCurveKey,
        detectedAt: now, initialPriceSol: data.vSolInBondingCurve / data.vTokensInBondingCurve,
        unsupportedMode: data.is_mayhem_mode === true || (data.pool !== undefined && data.pool !== 'pump'),
      };
      this.tokens.set(launch.mint, launch);
      this.status.launchesReceived++;
      if (this.status.tradeFlowEnabled) this.send({ method: 'subscribeTokenTrade', keys: [launch.mint] });
      this.launchListeners.forEach(listener => listener(launch));
      return;
    }
    if (!this.tokens.has(data.mint) || !positive(data.solAmount) || !positive(data.tokenAmount)) return;
    if (data.pool && data.pool !== 'pump') {
      this.gapListeners.forEach(listener => listener('Unsupported pool migration observed; reinspection required'));
      return;
    }
    const price = positive(data.vSolInBondingCurve) && positive(data.vTokensInBondingCurve)
      ? data.vSolInBondingCurve / data.vTokensInBondingCurve : data.solAmount / data.tokenAmount;
    if (!positive(price)) return;
    this.status.tradesReceived++;
    this.tradeListeners.forEach(listener => listener(data.mint, {
      timestamp: now, isBuy: data.txType === 'buy', solAmount: data.solAmount, tokenAmount: data.tokenAmount,
      priceSol: price, priceUsd: 0, traderWallet: data.traderPublicKey, isNewWallet: false,
    }));
  }

  private send(payload: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private expire(now: number): void {
    const expired: string[] = [];
    for (const [mint, launch] of this.tokens) {
      if (now - launch.detectedAt > (this.options.maxAgeMs ?? 120_000)) { expired.push(mint); this.tokens.delete(mint); }
    }
    if (expired.length && this.status.tradeFlowEnabled) this.send({ method: 'unsubscribeTokenTrade', keys: expired });
  }
}
