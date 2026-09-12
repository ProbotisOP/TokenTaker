/**
 * Phantom Swap Service
 * 
 * Interacts with Jupiter DEX API (api.jup.ag) to fetch real executable quotes
 * and build real versioned transactions for Phantom browser wallet signing.
 * Zero fake transactions, zero simulated signatures.
 */
export const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1_000_000_000));
}

export interface SwapQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: any;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot?: number;
  timeTaken?: number;
}

export interface BuildSwapTxResponse {
  swapTransaction: string; // Base64 serialized VersionedTransaction
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
  computeUnitLimit?: number;
}

export class PhantomSwapService {
  private static JUPITER_QUOTE_URL = 'https://api.jup.ag/swap/v1/quote';
  private static JUPITER_SWAP_URL = 'https://api.jup.ag/swap/v1/swap';

  /**
   * Fetches a real executable BUY quote (SOL -> Token)
   */
  public static async fetchBuyQuote(params: {
    tokenMint: string;
    sizeSol: number;
    slippageBps?: number;
  }): Promise<SwapQuoteResponse> {
    const lamports = solToLamports(params.sizeSol).toString();
    const slippageBps = params.slippageBps ?? 200; // 2.0% default slippage

    const url = `${this.JUPITER_QUOTE_URL}?inputMint=${SOL_MINT_ADDRESS}&outputMint=${params.tokenMint}&amount=${lamports}&slippageBps=${slippageBps}`;
    
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Jupiter quote failed (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    if (!data.outAmount) {
      throw new Error(`No route found for token ${params.tokenMint} on Solana DEX.`);
    }

    return data as SwapQuoteResponse;
  }

  /**
   * Fetches a real executable SELL quote (Token -> SOL)
   */
  public static async fetchSellQuote(params: {
    tokenMint: string;
    tokenAmountBaseUnits: string | bigint;
    slippageBps?: number;
  }): Promise<SwapQuoteResponse> {
    const amountStr = params.tokenAmountBaseUnits.toString();
    const slippageBps = params.slippageBps ?? 250; // 2.5% default for exits

    const url = `${this.JUPITER_QUOTE_URL}?inputMint=${params.tokenMint}&outputMint=${SOL_MINT_ADDRESS}&amount=${amountStr}&slippageBps=${slippageBps}`;
    
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Jupiter sell quote failed (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    if (!data.outAmount) {
      throw new Error(`No exit route found for token ${params.tokenMint} back to SOL.`);
    }

    return data as SwapQuoteResponse;
  }

  /**
   * Builds the unsigned VersionedTransaction for Phantom to sign in the browser
   */
  public static async buildSwapTransaction(params: {
    quoteResponse: SwapQuoteResponse;
    userPublicKey: string;
    prioritizationFeeLamports?: number;
  }): Promise<BuildSwapTxResponse> {
    const res = await fetch(this.JUPITER_SWAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        quoteResponse: params.quoteResponse,
        userPublicKey: params.userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: params.prioritizationFeeLamports ?? 'auto',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Failed to build swap transaction (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    if (!data.swapTransaction) {
      throw new Error('Jupiter API did not return a valid serialized swap transaction.');
    }

    return data as BuildSwapTxResponse;
  }
}
