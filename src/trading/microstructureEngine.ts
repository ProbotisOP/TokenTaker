/**
 * Market Microstructure & Flow Engine
 * Models early-launch order flow across ultra-short time horizons (1s, 3s, 5s, 10s, 30s, 60s).
 */
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

export class MicrostructureEngine {
  private ticks: SwapTick[] = [];
  private initialPoolLiquiditySol: number;
  private currentLiquiditySol: number;
  private currentPriceSol: number;
  private currentPriceUsd: number;
  private solUsdRate: number = 155.0;

  constructor(initialLiquiditySol: number, initialPriceSol: number) {
    this.initialPoolLiquiditySol = initialLiquiditySol;
    this.currentLiquiditySol = initialLiquiditySol;
    this.currentPriceSol = initialPriceSol;
    this.currentPriceUsd = initialPriceSol * this.solUsdRate;
  }

  public recordTick(tick: SwapTick): void {
    this.ticks.push(tick);
    this.currentPriceSol = tick.priceSol;
    this.currentPriceUsd = tick.priceUsd;
    if (tick.isBuy) {
      this.currentLiquiditySol += tick.solAmount;
    } else {
      this.currentLiquiditySol = Math.max(0.1, this.currentLiquiditySol - tick.solAmount);
    }
  }

  public getSnapshot(nowTimestamp: number = Date.now()): LiveMarketMicrostructure {
    const w1s = this.computeWindowStats(nowTimestamp, 1000);
    const w3s = this.computeWindowStats(nowTimestamp, 3000);
    const w5s = this.computeWindowStats(nowTimestamp, 5000);
    const w10s = this.computeWindowStats(nowTimestamp, 10000);
    const w30s = this.computeWindowStats(nowTimestamp, 30000);
    const w60s = this.computeWindowStats(nowTimestamp, 60000);

    const totalBuys = this.ticks.filter(t => t.isBuy).reduce((sum, t) => sum + t.solAmount, 0);
    const totalSells = this.ticks.filter(t => !t.isBuy).reduce((sum, t) => sum + t.solAmount, 0);
    const totalVolume = totalBuys + totalSells;
    const buySellRatio = totalSells > 0 ? totalBuys / totalSells : (totalBuys > 0 ? 10.0 : 1.0);

    const uniqueBuyers = new Set(this.ticks.filter(t => t.isBuy).map(t => t.traderWallet)).size;
    const uniqueSellers = new Set(this.ticks.filter(t => !t.isBuy).map(t => t.traderWallet)).size;
    const newWalletsCount = this.ticks.filter(t => t.isBuy && t.isNewWallet).length;
    const totalBuyTrades = this.ticks.filter(t => t.isBuy).length;
    const newWalletRate = totalBuyTrades > 0 ? newWalletsCount / totalBuyTrades : 0;

    // Price velocity: % change per second over last 5 seconds
    const priceVelocity = w5s.priceChangePct / 5.0;
    // Volume velocity: SOL per second over last 5 seconds
    const volumeVelocity = w5s.volumeSol / 5.0;

    // Liquidity change relative to creation
    const liquidityChangePct = ((this.currentLiquiditySol - this.initialPoolLiquiditySol) / this.initialPoolLiquiditySol) * 100;

    // Large transactions (>= 1.5 SOL)
    const largeWalletActivityCount = this.ticks.filter(t => t.solAmount >= 1.5).length;

    // Approximate circulating market cap in USD
    const totalTokens = 1_000_000_000; // 1 billion standard SPL meme supply
    const marketCapUsd = totalTokens * this.currentPriceUsd;

    return {
      priceUsd: this.currentPriceUsd,
      priceSol: this.currentPriceSol,
      volumeSol: totalVolume,
      buyVolumeSol: totalBuys,
      sellVolumeSol: totalSells,
      buySellRatio,
      liquiditySol: this.currentLiquiditySol,
      liquidityUsd: this.currentLiquiditySol * this.solUsdRate,
      marketCapUsd,
      priceVelocity,
      volumeVelocity,
      uniqueBuyers,
      uniqueSellers,
      newWalletRate,
      holderGrowth: uniqueBuyers,
      liquidityChangePct,
      largeWalletActivityCount,
      windows: {
        '1s': w1s,
        '3s': w3s,
        '5s': w5s,
        '10s': w10s,
        '30s': w30s,
        '60s': w60s,
      },
    };
  }

  private computeWindowStats(now: number, windowMs: number): MicroWindowStats {
    const cutoff = now - windowMs;
    const recent = this.ticks.filter(t => t.timestamp >= cutoff);

    if (recent.length === 0) {
      return {
        priceChangePct: 0,
        volumeSol: 0,
        buyVolumeSol: 0,
        sellVolumeSol: 0,
        buySellRatio: 1.0,
        tradeCount: 0,
        uniqueBuyers: 0,
        uniqueSellers: 0,
        netFlowSol: 0,
      };
    }

    const buyVolume = recent.filter(t => t.isBuy).reduce((sum, t) => sum + t.solAmount, 0);
    const sellVolume = recent.filter(t => !t.isBuy).reduce((sum, t) => sum + t.solAmount, 0);
    const firstPrice = recent[0].priceSol;
    const lastPrice = recent[recent.length - 1].priceSol;
    const priceChangePct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
    const buySellRatio = sellVolume > 0 ? buyVolume / sellVolume : (buyVolume > 0 ? 5.0 : 1.0);
    const uniqueBuyers = new Set(recent.filter(t => t.isBuy).map(t => t.traderWallet)).size;
    const uniqueSellers = new Set(recent.filter(t => !t.isBuy).map(t => t.traderWallet)).size;

    return {
      priceChangePct,
      volumeSol: buyVolume + sellVolume,
      buyVolumeSol: buyVolume,
      sellVolumeSol: sellVolume,
      buySellRatio,
      tradeCount: recent.length,
      uniqueBuyers,
      uniqueSellers,
      netFlowSol: buyVolume - sellVolume,
    };
  }
}
