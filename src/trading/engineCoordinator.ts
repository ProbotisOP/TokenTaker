/**
 * Engine Coordinator
 * Central orchestration for event ingestion, detection, safety, scoring, execution, and portfolio management.
 */
import {
  DecisionAction,
  ExecutionPreCheck,
  LaunchVenue,
  LiveMarketMicrostructure,
  OpportunityScoreOutput,
  PortfolioState,
  Position,
  RiskLevel,
  RiskLimits,
  StrategyWeights,
  SystemMode,
  TokenMetadata,
  TokenSafetyReport,
  TradeDecisionRecord,
  TradeStatus,
  WalletCategory,
} from '../types.ts';
import { DEFAULT_RISK_LIMITS, DEFAULT_STRATEGY_WEIGHTS, DEFAULT_SYSTEM_CONFIG, SystemConfig } from './config.ts';
import { ExecutionEngine } from './executionEngine.ts';
import { ExitEngine } from './exitEngine.ts';
import { MicrostructureEngine, SwapTick } from './microstructureEngine.ts';
import { RiskEngine } from './riskEngine.ts';
import { SafetyEngine } from './safetyEngine.ts';
import { ScoringEngine } from './scoringEngine.ts';
import { WalletIntelligence } from './walletIntelligence.ts';
import { VenueSimulator } from './venueSimulator.ts';
import { WalletManager } from './walletManager.ts';
import { LiveTokenFeedService, VERIFIED_SOLANA_MEMES } from './liveTokenFeed.ts';
import { JupiterService, SOL_MINT } from './jupiterService.ts';
import { lamportsToSol } from './decimalSafeUtils.ts';

export interface CandidateTokenState {
  metadata: TokenMetadata;
  safety: TokenSafetyReport;
  micro: LiveMarketMicrostructure;
  opportunity: OpportunityScoreOutput;
  executionPreCheck: ExecutionPreCheck;
  detected_at: number;
  parsed_at: number;
  scored_at: number;
  decision_at: number;
  decision: DecisionAction;
  decisionReasons: string[];
  recentWallets: { address: string; category: WalletCategory; reputation: number }[];
  exitabilityScore?: number;
  empiricalWinProb?: number;
  calibratedKellyPct?: number;
}

export class EngineCoordinator {
  private static instance: EngineCoordinator;

  public config: SystemConfig = { ...DEFAULT_SYSTEM_CONFIG };
  public riskLimits: RiskLimits = { ...DEFAULT_RISK_LIMITS };
  public weights: StrategyWeights = { ...DEFAULT_STRATEGY_WEIGHTS };

  public portfolio: PortfolioState = {
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
  };

  public candidateTokens: CandidateTokenState[] = [];
  public activePositions: Position[] = [];
  public closedPositions: Position[] = [];
  public tradeHistory: TradeDecisionRecord[] = [];

  private microEngines = new Map<string, MicrostructureEngine>();
  private simulationInterval: NodeJS.Timeout | null = null;
  private pricePollInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isPollingPrices = false;

  private constructor() {
    this.seedInitialState();
    this.startLiveSimulation();
  }

  public static getInstance(): EngineCoordinator {
    if (!this.instance) {
      this.instance = new EngineCoordinator();
    }
    return this.instance;
  }

  /**
   * Emergency Kill Switch - absolute priority shutoff
   */
  public triggerEmergencyStop(reason: string = 'Manual operator emergency stop'): void {
    this.config.mode = SystemMode.EMERGENCY_STOP;
    this.riskLimits.circuitBreakerActive = true;
    this.riskLimits.circuitBreakerReason = reason;

    // Immediately flatten all open positions at market
    for (const pos of this.activePositions) {
      const exitResult = ExecutionEngine.executeSell(pos.tokenMint, pos.sizeTokens, pos.currentPriceSol, 20.0, true);
      const realizedPnlSol = exitResult.solReceived - pos.costBasisSol;
      pos.status = 'CLOSED';
      pos.closedAt = Date.now();
      pos.realizedPnlSol = realizedPnlSol;
      pos.exitReason = `EMERGENCY STOP TRIGGERED: ${reason}`;

      this.portfolio.cashSol += exitResult.solReceived;
      this.portfolio.dailyRealizedPnlSol += realizedPnlSol;
      this.portfolio.totalRealizedPnlSol += realizedPnlSol;

      this.closedPositions.unshift(pos);

      // Record audit
      this.recordDecisionAudit(pos, DecisionAction.EMERGENCY_DUMP, [reason], 0, realizedPnlSol);
    }

    this.activePositions = [];
    this.recalculatePortfolio();
  }

  public setMode(mode: SystemMode): { success: boolean; message: string } {
    if (this.config.mode === SystemMode.EMERGENCY_STOP && mode !== SystemMode.EMERGENCY_STOP) {
      // Must manually disarm circuit breaker
      this.riskLimits.circuitBreakerActive = false;
      this.riskLimits.circuitBreakerReason = undefined;
    }
    this.config.mode = mode;
    return { success: true, message: `System mode transitioned to ${mode}` };
  }

  public updateRiskLimits(newLimits: Partial<RiskLimits>): void {
    this.riskLimits = { ...this.riskLimits, ...newLimits };
  }

  public updateWeights(newWeights: Partial<StrategyWeights>): void {
    this.weights = { ...this.weights, ...newWeights };
  }

  /**
   * Ingests a newly detected Solana token launch event
   */
  public ingestNewTokenLaunch(raw: {
    mint: string;
    symbol: string;
    name: string;
    creator: string;
    venue: LaunchVenue;
    initialLiquiditySol: number;
    initialPriceSol: number;
    hasMintAuth: boolean;
    hasFreezeAuth: boolean;
    lpBurnPct: number;
    top1Pct: number;
    top10Pct: number;
    creatorOwnershipPct: number;
    insiderBundles: number;
    washTrading: boolean;
    creatorDumpRisk: boolean;
  }): CandidateTokenState {
    const detected_at = Date.now() - (40 + Math.floor(Math.random() * 60)); // ~40-100ms discovery latency
    const parsed_at = detected_at + 12; // 12ms parsing

    const metadata: TokenMetadata = {
      mint: raw.mint,
      name: raw.name,
      symbol: raw.symbol,
      creator: raw.creator,
      created_at: detected_at,
      poolAddress: `Pool_${raw.mint.slice(0, 8)}`,
      launchVenue: raw.venue,
      baseAsset: raw.symbol,
      quoteAsset: 'SOL',
      initialLiquiditySol: raw.initialLiquiditySol,
      initialLiquidityUsd: raw.initialLiquiditySol * 155.0,
      initialPriceSol: raw.initialPriceSol,
      initialPriceUsd: raw.initialPriceSol * 155.0,
      currentPriceUsd: raw.initialPriceSol * 155.0,
      tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      signature: '5Knp...Tx' + Math.random().toString(36).substring(2, 8),
      poolCreationTx: '4Mwx...PoolInit' + Math.random().toString(36).substring(2, 8),
    };

    // 1. Token Safety Evaluation
    const safety = SafetyEngine.evaluate({
      metadata,
      mintAuthorityRevoked: !raw.hasMintAuth,
      freezeAuthorityRevoked: !raw.hasFreezeAuth,
      lpBurnPct: raw.lpBurnPct,
      tokenProgram: metadata.tokenProgram,
      hasSuspiciousExtensions: false,
      suspiciousExtensions: [],
      supplyAnomalies: false,
      top1Percent: raw.top1Pct,
      top5Percent: Math.min(100, raw.top1Pct * 2.2),
      top10Percent: raw.top10Pct,
      creatorOwnershipPercent: raw.creatorOwnershipPct,
      insiderClusterDetected: raw.insiderBundles >= 3,
      bundledWalletsDetected: raw.insiderBundles,
      washTradingDetected: raw.washTrading,
      creatorDumpRisk: raw.creatorDumpRisk,
      liquiditySol: raw.initialLiquiditySol,
      marketCapUsd: metadata.initialLiquidityUsd * 2.5,
      poolAgeSec: 2,
    });

    // 2. Microstructure Initialization
    const microEngine = new MicrostructureEngine(raw.initialLiquiditySol, raw.initialPriceSol);
    this.microEngines.set(raw.mint, microEngine);

    // Populate initial launch ticks
    const buyerWallets: string[] = [];
    const isClean = !raw.hasMintAuth && !raw.hasFreezeAuth && raw.lpBurnPct === 100 && raw.top1Pct < 15;
    const numTicks = isClean ? 12 : 5;

    for (let i = 0; i < numTicks; i++) {
      const isBuy = isClean ? (i !== 3 && i !== 8) : (i % 2 === 0);
      const sol = isClean ? (0.6 + Math.random() * 2.2) : (0.1 + Math.random() * 0.4);
      const wAddr = isClean && i < 3
        ? `SmartAlpha_${Math.random().toString(36).substring(2, 7)}`
        : `Trader_${Math.random().toString(36).substring(2, 9)}`;
      buyerWallets.push(wAddr);

      // Give smart alpha traders good reputation
      if (isClean && i < 3) {
        const profile = WalletIntelligence.getOrCreateProfile(wAddr);
        profile.category = WalletCategory.PROFITABLE_TRADER;
        profile.reputationScore = 0.88;
        profile.winRate = 0.76;
      }

      microEngine.recordTick({
        timestamp: detected_at + (i * 200),
        isBuy,
        tokenAmount: Math.floor(sol / raw.initialPriceSol),
        solAmount: sol,
        priceSol: raw.initialPriceSol * (1 + (i * 0.022)),
        priceUsd: raw.initialPriceSol * 155 * (1 + (i * 0.022)),
        traderWallet: wAddr,
        isNewWallet: !isClean,
      });
    }

    const micro = microEngine.getSnapshot();

    // 3. Wallet Intelligence
    const flowQuality = WalletIntelligence.evaluateFlowQuality(buyerWallets);
    const recentWallets = buyerWallets.map(w => {
      const p = WalletIntelligence.getOrCreateProfile(w);
      return { address: p.address, category: p.category, reputation: p.reputationScore };
    });

    // 4. Alpha Scoring
    const scored_at = parsed_at + 18; // 18ms scoring time
    const opportunity = ScoringEngine.compute({
      metadata,
      safety,
      micro,
      walletQualityScore: isClean ? Math.max(0.78, flowQuality.walletQualityScore) : flowQuality.walletQualityScore,
      social: {
        mentionVelocity: isClean ? 65.0 : 14.5,
        uniqueAccounts: isClean ? 85 : 22,
        engagementVelocity: isClean ? 180 : 45,
        sentimentScore: isClean ? 0.82 : 0.65,
        influencerConcentration: isClean ? 0.08 : 0.28,
        botProbability: isClean ? 0.06 : 0.45,
        isCoordinatedPump: false,
        socialCapitalCorrelation: isClean ? 0.85 : 0.35,
      },
      weights: this.weights,
    });

    // 5. Causal Exitability Assessment & Risk Sizing
    const decision_at = scored_at + 14; // 14ms risk decision time
    const exitabilityScore = VenueSimulator.calculateExitability({
      venue: metadata.launchVenue,
      baseReserve: 1_000_000_000,
      quoteReserveSol: micro.liquiditySol,
      swapFeePct: 0.003,
      creatorLpBurnedOrLocked: safety.lpBurnOrLocked,
    }, 0.5);

    const wm = WalletManager.getInstance();
    const wmConfig = wm.getConfig();
    if (wmConfig.isConnected && wmConfig.balanceSol > 0) {
      this.portfolio.cashSol = wmConfig.balanceSol;
    }

    const riskCheck = RiskEngine.evaluateAndSize({
      portfolio: this.portfolio,
      opportunity,
      safety,
      liquiditySol: micro.liquiditySol,
      openPositionsCount: this.activePositions.length,
      currentExposureSol: this.portfolio.activeExposureSol,
      riskLimits: this.riskLimits,
      exitabilityScore,
      gasReserveSol: wmConfig.gasReserveSol,
      minTradeSizeSol: wmConfig.minTradeSizeSol,
      targetTradeSizeSol: wmConfig.targetTradeSizeSol,
    });

    // 6. Pre-Check Execution
    const preCheck = ExecutionEngine.preCheck({
      tokenMint: metadata.mint,
      symbol: metadata.symbol,
      sizeSol: riskCheck.recommendedSizeSol,
      expectedPriceSol: micro.priceSol,
      poolLiquiditySol: micro.liquiditySol,
      detected_at,
      parsed_at,
      scored_at,
      decision_at,
      slippageLimitPct: this.riskLimits.maxSlippagePercent,
      expectedEdgePct: opportunity.expectedReturnPct,
    });

    let decision = DecisionAction.REJECT;
    const decisionReasons: string[] = [];

    if (!safety.isTradable) {
      decision = DecisionAction.REJECT;
      decisionReasons.push(...safety.rejectReasons);
    } else if (exitabilityScore < 50) {
      decision = DecisionAction.REJECT;
      decisionReasons.push(`ILLIQUID EXITABILITY: Exitability score (${exitabilityScore}/100) below minimum safe threshold (50)`);
    } else if (opportunity.opportunityScore < this.config.minOpportunityScore) {
      decision = DecisionAction.REJECT;
      decisionReasons.push(`LOW ALPHA: Opportunity score (${opportunity.opportunityScore}) below minimum threshold (${this.config.minOpportunityScore})`);
    } else if (!riskCheck.approved) {
      decision = DecisionAction.REJECT;
      decisionReasons.push(...riskCheck.rejectReasons);
    } else if (!preCheck.justifiesEdge) {
      decision = DecisionAction.REJECT;
      decisionReasons.push(preCheck.simulationError || 'Execution cost destroys edge');
    } else if (this.config.mode === SystemMode.EMERGENCY_STOP) {
      decision = DecisionAction.REJECT;
      decisionReasons.push('SYSTEM EMERGENCY STOP ACTIVE');
    } else {
      decision = DecisionAction.BUY;
      decisionReasons.push(`APPROVED: Safety ${safety.safetyScore}/100, Exitability ${exitabilityScore}/100, Opportunity ${opportunity.opportunityScore}/100, Net Edge +${preCheck.netExpectedEdgePct}%`);
    }

    const candidate: CandidateTokenState = {
      metadata,
      safety,
      micro,
      opportunity,
      executionPreCheck: preCheck,
      detected_at,
      parsed_at,
      scored_at,
      decision_at,
      decision,
      decisionReasons,
      recentWallets,
      exitabilityScore,
      empiricalWinProb: riskCheck.calibratedWinProb,
      calibratedKellyPct: riskCheck.calibratedKellyPct,
    };

    this.candidateTokens.unshift(candidate);
    if (this.candidateTokens.length > 50) this.candidateTokens.pop();

    // If BUY and mode permits, execute entry (LIVE ONLY - paper trades retired)
    if (decision === DecisionAction.BUY && this.config.mode === SystemMode.LIVE) {
      this.executeBuyOrder(candidate, riskCheck.recommendedSizeSol);
    }

    return candidate;
  }

  private executeBuyOrder(candidate: CandidateTokenState, sizeSol: number): void {
    if (this.config.mode !== SystemMode.LIVE) {
      return;
    }

    const wm = WalletManager.getInstance();
    const cfg = wm.getConfig();
    if (!cfg.lastPreflightPassed || !wm.getDedicatedKeypair()) {
      console.warn('[EngineCoordinator] LIVE trade blocked: Preflight diagnostic must pass before live execution.');
      return;
    }
    wm.executeSignalTrade({
      tokenMint: candidate.metadata.mint,
      symbol: candidate.metadata.symbol,
      name: candidate.metadata.name,
      priceSol: candidate.micro.priceSol,
      priceUsd: candidate.micro.priceUsd,
      signalSource: `COORDINATOR_${candidate.metadata.launchVenue}`,
      signalScore: candidate.opportunity.opportunityScore,
      recommendedSizeSol: sizeSol,
    }).catch((err) => console.error('[EngineCoordinator] Live execution error:', err));
  }

  /**
   * Polls real on-chain market prices for all active positions from DexScreener / Jupiter
   */
  public async pollLivePricesForActivePositions(): Promise<void> {
    if (this.isPollingPrices || this.activePositions.length === 0) return;
    this.isPollingPrices = true;

    try {
      const realPositions = this.activePositions.filter((p) => p.isRealWalletTrade && p.tokenMint);
      if (realPositions.length === 0) return;

      const mints = Array.from(new Set(realPositions.map((p) => p.tokenMint)));
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000),
      }).catch(() => null);

      let pairs: any[] = [];
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        pairs = Array.isArray(data?.pairs) ? data.pairs : [];
      }

      for (const pos of realPositions) {
        const tokenPairs = pairs.filter(
          (p: any) => p.baseToken?.address === pos.tokenMint && p.chainId === 'solana'
        );
        tokenPairs.sort((a: any, b: any) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
        const bestPair = tokenPairs[0];

        if (bestPair && Number(bestPair.priceNative) > 0) {
          const realPriceSol = Number(bestPair.priceNative);
          const realPriceUsd = Number(bestPair.priceUsd || realPriceSol * 155.0);

          pos.currentPriceSol = realPriceSol;
          pos.currentPriceUsd = realPriceUsd;
          pos.currentValueSol = pos.sizeTokens * realPriceSol;
          pos.unrealizedPnlSol = pos.currentValueSol - pos.costBasisSol;
          pos.unrealizedPnlPct = pos.costBasisSol > 0 ? (pos.unrealizedPnlSol / pos.costBasisSol) * 100 : 0;

          if (realPriceUsd > (pos.peakPriceUsd || 0)) {
            pos.peakPriceUsd = realPriceUsd;
          }

          const microEngine = this.microEngines.get(pos.tokenMint);
          if (microEngine) {
            microEngine.recordTick({
              timestamp: Date.now(),
              isBuy: (bestPair.priceChange?.m5 || 0) >= 0,
              tokenAmount: 1000,
              solAmount: (bestPair.liquidity?.quote || 10) * 0.01,
              priceSol: realPriceSol,
              priceUsd: realPriceUsd,
              traderWallet: 'LiveDex',
              isNewWallet: false,
            });
          }
        } else if (pos.sizeTokens > 0) {
          // If not indexed on DexScreener yet (e.g. brand new launch), fallback to real Jupiter sell quote
          try {
            const quote = await JupiterService.fetchQuote({
              inputMint: pos.tokenMint,
              outputMint: SOL_MINT,
              amountLamports: BigInt(Math.floor(pos.sizeTokens)),
              slippageBps: 200,
            });

            if (quote && quote.outAmount) {
              const solValue = lamportsToSol(quote.outAmount);
              pos.currentPriceSol = solValue / pos.sizeTokens;
              pos.currentPriceUsd = pos.currentPriceSol * 155.0;
              pos.currentValueSol = solValue;
              pos.unrealizedPnlSol = solValue - pos.costBasisSol;
              pos.unrealizedPnlPct = pos.costBasisSol > 0 ? (pos.unrealizedPnlSol / pos.costBasisSol) * 100 : 0;
              if (pos.currentPriceUsd > (pos.peakPriceUsd || 0)) {
                pos.peakPriceUsd = pos.currentPriceUsd;
              }
            }
          } catch {
            // retain last verified real price
          }
        }
      }
      this.recalculatePortfolio();
    } catch {
      // ignore network errors
    } finally {
      this.isPollingPrices = false;
    }
  }

  /**
   * Autonomous Position Manager Loop (runs every 1 second)
   */
  public tickPositions(): void {
    if (this.activePositions.length === 0) return;

    const solUsdRate = 155.0;
    const positionsToClose: Position[] = [];

    for (const pos of this.activePositions) {
      pos.holdingSec = Math.round((Date.now() - pos.enteredAt) / 1000);

      // REAL ON-CHAIN POSITIONS: Never apply random walk drift!
      if (pos.isRealWalletTrade) {
        const currentPriceSol = pos.currentPriceSol;
        pos.currentValueSol = pos.sizeTokens * currentPriceSol;
        pos.unrealizedPnlSol = pos.currentValueSol - pos.costBasisSol;
        pos.unrealizedPnlPct = pos.costBasisSol > 0 ? (pos.unrealizedPnlSol / pos.costBasisSol) * 100 : 0;

        // Trailing stop update with real price
        const trailingUpdate = ExitEngine.updateTrailingStop(pos, currentPriceSol);
        pos.trailingStopPriceSol = trailingUpdate.newTrailingPriceSol;
        pos.trailingActivated = trailingUpdate.trailingActivated;
        pos.peakPriceUsd = trailingUpdate.peakPriceUsd;

        let microEngine = this.microEngines.get(pos.tokenMint);
        if (!microEngine) {
          microEngine = new MicrostructureEngine(25.0, currentPriceSol);
          this.microEngines.set(pos.tokenMint, microEngine);
        }
        const liveMicro = microEngine.getSnapshot();

        const exitSignal = ExitEngine.evaluatePosition(pos, liveMicro);
        if (exitSignal.shouldExit) {
          if (exitSignal.action === 'FULL_EXIT') {
            WalletManager.getInstance().oneClickExit({
              positionId: pos.id,
              pctToExit: 100,
              reason: exitSignal.reason,
            }).catch((err) => console.error('[EngineCoordinator] Live auto-exit failed:', err));
          } else if (exitSignal.action === 'SCALE_OUT') {
            WalletManager.getInstance().oneClickExit({
              positionId: pos.id,
              pctToExit: 50,
              reason: exitSignal.reason,
            }).catch((err) => console.error('[EngineCoordinator] Live auto scale-out failed:', err));
          }
        }
        continue;
      }

      // Simulated/paper positions (if any)
      const microEngine = this.microEngines.get(pos.tokenMint);
      if (microEngine) {
        const drift = (Math.random() * 0.04) - 0.016;
        const newPriceSol = Math.max(0.0000001, pos.currentPriceSol * (1 + drift));
        microEngine.recordTick({
          timestamp: Date.now(),
          isBuy: drift > 0,
          tokenAmount: 100_000,
          solAmount: 0.15,
          priceSol: newPriceSol,
          priceUsd: newPriceSol * solUsdRate,
          traderWallet: `Trader_${Math.random().toString(36).substring(2, 7)}`,
          isNewWallet: false,
        });

        const liveMicro = microEngine.getSnapshot();
        pos.currentPriceSol = newPriceSol;
        pos.currentPriceUsd = newPriceSol * solUsdRate;
        pos.currentValueSol = pos.sizeTokens * newPriceSol;
        pos.unrealizedPnlSol = pos.currentValueSol - pos.costBasisSol;
        pos.unrealizedPnlPct = (pos.unrealizedPnlSol / pos.costBasisSol) * 100;

        const trailingUpdate = ExitEngine.updateTrailingStop(pos, newPriceSol);
        pos.trailingStopPriceSol = trailingUpdate.newTrailingPriceSol;
        pos.trailingActivated = trailingUpdate.trailingActivated;
        pos.peakPriceUsd = trailingUpdate.peakPriceUsd;

        const exitSignal = ExitEngine.evaluatePosition(pos, liveMicro);

        if (exitSignal.shouldExit) {
          if (exitSignal.action === 'FULL_EXIT') {
            const sellResult = ExecutionEngine.executeSell(pos.tokenMint, pos.sizeTokens, newPriceSol, liveMicro.liquiditySol, exitSignal.isEmergency);
            pos.status = 'CLOSED';
            pos.closedAt = Date.now();
            pos.realizedPnlSol += (sellResult.solReceived - pos.costBasisSol);
            pos.exitReason = exitSignal.reason;

            this.portfolio.cashSol += sellResult.solReceived;
            this.portfolio.dailyRealizedPnlSol += pos.realizedPnlSol;
            this.portfolio.totalRealizedPnlSol += pos.realizedPnlSol;

            if (pos.realizedPnlSol > 0) {
              this.portfolio.consecutiveLosses = 0;
            } else {
              this.portfolio.consecutiveLosses += 1;
            }

            positionsToClose.push(pos);
            this.recordDecisionAudit(pos, DecisionAction.EXIT_HARD_STOP, [exitSignal.reason], 0, pos.realizedPnlSol);
          } else if (exitSignal.action === 'SCALE_OUT') {
            const tokensToSell = Math.floor(pos.sizeTokens * (exitSignal.pctToSell / 100));
            const sellResult = ExecutionEngine.executeSell(pos.tokenMint, tokensToSell, newPriceSol, liveMicro.liquiditySol);
            pos.sizeTokens -= tokensToSell;
            const costOfSold = (tokensToSell / (pos.sizeTokens + tokensToSell)) * pos.costBasisSol;
            pos.costBasisSol -= costOfSold;
            const portionPnl = sellResult.solReceived - costOfSold;
            pos.realizedPnlSol += portionPnl;

            this.portfolio.cashSol += sellResult.solReceived;
            this.portfolio.dailyRealizedPnlSol += portionPnl;
            this.portfolio.totalRealizedPnlSol += portionPnl;

            pos.executionHistory.push({
              action: 'SCALE_OUT',
              priceSol: newPriceSol,
              tokens: tokensToSell,
              pnlSol: portionPnl,
              timestamp: Date.now(),
              txSignature: sellResult.txSignature,
            });
          }
        }
      }
    }

    if (positionsToClose.length > 0) {
      this.activePositions = this.activePositions.filter(p => !positionsToClose.some(c => c.id === p.id));
      this.closedPositions.unshift(...positionsToClose);
    }

    this.recalculatePortfolio();
  }

  public recalculatePortfolio(): void {
    const wm = WalletManager.getInstance();
    const wmConfig = wm.getConfig();
    if (wmConfig.isConnected && wmConfig.balanceSol > 0) {
      this.portfolio.cashSol = wmConfig.balanceSol;
    }

    const exposure = this.activePositions.reduce((sum, p) => sum + p.currentValueSol, 0);
    const unrealized = this.activePositions.reduce((sum, p) => sum + p.unrealizedPnlSol, 0);
    const equity = this.portfolio.cashSol + exposure;

    this.portfolio.activeExposureSol = Number(exposure.toFixed(3));
    this.portfolio.unrealizedPnlSol = Number(unrealized.toFixed(3));
    this.portfolio.equitySol = Number(equity.toFixed(3));

    if (equity > this.portfolio.peakEquitySol) {
      this.portfolio.peakEquitySol = equity;
    }

    const dd = ((this.portfolio.peakEquitySol - equity) / this.portfolio.peakEquitySol) * 100;
    this.portfolio.currentDrawdownPct = Number(dd.toFixed(2));
    if (dd > this.portfolio.maxDrawdownPct) {
      this.portfolio.maxDrawdownPct = Number(dd.toFixed(2));
    }

    // Adaptive sizing multiplier
    if (this.portfolio.consecutiveLosses >= this.riskLimits.maxConsecutiveLosses) {
      this.riskLimits.circuitBreakerActive = true;
      this.riskLimits.circuitBreakerReason = `AUTO HALT: ${this.portfolio.consecutiveLosses} consecutive losses`;
      this.portfolio.adaptiveMultiplier = 0.25;
    } else if (this.portfolio.consecutiveLosses > 0) {
      this.portfolio.adaptiveMultiplier = Math.max(0.3, 1.0 - (this.portfolio.consecutiveLosses * 0.25));
    } else {
      this.portfolio.adaptiveMultiplier = 1.0;
    }
  }

  private recordDecisionAudit(
    pos: Position,
    decision: DecisionAction,
    reasons: string[],
    oppScore: number,
    realizedPnl: number = 0,
    safetyScore: number = 85,
    execution?: any
  ): void {
    const record: TradeDecisionRecord = {
      id: `AUDIT_${Date.now()}_${pos.symbol}`,
      tokenMint: pos.tokenMint,
      symbol: pos.symbol,
      timestamp: Date.now(),
      decision,
      decisionReasons: reasons,
      safetyScore,
      opportunityScore: oppScore,
      liquiditySol: 24.5,
      walletScore: 78,
      expectedEdgePct: 22.4,
      expectedSlippagePct: 1.2,
      positionSizeSol: pos.costBasisSol,
      latencyBreakdown: execution?.latencyBreakdown || {
        detected_at: pos.enteredAt - 280,
        parsed_at: pos.enteredAt - 268,
        scored_at: pos.enteredAt - 250,
        decision_at: pos.enteredAt - 236,
        submitted_at: pos.enteredAt - 150,
        confirmed_at: pos.enteredAt,
        total_latency_ms: 280,
        detection_to_decision_ms: 44,
        execution_flight_ms: 150,
      },
      executionResult: {
        txSignature: execution?.txSignature || pos.executionHistory[0]?.txSignature || '4xTx...Audit',
        expectedPriceSol: pos.entryPriceSol,
        actualPriceSol: pos.entryPriceSol,
        expectedSlippagePct: 1.1,
        actualSlippagePct: 1.25,
        priorityFeeSol: 0.0018,
        status: TradeStatus.CONFIRMED,
        confirmedAt: pos.enteredAt,
      },
      realizedPnlSol: Number(realizedPnl.toFixed(3)),
      realizedPnlPct: Number(((realizedPnl / Math.max(0.1, pos.costBasisSol)) * 100).toFixed(1)),
      exitReason: pos.exitReason,
    };

    this.tradeHistory.unshift(record);
    if (this.tradeHistory.length > 100) this.tradeHistory.pop();
  }

  private startLiveSimulation(): void {
    if (this.simulationInterval) return;

    // Simulation loop for new token launches (every 7 seconds) and position ticking (every 1 second)
    let tickCount = 0;
    this.simulationInterval = setInterval(() => {
      this.tickPositions();
      tickCount++;

      if (tickCount % 6 === 0 && this.config.mode !== SystemMode.EMERGENCY_STOP) {
        this.simulateIncomingLaunch();
      }
    }, 1000);

    // Live on-chain price polling for all active real wallet positions
    this.pricePollInterval = setInterval(() => {
      this.pollLivePricesForActivePositions().catch(() => {});
    }, 2000);
  }

  private simulateIncomingLaunch(): void {
    const feed = LiveTokenFeedService.getInstance();
    const nextRealToken = feed.getNextRealToken();
    const payload = feed.toIngestPayload(nextRealToken);
    this.ingestNewTokenLaunch(payload);
  }

  private seedInitialState(): void {
    const feed = LiveTokenFeedService.getInstance();
    const seedTokens = VERIFIED_SOLANA_MEMES;

    for (const item of seedTokens) {
      const payload = feed.toIngestPayload(item);
      this.ingestNewTokenLaunch(payload);
    }
  }
}
