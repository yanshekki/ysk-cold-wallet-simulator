import { describe, expect, it } from 'vitest';
import { MessageType } from './messages';
import { UsbHidReassembler, unwrapUsbHidReports, wrapUsbHid } from './usb';

describe('Trezor USB HID protobuf', () => {
  it('round-trips Initialize through 0x3F reports', () => {
    const reports = wrapUsbHid(MessageType.Initialize, new Uint8Array());
    expect(reports[0][0]).toBe(0x3f);
    expect(reports[0][1]).toBe(0x23);
    expect(reports[0][2]).toBe(0x23);
    const message = unwrapUsbHidReports(reports);
    expect(message.type).toBe(MessageType.Initialize);
    expect(message.payload.length).toBe(0);
  });

  it('reassembles a payload that spans two reports', () => {
    const payload = Uint8Array.from({ length: 80 }, (_, i) => i);
    const reports = wrapUsbHid(MessageType.Features, payload);
    expect(reports.length).toBeGreaterThan(1);
    const assembler = new UsbHidReassembler();
    let out = null;
    for (const report of reports) {
      out = assembler.push(report);
    }
    expect(out).not.toBeNull();
    expect(out?.type).toBe(MessageType.Features);
    expect(Array.from(out!.payload)).toEqual(Array.from(payload));
  });
});
