import { createPublicKey, verify } from 'node:crypto';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

export function verifyPhantomSignature(tx: VersionedTransaction, walletAddress: string, originalMessage: Uint8Array): void {
  const owner = new PublicKey(walletAddress);
  if (!Buffer.from(tx.message.serialize()).equals(Buffer.from(originalMessage))) throw new Error('Phantom transaction message changed');
  if (tx.message.header.numRequiredSignatures !== 1 || tx.signatures.length !== 1 || !tx.message.staticAccountKeys[0].equals(owner)) {
    throw new Error('Phantom transaction must have exactly the connected wallet as its required signer');
  }
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), owner.toBuffer()]), format: 'der', type: 'spki' });
  if (tx.signatures[0].length !== 64 || !verify(null, Buffer.from(originalMessage), key, tx.signatures[0])) {
    throw new Error('Invalid or missing Phantom signature');
  }
}
