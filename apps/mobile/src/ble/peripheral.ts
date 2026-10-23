import { Platform } from 'react-native';
import type { GATTCharacteristicPermission } from 'munim-bluetooth';
import { bleAdvertiseName, type DeviceModel, type ProtocolHandler } from '@cws/contracts';
import { DEFAULT_MTU, splitNotify } from '@cws/sdk';
import { bytesToHex, hexToBytes } from './hex';
import type { PeripheralCallbacks, PeripheralHandle } from './types';

export type { PeripheralCallbacks, PeripheralHandle };

type BleModule = typeof import('munim-bluetooth');
type Subscription = (() => void) | void;

const ADVERTISE_WAIT_MS = 8000;
const NOTIFY_GAP_MS = 12;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function notifyMtu(model: DeviceModel, incomingLength: number): number {
  if (model.protocol === 'thp') {
    return Math.max(DEFAULT_MTU, incomingLength);
  }
  // iOS notify default is 20 bytes. Using the incoming write size as MTU
  // makes GET_VERSION / DeviceInfo replies larger than the central can
  // accept, so CoreBluetooth drops the update and the host times out.
  return DEFAULT_MTU;
}

function unsubscribe(sub: Subscription): void {
  if (typeof sub === 'function') {
    sub();
  }
}

function sameBleUuid(left?: string, right?: string): boolean {
  if (!left || !right) {
    return false;
  }
  const normalize = (value: string) => value.replace(/-/g, '').toLowerCase();
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function mapBleError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  if (/unsupported|not powered on|Bluetooth is not powered/i.test(raw)) {
    return new Error(
      Platform.OS === 'ios'
        ? 'Bluetooth is not available in the iOS Simulator. Use a physical iPhone to advertise.'
        : 'Bluetooth is not available on this emulator. Use a physical Android device to advertise.',
    );
  }
  return error instanceof Error ? error : new Error(raw);
}

function advertiseFailureMessage(event: { error?: string; errorCode?: number; message?: string }): string {
  return event.message ?? event.error ?? `Advertising failed (${event.errorCode ?? 'unknown'})`;
}

function configureServices(ble: BleModule, model: DeviceModel): void {
  const writePermissions: GATTCharacteristicPermission[] = ['write'];
  const chars = [
    {
      uuid: model.notifyCharUUID,
      properties: ['notify'],
      value: '00',
    },
    {
      uuid: model.writeCharUUID,
      properties: ['write', 'writeWithoutResponse'],
      permissions: writePermissions,
      value: '00',
    },
  ];
  if (model.writeCmdCharUUID) {
    chars.push({
      uuid: model.writeCmdCharUUID,
      properties: ['writeWithoutResponse'],
      permissions: writePermissions,
      value: '00',
    });
  }
  ble.setServices([{ uuid: model.serviceUUID, characteristics: chars }]);
}

function waitForAdvertisingStarted(ble: BleModule): {
  promise: Promise<void>;
  cancel: (error: Error) => void;
} {
  let settled = false;
  let unsubStarted: Subscription;
  let unsubFailed: Subscription;
  let finish: (error?: Error) => void = () => undefined;

  const promise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error('Advertising did not start. Check Bluetooth and stay in the foreground.'));
    }, ADVERTISE_WAIT_MS);

    finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      unsubscribe(unsubStarted);
      unsubscribe(unsubFailed);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    unsubStarted = ble.addEventListener('advertisingStarted', () => {
      finish();
    });
    unsubFailed = ble.addEventListener('advertisingStartFailed', (event) => {
      finish(new Error(advertiseFailureMessage(event)));
    });
  });

  return {
    promise,
    cancel: (error: Error) => finish(error),
  };
}

export async function startAdvertising(
  model: DeviceModel,
  handler: ProtocolHandler,
  callbacks: PeripheralCallbacks,
): Promise<PeripheralHandle> {
  const ble = await import('munim-bluetooth');
  const allowed = await ble.requestBluetoothPermission(['advertise', 'connect']);
  if (!allowed) {
    throw new Error('Bluetooth advertising permission was not granted');
  }

  const localName = bleAdvertiseName(model);

  try {
    configureServices(ble, model);
  } catch (error) {
    throw mapBleError(error);
  }

  const subscriptions: Subscription[] = [];

  subscriptions.push(ble.addEventListener('adapterStateChanged', () => undefined));
  subscriptions.push(ble.addEventListener('backgroundSessionStarted', () => undefined));

  subscriptions.push(
    ble.addEventListener('advertisingStartFailed', (event) => {
      const message = advertiseFailureMessage(event);
      callbacks.onLog('out', '', message);
      callbacks.onError?.(message);
    }),
  );

  subscriptions.push(
    ble.addEventListener('peripheralSubscribed', (event) => {
      if (!event.characteristicUUID || sameBleUuid(event.characteristicUUID, model.notifyCharUUID)) {
        callbacks.onConnected(event.centralId ?? 'host');
      }
    }),
  );

  subscriptions.push(
    ble.addEventListener('peripheralUnsubscribed', () => {
      callbacks.onDisconnected();
    }),
  );

  subscriptions.push(
    ble.addEventListener('peripheralWriteRequest', async (event) => {
      if (event.responseRequired && event.requestId) {
        try {
          await ble.respondToPeripheralWriteRequest(event.requestId, true);
        } catch {
          // Write-without-response has nothing to ack.
        }
      }
      if (!event.value) {
        return;
      }
      callbacks.onConnected(event.centralId ?? 'host');
      try {
        const incoming = hexToBytes(event.value);
        callbacks.onLog('in', bytesToHex(incoming), 'GATT write');
        const outgoing = await handler.handleWrite(incoming);
        if (!outgoing || outgoing.length === 0) {
          return;
        }
        const packets = splitNotify(model, outgoing, notifyMtu(model, incoming.length));
        for (let index = 0; index < packets.length; index += 1) {
          const packet = packets[index];
          const hex = bytesToHex(packet);
          callbacks.onLog('out', hex, 'GATT notify');
          await ble.updateCharacteristicValue(model.serviceUUID, model.notifyCharUUID, hex, true);
          if (index < packets.length - 1) {
            await delay(NOTIFY_GAP_MS);
          }
        }
      } catch (error) {
        callbacks.onLog(
          'out',
          '',
          error instanceof Error ? error.message : 'write handling failed',
        );
      }
    }),
  );

  const started = waitForAdvertisingStarted(ble);
  try {
    ble.startAdvertising({
      serviceUUIDs: [model.serviceUUID],
      localName,
    });
  } catch (error) {
    started.cancel(mapBleError(error));
  }
  try {
    await started.promise;
    callbacks.onLog('out', '', `Advertising as ${localName}`);
  } catch (error) {
    for (const sub of subscriptions) {
      unsubscribe(sub);
    }
    try {
      ble.stopAdvertising();
    } catch {
      // ignore
    }
    throw mapBleError(error);
  }

  if (Platform.OS === 'android') {
    try {
      ble.startBackgroundSession({
        serviceUUIDs: [model.serviceUUID],
        localName,
        androidNotificationTitle: 'YSK Cold Wallet Simulator',
        androidNotificationText: `Advertising as ${model.name}`,
      });
    } catch (error) {
      for (const sub of subscriptions) {
        unsubscribe(sub);
      }
      ble.stopAdvertising();
      throw mapBleError(error);
    }
  }

  return {
    stop: async () => {
      for (const sub of subscriptions) {
        unsubscribe(sub);
      }
      ble.stopBackgroundSession();
      ble.stopAdvertising();
    },
  };
}

export async function stopAdvertising(): Promise<void> {
  const ble = await import('munim-bluetooth');
  ble.stopBackgroundSession();
  ble.stopAdvertising();
}
