import { concatBytes } from './bytes';
import {
  decodeFields,
  encodeBool,
  encodeBytes,
  encodeMessage,
  encodePackedUint32,
  encodeString,
  encodeUint32,
  readOptionalBool,
  readOptionalBytes,
  readOptionalString,
  readOptionalUint32,
  readPackedOrRepeatedUint32,
} from './proto';

export const MessageType = {
  Initialize: 0,
  Ping: 1,
  Success: 2,
  Failure: 3,
  Features: 17,
  Cancel: 20,
  ButtonRequest: 26,
  ButtonAck: 27,
  GetFeatures: 55,
  EthereumGetAddress: 56,
  EthereumAddress: 57,
  EthereumSignTx: 58,
  EthereumSignMessage: 64,
  EthereumMessageSignature: 66,
  EthereumSignTxEIP1559: 452,
  ThpCreateNewSession: 1000,
  ThpPairingRequest: 1008,
  ThpPairingRequestApproved: 1009,
  ThpSelectMethod: 1010,
  ThpCredentialRequest: 1016,
  ThpCredentialResponse: 1017,
  ThpEndRequest: 1018,
  ThpEndResponse: 1019,
  ThpCodeEntryCommitment: 1024,
  ThpCodeEntryChallenge: 1025,
  ThpCodeEntryCpaceTrezor: 1026,
  ThpCodeEntryCpaceHostTag: 1027,
  ThpCodeEntrySecret: 1028,
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

export const ThpPairingMethod = {
  SkipPairing: 1,
  CodeEntry: 2,
  QrCode: 3,
  Nfc: 4,
} as const;

export const TREZOR_STATE_UNPAIRED = 0;
export const TREZOR_STATE_PAIRED = 1;
export const TREZOR_STATE_PAIRED_AUTOCONNECT = 2;

export const INTERNAL_MODEL = 'T3W1';
export const PROTOCOL_VERSION_MAJOR = 2;
export const PROTOCOL_VERSION_MINOR = 0;

export type FeaturesInput = {
  vendor: string;
  major: number;
  minor: number;
  patch: number;
  deviceId: string;
  label: string;
  model: string;
  internalModel: string;
  sessionId?: Uint8Array;
};

export type EthereumGetAddressMsg = {
  addressN: number[];
  showDisplay: boolean;
};

export type EthereumSignMessageMsg = {
  addressN: number[];
  message: Uint8Array;
};

export type CredentialMetadata = {
  hostName: string;
  appName: string;
  autoconnect: boolean;
};

export function encodeDeviceProperties(): Uint8Array {
  return concatBytes(
    encodeString(1, INTERNAL_MODEL),
    encodeUint32(2, 0),
    encodeUint32(3, PROTOCOL_VERSION_MAJOR),
    encodeUint32(4, PROTOCOL_VERSION_MINOR),
    encodeUint32(5, ThpPairingMethod.CodeEntry),
  );
}

export function decodeDeviceProperties(payload: Uint8Array): {
  internalModel: string;
  protocolMajor: number;
  protocolMinor: number;
  pairingMethods: number[];
} {
  const fields = decodeFields(payload);
  return {
    internalModel: readOptionalString(fields, 1) ?? '',
    protocolMajor: readOptionalUint32(fields, 3) ?? 0,
    protocolMinor: readOptionalUint32(fields, 4) ?? 0,
    pairingMethods: readPackedOrRepeatedUint32(fields, 5),
  };
}

export function encodeFailure(code: number, message: string): Uint8Array {
  return concatBytes(encodeUint32(1, code), encodeString(2, message));
}

export function encodeSuccess(message?: string): Uint8Array {
  return message ? encodeString(1, message) : new Uint8Array();
}

export function encodeButtonRequest(code: number): Uint8Array {
  return encodeUint32(1, code);
}

export function encodeFeatures(input: FeaturesInput): Uint8Array {
  const parts = [
    encodeString(1, input.vendor),
    encodeUint32(2, input.major),
    encodeUint32(3, input.minor),
    encodeUint32(4, input.patch),
    encodeBool(5, false),
    encodeString(6, input.deviceId),
    encodeBool(7, false),
    encodeBool(8, true),
    encodeString(10, input.label),
    encodeBool(12, true),
    encodeBool(16, true),
    encodeBool(18, true),
    encodeString(21, input.model),
    encodePackedUint32(30, [
      Capability.Bitcoin,
      Capability.BitcoinLike,
      Capability.Crypto,
      Capability.Ethereum,
    ]),
    encodeString(44, input.internalModel),
  ];
  if (input.sessionId) {
    parts.push(encodeBytes(35, input.sessionId));
  }
  return concatBytes(...parts);
}

export function encodeEthereumAddress(address: string): Uint8Array {
  return encodeString(2, address.startsWith('0x') ? address : `0x${address}`);
}

export function encodeEthereumMessageSignature(signature: Uint8Array, address: string): Uint8Array {
  const checksummed = address.startsWith('0x') ? address : `0x${address}`;
  return concatBytes(encodeBytes(2, signature), encodeString(3, checksummed));
}

export function encodePairingRequest(hostName: string, appName: string): Uint8Array {
  return concatBytes(encodeString(1, hostName), encodeString(2, appName));
}

export function decodePairingRequest(payload: Uint8Array): { hostName: string; appName: string } {
  const fields = decodeFields(payload);
  return {
    hostName: readOptionalString(fields, 1) ?? '',
    appName: readOptionalString(fields, 2) ?? '',
  };
}

export function encodeSelectMethod(method: number): Uint8Array {
  return encodeUint32(1, method);
}

export function decodeSelectMethod(payload: Uint8Array): number {
  return readOptionalUint32(decodeFields(payload), 1) ?? 0;
}

export function encodeCodeEntryCommitment(commitment: Uint8Array): Uint8Array {
  return encodeBytes(1, commitment);
}

export function decodeCodeEntryCommitment(payload: Uint8Array): Uint8Array {
  return readOptionalBytes(decodeFields(payload), 1) ?? new Uint8Array();
}

export function encodeCodeEntryChallenge(challenge: Uint8Array): Uint8Array {
  return encodeBytes(1, challenge);
}

export function decodeCodeEntryChallenge(payload: Uint8Array): Uint8Array {
  return readOptionalBytes(decodeFields(payload), 1) ?? new Uint8Array();
}

export function encodeCodeEntryCpaceTrezor(publicKey: Uint8Array): Uint8Array {
  return encodeBytes(1, publicKey);
}

export function decodeCodeEntryCpaceTrezor(payload: Uint8Array): Uint8Array {
  return readOptionalBytes(decodeFields(payload), 1) ?? new Uint8Array();
}

export function encodeCodeEntryCpaceHostTag(publicKey: Uint8Array, tag: Uint8Array): Uint8Array {
  return concatBytes(encodeBytes(1, publicKey), encodeBytes(2, tag));
}

export function decodeCodeEntryCpaceHostTag(payload: Uint8Array): {
  publicKey: Uint8Array;
  tag: Uint8Array;
} {
  const fields = decodeFields(payload);
  return {
    publicKey: readOptionalBytes(fields, 1) ?? new Uint8Array(),
    tag: readOptionalBytes(fields, 2) ?? new Uint8Array(),
  };
}

export function encodeCodeEntrySecret(secret: Uint8Array): Uint8Array {
  return encodeBytes(1, secret);
}

export function decodeCodeEntrySecret(payload: Uint8Array): Uint8Array {
  return readOptionalBytes(decodeFields(payload), 1) ?? new Uint8Array();
}

export function encodeCredentialMetadata(meta: CredentialMetadata): Uint8Array {
  const parts = [encodeString(1, meta.hostName), encodeString(3, meta.appName)];
  if (meta.autoconnect) {
    parts.splice(1, 0, encodeBool(2, true));
  }
  return concatBytes(...parts);
}

export function decodeCredentialMetadata(payload: Uint8Array): CredentialMetadata {
  const fields = decodeFields(payload);
  return {
    hostName: readOptionalString(fields, 1) ?? '',
    appName: readOptionalString(fields, 3) ?? '',
    autoconnect: readOptionalBool(fields, 2) === true,
  };
}

export function encodePairingCredential(meta: CredentialMetadata, mac: Uint8Array): Uint8Array {
  return concatBytes(encodeMessage(1, encodeCredentialMetadata(meta)), encodeBytes(2, mac));
}

export function decodePairingCredential(payload: Uint8Array): {
  meta: CredentialMetadata;
  mac: Uint8Array;
} {
  const fields = decodeFields(payload);
  return {
    meta: decodeCredentialMetadata(readOptionalBytes(fields, 1) ?? new Uint8Array()),
    mac: readOptionalBytes(fields, 2) ?? new Uint8Array(),
  };
}

export function encodeAuthenticatedCredentialData(
  hostStaticPublicKey: Uint8Array,
  meta: CredentialMetadata,
): Uint8Array {
  return concatBytes(
    encodeBytes(1, hostStaticPublicKey),
    encodeMessage(2, encodeCredentialMetadata(meta)),
  );
}

export function encodeCredentialRequest(hostStaticPublicKey: Uint8Array, autoconnect = false): Uint8Array {
  const parts = [encodeBytes(1, hostStaticPublicKey)];
  if (autoconnect) {
    parts.push(encodeBool(2, true));
  }
  return concatBytes(...parts);
}

export function decodeCredentialRequest(payload: Uint8Array): {
  hostStaticPublicKey: Uint8Array;
  autoconnect: boolean;
} {
  const fields = decodeFields(payload);
  return {
    hostStaticPublicKey: readOptionalBytes(fields, 1) ?? new Uint8Array(),
    autoconnect: readOptionalBool(fields, 2) === true,
  };
}

export function encodeCredentialResponse(
  trezorStaticPublicKey: Uint8Array,
  credential: Uint8Array,
): Uint8Array {
  return concatBytes(encodeBytes(1, trezorStaticPublicKey), encodeBytes(2, credential));
}

export function decodeCredentialResponse(payload: Uint8Array): {
  trezorStaticPublicKey: Uint8Array;
  credential: Uint8Array;
} {
  const fields = decodeFields(payload);
  return {
    trezorStaticPublicKey: readOptionalBytes(fields, 1) ?? new Uint8Array(),
    credential: readOptionalBytes(fields, 2) ?? new Uint8Array(),
  };
}

export function encodeHandshakeCompletionPayload(credential?: Uint8Array): Uint8Array {
  return credential ? encodeBytes(1, credential) : new Uint8Array();
}

export function decodeHandshakeCompletionPayload(payload: Uint8Array): Uint8Array | undefined {
  return readOptionalBytes(decodeFields(payload), 1);
}

export function decodeCreateNewSession(payload: Uint8Array): {
  passphrase: string | undefined;
  onDevice: boolean;
} {
  const fields = decodeFields(payload);
  return {
    passphrase: readOptionalString(fields, 1),
    onDevice: readOptionalBool(fields, 2) === true,
  };
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

export function decodeFailure(payload: Uint8Array): { code: number; message: string } {
  const fields = decodeFields(payload);
  return {
    code: readOptionalUint32(fields, 1) ?? 0,
    message: readOptionalString(fields, 2) ?? '',
  };
}

export function decodeFeatures(payload: Uint8Array): {
  vendor: string;
  major: number;
  minor: number;
  patch: number;
  model: string;
  internalModel: string;
  initialized: boolean;
} {
  const fields = decodeFields(payload);
  return {
    vendor: readOptionalString(fields, 1) ?? '',
    major: readOptionalUint32(fields, 2) ?? 0,
    minor: readOptionalUint32(fields, 3) ?? 0,
    patch: readOptionalUint32(fields, 4) ?? 0,
    model: readOptionalString(fields, 21) ?? '',
    internalModel: readOptionalString(fields, 44) ?? '',
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
  return readOptionalUint32(decodeFields(payload), 1) ?? 0;
}

export function isEthSignTx(type: number): boolean {
  return type === MessageType.EthereumSignTx || type === MessageType.EthereumSignTxEIP1559;
}
