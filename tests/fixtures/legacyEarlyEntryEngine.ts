import { DecisionAction } from '../../src/types.ts';
import type { SwapTick } from '../../src/trading/microstructureEngine.ts';

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
}

export const DEFAULT_ENTRY_POLICY: EntryPolicy = {
  maxLaunchAgeMs: 120_000,
  maxDataAgeMs: 3_000,
  maxInspectionAgeMs: 15_000,
  minObservationMs: 8_000,
  confirmationMs: 3_000,
  minUniqueBuyers: 6,
  minNetFlowSol: 1,
  minBuyShare: 0.65,
  maxWalletVolumeShare: 0.35,
  maxRunupPct: 35,
  maxWindowRunupPct: 12,
  maxDrawdownPct: 10,
  minLiquiditySol: 3,
};

export type EntryStage = 'OBSERVING' | 'ACCUMULATING' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';
export interface EntryEvaluation {
  stage: EntryStage;
  decision: DecisionAction;
  reasons: string[];
  runupPct: number;
  uniqueBuyers: number;
  netFlowSol: number;
  buyShare: number;
  largestBuyerShare: number;
}

/** A causal gate, not a fitted return or win-probability model. */
export class EarlyEntryEngine {
  private confirmationStartedAt?: number;
  private terminal?: EntryEvaluation;
  private ticks: SwapTick[] = [];
  private firstTickAt?: number;
  private highPrice: number;
  private lastTickAt = 0;

  constructor(private initialPriceSol: number, private policy: EntryPolicy = DEFAULT_ENTRY_POLICY) {
    this.highPrice = initialPriceSol;
  }

  record(tick: SwapTick, now = Date.now()): boolean {
    if (!Number.isFinite(tick.timestamp) || tick.timestamp > now || tick.timestamp < this.lastTickAt ||
        !Number.isFinite(tick.priceSol) || tick.priceSol <= 0 ||
        !Number.isFinite(tick.solAmount) || tick.solAmount <= 0 ||
        !Number.isFinite(tick.tokenAmount) || tick.tokenAmount <= 0 || !tick.traderWallet) return false;
    this.lastTickAt = tick.timestamp;
    this.firstTickAt ??= tick.timestamp;
    this.highPrice = Math.max(this.highPrice, tick.priceSol);
    this.ticks.push(tick);
    this.ticks = this.ticks.filter(t => t.timestamp >= now - 30_000).slice(-5000);
    return true;
  }

  observePrice(priceSol: number): void {
    if (Number.isFinite(priceSol) && priceSol > 0) this.highPrice = Math.max(this.highPrice, priceSol);
  }

  invalidate(reason: string): void {
    this.terminal = this.result('REJECTED', DecisionAction.REJECT, [reason]);
  }

  evaluate(input: {
    now: number; createdAt?: number; inspectedAt?: number; safetyApproved: boolean;
    safetyReasons: string[]; liquiditySol: number; creator: string;
  }): EntryEvaluation {
    if (this.terminal) return this.terminal;
    const { now } = input;
    const recent = this.ticks.filter(t => t.timestamp <= now && t.timestamp >= now - 10_000);
    const last = recent.at(-1);
    const runupPct = last && this.initialPriceSol > 0 ? (last.priceSol / this.initialPriceSol - 1) * 100 : 0;
    const buys = recent.filter(t => t.isBuy);
    const buyVolume = buys.reduce((sum, t) => sum + t.solAmount, 0);
    const sellVolume = recent.filter(t => !t.isBuy).reduce((sum, t) => sum + t.solAmount, 0);
    const byBuyer = new Map<string, number>();
    for (const tick of buys) byBuyer.set(tick.traderWallet, (byBuyer.get(tick.traderWallet) || 0) + tick.solAmount);
    const metrics = {
      runupPct, uniqueBuyers: byBuyer.size, netFlowSol: buyVolume - sellVolume,
      buyShare: buyVolume + sellVolume > 0 ? buyVolume / (buyVolume + sellVolume) : 0,
      largestBuyerShare: buyVolume > 0 ? Math.max(0, ...byBuyer.values()) / buyVolume : 0,
    };
    const result = (stage: EntryStage, decision: DecisionAction, reasons: string[]) => ({ stage, decision, reasons, ...metrics });
    const reject = (reason: string, stage: EntryStage = 'REJECTED') => {
      this.terminal = result(stage, DecisionAction.REJECT, [reason]);
      return this.terminal;
    };
    if (input.createdAt !== undefined && (!Number.isFinite(input.createdAt) || input.createdAt > now)) return reject('Invalid launch timestamp');
    if (input.createdAt !== undefined && now - input.createdAt > this.policy.maxLaunchAgeMs) return reject('Launch has expired; do not chase', 'EXPIRED');
    if (this.initialPriceSol <= 0 || !Number.isFinite(this.initialPriceSol)) return reject('Missing launch price anchor');
    // Latch a missed expansion even after its price retraces.
    if ((this.highPrice / this.initialPriceSol - 1) * 100 > this.policy.maxRunupPct) return reject('Major expansion already observed; entry permanently skipped');
    if (this.ticks.some(t => !t.isBuy && t.traderWallet === input.creator)) return reject('Creator selling observed');
    if (last && (1 - last.priceSol / this.highPrice) * 100 > this.policy.maxDrawdownPct) return reject('Launch structure broke below its observed high');
    const wait = (reasons: string[]) => {
      this.confirmationStartedAt = undefined;
      return result('OBSERVING', DecisionAction.WAIT, reasons);
    };
    if (input.createdAt === undefined || !input.inspectedAt) return wait(['Waiting for verified on-chain launch and safety inspection']);
    if (now - input.inspectedAt > this.policy.maxInspectionAgeMs || input.inspectedAt > now) return wait(['Safety/liquidity inspection is stale']);
    if (!input.safetyApproved) return wait(input.safetyReasons.length ? input.safetyReasons : ['Safety checks have not passed']);
    if (!Number.isFinite(input.liquiditySol) || input.liquiditySol < this.policy.minLiquiditySol) return wait(['Insufficient verified real SOL reserves']);
    if (!last || now - last.timestamp > this.policy.maxDataAgeMs) return wait(['Trade flow missing or stale']);
    if (this.firstTickAt === undefined || now - this.firstTickAt < this.policy.minObservationMs) return wait(['Building an observed accumulation window']);
    if (metrics.uniqueBuyers < this.policy.minUniqueBuyers || metrics.netFlowSol < this.policy.minNetFlowSol ||
        metrics.buyShare < this.policy.minBuyShare || metrics.largestBuyerShare > this.policy.maxWalletVolumeShare) {
      return wait(['Waiting for distributed, sustained net buying']);
    }
    const windowRunup = recent[0].priceSol > 0 ? (last.priceSol / recent[0].priceSol - 1) * 100 : 0;
    if (windowRunup > this.policy.maxWindowRunupPct) return wait(['Short-window price spike; no momentum chasing']);
    const mid = now - 5_000;
    const earlier = recent.filter(t => t.timestamp < mid);
    const later = recent.filter(t => t.timestamp >= mid);
    const net = (ticks: SwapTick[]) => ticks.reduce((sum, t) => sum + (t.isBuy ? t.solAmount : -t.solAmount), 0);
    if (earlier.length === 0 || later.length === 0 || net(earlier) <= 0 || net(later) <= 0 || last.priceSol < recent[0].priceSol) {
      return wait(['Buying must persist across both windows while price holds']);
    }
    this.confirmationStartedAt ??= now;
    if (now - this.confirmationStartedAt < this.policy.confirmationMs) return result('ACCUMULATING', DecisionAction.WAIT, ['Clean accumulation observed; waiting for confirmation to persist']);
    return result('CONFIRMED', DecisionAction.BUY, ['Fresh launch, verified checks, distributed accumulation and sustained confirmation']);
  }

  private result(stage: EntryStage, decision: DecisionAction, reasons: string[]): EntryEvaluation {
    return { stage, decision, reasons, runupPct: 0, uniqueBuyers: 0, netFlowSol: 0, buyShare: 0, largestBuyerShare: 0 };
  }
}
