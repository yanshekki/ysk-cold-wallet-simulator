import { secp256k1 } from '@noble/curves/secp256k1';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { encodeUr } from './bytewords';
import {
  asArray,
  asBytes,
  asMap,
  asUint,
  cborArray,
  cborBytes,
  cborMap,
  cborTag,
  cborUint,
  decodeCbor,
  type CborValue,
} from './cbor';
import { bitcoinP2wpkh, type EthAirgapQr } from './hdkey';
import { decodeKeypath, encodeKeypath } from './paths';
import { encodeFountainParts } from './ur';

const UUID_TAG = 37;
const BTC_MESSAGE = 2;
const BTC_DEFAULT = "m/84'/0'/0'/0/0";

export type BtcSignRequest = {
  requestId: Uint8Array;
  signData: Uint8Array;
  dataType: number;
  path: string;
  sourceFingerprint?: number;
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

function masterFp(seed: Uint8Array): number {
  const master = HDKey.fromMasterSeed(seed);
  if (!master.publicKey) {
    throw new Error('errors.qrBadUr');
  }
  const hash = ripemd160(sha256(master.publicKey));
  return ((hash[0]! << 24) | (hash[1]! << 16) | (hash[2]! << 8) | hash[3]!) >>> 0;
}

export function bitcoinMessageHash(message: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode('\x18Bitcoin Signed Message:\n');
  const compact =
    message.length < 0xfd
      ? Uint8Array.of(message.length)
      : Uint8Array.of(0xfd, message.length & 0xff, message.length >> 8);
  return sha256(sha256(concat(prefix, compact, message)));
}

export function decodeBtcSignRequest(cbor: Uint8Array): BtcSignRequest {
  const map = asMap(decodeCbor(cbor));
  const requestId = map.get(1);
  const signData = map.get(2);
  const dataTypeRaw = map.get(3);
  const pathsRaw = map.get(4);
  if (requestId === undefined || signData === undefined) {
    throw new Error('errors.qrBadUr');
  }
  const dataType = dataTypeRaw !== undefined ? asUint(dataTypeRaw) : BTC_MESSAGE;
  if (dataType !== BTC_MESSAGE) {
    throw new Error('errors.qrUnsupported');
  }
  let path = BTC_DEFAULT;
  let sourceFingerprint: number | undefined;
  if (pathsRaw !== undefined) {
    const first = Array.isArray(pathsRaw) ? asArray(pathsRaw)[0] : pathsRaw;
    if (first !== undefined) {
      const decoded = decodeKeypath(first);
      path = decoded.path;
      sourceFingerprint = decoded.sourceFingerprint;
    }
  }
  return {
    requestId: asUuid(requestId),
    signData: asBytes(signData),
    dataType,
    path,
    sourceFingerprint,
  };
}

export function encodeBtcSignRequestUr(request: BtcSignRequest): string {
  return encodeUr(
    'btc-sign-request',
    cborMap([
      [1, cborTag(UUID_TAG, cborBytes(request.requestId))],
      [2, cborBytes(request.signData)],
      [3, cborUint(BTC_MESSAGE)],
      [4, cborArray([encodeKeypath(request.path, request.sourceFingerprint ?? 0)])],
    ]),
  );
}

export function signBtcMessage(seed: Uint8Array, request: BtcSignRequest): EthAirgapQr {
  if (request.sourceFingerprint && request.sourceFingerprint !== masterFp(seed)) {
    throw new Error('errors.qrXfp');
  }
  const master = HDKey.fromMasterSeed(seed);
  const node = master.derive(request.path);
  if (!node.privateKey || !node.publicKey) {
    throw new Error('errors.qrAddress');
  }
  const hash = bitcoinMessageHash(request.signData);
  const sig = secp256k1.sign(hash, node.privateKey);
  const compact = sig.toCompactRawBytes();
  const encoded = concat(Uint8Array.of((sig.recovery ?? 0) + 27), compact);
  const cbor = cborMap([
    [1, cborTag(UUID_TAG, cborBytes(request.requestId))],
    [2, cborBytes(encoded)],
  ]);
  const ur = encodeUr('btc-signature', cbor);
  const parts = encodeFountainParts('btc-signature', cbor);
  return {
    ur,
    parts: parts.length > 1 ? parts : [ur],
    path: request.path,
    address: bitcoinP2wpkh(node.publicKey),
    fingerprint: masterFp(seed).toString(16).padStart(8, '0'),
    name: 'CWS',
    urKind: 'btc-signature',
  };
}
