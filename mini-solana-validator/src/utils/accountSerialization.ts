import { PublicKey } from '@solana/web3.js';
import type { MintState, TokenAccountState } from '../ledger/accounts';
import { RpcError } from '../rpc/errors';
import { MINT_DATA_LEN, TOKEN_ACCOUNT_DATA_LEN } from './constants';
import { readU64LE, writeU64LE } from './encoding';

export function decodeMintData(data: Buffer): MintState {
  if (data.length < MINT_DATA_LEN) {
    throw new RpcError(-32003, 'Invalid mint account size');
  }

  const mintAuthorityOption = data.readUInt32LE(0);
  const mintAuthority = mintAuthorityOption
    ? new PublicKey(data.subarray(4, 36)).toBase58()
    : null;

  const supply = readU64LE(data, 36);
  const decimals = data.readUInt8(44);
  const isInitialized = data.readUInt8(45) === 1;

  const freezeAuthorityOption = data.readUInt32LE(46);
  const freezeAuthority = freezeAuthorityOption
    ? new PublicKey(data.subarray(50, 82)).toBase58()
    : null;

  return {
    mintAuthority,
    supply,
    decimals,
    isInitialized,
    freezeAuthority,
  };
}

export function encodeMintData(target: Buffer, state: MintState): void {
  if (target.length < MINT_DATA_LEN) {
    throw new RpcError(-32003, 'Invalid mint account size');
  }

  target.fill(0);

  if (state.mintAuthority) {
    target.writeUInt32LE(1, 0);
    const mintAuthority = new PublicKey(state.mintAuthority);
    mintAuthority.toBuffer().copy(target, 4);
  }

  writeU64LE(target, 36, state.supply);
  target.writeUInt8(state.decimals, 44);
  target.writeUInt8(state.isInitialized ? 1 : 0, 45);

  if (state.freezeAuthority) {
    target.writeUInt32LE(1, 46);
    const freezeAuthority = new PublicKey(state.freezeAuthority);
    freezeAuthority.toBuffer().copy(target, 50);
  }
}

export function decodeTokenAccountData(data: Buffer): TokenAccountState {
  if (data.length < TOKEN_ACCOUNT_DATA_LEN) {
    throw new RpcError(-32003, 'Invalid token account size');
  }

  const mint = new PublicKey(data.subarray(0, 32)).toBase58();
  const owner = new PublicKey(data.subarray(32, 64)).toBase58();
  const amount = readU64LE(data, 64);
  const state = data.readUInt8(108);

  return { mint, owner, amount, state };
}

export function encodeTokenAccountData(target: Buffer, state: TokenAccountState): void {
  if (target.length < TOKEN_ACCOUNT_DATA_LEN) {
    throw new RpcError(-32003, 'Invalid token account size');
  }

  target.fill(0);

  const mint = new PublicKey(state.mint);
  mint.toBuffer().copy(target, 0);

  const owner = new PublicKey(state.owner);
  owner.toBuffer().copy(target, 32);

  writeU64LE(target, 64, state.amount);
  target.writeUInt8(state.state, 108);
}
