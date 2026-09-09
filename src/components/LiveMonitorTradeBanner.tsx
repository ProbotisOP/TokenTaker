import React, { useState } from 'react';
import {
  Wallet,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Sliders,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { SystemMode, WalletAutotradeConfig } from '../types.ts';

interface LiveMonitorTradeBannerProps {
  currentSystemMode: SystemMode;
  onSetSystemMode: (mode: SystemMode, confirmedLive?: boolean) => void;
  walletConfig: WalletAutotradeConfig | null;
  onOpenRealTradeModal: (initialMint?: string, initialSymbol?: string) => void;
  onNavigateToWallet: () => void;
  onToggleAutotrade?: () => void;
}

const SOL_USD_ESTIMATE = 170;

export const LiveMonitorTradeBanner: React.FC<LiveMonitorTradeBannerProps> = ({
  currentSystemMode,
  walletConfig,
  onOpenRealTradeModal,
  onNavigateToWallet,
}) => {
  const [quickMintInput, setQuickMintInput] = useState('');

  const isConnected = Boolean(walletConfig?.isConnected && walletConfig?.walletAddress);
  const balanceSol = walletConfig?.balanceSol ?? 0;
  const balanceUsd = walletConfig?.balanceUsd ?? 0;
  const allocatedSol = walletConfig?.allocatedCapitalSol ?? 0.08;
  const targetTradeSol = walletConfig?.targetTradeSizeSol ?? 0.02;
  const isAutotradeOn = walletConfig?.autotradeMode && walletConfig.autotradeMode !== 'OFF';

  const handleQuickSnipe = (e: React.FormEvent) => {
    e.preventDefault();
    onOpenRealTradeModal(quickMintInput.trim() || undefined);
  };

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3.5 sm:p-4 mb-5 shadow-lg space-y-3 font-mono">
      {/* Top row: Real Wallet Status & Mode */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
        {/* Left: Real Trading Mode Badge */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-zinc-400 text-xs uppercase tracking-wider font-bold">
            Execution Mode:
          </span>

          <div className="px-3 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 border bg-emerald-950/80 border-emerald-500/60 text-emerald-300 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>REAL ON-CHAIN WALLET TRADING (JUPITER / DEX)</span>
          </div>

          <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Zero Simulation &bull; Viewable in Phantom</span>
          </div>
        </div>

        {/* Right: Wallet Balance & Capital Allocation Ticker */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-xs">
          {isConnected ? (
            <div className="flex items-center gap-2 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800">
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-zinc-400">
                {walletConfig?.walletName?.slice(0, 8)} ({walletConfig?.walletAddress?.slice(0, 4)}...{walletConfig?.walletAddress?.slice(-4)}):
              </span>
              <span className="text-emerald-400 font-bold">
                {balanceSol.toFixed(3)} SOL
              </span>
              <span className="text-zinc-500 text-[11px]">
                (~${balanceUsd.toFixed(2)})
              </span>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-400 text-[11px]">
                Allocated: <strong className="text-amber-300">{allocatedSol.toFixed(3)} SOL</strong>
              </span>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-400 text-[11px]">
                Ticket: <strong className="text-cyan-300">{targetTradeSol.toFixed(3)} SOL</strong>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-amber-950/30 border border-amber-500/30 px-3 py-1.5 rounded-lg text-amber-300 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Dedicated Trading Wallet not connected.</span>
              <button
                onClick={onNavigateToWallet}
                className="px-2 py-0.5 rounded bg-emerald-500 text-zinc-950 font-bold hover:bg-emerald-400 transition text-[11px]"
              >
                Setup Wallet
              </button>
            </div>
          )}

          <button
            onClick={onNavigateToWallet}
            className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
            title="Configure Dedicated Keypair, Capital Allocation & Sizing"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom row: 1-Click Quick Snipe Bar & Autotrade trigger status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        {/* Quick Snipe input */}
        <form onSubmit={handleQuickSnipe} className="flex-1 flex items-center gap-2">
          <span className="text-zinc-400 text-[11px] shrink-0 flex items-center gap-1 font-semibold">
            <Zap className="w-3 h-3 text-emerald-400 fill-current" />
            <span>⚡ 1-Click Real Snipe:</span>
          </span>
          <div className="flex-1 flex items-center bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1">
            <input
              type="text"
              value={quickMintInput}
              onChange={(e) => setQuickMintInput(e.target.value)}
              placeholder="Paste token CA / Mint or click '1-Click Real Buy' on any live token..."
              className="w-full bg-transparent text-zinc-200 placeholder-zinc-600 text-xs font-mono focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold transition flex items-center gap-1 shrink-0 shadow-sm"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>⚡ 1-Click Real Buy ({targetTradeSol} SOL)</span>
          </button>
        </form>

        {/* Autotrade status badge & switch */}
        <div className="flex items-center gap-2 shrink-0 bg-zinc-950 px-2.5 py-1 rounded border border-zinc-800">
          <span className="text-[11px] text-zinc-400">Autonomous Real Sniping:</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
            isAutotradeOn
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              : 'bg-zinc-800 text-zinc-500'
          }`}>
            {isAutotradeOn ? 'ACTIVE' : 'OFF'}
          </span>
          <button
            onClick={onNavigateToWallet}
            className="text-[10px] text-cyan-400 hover:text-cyan-300 underline ml-1"
          >
            Setup Rules &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
