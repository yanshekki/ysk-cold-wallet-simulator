import { concatBytes, hexToBytes } from './bytes';
import {
  decodeFields,
  encodeBool,
  encodeBytes,
  encodePackedUint32,
  encodeRepeatedUint32,
  encodeString,
  encodeUint32,
  readOptionalBool,
  readOptionalBytes,
  readOptionalString,
  readPackedOrRepeatedUint32,
} from './proto';

export const MessageType = {
  Initialize: 0,
  Ping: 1,
  Success: 2,
  Failure: 3,
  GetPublicKey: 11,
  PublicKey: 12,
  SignMessage: 38,
  MessageSignature: 40,
  GetAddress: 29,
  Address: 30,
  Features: 17,
  Cancel: 20,
  ButtonRequest: 26,
  ButtonAck: 27,
  GetFeatures: 55,
  EthereumGetAddress: 56,
  EthereumAddress: 57,
  EthereumSignTx: 58,
  EthereumTxRequest: 59,
  EthereumSignMessage: 64,
  EthereumMessageSignature: 66,
  EndSession: 83,
  EthereumSignTxEIP1559: 452,
  EthereumGetPublicKey: 450,
  EthereumPublicKey: 451,
  EthereumSignTypedData: 464,
  EthereumTypedDataStructRequest: 465,
  EthereumTypedDataStructAck: 466,
  EthereumTypedDataValueRequest: 467,
  EthereumTypedDataValueAck: 468,
  EthereumTypedDataSignature: 469,
  EthereumSignTypedHash: 470,
  CardanoGetAddress: 307,
  CardanoAddress: 308,
  CardanoTxItemAck: 313,
  /** Device → host. Not the host ack. OneKey firmware-pro uses 317 to finish. */
  CardanoTxAuxiliaryDataSupplement: 314,
  CardanoTxWitnessRequest: 315,
  CardanoTxWitnessResponse: 316,
  CardanoTxHostAck: 317,
  CardanoTxBodyHash: 318,
  CardanoSignTxFinished: 319,
  CardanoSignTxInit: 320,
  CardanoTxInput: 321,
  CardanoTxOutput: 322,
  CardanoTxCertificate: 325,
  RippleGetAddress: 400,
  RippleAddress: 401,
  RippleSignTx: 402,
  RippleSignedTx: 403,
  SolanaGetAddress: 10100,
  SolanaAddress: 10101,
  SolanaSignTx: 10102,
  SolanaSignedTx: 10103,
  SolanaSignOffChainMessage: 10104,
  SolanaMessageSignature: 10105,
  TronGetAddress: 10501,
  TronAddress: 10502,
  TronSignTx: 10503,
  TronSignedTx: 10504,
  TronSignMessage: 10505,
  TronMessageSignature: 10506,
  AptosGetAddress: 10600,
  AptosAddress: 10601,
  AptosSignTx: 10602,
  AptosSignedTx: 10603,
  AptosSignMessage: 10604,
  AptosMessageSignature: 10605,
  NearGetAddress: 10701,
  NearAddress: 10702,
  NearSignTx: 10703,
  NearSignedTx: 10704,
  CosmosGetAddress: 10800,
  CosmosAddress: 10801,
  CosmosSignTx: 10802,
  CosmosSignedTx: 10803,
  PolkadotGetAddress: 11000,
  PolkadotAddress: 11001,
  PolkadotSignTx: 11002,
  PolkadotSignedTx: 11003,
  SuiGetAddress: 11100,
  SuiAddress: 11101,
  SuiSignTx: 11102,
  SuiSignedTx: 11103,
  SuiSignMessage: 11104,
  SuiMessageSignature: 11105,
  TonGetAddress: 11901,
  TonAddress: 11902,
  TonSignMessage: 11903,
  TonSignedMessage: 11904,
  SignPsbt: 10052,
  SignedPsbt: 10053,
  OnekeyGetFeatures: 10025,
  OnekeyFeatures: 10026,
  GetPassphraseState: 10028,
  PassphraseState: 10029,
  UnLockDevice: 10030,
  UnLockDeviceResponse: 10031,
  EthereumGetPublicKeyOneKey: 20100,
  EthereumPublicKeyOneKey: 20101,
  EthereumGetAddressOneKey: 20102,
  EthereumAddressOneKey: 20103,
  EthereumSignTxOneKey: 20104,
  EthereumSignTxEIP1559OneKey: 20105,
  EthereumSignMessageOneKey: 20108,
  EthereumMessageSignatureOneKey: 20110,
  EthereumSignTypedDataOneKey: 20111,
  EthereumTypedDataStructRequestOneKey: 20112,
  EthereumTypedDataStructAckOneKey: 20113,
  EthereumTypedDataValueRequestOneKey: 20114,
  EthereumTypedDataValueAckOneKey: 20115,
  EthereumTypedDataSignatureOneKey: 20116,
  EthereumSignTypedHashOneKey: 20117,
  ReadSEPublicCert: 10007,
  SEPublicCert: 10008,
  SESignMessage: 10012,
  SEMessageSignature: 10013,
} as const;

export const FailureType = {
  UnexpectedMessage: 1,
  ButtonExpected: 2,
  DataError: 3,
  ActionCancelled: 4,
  ProcessError: 9,
} as const;

export const ButtonRequestType = {
  Other: 1,
  ProtectCall: 7,
  SignTx: 8,
  Address: 10,
} as const;

export const Capability = {
  Bitcoin: 1,
  BitcoinLike: 2,
  Crypto: 5,
  Ethereum: 7,
} as const;

export const OneKeyDeviceType = {
  Classic: 0,
  Classic1s: 1,
  Mini: 2,
  Touch: 3,
  Pro: 5,
  Pure: 6,
  Pro2: 7,
  Neo: 8,
} as const;

export type EthereumGetAddressMsg = {
  addressN: number[];
  showDisplay: boolean;
};

export type EthereumSignMessageMsg = {
  addressN: number[];
  message: Uint8Array;
};

export type BitcoinGetAddressMsg = {
  addressN: number[];
  coinName: string;
  showDisplay: boolean;
};

export type EthereumSignTxMsg = {
  addressN: number[];
  nonce: Uint8Array;
  gasPrice: Uint8Array;
  gasLimit: Uint8Array;
  to: Uint8Array;
  value: Uint8Array;
  data: Uint8Array;
  chainId: number;
};

export type EthereumSignTxEip1559Msg = {
  addressN: number[];
  nonce: Uint8Array;
  maxPriorityFee: Uint8Array;
  maxFee: Uint8Array;
  gasLimit: Uint8Array;
  to: Uint8Array;
  value: Uint8Array;
  data: Uint8Array;
  chainId: number;
};

export type PathBytesMsg = {
  addressN: number[];
  payload: Uint8Array;
  showDisplay: boolean;
};

export type FeaturesInput = {
  vendor: string;
  major: number;
  minor: number;
  patch: number;
  deviceId: string;
  label: string;
  model: string;
  serial: string;
  bleName: string;
  onekeyVersion: string;
  bleVersion: string;
  bootVersion: string;
  boardVersion: string;
  seVersion: string;
  sessionId: Uint8Array;
  deviceType: number;
};

export function encodeFailure(code: number, message: string): Uint8Array {
  return concatBytes(encodeUint32(1, code), encodeString(2, message));
}

export function encodeV2Failure(code: number, message: string, subcode = 0): Uint8Array {
  return concatBytes(encodeUint32(1, code), encodeUint32(2, subcode), encodeString(3, message));
}

export function encodeSuccess(message?: string): Uint8Array {
  return message ? encodeString(1, message) : new Uint8Array();
}

export function encodeProtocolInfo(input: {
  version: number;
  buildFingerprint: string;
  supportedMessages: number[];
}): Uint8Array {
  return concatBytes(
    encodeUint32(1, input.version),
    encodeString(2, input.buildFingerprint),
    encodeRepeatedUint32(3, input.supportedMessages),
  );
}

const DEVICE_TYPE_PRO = 5;

function encodeFirmwareImage(version: string, buildId: string): Uint8Array {
  return concatBytes(encodeString(10, version), encodeString(20, buildId));
}

export function encodeDeviceInfo(input: {
  serial: string;
  bleName: string;
  firmware: string;
  bleVersion: string;
  bootVersion: string;
  boardVersion: string;
  deviceType?: number;
}): Uint8Array {
  const app = encodeFirmwareImage(input.firmware, 'cws0000');
  const boot = encodeFirmwareImage(input.bootVersion, 'cwsboot');
  const board = encodeFirmwareImage(input.boardVersion, 'cwsboard');
  const ble = encodeFirmwareImage(input.bleVersion, 'cwsble');
  const hw = concatBytes(
    encodeUint32(10, input.deviceType ?? DEVICE_TYPE_PRO),
    encodeString(20, input.serial),
    encodeString(100, '1.0'),
  );
  const mainMcu = concatBytes(encodeBytes(10, board), encodeBytes(20, boot), encodeBytes(30, app));
  const coprocessor = concatBytes(encodeBytes(20, ble), encodeBytes(30, ble), encodeString(100, input.bleName));
  return concatBytes(
    encodeUint32(1, 1),
    encodeBytes(100, hw),
    encodeBytes(200, mainMcu),
    encodeBytes(300, coprocessor),
  );
}

export function encodeSEPublicCert(cert: Uint8Array): Uint8Array {
  return encodeBytes(1, cert);
}

export function encodeSEMessageSignature(signature: Uint8Array): Uint8Array {
  return encodeBytes(1, signature);
}

export function decodeSESignMessage(payload: Uint8Array): Uint8Array {
  return readOptionalBytes(decodeFields(payload), 1) ?? payload;
}

export function encodeDeviceStatus(deviceId: string): Uint8Array {
  return concatBytes(
    encodeString(1, deviceId),
    encodeBool(2, true),
    encodeBool(3, true),
    encodeBool(4, false),
    encodeBool(10, false),
    encodeBool(11, false),
    encodeBool(12, false),
  );
}

export function encodePassphraseState(input: {
  sessionId: Uint8Array;
  passphraseState?: string;
  unlockedAttachPin?: boolean;
}): Uint8Array {
  return concatBytes(
    encodeString(1, input.passphraseState ?? ''),
    encodeBytes(2, input.sessionId),
    encodeBool(3, input.unlockedAttachPin === true),
  );
}

export function encodeUnLockDeviceResponse(input?: {
  unlocked?: boolean;
  unlockedAttachPin?: boolean;
  passphraseProtection?: boolean;
}): Uint8Array {
  return concatBytes(
    encodeBool(1, input?.unlocked !== false),
    encodeBool(2, input?.unlockedAttachPin === true),
    encodeBool(3, input?.passphraseProtection === true),
  );
}

export function encodeButtonRequest(code: number): Uint8Array {
  return encodeUint32(1, code);
}

export function encodeFeatures(input: FeaturesInput): Uint8Array {
  return concatBytes(
    encodeString(1, input.vendor),
    encodeUint32(2, input.major),
    encodeUint32(3, input.minor),
    encodeUint32(4, input.patch),
    encodeBool(5, false),
    encodeString(6, input.deviceId),
    encodeBool(7, false),
    encodeBool(8, false),
    encodeString(9, 'en-US'),
    encodeString(10, input.label),
    encodeBool(12, true),
    encodeBool(16, true),
    encodeBool(18, true),
    encodeBool(19, false),
    encodeString(21, input.model),
    encodePackedUint32(30, [
      Capability.Bitcoin,
      Capability.BitcoinLike,
      Capability.Crypto,
      Capability.Ethereum,
    ]),
    encodeBytes(35, input.sessionId),
    encodeString(501, input.bleName),
    encodeString(502, input.bleVersion),
    encodeBool(503, true),
    encodeBool(504, true),
    encodeString(506, input.seVersion),
    encodeString(508, input.onekeyVersion),
    encodeString(509, input.serial),
    encodeString(510, input.bootVersion),
    encodeString(511, input.serial),
    encodeString(519, input.boardVersion),
    encodeUint32(600, input.deviceType),
    encodeString(602, input.boardVersion),
    encodeString(604, input.bootVersion),
    encodeString(606, input.seVersion),
    encodeString(609, input.onekeyVersion),
    encodeString(612, input.serial),
    encodeString(614, input.bleName),
    encodeString(615, input.bleVersion),
  );
}

export function encodeOnekeyFeatures(input: FeaturesInput): Uint8Array {
  return concatBytes(
    encodeUint32(1, input.deviceType),
    encodeString(2, input.boardVersion),
    encodeString(3, input.bootVersion),
    encodeString(4, input.onekeyVersion),
    encodeString(11, input.serial),
    encodeString(12, input.bleName),
    encodeString(13, input.bleVersion),
  );
}

export function encodeHdNode(node: {
  depth: number;
  fingerprint: number;
  childNum: number;
  chainCode: Uint8Array;
  publicKey: Uint8Array;
}): Uint8Array {
  return concatBytes(
    encodeUint32(1, node.depth),
    encodeUint32(2, node.fingerprint),
    encodeUint32(3, node.childNum),
    encodeBytes(4, node.chainCode),
    encodeBytes(6, node.publicKey),
  );
}

export function encodeEthereumPublicKey(node: {
  depth: number;
  fingerprint: number;
  childNum: number;
  chainCode: Uint8Array;
  publicKey: Uint8Array;
  xpub: string;
}): Uint8Array {
  return concatBytes(encodeBytes(1, encodeHdNode(node)), encodeString(2, node.xpub));
}

export function encodeEthereumAddress(address: string): Uint8Array {
  return encodeString(2, address.startsWith('0x') ? address : `0x${address}`);
}

export function encodeEthereumMessageSignature(signature: Uint8Array, address: string): Uint8Array {
  const checksummed = address.startsWith('0x') ? address : `0x${address}`;
  return concatBytes(encodeBytes(2, signature), encodeString(3, checksummed));
}

export function encodeBitcoinAddress(address: string): Uint8Array {
  return encodeString(1, address);
}

export function decodeBitcoinAddress(payload: Uint8Array): string {
  return readOptionalString(decodeFields(payload), 1) ?? '';
}

export function decodeEthereumGetAddress(payload: Uint8Array): EthereumGetAddressMsg {
  const fields = decodeFields(payload);
  return {
    addressN: readPackedOrRepeatedUint32(fields, 1),
    showDisplay: readOptionalBool(fields, 2) === true,
  };
}

export function decodeEthereumSignMessage(payload: Uint8Array): EthereumSignMessageMsg {
  const fields = decodeFields(payload);
  const message = readOptionalBytes(fields, 2);
  if (!message) {
    throw new Error('EthereumSignMessage missing message');
  }
  return {
    addressN: readPackedOrRepeatedUint32(fields, 1),
    message,
  };
}

export function decodeEthereumSignTx(payload: Uint8Array): EthereumSignTxMsg {
  const fields = decodeFields(payload);
  const toBytes = readOptionalBytes(fields, 5);
  const toString = readOptionalString(fields, 9);
  let to = toBytes && toBytes.length > 0 ? toBytes : new Uint8Array();
  if (to.length === 0 && toString) {
    const hex = toString.startsWith('0x') || toString.startsWith('0X') ? toString.slice(2) : toString;
    if (hex.length % 2 === 0 && hex.length > 0) {
      to = hexToBytes(hex);
    }
  }
  return {
    addressN: readPackedOrRepeatedUint32(fields, 1),
    nonce: readOptionalBytes(fields, 2) ?? new Uint8Array(),
    gasPrice: readOptionalBytes(fields, 3) ?? new Uint8Array(),
    gasLimit: readOptionalBytes(fields, 4) ?? new Uint8Array(),
    to,
    value: readOptionalBytes(fields, 6) ?? new Uint8Array(),
    data: readOptionalBytes(fields, 7) ?? new Uint8Array(),
    chainId: fields.find((field) => field.field === 11)?.varint ?? 1,
  };
}

export function encodeEthereumTxRequest(signature: {
  v: number;
  r: Uint8Array;
  s: Uint8Array;
}): Uint8Array {
  return concatBytes(
    encodeUint32(2, signature.v),
    encodeBytes(3, signature.r),
    encodeBytes(4, signature.s),
  );
}

export function decodeBitcoinGetAddress(payload: Uint8Array): BitcoinGetAddressMsg {
  const fields = decodeFields(payload);
  return {
    addressN: readPackedOrRepeatedUint32(fields, 1),
    coinName: readOptionalString(fields, 2) ?? 'Bitcoin',
    showDisplay: readOptionalBool(fields, 3) === true,
  };
}

export function decodePing(payload: Uint8Array): { message: string; buttonProtection: boolean } {
  const fields = decodeFields(payload);
  return {
    message: readOptionalString(fields, 1) ?? '',
    buttonProtection: readOptionalBool(fields, 2) === true,
  };
}

export function decodeFailure(payload: Uint8Array): { code: number; message: string } {
  const fields = decodeFields(payload);
  const codeField = fields.find((field) => field.field === 1);
  return {
    code: codeField?.varint ?? 0,
    message: readOptionalString(fields, 2) ?? '',
  };
}

export function decodeFeatures(payload: Uint8Array): {
  vendor: string;
  major: number;
  model: string;
  initialized: boolean;
} {
  const fields = decodeFields(payload);
  const major = fields.find((field) => field.field === 2)?.varint ?? 0;
  return {
    vendor: readOptionalString(fields, 1) ?? '',
    major,
    model: readOptionalString(fields, 21) ?? '',
    initialized: readOptionalBool(fields, 12) === true,
  };
}

export function decodeEthereumAddress(payload: Uint8Array): string {
  return readOptionalString(decodeFields(payload), 2) ?? '';
}

export function decodeEthereumMessageSignature(payload: Uint8Array): {
  signature: Uint8Array;
  address: string;
} {
  const fields = decodeFields(payload);
  return {
    signature: readOptionalBytes(fields, 2) ?? new Uint8Array(),
    address: readOptionalString(fields, 3) ?? '',
  };
}

export function decodeButtonRequest(payload: Uint8Array): number {
  return decodeFields(payload).find((field) => field.field === 1)?.varint ?? 0;
}

export function isEthGetAddress(type: number): boolean {
  return type === MessageType.EthereumGetAddress || type === MessageType.EthereumGetAddressOneKey;
}

export function isEthGetPublicKey(type: number): boolean {
  return (
    type === MessageType.EthereumGetPublicKey || type === MessageType.EthereumGetPublicKeyOneKey
  );
}

export function isEthSignMessage(type: number): boolean {
  return (
    type === MessageType.EthereumSignMessage || type === MessageType.EthereumSignMessageOneKey
  );
}

export function isEthSignTx(type: number): boolean {
  return (
    type === MessageType.EthereumSignTx ||
    type === MessageType.EthereumSignTxOneKey
  );
}

export function isEthSignTxEip1559(type: number): boolean {
  return (
    type === MessageType.EthereumSignTxEIP1559 ||
    type === MessageType.EthereumSignTxEIP1559OneKey
  );
}

export function isEthSignTypedHash(type: number): boolean {
  return type === MessageType.EthereumSignTypedHash || type === MessageType.EthereumSignTypedHashOneKey;
}

export function decodeEthereumSignTxEip1559(payload: Uint8Array): EthereumSignTxEip1559Msg {
  const fields = decodeFields(payload);
  const toString = readOptionalString(fields, 6);
  let to: Uint8Array = new Uint8Array();
  if (toString) {
    const hex = toString.startsWith('0x') || toString.startsWith('0X') ? toString.slice(2) : toString;
    if (hex.length % 2 === 0 && hex.length > 0) {
      to = hexToBytes(hex);
    }
  }
  return {
    addressN: readPackedOrRepeatedUint32(fields, 1),
    nonce: readOptionalBytes(fields, 2) ?? new Uint8Array(),
    maxPriorityFee: readOptionalBytes(fields, 3) ?? new Uint8Array(),
    maxFee: readOptionalBytes(fields, 4) ?? new Uint8Array(),
    gasLimit: readOptionalBytes(fields, 5) ?? new Uint8Array(),
    to,
    value: readOptionalBytes(fields, 7) ?? new Uint8Array(),
    data: readOptionalBytes(fields, 8) ?? new Uint8Array(),
    chainId: fields.find((field) => field.field === 10)?.varint ?? 1,
  };
}

export function decodeEthereumSignTypedHash(payload: Uint8Array): {
  addressN: number[];
  domain: Uint8Array;
  structHash: Uint8Array;
} {
  const fields = decodeFields(payload);
  return {
    addressN: readPackedOrRepeatedUint32(fields, 1),
    domain: readOptionalBytes(fields, 2) ?? new Uint8Array(),
    structHash: readOptionalBytes(fields, 3) ?? new Uint8Array(),
  };
}

export function decodePathBytes(payload: Uint8Array, bytesField = 2): PathBytesMsg {
  const fields = decodeFields(payload);
  return {
    addressN: readPackedOrRepeatedUint32(fields, 1),
    payload: readOptionalBytes(fields, bytesField) ?? new Uint8Array(),
    showDisplay: readOptionalBool(fields, 2) === true || readOptionalBool(fields, 3) === true,
  };
}

export function encodeStringAddress(address: string): Uint8Array {
  return encodeString(1, address);
}

export function encodeBytesSignature(signature: Uint8Array): Uint8Array {
  return encodeBytes(1, signature);
}

export function encodeTypedDataSignature(signature: Uint8Array, address: string): Uint8Array {
  return concatBytes(encodeBytes(1, signature), encodeString(2, address));
}

export function encodeHdPublicKey(node: {
  depth: number;
  fingerprint: number;
  childNum: number;
  chainCode: Uint8Array;
  publicKey: Uint8Array;
  xpub: string;
}): Uint8Array {
  return concatBytes(encodeBytes(1, encodeHdNode(node)), encodeString(2, node.xpub));
}

export function encodeMessageSignature(address: string, signature: Uint8Array): Uint8Array {
  return concatBytes(encodeString(1, address), encodeBytes(2, signature));
}

export function ethAddressReplyType(requestType: number): number {
  return requestType === MessageType.EthereumGetAddressOneKey
    ? MessageType.EthereumAddressOneKey
    : MessageType.EthereumAddress;
}

export function ethPublicKeyReplyType(requestType: number): number {
  return requestType === MessageType.EthereumGetPublicKeyOneKey
    ? MessageType.EthereumPublicKeyOneKey
    : MessageType.EthereumPublicKey;
}

export function ethSignReplyType(requestType: number): number {
  return requestType === MessageType.EthereumSignMessageOneKey
    ? MessageType.EthereumMessageSignatureOneKey
    : MessageType.EthereumMessageSignature;
}

export const EthereumDataType = {
  UINT: 1,
  INT: 2,
  BYTES: 3,
  STRING: 4,
  BOOL: 5,
  ADDRESS: 6,
  ARRAY: 7,
  STRUCT: 8,
} as const;

export function isEthSignTypedData(type: number): boolean {
  return type === MessageType.EthereumSignTypedData || type === MessageType.EthereumSignTypedDataOneKey;
}

export function typedDataIds(requestType: number): {
  structRequest: number;
  structAck: number;
  valueRequest: number;
  valueAck: number;
  signature: number;
} {
  if (requestType === MessageType.EthereumSignTypedDataOneKey) {
    return {
      structRequest: MessageType.EthereumTypedDataStructRequestOneKey,
      structAck: MessageType.EthereumTypedDataStructAckOneKey,
      valueRequest: MessageType.EthereumTypedDataValueRequestOneKey,
      valueAck: MessageType.EthereumTypedDataValueAckOneKey,
      signature: MessageType.EthereumTypedDataSignatureOneKey,
    };
  }
  return {
    structRequest: MessageType.EthereumTypedDataStructRequest,
    structAck: MessageType.EthereumTypedDataStructAck,
    valueRequest: MessageType.EthereumTypedDataValueRequest,
    valueAck: MessageType.EthereumTypedDataValueAck,
    signature: MessageType.EthereumTypedDataSignature,
  };
}

export function decodeEthereumSignTypedData(payload: Uint8Array): {
  addressN: number[];
  primaryType: string;
} {
  const fields = decodeFields(payload);
  return {
    addressN: readPackedOrRepeatedUint32(fields, 1),
    primaryType: readOptionalString(fields, 2) ?? '',
  };
}

export function encodeTypedStructRequest(name: string): Uint8Array {
  return encodeString(1, name);
}

export function encodeTypedValueRequest(memberPath: number[]): Uint8Array {
  return encodePackedUint32(1, memberPath);
}

export function encodeTypedStructAck(
  members: Array<{ name: string; dataType: number; size?: number; structName?: string }>,
): Uint8Array {
  return concatBytes(
    ...members.map((member) => {
      const typeFields = [encodeUint32(1, member.dataType)];
      if (member.size != null) {
        typeFields.push(encodeUint32(2, member.size));
      }
      if (member.structName) {
        typeFields.push(encodeString(4, member.structName));
      }
      return encodeBytes(1, concatBytes(encodeBytes(1, concatBytes(...typeFields)), encodeString(2, member.name)));
    }),
  );
}

export function encodeTypedValueAck(value: Uint8Array): Uint8Array {
  return encodeBytes(1, value);
}

export function decodeTypedStructAck(payload: Uint8Array): Array<{ name: string; type: string }> {
  const fields = decodeFields(payload);
  const members: Array<{ name: string; type: string }> = [];
  for (const field of fields) {
    if (field.field !== 1) {
      continue;
    }
    const inner = decodeFields(field.bytes);
    const typeBytes = inner.find((item) => item.field === 1)?.bytes ?? new Uint8Array();
    const typeFields = decodeFields(typeBytes);
    const dataType = typeFields.find((item) => item.field === 1)?.varint ?? EthereumDataType.STRING;
    const size = typeFields.find((item) => item.field === 2)?.varint;
    const structName = readOptionalString(typeFields, 4) ?? '';
    const name = readOptionalString(inner, 2) ?? '';
    if (name) {
      members.push({ name, type: solidityTypeFromEth(dataType, size, structName) });
    }
  }
  return members;
}

export function decodeTypedValueAck(payload: Uint8Array): Uint8Array {
  const fields = decodeFields(payload);
  return readOptionalBytes(fields, 1) ?? new Uint8Array();
}

function solidityTypeFromEth(dataType: number, size: number | undefined, structName: string): string {
  if (dataType === EthereumDataType.STRING) {
    return 'string';
  }
  if (dataType === EthereumDataType.ADDRESS) {
    return 'address';
  }
  if (dataType === EthereumDataType.BOOL) {
    return 'bool';
  }
  if (dataType === EthereumDataType.BYTES) {
    return size ? `bytes${size}` : 'bytes';
  }
  if (dataType === EthereumDataType.UINT) {
    return `uint${(size ?? 32) * 8}`;
  }
  if (dataType === EthereumDataType.INT) {
    return `int${(size ?? 32) * 8}`;
  }
  if (dataType === EthereumDataType.STRUCT) {
    return structName || 'Mail';
  }
  return 'string';
}

export function decodeCardanoSignTxInit(payload: Uint8Array): {
  addressN: number[];
  body: Uint8Array;
  inputsCount: number;
  outputsCount: number;
  certificatesCount: number;
  mintCount: number;
} {
  const fields = decodeFields(payload);
  const field1 = fields.filter((field) => field.field === 1);
  const looksLikePath = field1.length >= 2 || (field1[0]?.varint ?? 0) > 10;
  if (looksLikePath) {
    return {
      addressN: readPackedOrRepeatedUint32(fields, 1),
      body: readOptionalBytes(fields, 2) ?? new Uint8Array(),
      inputsCount: fields.find((field) => field.field === 4)?.varint ?? 1,
      outputsCount: fields.find((field) => field.field === 5)?.varint ?? 1,
      certificatesCount: fields.find((field) => field.field === 8)?.varint ?? 0,
      mintCount: fields.find((field) => field.field === 20)?.varint ?? 0,
    };
  }
  return {
    addressN: [],
    body: readOptionalBytes(fields, 21) ?? new Uint8Array(),
    inputsCount: fields.find((field) => field.field === 4)?.varint ?? 0,
    outputsCount: fields.find((field) => field.field === 5)?.varint ?? 0,
    certificatesCount: fields.find((field) => field.field === 8)?.varint ?? 0,
    mintCount: fields.find((field) => field.field === 20)?.varint ?? 0,
  };
}

export function decodeCardanoTxInput(payload: Uint8Array): { addressN: number[] } {
  const fields = decodeFields(payload);
  return { addressN: readPackedOrRepeatedUint32(fields, 1) };
}

export function encodeCardanoWitness(publicKey: Uint8Array, signature: Uint8Array): Uint8Array {
  return concatBytes(encodeUint32(1, 1), encodeBytes(2, publicKey), encodeBytes(3, signature));
}
