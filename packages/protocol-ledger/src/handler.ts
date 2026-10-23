import type {
  BackupKind,
  Brand,
  ConfirmationPort,
  DeviceModel,
  LedgerApp,
  ProtocolHandler,
} from '@cws/contracts';
import { ledgerAppLabel, matchLedgerApp } from '@cws/contracts';
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
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
} from './apdu';
import {
  encodeListApps,
  getAppAndVersionFor,
  getAppStorageInfo,
  getDeviceName,
  getFirmwareVersion,
  MANAGER_INS,
  openAppName,
} from './apps/dashboard';
import { handleBitcoinApdu } from './apps/bitcoin';
import { handleEthereumApdu, type EthSession } from './apps/ethereum';

export type LedgerHandlerOptions = {
  model: DeviceModel;
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  mtu?: number;
  onAppChange?: (app: LedgerApp) => void;
};

export class LedgerProtocolHandler implements ProtocolHandler {
  readonly brand: Brand = 'ledger';
  readonly models: string[];

  private readonly model: DeviceModel;
  private readonly confirmation: ConfirmationPort;
  private readonly slotId: string;
  private readonly entropy: Uint8Array;
  private readonly backup: BackupKind;
  private readonly onAppChange?: (app: LedgerApp) => void;
  private readonly assembler = new BleReassembler();
  private readonly ethSession: EthSession = {};
  private mtu: number;
  private app: LedgerApp = 'dashboard';
  private managerAllowed = false;

  constructor(options: LedgerHandlerOptions) {
    this.model = options.model;
    this.confirmation = options.confirmation;
    this.slotId = options.slotId;
    this.entropy = options.entropy;
    this.backup = options.backup ?? 'bip39';
    this.onAppChange = options.onAppChange;
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
    this.onAppChange?.(app);
  }

  getApp(): LedgerApp {
    return this.app;
  }

  observeIncomingSize(size: number): void {
    // iOS notify stays at 20 unless ATT MTU is raised, which munim does not
    // expose. Growing this.mtu makes GET_VERSION / genuine replies larger
    // than the central will accept, so CoreBluetooth drops them.
    void size;
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
      return getAppAndVersionFor(this.app, this.model.id);
    }
    if (apdu.cla === 0xb0 && apdu.ins === 0xa7) {
      this.setApp('dashboard');
      return encodeResponse(new Uint8Array(), SW_OK);
    }
    if (apdu.cla === 0xe0 && apdu.ins === 0xd8) {
      return this.openApp(apdu.data);
    }
    if (apdu.cla === 0xe0 && apdu.ins === 0x01) {
      return getFirmwareVersion(this.model.id, this.managerAllowed);
    }
    if (apdu.cla === 0xe0 && apdu.ins === 0xd2) {
      return getDeviceName(this.model.id);
    }
    if (this.app === 'dashboard' && apdu.cla === 0xe0 && apdu.ins === 0x50) {
      return encodeResponse(new Uint8Array(), SW_OK);
    }
    if (this.app === 'dashboard' && apdu.cla === 0xe0 && apdu.ins === 0xde) {
      return encodeListApps();
    }
    if (this.app === 'dashboard' && apdu.cla === 0xe0 && apdu.ins === 0xdf) {
      return encodeResponse(new Uint8Array(), SW_OK);
    }
    if (this.app === 'dashboard' && apdu.cla === 0xe0 && apdu.ins === 0x6a) {
      return getAppStorageInfo();
    }
    if (this.app === 'dashboard' && apdu.cla === 0xe0 && MANAGER_INS.has(apdu.ins)) {
      return this.allowManager();
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

    if (this.app === 'bitcoin' && apdu.cla === 0xe0) {
      return handleBitcoinApdu(apdu, {
        confirmation: this.confirmation,
        slotId: this.slotId,
        entropy: this.entropy,
        backup: this.backup,
      });
    }

    if (apdu.cla !== 0xe0 && apdu.cla !== 0xb0) {
      return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
    }
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }

  private async openApp(data: Uint8Array): Promise<Uint8Array> {
    const app = matchLedgerApp(openAppName(data));
    if (!app || app === 'dashboard') {
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
    }
    const label = ledgerAppLabel(app);
    const ok = await this.confirmation.confirm({
      brand: 'ledger',
      kind: 'open-app',
      title: `Open ${label}`,
      path: app,
      message: `Open ${label}`,
      rawPayload: data,
    });
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
    this.setApp(app);
    return encodeResponse(new Uint8Array(), SW_OK);
  }

  private async allowManager(): Promise<Uint8Array> {
    if (this.managerAllowed) {
      return encodeResponse(new Uint8Array(), SW_OK);
    }
    const ok = await this.confirmation.confirm({
      brand: 'ledger',
      kind: 'allow-manager',
      title: 'Allow Ledger Manager',
      path: 'manager',
      message: 'Allow Ledger Manager to talk to this device',
      rawPayload: new Uint8Array(),
    });
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
    this.managerAllowed = true;
    return encodeResponse(new Uint8Array(), SW_OK);
  }
}
