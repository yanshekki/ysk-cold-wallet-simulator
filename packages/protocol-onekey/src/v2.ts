import { concatBytes } from './bytes';

export const PROTO_HEAD_SOF = 0x5a;
export const PROTO_PRE_HEAD_SIZE = 4;
export const PROTO_HEAD_CRC_SIZE = 8;
export const CRC8_INIT = 0x30;
export const PROTO_DATA_TYPE_PACKET = 0;
export const PROTO_DATA_TYPE_ACK = 1;
export const PROTOCOL_V2_FRAME_MAX_BYTES = 4200;
export const PROTOCOL_V2_SYS_THRESHOLD = 60_000;

export const V2MessageType = {
  ProtocolInfoRequest: 60200,
  ProtocolInfo: 60201,
  Ping: 60206,
  Success: 60207,
  Failure: 60208,
  DeviceInfoGet: 60600,
  DeviceInfo: 60601,
  DeviceStatusGet: 60602,
  DeviceStatus: 60603,
} as const;

export const CRC8_TABLE = Uint8Array.of(
  0x00, 0x5e, 0xbc, 0xe2, 0x61, 0x3f, 0xdd, 0x83, 0xc2, 0x9c, 0x7e, 0x20, 0xa3, 0xfd, 0x1f, 0x41,
  0x9d, 0xc3, 0x21, 0x7f, 0xfc, 0xa2, 0x40, 0x1e, 0x5f, 0x01, 0xe3, 0xbd, 0x3e, 0x60, 0x82, 0xdc,
  0x23, 0x7d, 0x9f, 0xc1, 0x42, 0x1c, 0xfe, 0xa0, 0xe1, 0xbf, 0x5d, 0x03, 0x80, 0xde, 0x3c, 0x62,
  0xbe, 0xe0, 0x02, 0x5c, 0xdf, 0x81, 0x63, 0x3d, 0x7c, 0x22, 0xc0, 0x9e, 0x1d, 0x43, 0xa1, 0xff,
  0x46, 0x18, 0xfa, 0xa4, 0x27, 0x79, 0x9b, 0xc5, 0x84, 0xda, 0x38, 0x66, 0xe5, 0xbb, 0x59, 0x07,
  0xdb, 0x85, 0x67, 0x39, 0xba, 0xe4, 0x06, 0x58, 0x19, 0x47, 0xa5, 0xfb, 0x78, 0x26, 0xc4, 0x9a,
  0x65, 0x3b, 0xd9, 0x87, 0x04, 0x5a, 0xb8, 0xe6, 0xa7, 0xf9, 0x1b, 0x45, 0xc6, 0x98, 0x7a, 0x24,
  0xf8, 0xa6, 0x44, 0x1a, 0x99, 0xc7, 0x25, 0x7b, 0x3a, 0x64, 0x86, 0xd8, 0x5b, 0x05, 0xe7, 0xb9,
  0x8c, 0xd2, 0x30, 0x6e, 0xed, 0xb3, 0x51, 0x0f, 0x4e, 0x10, 0xf2, 0xac, 0x2f, 0x71, 0x93, 0xcd,
  0x11, 0x4f, 0xad, 0xf3, 0x70, 0x2e, 0xcc, 0x92, 0xd3, 0x8d, 0x6f, 0x31, 0xb2, 0xec, 0x0e, 0x50,
  0xaf, 0xf1, 0x13, 0x4d, 0xce, 0x90, 0x72, 0x2c, 0x6d, 0x33, 0xd1, 0x8f, 0x0c, 0x52, 0xb0, 0xee,
  0x32, 0x6c, 0x8e, 0xd0, 0x53, 0x0d, 0xef, 0xb1, 0xf0, 0xae, 0x4c, 0x12, 0x91, 0xcf, 0x2d, 0x73,
  0xca, 0x94, 0x76, 0x28, 0xab, 0xf5, 0x17, 0x49, 0x08, 0x56, 0xb4, 0xea, 0x69, 0x37, 0xd5, 0x8b,
  0x57, 0x09, 0xeb, 0xb5, 0x36, 0x68, 0x8a, 0xd4, 0x95, 0xcb, 0x29, 0x77, 0xf4, 0xaa, 0x48, 0x16,
  0xe9, 0xb7, 0x55, 0x0b, 0x88, 0xd6, 0x34, 0x6a, 0x2b, 0x75, 0x97, 0xc9, 0x4a, 0x14, 0xf6, 0xa8,
  0x74, 0x2a, 0xc8, 0x96, 0x15, 0x4b, 0xa9, 0xf7, 0xb6, 0xe8, 0x0a, 0x54, 0xd7, 0x89, 0x6b, 0x35,
);

export type V2FrameHeader = {
  frameLen: number;
  router: number;
  packetSrc: number;
  dataType: number;
  seq: number;
};

export type V2Frame = V2FrameHeader & {
  messageTypeId: number;
  pbPayload: Uint8Array;
};

export function crc8(data: Uint8Array, len: number): number {
  let crc = CRC8_INIT;
  for (let i = 0; i < len; i++) {
    crc = CRC8_TABLE[crc ^ data[i]];
  }
  return crc;
}

export function nextProtoSeq(current: number): number {
  return current >= 255 ? 1 : current + 1;
}

function encodeRawFrame(
  payload: Uint8Array | null,
  packetSrc: number,
  router: number,
  seq: number,
  dataType: number,
): Uint8Array {
  if (!Number.isInteger(seq) || seq < 1 || seq > 255) {
    throw new Error(`Protocol V2 seq out of range (1-255): ${seq}`);
  }
  const payloadLen = payload ? payload.length : 0;
  const frameLen = payloadLen + PROTO_HEAD_CRC_SIZE;
  if (frameLen > PROTOCOL_V2_FRAME_MAX_BYTES) {
    throw new Error(`Protocol V2 frame too large: ${frameLen}`);
  }
  const frame = new Uint8Array(frameLen);
  frame[0] = PROTO_HEAD_SOF;
  frame[1] = frameLen % 256;
  frame[2] = Math.floor(frameLen / 256) % 256;
  frame[4] = router % 256;
  frame[5] = ((packetSrc % 16) << 2) | (dataType % 4);
  frame[6] = seq;
  frame[3] = crc8(frame, 3);
  if (payload && payloadLen > 0) {
    frame.set(payload, 7);
  }
  frame[frameLen - 1] = crc8(frame, frameLen - 1);
  return frame;
}

export function encodeFrame(
  payload: Uint8Array | null,
  packetSrc = 0,
  router = 0,
  seq = 1,
): Uint8Array {
  return encodeRawFrame(payload, packetSrc, router, seq, PROTO_DATA_TYPE_PACKET);
}

export function encodeAck(seq: number, packetSrc = 0, router = 0): Uint8Array {
  return encodeRawFrame(null, packetSrc, router, seq, PROTO_DATA_TYPE_ACK);
}

export function encodeProtobufFrame(
  messageTypeId: number,
  pbPayload: Uint8Array,
  packetSrc = 0,
  router = 0,
  seq = 1,
): Uint8Array {
  const payload = new Uint8Array(2 + pbPayload.length);
  payload[0] = messageTypeId % 256;
  payload[1] = Math.floor(messageTypeId / 256) % 256;
  payload.set(pbPayload, 2);
  return encodeFrame(payload, packetSrc, router, seq);
}

export function inspectFrameHeader(data: Uint8Array): V2FrameHeader {
  if (data.length < PROTO_HEAD_CRC_SIZE) {
    throw new Error(`Protocol V2 frame too short: ${data.length} bytes`);
  }
  if (data[0] !== PROTO_HEAD_SOF) {
    throw new Error('Invalid Protocol V2 SOF');
  }
  const frameLen = data[1] + data[2] * 256;
  if (data.length !== frameLen) {
    throw new Error(`Protocol V2 frame length mismatch: expected ${frameLen}, got ${data.length}`);
  }
  const expectedHeaderCrc = crc8(data, 3);
  if (data[3] !== expectedHeaderCrc) {
    throw new Error('Protocol V2 header CRC mismatch');
  }
  const expectedFrameCrc = crc8(data, frameLen - 1);
  if (data[frameLen - 1] !== expectedFrameCrc) {
    throw new Error('Protocol V2 frame CRC mismatch');
  }
  const dataType = data[5] & 0x03;
  const packetSrc = (data[5] >> 2) & 0x0f;
  const seq = data[6];
  if (seq === 0) {
    throw new Error('Invalid Protocol V2 sequence: 0 is reserved');
  }
  return { frameLen, router: data[4], packetSrc, dataType, seq };
}

export function isAckFrame(data: Uint8Array): boolean {
  if (data.length < 6 || (data[5] & 0x03) !== PROTO_DATA_TYPE_ACK) {
    return false;
  }
  const header = inspectFrameHeader(data);
  if (header.frameLen !== PROTO_HEAD_CRC_SIZE) {
    throw new Error(`Invalid Protocol V2 ACK frame length: ${header.frameLen}`);
  }
  return true;
}

export function decodeFrame(data: Uint8Array): V2Frame {
  const header = inspectFrameHeader(data);
  if (header.dataType !== PROTO_DATA_TYPE_PACKET) {
    throw new Error(`Invalid Protocol V2 data type: expected packet, got ${header.dataType}`);
  }
  const payloadData = data.slice(7, header.frameLen - 1);
  if (payloadData.length < 2) {
    throw new Error('Protocol V2 payload too short');
  }
  return {
    ...header,
    messageTypeId: payloadData[0] + payloadData[1] * 256,
    pbPayload: payloadData.slice(2),
  };
}

export class V2FrameAssembler {
  private buffer = new Uint8Array(0);

  get buffered(): boolean {
    return this.buffer.length > 0;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  drain(chunk: Uint8Array = new Uint8Array()): Uint8Array[] {
    if (chunk.length > 0) {
      this.buffer = Uint8Array.from(concatBytes(this.buffer, chunk));
    }
    const frames: Uint8Array[] = [];
    for (;;) {
      const frame = this.extractFrame();
      if (!frame) {
        break;
      }
      frames.push(frame);
    }
    return frames;
  }

  private extractFrame(): Uint8Array | undefined {
    if (this.buffer.length < 3) {
      return undefined;
    }
    if (this.buffer[0] !== PROTO_HEAD_SOF) {
      this.reset();
      throw new Error('Invalid Protocol V2 SOF');
    }
    const expectedLen = this.buffer[1] + this.buffer[2] * 256;
    if (expectedLen < PROTO_HEAD_CRC_SIZE || expectedLen > PROTOCOL_V2_FRAME_MAX_BYTES) {
      this.reset();
      throw new Error(`Protocol V2 frame length invalid: ${expectedLen}`);
    }
    if (this.buffer.length < PROTO_PRE_HEAD_SIZE) {
      return undefined;
    }
    const expectedHeaderCrc = crc8(this.buffer, 3);
    if (this.buffer[3] !== expectedHeaderCrc) {
      this.reset();
      throw new Error('Protocol V2 header CRC mismatch');
    }
    if (this.buffer.length < expectedLen) {
      return undefined;
    }
    const frame = this.buffer.slice(0, expectedLen);
    this.buffer = this.buffer.slice(expectedLen);
    return frame;
  }
}
