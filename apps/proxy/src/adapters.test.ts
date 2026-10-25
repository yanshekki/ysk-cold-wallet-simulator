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
