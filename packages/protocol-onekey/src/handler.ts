import type { Brand, ConfirmationPort, DeviceModel, ProtocolHandler, SigningRequest } from '@cws/contracts';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, encodeUtf8 } from './bytes';
import {
  bitcoinP2pkhAddress,
  derivePrivateKey,
  ethereumAddressFromPrivateKey,
  pathToString,
  signPersonalMessage,
} from './crypto';
import { DEFAULT_MTU, V1Reassembler, clampMtu, frameV1 } from './framing';
import {
  ButtonRequestType,
  FailureType,
  MessageType,
  OneKeyDeviceType,
  decodeBitcoinGetAddress,
  decodeEthereumGetAddress,
  decodeEthereumSignMessage,
  decodePing,
  encodeBitcoinAddress,
  encodeButtonRequest,
  encodeEthereumAddress,
  encodeEthereumMessageSignature,
  encodeFailure,
  encodeFeatures,
  encodeOnekeyFeatures,
  encodeSuccess,
  ethAddressReplyType,
  ethSignReplyType,
  isEthGetAddress,
  isEthSignMessage,
  isEthSignTx,
  type FeaturesInput,
} from './messages';

export type OneKeyHandlerOptions = {
  model: DeviceModel;
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  mtu?: number;
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
      kind: 'btc-address';
      path: string;
      coinName: string;
      rawPayload: Uint8Array;
    };

const DEVICE_TYPE: Record<string, number> = {
  classic: OneKeyDeviceType.Classic,
  touch: OneKeyDeviceType.Touch,
  pro: OneKeyDeviceType.Pro,
};

const SERIAL_PREFIX: Record<string, string> = {
  classic: 'cl',
  touch: 'tc',
  pro: 'pr',
};

const FIRMWARE: Record<string, [number, number, number]> = {
  classic: [3, 13, 0],
  touch: [4, 16, 0],
  pro: [4, 16, 0],
};

export class OneKeyV1ProtocolHandler implements ProtocolHandler {
  readonly brand: Brand = 'onekey';
  readonly models: string[];

  private readonly model: DeviceModel;
  private readonly confirmation: ConfirmationPort;
  private readonly slotId: string;
  private readonly entropy: Uint8Array;
  private readonly assembler = new V1Reassembler();
  private readonly sessionId: Uint8Array;
  private readonly serial: string;
  private mtu: number;
  private pending: PendingAction | undefined;

  constructor(options: OneKeyHandlerOptions) {
    this.model = options.model;
    this.confirmation = options.confirmation;
    this.slotId = options.slotId;
    this.entropy = options.entropy;
    this.mtu = clampMtu(options.mtu ?? DEFAULT_MTU);
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
    this.mtu = clampMtu(Math.max(this.mtu, size));
  }

  async handleWrite(data: Uint8Array): Promise<Uint8Array | null> {
    this.observeIncomingSize(data.length);
    let message;
    try {
      message = this.assembler.push(data);
    } catch {
      return this.reply(
        MessageType.Failure,
        encodeFailure(FailureType.ProcessError, 'Invalid framing'),
      );
    }
    if (!message) {
      return null;
    }
    return this.dispatch(message.type, message.payload);
  }

  private async dispatch(type: number, payload: Uint8Array): Promise<Uint8Array> {
    switch (type) {
      case MessageType.Initialize:
      case MessageType.GetFeatures:
        this.pending = undefined;
        return this.reply(MessageType.Features, encodeFeatures(this.featuresInput()));
      case MessageType.OnekeyGetFeatures:
        return this.reply(MessageType.OnekeyFeatures, encodeOnekeyFeatures(this.featuresInput()));
      case MessageType.Ping: {
        const ping = decodePing(payload);
        return this.reply(MessageType.Success, encodeSuccess(ping.message));
      }
      case MessageType.Cancel:
        this.pending = undefined;
        return this.reply(
          MessageType.Failure,
          encodeFailure(FailureType.ActionCancelled, 'Cancelled'),
        );
      case MessageType.EndSession:
        this.pending = undefined;
        return this.reply(MessageType.Success, encodeSuccess());
      case MessageType.ButtonAck:
        return this.finishPending();
      case MessageType.GetAddress:
        return this.handleBitcoinGetAddress(payload);
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
      return this.reply(
        MessageType.Failure,
        encodeFailure(FailureType.UnexpectedMessage, 'Unsupported'),
      );
    }

    return this.reply(
      MessageType.Failure,
      encodeFailure(FailureType.UnexpectedMessage, `Unsupported message ${type}`),
    );
  }

  private async handleEthGetAddress(type: number, payload: Uint8Array): Promise<Uint8Array> {
    let decoded;
    try {
      decoded = decodeEthereumGetAddress(payload);
    } catch {
      return this.reply(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Invalid EthereumGetAddress'),
      );
    }
    if (decoded.addressN.length === 0) {
      return this.reply(
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
    return this.reply(
      MessageType.ButtonRequest,
      encodeButtonRequest(ButtonRequestType.Address),
    );
  }

  private async handleEthSignMessage(type: number, payload: Uint8Array): Promise<Uint8Array> {
    let decoded;
    try {
      decoded = decodeEthereumSignMessage(payload);
    } catch {
      return this.reply(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Invalid EthereumSignMessage'),
      );
    }
    if (decoded.addressN.length === 0) {
      return this.reply(
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
    return this.reply(
      MessageType.ButtonRequest,
      encodeButtonRequest(ButtonRequestType.ProtectCall),
    );
  }

  private async handleBitcoinGetAddress(payload: Uint8Array): Promise<Uint8Array> {
    let decoded;
    try {
      decoded = decodeBitcoinGetAddress(payload);
    } catch {
      return this.reply(
        MessageType.Failure,
        encodeFailure(FailureType.DataError, 'Invalid GetAddress'),
      );
    }
    if (decoded.addressN.length === 0) {
      return this.reply(
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
    return this.reply(
      MessageType.ButtonRequest,
      encodeButtonRequest(ButtonRequestType.Address),
    );
  }

  private async finishPending(): Promise<Uint8Array> {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) {
      return this.reply(
        MessageType.Failure,
        encodeFailure(FailureType.UnexpectedMessage, 'No pending request'),
      );
    }

    const request: SigningRequest = {
      brand: 'onekey',
      path: pending.path,
      message: previewPending(pending),
      rawPayload: pending.rawPayload,
    };
    const ok = await this.confirmation.confirm(request);
    if (!ok) {
      return this.reply(
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
    return this.bitcoinAddressReply(pending.path, pending.coinName);
  }

  private async ethAddressReply(path: string, replyType: number): Promise<Uint8Array> {
    const passphrase = await this.confirmation.getPassphrase(this.slotId);
    const privateKey = derivePrivateKey(this.entropy, path, passphrase);
    const address = ethereumAddressFromPrivateKey(privateKey);
    return this.reply(replyType, encodeEthereumAddress(address));
  }

  private async ethSignReply(
    path: string,
    message: Uint8Array,
    replyType: number,
  ): Promise<Uint8Array> {
    const passphrase = await this.confirmation.getPassphrase(this.slotId);
    const privateKey = derivePrivateKey(this.entropy, path, passphrase);
    const address = ethereumAddressFromPrivateKey(privateKey);
    const signature = signPersonalMessage(privateKey, message);
    return this.reply(replyType, encodeEthereumMessageSignature(signature, address));
  }

  private async bitcoinAddressReply(path: string, coinName: string): Promise<Uint8Array> {
    const passphrase = await this.confirmation.getPassphrase(this.slotId);
    const privateKey = derivePrivateKey(this.entropy, path, passphrase);
    const testnet = /testnet|regtest/i.test(coinName);
    const address = bitcoinP2pkhAddress(privateKey, testnet);
    return this.reply(MessageType.Address, encodeBitcoinAddress(address));
  }

  private featuresInput(): FeaturesInput {
    const version = FIRMWARE[this.model.id] ?? FIRMWARE.classic;
    return {
      vendor: 'onekey.so',
      major: version[0],
      minor: version[1],
      patch: version[2],
      deviceId: bytesToHex(this.sessionId.subarray(0, 12)),
      label: 'YSK Simulator',
      model: this.model.id,
      serial: this.serial,
      bleName: this.model.name,
      onekeyVersion: version.join('.'),
      sessionId: this.sessionId,
      deviceType: DEVICE_TYPE[this.model.id] ?? OneKeyDeviceType.Classic,
    };
  }

  private reply(type: number, payload: Uint8Array): Uint8Array {
    return frameV1(type, payload);
  }
}

function previewPending(pending: PendingAction): string {
  if (pending.kind === 'eth-sign') {
    return `Sign personal message\n${pending.path}\n${previewMessage(pending.message)}`;
  }
  if (pending.kind === 'btc-address') {
    return `Export Bitcoin address\n${pending.path}`;
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
