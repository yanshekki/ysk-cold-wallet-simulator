import { BleReassembler, framePayload, splitFramedPackets, TAG_APDU } from './framing';
import {
  HID_CHANNEL,
  HID_PACKET_SIZE,
  HidReassembler,
  unwrapHidReports,
  wrapHidFrame,
  type HidFrame,
} from './hid';

export type BlePacketSink = (packet: Uint8Array) => Promise<Uint8Array | null>;

/**
 * Chrome WebHID talks 64-byte USB HID reports. The phone speaks Ledger BLE
 * framing (no channel, negotiated MTU). Same APDU in the middle — unwrap HID,
 * reframe BLE, then the reverse on the way back.
 */
export function hidReportsToBlePackets(
  reports: Uint8Array[],
  mtu: number,
): { frame: HidFrame; packets: Uint8Array[] } {
  const frame = unwrapHidReports(reports);
  return { frame, packets: splitFramedPackets(framePayload(frame.tag, frame.payload, mtu), mtu) };
}

export function blePacketsToHidReports(
  packets: Uint8Array[],
  channel = HID_CHANNEL,
  packetSize = HID_PACKET_SIZE,
): Uint8Array[] {
  const assembler = new BleReassembler();
  let frame = null;
  for (const packet of packets) {
    frame = assembler.push(packet);
  }
  if (!frame) {
    throw new Error('incomplete BLE frame');
  }
  return wrapHidFrame(frame.tag, frame.payload, channel, packetSize);
}

export async function proxyHidThroughBleWrite(
  reports: Uint8Array[],
  mtu: number,
  write: BlePacketSink,
  channel = HID_CHANNEL,
): Promise<Uint8Array[]> {
  const { packets } = hidReportsToBlePackets(reports, mtu);
  let outgoing: Uint8Array | null = null;
  for (const packet of packets) {
    const reply = await write(packet);
    if (reply) {
      outgoing = reply;
    }
  }
  if (!outgoing) {
    throw new Error('no BLE response');
  }
  return blePacketsToHidReports(splitFramedPackets(outgoing, mtu), channel);
}

/**
 * Streaming USB gadget: HID reports in, BLE packets out when an APDU
 * completes. BLE packets in, HID reports out when the response completes.
 */
export class UsbBleProxy {
  private readonly hid = new HidReassembler();
  private readonly ble = new BleReassembler();
  private channel = HID_CHANNEL;

  constructor(private readonly mtu: number) {}

  resetBle(): void {
    this.ble.reset();
  }

  pushHid(report: Uint8Array): Uint8Array[] | null {
    const frame = this.hid.push(report);
    if (!frame) {
      return null;
    }
    this.channel = frame.channel;
    return splitFramedPackets(framePayload(frame.tag, frame.payload, this.mtu), this.mtu);
  }

  pushBle(packet: Uint8Array, channel = this.channel): Uint8Array[] | null {
    const frame = this.ble.push(packet);
    if (!frame) {
      return null;
    }
    return wrapHidFrame(frame.tag, frame.payload, channel);
  }

  replyHid(tag: number, payload: Uint8Array, channel = this.channel): Uint8Array[] {
    return wrapHidFrame(tag, payload, channel);
  }
}

export function assertApduTag(frame: HidFrame): Uint8Array {
  if (frame.tag !== TAG_APDU) {
    throw new Error(`HID tag 0x${frame.tag.toString(16)} is not APDU`);
  }
  return frame.payload;
}
