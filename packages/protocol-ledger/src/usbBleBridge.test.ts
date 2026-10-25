import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, type ConfirmationPort } from '@cws/contracts';
import { SW_OK } from './apdu';
import { bytesToHex } from './bytes';
import {
  BleReassembler,
  DEFAULT_MTU,
  framePayload,
  splitFramedPackets,
  TAG_APDU,
} from './framing';
import { LedgerProtocolHandler } from './handler';
import { wrapHidApdu, unwrapHidReports } from './hid';
import {
  blePacketsToHidReports,
  hidReportsToBlePackets,
  proxyHidThroughBleWrite,
  UsbBleProxy,
} from './usbBleBridge';

const FOUNDATION = 'test test test test test test test test test test test junk';
const EXPECTED_ADDRESS = 'f39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function autoConfirm(): ConfirmationPort {
  return {
    async confirm() {
      return true;
    },
    async getPassphrase() {
      return undefined;
    },
  };
}

function handler(): LedgerProtocolHandler {
  return new LedgerProtocolHandler({
    model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
    confirmation: autoConfirm(),
    slotId: 'slot',
    entropy: mnemonicToEntropy(FOUNDATION, wordlist),
  });
}

function openEthereum(): Uint8Array {
  const name = Array.from('Ethereum', (c) => c.charCodeAt(0));
  return Uint8Array.of(0xe0, 0xd8, 0x00, 0x00, name.length, ...name);
}

function getAddress(): Uint8Array {
  const path = [0x8000002c, 0x8000003c, 0x80000000, 0x00000000, 0x00000000];
  const data: number[] = [path.length];
  for (const component of path) {
    data.push(
      (component >>> 24) & 0xff,
      (component >>> 16) & 0xff,
      (component >>> 8) & 0xff,
      component & 0xff,
    );
  }
  return Uint8Array.of(0xe0, 0x02, 0x01, 0x00, data.length, ...data);
}

describe('USB HID ↔ BLE APDU bridge', () => {
  it('reframes a HID GET_ADDRESS as BLE tag-0x05 packets', () => {
    const apdu = getAddress();
    const { frame, packets } = hidReportsToBlePackets(wrapHidApdu(apdu), DEFAULT_MTU);
    expect(frame.tag).toBe(TAG_APDU);
    expect(bytesToHex(frame.payload)).toBe(bytesToHex(apdu));
    expect(packets[0][0]).toBe(TAG_APDU);
    const assembler = new BleReassembler();
    let out = null;
    for (const packet of packets) {
      out = assembler.push(packet);
    }
    expect(bytesToHex(out!.payload)).toBe(bytesToHex(apdu));
  });

  it('round-trips HID → BLE → HID without changing the APDU', () => {
    const apdu = Uint8Array.from({ length: 80 }, (_, i) => (i * 7) & 0xff);
    const hid = wrapHidApdu(apdu);
    const { packets } = hidReportsToBlePackets(hid, DEFAULT_MTU);
    const back = blePacketsToHidReports(packets);
    expect(bytesToHex(unwrapHidReports(back).payload)).toBe(bytesToHex(apdu));
  });

  it('proxies Chrome-shaped HID reports through the BLE handler', async () => {
    const device = handler();
    await proxyHidThroughBleWrite(wrapHidApdu(openEthereum()), DEFAULT_MTU, (packet) =>
      device.handleWrite(packet),
    );
    expect(device.getApp()).toBe('ethereum');

    const hidOut = await proxyHidThroughBleWrite(wrapHidApdu(getAddress()), DEFAULT_MTU, (packet) =>
      device.handleWrite(packet),
    );
    const payload = unwrapHidReports(hidOut).payload;
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    const pubLen = payload[0];
    const addrLen = payload[1 + pubLen];
    const address = Array.from(
      payload.slice(2 + pubLen, 2 + pubLen + addrLen),
      (b) => String.fromCharCode(b),
    ).join('');
    expect(address.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
    expect(hidOut.length).toBeGreaterThan(1);
  });

  it('streams HID reports through UsbBleProxy the way a gadget would', async () => {
    const device = handler();
    const proxy = new UsbBleProxy(DEFAULT_MTU);
    const reports = wrapHidApdu(openEthereum());
    let bleOut: Uint8Array[] | null = null;
    for (const report of reports) {
      bleOut = proxy.pushHid(report);
    }
    expect(bleOut).not.toBeNull();
    let hidReply: Uint8Array[] | null = null;
    for (const packet of bleOut!) {
      const framed = await device.handleWrite(packet);
      if (!framed) {
        continue;
      }
      for (const piece of splitFramedPackets(framed, DEFAULT_MTU)) {
        hidReply = proxy.pushBle(piece);
      }
    }
    expect(hidReply).not.toBeNull();
    const sw = unwrapHidReports(hidReply!).payload;
    expect((sw[sw.length - 2] << 8) | sw[sw.length - 1]).toBe(SW_OK);
  });

  it('keeps BLE MTU framing independent of the 64-byte HID packet', () => {
    const apdu = Uint8Array.from({ length: 40 }, (_, i) => i);
    const hid = wrapHidApdu(apdu);
    expect(hid).toHaveLength(1);
    const { packets } = hidReportsToBlePackets(hid, DEFAULT_MTU);
    expect(packets.length).toBeGreaterThan(1);
    expect(framePayload(TAG_APDU, apdu, DEFAULT_MTU)[0]).toBe(TAG_APDU);
  });
});
