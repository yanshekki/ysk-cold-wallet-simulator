import { type DeviceModel } from '@cws/contracts';
import {
  BleReassembler,
  clampMtu,
  DEFAULT_MTU,
  framePayload,
  splitFramedPackets,
  TAG_APDU,
  TAG_MTU,
} from '@cws/protocol-ledger';
import { StatusWordError, assertOk, bytesToHex, encodeApdu } from './apdu';
import { PacketQueue, requestWallet, writeCharacteristic, type GattLink } from './gatt';

const SIGN_TIMEOUT_MS = 180_000;
const MTU_TIMEOUT_MS = 8_000;

export type LabLog = (direction: 'in' | 'out' | 'err', note: string, hex?: string) => void;

export class LedgerWebBleTransport {
  private link: GattLink | null = null;
  private mtu = DEFAULT_MTU;
  private readonly assembler = new BleReassembler();
  private readonly packets = new PacketQueue();
  private lastApp: string | null = null;
  private readonly onNotify = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const view = target.value;
    if (!view) {
      return;
    }
    this.packets.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice());
  };

  constructor(private readonly log: LabLog) {}

  get connected(): boolean {
    return Boolean(this.link?.server.connected);
  }

  get deviceName(): string {
    return this.link?.device.name ?? this.link?.model.name ?? '';
  }

  get modelId(): string | null {
    return this.link?.model.id ?? null;
  }

  get model(): DeviceModel | null {
    return this.link?.model ?? null;
  }

  async connect(acceptAll = false): Promise<void> {
    const link = await requestWallet('ledger', acceptAll);
    link.notify.addEventListener('characteristicvaluechanged', this.onNotify);
    link.device.addEventListener('gattserverdisconnected', () => {
      this.log('err', 'disconnected');
      this.lastApp = null;
    });
    this.link = link;
    this.mtu = DEFAULT_MTU;
    this.log('out', `connected ${link.device.name ?? link.model.name} ${link.model.id}`);
    await this.negotiateMtu();
  }

  disconnect(): void {
    if (!this.link) {
      return;
    }
    try {
      this.link.notify.removeEventListener('characteristicvaluechanged', this.onNotify);
    } catch {
      // already gone
    }
    this.link?.server.disconnect();
    this.link = null;
    this.lastApp = null;
    this.assembler.reset();
    this.packets.reset();
    this.log('out', 'disconnected');
  }

  async send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data: Uint8Array = new Uint8Array(),
    timeout = SIGN_TIMEOUT_MS,
  ): Promise<Uint8Array> {
    const apdu = encodeApdu(cla, ins, p1, p2, data);
    this.log('in', `APDU ${hexByte(cla)} ${hexByte(ins)} ${hexByte(p1)} ${hexByte(p2)}`, bytesToHex(apdu));
    const framed = await this.exchange(TAG_APDU, apdu, timeout);
    this.log('out', `SW ${statusHex(framed)}`, bytesToHex(framed));
    return framed;
  }

  async sendOk(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data: Uint8Array = new Uint8Array(),
    note?: string,
  ): Promise<Uint8Array> {
    return assertOk(await this.send(cla, ins, p1, p2, data), note);
  }

  async openApp(name: string, force = false): Promise<void> {
    if (!force && this.lastApp === name) {
      return;
    }
    const body = await this.sendOk(0xe0, 0xd8, 0x00, 0x00, ascii(name), `OPEN_APP ${name}`);
    this.lastApp = name;
    void body;
  }

  async quitApp(): Promise<void> {
    await this.sendOk(0xb0, 0xa7, 0x00, 0x00, new Uint8Array(), 'QUIT_APP');
    this.lastApp = 'BOLOS';
  }

  private async negotiateMtu(): Promise<void> {
    try {
      const framed = await this.exchange(TAG_MTU, new Uint8Array(), MTU_TIMEOUT_MS);
      if (framed.length > 0) {
        this.mtu = clampMtu(framed[0]);
      }
      this.log('out', `MTU ${this.mtu}`);
    } catch (error) {
      this.mtu = DEFAULT_MTU;
      this.log('err', error instanceof Error ? error.message : 'MTU negotiate failed');
    }
  }

  private async exchange(tag: number, payload: Uint8Array, timeout: number): Promise<Uint8Array> {
    if (!this.link) {
      throw new Error('Not connected');
    }
    this.assembler.reset();
    const framed = framePayload(tag, payload, this.mtu);
    const packets = splitFramedPackets(framed, this.mtu);
    for (const packet of packets) {
      await writeCharacteristic(this.link.write, packet);
    }
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const packet = await this.packets.next(deadline - Date.now());
      const frame = this.assembler.push(packet);
      if (frame) {
        return frame.payload;
      }
    }
    throw new Error('BLE timeout waiting for notify');
  }
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function statusHex(payload: Uint8Array): string {
  if (payload.length < 2) {
    return '----';
  }
  const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
  return sw.toString(16).padStart(4, '0');
}

export function formatError(error: unknown): string {
  if (error instanceof StatusWordError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
