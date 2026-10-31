import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { describe, expect, it } from 'vitest';
import { createBleTarget } from './bleLock';
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
              name: 'Sample的iPhone [Trezor Safe 7]',
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
    expect(bus.snapshot().serviceUUID).toBe(ONEKEY_MODELS[0]?.serviceUUID);
    expect(bus.snapshot().modelId).not.toBe('safe-7');
  });

  it('opens Flex by its own service UUID when the advertisement omits the UUID', async () => {
    const flex = LEDGER_MODELS.find((item) => item.id === 'flex')!;
    const opened: string[] = [];
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
        return `write=${flex.writeCharUUID} flags=swift-cb`;
      },
    };
    await runProxy(
      {
        async scan() {
          return [{ id: 'phone', name: 'Flex', services: [] }];
        },
        async openBle(_id, model) {
          opened.push(model.id);
          return connected;
        },
        createHid() {
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
    expect(opened[0]).toBe('flex');
    expect(opened).not.toContain('classic1s');
    expect(bus.snapshot().modelId).toBe('flex');
    expect(bus.snapshot().serviceUUID).toBe(flex.serviceUUID);
    expect(bus.snapshot().serviceUUID).not.toBe(LEDGER_MODELS.find((item) => item.id === 'nano-x')!.serviceUUID);
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

  it('skips an iOS system GATT phantom and binds the Android CWS advertiser', async () => {
    const pro2 = ONEKEY_MODELS.find((item) => item.id === 'pro2')!;
    const opened: string[] = [];
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
    const bus = createStatusBus();
    const logs: string[] = [];
    await runProxy(
      {
        async scan() {
          return [
            {
              id: 'iphone',
              name: 'Sample的iPhone [Pro 2 A1B2]',
              services: ['180a', 'd0611e78-848c-4dd4-bbd0-91f57c6b9aca'],
            },
            {
              id: 'android',
              name: 'Pro 2 A1B2',
              services: [pro2.serviceUUID],
            },
          ];
        },
        async openBle(id) {
          opened.push(id);
          if (id === 'iphone') {
            throw new Error(
              'missing write characteristic want=00000002-0000-1000-8000-00805f9b34fb have=180a/2a29,d0611e78-848c-4dd4-bbd0-91f57c6b9aca/0001',
            );
          }
          return connected;
        },
        createHid() {
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      (line) => logs.push(line),
      new AbortController().signal,
      { once: true, scanMs: 10, status: bus },
    );
    expect(opened).toEqual(['android']);
    expect(bus.snapshot().modelId).toBe('pro2');
    expect(bus.snapshot().phoneName).toBe('Pro 2 A1B2');
    expect(bus.snapshot().phase).not.toBe('error');
    expect(logs.some((line) => /missing write/.test(line) && /iphone/i.test(line))).toBe(false);
  });

  it('tries the next same-name advertiser when the first is missing a write characteristic', async () => {
    const opened: string[] = [];
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
    const bus = createStatusBus();
    const logs: string[] = [];
    await runProxy(
      {
        async scan() {
          return [
            {
              id: 'aaa-iphone',
              name: 'Pro 2 A1B2',
              services: [],
            },
            {
              id: 'zzz-android',
              name: 'Pro 2 A1B2',
              services: [],
            },
          ];
        },
        async openBle(id) {
          opened.push(id);
          if (id === 'aaa-iphone') {
            throw new Error(
              'missing write characteristic want=00000002-0000-1000-8000-00805f9b34fb have=180a/2a29',
            );
          }
          return connected;
        },
        createHid() {
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      (line) => logs.push(line),
      new AbortController().signal,
      { once: true, scanMs: 10, status: bus },
    );
    expect(opened).toEqual(['aaa-iphone', 'zzz-android']);
    expect(bus.snapshot().phoneName).toBe('Pro 2 A1B2');
    expect(bus.snapshot().modelId).toBe('pro2');
    expect(logs.some((line) => line.includes('skip Pro 2 A1B2 (aaa-iphone)'))).toBe(true);
  });

  it('does not stay connected to system-only GATT after a successful Android session', async () => {
    const pro2 = ONEKEY_MODELS.find((item) => item.id === 'pro2')!;
    const opened: string[] = [];
    let live = false;
    const bus = createStatusBus();
    const controller = new AbortController();
    const running = runProxy(
      {
        async scan() {
          if (opened.length === 0) {
            return [{ id: 'android', name: 'Pro 2 A1B2', services: [pro2.serviceUUID] }];
          }
          return [
            {
              id: 'iphone',
              name: 'Sample的iPhone [Pro 2 A1B2]',
              services: ['180a'],
            },
            {
              id: 'android',
              name: 'Pro 2 A1B2',
              services: [pro2.serviceUUID],
            },
          ];
        },
        async openBle(id) {
          opened.push(id);
          if (id === 'iphone') {
            throw new Error(
              'missing write characteristic want=00000002-0000-1000-8000-00805f9b34fb have=180a/2a29',
            );
          }
          live = true;
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
              return live;
            },
            debugInfo() {
              return 'write=00000002-0000-1000-8000-00805f9b34fb flags=swift-cb';
            },
          };
        },
        createHid() {
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      controller.signal,
      { scanMs: 10, persistHid: true, holder: createHidHolder(), status: bus },
    );
    await expect.poll(() => bus.snapshot().phoneName, { timeout: 1_000 }).toBe('Pro 2 A1B2');
    live = false;
    await expect
      .poll(() => opened.filter((id) => id === 'android').length, { timeout: 4_000 })
      .toBeGreaterThan(1);
    expect(opened.includes('iphone')).toBe(false);
    expect(bus.snapshot().phoneName).toBe('Pro 2 A1B2');
    expect(bus.snapshot().modelId).toBe('pro2');
    controller.abort();
    await running;
  });

  it('does not treat a lone iOS system GATT peripheral as a CWS session', async () => {
    const opened: string[] = [];
    const bus = createStatusBus();
    await expect(
      runProxy(
        {
          async scan() {
            return [
              {
                id: 'iphone',
                name: 'Sample的iPhone [Pro 2 A1B2]',
                services: ['180a', 'd0611e78-848c-4dd4-bbd0-91f57c6b9aca'],
              },
            ];
          },
          async openBle(id) {
            opened.push(id);
            throw new Error('missing write characteristic want=00000002 have=180a/2a29');
          },
          createHid() {
            return memoryHidPair().gadget;
          },
          async askPairingCode() {
            return '000000';
          },
        },
        () => undefined,
        new AbortController().signal,
        { once: true, scanMs: 10, status: bus },
      ),
    ).rejects.toThrow(/no CWS device advertising/);
    expect(opened).toEqual([]);
    expect(bus.snapshot().modelId).toBeNull();
  });

  it('waits for an explicit pick and does not hop to a louder phone', async () => {
    const nano = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const target = createBleTarget(null);
    const opened: string[] = [];
    let live = true;
    const bus = createStatusBus();
    const controller = new AbortController();
    const running = runProxy(
      {
        async scan() {
          return [
            { id: 'phone-a', name: 'Nano X A', services: [nano.serviceUUID], rssi: -80 },
            { id: 'phone-b', name: 'Nano X B', services: [nano.serviceUUID], rssi: -40 },
          ];
        },
        async openBle(id) {
          opened.push(id);
          if (!live) {
            throw new Error('disconnected');
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
              return live;
            },
          };
        },
        createHid() {
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      controller.signal,
      { scanMs: 20, skipHid: true, status: bus, bleTarget: target },
    );
    try {
      await expect
        .poll(() => bus.snapshot().nearby.map((item) => item.id), { timeout: 1_000 })
        .toEqual(['phone-b', 'phone-a']);
      expect(opened).toEqual([]);
      expect(bus.snapshot().locked).toBe(false);
      target.select({ id: 'phone-a', name: 'Nano X A', modelId: 'nano-x' });
      await expect.poll(() => opened[0], { timeout: 1_000 }).toBe('phone-a');
      expect(opened.every((id) => id === 'phone-a')).toBe(true);
      expect(bus.snapshot().locked).toBe(true);
      expect(bus.snapshot().targetId).toBe('phone-a');
      live = false;
      await expect.poll(() => opened.length, { timeout: 4_000 }).toBeGreaterThan(1);
      expect(opened.includes('phone-b')).toBe(false);
      const beforeSwitch = opened.length;
      target.unlock();
      await expect.poll(() => bus.snapshot().locked, { timeout: 1_000 }).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(opened.includes('phone-b')).toBe(false);
      target.select({ id: 'phone-b', name: 'Nano X B', modelId: 'nano-x' });
      await expect.poll(() => opened.includes('phone-b'), { timeout: 1_000 }).toBe(true);
      expect(opened.slice(0, beforeSwitch).includes('phone-b')).toBe(false);
      expect(bus.snapshot().targetId).toBe('phone-b');
    } finally {
      controller.abort();
      await running;
    }
  });

  it('keeps a saved lock on the quieter phone', async () => {
    const nano = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const target = createBleTarget({ id: 'phone-a', name: 'Nano X A', modelId: 'nano-x' });
    const opened: string[] = [];
    let live = true;
    const bus = createStatusBus();
    const controller = new AbortController();
    const running = runProxy(
      {
        async scan() {
          return [
            { id: 'phone-a', name: 'Nano X A', services: [nano.serviceUUID], rssi: -75 },
            { id: 'phone-b', name: 'Nano X B', services: [nano.serviceUUID], rssi: -30 },
          ];
        },
        async openBle(id) {
          opened.push(id);
          if (!live) {
            throw new Error('disconnected');
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
              return live;
            },
          };
        },
        createHid() {
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      controller.signal,
      { scanMs: 20, skipHid: true, status: bus, bleTarget: target },
    );
    try {
      await expect.poll(() => opened[0], { timeout: 1_000 }).toBe('phone-a');
      expect(bus.snapshot().locked).toBe(true);
      expect(bus.snapshot().targetName).toBe('Nano X A');
      live = false;
      await expect.poll(() => opened.length, { timeout: 4_000 }).toBeGreaterThan(1);
      expect(new Set(opened)).toEqual(new Set(['phone-a']));
    } finally {
      controller.abort();
      await running;
    }
  });

  it('rescan keeps the lock and connects when that phone appears', async () => {
    const nano = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const target = createBleTarget({ id: 'phone-a', name: 'Nano X A', modelId: 'nano-x' });
    let visible = false;
    const opened: string[] = [];
    const logs: string[] = [];
    const controller = new AbortController();
    const running = runProxy(
      {
        async scan() {
          if (!visible) {
            return [{ id: 'phone-b', name: 'Nano X B', services: [nano.serviceUUID], rssi: -40 }];
          }
          return [{ id: 'phone-a', name: 'Nano X A', services: [nano.serviceUUID], rssi: -70 }];
        },
        async openBle(id) {
          opened.push(id);
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
              return true;
            },
          };
        },
        createHid() {
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      (line) => logs.push(line),
      controller.signal,
      { scanMs: 20, skipHid: true, bleTarget: target },
    );
    try {
      await expect
        .poll(() => logs.some((line) => line.includes('locked Nano X A (phone-a) not advertising')), {
          timeout: 1_000,
        })
        .toBe(true);
      expect(opened).toEqual([]);
      expect(target.snapshot().lock?.id).toBe('phone-a');
      visible = true;
      target.rescan();
      await expect.poll(() => opened[0], { timeout: 1_000 }).toBe('phone-a');
      expect(opened.includes('phone-b')).toBe(false);
    } finally {
      controller.abort();
      await running;
    }
  });

  it('tells each waiting phone its lock id without opening a session', async () => {
    const nano = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const target = createBleTarget(null);
    const told: string[] = [];
    const opened: string[] = [];
    const controller = new AbortController();
    const running = runProxy(
      {
        async scan() {
          return [
            { id: 'phone-a', name: 'Nano X', services: [nano.serviceUUID], rssi: -70 },
            { id: 'phone-b', name: 'Nano X', services: [nano.serviceUUID], rssi: -40 },
          ];
        },
        async identify(id) {
          told.push(id);
        },
        async openBle(id) {
          opened.push(id);
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
              return true;
            },
          };
        },
        createHid() {
          return memoryHidPair().gadget;
        },
        async askPairingCode() {
          return '000000';
        },
      },
      () => undefined,
      controller.signal,
      { scanMs: 20, skipHid: true, bleTarget: target },
    );
    try {
      await expect.poll(() => [...told].sort(), { timeout: 1_000 }).toEqual(['phone-a', 'phone-b']);
      expect(opened).toEqual([]);
    } finally {
      controller.abort();
      await running;
    }
  });
});
