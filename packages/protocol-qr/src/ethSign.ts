import { secp256k1 } from '@noble/curves/secp256k1';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { HDKey } from '@scure/bip32';
import { encodeUr } from './bytewords';
import {
  asArray,
  asBytes,
  asMap,
  asTag,
  asText,
  asUint,
  cborArray,
  cborBool,
  cborBytes,
  cborMap,
  cborTag,
  cborText,
  cborUint,
  decodeCbor,
  type CborValue,
} from './cbor';
import { hashTypedData, parseEip712 } from './eip712';
import type { EthAirgapQr } from './hdkey';

export const ETH_DATA_TRANSACTION = 1;
export const ETH_DATA_TYPED_DATA = 2;
export const ETH_DATA_PERSONAL = 3;
export const ETH_DATA_TYPED_TRANSACTION = 4;

export type EthSignDataType =
  | typeof ETH_DATA_TRANSACTION
  | typeof ETH_DATA_TYPED_DATA
  | typeof ETH_DATA_PERSONAL
  | typeof ETH_DATA_TYPED_TRANSACTION;

const CRYPTO_KEYPATH = 304;
const UUID_TAG = 37;
const utf8 = new TextEncoder();

export type EthSignRequest = {
  requestId: Uint8Array;
  signData: Uint8Array;
  dataType: EthSignDataType;
  chainId?: number;
  path: string;
  sourceFingerprint?: number;
  address?: string;
  origin?: string;
};

export type EthSignatureResult = {
  signature: Uint8Array;
  qr: EthAirgapQr;
};

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

function fingerprintOf(publicKey: Uint8Array): number {
  const hash = ripemd160(sha256(publicKey));
  return ((hash[0]! << 24) | (hash[1]! << 16) | (hash[2]! << 8) | hash[3]!) >>> 0;
}

function checksumEth(address: string): string {
  const hex = address.replace(/^0x/i, '').toLowerCase();
  const hash = keccak_256(utf8.encode(hex));
  let out = '0x';
  for (let index = 0; index < hex.length; index += 1) {
    const nibble = index % 2 === 0 ? hash[index >> 1]! >> 4 : hash[index >> 1]! & 0x0f;
    out += nibble >= 8 ? hex[index]!.toUpperCase() : hex[index];
  }
  return out;
}

function ethAddress(publicKeyUncompressed: Uint8Array): string {
  const hash = keccak_256(publicKeyUncompressed.subarray(1));
  let hex = '';
  for (const byte of hash.subarray(12)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return checksumEth(hex);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  if (clean.length % 2 !== 0) {
    throw new Error('errors.qrBadUr');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function addressBytes(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length !== 20) {
      throw new Error('errors.qrBadUr');
    }
    return value;
  }
  const bytes = hexToBytes(value);
  if (bytes.length !== 20) {
    throw new Error('errors.qrBadUr');
  }
  return bytes;
}

function addressFrom(value: string | Uint8Array): string {
  let hex = '';
  for (const byte of addressBytes(value)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return checksumEth(hex);
}

function asUuid(value: CborValue): Uint8Array {
  const bytes =
    typeof value === 'object' && value !== null && 'tag' in value && value.tag === UUID_TAG
      ? asBytes(value.value)
      : asBytes(value);
  if (bytes.length !== 16) {
    throw new Error('errors.qrBadUr');
  }
  return bytes;
}

function isDataType(value: number): value is EthSignDataType {
  return (
    value === ETH_DATA_TRANSACTION ||
    value === ETH_DATA_TYPED_DATA ||
    value === ETH_DATA_PERSONAL ||
    value === ETH_DATA_TYPED_TRANSACTION
  );
}

function parsePath(path: string): Array<{ index: number; hardened: boolean }> {
  const parts = path.replace(/^m\/?/i, '').split('/').filter(Boolean);
  return parts.map((part) => {
    const hardened = part.endsWith("'") || part.endsWith('h') || part.endsWith('H');
    const index = Number.parseInt(hardened ? part.slice(0, -1) : part, 10);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('errors.qrBadUr');
    }
    return { index, hardened };
  });
}

function encodeKeypath(path: string, sourceFingerprint: number): Uint8Array {
  const components = parsePath(path);
  const encoded = components.flatMap((item) => [cborUint(item.index), cborBool(item.hardened)]);
  return cborTag(
    CRYPTO_KEYPATH,
    cborMap([
      [1, cborArray(encoded)],
      [2, cborUint(sourceFingerprint)],
      [3, cborUint(components.length)],
    ]),
  );
}

function decodeKeypath(value: CborValue): { path: string; sourceFingerprint?: number } {
  const tagged = asTag(value);
  if (tagged.tag !== CRYPTO_KEYPATH) {
    throw new Error('errors.qrBadUr');
  }
  const map = asMap(tagged.value);
  const raw = map.get(1);
  if (raw === undefined) {
    throw new Error('errors.qrBadUr');
  }
  const components = asArray(raw);
  const parts: string[] = [];
  for (let index = 0; index + 1 < components.length; index += 2) {
    const item = components[index]!;
    const hardenedVal = components[index + 1];
    const hardened = hardenedVal === true;
    if (Array.isArray(item) && item.length === 0) {
      throw new Error('errors.qrBadUr');
    }
    if (typeof item !== 'number') {
      throw new Error('errors.qrBadUr');
    }
    parts.push(`${item}${hardened ? "'" : ''}`);
  }
  const fingerprint = map.get(2);
  return {
    path: parts.length ? `m/${parts.join('/')}` : 'm',
    sourceFingerprint: typeof fingerprint === 'number' ? fingerprint >>> 0 : undefined,
  };
}

function personalMessageHash(message: Uint8Array): Uint8Array {
  const prefix = utf8.encode(`\x19Ethereum Signed Message:\n${message.length}`);
  return keccak_256(concat(prefix, message));
}

function hashSignData(request: EthSignRequest): Uint8Array {
  if (request.dataType === ETH_DATA_PERSONAL) {
    return personalMessageHash(request.signData);
  }
  if (request.dataType === ETH_DATA_TYPED_DATA) {
    return hashTypedData(request.signData);
  }
  return keccak_256(request.signData);
}

function signHash(privateKey: Uint8Array, hash: Uint8Array, recoveryOffset: number): Uint8Array {
  const sig = secp256k1.sign(hash, privateKey);
  const compact = sig.toCompactRawBytes();
  const out = new Uint8Array(65);
  out.set(compact, 0);
  out[64] = (sig.recovery ?? 0) + recoveryOffset;
  return out;
}

function deriveEth(seed: Uint8Array, path: string): { privateKey: Uint8Array; address: string; masterFp: number } {
  const master = HDKey.fromMasterSeed(seed);
  if (!master.publicKey) {
    throw new Error('errors.qrBadUr');
  }
  const node = master.derive(path);
  if (!node.privateKey) {
    throw new Error('errors.qrBadUr');
  }
  const uncompressed = secp256k1.getPublicKey(node.privateKey, false);
  return {
    privateKey: node.privateKey,
    address: ethAddress(uncompressed),
    masterFp: fingerprintOf(master.publicKey),
  };
}

export function assertEthSignMatchesSeed(seed: Uint8Array, request: EthSignRequest): { address: string; fingerprint: string } {
  const derived = deriveEth(seed, request.path);
  if (request.sourceFingerprint != null && request.sourceFingerprint !== derived.masterFp) {
    throw new Error('errors.qrXfp');
  }
  if (request.address && request.address.toLowerCase() !== derived.address.toLowerCase()) {
    throw new Error('errors.qrAddress');
  }
  return {
    address: derived.address,
    fingerprint: derived.masterFp.toString(16).padStart(8, '0'),
  };
}

export function encodeEthSignRequestCbor(request: EthSignRequest): Uint8Array {
  const entries: Array<[number, Uint8Array]> = [
    [1, cborTag(UUID_TAG, cborBytes(request.requestId))],
    [2, cborBytes(request.signData)],
    [3, cborUint(request.dataType)],
  ];
  if (request.chainId != null) {
    entries.push([4, cborUint(request.chainId)]);
  }
  entries.push([5, encodeKeypath(request.path, request.sourceFingerprint ?? 0)]);
  if (request.address) {
    entries.push([6, cborBytes(addressBytes(request.address))]);
  }
  if (request.origin) {
    entries.push([7, cborText(request.origin)]);
  }
  return cborMap(entries);
}

export function encodeEthSignRequestUr(request: EthSignRequest): string {
  return encodeUr('eth-sign-request', encodeEthSignRequestCbor(request));
}

export function decodeEthSignRequest(cbor: Uint8Array): EthSignRequest {
  const map = asMap(decodeCbor(cbor));
  const requestId = map.get(1);
  const signData = map.get(2);
  const dataTypeRaw = map.get(3);
  const pathRaw = map.get(5);
  if (requestId === undefined || signData === undefined || dataTypeRaw === undefined || pathRaw === undefined) {
    throw new Error('errors.qrBadUr');
  }
  const dataType = asUint(dataTypeRaw);
  if (!isDataType(dataType)) {
    throw new Error('errors.qrUnsupported');
  }
  const keypath = decodeKeypath(pathRaw);
  const chainRaw = map.get(4);
  const addressRaw = map.get(6);
  const originRaw = map.get(7);
  return {
    requestId: asUuid(requestId),
    signData: asBytes(signData),
    dataType,
    chainId: chainRaw === undefined ? undefined : asUint(chainRaw),
    path: keypath.path,
    sourceFingerprint: keypath.sourceFingerprint,
    address: addressRaw === undefined ? undefined : addressFrom(asBytes(addressRaw)),
    origin: originRaw === undefined ? undefined : asText(originRaw),
  };
}

export function encodeEthSignatureCbor(requestId: Uint8Array, signature: Uint8Array, origin = 'CWS'): Uint8Array {
  if (requestId.length !== 16 || signature.length !== 65) {
    throw new Error('errors.qrBadUr');
  }
  return cborMap([
    [1, cborTag(UUID_TAG, cborBytes(requestId))],
    [2, cborBytes(signature)],
    [3, cborText(origin)],
  ]);
}

export function encodeEthSignatureUr(requestId: Uint8Array, signature: Uint8Array, origin = 'CWS'): string {
  return encodeUr('eth-signature', encodeEthSignatureCbor(requestId, signature, origin));
}

export function decodeEthSignature(cbor: Uint8Array): { requestId: Uint8Array; signature: Uint8Array; origin?: string } {
  const map = asMap(decodeCbor(cbor));
  const requestId = map.get(1);
  const signature = map.get(2);
  if (requestId === undefined || signature === undefined) {
    throw new Error('errors.qrBadUr');
  }
  const origin = map.get(3);
  const sig = asBytes(signature);
  if (sig.length !== 65) {
    throw new Error('errors.qrBadUr');
  }
  return {
    requestId: asUuid(requestId),
    signature: sig,
    origin: origin === undefined ? undefined : asText(origin),
  };
}

export function signEthRequest(seed: Uint8Array, request: EthSignRequest, origin = request.origin ?? 'CWS'): EthSignatureResult {
  const matched = assertEthSignMatchesSeed(seed, request);
  const derived = deriveEth(seed, request.path);
  const recoveryOffset = request.dataType === ETH_DATA_TYPED_TRANSACTION ? 0 : 27;
  const signature = signHash(derived.privateKey, hashSignData(request), recoveryOffset);
  return {
    signature,
    qr: {
      ur: encodeEthSignatureUr(request.requestId, signature, origin),
      path: request.path,
      address: matched.address,
      fingerprint: matched.fingerprint,
      name: origin,
      urKind: 'eth-signature',
    },
  };
}

export function eip712Preview(signData: Uint8Array): { primaryType?: string; domainName?: string } {
  try {
    const typed = parseEip712(signData);
    const domainName = typed.domain.name;
    return {
      primaryType: typed.primaryType,
      domainName: typeof domainName === 'string' ? domainName : undefined,
    };
  } catch {
    return {};
  }
}

