import { describe, expect, it } from 'vitest';
import { bytesToHex, concatBytes } from './bytes';
import {
  BROADCAST_CID,
  CTRL_ALLOC_REQUEST,
  CTRL_ENCRYPTED,
  DEFAULT_MTU,
  ThpReassembler,
  crc32,
  decodeTransportFrames,
  encodeAck,
  encodeTransport,
  splitThpPackets,
  withSeq,
} from './framing';

describe('THP L2 framing', () => {
  it('matches CRC-32-IEEE for the ISO vector', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('round-trips a channel allocation request', () => {
    const nonce = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
    const framed = encodeTransport(CTRL_ALLOC_REQUEST, BROADCAST_CID, nonce);
    const [decoded] = decodeTransportFrames(framed);
    expect(decoded.ctrl).toBe(CTRL_ALLOC_REQUEST);
    expect(decoded.cid).toBe(BROADCAST_CID);
    expect(bytesToHex(decoded.payload)).toBe(bytesToHex(nonce));
  });

  it('splits a long encrypted payload into initiation plus continuation', () => {
    const payload = new Uint8Array(400).map((_, i) => i & 0xff);
    const framed = encodeTransport(withSeq(CTRL_ENCRYPTED, 1), 0x0001, payload);
    const packets = splitThpPackets(framed, 64);
    expect(packets.length).toBeGreaterThan(1);
    expect(packets[0][0] & 0x80).toBe(0);
    expect(packets[1][0]).toBe(0x80);
    expect(packets.every((packet) => packet.length === 64)).toBe(true);
    const assembler = new ThpReassembler();
    let result = null;
    for (const packet of packets) {
      result = assembler.push(packet);
    }
    expect(result).not.toBeNull();
    expect(result?.ctrl).toBe(withSeq(CTRL_ENCRYPTED, 1));
    expect(bytesToHex(result!.payload)).toBe(bytesToHex(payload));
  });

  it('concatenates ACK then reply so BLE can notify both', () => {
    const ack = encodeAck(0x0001, 0);
    const reply = encodeTransport(withSeq(CTRL_ENCRYPTED, 0), 0x0001, Uint8Array.of(0xaa, 0xbb));
    const packets = splitThpPackets(concatBytes(ack, reply), DEFAULT_MTU);
    expect(packets.length).toBe(2);
    const assembler = new ThpReassembler();
    expect((assembler.push(packets[0])?.ctrl ?? 0) & 0xf7).toBe(0x20);
    expect(assembler.push(packets[1])?.payload[0]).toBe(0xaa);
  });

  it('rejects a THP length smaller than CRC', () => {
    const assembler = new ThpReassembler();
    expect(() => assembler.push(Uint8Array.of(0x00, 0x00, 0x01, 0x00, 0x03, 0x00, 0x00, 0x00))).toThrow(
      /too small/,
    );
  });
});
