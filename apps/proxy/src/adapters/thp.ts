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
import type { BlePort } from '../ports';
import type { LogFn } from '../log';
import { PacketQueue } from '../packets';

const WRITE_MTU = 20;

function encodeL4(sessionId: number, type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 2 + payload.length);
  out[0] = sessionId & 0xff;
  out[1] = (type >> 8) & 0xff;
  out[2] = type & 0xff;
  out.set(payload, 3);
  return out;
}

function decodeL4(plain: Uint8Array): TrezorMessage {
  return {
    sessionId: plain[0],
    type: (plain[1] << 8) | plain[2],
    payload: plain.subarray(3),
  };
}

export type TrezorMessage = { sessionId: number; type: number; payload: Uint8Array };

export class ThpClient {
  private readonly assembler = new ThpReassembler();
  private readonly packets = new PacketQueue();
  private cid = 0;
  private sendSeq = 0;
  private initiator: ThpNoiseInitiator | undefined;
  private sessionId = 0;
  private properties: Uint8Array = new Uint8Array();
  private readonly offNotify: () => void;

  constructor(
    private readonly ble: BlePort,
    private readonly log: LogFn,
    private readonly askPairingCode: () => Promise<string>,
    private readonly timeoutMs = 180_000,
  ) {
    this.offNotify = ble.onNotify((packet) => {
      this.packets.push(packet);
    });
  }

  async start(): Promise<void> {
    this.cid = 0;
    this.sendSeq = 0;
    this.sessionId = 0;
    this.initiator = undefined;
    await this.allocate();
    await this.handshake();
    await this.pair();
    await this.app(MessageType.ThpEndRequest, new Uint8Array());
    const features = await this.app(MessageType.Initialize, new Uint8Array());
    if (features.type !== MessageType.Features) {
      throw new Error(`expected Features, got ${features.type}`);
    }
    const decoded = decodeFeatures(features.payload);
    this.log(`features ${decoded.vendor} ${decoded.model}`);
  }

  close(): void {
    this.offNotify();
    this.assembler.reset();
    this.packets.reset();
    this.initiator = undefined;
  }

  async app(type: number, payload: Uint8Array): Promise<TrezorMessage> {
    if (!this.initiator) {
      throw new Error('THP handshake not ready');
    }
    const cipher = this.initiator.encrypt(encodeL4(this.sessionId, type, payload));
    const frames = await this.exchange(withSeq(CTRL_ENCRYPTED, this.sendSeq), cipher);
    this.sendSeq ^= 1;
    const data = frames.find((frame) => isEncrypted(frame.ctrl));
    if (!data) {
      throw new Error('THP response missing encrypted payload');
    }
    const plain = this.initiator.decrypt(data.payload);
    const message = decodeL4(plain);
    if (message.sessionId) {
      this.sessionId = message.sessionId;
    }
    return message;
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
    this.log(`THP cid ${this.cid}`);
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
    const approved = await this.app(MessageType.ThpPairingRequest, encodePairingRequest('cws-proxy', 'CWS USB proxy'));
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
    await this.app(MessageType.ThpCredentialRequest, encodeCredentialRequest(this.initiator!.hostStatic.publicKey));
  }

  private async exchange(ctrl: number, payload: Uint8Array, cid = this.cid): Promise<ThpFrame[]> {
    const framed = encodeTransport(ctrl, cid, payload);
    this.assembler.reset();
    for (const packet of splitThpPackets(framed, WRITE_MTU)) {
      await this.ble.write(packet);
    }
    const frames: ThpFrame[] = [];
    const deadline = Date.now() + this.timeoutMs;
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

function trezorOrUnexpected(message: TrezorMessage): Error {
  if (message.type === MessageType.Failure) {
    const decoded = decodeFailure(message.payload);
    const label =
      decoded.code === FailureType.UnexpectedMessage ? decoded.message || 'Unsupported' : decoded.message;
    return new Error(label || `Trezor failure ${decoded.code}`);
  }
  return new Error(`unexpected THP message ${message.type}`);
}
