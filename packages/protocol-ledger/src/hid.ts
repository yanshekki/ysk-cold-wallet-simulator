import {
  HID_PACKET_SIZE,
  LEDGER_HID_USAGE,
  LEDGER_HID_USAGE_PAGE,
  LEDGER_USB_MODEL,
  LEDGER_USB_VID,
  ledgerGenericHidProductId,
} from '@cws/contracts';
import { concatBytes, readU16BE, writeU16BE } from './bytes';

export {
  HID_PACKET_SIZE,
  LEDGER_HID_USAGE,
  LEDGER_HID_USAGE_PAGE,
  LEDGER_USB_MODEL,
  LEDGER_USB_VID,
  ledgerGenericHidProductId,
};

/** Channel @ledgerhq/hw-transport-webhid hardcodes. */
export const HID_CHANNEL = 0x0101;

export const HID_TAG_APDU = 0x05;

export function metamaskWebHidFilters(): Array<{ vendorId: number }> {
  return [{ vendorId: LEDGER_USB_VID }];
}

export type HidFrame = {
  channel: number;
  tag: number;
  payload: Uint8Array;
};

/**
 * Drop a leading report-id 0x00 (Windows / some stacks) and pad short
 * writes out to 64 bytes the way Chrome sendReport(0, data) expects.
 */
export function normalizeHidReport(report: Uint8Array, packetSize = HID_PACKET_SIZE): Uint8Array {
  let bytes = report;
  if (bytes.length === packetSize + 1 && bytes[0] === 0) {
    bytes = bytes.subarray(1);
  }
  if (bytes.length > packetSize) {
    bytes = bytes.subarray(0, packetSize);
  }
  if (bytes.length === packetSize) {
    return bytes;
  }
  const padded = new Uint8Array(packetSize);
  padded.set(bytes);
  return padded;
}

/**
 * Wrap an APDU (or other tagged payload) as 64-byte Ledger USB HID reports.
 * Same layout as @ledgerhq/hw-transport HidFraming: channel + tag + seq + len.
 */
export function wrapHidFrame(
  tag: number,
  payload: Uint8Array,
  channel = HID_CHANNEL,
  packetSize = HID_PACKET_SIZE,
): Uint8Array[] {
  if (packetSize < 8) {
    throw new Error('HID packet too small');
  }
  const reports: Uint8Array[] = [];
  let offset = 0;
  let seq = 0;
  while (offset < payload.length || seq === 0) {
    const report = new Uint8Array(packetSize);
    report.set(writeU16BE(channel), 0);
    report[2] = tag & 0xff;
    report.set(writeU16BE(seq), 3);
    let cursor = 5;
    if (seq === 0) {
      report.set(writeU16BE(payload.length), 5);
      cursor = 7;
    }
    const take = Math.min(packetSize - cursor, payload.length - offset);
    if (take > 0) {
      report.set(payload.subarray(offset, offset + take), cursor);
      offset += take;
    }
    reports.push(report);
    seq += 1;
    if (offset >= payload.length) {
      break;
    }
  }
  return reports;
}

export function wrapHidApdu(
  apdu: Uint8Array,
  channel = HID_CHANNEL,
  packetSize = HID_PACKET_SIZE,
): Uint8Array[] {
  return wrapHidFrame(HID_TAG_APDU, apdu, channel, packetSize);
}

export class HidReassembler {
  private expected = -1;
  private seq = -1;
  private channel = -1;
  private tag = 0;
  private buffer = new Uint8Array(0);
  private readonly packetSize: number;

  constructor(packetSize = HID_PACKET_SIZE) {
    this.packetSize = packetSize;
  }

  reset(): void {
    this.expected = -1;
    this.seq = -1;
    this.channel = -1;
    this.tag = 0;
    this.buffer = new Uint8Array(0);
  }

  push(raw: Uint8Array): HidFrame | null {
    const report = normalizeHidReport(raw, this.packetSize);
    if (report.length < 7) {
      throw new Error('HID report too short');
    }
    const channel = readU16BE(report, 0);
    const tag = report[2];
    const seq = readU16BE(report, 3);

    if (seq === 0) {
      this.channel = channel;
      this.tag = tag;
      this.seq = 0;
      this.expected = readU16BE(report, 5);
      const take = Math.min(this.expected, this.packetSize - 7);
      this.buffer = Uint8Array.from(report.subarray(7, 7 + take));
    } else {
      if (this.seq < 0 || seq !== this.seq + 1 || channel !== this.channel || tag !== this.tag) {
        this.reset();
        throw new Error('HID sequence mismatch');
      }
      this.seq = seq;
      const remaining = this.expected - this.buffer.length;
      const take = Math.min(remaining, this.packetSize - 5);
      this.buffer = Uint8Array.from(concatBytes(this.buffer, report.subarray(5, 5 + take)));
    }

    if (this.buffer.length < this.expected) {
      return null;
    }
    const frame = {
      channel: this.channel,
      tag: this.tag,
      payload: this.buffer.slice(0, this.expected),
    };
    this.reset();
    return frame;
  }
}

export function unwrapHidReports(reports: Uint8Array[], packetSize = HID_PACKET_SIZE): HidFrame {
  const assembler = new HidReassembler(packetSize);
  let frame: HidFrame | null = null;
  for (const report of reports) {
    if (frame) {
      throw new Error('unexpected extra HID report');
    }
    frame = assembler.push(report);
  }
  if (!frame) {
    throw new Error('incomplete HID frame');
  }
  return frame;
}
