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
  parseBip32Path,
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
import { CLA_FRAMEWORK, handleBitcoinClientApdu } from './apps/bitcoinClient';
import { handleEthereumApdu, type EthSession } from './apps/ethereum';
import { handleNearApdu, type NearSession } from './apps/near';
import { handleSolanaApdu, isSolanaSignPayload } from './apps/solana';
import { handleXrpApdu } from './apps/xrp';
import { handleCardanoApdu } from './apps/cardano';
import { handlePolkadotApdu } from './apps/polkadot';
import { handleTronApdu } from './apps/tron';
import { handleCosmosApdu } from './apps/cosmos';
import { handleTonApdu } from './apps/ton';
import { handleAptosApdu } from './apps/aptos';
import { handleSuiApdu } from './apps/sui';
import { handleStellarApdu } from './apps/stellar';
import { handleTezosApdu } from './apps/tezos';
import { handleAlgorandApdu } from './apps/algorand';
import { handleMultiversXApdu } from './apps/multiversx';
import { handleFilecoinApdu } from './apps/filecoin';
import { handleStacksApdu } from './apps/stacks';
import { handleMinaApdu } from './apps/mina';
import { handleEosApdu } from './apps/eos';
import { handleHederaApdu } from './apps/hedera';
import { handleNeoApdu } from './apps/neo';
import { handleCasperApdu } from './apps/casper';
import { handleFlareApdu } from './apps/flare';
import { handleConfluxApdu } from './apps/conflux';
import { handleBinanceApdu } from './apps/binance';
import { handleWavesApdu } from './apps/waves';
import { handleAionApdu } from './apps/aion';
import { handleAleoApdu } from './apps/aleo';
import { handleAlephiumApdu } from './apps/alephium';
import { handleSiaApdu } from './apps/sia';
import { handleErgoApdu } from './apps/ergo';
import { handleArweaveApdu } from './apps/arweave';
import { handleFlowApdu } from './apps/flow';
import { handleInternetComputerApdu } from './apps/internetcomputer';
import { handleStarknetApdu } from './apps/starknet';
import { handleHathorApdu } from './apps/hathor';
import { handleHiveApdu } from './apps/hive';
import { handleConcordiumApdu } from './apps/concordium';
import { handleSymbolApdu } from './apps/symbol';
import { handleEverscaleApdu } from './apps/everscale';
import { handleQrlApdu } from './apps/qrl';
import { handleArdorApdu } from './apps/ardor';
import { handleFioApdu } from './apps/fio';
import { handleCantonApdu } from './apps/canton';
import { handleKaspaApdu } from './apps/kaspa';
import { handleIotaApdu } from './apps/iota';
import { handleNervosApdu } from './apps/nervos';
import { handleNamadaApdu } from './apps/namada';
import { handleSpacemeshApdu } from './apps/spacemesh';
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

  resetLink(): void {
    this.assembler.reset();
    this.ethSession.pendingPersonal = undefined;
    this.ethSession.pendingTx = undefined;
    this.ethSession.pending712 = undefined;
    this.ethSession.typed712 = undefined;
    this.ethSession.token = undefined;
    this.ethSession.nft = undefined;
    this.ethSession.network = undefined;
    this.ethSession.challenge = undefined;
    this.nearSession.pendingSign = undefined;
    this.avaxSession.pendingHash = undefined;
    this.avaxSession.hashConfirmed = false;
    this.avaxSession.rootPath = undefined;
    this.avaxSession.signChunks = undefined;
    this.familySession.pendingSign = undefined;
    this.familySession.suiBlocks = undefined;
    this.familySession.cardanoTx = undefined;
    this.btcSession.version = undefined;
    this.btcSession.prevouts = undefined;
    this.btcSession.prevout = undefined;
    this.btcSession.amount = undefined;
    this.btcSession.sequence = undefined;
    this.btcSession.outputs = undefined;
    this.btcSession.locktime = undefined;
    this.btcSession.signIndex = undefined;
    this.btcSession.clientPsbt = undefined;
    this.btcSession.clientJob = undefined;
  }

  setApp(app: LedgerApp): void {
    this.app = app;
    this.ethSession.pendingPersonal = undefined;
    this.ethSession.pendingTx = undefined;
    this.nearSession.pendingSign = undefined;
    this.avaxSession.pendingHash = undefined;
    this.avaxSession.hashConfirmed = false;
    this.avaxSession.rootPath = undefined;
    this.avaxSession.signChunks = undefined;
    this.familySession.pendingSign = undefined;
    this.familySession.suiBlocks = undefined;
    this.familySession.cardanoTx = undefined;
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
    this.avaxSession.hashConfirmed = false;
        this.avaxSession.rootPath = undefined;
        this.avaxSession.signChunks = undefined;
        this.familySession.pendingSign = undefined;
        this.familySession.suiBlocks = undefined;
        this.familySession.cardanoTx = undefined;
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
    // BOLOS firmware GET_VERSION is E0 01 on the dashboard. Mina (and any
    // future app) reuses INS 0x01 inside the open app — do not steal it.
    if (apdu.cla === 0xe0 && apdu.ins === 0x01 && this.app === 'dashboard') {
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
    const inferred = inferAppFromApdu(this.app, apdu);
    if (inferred) {
      this.setApp(inferred);
    }

    // Official TON GET_PUBLIC_KEY is E0 05 (same INS as Solana). Never sign it.
    if (apdu.cla === 0xe0 && apdu.ins === 0x05 && ledgerAppFamily(this.app) === 'ton') {
      const ctx = {
        confirmation: wrapSeedPort(this.confirmation, this.seedCache),
        slotId: this.slotId,
        entropy: this.entropy,
        backup: this.backup,
      };
      return handleTonApdu(apdu, ctx, this.familySession);
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

    if (family === 'ethereum' || (family === 'avalanche' && apdu.cla === 0xe0) || (family === 'filecoin' && apdu.cla === 0xe0) || (family === 'flare' && apdu.cla === 0xe0)) {
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
      return handleEthereumApdu(apdu, { ...ctx, session: this.ethSession, app: this.app });
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
      const btcCtx = {
        ...ctx,
        coin: coinFromAppId(this.app),
        session: this.btcSession,
      };
      if (apdu.cla === 0xe1 || apdu.cla === CLA_FRAMEWORK) {
        return handleBitcoinClientApdu(apdu, btcCtx);
      }
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleBitcoinApdu(apdu, btcCtx);
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
    if (family === 'stellar') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleStellarApdu(apdu, ctx, this.familySession);
    }

    if (family === 'tezos') {
      if (apdu.cla !== 0x80) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleTezosApdu(apdu, ctx, this.familySession);
    }
    if (family === 'algorand') {
      if (apdu.cla !== 0x80) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleAlgorandApdu(apdu, ctx, this.familySession);
    }
    if (family === 'multiversx') {
      if (apdu.cla !== 0xed) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleMultiversXApdu(apdu, ctx, this.familySession);
    }
    if (family === 'filecoin') {
      if (apdu.cla === 0x06) {
        return handleFilecoinApdu(apdu, ctx, this.familySession);
      }
      return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
    }
    if (family === 'stacks') {
      if (apdu.cla !== 0x09) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleStacksApdu(apdu, ctx, this.familySession);
    }
    if (family === 'mina') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleMinaApdu(apdu, ctx, this.familySession);
    }

    if (family === 'eos') {
      if (apdu.cla !== 0xd4) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleEosApdu(apdu, ctx, this.familySession);
    }
    if (family === 'hedera') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleHederaApdu(apdu, ctx, this.familySession);
    }
    if (family === 'neo') {
      if (apdu.cla !== 0x80) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleNeoApdu(apdu, ctx, this.familySession);
    }
    if (family === 'casper') {
      if (apdu.cla !== 0x06) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleCasperApdu(apdu, ctx, this.familySession);
    }
    if (family === 'flare') {
      if (apdu.cla === 0x58) {
        return handleFlareApdu(apdu, { ...ctx, targetId: targetIdFor(this.model.id) }, this.familySession);
      }
      return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
    }
    if (family === 'conflux') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleConfluxApdu(apdu, ctx, this.familySession);
    }
    if (family === 'binance') {
      if (apdu.cla !== 0xbc) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleBinanceApdu(apdu, ctx, this.familySession);
    }
    if (family === 'waves') {
      if (apdu.cla !== 0x80) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleWavesApdu(apdu, ctx, this.familySession);
    }
    if (family === 'aion') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleAionApdu(apdu, ctx, this.familySession);
    }
    if (family === 'aleo') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleAleoApdu(apdu, ctx, this.familySession);
    }
    if (family === 'alephium') {
      if (apdu.cla !== 0x80) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleAlephiumApdu(apdu, ctx, this.familySession);
    }
    if (family === 'sia') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleSiaApdu(apdu, ctx, this.familySession);
    }
    if (family === 'ergo') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleErgoApdu(apdu, ctx, this.familySession);
    }
    if (family === 'arweave') {
      if (apdu.cla !== 0x44) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleArweaveApdu(apdu, ctx, this.familySession);
    }
    if (family === 'flow') {
      if (apdu.cla !== 0x33) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleFlowApdu(apdu, ctx, this.familySession);
    }
    if (family === 'internetcomputer') {
      if (apdu.cla !== 0x11) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleInternetComputerApdu(apdu, ctx, this.familySession);
    }
    if (family === 'starknet') {
      if (apdu.cla !== 0x5a) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleStarknetApdu(apdu, ctx, this.familySession);
    }
    if (family === 'hathor') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleHathorApdu(apdu, ctx, this.familySession);
    }
    if (family === 'hive') {
      if (apdu.cla !== 0xd4) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleHiveApdu(apdu, ctx, this.familySession);
    }
    if (family === 'concordium') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleConcordiumApdu(apdu, ctx, this.familySession);
    }
    if (family === 'symbol') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleSymbolApdu(apdu, ctx, this.familySession);
    }
    if (family === 'everscale') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleEverscaleApdu(apdu, ctx, this.familySession);
    }
    if (family === 'qrl') {
      if (apdu.cla !== 0x77) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleQrlApdu(apdu, ctx, this.familySession);
    }
    if (family === 'ardor') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleArdorApdu(apdu, ctx, this.familySession);
    }
    if (family === 'fio') {
      if (apdu.cla !== 0xd7) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleFioApdu(apdu, ctx, this.familySession);
    }
    if (family === 'canton') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleCantonApdu(apdu);
    }
    if (family === 'kaspa') {
      if (apdu.cla !== 0xe0) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleKaspaApdu(apdu);
    }
    if (family === 'iota') {
      if (apdu.cla !== 0x00) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleIotaApdu(apdu);
    }
    if (family === 'nervos') {
      if (apdu.cla !== 0x80) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleNervosApdu(apdu);
    }
    if (family === 'namada') {
      if (apdu.cla !== 0x57) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleNamadaApdu(apdu, targetIdFor(this.model.id));
    }
    if (family === 'spacemesh') {
      if (apdu.cla !== 0x45) {
        return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
      }
      return handleSpacemeshApdu(apdu);
    }

    // ethereum-plugin / utility: not standalone coin APDU targets.
    if (family === 'ethereum-plugin' || family === 'utility') {
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
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

function inferAppFromPath(apdu: ReturnType<typeof parseApdu>): LedgerApp | undefined {
  if (apdu.data.length < 5) {
    return undefined;
  }
  let path: string;
  try {
    path = parseBip32Path(apdu.data).path;
  } catch {
    return undefined;
  }
  if (path.includes("44'/501'")) {
    return 'solana';
  }
  if (path.includes("44'/607'")) {
    return 'ton';
  }
  if (path.includes("44'/195'")) {
    return 'tron';
  }
  if (path.includes("44'/148'")) {
    return 'stellar';
  }
  if (path.includes("44'/60'")) {
    return 'ethereum';
  }
  if (path.includes("44'/784'")) {
    return 'sui';
  }
  if (path.includes("44'/397'") || path.includes("44'/396'")) {
    return 'near';
  }
  if (/(^|\/)(44|49|84|86)'\/0'(\/|$)/.test(path)) {
    return 'bitcoin';
  }
  return undefined;
}

function inferAppFromApdu(app: LedgerApp, apdu: ReturnType<typeof parseApdu>): LedgerApp | undefined {
  const family = ledgerAppFamily(app);
  const empty = apdu.data.length === 0;
  // The Avalanche app answers CLA 0x80 (X/P and C→P export) and CLA 0xE0
  // (C-Chain, the same instructions as the Ethereum app). A C-Chain address
  // read must not select Ethereum, and an empty E0 06 must not select Tron.
  // Either switch makes the following 80 05 export look like NEAR, so the
  // phone shows Near and never opens an export confirm sheet.
  if (family === 'avalanche' && (apdu.cla === 0x80 || apdu.cla === 0xe0)) {
    return undefined;
  }
  // Ethereum INS 0x06 is an empty GET_APP_CONFIGURATION. A data-bearing E0 06/07
  // whose first bytes are a Solana path count plus 44'/501' is SIGN_MESSAGE /
  // SIGN_OFFCHAIN. Leaving it on the dashboard (or on Ethereum) returns version
  // bytes, so the host never sends the rest of the transaction.
  if (
    apdu.cla === 0xe0 &&
    (apdu.ins === 0x06 || apdu.ins === 0x07) &&
    apdu.data.length > 0 &&
    isSolanaSignPayload(apdu.data)
  ) {
    return family === 'solana' ? undefined : 'solana';
  }
  const fromPath = inferAppFromPath(apdu);
  if (fromPath && ledgerAppFamily(fromPath) !== family) {
    return fromPath;
  }

  // HOT Wallet never sends OpenApp. Empty probes identify the next chain.
  if (
    apdu.cla === 0xe0 &&
    apdu.ins === 0x03 &&
    empty &&
    family !== 'conflux' &&
    family !== 'hedera' &&
    family !== 'mina' &&
    family !== 'flare' &&
    family !== 'aleo' &&
    family !== 'hathor' &&
    family !== 'canton' &&
    family !== 'kaspa'
  ) {
    return family === 'ton' ? undefined : 'ton';
  }
  if (apdu.cla === 0xe0 && apdu.ins === 0x04 && empty) {
    // TON GET_APP_NAME is also empty E0 04.
    // Canton and Kaspa GET_APP_NAME share that header. Leave them on the open app.
    if (family === 'solana' || family === 'ton' || family === 'canton' || family === 'kaspa') {
      return undefined;
    }
    return 'solana';
  }
  if (apdu.cla === 0xe0 && apdu.ins === 0x05) {
    // TON GET_PUBLIC_KEY is E0 05 (32-byte ed25519), same INS as Solana.
    // Canton and Kaspa GET_PUBLIC_KEY share that header. Pubkey stays KEEP there.
    if (family === 'solana' || family === 'ton' || family === 'canton' || family === 'kaspa') {
      return undefined;
    }
    return 'solana';
  }
  if (apdu.cla === 0xe0 && apdu.ins === 0x06 && empty) {
    if (
      family === 'ethereum' ||
      family === 'xrp' ||
      family === 'stellar' ||
      family === 'symbol' ||
      family === 'aion' ||
      family === 'canton' ||
      family === 'kaspa'
    ) {
      return undefined;
    }
    if (family === 'tron') {
      return 'stellar';
    }
    return 'tron';
  }
  if (apdu.cla === 0xe0 && apdu.ins === 0x40) {
    if (family === 'bitcoin' || family === 'concordium') {
      return undefined;
    }
    return 'bitcoin';
  }
  if (apdu.cla === 0xe1 || (apdu.cla === 0xf8 && apdu.ins === 0x01)) {
    return family === 'bitcoin' ? undefined : 'bitcoin';
  }
  if (
    apdu.cla === 0x00 &&
    (apdu.ins === 0x00 || apdu.ins === 0x01 || apdu.ins === 0x02 || apdu.ins === 0x03)
  ) {
    if (family === 'sui' || family === 'iota') {
      return undefined;
    }
    return 'sui';
  }
  // CLA 80 is shared by Near, Avalanche, Tezos, Algorand, NEO, Waves — only
  // infer Near when the open app is not already one of those families.
  if (
    apdu.cla === 0x80 &&
    (apdu.ins === 0x04 || apdu.ins === 0x05 || apdu.ins === 0x06) &&
    family !== 'avalanche' &&
    family !== 'tezos' &&
    family !== 'algorand' &&
    family !== 'neo' &&
    family !== 'waves' &&
    family !== 'alephium' &&
    family !== 'nervos'
  ) {
    return family === 'near' ? undefined : 'near';
  }

  if (app !== 'dashboard') {
    return undefined;
  }
  if (
    apdu.cla === 0xe0 &&
    (apdu.ins === 0x02 || apdu.ins === 0x06 || apdu.ins === 0x08 || apdu.ins === 0x0c)
  ) {
    return 'ethereum';
  }
  if (apdu.cla === 0xe0 && apdu.ins === 0x04) {
    return 'ethereum';
  }
  if (apdu.cla === 0xd7) {
    return 'cardano';
  }
  if (apdu.cla === 0x80 && (apdu.ins === 0x00 || apdu.ins === 0x01 || apdu.ins === 0x02 || apdu.ins === 0x03)) {
    return 'avalanche';
  }
  return undefined;
}
