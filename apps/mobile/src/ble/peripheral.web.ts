import type { DeviceModel, ProtocolHandler } from '@cws/contracts';
import type { PeripheralCallbacks, PeripheralHandle } from './types';

export type { PeripheralCallbacks, PeripheralHandle };

export async function startAdvertising(
  _model: DeviceModel,
  _handler: ProtocolHandler,
  _callbacks: PeripheralCallbacks,
): Promise<PeripheralHandle> {
  throw new Error('BLE peripheral requires a physical Android/iOS device');
}

export async function stopAdvertising(): Promise<void> {
  // no-op on web
}
