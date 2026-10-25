import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS } from '@cws/contracts';
import type { ConnectedBle, ProxyIo } from './daemon';
import { memoryHidPair } from './ports';
import { createRuntime } from './runtime';
import { createStatusBus } from './status';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('proxy runtime', () => {
  it('does not scan until start, then stop returns idle', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const { gadget } = memoryHidPair();
    let scans = 0;
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
        return true;
      },
    };
    const io: ProxyIo = {
      async scan() {
        scans += 1;
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
    };
    const bus = createStatusBus();
    const parent = new AbortController();
    const runtime = createRuntime(io, () => undefined, bus, parent.signal, { scanMs: 20 });
    await sleep(40);
    expect(scans).toBe(0);
    expect(bus.snapshot().running).toBe(false);
    expect(bus.snapshot().radio).toBe('IDLE');
    runtime.start();
    await sleep(80);
    expect(scans).toBeGreaterThan(0);
    expect(bus.snapshot().running).toBe(true);
    expect(['SCAN', 'GATT', 'HID']).toContain(bus.snapshot().radio);
    runtime.stop();
    await runtime.wait();
    expect(bus.snapshot().running).toBe(false);
    expect(bus.snapshot().radio).toBe('IDLE');
    parent.abort();
  });

  it('stop returns idle even if BLE isConnected hangs', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const { gadget } = memoryHidPair();
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
      isConnected() {
        return new Promise(() => undefined);
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
        return gadget;
      },
      async askPairingCode() {
        return '000000';
      },
    };
    const bus = createStatusBus();
    const parent = new AbortController();
    const runtime = createRuntime(io, () => undefined, bus, parent.signal, { scanMs: 20 });
    runtime.start();
    await expect.poll(() => bus.snapshot().hid, { timeout: 1_000 }).toBe('up');
    runtime.stop();
    await Promise.race([
      runtime.wait(),
      sleep(500).then(() => {
        throw new Error('stop hung on isConnected');
      }),
    ]);
    expect(bus.snapshot().running).toBe(false);
    expect(runtime.busy()).toBe(false);
    parent.abort();
  });

  it('stop returns idle even if BLE close hangs', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const { gadget } = memoryHidPair();
    const connected: ConnectedBle = {
      async write() {
        return;
      },
      onNotify() {
        return () => undefined;
      },
      close() {
        return new Promise(() => undefined);
      },
      async isConnected() {
        return true;
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
        return gadget;
      },
      async askPairingCode() {
        return '000000';
      },
    };
    const bus = createStatusBus();
    const parent = new AbortController();
    const runtime = createRuntime(io, () => undefined, bus, parent.signal, { scanMs: 20 });
    runtime.start();
    await expect.poll(() => bus.snapshot().hid, { timeout: 1_000 }).toBe('up');
    runtime.stop();
    expect(bus.snapshot().running).toBe(false);
    expect(bus.snapshot().radio).toBe('IDLE');
    await Promise.race([
      runtime.wait(),
      sleep(800).then(() => {
        throw new Error('stop hung on ble.close');
      }),
    ]);
    expect(runtime.busy()).toBe(false);
    parent.abort();
  });

  it('surfaces a missing native build without scanning', () => {
    const bus = createStatusBus(false);
    const io: ProxyIo = {
      async scan() {
        throw new Error('should not scan');
      },
      async openBle() {
        throw new Error('should not open');
      },
      createHid() {
        throw new Error('should not hid');
      },
      async askPairingCode() {
        return '000000';
      },
    };
    const runtime = createRuntime(io, () => undefined, bus, new AbortController().signal, {
      nativeReady: false,
    });
    runtime.start();
    expect(runtime.busy()).toBe(false);
    expect(bus.snapshot().phase).toBe('error');
    expect(bus.snapshot().error ?? '').toMatch(/native-proxy/);
  });
});
