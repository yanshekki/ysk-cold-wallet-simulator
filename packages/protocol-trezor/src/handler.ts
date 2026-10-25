import type {
  BackupKind,
  Brand,
  ChainPathId,
  ConfirmationPort,
  DeviceModel,
  ProtocolHandler,
  SigningRequest,
} from '@cws/contracts';
import { TREZOR_FIRMWARE, describeEthMessage } from '@cws/contracts';
import {
  bitcoinP2pkh,
  deriveEd25519PrivateKey,
  deriveEd25519PrivateKeyFromSeed,
  deriveHdNode,
  deriveHdNodeFromSeed,
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
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { COIN_BY_REQUEST, icarusAddress, type CoinOp } from './coins';
import {
  asBytes,
  bytesToHex,
  concatBytes,
  encodeUtf8,
  equalBytes,
  randomBytes,
  readU16BE,
  setRandomBytesImpl,
  writeU16BE,
  type ByteRng,
} from './bytes';
import {
  derivePrivateKey,
  ethereumAddressFromPrivateKey,
  pathToString,
  signEip1559Tx,
  signLegacyTx,
  signPersonalMessage,
  signTypedHash,
} from './crypto';
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
  decodeEthereumSignTx,
  decodeEthereumSignTxEip1559,
  decodeEthereumSignTypedHash,
  decodePathBytes,
  decodePairingRequest,
  decodeSelectMethod,
  decodeTxAck,
  encodeButtonRequest,
  encodeBytesSignature,
  encodeCodeEntryCommitment,
  encodeCodeEntryCpaceTrezor,
  encodeCodeEntrySecret,
  encodeCredentialResponse,
  encodeDeviceProperties,
  encodeEthereumAddress,
  encodeEthereumMessageSignature,
  encodeEthereumTxRequest,
  encodeFailure,
  encodeFeatures,
  encodeMessageSignature,
  encodeStringAddress,
  encodeSuccess,
  encodeTypedDataSignature,
  encodeTxRequest,
  isEthSignTx,
  isEthSignTxEip1559,
  TxRequestType,
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
  rng?: ByteRng;
  onTrace?: (note: string) => void;
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
      kind: 'eth-address' | 'eth-pubkey';
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
    }
  | {
      kind: 'eth-tx';
      sessionId: number;
      path: string;
      tx: ReturnType<typeof decodeEthereumSignTx>;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'eth-tx-1559';
      sessionId: number;
      path: string;
      tx: ReturnType<typeof decodeEthereumSignTxEip1559>;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'eth-712';
      sessionId: number;
      path: string;
      domain: Uint8Array;
      structHash: Uint8Array;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'btc-address' | 'btc-pubkey' | 'btc-sign-msg';
      sessionId: number;
      path: string;
      message?: Uint8Array;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'btc-tx';
      sessionId: number;
      path: string;
      prevout: Uint8Array;
      amount: bigint;
      outputAmount: bigint;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'coin';
      sessionId: number;
      op: CoinOp;
      path: string;
      payload: Uint8Array;
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
  private readonly credAuthKey: Uint8Array;
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
  private readonly onTrace?: (note: string) => void;
  private readonly seedCache: SeedCache = {};

  constructor(options: TrezorHandlerOptions) {
    if (options.rng) {
      setRandomBytesImpl(options.rng);
    }
    this.model = options.model;
    this.confirmation = options.confirmation;
    this.slotId = options.slotId;
    this.entropy = options.entropy;
    this.backup = options.backup ?? 'bip39';
    this.mtu = clampMtu(options.mtu ?? DEFAULT_MTU);
    this.models = [options.model.id];
    this.credAuthKey = randomBytes(32);
    this.noise = new ThpNoiseResponder(this.deviceProperties, this.credAuthKey);
    this.serial = bytesToHex(keccak_256(encodeUtf8(`cws:${options.slotId}:${options.model.id}`)).subarray(0, 12));
    this.sessions.set(0, '');
    this.onTrace = options.onTrace;
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

  replaceSeed(seed: Uint8Array, icarusRoot?: Uint8Array): void {
    replaceSeedCache(this.seedCache, seed, icarusRoot);
  }

  private port(): ConfirmationPort {
    return wrapSeedPort(this.confirmation, this.seedCache);
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
        this.onTrace?.('noise start');
        return this.reply(frame, CTRL_HANDSHAKE_INIT_RESPONSE, this.noise.handshakeInit(frame.payload), 'th2');
      }
      if (isHandshakeComplete(frame.ctrl)) {
        const result = this.noise.handshakeComplete(frame.payload);
        this.hostStatic = asBytes(result.hostStatic);
        this.phase = result.state === TREZOR_STATE_UNPAIRED ? 'tp0' : 'tc1';
        this.onTrace?.('noise complete');
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
      this.onTrace?.('noise fail');
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
      case MessageType.EthereumGetPublicKey:
        return this.handleEthGetPublicKey(sessionId, payload);
      case MessageType.GetAddress:
        return this.handleBtcGetAddress(sessionId, payload);
      case MessageType.GetPublicKey:
        return this.handleBtcGetPublicKey(sessionId, payload);
      case MessageType.SignMessage:
        return this.handleBtcSignMessage(sessionId, payload);
      case MessageType.SignTx:
        return this.handleBtcSignTx(sessionId, payload);
      case MessageType.TxAck:
        return this.handleTxAck(sessionId, payload);
      default:
        break;
    }
    if (isEthSignTx(type)) {
      return this.handleEthSignTx(sessionId, payload);
    }
    if (isEthSignTxEip1559(type)) {
      return this.handleEthSignTxEip1559(sessionId, payload);
    }
    if (type === MessageType.EthereumSignTypedHash) {
      return this.handleEthSignTypedHash(sessionId, payload);
    }
    const coin = COIN_BY_REQUEST.get(type);
    if (coin) {
      return this.handleCoin(sessionId, coin, payload);
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
      kind: 'pairing',
      title: 'Pair with host',
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
    this.onTrace?.('session create');
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
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
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
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
      message: decoded.message,
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
  }

  private handleEthGetPublicKey(sessionId: number, payload: Uint8Array): Uint8Array {
    const decoded = decodeEthereumGetAddress(payload);
    if (decoded.addressN.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'eth-pubkey',
      sessionId,
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.Address));
  }

  private handleEthSignTx(sessionId: number, payload: Uint8Array): Uint8Array {
    const decoded = decodeEthereumSignTx(payload);
    if (decoded.addressN.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'eth-tx',
      sessionId,
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
      tx: decoded,
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.SignTx));
  }

  private handleEthSignTxEip1559(sessionId: number, payload: Uint8Array): Uint8Array {
    const decoded = decodeEthereumSignTxEip1559(payload);
    if (decoded.addressN.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'eth-tx-1559',
      sessionId,
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
      tx: decoded,
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.SignTx));
  }

  private handleEthSignTypedHash(sessionId: number, payload: Uint8Array): Uint8Array {
    const decoded = decodeEthereumSignTypedHash(payload);
    if (decoded.addressN.length === 0 || decoded.domain.length < 32 || decoded.structHash.length < 32) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid EthereumSignTypedHash'));
    }
    this.pending = {
      kind: 'eth-712',
      sessionId,
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
      domain: decoded.domain.subarray(0, 32),
      structHash: decoded.structHash.subarray(0, 32),
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
  }

  private handleBtcGetAddress(sessionId: number, payload: Uint8Array): Uint8Array {
    const decoded = decodePathBytes(payload);
    if (decoded.addressN.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'btc-address',
      sessionId,
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), [
        'btc-legacy',
        'btc-nested',
        'btc-native',
        'btc-taproot',
      ]),
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.Address));
  }

  private handleBtcGetPublicKey(sessionId: number, payload: Uint8Array): Uint8Array {
    const decoded = decodePathBytes(payload);
    if (decoded.addressN.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'btc-pubkey',
      sessionId,
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), [
        'btc-legacy',
        'btc-nested',
        'btc-native',
        'btc-taproot',
      ]),
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.Address));
  }

  private handleBtcSignMessage(sessionId: number, payload: Uint8Array): Uint8Array {
    const decoded = decodePathBytes(payload, 2);
    if (decoded.addressN.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    this.pending = {
      kind: 'btc-sign-msg',
      sessionId,
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), [
        'btc-legacy',
        'btc-nested',
        'btc-native',
        'btc-taproot',
      ]),
      message: decoded.payload,
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
  }

  private handleBtcSignTx(sessionId: number, payload: Uint8Array): Uint8Array {
    this.pending = {
      kind: 'btc-tx',
      sessionId,
      path: "m/84'/0'/0'/0/0",
      prevout: new Uint8Array(36),
      amount: 0n,
      outputAmount: 0n,
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.TxRequest, encodeTxRequest(TxRequestType.TXINPUT, 0));
  }

  private handleTxAck(sessionId: number, payload: Uint8Array): Uint8Array {
    const pending = this.pending;
    if (!pending || pending.kind !== 'btc-tx') {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No SignTx'));
    }
    const ack = decodeTxAck(payload);
    if (ack.addressN.length) {
      pending.path = overlayPath(this.confirmation, pathToString(ack.addressN), [
        'btc-legacy',
        'btc-nested',
        'btc-native',
        'btc-taproot',
      ]);
    }
    if (ack.prevHash.length) {
      pending.prevout = ack.prevHash;
      pending.amount = ack.amount;
      return encodeL4(sessionId, MessageType.TxRequest, encodeTxRequest(TxRequestType.TXOUTPUT, 0));
    }
    pending.outputAmount = ack.outputAmount;
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.SignTx));
  }

  private handleCoin(sessionId: number, op: CoinOp, payload: Uint8Array): Uint8Array {
    const decoded = decodePathBytes(payload, op.kind === 'sign' ? 2 : 99);
    if (decoded.addressN.length === 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Missing BIP32 path'));
    }
    const path = overlayPath(this.confirmation, pathToString(decoded.addressN), op.chains);
    this.pending = { kind: 'coin', sessionId, op, path, payload: decoded.payload, rawPayload: payload };
    return encodeL4(
      sessionId,
      MessageType.ButtonRequest,
      encodeButtonRequest(op.kind === 'sign' ? ButtonRequestType.SignTx : ButtonRequestType.Address),
    );
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
    const signing = isSignPending(pending);
    const request: SigningRequest = {
      brand: 'trezor',
      kind: signing ? 'sign' : 'address',
      title: pendingTitle(pending),
      path: pending.path,
      message: pendingMessage(pending),
      rawPayload: pending.rawPayload,
      detail: pending.kind === 'eth-sign' ? describeEthMessage(pending.path, pending.message) : undefined,
    };
    const ok = await this.confirmation.confirm(request);
    if (!ok) {
      return encodeL4(
        pending.sessionId,
        MessageType.Failure,
        encodeFailure(FailureType.ActionCancelled, 'Cancelled'),
      );
    }
    const overlay =
      (await this.confirmation.getPassphrase(this.slotId)) ?? this.sessions.get(pending.sessionId) ?? '';
    const seed = overlay ? undefined : await seedFor(this.port(), this.slotId, this.entropy, this.backup);
    const icarusRoot = overlay
      ? undefined
      : await icarusRootFor(this.port(), this.slotId, this.entropy, this.backup);
    const secp = (path: string) =>
      seed ? derivePrivateKeyFromSeed(seed, path) : derivePrivateKey(this.entropy, path, overlay, this.backup);
    const hd = (path: string) =>
      seed ? deriveHdNodeFromSeed(seed, path) : deriveHdNode(this.entropy, path, overlay, this.backup);
    if (pending.kind === 'eth-address' || pending.kind === 'eth-pubkey') {
      const privateKey = secp(pending.path);
      if (pending.kind === 'eth-pubkey') {
        return encodeL4(pending.sessionId, MessageType.EthereumPublicKey, encodeBytesSignature(publicKeyCompressed(privateKey)));
      }
      return encodeL4(
        pending.sessionId,
        MessageType.EthereumAddress,
        encodeEthereumAddress(ethereumAddressFromPrivateKey(privateKey)),
      );
    }
    if (pending.kind === 'eth-sign') {
      const privateKey = secp(pending.path);
      const address = ethereumAddressFromPrivateKey(privateKey);
      return encodeL4(
        pending.sessionId,
        MessageType.EthereumMessageSignature,
        encodeEthereumMessageSignature(signPersonalMessage(privateKey, pending.message), address),
      );
    }
    if (pending.kind === 'eth-tx') {
      const signature = signLegacyTx(secp(pending.path), pending.tx);
      return encodeL4(pending.sessionId, MessageType.EthereumTxRequest, encodeEthereumTxRequest(signature));
    }
    if (pending.kind === 'eth-tx-1559') {
      const signature = signEip1559Tx(secp(pending.path), pending.tx);
      return encodeL4(pending.sessionId, MessageType.EthereumTxRequest, encodeEthereumTxRequest(signature));
    }
    if (pending.kind === 'eth-712') {
      const privateKey = secp(pending.path);
      const address = ethereumAddressFromPrivateKey(privateKey);
      return encodeL4(
        pending.sessionId,
        MessageType.EthereumTypedDataSignature,
        encodeTypedDataSignature(signTypedHash(privateKey, pending.domain, pending.structHash), address),
      );
    }
    if (pending.kind === 'btc-address') {
      const node = hd(pending.path);
      return encodeL4(pending.sessionId, MessageType.Address, encodeStringAddress(bitcoinP2pkh(node.publicKey)));
    }
    if (pending.kind === 'btc-pubkey') {
      const node = hd(pending.path);
      return encodeL4(pending.sessionId, MessageType.PublicKey, encodeBytesSignature(node.publicKey));
    }
    if (pending.kind === 'btc-sign-msg') {
      const privateKey = secp(pending.path);
      const message = pending.message ?? new Uint8Array();
      const prefix = encodeUtf8('\x18Bitcoin Signed Message:\n');
      const compact =
        message.length < 0xfd
          ? Uint8Array.of(message.length)
          : concatBytes(Uint8Array.of(0xfd, message.length & 0xff, message.length >> 8));
      const hash = sha256(sha256(concatBytes(prefix, compact, message)));
      const sig = signSecp256k1Recoverable(privateKey, hash);
      const node = hd(pending.path);
      return encodeL4(
        pending.sessionId,
        MessageType.MessageSignature,
        encodeMessageSignature(bitcoinP2pkh(node.publicKey), concatBytes(Uint8Array.of((sig[64] ?? 0) + 27), sig.subarray(0, 64))),
      );
    }
    if (pending.kind === 'btc-tx') {
      const privateKey = secp(pending.path);
      const hash = sha256(sha256(concatBytes(pending.prevout, u64le(pending.amount), u64le(pending.outputAmount))));
      const sig = signSecp256k1Recoverable(privateKey, hash).subarray(0, 64);
      return encodeL4(pending.sessionId, MessageType.TxRequest, encodeTxRequest(TxRequestType.TXFINISHED, 0, sig));
    }
    if (pending.kind === 'coin') {
      return this.coinFinish(pending, overlay, seed, icarusRoot);
    }
    return encodeL4(pending.sessionId, MessageType.Failure, encodeFailure(FailureType.ProcessError, 'Unknown pending'));
  }

  private coinFinish(
    pending: Extract<PendingAction, { kind: 'coin' }>,
    overlay: string,
    seed: Uint8Array | undefined,
    icarusRoot: Uint8Array | undefined,
  ): Uint8Array {
    const op = pending.op;
    const ed = (path: string) =>
      seed
        ? deriveEd25519PrivateKeyFromSeed(seed, path)
        : deriveEd25519PrivateKey(this.entropy, path, overlay, this.backup);
    const secp = (path: string) =>
      seed ? derivePrivateKeyFromSeed(seed, path) : derivePrivateKey(this.entropy, path, overlay, this.backup);
    if (op.kind === 'address' || op.kind === 'pubkey') {
      if (op.curve === 'icarus') {
        const address = icarusAddress(this.entropy, pending.path, overlay || undefined, this.backup, icarusRoot);
        return encodeL4(pending.sessionId, op.reply, encodeStringAddress(address));
      }
      if (op.curve === 'ed25519') {
        const pub = ed25519PublicKey(ed(pending.path));
        if (op.kind === 'pubkey') {
          return encodeL4(pending.sessionId, op.reply, encodeBytesSignature(pub));
        }
        return encodeL4(pending.sessionId, op.reply, encodeStringAddress(op.addressOf?.(pub) ?? bytesToHex(pub)));
      }
      const pub = publicKeyCompressed(secp(pending.path));
      return encodeL4(pending.sessionId, op.reply, encodeStringAddress(op.addressOf?.(pub) ?? bytesToHex(pub)));
    }
    if (op.curve === 'ed25519') {
      const sig = signEd25519(ed(pending.path), pending.payload);
      return encodeL4(pending.sessionId, op.reply, encodeBytesSignature(sig));
    }
    if (op.curve === 'icarus') {
      const node = icarusRoot
        ? deriveIcarusFromRoot(icarusRoot, pending.path)
        : deriveIcarus(this.entropy, pending.path, overlay, this.backup);
      const sig = signIcarus(node, pending.payload);
      return encodeL4(pending.sessionId, op.reply, encodeBytesSignature(sig));
    }
    const hash = pending.payload.length === 32 ? pending.payload : sha256(pending.payload);
    const sig = signSecp256k1Recoverable(secp(pending.path), hash);
    return encodeL4(pending.sessionId, op.reply, encodeBytesSignature(sig));
  }

  private featuresInput() {
    return {
      vendor: 'trezor.io',
      major: TREZOR_FIRMWARE.major,
      minor: TREZOR_FIRMWARE.minor,
      patch: TREZOR_FIRMWARE.patch,
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

function overlayPath(
  confirmation: ConfirmationPort,
  path: string,
  chains: readonly ChainPathId[],
): string {
  return confirmation.resolvePath?.(path, chains) ?? path;
}

function isSignPending(pending: PendingAction): boolean {
  return (
    pending.kind === 'eth-sign' ||
    pending.kind === 'eth-tx' ||
    pending.kind === 'eth-tx-1559' ||
    pending.kind === 'eth-712' ||
    pending.kind === 'btc-sign-msg' ||
    pending.kind === 'btc-tx' ||
    (pending.kind === 'coin' && pending.op.kind === 'sign')
  );
}

function pendingTitle(pending: PendingAction): string {
  if (pending.kind === 'coin') {
    return pending.op.title;
  }
  if (pending.kind === 'eth-tx' || pending.kind === 'eth-tx-1559' || pending.kind === 'btc-tx') {
    return 'Sign transaction';
  }
  if (pending.kind === 'eth-sign' || pending.kind === 'eth-712' || pending.kind === 'btc-sign-msg') {
    return 'Sign message';
  }
  return 'Export address';
}

function pendingMessage(pending: PendingAction): string {
  return `${pendingTitle(pending)}\n${pending.path}`;
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let n = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}
