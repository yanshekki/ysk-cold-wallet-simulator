import { hmac } from '@noble/hashes/hmac';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';

function asBytes(value: ArrayBuffer | ArrayBufferView | ArrayLike<number>): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return Uint8Array.from(value);
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available');
  }
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function pbkdf2Sync(
  password: ArrayBuffer | ArrayBufferView | ArrayLike<number>,
  salt: ArrayBuffer | ArrayBufferView | ArrayLike<number>,
  iterations: number,
  keylen: number,
  digest: string,
): Uint8Array {
  if (digest !== 'sha256') {
    throw new Error(`unsupported pbkdf2 digest ${digest}`);
  }
  return pbkdf2(sha256, asBytes(password), asBytes(salt), { c: iterations, dkLen: keylen });
}

export function createHmac(algorithm: string, key: ArrayBuffer | ArrayBufferView | ArrayLike<number>) {
  if (algorithm !== 'sha256') {
    throw new Error(`unsupported hmac ${algorithm}`);
  }
  const chunks: Uint8Array[] = [];
  return {
    update(data: ArrayBuffer | ArrayBufferView | ArrayLike<number>) {
      chunks.push(asBytes(data));
      return this;
    },
    digest() {
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const message = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        message.set(chunk, offset);
        offset += chunk.length;
      }
      return hmac(sha256, asBytes(key), message);
    },
  };
}

const nodeCrypto = { randomBytes, pbkdf2Sync, createHmac };

export default nodeCrypto;
