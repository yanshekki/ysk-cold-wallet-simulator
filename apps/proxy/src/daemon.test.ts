import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS, ONEKEY_MODELS, TREZOR_MODELS, type ConfirmationPort } from '@cws/contracts';
import { DEFAULT_MTU, LedgerProtocolHandler, splitFramedPackets } from '@cws/protocol-ledger';
import {
  createHidHolder,
  runProxy,
  type ConnectedBle,
  type LabSlot,
  type ProxyIo,
} from './daemon';
import type { LabHandle } from './lab';
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

  it('creates HID after the phone model is known', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const { gadget } = memoryHidPair();
    const order: string[] = [];
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
      async isConnected() {
        return false;
      },
    };
    await runProxy(
      {
        async scan() {
          order.push('scan');
          return [{ id: 'phone', name: 'Nano X', services: [model.serviceUUID] }];
        },
        async openBle() {
          order.push('ble');
          return connected;
        },
        createHid() {
          order.push('hid');
          return gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      new AbortController().signal,
      { once: true, scanMs: 10 },
    );
    expect(order[0]).toBe('scan');
    expect(order.indexOf('hid')).toBeGreaterThan(order.indexOf('scan'));
    expect(order.indexOf('ble')).toBeLessThan(order.indexOf('hid'));
  });

  it('republishes persisted HID before scanning so Chrome can requestDevice', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const { gadget } = memoryHidPair();
    const order: string[] = [];
    const holder = createHidHolder();
    holder.hid = gadget;
    holder.model = model;
    holder.hidState = 'up';
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
      async isConnected() {
        return false;
      },
    };
    await runProxy(
      {
        async scan() {
          order.push('scan');
          return [{ id: 'phone', name: 'Nano X', services: [model.serviceUUID] }];
        },
        async openBle() {
          order.push('ble');
          return connected;
        },
        createHid() {
          order.push('hid');
          return gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      new AbortController().signal,
      { once: true, scanMs: 10, persistHid: true, holder },
    );
    expect(order[0]).toBe('scan');
    expect(order).not.toContain('hid');
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

  it('exposes dash-version on the GATT lab slot', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const device = new LedgerProtocolHandler({
      model,
      confirmation: autoConfirm(),
      slotId: 'slot',
      entropy: mnemonicToEntropy(FOUNDATION, wordlist),
    });
    const { gadget } = memoryHidPair();
    const ble = bleToHandler(device, (framed) => splitFramedPackets(framed, DEFAULT_MTU));
    let live = true;
    const connected: ConnectedBle = {
      ...ble,
      async isConnected() {
        return live;
      },
    };
    let handle: LabHandle | undefined;
    const labSlot: LabSlot = {
      set(next) {
        handle = next;
      },
    };
    const controller = new AbortController();
    const logs: string[] = [];
    const running = runProxy(
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
      { once: true, scanMs: 10, labSlot },
    );
    const deadline = Date.now() + 2_000;
    while (!handle && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(handle).toBeDefined();
    const result = await handle!.run('dash-version');
    expect(result.startsWith('0x')).toBe(true);
    expect(logs.some((line) => line.startsWith('ble =>'))).toBe(true);
    expect(logs.some((line) => line.includes('hid <='))).toBe(false);
    live = false;
    controller.abort();
    await running;
  });

  it('reuses HID across runProxy restarts when persistHid is set', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const { gadget } = memoryHidPair();
    let creates = 0;
    const holder = createHidHolder();
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
      async isConnected() {
        return false;
      },
    };
    const io: ProxyIo = {
      async scan() {
        return [{ id: 'phone', name: 'Nano X', services: [model.serviceUUID] }];
      },
      async openBle() {
        return connected;
      },
      createHid() {
        creates += 1;
        return gadget;
      },
      async askPairingCode() {
        return '000000';
      },
    };
    const logs: string[] = [];
    await runProxy(io, (line) => logs.push(line), new AbortController().signal, {
      once: true,
      scanMs: 10,
      persistHid: true,
      holder,
    });
    expect(creates).toBe(1);
    expect(holder.hid).toBe(gadget);
    await runProxy(io, (line) => logs.push(line), new AbortController().signal, {
      once: true,
      scanMs: 10,
      persistHid: true,
      holder,
    });
    expect(creates).toBe(1);
    expect(logs.some((line) => line.includes('hid reused'))).toBe(true);
  });

  it('creates Nano Gen5 HID once without seeding Nano X', async () => {
    const gen5 = LEDGER_MODELS.find((item) => item.id === 'gen5')!;
    const created: string[] = [];
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
      async isConnected() {
        return false;
      },
    };
    const bus = createStatusBus();
    await runProxy(
      {
        async scan() {
          return [{ id: 'phone', name: 'Nano Gen5', services: [gen5.serviceUUID] }];
        },
        async openBle() {
          return connected;
        },
        createHid(model) {
          created.push(model.id);
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      new AbortController().signal,
      { once: true, scanMs: 10, status: bus },
    );
    expect(created).toEqual(['gen5']);
    expect(bus.snapshot().hid).toBe('up');
    expect(bus.snapshot().modelId).toBe('gen5');
    expect(bus.snapshot().productId).toBe(gen5.usb.productId);
  });

  it('switches persisted Nano X HID to Nano Gen5', async () => {
    const nano = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const gen5 = LEDGER_MODELS.find((item) => item.id === 'gen5')!;
    const { gadget } = memoryHidPair();
    const created: string[] = [];
    const switched: string[] = [];
    gadget.switchModel = async (model) => {
      switched.push(model.id);
    };
    const holder = createHidHolder();
    holder.hid = gadget;
    holder.model = nano;
    holder.hidState = 'up';
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
      async isConnected() {
        return false;
      },
    };
    const bus = createStatusBus();
    const logs: string[] = [];
    await runProxy(
      {
        async scan() {
          return [{ id: 'phone', name: 'Nano Gen5', services: [gen5.serviceUUID] }];
        },
        async openBle() {
          return connected;
        },
        createHid(model) {
          created.push(model.id);
          return gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      (line) => logs.push(line),
      new AbortController().signal,
      { once: true, scanMs: 10, persistHid: true, holder, status: bus },
    );
    expect(created).toEqual([]);
    expect(switched).toEqual(['gen5']);
    expect(logs.some((line) => line.includes('hid switch'))).toBe(true);
    expect(bus.snapshot().modelId).toBe('gen5');
    expect(bus.snapshot().hid).toBe('up');
    expect(bus.snapshot().productId).toBe(gen5.usb.productId);
  });

  it('creates Trezor HID once without seeding Nano X', async () => {
    const trezor = TREZOR_MODELS.find((item) => item.id === 'safe-7')!;
    const created: string[] = [];
    const bus = createStatusBus();
    const controller = new AbortController();
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
      async isConnected() {
        return false;
      },
    };
    const running = runProxy(
      {
        async scan() {
          return [{ id: 'phone', name: 'Trezor Safe 7', services: [trezor.serviceUUID] }];
        },
        async openBle() {
          return connected;
        },
        createHid(model) {
          created.push(model.id);
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      controller.signal,
      { once: true, scanMs: 10, status: bus },
    );
    await expect.poll(() => bus.snapshot().hid, { timeout: 1_000 }).toBe('up');
    expect(created).toEqual(['safe-7']);
    expect(bus.snapshot().vendorId).toBe(0x1209);
    expect(bus.snapshot().productId).toBe(0x53c0);
    controller.abort();
    await running;
  });

  it('creates OneKey HID once without seeding Nano X', async () => {
    const pro2 = ONEKEY_MODELS.find((item) => item.id === 'pro2')!;
    const created: string[] = [];
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
      async isConnected() {
        return false;
      },
    };
    const bus = createStatusBus();
    await runProxy(
      {
        async scan() {
          return [{ id: 'phone', name: 'Pro 2 A1B2', services: [pro2.serviceUUID] }];
        },
        async openBle() {
          return connected;
        },
        createHid(model) {
          created.push(model.id);
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      new AbortController().signal,
      { once: true, scanMs: 10, status: bus },
    );
    expect(created).toEqual(['pro2']);
    expect(bus.snapshot().hid).toBe('up');
    expect(bus.snapshot().modelId).toBe('pro2');
    expect(bus.snapshot().brand).toBe('onekey');
  });

  it('does not keep Trezor when GAP name is leftover and GATT is OneKey', async () => {
    const created: string[] = [];
    const bus = createStatusBus();
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
      async isConnected() {
        return false;
      },
      debugInfo() {
        return 'write=00000002-0000-1000-8000-00805f9b34fb flags=swift-cb';
      },
    };
    await runProxy(
      {
        async scan() {
          return [
            {
              id: 'phone',
              name: 'Shek Ki的iPhone [Trezor Safe 7]',
              services: [],
            },
          ];
        },
        async openBle() {
          return connected;
        },
        createHid(model) {
          created.push(model.id);
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      new AbortController().signal,
      { once: true, scanMs: 10, status: bus },
    );
    expect(created.some((id) => id === 'safe-7')).toBe(false);
    expect(bus.snapshot().brand).toBe('onekey');
    expect(bus.snapshot().modelId).toBe('classic1s');
  });

  it('drops the session when the phone switches from Ledger to OneKey', async () => {
    const nano = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const pro2 = ONEKEY_MODELS.find((item) => item.id === 'pro2')!;
    const { gadget } = memoryHidPair();
    const switched: string[] = [];
    gadget.switchModel = async (model) => {
      switched.push(model.id);
    };
    const holder = createHidHolder();
    let live = true;
    const bus = createStatusBus();
    const controller = new AbortController();
    const running = runProxy(
      {
        async scan() {
          if (live) {
            return [{ id: 'phone', name: 'Nano X', services: [nano.serviceUUID] }];
          }
          return [{ id: 'phone', name: 'Pro 2 A1B2', services: [pro2.serviceUUID] }];
        },
        async openBle(_id, model) {
          if (model.brand === 'ledger' && !live) {
            throw new Error('missing write characteristic');
          }
          return {
            async write() {
              return;
            },
            onNotify() {
              return () => undefined;
            },
            async close() {
              return;
            },
            async isConnected() {
              return model.brand === 'ledger' ? live : true;
            },
          };
        },
        createHid() {
          return gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      controller.signal,
      { scanMs: 10, persistHid: true, holder, status: bus },
    );
    await expect.poll(() => bus.snapshot().modelId, { timeout: 1_000 }).toBe('nano-x');
    live = false;
    await expect.poll(() => bus.snapshot().modelId, { timeout: 4_000 }).toBe('pro2');
    expect(bus.snapshot().brand).toBe('onekey');
    expect(switched).toContain('pro2');
    controller.abort();
    await running;
  });

  it('retries HID create after write EPIPE', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const { gadget } = memoryHidPair();
    let attempts = 0;
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      async close() {
        return;
      },
      async isConnected() {
        return false;
      },
    };
    const bus = createStatusBus();
    const logs: string[] = [];
    await runProxy(
      {
        async scan() {
          return [{ id: 'phone', name: 'Nano X', services: [model.serviceUUID] }];
        },
        async openBle() {
          return connected;
        },
        createHid() {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('write EPIPE');
          }
          return gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      (line) => logs.push(line),
      new AbortController().signal,
      { once: true, scanMs: 10, status: bus },
    );
    expect(attempts).toBe(2);
    expect(logs.some((line) => line.includes('hid retry'))).toBe(true);
    expect(bus.snapshot().hid).toBe('up');
  });
});
