import { DEFAULT_ENTRY_POLICY, type EntryEvaluation, type EntryPolicy } from './earlyEntryEngine.ts';
import { DecisionAction } from '../types.ts';

export interface ExecutableEntry {
  now: number;
  quoteFetchedAt: number;
  exitQuoteFetchedAt: number;
  worstEntryPriceSol: number;
  roundTripCostPct: number;
}
export interface SignalExecutionGuard {
  maxEntryPriceSol: number;
  validate: () => void;
  validateQuote?: (quote: ExecutableEntry) => void;
}

export function createEntryExecutionGuard(input: {
  initialPriceSol: number; evaluation: EntryEvaluation; startedAt: number;
  validateSignal: () => void; now?: () => number; policy?: EntryPolicy;
}): SignalExecutionGuard {
  const policy = input.policy ?? DEFAULT_ENTRY_POLICY;
  const signal = input.evaluation;
  const clock = input.now ?? Date.now;
  if (signal.decision !== DecisionAction.BUY || !Number.isFinite(signal.signalAt) ||
      ![input.initialPriceSol, signal.signalPriceSol, signal.signalAnchorSol].every(v => Number.isFinite(v) && v! > 0) ||
      !Number.isFinite(input.startedAt) || input.startedAt < signal.signalAt!) throw new Error('No executable early-entry signal');
  const maxEntryPriceSol = Math.min(
    input.initialPriceSol * (1 + policy.maxRunupPct / 100),
    signal.signalPriceSol! * (1 + policy.maxSignalDriftPct / 100),
    signal.signalAnchorSol! * (1 + policy.maxAnchorExtensionPct / 100),
  );
  let checkedQuote: ExecutableEntry | undefined;
  const validateTiming = (now: number) => {
    if (!Number.isFinite(now) || now < input.startedAt || now - input.startedAt > policy.maxExecutionLatencyMs ||
        now - signal.signalAt! > policy.maxSignalAgeMs) throw new Error('Entry alpha expired during execution');
  };
  const validateQuote = (quote: ExecutableEntry) => {
    validateTiming(quote.now);
    if (![quote.quoteFetchedAt, quote.exitQuoteFetchedAt, quote.worstEntryPriceSol, quote.roundTripCostPct].every(Number.isFinite) ||
        quote.quoteFetchedAt > quote.now || quote.exitQuoteFetchedAt > quote.now ||
        quote.now - quote.quoteFetchedAt > policy.maxQuoteAgeMs || quote.now - quote.exitQuoteFetchedAt > policy.maxQuoteAgeMs) throw new Error('Entry/exit quote missing or stale');
    if (quote.worstEntryPriceSol <= 0 || quote.worstEntryPriceSol > maxEntryPriceSol) throw new Error('Execution price exceeds the confirmed no-chase ceiling');
    if (quote.roundTripCostPct < 0 || quote.roundTripCostPct > policy.maxRoundTripCostPct) throw new Error('Executable round-trip cost outside the conservative budget');
    checkedQuote = { ...quote };
  };
  return {
    maxEntryPriceSol,
    validateQuote,
    validate: () => {
      const now = clock();
      validateTiming(now);
      if (!checkedQuote) throw new Error('Executable entry and exit evidence required before signing');
      validateQuote({ ...checkedQuote, now });
      input.validateSignal();
    },
  };
}
