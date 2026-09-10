import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TradingStateStore, TradingSnapshot } from '../src/trading/tradingStateStore.ts';

test('settled accounting survives a restart without persisting a live-armed mode', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokentaker-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'state.json');
  const store = new TradingStateStore(filename);
  assert.equal(store.load(), undefined);
  const snapshot = { version: 1, activePositions: [], closedPositions: [], portfolio: { totalRealizedPnlSol: 1 },
    riskLimits: { circuitBreakerActive: true }, settledSignatures: ['fixture-signature'] } as TradingSnapshot;
  store.save(snapshot);
  assert.deepEqual(new TradingStateStore(filename).load(), snapshot);
  assert.equal(fs.existsSync(`${filename}.tmp`), false);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.equal('mode' in new TradingStateStore(filename).load()!, false);
});

test('corrupt accounting fails closed rather than forgetting live positions', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokentaker-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'state.json');
  fs.writeFileSync(filename, '{');
  assert.throws(() => new TradingStateStore(filename).load());
  fs.writeFileSync(filename, JSON.stringify({ version: 1, activePositions: [], closedPositions: [] }));
  assert.throws(() => new TradingStateStore(filename).load(), /Invalid trading state/);
});
