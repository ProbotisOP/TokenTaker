import { Connection, PublicKey } from '@solana/web3.js';
import {
  CandidateTokenState, DecisionAction, ExecutionPreCheck, LaunchVenue, PortfolioState,
  Position, RiskLevel, RiskLimits, StrategyWeights, SystemMode, TokenSafetyReport, TradeDecisionRecord,
} from '../types.ts';
import { DEFAULT_RISK_LIMITS, DEFAULT_STRATEGY_WEIGHTS, DEFAULT_SYSTEM_CONFIG, SystemConfig } from './config.ts';
import { TradingStateStore } from './tradingStateStore.ts';
import { EarlyEntryEngine } from './earlyEntryEngine.ts';
import { createEntryExecutionGuard, type SignalExecutionGuard } from './entryExecutionGuard.ts';
import { ExitEngine } from './exitEngine.ts';
import { MicrostructureEngine, SwapTick } from './microstructureEngine.ts';
import { RiskEngine } from './riskEngine.ts';
import { SafetyEngine } from './safetyEngine.ts';
import { ScoringEngine } from './scoringEngine.ts';
import { WalletIntelligence } from './walletIntelligence.ts';
import { WalletManager } from './walletManager.ts';
import { LaunchEvent, LiveTokenFeedService } from './liveTokenFeed.ts';
import { LaunchInspection, LaunchInspector } from './launchInspector.ts';
import { JupiterService, SOL_MINT } from './jupiterService.ts';
import { getOnChainTokenDecimals, lamportsToSol, toTokenBaseUnits } from './decimalSafeUtils.ts';

export type { CandidateTokenState } from '../types.ts';

interface ObservedLaunch {
  event: LaunchEvent;
  entry: EarlyEntryEngine;
  micro: MicrostructureEngine;
  inspection?: LaunchInspection;
  nextInspectionAt: number;
  inspecting: boolean;
  attempted: boolean;
}

const unknownSafety = (reason: string): TokenSafetyReport => ({
  safetyScore: 0, riskLevel: RiskLevel.CRITICAL, rejectReasons: [reason], isTradable: false,
  mintAuthorityRevoked: false, freezeAuthorityRevoked: false, lpBurnOrLocked: false, lpBurnPct: 0,
  tokenProgramSafe: false, suspiciousExtensions: [], supplyAnomalies: false,
  top1Percent: 100, top5Percent: 100, top10Percent: 100, creatorOwnershipPercent: 100,
  insiderClusterDetected: false, bundledWalletsDetected: 0, washTradingDetected: false, creatorDumpRisk: false,
});

const emptyPrecheck = (mint: string): ExecutionPreCheck => ({
  tokenMint: mint, expectedFillPriceSol: 0, expectedFillPriceUsd: 0, priceImpactPct: 0,
  expectedSlippagePct: 0, priorityFeeMicroLamports: 0, networkFeeSol: 0, jitoTipSol: 0,
  mevRisk: 'HIGH', simulationSuccess: false, simulationError: 'No executable round-trip quote checked',
  justifiesEdge: false, netExpectedEdgePct: 0,
});

export class EngineCoordinator {
  private static instance: EngineCoordinator;
  public config: SystemConfig = { ...DEFAULT_SYSTEM_CONFIG };
  public riskLimits: RiskLimits = { ...DEFAULT_RISK_LIMITS };
  public weights: StrategyWeights = { ...DEFAULT_STRATEGY_WEIGHTS };
  public portfolio: PortfolioState = {
    cashSol: 0, equitySol: 0, activeExposureSol: 0, dailyRealizedPnlSol: 0, totalRealizedPnlSol: 0,
    unrealizedPnlSol: 0, peakEquitySol: 0, currentDrawdownPct: 0, maxDrawdownPct: 0,
    consecutiveLosses: 0, rollingWinRate: 0, rollingExpectancySol: 0, profitFactor: 0,
    tradeCount: 0, adaptiveMultiplier: 1,
  };
  public candidateTokens: CandidateTokenState[] = [];
  public activePositions: Position[] = [];
  public closedPositions: Position[] = [];
  public tradeHistory: TradeDecisionRecord[] = [];
  private observed = new Map<string, ObservedLaunch>();
  private loop?: NodeJS.Timeout;
  private pricePoll?: NodeJS.Timeout;
  private isPollingPrices = false;
  private pendingExits = new Set<string>();
  private inspectionCount = 0;
  private feed: LiveTokenFeedService;
  private inspector: Pick<LaunchInspector, 'inspect'>;
  private stateStore?: TradingStateStore;
  private settledSignatures = new Set<string>();

  constructor(options: { autoStart?: boolean; feed?: LiveTokenFeedService; inspector?: Pick<LaunchInspector, 'inspect'> } = {}) {
    if (options.autoStart !== false) {
      this.stateStore = new TradingStateStore();
      const saved = this.stateStore.load();
      if (saved) {
        this.activePositions = saved.activePositions;
        this.closedPositions = saved.closedPositions;
        this.portfolio = saved.portfolio;
        this.riskLimits = saved.riskLimits;
        this.settledSignatures = new Set(saved.settledSignatures);
        for (const signature of this.settledSignatures) JupiterService.acknowledgeSettlement(signature);
      }
    }
    this.feed = options.feed ?? LiveTokenFeedService.getInstance();
    this.inspector = options.inspector ?? new LaunchInspector(process.env.SOLANA_RPC_URL || this.config.rpcEndpoint);
    this.feed.onLaunch(event => this.ingestNewTokenLaunch(event));
    this.feed.onTrade((mint, tick) => this.ingestTrade(mint, tick));
    this.feed.onGap(reason => {
      for (const state of this.observed.values()) state.entry.invalidate(reason);
      this.evaluateCandidates();
    });
    if (options.autoStart !== false) {
      this.feed.start();
      this.loop = setInterval(() => {
        this.evaluateCandidates();
        this.scheduleInspections();
        this.tickPositions();
      }, 500);
      this.pricePoll = setInterval(() => { void this.pollLivePricesForActivePositions(); }, 2000);
      this.loop.unref();
      this.pricePoll.unref();
    }
  }

  static getInstance(): EngineCoordinator { return this.instance ??= new EngineCoordinator(); }
  stop(): void { clearInterval(this.loop); clearInterval(this.pricePoll); this.feed.stop(); }
  getFeedStatus() { return this.feed.getStatus(); }

  persistSettlement(signature: string): void {
    if (!this.stateStore) throw new Error('Durable accounting unavailable; settlement requires reconciliation');
    this.settledSignatures.add(signature);
    this.persistState();
  }

  persistState(): void {
    this.stateStore?.save({ version: 1, activePositions: this.activePositions, closedPositions: this.closedPositions,
      portfolio: this.portfolio, riskLimits: this.riskLimits, settledSignatures: [...this.settledSignatures] });
  }

  async triggerEmergencyStop(reason = 'Manual operator emergency stop'): Promise<void> {
    this.config.mode = SystemMode.EMERGENCY_STOP;
    this.riskLimits.circuitBreakerActive = true;
    this.riskLimits.circuitBreakerReason = reason;
    this.persistState();
    const wm = WalletManager.getInstance();
    await wm.triggerKillSwitch(reason);
  }

  setMode(mode: SystemMode): { success: boolean; message: string } {
    if (mode === SystemMode.LIVE && process.env.ENABLE_LIVE_TRADING !== 'true') {
      return { success: false, message: 'Live execution is disabled by the server interlock' };
    }
    this.config.mode = mode;
    // Changing display mode never clears a risk or wallet circuit breaker.
    return { success: true, message: `System mode transitioned to ${mode}` };
  }

  updateRiskLimits(newLimits: Partial<RiskLimits>): void {
    for (const [key, value] of Object.entries(newLimits)) {
      if (key === 'circuitBreakerActive' || key === 'circuitBreakerReason') continue;
      if (!(key in this.riskLimits) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Invalid risk limit: ${key}`);
      if (['maxPositionPercent', 'maxTokenExposurePercent'].includes(key) && value > 1) throw new Error('Allocation fractions must not exceed 1');
      if (['maxOpenPositions', 'maxConsecutiveLosses'].includes(key) && !Number.isInteger(value)) throw new Error('Count limits must be integers');
    }
    const { circuitBreakerActive, circuitBreakerReason, ...numericLimits } = newLimits;
    this.riskLimits = { ...this.riskLimits, ...numericLimits };
  }

  updateWeights(newWeights: Partial<StrategyWeights>): void {
    for (const [key, value] of Object.entries(newWeights)) {
      if (!(key in this.weights) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid strategy weight: ${key}`);
    }
    this.weights = { ...this.weights, ...newWeights };
  }

  ingestNewTokenLaunch(event: LaunchEvent): CandidateTokenState {
    const existing = this.candidateTokens.find(c => c.metadata.mint === event.mint);
    if (existing) return existing;
    const now = Date.now();
    const micro = new MicrostructureEngine(0, event.initialPriceSol);
    const state: ObservedLaunch = { event, micro, entry: new EarlyEntryEngine(event.initialPriceSol), nextInspectionAt: now, inspecting: false, attempted: false };
    if (event.unsupportedMode) state.entry.invalidate('Unsupported launch mode; no live entry');
    this.observed.set(event.mint, state);
    const candidate: CandidateTokenState = {
      metadata: {
        mint: event.mint, name: event.name, symbol: event.symbol, creator: event.creator, created_at: 0,
        poolAddress: event.poolAddress, launchVenue: LaunchVenue.PUMPFUN, baseAsset: event.symbol,
        quoteAsset: 'SOL', initialLiquiditySol: 0, initialLiquidityUsd: 0, initialPriceSol: event.initialPriceSol,
        initialPriceUsd: 0, currentPriceUsd: 0, tokenProgram: '', signature: event.signature, poolCreationTx: event.signature,
      },
      safety: unknownSafety('On-chain safety inspection pending'), micro: micro.getSnapshot(now),
      opportunity: this.score(micro, unknownSafety('Unknown'), now),
      executionPreCheck: emptyPrecheck(event.mint), detected_at: event.detectedAt,
      parsed_at: now, scored_at: now, decision_at: now, decision: DecisionAction.WAIT,
      decisionReasons: ['Waiting for real trade observations and on-chain inspection'], recentWallets: [],
      entryStage: 'EARLY_ACCUMULATION', dataSource: 'PUMPPORTAL', executionStatus: 'NOT_SUBMITTED',
    };
    this.candidateTokens.unshift(candidate);
    if (this.candidateTokens.length > 100) {
      const removed = this.candidateTokens.pop()!;
      this.observed.delete(removed.metadata.mint);
    }
    this.evaluateCandidate(candidate, state, now);
    return candidate;
  }

  ingestTrade(mint: string, tick: SwapTick): void {
    const state = this.observed.get(mint);
    const candidate = this.candidateTokens.find(c => c.metadata.mint === mint);
    if (!state || !candidate || !state.entry.record(tick)) return;
    state.micro.recordTick(tick);
    const profile = WalletIntelligence.getOrCreateProfile(tick.traderWallet);
    candidate.recentWallets = [{ address: profile.address, category: profile.category, reputation: profile.reputationScore },
      ...candidate.recentWallets.filter(w => w.address !== profile.address)].slice(0, 30);
    if (!tick.isBuy && tick.traderWallet === candidate.metadata.creator) state.entry.invalidate('Creator selling observed');
    this.evaluateCandidate(candidate, state, Date.now());
  }

  async inspectCandidate(mint: string): Promise<void> {
    const state = this.observed.get(mint);
    const candidate = this.candidateTokens.find(c => c.metadata.mint === mint);
    if (!state || !candidate || state.inspecting) return;
    state.inspecting = true;
    this.inspectionCount++;
    try {
      const inspection = await this.inspector.inspect(state.event);
      state.inspection = inspection;
      state.entry.observePrice(inspection.priceSol);
      state.entry.recordInspection(inspection);
      candidate.metadata.created_at = inspection.createdAt;
      candidate.metadata.creator = inspection.creator;
      candidate.metadata.tokenProgram = inspection.tokenProgram;
      candidate.inspectedAt = inspection.checkedAt;
      state.micro.updateMarket({ priceSol: inspection.priceSol, priceUsd: 0, liquiditySol: inspection.liquiditySol }, inspection.checkedAt);
      candidate.safety = SafetyEngine.evaluate({
        metadata: candidate.metadata, mintAuthorityRevoked: inspection.mintAuthorityRevoked,
        freezeAuthorityRevoked: inspection.freezeAuthorityRevoked, lpBurnPct: 0, tokenProgram: inspection.tokenProgram,
        hasSuspiciousExtensions: false, suspiciousExtensions: [], supplyAnomalies: false,
        top1Percent: inspection.top1Pct, top5Percent: inspection.top5Pct, top10Percent: inspection.top10Pct,
        creatorOwnershipPercent: inspection.creatorOwnershipPct, insiderClusterDetected: false,
        bundledWalletsDetected: 0, washTradingDetected: false, creatorDumpRisk: false,
        liquiditySol: inspection.liquiditySol, minLiquiditySol: this.config.minLiquiditySol, marketCapUsd: 0,
        marketCapSol: inspection.supplyTokens * inspection.priceSol,
        verifiedActiveCurve: inspection.curveVerified && !inspection.complete && inspection.reasons.length === 0,
        poolAgeSec: Math.max(0, (Date.now() - inspection.createdAt) / 1000),
      });
      // LP shares do not exist on an active Pump curve. Eligibility is established by its verified PDA/state, not an invented burn percentage.
      if (!inspection.curveVerified || inspection.complete || inspection.reasons.length) {
        candidate.safety = unknownSafety(inspection.reasons.join('; ') || 'Curve custody unavailable or migrated');
      }
      candidate.curveVerified = inspection.curveVerified && !inspection.complete;
      if (!inspection.mintAuthorityRevoked || !inspection.freezeAuthorityRevoked || inspection.complete) {
        state.entry.invalidate('Active token authority or completed/migrated curve');
      }
      candidate.inspectionError = undefined;
    } catch (error) {
      state.inspection = undefined;
      candidate.inspectionError = error instanceof Error ? error.message : 'Inspection failed';
      candidate.safety = unknownSafety(candidate.inspectionError);
    } finally {
      state.inspecting = false;
      state.nextInspectionAt = Date.now() + 5_000;
      this.inspectionCount--;
      this.evaluateCandidate(candidate, state, Date.now());
    }
  }

  private scheduleInspections(): void {
    if (this.config.mode === SystemMode.EMERGENCY_STOP) return;
    for (const candidate of [...this.candidateTokens].reverse()) {
      if (this.inspectionCount >= 2) break;
      const state = this.observed.get(candidate.metadata.mint);
      if (state && !state.inspecting && state.nextInspectionAt <= Date.now() && !['REJECTED', 'EXPIRED', 'EXPANSION', 'EXTENDED', 'EXHAUSTED'].includes(candidate.entryStage || '')) {
        void this.inspectCandidate(candidate.metadata.mint);
      }
    }
  }

  evaluateCandidates(now = Date.now()): void {
    for (const candidate of this.candidateTokens) {
      const state = this.observed.get(candidate.metadata.mint);
      if (state) this.evaluateCandidate(candidate, state, now);
    }
  }

  private score(micro: MicrostructureEngine, safety: TokenSafetyReport, now: number) {
    const snapshot = micro.getSnapshot(now);
    const result = ScoringEngine.compute({
      metadata: {} as CandidateTokenState['metadata'], safety, micro: snapshot, walletQualityScore: 0,
      social: { mentionVelocity: 0, uniqueAccounts: 0, engagementVelocity: 0, sentimentScore: -1,
        influencerConcentration: 0, botProbability: 0, isCoordinatedPump: false, socialCapitalCorrelation: 0 }, weights: this.weights,
    });
    // No calibrated forecast exists for this strategy. These legacy UI fields must not advertise invented returns/probabilities.
    return { ...result, expectedReturnPct: 0, expectedLossPct: 0, rugProbabilityPct: 0, executionProbabilityPct: 0, confidencePct: 0 };
  }

  private evaluateCandidate(candidate: CandidateTokenState, state: ObservedLaunch, now: number): void {
    if (!state.inspection && now - state.event.detectedAt > 120_000) state.entry.invalidate('Launch inspection timed out; candidate expired');
    candidate.micro = state.micro.getSnapshot(now);
    candidate.opportunity = this.score(state.micro, candidate.safety, now);
    const evaluation = state.entry.evaluate({
      now, createdAt: state.inspection?.createdAt, inspectedAt: state.inspection?.checkedAt,
      safetyApproved: candidate.safety.isTradable && candidate.safety.safetyScore >= this.config.minSafetyScore,
      safetyReasons: candidate.safety.rejectReasons, liquiditySol: state.inspection?.liquiditySol ?? 0,
      creator: candidate.metadata.creator,
    });
    candidate.entryStage = evaluation.stage;
    candidate.entryMetrics = evaluation;
    candidate.scored_at = now;
    candidate.decision_at = now;
    candidate.decision = this.config.mode === SystemMode.EMERGENCY_STOP ? DecisionAction.REJECT : evaluation.decision;
    candidate.decisionReasons = this.config.mode === SystemMode.EMERGENCY_STOP ? ['SYSTEM EMERGENCY STOP ACTIVE'] : evaluation.reasons;
    if (candidate.decision === DecisionAction.BUY && this.config.mode === SystemMode.LIVE && !state.attempted) {
      state.attempted = true;
      void this.executeBuyOrder(candidate, state).catch(error => {
        candidate.executionStatus = 'BLOCKED';
        candidate.executionError = error instanceof Error ? error.message : 'Entry failed';
      });
    }
  }

  createSignalGuard(mint: string, autonomous = false): SignalExecutionGuard {
    const state = this.observed.get(mint);
    const candidate = this.candidateTokens.find(c => c.metadata.mint === mint);
    if (!state || !candidate) throw new Error('No observed launch signal for this token');
    if (candidate.metadata.launchVenue === LaunchVenue.PUMPFUN) throw new Error('Pump buys are disabled; a non-Pump discovery/inspection adapter is required');
    this.evaluateCandidate(candidate, state, Date.now());
    return createEntryExecutionGuard({
      initialPriceSol: state.event.initialPriceSol, evaluation: candidate.entryMetrics!, startedAt: Date.now(),
      validateSignal: () => {
        this.evaluateCandidate(candidate, state, Date.now());
        if (candidate.decision !== DecisionAction.BUY || this.config.mode !== SystemMode.LIVE || this.riskLimits.circuitBreakerActive ||
            (autonomous && WalletManager.getInstance().getConfig().autotradeMode !== 'FULL_AUTONOMOUS')) throw new Error('Signal expired or risk/mode changed before signing');
      },
    });
  }

  private async executeBuyOrder(candidate: CandidateTokenState, state: ObservedLaunch): Promise<void> {
    const wm = WalletManager.getInstance();
    const cfg = wm.getConfig();
    if (process.env.ENABLE_LIVE_TRADING !== 'true' || cfg.autotradeMode !== 'FULL_AUTONOMOUS' || this.config.mode !== SystemMode.LIVE || this.riskLimits.circuitBreakerActive) throw new Error('Autonomous live execution not armed');
    this.recalculatePortfolio();
    const risk = RiskEngine.evaluateAndSize({
      portfolio: this.portfolio, opportunity: { ...candidate.opportunity, expectedSlippagePct: 0 }, safety: candidate.safety,
      liquiditySol: candidate.micro.liquiditySol, openPositionsCount: this.activePositions.length,
      currentExposureSol: this.portfolio.activeExposureSol, riskLimits: this.riskLimits,
      gasReserveSol: cfg.gasReserveSol, minTradeSizeSol: cfg.minTradeSizeSol, targetTradeSizeSol: cfg.targetTradeSizeSol,
    });
    if (!risk.approved) throw new Error(risk.rejectReasons.join('; '));
    const guard = this.createSignalGuard(candidate.metadata.mint, true);
    candidate.executionStatus = 'CHECKING_ROUTE';
    await this.inspectCandidate(candidate.metadata.mint);
    this.evaluateCandidate(candidate, state, Date.now());
    if (candidate.decision !== DecisionAction.BUY || this.config.mode !== SystemMode.LIVE || this.riskLimits.circuitBreakerActive) throw new Error('Entry no longer confirmed after route checks');
    const result = await wm.executeSignalTrade({
      tokenMint: candidate.metadata.mint, symbol: candidate.metadata.symbol, name: candidate.metadata.name,
      priceSol: candidate.micro.priceSol, priceUsd: candidate.micro.priceUsd, signalSource: 'EARLY_CONFIRMED',
      signalScore: candidate.opportunity.opportunityScore, recommendedSizeSol: risk.recommendedSizeSol,
    }, guard);
    candidate.executionStatus = result.success ? 'CONFIRMED' : 'BLOCKED';
    candidate.executionError = result.error;
  }

  async pollLivePricesForActivePositions(): Promise<void> {
    if (this.isPollingPrices || !this.activePositions.length) return;
    this.isPollingPrices = true;
    try {
      const cfg = WalletManager.getInstance().getConfig();
      const connection = new Connection(cfg.rpcEndpoint, 'confirmed');
      await Promise.all(this.activePositions.filter(p => p.isRealWalletTrade).map(async pos => {
        try {
          const decimals = await getOnChainTokenDecimals(connection, new PublicKey(pos.tokenMint));
          const quote = await JupiterService.fetchQuote({ inputMint: pos.tokenMint, outputMint: SOL_MINT,
            amountLamports: pos.sizeBaseUnits ? BigInt(pos.sizeBaseUnits) : toTokenBaseUnits(pos.sizeTokens, decimals), slippageBps: Math.floor(cfg.maxSlippagePct * 100) });
          if (!quote.success || !quote.data) return;
          const value = lamportsToSol(quote.data.outAmount);
          if (!Number.isFinite(value) || value <= 0 || pos.sizeTokens <= 0) return;
          pos.currentPriceSol = value / pos.sizeTokens;
          pos.currentValueSol = value;
          pos.unrealizedPnlSol = value - pos.costBasisSol;
          pos.unrealizedPnlPct = pos.costBasisSol > 0 ? pos.unrealizedPnlSol / pos.costBasisSol * 100 : 0;
          pos.lastPriceAt = Date.now();
        } catch { /* Retain the last mark, but do not drive exits from stale prices. */ }
      }));
      this.recalculatePortfolio();
    } finally { this.isPollingPrices = false; }
  }

  tickPositions(): void {
    for (const pos of this.activePositions) {
      pos.holdingSec = (Date.now() - pos.enteredAt) / 1000;
      if (!pos.isRealWalletTrade || !pos.lastPriceAt || Date.now() - pos.lastPriceAt > 5000 || this.pendingExits.has(pos.id)) continue;
      const trailing = ExitEngine.updateTrailingStop(pos, pos.currentPriceSol);
      pos.trailingStopPriceSol = trailing.newTrailingPriceSol;
      pos.trailingActivated = trailing.trailingActivated;
      pos.peakPriceUsd = trailing.peakPriceUsd;
      pos.peakPriceSol = trailing.peakPriceSol;
      // Flow exits require real swaps. A price quote is not a swap or a liquidity observation.
      const state = this.observed.get(pos.tokenMint);
      const micro = state?.micro.getSnapshot() ?? new MicrostructureEngine(0, pos.currentPriceSol).getSnapshot();
      const exit = ExitEngine.evaluatePosition(pos, micro);
      if (!exit.shouldExit) continue;
      this.pendingExits.add(pos.id);
      void WalletManager.getInstance().oneClickExit({ positionId: pos.id,
        pctToExit: exit.action === 'FULL_EXIT' ? 100 : exit.pctToSell, reason: exit.reason, tierIndex: exit.tierIndex,
      }).catch(error => console.error('[Coordinator] Exit failed:', error.message)).finally(() => this.pendingExits.delete(pos.id));
    }
  }

  recalculatePortfolio(): void {
    const cfg = WalletManager.getInstance().getConfig();
    if (cfg.isConnected) this.portfolio.cashSol = cfg.balanceSol;
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const settlements = [...this.activePositions, ...this.closedPositions].filter(p => p.isRealWalletTrade)
      .flatMap(p => p.executionHistory.filter(e => e.action === 'SELL' || e.action === 'SCALE_OUT'));
    this.portfolio.dailyRealizedPnlSol = settlements.filter(e => e.timestamp >= midnight.getTime()).reduce((sum, e) => sum + e.pnlSol, 0);
    this.portfolio.totalRealizedPnlSol = settlements.reduce((sum, e) => sum + e.pnlSol, 0);
    const exposure = this.activePositions.reduce((sum, p) => sum + p.currentValueSol, 0);
    this.portfolio.activeExposureSol = exposure;
    this.portfolio.unrealizedPnlSol = this.activePositions.reduce((sum, p) => sum + p.unrealizedPnlSol, 0);
    this.portfolio.equitySol = this.portfolio.cashSol + exposure;
    this.portfolio.peakEquitySol = Math.max(this.portfolio.peakEquitySol, this.portfolio.equitySol);
    const dd = this.portfolio.peakEquitySol > 0 ? (1 - this.portfolio.equitySol / this.portfolio.peakEquitySol) * 100 : 0;
    this.portfolio.currentDrawdownPct = dd;
    this.portfolio.maxDrawdownPct = Math.max(this.portfolio.maxDrawdownPct, dd);
    if (this.portfolio.consecutiveLosses >= this.riskLimits.maxConsecutiveLosses || this.portfolio.dailyRealizedPnlSol <= -this.riskLimits.maxDailyLossSol) {
      this.riskLimits.circuitBreakerActive = true;
      this.riskLimits.circuitBreakerReason = 'Realized loss limit reached';
    }
  }
}
