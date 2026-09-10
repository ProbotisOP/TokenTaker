import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { MicrostructureEngine, type SwapTick } from '../src/trading/microstructureEngine.ts';
import { SafetyEngine, type SafetyAnalysisInput } from '../src/trading/safetyEngine.ts';
import { WalletIntelligence } from '../src/trading/walletIntelligence.ts';
import { ScoringEngine, type ScoringInput } from '../src/trading/scoringEngine.ts';
import { GrokBotEngine } from '../src/trading/grokBotEngine.ts';
import { WalletCategory, type TokenMetadata } from '../src/types.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const tick = (timestamp: number, priceSol = 1, overrides: Partial<SwapTick> = {}): SwapTick => ({
  timestamp, priceSol, priceUsd: priceSol * 100, isBuy: true, tokenAmount: 1, solAmount: 2,
  traderWallet: `wallet-${timestamp}`, isNewWallet: false, ...overrides,
});
const safeInput = (): SafetyAnalysisInput => ({
  metadata: { launchVenue: 'Pump.fun' } as TokenMetadata,
  mintAuthorityRevoked: true, freezeAuthorityRevoked: true, lpBurnPct: 100,
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  hasSuspiciousExtensions: false, suspiciousExtensions: [], supplyAnomalies: false,
  top1Percent: 5, top5Percent: 15, top10Percent: 25, creatorOwnershipPercent: 0,
  insiderClusterDetected: false, bundledWalletsDetected: 0, washTradingDetected: false,
  creatorDumpRisk: false, liquiditySol: 30, marketCapUsd: 20000, poolAgeSec: 30,
});

test('windows are causal, sorted, disjoint at boundaries and use preceding prices', () => {
  const engine = new MicrostructureEngine(30, 1);
  engine.recordTick(tick(12000, 99));
  engine.recordTick(tick(9500, 2));
  engine.recordTick(tick(6500, 1));
  const snapshot = engine.getSnapshot(10000);
  assert.equal(snapshot.priceSol, 2);
  assert.equal(snapshot.volumeSol, 4);
  assert.equal(snapshot.windows['3s'].tradeCount, 1);
  close(snapshot.windows['3s'].priceChangePct, 100);
  assert.equal(snapshot.liquiditySol, 30);
  assert.equal(snapshot.holderGrowth, 0);
  assert.equal(snapshot.marketCapUsd, 0);
  const boundary = new MicrostructureEngine(30, 1);
  boundary.recordTick(tick(7000));
  boundary.recordTick(tick(10000));
  assert.equal(boundary.getSnapshot(10000).windows['3s'].tradeCount, 1);
});

test('expired activity cannot contribute to demand or wallet counts', () => {
  const engine = new MicrostructureEngine(30, 1);
  engine.recordTick(tick(1000, 1, { isNewWallet: true }));
  const snapshot = engine.getSnapshot(61000);
  assert.equal(snapshot.volumeSol, 0);
  assert.equal(snapshot.uniqueBuyers, 0);
  assert.equal(snapshot.newWalletRate, 0);
  assert.equal(snapshot.largeWalletActivityCount, 0);
});

test('independent market marks change price and liquidity, never swap activity', () => {
  const engine = new MicrostructureEngine(30, 1);
  engine.updateMarket({ priceSol: 1, priceUsd: 100, liquiditySol: 30 }, 1000);
  engine.updateMarket({ priceSol: 3, priceUsd: 300, liquiditySol: 100 }, 11000);
  engine.updateMarket({ priceSol: 2, priceUsd: 200, liquiditySol: 20 }, 9000);
  engine.recordTick(tick(9500, 2, { isBuy: false, solAmount: 500 }));
  const snapshot = engine.getSnapshot(10000);
  assert.equal(snapshot.liquiditySol, 20);
  assert.equal(snapshot.priceSol, 2);
  assert.equal(snapshot.windows['3s'].tradeCount, 1);
  close(snapshot.windows['3s'].priceChangePct, 100);
  assert.equal(snapshot.liquidityUsd, 2000);
  close(snapshot.liquidityChangePct, -100 / 3);
});

test('missing price return baseline is zero, not the first in-window trade', () => {
  const engine = new MicrostructureEngine(30, 1);
  engine.recordTick(tick(9000, 1));
  engine.recordTick(tick(9500, 2));
  assert.equal(engine.getSnapshot(10000).windows['3s'].priceChangePct, 0);
});

test('safety fails closed for nonfinite, missing, invalid and unsupported evidence', () => {
  assert.equal(SafetyEngine.evaluate(safeInput()).isTradable, true);
  for (const key of ['lpBurnPct', 'top1Percent', 'top5Percent', 'top10Percent', 'creatorOwnershipPercent', 'liquiditySol', 'marketCapUsd', 'poolAgeSec', 'bundledWalletsDetected'] as const) {
    for (const value of [NaN, Infinity, -1, undefined, null]) {
      const report = SafetyEngine.evaluate({ ...safeInput(), [key]: value } as SafetyAnalysisInput);
      assert.equal(report.isTradable, false, `${key}=${value}`);
      assert.ok(Number.isFinite(report.safetyScore));
    }
  }
  for (const tokenProgram of ['unknown', '', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
    const report = SafetyEngine.evaluate({ ...safeInput(), tokenProgram });
    assert.equal(report.isTradable, false);
    assert.equal(report.tokenProgramSafe, false);
    assert.equal(report.checks.tokenProgramLegitimate, false);
  }
  assert.equal(SafetyEngine.evaluate({ ...safeInput(), top1Percent: 101 }).isTradable, false);
  assert.equal(SafetyEngine.evaluate({ ...safeInput(), top5Percent: 1 }).isTradable, false);
  assert.equal(SafetyEngine.evaluate({ ...safeInput(), suspiciousExtensions: undefined } as unknown as SafetyAnalysisInput).isTradable, false);
});

test('Pump venue name never substitutes for verified LP safety', () => {
  const report = SafetyEngine.evaluate({ ...safeInput(), lpBurnPct: 0 });
  assert.equal(report.isTradable, false);
  assert.equal(report.lpBurnOrLocked, false);
  assert.ok(report.rejectReasons.some(reason => reason.startsWith('LP RISK')));
});

test('unknown wallets have no invented history and neutral flow is unverified', () => {
  for (const address of ['7xKXtg...AlphaSniper1', '9pW2zQ...QuantArb', 'wallet-anything']) {
    const profile = WalletIntelligence.getOrCreateProfile(address, true);
    assert.equal(profile.category, WalletCategory.UNKNOWN);
    for (const key of ['realizedPnlSol', 'winRate', 'avgHoldingSec', 'avgEntryTimingSec', 'realizedTradesCount', 'tokenOverlapCount', 'reputationScore'] as const) assert.equal(profile[key], 0);
    assert.equal(profile.behaviorDuringRugs, 'neutral');
  }
  const flow = WalletIntelligence.evaluateFlowQuality(['a', 'a', 'b', '']);
  assert.equal(flow.walletQualityScore, 0.5);
  assert.equal(flow.verified, false);
  assert.equal(flow.uniqueWalletCount, 2);
  assert.equal(flow.profitableTraderCount, 0);
});

test('acceleration compares latest 3s with preceding 27s and requires a baseline', () => {
  const engine = new MicrostructureEngine(30, 1);
  engine.recordTick(tick(29000, 1, { solAmount: 3 }));
  const input = (): ScoringInput => ({
    metadata: safeInput().metadata, safety: SafetyEngine.evaluate(safeInput()), micro: engine.getSnapshot(30000),
    walletQualityScore: 0.5, social: { sentimentScore: 0, socialCapitalCorrelation: 0 } as ScoringInput['social'],
  });
  assert.equal(ScoringEngine.compute(input()).components.volumeAcceleration, 0);
  engine.recordTick(tick(27000, 1, { solAmount: 27 }));
  const score = ScoringEngine.compute(input());
  close(score.components.volumeAcceleration, 1 / 3);
  assert.equal(score.components.holderGrowth, 0);
});

test('Grok starts paused with empty demo baseline and no live feed dependency', () => {
  const source = readFileSync(new URL('../src/trading/grokBotEngine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /LiveTokenFeedService|VERIFIED_SOLANA_MEMES|liveTokenFeed/);
  const bot = GrokBotEngine.getInstance();
  try {
    const state = bot.getState();
    assert.equal(state.cloudBoxStatus, 'PAUSED');
    assert.match(state.botName, /DEMO/);
    assert.equal(state.currentEquityUsd, 41);
    assert.equal(state.totalFlips, 0);
    assert.equal(state.activePositions.length, 0);
    assert.equal(state.flipHistory.length, 0);
    assert.equal(state.equityCurve.length, 1);
  } finally { bot.stop(); }
});

test('Grok whole-token accounting conserves value on partial and immediate full exits', () => {
  const bot = GrokBotEngine.getInstance();
  try {
    bot.resetOrWipe();
    const log = bot.triggerImmediateCycle('GEM');
    assert.match(log.symbol, /^DEMO-/);
    assert.equal(log.txHash, undefined);
    const state = bot.getState();
    const pos = state.activePositions[0];
    const basis = pos.costBasisUsd;
    const size = pos.sizeTokens;
    close(size * pos.entryPriceUsd, basis);
    pos.currentPriceUsd = pos.entryPriceUsd * 2;
    bot.manualScaleOut50(pos.id);
    close(pos.sizeTokens, size / 2);
    close(pos.currentValueUsd, basis);
    close(pos.costBasisUsd, basis / 2);
    close(pos.unrealizedPnlUsd, basis / 2);
    close(state.currentEquityUsd + state.serverBillReservedUsd, 41 + basis);
    bot.manualClosePosition(pos.id);
    assert.equal(state.activePositions.length, 0);
    assert.equal(state.activeExposureUsd, 0);
    close(state.currentEquityUsd, state.cashUsd);
    close(state.currentEquityUsd + state.serverBillReservedUsd, 41 + basis);
    close(state.equityCurve.at(-1)!.equityUsd, state.currentEquityUsd);
    assert.equal(bot.manualClosePosition(pos.id), null);
    assert.equal(state.winningFlips, 2);
  } finally { bot.stop(); }
});

test('Grok partial losses update performance and zero bankroll remains finite', () => {
  const bot = GrokBotEngine.getInstance();
  try {
    bot.resetOrWipe();
    bot.triggerImmediateCycle('GEM');
    const state = bot.getState();
    const pos = state.activePositions[0];
    const basis = pos.costBasisUsd;
    pos.currentPriceUsd = pos.entryPriceUsd / 2;
    bot.manualScaleOut50(pos.id);
    assert.equal(state.losingFlips, 1);
    assert.equal(state.lastExitOutcome, 'LOSS');
    close(state.currentEquityUsd, 41 - basis / 2);
    bot.resetOrWipe(0);
    bot.triggerImmediateCycle('GEM');
    assert.equal(bot.getState().currentEquityUsd, 0);
    assert.equal(bot.getState().maxDrawdownPct, 0);
    assert.throws(() => bot.resetOrWipe(NaN));
  } finally { bot.stop(); }
});

test('Grok timer-driven scale-out uses the same conservation rules and respects pause', () => {
  const bot = GrokBotEngine.getInstance();
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;
    bot.resetOrWipe();
    bot.triggerImmediateCycle('GEM');
    const state = bot.getState();
    const pos = state.activePositions[0];
    const basis = pos.costBasisUsd;
    const updater = bot as unknown as { tickOpenPositions(): void };
    pos.currentPriceUsd = pos.entryPriceUsd * 1.5;
    updater.tickOpenPositions();
    assert.equal(pos.costBasisUsd, basis);
    state.cloudBoxStatus = 'ONLINE';
    updater.tickOpenPositions();
    close(pos.costBasisUsd, basis / 2);
    close(pos.currentValueUsd, basis * 0.75);
    close(state.currentEquityUsd + state.serverBillReservedUsd, 41 + basis * 0.5);
    assert.equal(pos.takeProfitStage, 1);
  } finally {
    Math.random = originalRandom;
    bot.stop();
  }
});
