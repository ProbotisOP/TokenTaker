import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Layers,
  Sliders,
  FileText,
  Flame,
  Radio,
  BarChart2,
  Crosshair,
  ShieldAlert,
  ShieldCheck,
  AlertCircle,
  Wallet,
} from 'lucide-react';
import { Header } from './components/Header.tsx';
import { PortfolioOverview } from './components/PortfolioOverview.tsx';
import { LiveScanner } from './components/LiveScanner.tsx';
import { ActivePositions } from './components/ActivePositions.tsx';
import { MicrostructureViewer } from './components/MicrostructureViewer.tsx';
import { BacktestStudio } from './components/BacktestStudio.tsx';
import { RiskControls } from './components/RiskControls.tsx';
import { AuditTrail } from './components/AuditTrail.tsx';
import { ExplainabilityModal } from './components/ExplainabilityModal.tsx';
import { AlphaAuditStudio } from './components/AlphaAuditStudio.tsx';
import { GrokBotStudio } from './components/GrokBotStudio.tsx';
import { WalletAutotradeStudio } from './components/WalletAutotradeStudio.tsx';
import { LiveMonitorTradeBanner } from './components/LiveMonitorTradeBanner.tsx';
import { RealTradeOrderModal } from './components/RealTradeOrderModal.tsx';
import { approvePhantomTrade } from './phantomClient.ts';
import {
  CandidateTokenState,
  DecisionAction,
  PortfolioState,
  Position,
  RiskLimits,
  StrategyWeights,
  SystemConfig,
  SystemMode,
  TradeDecisionRecord,
  WalletAutotradeConfig,
  LivePortfolioTelemetry,
} from './types.ts';
import { DEFAULT_RISK_LIMITS, DEFAULT_STRATEGY_WEIGHTS, DEFAULT_SYSTEM_CONFIG } from './trading/config.ts';

type ActiveTab = 'GROK_BOT' | 'REAL_WALLET' | 'MONITOR' | 'ALPHA_AUDIT' | 'BACKTEST' | 'RISK_TUNING' | 'AUDIT_LOG';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('MONITOR');

  // Core State
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_SYSTEM_CONFIG);
  const [portfolio, setPortfolio] = useState<PortfolioState>({
    cashSol: 0,
    equitySol: 0,
    activeExposureSol: 0,
    dailyRealizedPnlSol: 0,
    totalRealizedPnlSol: 0,
    unrealizedPnlSol: 0,
    peakEquitySol: 0,
    currentDrawdownPct: 0,
    maxDrawdownPct: 0,
    consecutiveLosses: 0,
    rollingWinRate: 0,
    rollingExpectancySol: 0,
    profitFactor: 0,
    tradeCount: 0,
    adaptiveMultiplier: 1.0,
  });
  const [riskLimits, setRiskLimits] = useState<RiskLimits>(DEFAULT_RISK_LIMITS);
  const [weights, setWeights] = useState<StrategyWeights>(DEFAULT_STRATEGY_WEIGHTS);
  const [activePositions, setActivePositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [candidates, setCandidates] = useState<CandidateTokenState[]>([]);
  const [feedStatus, setFeedStatus] = useState<{ state: string; tradeFlowEnabled: boolean; error?: string; trackedTokens: number }>();
  const [tradeHistory, setTradeHistory] = useState<TradeDecisionRecord[]>([]);

  // Selected candidate for detailed inspection / modal
  const [inspectedCandidate, setInspectedCandidate] = useState<CandidateTokenState | null>(null);
  const [selectedMicroCandidate, setSelectedMicroCandidate] = useState<CandidateTokenState | null>(null);

  // Real Money Trading Modal State
  const [walletConfig, setWalletConfig] = useState<WalletAutotradeConfig | null>(null);
  const [livePortfolio, setLivePortfolio] = useState<LivePortfolioTelemetry | null>(null);
  const [realTradeModalOpen, setRealTradeModalOpen] = useState(false);
  const [tradeModalCandidate, setTradeModalCandidate] = useState<CandidateTokenState | null>(null);
  const [tradeModalMint, setTradeModalMint] = useState<string | undefined>(undefined);
  const [tradeModalSymbol, setTradeModalSymbol] = useState<string | undefined>(undefined);
  const [tradeModalPriceSol, setTradeModalPriceSol] = useState<number | undefined>(undefined);
  const [tradeModalPriceUsd, setTradeModalPriceUsd] = useState<number | undefined>(undefined);

  // Poll real-time state from backend
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return;
      const data = await res.json();
      if (data.config) setConfig(data.config);
      if (data.portfolio) setPortfolio(data.portfolio);
      if (data.livePortfolio) setLivePortfolio(data.livePortfolio);
      if (data.riskLimits) setRiskLimits(data.riskLimits);
      if (data.weights) setWeights(data.weights);
      if (data.activePositions) setActivePositions(data.activePositions);
      if (data.closedPositions) setClosedPositions(data.closedPositions);
      if (data.feedStatus) setFeedStatus(data.feedStatus);
      if (data.candidateTokens) {
        setCandidates(data.candidateTokens);
        setSelectedMicroCandidate(previous => data.candidateTokens.find((c: CandidateTokenState) => c.metadata.mint === previous?.metadata.mint) ?? data.candidateTokens[0] ?? null);
        setInspectedCandidate(previous => previous ? data.candidateTokens.find((c: CandidateTokenState) => c.metadata.mint === previous.metadata.mint) ?? null : null);
      }
      if (data.tradeHistory) setTradeHistory(data.tradeHistory);
      if (data.walletConfig) setWalletConfig(data.walletConfig);
    } catch (err) {
      console.warn('Telemetry polling notice:', err);
    }
  }, []);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 1500);
    return () => clearInterval(interval);
  }, [fetchState]);

  // Mode changer
  const handleSetMode = async (newMode: SystemMode, confirmedLive: boolean = false) => {
    try {
      await fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode, confirmedLiveDisclaimer: confirmedLive }),
      });
      fetchState();
    } catch (err) {
      console.error('Mode change error', err);
    }
  };

  // Emergency stop
  const handleEmergencyStop = async () => {
    try {
      await fetch('/api/emergency-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Operator manual emergency kill switch' }),
      });
      fetchState();
    } catch (err) {
      console.error('Emergency stop error', err);
    }
  };

  // Manual flatten single position
  const handleManualClosePosition = async (positionId: string) => {
    if (activePositions.find(p => p.id === positionId)?.signingMethod === 'PHANTOM') {
      return handleOneClickExit(positionId, 100);
    }
    try {
      await fetch('/api/positions/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, action: 'MANUAL_CLOSE' }),
      });
      fetchState();
    } catch (err) {
      console.error('Manual close error', err);
    }
  };

  // Granular trade exit execution (100% exit, 50% scale, breakeven SL, custom SL/TP)
  const handleTradeExit = async (
    positionId: string,
    action: 'FLATTEN_100' | 'SCALE_OUT_50' | 'BREAKEVEN_SL' | 'CUSTOM_SL_TP',
    customSl?: number,
    customTp?: number
  ) => {
    if (activePositions.find(p => p.id === positionId)?.signingMethod === 'PHANTOM' && ['FLATTEN_100', 'SCALE_OUT_50'].includes(action)) {
      return handleOneClickExit(positionId, action === 'FLATTEN_100' ? 100 : 50);
    }
    try {
      await fetch('/api/wallet/trade-exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          action,
          customStopLossPct: customSl,
          customTakeProfitPct: customTp,
        }),
      });
      fetchState();
    } catch (err) {
      console.error('Trade exit error', err);
    }
  };

  // 1-Click Enroll into an on-chain trade
  const handleOneClickEnroll = async (candidate: CandidateTokenState, sizeSol?: number) => {
    try {
      const ticketSize = sizeSol || walletConfig?.targetTradeSizeSol || 0.02;
      const data = await approvePhantomTrade({ action: 'BUY', tokenMint: candidate.metadata.mint,
        symbol: candidate.metadata.symbol, name: candidate.metadata.name, sizeSol: ticketSize, requireEarlySignal: true });
      fetchState();
      return data;
    } catch (err: any) {
      console.error('One-click enroll error', err);
      return { success: false, error: err.message || 'Enrollment request failed' };
    }
  };

  // 1-Click Exit (Market Sell) from an active position
  const handleOneClickExit = async (positionId: string, pct: 100 | 50) => {
    try {
      const position = activePositions.find(p => p.id === positionId);
      if (position?.signingMethod === 'PHANTOM') {
        const result = await approvePhantomTrade({ action: 'SELL', positionId, pctToExit: pct, expectedWalletAddress: position.walletAddress });
        fetchState();
        return result;
      }
      const res = await fetch('/api/wallet/one-click-exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          pctToExit: pct,
          slippageBps: Math.round((walletConfig?.maxSlippagePct || 2.5) * 100),
        }),
      });
      const data = await res.json();
      fetchState();
      return data;
    } catch (err: any) {
      console.error('One-click exit error', err);
      return { success: false, error: err.message || 'Exit request failed' };
    }
  };

  // Open Real Money Trade Modal
  const handleOpenRealTradeModal = (
    candOrMint?: CandidateTokenState | string,
    symbol?: string,
    priceSol?: number,
    priceUsd?: number
  ) => {
    if (typeof candOrMint === 'object' && candOrMint !== null) {
      setTradeModalCandidate(candOrMint);
      setTradeModalMint(candOrMint.metadata.mint);
      setTradeModalSymbol(candOrMint.metadata.symbol);
      setTradeModalPriceSol(candOrMint.micro.priceSol);
      setTradeModalPriceUsd(candOrMint.micro.priceUsd);
    } else if (typeof candOrMint === 'string' && candOrMint.trim()) {
      setTradeModalCandidate(null);
      setTradeModalMint(candOrMint.trim());
      setTradeModalSymbol(symbol || 'CUSTOM');
      setTradeModalPriceSol(priceSol);
      setTradeModalPriceUsd(priceUsd);
    } else {
      setTradeModalCandidate(null);
      setTradeModalMint('');
      setTradeModalSymbol('TOKEN');
      setTradeModalPriceSol(undefined);
      setTradeModalPriceUsd(undefined);
    }
    setRealTradeModalOpen(true);
  };

  // Mirror trade with real wallet funds
  const handleMirrorRealTrade = (pos: Position) => {
    setTradeModalCandidate(null);
    setTradeModalMint(pos.tokenMint);
    setTradeModalSymbol(pos.symbol);
    setTradeModalPriceSol(pos.currentPriceSol);
    setTradeModalPriceUsd(pos.currentPriceUsd);
    setRealTradeModalOpen(true);
  };

  // Update risk limits
  const handleUpdateRisk = async (newLimits: Partial<RiskLimits>) => {
    try {
      const res = await fetch('/api/risk/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLimits),
      });
      const data = await res.json();
      if (data.riskLimits) setRiskLimits(data.riskLimits);
    } catch (err) {
      console.error('Risk update error', err);
    }
  };

  // Update weights
  const handleUpdateWeights = async (newWeights: Partial<StrategyWeights>) => {
    try {
      const res = await fetch('/api/weights/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWeights),
      });
      const data = await res.json();
      if (data.weights) setWeights(data.weights);
    } catch (err) {
      console.error('Weights update error', err);
    }
  };

  // Inspect record from audit log
  const handleInspectRecord = (record: TradeDecisionRecord) => {
    // Construct lightweight candidate representation for explainability modal
    const mockCandidate: CandidateTokenState = {
      metadata: {
        mint: record.tokenMint,
        name: record.symbol,
        symbol: record.symbol,
        creator: 'AuditCreator',
        created_at: record.timestamp,
        poolAddress: 'Pool_' + record.tokenMint.slice(0, 6),
        launchVenue: 'PUMPFUN' as any,
        baseAsset: record.symbol,
        quoteAsset: 'SOL',
        initialLiquiditySol: record.liquiditySol,
        initialLiquidityUsd: record.liquiditySol * 155,
        initialPriceSol: record.executionResult.expectedPriceSol,
        initialPriceUsd: record.executionResult.expectedPriceSol * 155,
        currentPriceUsd: record.executionResult.actualPriceSol * 155,
        tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        signature: record.executionResult.txSignature,
        poolCreationTx: 'InitTx_' + record.symbol,
      },
      safety: {
        isTradable: record.decision === DecisionAction.BUY,
        safetyScore: record.safetyScore,
        riskLevel: record.safetyScore >= 80 ? ('LOW' as any) : ('HIGH' as any),
        rejectReasons: record.decision === DecisionAction.BUY ? [] : record.decisionReasons,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        lpBurnOrLocked: true,
        lpBurnPct: 100,
        tokenProgramSafe: true,
        suspiciousExtensions: [],
        supplyAnomalies: false,
        top1Percent: 8.5,
        top5Percent: 22.0,
        top10Percent: 39.0,
        creatorOwnershipPercent: 1.5,
        insiderClusterDetected: false,
        bundledWalletsDetected: 0,
        washTradingDetected: false,
        creatorDumpRisk: false,
      },
      micro: {
        priceSol: record.executionResult.actualPriceSol,
        priceUsd: record.executionResult.actualPriceSol * 155,
        volumeSol: 15.0,
        buyVolumeSol: 11.2,
        sellVolumeSol: 3.8,
        buySellRatio: 2.9,
        liquiditySol: record.liquiditySol,
        liquidityUsd: record.liquiditySol * 155,
        marketCapUsd: record.liquiditySol * 155 * 2.5,
        priceVelocity: 4.2,
        volumeVelocity: 0.85,
        uniqueBuyers: 28,
        uniqueSellers: 8,
        newWalletRate: 0.35,
        liquidityChangePct: 2.5,
        holderGrowth: 14.5,
        largeWalletActivityCount: 2,
        windows: {
          '1s': { priceChangePct: 1.2, volumeSol: 0.5, buyVolumeSol: 0.4, sellVolumeSol: 0.1, buySellRatio: 4.0, tradeCount: 4, uniqueBuyers: 3, uniqueSellers: 1, netFlowSol: 0.3 },
          '3s': { priceChangePct: 3.4, volumeSol: 1.5, buyVolumeSol: 1.2, sellVolumeSol: 0.3, buySellRatio: 4.0, tradeCount: 11, uniqueBuyers: 8, uniqueSellers: 3, netFlowSol: 0.9 },
          '5s': { priceChangePct: 4.8, volumeSol: 2.8, buyVolumeSol: 2.2, sellVolumeSol: 0.6, buySellRatio: 3.6, tradeCount: 19, uniqueBuyers: 14, uniqueSellers: 5, netFlowSol: 1.6 },
          '10s': { priceChangePct: 8.2, volumeSol: 5.5, buyVolumeSol: 4.2, sellVolumeSol: 1.3, buySellRatio: 3.2, tradeCount: 34, uniqueBuyers: 22, uniqueSellers: 7, netFlowSol: 2.9 },
          '30s': { priceChangePct: 14.5, volumeSol: 12.0, buyVolumeSol: 9.0, sellVolumeSol: 3.0, buySellRatio: 3.0, tradeCount: 68, uniqueBuyers: 38, uniqueSellers: 12, netFlowSol: 6.0 },
          '60s': { priceChangePct: 18.0, volumeSol: 15.0, buyVolumeSol: 11.2, sellVolumeSol: 3.8, buySellRatio: 2.9, tradeCount: 92, uniqueBuyers: 45, uniqueSellers: 16, netFlowSol: 7.4 },
        },
      },
      opportunity: {
        opportunityScore: record.opportunityScore,
        confidencePct: 78,
        expectedReturnPct: record.expectedEdgePct,
        expectedLossPct: 12,
        expectedSlippagePct: record.expectedSlippagePct,
        rugProbabilityPct: 8,
        executionProbabilityPct: 92,
        components: {
          liquidityQuality: 0.85,
          buyPressure: 0.90,
          volumeAcceleration: 0.78,
          holderGrowth: 0.80,
          walletQuality: 0.82,
          priceStructure: 0.75,
          launchQuality: 0.80,
          socialSignal: 0.70,
          slippageDeduction: 0.12,
          concentrationRisk: 0.15,
          rugProbability: 0.08,
          executionRisk: 0.10,
        },
      },
      executionPreCheck: {
        tokenMint: record.tokenMint,
        expectedFillPriceSol: record.executionResult.expectedPriceSol,
        expectedFillPriceUsd: record.executionResult.expectedPriceSol * 155,
        priceImpactPct: 0.8,
        expectedSlippagePct: record.expectedSlippagePct,
        priorityFeeMicroLamports: 150_000,
        networkFeeSol: 0.00005,
        jitoTipSol: 0.0015,
        mevRisk: 'LOW',
        simulationSuccess: true,
        justifiesEdge: true,
        netExpectedEdgePct: record.expectedEdgePct - record.expectedSlippagePct,
      },
      detected_at: record.latencyBreakdown.detected_at,
      parsed_at: record.latencyBreakdown.parsed_at,
      scored_at: record.latencyBreakdown.scored_at,
      decision_at: record.latencyBreakdown.decision_at,
      decision: record.decision,
      decisionReasons: record.decisionReasons,
      recentWallets: [],
    };

    setInspectedCandidate(mockCandidate);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Bar Navigation & Emergency Controls */}
      <Header
        config={config}
        circuitBreakerActive={riskLimits.circuitBreakerActive}
        onSetMode={handleSetMode}
        onEmergencyStop={handleEmergencyStop}
        onOpenWallet={() => setActiveTab('REAL_WALLET')}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col">
        {/* Quantitative Portfolio KPI Cards (Live vs Paper Dual View) */}
        <PortfolioOverview
          portfolio={portfolio}
          livePortfolio={livePortfolio}
          riskLimits={riskLimits}
          walletConfig={walletConfig}
          onOpenWallet={() => setActiveTab('REAL_WALLET')}
        />

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 border-b border-zinc-800 mb-5 overflow-x-auto pb-1 text-xs font-mono">
          <button
            onClick={() => setActiveTab('GROK_BOT')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition border-b-2 font-semibold ${
              activeTab === 'GROK_BOT'
                ? 'border-amber-400 text-amber-300 bg-zinc-900/90 shadow-sm'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>Grok Bot (Synthetic Demo)</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              Simulation
            </span>
          </button>

          <button
            onClick={() => setActiveTab('REAL_WALLET')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition border-b-2 font-semibold ${
              activeTab === 'REAL_WALLET'
                ? 'border-emerald-400 text-emerald-300 bg-zinc-900/90 shadow-sm'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Real Wallet / Phantom</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
              Solana Live
            </span>
          </button>

          <button
            onClick={() => setActiveTab('MONITOR')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition border-b-2 font-semibold ${
              activeTab === 'MONITOR'
                ? 'border-emerald-400 text-emerald-300 bg-zinc-900/90'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Live Monitor</span>
            {activePositions.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-zinc-950 text-[10px] font-bold">
                {activePositions.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('ALPHA_AUDIT')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition border-b-2 font-semibold ${
              activeTab === 'ALPHA_AUDIT'
                ? 'border-emerald-400 text-emerald-300 bg-zinc-900/90'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Alpha Validation Audit</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
              Synthetic
            </span>
          </button>

          <button
            onClick={() => setActiveTab('BACKTEST')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition border-b-2 font-semibold ${
              activeTab === 'BACKTEST'
                ? 'border-purple-400 text-purple-300 bg-zinc-900/90'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Backtest (Synthetic Demo)</span>
          </button>

          <button
            onClick={() => setActiveTab('RISK_TUNING')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition border-b-2 font-semibold ${
              activeTab === 'RISK_TUNING'
                ? 'border-indigo-400 text-indigo-300 bg-zinc-900/90'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Risk Gates &amp; Weights</span>
          </button>

          <button
            onClick={() => setActiveTab('AUDIT_LOG')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition border-b-2 font-semibold ${
              activeTab === 'AUDIT_LOG'
                ? 'border-cyan-400 text-cyan-300 bg-zinc-900/90'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Explainability Audit Trail</span>
          </button>
        </div>

        {/* Tab Views */}
        <div className="flex-1 flex flex-col">
          {['GROK_BOT', 'BACKTEST', 'ALPHA_AUDIT', 'RISK_TUNING'].includes(activeTab) && (
            <div className="mb-4 p-3 border border-amber-500/40 bg-amber-950/30 text-amber-200 text-sm">
              Research/demo only. Synthetic histories and heuristic models are not real performance, calibrated probabilities, or evidence of profitability. Live entries use the separate observed-launch confirmation gate.
            </div>
          )}
          {activeTab === 'GROK_BOT' && <GrokBotStudio />}

          {activeTab === 'REAL_WALLET' && <WalletAutotradeStudio />}

          {activeTab === 'MONITOR' && (
            <div className="flex flex-col flex-1">
              {/* Real Money Execution Controls & Status Banner */}
              <LiveMonitorTradeBanner
                currentSystemMode={config.mode}
                onSetSystemMode={handleSetMode}
                walletConfig={walletConfig}
                onOpenRealTradeModal={handleOpenRealTradeModal}
                onNavigateToWallet={() => setActiveTab('REAL_WALLET')}
              />

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
                {/* Left Column (7 cols): Real-Time Ingestion Stream & Position Manager */}
                <div className="lg:col-span-7 flex flex-col gap-5">
                  <ActivePositions
                    positions={activePositions}
                    closedPositions={closedPositions}
                    onManualClose={handleManualClosePosition}
                    onTradeExit={handleTradeExit}
                    onOneClickExit={handleOneClickExit}
                    onNewRealTrade={() => handleOpenRealTradeModal()}
                  />
                  <LiveScanner
                    feedStatus={feedStatus}
                    candidates={candidates}
                    onSelectCandidate={(cand) => {
                      setInspectedCandidate(cand);
                      setSelectedMicroCandidate(cand);
                    }}
                    onRealBuy={handleOpenRealTradeModal}
                    onOneClickEnroll={handleOneClickEnroll}
                  />
                </div>

                {/* Right Column (5 cols): Microstructure Analytics & Flow */}
                <div className="lg:col-span-5 flex flex-col gap-5">
                  <MicrostructureViewer
                    candidate={selectedMicroCandidate || (candidates[0] ?? null)}
                    onRealBuy={handleOpenRealTradeModal}
                  />
                  <AuditTrail
                    records={tradeHistory}
                    onInspectRecord={handleInspectRecord}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ALPHA_AUDIT' && <AlphaAuditStudio />}

          {activeTab === 'BACKTEST' && <BacktestStudio />}

          {activeTab === 'RISK_TUNING' && (
            <RiskControls
              currentLimits={riskLimits}
              currentWeights={weights}
              onUpdateRisk={handleUpdateRisk}
              onUpdateWeights={handleUpdateWeights}
            />
          )}

          {activeTab === 'AUDIT_LOG' && (
            <div className="flex-1">
              <AuditTrail
                records={tradeHistory}
                onInspectRecord={handleInspectRecord}
              />
            </div>
          )}
        </div>
      </main>

      {/* Explainability / Safety Inspector Modal */}
      {inspectedCandidate && (
        <ExplainabilityModal
          candidate={inspectedCandidate}
          onClose={() => setInspectedCandidate(null)}
          onRealBuy={handleOpenRealTradeModal}
        />
      )}

      {/* Real Money Trade Execution Order Modal */}
      <RealTradeOrderModal
        isOpen={realTradeModalOpen}
        onClose={() => setRealTradeModalOpen(false)}
        candidate={tradeModalCandidate}
        initialMint={tradeModalMint}
        initialSymbol={tradeModalSymbol}
        initialPriceSol={tradeModalPriceSol}
        initialPriceUsd={tradeModalPriceUsd}
        walletConfig={walletConfig}
        onOpenWalletSettings={() => {
          setRealTradeModalOpen(false);
          setActiveTab('REAL_WALLET');
        }}
        onSuccess={() => {
          fetchState();
        }}
      />
    </div>
  );
};

export default App;
