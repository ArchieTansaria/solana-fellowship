import { ledger } from '../ledger/ledger';
import type { NormalizedInstruction } from '../ledger/accounts';
import { asRpcError, RpcError } from '../rpc/errors';
import { ATA_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../utils/constants';
import { deserializeTransactionFromWire } from './transactionParser';
import { verifyTransactionSignatures } from './signatureVerifier';
import { executeSystemInstruction } from '../programs/systemProgram';
import { executeTokenInstruction } from '../programs/tokenProgram';
import { executeAtaInstruction } from '../programs/ataProgram';

export function executeInstruction(ix: NormalizedInstruction): void {
  if (ix.programId.equals(SYSTEM_PROGRAM_ID)) {
    executeSystemInstruction(ix);
    return;
  }

  if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
    executeTokenInstruction(ix);
    return;
  }

  if (ix.programId.equals(ATA_PROGRAM_ID)) {
    executeAtaInstruction(ix);
    return;
  }

  throw new RpcError(-32003, `Unsupported program id: ${ix.programId.toBase58()}`);
}

export function processSendTransaction(params: unknown): string {
  if (!Array.isArray(params) || params.length < 1) {
    throw new RpcError(-32602, 'sendTransaction expects [encodedTx, options]');
  }

  const encodedTx = params[0];
  const options = params[1];

  if (options !== undefined) {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new RpcError(-32602, 'sendTransaction options must be an object');
    }

    const encoding = (options as Record<string, unknown>).encoding;
    if (encoding !== undefined && encoding !== 'base64') {
      throw new RpcError(-32602, 'sendTransaction only supports base64 encoding');
    }
  }

  if (typeof encodedTx !== 'string') {
    throw new RpcError(-32602, 'encodedTx must be a base64 string');
  }

  const parsedTx = deserializeTransactionFromWire(encodedTx);

  if (!ledger.isKnownBlockhash(parsedTx.recentBlockhash)) {
    throw new RpcError(-32003, 'Transaction recentBlockhash was not issued by this server');
  }

  verifyTransactionSignatures(parsedTx);

  const snapshot = ledger.cloneAccounts();
  try {
    for (const instruction of parsedTx.instructions) {
      executeInstruction(instruction);
    }
  } catch (error) {
    ledger.restoreAccounts(snapshot);
    ledger.advanceSlot();
    ledger.recordSignatureStatus(parsedTx.firstSignature, asRpcError(error).message);
    throw asRpcError(error);
  }

  ledger.advanceSlot();
  ledger.recordSignatureStatus(parsedTx.firstSignature, null);

  return parsedTx.firstSignature;
}
