import { describe, expect, it } from 'vitest';
import { bytesToHex, concatBytes, writeU16BE, writeU32BE } from './bytes';
import { DEFAULT_MTU, MAX_PAYLOAD, V1Reassembler, V1_MAGIC, frameV1, splitOneKeyV1 } from './framing';

describe('OneKey V1 BLE framing', () => {
  it('round-trips a payload that fits in one packet', () => {
    const payload = Uint8Array.of(0x0a, 0x02, 0x61, 0x62);
    const framed = frameV1(17, payload);
    expect(Array.from(framed.slice(0, 3))).toEqual(Array.from(V1_MAGIC));
    expect((framed[3] << 8) | framed[4]).toBe(17);
    expect(
      (framed[5] << 24) | (framed[6] << 16) | (framed[7] << 8) | framed[8],
    ).toBe(payload.length);
    const assembled = new V1Reassembler().push(framed);
    expect(assembled).not.toBeNull();
    expect(assembled?.type).toBe(17);
    expect(bytesToHex(assembled!.payload)).toBe(bytesToHex(payload));
  });

  it('reassembles header plus raw continuation chunks', () => {
    const payload = new Uint8Array(40).map((_, i) => i + 1);
    const framed = frameV1(0, payload);
    const packets = splitOneKeyV1(framed, DEFAULT_MTU);
    expect(packets.length).toBeGreaterThan(1);
    expect(Array.from(packets[0].slice(0, 3))).toEqual(Array.from(V1_MAGIC));
    expect(packets[1][0]).not.toBe(0x3f);
    const assembler = new V1Reassembler();
    let result = null;
    for (const packet of packets) {
      result = assembler.push(packet);
    }
    expect(result).not.toBeNull();
    expect(result?.type).toBe(0);
    expect(bytesToHex(result!.payload)).toBe(bytesToHex(payload));
  });

  it('returns null until the declared payload length is complete', () => {
    const framed = frameV1(1, new Uint8Array(30));
    const assembler = new V1Reassembler();
    expect(assembler.push(framed.subarray(0, 12))).toBeNull();
    const done = assembler.push(framed.subarray(12));
    expect(done).not.toBeNull();
    expect(done?.type).toBe(1);
    expect(done?.payload.length).toBe(30);
  });

  it('rejects a first packet without 3F2323 magic', () => {
    const assembler = new V1Reassembler();
    expect(() => assembler.push(Uint8Array.of(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08))).toThrow(
      /magic/,
    );
  });

  it('frames an empty Initialize', () => {
    const framed = frameV1(0, new Uint8Array());
    expect(framed.length).toBe(9);
    const assembled = new V1Reassembler().push(framed);
    expect(assembled?.type).toBe(0);
    expect(assembled?.payload.length).toBe(0);
  });

  it('rejects a declared V1 length over 1MiB and resets', () => {
    const assembler = new V1Reassembler();
    expect(() =>
      assembler.push(concatBytes(V1_MAGIC, writeU16BE(1), writeU32BE(MAX_PAYLOAD + 1))),
    ).toThrow(/too large/);
    const framed = frameV1(1, Uint8Array.of(0x0a));
    expect(assembler.push(framed)?.payload).toEqual(Uint8Array.of(0x0a));
  });
});
