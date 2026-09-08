import React, { useState, useEffect } from 'react';
import {
  Flame,
  Cpu,
  Server,
  Zap,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Play,
  Pause,
  DollarSign,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Sparkles,
  Trash2,
  Edit3,
  Layers,
  ChevronRight,
  Sliders,
  Check,
  ShieldAlert,
  Lock,
} from 'lucide-react';
import { GrokBotCycleLog, GrokBotPosition, GrokBotState } from '../types.ts';

const SOL_USD = 155.0;

export const GrokBotStudio: React.FC = () => {
  const [botState, setBotState] = useState<GrokBotState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingDirective, setEditingDirective] = useState<boolean>(false);
  const [directiveInput, setDirectiveInput] = useState<string>('');
  const [confirmWipeOpen, setConfirmWipeOpen] = useState<boolean>(false);
  const [customBankrollInput, setCustomBankrollInput] = useState<string>('41');
  const [filterAction, setFilterAction] = useState<string>('ALL');
  const [injectingLaunch, setInjectingLaunch] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [customPosSl, setCustomPosSl] = useState<number>(-12);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleTradeExit = async (
    positionId: string,
    action: 'FLATTEN_100' | 'SCALE_OUT_50' | 'BREAKEVEN_SL' | 'CUSTOM_SL_TP',
    customSl?: number
  ) => {
    try {
      const res = await fetch('/api/wallet/trade-exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, action, customStopLossPct: customSl }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Position updated');
        setEditingPosId(null);
        fetchBotState();
      }
    } catch (err: any) {
      showToast('Exit error: ' + err.message);
    }
  };

  const fetchBotState = async () => {
    try {
      const res = await fetch('/api/grok-bot/state');
      const data = await res.json();
      if (data.success && data.state) {
        setBotState(data.state);
        if (!editingDirective) {
          setDirectiveInput(data.state.directive);
        }
      }
    } catch (err) {
      console.error('Failed to fetch Grok Bot state:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBotState();
    const interval = setInterval(fetchBotState, 1500); // 1.5s polling for ultra-responsive live paper updates
    return () => clearInterval(interval);
  }, []);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleSaveDirective = async () => {
    try {
      const res = await fetch('/api/grok-bot/directive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directive: directiveInput }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingDirective(false);
        showNotification(`Directive updated: "${data.directive}"`);
        fetchBotState();
      }
    } catch (err) {
      console.error('Failed to update directive:', err);
    }
  };

  const handleToggleStatus = async () => {
    if (!botState) return;
    const nextStatus = botState.cloudBoxStatus === 'ONLINE' ? 'PAUSED' : 'ONLINE';
    try {
      const res = await fetch('/api/grok-bot/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Cloud box status: ${nextStatus}`);
        fetchBotState();
      }
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  const handleSetSpeed = async (speedMs: number) => {
    try {
      const res = await fetch('/api/grok-bot/speed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speedMs }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Cycle speed set to ${(speedMs / 1000).toFixed(1)}s`);
        fetchBotState();
      }
    } catch (err) {
      console.error('Failed to set speed:', err);
    }
  };

  const handleWipeBot = async (bankroll: number = 41.0) => {
    try {
      const res = await fetch('/api/grok-bot/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startingBankroll: bankroll, preserveDirective: true }),
      });
      const data = await res.json();
      if (data.success) {
        setConfirmWipeOpen(false);
        showNotification(`Bot wiped! Re-funded with $${bankroll.toFixed(2)}.`);
        fetchBotState();
      }
    } catch (err) {
      console.error('Failed to wipe bot:', err);
    }
  };

  const handleInjectPreset = async (preset: 'GEM' | 'RUG' | 'FAKE_HYPE') => {
    setInjectingLaunch(true);
    try {
      const res = await fetch('/api/grok-bot/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Injected ${preset}: ${data.log.action} on $${data.log.symbol}`);
        fetchBotState();
      }
    } catch (err) {
      console.error('Failed to inject launch:', err);
    } finally {
      setInjectingLaunch(false);
    }
  };

  if (loading || !botState) {
    return (
      <div className="flex items-center justify-center p-16 text-zinc-400 font-mono text-xs gap-3">
        <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
        Connecting to Autonomous Cloud Box Paper Flipper...
      </div>
    );
  }

  const netPnlUsd = botState.currentEquityUsd - botState.initialBankrollUsd;
  const netPnlPct = (netPnlUsd / botState.initialBankrollUsd) * 100;
  const filteredLogs = botState.flipHistory.filter((log) => {
    if (filterAction === 'ALL') return true;
    if (filterAction === 'BUYS') return log.action === 'SNIPE_BUY';
    if (filterAction === 'EXITS') return log.action === 'SCALE_OUT' || log.action === 'TAKE_PROFIT' || log.action === 'STOP_LOSS';
    if (filterAction === 'SKIPS') return log.action.startsWith('SKIP');
    return true;
  });

  const uptimeDays = Math.floor(botState.cloudUptimeSec / 86400);
  const uptimeHours = Math.floor((botState.cloudUptimeSec % 86400) / 3600);
  const uptimeMins = Math.floor((botState.cloudUptimeSec % 3600) / 60);

  return (
    <div className="flex flex-col gap-5">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-20 right-6 z-50 bg-amber-500/90 text-zinc-950 px-4 py-2.5 rounded-lg font-mono text-xs font-bold shadow-xl flex items-center gap-2 border border-amber-400 animate-in fade-in slide-in-from-top-2">
          <Sparkles className="w-4 h-4" />
          {notification}
        </div>
      )}

      {/* Top Banner: Viral Cloud Bot Directive & Status */}
      <div className="bg-gradient-to-r from-amber-950/40 via-zinc-900 to-zinc-900 border border-amber-500/30 rounded-xl p-5 relative overflow-hidden shadow-xl">
        <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
          <Flame className="w-64 h-64 text-amber-400" />
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex items-start gap-3.5">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 shrink-0 mt-0.5">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-base font-mono font-bold text-zinc-100 flex items-center gap-2">
                  <span>Grok Autonomous Paper Flipper</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                    Autopilot
                  </span>
                </h1>
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-emerald-950/60 border border-emerald-800 text-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{botState.cloudBoxStatus === 'ONLINE' ? 'Cloud Box Online' : 'Autopilot Paused'}</span>
                </div>
                <span className="text-zinc-500 font-mono text-xs">
                  Uptime: {uptimeDays}d {uptimeHours}h {uptimeMins}m
                </span>
              </div>

              {/* The One-Line Directive */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider font-semibold">
                  Directive:
                </span>
                {editingDirective ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={directiveInput}
                      onChange={(e) => setDirectiveInput(e.target.value)}
                      className="px-3 py-1 bg-zinc-950 border border-amber-500/60 rounded text-xs font-mono text-amber-200 w-80 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      placeholder="e.g. turn a profit or I wipe you"
                    />
                    <button
                      onClick={handleSaveDirective}
                      className="px-3 py-1 bg-amber-500 text-zinc-950 rounded text-xs font-mono font-bold hover:bg-amber-400 transition"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingDirective(false)}
                      className="px-2 py-1 text-xs font-mono text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 font-mono text-xs font-semibold text-amber-300 italic">
                      "{botState.directive}"
                    </span>
                    <button
                      onClick={() => setEditingDirective(true)}
                      className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-amber-300 rounded transition"
                      title="Edit directive"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-2 text-xs text-zinc-400 leading-relaxed font-sans max-w-3xl">
                Funded with <strong className="text-zinc-200">${botState.initialBankrollUsd.toFixed(2)}</strong>.
                Scans fresh launches before charts render, throws out rugs &amp; insider bundles, checks chatter against on-chain mempool flow, scales dynamic tickets, rotates without pinging for confirmation, and pays its own server bill out of the top.
              </div>
            </div>
          </div>

          {/* Quick Controls */}
          <div className="flex flex-wrap lg:flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleStatus}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold border transition ${
                  botState.cloudBoxStatus === 'ONLINE'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                    : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                }`}
              >
                {botState.cloudBoxStatus === 'ONLINE' ? (
                  <>
                    <Pause className="w-3.5 h-3.5" /> Pause Autopilot
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" /> Resume Autopilot
                  </>
                )}
              </button>

              <button
                onClick={() => setConfirmWipeOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-rose-950/50 border border-rose-800/60 text-rose-300 hover:bg-rose-900/50 transition"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" /> Wipe &amp; Restart
              </button>
            </div>

            {/* Cycle Speed Controls */}
            <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded-lg p-1 text-[11px] font-mono">
              <span className="px-2 text-zinc-500">Cycle:</span>
              {[
                { label: 'Turbo (1.5s)', speed: 1500 },
                { label: 'Normal (3s)', speed: 3000 },
                { label: 'Safe (6s)', speed: 6000 },
              ].map((s) => (
                <button
                  key={s.speed}
                  onClick={() => handleSetSpeed(s.speed)}
                  className={`px-2 py-0.5 rounded transition ${
                    botState.cycleSpeedMs === s.speed
                      ? 'bg-amber-500 text-zinc-950 font-bold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Confirm Wipe Modal */}
      {confirmWipeOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-rose-500/50 rounded-xl p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-mono font-bold text-base text-zinc-100">Wipe Bot &amp; Re-Fund Bankroll</h3>
            </div>
            <p className="text-xs font-mono text-zinc-400 leading-relaxed">
              This executes the literal clause of your directive: <em>"turn a profit or I wipe you"</em>.
              All active flips and accumulated bankroll will be reset to your initial funding amount.
            </p>
            <div className="flex items-center gap-2 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
              <span className="text-xs font-mono text-zinc-400">Initial Funding Amount ($ USD):</span>
              <input
                type="number"
                value={customBankrollInput}
                onChange={(e) => setCustomBankrollInput(e.target.value)}
                className="w-24 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs font-mono text-amber-300 font-bold focus:outline-none"
              />
              <div className="flex gap-1">
                {[41, 55, 100].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setCustomBankrollInput(String(amt))}
                    className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                onClick={() => setConfirmWipeOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-mono text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={() => handleWipeBot(Number(customBankrollInput) || 41.0)}
                className="px-4 py-2 rounded-lg text-xs font-mono font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg transition"
              >
                Yes, Wipe &amp; Re-Fund
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hero Financial Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Current Equity */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Current Equity</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-mono font-extrabold text-zinc-100">
              ${botState.currentEquityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1 mt-0.5">
              <TrendingUp className="w-3 h-3" />
              <span>{netPnlPct >= 0 ? '+' : ''}{netPnlPct.toFixed(1)}% from start</span>
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">
            Cash: ${botState.cashUsd.toFixed(2)} | In Flips: ${botState.activeExposureUsd.toFixed(2)}
          </div>
        </div>

        {/* Initial Bankroll */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Funded Baseline</span>
            <Clock className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-mono font-extrabold text-amber-300">
              ${botState.initialBankrollUsd.toFixed(2)}
            </div>
            <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
              Net Gain: <strong className="text-emerald-300">+${netPnlUsd.toFixed(2)}</strong>
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">
            Opening test funded by operator
          </div>
        </div>

        {/* Server Bill Reserved Out of Top */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Server Bill Reserved</span>
            <Server className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-mono font-extrabold text-cyan-300">
              ${botState.serverBillReservedUsd.toFixed(2)}
            </div>
            <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
              Cloud Box: <strong className="text-zinc-200">Paid Out of Top</strong>
            </div>
          </div>
          <div className="text-[10px] font-mono text-cyan-500/80 mt-1">
            ~{(botState.serverBillReservedUsd / botState.serverBillRatePerDayUsd).toFixed(1)} days hosting covered
          </div>
        </div>

        {/* Dynamic Scaled Ticket Size */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Scaled Next Buy</span>
            <Zap className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-mono font-extrabold text-purple-300">
              ${botState.currentTicketSizeUsd.toFixed(2)}
            </div>
            <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
              Last exit: <strong className={botState.lastExitOutcome === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}>{botState.lastExitOutcome} ({botState.lastExitPnlPct >= 0 ? '+' : ''}{botState.lastExitPnlPct.toFixed(1)}%)</strong>
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">
            Never a flat ticket &bull; Scaled
          </div>
        </div>

        {/* Win Rate & Flips */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Win Rate</span>
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-mono font-extrabold text-zinc-100">
              {botState.winRatePct}%
            </div>
            <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
              {botState.winningFlips} Wins / {botState.losingFlips} Losses
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">
            Total Flips: {botState.totalFlips}
          </div>
        </div>

        {/* Night 1 Dip & Crucible */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Crucible Dip</span>
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-mono font-extrabold text-rose-400">
              ${botState.nightOneDipUsd.toFixed(2)}
            </div>
            <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
              Dipped, tightened, bent up
            </div>
          </div>
          <div className="text-[10px] font-mono text-emerald-400 mt-1">
            Peak: ${botState.peakEquityUsd.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (7 cols): Current Cycle Inspector & Active Open Flips */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Live 5-Step Pipeline Card */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col shadow-lg">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-400" />
                <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
                  Autonomous Cycle Pipeline
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-zinc-500">Phase:</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-800 text-amber-300">
                  {botState.currentCyclePhase}
                </span>
              </div>
            </div>

            {/* 5 Steps Visualizer */}
            <div className="p-4 bg-zinc-950/60 border-b border-zinc-800/80">
              <div className="grid grid-cols-5 gap-2 text-center">
                {[
                  {
                    step: 1,
                    name: 'Pool Depth',
                    desc: 'Reads pool before chart renders',
                    active: botState.currentCyclePhase === 'SCANNING_POOL',
                  },
                  {
                    step: 2,
                    name: 'Safety Pass',
                    desc: 'Mint, LP lock, top wallet conc.',
                    active: botState.currentCyclePhase === 'CHECKING_SAFETY',
                  },
                  {
                    step: 3,
                    name: 'Chatter vs Flow',
                    desc: 'Weighs hype vs mempool buys',
                    active: botState.currentCyclePhase === 'ANALYZING_FLOW',
                  },
                  {
                    step: 4,
                    name: 'Slippage Precheck',
                    desc: 'Pulls only when entry clean',
                    active: botState.currentCyclePhase === 'PRECHECKING_SLIPPAGE',
                  },
                  {
                    step: 5,
                    name: 'Scaled Snipe',
                    desc: 'Dynamic size from last exit',
                    active: botState.currentCyclePhase === 'EXECUTING_ROTATION',
                  },
                ].map((s) => (
                  <div
                    key={s.step}
                    className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition ${
                      s.active
                        ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-sm'
                        : 'bg-zinc-900/40 border-zinc-800/60 text-zinc-500'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold bg-zinc-800 border border-zinc-700">
                      {s.step}
                    </span>
                    <span className="text-[11px] font-mono font-bold leading-tight text-zinc-200">
                      {s.name}
                    </span>
                    <span className="text-[9px] font-mono leading-tight text-zinc-400 line-clamp-2">
                      {s.desc}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Current Inspected Candidate Details */}
            {botState.currentInspectedToken && (
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-bold text-zinc-100">
                      ${botState.currentInspectedToken.symbol}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {botState.currentInspectedToken.name}
                    </span>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded text-[11px] font-mono font-bold border ${
                      botState.currentInspectedToken.status === 'SNIPED'
                        ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                        : botState.currentInspectedToken.status === 'REJECTED'
                        ? 'bg-rose-950/80 border-rose-700 text-rose-300'
                        : 'bg-zinc-800 border-zinc-700 text-amber-300'
                    }`}
                  >
                    {botState.currentInspectedToken.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/80">
                  <div>
                    <span className="text-zinc-500 text-[10px] block">Pool Depth</span>
                    <strong className="text-zinc-200">
                      {botState.currentInspectedToken.poolDepthSol.toFixed(1)} SOL
                    </strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 text-[10px] block">LP Lock &amp; Mint</span>
                    <span className="flex items-center gap-1">
                      {botState.currentInspectedToken.lpLocked && botState.currentInspectedToken.mintAuthRevoked ? (
                        <span className="text-emerald-400 font-bold">100% Locked</span>
                      ) : (
                        <span className="text-rose-400 font-bold">Unsafe / Active</span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 text-[10px] block">Top 10 Wallets</span>
                    <strong className={botState.currentInspectedToken.top10Pct > 48 ? 'text-rose-400' : 'text-zinc-200'}>
                      {botState.currentInspectedToken.top10Pct.toFixed(1)}%
                    </strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 text-[10px] block">Mempool Flow</span>
                    <strong className="text-emerald-400">
                      +{botState.currentInspectedToken.mempoolFlowSol.toFixed(1)} SOL
                    </strong>
                  </div>
                </div>

                <div className="text-xs font-mono text-zinc-400 flex items-center gap-2">
                  <span className="text-zinc-500">Autonomous Verdict:</span>
                  <span className="text-zinc-300">{botState.currentInspectedToken.statusText}</span>
                </div>
              </div>
            )}

            {/* Test Injection Buttons */}
            <div className="px-4 py-3 bg-zinc-950 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-zinc-500">Inject Launch to Inspect:</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleInjectPreset('GEM')}
                  disabled={injectingLaunch}
                  className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-emerald-950/60 border border-emerald-700 text-emerald-300 hover:bg-emerald-900/60 transition disabled:opacity-50"
                >
                  🚀 Clean Gem
                </button>
                <button
                  onClick={() => handleInjectPreset('RUG')}
                  disabled={injectingLaunch}
                  className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-rose-950/60 border border-rose-700 text-rose-300 hover:bg-rose-900/60 transition disabled:opacity-50"
                >
                  ⚠️ Honeypot / Rug
                </button>
                <button
                  onClick={() => handleInjectPreset('FAKE_HYPE')}
                  disabled={injectingLaunch}
                  className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-amber-950/60 border border-amber-700 text-amber-300 hover:bg-amber-900/60 transition disabled:opacity-50"
                >
                  📢 Fake Social Hype
                </button>
              </div>
            </div>
          </div>

          {/* Active Open Positions (Flips In Progress) */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col shadow-lg">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-purple-400" />
                <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
                  Active Flips ({botState.activePositions.length} Open)
                </h2>
              </div>
              <div className="text-[11px] font-mono text-zinc-500">
                Rotates without pinging operator &bull; Trailing Stops
              </div>
            </div>

            <div className="divide-y divide-zinc-800/70 overflow-y-auto max-h-[380px]">
              {botState.activePositions.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-zinc-500">
                  No active flips. Cash ready (${botState.cashUsd.toFixed(2)}). Bot scanning next fresh launch.
                </div>
              ) : (
                botState.activePositions.map((pos) => {
                  const isPositive = pos.unrealizedPnlUsd >= 0;
                  return (
                    <div key={pos.id} className="p-4 hover:bg-zinc-800/30 transition flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm text-zinc-100">${pos.symbol}</span>
                            <span className="text-xs text-zinc-400">{pos.name}</span>
                            <span className="text-[11px] font-mono text-zinc-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {pos.holdingTimeSec}s held
                            </span>
                          </div>
                          <div className="text-xs font-mono text-zinc-400 mt-1 flex flex-wrap items-center gap-3">
                            <span>
                              Entry: <strong>${pos.entryPriceUsd.toFixed(6)}</strong>
                            </span>
                            <span>
                              Current: <strong>${pos.currentPriceUsd.toFixed(6)}</strong>
                            </span>
                            <span>
                              Cost: <strong>${pos.costBasisUsd.toFixed(2)}</strong>
                            </span>
                          </div>
                        </div>

                        {/* PnL Display */}
                        <div className="text-right shrink-0">
                          <div
                            className={`text-base font-mono font-bold flex items-center justify-end gap-1 ${
                              isPositive ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                            <span>{isPositive ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)}</span>
                            <span className="text-xs font-normal">
                              ({isPositive ? '+' : ''}{pos.unrealizedPnlPct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                            Val: ${pos.currentValueUsd.toFixed(2)}
                          </div>
                        </div>
                      </div>

                      {/* Trailing Stop & Take Profit Status */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-zinc-950/80 p-2.5 rounded-lg border border-zinc-800 text-[11px] font-mono">
                        <div>
                          <span className="text-zinc-500 text-[10px] block">Trailing Stop</span>
                          <span className="text-rose-400 font-bold">
                            ${pos.trailingStopPriceUsd.toFixed(6)}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500 text-[10px] block">Next Take Profit</span>
                          <span className="text-emerald-400 font-bold">
                            ${pos.nextTakeProfitUsd.toFixed(6)}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500 text-[10px] block">Exit Rule</span>
                          <span className="text-zinc-300">Auto Ladder (Stage {pos.takeProfitStage})</span>
                        </div>
                      </div>

                      {/* Granular Per-Trade Exit Action Buttons */}
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/80 flex-wrap">
                        <span className="text-[10px] font-mono text-zinc-500 uppercase">Exit Controls:</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleTradeExit(pos.id, 'FLATTEN_100')}
                            className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-200 text-xs font-mono font-semibold transition border border-rose-700/50 flex items-center gap-1"
                            title="Instant 100% market flatten"
                          >
                            <ShieldAlert className="w-3 h-3" />
                            <span>Exit 100%</span>
                          </button>
                          <button
                            onClick={() => handleTradeExit(pos.id, 'SCALE_OUT_50')}
                            className="px-2 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900 text-emerald-200 text-xs font-mono font-semibold transition border border-emerald-700/50 flex items-center gap-1"
                            title="Take profit 50%, leave runner"
                          >
                            <TrendingUp className="w-3 h-3" />
                            <span>Scale 50%</span>
                          </button>
                          <button
                            onClick={() => handleTradeExit(pos.id, 'BREAKEVEN_SL')}
                            className="px-2 py-1 rounded bg-cyan-950/60 hover:bg-cyan-900 text-cyan-200 text-xs font-mono font-semibold transition border border-cyan-700/50 flex items-center gap-1"
                            title="Set stop loss to entry price"
                          >
                            <Lock className="w-3 h-3" />
                            <span>Breakeven</span>
                          </button>
                          <button
                            onClick={() => setEditingPosId(editingPosId === pos.id ? null : pos.id)}
                            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono font-semibold transition border border-zinc-700 flex items-center gap-1"
                            title="Change stop loss %"
                          >
                            <Sliders className="w-3 h-3" />
                            <span>SL</span>
                          </button>
                        </div>
                      </div>

                      {/* Inline SL Editor for this specific flip */}
                      {editingPosId === pos.id && (
                        <div className="p-2.5 bg-zinc-950 border border-zinc-700 rounded flex items-center gap-2 text-xs font-mono">
                          <span className="text-zinc-400">Stop Loss:</span>
                          <input
                            type="number"
                            max="-1"
                            min="-50"
                            value={customPosSl}
                            onChange={(e) => setCustomPosSl(parseFloat(e.target.value) || -12)}
                            className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-rose-400 font-bold text-center"
                          />
                          <button
                            onClick={() => handleTradeExit(pos.id, 'CUSTOM_SL_TP', customPosSl)}
                            className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold"
                          >
                            Set SL
                          </button>
                          <button
                            onClick={() => setEditingPosId(null)}
                            className="text-zinc-500 hover:text-zinc-300 ml-auto"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Historic Trajectory Curve & Live Flip Stream */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Equity Trajectory Chart (SVG from $41 to $3k+) */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
                  Compounding Trajectory ($41 &rarr; ${botState.currentEquityUsd.toFixed(0)})
                </h3>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">Live Curve</span>
            </div>

            {/* SVG Trajectory Chart */}
            <div className="h-44 w-full bg-zinc-950/80 rounded-lg p-2 border border-zinc-800/80 relative flex items-end">
              {botState.equityCurve.length > 1 && (
                <svg className="w-full h-full overflow-visible" viewBox="0 0 320 140" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="equityGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Build SVG polyline points */}
                  {(() => {
                    const curve = botState.equityCurve;
                    const maxVal = Math.max(...curve.map((p) => p.equityUsd), 3200);
                    const minVal = 0;
                    const range = maxVal - minVal || 1;

                    const pts = curve.map((p, idx) => {
                      const x = (idx / (curve.length - 1)) * 320;
                      const y = 130 - ((p.equityUsd - minVal) / range) * 115;
                      return `${x},${y}`;
                    });

                    const areaPts = `0,130 ${pts.join(' ')} 320,130`;

                    return (
                      <>
                        {/* Shaded Area */}
                        <polygon points={areaPts} fill="url(#equityGrad)" />
                        {/* Line */}
                        <polyline
                          points={pts.join(' ')}
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {/* Marker for current tip */}
                        <circle
                          cx="320"
                          cy={130 - ((botState.currentEquityUsd - minVal) / range) * 115}
                          r="4"
                          fill="#34d399"
                          className="animate-pulse"
                        />
                      </>
                    );
                  })()}
                </svg>
              )}

              {/* Landmark annotations */}
              <div className="absolute top-2 left-3 text-[10px] font-mono text-zinc-500">
                Funded: $41.00
              </div>
              <div className="absolute bottom-3 left-10 text-[9px] font-mono text-rose-400 bg-rose-950/60 px-1 rounded border border-rose-900/60">
                Night 1 Dip: $5.12
              </div>
              <div className="absolute top-2 right-3 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800">
                ${botState.currentEquityUsd.toFixed(2)}
              </div>
            </div>

            <div className="text-[11px] font-mono text-zinc-400 leading-relaxed">
              &bull; <strong>Night 1 Crucible:</strong> Nearly flatlined down to $5.12 before filters tightened and momentum took over.
              <br />
              &bull; <strong>Server Bill:</strong> ${botState.serverBillReservedUsd.toFixed(2)} automatically deducted from top into reserve vault.
            </div>
          </div>

          {/* Live Autonomous Flip Stream */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col flex-1 shadow-lg">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
                  Autonomous Flip Stream
                </h3>
              </div>
              {/* Filter Tabs */}
              <div className="flex items-center gap-1 text-[10px] font-mono">
                {['ALL', 'BUYS', 'EXITS', 'SKIPS'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setFilterAction(tab)}
                    className={`px-2 py-0.5 rounded transition ${
                      filterAction === tab
                        ? 'bg-amber-500 text-zinc-950 font-bold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-zinc-800/70 overflow-y-auto max-h-[460px] p-2">
              {filteredLogs.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-zinc-500">
                  No flip records in this filter.
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isBuy = log.action === 'SNIPE_BUY';
                  const isExit = log.action === 'SCALE_OUT' || log.action === 'TAKE_PROFIT' || log.action === 'STOP_LOSS';
                  const isWin = (log.pnlUsd ?? 0) > 0;

                  return (
                    <div key={log.id} className="p-3 hover:bg-zinc-800/30 transition flex flex-col gap-1.5 rounded">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              isBuy
                                ? 'bg-purple-950/80 border border-purple-700 text-purple-300'
                                : log.action === 'TAKE_PROFIT' || log.action === 'SCALE_OUT'
                                ? 'bg-emerald-950/80 border border-emerald-700 text-emerald-300'
                                : log.action === 'STOP_LOSS'
                                ? 'bg-rose-950/80 border border-rose-700 text-rose-300'
                                : 'bg-zinc-800 border border-zinc-700 text-zinc-400'
                            }`}
                          >
                            {log.action}
                          </span>
                          <span className="font-mono font-bold text-xs text-zinc-100">${log.symbol}</span>
                          <span className="text-[10px] font-mono text-zinc-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        {/* PnL or Ticket Size */}
                        <div className="text-right font-mono text-xs">
                          {isExit && log.pnlUsd !== undefined ? (
                            <span className={`font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isWin ? '+' : ''}${log.pnlUsd.toFixed(2)} ({isWin ? '+' : ''}{log.pnlPct?.toFixed(1)}%)
                            </span>
                          ) : (
                            <span className="text-zinc-400">${log.ticketSizeUsd.toFixed(2)}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-[11px] font-mono text-zinc-400 leading-snug">
                        {log.actionReason}
                      </div>

                      {log.txHash && (
                        <div className="text-[9px] font-mono text-zinc-500 flex items-center justify-between">
                          <span>Tx: {log.txHash}</span>
                          <span>Pool: {log.poolDepthSol.toFixed(1)} SOL</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
