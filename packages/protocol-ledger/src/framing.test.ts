import { describe, expect, it } from 'vitest';
import {
  BleReassembler,
  DEFAULT_MTU,
  framePayload,
  splitFramedPackets,
  TAG_APDU,
  TAG_ERROR,
  TAG_MTU,
} from './framing';
import { bytesToHex } from './bytes';

describe('Ledger BLE framing', () => {
  it('round-trips a payload that fits in one packet', () => {
    const payload = Uint8Array.of(0xe0, 0x01, 0x00, 0x00, 0x00);
    const framed = framePayload(TAG_APDU, payload, DEFAULT_MTU);
    expect(framed[0]).toBe(TAG_APDU);
    expect(framed[1]).toBe(0);
    expect(framed[2]).toBe(0);
    expect((framed[3] << 8) | framed[4]).toBe(payload.length);
    const assembler = new BleReassembler();
    const out = assembler.push(framed);
    expect(out).not.toBeNull();
    expect(out?.tag).toBe(TAG_APDU);
    expect(bytesToHex(out!.payload)).toBe(bytesToHex(payload));
  });

  it('reassembles continuation packets', () => {
    const payload = new Uint8Array(40).map((_, i) => i + 1);
    const framed = framePayload(TAG_APDU, payload, DEFAULT_MTU);
    const packets = splitFramedPackets(framed, DEFAULT_MTU);
    expect(packets.length).toBeGreaterThan(1);
    const assembler = new BleReassembler();
    let result = null;
    for (const packet of packets) {
      result = assembler.push(packet);
    }
    expect(result).not.toBeNull();
    expect(bytesToHex(result!.payload)).toBe(bytesToHex(payload));
  });

  it('frames GET_MTU as tag 0x08 with a 1-byte body', () => {
    const framed = framePayload(TAG_MTU, Uint8Array.of(20), DEFAULT_MTU);
    expect(framed[0]).toBe(TAG_MTU);
    const assembler = new BleReassembler();
    const out = assembler.push(framed);
    expect(out?.payload[0]).toBe(20);
  });

  it('reports protocol errors with tag 0x0E', () => {
    const framed = framePayload(TAG_ERROR, new Uint8Array(), DEFAULT_MTU);
    expect(framed[0]).toBe(TAG_ERROR);
  });

  it('rejects broken sequence numbers', () => {
    const assembler = new BleReassembler();
    const first = framePayload(TAG_APDU, new Uint8Array(30), DEFAULT_MTU);
    const packets = splitFramedPackets(first, DEFAULT_MTU);
    expect(packets.length).toBeGreaterThan(1);
    assembler.push(packets[0]);
    const broken = Uint8Array.from(packets[1]);
    broken[1] = 0x00;
    broken[2] = 0x09;
    expect(() => assembler.push(broken)).toThrow(/sequence/);
  });
});
