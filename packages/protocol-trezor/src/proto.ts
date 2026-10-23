import { concatBytes, decodeUtf8, encodeUtf8 } from './bytes';

export const WIRE_VARINT = 0;
export const WIRE_LEN = 2;

export type DecodedField = {
  field: number;
  wire: number;
  varint: number;
  bytes: Uint8Array;
};

export function encodeVarint(value: number): Uint8Array {
  let n = value >>> 0;
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Uint8Array.from(out);
}

export function decodeVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < bytes.length) {
    const byte = bytes[index];
    value |= (byte & 0x7f) << shift;
    index += 1;
    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, next: index };
    }
    shift += 7;
    if (shift > 35) {
      throw new Error('varint too long');
    }
  }
  throw new Error('truncated varint');
}

export function encodeKey(field: number, wire: number): Uint8Array {
  return encodeVarint((field << 3) | wire);
}

export function encodeUint32(field: number, value: number): Uint8Array {
  return concatBytes(encodeKey(field, WIRE_VARINT), encodeVarint(value >>> 0));
}

export function encodeBool(field: number, value: boolean): Uint8Array {
  return encodeUint32(field, value ? 1 : 0);
}

export function encodeBytes(field: number, value: Uint8Array): Uint8Array {
  return concatBytes(encodeKey(field, WIRE_LEN), encodeVarint(value.length), value);
}

export function encodeString(field: number, value: string): Uint8Array {
  return encodeBytes(field, encodeUtf8(value));
}

export function encodeMessage(field: number, value: Uint8Array): Uint8Array {
  return encodeBytes(field, value);
}

export function encodeRepeatedUint32(field: number, values: number[]): Uint8Array {
  return concatBytes(...values.map((value) => encodeUint32(field, value)));
}

export function encodePackedUint32(field: number, values: number[]): Uint8Array {
  const packed = concatBytes(...values.map((value) => encodeVarint(value >>> 0)));
  return encodeBytes(field, packed);
}

export function decodeFields(bytes: Uint8Array): DecodedField[] {
  const fields: DecodedField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = decodeVarint(bytes, offset);
    const field = key.value >>> 3;
    const wire = key.value & 7;
    offset = key.next;
    if (wire === WIRE_VARINT) {
      const decoded = decodeVarint(bytes, offset);
      fields.push({
        field,
        wire,
        varint: decoded.value,
        bytes: new Uint8Array(),
      });
      offset = decoded.next;
    } else if (wire === WIRE_LEN) {
      const length = decodeVarint(bytes, offset);
      const start = length.next;
      const end = start + length.value;
      if (end > bytes.length) {
        throw new Error('truncated length-delimited field');
      }
      fields.push({
        field,
        wire,
        varint: length.value,
        bytes: bytes.slice(start, end),
      });
      offset = end;
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

export function readString(field: DecodedField): string {
  return decodeUtf8(field.bytes);
}

export function readPackedOrRepeatedUint32(fields: DecodedField[], number: number): number[] {
  const values: number[] = [];
  for (const field of fields) {
    if (field.field !== number) {
      continue;
    }
    if (field.wire === WIRE_VARINT) {
      values.push(field.varint);
    } else if (field.wire === WIRE_LEN) {
      let offset = 0;
      while (offset < field.bytes.length) {
        const decoded = decodeVarint(field.bytes, offset);
        values.push(decoded.value);
        offset = decoded.next;
      }
    }
  }
  return values;
}

export function readOptionalBool(fields: DecodedField[], number: number): boolean | undefined {
  const field = fields.find((item) => item.field === number && item.wire === WIRE_VARINT);
  if (!field) {
    return undefined;
  }
  return field.varint !== 0;
}

export function readOptionalBytes(fields: DecodedField[], number: number): Uint8Array | undefined {
  const field = fields.find((item) => item.field === number && item.wire === WIRE_LEN);
  return field?.bytes;
}

export function readOptionalString(fields: DecodedField[], number: number): string | undefined {
  const field = fields.find((item) => item.field === number && item.wire === WIRE_LEN);
  return field ? readString(field) : undefined;
}

export function readOptionalUint32(fields: DecodedField[], number: number): number | undefined {
  const field = fields.find((item) => item.field === number && item.wire === WIRE_VARINT);
  return field?.varint;
}
