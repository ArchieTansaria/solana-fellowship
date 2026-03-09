import { PublicKey } from '@solana/web3.js';
import { ledger } from './ledger';
import { RpcError } from '../rpc/errors';
import { TOKEN_PROGRAM_ID } from '../utils/constants';

export interface AccountState {
  lamports: bigint;
  owner: string;
  data: Buffer;
  executable: boolean;
  rentEpoch: number;
}

export interface SignatureStatus {
  slot: number;
  confirmations: null;
  err: null | string;
  confirmationStatus: 'confirmed';
}

export interface MintState {
  mintAuthority: string | null;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: string | null;
}

export interface TokenAccountState {
  mint: string;
  owner: string;
  amount: bigint;
  state: number;
}

export interface InstructionAccountMeta {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

export interface NormalizedInstruction {
  programId: PublicKey;
  accounts: InstructionAccountMeta[];
  data: Buffer;
}

export function requireSigner(meta: InstructionAccountMeta, label: string): void {
  if (!meta.isSigner) {
    throw new RpcError(-32003, `${label} must sign`);
  }
}

export function requireAccount(pubkey: string): AccountState {
  const account = ledger.getAccount(pubkey);
  if (!account) {
    throw new RpcError(-32003, `Account ${pubkey} does not exist`);
  }
  return account;
}

export function requireTokenProgramOwned(pubkey: string, minSize: number): AccountState {
  const account = requireAccount(pubkey);
  if (account.owner !== TOKEN_PROGRAM_ID.toBase58() || account.data.length < minSize) {
    throw new RpcError(-32003, `Account ${pubkey} is not a valid token program account`);
  }
  return account;
}
