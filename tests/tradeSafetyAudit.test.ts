/**
 * Trade Safety & Decimal-Safe Audit Regression Suite
 * Tests all requirements from the Urgent Live-Trade Bug Audit.
 * 
 * ZERO on-chain funds spent! All tests use deterministic fixtures and mock RPC/Jupiter.
 */
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  solToLamports,
  lamportsToSol,
  toTokenBaseUnits,
  toTokenHumanAmount,
  SOL_MINT_ADDRESS,
} from '../src/trading/decimalSafeUtils.ts';
import { TradeSafetyValidator } from '../src/trading/tradeSafetyValidator.ts';

// Mock connection that intercepts getParsedAccountInfo and getTokenSupply
function createMockConnection(mintDecimalsMap: Record<string, number>): Connection {
  const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  // Stub getTokenSupply
  (conn as any).getTokenSupply = async (pubkey: PublicKey) => {
    const mintStr = pubkey.toBase58();
    if (mintStr in mintDecimalsMap) {
      return {
        value: {
          decimals: mintDecimalsMap[mintStr],
          amount: '1000000000000000',
          uiAmount: 1000000000,
        },
      };
    }
    throw new Error(`AccountNotFound: ${mintStr}`);
  };

  // Stub getParsedAccountInfo
  (conn as any).getParsedAccountInfo = async (pubkey: PublicKey) => {
    const mintStr = pubkey.toBase58();
    if (mintStr in mintDecimalsMap) {
      return {
        value: {
          data: {
            parsed: {
              info: {
                decimals: mintDecimalsMap[mintStr],
              },
            },
          },
        },
      };
    }
    return { value: null };
  };

  return conn;
}

async function runAuditSuite() {
  console.log('================================================================');
  console.log('=== RUNNING COMPREHENSIVE TRADE SAFETY AUDIT TEST SUITE ===');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`, details || '');
      failed++;
    }
  }

  const TEST_WALLET = 'Fk7JNPucbK6KxhYvAzR3nuqJCpvPBXtBhKa1jiBjcCYy';
  const TOKEN_6_DEC = 'DFwtrY9pNRHoYF4RKt8ueQ4WBa96Stw8VuaGNnZLSTNK';
  const TOKEN_9_DEC = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  const TOKEN_UNKNOWN = 'UnknownMint1111111111111111111111111111111';

  const mockConn = createMockConnection({
    [TOKEN_6_DEC]: 6,
    [TOKEN_9_DEC]: 9,
  });

  // -------------------------------------------------------------
  // GROUP 1: SOL <-> Lamports Conversion Math
  // -------------------------------------------------------------
  console.log('--- Group 1: SOL <-> Lamports Conversion Math ---');
  assert(solToLamports(0.001) === 1_000_000n, '0.001 SOL -> exactly 1,000,000 lamports');
  assert(solToLamports(0.004) === 4_000_000n, '0.004 SOL -> exactly 4,000,000 lamports');
  assert(solToLamports(1.0) === 1_000_000_000n, '1.0 SOL -> exactly 1,000,000,000 lamports');
  assert(solToLamports(0.02) === 20_000_000n, '0.02 SOL -> exactly 20,000,000 lamports');
  assert(lamportsToSol(4_000_000n) === 0.004, '4,000,000 lamports -> exactly 0.004 SOL');
  assert(lamportsToSol(20_000_000n) === 0.02, '20,000,000 lamports -> exactly 0.02 SOL');

  // -------------------------------------------------------------
  // GROUP 2: SPL Token Base Units <-> Human Decimal Math
  // -------------------------------------------------------------
  console.log('\n--- Group 2: SPL Token Decimal Math (6 & 9 decimals, small/large) ---');
  // 6 decimals
  assert(toTokenBaseUnits(1.0, 6) === 1_000_000n, '1.0 token (6 dec) -> 1,000,000 base units');
  assert(toTokenBaseUnits(1132.426631, 6) === 1132426631n, '1132.426631 token (6 dec) -> 1,132,426,631 base units (Actual incident match)');
  assert(toTokenHumanAmount(1132426631n, 6) === 1132.426631, '1,132,426,631 base units (6 dec) -> 1132.426631 human tokens');

  // 9 decimals
  assert(toTokenBaseUnits(1.0, 9) === 1_000_000_000n, '1.0 token (9 dec) -> 1,000,000,000 base units');
  assert(toTokenHumanAmount(5000000000n, 9) === 5.0, '5,000,000,000 base units (9 dec) -> 5.0 tokens');

  // Extreme sizes
  assert(toTokenBaseUnits(0.000001, 6) === 1n, '0.000001 token (6 dec) -> 1 base unit');
  assert(toTokenBaseUnits(100_000_000, 6) === 100_000_000_000_000n, '100,000,000 token (6 dec) -> 100T base units');
  assert(toTokenHumanAmount(1n, 6) === 0.000001, '1 base unit (6 dec) -> 0.000001 tokens');

  // -------------------------------------------------------------
  // GROUP 3: BUY Quote Validation (Valid Scenario)
  // -------------------------------------------------------------
  console.log('\n--- Group 3: BUY Quote Validation (Happy Path) ---');
  const validBuyQuote = {
    inputMint: SOL_MINT_ADDRESS,
    outputMint: TOKEN_6_DEC,
    inAmount: '20000000', // 0.02 SOL
    outAmount: '1132426631', // 1,132.42 tokens
    otherAmountThreshold: '1110000000',
    priceImpactPct: '0.05',
    routePlan: [{ swapInfo: { label: 'Raydium CPMM' } }],
  };

  try {
    const res = await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
      intended_sol_lamports: 20_000_000n,
      quote_response: validBuyQuote,
      wallet_pubkey: TEST_WALLET,
    });
    assert(res.is_valid === true && res.token_decimals === 6, 'Valid BUY quote passes validation');
  } catch (err: any) {
    assert(false, 'Valid BUY quote passes validation', err.message);
  }

  // -------------------------------------------------------------
  // GROUP 4: SELL Quote Validation (Valid Scenario)
  // -------------------------------------------------------------
  console.log('\n--- Group 4: SELL Quote Validation (Happy Path) ---');
  const validSellQuote = {
    inputMint: TOKEN_6_DEC,
    outputMint: SOL_MINT_ADDRESS,
    inAmount: '1132426631', // 1,132.42 tokens
    outAmount: '23000000', // 0.023 SOL (profitable exit)
    otherAmountThreshold: '22500000',
    priceImpactPct: '0.08',
    routePlan: [{ swapInfo: { label: 'Meteora DLMM' } }],
  };

  try {
    const res = await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'SELL',
      intended_token_mint: TOKEN_6_DEC,
      intended_token_base_units: 1132426631n,
      quote_response: validSellQuote,
      wallet_pubkey: TEST_WALLET,
    });
    assert(res.is_valid === true && res.token_decimals === 6, 'Valid SELL quote passes validation');
  } catch (err: any) {
    assert(false, 'Valid SELL quote passes validation', err.message);
  }

  // -------------------------------------------------------------
  // GROUP 5: Incident Regression Test (0.004 SOL with tiny output)
  // -------------------------------------------------------------
  console.log('\n--- Group 5: Incident Regression (0.004 SOL suspicious output) ---');
  const suspiciousIncidentQuote = {
    inputMint: SOL_MINT_ADDRESS,
    outputMint: TOKEN_6_DEC,
    inAmount: '4000000', // 0.004 SOL
    outAmount: '80', // 80 lamports / 0.00008 tokens (suspiciously tiny)
    otherAmountThreshold: '70',
    priceImpactPct: '0.01',
  };

  let caughtIncident = false;
  try {
    await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
      intended_sol_lamports: 4_000_000n,
      quote_response: suspiciousIncidentQuote,
      wallet_pubkey: TEST_WALLET,
    });
  } catch (err: any) {
    caughtIncident = err.message.includes('TRADE_REJECTED: OUTPUT_AMOUNT_BELOW_SAFETY_THRESHOLD');
  }
  assert(caughtIncident, 'Incident Regression: 0.004 SOL with tiny output is REJECTED');

  // -------------------------------------------------------------
  // GROUP 6: Hard Safety Gates Rejection Tests
  // -------------------------------------------------------------
  console.log('\n--- Group 6: Hard Safety Gates Rejections ---');

  // 6A. Wrong Output Mint
  let wrongOutputCaught = false;
  try {
    await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
      intended_sol_lamports: 20_000_000n,
      quote_response: { ...validBuyQuote, outputMint: 'WrongMint111111111111111111111111111111111' },
      wallet_pubkey: TEST_WALLET,
    });
  } catch (err: any) {
    wrongOutputCaught = err.message.includes('TRADE_REJECTED: WRONG_OUTPUT_MINT');
  }
  assert(wrongOutputCaught, 'Rejection: Wrong Output Mint');

  // 6B. Reversed Mint (Token -> SOL on BUY)
  let reversedMintCaught = false;
  try {
    await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
      intended_sol_lamports: 20_000_000n,
      quote_response: { ...validBuyQuote, inputMint: TOKEN_6_DEC, outputMint: SOL_MINT_ADDRESS },
      wallet_pubkey: TEST_WALLET,
    });
  } catch (err: any) {
    reversedMintCaught = err.message.includes('TRADE_REJECTED: WRONG_INPUT_MINT');
  }
  assert(reversedMintCaught, 'Rejection: Reversed Mint on BUY');

  // 6C. Zero Output Amount
  let zeroOutputCaught = false;
  try {
    await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
      intended_sol_lamports: 20_000_000n,
      quote_response: { ...validBuyQuote, outAmount: '0' },
      wallet_pubkey: TEST_WALLET,
    });
  } catch (err: any) {
    zeroOutputCaught = err.message.includes('TRADE_REJECTED: ZERO_OUTPUT_AMOUNT');
  }
  assert(zeroOutputCaught, 'Rejection: Zero Output Amount');

  // 6D. Excessive Price Impact
  let priceImpactCaught = false;
  try {
    await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
      intended_sol_lamports: 20_000_000n,
      quote_response: { ...validBuyQuote, priceImpactPct: '6.50' }, // 6.5% > 2.5% max
      max_price_impact_pct: 2.5,
      wallet_pubkey: TEST_WALLET,
    });
  } catch (err: any) {
    priceImpactCaught = err.message.includes('TRADE_REJECTED: EXCESSIVE_PRICE_IMPACT');
  }
  assert(priceImpactCaught, 'Rejection: Excessive Price Impact (>2.5%)');

  // 6E. Input Amount Mismatch (> 1% tolerance)
  let inputMismatchCaught = false;
  try {
    await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
      intended_sol_lamports: 20_000_000n,
      quote_response: { ...validBuyQuote, inAmount: '25000000' }, // 25M lamports vs 20M (25% off)
      wallet_pubkey: TEST_WALLET,
    });
  } catch (err: any) {
    inputMismatchCaught = err.message.includes('TRADE_REJECTED: INPUT_AMOUNT_MISMATCH');
  }
  assert(inputMismatchCaught, 'Rejection: Input Amount Mismatch beyond 1% tolerance');

  // 6F. Decimal Validation Failure (Unknown mint)
  let decimalFailureCaught = false;
  try {
    await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'BUY',
      intended_token_mint: TOKEN_UNKNOWN,
      intended_sol_lamports: 20_000_000n,
      quote_response: { ...validBuyQuote, outputMint: TOKEN_UNKNOWN },
      wallet_pubkey: TEST_WALLET,
    });
  } catch (err: any) {
    decimalFailureCaught = err.message.includes('TRADE_REJECTED: DECIMAL_VALIDATION_FAILED');
  }
  assert(decimalFailureCaught, 'Rejection: Token Decimal Validation Failure');

  // 6G. Malformed Quote
  let malformedCaught = false;
  try {
    await TradeSafetyValidator.validateQuote(mockConn, {
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
      intended_sol_lamports: 20_000_000n,
      quote_response: null,
      wallet_pubkey: TEST_WALLET,
    });
  } catch (err: any) {
    malformedCaught = err.message.includes('TRADE_REJECTED: MALFORMED_JUPITER_QUOTE');
  }
  assert(malformedCaught, 'Rejection: Malformed/Null Jupiter Quote');

  // -------------------------------------------------------------
  // GROUP 7: Compiled Transaction Signer Validation
  // -------------------------------------------------------------
  console.log('\n--- Group 7: Transaction Signer Validation ---');
  const validKeypair = { publicKey: new PublicKey(TEST_WALLET) };
  const unauthorizedKeypair = { publicKey: new PublicKey(TOKEN_9_DEC) };

  // Create a minimal VersionedTransaction with validKeypair as signer
  const mockTx = {
    message: {
      staticAccountKeys: [validKeypair.publicKey, new PublicKey(TOKEN_6_DEC)],
      header: {
        numRequiredSignatures: 1,
      },
    },
  } as unknown as VersionedTransaction;

  let signerPass = false;
  try {
    TradeSafetyValidator.validateCompiledTransaction({
      versioned_tx: mockTx,
      wallet_pubkey: validKeypair.publicKey.toBase58(),
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
    });
    signerPass = false;
  } catch (err: any) {
    signerPass = err.message.includes('SWAP_INSTRUCTIONS_NOT_ATTESTED');
  }
  assert(signerPass, 'Matching signer alone is insufficient: unverified payload is blocked');

  let signerFail = false;
  try {
    TradeSafetyValidator.validateCompiledTransaction({
      versioned_tx: mockTx,
      wallet_pubkey: unauthorizedKeypair.publicKey.toBase58(), // Not in signers
      intended_action: 'BUY',
      intended_token_mint: TOKEN_6_DEC,
    });
  } catch (err: any) {
    signerFail = err.message.includes('TRADE_REJECTED: INVALID_TRANSACTION_SIGNER');
  }
  assert(signerFail, 'Rejection: Unauthorized wallet missing from transaction signers');

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`AUDIT TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuditSuite().catch((err) => {
  console.error('Audit suite crashed:', err);
  process.exit(1);
});
