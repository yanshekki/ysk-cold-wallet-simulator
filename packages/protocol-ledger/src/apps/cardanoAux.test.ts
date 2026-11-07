import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { ed25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2b';
import { describe, expect, it } from 'vitest';
import { concatBytes } from '../bytes';
import { deriveIcarus, signIcarus } from './icarus';
import type { FamilyContext } from './generic';
import {
  cvoteAuxCbor,
  cvoteAuxHash,
  cvotePayloadCbor,
  cvotePayloadHash,
  cvoteSignedPayloadCbor,
  finalizeCip36,
  parseV8Cip36Delegation,
  parseV8Cip36Init,
} from './cardanoAux';

const FOUNDATION = 'test test test test test test test test test test test junk';

function u16(value: number): Uint8Array {
  return Uint8Array.of((value >> 8) & 0xff, value & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rest = value;
  for (let index = 7; index >= 0; index -= 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function path(parts: number[]): Uint8Array {
  const bytes = [parts.length];
  for (const part of parts) {
    bytes.push((part >>> 24) & 0xff, (part >>> 16) & 0xff, (part >>> 8) & 0xff, part & 0xff);
  }
  return Uint8Array.from(bytes);
}

/** Independent CBOR writer. It is not the implementation under test. */
function cborUnsigned(value: bigint): Uint8Array {
  if (value < 24n) return Uint8Array.of(Number(value));
  if (value < 256n) return Uint8Array.of(0x18, Number(value));
  if (value < 65536n) return Uint8Array.of(0x19, Number((value >> 8n) & 0xffn), Number(value & 0xffn));
  return Uint8Array.of(
    0x1a,
    Number((value >> 24n) & 0xffn),
    Number((value >> 16n) & 0xffn),
    Number((value >> 8n) & 0xffn),
    Number(value & 0xffn),
  );
}

function cborMajor(major: number, value: bigint): Uint8Array {
  const head = cborUnsigned(value);
  const out = new Uint8Array(head);
  out[0] = (out[0] ?? 0) | (major << 5);
  return out;
}

function cborBytes(data: Uint8Array): Uint8Array {
  return concatBytes(cborMajor(2, BigInt(data.length)), data);
}

function ctx(): FamilyContext {
  return {
    confirmation: {
      async confirm() {
        return true;
      },
      async getPassphrase() {
        return undefined;
      },
    },
    slotId: 'slot',
    entropy: mnemonicToEntropy(FOUNDATION, wordlist),
  };
}

const STAKE_PATH = "m/1852'/1815'/0'/2/0";
const STAKE_COMPONENTS = [0x8000073c, 0x80000717, 0x80000000, 2, 0];
const VOTE_KEY = new Uint8Array(32).fill(0x42);
const PAYMENT = concatBytes(Uint8Array.of(0x61), new Uint8Array(28).fill(0x22));
const NONCE = 123n;
const PURPOSE = 0n;

function expectedPayload(stakingPub: Uint8Array, voteField: Uint8Array): Uint8Array {
  return concatBytes(
    cborMajor(5, 5n),
    cborUnsigned(1n),
    voteField,
    cborUnsigned(2n),
    cborBytes(stakingPub),
    cborUnsigned(3n),
    cborBytes(PAYMENT),
    cborUnsigned(4n),
    cborUnsigned(NONCE),
    cborUnsigned(5n),
    cborUnsigned(PURPOSE),
  );
}

describe('CIP-36 auxiliary CBOR (aux_data_hash_builder.c)', () => {
  it('wraps the payload in 61284 before hashing, not the payload map alone', () => {
    const staking = deriveIcarus(ctx().entropy, STAKE_PATH);
    const voteField = cborBytes(VOTE_KEY);
    const payload = expectedPayload(staking.publicKey, voteField);
    const signed = concatBytes(cborMajor(5, 1n), cborUnsigned(61284n), payload);
    const reg = {
      format: 2 as const,
      voteKey: VOTE_KEY,
      stakingPubKey: staking.publicKey,
      paymentAddress: PAYMENT,
      nonce: NONCE,
      votingPurpose: PURPOSE,
    };
    expect(Array.from(cvotePayloadCbor(reg) ?? new Uint8Array())).toEqual(Array.from(payload));
    expect(Array.from(cvoteSignedPayloadCbor(reg) ?? new Uint8Array())).toEqual(Array.from(signed));
    const wrapped = blake2b(signed, { dkLen: 32 });
    const naked = blake2b(payload, { dkLen: 32 });
    expect(Array.from(cvotePayloadHash(reg) ?? new Uint8Array())).toEqual(Array.from(wrapped));
    expect(Array.from(wrapped)).not.toEqual(Array.from(naked));
    const signature = signIcarus(staking, wrapped);
    expect(ed25519.verify(signature, wrapped, staking.publicKey)).toBe(true);
    expect(ed25519.verify(signature, naked, staking.publicKey)).toBe(false);
    const aux = concatBytes(
      cborMajor(4, 2n),
      cborMajor(5, 2n),
      cborUnsigned(61284n),
      payload,
      cborUnsigned(61285n),
      cborMajor(5, 1n),
      cborUnsigned(1n),
      cborBytes(signature),
      cborMajor(4, 0n),
    );
    expect(Array.from(cvoteAuxCbor(reg, signature) ?? new Uint8Array())).toEqual(Array.from(aux));
    expect(Array.from(cvoteAuxHash(reg, signature) ?? new Uint8Array())).toEqual(
      Array.from(blake2b(aux, { dkLen: 32 })),
    );
  });

  it('encodes a CIP-36 delegation list in field 1', () => {
    const staking = deriveIcarus(ctx().entropy, STAKE_PATH);
    const other = new Uint8Array(32).fill(0x43);
    const voteField = concatBytes(
      cborMajor(4, 1n),
      cborMajor(4, 2n),
      cborBytes(other),
      cborUnsigned(7n),
    );
    const payload = expectedPayload(staking.publicKey, voteField);
    const reg = {
      format: 2 as const,
      delegations: [{ voteKey: other, weight: 7 }],
      stakingPubKey: staking.publicKey,
      paymentAddress: PAYMENT,
      nonce: NONCE,
      votingPurpose: PURPOSE,
    };
    expect(Array.from(cvotePayloadCbor(reg) ?? new Uint8Array())).toEqual(Array.from(payload));
  });

  it('parses a v8 0-delegation INIT and returns the Catalyst aux hash', async () => {
    const staking = deriveIcarus(ctx().entropy, STAKE_PATH);
    const data = concatBytes(
      Uint8Array.of(2),
      u16(0),
      Uint8Array.of(2),
      path(STAKE_COMPONENTS),
      Uint8Array.of(1),
      u16(PAYMENT.length),
      PAYMENT,
      u64(NONCE),
      u64(PURPOSE),
      Uint8Array.of(0),
      VOTE_KEY,
    );
    const parsed = await parseV8Cip36Init(data, ctx());
    expect(parsed).not.toBeNull();
    expect(parsed!.remaining).toBe(0);
    expect(parsed!.stakingPath).toBe(STAKE_PATH);
    const result = await finalizeCip36(parsed!, ctx());
    expect(result).not.toBeNull();
    const payload = expectedPayload(staking.publicKey, cborBytes(VOTE_KEY));
    const wrapped = blake2b(concatBytes(cborMajor(5, 1n), cborUnsigned(61284n), payload), { dkLen: 32 });
    expect(Array.from(result!.signature)).toEqual(Array.from(signIcarus(staking, wrapped)));
    expect(ed25519.verify(result!.signature, wrapped, staking.publicKey)).toBe(true);
    expect(ed25519.verify(result!.signature, blake2b(payload, { dkLen: 32 }), staking.publicKey)).toBe(false);
    expect(ed25519.verify(result!.signature, blake2b(data, { dkLen: 32 }), staking.publicKey)).toBe(false);
  });

  it('parses a v8 delegation APDU after INIT remaining 1', async () => {
    const init = concatBytes(
      Uint8Array.of(2),
      u16(1),
      Uint8Array.of(2),
      path(STAKE_COMPONENTS),
      Uint8Array.of(1),
      u16(PAYMENT.length),
      PAYMENT,
      u64(NONCE),
      u64(PURPOSE),
    );
    const parsed = await parseV8Cip36Init(init, ctx());
    expect(parsed?.remaining).toBe(1);
    expect(parsed?.voteKey).toBeUndefined();
    const delegation = await parseV8Cip36Delegation(concatBytes(Uint8Array.of(0), VOTE_KEY, u32(9)), ctx());
    expect(delegation).toEqual({ voteKey: VOTE_KEY, weight: 9 });
  });
});
