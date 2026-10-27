import {
  asArray,
  asMap,
  asTag,
  asUint,
  cborArray,
  cborBool,
  cborMap,
  cborTag,
  cborUint,
  type CborValue,
} from './cbor';

const CRYPTO_KEYPATH = 304;

export function parsePath(path: string): Array<{ index: number; hardened: boolean }> {
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

export function encodeKeypath(path: string, sourceFingerprint: number): Uint8Array {
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

export function decodeKeypath(value: CborValue): { path: string; sourceFingerprint?: number } {
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
    if (typeof item !== 'number') {
      throw new Error('errors.qrBadUr');
    }
    parts.push(`${item}${hardened ? "'" : ''}`);
  }
  const fingerprint = map.get(2);
  return {
    path: parts.length ? `m/${parts.join('/')}` : 'm',
    sourceFingerprint: typeof fingerprint === 'number' ? asUint(fingerprint) : undefined,
  };
}

export function fingerprintOf(publicKey: Uint8Array, hash160: (bytes: Uint8Array) => Uint8Array): number {
  const hash = hash160(publicKey);
  return ((hash[0]! << 24) | (hash[1]! << 16) | (hash[2]! << 8) | hash[3]!) >>> 0;
}
