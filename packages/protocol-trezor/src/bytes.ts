export function asBytes(value: Uint8Array): Uint8Array {
  const out = new Uint8Array(value.length);
  out.set(value);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

export function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

export function writeU16BE(value: number): Uint8Array {
  return Uint8Array.of((value >> 8) & 0xff, value & 0xff);
}

export function writeU32BE(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export type ByteRng = (length: number) => Uint8Array;

let installedRng: ByteRng | undefined;

export function setRandomBytesImpl(rng: ByteRng | undefined): void {
  installedRng = rng;
}

export function randomBytes(length: number): Uint8Array {
  if (installedRng) {
    const out = installedRng(length);
    if (out.length !== length) {
      throw new Error(`rng returned ${out.length} bytes, expected ${length}`);
    }
    return out;
  }
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const out = new Uint8Array(length);
    webCrypto.getRandomValues(out);
    return out;
  }
  throw new Error('crypto.getRandomValues must be defined');
}
