import React, { useState } from 'react';
import {
  Play,
  RotateCcw,
  TrendingUp,
  Percent,
  Layers,
  Activity,
  ShieldCheck,
  Zap,
  BarChart2,
  Calendar,
  Sliders,
} from 'lucide-react';
import { BacktestResults } from '../types.ts';
import { BoundedTunerStudio } from './BoundedTunerStudio.tsx';

export const BacktestStudio: React.FC = () => {
  const [studioMode, setStudioMode] = useState<'BACKTEST' | 'TUNER'>('BACKTEST');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BacktestResults | null>(null);

  const [initialCapitalSol, setInitialCapitalSol] = useState(50);
  const [minSafetyScore, setMinSafetyScore] = useState(80);
  const [minOpportunityScore, setMinOpportunityScore] = useState(75);
  const [slippageTolerancePct, setSlippageTolerancePct] = useState(2.5);
  const [simulatedLatencyJitterMs, setSimulatedLatencyJitterMs] = useState(200);

  const handleResetDefaults = () => {
    setInitialCapitalSol(50);
    setMinSafetyScore(80);
    setMinOpportunityScore(75);
    setSlippageTolerancePct(2.5);
    setSimulatedLatencyJitterMs(200);
  };

  const handleRunBacktest = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initialCapitalSol,
          minSafetyScore,
          minOpportunityScore,
          slippageTolerancePct,
          simulatedLatencyJitterMs,
        }),
      });
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
      }
    } catch (err) {
      console.error('Backtest error', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header with Sub-Mode Navigation */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-xs font-mono">
            <button
              onClick={() => setStudioMode('BACKTEST')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition font-semibold ${
                studioMode === 'BACKTEST'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Backtest &amp; Simulation</span>
            </button>
            <button
              onClick={() => setStudioMode('TUNER')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition font-semibold ${
                studioMode === 'TUNER'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Bounded Parameter Tuner</span>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-950 text-indigo-200 border border-indigo-700">
                Hard Stop
              </span>
            </button>
          </div>
        </div>
        <div className="text-[11px] font-mono text-zinc-500">
          {studioMode === 'BACKTEST'
            ? 'Zero Future Information • AMM Slippage Curves • Latency Jitter'
            : 'Deterministic Bounds • Stagnation Detection • Strict Acceptance Audit'}
        </div>
      </div>

      <div className="p-4 space-y-5 overflow-y-auto flex-1">
        {studioMode === 'TUNER' ? (
          <BoundedTunerStudio />
        ) : (
          <>
            {/* Parameter Inputs Panel */}
            <div className="bg-zinc-950/60 p-4 rounded-lg border border-zinc-800 text-xs font-mono">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Initial Capital (SOL)</label>
              <input
                type="number"
                value={initialCapitalSol}
                onChange={(e) => setInitialCapitalSol(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200"
              />
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Min Safety Score (0-100)</label>
              <input
                type="number"
                value={minSafetyScore}
                onChange={(e) => setMinSafetyScore(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200"
              />
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Min Alpha Score (0-100)</label>
              <input
                type="number"
                value={minOpportunityScore}
                onChange={(e) => setMinOpportunityScore(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200"
              />
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Max Slippage (%)</label>
              <input
                type="number"
                step="0.1"
                value={slippageTolerancePct}
                onChange={(e) => setSlippageTolerancePct(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200"
              />
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">Simulated Latency Jitter (ms)</label>
              <input
                type="number"
                value={simulatedLatencyJitterMs}
                onChange={(e) => setSimulatedLatencyJitterMs(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between pt-3 border-t border-zinc-800 gap-2 flex-wrap">
            <div className="text-[11px] text-zinc-500">
              Walk-forward evaluation: 50% Train, 25% Validation, 25% Out-of-Sample.
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleResetDefaults}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold text-xs transition active:scale-95 disabled:opacity-50 cursor-pointer"
                title="Reset simulation parameters to defaults"
              >
                <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
                <span>Reset Defaults</span>
              </button>

              <button
                onClick={handleRunBacktest}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs uppercase tracking-wider transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {loading ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>{loading ? 'Simulating...' : 'Execute Backtest'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Results Output */}
        {results ? (
          <div className="space-y-4 text-xs font-mono">
            {/* Top KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-500 text-[11px]">Total Return</div>
                <div className={`text-base font-bold mt-0.5 ${results.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {results.totalReturnPct >= 0 ? '+' : ''}{results.totalReturnPct}%
                </div>
                <div className="text-[10px] text-zinc-500">CAGR: {results.cagrPct}%</div>
              </div>

              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-500 text-[11px]">Max Drawdown</div>
                <div className="text-base font-bold mt-0.5 text-rose-400">
                  -{results.maxDrawdownPct}%
                </div>
                <div className="text-[10px] text-zinc-500">Peak equity buffer</div>
              </div>

              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-500 text-[11px]">Sharpe / Sortino</div>
                <div className="text-base font-bold mt-0.5 text-cyan-300">
                  {results.sharpeRatio} <span className="text-zinc-500 text-xs">/ {results.sortinoRatio}</span>
                </div>
                <div className="text-[10px] text-zinc-500">Risk-adjusted return</div>
              </div>

              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-500 text-[11px]">Win Rate</div>
                <div className="text-base font-bold mt-0.5 text-emerald-400">
                  {results.winRate}%
                </div>
                <div className="text-[10px] text-zinc-500">
                  {results.winningTrades}W / {results.losingTrades}L ({results.totalTrades} total)
                </div>
              </div>

              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-500 text-[11px]">Profit Factor</div>
                <div className="text-base font-bold mt-0.5 text-zinc-200">
                  {results.profitFactor}x
                </div>
                <div className="text-[10px] text-zinc-500">
                  Exp: +{results.expectancySol} SOL
                </div>
              </div>

              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-500 text-[11px]">Execution Drag</div>
                <div className="text-base font-bold mt-0.5 text-amber-400">
                  {results.totalFeesPaidSol.toFixed(2)} SOL
                </div>
                <div className="text-[10px] text-zinc-500">
                  Slip: {results.totalSlippageCostSol.toFixed(2)} SOL
                </div>
              </div>
            </div>

            {/* Walk Forward Summary & Monte Carlo */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Walk Forward */}
              <div className="bg-zinc-950/60 p-3.5 rounded border border-zinc-800">
                <div className="text-zinc-300 font-bold mb-2 flex items-center justify-between">
                  <span>Walk-Forward Out-Of-Sample Validation</span>
                  <span className={results.walkForwardSummary.degradationPct < 15 ? 'text-emerald-400 text-[11px]' : 'text-amber-400 text-[11px]'}>
                    Degradation: {results.walkForwardSummary.degradationPct}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-zinc-900 p-2 rounded">
                    <div className="text-zinc-500 text-[10px]">Train (50%)</div>
                    <div className="font-bold text-zinc-200">{results.walkForwardSummary.trainWinRate}%</div>
                  </div>
                  <div className="bg-zinc-900 p-2 rounded">
                    <div className="text-zinc-500 text-[10px]">Val (25%)</div>
                    <div className="font-bold text-zinc-200">{results.walkForwardSummary.valWinRate}%</div>
                  </div>
                  <div className="bg-zinc-900 p-2 rounded">
                    <div className="text-zinc-500 text-[10px]">Out-of-Sample (25%)</div>
                    <div className="font-bold text-emerald-400">{results.walkForwardSummary.oosWinRate}%</div>
                  </div>
                </div>
              </div>

              {/* Monte Carlo 1,000 Iterations */}
              <div className="bg-zinc-950/60 p-3.5 rounded border border-zinc-800">
                <div className="text-zinc-300 font-bold mb-2 flex items-center justify-between">
                  <span>Monte Carlo Reshuffle (1,000 Paths)</span>
                  <span className="text-zinc-500 text-[11px]">Bootstrap Resampling</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-zinc-900 p-2 rounded">
                    <div className="text-zinc-500 text-[10px]">5th %ile DD</div>
                    <div className="font-bold text-emerald-400">-{results.monteCarlo.p5Drawdown}%</div>
                  </div>
                  <div className="bg-zinc-900 p-2 rounded">
                    <div className="text-zinc-500 text-[10px]">Median DD</div>
                    <div className="font-bold text-zinc-200">-{results.monteCarlo.medianDrawdown}%</div>
                  </div>
                  <div className="bg-zinc-900 p-2 rounded">
                    <div className="text-zinc-500 text-[10px]">95th %ile DD</div>
                    <div className="font-bold text-rose-400">-{results.monteCarlo.p95Drawdown}%</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Breakdown Tables */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* By Venue */}
              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-400 font-bold mb-2 text-[11px] uppercase">By Launch Venue</div>
                <div className="space-y-1 text-[11px]">
                  {Object.entries(results.venueBreakdown).map(([k, vVal]) => {
                    const v = vVal as { trades: number; winRate: number; pnlSol: number };
                    return (
                      <div key={k} className="flex justify-between py-0.5 border-b border-zinc-900">
                        <span className="text-zinc-300 truncate max-w-[100px]">{k}</span>
                        <span className="text-zinc-400">{v.winRate}% WR ({v.pnlSol >= 0 ? '+' : ''}{v.pnlSol} SOL)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* By Liquidity */}
              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-400 font-bold mb-2 text-[11px] uppercase">By Liquidity Bucket</div>
                <div className="space-y-1 text-[11px]">
                  {Object.entries(results.liquidityBreakdown).map(([k, vVal]) => {
                    const v = vVal as { trades: number; winRate: number; pnlSol: number };
                    return (
                      <div key={k} className="flex justify-between py-0.5 border-b border-zinc-900">
                        <span className="text-zinc-300">{k}</span>
                        <span className="text-zinc-400">{v.winRate}% WR ({v.pnlSol >= 0 ? '+' : ''}{v.pnlSol} SOL)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* By Score */}
              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-400 font-bold mb-2 text-[11px] uppercase">By Score Bucket</div>
                <div className="space-y-1 text-[11px]">
                  {Object.entries(results.scoreBreakdown).map(([k, vVal]) => {
                    const v = vVal as { trades: number; winRate: number; pnlSol: number };
                    return (
                      <div key={k} className="flex justify-between py-0.5 border-b border-zinc-900">
                        <span className="text-zinc-300">{k}</span>
                        <span className="text-zinc-400">{v.winRate}% WR ({v.pnlSol >= 0 ? '+' : ''}{v.pnlSol} SOL)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* By Regime */}
              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800">
                <div className="text-zinc-400 font-bold mb-2 text-[11px] uppercase">By Market Regime</div>
                <div className="space-y-1 text-[11px]">
                  {Object.entries(results.regimeBreakdown).map(([k, vVal]) => {
                    const v = vVal as { trades: number; winRate: number; pnlSol: number };
                    return (
                      <div key={k} className="flex justify-between py-0.5 border-b border-zinc-900">
                        <span className="text-zinc-300 truncate max-w-[100px]">{k.replace('_', ' ')}</span>
                        <span className="text-zinc-400">{v.winRate}% WR ({v.pnlSol >= 0 ? '+' : ''}{v.pnlSol} SOL)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-xs font-mono text-zinc-500 bg-zinc-950/30 rounded border border-zinc-800/60">
            Configure parameter criteria above and click &ldquo;Execute Backtest&rdquo; to simulate causal historical execution.
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
};
