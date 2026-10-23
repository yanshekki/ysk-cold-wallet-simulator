import { concatBytes, readU16BE, readU32BE, writeU16BE, writeU32BE } from './bytes';

export const BROADCAST_CID = 0xffff;
export const DEFAULT_MTU = 244;
export const MAX_MTU = 512;
export const MIN_MTU = 20;

export const CTRL_CONTINUATION = 0x80;
export const CTRL_ALLOC_REQUEST = 0x40;
export const CTRL_ALLOC_RESPONSE = 0x41;
export const CTRL_TRANSPORT_ERROR = 0x42;
export const CTRL_PING = 0x43;
export const CTRL_PONG = 0x44;
export const CTRL_ACK = 0x20;
export const CTRL_HANDSHAKE_INIT = 0x00;
export const CTRL_HANDSHAKE_INIT_RESPONSE = 0x01;
export const CTRL_HANDSHAKE_COMPLETE = 0x02;
export const CTRL_HANDSHAKE_COMPLETE_RESPONSE = 0x03;
export const CTRL_ENCRYPTED = 0x04;

export const ERROR_TRANSPORT_BUSY = 1;
export const ERROR_UNALLOCATED_CHANNEL = 2;
export const ERROR_DECRYPTION_FAILED = 3;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

export type ThpFrame = {
  ctrl: number;
  cid: number;
  payload: Uint8Array;
};

export function clampMtu(mtu: number): number {
  if (!Number.isFinite(mtu)) {
    return DEFAULT_MTU;
  }
  return Math.min(MAX_MTU, Math.max(MIN_MTU, Math.floor(mtu)));
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function seqBit(ctrl: number): number {
  return (ctrl & 0x10) !== 0 ? 1 : 0;
}

export function withSeq(ctrl: number, seq: number): number {
  return (ctrl & ~0x10) | (seq ? 0x10 : 0);
}

export function ackCtrl(seq: number): number {
  return CTRL_ACK | (seq ? 0x08 : 0);
}

export function isContinuation(ctrl: number): boolean {
  return (ctrl & CTRL_CONTINUATION) !== 0;
}

export function isAck(ctrl: number): boolean {
  return (ctrl & 0xf7) === CTRL_ACK;
}

export function isAllocRequest(ctrl: number): boolean {
  return ctrl === CTRL_ALLOC_REQUEST;
}

export function isAllocResponse(ctrl: number): boolean {
  return ctrl === CTRL_ALLOC_RESPONSE;
}

export function isPing(ctrl: number): boolean {
  return ctrl === CTRL_PING;
}

export function isHandshakeInit(ctrl: number): boolean {
  return (ctrl & 0xe7) === CTRL_HANDSHAKE_INIT;
}

export function isHandshakeInitResponse(ctrl: number): boolean {
  return (ctrl & 0xe7) === CTRL_HANDSHAKE_INIT_RESPONSE;
}

export function isHandshakeComplete(ctrl: number): boolean {
  return (ctrl & 0xe7) === CTRL_HANDSHAKE_COMPLETE;
}

export function isHandshakeCompleteResponse(ctrl: number): boolean {
  return (ctrl & 0xe7) === CTRL_HANDSHAKE_COMPLETE_RESPONSE;
}

export function isEncrypted(ctrl: number): boolean {
  return (ctrl & 0xe7) === CTRL_ENCRYPTED;
}

export function isSynchronized(ctrl: number): boolean {
  return (
    isAck(ctrl) ||
    isHandshakeInit(ctrl) ||
    isHandshakeInitResponse(ctrl) ||
    isHandshakeComplete(ctrl) ||
    isHandshakeCompleteResponse(ctrl) ||
    isEncrypted(ctrl)
  );
}

export function encodeTransport(ctrl: number, cid: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 4;
  const header = concatBytes(Uint8Array.of(ctrl & 0xff), writeU16BE(cid), writeU16BE(length));
  const crc = crc32(concatBytes(header, payload));
  return concatBytes(header, payload, writeU32BE(crc));
}

export function encodeAck(cid: number, seq: number): Uint8Array {
  return encodeTransport(ackCtrl(seq), cid, new Uint8Array());
}

export function encodeTransportError(cid: number, code: number): Uint8Array {
  return encodeTransport(CTRL_TRANSPORT_ERROR, cid, Uint8Array.of(code & 0xff));
}

export function padPacket(packet: Uint8Array, mtu: number): Uint8Array {
  if (packet.length >= mtu) {
    return packet;
  }
  const out = new Uint8Array(mtu);
  out.set(packet);
  return out;
}

export function decodeTransportFrames(buffer: Uint8Array): ThpFrame[] {
  const frames: ThpFrame[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 5 > buffer.length) {
      throw new Error('truncated THP header');
    }
    const ctrl = buffer[offset];
    if (isContinuation(ctrl)) {
      throw new Error('expected initiation packet');
    }
    const cid = readU16BE(buffer, offset + 1);
    const length = readU16BE(buffer, offset + 3);
    const end = offset + 5 + length;
    if (end > buffer.length) {
      throw new Error('truncated THP payload');
    }
    if (length < 4) {
      throw new Error('THP length too small');
    }
    const payload = buffer.slice(offset + 5, end - 4);
    const crc = readU32BE(buffer, end - 4);
    const header = buffer.slice(offset, offset + 5);
    if (crc !== crc32(concatBytes(header, payload))) {
      throw new Error('invalid THP CRC');
    }
    frames.push({ ctrl, cid, payload });
    offset = end;
  }
  return frames;
}

function segmentFrame(frame: ThpFrame, mtu: number): Uint8Array[] {
  const encoded = encodeTransport(frame.ctrl, frame.cid, frame.payload);
  const header = encoded.subarray(0, 5);
  const body = encoded.subarray(5);
  const packets: Uint8Array[] = [];
  const first = Math.min(body.length, mtu - 5);
  packets.push(padPacket(concatBytes(header, body.subarray(0, first)), mtu));
  let offset = first;
  while (offset < body.length) {
    const size = Math.min(body.length - offset, mtu - 3);
    packets.push(
      padPacket(
        concatBytes(Uint8Array.of(CTRL_CONTINUATION), writeU16BE(frame.cid), body.subarray(offset, offset + size)),
        mtu,
      ),
    );
    offset += size;
  }
  return packets;
}

export function splitThpPackets(buffer: Uint8Array, mtu = DEFAULT_MTU): Uint8Array[] {
  const size = clampMtu(mtu);
  const packets: Uint8Array[] = [];
  for (const frame of decodeTransportFrames(buffer)) {
    packets.push(...segmentFrame(frame, size));
  }
  return packets;
}

type Pending = {
  ctrl: number;
  cid: number;
  length: number;
  buffer: Uint8Array;
};

export class ThpReassembler {
  private pending = new Map<number, Pending>();

  reset(): void {
    this.pending.clear();
  }

  push(packet: Uint8Array): ThpFrame | null {
    if (packet.length < 4) {
      throw new Error('THP packet too short');
    }
    const ctrl = packet[0];
    if (isContinuation(ctrl)) {
      const cid = readU16BE(packet, 1);
      const current = this.pending.get(cid);
      if (!current) {
        return null;
      }
      current.buffer = Uint8Array.from(concatBytes(current.buffer, packet.subarray(3)));
      return this.finish(current);
    }
    if (packet.length < 5) {
      throw new Error('THP initiation packet too short');
    }
    const cid = readU16BE(packet, 1);
    const length = readU16BE(packet, 3);
    const current: Pending = {
      ctrl,
      cid,
      length,
      buffer: packet.slice(5),
    };
    this.pending.set(cid, current);
    return this.finish(current);
  }

  private finish(current: Pending): ThpFrame | null {
    if (current.buffer.length < current.length) {
      return null;
    }
    this.pending.delete(current.cid);
    const payloadAndCrc = current.buffer.subarray(0, current.length);
    if (payloadAndCrc.length < 4) {
      throw new Error('THP length too small');
    }
    const payload = payloadAndCrc.subarray(0, payloadAndCrc.length - 4);
    const crc = readU32BE(payloadAndCrc, payloadAndCrc.length - 4);
    const header = concatBytes(
      Uint8Array.of(current.ctrl),
      writeU16BE(current.cid),
      writeU16BE(current.length),
    );
    if (crc !== crc32(concatBytes(header, payload))) {
      throw new Error('invalid THP CRC');
    }
    return { ctrl: current.ctrl, cid: current.cid, payload };
  }
}
