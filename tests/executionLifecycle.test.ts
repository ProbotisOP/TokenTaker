import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { WalletManager } from '../src/trading/walletManager.ts';
import { EngineCoordinator } from '../src/trading/engineCoordinator.ts';
import { JupiterService, SOL_MINT, BONK_MINT, ExecutionContext } from '../src/trading/jupiterService.ts';
import { TradeSafetyValidator } from '../src/trading/tradeSafetyValidator.ts';
import { ExitEngine } from '../src/trading/exitEngine.ts';
import { ExecutionEngine } from '../src/trading/executionEngine.ts';
import { RiskEngine } from '../src/trading/riskEngine.ts';
import { solToLamports, toTokenBaseUnits, getOnChainTokenBalance } from '../src/trading/decimalSafeUtils.ts';

// Never construct a wallet singleton, load a keypair, sign a real transaction or contact RPC.
const owner = new PublicKey(SOL_MINT);
const keypair: any = { publicKey: owner };
const now = 1700000000000;
const originalNow = Date.now;
const originalFetch = globalThis.fetch;
const originalEnv = process.env.ENABLE_LIVE_TRADING;
const originalCoordinator = EngineCoordinator.getInstance;
const originalAttest = JupiterService.attestTransaction;
const originalValidate = TradeSafetyValidator.validateCompiledTransaction;
const originalQuote = JupiterService.fetchQuote;
const originalBuild = JupiterService.buildSwapTransaction;
const originalSign = JupiterService.signAndExecuteSwap;
const originalSell = JupiterService.executeRealSellSwap;
const service = JupiterService as any;
const originalPending = service.pending;
const originalJournal = service.journalPath;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tokentaker-execution-test-'));
let passed = 0;
let coordinator: any;
let wallet: any;
const signature = bs58.encode(new Uint8Array(64).fill(1));

function position(extra: any = {}) {
  return { id: 'p', tokenMint: BONK_MINT, symbol: 'TEST', name: 'Test', sizeTokens: 100, sizeBaseUnits: '100000000', tokenDecimals: 6,
    costBasisSol: 1, currentValueSol: 1.5, currentPriceSol: .015, currentPriceUsd: 2.55, entryPriceSol: .01,
    entryPriceUsd: 1.7, peakPriceUsd: 3, peakPriceSol: .015, stopLossPriceSol: .0085,
    trailingStopPriceSol: .01, trailingActivated: false, enteredAt: now, status: 'OPEN',
    isRealWalletTrade: true, isSimulated: false, executionType: 'LIVE_ON_CHAIN', walletAddress: SOL_MINT,
    realizedPnlSol: 0, unrealizedPnlSol: .5, takeProfitLadder: [{ targetPriceSol: .0145, pctToSell: 50, filled: false }],
    executionHistory: [], ...extra };
}
function reset(positions: any[] = []) {
  process.env.ENABLE_LIVE_TRADING = 'true';
  TradeSafetyValidator.validateCompiledTransaction = originalValidate;
  JupiterService.fetchQuote = originalQuote;
  JupiterService.buildSwapTransaction = originalBuild;
  JupiterService.signAndExecuteSwap = originalSign;
  JupiterService.executeRealSellSwap = originalSell;
  service.pending = new Map();
  JupiterService.attestTransaction = async () => {};
  coordinator = { config: { mode: 'LIVE' }, riskLimits: { circuitBreakerActive: false, maxConsecutiveLosses: 3, maxPositionPercent: .05, maxTokenExposurePercent: .08, maxOpenPositions: 6, maxTradeLossSol: 1 },
    activePositions: positions, closedPositions: [], portfolio: { cashSol: 10, equitySol: 10, currentDrawdownPct: 0,
      dailyRealizedPnlSol: 0, totalRealizedPnlSol: 0, consecutiveLosses: 0 }, recalculatePortfolio() {}, persistSettlement() {} };
  wallet = Object.create(WalletManager.prototype);
  wallet.dedicatedKeypair = keypair;
  wallet.inFlightExits = new Set();
  wallet.buyInFlight = false;
  wallet.lastBalanceCheck = now;
  wallet.config = { walletAddress: SOL_MINT, isConnected: true, lastPreflightPassed: true, killSwitchActive: false,
    autotradeMode: 'FULL_AUTONOMOUS', network: 'mainnet-beta', rpcEndpoint: 'http://127.0.0.1:1',
    balanceSol: 10, gasReserveSol: .025, minTradeSizeSol: .01, maxTradeSizeSol: .5, targetTradeSizeSol: .02,
    maxSlippagePct: 2.5, allocatedCapitalSol: 2, maxOpenPositions: 6, maxDailyLossSol: 1, maxDailyDrawdownPct: 15,
    defaultStopLossPct: -12, takeProfitTier1Pct: 45, takeProfitTier2Pct: 110 };
  wallet.refreshBalance = async () => { wallet.lastBalanceCheck = now; return { balanceSol: wallet.config.balanceSol, balanceUsd: 0 }; };
}
const buyRequest = { tokenMint: BONK_MINT, symbol: 'TEST', sizeSol: .02 };
function mockBuy() {
  JupiterService.fetchQuote = async () => ({ success: true, data: { inputMint: SOL_MINT, outputMint: BONK_MINT,
    inAmount: '20000000', outAmount: '2000000', otherAmountThreshold: '1950000', priceImpactPct: '0.1',
    fetchedAt: now, slippageBps: 250 } });
  JupiterService.buildSwapTransaction = async () => ({ success: true, versionedTx: {} as any, lastValidBlockHeight: 123 });
  JupiterService.signAndExecuteSwap = async (_c, _t, _k, _height, context) => {
    context!.finalGuard();
    return { success: true, status: 'CONFIRMED', txSignature: signature,
      fill: { tokenBaseUnits: '1000000', tokenDecimals: 6, solLamports: '20500000', feeLamports: 5000 } };
  };
}
const originalValidateQuote = TradeSafetyValidator.validateQuote;
function mockDecimalsForWallet() {
  TradeSafetyValidator.validateQuote = async () => ({ is_valid: true, token_decimals: 6, diagnostic_record: {} as any });
}
async function test(name: string, run: () => any) {
  reset();
  TradeSafetyValidator.validateQuote = originalValidateQuote;
  await run();
  console.log(`PASS ${++passed}: ${name}`);
}
const context = (action: 'BUY' | 'SELL' = 'BUY'): ExecutionContext => ({ action, walletAddress: SOL_MINT,
  tokenMint: BONK_MINT, tokenDecimals: 6, inputBaseUnits: action === 'BUY' ? '20000000' : '50000000',
  minimumOutputBaseUnits: action === 'BUY' ? '1000000' : '10000', quoteFetchedAt: now, finalGuard() {} });
function mockTransaction() {
  return { signatures: [new Uint8Array(64).fill(1)], message: { recentBlockhash: 'ORIGINAL_BLOCKHASH' },
    sign() {}, serialize() { return new Uint8Array(); } } as any;
}
function fillTransaction(action: 'BUY' | 'SELL' = 'BUY') {
  const balance = (amount: string) => ({ mint: BONK_MINT, owner: SOL_MINT, uiTokenAmount: { amount, decimals: 6 } });
  return { transaction: { message: { staticAccountKeys: [owner] } }, meta: { err: null, fee: 5000,
    preBalances: [1_000_000_000], postBalances: [action === 'BUY' ? 979_500_000 : 1_020_000_000],
    preTokenBalances: [balance(action === 'BUY' ? '0' : '100000000')],
    postTokenBalances: [balance(action === 'BUY' ? '1100000' : '50000000')] } };
}
function riskInput(extra: any = {}) {
  return { portfolio: { cashSol: .5, equitySol: .5, consecutiveLosses: 0, dailyRealizedPnlSol: 0 },
    opportunity: { expectedSlippagePct: 0 }, safety: {}, liquiditySol: 100, openPositionsCount: 0, currentExposureSol: 0,
    riskLimits: { circuitBreakerActive: false, maxConsecutiveLosses: 3, maxDailyLossSol: 1, maxOpenPositions: 6,
      maxSlippagePercent: 2.5, maxPositionPercent: .05, maxTokenExposurePercent: .1, maxTradeLossSol: .1 },
    targetTradeSizeSol: .4, ...extra } as any;
}

async function main() {
  Date.now = () => now;
  globalThis.fetch = async () => { throw new Error('NETWORK DISABLED IN OFFLINE TEST'); };
  EngineCoordinator.getInstance = () => coordinator;
  service.journalPath = path.join(directory, 'pending.json');

  await test('kill switch awaits genuine exits and retains failures without fictitious cash', async () => {
    coordinator.activePositions = [position()];
    let release!: () => void;
    wallet.oneClickExit = async () => { await new Promise<void>(r => { release = r; }); return { success: false, error: 'unconfirmed' }; };
    const pending = wallet.triggerKillSwitch('test');
    assert.equal(wallet.config.killSwitchActive, true);
    assert.equal(wallet.config.autotradeMode, 'OFF');
    assert.equal(coordinator.activePositions.length, 1);
    release();
    assert.equal((await pending).success, false);
    assert.equal(coordinator.portfolio.cashSol, 10);
    assert.equal(coordinator.closedPositions.length, 0);
  });
  await test('flatten reports only confirmed full exits', async () => {
    coordinator.activePositions = [position(), position({ id: 'q' })];
    wallet.oneClickExit = async ({ positionId }: any) => ({ success: positionId === 'p', isFullyClosed: positionId === 'p' });
    const result = await wallet.flattenAllRealTrades();
    assert.equal(result.closedCount, 1); assert.equal(result.success, false);
  });
  await test('take-profit evaluation leaves tier unfilled until settlement', () => {
    const p = position();
    const micro: any = { liquidityChangePct: 0, priceSol: .015, windows: { '30s': { volumeSol: 1 } } };
    assert.equal(ExitEngine.evaluatePosition(p as any, micro).tierIndex, 0);
    assert.equal(p.takeProfitLadder[0].filled, false);
    assert.equal(ExitEngine.evaluatePosition(p as any, micro).shouldExit, true);
  });
  await test('trailing uses SOL-native peak, not a fixed USD conversion', () => {
    const p = position({ peakPriceSol: .02, peakPriceUsd: 900 });
    const r = ExitEngine.updateTrailingStop(p as any, .015);
    assert.equal(r.peakPriceSol, .02); assert.equal(r.newTrailingPriceSol, .02 * .86);
  });
  await test('unit conversions reject nonfinite input and floor rather than round spend caps', () => {
    for (const bad of [NaN, Infinity, -1]) assert.throws(() => solToLamports(bad));
    assert.equal(solToLamports(.0000000019), 1n);
    assert.equal(toTokenBaseUnits(.0000019, 6), 1n);
    assert.equal(solToLamports(1e-10), 0n);
    assert.equal(toTokenBaseUnits(1132.426631, 6), 1132426631n);
  });
  await test('token balance RPC failure is not interpreted as zero', async () => {
    const connection: any = { getParsedTokenAccountsByOwner: async () => { throw new Error('RPC down'); } };
    await assert.rejects(getOnChainTokenBalance(connection, owner, new PublicKey(BONK_MINT)), /RPC down/);
  });
  await test('malformed, stale, nonfinite and slippage-invalid quotes reject', async () => {
    const conn: any = { getTokenSupply: async () => ({ value: { decimals: 6 } }) };
    const good = { inputMint: SOL_MINT, outputMint: BONK_MINT, inAmount: '20000000', outAmount: '100000000',
      otherAmountThreshold: '98000000', priceImpactPct: '0.1', slippageBps: 200, fetchedAt: now };
    for (const change of [{ priceImpactPct: 'NaN' }, { priceImpactPct: Infinity }, { priceImpactPct: null },
      { slippageBps: 9999 }, { otherAmountThreshold: '1' }, { otherAmountThreshold: '100000001' },
      { inAmount: '20000001' }, { inAmount: '2e7' }, { fetchedAt: now - 60000 }, { otherAmountThreshold: undefined }]) {
      await assert.rejects(TradeSafetyValidator.validateQuote(conn, { intended_action: 'BUY', intended_token_mint: BONK_MINT,
        intended_sol_lamports: 20000000n, quote_response: { ...good, ...change }, wallet_pubkey: SOL_MINT }));
    }
  });
  await test('unknown instruction payload is blocked even with matching payer', () => {
    const tx: any = { message: { staticAccountKeys: [owner], header: { numRequiredSignatures: 1 }, compiledInstructions: [] } };
    assert.throws(() => TradeSafetyValidator.validateCompiledTransaction({ versioned_tx: tx, wallet_pubkey: SOL_MINT,
      intended_action: 'BUY', intended_token_mint: BONK_MINT }), /NOT_ATTESTED/);
  });
  await test('confirmation retains original blockhash and signature on timeout; retry blocked', async () => {
    TradeSafetyValidator.validateCompiledTransaction = () => {};
    let sends = 0;
    const conn: any = { sendRawTransaction: async () => { sends++; return signature; },
      getLatestBlockhash: async () => { throw new Error('Must not replace validity window'); },
      confirmTransaction: async (strategy: any) => {
        assert.deepEqual(strategy, { signature, blockhash: 'ORIGINAL_BLOCKHASH', lastValidBlockHeight: 123 });
        throw new Error('timeout');
      } };
    const result = await JupiterService.signAndExecuteSwap(conn, mockTransaction(), keypair, 123, context());
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.txSignature, signature);
    assert.equal(JupiterService.getPendingExecutions().length, 1);
    const retry = await JupiterService.signAndExecuteSwap(conn, mockTransaction(), keypair, 123, context());
    assert.equal(retry.success, false); assert.equal(sends, 1);
    service.pending = null;
    assert.equal(JupiterService.hasPendingExecution(SOL_MINT, BONK_MINT), true);
  });
  await test('send timeout retains deterministic signature before acknowledgement', async () => {
    TradeSafetyValidator.validateCompiledTransaction = () => {};
    const conn: any = { sendRawTransaction: async () => { throw new Error('transport interrupted'); } };
    const result = await JupiterService.signAndExecuteSwap(conn, mockTransaction(), keypair, 123, context());
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.txSignature, signature);
  });
  await test('definitive on-chain error is failed, not confirmed', async () => {
    TradeSafetyValidator.validateCompiledTransaction = () => {};
    const conn: any = { sendRawTransaction: async () => signature, confirmTransaction: async () => ({ value: { err: 'InstructionError' } }) };
    const result = await JupiterService.signAndExecuteSwap(conn, mockTransaction(), keypair, 123, context());
    assert.equal(result.status, 'FAILED'); assert.equal(result.success, false);
    assert.equal(JupiterService.getPendingExecutions().length, 0);
  });
  await test('confirmation without fill metadata remains unresolved and cannot resubmit', async () => {
    TradeSafetyValidator.validateCompiledTransaction = () => {};
    const conn: any = { sendRawTransaction: async () => signature, confirmTransaction: async () => ({ value: { err: null } }), getTransaction: async () => null };
    const result = await JupiterService.signAndExecuteSwap(conn, mockTransaction(), keypair, 123, context());
    assert.equal(result.success, false); assert.equal(result.status, 'UNKNOWN'); assert.equal(result.txSignature, signature);
    assert.equal(JupiterService.hasPendingExecution(SOL_MINT), true);
  });
  await test('actual confirmed balance deltas, not quote output, produce fill', async () => {
    TradeSafetyValidator.validateCompiledTransaction = () => {};
    const conn: any = { sendRawTransaction: async () => signature, confirmTransaction: async () => ({ value: { err: null } }),
      getTransaction: async () => fillTransaction() };
    const result = await JupiterService.signAndExecuteSwap(conn, mockTransaction(), keypair, 123, context());
    assert.equal(result.fill?.tokenBaseUnits, '1100000'); assert.equal(result.fill?.solLamports, '20500000');
    assert.equal(result.status, 'CONFIRMED');
  });
  await test('devnet self-transfer cannot fabricate token trade', async () => {
    assert.equal((await JupiterService.executeDevnetRealMicroTrade({} as any, keypair)).success, false);
  });
  await test('sell quotes exactly position units despite larger wallet holdings', async () => {
    const account = { pubkey: owner, account: { data: { parsed: { info: { mint: BONK_MINT,
      tokenAmount: { amount: '200000000', decimals: 6 } } } } } };
    const conn: any = { getParsedTokenAccountsByOwner: async (_o: any, filter: any) => ({ value: filter.programId.toString().startsWith('Tokenkeg') ? [account] : [] }) };
    let quoted: any;
    JupiterService.fetchQuote = async args => { quoted = args.amountLamports; return { success: false, error: 'stop before building' }; };
    await JupiterService.executeRealSellSwap(conn, keypair, BONK_MINT, 50000000n, 250, 100, () => {});
    assert.equal(quoted, 50000000n);
    quoted = undefined;
    await JupiterService.executeRealSellSwap(conn, keypair, BONK_MINT, 100, 250, 100, () => {});
    assert.equal(quoted, undefined);
    await JupiterService.executeRealSellSwap(conn, keypair, BONK_MINT, 300000000n, 250, 100, () => {});
    assert.equal(quoted, undefined);
  });
  await test('paper, foreign wallet and legacy float-only positions reject before live sell', async () => {
    let calls = 0;
    JupiterService.executeRealSellSwap = async () => { calls++; return { success: false }; };
    for (const extra of [{ isRealWalletTrade: false }, { isSimulated: true }, { walletAddress: BONK_MINT }, { sizeBaseUnits: undefined }]) {
      coordinator.activePositions = [position(extra)];
      assert.equal((await wallet.oneClickExit({ positionId: 'p', pctToExit: 100 })).success, false);
    }
    assert.equal(calls, 0);
  });
  await test('arbitrary integer slice uses exact base units; settlement releases proportional basis and marks', async () => {
    coordinator.activePositions = [position()];
    let amount: any;
    JupiterService.executeRealSellSwap = async (_c, _k, _m, units) => {
      amount = units;
      return { success: true, status: 'CONFIRMED', txSignature: signature,
        fill: { tokenBaseUnits: '35000000', tokenDecimals: 6, solLamports: '525000000', feeLamports: 5000 } };
    };
    const result = await wallet.oneClickExit({ positionId: 'p', pctToExit: 35, tierIndex: 0 });
    assert.equal(amount, 35000000n); assert.equal(result.success, true);
    const p = coordinator.activePositions[0];
    assert.equal(p.sizeBaseUnits, '65000000'); assert.equal(p.sizeTokens, 65);
    assert.equal(p.costBasisSol, .65); assert.equal(p.currentValueSol, .975);
    assert.ok(Math.abs(p.unrealizedPnlSol - .325) < 1e-12);
    assert.equal(p.takeProfitLadder[0].filled, true);
    assert.equal(coordinator.portfolio.consecutiveLosses, 0);
  });
  await test('failed partial exit retains quantity, basis and tier', async () => {
    coordinator.activePositions = [position()];
    const before = structuredClone(coordinator.activePositions[0]);
    JupiterService.executeRealSellSwap = async () => ({ success: false, status: 'UNKNOWN', txSignature: signature });
    const result = await wallet.oneClickExit({ positionId: 'p', pctToExit: 50, tierIndex: 0 });
    assert.equal(result.success, false); assert.equal(result.txSignature, signature);
    assert.deepEqual(coordinator.activePositions[0], before);
  });
  await test('confirmed losing full exit increments streak and zeros remaining exposure', async () => {
    coordinator.activePositions = [position()];
    wallet.config.killSwitchActive = true; wallet.config.autotradeMode = 'OFF'; coordinator.config.mode = 'EMERGENCY_STOP';
    JupiterService.executeRealSellSwap = async (_c, _k, _m, _u, _s, _p, guard) => {
      guard!(); return { success: true, status: 'CONFIRMED', txSignature: signature,
        fill: { tokenBaseUnits: '100000000', tokenDecimals: 6, solLamports: '600000000', feeLamports: 5000 } };
    };
    assert.equal((await wallet.oneClickExit({ positionId: 'p', pctToExit: 100 })).success, true);
    assert.equal(coordinator.activePositions.length, 0);
    assert.equal(coordinator.closedPositions[0].currentValueSol, 0);
    assert.equal(coordinator.portfolio.consecutiveLosses, 1);
    assert.equal(coordinator.portfolio.dailyRealizedPnlSol, -.4);
  });
  await test('concurrent exits for same mint submit once', async () => {
    coordinator.activePositions = [position()];
    let release!: () => void;
    JupiterService.executeRealSellSwap = async () => { await new Promise<void>(r => { release = r; }); return { success: false }; };
    const first = wallet.oneClickExit({ positionId: 'p', pctToExit: 50 });
    const second = await wallet.oneClickExit({ positionId: 'p', pctToExit: 50 });
    assert.equal(second.success, false); assert.match(second.error, /progress/);
    release(); await first;
  });
  await test('missing metadata cannot fabricate successful wallet entry', async () => {
    mockBuy(); mockDecimalsForWallet();
    JupiterService.signAndExecuteSwap = async () => ({ success: true, txSignature: signature });
    assert.equal((await wallet.oneClickEnroll(buyRequest)).success, false);
    assert.equal(coordinator.activePositions.length, 0); assert.equal(coordinator.portfolio.cashSol, 10);
  });
  await test('actual fill price initializes stops, take profits and token base units', async () => {
    mockBuy(); mockDecimalsForWallet();
    const result = await wallet.oneClickEnroll({ ...buyRequest, priceSol: .9 });
    assert.equal(result.success, true);
    const p = coordinator.activePositions[0];
    assert.equal(p.entryPriceSol, .0205); assert.equal(p.sizeBaseUnits, '1000000');
    assert.equal(p.stopLossPriceSol, .0205 * .88);
    assert.equal(p.takeProfitLadder[0].targetPriceSol, .0205 * 1.45);
    assert.equal(p.costBasisSol, .0205);
  });
  await test('wallet-wide buy lock serializes concurrent enroll and signal requests', async () => {
    mockBuy(); mockDecimalsForWallet();
    let release!: () => void;
    wallet.refreshBalance = async () => { await new Promise<void>(r => { release = r; }); wallet.refreshBalance = async () => ({}); };
    const first = wallet.oneClickEnroll(buyRequest);
    const second = await wallet.executeSignalTrade({ tokenMint: BONK_MINT, symbol: 'TEST', recommendedSizeSol: .02 });
    assert.equal(second.success, false); assert.match(second.error, /progress/);
    release(); assert.equal((await first).success, true);
  });
  await test('final buy guard catches kill switch or mode change during async build', async () => {
    for (const mutate of [() => { wallet.config.killSwitchActive = true; }, () => { coordinator.config.mode = 'SHADOW'; },
      () => { wallet.config.balanceSol = .03; }, () => { wallet.config.walletAddress = BONK_MINT; }]) {
      reset(); mockBuy(); mockDecimalsForWallet();
      JupiterService.buildSwapTransaction = async () => { mutate(); return { success: true, versionedTx: {} as any, lastValidBlockHeight: 123 }; };
      let signed = false;
      JupiterService.signAndExecuteSwap = async () => { signed = true; return { success: false }; };
      assert.equal((await wallet.oneClickEnroll(buyRequest)).success, false); assert.equal(signed, false);
    }
  });
  await test('buy entry boundary requires explicit interlock, caps and funded requested size', async () => {
    for (const mutate of [() => { delete process.env.ENABLE_LIVE_TRADING; }, () => { wallet.config.balanceSol = .036; },
      () => { wallet.config.allocatedCapitalSol = .001; }, () => { wallet.config.autotradeMode = 'OFF'; },
      () => { wallet.config.maxOpenPositions = 0; }]) {
      reset(); mutate();
      assert.equal((await wallet.oneClickEnroll(buyRequest)).success, false);
    }
  });
  await test('sub-SOL wallets obey fractional equity caps without synthetic Kelly estimates', () => {
    const result = RiskEngine.evaluateAndSize(riskInput());
    assert.equal(result.approved, true); assert.equal(result.recommendedSizeSol, .025);
    assert.equal(result.calibratedKellyPct, undefined);
  });
  await test('minimum cannot override pool cap; cap is floored at lamport precision', () => {
    assert.equal(RiskEngine.evaluateAndSize(riskInput({ liquiditySol: .01 })).approved, false);
    const input = riskInput({ minTradeSizeSol: .000001, targetTradeSizeSol: .0200000009 });
    assert.equal(RiskEngine.evaluateAndSize(input).recommendedSizeSol, .02);
    input.liquiditySol = NaN;
    assert.equal(RiskEngine.evaluateAndSize(input).approved, false);
  });
  await test('live ExecutionEngine returns rejection, never a fake confirmed receipt', () => {
    const request: any = { tokenMint: BONK_MINT, symbol: 'TEST', sizeSol: .02, expectedPriceSol: .01,
      poolLiquiditySol: 1, detected_at: now, parsed_at: now, scored_at: now, decision_at: now,
      slippageLimitPct: .01, expectedEdgePct: 0 };
    const result = ExecutionEngine.executeBuy(request, true);
    assert.equal(result.status, 'REJECTED'); assert.equal(result.txSignature, undefined); assert.equal(result.sizeTokens, 0);
  });
  await test('custom stop and take profit update active exit fields', async () => {
    coordinator.activePositions = [position()];
    await wallet.executeTradeExit('p', 'CUSTOM_SL_TP', { customStopLossPct: -5, customTakeProfitPct: 10 });
    assert.equal(coordinator.activePositions[0].stopLossPriceSol, .01 * .95);
    assert.equal(coordinator.activePositions[0].takeProfitLadder[0].targetPriceSol, .01 * 1.1);
  });
  console.log(`${passed} offline execution lifecycle tests passed`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Date.now = originalNow; globalThis.fetch = originalFetch;
  if (originalEnv === undefined) delete process.env.ENABLE_LIVE_TRADING; else process.env.ENABLE_LIVE_TRADING = originalEnv;
  EngineCoordinator.getInstance = originalCoordinator;
  TradeSafetyValidator.validateQuote = originalValidateQuote;
  TradeSafetyValidator.validateCompiledTransaction = originalValidate;
  JupiterService.fetchQuote = originalQuote; JupiterService.buildSwapTransaction = originalBuild;
  JupiterService.signAndExecuteSwap = originalSign; JupiterService.executeRealSellSwap = originalSell;
  JupiterService.attestTransaction = originalAttest;
  service.pending = originalPending; service.journalPath = originalJournal;
  fs.rmSync(directory, { recursive: true, force: true });
});
