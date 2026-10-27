import { Buffer } from 'buffer';
import { getRandomBytes } from 'expo-crypto';

const gBuffer = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
const existing = gBuffer.Buffer;
if (!existing || typeof existing.from !== 'function' || typeof existing.alloc !== 'function') {
  try {
    gBuffer.Buffer = Buffer;
  } catch {
    try {
      Object.defineProperty(globalThis, 'Buffer', {
        configurable: true,
        writable: true,
        value: Buffer,
      });
    } catch {
      // Hermes may freeze Buffer; protocol-qr installs its own copy if missing.
    }
  }
}

function getRandomValues<T extends ArrayBufferView>(buffer: T): T {
  const bytes = getRandomBytes(buffer.byteLength);
  new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).set(bytes);
  return buffer;
}

export function expoRng(length: number): Uint8Array {
  const bytes = getRandomBytes(length);
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

const cryptoShim = { getRandomValues };

const g = globalThis as typeof globalThis & {
  crypto?: { getRandomValues?: (buffer: ArrayBufferView) => ArrayBufferView };
};

try {
  if (!g.crypto) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: cryptoShim,
    });
  } else if (typeof g.crypto.getRandomValues !== 'function') {
    try {
      g.crypto.getRandomValues = getRandomValues;
    } catch {
      Object.defineProperty(g.crypto, 'getRandomValues', {
        configurable: true,
        writable: true,
        value: getRandomValues,
      });
    }
  }
} catch {
  // Hermes may freeze the host crypto object; protocol handlers inject expoRng.
}

try {
  const unbound = (globalThis as { crypto?: typeof cryptoShim }).crypto;
  if (unbound && typeof unbound.getRandomValues !== 'function') {
    unbound.getRandomValues = getRandomValues;
  }
} catch {
  // ignore
}

