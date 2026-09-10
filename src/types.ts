/**
 * Production-Grade Autonomous Solana Memecoin Trading System
 * Global Type Definitions
 */

export enum SystemMode {
  BACKTEST = 'BACKTEST',
  PAPER = 'PAPER',
  SHADOW = 'SHADOW',
  LIVE = 'LIVE',
  EMERGENCY_STOP = 'EMERGENCY_STOP',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum LaunchVenue {
  PUMPFUN = 'Pump.fun',
  RAYDIUM_AMM_V4 = 'Raydium AMM V4',
  RAYDIUM_CPMM = 'Raydium CPMM',
  METEORA_DLMM = 'Meteora DLMM',
}

export enum WalletCategory {
  UNKNOWN = 'unknown',
  NEW = 'new',
  PROFITABLE_TRADER = 'profitable_trader',
  HIGH_FREQUENCY = 'high-frequency',
  SNIPER = 'sniper',
  INSIDER_LIKE = 'insider-like',
  CREATOR_LINKED = 'creator-linked',
  SYBIL_SUSPICIOUS = 'sybil/suspicious',
}

export enum DecisionAction {
  BUY = 'BUY',
  WAIT = 'WAIT',
  REJECT = 'REJECT',
  HOLD = 'HOLD',
  EXIT_HARD_STOP = 'EXIT_HARD_STOP',
  EXIT_TAKE_PROFIT = 'EXIT_TAKE_PROFIT',
  EXIT_TRAILING = 'EXIT_TRAILING',
  EXIT_FLOW_REVERSAL = 'EXIT_FLOW_REVERSAL',
  EXIT_LIQUIDITY_EMERGENCY = 'EXIT_LIQUIDITY_EMERGENCY',
  EXIT_TIME_EXPIRATION = 'EXIT_TIME_EXPIRATION',
  EMERGENCY_DUMP = 'EMERGENCY_DUMP',
}

export enum TradeStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CLOSED = 'CLOSED',
}

export interface LatencyBreakdown {
  detected_at: number;
  parsed_at: number;
  scored_at: number;
  decision_at: number;
  submitted_at: number;
  confirmed_at: number;
  total_latency_ms: number;
  detection_to_decision_ms: number;
  execution_flight_ms: number;
}

export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  created_at: number;
  poolAddress: string;
  launchVenue: LaunchVenue;
  baseAsset: string;
  quoteAsset: string;
  initialLiquiditySol: number;
  initialLiquidityUsd: number;
  initialPriceSol: number;
  initialPriceUsd: number;
  currentPriceUsd: number;
  tokenProgram: string;
  signature: string;
  poolCreationTx: string;
}

export interface TokenSafetyReport {
  safetyScore: number; // 0 to 100
  riskLevel: RiskLevel;
  rejectReasons: string[];
  isTradable: boolean;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  lpBurnOrLocked: boolean;
  lpBurnPct: number;
  tokenProgramSafe: boolean;
  suspiciousExtensions: string[];
  supplyAnomalies: boolean;
  top1Percent: number;
  top5Percent: number;
  top10Percent: number;
  creatorOwnershipPercent: number;
  insiderClusterDetected: boolean;
  bundledWalletsDetected: number;
  washTradingDetected: boolean;
  creatorDumpRisk: boolean;
  checks?: {
    mintAuthorityRevoked?: boolean;
    freezeAuthorityRevoked?: boolean;
    lpBurnedOrLocked?: boolean;
    supplyMatch?: boolean;
    tokenProgramLegitimate?: boolean;
    topHoldersSafe?: boolean;
    noSuspiciousExtensions?: boolean;
  };
}

export interface MicroWindowStats {
  priceChangePct: number;
  volumeSol: number;
  buyVolumeSol: number;
  sellVolumeSol: number;
  buySellRatio: number;
  tradeCount: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  netFlowSol: number;
}

export interface LiveMarketMicrostructure {
  priceUsd: number;
  priceSol: number;
  volumeSol: number;
  buyVolumeSol: number;
  sellVolumeSol: number;
  buySellRatio: number;
  liquiditySol: number;
  liquidityUsd: number;
  marketCapUsd: number;
  priceVelocity: number; // %/sec
  volumeVelocity: number; // Sol/sec
  uniqueBuyers: number;
  uniqueSellers: number;
  newWalletRate: number; // new wallets / total buyers
  holderGrowth: number; // holders / sec
  liquidityChangePct: number; // % change since pool creation
  largeWalletActivityCount: number;
  windows: {
    '1s': MicroWindowStats;
    '3s': MicroWindowStats;
    '5s': MicroWindowStats;
    '10s': MicroWindowStats;
    '30s': MicroWindowStats;
    '60s': MicroWindowStats;
  };
}

export interface WalletProfile {
  address: string;
  category: WalletCategory;
  realizedPnlSol: number;
  winRate: number; // 0-1
  avgHoldingSec: number;
  avgEntryTimingSec: number;
  realizedTradesCount: number;
  tokenOverlapCount: number;
  behaviorDuringRugs: 'dumped_first' | 'held_to_zero' | 'neutral';
  reputationScore: number; // -100 to 100
}

export interface AlphaScoreComponents {
  liquidityQuality: number; // 0-1
  buyPressure: number; // 0-1
  volumeAcceleration: number; // 0-1
  holderGrowth: number; // 0-1
  walletQuality: number; // 0-1
  priceStructure: number; // 0-1
  launchQuality: number; // 0-1
  socialSignal: number; // 0-1
  // Deductions
  slippageDeduction: number; // 0-1
  concentrationRisk: number; // 0-1
  rugProbability: number; // 0-1
  executionRisk: number; // 0-1
}

export interface OpportunityScoreOutput {
  opportunityScore: number; // 0-100
  expectedReturnPct: number;
  expectedLossPct: number;
  expectedSlippagePct: number;
  rugProbabilityPct: number;
  executionProbabilityPct: number;
  confidencePct: number;
  components: AlphaScoreComponents;
}

export interface SocialIntelligence {
  mentionVelocity: number; // mentions / min
  uniqueAccounts: number;
  engagementVelocity: number;
  sentimentScore: number; // -1 to +1
  influencerConcentration: number; // 0 to 1
  botProbability: number; // 0 to 1
  isCoordinatedPump: boolean;
  socialCapitalCorrelation: number; // -1 to +1 (does social correlate with genuine SOL?)
}

export interface ExecutionPreCheck {
  tokenMint: string;
  expectedFillPriceSol: number;
  expectedFillPriceUsd: number;
  priceImpactPct: number;
  expectedSlippagePct: number;
  priorityFeeMicroLamports: number;
  networkFeeSol: number;
  jitoTipSol: number;
  mevRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  simulationSuccess: boolean;
  simulationError?: string;
  justifiesEdge: boolean;
  netExpectedEdgePct: number;
}

export interface Position {
  id: string;
  tokenMint: string;
  symbol: string;
  name: string;
  entryPriceSol: number;
  entryPriceUsd: number;
  currentPriceSol: number;
  currentPriceUsd: number;
  peakPriceUsd: number;
  peakPriceSol?: number;
  lastPriceAt?: number;
  lowestPriceUsd: number;
  sizeTokens: number;
  sizeBaseUnits?: string;
  tokenDecimals?: number;
  costBasisSol: number;
  currentValueSol: number;
  unrealizedPnlSol: number;
  unrealizedPnlPct: number;
  realizedPnlSol: number;
  enteredAt: number;
  holdingSec: number;
  stopLossPriceSol: number;
  takeProfitLadder: {
    targetPriceSol: number;
    pctToSell: number;
    filled: boolean;
  }[];
  trailingStopPriceSol: number;
  trailingActivated: boolean;
  status: 'OPEN' | 'CLOSED';
  closedAt?: number;
  exitReason?: string;
  isRealWalletTrade?: boolean;
  walletAddress?: string;
  executionVenue?: string;
  executionType?: 'PAPER_SIMULATED' | 'LIVE_ON_CHAIN';
  isSimulated?: boolean;
  simulationBadgeText?: string;
  txSignature?: string;
  solscanUrl?: string;
  exitTxSignature?: string;
  exitSolscanUrl?: string;
  executionHistory: {
    action: 'ENTRY' | 'SCALE_OUT' | 'STOP' | 'EMERGENCY' | 'BUY' | 'SELL';
    priceSol: number;
    tokens: number;
    pnlSol: number;
    timestamp: number;
    txSignature?: string;
  }[];
}

export interface TradeDecisionRecord {
  id: string;
  tokenMint: string;
  symbol: string;
  timestamp: number;
  decision: DecisionAction;
  decisionReasons: string[];
  safetyScore: number;
  opportunityScore: number;
  liquiditySol: number;
  walletScore: number;
  expectedEdgePct: number;
  expectedSlippagePct: number;
  positionSizeSol: number;
  latencyBreakdown: LatencyBreakdown;
  executionType?: 'PAPER_SIMULATED' | 'LIVE_ON_CHAIN';
  isSimulated?: boolean;
  executionResult: {
    txSignature?: string;
    expectedPriceSol: number;
    actualPriceSol: number;
    expectedSlippagePct: number;
    actualSlippagePct: number;
    priorityFeeSol: number;
    status: TradeStatus;
    confirmedAt: number;
  };
  realizedPnlSol: number;
  realizedPnlPct: number;
  exitReason?: string;
  aiAutopsy?: string;
}

export interface RiskLimits {
  maxPositionPercent: number; // max % of total equity per position (e.g. 5%)
  maxDailyLossSol: number; // max allowable daily drawdown in SOL
  maxTradeLossSol: number; // max single trade loss threshold
  maxOpenPositions: number; // max simultaneous open positions
  maxTokenExposurePercent: number; // max % in a single token
  maxSlippagePercent: number; // max slippage allowed (e.g. 2.5%)
  maxConsecutiveLosses: number; // halt after N consecutive losses
  circuitBreakerActive: boolean;
  circuitBreakerReason?: string;
}

export interface PortfolioState {
  cashSol: number;
  equitySol: number;
  activeExposureSol: number;
  dailyRealizedPnlSol: number;
  totalRealizedPnlSol: number;
  unrealizedPnlSol: number;
  peakEquitySol: number;
  currentDrawdownPct: number;
  maxDrawdownPct: number;
  consecutiveLosses: number;
  rollingWinRate: number;
  rollingExpectancySol: number;
  profitFactor: number;
  tradeCount: number;
  adaptiveMultiplier: number; // between 0.25 and 1.25
}

export interface BacktestTrade {
  tokenMint: string;
  symbol: string;
  entryTimestamp: number;
  exitTimestamp: number;
  entryPriceSol: number;
  exitPriceSol: number;
  sizeTokens: number;
  costBasisSol: number;
  grossPnlSol: number;
  feesPaidSol: number;
  slippageCostSol: number;
  netPnlSol: number;
  netPnlPct: number;
  holdingSec: number;
  exitReason: string;
  launchVenue: LaunchVenue;
  initialLiquidityBucket: '<10SOL' | '10-50SOL' | '50-100SOL' | '>100SOL';
  marketCapBucket: '<50k' | '50k-250k' | '250k-1M' | '>1M';
  opportunityScoreBucket: '70-80' | '80-90' | '90-100';
  marketRegime: 'TRENDING_BULL' | 'CHOPPY_RUG_HEAVY' | 'LOW_LIQUIDITY_SLOW';
}

export interface BacktestResults {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  expectancySol: number;
  cagrPct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  averageWinnerSol: number;
  averageLoserSol: number;
  totalFeesPaidSol: number;
  totalSlippageCostSol: number;
  equityCurve: { timestamp: number; equity: number; drawdown: number }[];
  venueBreakdown: Record<string, { trades: number; winRate: number; pnlSol: number }>;
  liquidityBreakdown: Record<string, { trades: number; winRate: number; pnlSol: number }>;
  scoreBreakdown: Record<string, { trades: number; winRate: number; pnlSol: number }>;
  regimeBreakdown: Record<string, { trades: number; winRate: number; pnlSol: number }>;
  walkForwardSummary: {
    trainWinRate: number;
    valWinRate: number;
    oosWinRate: number;
    degradationPct: number;
  };
  monteCarlo: {
    iterations: number;
    p5Drawdown: number;
    medianDrawdown: number;
    p95Drawdown: number;
    simulatedPaths: { pathIndex: number; points: { x: number; y: number }[] }[];
  };
}

export interface StrategyWeights {
  liquidityQuality: number;
  buyPressure: number;
  volumeAcceleration: number;
  holderGrowth: number;
  walletQuality: number;
  priceStructure: number;
  launchQuality: number;
  socialSignal: number;
  slippageDeduction: number;
  concentrationRisk: number;
  rugProbability: number;
  executionRisk: number;
  // UI tuning aliases
  liquidityScoreWeight?: number;
  buyPressureWeight?: number;
  walletQualityWeight?: number;
  priceVelocityWeight?: number;
  volumeVelocityWeight?: number;
  rugPenaltyWeight?: number;
}

export interface SystemConfig {
  mode: SystemMode;
  rpcEndpoint: string;
  rpcBackupEndpoint: string;
  wsEndpoint: string;
  hotWalletPublicKey: string;
  hotWalletSpendingLimitSol: number;
  jitoTipFloorSol: number;
  priorityFeeMicroLamports: number;
  minSafetyScore: number;
  minOpportunityScore: number;
  minLiquiditySol: number;
  maxInitialLiquiditySol: number;
  simulationModeOnly: boolean;
}

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
  entryStage?: import('./trading/earlyEntryEngine.ts').EntryStage;
  dataSource?: 'PUMPPORTAL';
  inspectedAt?: number;
  inspectionError?: string;
  curveVerified?: boolean;
  entryMetrics?: import('./trading/earlyEntryEngine.ts').EntryEvaluation;
  executionStatus?: 'NOT_SUBMITTED' | 'CHECKING_ROUTE' | 'CONFIRMED' | 'BLOCKED';
  executionError?: string;
  // Strictly separated 4-dimension audit metrics
  exitabilityScore?: number; // 0-100
  empiricalWinProb?: number; // 0-1
  calibratedKellyPct?: number; // 0-100%
}

// -------------------------------------------------------------
// ALPHA VALIDATION AUDIT & COUNTERFACTUAL DATASETS
// -------------------------------------------------------------

export type TimeHorizonKey = '100ms' | '250ms' | '500ms' | '1s' | '3s' | '5s' | '10s' | '30s' | '60s';

export interface HorizonOutcome {
  horizon: TimeHorizonKey;
  horizonMs: number;
  rawReturnPct: number;
  netReturnPct: number;
  priceSol: number;
  cumulativeSlippagePct: number;
  estimatedVolumeSol: number;
}

export interface CounterfactualLaunchRecord {
  id: string;
  tokenMint: string;
  symbol: string;
  launchVenue: LaunchVenue;
  launchTimestamp: number;
  initialLiquiditySol: number;
  // Four Separated Core Metrics:
  safetyScore: number;          // [1] Pre-trade contract & rug safety (0-100)
  exitabilityScore: number;     // [2] Liquidity depth & sell capacity (0-100)
  expectedReturnPct: number;    // [3] Unbiased directional expectation (%)
  executionProbabilityPct: number; // [4] Slot inclusion & fill prob (0-100%)
  
  engineDecision: DecisionAction; // BUY | WAIT | REJECT
  decisionReason: string;
  
  // Realized forward trajectories across horizons
  horizons: Record<TimeHorizonKey, HorizonOutcome>;
  isRug: boolean;
  maxDrawdownPostLaunchPct: number;
  peakMultiplier: number;
}

export interface EmpiricalCalibrationBin {
  scoreRange: string;
  minScore: number;
  maxScore: number;
  sampleCount: number;
  predictedProb: number;      // Model predicted probability
  empiricalWinRate: number;    // Realized empirical win frequency
  meanWinnerPct: number;       // Realized average win size
  meanLoserPct: number;        // Realized average loss size
  payoffRatio: number;         // b = W / L
  expectancyPct: number;       // E = p*b - (1-p)
  calibratedKellyFraction: number; // continuous Kelly
  recommendedSafeKellyPct: number; // fractional Kelly ceiling
}

export interface FeatureAblationItem {
  name: string;
  description: string;
  isBaseline: boolean;
  sampleCount: number;
  winRatePct: number;
  netExpectancySol: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  probabilityOfRuinPct: number;
  informationCoefficient: number; // Rank IC vs 10s forward return
  status: 'OUTPERFORMS_BASELINE' | 'INFERIOR_TO_BASELINE' | 'PRUNED_NOISY';
}

export interface ModelVersionRecord {
  version: string;
  name: string;
  createdAt: string;
  status: 'ACTIVE_PRODUCTION' | 'VALIDATED_CANDIDATE' | 'REJECTED_OVERFIT' | 'ARCHIVED';
  featuresIncluded: string[];
  featuresPruned: string[];
  inSampleSharpe: number;
  oosSharpe: number;
  oosWinRatePct: number;
  oosNetExpectancySol: number;
  brierScore: number; // Probabilistic calibration error (lower = better)
  calibrationNotes: string;
}

export interface AlphaValidationAuditReport {
  timestamp: number;
  sampleUniverseSize: number;
  venueBreakdownCount: Record<string, number>;
  timeHorizonKeys: TimeHorizonKey[];
  
  // Core Quantitative Insights
  observableEdgeBehavior: {
    primarySignal: string;
    mechanism: string;
    whyItWorks: string;
    failureModes: string[];
  };
  
  grossVsNetCostDrag: {
    grossEdgePct: number;
    ammSwapFeePct: number;
    priorityFeeEquivalentPct: number;
    latencySlippageDragPct: number;
    exitabilityCostPct: number;
    totalFrictionDragPct: number;
    netRealizedEdgePct: number;
    isSurvivingCosts: boolean;
  };
  
  alphaDecayProfile: {
    peakAlphaHorizon: TimeHorizonKey;
    halfLifeMs: number;
    decayCurve: { horizon: TimeHorizonKey; buyGroupNetPct: number; rejectGroupNetPct: number; diffAlphaPct: number }[];
  };
  
  empiricalCalibration: {
    bins: EmpiricalCalibrationBin[];
    brierScore: number;
    calibrationReliability: 'STRONG' | 'MODERATE' | 'POOR';
  };
  
  ablationSuite: FeatureAblationItem[];
  
  streakSizingComparison: {
    fixedFractional: { sharpe: number; maxDd: number; finalEquity: number; pRuin: number };
    streakAntiMartingale: { sharpe: number; maxDd: number; finalEquity: number; pRuin: number };
    verdict: string;
  };
  
  modelRegistry: ModelVersionRecord[];
  
  overallVerdict: {
    hasGenuineOosEdge: boolean;
    confidenceLevel: string;
    recommendationSummary: string;
  };
}

// ----------------------------------------------------
// BOUNDED PARAMETER TUNER TYPES
// ----------------------------------------------------

export interface TuningAcceptanceCriteria {
  minOosExpectancySol: number; // e.g. 0.25 SOL per trade net
  minOosWinRatePct: number;    // e.g. 55.0%
  maxDrawdownPct: number;      // e.g. 15.0%
  minProfitFactor: number;     // e.g. 1.75
  minOosSampleSize: number;    // e.g. 30 trades
  maxBrierScore: number;       // e.g. 0.12 (calibration error threshold)
}

export interface TuningTerminationConditions {
  maxRuntimeMs: number;        // e.g. 10000ms
  maxIterations: number;       // e.g. 50 iterations
  minOosSampleSize: number;    // e.g. 30 trades required to validate
  stagnationLimit: number;     // e.g. 12 iterations without improvement
}

export interface TuningCandidateParameters {
  minSafetyScore: number;
  minOpportunityScore: number;
  slippageTolerancePct: number;
  maxDrawdownExitPct: number;
  takeProfitMultiplier: number;
  stopLossPct: number;
  walletMinReputation: number;
  liquidityHurdleSol: number;
}

export interface TuningCandidateEvaluation {
  iteration: number;
  parameters: TuningCandidateParameters;
  objectiveScore: number;
  oosExpectancySol: number;
  oosWinRatePct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  oosSampleSize: number;
  calibrationBrierScore: number;
  calibrationReliability: 'STRONG' | 'MODERATE' | 'POOR';
  sharpeRatio: number;
  passedAllCriteria: boolean;
  failedCriteria: string[];
}

export type TuningTerminationReason =
  | 'TARGET_CRITERIA_MET'
  | 'MAX_ITERATIONS_REACHED'
  | 'MAX_RUNTIME_EXCEEDED'
  | 'STAGNATION_DETECTED'
  | 'INSUFFICIENT_SAMPLE_SIZE'
  | 'USER_ABORTED';

export interface TuningProgressState {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'STOPPED';
  currentIteration: number;
  maxIterations: number;
  elapsedMs: number;
  maxRuntimeMs: number;
  currentBestScore: number;
  currentlyFailingCriteria: string[];
  bestCandidateSoFar: TuningCandidateEvaluation | null;
  terminationReason: TuningTerminationReason | null;
}

export interface TuningRunResult {
  verdict: 'PASS' | 'FAIL';
  verdictSummary: string;
  terminationReason: TuningTerminationReason;
  elapsedMs: number;
  totalIterations: number;
  bestCandidate: TuningCandidateEvaluation;
  terminationConditions: TuningTerminationConditions;
  acceptanceCriteria: TuningAcceptanceCriteria;
  failedCriteria: string[];
  searchHistory: { iteration: number; score: number; oosWinRate: number; oosExp: number; passed: boolean }[];
}

// ----------------------------------------------------
// GROK AUTONOMOUS MEMECOIN FLIPPER (PAPER BOT) TYPES
// ----------------------------------------------------

export interface GrokBotCycleLog {
  id: string;
  timestamp: number;
  symbol: string;
  tokenName: string;
  poolDepthSol: number;
  safetyScore: number;
  lpLocked: boolean;
  mintAuthRevoked: boolean;
  top10ConcentrationPct: number;
  socialChatterVelocity: number; // e.g. 84 mentions/min
  mempoolBuyFlowSol: number; // e.g. 14.2 SOL
  chatterVsMempoolRatio: number; // genuine accumulation vs noise
  slippageEstPct: number;
  ticketSizeUsd: number;
  ticketSizeSol: number;
  action: 'SNIPE_BUY' | 'SKIP_UNSAFE' | 'SKIP_FAKE_HYPE' | 'SKIP_SLIPPAGE' | 'SCALE_OUT' | 'TAKE_PROFIT' | 'STOP_LOSS';
  actionReason: string;
  entryPriceSol?: number;
  exitPriceSol?: number;
  pnlUsd?: number;
  pnlPct?: number;
  txHash?: string;
}

export interface GrokBotPosition {
  id: string;
  symbol: string;
  name: string;
  tokenMint: string;
  poolDepthSol: number;
  entryPriceUsd: number;
  currentPriceUsd: number;
  entryPriceSol: number;
  currentPriceSol: number;
  highestPriceUsd: number;
  sizeTokens: number;
  costBasisUsd: number;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  holdingTimeSec: number;
  trailingStopPriceUsd: number;
  nextTakeProfitUsd: number;
  takeProfitStage: number; // 0, 1 (35%), 2 (100%), 3 (250% runner)
  safetyScore: number;
  socialScore: number;
  mempoolFlowSol: number;
  enteredAt: number;
  lastUpdated: number;
}

export interface GrokBotState {
  botName: string;
  directive: string;
  cloudBoxStatus: 'ONLINE' | 'PAUSED' | 'WIPED';
  cloudUptimeSec: number;
  serverBillReservedUsd: number;
  serverBillRatePerDayUsd: number;
  initialBankrollUsd: number;
  currentEquityUsd: number;
  cashUsd: number;
  activeExposureUsd: number;
  totalFlips: number;
  winningFlips: number;
  losingFlips: number;
  winRatePct: number;
  peakEquityUsd: number;
  maxDrawdownPct: number;
  nightOneDipUsd: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  currentTicketSizeUsd: number;
  lastExitOutcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'NONE';
  lastExitPnlPct: number;
  cycleSpeedMs: number;
  activePositions: GrokBotPosition[];
  flipHistory: GrokBotCycleLog[];
  equityCurve: { timestamp: number; equityUsd: number; note?: string }[];
  currentCyclePhase: 'SCANNING_POOL' | 'CHECKING_SAFETY' | 'ANALYZING_FLOW' | 'PRECHECKING_SLIPPAGE' | 'EXECUTING_ROTATION' | 'IDLE';
  currentInspectedToken?: {
    symbol: string;
    name: string;
    poolDepthSol: number;
    mintAuthRevoked: boolean;
    lpLocked: boolean;
    top10Pct: number;
    socialScore: number;
    mempoolFlowSol: number;
    status: 'ANALYZING' | 'SNIPED' | 'REJECTED';
    statusText: string;
  };
}

export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet';

export type AutotradeMode = 'OFF' | 'SEMI_AUTONOMOUS' | 'FULL_AUTONOMOUS';

export interface WalletTradeExitOption {
  positionId: string;
  action: 'FLATTEN_100' | 'SCALE_OUT_50' | 'BREAKEVEN_SL' | 'CUSTOM_SL_TP';
  customStopLossPct?: number;
  customTakeProfitPct?: number;
}

export interface KillSwitchRule {
  id: string;
  name: string;
  enabled: boolean;
  triggerCondition: string;
  thresholdValue: number;
  unit: string;
  description: string;
}

export interface WalletAutotradeConfig {
  walletAddress: string | null;
  walletName: string;
  isConnected: boolean;
  network: SolanaNetwork;
  rpcEndpoint: string;
  balanceSol: number;
  balanceUsd: number;
  gasReserveSol: number;
  allocatedCapitalSol: number; // Dedicated SOL for autonomous trading out of total wallet balance
  allocatedCapitalUsd: number;
  autotradeMode: AutotradeMode;
  
  // SL and Risk Limits
  defaultStopLossPct: number;
  trailingStopTriggerPct: number;
  trailingStopDistancePct: number;
  takeProfitTier1Pct: number;
  takeProfitTier2Pct: number;
  
  // Position Sizing Limits (Min & Max)
  targetTradeSizeSol: number; // The exact target size in SOL per trade (e.g. 0.02 SOL for a $20 balance)
  minTradeSizeSol: number;
  maxTradeSizeSol: number;
  maxOpenPositions: number;
  maxDailyDrawdownPct: number;
  maxDailyLossSol: number;
  maxSlippagePct: number;
  maxPriceImpactPct?: number;
  
  // Kill Switch Settings & Rules
  killSwitchActive: boolean;
  killSwitchTriggeredReason?: string;
  killSwitchTriggeredAt?: number;
  killSwitchRules: KillSwitchRule[];

  // Enabled Signal Sources for Auto-Trading
  enabledSignalSources: string[];
  minSignalScore: number;

  // Dedicated Trading Keypair (Server Worker Only - Private Key Never Exposing to Client)
  hasDedicatedKeypair: boolean;
  keypairSource: 'ENV' | 'SECURE_FILE' | 'MEMORY' | 'NONE';
  keypairPublicKey: string | null;

  // Preflight Diagnostic Status
  lastPreflightPassed: boolean;
  lastPreflightTimestamp?: number;
}

export type PreflightCheckId =
  | 'trading_wallet_address'
  | 'sol_balance'
  | 'rpc_connectivity'
  | 'keypair_loaded'
  | 'jupiter_quote'
  | 'swap_construction'
  | 'transaction_simulation'
  | 'risk_engine_approval'
  | 'kill_switch'
  | 'live_config_gates'
  | 'worker_connectivity';

export interface LivePreflightCheckItem {
  id: PreflightCheckId;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: any;
  durationMs?: number;
}

export interface LivePreflightReport {
  timestamp: number;
  configuredAddress: string | null;
  network: SolanaNetwork;
  rpcEndpoint: string;
  passed: boolean;
  allChecksPassed: boolean;
  canExecuteLive: boolean;
  summary: string;
  hasKeypairLoaded: boolean;
  onChainBalanceSol: number;
  checks: LivePreflightCheckItem[];
}

export interface LivePortfolioTelemetry {
  onChainSolBalance: number;
  allocatedCapitalSol: number;
  activeLiveExposureSol: number;
  dailyRealizedPnlSol: number;
  totalRealizedPnlSol: number;
  unrealizedPnlSol: number;
  openPositionsCount: number;
  lastOnChainSync: number;
}

export interface WalletDiagnostics {
  timestamp: number;
  rpcLatencyMs: number;
  rpcStatus: 'OPTIMAL' | 'DEGRADED' | 'DOWN';
  currentSlot: number;
  accountExists: boolean;
  rentExempt: boolean;
  balanceSol: number;
  balanceUsd: number;
  gasReserveSol: number;
  tradeableSol: number;
  readinessScore: number; // 0-100
  canAutotrade: boolean;
  checks: {
    name: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    message: string;
  }[];
}

export interface SignalTradeTriggerRequest {
  tokenMint: string;
  symbol: string;
  name?: string;
  priceSol?: number;
  priceUsd?: number;
  signalSource: string;
  signalScore?: number;
  recommendedSizeSol?: number;
  overrideMaxPositions?: boolean;
  autoRaiseLimit?: boolean;
}

export interface SignalTradeResult {
  success: boolean;
  txSignature?: string;
  explorerUrl?: string;
  positionId?: string;
  tokenMint: string;
  symbol: string;
  sizeSol: number;
  priceSol: number;
  slippagePct: number;
  priorityFeeSol: number;
  timestamp: number;
  mode: AutotradeMode;
  error?: string;
  executionType?: 'PAPER_SIMULATED' | 'LIVE_ON_CHAIN';
  isSimulated?: boolean;
  simulationBadgeText?: string;
}

export interface OneClickEnrollRequest {
  tokenMint: string;
  symbol: string;
  name?: string;
  priceSol?: number;
  priceUsd?: number;
  sizeSol: number;
  slippageBps?: number;
}

export interface OneClickEnrollResult {
  success: boolean;
  txSignature?: string;
  explorerUrl?: string;
  positionId?: string;
  tokenMint: string;
  symbol: string;
  sizeSol: number;
  tokensReceived?: number;
  priceSol?: number;
  error?: string;
  timestamp: number;
}

export interface OneClickExitRequest {
  positionId: string;
  pctToExit?: number;
  slippageBps?: number;
  reason?: string;
}

export interface OneClickExitResult {
  success: boolean;
  txSignature?: string;
  explorerUrl?: string;
  positionId: string;
  symbol: string;
  solReceived?: number;
  tokensSold?: number;
  remainingTokens?: number;
  isFullyClosed: boolean;
  error?: string;
  message?: string;
  timestamp: number;
}


