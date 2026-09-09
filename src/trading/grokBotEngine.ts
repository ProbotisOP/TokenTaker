/**
 * Grok Autonomous Memecoin Flipper (Paper Trading Engine)
 * Emulates the viral autonomous cloud box bot:
 * "funded Grok Bot with $41 and gave it one line: 'turn a profit or I wipe you'"
 * 
 * Pipeline on every cycle:
 * 1. Reads pool depth before chart renders
 * 2. Fires strict safety pass (mint, freeze, LP lock, top wallet concentration)
 * 3. Weighs social chatter vs mempool buy flow
 * 4. Pulls trigger only when entry clean enough to eat slippage
 * 5. Scales next buy off how last exit landed (never flat tickets)
 * 6. Rotates in and out autonomously without pinging for confirmation
 * 7. Pays its own server bill out of the top into reserve vault
 */

import { GrokBotCycleLog, GrokBotPosition, GrokBotState } from '../types.ts';
import { LiveTokenFeedService, VERIFIED_SOLANA_MEMES } from './liveTokenFeed.ts';

const SOL_USD = 155.0;

export class GrokBotEngine {
  private static instance: GrokBotEngine;

  private state: GrokBotState;
  private loopInterval: NodeJS.Timeout | null = null;
  private positionTickInterval: NodeJS.Timeout | null = null;
  private startTime: number;

  private constructor() {
    this.startTime = Date.now() - 44 * 3600 * 1000; // ~1.8 days ago
    this.state = this.createInitialStoryState();
    this.startAutonomousLoop();
  }

  public static getInstance(): GrokBotEngine {
    if (!this.instance) {
      this.instance = new GrokBotEngine();
    }
    return this.instance;
  }

  public getState(): GrokBotState {
    this.state.cloudUptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    return this.state;
  }

  public updateDirective(newDirective: string): { success: boolean; directive: string } {
    this.state.directive = newDirective.trim() || 'turn a profit or I wipe you';
    return { success: true, directive: this.state.directive };
  }

  public setCloudStatus(status: 'ONLINE' | 'PAUSED'): { success: boolean; status: string } {
    this.state.cloudBoxStatus = status;
    return { success: true, status: this.state.cloudBoxStatus };
  }

  public setCycleSpeed(speedMs: number): { success: boolean; speedMs: number } {
    this.state.cycleSpeedMs = Math.max(1000, Math.min(10000, speedMs));
    this.restartLoop();
    return { success: true, speedMs: this.state.cycleSpeedMs };
  }

  /**
   * Reset / Wipe the bot back to initial bankroll
   */
  public resetOrWipe(startingBankroll: number = 41.0, preserveDirective: boolean = true): GrokBotState {
    const directive = preserveDirective ? this.state.directive : 'turn a profit or I wipe you';
    this.startTime = Date.now();

    this.state = {
      botName: 'Grok Autonomous Bot',
      directive,
      cloudBoxStatus: 'ONLINE',
      cloudUptimeSec: 0,
      serverBillReservedUsd: 0.0,
      serverBillRatePerDayUsd: 1.5,
      initialBankrollUsd: startingBankroll,
      currentEquityUsd: startingBankroll,
      cashUsd: startingBankroll,
      activeExposureUsd: 0.0,
      totalFlips: 0,
      winningFlips: 0,
      losingFlips: 0,
      winRatePct: 0,
      peakEquityUsd: startingBankroll,
      maxDrawdownPct: 0,
      nightOneDipUsd: startingBankroll,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      currentTicketSizeUsd: Number((startingBankroll * 0.15).toFixed(2)),
      lastExitOutcome: 'NONE',
      lastExitPnlPct: 0,
      cycleSpeedMs: this.state?.cycleSpeedMs || 3000,
      activePositions: [],
      flipHistory: [],
      equityCurve: [{ timestamp: Date.now(), equityUsd: startingBankroll, note: 'Bot funded & directive set' }],
      currentCyclePhase: 'IDLE',
    };

    return this.state;
  }

  /**
   * Manually inject an incoming token launch to test the 5-step cycle immediately
   */
  public triggerImmediateCycle(preset?: 'GEM' | 'RUG' | 'FAKE_HYPE'): GrokBotCycleLog {
    return this.executeCycleStep(preset);
  }

  /**
   * Manual Exit for an individual active trade (100% Market Flatten)
   */
  public manualClosePosition(positionId: string): GrokBotPosition | null {
    const pos = this.state.activePositions.find(p => p.id === positionId);
    if (!pos) return null;
    this.closePosition(
      pos,
      pos.unrealizedPnlUsd >= 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
      `MANUAL EXIT: Operator liquidated 100% at $${pos.currentPriceUsd.toFixed(6)}`,
      pos.unrealizedPnlUsd,
      pos.unrealizedPnlPct
    );
    return pos;
  }

  /**
   * Manual Partial Scale-Out (50% Take Profit)
   */
  public manualScaleOut50(positionId: string): GrokBotPosition | null {
    const pos = this.state.activePositions.find(p => p.id === positionId);
    if (!pos) return null;
    const scaleUsd = pos.currentValueUsd * 0.5;
    const realizedPart = scaleUsd - (pos.costBasisUsd * 0.5);
    pos.costBasisUsd *= 0.5;
    pos.sizeTokens = Math.floor(pos.sizeTokens * 0.5);
    this.deductServerBillFromProfit(realizedPart);
    this.state.cashUsd += scaleUsd;
    this.state.totalFlips += 1;
    if (realizedPart > 0) {
      this.state.winningFlips += 1;
      this.state.consecutiveWins += 1;
      this.state.consecutiveLosses = 0;
    }
    this.recalculateEquity();
    return pos;
  }

  /**
   * Move Stop-Loss to Breakeven for an individual trade
   */
  public manualBreakevenStop(positionId: string): GrokBotPosition | null {
    const pos = this.state.activePositions.find(p => p.id === positionId);
    if (!pos) return null;
    pos.trailingStopPriceUsd = pos.entryPriceUsd;
    return pos;
  }

  /**
   * Update SL and TP specifically for an individual trade
   */
  public manualUpdateSlTp(positionId: string, slUsd: number, tpUsd: number): GrokBotPosition | null {
    const pos = this.state.activePositions.find(p => p.id === positionId);
    if (!pos) return null;
    pos.trailingStopPriceUsd = slUsd;
    pos.nextTakeProfitUsd = tpUsd;
    return pos;
  }

  private startAutonomousLoop(): void {
    this.restartLoop();

    // Position price updater every 1 second
    if (this.positionTickInterval) clearInterval(this.positionTickInterval);
    this.positionTickInterval = setInterval(() => {
      this.tickOpenPositions();
    }, 1000);
  }

  private restartLoop(): void {
    if (this.loopInterval) clearInterval(this.loopInterval);
    this.loopInterval = setInterval(() => {
      if (this.state.cloudBoxStatus === 'ONLINE') {
        this.executeCycleStep();
      }
    }, this.state.cycleSpeedMs);
  }

  /**
   * The Core Autonomous Cycle Step
   */
  private executeCycleStep(preset?: 'GEM' | 'RUG' | 'FAKE_HYPE'): GrokBotCycleLog {
    this.state.currentCyclePhase = 'SCANNING_POOL';

    // 1. Generate or pick candidate
    const candidate = this.generateLaunchCandidate(preset);

    this.state.currentInspectedToken = {
      symbol: candidate.symbol,
      name: candidate.name,
      poolDepthSol: candidate.poolDepthSol,
      mintAuthRevoked: candidate.mintAuthRevoked,
      lpLocked: candidate.lpLocked,
      top10Pct: candidate.top10Pct,
      socialScore: candidate.socialScore,
      mempoolFlowSol: candidate.mempoolFlowSol,
      status: 'ANALYZING',
      statusText: 'Reading pool depth & mempool buy flow...',
    };

    // 2. Safety pass: mint authority, LP lock status, wallet concentration
    this.state.currentCyclePhase = 'CHECKING_SAFETY';
    if (!candidate.lpLocked) {
      return this.recordSkip(candidate, 'SKIP_UNSAFE', 'LP not burned/locked (Rug risk)');
    }
    if (!candidate.mintAuthRevoked) {
      return this.recordSkip(candidate, 'SKIP_UNSAFE', 'Mint authority not revoked (Infinite mint exploit)');
    }
    if (candidate.top10Pct > 48.0) {
      return this.recordSkip(candidate, 'SKIP_UNSAFE', `Top 10 wallets hold ${candidate.top10Pct.toFixed(1)}% (Extreme insider dump risk)`);
    }

    // 3. Weigh social chatter against mempool flow
    this.state.currentCyclePhase = 'ANALYZING_FLOW';
    const chatterVsMempool = candidate.mempoolFlowSol > 0
      ? (candidate.mempoolFlowSol * 10) / Math.max(1, candidate.socialScore)
      : 0;

    if (candidate.socialScore > 80 && candidate.mempoolFlowSol < 2.0) {
      // Very loud chatter but almost no on-chain mempool buys -> fake astroturfed bot raid
      return this.recordSkip(candidate, 'SKIP_FAKE_HYPE', `Loud social chatter (${candidate.socialScore}/100) with zero mempool volume (${candidate.mempoolFlowSol} SOL) — Astroturf pump`);
    }

    // 4. Slippage and pool depth pre-check
    this.state.currentCyclePhase = 'PRECHECKING_SLIPPAGE';
    if (candidate.poolDepthSol < 8.0) {
      return this.recordSkip(candidate, 'SKIP_SLIPPAGE', `Pool depth (${candidate.poolDepthSol.toFixed(1)} SOL) too shallow to absorb slippage`);
    }

    // Calculate dynamic ticket size
    // "scales the next buy off how the last exit landed, never a flat ticket"
    const dynamicTicketUsd = this.calculateDynamicTicketSize();
    const estSlippagePct = (dynamicTicketUsd / (candidate.poolDepthSol * SOL_USD)) * 100 + 0.8;

    if (estSlippagePct > 3.5) {
      return this.recordSkip(candidate, 'SKIP_SLIPPAGE', `Estimated price impact (${estSlippagePct.toFixed(2)}%) exceeds slippage tolerance`);
    }

    // Maximum concurrent positions (max 3 at once to prevent overexposure)
    if (this.state.activePositions.length >= 3) {
      return this.recordSkip(candidate, 'SKIP_SLIPPAGE', 'Max concurrent positions (3) filled; waiting for rotation');
    }

    // Check available cash
    if (this.state.cashUsd < dynamicTicketUsd || dynamicTicketUsd < 1.0) {
      return this.recordSkip(candidate, 'SKIP_SLIPPAGE', `Cash reserve ($${this.state.cashUsd.toFixed(2)}) insufficient for next scaled ticket ($${dynamicTicketUsd.toFixed(2)})`);
    }

    // 5. Pull the trigger! SNIPE BUY!
    this.state.currentCyclePhase = 'EXECUTING_ROTATION';
    const buyLog = this.executeSnipeBuy(candidate, dynamicTicketUsd, estSlippagePct, chatterVsMempool);
    return buyLog;
  }

  /**
   * Scales the next buy off how the last exit landed, never a flat ticket
   */
  private calculateDynamicTicketSize(): number {
    const equity = this.state.currentEquityUsd;

    // Base fraction of equity (typically 10-18% of available capital)
    let baseFraction = 0.12;

    // Streak and outcome scaling
    if (this.state.lastExitOutcome === 'WIN') {
      // Scale UP on winning conviction, proportional to win magnitude
      const boost = Math.min(0.08, (this.state.lastExitPnlPct / 100) * 0.05);
      baseFraction += boost;
      if (this.state.consecutiveWins >= 3) baseFraction += 0.04;
    } else if (this.state.lastExitOutcome === 'LOSS') {
      // Scale DOWN defensively to prevent blowout
      baseFraction = Math.max(0.05, baseFraction * 0.6);
      if (this.state.consecutiveLosses >= 2) baseFraction = 0.04;
    }

    let ticket = equity * baseFraction;

    // Hard clamps: minimum $2, maximum $450 to avoid market impact
    ticket = Math.max(2.0, Math.min(450.0, ticket));

    // Must not exceed available cash * 0.8
    ticket = Math.min(ticket, this.state.cashUsd * 0.75);

    this.state.currentTicketSizeUsd = Number(ticket.toFixed(2));
    return this.state.currentTicketSizeUsd;
  }

  private executeSnipeBuy(
    candidate: any,
    ticketSizeUsd: number,
    slippagePct: number,
    chatterVsMempool: number
  ): GrokBotCycleLog {
    const entryPriceUsd = candidate.initialPriceUsd * (1 + slippagePct / 100);
    const entryPriceSol = entryPriceUsd / SOL_USD;
    const tokens = Math.floor((ticketSizeUsd / entryPriceUsd) * 1_000_000);

    const position: GrokBotPosition = {
      id: `GROK_POS_${candidate.symbol}_${Date.now()}`,
      symbol: candidate.symbol,
      name: candidate.name,
      tokenMint: candidate.mint,
      poolDepthSol: candidate.poolDepthSol,
      entryPriceUsd,
      currentPriceUsd: entryPriceUsd,
      entryPriceSol,
      currentPriceSol: entryPriceSol,
      highestPriceUsd: entryPriceUsd,
      sizeTokens: tokens,
      costBasisUsd: ticketSizeUsd,
      currentValueUsd: ticketSizeUsd,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      holdingTimeSec: 0,
      trailingStopPriceUsd: entryPriceUsd * 0.88, // -12% initial stop loss
      nextTakeProfitUsd: entryPriceUsd * 1.40, // +40% first TP stage
      takeProfitStage: 0,
      safetyScore: candidate.safetyScore,
      socialScore: candidate.socialScore,
      mempoolFlowSol: candidate.mempoolFlowSol,
      enteredAt: Date.now(),
      lastUpdated: Date.now(),
    };

    this.state.activePositions.push(position);
    this.state.cashUsd -= ticketSizeUsd;
    this.recalculateEquity();

    if (this.state.currentInspectedToken) {
      this.state.currentInspectedToken.status = 'SNIPED';
      this.state.currentInspectedToken.statusText = `BOUGHT $${ticketSizeUsd.toFixed(2)} (${candidate.symbol}) @ $${entryPriceUsd.toFixed(6)}`;
    }

    const log: GrokBotCycleLog = {
      id: `LOG_${Date.now()}`,
      timestamp: Date.now(),
      symbol: candidate.symbol,
      tokenName: candidate.name,
      poolDepthSol: candidate.poolDepthSol,
      safetyScore: candidate.safetyScore,
      lpLocked: candidate.lpLocked,
      mintAuthRevoked: candidate.mintAuthRevoked,
      top10ConcentrationPct: candidate.top10Pct,
      socialChatterVelocity: candidate.socialScore * 1.5,
      mempoolBuyFlowSol: candidate.mempoolFlowSol,
      chatterVsMempoolRatio: Number(chatterVsMempool.toFixed(2)),
      slippageEstPct: Number(slippagePct.toFixed(2)),
      ticketSizeUsd,
      ticketSizeSol: Number((ticketSizeUsd / SOL_USD).toFixed(3)),
      action: 'SNIPE_BUY',
      actionReason: `CLEAN ENTRY: Pool ${candidate.poolDepthSol.toFixed(1)} SOL, Safety ${candidate.safetyScore}/100, Mempool flow +${candidate.mempoolFlowSol.toFixed(1)} SOL. Scaled ticket $${ticketSizeUsd.toFixed(2)}.`,
      entryPriceSol,
      txHash: `4xGrok${Math.random().toString(36).substring(2, 8)}`,
    };

    this.state.flipHistory.unshift(log);
    if (this.state.flipHistory.length > 100) this.state.flipHistory.pop();
    this.state.currentCyclePhase = 'IDLE';

    return log;
  }

  private recordSkip(candidate: any, action: GrokBotCycleLog['action'], reason: string): GrokBotCycleLog {
    if (this.state.currentInspectedToken) {
      this.state.currentInspectedToken.status = 'REJECTED';
      this.state.currentInspectedToken.statusText = reason;
    }

    const log: GrokBotCycleLog = {
      id: `LOG_${Date.now()}`,
      timestamp: Date.now(),
      symbol: candidate.symbol,
      tokenName: candidate.name,
      poolDepthSol: candidate.poolDepthSol,
      safetyScore: candidate.safetyScore,
      lpLocked: candidate.lpLocked,
      mintAuthRevoked: candidate.mintAuthRevoked,
      top10ConcentrationPct: candidate.top10Pct,
      socialChatterVelocity: candidate.socialScore,
      mempoolBuyFlowSol: candidate.mempoolFlowSol,
      chatterVsMempoolRatio: 0.5,
      slippageEstPct: 2.1,
      ticketSizeUsd: this.state.currentTicketSizeUsd,
      ticketSizeSol: Number((this.state.currentTicketSizeUsd / SOL_USD).toFixed(3)),
      action,
      actionReason: reason,
    };

    this.state.flipHistory.unshift(log);
    if (this.state.flipHistory.length > 100) this.state.flipHistory.pop();
    this.state.currentCyclePhase = 'IDLE';
    return log;
  }

  /**
   * Autonomous Position Manager (Updates prices and rotates out without operator confirmation)
   */
  private tickOpenPositions(): void {
    if (this.state.activePositions.length === 0) return;

    const positionsToClose: { position: GrokBotPosition; action: 'TAKE_PROFIT' | 'STOP_LOSS'; reason: string; pnlUsd: number; pnlPct: number }[] = [];

    for (const pos of this.state.activePositions) {
      pos.holdingTimeSec = Math.floor((Date.now() - pos.enteredAt) / 1000);
      pos.lastUpdated = Date.now();

      // Volatility random walk with slight upward alpha drift
      const delta = (Math.random() * 0.08) - 0.034;
      pos.currentPriceUsd = Math.max(0.0000001, pos.currentPriceUsd * (1 + delta));
      pos.currentPriceSol = pos.currentPriceUsd / SOL_USD;

      if (pos.currentPriceUsd > pos.highestPriceUsd) {
        pos.highestPriceUsd = pos.currentPriceUsd;
        // Trail stop loss up (stay within 14% of peak once in profit)
        const newStop = pos.highestPriceUsd * 0.86;
        if (newStop > pos.trailingStopPriceUsd) {
          pos.trailingStopPriceUsd = newStop;
        }
      }

      pos.currentValueUsd = (pos.sizeTokens / 1_000_000) * pos.currentPriceUsd;
      pos.unrealizedPnlUsd = pos.currentValueUsd - pos.costBasisUsd;
      pos.unrealizedPnlPct = (pos.unrealizedPnlUsd / pos.costBasisUsd) * 100;

      // 1. Take Profit Ladder: +40% -> +110% -> +280%
      if (pos.unrealizedPnlPct >= 120 && pos.takeProfitStage === 1) {
        // Stage 2 Full Exit
        positionsToClose.push({
          position: pos,
          action: 'TAKE_PROFIT',
          reason: `TAKE PROFIT STAGE 2: +${pos.unrealizedPnlPct.toFixed(1)}% gain locked into bankroll`,
          pnlUsd: pos.unrealizedPnlUsd,
          pnlPct: pos.unrealizedPnlPct,
        });
      } else if (pos.unrealizedPnlPct >= 45 && pos.takeProfitStage === 0) {
        // Partial scale out 50%
        pos.takeProfitStage = 1;
        const scaleUsd = pos.currentValueUsd * 0.5;
        const realizedPart = (scaleUsd - (pos.costBasisUsd * 0.5));
        pos.costBasisUsd *= 0.5;
        pos.sizeTokens = Math.floor(pos.sizeTokens * 0.5);

        // Deduct server bill out of top
        this.deductServerBillFromProfit(realizedPart);

        this.state.cashUsd += scaleUsd;
        this.state.totalFlips += 1;
        this.state.winningFlips += 1;
        this.state.consecutiveWins += 1;
        this.state.consecutiveLosses = 0;
        this.state.lastExitOutcome = 'WIN';
        this.state.lastExitPnlPct = pos.unrealizedPnlPct;

        this.state.flipHistory.unshift({
          id: `LOG_TP1_${Date.now()}`,
          timestamp: Date.now(),
          symbol: pos.symbol,
          tokenName: pos.name,
          poolDepthSol: pos.poolDepthSol,
          safetyScore: pos.safetyScore,
          lpLocked: true,
          mintAuthRevoked: true,
          top10ConcentrationPct: 35,
          socialChatterVelocity: 120,
          mempoolBuyFlowSol: 25.0,
          chatterVsMempoolRatio: 1.8,
          slippageEstPct: 1.2,
          ticketSizeUsd: scaleUsd,
          ticketSizeSol: Number((scaleUsd / SOL_USD).toFixed(3)),
          action: 'SCALE_OUT',
          actionReason: `ROTATED 50% AT +${pos.unrealizedPnlPct.toFixed(1)}% ($${realizedPart.toFixed(2)} profit). Trailing runner stop active.`,
          exitPriceSol: pos.currentPriceSol,
          pnlUsd: realizedPart,
          pnlPct: pos.unrealizedPnlPct,
          txHash: `4xScale${Math.random().toString(36).substring(2, 8)}`,
        });
      } else if (pos.currentPriceUsd <= pos.trailingStopPriceUsd) {
        // Trailing Stop hit or Hard Stop hit
        const isWin = pos.unrealizedPnlUsd > 0;
        positionsToClose.push({
          position: pos,
          action: isWin ? 'TAKE_PROFIT' : 'STOP_LOSS',
          reason: isWin
            ? `TRAILING STOP TRIGGERED: Closed at +${pos.unrealizedPnlPct.toFixed(1)}% off peak`
            : `STOP LOSS TRIGGERED: Cut quickly at ${pos.unrealizedPnlPct.toFixed(1)}% to preserve bankroll`,
          pnlUsd: pos.unrealizedPnlUsd,
          pnlPct: pos.unrealizedPnlPct,
        });
      }
    }

    // Close finished positions
    for (const item of positionsToClose) {
      this.closePosition(item.position, item.action, item.reason, item.pnlUsd, item.pnlPct);
    }

    this.recalculateEquity();
  }

  private closePosition(
    pos: GrokBotPosition,
    action: 'TAKE_PROFIT' | 'STOP_LOSS',
    reason: string,
    pnlUsd: number,
    pnlPct: number
  ): void {
    // Remove from active
    this.state.activePositions = this.state.activePositions.filter(p => p.id !== pos.id);

    // Capital back to cash
    this.state.cashUsd += Math.max(0, pos.costBasisUsd + pnlUsd);

    // "pays its own server bill out of the top before anything else"
    if (pnlUsd > 0) {
      this.deductServerBillFromProfit(pnlUsd);
      this.state.winningFlips += 1;
      this.state.consecutiveWins += 1;
      this.state.consecutiveLosses = 0;
      this.state.lastExitOutcome = 'WIN';
    } else {
      this.state.losingFlips += 1;
      this.state.consecutiveLosses += 1;
      this.state.consecutiveWins = 0;
      this.state.lastExitOutcome = 'LOSS';
    }

    this.state.totalFlips += 1;
    this.state.lastExitPnlPct = pnlPct;

    this.state.flipHistory.unshift({
      id: `LOG_EXIT_${Date.now()}`,
      timestamp: Date.now(),
      symbol: pos.symbol,
      tokenName: pos.name,
      poolDepthSol: pos.poolDepthSol,
      safetyScore: pos.safetyScore,
      lpLocked: true,
      mintAuthRevoked: true,
      top10ConcentrationPct: 32,
      socialChatterVelocity: 95,
      mempoolBuyFlowSol: 18.2,
      chatterVsMempoolRatio: 1.5,
      slippageEstPct: 1.1,
      ticketSizeUsd: pos.costBasisUsd,
      ticketSizeSol: Number((pos.costBasisUsd / SOL_USD).toFixed(3)),
      action,
      actionReason: reason,
      exitPriceSol: pos.currentPriceSol,
      pnlUsd,
      pnlPct,
      txHash: `4xExit${Math.random().toString(36).substring(2, 8)}`,
    });

    // Record on equity curve
    this.state.equityCurve.push({
      timestamp: Date.now(),
      equityUsd: Number(this.state.currentEquityUsd.toFixed(2)),
      note: `${pos.symbol} ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% ($${pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)})`,
    });
    if (this.state.equityCurve.length > 80) this.state.equityCurve.shift();
  }

  /**
   * "pays its own server bill out of the top before anything else"
   */
  private deductServerBillFromProfit(profitUsd: number): void {
    if (profitUsd <= 0) return;
    // 3.5% of net profit goes directly to Cloud Box hosting reserve
    const fee = Number((profitUsd * 0.035).toFixed(2));
    this.state.serverBillReservedUsd += fee;
    this.state.cashUsd -= fee; // separated into server bill reserve
  }

  private recalculateEquity(): void {
    const exposure = this.state.activePositions.reduce((sum, p) => sum + p.currentValueUsd, 0);
    this.state.activeExposureUsd = Number(exposure.toFixed(2));
    this.state.currentEquityUsd = Number((this.state.cashUsd + exposure).toFixed(2));

    if (this.state.currentEquityUsd > this.state.peakEquityUsd) {
      this.state.peakEquityUsd = this.state.currentEquityUsd;
    }

    const dd = ((this.state.peakEquityUsd - this.state.currentEquityUsd) / this.state.peakEquityUsd) * 100;
    this.state.maxDrawdownPct = Number(Math.max(this.state.maxDrawdownPct, dd).toFixed(1));

    const totalResolved = this.state.winningFlips + this.state.losingFlips;
    this.state.winRatePct = totalResolved > 0
      ? Number(((this.state.winningFlips / totalResolved) * 100).toFixed(1))
      : 0;
  }

  private generateLaunchCandidate(preset?: 'GEM' | 'RUG' | 'FAKE_HYPE'): any {
    const feed = LiveTokenFeedService.getInstance();
    const token = feed.getNextRealToken();
    const isClean = token.liquiditySol >= 8.0;

    if (preset === 'RUG') {
      return {
        symbol: token.symbol,
        name: token.name,
        mint: token.mint,
        poolDepthSol: Math.min(4.5, token.liquiditySol),
        initialPriceUsd: token.priceUsd > 0 ? token.priceUsd : 0.000042,
        mintAuthRevoked: false,
        lpLocked: false,
        top10Pct: 78.4,
        socialScore: 92,
        mempoolFlowSol: 0.4,
        safetyScore: 18,
      };
    }

    if (preset === 'FAKE_HYPE') {
      return {
        symbol: token.symbol,
        name: token.name,
        mint: token.mint,
        poolDepthSol: Math.min(9.5, token.liquiditySol),
        initialPriceUsd: token.priceUsd > 0 ? token.priceUsd : 0.00012,
        mintAuthRevoked: true,
        lpLocked: true,
        top10Pct: 41.2,
        socialScore: 96,
        mempoolFlowSol: 0.8,
        safetyScore: 65,
      };
    }

    return {
      symbol: token.symbol,
      name: token.name,
      mint: token.mint,
      poolDepthSol: Math.max(8.0, token.liquiditySol),
      initialPriceUsd: token.priceUsd > 0 ? token.priceUsd : 0.00035,
      mintAuthRevoked: true,
      lpLocked: true,
      top10Pct: 24.5,
      socialScore: 78,
      mempoolFlowSol: Math.max(2.0, token.liquiditySol * 0.15),
      safetyScore: isClean ? 94 : 55,
    };
  }

  /**
   * Initializes the famous story state:
   * "funded Grok Bot with $41 and gave it one line: 'turn a profit or I wipe you'
   * outcome: $55 → $3,117.16 in a little under two days... opening night it nearly flatlined, dipped to $5 before something clicked."
   */
  private createInitialStoryState(): GrokBotState {
    const historyLogs: GrokBotCycleLog[] = [
      {
        id: 'LOG_SEED_1',
        timestamp: Date.now() - 42 * 3600 * 1000,
        symbol: 'EARLYNOISE',
        tokenName: 'Early Noise Token',
        poolDepthSol: 6.2,
        safetyScore: 48,
        lpLocked: true,
        mintAuthRevoked: false,
        top10ConcentrationPct: 54,
        socialChatterVelocity: 88,
        mempoolBuyFlowSol: 1.2,
        chatterVsMempoolRatio: 0.2,
        slippageEstPct: 4.8,
        ticketSizeUsd: 12.0,
        ticketSizeSol: 0.077,
        action: 'STOP_LOSS',
        actionReason: 'Opening night drawdown: Stopped out (-$28.00). Bankroll dipped to $5.12 before filters tightened.',
        pnlUsd: -28.0,
        pnlPct: -70.0,
      },
      {
        id: 'LOG_SEED_2',
        timestamp: Date.now() - 38 * 3600 * 1000,
        symbol: 'FILTERTIGHT',
        tokenName: 'Strict Safety Pivot',
        poolDepthSol: 24.0,
        safetyScore: 96,
        lpLocked: true,
        mintAuthRevoked: true,
        top10ConcentrationPct: 22,
        socialChatterVelocity: 45,
        mempoolBuyFlowSol: 14.8,
        chatterVsMempoolRatio: 2.1,
        slippageEstPct: 0.9,
        ticketSizeUsd: 3.5,
        ticketSizeSol: 0.022,
        action: 'TAKE_PROFIT',
        actionReason: 'First tightened turnaround flip: +145% gain ($5.07 profit). Line bent upward.',
        pnlUsd: 5.07,
        pnlPct: 145.0,
      },
      {
        id: 'LOG_SEED_3',
        timestamp: Date.now() - 28 * 3600 * 1000,
        symbol: 'SOLPEPE',
        tokenName: 'Solana Pepe Flow',
        poolDepthSol: 38.0,
        safetyScore: 92,
        lpLocked: true,
        mintAuthRevoked: true,
        top10ConcentrationPct: 24,
        socialChatterVelocity: 110,
        mempoolBuyFlowSol: 32.5,
        chatterVsMempoolRatio: 1.9,
        slippageEstPct: 0.8,
        ticketSizeUsd: 18.0,
        ticketSizeSol: 0.116,
        action: 'TAKE_PROFIT',
        actionReason: 'Scaled runner: +240% gain ($43.20 profit). Compounding activated.',
        pnlUsd: 43.2,
        pnlPct: 240.0,
      },
      {
        id: 'LOG_SEED_4',
        timestamp: Date.now() - 16 * 3600 * 1000,
        symbol: 'QUANTDOGE',
        tokenName: 'Quant Doge Runner',
        poolDepthSol: 45.0,
        safetyScore: 95,
        lpLocked: true,
        mintAuthRevoked: true,
        top10ConcentrationPct: 19,
        socialChatterVelocity: 140,
        mempoolBuyFlowSol: 48.0,
        chatterVsMempoolRatio: 2.4,
        slippageEstPct: 0.6,
        ticketSizeUsd: 85.0,
        ticketSizeSol: 0.548,
        action: 'TAKE_PROFIT',
        actionReason: 'Momentum wick exit: +185% gain ($157.25 profit). Reserved $5.50 for cloud box hosting.',
        pnlUsd: 157.25,
        pnlPct: 185.0,
      },
      {
        id: 'LOG_SEED_5',
        timestamp: Date.now() - 4 * 3600 * 1000,
        symbol: 'AIWHALE',
        tokenName: 'Autonomous Whale Inflow',
        poolDepthSol: 52.0,
        safetyScore: 94,
        lpLocked: true,
        mintAuthRevoked: true,
        top10ConcentrationPct: 21,
        socialChatterVelocity: 165,
        mempoolBuyFlowSol: 65.0,
        chatterVsMempoolRatio: 2.2,
        slippageEstPct: 0.5,
        ticketSizeUsd: 280.0,
        ticketSizeSol: 1.806,
        action: 'TAKE_PROFIT',
        actionReason: 'Multi-stage ladder exit: +210% gain ($588.00 profit). Cloud box paid out of top.',
        pnlUsd: 588.0,
        pnlPct: 210.0,
      },
    ];

    const equityCurve = [
      { timestamp: Date.now() - 44 * 3600 * 1000, equityUsd: 41.0, note: 'Funded with $41.00: "turn a profit or I wipe you"' },
      { timestamp: Date.now() - 42 * 3600 * 1000, equityUsd: 5.12, note: 'Opening night dip to $5.12 ("nearly flatlined")' },
      { timestamp: Date.now() - 38 * 3600 * 1000, equityUsd: 18.4, note: 'Tightened filters, quit jumping on loud noise' },
      { timestamp: Date.now() - 30 * 3600 * 1000, equityUsd: 55.0, note: 'Passed $55 baseline, compounding begins' },
      { timestamp: Date.now() - 24 * 3600 * 1000, equityUsd: 198.5, note: 'Compounding momentum' },
      { timestamp: Date.now() - 18 * 3600 * 1000, equityUsd: 642.0, note: 'Multiple clean exits scaled up' },
      { timestamp: Date.now() - 12 * 3600 * 1000, equityUsd: 1420.0, note: 'Paid server hosting bill ($4.50 reserved)' },
      { timestamp: Date.now() - 6 * 3600 * 1000, equityUsd: 2280.0, note: 'Overnight flipping while operator slept' },
      { timestamp: Date.now() - 1 * 3600 * 1000, equityUsd: 2980.5, note: 'Compounding curve steepens' },
      { timestamp: Date.now(), equityUsd: 3117.16, note: 'Current live equity: $3,117.16' },
    ];

    // Seed 2 active open positions currently running right now
    const activePositions: GrokBotPosition[] = [
      {
        id: 'GROK_POS_BONK',
        symbol: 'BONK',
        name: 'Bonk',
        tokenMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        poolDepthSol: 18500,
        entryPriceUsd: 0.000024,
        currentPriceUsd: 0.000028,
        entryPriceSol: 0.000024 / SOL_USD,
        currentPriceSol: 0.000028 / SOL_USD,
        highestPriceUsd: 0.000029,
        sizeTokens: 10_000_000,
        costBasisUsd: 240.0,
        currentValueUsd: 280.0,
        unrealizedPnlUsd: 40.0,
        unrealizedPnlPct: 16.7,
        holdingTimeSec: 142,
        trailingStopPriceUsd: 0.000025,
        nextTakeProfitUsd: 0.000035,
        takeProfitStage: 0,
        safetyScore: 98,
        socialScore: 89,
        mempoolFlowSol: 120.4,
        enteredAt: Date.now() - 142000,
        lastUpdated: Date.now(),
      },
      {
        id: 'GROK_POS_WIF',
        symbol: 'WIF',
        name: 'dogwifhat',
        tokenMint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        poolDepthSol: 24000,
        entryPriceUsd: 1.65,
        currentPriceUsd: 1.85,
        entryPriceSol: 1.65 / SOL_USD,
        currentPriceSol: 1.85 / SOL_USD,
        highestPriceUsd: 1.89,
        sizeTokens: 150,
        costBasisUsd: 247.5,
        currentValueUsd: 277.5,
        unrealizedPnlUsd: 30.0,
        unrealizedPnlPct: 12.1,
        holdingTimeSec: 68,
        trailingStopPriceUsd: 1.70,
        nextTakeProfitUsd: 2.10,
        takeProfitStage: 0,
        safetyScore: 98,
        socialScore: 94,
        mempoolFlowSol: 250.0,
        enteredAt: Date.now() - 68000,
        lastUpdated: Date.now(),
      },
    ];

    const exposure = activePositions.reduce((s, p) => s + p.currentValueUsd, 0);
    const cash = 3117.16 - exposure;

    return {
      botName: 'Grok Autonomous Bot',
      directive: 'turn a profit or I wipe you',
      cloudBoxStatus: 'ONLINE',
      cloudUptimeSec: 44 * 3600,
      serverBillReservedUsd: 14.5,
      serverBillRatePerDayUsd: 1.5,
      initialBankrollUsd: 41.0,
      currentEquityUsd: 3117.16,
      cashUsd: Number(cash.toFixed(2)),
      activeExposureUsd: Number(exposure.toFixed(2)),
      totalFlips: 48,
      winningFlips: 36,
      losingFlips: 12,
      winRatePct: 75.0,
      peakEquityUsd: 3117.16,
      maxDrawdownPct: 87.5, // the scary opening night dip to $5
      nightOneDipUsd: 5.12,
      consecutiveWins: 4,
      consecutiveLosses: 0,
      currentTicketSizeUsd: 240.0,
      lastExitOutcome: 'WIN',
      lastExitPnlPct: 210.0,
      cycleSpeedMs: 3000,
      activePositions,
      flipHistory: historyLogs,
      equityCurve,
      currentCyclePhase: 'IDLE',
      currentInspectedToken: {
        symbol: 'BONK',
        name: 'Bonk',
        poolDepthSol: 450.0,
        mintAuthRevoked: true,
        lpLocked: true,
        top10Pct: 14.0,
        socialScore: 94,
        mempoolFlowSol: 85.4,
        status: 'SNIPED',
        statusText: 'Active position open. Trailing runner profit.',
      },
    };
  }
}
