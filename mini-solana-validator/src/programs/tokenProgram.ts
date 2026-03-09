import { PublicKey } from '@solana/web3.js';
import { ledger } from '../ledger/ledger';
import {
  requireSigner,
  requireTokenProgramOwned,
  type NormalizedInstruction,
} from '../ledger/accounts';
import { RpcError } from '../rpc/errors';
import { MINT_DATA_LEN, TOKEN_ACCOUNT_DATA_LEN, TOKEN_PROGRAM_ID } from '../utils/constants';
import {
  decodeMintData,
  decodeTokenAccountData,
  encodeMintData,
  encodeTokenAccountData,
} from '../utils/accountSerialization';
import { readU64LE } from '../utils/encoding';

export function executeTokenInstruction(ix: NormalizedInstruction): void {
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

export { TOKEN_PROGRAM_ID };
