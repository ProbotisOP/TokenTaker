import React, { useState, useEffect, useRef } from 'react';
import {
  Sliders,
  Play,
  Square,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Activity,
  ShieldAlert,
  Layers,
  ChevronRight,
  TrendingUp,
  Target,
  FileText,
} from 'lucide-react';
import {
  TuningAcceptanceCriteria,
  TuningCandidateEvaluation,
  TuningProgressState,
  TuningRunResult,
  TuningTerminationConditions,
} from '../types.ts';
import { DEFAULT_ACCEPTANCE_CRITERIA, DEFAULT_TERMINATION_CONDITIONS } from '../trading/parameterTuner.ts';

export const BoundedTunerStudio: React.FC = () => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [conditions, setConditions] = useState<TuningTerminationConditions>(DEFAULT_TERMINATION_CONDITIONS);
  const [criteria, setCriteria] = useState<TuningAcceptanceCriteria>(DEFAULT_ACCEPTANCE_CRITERIA);
  const [result, setResult] = useState<TuningRunResult | null>(null);

  // Live progress tracking
  const [progress, setProgress] = useState<TuningProgressState>({
    status: 'IDLE',
    currentIteration: 0,
    maxIterations: DEFAULT_TERMINATION_CONDITIONS.maxIterations,
    elapsedMs: 0,
    maxRuntimeMs: DEFAULT_TERMINATION_CONDITIONS.maxRuntimeMs,
    currentBestScore: -Infinity,
    currentlyFailingCriteria: [],
    bestCandidateSoFar: null,
    terminationReason: null,
  });

  const pollingRef = useRef<any>(null);

  const pollProgress = async () => {
    try {
      const res = await fetch('/api/tuner/progress');
      const data = await res.json();
      if (data.success && data.progress) {
        setProgress(data.progress);
        if (data.progress.status === 'COMPLETED' || data.progress.status === 'STOPPED') {
          setIsRunning(false);
          clearInterval(pollingRef.current);
        }
      }
    } catch (err) {
      console.error('Failed to poll progress:', err);
    }
  };

  const handleStartTuning = async () => {
    setIsRunning(true);
    setResult(null);

    // Initial progress display
    setProgress({
      status: 'RUNNING',
      currentIteration: 0,
      maxIterations: conditions.maxIterations,
      elapsedMs: 0,
      maxRuntimeMs: conditions.maxRuntimeMs,
      currentBestScore: -Infinity,
      currentlyFailingCriteria: [],
      bestCandidateSoFar: null,
      terminationReason: null,
    });

    // Start polling progress
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(pollProgress, 100);

    try {
      const res = await fetch('/api/tuner/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions, criteria }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setResult(data.result);
        if (data.result.bestCandidate) {
          setProgress(prev => ({
            ...prev,
            status: 'COMPLETED',
            currentIteration: data.result.totalIterations,
            elapsedMs: data.result.elapsedMs,
            currentBestScore: data.result.bestCandidate.objectiveScore,
            currentlyFailingCriteria: data.result.failedCriteria,
            bestCandidateSoFar: data.result.bestCandidate,
            terminationReason: data.result.terminationReason,
          }));
        }
      }
    } catch (err) {
      console.error('Tuning error:', err);
    } finally {
      setIsRunning(false);
      clearInterval(pollingRef.current);
    }
  };

  const handleStopTuning = async () => {
    try {
      await fetch('/api/tuner/stop', { method: 'POST' });
      setIsRunning(false);
      clearInterval(pollingRef.current);
      pollProgress();
    } catch (err) {
      console.error('Failed to stop tuner:', err);
    }
  };

  useEffect(() => {
    // Fetch initial state or last result
    fetch('/api/tuner/last-result')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.result) {
          setResult(data.result);
        }
      })
      .catch(() => {});

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const progressPercent = Math.min(
    100,
    Math.max(
      (progress.currentIteration / (conditions.maxIterations || 1)) * 100,
      (progress.elapsedMs / (conditions.maxRuntimeMs || 1)) * 100
    )
  );

  return (
    <div className="space-y-6 text-zinc-200">
      {/* Top Banner: Hard-Bounded Tuner Philosophy */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sliders className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-bold font-mono text-zinc-100 uppercase tracking-wide">
                Bounded Parameter Tuner &amp; Acceptance Auditor
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                HARD TERMINATION
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Guaranteed deterministic bounds: stops on runtime limit, iteration cap, stagnation, or criteria satisfaction. Never searches indefinitely.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <button
                onClick={handleStopTuning}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-xs shadow-lg shadow-red-950/50 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>STOP TUNING</span>
              </button>
            ) : (
              <button
                onClick={handleStartTuning}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold text-xs shadow-lg shadow-indigo-950/50 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>RUN BOUNDED TUNING</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Progress Bar & Status Readout */}
        <div className="mt-4 p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="text-zinc-400">STATUS:</span>
              <span
                className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                  isRunning
                    ? 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse'
                    : progress.status === 'COMPLETED'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : progress.status === 'STOPPED'
                    ? 'bg-red-950 text-red-300 border border-red-800'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {progress.status}
              </span>
              {progress.terminationReason && (
                <span className="text-zinc-400 text-[11px]">
                  Reason: <strong className="text-zinc-200">{progress.terminationReason}</strong>
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 text-zinc-300">
              <div>
                Iteration: <strong className="text-indigo-400">{progress.currentIteration}</strong> / {conditions.maxIterations}
              </div>
              <div>
                Elapsed: <strong className="text-cyan-400">{(progress.elapsedMs / 1000).toFixed(2)}s</strong> / {(conditions.maxRuntimeMs / 1000).toFixed(1)}s
              </div>
              <div>
                Best Score: <strong className="text-emerald-400">{progress.currentBestScore === -Infinity ? '—' : progress.currentBestScore}</strong>
              </div>
            </div>
          </div>

          {/* Visual Progress Bar */}
          <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden border border-zinc-800">
            <div
              className={`h-full transition-all duration-150 ${
                isRunning ? 'bg-indigo-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Currently Failing Criteria Live Feed */}
          {isRunning && progress.currentlyFailingCriteria.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-300/90 font-mono bg-amber-950/30 p-2.5 rounded-lg border border-amber-800/40">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-amber-200">Currently Failing Criteria in Best Candidate:</span>
                <ul className="list-disc list-inside mt-0.5 space-y-0.5 text-[11px] text-amber-400/80">
                  {progress.currentlyFailingCriteria.map((fc, i) => (
                    <li key={i}>{fc}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* VERDICT BANNER (If tuning completed or stopped) */}
      {result && (
        <div
          className={`p-5 rounded-xl border font-mono shadow-xl transition ${
            result.verdict === 'PASS'
              ? 'bg-emerald-950/30 border-emerald-500/60 text-emerald-200'
              : 'bg-red-950/30 border-red-500/60 text-red-200'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3 mb-3">
            <div className="flex items-center gap-3">
              {result.verdict === 'PASS' ? (
                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/40">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              ) : (
                <div className="p-2 bg-red-500/20 text-red-400 rounded-lg border border-red-500/40">
                  <XCircle className="w-6 h-6" />
                </div>
              )}
              <div>
                <div className="text-lg font-bold tracking-tight">
                  VERDICT: {result.verdict} — {result.verdict === 'PASS' ? 'CRITERIA MET' : 'CRITERIA NOT MET'}
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Terminated deterministically after {result.totalIterations} iterations in {(result.elapsedMs / 1000).toFixed(2)}s via <span className="font-bold text-zinc-200">{result.terminationReason}</span>.
                </div>
              </div>
            </div>

            <div className="text-right text-xs">
              <span className="text-zinc-500 block text-[10px]">ACCEPTANCE POLICY</span>
              <span className="font-bold text-zinc-300">STRICT NO-COMPROMISE</span>
            </div>
          </div>

          <p className="text-xs text-zinc-300 font-sans leading-relaxed mb-4">
            {result.verdictSummary}
          </p>

          {/* If Failed, list failed criteria clearly */}
          {result.failedCriteria.length > 0 && (
            <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-lg mb-4">
              <div className="flex items-center gap-2 text-xs font-bold text-red-300 mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Failed Acceptance Requirements ({result.failedCriteria.length}):</span>
              </div>
              <ul className="list-disc list-inside text-xs text-red-400 space-y-0.5">
                {result.failedCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {/* BEST CANDIDATE METRICS CARD */}
          <div className="bg-zinc-950/90 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-3 border-b border-zinc-800 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                Best Candidate Found (Iteration #{result.bestCandidate.iteration})
              </span>
              <span className="text-xs text-zinc-400">
                Objective Score: <strong className="text-emerald-400">{result.bestCandidate.objectiveScore}</strong>
              </span>
            </div>

            {/* Performance Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs mb-4">
              <div className="p-2.5 bg-zinc-900/80 rounded-lg border border-zinc-800">
                <span className="text-[10px] text-zinc-500 block">OOS EXPECTANCY</span>
                <span className={`text-base font-bold ${result.bestCandidate.oosExpectancySol >= criteria.minOosExpectancySol ? 'text-emerald-400' : 'text-amber-400'}`}>
                  +{result.bestCandidate.oosExpectancySol} SOL
                </span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">Req: ≥{criteria.minOosExpectancySol}</span>
              </div>

              <div className="p-2.5 bg-zinc-900/80 rounded-lg border border-zinc-800">
                <span className="text-[10px] text-zinc-500 block">OOS WIN RATE</span>
                <span className={`text-base font-bold ${result.bestCandidate.oosWinRatePct >= criteria.minOosWinRatePct ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {result.bestCandidate.oosWinRatePct}%
                </span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">Req: ≥{criteria.minOosWinRatePct}%</span>
              </div>

              <div className="p-2.5 bg-zinc-900/80 rounded-lg border border-zinc-800">
                <span className="text-[10px] text-zinc-500 block">MAX DRAWDOWN</span>
                <span className={`text-base font-bold ${result.bestCandidate.maxDrawdownPct <= criteria.maxDrawdownPct ? 'text-emerald-400' : 'text-red-400'}`}>
                  {result.bestCandidate.maxDrawdownPct}%
                </span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">Limit: ≤{criteria.maxDrawdownPct}%</span>
              </div>

              <div className="p-2.5 bg-zinc-900/80 rounded-lg border border-zinc-800">
                <span className="text-[10px] text-zinc-500 block">PROFIT FACTOR</span>
                <span className={`text-base font-bold ${result.bestCandidate.profitFactor >= criteria.minProfitFactor ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {result.bestCandidate.profitFactor}x
                </span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">Req: ≥{criteria.minProfitFactor}</span>
              </div>

              <div className="p-2.5 bg-zinc-900/80 rounded-lg border border-zinc-800">
                <span className="text-[10px] text-zinc-500 block">OOS SAMPLE SIZE</span>
                <span className={`text-base font-bold ${result.bestCandidate.oosSampleSize >= criteria.minOosSampleSize ? 'text-emerald-400' : 'text-red-400'}`}>
                  N = {result.bestCandidate.oosSampleSize}
                </span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">Req: ≥{criteria.minOosSampleSize}</span>
              </div>

              <div className="p-2.5 bg-zinc-900/80 rounded-lg border border-zinc-800">
                <span className="text-[10px] text-zinc-500 block">BRIER CALIBRATION</span>
                <span className={`text-base font-bold ${result.bestCandidate.calibrationBrierScore <= criteria.maxBrierScore ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {result.bestCandidate.calibrationBrierScore}
                </span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">{result.bestCandidate.calibrationReliability}</span>
              </div>

              <div className="p-2.5 bg-zinc-900/80 rounded-lg border border-zinc-800">
                <span className="text-[10px] text-zinc-500 block">SHARPE RATIO</span>
                <span className="text-base font-bold text-zinc-200">
                  {result.bestCandidate.sharpeRatio}
                </span>
                <span className="text-[9px] text-zinc-500 block mt-0.5">Annualized</span>
              </div>
            </div>

            {/* Discovered Best Parameters */}
            <div className="p-3 bg-zinc-900/60 rounded-lg border border-zinc-800">
              <span className="text-[11px] font-mono font-bold text-zinc-400 uppercase tracking-wider block mb-2">
                Discovered Parameter Set:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">minSafetyScore:</span>
                  <span className="font-bold text-zinc-200">{result.bestCandidate.parameters.minSafetyScore}</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">minOpportunityScore:</span>
                  <span className="font-bold text-zinc-200">{result.bestCandidate.parameters.minOpportunityScore}</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">slippageTolerancePct:</span>
                  <span className="font-bold text-zinc-200">{result.bestCandidate.parameters.slippageTolerancePct}%</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">maxDrawdownExitPct:</span>
                  <span className="font-bold text-zinc-200">{result.bestCandidate.parameters.maxDrawdownExitPct}%</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">takeProfitMultiplier:</span>
                  <span className="font-bold text-zinc-200">{result.bestCandidate.parameters.takeProfitMultiplier}x</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">stopLossPct:</span>
                  <span className="font-bold text-zinc-200">{result.bestCandidate.parameters.stopLossPct}%</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">walletMinReputation:</span>
                  <span className="font-bold text-zinc-200">{result.bestCandidate.parameters.walletMinReputation}</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">liquidityHurdleSol:</span>
                  <span className="font-bold text-zinc-200">{result.bestCandidate.parameters.liquidityHurdleSol} SOL</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIGURATION PANELS: HARD TERMINATION BOUNDS & UNCOMPROMISING CRITERIA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs font-mono">
        {/* Panel 1: Hard Termination Conditions */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-md">
          <div className="flex items-center gap-2 mb-3 border-b border-zinc-800 pb-3">
            <Clock className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-zinc-100 uppercase tracking-wider">
              1. Hard Termination Conditions (Never Loops Indefinitely)
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Max Runtime (ms)</label>
              <input
                type="number"
                value={conditions.maxRuntimeMs}
                onChange={e => setConditions(prev => ({ ...prev, maxRuntimeMs: Number(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Hard wall clock timeout</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Max Iterations</label>
              <input
                type="number"
                value={conditions.maxIterations}
                onChange={e => setConditions(prev => ({ ...prev, maxIterations: Number(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Upper bound on search trials</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Min Required OOS Sample Size</label>
              <input
                type="number"
                value={conditions.minOosSampleSize}
                onChange={e => setConditions(prev => ({ ...prev, minOosSampleSize: Number(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Statistical validity threshold</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Stagnation Detection Limit</label>
              <input
                type="number"
                value={conditions.stagnationLimit}
                onChange={e => setConditions(prev => ({ ...prev, stagnationLimit: Number(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Early stop if no progress</span>
            </div>
          </div>
        </div>

        {/* Panel 2: Acceptance Criteria (Fixed Target Hurdle) */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-md">
          <div className="flex items-center gap-2 mb-3 border-b border-zinc-800 pb-3">
            <Target className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-zinc-100 uppercase tracking-wider">
              2. Fixed Target Acceptance Criteria (No Lowering)
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Min OOS Net Expectancy (SOL)</label>
              <input
                type="number"
                step="0.05"
                value={criteria.minOosExpectancySol}
                onChange={e => setCriteria(prev => ({ ...prev, minOosExpectancySol: Number(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Post-friction net edge hurdle</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Min OOS Win Rate (%)</label>
              <input
                type="number"
                value={criteria.minOosWinRatePct}
                onChange={e => setCriteria(prev => ({ ...prev, minOosWinRatePct: Number(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Minimum win percentage</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Max Allowable Drawdown (%)</label>
              <input
                type="number"
                value={criteria.maxDrawdownPct}
                onChange={e => setCriteria(prev => ({ ...prev, maxDrawdownPct: Number(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Risk limit ceiling</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Min Profit Factor</label>
              <input
                type="number"
                step="0.1"
                value={criteria.minProfitFactor}
                onChange={e => setCriteria(prev => ({ ...prev, minProfitFactor: Number(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">Gross Profit / Gross Loss</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
