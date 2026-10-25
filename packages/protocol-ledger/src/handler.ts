import type {
  BackupKind,
  Brand,
  ConfirmationPort,
  DeviceModel,
  LedgerApp,
  ProtocolHandler,
} from '@cws/contracts';
import { ledgerAppFamily, ledgerAppLabel, matchLedgerApp } from '@cws/contracts';
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
  targetIdFor,
} from './apps/dashboard';
import { handleAvalancheApdu, type AvaxSession } from './apps/avalanche';
import { coinFromAppId, handleBitcoinApdu, type BtcSession } from './apps/bitcoin';
import { handleEthereumApdu, type EthSession } from './apps/ethereum';
import { handleNearApdu, type NearSession } from './apps/near';
import { handleSolanaApdu } from './apps/solana';
import { handleXrpApdu } from './apps/xrp';
import { handleCardanoApdu } from './apps/cardano';
import { handlePolkadotApdu } from './apps/polkadot';
import { handleTronApdu } from './apps/tron';
import { handleCosmosApdu } from './apps/cosmos';
import { handleTonApdu } from './apps/ton';
import { handleAptosApdu } from './apps/aptos';
import { handleSuiApdu } from './apps/sui';
import type { FamilySession } from './apps/generic';
import { replaceSeedCache, wrapSeedPort, type SeedCache } from './crypto';

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
  private readonly nearSession: NearSession = {};
  private readonly avaxSession: AvaxSession = {};
  private readonly familySession: FamilySession = {};
  private readonly btcSession: BtcSession = {};
  private mtu: number;
  private app: LedgerApp = 'dashboard';
  private managerAllowed = false;
  private readonly seedCache: SeedCache = {};

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

  replaceSeed(seed: Uint8Array, icarusRoot?: Uint8Array): void {
    replaceSeedCache(this.seedCache, seed, icarusRoot);
  }

  setApp(app: LedgerApp): void {
    this.app = app;
    this.ethSession.pendingPersonal = undefined;
    this.ethSession.pendingTx = undefined;
    this.nearSession.pendingSign = undefined;
    this.avaxSession.pendingHash = undefined;
    this.avaxSession.rootPath = undefined;
    this.avaxSession.signChunks = undefined;
    this.familySession.pendingSign = undefined;
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
        this.ethSession.pendingTx = undefined;
        this.nearSession.pendingSign = undefined;
        this.avaxSession.pendingHash = undefined;
        this.avaxSession.rootPath = undefined;
        this.avaxSession.signChunks = undefined;
        this.familySession.pendingSign = undefined;
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
    if (
      this.app === 'dashboard' &&
      apdu.cla === 0xe0 &&
      (apdu.ins === 0x02 || apdu.ins === 0x04 || apdu.ins === 0x06 || apdu.ins === 0x08 || apdu.ins === 0x0c)
    ) {
      this.setApp('ethereum');
    }

    return this.handleFamilyApdu(apdu);
  }

  private async handleFamilyApdu(apdu: ReturnType<typeof parseApdu>): Promise<Uint8Array | null> {
    const family = ledgerAppFamily(this.app);
    const ctx = {
      confirmation: wrapSeedPort(this.confirmation, this.seedCache),
      slotId: this.slotId,
      entropy: this.entropy,
      backup: this.backup,
    };

    if (family === 'ethereum' || (family === 'avalanche' && apdu.cla === 0xe0)) {
      if (apdu.cla !== 0xe0) {
        if (family === 'avalanche' && apdu.cla === 0x80) {
          return handleAvalancheApdu(apdu, {
            ...ctx,
            session: this.avaxSession,
            targetId: targetIdFor(this.model.id),
          });
        }
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleEthereumApdu(apdu, { ...ctx, session: this.ethSession });
    }

    if (family === 'avalanche') {
      if (apdu.cla === 0x80) {
        return handleAvalancheApdu(apdu, {
          ...ctx,
          session: this.avaxSession,
          targetId: targetIdFor(this.model.id),
        });
      }
      return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
    }

    if (family === 'bitcoin') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleBitcoinApdu(apdu, {
        ...ctx,
        coin: coinFromAppId(this.app),
        session: this.btcSession,
      });
    }

    if (family === 'near') {
      if (apdu.cla !== 0x80) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleNearApdu(apdu, { ...ctx, session: this.nearSession });
    }

    if (family === 'solana') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleSolanaApdu(apdu, ctx, this.familySession);
    }
    if (family === 'xrp') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleXrpApdu(apdu, ctx, this.familySession);
    }
    if (family === 'cardano') {
      if (apdu.cla !== 0xd7 && apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleCardanoApdu(apdu, ctx, this.familySession);
    }
    if (family === 'polkadot') {
      if (apdu.cla !== 0xf9 && apdu.cla !== 0x90) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handlePolkadotApdu(apdu, ctx, this.familySession);
    }
    if (family === 'tron') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleTronApdu(apdu, ctx, this.familySession);
    }
    if (family === 'cosmos') {
      if (apdu.cla !== 0x55) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleCosmosApdu(apdu, ctx, this.familySession);
    }
    if (family === 'ton') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleTonApdu(apdu, ctx, this.familySession);
    }
    if (family === 'aptos') {
      if (apdu.cla !== 0x5b) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleAptosApdu(apdu, ctx, this.familySession);
    }
    if (family === 'sui') {
      if (apdu.cla !== 0x00) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleSuiApdu(apdu, ctx, this.familySession);
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
