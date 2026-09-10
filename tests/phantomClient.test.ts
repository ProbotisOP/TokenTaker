import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { approvePhantomTrade, connectPhantom, enablePhantomTrading, getPhantomProvider, type PhantomProvider } from '../src/phantomClient.ts';

function fixture() {
  const key = Keypair.generate();
  const address = key.publicKey.toBase58();
  const message = new TransactionMessage({ payerKey: key.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: key.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message();
  const unsigned = new VersionedTransaction(message);
  const calls: { path: string; body: any }[] = [];
  const provider: PhantomProvider = { isPhantom: true, publicKey: key.publicKey,
    async connect() { return { publicKey: key.publicKey }; },
    async signTransaction(tx) { tx.sign([key]); return tx; } };
  let now = 100_000;
  const fetcher = (async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const result = path.endsWith('/prepare') ? { success: true, approvalId: 'test-approval', walletAddress: address,
      transactionBase64: Buffer.from(unsigned.serialize()).toString('base64'), expiresAt: 115_000,
      action: 'BUY', tokenMint: 'test-token', network: 'mainnet-beta', summary: 'Offline test only' }
      : path.endsWith('/submit') ? { success: true, txSignature: 'confirmed-test-signature', positionId: 'test-position' }
      : path.endsWith('/state') ? { config: { network: 'mainnet-beta', rpcEndpoint: 'https://rpc.invalid' } }
      : { success: true, config: { walletAddress: address } };
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { key, address, provider, calls, fetcher, deps: { provider, fetcher, now: () => now }, setNow(value: number) { now = value; } };
}
const request = { action: 'BUY' as const, tokenMint: 'test-token', sizeSol: .02, manualRiskAcknowledged: true };

test('Phantom signs once; no submit occurs before its approval', async () => {
  const f = fixture(); const phases: string[] = [];
  f.provider.signTransaction = async tx => {
    assert.equal(f.calls.some(c => c.path.endsWith('/submit')), false);
    assert.ok(tx.signatures[0].every(n => n === 0));
    tx.sign([f.key]); return tx;
  };
  const result = await approvePhantomTrade(request, { ...f.deps, onPhase: phase => phases.push(phase) });
  assert.equal(result.success, true);
  assert.deepEqual(phases, ['PREPARING', 'AWAITING_PHANTOM', 'SUBMITTING', 'CONFIRMED']);
  const body = f.calls.find(c => c.path.endsWith('/submit'))!.body;
  const submitted = VersionedTransaction.deserialize(Buffer.from(body.signedTransactionBase64, 'base64'));
  assert.ok(submitted.signatures[0].some(n => n !== 0));
  assert.equal(f.calls.filter(c => c.path.endsWith('/submit')).length, 1);
});

test('user cancellation discards preparation and never submits', async () => {
  const f = fixture();
  f.provider.signTransaction = async () => { throw Object.assign(new Error('Rejected'), { code: 4001 }); };
  await assert.rejects(approvePhantomTrade(request, f.deps), /cancelled.*Nothing was submitted/);
  assert.equal(f.calls.some(c => c.path.endsWith('/submit')), false);
  assert.equal(f.calls.filter(c => c.path.endsWith('/cancel')).length, 1);
});

test('quote expiry while approving never broadcasts the signed transaction', async () => {
  const f = fixture();
  f.provider.signTransaction = async tx => { tx.sign([f.key]); f.setNow(115_000); return tx; };
  await assert.rejects(approvePhantomTrade(request, f.deps), /expired during approval/);
  assert.equal(f.calls.some(c => c.path.endsWith('/submit')), false);
});

test('account change or altered transaction is cancelled before submit', async () => {
  for (const mutate of ['account', 'message']) {
    const f = fixture();
    f.provider.signTransaction = async tx => {
      tx.sign([f.key]);
      if (mutate === 'account') f.provider.publicKey = Keypair.generate().publicKey;
      else tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
      return tx;
    };
    await assert.rejects(approvePhantomTrade(request, f.deps), /account changed|different transaction/);
    assert.equal(f.calls.some(c => c.path.endsWith('/submit')), false);
  }
});

test('foreign-position exit does not prepare or ask for a signature', async () => {
  const f = fixture();
  await assert.rejects(approvePhantomTrade({ action: 'SELL', positionId: 'foreign', expectedWalletAddress: Keypair.generate().publicKey.toBase58() }, f.deps), /owns this position/);
  assert.equal(f.calls.length, 0);
});

test('ambiguous submit response never cancels or automatically resends', async () => {
  const f = fixture();
  const fetcher = (async (path: string, options?: RequestInit) => {
    if (path.endsWith('/submit')) { f.calls.push({ path, body: undefined }); throw new Error('socket lost'); }
    return f.fetcher(path, options);
  }) as typeof fetch;
  await assert.rejects(approvePhantomTrade(request, { ...f.deps, fetcher }), /outcome is unknown.*Do not retry/);
  assert.equal(f.calls.filter(c => c.path.endsWith('/submit')).length, 1);
  assert.equal(f.calls.some(c => c.path.endsWith('/cancel')), false);
});

test('only one Phantom approval can be open across all trade controls', async () => {
  const f = fixture(); let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  f.provider.signTransaction = async tx => { entered(); await new Promise<void>(resolve => { release = resolve; }); tx.sign([f.key]); return tx; };
  const first = approvePhantomTrade(request, f.deps); await waiting;
  await assert.rejects(approvePhantomTrade(request, fixture().deps), /already in progress/);
  release(); assert.equal((await first).success, true);
});

test('connect preserves configured mainnet RPC and enable never prepares a trade', async () => {
  const f = fixture();
  const result = await connectPhantom(f.deps);
  assert.equal(result.address, f.address);
  const body = f.calls.find(c => c.path.endsWith('/connect'))!.body;
  assert.deepEqual(body, { address: f.address, walletName: 'Phantom', network: 'mainnet-beta', rpcEndpoint: 'https://rpc.invalid' });
  await enablePhantomTrading(f.deps);
  assert.equal(f.calls.at(-1)!.body.confirmLiveDisclaimer, true);
  assert.equal(f.calls.some(c => c.path.endsWith('/prepare') || c.path.endsWith('/submit')), false);
});

test('missing Phantom never silently selects a demo or another wallet', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { solana: { isPhantom: false } } });
  try { assert.throws(getPhantomProvider, /No demo wallet/); }
  finally { if (original) Object.defineProperty(globalThis, 'window', original); else delete (globalThis as any).window; }
});
