import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { concatBytes } from '../bytes';
import {
  checkSolanaSysvarAccounts,
  encodeLegacyStakeInitialize,
  encodeLegacySystemTransfer,
  encodeV1SystemTransfer,
  parseSolanaTransaction,
  SOLANA_CLOCK_SYSVAR_ID,
  SOLANA_RENT_SYSVAR_ID,
  validateTrezorSolanaTransaction,
} from './solanaTx';

const PAYER = Uint8Array.from({ length: 32 }, (_, index) => (index === 0 ? 1 : 0));
const RECIPIENT = Uint8Array.from({ length: 32 }, (_, index) => (index === 0 ? 2 : 0));
const BLOCKHASH = Uint8Array.from({ length: 32 }, (_, index) => (index === 31 ? 3 : 0));
const LAMPORTS = 1_000_000_000n;
const PRIORITY_FEE = 123456789n;

describe('Solana SIMD-0385 v1 and sysvar slots (trezor-firmware core/v2.13.1)', () => {
  it('parses a v1 system transfer and keeps the priority-fee config', () => {
    const serialized = encodeV1SystemTransfer({
      payer: PAYER,
      recipient: RECIPIENT,
      lamports: LAMPORTS,
      priorityFee: PRIORITY_FEE,
      blockhash: BLOCKHASH,
    });
    const parsed = parseSolanaTransaction(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
    expect(parsed!.configPriorityFee).toBe(PRIORITY_FEE);
    expect(Array.from(parsed!.blockhash)).toEqual(Array.from(BLOCKHASH));
    expect(parsed!.instructions).toHaveLength(1);
    expect(parsed!.instructions[0]!.programIndex).toBe(2);
    expect(parsed!.instructions[0]!.accounts).toEqual([0, 1]);
    expect(validateTrezorSolanaTransaction(serialized)).toBe(true);
  });

  it('parses the existing legacy transfer fixture', () => {
    const serialized = encodeLegacySystemTransfer({
      payer: PAYER,
      recipient: RECIPIENT,
      lamports: LAMPORTS,
      blockhash: new Uint8Array(32),
    });
    const parsed = parseSolanaTransaction(serialized);
    expect(parsed?.version).toBeNull();
    expect(parsed?.instructions).toHaveLength(1);
    expect(validateTrezorSolanaTransaction(serialized)).toBe(true);
  });

  it('rejects version 2 as Trezor DataError("Invalid transaction")', () => {
    const v2 = concatBytes(Uint8Array.of(0x82, 1, 0, 0), new Uint8Array(64));
    expect(parseSolanaTransaction(v2)).toBeNull();
    expect(validateTrezorSolanaTransaction(v2)).toBe(false);
  });

  it('rejects a truncated v1 header', () => {
    expect(parseSolanaTransaction(Uint8Array.of(0x81, 1, 0))).toBeNull();
    expect(validateTrezorSolanaTransaction(Uint8Array.of(0x81, 1, 0))).toBe(false);
  });

  it('rejects non-canonical compact-u16 aliases', () => {
    const alias = concatBytes(
      Uint8Array.of(1, 0, 1, 0x81, 0x00),
      PAYER,
      new Uint8Array(32),
      Uint8Array.of(0),
    );
    expect(parseSolanaTransaction(alias)).toBeNull();
  });

  it('rejects unknown v1 config bits', () => {
    const serialized = encodeV1SystemTransfer({
      payer: PAYER,
      recipient: RECIPIENT,
      lamports: LAMPORTS,
      priorityFee: PRIORITY_FEE,
      blockhash: BLOCKHASH,
    });
    serialized[4] = 0x20;
    expect(parseSolanaTransaction(serialized)).toBeNull();
    expect(validateTrezorSolanaTransaction(serialized)).toBe(false);
  });

  it('accepts stake Initialize when the rent sysvar slot holds SysvarRent', () => {
    const serialized = encodeLegacyStakeInitialize({
      stakeAccount: PAYER,
      sysvar: base58.decode(SOLANA_RENT_SYSVAR_ID),
    });
    expect(validateTrezorSolanaTransaction(serialized)).toBe(true);
  });

  it('rejects a different account in the rent sysvar slot', () => {
    const serialized = encodeLegacyStakeInitialize({
      stakeAccount: PAYER,
      sysvar: base58.decode(SOLANA_CLOCK_SYSVAR_ID),
    });
    const parsed = parseSolanaTransaction(serialized);
    expect(parsed).not.toBeNull();
    expect(checkSolanaSysvarAccounts(parsed!)).toBe(false);
    expect(validateTrezorSolanaTransaction(serialized)).toBe(false);
  });

  it('rejects a lookup-table reference in a sysvar slot', () => {
    const serialized = encodeLegacyStakeInitialize({
      stakeAccount: PAYER,
      sysvar: base58.decode(SOLANA_RENT_SYSVAR_ID),
      lookups: { table: new Uint8Array(32).fill(9), rw: [0] },
    });
    const parsed = parseSolanaTransaction(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(0);
    expect(parsed!.lookupTableCount).toBe(1);
    expect(checkSolanaSysvarAccounts(parsed!)).toBe(false);
    expect(validateTrezorSolanaTransaction(serialized)).toBe(false);
  });

  it('signs the v1 bytes, not a re-encoded legacy body', () => {
    const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const serialized = encodeV1SystemTransfer({
      payer: ed25519.getPublicKey(privateKey),
      recipient: RECIPIENT,
      lamports: LAMPORTS,
      priorityFee: PRIORITY_FEE,
      blockhash: BLOCKHASH,
    });
    const signature = ed25519.sign(serialized, privateKey);
    expect(ed25519.verify(signature, serialized, ed25519.getPublicKey(privateKey))).toBe(true);
    const legacy = encodeLegacySystemTransfer({
      payer: ed25519.getPublicKey(privateKey),
      recipient: RECIPIENT,
      lamports: LAMPORTS,
      blockhash: BLOCKHASH,
    });
    expect(ed25519.verify(signature, legacy, ed25519.getPublicKey(privateKey))).toBe(false);
  });
});
