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

const g = globalThis as typeof globalThis & {
  crypto?: { getRandomValues?: (buffer: ArrayBufferView) => ArrayBufferView };
};

if (!g.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues },
  });
} else if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = getRandomValues;
}

if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  Object.defineProperty(globalThis, 'Buffer', {
    configurable: true,
    value: { from: bytesFrom },
  });
}
