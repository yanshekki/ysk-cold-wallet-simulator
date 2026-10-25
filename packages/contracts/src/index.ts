import type { SigningRequest } from './signing';
import type { ChainPathId, ChainPathMap } from './derivation';
import type { UsbHidIdentity } from './usb';

export type Brand = 'ledger' | 'trezor' | 'onekey';

export interface DeviceModel {
  id: string;
  brand: Brand;
  name: string;
  serviceUUID: string;
  writeCharUUID: string;
  notifyCharUUID: string;
  writeCmdCharUUID?: string;
  protocol: 'ledger-apdu' | 'thp' | 'onekey-v1' | 'onekey-v2';
  usb: UsbHidIdentity;
}

export type BackupKind = 'bip39' | 'slip39';

export type WordCount = 12 | 15 | 18 | 21 | 24 | 20 | 33;

export interface SeedSlot {
  id: string;
  label: string;
  brand: Brand;
  modelId: string;
  backup?: BackupKind;
  wordCount: WordCount;
  shares?: { threshold: number; count: number };
  createdAt: number;
  color?: string;
  paths?: ChainPathMap;
  nearAccountId?: string;
  nearPublicKey?: string;
  nearCreatedAt?: number;
  nearPath?: string;
  // seed itself is never in this object — only in SecureStore
}

export type {
  SigningKind,
  SigningRequest,
} from './signing';
export {
  SLIDE_COMMIT_RATIO,
  signingNeedsPassphrase,
  signingSlideLabel,
  slideProgress,
  shouldCommitSlide,
} from './signing';
export type { EthTxInput, SigningDetail, SigningField, SigningStyle } from './signingPreview';
export {
  describeEthMessage,
  describeEthTransaction,
  describeSigning,
  formatWeiEth,
  hex0x,
  parseEthTx,
} from './signingPreview';

export interface ProtocolHandler {
  brand: Brand;
  models: string[];
  handleWrite(data: Uint8Array): Promise<Uint8Array | null>;
  getServiceUUID(): string;
  getCharacteristics(): { write: string; notify: string; writeCmd?: string };
}

export interface ConfirmationPort {
  confirm(request: SigningRequest): Promise<boolean>;
  getPassphrase(slotId: string): Promise<string | undefined>;
  onPairingCode?(code: string | null): void;
  resolvePath?(apduPath: string, chains: readonly ChainPathId[]): string;
}

export type {
  LedgerApp,
  LedgerAppFamily,
  LedgerInstalledApp,
  LedgerInstalledAppId,
} from './ledgerApps';
export {
  LEDGER_APPS,
  LEDGER_INSTALLED_APPS,
  catalogVersion,
  fromManagerRow,
  inferLedgerFamily,
  ledgerAppChip,
  ledgerAppFamily,
  ledgerAppLabel,
  ledgerCatalog,
  ledgerInstalledApp,
  ledgerPickerApps,
  matchLedgerApp,
  resetLedgerCatalogOverlay,
  setLedgerCatalogOverlay,
  slugLedgerApp,
} from './ledgerApps';
export type { ChainPathId, ChainPathMap, SessionPathOverlay } from './derivation';
export {
  CHAIN_PATH_IDS,
  CHAIN_PATH_LABELS,
  DEFAULT_CHAIN_PATHS,
  componentsToPath,
  isValidDerivationPath,
  mergeChainPaths,
  overlayDerivationPath,
  pathFor,
  pathToComponents,
} from './derivation';

export type LogChannel = 'ble' | 'apdu' | 'app' | 'sign' | 'pair' | 'near' | 'manager' | 'error';

export interface ApduLogEntry {
  id: string;
  at: number;
  direction: 'in' | 'out';
  hex: string;
  note?: string;
  channel?: LogChannel;
}

export {
  ALL_MODELS,
  LEDGER_MODELS,
  TREZOR_MODELS,
  ONEKEY_MODELS,
  bleAdvertiseName,
} from './models';
export type { UsbHidIdentity } from './usb';
export {
  USB_HID_PREFIX,
  collectPrefixedHid,
  unwrapPrefixedHid,
  wrapPrefixedHid,
} from './usbHid';
export {
  HID_PACKET_SIZE,
  LEDGER_HID_USAGE,
  LEDGER_HID_USAGE_PAGE,
  LEDGER_USB_MODEL,
  LEDGER_USB_VID,
  ONEKEY_USB_VID,
  TREZOR_HID_PID,
  TREZOR_USB_VID,
  USB_HID_REPORT_SIZE,
  VENDOR_HID_USAGE,
  VENDOR_HID_USAGE_PAGE,
  hidDescriptorFor,
  ledgerGenericHidProductId,
  ledgerUsbIdentity,
  onekeyUsbProductId,
  vendorHidDescriptor,
  vendorUsbIdentity,
} from './usb';

export {
  LEDGER_OS,
  ONEKEY_FIRMWARE,
  TREZOR_FIRMWARE,
  formatVersion,
  ledgerOsFor,
  onekeyFirmwareFor,
  type LedgerOsVersion,
  type OneKeyFirmware,
  type VersionTriple,
} from './versions';
