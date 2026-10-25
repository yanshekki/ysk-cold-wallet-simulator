import { describe, expect, it } from 'vitest';
import { bytesToHex } from './bytes';
import {
  HID_CHANNEL,
  HID_PACKET_SIZE,
  HID_TAG_APDU,
  HidReassembler,
  LEDGER_USB_VID,
  ledgerGenericHidProductId,
  metamaskWebHidFilters,
  normalizeHidReport,
  unwrapHidReports,
  wrapHidApdu,
} from './hid';

const GET_ADDRESS = Uint8Array.of(
  0xe0,
  0x02,
  0x01,
  0x00,
  0x15,
  0x05,
  0x80,
  0x00,
  0x00,
  0x2c,
  0x80,
  0x00,
  0x00,
  0x3c,
  0x80,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
);

describe('Ledger USB HID framing', () => {
  it('uses the VID MetaMask WebHID filters on', () => {
    expect(LEDGER_USB_VID).toBe(0x2c97);
    expect(metamaskWebHidFilters()).toEqual([{ vendorId: 0x2c97 }]);
    expect(ledgerGenericHidProductId('nano-x')).toBe(0x4001);
    expect(ledgerGenericHidProductId('stax')).toBe(0x6001);
    expect(ledgerGenericHidProductId('flex')).toBe(0x7001);
    expect(ledgerGenericHidProductId('gen5')).toBe(0x8001);
  });

  it('wraps GET_ADDRESS into one 64-byte report with channel 0x0101', () => {
    const reports = wrapHidApdu(GET_ADDRESS);
    expect(reports).toHaveLength(1);
    expect(reports[0].length).toBe(HID_PACKET_SIZE);
    expect(bytesToHex(reports[0].subarray(0, 7 + GET_ADDRESS.length))).toBe(
      '0101050000001a' + bytesToHex(GET_ADDRESS),
    );
    expect(reports[0][7 + GET_ADDRESS.length]).toBe(0);
  });

  it('round-trips a payload that spans two HID reports', () => {
    const payload = Uint8Array.from({ length: 80 }, (_, i) => i + 1);
    const reports = wrapHidApdu(payload);
    expect(reports).toHaveLength(2);
    expect(reports[0][2]).toBe(HID_TAG_APDU);
    expect((reports[0][3] << 8) | reports[0][4]).toBe(0);
    expect((reports[1][3] << 8) | reports[1][4]).toBe(1);
    const frame = unwrapHidReports(reports);
    expect(frame.channel).toBe(HID_CHANNEL);
    expect(bytesToHex(frame.payload)).toBe(bytesToHex(payload));
  });

  it('strips a leading Windows report id', () => {
    const [report] = wrapHidApdu(GET_ADDRESS);
    const prefixed = new Uint8Array(report.length + 1);
    prefixed.set(report, 1);
    expect(bytesToHex(normalizeHidReport(prefixed))).toBe(bytesToHex(report));
    const assembler = new HidReassembler();
    const frame = assembler.push(prefixed);
    expect(frame?.payload.length).toBe(GET_ADDRESS.length);
  });

  it('rejects a broken continuation sequence', () => {
    const payload = Uint8Array.from({ length: 80 }, (_, i) => i);
    const reports = wrapHidApdu(payload);
    const assembler = new HidReassembler();
    assembler.push(reports[0]);
    const broken = Uint8Array.from(reports[1]);
    broken[4] = 0x09;
    expect(() => assembler.push(broken)).toThrow(/sequence/);
  });
});
