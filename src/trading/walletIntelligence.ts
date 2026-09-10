import { WalletCategory, WalletProfile } from '../types.ts';

export class WalletIntelligence {
  public static initKnownRegistry(): void {
    // No verified historical wallet provider is configured.
  }

  public static getOrCreateProfile(address: string, _isEarlyBuyer = false): WalletProfile {
    return {
      address,
      category: WalletCategory.UNKNOWN,
      realizedPnlSol: 0,
      winRate: 0,
      avgHoldingSec: 0,
      avgEntryTimingSec: 0,
      realizedTradesCount: 0,
      tokenOverlapCount: 0,
      behaviorDuringRugs: 'neutral',
      reputationScore: 0,
    };
  }

  public static evaluateFlowQuality(wallets: string[]): {
    walletQualityScore: number;
    profitableTraderCount: number;
    sniperCount: number;
    sybilCount: number;
    insiderCount: number;
    weightedReputation: number;
    verified: boolean;
    uniqueWalletCount: number;
  } {
    const uniqueWallets = new Set(wallets.filter(address => address.trim().length > 0));
    return {
      walletQualityScore: 0.5, // Neutral placeholder, not evidence of profitable trading.
      profitableTraderCount: 0,
      sniperCount: 0,
      sybilCount: 0,
      insiderCount: 0,
      weightedReputation: 0,
      verified: false,
      uniqueWalletCount: uniqueWallets.size,
    };
  }
}
