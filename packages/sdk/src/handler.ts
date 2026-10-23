import type { ConfirmationPort, DeviceModel, ProtocolHandler } from '@cws/contracts';
import {
  DEFAULT_MTU,
  LedgerProtocolHandler,
  splitFramedPackets,
  type LedgerHandlerOptions,
} from '@cws/protocol-ledger';
import { OneKeyV1ProtocolHandler, splitOneKeyV1 } from '@cws/protocol-onekey';

export type CreateHandlerOptions = {
  model: DeviceModel;
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  mtu?: number;
};

export function createHandler(options: CreateHandlerOptions): ProtocolHandler {
  switch (options.model.protocol) {
    case 'ledger-apdu':
      return new LedgerProtocolHandler(options);
    case 'onekey-v1':
      return new OneKeyV1ProtocolHandler(options);
    default:
      throw new Error(`protocol ${options.model.protocol} is not implemented yet`);
  }
}

export function createLedgerHandler(options: LedgerHandlerOptions): LedgerProtocolHandler {
  return new LedgerProtocolHandler(options);
}

export function splitNotify(model: DeviceModel, framed: Uint8Array, mtu: number): Uint8Array[] {
  switch (model.protocol) {
    case 'ledger-apdu':
      return splitFramedPackets(framed, mtu);
    case 'onekey-v1':
      return splitOneKeyV1(framed, mtu);
    default:
      throw new Error(`protocol ${model.protocol} is not implemented yet`);
  }
}

export function isSimulatable(model: DeviceModel): boolean {
  return (
    (model.protocol === 'ledger-apdu' && model.id === 'nano-x') || model.protocol === 'onekey-v1'
  );
}

export { DEFAULT_MTU };
