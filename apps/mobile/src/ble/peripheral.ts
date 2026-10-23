import { Platform } from 'react-native';
import type { GATTCharacteristicPermission } from 'munim-bluetooth';
import type { DeviceModel, ProtocolHandler } from '@cws/contracts';
import { DEFAULT_MTU, splitNotify } from '@cws/sdk';
import { bytesToHex, hexToBytes } from './hex';
import type { PeripheralCallbacks, PeripheralHandle } from './types';

export type { PeripheralCallbacks, PeripheralHandle };

type BleModule = typeof import('munim-bluetooth');
type Subscription = (() => void) | void;

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

function configureServices(ble: BleModule, model: DeviceModel, encrypted: boolean): void {
  const writePermissions: GATTCharacteristicPermission[] = encrypted
    ? ['writeEncrypted']
    : ['write'];
  const chars = [
    {
      uuid: model.notifyCharUUID,
      properties: ['notify'],
      value: '00',
    },
    {
      uuid: model.writeCharUUID,
      properties: ['write'],
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

  try {
    try {
      configureServices(ble, model, true);
    } catch {
      configureServices(ble, model, false);
    }
  } catch (error) {
    throw mapBleError(error);
  }

  const subscriptions: Subscription[] = [];

  subscriptions.push(
    ble.addEventListener('peripheralSubscribed', (event) => {
      if (!event.characteristicUUID || event.characteristicUUID === model.notifyCharUUID) {
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
      try {
        const incoming = hexToBytes(event.value);
        callbacks.onLog('in', bytesToHex(incoming), 'GATT write');
        const outgoing = await handler.handleWrite(incoming);
        if (!outgoing || outgoing.length === 0) {
          return;
        }
        const packets = splitNotify(model, outgoing, Math.max(DEFAULT_MTU, incoming.length));
        for (const packet of packets) {
          const hex = bytesToHex(packet);
          callbacks.onLog('out', hex, 'GATT notify');
          await ble.updateCharacteristicValue(model.serviceUUID, model.notifyCharUUID, hex, true);
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

  try {
    ble.startBackgroundSession({
      serviceUUIDs: [model.serviceUUID],
      localName: model.name,
      androidNotificationTitle: 'YSK Cold Wallet Simulator',
      androidNotificationText: `Advertising as ${model.name}`,
    });
  } catch (error) {
    throw mapBleError(error);
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
