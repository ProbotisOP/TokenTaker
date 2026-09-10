import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRoundTripCostPct } from '../src/trading/executionCost.ts';

test('fees and rent make a tiny otherwise-flat trade uneconomic', () => {
  assert.equal(estimateRoundTripCostPct(0.02, 0.02), 16.5);
  assert.ok(estimateRoundTripCostPct(0.02, 0.0195) > 5);
  assert.ok(estimateRoundTripCostPct(1, 0.99) < 5);
});
test('invalid quote or cost data cannot pass the cost gate', () => {
  for (const args of [[0, 1], [NaN, 1], [1, Infinity], [1, -1], [1, 1, -1]]) {
    assert.throws(() => estimateRoundTripCostPct(args[0], args[1], args[2]));
  }
});
