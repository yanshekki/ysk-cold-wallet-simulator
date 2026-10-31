import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEDGER_MODELS } from '@cws/contracts';
import { readBleLock } from './bleLock';
import type { ConnectedBle, ProxyIo } from './daemon';
import { memoryHidPair } from './ports';
import { createRuntime, teeLog } from './runtime';
import { createStatusBus } from './status';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('proxy runtime', () => {
  it('keeps UI console lines even if stderr write throws', () => {
    const bus = createStatusBus();
    const teed = teeLog(() => {
      throw new Error('EPIPE');
    }, bus);
    teed('hid vid=0x2c97');
    expect(bus.snapshot().logs.map((entry) => entry.line)).toEqual(['hid vid=0x2c97']);
  });

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
    await expect.poll(() => runtime.labCatalog().ready, { timeout: 1_000 }).toBe(true);
    expect(bus.snapshot().labReady).toBe(true);
    expect(runtime.labCatalog().sections.length).toBeGreaterThan(0);
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

  it('reuses virtual HID across stop and start', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const { gadget } = memoryHidPair();
    let creates = 0;
    let live = true;
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
        return live;
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
    const bus = createStatusBus();
    const parent = new AbortController();
    const runtime = createRuntime(io, () => undefined, bus, parent.signal, { scanMs: 20 });
    runtime.start();
    await expect.poll(() => bus.snapshot().hid, { timeout: 1_000 }).toBe('up');
    expect(creates).toBe(1);
    live = false;
    runtime.stop();
    await runtime.wait();
    expect(bus.snapshot().hid).toBe('up');
    live = true;
    runtime.start();
    await expect.poll(() => bus.snapshot().running, { timeout: 1_000 }).toBe(true);
    expect(creates).toBe(1);
    expect(bus.snapshot().hid).toBe('up');
    runtime.stop();
    await runtime.wait();
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

  it('saves the picked phone and the next start stays on that id', async () => {
    const model = LEDGER_MODELS.find((item) => item.id === 'nano-x')!;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cws-proxy-lock-'));
    const file = path.join(dir, 'ble-lock.json');
    const opened: string[] = [];
    const io: ProxyIo = {
      async scan() {
        return [
          { id: 'phone-a', name: 'Nano X A', services: [model.serviceUUID], rssi: -70 },
          { id: 'phone-b', name: 'Nano X B', services: [model.serviceUUID], rssi: -45 },
        ];
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
    };
    const parent = new AbortController();
    const bus = createStatusBus();
    const runtime = createRuntime(io, () => undefined, bus, parent.signal, {
      scanMs: 20,
      skipHid: true,
      picker: true,
      bleLockFile: file,
    });
    try {
      runtime.start();
      await expect
        .poll(() => bus.snapshot().nearby.map((item) => item.id), { timeout: 1_000 })
        .toEqual(['phone-b', 'phone-a']);
      expect(opened).toEqual([]);
      runtime.selectBle('phone-a');
      await expect.poll(() => opened[0], { timeout: 1_000 }).toBe('phone-a');
      expect(opened.every((id) => id === 'phone-a')).toBe(true);
      expect(readBleLock(file)).toMatchObject({ id: 'phone-a', name: 'Nano X A', modelId: 'nano-x' });
      runtime.stop();
      await runtime.wait();
      expect(bus.snapshot().running).toBe(false);
      expect(bus.snapshot().locked).toBe(true);
      expect(bus.snapshot().targetId).toBe('phone-a');
      opened.length = 0;
      const bus2 = createStatusBus();
      const restarted = createRuntime(io, () => undefined, bus2, parent.signal, {
        scanMs: 20,
        skipHid: true,
        picker: true,
        bleLockFile: file,
      });
      try {
        restarted.start();
        await expect.poll(() => opened[0], { timeout: 1_000 }).toBe('phone-a');
        expect(opened.includes('phone-b')).toBe(false);
        expect(bus2.snapshot().locked).toBe(true);
        restarted.unlockBle();
        await expect.poll(() => bus2.snapshot().locked, { timeout: 1_000 }).toBe(false);
        expect(fs.existsSync(file)).toBe(false);
      } finally {
        restarted.stop();
        await restarted.wait();
      }
    } finally {
      runtime.stop();
      await runtime.wait();
      parent.abort();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
