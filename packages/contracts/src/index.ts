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
  message: string; // human-readable summary
  rawPayload: Uint8Array;
}
