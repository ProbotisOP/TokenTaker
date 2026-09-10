import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bs58 from 'bs58';
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { PhantomTradingService, MAINNET_GENESIS_HASH } from '../src/trading/phantomTradingService.ts';
import { JupiterService, SOL_MINT, BONK_MINT } from '../src/trading/jupiterService.ts';
import { JUPITER_PROGRAM, walletAta } from '../src/trading/swapAttestation.ts';
import { TradingStateStore } from '../src/trading/tradingStateStore.ts';
import { EngineCoordinator } from '../src/trading/engineCoordinator.ts';
import { WalletManager } from '../src/trading/walletManager.ts';
import { createEntryExecutionGuard } from '../src/trading/entryExecutionGuard.ts';
import { DecisionAction, SystemMode } from '../src/types.ts';

const ephemeral = generateKeyPairSync('ed25519');
const owner = new PublicKey(ephemeral.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
const token = new PublicKey(BONK_MINT), sol = new PublicKey(SOL_MINT);
const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const event = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], JUPITER_PROGRAM)[0];
const fingerprint = (tx: VersionedTransaction) => Buffer.from(tx.message.serialize()).toString('base64');
function transaction(quote: any, blockhash: string, variant = 7) {
  const buy = quote.inputMint === SOL_MINT;
  const data = Buffer.alloc(35);
  createHash('sha256').update('global:route').digest().copy(data, 0, 0, 8);
  data.writeUInt32LE(1, 8); data[12] = variant; data[13] = 100; data[15] = 1;
  data.writeBigUInt64LE(BigInt(quote.inAmount), 16); data.writeBigUInt64LE(BigInt(quote.outAmount), 24); data.writeUInt16LE(quote.slippageBps, 32);
  const route = new TransactionInstruction({ programId: JUPITER_PROGRAM, data,
    keys: [tokenProgram, owner, walletAta(owner, buy ? sol : token), walletAta(owner, buy ? token : sol), JUPITER_PROGRAM,
      buy ? token : sol, JUPITER_PROGRAM, event, JUPITER_PROGRAM].map((pubkey, i) => ({ pubkey, isSigner: i === 1, isWritable: i === 2 || i === 3 })) });
  const close = new TransactionInstruction({ programId: tokenProgram, data: Buffer.from([9]),
    keys: [walletAta(owner, sol), owner, owner].map((pubkey, i) => ({ pubkey, isWritable: i < 2, isSigner: i === 2 })) });
  return new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
      ...(buy ? [SystemProgram.transfer({ fromPubkey: owner, toPubkey: walletAta(owner, sol), lamports: BigInt(quote.inAmount) })] : []), route, close],
  }).compileToV0Message());
}
function signed(prepared: any, mutate?: (tx: VersionedTransaction) => void) {
  const tx = VersionedTransaction.deserialize(Buffer.from(prepared.transactionBase64, 'base64'));
  mutate?.(tx);
  tx.signatures[0] = sign(null, Buffer.from(tx.message.serialize()), ephemeral.privateKey);
  return { approvalId: prepared.approvalId, signedTransactionBase64: Buffer.from(tx.serialize()).toString('base64') };
}

test('Phantom backend with offline RPC, ephemeral browser signatures and real safety/settlement code', async t => {
  const originalFetch = globalThis.fetch, originalSign = VersionedTransaction.prototype.sign, originalNow = Date.now;
  const originalWallet = WalletManager.getInstance;
  const internals = JupiterService as any;
  const originalPending = internals.pending, originalJournal = internals.journalPath, originalInterlock = internals.liveTradingEnabled;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-offline-'));
  let now = 1700000000000, runs = 0, forbiddenSigns = 0;
  globalThis.fetch = async () => { throw new Error('NETWORK DISABLED'); };
  VersionedTransaction.prototype.sign = () => { forbiddenSigns++; throw new Error('SERVER SIGNING FORBIDDEN'); };
  WalletManager.getInstance = () => { throw new Error('WALLET SINGLETON/SECRET LOADING FORBIDDEN'); };
  Date.now = () => now;
  internals.liveTradingEnabled = () => true;
  function fixture() {
    now = 1700000000000;
    internals.pending = new Map();
    internals.journalPath = path.join(root, `pending-${++runs}.json`);
    const store = new TradingStateStore(path.join(root, `settled-${runs}.json`));
    const cfg: any = { walletAddress: owner.toBase58(), isConnected: true, network: 'mainnet-beta', rpcEndpoint: 'http://offline.invalid',
      autotradeMode: 'FULL_AUTONOMOUS', balanceSol: 10, gasReserveSol: .025, allocatedCapitalSol: 2,
      minTradeSizeSol: .01, maxTradeSizeSol: .5, maxOpenPositions: 6, maxDailyDrawdownPct: 15, maxDailyLossSol: 1,
      maxSlippagePct: 2.5, killSwitchActive: false, defaultStopLossPct: -12, takeProfitTier1Pct: 45, takeProfitTier2Pct: 110 };
    const wallet = { getConfig: () => ({ ...cfg }), updateConfig: (updates: any) => Object.assign(cfg, updates) };
    const coordinator: any = { config: { mode: SystemMode.SHADOW }, activePositions: [], closedPositions: [],
      riskLimits: { maxPositionPercent: .05, maxTokenExposurePercent: .08, maxOpenPositions: 6, maxTradeLossSol: 1,
        maxDailyLossSol: 1, maxConsecutiveLosses: 3, maxSlippagePercent: 2.5, circuitBreakerActive: false },
      portfolio: { cashSol: 10, equitySol: 10, dailyRealizedPnlSol: 0, totalRealizedPnlSol: 0, currentDrawdownPct: 0, consecutiveLosses: 0 },
      setMode(mode: SystemMode) { this.config.mode = mode; return { success: true, message: mode }; },
      createSignalGuard() { throw new Error('No observed launch signal'); },
      recalculatePortfolio() { this.portfolio.equitySol = this.portfolio.cashSol + this.activePositions.reduce((sum: number, p: any) => sum + p.currentValueSol, 0); },
      settledSignatures: new Set<string>(),
      hasSettledSignature: EngineCoordinator.prototype.hasSettledSignature,
      persistSettlement(signature: string) { this.settledSignatures.add(signature); store.save({ version: 1, activePositions: this.activePositions, closedPositions: this.closedPositions,
        portfolio: this.portfolio, riskLimits: this.riskLimits, settledSignatures: [...this.settledSignatures] }); },
    };
    let sends = 0, builds = 0, quoteCalls = 0, live = true, balance = 10_000_000_000, blockhashValid = true, height = 100, genesis = MAINNET_GENESIS_HASH;
    let sent: VersionedTransaction | undefined, sendError = false, confirmError = false, metadataMissing = false, confirmedFailure = false;
    let quoteMutator = (_quote: any) => {}, buildMutator = (_tx: VersionedTransaction) => {};
    let onBalance = async () => {}, onSend = async () => {};
    const builtQuotes = new Map<string, any>();
    const connection: any = {
      async getGenesisHash() { return genesis; },
      async getBalance() { await onBalance(); return balance; },
      async getTokenSupply() { return { value: { decimals: 6 } }; },
      async getParsedTokenAccountsByOwner(_owner: PublicKey, filter: any) {
        return { value: filter.programId.equals(tokenProgram) ? [{ pubkey: walletAta(owner, token), account: { data: { parsed: { info: {
          mint: BONK_MINT, tokenAmount: { amount: '999000000', decimals: 6 },
        } } } } }] : [] };
      },
      async getBlockHeight() { return height; }, async isBlockhashValid() { return { value: blockhashValid }; },
      async sendRawTransaction(bytes: Uint8Array) {
        sends++; sent = VersionedTransaction.deserialize(bytes);
        assert.equal(JupiterService.hasPendingExecution(owner.toBase58()), true, 'journal must precede send');
        assert.ok(fs.existsSync(internals.journalPath));
        await onSend();
        if (sendError) throw new Error('RPC send connection lost');
        return bs58.encode(sent.signatures[0]);
      },
      async confirmTransaction(args: any) {
        assert.equal(args.blockhash, sent!.message.recentBlockhash); assert.equal(args.lastValidBlockHeight, 200);
        if (confirmError) throw new Error('RPC confirmation timed out');
        return { value: { err: confirmedFailure ? { InstructionError: [0, 'failure'] } : null } };
      },
      async getTransaction() {
        if (metadataMissing) return null;
        const quote = builtQuotes.get(fingerprint(sent!)), buy = quote.inputMint === SOL_MINT;
        const units = buy ? quote.outAmount : quote.inAmount;
        const native = buy ? Number(quote.inAmount) + 500000 : Number(quote.outAmount) - 5000;
        const tokenBalance = (amount: string) => ({ mint: BONK_MINT, owner: owner.toBase58(), uiTokenAmount: { amount, decimals: 6 } });
        return { transaction: { message: { staticAccountKeys: [owner] } }, meta: { err: null, fee: 5000,
          preBalances: [balance], postBalances: [balance + (buy ? -native : native)],
          preTokenBalances: [tokenBalance(buy ? '0' : units)], postTokenBalances: [tokenBalance(buy ? units : '0')] } };
      },
    };
    const executor: any = {
      async fetchQuote(params: any) {
        quoteCalls++;
        const input = BigInt(params.amountLamports), output = params.inputMint === SOL_MINT ? input / 10n : input * 103n / 10n;
        const quote: any = { inputMint: params.inputMint, outputMint: params.outputMint, inAmount: input.toString(), outAmount: output.toString(),
          otherAmountThreshold: (output * 9750n / 10000n).toString(), slippageBps: params.slippageBps, priceImpactPct: '0.1', fetchedAt: now, swapMode: 'ExactIn', routePlan: [] };
        quoteMutator(quote); return { success: true, data: quote };
      },
      async buildSwapTransaction(quote: any) {
        builds++;
        const tx = transaction(quote, new PublicKey(createHash('sha256').update(`${runs}:${builds}`).digest()).toBase58());
        buildMutator(tx); builtQuotes.set(fingerprint(tx), quote);
        return { success: true, versionedTx: tx, lastValidBlockHeight: 200 };
      },
      attestTransaction: JupiterService.attestTransaction.bind(JupiterService),
      executeExternallySignedSwap: JupiterService.executeExternallySignedSwap.bind(JupiterService),
      hasPendingExecution: JupiterService.hasPendingExecution.bind(JupiterService),
      acknowledgeSettlement: JupiterService.acknowledgeSettlement.bind(JupiterService),
    };
    const service = new PhantomTradingService({ wallet, coordinator, executor, connection: () => connection, now: () => now, liveEnabled: () => live });
    const buy: any = { walletAddress: owner.toBase58(), action: 'BUY', tokenMint: BONK_MINT, symbol: 'TEST', sizeSol: .02,
      requireEarlySignal: false, manualRiskAcknowledged: true };
    const enable = () => service.enable({ walletAddress: owner.toBase58(), confirmLiveDisclaimer: true });
    const prepare = () => service.prepare(buy);
    const seedBuy = async () => { enable(); const p = await prepare(); assert.equal((await service.submit(signed(p))).success, true); return coordinator.activePositions[0]; };
    return { service, cfg, coordinator, connection, executor, store, buy, enable, prepare, seedBuy,
      counts: () => ({ sends, builds, quoteCalls }), setLive: (v: boolean) => { live = v; },
      setBalance: (v: number) => { balance = v; }, setHeight: (v: number) => { height = v; },
      setBlockhash: (v: boolean) => { blockhashValid = v; }, setGenesis: (v: string) => { genesis = v; },
      mutateQuote: (fn: typeof quoteMutator) => { quoteMutator = fn; }, mutateBuild: (fn: typeof buildMutator) => { buildMutator = fn; },
      balanceHook: (fn: typeof onBalance) => { onBalance = fn; }, sendHook: (fn: typeof onSend) => { onSend = fn; },
      failSend: () => { sendError = true; }, failConfirm: () => { confirmError = true; }, missingMetadata: () => { metadataMissing = true; },
      confirmedFailure: () => { confirmedFailure = true; },
    };
  }
  try {
    await t.test('explicit enable uses existing wallet, requires interlock and disclaimer, and disables dedicated autotrade', async () => {
      const f = fixture();
      await assert.rejects(f.prepare(), /enable/);
      assert.throws(() => f.service.enable({ walletAddress: owner.toBase58(), confirmLiveDisclaimer: false }), /acknowledgement/);
      f.setLive(false); assert.throws(f.enable, /ENABLE_LIVE_TRADING=true locally/);
      f.setLive(true); assert.equal(f.enable().signingMethod, 'PHANTOM');
      assert.equal(f.cfg.autotradeMode, 'OFF'); assert.equal(f.coordinator.config.mode, SystemMode.LIVE);
    });
    await t.test('prepare never signs or sends; confirmed buy persists actual native cash cost and Phantom stops', async () => {
      const f = fixture(); f.enable(); const p = await f.prepare();
      assert.match(p.summary, /MANUAL SWAP/); assert.match(p.summary, /no calibrated early signal/);
      assert.equal(p.network, 'mainnet-beta'); assert.ok(p.expiresAt - now <= 15000);
      assert.equal(f.counts().sends, 0); assert.equal(forbiddenSigns, 0);
      const result: any = await f.service.submit(signed(p)); assert.equal(result.success, true, result.error);
      assert.equal(result.tokensReceived, 2); assert.equal(result.sizeSol, .0205);
      const position = f.coordinator.activePositions[0]; assert.equal(position.sizeBaseUnits, '2000000');
      assert.equal(position.signingMethod, 'PHANTOM'); assert.equal(position.exitApprovalRequired, true);
      assert.equal(position.stopLossPriceSol, position.entryPriceSol * .88);
      assert.equal(f.store.load()!.activePositions[0].costBasisSol, .0205);
      assert.equal(JupiterService.hasPendingExecution(owner.toBase58()), false);
    });
    await t.test('partial and full tracked exits use exact units, proportional basis and real fills even in emergency mode', async () => {
      const f = fixture(), position = await f.seedBuy();
      f.coordinator.config.mode = SystemMode.EMERGENCY_STOP; f.cfg.killSwitchActive = true; f.coordinator.riskLimits.circuitBreakerActive = true;
      const request: any = { walletAddress: owner.toBase58(), action: 'SELL', positionId: position.id, pctToExit: 50 };
      const p = await f.service.prepare(request), result: any = await f.service.submit(signed(p));
      assert.equal(result.success, true, result.error); assert.equal(result.tokensSold, 1); assert.equal(result.isFullyClosed, false);
      assert.equal(position.sizeBaseUnits, '1000000'); assert.equal(position.costBasisSol, .01025);
      assert.equal(result.solReceived, .010295); assert.ok(Math.abs(position.realizedPnlSol - .000045) < 1e-12);
      const full = await f.service.prepare({ ...request, pctToExit: 100 });
      assert.equal((await f.service.submit(signed(full)) as any).isFullyClosed, true);
      assert.equal(f.coordinator.activePositions.length, 0); assert.equal(f.coordinator.closedPositions.length, 1);
      assert.equal(f.store.load()!.closedPositions[0].sizeBaseUnits, '0');
    });
    await t.test('manual acknowledgement and explicit manual classification are mandatory', async () => {
      const f = fixture(); f.enable();
      await assert.rejects(f.service.prepare({ ...f.buy, manualRiskAcknowledged: false }), /manualRiskAcknowledged/);
      await assert.rejects(f.service.prepare({ ...f.buy, requireEarlySignal: undefined }), /requireEarlySignal/);
      await assert.rejects(f.service.prepare({ ...f.buy, requireEarlySignal: true }), /No observed launch signal/);
      assert.equal(f.counts().sends, 0);
    });
    await t.test('wrong owner, account changes, disconnect/reconnect and wrong network reject without sending', async () => {
      const f = fixture(); f.enable();
      await assert.rejects(f.service.prepare({ ...f.buy, walletAddress: BONK_MINT }), /owner/);
      const p = await f.prepare(); f.cfg.walletAddress = BONK_MINT;
      assert.equal((await f.service.submit(signed(p))).success, false);
      f.cfg.walletAddress = owner.toBase58(); const next = await f.prepare();
      f.service.invalidateConnection(); f.enable(); assert.equal((await f.service.submit(signed(next))).success, false);
      f.setGenesis('not-mainnet'); await assert.rejects(f.prepare(), /mainnet/);
      assert.equal(f.counts().sends, 0);
    });
    for (const [name, mutation] of [
      ['message/blockhash mutation', (tx: VersionedTransaction) => { tx.message.recentBlockhash = BONK_MINT; }],
      ['extra signer', (tx: VersionedTransaction) => { tx.message.header.numRequiredSignatures = 2; tx.signatures.push(new Uint8Array(64)); }],
      ['wrong amount', (tx: VersionedTransaction) => { tx.message.compiledInstructions.find(ix => tx.message.staticAccountKeys[ix.programIdIndex].equals(JUPITER_PROGRAM))!.data[16] ^= 1; }],
      ['wrong mint', (tx: VersionedTransaction) => { const i = tx.message.staticAccountKeys.findIndex(k => k.equals(token)); tx.message.staticAccountKeys[i] = sol; }],
    ] as const) await t.test(`${name} rejects even with a valid signature over modified bytes`, async () => {
      const f = fixture(); f.enable(); const p = await f.prepare();
      assert.equal((await f.service.submit(signed(p, mutation))).success, false); assert.equal(f.counts().sends, 0);
    });
    for (const zero of [true, false]) await t.test(`${zero ? 'zero' : 'invalid'} signature rejects`, async () => {
      const f = fixture(); f.enable(); const p = await f.prepare(), tx = VersionedTransaction.deserialize(Buffer.from(p.transactionBase64, 'base64'));
      tx.signatures[0].fill(zero ? 0 : 1);
      const result: any = await f.service.submit({ approvalId: p.approvalId, signedTransactionBase64: Buffer.from(tx.serialize()).toString('base64') });
      assert.equal(result.success, false); assert.match(result.error, /signature/); assert.equal(f.counts().sends, 0);
    });
    for (const [name, mutate] of [
      ['quote input amount', (q: any) => { q.inAmount = '1'; }], ['quote mint', (q: any) => { q.outputMint = SOL_MINT; }],
      ['quote price impact', (q: any) => { q.priceImpactPct = '9'; }], ['quote slippage', (q: any) => { q.slippageBps = 5000; }],
      ['stale quote', (q: any) => { q.fetchedAt = now - 15001; }], ['future quote', (q: any) => { q.fetchedAt = now + 1; }],
    ] as const) await t.test(`${name} is rejected by the actual quote validator`, async () => {
      const f = fixture(); f.enable(); f.mutateQuote(mutate); await assert.rejects(f.prepare()); assert.equal(f.counts().sends, 0);
    });
    await t.test('actual attestor rejects Pump buy and mismatched transaction amount', async () => {
      for (const variant of ['pump', 'amount']) {
        const f = fixture(); f.enable(); f.mutateBuild(tx => {
          const ix = tx.message.compiledInstructions.find(ix => tx.message.staticAccountKeys[ix.programIdIndex].equals(JUPITER_PROGRAM))!;
          if (variant === 'pump') ix.data[12] = 49; else ix.data[16] ^= 1;
        });
        await assert.rejects(f.prepare(), /TRADE_REJECTED/); assert.equal(f.counts().sends, 0);
      }
    });
    await t.test('invalid signatures do not consume an otherwise valid unexpired approval', async () => {
      const f = fixture(); f.enable(); const prepared = await f.prepare();
      const invalid = await f.service.submit({ approvalId: prepared.approvalId, signedTransactionBase64: prepared.transactionBase64 });
      assert.equal(invalid.success, false); assert.equal(f.counts().sends, 0);
      const valid: any = await f.service.submit(signed(prepared));
      assert.equal(valid.success, true, valid.error); assert.equal(f.counts().sends, 1);
    });
    await t.test('settled signature replay cannot double-account a partial then full exit', async () => {
      const f = fixture(); const position = await f.seedBuy();
      const exitRequest: any = { walletAddress: owner.toBase58(), action: 'SELL', positionId: position.id, pctToExit: 50 };
      const half = await f.service.prepare(exitRequest);
      const first: any = await f.service.submit(signed(half)); assert.equal(first.success, true, first.error);
      const saved = f.store.load()!;
      f.coordinator.activePositions = saved.activePositions;
      f.coordinator.closedPositions = saved.closedPositions;
      f.coordinator.settledSignatures = new Set(saved.settledSignatures);
      const before = structuredClone(f.coordinator.activePositions[0]);
      const previous = VersionedTransaction.deserialize(Buffer.from(half.transactionBase64, 'base64'));
      f.mutateBuild(tx => { tx.message.recentBlockhash = previous.message.recentBlockhash; });
      const remaining = await f.service.prepare({ ...exitRequest, pctToExit: 100 });
      assert.equal(remaining.transactionBase64, half.transactionBase64);
      const duplicate: any = await f.service.submit(signed(remaining));
      assert.equal(duplicate.success, false); assert.match(duplicate.error!, /already settled/);
      assert.equal(f.counts().sends, 2);
      assert.deepEqual(f.coordinator.activePositions[0], before);
      assert.equal(f.coordinator.closedPositions.length, 0);
      assert.equal(f.store.load()!.settledSignatures.length, 2);
    });
    await t.test('journal failure before send is a storage rejection, not an unknown chain execution', async () => {
      const f = fixture(); f.enable(); const prepared = await f.prepare();
      const journal = internals.journalPath;
      fs.mkdirSync(journal);
      const result: any = await f.service.submit(signed(prepared));
      assert.equal(result.success, false); assert.equal(result.status, 'REJECTED');
      assert.equal(result.txSignature, undefined); assert.match(result.error!, /Not broadcast by server/);
      assert.equal(f.counts().sends, 0); assert.equal(JupiterService.hasPendingExecution(owner.toBase58()), false);
      fs.rmSync(journal, { recursive: true });
      const retry = await f.prepare();
      assert.equal((await f.service.submit(signed(retry))).success, true);
      assert.equal(f.counts().sends, 1);
    });
    await t.test('expired approval, cancelled approval and consumed approval cannot send', async () => {
      const f = fixture(); f.enable(); const expired = await f.prepare(); now = expired.expiresAt;
      assert.equal((await f.service.submit(signed(expired))).success, false);
      const cancelled = await f.prepare(); f.service.cancel(cancelled.approvalId);
      assert.equal((await f.service.submit(signed(cancelled))).success, false);
      const valid = await f.prepare(), body = signed(valid); assert.equal((await f.service.submit(body)).success, true);
      assert.equal((await f.service.submit(body)).success, false); assert.equal(f.counts().sends, 1);
    });
    await t.test('per-wallet concurrent submissions cannot race or double-enter, cancel cannot erase submitting journal', async () => {
      const f = fixture(); f.enable(); const a = await f.prepare(), b = await f.prepare();
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>(r => { entered = r; });
      f.sendHook(async () => { entered(); await new Promise<void>(r => { release = r; }); });
      const pending = f.service.submit(signed(a)); await started;
      assert.throws(() => f.service.cancel(a.approvalId), /already submitted/);
      assert.equal((await f.service.submit(signed(a))).success, false);
      assert.equal((await f.service.submit(signed(b))).success, false);
      release(); assert.equal((await pending).success, true);
      assert.equal((await f.service.submit(signed(b))).success, false); assert.equal(f.counts().sends, 1);
    });
    for (const [name, change] of [
      ['mode', (f: ReturnType<typeof fixture>) => { f.coordinator.config.mode = SystemMode.SHADOW; }],
      ['risk cap', (f: ReturnType<typeof fixture>) => { f.coordinator.riskLimits.maxTradeLossSol = .001; }],
      ['kill switch', (f: ReturnType<typeof fixture>) => { f.cfg.killSwitchActive = true; }],
      ['fresh balance', (f: ReturnType<typeof fixture>) => { f.setBalance(1000); }],
      ['daily loss', (f: ReturnType<typeof fixture>) => { f.coordinator.portfolio.dailyRealizedPnlSol = -2; }],
      ['dedicated autotrade', (f: ReturnType<typeof fixture>) => { f.cfg.autotradeMode = 'FULL_AUTONOMOUS'; }],
      ['original height', (f: ReturnType<typeof fixture>) => { f.setHeight(201); }],
      ['original blockhash', (f: ReturnType<typeof fixture>) => { f.setBlockhash(false); }],
      ['RPC endpoint', (f: ReturnType<typeof fixture>) => { f.cfg.rpcEndpoint = 'http://changed.invalid'; }],
      ['mint decimals', (f: ReturnType<typeof fixture>) => { f.connection.getTokenSupply = async () => ({ value: { decimals: 7 } }); }],
      ['allocation', (f: ReturnType<typeof fixture>) => { f.cfg.allocatedCapitalSol = .001; }],
      ['minimum size', (f: ReturnType<typeof fixture>) => { f.cfg.minTradeSizeSol = .03; }],
      ['maximum size', (f: ReturnType<typeof fixture>) => { f.cfg.maxTradeSizeSol = .01; }],
      ['exposure fraction', (f: ReturnType<typeof fixture>) => { f.coordinator.riskLimits.maxTokenExposurePercent = .0001; }],
      ['consecutive losses', (f: ReturnType<typeof fixture>) => { f.coordinator.portfolio.consecutiveLosses = 3; }],
      ['drawdown', (f: ReturnType<typeof fixture>) => { f.coordinator.portfolio.currentDrawdownPct = 20; }],
      ['slippage limit', (f: ReturnType<typeof fixture>) => { f.cfg.maxSlippagePct = 1; }],
      ['malformed risk', (f: ReturnType<typeof fixture>) => { f.coordinator.riskLimits.maxSlippagePercent = NaN; }],
      ['balance RPC failure', (f: ReturnType<typeof fixture>) => { f.connection.getBalance = async () => { throw new Error('RPC unavailable'); }; }],
    ] as const) await t.test(`${name} changes between prepare/submit block broadcast`, async () => {
      const f = fixture(); f.enable(); const p = await f.prepare(); change(f);
      assert.equal((await f.service.submit(signed(p))).success, false); assert.equal(f.counts().sends, 0);
    });
    await t.test('last asynchronous guard rechecks account and risk immediately before send', async () => {
      const f = fixture(); f.enable(); const p = await f.prepare(); let reads = 0;
      f.balanceHook(async () => { if (++reads === 2) f.cfg.walletAddress = BONK_MINT; });
      assert.equal((await f.service.submit(signed(p))).success, false); assert.equal(f.counts().sends, 0);
    });
    for (const failure of ['send', 'confirm', 'metadata', 'settlement'] as const) await t.test(`${failure} uncertainty retains journal and blocks retries`, async () => {
      const f = fixture(); f.enable(); const p = await f.prepare();
      if (failure === 'send') f.failSend(); if (failure === 'confirm') f.failConfirm(); if (failure === 'metadata') f.missingMetadata();
      if (failure === 'settlement') f.coordinator.persistSettlement = () => { throw new Error('Disk unavailable'); };
      const result: any = await f.service.submit(signed(p)); assert.equal(result.success, false); assert.equal(result.status, 'UNKNOWN');
      assert.ok(result.txSignature); assert.equal(JupiterService.hasPendingExecution(owner.toBase58()), true);
      f.service.cancel(p.approvalId); assert.equal(JupiterService.hasPendingExecution(owner.toBase58()), true);
      await assert.rejects(f.prepare(), /Pending|duplicate/); assert.equal(f.counts().sends, 1);
    });
    await t.test('confirmed instruction failure does not book a fill or invent PnL', async () => {
      const f = fixture(); f.enable(); const p = await f.prepare(); f.confirmedFailure();
      const result: any = await f.service.submit(signed(p));
      assert.equal(result.success, false); assert.equal(result.status, 'FAILED');
      assert.equal(f.coordinator.activePositions.length, 0); assert.equal(f.coordinator.portfolio.dailyRealizedPnlSol, 0);
      assert.equal(JupiterService.hasPendingExecution(owner.toBase58()), false);
    });
    await t.test('post-refresh blockhash delay cannot make old balances appear fresh', async () => {
      const f = fixture(); f.enable(); const p = await f.prepare();
      f.connection.getBlockHeight = async () => { now += 3001; return 100; };
      const result: any = await f.service.submit(signed(p));
      assert.equal(result.success, false); assert.match(result.error, /Fresh on-chain balance/); assert.equal(f.counts().sends, 0);
    });
    await t.test('bounded prepared approvals clean expired entries and never touch execution journals', async () => {
      const f = fixture(); f.enable(); for (let i = 0; i < 4; i++) await f.prepare();
      await assert.rejects(f.prepare(), /Too many/); now += 15000; assert.equal((await f.prepare()).success, true);
      assert.equal(f.counts().sends, 0);
    });
    await t.test('untracked, foreign, paper, imprecise and changed sell positions cannot liquidate unrelated holdings', async () => {
      const f = fixture(), position = await f.seedBuy();
      const request: any = { walletAddress: owner.toBase58(), action: 'SELL', positionId: position.id };
      await assert.rejects(f.service.prepare({ ...request, positionId: 'unknown' }), /tracked position/);
      for (const [key, bad] of [['walletAddress', BONK_MINT], ['isSimulated', true], ['sizeBaseUnits', undefined], ['tokenDecimals', undefined]] as const) {
        const original = position[key]; position[key] = bad; await assert.rejects(f.service.prepare(request)); position[key] = original;
      }
      const p = await f.service.prepare(request); position.sizeBaseUnits = '1999999';
      assert.equal((await f.service.submit(signed(p))).success, false); assert.equal(f.counts().sends, 1);
    });
    await t.test('strategy approval invokes actual no-chase/round-trip guard and revalidates short lifetime', async () => {
      const f = fixture(); f.enable(); let signals = 0;
      f.coordinator.createSignalGuard = () => {
        signals++;
        return createEntryExecutionGuard({ initialPriceSol: .011, startedAt: now,
          evaluation: { decision: DecisionAction.BUY, signalAt: now, signalPriceSol: .011, signalAnchorSol: .011 } as any,
          now: () => now, validateSignal() {} });
      };
      const req = { ...f.buy, sizeSol: .2, requireEarlySignal: true, manualRiskAcknowledged: false };
      const p = await f.service.prepare(req); assert.equal(signals, 1); assert.match(p.summary, /STRATEGY BUY/);
      assert.ok(p.expiresAt - now <= 3000); assert.equal(f.counts().quoteCalls, 2); assert.equal(f.counts().builds, 2);
      now += 1600; const result: any = await f.service.submit(signed(p));
      assert.equal(result.success, false); assert.match(result.error, /stale/); assert.equal(f.counts().sends, 0);
    });
    await t.test('strategy no-chase ceiling and small-trade cost budget reject before approval', async () => {
      const f = fixture(); f.enable();
      f.coordinator.createSignalGuard = () => createEntryExecutionGuard({ initialPriceSol: .001, startedAt: now,
        evaluation: { decision: DecisionAction.BUY, signalAt: now, signalPriceSol: .001, signalAnchorSol: .001 } as any,
        now: () => now, validateSignal() {} });
      await assert.rejects(f.service.prepare({ ...f.buy, requireEarlySignal: true }), /no-chase/);
      f.coordinator.createSignalGuard = () => createEntryExecutionGuard({ initialPriceSol: .011, startedAt: now,
        evaluation: { decision: DecisionAction.BUY, signalAt: now, signalPriceSol: .011, signalAnchorSol: .011 } as any,
        now: () => now, validateSignal() {} });
      await assert.rejects(f.service.prepare({ ...f.buy, requireEarlySignal: true }), /round-trip cost/);
    });
    await t.test('strategy signal changing after approval blocks broadcast, unchanged guard can settle', async () => {
      const f = fixture(); f.enable(); let validSignal = true;
      f.coordinator.createSignalGuard = () => createEntryExecutionGuard({ initialPriceSol: .011, startedAt: now,
        evaluation: { decision: DecisionAction.BUY, signalAt: now, signalPriceSol: .011, signalAnchorSol: .011 } as any,
        now: () => now, validateSignal() { if (!validSignal) throw new Error('Signal expired or changed'); } });
      const request = { ...f.buy, sizeSol: .2, requireEarlySignal: true };
      const p = await f.service.prepare(request); validSignal = false;
      assert.equal((await f.service.submit(signed(p))).success, false); assert.equal(f.counts().sends, 0);
      validSignal = true; const next = await f.service.prepare(request);
      assert.equal((await f.service.submit(signed(next))).success, true); assert.equal(f.counts().sends, 1);
    });
    await t.test('coordinator surfaces Phantom stop recommendation without constructing dedicated wallet or selling', async () => {
      const f = fixture(), position = await f.seedBuy();
      const coordinator = Object.create(EngineCoordinator.prototype) as any;
      coordinator.activePositions = [position]; coordinator.pendingExits = new Set(); coordinator.observed = new Map();
      position.lastPriceAt = now; position.currentPriceSol = position.entryPriceSol * .5;
      coordinator.tickPositions(); assert.match(position.exitApprovalReason, /Phantom/); assert.equal(f.counts().sends, 1);
    });
    assert.equal(forbiddenSigns, 0, 'No service path may call server-side transaction signing');
  } finally {
    globalThis.fetch = originalFetch; VersionedTransaction.prototype.sign = originalSign; Date.now = originalNow;
    WalletManager.getInstance = originalWallet; internals.pending = originalPending; internals.journalPath = originalJournal;
    internals.liveTradingEnabled = originalInterlock; fs.rmSync(root, { recursive: true, force: true });
  }
});
