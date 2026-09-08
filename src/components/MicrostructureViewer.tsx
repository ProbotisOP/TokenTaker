import React, { useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Users,
  UserCheck,
  AlertOctagon,
  Radar,
  BarChart3,
  Zap,
} from 'lucide-react';
import { CandidateTokenState, WalletCategory } from '../types.ts';

interface MicrostructureViewerProps {
  candidate: CandidateTokenState | null;
  onRealBuy?: (candidate: CandidateTokenState) => void;
}

export const MicrostructureViewer: React.FC<MicrostructureViewerProps> = ({ candidate, onRealBuy }) => {
  const [selectedWindow, setSelectedWindow] = useState<'1s' | '3s' | '5s' | '10s' | '30s' | '60s'>('5s');

  if (!candidate) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6 text-center text-xs font-mono text-zinc-500">
        Select a candidate token from the live stream to inspect short-window microstructure and wallet flow.
      </div>
    );
  }

  const { micro, recentWallets, metadata } = candidate;
  const windowStats = micro.windows[selectedWindow];
  const buyRatio = micro.buySellRatio;
  const buyPct = (micro.buyVolumeSol / Math.max(0.01, micro.volumeSol)) * 100;
  const sellPct = 100 - buyPct;

  const getWalletCategoryColor = (cat: WalletCategory) => {
    switch (cat) {
      case WalletCategory.PROFITABLE_TRADER:
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case WalletCategory.SNIPER:
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
      case WalletCategory.INSIDER_LIKE:
      case WalletCategory.CREATOR_LINKED:
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30 font-bold';
      case WalletCategory.SYBIL_SUSPICIOUS:
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      default:
        return 'text-zinc-400 bg-zinc-800 border-zinc-700';
    }
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-cyan-400" />
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
            Microstructure &amp; Flow Intelligence: ${metadata.symbol}
          </h2>
        </div>

        {/* Short Window Buttons */}
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded border border-zinc-800 text-xs font-mono">
          {(['1s', '3s', '5s', '10s', '30s', '60s'] as const).map((win) => (
            <button
              key={win}
              onClick={() => setSelectedWindow(win)}
              className={`px-2 py-0.5 rounded transition ${
                selectedWindow === win
                  ? 'bg-cyan-500 text-zinc-950 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {win}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Top metrics grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Price Velocity */}
          <div className="bg-zinc-950/50 p-2.5 rounded border border-zinc-800/80">
            <div className="text-[11px] font-mono text-zinc-500">Price Velocity</div>
            <div className="text-base font-mono font-bold flex items-center gap-1 mt-0.5">
              {micro.priceVelocity >= 0 ? (
                <span className="text-emerald-400 flex items-center">
                  <ArrowUpRight className="w-4 h-4" />+{micro.priceVelocity.toFixed(1)}%/s
                </span>
              ) : (
                <span className="text-rose-400 flex items-center">
                  <ArrowDownRight className="w-4 h-4" />{micro.priceVelocity.toFixed(1)}%/s
                </span>
              )}
            </div>
            <div className="text-[10px] font-mono text-zinc-500">5s rolling speed</div>
          </div>

          {/* Volume Acceleration */}
          <div className="bg-zinc-950/50 p-2.5 rounded border border-zinc-800/80">
            <div className="text-[11px] font-mono text-zinc-500">Volume Velocity</div>
            <div className="text-base font-mono font-bold text-zinc-200 mt-0.5">
              {micro.volumeVelocity.toFixed(2)} <span className="text-xs font-normal text-zinc-500">SOL/s</span>
            </div>
            <div className="text-[10px] font-mono text-zinc-500">Total: {micro.volumeSol.toFixed(1)} SOL</div>
          </div>

          {/* Unique Traders */}
          <div className="bg-zinc-950/50 p-2.5 rounded border border-zinc-800/80">
            <div className="text-[11px] font-mono text-zinc-500">Buyers / Sellers</div>
            <div className="text-base font-mono font-bold text-zinc-200 mt-0.5 flex items-center gap-2">
              <span className="text-emerald-400">{micro.uniqueBuyers}B</span>
              <span className="text-zinc-600">/</span>
              <span className="text-rose-400">{micro.uniqueSellers}S</span>
            </div>
            <div className="text-[10px] font-mono text-zinc-500">
              New Wallet: {(micro.newWalletRate * 100).toFixed(0)}%
            </div>
          </div>

          {/* Window Delta */}
          <div className="bg-zinc-950/50 p-2.5 rounded border border-zinc-800/80">
            <div className="text-[11px] font-mono text-zinc-500">Delta ({selectedWindow})</div>
            <div className={`text-base font-mono font-bold mt-0.5 ${windowStats.priceChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {windowStats.priceChangePct >= 0 ? '+' : ''}{windowStats.priceChangePct.toFixed(1)}%
            </div>
            <div className="text-[10px] font-mono text-zinc-500">
              Net Flow: {windowStats.netFlowSol >= 0 ? '+' : ''}{windowStats.netFlowSol.toFixed(2)} SOL
            </div>
          </div>
        </div>

        {/* Buy / Sell Pressure Gauge Bar */}
        <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
          <div className="flex items-center justify-between text-xs font-mono mb-1.5">
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              Buy Pressure {buyPct.toFixed(0)}% ({micro.buyVolumeSol.toFixed(1)} SOL)
            </span>
            <span className="text-zinc-400 font-bold">
              B/S Ratio: <strong className="text-cyan-400">{buyRatio.toFixed(2)}x</strong>
            </span>
            <span className="text-rose-400 font-semibold flex items-center gap-1">
              Sell Pressure {sellPct.toFixed(0)}% ({micro.sellVolumeSol.toFixed(1)} SOL)
            </span>
          </div>

          <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden flex">
            <div
              className="bg-emerald-500 transition-all duration-300"
              style={{ width: `${Math.max(5, Math.min(95, buyPct))}%` }}
            />
            <div
              className="bg-rose-500 transition-all duration-300"
              style={{ width: `${Math.max(5, Math.min(95, sellPct))}%` }}
            />
          </div>
        </div>

        {/* Wallet Intelligence Stream */}
        <div>
          <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-2">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-zinc-400" />
              Active Wallet Classifications &amp; Reputation Scores
            </span>
            <span className="text-[11px] text-zinc-500">Probabilistic Flow Analysis</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {recentWallets.map((w, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded bg-zinc-950 border border-zinc-800 text-xs font-mono"
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-300 truncate max-w-[110px]">{w.address}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] uppercase border ${getWalletCategoryColor(
                      w.category
                    )}`}
                  >
                    {w.category.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-[11px]">
                  Reputation:{' '}
                  <strong
                    className={
                      w.reputation > 50
                        ? 'text-emerald-400'
                        : w.reputation < 0
                        ? 'text-rose-400'
                        : 'text-zinc-400'
                    }
                  >
                    {w.reputation > 0 ? '+' : ''}
                    {w.reputation}
                  </strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Real Money Quick Buy Action Bar */}
        {onRealBuy && (
          <div className="pt-2 border-t border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[11px] font-mono text-zinc-400">
              Target Ticket: <strong className="text-emerald-400">0.020 SOL</strong> &bull; Non-Custodial
            </div>
            <button
              onClick={() => onRealBuy(candidate)}
              className="px-3.5 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-mono text-xs font-bold transition flex items-center gap-1.5 shadow-sm shadow-emerald-500/20"
              title={`Execute real buy for $${metadata.symbol} from connected Solana wallet`}
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Real Buy ${metadata.symbol}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
