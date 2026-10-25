import {
  DEFAULT_MTU,
  FailureType,
  MessageType,
  V1Reassembler,
  decodeFailure,
  decodeFeatures,
  frameV1,
  splitOneKeyV1,
} from '@cws/protocol-onekey';
import { bytesToHex } from './apdu';
import { PacketQueue, requestWallet, writeCharacteristic, type GattLink } from './gatt';
import type { LabLog } from './ble';

const SIGN_TIMEOUT_MS = 180_000;

export type OneKeyMessage = { type: number; payload: Uint8Array };

export class OneKeyWebBleTransport {
  private link: GattLink | null = null;
  private readonly assembler = new V1Reassembler();
  private readonly packets = new PacketQueue();
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

  async connect(acceptAll = false): Promise<void> {
    const link = await requestWallet('onekey', acceptAll);
    link.notify.addEventListener('characteristicvaluechanged', this.onNotify);
    link.device.addEventListener('gattserverdisconnected', () => {
      this.log('err', 'disconnected');
    });
    this.link = link;
    this.log('out', `connected ${link.device.name ?? link.model.name} ${link.model.id}`);
    const features = await this.rpc(MessageType.Initialize, new Uint8Array());
    if (features.type !== MessageType.Features) {
      throw new Error(`expected Features, got ${features.type}`);
    }
    const decoded = decodeFeatures(features.payload);
    this.log('out', `features ${decoded.vendor} ${decoded.model}`);
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
    this.assembler.reset();
    this.packets.reset();
    this.log('out', 'disconnected');
  }

  async rpc(type: number, payload: Uint8Array, timeout = SIGN_TIMEOUT_MS): Promise<OneKeyMessage> {
    if (!this.link) {
      throw new Error('Not connected');
    }
    const framed = frameV1(type, payload);
    this.log('in', `V1 ${type}`, bytesToHex(framed));
    this.assembler.reset();
    for (const packet of splitOneKeyV1(framed, DEFAULT_MTU)) {
      await writeCharacteristic(this.link.write, packet);
    }
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const packet = await this.packets.next(deadline - Date.now());
      const message = this.assembler.push(packet);
      if (message) {
        this.log('out', `V1 ${message.type}`, bytesToHex(message.payload));
        return message;
      }
    }
    throw new Error('BLE timeout waiting for notify');
  }

  async call(type: number, payload: Uint8Array): Promise<OneKeyMessage> {
    const first = await this.rpc(type, payload);
    if (first.type === MessageType.ButtonRequest) {
      const next = await this.rpc(MessageType.ButtonAck, new Uint8Array());
      if (next.type === MessageType.Failure) {
        throw oneKeyFailure(next.payload);
      }
      return next;
    }
    if (first.type === MessageType.Failure) {
      throw oneKeyFailure(first.payload);
    }
    return first;
  }
}

function oneKeyFailure(payload: Uint8Array): Error {
  const decoded = decodeFailure(payload);
  const label = decoded.code === FailureType.UnexpectedMessage ? 'Unsupported' : decoded.message;
  return new Error(label || `OneKey failure ${decoded.code}`);
}
