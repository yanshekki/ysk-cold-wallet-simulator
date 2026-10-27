import {
  applyConfirmationPath,
  bleAdvertiseName,
  describeEthMessage,
  describeEthTransaction,
  formatVersion,
  onekeyFirmwareFor,
  type BackupKind,
  type Brand,
  type ChainPathId,
  type ConfirmationPort,
  type DeviceModel,
  type ProtocolHandler,
  type SigningDetail,
  type SigningRequest,
} from '@cws/contracts';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, concatBytes, encodeUtf8 } from './bytes';
import {
  deriveEd25519PrivateKeyFromSeed,
  deriveIcarus,
  deriveIcarusFromRoot,
  derivePrivateKeyFromSeed,
  ed25519PublicKey,
  icarusRootFor,
  publicKeyCompressed,
  replaceSeedCache,
  seedFor,
  signEd25519,
  signIcarus,
  signSecp256k1Recoverable,
  wrapSeedPort,
  type SeedCache,
} from '@cws/protocol-ledger';
import { hashTypedData, type Eip712TypedData } from '@cws/contracts';
import { signPsbtBytes } from '@cws/protocol-qr';
import { sha256 } from '@noble/hashes/sha2';
import { COIN_BY_REQUEST, COIN_OPS, icarusAddress, type CoinOp } from './coins';
import {
  bitcoinP2pkhAddress,
  deriveHdKeyFromSeed,
  ethereumAddressFromPrivateKey,
  pathToString,
  signEip1559Tx,
  signLegacyTx,
  signPersonalMessage,
  signTypedHash,
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
  decodeEthereumSignTxEip1559,
  decodeCardanoSignTxInit,
  decodeCardanoTxInput,
  decodeEthereumSignTypedData,
  decodeEthereumSignTypedHash,
  decodePathBytes,
  decodePing,
  decodeSESignMessage,
  encodeBitcoinAddress,
  decodeTypedStructAck,
  decodeTypedValueAck,
  encodeButtonRequest,
  encodeBytesSignature,
  encodeCardanoWitness,
  encodeEthereumAddress,
  encodeEthereumMessageSignature,
  encodeEthereumPublicKey,
  encodeEthereumTxRequest,
  encodeFailure,
  encodeFeatures,
  encodeHdPublicKey,
  encodeMessageSignature,
  encodeOnekeyFeatures,
  encodeDeviceInfo,
  encodeDeviceStatus,
  encodePassphraseState,
  encodeProtocolInfo,
  encodeStringAddress,
  encodeTypedDataSignature,
  encodeTypedStructRequest,
  encodeTypedValueRequest,
  encodeUnLockDeviceResponse,
  encodeSEMessageSignature,
  encodeSEPublicCert,
  encodeSuccess,
  encodeV2Failure,
  ethAddressReplyType,
  ethPublicKeyReplyType,
  ethSignReplyType,
  isEthGetAddress,
  isEthGetPublicKey,
  isEthSignMessage,
  isEthSignTx,
  isEthSignTxEip1559,
  isEthSignTypedData,
  isEthSignTypedHash,
  typedDataIds,
  type EthereumSignTxEip1559Msg,
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
      kind: 'eth-pubkey';
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
    }
  | {
      kind: 'eth-tx-1559';
      path: string;
      tx: EthereumSignTxEip1559Msg;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'eth-712';
      path: string;
      domain: Uint8Array;
      structHash: Uint8Array;
      replyType: number;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'btc-pubkey';
      path: string;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'btc-sign-msg';
      path: string;
      message: Uint8Array;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'btc-psbt';
      path: string;
      psbt: Uint8Array;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'coin';
      op: CoinOp;
      path: string;
      payload: Uint8Array;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'eth-712-stream';
      path: string;
      primaryType: string;
      types: Record<string, Array<{ name: string; type: string }>>;
      domain: Record<string, unknown>;
      message: Record<string, unknown>;
      phase: 'struct' | 'value' | 'confirm';
      structQueue: string[];
      requestedStruct?: string;
      valueQueue: Array<{ path: number[]; target: 'domain' | 'message'; field: string; type: string }>;
      requestedValue?: { path: number[]; target: 'domain' | 'message'; field: string; type: string };
      ids: ReturnType<typeof typedDataIds>;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'cardano-tx';
      path: string;
      payload: Uint8Array;
      inputsRemaining: number;
      outputsRemaining: number;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'cardano-done';
    };

const V2_FAILURE_PROCESS = 5;

const V2_SUPPORTED_MESSAGES = [
  ...new Set([
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
    MessageType.GetPublicKey,
    MessageType.PublicKey,
    MessageType.SignMessage,
    MessageType.MessageSignature,
    MessageType.SignPsbt,
    MessageType.SignedPsbt,
    MessageType.GetFeatures,
    MessageType.EthereumGetAddress,
    MessageType.EthereumAddress,
    MessageType.EthereumGetPublicKey,
    MessageType.EthereumPublicKey,
    MessageType.EthereumSignMessage,
    MessageType.EthereumMessageSignature,
    MessageType.EthereumSignTx,
    MessageType.EthereumTxRequest,
    MessageType.EthereumSignTxEIP1559,
    MessageType.EthereumSignTypedHash,
    MessageType.EthereumTypedDataSignature,
    MessageType.EthereumSignTypedData,
    MessageType.EthereumTypedDataStructRequest,
    MessageType.EthereumTypedDataStructAck,
    MessageType.EthereumTypedDataValueRequest,
    MessageType.EthereumTypedDataValueAck,
    MessageType.EthereumSignTypedDataOneKey,
    MessageType.EthereumTypedDataStructRequestOneKey,
    MessageType.EthereumTypedDataStructAckOneKey,
    MessageType.EthereumTypedDataValueRequestOneKey,
    MessageType.EthereumTypedDataValueAckOneKey,
    MessageType.EthereumTypedDataSignatureOneKey,
    MessageType.EndSession,
    MessageType.OnekeyGetFeatures,
    MessageType.OnekeyFeatures,
    MessageType.GetPassphraseState,
    MessageType.PassphraseState,
    MessageType.UnLockDevice,
    MessageType.UnLockDeviceResponse,
    MessageType.EthereumGetAddressOneKey,
    MessageType.EthereumAddressOneKey,
    MessageType.EthereumGetPublicKeyOneKey,
    MessageType.EthereumPublicKeyOneKey,
    MessageType.EthereumSignMessageOneKey,
    MessageType.EthereumMessageSignatureOneKey,
    MessageType.CardanoSignTxInit,
    MessageType.CardanoTxItemAck,
    MessageType.CardanoTxHostAck,
    MessageType.CardanoTxInput,
    MessageType.CardanoTxOutput,
    MessageType.CardanoTxWitnessResponse,
    MessageType.CardanoSignTxFinished,
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
    ...COIN_OPS.flatMap((op) => [op.request, op.reply]),
  ]),
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
  private readonly seedCache: SeedCache = {};

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

  replaceSeed(seed: Uint8Array, icarusRoot?: Uint8Array): void {
    replaceSeedCache(this.seedCache, seed, icarusRoot);
  }

  resetLink(): void {
    this.assembler.reset();
    this.v2Assembler.reset();
    this.pending = undefined;
    this.v2TxSeq = 1;
  }

  private port(): ConfirmationPort {
    return wrapSeedPort(this.confirmation, this.seedCache);
  }

  private async signingSeed(): Promise<Uint8Array> {
    return seedFor(this.port(), this.slotId, this.entropy, this.backup);
  }

  private async signingIcarusRoot(): Promise<Uint8Array | undefined> {
    return icarusRootFor(this.port(), this.slotId, this.entropy, this.backup);
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
      case MessageType.GetPassphraseState:
        return this.message(
          MessageType.PassphraseState,
          encodePassphraseState({ sessionId: this.sessionId }),
        );
      case MessageType.UnLockDevice:
        return this.message(MessageType.UnLockDeviceResponse, encodeUnLockDeviceResponse());
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
        if (this.pending?.kind === 'cardano-done') {
          this.pending = undefined;
          return this.message(MessageType.CardanoSignTxFinished, new Uint8Array());
        }
        return this.finishPending();
      case MessageType.GetAddress:
        return this.handleBitcoinGetAddress(payload);
      case MessageType.GetPublicKey:
        return this.handleBitcoinGetPublicKey(payload);
      case MessageType.SignMessage:
        return this.handleBitcoinSignMessage(payload);
      case MessageType.SignPsbt:
        return this.handleSignPsbt(payload);
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
    if (isEthGetPublicKey(type)) {
      return this.handleEthGetPublicKey(type, payload);
    }
    if (isEthSignMessage(type)) {
      return this.handleEthSignMessage(type, payload);
    }
    if (isEthSignTx(type)) {
      return this.handleEthSignTx(payload);
    }
    if (isEthSignTxEip1559(type)) {
      return this.handleEthSignTxEip1559(payload);
    }
    if (isEthSignTypedHash(type)) {
      return this.handleEthSignTypedHash(type, payload);
    }
    if (isEthSignTypedData(type)) {
      return this.handleEthSignTypedData(type, payload);
    }
    if (type === MessageType.EthereumTypedDataStructAck || type === MessageType.EthereumTypedDataStructAckOneKey) {
      return this.handleTypedStructAck(payload);
    }
    if (type === MessageType.EthereumTypedDataValueAck || type === MessageType.EthereumTypedDataValueAckOneKey) {
      return this.handleTypedValueAck(payload);
    }
    if (type === MessageType.CardanoSignTxInit) {
      return this.handleCardanoSignTxInit(payload);
    }
    if (type === MessageType.CardanoTxInput) {
      return this.handleCardanoTxInput(payload);
    }
    if (type === MessageType.CardanoTxOutput) {
      return this.handleCardanoTxOutput(payload);
    }
    if (
      type === MessageType.CardanoTxHostAck ||
      type === MessageType.CardanoTxItemAck ||
      type === MessageType.CardanoTxWitnessRequest
    ) {
      if (this.pending?.kind === 'cardano-done') {
        this.pending = undefined;
        return this.message(MessageType.CardanoSignTxFinished, new Uint8Array());
      }
      return this.message(MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No Cardano finish'));
    }
    const coin = COIN_BY_REQUEST.get(type);
    if (coin) {
      return this.handleCoin(coin, payload);
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

  private async handleEthGetPublicKey(type: number, payload: Uint8Array): Promise<EncodedMessage> {
    let decoded;
    try {
      decoded = decodeEthereumGetAddress(payload);
    } catch {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Invalid EthereumGetPublicKey'),
      );
    }
    if (decoded.addressN.length === 0) {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Missing BIP32 path'),
      );
    }
    const path = overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']);
    const replyType = ethPublicKeyReplyType(type);
    if (!decoded.showDisplay) {
      return this.ethPublicKeyReply(path, replyType);
    }
    this.pending = {
      kind: 'eth-pubkey',
      path,
      replyType,
      rawPayload: payload,
    };
    return this.message(
      MessageType.ButtonRequest,
      encodeButtonRequest(ButtonRequestType.Address),
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
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
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
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
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
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
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
    const path = overlayPath(this.confirmation, pathToString(decoded.addressN), [
      'btc-legacy',
      'btc-nested',
      'btc-native',
      'btc-taproot',
    ]);
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

  private async handleBitcoinGetPublicKey(payload: Uint8Array): Promise<EncodedMessage> {
    const decoded = decodePathBytes(payload);
    if (decoded.addressN.length === 0) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    const path = overlayPath(this.confirmation, pathToString(decoded.addressN), [
      'btc-legacy',
      'btc-nested',
      'btc-native',
      'btc-taproot',
    ]);
    if (!decoded.showDisplay) {
      return this.bitcoinPublicKeyReply(path);
    }
    this.pending = { kind: 'btc-pubkey', path, rawPayload: payload };
    return this.message(MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.Address));
  }

  private async handleBitcoinSignMessage(payload: Uint8Array): Promise<EncodedMessage> {
    const decoded = decodePathBytes(payload, 2);
    if (decoded.addressN.length === 0) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'btc-sign-msg',
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), [
        'btc-legacy',
        'btc-nested',
        'btc-native',
        'btc-taproot',
      ]),
      message: decoded.payload,
      rawPayload: payload,
    };
    return this.message(MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
  }

  private async handleSignPsbt(payload: Uint8Array): Promise<EncodedMessage> {
    const decoded = decodePathBytes(payload, 1);
    const psbt = looksLikePsbt(decoded.payload) ? decoded.payload : looksLikePsbt(payload) ? payload : decoded.payload;
    const path = looksLikePsbt(decoded.payload) || decoded.addressN.length === 0
      ? "m/84'/0'/0'/0/0"
      : pathToString(decoded.addressN);
    this.pending = {
      kind: 'btc-psbt',
      path: overlayPath(this.confirmation, path, ['btc-legacy', 'btc-nested', 'btc-native', 'btc-taproot']),
      psbt,
      rawPayload: payload,
    };
    return this.message(MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.SignTx));
  }

  private async handleEthSignTxEip1559(payload: Uint8Array): Promise<EncodedMessage> {
    let decoded;
    try {
      decoded = decodeEthereumSignTxEip1559(payload);
    } catch {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid EthereumSignTxEIP1559'));
    }
    if (decoded.addressN.length === 0) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'eth-tx-1559',
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
      tx: decoded,
      rawPayload: payload,
    };
    return this.message(MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.SignTx));
  }

  private async handleEthSignTypedHash(type: number, payload: Uint8Array): Promise<EncodedMessage> {
    const decoded = decodeEthereumSignTypedHash(payload);
    if (decoded.addressN.length === 0 || decoded.domain.length < 32 || decoded.structHash.length < 32) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid EthereumSignTypedHash'));
    }
    this.pending = {
      kind: 'eth-712',
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
      domain: decoded.domain.subarray(0, 32),
      structHash: decoded.structHash.subarray(0, 32),
      replyType:
        type === MessageType.EthereumSignTypedHashOneKey
          ? MessageType.EthereumTypedDataSignature
          : MessageType.EthereumTypedDataSignature,
      rawPayload: payload,
    };
    return this.message(MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
  }

  private handleEthSignTypedData(type: number, payload: Uint8Array): EncodedMessage {
    const decoded = decodeEthereumSignTypedData(payload);
    if (decoded.addressN.length === 0 || !decoded.primaryType) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid EthereumSignTypedData'));
    }
    const ids = typedDataIds(type);
    this.pending = {
      kind: 'eth-712-stream',
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
      primaryType: decoded.primaryType,
      types: {},
      domain: {},
      message: {},
      phase: 'struct',
      structQueue: decoded.primaryType === 'EIP712Domain' ? ['EIP712Domain'] : ['EIP712Domain', decoded.primaryType],
      valueQueue: [],
      ids,
      rawPayload: payload,
    };
    return this.nextTypedStruct();
  }

  private handleTypedStructAck(payload: Uint8Array): EncodedMessage {
    const pending = this.pending;
    if (!pending || pending.kind !== 'eth-712-stream' || pending.phase !== 'struct' || !pending.requestedStruct) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No struct request'));
    }
    pending.types[pending.requestedStruct] = decodeTypedStructAck(payload);
    pending.requestedStruct = undefined;
    if (pending.structQueue.length) {
      return this.nextTypedStruct();
    }
    pending.phase = 'value';
    pending.valueQueue = [
      ...(pending.types.EIP712Domain ?? []).map((field, index) => ({
        path: [0, index],
        target: 'domain' as const,
        field: field.name,
        type: field.type,
      })),
      ...(pending.types[pending.primaryType] ?? []).map((field, index) => ({
        path: [1, index],
        target: 'message' as const,
        field: field.name,
        type: field.type,
      })),
    ];
    return this.nextTypedValue();
  }

  private handleTypedValueAck(payload: Uint8Array): EncodedMessage {
    const pending = this.pending;
    if (!pending || pending.kind !== 'eth-712-stream' || pending.phase !== 'value' || !pending.requestedValue) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No value request'));
    }
    const raw = decodeTypedValueAck(payload);
    const target = pending.requestedValue.target === 'domain' ? pending.domain : pending.message;
    target[pending.requestedValue.field] = decodeTypedAtomic(pending.requestedValue.type, raw);
    pending.requestedValue = undefined;
    if (pending.valueQueue.length) {
      return this.nextTypedValue();
    }
    pending.phase = 'confirm';
    return this.message(MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
  }

  private nextTypedStruct(): EncodedMessage {
    const pending = this.pending;
    if (!pending || pending.kind !== 'eth-712-stream') {
      return this.message(MessageType.Failure, encodeFailure(FailureType.ProcessError, 'No typed data'));
    }
    const name = pending.structQueue.shift();
    if (!name) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Empty struct queue'));
    }
    pending.requestedStruct = name;
    return this.message(pending.ids.structRequest, encodeTypedStructRequest(name));
  }

  private nextTypedValue(): EncodedMessage {
    const pending = this.pending;
    if (!pending || pending.kind !== 'eth-712-stream') {
      return this.message(MessageType.Failure, encodeFailure(FailureType.ProcessError, 'No typed data'));
    }
    const next = pending.valueQueue.shift();
    if (!next) {
      pending.phase = 'confirm';
      return this.message(MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
    }
    pending.requestedValue = next;
    return this.message(pending.ids.valueRequest, encodeTypedValueRequest(next.path));
  }

  private handleCardanoSignTxInit(payload: Uint8Array): EncodedMessage {
    const decoded = decodeCardanoSignTxInit(payload);
    if (decoded.certificatesCount > 0 || decoded.mintCount > 0) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Unsupported Cardano extras'));
    }
    if (decoded.inputsCount < 1 || decoded.outputsCount < 1) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Need 1-in-1-out'));
    }
    const path = decoded.addressN.length
      ? overlayPath(this.confirmation, pathToString(decoded.addressN), ['ada'])
      : "m/1852'/1815'/0'/0/0";
    this.pending = {
      kind: 'cardano-tx',
      path,
      payload: decoded.body,
      inputsRemaining: decoded.inputsCount,
      outputsRemaining: decoded.outputsCount,
      rawPayload: payload,
    };
    return this.message(MessageType.CardanoTxItemAck, new Uint8Array());
  }

  private handleCardanoTxInput(payload: Uint8Array): EncodedMessage {
    const pending = this.pending;
    if (!pending || pending.kind !== 'cardano-tx' || pending.inputsRemaining <= 0) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No Cardano input'));
    }
    const decoded = decodeCardanoTxInput(payload);
    if (decoded.addressN.length) {
      pending.path = overlayPath(this.confirmation, pathToString(decoded.addressN), ['ada']);
    }
    pending.inputsRemaining -= 1;
    return this.message(MessageType.CardanoTxItemAck, new Uint8Array());
  }

  private handleCardanoTxOutput(_payload: Uint8Array): EncodedMessage {
    const pending = this.pending;
    if (!pending || pending.kind !== 'cardano-tx' || pending.inputsRemaining > 0 || pending.outputsRemaining <= 0) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No Cardano output'));
    }
    pending.outputsRemaining -= 1;
    if (pending.outputsRemaining > 0) {
      return this.message(MessageType.CardanoTxItemAck, new Uint8Array());
    }
    return this.message(MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.SignTx));
  }

  private async handleCoin(op: CoinOp, payload: Uint8Array): Promise<EncodedMessage> {
    const decoded = decodePathBytes(payload, op.kind === 'sign' ? (op.bytesField ?? 2) : 99);
    if (decoded.addressN.length === 0) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    const path = overlayPath(this.confirmation, pathToString(decoded.addressN), op.chains);
    if (op.kind === 'address' && !decoded.showDisplay) {
      return this.coinReply(op, path, decoded.payload);
    }
    this.pending = { kind: 'coin', op, path, payload: decoded.payload, rawPayload: payload };
    return this.message(
      MessageType.ButtonRequest,
      encodeButtonRequest(op.kind === 'sign' ? ButtonRequestType.SignTx : ButtonRequestType.Address),
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
    if (pending.kind === 'cardano-done') {
      return this.message(MessageType.CardanoSignTxFinished, new Uint8Array());
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
      rawPayload: pending.kind === 'eth-sign' ? pending.message : pending.rawPayload,
      detail: pendingDetail(pending),
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
    if (pending.kind === 'eth-pubkey') {
      return this.ethPublicKeyReply(pending.path, pending.replyType);
    }
    if (pending.kind === 'eth-sign') {
      return this.ethSignReply(pending.path, pending.message, pending.replyType);
    }
    if (pending.kind === 'eth-tx') {
      return this.ethTxReply(pending.path, pending.tx);
    }
    if (pending.kind === 'eth-tx-1559') {
      return this.ethTx1559Reply(pending.path, pending.tx);
    }
    if (pending.kind === 'eth-712') {
      return this.eth712Reply(pending.path, pending.domain, pending.structHash, pending.replyType);
    }
    if (pending.kind === 'eth-712-stream') {
      if (pending.phase !== 'confirm') {
        return this.message(MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'Typed data incomplete'));
      }
      const typed: Eip712TypedData = {
        types: pending.types,
        primaryType: pending.primaryType,
        domain: pending.domain,
        message: pending.message,
      };
      let digest: Uint8Array;
      try {
        digest = hashTypedData(typed);
      } catch {
        return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Bad typed data'));
      }
      const privateKey = derivePrivateKeyFromSeed(await this.signingSeed(), pending.path);
      const address = ethereumAddressFromPrivateKey(privateKey);
      const sig = signSecp256k1Recoverable(privateKey, digest);
      const v = (sig[64] ?? 0) + 27;
      return this.message(
        pending.ids.signature,
        encodeTypedDataSignature(concatBytes(sig.subarray(0, 64), Uint8Array.of(v)), address),
      );
    }
    if (pending.kind === 'cardano-tx') {
      const body = pending.payload.length ? pending.payload : sha256(pending.rawPayload);
      const overlay = (await this.confirmation.getPassphrase(this.slotId)) ?? '';
      const icarusRoot = overlay
        ? undefined
        : await icarusRootFor(this.port(), this.slotId, this.entropy, this.backup);
      const node = icarusRoot
        ? deriveIcarusFromRoot(icarusRoot, pending.path)
        : deriveIcarus(this.entropy, pending.path, overlay, this.backup);
      const sig = signIcarus(node, body);
      this.pending = { kind: 'cardano-done' };
      return this.message(MessageType.CardanoTxWitnessResponse, encodeCardanoWitness(node.publicKey, sig));
    }
    if (pending.kind === 'btc-pubkey') {
      return this.bitcoinPublicKeyReply(pending.path);
    }
    if (pending.kind === 'btc-sign-msg') {
      return this.bitcoinSignMessageReply(pending.path, pending.message);
    }
    if (pending.kind === 'btc-psbt') {
      return this.bitcoinPsbtReply(pending.path, pending.psbt);
    }
    if (pending.kind === 'coin') {
      return this.coinReply(pending.op, pending.path, pending.payload);
    }
    return this.bitcoinAddressReply(pending.path, pending.coinName);
  }

  private async ethPublicKeyReply(path: string, replyType: number): Promise<EncodedMessage> {
    const node = deriveHdKeyFromSeed(await this.signingSeed(), path);
    if (!node.publicKey || !node.chainCode) {
      return this.message(
        MessageType.Failure,
        encodeFailure(FailureType.ProcessError, 'Missing HD node'),
      );
    }
    return this.message(
      replyType,
      encodeEthereumPublicKey({
        depth: node.depth,
        fingerprint: node.parentFingerprint,
        childNum: node.index,
        chainCode: node.chainCode,
        publicKey: node.publicKey,
        xpub: node.publicExtendedKey,
      }),
    );
  }

  private async ethAddressReply(path: string, replyType: number): Promise<EncodedMessage> {
    const privateKey = derivePrivateKeyFromSeed(await this.signingSeed(), path);
    const address = ethereumAddressFromPrivateKey(privateKey);
    return this.message(replyType, encodeEthereumAddress(address));
  }

  private async ethSignReply(
    path: string,
    message: Uint8Array,
    replyType: number,
  ): Promise<EncodedMessage> {
    const privateKey = derivePrivateKeyFromSeed(await this.signingSeed(), path);
    const address = ethereumAddressFromPrivateKey(privateKey);
    const signature = signPersonalMessage(privateKey, message);
    return this.message(replyType, encodeEthereumMessageSignature(signature, address));
  }

  private async ethTxReply(
    path: string,
    tx: ReturnType<typeof decodeEthereumSignTx>,
  ): Promise<EncodedMessage> {
    const privateKey = derivePrivateKeyFromSeed(await this.signingSeed(), path);
    const signature = signLegacyTx(privateKey, tx);
    return this.message(MessageType.EthereumTxRequest, encodeEthereumTxRequest(signature));
  }

  private async bitcoinAddressReply(path: string, coinName: string): Promise<EncodedMessage> {
    const privateKey = derivePrivateKeyFromSeed(await this.signingSeed(), path);
    const testnet = /testnet|regtest/i.test(coinName);
    const address = bitcoinP2pkhAddress(privateKey, testnet);
    return this.message(MessageType.Address, encodeBitcoinAddress(address));
  }

  private async bitcoinPublicKeyReply(path: string): Promise<EncodedMessage> {
    const node = deriveHdKeyFromSeed(await this.signingSeed(), path);
    if (!node.publicKey || !node.chainCode) {
      return this.message(MessageType.Failure, encodeFailure(FailureType.ProcessError, 'Missing HD node'));
    }
    return this.message(
      MessageType.PublicKey,
      encodeHdPublicKey({
        depth: node.depth,
        fingerprint: node.parentFingerprint,
        childNum: node.index,
        chainCode: node.chainCode,
        publicKey: node.publicKey,
        xpub: node.publicExtendedKey,
      }),
    );
  }

  private async bitcoinSignMessageReply(path: string, message: Uint8Array): Promise<EncodedMessage> {
    const privateKey = derivePrivateKeyFromSeed(await this.signingSeed(), path);
    const prefix = encodeUtf8('\x18Bitcoin Signed Message:\n');
    const compact = message.length < 0xfd ? Uint8Array.of(message.length) : concatBytes(Uint8Array.of(0xfd, message.length & 0xff, message.length >> 8));
    const hash = sha256(sha256(concatBytes(prefix, compact, message)));
    const sig = signSecp256k1Recoverable(privateKey, hash);
    const address = bitcoinP2pkhAddress(privateKey, false);
    return this.message(MessageType.MessageSignature, encodeMessageSignature(address, concatBytes(Uint8Array.of((sig[64] ?? 0) + 27), sig.subarray(0, 64))));
  }

  private async bitcoinPsbtReply(_path: string, psbt: Uint8Array): Promise<EncodedMessage> {
    try {
      const signed = signPsbtBytes(await this.signingSeed(), psbt);
      return this.message(MessageType.SignedPsbt, encodeBytesSignature(signed.psbt));
    } catch {
      return this.message(MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid PSBT'));
    }
  }

  private async ethTx1559Reply(path: string, tx: EthereumSignTxEip1559Msg): Promise<EncodedMessage> {
    const privateKey = derivePrivateKeyFromSeed(await this.signingSeed(), path);
    const signature = signEip1559Tx(privateKey, tx);
    return this.message(MessageType.EthereumTxRequest, encodeEthereumTxRequest(signature));
  }

  private async eth712Reply(
    path: string,
    domain: Uint8Array,
    structHash: Uint8Array,
    replyType: number,
  ): Promise<EncodedMessage> {
    const privateKey = derivePrivateKeyFromSeed(await this.signingSeed(), path);
    const address = ethereumAddressFromPrivateKey(privateKey);
    const signature = signTypedHash(privateKey, domain, structHash);
    return this.message(replyType, encodeTypedDataSignature(signature, address));
  }

  private async coinReply(op: CoinOp, path: string, payload: Uint8Array): Promise<EncodedMessage> {
    const seed = await this.signingSeed();
    const icarusRoot = await this.signingIcarusRoot();
    if (op.kind === 'address') {
      if (op.curve === 'icarus') {
        return this.message(
          op.reply,
          encodeStringAddress(icarusAddress(this.entropy, path, undefined, this.backup, icarusRoot)),
        );
      }
      if (op.curve === 'ed25519') {
        const pub = ed25519PublicKey(deriveEd25519PrivateKeyFromSeed(seed, path));
        return this.message(op.reply, encodeStringAddress(op.addressOf?.(pub) ?? bytesToHex(pub)));
      }
      const pub = publicKeyCompressed(derivePrivateKeyFromSeed(seed, path));
      return this.message(op.reply, encodeStringAddress(op.addressOf?.(pub) ?? bytesToHex(pub)));
    }
    if (op.curve === 'ed25519') {
      const sig = signEd25519(deriveEd25519PrivateKeyFromSeed(seed, path), payload);
      return this.message(op.reply, encodeBytesSignature(sig));
    }
    if (op.curve === 'icarus') {
      const node = icarusRoot
        ? deriveIcarusFromRoot(icarusRoot, path)
        : deriveIcarus(this.entropy, path, undefined, this.backup);
      const sig = signIcarus(node, payload);
      return this.message(op.reply, encodeBytesSignature(sig));
    }
    const hash = payload.length === 32 ? payload : sha256(payload);
    const sig = signSecp256k1Recoverable(derivePrivateKeyFromSeed(seed, path), hash);
    return this.message(op.reply, encodeBytesSignature(sig));
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
  if (
    pending.kind === 'eth-sign' ||
    pending.kind === 'eth-tx' ||
    pending.kind === 'eth-tx-1559' ||
    pending.kind === 'eth-712' ||
    pending.kind === 'eth-712-stream' ||
    pending.kind === 'btc-sign-msg' ||
    pending.kind === 'btc-psbt' ||
    pending.kind === 'cardano-tx' ||
    (pending.kind === 'coin' && pending.op.kind === 'sign')
  ) {
    return 'sign';
  }
  if (pending.kind === 'verify') {
    return 'verify';
  }
  return 'address';
}

function pendingTitle(pending: PendingAction): string {
  if (pending.kind === 'eth-sign' || pending.kind === 'eth-712' || pending.kind === 'eth-712-stream' || pending.kind === 'btc-sign-msg') {
    return 'Sign message';
  }
  if (pending.kind === 'eth-tx' || pending.kind === 'eth-tx-1559' || pending.kind === 'btc-psbt' || pending.kind === 'cardano-tx') {
    return 'Sign transaction';
  }
  if (pending.kind === 'coin') {
    return pending.op.title;
  }
  if (pending.kind === 'btc-pubkey') {
    return 'Export Bitcoin public key';
  }
  if (pending.kind === 'btc-address') {
    return 'Export Bitcoin address';
  }
  if (pending.kind === 'eth-pubkey') {
    return 'Export Ethereum public key';
  }
  return 'Export Ethereum address';
}

function pendingDetail(pending: PendingAction): SigningDetail | undefined {
  if (pending.kind === 'eth-tx') {
    return describeEthTransaction({
      path: pending.path,
      type: 'legacy',
      chainId: pending.tx.chainId,
      nonce: pending.tx.nonce,
      gasPrice: pending.tx.gasPrice,
      gasLimit: pending.tx.gasLimit,
      to: pending.tx.to,
      value: pending.tx.value,
      data: pending.tx.data,
    });
  }
  if (pending.kind === 'eth-sign') {
    return describeEthMessage(pending.path, pending.message);
  }
  return undefined;
}

function previewPending(pending: PendingAction): string {
  if (pending.kind === 'eth-sign') {
    return `Sign personal message\n${pending.path}\n${previewMessage(pending.message)}`;
  }
  if (pending.kind === 'eth-tx' || pending.kind === 'eth-tx-1559') {
    return `Sign Ethereum transaction\n${pending.path}`;
  }
  if (pending.kind === 'eth-712') {
    return `Sign EIP-712 hashed message\n${pending.path}`;
  }
  if (pending.kind === 'eth-712-stream') {
    return `Sign EIP-712 typed data\n${pending.path}`;
  }
  if (pending.kind === 'cardano-tx') {
    return `Sign Cardano transaction\n${pending.path}`;
  }
  if (pending.kind === 'coin') {
    return `${pending.op.title}\n${pending.path}`;
  }
  if (pending.kind === 'btc-sign-msg' || pending.kind === 'btc-psbt' || pending.kind === 'btc-pubkey') {
    return `${pendingTitle(pending)}\n${pending.path}`;
  }
  if (pending.kind === 'btc-address') {
    return `Export Bitcoin address\n${pending.path}`;
  }
  if (pending.kind === 'verify') {
    return 'Confirm this device is genuine';
  }
  if (pending.kind === 'eth-pubkey') {
    return `Export Ethereum public key\n${pending.path}`;
  }
  if (pending.kind === 'cardano-done') {
    return 'Sign Cardano transaction';
  }
  return `Export Ethereum address\n${pending.path}`;
}

function looksLikePsbt(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x70 &&
    bytes[1] === 0x73 &&
    bytes[2] === 0x62 &&
    bytes[3] === 0x74 &&
    bytes[4] === 0xff
  );
}

function decodeTypedAtomic(type: string, raw: Uint8Array): unknown {
  if (type === 'string' || type.startsWith('string')) {
    return new TextDecoder().decode(raw);
  }
  if (type === 'address') {
    const addr = raw.length >= 20 ? raw.subarray(raw.length - 20) : raw;
    return `0x${Array.from(addr, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  if (type === 'bool') {
    return raw.some((byte) => byte !== 0);
  }
  return `0x${Array.from(raw, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function overlayPath(
  confirmation: ConfirmationPort,
  path: string,
  chains: readonly ChainPathId[],
): string {
  return applyConfirmationPath(confirmation.resolvePath, path, chains);
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
