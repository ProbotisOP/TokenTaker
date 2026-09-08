import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Layers,
  Percent,
  Sliders,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { PortfolioState, RiskLimits } from '../types.ts';

interface PortfolioOverviewProps {
  portfolio: PortfolioState;
  riskLimits: RiskLimits;
}

export const PortfolioOverview: React.FC<PortfolioOverviewProps> = ({ portfolio, riskLimits }) => {
  const solUsdRate = 155.0;
  const equityUsd = portfolio.equitySol * solUsdRate;
  const dailyPnlUsd = portfolio.dailyRealizedPnlSol * solUsdRate;
  const isDailyPnlPos = portfolio.dailyRealizedPnlSol >= 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
      {/* 1. Total Equity */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
          <span>Account Equity</span>
          <Activity className="w-3.5 h-3.5 text-zinc-500" />
        </div>
        <div className="my-1.5">
          <div className="text-xl font-mono font-bold text-zinc-100">
            {portfolio.equitySol.toFixed(2)} <span className="text-xs text-zinc-400">SOL</span>
          </div>
          <div className="text-xs font-mono text-zinc-400">
            &asymp; ${equityUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 flex items-center justify-between">
          <span>Peak: {portfolio.peakEquitySol.toFixed(2)} SOL</span>
          <span>Cash: {portfolio.cashSol.toFixed(2)}</span>
        </div>
      </div>

      {/* 2. Daily PnL */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
          <span>Daily Realized PnL</span>
          {isDailyPnlPos ? (
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
          )}
        </div>
        <div className="my-1.5">
          <div className={`text-xl font-mono font-bold ${isDailyPnlPos ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isDailyPnlPos ? '+' : ''}{portfolio.dailyRealizedPnlSol.toFixed(3)} <span className="text-xs">SOL</span>
          </div>
          <div className="text-xs font-mono text-zinc-400">
            {isDailyPnlPos ? '+' : ''}${dailyPnlUsd.toFixed(2)}
          </div>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 flex items-center justify-between">
          <span>Limit: -{riskLimits.maxDailyLossSol} SOL</span>
          <span className="text-zinc-400">Total: {portfolio.totalRealizedPnlSol >= 0 ? '+' : ''}{portfolio.totalRealizedPnlSol.toFixed(2)}</span>
        </div>
      </div>

      {/* 3. Active Exposure */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
          <span>Active Exposure</span>
          <Layers className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <div className="my-1.5">
          <div className="text-xl font-mono font-bold text-zinc-100">
            {portfolio.activeExposureSol.toFixed(2)} <span className="text-xs text-zinc-400">SOL</span>
          </div>
          <div className="text-xs font-mono text-amber-400">
            {((portfolio.activeExposureSol / Math.max(0.1, portfolio.equitySol)) * 100).toFixed(1)}% of Equity
          </div>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 flex items-center justify-between">
          <span>Unrealized:</span>
          <span className={portfolio.unrealizedPnlSol >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
            {portfolio.unrealizedPnlSol >= 0 ? '+' : ''}{portfolio.unrealizedPnlSol.toFixed(3)} SOL
          </span>
        </div>
      </div>

      {/* 4. Peak Drawdown */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
          <span>Drawdown State</span>
          <Percent className="w-3.5 h-3.5 text-zinc-500" />
        </div>
        <div className="my-1.5">
          <div className="text-xl font-mono font-bold text-zinc-100">
            {portfolio.currentDrawdownPct.toFixed(1)}%
          </div>
          <div className="text-xs font-mono text-zinc-400">
            Max Peak DD: <span className="text-rose-400">{portfolio.maxDrawdownPct.toFixed(1)}%</span>
          </div>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 flex items-center justify-between">
          <span>Consecutive Losses:</span>
          <span className={portfolio.consecutiveLosses > 0 ? 'text-amber-400 font-bold' : 'text-zinc-400'}>
            {portfolio.consecutiveLosses}/{riskLimits.maxConsecutiveLosses}
          </span>
        </div>
      </div>

      {/* 5. Expectancy & Win Rate */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
          <span>Statistical Edge</span>
          <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
        </div>
        <div className="my-1.5">
          <div className="text-xl font-mono font-bold text-cyan-300">
            +{(portfolio.rollingExpectancySol).toFixed(2)} <span className="text-xs text-zinc-400">SOL/T</span>
          </div>
          <div className="text-xs font-mono text-zinc-400">
            Win Rate: <span className="text-emerald-400 font-bold">{(portfolio.rollingWinRate * 100).toFixed(0)}%</span>
          </div>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 flex items-center justify-between">
          <span>Profit Factor:</span>
          <span className="text-zinc-200 font-semibold">{portfolio.profitFactor.toFixed(2)}x</span>
        </div>
      </div>

      {/* 6. Adaptive Sizing & Gatekeeper */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
          <span>Adaptive Sizer</span>
          <Sliders className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <div className="my-1.5">
          <div className="text-xl font-mono font-bold text-indigo-300">
            {portfolio.adaptiveMultiplier.toFixed(2)}x
          </div>
          <div className="text-xs font-mono text-zinc-400 flex items-center gap-1">
            {portfolio.consecutiveLosses > 0 ? (
              <span className="text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Anti-Martingale Dampened
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Baseline Sizing Optimal
              </span>
            )}
          </div>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 flex items-center justify-between">
          <span>Circuit Breaker:</span>
          <span className={riskLimits.circuitBreakerActive ? 'text-rose-400 font-bold' : 'text-emerald-400 font-semibold'}>
            {riskLimits.circuitBreakerActive ? 'TRIPPED' : 'ARMED (OK)'}
          </span>
        </div>
      </div>
    </div>
  );
};
