import { concatBytes } from '../bytes';
import type { FamilyContext } from './generic';
import { cardanoOutputAddressBytes, readShelleyAddress, shelleyAddressBytes } from './cardanoAddress';
import { cborBytes, cborSigned, cborType, cborUnsigned } from './cardanoTxHash';

/**
 * Cardano app 2.2 through 7.2.1 SIGN_TX stages.
 *
 * Ledger.js `getCompatibility` (`src/validation/deviceCapabilities.ts`) is the
 * version gate. The stage bytes are `src/interactions/v7/serialization/*` and
 * the call order is `signTransactionV7` in `src/interactions/v7/signTx.ts`.
 * The hash is still blake2b-256 of the canonical body from `tx_hash_builder.c`.
 *
 * 2.2 Mary, 3.0 mint and multisig, 4.0 Alonzo, 5.0 Babbage, 7.0 Conway.
 * 7.2.1 is the layout Minswap sends. A catalog of 8.x that still receives
 * P1 0x01 uses this same 7.2.1 layout. CIP-36 registration, pool registration,
 * and voting procedures fail closed.
 */

const INCLUDED_NO = 0x01;
const INCLUDED_YES = 0x02;
const DEST_THIRD_PARTY = 1;
const DEST_DEVICE = 2;
const AUX_ARBITRARY = 0;
const AUX_CIP36 = 1;
const CRED_PATH = 0;
const CRED_SCRIPT = 1;
const CRED_KEY_HASH = 2;
const FORMAT_ARRAY = 0;
const FORMAT_MAP = 1;
const DATUM_HASH = 0;
const DATUM_INLINE = 1;
const P2_BASIC = 0x30;
const P2_ASSET = 0x31;
const P2_TOKEN = 0x32;
const P2_OUTPUT_CONFIRM = 0x33;
const P2_DATUM = 0x34;
const P2_DATUM_CHUNK = 0x35;
const P2_SCRIPT = 0x36;
const P2_SCRIPT_CHUNK = 0x37;
const HASH28 = 28;
const HASH32 = 32;
const TAG_EMBEDDED = 24;

const P1_INIT = 0x01;
const P1_INPUTS = 0x02;
const P1_OUTPUTS = 0x03;
const P1_FEE = 0x04;
const P1_TTL = 0x05;
const P1_CERTS = 0x06;
const P1_WITHDRAWALS = 0x07;
const P1_AUX = 0x08;
const P1_VALIDITY = 0x09;
const P1_MINT = 0x0b;
const P1_SCRIPT = 0x0c;
const P1_COLLATERAL = 0x0d;
const P1_SIGNERS = 0x0e;
const P1_TOTAL = 0x10;
const P1_REFERENCE = 0x11;
const P1_COLLATERAL_OUT = 0x12;
const P1_VOTING = 0x13;
const P1_TREASURY = 0x15;
const P1_DONATION = 0x16;

type Era = {
  mary: boolean;
  multisig: boolean;
  mint: boolean;
  alonzo: boolean;
  babbage: boolean;
  conway: boolean;
};

type Token = { name: Uint8Array; amount: bigint };
type Group = { policy: Uint8Array; expected: number; tokens: Token[] };

type Draft = {
  kind: 'output' | 'collateral' | 'mint';
  format: number;
  address: Uint8Array;
  amount: bigint;
  expectedGroups: number;
  groups: Group[];
  includeDatum: boolean;
  includeScript: boolean;
  datum: Uint8Array;
  datumLeft: number;
  script: Uint8Array;
  scriptLeft: number;
};

/** Last v7 wire Minswap speaks. Used when an 8.x catalog still receives P1 0x01. */
export function cardanoV7Era(version: string): Era {
  const [majorRaw, minorRaw] = version.split('.');
  let major = Number.parseInt(majorRaw ?? '', 10);
  let minor = Number.parseInt(minorRaw ?? '', 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    major = 0;
    minor = 0;
  }
  if (major >= 8) {
    major = 7;
    minor = 2;
  }
  const atLeast = (needMajor: number, needMinor: number) =>
    major > needMajor || (major === needMajor && minor >= needMinor);
  return {
    mary: atLeast(2, 2),
    multisig: atLeast(3, 0),
    mint: atLeast(3, 0),
    alonzo: atLeast(4, 0),
    babbage: atLeast(5, 0),
    conway: atLeast(7, 0),
  };
}

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
    const bytes = this.bytes(8);
    if (!bytes) return null;
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
  }

  i64(): bigint | null {
    const value = this.u64();
    if (value == null) return null;
    return value >= 0x8000000000000000n ? value - 0x10000000000000000n : value;
  }

  bytes(size: number): Uint8Array | null {
    if (size < 0 || this.remaining() < size) return null;
    const out = this.data.slice(this.offset, this.offset + size);
    this.offset += size;
    return out;
  }

  flag(): boolean | null {
    const value = this.u8();
    if (value === INCLUDED_YES) return true;
    if (value === INCLUDED_NO) return false;
    return null;
  }

  path(): string | null {
    const count = this.u8();
    if (count == null || count < 1 || count > 5) return null;
    const parts = ['m'];
    for (let index = 0; index < count; index += 1) {
      const component = this.u32();
      if (component == null) return null;
      const hardened = component >= 0x80000000;
      parts.push(`${hardened ? component - 0x80000000 : component}${hardened ? "'" : ''}`);
    }
    return parts.join('/');
  }
}

async function keyHash(ctx: FamilyContext, path: string): Promise<Uint8Array> {
  const address = await shelleyAddressBytes(ctx, {
    type: 0x06,
    networkId: 0,
    paymentPath: path,
    stake: { kind: 'none' },
  });
  return address.slice(1);
}

function inputCbor(hash: Uint8Array, index: number): Uint8Array {
  return concatBytes(cborType(4, 2n), cborBytes(hash), cborUnsigned(BigInt(index)));
}

function credentialCbor(type: number, hash: Uint8Array): Uint8Array {
  return concatBytes(cborType(4, 2n), cborUnsigned(BigInt(type)), cborBytes(hash));
}

function setPrefix(tagSets: boolean, count: number): Uint8Array {
  return tagSets
    ? concatBytes(cborType(6, 258n), cborType(4, BigInt(count)))
    : cborType(4, BigInt(count));
}

function encodeGroups(groups: Group[], signed: boolean): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const group of groups) {
    parts.push(cborBytes(group.policy), cborType(5, BigInt(group.tokens.length)));
    for (const token of group.tokens) {
      parts.push(cborBytes(token.name), signed ? cborSigned(token.amount) : cborUnsigned(token.amount));
    }
  }
  return concatBytes(...parts);
}

function encodeOutput(draft: Draft): Uint8Array | null {
  if (draft.groups.length !== draft.expectedGroups) return null;
  for (const group of draft.groups) {
    if (group.tokens.length !== group.expected) return null;
  }
  if (draft.datumLeft !== 0 || draft.scriptLeft !== 0) return null;
  if (draft.includeDatum && draft.datum.length === 0) return null;
  if (draft.includeScript && draft.script.length === 0) return null;
  const tokens = draft.expectedGroups === 0 ? new Uint8Array() : encodeGroups(draft.groups, false);
  const value =
    draft.expectedGroups === 0
      ? cborUnsigned(draft.amount)
      : concatBytes(
          cborType(4, 2n),
          cborUnsigned(draft.amount),
          cborType(5, BigInt(draft.expectedGroups)),
          tokens,
        );
  if (draft.format === FORMAT_ARRAY) {
    const fields = 2 + (draft.datum.length > 0 ? 1 : 0);
    return concatBytes(cborType(4, BigInt(fields)), cborBytes(draft.address), value, draft.datum);
  }
  if (draft.format === FORMAT_MAP) {
    const fields = 2 + (draft.datum.length > 0 ? 1 : 0) + (draft.script.length > 0 ? 1 : 0);
    return concatBytes(
      cborType(5, BigInt(fields)),
      cborUnsigned(0n),
      cborBytes(draft.address),
      cborUnsigned(1n),
      value,
      draft.datum,
      draft.script,
    );
  }
  return null;
}

export class CardanoV7Tx {
  private readonly era: Era;
  private bad = false;
  private tagSets = false;
  private networkId = 0;
  private expect = {
    inputs: 0,
    outputs: 0,
    certificates: 0,
    withdrawals: 0,
    collateral: 0,
    signers: 0,
    references: 0,
    voters: 0,
    ttl: false,
    aux: false,
    validity: false,
    mint: false,
    script: false,
    network: false,
    collateralOutput: false,
    totalCollateral: false,
    treasury: false,
    donation: false,
  };

  private readonly inputs: Uint8Array[] = [];
  private readonly outputs: Uint8Array[] = [];
  private fee: bigint | null = null;
  private ttl: bigint | null = null;
  private readonly certificates: Uint8Array[] = [];
  private readonly withdrawals: { reward: Uint8Array; amount: bigint }[] = [];
  private aux: Uint8Array | null = null;
  private validity: bigint | null = null;
  private mintBody: Uint8Array | null = null;
  private mintGroups = 0;
  private scriptHash: Uint8Array | null = null;
  private readonly collateral: Uint8Array[] = [];
  private readonly signers: Uint8Array[] = [];
  private collateralOutput: Uint8Array | null = null;
  private totalCollateral: bigint | null = null;
  private readonly references: Uint8Array[] = [];
  private treasury: bigint | null = null;
  private donation: bigint | null = null;
  private draft: Draft | null = null;

  constructor(version: string) {
    this.era = cardanoV7Era(version);
    if (!this.era.mary) this.bad = true;
  }

  async stage(p1: number, p2: number, data: Uint8Array, ctx: FamilyContext): Promise<void> {
    if (this.bad) return;
    if (p1 === P1_INIT) {
      this.readInit(data);
      return;
    }
    if (p1 === P1_INPUTS) return this.pushInput(this.inputs, this.expect.inputs, data);
    if (p1 === P1_COLLATERAL) return this.pushInput(this.collateral, this.expect.collateral, data);
    if (p1 === P1_REFERENCE) return this.pushInput(this.references, this.expect.references, data);
    if (p1 === P1_OUTPUTS || p1 === P1_COLLATERAL_OUT) {
      await this.outputStage(p1 === P1_COLLATERAL_OUT ? 'collateral' : 'output', p2, data, ctx);
      return;
    }
    if (p1 === P1_FEE) return this.readScalar('fee', data);
    if (p1 === P1_TTL) return this.readOptional('ttl', this.expect.ttl, data);
    if (p1 === P1_VALIDITY) return this.readOptional('validity', this.expect.validity, data);
    if (p1 === P1_TOTAL) return this.readOptional('totalCollateral', this.expect.totalCollateral, data);
    if (p1 === P1_TREASURY) return this.readOptional('treasury', this.expect.treasury, data);
    if (p1 === P1_DONATION) return this.readOptional('donation', this.expect.donation, data);
    if (p1 === P1_SCRIPT) {
      if (!this.expect.script || this.scriptHash || data.length !== HASH32) this.bad = true;
      else this.scriptHash = data;
      return;
    }
    if (p1 === P1_AUX) {
      await this.auxStage(p2, data);
      return;
    }
    if (p1 === P1_CERTS) {
      await this.certificate(data, ctx);
      return;
    }
    if (p1 === P1_WITHDRAWALS) {
      await this.withdrawal(data, ctx);
      return;
    }
    if (p1 === P1_SIGNERS) {
      await this.signer(data, ctx);
      return;
    }
    if (p1 === P1_MINT) {
      await this.mintStage(p2, data);
      return;
    }
    if (p1 === P1_VOTING) {
      this.bad = true;
      return;
    }
    this.bad = true;
  }

  body(): Uint8Array | null {
    if (this.bad || this.fee == null || this.draft) return null;
    if (this.expect.voters > 0) return null;
    if (this.inputs.length !== this.expect.inputs) return null;
    if (this.outputs.length !== this.expect.outputs) return null;
    if (this.certificates.length !== this.expect.certificates) return null;
    if (this.withdrawals.length !== this.expect.withdrawals) return null;
    if (this.collateral.length !== this.expect.collateral) return null;
    if (this.signers.length !== this.expect.signers) return null;
    if (this.references.length !== this.expect.references) return null;
    if (this.expect.ttl !== (this.ttl != null)) return null;
    if (this.expect.aux !== (this.aux != null)) return null;
    if (this.expect.validity !== (this.validity != null)) return null;
    if (this.expect.mint !== (this.mintBody != null)) return null;
    if (this.expect.script !== (this.scriptHash != null)) return null;
    if (this.expect.collateralOutput !== (this.collateralOutput != null)) return null;
    if (this.expect.totalCollateral !== (this.totalCollateral != null)) return null;
    if (this.expect.treasury !== (this.treasury != null)) return null;
    if (this.expect.donation !== (this.donation != null)) return null;
    let items = 3;
    if (this.ttl != null) items += 1;
    if (this.certificates.length > 0) items += 1;
    if (this.withdrawals.length > 0) items += 1;
    if (this.aux) items += 1;
    if (this.validity != null) items += 1;
    if (this.mintBody) items += 1;
    if (this.scriptHash) items += 1;
    if (this.collateral.length > 0) items += 1;
    if (this.signers.length > 0) items += 1;
    if (this.expect.network) items += 1;
    if (this.collateralOutput) items += 1;
    if (this.totalCollateral != null) items += 1;
    if (this.references.length > 0) items += 1;
    if (this.treasury != null) items += 1;
    if (this.donation != null) items += 1;
    const parts: Uint8Array[] = [cborType(5, BigInt(items))];
    parts.push(cborUnsigned(0n), setPrefix(this.tagSets, this.inputs.length), ...this.inputs);
    parts.push(cborUnsigned(1n), cborType(4, BigInt(this.outputs.length)), ...this.outputs);
    parts.push(cborUnsigned(2n), cborUnsigned(this.fee));
    if (this.ttl != null) parts.push(cborUnsigned(3n), cborUnsigned(this.ttl));
    if (this.certificates.length > 0) {
      parts.push(cborUnsigned(4n), setPrefix(this.tagSets, this.certificates.length), ...this.certificates);
    }
    if (this.withdrawals.length > 0) {
      parts.push(cborUnsigned(5n), cborType(5, BigInt(this.withdrawals.length)));
      for (const withdrawal of this.withdrawals) {
        parts.push(cborBytes(withdrawal.reward), cborUnsigned(withdrawal.amount));
      }
    }
    if (this.aux) parts.push(cborUnsigned(7n), cborBytes(this.aux));
    if (this.validity != null) parts.push(cborUnsigned(8n), cborUnsigned(this.validity));
    if (this.mintBody) {
      parts.push(cborUnsigned(9n), cborType(5, BigInt(this.mintGroups)), this.mintBody);
    }
    if (this.scriptHash) parts.push(cborUnsigned(11n), cborBytes(this.scriptHash));
    if (this.collateral.length > 0) {
      parts.push(cborUnsigned(13n), setPrefix(this.tagSets, this.collateral.length), ...this.collateral);
    }
    if (this.signers.length > 0) {
      parts.push(cborUnsigned(14n), setPrefix(this.tagSets, this.signers.length), ...this.signers);
    }
    if (this.expect.network) parts.push(cborUnsigned(15n), cborUnsigned(BigInt(this.networkId)));
    if (this.collateralOutput) parts.push(cborUnsigned(16n), this.collateralOutput);
    if (this.totalCollateral != null) parts.push(cborUnsigned(17n), cborUnsigned(this.totalCollateral));
    if (this.references.length > 0) {
      parts.push(cborUnsigned(18n), setPrefix(this.tagSets, this.references.length), ...this.references);
    }
    if (this.treasury != null) parts.push(cborUnsigned(21n), cborUnsigned(this.treasury));
    if (this.donation != null) parts.push(cborUnsigned(22n), cborUnsigned(this.donation));
    return concatBytes(...parts);
  }

  private readInit(data: Uint8Array): void {
    const cursor = new Cursor(data);
    if (this.era.conway) {
      const options = cursor.u64();
      if (options == null) {
        this.bad = true;
        return;
      }
      this.tagSets = (options & 1n) === 1n;
    }
    const networkId = cursor.u8();
    const magic = cursor.u32();
    const ttl = cursor.flag();
    const aux = cursor.flag();
    const validity = cursor.flag();
    if (networkId == null || magic == null || ttl == null || aux == null || validity == null) {
      this.bad = true;
      return;
    }
    const mint = this.era.mint ? cursor.flag() : false;
    const script = this.era.alonzo ? cursor.flag() : false;
    const network = this.era.alonzo ? cursor.flag() : false;
    const collateralOutput = this.era.babbage ? cursor.flag() : false;
    const totalCollateral = this.era.babbage ? cursor.flag() : false;
    const treasury = this.era.conway ? cursor.flag() : false;
    const donation = this.era.conway ? cursor.flag() : false;
    if (
      mint == null ||
      script == null ||
      network == null ||
      collateralOutput == null ||
      totalCollateral == null ||
      treasury == null ||
      donation == null
    ) {
      this.bad = true;
      return;
    }
    if (cursor.u8() == null) {
      this.bad = true;
      return;
    }
    const inputs = cursor.u32();
    const outputs = cursor.u32();
    const certificates = cursor.u32();
    const withdrawals = cursor.u32();
    const witnessesLegacy = this.era.babbage ? 0 : cursor.u32();
    const collateral = this.era.alonzo ? cursor.u32() : 0;
    const signers = this.era.alonzo ? cursor.u32() : 0;
    const references = this.era.babbage ? cursor.u32() : 0;
    const voters = this.era.conway ? cursor.u32() : 0;
    const witnessesBabbage = this.era.babbage ? cursor.u32() : 0;
    if (
      inputs == null ||
      outputs == null ||
      certificates == null ||
      withdrawals == null ||
      witnessesLegacy == null ||
      collateral == null ||
      signers == null ||
      references == null ||
      voters == null ||
      witnessesBabbage == null ||
      cursor.remaining() !== 0 ||
      voters > 0
    ) {
      this.bad = true;
      return;
    }
    this.networkId = networkId;
    this.expect = {
      inputs,
      outputs,
      certificates,
      withdrawals,
      collateral,
      signers,
      references,
      voters,
      ttl,
      aux,
      validity,
      mint,
      script,
      network,
      collateralOutput,
      totalCollateral,
      treasury,
      donation,
    };
  }

  private pushInput(target: Uint8Array[], expected: number, data: Uint8Array): void {
    const cursor = new Cursor(data);
    const hash = cursor.bytes(HASH32);
    const index = cursor.u32();
    if (!hash || index == null || cursor.remaining() !== 0 || target.length >= expected) {
      this.bad = true;
      return;
    }
    target.push(inputCbor(hash, index));
  }

  private readScalar(kind: 'fee', data: Uint8Array): void {
    const cursor = new Cursor(data);
    const value = cursor.u64();
    if (value == null || cursor.remaining() !== 0 || this.fee != null) this.bad = true;
    else this.fee = value;
    void kind;
  }

  private readOptional(
    field: 'ttl' | 'validity' | 'totalCollateral' | 'treasury' | 'donation',
    expected: boolean,
    data: Uint8Array,
  ): void {
    const cursor = new Cursor(data);
    const value = cursor.u64();
    if (!expected || value == null || cursor.remaining() !== 0 || this[field] != null) {
      this.bad = true;
      return;
    }
    this[field] = value;
  }

  private async outputStage(
    kind: 'output' | 'collateral',
    p2: number,
    data: Uint8Array,
    ctx: FamilyContext,
  ): Promise<void> {
    if (p2 === P2_BASIC) {
      if (this.draft) {
        this.bad = true;
        return;
      }
      const basic = await this.readBasic(data, ctx);
      if (!basic) {
        this.bad = true;
        return;
      }
      this.draft = {
        kind,
        format: basic.format,
        address: basic.address,
        amount: basic.amount,
        expectedGroups: basic.groups,
        groups: [],
        includeDatum: basic.includeDatum,
        includeScript: basic.includeScript,
        datum: new Uint8Array(),
        datumLeft: 0,
        script: new Uint8Array(),
        scriptLeft: 0,
      };
      return;
    }
    if (!this.draft || this.draft.kind !== kind) {
      this.bad = true;
      return;
    }
    if (p2 === P2_ASSET || p2 === P2_TOKEN) {
      this.token(this.draft, p2, data, false);
      return;
    }
    if (p2 === P2_DATUM) {
      this.readDatum(data);
      return;
    }
    if (p2 === P2_DATUM_CHUNK || p2 === P2_SCRIPT_CHUNK) {
      this.readChunk(p2 === P2_DATUM_CHUNK ? 'datum' : 'script', data);
      return;
    }
    if (p2 === P2_SCRIPT) {
      this.readScript(data);
      return;
    }
    if (p2 === P2_OUTPUT_CONFIRM) {
      if (data.length !== 0) {
        this.bad = true;
        return;
      }
      const encoded = encodeOutput(this.draft);
      this.draft = null;
      if (!encoded) {
        this.bad = true;
        return;
      }
      if (kind === 'collateral') {
        if (!this.expect.collateralOutput || this.collateralOutput) this.bad = true;
        else this.collateralOutput = encoded;
      } else if (this.outputs.length >= this.expect.outputs) {
        this.bad = true;
      } else {
        this.outputs.push(encoded);
      }
      return;
    }
    this.bad = true;
  }

  private async readBasic(
    data: Uint8Array,
    ctx: FamilyContext,
  ): Promise<{ format: number; address: Uint8Array; amount: bigint; groups: number; includeDatum: boolean; includeScript: boolean } | null> {
    const cursor = new Cursor(data);
    let format = FORMAT_ARRAY;
    if (this.era.babbage) {
      const value = cursor.u8();
      if (value == null) return null;
      format = value;
    }
    const destination = cursor.u8();
    let address: Uint8Array | null = null;
    if (destination === DEST_THIRD_PARTY) {
      const length = cursor.u32();
      address = length == null ? null : cursor.bytes(length);
    } else if (destination === DEST_DEVICE) {
      const tail = data.slice(cursor.offset);
      const read = readShelleyAddress(tail);
      if (!read) return null;
      address = await cardanoOutputAddressBytes(ctx, read.address);
      cursor.offset += read.next;
    }
    const amount = cursor.u64();
    const groups = cursor.u32();
    const includeDatum = this.era.alonzo ? cursor.flag() : false;
    const includeScript = this.era.babbage ? cursor.flag() : false;
    if (!address || amount == null || groups == null || includeDatum == null || includeScript == null) return null;
    if (cursor.remaining() !== 0) return null;
    return { format, address, amount, groups, includeDatum, includeScript };
  }

  private token(draft: Draft, p2: number, data: Uint8Array, signed: boolean): void {
    const cursor = new Cursor(data);
    if (p2 === P2_ASSET) {
      const policy = cursor.bytes(HASH28);
      const count = cursor.u32();
      const open = draft.groups[draft.groups.length - 1];
      if (!policy || count == null || count < 1 || cursor.remaining() !== 0 || (open && open.tokens.length !== open.expected)) {
        this.bad = true;
        return;
      }
      if (draft.groups.length >= draft.expectedGroups) {
        this.bad = true;
        return;
      }
      draft.groups.push({ policy, expected: count, tokens: [] });
      return;
    }
    const length = cursor.u32();
    const name = length == null ? null : cursor.bytes(length);
    const amount = signed ? cursor.i64() : cursor.u64();
    const group = draft.groups[draft.groups.length - 1];
    if (!name || amount == null || !group || cursor.remaining() !== 0 || group.tokens.length >= group.expected) {
      this.bad = true;
      return;
    }
    group.tokens.push({ name, amount });
  }

  private readDatum(data: Uint8Array): void {
    const draft = this.draft;
    if (!draft || !draft.includeDatum || draft.datum.length > 0) {
      this.bad = true;
      return;
    }
    const cursor = new Cursor(data);
    if (!this.era.babbage) {
      const hash = cursor.bytes(HASH32);
      if (!hash || cursor.remaining() !== 0) this.bad = true;
      else draft.datum = cborBytes(hash);
      return;
    }
    const type = cursor.u8();
    if (type === DATUM_HASH) {
      const hash = cursor.bytes(HASH32);
      if (!hash || cursor.remaining() !== 0) {
        this.bad = true;
        return;
      }
      const option = concatBytes(cborType(4, 2n), cborUnsigned(0n), cborBytes(hash));
      draft.datum =
        draft.format === FORMAT_MAP ? concatBytes(cborUnsigned(2n), option) : cborBytes(hash);
      return;
    }
    if (type === DATUM_INLINE) {
      if (draft.format !== FORMAT_MAP) {
        this.bad = true;
        return;
      }
      const total = cursor.u32();
      const size = cursor.u32();
      const chunk = total == null || size == null ? null : cursor.bytes(size);
      if (total == null || !chunk || cursor.remaining() !== 0 || size > total) {
        this.bad = true;
        return;
      }
      draft.datumLeft = total - chunk.length;
      draft.datum = concatBytes(
        cborUnsigned(2n),
        cborType(4, 2n),
        cborUnsigned(1n),
        cborType(6, BigInt(TAG_EMBEDDED)),
        cborType(2, BigInt(total)),
        chunk,
      );
      return;
    }
    this.bad = true;
  }

  private readScript(data: Uint8Array): void {
    const draft = this.draft;
    if (!draft || !draft.includeScript || draft.format !== FORMAT_MAP) {
      this.bad = true;
      return;
    }
    const cursor = new Cursor(data);
    const total = cursor.u32();
    const size = cursor.u32();
    const chunk = total == null || size == null ? null : cursor.bytes(size);
    if (total == null || !chunk || cursor.remaining() !== 0 || size > total) {
      this.bad = true;
      return;
    }
    draft.scriptLeft = total - chunk.length;
    draft.script = concatBytes(
      cborUnsigned(3n),
      cborType(6, BigInt(TAG_EMBEDDED)),
      cborType(2, BigInt(total)),
      chunk,
    );
  }

  private readChunk(kind: 'datum' | 'script', data: Uint8Array): void {
    const draft = this.draft;
    if (!draft) {
      this.bad = true;
      return;
    }
    const cursor = new Cursor(data);
    const size = cursor.u32();
    const chunk = size == null ? null : cursor.bytes(size);
    const left = kind === 'datum' ? draft.datumLeft : draft.scriptLeft;
    if (!chunk || cursor.remaining() !== 0 || chunk.length > left) {
      this.bad = true;
      return;
    }
    if (kind === 'datum') {
      draft.datum = concatBytes(draft.datum, chunk);
      draft.datumLeft -= chunk.length;
    } else {
      draft.script = concatBytes(draft.script, chunk);
      draft.scriptLeft -= chunk.length;
    }
  }

  private async mintStage(p2: number, data: Uint8Array): Promise<void> {
    if (!this.expect.mint) {
      this.bad = true;
      return;
    }
    if (p2 === P2_BASIC) {
      const cursor = new Cursor(data);
      const groups = cursor.u32();
      if (groups == null || groups < 1 || cursor.remaining() !== 0 || this.draft) {
        this.bad = true;
        return;
      }
      this.mintGroups = groups;
      this.draft = {
        kind: 'mint',
        format: FORMAT_ARRAY,
        address: new Uint8Array(),
        amount: 0n,
        expectedGroups: groups,
        groups: [],
        includeDatum: false,
        includeScript: false,
        datum: new Uint8Array(),
        datumLeft: 0,
        script: new Uint8Array(),
        scriptLeft: 0,
      };
      return;
    }
    if (!this.draft || this.draft.kind !== 'mint') {
      this.bad = true;
      return;
    }
    if (p2 === P2_ASSET || p2 === P2_TOKEN) {
      this.token(this.draft, p2, data, true);
      return;
    }
    if (p2 === P2_OUTPUT_CONFIRM) {
      if (data.length !== 0 || this.draft.groups.length !== this.draft.expectedGroups) {
        this.bad = true;
        return;
      }
      this.mintBody = encodeGroups(this.draft.groups, true);
      this.draft = null;
      return;
    }
    this.bad = true;
  }

  private async auxStage(p2: number, data: Uint8Array): Promise<void> {
    if (p2 !== 0 || !this.expect.aux || this.aux) {
      this.bad = true;
      return;
    }
    const cursor = new Cursor(data);
    const type = cursor.u8();
    if (type === AUX_ARBITRARY) {
      const hash = cursor.bytes(HASH32);
      if (!hash || cursor.remaining() !== 0) this.bad = true;
      else this.aux = hash;
      return;
    }
    if (type === AUX_CIP36) {
      this.bad = true;
      return;
    }
    this.bad = true;
  }

  private async credential(cursor: Cursor, ctx: FamilyContext): Promise<{ type: number; hash: Uint8Array } | null> {
    const wire = cursor.u8();
    if (wire === CRED_KEY_HASH || wire === CRED_SCRIPT) {
      const hash = cursor.bytes(HASH28);
      if (!hash) return null;
      return { type: wire === CRED_SCRIPT ? 1 : 0, hash };
    }
    if (wire === CRED_PATH) {
      const path = cursor.path();
      if (!path) return null;
      return { type: 0, hash: await keyHash(ctx, path) };
    }
    return null;
  }

  private async certificate(data: Uint8Array, ctx: FamilyContext): Promise<void> {
    if (this.certificates.length >= this.expect.certificates) {
      this.bad = true;
      return;
    }
    const cursor = new Cursor(data);
    const type = cursor.u8();
    if (type == null || type === 3 || type === 4 || type > 8) {
      this.bad = true;
      return;
    }
    const credential = await this.credential(cursor, ctx);
    if (!credential) {
      this.bad = true;
      return;
    }
    const body = credentialCbor(credential.type, credential.hash);
    if (type === 0 || type === 1) {
      if (cursor.remaining() !== 0) this.bad = true;
      else this.certificates.push(concatBytes(cborType(4, 2n), cborUnsigned(BigInt(type)), body));
      return;
    }
    if (type === 2) {
      const pool = cursor.bytes(HASH28);
      if (!pool || cursor.remaining() !== 0) this.bad = true;
      else this.certificates.push(concatBytes(cborType(4, 3n), cborUnsigned(2n), body, cborBytes(pool)));
      return;
    }
    if (type === 7 || type === 8) {
      const deposit = cursor.u64();
      if (deposit == null || cursor.remaining() !== 0) this.bad = true;
      else {
        this.certificates.push(
          concatBytes(cborType(4, 3n), cborUnsigned(BigInt(type)), body, cborUnsigned(deposit)),
        );
      }
      return;
    }
    this.bad = true;
  }

  private async withdrawal(data: Uint8Array, ctx: FamilyContext): Promise<void> {
    if (this.withdrawals.length >= this.expect.withdrawals) {
      this.bad = true;
      return;
    }
    const cursor = new Cursor(data);
    const amount = cursor.u64();
    if (amount == null) {
      this.bad = true;
      return;
    }
    let hash: Uint8Array | null = null;
    let script = false;
    if (this.era.multisig) {
      const credential = await this.credential(cursor, ctx);
      if (!credential || cursor.remaining() !== 0) {
        this.bad = true;
        return;
      }
      hash = credential.hash;
      script = credential.type === 1;
    } else {
      const path = cursor.path();
      if (!path || cursor.remaining() !== 0) {
        this.bad = true;
        return;
      }
      hash = await keyHash(ctx, path);
    }
    const header = ((script ? 0x0f : 0x0e) << 4) | (this.networkId & 0x0f);
    this.withdrawals.push({ reward: concatBytes(Uint8Array.of(header), hash), amount });
  }

  private async signer(data: Uint8Array, ctx: FamilyContext): Promise<void> {
    if (this.signers.length >= this.expect.signers) {
      this.bad = true;
      return;
    }
    const cursor = new Cursor(data);
    const kind = cursor.u8();
    let hash: Uint8Array | null = null;
    if (kind === 1) hash = cursor.bytes(HASH28);
    else if (kind === 0) {
      const path = cursor.path();
      hash = path ? await keyHash(ctx, path) : null;
    }
    if (!hash || cursor.remaining() !== 0) this.bad = true;
    else this.signers.push(cborBytes(hash));
  }
}
