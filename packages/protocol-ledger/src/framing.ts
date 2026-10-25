import { concatBytes, readU16BE, writeU16BE } from './bytes';

export const TAG_PROTOCOL_VERSION = 0x00;
export const TAG_INIT = 0x01;
export const TAG_APDU = 0x05;
export const TAG_MTU = 0x08;
export const TAG_ERROR = 0x0e;

export const DEFAULT_MTU = 20;
export const MAX_MTU = 153;

export type ReassembledFrame = {
  tag: number;
  payload: Uint8Array;
};

export class BleReassembler {
  private expected = 0;
  private seq = -1;
  private tag = 0;
  private buffer = new Uint8Array(0);

  reset(): void {
    this.expected = 0;
    this.seq = -1;
    this.tag = 0;
    this.buffer = new Uint8Array(0);
  }

  push(packet: Uint8Array): ReassembledFrame | null {
    if (packet.length < 3) {
      throw new Error('BLE packet too short');
    }
    const tag = packet[0];
    const seq = readU16BE(packet, 1);

    if (seq === 0) {
      if (packet.length < 5) {
        throw new Error('initial BLE packet too short');
      }
      this.tag = tag;
      this.seq = 0;
      this.expected = readU16BE(packet, 3);
      this.buffer = Uint8Array.from(packet.subarray(5));
    } else {
      if (this.seq < 0) {
        return null;
      }
      if (seq !== this.seq + 1 || tag !== this.tag) {
        this.reset();
        throw new Error('BLE sequence mismatch');
      }
      this.seq = seq;
      this.buffer = Uint8Array.from(concatBytes(this.buffer, packet.subarray(3)));
    }

    if (this.buffer.length < this.expected) {
      return null;
    }

    const payload = this.buffer.slice(0, this.expected);
    const frame = { tag: this.tag, payload };
    this.reset();
    return frame;
  }
}

export function framePayload(tag: number, payload: Uint8Array, mtu: number): Uint8Array {
  const packetSize = clampMtu(mtu);
  const packets: Uint8Array[] = [];
  let offset = 0;
  let seq = 0;

  do {
    const headerSize = seq === 0 ? 5 : 3;
    const room = Math.max(0, packetSize - headerSize);
    const slice = payload.subarray(offset, offset + room);
    const header =
      seq === 0
        ? concatBytes(Uint8Array.of(tag), writeU16BE(seq), writeU16BE(payload.length), slice)
        : concatBytes(Uint8Array.of(tag), writeU16BE(seq), slice);
    packets.push(header);
    offset += slice.length;
    seq += 1;
  } while (offset < payload.length);

  return concatBytes(...packets);
}

export function splitFramedPackets(framed: Uint8Array, mtu: number): Uint8Array[] {
  return chunkFixed(framed, clampMtu(mtu));
}

export function clampMtu(mtu: number): number {
  if (!Number.isFinite(mtu)) {
    return DEFAULT_MTU;
  }
  return Math.min(MAX_MTU, Math.max(DEFAULT_MTU, Math.floor(mtu)));
}

function chunkFixed(bytes: Uint8Array, size: number): Uint8Array[] {
  if (bytes.length === 0) {
    return [];
  }
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.subarray(i, Math.min(bytes.length, i + size)));
  }
  return chunks;
}
