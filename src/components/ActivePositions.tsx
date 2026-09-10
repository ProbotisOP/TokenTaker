import React, { useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Crosshair,
  TrendingUp,
  CheckCircle2,
  Circle,
  Lock,
  Sliders,
  Wallet,
  ExternalLink,
  Zap,
  Loader2,
  Copy,
  Check,
  Flame,
} from 'lucide-react';
import { Position } from '../types.ts';

interface ActivePositionsProps {
  positions: Position[];
  closedPositions?: Position[];
  onManualClose: (positionId: string) => void;
  onTradeExit?: (positionId: string, action: 'FLATTEN_100' | 'SCALE_OUT_50' | 'BREAKEVEN_SL' | 'CUSTOM_SL_TP', customSl?: number, customTp?: number) => void;
  onOneClickExit?: (positionId: string, pct: 100 | 50) => Promise<any> | void;
  onNewRealTrade?: () => void;
}

export const ActivePositions: React.FC<ActivePositionsProps> = ({
  positions,
  closedPositions = [],
  onManualClose,
  onTradeExit,
  onOneClickExit,
  onNewRealTrade,
}) => {
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'CLOSED'>('ACTIVE');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customSl, setCustomSl] = useState<number>(-12);
  const [customTp, setCustomTp] = useState<number>(50);
  const [exitingId, setExitingId] = useState<string | null>(null);
  const [exitFeedback, setExitFeedback] = useState<{ positionId: string; message: string; txSig?: string; explorerUrl?: string } | null>(null);
  const [copiedMint, setCopiedMint] = useState<string | null>(null);

  const handle1ClickExit = async (positionId: string, pct: 100 | 50) => {
    setExitingId(positionId);
    setExitFeedback(null);
    try {
      if (onOneClickExit) {
        const res = await onOneClickExit(positionId, pct);
        if (res && !res.success) throw new Error(res.error || 'Exit request rejected');
        if (res && res.success) {
          setExitFeedback({
            positionId,
            message: res.message || `Closed on-chain for ${res.solReceived?.toFixed(4) || ''} SOL`,
            txSig: res.txSignature,
            explorerUrl: res.explorerUrl,
          });
        }
      } else if (onTradeExit) {
        onTradeExit(positionId, pct === 100 ? 'FLATTEN_100' : 'SCALE_OUT_50', customSl, customTp);
      } else {
        onManualClose(positionId);
      }
    } catch (err: any) {
      setExitFeedback({
        positionId,
        message: err.message || 'Exit failed',
      });
    } finally {
      setExitingId(null);
    }
  };

  const handleAction = (positionId: string, action: 'BREAKEVEN_SL' | 'CUSTOM_SL_TP') => {
    if (onTradeExit) {
      onTradeExit(positionId, action, customSl, customTp);
    }
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-zinc-950/40">
        <div className="flex items-center gap-2">
          {/* Tabs: Active vs Completed */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded p-0.5">
            <button
              onClick={() => setActiveTab('ACTIVE')}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 ${
                activeTab === 'ACTIVE'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
              <span>Active ({positions.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('CLOSED')}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition flex items-center gap-1.5 ${
                activeTab === 'CLOSED'
                  ? 'bg-zinc-800 text-zinc-100 border border-zinc-600 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span>Completed ({closedPositions.length})</span>
            </button>
          </div>

          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 flex items-center gap-1 hidden sm:flex">
            <Wallet className="w-3 h-3 text-emerald-400" />
            <span>SOLANA ON-CHAIN</span>
          </span>
        </div>

        {onNewRealTrade && (
          <button
            onClick={onNewRealTrade}
            className="text-[11px] font-mono text-emerald-300 hover:text-emerald-200 flex items-center gap-1 bg-emerald-950/80 hover:bg-emerald-900 px-2.5 py-1 rounded border border-emerald-600/60 transition font-bold"
            title="Open Real Money Trade order modal"
          >
            <Zap className="w-3 h-3 text-emerald-400 fill-current" />
            <span>+ 1-Click Enroll</span>
          </button>
        )}
      </div>

      {/* Exit Feedback Notification */}
      {exitFeedback && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-emerald-950/80 border border-emerald-500 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{exitFeedback.message}</span>
          </div>
          {exitFeedback.txSig && (
            <a
              href={exitFeedback.explorerUrl || `https://solscan.io/tx/${exitFeedback.txSig}`}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-300 hover:text-white underline font-bold flex items-center gap-1 ml-3 shrink-0"
            >
              <span>View Solscan</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Position Cards */}
      <div className="divide-y divide-zinc-800/70 overflow-y-auto max-h-[500px]">
        {activeTab === 'CLOSED' ? (
          closedPositions.length === 0 ? (
            <div className="p-8 text-center text-xs font-mono text-zinc-500 space-y-2">
              <div className="w-10 h-10 rounded-full bg-zinc-800/80 border border-zinc-700 flex items-center justify-center mx-auto text-zinc-400">
                <Clock className="w-5 h-5" />
              </div>
              <div className="font-bold text-zinc-300 text-sm">No Completed Trades Yet</div>
              <p className="text-[11px] text-zinc-400 max-w-md mx-auto leading-relaxed">
                After a confirmed exit, the fill and return breakdown are saved in local accounting. Phantom positions require your approval for every sell, including stop-loss and take-profit recommendations.
              </p>
            </div>
          ) : (
            closedPositions.map((p) => {
              const realizedPnl = p.realizedPnlSol ?? 0;
              const isPnlPositive = realizedPnl >= 0;
              const costBasis = p.costBasisSol || 0.0001;
              const realizedPct = Number(((realizedPnl / costBasis) * 100).toFixed(1));
              const returnedSol = Math.max(0, costBasis + realizedPnl);
              const buyTx = p.txSignature || p.executionHistory?.find((e) => e.action === 'BUY' || e.action === 'ENTRY')?.txSignature;
              const sellTx = p.exitTxSignature || p.executionHistory?.find((e) => e.action === 'SELL')?.txSignature;
              const closedTimeStr = p.closedAt ? new Date(p.closedAt).toLocaleTimeString() : 'Recently';

              let exitReasonDisplay = '⚡ 1-Click Market Exit';
              if (p.exitReason) {
                if (p.exitReason === '1_CLICK_MARKET_EXIT') exitReasonDisplay = '⚡ 1-Click Market Exit';
                else if (p.exitReason.includes('HARD_STOP')) exitReasonDisplay = '🛡️ Hard Stop Loss (-12%)';
                else if (p.exitReason.includes('TAKE_PROFIT')) exitReasonDisplay = '🎯 Take Profit Target';
                else if (p.exitReason.includes('TRAILING_STOP')) exitReasonDisplay = '📈 Trailing Stop Activated';
                else if (p.exitReason.includes('RECLAIM')) exitReasonDisplay = '🔄 Manual SOL Reclaim';
                else exitReasonDisplay = p.exitReason;
              }

              return (
                <div key={p.id} className="p-4 hover:bg-zinc-800/20 transition flex flex-col gap-3 bg-zinc-950/20">
                  {/* Top Row: Token Info & Realized PnL */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm text-zinc-100">${p.symbol}</span>
                        <span className="text-xs text-zinc-400">{p.name}</span>

                        {/* CA Badge */}
                        {p.tokenMint && (
                          <div className="flex items-center gap-1 bg-zinc-950/90 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                            <span className="text-zinc-500 font-bold">CA:</span>
                            <span className="text-zinc-300">{p.tokenMint.slice(0, 4)}...{p.tokenMint.slice(-4)}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(p.tokenMint);
                                setCopiedMint(p.tokenMint);
                                setTimeout(() => setCopiedMint(null), 1800);
                              }}
                              className="hover:text-emerald-400 p-0.5 transition"
                              title="Copy contract address"
                            >
                              {copiedMint === p.tokenMint ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                            <a
                              href={`https://solscan.io/token/${p.tokenMint}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-zinc-500 hover:text-cyan-400 p-0.5 transition"
                              title="Solscan token page"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <a
                              href={`https://dexscreener.com/solana/${p.tokenMint}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-zinc-500 hover:text-amber-400 p-0.5 transition"
                              title="DexScreener chart"
                            >
                              <Flame className="w-3 h-3 text-amber-500" />
                            </a>
                          </div>
                        )}

                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-800 text-zinc-300 border border-zinc-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>CLOSED</span>
                        </span>

                        <span className="text-[11px] font-mono text-zinc-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>Closed at {closedTimeStr} ({p.holdingSec || 0}s held)</span>
                        </span>
                      </div>

                      {/* Trade details & Exit Reason */}
                      <div className="text-xs font-mono text-zinc-400 mt-1 flex items-center gap-2 flex-wrap">
                        <span className="text-zinc-300 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-[10px]">
                          {exitReasonDisplay}
                        </span>
                        <span>&bull;</span>
                        <span>Invested: <strong className="text-zinc-200">{costBasis.toFixed(4)} SOL</strong></span>
                        <span>&rarr;</span>
                        <span>Returned: <strong className="text-emerald-300 font-bold">{returnedSol.toFixed(4)} SOL</strong></span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 font-semibold">
                          Returned to signing wallet
                        </span>
                      </div>
                    </div>

                    {/* Realized PnL badge */}
                    <div className="text-right shrink-0">
                      <div className={`text-base font-mono font-bold flex items-center justify-end gap-0.5 ${isPnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPnlPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                        <span>{isPnlPositive ? '+' : ''}{realizedPct}%</span>
                      </div>
                      <div className={`text-xs font-mono font-semibold ${isPnlPositive ? 'text-emerald-400/90' : 'text-rose-400/90'}`}>
                        {isPnlPositive ? '+' : ''}{realizedPnl.toFixed(5)} SOL
                      </div>
                    </div>
                  </div>

                  {/* Solscan Tx Links Row */}
                  <div className="flex items-center gap-3 pt-2 border-t border-zinc-800/60 text-[11px] font-mono flex-wrap">
                    {buyTx && (
                      <a
                        href={`https://solscan.io/tx/${buyTx}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1 bg-cyan-950/40 border border-cyan-800/50 px-2 py-0.5 rounded transition"
                      >
                        <span>Entry Buy Tx</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {sellTx && (
                      <a
                        href={`https://solscan.io/tx/${sellTx}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded font-bold transition"
                      >
                        <Wallet className="w-3 h-3" />
                        <span>Exit Swap Tx (SOL Returned)</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <span className="text-zinc-500 text-[10px] ml-auto">
                      Tokens: {p.sizeTokens.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })
          )
        ) : positions.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-zinc-500 space-y-2">
            <div className="w-10 h-10 rounded-full bg-zinc-800/80 border border-zinc-700 flex items-center justify-center mx-auto text-emerald-400">
              <Wallet className="w-5 h-5" />
            </div>
            <div className="font-bold text-zinc-300 text-sm">No Active On-Chain Positions</div>
            <p className="text-[11px] text-zinc-400 max-w-md mx-auto leading-relaxed">
              No tracked open positions. Open <strong>Real Wallet / Phantom</strong> to review a manual swap, or review an eligible scanner signal. Every Phantom trade needs your approval.
            </p>
            {closedPositions.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setActiveTab('CLOSED')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-400 hover:text-emerald-300 text-xs font-mono font-bold transition border border-zinc-700"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>View {closedPositions.length} Completed Trade{closedPositions.length > 1 ? 's' : ''} &rarr;</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          positions.map((p) => {
            const isPnlPositive = p.unrealizedPnlSol >= 0;
            const txSig = p.executionHistory?.[0]?.txSignature;
            const isThisExiting = exitingId === p.id;

            return (
              <div key={p.id} className="p-4 hover:bg-zinc-800/30 transition flex flex-col gap-3">
                {/* Top Row: Token, Address, PnL, 1-Click Exit Buttons */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm text-zinc-100">${p.symbol}</span>
                      <span className="text-xs text-zinc-400">{p.name}</span>

                      {/* Verified Solana Contract Badge */}
                      {p.tokenMint && (
                        <div className="flex items-center gap-1 bg-zinc-950/90 border border-zinc-800 hover:border-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                          <span className="text-zinc-500 font-bold">CA:</span>
                          <span className="text-zinc-200" title={p.tokenMint}>
                            {p.tokenMint.slice(0, 4)}...{p.tokenMint.slice(-4)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(p.tokenMint);
                              setCopiedMint(p.tokenMint);
                              setTimeout(() => setCopiedMint(null), 1800);
                            }}
                            className="hover:text-emerald-400 p-0.5 transition"
                            title="Copy verified contract address to clipboard"
                          >
                            {copiedMint === p.tokenMint ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                          <a
                            href={`https://solscan.io/token/${p.tokenMint}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-zinc-500 hover:text-cyan-400 p-0.5 transition flex items-center"
                            title="Verify token contract on Solscan"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <a
                            href={`https://dexscreener.com/solana/${p.tokenMint}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-zinc-500 hover:text-amber-400 p-0.5 transition flex items-center"
                            title="Open live chart on DexScreener"
                          >
                            <Flame className="w-3 h-3 text-amber-500" />
                          </a>
                        </div>
                      )}

                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/50 flex items-center gap-1 shadow-sm">
                        <Wallet className="w-3 h-3 text-emerald-400" />
                        <span>PHANTOM SYNCED</span>
                      </span>

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
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 underline font-bold"
                          title="Verify real trade on Solana Explorer"
                        >
                          <span>Solscan Verified</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* PnL & 1-Click Real Market Exit Buttons */}
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
                    <div className="text-right">
                      <div className={`text-base font-mono font-bold ${isPnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPnlPositive ? '+' : ''}
                        {p.unrealizedPnlPct.toFixed(1)}%
                      </div>
                      <div className={`text-xs font-mono ${isPnlPositive ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                        {isPnlPositive ? '+' : ''}
                        {p.unrealizedPnlSol.toFixed(4)} SOL
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* ⚡ 1-Click Market Exit (100%) */}
                      <button
                        onClick={() => handle1ClickExit(p.id, 100)}
                        disabled={isThisExiting}
                        className="px-2.5 py-1.5 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-mono font-bold transition flex items-center gap-1 shadow-sm"
                        title="Instant on-chain market swap back to SOL via Jupiter DEX"
                      >
                        {isThisExiting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Zap className="w-3.5 h-3.5 fill-current" />
                        )}
                        <span>{p.signingMethod === 'PHANTOM' ? 'Review full sell in Phantom' : 'Exit 100%'}</span>
                      </button>

                      {/* ⚡ Scale Out 50% */}
                      <button
                        onClick={() => handle1ClickExit(p.id, 50)}
                        disabled={isThisExiting}
                        className="px-2 py-1.5 rounded bg-emerald-950 hover:bg-emerald-900 disabled:opacity-50 text-emerald-200 text-xs font-mono font-bold transition border border-emerald-700/60 flex items-center gap-1"
                        title="Swap 50% of tokens back to SOL on-chain, keep runner"
                      >
                        <TrendingUp className="w-3 h-3 text-emerald-400" />
                        <span>Scale 50%</span>
                      </button>

                      {/* Breakeven SL */}
                      <button
                        onClick={() => handleAction(p.id, 'BREAKEVEN_SL')}
                        className="px-2 py-1.5 rounded bg-cyan-950/60 hover:bg-cyan-900 text-cyan-200 text-xs font-mono font-semibold transition border border-cyan-700/50 flex items-center gap-1"
                        title="Move stop loss to entry (zero risk)"
                      >
                        <Lock className="w-3 h-3" />
                        <span>Breakeven</span>
                      </button>

                      {/* Custom SL */}
                      <button
                        onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                        className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold transition border border-zinc-700 flex items-center gap-1"
                        title="Edit SL % specifically for this trade"
                      >
                        <Sliders className="w-3 h-3" />
                        <span>SL</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Inline SL Editor if open */}
                {editingId === p.id && (
                  <div className="p-3 bg-zinc-950 border border-zinc-700 rounded flex items-center gap-3 text-xs font-mono">
                    <span className="text-zinc-400">Custom Stop Loss %:</span>
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

                {/* Trailing Stop & Take Profit Status */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono bg-zinc-950/50 p-2.5 rounded border border-zinc-800/80">
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
    </div>
  );
};
