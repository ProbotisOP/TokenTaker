import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EarlyEntryEngine, DEFAULT_ENTRY_POLICY } from '../src/trading/earlyEntryEngine.ts';
import { EarlyEntryEngine as LegacyEarlyEntryEngine, DEFAULT_ENTRY_POLICY as LEGACY_POLICY } from './fixtures/legacyEarlyEntryEngine.ts';
import { auditEntryTiming, buildTimingFolds, parseTimingDataset, replayTimingEpisode,
  type AuditConfig, type EngineFactory, type LaunchEpisode, type Quote, type TimingDataset } from '../src/trading/entryTimingValidation.ts';

const config: AuditConfig = { folds: 2, minTrainLaunches: 1, trainLaunchesPerFold: 1, testLaunches: 1,
  embargoMs: 1_000, latencyMs: 500, maxQuoteAgeMs: 300, maxQuoteWaitMs: 1_000, exitHorizonMs: 10_000, buyAmountSol: 1 };
const factories = { candidate: (p: number, policy: typeof DEFAULT_ENTRY_POLICY) => new EarlyEntryEngine(p, policy),
  baseline: (p: number, policy: typeof DEFAULT_ENTRY_POLICY) => new LegacyEarlyEntryEngine(p, policy) };
function quote(e: LaunchEpisode, key: string, side: Quote['side'], offset: number, inputAmount: number, outputAmount: number): Quote {
  return { id: `${e.id}-${key}`, side, availableAt: e.createdAt + offset, observedAt: e.createdAt + offset - 100,
    validUntil: e.createdAt + offset + 500, inputAmount, outputAmount, status: 'EXECUTABLE',
    costsSol: { network: 0.01, priority: 0.02, platform: 0.03, rent: 0.04 },
    evidence: { source: 'deterministic synthetic route fixture, NOT market evidence', recordId: `${e.id}-${key}-evidence`, sha256: 'a'.repeat(64), simulationSucceeded: true, executorSupported: true } };
}
function fixture(): TimingDataset {
  const episodes: LaunchEpisode[] = Array.from({ length: 4 }, (_, index) => {
    const createdAt = 1_700_000_000_000 + index * 300_000;
    const e: LaunchEpisode = { id: `launch-${index}`, token: `token-${index}`, creator: `creator-${index}`, createdAt,
      anchorAvailableAt: createdAt, initialPriceSol: 0.01, captureEndAt: createdAt + 140_000,
      coverage: { throughAt: createdAt + 140_000, decisionIntervalMs: 1000, marketEventsComplete: true,
        inspectionEventsComplete: true, source: 'complete synthetic fixture', sha256: 'b'.repeat(64) },
      ticks: [], inspections: [], decisionTimes: [], quotes: [] };
    for (let sec = 0; sec <= 20; sec++) {
      e.ticks.push({ id: `${e.id}-tick-${sec}`, availableAt: createdAt + sec * 1_000,
        tick: { timestamp: createdAt + sec * 1_000, isBuy: true, tokenAmount: 30, solAmount: 0.3,
          priceSol: 0.01, priceUsd: 1, traderWallet: `buyer-${sec % 10}`, isNewWallet: false } });
      e.inspections.push({ id: `${e.id}-inspection-${sec}`, availableAt: createdAt + sec * 1_000,
        inspectedAt: createdAt + sec * 1_000, safetyApproved: true, safetyReasons: [], liquiditySol: 10 });
      e.decisionTimes.push(createdAt + sec * 1_000);
    }
    for (let sec = 21; sec <= 120; sec++) e.decisionTimes.push(createdAt + sec * 1000);
    e.quotes = [quote(e, 'reference', 'BUY', 0, 1, 100), quote(e, 'buy', 'BUY', 11_500, 1, 90), quote(e, 'sell', 'SELL', 22_000, 90, index === 3 ? 0.8 : 1.5)];
    e.quotes[0].observedAt = createdAt;
    for (const q of e.quotes) q.costsSol = { network: .001, priority: .001, platform: .001, rent: .001 };
    const preflight = quote(e, 'exit-preflight', 'SELL', 11_500, 90, .999);
    preflight.costsSol = { network: .001, priority: .001, platform: .001, rent: .001 };
    e.quotes.splice(2, 0, preflight);
    return e;
  });
  return { schemaVersion: 1, provenance: 'SYNTHETIC_FIXTURE', capture: { id: 'fixture', source: 'unit test only',
    completedAt: episodes.at(-1)!.captureEndAt, selection: 'All four deterministic toy launches; no profitability inference' }, episodes };
}
const fixedSignal: EngineFactory = () => ({ record: () => true, evaluate: () => ({ stage: 'CONFIRMED', decision: 'BUY' as any,
  reasons: ['test mechanics only'], runupPct: 0, uniqueBuyers: 0, netFlowSol: 0, buyShare: 0, largestBuyerShare: 0 }) });
function mechanicalEpisode(): LaunchEpisode {
  const e = fixture().episodes[0]; e.decisionTimes = [e.createdAt + 11_000];
  for (const q of e.quotes) q.costsSol = { network: .01, priority: .02, platform: .03, rent: .04 };
  return e;
}

test('synthetic opt-in, fixed policy unchanged, frozen legacy and candidate OOS audit', () => {
  for (const [key, value] of Object.entries(LEGACY_POLICY)) assert.equal(DEFAULT_ENTRY_POLICY[key as keyof typeof LEGACY_POLICY], value);
  assert.throws(() => parseTimingDataset(fixture()), /genuine/);
  const report = auditEntryTiming(fixture(), factories, config, true);
  assert.equal(report.provenance, 'SYNTHETIC_FIXTURE');
  assert.match(report.methodology, /no fitting/);
  assert.equal(report.folds.length, 2);
  assert.equal(report.baselineSummary.attrition.CLOSED, 2);
  assert.equal(report.baselineSummary.losingTrades, 1);
  assert.equal(report.folds[0].baseline[0].signalAt, fixture().episodes[1].createdAt + 11_000);
  assert.ok(Object.isFrozen(report.policy));
});

test('expanding dedicated training, embargo, horizon purge and disjoint OOS tokens', () => {
  const data = fixture(); const folds = buildTimingFolds(data.episodes, config);
  assert.deepEqual(folds.map(f => f.trainIds.length), [1, 2]);
  const tests = folds.flatMap(f => f.testIds);
  assert.equal(new Set(tests).size, tests.length);
  for (const f of folds) {
    assert.ok(f.trainIds.every(id => !tests.includes(id)));
    for (const id of f.trainIds) {
      const e = data.episodes.find(e => e.id === id)!;
      const labelEnd = e.createdAt + DEFAULT_ENTRY_POLICY.maxLaunchAgeMs + config.exitHorizonMs + 2 * (config.latencyMs + config.maxQuoteWaitMs);
      assert.ok(labelEnd < f.testStartAt - config.embargoMs);
    }
  }
  assert.throws(() => buildTimingFolds(data.episodes, { ...config, embargoMs: 200_000 }), /purge/);
  assert.throws(() => buildTimingFolds(data.episodes.slice(0, 3), config), /insufficient launches/);
  assert.throws(() => buildTimingFolds(data.episodes, { ...config, folds: 1 }), /insufficient folds/);
});

test('prefix invariance: future ticks, inspections and quotes cannot change signal', () => {
  const e = fixture().episodes[0];
  const first = replayTimingEpisode(e, factories.baseline, config);
  const altered = structuredClone(e);
  altered.ticks = altered.ticks.map(t => t.availableAt > first.signalAt! ? { ...t, tick: { ...t.tick, priceSol: 100, isBuy: false, traderWallet: e.creator } } : t);
  altered.inspections = altered.inspections.map(i => i.availableAt > first.signalAt! ? { ...i, safetyApproved: false, liquiditySol: 0 } : i);
  altered.quotes = [];
  const second = replayTimingEpisode(altered, factories.baseline, config);
  assert.equal(second.signalAt, first.signalAt); assert.deepEqual(second.reasons, first.reasons);
  const prefix = structuredClone(e);
  prefix.ticks = prefix.ticks.filter(t => t.availableAt <= first.signalAt!);
  prefix.inspections = prefix.inspections.filter(i => i.availableAt <= first.signalAt!);
  prefix.decisionTimes = prefix.decisionTimes.filter(t => t <= first.signalAt!);
  assert.equal(replayTimingEpisode(prefix, factories.baseline, config).signalAt, first.signalAt);
});

test('receipt time, not chain timestamp, gates engine visibility', () => {
  const e = mechanicalEpisode(); e.ticks = e.ticks.slice(0, 1);
  e.ticks[0].availableAt = e.createdAt + 12_000;
  let recorded = 0;
  const factory: EngineFactory = () => ({ record: () => { recorded++; return true; }, evaluate: input => {
    assert.equal(recorded, 0); assert.equal(input.now, e.decisionTimes[0]);
    return fixedSignal(0, DEFAULT_ENTRY_POLICY).evaluate(input);
  } });
  replayTimingEpisode(e, factory, config);
  e.decisionTimes = [e.createdAt + 13_000];
  replayTimingEpisode(e, () => ({ record(tick, now) {
    assert.equal(tick.timestamp, e.ticks[0].availableAt); assert.equal(tick.timestamp, now); return true;
  }, evaluate: () => ({ decision: 'WAIT', reasons: ['receipt-time fixture'] }) }), config);
});

test('latency, fixed horizon, exact amounts, bid/ask and costs charged exactly once', () => {
  const e = mechanicalEpisode();
  const r = replayTimingEpisode(e, fixedSignal, config);
  assert.equal(r.entryAt, e.createdAt + 11_500); assert.equal(r.exitAt, e.createdAt + 22_000);
  assert.equal(r.entryCostSol, 1.1); assert.ok(Math.abs(r.netSol! - 0.3) < 1e-12);
  assert.ok(Math.abs(r.netReturnPct! - 100 * 0.3 / 1.1) < 1e-10);
  assert.equal(r.exposureMs, 10_500);
  assert.equal(r.executableEntryExtensionPct, null);
  const early = quote(e, 'too-early', 'BUY', 11_499, 1, 1_000);
  e.quotes.splice(1, 0, early);
  assert.equal(replayTimingEpisode(e, fixedSignal, config).entryQuoteId, `${e.id}-buy`);
  e.quotes.push(quote(e, 'eventual-peak', 'SELL', 30_000, 90, 100));
  assert.equal(replayTimingEpisode(e, fixedSignal, config).exitQuoteId, `${e.id}-sell`);
});

test('no quote interpolation, stale routes, mismatched sizes or fabricated spot fills', () => {
  for (const mutate of [
    (e: LaunchEpisode) => { e.quotes = []; },
    (e: LaunchEpisode) => { e.quotes[1].inputAmount = 2; },
    (e: LaunchEpisode) => { e.quotes[1].observedAt -= 301; },
    (e: LaunchEpisode) => { e.quotes[1].validUntil = e.quotes[1].availableAt - 1; },
    (e: LaunchEpisode) => { e.quotes[1].availableAt += 1_001; },
  ]) {
    const e = mechanicalEpisode(); mutate(e);
    const r = replayTimingEpisode(e, fixedSignal, config);
    assert.equal(r.status, 'ENTRY_COVERAGE_MISSING'); assert.equal(r.entryAt, null);
  }
});

test('missing exits and no-route exits remain in denominator and null aggregate net', () => {
  const data = fixture(); data.episodes[1].quotes = data.episodes[1].quotes.filter(q => !q.id.endsWith('-sell'));
  const q = data.episodes[3].quotes.at(-1)!; q.status = 'NO_ROUTE'; q.outputAmount = 0;
  q.evidence.simulationSucceeded = false; q.costsSol = { network: 0, priority: 0, platform: 0, rent: 0 };
  const report = auditEntryTiming(data, factories, config, true);
  assert.equal(report.baselineSummary.launches, 2); assert.equal(report.baselineSummary.openPositions, 2);
  assert.equal(report.baselineSummary.totalNetSol, null); assert.equal(report.baselineSummary.totalNetReturnPct, null);
  assert.equal(report.baselineSummary.attrition.EXIT_COVERAGE_MISSING, 1);
  assert.equal(report.baselineSummary.attrition.EXIT_NO_ROUTE, 1);
  assert.equal(report.baselineSummary.conservativeNetSolIfOpenPositionsWorthZero, -2.008);
});

test('no-entry and entry-no-route launches retained', () => {
  const data = fixture(); data.episodes[1].inspections.forEach(i => { i.safetyApproved = false; });
  const q = data.episodes[3].quotes[1]; q.status = 'NO_ROUTE'; q.outputAmount = 0;
  q.evidence.simulationSucceeded = false; q.costsSol = { network: 0, priority: 0, platform: 0, rent: 0 };
  const report = auditEntryTiming(data, factories, config, true);
  assert.equal(report.baselineSummary.launches, 2);
  assert.equal(report.baselineSummary.attrition.NO_ENTRY, 1); assert.equal(report.baselineSummary.attrition.NO_ENTRY_ROUTE, 1);
});

test('strict contract fails closed on anchors, duplicates, future/unsorted and fake evidence', () => {
  const mutations: ((d: any) => void)[] = [
    d => { delete d.episodes[0].createdAt; }, d => { d.episodes[0].extra = 1; },
    d => { d.episodes[1].id = d.episodes[0].id; }, d => { d.episodes[1].token = d.episodes[0].token; },
    d => { d.episodes[0].ticks[1].id = d.episodes[0].ticks[0].id; },
    d => { d.episodes[0].ticks.reverse(); }, d => { d.episodes.reverse(); },
    d => { d.episodes[0].inspections[0].inspectedAt++; },
    d => { d.episodes[0].ticks[0].tick.timestamp++; },
    d => { d.capture.completedAt = Date.now() + 1_000_000; },
    d => { d.episodes[0].quotes[0].evidence.simulationSucceeded = false; },
    d => { d.episodes[0].quotes[0].evidence.sha256 = 'fake'; },
    d => { delete d.episodes[0].quotes[0].costsSol.rent; },
    d => { d.episodes[0].quotes[0].costsSol.rent = -1; },
    d => { d.episodes[0].quotes[0].outputAmount = 0; },
    d => { d.episodes[0].decisionTimes.push(d.episodes[0].decisionTimes[0]); },
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data); assert.throws(() => parseTimingDataset(data, true)); }
});

test('both engines see prefix-only optional inspection features', () => {
  for (const factory of [factories.baseline, factories.candidate]) {
    const e = fixture().episodes[0];
    e.inspections.forEach(i => { i.top1Pct = 10; i.holderCount = 100; });
    const first = replayTimingEpisode(e, factory, config);
    assert.notEqual(first.signalAt, null);
    const changed = structuredClone(e);
    changed.ticks.forEach(t => { if (t.availableAt > first.signalAt!) t.tick.priceSol = 50; });
    changed.inspections.forEach(i => { if (i.availableAt > first.signalAt!) { i.top1Pct = 99; i.holderCount = 1; i.liquiditySol = 0; } });
    changed.quotes = [];
    assert.equal(replayTimingEpisode(changed, factory, config).signalAt, first.signalAt);
    const marked = fixture().episodes[0]; marked.inspections[0].priceSol = marked.initialPriceSol * 1.4;
    assert.equal(replayTimingEpisode(marked, factory, config).status, 'REJECTED');
  }
  const e = mechanicalEpisode();
  e.inspections[0].top1Pct = 12; e.inspections[0].holderCount = 20;
  let count = 0;
  const receiving: EngineFactory = () => ({ ...fixedSignal(0, DEFAULT_ENTRY_POLICY), recordInspection(i, now) {
    count++; assert.equal(i.top1Pct, 12); assert.equal(i.holderCount, 20); assert.ok(i.checkedAt <= now); return true;
  } });
  replayTimingEpisode(e, receiving, config); assert.equal(count, 1);
});

test('unresolved entry and decision coverage do not masquerade as zero-return strategies', () => {
  const data = fixture(); data.episodes[1].quotes = [];
  data.episodes[3].inspections.forEach(i => { i.safetyApproved = false; });
  data.episodes[3].decisionTimes.pop();
  const report = auditEntryTiming(data, factories, config, true);
  assert.equal(report.baselineSummary.attrition.ENTRY_COVERAGE_MISSING, 1);
  assert.equal(report.baselineSummary.attrition.DECISION_COVERAGE_MISSING, 1);
  assert.equal(report.baselineSummary.totalNetSol, null);
  assert.equal(report.baselineSummary.totalNetReturnPct, null);
});

test('matched pairs expose missing coverage, signed timing deltas and unchanged policy', () => {
  const data = fixture();
  const delayed: EngineFactory = (price, policy) => {
    assert.ok(Object.isFrozen(policy)); assert.deepEqual(policy, DEFAULT_ENTRY_POLICY);
    const engine = new LegacyEarlyEntryEngine(price, policy);
    return { record: (tick, now) => engine.record(tick, now), evaluate: input => {
      const r = engine.evaluate(input);
      return r.decision === 'BUY' && input.now < input.createdAt! + 12_000 ? { ...r, decision: 'WAIT' } : r;
    } };
  };
  const report = auditEntryTiming(data, { baseline: factories.baseline, candidate: delayed }, config, true);
  assert.equal(report.folds[0].pairs[0].signalDeltaMs, 1_000);
  assert.equal(report.folds[0].pairs[0].entryDeltaMs, null);
  assert.equal(report.folds[0].pairs[0].netDeltaSol, null);
});

test('a no-route response is not skipped in hindsight for a later executable quote', () => {
  const e = mechanicalEpisode();
  const unavailable = quote(e, 'no-route-first', 'BUY', 11_500, 1, 0);
  unavailable.status = 'NO_ROUTE'; unavailable.evidence.simulationSucceeded = false;
  unavailable.costsSol = { network: 0, priority: 0, platform: 0, rent: 0 };
  e.quotes.splice(1, 0, unavailable);
  assert.equal(replayTimingEpisode(e, fixedSignal, config).status, 'NO_ENTRY_ROUTE');
});

test('missing capture coverage never becomes a zero-return no-entry strategy', () => {
  const data = fixture();
  for (const e of data.episodes) {
    delete e.coverage; e.ticks = []; e.inspections = []; e.quotes = [];
    e.decisionTimes = [e.createdAt + DEFAULT_ENTRY_POLICY.maxLaunchAgeMs];
  }
  const report = auditEntryTiming(data, factories, config, true);
  assert.equal(report.candidateSummary.attrition.OBSERVATION_COVERAGE_MISSING, 2);
  assert.equal(report.candidateSummary.totalNetSol, null);
  assert.equal(report.baselineSummary.totalNetSol, null);
});

test('entry extension uses only a fresh executable reference at signal time', () => {
  const e = mechanicalEpisode();
  assert.equal(replayTimingEpisode(e, fixedSignal, config).executableEntryExtensionPct, null);
  e.quotes.splice(1, 0, quote(e, 'fresh-reference', 'BUY', 11_000, 1, 100));
  assert.ok(Math.abs(replayTimingEpisode(e, fixedSignal, config).executableEntryExtensionPct! - 100 * (100 / 90 - 1)) < 1e-10);
});

test('current replay enforces pre-sign price, latency, costs and intervening market evidence', () => {
  const executable = () => {
    const e = fixture().episodes[0];
    const amount = 100 / 1.01;
    e.quotes = [quote(e, 'buy-current', 'BUY', 9500, 1, amount),
      quote(e, 'preflight-current', 'SELL', 9500, amount, .99),
      quote(e, 'outcome-current', 'SELL', 20000, amount, 1.05)];
    for (const q of e.quotes) q.costsSol = { network: .001, priority: .001, platform: .001, rent: .001 };
    return e;
  };
  assert.equal(replayTimingEpisode(executable(), factories.candidate, config, DEFAULT_ENTRY_POLICY, 'CURRENT').status, 'CLOSED');
  for (const change of [
    (e: LaunchEpisode) => { e.quotes[0].outputAmount = 90; e.quotes[1].inputAmount = 90; },
    (e: LaunchEpisode) => { e.quotes[1].outputAmount = .90; },
    (e: LaunchEpisode) => {
      const t = structuredClone(e.ticks[9]); t.id += '-spike'; t.availableAt += 250; t.tick.timestamp += 250; t.tick.priceSol = .012;
      e.ticks.splice(10, 0, t); e.decisionTimes.splice(10, 0, t.availableAt);
    },
  ]) {
    const e = executable(); change(e);
    const r = replayTimingEpisode(e, factories.candidate, config, DEFAULT_ENTRY_POLICY, 'CURRENT');
    assert.equal(r.status, 'EXECUTION_REJECTED'); assert.equal(r.entryAt, null);
  }
  const missing = executable(); missing.quotes.splice(1, 1);
  assert.equal(replayTimingEpisode(missing, factories.candidate, config, DEFAULT_ENTRY_POLICY, 'CURRENT').status, 'PREFLIGHT_COVERAGE_MISSING');
  const delayed = executable();
  for (const q of delayed.quotes.slice(0, 2)) { q.availableAt += 3000; q.observedAt += 3000; q.validUntil += 3000; }
  assert.equal(replayTimingEpisode(delayed, factories.candidate, { ...config, maxQuoteWaitMs: 4000 }, DEFAULT_ENTRY_POLICY, 'CURRENT').status, 'EXECUTION_REJECTED');
});

test('CLI rejects absent/genuine-data requirement and runs explicit synthetic offline audit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'entry-timing-test-'));
  try {
    const input = join(directory, 'data.json'); const settings = join(directory, 'config.json');
    writeFileSync(input, JSON.stringify(fixture())); writeFileSync(settings, JSON.stringify(config));
    const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/validate-entry-timing.ts', ...args], { encoding: 'utf8' });
    assert.equal(run().status, 1);
    const denied = run('--input', input, '--config', settings); assert.equal(denied.status, 1); assert.match(denied.stderr, /genuine/);
    const accepted = run('--input', input, '--config', settings, '--allow-synthetic');
    assert.equal(accepted.status, 0, accepted.stderr); assert.equal(JSON.parse(accepted.stdout).provenance, 'SYNTHETIC_FIXTURE');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
