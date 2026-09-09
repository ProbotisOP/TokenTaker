import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';

async function main() {
  const keypairData = JSON.parse(fs.readFileSync('.secure_trading_keypair.json', 'utf-8'));
  const { Keypair } = await import('@solana/web3.js');
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const pubkey = keypair.publicKey;
  const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const sigs = await conn.getSignaturesForAddress(pubkey, { limit: 10 });
  console.log('--- RECENT 10 SIGNATURES ---');
  for (const s of sigs) {
    console.log(s.signature, s.blockTime ? new Date(s.blockTime * 1000).toISOString() : 'pending', s.err);
  }
}
main().catch(console.error);
