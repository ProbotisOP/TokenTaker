import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { SwapTick } from './microstructureEngine.ts';
import { WalletCategory } from '../types.ts';

export interface EarlyFlowAnalysis {
  swapTicks: SwapTick[];
  earlyBuyers: { address: string; category: WalletCategory; priorTxCount: number; buyTimeSec: number; solAmount: number }[];
  insiderClusterDetected: boolean;
  bundledWalletsCount: number;
  washTradingDetected: boolean;
  creatorDumpRisk: boolean;
  totalEarlyBuyVolumeSol: number;
  totalEarlySellVolumeSol: number;
  uniqueBuyerCount: number;
  newWalletBuyerCount: number;
  fetchedAt: number;
  dataSource: 'on-chain' | 'fallback';
}

const CACHE_DURATION_MS = 60 * 1000;
const analysisCache = new Map<string, { data: EarlyFlowAnalysis; fetchedAt: number }>();

/**
 * Helper to process promises in batches
 */
async function processInBatches<T, R>(items: T[], batchSize: number, processor: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Analyzes the early transaction flow for a new pool to detect insider clusters and behavior.
 * @param connection Solana connection object
 * @param poolAddress The token pool address
 * @param creatorAddress The creator/deployer address (optional)
 * @param tokenMintAddress The token mint address (optional)
 * @param solUsdRate The current SOL/USD rate (defaults to 155.0)
 * @returns An EarlyFlowAnalysis object
 */
export async function analyzeEarlyFlow(
  connection: Connection,
  poolAddress: string,
  creatorAddress?: string,
  tokenMintAddress?: string,
  solUsdRate: number = 155.0
): Promise<EarlyFlowAnalysis> {
  const now = Date.now();
  const cached = analysisCache.get(poolAddress);
  if (cached && (now - cached.fetchedAt < CACHE_DURATION_MS)) {
    console.log(`[EarlyBuyerAnalyzer] Returning cached analysis for ${poolAddress}`);
    return cached.data;
  }

  console.log(`[EarlyBuyerAnalyzer] Starting early flow analysis for ${poolAddress}`);
  
  try {
    const poolPubkey = new PublicKey(poolAddress);
    // Fetch first 20 transactions. We get newest first, so we should reverse them to process chronologically
    // In a real scenario, to get the absolute FIRST 20, we'd need to paginate back to the start, 
    // but assuming this is called right after pool creation, the last 20 are the first 20.
    const sigsInfo = await connection.getSignaturesForAddress(poolPubkey, { limit: 20 });
    
    if (sigsInfo.length === 0) {
      console.log(`[EarlyBuyerAnalyzer] No transactions found for ${poolAddress}`);
      return getFallback();
    }

    // Chronological order: oldest first
    sigsInfo.reverse();
    const firstTxSig = sigsInfo[0].signature;
    const firstTxTime = sigsInfo[0].blockTime || Math.floor(Date.now() / 1000);

    const txSignatures = sigsInfo.map(s => s.signature);
    
    // Parse transactions
    const parsedTxs = await connection.getParsedTransactions(txSignatures, { maxSupportedTransactionVersion: 0 });

    const swapTicks: SwapTick[] = [];
    const walletTrades = new Map<string, { buys: number, sells: number, firstBuyTimeSec: number, solAmount: number }>();
    
    let totalEarlyBuyVolumeSol = 0;
    let totalEarlySellVolumeSol = 0;

    for (let i = 0; i < parsedTxs.length; i++) {
      const tx = parsedTxs[i];
      const sigInfo = sigsInfo[i];
      
      if (!tx || !tx.meta || tx.meta.err) continue;

      const txTime = sigInfo.blockTime || firstTxTime;
      const relativeTimeSec = txTime - firstTxTime;

      // Extremely simplified heuristic for buys/sells:
      // We assume the fee payer is the trader.
      const feePayerIndex = 0; 
      const feePayer = tx.transaction.message.accountKeys[feePayerIndex].pubkey.toBase58();
      
      const preBalance = tx.meta.preBalances[feePayerIndex] / 1e9;
      const postBalance = tx.meta.postBalances[feePayerIndex] / 1e9;
      const fee = (tx.meta.fee || 0) / 1e9;
      
      const balanceChange = postBalance - preBalance + fee;
      
      if (Math.abs(balanceChange) < 0.001) continue; // Skip negligible changes / failed parses

      const isBuy = balanceChange < 0; // If SOL went down, they bought tokens
      const solAmount = Math.abs(balanceChange);
      const tokenAmount = 0; // Requires parsing SPL transfers for real token amount

      if (isBuy) {
        totalEarlyBuyVolumeSol += solAmount;
      } else {
        totalEarlySellVolumeSol += solAmount;
      }

      swapTicks.push({
        timestamp: txTime * 1000,
        isBuy,
        tokenAmount,
        solAmount,
        priceSol: 0, // Placeholder
        priceUsd: 0, // Placeholder
        traderWallet: feePayer,
        isNewWallet: false // Populated later
      });

      if (!walletTrades.has(feePayer)) {
        walletTrades.set(feePayer, { buys: 0, sells: 0, firstBuyTimeSec: relativeTimeSec, solAmount: 0 });
      }

      const stats = walletTrades.get(feePayer)!;
      if (isBuy) {
        stats.buys++;
        stats.solAmount += solAmount;
      } else {
        stats.sells++;
      }
    }

    const uniqueBuyers = Array.from(walletTrades.keys());
    
    // Batch process wallet histories
    const earlyBuyersResult = await processInBatches(uniqueBuyers, 5, async (walletAddr) => {
      let priorTxCount = 0;
      try {
        const walletPubkey = new PublicKey(walletAddr);
        const priorTxs = await connection.getSignaturesForAddress(walletPubkey, {
          before: firstTxSig,
          limit: 50 // Fetch up to 50 to classify correctly
        });
        priorTxCount = priorTxs.length;
      } catch (err) {
        console.warn(`[EarlyBuyerAnalyzer] Failed to fetch history for ${walletAddr}`);
      }

      const stats = walletTrades.get(walletAddr)!;
      let category = WalletCategory.UNKNOWN;
      
      if (walletAddr === creatorAddress) {
        category = WalletCategory.CREATOR_LINKED;
      } else if (priorTxCount === 0 && stats.firstBuyTimeSec <= 3) {
        category = WalletCategory.SYBIL_SUSPICIOUS;
      } else if (priorTxCount >= 0 && priorTxCount <= 5) {
        category = WalletCategory.NEW;
      } else if (priorTxCount > 5 && priorTxCount < 50) {
        category = WalletCategory.UNKNOWN;
      } else if (priorTxCount >= 50) {
        category = WalletCategory.PROFITABLE_TRADER; // Simplifying assumption
      }

      // Update swapTicks with new wallet info
      swapTicks.forEach(tick => {
        if (tick.traderWallet === walletAddr && priorTxCount === 0) {
          tick.isNewWallet = true;
        }
      });

      return {
        address: walletAddr,
        category,
        priorTxCount,
        buyTimeSec: stats.firstBuyTimeSec,
        solAmount: stats.solAmount
      };
    });

    let washTradingDetected = false;
    for (const [wallet, stats] of walletTrades.entries()) {
      if (stats.buys > 0 && stats.sells > 0 && stats.firstBuyTimeSec <= 30) {
        washTradingDetected = true;
        break;
      }
    }

    const suspiciousWallets = earlyBuyersResult.filter(b => b.category === WalletCategory.SYBIL_SUSPICIOUS);
    const insiderClusterDetected = suspiciousWallets.length >= 3;
    const bundledWalletsCount = suspiciousWallets.length;
    const creatorDumpRisk = earlyBuyersResult.some(b => b.category === WalletCategory.CREATOR_LINKED && walletTrades.get(b.address)?.sells! > 0);
    const newWalletBuyerCount = earlyBuyersResult.filter(b => b.priorTxCount === 0).length;

    const result: EarlyFlowAnalysis = {
      swapTicks,
      earlyBuyers: earlyBuyersResult,
      insiderClusterDetected,
      bundledWalletsCount,
      washTradingDetected,
      creatorDumpRisk,
      totalEarlyBuyVolumeSol,
      totalEarlySellVolumeSol,
      uniqueBuyerCount: uniqueBuyers.length,
      newWalletBuyerCount,
      fetchedAt: Date.now(),
      dataSource: 'on-chain'
    };

    analysisCache.set(poolAddress, { data: result, fetchedAt: result.fetchedAt });
    console.log(`[EarlyBuyerAnalyzer] Analysis complete for ${poolAddress}. Insiders detected: ${insiderClusterDetected}`);
    
    return result;
  } catch (error) {
    console.warn(`[EarlyBuyerAnalyzer] Error analyzing early flow for ${poolAddress}:`, error);
    return getFallback();
  }
}

function getFallback(): EarlyFlowAnalysis {
  return {
    swapTicks: [],
    earlyBuyers: [],
    insiderClusterDetected: true, // Fail safe: assume high risk
    bundledWalletsCount: 0,
    washTradingDetected: false,
    creatorDumpRisk: true, // Fail safe
    totalEarlyBuyVolumeSol: 0,
    totalEarlySellVolumeSol: 0,
    uniqueBuyerCount: 0,
    newWalletBuyerCount: 0,
    fetchedAt: Date.now(),
    dataSource: 'fallback'
  };
}
