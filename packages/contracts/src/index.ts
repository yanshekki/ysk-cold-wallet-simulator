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

export interface SeedSlot {
  id: string;
  label: string;
  brand: Brand;
  modelId: string;
  wordCount: 12 | 24;
  createdAt: number;
  // seed itself is never in this object — only in SecureStore
}

export interface SigningRequest {
  brand: Brand;
  path: string;
  message: string;
  rawPayload: Uint8Array;
}

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

export type LedgerApp = 'dashboard' | 'ethereum';

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
} from './models';
