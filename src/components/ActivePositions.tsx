import React, { useState } from 'react';
import {
  ShieldAlert,
  ArrowUpRight,
  Clock,
  Crosshair,
  TrendingUp,
  CheckCircle2,
  Circle,
  Lock,
  Sliders,
  Wallet,
  ExternalLink,
  HelpCircle,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Position } from '../types.ts';

interface ActivePositionsProps {
  positions: Position[];
  onManualClose: (positionId: string) => void;
  onTradeExit?: (positionId: string, action: 'FLATTEN_100' | 'SCALE_OUT_50' | 'BREAKEVEN_SL' | 'CUSTOM_SL_TP', customSl?: number, customTp?: number) => void;
  onMirrorRealTrade?: (position: Position) => void;
  onNewRealTrade?: () => void;
}

export const ActivePositions: React.FC<ActivePositionsProps> = ({
  positions,
  onManualClose,
  onTradeExit,
  onMirrorRealTrade,
  onNewRealTrade,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customSl, setCustomSl] = useState<number>(-12);
  const [customTp, setCustomTp] = useState<number>(50);
  const [filter, setFilter] = useState<'ALL' | 'REAL_WALLET' | 'PAPER_SIM'>('ALL');
  const [showExplainerModal, setShowExplainerModal] = useState(false);

  const handleAction = (positionId: string, action: 'FLATTEN_100' | 'SCALE_OUT_50' | 'BREAKEVEN_SL' | 'CUSTOM_SL_TP') => {
    if (onTradeExit) {
      onTradeExit(positionId, action, customSl, customTp);
    } else {
      onManualClose(positionId);
    }
  };

  const realWalletCount = positions.filter((p) => p.isRealWalletTrade).length;
  const paperSimCount = positions.filter((p) => !p.isRealWalletTrade).length;

  const filteredPositions = positions.filter((p) => {
    if (filter === 'REAL_WALLET') return p.isRealWalletTrade;
    if (filter === 'PAPER_SIM') return !p.isRealWalletTrade;
    return true;
  });

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-zinc-950/40">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-emerald-400" />
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
            Autonomous Position Manager ({filteredPositions.length} Active)
          </h2>
          <button
            onClick={() => setShowExplainerModal(true)}
            className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 bg-cyan-950/40 hover:bg-cyan-900/50 px-2 py-0.5 rounded border border-cyan-800/60 transition"
            title="Why did trade appear in Live Monitor?"
          >
            <HelpCircle className="w-3 h-3" />
            <span>Why trades appear here?</span>
          </button>

          {onNewRealTrade && (
            <button
              onClick={onNewRealTrade}
              className="text-[11px] font-mono text-emerald-300 hover:text-emerald-200 flex items-center gap-1 bg-emerald-950/80 hover:bg-emerald-900 px-2.5 py-0.5 rounded border border-emerald-600/60 transition font-bold"
              title="Open Real Money Trade order modal"
            >
              <Zap className="w-3 h-3 text-emerald-400 fill-current" />
              <span>+ New Real Trade</span>
            </button>
          )}
        </div>

        {/* Filter Toggle: All vs Real Wallet vs Paper Engine */}
        <div className="flex items-center gap-1 text-[11px] font-mono">
          <button
            onClick={() => setFilter('ALL')}
            className={`px-2 py-1 rounded transition ${
              filter === 'ALL'
                ? 'bg-zinc-800 text-zinc-100 font-bold border border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            All ({positions.length})
          </button>
          <button
            onClick={() => setFilter('REAL_WALLET')}
            className={`px-2 py-1 rounded flex items-center gap-1 transition ${
              filter === 'REAL_WALLET'
                ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-700'
                : 'text-zinc-500 hover:text-emerald-400'
            }`}
          >
            <Wallet className="w-3 h-3" />
            <span>Real Wallet ({realWalletCount})</span>
          </button>
          <button
            onClick={() => setFilter('PAPER_SIM')}
            className={`px-2 py-1 rounded transition ${
              filter === 'PAPER_SIM'
                ? 'bg-zinc-800 text-amber-300 font-bold border border-amber-600/50'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Paper Sim ({paperSimCount})
          </button>
        </div>
      </div>

      {/* Position Cards / Table */}
      <div className="divide-y divide-zinc-800/70 overflow-y-auto max-h-[480px]">
        {filteredPositions.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-zinc-500 space-y-2">
            {filter === 'REAL_WALLET' ? (
              <div className="max-w-md mx-auto space-y-2 text-zinc-400">
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center mx-auto text-amber-400">
                  <Wallet className="w-4 h-4" />
                </div>
                <div className="font-bold text-zinc-200">No Real Wallet Trades Active Yet</div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Your connected wallet funds are completely safe and untouched. To execute trades using your allocated SOL capital, switch to the <strong>Real Wallet &amp; Autotrade</strong> tab.
                </p>
              </div>
            ) : (
              <div>No active positions. Capital preserved in cash. Autonomous engine scanning for qualifying edge.</div>
            )}
          </div>
        ) : (
          filteredPositions.map((p) => {
            const isPnlPositive = p.unrealizedPnlSol >= 0;
            const txSig = p.executionHistory?.[0]?.txSignature;

            return (
              <div key={p.id} className="p-4 hover:bg-zinc-800/30 transition flex flex-col gap-3">
                {/* Top Row: Token, Source Badge, PnL, Actions */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm text-zinc-100">${p.symbol}</span>
                      <span className="text-xs text-zinc-400">{p.name}</span>

                      {/* Source attribution badge */}
                      {p.isRealWalletTrade ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/50 flex items-center gap-1 shadow-sm">
                          <Wallet className="w-3 h-3 text-emerald-400" />
                          <span>REAL WALLET SOL</span>
                          {p.walletAddress && (
                            <span className="text-[9px] text-emerald-400/80">
                              ({p.walletAddress.slice(0, 4)}...{p.walletAddress.slice(-4)})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-950 text-zinc-400 border border-zinc-800">
                          PAPER SIMULATION
                        </span>
                      )}

                      <span className="text-[11px] font-mono text-zinc-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {p.holdingSec}s held
                      </span>
                    </div>

                    <div className="text-xs font-mono text-zinc-400 mt-1 flex items-center gap-3 flex-wrap">
                      <span>
                        Entry: <strong>{p.entryPriceSol.toFixed(8)} SOL</strong>
                      </span>
                      <span>&rarr;</span>
                      <span>
                        Now:{' '}
                        <strong className={isPnlPositive ? 'text-emerald-400' : 'text-rose-400'}>
                          {p.currentPriceSol.toFixed(8)} SOL
                        </strong>
                      </span>
                      <span>&bull;</span>
                      <span>
                        Size: <strong>{p.costBasisSol.toFixed(3)} SOL</strong> ({p.sizeTokens.toLocaleString()} tokens)
                      </span>
                      {txSig && (
                        <a
                          href={`https://solscan.io/tx/${txSig}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5 underline"
                        >
                          <span>Solscan</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* PnL & Granular Per-Trade Exit Options */}
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
                    <div className="text-right">
                      <div className={`text-base font-mono font-bold ${isPnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPnlPositive ? '+' : ''}
                        {p.unrealizedPnlPct.toFixed(1)}%
                      </div>
                      <div className={`text-xs font-mono ${isPnlPositive ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                        {isPnlPositive ? '+' : ''}
                        {p.unrealizedPnlSol.toFixed(3)} SOL
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Mirror with Real Money */}
                      {onMirrorRealTrade && !p.isRealWalletTrade && (
                        <button
                          onClick={() => onMirrorRealTrade(p)}
                          className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-mono font-bold transition flex items-center gap-1 shadow-sm"
                          title="Mirror this simulation trade using real Solana wallet"
                        >
                          <Zap className="w-3 h-3 fill-current" />
                          <span>Mirror Real Trade</span>
                        </button>
                      )}

                      {/* 100% Exit */}
                      <button
                        onClick={() => handleAction(p.id, 'FLATTEN_100')}
                        className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-200 text-xs font-mono font-semibold transition border border-rose-700/50 flex items-center gap-1"
                        title="Instant 100% market dump"
                      >
                        <ShieldAlert className="w-3 h-3" />
                        <span>Exit 100%</span>
                      </button>

                      {/* 50% Scale-Out */}
                      <button
                        onClick={() => handleAction(p.id, 'SCALE_OUT_50')}
                        className="px-2 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900 text-emerald-200 text-xs font-mono font-semibold transition border border-emerald-700/50 flex items-center gap-1"
                        title="Take profit on 50%, keep 50% runner"
                      >
                        <TrendingUp className="w-3 h-3" />
                        <span>Scale 50%</span>
                      </button>

                      {/* Breakeven SL */}
                      <button
                        onClick={() => handleAction(p.id, 'BREAKEVEN_SL')}
                        className="px-2 py-1 rounded bg-cyan-950/60 hover:bg-cyan-900 text-cyan-200 text-xs font-mono font-semibold transition border border-cyan-700/50 flex items-center gap-1"
                        title="Move stop loss to entry (zero risk)"
                      >
                        <Lock className="w-3 h-3" />
                        <span>Breakeven</span>
                      </button>

                      {/* Custom SL */}
                      <button
                        onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                        className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold transition border border-zinc-700 flex items-center gap-1"
                        title="Edit SL % specifically for this trade"
                      >
                        <Sliders className="w-3 h-3" />
                        <span>SL</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Inline SL/TP Editor if expanded */}
                {editingId === p.id && (
                  <div className="p-3 bg-zinc-950 border border-zinc-700 rounded flex items-center gap-3 text-xs font-mono">
                    <span className="text-zinc-400">Stop Loss %:</span>
                    <input
                      type="number"
                      max="-1"
                      min="-50"
                      value={customSl}
                      onChange={(e) => setCustomSl(parseFloat(e.target.value) || -12)}
                      className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-rose-400 font-bold text-center"
                    />
                    <button
                      onClick={() => {
                        handleAction(p.id, 'CUSTOM_SL_TP');
                        setEditingId(null);
                      }}
                      className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold"
                    >
                      Update
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-zinc-500 hover:text-zinc-300 ml-auto"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Bottom Row: Trailing Stop & Scale-out ladder status */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono bg-zinc-950/50 p-2.5 rounded border border-zinc-800/80">
                  {/* Trailing Stop Visualizer */}
                  <div>
                    <div className="text-[11px] text-zinc-500 mb-1 flex items-center justify-between">
                      <span>Trailing Stop (14% Band):</span>
                      <span className={p.trailingActivated ? 'text-emerald-400 font-bold' : 'text-zinc-400'}>
                        {p.trailingActivated ? 'LOCKED & ACTIVE' : 'PENDING (+25% Trigger)'}
                      </span>
                    </div>
                    <div className="text-zinc-300">
                      Stop Price:{' '}
                      <strong className="text-amber-400">
                        {p.trailingStopPriceSol.toFixed(8)} SOL
                      </strong>
                    </div>
                  </div>

                  {/* Take Profit Ladder */}
                  <div>
                    <div className="text-[11px] text-zinc-500 mb-1 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-cyan-400" />
                      <span>Take-Profit Ladder:</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.takeProfitLadder.map((step, idx) => (
                        <div
                          key={idx}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${
                            step.filled
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                          }`}
                        >
                          {step.filled ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Circle className="w-3 h-3 text-zinc-600" />
                          )}
                          <span>
                            Tier {idx + 1} (+{idx === 0 ? '45%' : '90%'})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Explainer Modal: Why did trades show in Live Monitor? */}
      {showExplainerModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 font-mono">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 text-cyan-400">
                <Sparkles className="w-5 h-5" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-100">
                  Understanding Live Monitor vs. Your Real Wallet
                </h3>
              </div>
              <button
                onClick={() => setShowExplainerModal(false)}
                className="text-zinc-400 hover:text-zinc-200 text-lg p-1"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                <div className="text-amber-300 font-bold">1. Did the bot trade my real wallet SOL?</div>
                <p className="text-zinc-400 text-[11px]">
                  <strong>No.</strong> Your real connected wallet SOL ($20) remains safe and untouched in your own custody. The trades labeled <code>PAPER SIMULATION</code> are executed inside the built-in Quant Mempool Engine with virtual equity to test algorithms without financial risk.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                <div className="text-emerald-300 font-bold">2. Why didn't Phantom show a transaction?</div>
                <p className="text-zinc-400 text-[11px]">
                  Solana wallet extensions (like Phantom) strictly prohibit any web application from withdrawing or spending SOL without either (a) an explicit on-screen popup signature request, or (b) a dedicated bot signing key. This guarantees your funds can never be silently drained.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                <div className="text-cyan-300 font-bold">3. How do I trade my real $20 SOL?</div>
                <p className="text-zinc-400 text-[11px]">
                  Go to the <strong>Real Wallet &amp; Autotrade</strong> tab. In Step 3, configure <strong>"How Many SOL to Use"</strong> (e.g. 0.08 SOL) and your <strong>Ticket Size</strong> (e.g. 0.02 SOL per trade). You can execute 1-click test trades or engage automated sniping bounded strictly by your rules.
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setShowExplainerModal(false)}
                className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
