import nacl from 'tweetnacl';
import { RpcError } from '../rpc/errors';
import type { ParsedWireTransaction } from './transactionParser';

export function verifyTransactionSignatures(parsedTx: ParsedWireTransaction): void {
  if (parsedTx.signatures.length < parsedTx.requiredSignerPubkeys.length) {
    throw new RpcError(-32003, 'Missing required signatures');
  }

  for (let i = 0; i < parsedTx.requiredSignerPubkeys.length; i += 1) {
    const signature = parsedTx.signatures[i];
    const signer = parsedTx.requiredSignerPubkeys[i];

    if (!signature || signature.length !== 64) {
      throw new RpcError(-32003, 'Missing required signatures');
    }

    const isAllZero = signature.every((byte) => byte === 0);
    if (isAllZero) {
      throw new RpcError(-32003, 'Missing required signatures');
    }

    const valid = nacl.sign.detached.verify(parsedTx.messageBytes, signature, signer.toBytes());
    if (!valid) {
      throw new RpcError(-32003, 'Signature verification failed');
    }
  }
}
