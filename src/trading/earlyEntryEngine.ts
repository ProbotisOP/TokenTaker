import { DecisionAction } from '../types.ts';
import type { SwapTick } from './microstructureEngine.ts';

export interface EntryPolicy {
  maxLaunchAgeMs: number;
  maxDataAgeMs: number;
  maxInspectionAgeMs: number;
  minObservationMs: number;
  confirmationMs: number;
  minUniqueBuyers: number;
  minNetFlowSol: number;
  minBuyShare: number;
  maxWalletVolumeShare: number;
  maxRunupPct: number;
  maxWindowRunupPct: number;
  maxDrawdownPct: number;
  minLiquiditySol: number;
  maxAnchorExtensionPct: number;
  maxSignalDriftPct: number;
  maxSignalAgeMs: number;
  maxExecutionLatencyMs: number;
  maxQuoteAgeMs: number;
  maxRoundTripCostPct: number;
  maxLiquidityDropPct: number;
  maxConcentrationIncreasePct: number;
  minRetainedBuyerShare: number;
  minPullbackPct: number;
  minPullbackRecovery: number;
  maxPriceAccelerationPct: number;
}

// Provisional guardrails, not fitted alpha. Existing evidence thresholds are unchanged.
export const DEFAULT_ENTRY_POLICY: EntryPolicy = {
  maxLaunchAgeMs: 120_000, maxDataAgeMs: 3_000, maxInspectionAgeMs: 15_000,
  minObservationMs: 8_000, confirmationMs: 3_000, minUniqueBuyers: 6,
  minNetFlowSol: 1, minBuyShare: 0.65, maxWalletVolumeShare: 0.35,
  maxRunupPct: 35, maxWindowRunupPct: 12, maxDrawdownPct: 10, minLiquiditySol: 3,
  maxAnchorExtensionPct: 5, maxSignalDriftPct: 2, maxSignalAgeMs: 3_000,
  maxExecutionLatencyMs: 2_500, maxQuoteAgeMs: 1_500, maxRoundTripCostPct: 5,
  maxLiquidityDropPct: 10, maxConcentrationIncreasePct: 3, minRetainedBuyerShare: 0.6,
  minPullbackPct: 2, minPullbackRecovery: 0.5, maxPriceAccelerationPct: 4,
};

export type EntryStage = 'EARLY_ACCUMULATION' | 'CONFIRMATION' | 'EXPANSION' | 'EXTENDED' | 'EXHAUSTED' | 'REJECTED' | 'EXPIRED';
export interface EntryEvaluation {
  stage: EntryStage;
  decision: DecisionAction;
  label: string;
  reasons: string[];
  runupPct: number;
  uniqueBuyers: number;
  netFlowSol: number;
  buyShare: number;
  largestBuyerShare: number;
  retainedBuyerShare: number;
  accumulationAnchorSol: number;
  anchorExtensionPct: number;
  windowRunupPct: number;
  priceAccelerationPct: number;
  volumeAcceleration: number | null;
  liquidityChangePct: number | null;
  holderGrowth: number | null;
  concentrationChangePct: number | null;
  qualityWalletEvidence: 'UNAVAILABLE';
  launchAgeMs: number | null;
  signalAt?: number;
  signalPriceSol?: number;
  signalAnchorSol?: number;
  entryStyle: 'INITIAL_ACCUMULATION' | 'PULLBACK_REACCUMULATION';
}
export interface EntryInput {
  now: number; createdAt?: number; inspectedAt?: number; safetyApproved: boolean;
  safetyReasons: string[]; liquiditySol: number; creator: string;
}
export interface EntryInspection {
  checkedAt: number; liquiditySol: number; top1Pct: number; holderCount?: number;
}

const change = (last: number, first: number) => first > 0 ? (last / first - 1) * 100 : 0;
const net = (ticks: SwapTick[]) => ticks.reduce((sum, t) => sum + (t.isBuy ? t.solAmount : -t.solAmount), 0);
const volume = (ticks: SwapTick[]) => ticks.reduce((sum, t) => sum + t.solAmount, 0);

/** Receipt-time causal evidence gate. BUY is a setup, not a calibrated return forecast. */
export class EarlyEntryEngine {
  private confirmationStartedAt?: number;
  private signal?: { at: number; priceSol: number; anchorSol: number };
  private invalidReason?: string;
  private blockedPhase?: 'EXPANSION' | 'EXTENDED' | 'EXHAUSTED';
  private ticks: SwapTick[] = [];
  private inspections: EntryInspection[] = [];
  private firstTickAt?: number;
  private highPrice: number;
  private sellers = new Set<string>();
  private lastEvaluationAt = -Infinity;
  private lastTickAt = -Infinity;
  private pullback?: { high: number; low: number };

  constructor(private initialPriceSol: number, private policy: EntryPolicy = DEFAULT_ENTRY_POLICY) {
    this.highPrice = initialPriceSol;
  }

  record(tick: SwapTick, now = Date.now()): boolean {
    if (!Number.isFinite(now) || !Number.isFinite(tick.timestamp) || tick.timestamp > now || tick.timestamp < this.lastTickAt ||
        typeof tick.isBuy !== 'boolean' || !Number.isFinite(tick.priceSol) || tick.priceSol <= 0 ||
        !Number.isFinite(tick.solAmount) || tick.solAmount <= 0 ||
        !Number.isFinite(tick.tokenAmount) || tick.tokenAmount <= 0 || !tick.traderWallet) return false;
    if (tick.timestamp - this.lastTickAt > this.policy.maxDataAgeMs) {
      this.confirmationStartedAt = undefined;
      this.firstTickAt = tick.timestamp;
      this.ticks = [];
    }
    this.lastTickAt = tick.timestamp;
    this.firstTickAt ??= tick.timestamp;
    this.highPrice = Math.max(this.highPrice, tick.priceSol);
    if ((1 - tick.priceSol / this.highPrice) * 100 >= this.policy.minPullbackPct) {
      this.pullback ??= { high: this.highPrice, low: tick.priceSol };
      this.pullback.low = Math.min(this.pullback.low, tick.priceSol);
    }
    if (!tick.isBuy) {
      this.sellers.add(tick.traderWallet);
      if (this.sellers.size > 5000) this.invalidate('Seller history capacity exhausted');
    }
    this.ticks.push({ ...tick });
    this.ticks = this.ticks.filter(t => t.timestamp >= now - 30_000).slice(-5000);
    const baseline = this.ticks.find(t => t.timestamp >= tick.timestamp - 10_000);
    if (baseline && change(tick.priceSol, baseline.priceSol) > this.policy.maxWindowRunupPct) this.blockedPhase ??= 'EXPANSION';
    if ((1 - tick.priceSol / this.highPrice) * 100 > this.policy.maxDrawdownPct) this.blockedPhase = 'EXHAUSTED';
    return true;
  }

  observePrice(priceSol: number): void {
    if (Number.isFinite(priceSol) && priceSol > 0) this.highPrice = Math.max(this.highPrice, priceSol);
  }

  recordInspection(inspection: EntryInspection, now = Date.now()): boolean {
    if (![inspection.checkedAt, inspection.liquiditySol, inspection.top1Pct].every(Number.isFinite) ||
        inspection.checkedAt > now || inspection.checkedAt <= (this.inspections.at(-1)?.checkedAt ?? -Infinity) ||
        inspection.liquiditySol < 0 || inspection.top1Pct < 0 || inspection.top1Pct > 100 ||
        (inspection.holderCount !== undefined && (!Number.isInteger(inspection.holderCount) || inspection.holderCount < 0))) return false;
    const peakLiquidity = Math.max(0, ...this.inspections.filter(i => inspection.checkedAt - i.checkedAt <= this.policy.maxInspectionAgeMs).map(i => i.liquiditySol));
    if (peakLiquidity > 0 && change(inspection.liquiditySol, peakLiquidity) < -this.policy.maxLiquidityDropPct) this.invalidate('Verified liquidity withdrawn during setup');
    this.inspections.push({ ...inspection });
    this.inspections = this.inspections.slice(-30);
    return true;
  }

  invalidate(reason: string): void { this.invalidReason = reason; }

  evaluate(input: EntryInput): EntryEvaluation {
    const { now } = input;
    if (now < this.lastEvaluationAt || now < this.lastTickAt) this.invalidate('Cannot evaluate before already observed evidence');
    this.lastEvaluationAt = now;
    const recent = this.ticks.filter(t => t.timestamp <= now && t.timestamp >= now - 10_000);
    const last = recent.at(-1);
    const buys = recent.filter(t => t.isBuy);
    const buyVolume = volume(buys);
    const sellVolume = volume(recent.filter(t => !t.isBuy));
    const byBuyer = new Map<string, number>();
    const balances = new Map<string, number>();
    for (const tick of recent) {
      if (tick.isBuy) byBuyer.set(tick.traderWallet, (byBuyer.get(tick.traderWallet) || 0) + tick.solAmount);
      balances.set(tick.traderWallet, (balances.get(tick.traderWallet) || 0) + (tick.isBuy ? tick.tokenAmount : -tick.tokenAmount));
    }
    const earlier = recent.filter(t => t.timestamp < now - 5_000);
    const later = recent.filter(t => t.timestamp >= now - 5_000);
    const earlierReturn = earlier.length > 1 ? change(earlier.at(-1)!.priceSol, earlier[0].priceSol) : 0;
    const laterReturn = later.length > 1 ? change(later.at(-1)!.priceSol, later[0].priceSol) : 0;
    // Weight marginal price marks by SOL flow; provider token amounts need not be marginal-price fills.
    const accumulationAnchorSol = buyVolume > 0 ? buys.reduce((sum, t) => sum + t.priceSol * t.solAmount, 0) / buyVolume : 0;
    const marks = this.inspections.filter(i => i.checkedAt <= now && now - i.checkedAt <= this.policy.maxInspectionAgeMs);
    const firstInspection = marks[0];
    const latestInspection = marks.at(-1);
    const hasChanges = marks.length >= 2;
    const metrics = {
      runupPct: last ? change(last.priceSol, this.initialPriceSol) : 0,
      uniqueBuyers: byBuyer.size, netFlowSol: buyVolume - sellVolume,
      buyShare: buyVolume + sellVolume > 0 ? buyVolume / (buyVolume + sellVolume) : 0,
      largestBuyerShare: buyVolume > 0 ? Math.max(0, ...byBuyer.values()) / buyVolume : 0,
      retainedBuyerShare: byBuyer.size ? [...byBuyer.keys()].filter(w => (balances.get(w) ?? 0) > 0).length / byBuyer.size : 0,
      accumulationAnchorSol, anchorExtensionPct: last ? change(last.priceSol, accumulationAnchorSol) : 0,
      windowRunupPct: last ? change(last.priceSol, recent[0].priceSol) : 0,
      priceAccelerationPct: laterReturn - earlierReturn,
      volumeAcceleration: volume(earlier) > 0 ? volume(later) / volume(earlier) : null,
      liquidityChangePct: hasChanges ? change(latestInspection!.liquiditySol, firstInspection!.liquiditySol) : null,
      holderGrowth: hasChanges && firstInspection!.holderCount !== undefined && latestInspection!.holderCount !== undefined
        ? latestInspection!.holderCount - firstInspection!.holderCount : null,
      concentrationChangePct: hasChanges ? latestInspection!.top1Pct - firstInspection!.top1Pct : null,
      qualityWalletEvidence: 'UNAVAILABLE' as const,
      launchAgeMs: input.createdAt === undefined ? null : now - input.createdAt,
      entryStyle: this.pullback ? 'PULLBACK_REACCUMULATION' as const : 'INITIAL_ACCUMULATION' as const,
    };
    const result = (stage: EntryStage, decision: DecisionAction, reasons: string[]): EntryEvaluation => ({
      stage, decision, reasons, ...metrics, signalAt: this.signal?.at, signalPriceSol: this.signal?.priceSol, signalAnchorSol: this.signal?.anchorSol,
      label: decision === DecisionAction.BUY ? 'BUY — CLEAN EARLY ENTRY' : decision === DecisionAction.WAIT
        ? 'WAIT — EARLY SETUP, NEED CONFIRMATION' : ['EXTENDED', 'EXPANSION'].includes(stage) ? 'REJECT — TOO EXTENDED' : `REJECT — ${stage}`,
    });
    const wait = (reason: string, stage: EntryStage = 'EARLY_ACCUMULATION') => {
      this.confirmationStartedAt = undefined;
      return result(stage, DecisionAction.WAIT, [reason]);
    };
    if (this.invalidReason) return result('REJECTED', DecisionAction.REJECT, [this.invalidReason]);
    if (!Number.isFinite(now) || (input.createdAt !== undefined && (!Number.isFinite(input.createdAt) || input.createdAt > now))) {
      this.invalidate('Invalid launch/evaluation timestamp');
      return result('REJECTED', DecisionAction.REJECT, [this.invalidReason!]);
    }
    if (input.createdAt !== undefined && now - input.createdAt > this.policy.maxLaunchAgeMs) return result('EXPIRED', DecisionAction.REJECT, ['Launch expired; alpha window closed']);
    if (!(this.initialPriceSol > 0) || !Number.isFinite(this.initialPriceSol)) return result('REJECTED', DecisionAction.REJECT, ['Missing launch price anchor']);
    if (this.blockedPhase !== 'EXHAUSTED' && change(this.highPrice, this.initialPriceSol) > this.policy.maxRunupPct) this.blockedPhase = 'EXTENDED';
    if (metrics.priceAccelerationPct > this.policy.maxPriceAccelerationPct && laterReturn > this.policy.maxPriceAccelerationPct) this.blockedPhase ??= 'EXPANSION';
    if (this.blockedPhase) return result(this.blockedPhase, DecisionAction.REJECT, ['Expansion or broken price structure observed; permanently skip, including retracements']);
    if (this.sellers.has(input.creator)) {
      this.invalidate('Creator selling observed');
      return result('REJECTED', DecisionAction.REJECT, [this.invalidReason!]);
    }
    if (input.createdAt === undefined || !Number.isFinite(input.inspectedAt)) return wait('Waiting for verified on-chain launch and safety inspection');
    if (now - input.inspectedAt! > this.policy.maxInspectionAgeMs || input.inspectedAt! > now) return wait('Safety/liquidity inspection is stale');
    if (!input.safetyApproved) return wait(input.safetyReasons.join('; ') || 'Safety checks have not passed');
    if (!Number.isFinite(input.liquiditySol) || input.liquiditySol < this.policy.minLiquiditySol) return wait('Insufficient verified real SOL reserves');
    if (metrics.liquidityChangePct !== null && metrics.liquidityChangePct < -this.policy.maxLiquidityDropPct) {
      this.invalidate('Verified liquidity withdrawn during setup');
      return result('REJECTED', DecisionAction.REJECT, [this.invalidReason!]);
    }
    if (metrics.concentrationChangePct !== null && metrics.concentrationChangePct > this.policy.maxConcentrationIncreasePct) return wait('Holder concentration is increasing');
    if (metrics.holderGrowth !== null && metrics.holderGrowth < 0) return wait('Verified holder population is shrinking');
    if (!last || now - last.timestamp > this.policy.maxDataAgeMs) return wait('Trade flow missing or stale');
    if (metrics.uniqueBuyers < this.policy.minUniqueBuyers || metrics.netFlowSol < this.policy.minNetFlowSol ||
        metrics.buyShare < this.policy.minBuyShare || metrics.largestBuyerShare > this.policy.maxWalletVolumeShare ||
        metrics.retainedBuyerShare < this.policy.minRetainedBuyerShare) return wait('Waiting for distributed, retained net buying');
    if (!earlier.length || !later.length || net(earlier) <= 0 || net(later) <= 0) return wait('Buying must persist across both flow windows');
    const pullbackRecovered = this.pullback && last.priceSol >= this.pullback.low + (this.pullback.high - this.pullback.low) * this.policy.minPullbackRecovery && laterReturn >= 0;
    if (this.pullback && !pullbackRecovered) return wait('Early pullback needs price recovery and renewed accumulation');
    if (!pullbackRecovered && last.priceSol < recent[0].priceSol) return wait('Accumulation price structure is not holding');
    if (metrics.anchorExtensionPct > this.policy.maxAnchorExtensionPct) return wait('Price is too far above the observed accumulation price');
    // Count concurrent evidence, not observation time plus another blind timer. Only new trades advance confirmation.
    this.confirmationStartedAt ??= last.timestamp;
    if (this.firstTickAt === undefined || last.timestamp - this.firstTickAt < this.policy.minObservationMs ||
        last.timestamp - this.confirmationStartedAt < this.policy.confirmationMs) return result('CONFIRMATION', DecisionAction.WAIT, ['Clean accumulation; observation and trade-backed confirmation still in progress']);
    this.signal ??= { at: last.timestamp, priceSol: last.priceSol, anchorSol: accumulationAnchorSol };
    if (now - this.signal.at > this.policy.maxSignalAgeMs) return result('EXHAUSTED', DecisionAction.REJECT, ['Confirmed entry window expired; do not renew a stale signal']);
    if (last.priceSol > this.signal.priceSol * (1 + this.policy.maxSignalDriftPct / 100)) {
      this.blockedPhase = 'EXTENDED';
      return result('EXTENDED', DecisionAction.REJECT, ['Price moved beyond the confirmed entry; do not chase']);
    }
    return result('CONFIRMATION', DecisionAction.BUY, ['Distributed accumulation confirmed before expansion; executable price, costs and latency must still pass']);
  }
}
