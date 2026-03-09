import { PublicKey, SystemProgram } from '@solana/web3.js';

export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export const MINT_DATA_LEN = 82;
export const TOKEN_ACCOUNT_DATA_LEN = 165;
