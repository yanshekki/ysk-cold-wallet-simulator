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

function major(type: number, value: number): Uint8Array {
  if (value < 24) {
    return Uint8Array.of((type << 5) | value);
  }
  if (value < 256) {
    return Uint8Array.of((type << 5) | 24, value);
  }
  if (value < 65536) {
    return Uint8Array.of((type << 5) | 25, (value >> 8) & 0xff, value & 0xff);
  }
  return Uint8Array.of(
    (type << 5) | 26,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

export function cborUint(value: number): Uint8Array {
  return major(0, value >>> 0);
}

export function cborBool(value: boolean): Uint8Array {
  return Uint8Array.of(value ? 0xf5 : 0xf4);
}

export function cborBytes(bytes: Uint8Array): Uint8Array {
  return concat(major(2, bytes.length), bytes);
}

export function cborText(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(major(3, bytes.length), bytes);
}

export function cborArray(items: Uint8Array[]): Uint8Array {
  return concat(major(4, items.length), ...items);
}

export function cborMap(entries: Array<[number, Uint8Array]>): Uint8Array {
  const sorted = [...entries].sort((left, right) => left[0] - right[0]);
  return concat(major(5, sorted.length), ...sorted.flatMap(([key, value]) => [cborUint(key), value]));
}

export function cborTag(tag: number, value: Uint8Array): Uint8Array {
  return concat(major(6, tag), value);
}

export type CborValue =
  | number
  | boolean
  | string
  | Uint8Array
  | CborValue[]
  | { tag: number; value: CborValue }
  | Map<number, CborValue>;

function readUint(bytes: Uint8Array, offset: number, size: number): { value: number; next: number } {
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    value = (value << 8) | bytes[offset + index]!;
  }
  return { value: value >>> 0, next: offset + size };
}

function readArgument(
  bytes: Uint8Array,
  offset: number,
  info: number,
): { argument: number; next: number } {
  if (info < 24) {
    return { argument: info, next: offset };
  }
  if (info === 24) {
    return { argument: bytes[offset]!, next: offset + 1 };
  }
  if (info === 25) {
    const read = readUint(bytes, offset, 2);
    return { argument: read.value, next: read.next };
  }
  if (info === 26) {
    const read = readUint(bytes, offset, 4);
    return { argument: read.value, next: read.next };
  }
  if (info === 27) {
    let value = 0n;
    for (let index = 0; index < 8; index += 1) {
      value = (value << 8n) + BigInt(bytes[offset + index]!);
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('cbor integer too large');
    }
    return { argument: Number(value), next: offset + 8 };
  }
  throw new Error(`unsupported cbor additional info ${info}`);
}

function readItem(bytes: Uint8Array, offset: number): { value: CborValue; next: number } {
  const head = bytes[offset];
  if (head === undefined) {
    throw new Error('truncated cbor');
  }
  const type = head >> 5;
  const info = head & 0x1f;
  if (type === 7 && info >= 20 && info <= 23) {
    if (info === 20) {
      return { value: false, next: offset + 1 };
    }
    if (info === 21) {
      return { value: true, next: offset + 1 };
    }
    throw new Error(`unsupported cbor ${head}`);
  }
  const argument = readArgument(bytes, offset + 1, info);
  let next = argument.next;
  if (type === 0) {
    return { value: argument.argument, next };
  }
  if (type === 2) {
    const end = next + argument.argument;
    if (end > bytes.length) {
      throw new Error('truncated cbor bytes');
    }
    return { value: bytes.subarray(next, end), next: end };
  }
  if (type === 3) {
    const end = next + argument.argument;
    if (end > bytes.length) {
      throw new Error('truncated cbor text');
    }
    return { value: new TextDecoder().decode(bytes.subarray(next, end)), next: end };
  }
  if (type === 4) {
    const items: CborValue[] = [];
    for (let index = 0; index < argument.argument; index += 1) {
      const item = readItem(bytes, next);
      items.push(item.value);
      next = item.next;
    }
    return { value: items, next };
  }
  if (type === 5) {
    const map = new Map<number, CborValue>();
    for (let index = 0; index < argument.argument; index += 1) {
      const key = readItem(bytes, next);
      const value = readItem(bytes, key.next);
      if (typeof key.value !== 'number') {
        throw new Error('expected integer map key');
      }
      map.set(key.value, value.value);
      next = value.next;
    }
    return { value: map, next };
  }
  if (type === 6) {
    const item = readItem(bytes, next);
    return { value: { tag: argument.argument, value: item.value }, next: item.next };
  }
  throw new Error(`unsupported cbor ${head}`);
}

export function decodeCbor(bytes: Uint8Array): CborValue {
  const item = readItem(bytes, 0);
  if (item.next !== bytes.length) {
    throw new Error('trailing cbor');
  }
  return item.value;
}

export function asMap(value: CborValue): Map<number, CborValue> {
  if (!(value instanceof Map)) {
    throw new Error('expected map');
  }
  return value;
}

export function asTag(value: CborValue): { tag: number; value: CborValue } {
  if (!value || typeof value !== 'object' || !('tag' in value) || typeof value.tag !== 'number') {
    throw new Error('expected tag');
  }
  return value;
}

export function asArray(value: CborValue): CborValue[] {
  if (!Array.isArray(value)) {
    throw new Error('expected array');
  }
  return value;
}

export function asBytes(value: CborValue): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error('expected bytes');
  }
  return value;
}

export function asText(value: CborValue): string {
  if (typeof value !== 'string') {
    throw new Error('expected text');
  }
  return value;
}

export function asUint(value: CborValue): number {
  if (typeof value !== 'number' || value < 0) {
    throw new Error('expected uint');
  }
  return value >>> 0;
}
