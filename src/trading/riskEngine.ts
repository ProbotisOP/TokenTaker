import { OpportunityScoreOutput, PortfolioState, RiskLimits, TokenSafetyReport } from '../types.ts';
import { solToLamports, lamportsToSol } from './decimalSafeUtils.ts';

export interface SizingInput {
  portfolio: PortfolioState;
  opportunity: OpportunityScoreOutput;
  safety: TokenSafetyReport;
  liquiditySol: number;
  openPositionsCount: number;
  currentExposureSol: number;
  riskLimits: RiskLimits;
  exitabilityScore?: number;
  gasReserveSol?: number;
  minTradeSizeSol?: number;
  targetTradeSizeSol?: number;
}

export interface RiskEvaluationResult {
  approved: boolean;
  rejectReasons: string[];
  recommendedSizeSol: number;
  maxAllowableLossSol: number;
  stopLossPriceMultiplier: number;
  adaptiveMultiplier: number;
  calibratedWinProb?: number;
  calibratedPayoffRatio?: number;
  calibratedKellyPct?: number;
}

export class RiskEngine {
  public static evaluateAndSize(input: SizingInput): RiskEvaluationResult {
    const { portfolio: p, opportunity: o, riskLimits: r } = input;
    const reserve = input.gasReserveSol ?? 0.025;
    const minimum = input.minTradeSizeSol ?? 0.01;
    const target = input.targetTradeSizeSol ?? 0.02;
    const exitability = input.exitabilityScore ?? 80;
    const reasons: string[] = [];
    const values = [p.cashSol, p.equitySol, p.dailyRealizedPnlSol, p.consecutiveLosses,
      input.liquiditySol, input.openPositionsCount, input.currentExposureSol, o.expectedSlippagePct,
      r.maxPositionPercent, r.maxTokenExposurePercent, r.maxTradeLossSol, r.maxDailyLossSol,
      r.maxOpenPositions, r.maxConsecutiveLosses, r.maxSlippagePercent, reserve, minimum, target, exitability];
    if (values.some(v => !Number.isFinite(v)) || values.some((v, i) => i !== 2 && v < 0) ||
        minimum <= 0 || target <= 0 || r.maxPositionPercent > 1 || r.maxTokenExposurePercent > 1) {
      reasons.push('INVALID RISK INPUT: finite, nonnegative values and fractional exposure limits required');
    }
    if (r.circuitBreakerActive) reasons.push('CIRCUIT BREAKER: Trading halted');
    if (p.consecutiveLosses >= r.maxConsecutiveLosses) reasons.push('CONSECUTIVE LOSS LIMIT');
    if (p.dailyRealizedPnlSol <= -r.maxDailyLossSol) reasons.push('DAILY LOSS LIMIT');
    if (input.openPositionsCount >= r.maxOpenPositions) reasons.push('CONCURRENCY LIMIT');
    if (o.expectedSlippagePct > r.maxSlippagePercent) reasons.push('EXCESSIVE SLIPPAGE');
    if (exitability < 50) reasons.push('ILLIQUID EXITABILITY');

    // Configured sizing only. Synthetic score bins are not empirical Kelly estimates.
    const adaptiveMultiplier = Math.max(0.4, 1 - p.consecutiveLosses * 0.25);
    const cap = Math.min(
      target * adaptiveMultiplier,
      p.cashSol - reserve,
      p.equitySol * r.maxPositionPercent,
      p.equitySol * r.maxTokenExposurePercent - input.currentExposureSol,
      input.liquiditySol * 0.02,
      r.maxTradeLossSol / 0.15,
      Math.max(0, r.maxDailyLossSol + Math.min(0, p.dailyRealizedPnlSol)) / 0.15,
    );
    const size = Number.isFinite(cap) && cap > 0 ? lamportsToSol(solToLamports(cap)) : 0;
    if (size < minimum || size <= 0) reasons.push('SIZING FLOOR: minimum exceeds a hard capital, exposure, liquidity or loss cap');
    return {
      approved: reasons.length === 0,
      rejectReasons: reasons,
      recommendedSizeSol: reasons.length ? 0 : size,
      maxAllowableLossSol: reasons.length ? 0 : size * 0.15,
      stopLossPriceMultiplier: 0.85,
      adaptiveMultiplier: Number.isFinite(adaptiveMultiplier) ? adaptiveMultiplier : 0.4,
    };
  }
}
