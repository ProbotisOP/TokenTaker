import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Eye,
  ArrowRight,
  Flame,
  Zap,
  Loader2,
  ExternalLink,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react';
import { CandidateTokenState, DecisionAction, RiskLevel } from '../types.ts';

interface LiveScannerProps {
  feedStatus?: { state: string; tradeFlowEnabled: boolean; error?: string; trackedTokens: number };
  candidates: CandidateTokenState[];
  onSelectCandidate: (candidate: CandidateTokenState) => void;
  onRealBuy?: (candidate: CandidateTokenState) => void;
  onOneClickEnroll?: (candidate: CandidateTokenState, sizeSol?: number) => Promise<any> | void;
}

export const LiveScanner: React.FC<LiveScannerProps> = ({
  feedStatus,
  candidates,
  onSelectCandidate,
  onRealBuy,
  onOneClickEnroll,
}) => {
  const [enrollingMint, setEnrollingMint] = useState<string | null>(null);
  const [enrollFeedback, setEnrollFeedback] = useState<{
    symbol: string;
    message: string;
    txSig?: string;
    explorerUrl?: string;
  } | null>(null);
  const [copiedMint, setCopiedMint] = useState<string | null>(null);

  const handle1ClickBuy = async (c: CandidateTokenState) => {
    if (onOneClickEnroll) {
      setEnrollingMint(c.metadata.mint);
      setEnrollFeedback(null);
      try {
        const res = await onOneClickEnroll(c);
        if (res && res.success) {
          setEnrollFeedback({
            symbol: c.metadata.symbol,
            message: `Enrolled into $${c.metadata.symbol} on-chain!`,
            txSig: res.txSignature,
            explorerUrl: res.explorerUrl,
          });
        }
      } catch (err: any) {
        setEnrollFeedback({
          symbol: c.metadata.symbol,
          message: err.message || 'Enrollment failed',
        });
      } finally {
        setEnrollingMint(null);
      }
    } else if (onRealBuy) {
      onRealBuy(c);
    }
  };

  const getRiskBadge = (level: RiskLevel, score: number) => {
    switch (level) {
      case RiskLevel.LOW:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <ShieldCheck className="w-3 h-3" />
            CHECKS PASS ({score})
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
          ENTRY CONFIRMED
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
        {decision === DecisionAction.WAIT ? 'OBSERVING' : 'REJECTED'}
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
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${feedStatus?.state === 'CONNECTED' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>{feedStatus?.state ?? 'CONNECTING'} · {feedStatus?.tradeFlowEnabled ? 'trade feed configured' : 'discovery only'}</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 text-xs text-amber-200 bg-amber-950/20 border-b border-zinc-800">
        {feedStatus?.error || (feedStatus?.state === 'DISABLED' ? 'Feed disabled. Configure EARLY_FEED_ENABLED and a funded PumpPortal trade feed to collect observations.' : 'Observed wallet flow is not verified smart money. Common funding and wash-trading networks remain unverified.')}
      </div>
      {/* Enroll Feedback Notification */}
      {enrollFeedback && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-emerald-950/80 border border-emerald-500 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{enrollFeedback.message}</span>
          </div>
          {enrollFeedback.txSig && (
            <a
              href={enrollFeedback.explorerUrl || `https://solscan.io/tx/${enrollFeedback.txSig}`}
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

      {/* Table List */}
      <div className="overflow-x-auto flex-1 max-h-[480px] divide-y divide-zinc-800/60">
        {candidates.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-zinc-500">
            No fresh launch observations. Feed: {feedStatus?.state ?? 'connecting'}. No synthetic candidates are supplied.
          </div>
        ) : (
          candidates.map((c) => {
            const isApproved = c.decision === DecisionAction.BUY;
            const latencyMs = c.decision_at - c.detected_at;
            const isEnrolling = enrollingMint === c.metadata.mint;

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

                    {/* Verified Solana Contract Badge */}
                    <div className="flex items-center gap-1 bg-zinc-950/90 border border-zinc-800 hover:border-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                      <span className="text-zinc-500 font-bold">CA:</span>
                      <span className="text-zinc-200" title={c.metadata.mint}>
                        {c.metadata.mint.slice(0, 4)}...{c.metadata.mint.slice(-4)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(c.metadata.mint);
                          setCopiedMint(c.metadata.mint);
                          setTimeout(() => setCopiedMint(null), 1800);
                        }}
                        className="hover:text-emerald-400 p-0.5 transition"
                        title="Copy verified contract address to clipboard"
                      >
                        {copiedMint === c.metadata.mint ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                      <a
                        href={`https://solscan.io/token/${c.metadata.mint}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-zinc-500 hover:text-cyan-400 p-0.5 transition flex items-center"
                        title="Verify token contract on Solscan"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href={`https://dexscreener.com/solana/${c.metadata.mint}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-zinc-500 hover:text-amber-400 p-0.5 transition flex items-center"
                        title="Open live chart on DexScreener"
                      >
                        <Flame className="w-3 h-3 text-amber-500" />
                      </a>
                    </div>

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
                        {c.micro.liquiditySol.toFixed(1)} SOL
                      </strong>
                    </span>
                    <span>
                      Heuristic Score:{' '}
                      <strong className={c.opportunity.opportunityScore >= 75 ? 'text-cyan-400' : 'text-zinc-400'}>
                        {c.opportunity.opportunityScore}/100
                      </strong>
                    </span>
                    <span>
                      Observed Run-up:{' '}
                      <strong className="text-zinc-200">
                        {c.entryMetrics?.runupPct.toFixed(1) ?? '0'}%
                      </strong>
                    </span>
                    <span>
                      Top 1:{' '}
                      <strong className={c.safety.top1Percent > 18 ? 'text-rose-400' : 'text-zinc-300'}>
                        {c.inspectionError || !c.inspectedAt ? 'unverified' : `${c.safety.top1Percent.toFixed(1)}%`}
                      </strong>
                    </span>
                    <span>
                      Curve custody:{' '}
                      <strong className={c.curveVerified ? 'text-emerald-400' : 'text-amber-400'}>
                        {c.curveVerified ? 'verified (no LP shares)' : 'unverified'}
                      </strong>
                    </span>
                  </div>

                  {c.executionError && <div className="text-xs text-amber-300 mt-1">Execution blocked: {c.executionError}</div>}
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

                {/* Right: Latency Breakdown, 1-Click Buy & Inspect */}
                <div className="flex items-center gap-3 sm:self-center shrink-0">
                  <div className="text-right font-mono">
                    <div className="text-[11px] text-zinc-500">Observed for</div>
                    <div className="text-xs font-bold text-cyan-400">{(latencyMs / 1000).toFixed(1)}s</div>
                    <div className="text-[9px] text-zinc-600">{c.entryStage}</div>
                  </div>

                  {/* ⚡ 1-Click Real Buy Button */}
                  <button
                    onClick={() => handle1ClickBuy(c)}
                    disabled={isEnrolling || !isApproved}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 text-xs font-mono font-bold transition shadow-sm"
                    title={`1-Click Buy $${c.metadata.symbol} on-chain with dedicated trading keypair`}
                  >
                    {isEnrolling ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>⚡ 1-Click Real Buy</span>
                  </button>

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
