import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { sha256, sha512 } from '@noble/hashes/sha2';
import { HDKey } from '@scure/bip32';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { base58 } from '@scure/base';
import { encodeUr } from './bytewords';
import {
  asBytes,
  asMap,
  asText,
  cborBytes,
  cborMap,
  cborTag,
  cborText,
  decodeCbor,
  type CborValue,
} from './cbor';
import type { EthAirgapQr } from './hdkey';
import { decodeKeypath, encodeKeypath } from './paths';
import { encodeFountainParts } from './ur';

const UUID_TAG = 37;
const SOL_DEFAULT = "m/44'/501'/0'/0'";

export type SolSignRequest = {
  requestId: Uint8Array;
  signData: Uint8Array;
  path: string;
  sourceFingerprint?: number;
  origin?: string;
};

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

function u32be(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function slip10Ed25519(seed: Uint8Array, path: string): Uint8Array {
  let block = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = block.subarray(0, 32);
  let chain = block.subarray(32);
  const parts = path.replace(/^m\/?/, '').split('/').filter(Boolean);
  for (const part of parts) {
    const hardened = part.endsWith("'") || part.endsWith('h') || part.endsWith('H');
    if (!hardened) {
      throw new Error('errors.qrUnsupported');
    }
    const index = 0x80000000 + Number.parseInt(part.slice(0, -1), 10);
    const data = new Uint8Array(1 + key.length + 4);
    data.set(key, 1);
    data.set(u32be(index), 1 + key.length);
    block = hmac(sha512, chain, data);
    key = block.subarray(0, 32);
    chain = block.subarray(32);
  }
  return key;
}

function masterFp(seed: Uint8Array): number {
  const master = HDKey.fromMasterSeed(seed);
  if (!master.publicKey) {
    throw new Error('errors.qrBadUr');
  }
  const hash = ripemd160(sha256(master.publicKey));
  return ((hash[0]! << 24) | (hash[1]! << 16) | (hash[2]! << 8) | hash[3]!) >>> 0;
}

export function decodeSolSignRequest(cbor: Uint8Array): SolSignRequest {
  const map = asMap(decodeCbor(cbor));
  const requestId = map.get(1);
  const signData = map.get(2);
  const pathRaw = map.get(3);
  if (requestId === undefined || signData === undefined || pathRaw === undefined) {
    throw new Error('errors.qrBadUr');
  }
  const keypath = decodeKeypath(pathRaw);
  const originRaw = map.get(4);
  return {
    requestId: asUuid(requestId),
    signData: asBytes(signData),
    path: keypath.path || SOL_DEFAULT,
    sourceFingerprint: keypath.sourceFingerprint,
    origin: originRaw !== undefined ? asText(originRaw) : undefined,
  };
}

export function encodeSolSignRequestUr(request: SolSignRequest): string {
  const entries: Array<[number, Uint8Array]> = [
    [1, cborTag(UUID_TAG, cborBytes(request.requestId))],
    [2, cborBytes(request.signData)],
    [3, encodeKeypath(request.path, request.sourceFingerprint ?? 0)],
  ];
  if (request.origin) {
    entries.push([4, cborText(request.origin)]);
  }
  return encodeUr('sol-sign-request', cborMap(entries));
}

export function signSolRequest(seed: Uint8Array, request: SolSignRequest): EthAirgapQr {
  if (request.sourceFingerprint && request.sourceFingerprint !== masterFp(seed)) {
    throw new Error('errors.qrXfp');
  }
  const privateKey = slip10Ed25519(seed, request.path);
  const signature = ed25519.sign(request.signData, privateKey);
  const cbor = cborMap([
    [1, cborTag(UUID_TAG, cborBytes(request.requestId))],
    [2, cborBytes(signature)],
  ]);
  const ur = encodeUr('sol-signature', cbor);
  const parts = encodeFountainParts('sol-signature', cbor);
  return {
    ur,
    parts: parts.length > 1 ? parts : [ur],
    path: request.path,
    address: base58.encode(ed25519.getPublicKey(privateKey)),
    fingerprint: masterFp(seed).toString(16).padStart(8, '0'),
    name: request.origin ?? 'CWS',
    urKind: 'sol-signature',
  };
}
