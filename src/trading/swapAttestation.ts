import { createHash } from 'node:crypto';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

export const JUPITER_PROGRAM = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SOL = new PublicKey('So11111111111111111111111111111111111111112');
const SYSTEM = PublicKey.default;
const COMPUTE = new PublicKey('ComputeBudget111111111111111111111111111111');
const ROUTE = createHash('sha256').update('global:route').digest().subarray(0, 8);
const EVENT = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], JUPITER_PROGRAM)[0];
const attestations = new WeakMap<VersionedTransaction, { bytes: string; action: string; tokenMint: string; walletAddress: string }>();
const fingerprint = (tx: VersionedTransaction) => createHash('sha256').update(tx.message.serialize()).digest('hex');

export function requireAttestedSwap(tx: VersionedTransaction, intent: { action: string; tokenMint: string; walletAddress: string }): void {
  const evidence = attestations.get(tx);
  requireSafe(evidence && evidence.bytes === fingerprint(tx) && evidence.action === intent.action &&
    evidence.tokenMint === intent.tokenMint && evidence.walletAddress === intent.walletAddress, 'SWAP_INSTRUCTIONS_NOT_ATTESTED');
}

export interface SwapIntent {
  action: 'BUY' | 'SELL'; tokenMint: string; walletAddress: string;
  inputBaseUnits: string; minimumOutputBaseUnits: string;
}
export function walletAta(wallet: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([wallet.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA)[0];
}
function requireSafe(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`TRADE_REJECTED: ${reason}`);
}

/** Supports only legacy-SPL, single-hop, V1 ExactIn routes, deliberately not arbitrary router payloads.
 * Layout/enum source: https://github.com/jup-ag/instruction-parser/blob/main/src/idl/jupiter.ts
 * Other instruction variants, split routes, Token-2022 and referral fees require separate validation.
 */
export async function attestSwap(connection: Connection, tx: VersionedTransaction, intent: SwapIntent): Promise<void> {
  requireSafe(['BUY', 'SELL'].includes(intent.action), 'INVALID_SWAP_ACTION');
  requireSafe(/^[1-9][0-9]*$/.test(intent.inputBaseUnits) && /^[1-9][0-9]*$/.test(intent.minimumOutputBaseUnits), 'INVALID_SWAP_AMOUNTS');
  const owner = new PublicKey(intent.walletAddress);
  const token = new PublicKey(intent.tokenMint);
  requireSafe(!token.equals(SOL), 'INVALID_SWAP_MINT');
  const inputMint = intent.action === 'BUY' ? SOL : token;
  const outputMint = intent.action === 'BUY' ? token : SOL;
  const source = walletAta(owner, inputMint), destination = walletAta(owner, outputMint), wsol = walletAta(owner, SOL);
  const message = tx.message;
  requireSafe(message.header.numRequiredSignatures === 1 && message.staticAccountKeys[0].equals(owner), 'INVALID_TRANSACTION_SIGNER');
  const lookupAccounts = await Promise.all(message.addressTableLookups.map(async lookup => {
    const result = await connection.getAddressLookupTable(lookup.accountKey);
    requireSafe(result.value && result.value.key.equals(lookup.accountKey) && result.value.isActive(), 'UNVERIFIED_LOOKUP_TABLE');
    return result.value;
  }));
  const keys = message.getAccountKeys({ addressLookupTableAccounts: lookupAccounts });
  const keyAt = (index: number) => {
    const key = keys.get(index);
    requireSafe(key, 'MISSING_TRANSACTION_ACCOUNT');
    return key;
  };
  let swaps = 0, wrapped = 0n, computeLimit = 1_400_000n, computePrice = 0n;
  let seenLimit = false, seenPrice = false, closed = false;
  const created = new Set<string>();
  for (const instruction of message.compiledInstructions) {
    const program = keyAt(instruction.programIdIndex);
    const accounts = instruction.accountKeyIndexes.map(keyAt);
    const data = Buffer.from(instruction.data);
    const is = (index: number, expected: PublicKey) => accounts[index]?.equals(expected) === true;
    if (program.equals(COMPUTE)) {
      requireSafe(swaps === 0 && accounts.length === 0, 'INVALID_COMPUTE_INSTRUCTION');
      if (data[0] === 2 && data.length === 5 && !seenLimit) {
        computeLimit = BigInt(data.readUInt32LE(1)); seenLimit = true;
        requireSafe(computeLimit > 0 && computeLimit <= 1_400_000n, 'EXCESSIVE_COMPUTE_LIMIT');
      } else if (data[0] === 3 && data.length === 9 && !seenPrice) {
        computePrice = data.readBigUInt64LE(1); seenPrice = true;
      } else throw new Error('TRADE_REJECTED: UNSUPPORTED_COMPUTE_INSTRUCTION');
    } else if (program.equals(ATA)) {
      requireSafe(swaps === 0 && (data.length === 0 || (data.length === 1 && data[0] <= 1)), 'UNSUPPORTED_ATA_INSTRUCTION');
      requireSafe(accounts.length === 6 || accounts.length === 7, 'INVALID_ATA_ACCOUNTS');
      requireSafe(is(0, owner) && is(2, owner) && is(4, SYSTEM) && is(5, TOKEN), 'FOREIGN_ATA_AUTHORITY');
      requireSafe((is(1, source) && is(3, inputMint)) || (is(1, destination) && is(3, outputMint)), 'FOREIGN_ATA_DESTINATION');
      const address = accounts[1].toBase58();
      requireSafe(!created.has(address), 'DUPLICATE_ATA_CREATE'); created.add(address);
    } else if (program.equals(SYSTEM)) {
      requireSafe(swaps === 0 && intent.action === 'BUY' && data.length === 12 && data.readUInt32LE(0) === 2 && accounts.length === 2,
        'UNSUPPORTED_SYSTEM_INSTRUCTION');
      requireSafe(is(0, owner) && is(1, wsol), 'UNAUTHORIZED_NATIVE_TRANSFER');
      wrapped += data.readBigUInt64LE(4);
      requireSafe(wrapped <= BigInt(intent.inputBaseUnits), 'EXCESSIVE_NATIVE_TRANSFER');
    } else if (program.equals(TOKEN)) {
      if (data.length === 1 && data[0] === 17) {
        requireSafe(swaps === 0 && accounts.length === 1 && is(0, wsol), 'UNAUTHORIZED_SYNC_NATIVE');
      } else if (data.length === 1 && data[0] === 9) {
        requireSafe(swaps === 1 && !closed && accounts.length === 3 && is(0, wsol) && is(1, owner) && is(2, owner), 'UNAUTHORIZED_CLOSE_ACCOUNT');
        closed = true;
      } else throw new Error('TRADE_REJECTED: UNAUTHORIZED_TOKEN_INSTRUCTION');
    } else if (program.equals(JUPITER_PROGRAM)) {
      requireSafe(++swaps === 1 && !closed && data.length === 35 && data.subarray(0, 8).equals(ROUTE), 'UNSUPPORTED_JUPITER_ROUTE');
      // One no-payload Swap enum + percent/input/output indices, followed by exact-in arguments.
      requireSafe(data.readUInt32LE(8) === 1 && data[13] === 100 && data[14] === 0 && data[15] === 1, 'UNSUPPORTED_ROUTE_PLAN');
      const variant = data[12];
      requireSafe([7, 19, 26, 38, 46, 49, 50].includes(variant), 'UNSUPPORTED_SWAP_ADAPTER');
      requireSafe(variant !== 49 || intent.action === 'BUY', 'REVERSED_PUMP_ROUTE');
      requireSafe(variant !== 50 || intent.action === 'SELL', 'REVERSED_PUMP_ROUTE');
      requireSafe(data.readBigUInt64LE(16) === BigInt(intent.inputBaseUnits), 'WRONG_ROUTE_INPUT_AMOUNT');
      const out = data.readBigUInt64LE(24), slippage = data.readUInt16LE(32);
      requireSafe(slippage <= 5000 && data[34] === 0 && out * BigInt(10000 - slippage) / 10000n >= BigInt(intent.minimumOutputBaseUnits), 'WRONG_ROUTE_MINIMUM_OUTPUT');
      requireSafe(accounts.length >= 9 && is(0, TOKEN) && is(1, owner) && is(2, source) && is(3, destination) &&
        is(4, JUPITER_PROGRAM) && is(5, outputMint) && is(6, JUPITER_PROGRAM) && is(7, EVENT) && is(8, JUPITER_PROGRAM), 'WRONG_ROUTE_ACCOUNTS');
      // The only writable signer's source/destination accounts are constrained above; adapter programs
      // execute through the known Jupiter program's typed swap enum, never an arbitrary CPI payload.
    } else throw new Error(`TRADE_REJECTED: UNAUTHORIZED_PROGRAM ${program.toBase58()}`);
  }
  requireSafe(swaps === 1 && closed, 'MISSING_SWAP_OR_NATIVE_CLEANUP');
  requireSafe((computeLimit * computePrice + 999_999n) / 1_000_000n <= 150_000n, 'EXCESSIVE_PRIORITY_FEE');
  attestations.set(tx, { bytes: fingerprint(tx), action: intent.action, tokenMint: intent.tokenMint, walletAddress: intent.walletAddress });
}
