/**
 * Token Safety Engine
 * Deterministic pre-trade safety evaluation & rug prevention.
 */
import { RiskLevel, TokenMetadata, TokenSafetyReport } from '../types.ts';

export interface SafetyAnalysisInput {
  metadata: TokenMetadata;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  lpBurnPct: number; // 0 to 100
  tokenProgram: string;
  hasSuspiciousExtensions: boolean;
  suspiciousExtensions: string[];
  supplyAnomalies: boolean;
  top1Percent: number; // e.g. 12%
  top5Percent: number; // e.g. 28%
  top10Percent: number; // e.g. 42%
  creatorOwnershipPercent: number;
  insiderClusterDetected: boolean;
  bundledWalletsDetected: number;
  washTradingDetected: boolean;
  creatorDumpRisk: boolean;
  liquiditySol: number;
  marketCapUsd: number;
  poolAgeSec: number;
}

export class SafetyEngine {
  public static evaluate(input: SafetyAnalysisInput): TokenSafetyReport {
    const rejectReasons: string[] = [];
    let score = 100;

    // 1. Critical Token Permissions: Mint & Freeze Authorities
    if (!input.mintAuthorityRevoked) {
      score -= 40;
      rejectReasons.push('CRITICAL: Mint authority is active (unlimited token inflation risk)');
    }

    if (!input.freezeAuthorityRevoked) {
      score -= 40;
      rejectReasons.push('CRITICAL: Freeze authority is active (honeypot/account freezing risk)');
    }

    // 2. Token Program & Suspicious Extensions (Token-2022 risks)
    if (input.hasSuspiciousExtensions || input.suspiciousExtensions.length > 0) {
      score -= 35;
      rejectReasons.push(`HIGH RISK: Suspicious Token Extensions detected: ${input.suspiciousExtensions.join(', ')}`);
    }

    if (input.supplyAnomalies) {
      score -= 30;
      rejectReasons.push('CRITICAL: Circulating supply does not match declared total mint amount');
    }

    // 3. Liquidity Safety & LP Lock / Burn
    if (input.liquiditySol < 6.0) {
      score -= 25;
      rejectReasons.push(`LOW LIQUIDITY: Pool liquidity (${input.liquiditySol.toFixed(1)} SOL) below minimum viability threshold (6.0 SOL)`);
    }

    if (input.lpBurnPct < 85 && input.metadata.launchVenue !== 'Pump.fun') {
      // Pump.fun uses a virtual bonding curve until migration; standard AMM requires LP burn
      score -= 25;
      rejectReasons.push(`LP RISK: Liquidity pool burn/lock is only ${input.lpBurnPct.toFixed(0)}% (requires >= 85%)`);
    }

    // Liquidity relative to market cap check
    const liquidityRatio = input.marketCapUsd > 0 ? (input.liquiditySol * 160) / input.marketCapUsd : 0;
    if (liquidityRatio < 0.08 && input.poolAgeSec > 20) {
      score -= 15;
      rejectReasons.push(`LIQUIDITY RATIO: Liquidity to market cap ratio (${(liquidityRatio * 100).toFixed(1)}%) indicates paper-thin depth`);
    }

    // 4. Holder Distribution & Insider Bundles
    if (input.top1Percent > 18.0) {
      score -= 20;
      rejectReasons.push(`HOLDER CONCENTRATION: Single largest holder holds ${input.top1Percent.toFixed(1)}% of total supply (limit: 18%)`);
    }

    if (input.top5Percent > 45.0) {
      score -= 15;
      rejectReasons.push(`HOLDER CONCENTRATION: Top 5 holders control ${input.top5Percent.toFixed(1)}% of total supply (limit: 45%)`);
    }

    if (input.top10Percent > 65.0) {
      score -= 15;
      rejectReasons.push(`HOLDER CONCENTRATION: Top 10 holders control ${input.top10Percent.toFixed(1)}% of total supply (limit: 65%)`);
    }

    if (input.creatorOwnershipPercent > 8.0) {
      score -= 25;
      rejectReasons.push(`CREATOR EXPOSURE: Creator retains ${input.creatorOwnershipPercent.toFixed(1)}% of tokens (dump hazard)`);
    }

    if (input.insiderClusterDetected || input.bundledWalletsDetected >= 3) {
      score -= 30;
      rejectReasons.push(`SYBIL BUNDLE: Detected ${input.bundledWalletsDetected} coordinated bundle wallets funded from common intermediary`);
    }

    // 5. Trading Anomalies
    if (input.creatorDumpRisk) {
      score -= 40;
      rejectReasons.push('ANOMALY: Creator or associated deployer wallet has begun selling into initial pool');
    }

    if (input.washTradingDetected) {
      score -= 25;
      rejectReasons.push('WASH TRADING: Coordinated circular buys/sells between identical funding cluster');
    }

    // Normalize final safety score between 0 and 100
    const safetyScore = Math.max(0, Math.min(100, Math.round(score)));

    // Categorize Risk Level
    let riskLevel: RiskLevel;
    if (safetyScore >= 80 && rejectReasons.length === 0) {
      riskLevel = RiskLevel.LOW;
    } else if (safetyScore >= 60 && !rejectReasons.some(r => r.startsWith('CRITICAL'))) {
      riskLevel = RiskLevel.MEDIUM;
    } else if (safetyScore >= 35) {
      riskLevel = RiskLevel.HIGH;
    } else {
      riskLevel = RiskLevel.CRITICAL;
    }

    // Tradable only if score >= 80 and zero critical reject reasons
    const isTradable = safetyScore >= 78 && rejectReasons.length === 0;

    return {
      safetyScore,
      riskLevel,
      rejectReasons,
      isTradable,
      mintAuthorityRevoked: input.mintAuthorityRevoked,
      freezeAuthorityRevoked: input.freezeAuthorityRevoked,
      lpBurnOrLocked: input.lpBurnPct >= 85,
      lpBurnPct: input.lpBurnPct,
      tokenProgramSafe: !input.hasSuspiciousExtensions,
      suspiciousExtensions: input.suspiciousExtensions,
      supplyAnomalies: input.supplyAnomalies,
      top1Percent: input.top1Percent,
      top5Percent: input.top5Percent,
      top10Percent: input.top10Percent,
      creatorOwnershipPercent: input.creatorOwnershipPercent,
      insiderClusterDetected: input.insiderClusterDetected,
      bundledWalletsDetected: input.bundledWalletsDetected,
      washTradingDetected: input.washTradingDetected,
      creatorDumpRisk: input.creatorDumpRisk,
      checks: {
        mintAuthorityRevoked: input.mintAuthorityRevoked,
        freezeAuthorityRevoked: input.freezeAuthorityRevoked,
        lpBurnedOrLocked: input.lpBurnPct >= 85,
        supplyMatch: !input.supplyAnomalies,
        tokenProgramLegitimate: !input.hasSuspiciousExtensions,
        topHoldersSafe: input.top1Percent <= 15 && input.top10Percent <= 50,
        noSuspiciousExtensions: input.suspiciousExtensions.length === 0,
      },
    };
  }
}
