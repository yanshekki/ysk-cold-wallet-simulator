import {
  bleAdvertiseName,
  formatVersion,
  onekeyFirmwareFor,
  type BackupKind,
  type Brand,
  type ConfirmationPort,
  type DeviceModel,
  type ProtocolHandler,
  type SigningRequest,
} from '@cws/contracts';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, concatBytes, encodeUtf8 } from './bytes';
import {
  bitcoinP2pkhAddress,
  derivePrivateKey,
  ethereumAddressFromPrivateKey,
  pathToString,
  signLegacyTx,
  signPersonalMessage,
} from './crypto';
import { V1Reassembler, frameV1 } from './framing';
import {
  ButtonRequestType,
  FailureType,
  MessageType,
  OneKeyDeviceType,
  decodeBitcoinGetAddress,
  decodeEthereumGetAddress,
  decodeEthereumSignMessage,
  decodeEthereumSignTx,
  decodePing,
  decodeSESignMessage,
  encodeBitcoinAddress,
  encodeButtonRequest,
  encodeEthereumAddress,
  encodeEthereumMessageSignature,
  encodeEthereumTxRequest,
  encodeFailure,
  encodeFeatures,
  encodeOnekeyFeatures,
  encodeDeviceInfo,
  encodeDeviceStatus,
  encodeProtocolInfo,
  encodeSEMessageSignature,
  encodeSEPublicCert,
  encodeSuccess,
  encodeV2Failure,
  ethAddressReplyType,
  ethSignReplyType,
  isEthGetAddress,
  isEthSignMessage,
  isEthSignTx,
  type FeaturesInput,
} from './messages';
import {
  PROTO_HEAD_SOF,
  PROTOCOL_V2_SYS_THRESHOLD,
  V2FrameAssembler,
  V2MessageType,
  decodeFrame,
  encodeAck,
  encodeProtobufFrame,
  isAckFrame,
  nextProtoSeq,
} from './v2';

export type OneKeyHandlerOptions = {
  model: DeviceModel;
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  mtu?: number;
};

type EncodedMessage = {
  type: number;
  payload: Uint8Array;
};

type PendingAction =
  | {
      kind: 'eth-address';
      path: string;
      replyType: number;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'eth-sign';
      path: string;
      message: Uint8Array;
      replyType: number;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'eth-tx';
      path: string;
      tx: ReturnType<typeof decodeEthereumSignTx>;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'btc-address';
      path: string;
      coinName: string;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'verify';
      path: string;
      challenge: Uint8Array;
      rawPayload: Uint8Array;
    };

const V2_FAILURE_PROCESS = 5;

const V2_SUPPORTED_MESSAGES = [
  MessageType.Initialize,
  MessageType.Ping,
  MessageType.Success,
  MessageType.Failure,
  MessageType.Features,
  MessageType.Cancel,
  MessageType.ButtonRequest,
  MessageType.ButtonAck,
  MessageType.GetAddress,
  MessageType.Address,
  MessageType.GetFeatures,
  MessageType.EthereumGetAddress,
  MessageType.EthereumAddress,
  MessageType.EthereumSignMessage,
  MessageType.EthereumMessageSignature,
  MessageType.EthereumSignTx,
  MessageType.EthereumTxRequest,
  MessageType.EndSession,
  MessageType.OnekeyGetFeatures,
  MessageType.OnekeyFeatures,
  MessageType.EthereumGetAddressOneKey,
  MessageType.EthereumAddressOneKey,
  MessageType.EthereumSignMessageOneKey,
  MessageType.EthereumMessageSignatureOneKey,
  V2MessageType.ProtocolInfoRequest,
  V2MessageType.ProtocolInfo,
  V2MessageType.Ping,
  V2MessageType.Success,
  V2MessageType.Failure,
  V2MessageType.DeviceInfoGet,
  V2MessageType.DeviceInfo,
  V2MessageType.DeviceStatusGet,
  V2MessageType.DeviceStatus,
  MessageType.ReadSEPublicCert,
  MessageType.SEPublicCert,
  MessageType.SESignMessage,
  MessageType.SEMessageSignature,
];

const DEVICE_TYPE: Record<string, number> = {
  classic: OneKeyDeviceType.Classic,
  classic1s: OneKeyDeviceType.Classic1s,
  pure: OneKeyDeviceType.Pure,
  touch: OneKeyDeviceType.Touch,
  pro: OneKeyDeviceType.Pro,
  pro2: OneKeyDeviceType.Pro2,
  neo: OneKeyDeviceType.Neo,
};

const SERIAL_PREFIX: Record<string, string> = {
  classic: 'cl',
  classic1s: 'c1',
  pure: 'pu',
  touch: 'tc',
  pro: 'pr',
  pro2: 'p2',
  neo: 'ne',
};

export class OneKeyV1ProtocolHandler implements ProtocolHandler {
  readonly brand: Brand = 'onekey';
  readonly models: string[];

  private readonly model: DeviceModel;
  private readonly confirmation: ConfirmationPort;
  private readonly slotId: string;
  private readonly entropy: Uint8Array;
  private readonly backup: BackupKind;
  private readonly assembler = new V1Reassembler();
  private readonly v2Assembler = new V2FrameAssembler();
  private readonly sessionId: Uint8Array;
  private readonly serial: string;
  private pending: PendingAction | undefined;
  private v2TxSeq = 1;

  constructor(options: OneKeyHandlerOptions) {
    this.model = options.model;
    this.confirmation = options.confirmation;
    this.slotId = options.slotId;
    this.entropy = options.entropy;
    this.backup = options.backup ?? 'bip39';
    this.models = [options.model.id];
    this.sessionId = keccak_256(encodeUtf8(`cws:${options.slotId}:${options.model.id}`));
    const prefix = SERIAL_PREFIX[options.model.id] ?? 'cl';
    this.serial = `${prefix}${bytesToHex(this.sessionId.subarray(0, 7))}`;
  }

  getServiceUUID(): string {
    return this.model.serviceUUID;
  }

  getCharacteristics(): { write: string; notify: string; writeCmd?: string } {
    return {
      write: this.model.writeCharUUID,
      notify: this.model.notifyCharUUID,
      writeCmd: this.model.writeCmdCharUUID,
    };
  }

  observeIncomingSize(size: number): void {
    void size;
  }

  async handleWrite(data: Uint8Array): Promise<Uint8Array | null> {
    this.observeIncomingSize(data.length);
    if (this.v2Assembler.buffered || data[0] === PROTO_HEAD_SOF) {
      this.assembler.reset();
      return this.handleV2Write(data);
    }
    let message;
    try {
      message = this.assembler.push(data);
    } catch {
      return frameV1(
        MessageType.Failure,
        encodeFailure(FailureType.ProcessError, 'Invalid framing'),
      );
    }
    if (!message) {
      return null;
    }
    const encoded = await this.dispatch(message.type, message.payload);
    return frameV1(encoded.type, encoded.payload);
  }

  private async handleV2Write(data: Uint8Array): Promise<Uint8Array | null> {
    let frames: Uint8Array[];
    try {
      frames = this.v2Assembler.drain(data);
    } catch {
      this.v2Assembler.reset();
      return null;
    }
    if (frames.length === 0) {
      return null;
    }
    const outgoing: Uint8Array[] = [];
    for (const frame of frames) {
      if (isAckFrame(frame)) {
        continue;
      }
      const decoded = decodeFrame(frame);
      const encoded = await this.dispatch(decoded.messageTypeId, decoded.pbPayload);
      outgoing.push(
        encodeAck(decoded.seq, decoded.packetSrc, decoded.router),
        encodeProtobufFrame(
          encoded.type,
          encoded.payload,
          decoded.packetSrc,
          decoded.router,
          this.takeV2Seq(),
        ),
      );
    }
    return outgoing.length > 0 ? concatBytes(...outgoing) : null;
  }

  private takeV2Seq(): number {
    const seq = this.v2TxSeq;
    this.v2TxSeq = nextProtoSeq(seq);
    return seq;
  }

  private async dispatch(type: number, payload: Uint8Array): Promise<EncodedMessage> {
    switch (type) {
      case MessageType.Initialize:
      case MessageType.GetFeatures:
        this.pending = undefined;
        return this.message(MessageType.Features, encodeFeatures(this.featuresInput()));
      case MessageType.OnekeyGetFeatures:
        return this.message(
          MessageType.OnekeyFeatures,
          encodeOnekeyFeatures(this.featuresInput()),
        );
      case MessageType.Ping:
      case V2MessageType.Ping: {
        const ping = decodePing(payload);
        const successType = type === V2MessageType.Ping ? V2MessageType.Success : MessageType.Success;
        return this.message(successType, encodeSuccess(ping.message));
      }
      case V2MessageType.ProtocolInfoRequest:
        return this.message(V2MessageType.ProtocolInfo, this.protocolInfoPayload());
      case V2MessageType.DeviceInfoGet:
        return this.message(V2MessageType.DeviceInfo, this.deviceInfoPayload());
      case V2MessageType.DeviceStatusGet:
        return this.message(
          V2MessageType.DeviceStatus,
          encodeDeviceStatus(bytesToHex(this.sessionId.subarray(0, 12))),
        );
      case MessageType.Cancel:
        this.pending = undefined;
        return this.message(
          MessageType.Failure,
          encodeFailure(FailureType.ActionCancelled, 'Cancelled'),
        );
      case MessageType.EndSession:
        this.pending = undefined;
        return this.message(MessageType.Success, encodeSuccess());
      case MessageType.ButtonAck:
        return this.finishPending();
      case MessageType.GetAddress:
        return this.handleBitcoinGetAddress(payload);
      case MessageType.SESignMessage:
        return this.handleSESignMessage(payload);
      case MessageType.ReadSEPublicCert:
        return this.message(MessageType.SEPublicCert, encodeSEPublicCert(this.sessionId));
      default:
        break;
    }

    if (isEthGetAddress(type)) {
      return this.handleEthGetAddress(type, payload);
    }
    if (isEthSignMessage(type)) {
      return this.handleEthSignMessage(type, payload);
    }
    if (isEthSignTx(type)) {
      return this.handleEthSignTx(payload);
    }

    if (type >= PROTOCOL_V2_SYS_THRESHOLD) {
      return this.message(
        V2MessageType.Failure,
        encodeV2Failure(V2_FAILURE_PROCESS, `Unsupported message ${type}`),
      );
    }

    return this.message(
      MessageType.Failure,
      encodeFailure(FailureType.UnexpectedMessage, `Unsupported message ${type}`),
    );
  }

  private async handleEthGetAddress(type: number, payload: Uint8Array): Promise<EncodedMessage> {
    let decoded;
    try {
      decoded = decodeEthereumGetAddress(payload);
    } catch {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Invalid EthereumGetAddress'),
      );
    }
    if (decoded.addressN.length === 0) {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Missing BIP32 path'),
      );
    }
    this.pending = {
      kind: 'eth-address',
      path: pathToString(decoded.addressN),
      replyType: ethAddressReplyType(type),
      rawPayload: payload,
    };
    return this.message(
      MessageType.ButtonRequest,
      encodeButtonRequest(ButtonRequestType.Address),
    );
  }

  private async handleEthSignTx(payload: Uint8Array): Promise<EncodedMessage> {
    let decoded;
    try {
      decoded = decodeEthereumSignTx(payload);
    } catch {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Invalid EthereumSignTx'),
      );
    }
    if (decoded.addressN.length === 0) {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Missing BIP32 path'),
      );
    }
    this.pending = {
      kind: 'eth-tx',
      path: pathToString(decoded.addressN),
      tx: decoded,
      rawPayload: payload,
    };
    return this.message(
      MessageType.ButtonRequest,
      encodeButtonRequest(ButtonRequestType.SignTx),
    );
  }

  private async handleSESignMessage(payload: Uint8Array): Promise<EncodedMessage> {
    const challenge = decodeSESignMessage(payload);
    const request: SigningRequest = {
      brand: 'onekey',
      kind: 'verify',
      title: 'Authenticity check',
      path: 'device',
      message: 'Confirm this device is genuine',
      rawPayload: payload,
    };
    const ok = await this.confirmation.confirm(request);
    if (!ok) {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.ActionCancelled, 'Cancelled'),
      );
    }
    this.pending = {
      kind: 'verify',
      path: 'device',
      challenge,
      rawPayload: payload,
    };
    return this.message(
      MessageType.ButtonRequest,
      encodeButtonRequest(ButtonRequestType.ProtectCall),
    );
  }

  private async handleEthSignMessage(type: number, payload: Uint8Array): Promise<EncodedMessage> {
    let decoded;
    try {
      decoded = decodeEthereumSignMessage(payload);
    } catch {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Invalid EthereumSignMessage'),
      );
    }
    if (decoded.addressN.length === 0) {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Missing BIP32 path'),
      );
    }
    this.pending = {
      kind: 'eth-sign',
      path: pathToString(decoded.addressN),
      message: decoded.message,
      replyType: ethSignReplyType(type),
      rawPayload: payload,
    };
    return this.message(
      MessageType.ButtonRequest,
      encodeButtonRequest(ButtonRequestType.ProtectCall),
    );
  }

  private async handleBitcoinGetAddress(payload: Uint8Array): Promise<EncodedMessage> {
    let decoded;
    try {
      decoded = decodeBitcoinGetAddress(payload);
    } catch {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Invalid GetAddress'),
      );
    }
    if (decoded.addressN.length === 0) {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Missing BIP32 path'),
      );
    }
    const path = pathToString(decoded.addressN);
    if (!decoded.showDisplay) {
      return this.bitcoinAddressReply(path, decoded.coinName);
    }
    this.pending = {
      kind: 'btc-address',
      path,
      coinName: decoded.coinName,
      rawPayload: payload,
    };
    return this.message(
      MessageType.ButtonRequest,
      encodeButtonRequest(ButtonRequestType.Address),
    );
  }

  private async finishPending(): Promise<EncodedMessage> {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.UnexpectedMessage, 'No pending request'),
      );
    }

    if (pending.kind === 'verify') {
      return this.message(
        MessageType.SEMessageSignature,
        encodeSEMessageSignature(keccak_256(pending.challenge)),
      );
    }

    const request: SigningRequest = {
      brand: 'onekey',
      kind: pendingKind(pending),
      title: pendingTitle(pending),
      path: pending.path,
      message: previewPending(pending),
      rawPayload: pending.rawPayload,
    };
    const ok = await this.confirmation.confirm(request);
    if (!ok) {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.ActionCancelled, 'Cancelled'),
      );
    }

    if (pending.kind === 'eth-address') {
      return this.ethAddressReply(pending.path, pending.replyType);
    }
    if (pending.kind === 'eth-sign') {
      return this.ethSignReply(pending.path, pending.message, pending.replyType);
    }
    if (pending.kind === 'eth-tx') {
      return this.ethTxReply(pending.path, pending.tx);
    }
    return this.bitcoinAddressReply(pending.path, pending.coinName);
  }

  private async ethAddressReply(path: string, replyType: number): Promise<EncodedMessage> {
    const passphrase = await this.confirmation.getPassphrase(this.slotId);
    const privateKey = derivePrivateKey(this.entropy, path, passphrase, this.backup);
    const address = ethereumAddressFromPrivateKey(privateKey);
    return this.message(replyType, encodeEthereumAddress(address));
  }

  private async ethSignReply(
    path: string,
    message: Uint8Array,
    replyType: number,
  ): Promise<EncodedMessage> {
    const passphrase = await this.confirmation.getPassphrase(this.slotId);
    const privateKey = derivePrivateKey(this.entropy, path, passphrase, this.backup);
    const address = ethereumAddressFromPrivateKey(privateKey);
    const signature = signPersonalMessage(privateKey, message);
    return this.message(replyType, encodeEthereumMessageSignature(signature, address));
  }

  private async ethTxReply(
    path: string,
    tx: ReturnType<typeof decodeEthereumSignTx>,
  ): Promise<EncodedMessage> {
    const passphrase = await this.confirmation.getPassphrase(this.slotId);
    const privateKey = derivePrivateKey(this.entropy, path, passphrase, this.backup);
    const signature = signLegacyTx(privateKey, tx);
    return this.message(MessageType.EthereumTxRequest, encodeEthereumTxRequest(signature));
  }

  private async bitcoinAddressReply(path: string, coinName: string): Promise<EncodedMessage> {
    const passphrase = await this.confirmation.getPassphrase(this.slotId);
    const privateKey = derivePrivateKey(this.entropy, path, passphrase, this.backup);
    const testnet = /testnet|regtest/i.test(coinName);
    const address = bitcoinP2pkhAddress(privateKey, testnet);
    return this.message(MessageType.Address, encodeBitcoinAddress(address));
  }

  private featuresInput(): FeaturesInput {
    const version = onekeyFirmwareFor(this.model.id);
    return {
      vendor: 'onekey.so',
      major: version.firmware[0],
      minor: version.firmware[1],
      patch: version.firmware[2],
      deviceId: bytesToHex(this.sessionId.subarray(0, 12)),
      label: 'YSK Simulator',
      model: this.model.id,
      serial: this.serial,
      bleName: bleAdvertiseName(this.model),
      onekeyVersion: formatVersion(version.firmware),
      bleVersion: formatVersion(version.ble),
      bootVersion: formatVersion(version.boot),
      boardVersion: formatVersion(version.board),
      seVersion: formatVersion(version.se),
      sessionId: this.sessionId,
      deviceType: DEVICE_TYPE[this.model.id] ?? OneKeyDeviceType.Classic,
    };
  }

  private protocolInfoPayload(): Uint8Array {
    const version = onekeyFirmwareFor(this.model.id);
    return encodeProtocolInfo({
      version: 1,
      buildFingerprint: `application__${formatVersion(version.firmware)}__cws0000__PROD__RELEASE`,
      supportedMessages: V2_SUPPORTED_MESSAGES,
    });
  }

  private deviceInfoPayload(): Uint8Array {
    const version = onekeyFirmwareFor(this.model.id);
    return encodeDeviceInfo({
      serial: this.serial,
      bleName: bleAdvertiseName(this.model),
      firmware: formatVersion(version.firmware),
      bleVersion: formatVersion(version.ble),
      bootVersion: formatVersion(version.boot),
      boardVersion: formatVersion(version.board),
      deviceType: DEVICE_TYPE[this.model.id] ?? OneKeyDeviceType.Classic,
    });
  }

  private message(type: number, payload: Uint8Array): EncodedMessage {
    return { type, payload };
  }
}

function pendingKind(pending: PendingAction): SigningRequest['kind'] {
  if (pending.kind === 'eth-sign' || pending.kind === 'eth-tx') {
    return 'sign';
  }
  if (pending.kind === 'verify') {
    return 'verify';
  }
  return 'address';
}

function pendingTitle(pending: PendingAction): string {
  if (pending.kind === 'eth-sign') {
    return 'Sign message';
  }
  if (pending.kind === 'eth-tx') {
    return 'Sign transaction';
  }
  if (pending.kind === 'btc-address') {
    return 'Export Bitcoin address';
  }
  return 'Export Ethereum address';
}

function previewPending(pending: PendingAction): string {
  if (pending.kind === 'eth-sign') {
    return `Sign personal message\n${pending.path}\n${previewMessage(pending.message)}`;
  }
  if (pending.kind === 'eth-tx') {
    return `Sign Ethereum transaction\n${pending.path}`;
  }
  if (pending.kind === 'btc-address') {
    return `Export Bitcoin address\n${pending.path}`;
  }
  if (pending.kind === 'verify') {
    return 'Confirm this device is genuine';
  }
  return `Export Ethereum address\n${pending.path}`;
}

function previewMessage(message: Uint8Array): string {
  try {
    const text = new TextDecoder().decode(message);
    if (/^[\x20-\x7e\s]+$/.test(text)) {
      return text.length > 180 ? `${text.slice(0, 180)}…` : text;
    }
  } catch {
    // binary payload
  }
  return `0x${bytesToHex(message).slice(0, 96)}`;
}
