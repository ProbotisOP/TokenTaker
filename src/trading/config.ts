/**
 * System Configuration and Risk Parameters
 */
import { RiskLimits, StrategyWeights, SystemConfig, SystemMode } from '../types.ts';

export type { SystemConfig };

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionPercent: 0.05, // 5% max equity per trade
  maxDailyLossSol: 5.0, // 5 SOL max daily loss
  maxTradeLossSol: 1.0, // 1 SOL max loss per single trade
  maxOpenPositions: 4, // Max 4 concurrent open positions
  maxTokenExposurePercent: 0.08, // 8% max exposure in any single token
  maxSlippagePercent: 3.5, // 3.5% max allowable slippage (standard for Solana memecoin swaps)
  maxConsecutiveLosses: 3, // Auto-halt after 3 consecutive losses
  circuitBreakerActive: false,
};

export const DEFAULT_STRATEGY_WEIGHTS: StrategyWeights = {
  liquidityQuality: 0.18,
  buyPressure: 0.16,
  volumeAcceleration: 0.14,
  holderGrowth: 0.12,
  walletQuality: 0.14,
  priceStructure: 0.12,
  launchQuality: 0.08,
  socialSignal: 0.06,
  // Deductions
  slippageDeduction: 0.15,
  concentrationRisk: 0.20,
  rugProbability: 0.35,
  executionRisk: 0.15,
  // UI tuning aliases
  liquidityScoreWeight: 0.18,
  buyPressureWeight: 0.25,
  walletQualityWeight: 0.20,
  priceVelocityWeight: 0.15,
  volumeVelocityWeight: 0.15,
  rugPenaltyWeight: 0.35,
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  mode: SystemMode.PAPER,
  rpcEndpoint: 'https://api.mainnet-beta.solana.com',
  rpcBackupEndpoint: 'https://solana-mainnet.g.alchemy.com/v2/demo',
  wsEndpoint: 'wss://api.mainnet-beta.solana.com',
  hotWalletPublicKey: '4xKj8...SolQuantHotVault',
  hotWalletSpendingLimitSol: 10.0,
  jitoTipFloorSol: 0.001,
  priorityFeeMicroLamports: 150000, // 150k microLamports per CU
  minSafetyScore: 80, // strict 80+ safety score required
  minOpportunityScore: 65, // 65+ opportunity score required (empirically calibrated positive edge)
  minLiquiditySol: 8.0,
  maxInitialLiquiditySol: 250.0,
  simulationModeOnly: true,
};
