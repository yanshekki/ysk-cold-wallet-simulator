import { createRequire } from 'node:module';
import { hidDescriptorFor, USB_HID_REPORT_SIZE, type DeviceModel } from '@cws/contracts';
import type { BlePort, HidPort, Unsubscribe } from './ports';

const require = createRequire(import.meta.url);
const native = require('@cws/native-proxy') as typeof import('@cws/native-proxy');

export const nativeOk: () => boolean = native.nativeOk;
export const scanBle: typeof native.scanBle = native.scanBle;
export const connectBle: typeof native.connectBle = native.connectBle;

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

export function wrapNativeBle(device: InstanceType<typeof native.BleDevice>): BlePort & {
  isConnected(): Promise<boolean>;
} {
  return {
    async write(packet) {
      await device.write(Buffer.from(packet));
    },
    onNotify(callback) {
      device.onNotify((packet: unknown) => {
        callback(asBytes(packet));
      });
      return () => undefined;
    },
    async close() {
      await device.disconnect();
    },
    isConnected() {
      return device.isConnected();
    },
  };
}

export function createVirtualHid(model: DeviceModel): HidPort {
  const hid = new native.VirtualHid(
    model.usb.vendorId,
    model.usb.productId,
    model.name,
    Buffer.from(hidDescriptorFor(model.usb)),
  );
  return wrapNativeHid(hid);
}

export async function openBle(id: string, model: DeviceModel) {
  const device = await connectBle(id, model.writeCharUUID, model.notifyCharUUID);
  return wrapNativeBle(device);
}
