/** DEMO ONLY. Synthetic identities, prices, fills and bankroll; no network or execution provider. */
import { GrokBotCycleLog, GrokBotPosition, GrokBotState } from '../types.ts';

const SOL_USD = 155;
const DEMO_TOKEN = { symbol: 'DEMO-GEM', name: 'Synthetic DEMO Token', mint: 'DEMO_ONLY_NOT_A_SOLANA_MINT' };

export class GrokBotEngine {
  private static instance: GrokBotEngine;
  private state: GrokBotState;
  private loopInterval: ReturnType<typeof setInterval> | null = null;
  private positionTickInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private sequence = 0;

  private constructor() {
    this.state = this.createInitialStoryState();
  }

  public static getInstance(): GrokBotEngine {
    if (!this.instance) this.instance = new GrokBotEngine();
    return this.instance;
  }

  public getState(): GrokBotState {
    this.state.cloudUptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    return this.state;
  }

  public updateDirective(newDirective: string): { success: boolean; directive: string } {
    this.state.directive = newDirective.trim() || 'Run synthetic DEMO only';
    return { success: true, directive: this.state.directive };
  }

  public stop(): void {
    if (this.loopInterval) clearInterval(this.loopInterval);
    if (this.positionTickInterval) clearInterval(this.positionTickInterval);
    this.loopInterval = null;
    this.positionTickInterval = null;
    this.state.cloudBoxStatus = 'PAUSED';
  }

  public setCloudStatus(status: 'ONLINE' | 'PAUSED'): { success: boolean; status: string } {
    this.stop();
    this.state.cloudBoxStatus = status;
    if (status === 'ONLINE') {
      this.loopInterval = setInterval(() => this.triggerImmediateCycle(), this.state.cycleSpeedMs);
      this.positionTickInterval = setInterval(() => this.tickOpenPositions(), 1000);
    }
    return { success: true, status };
  }

  public setCycleSpeed(speedMs: number): { success: boolean; speedMs: number } {
    if (!Number.isFinite(speedMs)) return { success: false, speedMs: this.state.cycleSpeedMs };
    this.state.cycleSpeedMs = Math.max(1000, Math.min(10000, speedMs));
    this.setCloudStatus(this.state.cloudBoxStatus === 'ONLINE' ? 'ONLINE' : 'PAUSED');
    return { success: true, speedMs: this.state.cycleSpeedMs };
  }

  public resetOrWipe(startingBankroll = 41, preserveDirective = true): GrokBotState {
    if (!Number.isFinite(startingBankroll) || startingBankroll < 0) throw new Error('Invalid demo bankroll');
    const directive = this.state.directive;
    const speed = this.state.cycleSpeedMs;
    this.stop();
    this.startTime = Date.now();
    this.state = this.createInitialStoryState(startingBankroll);
    this.state.cycleSpeedMs = speed;
    if (preserveDirective) this.state.directive = directive;
    return this.state;
  }

  public triggerImmediateCycle(preset: 'GEM' | 'RUG' | 'FAKE_HYPE' = 'GEM'): GrokBotCycleLog {
    const token = { ...DEMO_TOKEN, symbol: `DEMO-${preset}` };
    const ticket = this.calculateDynamicTicketSize();
    const poolDepthSol = preset === 'RUG' ? 4 : 30;
    const slippage = (ticket / (poolDepthSol * SOL_USD)) * 100 + 0.8;
    const action: GrokBotCycleLog['action'] = preset === 'RUG' ? 'SKIP_UNSAFE'
      : preset === 'FAKE_HYPE' ? 'SKIP_FAKE_HYPE'
      : this.state.activePositions.length >= 3 || ticket < 1 || slippage > 3.5 ? 'SKIP_SLIPPAGE' : 'SNIPE_BUY';
    const log: GrokBotCycleLog = {
      id: `DEMO_LOG_${++this.sequence}`, timestamp: Date.now(), symbol: token.symbol,
      tokenName: token.name, poolDepthSol, safetyScore: preset === 'RUG' ? 10 : 90,
      lpLocked: preset !== 'RUG', mintAuthRevoked: preset !== 'RUG', top10ConcentrationPct: 25,
      socialChatterVelocity: 80, mempoolBuyFlowSol: preset === 'FAKE_HYPE' ? 0 : 5,
      chatterVsMempoolRatio: preset === 'FAKE_HYPE' ? 0 : 0.625,
      slippageEstPct: slippage, ticketSizeUsd: ticket, ticketSizeSol: ticket / SOL_USD,
      action, actionReason: `DEMO ONLY: synthetic ${preset} scenario; ${action}. No transaction submitted.`,
    };
    if (action === 'SNIPE_BUY') {
      const entryPriceUsd = 0.001 * (1 + slippage / 100);
      const entryPriceSol = entryPriceUsd / SOL_USD;
      this.state.activePositions.push({
        id: `DEMO_POS_${++this.sequence}`, symbol: token.symbol, name: token.name, tokenMint: token.mint,
        poolDepthSol, entryPriceUsd, currentPriceUsd: entryPriceUsd, entryPriceSol, currentPriceSol: entryPriceSol,
        highestPriceUsd: entryPriceUsd,
        // Whole-token denomination (fractional tokens allowed), never atomic units.
        sizeTokens: ticket / entryPriceUsd, costBasisUsd: ticket, currentValueUsd: ticket,
        unrealizedPnlUsd: 0, unrealizedPnlPct: 0, holdingTimeSec: 0,
        trailingStopPriceUsd: entryPriceUsd * 0.88, nextTakeProfitUsd: entryPriceUsd * 1.45,
        takeProfitStage: 0, safetyScore: 90, socialScore: 80, mempoolFlowSol: 5,
        enteredAt: Date.now(), lastUpdated: Date.now(),
      });
      this.state.cashUsd -= ticket;
      log.entryPriceSol = entryPriceSol;
    }
    this.state.currentInspectedToken = {
      symbol: token.symbol, name: token.name, poolDepthSol, mintAuthRevoked: log.mintAuthRevoked,
      lpLocked: log.lpLocked, top10Pct: 25, socialScore: 80, mempoolFlowSol: log.mempoolBuyFlowSol,
      status: action === 'SNIPE_BUY' ? 'SNIPED' : 'REJECTED', statusText: log.actionReason,
    };
    this.recordLog(log);
    this.recalculateEquity();
    return log;
  }

  private calculateDynamicTicketSize(): number {
    let fraction = 0.12;
    if (this.state.lastExitOutcome === 'WIN') fraction += Math.min(0.08, this.state.lastExitPnlPct / 2000);
    if (this.state.lastExitOutcome === 'LOSS') fraction = this.state.consecutiveLosses >= 2 ? 0.04 : 0.072;
    const ticket = Math.min(450, Math.max(2, this.state.currentEquityUsd * fraction), this.state.cashUsd * 0.75);
    this.state.currentTicketSizeUsd = Math.floor(ticket * 100) / 100;
    return this.state.currentTicketSizeUsd;
  }

  public manualClosePosition(positionId: string): GrokBotPosition | null {
    return this.exitPosition(positionId, 1);
  }

  public manualScaleOut50(positionId: string): GrokBotPosition | null {
    return this.exitPosition(positionId, 0.5);
  }

  public manualBreakevenStop(positionId: string): GrokBotPosition | null {
    const pos = this.state.activePositions.find(p => p.id === positionId);
    if (!pos) return null;
    pos.trailingStopPriceUsd = pos.entryPriceUsd;
    return pos;
  }

  public manualUpdateSlTp(positionId: string, slUsd: number, tpUsd: number): GrokBotPosition | null {
    const pos = this.state.activePositions.find(p => p.id === positionId);
    if (!pos || ![slUsd, tpUsd].every(v => Number.isFinite(v) && v > 0)) return null;
    pos.trailingStopPriceUsd = slUsd;
    pos.nextTakeProfitUsd = tpUsd;
    return pos;
  }

  private markPosition(pos: GrokBotPosition): void {
    pos.currentPriceSol = pos.currentPriceUsd / SOL_USD;
    pos.currentValueUsd = pos.sizeTokens * pos.currentPriceUsd;
    pos.unrealizedPnlUsd = pos.currentValueUsd - pos.costBasisUsd;
    pos.unrealizedPnlPct = pos.costBasisUsd > 0 ? pos.unrealizedPnlUsd / pos.costBasisUsd * 100 : 0;
  }

  private exitPosition(positionId: string, fraction: number): GrokBotPosition | null {
    const pos = this.state.activePositions.find(p => p.id === positionId);
    if (!pos) return null;
    this.markPosition(pos);
    const proceeds = pos.currentValueUsd * fraction;
    const pnlUsd = proceeds - pos.costBasisUsd * fraction;
    const pnlPct = pos.unrealizedPnlPct;
    const fee = pnlUsd > 0 ? pnlUsd * 0.035 : 0;
    this.state.cashUsd += proceeds - fee;
    this.state.serverBillReservedUsd += fee;
    pos.sizeTokens *= 1 - fraction;
    pos.costBasisUsd *= 1 - fraction;
    this.markPosition(pos);
    if (fraction === 1) this.state.activePositions = this.state.activePositions.filter(p => p.id !== positionId);
    this.state.totalFlips++;
    if (pnlUsd > 0) {
      this.state.winningFlips++;
      this.state.consecutiveWins++;
      this.state.consecutiveLosses = 0;
      this.state.lastExitOutcome = 'WIN';
    } else if (pnlUsd < 0) {
      this.state.losingFlips++;
      this.state.consecutiveLosses++;
      this.state.consecutiveWins = 0;
      this.state.lastExitOutcome = 'LOSS';
    } else {
      this.state.consecutiveWins = this.state.consecutiveLosses = 0;
      this.state.lastExitOutcome = 'BREAKEVEN';
    }
    this.state.lastExitPnlPct = pnlPct;
    this.recordLog({
      id: `DEMO_EXIT_${++this.sequence}`, timestamp: Date.now(), symbol: pos.symbol, tokenName: pos.name,
      poolDepthSol: pos.poolDepthSol, safetyScore: pos.safetyScore, lpLocked: true, mintAuthRevoked: true,
      top10ConcentrationPct: 25, socialChatterVelocity: pos.socialScore, mempoolBuyFlowSol: pos.mempoolFlowSol,
      chatterVsMempoolRatio: 0.625, slippageEstPct: 0, ticketSizeUsd: proceeds, ticketSizeSol: proceeds / SOL_USD,
      action: fraction < 1 ? 'SCALE_OUT' : pnlUsd >= 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
      actionReason: `DEMO ONLY: simulated ${fraction * 100}% exit. No transaction submitted.`,
      exitPriceSol: pos.currentPriceSol, pnlUsd, pnlPct,
    });
    this.recalculateEquity();
    this.state.equityCurve.push({ timestamp: Date.now(), equityUsd: this.state.currentEquityUsd, note: 'DEMO simulated exit' });
    if (this.state.equityCurve.length > 80) this.state.equityCurve.shift();
    return pos;
  }

  private tickOpenPositions(): void {
    if (this.state.cloudBoxStatus !== 'ONLINE') return;
    for (const pos of [...this.state.activePositions]) {
      pos.currentPriceUsd *= 1 + (Math.random() - 0.5) * 0.08;
      pos.highestPriceUsd = Math.max(pos.highestPriceUsd, pos.currentPriceUsd);
      pos.holdingTimeSec = Math.floor((Date.now() - pos.enteredAt) / 1000);
      pos.lastUpdated = Date.now();
      this.markPosition(pos);
      if (pos.currentPriceUsd <= pos.trailingStopPriceUsd || pos.unrealizedPnlPct >= 120) {
        this.manualClosePosition(pos.id);
      } else if (pos.currentPriceUsd >= pos.nextTakeProfitUsd && pos.takeProfitStage === 0) {
        pos.takeProfitStage = 1;
        this.manualScaleOut50(pos.id);
      }
    }
    this.recalculateEquity();
  }

  private recordLog(log: GrokBotCycleLog): void {
    this.state.flipHistory.unshift(log);
    this.state.flipHistory = this.state.flipHistory.slice(0, 100);
    this.state.currentCyclePhase = 'IDLE';
  }

  private recalculateEquity(): void {
    for (const pos of this.state.activePositions) this.markPosition(pos);
    this.state.activeExposureUsd = this.state.activePositions.reduce((sum, p) => sum + p.currentValueUsd, 0);
    // Reserve is segregated, excluded from tradable equity, and reported separately.
    this.state.currentEquityUsd = this.state.cashUsd + this.state.activeExposureUsd;
    this.state.peakEquityUsd = Math.max(this.state.peakEquityUsd, this.state.currentEquityUsd);
    const dd = this.state.peakEquityUsd > 0 ? (1 - this.state.currentEquityUsd / this.state.peakEquityUsd) * 100 : 0;
    this.state.maxDrawdownPct = Math.max(this.state.maxDrawdownPct, dd);
    this.state.winRatePct = this.state.totalFlips ? this.state.winningFlips / this.state.totalFlips * 100 : 0;
  }

  private createInitialStoryState(bankroll = 41): GrokBotState {
    return {
      botName: 'Grok DEMO ONLY', directive: 'Run synthetic DEMO only', cloudBoxStatus: 'PAUSED', cloudUptimeSec: 0,
      serverBillReservedUsd: 0, serverBillRatePerDayUsd: 1.5, initialBankrollUsd: bankroll,
      currentEquityUsd: bankroll, cashUsd: bankroll, activeExposureUsd: 0, totalFlips: 0,
      winningFlips: 0, losingFlips: 0, winRatePct: 0, peakEquityUsd: bankroll, maxDrawdownPct: 0,
      nightOneDipUsd: bankroll, consecutiveWins: 0, consecutiveLosses: 0, currentTicketSizeUsd: 0,
      lastExitOutcome: 'NONE', lastExitPnlPct: 0, cycleSpeedMs: 3000, activePositions: [], flipHistory: [],
      equityCurve: [{ timestamp: Date.now(), equityUsd: bankroll, note: 'DEMO simulated bankroll, no trading history' }],
      currentCyclePhase: 'IDLE',
    };
  }
}
