import { collectPrefixedHid, unwrapPrefixedHid, wrapPrefixedHid } from '@cws/contracts';
import { concatBytes, readU16BE, readU32BE, writeU16BE, writeU32BE } from './bytes';

export const USB_MAGIC = Uint8Array.of(0x23, 0x23);
export const USB_HEADER_LENGTH = 8;

export type UsbProtobuf = {
  type: number;
  payload: Uint8Array;
};

export function encodeUsbProtobuf(type: number, payload: Uint8Array): Uint8Array {
  return concatBytes(USB_MAGIC, writeU16BE(type), writeU32BE(payload.length), payload);
}

export function decodeUsbProtobuf(stream: Uint8Array): UsbProtobuf | null {
  if (stream.length < USB_HEADER_LENGTH) {
    return null;
  }
  if (stream[0] !== USB_MAGIC[0] || stream[1] !== USB_MAGIC[1]) {
    throw new Error('invalid Trezor USB magic');
  }
  const type = readU16BE(stream, 2);
  const length = readU32BE(stream, 4);
  if (stream.length < USB_HEADER_LENGTH + length) {
    return null;
  }
  return { type, payload: stream.slice(USB_HEADER_LENGTH, USB_HEADER_LENGTH + length) };
}

export function wrapUsbHid(type: number, payload: Uint8Array): Uint8Array[] {
  return wrapPrefixedHid(encodeUsbProtobuf(type, payload));
}

export class UsbHidReassembler {
  private buffer: Uint8Array = new Uint8Array(0);

  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  push(report: Uint8Array): UsbProtobuf | null {
    this.buffer = concatBytes(this.buffer, unwrapPrefixedHid(report));
    const message = decodeUsbProtobuf(this.buffer);
    if (!message) {
      return null;
    }
    this.reset();
    return message;
  }
}

export function unwrapUsbHidReports(reports: Uint8Array[]): UsbProtobuf {
  const message = decodeUsbProtobuf(collectPrefixedHid(reports));
  if (!message) {
    throw new Error('incomplete Trezor USB message');
  }
  return message;
}
