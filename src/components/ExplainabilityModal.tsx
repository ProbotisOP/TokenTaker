import React from 'react';
import { X, ShieldCheck, ExternalLink } from 'lucide-react';
import { CandidateTokenState, DecisionAction } from '../types.ts';

interface ExplainabilityModalProps {
  candidate: CandidateTokenState | null;
  onClose: () => void;
  onRealBuy?: (candidate: CandidateTokenState) => void;
}

export const ExplainabilityModal: React.FC<ExplainabilityModalProps> = ({ candidate, onClose, onRealBuy }) => {
  if (!candidate) return null;
  const { metadata, safety, micro, entryMetrics } = candidate;
  const known = !!candidate.inspectedAt && !candidate.inspectionError;
  const approved = candidate.decision === DecisionAction.BUY;
  const fact = (value: string) => known ? value : 'Unverified';
  const rows = [
    ['Mint authority', fact(safety.mintAuthorityRevoked ? 'Revoked' : 'Active')],
    ['Freeze authority', fact(safety.freezeAuthorityRevoked ? 'Revoked' : 'Active')],
    ['Curve custody', candidate.curveVerified && known ? 'Verified active Pump curve; LP burn not applicable' : 'Unverified'],
    ['Real SOL reserves', fact(`${micro.liquiditySol.toFixed(3)} SOL`)],
    ['Top 1 / 5 / 10 owner concentration', fact(`${safety.top1Percent.toFixed(1)}% / ${safety.top5Percent.toFixed(1)}% / ${safety.top10Percent.toFixed(1)}%`)],
    ['Creator ownership', fact(`${safety.creatorOwnershipPercent.toFixed(1)}%`)],
    ['Observed independent buyer addresses (10s)', String(entryMetrics?.uniqueBuyers ?? 0)],
    ['Observed net flow (10s)', `${(entryMetrics?.netFlowSol ?? 0).toFixed(3)} SOL`],
    ['Largest buyer share of buy volume', `${((entryMetrics?.largestBuyerShare ?? 0) * 100).toFixed(1)}%`],
    ['Run-up from launch observation', `${(entryMetrics?.runupPct ?? 0).toFixed(1)}%`],
    ['Price extension over accumulation anchor', `${(entryMetrics?.anchorExtensionPct ?? 0).toFixed(1)}%`],
    ['Price acceleration (5s halves)', `${(entryMetrics?.priceAccelerationPct ?? 0).toFixed(2)} pp`],
    ['Volume acceleration (5s halves)', entryMetrics?.volumeAcceleration == null ? 'Unverified' : `${entryMetrics.volumeAcceleration.toFixed(2)}×`],
    ['Verified holder change', entryMetrics?.holderGrowth == null ? 'Unverified' : String(entryMetrics.holderGrowth)],
    ['Verified liquidity change', entryMetrics?.liquidityChangePct == null ? 'Unverified' : `${entryMetrics.liquidityChangePct.toFixed(1)}%`],
    ['Entry structure', entryMetrics?.entryStyle?.replaceAll('_', ' ') ?? 'Observing'],
    ['Wallet profitability / common funding / wash networks', 'Unverified; distinct addresses can share an owner'],
    ['Expected return / win probability', 'Not calibrated; no forecast supplied'],
    ['Execution', candidate.executionStatus ?? 'NOT_SUBMITTED'],
  ];
  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Launch inspection">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-3xl w-full flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
          <h2 className="text-zinc-100 font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5" />${metadata.symbol}: {candidate.entryStage}</h2>
          <button onClick={onClose} aria-label="Close inspection"><X className="w-5 h-5 text-zinc-300" /></button>
        </div>
        <div className="p-5 overflow-auto space-y-4 text-xs font-mono">
          <a className="text-cyan-300 break-all flex items-center gap-2" href={`https://solscan.io/token/${metadata.mint}`} target="_blank" rel="noreferrer">{metadata.mint}<ExternalLink className="w-3 h-3 shrink-0" /></a>
          <div className={`p-3 rounded border ${approved ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-200'}`}>
            <strong>{entryMetrics?.label ?? candidate.decision}</strong>
            {approved && <p className="mt-1">Setup only. Not a fill, calibrated forecast, or profit guarantee.</p>}
            <ul className="list-disc list-inside mt-2 space-y-1">{candidate.decisionReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
          </div>
          <dl className="divide-y divide-zinc-800">{rows.map(([label, value]) => (
            <div key={label} className="py-2 grid grid-cols-2 gap-4"><dt className="text-zinc-400">{label}</dt><dd className="text-zinc-200">{value}</dd></div>
          ))}</dl>
          <div className="text-zinc-400 space-y-1">
            <div>Feed received: {new Date(candidate.detected_at).toISOString()}</div>
            <div>Verified creation: {metadata.created_at ? new Date(metadata.created_at).toISOString() : 'pending'}</div>
            <div>Last safety inspection: {candidate.inspectedAt ? new Date(candidate.inspectedAt).toISOString() : 'pending'}</div>
            <div>Observation time: {((candidate.decision_at - candidate.detected_at) / 1000).toFixed(1)}s. This includes deliberate confirmation waiting, not just compute latency.</div>
          </div>
          {(candidate.inspectionError || candidate.executionError) && <p className="text-amber-300">{candidate.inspectionError || candidate.executionError}</p>}
        </div>
        <div className="p-4 border-t border-zinc-800 flex justify-end gap-3">
          {onRealBuy && <button disabled={!approved} className="px-4 py-2 bg-emerald-500 text-zinc-950 rounded disabled:opacity-30" onClick={() => { onClose(); onRealBuy(candidate); }}>Review real buy</button>}
          <button className="px-4 py-2 bg-zinc-800 text-zinc-200 rounded" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
