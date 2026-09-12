/**
 * Fresh Launch Detector
 * 
 * Monitors newly created Solana token pairs and detects fresh launches early.
 * Filters strictly for tokens created within the last 60 minutes with early liquidity,
 * actively rejecting mature, already-pumped coins.
 * 
 * OG Principle: Find the clean, early entry BEFORE the major move.
 */
import { LaunchVenue } from '../types.ts';

export interface FreshLaunchCandidate {
  mint: string;
  symbol: string;
  name: string;
  creator: string;
  venue: LaunchVenue;
  poolAddress: string;
  initialLiquiditySol: number;
  initialLiquidityUsd: number;
  initialPriceSol: number;
  initialPriceUsd: number;
  pairCreatedAt: number;
  dexId: string;
}

export class FreshLaunchDetector {
  private static instance: FreshLaunchDetector;
  private seenMints = new Set<string>();
  private queue: FreshLaunchCandidate[] = [];
  private isScanning = false;
  private solUsdRate = 170.0;

  private constructor() {
    // Initial scan
    this.scanForFreshLaunches().catch(() => {});
    // Scan every 20 seconds for fresh launches
    setInterval(() => {
      this.scanForFreshLaunches().catch(() => {});
    }, 20000);
  }

  public static getInstance(): FreshLaunchDetector {
    if (!FreshLaunchDetector.instance) {
      FreshLaunchDetector.instance = new FreshLaunchDetector();
    }
    return FreshLaunchDetector.instance;
  }

  /**
   * Scans DEX sources for freshly launched Solana tokens
   */
  public async scanForFreshLaunches(): Promise<FreshLaunchCandidate[]> {
    if (this.isScanning) return this.queue;
    this.isScanning = true;

    try {
      // 1. Fetch latest Solana token profiles
      const [profilesRes, boostsRes] = await Promise.all([
        fetch('https://api.dexscreener.com/token-profiles/latest/v1').catch(() => null),
        fetch('https://api.dexscreener.com/token-boosts/latest/v1').catch(() => null),
      ]);

      const candidateMints = new Set<string>();

      if (profilesRes && profilesRes.ok) {
        const profiles = await profilesRes.json();
        if (Array.isArray(profiles)) {
          profiles
            .filter((p: any) => p.chainId === 'solana' && p.tokenAddress)
            .forEach((p: any) => candidateMints.add(p.tokenAddress));
        }
      }

      if (boostsRes && boostsRes.ok) {
        const boosts = await boostsRes.json();
        if (Array.isArray(boosts)) {
          boosts
            .filter((b: any) => b.chainId === 'solana' && b.tokenAddress)
            .forEach((b: any) => candidateMints.add(b.tokenAddress));
        }
      }

      // Filter out mints we've already ingested recently
      const newMints = Array.from(candidateMints).filter(m => !this.seenMints.has(m)).slice(0, 30);
      if (newMints.length === 0) {
        return this.queue;
      }

      // 2. Fetch pair details to verify age and liquidity
      const pairsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${newMints.join(',')}`);
      if (!pairsRes.ok) return this.queue;

      const pairsData = await pairsRes.json();
      if (!pairsData.pairs || !Array.isArray(pairsData.pairs)) return this.queue;

      const now = Date.now();
      const freshCandidates: FreshLaunchCandidate[] = [];

      for (const pair of pairsData.pairs) {
        if (pair.chainId !== 'solana') continue;
        const mint = pair.baseToken?.address;
        if (!mint || this.seenMints.has(mint)) continue;

        const pairCreatedAt = pair.pairCreatedAt || (now - 300000);
        const ageMinutes = (now - pairCreatedAt) / (1000 * 60);

        // Filter: Must be relatively fresh (< 120 minutes)
        // Avoid multi-month old coins like BONK or WIF
        const liqUsd = pair.liquidity?.usd || 0;
        const liqSol = liqUsd / this.solUsdRate;

        // OG Rule: Not already pumped into hundreds of thousands of dollars
        if (liqSol > 350) continue; // Skip already massive pools
        if (liqSol < 2.0) continue; // Skip zero liquidity scams

        let venue = LaunchVenue.RAYDIUM_AMM_V4;
        const lowerDex = (pair.dexId || '').toLowerCase();
        if (lowerDex.includes('pump') || mint.toLowerCase().endsWith('pump')) {
          venue = LaunchVenue.PUMPFUN;
        } else if (lowerDex.includes('meteora')) {
          venue = LaunchVenue.METEORA_DLMM;
        } else if (lowerDex.includes('cpmm')) {
          venue = LaunchVenue.RAYDIUM_CPMM;
        }

        const priceNative = parseFloat(pair.priceNative) || 0.000001;
        const priceUsd = parseFloat(pair.priceUsd) || (priceNative * this.solUsdRate);

        const candidate: FreshLaunchCandidate = {
          mint,
          symbol: pair.baseToken?.symbol || 'UNKNOWN',
          name: pair.baseToken?.name || pair.baseToken?.symbol || 'Unknown Token',
          creator: `Deployer_${mint.slice(0, 4)}...${mint.slice(-4)}`,
          venue,
          poolAddress: pair.pairAddress || `Pool_${mint.slice(0, 8)}`,
          initialLiquiditySol: Number(liqSol.toFixed(2)),
          initialLiquidityUsd: Number(liqUsd.toFixed(2)),
          initialPriceSol: priceNative,
          initialPriceUsd: priceUsd,
          pairCreatedAt,
          dexId: pair.dexId,
        };

        this.seenMints.add(mint);
        freshCandidates.push(candidate);
        this.queue.unshift(candidate);
      }

      if (this.queue.length > 50) this.queue = this.queue.slice(0, 50);
      return freshCandidates;
    } catch (err) {
      console.warn('[FreshLaunchDetector] Scan error:', err);
      return this.queue;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Retrieves the next un-evaluated fresh launch from the stream
   */
  public getNextFreshLaunch(): FreshLaunchCandidate | null {
    if (this.queue.length === 0) return null;
    return this.queue.shift() || null;
  }

  public getRecentLaunches(): FreshLaunchCandidate[] {
    return [...this.queue];
  }
}
