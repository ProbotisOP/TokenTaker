import React, { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Layers,
  Sliders,
  ShieldCheck,
  Wallet,
  ExternalLink,
  CheckCircle2,
  Zap,
  Loader2,
} from 'lucide-react';
import { PortfolioState, RiskLimits, LivePortfolioTelemetry, WalletAutotradeConfig } from '../types.ts';

interface PortfolioOverviewProps {
  portfolio: PortfolioState;
  livePortfolio?: LivePortfolioTelemetry | null;
  riskLimits: RiskLimits;
  walletConfig?: WalletAutotradeConfig | null;
}

export const PortfolioOverview: React.FC<PortfolioOverviewProps> = ({
  portfolio,
  livePortfolio,
  riskLimits,
  walletConfig,
}) => {
  const solUsdRate = 170.0;

  // Real on-chain metrics
  const liveBalanceSol = livePortfolio?.onChainSolBalance ?? walletConfig?.balanceSol ?? 0;
  const liveBalanceUsd = liveBalanceSol * solUsdRate;
  const liveAllocatedSol = livePortfolio?.allocatedCapitalSol ?? walletConfig?.allocatedCapitalSol ?? 0;
  const liveAllocatedUsd = liveAllocatedSol * solUsdRate;
  const liveDailyPnlSol = livePortfolio?.dailyRealizedPnlSol ?? portfolio.dailyRealizedPnlSol ?? 0;
  const liveDailyPnlUsd = liveDailyPnlSol * solUsdRate;
  const isLiveDailyPos = liveDailyPnlSol >= 0;
  const liveExposureSol = livePortfolio?.activeLiveExposureSol ?? portfolio.activeExposureSol ?? 0;
  const liveUnrealizedSol = livePortfolio?.unrealizedPnlSol ?? portfolio.unrealizedPnlSol ?? 0;
  const isLiveUnrealizedPos = liveUnrealizedSol >= 0;
  const openCount = livePortfolio?.openPositionsCount ?? 0;

  const explorerBase = 'https://solscan.io/account/';
  const clusterParam = walletConfig?.network === 'devnet' ? '?cluster=devnet' : '';

  const [isReclaiming, setIsReclaiming] = useState(false);
  const [reclaimFeedback, setReclaimFeedback] = useState<string | null>(null);

  const handleReclaimAll = async () => {
    setIsReclaiming(true);
    setReclaimFeedback(null);
    try {
      const res = await fetch('/api/wallet/reclaim-all-tokens', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setReclaimFeedback(`Swapped ${data.swappedCount} token bag(s) back into ${data.totalSolReclaimed.toFixed(4)} SOL!`);
      } else {
        setReclaimFeedback(data.error || 'Reclaim failed');
      }
    } catch (e: any) {
      setReclaimFeedback(e.message || 'Network error');
    } finally {
      setIsReclaiming(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 mb-5">
      {/* Real Portfolio Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-emerald-950/80 border border-emerald-500/80 text-xs font-mono font-bold text-emerald-300 shadow-sm">
            <Wallet className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span>REAL ON-CHAIN WALLET PORTFOLIO</span>
            {walletConfig?.walletAddress && (
              <a
                href={`${explorerBase}${walletConfig.walletAddress}${clusterParam}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[11px] text-emerald-400 underline hover:text-emerald-200 ml-1"
                title="View in Phantom / Solscan"
              >
                <span>{walletConfig.walletAddress.slice(0, 4)}...{walletConfig.walletAddress.slice(-4)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>{walletConfig?.network ? walletConfig.network.toUpperCase() : 'MAINNET-BETA'}</span>
          </div>
        </div>

        {/* Action & Status */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleReclaimAll}
            disabled={isReclaiming}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-[11px] font-mono font-bold text-amber-300 transition"
            title="Convert all open meme coin bags directly back into pure SOL via Jupiter"
          >
            {isReclaiming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 fill-current" />}
            <span>{isReclaiming ? 'Liquidating Bags...' : '⚡ Reclaim All SOL'}</span>
          </button>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/40 border border-emerald-500/50 text-[11px] font-mono font-bold text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>REAL TRANSACTIONS ONLY &bull; VIEWABLE IN PHANTOM</span>
          </div>
        </div>
      </div>

      {/* Reclaim Feedback Banner */}
      {reclaimFeedback && (
        <div className="p-3 rounded-lg bg-emerald-950/80 border border-emerald-500/80 text-emerald-200 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{reclaimFeedback}</span>
          </div>
          <button
            onClick={() => setReclaimFeedback(null)}
            className="text-zinc-400 hover:text-zinc-200 text-xs font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Real On-Chain Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Real On-Chain Balance */}
        <div className="bg-zinc-900/90 border border-emerald-900/60 rounded-lg p-3 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
            <span className="text-emerald-400 font-bold">On-Chain Balance</span>
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="my-1.5">
            <div className="text-xl font-mono font-bold text-zinc-100">
              {liveBalanceSol.toFixed(4)} <span className="text-xs text-zinc-400">SOL</span>
            </div>
            <div className="text-xs font-mono text-zinc-400">
              &asymp; ${liveBalanceUsd.toFixed(2)} USD
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500 flex items-center justify-between">
            <span>Gas floor: {walletConfig?.gasReserveSol || 0.025} SOL</span>
            <span className="text-emerald-400">Phantom Synced</span>
          </div>
        </div>

        {/* 2. Allocated Capital */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
            <span>Allocated SOL</span>
            <Activity className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div className="my-1.5">
            <div className="text-xl font-mono font-bold text-zinc-100">
              {liveAllocatedSol.toFixed(4)} <span className="text-xs text-zinc-400">SOL</span>
            </div>
            <div className="text-xs font-mono text-zinc-400">
              &asymp; ${liveAllocatedUsd.toFixed(2)} USD
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500">
            Dedicated trading capital
          </div>
        </div>

        {/* 3. Live Active Exposure */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
            <span>Live Exposure</span>
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="my-1.5">
            <div className="text-xl font-mono font-bold text-zinc-100">
              {liveExposureSol.toFixed(4)} <span className="text-xs text-zinc-400">SOL</span>
            </div>
            <div className="text-xs font-mono text-cyan-400">
              {openCount} Open On-Chain Position{openCount === 1 ? '' : 's'}
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500 flex items-center justify-between">
            <span>Unrealized:</span>
            <span className={isLiveUnrealizedPos ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
              {isLiveUnrealizedPos ? '+' : ''}{liveUnrealizedSol.toFixed(4)} SOL
            </span>
          </div>
        </div>

        {/* 4. Live Realized PnL */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
            <span>Realized PnL</span>
            {isLiveDailyPos ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            )}
          </div>
          <div className="my-1.5">
            <div className={`text-xl font-mono font-bold ${isLiveDailyPos ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isLiveDailyPos ? '+' : ''}{liveDailyPnlSol.toFixed(4)} <span className="text-xs">SOL</span>
            </div>
            <div className="text-xs font-mono text-zinc-400">
              {isLiveDailyPos ? '+' : ''}${liveDailyPnlUsd.toFixed(2)} USD
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500">
            Confirmed On-Chain
          </div>
        </div>

        {/* 5. Keypair Security */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
            <span>Trading Keypair</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="my-1.5">
            <div className="text-sm font-mono font-bold text-emerald-400">
              {walletConfig?.hasDedicatedKeypair ? 'SECURE WORKER' : 'KEYPAIR MISSING'}
            </div>
            <div className="text-xs font-mono text-zinc-400 truncate">
              {walletConfig?.walletAddress ? `${walletConfig.walletAddress.slice(0, 6)}...${walletConfig.walletAddress.slice(-4)}` : 'Unconfigured'}
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500">
            Private key never in UI
          </div>
        </div>

        {/* 6. Execution Gate */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
            <span>Live Gate</span>
            <Sliders className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="my-1.5">
            <div className={`text-sm font-mono font-bold ${walletConfig?.lastPreflightPassed ? 'text-emerald-400' : 'text-amber-400'}`}>
              {walletConfig?.lastPreflightPassed ? 'PREFLIGHT PASSED' : 'PREFLIGHT REQUIRED'}
            </div>
            <div className="text-xs font-mono text-zinc-400">
              Mode: {walletConfig?.autotradeMode || '1-CLICK ONLY'}
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500">
            Max Slippage: {walletConfig?.maxSlippagePct || 2.0}%
          </div>
        </div>
      </div>
    </div>
  );
};
