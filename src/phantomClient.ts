import { VersionedTransaction } from '@solana/web3.js';

export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction>;
}
export type ApprovalPhase = 'PREPARING' | 'AWAITING_PHANTOM' | 'SUBMITTING' | 'CONFIRMED';
export interface PhantomTradeRequest {
  action: 'BUY' | 'SELL'; tokenMint?: string; symbol?: string; name?: string; sizeSol?: number;
  positionId?: string; pctToExit?: 100 | 50; requireEarlySignal?: boolean; manualRiskAcknowledged?: boolean;
  expectedWalletAddress?: string;
}
export interface PreparedPhantomTrade {
  approvalId: string; transactionBase64: string; expiresAt: number; action: 'BUY' | 'SELL';
  tokenMint: string; walletAddress: string; network: string; summary: string;
}
interface Dependencies {
  provider?: PhantomProvider; fetcher?: typeof fetch; now?: () => number;
  onPhase?: (phase: ApprovalPhase) => void;
  onPrepared?: (trade: PreparedPhantomTrade) => void;
}
let approvalInFlight = false;
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
const decode = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export function getPhantomProvider(): PhantomProvider {
  const browser = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const provider = browser.phantom?.solana ?? (browser.solana?.isPhantom ? browser.solana : undefined);
  if (!provider?.isPhantom || typeof provider.signTransaction !== 'function') {
    throw new Error('Phantom is not available here. Open the app directly in a browser with the Phantom extension, not inside an embedded preview. No demo wallet will be connected.');
  }
  return provider;
}
async function post(fetcher: typeof fetch, path: string, body: unknown): Promise<any> {
  const response = await fetcher(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.success === false) throw new Error(result.error || result.message || 'Wallet request rejected');
  return result;
}
async function owner(provider: PhantomProvider): Promise<string> {
  const address = provider.publicKey?.toString() ?? (await provider.connect()).publicKey?.toString();
  if (!address || provider.publicKey?.toString() !== address) throw new Error('Phantom account is not connected');
  return address;
}

export async function connectPhantom(deps: Dependencies = {}) {
  const provider = deps.provider ?? getPhantomProvider();
  const fetcher = deps.fetcher ?? fetch;
  const address = (await provider.connect()).publicKey?.toString();
  if (!address || provider.publicKey?.toString() !== address) throw new Error('Phantom account changed while connecting');
  const response = await fetcher('/api/wallet/state');
  if (!response.ok) throw new Error('Cannot read the server wallet configuration');
  const state = await response.json();
  const result = await post(fetcher, '/api/wallet/connect', { address, walletName: 'Phantom', network: 'mainnet-beta',
    rpcEndpoint: state.config?.network === 'mainnet-beta' ? state.config?.rpcEndpoint : undefined });
  return { address, config: result.config };
}

export async function enablePhantomTrading(deps: Dependencies = {}) {
  const provider = deps.provider ?? getPhantomProvider();
  return post(deps.fetcher ?? fetch, '/api/wallet/phantom/enable', {
    walletAddress: await owner(provider), confirmLiveDisclaimer: true,
  });
}

export async function approvePhantomTrade(request: PhantomTradeRequest, deps: Dependencies = {}): Promise<any> {
  if (approvalInFlight) throw new Error('Another Phantom approval is already in progress');
  approvalInFlight = true;
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;
  let approvalId: string | undefined;
  let submissionStarted = false;
  try {
    const provider = deps.provider ?? getPhantomProvider();
    const walletAddress = await owner(provider);
    if (request.expectedWalletAddress && request.expectedWalletAddress !== walletAddress) throw new Error('Select the Phantom account that owns this position before approving its exit');
    const { expectedWalletAddress, ...intent } = request;
    deps.onPhase?.('PREPARING');
    const prepared = await post(fetcher, '/api/wallet/phantom/prepare', { ...intent, walletAddress }) as PreparedPhantomTrade;
    approvalId = prepared.approvalId;
    if (!approvalId || prepared.walletAddress !== walletAddress || prepared.network !== 'mainnet-beta' ||
        prepared.action !== request.action || !Number.isFinite(prepared.expiresAt) || prepared.expiresAt <= now()) throw new Error('Prepared transaction is missing, expired, or belongs to another wallet/network');
    const transaction = VersionedTransaction.deserialize(decode(prepared.transactionBase64));
    if (transaction.message.header.numRequiredSignatures !== 1 || transaction.message.staticAccountKeys[0].toBase58() !== walletAddress ||
        transaction.signatures.some(signature => signature.some(byte => byte !== 0))) throw new Error('Unexpected transaction signer or pre-existing signature');
    const message = transaction.message.serialize().slice();
    if (provider.publicKey?.toString() !== walletAddress) throw new Error('Phantom account changed before approval');
    deps.onPrepared?.(prepared);
    deps.onPhase?.('AWAITING_PHANTOM');
    const signed = await provider.signTransaction(transaction);
    if (provider.publicKey?.toString() !== walletAddress) throw new Error('Phantom account changed during approval');
    if (!same(message, signed.message.serialize())) throw new Error('Phantom returned a different transaction; nothing was submitted');
    if (prepared.expiresAt <= now()) throw new Error('Quote or entry signal expired during approval. Nothing was submitted; request a fresh review.');
    deps.onPhase?.('SUBMITTING');
    submissionStarted = true;
    let response: Response;
    let result: any;
    try {
      response = await fetcher('/api/wallet/phantom/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, signedTransactionBase64: encode(signed.serialize()) }) });
      result = await response.json();
    } catch {
      throw new Error('Submission outcome is unknown. Do not retry the trade until the server transaction journal and wallet activity are reconciled.');
    }
    if (!response.ok || !result.success) throw new Error(result.error || 'Transaction was not confirmed. Check wallet activity before retrying.');
    if (!result.txSignature) throw new Error('No confirmed transaction signature was returned. Check wallet activity before retrying.');
    deps.onPhase?.('CONFIRMED');
    return result;
  } catch (error) {
    if (approvalId && !submissionStarted) {
      await post(fetcher, '/api/wallet/phantom/cancel', { approvalId }).catch(() => {});
    }
    if ((error as { code?: number })?.code === 4001) throw new Error('You cancelled the Phantom approval. Nothing was submitted.');
    throw error;
  } finally {
    approvalInFlight = false;
  }
}
