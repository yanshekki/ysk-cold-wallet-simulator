import type {
  BackupKind,
  Brand,
  ConfirmationPort,
  DeviceModel,
  LedgerApp,
  ProtocolHandler,
} from '@cws/contracts';
import {
  BleReassembler,
  clampMtu,
  DEFAULT_MTU,
  framePayload,
  TAG_APDU,
  TAG_ERROR,
  TAG_INIT,
  TAG_MTU,
  TAG_PROTOCOL_VERSION,
} from './framing';
import {
  encodeResponse,
  parseApdu,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
} from './apdu';
import { concatBytes, encodeAscii } from './bytes';
import { getAppAndVersion, getFirmwareVersion, openAppName } from './apps/dashboard';
import { handleEthereumApdu, type EthSession } from './apps/ethereum';

export type LedgerHandlerOptions = {
  model: DeviceModel;
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  mtu?: number;
};

export class LedgerProtocolHandler implements ProtocolHandler {
  readonly brand: Brand = 'ledger';
  readonly models: string[];

  private readonly model: DeviceModel;
  private readonly confirmation: ConfirmationPort;
  private readonly slotId: string;
  private readonly entropy: Uint8Array;
  private readonly backup: BackupKind;
  private readonly assembler = new BleReassembler();
  private readonly ethSession: EthSession = {};
  private mtu: number;
  private app: LedgerApp = 'dashboard';

  constructor(options: LedgerHandlerOptions) {
    this.model = options.model;
    this.confirmation = options.confirmation;
    this.slotId = options.slotId;
    this.entropy = options.entropy;
    this.backup = options.backup ?? 'bip39';
    this.mtu = clampMtu(options.mtu ?? DEFAULT_MTU);
    this.models = [options.model.id];
  }

  getServiceUUID(): string {
    return this.model.serviceUUID;
  }

  getCharacteristics(): { write: string; notify: string; writeCmd?: string } {
    return {
      write: this.model.writeCharUUID,
      notify: this.model.notifyCharUUID,
      writeCmd: this.model.writeCmdCharUUID,
    };
  }

  setApp(app: LedgerApp): void {
    this.app = app;
    this.ethSession.pendingPersonal = undefined;
  }

  getApp(): LedgerApp {
    return this.app;
  }

  observeIncomingSize(size: number): void {
    this.mtu = clampMtu(Math.max(this.mtu, size));
  }

  async handleWrite(data: Uint8Array): Promise<Uint8Array | null> {
    this.observeIncomingSize(data.length);
    let frame;
    try {
      frame = this.assembler.push(data);
    } catch {
      return framePayload(TAG_ERROR, new Uint8Array(), this.mtu);
    }
    if (!frame) {
      return null;
    }
    return this.dispatch(frame.tag, frame.payload);
  }

  private async dispatch(tag: number, payload: Uint8Array): Promise<Uint8Array | null> {
    switch (tag) {
      case TAG_MTU:
        return framePayload(TAG_MTU, Uint8Array.of(this.mtu), this.mtu);
      case TAG_PROTOCOL_VERSION:
        return framePayload(TAG_PROTOCOL_VERSION, Uint8Array.of(0, 0, 0, 0), this.mtu);
      case TAG_INIT:
        this.assembler.reset();
        this.ethSession.pendingPersonal = undefined;
        return framePayload(TAG_INIT, new Uint8Array(), this.mtu);
      case TAG_APDU: {
        const response = await this.handleApdu(payload);
        if (!response) {
          return null;
        }
        return framePayload(TAG_APDU, response, this.mtu);
      }
      default:
        return framePayload(TAG_ERROR, new Uint8Array(), this.mtu);
    }
  }

  private async handleApdu(payload: Uint8Array): Promise<Uint8Array | null> {
    let apdu;
    try {
      apdu = parseApdu(payload);
    } catch {
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
    }

    if (apdu.cla === 0xb0 && apdu.ins === 0x01) {
      return getAppAndVersionFor(this.app);
    }
    if (apdu.cla === 0xb0 && apdu.ins === 0xa7) {
      this.setApp('dashboard');
      return encodeResponse(new Uint8Array(), SW_OK);
    }
    if (apdu.cla === 0xe0 && apdu.ins === 0xd8) {
      const name = openAppName(apdu.data).toLowerCase();
      if (name.includes('ethereum')) {
        this.setApp('ethereum');
        return encodeResponse(new Uint8Array(), SW_OK);
      }
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
    }
    if (apdu.cla === 0xe0 && apdu.ins === 0x01 && this.app === 'dashboard') {
      return getFirmwareVersion(this.model.id);
    }

    if (this.app === 'ethereum' && apdu.cla === 0xe0) {
      return handleEthereumApdu(apdu, {
        confirmation: this.confirmation,
        slotId: this.slotId,
        entropy: this.entropy,
        backup: this.backup,
        session: this.ethSession,
      });
    }

    if (apdu.cla !== 0xe0 && apdu.cla !== 0xb0) {
      return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
    }
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
}

function getAppAndVersionFor(app: LedgerApp): Uint8Array {
  if (app === 'ethereum') {
    const name = encodeAscii('Ethereum');
    const version = encodeAscii('1.17.0');
    const flags = Uint8Array.of(0x00);
    return encodeResponse(
      concatBytes(
        Uint8Array.of(0x01),
        Uint8Array.of(name.length),
        name,
        Uint8Array.of(version.length),
        version,
        Uint8Array.of(flags.length),
        flags,
      ),
      SW_OK,
    );
  }
  return getAppAndVersion();
}
