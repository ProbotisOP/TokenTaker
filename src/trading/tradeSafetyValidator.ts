/**
 * Trade Safety Validation Engine
 * 
 * Hard gatekeeper before ANY transaction can be signed or broadcast to Solana.
 * Enforces strict mint matching, input amount tolerances, decimal verification,
 * price impact ceiling, minimum output thresholds, and quote freshness.
 * 
 * ZERO TOLERANCE for ambiguous conversions or unverified accounts.
 */
import { requireAttestedSwap } from './swapAttestation.ts';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  SOL_MINT_ADDRESS,
  SOL_DECIMALS,
  lamportsToSol,
  toTokenHumanAmount,
  getOnChainTokenDecimals,
} from './decimalSafeUtils.ts';

export interface PreExecutionQuoteValidationParams {
  intended_action: 'BUY' | 'SELL';
  intended_token_mint: string;
  intended_sol_lamports?: bigint;
  intended_token_base_units?: bigint;
  quote_response: any;
  max_price_impact_pct?: number;
  max_slippage_bps?: number;
  wallet_pubkey: string;
}

export interface PreExecutionTxValidationParams {
  versioned_tx: VersionedTransaction;
  wallet_pubkey: string;
  intended_action: 'BUY' | 'SELL';
  intended_token_mint: string;
}

export interface SafeDiagnosticTradeRecord {
  trade_id: string;
  timestamp_iso: string;
  action: 'BUY' | 'SELL';
  input_mint: string;
  output_mint: string;
  input_amount_base_units: string;
  input_amount_human: number;
  expected_output_base_units: string;
  expected_output_human: number;
  minimum_output_base_units: string;
  minimum_output_human: number;
  token_decimals: number;
  slippage_bps: number;
  price_impact_pct: number;
  wallet: string;
  route_summary: string;
  status: 'VALIDATED' | 'REJECTED';
  rejection_reason?: string;
}

export class TradeSafetyValidator {
  public static readonly DEFAULT_MAX_PRICE_IMPACT_PCT = 2.5; // 2.5% max price impact
  public static readonly MAX_QUOTE_AGE_MS = 15_000; // 15 seconds freshness ceiling
  public static readonly INPUT_TOLERANCE_PCT = 0; // ExactIn must match the intended base units.

  /**
   * Validates a Jupiter quote prior to transaction construction.
   * Throws explicit TRADE_REJECTED errors if any check fails.
   */
  public static async validateQuote(
    connection: Connection,
    params: PreExecutionQuoteValidationParams
  ): Promise<{
    is_valid: boolean;
    token_decimals: number;
    diagnostic_record: SafeDiagnosticTradeRecord;
  }> {
    const {
      intended_action,
      intended_token_mint,
      intended_sol_lamports,
      intended_token_base_units,
      quote_response,
      max_price_impact_pct = this.DEFAULT_MAX_PRICE_IMPACT_PCT,
      max_slippage_bps = 250,
      wallet_pubkey,
    } = params;

    const trade_id = `TRD_VAL_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    // 1. Ensure quote exists and is structured properly
    if (!quote_response || !quote_response.inAmount || !quote_response.outAmount) {
      throw new Error('TRADE_REJECTED: MALFORMED_JUPITER_QUOTE');
    }

    const input_mint = quote_response.inputMint;
    const output_mint = quote_response.outputMint;
    const quote_in_amount_str = quote_response.inAmount;
    const quote_out_amount_str = quote_response.outAmount;
    const min_out_str = quote_response.otherAmountThreshold;
    const price_impact_pct = Number(quote_response.priceImpactPct);
    for (const amount of [quote_in_amount_str, quote_out_amount_str, min_out_str]) {
      if (typeof amount !== 'string' || !/^(0|[1-9][0-9]*)$/.test(amount)) {
        throw new Error('TRADE_REJECTED: MALFORMED_JUPITER_QUOTE');
      }
    }
    if (!['BUY', 'SELL'].includes(intended_action) ||
        !Number.isFinite(price_impact_pct) || price_impact_pct < 0 ||
        !['string', 'number'].includes(typeof quote_response.priceImpactPct) ||
        String(quote_response.priceImpactPct).trim() === '' ||
        !Number.isFinite(max_price_impact_pct) || max_price_impact_pct < 0 ||
        !Number.isInteger(max_slippage_bps) || max_slippage_bps < 0 || max_slippage_bps > 5000 ||
        (quote_response.slippageBps !== undefined && (!Number.isInteger(quote_response.slippageBps) ||
          quote_response.slippageBps < 0 || quote_response.slippageBps > max_slippage_bps)) ||
        (quote_response.swapMode !== undefined && quote_response.swapMode !== 'ExactIn') ||
        (quote_response.routePlan !== undefined && !Array.isArray(quote_response.routePlan))) {
      throw new Error('TRADE_REJECTED: INVALID_QUOTE_RISK_PARAMETERS');
    }
    const quoteTime = quote_response.fetchedAt ?? quote_response.timestamp;
    if (quoteTime !== undefined && (!Number.isFinite(quoteTime) || quoteTime > now || now - quoteTime > this.MAX_QUOTE_AGE_MS)) {
      throw new Error('TRADE_REJECTED: STALE_QUOTE');
    }

    // 2. Mint Verification
    if (intended_action === 'BUY') {
      if (input_mint !== SOL_MINT_ADDRESS) {
        throw new Error(`TRADE_REJECTED: WRONG_INPUT_MINT (Expected SOL ${SOL_MINT_ADDRESS}, got ${input_mint})`);
      }
      if (output_mint !== intended_token_mint) {
        throw new Error(`TRADE_REJECTED: WRONG_OUTPUT_MINT (Expected ${intended_token_mint}, got ${output_mint})`);
      }
    } else {
      // SELL
      if (input_mint !== intended_token_mint) {
        throw new Error(`TRADE_REJECTED: WRONG_INPUT_MINT (Expected ${intended_token_mint}, got ${input_mint})`);
      }
      if (output_mint !== SOL_MINT_ADDRESS) {
        throw new Error(`TRADE_REJECTED: WRONG_OUTPUT_MINT (Expected SOL ${SOL_MINT_ADDRESS}, got ${output_mint})`);
      }
    }

    // 3. Token Decimals Verification directly from on-chain RPC
    let token_decimals = 6;
    try {
      token_decimals = await getOnChainTokenDecimals(connection, new PublicKey(intended_token_mint));
    } catch (err: any) {
      throw new Error(`TRADE_REJECTED: DECIMAL_VALIDATION_FAILED (${err.message})`);
    }

    // 4. Input Amount Tolerance Check
    const quote_in_amount_bi = BigInt(quote_in_amount_str);
    const intendedAmount = intended_action === 'BUY' ? intended_sol_lamports : intended_token_base_units;
    if (typeof intendedAmount !== 'bigint' || intendedAmount <= 0n || quote_in_amount_bi !== intendedAmount) {
      throw new Error('TRADE_REJECTED: INPUT_AMOUNT_MISMATCH');
    }

    // 5. Output Amount Safety Threshold
    const quote_out_amount_bi = BigInt(quote_out_amount_str);
    const min_out_bi = BigInt(min_out_str);

    if (quote_out_amount_bi <= 0n || min_out_bi <= 0n) {
      throw new Error('TRADE_REJECTED: ZERO_OUTPUT_AMOUNT');
    }

    // Absolute base-unit floor check: Any swap returning fewer than 1,000 atomic units is suspicious dust/drain
    if (quote_out_amount_bi < 1_000n) {
      throw new Error(`TRADE_REJECTED: OUTPUT_AMOUNT_BELOW_SAFETY_THRESHOLD (Received tiny output ${quote_out_amount_bi} base units)`);
    }

    // Economic floor check:
    // If buying: output token amount cannot be suspiciously tiny
    if (intended_action === 'BUY') {
      const human_tokens = toTokenHumanAmount(quote_out_amount_bi, token_decimals);
      if (human_tokens <= 0.001) {
        throw new Error(`TRADE_REJECTED: OUTPUT_AMOUNT_BELOW_SAFETY_THRESHOLD (Received tiny output ${human_tokens} tokens)`);
      }
    } else {
      // If selling: output SOL cannot be virtually zero (less than 10,000 lamports = 0.00001 SOL)
      if (quote_out_amount_bi < 10_000n) {
        throw new Error(`TRADE_REJECTED: OUTPUT_AMOUNT_BELOW_SAFETY_THRESHOLD (Received tiny output ${quote_out_amount_bi} lamports)`);
      }
    }

    const minimumAllowed = quote_out_amount_bi * BigInt(10000 - max_slippage_bps) / 10000n;
    if (min_out_bi > quote_out_amount_bi || min_out_bi < minimumAllowed) {
      throw new Error('TRADE_REJECTED: INVALID_MINIMUM_OUTPUT_SLIPPAGE');
    }

    // 6. Excessive Price Impact Check
    if (price_impact_pct > max_price_impact_pct) {
      throw new Error(
        `TRADE_REJECTED: EXCESSIVE_PRICE_IMPACT (Price impact ${price_impact_pct.toFixed(2)}% exceeds max limit of ${max_price_impact_pct}%)`
      );
    }

    // 7. Calculate human amounts for safe diagnostics
    const input_human = intended_action === 'BUY'
      ? lamportsToSol(quote_in_amount_bi)
      : toTokenHumanAmount(quote_in_amount_bi, token_decimals);

    const expected_output_human = intended_action === 'BUY'
      ? toTokenHumanAmount(quote_out_amount_bi, token_decimals)
      : lamportsToSol(quote_out_amount_bi);

    const min_output_human = intended_action === 'BUY'
      ? toTokenHumanAmount(min_out_bi, token_decimals)
      : lamportsToSol(min_out_bi);

    const routes = (quote_response.routePlan || [])
      .map((r: any) => r.swapInfo?.label || 'DEX')
      .join(' -> ') || 'Direct AMM Pool';

    const diagnostic_record: SafeDiagnosticTradeRecord = {
      trade_id,
      timestamp_iso: new Date(now).toISOString(),
      action: intended_action,
      input_mint,
      output_mint,
      input_amount_base_units: quote_in_amount_str,
      input_amount_human: input_human,
      expected_output_base_units: quote_out_amount_str,
      expected_output_human,
      minimum_output_base_units: min_out_str,
      minimum_output_human: min_output_human,
      token_decimals,
      slippage_bps: max_slippage_bps,
      price_impact_pct,
      wallet: wallet_pubkey,
      route_summary: routes,
      status: 'VALIDATED',
    };

    // Output safe diagnostic log (NO private keys or secrets logged!)
    console.log('[TradeSafetyValidator] PASS:', JSON.stringify(diagnostic_record));

    return {
      is_valid: true,
      token_decimals,
      diagnostic_record,
    };
  }

  /**
   * Validates compiled transaction before signing and broadcasting.
   */
  public static validateCompiledTransaction(params: PreExecutionTxValidationParams): void {
    const { versioned_tx, wallet_pubkey } = params;

    // Check account keys
    const account_keys = versioned_tx.message.staticAccountKeys.map((k) => k.toBase58());
    const signer_indexes = versioned_tx.message.header.numRequiredSignatures;
    const signers = account_keys.slice(0, signer_indexes);

    if (signer_indexes !== 1 || account_keys[0] !== wallet_pubkey || !signers.includes(wallet_pubkey)) {
      throw new Error(`TRADE_REJECTED: INVALID_TRANSACTION_SIGNER (Signers [${signers.join(', ')}] missing wallet ${wallet_pubkey})`);
    }
    requireAttestedSwap(versioned_tx, { action: params.intended_action, tokenMint: params.intended_token_mint, walletAddress: wallet_pubkey });
  }
}
