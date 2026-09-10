import { PublicKey } from '@solana/web3.js';

export interface LaunchInspection {
  /** Unix milliseconds from the confirmed creation transaction, not feed receipt. */
  createdAt: number;
  checkedAt: number;
  priceSol: number;
  liquiditySol: number;
  tokenProgram: string;
  decimals: number;
  supplyTokens: number;
  creator: string;
  top1Pct: number;
  top5Pct: number;
  top10Pct: number;
  holderCount?: number;
  creatorOwnershipPct: number;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  curveVerified: boolean;
  complete: boolean;
  /** Every reason is blocking. No reasons means verified, not investment-safe. */
  reasons: string[];
}

type Input = { mint: string; signature: string; creator: string; poolAddress: string };
type Json = Record<string, any>;
type Holder = { owner: string; amount: bigint };
const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
// https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
// BondingCurve discriminator and Borsh field order place creator at byte 49.
// Newer layouts append mayhem/cashback booleans at 81/82 and quote_mint at 83.
const CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];
const CREATE_DISCRIMINATOR = [24, 30, 200, 40, 5, 28, 7, 119];
const MAX_CACHE = 1_024;
const TIMEOUT_MS = 10_000;

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Launch inspection: ${message}`);
}
function object(value: unknown, label: string): Json {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `missing/malformed ${label}`);
  return value as Json;
}
function key(value: unknown): string {
  requireValue(typeof value === 'string', 'missing public key');
  const result = new PublicKey(value).toBase58();
  requireValue(result === value, 'noncanonical public key');
  return result;
}
function integer(value: unknown, label: string): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, `invalid ${label}`);
  return value;
}
function amount(value: unknown): bigint {
  requireValue(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'invalid token amount');
  const result = BigInt(value);
  requireValue(result <= 0xffffffffffffffffn, 'token amount exceeds u64');
  return result;
}
function decode58(value: unknown): Uint8Array {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 2_000, 'invalid base58 data');
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of value) {
    const digit = alphabet.indexOf(c);
    requireValue(digit >= 0, 'invalid base58 data');
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  return Uint8Array.from([...new Array(value.match(/^1*/)?.[0].length ?? 0).fill(0), ...bytes]);
}
function parsed(account: unknown, type: string): Json {
  const a = object(account, `${type} account`);
  requireValue(a.owner === TOKEN.toBase58() && a.executable === false, 'unsupported token program/account');
  const data = object(a.data, `${type} data`);
  requireValue(data.program === 'spl-token', 'unsupported parsed token program');
  const p = object(data.parsed, `parsed ${type}`);
  requireValue(p.type === type, `expected ${type}`);
  return object(p.info, `${type} info`);
}

/** Read-only confirmed RPC inspection. Caller applies freshness/price/risk thresholds.
 * Confirmed reads can race and can roll back; this is not an atomic execution preflight.
 * No live data is cached. Even a complete holder census cannot detect common control of
 * different owner keys. Missing census coverage blocks rather than assuming decentralization.
 */
export class LaunchInspector {
  private nextId = 0;
  private readonly creationTimes = new Map<string, number>();

  constructor(private readonly rpcUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  private async rpc(method: string, params: unknown[]): Promise<any> {
    const id = ++this.nextId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Launch inspection: ${method} timed out`));
      }, TIMEOUT_MS);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await this.fetcher(this.rpcUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: controller.signal,
        });
        requireValue(response.ok, `${method} HTTP ${response.status}`);
        const body = object(await response.json(), 'RPC response');
        requireValue(body.jsonrpc === '2.0' && body.id === id, 'RPC response ID/version mismatch');
        requireValue(!body.error && Object.hasOwn(body, 'result'), `${method} RPC error/missing result`);
        return body.result;
      })()]);
    } finally { clearTimeout(timer!); }
  }

  private context(result: unknown, minSlot = 0): Json {
    const r = object(result, 'RPC result');
    const slot = integer(object(r.context, 'RPC context').slot, 'context slot');
    requireValue(slot >= minSlot && Object.hasOwn(r, 'value'), 'stale/missing RPC value');
    return r;
  }

  private async creation(input: Input): Promise<number> {
    const cached = this.creationTimes.get(input.mint);
    if (cached !== undefined) return cached;
    const tx = object(await this.rpc('getTransaction', [input.signature, {
      commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0,
    }]), 'creation transaction');
    const blockTime = integer(tx.blockTime, 'creation blockTime');
    requireValue(blockTime > 0 && blockTime * 1_000 <= Date.now() + 60_000, 'invalid creation time');
    const meta = object(tx.meta, 'transaction metadata');
    requireValue(meta.err === null, 'failed or unknown creation status');
    const transaction = object(tx.transaction, 'transaction');
    requireValue(Array.isArray(transaction.signatures) && transaction.signatures[0] === input.signature, 'unrelated transaction signature');
    const message = object(transaction.message, 'transaction message');
    requireValue(Array.isArray(message.accountKeys), 'missing transaction account keys');
    const keys = message.accountKeys.map((entry: unknown) => key(typeof entry === 'string' ? entry : object(entry, 'account key').pubkey));
    requireValue(new Set(keys).size === keys.length, 'duplicate transaction keys');
    requireValue(Array.isArray(meta.preBalances) && Array.isArray(meta.postBalances)
      && meta.preBalances.length === keys.length && meta.postBalances.length === keys.length, 'malformed creation balances');
    meta.preBalances.forEach((v: unknown) => integer(v, 'prebalance'));
    meta.postBalances.forEach((v: unknown) => integer(v, 'postbalance'));
    for (const address of [input.mint, input.poolAddress]) {
      const index = keys.indexOf(address);
      requireValue(index >= 0 && meta.preBalances[index] === 0 && meta.postBalances[index] > 0, 'transaction does not create mint/curve');
    }
    requireValue(Array.isArray(message.instructions), 'missing creation instructions');
    requireValue(meta.innerInstructions === null || Array.isArray(meta.innerInstructions), 'malformed inner instructions');
    const inner = (meta.innerInstructions ?? []).flatMap((group: unknown) => {
      const g = object(group, 'inner instruction group');
      integer(g.index, 'inner instruction index');
      requireValue(Array.isArray(g.instructions), 'malformed inner instructions');
      return g.instructions;
    });
    const creates = [...message.instructions, ...inner].some((entry: unknown) => {
      const ix = object(entry, 'instruction');
      if (ix.programId !== PUMP.toBase58()) return false;
      if (!Array.isArray(ix.accounts) || !ix.accounts.includes(input.mint) || !ix.accounts.includes(input.poolAddress)) return false;
      const data = decode58(ix.data);
      if (!CREATE_DISCRIMINATOR.every((byte, index) => data[index] === byte)) return false;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let offset = 8;
      for (let index = 0; index < 3; index++) {
        requireValue(offset + 4 <= data.length, 'truncated create string length');
        const length = view.getUint32(offset, true);
        offset += 4;
        requireValue(offset + length <= data.length, 'truncated create string');
        new TextDecoder('utf-8', { fatal: true }).decode(data.slice(offset, offset + length));
        offset += length;
      }
      requireValue(offset + 32 === data.length, 'malformed create creator/layout');
      requireValue(new PublicKey(data.slice(offset)).toBase58() === input.creator, 'creation creator mismatch');
      return true;
    });
    requireValue(creates, 'missing supported Pump create instruction');
    const createdAt = blockTime * 1_000;
    if (this.creationTimes.size >= MAX_CACHE) this.creationTimes.delete(this.creationTimes.keys().next().value!);
    this.creationTimes.set(input.mint, createdAt);
    return createdAt;
  }

  async inspect(input: Input): Promise<LaunchInspection> {
    const startedAt = Date.now();
    const mint = new PublicKey(key(input.mint));
    key(input.creator);
    key(input.poolAddress);
    requireValue(decode58(input.signature).length === 64, 'invalid creation signature');
    const [curve] = PublicKey.findProgramAddressSync([new TextEncoder().encode('bonding-curve'), mint.toBytes()], PUMP);
    requireValue(input.poolAddress === curve.toBase58(), 'unsupported pool: not the Pump bonding-curve PDA');
    const [custody] = PublicKey.findProgramAddressSync([curve.toBytes(), TOKEN.toBytes(), mint.toBytes()], ATA);
    const config = { commitment: 'confirmed' };
    const [mintResult, curveResult, createdAt] = await Promise.all([
      this.rpc('getAccountInfo', [input.mint, { ...config, encoding: 'jsonParsed' }]),
      this.rpc('getAccountInfo', [input.poolAddress, { ...config, encoding: 'base64' }]),
      this.creation(input),
    ]);
    const mintContext = this.context(mintResult);
    const curveContext = this.context(curveResult);
    const mintInfo = parsed(mintContext.value, 'mint');
    requireValue(mintInfo.isInitialized === true, 'uninitialized mint');
    const decimals = integer(mintInfo.decimals, 'mint decimals');
    requireValue(decimals <= 18, 'unsupported mint decimals');
    const supply = amount(mintInfo.supply);
    requireValue(supply > 0n, 'zero supply');
    for (const field of ['mintAuthority', 'freezeAuthority']) {
      requireValue(Object.hasOwn(mintInfo, field), `missing ${field}`);
      if (mintInfo[field] !== null) key(mintInfo[field]);
    }
    const reasons: string[] = [];
    if (mintInfo.mintAuthority !== null) reasons.push('mint-authority-not-revoked');
    if (mintInfo.freezeAuthority !== null) reasons.push('freeze-authority-not-revoked');
    const curveAccount = object(curveContext.value, 'bonding curve account');
    requireValue(curveAccount.owner === PUMP.toBase58() && curveAccount.executable === false, 'invalid curve program owner');
    requireValue(Array.isArray(curveAccount.data) && curveAccount.data[1] === 'base64', 'missing base64 curve data');
    const encoded = curveAccount.data[0];
    requireValue(typeof encoded === 'string' && encoded.length <= 4_096 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded), 'malformed curve base64');
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    requireValue(bytes.length >= 81 && CURVE_DISCRIMINATOR.every((byte, index) => bytes[index] === byte), 'invalid curve discriminator/layout');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const virtualTokens = view.getBigUint64(8, true);
    const virtualSol = view.getBigUint64(16, true);
    const realTokens = view.getBigUint64(24, true);
    const realSol = view.getBigUint64(32, true);
    requireValue(view.getBigUint64(40, true) === supply, 'curve/mint supply mismatch');
    requireValue(virtualTokens > 0n && virtualSol > 0n && realTokens <= supply && realTokens <= virtualTokens && realSol <= virtualSol, 'invalid curve reserves');
    requireValue(bytes[48] === 0 || bytes[48] === 1, 'invalid curve complete flag');
    const complete = bytes[48] === 1;
    const creator = new PublicKey(bytes.slice(49, 81)).toBase58();
    requireValue(creator !== PublicKey.default.toBase58() && creator === input.creator, 'curve creator mismatch/unknown');
    if (complete) reasons.push('curve-complete-or-migrated');
    if (!complete && realTokens === 0n) reasons.push('curve-has-no-real-token-reserves');
    if (realSol === 0n) reasons.push('curve-has-no-real-sol-liquidity');
    for (const offset of [81, 82]) {
      if (bytes.length > offset) requireValue(bytes[offset] <= 1, 'invalid curve extension flag');
    }
    if (bytes.length > 81 && bytes[81] === 1) reasons.push('unsupported-mayhem-curve');
    if (bytes.length > 82 && bytes[82] === 1) reasons.push('unsupported-cashback-curve');
    requireValue(bytes.length <= 83 || bytes.length >= 115, 'truncated curve quote mint');
    if (bytes.length >= 115) {
      const quote = new PublicKey(bytes.slice(83, 115)).toBase58();
      // docs/instructions/BUY.md specifies Pubkey::default() for native SOL.
      // Nonzero quote mints need separate token-custody accounting, not lamports.
      requireValue(quote === PublicKey.default.toBase58(), 'unsupported non-SOL quote mint');
      requireValue(bytes.slice(115).every(byte => byte === 0), 'unknown curve extension');
    }
    const lamports = integer(curveAccount.lamports, 'curve lamports');
    requireValue(BigInt(lamports) >= realSol, 'real SOL reserves exceed curve lamports');
    const minSlot = Math.max(mintContext.context.slot, curveContext.context.slot);
    const liveConfig = { ...config, minContextSlot: minSlot };
    const [largestResult, creatorResult] = await Promise.all([
      this.rpc('getTokenLargestAccounts', [input.mint, config]),
      this.rpc('getTokenAccountsByOwner', [creator, { mint: input.mint }, { ...liveConfig, encoding: 'jsonParsed' }]),
    ]);
    const largest = this.context(largestResult, minSlot).value;
    const creatorAccounts = this.context(creatorResult, minSlot).value;
    requireValue(Array.isArray(largest) && largest.length > 0 && largest.length <= 20, 'missing/malformed largest holders');
    requireValue(Array.isArray(creatorAccounts), 'missing creator holdings');
    const largestAmounts = new Map<string, bigint>();
    for (const entry of largest) {
      const a = object(entry, 'largest account');
      const address = key(a.address);
      requireValue(!largestAmounts.has(address) && a.decimals === decimals, 'duplicate/inconsistent largest account');
      largestAmounts.set(address, amount(a.amount));
    }
    const addresses = [...new Set([...largestAmounts.keys(), custody.toBase58()])];
    const holderResult = this.context(await this.rpc('getMultipleAccounts', [addresses, {
      ...liveConfig, encoding: 'jsonParsed',
    }]), minSlot).value;
    requireValue(Array.isArray(holderResult) && holderResult.length === addresses.length, 'missing holder accounts');
    const parseHolder = (account: unknown): Holder => {
      const info = parsed(account, 'account');
      requireValue(info.mint === input.mint && info.state === 'initialized', 'invalid/frozen holder account');
      const balance = object(info.tokenAmount, 'holder balance');
      requireValue(balance.decimals === decimals, 'holder decimals mismatch');
      return { owner: key(info.owner), amount: amount(balance.amount) };
    };
    const holders = new Map<string, Holder>();
    const add = (address: string, holder: Holder) => {
      const previous = holders.get(address);
      requireValue(!previous || (previous.owner === holder.owner && previous.amount === holder.amount), 'inconsistent holder snapshot');
      holders.set(address, holder);
    };
    for (let index = 0; index < addresses.length; index++) {
      const address = addresses[index];
      const holder = parseHolder(holderResult[index]);
      requireValue(!largestAmounts.has(address) || largestAmounts.get(address) === holder.amount, 'largest holder balance changed during inspection');
      add(address, holder);
    }
    const curveHolding = holders.get(custody.toBase58())!;
    requireValue(curveHolding.owner === input.poolAddress && curveHolding.amount >= realTokens, 'unverified bonding-curve custody');
    let creatorAmount = 0n;
    const creatorAddresses = new Set<string>();
    for (const entry of creatorAccounts) {
      const account = object(entry, 'creator token account');
      const address = key(account.pubkey);
      requireValue(!creatorAddresses.has(address), 'duplicate creator account');
      creatorAddresses.add(address);
      const holder = parseHolder(account.account);
      requireValue(holder.owner === creator, 'creator account owner mismatch');
      creatorAmount += holder.amount;
      add(address, holder);
    }
    const owners = new Map<string, bigint>();
    let accounted = 0n;
    for (const [address, holder] of holders) {
      accounted += holder.amount;
      requireValue(holder.owner !== creator || creatorAddresses.has(address), 'incomplete creator holdings');
      // Exclude only the derived ATA whose parsed owner is this verified curve.
      // An off-curve owner, exchange, burn address or alleged LP is NOT an exclusion.
      if (address !== custody.toBase58()) owners.set(holder.owner, (owners.get(holder.owner) ?? 0n) + holder.amount);
    }
    requireValue(accounted <= supply && creatorAmount <= supply, 'holder balances exceed supply');
    const missing = supply - accounted;
    if (missing > 0n) reasons.push('incomplete-holder-coverage');
    // Largest-20 token accounts are not largest-20 owners. When supply is missing,
    // report conservative upper bounds, and block, rather than low observed shares.
    const ranked = [...owners.values()].sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
    const pct = (raw: bigint) => Number(raw) / Number(supply) * 100;
    const top = (n: number) => pct(ranked.slice(0, n).reduce((sum, raw) => sum + raw, missing));
    return {
      createdAt, checkedAt: startedAt,
      priceSol: Number(virtualSol) / Number(virtualTokens) * 10 ** decimals / 1e9,
      // Real reserve only, not the synthetic virtual reserve or rent-bearing balance.
      liquiditySol: Number(realSol) / 1e9,
      tokenProgram: TOKEN.toBase58(), decimals, supplyTokens: Number(supply) / 10 ** decimals,
      creator, top1Pct: top(1), top5Pct: top(5), top10Pct: top(10),
      holderCount: missing === 0n ? [...owners.values()].filter(amount => amount > 0n).length : undefined,
      creatorOwnershipPct: pct(creatorAmount),
      mintAuthorityRevoked: mintInfo.mintAuthority === null,
      freezeAuthorityRevoked: mintInfo.freezeAuthority === null,
      curveVerified: true, complete, reasons,
    };
  }
}
