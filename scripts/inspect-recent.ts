import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';

async function main() {
  const keypairData = JSON.parse(fs.readFileSync('.secure_trading_keypair.json', 'utf-8'));
  const { Keypair } = await import('@solana/web3.js');
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const pubkey = keypair.publicKey;
  const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  
  const targetSigs = [
    '2obowTnmU8mbi9Gt6YEsqA2QWCEa7z5TiCswTRNqZ9LEJsGv6uCyowMWqrXfr6f5ZHdSzXCjTwV2Gxj8xTRUCBYn',
    'kxgfuiEnKzfHuWUw5xthCgdSc5xE5ByHnQsrmUGyHNAZq1gpKd1LFztihvXCfdYrWtnZV6AF8J4BS4qZoeQxt6R',
    '4Wd7U2xdnWFfKcUC32RRhkRxmZachNGuacohrDa2BFL3s1wW6QmvPcJhDfiAUN8B3Hgkxre1TkHMQj4vwwHT9zWN',
    'MTiDx2cKri8xU7cwbZ1Z42kdtMiwTmWj16uMhMaMHy1m59CCVqjFbe6saZQdCfvHxAjQvKkeWEvMw4H4DRc6P32'
  ];

  for (const sig of targetSigs) {
    console.log('\n==============================');
    console.log('TX:', sig);
    const tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta) {
      console.log('No data');
      continue;
    }
    const myIndex = tx.transaction.message.accountKeys.findIndex(k => k.pubkey.toBase58() === pubkey.toBase58());
    const solChange = myIndex !== -1 ? (tx.meta.postBalances[myIndex] - tx.meta.preBalances[myIndex]) / LAMPORTS_PER_SOL : 0;
    console.log('SOL Change:', solChange.toFixed(6));
    console.log('PreTokens:', tx.meta.preTokenBalances?.filter(t => t.owner === pubkey.toBase58()).map(t => ({ mint: t.mint, amount: t.uiTokenAmount.uiAmountString })));
    console.log('PostTokens:', tx.meta.postTokenBalances?.filter(t => t.owner === pubkey.toBase58()).map(t => ({ mint: t.mint, amount: t.uiTokenAmount.uiAmountString })));
  }
}

main().catch(console.error);
