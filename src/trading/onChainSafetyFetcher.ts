import { Connection, PublicKey } from '@solana/web3.js';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const BURN_ADDRESSES = [
  '11111111111111111111111111111111',
  '1nc1nerator11111111111111111111111111111111',
  'Dead111111111111111111111111111111111111111'
];

export interface OnChainSafetyData {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  tokenProgram: string;
  hasSuspiciousExtensions: boolean;
  suspiciousExtensions: string[];
  supplyAnomalies: boolean;
  totalSupply: number;
  decimals: number;
  top1Percent: number;
  top5Percent: number;
  top10Percent: number;
  creatorOwnershipPercent: number;
  lpBurnPct: number;
  fetchedAt: number;
  dataSource: 'on-chain' | 'fallback';
}

interface CacheEntry {
  data: OnChainSafetyData;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000;

/**
 * Fetches real on-chain safety data for a Solana token mint address.
 * Uses fallback pessimistic values on RPC failures.
 * 
 * @param connection Solana RPC connection instance
 * @param mintAddress Mint address of the token
 * @param creatorAddress Optional token creator address to check ownership
 * @param poolAddress Optional LP pool address to check burn status
 * @returns Promise resolving to OnChainSafetyData
 */
export async function fetchOnChainSafety(
  connection: Connection,
  mintAddress: string,
  creatorAddress?: string,
  poolAddress?: string,
): Promise<OnChainSafetyData> {
  const now = Date.now();
  const cached = cache.get(mintAddress);
  
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  // Conservative fallback data if RPC fails
  const getFallbackData = (): OnChainSafetyData => ({
    mintAuthorityRevoked: false, // Pessimistic: assume active
    freezeAuthorityRevoked: false, // Pessimistic: assume active
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    hasSuspiciousExtensions: true, // Pessimistic
    suspiciousExtensions: ['Unknown-Fallback'],
    supplyAnomalies: true, // Pessimistic
    totalSupply: 0,
    decimals: 0,
    top1Percent: 100, // Pessimistic: assume highly concentrated
    top5Percent: 100,
    top10Percent: 100,
    creatorOwnershipPercent: 100, // Pessimistic
    lpBurnPct: 0, // Pessimistic: assume not burned
    fetchedAt: now,
    dataSource: 'fallback'
  });

  try {
    const mintPubkey = new PublicKey(mintAddress);
    
    // Run initial fetches in parallel
    const [mintAccountInfo, tokenLargestAccounts] = await Promise.all([
      connection.getAccountInfo(mintPubkey).catch(() => null),
      connection.getTokenLargestAccounts(mintPubkey).catch(() => null)
    ]);

    if (!mintAccountInfo) {
      console.warn(`[OnChainSafetyFetcher] Mint account not found or RPC error for: ${mintAddress}`);
      return getFallbackData();
    }

    const data = mintAccountInfo.data;
    if (data.length < 82) { // SPL token mint account data is 82 bytes minimum
      console.warn(`[OnChainSafetyFetcher] Invalid mint data length for: ${mintAddress}`);
      return getFallbackData();
    }

    // Manually parse SPL token mint data (layout: mintAuthOption(4), mintAuth(32), supply(8), decimals(1), isInitialized(1), freezeAuthOption(4), freezeAuth(32))
    const mintAuthOption = data.readUInt32LE(0);
    const mintAuthorityRevoked = mintAuthOption === 0;

    const supplyBigInt = data.readBigUInt64LE(36);
    const decimals = data.readUInt8(44);
    const freezeAuthOption = data.readUInt32LE(46);
    const freezeAuthorityRevoked = freezeAuthOption === 0;

    const tokenProgram = mintAccountInfo.owner.toBase58();
    
    // Check for Token-2022 suspicious extensions
    let hasSuspiciousExtensions = false;
    const suspiciousExtensions: string[] = [];
    if (tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58() && data.length > 165) {
      // Basic detection - anything beyond standard + simple extensions might be a risk.
      // If we could decode fully we'd look for TransferFee, PermanentDelegate, NonTransferable, ConfidentialTransfer
      hasSuspiciousExtensions = true;
      suspiciousExtensions.push('Potential-Suspicious-Token2022-Extensions');
    }

    const totalSupply = Number(supplyBigInt) / Math.pow(10, decimals);
    
    // Calculate top holder distributions
    let top1Percent = 0;
    let top5Percent = 0;
    let top10Percent = 0;
    let creatorOwnershipPercent = 0;

    if (tokenLargestAccounts && tokenLargestAccounts.value && tokenLargestAccounts.value.length > 0) {
      const holders = tokenLargestAccounts.value;
      
      let top1Sum = 0n;
      let top5Sum = 0n;
      let top10Sum = 0n;
      
      for (let i = 0; i < holders.length; i++) {
        try {
          const amount = BigInt(holders[i].amount);
          if (i < 1) top1Sum += amount; 
          if (i < 5) top5Sum += amount;
          if (i < 10) top10Sum += amount;
        } catch {
          // ignore parsing error
        }
      }
      
      if (supplyBigInt > 0n) {
        top1Percent = Number((top1Sum * 10000n) / supplyBigInt) / 100;
        top5Percent = Number((top5Sum * 10000n) / supplyBigInt) / 100;
        top10Percent = Number((top10Sum * 10000n) / supplyBigInt) / 100;
      }
    } else {
      // Conservative estimate if holder accounts query failed
      top1Percent = 25.0;
      top5Percent = 50.0;
      top10Percent = 70.0;
    }

    // Check if creator is a top holder
    if (creatorAddress) {
      try {
        const creatorPubkey = new PublicKey(creatorAddress);
        // Getting parsed token accounts for creator to match against top holders
        const creatorAccounts = await connection.getParsedTokenAccountsByOwner(creatorPubkey, { mint: mintPubkey }).catch(() => null);
        if (creatorAccounts && creatorAccounts.value.length > 0) {
          let creatorAmount = 0n;
          for (const curr of creatorAccounts.value) {
            try {
              creatorAmount += BigInt(curr.account.data.parsed.info.tokenAmount.amount);
            } catch {
              // ignore
            }
          }
          if (supplyBigInt > 0n) {
            creatorOwnershipPercent = Number((creatorAmount * 10000n) / supplyBigInt) / 100;
          }
        }
      } catch (e) {
        console.warn(`[OnChainSafetyFetcher] Error checking creator ownership:`, e);
        creatorOwnershipPercent = 100; // Pessimistic
      }
    }

    // Check LP burn status
    let lpBurnPct = 0;
    if (poolAddress) {
      try {
        const poolPubkey = new PublicKey(poolAddress);
        const poolAccountsInfo = await connection.getAccountInfo(poolPubkey).catch(() => null);
        
        // As an approximation, check if LP mint authority is revoked or largest holders
        if (poolAccountsInfo) {
          const lpLargestAccounts = await connection.getTokenLargestAccounts(poolPubkey).catch(() => null);
          if (lpLargestAccounts && lpLargestAccounts.value.length > 0) {
             // For each of the top LP accounts, get the owner and check if it's a burn address
             const topLpAccounts = lpLargestAccounts.value.slice(0, 3);
             let totalBurned = 0;
             let totalLpSupply = 0;
             
             for (const holder of lpLargestAccounts.value) {
                totalLpSupply += Number(holder.amount);
             }

             if (totalLpSupply > 0) {
               for (const lpAccount of topLpAccounts) {
                 const lpAccInfo = await connection.getParsedAccountInfo(lpAccount.address).catch(() => null);
                 if (lpAccInfo && lpAccInfo.value && 'parsed' in lpAccInfo.value.data) {
                   const owner = lpAccInfo.value.data.parsed.info.owner;
                   if (BURN_ADDRESSES.includes(owner) || owner.startsWith('1111111')) {
                     totalBurned += Number(lpAccount.amount);
                   }
                 }
               }
               lpBurnPct = (totalBurned / totalLpSupply) * 100;
             }
          }
        }
      } catch (e) {
        console.warn(`[OnChainSafetyFetcher] Error checking LP burn status:`, e);
      }
    }

    const result: OnChainSafetyData = {
      mintAuthorityRevoked,
      freezeAuthorityRevoked,
      tokenProgram,
      hasSuspiciousExtensions,
      suspiciousExtensions,
      supplyAnomalies: totalSupply === 0,
      totalSupply,
      decimals,
      top1Percent,
      top5Percent,
      top10Percent,
      creatorOwnershipPercent,
      lpBurnPct,
      fetchedAt: now,
      dataSource: 'on-chain'
    };

    cache.set(mintAddress, { data: result, timestamp: now });
    return result;

  } catch (error) {
    console.warn(`[OnChainSafetyFetcher] Error fetching safety data for ${mintAddress}:`, error);
    return getFallbackData();
  }
}
