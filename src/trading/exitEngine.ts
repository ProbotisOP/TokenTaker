/**
 * Exit Engine
 * Manages autonomous exits: hard stops, take-profit scaling, trailing stops,
 * flow reversals, liquidity emergencies, and time expiration.
 */
import { LiveMarketMicrostructure, Position } from '../types.ts';

export interface ExitSignal {
  shouldExit: boolean;
  action: 'FULL_EXIT' | 'SCALE_OUT' | 'HOLD';
  pctToSell: number; // 0 to 100
  reason: string;
  tierIndex?: number;
  isEmergency: boolean;
}

export class ExitEngine {
  /**
   * Evaluates position against live microstructure and exits rules
   */
  public static evaluatePosition(position: Position, micro: LiveMarketMicrostructure): ExitSignal {
    const currentPrice = position.currentPriceSol > 0 ? position.currentPriceSol : micro.priceSol;
    const pnlPct = position.entryPriceSol > 0 ? ((currentPrice - position.entryPriceSol) / position.entryPriceSol) * 100 : 0;
    const holdingSec = (Date.now() - position.enteredAt) / 1000;

    // 1. Hard Liquidity Emergency (Rug / LP Drain Attempt)
    if (micro.liquidityChangePct < -25.0) {
      return {
        shouldExit: true,
        action: 'FULL_EXIT',
        pctToSell: 100,
        reason: `LIQUIDITY EMERGENCY: Pool liquidity drained by ${Math.abs(micro.liquidityChangePct).toFixed(1)}%`,
        isEmergency: true,
      };
    }

    // 2. Hard Stop Loss
    if (currentPrice <= position.stopLossPriceSol) {
      return {
        shouldExit: true,
        action: 'FULL_EXIT',
        pctToSell: 100,
        reason: `HARD STOP: Price reached stop loss floor (${pnlPct.toFixed(1)}% PnL)`,
        isEmergency: false,
      };
    }

    // 3. Trailing Stop
    if (position.trailingActivated && currentPrice <= position.trailingStopPriceSol) {
      return {
        shouldExit: true,
        action: 'FULL_EXIT',
        pctToSell: 100,
        reason: `TRAILING STOP: Price fell below dynamic trailing band (${pnlPct.toFixed(1)}% locked profit)`,
        isEmergency: false,
      };
    }

    // 4. Flow Reversal Detection (Momentum breakdown - SIMULATED / PAPER ONLY)
    // Never auto-dump a user's real on-chain trade based on mock flow ticks!
    if (!position.isRealWalletTrade && holdingSec > 15 && micro.buySellRatio < 0.35 && micro.priceVelocity < -2.0) {
      return {
        shouldExit: true,
        action: 'FULL_EXIT',
        pctToSell: 100,
        reason: `FLOW REVERSAL: Sell pressure accelerated (Buy/Sell ratio: ${micro.buySellRatio.toFixed(2)}, Velocity: ${micro.priceVelocity.toFixed(1)}%/s)`,
        isEmergency: false,
      };
    }

    // 5. Take Profit Scale-Out Ladder
    // Check pending ladder tiers
    for (let i = 0; i < position.takeProfitLadder.length; i++) {
      const step = position.takeProfitLadder[i];
      if (!step.filled && currentPrice >= step.targetPriceSol) {
        return {
          tierIndex: i,
          shouldExit: true,
          action: 'SCALE_OUT',
          pctToSell: step.pctToSell,
          reason: `TAKE PROFIT LADDER TIER ${i + 1}: Target price reached (+${pnlPct.toFixed(0)}%)`,
          isEmergency: false,
        };
      }
    }

    // 6. Time-based Expiration (Dead Launch Timeout - SIMULATED / PAPER ONLY)
    // Real trades are managed by user 1-click exit, SL floor, and TP ladder!
    if (!position.isRealWalletTrade && holdingSec > 180 && pnlPct < 5.0 && micro.windows['30s'].volumeSol < 0.5) {
      return {
        shouldExit: true,
        action: 'FULL_EXIT',
        pctToSell: 100,
        reason: `TIME EXPIRATION: Launch stalled after ${Math.round(holdingSec)}s with decaying volume`,
        isEmergency: false,
      };
    }

    return {
      shouldExit: false,
      action: 'HOLD',
      pctToSell: 0,
      reason: 'HOLD: Momentum criteria within acceptable variance',
      isEmergency: false,
    };
  }

  /**
   * Initializes ladder and trailing stops for a newly opened position
   */
  public static createLadder(entryPriceSol: number): {
    stopLossPriceSol: number;
    takeProfitLadder: { targetPriceSol: number; pctToSell: number; filled: boolean }[];
    trailingStopPriceSol: number;
  } {
    // 15% stop loss floor
    const stopLossPriceSol = entryPriceSol * 0.85;

    // Scale out ladder:
    // Tier 1: +45% gain -> sell 35% of position
    // Tier 2: +90% gain -> sell 35% of position
    // Remainder (30%) rides with trailing stop
    const takeProfitLadder = [
      { targetPriceSol: entryPriceSol * 1.45, pctToSell: 35, filled: false },
      { targetPriceSol: entryPriceSol * 1.90, pctToSell: 35, filled: false },
    ];

    // Initial trailing stop set at entry price (activated once in profit >= 25%)
    const trailingStopPriceSol = entryPriceSol;

    return {
      stopLossPriceSol,
      takeProfitLadder,
      trailingStopPriceSol,
    };
  }

  /**
   * Dynamically adjusts trailing stop as price sets new highs
   */
  public static updateTrailingStop(position: Position, currentPriceSol: number): {
    newTrailingPriceSol: number;
    trailingActivated: boolean;
    peakPriceUsd: number;
    peakPriceSol: number;
  } {
    const priorPeak = (position as Position & { peakPriceSol?: number }).peakPriceSol;
    const peakPriceSol = Math.max(Number.isFinite(priorPeak) ? priorPeak! : position.entryPriceSol, currentPriceSol);
    const peakPriceUsd = position.peakPriceUsd;

    const gainPct = ((currentPriceSol - position.entryPriceSol) / position.entryPriceSol) * 100;
    let trailingActivated = position.trailingActivated;
    let newTrailingPriceSol = position.trailingStopPriceSol;

    // Activate trailing stop once position reaches +25% profit
    if (gainPct >= 25.0) {
      trailingActivated = true;
      // Trail by 14% below highest recorded price
      const proposedTrailing = peakPriceSol * 0.86;
      newTrailingPriceSol = Math.max(newTrailingPriceSol, proposedTrailing);
    }

    return {
      newTrailingPriceSol,
      trailingActivated,
      peakPriceUsd,
      peakPriceSol,
    };
  }
}
