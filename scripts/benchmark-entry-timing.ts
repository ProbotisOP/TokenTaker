import { EarlyEntryEngine, DEFAULT_ENTRY_POLICY } from '../src/trading/earlyEntryEngine.ts';
import { EarlyEntryEngine as LegacyEntryEngine, DEFAULT_ENTRY_POLICY as LEGACY_POLICY } from '../tests/fixtures/legacyEarlyEntryEngine.ts';
import { DecisionAction } from '../src/types.ts';
import { createEntryExecutionGuard } from '../src/trading/entryExecutionGuard.ts';

const start = 100_000;
const current = new EarlyEntryEngine(1);
const baseline = new LegacyEntryEngine(1);
let firstCurrent: ReturnType<EarlyEntryEngine['evaluate']> | undefined;
let firstBaseline: { ageMs: number; price: number } | undefined;
for (let seconds = 0; seconds <= 11; seconds++) {
  const now = start + seconds * 1000;
  const price = 1 + seconds * .002;
  const tick = { timestamp: now, priceSol: price, priceUsd: 0, solAmount: .4, tokenAmount: .4 / price,
    isBuy: true, traderWallet: `wallet-${seconds % 8}`, isNewWallet: false };
  const input = { now, createdAt: start, inspectedAt: now, safetyApproved: true,
    safetyReasons: [], liquiditySol: 20, creator: 'creator' };
  current.record(tick, now); baseline.record(tick, now);
  const a = current.evaluate(input), b = baseline.evaluate(input);
  if (a.decision === DecisionAction.BUY) firstCurrent ??= a;
  if (b.decision === DecisionAction.BUY) firstBaseline ??= { ageMs: now - start, price };
}
if (!firstCurrent || !firstBaseline) throw new Error('Expected deterministic accumulation signals');
const now = firstCurrent.signalAt! + 500;
const guard = createEntryExecutionGuard({ initialPriceSol: 1, evaluation: firstCurrent,
  startedAt: firstCurrent.signalAt!, now: () => now, validateSignal() {} });
let rejectedExtendedQuote = false;
try {
  guard.validateQuote!({ now, quoteFetchedAt: now, exitQuoteFetchedAt: now, worstEntryPriceSol: 1.1, roundTripCostPct: 2 });
} catch { rejectedExtendedQuote = true; }
console.log(JSON.stringify({
  provenance: 'SYNTHETIC_FIXTURE', baselineCommit: '7a1bc7caf2c731f16a22695662adfa37b6ad0d23',
  purpose: 'Deterministic control-flow regression, not market history, fitted alpha or OOS performance',
  scenario: 'One 0.4 SOL buy/second, eight rotating buyers, fresh approved mock inspections, price +0.2% of launch/second',
  legacySafeguardsUnchanged: Object.entries(LEGACY_POLICY).every(([key, value]) => DEFAULT_ENTRY_POLICY[key as keyof typeof LEGACY_POLICY] === value),
  baseline: { signalAgeMs: firstBaseline.ageMs, observedPrice: firstBaseline.price, runupPct: (firstBaseline.price - 1) * 100 },
  candidate: { signalAgeMs: firstCurrent.signalAt! - start, observedPrice: firstCurrent.signalPriceSol, runupPct: firstCurrent.runupPct },
  signalTimingImprovementMs: firstBaseline.ageMs - (firstCurrent.signalAt! - start),
  executableCeiling: guard.maxEntryPriceSol, rejectedExtendedQuote,
  realTrades: 0, historicalLaunches: 0, netReturnImprovement: null,
}, null, 2));
