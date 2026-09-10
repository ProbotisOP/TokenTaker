/**
 * Alpha and Opportunity Scoring Engine
 * Evaluates statistical edge, rug probability, and net expected return.
 */
import {
  AlphaScoreComponents,
  LiveMarketMicrostructure,
  OpportunityScoreOutput,
  SocialIntelligence,
  StrategyWeights,
  TokenMetadata,
  TokenSafetyReport,
} from '../types.ts';
import { DEFAULT_STRATEGY_WEIGHTS } from './config.ts';

export interface ScoringInput {
  metadata: TokenMetadata;
  safety: TokenSafetyReport;
  micro: LiveMarketMicrostructure;
  walletQualityScore: number;
  social: SocialIntelligence;
  weights?: StrategyWeights;
}

export class ScoringEngine {
  public static compute(input: ScoringInput): OpportunityScoreOutput {
    const w = input.weights || DEFAULT_STRATEGY_WEIGHTS;
    const { safety, micro, walletQualityScore, social } = input;

    // 1. Component Normalization (0.0 to 1.0)
    // Liquidity Quality: Viable range 10-60 SOL optimal for memecoins
    const liqSol = micro.liquiditySol;
    const liquidityQuality = Math.min(1.0, Math.max(0.0, (liqSol - 5.0) / 45.0));

    // Buy Pressure: normalized from buy/sell ratio (1.0 = 0.5, >= 3.0 = 1.0)
    const ratio = micro.buySellRatio;
    const buyPressure = Math.min(1.0, Math.max(0.0, ratio >= 1.0 ? 0.5 + Math.min(0.5, (ratio - 1.0) / 4.0) : ratio * 0.5));

    // Compare disjoint intervals: latest 3s versus the preceding 27s.
    const v3s = micro.windows['3s'].volumeSol;
    const priorVolume = Math.max(0, micro.windows['30s'].volumeSol - v3s);
    const priorTrades = micro.windows['30s'].tradeCount - micro.windows['3s'].tradeCount;
    const prior3sAverage = priorVolume / 9;
    const accelRatio = priorTrades > 0 && prior3sAverage > 0 ? v3s / prior3sAverage : 0;
    const volumeAcceleration = Math.min(1.0, Math.max(0.0, accelRatio / 3.0));

    // Swap participants alone do not establish holder growth.
    const holderGrowth = Math.min(1.0, Math.max(0.0, micro.holderGrowth / 25.0));

    // Wallet Quality: direct from WalletIntelligence (0 to 1)
    const walletQuality = Math.min(1.0, Math.max(0.0, walletQualityScore));

    // Price Structure: positive price velocity without extreme vertical blowoff
    const vel = micro.priceVelocity;
    let priceStructure = 0.5;
    if (vel > 0 && vel <= 8.0) {
      // Steady healthy momentum
      priceStructure = 0.5 + (vel / 16.0);
    } else if (vel > 8.0) {
      // Overheated vertical wick
      priceStructure = 0.65 - Math.min(0.3, (vel - 8.0) * 0.05);
    } else {
      // Negative momentum
      priceStructure = Math.max(0.0, 0.5 + (vel / 10.0));
    }

    // Launch Quality: initial liquidity and LP status
    const launchQuality = (safety.lpBurnOrLocked ? 0.6 : 0.2) + (safety.mintAuthorityRevoked ? 0.2 : 0) + (safety.freezeAuthorityRevoked ? 0.2 : 0);

    // Social Signal: cross-correlated with genuine capital
    const socialSignal = Math.max(0.0, Math.min(1.0, (social.sentimentScore + 1) / 2 * (social.socialCapitalCorrelation > 0 ? 1 : 0.4)));

    // Deductions:
    // Slippage impact: estimate base slippage from pool depth (e.g. 1 SOL trade against pool)
    const estImpactPct = (1.0 / (liqSol + 0.1)) * 100;
    const slippageDeduction = Math.min(1.0, estImpactPct / 6.0);

    // Concentration risk: top 1 and top 10 holders
    const concentrationRisk = Math.min(1.0, (safety.top1Percent / 20.0) * 0.5 + (safety.top10Percent / 70.0) * 0.5);

    // Rug Probability: inverse of safety score + insider bundle presence
    const baseRug = (100 - safety.safetyScore) / 100;
    const rugProbability = Math.min(1.0, baseRug + (safety.insiderClusterDetected ? 0.35 : 0.0));

    // Execution Risk: high network traffic or thin liquidity
    const executionRisk = Math.min(1.0, (estImpactPct > 3 ? 0.4 : 0.1) + (micro.windows['60s'].tradeCount > 40 ? 0.3 : 0.1));

    const components: AlphaScoreComponents = {
      liquidityQuality,
      buyPressure,
      volumeAcceleration,
      holderGrowth,
      walletQuality,
      priceStructure,
      launchQuality,
      socialSignal,
      slippageDeduction,
      concentrationRisk,
      rugProbability,
      executionRisk,
    };

    // 2. Weighted Aggregation
    const positiveScore =
      (liquidityQuality * w.liquidityQuality) +
      (buyPressure * w.buyPressure) +
      (volumeAcceleration * w.volumeAcceleration) +
      (holderGrowth * w.holderGrowth) +
      (walletQuality * w.walletQuality) +
      (priceStructure * w.priceStructure) +
      (launchQuality * w.launchQuality) +
      (socialSignal * w.socialSignal);

    const negativePenalty =
      (slippageDeduction * w.slippageDeduction) +
      (concentrationRisk * w.concentrationRisk) +
      (rugProbability * w.rugProbability) +
      (executionRisk * w.executionRisk);

    // Negative penalties apply proportional risk haircut (up to 70% reduction for high risk/rug)
    const riskDiscount = Math.min(0.70, negativePenalty * 0.75);
    const netScore = Math.max(0, Math.min(1, positiveScore * (1.0 - riskDiscount)));
    const opportunityScore = Math.round(netScore * 100);

    // 3. Quantitative Financial Expectations
    // Expected return modeled by momentum, buyer quality, and buy pressure
    const expectedReturnPct = Math.max(0, ((buyPressure * 0.4) + (walletQuality * 0.3) + (volumeAcceleration * 0.3)) * 45.0);

    // Expected loss modeled by rug probability and slippage
    const expectedLossPct = Math.min(95, (rugProbability * 65.0) + (estImpactPct * 1.5) + 8.0);

    const expectedSlippagePct = Number(Math.max(0.4, estImpactPct * 1.1).toFixed(2));
    const rugProbabilityPct = Math.round(rugProbability * 100);
    const executionProbabilityPct = Math.round((1.0 - executionRisk) * 100);
    const confidencePct = Math.round((safety.safetyScore * 0.4) + (walletQuality * 30) + (holderGrowth * 30));

    return {
      opportunityScore,
      expectedReturnPct: Number(expectedReturnPct.toFixed(1)),
      expectedLossPct: Number(expectedLossPct.toFixed(1)),
      expectedSlippagePct,
      rugProbabilityPct,
      executionProbabilityPct,
      confidencePct,
      components,
    };
  }
}
