import type { Brand } from '@cws/contracts';
import { LedgerWebBleTransport, type LabLog } from './ble';
import { OneKeyWebBleTransport } from './onekey';
import { TrezorWebBleTransport } from './trezor';

export class LabHost {
  brand: Brand | null = null;
  readonly ledger: LedgerWebBleTransport;
  readonly onekey: OneKeyWebBleTransport;
  readonly trezor: TrezorWebBleTransport;

  constructor(log: LabLog, askPairingCode: () => Promise<string>) {
    this.ledger = new LedgerWebBleTransport(log);
    this.onekey = new OneKeyWebBleTransport(log);
    this.trezor = new TrezorWebBleTransport(log, askPairingCode);
  }

  get connected(): boolean {
    return this.ledger.connected || this.onekey.connected || this.trezor.connected;
  }

  get deviceName(): string {
    if (this.brand === 'onekey') {
      return this.onekey.deviceName;
    }
    if (this.brand === 'trezor') {
      return this.trezor.deviceName;
    }
    return this.ledger.deviceName;
  }

  async connect(brand: Brand, acceptAll = false): Promise<void> {
    this.disconnect();
    if (brand === 'onekey') {
      await this.onekey.connect(acceptAll);
    } else if (brand === 'trezor') {
      await this.trezor.connect(acceptAll);
    } else {
      await this.ledger.connect(acceptAll);
    }
    this.brand = brand;
  }

  disconnect(): void {
    this.ledger.disconnect();
    this.onekey.disconnect();
    this.trezor.disconnect();
    this.brand = null;
  }

  requireLedger(): LedgerWebBleTransport {
    if (!this.ledger.connected) {
      throw new Error('Connect a Ledger model first');
    }
    return this.ledger;
  }

  requireOneKey(): OneKeyWebBleTransport {
    if (!this.onekey.connected) {
      throw new Error('Connect a OneKey model first');
    }
    return this.onekey;
  }

  requireTrezor(): TrezorWebBleTransport {
    if (!this.trezor.connected) {
      throw new Error('Connect a Trezor Safe 7 first');
    }
    return this.trezor;
  }
}
