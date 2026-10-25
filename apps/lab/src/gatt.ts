import { ALL_MODELS, type Brand, type DeviceModel } from '@cws/contracts';
import { bluetoothBlockReason, walletRequestOptions } from './scan';

export type GattLink = {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  model: DeviceModel;
  write: BluetoothRemoteGATTCharacteristic;
  notify: BluetoothRemoteGATTCharacteristic;
};

export async function requestWallet(brand: Brand, acceptAll = false): Promise<GattLink> {
  const blocked = bluetoothBlockReason({
    bluetooth: Boolean(navigator.bluetooth),
    secureContext: window.isSecureContext,
    brave: looksLikeBrave(),
  });
  if (blocked) {
    throw new Error(blocked);
  }
  const bluetooth = navigator.bluetooth;
  if (!bluetooth) {
    throw new Error('Web Bluetooth is not available');
  }
  const models = ALL_MODELS.filter((item) => item.brand === brand);
  const device = await bluetooth.requestDevice(walletRequestOptions(brand, acceptAll));
  const server = await connectGatt(device);
  const found = await findService(server, models);
  const write = await found.service.getCharacteristic(found.model.writeCharUUID);
  const notify = await found.service.getCharacteristic(found.model.notifyCharUUID);
  await notify.startNotifications();
  return { device, server, model: found.model, write, notify };
}

export async function writeCharacteristic(
  characteristic: BluetoothRemoteGATTCharacteristic,
  packet: Uint8Array,
): Promise<void> {
  const copy = new Uint8Array(packet.byteLength);
  copy.set(packet);
  const buffer = copy.buffer;
  if (characteristic.writeValueWithoutResponse) {
    await characteristic.writeValueWithoutResponse(buffer);
    return;
  }
  if (characteristic.writeValueWithResponse) {
    await characteristic.writeValueWithResponse(buffer);
    return;
  }
  await characteristic.writeValue(buffer);
}

export class PacketQueue {
  private readonly waiters: Array<(packet: Uint8Array) => void> = [];
  private readonly queued: Uint8Array[] = [];

  push(packet: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(packet);
    } else {
      this.queued.push(packet);
    }
  }

  reset(): void {
    this.waiters.length = 0;
    this.queued.length = 0;
  }

  next(timeout: number): Promise<Uint8Array> {
    const queued = this.queued.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const index = this.waiters.indexOf(onPacket);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error('BLE timeout waiting for notify'));
      }, Math.max(1, timeout));
      const onPacket = (packet: Uint8Array) => {
        window.clearTimeout(timer);
        resolve(packet);
      };
      this.waiters.push(onPacket);
    });
  }
}

export function looksLikeBrave(): boolean {
  const nav = navigator as Navigator & { brave?: unknown };
  return Boolean(nav.brave) || /Brave/i.test(navigator.userAgent);
}

async function connectGatt(device: BluetoothDevice): Promise<BluetoothRemoteGATTServer> {
  const gatt = device.gatt;
  if (!gatt) {
    throw new Error('GATT connect failed');
  }
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (!gatt.connected) {
        await gatt.connect();
      }
      if (gatt.connected) {
        return gatt;
      }
      last = new Error('GATT connect failed');
    } catch (error) {
      last = error instanceof Error ? error : new Error('GATT connect failed');
    }
    await delay(250);
  }
  throw last ?? new Error('GATT connect failed');
}

async function findService(
  server: BluetoothRemoteGATTServer,
  models: DeviceModel[],
): Promise<{ model: DeviceModel; service: BluetoothRemoteGATTService }> {
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const model of models) {
      try {
        const service = await server.getPrimaryService(model.serviceUUID);
        return { model, service };
      } catch (error) {
        last = error instanceof Error ? error : new Error('No matching GATT service on this device');
      }
    }
    await delay(250);
  }
  throw last ?? new Error('No matching GATT service on this device');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
