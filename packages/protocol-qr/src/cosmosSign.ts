import { secp256k1 } from '@noble/curves/secp256k1';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { encodeUr } from './bytewords';
import {
  asArray,
  asBytes,
  asMap,
  asText,
  asUint,
  cborArray,
  cborBytes,
  cborMap,
  cborTag,
  cborText,
  cborUint,
  decodeCbor,
  type CborValue,
} from './cbor';
import type { EthAirgapQr } from './hdkey';
import { decodeKeypath, encodeKeypath } from './paths';
import { encodeFountainParts } from './ur';

const UUID_TAG = 37;
const COSMOS_DEFAULT = "m/44'/118'/0'/0/0";

export type CosmosSignRequest = {
  requestId: Uint8Array;
  signData: Uint8Array;
  path: string;
  dataType?: number;
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

function masterFp(seed: Uint8Array): number {
  const master = HDKey.fromMasterSeed(seed);
  if (!master.publicKey) {
    throw new Error('errors.qrBadUr');
  }
  const hash = ripemd160(sha256(master.publicKey));
  return ((hash[0]! << 24) | (hash[1]! << 16) | (hash[2]! << 8) | hash[3]!) >>> 0;
}

export function decodeCosmosSignRequest(cbor: Uint8Array): CosmosSignRequest {
  const map = asMap(decodeCbor(cbor));
  const requestId = map.get(1);
  const signData = map.get(2);
  if (requestId === undefined || signData === undefined) {
    throw new Error('errors.qrBadUr');
  }
  const pathsRaw = map.get(4) ?? map.get(3);
  let path = COSMOS_DEFAULT;
  let sourceFingerprint: number | undefined;
  if (pathsRaw !== undefined) {
    const first = Array.isArray(pathsRaw) ? asArray(pathsRaw)[0] : pathsRaw;
    if (first !== undefined) {
      const decoded = decodeKeypath(first);
      path = decoded.path;
      sourceFingerprint = decoded.sourceFingerprint;
    }
  }
  const originRaw = map.get(6);
  const dataTypeRaw = map.get(3);
  return {
    requestId: asUuid(requestId),
    signData: asBytes(signData),
    path,
    dataType: typeof dataTypeRaw === 'number' ? asUint(dataTypeRaw) : undefined,
    sourceFingerprint,
    origin: originRaw !== undefined ? asText(originRaw) : undefined,
  };
}

export function encodeCosmosSignRequestUr(request: CosmosSignRequest): string {
  return encodeUr(
    'cosmos-sign-request',
    cborMap([
      [1, cborTag(UUID_TAG, cborBytes(request.requestId))],
      [2, cborBytes(request.signData)],
      [3, cborUint(request.dataType ?? 1)],
      [4, cborArray([encodeKeypath(request.path, request.sourceFingerprint ?? 0)])],
      ...(request.origin ? ([[6, cborText(request.origin)]] as Array<[number, Uint8Array]>) : []),
    ]),
  );
}

export function signCosmosRequest(seed: Uint8Array, request: CosmosSignRequest): EthAirgapQr {
  if (request.sourceFingerprint && request.sourceFingerprint !== masterFp(seed)) {
    throw new Error('errors.qrXfp');
  }
  const master = HDKey.fromMasterSeed(seed);
  const node = master.derive(request.path);
  if (!node.privateKey || !node.publicKey) {
    throw new Error('errors.qrAddress');
  }
  const hash = request.signData.length === 32 ? request.signData : sha256(request.signData);
  const compact = secp256k1.sign(hash, node.privateKey).toCompactRawBytes();
  const cbor = cborMap([
    [1, cborTag(UUID_TAG, cborBytes(request.requestId))],
    [2, cborBytes(compact)],
  ]);
  const ur = encodeUr('cosmos-signature', cbor);
  const parts = encodeFountainParts('cosmos-signature', cbor);
  return {
    ur,
    parts: parts.length > 1 ? parts : [ur],
    path: request.path,
    address: Array.from(node.publicKey, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    fingerprint: masterFp(seed).toString(16).padStart(8, '0'),
    name: request.origin ?? 'CWS',
    urKind: 'cosmos-signature',
  };
}
