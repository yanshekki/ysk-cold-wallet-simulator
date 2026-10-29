import type {
  BackupKind,
  Brand,
  ChainPathId,
  ConfirmationPort,
  DeviceModel,
  PassphraseSource,
  ProtocolHandler,
  SigningRequest,
} from '@cws/contracts';
import {
  TREZOR_FIRMWARE,
  applyConfirmationPath,
  describeEthMessage,
  describeEthTransaction,
  evmSignTitle,
  hashTypedData,
  resolveEvmNativeGas,
  type Eip712TypedData,
  type SigningDetail,
} from '@cws/contracts';
import {
  bip143Sighash,
  bitcoinP2pkh,
  deriveEd25519PrivateKey,
  deriveEd25519PrivateKeyFromSeed,
  deriveHdNode,
  deriveHdNodeFromSeed,
  deriveIcarus,
  deriveIcarusFromRoot,
  derivePrivateKeyFromSeed,
  ed25519PublicKey,
  hash160,
  icarusRootFor,
  p2wpkhScriptCode,
  publicKeyCompressed,
  replaceSeedCache,
  seedFor,
  signEd25519,
  signIcarus,
  signSecp256k1Recoverable,
  u32le,
  wrapSeedPort,
  type SeedCache,
} from '@cws/protocol-ledger';
import { bech32 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { schnorr } from '@noble/curves/secp256k1';
import { bip341Sighash, taprootOutputKey, type ParsedPsbt } from '@cws/protocol-qr';
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
  decodeCardanoSignTxInit,
  decodeCardanoTxInput,
  decodeEthereumSignTypedData,
  decodeEthereumSignTypedHash,
  decodePathBytes,
  decodePairingRequest,
  decodeSelectMethod,
  decodeSignTx,
  decodeTxAck,
  decodeTypedStructAck,
  decodeTypedValueAck,
  encodeButtonRequest,
  encodeBytesSignature,
  encodeCardanoWitness,
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
  encodeTypedStructRequest,
  encodeTypedValueRequest,
  encodeTxRequest,
  InputScriptType,
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
      inputsCount: number;
      outputsCount: number;
      version: number;
      lockTime: number;
      inputs: BtcTxInput[];
      outputs: BtcTxOutput[];
      rawPayload: Uint8Array;
    }
  | {
      kind: 'eth-712-stream';
      sessionId: number;
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
      rawPayload: Uint8Array;
    }
  | {
      kind: 'cardano-tx';
      sessionId: number;
      path: string;
      payload: Uint8Array;
      inputsRemaining: number;
      outputsRemaining: number;
      rawPayload: Uint8Array;
    }
  | {
      kind: 'cardano-done';
      sessionId: number;
    }
  | {
      kind: 'coin';
      sessionId: number;
      op: CoinOp;
      path: string;
      payload: Uint8Array;
      rawPayload: Uint8Array;
    };

type BtcTxInput = {
  path: string;
  prevout: Uint8Array;
  amount: bigint;
  sequence: number;
  scriptType: number;
};

type BtcTxOutput = {
  amount: bigint;
  script: Uint8Array;
  address: string;
  change: boolean;
  changePath?: string;
  outputScriptType?: number;
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

  resetLink(): void {
    this.assembler.reset();
    this.pending = undefined;
    this.phase = 'unallocated';
    this.cid = 0;
    this.expectedRecvSeq = 0;
    this.sendSeq = 0;
    this.lastData = undefined;
    this.hostName = '';
    this.appName = '';
    this.cpace = undefined;
    this.nextSessionId = 1;
    this.sessions.clear();
    this.sessions.set(0, '');
    this.setPairingCode(null);
    this.noise.resetHandshake();
  }

  private port(): ConfirmationPort {
    return wrapSeedPort(this.confirmation, this.seedCache);
  }

  private async resolveSigningMaterial(sessionId: number): Promise<{
    seed?: Uint8Array;
    icarusRoot?: Uint8Array;
    overlay: string;
    passphraseSource: PassphraseSource;
  }> {
    const devicePass = (await this.confirmation.getPassphrase(this.slotId)) ?? '';
    const hostPass = this.sessions.get(sessionId) ?? '';
    const cachedSeed = await this.port().getSeed?.(this.slotId);
    const cachedIcarus = await this.port().getIcarusRoot?.(this.slotId);
    if (cachedSeed) {
      return {
        seed: cachedSeed,
        icarusRoot: cachedIcarus,
        overlay: '',
        passphraseSource: devicePass.length > 0 ? 'device' : 'none',
      };
    }
    if (devicePass.length > 0) {
      return { overlay: devicePass, passphraseSource: 'device' };
    }
    if (hostPass.length > 0) {
      return { overlay: hostPass, passphraseSource: 'host' };
    }
    return {
      seed: await seedFor(this.port(), this.slotId, this.entropy, this.backup),
      icarusRoot: await icarusRootFor(this.port(), this.slotId, this.entropy, this.backup),
      overlay: '',
      passphraseSource: 'none',
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
        return this.handleButtonAck(sessionId);
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
      case MessageType.EthereumSignTypedData:
        return this.handleEthSignTypedData(sessionId, payload);
      case MessageType.EthereumTypedDataStructAck:
        return this.handleTypedStructAck(sessionId, payload);
      case MessageType.EthereumTypedDataValueAck:
        return this.handleTypedValueAck(sessionId, payload);
      case MessageType.CardanoSignTxInit:
        return this.handleCardanoSignTxInit(sessionId, payload);
      case MessageType.CardanoTxInput:
        return this.handleCardanoTxInput(sessionId, payload);
      case MessageType.CardanoTxOutput:
        return this.handleCardanoTxOutput(sessionId, payload);
      case MessageType.CardanoTxHostAck:
      case MessageType.CardanoTxItemAck:
      case MessageType.CardanoTxWitnessRequest:
        return this.handleCardanoContinue(sessionId);
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
    const decoded = decodeSignTx(payload);
    this.pending = {
      kind: 'btc-tx',
      sessionId,
      path: "m/84'/0'/0'/0/0",
      inputsCount: Math.max(1, decoded.inputsCount),
      outputsCount: Math.max(1, decoded.outputsCount),
      version: decoded.version,
      lockTime: decoded.lockTime,
      inputs: [],
      outputs: [],
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
    if (pending.inputs.length < pending.inputsCount) {
      if (!ack.prevHash.length) {
        return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Expected TXINPUT'));
      }
      const scriptType = ack.scriptType ?? InputScriptType.SPENDWITNESS;
      if (
        scriptType !== InputScriptType.SPENDWITNESS &&
        scriptType !== InputScriptType.SPENDP2SHWITNESS &&
        scriptType !== InputScriptType.SPENDTAPROOT
      ) {
        return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Unsupported script type'));
      }
      const path = ack.addressN.length
        ? overlayPath(this.confirmation, pathToString(ack.addressN), [
            'btc-legacy',
            'btc-nested',
            'btc-native',
            'btc-taproot',
          ])
        : pending.path;
      pending.path = path;
      pending.inputs.push({
        path,
        prevout:
          ack.prevHash.length === 36
            ? ack.prevHash
            : concatBytes(ack.prevHash.length === 32 ? ack.prevHash : ack.prevHash.subarray(0, 32), u32le(ack.prevIndex)),
        amount: ack.amount,
        sequence: ack.sequence,
        scriptType,
      });
      if (pending.inputs.length < pending.inputsCount) {
        return encodeL4(
          sessionId,
          MessageType.TxRequest,
          encodeTxRequest(TxRequestType.TXINPUT, pending.inputs.length),
        );
      }
      return encodeL4(sessionId, MessageType.TxRequest, encodeTxRequest(TxRequestType.TXOUTPUT, 0));
    }
    const changePath = ack.outputAddressN.length
      ? overlayPath(this.confirmation, pathToString(ack.outputAddressN), [
          'btc-legacy',
          'btc-nested',
          'btc-native',
          'btc-taproot',
        ])
      : '';
    pending.outputs.push({
      amount: ack.outputAmount,
      script: changePath ? new Uint8Array() : scriptFromAddress(ack.address),
      address: ack.address || (changePath ? `change ${changePath}` : ''),
      change: Boolean(changePath),
      changePath: changePath || undefined,
      outputScriptType: ack.outputScriptType,
    });
    if (pending.outputs.length < pending.outputsCount) {
      return encodeL4(
        sessionId,
        MessageType.TxRequest,
        encodeTxRequest(TxRequestType.TXOUTPUT, pending.outputs.length),
      );
    }
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.SignTx));
  }

  private handleEthSignTypedData(sessionId: number, payload: Uint8Array): Uint8Array {
    const decoded = decodeEthereumSignTypedData(payload);
    if (decoded.addressN.length === 0 || !decoded.primaryType) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Invalid EthereumSignTypedData'));
    }
    this.pending = {
      kind: 'eth-712-stream',
      sessionId,
      path: overlayPath(this.confirmation, pathToString(decoded.addressN), ['eth']),
      primaryType: decoded.primaryType,
      types: {},
      domain: {},
      message: {},
      phase: 'struct',
      structQueue: decoded.primaryType === 'EIP712Domain' ? ['EIP712Domain'] : ['EIP712Domain', decoded.primaryType],
      valueQueue: [],
      rawPayload: payload,
    };
    return this.nextTypedStruct(sessionId);
  }

  private handleTypedStructAck(sessionId: number, payload: Uint8Array): Uint8Array {
    const pending = this.pending;
    if (!pending || pending.kind !== 'eth-712-stream' || pending.phase !== 'struct' || !pending.requestedStruct) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No struct request'));
    }
    pending.types[pending.requestedStruct] = decodeTypedStructAck(payload);
    pending.requestedStruct = undefined;
    if (pending.structQueue.length) {
      return this.nextTypedStruct(sessionId);
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
    return this.nextTypedValue(sessionId);
  }

  private handleTypedValueAck(sessionId: number, payload: Uint8Array): Uint8Array {
    const pending = this.pending;
    if (!pending || pending.kind !== 'eth-712-stream' || pending.phase !== 'value' || !pending.requestedValue) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No value request'));
    }
    const raw = decodeTypedValueAck(payload);
    const target = pending.requestedValue.target === 'domain' ? pending.domain : pending.message;
    target[pending.requestedValue.field] = decodeTypedAtomic(pending.requestedValue.type, raw);
    pending.requestedValue = undefined;
    if (pending.valueQueue.length) {
      return this.nextTypedValue(sessionId);
    }
    pending.phase = 'confirm';
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
  }

  private nextTypedStruct(sessionId: number): Uint8Array {
    const pending = this.pending;
    if (!pending || pending.kind !== 'eth-712-stream') {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.ProcessError, 'No typed data'));
    }
    const name = pending.structQueue.shift();
    if (!name) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Empty struct queue'));
    }
    pending.requestedStruct = name;
    return encodeL4(sessionId, MessageType.EthereumTypedDataStructRequest, encodeTypedStructRequest(name));
  }

  private nextTypedValue(sessionId: number): Uint8Array {
    const pending = this.pending;
    if (!pending || pending.kind !== 'eth-712-stream') {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.ProcessError, 'No typed data'));
    }
    const next = pending.valueQueue.shift();
    if (!next) {
      pending.phase = 'confirm';
      return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.ProtectCall));
    }
    pending.requestedValue = next;
    return encodeL4(sessionId, MessageType.EthereumTypedDataValueRequest, encodeTypedValueRequest(next.path));
  }

  private handleCardanoSignTxInit(sessionId: number, payload: Uint8Array): Uint8Array {
    const decoded = decodeCardanoSignTxInit(payload);
    if (decoded.certificatesCount > 0 || decoded.mintCount > 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Unsupported Cardano extras'));
    }
    if (decoded.inputsCount < 1 || decoded.outputsCount < 1) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Need 1-in-1-out'));
    }
    const path = decoded.addressN.length
      ? overlayPath(this.confirmation, pathToString(decoded.addressN), ['ada'])
      : "m/1852'/1815'/0'/0/0";
    this.pending = {
      kind: 'cardano-tx',
      sessionId,
      path,
      payload: decoded.body,
      inputsRemaining: decoded.inputsCount,
      outputsRemaining: decoded.outputsCount,
      rawPayload: payload,
    };
    return encodeL4(sessionId, MessageType.CardanoTxItemAck, new Uint8Array());
  }

  private handleCardanoTxInput(sessionId: number, payload: Uint8Array): Uint8Array {
    const pending = this.pending;
    if (!pending || pending.kind !== 'cardano-tx' || pending.inputsRemaining <= 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No Cardano input'));
    }
    const decoded = decodeCardanoTxInput(payload);
    if (decoded.addressN.length) {
      pending.path = overlayPath(this.confirmation, pathToString(decoded.addressN), ['ada']);
    }
    pending.inputsRemaining -= 1;
    return encodeL4(sessionId, MessageType.CardanoTxItemAck, new Uint8Array());
  }

  private handleCardanoTxOutput(sessionId: number, _payload: Uint8Array): Uint8Array {
    const pending = this.pending;
    if (!pending || pending.kind !== 'cardano-tx' || pending.inputsRemaining > 0 || pending.outputsRemaining <= 0) {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No Cardano output'));
    }
    pending.outputsRemaining -= 1;
    if (pending.outputsRemaining > 0) {
      return encodeL4(sessionId, MessageType.CardanoTxItemAck, new Uint8Array());
    }
    return encodeL4(sessionId, MessageType.ButtonRequest, encodeButtonRequest(ButtonRequestType.SignTx));
  }

  private handleCardanoContinue(sessionId: number): Uint8Array {
    const pending = this.pending;
    if (!pending || pending.kind !== 'cardano-done') {
      return encodeL4(sessionId, MessageType.Failure, encodeFailure(FailureType.UnexpectedMessage, 'No Cardano finish'));
    }
    this.pending = undefined;
    return encodeL4(sessionId, MessageType.CardanoSignTxFinished, new Uint8Array());
  }

  private handleButtonAck(sessionId: number): Uint8Array | Promise<Uint8Array> {
    const pending = this.pending;
    if (pending?.kind === 'cardano-done') {
      return this.handleCardanoContinue(sessionId);
    }
    return this.finishPending(sessionId);
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
    if (pending.kind === 'cardano-done') {
      return encodeL4(pending.sessionId, MessageType.CardanoSignTxFinished, new Uint8Array());
    }
    const signing = isSignPending(pending);
    const material = await this.resolveSigningMaterial(pending.sessionId);
    const request: SigningRequest = {
      brand: 'trezor',
      kind: signing ? 'sign' : 'address',
      title: pendingTitle(pending),
      path: pending.path,
      message: pendingMessage(pending),
      rawPayload: pending.rawPayload,
      detail: ethConfirmDetail(pending),
      passphraseSource: material.passphraseSource === 'none' ? undefined : material.passphraseSource,
    };
    const ok = await this.confirmation.confirm(request);
    if (!ok) {
      return encodeL4(
        pending.sessionId,
        MessageType.Failure,
        encodeFailure(FailureType.ActionCancelled, 'Cancelled'),
      );
    }
    const overlay = material.overlay;
    const seed = material.seed;
    const icarusRoot = material.icarusRoot;
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
    if (pending.kind === 'eth-712-stream') {
      if (pending.phase !== 'confirm') {
        return encodeL4(
          pending.sessionId,
          MessageType.Failure,
          encodeFailure(FailureType.UnexpectedMessage, 'Typed data incomplete'),
        );
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
        return encodeL4(pending.sessionId, MessageType.Failure, encodeFailure(FailureType.DataError, 'Bad typed data'));
      }
      const privateKey = secp(pending.path);
      const address = ethereumAddressFromPrivateKey(privateKey);
      const sig = signSecp256k1Recoverable(privateKey, digest);
      const v = (sig[64] ?? 0) + 27;
      return encodeL4(
        pending.sessionId,
        MessageType.EthereumTypedDataSignature,
        encodeTypedDataSignature(concatBytes(sig.subarray(0, 64), Uint8Array.of(v)), address),
      );
    }
    if (pending.kind === 'cardano-tx') {
      const body = pending.payload.length ? pending.payload : sha256(pending.rawPayload);
      const node = icarusRoot
        ? deriveIcarusFromRoot(icarusRoot, pending.path)
        : deriveIcarus(this.entropy, pending.path, overlay, this.backup);
      const sig = signIcarus(node, body);
      this.pending = { kind: 'cardano-done', sessionId: pending.sessionId };
      return encodeL4(pending.sessionId, MessageType.CardanoTxWitnessResponse, encodeCardanoWitness(node.publicKey, sig));
    }
    if (pending.kind === 'btc-tx') {
      try {
        const signatures = signBtcInputs(pending, secp);
        return encodeL4(
          pending.sessionId,
          MessageType.TxRequest,
          encodeTxRequest(TxRequestType.TXFINISHED, 0, signatures),
        );
      } catch {
        return encodeL4(pending.sessionId, MessageType.Failure, encodeFailure(FailureType.ProcessError, 'SignTx failed'));
      }
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
  return applyConfirmationPath(confirmation.resolvePath, path, chains);
}

function isSignPending(pending: PendingAction): boolean {
  return (
    pending.kind === 'eth-sign' ||
    pending.kind === 'eth-tx' ||
    pending.kind === 'eth-tx-1559' ||
    pending.kind === 'eth-712' ||
    pending.kind === 'eth-712-stream' ||
    pending.kind === 'btc-sign-msg' ||
    pending.kind === 'btc-tx' ||
    pending.kind === 'cardano-tx' ||
    (pending.kind === 'coin' && pending.op.kind === 'sign')
  );
}

function ethConfirmDetail(pending: PendingAction): SigningDetail | undefined {
  if (pending.kind === 'eth-sign') {
    return describeEthMessage(pending.path, pending.message);
  }
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
  if (pending.kind === 'eth-tx-1559') {
    return describeEthTransaction({
      path: pending.path,
      type: 'eip1559',
      chainId: pending.tx.chainId,
      nonce: pending.tx.nonce,
      maxPriorityFeePerGas: pending.tx.maxPriorityFee,
      maxFeePerGas: pending.tx.maxFee,
      gasLimit: pending.tx.gasLimit,
      to: pending.tx.to,
      value: pending.tx.value,
      data: pending.tx.data,
    });
  }
  return undefined;
}

function pendingTitle(pending: PendingAction): string {
  if (pending.kind === 'coin') {
    return pending.op.title;
  }
  if (pending.kind === 'eth-tx' || pending.kind === 'eth-tx-1559') {
    return evmSignTitle(resolveEvmNativeGas({ chainId: pending.tx.chainId }));
  }
  if (pending.kind === 'btc-tx' || pending.kind === 'cardano-tx') {
    return 'Sign transaction';
  }
  if (pending.kind === 'eth-sign' || pending.kind === 'eth-712' || pending.kind === 'eth-712-stream' || pending.kind === 'btc-sign-msg') {
    return 'Sign message';
  }
  return 'Export address';
}

function pendingMessage(pending: PendingAction): string {
  if (pending.kind === 'cardano-done') {
    return 'Sign Cardano transaction';
  }
  if (pending.kind === 'btc-tx') {
    const change = pending.outputs.filter((output) => output.change).length;
    return `${pendingTitle(pending)}\n${pending.path}\n${pending.inputs.length}-in-${pending.outputs.length}-out${change ? ` · ${change} change` : ''}`;
  }
  return `${pendingTitle(pending)}\n${pending.path}`;
}

function compactSize(value: number): Uint8Array {
  if (value < 0xfd) {
    return Uint8Array.of(value);
  }
  return Uint8Array.of(0xfd, value & 0xff, (value >> 8) & 0xff);
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

function resolveOutputScript(
  output: BtcTxOutput,
  secp: (path: string) => Uint8Array,
): Uint8Array {
  if (output.script.length) {
    return output.script;
  }
  if (!output.changePath) {
    return concatBytes(Uint8Array.of(0x00, 0x14), new Uint8Array(20));
  }
  const priv = secp(output.changePath);
  if (output.outputScriptType === 6 || output.changePath.includes("/86'")) {
    return concatBytes(Uint8Array.of(0x51, 0x20), taprootOutputKey(priv).outputXOnly);
  }
  return concatBytes(Uint8Array.of(0x00, 0x14), hash160(publicKeyCompressed(priv)));
}

function signBtcInputs(
  pending: Extract<PendingAction, { kind: 'btc-tx' }>,
  secp: (path: string) => Uint8Array,
): Uint8Array[] {
  const prevouts = concatBytes(...pending.inputs.map((input) => input.prevout));
  const sequences = concatBytes(...pending.inputs.map((input) => u32le(input.sequence)));
  const outputs = concatBytes(
    ...pending.outputs.map((output) => {
      const script = resolveOutputScript(output, secp);
      return concatBytes(u64le(output.amount), compactSize(script.length), script);
    }),
  );
  const parsed: ParsedPsbt = {
    version: pending.version,
    locktime: pending.lockTime,
    inputs: pending.inputs.map((input) => ({ prevout: input.prevout, script: new Uint8Array(), sequence: input.sequence })),
    outputs: pending.outputs.map((output) => ({ amount: output.amount, script: resolveOutputScript(output, secp) })),
    global: new Map(),
    inputMaps: pending.inputs.map(() => new Map()),
    outputMaps: pending.outputs.map(() => new Map()),
  };
  const amounts = pending.inputs.map((input) => input.amount);
  const scripts = pending.inputs.map((input) => {
    const priv = secp(input.path);
    if (input.scriptType === InputScriptType.SPENDTAPROOT) {
      return concatBytes(Uint8Array.of(0x51, 0x20), taprootOutputKey(priv).outputXOnly);
    }
    return concatBytes(Uint8Array.of(0x00, 0x14), hash160(publicKeyCompressed(priv)));
  });
  return pending.inputs.map((input, index) => {
    const privateKey = secp(input.path);
    if (input.scriptType === InputScriptType.SPENDTAPROOT) {
      const tweaked = taprootOutputKey(privateKey);
      const hash = bip341Sighash(parsed, index, amounts, scripts, 0);
      return schnorr.sign(hash, tweaked.tweakedPriv);
    }
    const pub = publicKeyCompressed(privateKey);
    const hash = bip143Sighash({
      version: pending.version,
      prevout: input.prevout,
      amount: input.amount,
      sequence: input.sequence,
      scriptCode: p2wpkhScriptCode(hash160(pub)),
      outputs,
      locktime: pending.lockTime,
      prevouts,
      sequences,
    });
    return signSecp256k1Recoverable(privateKey, hash).subarray(0, 64);
  });
}

function scriptFromAddress(address: string): Uint8Array {
  if (address.startsWith('bc1') || address.startsWith('tb1') || address.startsWith('ltc1')) {
    try {
      const decoded = bech32.decode(address);
      const version = decoded.words[0] ?? 0;
      const payload = bech32.fromWords(decoded.words.slice(1));
      if (version === 0 && payload.length === 20) {
        return concatBytes(Uint8Array.of(0x00, 0x14), payload);
      }
    } catch {
      // fall through to dummy native script
    }
  }
  return concatBytes(Uint8Array.of(0x00, 0x14), new Uint8Array(20));
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
