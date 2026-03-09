import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { ledger } from '../ledger/ledger';
import { requireTokenProgramOwned } from '../ledger/accounts';
import { RpcError } from './errors';
import { processSendTransaction } from '../runtime/instructionExecutor';
import { MINT_DATA_LEN, TOKEN_ACCOUNT_DATA_LEN, TOKEN_PROGRAM_ID } from '../utils/constants';
import { accountToRpcInfo, toUiLamports } from '../utils/encoding';
import { decodeMintData, decodeTokenAccountData } from '../utils/accountSerialization';
import { parseNonNegativeInteger, parsePubkey } from '../utils/parsers';

export function getVersion(): { 'solana-core': string; 'feature-set': number } {
  return {
    'solana-core': '1.18.0-mini-validator',
    'feature-set': 1,
  };
}

export function getSlot(): number {
  return ledger.slot;
}

export function getBlockHeight(): number {
  return ledger.blockHeight;
}

export function getHealth(): string {
  return 'ok';
}

export function getLatestBlockhash(): {
  context: { slot: number };
  value: { blockhash: string; lastValidBlockHeight: number };
} {
  const value = ledger.issueBlockhash();
  return {
    context: { slot: ledger.slot },
    value,
  };
}

export function getBalance(params: unknown): {
  context: { slot: number };
  value: number;
} {
  if (!Array.isArray(params) || params.length < 1) {
    throw new RpcError(-32602, 'getBalance expects [pubkey]');
  }

  const pubkey = parsePubkey(params[0], 'pubkey').toBase58();
  const account = ledger.getAccount(pubkey);

  return {
    context: { slot: ledger.slot },
    value: toUiLamports(account?.lamports ?? 0n),
  };
}

export function getAccountInfo(params: unknown): {
  context: { slot: number };
  value: ReturnType<typeof accountToRpcInfo> | null;
} {
  if (!Array.isArray(params) || params.length < 1) {
    throw new RpcError(-32602, 'getAccountInfo expects [pubkey, options]');
  }

  const pubkey = parsePubkey(params[0], 'pubkey').toBase58();

  if (params[1] !== undefined) {
    const options = params[1];
    if (
      typeof options !== 'object' ||
      options === null ||
      Array.isArray(options) ||
      ((options as Record<string, unknown>).encoding !== undefined &&
        (options as Record<string, unknown>).encoding !== 'base64')
    ) {
      throw new RpcError(-32602, 'getAccountInfo encoding must be base64');
    }
  }

  const account = ledger.getAccount(pubkey);

  return {
    context: { slot: ledger.slot },
    value: account ? accountToRpcInfo(account) : null,
  };
}

export function getMinimumBalanceForRentExemption(params: unknown): number {
  if (!Array.isArray(params) || params.length < 1) {
    throw new RpcError(-32602, 'getMinimumBalanceForRentExemption expects [dataSize]');
  }

  const dataSize = parseNonNegativeInteger(params[0], 'dataSize');
  return toUiLamports(ledger.getRentExemptMinimum(dataSize));
}

export function getTokenAccountBalance(params: unknown): {
  context: { slot: number };
  value: { amount: string; decimals: number; uiAmount: number };
} {
  if (!Array.isArray(params) || params.length < 1) {
    throw new RpcError(-32602, 'getTokenAccountBalance expects [pubkey]');
  }

  const tokenAccountPubkey = parsePubkey(params[0], 'pubkey').toBase58();
  const tokenAccount = requireTokenProgramOwned(tokenAccountPubkey, TOKEN_ACCOUNT_DATA_LEN);
  const tokenState = decodeTokenAccountData(tokenAccount.data);
  const mintAccount = requireTokenProgramOwned(tokenState.mint, MINT_DATA_LEN);
  const mintState = decodeMintData(mintAccount.data);

  const amountStr = tokenState.amount.toString();
  const divisor = 10 ** mintState.decimals;
  const uiAmount = Number(tokenState.amount) / divisor;

  return {
    context: { slot: ledger.slot },
    value: {
      amount: amountStr,
      decimals: mintState.decimals,
      uiAmount,
    },
  };
}

export function getTokenAccountsByOwner(params: unknown): {
  context: { slot: number };
  value: Array<{ pubkey: string; account: ReturnType<typeof accountToRpcInfo> }>;
} {
  if (!Array.isArray(params) || params.length < 2) {
    throw new RpcError(-32602, 'getTokenAccountsByOwner expects [owner, filter, options]');
  }

  const owner = parsePubkey(params[0], 'owner').toBase58();
  const filter = params[1];

  if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
    throw new RpcError(-32602, 'filter must be { mint } or { programId }');
  }

  const mintFilter = (filter as Record<string, unknown>).mint;
  const programFilter = (filter as Record<string, unknown>).programId;

  if ((mintFilter === undefined && programFilter === undefined) || (mintFilter && programFilter)) {
    throw new RpcError(-32602, 'filter must be either { mint } or { programId }');
  }

  let mintFilterValue: string | null = null;
  let programFilterValue: string | null = null;

  if (mintFilter !== undefined) {
    mintFilterValue = parsePubkey(mintFilter, 'filter.mint').toBase58();
  }

  if (programFilter !== undefined) {
    programFilterValue = parsePubkey(programFilter, 'filter.programId').toBase58();
  }

  if (params[2] !== undefined) {
    const options = params[2];
    if (
      typeof options !== 'object' ||
      options === null ||
      Array.isArray(options) ||
      ((options as Record<string, unknown>).encoding !== undefined &&
        (options as Record<string, unknown>).encoding !== 'base64')
    ) {
      throw new RpcError(-32602, 'encoding must be base64');
    }
  }

  const value: Array<{ pubkey: string; account: ReturnType<typeof accountToRpcInfo> }> = [];

  for (const [pubkey, account] of ledger.listAccounts()) {
    if (account.owner !== TOKEN_PROGRAM_ID.toBase58() || account.data.length < TOKEN_ACCOUNT_DATA_LEN) {
      continue;
    }

    const tokenState = decodeTokenAccountData(account.data);
    if (tokenState.owner !== owner) {
      continue;
    }

    if (mintFilterValue && tokenState.mint !== mintFilterValue) {
      continue;
    }

    if (programFilterValue && account.owner !== programFilterValue) {
      continue;
    }

    value.push({
      pubkey,
      account: accountToRpcInfo(account),
    });
  }

  return {
    context: { slot: ledger.slot },
    value,
  };
}

export function requestAirdrop(params: unknown): string {
  if (!Array.isArray(params) || params.length < 2) {
    throw new RpcError(-32602, 'requestAirdrop expects [pubkey, lamports]');
  }

  const pubkey = parsePubkey(params[0], 'pubkey').toBase58();
  const lamports = parseNonNegativeInteger(params[1], 'lamports');

  ledger.creditLamports(pubkey, BigInt(lamports));
  ledger.advanceSlot();

  const signature = bs58.encode(Buffer.from(nacl.randomBytes(64)));
  ledger.recordSignatureStatus(signature, null);
  return signature;
}

export function sendTransaction(params: unknown): string {
  return processSendTransaction(params);
}

export function getSignatureStatuses(params: unknown): {
  context: { slot: number };
  value: Array<ReturnType<typeof ledger.getSignatureStatus>>;
} {
  if (!Array.isArray(params) || params.length < 1 || !Array.isArray(params[0])) {
    throw new RpcError(-32602, 'getSignatureStatuses expects [[signatures...]]');
  }

  const signatures = params[0] as unknown[];

  const value = signatures.map((sig) => {
    if (typeof sig !== 'string') {
      throw new RpcError(-32602, 'signatures must be strings');
    }
    return ledger.getSignatureStatus(sig);
  });

  return {
    context: { slot: ledger.slot },
    value,
  };
}

export function handleRpcMethod(method: string, params: unknown): unknown {
  switch (method) {
    case 'getVersion':
      return getVersion();
    case 'getSlot':
      return getSlot();
    case 'getBlockHeight':
      return getBlockHeight();
    case 'getHealth':
      return getHealth();
    case 'getLatestBlockhash':
      return getLatestBlockhash();
    case 'getBalance':
      return getBalance(params);
    case 'getAccountInfo':
      return getAccountInfo(params);
    case 'getMinimumBalanceForRentExemption':
      return getMinimumBalanceForRentExemption(params);
    case 'getTokenAccountBalance':
      return getTokenAccountBalance(params);
    case 'getTokenAccountsByOwner':
      return getTokenAccountsByOwner(params);
    case 'requestAirdrop':
      return requestAirdrop(params);
    case 'sendTransaction':
      return sendTransaction(params);
    case 'getSignatureStatuses':
      return getSignatureStatuses(params);
    default:
      throw new RpcError(-32601, 'Method not found');
  }
}
