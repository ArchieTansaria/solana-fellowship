import bs58 from 'bs58';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import type { NormalizedInstruction } from '../ledger/accounts';
import { RpcError } from '../rpc/errors';
import { parseBase64 } from '../utils/parsers';

export interface ParsedWireTransaction {
  recentBlockhash: string;
  firstSignature: string;
  requiredSignerPubkeys: import('@solana/web3.js').PublicKey[];
  signatures: Uint8Array[];
  messageBytes: Uint8Array;
  instructions: NormalizedInstruction[];
}

export function deserializeTransactionFromWire(encodedTx: string): ParsedWireTransaction {
  const wire = parseBase64(encodedTx, 'encodedTx');

  if (wire.length === 0) {
    throw new RpcError(-32003, 'Transaction payload is empty');
  }

  try {
    const tx = Transaction.from(wire);
    return normalizeLegacyTransaction(tx);
  } catch {
    // Fallback to versioned deserialization.
  }

  try {
    const versionedTx = VersionedTransaction.deserialize(wire);
    return normalizeVersionedTransaction(versionedTx);
  } catch {
    throw new RpcError(-32003, 'Failed to deserialize transaction');
  }
}

export function normalizeLegacyTransaction(tx: Transaction): ParsedWireTransaction {
  const compiledMessage = tx.compileMessage();
  const requiredSignerCount = compiledMessage.header.numRequiredSignatures;

  const requiredSignerPubkeys = compiledMessage.accountKeys.slice(0, requiredSignerCount);

  const signatures = tx.signatures.map((entry) =>
    entry.signature ? new Uint8Array(entry.signature) : new Uint8Array(64),
  );

  const instructions: NormalizedInstruction[] = tx.instructions.map((instruction) => ({
    programId: instruction.programId,
    accounts: instruction.keys.map((keyMeta) => ({
      pubkey: keyMeta.pubkey,
      isSigner: keyMeta.isSigner,
      isWritable: keyMeta.isWritable,
    })),
    data: Buffer.from(instruction.data),
  }));

  const firstSignatureBytes = signatures[0] ?? new Uint8Array(64);
  const firstSignature = bs58.encode(Buffer.from(firstSignatureBytes));

  return {
    recentBlockhash: compiledMessage.recentBlockhash,
    firstSignature,
    requiredSignerPubkeys,
    signatures,
    messageBytes: tx.serializeMessage(),
    instructions,
  };
}

export function normalizeVersionedTransaction(versionedTx: VersionedTransaction): ParsedWireTransaction {
  const message = versionedTx.message;

  const lookups = 'addressTableLookups' in message ? message.addressTableLookups : [];
  if (lookups.length > 0) {
    throw new RpcError(-32003, 'Address table lookups are not supported in this mini validator');
  }

  const requiredSignerCount = message.header.numRequiredSignatures;
  const staticAccountKeys = message.staticAccountKeys;

  const requiredSignerPubkeys = staticAccountKeys.slice(0, requiredSignerCount);

  const writableSigned = requiredSignerCount - message.header.numReadonlySignedAccounts;
  const writableUnsigned = staticAccountKeys.length - message.header.numReadonlyUnsignedAccounts;

  const isWritableIndex = (index: number): boolean => {
    if (index < requiredSignerCount) {
      return index < writableSigned;
    }
    return index < writableUnsigned;
  };

  const instructions: NormalizedInstruction[] = message.compiledInstructions.map((compiledInstruction) => {
    if (compiledInstruction.programIdIndex >= staticAccountKeys.length) {
      throw new RpcError(-32003, 'Address table lookups are not supported in this mini validator');
    }

    const accounts = compiledInstruction.accountKeyIndexes.map((accountIndex) => {
      if (accountIndex >= staticAccountKeys.length) {
        throw new RpcError(-32003, 'Address table lookups are not supported in this mini validator');
      }

      return {
        pubkey: staticAccountKeys[accountIndex],
        isSigner: accountIndex < requiredSignerCount,
        isWritable: isWritableIndex(accountIndex),
      };
    });

    return {
      programId: staticAccountKeys[compiledInstruction.programIdIndex],
      accounts,
      data: Buffer.from(compiledInstruction.data),
    };
  });

  const signatures = versionedTx.signatures.map((sig) => new Uint8Array(sig));
  const firstSignatureBytes = signatures[0] ?? new Uint8Array(64);
  const firstSignature = bs58.encode(Buffer.from(firstSignatureBytes));

  return {
    recentBlockhash: message.recentBlockhash,
    firstSignature,
    requiredSignerPubkeys,
    signatures,
    messageBytes: message.serialize(),
    instructions,
  };
}
