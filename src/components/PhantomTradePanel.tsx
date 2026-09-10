import React, { useCallback, useEffect, useState } from 'react';
import { Wallet, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { approvePhantomTrade, connectPhantom, enablePhantomTrading, type ApprovalPhase } from '../phantomClient.ts';
import { DecisionAction, type CandidateTokenState, type Position, type WalletAutotradeConfig } from '../types.ts';

interface Props {
  candidate?: CandidateTokenState | null;
  initialMint?: string;
  initialSymbol?: string;
  onSuccess?: (positionId: string) => void;
  showPositions?: boolean;
  onBusyChange?: (busy: boolean) => void;
}
const phaseText: Record<ApprovalPhase, string> = {
  PREPARING: 'Checking the quote and preparing your transaction…',
  AWAITING_PHANTOM: 'Review and approve in Phantom. Reject it to cancel.',
  SUBMITTING: 'Submitting and waiting for on-chain confirmation…',
  CONFIRMED: 'Transaction confirmed on-chain.',
};
export const PhantomTradePanel: React.FC<Props> = ({ candidate, initialMint, initialSymbol, onSuccess, showPositions = true, onBusyChange }) => {
  const [config, setConfig] = useState<WalletAutotradeConfig | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [mode, setMode] = useState('SHADOW');
  const [mint, setMint] = useState(initialMint ?? candidate?.metadata.mint ?? '');
  const [symbol, setSymbol] = useState(initialSymbol ?? candidate?.metadata.symbol ?? 'TOKEN');
  const [size, setSize] = useState('0.02');
  const [liveConsent, setLiveConsent] = useState(false);
  const [manualRisk, setManualRisk] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [receipt, setReceipt] = useState<{ signature: string; url?: string }>();
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/state');
      if (!response.ok) return;
      const state = await response.json();
      setConfig(state.walletConfig ?? null);
      setMode(state.config?.mode ?? 'SHADOW');
      setPositions((state.activePositions ?? []).filter((p: Position) => p.signingMethod === 'PHANTOM'));
      if (state.config?.mode !== 'LIVE') setEnabled(false);
    } catch { /* Existing state stays visible during a transient polling failure. */ }
  }, []);
  useEffect(() => {
    void refresh(); const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    setMint(candidate?.metadata.mint ?? initialMint ?? '');
    setSymbol(candidate?.metadata.symbol ?? initialSymbol ?? 'TOKEN');
    setManualRisk(false); setReceipt(undefined); setError(''); setSummary('');
  }, [candidate?.metadata.mint, initialMint, initialSymbol]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); onBusyChange?.(true); setError(''); setReceipt(undefined); setSummary('');
    try { await work(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Phantom request failed'); setStatus(''); }
    finally { setBusy(false); onBusyChange?.(false); void refresh(); }
  };
  const approve = async (position?: Position, pct: 100 | 50 = 100) => {
    await run(async () => {
      const result = await approvePhantomTrade(position
        ? { action: 'SELL', positionId: position.id, pctToExit: pct, expectedWalletAddress: position.walletAddress }
        : { action: 'BUY', tokenMint: mint.trim(), symbol: symbol.trim() || 'TOKEN', name: candidate?.metadata.name ?? symbol,
          sizeSol: Number(size), requireEarlySignal: !!candidate, manualRiskAcknowledged: !candidate && manualRisk }, {
        onPhase: phase => setStatus(phaseText[phase]), onPrepared: prepared => setSummary(prepared.summary),
      });
      setReceipt({ signature: result.txSignature, url: result.explorerUrl });
      onSuccess?.(result.positionId ?? position?.id ?? '');
    });
  };
  const connected = !!config?.isConnected && !!config.walletAddress;
  const canBuy = enabled && liveConsent && mode === 'LIVE' && connected && mint.trim() && Number.isFinite(Number(size)) && Number(size) > 0 &&
    (candidate ? candidate.decision === DecisionAction.BUY : manualRisk);
  return <section className="rounded-xl border border-violet-500/40 bg-zinc-950 p-5 space-y-5" aria-label="Phantom approval trading">
    <div className="flex items-start gap-3">
      <Wallet className="w-6 h-6 text-violet-300 shrink-0" />
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Trade with Phantom</h2>
        <p className="text-sm text-zinc-400 mt-1">Your existing wallet. You approve every buy and sell in Phantom. No separate trading wallet or private-key import.</p>
      </div>
    </div>
    <div className="rounded-lg bg-zinc-900 p-3 text-sm space-y-2">
      <p className="text-zinc-300">Server mode: <strong>{mode}</strong> · Solana mainnet</p>
      <p className="text-zinc-400 break-all">Connected address: {connected ? config!.walletAddress : 'Not connected'}</p>
      {connected && <p className="text-zinc-400">Last reported balance: {config!.balanceSol.toFixed(4)} SOL</p>}
      <button disabled={busy} className="rounded bg-violet-600 px-4 py-2 text-white disabled:opacity-40" onClick={() => void run(async () => {
        setStatus('Connect your Phantom account…'); await connectPhantom(); setEnabled(false); setStatus('Phantom connected. No trading permission or private key was shared.');
      })}>{connected ? 'Connect / change Phantom account' : 'Connect Phantom'}</button>
    </div>
    <div className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-100 space-y-3">
      <p><AlertTriangle className="inline w-4 h-4 mr-1" />Manual approval means stops and take-profits cannot sell silently. Keep the app open and approve exits yourself. Cancelling a popup does not close an existing position.</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={liveConsent} disabled={busy} onChange={e => setLiveConsent(e.target.checked)} className="mt-1" />
        <span>I understand this uses real SOL on mainnet and every trade requires my Phantom approval.</span>
      </label>
      <button disabled={busy || !liveConsent || !connected} className="rounded bg-amber-700 px-4 py-2 text-white disabled:opacity-40" onClick={() => void run(async () => {
        await enablePhantomTrading(); setEnabled(true); setStatus('Manual Phantom trading enabled. Server-side autotrading is off.');
      })}>{enabled && mode === 'LIVE' ? 'Manual Phantom trading enabled' : 'Enable manual Phantom trading'}</button>
      <p className="text-xs text-zinc-400">The local server must have <code>ENABLE_LIVE_TRADING=true</code> and Jupiter API access (<code>JUPITER_API_KEY</code>). The API credential is not your Phantom wallet key. Enabling this does not fund anything or submit a transaction.</p>
    </div>
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-100">{candidate ? 'Review early-entry signal' : 'Manual token swap'}</h3>
      <label className="block text-sm text-zinc-400">Token mint address
        <input aria-label="Phantom token mint" value={mint} disabled={busy || !!candidate} onChange={e => { setMint(e.target.value); setManualRisk(false); }}
          className="mt-1 block w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-zinc-100 font-mono" placeholder="Paste the token mint, not your wallet address" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-zinc-400">Label (optional)<input aria-label="Token label" value={symbol} disabled={busy || !!candidate} onChange={e => setSymbol(e.target.value)} className="mt-1 block w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-zinc-100" /></label>
        <label className="text-sm text-zinc-400">Buy amount (SOL)<input aria-label="Phantom buy amount SOL" type="number" min="0.000000001" step="0.001" value={size} disabled={busy} onChange={e => setSize(e.target.value)} className="mt-1 block w-full rounded bg-zinc-900 border border-zinc-700 p-2 text-zinc-100" /></label>
      </div>
      {candidate ? <p className="text-xs text-amber-200">{candidate.entryMetrics?.label ?? candidate.decision}. The signal must remain valid through approval. If it expires or price moves too far, the signed transaction will not be submitted.</p>
        : <label className="flex items-start gap-2 text-sm text-amber-200"><input type="checkbox" checked={manualRisk} disabled={busy} onChange={e => setManualRisk(e.target.checked)} className="mt-1" />
          <span>This is my manual token selection, not a bot-approved early entry. I understand that launch, holder and liquidity safety are not established by this swap form.</span></label>}
      <button disabled={busy || !canBuy} className="rounded bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-40" onClick={() => void approve()}>
        {busy ? <Loader2 className="inline w-4 h-4 mr-2 animate-spin" /> : null}Review buy in Phantom
      </button>
      {!candidate && <p className="text-xs text-zinc-500">Manual swaps do not require the launch scanner feed. Automated entry discovery remains a separate, unconfigured capability.</p>}
    </div>
    <div aria-live="polite" className="space-y-2 text-sm">
      {status && <p className="text-violet-200">{status}</p>}
      {summary && <p className="text-zinc-400">{summary}</p>}
      {error && <p role="alert" className="rounded border border-rose-500/40 bg-rose-950/30 p-3 text-rose-200">{error}</p>}
      {receipt && <p className="text-emerald-300 break-all">Confirmed: {receipt.url ? <a href={receipt.url} target="_blank" rel="noreferrer" className="underline">{receipt.signature}<ExternalLink className="inline w-3 h-3 ml-1" /></a> : receipt.signature}</p>}
    </div>
    {showPositions && <div className="border-t border-zinc-800 pt-4 space-y-3">
      <h3 className="text-sm font-semibold text-zinc-100">Phantom positions requiring your exit approval</h3>
      {positions.length === 0 && <p className="text-sm text-zinc-500">No tracked Phantom positions. Unrelated tokens in your wallet are not sold by this panel.</p>}
      {positions.map(position => <div key={position.id} className="rounded bg-zinc-900 p-3 space-y-2">
        <p className="text-sm text-zinc-100">{position.symbol} · {position.sizeTokens} tokens</p>
        {position.exitApprovalRequired && <p className="text-sm text-amber-200">Exit approval requested: {position.exitApprovalReason}</p>}
        <div className="flex gap-2">
          <button disabled={busy} className="rounded border border-zinc-600 px-3 py-2 text-sm text-zinc-200 disabled:opacity-40" onClick={() => void approve(position, 50)}>Review 50% sell</button>
          <button disabled={busy} className="rounded bg-rose-800 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => void approve(position, 100)}>Review full sell in Phantom</button>
        </div>
      </div>)}
    </div>}
  </section>;
};
