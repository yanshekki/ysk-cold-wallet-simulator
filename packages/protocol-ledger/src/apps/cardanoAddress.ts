import { blake2b } from '@noble/hashes/blake2b';
import { sha3_256 } from '@noble/hashes/sha3';
import type { FamilyContext } from './generic';
import { concatBytes, readU32BE } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_DENY,
  SW_OK,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import { icarusRootFor } from '../crypto';
import { deriveIcarus, deriveIcarusFromRoot } from './icarus';

/**
 * LedgerHQ/app-cardano `addressUtilsShelley.c` and `derive_address.c`.
 * Byron (`08`) stays `6D00`. Shelley bytes are header ‖ credentials.
 */
const SW_ADDRESS_PARAMS = 0x6b06;
const SW_WRONG_DATA = 0x6a87;
const SW_SECURITY = 0x6982;
const HARD = 0x80000000;

const STAKE_NONE = 0x11;
const STAKE_PATH = 0x22;
const STAKE_KEY = 0x33;
const STAKE_POINTER = 0x44;
const STAKE_SCRIPT = 0x55;

type Stake =
  | { kind: 'none' }
  | { kind: 'path'; path: string; components: number[] }
  | { kind: 'key'; bytes: Uint8Array }
  | { kind: 'script'; bytes: Uint8Array }
  | { kind: 'pointer'; block: number; tx: number; cert: number };

export type ShelleyAddress = {
  type: number;
  networkId: number;
  protocolMagic?: number;
  paymentPath?: string;
  paymentComponents?: number[];
  paymentScript?: Uint8Array;
  stake: Stake;
};

type Read = { address: ShelleyAddress; next: number } | null;

const MAINNET_MAGIC = 764824073;

function hard(index: number): number {
  return (index | HARD) >>> 0;
}

function isHard(value: number): boolean {
  return (value & HARD) !== 0;
}

function byronPayment(components: number[]): boolean {
  return (
    components.length === 5 &&
    components[0] === hard(44) &&
    components[1] === hard(1815) &&
    isHard(components[2] ?? 0) &&
    (components[3] === 0 || components[3] === 1)
  );
}

function shelleyPayment(components: number[]): boolean {
  return (
    components.length === 5 &&
    components[0] === hard(1852) &&
    components[1] === hard(1815) &&
    isHard(components[2] ?? 0) &&
    (components[3] === 0 || components[3] === 1)
  );
}

function stakingKey(components: number[]): boolean {
  return (
    components.length === 5 &&
    components[0] === hard(1852) &&
    components[1] === hard(1815) &&
    isHard(components[2] ?? 0) &&
    components[3] === 2 &&
    !isHard(components[4] ?? 0)
  );
}

function takePath(data: Uint8Array, offset: number): { path: string; components: number[]; next: number } | null {
  const slice = data.subarray(offset);
  if (slice.length < 1 || slice[0] === 0 || slice[0] > 5) {
    return null;
  }
  try {
    const parsed = parseBip32Path(slice);
    const components: number[] = [];
    for (let i = 0; i < slice[0]; i += 1) {
      components.push(readU32BE(slice, 1 + i * 4));
    }
    return { path: parsed.path, components, next: offset + 1 + slice[0] * 4 };
  } catch {
    return null;
  }
}

function take(data: Uint8Array, offset: number, size: number): Uint8Array | null {
  if (data.length < offset + size) {
    return null;
  }
  return data.slice(offset, offset + size);
}

/** `buffer_read_address_params` for Shelley and Byron. */
export function readShelleyAddress(data: Uint8Array): Read {
  if (data.length < 1) {
    return null;
  }
  const type = data[0] ?? 0;
  const shelley = (type >= 0x00 && type <= 0x07) || type === 0x0e || type === 0x0f;
  if (type !== 0x08 && !shelley) {
    return null;
  }
  let offset = 1;
  const address: ShelleyAddress = { type, networkId: 0, stake: { kind: 'none' } };
  if (type === 0x08) {
    if (data.length < 5) {
      return null;
    }
    address.protocolMagic = readU32BE(data, 1);
    const path = takePath(data, 5);
    if (!path) {
      return null;
    }
    address.paymentPath = path.path;
    address.paymentComponents = path.components;
    offset = path.next;
  } else {
    if (data.length <= offset || (data[offset] ?? 0) > 0x0f) {
      return null;
    }
    address.networkId = data[offset] ?? 0;
    offset += 1;
  }
  const keyPayment = type === 0x00 || type === 0x02 || type === 0x04 || type === 0x06;
  const scriptPayment = type === 0x01 || type === 0x03 || type === 0x05 || type === 0x07;
  if (type !== 0x08 && keyPayment) {
    const path = takePath(data, offset);
    if (!path) {
      return null;
    }
    address.paymentPath = path.path;
    address.paymentComponents = path.components;
    offset = path.next;
  } else if (type !== 0x08 && scriptPayment) {
    const hash = take(data, offset, 28);
    if (!hash) {
      return null;
    }
    address.paymentScript = hash;
    offset += 28;
  }
  if (data.length <= offset) {
    return null;
  }
  const choice = data[offset] ?? 0;
  offset += 1;
  if (choice === STAKE_NONE) {
    address.stake = { kind: 'none' };
  } else if (choice === STAKE_PATH) {
    const path = takePath(data, offset);
    if (!path) {
      return null;
    }
    address.stake = { kind: 'path', path: path.path, components: path.components };
    offset = path.next;
  } else if (choice === STAKE_KEY || choice === STAKE_SCRIPT) {
    const hash = take(data, offset, 28);
    if (!hash) {
      return null;
    }
    address.stake = { kind: choice === STAKE_KEY ? 'key' : 'script', bytes: hash };
    offset += 28;
  } else if (choice === STAKE_POINTER) {
    if (data.length < offset + 12) {
      return null;
    }
    address.stake = {
      kind: 'pointer',
      block: readU32BE(data, offset),
      tx: readU32BE(data, offset + 4),
      cert: readU32BE(data, offset + 8),
    };
    offset += 12;
  } else {
    return null;
  }
  return { address, next: offset };
}

/** `isValidAddressParams` plus the derive-address policy denials. */
export function shelleyAddressAllowed(address: ShelleyAddress): boolean {
  const stake = address.stake.kind;
  switch (address.type) {
    case 0x00:
    case 0x01:
    case 0x0e:
      if (stake !== 'path' && stake !== 'key') {
        return false;
      }
      break;
    case 0x02:
    case 0x03:
      if (stake !== 'script' && stake !== 'pointer') {
        return false;
      }
      break;
    case 0x04:
    case 0x05:
      if (stake !== 'pointer') {
        return false;
      }
      break;
    case 0x0f:
      if (stake !== 'script') {
        return false;
      }
      break;
    case 0x06:
    case 0x07:
      if (stake !== 'none') {
        return false;
      }
      break;
    case 0x08:
      if (stake !== 'none' || !address.paymentComponents || !byronPayment(address.paymentComponents)) {
        return false;
      }
      break;
    default:
      return false;
  }
  if (address.stake.kind === 'path' && !stakingKey(address.stake.components)) {
    return false;
  }
  const keyPayment = address.type === 0x00 || address.type === 0x02 || address.type === 0x04 || address.type === 0x06;
  const scriptPayment = address.type === 0x01 || address.type === 0x03 || address.type === 0x05 || address.type === 0x07;
  if (keyPayment) {
    if (!address.paymentComponents || !shelleyPayment(address.paymentComponents)) {
      return false;
    }
  } else if (scriptPayment && !address.paymentScript) {
    return false;
  }
  if ((address.type === 0x01 || address.type === 0x0e) && address.stake.kind !== 'path') {
    return false;
  }
  return true;
}

export function cip8AddressType(type: number): boolean {
  return type === 0x00 || type === 0x02 || type === 0x06 || type === 0x0e;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function varUint(value: number): Uint8Array {
  if (value === 0) {
    return Uint8Array.of(0);
  }
  const chunks: number[] = [];
  let bits = value >>> 0;
  while (bits > 0) {
    chunks.push(bits & 0x7f);
    bits >>>= 7;
  }
  const out: number[] = [];
  for (let i = chunks.length - 1; i > 0; i -= 1) {
    out.push((chunks[i] ?? 0) | 0x80);
  }
  out.push(chunks[0] ?? 0);
  return Uint8Array.from(out);
}

async function icarusNode(ctx: FamilyContext, path: string) {
  const resolved = ctx.confirmation.resolvePath?.(path, ['ada']) ?? path;
  const root = await icarusRootFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  return root
    ? deriveIcarusFromRoot(root, resolved)
    : deriveIcarus(ctx.entropy, resolved, undefined, ctx.backup);
}

async function hashPath(ctx: FamilyContext, path: string): Promise<Uint8Array> {
  return blake2b((await icarusNode(ctx, path)).publicKey, { dkLen: 28 });
}

function cborHead(major: number, value: number): Uint8Array {
  const type = (major << 5) & 0xe0;
  if (value < 24) {
    return Uint8Array.of(type | value);
  }
  if (value < 256) {
    return Uint8Array.of(type | 24, value);
  }
  if (value < 65536) {
    return Uint8Array.of(type | 25, (value >> 8) & 0xff, value & 0xff);
  }
  return Uint8Array.of(type | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function cborBytes(value: Uint8Array): Uint8Array {
  return concatBytes(cborHead(2, value.length), value);
}

/** Reflected IEEE CRC-32, the same polynomial as Ledger `cx_crc32`. */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function byronAddressBytes(ctx: FamilyContext, address: ShelleyAddress): Promise<Uint8Array> {
  const node = await icarusNode(ctx, address.paymentPath ?? 'm');
  const extended = concatBytes(node.publicKey, node.chainCode);
  const rootInput = concatBytes(
    cborHead(4, 3),
    cborHead(0, 0),
    cborHead(4, 2),
    cborHead(0, 0),
    cborBytes(extended),
    cborHead(5, 0),
  );
  const root = blake2b(sha3_256(rootInput), { dkLen: 28 });
  const magic = address.protocolMagic ?? 0;
  const attributes =
    magic === MAINNET_MAGIC
      ? cborHead(5, 0)
      : concatBytes(cborHead(5, 1), cborHead(0, 2), cborBytes(cborHead(0, magic)));
  const inner = concatBytes(cborHead(4, 3), cborBytes(root), attributes, cborHead(0, 0));
  return concatBytes(cborHead(4, 2), cborHead(6, 24), cborBytes(inner), cborHead(0, crc32(inner)));
}

export async function shelleyAddressBytes(ctx: FamilyContext, address: ShelleyAddress): Promise<Uint8Array> {
  const parts: Uint8Array[] = [Uint8Array.of(((address.type << 4) | address.networkId) & 0xff)];
  const reward = address.type === 0x0e || address.type === 0x0f;
  if (!reward && address.paymentPath) {
    parts.push(await hashPath(ctx, address.paymentPath));
  } else if (!reward && address.paymentScript) {
    parts.push(address.paymentScript);
  }
  if (address.stake.kind === 'path') {
    parts.push(await hashPath(ctx, address.stake.path));
  } else if (address.stake.kind === 'key' || address.stake.kind === 'script') {
    parts.push(address.stake.bytes);
  } else if (address.stake.kind === 'pointer') {
    parts.push(varUint(address.stake.block), varUint(address.stake.tx), varUint(address.stake.cert));
  }
  return concatBytes(...parts);
}

export async function handleCardanoDeriveAddress(apdu: Apdu, ctx: FamilyContext): Promise<Uint8Array> {
  if (apdu.p2 !== 0x00 || (apdu.p1 !== 0x01 && apdu.p1 !== 0x02)) {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  const read = readShelleyAddress(apdu.data);
  if (!read || read.next !== apdu.data.length) {
    return encodeResponse(new Uint8Array(), !read ? SW_ADDRESS_PARAMS : SW_WRONG_DATA);
  }
  if (!shelleyAddressAllowed(read.address)) {
    return encodeResponse(new Uint8Array(), SW_SECURITY);
  }
  const bytes =
    read.address.type === 0x08
      ? await byronAddressBytes(ctx, read.address)
      : await shelleyAddressBytes(ctx, read.address);
  if (apdu.p1 === 0x01) {
    return encodeResponse(bytes, SW_OK);
  }
  const ok = await ctx.confirmation.confirm({
    brand: 'ledger',
    kind: 'address',
    title: 'Verify Cardano address',
    path:
      read.address.paymentPath ??
      (read.address.stake.kind === 'path' ? read.address.stake.path : 'cardano-address'),
    message: `Verify Cardano address\n${hex(bytes)}`,
    rawPayload: bytes,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  return encodeResponse(new Uint8Array(), SW_OK);
}
