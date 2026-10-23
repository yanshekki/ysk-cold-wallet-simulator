import { describe, expect, it } from 'vitest';
import { encodeString } from './proto';
import {
  PROTO_HEAD_SOF,
  V2FrameAssembler,
  V2MessageType,
  crc8,
  decodeFrame,
  encodeAck,
  encodeProtobufFrame,
  inspectFrameHeader,
  isAckFrame,
} from './v2';

describe('OneKey Protocol V2 framing', () => {
  it('matches the firmware CRC8 of a 29-byte Ping header', () => {
    expect(crc8(Uint8Array.of(0x5a, 0x1d, 0x00), 3)).toBe(0xaa);
  });

  it('round-trips a sys Ping and builds a valid ACK', () => {
    const payload = encodeString(1, 'protobuf-protobuf');
    const frame = encodeProtobufFrame(V2MessageType.Ping, payload, 0, 1, 6);
    expect(frame[0]).toBe(PROTO_HEAD_SOF);
    const decoded = decodeFrame(frame);
    expect(decoded.messageTypeId).toBe(V2MessageType.Ping);
    expect(decoded.seq).toBe(6);
    expect(decoded.router).toBe(1);
    expect(decoded.packetSrc).toBe(0);
    expect(Array.from(decoded.pbPayload)).toEqual(Array.from(payload));

    const ack = encodeAck(decoded.seq, decoded.packetSrc, decoded.router);
    expect(isAckFrame(ack)).toBe(true);
    expect(inspectFrameHeader(ack).seq).toBe(6);
    expect(ack.length).toBe(8);
  });

  it('reassembles a Ping split across BLE chunks', () => {
    const frame = encodeProtobufFrame(
      V2MessageType.Ping,
      encodeString(1, 'protocol-v2-probe'),
      0,
      1,
      1,
    );
    const assembler = new V2FrameAssembler();
    expect(assembler.drain(frame.subarray(0, 12))).toEqual([]);
    expect(assembler.buffered).toBe(true);
    const frames = assembler.drain(frame.subarray(12));
    expect(frames).toHaveLength(1);
    expect(decodeFrame(frames[0]).messageTypeId).toBe(V2MessageType.Ping);
    expect(assembler.buffered).toBe(false);
  });
});
