import React, { useState } from 'react';
import {
  Wallet,
  Zap,
  ShieldCheck,
  Flame,
  AlertTriangle,
  Sliders,
  Play,
  Pause,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Sparkles,
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
  onSetSystemMode,
  walletConfig,
  onOpenRealTradeModal,
  onNavigateToWallet,
  onToggleAutotrade,
}) => {
  const [quickMintInput, setQuickMintInput] = useState('');
  const [showLiveConfirmModal, setShowLiveConfirmModal] = useState(false);

  const isLiveSystemMode = currentSystemMode === SystemMode.LIVE;
  const isConnected = Boolean(walletConfig?.isConnected && walletConfig?.walletAddress);
  const balanceSol = walletConfig?.balanceSol ?? 0;
  const balanceUsd = walletConfig?.balanceUsd ?? 0;
  const allocatedSol = walletConfig?.allocatedCapitalSol ?? 0.08;
  const allocatedUsd = walletConfig?.allocatedCapitalUsd ?? (allocatedSol * SOL_USD_ESTIMATE);
  const targetTradeSol = walletConfig?.targetTradeSizeSol ?? 0.02;
  const isAutotradeOn = walletConfig?.autotradeMode && walletConfig.autotradeMode !== 'OFF';

  const handleModeToggle = () => {
    if (isLiveSystemMode) {
      onSetSystemMode(SystemMode.PAPER);
    } else {
      setShowLiveConfirmModal(true);
    }
  };

  const handleConfirmLive = () => {
    setShowLiveConfirmModal(false);
    onSetSystemMode(SystemMode.LIVE, true);
  };

  const handleQuickSnipe = (e: React.FormEvent) => {
    e.preventDefault();
    onOpenRealTradeModal(quickMintInput.trim() || undefined);
  };

  return (
    <>
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3.5 sm:p-4 mb-5 shadow-lg space-y-3 font-mono">
        {/* Top row: Mode Switcher & Real Wallet Status */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
          {/* Left: Mode Switcher */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-zinc-400 text-xs uppercase tracking-wider font-bold">
              Trading Execution Engine:
            </span>

            {/* Mode Indicator Pill */}
            <div className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 border transition ${
              isLiveSystemMode
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 animate-pulse'
                : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isLiveSystemMode ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span>{isLiveSystemMode ? 'REAL MONEY WALLET (LIVE)' : 'PAPER SIMULATION (TEST)'}</span>
            </div>

            {/* Switch Mode Button */}
            <button
              onClick={handleModeToggle}
              className={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 border ${
                isLiveSystemMode
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-amber-300 border-zinc-700'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 border-emerald-400 shadow-sm'
              }`}
            >
              <Zap className="w-3 h-3 fill-current" />
              <span>{isLiveSystemMode ? 'Switch to Paper Mode' : 'Switch to Real Money Trading'}</span>
            </button>
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
                  Active Capital: <strong className="text-amber-300">{allocatedSol.toFixed(3)} SOL</strong>
                </span>
                <span className="text-zinc-600">|</span>
                <span className="text-zinc-400 text-[11px]">
                  Ticket: <strong className="text-cyan-300">{targetTradeSol.toFixed(3)} SOL</strong>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-amber-950/30 border border-amber-500/30 px-3 py-1.5 rounded-lg text-amber-300 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Wallet not connected. Connect Phantom to enable real SOL trading.</span>
                <button
                  onClick={onNavigateToWallet}
                  className="px-2 py-0.5 rounded bg-amber-500 text-zinc-950 font-bold hover:bg-amber-400 transition text-[11px]"
                >
                  Connect Wallet
                </button>
              </div>
            )}

            <button
              onClick={onNavigateToWallet}
              className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
              title="Configure Capital Allocation, Sizing & Stop Losses"
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
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Real Trade Snipe:</span>
            </span>
            <div className="flex-1 flex items-center bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1">
              <input
                type="text"
                value={quickMintInput}
                onChange={(e) => setQuickMintInput(e.target.value)}
                placeholder="Paste token CA / Mint or click 'Real Buy' on any live token below..."
                className="w-full bg-transparent text-zinc-200 placeholder-zinc-600 text-xs font-mono focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold transition flex items-center gap-1 shrink-0 shadow-sm"
            >
              <Zap className="w-3 h-3 fill-current" />
              <span>Open Real Trade ({targetTradeSol} SOL)</span>
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

      {/* Confirmation Modal to switch to Real Live Money Trading */}
      {showLiveConfirmModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-emerald-500/50 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                <Zap className="w-6 h-6 fill-current" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-100">
                  Switch to Real Money Trading Mode?
                </h3>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                  You are engaging real Solana execution. Trades taken will use your connected wallet balance (allocated capital: <strong>{allocatedSol} SOL / ~${allocatedUsd.toFixed(2)}</strong>) with automated stop-loss protection.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5 text-[11px] text-zinc-300">
              <div className="text-emerald-400 font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Safeguards Active:</span>
              </div>
              <div>&bull; Max Ticket per Trade: <strong>{targetTradeSol} SOL</strong></div>
              <div>&bull; Protected Gas Floor: <strong>0.025 SOL (cannot be spent)</strong></div>
              <div>&bull; Auto Stop-Loss: <strong>-12% hard on-chain cut</strong></div>
              <div>&bull; Non-Custodial: <strong>Tokens route directly into your wallet</strong></div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                onClick={() => setShowLiveConfirmModal(false)}
                className="px-3.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLive}
                className="px-4 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold transition flex items-center gap-1 shadow-lg shadow-emerald-500/20"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Engage Real Money Mode</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
