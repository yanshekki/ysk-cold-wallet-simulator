import { blake2b } from '@noble/hashes/blake2b';
import { concatBytes } from '../bytes';
import type { FamilyContext } from './generic';
import {
  cardanoOutputAddressBytes,
  readShelleyAddress,
  shelleyAddressBytes,
} from './cardanoAddress';

/**
 * Canonical Cardano transaction-body hash.
 *
 * Ledger `src/transaction/tx_hash_builder.c` writes a definite CBOR map of the
 * transaction body and blake2b-256s those bytes. The host stream is the v8
 * layout from `@cardano-foundation/ledgerjs-hw-app-cardano`
 * `serializeTxInitData` + `serializeTransactionRaw`. The witness signs this
 * digest, not the concatenated APDU payload.
 *
 * CIP-36 registration (aux type 1) is not hashed here. An arbitrary auxiliary
 * hash (type 0) is field 7 of the body. Pool-registration certificates and
 * voting procedures fail closed instead of producing a digest.
 */

const INCLUDED_NO = 0x01;
const INCLUDED_YES = 0x02;
const AUX_ARBITRARY = 0;
const AUX_CIP36 = 1;
const DEST_THIRD_PARTY = 1;
const DEST_DEVICE = 2;
const CRED_KEY_HASH = 0;
const CRED_SCRIPT = 1;
const CRED_PATH = 2;
const FORMAT_ARRAY = 0;
const FORMAT_MAP = 1;
const DATUM_HASH = 0;
const DATUM_INLINE = 1;
const SIGNER_PATH = 0;
const SIGNER_HASH = 1;
const HASH28 = 28;
const HASH32 = 32;
const POLICY = 28;
const TAG_SET = 258;
const TAG_EMBEDDED = 24;

export type CardanoTxInit = {
  tagCborSets: boolean;
  networkId: number;
  inputs: number;
  outputs: number;
  includeTtl: boolean;
  certificates: number;
  withdrawals: number;
  aux: { type: number; hash?: Uint8Array } | null;
  includeValidityStart: boolean;
  mintGroups: number;
  includeScriptDataHash: boolean;
  collateralInputs: number;
  requiredSigners: number;
  includeNetworkId: boolean;
  includeCollateralOutput: boolean;
  includeTotalCollateral: boolean;
  referenceInputs: number;
  voters: number;
  includeTreasury: boolean;
  includeDonation: boolean;
  rawLength: number;
};

class Cursor {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  remaining(): number {
    return this.data.length - this.offset;
  }

  u8(): number | null {
    if (this.remaining() < 1) {
      return null;
    }
    return this.data[this.offset++] ?? null;
  }

  u16(): number | null {
    if (this.remaining() < 2) {
      return null;
    }
    const value = ((this.data[this.offset] ?? 0) << 8) | (this.data[this.offset + 1] ?? 0);
    this.offset += 2;
    return value;
  }

  u32(): number | null {
    if (this.remaining() < 4) {
      return null;
    }
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
    const bytes = this.bytes(8);
    if (!bytes) {
      return null;
    }
    let value = 0n;
    for (const byte of bytes) {
      value = (value << 8n) | BigInt(byte);
    }
    return value;
  }

  i64(): bigint | null {
    const value = this.u64();
    if (value == null) {
      return null;
    }
    return value >= 0x8000000000000000n ? value - 0x10000000000000000n : value;
  }

  bytes(size: number): Uint8Array | null {
    if (size < 0 || this.remaining() < size) {
      return null;
    }
    const out = this.data.slice(this.offset, this.offset + size);
    this.offset += size;
    return out;
  }

  flag(): boolean | null {
    const value = this.u8();
    if (value === INCLUDED_YES) {
      return true;
    }
    if (value === INCLUDED_NO) {
      return false;
    }
    return null;
  }
}

function cborUnsigned(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error('cbor unsigned');
  }
  if (value < 24n) {
    return Uint8Array.of(Number(value));
  }
  if (value < 256n) {
    return Uint8Array.of(0x18, Number(value));
  }
  if (value < 65536n) {
    return Uint8Array.of(0x19, Number(value >> 8n), Number(value & 0xffn));
  }
  if (value < 0x100000000n) {
    return Uint8Array.of(
      0x1a,
      Number((value >> 24n) & 0xffn),
      Number((value >> 16n) & 0xffn),
      Number((value >> 8n) & 0xffn),
      Number(value & 0xffn),
    );
  }
  const out = new Uint8Array(9);
  out[0] = 0x1b;
  let rest = value;
  for (let index = 8; index >= 1; index -= 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function cborType(major: number, value: bigint): Uint8Array {
  const head = cborUnsigned(value);
  const out = new Uint8Array(head);
  out[0] = (out[0] ?? 0) | ((major << 5) & 0xe0);
  return out;
}

function cborBytes(data: Uint8Array): Uint8Array {
  return concatBytes(cborType(2, BigInt(data.length)), data);
}

/**
 * `cbor_writeToken(CBOR_TYPE_NEGATIVE)` reinterprets the int64 bits, then
 * stores argument `-value - 1`. That is the canonical major-type-1 integer.
 */
function cborSigned(value: bigint): Uint8Array {
  if (value >= 0n) {
    return cborUnsigned(value);
  }
  return cborType(1, -1n - value);
}

/** `serializeTxInitData`. Counts drive the raw stream that follows in later APDUs. */
export function parseCardanoTxInit(data: Uint8Array): CardanoTxInit | null {
  const cursor = new Cursor(data);
  const options = cursor.u64();
  const networkId = cursor.u8();
  if (options == null || networkId == null || cursor.u32() == null) {
    return null;
  }
  if (cursor.u8() == null) {
    return null;
  }
  const inputs = cursor.u16();
  const outputs = cursor.u16();
  const includeTtl = cursor.flag();
  const certificates = cursor.u16();
  const withdrawals = cursor.u16();
  const includeAux = cursor.flag();
  if (
    inputs == null ||
    outputs == null ||
    includeTtl == null ||
    certificates == null ||
    withdrawals == null ||
    includeAux == null
  ) {
    return null;
  }
  let aux: CardanoTxInit['aux'] = null;
  if (includeAux) {
    const type = cursor.u8();
    if (type == null) {
      return null;
    }
    if (type === AUX_ARBITRARY) {
      const hash = cursor.bytes(HASH32);
      if (!hash) {
        return null;
      }
      aux = { type, hash };
    } else if (type === AUX_CIP36) {
      aux = { type };
    } else {
      return null;
    }
  }
  const includeValidityStart = cursor.flag();
  const mintGroups = cursor.u16();
  const includeScriptDataHash = cursor.flag();
  const collateralInputs = cursor.u16();
  const requiredSigners = cursor.u16();
  const includeNetworkId = cursor.flag();
  const includeCollateralOutput = cursor.flag();
  const includeTotalCollateral = cursor.flag();
  const referenceInputs = cursor.u16();
  const voters = cursor.u16();
  const includeTreasury = cursor.flag();
  const includeDonation = cursor.flag();
  const witnesses = cursor.u16();
  const rawLength = cursor.u16();
  if (
    includeValidityStart == null ||
    mintGroups == null ||
    includeScriptDataHash == null ||
    collateralInputs == null ||
    requiredSigners == null ||
    includeNetworkId == null ||
    includeCollateralOutput == null ||
    includeTotalCollateral == null ||
    referenceInputs == null ||
    voters == null ||
    includeTreasury == null ||
    includeDonation == null ||
    witnesses == null ||
    rawLength == null ||
    cursor.remaining() !== 0
  ) {
    return null;
  }
  return {
    tagCborSets: (options & 1n) === 1n,
    networkId,
    inputs,
    outputs,
    includeTtl,
    certificates,
    withdrawals,
    aux,
    includeValidityStart,
    mintGroups,
    includeScriptDataHash,
    collateralInputs,
    requiredSigners,
    includeNetworkId,
    includeCollateralOutput,
    includeTotalCollateral,
    referenceInputs,
    voters,
    includeTreasury,
    includeDonation,
    rawLength,
  };
}

function readPath(cursor: Cursor): string | null {
  const count = cursor.u8();
  if (count == null || count < 1 || count > 5) {
    return null;
  }
  const parts = ['m'];
  for (let index = 0; index < count; index += 1) {
    const component = cursor.u32();
    if (component == null) {
      return null;
    }
    const hardened = component >= 0x80000000;
    const value = hardened ? component - 0x80000000 : component;
    parts.push(`${value}${hardened ? "'" : ''}`);
  }
  return parts.join('/');
}

async function readCredential(
  cursor: Cursor,
  ctx: FamilyContext,
): Promise<{ type: number; hash: Uint8Array } | null> {
  const wire = cursor.u8();
  if (wire === CRED_KEY_HASH || wire === CRED_SCRIPT) {
    const hash = cursor.bytes(HASH28);
    if (!hash) {
      return null;
    }
    return { type: wire === CRED_SCRIPT ? 1 : 0, hash };
  }
  if (wire === CRED_PATH) {
    const path = readPath(cursor);
    if (!path) {
      return null;
    }
    const address = await shelleyAddressBytes(ctx, {
      type: 0x06,
      networkId: 0,
      paymentPath: path,
      stake: { kind: 'none' },
    });
    return { type: 0, hash: address.slice(1) };
  }
  return null;
}

function credentialCbor(credential: { type: number; hash: Uint8Array }): Uint8Array {
  return concatBytes(
    cborType(4, 2n),
    cborUnsigned(BigInt(credential.type)),
    cborBytes(credential.hash),
  );
}

async function readInput(cursor: Cursor): Promise<Uint8Array | null> {
  const hash = cursor.bytes(HASH32);
  const index = cursor.u32();
  if (!hash || index == null) {
    return null;
  }
  return concatBytes(cborType(4, 2n), cborBytes(hash), cborUnsigned(BigInt(index)));
}

async function readTokenGroups(cursor: Cursor, groups: number, signed: boolean): Promise<Uint8Array | null> {
  const parts: Uint8Array[] = [];
  for (let group = 0; group < groups; group += 1) {
    const policy = cursor.bytes(POLICY);
    const tokens = cursor.u16();
    if (!policy || tokens == null || tokens < 1) {
      return null;
    }
    parts.push(cborBytes(policy), cborType(5, BigInt(tokens)));
    for (let token = 0; token < tokens; token += 1) {
      const nameLen = cursor.u8();
      if (nameLen == null) {
        return null;
      }
      const name = cursor.bytes(nameLen);
      const amount = signed ? cursor.i64() : cursor.u64();
      if (!name || amount == null) {
        return null;
      }
      parts.push(cborBytes(name), signed ? cborSigned(amount) : cborUnsigned(amount));
    }
  }
  return concatBytes(...parts);
}

async function readOutput(cursor: Cursor, ctx: FamilyContext): Promise<Uint8Array | null> {
  const length = cursor.u16();
  const blob = length == null ? null : cursor.bytes(length);
  if (!blob || blob.length < 1) {
    return null;
  }
  const destination = blob[0];
  if (destination === DEST_THIRD_PARTY) {
    const inner = new Cursor(blob);
    if (inner.u8() == null) {
      return null;
    }
    const addressLen = inner.u16();
    const address = addressLen == null ? null : inner.bytes(addressLen);
    if (!address) {
      return null;
    }
    return finishOutput(inner, address);
  }
  if (destination === DEST_DEVICE) {
    const tail = blob.slice(1);
    const read = readShelleyAddress(tail);
    if (!read) {
      return null;
    }
    const address = await cardanoOutputAddressBytes(ctx, read.address);
    return finishOutput(new Cursor(tail.slice(read.next)), address);
  }
  return null;
}

async function finishOutput(inner: Cursor, address: Uint8Array): Promise<Uint8Array | null> {
  const amount = inner.u64();
  const format = inner.u8();
  const includeDatum = inner.flag();
  const includeScript = inner.flag();
  const groups = inner.u16();
  if (amount == null || format == null || includeDatum == null || includeScript == null || groups == null) {
    return null;
  }
  const tokens = groups === 0 ? new Uint8Array() : await readTokenGroups(inner, groups, false);
  if (!tokens) {
    return null;
  }
  const value =
    groups === 0
      ? cborUnsigned(amount)
      : concatBytes(cborType(4, 2n), cborUnsigned(amount), cborType(5, BigInt(groups)), tokens);
  let datum = new Uint8Array();
  if (includeDatum) {
    const datumType = inner.u8();
    if (datumType === DATUM_HASH) {
      const hash = inner.bytes(HASH32);
      if (!hash) {
        return null;
      }
      datum =
        format === FORMAT_MAP
          ? concatBytes(cborUnsigned(2n), cborType(4, 2n), cborUnsigned(0n), cborBytes(hash))
          : cborBytes(hash);
    } else if (datumType === DATUM_INLINE) {
      if (format !== FORMAT_MAP) {
        return null;
      }
      const size = inner.u16();
      const data = size == null ? null : inner.bytes(size);
      if (!data) {
        return null;
      }
      datum = concatBytes(
        cborUnsigned(2n),
        cborType(4, 2n),
        cborUnsigned(1n),
        cborType(6, BigInt(TAG_EMBEDDED)),
        cborBytes(data),
      );
    } else {
      return null;
    }
  }
  let script = new Uint8Array();
  if (includeScript) {
    if (format !== FORMAT_MAP) {
      return null;
    }
    const size = inner.u16();
    const data = size == null ? null : inner.bytes(size);
    if (!data) {
      return null;
    }
    script = concatBytes(cborUnsigned(3n), cborType(6, BigInt(TAG_EMBEDDED)), cborBytes(data));
  }
  if (inner.remaining() !== 0) {
    return null;
  }
  if (format === FORMAT_ARRAY) {
    const fields = 2 + (includeDatum ? 1 : 0);
    return concatBytes(cborType(4, BigInt(fields)), cborBytes(address), value, datum);
  }
  if (format === FORMAT_MAP) {
    const fields = 2 + (includeDatum ? 1 : 0) + (includeScript ? 1 : 0);
    return concatBytes(
      cborType(5, BigInt(fields)),
      cborUnsigned(0n),
      cborBytes(address),
      cborUnsigned(1n),
      value,
      datum,
      script,
    );
  }
  return null;
}

function setPrefix(tagSets: boolean, count: number): Uint8Array {
  return tagSets
    ? concatBytes(cborType(6, BigInt(TAG_SET)), cborType(4, BigInt(count)))
    : cborType(4, BigInt(count));
}

async function readCertificate(cursor: Cursor, ctx: FamilyContext): Promise<Uint8Array | null> {
  const type = cursor.u8();
  if (type == null) {
    return null;
  }
  if (type === 0 || type === 1) {
    const credential = await readCredential(cursor, ctx);
    if (!credential) {
      return null;
    }
    return concatBytes(cborType(4, 2n), cborUnsigned(BigInt(type)), credentialCbor(credential));
  }
  if (type === 2) {
    const credential = await readCredential(cursor, ctx);
    const pool = cursor.bytes(HASH28);
    if (!credential || !pool) {
      return null;
    }
    return concatBytes(
      cborType(4, 3n),
      cborUnsigned(2n),
      credentialCbor(credential),
      cborBytes(pool),
    );
  }
  if (type === 7 || type === 8) {
    const credential = await readCredential(cursor, ctx);
    const deposit = cursor.u64();
    if (!credential || deposit == null) {
      return null;
    }
    return concatBytes(
      cborType(4, 3n),
      cborUnsigned(BigInt(type)),
      credentialCbor(credential),
      cborUnsigned(deposit),
    );
  }
  return null;
}

/**
 * Rebuild the body Ledger hashes. Returns null when the stream is not the v8
 * raw layout or when a field this builder does not encode is present.
 */
export async function cardanoCanonicalBody(
  init: Uint8Array,
  raw: Uint8Array,
  ctx: FamilyContext,
): Promise<Uint8Array | null> {
  const header = parseCardanoTxInit(init);
  if (!header || header.rawLength !== raw.length || header.voters > 0) {
    return null;
  }
  if (header.aux?.type === AUX_CIP36) {
    return null;
  }
  if (header.certificates > 0) {
    // Pool registration and the long Conway certificate list are not encoded.
    // A payment, delegation, or Conway stake cert is. Unknown types fail closed.
  }
  const cursor = new Cursor(raw);
  const items = bodyItems(header);
  const parts: Uint8Array[] = [cborType(5, BigInt(items))];

  const inputs = await readMany(cursor, header.inputs, readInput);
  if (!inputs) {
    return null;
  }
  parts.push(cborUnsigned(0n), setPrefix(header.tagCborSets, header.inputs), ...inputs);

  const outputs: Uint8Array[] = [];
  for (let index = 0; index < header.outputs; index += 1) {
    const output = await readOutput(cursor, ctx);
    if (!output) {
      return null;
    }
    outputs.push(output);
  }
  parts.push(cborUnsigned(1n), cborType(4, BigInt(header.outputs)), ...outputs);

  const fee = cursor.u64();
  if (fee == null) {
    return null;
  }
  parts.push(cborUnsigned(2n), cborUnsigned(fee));

  if (header.includeTtl) {
    const ttl = cursor.u64();
    if (ttl == null) {
      return null;
    }
    parts.push(cborUnsigned(3n), cborUnsigned(ttl));
  }

  if (header.certificates > 0) {
    const certs: Uint8Array[] = [];
    for (let index = 0; index < header.certificates; index += 1) {
      const certificate = await readCertificate(cursor, ctx);
      if (!certificate) {
        return null;
      }
      certs.push(certificate);
    }
    parts.push(
      cborUnsigned(4n),
      setPrefix(header.tagCborSets, header.certificates),
      ...certs,
    );
  }

  if (header.withdrawals > 0) {
    const entries: Uint8Array[] = [];
    for (let index = 0; index < header.withdrawals; index += 1) {
      const amount = cursor.u64();
      const credential = await readCredential(cursor, ctx);
      if (amount == null || !credential) {
        return null;
      }
      const headerByte = ((credential.type === 1 ? 0x0f : 0x0e) << 4) | (header.networkId & 0x0f);
      const reward = concatBytes(Uint8Array.of(headerByte), credential.hash);
      entries.push(cborBytes(reward), cborUnsigned(amount));
    }
    parts.push(cborUnsigned(5n), cborType(5, BigInt(header.withdrawals)), ...entries);
  }

  if (header.aux?.hash) {
    parts.push(cborUnsigned(7n), cborBytes(header.aux.hash));
  }

  if (header.includeValidityStart) {
    const start = cursor.u64();
    if (start == null) {
      return null;
    }
    parts.push(cborUnsigned(8n), cborUnsigned(start));
  }

  if (header.mintGroups > 0) {
    const mint = await readTokenGroups(cursor, header.mintGroups, true);
    if (!mint) {
      return null;
    }
    parts.push(cborUnsigned(9n), cborType(5, BigInt(header.mintGroups)), mint);
  }

  if (header.includeScriptDataHash) {
    const hash = cursor.bytes(HASH32);
    if (!hash) {
      return null;
    }
    parts.push(cborUnsigned(11n), cborBytes(hash));
  }

  if (header.collateralInputs > 0) {
    const inputs = await readMany(cursor, header.collateralInputs, readInput);
    if (!inputs) {
      return null;
    }
    parts.push(cborUnsigned(13n), setPrefix(header.tagCborSets, header.collateralInputs), ...inputs);
  }

  if (header.requiredSigners > 0) {
    const signers: Uint8Array[] = [];
    for (let index = 0; index < header.requiredSigners; index += 1) {
      const kind = cursor.u8();
      let hash: Uint8Array | null = null;
      if (kind === SIGNER_HASH) {
        hash = cursor.bytes(HASH28);
      } else if (kind === SIGNER_PATH) {
        const path = readPath(cursor);
        if (!path) {
          return null;
        }
        const address = await shelleyAddressBytes(ctx, {
          type: 0x06,
          networkId: 0,
          paymentPath: path,
          stake: { kind: 'none' },
        });
        hash = address.slice(1);
      }
      if (!hash) {
        return null;
      }
      signers.push(cborBytes(hash));
    }
    parts.push(cborUnsigned(14n), setPrefix(header.tagCborSets, header.requiredSigners), ...signers);
  }

  if (header.includeNetworkId) {
    parts.push(cborUnsigned(15n), cborUnsigned(BigInt(header.networkId)));
  }

  if (header.includeCollateralOutput) {
    const output = await readOutput(cursor, ctx);
    if (!output) {
      return null;
    }
    parts.push(cborUnsigned(16n), output);
  }

  if (header.includeTotalCollateral) {
    const total = cursor.u64();
    if (total == null) {
      return null;
    }
    parts.push(cborUnsigned(17n), cborUnsigned(total));
  }

  if (header.referenceInputs > 0) {
    const inputs = await readMany(cursor, header.referenceInputs, readInput);
    if (!inputs) {
      return null;
    }
    parts.push(cborUnsigned(18n), setPrefix(header.tagCborSets, header.referenceInputs), ...inputs);
  }

  if (header.includeTreasury) {
    const treasury = cursor.u64();
    if (treasury == null) {
      return null;
    }
    parts.push(cborUnsigned(21n), cborUnsigned(treasury));
  }
  if (header.includeDonation) {
    const donation = cursor.u64();
    if (donation == null) {
      return null;
    }
    parts.push(cborUnsigned(22n), cborUnsigned(donation));
  }
  if (cursor.remaining() !== 0) {
    return null;
  }
  return concatBytes(...parts);
}

function bodyItems(header: CardanoTxInit): number {
  let items = 3;
  if (header.includeTtl) items += 1;
  if (header.certificates > 0) items += 1;
  if (header.withdrawals > 0) items += 1;
  if (header.aux?.hash) items += 1;
  if (header.includeValidityStart) items += 1;
  if (header.mintGroups > 0) items += 1;
  if (header.includeScriptDataHash) items += 1;
  if (header.collateralInputs > 0) items += 1;
  if (header.requiredSigners > 0) items += 1;
  if (header.includeNetworkId) items += 1;
  if (header.includeCollateralOutput) items += 1;
  if (header.includeTotalCollateral) items += 1;
  if (header.referenceInputs > 0) items += 1;
  if (header.includeTreasury) items += 1;
  if (header.includeDonation) items += 1;
  return items;
}

async function readMany(
  cursor: Cursor,
  count: number,
  read: (cursor: Cursor) => Promise<Uint8Array | null>,
): Promise<Uint8Array[] | null> {
  const out: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = await read(cursor);
    if (!item) {
      return null;
    }
    out.push(item);
  }
  return out;
}

export async function cardanoCanonicalTxHash(
  init: Uint8Array,
  raw: Uint8Array,
  ctx: FamilyContext,
): Promise<Uint8Array | null> {
  const body = await cardanoCanonicalBody(init, raw, ctx);
  return body ? blake2b(body, { dkLen: 32 }) : null;
}
