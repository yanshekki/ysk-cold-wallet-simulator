import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hidDescriptorFor, USB_HID_REPORT_SIZE, type DeviceModel } from '@cws/contracts';
import { openBleSocket, scanBleSocket } from './bleSocket';
import { openHidSocket } from './hidSocket';
import type { BlePort, HidPort, Unsubscribe } from './ports';

function requireFilename(): string {
  try {
    if (import.meta.url) {
      return import.meta.url;
    }
  } catch {
    // bundled cjs has an empty import.meta
  }
  return pathToFileURL(join(dirname(process.execPath), 'proxy', 'main.cjs')).href;
}

const require = createRequire(requireFilename());
const native = require('@cws/native-proxy') as typeof import('@cws/native-proxy');

export const nativeOk: () => boolean = native.nativeOk;
export const connectBle: typeof native.connectBle = native.connectBle;

export async function scanBle(serviceUuids: string[], timeoutMs: number) {
  const socketPath = process.env.CWS_BLE_SOCKET?.trim();
  if (socketPath) {
    return scanBleSocket(socketPath, timeoutMs);
  }
  return native.scanBle(serviceUuids, timeoutMs);
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return Uint8Array.from(value);
  }
  if (value && typeof value === 'object' && 'buffer' in value) {
    const view = value as ArrayBufferView;
    return Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  return Uint8Array.from(value as Iterable<number>);
}

function padReport(report: Uint8Array): Buffer {
  if (report.length === USB_HID_REPORT_SIZE) {
    return Buffer.from(report);
  }
  const padded = Buffer.alloc(USB_HID_REPORT_SIZE);
  padded.set(report.subarray(0, Math.min(report.length, USB_HID_REPORT_SIZE)));
  return padded;
}

export function wrapNativeHid(device: InstanceType<typeof native.VirtualHid>): HidPort {
  return {
    write(report) {
      device.write(padReport(report));
    },
    onInput(callback) {
      device.onInput((report: unknown) => {
        callback(asBytes(report));
      });
      const unsubscribe: Unsubscribe = () => undefined;
      return unsubscribe;
    },
    close() {
      device.close();
    },
  };
}

function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function wrapNativeBle(device: InstanceType<typeof native.BleDevice>): BlePort & {
  isConnected(): Promise<boolean>;
} {
  const listeners: Array<(packet: Uint8Array) => void> = [];
  device.onNotify((packet: unknown) => {
    const bytes = asBytes(packet);
    for (const listener of listeners) {
      listener(bytes);
    }
  });
  return {
    async write(packet) {
      await withTimeout(device.write(Buffer.from(packet)), 1_500, 'ble write timed out');
    },
    onNotify(callback) {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
    async close() {
      await withTimeout(device.disconnect(), 500, 'ble disconnect timed out').catch(() => undefined);
    },
    isConnected() {
      return withTimeout(device.isConnected(), 1_000, 'ble isConnected timed out').catch(
        () => false,
      );
    },
  };
}

export function createVirtualHid(
  model: DeviceModel,
  signal?: AbortSignal,
): HidPort | Promise<HidPort> {
  const socketPath = process.env.CWS_HID_SOCKET?.trim();
  if (socketPath) {
    return openHidSocket(socketPath, model, signal);
  }
  const hid = new native.VirtualHid(
    model.usb.vendorId,
    model.usb.productId,
    model.name,
    Buffer.from(hidDescriptorFor(model.usb)),
  );
  return wrapNativeHid(hid);
}

export async function openBle(id: string, model: DeviceModel) {
  const socketPath = process.env.CWS_BLE_SOCKET?.trim();
  if (socketPath) {
    return openBleSocket(socketPath, id, model.writeCharUUID, model.notifyCharUUID);
  }
  const device = await connectBle(id, model.writeCharUUID, model.notifyCharUUID);
  const wrapped = wrapNativeBle(device);
  return Object.assign(wrapped, { debugInfo: () => device.debugInfo() });
}
