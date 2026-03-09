import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint,
  createAccount,
  mintTo,
  transfer,
  burn,
  closeAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';

async function main() {
  const connection = new Connection('http://localhost:3001', { commitment: 'confirmed' });
  
  const version = await connection.getVersion();
  console.log('Version:', version);

  const payer = Keypair.generate();
  console.log('Requesting airdrop for', payer.publicKey.toBase58());
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
  console.log('Airdrop requested', airdropSig);

  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature: airdropSig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  });
  
  console.log('Airdrop confirmed');
  const balance = await connection.getBalance(payer.publicKey);
  console.log('Payer balance:', balance);

  const receiver = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: receiver.publicKey,
      lamports: 1000,
    })
  );
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer);

  console.log('Sending transfer tx...');
  const txHash = await connection.sendTransaction(tx, [payer], { skipPreflight: true });
  console.log('Transfer hash:', txHash);
  await connection.confirmTransaction({
    signature: txHash,
    blockhash: tx.recentBlockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  });
  console.log('Transfer complete');

  console.log('Creating mint...');
  const mintAuthority = Keypair.generate();
  const mint = await createMint(
    connection,
    payer,
    mintAuthority.publicKey,
    null,
    9,
    Keypair.generate(),
    { commitment: 'confirmed' }
  ).catch(e => {
    console.error("Create mint failed", e);
    throw e;
  });
  console.log('Mint:', mint.toBase58());

  console.log('Getting ATA address...');
  const ata = await getAssociatedTokenAddress(mint, payer.publicKey);
  console.log('ATA:', ata.toBase58());

  console.log('Creating ATA...');
  const ataTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      payer.publicKey,
      mint
    )
  );
  ataTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  ataTx.sign(payer);
  const ataTxHash = await connection.sendTransaction(ataTx, [payer], { skipPreflight: true });
  await connection.confirmTransaction({
    signature: ataTxHash,
    blockhash: ataTx.recentBlockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  });
  console.log('ATA created.');

  console.log('Minting tokens...');
  await mintTo(
    connection,
    payer,
    mint,
    ata,
    mintAuthority,
    100
  );
  console.log('Tokens minted.');

  const tokenBalance = await connection.getTokenAccountBalance(ata);
  console.log('Token balance:', tokenBalance.value);

  const accounts = await connection.getTokenAccountsByOwner(payer.publicKey, { mint });
  console.log('Accounts count:', accounts.value.length);

  console.log('Burning tokens...');
  await burn(
    connection,
    payer,
    ata,
    mint,
    payer.publicKey,
    50
  );
  console.log('Tokens burned.');

  console.log('Closing account...');
  // first empty the account
  await burn(
    connection,
    payer,
    ata,
    mint,
    payer.publicKey,
    50
  );
  await closeAccount(
    connection,
    payer,
    ata,
    payer.publicKey,
    payer.publicKey
  );
  console.log('Account closed.');
  
  console.log('All tests passed successfully.');
}

main().catch(console.error);
