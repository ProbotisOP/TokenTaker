import { LiveMarketMicrostructure, MicroWindowStats } from '../types.ts';

export interface SwapTick {
  timestamp: number;
  isBuy: boolean;
  tokenAmount: number;
  solAmount: number;
  priceSol: number;
  priceUsd: number;
  traderWallet: string;
  isNewWallet: boolean;
}

type PriceMark = { timestamp: number; priceSol: number; priceUsd: number };
type LiquidityMark = { timestamp: number; liquiditySol: number };

export class MicrostructureEngine {
  private ticks: SwapTick[] = [];
  private prices: PriceMark[] = [];
  private liquidity: LiquidityMark[] = [];

  constructor(private initialLiquiditySol: number, private initialPriceSol: number) {
    if (![initialLiquiditySol, initialPriceSol].every(v => Number.isFinite(v) && v >= 0)) {
      throw new Error('Invalid initial market values');
    }
  }

  private insert<T extends { timestamp: number }>(items: T[], value: T): void {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (items[mid].timestamp <= value.timestamp) lo = mid + 1;
      else hi = mid;
    }
    items.splice(lo, 0, value);
    if (items.length > 10_000) items.splice(0, items.length - 10_000);
  }

  public recordTick(tick: SwapTick): void {
    if (![tick.timestamp, tick.tokenAmount, tick.solAmount, tick.priceSol, tick.priceUsd]
      .every(v => Number.isFinite(v) && v >= 0) || tick.priceSol === 0 || tick.solAmount === 0 || tick.tokenAmount === 0) return;
    this.insert(this.ticks, { ...tick });
    this.insert(this.prices, { timestamp: tick.timestamp, priceSol: tick.priceSol, priceUsd: tick.priceUsd });
  }

  public updateMarket(market: { priceSol: number; priceUsd: number; liquiditySol: number }, timestamp = Date.now()): void {
    if (![timestamp, market.priceSol, market.priceUsd, market.liquiditySol]
      .every(v => Number.isFinite(v) && v >= 0) || market.priceSol === 0) return;
    this.insert(this.prices, { timestamp, priceSol: market.priceSol, priceUsd: market.priceUsd });
    this.insert(this.liquidity, { timestamp, liquiditySol: market.liquiditySol });
  }

  private pruneMarks<T extends { timestamp: number }>(marks: T[], cutoff: number): T[] {
    const preceding = marks.filter(m => m.timestamp <= cutoff).slice(-1);
    return preceding.concat(marks.filter(m => m.timestamp > cutoff));
  }

  public getSnapshot(nowTimestamp = Date.now()): LiveMarketMicrostructure {
    if (!Number.isFinite(nowTimestamp)) throw new Error('Invalid snapshot timestamp');
    const cutoff = nowTimestamp - 60000;
    this.ticks = this.ticks.filter(t => t.timestamp > cutoff);
    // Keep one preceding mark so a quiet boundary still has a causal return baseline.
    this.prices = this.pruneMarks(this.prices, cutoff);
    this.liquidity = this.pruneMarks(this.liquidity, cutoff);
    const active = this.ticks.filter(t => t.timestamp <= nowTimestamp);
    const price = this.prices.filter(p => p.timestamp <= nowTimestamp).at(-1);
    const priceSol = price?.priceSol ?? this.initialPriceSol;
    const priceUsd = price?.priceUsd ?? 0;
    const liquiditySol = this.liquidity.filter(p => p.timestamp <= nowTimestamp).at(-1)?.liquiditySol ?? this.initialLiquiditySol;
    const solUsd = priceSol > 0 ? priceUsd / priceSol : 0;
    const windows = {
      '1s': this.computeWindowStats(nowTimestamp, 1000),
      '3s': this.computeWindowStats(nowTimestamp, 3000),
      '5s': this.computeWindowStats(nowTimestamp, 5000),
      '10s': this.computeWindowStats(nowTimestamp, 10000),
      '30s': this.computeWindowStats(nowTimestamp, 30000),
      '60s': this.computeWindowStats(nowTimestamp, 60000),
    };
    const buys = active.filter(t => t.isBuy);
    const summary = windows['60s'];
    return {
      priceUsd, priceSol,
      volumeSol: summary.volumeSol,
      buyVolumeSol: summary.buyVolumeSol,
      sellVolumeSol: summary.sellVolumeSol,
      buySellRatio: summary.buySellRatio,
      liquiditySol, liquidityUsd: liquiditySol * solUsd,
      marketCapUsd: 0, // Supply is not established by swap observations.
      priceVelocity: windows['5s'].priceChangePct / 5,
      volumeVelocity: windows['5s'].volumeSol / 5,
      uniqueBuyers: summary.uniqueBuyers,
      uniqueSellers: summary.uniqueSellers,
      newWalletRate: buys.length ? buys.filter(t => t.isNewWallet).length / buys.length : 0,
      holderGrowth: 0,
      liquidityChangePct: this.initialLiquiditySol > 0 ? (liquiditySol / this.initialLiquiditySol - 1) * 100 : 0,
      largeWalletActivityCount: active.filter(t => t.solAmount >= 1.5).length,
      windows,
    };
  }

  private computeWindowStats(now: number, windowMs: number): MicroWindowStats {
    const cutoff = now - windowMs;
    const recent = this.ticks.filter(t => t.timestamp > cutoff && t.timestamp <= now);
    const buyVolume = recent.filter(t => t.isBuy).reduce((sum, t) => sum + t.solAmount, 0);
    const sellVolume = recent.filter(t => !t.isBuy).reduce((sum, t) => sum + t.solAmount, 0);
    const baseline = this.prices.filter(p => p.timestamp <= cutoff).at(-1);
    const latest = this.prices.filter(p => p.timestamp <= now).at(-1);
    return {
      priceChangePct: baseline && latest ? (latest.priceSol / baseline.priceSol - 1) * 100 : 0,
      volumeSol: buyVolume + sellVolume,
      buyVolumeSol: buyVolume,
      sellVolumeSol: sellVolume,
      buySellRatio: sellVolume > 0 ? buyVolume / sellVolume : (buyVolume > 0 ? 5 : 1),
      tradeCount: recent.length,
      uniqueBuyers: new Set(recent.filter(t => t.isBuy && t.traderWallet).map(t => t.traderWallet)).size,
      uniqueSellers: new Set(recent.filter(t => !t.isBuy && t.traderWallet).map(t => t.traderWallet)).size,
      netFlowSol: buyVolume - sellVolume,
    };
  }
}
