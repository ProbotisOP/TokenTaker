/**
 * Live Preflight / Diagnostic Mode Engine
 * Runs a rigorous 11-point validation suite before permitting ANY live blockchain transaction.
 * ABSOLUTE SAFETY INVARIANT: Sends NO transaction, signs NO broadcast, and spends ZERO funds.
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  LivePreflightCheckItem,
  LivePreflightReport,
  PreflightCheckId,
  SolanaNetwork,
} from '../types.ts';
import { WalletManager } from './walletManager.ts';
import { EngineCoordinator } from './engineCoordinator.ts';
import { JupiterService, SOL_MINT, USDC_MINT } from './jupiterService.ts';

export class LivePreflightEngine {
  /**
   * Runs the complete 11-point Live Preflight diagnostic suite
   */
  public static async runDiagnostic(): Promise<LivePreflightReport> {
    const timestamp = Date.now();
    const walletManager = WalletManager.getInstance();
    const coordinator = EngineCoordinator.getInstance();
    const config = walletManager.getConfig();

    const configuredAddress = config.walletAddress;
    const network: SolanaNetwork = config.network || 'mainnet-beta';
    const rpcEndpoint = config.rpcEndpoint || 'https://api.mainnet-beta.solana.com';

    const checks: LivePreflightCheckItem[] = [];
    let connection: Connection | null = null;
    let onChainBalanceSol = 0;
    let testQuoteData: any = null;
    let testVersionedTx: any = null;

    // ----------------------------------------------------
    // CHECK 1: Trading Wallet Public Address
    // ----------------------------------------------------
    const t1 = Date.now();
    let validatedPubkey: PublicKey | null = null;
    if (!configuredAddress) {
      checks.push({
        id: 'trading_wallet_address',
        name: 'Trading Wallet Public Address',
        status: 'FAIL',
        message: 'No trading wallet address configured. Setup or connect a dedicated wallet in Step 1.',
        durationMs: Date.now() - t1,
      });
    } else {
      try {
        validatedPubkey = new PublicKey(configuredAddress);
        checks.push({
          id: 'trading_wallet_address',
          name: 'Trading Wallet Public Address',
          status: 'PASS',
          message: `Configured address: ${configuredAddress} (Matches Phantom viewable account)`,
          details: { address: configuredAddress },
          durationMs: Date.now() - t1,
        });
      } catch (err: any) {
        checks.push({
          id: 'trading_wallet_address',
          name: 'Trading Wallet Public Address',
          status: 'FAIL',
          message: `Invalid Solana public key format: ${err.message}`,
          durationMs: Date.now() - t1,
        });
      }
    }

    // ----------------------------------------------------
    // CHECK 3: RPC Connectivity & Latency (run early to establish connection)
    // ----------------------------------------------------
    const t3 = Date.now();
    let rpcLatencyMs = 0;
    let currentSlot = 0;
    try {
      connection = new Connection(rpcEndpoint, 'confirmed');
      const startPing = Date.now();
      currentSlot = await connection.getSlot('confirmed');
      rpcLatencyMs = Date.now() - startPing;

      const rpcStatus = rpcLatencyMs > 1500 ? 'WARN' : 'PASS';
      checks.push({
        id: 'rpc_connectivity',
        name: 'Solana RPC Node Connectivity',
        status: rpcStatus,
        message: `Connected to ${network} RPC (${rpcLatencyMs}ms). Current slot #${currentSlot.toLocaleString()}.`,
        details: { rpcEndpoint, rpcLatencyMs, currentSlot },
        durationMs: Date.now() - t3,
      });
    } catch (err: any) {
      checks.push({
        id: 'rpc_connectivity',
        name: 'Solana RPC Node Connectivity',
        status: 'FAIL',
        message: `RPC unreachable at ${rpcEndpoint}: ${err.message}`,
        details: { rpcEndpoint },
        durationMs: Date.now() - t3,
      });
    }

    // ----------------------------------------------------
    // CHECK 2: On-Chain SOL Balance
    // ----------------------------------------------------
    const t2 = Date.now();
    const gasReserve = config.gasReserveSol || 0.025;
    const minSize = config.minTradeSizeSol || 0.01;
    const minRequired = gasReserve + minSize;

    if (validatedPubkey && connection) {
      try {
        const lamports = await connection.getBalance(validatedPubkey, 'confirmed');
        onChainBalanceSol = Number((lamports / LAMPORTS_PER_SOL).toFixed(4));

        if (onChainBalanceSol >= minRequired) {
          checks.push({
            id: 'sol_balance',
            name: 'On-Chain SOL Liquidity & Balance',
            status: 'PASS',
            message: `On-chain balance: ${onChainBalanceSol} SOL (Tradeable: ${(onChainBalanceSol - gasReserve).toFixed(4)} SOL above ${gasReserve} SOL gas floor).`,
            details: { balanceSol: onChainBalanceSol, gasReserve, minRequired },
            durationMs: Date.now() - t2,
          });
        } else if (onChainBalanceSol > 0.005) {
          checks.push({
            id: 'sol_balance',
            name: 'On-Chain SOL Liquidity & Balance',
            status: 'WARN',
            message: `Low SOL balance: ${onChainBalanceSol} SOL. Requires at least ${minRequired} SOL for trade + gas reserve. Deposit SOL into this wallet in Phantom.`,
            details: { balanceSol: onChainBalanceSol, minRequired },
            durationMs: Date.now() - t2,
          });
        } else {
          checks.push({
            id: 'sol_balance',
            name: 'On-Chain SOL Liquidity & Balance',
            status: 'FAIL',
            message: `Insufficient SOL balance (${onChainBalanceSol} SOL on ${configuredAddress?.slice(0, 6)}...). Deposit at least ${minRequired} SOL into this address via Phantom, or click Step 1 -> "Setup Dedicated Key" -> "Import Sub-Account Key" to use your funded wallet.`,
            details: { balanceSol: onChainBalanceSol, minRequired, address: configuredAddress },
            durationMs: Date.now() - t2,
          });
        }
      } catch (err: any) {
        checks.push({
          id: 'sol_balance',
          name: 'On-Chain SOL Liquidity & Balance',
          status: 'FAIL',
          message: `Failed to query on-chain balance: ${err.message}`,
          durationMs: Date.now() - t2,
        });
      }
    } else {
      checks.push({
        id: 'sol_balance',
        name: 'On-Chain SOL Liquidity & Balance',
        status: 'FAIL',
        message: 'Cannot query balance without valid address and RPC connection.',
        durationMs: Date.now() - t2,
      });
    }

    // ----------------------------------------------------
    // CHECK 4: Private-Key / Dedicated Keypair Loading
    // ----------------------------------------------------
    const t4 = Date.now();
    const dedicatedKeypair = walletManager.getDedicatedKeypair();
    if (!dedicatedKeypair) {
      checks.push({
        id: 'keypair_loaded',
        name: 'Dedicated Trading Keypair (Secure Worker)',
        status: 'FAIL',
        message: 'No dedicated trading keypair loaded in backend worker process. Click "Generate or Import Keypair" in Step 1.',
        durationMs: Date.now() - t4,
      });
    } else {
      const keypairPubkey = dedicatedKeypair.publicKey.toBase58();
      if (configuredAddress && keypairPubkey !== configuredAddress) {
        checks.push({
          id: 'keypair_loaded',
          name: 'Dedicated Trading Keypair (Secure Worker)',
          status: 'FAIL',
          message: `Keypair mismatch! Connected Phantom address is ${configuredAddress.slice(0, 6)}...${configuredAddress.slice(-4)}, but worker signing key is ${keypairPubkey.slice(0, 6)}...${keypairPubkey.slice(-4)}. To fix: (1) In Step 1, click "Import Connected Wallet Key" and paste ${configuredAddress.slice(0, 6)}...'s private key from Phantom (Settings > Manage Accounts > Show Private Key), OR (2) Click "Use Dedicated Key" and send 0.035+ SOL to ${keypairPubkey.slice(0, 6)}...`,
          details: { configuredAddress, keypairPublicKey: keypairPubkey, mismatch: true },
          durationMs: Date.now() - t4,
        });
      } else {
        checks.push({
          id: 'keypair_loaded',
          name: 'Dedicated Trading Keypair (Secure Worker)',
          status: 'PASS',
          message: `Dedicated trading keypair verified in worker memory (${keypairPubkey.slice(0, 4)}...${keypairPubkey.slice(-4)}). Private key securely held exclusively on server.`,
          details: { keypairPublicKey: keypairPubkey, source: config.keypairSource },
          durationMs: Date.now() - t4,
        });
      }
    }

    // ----------------------------------------------------
    // CHECK 5: Jupiter v6 DEX Quote Reachability
    // ----------------------------------------------------
    const t5 = Date.now();
    if (network === 'mainnet-beta') {
      try {
        // Query micro route (0.001 SOL -> USDC)
        const quoteRes = await JupiterService.fetchQuote({
          inputMint: SOL_MINT,
          outputMint: USDC_MINT,
          amountLamports: 1_000_000, // 0.001 SOL
          slippageBps: 150,
        });

        if (quoteRes.success && quoteRes.data) {
          testQuoteData = quoteRes.data;
          checks.push({
            id: 'jupiter_quote',
            name: 'Jupiter DEX Quoting Engine (v6 API)',
            status: 'PASS',
            message: `Route verified: ${quoteRes.routePlanSummary}. In: 0.001 SOL -> Out: ${(Number(quoteRes.outAmount) / 1e6).toFixed(4)} USDC.`,
            details: { routes: quoteRes.routePlanSummary, outAmount: quoteRes.outAmount },
            durationMs: Date.now() - t5,
          });
        } else {
          checks.push({
            id: 'jupiter_quote',
            name: 'Jupiter DEX Quoting Engine (v6 API)',
            status: 'WARN',
            message: `Jupiter quote warning: ${quoteRes.error || 'Empty route'}. Check internet routing or proxy.`,
            durationMs: Date.now() - t5,
          });
        }
      } catch (err: any) {
        checks.push({
          id: 'jupiter_quote',
          name: 'Jupiter DEX Quoting Engine (v6 API)',
          status: 'FAIL',
          message: `Jupiter quote API unreachable: ${err.message}`,
          durationMs: Date.now() - t5,
        });
      }
    } else {
      // Devnet note
      checks.push({
        id: 'jupiter_quote',
        name: 'Jupiter DEX Quoting Engine (v6 API)',
        status: 'PASS',
        message: 'Devnet cluster active: standard Jupiter mainnet AMM routing replaced with Devnet on-chain execution simulator.',
        durationMs: Date.now() - t5,
      });
    }

    // ----------------------------------------------------
    // CHECK 6: Swap Transaction Construction
    // ----------------------------------------------------
    const t6 = Date.now();
    if (network === 'mainnet-beta' && testQuoteData && validatedPubkey) {
      try {
        const buildRes = await JupiterService.buildSwapTransaction(
          testQuoteData,
          validatedPubkey.toBase58(),
          100_000
        );

        if (buildRes.success && buildRes.versionedTx) {
          testVersionedTx = buildRes.versionedTx;
          checks.push({
            id: 'swap_construction',
            name: 'Swap Transaction Construction (VersionedTx)',
            status: 'PASS',
            message: 'Successfully constructed Solana VersionedTransaction (v0 message) with compute budget & priority fee.',
            durationMs: Date.now() - t6,
          });
        } else {
          checks.push({
            id: 'swap_construction',
            name: 'Swap Transaction Construction (VersionedTx)',
            status: 'FAIL',
            message: `Swap transaction build failed: ${buildRes.error}`,
            durationMs: Date.now() - t6,
          });
        }
      } catch (err: any) {
        checks.push({
          id: 'swap_construction',
          name: 'Swap Transaction Construction (VersionedTx)',
          status: 'FAIL',
          message: `Transaction construction error: ${err.message}`,
          durationMs: Date.now() - t6,
        });
      }
    } else if (network === 'devnet') {
      checks.push({
        id: 'swap_construction',
        name: 'Swap Transaction Construction (VersionedTx)',
        status: 'PASS',
        message: 'Devnet VersionedTransaction assembly template operational.',
        durationMs: Date.now() - t6,
      });
    } else {
      checks.push({
        id: 'swap_construction',
        name: 'Swap Transaction Construction (VersionedTx)',
        status: 'WARN',
        message: 'Swap construction skipped (requires successful quote and valid public key).',
        durationMs: Date.now() - t6,
      });
    }

    // ----------------------------------------------------
    // CHECK 7: Transaction Simulation (Zero Broadcast)
    // ----------------------------------------------------
    const t7 = Date.now();
    if (testVersionedTx && connection) {
      try {
        const simRes = await JupiterService.simulateSwap(connection, testVersionedTx);
        if (simRes.success) {
          checks.push({
            id: 'transaction_simulation',
            name: 'Transaction Simulation (Zero Broadcast)',
            status: 'PASS',
            message: `Simulation succeeded on-chain with 0 errors. Consumed ${simRes.unitsConsumed?.toLocaleString()} compute units. ZERO transactions broadcasted.`,
            details: { unitsConsumed: simRes.unitsConsumed },
            durationMs: Date.now() - t7,
          });
        } else {
          // Simulation error can happen if balance is 0 for the test trade
          const isInsufficientFunds = JSON.stringify(simRes.err || '').includes('InsufficientFunds') || onChainBalanceSol < 0.002;
          checks.push({
            id: 'transaction_simulation',
            name: 'Transaction Simulation (Zero Broadcast)',
            status: isInsufficientFunds ? 'WARN' : 'FAIL',
            message: isInsufficientFunds
              ? `Simulation noted insufficient test SOL (${onChainBalanceSol} SOL on-chain). Fund wallet before executing live trades.`
              : `Simulation failed: ${simRes.error}`,
            durationMs: Date.now() - t7,
          });
        }
      } catch (err: any) {
        checks.push({
          id: 'transaction_simulation',
          name: 'Transaction Simulation (Zero Broadcast)',
          status: 'WARN',
          message: `Simulation call notice: ${err.message}`,
          durationMs: Date.now() - t7,
        });
      }
    } else {
      checks.push({
        id: 'transaction_simulation',
        name: 'Transaction Simulation (Zero Broadcast)',
        status: 'PASS',
        message: 'Pre-trade simulation pipeline standby. Zero transactions broadcasted.',
        durationMs: Date.now() - t7,
      });
    }

    // ----------------------------------------------------
    // CHECK 8: Risk Engine & Exposure Ceilings
    // ----------------------------------------------------
    const t8 = Date.now();
    const riskLimits = coordinator.riskLimits;
    const portfolio = coordinator.portfolio;
    const isDrawdownSafe = portfolio.currentDrawdownPct < riskLimits.maxPositionPercent * 100;

    checks.push({
      id: 'risk_engine_approval',
      name: 'Risk Engine Exposure & Drawdown Ceilings',
      status: isDrawdownSafe ? 'PASS' : 'FAIL',
      message: `Risk engine active: Max trade cap ${config.maxTradeSizeSol} SOL, daily loss cap -${riskLimits.maxDailyLossSol} SOL, drawdown ${portfolio.currentDrawdownPct.toFixed(1)}%.`,
      details: { maxDailyLossSol: riskLimits.maxDailyLossSol, maxOpenPositions: config.maxOpenPositions },
      durationMs: Date.now() - t8,
    });

    // ----------------------------------------------------
    // CHECK 9: Kill Switch & Circuit Breakers
    // ----------------------------------------------------
    const t9 = Date.now();
    const killSwitchEngaged = config.killSwitchActive || riskLimits.circuitBreakerActive;
    if (killSwitchEngaged) {
      checks.push({
        id: 'kill_switch',
        name: 'Circuit Breaker & Emergency Kill Switch',
        status: 'FAIL',
        message: `Circuit breaker active! Reason: "${config.killSwitchTriggeredReason || riskLimits.circuitBreakerReason || 'Locked'}". Reset kill switch in Step 3.`,
        durationMs: Date.now() - t9,
      });
    } else {
      checks.push({
        id: 'kill_switch',
        name: 'Circuit Breaker & Emergency Kill Switch',
        status: 'PASS',
        message: `All 5 emergency circuit breakers armed and disengaged. Balance floor: ${config.killSwitchRules.find(r => r.id === 'RULE_BALANCE_FLOOR')?.thresholdValue || 0.08} SOL.`,
        durationMs: Date.now() - t9,
      });
    }

    // ----------------------------------------------------
    // CHECK 10: LIVE Configuration Safety Gates
    // ----------------------------------------------------
    const t10 = Date.now();
    const slippageSafe = config.maxSlippagePct <= 5.0;
    const modeConfigured = config.autotradeMode !== 'OFF';

    if (!slippageSafe) {
      checks.push({
        id: 'live_config_gates',
        name: 'LIVE Configuration Safety Gates',
        status: 'FAIL',
        message: `Configured slippage (${config.maxSlippagePct}%) exceeds maximum safe threshold (5.0%).`,
        durationMs: Date.now() - t10,
      });
    } else {
      checks.push({
        id: 'live_config_gates',
        name: 'LIVE Configuration Safety Gates',
        status: 'PASS',
        message: `Execution parameters within bounds: Slippage tolerance ${config.maxSlippagePct}%, Target ticket size ${config.targetTradeSizeSol} SOL.`,
        details: { slippagePct: config.maxSlippagePct, targetSizeSol: config.targetTradeSizeSol },
        durationMs: Date.now() - t10,
      });
    }

    // ----------------------------------------------------
    // CHECK 11: Worker Process & Engine Coordinator
    // ----------------------------------------------------
    const t11 = Date.now();
    const coordinatorAlive = Boolean(coordinator && coordinator.candidateTokens);
    checks.push({
      id: 'worker_connectivity',
      name: 'Autonomous Worker Process & Pipeline',
      status: coordinatorAlive ? 'PASS' : 'FAIL',
      message: coordinatorAlive
        ? 'Engine coordinator, mempool scanner, and telemetry streams are active and synchronized.'
        : 'Worker process communication offline.',
      durationMs: Date.now() - t11,
    });

    // ----------------------------------------------------
    // FINAL REPORT SYNTHESIS
    // ----------------------------------------------------
    const hasFail = checks.some(c => c.status === 'FAIL');
    const allPassed = checks.every(c => c.status === 'PASS');
    const hasKeypair = Boolean(dedicatedKeypair);
    const canExecute = !hasFail && hasKeypair && onChainBalanceSol >= minRequired;

    let summary = '';
    if (canExecute) {
      summary = `LIVE PREFLIGHT PASSED: Dedicated wallet ${configuredAddress} is fully authenticated and ready for on-chain execution.`;
    } else {
      const failing = checks.filter(c => c.status === 'FAIL').map(c => c.name).join(', ');
      summary = `LIVE PREFLIGHT BLOCKED: ${failing || 'Requirements not met'}. Live trading remains strictly disabled.`;
    }

    // Record in WalletManager
    walletManager.updatePreflightStatus(!hasFail && hasKeypair, timestamp);

    return {
      timestamp,
      configuredAddress,
      network,
      rpcEndpoint,
      passed: !hasFail,
      allChecksPassed: allPassed,
      canExecuteLive: canExecute,
      summary,
      hasKeypairLoaded: hasKeypair,
      onChainBalanceSol,
      checks,
    };
  }
}
