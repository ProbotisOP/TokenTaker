import test from 'node:test';
import assert from 'node:assert/strict';
import { EarlyEntryEngine } from '../src/trading/earlyEntryEngine.ts';
import { DecisionAction } from '../src/types.ts';

const start = 100_000;
const tick = (seconds: number, overrides = {}) => ({
  timestamp: start + seconds * 1000, isBuy: true, tokenAmount: 10, solAmount: 0.4,
  priceSol: 1 + seconds * 0.002, priceUsd: 0, traderWallet: `wallet-${seconds % 8}`, isNewWallet: false, ...overrides,
});
const evaluate = (engine: EarlyEntryEngine, seconds: number, overrides = {}) => engine.evaluate({
  now: start + seconds * 1000, createdAt: start, inspectedAt: start + seconds * 1000,
  safetyApproved: true, safetyReasons: [], liquiditySol: 20, creator: 'creator', ...overrides,
});
const accumulate = (engine: EarlyEntryEngine, until: number, overrides = {}) => {
  let result = evaluate(engine, 0);
  for (let i = 0; i <= until; i++) { engine.record(tick(i, overrides), start + i * 1000); result = evaluate(engine, i); }
  return result;
};

test('fresh detection is WAIT, not an immediate buy', () => {
  assert.equal(evaluate(new EarlyEntryEngine(1), 0).decision, DecisionAction.WAIT);
});
test('distributed accumulation confirms before expansion', () => {
  const engine = new EarlyEntryEngine(1);
  assert.equal(accumulate(engine, 8).stage, 'CONFIRMATION');
  let result;
  for (let i = 9; i <= 11; i++) { engine.record(tick(i), start + i * 1000); result = evaluate(engine, i); }
  assert.equal(result!.stage, 'CONFIRMATION');
  assert.ok(result!.runupPct < 3);
});
test('unknown safety or creation time cannot approve', () => {
  const engine = new EarlyEntryEngine(1);
  accumulate(engine, 11);
  assert.equal(evaluate(engine, 11, { createdAt: undefined }).decision, DecisionAction.WAIT);
  assert.equal(evaluate(engine, 11, { safetyApproved: false, safetyReasons: ['Unknown holders'] }).decision, DecisionAction.WAIT);
  assert.equal(evaluate(engine, 11, { inspectedAt: start - 10_000 }).decision, DecisionAction.WAIT);
});
test('one wallet cannot manufacture independent accumulation', () => {
  assert.notEqual(accumulate(new EarlyEntryEngine(1), 15, { traderWallet: 'one-wallet' }).decision, DecisionAction.BUY);
});
test('stale flow resets confirmation and cannot buy from a timer', () => {
  const engine = new EarlyEntryEngine(1);
  accumulate(engine, 8);
  assert.equal(evaluate(engine, 12).stage, 'EARLY_ACCUMULATION');
  engine.record(tick(13), start + 13_000);
  assert.notEqual(evaluate(engine, 13).decision, DecisionAction.BUY);
});
test('known old launches expire even with attractive flow', () => {
  const engine = new EarlyEntryEngine(1);
  accumulate(engine, 11);
  assert.equal(evaluate(engine, 11, { createdAt: start - 120_000 }).stage, 'EXPIRED');
});
test('expansion is latched and cannot become a dip-buy after retracement', () => {
  const engine = new EarlyEntryEngine(1);
  engine.record(tick(0, { priceSol: 1.4 }), start);
  assert.equal(evaluate(engine, 0).decision, DecisionAction.REJECT);
  assert.equal(accumulate(engine, 15).decision, DecisionAction.REJECT);
});
test('creator distribution and stream gaps permanently invalidate', () => {
  const engine = new EarlyEntryEngine(1);
  accumulate(engine, 11);
  engine.record(tick(12, { traderWallet: 'creator', isBuy: false }), start + 12_000);
  assert.equal(evaluate(engine, 12).decision, DecisionAction.REJECT);
  const gap = new EarlyEntryEngine(1);
  accumulate(gap, 11);
  gap.invalidate('Stream disconnected');
  assert.equal(evaluate(gap, 11).decision, DecisionAction.REJECT);
});
test('future, out-of-order, zero and NaN ticks cannot affect confirmation', () => {
  const engine = new EarlyEntryEngine(1);
  assert.equal(engine.record(tick(1), start), false);
  assert.equal(engine.record(tick(1), start + 1000), true);
  assert.equal(engine.record(tick(0), start + 1000), false);
  assert.equal(engine.record(tick(2, { solAmount: NaN }), start + 2000), false);
  assert.equal(engine.record(tick(2, { tokenAmount: 0 }), start + 2000), false);
  assert.equal(evaluate(engine, 2).decision, DecisionAction.WAIT);
});
test('liquidity loss blocks despite clean buying', () => {
  const engine = new EarlyEntryEngine(1);
  accumulate(engine, 11);
  assert.equal(evaluate(engine, 11, { liquiditySol: 0 }).decision, DecisionAction.WAIT);
  assert.equal(evaluate(engine, 11, { liquiditySol: NaN }).decision, DecisionAction.WAIT);
});
