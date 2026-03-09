import { PublicKey } from '@solana/web3.js';
import { RpcError } from '../rpc/errors';

export function parsePubkey(value: unknown, fieldName: string): PublicKey {
  if (typeof value !== 'string') {
    throw new RpcError(-32602, `${fieldName} must be a base58 string`);
  }

  try {
    return new PublicKey(value);
  } catch {
    throw new RpcError(-32602, `${fieldName} is not a valid public key`);
  }
}

export function parseNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new RpcError(-32602, `${fieldName} must be a non-negative integer`);
  }

  return value;
}

export function parseBase64(value: unknown, fieldName: string): Buffer {
  if (typeof value !== 'string') {
    throw new RpcError(-32602, `${fieldName} must be base64`);
  }

  try {
    return Buffer.from(value, 'base64');
  } catch {
    throw new RpcError(-32602, `${fieldName} must be base64`);
  }
}
