import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const KEYPAIR_FILE_PATH = path.join(process.cwd(), '.secure_trading_keypair.json');

async function diagnose() {
  console.log('--- Inspecting Secure Trading Keypair & On-Chain State ---');
  if (!fs.existsSync(KEYPAIR_FILE_PATH)) {
    console.log('No .secure_trading_keypair.json found at path.');
    return;
  }

  const raw = fs.readFileSync(KEYPAIR_FILE_PATH, 'utf-8');
  const secretKey = Uint8Array.from(JSON.parse(raw));
  const keypair = Keypair.fromSecretKey(secretKey);
  const pubkey = keypair.publicKey;
  console.log('Trading Wallet Address:', pubkey.toBase58());

  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  
  // 1. SOL Balance
  const lamports = await connection.getBalance(pubkey);
  const solBalance = lamports / LAMPORTS_PER_SOL;
  console.log(`SOL Balance: ${solBalance} SOL (~$${(solBalance * 170).toFixed(2)} USD at $170/SOL)`);

  // 2. SPL Token Accounts & Token-2022 Accounts
  const tokenPrograms = [
    { name: 'SPL Token', id: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') },
    { name: 'Token-2022', id: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') },
  ];

  for (const prog of tokenPrograms) {
    const accounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: prog.id,
    });
    console.log(`\n${prog.name} Accounts Found: ${accounts.value.length}`);
    for (const ta of accounts.value) {
      const parsed = ta.account.data.parsed.info;
      console.log(`  Mint: ${parsed.mint}`);
      console.log(`    ATA Address: ${ta.pubkey.toBase58()}`);
      console.log(`    Amount: ${parsed.tokenAmount.uiAmount} (raw: ${parsed.tokenAmount.amount}, decimals: ${parsed.tokenAmount.decimals})`);
    }
  }

  // 3. Recent Transactions
  const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 10 });
  console.log(`\nRecent Signatures (${signatures.length}):`);
  for (const sig of signatures) {
    console.log(`  Signature: ${sig.signature}`);
    console.log(`    BlockTime: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
    console.log(`    Err: ${JSON.stringify(sig.err)}`);
    console.log(`    Memo: ${sig.memo}`);
  }

  // Check live value of each holding via Jupiter
  console.log('\n--- Checking Live Jupiter Value of Token Holdings ---');
  const { JupiterService } = await import('../src/trading/jupiterService.ts');
  const allHoldings = [
    { mint: 'DFwtrY9pNRHoYF4RKt8ueQ4WBa96Stw8VuaGNnZLSTNK', raw: 1132421784, name: 'DFwtr' },
    { mint: 'ANM35KbUcfKdEVBXzSjZBoT6ceSwYRs3fuc79fp7kRqP', raw: 4892083287, name: 'ANM35' },
    { mint: '463SK47VkB7uE7XenTHKiVcMtxRsfNE2X4Q9wByaURVA', raw: 2061961366423, name: '463SK' },
  ];

  for (const h of allHoldings) {
    const q = await JupiterService.fetchQuote({
      inputMint: h.mint,
      outputMint: 'So11111111111111111111111111111111111111112',
      amountLamports: h.raw,
      slippageBps: 250,
    });
    if (q.success && q.outAmount) {
      const sol = Number(q.outAmount) / LAMPORTS_PER_SOL;
      console.log(`  Holding ${h.name}: ${sol} SOL (~$${(sol * 170).toFixed(2)} USD) via ${q.routePlanSummary}`);
    } else {
      console.log(`  Holding ${h.name}: Quote failed or no route: ${q.error}`);
    }
  }
}

diagnose().catch(console.error);
