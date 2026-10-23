import { concatBytes, readU16BE, readU32BE, writeU16BE, writeU32BE, chunkBytes } from './bytes';

export const V1_MAGIC = Uint8Array.of(0x3f, 0x23, 0x23);
export const V1_HEADER_LENGTH = 9;
export const DEFAULT_MTU = 20;
export const MAX_MTU = 512;
export const MAX_PAYLOAD = 1024 * 1024;

export type V1Message = {
  type: number;
  payload: Uint8Array;
};

export function clampMtu(mtu: number): number {
  if (!Number.isFinite(mtu)) {
    return DEFAULT_MTU;
  }
  return Math.min(MAX_MTU, Math.max(DEFAULT_MTU, Math.floor(mtu)));
}

export function frameV1(type: number, payload: Uint8Array): Uint8Array {
  if (type < 0 || type > 0xffff) {
    throw new Error('OneKey V1 type must fit in uint16');
  }
  if (payload.length > MAX_PAYLOAD) {
    throw new Error('OneKey V1 payload too large');
  }
  return concatBytes(V1_MAGIC, writeU16BE(type), writeU32BE(payload.length), payload);
}

export function splitOneKeyV1(framed: Uint8Array, mtu: number): Uint8Array[] {
  return chunkBytes(framed, clampMtu(mtu));
}

export class V1Reassembler {
  private buffer = new Uint8Array(0);
  private expected = -1;
  private type = 0;

  reset(): void {
    this.buffer = new Uint8Array(0);
    this.expected = -1;
    this.type = 0;
  }

  push(chunk: Uint8Array): V1Message | null {
    this.buffer = Uint8Array.from(concatBytes(this.buffer, chunk));
    if (this.expected < 0) {
      if (this.buffer.length < V1_HEADER_LENGTH) {
        return null;
      }
      if (
        this.buffer[0] !== V1_MAGIC[0] ||
        this.buffer[1] !== V1_MAGIC[1] ||
        this.buffer[2] !== V1_MAGIC[2]
      ) {
        this.reset();
        throw new Error('invalid OneKey V1 magic');
      }
      this.type = readU16BE(this.buffer, 3);
      this.expected = readU32BE(this.buffer, 5);
      if (this.expected > MAX_PAYLOAD) {
        this.reset();
        throw new Error('OneKey V1 payload too large');
      }
    }
    const total = V1_HEADER_LENGTH + this.expected;
    if (this.buffer.length < total) {
      return null;
    }
    const payload = this.buffer.slice(V1_HEADER_LENGTH, total);
    const message = { type: this.type, payload };
    this.reset();
    return message;
  }
}
