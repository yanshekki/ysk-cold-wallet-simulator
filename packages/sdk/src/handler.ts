import type { BackupKind, ConfirmationPort, DeviceModel, ProtocolHandler } from '@cws/contracts';
import {
  DEFAULT_MTU,
  LedgerProtocolHandler,
  splitFramedPackets,
  type LedgerHandlerOptions,
} from '@cws/protocol-ledger';
import { OneKeyV1ProtocolHandler, splitOneKeyV1 } from '@cws/protocol-onekey';
import {
  DEFAULT_MTU as THP_MTU,
  TrezorThpProtocolHandler,
  splitThpPackets,
} from '@cws/protocol-trezor';

export type CreateHandlerOptions = {
  model: DeviceModel;
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  mtu?: number;
};

export function createHandler(options: CreateHandlerOptions): ProtocolHandler {
  switch (options.model.protocol) {
    case 'ledger-apdu':
      return new LedgerProtocolHandler(options);
    case 'onekey-v1':
      return new OneKeyV1ProtocolHandler(options);
    case 'thp':
      return new TrezorThpProtocolHandler(options);
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
    case 'thp':
      return splitThpPackets(framed, Math.max(THP_MTU, mtu));
    default:
      throw new Error(`protocol ${model.protocol} is not implemented yet`);
  }
}

export function isSimulatable(model: DeviceModel): boolean {
  return (
    model.protocol === 'ledger-apdu' ||
    model.protocol === 'onekey-v1' ||
    model.protocol === 'thp'
  );
}

export { DEFAULT_MTU };
