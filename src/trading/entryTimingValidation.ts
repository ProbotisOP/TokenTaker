import { DEFAULT_ENTRY_POLICY, type EntryPolicy, type EntryEvaluation } from './earlyEntryEngine.ts';
import { createEntryExecutionGuard } from './entryExecutionGuard.ts';
import type { SwapTick } from './microstructureEngine.ts';

export interface ValidationEngine {
  record(tick: SwapTick, now: number): boolean;
  observePrice?(priceSol: number): void;
  recordInspection?(inspection: { checkedAt: number; liquiditySol: number; top1Pct: number; holderCount?: number }, now: number): boolean;
  evaluate(input: { now: number; createdAt?: number; inspectedAt?: number; safetyApproved: boolean;
    safetyReasons: string[]; liquiditySol: number; creator: string }): { decision: string; reasons: string[] };
}
export type EngineFactory = (initialPriceSol: number, policy: EntryPolicy) => ValidationEngine;
export interface Inspection {
  id: string; availableAt: number; inspectedAt: number; safetyApproved: boolean;
  safetyReasons: string[]; liquiditySol: number; top1Pct?: number; holderCount?: number; priceSol?: number;
}
export interface Quote {
  id: string; side: 'BUY' | 'SELL'; availableAt: number; observedAt: number; validUntil: number;
  inputAmount: number; status: 'EXECUTABLE' | 'NO_ROUTE';
  // Output is the conservative executable minimum, AFTER spread, route fees and slippage.
  // Only separately charged SOL costs belong in costsSol; rent refunds are not assumed.
  outputAmount: number; costsSol: { network: number; priority: number; platform: number; rent: number };
  evidence: { source: string; recordId: string; sha256: string; simulationSucceeded: boolean; executorSupported?: boolean };
}
export interface LaunchEpisode {
  id: string; token: string; creator: string; createdAt: number; anchorAvailableAt: number;
  initialPriceSol: number; captureEndAt: number;
  ticks: { id: string; availableAt: number; tick: SwapTick }[];
  inspections: Inspection[];
  // Predeclared evaluation clock; include createdAt + maxLaunchAgeMs to certify NO_ENTRY.
  decisionTimes: number[]; quotes: Quote[];
  coverage?: { throughAt: number; decisionIntervalMs: number; marketEventsComplete: boolean; inspectionEventsComplete: boolean;
    source: string; sha256: string };
}
export interface TimingDataset {
  schemaVersion: 1; provenance: 'REAL_CAPTURE' | 'SYNTHETIC_FIXTURE';
  capture: { id: string; source: string; completedAt: number; selection: string };
  episodes: LaunchEpisode[];
}
export interface AuditConfig {
  folds: number; minTrainLaunches: number; trainLaunchesPerFold: number; testLaunches: number;
  embargoMs: number; latencyMs: number; maxQuoteAgeMs: number; maxQuoteWaitMs: number;
  exitHorizonMs: number; buyAmountSol: number;
}
export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  folds: 3, minTrainLaunches: 20, trainLaunchesPerFold: 10, testLaunches: 10,
  embargoMs: 60_000, latencyMs: 500, maxQuoteAgeMs: 1_000, maxQuoteWaitMs: 2_000,
  exitHorizonMs: 60_000, buyAmountSol: 0.05,
};
function fail(message: string): never { throw new Error(`Entry timing validation: ${message}`); }
function object(value: unknown, keys: string[], at: string, optional: string[] = []): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${at} must be an object`);
  const actual = Object.keys(value);
  if (keys.some(k => !actual.includes(k)) || actual.some(k => !keys.includes(k) && !optional.includes(k))) fail(`${at} has missing or unknown fields`);
}
function number(value: unknown, at: string, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) fail(`${at} invalid number`);
}
function time(value: unknown, at: string): asserts value is number {
  number(value, at); if (!Number.isSafeInteger(value)) fail(`${at} must be integer milliseconds`);
}
function text(value: unknown, at: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail(`${at} must be nonempty text`);
}
function bool(value: unknown, at: string): asserts value is boolean {
  if (typeof value !== 'boolean') fail(`${at} must be boolean`);
}
function array(value: unknown, at: string): asserts value is any[] {
  if (!Array.isArray(value)) fail(`${at} must be an array`);
}
function ordered(times: number[], at: string, strict = false) {
  times.forEach((t, i) => { time(t, at); if (i && (strict ? t <= times[i - 1] : t < times[i - 1])) fail(`${at} unsorted/duplicate times`); });
}

/** Structural validation cannot authenticate a claimed real capture or its external evidence. */
export function parseTimingDataset(value: unknown, allowSynthetic = false, now = Date.now()): TimingDataset {
  object(value, ['schemaVersion', 'provenance', 'capture', 'episodes'], 'dataset');
  if (value.schemaVersion !== 1) fail('unsupported schemaVersion');
  if (!['REAL_CAPTURE', 'SYNTHETIC_FIXTURE'].includes(value.provenance)) fail('invalid provenance');
  if (value.provenance !== 'REAL_CAPTURE' && !allowSynthetic) fail('genuine REAL_CAPTURE data required; synthetic fixtures require explicit opt-in');
  object(value.capture, ['id', 'source', 'completedAt', 'selection'], 'capture');
  for (const k of ['id', 'source', 'selection']) text(value.capture[k], `capture.${k}`);
  time(value.capture.completedAt, 'capture.completedAt');
  if (value.capture.completedAt > now) fail('capture is in the future');
  array(value.episodes, 'episodes'); if (!value.episodes.length) fail('empty dataset');
  const ids = new Set<string>(); const tokens = new Set<string>();
  const id = (s: unknown) => { text(s, 'id'); if (ids.has(s)) fail(`duplicate id ${s}`); ids.add(s); };
  for (const e of value.episodes) {
    object(e, ['id', 'token', 'creator', 'createdAt', 'anchorAvailableAt', 'initialPriceSol', 'captureEndAt', 'ticks', 'inspections', 'decisionTimes', 'quotes'], 'episode', ['coverage']);
    id(e.id); text(e.token, 'token'); text(e.creator, 'creator');
    if (tokens.has(e.token)) fail('token must have exactly one independent launch episode'); tokens.add(e.token);
    for (const k of ['createdAt', 'anchorAvailableAt', 'captureEndAt']) time(e[k], k);
    if (e.createdAt > e.anchorAvailableAt || e.anchorAvailableAt > e.captureEndAt || e.captureEndAt > value.capture.completedAt) fail('invalid creation/availability/capture anchors');
    if (e.coverage !== undefined) {
      object(e.coverage, ['throughAt', 'decisionIntervalMs', 'marketEventsComplete', 'inspectionEventsComplete', 'source', 'sha256'], 'coverage');
      time(e.coverage.throughAt, 'coverage.throughAt'); time(e.coverage.decisionIntervalMs, 'coverage.decisionIntervalMs');
      if (e.coverage.throughAt > e.captureEndAt || e.coverage.throughAt < e.createdAt || e.coverage.decisionIntervalMs < 1 || e.coverage.decisionIntervalMs > 1000) fail('invalid coverage bounds or decision cadence');
      bool(e.coverage.marketEventsComplete, 'market coverage'); bool(e.coverage.inspectionEventsComplete, 'inspection coverage');
      text(e.coverage.source, 'coverage source');
      if (typeof e.coverage.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.coverage.sha256)) fail('missing coverage evidence digest');
    }
    number(e.initialPriceSol, 'initialPriceSol', Number.MIN_VALUE);
    const within = (t: unknown) => { time(t, 'observation time'); if (t < e.createdAt || t > e.captureEndAt) fail('observation outside capture'); };
    for (const k of ['ticks', 'inspections', 'decisionTimes', 'quotes']) array(e[k], k);
    for (const t of e.ticks) {
      object(t, ['id', 'availableAt', 'tick'], 'tick observation'); id(t.id); within(t.availableAt);
      object(t.tick, ['timestamp', 'isBuy', 'tokenAmount', 'solAmount', 'priceSol', 'priceUsd', 'traderWallet', 'isNewWallet'], 'tick');
      within(t.tick.timestamp); if (t.tick.timestamp > t.availableAt) fail('future tick');
      for (const k of ['tokenAmount', 'solAmount', 'priceSol']) number(t.tick[k], k, Number.MIN_VALUE);
      number(t.tick.priceUsd, 'priceUsd'); text(t.tick.traderWallet, 'traderWallet');
      bool(t.tick.isBuy, 'isBuy'); bool(t.tick.isNewWallet, 'isNewWallet');
    }
    ordered(e.ticks.map((t: any) => t.availableAt), 'tick receipt times');
    ordered(e.ticks.map((t: any) => t.tick.timestamp), 'tick event times');
    for (const i of e.inspections) {
      object(i, ['id', 'availableAt', 'inspectedAt', 'safetyApproved', 'safetyReasons', 'liquiditySol'], 'inspection', ['top1Pct', 'holderCount', 'priceSol']);
      if ('priceSol' in i) number(i.priceSol, 'inspection priceSol', Number.MIN_VALUE);
      if ('top1Pct' in i) { number(i.top1Pct, 'top1Pct'); if (i.top1Pct > 100) fail('top1Pct exceeds 100'); }
      if ('holderCount' in i) { time(i.holderCount, 'holderCount'); if (!('top1Pct' in i)) fail('holderCount requires concentration observation'); }
      id(i.id); within(i.availableAt); within(i.inspectedAt);
      if (i.inspectedAt > i.availableAt) fail('future inspection');
      bool(i.safetyApproved, 'safetyApproved'); number(i.liquiditySol, 'liquiditySol');
      array(i.safetyReasons, 'safetyReasons'); i.safetyReasons.forEach((r: unknown) => text(r, 'safety reason'));
    }
    ordered(e.inspections.map((i: any) => i.availableAt), 'inspection receipt times');
    ordered(e.inspections.map((i: any) => i.inspectedAt), 'inspection event times', true);
    ordered(e.decisionTimes, 'decision times', true); e.decisionTimes.forEach(within);
    if (!e.decisionTimes.length || e.decisionTimes[0] < e.anchorAvailableAt) fail('missing decisions or unavailable launch anchor');
    for (const q of e.quotes) {
      object(q, ['id', 'side', 'availableAt', 'observedAt', 'validUntil', 'inputAmount', 'status', 'outputAmount', 'costsSol', 'evidence'], 'quote');
      id(q.id); within(q.availableAt); within(q.observedAt); time(q.validUntil, 'validUntil');
      if (q.observedAt > q.availableAt || q.validUntil < q.observedAt) fail('invalid quote timestamps');
      if (!['BUY', 'SELL'].includes(q.side) || !['EXECUTABLE', 'NO_ROUTE'].includes(q.status)) fail('invalid quote side/status');
      number(q.inputAmount, 'inputAmount', Number.MIN_VALUE); number(q.outputAmount, 'outputAmount');
      object(q.costsSol, ['network', 'priority', 'platform', 'rent'], 'costsSol');
      Object.values(q.costsSol).forEach(c => number(c, 'quote SOL cost'));
      object(q.evidence, ['source', 'recordId', 'sha256', 'simulationSucceeded'], 'evidence', ['executorSupported']);
      if (q.evidence.executorSupported !== undefined) bool(q.evidence.executorSupported, 'executorSupported');
      text(q.evidence.source, 'evidence source'); id(q.evidence.recordId);
      if (typeof q.evidence.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(q.evidence.sha256)) fail('missing SHA256 evidence digest');
      bool(q.evidence.simulationSucceeded, 'simulationSucceeded');
      if (q.status === 'EXECUTABLE' && (!q.evidence.simulationSucceeded || q.outputAmount <= 0)) fail('incomplete executable evidence');
      if (q.status === 'NO_ROUTE' && (q.evidence.simulationSucceeded || q.outputAmount !== 0 || Object.values(q.costsSol).some(c => c !== 0))) fail('invalid no-route evidence');
    }
    ordered(e.quotes.map((q: any) => q.availableAt), 'quote receipt times');
  }
  ordered(value.episodes.map((e: any) => e.createdAt), 'launch chronology', true);
  return value as TimingDataset;
}
function validateConfig(c: AuditConfig) {
  object(c, Object.keys(DEFAULT_AUDIT_CONFIG), 'config');
  Object.entries(c).forEach(([k, v]) => k === 'buyAmountSol' ? number(v, k, Number.MIN_VALUE) : time(v, k));
  if (c.folds < 2 || c.minTrainLaunches < 1 || c.trainLaunchesPerFold < 1 || c.testLaunches < 1 || c.exitHorizonMs < 1 || c.latencyMs < 1) fail('insufficient folds, training, test launches or execution horizon');
}
export interface Fold { index: number; trainIds: string[]; testIds: string[]; testStartAt: number; purgedTrainIds: string[]; purgedTestIds: string[] }
export function buildTimingFolds(episodes: LaunchEpisode[], c: AuditConfig, policy: EntryPolicy = DEFAULT_ENTRY_POLICY): Fold[] {
  validateConfig(c);
  const needed = c.minTrainLaunches + (c.folds - 1) * c.trainLaunchesPerFold + c.folds * c.testLaunches;
  if (episodes.length < needed) fail(`insufficient launches: need at least ${needed}`);
  const labelEnd = (e: LaunchEpisode) => e.createdAt + policy.maxLaunchAgeMs + c.exitHorizonMs + 2 * (c.latencyMs + c.maxQuoteWaitMs);
  let cursor = 0; const training: LaunchEpisode[] = []; const folds: Fold[] = [];
  for (let f = 0; f < c.folds; f++) {
    const n = f === 0 ? c.minTrainLaunches : c.trainLaunchesPerFold;
    training.push(...episodes.slice(cursor, cursor + n)); cursor += n;
    const test = episodes.slice(cursor, cursor + c.testLaunches); cursor += c.testLaunches;
    const start = test[0].createdAt;
    const train = training.filter(e => labelEnd(e) < start - c.embargoMs);
    const boundary = episodes[cursor]?.createdAt ?? Infinity;
    const eligible = test.filter(e => labelEnd(e) < boundary - c.embargoMs);
    if (train.length < c.minTrainLaunches || !eligible.length) fail(`fold ${f} insufficient launches after embargo/horizon purge`);
    folds.push({ index: f, trainIds: train.map(e => e.id), testIds: eligible.map(e => e.id), testStartAt: start,
      purgedTrainIds: training.filter(e => !train.includes(e)).map(e => e.id), purgedTestIds: test.filter(e => !eligible.includes(e)).map(e => e.id) });
  }
  return folds;
}
export interface EpisodeResult {
  episodeId: string; token: string; status: 'OBSERVATION_COVERAGE_MISSING' | 'NO_ENTRY' | 'DECISION_COVERAGE_MISSING' | 'REJECTED' | 'NO_ENTRY_ROUTE' | 'ENTRY_COVERAGE_MISSING' | 'EXECUTION_REJECTED' | 'PREFLIGHT_COVERAGE_MISSING' | 'EXIT_NO_ROUTE' | 'EXIT_COVERAGE_MISSING' | 'CLOSED';
  signalAt: number | null; launchAgeMs: number | null; entryAt: number | null; exitAt: number | null;
  entryQuoteId: string | null; exitQuoteId: string | null; entryCostSol: number; netSol: number | null;
  netReturnPct: number | null; exposureMs: number; executableEntryExtensionPct: number | null;
  postExpansionEntry: boolean | null; reasons: string[];
}
const costs = (q: Quote) => Object.values(q.costsSol).reduce((a, b) => a + b, 0);
function usable(q: Quote, c: AuditConfig) {
  return q.status === 'EXECUTABLE' && q.availableAt - q.observedAt <= c.maxQuoteAgeMs && q.validUntil >= q.availableAt;
}
function quoteAfter(e: LaunchEpisode, side: Quote['side'], amount: number, decision: number, c: AuditConfig) {
  const ready = decision + c.latencyMs;
  const matches = e.quotes.filter(q => q.side === side && q.inputAmount === amount && q.availableAt >= ready && q.availableAt <= ready + c.maxQuoteWaitMs);
  const first = matches.find(q => q.availableAt - q.observedAt <= c.maxQuoteAgeMs && q.validUntil >= q.availableAt);
  return { quote: first?.status === 'EXECUTABLE' ? first : undefined, noRoute: first?.status === 'NO_ROUTE', deadline: ready + c.maxQuoteWaitMs };
}
/** Replay only receipt-available prefixes. Execution observations never enter the decision engine. */
export function replayTimingEpisode(e: LaunchEpisode, factory: EngineFactory, c: AuditConfig, policy: EntryPolicy = DEFAULT_ENTRY_POLICY,
  executionMode: 'SIGNAL_ONLY' | 'CURRENT' | 'LEGACY' = 'SIGNAL_ONLY'): EpisodeResult {
  const engine = factory(e.initialPriceSol, Object.freeze({ ...policy }));
  let ti = 0; let ii = 0; let inspection: Inspection | undefined; let high = e.initialPriceSol;
  const result: EpisodeResult = { episodeId: e.id, token: e.token, status: 'NO_ENTRY', signalAt: null, launchAgeMs: null,
    entryAt: null, exitAt: null, entryQuoteId: null, exitQuoteId: null, entryCostSol: 0, netSol: 0,
    netReturnPct: null, exposureMs: 0, executableEntryExtensionPct: null, postExpansionEntry: null, reasons: [] };
  if (executionMode !== 'SIGNAL_ONLY') {
    const coverage = e.coverage;
    const deadline = e.createdAt + policy.maxLaunchAgeMs;
    if (!coverage?.marketEventsComplete || !coverage.inspectionEventsComplete || coverage.throughAt < deadline) {
      return { ...result, status: 'OBSERVATION_COVERAGE_MISSING', netSol: null, reasons: ['Complete market/inspection observation coverage is not evidenced'] };
    }
    const times = e.decisionTimes.filter(t => t <= deadline);
    const decisions = new Set(times);
    if (times[0] > e.anchorAvailableAt + coverage.decisionIntervalMs || times.at(-1) !== deadline ||
        times.some((t, i) => i > 0 && t - times[i - 1] > coverage.decisionIntervalMs) ||
        [...e.ticks, ...e.inspections].some(o => o.availableAt >= e.anchorAvailableAt && o.availableAt <= deadline && !decisions.has(o.availableAt))) {
      return { ...result, status: 'DECISION_COVERAGE_MISSING', netSol: null, reasons: ['Decision clock omits receipt events or required cadence'] };
    }
  }
  const evaluateAt = (now: number) => engine.evaluate({ now, createdAt: e.createdAt, inspectedAt: inspection?.inspectedAt,
    safetyApproved: (inspection?.safetyApproved ?? false) && !inspection?.safetyReasons.length,
    safetyReasons: [...(inspection?.safetyReasons ?? ['No inspection available'])],
    liquiditySol: inspection?.liquiditySol ?? 0, creator: e.creator });
  const advance = (now: number) => {
    while (Math.min(e.ticks[ti]?.availableAt ?? Infinity, e.inspections[ii]?.availableAt ?? Infinity) <= now) {
      if ((e.ticks[ti]?.availableAt ?? Infinity) <= (e.inspections[ii]?.availableAt ?? Infinity)) {
        const t = e.ticks[ti++]; high = Math.max(high, t.tick.priceSol);
        if (!engine.record({ ...t.tick, timestamp: t.availableAt }, t.availableAt)) fail(`engine rejected validated tick ${t.id}`);
      } else {
        inspection = e.inspections[ii++];
        if (inspection.priceSol !== undefined) {
          high = Math.max(high, inspection.priceSol); engine.observePrice?.(inspection.priceSol);
        }
        if (engine.recordInspection && inspection.top1Pct !== undefined && !engine.recordInspection({
          checkedAt: inspection.inspectedAt, liquiditySol: inspection.liquiditySol, top1Pct: inspection.top1Pct,
          ...(inspection.holderCount === undefined ? {} : { holderCount: inspection.holderCount }),
        }, inspection.availableAt)) fail(`engine rejected validated inspection ${inspection.id}`);
      }
    }
  };
  for (const now of e.decisionTimes) {
    if (now > e.createdAt + policy.maxLaunchAgeMs) break;
    advance(now);
    const evaluation = evaluateAt(now);
    result.reasons = [...evaluation.reasons];
    if (evaluation.decision === 'REJECT') { result.status = 'REJECTED'; break; }
    if (evaluation.decision !== 'BUY') continue;
    result.signalAt = now; result.launchAgeMs = now - e.createdAt;
    const buy = quoteAfter(e, 'BUY', c.buyAmountSol, now, c);
    if (!buy.quote) {
      result.status = buy.noRoute && e.captureEndAt >= buy.deadline ? 'NO_ENTRY_ROUTE' : 'ENTRY_COVERAGE_MISSING';
      if (result.status === 'ENTRY_COVERAGE_MISSING') result.netSol = null;
      break;
    }
    const b = buy.quote;
    if (executionMode !== 'SIGNAL_ONLY') {
      // The exitability check is contemporaneous, not the later outcome used for PnL.
      const exitCheck = e.quotes.filter(q => q.side === 'SELL' && q.inputAmount === b.outputAmount && q.availableAt <= b.availableAt &&
        b.availableAt - q.observedAt <= policy.maxQuoteAgeMs && q.validUntil >= b.availableAt).at(-1);
      if (!exitCheck || b.evidence.executorSupported === undefined || exitCheck.evidence.executorSupported === undefined) {
        result.status = 'PREFLIGHT_COVERAGE_MISSING'; result.netSol = null; break;
      }
      advance(b.availableAt);
      const finalEvaluation = evaluateAt(b.availableAt);
      const roundTripCostPct = (b.inputAmount - exitCheck.outputAmount + Math.max(.0033, costs(b) + costs(exitCheck))) / b.inputAmount * 100;
      try {
        if (!b.evidence.executorSupported || !exitCheck.evidence.executorSupported || exitCheck.status !== 'EXECUTABLE' || finalEvaluation.decision !== 'BUY') throw new Error('Entry/exit route or signal no longer eligible');
        if (executionMode === 'CURRENT') {
          const guard = createEntryExecutionGuard({ initialPriceSol: e.initialPriceSol,
            evaluation: evaluation as EntryEvaluation, startedAt: now, policy, now: () => b.availableAt,
            validateSignal: () => { if (finalEvaluation.decision !== 'BUY') throw new Error('Signal no longer confirmed'); } });
          guard.validateQuote!({ now: b.availableAt, quoteFetchedAt: b.observedAt, exitQuoteFetchedAt: exitCheck.observedAt,
            worstEntryPriceSol: b.inputAmount / b.outputAmount, roundTripCostPct });
          guard.validate();
        } else if (b.inputAmount / b.outputAmount > e.initialPriceSol * (1 + policy.maxRunupPct / 100) || roundTripCostPct > 5) {
          throw new Error('Legacy launch ceiling or round-trip cost budget exceeded');
        }
      } catch (error) {
        result.status = 'EXECUTION_REJECTED'; result.reasons.push(error instanceof Error ? error.message : 'Execution blocked'); break;
      }
    }
    result.entryAt = b.availableAt; result.entryQuoteId = b.id; result.entryCostSol = b.inputAmount + costs(b);
    result.postExpansionEntry = (high / e.initialPriceSol - 1) * 100 > policy.maxRunupPct || b.inputAmount / b.outputAmount > e.initialPriceSol * (1 + policy.maxRunupPct / 100);
    const reference = e.quotes.filter(q => q.side === 'BUY' && q.inputAmount === c.buyAmountSol && q.availableAt <= now &&
      now - q.observedAt <= c.maxQuoteAgeMs && q.validUntil >= now && usable(q, c)).at(-1);
    if (reference) result.executableEntryExtensionPct = ((result.entryCostSol / b.outputAmount) / ((reference.inputAmount + costs(reference)) / reference.outputAmount) - 1) * 100;
    const sell = quoteAfter(e, 'SELL', b.outputAmount, b.availableAt + c.exitHorizonMs, c);
    if (!sell.quote) {
      result.status = sell.noRoute && e.captureEndAt >= sell.deadline ? 'EXIT_NO_ROUTE' : 'EXIT_COVERAGE_MISSING'; result.netSol = null;
      result.exposureMs = Math.max(0, e.captureEndAt - b.availableAt); break;
    }
    const s = sell.quote; result.status = 'CLOSED'; result.exitAt = s.availableAt; result.exitQuoteId = s.id;
    result.netSol = s.outputAmount - costs(s) - result.entryCostSol;
    result.netReturnPct = result.netSol / result.entryCostSol * 100; result.exposureMs = s.availableAt - b.availableAt;
    break;
  }
  if (result.status === 'NO_ENTRY' && !e.decisionTimes.includes(e.createdAt + policy.maxLaunchAgeMs)) {
    result.status = 'DECISION_COVERAGE_MISSING'; result.netSol = null;
  }
  return result;
}
function summarize(rows: EpisodeResult[]) {
  const closed = rows.filter(r => r.status === 'CLOSED'); const open = rows.filter(r => r.entryAt !== null && r.exitAt === null);
  const attrition = Object.fromEntries(['OBSERVATION_COVERAGE_MISSING', 'NO_ENTRY', 'DECISION_COVERAGE_MISSING', 'REJECTED', 'NO_ENTRY_ROUTE', 'ENTRY_COVERAGE_MISSING', 'EXECUTION_REJECTED', 'PREFLIGHT_COVERAGE_MISSING', 'EXIT_NO_ROUTE', 'EXIT_COVERAGE_MISSING', 'CLOSED'].map(s => [s, rows.filter(r => r.status === s).length]));
  const closedNetSol = closed.reduce((s, r) => s + r.netSol!, 0);
  const deployedSol = rows.reduce((s, r) => s + r.entryCostSol, 0);
  const events = rows.filter(r => r.entryAt !== null).flatMap(r => [
    { at: r.entryAt!, delta: r.entryCostSol }, ...(r.exitAt === null ? [] : [{ at: r.exitAt, delta: -r.entryCostSol }]),
  ]).sort((a, b) => a.at - b.at || a.delta - b.delta);
  let active = 0; let maximumConcurrentSol = 0;
  for (const event of events) { active += event.delta; maximumConcurrentSol = Math.max(maximumConcurrentSol, active); }
  const unresolved = rows.some(r => r.netSol === null);
  return { launches: rows.length, attrition, closedNetSol, totalNetSol: unresolved ? null : closedNetSol,
    totalNetReturnPct: unresolved || !deployedSol ? null : closedNetSol / deployedSol * 100,
    conservativeNetSolIfOpenPositionsWorthZero: closedNetSol - open.reduce((s, r) => s + r.entryCostSol, 0),
    deployedSol, maximumConcurrentSol, openPositions: open.length, losingTrades: closed.filter(r => r.netSol! < 0).length,
    worstClosedNetSol: closed.length ? Math.min(...closed.map(r => r.netSol!)) : null,
    totalObservedExposureMs: rows.reduce((s, r) => s + r.exposureMs, 0),
    postExpansionEntries: rows.filter(r => r.postExpansionEntry).length };
}
export function auditEntryTiming(raw: unknown, factories: { candidate: EngineFactory; baseline: EngineFactory }, c: AuditConfig = DEFAULT_AUDIT_CONFIG, allowSynthetic = false) {
  const dataset = parseTimingDataset(raw, allowSynthetic); validateConfig(c);
  const policy = Object.freeze({ ...DEFAULT_ENTRY_POLICY });
  const folds = buildTimingFolds(dataset.episodes, c, policy);
  const rows = folds.map(fold => {
    const episodes = dataset.episodes.filter(e => fold.testIds.includes(e.id));
    const candidate = episodes.map(e => replayTimingEpisode(e, factories.candidate, c, policy, 'CURRENT'));
    const baseline = episodes.map(e => replayTimingEpisode(e, factories.baseline, c, policy, 'LEGACY'));
    const pairs = candidate.map((a, i) => { const b = baseline[i]; return {
      episodeId: a.episodeId, candidateStatus: a.status, baselineStatus: b.status,
      signalDeltaMs: a.signalAt !== null && b.signalAt !== null ? a.signalAt - b.signalAt : null,
      entryDeltaMs: a.entryAt !== null && b.entryAt !== null ? a.entryAt - b.entryAt : null,
      netDeltaSol: a.netSol !== null && b.netSol !== null ? a.netSol - b.netSol : null,
    }; });
    return { ...fold, candidate, baseline, pairs, candidateSummary: summarize(candidate), baselineSummary: summarize(baseline) };
  });
  const used = new Set(folds.flatMap(f => [...f.trainIds, ...f.testIds]));
  return { schemaVersion: 1, provenance: dataset.provenance, capture: dataset.capture,
    methodology: 'Fixed-policy temporal OOS audit; no fitting or policy search; policy frozen before all OOS replay. Dedicated training launches expand; OOS tokens are never reused for training or other test folds.',
    executionModel: 'First exact-size executable quote received after fixed latency and bounded wait/age; recheck receipt-available signal and contemporaneous supported exit evidence. Candidate uses the production numerical price/cost/alpha-age guard; baseline uses legacy launch ceiling and cost budget. Fixed horizon exit, no interpolation or eventual-peak labels; quote minimum outputs include spread/slippage/route fees, separate SOL costs charged once.',
    limitations: ['Evidence digests and REAL_CAPTURE labels are assertions, not authenticated by this offline tool. Archive review is required.',
      'Coverage and supported-executor assertions require independent archive review; this tool does not reconstruct/attest transaction bytes or replay venue inspectors.',
      'Unknown market/inspection coverage, missing decision cadence, or missing contemporaneous preflight evidence null aggregate returns.',
      'Simulated executable minimum-output quotes are not landed fills or guarantees of future execution.',
      'Decision schedule and capture selection must be predeclared and independently audited for survivor/outcome bias.',
      'Unknown exits remain open, aggregate net returns are null; closed-only net is not portfolio profitability.',
      'Unfilled signals with missing entry coverage are unresolved opportunities, not proven no-route or zero-return strategies.',
      'Independent fixed-size trades assume unlimited capital; concurrent exposure is reported, not a portfolio simulation.',
      'Synthetic fixtures demonstrate mechanics only. No optimality, statistical significance, live readiness or auto-arming claim.'],
    policy, config: { ...c }, datasetLaunches: dataset.episodes.length,
    unusedOrPurgedLaunchIds: dataset.episodes.filter(e => !used.has(e.id)).map(e => e.id), folds: rows,
    candidateSummary: summarize(rows.flatMap(f => f.candidate)), baselineSummary: summarize(rows.flatMap(f => f.baseline)) };
}
