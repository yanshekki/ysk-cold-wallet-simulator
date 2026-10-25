import { getRandomBytes } from 'expo-crypto';

function getRandomValues<T extends ArrayBufferView>(buffer: T): T {
  const bytes = getRandomBytes(buffer.byteLength);
  new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).set(bytes);
  return buffer;
}

function bytesFrom(value: ArrayBuffer | ArrayBufferView | ArrayLike<number>): Uint8Array {
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

if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  Object.defineProperty(globalThis, 'Buffer', {
    configurable: true,
    value: { from: bytesFrom },
  });
}
