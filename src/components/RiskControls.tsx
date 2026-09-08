import React, { useState, useEffect } from 'react';
import {
  Sliders,
  ShieldAlert,
  Save,
  RotateCcw,
  Check,
  Scale,
} from 'lucide-react';
import { RiskLimits, StrategyWeights } from '../types.ts';
import { DEFAULT_RISK_LIMITS, DEFAULT_STRATEGY_WEIGHTS } from '../trading/config.ts';

interface RiskControlsProps {
  currentLimits: RiskLimits;
  currentWeights: StrategyWeights;
  onUpdateRisk: (limits: Partial<RiskLimits>) => void | Promise<void>;
  onUpdateWeights: (weights: Partial<StrategyWeights>) => void | Promise<void>;
}

export const RiskControls: React.FC<RiskControlsProps> = ({
  currentLimits,
  currentWeights,
  onUpdateRisk,
  onUpdateWeights,
}) => {
  const [limits, setLimits] = useState<RiskLimits>({ ...currentLimits });
  const [weights, setWeights] = useState<StrategyWeights>({ ...currentWeights });
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Synchronize local form state whenever parent props update
  useEffect(() => {
    setLimits({ ...currentLimits });
  }, [currentLimits]);

  useEffect(() => {
    setWeights({ ...currentWeights });
  }, [currentWeights]);

  // Reset to system factory defaults and immediately commit to the trading engine
  const handleResetDefaults = async () => {
    setIsResetting(true);
    try {
      const defaultLimits: RiskLimits = { ...DEFAULT_RISK_LIMITS };
      const defaultWeights: StrategyWeights = { ...DEFAULT_STRATEGY_WEIGHTS };

      setLimits(defaultLimits);
      setWeights(defaultWeights);

      await Promise.all([
        Promise.resolve(onUpdateRisk(defaultLimits)),
        Promise.resolve(onUpdateWeights(defaultWeights)),
      ]);

      setSavedMessage('Default system risk parameters & alpha weights restored and applied.');
      setTimeout(() => setSavedMessage(null), 3500);
    } catch (err) {
      console.error('Failed to reset to defaults:', err);
    } finally {
      setIsResetting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const normalizedWeights: StrategyWeights = {
        ...weights,
        liquidityQuality: weights.liquidityScoreWeight ?? weights.liquidityQuality ?? 0.18,
        buyPressure: weights.buyPressureWeight ?? weights.buyPressure ?? 0.16,
        volumeAcceleration: weights.volumeVelocityWeight ?? weights.volumeAcceleration ?? 0.14,
        walletQuality: weights.walletQualityWeight ?? weights.walletQuality ?? 0.14,
        priceStructure: weights.priceVelocityWeight ?? weights.priceStructure ?? 0.12,
        rugProbability: weights.rugPenaltyWeight ?? weights.rugProbability ?? 0.35,
      };

      await Promise.all([
        Promise.resolve(onUpdateRisk(limits)),
        Promise.resolve(onUpdateWeights(normalizedWeights)),
      ]);

      setSavedMessage('Risk parameters & alpha weights synchronized to active trading core.');
      setTimeout(() => setSavedMessage(null), 3500);
    } catch (err) {
      console.error('Failed to save parameters:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Safe normalized values with fallbacks
  const liquidityScoreVal =
    weights.liquidityScoreWeight ?? weights.liquidityQuality ?? DEFAULT_STRATEGY_WEIGHTS.liquidityScoreWeight ?? 0.18;
  const buyPressureVal =
    weights.buyPressureWeight ?? weights.buyPressure ?? DEFAULT_STRATEGY_WEIGHTS.buyPressureWeight ?? 0.25;
  const walletQualityVal =
    weights.walletQualityWeight ?? weights.walletQuality ?? DEFAULT_STRATEGY_WEIGHTS.walletQualityWeight ?? 0.20;
  const priceVelocityVal =
    weights.priceVelocityWeight ?? weights.priceStructure ?? DEFAULT_STRATEGY_WEIGHTS.priceVelocityWeight ?? 0.15;
  const volumeVelocityVal =
    weights.volumeVelocityWeight ?? weights.volumeAcceleration ?? DEFAULT_STRATEGY_WEIGHTS.volumeVelocityWeight ?? 0.15;
  const rugPenaltyVal =
    weights.rugPenaltyWeight ?? weights.rugProbability ?? DEFAULT_STRATEGY_WEIGHTS.rugPenaltyWeight ?? 0.35;

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-indigo-400" />
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
            System Risk Gates &amp; Alpha Model Tuning
          </h2>
        </div>
        <div className="text-[11px] font-mono text-zinc-500">
          Deterministic Hard Limits &bull; Anti-Martingale Position Sizing
        </div>
      </div>

      <div className="p-4 space-y-6 overflow-y-auto text-xs font-mono">
        {savedMessage && (
          <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 rounded flex items-center gap-2 transition-all">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{savedMessage}</span>
          </div>
        )}

        {/* Hard Risk Limits Section */}
        <div>
          <h3 className="font-bold text-zinc-200 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            Absolute Risk Limits (Authority to Reject)
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-zinc-950/60 p-4 rounded-lg border border-zinc-800">
            <div>
              <label className="block text-zinc-400 mb-1">
                Max Position Allocation (%):{' '}
                <span className="text-zinc-200 font-bold">{(limits.maxPositionPercent * 100).toFixed(1)}%</span>
              </label>
              <input
                type="range"
                min="0.01"
                max="0.10"
                step="0.005"
                value={limits.maxPositionPercent}
                onChange={(e) => setLimits({ ...limits, maxPositionPercent: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <div className="text-[10px] text-zinc-500 mt-1">Capped at 10% max of equity (Kelly ceiling)</div>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Max Daily Loss (SOL): <span className="text-rose-400 font-bold">{limits.maxDailyLossSol} SOL</span>
              </label>
              <input
                type="range"
                min="1"
                max="25"
                step="0.5"
                value={limits.maxDailyLossSol}
                onChange={(e) => setLimits({ ...limits, maxDailyLossSol: parseFloat(e.target.value) })}
                className="w-full accent-rose-500 cursor-pointer"
              />
              <div className="text-[10px] text-zinc-500 mt-1">Triggers day trading halt when breached</div>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Max Single Trade Loss (SOL): <span className="text-amber-400 font-bold">{limits.maxTradeLossSol} SOL</span>
              </label>
              <input
                type="range"
                min="0.2"
                max="5.0"
                step="0.1"
                value={limits.maxTradeLossSol}
                onChange={(e) => setLimits({ ...limits, maxTradeLossSol: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="text-[10px] text-zinc-500 mt-1">Single stop loss dollar loss floor</div>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Max Concurrent Positions: <span className="text-zinc-200 font-bold">{limits.maxOpenPositions}</span>
              </label>
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                value={limits.maxOpenPositions}
                onChange={(e) => setLimits({ ...limits, maxOpenPositions: parseInt(e.target.value, 10) })}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <div className="text-[10px] text-zinc-500 mt-1">Prevents over-exposure to market regimes</div>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Max Slippage Ceiling (%): <span className="text-amber-400 font-bold">{limits.maxSlippagePercent}%</span>
              </label>
              <input
                type="range"
                min="1.0"
                max="6.0"
                step="0.2"
                value={limits.maxSlippagePercent}
                onChange={(e) => setLimits({ ...limits, maxSlippagePercent: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="text-[10px] text-zinc-500 mt-1">Orders exceeding this are aborted pre-flight</div>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Consecutive Loss Circuit Breaker:{' '}
                <span className="text-rose-400 font-bold">{limits.maxConsecutiveLosses} Losses</span>
              </label>
              <input
                type="range"
                min="2"
                max="6"
                step="1"
                value={limits.maxConsecutiveLosses}
                onChange={(e) => setLimits({ ...limits, maxConsecutiveLosses: parseInt(e.target.value, 10) })}
                className="w-full accent-rose-500 cursor-pointer"
              />
              <div className="text-[10px] text-zinc-500 mt-1">Shuts down scanner if loss streak is hit</div>
            </div>
          </div>
        </div>

        {/* Strategy Alpha Weights Section */}
        <div>
          <h3 className="font-bold text-zinc-200 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Scale className="w-4 h-4 text-cyan-400" />
            Normalized Opportunity Model Weights
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-zinc-950/60 p-4 rounded-lg border border-zinc-800">
            <div>
              <label className="block text-zinc-400 mb-1">
                Liquidity Quality Weight:{' '}
                <span className="text-zinc-200 font-bold">{(liquidityScoreVal * 100).toFixed(0)}%</span>
              </label>
              <input
                type="range"
                min="0.05"
                max="0.40"
                step="0.01"
                value={liquidityScoreVal}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setWeights({ ...weights, liquidityScoreWeight: val, liquidityQuality: val });
                }}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Buy Pressure / Ratio Weight:{' '}
                <span className="text-zinc-200 font-bold">{(buyPressureVal * 100).toFixed(0)}%</span>
              </label>
              <input
                type="range"
                min="0.10"
                max="0.50"
                step="0.01"
                value={buyPressureVal}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setWeights({ ...weights, buyPressureWeight: val, buyPressure: val });
                }}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Wallet Flow Quality Weight:{' '}
                <span className="text-zinc-200 font-bold">{(walletQualityVal * 100).toFixed(0)}%</span>
              </label>
              <input
                type="range"
                min="0.05"
                max="0.40"
                step="0.01"
                value={walletQualityVal}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setWeights({ ...weights, walletQualityWeight: val, walletQuality: val });
                }}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Price Velocity Weight:{' '}
                <span className="text-zinc-200 font-bold">{(priceVelocityVal * 100).toFixed(0)}%</span>
              </label>
              <input
                type="range"
                min="0.05"
                max="0.30"
                step="0.01"
                value={priceVelocityVal}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setWeights({ ...weights, priceVelocityWeight: val, priceStructure: val });
                }}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Volume Velocity Weight:{' '}
                <span className="text-zinc-200 font-bold">{(volumeVelocityVal * 100).toFixed(0)}%</span>
              </label>
              <input
                type="range"
                min="0.05"
                max="0.30"
                step="0.01"
                value={volumeVelocityVal}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setWeights({ ...weights, volumeVelocityWeight: val, volumeAcceleration: val });
                }}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">
                Rug Penalty Factor: <span className="text-rose-400 font-bold">{rugPenaltyVal.toFixed(2)}x</span>
              </label>
              <input
                type="range"
                min="0.10"
                max="0.70"
                step="0.02"
                value={rugPenaltyVal}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setWeights({ ...weights, rugPenaltyWeight: val, rugProbability: val });
                }}
                className="w-full accent-rose-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={handleResetDefaults}
            disabled={isResetting}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold transition active:scale-95 disabled:opacity-50 cursor-pointer"
            title="Restore and apply system factory default limits and weights"
          >
            <RotateCcw className={`w-3.5 h-3.5 text-zinc-400 ${isResetting ? 'animate-spin' : ''}`} />
            <span>{isResetting ? 'Restoring...' : 'Reset to Defaults'}</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-5 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase tracking-wider transition shadow-lg shadow-indigo-950/50 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Applying...' : 'Apply Parameters'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
