/**
 * Decimal-Safe Financial Math & Solana Unit Conversions
 * 
 * Enforces strict integer base-unit calculations for all on-chain values.
 * Eliminates float truncation, double-multiplication, and decimal assumptions.
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

export const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
export const SOL_DECIMALS = 9;

/**
 * Converts human-readable SOL to exact integer lamports.
 * 1 SOL = 1,000,000,000 lamports.
 */
export function solToLamports(sol_human: number): bigint {
  return toTokenBaseUnits(sol_human, SOL_DECIMALS);
}

/**
 * Converts integer lamports to human-readable SOL.
 */
export function lamportsToSol(sol_lamports: bigint | number | string): number {
  const b = BigInt(sol_lamports);
  return Number(b) / LAMPORTS_PER_SOL;
}

/**
 * Converts a human-readable token quantity into integer base units using verified decimals.
 */
export function toTokenBaseUnits(token_human: number, token_decimals: number): bigint {
  if (!Number.isFinite(token_human) || token_human < 0) {
    throw new Error(`Invalid token_human amount: ${token_human}`);
  }
  if (!Number.isInteger(token_decimals) || token_decimals < 0 || token_decimals > 18) {
    throw new Error(`Invalid token_decimals: ${token_decimals}`);
  }
  // Parse decimal notation, including exponents, without rounding up spend limits.
  const [coefficient, exponent = '0'] = token_human.toString().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = BigInt(whole + fraction);
  const shift = token_decimals + Number(exponent) - fraction.length;
  return shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
}

/**
 * Converts integer token base units into a human-readable quantity.
 */
export function toTokenHumanAmount(token_base_units: bigint | string | number, token_decimals: number): number {
  if (!Number.isInteger(token_decimals) || token_decimals < 0 || token_decimals > 18) {
    throw new Error(`Invalid token_decimals: ${token_decimals}`);
  }
  const b = BigInt(token_base_units);
  if (token_decimals === 0) return Number(b);

  const divisor = 10n ** BigInt(token_decimals);
  const integerPart = b / divisor;
  const remainder = b % divisor;

  const remainderStr = remainder.toString().padStart(token_decimals, '0');
  return parseFloat(`${integerPart.toString()}.${remainderStr}`);
}

/**
 * Reads verified decimals directly on-chain from the mint account.
 * Never guesses or assumes 6 or 9 decimals!
 */
export async function getOnChainTokenDecimals(
  connection: Connection,
  mintPubkey: PublicKey
): Promise<number> {
  // If native/wrapped SOL
  if (mintPubkey.toBase58() === SOL_MINT_ADDRESS) {
    return SOL_DECIMALS;
  }

  try {
    const supplyRes = await connection.getTokenSupply(mintPubkey);
    if (supplyRes?.value?.decimals !== undefined) {
      const decimals = supplyRes.value.decimals;
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Invalid mint decimals');
      return decimals;
    }
  } catch (err) {
    // Fallback: query account info directly
    const accInfo = await connection.getParsedAccountInfo(mintPubkey);
    const parsedData = (accInfo?.value?.data as any)?.parsed?.info;
    if (parsedData?.decimals !== undefined) {
      if (!Number.isInteger(parsedData.decimals) || parsedData.decimals < 0 || parsedData.decimals > 18) throw new Error('Invalid mint decimals');
      return parsedData.decimals;
    }
  }

  throw new Error(`DECIMAL_VALIDATION_FAILED: Unable to fetch on-chain decimals for mint ${mintPubkey.toBase58()}`);
}

/**
 * Queries the wallet's actual on-chain token balance across both SPL Token
 * and Token-2022 programs.
 */
export async function getOnChainTokenBalance(
  connection: Connection,
  walletPubkey: PublicKey,
  mintPubkey: PublicKey
): Promise<{
  total_base_units: bigint;
  decimals: number;
  ui_amount: number;
  token_program: 'spl-token' | 'token-2022' | 'none';
  ata_address?: string;
}> {
  const mintStr = mintPubkey.toBase58();

  const [splAccounts, token2022Accounts] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(walletPubkey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    }),
    connection.getParsedTokenAccountsByOwner(walletPubkey, {
      programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
    }),
  ]);

  let total_base_units = 0n;
  let decimals = 0;
  let program: 'spl-token' | 'token-2022' | 'none' = 'none';
  let ata_address: string | undefined;

  for (const ta of splAccounts.value) {
    const info = ta.account.data.parsed.info;
    if (info.mint === mintStr) {
      total_base_units += BigInt(info.tokenAmount.amount);
      decimals = info.tokenAmount.decimals;
      program = 'spl-token';
      ata_address = ta.pubkey.toBase58();
    }
  }

  for (const ta of token2022Accounts.value) {
    const info = ta.account.data.parsed.info;
    if (info.mint === mintStr) {
      total_base_units += BigInt(info.tokenAmount.amount);
      decimals = info.tokenAmount.decimals;
      program = 'token-2022';
      ata_address = ta.pubkey.toBase58();
    }
  }

  // If no token account exists yet, query the mint directly to know its decimals
  if (program === 'none') {
    decimals = await getOnChainTokenDecimals(connection, mintPubkey);
  }

  const ui_amount = toTokenHumanAmount(total_base_units, decimals);

  return {
    total_base_units,
    decimals,
    ui_amount,
    token_program: program,
    ata_address,
  };
}
