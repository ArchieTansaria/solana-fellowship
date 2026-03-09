import { PublicKey } from '@solana/web3.js';
import { ledger } from '../ledger/ledger';
import { requireSigner, type NormalizedInstruction } from '../ledger/accounts';
import { RpcError } from '../rpc/errors';
import { SYSTEM_PROGRAM_ID } from '../utils/constants';
import { readU64LE } from '../utils/encoding';

export function executeSystemInstruction(ix: NormalizedInstruction): void {
  if (ix.data.length < 4) {
    throw new RpcError(-32003, 'Invalid system instruction data');
  }

  const discriminator = ix.data.readUInt32LE(0);

  if (discriminator === 0) {
    if (ix.accounts.length < 2 || ix.data.length < 52) {
      throw new RpcError(-32003, 'Invalid CreateAccount instruction');
    }

    const payerMeta = ix.accounts[0];
    const newAccountMeta = ix.accounts[1];

    requireSigner(payerMeta, 'CreateAccount payer');
    requireSigner(newAccountMeta, 'CreateAccount new account');

    const lamports = readU64LE(ix.data, 4);
    const space = readU64LE(ix.data, 12);
    const owner = new PublicKey(ix.data.subarray(20, 52)).toBase58();

    const payerPubkey = payerMeta.pubkey.toBase58();
    const newPubkey = newAccountMeta.pubkey.toBase58();

    const existing = ledger.getAccount(newPubkey);
    if (existing && (existing.lamports > 0n || existing.data.length > 0)) {
      throw new RpcError(-32003, 'CreateAccount target already exists');
    }

    ledger.debitLamports(payerPubkey, lamports);

    const numericSpace = Number(space);
    if (
      !Number.isFinite(numericSpace) ||
      !Number.isSafeInteger(numericSpace) ||
      numericSpace < 0 ||
      numericSpace > 10_000_000
    ) {
      throw new RpcError(-32003, 'Invalid account space');
    }

    ledger.setAccount(newPubkey, {
      lamports,
      owner,
      data: Buffer.alloc(numericSpace),
      executable: false,
      rentEpoch: 0,
    });
    return;
  }

  if (discriminator === 2) {
    if (ix.accounts.length < 2 || ix.data.length < 12) {
      throw new RpcError(-32003, 'Invalid Transfer instruction');
    }

    const sourceMeta = ix.accounts[0];
    const destinationMeta = ix.accounts[1];

    requireSigner(sourceMeta, 'Transfer source');

    const amount = readU64LE(ix.data, 4);

    const sourcePubkey = sourceMeta.pubkey.toBase58();
    const destinationPubkey = destinationMeta.pubkey.toBase58();

    ledger.debitLamports(sourcePubkey, amount);
    ledger.creditLamports(destinationPubkey, amount);
    return;
  }

  throw new RpcError(-32003, `Unsupported System Program instruction: ${discriminator}`);
}

export { SYSTEM_PROGRAM_ID };
