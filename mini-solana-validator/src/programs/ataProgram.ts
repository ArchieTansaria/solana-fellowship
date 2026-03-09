import { PublicKey } from '@solana/web3.js';
import { ledger } from '../ledger/ledger';
import { requireSigner, requireTokenProgramOwned, type NormalizedInstruction } from '../ledger/accounts';
import { RpcError } from '../rpc/errors';
import { ATA_PROGRAM_ID, MINT_DATA_LEN, SYSTEM_PROGRAM_ID, TOKEN_ACCOUNT_DATA_LEN, TOKEN_PROGRAM_ID } from '../utils/constants';
import { decodeMintData, encodeTokenAccountData } from '../utils/accountSerialization';

export function executeAtaInstruction(ix: NormalizedInstruction): void {
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

export { ATA_PROGRAM_ID };
