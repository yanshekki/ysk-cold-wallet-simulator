import { concatBytes, readU16BE, writeU16BE } from './bytes';

export const TAG_PROTOCOL_VERSION = 0x00;
export const TAG_INIT = 0x01;
export const TAG_APDU = 0x05;
export const TAG_MTU = 0x08;
export const TAG_ERROR = 0x0e;

export const DEFAULT_MTU = 20;
export const MAX_MTU = 153;

export const MAX_OPEN_FRAMES = 8;

export type ReassembledFrame = {
  tag: number;
  payload: Uint8Array;
};

type OpenFrame = {
  tag: number;
  expected: number;
  parts: Map<number, Uint8Array>;
};

function consecutive(frame: OpenFrame): { total: number; next: number } {
  let total = 0;
  let seq = 0;
  while (frame.parts.has(seq)) {
    const part = frame.parts.get(seq);
    if (!part) {
      break;
    }
    total += part.length;
    seq += 1;
    if (total >= frame.expected) {
      break;
    }
  }
  return { total, next: seq };
}

function takeIfComplete(frame: OpenFrame): ReassembledFrame | null {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let seq = 0;
  while (frame.parts.has(seq)) {
    const part = frame.parts.get(seq);
    if (!part) {
      break;
    }
    chunks.push(part);
    total += part.length;
    if (total >= frame.expected) {
      return { tag: frame.tag, payload: concatBytes(...chunks).slice(0, frame.expected) };
    }
    seq += 1;
  }
  return null;
}

/**
 * Ledger BLE frames are tag + seq16 + (seq0: length16) + payload.
 * Core/DMK can have several GET_APP replies in flight, so seq=0 from a
 * new APDU must not steal seq=1 belonging to an earlier APDU.
 */
export class BleReassembler {
  private open: OpenFrame[] = [];

  reset(): void {
    this.open = [];
  }

  push(packet: Uint8Array): ReassembledFrame | null {
    if (packet.length < 3) {
      return null;
    }
    const tag = packet[0];
    const seq = readU16BE(packet, 1);
    if (seq > 64) {
      return null;
    }

    if (seq === 0) {
      if (packet.length < 5) {
        return null;
      }
      const frame: OpenFrame = {
        tag,
        expected: readU16BE(packet, 3),
        parts: new Map([[0, Uint8Array.from(packet.subarray(5))]]),
      };
      const done = takeIfComplete(frame);
      if (done) {
        return done;
      }
      this.open.push(frame);
      if (this.open.length > MAX_OPEN_FRAMES) {
        this.open.shift();
      }
      return null;
    }

    const chunk = Uint8Array.from(packet.subarray(3));
    const frame = this.pickOpen(tag, seq, chunk.length);
    if (!frame) {
      return null;
    }
    if (!frame.parts.has(seq)) {
      frame.parts.set(seq, chunk);
    }
    const done = takeIfComplete(frame);
    if (!done) {
      return null;
    }
    this.open = this.open.filter((item) => item !== frame);
    return done;
  }

  private pickOpen(tag: number, seq: number, chunkLength: number): OpenFrame | undefined {
    const candidates = this.open.filter((frame) => frame.tag === tag && !frame.parts.has(seq));
    if (candidates.length === 0) {
      return undefined;
    }
    const inOrder = candidates.filter((frame) => consecutive(frame).next === seq);
    const completing = inOrder.find((frame) => {
      const filled = consecutive(frame).total;
      return filled + chunkLength >= frame.expected;
    });
    if (completing) {
      const remainMatch = inOrder.find((frame) => {
        const filled = consecutive(frame).total;
        return frame.expected - filled === chunkLength;
      });
      return remainMatch ?? completing;
    }
    if (inOrder.length > 0) {
      const remainMatch = inOrder.find((frame) => {
        const filled = consecutive(frame).total;
        return frame.expected - filled === chunkLength;
      });
      return remainMatch ?? inOrder[0];
    }
    return candidates[0];
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
    chunks.push(bytes.subarray(i, Math.min(bytes.length, size + i)));
  }
  return chunks;
}
