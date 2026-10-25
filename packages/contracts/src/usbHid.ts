import { USB_HID_REPORT_SIZE } from './usb';

export const USB_HID_PREFIX = 0x3f;
const CHUNK = USB_HID_REPORT_SIZE - 1;

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Trezor / OneKey USB: every 64-byte report starts with 0x3F, then 63 payload bytes. */
export function wrapPrefixedHid(stream: Uint8Array): Uint8Array[] {
  const reports: Uint8Array[] = [];
  let offset = 0;
  while (offset < stream.length || reports.length === 0) {
    const report = new Uint8Array(USB_HID_REPORT_SIZE);
    report[0] = USB_HID_PREFIX;
    const take = Math.min(CHUNK, Math.max(0, stream.length - offset));
    if (take > 0) {
      report.set(stream.subarray(offset, offset + take), 1);
    }
    reports.push(report);
    offset += take;
    if (offset >= stream.length) {
      break;
    }
  }
  return reports;
}

export function unwrapPrefixedHid(report: Uint8Array): Uint8Array {
  let bytes = report;
  if (bytes.length === USB_HID_REPORT_SIZE + 1 && bytes[0] === 0) {
    bytes = bytes.subarray(1);
  }
  if (bytes.length < 2 || bytes[0] !== USB_HID_PREFIX) {
    throw new Error('USB HID report missing 0x3F prefix');
  }
  return bytes.subarray(1, USB_HID_REPORT_SIZE);
}

export function collectPrefixedHid(reports: Uint8Array[]): Uint8Array {
  return concatBytes(...reports.map(unwrapPrefixedHid));
}
