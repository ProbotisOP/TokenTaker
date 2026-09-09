import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Key,
  Wallet,
  Activity,
  Zap,
  Sliders,
  Radio,
  Lock,
  ArrowRight,
} from 'lucide-react';
import { LivePreflightReport, SolanaNetwork } from '../types.ts';

interface LivePreflightCenterProps {
  onPreflightComplete?: (report: LivePreflightReport) => void;
  onOpenKeypairModal: () => void;
  configuredAddress?: string | null;
  network?: SolanaNetwork;
  lastPassed?: boolean;
}

export const LivePreflightCenter: React.FC<LivePreflightCenterProps> = ({
  onPreflightComplete,
  onOpenKeypairModal,
  configuredAddress,
  network = 'mainnet-beta',
  lastPassed,
}) => {
  const [report, setReport] = useState<LivePreflightReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runPreflight = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/wallet/preflight', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Preflight diagnostic failed');
      }
      setReport(data.report);
      if (onPreflightComplete) {
        onPreflightComplete(data.report);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error running preflight');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch of preflight report on mount
    fetch('/api/wallet/preflight')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.report) {
          setReport(d.report);
        }
      })
      .catch(() => {});
  }, []);

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 3000);
  };

  const displayAddress = report?.configuredAddress || configuredAddress;

  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-5 sm:p-6 flex flex-col gap-6 shadow-xl font-mono">
      {/* Header & Safety Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400">
            <Zap className="w-5 h-5" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-100">
              Live Preflight Diagnostic Mode (11-Point Suite)
            </h3>
          </div>
          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
            Rigorous pre-trade validation engine. <strong className="text-emerald-400">Zero transactions are broadcast or signed. Zero funds are spent.</strong>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenKeypairModal}
            className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition flex items-center gap-1.5"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>Dedicated Keypair Setup</span>
          </button>

          <button
            onClick={runPreflight}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-zinc-950 text-xs font-bold uppercase tracking-wider transition shadow-lg flex items-center gap-1.5"
          >
            {isLoading ? (
              <RefreshCw className="w-4 h-4 animate-spin text-zinc-950" />
            ) : (
              <Activity className="w-4 h-4 text-zinc-950" />
            )}
            <span>{isLoading ? 'Verifying 11 Checks...' : 'Run Preflight Diagnostic'}</span>
          </button>
        </div>
      </div>

      {/* Configured Address Verification Card */}
      <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col gap-2.5">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span className="font-bold text-zinc-300 uppercase tracking-wide">
            Configured Trading Wallet Address (Compare with Phantom Sub-Account):
          </span>
          <span className="text-[11px] text-zinc-500 font-normal">Must match viewable account in Phantom</span>
        </div>

        {displayAddress ? (
          <div className="flex items-center justify-between gap-3 bg-zinc-900 p-3 rounded-lg border border-zinc-800 flex-wrap">
            <div className="flex items-center gap-2 truncate">
              <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs sm:text-sm font-bold text-zinc-100 truncate">
                {displayAddress}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => copyAddress(displayAddress)}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-400 text-xs font-semibold flex items-center gap-1 transition"
              >
                {copiedAddress ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedAddress ? 'Copied!' : 'Copy'}</span>
              </button>
              <a
                href={`https://solscan.io/account/${displayAddress}${network === 'devnet' ? '?cluster=devnet' : ''}`}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-cyan-400 text-xs font-semibold flex items-center gap-1 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Solscan</span>
              </a>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-600/50 text-xs text-rose-300 flex items-center justify-between">
            <span>No trading wallet configured. Setup or generate a dedicated keypair to begin.</span>
            <button
              onClick={onOpenKeypairModal}
              className="px-3 py-1 rounded bg-rose-600 text-white font-bold text-xs uppercase"
            >
              Setup Keypair
            </button>
          </div>
        )}
      </div>

      {/* Error notification if any */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500 text-rose-200 text-xs flex items-center gap-2">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Overall Verdict Banner */}
      {report && (
        <div
          className={`p-4 rounded-xl border-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition shadow-lg ${
            report.passed
              ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200'
              : 'bg-rose-950/50 border-rose-500 text-rose-200'
          }`}
        >
          <div className="flex items-start gap-3">
            {report.passed ? (
              <ShieldCheck className="w-7 h-7 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-7 h-7 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div>
              <div className="text-xs sm:text-sm font-bold uppercase tracking-wide">
                {report.passed
                  ? 'LIVE PREFLIGHT PASSED — READY FOR ON-CHAIN TRADING'
                  : 'LIVE PREFLIGHT FAILED — LIVE TRADING DISABLED'}
              </div>
              <p className="text-[11px] opacity-90 mt-0.5 leading-relaxed">
                {report.summary}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-[11px] font-bold">
              {report.checks.filter((c) => c.status === 'PASS').length}/11 Checks Passed
            </div>
            <div className="text-[10px] opacity-75">
              Zero transactions broadcasted
            </div>
          </div>
        </div>
      )}

      {/* 11 Checks List */}
      <div className="flex flex-col gap-2.5">
        <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1 flex items-center justify-between">
          <span>Diagnostic Verification Checklist (11 Points):</span>
          {report && (
            <span className="text-[11px] font-normal text-zinc-500">
              Verified at {new Date(report.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>

        {report?.checks && report.checks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {report.checks.map((c, idx) => {
              const isPass = c.status === 'PASS';
              const isWarn = c.status === 'WARN';
              const isFail = c.status === 'FAIL';

              return (
                <div
                  key={c.id || idx}
                  className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2 transition ${
                    isPass
                      ? 'bg-zinc-950/70 border-emerald-950 hover:border-emerald-800'
                      : isWarn
                      ? 'bg-amber-950/20 border-amber-800/60'
                      : 'bg-rose-950/30 border-rose-800/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isPass && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                      {isWarn && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                      {isFail && <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                      <span className="text-xs font-bold text-zinc-200">
                        {idx + 1}. {c.name}
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        isPass
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : isWarn
                          ? 'bg-amber-950 text-amber-300 border border-amber-700'
                          : 'bg-rose-950 text-rose-300 border border-rose-700'
                      }`}
                    >
                      {c.status}
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-400 leading-relaxed font-mono">
                    {c.message}
                  </p>

                  {c.id === 'keypair_loaded' && c.status === 'FAIL' && (
                    <button
                      onClick={onOpenKeypairModal}
                      className="mt-1 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 text-xs font-bold font-mono transition flex items-center gap-1.5 self-start shadow"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>Setup / Import Matching Keypair</span>
                    </button>
                  )}

                  {c.id === 'sol_balance' && c.status === 'FAIL' && (
                    <div className="mt-1 p-2 rounded bg-amber-950/40 border border-amber-500/30 text-[10px] text-amber-200">
                      💡 Tip: If you have SOL in your Phantom wallet, click "Dedicated Keypair Setup" &rarr; "Import Sub-Account Key" to use your funded wallet.
                    </div>
                  )}

                  {c.durationMs !== undefined && (
                    <div className="text-[10px] text-zinc-600 text-right">
                      {c.durationMs}ms
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-zinc-500 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col items-center gap-2">
            <Activity className="w-6 h-6 text-zinc-600 animate-pulse" />
            <span>Click "Run Preflight Diagnostic" above to evaluate all 11 security and execution gates.</span>
          </div>
        )}
      </div>
    </div>
  );
};
