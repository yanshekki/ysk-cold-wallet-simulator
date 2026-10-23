import type { BackupKind, Brand, ConfirmationPort, DeviceModel, ProtocolHandler, SigningRequest } from '@cws/contracts';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha2';
import {
  asBytes,
  bytesToHex,
  concatBytes,
  encodeUtf8,
  equalBytes,
  randomBytes,
  readU16BE,
  writeU16BE,
} from './bytes';
import { derivePrivateKey, ethereumAddressFromPrivateKey, pathToString, signPersonalMessage } from './crypto';
import {
  BROADCAST_CID,
  CTRL_ENCRYPTED,
  CTRL_HANDSHAKE_COMPLETE_RESPONSE,
  CTRL_HANDSHAKE_INIT_RESPONSE,
  CTRL_PONG,
  DEFAULT_MTU,
  ERROR_DECRYPTION_FAILED,
  ERROR_UNALLOCATED_CHANNEL,
  ThpReassembler,
  clampMtu,
  encodeAck,
  encodeTransport,
  encodeTransportError,
  isAck,
  isAllocRequest,
  isEncrypted,
  isHandshakeComplete,
  isHandshakeInit,
  isPing,
  isSynchronized,
  seqBit,
  withSeq,
  type ThpFrame,
} from './framing';
import {
  ButtonRequestType,
  FailureType,
  INTERNAL_MODEL,
  MessageType,
  ThpPairingMethod,
  TREZOR_STATE_UNPAIRED,
  decodeCodeEntryChallenge,
  decodeCodeEntryCpaceHostTag,
  decodeCreateNewSession,
  decodeCredentialRequest,
  decodeEthereumGetAddress,
  decodeEthereumSignMessage,
  decodePairingRequest,
  decodeSelectMethod,
  encodeButtonRequest,
  encodeCodeEntryCommitment,
  encodeCodeEntryCpaceTrezor,
  encodeCodeEntrySecret,
  encodeCredentialResponse,
  encodeDeviceProperties,
  encodeEthereumAddress,
  encodeEthereumMessageSignature,
  encodeFailure,
  encodeFeatures,
  encodeSuccess,
  isEthSignTx,
  type CredentialMetadata,
} from './messages';
import { ThpNoiseResponder, issueCredential } from './noise';
import {
  Cpace,
  codeEntryCode,
  codeEntryCommitment,
  formatPairingCode,
  generateCodeEntrySecret,
} from './pairing';

export type TrezorHandlerOptions = {
  model: DeviceModel;
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  mtu?: number;
};

type ChannelPhase =
  | 'unallocated'
  | 'th1'
  | 'th2'
  | 'tp0'
  | 'tp1'
  | 'tp3'
  | 'tc1'
  | 'encrypted';

type PendingAction =
  | {
      kind: 'eth-address';
      sessionId: number;
      path: string;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'eth-sign';
      sessionId: number;
      path: string;
      message: Uint8Array;
      rawPayload: Uint8Array;
    };

function encodeL4(sessionId: number, type: number, payload: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(sessionId & 0xff), writeU16BE(type), payload);
}

function decodeL4(plain: Uint8Array): { sessionId: number; type: number; payload: Uint8Array } {
  if (plain.length < 3) {
    throw new Error('L4 too short');
  }
  return {
    sessionId: plain[0],
    type: readU16BE(plain, 1),
    payload: plain.subarray(3),
  };
}

export class TrezorThpProtocolHandler implements ProtocolHandler {
  readonly brand: Brand = 'trezor';
  readonly models: string[];

  private readonly model: DeviceModel;
  private readonly confirmation: ConfirmationPort;
  private readonly slotId: string;
  private readonly entropy: Uint8Array;
  private readonly backup: BackupKind;
  private readonly assembler = new ThpReassembler();
  private readonly deviceProperties = encodeDeviceProperties();
  private readonly credAuthKey = randomBytes(32);
  private readonly noise: ThpNoiseResponder;
  private readonly serial: string;
  private mtu: number;
  private cid = 0;
  private phase: ChannelPhase = 'unallocated';
  private expectedRecvSeq = 0;
  private sendSeq = 0;
  private lastData: Uint8Array | undefined;
  private pending: PendingAction | undefined;
  private hostName = '';
  private appName = '';
  private hostStatic: Uint8Array = new Uint8Array();
  private codeEntrySecret: Uint8Array = new Uint8Array();
  private cpace: Cpace | undefined;
  private nextSessionId = 1;
  private readonly sessions = new Map<number, string>();

  constructor(options: TrezorHandlerOptions) {
    this.model = options.model;
    this.confirmation = options.confirmation;
    this.slotId = options.slotId;
    this.entropy = options.entropy;
    this.backup = options.backup ?? 'bip39';
    this.mtu = clampMtu(options.mtu ?? DEFAULT_MTU);
    this.models = [options.model.id];
    this.noise = new ThpNoiseResponder(this.deviceProperties, this.credAuthKey);
    this.serial = bytesToHex(keccak_256(encodeUtf8(`cws:${options.slotId}:${options.model.id}`)).subarray(0, 12));
    this.sessions.set(0, '');
  }

  getServiceUUID(): string {
    return this.model.serviceUUID;
  }

  getCharacteristics(): { write: string; notify: string; writeCmd?: string } {
    return {
      write: this.model.writeCharUUID,
      notify: this.model.notifyCharUUID,
    };
  }

  observeIncomingSize(size: number): void {
    this.mtu = clampMtu(Math.max(this.mtu, size));
  }

  async handleWrite(data: Uint8Array): Promise<Uint8Array | null> {
    this.observeIncomingSize(data.length);
    let frame: ThpFrame | null;
    try {
      frame = this.assembler.push(data);
    } catch {
      return null;
    }
    if (!frame) {
      return null;
    }
    return this.dispatch(frame);
  }

  private async dispatch(frame: ThpFrame): Promise<Uint8Array | null> {
    if (isAllocRequest(frame.ctrl)) {
      return this.allocate(frame);
    }
    if (isPing(frame.ctrl)) {
      return encodeTransport(CTRL_PONG, frame.cid, frame.payload);
    }
    if (isAck(frame.ctrl)) {
      return null;
    }
    if (frame.cid !== this.cid || this.phase === 'unallocated') {
      return encodeTransportError(frame.cid, ERROR_UNALLOCATED_CHANNEL);
    }
    if (!isSynchronized(frame.ctrl)) {
      return encodeTransportError(frame.cid, ERROR_UNALLOCATED_CHANNEL);
    }
    const seq = seqBit(frame.ctrl);
    if (seq !== this.expectedRecvSeq) {
      const ack = encodeAck(frame.cid, seq);
      return this.lastData ? concatBytes(ack, this.lastData) : ack;
    }
    this.expectedRecvSeq ^= 1;
    try {
      if (isHandshakeInit(frame.ctrl)) {
        return this.reply(frame, CTRL_HANDSHAKE_INIT_RESPONSE, this.noise.handshakeInit(frame.payload), 'th2');
      }
      if (isHandshakeComplete(frame.ctrl)) {
        const result = this.noise.handshakeComplete(frame.payload);
        this.hostStatic = asBytes(result.hostStatic);
        this.phase = result.state === TREZOR_STATE_UNPAIRED ? 'tp0' : 'tc1';
        return this.reply(frame, CTRL_HANDSHAKE_COMPLETE_RESPONSE, this.noise.completionResponse(result.state));
      }
      if (isEncrypted(frame.ctrl)) {
        const plain = this.noise.decrypt(frame.payload);
        const message = decodeL4(plain);
        const payload = await this.dispatchApp(message.sessionId, message.type, message.payload);
        if (!payload) {
          return encodeAck(frame.cid, seq);
        }
        return this.reply(frame, CTRL_ENCRYPTED, this.noise.encrypt(payload));
      }
    } catch {
      this.phase = 'unallocated';
      this.cid = 0;
      return encodeTransportError(frame.cid, ERROR_DECRYPTION_FAILED);
    }
    return encodeAck(frame.cid, seq);
  }

  private allocate(frame: ThpFrame): Uint8Array {
    if (frame.cid !== BROADCAST_CID || frame.payload.length < 8) {
      return encodeTransportError(frame.cid, ERROR_UNALLOCATED_CHANNEL);
    }
    this.cid = 0x0001;
    this.phase = 'th1';
    this.expectedRecvSeq = 0;
    this.sendSeq = 0;
    this.lastData = undefined;
    this.pending = undefined;
    const payload = concatBytes(frame.payload.subarray(0, 8), writeU16BE(this.cid), this.deviceProperties);
    return encodeTransport(0x41, BROADCAST_CID, payload);
  }

  private reply(frame: ThpFrame, ctrl: number, payload: Uint8Array, next?: ChannelPhase): Uint8Array {
    if (next) {
      this.phase = next;
    }
    const ack = encodeAck(frame.cid, seqBit(frame.ctrl));
    const data = encodeTransport(withSeq(ctrl, this.sendSeq), frame.cid, payload);
    this.sendSeq ^= 1;
    this.lastData = data;
    return concatBytes(ack, data);
  }

  private async dispatchApp(sessionId: number, type: number, payload: Uint8Array): Promise<Uint8Array | null> {
    switch (type) {
      case MessageType.ThpPairingRequest:
        return this.handlePairingRequest(sessionId, payload);
      case MessageType.ThpSelectMethod:
        return this.handleSelectMethod(sessionId, payload);
      case MessageType.ThpCodeEntryChallenge:
        return this.handleCodeEntryChallenge(sessionId, payload);
      case MessageType.ThpCodeEntryCpaceHostTag:
        return this.handleCodeEntryHostTag(sessionId, payload);
      case MessageType.ThpCredentialRequest:
        return this.handleCredentialRequest(sessionId, payload);
      case MessageType.ThpEndRequest:
        return this.handleEnd(sessionId);
      case MessageType.ThpCreateNewSession:
        return this.handleCreateSession(sessionId, payload);
      case MessageType.Initialize:
      case MessageType.GetFeatures:
        this.pending = undefined;
        return encodeL4(sessionId, MessageType.Features, encodeFeatures(this.featuresInput()));
      case MessageType.Ping:
        return encodeL4(sessionId, MessageType.Success, encodeSuccess());
      case MessageType.Cancel:
        this.pending = undefined;
        this.setPairingCode(null);
        return encodeL4(
          sessionId,
          MessageType.Failure,
          encodeFailure(FailureType.ActionCancelled, 'Cancelled'),
        );
      case MessageType.ButtonAck:
        return this.finishPending(sessionId);
      case MessageType.EthereumGetAddress:
        return this.handleEthGetAddress(sessionId, payload);
      case MessageType.EthereumSignMessage:
        return this.handleEthSignMessage(sessionId, payload);
      default:
        break;
    }
    if (isEthSignTx(type)) {
      return encodeL4(
        sessionId,
        MessageType.Failure,
        encodeFailure(FailureType.UnexpectedMessage, 'Unsupported'),
      );
    }
    return encodeL4(
      sessionId,
      MessageType.Failure,
      encodeFailure(FailureType.UnexpectedMessage, `Unsupported message ${type}`),
    );
  }

  private async handlePairingRequest(sessionId: number, payload: Uint8Array): Promise<Uint8Array> {
    const request = decodePairingRequest(payload);
    if (!request.hostName || !request.appName) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing host_name'));
    }
    const ok = await this.confirmation.confirm({
      brand: 'trezor',
      path: 'pairing',
      message: `${request.appName} on ${request.hostName} wants to pair`,
      rawPayload: payload,
    });
    if (!ok) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.ActionCancelled, 'Cancelled'));
    }
    this.hostName = request.hostName;
    this.appName = request.appName;
    this.phase = 'tp1';
    return encodeL4(sessionId, MessageType.ThpPairingRequestApproved, new Uint8Array());
  }

  private handleSelectMethod(sessionId: number, payload: Uint8Array): Uint8Array {
    const method = decodeSelectMethod(payload);
    if (method !== ThpPairingMethod.CodeEntry) {
      return encodeL4(
        sessionId,
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Code Entry required'),
      );
    }
    this.codeEntrySecret = asBytes(generateCodeEntrySecret());
    this.phase = 'tp1';
    return encodeL4(
      sessionId,
      MessageType.ThpCodeEntryCommitment,
      encodeCodeEntryCommitment(codeEntryCommitment(this.codeEntrySecret)),
    );
  }

  private handleCodeEntryChallenge(sessionId: number, payload: Uint8Array): Uint8Array {
    const challenge = decodeCodeEntryChallenge(payload);
    if (challenge.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid challenge'));
    }
    const code = formatPairingCode(codeEntryCode(this.noise.handshakeHash, this.codeEntrySecret, challenge));
    this.setPairingCode(code);
    this.cpace = new Cpace(this.noise.handshakeHash);
    this.cpace.generateKeys(code);
    this.phase = 'tp3';
    return encodeL4(
      sessionId,
      MessageType.ThpCodeEntryCpaceTrezor,
      encodeCodeEntryCpaceTrezor(this.cpace.publicKey),
    );
  }

  private handleCodeEntryHostTag(sessionId: number, payload: Uint8Array): Uint8Array {
    const host = decodeCodeEntryCpaceHostTag(payload);
    if (!this.cpace || host.publicKey.length !== 32) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid CPace'));
    }
    try {
      this.cpace.computeSharedSecret(host.publicKey);
    } catch {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid CPace'));
    }
    if (!equalBytes(this.cpace.hostTag(), host.tag)) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Unexpected Code Entry Tag'));
    }
    this.phase = 'tc1';
    return encodeL4(sessionId, MessageType.ThpCodeEntrySecret, encodeCodeEntrySecret(this.codeEntrySecret));
  }

  private handleCredentialRequest(sessionId: number, payload: Uint8Array): Uint8Array {
    const request = decodeCredentialRequest(payload);
    const hostStatic = request.hostStaticPublicKey.length ? request.hostStaticPublicKey : this.hostStatic;
    const meta: CredentialMetadata = {
      hostName: this.hostName || 'host',
      appName: this.appName || 'app',
      autoconnect: false,
    };
    const credential = issueCredential(this.credAuthKey, hostStatic, meta);
    return encodeL4(
      sessionId,
      MessageType.ThpCredentialResponse,
      encodeCredentialResponse(this.noise.staticPublicKey, credential),
    );
  }

  private handleEnd(sessionId: number): Uint8Array {
    this.phase = 'encrypted';
    this.setPairingCode(null);
    return encodeL4(sessionId, MessageType.ThpEndResponse, new Uint8Array());
  }

  private async handleCreateSession(sessionId: number, payload: Uint8Array): Promise<Uint8Array> {
    const decoded = decodeCreateNewSession(payload);
    const passphrase =
      decoded.passphrase ?? (await this.confirmation.getPassphrase(this.slotId)) ?? this.sessions.get(sessionId) ?? '';
    const id = this.nextSessionId;
    this.nextSessionId += 1;
    this.sessions.set(id, passphrase);
    return encodeL4(id, MessageType.Success, encodeSuccess());
  }

  private handleEthGetAddress(sessionId: number, payload: Uint8Array): Uint8Array {
    let decoded;
    try {
      decoded = decodeEthereumGetAddress(payload);
    } catch {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid EthereumGetAddress'));
    }
    if (decoded.addressN.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'eth-address',
      sessionId,
      path: pathToString(decoded.addressN),
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.Address));
  }

  private handleEthSignMessage(sessionId: number, payload: Uint8Array): Uint8Array {
    let decoded;
    try {
      decoded = decodeEthereumSignMessage(payload);
    } catch {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid EthereumSignMessage'));
    }
    if (decoded.addressN.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'eth-sign',
      sessionId,
      path: pathToString(decoded.addressN),
      message: decoded.message,
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
  }

  private async finishPending(sessionId: number): Promise<Uint8Array> {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) {
      return encodeL4(
        sessionId,
        MessageType.Failure,
        encodeFailure(FailureType.UnexpectedMessage, 'No pending request'),
      );
    }
    const request: SigningRequest = {
      brand: 'trezor',
      path: pending.path,
      message: pending.kind === 'eth-sign' ? previewMessage(pending.message) : `Export ${pending.path}`,
      rawPayload: pending.rawPayload,
    };
    const ok = await this.confirmation.confirm(request);
    if (!ok) {
      return encodeL4(
        pending.sessionId,
        MessageType.Failure,
        encodeFailure(FailureType.ActionCancelled, 'Cancelled'),
      );
    }
    const passphrase =
      (await this.confirmation.getPassphrase(this.slotId)) ?? this.sessions.get(pending.sessionId) ?? '';
    const privateKey = derivePrivateKey(this.entropy, pending.path, passphrase, this.backup);
    const address = ethereumAddressFromPrivateKey(privateKey);
    if (pending.kind === 'eth-address') {
      return encodeL4(pending.sessionId, MessageType.EthereumAddress, encodeEthereumAddress(address));
    }
    const signature = signPersonalMessage(privateKey, pending.message);
    return encodeL4(
      pending.sessionId,
      MessageType.EthereumMessageSignature,
      encodeEthereumMessageSignature(signature, address),
    );
  }

  private featuresInput() {
    return {
      vendor: 'trezor.io',
      major: 2,
      minor: 9,
      patch: 0,
      deviceId: this.serial,
      label: 'YSK Simulator',
      model: this.model.name.replace(/^Trezor /, ''),
      internalModel: INTERNAL_MODEL,
      sessionId: sha256(encodeUtf8(this.slotId)).subarray(0, 32),
    };
  }

  private setPairingCode(code: string | null): void {
    this.confirmation.onPairingCode?.(code);
  }
}

function previewMessage(message: Uint8Array): string {
  try {
    return new TextDecoder().decode(message);
  } catch {
    return bytesToHex(message);
  }
}
