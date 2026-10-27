import { describe, expect, it } from 'vitest';
import { encodeAppAndVersion } from './apps/dashboard';
import { bytesToHex } from './bytes';
import {
  BleReassembler,
  DEFAULT_MTU,
  framePayload,
  splitFramedPackets,
  TAG_APDU,
  TAG_ERROR,
  TAG_MTU,
} from './framing';

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

  it('ignores a stray continuation when idle', () => {
    const assembler = new BleReassembler();
    expect(assembler.push(Uint8Array.of(0x05, 0x00, 0x01, 0x90, 0x00))).toBeNull();
  });

  it('ignores a stray high sequence until the missing packets arrive', () => {
    const assembler = new BleReassembler();
    const first = framePayload(TAG_APDU, new Uint8Array(30), DEFAULT_MTU);
    const packets = splitFramedPackets(first, DEFAULT_MTU);
    expect(packets.length).toBeGreaterThan(1);
    assembler.push(packets[0]);
    const broken = Uint8Array.from(packets[1]);
    broken[1] = 0x00;
    broken[2] = 0x09;
    expect(assembler.push(broken)).toBeNull();
    let result = null;
    for (const packet of packets.slice(1)) {
      result = assembler.push(packet);
    }
    expect(result).not.toBeNull();
    expect(result?.payload.length).toBe(30);
  });

  it('reassembles packets that arrive out of order or duplicated', () => {
    const payload = new Uint8Array(80).map((_, i) => i + 1);
    const packets = splitFramedPackets(framePayload(TAG_APDU, payload, DEFAULT_MTU), DEFAULT_MTU);
    expect(packets.length).toBeGreaterThan(3);
    const assembler = new BleReassembler();
    expect(assembler.push(packets[0])).toBeNull();
    expect(assembler.push(packets[packets.length - 1])).toBeNull();
    expect(assembler.push(packets[1])).toBeNull();
    expect(assembler.push(packets[1])).toBeNull();
    let result = null;
    for (const packet of packets.slice(1)) {
      result = assembler.push(packet) ?? result;
    }
    expect(result).not.toBeNull();
    expect(bytesToHex(result!.payload)).toBe(bytesToHex(payload));
  });

  it('reassembles interleaved GET_APP replies that each start with seq=0', () => {
    const assembler = new BleReassembler();
    const eth = encodeAppAndVersion('Ethereum', '1.11.0');
    const bolos = encodeAppAndVersion('BOLOS', '2.7.1');
    const avax = encodeAppAndVersion('Avalanche', '1.4.22');
    expect(eth.length).toBe(21);
    expect(bolos.length).toBe(17);
    expect(avax.length).toBe(22);
    const ethPkts = splitFramedPackets(framePayload(TAG_APDU, eth, DEFAULT_MTU), DEFAULT_MTU);
    const bolosPkts = splitFramedPackets(framePayload(TAG_APDU, bolos, DEFAULT_MTU), DEFAULT_MTU);
    const avaxPkts = splitFramedPackets(framePayload(TAG_APDU, avax, DEFAULT_MTU), DEFAULT_MTU);
    expect(ethPkts).toHaveLength(2);
    expect(bolosPkts).toHaveLength(2);
    expect(avaxPkts).toHaveLength(2);

    expect(assembler.push(ethPkts[0])).toBeNull();
    expect(assembler.push(bolosPkts[0])).toBeNull();
    expect(assembler.push(ethPkts[0])).toBeNull();
    expect(assembler.push(avaxPkts[0])).toBeNull();
    expect(assembler.push(ethPkts[1])).toEqual({ tag: TAG_APDU, payload: eth });
    expect(assembler.push(bolosPkts[1])).toEqual({ tag: TAG_APDU, payload: bolos });
    expect(assembler.push(ethPkts[1])).toEqual({ tag: TAG_APDU, payload: eth });
    expect(assembler.push(avaxPkts[1])).toEqual({ tag: TAG_APDU, payload: avax });
  });
});
