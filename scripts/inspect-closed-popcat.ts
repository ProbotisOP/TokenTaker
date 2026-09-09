import { Connection } from '@solana/web3.js';

async function inspectTxs() {
  const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const buyTx = '36EXExWfsEp5MZ3uk7fJ2B36S7JvuanGTQNRhdUwd1ywa25Y2cCopwtWvdQ5nT2XEHkZLDmMMnqHZhwAbVuV5w3Q';
  const sellTx = '55EPUTtcs6aGV1psdM92VDMKne7xPAGegGAh1QgV1uHYYL14PvssP7LjnwbdBeqvr9vx3QVnZQG9h5d27XQjLzC9';

  console.log('=== BUY TX DETAILS ===');
  const buyData = await conn.getParsedTransaction(buyTx, { maxSupportedTransactionVersion: 0 });
  if (buyData?.meta) {
    const preSol = buyData.meta.preBalances[0];
    const postSol = buyData.meta.postBalances[0];
    console.log('BUY pre SOL:', preSol / 1e9, 'post SOL:', postSol / 1e9, 'diff:', (postSol - preSol) / 1e9);
    console.log('Pre token balances:', buyData.meta.preTokenBalances?.map(t => ({ mint: t.mint, owner: t.owner, amount: t.uiTokenAmount.uiAmountString })));
    console.log('Post token balances:', buyData.meta.postTokenBalances?.map(t => ({ mint: t.mint, owner: t.owner, amount: t.uiTokenAmount.uiAmountString })));
  }

  console.log('\n=== SELL TX DETAILS ===');
  const sellData = await conn.getParsedTransaction(sellTx, { maxSupportedTransactionVersion: 0 });
  if (sellData?.meta) {
    const preSol = sellData.meta.preBalances[0];
    const postSol = sellData.meta.postBalances[0];
    console.log('SELL pre SOL:', preSol / 1e9, 'post SOL:', postSol / 1e9, 'diff:', (postSol - preSol) / 1e9);
    console.log('Pre token balances:', sellData.meta.preTokenBalances?.map(t => ({ mint: t.mint, owner: t.owner, amount: t.uiTokenAmount.uiAmountString })));
    console.log('Post token balances:', sellData.meta.postTokenBalances?.map(t => ({ mint: t.mint, owner: t.owner, amount: t.uiTokenAmount.uiAmountString })));
  }
}

inspectTxs().catch(console.error);

