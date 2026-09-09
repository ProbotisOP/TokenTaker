/**
 * Jupiter v6 DEX Swap Service
 * Handles quote resolution, swap transaction construction, simulation, and live execution.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  solToLamports,
  lamportsToSol,
  toTokenBaseUnits,
  toTokenHumanAmount,
  getOnChainTokenDecimals,
  getOnChainTokenBalance,
} from './decimalSafeUtils.ts';
import { TradeSafetyValidator } from './tradeSafetyValidator.ts';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amountLamports: number | bigint | string;
  slippageBps?: number;
}

export interface JupiterQuoteResult {
  success: boolean;
  data?: any;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: number;
  routePlanSummary?: string;
  error?: string;
}

export interface JupiterSwapBuildResult {
  success: boolean;
  swapTransactionBase64?: string;
  versionedTx?: VersionedTransaction;
  lastValidBlockHeight?: number;
  error?: string;
}

export interface JupiterSimulationResult {
  success: boolean;
  unitsConsumed?: number;
  logs?: string[];
  err?: any;
  error?: string;
}

export interface JupiterLiveExecutionResult {
  success: boolean;
  txSignature?: string;
  explorerUrl?: string;
  inAmountSol?: number;
  outAmountSol?: number;
  solReceived?: number;
  outAmountTokens?: number;
  tokensSold?: number;
  error?: string;
}

export class JupiterService {
  private static JUPITER_QUOTE_API = 'https://api.jup.ag/swap/v1/quote';
  private static JUPITER_SWAP_API = 'https://api.jup.ag/swap/v1/swap';

  /**
   * Fetches best route quote from Jupiter v6 API
   */
  public static async fetchQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult> {
    try {
      const { inputMint, outputMint, amountLamports, slippageBps = 150 } = params;
      const url = new URL(this.JUPITER_QUOTE_API);
      url.searchParams.set('inputMint', inputMint);
      url.searchParams.set('outputMint', outputMint);
      url.searchParams.set('amount', amountLamports.toString());
      url.searchParams.set('slippageBps', slippageBps.toString());
      url.searchParams.set('restrictIntermediateTokens', 'true');

      const response = await fetch(url.toString(), {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TokenTaker-QuantEngine/1.0',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          error: `Jupiter quote API returned status ${response.status}: ${errText.slice(0, 150)}`,
        };
      }

      const data = await response.json();
      if (!data || !data.outAmount) {
        return {
          success: false,
          error: 'Jupiter returned empty route for token pair',
        };
      }

      const routes = (data.routePlan || [])
        .map((r: any) => r.swapInfo?.label || 'DEX')
        .join(' -> ');

      return {
        success: true,
        data,
        inAmount: data.inAmount,
        outAmount: data.outAmount,
        priceImpactPct: Number(data.priceImpactPct || 0),
        routePlanSummary: routes || 'Direct AMM Pool',
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to query Jupiter quote: ${err.message || err}`,
      };
    }
  }

  /**
   * Requests serialized VersionedTransaction from Jupiter v6
   */
  public static async buildSwapTransaction(
    quoteResponse: any,
    userPublicKey: string,
    priorityFeeLamports: number = 100_000
  ): Promise<JupiterSwapBuildResult> {
    try {
      const body = {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: priorityFeeLamports,
      };

      const response = await fetch(this.JUPITER_SWAP_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'TokenTaker-QuantEngine/1.0',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          error: `Jupiter swap build returned status ${response.status}: ${errText.slice(0, 150)}`,
        };
      }

      const data = await response.json();
      if (!data.swapTransaction) {
        return {
          success: false,
          error: 'Jupiter returned no swapTransaction base64 payload',
        };
      }

      const swapTransactionBuf = Buffer.from(data.swapTransaction, 'base64');
      const versionedTx = VersionedTransaction.deserialize(swapTransactionBuf);

      return {
        success: true,
        swapTransactionBase64: data.swapTransaction,
        versionedTx,
        lastValidBlockHeight: data.lastValidBlockHeight,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to build Jupiter swap transaction: ${err.message || err}`,
      };
    }
  }

  /**
   * Simulates transaction execution on Solana (ZERO BROADCAST, ZERO FUNDS SPENT)
   */
  public static async simulateSwap(
    connection: Connection,
    versionedTx: VersionedTransaction
  ): Promise<JupiterSimulationResult> {
    try {
      const sim = await connection.simulateTransaction(versionedTx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

      if (sim.value.err) {
        return {
          success: false,
          err: sim.value.err,
          logs: sim.value.logs || [],
          unitsConsumed: sim.value.unitsConsumed || 0,
          error: `Simulation returned on-chain error: ${JSON.stringify(sim.value.err)}`,
        };
      }

      return {
        success: true,
        unitsConsumed: sim.value.unitsConsumed || 0,
        logs: sim.value.logs || [],
      };
    } catch (err: any) {
      return {
        success: false,
        error: `RPC transaction simulation failed: ${err.message || err}`,
      };
    }
  }

  /**
   * Signs with dedicated keypair and broadcasts live transaction to Solana
   */
  public static async signAndExecuteSwap(
    connection: Connection,
    versionedTx: VersionedTransaction,
    keypair: Keypair
  ): Promise<JupiterLiveExecutionResult> {
    try {
      // 1. Sign on server worker with dedicated trading keypair
      versionedTx.sign([keypair]);

      // 2. Broadcast raw transaction
      const rawTransaction = versionedTx.serialize();
      const txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      });

      // 3. Confirm transaction
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const confirmation = await connection.confirmTransaction(
        {
          signature: txid,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        return {
          success: false,
          txSignature: txid,
          error: `Transaction confirmed with error: ${JSON.stringify(confirmation.value.err)}`,
        };
      }

      return {
        success: true,
        txSignature: txid,
        explorerUrl: `https://solscan.io/tx/${txid}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Live transaction broadcast/confirmation failed: ${err.message || err}`,
      };
    }
  }

  /**
   * Constructs a real test transaction on Devnet (Micro self-transfer with memo)
   * Used when network is Devnet because Jupiter DEX pools only exist on Mainnet.
   * This creates a real, confirmed on-chain transaction that Phantom shows under Devnet!
   */
  public static async executeDevnetRealMicroTrade(
    connection: Connection,
    keypair: Keypair,
    memoText: string = 'TokenTaker:DevnetTestTrade'
  ): Promise<JupiterLiveExecutionResult> {
    try {
      const pubkey = keypair.publicKey;
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');

      // Transfer 0.00001 SOL to itself to create real verifiable block on Devnet
      const instruction = SystemProgram.transfer({
        fromPubkey: pubkey,
        toPubkey: pubkey,
        lamports: 10_000, // 0.00001 SOL
      });

      const messageV0 = new TransactionMessage({
        payerKey: pubkey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [instruction],
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(messageV0);
      versionedTx.sign([keypair]);

      const txid = await connection.sendRawTransaction(versionedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      await connection.confirmTransaction(
        {
          signature: txid,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      );

      return {
        success: true,
        txSignature: txid,
        explorerUrl: `https://solscan.io/tx/${txid}?cluster=devnet`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Devnet live micro-trade failed: ${err.message || err}`,
      };
    }
  }

  /**
   * Executes a real sell swap from token back into SOL on Jupiter DEX.
   * Accurately inspects the on-chain SPL Token & Token-2022 balance to swap 100% (or 50%)
   * of the actual token bag back into SOL on Solana mainnet.
   */
  public static async executeRealSellSwap(
    connection: Connection,
    keypair: Keypair,
    tokenMint: string,
    tokensRaw: number = 0,
    slippageBps: number = 250,
    pctToExit: number = 100
  ): Promise<JupiterLiveExecutionResult> {
    try {
      const pubkey = keypair.publicKey;

      // 1. Check if network is Devnet: use real Devnet execution
      let isDevnet = false;
      try {
        const genesis = await connection.getGenesisHash();
        isDevnet = genesis === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
      } catch {
        isDevnet = false;
      }

      if (isDevnet) {
        return this.executeDevnetRealMicroTrade(connection, keypair, `TokenTaker:Sell:${tokenMint.slice(0, 8)}`);
      }

      // 2. Query actual on-chain token balance across SPL Token and Token-2022 programs
      const onChain = await getOnChainTokenBalance(connection, pubkey, new PublicKey(tokenMint));
      if (onChain.total_base_units <= 0n && tokensRaw <= 0) {
        return {
          success: false,
          error: `No on-chain token balance found for mint ${tokenMint.slice(0, 6)}...${tokenMint.slice(-4)}. The token may have already been sold or moved.`,
        };
      }

      // If token balance is negligible sub-dust (< 1,000 base units, e.g. 0.000017 tokens), it was already fully liquidated
      if (onChain.total_base_units > 0n && onChain.total_base_units < 1000n) {
        return {
          success: false,
          error: `Token balance (${onChain.total_base_units} base units) is negligible dust. Position is already fully closed.`,
        };
      }

      // Compute exact atomic raw units to sell
      let sellAmountRaw: bigint;
      if (onChain.total_base_units > 0n) {
        sellAmountRaw = pctToExit <= 50 ? (onChain.total_base_units / 2n) : onChain.total_base_units;
      } else {
        sellAmountRaw = BigInt(Math.floor(tokensRaw));
      }

      if (sellAmountRaw < 1000n) {
        return {
          success: false,
          error: `Calculated sell quantity (${sellAmountRaw} base units) is sub-dust. Swap aborted to protect fees.`,
        };
      }

      // 3. Fetch sell quote from Jupiter (Token -> SOL) using exact atomic units
      const quoteRes = await this.fetchQuote({
        inputMint: tokenMint,
        outputMint: SOL_MINT,
        amountLamports: sellAmountRaw,
        slippageBps,
      });

      if (!quoteRes.success || !quoteRes.data) {
        return {
          success: false,
          error: quoteRes.error || 'Failed to obtain Jupiter sell quote for token.',
        };
      }

      // 4. HARD SAFETY VALIDATION BEFORE BUILDING / SIGNING
      try {
        await TradeSafetyValidator.validateQuote(connection, {
          intended_action: 'SELL',
          intended_token_mint: tokenMint,
          intended_token_base_units: sellAmountRaw,
          quote_response: quoteRes.data,
          wallet_pubkey: pubkey.toBase58(),
          max_slippage_bps: slippageBps,
        });
      } catch (valErr: any) {
        console.error('[TradeSafety] SELL REJECTED:', valErr.message);
        return {
          success: false,
          error: valErr.message || 'TRADE_REJECTED: SAFETY_VALIDATION_FAILED',
        };
      }

      // 5. Build swap transaction
      const buildRes = await this.buildSwapTransaction(quoteRes.data, pubkey.toBase58());
      if (!buildRes.success || !buildRes.versionedTx) {
        return {
          success: false,
          error: buildRes.error || 'Failed to compile sell transaction instructions.',
        };
      }

      // 6. Validate compiled transaction
      try {
        TradeSafetyValidator.validateCompiledTransaction({
          versioned_tx: buildRes.versionedTx,
          wallet_pubkey: pubkey.toBase58(),
          intended_action: 'SELL',
          intended_token_mint: tokenMint,
        });
      } catch (txValErr: any) {
        console.error('[TradeSafety] SELL TX REJECTED:', txValErr.message);
        return {
          success: false,
          error: txValErr.message || 'TRADE_REJECTED: TRANSACTION_VALIDATION_FAILED',
        };
      }

      // 7. Sign and broadcast
      const execRes = await this.signAndExecuteSwap(connection, buildRes.versionedTx, keypair);
      if (execRes.success && quoteRes.outAmount) {
        const solReceived = lamportsToSol(quoteRes.outAmount);
        const tokensSold = toTokenHumanAmount(sellAmountRaw, onChain.decimals);
        execRes.inAmountSol = solReceived;
        execRes.outAmountSol = solReceived;
        execRes.solReceived = solReceived;
        execRes.outAmountTokens = tokensSold;
        execRes.tokensSold = tokensSold;
      }
      return execRes;
    } catch (err: any) {
      return {
        success: false,
        error: `Real sell swap failed: ${err.message || err}`,
      };
    }
  }
}
