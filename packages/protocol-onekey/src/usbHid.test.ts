import { describe, expect, it } from 'vitest';
import { unwrapPrefixedHid } from '@cws/contracts';
import { bytesToHex } from './bytes';
import { DEFAULT_MTU, frameV1, splitOneKeyV1 } from './framing';
import { encodeProtobufFrame } from './v2';
import { OneKeyUsbBleBridge, bleV1ToUsbStream, decodeUsbV1, encodeUsbV1, usbStreamToBleV1 } from './usbHid';

describe('OneKey USB HID 0x3F', () => {
  it('round-trips a V1 Initialize through HID reports and BLE chunks', () => {
    const reports = encodeUsbV1({ type: 0, payload: new Uint8Array() });
    expect(reports[0][0]).toBe(0x3f);
    expect(reports[0][1]).toBe(0x23);
    expect(reports[0][2]).toBe(0x23);
    const message = decodeUsbV1(reports);
    expect(message.type).toBe(0);
    expect(message.payload.length).toBe(0);

    const bridge = new OneKeyUsbBleBridge('onekey-v1', DEFAULT_MTU);
    let ble: Uint8Array[] | null = null;
    for (const report of reports) {
      ble = bridge.pushHid(report);
    }
    expect(ble).not.toBeNull();
    expect(ble![0][0]).toBe(0x3f);
    const back = new OneKeyUsbBleBridge('onekey-v1', DEFAULT_MTU);
    let hid: Uint8Array[] | null = null;
    for (const packet of ble!) {
      hid = back.pushBle(packet);
    }
    expect(hid).not.toBeNull();
    expect(decodeUsbV1(hid!).type).toBe(0);
  });

  it('reassembles a V1 payload split across HID reports', () => {
    const payload = Uint8Array.from({ length: 80 }, (_, i) => i + 1);
    const reports = encodeUsbV1({ type: 17, payload });
    expect(reports.length).toBeGreaterThan(1);
    const bridge = new OneKeyUsbBleBridge('onekey-v1');
    let ble: Uint8Array[] | null = null;
    for (const report of reports) {
      ble = bridge.pushHid(report);
    }
    expect(ble).not.toBeNull();
    const framed = frameV1(17, payload);
    expect(bytesToHex(concat(ble!))).toBe(bytesToHex(framed));
    expect(splitOneKeyV1(framed, DEFAULT_MTU).length).toBe(ble!.length);
  });

  it('wraps V2 frames with a 0x3F prefix per 64-byte report', () => {
    const frame = encodeProtobufFrame(60200, Uint8Array.of(0x0a, 0x00));
    const bridge = new OneKeyUsbBleBridge('onekey-v2', 20);
    const reports = (() => {
      const out = new OneKeyUsbBleBridge('onekey-v2', 20);
      return out.pushBle(frame);
    })();
    expect(reports).not.toBeNull();
    expect(reports![0][0]).toBe(0x3f);
    expect(unwrapPrefixedHid(reports![0])[0]).toBe(0x5a);
    let ble: Uint8Array[] | null = null;
    for (const report of reports!) {
      ble = bridge.pushHid(report);
    }
    expect(ble).not.toBeNull();
    expect(concat(ble!)[0]).toBe(0x5a);
  });

  it('maps 3F2323 BLE magic to 2323 after the USB 0x3F prefix', () => {
    const framed = frameV1(1, Uint8Array.of(0xaa));
    const stream = bleV1ToUsbStream(framed);
    expect(stream[0]).toBe(0x23);
    expect(bytesToHex(usbStreamToBleV1(stream))).toBe(bytesToHex(framed));
  });
});

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
