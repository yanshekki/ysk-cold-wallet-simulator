import type { DeviceModel, ProtocolHandler } from '@cws/contracts';

export type PeripheralCallbacks = {
  onConnected: (centralId: string) => void;
  onDisconnected: () => void;
  onLog: (direction: 'in' | 'out', hex: string, note?: string) => void;
  onError?: (message: string) => void;
  /** Host lock id written by CWS Proxy. Not a connection. */
  onPeripheralId?: (id: string) => void;
};

export type PeripheralHandle = {
  stop: () => Promise<void>;
};

export type HandlerSource = ProtocolHandler | (() => ProtocolHandler);

export type StartAdvertising = (
  model: DeviceModel,
  handler: HandlerSource,
  callbacks: PeripheralCallbacks,
  options?: { nameSuffix?: string; identityToken?: string },
) => Promise<PeripheralHandle>;
