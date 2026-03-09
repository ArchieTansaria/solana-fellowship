import type { AccountState } from '../ledger/accounts';
import { RpcError } from '../rpc/errors';

export function readU64LE(data: Buffer, offset: number): bigint {
  if (offset + 8 > data.length) {
    throw new RpcError(-32003, 'Instruction data is too short');
  }
  return data.readBigUInt64LE(offset);
}

export function writeU64LE(buffer: Buffer, offset: number, value: bigint): void {
  buffer.writeBigUInt64LE(value, offset);
}

export function toUiLamports(value: bigint): number {
  return Number(value);
}

export function accountToRpcInfo(account: AccountState): {
  data: [string, 'base64'];
  executable: boolean;
  lamports: number;
  owner: string;
  rentEpoch: number;
} {
  return {
    data: [account.data.toString('base64'), 'base64'],
    executable: account.executable,
    lamports: toUiLamports(account.lamports),
    owner: account.owner,
    rentEpoch: account.rentEpoch,
  };
}
