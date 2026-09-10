import test from 'node:test';
import assert from 'node:assert/strict';
import { EarlyEntryEngine, DEFAULT_ENTRY_POLICY, type EntryEvaluation } from '../src/trading/earlyEntryEngine.ts';
import { EarlyEntryEngine as LegacyEntryEngine } from './fixtures/legacyEarlyEntryEngine.ts';
import { createEntryExecutionGuard } from '../src/trading/entryExecutionGuard.ts';
import { DecisionAction } from '../src/types.ts';

const start = 100_000;
const tick = (seconds: number, price = 1 + seconds * .002, extra = {}) => ({
  timestamp: start + seconds * 1000, isBuy: true, tokenAmount: .4 / price, solAmount: .4,
  priceSol: price, priceUsd: 0, traderWallet: `wallet-${seconds % 8}`, isNewWallet: false, ...extra,
});
const input = (seconds: number, extra = {}) => ({ now: start + seconds * 1000,
  createdAt: start, inspectedAt: start + seconds * 1000, safetyApproved: true,
  safetyReasons: [], liquiditySol: 20, creator: 'creator', ...extra });
function cleanSignal() {
  const engine = new EarlyEntryEngine(1);
  let result!: EntryEvaluation;
  for (let i = 0; i <= 9; i++) { engine.record(tick(i), start + i * 1000); result = engine.evaluate(input(i)); }
  assert.equal(result.decision, DecisionAction.BUY);
  return { engine, result };
}

test('concurrent confirmation improves the same causal fixture without lowering any old evidence threshold', () => {
  const current = new EarlyEntryEngine(1), legacy = new LegacyEntryEngine(1);
  let currentAt: number | undefined, legacyAt: number | undefined;
  for (let i = 0; i <= 11; i++) {
    for (const engine of [current, legacy]) engine.record(tick(i), input(i).now);
    if (current.evaluate(input(i)).decision === DecisionAction.BUY) currentAt ??= i;
    if (legacy.evaluate(input(i)).decision === DecisionAction.BUY) legacyAt ??= i;
  }
  assert.equal(currentAt, 9);
  assert.equal(legacyAt, 11);
  assert.equal(DEFAULT_ENTRY_POLICY.minObservationMs, 8000);
  assert.equal(DEFAULT_ENTRY_POLICY.confirmationMs, 3000);
  assert.equal(DEFAULT_ENTRY_POLICY.minUniqueBuyers, 6);
  assert.ok(tick(currentAt!).priceSol < tick(legacyAt!).priceSol);
});

test('a timer cannot turn two seconds of confirmation into three', () => {
  const engine = new EarlyEntryEngine(1);
  for (let i = 0; i <= 8; i++) { engine.record(tick(i), input(i).now); engine.evaluate(input(i)); }
  assert.equal(engine.evaluate(input(9)).decision, DecisionAction.WAIT);
  engine.record(tick(9), input(9).now);
  assert.equal(engine.evaluate(input(9)).decision, DecisionAction.BUY);
});

test('a known spike latches EXPANSION even below the old 35% launch ceiling', () => {
  const engine = new EarlyEntryEngine(1);
  engine.record(tick(0), input(0).now);
  engine.record(tick(1, 1.13), input(1).now);
  assert.equal(engine.evaluate(input(1)).stage, 'EXPANSION');
  engine.record(tick(2, 1.10), input(2).now);
  assert.equal(engine.evaluate(input(2)).decision, DecisionAction.REJECT);
  engine.record(tick(3, 1.36), input(3).now);
  assert.equal(engine.evaluate(input(3)).stage, 'EXTENDED');
  engine.record(tick(4, 1.20), input(4).now);
  assert.equal(engine.evaluate(input(4)).stage, 'EXHAUSTED');
});

test('missing flow interval resets the observation and confirmation clocks', () => {
  const engine = new EarlyEntryEngine(1);
  for (let i = 0; i <= 8; i++) { engine.record(tick(i), input(i).now); engine.evaluate(input(i)); }
  engine.record(tick(12), input(12).now);
  assert.equal(engine.evaluate(input(12)).decision, DecisionAction.WAIT);
});

test('a clean pre-expansion pullback needs recovery and retained accumulation', () => {
  const engine = new EarlyEntryEngine(1);
  const prices = [1, 1.005, 1.01, 1.02, 1.03, 1.0, 1.006, 1.014, 1.02, 1.024, 1.025, 1.026, 1.027, 1.028];
  let result!: EntryEvaluation;
  for (let i = 0; i < prices.length; i++) {
    engine.record(tick(i, prices[i]), input(i).now);
    result = engine.evaluate(input(i));
    if (i === 5 || i === 6) assert.equal(result.decision, DecisionAction.WAIT);
  }
  assert.equal(result.entryStyle, 'PULLBACK_REACCUMULATION');
  assert.equal(result.decision, DecisionAction.BUY);
});

test('point-in-time liquidity/holder changes are measured, unknown quality is never invented', () => {
  const { engine } = cleanSignal();
  assert.equal(engine.recordInspection({ checkedAt: start + 8000, liquiditySol: 20, top1Pct: 5, holderCount: 20 }, start + 9000), true);
  assert.equal(engine.recordInspection({ checkedAt: start + 9000, liquiditySol: 21, top1Pct: 5, holderCount: 23 }, start + 9000), true);
  const result = engine.evaluate(input(9));
  assert.equal(result.holderGrowth, 3);
  assert.ok(Math.abs(result.liquidityChangePct! - 5) < 1e-8);
  assert.equal(result.qualityWalletEvidence, 'UNAVAILABLE');
  assert.equal(engine.recordInspection({ checkedAt: start + 10000, liquiditySol: 99, top1Pct: 0 }, start + 9000), false);
  engine.recordInspection({ checkedAt: start + 10000, liquiditySol: 17, top1Pct: 5 }, start + 10000);
  assert.match(engine.evaluate(input(10, { liquiditySol: 17 })).reasons.join(' '), /liquidity withdrawn/);
});

test('rising concentration and shrinking holder population cannot buy', () => {
  for (const changes of [{ top1Pct: 9, holderCount: 20 }, { top1Pct: 5, holderCount: 19 }]) {
    const { engine } = cleanSignal();
    engine.recordInspection({ checkedAt: start + 8000, liquiditySol: 20, top1Pct: 5, holderCount: 20 }, start + 9000);
    engine.recordInspection({ checkedAt: start + 9000, liquiditySol: 20, ...changes }, start + 9000);
    assert.equal(engine.evaluate(input(9)).decision, DecisionAction.WAIT);
  }
});

test('signal age is fixed at confirmation and cannot be renewed by continued buying', () => {
  const { engine, result } = cleanSignal();
  for (let i = 10; i <= 13; i++) engine.record(tick(i), input(i).now);
  const expired = engine.evaluate(input(13));
  assert.equal(expired.signalAt, result.signalAt);
  assert.equal(expired.stage, 'EXHAUSTED');
  assert.equal(expired.decision, DecisionAction.REJECT);
});

test('execution ceiling is tied to the confirmed price and accumulation, not just +35% launch runup', () => {
  const { result } = cleanSignal();
  const guard = createEntryExecutionGuard({ initialPriceSol: 1, evaluation: result, startedAt: input(9).now,
    now: () => input(9.5).now, validateSignal: () => {} });
  assert.ok(guard.maxEntryPriceSol < 1.04);
  assert.throws(() => guard.validateQuote!({ now: input(9.5).now, quoteFetchedAt: input(9.4).now,
    exitQuoteFetchedAt: input(9.5).now, worstEntryPriceSol: 1.1, roundTripCostPct: 1 }), /ceiling/);
  guard.validateQuote!({ now: input(9.5).now, quoteFetchedAt: input(9.4).now,
    exitQuoteFetchedAt: input(9.5).now, worstEntryPriceSol: 1.02, roundTripCostPct: 2 });
  guard.validate();
});

test('final signing rechecks latency, both quote ages, costs and signal state', () => {
  const { result } = cleanSignal();
  let now = input(9).now, signalOkay = true;
  const guard = createEntryExecutionGuard({ initialPriceSol: 1, evaluation: result, startedAt: now,
    now: () => now, validateSignal: () => { if (!signalOkay) throw new Error('signal invalid'); } });
  const quote = { now, quoteFetchedAt: now, exitQuoteFetchedAt: now, worstEntryPriceSol: 1.02, roundTripCostPct: 2 };
  assert.throws(() => guard.validate(), /evidence required/);
  assert.throws(() => guard.validateQuote!({ ...quote, roundTripCostPct: 5.01 }), /budget/);
  assert.throws(() => guard.validateQuote!({ ...quote, worstEntryPriceSol: NaN }), /missing or stale/);
  assert.throws(() => guard.validateQuote!({ ...quote, quoteFetchedAt: now + 1 }), /missing or stale/);
  guard.validateQuote!(quote);
  signalOkay = false;
  assert.throws(() => guard.validate(), /signal invalid/);
  signalOkay = true;
  now += 1501;
  assert.throws(() => guard.validate(), /quote missing or stale/);
  now = input(11.501).now;
  assert.throws(() => guard.validate(), /alpha expired/);
});

test('a drift-rejected confirmation cannot revive on a quick retracement', () => {
  const { engine, result } = cleanSignal();
  engine.record(tick(10, result.signalPriceSol! * 1.021), input(10).now);
  assert.equal(engine.evaluate(input(10)).stage, 'EXTENDED');
  engine.record(tick(11, result.signalPriceSol! * 1.015), input(11).now);
  assert.equal(engine.evaluate(input(11)).decision, DecisionAction.REJECT);
});

test('future evaluations cannot be rewound into an earlier buy', () => {
  const { engine } = cleanSignal();
  engine.record(tick(10), input(10).now);
  assert.equal(engine.evaluate(input(9)).decision, DecisionAction.REJECT);
});
