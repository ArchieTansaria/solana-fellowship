import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { AccountState, SignatureStatus } from './accounts';
import { SYSTEM_PROGRAM_ID } from '../utils/constants';
import { RpcError } from '../rpc/errors';

export class InMemoryLedger {
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

export const ledger = new InMemoryLedger();
