import React, { useState } from 'react';
import {
  ShieldAlert,
  Radio,
  Zap,
  Flame,
  Wallet,
  Clock,
  Lock,
  ChevronDown,
} from 'lucide-react';
import { SystemConfig, SystemMode } from '../types.ts';

interface HeaderProps {
  config: SystemConfig;
  circuitBreakerActive: boolean;
  onSetMode: (mode: SystemMode, confirmedLive?: boolean) => void;
  onEmergencyStop: () => void;
  onOpenWallet?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  config,
  circuitBreakerActive,
  onSetMode,
  onEmergencyStop,
  onOpenWallet,
}) => {
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [modeDropdown, setModeDropdown] = useState(false);

  const handleSelectMode = (newMode: SystemMode) => {
    setModeDropdown(false);
    if (newMode === SystemMode.LIVE) {
      setShowLiveConfirm(true);
    } else {
      onSetMode(newMode);
    }
  };

  const getModeBadgeClass = () => {
    switch (config.mode) {
      case SystemMode.LIVE:
        return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse';
      case SystemMode.PAPER:
        return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
      case SystemMode.BACKTEST:
        return 'bg-blue-500/15 text-blue-300 border border-blue-500/30';
      case SystemMode.SHADOW:
        return 'bg-purple-500/15 text-purple-300 border border-purple-500/30';
      case SystemMode.EMERGENCY_STOP:
        return 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-bounce';
    }
  };

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-6 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand & System Status */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 shadow-inner">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-wider text-zinc-100 uppercase">
                Solana Quant
              </h1>
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                v2.4.0-PROD
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              Low-Latency Event Stream &bull; Jito MEV Shield Active
            </p>
          </div>
        </div>

        {/* Telemetry Chips & Hot Wallet */}
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap text-xs font-mono">
          {/* Latency KPI */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900/90 border border-zinc-800 text-zinc-300">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-zinc-500">Latency:</span>
            <span className="text-cyan-300 font-semibold">44ms</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-500">Flight:</span>
            <span className="text-zinc-300">142ms</span>
          </div>

          {/* Hot Wallet Vault */}
          <button
            onClick={onOpenWallet}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-emerald-500/40 text-zinc-300 transition cursor-pointer"
            title="Open Real Wallet, Autotrade & Stop-Loss Settings"
          >
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-zinc-400 font-mono hidden md:inline">
              {config.hotWalletPublicKey?.slice(0, 4)}...{config.hotWalletPublicKey?.slice(-4)}
            </span>
            <span className="text-emerald-400 font-semibold ml-1">
              Wallet &amp; SL
            </span>
          </button>

          {/* Circuit Breaker Status */}
          {circuitBreakerActive && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-950/60 border border-rose-700/50 text-rose-300 font-semibold">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>CIRCUIT BREAKER LOCKED</span>
            </div>
          )}

          {/* Operational Mode Selector */}
          <div className="relative">
            <button
              onClick={() => setModeDropdown(!modeDropdown)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition ${getModeBadgeClass()}`}
            >
              <span>{config.mode} MODE</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </button>

            {modeDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl py-1 z-50 text-xs">
                {Object.values(SystemMode).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleSelectMode(m)}
                    className={`w-full text-left px-4 py-2 hover:bg-zinc-800 flex items-center justify-between ${
                      config.mode === m ? 'text-amber-400 font-bold' : 'text-zinc-300'
                    }`}
                  >
                    <span>{m}</span>
                    {m === SystemMode.LIVE && <Flame className="w-3 h-3 text-red-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* EMERGENCY KILL SWITCH */}
          <button
            onClick={() => setShowKillConfirm(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-950/40 transition active:scale-95"
            title="Immediately halt trading, cancel orders, and flatten open positions"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>KILL SWITCH</span>
          </button>
        </div>
      </div>

      {/* Emergency Kill Switch Modal */}
      {showKillConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-rose-500/50 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400 mb-3">
              <ShieldAlert className="w-8 h-8" />
              <h2 className="text-lg font-bold text-zinc-100">CONFIRM EMERGENCY KILL SWITCH</h2>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed mb-4">
              This action will <strong>immediately close all active positions at current market price</strong>,
              cancel all pending transactions, lock the circuit breaker, and halt the autonomous scanner.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowKillConfirm(false)}
                className="px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowKillConfirm(false);
                  onEmergencyStop();
                }}
                className="px-4 py-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider"
              >
                Execute Emergency Flatten
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Trading Warning Modal */}
      {showLiveConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-amber-500/40 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400 mb-3">
              <Lock className="w-7 h-7" />
              <h2 className="text-lg font-bold text-zinc-100">Switch to LIVE Capital Mode</h2>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed mb-3">
              LIVE mode transmits signed transactions to the Solana network. Ensure the hot wallet key is strictly protected,
              spending limits are enforced, and statistical edge has survived Out-Of-Sample validation.
            </p>
            <div className="bg-zinc-950 p-3 rounded border border-zinc-800 text-[11px] font-mono text-zinc-400 mb-4">
              &bull; Spending Limit: {config.hotWalletSpendingLimitSol} SOL Max<br />
              &bull; Priority Fee: {config.priorityFeeMicroLamports} &mu;Lamports/CU<br />
              &bull; Strict Stop Losses Enabled
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowLiveConfirm(false)}
                className="px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold"
              >
                Back to Safety
              </button>
              <button
                onClick={() => {
                  setShowLiveConfirm(false);
                  onSetMode(SystemMode.LIVE, true);
                }}
                className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider"
              >
                Confirm Live Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
