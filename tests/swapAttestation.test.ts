import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from '@solana/web3.js';
import { attestSwap, JUPITER_PROGRAM, requireAttestedSwap, walletAta } from '../src/trading/swapAttestation.ts';

const owner = Keypair.generate().publicKey;
const token = Keypair.generate().publicKey;
const sol = new PublicKey('So11111111111111111111111111111111111111112');
const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const event = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], JUPITER_PROGRAM)[0];
const blockhash = Keypair.generate().publicKey.toBase58();
const connection: any = {};
function fixture(action: 'BUY' | 'SELL' = 'BUY') {
  const input = action === 'BUY' ? sol : token, output = action === 'BUY' ? token : sol;
  const data = Buffer.alloc(35);
  createHash('sha256').update('global:route').digest().copy(data, 0, 0, 8);
  data.writeUInt32LE(1, 8); data[12] = action === 'BUY' ? 49 : 50;
  data[13] = 100; data[15] = 1;
  data.writeBigUInt64LE(20_000_000n, 16); data.writeBigUInt64LE(10_000_000n, 24); data.writeUInt16LE(250, 32);
  const route = new TransactionInstruction({ programId: JUPITER_PROGRAM, data,
    keys: [tokenProgram, owner, walletAta(owner, input), walletAta(owner, output), JUPITER_PROGRAM, output, JUPITER_PROGRAM, event, JUPITER_PROGRAM]
      .map((pubkey, i) => ({ pubkey, isSigner: i === 1, isWritable: i === 2 || i === 3 })) });
  const close = new TransactionInstruction({ programId: tokenProgram, data: Buffer.from([9]),
    keys: [walletAta(owner, sol), owner, owner].map((pubkey, i) => ({ pubkey, isWritable: i < 2, isSigner: i === 2 })) });
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
    ...(action === 'BUY' ? [SystemProgram.transfer({ fromPubkey: owner, toPubkey: walletAta(owner, sol), lamports: 20_000_000 })] : []), route, close];
  const intent = { action, tokenMint: token.toBase58(), walletAddress: owner.toBase58(), inputBaseUnits: '20000000', minimumOutputBaseUnits: '9750000' };
  const tx = () => new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message());
  return { intent, instructions, route, close, tx };
}
for (const action of ['BUY', 'SELL'] as const) test(`attests a supported direct ${action}, never signs it`, async () => {
  const f = fixture(action), tx = f.tx();
  await attestSwap(connection, tx, f.intent);
  requireAttestedSwap(tx, f.intent);
  assert.ok(tx.signatures[0].every(n => n === 0));
  tx.message.recentBlockhash = owner.toBase58();
  assert.throws(() => requireAttestedSwap(tx, f.intent), /NOT_ATTESTED/);
});
for (const [label, mutate] of [
  ['amount mismatch', (f: ReturnType<typeof fixture>) => f.route.data.writeBigUInt64LE(21_000_000n, 16)],
  ['minimum output mismatch', (f: ReturnType<typeof fixture>) => f.route.data.writeBigUInt64LE(1n, 24)],
  ['unsupported route plan', (f: ReturnType<typeof fixture>) => f.route.data.writeUInt32LE(2, 8)],
  ['extra trailing bytes', (f: ReturnType<typeof fixture>) => { f.route.data = Buffer.concat([f.route.data, Buffer.alloc(1)]); }],
  ['referral fee', (f: ReturnType<typeof fixture>) => { f.route.data[34] = 1; }],
  ['reverse direction', (f: ReturnType<typeof fixture>) => { f.route.data[12] = 50; }],
  ['wrong mint', (f: ReturnType<typeof fixture>) => { f.route.keys[5].pubkey = owner; }],
  ['wrong recipient', (f: ReturnType<typeof fixture>) => { f.route.keys[3].pubkey = owner; }],
  ['missing cleanup', (f: ReturnType<typeof fixture>) => { f.instructions.pop(); }],
  ['foreign cleanup', (f: ReturnType<typeof fixture>) => { f.close.keys[1].pubkey = token; }],
  ['extra swap', (f: ReturnType<typeof fixture>) => { f.instructions.splice(-1, 0, f.route); }],
  ['excessive fees', (f: ReturnType<typeof fixture>) => { f.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }); }],
  ['extra transfer', (f: ReturnType<typeof fixture>) => { f.instructions.unshift(SystemProgram.transfer({ fromPubkey: owner, toPubkey: token, lamports: 1 })); }],
  ['token delegation', (f: ReturnType<typeof fixture>) => { f.instructions.unshift(new TransactionInstruction({ programId: tokenProgram, keys: [], data: Buffer.from([4]) })); }],
] as const) test(`rejects ${label}`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(attestSwap(connection, f.tx(), f.intent), /TRADE_REJECTED/);
});
test('lookup table addresses are resolved before account authorization', async () => {
  const f = fixture();
  const table = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: {
    deactivationSlot: 0xffffffffffffffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0,
    addresses: [walletAta(owner, sol), walletAta(owner, token)],
  } });
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: f.instructions }).compileToV0Message([table]));
  assert.equal(tx.message.addressTableLookups.length, 1);
  await attestSwap({ getAddressLookupTable: async () => ({ value: table }) } as any, tx, f.intent);
  await assert.rejects(attestSwap({ getAddressLookupTable: async () => ({ value: null }) } as any, tx, f.intent), /UNVERIFIED_LOOKUP_TABLE/);
});
