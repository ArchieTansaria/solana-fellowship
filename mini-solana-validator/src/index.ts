import express, { Request, Response } from 'express';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

const PORT = 3001;

const SYSTEM_PROGRAM_ID = SystemProgram.programId;
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const MINT_DATA_LEN = 82;
const TOKEN_ACCOUNT_DATA_LEN = 165;

type JsonRpcId = string | number | null;

interface RpcRequest {
  jsonrpc: string;
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface RpcErrorPayload {
  code: number;
  message: string;
}

interface AccountState {
  lamports: bigint;
  owner: string;
  data: Buffer;
  executable: boolean;
  rentEpoch: number;
}

interface SignatureStatus {
  slot: number;
  confirmations: null;
  err: null | string;
  confirmationStatus: 'confirmed';
}

interface InstructionAccountMeta {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

interface NormalizedInstruction {
  programId: PublicKey;
  accounts: InstructionAccountMeta[];
  data: Buffer;
}

interface ParsedWireTransaction {
  recentBlockhash: string;
  firstSignature: string;
  requiredSignerPubkeys: PublicKey[];
  signatures: Uint8Array[];
  messageBytes: Uint8Array;
  instructions: NormalizedInstruction[];
}

class RpcError extends Error {
  public readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

class InMemoryLedger {
  public slot = 0;
  public blockHeight = 0;

  private readonly accounts = new Map<string, AccountState>();
  private readonly issuedBlockhashes = new Map<string, number>();
  private readonly signatureStatuses = new Map<string, SignatureStatus>();

  public cloneAccounts(): Map<string, AccountState> {
    const snapshot = new Map<string, AccountState>();
    for (const [pubkey, account] of this.accounts.entries()) {
      snapshot.set(pubkey, {
        lamports: account.lamports,
        owner: account.owner,
        data: Buffer.from(account.data),
        executable: account.executable,
        rentEpoch: account.rentEpoch,
      });
    }
    return snapshot;
  }

  public restoreAccounts(snapshot: Map<string, AccountState>): void {
    this.accounts.clear();
    for (const [pubkey, account] of snapshot.entries()) {
      this.accounts.set(pubkey, {
        lamports: account.lamports,
        owner: account.owner,
        data: Buffer.from(account.data),
        executable: account.executable,
        rentEpoch: account.rentEpoch,
      });
    }
  }

  public getAccount(pubkey: string): AccountState | undefined {
    return this.accounts.get(pubkey);
  }

  public setAccount(pubkey: string, account: AccountState): void {
    this.accounts.set(pubkey, account);
  }

  public deleteAccount(pubkey: string): void {
    this.accounts.delete(pubkey);
  }

  public listAccounts(): Array<[string, AccountState]> {
    return Array.from(this.accounts.entries());
  }

  public getOrCreateSystemAccount(pubkey: string): AccountState {
    const existing = this.accounts.get(pubkey);
    if (existing) {
      return existing;
    }

    const created: AccountState = {
      lamports: 0n,
      owner: SYSTEM_PROGRAM_ID.toBase58(),
      data: Buffer.alloc(0),
      executable: false,
      rentEpoch: 0,
    };
    this.accounts.set(pubkey, created);
    return created;
  }

  public creditLamports(pubkey: string, lamports: bigint): void {
    const account = this.getOrCreateSystemAccount(pubkey);
    account.lamports += lamports;
  }

  public debitLamports(pubkey: string, lamports: bigint): void {
    const account = this.accounts.get(pubkey);
    if (!account || account.lamports < lamports) {
      throw new RpcError(-32003, 'Insufficient funds');
    }
    account.lamports -= lamports;
  }

  public advanceSlot(): void {
    this.slot += 1;
    this.blockHeight += 1;
  }

  public getRentExemptMinimum(dataSize: number): bigint {
    const size = Math.max(0, dataSize);
    return BigInt((size + 128) * 2);
  }

  public issueBlockhash(): { blockhash: string; lastValidBlockHeight: number } {
    this.pruneBlockhashes();

    let blockhash = '';
    do {
      blockhash = bs58.encode(Buffer.from(nacl.randomBytes(32)));
    } while (this.issuedBlockhashes.has(blockhash));

    const lastValidBlockHeight = this.blockHeight + 150;
    this.issuedBlockhashes.set(blockhash, lastValidBlockHeight);

    return { blockhash, lastValidBlockHeight };
  }

  public isKnownBlockhash(blockhash: string): boolean {
    return this.issuedBlockhashes.has(blockhash);
  }

  public recordSignatureStatus(signature: string, err: null | string): void {
    this.signatureStatuses.set(signature, {
      slot: this.slot,
      confirmations: null,
      err,
      confirmationStatus: 'confirmed',
    });
  }

  public getSignatureStatus(signature: string): SignatureStatus | null {
    return this.signatureStatuses.get(signature) ?? null;
  }

  private pruneBlockhashes(): void {
    for (const [hash, expiryHeight] of this.issuedBlockhashes.entries()) {
      if (expiryHeight < this.blockHeight - 200) {
        this.issuedBlockhashes.delete(hash);
      }
    }
  }
}

interface MintState {
  mintAuthority: string | null;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: string | null;
}

interface TokenAccountState {
  mint: string;
  owner: string;
  amount: bigint;
  state: number;
}

const ledger = new InMemoryLedger();

function asRpcError(error: unknown): RpcError {
  if (error instanceof RpcError) {
    return error;
  }

  if (error instanceof Error) {
    return new RpcError(-32003, error.message);
  }

  return new RpcError(-32003, 'Transaction failed');
}

function parsePubkey(value: unknown, fieldName: string): PublicKey {
  if (typeof value !== 'string') {
    throw new RpcError(-32602, `${fieldName} must be a base58 string`);
  }

  try {
    return new PublicKey(value);
  } catch {
    throw new RpcError(-32602, `${fieldName} is not a valid public key`);
  }
}

function parseNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new RpcError(-32602, `${fieldName} must be a non-negative integer`);
  }

  return value;
}

function parseBase64(value: unknown, fieldName: string): Buffer {
  if (typeof value !== 'string') {
    throw new RpcError(-32602, `${fieldName} must be base64`);
  }

  try {
    return Buffer.from(value, 'base64');
  } catch {
    throw new RpcError(-32602, `${fieldName} must be base64`);
  }
}

function readU64LE(data: Buffer, offset: number): bigint {
  if (offset + 8 > data.length) {
    throw new RpcError(-32003, 'Instruction data is too short');
  }
  return data.readBigUInt64LE(offset);
}

function writeU64LE(buffer: Buffer, offset: number, value: bigint): void {
  buffer.writeBigUInt64LE(value, offset);
}

function toUiLamports(value: bigint): number {
  return Number(value);
}

function accountToRpcInfo(account: AccountState): {
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

function decodeMintData(data: Buffer): MintState {
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

function encodeMintData(target: Buffer, state: MintState): void {
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

function decodeTokenAccountData(data: Buffer): TokenAccountState {
  if (data.length < TOKEN_ACCOUNT_DATA_LEN) {
    throw new RpcError(-32003, 'Invalid token account size');
  }

  const mint = new PublicKey(data.subarray(0, 32)).toBase58();
  const owner = new PublicKey(data.subarray(32, 64)).toBase58();
  const amount = readU64LE(data, 64);
  const state = data.readUInt8(108);

  return { mint, owner, amount, state };
}

function encodeTokenAccountData(target: Buffer, state: TokenAccountState): void {
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

function requireSigner(meta: InstructionAccountMeta, label: string): void {
  if (!meta.isSigner) {
    throw new RpcError(-32003, `${label} must sign`);
  }
}

function requireAccount(pubkey: string): AccountState {
  const account = ledger.getAccount(pubkey);
  if (!account) {
    throw new RpcError(-32003, `Account ${pubkey} does not exist`);
  }
  return account;
}

function requireTokenProgramOwned(pubkey: string, minSize: number): AccountState {
  const account = requireAccount(pubkey);
  if (account.owner !== TOKEN_PROGRAM_ID.toBase58() || account.data.length < minSize) {
    throw new RpcError(-32003, `Account ${pubkey} is not a valid token program account`);
  }
  return account;
}

function deserializeTransactionFromWire(encodedTx: string): ParsedWireTransaction {
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

function normalizeLegacyTransaction(tx: Transaction): ParsedWireTransaction {
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

function normalizeVersionedTransaction(versionedTx: VersionedTransaction): ParsedWireTransaction {
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

function verifyTransactionSignatures(parsedTx: ParsedWireTransaction): void {
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

function executeSystemInstruction(ix: NormalizedInstruction): void {
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

function executeTokenInstruction(ix: NormalizedInstruction): void {
  if (ix.data.length < 1) {
    throw new RpcError(-32003, 'Invalid token instruction data');
  }

  const discriminator = ix.data.readUInt8(0);

  if (discriminator === 20) {
    if (ix.accounts.length < 1 || ix.data.length < 35) {
      throw new RpcError(-32003, 'Invalid InitializeMint2 instruction');
    }

    const mintPubkey = ix.accounts[0].pubkey.toBase58();
    const mintAccount = requireTokenProgramOwned(mintPubkey, MINT_DATA_LEN);
    const mintState = decodeMintData(mintAccount.data);

    if (mintState.isInitialized) {
      throw new RpcError(-32003, 'Mint already initialized');
    }

    const decimals = ix.data.readUInt8(1);
    const mintAuthority = new PublicKey(ix.data.subarray(2, 34)).toBase58();
    const hasFreezeAuthority = ix.data.readUInt8(34) === 1;
    let freezeAuthority: string | null = null;
    if (hasFreezeAuthority) {
      if (ix.data.length < 67) {
        throw new RpcError(-32003, 'Invalid InitializeMint2 freeze authority payload');
      }
      freezeAuthority = new PublicKey(ix.data.subarray(35, 67)).toBase58();
    }

    encodeMintData(mintAccount.data, {
      mintAuthority,
      supply: 0n,
      decimals,
      isInitialized: true,
      freezeAuthority,
    });
    return;
  }

  if (discriminator === 18) {
    if (ix.accounts.length < 2 || ix.data.length < 33) {
      throw new RpcError(-32003, 'Invalid InitializeAccount3 instruction');
    }

    const tokenAccountPubkey = ix.accounts[0].pubkey.toBase58();
    const mintPubkey = ix.accounts[1].pubkey.toBase58();

    const tokenAccount = requireTokenProgramOwned(tokenAccountPubkey, TOKEN_ACCOUNT_DATA_LEN);
    const mintAccount = requireTokenProgramOwned(mintPubkey, MINT_DATA_LEN);
    const mintState = decodeMintData(mintAccount.data);

    if (!mintState.isInitialized) {
      throw new RpcError(-32003, 'Mint is not initialized');
    }

    const currentTokenState = decodeTokenAccountData(tokenAccount.data);
    if (currentTokenState.state === 1) {
      throw new RpcError(-32003, 'Token account already initialized');
    }

    const owner = new PublicKey(ix.data.subarray(1, 33)).toBase58();

    encodeTokenAccountData(tokenAccount.data, {
      mint: mintPubkey,
      owner,
      amount: 0n,
      state: 1,
    });
    return;
  }

  if (discriminator === 7) {
    if (ix.accounts.length < 3 || ix.data.length < 9) {
      throw new RpcError(-32003, 'Invalid MintTo instruction');
    }

    const mintPubkey = ix.accounts[0].pubkey.toBase58();
    const destinationPubkey = ix.accounts[1].pubkey.toBase58();
    const authorityMeta = ix.accounts[2];

    requireSigner(authorityMeta, 'MintTo authority');

    const mintAccount = requireTokenProgramOwned(mintPubkey, MINT_DATA_LEN);
    const destinationAccount = requireTokenProgramOwned(destinationPubkey, TOKEN_ACCOUNT_DATA_LEN);

    const mintState = decodeMintData(mintAccount.data);
    const destinationState = decodeTokenAccountData(destinationAccount.data);

    if (!mintState.isInitialized) {
      throw new RpcError(-32003, 'Mint is not initialized');
    }

    if (destinationState.state !== 1) {
      throw new RpcError(-32003, 'Destination token account is not initialized');
    }

    if (destinationState.mint !== mintPubkey) {
      throw new RpcError(-32003, 'Destination token account mint does not match');
    }

    const authorityPubkey = authorityMeta.pubkey.toBase58();
    if (!mintState.mintAuthority || mintState.mintAuthority !== authorityPubkey) {
      throw new RpcError(-32003, 'MintTo authority mismatch');
    }

    const amount = readU64LE(ix.data, 1);

    destinationState.amount += amount;
    mintState.supply += amount;

    encodeTokenAccountData(destinationAccount.data, destinationState);
    encodeMintData(mintAccount.data, mintState);
    return;
  }

  if (discriminator === 3) {
    if (ix.accounts.length < 3 || ix.data.length < 9) {
      throw new RpcError(-32003, 'Invalid Token Transfer instruction');
    }

    const sourcePubkey = ix.accounts[0].pubkey.toBase58();
    const destinationPubkey = ix.accounts[1].pubkey.toBase58();
    const ownerMeta = ix.accounts[2];

    requireSigner(ownerMeta, 'Token transfer owner');

    const sourceAccount = requireTokenProgramOwned(sourcePubkey, TOKEN_ACCOUNT_DATA_LEN);
    const destinationAccount = requireTokenProgramOwned(destinationPubkey, TOKEN_ACCOUNT_DATA_LEN);

    const sourceState = decodeTokenAccountData(sourceAccount.data);
    const destinationState = decodeTokenAccountData(destinationAccount.data);

    if (sourceState.state !== 1 || destinationState.state !== 1) {
      throw new RpcError(-32003, 'Source or destination token account is not initialized');
    }

    if (sourceState.owner !== ownerMeta.pubkey.toBase58()) {
      throw new RpcError(-32003, 'Token transfer owner mismatch');
    }

    if (sourceState.mint !== destinationState.mint) {
      throw new RpcError(-32003, 'Token transfer mint mismatch');
    }

    const amount = readU64LE(ix.data, 1);
    if (sourceState.amount < amount) {
      throw new RpcError(-32003, 'Insufficient token balance');
    }

    sourceState.amount -= amount;
    destinationState.amount += amount;

    encodeTokenAccountData(sourceAccount.data, sourceState);
    encodeTokenAccountData(destinationAccount.data, destinationState);
    return;
  }

  if (discriminator === 12) {
    if (ix.accounts.length < 4 || ix.data.length < 10) {
      throw new RpcError(-32003, 'Invalid TransferChecked instruction');
    }

    const sourcePubkey = ix.accounts[0].pubkey.toBase58();
    const mintPubkey = ix.accounts[1].pubkey.toBase58();
    const destinationPubkey = ix.accounts[2].pubkey.toBase58();
    const ownerMeta = ix.accounts[3];

    requireSigner(ownerMeta, 'TransferChecked owner');

    const sourceAccount = requireTokenProgramOwned(sourcePubkey, TOKEN_ACCOUNT_DATA_LEN);
    const destinationAccount = requireTokenProgramOwned(destinationPubkey, TOKEN_ACCOUNT_DATA_LEN);
    const mintAccount = requireTokenProgramOwned(mintPubkey, MINT_DATA_LEN);

    const sourceState = decodeTokenAccountData(sourceAccount.data);
    const destinationState = decodeTokenAccountData(destinationAccount.data);
    const mintState = decodeMintData(mintAccount.data);

    if (sourceState.state !== 1 || destinationState.state !== 1 || !mintState.isInitialized) {
      throw new RpcError(-32003, 'TransferChecked account state invalid');
    }

    if (sourceState.owner !== ownerMeta.pubkey.toBase58()) {
      throw new RpcError(-32003, 'TransferChecked owner mismatch');
    }

    if (sourceState.mint !== mintPubkey || destinationState.mint !== mintPubkey) {
      throw new RpcError(-32003, 'TransferChecked mint mismatch');
    }

    const amount = readU64LE(ix.data, 1);
    const decimals = ix.data.readUInt8(9);

    if (decimals !== mintState.decimals) {
      throw new RpcError(-32003, 'TransferChecked decimals mismatch');
    }

    if (sourceState.amount < amount) {
      throw new RpcError(-32003, 'Insufficient token balance');
    }

    sourceState.amount -= amount;
    destinationState.amount += amount;

    encodeTokenAccountData(sourceAccount.data, sourceState);
    encodeTokenAccountData(destinationAccount.data, destinationState);
    return;
  }

  if (discriminator === 8) {
    if (ix.accounts.length < 3 || ix.data.length < 9) {
      throw new RpcError(-32003, 'Invalid Burn instruction');
    }

    const tokenAccountPubkey = ix.accounts[0].pubkey.toBase58();
    const mintPubkey = ix.accounts[1].pubkey.toBase58();
    const ownerMeta = ix.accounts[2];

    requireSigner(ownerMeta, 'Burn owner');

    const tokenAccount = requireTokenProgramOwned(tokenAccountPubkey, TOKEN_ACCOUNT_DATA_LEN);
    const mintAccount = requireTokenProgramOwned(mintPubkey, MINT_DATA_LEN);

    const tokenState = decodeTokenAccountData(tokenAccount.data);
    const mintState = decodeMintData(mintAccount.data);

    if (tokenState.owner !== ownerMeta.pubkey.toBase58()) {
      throw new RpcError(-32003, 'Burn owner mismatch');
    }

    if (tokenState.mint !== mintPubkey) {
      throw new RpcError(-32003, 'Burn mint mismatch');
    }

    const amount = readU64LE(ix.data, 1);

    if (tokenState.amount < amount) {
      throw new RpcError(-32003, 'Insufficient token balance');
    }

    if (mintState.supply < amount) {
      throw new RpcError(-32003, 'Mint supply underflow');
    }

    tokenState.amount -= amount;
    mintState.supply -= amount;

    encodeTokenAccountData(tokenAccount.data, tokenState);
    encodeMintData(mintAccount.data, mintState);
    return;
  }

  if (discriminator === 9) {
    if (ix.accounts.length < 3) {
      throw new RpcError(-32003, 'Invalid CloseAccount instruction');
    }

    const tokenAccountPubkey = ix.accounts[0].pubkey.toBase58();
    const destinationPubkey = ix.accounts[1].pubkey.toBase58();
    const ownerMeta = ix.accounts[2];

    requireSigner(ownerMeta, 'CloseAccount owner');

    const tokenAccount = requireTokenProgramOwned(tokenAccountPubkey, TOKEN_ACCOUNT_DATA_LEN);
    const tokenState = decodeTokenAccountData(tokenAccount.data);

    if (tokenState.owner !== ownerMeta.pubkey.toBase58()) {
      throw new RpcError(-32003, 'CloseAccount owner mismatch');
    }

    if (tokenState.amount !== 0n) {
      throw new RpcError(-32003, 'Cannot close non-empty token account');
    }

    const reclaimedLamports = tokenAccount.lamports;
    ledger.deleteAccount(tokenAccountPubkey);
    ledger.creditLamports(destinationPubkey, reclaimedLamports);
    return;
  }

  throw new RpcError(-32003, `Unsupported Token Program instruction: ${discriminator}`);
}

function executeAtaInstruction(ix: NormalizedInstruction): void {
  if (!(ix.data.length === 0 || (ix.data.length >= 1 && ix.data.readUInt8(0) === 0))) {
    throw new RpcError(-32003, 'Unsupported ATA instruction');
  }

  if (ix.accounts.length < 6) {
    throw new RpcError(-32003, 'Invalid ATA Create instruction');
  }

  const payerMeta = ix.accounts[0];
  const ataMeta = ix.accounts[1];
  const ownerMeta = ix.accounts[2];
  const mintMeta = ix.accounts[3];
  const systemProgramMeta = ix.accounts[4];
  const tokenProgramMeta = ix.accounts[5];

  requireSigner(payerMeta, 'ATA payer');

  if (!systemProgramMeta.pubkey.equals(SYSTEM_PROGRAM_ID)) {
    throw new RpcError(-32003, 'ATA create passed wrong system program');
  }

  if (!tokenProgramMeta.pubkey.equals(TOKEN_PROGRAM_ID)) {
    throw new RpcError(-32003, 'ATA create passed wrong token program');
  }

  const ownerPubkey = ownerMeta.pubkey;
  const mintPubkey = mintMeta.pubkey;
  const ataPubkey = ataMeta.pubkey;

  const [derivedAta] = PublicKey.findProgramAddressSync(
    [ownerPubkey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
    ATA_PROGRAM_ID,
  );

  if (!derivedAta.equals(ataPubkey)) {
    throw new RpcError(-32003, 'ATA address does not match PDA derivation');
  }

  const existingAta = ledger.getAccount(ataPubkey.toBase58());
  if (existingAta && (existingAta.lamports > 0n || existingAta.data.length > 0)) {
    throw new RpcError(-32003, 'Associated token account already exists');
  }

  const mintAccount = requireTokenProgramOwned(mintPubkey.toBase58(), MINT_DATA_LEN);
  const mintState = decodeMintData(mintAccount.data);
  if (!mintState.isInitialized) {
    throw new RpcError(-32003, 'Mint is not initialized');
  }

  const rent = ledger.getRentExemptMinimum(TOKEN_ACCOUNT_DATA_LEN);
  const payerPubkey = payerMeta.pubkey.toBase58();
  ledger.debitLamports(payerPubkey, rent);

  const tokenData = Buffer.alloc(TOKEN_ACCOUNT_DATA_LEN);
  encodeTokenAccountData(tokenData, {
    mint: mintPubkey.toBase58(),
    owner: ownerPubkey.toBase58(),
    amount: 0n,
    state: 1,
  });

  ledger.setAccount(ataPubkey.toBase58(), {
    lamports: rent,
    owner: TOKEN_PROGRAM_ID.toBase58(),
    data: tokenData,
    executable: false,
    rentEpoch: 0,
  });
}

function executeInstruction(ix: NormalizedInstruction): void {
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

function processSendTransaction(params: unknown): string {
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

function handleRpcMethod(method: string, params: unknown): unknown {
  switch (method) {
    case 'getVersion': {
      return {
        'solana-core': '1.18.0-mini-validator',
        'feature-set': 1,
      };
    }

    case 'getSlot': {
      return ledger.slot;
    }

    case 'getBlockHeight': {
      return ledger.blockHeight;
    }

    case 'getHealth': {
      return 'ok';
    }

    case 'getLatestBlockhash': {
      const value = ledger.issueBlockhash();
      return {
        context: { slot: ledger.slot },
        value,
      };
    }

    case 'getBalance': {
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

    case 'getAccountInfo': {
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

    case 'getMinimumBalanceForRentExemption': {
      if (!Array.isArray(params) || params.length < 1) {
        throw new RpcError(-32602, 'getMinimumBalanceForRentExemption expects [dataSize]');
      }

      const dataSize = parseNonNegativeInteger(params[0], 'dataSize');
      return toUiLamports(ledger.getRentExemptMinimum(dataSize));
    }

    case 'getTokenAccountBalance': {
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

    case 'getTokenAccountsByOwner': {
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

    case 'requestAirdrop': {
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

    case 'sendTransaction': {
      return processSendTransaction(params);
    }

    case 'getSignatureStatuses': {
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

    default:
      throw new RpcError(-32601, 'Method not found');
  }
}

function validateRpcRequest(body: unknown): RpcRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new RpcError(-32600, 'Invalid request');
  }

  const req = body as Partial<RpcRequest>;

  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string' || !('id' in req)) {
    throw new RpcError(-32600, 'Invalid request');
  }

  return {
    jsonrpc: req.jsonrpc,
    id: req.id as JsonRpcId,
    method: req.method,
    params: req.params,
  };
}

function sendRpcResult(res: Response, id: JsonRpcId, result: unknown): void {
  res.status(200).json({ jsonrpc: '2.0', id, result });
}

function sendRpcError(res: Response, id: JsonRpcId, error: RpcErrorPayload): void {
  res.status(200).json({ jsonrpc: '2.0', id, error });
}

const app = express();

app.use(express.json({ limit: '2mb' }));

app.post('/', (req: Request, res: Response) => {
  let id: JsonRpcId = null;

  try {
    const rpcRequest = validateRpcRequest(req.body);
    id = rpcRequest.id;
    const result = handleRpcMethod(rpcRequest.method, rpcRequest.params);
    sendRpcResult(res, id, result);
  } catch (error) {
    const rpcError = asRpcError(error);

    const code =
      rpcError.code === -32601 ||
      rpcError.code === -32600 ||
      rpcError.code === -32602 ||
      rpcError.code === -32003
        ? rpcError.code
        : -32003;

    sendRpcError(res, id, {
      code,
      message: rpcError.message,
    });
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: () => void) => {
  if (error instanceof SyntaxError) {
    sendRpcError(res, null, {
      code: -32600,
      message: 'Invalid request',
    });
    return;
  }

  const rpcError = asRpcError(error);
  sendRpcError(res, null, {
    code: rpcError.code,
    message: rpcError.message,
  });
});

app.listen(PORT, () => {
  console.log(`Mini Solana Validator running on port ${PORT}`);
});
