import type { SigningRequest } from './signing';

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
}

export type { LedgerApp, LedgerInstalledApp, LedgerInstalledAppId } from './ledgerApps';
export {
  LEDGER_APPS,
  LEDGER_INSTALLED_APPS,
  ledgerAppChip,
  ledgerAppLabel,
  ledgerInstalledApp,
  matchLedgerApp,
} from './ledgerApps';

export interface ApduLogEntry {
  id: string;
  at: number;
  direction: 'in' | 'out';
  hex: string;
  note?: string;
}

export {
  ALL_MODELS,
  LEDGER_MODELS,
  TREZOR_MODELS,
  ONEKEY_MODELS,
  bleAdvertiseName,
} from './models';

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
