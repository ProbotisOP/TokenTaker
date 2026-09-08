import React from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Eye,
  ArrowRight,
  Flame,
  Zap,
} from 'lucide-react';
import { CandidateTokenState, DecisionAction, RiskLevel } from '../types.ts';

interface LiveScannerProps {
  candidates: CandidateTokenState[];
  onSelectCandidate: (candidate: CandidateTokenState) => void;
  onRealBuy?: (candidate: CandidateTokenState) => void;
}

export const LiveScanner: React.FC<LiveScannerProps> = ({ candidates, onSelectCandidate, onRealBuy }) => {
  const getRiskBadge = (level: RiskLevel, score: number) => {
    switch (level) {
      case RiskLevel.LOW:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <ShieldCheck className="w-3 h-3" />
            SAFE ({score})
          </span>
        );
      case RiskLevel.MEDIUM:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3" />
            MED ({score})
          </span>
        );
      case RiskLevel.HIGH:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-orange-500/15 text-orange-400 border border-orange-500/30">
            <AlertTriangle className="w-3 h-3" />
            HIGH ({score})
          </span>
        );
      case RiskLevel.CRITICAL:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3 h-3" />
            CRITICAL ({score})
          </span>
        );
    }
  };

  const getDecisionBadge = (decision: DecisionAction) => {
    if (decision === DecisionAction.BUY) {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500 text-zinc-950 uppercase tracking-wider flex items-center gap-1">
          <Zap className="w-3 h-3 fill-current" />
          APPROVED BUY
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
        REJECTED
      </span>
    );
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-amber-400" />
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
            Live Solana Token Ingestion &amp; Safety Stream
          </h2>
        </div>
        <div className="text-[11px] font-mono text-zinc-500 flex items-center gap-3">
          <button
            onClick={async () => {
              try {
                await fetch('/api/paper/trigger-launch', { method: 'POST' });
              } catch (e) {
                console.error(e);
              }
            }}
            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition flex items-center gap-1"
            title="Simulate an incoming Dex launch immediately"
          >
            <Zap className="w-3 h-3 text-amber-400" />
            <span>+ Ingest Launch</span>
          </button>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Streaming Dex</span>
          </div>
        </div>
      </div>

      {/* Table List */}
      <div className="overflow-x-auto flex-1 max-h-[480px] divide-y divide-zinc-800/60">
        {candidates.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-zinc-500">
            Listening to Solana RPC and Pump.fun/Raydium event streams for incoming launches...
          </div>
        ) : (
          candidates.map((c) => {
            const isApproved = c.decision === DecisionAction.BUY;
            const latencyMs = c.decision_at - c.detected_at;

            return (
              <div
                key={c.metadata.mint + c.detected_at}
                className={`p-3.5 hover:bg-zinc-800/40 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isApproved ? 'bg-emerald-950/10 border-l-2 border-emerald-500' : ''
                }`}
              >
                {/* Left info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-sm text-zinc-100">
                      ${c.metadata.symbol}
                    </span>
                    <span className="text-xs text-zinc-400 truncate max-w-[140px]">
                      {c.metadata.name}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                      {c.metadata.launchVenue}
                    </span>
                    {getRiskBadge(c.safety.riskLevel, c.safety.safetyScore)}
                    {getDecisionBadge(c.decision)}
                  </div>

                  {/* Micro attributes */}
                  <div className="mt-1.5 flex items-center gap-4 text-xs font-mono text-zinc-400 flex-wrap">
                    <span>
                      Pool Liq:{' '}
                      <strong className="text-zinc-200">
                        {c.metadata.initialLiquiditySol.toFixed(1)} SOL
                      </strong>
                    </span>
                    <span>
                      Alpha Score:{' '}
                      <strong className={c.opportunity.opportunityScore >= 75 ? 'text-cyan-400' : 'text-zinc-400'}>
                        {c.opportunity.opportunityScore}/100
                      </strong>
                    </span>
                    <span>
                      Exp Return:{' '}
                      <strong className="text-emerald-400">
                        +{c.opportunity.expectedReturnPct}%
                      </strong>
                    </span>
                    <span>
                      Top 1:{' '}
                      <strong className={c.safety.top1Percent > 18 ? 'text-rose-400' : 'text-zinc-300'}>
                        {c.safety.top1Percent.toFixed(1)}%
                      </strong>
                    </span>
                    <span>
                      LP Burned:{' '}
                      <strong className={c.safety.lpBurnPct >= 85 ? 'text-emerald-400' : 'text-rose-400'}>
                        {c.safety.lpBurnPct}%
                      </strong>
                    </span>
                  </div>

                  {/* Reject Reasons or approval summary */}
                  {c.decisionReasons.length > 0 && (
                    <div className="mt-1.5 text-[11px] font-mono line-clamp-1">
                      {isApproved ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" />
                          {c.decisionReasons[0]}
                        </span>
                      ) : (
                        <span className="text-rose-400/90 flex items-center gap-1">
                          <XCircle className="w-3 h-3 shrink-0" />
                          {c.decisionReasons[0]}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: Latency Breakdown & Inspect */}
                <div className="flex items-center gap-3 sm:self-center shrink-0">
                  <div className="text-right font-mono">
                    <div className="text-[11px] text-zinc-500">Pipeline Latency</div>
                    <div className="text-xs font-bold text-cyan-400">{latencyMs}ms</div>
                    <div className="text-[9px] text-zinc-600">
                      det &rarr; parse &rarr; score &rarr; dec
                    </div>
                  </div>

                  {onRealBuy && (
                    <button
                      onClick={() => onRealBuy(c)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-mono font-bold transition shadow-sm"
                      title={`Execute real money buy for $${c.metadata.symbol} from connected Solana wallet`}
                    >
                      <Zap className="w-3.5 h-3.5 fill-current" />
                      <span>Real Buy</span>
                    </button>
                  )}

                  <button
                    onClick={() => onSelectCandidate(c)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-semibold transition"
                    title="View deterministic safety report and explainability breakdown"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Inspect</span>
                    <ArrowRight className="w-3 h-3 opacity-60" />
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
