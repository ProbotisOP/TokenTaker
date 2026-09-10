import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { LiveTokenFeedService } from '../src/trading/liveTokenFeed.ts';
import { EngineCoordinator } from '../src/trading/engineCoordinator.ts';
import { DecisionAction, SystemMode } from '../src/types.ts';
import type { LaunchInspection } from '../src/trading/launchInspector.ts';

const address = (n: number) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
const creation = {
  txType: 'create', mint: address(1), traderPublicKey: address(2), bondingCurveKey: address(3),
  signature: '5NWB2Bzh9AbGgaCzJ1JPz7gsAShbJ2e7sCXvqyjjxk4es4eXhvidgqGdogQM6H3nLnF4TXEsWtpsCm2qg2im3Ai9',
  vSolInBondingCurve: 30, vTokensInBondingCurve: 1_000_000_000, name: 'Fixture', symbol: 'FIX', pool: 'pump',
};
const trade = (i: number) => ({
  txType: 'buy', mint: creation.mint, traderPublicKey: address(10 + i % 8),
  signature: creation.signature.slice(0, -2) + String(11 + i), solAmount: 0.4, tokenAmount: 10_000_000,
  vSolInBondingCurve: 30 * (1 + i * 0.002), vTokensInBondingCurve: 1_000_000_000, pool: 'pump',
});

test('provider deduplicates launches/trades and never emits synthetic flow from creation', () => {
  const feed = new LiveTokenFeedService({ enabled: false, enableTrades: false });
  let launches = 0, trades = 0;
  feed.onLaunch(() => launches++);
  feed.onTrade(() => trades++);
  feed.acceptMessage(creation);
  feed.acceptMessage(creation);
  assert.equal(launches, 1);
  assert.equal(trades, 0);
  feed.acceptMessage(trade(1));
  feed.acceptMessage(trade(1));
  assert.equal(trades, 1);
  assert.equal(feed.getStatus().state, 'DISABLED');
});

test('provider bounds tracked tokens, expires them, and ignores invalid events', () => {
  const feed = new LiveTokenFeedService({ enabled: false, enableTrades: false, maxTrackedTokens: 1, maxAgeMs: 100 });
  feed.acceptMessage(creation, 1000);
  feed.acceptMessage({ ...creation, mint: address(4) }, 1050);
  assert.equal(feed.getStatus().trackedTokens, 1);
  assert.equal(feed.getStatus().launchesReceived, 1);
  feed.acceptMessage({ ...creation, mint: address(5), signature: creation.signature.slice(0, -1) + '8' }, 1200);
  assert.equal(feed.getStatus().trackedTokens, 1);
  assert.equal(feed.getStatus().launchesReceived, 2);
  feed.acceptMessage({ ...trade(1), solAmount: NaN }, 1200);
  assert.equal(feed.getStatus().tradesReceived, 0);
});

test('actual coordinator replay waits, inspects, confirms in SHADOW, then invalidates on gap', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const launchedAt = now;
  const feed = new LiveTokenFeedService({ enabled: false, enableTrades: false });
  const inspection = (): LaunchInspection => ({
    createdAt: launchedAt, checkedAt: now, priceSol: 3e-8, liquiditySol: 3.5,
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', decimals: 6, supplyTokens: 1e9,
    creator: creation.traderPublicKey, top1Pct: 5, top5Pct: 20, top10Pct: 30, creatorOwnershipPct: 2,
    mintAuthorityRevoked: true, freezeAuthorityRevoked: true, curveVerified: true, complete: false, reasons: [],
  });
  const coordinator = new EngineCoordinator({ autoStart: false, feed, inspector: { inspect: async () => inspection() } });
  t.after(() => coordinator.stop());
  feed.acceptMessage(creation, now);
  const candidate = coordinator.candidateTokens[0];
  assert.equal(candidate.decision, DecisionAction.WAIT);
  assert.equal(candidate.safety.isTradable, false);
  assert.equal(candidate.metadata.created_at, 0);
  assert.equal(coordinator.config.mode, SystemMode.SHADOW);
  await coordinator.inspectCandidate(creation.mint);
  assert.equal(candidate.safety.isTradable, true);
  assert.equal(candidate.curveVerified, true);
  assert.equal(candidate.micro.liquiditySol, 3.5);
  assert.equal(candidate.safety.lpBurnPct, 0);
  for (let i = 0; i <= 11; i++) {
    now = launchedAt + i * 1000;
    feed.acceptMessage(trade(i), now);
  }
  assert.equal(candidate.decision, DecisionAction.BUY);
  assert.equal(candidate.executionStatus, 'NOT_SUBMITTED');
  assert.ok(candidate.micro.windows['10s'].tradeCount >= 6);
  assert.ok(candidate.micro.priceSol > candidate.metadata.initialPriceSol);
  assert.equal(coordinator.activePositions.length, 0);
  assert.equal(candidate.opportunity.expectedReturnPct, 0);
  feed.acceptMessage({ error: 'subscription rejected' }, now);
  assert.equal(candidate.decision, DecisionAction.REJECT);
});

test('coordinator does not replace unknown inspection evidence with safe assumptions', async t => {
  const feed = new LiveTokenFeedService({ enabled: false, enableTrades: false });
  const coordinator = new EngineCoordinator({ autoStart: false, feed, inspector: { inspect: async () => { throw new Error('RPC rate limited'); } } });
  t.after(() => coordinator.stop());
  feed.acceptMessage(creation);
  await coordinator.inspectCandidate(creation.mint);
  assert.equal(coordinator.candidateTokens[0].safety.isTradable, false);
  assert.equal(coordinator.candidateTokens[0].decision, DecisionAction.WAIT);
  assert.equal(coordinator.candidateTokens[0].inspectionError, 'RPC rate limited');
  assert.equal(coordinator.candidateTokens[0].metadata.created_at, 0);
});
