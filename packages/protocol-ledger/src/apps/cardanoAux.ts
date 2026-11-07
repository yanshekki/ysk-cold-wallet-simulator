import { blake2b } from '@noble/hashes/blake2b';
import { concatBytes } from '../bytes';
import { parseBip32Path } from '../apdu';
import { icarusRootFor } from '../crypto';
import type { FamilyContext } from './generic';
import { cardanoOutputAddressBytes, icarusPublicKey, readShelleyAddress } from './cardanoAddress';
import { cborBytes, cborType, cborUnsigned } from './cardanoTxHash';
import { deriveIcarus, deriveIcarusFromRoot, signIcarus } from './icarus';

/**
 * CIP-36 / CIP-15 auxiliary registration CBOR.
 *
 * LedgerHQ/app-cardano `src/cvote/aux_data_hash_builder.c` (develop):
 * auxiliary data is Array(2)[ Map(2){ 61284: payload, 61285: {1: sig} }, Array(0) ].
 * The signed digest is blake2b-256 of Map(1){ 61284: payload }, not the payload map
 * alone and not the concatenated APDU.
 */

const METADATA_PAYLOAD = 61284n;
const METADATA_SIGNATURE = 61285n;
const KEY_VOTE = 1n;
const KEY_STAKING = 2n;
const KEY_PAYMENT = 3n;
const KEY_NONCE = 4n;
const KEY_PURPOSE = 5n;
const SIG_KEY = 1n;
const PUBKEY = 32;
const CIP15 = 1;
const CIP36 = 2;

export type CvoteDelegation = { voteKey: Uint8Array; weight: number };

export type CvoteRegistration = {
  format: typeof CIP15 | typeof CIP36;
  voteKey?: Uint8Array;
  delegations?: CvoteDelegation[];
  stakingPubKey: Uint8Array;
  paymentAddress: Uint8Array;
  nonce: bigint;
  votingPurpose?: bigint;
};

function field(key: bigint, value: Uint8Array): Uint8Array {
  return concatBytes(cborUnsigned(key), value);
}

export function cvotePayloadCbor(reg: CvoteRegistration): Uint8Array | null {
  if (reg.stakingPubKey.length !== PUBKEY) {
    return null;
  }
  const cip36 = reg.format === CIP36;
  const delegations = reg.delegations;
  let voteField: Uint8Array;
  if (delegations && delegations.length > 0) {
    if (!cip36 || reg.voteKey) {
      return null;
    }
    const items: Uint8Array[] = [cborType(4, BigInt(delegations.length))];
    for (const delegation of delegations) {
      if (delegation.voteKey.length !== PUBKEY) {
        return null;
      }
      items.push(
        cborType(4, 2n),
        cborBytes(delegation.voteKey),
        cborUnsigned(BigInt(delegation.weight >>> 0)),
      );
    }
    voteField = concatBytes(...items);
  } else if (reg.voteKey && reg.voteKey.length === PUBKEY && (!delegations || delegations.length === 0)) {
    voteField = cborBytes(reg.voteKey);
  } else {
    return null;
  }
  if (cip36 && reg.votingPurpose == null) {
    return null;
  }
  if (!cip36 && reg.votingPurpose != null) {
    return null;
  }
  const size = cip36 ? 5 : 4;
  const parts: Uint8Array[] = [
    cborType(5, BigInt(size)),
    field(KEY_VOTE, voteField),
    field(KEY_STAKING, cborBytes(reg.stakingPubKey)),
    field(KEY_PAYMENT, cborBytes(reg.paymentAddress)),
    field(KEY_NONCE, cborUnsigned(reg.nonce)),
  ];
  if (cip36) {
    parts.push(field(KEY_PURPOSE, cborUnsigned(reg.votingPurpose ?? 0n)));
  }
  return concatBytes(...parts);
}

/** Map(1){ 61284: payload }. That is the buffer the staking key signs. */
export function cvoteSignedPayloadCbor(reg: CvoteRegistration): Uint8Array | null {
  const payload = cvotePayloadCbor(reg);
  if (!payload) {
    return null;
  }
  return concatBytes(cborType(5, 1n), cborUnsigned(METADATA_PAYLOAD), payload);
}

export function cvoteAuxCbor(reg: CvoteRegistration, signature: Uint8Array): Uint8Array | null {
  const payload = cvotePayloadCbor(reg);
  if (!payload || signature.length !== 64) {
    return null;
  }
  return concatBytes(
    cborType(4, 2n),
    cborType(5, 2n),
    cborUnsigned(METADATA_PAYLOAD),
    payload,
    cborUnsigned(METADATA_SIGNATURE),
    cborType(5, 1n),
    cborUnsigned(SIG_KEY),
    cborBytes(signature),
    cborType(4, 0n),
  );
}

export function cvotePayloadHash(reg: CvoteRegistration): Uint8Array | null {
  const signed = cvoteSignedPayloadCbor(reg);
  return signed ? blake2b(signed, { dkLen: 32 }) : null;
}

export function cvoteAuxHash(reg: CvoteRegistration, signature: Uint8Array): Uint8Array | null {
  const aux = cvoteAuxCbor(reg, signature);
  return aux ? blake2b(aux, { dkLen: 32 }) : null;
}

const CVOTE_KEY = 0;
const CVOTE_PATH = 2;
const DEST_THIRD_PARTY = 1;
const DEST_DEVICE = 2;

class Cursor {
  offset = 0;

  constructor(private readonly data: Uint8Array) {}

  remaining(): number {
    return this.data.length - this.offset;
  }

  u8(): number | null {
    if (this.remaining() < 1) return null;
    return this.data[this.offset++] ?? null;
  }

  u16(): number | null {
    if (this.remaining() < 2) return null;
    const value = ((this.data[this.offset] ?? 0) << 8) | (this.data[this.offset + 1] ?? 0);
    this.offset += 2;
    return value;
  }

  u32(): number | null {
    if (this.remaining() < 4) return null;
    const value =
      ((this.data[this.offset] ?? 0) * 0x1000000 +
        ((this.data[this.offset + 1] ?? 0) << 16) +
        ((this.data[this.offset + 2] ?? 0) << 8) +
        (this.data[this.offset + 3] ?? 0)) >>>
      0;
    this.offset += 4;
    return value;
  }

  u64(): bigint | null {
    if (this.remaining() < 8) return null;
    let value = 0n;
    for (let index = 0; index < 8; index += 1) {
      value = (value << 8n) | BigInt(this.data[this.offset++] ?? 0);
    }
    return value;
  }

  bytes(size: number): Uint8Array | null {
    if (size < 0 || this.remaining() < size) return null;
    const out = this.data.slice(this.offset, this.offset + size);
    this.offset += size;
    return out;
  }

  rest(): Uint8Array {
    return this.data.slice(this.offset);
  }
}

function readPath(cursor: Cursor): string | null {
  try {
    const parsed = parseBip32Path(cursor.rest());
    const consumed = cursor.remaining() - parsed.rest.length;
    if (consumed < 1 || !cursor.bytes(consumed)) {
      return null;
    }
    return parsed.path;
  } catch {
    return null;
  }
}

async function readCvoteKey(cursor: Cursor, ctx: FamilyContext, keyType: number): Promise<Uint8Array | null> {
  if (keyType === CVOTE_KEY) {
    return cursor.bytes(PUBKEY);
  }
  if (keyType === CVOTE_PATH) {
    const path = readPath(cursor);
    return path ? icarusPublicKey(ctx, path) : null;
  }
  return null;
}

async function readDestination(cursor: Cursor, ctx: FamilyContext): Promise<Uint8Array | null> {
  const type = cursor.u8();
  if (type === DEST_THIRD_PARTY) {
    const length = cursor.u16();
    return length == null ? null : cursor.bytes(length);
  }
  if (type === DEST_DEVICE) {
    const read = readShelleyAddress(cursor.rest());
    if (!read) {
      return null;
    }
    if (!cursor.bytes(read.next)) {
      return null;
    }
    return cardanoOutputAddressBytes(ctx, read.address);
  }
  return null;
}

export type ParsedCip36Init = {
  remaining: number;
  format: 1 | 2;
  stakingPath: string;
  payment: Uint8Array;
  nonce: bigint;
  votingPurpose?: bigint;
  voteKey?: Uint8Array;
  delegations: { voteKey: Uint8Array; weight: number }[];
};

/** v8 `cvote_parse_aux_data_init`. Format, u16 delegations, then staking, destination, nonce. */
export async function parseV8Cip36Init(data: Uint8Array, ctx: FamilyContext): Promise<ParsedCip36Init | null> {
  const cursor = new Cursor(data);
  const format = cursor.u8();
  const remaining = cursor.u16();
  if (format !== CIP15 && format !== CIP36) {
    return null;
  }
  if (remaining == null || (format === CIP15 && remaining !== 0)) {
    return null;
  }
  const stakingType = cursor.u8();
  if (stakingType !== CVOTE_PATH) {
    return null;
  }
  const stakingPath = readPath(cursor);
  const payment = await readDestination(cursor, ctx);
  const nonce = cursor.u64();
  if (!stakingPath || !payment || nonce == null) {
    return null;
  }
  let votingPurpose: bigint | undefined;
  let voteKey: Uint8Array | undefined;
  if (format === CIP36) {
    const purpose = cursor.u64();
    if (purpose == null) {
      return null;
    }
    votingPurpose = purpose;
    if (remaining === 0) {
      const kind = cursor.u8();
      if (kind == null) {
        return null;
      }
      const key = await readCvoteKey(cursor, ctx, kind);
      if (!key) {
        return null;
      }
      voteKey = key;
    }
  } else {
    const kind = cursor.u8();
    if (kind == null) {
      return null;
    }
    const key = await readCvoteKey(cursor, ctx, kind);
    if (!key) {
      return null;
    }
    voteKey = key;
  }
  if (cursor.remaining() !== 0) {
    return null;
  }
  return {
    remaining,
    format,
    stakingPath,
    payment,
    nonce,
    votingPurpose,
    voteKey,
    delegations: [],
  };
}

/** v8 delegation APDU: cvote credential + weight u32. */
export async function parseV8Cip36Delegation(
  data: Uint8Array,
  ctx: FamilyContext,
): Promise<{ voteKey: Uint8Array; weight: number } | null> {
  const cursor = new Cursor(data);
  const kind = cursor.u8();
  if (kind == null) {
    return null;
  }
  const voteKey = await readCvoteKey(cursor, ctx, kind);
  const weight = cursor.u32();
  if (!voteKey || weight == null || cursor.remaining() !== 0) {
    return null;
  }
  return { voteKey, weight };
}

export async function finalizeCip36(
  init: ParsedCip36Init,
  ctx: FamilyContext,
): Promise<{ hash: Uint8Array; signature: Uint8Array } | null> {
  if (init.remaining !== 0) {
    return null;
  }
  const stakingPubKey = await icarusPublicKey(ctx, init.stakingPath);
  const reg: CvoteRegistration = {
    format: init.format,
    voteKey: init.voteKey,
    delegations: init.delegations.length > 0 ? init.delegations : undefined,
    stakingPubKey,
    paymentAddress: init.payment,
    nonce: init.nonce,
    votingPurpose: init.votingPurpose,
  };
  const payloadHash = cvotePayloadHash(reg);
  if (!payloadHash) {
    return null;
  }
  const root = await icarusRootFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const node = root
    ? deriveIcarusFromRoot(root, init.stakingPath)
    : deriveIcarus(ctx.entropy, init.stakingPath, undefined, ctx.backup);
  const signature = signIcarus(node, payloadHash);
  const hash = cvoteAuxHash(reg, signature);
  if (!hash) {
    return null;
  }
  return { hash, signature };
}
