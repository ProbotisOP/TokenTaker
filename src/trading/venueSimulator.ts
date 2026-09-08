/**
 * Strictly Causal Venue-Specific Execution Simulator
 * 
 * Rules:
 * 1. Strictly causal: No future pool state may influence a historical fill.
 * 2. Venue-specific mechanics:
 *    - Pump.fun: Virtual bonding curve invariant (x * y = k), reserve state at (t0 + dt).
 *    - Raydium CPMM / AMM v4: Constant product (x + dx)(y - dy) = k with swap fees (0.25%/0.30%) and creator LP lock check.
 *    - Meteora DLMM: Discrete liquidity bins, volatility fee tiers (0.15% - 1.5%), bin depletion jumps.
 * 3. Models queue position, adverse selection from competing snipers, entry latency, and exitability.
 */

import { LaunchVenue } from '../types.ts';

export interface SimulatedPoolState {
  venue: LaunchVenue;
  baseReserve: number; // Token supply in pool
  quoteReserveSol: number; // SOL liquidity in pool
  virtualSolOffset?: number; // Pump.fun virtual SOL reserve (~30 SOL)
  virtualTokenOffset?: number; // Pump.fun virtual token reserve
  swapFeePct: number; // 0.25% - 1.0%
  creatorLpBurnedOrLocked: boolean;
  activeBinPriceSol?: number; // Meteora DLMM
  binStepBps?: number; // Meteora DLMM
}

export interface CausalExecutionOrder {
  venue: LaunchVenue;
  orderSizeSol: number;
  expectedPriceSol: number;
  latencyMs: number; // Total detection-to-block flight delay
  priorityFeeMicroLamports: number;
  jitoTipSol: number;
  slippageLimitPct: number;
  competitorSniperCount: number; // Competing orders in same block
}

export interface CausalExecutionResult {
  executed: boolean;
  revertReason?: string;
  fillPriceSol: number;
  realizedSlippagePct: number;
  adverseSelectionPct: number; // Price displacement caused by faster competitor snipers
  totalCostSol: number; // Size + Network Fee + Priority Fee + Jito Tip
  feesPaidSol: number;
  fillTokens: number;
  exitabilityScore: number; // 0-100: capacity to exit this position safely
  estimatedExitDragPct: number; // Expected round-trip exit friction
}

export class VenueSimulator {
  /**
   * Computes causal fill state at arrival time (t0 + latencyMs)
   */
  public static simulateFill(
    initialPool: SimulatedPoolState,
    order: CausalExecutionOrder
  ): CausalExecutionResult {
    const networkBaseFeeSol = 0.000005;
    const priorityFeeSol = (order.priorityFeeMicroLamports * 200_000) / 1e15;
    const totalFeesSol = networkBaseFeeSol + priorityFeeSol + order.jitoTipSol;

    // 1. Model Competitor Arrival & Adverse Selection in block
    // Snipers with higher tips land earlier in the slot.
    // Higher competitor count + higher latency = higher probability of being frontrun
    const competitorVolumeSol = this.estimateCompetitorDisplacement(
      order.latencyMs,
      order.competitorSniperCount,
      order.jitoTipSol
    );

    // 2. Venue-Specific State Mutation at (t0 + latency)
    let fillPriceSol: number;
    let adverseSelectionPct: number = 0;
    let basePriceSol = order.expectedPriceSol;

    switch (order.venue) {
      case LaunchVenue.PUMPFUN: {
        // Pump.fun Virtual Bonding Curve
        // x * y = k, Virtual SOL ~30, Virtual Token ~1,073,000,000
        const vSol = (initialPool.quoteReserveSol || 30.0) + (initialPool.virtualSolOffset || 30.0);
        const vToken = (initialPool.baseReserve || 1_000_000_000) + (initialPool.virtualTokenOffset || 1_073_000_000);
        const k = vSol * vToken;

        // Apply competitor volume that landed strictly BEFORE us
        const preFillSol = vSol + competitorVolumeSol;
        const preFillTokens = k / preFillSol;
        const displacedPrice = preFillSol / preFillTokens;

        adverseSelectionPct = Math.max(0, ((displacedPrice - basePriceSol) / basePriceSol) * 100);

        // Now execute our order through the bonding curve
        const postFillSol = preFillSol + order.orderSizeSol;
        const postFillTokens = k / postFillSol;
        const tokensReceived = preFillTokens - postFillTokens;

        fillPriceSol = tokensReceived > 0 ? order.orderSizeSol / tokensReceived : displacedPrice;
        break;
      }

      case LaunchVenue.METEORA_DLMM: {
        // Bin-based concentrated liquidity
        const volatilityFee = initialPool.swapFeePct || 0.008; // 0.8% typical in dynamic memecoin DLMM
        const binStep = (initialPool.binStepBps || 25) / 10_000;
        
        // Competitor volume pushes price across N bins
        const binsDisplaced = Math.floor(competitorVolumeSol / Math.max(1.0, initialPool.quoteReserveSol * 0.05));
        const displacedBase = basePriceSol * Math.pow(1 + binStep, binsDisplaced);
        adverseSelectionPct = ((displacedBase - basePriceSol) / basePriceSol) * 100;

        // Our fill impact inside DLMM active bins
        const impactRatio = order.orderSizeSol / Math.max(2.0, initialPool.quoteReserveSol * 0.1);
        const additionalBins = Math.floor(impactRatio);
        fillPriceSol = displacedBase * Math.pow(1 + binStep, additionalBins) * (1 + volatilityFee);
        break;
      }

      case LaunchVenue.RAYDIUM_CPMM:
      case LaunchVenue.RAYDIUM_AMM_V4:
      default: {
        // Standard Constant Product AMM (x * y = k)
        const feeMultiplier = 1 - (initialPool.swapFeePct || 0.0025);
        const solReserve = initialPool.quoteReserveSol;
        const tokenReserve = initialPool.baseReserve;
        const k = solReserve * tokenReserve;

        // Pre-arrival competitor displacement
        const preSol = solReserve + (competitorVolumeSol * feeMultiplier);
        const preTokens = k / preSol;
        const displacedPrice = preSol / preTokens;
        adverseSelectionPct = Math.max(0, ((displacedPrice - basePriceSol) / basePriceSol) * 100);

        // Our swap fill
        const postSol = preSol + (order.orderSizeSol * feeMultiplier);
        const postTokens = k / postSol;
        const tokensReceived = preTokens - postTokens;
        fillPriceSol = tokensReceived > 0 ? order.orderSizeSol / tokensReceived : displacedPrice;
        break;
      }
    }

    // 3. Slippage & Limit Verification
    const realizedSlippagePct = Math.max(0, ((fillPriceSol - basePriceSol) / basePriceSol) * 100);

    if (realizedSlippagePct > order.slippageLimitPct) {
      // Order reverts at RPC / validator stage due to slippage violation
      // Network base fee is still consumed by transaction attempt
      return {
        executed: false,
        revertReason: `Slippage exceeded limit: realized ${realizedSlippagePct.toFixed(2)}% > tolerance ${order.slippageLimitPct.toFixed(2)}% (Adverse displacement: ${adverseSelectionPct.toFixed(2)}%)`,
        fillPriceSol: 0,
        realizedSlippagePct,
        adverseSelectionPct,
        totalCostSol: totalFeesSol,
        feesPaidSol: totalFeesSol,
        fillTokens: 0,
        exitabilityScore: 0,
        estimatedExitDragPct: 0,
      };
    }

    // 4. Causal Exitability Assessment
    // Can we actually exit this trade given pool depth and contract permissions?
    const exitability = this.calculateExitability(initialPool, order.orderSizeSol);
    const estimatedExitDragPct = this.estimateRoundTripExitDrag(initialPool, order.orderSizeSol, exitability);

    const fillTokens = Math.floor(order.orderSizeSol / fillPriceSol);

    return {
      executed: true,
      fillPriceSol,
      realizedSlippagePct,
      adverseSelectionPct,
      totalCostSol: order.orderSizeSol + totalFeesSol,
      feesPaidSol: totalFeesSol,
      fillTokens,
      exitabilityScore: exitability,
      estimatedExitDragPct,
    };
  }

  /**
   * Computes competitor volume landing ahead of us in the same block
   */
  private static estimateCompetitorDisplacement(
    latencyMs: number,
    competitorSniperCount: number,
    jitoTipSol: number
  ): number {
    if (competitorSniperCount <= 0) return 0;

    // Tip competition: Jito tip >= 0.003 SOL wins leader priority in ~80% of blocks
    const tipAdvantage = Math.min(1.0, jitoTipSol / 0.003);
    const effectiveSnipersAhead = Math.max(0, competitorSniperCount * (1 - tipAdvantage * 0.7));

    // Latency factor: for every 100ms delay, competitor fill probability increases
    const latencyPenalty = Math.max(0, (latencyMs - 120) / 300);
    const snipersWhoBeatUs = effectiveSnipersAhead * (0.3 + latencyPenalty * 0.7);

    // Each competing sniper buys average 0.3 - 0.8 SOL
    return snipersWhoBeatUs * 0.45;
  }

  /**
   * Calculates independent Exitability Score (0 - 100)
   */
  public static calculateExitability(pool: SimulatedPoolState, positionSizeSol: number): number {
    // 1. Ratio of position size to pool liquidity
    const depthRatio = positionSizeSol / Math.max(0.5, pool.quoteReserveSol);
    let depthScore = 100;
    if (depthRatio > 0.10) depthScore = 20; // Selling >10% of pool crashes price
    else if (depthRatio > 0.05) depthScore = 50;
    else if (depthRatio > 0.02) depthScore = 75;
    else depthScore = 95;

    // 2. LP Lock & Authority
    const lpFactor = pool.creatorLpBurnedOrLocked ? 1.0 : 0.25;

    // 3. Venue mechanics: Pump.fun has guaranteed bonding curve exitability before graduation
    const venueFactor = pool.venue === LaunchVenue.PUMPFUN ? 1.0 : 0.9;

    return Math.round(Math.min(100, Math.max(0, depthScore * lpFactor * venueFactor)));
  }

  /**
   * Estimates round-trip exit drag (price impact + swap fee on exit)
   */
  public static estimateRoundTripExitDrag(
    pool: SimulatedPoolState,
    positionSizeSol: number,
    exitabilityScore: number
  ): number {
    const exitPriceImpact = (positionSizeSol / Math.max(1.0, pool.quoteReserveSol)) * 100;
    const exitSwapFee = (pool.swapFeePct || 0.003) * 100;
    const illiquidityPenalty = exitabilityScore < 60 ? (60 - exitabilityScore) * 0.5 : 0;
    return Number((exitPriceImpact + exitSwapFee + illiquidityPenalty).toFixed(2));
  }
}
