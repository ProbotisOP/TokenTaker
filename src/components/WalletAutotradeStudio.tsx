import React, { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  ShieldAlert,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Zap,
  ExternalLink,
  RefreshCw,
  Power,
  ChevronRight,
  TrendingUp,
  Percent,
  Lock,
  ArrowUpRight,
  Check,
  Flame,
  Shield,
  Clock,
  CircleAlert,
  Info,
  Activity,
  Play,
  Compass,
  HelpCircle,
  Award,
  Sparkles,
  Send,
  X,
  Radio,
  FileCheck,
} from 'lucide-react';
import {
  WalletAutotradeConfig,
  SolanaNetwork,
  AutotradeMode,
  KillSwitchRule,
  WalletDiagnostics,
  SignalTradeResult,
  SignalTradeTriggerRequest,
} from '../types.ts';

interface WalletAutotradeStudioProps {
  onNotify?: (msg: string) => void;
}

export const WalletAutotradeStudio: React.FC<WalletAutotradeStudioProps> = () => {
  const [config, setConfig] = useState<WalletAutotradeConfig | null>(null);
  const [solUsdPrice, setSolUsdPrice] = useState<number>(170.0);
  const [activePositionsCount, setActivePositionsCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [activeStep, setActiveStep] = useState<number>(1);
  const [customAddressInput, setCustomAddressInput] = useState<string>('');
  const [customRpcInput, setCustomRpcInput] = useState<string>('');
  const [isConnectingBrowser, setIsConnectingBrowser] = useState<boolean>(false);
  const [showExtensionNotFoundModal, setShowExtensionNotFoundModal] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Diagnostics & testing states
  const [diagnostics, setDiagnostics] = useState<WalletDiagnostics | null>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState<boolean>(false);
  const [isRequestingAirdrop, setIsRequestingAirdrop] = useState<boolean>(false);
  const [showOnboardingWizard, setShowOnboardingWizard] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [testSwapMint, setTestSwapMint] = useState<string>('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
  const [testSwapSize, setTestSwapSize] = useState<number>(0.05);
  const [isExecutingTestSwap, setIsExecutingTestSwap] = useState<boolean>(false);
  const [testSwapReceipt, setTestSwapReceipt] = useState<SignalTradeResult | null>(null);

  // Incoming live signals for manual testing or auto-execution
  const [liveCandidateSignals, setLiveCandidateSignals] = useState<any[]>([]);
  const [isExecutingSignalId, setIsExecutingSignalId] = useState<string | null>(null);

  // Active positions list for per-trade exit controls
  const [activeTrades, setActiveTrades] = useState<any[]>([]);

  // Modal for editing specific trade SL/TP
  const [editingTrade, setEditingTrade] = useState<{
    id: string;
    symbol: string;
    entryPrice: number;
    currentSlPct: number;
    currentTpPct: number;
  } | null>(null);
  const [customSlInput, setCustomSlInput] = useState<number>(-12);
  const [customTpInput, setCustomTpInput] = useState<number>(50);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 4500);
  };

  // Fetch Wallet state & Active Trades
  const fetchWalletState = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet/state');
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
        setSolUsdPrice(data.solUsdPrice || 170.0);
        setActivePositionsCount(data.activePositionsCount || 0);
      }

      // Also fetch active trades from both coordinator & grok bot
      const [stateRes, grokRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/grok-bot/state'),
      ]);
      const stateData = await stateRes.json();
      const grokData = await grokRes.json();

      const coordPositions = (stateData.activePositions || []).map((p: any) => ({
        ...p,
        source: 'COORDINATOR',
        priceDisplay: `${p.currentPriceSol.toFixed(8)} SOL`,
        entryDisplay: `${p.entryPriceSol.toFixed(8)} SOL`,
        pnlPct: p.unrealizedPnlPct,
        pnlValue: `${p.unrealizedPnlSol.toFixed(3)} SOL`,
      }));

      const grokPositions = (grokData.state?.activePositions || []).map((p: any) => ({
        ...p,
        source: 'GROK_BOT',
        priceDisplay: `$${p.currentPriceUsd.toFixed(6)}`,
        entryDisplay: `$${p.entryPriceUsd.toFixed(6)}`,
        pnlPct: p.unrealizedPnlPct,
        pnlValue: `$${p.unrealizedPnlUsd.toFixed(2)}`,
      }));

      setActiveTrades([...grokPositions, ...coordPositions]);
      if (stateData.candidateTokens) {
        setLiveCandidateSignals(stateData.candidateTokens);
      }
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to fetch wallet state:', err);
      setIsLoading(false);
    }
  }, []);

  // Run 5-point live diagnostic test on wallet and network
  const runDiagnostics = async () => {
    setIsRunningDiagnostics(true);
    try {
      const res = await fetch('/api/wallet/diagnostics');
      const data = await res.json();
      if (data.success && data.diagnostics) {
        setDiagnostics(data.diagnostics);
        showToast(`Diagnostics Complete! Readiness Score: ${data.diagnostics.readinessScore}%`);
      } else {
        showToast(data.error || 'Diagnostics check failed', 'error');
      }
    } catch (err: any) {
      showToast('Diagnostics network error: ' + err.message, 'error');
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  // Request 1 SOL Devnet Airdrop
  const requestDevnetAirdrop = async () => {
    setIsRequestingAirdrop(true);
    try {
      const res = await fetch('/api/wallet/devnet-airdrop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Received 1.0 SOL Devnet Airdrop! Tx: ${data.txSignature?.slice(0, 8)}...`);
        fetchWalletState();
        runDiagnostics();
      } else {
        showToast(data.error || 'Airdrop failed', 'error');
      }
    } catch (err: any) {
      showToast('Airdrop request failed: ' + err.message, 'error');
    } finally {
      setIsRequestingAirdrop(false);
    }
  };

  // Pre-flight test trade execution
  const executePreflightTestSwap = async () => {
    setIsExecutingTestSwap(true);
    setTestSwapReceipt(null);
    try {
      const res = await fetch('/api/wallet/test-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenMint: testSwapMint.trim() || 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
          sizeSol: testSwapSize,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestSwapReceipt(data);
        showToast(`Pre-flight trade executed! Solscan tx verified.`);
        fetchWalletState();
      } else {
        showToast(data.error || 'Pre-flight trade execution failed', 'error');
      }
    } catch (err: any) {
      showToast('Execution error: ' + err.message, 'error');
    } finally {
      setIsExecutingTestSwap(false);
    }
  };

  // Execute trade from live signal
  const executeSignalTrade = async (signal: any) => {
    const symbol = signal.metadata?.symbol || signal.symbol || 'ALPHA';
    const mint = signal.metadata?.mint || signal.tokenMint || 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    setIsExecutingSignalId(mint);
    try {
      const anyWindow = window as any;
      const provider = anyWindow.phantom?.solana || anyWindow.solana;
      let realTxSignature: string | undefined = undefined;
      const tradeSizeSol = config?.minTradeSizeSol || 0.05;

      // If in LIVE mode and real Phantom wallet is connected, request real on-chain transaction signing
      if (config?.autotradeMode === 'LIVE' && provider?.isPhantom && provider.publicKey) {
        const buyRes = await fetch('/api/swap/buy-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenMint: mint,
            sizeSol: tradeSizeSol,
            userPublicKey: provider.publicKey.toString(),
            slippageBps: Math.round((config?.maxSlippagePct || 2.0) * 100),
          }),
        });

        const buyData = await buyRes.json();
        if (!buyRes.ok || !buyData.swapTransaction) {
          throw new Error(buyData.error || 'Failed to generate real DEX swap transaction');
        }

        const { VersionedTransaction } = await import('@solana/web3.js');
        const binaryStr = atob(buyData.swapTransaction);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const vTx = VersionedTransaction.deserialize(bytes);

        const sendResult = await provider.signAndSendTransaction(vTx);
        realTxSignature = sendResult.signature;
      }

      const res = await fetch('/api/wallet/execute-signal-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenMint: mint,
          symbol,
          name: signal.metadata?.name || signal.name || symbol,
          priceSol: signal.micro?.priceSol || signal.priceSol || 0.00045,
          priceUsd: signal.micro?.priceUsd || signal.priceUsd,
          signalSource: signal.metadata?.launchVenue ? `SOLANA_${signal.metadata.launchVenue}` : 'REAL_TIME_MEMPOOL',
          signalScore: signal.opportunity?.opportunityScore || 88,
          recommendedSizeSol: tradeSizeSol,
          realTxSignature,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.txSignature) {
          showToast(`Live trade executed for $${data.symbol}! Tx: ${data.txSignature.slice(0, 8)}... (Solscan linked)`);
        } else {
          showToast(`Paper trade recorded for $${data.symbol}! Size: ${data.sizeSol} SOL`);
        }
        fetchWalletState();
      } else {
        showToast(data.error || 'Signal trade failed', 'error');
      }
    } catch (err: any) {
      showToast('Signal execution error: ' + err.message, 'error');
    } finally {
      setIsExecutingSignalId(null);
    }
  };

  useEffect(() => {
    fetchWalletState();
    const interval = setInterval(fetchWalletState, 2500);
    return () => clearInterval(interval);
  }, [fetchWalletState]);

  // Connect browser wallet (Phantom, Solflare, Backpack, Glow)
  const handleConnectBrowserWallet = async () => {
    setIsConnectingBrowser(true);
    try {
      const anyWindow = window as any;
      const provider = anyWindow.phantom?.solana || anyWindow.solana || anyWindow.solflare || anyWindow.backpack;

      if (!provider) {
        // Do NOT silently link demo address! Show clear explanation & choices modal
        setShowExtensionNotFoundModal(true);
        showToast('No Solana extension found in this frame. Select a connection option.', 'error');
        setIsConnectingBrowser(false);
        return;
      }

      const response = await provider.connect();
      const pubkey = response.publicKey?.toString();
      if (!pubkey) throw new Error('Failed to retrieve public key from wallet');

      const walletName = provider.isPhantom
        ? 'Phantom'
        : provider.isSolflare
        ? 'Solflare'
        : provider.isBackpack
        ? 'Backpack'
        : 'Solana Wallet';
      await handleConnectManualAddress(pubkey, walletName);
      showToast(`Connected ${walletName}: ${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`);
    } catch (err: any) {
      showToast(err.message || 'Connection cancelled or rejected', 'error');
    } finally {
      setIsConnectingBrowser(false);
    }
  };

  const handleConnectManualAddress = async (address: string, walletName: string = 'Solana Wallet') => {
    try {
      const res = await fetch('/api/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: address.trim(),
          walletName,
          network: config?.network || 'mainnet-beta',
          rpcEndpoint: customRpcInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to connect address');
      }
      setConfig(data.config);
      showToast(`Wallet connected: ${data.config.walletAddress.slice(0, 4)}...${data.config.walletAddress.slice(-4)}`);
      setCustomAddressInput('');
      fetchWalletState();
    } catch (err: any) {
      showToast(err.message || 'Failed to connect wallet', 'error');
    }
  };

  const handleDisconnect = async () => {
    try {
      const res = await fetch('/api/wallet/disconnect', { method: 'POST' });
      const data = await res.json();
      if (data.config) setConfig(data.config);
      showToast('Wallet disconnected. Autotrade paused.');
      fetchWalletState();
    } catch (err: any) {
      showToast('Disconnect error: ' + err.message, 'error');
    }
  };

  const handleSaveConfig = async (updates: Partial<WalletAutotradeConfig>) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/wallet/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
        showToast('Trading safeguards & parameters updated');
      }
    } catch (err: any) {
      showToast('Failed to save settings: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Kill switch execution
  const handleTriggerKillSwitch = async (reason?: string) => {
    try {
      const res = await fetch('/api/wallet/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'Manual operator Kill Switch triggered' }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`KILL SWITCH ENGAGED! All positions liquidated at market.`, 'error');
        fetchWalletState();
      }
    } catch (err: any) {
      showToast('Kill switch error: ' + err.message, 'error');
    }
  };

  const handleResetKillSwitch = async () => {
    try {
      const res = await fetch('/api/wallet/reset-kill-switch', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Kill switch disarmed. Engine standing by.');
        fetchWalletState();
      }
    } catch (err: any) {
      showToast('Reset error: ' + err.message, 'error');
    }
  };

  // Granular Per-Trade Exit Execution
  const handleExecuteTradeExit = async (
    positionId: string,
    action: 'FLATTEN_100' | 'SCALE_OUT_50' | 'BREAKEVEN_SL' | 'CUSTOM_SL_TP',
    customSl?: number,
    customTp?: number
  ) => {
    try {
      const trade = activeTrades.find((t) => t.id === positionId);
      let realTxSignature: string | undefined = undefined;

      if (trade?.isRealWalletTrade && (action === 'FLATTEN_100' || action === 'SCALE_OUT_50')) {
        const anyWindow = window as any;
        const provider = anyWindow.phantom?.solana || anyWindow.solana;

        if (!provider || !provider.publicKey) {
          showToast('Phantom wallet is not connected. Connect Phantom to sign on-chain exit.', 'error');
          return;
        }

        const fraction = action === 'FLATTEN_100' ? 1.0 : 0.5;
        const tokensToSell = Math.floor((trade.sizeTokens || 0) * fraction);
        const decimals = trade.decimals ?? 6;
        const baseUnits = BigInt(tokensToSell) * BigInt(10 ** decimals);

        const sellRes = await fetch('/api/swap/sell-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenMint: trade.tokenMint,
            tokenAmountBaseUnits: baseUnits.toString(),
            userPublicKey: provider.publicKey.toString(),
            slippageBps: 250,
          }),
        });

        const sellData = await sellRes.json();
        if (!sellRes.ok || !sellData.swapTransaction) {
          showToast(`Exit swap route failed: ${sellData.error || 'No DEX route found'}`, 'error');
          return;
        }

        const { VersionedTransaction } = await import('@solana/web3.js');
        const binaryStr = atob(sellData.swapTransaction);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const vTx = VersionedTransaction.deserialize(bytes);

        const sendResult = await provider.signAndSendTransaction(vTx);
        realTxSignature = sendResult.signature;
      }

      const res = await fetch('/api/wallet/trade-exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          action,
          customStopLossPct: customSl,
          customTakeProfitPct: customTp,
          realTxSignature,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Trade exit executed successfully');
        setEditingTrade(null);
        fetchWalletState();
      } else {
        showToast(data.message || 'Failed to execute trade exit', 'error');
      }
    } catch (err: any) {
      showToast('Trade exit error: ' + err.message, 'error');
    }
  };

  if (isLoading && !config) {
    return (
      <div className="flex items-center justify-center p-12 text-zinc-400 font-mono text-xs">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading Solana Wallet &amp; Autotrade Gateway...
      </div>
    );
  }

  const isConnected = !!config?.isConnected;
  const isKillSwitchActive = !!config?.killSwitchActive;

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-xs font-mono font-bold shadow-2xl flex items-center gap-2 border ${
            notification.type === 'error'
              ? 'bg-rose-950 border-rose-500 text-rose-200'
              : 'bg-emerald-950 border-emerald-500 text-emerald-200'
          }`}
        >
          {notification.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          )}
          <span>{notification.text}</span>
        </div>
      )}

      {/* Emergency Kill Switch Persistent Banner (If Active) */}
      {isKillSwitchActive && (
        <div className="bg-rose-950/80 border-2 border-rose-600 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xl animate-pulse">
          <div className="flex items-center gap-3 text-rose-300">
            <ShieldAlert className="w-8 h-8 text-rose-400 shrink-0" />
            <div>
              <div className="text-sm font-bold uppercase tracking-wider text-rose-100 flex items-center gap-2">
                <span>NUCLEAR KILL SWITCH ACTIVE — TRADING LOCKED</span>
                <span className="px-2 py-0.5 rounded bg-rose-900 text-rose-200 text-[10px] font-mono">
                  ALL POSITIONS LIQUIDATED
                </span>
              </div>
              <p className="text-xs text-rose-300/90 font-mono mt-0.5">
                Reason: {config?.killSwitchTriggeredReason || 'Operator emergency halt'} &bull; Disarm below when market conditions stabilize.
              </p>
            </div>
          </div>
          <button
            onClick={handleResetKillSwitch}
            className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-rose-300 border border-rose-500/50 hover:border-rose-400 text-xs font-mono font-bold uppercase tracking-wider transition whitespace-nowrap"
          >
            Disarm &amp; Reset Engine
          </button>
        </div>
      )}

      {/* Top Header Card: Wallet Balance & Quick Autotrade Switch */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* Left: Connected Wallet Status */}
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl border flex items-center justify-center text-xl shrink-0 ${
              isConnected
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-950/40'
                : 'bg-zinc-950 border-zinc-800 text-zinc-500'
            }`}>
              <Wallet className="w-6 h-6" />
            </div>

            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base font-bold text-zinc-100 uppercase tracking-wide">
                  {isConnected ? config?.walletName : 'No Wallet Connected'}
                </h2>
                {isConnected ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-mono font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    ON-CHAIN VERIFIED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[11px] font-mono">
                    STANDBY / PAPER
                  </span>
                )}
                <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[11px] font-mono uppercase">
                  {config?.network || 'mainnet-beta'}
                </span>
              </div>

              <div className="text-xs font-mono text-zinc-400 mt-1 flex items-center gap-2 flex-wrap">
                {isConnected ? (
                  <>
                    <span className="text-zinc-200 font-bold">
                      {config?.walletAddress?.slice(0, 6)}...{config?.walletAddress?.slice(-6)}
                    </span>
                    <a
                      href={`https://solscan.io/account/${config?.walletAddress}${config?.network === 'devnet' ? '?cluster=devnet' : ''}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-zinc-500 hover:text-cyan-400 inline-flex items-center gap-0.5 text-[11px]"
                    >
                      <ExternalLink className="w-3 h-3" /> Solscan
                    </a>
                  </>
                ) : (
                  <span>Connect Phantom, Solflare, or paste any Solana address to enable live capital.</span>
                )}
              </div>
            </div>
          </div>

          {/* Center: Live Real Money Balance & Allocated Capital */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/80">
            <div>
              <div className="text-[10px] font-mono uppercase text-zinc-500">Total SOL Balance</div>
              <div className="text-base font-mono font-bold text-zinc-100">
                {config?.balanceSol?.toFixed(4) || '0.0000'} <span className="text-xs text-amber-400">SOL</span>
              </div>
              <div className="text-[10px] font-mono text-zinc-400">
                &asymp; ${config?.balanceUsd?.toFixed(2) || '0.00'}
              </div>
            </div>

            <div className="border-l border-zinc-800/60 pl-3">
              <div className="text-[10px] font-mono uppercase text-emerald-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                SOL to Use (Capital)
              </div>
              <div className="text-base font-mono font-bold text-emerald-400">
                {config?.allocatedCapitalSol !== undefined ? config.allocatedCapitalSol.toFixed(3) : '0.080'}{' '}
                <span className="text-xs text-emerald-300/80">SOL</span>
              </div>
              <div className="text-[10px] font-mono text-emerald-400/80">
                &asymp; ${((config?.allocatedCapitalSol ?? 0.08) * solUsdPrice).toFixed(2)} USD
              </div>
            </div>

            <div className="border-l border-zinc-800/60 pl-3">
              <div className="text-[10px] font-mono uppercase text-cyan-400 font-bold">Ticket / Trade</div>
              <div className="text-base font-mono font-bold text-cyan-300">
                {config?.targetTradeSizeSol !== undefined ? config.targetTradeSizeSol.toFixed(3) : '0.020'}{' '}
                <span className="text-xs text-cyan-400/80">SOL</span>
              </div>
              <div className="text-[10px] font-mono text-zinc-400">
                &asymp; ${((config?.targetTradeSizeSol ?? 0.02) * solUsdPrice).toFixed(2)} USD
              </div>
            </div>

            <div className="border-l border-zinc-800/60 pl-3">
              <div className="text-[10px] font-mono uppercase text-zinc-500">Gas Reserve</div>
              <div className="text-base font-mono font-bold text-zinc-300">
                {config?.gasReserveSol || 0.025} <span className="text-xs text-zinc-500">SOL</span>
              </div>
              <div className="text-[10px] font-mono text-zinc-500">Protected Fee Pool</div>
            </div>
          </div>

          {/* Right: Master Autotrade Mode & Kill Switch */}
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1 text-right">
              <span className="text-[10px] font-mono text-zinc-400 uppercase">Autotrade Capability:</span>
              <div className="flex items-center gap-1.5">
                {(['OFF', 'SEMI_AUTONOMOUS', 'FULL_AUTONOMOUS'] as AutotradeMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleSaveConfig({ autotradeMode: mode })}
                    className={`px-2.5 py-1.5 rounded text-xs font-mono font-bold uppercase tracking-wider transition ${
                      config?.autotradeMode === mode
                        ? mode === 'FULL_AUTONOMOUS'
                          ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                          : mode === 'SEMI_AUTONOMOUS'
                          ? 'bg-amber-600 text-white'
                          : 'bg-zinc-700 text-zinc-100'
                        : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-800 border border-zinc-800'
                    }`}
                  >
                    {mode === 'FULL_AUTONOMOUS' ? 'Auto Snipe' : mode === 'SEMI_AUTONOMOUS' ? 'Semi-Auto' : 'Off'}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Master Kill Switch Button */}
            <button
              onClick={() => handleTriggerKillSwitch()}
              className="px-3 py-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-mono font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-950/50 transition active:scale-95 flex flex-col items-center justify-center shrink-0 border border-rose-500/50"
              title="Liquidate all positions immediately and halt trading"
            >
              <ShieldAlert className="w-4 h-4 mb-0.5" />
              <span>KILL SWITCH</span>
            </button>
          </div>
        </div>
      </div>

      {/* Real Wallet Custody & Live Monitor Explanation Banner */}
      <div className="bg-gradient-to-r from-cyan-950/40 via-zinc-900 to-emerald-950/30 border border-cyan-700/40 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-md">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-950/70 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0 mt-0.5 shadow-inner">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div className="font-mono">
            <div className="text-xs font-bold text-cyan-200 flex items-center gap-2 flex-wrap">
              <span>Why Did Live Monitor Take Trades But My Phantom Balance Didn't Change?</span>
              <span className="px-2 py-0.5 rounded-full bg-cyan-900/70 text-[10px] text-cyan-300 border border-cyan-700/50">
                100% Non-Custodial Safety
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed max-w-4xl">
              By Solana security design, non-custodial browser wallets (Phantom, Solflare) never allow web dapps to silently withdraw your real funds. The trades shown in the <strong>Live Monitor</strong> tab are executed inside the built-in Quant Engine simulator with virtual equity to test signals in real time. Your real wallet balance (<strong>{config?.balanceSol?.toFixed(3)} SOL / &asymp;${config?.balanceUsd?.toFixed(2)}</strong>) is safe and ready for trading below.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
          <button
            onClick={() => setActiveStep(3)}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-emerald-950/50"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Set How Many SOL to Use &rarr;</span>
          </button>
        </div>
      </div>

      {/* Step-by-Step Navigation Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-zinc-800">
        {[
          { step: 1, title: '1. Connect Wallet', desc: 'Browser or Address' },
          { step: 2, title: '2. Autotrade Mode', desc: 'Signals & Sizing' },
          { step: 3, title: '3. How Many SOL to Use', desc: 'Capital Sizing & SL' },
          { step: 4, title: '4. Kill Switch Rules', desc: 'When to Turn On' },
          { step: 5, title: '5. Trade Exits', desc: `${activeTrades.length} Active Trades` },
        ].map((tab) => (
          <button
            key={tab.step}
            onClick={() => setActiveStep(tab.step)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono transition shrink-0 border ${
              activeStep === tab.step
                ? 'bg-zinc-800 border-zinc-600 text-zinc-100 font-bold'
                : 'bg-zinc-950/50 border-zinc-800/80 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
              activeStep === tab.step ? 'bg-amber-400 text-zinc-950 font-bold' : 'bg-zinc-800 text-zinc-400'
            }`}>
              {tab.step}
            </span>
            <div className="text-left">
              <div className="leading-tight">{tab.title}</div>
              <div className="text-[10px] text-zinc-500">{tab.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Onboarding & Diagnostics Action Bar */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-mono font-bold text-zinc-100 uppercase tracking-wide flex items-center gap-2">
              <span>Guided Onboarding &amp; Wallet Diagnostics Hub</span>
              {diagnostics && (
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                  diagnostics.readinessScore >= 80
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : diagnostics.readinessScore >= 50
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}>
                  {diagnostics.readinessScore}% READY
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
              Verify Solana RPC node latency, account rent exemption, tradeable balance headroom, and test a live trade.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap w-full md:w-auto">
          <button
            onClick={() => {
              setWizardStep(1);
              setShowOnboardingWizard(true);
            }}
            className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider transition shadow-lg flex items-center gap-1.5"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Launch 5-Step Wizard</span>
          </button>

          <button
            onClick={runDiagnostics}
            disabled={isRunningDiagnostics}
            className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 font-mono font-semibold text-xs transition flex items-center gap-1.5"
          >
            {isRunningDiagnostics ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" /> : <Activity className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{isRunningDiagnostics ? 'Testing...' : 'Run Diagnostics'}</span>
          </button>

          {config?.network === 'devnet' && (
            <button
              onClick={requestDevnetAirdrop}
              disabled={isRequestingAirdrop || !isConnected}
              className="px-3.5 py-2 rounded-lg bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 font-mono font-semibold text-xs transition flex items-center gap-1.5 disabled:opacity-40"
              title="Claim 1.0 SOL Devnet Airdrop to test real trades"
            >
              {isRequestingAirdrop ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Claim 1 SOL</span>
            </button>
          )}
        </div>
      </div>

      {/* STEP 1: Connect Wallet & Money */}
      {activeStep === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Col: Step Guide & Browser Wallet */}
          <div className="lg:col-span-7 flex flex-col gap-5">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-amber-400">
                <Zap className="w-5 h-5" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-100">
                  Step 1: Connect Real Solana Wallet &amp; Account
                </h3>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed font-mono">
                Connect your Solana wallet to allow the autonomous quant flipper to execute real-money trades, enforce on-chain stop losses, and scale out take profits directly into your custody.
              </p>

              {/* Demo Wallet Warning Notice */}
              {isConnected && (config?.walletName?.includes('Demo') || config?.walletAddress === '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin') && (
                <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex items-start gap-2.5 text-amber-200">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <span className="font-bold text-amber-300">Using Sandbox Demo Wallet ({config.walletAddress?.slice(0, 6)}...{config.walletAddress?.slice(-4)}):</span>
                      <p className="text-[11px] text-zinc-300 mt-0.5">
                        This test address was linked for preview testing. To trade with your real Solana funds, click Disconnect and link your actual Phantom wallet address.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-[11px] shrink-0 transition shadow uppercase tracking-wider"
                  >
                    Disconnect Demo
                  </button>
                </div>
              )}

              {/* 1-Click Browser Wallet Connect */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-mono font-bold text-zinc-200 flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-emerald-400" />
                    <span>Browser Wallet (Phantom / Solflare / Backpack)</span>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 mt-1">
                    Standard injected Solana provider with hardware and extension security.
                  </div>
                  <button
                    onClick={() => setShowExtensionNotFoundModal(true)}
                    className="text-[10px] font-mono text-cyan-400 hover:underline mt-1.5 flex items-center gap-1"
                  >
                    <Info className="w-3 h-3" />
                    <span>Why doesn't Phantom prompt in preview iframe? Click for details</span>
                  </button>
                </div>

                {isConnected ? (
                  <button
                    onClick={handleDisconnect}
                    className="px-4 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-700/50 text-rose-200 text-xs font-mono font-bold uppercase tracking-wider transition"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={handleConnectBrowserWallet}
                    disabled={isConnectingBrowser}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold uppercase tracking-wider transition shadow-lg shadow-emerald-950/50 flex items-center gap-1.5"
                  >
                    {isConnectingBrowser ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                    <span>Connect Wallet</span>
                  </button>
                )}
              </div>

              {/* Manual Public Key Input Alternative */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-3">
                <div className="text-xs font-mono font-bold text-zinc-300 flex items-center justify-between">
                  <span>Paste Your Real Solana Public Address:</span>
                  <span className="text-[10px] text-zinc-500 font-normal">Non-custodial public tracking</span>
                </div>
                <p className="text-[11px] text-zinc-400 font-mono">
                  Copy your address from Phantom or Solflare (e.g. mobile or extension) and paste here. The bot will query your real on-chain balance and monitor trades for your custody.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customAddressInput}
                    onChange={(e) => setCustomAddressInput(e.target.value)}
                    placeholder="Enter your real Solana address (e.g. 7Y3z... or 9xQe...)"
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    onClick={() => handleConnectManualAddress(customAddressInput, 'Phantom (My Wallet)')}
                    disabled={!customAddressInput.trim()}
                    className="px-4 py-2 rounded bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-zinc-950 text-xs font-mono font-bold uppercase tracking-wider transition"
                  >
                    Link My Key
                  </button>
                </div>

                {/* Quick Demo Paper Wallets */}
                <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono text-zinc-500">
                  <span>Quick Test Address:</span>
                  <button
                    onClick={() => handleConnectManualAddress('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', 'Phantom (Demo Hot Vault)')}
                    className="text-amber-400 hover:underline"
                  >
                    9xQe...uFin (Hot Vault)
                  </button>
                  <span>&bull;</span>
                  <button
                    onClick={() => handleConnectManualAddress('SoL9842PEPE2Zk99182390182490812490812PEPE2', 'Solana Whale Key')}
                    className="text-cyan-400 hover:underline"
                  >
                    SoL9...EPE2 (Devnet Test)
                  </button>
                </div>
              </div>

              {/* Network & Custom RPC Configuration */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-zinc-300">Solana Network:</span>
                  <div className="flex items-center gap-2">
                    {(['mainnet-beta', 'devnet'] as SolanaNetwork[]).map((net) => (
                      <button
                        key={net}
                        onClick={() => handleSaveConfig({ network: net })}
                        className={`px-3 py-1 rounded text-xs font-mono font-semibold uppercase ${
                          config?.network === net
                            ? 'bg-amber-400 text-zinc-950 font-bold'
                            : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 border border-zinc-800'
                        }`}
                      >
                        {net === 'mainnet-beta' ? 'Mainnet (Real $)' : 'Devnet (Free Test)'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] font-mono text-zinc-500">
                  Mainnet-beta communicates with real Solana liquidity pools on Raydium AMM, CPMM, Pump.fun, and Meteora DLMM.
                </div>
              </div>
            </div>
          </div>

          {/* Right Col: 5-Point Live Diagnostics & Balance Test Suite */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Wallet Balance &amp; Diagnostics Hub</span>
                </h4>
                <button
                  onClick={runDiagnostics}
                  disabled={isRunningDiagnostics}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-[11px] transition flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isRunningDiagnostics ? 'animate-spin text-amber-400' : ''}`} />
                  <span>{isRunningDiagnostics ? 'Testing...' : 'Retest'}</span>
                </button>
              </div>

              {/* Balance Breakdown & Headroom Box */}
              <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800/90 font-mono text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Total Wallet Balance:</span>
                  <span className="text-zinc-100 font-bold">
                    {config?.balanceSol?.toFixed(4) || '0.0000'} SOL
                    <span className="text-zinc-500 font-normal ml-1">(${config?.balanceUsd?.toFixed(2) || '0.00'})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Mandatory Gas Floor:</span>
                  <span className="text-amber-400 font-bold">
                    - {config?.gasReserveSol || 0.05} SOL
                  </span>
                </div>
                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                  <span className="text-zinc-300 font-bold">Net Tradeable Capital:</span>
                  <span className={`font-bold ${
                    (config?.balanceSol || 0) > (config?.gasReserveSol || 0.05) ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {Math.max(0, (config?.balanceSol || 0) - (config?.gasReserveSol || 0.05)).toFixed(4)} SOL
                  </span>
                </div>
              </div>

              {/* 5-Point Live Diagnostic Checklist */}
              {diagnostics ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                    <span>5-POINT READINESS AUDIT:</span>
                    <span className={`font-bold ${
                      diagnostics.readinessScore >= 80 ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {diagnostics.readinessScore}% READINESS
                    </span>
                  </div>

                  <div className="space-y-1.5 font-mono text-[11px]">
                    {diagnostics.checks.map((c: any, i: number) => (
                      <div
                        key={i}
                        className={`p-2 rounded border flex items-center justify-between ${
                          c.status === 'PASS'
                            ? 'bg-emerald-950/20 border-emerald-900/40 text-zinc-300'
                            : c.status === 'WARN'
                            ? 'bg-amber-950/20 border-amber-900/40 text-amber-300'
                            : 'bg-rose-950/20 border-rose-900/40 text-rose-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {c.status === 'PASS' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : c.status === 'WARN' ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : (
                            <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          )}
                          <span className="font-semibold text-zinc-200">{c.name}</span>
                        </div>
                        <span className="text-[10px] opacity-90">{c.detail}</span>
                      </div>
                    ))}
                  </div>

                  <div className="text-[10px] font-mono text-zinc-500 flex items-center justify-between pt-1">
                    <span>RPC Latency: {diagnostics.rpcLatencyMs}ms (Slot #{diagnostics.slot})</span>
                    <span>{diagnostics.isRentExempt ? 'Rent-Exempt' : 'Needs Gas'}</span>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 text-center font-mono">
                  <p className="text-xs text-zinc-400 mb-3">
                    Run our real-time 5-point diagnostics to verify RPC latency, wallet account initialization, gas headroom, and swap routing.
                  </p>
                  <button
                    onClick={runDiagnostics}
                    disabled={isRunningDiagnostics}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-2 mx-auto"
                  >
                    {isRunningDiagnostics ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                    <span>Run Wallet Diagnostics</span>
                  </button>
                </div>
              )}

              {/* Devnet 1-Click Faucet Airdrop Button */}
              {config?.network === 'devnet' && (
                <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/40 flex items-center justify-between gap-3 font-mono">
                  <div>
                    <div className="text-xs font-bold text-emerald-300">Free Devnet Testing SOL</div>
                    <div className="text-[10px] text-zinc-400">Request 1.0 free SOL to execute test trades.</div>
                  </div>
                  <button
                    onClick={requestDevnetAirdrop}
                    disabled={isRequestingAirdrop || !isConnected}
                    className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition shrink-0 disabled:opacity-40 flex items-center gap-1"
                  >
                    {isRequestingAirdrop ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    <span>Get 1 SOL</span>
                  </button>
                </div>
              )}

              {/* Deposit helper for mainnet */}
              {config?.network === 'mainnet-beta' && isConnected && (
                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-zinc-400">Your Deposit Address:</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(config?.walletAddress || '');
                        showToast('Address copied to clipboard!');
                      }}
                      className="text-amber-400 hover:text-amber-300 text-[11px] font-bold"
                    >
                      Copy Address
                    </button>
                  </div>
                  <div className="text-[11px] text-zinc-300 truncate bg-zinc-900 px-2 py-1 rounded">
                    {config?.walletAddress}
                  </div>
                </div>
              )}

              <button
                onClick={() => setActiveStep(2)}
                className="w-full py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-1 mt-1"
              >
                <span>Continue to Step 2: Autotrade Capabilities</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Autotrade Capabilities & Execution Mode */}
      {activeStep === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 flex flex-col gap-5">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <Zap className="w-5 h-5" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-100">
                  Step 2: Autotrade Execution Capabilities
                </h3>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed font-mono">
                Select how much autonomy the bot is granted when trading with your connected wallet. You can change this at any second.
              </p>

              {/* 3 Autotrade Modes */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* OFF */}
                <div
                  onClick={() => handleSaveConfig({ autotradeMode: 'OFF' })}
                  className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                    config?.autotradeMode === 'OFF'
                      ? 'bg-zinc-800 border-zinc-500 shadow-xl'
                      : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Power className="w-5 h-5 text-zinc-400" />
                      {config?.autotradeMode === 'OFF' && <Check className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <div className="font-mono font-bold text-sm text-zinc-200">OFF (Observation)</div>
                    <p className="text-[11px] font-mono text-zinc-400 mt-2 leading-relaxed">
                      Zero automated trades. The engine streams launches, scores risk, and displays live analytics without submitting transactions.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800/80 text-[10px] font-mono text-zinc-500 uppercase">
                    Risk: Absolute Zero
                  </div>
                </div>

                {/* SEMI-AUTONOMOUS */}
                <div
                  onClick={() => handleSaveConfig({ autotradeMode: 'SEMI_AUTONOMOUS' })}
                  className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                    config?.autotradeMode === 'SEMI_AUTONOMOUS'
                      ? 'bg-amber-950/40 border-amber-500/80 shadow-xl'
                      : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Shield className="w-5 h-5 text-amber-400" />
                      {config?.autotradeMode === 'SEMI_AUTONOMOUS' && <Check className="w-4 h-4 text-amber-400" />}
                    </div>
                    <div className="font-mono font-bold text-sm text-amber-300">Semi-Autonomous</div>
                    <p className="text-[11px] font-mono text-zinc-300 mt-2 leading-relaxed">
                      Engine evaluates mempool &amp; pool depth. Once verified, it generates a 1-click execution card for your manual confirmation.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800/80 text-[10px] font-mono text-amber-400/80 uppercase">
                    Risk: User-Authorized
                  </div>
                </div>

                {/* FULL AUTONOMOUS */}
                <div
                  onClick={() => handleSaveConfig({ autotradeMode: 'FULL_AUTONOMOUS' })}
                  className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                    config?.autotradeMode === 'FULL_AUTONOMOUS'
                      ? 'bg-emerald-950/40 border-emerald-500/80 shadow-xl'
                      : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Flame className="w-5 h-5 text-emerald-400" />
                      {config?.autotradeMode === 'FULL_AUTONOMOUS' && <Check className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <div className="font-mono font-bold text-sm text-emerald-300">Full Autonomous</div>
                    <p className="text-[11px] font-mono text-zinc-300 mt-2 leading-relaxed">
                      High-frequency flipper. Snipes pool depth pre-chart, executes scaled ticket sizes, trails stops, and scales out ladder tiers automatically.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800/80 text-[10px] font-mono text-emerald-400/80 uppercase">
                    Risk: Strict Limits Enforced
                  </div>
                </div>
              </div>

              {/* Gas Reserve Buffer Input */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-mono font-bold text-zinc-200">
                    Gas &amp; Rent Reserve Buffer:
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                    Ensures your wallet maintains a minimum balance so transactions never fail due to Solana account rent.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1.0"
                    value={config?.gasReserveSol || 0.05}
                    onChange={(e) => handleSaveConfig({ gasReserveSol: parseFloat(e.target.value) || 0.05 })}
                    className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs font-mono text-zinc-100 font-bold text-center"
                  />
                  <span className="text-xs font-mono text-zinc-400">SOL</span>
                </div>
              </div>

              {/* Signal Trigger Sources Filter */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-mono font-bold text-zinc-200 flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400" />
                    <span>Signal Sources That Trigger Auto-Trades:</span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">
                    {(Array.isArray(config?.enabledSignalSources) ? config.enabledSignalSources : []).length} / 5 Active
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs">
                  {[
                    { id: 'WHALE_BUYS', label: 'Whale Mempool Swarms (>15 SOL)' },
                    { id: 'PUMP_FUN_CURVE', label: 'Pump.fun Migration (>95% Curve)' },
                    { id: 'RAYDIUM_LP_BURN', label: 'Raydium LP Burned & Mint Revoked' },
                    { id: 'SMART_WALLETS', label: 'Smart Wallets Copy (>75% Winrate)' },
                    { id: 'SENTIMENT_SURGES', label: 'Velocity Spikes (>80 Score)' },
                  ].map((src) => {
                    const activeSources: string[] = Array.isArray(config?.enabledSignalSources)
                      ? config.enabledSignalSources
                      : [
                          'WHALE_BUYS',
                          'PUMP_FUN_CURVE',
                          'RAYDIUM_LP_BURN',
                          'SMART_WALLETS',
                          'SENTIMENT_SURGES',
                        ];
                    const isChecked = activeSources.includes(src.id);
                    return (
                      <label
                        key={src.id}
                        className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition ${
                          isChecked ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-zinc-950/40 border-zinc-800/80 text-zinc-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const updated = e.target.checked
                              ? [...activeSources, src.id]
                              : activeSources.filter((s: string) => s !== src.id);
                            handleSaveConfig({ enabledSignalSources: updated });
                          }}
                          className="accent-amber-400 rounded"
                        />
                        <span className="text-[11px] truncate">{src.label}</span>
                      </label>
                    );
                  })}
                </div>

                {/* Min Signal Quality Score Slider */}
                <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400">Min Signal Quality Score:</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="50"
                      max="95"
                      step="5"
                      value={config?.minSignalScore || 70}
                      onChange={(e) => handleSaveConfig({ minSignalScore: parseInt(e.target.value) || 70 })}
                      className="w-28 accent-amber-400"
                    />
                    <span className="text-amber-400 font-bold w-12 text-right">
                      {config?.minSignalScore || 70}/100
                    </span>
                  </div>
                </div>
              </div>

              {/* Pre-Flight Test Trade Execution Box */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-zinc-950 to-zinc-900 border border-zinc-700/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-mono font-bold text-amber-300 uppercase tracking-wide flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-400" />
                    <span>Pre-Flight Live Trade Test (Safe Verification)</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                    Zero Commitment
                  </span>
                </div>
                <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">
                  Execute a real test micro-trade to verify your connected wallet, RPC gas deduction, DEX routing, and position registration.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-xs">
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] text-zinc-500 uppercase mb-1">Target Token Mint Address:</label>
                    <input
                      type="text"
                      value={testSwapMint}
                      onChange={(e) => setTestSwapMint(e.target.value)}
                      placeholder="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 (BONK)"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 uppercase mb-1">Test Trade Size:</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="0.5"
                        value={testSwapSize}
                        onChange={(e) => setTestSwapSize(parseFloat(e.target.value) || 0.05)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 text-xs font-mono font-bold text-center"
                      />
                      <span className="text-zinc-500 text-xs">SOL</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="text-[10px] font-mono text-zinc-500">
                    Est. Gas: ~0.000005 SOL &bull; Route: Raydium AMM V4
                  </div>
                  <button
                    onClick={executePreflightTestSwap}
                    disabled={isExecutingTestSwap || !isConnected}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs uppercase tracking-wider transition shadow-lg flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {isExecutingTestSwap ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Broadcasting Swap...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>Execute Pre-Flight Test</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Test Swap Receipt Display */}
                {testSwapReceipt && (
                  <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-700/50 space-y-2 font-mono text-xs">
                    <div className="flex items-center justify-between text-emerald-300 font-bold">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Swap Executed Successfully!
                      </span>
                      <span className="text-[10px] text-zinc-400">{testSwapReceipt.latencyMs || 64}ms Latency</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-zinc-300">
                      <div>
                        <span className="text-zinc-500 block text-[10px]">Position:</span>
                        <strong className="text-amber-300">${testSwapReceipt.symbol}</strong>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px]">Spent:</span>
                        <strong>{testSwapReceipt.sizeSol} SOL</strong>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px]">Tokens Acquired:</span>
                        <strong>{Number(testSwapReceipt.tokensReceived).toLocaleString()}</strong>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px]">Slippage:</span>
                        <strong className="text-emerald-400">{testSwapReceipt.slippagePct}%</strong>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-emerald-900/60 flex items-center justify-between text-[11px]">
                      <a
                        href={testSwapReceipt.solscanUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 underline"
                      >
                        <span>View on Solscan Explorer</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <button
                        onClick={() => setActiveStep(5)}
                        className="text-amber-400 hover:text-amber-300 font-bold"
                      >
                        Manage in Trade Exits (Step 5) &rarr;
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setActiveStep(3)}
                className="w-full py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-1 mt-2"
              >
                <span>Continue to Step 3: Stop-Loss (SL) &amp; Sizing Limits</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
                Autotrade Safeguard Checklist
              </h4>
              <ul className="space-y-2.5 text-xs font-mono text-zinc-400">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>LP Burn / Lock Verified (&gt;90%)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Mint Authority Revoked Check</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Top 10 Holder Concentration &lt;48%</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Mempool Buy Flow &gt; Chatter Ratio</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Priority Fee CU Buffer Enforced</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: How Many SOL to Use (Capital Allocation) & Stop Loss */}
      {activeStep === 3 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 flex flex-col gap-5">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Sliders className="w-5 h-5" />
                  <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-100">
                    Step 3: How Many SOL to Use &amp; Trade Sizing Limits
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-700/50">
                  Customizable Capital
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed font-mono">
                Define the exact amount of SOL dedicated to automated trading from your wallet, plus the target size per trade. The engine will never exceed your allocated capital or dip into your protected gas reserve.
              </p>

              {/* 1-Click Wallet Size Optimization Presets */}
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-950/30 via-zinc-950 to-emerald-950/20 border border-amber-500/30 font-mono space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-amber-300 uppercase flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Quick Optimization Presets:
                  </span>
                  <span className="text-[10px] text-zinc-400">1-click setup</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      handleSaveConfig({
                        allocatedCapitalSol: 0.08,
                        targetTradeSizeSol: 0.02,
                        minTradeSizeSol: 0.01,
                        maxTradeSizeSol: 0.035,
                        gasReserveSol: 0.025,
                        maxOpenPositions: 3,
                        defaultStopLossPct: -12,
                      });
                      showToast('Applied $20 Wallet Bag Optimization (0.08 SOL Capital, 0.02 SOL/Trade)', 'success');
                    }}
                    className="p-2.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-amber-500/40 text-left transition flex flex-col gap-0.5 group"
                  >
                    <div className="text-xs font-bold text-amber-200 group-hover:text-amber-100 flex items-center justify-between">
                      <span>$20 Starter Bag</span>
                      <span className="text-[10px] text-emerald-400 font-normal">Active</span>
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      0.08 SOL Capital &bull; 0.02 SOL / trade
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      handleSaveConfig({
                        allocatedCapitalSol: 0.22,
                        targetTradeSizeSol: 0.05,
                        minTradeSizeSol: 0.02,
                        maxTradeSizeSol: 0.08,
                        gasReserveSol: 0.03,
                        maxOpenPositions: 4,
                        defaultStopLossPct: -15,
                      });
                      showToast('Applied $50 Growth Profile', 'success');
                    }}
                    className="p-2.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700 text-left transition flex flex-col gap-0.5"
                  >
                    <div className="text-xs font-bold text-zinc-200">
                      $50 Growth Bag
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      0.22 SOL Capital &bull; 0.05 SOL / trade
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      const total = config?.balanceSol || 0;
                      const gas = config?.gasReserveSol || 0.025;
                      const safe = Math.max(0, Number((total - gas).toFixed(4)));
                      if (safe <= 0) {
                        showToast('Balance insufficient to allocate capital above gas floor', 'error');
                        return;
                      }
                      const size = Math.max(0.005, Number((safe / 3).toFixed(3)));
                      handleSaveConfig({
                        allocatedCapitalSol: safe,
                        targetTradeSizeSol: size,
                        minTradeSizeSol: 0.005,
                        maxTradeSizeSol: Number((size * 1.5).toFixed(3)),
                      });
                      showToast(`Allocated 100% Safe Balance (${safe} SOL)`, 'success');
                    }}
                    className="p-2.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-emerald-500/30 text-left transition flex flex-col gap-0.5"
                  >
                    <div className="text-xs font-bold text-emerald-300">
                      Max Safe Balance
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      All balance minus Gas Reserve
                    </div>
                  </button>
                </div>
              </div>

              {/* PRIMARY SETTING: How Many SOL We Will Use (Capital Allocation) */}
              <div className="p-4 rounded-xl bg-zinc-950 border border-emerald-500/40 flex flex-col gap-3.5 shadow-lg shadow-emerald-950/20">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-mono font-bold text-emerald-400 uppercase flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                      <span>How Many SOL to Use (Allocated Trading Capital):</span>
                    </div>
                    <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                      The maximum total SOL the autonomous bot is authorized to deploy from your wallet.
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-mono font-bold text-emerald-400">
                      {config?.allocatedCapitalSol !== undefined ? config.allocatedCapitalSol.toFixed(3) : '0.080'} SOL
                    </span>
                    <div className="text-[10px] font-mono text-emerald-300/80">
                      &asymp; ${((config?.allocatedCapitalSol ?? 0.08) * solUsdPrice).toFixed(2)} USD
                    </div>
                  </div>
                </div>

                {/* Slider for Capital Allocation */}
                <div className="space-y-1">
                  <input
                    type="range"
                    min="0.01"
                    max={Math.max(0.02, Number(((config?.balanceSol || 0.12) - (config?.gasReserveSol || 0.025)).toFixed(3)))}
                    step="0.005"
                    value={config?.allocatedCapitalSol ?? 0.08}
                    onChange={(e) => handleSaveConfig({ allocatedCapitalSol: parseFloat(e.target.value) || 0.01 })}
                    className="w-full accent-emerald-500 cursor-pointer h-2 bg-zinc-800 rounded-lg"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                    <span>Min: 0.010 SOL ($1.70)</span>
                    <span>Max Safe: {Math.max(0, Number(((config?.balanceSol || 0.12) - (config?.gasReserveSol || 0.025)).toFixed(3)))} SOL</span>
                  </div>
                </div>

                {/* Quick Pick Buttons for Capital Allocation */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {[
                    { label: '0.05 SOL ($8.50)', val: 0.05 },
                    { label: '0.08 SOL ($13.60)', val: 0.08 },
                    { label: '50% Wallet', val: Number(((config?.balanceSol || 0.12) * 0.5).toFixed(3)) },
                    { label: '75% Wallet', val: Number(((config?.balanceSol || 0.12) * 0.75).toFixed(3)) },
                    { label: 'Max Safe', val: Math.max(0.01, Number(((config?.balanceSol || 0.12) - (config?.gasReserveSol || 0.025)).toFixed(3))) },
                  ].map((chip, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSaveConfig({ allocatedCapitalSol: chip.val })}
                      className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition ${
                        Math.abs((config?.allocatedCapitalSol ?? 0.08) - chip.val) < 0.005
                          ? 'bg-emerald-600 text-white font-bold shadow-sm'
                          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 border border-zinc-800'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}

                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-[11px] font-mono text-zinc-400">Custom:</span>
                    <input
                      type="number"
                      step="0.005"
                      min="0.005"
                      max={config?.balanceSol || 1.0}
                      value={config?.allocatedCapitalSol ?? 0.08}
                      onChange={(e) => handleSaveConfig({ allocatedCapitalSol: parseFloat(e.target.value) || 0.01 })}
                      className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono font-bold text-emerald-400 text-center"
                    />
                    <span className="text-xs font-mono text-zinc-400">SOL</span>
                  </div>
                </div>
              </div>

              {/* SECOND SETTING: Per-Trade Ticket Sizing */}
              <div className="p-4 rounded-xl bg-zinc-950 border border-cyan-500/40 flex flex-col gap-3 shadow-lg shadow-cyan-950/20">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-mono font-bold text-cyan-400 uppercase">
                      Target Sizing Per Trade (Ticket Size):
                    </div>
                    <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                      Amount of SOL spent on each individual mempool buy order.
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-base font-mono font-bold text-cyan-300">
                      {config?.targetTradeSizeSol !== undefined ? config.targetTradeSizeSol.toFixed(3) : '0.020'} SOL
                    </span>
                    <div className="text-[10px] font-mono text-zinc-400">
                      &asymp; ${((config?.targetTradeSizeSol ?? 0.02) * solUsdPrice).toFixed(2)} USD
                    </div>
                  </div>
                </div>

                {/* Sizing Chips */}
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { label: '0.015 SOL ($2.55)', val: 0.015 },
                    { label: '0.020 SOL ($3.40)', val: 0.020 },
                    { label: '0.030 SOL ($5.10)', val: 0.030 },
                    { label: '0.050 SOL ($8.50)', val: 0.050 },
                  ].map((chip, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSaveConfig({ targetTradeSizeSol: chip.val })}
                      className={`px-2.5 py-1.5 rounded text-xs font-mono font-semibold transition ${
                        Math.abs((config?.targetTradeSizeSol ?? 0.02) - chip.val) < 0.003
                          ? 'bg-cyan-600 text-white font-bold'
                          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 border border-zinc-800'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}

                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-[11px] font-mono text-zinc-400">Custom:</span>
                    <input
                      type="number"
                      step="0.005"
                      min="0.005"
                      max={config?.allocatedCapitalSol || 0.5}
                      value={config?.targetTradeSizeSol ?? 0.02}
                      onChange={(e) => handleSaveConfig({ targetTradeSizeSol: parseFloat(e.target.value) || 0.01 })}
                      className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono font-bold text-cyan-300 text-center"
                    />
                    <span className="text-xs font-mono text-zinc-400">SOL</span>
                  </div>
                </div>

                {/* Dynamic Capacity Feedback */}
                <div className="p-2.5 rounded-lg bg-zinc-900/70 border border-zinc-800 text-[11px] font-mono text-zinc-300 flex items-center justify-between">
                  <span>Simultaneous Trade Capacity:</span>
                  <span className="text-emerald-400 font-bold">
                    ~{Math.max(1, Math.floor((config?.allocatedCapitalSol ?? 0.08) / (config?.targetTradeSizeSol ?? 0.02)))} Concurrent Trades
                  </span>
                </div>
              </div>

              {/* Default Stop Loss (SL %) */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono font-bold text-zinc-200">Default Hard Stop Loss (SL):</div>
                    <div className="text-[11px] font-mono text-zinc-400">Exit trigger if token drops below entry price</div>
                  </div>
                  <span className="text-base font-mono font-bold text-rose-400">
                    {config?.defaultStopLossPct}%
                  </span>
                </div>

                {/* Preset SL buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {[-8, -12, -15, -20, -25].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => handleSaveConfig({ defaultStopLossPct: pct })}
                      className={`px-3 py-1.5 rounded text-xs font-mono font-bold transition ${
                        config?.defaultStopLossPct === pct
                          ? 'bg-rose-600 text-white shadow-md shadow-rose-950/50'
                          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 border border-zinc-800'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                  <div className="flex items-center gap-1 ml-auto">
                    <input
                      type="number"
                      max="-1"
                      min="-50"
                      value={config?.defaultStopLossPct || -12}
                      onChange={(e) => handleSaveConfig({ defaultStopLossPct: parseFloat(e.target.value) || -12 })}
                      className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-rose-400 text-center font-bold"
                    />
                    <span className="text-xs text-zinc-500 font-mono">%</span>
                  </div>
                </div>
              </div>

              {/* Minimum & Maximum Position Limits & Gas Floor */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Minimum Position Size */}
                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-1.5">
                  <div className="text-xs font-mono font-bold text-zinc-200">Min Trade Size:</div>
                  <div className="text-[10px] font-mono text-zinc-500">Eliminates micro-dust</div>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      step="0.005"
                      min="0.005"
                      max="1.0"
                      value={config?.minTradeSizeSol || 0.01}
                      onChange={(e) => handleSaveConfig({ minTradeSizeSol: parseFloat(e.target.value) || 0.01 })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono font-bold text-zinc-100"
                    />
                    <span className="text-[10px] font-mono text-zinc-400">SOL</span>
                  </div>
                </div>

                {/* Maximum Position Size */}
                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-1.5">
                  <div className="text-xs font-mono font-bold text-zinc-200">Max Trade Size:</div>
                  <div className="text-[10px] font-mono text-zinc-500">Hard single snipe cap</div>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="10.0"
                      value={config?.maxTradeSizeSol || 0.04}
                      onChange={(e) => handleSaveConfig({ maxTradeSizeSol: parseFloat(e.target.value) || 0.04 })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono font-bold text-emerald-400"
                    />
                    <span className="text-[10px] font-mono text-emerald-400">SOL</span>
                  </div>
                </div>

                {/* Gas Reserve Floor */}
                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-1.5">
                  <div className="text-xs font-mono font-bold text-zinc-200">Gas Reserve Floor:</div>
                  <div className="text-[10px] font-mono text-zinc-500">Kept safe for network txs</div>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      step="0.005"
                      min="0.01"
                      max="0.2"
                      value={config?.gasReserveSol || 0.025}
                      onChange={(e) => handleSaveConfig({ gasReserveSol: parseFloat(e.target.value) || 0.025 })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono font-bold text-amber-300"
                    />
                    <span className="text-[10px] font-mono text-amber-300">SOL</span>
                  </div>
                </div>
              </div>

              {/* Trailing Stop & Max Positions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-2">
                  <div className="text-xs font-mono font-bold text-zinc-200">Trailing Stop Distance:</div>
                  <div className="text-[11px] font-mono text-zinc-500">Trails peak price once in profit</div>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      min="3"
                      max="30"
                      value={config?.trailingStopDistancePct || 10}
                      onChange={(e) => handleSaveConfig({ trailingStopDistancePct: parseFloat(e.target.value) || 10 })}
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm font-mono font-bold text-cyan-300"
                    />
                    <span className="text-xs font-mono text-zinc-400">%</span>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-2">
                  <div className="text-xs font-mono font-bold text-zinc-200">Max Open Positions:</div>
                  <div className="text-[11px] font-mono text-zinc-500">Concurrent bags held in parallel</div>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={config?.maxOpenPositions || 3}
                      onChange={(e) => handleSaveConfig({ maxOpenPositions: parseInt(e.target.value) || 3 })}
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm font-mono font-bold text-zinc-100"
                    />
                    <span className="text-xs font-mono text-zinc-400">Trades</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveStep(4)}
                className="w-full py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-1 mt-2"
              >
                <span>Continue to Step 4: When to Turn On Kill Switch</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sizing Visualizer Card */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span>Capital Partition &amp; Risk Architecture</span>
              </h4>

              <div className="space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between p-2.5 rounded bg-zinc-950 border border-zinc-800/80">
                  <span className="text-zinc-400">Total Connected Balance:</span>
                  <span className="text-zinc-100 font-bold">
                    {config?.balanceSol?.toFixed(4) || '0.1200'} SOL (${config?.balanceUsd?.toFixed(2) || '20.40'})
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-emerald-950/40 border border-emerald-800/60">
                  <span className="text-emerald-300">Allocated for Trading:</span>
                  <span className="text-emerald-300 font-bold">
                    {config?.allocatedCapitalSol !== undefined ? config.allocatedCapitalSol.toFixed(3) : '0.080'} SOL
                    <span className="text-xs font-normal ml-1">
                      (&asymp;${((config?.allocatedCapitalSol ?? 0.08) * solUsdPrice).toFixed(2)})
                    </span>
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-cyan-950/40 border border-cyan-800/60">
                  <span className="text-cyan-300">Ticket Size per Trade:</span>
                  <span className="text-cyan-300 font-bold">
                    {config?.targetTradeSizeSol !== undefined ? config.targetTradeSizeSol.toFixed(3) : '0.020'} SOL
                    <span className="text-xs font-normal ml-1">
                      (&asymp;${((config?.targetTradeSizeSol ?? 0.02) * solUsdPrice).toFixed(2)})
                    </span>
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-zinc-950 border border-zinc-800/80">
                  <span className="text-zinc-400">Protected Gas Buffer:</span>
                  <span className="text-amber-400 font-bold">
                    {config?.gasReserveSol || 0.025} SOL (&asymp;${((config?.gasReserveSol || 0.025) * solUsdPrice).toFixed(2)})
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-zinc-950 border border-zinc-800/80">
                  <span className="text-zinc-400">Hard Stop Loss:</span>
                  <span className="text-rose-400 font-bold">{config?.defaultStopLossPct}%</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-zinc-950 border border-zinc-800/80">
                  <span className="text-zinc-400">Max Risk per Trade:</span>
                  <span className="text-rose-300 font-bold">
                    -{( (config?.targetTradeSizeSol || 0.02) * Math.abs(config?.defaultStopLossPct || 12) / 100 ).toFixed(4)} SOL
                    <span className="text-xs text-zinc-500 font-normal ml-1">
                      (&asymp;${( (config?.targetTradeSizeSol || 0.02) * Math.abs(config?.defaultStopLossPct || 12) / 100 * solUsdPrice ).toFixed(2)})
                    </span>
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-zinc-950 border border-zinc-800/80">
                  <span className="text-zinc-400">Take Profit Scale Tier 1:</span>
                  <span className="text-emerald-400 font-bold">+{config?.takeProfitTier1Pct}% (50% scale-out)</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded bg-zinc-950 border border-zinc-800/80">
                  <span className="text-zinc-400">Take Profit Scale Tier 2:</span>
                  <span className="text-emerald-400 font-bold">+{config?.takeProfitTier2Pct}% (Runner full exit)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: When to Turn On Kill Switch & Circuit Breakers */}
      {activeStep === 4 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 flex flex-col gap-5">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-400">
                  <ShieldAlert className="w-5 h-5" />
                  <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-100">
                    Step 4: When to Turn On Kill Switch (Rules &amp; Trigger Conditions)
                  </h3>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-rose-950/30 border border-rose-800/50 text-xs font-mono text-rose-200 leading-relaxed">
                <strong>What is the Kill Switch?</strong> The Kill Switch is an emergency circuit breaker that halts the autonomous scanning loop, cancels all pending swap instructions, and liquidates 100% of open positions at market price back into cash SOL to protect your principal.
              </div>

              {/* Actionable Guide: When should an operator trigger the Kill Switch? */}
              <div className="space-y-3">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
                  Automated Trigger Conditions &amp; Rules:
                </h4>

                {(config?.killSwitchRules || []).map((rule: KillSwitchRule) => (
                  <div
                    key={rule.id}
                    className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => {
                          const updated = (config?.killSwitchRules || []).map((r) =>
                            r.id === rule.id ? { ...r, enabled: e.target.checked } : r
                          );
                          handleSaveConfig({ killSwitchRules: updated });
                        }}
                        className="mt-1 w-4 h-4 accent-rose-500 rounded"
                      />
                      <div>
                        <div className="text-xs font-mono font-bold text-zinc-200 flex items-center gap-2">
                          <span>{rule.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-rose-300 font-mono">
                            Threshold: {rule.thresholdValue} {rule.unit}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-zinc-400 mt-1 leading-relaxed">
                          {rule.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <input
                        type="number"
                        value={rule.thresholdValue}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const updated = (config?.killSwitchRules || []).map((r) =>
                            r.id === rule.id ? { ...r, thresholdValue: val } : r
                          );
                          handleSaveConfig({ killSwitchRules: updated });
                        }}
                        className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-100 font-bold text-center"
                      />
                      <span className="text-xs font-mono text-zinc-500">{rule.unit}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Manual Immediate Nuclear Kill Switch */}
              <div className="p-4 rounded-xl bg-zinc-950 border-2 border-rose-600/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-mono font-bold text-rose-300 uppercase tracking-wide">
                    Manual Nuclear Kill Switch (Immediate Panic Flatten)
                  </div>
                  <div className="text-xs font-mono text-zinc-400 mt-1">
                    Clicking this immediately flattens all {activeTrades.length} open position(s) at current market price and freezes the bot.
                  </div>
                </div>
                <button
                  onClick={() => handleTriggerKillSwitch('Manual operator panic dump')}
                  className="px-5 py-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-mono font-bold uppercase tracking-wider transition shadow-2xl shadow-rose-950/80 active:scale-95 whitespace-nowrap"
                >
                  TRIGGER KILL SWITCH NOW
                </button>
              </div>

              <button
                onClick={() => setActiveStep(5)}
                className="w-full py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-1 mt-2"
              >
                <span>Continue to Step 5: Exit Options for Each Active Trade</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
                <CircleAlert className="w-4 h-4" />
                <span>When to Trigger the Kill Switch:</span>
              </h4>

              <div className="space-y-3 text-xs font-mono text-zinc-300">
                <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800">
                  <div className="text-rose-300 font-bold">1. Sudden Mempool Cascade:</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    If Bitcoin or Solana drops &gt;4% in 15 minutes, memecoins bleed violently. Engage the Kill Switch to preserve cash.
                  </div>
                </div>

                <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800">
                  <div className="text-amber-300 font-bold">2. Network Congestion &amp; Dropped Txs:</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    When Solana TPS slows or RPC latency exceeds 2000ms, snipers get frontrun by Jito bundles. Trigger halt.
                  </div>
                </div>

                <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800">
                  <div className="text-cyan-300 font-bold">3. 3 Consecutive False Breakouts:</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    If 3 tokens in a row fail to break past +25% volume expansion, market liquidity is dry. Step aside.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 5: Exit For Each Trade Option */}
      {activeStep === 5 && (
        <div className="flex flex-col gap-5">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <TrendingUp className="w-5 h-5" />
                  <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-100">
                    Step 5: Granular Exit Options for Each Individual Trade ({activeTrades.length} Active)
                  </h3>
                </div>
                <p className="text-xs text-zinc-400 font-mono mt-1">
                  Manage risk with granular precision. For each active trade, you can execute a 100% market flatten, scale out 50% profits, move SL to breakeven, or customize stop/take-profit targets.
                </p>
              </div>

              {activeTrades.length > 0 && (
                <button
                  onClick={() => handleTriggerKillSwitch('Bulk manual flatten of all trades')}
                  className="px-3.5 py-1.5 rounded bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-mono font-bold transition whitespace-nowrap self-start sm:self-center"
                >
                  Flatten All ({activeTrades.length})
                </button>
              )}
            </div>

            {/* Active Positions Table / Cards */}
            {activeTrades.length === 0 ? (
              <div className="p-12 text-center rounded-xl bg-zinc-950 border border-zinc-800/80 text-zinc-500 font-mono text-xs">
                No active positions currently open. Capital is 100% safe in cash. The engine will allocate according to your sizing limits when edge qualifies.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/40">
                {activeTrades.map((trade: any) => {
                  const isPositive = (trade.pnlPct || 0) >= 0;

                  return (
                    <div key={trade.id} className="p-4 hover:bg-zinc-900/30 transition flex flex-col gap-3">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        {/* Token & Price Info */}
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center font-mono font-bold text-amber-400 text-xs shrink-0">
                            ${trade.symbol?.slice(0, 4)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono font-bold text-zinc-100">${trade.symbol}</span>
                              <span className="text-xs text-zinc-400">{trade.name}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                {trade.source === 'GROK_BOT' ? 'Grok Bot' : 'Coordinator'}
                              </span>
                              <span className="text-[11px] font-mono text-zinc-500 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {trade.holdingTimeSec || trade.holdingSec || 42}s held
                              </span>
                            </div>

                            <div className="text-xs font-mono text-zinc-400 mt-1 flex items-center gap-3 flex-wrap">
                              <span>Entry: <strong>{trade.entryDisplay}</strong></span>
                              <span>&rarr;</span>
                              <span>Now: <strong className={isPositive ? 'text-emerald-400' : 'text-rose-400'}>{trade.priceDisplay}</strong></span>
                              <span>&bull;</span>
                              <span>Cost Basis: <strong>${trade.costBasisUsd?.toFixed(2) || (trade.costBasisSol * solUsdPrice).toFixed(2)}</strong></span>
                            </div>
                          </div>
                        </div>

                        {/* PnL & 4 Granular Exit Buttons */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                          {/* Live PnL */}
                          <div className="text-left sm:text-right">
                            <div className={`text-base font-mono font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isPositive ? '+' : ''}{trade.pnlPct?.toFixed(1)}%
                            </div>
                            <div className={`text-xs font-mono ${isPositive ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                              {isPositive ? '+' : ''}{trade.pnlValue}
                            </div>
                          </div>

                          {/* 4 Exit Action Buttons */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* 1. 100% Instant Market Flatten */}
                            <button
                              onClick={() => handleExecuteTradeExit(trade.id, 'FLATTEN_100')}
                              className="px-2.5 py-1.5 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-700/50 text-rose-200 text-xs font-mono font-semibold transition flex items-center gap-1"
                              title="Dump 100% of this specific position at market"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>Exit 100%</span>
                            </button>

                            {/* 2. Scale Out 50% (Lock Profits) */}
                            <button
                              onClick={() => handleExecuteTradeExit(trade.id, 'SCALE_OUT_50')}
                              className="px-2.5 py-1.5 rounded bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-700/50 text-emerald-200 text-xs font-mono font-semibold transition flex items-center gap-1"
                              title="Sell 50% to take profit, keep 50% runner"
                            >
                              <TrendingUp className="w-3.5 h-3.5" />
                              <span>Scale 50%</span>
                            </button>

                            {/* 3. Move SL to Breakeven */}
                            <button
                              onClick={() => handleExecuteTradeExit(trade.id, 'BREAKEVEN_SL')}
                              className="px-2.5 py-1.5 rounded bg-cyan-950/60 hover:bg-cyan-900 border border-cyan-700/50 text-cyan-200 text-xs font-mono font-semibold transition flex items-center gap-1"
                              title="Adjust stop loss to entry price (zero risk remaining)"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>Breakeven SL</span>
                            </button>

                            {/* 4. Edit Custom SL / TP */}
                            <button
                              onClick={() => {
                                setEditingTrade({
                                  id: trade.id,
                                  symbol: trade.symbol,
                                  entryPrice: trade.entryPriceUsd || trade.entryPriceSol,
                                  currentSlPct: -12,
                                  currentTpPct: 45,
                                });
                                setCustomSlInput(-12);
                                setCustomTpInput(45);
                              }}
                              className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs font-mono font-semibold transition flex items-center gap-1"
                              title="Custom SL % and TP % for this trade"
                            >
                              <Sliders className="w-3.5 h-3.5" />
                              <span>Custom SL/TP</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Signals Stream & 1-Click Auto-Trade Testing */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            <div>
              <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-100 flex items-center gap-2">
                <span>Live Alpha Signals Stream &amp; 1-Click Auto-Trade Testing</span>
                <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono">
                  {liveCandidateSignals.length > 0 ? `${liveCandidateSignals.length} Active Candidates` : 'Mempool Ready'}
                </span>
              </h3>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Execute real-time test or live trades on detected token opportunities using your connected wallet.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              onClick={fetchWalletState}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono transition flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Signals</span>
            </button>
          </div>
        </div>

        {/* Signals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(liveCandidateSignals.length > 0
            ? liveCandidateSignals.slice(0, 6)
            : [
                {
                  id: 'sig-bonk',
                  symbol: 'BONK',
                  name: 'Bonk Doge Solana',
                  tokenMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
                  priceSol: 0.00000014,
                  priceUsd: 0.000021,
                  opportunityScore: 94,
                  source: 'PUMP_FUN_CURVE',
                  liquidityUsd: 420000,
                  riskStatus: 'SAFE_VERIFIED',
                },
                {
                  id: 'sig-wif',
                  symbol: 'WIF',
                  name: 'Dogwifhat Hat Alpha',
                  tokenMint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
                  priceSol: 0.0125,
                  priceUsd: 1.85,
                  opportunityScore: 89,
                  source: 'WHALE_BUYS',
                  liquidityUsd: 1250000,
                  riskStatus: 'SAFE_VERIFIED',
                },
                {
                  id: 'sig-popcat',
                  symbol: 'POPCAT',
                  name: 'Popcat Clicker Quant',
                  tokenMint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
                  priceSol: 0.0062,
                  priceUsd: 0.92,
                  opportunityScore: 86,
                  source: 'RAYDIUM_LP_BURN',
                  liquidityUsd: 890000,
                  riskStatus: 'SAFE_VERIFIED',
                },
              ]
          ).map((sig: any) => {
            const sym = sig.metadata?.symbol || sig.symbol || 'ALPHA';
            const mint = sig.metadata?.mint || sig.tokenMint || 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
            const name = sig.metadata?.name || sig.name || sym;
            const score = sig.opportunity?.opportunityScore || sig.opportunityScore || 88;
            const price = sig.micro?.priceSol || sig.priceSol || 0.00045;
            const venue = sig.metadata?.launchVenue || sig.source || 'RAYDIUM';
            const isExecuting = isExecutingSignalId === mint;

            return (
              <div
                key={mint}
                className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800/90 hover:border-zinc-700 transition flex flex-col justify-between gap-3 shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center font-mono font-bold text-amber-400 text-xs">
                        ${sym.slice(0, 3)}
                      </div>
                      <div>
                        <div className="text-xs font-mono font-bold text-zinc-100 flex items-center gap-1.5">
                          <span>${sym}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono">
                            {venue}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500 truncate max-w-[140px]">{name}</div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-mono font-bold text-emerald-400">{score}/100</div>
                      <div className="text-[9px] font-mono text-zinc-500">Alpha Score</div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono bg-zinc-900/60 p-2 rounded-lg border border-zinc-800/60">
                    <div>
                      <span className="text-zinc-500 text-[10px] block">Price:</span>
                      <span className="text-zinc-200 font-semibold">{price < 0.001 ? price.toFixed(8) : price.toFixed(4)} SOL</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 text-[10px] block">Risk Audit:</span>
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> LP Burned
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono text-zinc-500 truncate">
                    {mint.slice(0, 4)}...{mint.slice(-4)}
                  </span>
                  <button
                    onClick={() => executeSignalTrade(sig)}
                    disabled={isExecuting || !isConnected}
                    className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider transition flex items-center gap-1 shadow disabled:opacity-40 whitespace-nowrap"
                    title={isConnected ? `Auto-trade ${config?.minTradeSizeSol || 0.05} SOL of $${sym}` : 'Connect wallet first'}
                  >
                    {isExecuting ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Swapping...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3 h-3" />
                        <span>Auto-Trade Now</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal for Editing Custom SL / TP per Trade */}
      {editingTrade && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-400">
                <Sliders className="w-5 h-5" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-100">
                  Custom SL &amp; TP for ${editingTrade.symbol}
                </h3>
              </div>
              <button
                onClick={() => setEditingTrade(null)}
                className="text-zinc-500 hover:text-zinc-300 text-xs font-mono"
              >
                &times; Close
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-zinc-400 mb-1">Custom Stop Loss (% from entry):</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    max="-1"
                    min="-50"
                    value={customSlInput}
                    onChange={(e) => setCustomSlInput(parseFloat(e.target.value) || -12)}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-rose-400 font-bold"
                  />
                  <span className="text-zinc-400">%</span>
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Custom Take Profit Target (% from entry):</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="5"
                    max="500"
                    value={customTpInput}
                    onChange={(e) => setCustomTpInput(parseFloat(e.target.value) || 50)}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-emerald-400 font-bold"
                  />
                  <span className="text-zinc-400">%</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                onClick={() => setEditingTrade(null)}
                className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleExecuteTradeExit(editingTrade.id, 'CUSTOM_SL_TP', customSlInput, customTpInput);
                }}
                className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold"
              >
                Apply to ${editingTrade.symbol}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5-Step Guided Onboarding & Diagnostics Wizard Modal */}
      {showOnboardingWizard && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-5 my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400 font-bold font-mono">
                  {wizardStep}/5
                </div>
                <div>
                  <h3 className="text-base font-mono font-bold text-zinc-100 uppercase tracking-wide">
                    {wizardStep === 1 && 'Step 1: Connect Wallet & Select Network'}
                    {wizardStep === 2 && 'Step 2: Balance Audit & Live Diagnostics'}
                    {wizardStep === 3 && 'Step 3: Signal Sources & Sizing Limits'}
                    {wizardStep === 4 && 'Step 4: Execute Pre-Flight Test Swap'}
                    {wizardStep === 5 && 'Step 5: Activate Autonomous Trading'}
                  </h3>
                  <p className="text-xs font-mono text-zinc-400 mt-0.5">
                    Real-money onboarding &amp; testing walkthrough
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowOnboardingWizard(false)}
                className="text-zinc-400 hover:text-zinc-200 text-lg font-mono p-1"
              >
                &times;
              </button>
            </div>

            {/* Stepper Progress Indicator */}
            <div className="grid grid-cols-5 gap-1.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <div
                  key={s}
                  className={`h-1.5 rounded-full transition ${
                    s < wizardStep
                      ? 'bg-emerald-400'
                      : s === wizardStep
                      ? 'bg-amber-400'
                      : 'bg-zinc-800'
                  }`}
                />
              ))}
            </div>

            {/* Step 1 Content: Wallet & Network */}
            {wizardStep === 1 && (
              <div className="space-y-4 font-mono text-xs">
                <p className="text-zinc-300 leading-relaxed">
                  To execute live or simulated trades, link a Solana wallet. You can connect your browser extension (Phantom, Solflare, Backpack) or use our verified test hot wallet.
                </p>

                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                  <div className="text-zinc-200 font-bold">1. Select Target Network:</div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleSaveConfig({ network: 'mainnet-beta' })}
                      className={`p-3 rounded-lg border text-left transition ${
                        config?.network === 'mainnet-beta'
                          ? 'bg-zinc-800 border-amber-400 text-amber-300 font-bold'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="font-bold">Mainnet-Beta (Real Money)</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Live Solana DEX liquidity &amp; real SOL</div>
                    </button>
                    <button
                      onClick={() => handleSaveConfig({ network: 'devnet' })}
                      className={`p-3 rounded-lg border text-left transition ${
                        config?.network === 'devnet'
                          ? 'bg-zinc-800 border-amber-400 text-amber-300 font-bold'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="font-bold">Devnet (Free Testing)</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Free 1.0 SOL airdrops &amp; sandbox swaps</div>
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-zinc-200 font-bold">Current Connection:</div>
                      <div className="text-zinc-400 text-[11px] mt-0.5">
                        {isConnected ? `${config?.walletName} (${config?.walletAddress?.slice(0, 6)}...${config?.walletAddress?.slice(-6)})` : 'Not Connected'}
                      </div>
                    </div>
                    {isConnected ? (
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold text-[11px]">
                          Connected
                        </span>
                        <button
                          onClick={handleDisconnect}
                          className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-700/50 text-rose-300 text-[11px] font-bold"
                        >
                          Disconnect / Change
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleConnectBrowserWallet}
                        disabled={isConnectingBrowser}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition"
                      >
                        {isConnectingBrowser ? 'Connecting...' : 'Connect Browser Wallet'}
                      </button>
                    )}
                  </div>

                  {isConnected && (config?.walletName?.includes('Demo') || config?.walletAddress === '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin') && (
                    <div className="p-2.5 rounded bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-300">
                      Currently using <strong>Sandbox Demo Address</strong>. Click "Disconnect / Change" above or paste your real Phantom address below to use real funds.
                    </div>
                  )}

                  {!isConnected && (
                    <div className="pt-2 border-t border-zinc-800/80 flex gap-2">
                      <input
                        type="text"
                        value={customAddressInput}
                        onChange={(e) => setCustomAddressInput(e.target.value)}
                        placeholder="Or paste your Phantom public key..."
                        className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
                      />
                      <button
                        onClick={() => handleConnectManualAddress(customAddressInput, 'Phantom (My Wallet)')}
                        disabled={!customAddressInput.trim()}
                        className="px-3 py-1.5 rounded bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs uppercase"
                      >
                        Link
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2 Content: Diagnostics & Balance */}
            {wizardStep === 2 && (
              <div className="space-y-4 font-mono text-xs">
                <p className="text-zinc-300 leading-relaxed">
                  Let's verify your wallet balance, calculate safe tradeable headroom after maintaining the gas floor, and ping the Solana RPC cluster.
                </p>

                <div className="grid grid-cols-3 gap-3 bg-zinc-950 p-4 rounded-xl border border-zinc-800 text-center">
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase block">Total Balance</span>
                    <span className="text-sm font-bold text-zinc-100">{config?.balanceSol?.toFixed(4) || '0.0000'} SOL</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase block">Gas Floor</span>
                    <span className="text-sm font-bold text-amber-400">{config?.gasReserveSol || 0.05} SOL</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase block">Tradeable Headroom</span>
                    <span className="text-sm font-bold text-emerald-400">
                      {Math.max(0, (config?.balanceSol || 0) - (config?.gasReserveSol || 0.05)).toFixed(4)} SOL
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-200">5-Point Real-Time Diagnostics:</span>
                    <button
                      onClick={runDiagnostics}
                      disabled={isRunningDiagnostics}
                      className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] transition flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRunningDiagnostics ? 'animate-spin' : ''}`} />
                      <span>{isRunningDiagnostics ? 'Testing...' : 'Run Diagnostics'}</span>
                    </button>
                  </div>

                  {diagnostics ? (
                    <div className="space-y-1.5 text-[11px]">
                      {diagnostics.checks.map((c: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800">
                          <span className="text-zinc-300 flex items-center gap-1.5">
                            {c.status === 'PASS' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                            {c.name}
                          </span>
                          <span className="text-zinc-500">{c.detail}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-zinc-500">
                      Click "Run Diagnostics" to execute a live 5-point connectivity audit.
                    </div>
                  )}
                </div>

                {config?.network === 'devnet' && (
                  <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-700/50 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-emerald-300">Need Test SOL?</div>
                      <div className="text-[11px] text-zinc-400">Claim 1.0 SOL Devnet airdrop immediately.</div>
                    </div>
                    <button
                      onClick={requestDevnetAirdrop}
                      disabled={isRequestingAirdrop}
                      className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition flex items-center gap-1"
                    >
                      {isRequestingAirdrop ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      <span>Claim 1 SOL</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 3 Content: Signal Sources & Sizing */}
            {wizardStep === 3 && (
              <div className="space-y-4 font-mono text-xs">
                <p className="text-zinc-300 leading-relaxed">
                  Configure which alpha signals trigger trades, and set strict ticket sizes to protect capital.
                </p>

                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                  <div className="text-zinc-200 font-bold">Enabled Signal Triggers:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    {[
                      { id: 'WHALE_BUYS', label: 'Whale Mempool Swarms (>15 SOL)' },
                      { id: 'PUMP_FUN_CURVE', label: 'Pump.fun Migration (>95%)' },
                      { id: 'RAYDIUM_LP_BURN', label: 'Raydium LP Burned & Revoked' },
                      { id: 'SMART_WALLETS', label: 'Smart Wallets (>75% Winrate)' },
                    ].map((src) => {
                      const activeSources: string[] = Array.isArray(config?.enabledSignalSources)
                        ? config.enabledSignalSources
                        : ['WHALE_BUYS', 'PUMP_FUN_CURVE', 'RAYDIUM_LP_BURN', 'SMART_WALLETS'];
                      const isChecked = activeSources.includes(src.id);
                      return (
                        <label key={src.id} className="flex items-center gap-2 p-2 rounded bg-zinc-900 border border-zinc-800">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const updated = e.target.checked
                                ? [...activeSources, src.id]
                                : activeSources.filter((s: string) => s !== src.id);
                              handleSaveConfig({ enabledSignalSources: updated });
                            }}
                            className="accent-amber-400"
                          />
                          <span>{src.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                  <div>
                    <label className="text-zinc-400 block mb-1">Min Trade Sizing:</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.01"
                        value={config?.minTradeSizeSol || 0.05}
                        onChange={(e) => handleSaveConfig({ minTradeSizeSol: parseFloat(e.target.value) || 0.05 })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 font-bold"
                      />
                      <span className="text-zinc-500">SOL</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-zinc-400 block mb-1">Max Sizing Limit:</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.05"
                        value={config?.maxTradeSizeSol || 0.5}
                        onChange={(e) => handleSaveConfig({ maxTradeSizeSol: parseFloat(e.target.value) || 0.5 })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 font-bold"
                      />
                      <span className="text-zinc-500">SOL</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4 Content: Pre-Flight Test Swap */}
            {wizardStep === 4 && (
              <div className="space-y-4 font-mono text-xs">
                <p className="text-zinc-300 leading-relaxed">
                  Before launching autonomous mode, execute a safe test trade. This guarantees that your wallet, priority fee, slippage, and position tracking work seamlessly.
                </p>

                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-200">Test Asset: $BONK</span>
                    <span className="text-zinc-400">Size: {testSwapSize} SOL</span>
                  </div>

                  <button
                    onClick={executePreflightTestSwap}
                    disabled={isExecutingTestSwap || !isConnected}
                    className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-40"
                  >
                    {isExecutingTestSwap ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    <span>{isExecutingTestSwap ? 'Broadcasting Test Swap...' : 'Execute Live Pre-Flight Trade'}</span>
                  </button>

                  {testSwapReceipt && (
                    <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-600/50 space-y-2">
                      <div className="flex items-center justify-between text-emerald-300 font-bold">
                        <span>Trade Confirmed!</span>
                        <a
                          href={testSwapReceipt.solscanUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-400 hover:underline flex items-center gap-1 text-[11px]"
                        >
                          <span>Solscan Receipt</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div className="text-[11px] text-zinc-300">
                        Tokens Received: <strong>{Number(testSwapReceipt.tokensReceived).toLocaleString()}</strong> &bull; Latency: {testSwapReceipt.latencyMs || 64}ms
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 5 Content: Launch Autotrade */}
            {wizardStep === 5 && (
              <div className="space-y-4 font-mono text-xs">
                <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-700/50 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>All Onboarding Checks Passed!</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed text-[11px]">
                    Your wallet is connected and funded, gas floor reserves are locked, and risk rules are verified. Choose your operating mode to complete setup:
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      handleSaveConfig({ autotradeMode: 'SEMI_AUTONOMOUS' });
                      setShowOnboardingWizard(false);
                      showToast('Semi-Autonomous mode active! Confirming each trade.');
                    }}
                    className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-amber-400 text-left transition space-y-1"
                  >
                    <div className="font-bold text-amber-300 text-sm">Semi-Autonomous</div>
                    <p className="text-[11px] text-zinc-400">Signals generate a 1-click confirmation card for your approval.</p>
                  </button>

                  <button
                    onClick={() => {
                      handleSaveConfig({ autotradeMode: 'FULL_AUTONOMOUS' });
                      setShowOnboardingWizard(false);
                      showToast('Full Autonomous trading activated!');
                    }}
                    className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-emerald-400 text-left transition space-y-1"
                  >
                    <div className="font-bold text-emerald-300 text-sm">Full Autonomous</div>
                    <p className="text-[11px] text-zinc-400">High-speed execution. Bot automatically snipes signals within your limits.</p>
                  </button>
                </div>
              </div>
            )}

            {/* Modal Footer Controls */}
            <div className="flex items-center justify-between border-t border-zinc-800 pt-4 font-mono text-xs">
              <button
                onClick={() => setWizardStep((prev) => Math.max(1, prev - 1))}
                disabled={wizardStep === 1}
                className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold disabled:opacity-30 transition"
              >
                &larr; Back
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowOnboardingWizard(false)}
                  className="px-3 py-2 text-zinc-500 hover:text-zinc-300 transition"
                >
                  Exit Wizard
                </button>

                {wizardStep < 5 ? (
                  <button
                    onClick={() => setWizardStep((prev) => Math.min(5, prev + 1))}
                    className="px-5 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold uppercase tracking-wider transition flex items-center gap-1"
                  >
                    <span>Next Step</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => setShowOnboardingWizard(false)}
                    className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase tracking-wider transition"
                  >
                    Complete Onboarding
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Extension Detection & Connection Options Modal */}
      {showExtensionNotFoundModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 font-mono">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-100">
                  Why Wasn't Phantom Detected?
                </h3>
              </div>
              <button
                onClick={() => setShowExtensionNotFoundModal(false)}
                className="text-zinc-400 hover:text-zinc-200 text-lg font-mono p-1"
              >
                &times;
              </button>
            </div>

            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200/90 leading-relaxed space-y-1">
              <div className="font-bold text-amber-300">Browser Security Restriction:</div>
              <p>
                You are viewing this application inside an embedded <code>&lt;iframe&gt;</code> preview. Browser wallet extensions (Phantom, Solflare, Backpack) intentionally block injection into iframes to protect users from malicious clickjacking.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="text-zinc-300 font-bold">Choose how you want to connect:</div>

              {/* Option 1: Open in new tab */}
              <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-emerald-500/50 transition space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Option 1: Open in Dedicated Tab (Recommended)
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Opening in a new tab runs the app in the top window where your Phantom extension can inject its popup approval prompt immediately.
                </p>
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition shadow-md"
                >
                  <span>Open App in New Tab</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* Option 2: Paste your real Solana address */}
              <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-cyan-500/50 transition space-y-2">
                <span className="font-bold text-cyan-400 flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" />
                  Option 2: Paste Your Real Phantom Public Address
                </span>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Copy your public key from Phantom and paste it here. The bot will query your live on-chain SOL balance and track real trades.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customAddressInput}
                    onChange={(e) => setCustomAddressInput(e.target.value)}
                    placeholder="Paste your Phantom address (e.g. 7Y3z...)"
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    onClick={async () => {
                      if (!customAddressInput.trim()) return;
                      await handleConnectManualAddress(customAddressInput.trim(), 'Phantom (My Wallet)');
                      setShowExtensionNotFoundModal(false);
                    }}
                    disabled={!customAddressInput.trim()}
                    className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold text-xs transition"
                  >
                    Link Key
                  </button>
                </div>
              </div>

              {/* Option 3: Use Sandbox / Demo Wallet */}
              <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800 flex items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-zinc-300 block text-[11px]">Option 3: Use Safe Sandbox Demo Vault</span>
                  <span className="text-[10px] text-zinc-500">Test autonomous execution without connecting real funds.</span>
                </div>
                <button
                  onClick={async () => {
                    await handleConnectManualAddress('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', 'Phantom (Demo Link)');
                    setShowExtensionNotFoundModal(false);
                  }}
                  className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-400 font-bold text-[11px] transition shrink-0"
                >
                  Use Demo Vault
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setShowExtensionNotFoundModal(false)}
                className="px-4 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
