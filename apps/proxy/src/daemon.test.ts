import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, type ConfirmationPort } from '@cws/contracts';
import { DEFAULT_MTU, LedgerProtocolHandler, splitFramedPackets } from '@cws/protocol-ledger';
import { runProxy, type ConnectedBle, type ProxyIo } from './daemon';
import { bleToHandler, memoryHidPair } from './ports';
import { createStatusBus } from './status';

const FOUNDATION = 'test test test test test test test test test test test junk';

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

describe('runProxy', () => {
  it('spawns a Ledger HID session from a scan hit', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: mnemonicToEntropy(FOUNDATION, wordlist),
    });
    const { gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const connected: ConnectedBle = {
      ...ble,
      async isConnected() {
        return false;
      },
    };
    const logs: string[] = [];
    const controller = new AbortController();
    await runProxy(
      {
        async scan() {
          return [{ id: 'phone', name: 'Nano X', services: [model.serviceUUID] }];
        },
        async openBle() {
          return connected;
        },
        createHid() {
          return gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      (line) => logs.push(line),
      controller.signal,
      { once: true, scanMs: 10 },
    );
    expect(logs.some((line) => line.includes('hid vid='))).toBe(true);
    expect(logs.some((line) => line.includes('session closed'))).toBe(true);
  });

  it('keeps BLE when HID create fails', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: mnemonicToEntropy(FOUNDATION, wordlist),
    });
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    const connected: ConnectedBle = {
      ...ble,
      async isConnected() {
        return false;
      },
    };
    const logs: string[] = [];
    const bus = createStatusBus();
    const io: ProxyIo = {
      async scan() {
        return [{ id: 'phone', name: 'Nano X', services: [model.serviceUUID] }];
      },
      async openBle() {
        return connected;
      },
      createHid() {
        throw new Error(
          'IOHIDUserDeviceCreateWithProperties failed. macOS needs the com.apple.developer.hid.virtual.device entitlement on the node binary (see apps/proxy/macos).',
        );
      },
      async askPairingCode() {
        return '000000';
      },
    };
    await runProxy(io, (line) => logs.push(line), new AbortController().signal, {
      once: true,
      scanMs: 10,
      status: bus,
    });
    expect(logs.some((line) => line.includes('hid failed'))).toBe(true);
    expect(logs.some((line) => line.includes('session closed'))).toBe(true);
    expect(bus.snapshot().hid).toBe('failed');
    expect(bus.snapshot().phase).toBe('gatt');
    expect(bus.snapshot().radio).toBe('GATT');
  });
});
