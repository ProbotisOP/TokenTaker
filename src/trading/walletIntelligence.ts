/**
 * Wallet and Flow Intelligence Engine
 * Tracks wallet reputation, cluster analysis, and probabilistic smart-money scoring.
 */
import { WalletCategory, WalletProfile } from '../types.ts';

export class WalletIntelligence {
  private static walletRegistry = new Map<string, WalletProfile>();

  // Known seeds and profile archetypes for realistic on-chain classification
  public static initKnownRegistry(): void {
    if (this.walletRegistry.size > 0) return;

    // Seed exemplary profitable snipers
    this.walletRegistry.set('7xKXtg...AlphaSniper1', {
      address: '7xKXtg...AlphaSniper1',
      category: WalletCategory.SNIPER,
      realizedPnlSol: 142.8,
      winRate: 0.68,
      avgHoldingSec: 38,
      avgEntryTimingSec: 2.1,
      realizedTradesCount: 312,
      tokenOverlapCount: 45,
      behaviorDuringRugs: 'dumped_first',
      reputationScore: 78,
    });

    this.walletRegistry.set('9pW2zQ...QuantArb', {
      address: '9pW2zQ...QuantArb',
      category: WalletCategory.PROFITABLE_TRADER,
      realizedPnlSol: 290.4,
      winRate: 0.74,
      avgHoldingSec: 110,
      avgEntryTimingSec: 4.8,
      realizedTradesCount: 520,
      tokenOverlapCount: 88,
      behaviorDuringRugs: 'dumped_first',
      reputationScore: 89,
    });

    this.walletRegistry.set('3mZ9rT...SybilBundleNode1', {
      address: '3mZ9rT...SybilBundleNode1',
      category: WalletCategory.SYBIL_SUSPICIOUS,
      realizedPnlSol: -14.2,
      winRate: 0.22,
      avgHoldingSec: 14,
      avgEntryTimingSec: 0.8,
      realizedTradesCount: 41,
      tokenOverlapCount: 34,
      behaviorDuringRugs: 'held_to_zero',
      reputationScore: -65,
    });
  }

  public static getOrCreateProfile(address: string, isEarlyBuyer: boolean = false): WalletProfile {
    this.initKnownRegistry();
    const existing = this.walletRegistry.get(address);
    if (existing) return existing;

    // Deterministic simulation based on hash of address
    const hash = address.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    let category: WalletCategory = WalletCategory.UNKNOWN;
    let winRate = 0.45;
    let pnl = (hash % 100) - 45;
    let rep = 0;

    if (hash % 17 === 0) {
      category = WalletCategory.CREATOR_LINKED;
      rep = -75;
      winRate = 0.20;
    } else if (hash % 13 === 0) {
      category = WalletCategory.SYBIL_SUSPICIOUS;
      rep = -60;
      winRate = 0.25;
    } else if (hash % 11 === 0) {
      category = WalletCategory.PROFITABLE_TRADER;
      rep = 82;
      winRate = 0.71;
      pnl = 85 + (hash % 150);
    } else if (hash % 7 === 0) {
      category = WalletCategory.SNIPER;
      rep = 65;
      winRate = 0.62;
      pnl = 40 + (hash % 60);
    } else if (hash % 5 === 0) {
      category = WalletCategory.HIGH_FREQUENCY;
      rep = 40;
      winRate = 0.52;
    } else if (hash % 3 === 0) {
      category = WalletCategory.NEW;
      rep = 5;
    }

    const profile: WalletProfile = {
      address,
      category,
      realizedPnlSol: pnl,
      winRate,
      avgHoldingSec: 25 + (hash % 180),
      avgEntryTimingSec: isEarlyBuyer ? 1.5 + ((hash % 30) / 10) : 15 + (hash % 60),
      realizedTradesCount: 10 + (hash % 200),
      tokenOverlapCount: hash % 15,
      behaviorDuringRugs: winRate > 0.6 ? 'dumped_first' : 'held_to_zero',
      reputationScore: rep,
    };

    this.walletRegistry.set(address, profile);
    return profile;
  }

  /**
   * Evaluates the collective quality of active wallets in a launch
   */
  public static evaluateFlowQuality(wallets: string[]): {
    walletQualityScore: number; // 0 to 1
    profitableTraderCount: number;
    sniperCount: number;
    sybilCount: number;
    insiderCount: number;
    weightedReputation: number;
  } {
    if (wallets.length === 0) {
      return {
        walletQualityScore: 0.5,
        profitableTraderCount: 0,
        sniperCount: 0,
        sybilCount: 0,
        insiderCount: 0,
        weightedReputation: 0,
      };
    }

    let totalRep = 0;
    let profitable = 0;
    let snipers = 0;
    let sybil = 0;
    let insider = 0;

    for (const w of wallets) {
      const p = this.getOrCreateProfile(w);
      totalRep += p.reputationScore;
      if (p.category === WalletCategory.PROFITABLE_TRADER) profitable++;
      if (p.category === WalletCategory.SNIPER) snipers++;
      if (p.category === WalletCategory.SYBIL_SUSPICIOUS) sybil++;
      if (p.category === WalletCategory.CREATOR_LINKED || p.category === WalletCategory.INSIDER_LIKE) insider++;
    }

    const avgRep = totalRep / wallets.length;
    // Base 0.5, sybils and insiders heavily penalize, verified profitable traders elevate
    const sybilPenalty = (sybil * 0.15) + (insider * 0.25);
    const smartMoneyBonus = (profitable * 0.12) + (snipers * 0.05);

    const rawScore = 0.5 + (avgRep / 200) + smartMoneyBonus - sybilPenalty;
    const walletQualityScore = Math.max(0, Math.min(1, rawScore));

    return {
      walletQualityScore,
      profitableTraderCount: profitable,
      sniperCount: snipers,
      sybilCount: sybil,
      insiderCount: insider,
      weightedReputation: Math.round(avgRep),
    };
  }
}
