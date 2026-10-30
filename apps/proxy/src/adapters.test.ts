import { blake2b } from '@noble/hashes/blake2b';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import {
  LEDGER_MODELS,
  ONEKEY_MODELS,
  TREZOR_MODELS,
  wrapPrefixedHid,
  type ConfirmationPort,
} from '@cws/contracts';
import {
  DEFAULT_MTU,
  LedgerProtocolHandler,
  SW_OK,
  TAG_APDU,
  deriveIcarus,
  encodeAppAndVersion,
  encodeResponse,
  framePayload,
  signIcarus,
  splitFramedPackets,
  unwrapHidReports,
  wrapHidApdu,
} from '@cws/protocol-ledger';
import {
  DEFAULT_MTU as ONEKEY_MTU,
  MessageType as OneKeyMessageType,
  OneKeyV1ProtocolHandler,
  V2FrameAssembler,
  V2MessageType,
  decodeFeatures as decodeOneKeyFeatures,
  decodeUsbV1,
  encodeProtobufFrame,
  encodeUsbV1,
  splitOneKeyV1,
} from '@cws/protocol-onekey';
import {
  MessageType,
  TrezorThpProtocolHandler,
  decodeFeatures,
  splitThpPackets,
  unwrapUsbHidReports,
  wrapUsbHid,
} from '@cws/protocol-trezor';
import { attachLedger } from './adapters/ledger';
import { attachOneKey } from './adapters/onekey';
import { ThpClient } from './adapters/thp';
import { attachTrezor } from './adapters/trezor';
import { bleToHandler, memoryHidPair } from './ports';

const FOUNDATION = 'test test test test test test test test test test test junk';
const EXPECTED_ADDRESS = 'f39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function entropy(): Uint8Array {
  return mnemonicToEntropy(FOUNDATION, wordlist);
}

function autoConfirm(): ConfirmationPort & { pairingCode: string | null } {
  const port: ConfirmationPort & { pairingCode: string | null } = {
    pairingCode: null,
    async confirm() {
      return true;
    },
    async getPassphrase() {
      return undefined;
    },
    onPairingCode(code) {
      port.pairingCode = code;
    },
  };
  return port;
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

function splitMtu(bytes: Uint8Array, mtu: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += mtu) {
    chunks.push(bytes.subarray(i, Math.min(bytes.length, i + mtu)));
  }
  return chunks.length > 0 ? chunks : [bytes];
}

describe('attachLedger', () => {
  it('pipes HID GET_ADDRESS through the BLE handler', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));

    for (const report of wrapHidApdu(openEthereum())) {
      host.write(report);
    }
    await adapter.idle();
    replies.length = 0;

    for (const report of wrapHidApdu(getAddress())) {
      host.write(report);
    }
    await adapter.idle();
    const payload = unwrapHidReports(replies).payload;
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    const pubLen = payload[0];
    const addrLen = payload[1 + pubLen];
    const address = Array.from(
      payload.slice(2 + pubLen, 2 + pubLen + addrLen),
      (b) => String.fromCharCode(b),
    ).join('');
    expect(address.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
    adapter.close();
  });

  it('switches from Ethereum to Solana for empty GET_APP_CONFIGURATION', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    device.setApp('ethereum');
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const payload = unwrapHidReports(replies).payload;
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_OK);
    expect(payload[0]).toBe(0x01);
    expect(device.getApp()).toBe('solana');
    adapter.close();
  });

  it('forwards Solana GET_APP_CONFIGURATION instead of dropping it as GET_APP', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    device.setApp('solana');
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const payload = unwrapHidReports(replies).payload;
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    expect(payload[0]).toBe(0x01);
    expect(payload.length).toBe(7);
    adapter.close();
  });

  it('does not forward a BLE APDU before a HID command', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    const ble = {
      async write() {
        return;
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x6d, 0x00));
    expect(replies).toEqual([]);
    adapter.close();
  });

  it('holds the next HID APDU until the previous BLE reply arrives', async () => {
    const { host, gadget } = memoryHidPair();
    const writes: Uint8Array[] = [];
    const ble = {
      async write(packet: Uint8Array) {
        writes.push(packet);
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const version = wrapHidApdu(Uint8Array.of(0xe0, 0x06, 0x00, 0x00, 0x00));
    const config = wrapHidApdu(Uint8Array.of(0xe0, 0x02, 0x00, 0x00, 0x00));
    for (const report of version) {
      host.write(report);
    }
    await Promise.resolve();
    await Promise.resolve();
    const first = writes.length;
    expect(first).toBeGreaterThan(0);
    for (const report of config) {
      host.write(report);
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(writes.length).toBe(first);
    adapter.close();
  });

  it('ignores a 6D00 that arrives before the GET_ADDRESS payload', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    const ble = {
      async write() {
        return;
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(getAddress())) {
      host.write(report);
    }
    await Promise.resolve();
    await Promise.resolve();
    notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x6d, 0x00));
    await Promise.resolve();
    expect(replies).toEqual([]);
    notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x90, 0x00));
    await adapter.idle();
    expect(replies.length).toBeGreaterThan(0);
    expect(replies[0]?.[7]).toBe(0x90);
    adapter.close();
  });

  it('ignores a 6E00 that arrives before GET_XPUB payload', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    const ble = {
      async write() {
        return;
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    const xpub = Uint8Array.of(0x80, 0x03, 0x00, 0x00, 0x00);
    for (const report of wrapHidApdu(xpub)) {
      host.write(report);
    }
    await Promise.resolve();
    await Promise.resolve();
    notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x6e, 0x00));
    notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x6e, 0x00));
    await Promise.resolve();
    expect(replies).toEqual([]);
    const body = new Uint8Array(1 + 33 + 32);
    body[0] = 0x21;
    const framed = encodeResponse(body, SW_OK);
    for (const piece of splitFramedPackets(framePayload(TAG_APDU, framed, DEFAULT_MTU), DEFAULT_MTU)) {
      notify?.(piece);
    }
    await adapter.idle();
    expect(unwrapHidReports(replies).payload).toEqual(framed);
    adapter.close();
  });

  it('forwards an unarmed 6D00 so TON GET_VERSION does not stall the queue', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    const ble = {
      async write() {
        setTimeout(() => notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x6d, 0x00)), 0);
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x03, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    await adapter.idle();
    expect(replies[0]?.[7]).toBe(0x6d);
    adapter.close();
  });

  it('forwards a 6D00 that arrives before BLE write resolves after a 9000', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    let writes = 0;
    const ble = {
      async write() {
        writes += 1;
        if (writes === 1) {
          notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x90, 0x00));
          return;
        }
        notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x6d, 0x00));
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x05, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x03, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    await adapter.idle();
    expect(replies[0]?.[7]).toBe(0x6d);
    adapter.close();
  });

  it('forwards a second unarmed 6D00 instead of dropping it as leftover', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    const ble = {
      async write() {
        notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x6d, 0x00));
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x06, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    await adapter.idle();
    expect(replies[0]?.[7]).toBe(0x6d);
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x06, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    await adapter.idle();
    expect(replies[0]?.[7]).toBe(0x6d);
    adapter.close();
  });

  it('forwards a TON version 9000 that arrives before BLE write resolves', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    let writes = 0;
    const ble = {
      async write() {
        writes += 1;
        if (writes === 1) {
          notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x90, 0x00));
          return;
        }
        notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x05, 0x02, 0x09, 0x01, 0x90, 0x00));
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x05, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x03, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    expect(unwrapHidReports(replies).payload).toEqual(Uint8Array.of(0x02, 0x09, 0x01, 0x90, 0x00));
    adapter.close();
  });

  it('forwards a lone 6E00 after a short hold so the host can OpenApp', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    let writes = 0;
    const ble = {
      async write() {
        writes += 1;
        if (writes === 1) {
          setTimeout(() => notify?.(Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x6e, 0x00)), 0);
          return;
        }
        notify?.(framePayload(TAG_APDU, encodeAppAndVersion('BOLOS', '2.7.1'), DEFAULT_MTU));
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0x80, 0x04, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(replies).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await adapter.idle();
    expect(replies[0]?.[7]).toBe(0x6e);
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    expect(unwrapHidReports(replies).payload[1]).toBe(5);
    adapter.close();
  });

  it('answers GET_APP_AND_VERSION on another HID channel while an APDU is in flight', async () => {
    const { host, gadget } = memoryHidPair();
    const ble = {
      async write() {
        await new Promise(() => undefined);
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0x80, 0x04, 0x00, 0x00, 0x00), 0x1111)) {
      host.write(report);
    }
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00), 0x2222)) {
      host.write(report);
    }
    expect(replies).toHaveLength(1);
    expect((replies[0]![0] << 8) | replies[0]![1]).toBe(0x2222);
    expect(unwrapHidReports(replies).payload).toEqual(encodeAppAndVersion('BOLOS', '2.7.1'));
    adapter.close();
  });

  it('forwards GET_APP_AND_VERSION over BLE so the phone app name is used', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const dashboard = unwrapHidReports(replies).payload;
    expect(Array.from(dashboard, (b) => String.fromCharCode(b)).join('')).toContain('BOLOS');
    expect(dashboard[0]).toBe(0x01);
    expect(dashboard[7]).toBeGreaterThan(0);

    replies.length = 0;
    for (const report of wrapHidApdu(openEthereum())) {
      host.write(report);
    }
    await adapter.idle();
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const opened = Array.from(unwrapHidReports(replies).payload, (b) => String.fromCharCode(b)).join('');
    expect(opened).toContain('Ethereum');
    adapter.close();
  });

  it('reports Avalanche on GET_APP_AND_VERSION after the host opens that app', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    const avaxName = Array.from('Avalanche', (c) => c.charCodeAt(0));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0xd8, 0x00, 0x00, avaxName.length, ...avaxName))) {
      host.write(report);
    }
    await adapter.idle();
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const text = Array.from(unwrapHidReports(replies).payload, (b) => String.fromCharCode(b)).join('');
    expect(text).toContain('Avalanche');
    expect(text).toContain('1.4.22');
    adapter.close();
  });

  it('setOpenAppName updates cached GET_APP_AND_VERSION used while BLE is busy', async () => {
    const { host, gadget } = memoryHidPair();
    const ble = {
      async write() {
        await new Promise(() => undefined);
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    adapter.setOpenAppName('Avalanche');
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x01, 0x00, 0x00, 0x00), 0x1111)) {
      host.write(report);
    }
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00), 0x2222)) {
      host.write(report);
    }
    const body = Array.from(unwrapHidReports(replies).payload, (b) => String.fromCharCode(b)).join('');
    expect(body).toContain('Avalanche');
    adapter.close();
  });

  it('forwards idle GET_APP_AND_VERSION so phone Select app Bitcoin is visible', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    device.setApp('bitcoin');
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const body = Array.from(unwrapHidReports(replies).payload, (b) => String.fromCharCode(b)).join('');
    expect(body).toContain('Bitcoin');
    adapter.close();
  });

  it('forwards idle GET_APP_AND_VERSION so Core sees phone Select app Avalanche', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    device.setApp('avalanche');
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const body = Array.from(unwrapHidReports(replies).payload, (b) => String.fromCharCode(b)).join('');
    expect(body).toContain('Avalanche');
    expect(body).toContain('1.4.22');
    adapter.close();
  });

  it('opens Avalanche when Core GET_VERSION arrives on the dashboard HID link', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0x80, 0x00, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const version = unwrapHidReports(replies).payload;
    expect((version[version.length - 2] << 8) | version[version.length - 1]).toBe(SW_OK);
    expect(device.getApp()).toBe('avalanche');
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const body = Array.from(unwrapHidReports(replies).payload, (b) => String.fromCharCode(b)).join('');
    expect(body).toContain('Avalanche');
    adapter.close();
  });

  it('keeps GET_APP_AND_VERSION on the previous app until OpenApp returns 9000', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    let releaseWrite: (() => void) | undefined;
    const stale9000 = Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x90, 0x00);
    const ble = {
      async write() {
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
        queueMicrotask(() => notify?.(stale9000));
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    const solName = Array.from('Solana', (c) => c.charCodeAt(0));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0xd8, 0x00, 0x00, solName.length, ...solName))) {
      host.write(report);
    }
    await Promise.resolve();
    await Promise.resolve();
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    expect(replies).toEqual([]);
    releaseWrite?.();
    await adapter.idle();
    const flushed = replies.map((report) => unwrapHidReports([report]).payload);
    expect(flushed.some((payload) => payload[0] === 0x90 && payload[1] === 0x00)).toBe(true);
    expect(
      flushed.some((payload) => Array.from(payload, (b) => String.fromCharCode(b)).join('').includes('Solana')),
    ).toBe(true);
    adapter.close();
  });

  it('hold-forwards an unarmed OpenApp 9000 after QUIT so app cache updates', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    let writes = 0;
    const status9000 = Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x90, 0x00);
    const ble = {
      async write() {
        writes += 1;
        if (writes === 1) {
          notify?.(status9000);
          return;
        }
        // OpenApp success arrives before receiveArmed (same race as Solana MORE).
        notify?.(status9000);
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0xa7, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    replies.length = 0;
    const solName = Array.from('Solana', (c) => c.charCodeAt(0));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0xd8, 0x00, 0x00, solName.length, ...solName))) {
      host.write(report);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    await adapter.idle();
    expect(writes).toBe(2);
    expect(replies.some((report) => report[7] === 0x90 && report[8] === 0x00)).toBe(true);
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const flushed = replies.map((report) => unwrapHidReports([report]).payload);
    expect(
      flushed.some((payload) => Array.from(payload, (b) => String.fromCharCode(b)).join('').includes('Solana')),
    ).toBe(true);
    adapter.close();
  });


  it('hold-forwards an unarmed Solana SIGN MORE 9000 after a prior empty OK', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    let writes = 0;
    const status9000 = Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x90, 0x00);
    const ble = {
      async write() {
        writes += 1;
        // Every reply is an empty 9000 that arrives before receiveArmed.
        // After the first exchange lastStatusSw is 9000; the old leftover
        // drop swallowed the Solana SIGN MORE ACK and Solflare never sent
        // the final chunk (no phone signing sheet).
        notify?.(status9000);
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const logs: string[] = [];
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, (line) => logs.push(line));
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    expect(replies[0]?.[7]).toBe(0x90);
    replies.length = 0;
    logs.length = 0;
    const path = [0x03, 0x80, 0x00, 0x00, 0x2c, 0x80, 0x00, 0x01, 0xf5, 0x80, 0x00, 0x00, 0x00];
    const head = [0x01, ...path, 0x11, 0x22];
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x06, 0x01, 0x02, head.length, ...head))) {
      host.write(report);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    await adapter.idle();
    expect(writes).toBeGreaterThanOrEqual(2);
    expect(replies.some((report) => report[7] === 0x90 && report[8] === 0x00)).toBe(true);
    expect(logs.some((line) => line.includes('holding 0x9000'))).toBe(true);
    expect(logs.some((line) => line.includes('ignored leftover'))).toBe(false);
    adapter.close();
  });

  it.each([
    {
      name: 'Ethereum SIGN first chunk',
      apdu: Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x02, 0xf8, 0x01),
    },
    {
      name: 'Cardano v8 SIGN_TX INIT',
      apdu: Uint8Array.of(0xd7, 0x21, 0x10, 0x00, 0x00),
    },
    {
      name: 'Cardano SIGN_CVOTE INIT',
      apdu: Uint8Array.of(0xd7, 0x23, 0x50, 0x00, 0x00),
    },
    {
      name: 'Cardano native script INIT',
      apdu: Uint8Array.of(0xd7, 0x12, 0x00, 0x00, 0x00),
    },
    {
      name: 'Cardano CIP-8 INIT',
      apdu: Uint8Array.of(0xd7, 0x24, 0x01, 0x00, 0x00),
    },
    {
      name: 'Avalanche SIGN init',
      apdu: Uint8Array.of(0x80, 0x05, 0x00, 0x00, 0x00),
    },
    {
      name: 'Aptos SIGN with P2 more',
      apdu: Uint8Array.of(0x5b, 0x06, 0x00, 0x80, 0x00),
    },
    {
      name: 'Cosmos SIGN Zondax init',
      apdu: Uint8Array.of(0x55, 0x02, 0x00, 0x00, 0x00),
    },
    {
      name: 'XRP SIGN with P1 more',
      apdu: Uint8Array.of(0xe0, 0x04, 0x80, 0x00, 0x00),
    },
    {
      name: 'NEAR SIGN mid-chunk',
      apdu: Uint8Array.of(0x80, 0x02, 0x00, 0x00, 0x00),
    },
  ])('hold-forwards an unarmed empty 9000 for $name', async ({ apdu }) => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    let writes = 0;
    const status9000 = Uint8Array.of(0x05, 0x00, 0x00, 0x00, 0x02, 0x90, 0x00);
    const ble = {
      async write() {
        writes += 1;
        notify?.(status9000);
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const logs: string[] = [];
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, (line) => logs.push(line));
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x04, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    expect(replies[0]?.[7]).toBe(0x90);
    replies.length = 0;
    logs.length = 0;
    for (const report of wrapHidApdu(apdu)) {
      host.write(report);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    await adapter.idle();
    expect(writes).toBeGreaterThanOrEqual(2);
    expect(replies.some((report) => report[7] === 0x90 && report[8] === 0x00)).toBe(true);
    expect(logs.some((line) => line.includes('holding 0x9000'))).toBe(true);
    expect(logs.some((line) => line.includes('ignored leftover'))).toBe(false);
    adapter.close();
  });

  it('ignores an all-zero HID probe without forwarding BLE', async () => {
    const { host, gadget } = memoryHidPair();
    const writes: Uint8Array[] = [];
    const ble = {
      async write(packet: Uint8Array) {
        writes.push(packet);
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    host.write(new Uint8Array(64));
    await Promise.resolve();
    await Promise.resolve();
    expect(writes).toEqual([]);
    expect(replies).toEqual([]);
    adapter.close();
  });

  it('replaces an echoed GET_APP_AND_VERSION with a parseable BOLOS reply', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    const ble = {
      async write() {
        const echo = Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
        notify?.(framePayload(TAG_APDU, echo, DEFAULT_MTU));
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    expect(unwrapHidReports(replies).payload).toEqual(encodeAppAndVersion('BOLOS', '2.7.1'));
    adapter.close();
  });

  it('pads a truncated GET_APP_AND_VERSION HID reply so the version LV is present', async () => {
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    const ble = {
      async write() {
        const name = Array.from('BOLOS', (c) => c.charCodeAt(0));
        const truncated = encodeResponse(Uint8Array.of(0x01, name.length, ...name), SW_OK);
        expect(truncated.length).toBe(9);
        notify?.(framePayload(TAG_APDU, truncated, DEFAULT_MTU));
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    await adapter.idle();
    const payload = unwrapHidReports(replies).payload;
    expect(payload).toEqual(encodeAppAndVersion('BOLOS', '2.7.1'));
    expect((replies[0]![5] << 8) | replies[0]![6]).toBe(payload.length);
    adapter.close();
  });

  it('forwards GET_ADDRESS even if a BLE sequence is duplicated', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    const { host, gadget } = memoryHidPair();
    let notify: ((packet: Uint8Array) => void) | undefined;
    const ble = {
      async write(packet: Uint8Array) {
        const framed = await device.handleWrite(packet);
        if (!framed) {
          return;
        }
        for (const piece of splitFramedPackets(framed, DEFAULT_MTU)) {
          notify?.(piece);
          if (piece.length >= 3 && piece[2] === 3) {
            notify?.(piece);
          }
        }
      },
      onNotify(callback: (packet: Uint8Array) => void) {
        notify = callback;
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(openEthereum())) {
      host.write(report);
    }
    await adapter.idle();
    replies.length = 0;
    for (const report of wrapHidApdu(getAddress())) {
      host.write(report);
    }
    await adapter.idle();
    const payload = unwrapHidReports(replies).payload;
    const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
    expect(sw).toBe(SW_OK);
    adapter.close();
  });

  it('does not inject GET_APP_AND_VERSION while another APDU is in flight', async () => {
    const { host, gadget } = memoryHidPair();
    const ble = {
      async write() {
        await new Promise(() => undefined);
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00))) {
      host.write(report);
    }
    expect(replies).toEqual([]);
    adapter.close();
  });

  it('answers GET_APP_AND_VERSION from cache on another channel while BLE is busy', async () => {
    const { host, gadget } = memoryHidPair();
    const writes: Uint8Array[] = [];
    const ble = {
      async write(packet: Uint8Array) {
        writes.push(packet);
        await new Promise(() => undefined);
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    adapter.setOpenAppName('Bitcoin');
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x01, 0x00, 0x00, 0x00), 0x1111)) {
      host.write(report);
    }
    const bleWrites = writes.length;
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00), 0x7c56)) {
      host.write(report);
    }
    expect(writes.length).toBe(bleWrites);
    expect(unwrapHidReports(replies).payload).toEqual(encodeAppAndVersion('Bitcoin', '2.5.1'));
    expect((replies[0]![0] << 8) | replies[0]![1]).toBe(0x7c56);
    adapter.close();
  });

  it('replies to each concurrent GET_APP_AND_VERSION from cache while BLE is busy', async () => {
    const { host, gadget } = memoryHidPair();
    const writes: Uint8Array[] = [];
    const ble = {
      async write(packet: Uint8Array) {
        writes.push(packet);
        await new Promise(() => undefined);
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
    };
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    adapter.setOpenAppName('Avalanche');
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xe0, 0x01, 0x00, 0x00, 0x00), 0x1111)) {
      host.write(report);
    }
    replies.length = 0;
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00), 0xd56a)) {
      host.write(report);
    }
    for (const report of wrapHidApdu(Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00), 0xfa6d)) {
      host.write(report);
    }
    expect(replies).toHaveLength(2);
    expect((replies[0]![0] << 8) | replies[0]![1]).toBe(0xd56a);
    expect((replies[1]![0] << 8) | replies[1]![1]).toBe(0xfa6d);
    expect(unwrapHidReports([replies[0]!]).payload).toEqual(encodeAppAndVersion('Avalanche', '1.4.22'));
    expect(unwrapHidReports([replies[1]!]).payload).toEqual(encodeAppAndVersion('Avalanche', '1.4.22'));
    adapter.close();
  });

  it.each([
    { app: 'canton', command: Uint8Array.of(0xe0, 0x03, 0x00, 0x00, 0x00), body: [0x03, 0x05, 0x01] },
    { app: 'kaspa', command: Uint8Array.of(0xe0, 0x03, 0x00, 0x00, 0x00), body: [0x01, 0x02, 0x02] },
    {
      app: 'iota',
      command: Uint8Array.of(0x00, 0x00, 0x00, 0x00, 0x00),
      body: [0x01, 0x00, 0x04, 0x69, 0x6f, 0x74, 0x61],
    },
    { app: 'nervos', command: Uint8Array.of(0x80, 0x00, 0x00, 0x00, 0x00), body: [0x00, 0x06, 0x03] },
    {
      app: 'namada',
      command: Uint8Array.of(0x57, 0x00, 0x00, 0x00, 0x00),
      body: [0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x06, 0x00, 0x33, 0x00, 0x00, 0x04],
    },
    {
      app: 'spacemesh',
      command: Uint8Array.of(0x45, 0x00, 0x00, 0x00, 0x00),
      body: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00],
    },
    { app: 'qubic', command: Uint8Array.of(0xe0, 0x03, 0x00, 0x00, 0x00), body: [0x00, 0x01, 0x07] },
    { app: 'solar', command: Uint8Array.of(0xe0, 0xa2, 0x00, 0x00, 0x00), body: [0x01, 0x03, 0x01] },
    { app: 'lto-network', command: Uint8Array.of(0x80, 0x06, 0x00, 0x00, 0x00), body: [0x02, 0x02, 0x03] },
    { app: 'factom', command: Uint8Array.of(0xe0, 0x06, 0x00, 0x00, 0x00), body: [0x00, 0x01, 0x02, 0x01] },
  ])('forwards $app GET_VERSION over HID', async ({ app, command, body }) => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    device.setApp(app);
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(command)) {
      host.write(report);
    }
    await adapter.idle();
    const payload = unwrapHidReports(replies).payload;
    expect(Array.from(payload.subarray(0, payload.length - 2))).toEqual(body);
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_OK);
    expect(device.getApp()).toBe(app);
    adapter.close();
  });

  it('forwards a Cardano operational certificate over HID', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    device.setApp('cardano');
    const kes = Uint8Array.from(
      '3d24bc547388cf2403fd978fc3d3a93d1f39acf68a9c00e40512084dc05f2822'.match(/../g)!,
      (byte) => Number.parseInt(byte, 16),
    );
    const period = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0x2f);
    const counter = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0x2a);
    const path = [0x8000073d, 0x80000717, 0x80000000, 0x80000000];
    const data: number[] = [...kes, ...period, ...counter, path.length];
    for (const component of path) {
      data.push(
        (component >>> 24) & 0xff,
        (component >>> 16) & 0xff,
        (component >>> 8) & 0xff,
        component & 0xff,
      );
    }
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(Uint8Array.of(0xd7, 0x22, 0x00, 0x00, data.length, ...data))) {
      host.write(report);
    }
    await adapter.idle();
    const payload = unwrapHidReports(replies).payload;
    const signed = new Uint8Array(48);
    signed.set(kes, 0);
    signed.set(counter, 32);
    signed.set(period, 40);
    const node = deriveIcarus(entropy(), "m/1853'/1815'/0'/0'");
    expect(Array.from(payload.subarray(0, payload.length - 2))).toEqual(
      Array.from(signIcarus(node, signed)),
    );
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_OK);
    expect(device.getApp()).toBe('cardano');
    adapter.close();
  });

  it('forwards a Cardano CIP-36 vote over HID', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    device.setApp('cardano');
    const votecast = new Uint8Array(34).fill(0x5a);
    const init = Uint8Array.of(0xd7, 0x23, 0x50, 0x00, 38, 0, 0, 0, 34, ...votecast);
    const path = [0x8000069e, 0x80000717, 0x80000000, 0, 0];
    const confirmData: number[] = [path.length];
    for (const component of path) {
      confirmData.push(
        (component >>> 24) & 0xff,
        (component >>> 16) & 0xff,
        (component >>> 8) & 0xff,
        component & 0xff,
      );
    }
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapHidApdu(init)) {
      host.write(report);
    }
    await adapter.idle();
    const started = unwrapHidReports(replies).payload;
    expect(started.length).toBe(2);
    expect((started[0] << 8) | started[1]).toBe(SW_OK);
    replies.length = 0;
    for (const report of wrapHidApdu(
      Uint8Array.of(0xd7, 0x23, 0x52, 0x00, confirmData.length, ...confirmData),
    )) {
      host.write(report);
    }
    await adapter.idle();
    const payload = unwrapHidReports(replies).payload;
    const body = payload.subarray(0, payload.length - 2);
    expect(body.length).toBe(96);
    const node = deriveIcarus(entropy(), "m/1694'/1815'/0'/0/0");
    expect(Array.from(body.subarray(32))).toEqual(Array.from(signIcarus(node, body.subarray(0, 32))));
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_OK);
    expect(device.getApp()).toBe('cardano');
    adapter.close();
  });

  it('forwards a Cardano native script hash over HID', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    device.setApp('cardano');
    const keyHash = new Uint8Array(28).fill(0x11);
    const steps = [
      Uint8Array.of(0xd7, 0x12, 0x00, 0x00, 0x00),
      Uint8Array.of(0xd7, 0x12, 0x01, 0x00, 0x05, 0x01, 0x00, 0x00, 0x00, 0x01),
      Uint8Array.of(0xd7, 0x12, 0x02, 0x00, 30, 0x00, 0x00, ...keyHash),
      Uint8Array.of(0xd7, 0x12, 0x03, 0x00, 0x01, 0x02),
    ];
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    let payload = new Uint8Array();
    for (const command of steps) {
      replies.length = 0;
      for (const report of wrapHidApdu(command)) {
        host.write(report);
      }
      await adapter.idle();
      payload = unwrapHidReports(replies).payload;
    }
    const cbor = Uint8Array.of(0x00, 0x82, 0x01, 0x81, 0x82, 0x00, 0x58, 0x1c, ...keyHash);
    expect(Array.from(payload.subarray(0, payload.length - 2))).toEqual(
      Array.from(blake2b(cbor, { dkLen: 28 })),
    );
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_OK);
    expect(device.getApp()).toBe('cardano');
    adapter.close();
  });

  it('forwards a Cardano CIP-8 key-hash message over HID', async () => {
    const device = new LedgerProtocolHandler({
      model: LEDGER_MODELS.find((item) => item.id === 'nano-x')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    device.setApp('cardano');
    const path = [0x8000073c, 0x80000717, 0x80000000, 0, 0];
    const pathBytes: number[] = [path.length];
    for (const component of path) {
      pathBytes.push((component >>> 24) & 0xff, (component >>> 16) & 0xff, (component >>> 8) & 0xff, component & 0xff);
    }
    const init = Uint8Array.of(0xd7, 0x24, 0x01, 0x00, 4 + pathBytes.length + 3, 0, 0, 0, 2, ...pathBytes, 0x01, 0x02, 0x02);
    const chunk = Uint8Array.of(0xd7, 0x24, 0x02, 0x00, 6, 0, 0, 0, 2, 0x48, 0x69);
    const confirm = Uint8Array.of(0xd7, 0x24, 0x03, 0x00, 0x00);
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const adapter = attachLedger(gadget, ble, DEFAULT_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    let payload = new Uint8Array();
    for (const command of [init, chunk, confirm]) {
      replies.length = 0;
      for (const report of wrapHidApdu(command)) {
        host.write(report);
      }
      await adapter.idle();
      payload = unwrapHidReports(replies).payload;
    }
    const body = payload.subarray(0, payload.length - 2);
    const node = deriveIcarus(entropy(), "m/1852'/1815'/0'/0/0");
    const keyHash = blake2b(node.publicKey, { dkLen: 28 });
    const header = Uint8Array.of(0xa2, 0x01, 0x27, 0x67, 0x61, 0x64, 0x64, 0x72, 0x65, 0x73, 0x73, 0x58, 0x1c, ...keyHash);
    const structure = Uint8Array.of(
      0x84, 0x6a, 0x53, 0x69, 0x67, 0x6e, 0x61, 0x74, 0x75, 0x72, 0x65, 0x31,
      0x58, header.length, ...header, 0x40, 0x42, 0x48, 0x69,
    );
    expect(body.length).toBe(128);
    expect(Array.from(body.subarray(0, 64))).toEqual(Array.from(signIcarus(node, structure)));
    expect((payload[payload.length - 2] << 8) | payload[payload.length - 1]).toBe(SW_OK);
    expect(device.getApp()).toBe('cardano');
    adapter.close();
  });
});

describe('attachOneKey', () => {
  it('round-trips USB Initialize to Features over V1 BLE', async () => {
    const device = new OneKeyV1ProtocolHandler({
      model: ONEKEY_MODELS.find((item) => item.id === 'classic')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitOneKeyV1(framed, ONEKEY_MTU));
    const adapter = attachOneKey(gadget, ble, 'onekey-v1', ONEKEY_MTU, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of encodeUsbV1({ type: OneKeyMessageType.Initialize, payload: new Uint8Array() })) {
      host.write(report);
    }
    await adapter.idle();
    const message = decodeUsbV1(replies);
    expect(message.type).toBe(OneKeyMessageType.Features);
    expect(decodeOneKeyFeatures(message.payload).vendor).toBe('onekey.so');
    adapter.close();
  });

  it('wraps a V2 ping in 0x3F HID reports', async () => {
    const device = new OneKeyV1ProtocolHandler({
      model: ONEKEY_MODELS.find((item) => item.id === 'pro2')!,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: entropy(),
    });
    const { host, gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitMtu(framed, 20));
    const adapter = attachOneKey(gadget, ble, 'onekey-v2', 20, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    const ping = encodeProtobufFrame(V2MessageType.DeviceInfoGet, new Uint8Array(), 0, 1, 3);
    for (const report of wrapPrefixedHid(ping)) {
      host.write(report);
    }
    await adapter.idle();
    expect(replies.length).toBeGreaterThan(0);
    expect(replies[0][0]).toBe(0x3f);
    const stream = replies.reduce((all, report) => {
      const next = new Uint8Array(all.length + report.length - 1);
      next.set(all);
      next.set(report.subarray(1), all.length);
      return next;
    }, new Uint8Array());
    const frames = new V2FrameAssembler().drain(stream);
    expect(frames.length).toBeGreaterThan(0);
    adapter.close();
  });
});

describe('Trezor USB terminator', () => {
  it('answers USB Initialize with Features after a THP handshake', async () => {
    const confirmation = autoConfirm();
    const device = new TrezorThpProtocolHandler({
      model: TREZOR_MODELS.find((item) => item.id === 'safe-7')!,
      confirmation,
      slotId: 'slot',
      entropy: entropy(),
    });
    const ble = bleToHandler(device, (framed) => splitThpPackets(framed, 20));
    const thp = new ThpClient(ble, () => undefined, async () => confirmation.pairingCode ?? '', 8_000);
    await thp.start();
    const { host, gadget } = memoryHidPair();
    const adapter = attachTrezor(gadget, thp, () => undefined);
    const replies: Uint8Array[] = [];
    host.onInput((report) => replies.push(report));
    for (const report of wrapUsbHid(MessageType.Initialize, new Uint8Array())) {
      host.write(report);
    }
    await adapter.idle();
    const message = unwrapUsbHidReports(replies);
    expect(message.type).toBe(MessageType.Features);
    expect(decodeFeatures(message.payload).vendor).toBe('trezor.io');
    adapter.close();
    thp.close();
  });
});
