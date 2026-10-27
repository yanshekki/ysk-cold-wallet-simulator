import { keccak_256 } from '@noble/hashes/sha3';

type TypedField = { name: string; type: string };
type TypedTypes = Record<string, TypedField[]>;

export type Eip712TypedData = {
  types: TypedTypes;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
};

const utf8 = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function keccak(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

function padLeft(bytes: Uint8Array, size: number): Uint8Array {
  if (bytes.length > size) {
    throw new Error('errors.qrUnsupported');
  }
  const out = new Uint8Array(size);
  out.set(bytes, size - bytes.length);
  return out;
}

function bigintFrom(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error('errors.qrUnsupported');
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
      return BigInt(trimmed);
    }
    return BigInt(trimmed);
  }
  throw new Error('errors.qrUnsupported');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('errors.qrUnsupported');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function encodeAddress(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length !== 20) {
      throw new Error('errors.qrUnsupported');
    }
    return padLeft(value, 32);
  }
  if (typeof value !== 'string') {
    throw new Error('errors.qrUnsupported');
  }
  const bytes = hexToBytes(value);
  if (bytes.length !== 20) {
    throw new Error('errors.qrUnsupported');
  }
  return padLeft(bytes, 32);
}

function encodeInt(value: unknown): Uint8Array {
  const n = bigintFrom(value);
  const out = new Uint8Array(32);
  let remaining = n < 0n ? (1n << 256n) + n : n;
  for (let index = 31; index >= 0; index -= 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function encodeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === 'string') {
    return hexToBytes(value);
  }
  throw new Error('errors.qrUnsupported');
}

function arrayInfo(type: string): { inner: string } | null {
  if (!type.endsWith(']')) {
    return null;
  }
  const start = type.lastIndexOf('[');
  if (start < 0) {
    return null;
  }
  return { inner: type.slice(0, start) };
}

function collectDeps(primary: string, types: TypedTypes, found: Set<string>): void {
  const inner = arrayInfo(primary)?.inner ?? primary;
  if (!types[inner] || found.has(inner)) {
    return;
  }
  found.add(inner);
  for (const field of types[inner] ?? []) {
    collectDeps(field.type, types, found);
  }
}

function encodeType(primary: string, types: TypedTypes): string {
  const found = new Set<string>();
  collectDeps(primary, types, found);
  found.delete(primary);
  const ordered = [primary, ...[...found].sort()];
  return ordered
    .map((name) => {
      const fields = types[name];
      if (!fields) {
        throw new Error('errors.qrUnsupported');
      }
      return `${name}(${fields.map((field) => `${field.type} ${field.name}`).join(',')})`;
    })
    .join('');
}

function typeHash(primary: string, types: TypedTypes): Uint8Array {
  return keccak(utf8.encode(encodeType(primary, types)));
}

function encodeAtomic(type: string, value: unknown): Uint8Array {
  if (type === 'string') {
    return keccak(utf8.encode(String(value)));
  }
  if (type === 'bytes') {
    return keccak(encodeBytes(value));
  }
  if (type === 'bool') {
    return padLeft(Uint8Array.of(value ? 1 : 0), 32);
  }
  if (type === 'address') {
    return encodeAddress(value);
  }
  if (type.startsWith('bytes')) {
    const size = Number.parseInt(type.slice(5), 10);
    const bytes = encodeBytes(value);
    if (!Number.isInteger(size) || size < 1 || size > 32 || bytes.length > size) {
      throw new Error('errors.qrUnsupported');
    }
    const out = new Uint8Array(32);
    out.set(bytes);
    return out;
  }
  if (type.startsWith('uint') || type.startsWith('int')) {
    return encodeInt(value);
  }
  throw new Error('errors.qrUnsupported');
}

function encodeField(types: TypedTypes, type: string, value: unknown): Uint8Array {
  const array = arrayInfo(type);
  if (array) {
    if (!Array.isArray(value)) {
      throw new Error('errors.qrUnsupported');
    }
    return keccak(concat(...value.map((item) => encodeField(types, array.inner, item))));
  }
  if (types[type]) {
    if (!value || typeof value !== 'object') {
      throw new Error('errors.qrUnsupported');
    }
    return hashStruct(type, types, value as Record<string, unknown>);
  }
  return encodeAtomic(type, value);
}

function hashStruct(primary: string, types: TypedTypes, data: Record<string, unknown>): Uint8Array {
  const fields = types[primary];
  if (!fields) {
    throw new Error('errors.qrUnsupported');
  }
  return keccak(
    concat(typeHash(primary, types), ...fields.map((field) => encodeField(types, field.type, data[field.name]))),
  );
}

const DOMAIN_FIELDS: TypedField[] = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
];

function domainTypes(types: TypedTypes, domain: Record<string, unknown>): TypedTypes {
  if (types.EIP712Domain) {
    return types;
  }
  return {
    ...types,
    EIP712Domain: DOMAIN_FIELDS.filter((field) => domain[field.name] != null),
  };
}

export function parseEip712(json: Uint8Array | string): Eip712TypedData {
  const text = typeof json === 'string' ? json : new TextDecoder().decode(json);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('errors.qrUnsupported');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('errors.qrUnsupported');
  }
  const body = parsed as Partial<Eip712TypedData>;
  if (!body.types || typeof body.types !== 'object' || typeof body.primaryType !== 'string') {
    throw new Error('errors.qrUnsupported');
  }
  if (!body.domain || typeof body.domain !== 'object' || !body.message || typeof body.message !== 'object') {
    throw new Error('errors.qrUnsupported');
  }
  return {
    types: body.types,
    primaryType: body.primaryType,
    domain: body.domain as Record<string, unknown>,
    message: body.message as Record<string, unknown>,
  };
}

export function hashTypedData(json: Uint8Array | string | Eip712TypedData): Uint8Array {
  const typed = typeof json === 'object' && !(json instanceof Uint8Array) ? json : parseEip712(json);
  const types = domainTypes(typed.types, typed.domain);
  return keccak(
    concat(
      Uint8Array.of(0x19, 0x01),
      hashStruct('EIP712Domain', types, typed.domain),
      hashStruct(typed.primaryType, types, typed.message),
    ),
  );
}
