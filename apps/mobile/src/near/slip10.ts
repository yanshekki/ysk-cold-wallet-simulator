import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';

const utf8 = new TextEncoder();

function u32be(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function slip10Ed25519(seed: Uint8Array, path: string): Uint8Array {
  let block = hmac(sha512, utf8.encode('ed25519 seed'), seed);
  let key = block.subarray(0, 32);
  let chain = block.subarray(32);
  const parts = path.replace(/^m\/?/, '').split('/').filter(Boolean);
  for (const part of parts) {
    if (!part.endsWith("'")) {
      throw new Error(`SLIP-10 ed25519 path must be hardened (${path})`);
    }
    const index = 0x80000000 + Number.parseInt(part.slice(0, -1), 10);
    block = hmac(sha512, chain, concatBytes(Uint8Array.of(0x00), key, u32be(index)));
    key = block.subarray(0, 32);
    chain = block.subarray(32);
  }
  return key;
}
