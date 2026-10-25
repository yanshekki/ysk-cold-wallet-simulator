import type { DeviceModel, ProtocolHandler } from '@cws/contracts';

export type PeripheralCallbacks = {
  onConnected: (centralId: string) => void;
  onDisconnected: () => void;
  onLog: (direction: 'in' | 'out', hex: string, note?: string) => void;
  onError?: (message: string) => void;
};

export type PeripheralHandle = {
  stop: () => Promise<void>;
};

export type StartAdvertising = (
  model: DeviceModel,
  handler: ProtocolHandler,
  callbacks: PeripheralCallbacks,
  options?: { nameSuffix?: string },
) => Promise<PeripheralHandle>;
