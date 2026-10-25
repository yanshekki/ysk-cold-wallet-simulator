import {
  BROADCAST_CID,
  CTRL_ALLOC_REQUEST,
  CTRL_ENCRYPTED,
  CTRL_HANDSHAKE_COMPLETE,
  CTRL_HANDSHAKE_INIT,
  Cpace,
  FailureType,
  MessageType,
  ThpNoiseInitiator,
  ThpPairingMethod,
  ThpReassembler,
  decodeCodeEntryCpaceTrezor,
  decodeFailure,
  decodeFeatures,
  encodeCodeEntryChallenge,
  encodeCodeEntryCpaceHostTag,
  encodeCredentialRequest,
  encodePairingRequest,
  encodeSelectMethod,
  encodeTransport,
  isAck,
  isEncrypted,
  isHandshakeCompleteResponse,
  isHandshakeInitResponse,
  randomBytes,
  splitThpPackets,
  withSeq,
  type ThpFrame,
} from '@cws/protocol-trezor';
import { bytesToHex, concatBytes } from './apdu';
import { PacketQueue, requestWallet, writeCharacteristic, type GattLink } from './gatt';
import type { LabLog } from './ble';

const SIGN_TIMEOUT_MS = 180_000;
const WRITE_MTU = 20;

function encodeL4(sessionId: number, type: number, payload: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(sessionId & 0xff), Uint8Array.of((type >> 8) & 0xff, type & 0xff), payload);
}

function decodeL4(plain: Uint8Array): { sessionId: number; type: number; payload: Uint8Array } {
  return {
    sessionId: plain[0],
    type: (plain[1] << 8) | plain[2],
    payload: plain.subarray(3),
  };
}

export type TrezorMessage = { sessionId: number; type: number; payload: Uint8Array };

export class TrezorWebBleTransport {
  private link: GattLink | null = null;
  private readonly assembler = new ThpReassembler();
  private readonly packets = new PacketQueue();
  private cid = 0;
  private sendSeq = 0;
  private initiator: ThpNoiseInitiator | undefined;
  private sessionId = 0;
  private properties: Uint8Array = new Uint8Array();
  private readonly onNotify = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const view = target.value;
    if (!view) {
      return;
    }
    this.packets.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice());
  };

  constructor(
    private readonly log: LabLog,
    private readonly askPairingCode: () => Promise<string>,
  ) {}

  get connected(): boolean {
    return Boolean(this.link?.server.connected);
  }

  get deviceName(): string {
    return this.link?.device.name ?? this.link?.model.name ?? '';
  }

  async connect(acceptAll = false): Promise<void> {
    const link = await requestWallet('trezor', acceptAll);
    link.notify.addEventListener('characteristicvaluechanged', this.onNotify);
    link.device.addEventListener('gattserverdisconnected', () => {
      this.log('err', 'disconnected');
    });
    this.link = link;
    this.cid = 0;
    this.sendSeq = 0;
    this.sessionId = 0;
    this.initiator = undefined;
    this.log('out', `connected ${link.device.name ?? link.model.name} ${link.model.id}`);
    await this.allocate();
    await this.handshake();
    await this.pair();
    await this.app(MessageType.ThpEndRequest, new Uint8Array());
    const features = await this.app(MessageType.Initialize, new Uint8Array());
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
    this.initiator = undefined;
    this.assembler.reset();
    this.packets.reset();
    this.log('out', 'disconnected');
  }

  async app(type: number, payload: Uint8Array): Promise<TrezorMessage> {
    if (!this.initiator) {
      throw new Error('THP handshake not ready');
    }
    const cipher = this.initiator.encrypt(encodeL4(this.sessionId, type, payload));
    this.log('in', `THP ${type}`, bytesToHex(payload));
    const frames = await this.exchange(withSeq(CTRL_ENCRYPTED, this.sendSeq), cipher);
    this.sendSeq ^= 1;
    const data = frames.find((frame) => isEncrypted(frame.ctrl));
    if (!data) {
      throw new Error('THP response missing encrypted payload');
    }
    const plain = this.initiator.decrypt(data.payload);
    const message = decodeL4(plain);
    this.log('out', `THP ${message.type}`, bytesToHex(message.payload));
    if (message.sessionId) {
      this.sessionId = message.sessionId;
    }
    return message;
  }

  async call(type: number, payload: Uint8Array): Promise<TrezorMessage> {
    const first = await this.app(type, payload);
    if (first.type === MessageType.ButtonRequest) {
      const next = await this.app(MessageType.ButtonAck, new Uint8Array());
      if (next.type === MessageType.Failure) {
        throw trezorFailure(next.payload);
      }
      return next;
    }
    if (first.type === MessageType.Failure) {
      throw trezorFailure(first.payload);
    }
    return first;
  }

  private async allocate(): Promise<void> {
    const nonce = randomBytes(8);
    const frames = await this.exchange(CTRL_ALLOC_REQUEST, nonce, BROADCAST_CID);
    const alloc = frames[0];
    if (!alloc || alloc.payload.length < 10) {
      throw new Error('THP allocate failed');
    }
    this.cid = (alloc.payload[8] << 8) | alloc.payload[9];
    this.properties = alloc.payload.subarray(10);
    this.log('out', `THP cid ${this.cid}`);
  }

  private async handshake(): Promise<void> {
    this.initiator = new ThpNoiseInitiator(this.properties);
    const init = this.initiator.initRequest();
    const initFrames = await this.exchange(withSeq(CTRL_HANDSHAKE_INIT, this.sendSeq), init);
    this.sendSeq ^= 1;
    const initData = initFrames.find((frame) => isHandshakeInitResponse(frame.ctrl));
    if (!initData || initData.payload.length !== 96) {
      throw new Error('THP handshake init failed');
    }
    const completion = this.initiator.completeRequest(initData.payload);
    const done = await this.exchange(withSeq(CTRL_HANDSHAKE_COMPLETE, this.sendSeq), completion);
    this.sendSeq ^= 1;
    const complete = done.find((frame) => isHandshakeCompleteResponse(frame.ctrl));
    if (!complete) {
      throw new Error('THP handshake complete failed');
    }
    this.initiator.finish(complete.payload);
  }

  private async pair(): Promise<void> {
    const approved = await this.app(MessageType.ThpPairingRequest, encodePairingRequest('lab', 'CWS lab'));
    if (approved.type !== MessageType.ThpPairingRequestApproved) {
      throw trezorOrUnexpected(approved);
    }
    const commitment = await this.app(
      MessageType.ThpSelectMethod,
      encodeSelectMethod(ThpPairingMethod.CodeEntry),
    );
    if (commitment.type !== MessageType.ThpCodeEntryCommitment) {
      throw trezorOrUnexpected(commitment);
    }
    const challenge = randomBytes(16);
    const cpace = await this.app(MessageType.ThpCodeEntryChallenge, encodeCodeEntryChallenge(challenge));
    if (cpace.type !== MessageType.ThpCodeEntryCpaceTrezor) {
      throw trezorOrUnexpected(cpace);
    }
    const code = (await this.askPairingCode()).replace(/\D/g, '');
    if (code.length !== 6) {
      throw new Error('Pairing code must be 6 digits');
    }
    const hostCpace = new Cpace(this.initiator!.handshakeHash);
    hostCpace.generateKeys(code);
    hostCpace.computeSharedSecret(decodeCodeEntryCpaceTrezor(cpace.payload));
    const secret = await this.app(
      MessageType.ThpCodeEntryCpaceHostTag,
      encodeCodeEntryCpaceHostTag(hostCpace.publicKey, hostCpace.hostTag()),
    );
    if (secret.type !== MessageType.ThpCodeEntrySecret) {
      throw trezorOrUnexpected(secret);
    }
    await this.app(
      MessageType.ThpCredentialRequest,
      encodeCredentialRequest(this.initiator!.hostStatic.publicKey),
    );
  }

  private async exchange(ctrl: number, payload: Uint8Array, cid = this.cid): Promise<ThpFrame[]> {
    if (!this.link) {
      throw new Error('Not connected');
    }
    const framed = encodeTransport(ctrl, cid, payload);
    this.assembler.reset();
    for (const packet of splitThpPackets(framed, WRITE_MTU)) {
      await writeCharacteristic(this.link.write, packet);
    }
    const frames: ThpFrame[] = [];
    const deadline = Date.now() + SIGN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const packet = await this.packets.next(deadline - Date.now());
      const frame = this.assembler.push(packet);
      if (!frame) {
        continue;
      }
      frames.push(frame);
      const hasData = frames.some((item) => !isAck(item.ctrl));
      if (hasData || (ctrl === CTRL_ALLOC_REQUEST && frames.length >= 1)) {
        return frames;
      }
    }
    throw new Error('BLE timeout waiting for notify');
  }
}

function trezorFailure(payload: Uint8Array): Error {
  const decoded = decodeFailure(payload);
  return new Error(decoded.message || `Trezor failure ${decoded.code}`);
}

function trezorOrUnexpected(message: TrezorMessage): Error {
  if (message.type === MessageType.Failure) {
    const decoded = decodeFailure(message.payload);
    const label =
      decoded.code === FailureType.UnexpectedMessage ? decoded.message || 'Unsupported' : decoded.message;
    return new Error(label || `Trezor failure ${decoded.code}`);
  }
  return new Error(`unexpected THP message ${message.type}`);
}
