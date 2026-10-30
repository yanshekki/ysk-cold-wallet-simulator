import { collectPrefixedHid, unwrapPrefixedHid, wrapPrefixedHid } from '@cws/contracts';
import { concatBytes } from './bytes';
import { DEFAULT_MTU, V1Reassembler, clampMtu, frameV1, splitOneKeyV1, type V1Message } from './framing';
import { V2FrameAssembler } from './v2';

const V1_BLE_MAGIC = 0x3f;

export function bleV1ToUsbStream(framed: Uint8Array): Uint8Array {
  if (framed.length >= 3 && framed[0] === V1_BLE_MAGIC && framed[1] === 0x23 && framed[2] === 0x23) {
    return framed.subarray(1);
  }
  return framed;
}

export function usbStreamToBleV1(stream: Uint8Array): Uint8Array {
  if (stream.length >= 2 && stream[0] === 0x23 && stream[1] === 0x23) {
    return concatBytes(Uint8Array.of(V1_BLE_MAGIC), stream);
  }
  return stream;
}

function tryV1(stream: Uint8Array): Uint8Array | null {
  const framed = usbStreamToBleV1(stream);
  const message = new V1Reassembler().push(framed);
  if (!message) {
    return null;
  }
  return frameV1(message.type, message.payload);
}

function tryV2(stream: Uint8Array): Uint8Array | null {
  const assembler = new V2FrameAssembler();
  const frames = assembler.drain(stream);
  if (frames.length === 0) {
    return null;
  }
  return concatBytes(...frames);
}

/**
 * USB HID 0x3F reports ↔ OneKey BLE V1 (3F2323) or V2 (5A frames).
 * One command at a time; padding after a complete message is dropped.
 */
export class OneKeyUsbBleBridge {
  private hidStream: Uint8Array = new Uint8Array(0);
  private pendingUsb: Uint8Array = new Uint8Array(0);
  private readonly v1Ble = new V1Reassembler();
  private readonly v2Ble = new V2FrameAssembler();
  private readonly mtu: number;

  constructor(
    private readonly protocol: 'onekey-v1' | 'onekey-v2',
    mtu = DEFAULT_MTU,
  ) {
    this.mtu = clampMtu(mtu);
  }

  pushHid(report: Uint8Array): Uint8Array[] | null {
    this.hidStream = concatBytes(this.hidStream, unwrapPrefixedHid(report));
    const framed =
      this.protocol === 'onekey-v2' ? tryV2(this.hidStream) : tryV1(this.hidStream);
    if (!framed) {
      return null;
    }
    this.hidStream = new Uint8Array(0);
    return this.protocol === 'onekey-v2' ? splitChunks(framed, this.mtu) : splitOneKeyV1(framed, this.mtu);
  }

  pushBle(packet: Uint8Array): Uint8Array[] | null {
    if (this.protocol === 'onekey-v2') {
      const frames = this.v2Ble.drain(packet);
      if (frames.length === 0) {
        return null;
      }
      this.pendingUsb = concatBytes(this.pendingUsb, ...frames);
      if (this.v2Ble.bufferedBytes > 0) {
        return emitFullHidReports(this.pendingUsb, (rest) => {
          this.pendingUsb = rest;
        });
      }
      const reports = wrapPrefixedHid(this.pendingUsb);
      this.pendingUsb = new Uint8Array(0);
      return reports;
    }
    const message = this.v1Ble.push(packet);
    if (!message) {
      return null;
    }
    return wrapPrefixedHid(bleV1ToUsbStream(frameV1(message.type, message.payload)));
  }
}

export function encodeUsbV1(message: V1Message): Uint8Array[] {
  return wrapPrefixedHid(bleV1ToUsbStream(frameV1(message.type, message.payload)));
}

export function decodeUsbV1(reports: Uint8Array[]): V1Message {
  const framed = usbStreamToBleV1(collectPrefixedHid(reports));
  const message = new V1Reassembler().push(framed);
  if (!message) {
    throw new Error('incomplete OneKey USB V1 message');
  }
  return message;
}

/** Full 63-byte HID payloads only. The short tail stays unpadded until the V2 frame ends. */
function emitFullHidReports(
  pending: Uint8Array,
  keep: (rest: Uint8Array) => void,
): Uint8Array[] | null {
  const full = Math.floor(pending.length / 63) * 63;
  if (full === 0) {
    return null;
  }
  keep(pending.slice(full));
  const reports: Uint8Array[] = [];
  for (let offset = 0; offset < full; offset += 63) {
    const report = new Uint8Array(64);
    report[0] = 0x3f;
    report.set(pending.subarray(offset, offset + 63), 1);
    reports.push(report);
  }
  return reports;
}

function splitChunks(bytes: Uint8Array, size: number): Uint8Array[] {
  if (bytes.length === 0) {
    return [];
  }
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.subarray(i, Math.min(bytes.length, i + size)));
  }
  return chunks;
}
