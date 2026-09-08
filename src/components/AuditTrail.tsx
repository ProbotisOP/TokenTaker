import React from 'react';
import {
  FileText,
  ShieldCheck,
  XCircle,
  TrendingUp,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
} from 'lucide-react';
import { DecisionAction, TradeDecisionRecord } from '../types.ts';

interface AuditTrailProps {
  records: TradeDecisionRecord[];
  onInspectRecord: (record: TradeDecisionRecord) => void;
}

export const AuditTrail: React.FC<AuditTrailProps> = ({ records, onInspectRecord }) => {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-zinc-400" />
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
            Explainability Audit Log &amp; Execution Telemetry ({records.length})
          </h2>
        </div>
        <div className="text-[11px] font-mono text-zinc-500">
          Deterministic Causal Log &bull; Post-Trade Autopsy Ready
        </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto max-h-[440px] divide-y divide-zinc-800/70 text-xs font-mono">
        {records.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-zinc-500">
            No executed decisions logged yet. Scanner is evaluating incoming launch stream.
          </div>
        ) : (
          records.map((r) => {
            const isWin = (r.realizedPnlSol ?? 0) > 0;
            const isLoss = (r.realizedPnlSol ?? 0) < 0;

            return (
              <div
                key={r.id}
                className="p-3.5 hover:bg-zinc-800/30 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-zinc-100">${r.symbol}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                      {new Date(r.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                        r.decision === DecisionAction.BUY
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : r.decision === DecisionAction.EMERGENCY_DUMP
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {r.decision.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="mt-1 text-zinc-400 text-[11px] line-clamp-1">
                    {r.decisionReasons[0]}
                  </div>

                  <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
                    <span>
                      Alpha: <strong className="text-zinc-300">{r.opportunityScore}/100</strong>
                    </span>
                    <span>
                      Safety: <strong className="text-zinc-300">{r.safetyScore}/100</strong>
                    </span>
                    <span>
                      Latency:{' '}
                      <strong className="text-cyan-400">{r.latencyBreakdown.total_latency_ms}ms</strong>
                    </span>
                    {r.exitReason && (
                      <span className="text-amber-400/90 truncate max-w-[200px]">
                        Exit: {r.exitReason}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: PnL & Inspect */}
                <div className="flex items-center gap-3 shrink-0">
                  {r.realizedPnlSol !== undefined && (
                    <div className="text-right">
                      <div
                        className={`font-bold flex items-center justify-end gap-0.5 ${
                          isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-zinc-400'
                        }`}
                      >
                        {isWin && <ArrowUpRight className="w-3.5 h-3.5" />}
                        {isLoss && <ArrowDownRight className="w-3.5 h-3.5" />}
                        <span>
                          {r.realizedPnlSol >= 0 ? '+' : ''}
                          {r.realizedPnlSol.toFixed(3)} SOL
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {r.realizedPnlPct !== undefined ? `${r.realizedPnlPct >= 0 ? '+' : ''}${r.realizedPnlPct}%` : ''}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => onInspectRecord(r)}
                    className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                    title="Inspect complete audit telemetry & AI diagnosis"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
