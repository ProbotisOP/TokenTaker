import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { LaunchInspector } from '../src/trading/launchInspector.ts';

const publicKey = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte)).toBase58();
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const mint = publicKey(1);
const creator = publicKey(2);
const wallet = publicKey(3);
const other = publicKey(4);
const poolAddress = PublicKey.findProgramAddressSync([
  Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer(),
], new PublicKey(PUMP))[0].toBase58();
const custody = PublicKey.findProgramAddressSync([
  new PublicKey(poolAddress).toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(mint).toBuffer(),
], new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0].toBase58();
const encode58 = (bytes: Uint8Array) => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let encoded = '';
  while (n > 0n) { encoded = alphabet[Number(n % 58n)] + encoded; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; encoded = `1${encoded}`; }
  return encoded;
};
const signature = encode58(new Uint8Array(64).fill(7));
const input = { mint, creator, poolAddress, signature };
const raw = (tokens: number) => String(tokens * 1_000_000);
const tokenAccount = (owner: string, tokens: number) => ({
  owner: TOKEN, executable: false, lamports: 2_039_280,
  data: { program: 'spl-token', parsed: { type: 'account', info: {
    mint, owner, state: 'initialized', tokenAmount: { amount: raw(tokens), decimals: 6 },
  } } },
});

function fixture() {
  const curveBytes = Buffer.alloc(150);
  Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).copy(curveBytes);
  for (const [offset, value] of [[8, 1_073_000_000n], [16, 35_000_000_000n], [24, 500_000_000n], [32, 5_000_000_000n], [40, 1_000_000_000n]] as const) {
    curveBytes.writeBigUInt64LE(value, offset);
  }
  new PublicKey(creator).toBuffer().copy(curveBytes, 49);
  const mintAccount = {
    owner: TOKEN, executable: false, lamports: 1_461_600,
    data: { program: 'spl-token', parsed: { type: 'mint', info: {
      isInitialized: true, decimals: 6, supply: raw(1_000), mintAuthority: null, freezeAuthority: null,
    } } },
  };
  const curveAccount = { owner: PUMP, executable: false, lamports: 5_003_000_000, data: [curveBytes.toString('base64'), 'base64'] };
  const holderAccounts: Record<string, any> = {
    [custody]: tokenAccount(poolAddress, 800),
    [publicKey(11)]: tokenAccount(wallet, 60),
    [publicKey(12)]: tokenAccount(wallet, 40),
    [publicKey(13)]: tokenAccount(creator, 50),
    [publicKey(14)]: tokenAccount(other, 50),
  };
  const largest: any[] = Object.entries(holderAccounts).map(([address, account]) => ({
    address, amount: account.data.parsed.info.tokenAmount.amount, decimals: 6,
  }));
  const creatorAccounts: any[] = [{ pubkey: publicKey(13), account: holderAccounts[publicKey(13)] }];
  const createData = Buffer.concat([
    Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]), Buffer.alloc(12), new PublicKey(creator).toBuffer(),
  ]);
  const transaction: any = {
    blockTime: 1_700_000_000,
    meta: { err: null, preBalances: [0, 0, 1, 1], postBalances: [1_461_600, 5_003_000_000, 1, 1], innerInstructions: [] },
    transaction: {
      signatures: [signature], message: {
        accountKeys: [mint, poolAddress, PUMP, creator].map(pubkey => ({ pubkey })),
        instructions: [{ programId: PUMP, accounts: [mint, poolAddress], data: encode58(createData) }],
      },
    },
  };
  const calls: { method: string; params: any[] }[] = [];
  const state = {
    mintAccount, curveAccount, curveBytes, holderAccounts, largest, creatorAccounts, transaction,
    calls, slot: 100, errorMethod: '', missingMethod: '',
    syncCurve() { curveAccount.data[0] = curveBytes.toString('base64'); },
  };
  const fetcher: typeof fetch = async (_url, options) => {
    const { id, method, params } = JSON.parse(String(options?.body));
    calls.push({ method, params });
    assert.equal(options?.method, 'POST');
    assert.ok(options?.signal);
    const config = params.at(-1);
    assert.equal(config.commitment, 'confirmed');
    let result: any;
    if (method === 'getTransaction') result = state.transaction;
    else {
      let value: any;
      if (method === 'getAccountInfo') value = params[0] === mint ? state.mintAccount : state.curveAccount;
      else if (method === 'getTokenLargestAccounts') value = state.largest;
      else if (method === 'getTokenAccountsByOwner') {
        assert.deepEqual(params[1], { mint });
        assert.equal(params[0], creator);
        value = state.creatorAccounts;
      } else if (method === 'getMultipleAccounts') {
        assert.ok(params[0].length <= 21);
        value = params[0].map((address: string) => state.holderAccounts[address] ?? null);
      } else throw new Error(`Unexpected RPC method: ${method}`);
      result = { context: { slot: state.slot }, value };
    }
    if (state.missingMethod === method) result = null;
    return new Response(JSON.stringify(state.errorMethod === method
      ? { jsonrpc: '2.0', id, error: { code: -32000, message: 'unavailable' } }
      : { jsonrpc: '2.0', id, result }), { status: 200 });
  };
  return { ...state, state, fetcher, inspector: new LaunchInspector('https://rpc.invalid', fetcher) };
}

test('decodes real SOL reserves, virtual spot price, creation time, grouped owners and verified custody', async () => {
  const f = fixture();
  const result = await f.inspector.inspect(input);
  assert.equal(result.createdAt, 1_700_000_000_000);
  assert.ok(result.checkedAt >= result.createdAt);
  assert.equal(result.liquiditySol, 5);
  assert.ok(Math.abs(result.priceSol - 35 / 1_073) < 1e-12);
  assert.equal(result.supplyTokens, 1_000);
  assert.equal(result.decimals, 6);
  assert.equal(result.tokenProgram, TOKEN);
  assert.equal(result.creator, creator);
  assert.equal(result.top1Pct, 10);
  assert.equal(result.top5Pct, 20);
  assert.equal(result.top10Pct, 20);
  assert.equal(result.creatorOwnershipPct, 5);
  assert.equal(result.mintAuthorityRevoked, true);
  assert.equal(result.freezeAuthorityRevoked, true);
  assert.equal(result.curveVerified, true);
  assert.equal(result.complete, false);
  assert.deepEqual(result.reasons, []);
  assert.equal(f.calls.length, 6);
});

test('only creation time is cached; curve and holder reads refresh on every inspection', async () => {
  const f = fixture();
  await f.inspector.inspect(input);
  f.curveBytes.writeBigUInt64LE(4_000_000_000n, 32);
  f.syncCurve();
  f.holderAccounts[publicKey(11)].data.parsed.info.tokenAmount.amount = raw(40);
  f.holderAccounts[publicKey(12)].data.parsed.info.tokenAmount.amount = raw(60);
  f.largest.find(a => a.address === publicKey(11)).amount = raw(40);
  f.largest.find(a => a.address === publicKey(12)).amount = raw(60);
  const result = await f.inspector.inspect(input);
  assert.equal(result.liquiditySol, 4);
  assert.equal(f.calls.filter(c => c.method === 'getTransaction').length, 1);
  for (const method of ['getTokenLargestAccounts', 'getTokenAccountsByOwner', 'getMultipleAccounts']) {
    assert.equal(f.calls.filter(c => c.method === method).length, 2);
  }
  assert.equal(f.calls.filter(c => c.method === 'getAccountInfo').length, 4);
});

for (const field of ['mintAuthority', 'freezeAuthority']) {
  test(`missing ${field} throws rather than inferring revoked`, async () => {
    const f = fixture();
    delete (f.mintAccount.data.parsed.info as any)[field];
    await assert.rejects(f.inspector.inspect(input), new RegExp(`missing ${field}`));
  });
  test(`active ${field} is explicitly blocked`, async () => {
    const f = fixture();
    (f.mintAccount.data.parsed.info as any)[field] = creator;
    const result = await f.inspector.inspect(input);
    assert.equal(result[field === 'mintAuthority' ? 'mintAuthorityRevoked' : 'freezeAuthorityRevoked'], false);
    assert.ok(result.reasons.includes(field === 'mintAuthority' ? 'mint-authority-not-revoked' : 'freeze-authority-not-revoked'));
  });
}

for (const [name, mutate] of [
  ['missing token program', (f: ReturnType<typeof fixture>) => { delete (f.mintAccount as any).owner; }],
  ['token-2022', (f: ReturnType<typeof fixture>) => { f.mintAccount.owner = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'; }],
  ['uninitialized mint', (f: ReturnType<typeof fixture>) => { f.mintAccount.data.parsed.info.isInitialized = false; }],
  ['missing initialization', (f: ReturnType<typeof fixture>) => { delete (f.mintAccount.data.parsed.info as any).isInitialized; }],
  ['malformed authority', (f: ReturnType<typeof fixture>) => { (f.mintAccount.data.parsed.info as any).mintAuthority = {}; }],
  ['wrong parsed type', (f: ReturnType<typeof fixture>) => { f.mintAccount.data.parsed.type = 'account'; }],
  ['malformed supply', (f: ReturnType<typeof fixture>) => { f.mintAccount.data.parsed.info.supply = '-1'; }],
] as const) {
  test(`fails closed for ${name}`, async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(f.inspector.inspect(input));
  });
}

for (const [name, mutate] of [
  ['wrong program owner', (f: ReturnType<typeof fixture>) => { f.curveAccount.owner = TOKEN; }],
  ['wrong discriminator', (f: ReturnType<typeof fixture>) => { f.curveBytes[0] = 0; f.syncCurve(); }],
  ['missing creator layout', (f: ReturnType<typeof fixture>) => { f.curveAccount.data[0] = f.curveBytes.subarray(0, 49).toString('base64'); }],
  ['malformed base64', (f: ReturnType<typeof fixture>) => { f.curveAccount.data[0] = 'not-base64!'; }],
  ['invalid complete flag', (f: ReturnType<typeof fixture>) => { f.curveBytes[48] = 2; f.syncCurve(); }],
  ['wrong creator', (f: ReturnType<typeof fixture>) => { new PublicKey(other).toBuffer().copy(f.curveBytes, 49); f.syncCurve(); }],
  ['insufficient physical lamports', (f: ReturnType<typeof fixture>) => { f.curveAccount.lamports = 4_000_000_000; }],
  ['supply mismatch', (f: ReturnType<typeof fixture>) => { f.curveBytes.writeBigUInt64LE(1n, 40); f.syncCurve(); }],
  ['non-SOL quote extension', (f: ReturnType<typeof fixture>) => { new PublicKey(other).toBuffer().copy(f.curveBytes, 83); f.syncCurve(); }],
  ['unknown extension', (f: ReturnType<typeof fixture>) => { f.curveBytes[149] = 1; f.syncCurve(); }],
] as const) {
  test(`rejects curve with ${name}`, async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(f.inspector.inspect(input));
  });
}

test('unsupported pool PDA rejects before making RPC calls', async () => {
  const f = fixture();
  await assert.rejects(f.inspector.inspect({ ...input, poolAddress: other }), /unsupported pool/);
  assert.equal(f.calls.length, 0);
});

test('completed/migrated and zero-real-liquidity curves are blocking, even with virtual SOL', async () => {
  const f = fixture();
  f.curveBytes[48] = 1;
  f.curveBytes.writeBigUInt64LE(0n, 24);
  f.curveBytes.writeBigUInt64LE(0n, 32);
  f.syncCurve();
  const result = await f.inspector.inspect(input);
  assert.equal(result.complete, true);
  assert.equal(result.liquiditySol, 0);
  assert.ok(result.priceSol > 0);
  assert.ok(result.reasons.includes('curve-complete-or-migrated'));
  assert.ok(result.reasons.includes('curve-has-no-real-sol-liquidity'));
});

test('mayhem and cashback extensions block', async () => {
  const f = fixture();
  f.curveBytes[81] = 1;
  f.curveBytes[82] = 1;
  f.syncCurve();
  const result = await f.inspector.inspect(input);
  assert.ok(result.reasons.includes('unsupported-mayhem-curve'));
  assert.ok(result.reasons.includes('unsupported-cashback-curve'));
});

for (const [name, mutate] of [
  ['missing transaction', (f: ReturnType<typeof fixture>) => { f.state.missingMethod = 'getTransaction'; }],
  ['missing block time', (f: ReturnType<typeof fixture>) => { f.transaction.blockTime = null; }],
  ['failed transaction', (f: ReturnType<typeof fixture>) => { f.transaction.meta.err = { InstructionError: [0, 'x'] }; }],
  ['missing err status', (f: ReturnType<typeof fixture>) => { delete f.transaction.meta.err; }],
  ['unrelated signature', (f: ReturnType<typeof fixture>) => { f.transaction.transaction.signatures = [encode58(new Uint8Array(64).fill(8))]; }],
  ['unrelated mint', (f: ReturnType<typeof fixture>) => { f.transaction.transaction.message.accountKeys[0].pubkey = other; }],
  ['existing mint', (f: ReturnType<typeof fixture>) => { f.transaction.meta.preBalances[0] = 1; }],
  ['unfunded mint', (f: ReturnType<typeof fixture>) => { f.transaction.meta.postBalances[0] = 0; }],
  ['missing balances', (f: ReturnType<typeof fixture>) => { f.transaction.meta.preBalances = []; }],
  ['malformed balances', (f: ReturnType<typeof fixture>) => { f.transaction.meta.postBalances[0] = '100'; }],
  ['non-Pump instruction', (f: ReturnType<typeof fixture>) => { f.transaction.transaction.message.instructions[0].programId = TOKEN; }],
  ['non-create Pump instruction', (f: ReturnType<typeof fixture>) => { f.transaction.transaction.message.instructions[0].data = encode58(new Uint8Array(8).fill(1)); }],
] as const) {
  test(`rejects ${name} as creation evidence`, async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(f.inspector.inspect(input));
  });
}

test('supports a verified Pump create nested in inner instructions', async () => {
  const f = fixture();
  f.transaction.meta.innerInstructions = [{ index: 0, instructions: f.transaction.transaction.message.instructions }];
  f.transaction.transaction.message.instructions = [{ programId: other }];
  assert.deepEqual((await f.inspector.inspect(input)).reasons, []);
});

test('incomplete holder coverage blocks and reports concentration upper bounds', async () => {
  const f = fixture();
  f.largest.splice(f.largest.findIndex(a => a.address === publicKey(14)), 1);
  const result = await f.inspector.inspect(input);
  assert.ok(result.reasons.includes('incomplete-holder-coverage'));
  assert.equal(result.top1Pct, 15);
  assert.equal(result.top5Pct, 20);
  assert.equal(result.creatorOwnershipPct, 5);
});

test('creator query can complete coverage and aggregates multiple creator accounts', async () => {
  const f = fixture();
  f.holderAccounts[publicKey(14)].data.parsed.info.owner = creator;
  f.creatorAccounts.push({ pubkey: publicKey(14), account: f.holderAccounts[publicKey(14)] });
  f.largest.splice(f.largest.findIndex(a => a.address === publicKey(14)), 1);
  const result = await f.inspector.inspect(input);
  assert.equal(result.creatorOwnershipPct, 10);
  assert.equal(result.top1Pct, 10);
  assert.deepEqual(result.reasons, []);
});

test('off-curve owner and noncanonical curve-owned account are not claimed to be LP exclusions', async () => {
  const f = fixture();
  f.holderAccounts[publicKey(11)].data.parsed.info.owner = poolAddress;
  f.holderAccounts[publicKey(12)].data.parsed.info.owner = poolAddress;
  const result = await f.inspector.inspect(input);
  assert.equal(result.top1Pct, 10);
  assert.equal(result.top10Pct, 20);
  assert.deepEqual(result.reasons, []);
});

for (const [name, mutate] of [
  ['spoofed custody owner', (f: ReturnType<typeof fixture>) => { f.holderAccounts[custody].data.parsed.info.owner = wallet; }],
  ['missing custody', (f: ReturnType<typeof fixture>) => { delete f.holderAccounts[custody]; }],
  ['missing holder owner', (f: ReturnType<typeof fixture>) => { delete f.holderAccounts[publicKey(11)].data.parsed.info.owner; }],
  ['wrong holder mint', (f: ReturnType<typeof fixture>) => { f.holderAccounts[publicKey(11)].data.parsed.info.mint = other; }],
  ['frozen holder', (f: ReturnType<typeof fixture>) => { f.holderAccounts[publicKey(11)].data.parsed.info.state = 'frozen'; }],
  ['duplicate largest account', (f: ReturnType<typeof fixture>) => { f.largest.push(f.largest[0]); }],
  ['holder snapshot changed', (f: ReturnType<typeof fixture>) => { f.largest[1].amount = raw(59); }],
  ['missing creator balance response', (f: ReturnType<typeof fixture>) => { f.state.missingMethod = 'getTokenAccountsByOwner'; }],
  ['incomplete creator accounts', (f: ReturnType<typeof fixture>) => { f.creatorAccounts.length = 0; }],
  ['foreign creator account', (f: ReturnType<typeof fixture>) => { f.creatorAccounts.push({ pubkey: publicKey(11), account: f.holderAccounts[publicKey(11)] }); }],
] as const) {
  test(`fails closed for ${name}`, async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(f.inspector.inspect(input));
  });
}

test('zero creator balance requires successful empty on-chain query without contradictory holders', async () => {
  const f = fixture();
  f.creatorAccounts.length = 0;
  f.holderAccounts[publicKey(13)].data.parsed.info.owner = other;
  const result = await f.inspector.inspect(input);
  assert.equal(result.creatorOwnershipPct, 0);
  assert.deepEqual(result.reasons, []);
});

test('RPC errors and malformed envelopes propagate instead of inventing safe values', async () => {
  const f = fixture();
  f.state.errorMethod = 'getTokenLargestAccounts';
  await assert.rejects(f.inspector.inspect(input), /RPC error/);
  const inspector = new LaunchInspector('https://rpc.invalid', async () => new Response('{}'));
  await assert.rejects(inspector.inspect(input), /RPC response ID\/version mismatch/);
});

test('a create discriminator alone is not a valid creation instruction', async () => {
  const f = fixture();
  f.transaction.transaction.message.instructions[0].data = encode58(Uint8Array.from([24, 30, 200, 40, 5, 28, 7, 119]));
  await assert.rejects(f.inspector.inspect(input), /truncated create/);
});

test('creation cache evicts oldest immutable timestamp at its bound', async () => {
  const f = fixture();
  const cache: Map<string, number> = (f.inspector as any).creationTimes;
  for (let index = 0; index < 1_024; index++) cache.set(`fixture-${index}`, 1_700_000_000_000);
  await f.inspector.inspect(input);
  assert.equal(cache.size, 1_024);
  assert.equal(cache.has('fixture-0'), false);
  assert.equal(cache.get(mint), 1_700_000_000_000);
});

test('stale largest-account snapshots cannot pass a newer mint/curve observation', async () => {
  const f = fixture();
  const inspector = new LaunchInspector('https://rpc.invalid', async (url, options) => {
    const response = await f.fetcher(url, options);
    const body = await response.json();
    if (JSON.parse(String(options?.body)).method === 'getTokenLargestAccounts') body.result.context.slot = 99;
    return new Response(JSON.stringify(body));
  });
  await assert.rejects(inspector.inspect(input), /stale\/missing RPC value/);
});

test('hung fetches are bounded even if the injected fetcher ignores abort', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const signals: AbortSignal[] = [];
  const inspector = new LaunchInspector('https://rpc.invalid', async (_url, options) => {
    signals.push(options!.signal!);
    return new Promise<Response>(() => {});
  });
  const rejected = assert.rejects(inspector.inspect(input), /timed out/);
  context.mock.timers.tick(10_000);
  await rejected;
  assert.equal(signals.length, 3);
  assert.ok(signals.every(signal => signal.aborted));
});
