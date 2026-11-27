import { Platform } from 'react-native';
import type { GATTCharacteristicPermission } from 'munim-bluetooth';
import { CWS_PERIPHERAL_ID, bleGapLocalName, type DeviceModel } from '@cws/contracts';
import {
  createPeripheralLink,
  type AdvertiseOptions,
  type PeripheralOs,
} from './peripheralLink';
import type { HandlerSource, PeripheralCallbacks, PeripheralHandle } from './types';

export type { PeripheralCallbacks, PeripheralHandle };

type BleModule = typeof import('munim-bluetooth');
type Subscription = (() => void) | void;

const ADVERTISE_WAIT_MS = 8000;
const NOTIFY_GAP_MS = Platform.OS === 'android' ? 0 : 10;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function unsubscribe(sub: Subscription): void {
  if (typeof sub === 'function') {
    sub();
  }
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
      properties: ['write', 'writeWithoutResponse'],
      permissions: writePermissions,
      value: '00',
    });
  }
  ble.setServices([
    { uuid: model.serviceUUID, characteristics: chars },
    {
      uuid: CWS_PERIPHERAL_ID.serviceUUID,
      characteristics: [
        {
          uuid: CWS_PERIPHERAL_ID.writeCharUUID,
          properties: ['write', 'writeWithoutResponse'],
          permissions: writePermissions,
          value: '00',
        },
      ],
    },
  ]);
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

function peripheralOs(): PeripheralOs {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

export async function startAdvertising(
  model: DeviceModel,
  handler: HandlerSource,
  callbacks: PeripheralCallbacks,
  options?: { nameSuffix?: string; identityToken?: string },
): Promise<PeripheralHandle> {
  const ble = await import('munim-bluetooth');
  const allowed = await ble.requestBluetoothPermission(['advertise', 'connect']);
  if (!allowed) {
    throw new Error('errors.advertisePermission');
  }

  // OneKey phones differ by the 4-digit token inside the vendor GAP name.
  // Ledger keeps the short product name: real devices share that name and
  // are told apart by the service UUID plus the OS radio address. An optional
  // suffix is not a connection key. Proxy confirms the writable GATT char.
  const localName = bleGapLocalName(model, {
    token: options?.identityToken,
    suffix: options?.nameSuffix,
  });
  const advertiseOptions: AdvertiseOptions = {
    serviceUUIDs: [model.serviceUUID],
    localName,
  };

  try {
    ble.stopAdvertising();
  } catch {
    // ignore: may not be advertising yet
  }
  await delay(1_200);
  try {
    configureServices(ble, model);
  } catch (error) {
    throw mapBleError(error);
  }

  const subscriptions: Subscription[] = [];
  let advertisingReady = false;

  subscriptions.push(ble.addEventListener('adapterStateChanged', () => undefined));

  subscriptions.push(
    ble.addEventListener('advertisingStartFailed', (event) => {
      const message = advertiseFailureMessage(event);
      callbacks.onLog('out', '', message);
      // After the first successful start, a later Android readvertise must not
      // tear the session down. The GATT server stays up for a host reconnect.
      if (!advertisingReady) {
        callbacks.onError?.(message);
      }
    }),
  );

  const link = createPeripheralLink({
    platform: peripheralOs(),
    model,
    handler,
    callbacks,
    advertiseOptions,
    notifyGapMs: NOTIFY_GAP_MS,
    delay,
    ble: {
      startAdvertising: (next) => {
        ble.startAdvertising(next);
      },
      updateCharacteristicValue: (serviceUUID, characteristicUUID, value, notify) =>
        ble.updateCharacteristicValue(serviceUUID, characteristicUUID, value, notify),
      respondToPeripheralWriteRequest: (requestId, accept) =>
        ble.respondToPeripheralWriteRequest(requestId, accept),
    },
  });

  subscriptions.push(
    ble.addEventListener('peripheralSubscribed', (event) => {
      link.onSubscribed(event);
    }),
  );
  subscriptions.push(
    ble.addEventListener('peripheralUnsubscribed', (event) => {
      link.onUnsubscribed(event);
    }),
  );
  subscriptions.push(
    ble.addEventListener('peripheralWriteRequest', (event) => {
      void link.onWriteRequest(event);
    }),
  );

  const started = waitForAdvertisingStarted(ble);
  try {
    ble.startAdvertising(advertiseOptions);
  } catch (error) {
    started.cancel(mapBleError(error));
  }
  try {
    await started.promise;
    advertisingReady = true;
    callbacks.onLog('out', '', `Advertising as ${localName}`);
  } catch (error) {
    link.stop();
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

  return {
    stop: async () => {
      link.stop();
      for (const sub of subscriptions) {
        unsubscribe(sub);
      }
      ble.stopAdvertising();
    },
  };
}

export async function stopAdvertising(): Promise<void> {
  const ble = await import('munim-bluetooth');
  ble.stopAdvertising();
}
