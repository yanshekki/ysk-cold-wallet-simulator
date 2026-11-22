import { concatBytes, encodeAscii, readU16BE, readU32BE } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  pathToString,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import {
  deriveHdNodeFromSeed,
  derivePrivateKeyFromSeed,
  ethereumAddressFromPrivateKey,
  publicKeyUncompressed,
  seedFor,
  signPersonalMessage,
  signSecp256k1Recoverable,
} from '../crypto';
import type { BackupKind, ConfirmationPort, SigningRequest } from '@cws/contracts';
import {
  catalogVersion,
  describeEthMessage,
  describeEthTransaction,
  describeEthTypedData,
  describeHostSuppliedHash,
  evmSignTitle,
  hashTypedData,
  parseEip712,
  parseEthTx,
  resolveEvmNativeGas,
  type Eip712TypedData,
} from '@cws/contracts';
import { keccak_256 } from '@noble/hashes/sha3';

/** Ledger SDK `SWO_INCORRECT_DATA` — app-ethereum 1.24.0 RLP / personal-sign / V2 TLV faults. */
const SW_INCORRECT_DATA = 0x6a80;
/** Ledger SDK `SWO_COMMAND_NOT_ALLOWED` — mixed EIP-712 V1/V2 (`doc/apdu.md` 1.24.0). */
const SW_COMMAND_NOT_ALLOWED = 0x6980;
/** Ledger SDK `SWO_WRONG_P1_P2` — SIGN EIP 712 unknown P2 (`doc/apdu.md` 1.24.0). */
const SW_WRONG_PARAMETER = 0x6b00;
const ETH_APP_1_24_0 = '1.24.0';
const MAX_PERSONAL_SIGN_U16 = 0xffff;

function reportedEthereumVersion(): string {
  return catalogVersion('ethereum', '1.23.0');
}

function compareAppVersion(a: string, b: string): number {
  const av = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const bv = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function ethereumAppAtLeast(min: string): boolean {
  return compareAppVersion(reportedEthereumVersion(), min) >= 0;
}

function ethAppVersionBytes(): Uint8Array {
  const version = reportedEthereumVersion();
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return Uint8Array.of(0x01, major & 0xff, minor & 0xff, patch & 0xff);
}

export const ETH_APP_VERSION = ethAppVersionBytes();
export const MAX_PERSONAL_SIGN_BYTES = 16_384;

type TypedField = { name: string; type: string };

type TypedStream = {
  types: Record<string, TypedField[]>;
  currentStruct?: string;
  rootStruct?: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType?: string;
  json?: Uint8Array;
};

type Eip712V2Chunk = {
  expected: number;
  data: Uint8Array;
};

type Eip712V2State = {
  schemaChunk?: Eip712V2Chunk;
  valuesChunk?: Eip712V2Chunk;
  types?: Eip712TypedData['types'];
  typed?: Eip712TypedData;
  path?: string;
};

export type EthSession = {
  pendingPersonal?: {
    path: string;
    expected: number;
    message: Uint8Array;
  };
  pendingTx?: {
    path: string;
    payload: Uint8Array;
  };
  pending712?: {
    path: string;
    payload: Uint8Array;
  };
  typed712?: TypedStream;
  eip712Flow?: 'v1' | 'v2';
  v2?: Eip712V2State;
  token?: { ticker: string; decimals: number; contract: Uint8Array };
  nft?: { collection: string; contract: Uint8Array };
  network?: { ticker: string; chainId: number; name?: string };
  challenge?: Uint8Array;
};

export type EthContext = {
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  session: EthSession;
  /** Open Ledger app. Avalanche C-Chain uses this handler on CLA 0xE0. */
  app?: string;
  /** Phone hot-wallet policy. Firmware P1=0 stays silent when this is unset. */
  confirmSilentPublic?: boolean;
};

export async function handleEthereumApdu(apdu: Apdu, ctx: EthContext): Promise<Uint8Array | null> {
  switch (apdu.ins) {
    case 0x06:
      return encodeResponse(ethAppVersionBytes(), SW_OK);
    case 0x02:
      return handleGetAddress(apdu, ctx);
    case 0x08:
      return handlePersonalSign(apdu, ctx);
    case 0x04:
      return handleSignTx(apdu, ctx);
    case 0x0c:
      return handleEip712Sign(apdu, ctx);
    case 0x1a:
      return handleEip712Definition(apdu, ctx);
    case 0x1c:
      return handleEip712Implementation(apdu, ctx);
    case 0x0a:
      return handleProvideErc20(apdu, ctx);
    case 0x12:
    case 0x16:
      return encodeResponse(new Uint8Array(), SW_OK);
    case 0x1e:
      if (ctx.session.eip712Flow === 'v2') {
        return encodeResponse(new Uint8Array(), SW_COMMAND_NOT_ALLOWED);
      }
      return encodeResponse(new Uint8Array(), SW_OK);
    case 0x14:
      return handleProvideNft(apdu, ctx);
    case 0x20:
      return handleGetChallenge(ctx);
    case 0x30:
      return handleProvideNetwork(apdu, ctx);
    case 0x34:
      return handleSign7702(apdu, ctx);
    default:
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
}

function ethPath(ctx: EthContext, path: string): string {
  return ctx.confirmation.resolvePath?.(path, ['eth']) ?? path;
}

async function handleGetAddress(apdu: Apdu, ctx: EthContext): Promise<Uint8Array> {
  let apduPath: string;
  try {
    apduPath = parseBip32Path(apdu.data).path;
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  const path = ethPath(ctx, apduPath);
  if (apdu.p1 === 0x01 || ctx.confirmSilentPublic) {
    const request: SigningRequest = {
      brand: 'ledger',
      kind: 'address',
      title: 'Export Ethereum address',
      path,
      message: `Export Ethereum address\n${path}`,
      rawPayload: apdu.data,
    };
    const ok = await ctx.confirmation.confirm(request);
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const node = deriveHdNodeFromSeed(seed, path);
  const pub = publicKeyUncompressed(node.privateKey);
  const address = ethereumAddressFromPrivateKey(node.privateKey);
  const addressBytes = encodeAscii(address);
  const body = concatBytes(
    Uint8Array.of(pub.length),
    pub,
    Uint8Array.of(addressBytes.length),
    addressBytes,
    apdu.p2 === 0x01 ? node.chainCode : new Uint8Array(),
  );
  return encodeResponse(body, SW_OK);
}

async function handlePersonalSign(apdu: Apdu, ctx: EthContext): Promise<Uint8Array | null> {
  if (apdu.p1 === 0x00) {
    let apduPath: string;
    let rest: Uint8Array;
    try {
      const parsed = parseBip32Path(apdu.data);
      apduPath = parsed.path;
      rest = parsed.rest;
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
    }
    if (rest.length < 4) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    const expected = readU32BE(rest, 0);
    if (expected > MAX_PERSONAL_SIGN_U16 || expected > MAX_PERSONAL_SIGN_BYTES) {
      // 1.24.0 V-030: the length is a full u32; values above 16 bits must not
      // truncate. Official MAX_MSG_LENGTH is 32766; CWS keeps the 16384 cap.
      return encodeResponse(new Uint8Array(), personalSignLengthSw());
    }
    ctx.session.pendingPersonal = {
      path: ethPath(ctx, apduPath),
      expected,
      message: rest.slice(4),
    };
  } else if (apdu.p1 === 0x80) {
    if (!ctx.session.pendingPersonal) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    ctx.session.pendingPersonal.message = concatBytes(
      ctx.session.pendingPersonal.message,
      apdu.data,
    );
  } else {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }

  const pending = ctx.session.pendingPersonal;
  if (!pending) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  if (pending.message.length < pending.expected) {
    // transport.send waits for a status word before the next P1=0x80 chunk.
    return encodeResponse(new Uint8Array(), SW_OK);
  }

  const message = pending.message.slice(0, pending.expected);
  ctx.session.pendingPersonal = undefined;
  const preview = previewMessage(message);
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign message',
    path: pending.path,
    message: `Sign personal message\n${pending.path}\n${preview}`,
    rawPayload: message,
    detail: describeEthMessage(pending.path, message),
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const privateKey = derivePrivateKeyFromSeed(seed, pending.path);
  const signature = signPersonalMessage(privateKey, message);
  return encodeResponse(signature, SW_OK);
}

async function handleSignTx(apdu: Apdu, ctx: EthContext): Promise<Uint8Array | null> {
  if (apdu.data.length === 0) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  if (apdu.p1 === 0x00) {
    let path: string;
    let rest: Uint8Array;
    try {
      const parsed = parseBip32Path(apdu.data);
      path = ethPath(ctx, parsed.path);
      rest = parsed.rest;
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    ctx.session.pendingTx = { path, payload: rest };
  } else if (apdu.p1 === 0x80 && ctx.session.pendingTx) {
    ctx.session.pendingTx.payload = concatBytes(ctx.session.pendingTx.payload, apdu.data);
  } else {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }

  const pending = ctx.session.pendingTx;
  if (!pending) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const needed = rlpFullLength(pending.payload);
  const waiting = needed == null || pending.payload.length < needed;
  const shortGarbage =
    waiting && needed == null && (apdu.p1 === 0x80 || (apdu.p1 === 0x00 && apdu.data.length < 255));
  if (waiting && !shortGarbage) {
    // The Ethereum app replies 9000 while the RLP is still open. Silence here
    // stalls transport.send, so the host never sends the rest and review never starts.
    return encodeResponse(new Uint8Array(), SW_OK);
  }

  const raw = needed != null ? pending.payload.slice(0, needed) : pending.payload;
  if (ethereumAppAtLeast(ETH_APP_1_24_0)) {
    // app-ethereum 1.24.0 V-363: trailing bytes after a complete RLP item and
    // non-canonical length/single-byte encodings are USTREAM_FAULT → 0x6A80.
    const trailing = needed != null && pending.payload.length > needed;
    if (trailing || !rlpEncodingCanonical(raw)) {
      ctx.session.pendingTx = undefined;
      return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
    }
  }
  ctx.session.pendingTx = undefined;
  const parsed = parseEthTx(raw);
  if (!parsed) {
    return encodeResponse(
      new Uint8Array(),
      ethereumAppAtLeast(ETH_APP_1_24_0) ? SW_INCORRECT_DATA : SW_INS_NOT_SUPPORTED,
    );
  }
  const gas = resolveEvmNativeGas({
    chainId: parsed.chainId,
    app: ctx.app,
    host: ctx.session.network,
  });
  const title = evmSignTitle(gas);
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title,
    path: pending.path,
    message: `${title}\n${pending.path}\n0x${Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 96)}`,
    rawPayload: raw,
    detail: describeEthTransaction({
      ...parsed,
      path: pending.path,
      token: ctx.session.token,
      app: ctx.app,
      hostNetwork: ctx.session.network,
    }),
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const privateKey = derivePrivateKeyFromSeed(seed, pending.path);
  const hash = keccak_256(raw);
  const sig = signSecp256k1Recoverable(privateKey, hash);
  const typed = raw[0] <= 0x04;
  const v = typed ? sig[64] : (sig[64] ?? 0) + 27;
  return encodeResponse(concatBytes(Uint8Array.of(v), sig.subarray(0, 64)), SW_OK);
}

async function handleEip712Sign(apdu: Apdu, ctx: EthContext): Promise<Uint8Array> {
  if (apdu.p2 === 0x02) {
    return handleEip712V2Sign(apdu, ctx);
  }
  const mixed = refuseOtherEip712Flow(ctx, 'v1');
  if (mixed) {
    return mixed;
  }
  if (apdu.p2 !== 0x00 && apdu.p2 !== 0x01) {
    return encodeResponse(new Uint8Array(), SW_WRONG_PARAMETER);
  }
  let path: string;
  let rest: Uint8Array;
  try {
    const parsed = parseBip32Path(apdu.data);
    path = ethPath(ctx, parsed.path);
    rest = parsed.rest;
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  beginEip712Flow(ctx, 'v1');
  if (apdu.p2 === 0x01) {
    return signTypedStream(ctx, path);
  }
  if (rest.length < 64) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const domain = rest.subarray(0, 32);
  const structHash = rest.subarray(32, 64);
  const digest = keccak_256(concatBytes(Uint8Array.of(0x19, 0x01), domain, structHash));
  return finishTypedSign(ctx, path, digest, rest.subarray(0, 64), `Sign EIP-712 hashed message\n${path}`, {
    title: 'Sign host-supplied hash',
    detail: describeHostSuppliedHash({ path, domainHash: domain, messageHash: structHash }),
  });
}

function typedStream(ctx: EthContext): TypedStream {
  ctx.session.typed712 ??= { types: {}, domain: {}, message: {} };
  return ctx.session.typed712;
}

function handleEip712Definition(apdu: Apdu, ctx: EthContext): Uint8Array {
  if (apdu.p2 === 0x02) {
    return handleEip712V2Schema(apdu, ctx);
  }
  const mixed = refuseOtherEip712Flow(ctx, 'v1');
  if (mixed) {
    return mixed;
  }
  beginEip712Flow(ctx, 'v1');
  const stream = typedStream(ctx);
  if (apdu.p2 === 0x00) {
    stream.currentStruct = encodeAsciiToString(apdu.data);
    stream.types[stream.currentStruct] = [];
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  if (apdu.p2 !== 0xff || !stream.currentStruct) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  const field = parseStructField(apdu.data);
  if (!field) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  stream.types[stream.currentStruct] = [...(stream.types[stream.currentStruct] ?? []), field];
  return encodeResponse(new Uint8Array(), SW_OK);
}

function handleEip712Implementation(apdu: Apdu, ctx: EthContext): Uint8Array {
  if (apdu.p2 === 0x02) {
    return handleEip712V2Values(apdu, ctx);
  }
  const mixed = refuseOtherEip712Flow(ctx, 'v1');
  if (mixed) {
    return mixed;
  }
  beginEip712Flow(ctx, 'v1');
  const jsonish = looksLikeJson(apdu.data);
  if (jsonish) {
    const stream = typedStream(ctx);
    stream.json = jsonish;
    try {
      const parsed = parseEip712(jsonish);
      stream.types = parsed.types;
      stream.primaryType = parsed.primaryType;
      stream.domain = parsed.domain;
      stream.message = parsed.message;
    } catch {
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
    }
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const stream = typedStream(ctx);
  if (apdu.p2 === 0x00) {
    stream.rootStruct = encodeAsciiToString(apdu.data);
    if (stream.rootStruct !== 'EIP712Domain') {
      stream.primaryType = stream.rootStruct;
    }
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  if (apdu.p2 === 0x0f) {
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  if (apdu.p2 !== 0xff || !stream.rootStruct) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  if (apdu.data.length < 2) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const valueLen = (apdu.data[0]! << 8) | apdu.data[1]!;
  const raw = apdu.data.subarray(2, 2 + valueLen);
  const target = stream.rootStruct === 'EIP712Domain' ? stream.domain : stream.message;
  const fields = stream.types[stream.rootStruct] ?? [];
  const field = fields[Object.keys(target).length];
  if (!field) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  target[field.name] = decodeFieldValue(field.type, raw);
  return encodeResponse(new Uint8Array(), SW_OK);
}

async function signTypedStream(ctx: EthContext, path: string): Promise<Uint8Array> {
  const stream = ctx.session.typed712;
  ctx.session.typed712 = undefined;
  if (!stream) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const typed: Eip712TypedData = stream.json
    ? parseEip712(stream.json)
    : {
        types: stream.types,
        primaryType: stream.primaryType ?? 'Mail',
        domain: stream.domain,
        message: stream.message,
      };
  let digest: Uint8Array;
  try {
    digest = hashTypedData(typed);
  } catch {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  const raw = stream.json ?? new TextEncoder().encode(JSON.stringify(typed));
  return finishTypedSign(ctx, path, digest, raw, `Sign EIP-712 typed data\n${path}`);
}

async function finishTypedSign(
  ctx: EthContext,
  path: string,
  digest: Uint8Array,
  raw: Uint8Array,
  message: string,
  review?: { title: string; detail: SigningRequest['detail'] },
): Promise<Uint8Array> {
  endEip712(ctx);
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: review?.title ?? 'Sign EIP-712 typed data',
    path,
    message,
    rawPayload: raw,
    detail: review?.detail ?? describeEthTypedData(path, raw),
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const privateKey = derivePrivateKeyFromSeed(seed, path);
  const sig = signSecp256k1Recoverable(privateKey, digest);
  const v = (sig[64] ?? 0) + 27;
  return encodeResponse(concatBytes(Uint8Array.of(v), sig.subarray(0, 64)), SW_OK);
}

function looksLikeJson(data: Uint8Array): Uint8Array | null {
  if (data.length && data[0] === 0x7b) {
    return data;
  }
  try {
    const parsed = parseBip32Path(data);
    if (parsed.rest.length && parsed.rest[0] === 0x7b) {
      return parsed.rest;
    }
  } catch {
    return null;
  }
  return null;
}

function parseStructField(data: Uint8Array): TypedField | null {
  if (data.length < 3) {
    return null;
  }
  const desc = data[0]!;
  const typeCode = desc & 0x0f;
  const hasSize = (desc & 0x40) !== 0;
  const isArray = (desc & 0x80) !== 0;
  let offset = 1;
  let typeName = '';
  if (typeCode === 0) {
    const nameLen = data[offset] ?? 0;
    typeName = encodeAsciiToString(data.subarray(offset + 1, offset + 1 + nameLen));
    offset += 1 + nameLen;
  }
  let typeSize = 0;
  if (hasSize) {
    typeSize = data[offset] ?? 0;
    offset += 1;
  }
  if (isArray) {
    const levels = data[offset] ?? 0;
    offset += 1;
    for (let index = 0; index < levels; index += 1) {
      const kind = data[offset] ?? 0;
      offset += kind === 1 ? 2 : 1;
    }
  }
  const keyLen = data[offset] ?? 0;
  const name = encodeAsciiToString(data.subarray(offset + 1, offset + 1 + keyLen));
  if (!name) {
    return null;
  }
  return { name, type: solidityType(typeCode, typeName, typeSize, isArray) };
}

function solidityType(typeCode: number, typeName: string, typeSize: number, isArray: boolean): string {
  const bits = typeSize ? typeSize * 8 : 256;
  let type =
    typeCode === 0
      ? typeName
      : typeCode === 1
        ? `int${bits}`
        : typeCode === 2
          ? `uint${bits}`
          : typeCode === 3
            ? 'address'
            : typeCode === 4
              ? 'bool'
              : typeCode === 5
                ? 'string'
                : typeCode === 6
                  ? `bytes${typeSize || 32}`
                  : 'bytes';
  if (isArray) {
    type += '[]';
  }
  return type;
}

function decodeFieldValue(type: string, raw: Uint8Array): unknown {
  if (type === 'string' || type.startsWith('string')) {
    return encodeAsciiToString(raw);
  }
  if (type === 'address') {
    return `0x${Array.from(raw.subarray(raw.length - 20), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  if (type === 'bool') {
    return raw.some((byte) => byte !== 0);
  }
  if (type.startsWith('uint') || type.startsWith('int')) {
    return `0x${Array.from(raw, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  if (type === 'bytes' || type.startsWith('bytes')) {
    return `0x${Array.from(raw, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return encodeAsciiToString(raw);
}

function handleProvideNft(apdu: Apdu, ctx: EthContext): Uint8Array {
  const data = apdu.data;
  if (data.length < 2) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const nameLen = data[0]!;
  if (data.length < 1 + nameLen + 20) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  ctx.session.nft = {
    collection: encodeAsciiToString(data.subarray(1, 1 + nameLen)),
    contract: data.subarray(1 + nameLen, 1 + nameLen + 20).slice(),
  };
  return encodeResponse(new Uint8Array(), SW_OK);
}

function handleGetChallenge(ctx: EthContext): Uint8Array {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  ctx.session.challenge = challenge;
  return encodeResponse(challenge, SW_OK);
}

const NETWORK_TYPE = 0x01;
const NETWORK_CHAIN = 0x23;
const NETWORK_TICKER = 0x24;
const NETWORK_NAME = 0x52;
const DYNAMIC_NETWORK = 0x08;

function handleProvideNetwork(apdu: Apdu, ctx: EthContext): Uint8Array {
  if (apdu.p2 !== 0x00) {
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const parsed = readProvidedNetwork(apdu);
  if (parsed) {
    ctx.session.network = parsed;
  }
  return encodeResponse(new Uint8Array(), SW_OK);
}

function readProvidedNetwork(apdu: Apdu): EthSession['network'] | undefined {
  let data = apdu.data;
  if (apdu.p1 === 0x01 && data.length >= 2) {
    const declared = (data[0]! << 8) | data[1]!;
    const body = data.subarray(2);
    data = declared > 0 && declared <= body.length ? body.subarray(0, declared) : body;
  }
  const fields = parseTlv(data);
  if (!fields) {
    return undefined;
  }
  const type = fields.get(NETWORK_TYPE);
  if (type && (type.length !== 1 || type[0] !== DYNAMIC_NETWORK)) {
    return undefined;
  }
  const chainRaw = fields.get(NETWORK_CHAIN);
  const tickerRaw = fields.get(NETWORK_TICKER);
  if (!chainRaw || !tickerRaw) {
    return undefined;
  }
  const chainId = readU64(chainRaw);
  if (chainId == null || chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  const ticker = encodeAsciiToString(tickerRaw).replace(/\0+$/, '');
  if (!/^[A-Za-z][A-Za-z0-9]{1,11}$/.test(ticker)) {
    return undefined;
  }
  const nameRaw = fields.get(NETWORK_NAME);
  const nameText = nameRaw ? encodeAsciiToString(nameRaw).replace(/\0+$/, '').trim() : '';
  const name = /^[\x20-\x7e]{1,31}$/.test(nameText) ? nameText : undefined;
  return { ticker, chainId: Number(chainId), name };
}

const EIP7702_HEADLINE = 'EIP-7702 authorization';

function parseTlv(data: Uint8Array): Map<number, Uint8Array> | null {
  const fields = new Map<number, Uint8Array>();
  let offset = 0;
  while (offset < data.length) {
    if (offset + 2 > data.length) {
      return null;
    }
    const tag = data[offset]!;
    const len = data[offset + 1]!;
    offset += 2;
    if (offset + len > data.length) {
      return null;
    }
    fields.set(tag, data.subarray(offset, offset + len));
    offset += len;
  }
  return fields;
}

function readU64(bytes: Uint8Array): bigint | null {
  if (bytes.length === 0 || bytes.length > 8) {
    return null;
  }
  return readBig(bytes, 0, bytes.length);
}

function hex0x(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function handleSign7702(apdu: Apdu, ctx: EthContext): Promise<Uint8Array> {
  let path: string;
  let rest: Uint8Array;
  try {
    const parsed = parseBip32Path(apdu.data);
    path = ethPath(ctx, parsed.path);
    rest = parsed.rest;
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  if (rest.length < 2) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const structLen = (rest[0]! << 8) | rest[1]!;
  if (structLen < 1 || rest.length !== 2 + structLen) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const fields = parseTlv(rest.subarray(2));
  const version = fields?.get(0x00);
  const delegate = fields?.get(0x01);
  const chainRaw = fields?.get(0x02);
  const nonceRaw = fields?.get(0x03);
  const chainId = chainRaw ? readU64(chainRaw) : null;
  const nonce = nonceRaw ? readU64(nonceRaw) : null;
  if (!fields || !version || version.length !== 1 || version[0] !== 1 || !delegate || delegate.length !== 20 || chainId == null || nonce == null) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const digest = keccak_256(
    concatBytes(Uint8Array.of(0x05), rlpList([rlpInt(chainId), rlpBytes(delegate), rlpInt(nonce)])),
  );
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign EIP-7702 authorization',
    path,
    message: `Sign EIP-7702 authorization\n${path}`,
    rawPayload: rest,
    detail: {
      style: 'eth-tx',
      headline: EIP7702_HEADLINE,
      warning: 'This lets the contract act as this account.',
      fields: [
        { label: 'PATH', value: path, mono: true },
        { label: 'TO', value: hex0x(delegate), mono: true },
        { label: 'CHAIN ID', value: chainId.toString() },
        { label: 'NONCE', value: nonce.toString() },
      ],
    },
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const sig = signSecp256k1Recoverable(derivePrivateKeyFromSeed(seed, path), digest);
  return encodeResponse(concatBytes(Uint8Array.of(sig[64] ?? 0), sig.subarray(0, 64)), SW_OK);
}

function readBig(bytes: Uint8Array, offset: number, size: number): bigint {
  let value = 0n;
  for (let index = 0; index < size; index += 1) {
    value = (value << 8n) + BigInt(bytes[offset + index] ?? 0);
  }
  return value;
}

function rlpBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 1 && bytes[0]! < 0x80) {
    return bytes;
  }
  if (bytes.length <= 55) {
    return concatBytes(Uint8Array.of(0x80 + bytes.length), bytes);
  }
  const len = Uint8Array.of((bytes.length >> 8) & 0xff, bytes.length & 0xff);
  return concatBytes(Uint8Array.of(0xb7 + len.length), len, bytes);
}

function rlpInt(value: bigint): Uint8Array {
  if (value === 0n) {
    return Uint8Array.of(0x80);
  }
  const raw: number[] = [];
  let next = value;
  while (next > 0n) {
    raw.unshift(Number(next & 0xffn));
    next >>= 8n;
  }
  return rlpBytes(Uint8Array.from(raw));
}

function rlpList(items: Uint8Array[]): Uint8Array {
  const body = concatBytes(...items);
  if (body.length <= 55) {
    return concatBytes(Uint8Array.of(0xc0 + body.length), body);
  }
  const len = Uint8Array.of((body.length >> 8) & 0xff, body.length & 0xff);
  return concatBytes(Uint8Array.of(0xf7 + len.length), len, body);
}

function handleProvideErc20(apdu: Apdu, ctx: EthContext): Uint8Array {
  const data = apdu.data;
  if (data.length < 2) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const tickerLen = data[0]!;
  if (data.length < 1 + tickerLen + 20) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const ticker = encodeAsciiToString(data.subarray(1, 1 + tickerLen));
  const offset = 1 + tickerLen;
  const contract = data.subarray(offset, offset + 20).slice();
  const decimals = data.length >= offset + 24 ? readU32BE(data, offset + 20) : 18;
  ctx.session.token = { ticker, decimals, contract };
  return encodeResponse(new Uint8Array(), SW_OK);
}

function encodeAsciiToString(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

function personalSignLengthSw(): number {
  return ethereumAppAtLeast(ETH_APP_1_24_0) ? SW_INCORRECT_DATA : SW_WRONG_LENGTH;
}

function refuseOtherEip712Flow(ctx: EthContext, want: 'v1' | 'v2'): Uint8Array | null {
  if (ctx.session.eip712Flow && ctx.session.eip712Flow !== want) {
    return encodeResponse(new Uint8Array(), SW_COMMAND_NOT_ALLOWED);
  }
  return null;
}

function beginEip712Flow(ctx: EthContext, flow: 'v1' | 'v2'): void {
  ctx.session.eip712Flow = flow;
}

function endEip712(ctx: EthContext): void {
  ctx.session.eip712Flow = undefined;
  ctx.session.typed712 = undefined;
  ctx.session.v2 = undefined;
}

function eip712Busy(ctx: EthContext): boolean {
  return Boolean(ctx.session.pendingTx || ctx.session.pendingPersonal);
}

function rlpTypeOffset(bytes: Uint8Array): number {
  if (bytes.length > 1 && bytes[0]! <= 0x04 && bytes[1]! >= 0xc0) {
    return 1;
  }
  return 0;
}

function rlpFullLength(bytes: Uint8Array): number | null {
  if (bytes.length === 0) {
    return null;
  }
  const offset = rlpTypeOffset(bytes);
  const inner = rlpLengthAt(bytes, offset);
  return inner == null ? null : inner + offset;
}

/** Outer item consumes `bytes` exactly, with canonical prefixes (1.24.0 rlp_utils.c / eth_ustream.c). */
function rlpEncodingCanonical(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }
  const offset = rlpTypeOffset(bytes);
  const inspected = inspectRlpItem(bytes, offset);
  return inspected != null && inspected.canonical && inspected.end === bytes.length;
}

function rlpLengthAt(bytes: Uint8Array, offset: number): number | null {
  if (offset >= bytes.length) {
    return null;
  }
  const prefix = bytes[offset];
  if (prefix <= 0x7f) {
    return 1;
  }
  if (prefix <= 0xb7) {
    return 1 + (prefix - 0x80);
  }
  if (prefix <= 0xbf) {
    const lenOfLen = prefix - 0xb7;
    if (bytes.length < offset + 1 + lenOfLen) {
      return null;
    }
    const len = readInt(bytes, offset + 1, lenOfLen);
    return 1 + lenOfLen + len;
  }
  if (prefix <= 0xf7) {
    return 1 + (prefix - 0xc0);
  }
  const lenOfLen = prefix - 0xf7;
  if (bytes.length < offset + 1 + lenOfLen) {
    return null;
  }
  const len = readInt(bytes, offset + 1, lenOfLen);
  return 1 + lenOfLen + len;
}

function readInt(bytes: Uint8Array, offset: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) {
    value = (value << 8) + bytes[offset + i];
  }
  return value;
}

function inspectRlpItem(
  bytes: Uint8Array,
  offset: number,
): { end: number; canonical: boolean } | null {
  if (offset >= bytes.length) {
    return null;
  }
  const prefix = bytes[offset]!;
  if (prefix <= 0x7f) {
    return { end: offset + 1, canonical: true };
  }
  if (prefix <= 0xb7) {
    const len = prefix - 0x80;
    if (bytes.length < offset + 1 + len) {
      return null;
    }
    const canonical = !(len === 1 && bytes[offset + 1]! <= 0x7f);
    return { end: offset + 1 + len, canonical };
  }
  if (prefix <= 0xbf) {
    const lenOfLen = prefix - 0xb7;
    if (bytes.length < offset + 1 + lenOfLen) {
      return null;
    }
    const len = readInt(bytes, offset + 1, lenOfLen);
    if (bytes.length < offset + 1 + lenOfLen + len) {
      return null;
    }
    const canonical = len >= 56 && bytes[offset + 1] !== 0;
    return { end: offset + 1 + lenOfLen + len, canonical };
  }
  if (prefix <= 0xf7) {
    const len = prefix - 0xc0;
    const start = offset + 1;
    if (bytes.length < start + len) {
      return null;
    }
    const inner = inspectRlpListPayload(bytes, start, start + len);
    if (!inner) {
      return null;
    }
    return { end: start + len, canonical: inner.canonical };
  }
  const lenOfLen = prefix - 0xf7;
  if (bytes.length < offset + 1 + lenOfLen) {
    return null;
  }
  const len = readInt(bytes, offset + 1, lenOfLen);
  if (bytes.length < offset + 1 + lenOfLen + len) {
    return null;
  }
  const headerCanonical = len >= 56 && bytes[offset + 1] !== 0;
  const start = offset + 1 + lenOfLen;
  const inner = inspectRlpListPayload(bytes, start, start + len);
  if (!inner) {
    return null;
  }
  return { end: start + len, canonical: headerCanonical && inner.canonical };
}

function inspectRlpListPayload(
  bytes: Uint8Array,
  start: number,
  end: number,
): { canonical: boolean } | null {
  let pos = start;
  let canonical = true;
  while (pos < end) {
    const item = inspectRlpItem(bytes, pos);
    if (!item || item.end > end) {
      return null;
    }
    canonical = canonical && item.canonical;
    pos = item.end;
  }
  if (pos !== end) {
    return null;
  }
  return { canonical };
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
  return `0x${Array.from(message, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 96)}`;
}

const SOLTYPE_STRUCT = 0;
const SOLTYPE_INT = 1;
const SOLTYPE_UINT = 2;
const SOLTYPE_ADDRESS = 3;
const SOLTYPE_BOOL = 4;
const SOLTYPE_STRING = 5;
const SOLTYPE_BYTES_FIX = 6;
const SOLTYPE_BYTES_DYN = 7;

type TlvItem = { tag: number; value: Uint8Array };

function handleEip712V2Schema(apdu: Apdu, ctx: EthContext): Uint8Array {
  const first = apdu.p1 === 0x01;
  if (!first && apdu.p1 !== 0x00) {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  const mixed = refuseOtherEip712Flow(ctx, 'v2');
  if (mixed) {
    return mixed;
  }
  const v2 = ctx.session.v2;
  if (first) {
    if (eip712Busy(ctx) || v2?.types || v2?.schemaChunk) {
      return encodeResponse(new Uint8Array(), SW_COMMAND_NOT_ALLOWED);
    }
    beginEip712Flow(ctx, 'v2');
    ctx.session.v2 = {};
  } else if (!v2?.schemaChunk) {
    return encodeResponse(new Uint8Array(), SW_COMMAND_NOT_ALLOWED);
  }
  const taken = takeTlvChunk(first, apdu.data, ctx.session.v2?.schemaChunk);
  if (taken.status === 'error') {
    endEip712(ctx);
    return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
  }
  if (taken.status === 'pending') {
    ctx.session.v2 = { ...ctx.session.v2, schemaChunk: taken.chunk };
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const types = parseEip712Schema(taken.payload!);
  if (!types) {
    endEip712(ctx);
    return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
  }
  ctx.session.v2 = { types };
  return encodeResponse(new Uint8Array(), SW_OK);
}

function handleEip712V2Values(apdu: Apdu, ctx: EthContext): Uint8Array {
  const first = apdu.p1 === 0x01;
  if (!first && apdu.p1 !== 0x00) {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  const mixed = refuseOtherEip712Flow(ctx, 'v2');
  if (mixed) {
    return mixed;
  }
  const v2 = ctx.session.v2;
  if (!v2?.types || ctx.session.eip712Flow !== 'v2') {
    return encodeResponse(new Uint8Array(), SW_COMMAND_NOT_ALLOWED);
  }
  if (first && (v2.typed || v2.valuesChunk)) {
    return encodeResponse(new Uint8Array(), SW_COMMAND_NOT_ALLOWED);
  }
  if (!first && !v2.valuesChunk) {
    return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
  }
  const taken = takeTlvChunk(first, apdu.data, v2.valuesChunk);
  if (taken.status === 'error') {
    endEip712(ctx);
    return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
  }
  if (taken.status === 'pending') {
    ctx.session.v2 = { ...v2, valuesChunk: taken.chunk };
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const parsed = parseEip712Values(taken.payload!, v2.types);
  if (!parsed) {
    endEip712(ctx);
    return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
  }
  ctx.session.v2 = {
    types: v2.types,
    typed: parsed.typed,
    path: ethPath(ctx, parsed.path),
  };
  return encodeResponse(new Uint8Array(), SW_OK);
}

async function handleEip712V2Sign(apdu: Apdu, ctx: EthContext): Promise<Uint8Array> {
  if (apdu.p1 !== 0x00) {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  if (apdu.data.length !== 0) {
    return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
  }
  const mixed = refuseOtherEip712Flow(ctx, 'v2');
  if (mixed) {
    return mixed;
  }
  const v2 = ctx.session.v2;
  if (ctx.session.eip712Flow !== 'v2' || !v2?.typed || !v2.path) {
    return encodeResponse(new Uint8Array(), SW_COMMAND_NOT_ALLOWED);
  }
  let digest: Uint8Array;
  try {
    digest = hashTypedData(v2.typed);
  } catch {
    endEip712(ctx);
    return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
  }
  const raw = new TextEncoder().encode(JSON.stringify(v2.typed));
  return finishTypedSign(ctx, v2.path, digest, raw, `Sign EIP-712 typed data\n${v2.path}`);
}

function takeTlvChunk(
  first: boolean,
  data: Uint8Array,
  existing: Eip712V2Chunk | undefined,
): { status: 'pending' | 'ready' | 'error'; chunk?: Eip712V2Chunk; payload?: Uint8Array } {
  if (first) {
    if (data.length < 2) {
      return { status: 'error' };
    }
    const expected = readU16BE(data, 0);
    if (expected === 0) {
      return { status: 'error' };
    }
    const piece = data.subarray(2);
    if (piece.length > expected) {
      return { status: 'error' };
    }
    if (piece.length === expected) {
      return { status: 'ready', payload: piece };
    }
    return { status: 'pending', chunk: { expected, data: piece.slice() } };
  }
  if (!existing) {
    return { status: 'error' };
  }
  const next = concatBytes(existing.data, data);
  if (next.length > existing.expected) {
    return { status: 'error' };
  }
  if (next.length === existing.expected) {
    return { status: 'ready', payload: next };
  }
  return { status: 'pending', chunk: { expected: existing.expected, data: next } };
}

function readDerLength(bytes: Uint8Array, offset: number): { length: number; offset: number } | null {
  if (offset >= bytes.length) {
    return null;
  }
  const first = bytes[offset]!;
  if (first < 0x80) {
    return { length: first, offset: offset + 1 };
  }
  if (first === 0x81) {
    if (offset + 1 >= bytes.length) {
      return null;
    }
    return { length: bytes[offset + 1]!, offset: offset + 2 };
  }
  if (first === 0x82) {
    if (offset + 2 >= bytes.length) {
      return null;
    }
    return { length: (bytes[offset + 1]! << 8) | bytes[offset + 2]!, offset: offset + 3 };
  }
  return null;
}

function readTlvItems(bytes: Uint8Array): TlvItem[] | null {
  const items: TlvItem[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = bytes[offset]!;
    const der = readDerLength(bytes, offset + 1);
    if (!der || der.offset + der.length > bytes.length) {
      return null;
    }
    items.push({ tag, value: bytes.subarray(der.offset, der.offset + der.length) });
    offset = der.offset + der.length;
  }
  return items;
}

function tlvValues(items: TlvItem[], tag: number): Uint8Array[] {
  return items.filter((item) => item.tag === tag).map((item) => item.value);
}

function tlvOne(items: TlvItem[], tag: number): Uint8Array | undefined {
  const found = tlvValues(items, tag);
  return found.length === 1 ? found[0] : undefined;
}

type Eip712V2Types = Eip712TypedData['types'];

function parseEip712Schema(bytes: Uint8Array): Eip712V2Types | null {
  const items = readTlvItems(bytes);
  if (!items) {
    return null;
  }
  const version = tlvOne(items, 0x00);
  if (!version || version.length !== 1 || version[0] !== 0x01) {
    return null;
  }
  const structs = tlvValues(items, 0x01);
  if (structs.length === 0) {
    return null;
  }
  const types: Eip712V2Types = {};
  for (const raw of structs) {
    const parsed = parseEip712Struct(raw);
    if (!parsed || types[parsed.name]) {
      return null;
    }
    types[parsed.name] = parsed.fields;
  }
  return types;
}

function parseEip712Struct(bytes: Uint8Array): { name: string; fields: { name: string; type: string }[] } | null {
  const items = readTlvItems(bytes);
  if (!items) {
    return null;
  }
  const version = tlvOne(items, 0x00);
  const nameRaw = tlvOne(items, 0x01);
  if (!version || version.length !== 1 || version[0] !== 0x01 || !nameRaw || nameRaw.length === 0) {
    return null;
  }
  const name = encodeAsciiToString(nameRaw);
  const fields: { name: string; type: string }[] = [];
  for (const raw of tlvValues(items, 0x02)) {
    const field = parseEip712SchemaField(raw);
    if (!field) {
      return null;
    }
    fields.push(field);
  }
  return { name, fields };
}

function parseEip712SchemaField(bytes: Uint8Array): { name: string; type: string } | null {
  const items = readTlvItems(bytes);
  if (!items) {
    return null;
  }
  const version = tlvOne(items, 0x00);
  const nameRaw = tlvOne(items, 0x01);
  const typeRaw = tlvOne(items, 0x02);
  if (!version || version.length !== 1 || version[0] !== 0x01 || !nameRaw || !typeRaw || typeRaw.length !== 1) {
    return null;
  }
  const solType = typeRaw[0]!;
  const sizeRaw = tlvOne(items, 0x03);
  const structNameRaw = tlvOne(items, 0x05);
  const dims = tlvValues(items, 0x04);
  let typeName = '';
  if (solType === SOLTYPE_STRUCT) {
    if (!structNameRaw || sizeRaw) {
      return null;
    }
    typeName = encodeAsciiToString(structNameRaw);
  } else if (solType === SOLTYPE_INT || solType === SOLTYPE_UINT) {
    if (!sizeRaw || sizeRaw.length !== 1 || sizeRaw[0]! < 1 || sizeRaw[0]! > 32 || structNameRaw) {
      return null;
    }
    typeName = `${solType === SOLTYPE_INT ? 'int' : 'uint'}${sizeRaw[0]! * 8}`;
  } else if (solType === SOLTYPE_BYTES_FIX) {
    if (!sizeRaw || sizeRaw.length !== 1 || sizeRaw[0]! < 1 || sizeRaw[0]! > 32 || structNameRaw) {
      return null;
    }
    typeName = `bytes${sizeRaw[0]!}`;
  } else if (solType === SOLTYPE_ADDRESS) {
    if (sizeRaw || structNameRaw) {
      return null;
    }
    typeName = 'address';
  } else if (solType === SOLTYPE_BOOL) {
    if (sizeRaw || structNameRaw) {
      return null;
    }
    typeName = 'bool';
  } else if (solType === SOLTYPE_STRING) {
    if (sizeRaw || structNameRaw) {
      return null;
    }
    typeName = 'string';
  } else if (solType === SOLTYPE_BYTES_DYN) {
    if (sizeRaw || structNameRaw) {
      return null;
    }
    typeName = 'bytes';
  } else {
    return null;
  }
  for (const dim of dims) {
    if (dim.length === 0) {
      typeName += '[]';
    } else {
      const size = readBig(dim, 0, dim.length);
      typeName += `[${size.toString()}]`;
    }
  }
  return { name: encodeAsciiToString(nameRaw), type: typeName };
}

function parseEip712Values(
  bytes: Uint8Array,
  types: Eip712V2Types,
): { typed: Eip712TypedData; path: string } | null {
  const items = readTlvItems(bytes);
  if (!items || !types.EIP712Domain) {
    return null;
  }
  const version = tlvOne(items, 0x00);
  const primaryRaw = tlvOne(items, 0x01);
  const pathRaw = tlvOne(items, 0x02);
  const domainRaw = tlvOne(items, 0x03);
  const messageRaw = tlvOne(items, 0x04);
  if (!version || version.length !== 1 || version[0] !== 0x01 || !primaryRaw || !pathRaw || !domainRaw || !messageRaw) {
    return null;
  }
  if (pathRaw.length < 4 || pathRaw.length > 40 || pathRaw.length % 4 !== 0) {
    return null;
  }
  const components: number[] = [];
  for (let i = 0; i < pathRaw.length; i += 4) {
    components.push(readU32BE(pathRaw, i));
  }
  const primaryType = encodeAsciiToString(primaryRaw);
  if (!types[primaryType]) {
    return null;
  }
  const domain = parseValueAsType('EIP712Domain', domainRaw, types);
  const message = parseValueAsType(primaryType, messageRaw, types);
  if (!domain || typeof domain !== 'object' || Array.isArray(domain) || !message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  return {
    typed: {
      types,
      primaryType,
      domain: domain as Record<string, unknown>,
      message: message as Record<string, unknown>,
    },
    path: pathToString(components),
  };
}

function splitType(type: string): { base: string; dims: Array<number | null> } {
  const dims: Array<number | null> = [];
  let base = type;
  while (base.endsWith(']')) {
    const start = base.lastIndexOf('[');
    const inner = base.slice(start + 1, -1);
    dims.unshift(inner === '' ? null : Number.parseInt(inner, 10));
    base = base.slice(0, start);
  }
  return { base, dims };
}

function parseValueAsType(type: string, raw: Uint8Array, types: Eip712V2Types): unknown {
  const items = readTlvItems(raw);
  if (!items) {
    return null;
  }
  return parseSeq(type, items, types);
}

function parseSeq(type: string, items: TlvItem[], types: Eip712V2Types): unknown {
  const split = splitType(type);
  if (split.dims.length > 0) {
    const rest = typeFromDims(split.base, split.dims.slice(1));
    const values = items.map((item) => readSeqEntry(rest, item, types));
    if (values.some((value) => value === null)) {
      return null;
    }
    return values;
  }
  if (types[split.base]) {
    const fields = types[split.base]!;
    if (items.length !== fields.length) {
      return null;
    }
    const out: Record<string, unknown> = {};
    for (let i = 0; i < fields.length; i += 1) {
      const value = readSeqEntry(fields[i]!.type, items[i]!, types);
      if (value === null) {
        return null;
      }
      out[fields[i]!.name] = value;
    }
    return out;
  }
  if (items.length !== 1) {
    return null;
  }
  return readSeqEntry(type, items[0]!, types);
}

function typeFromDims(base: string, dims: Array<number | null>): string {
  let type = base;
  for (const dim of dims) {
    type += dim == null ? '[]' : `[${dim}]`;
  }
  return type;
}

function readSeqEntry(type: string, item: TlvItem, types: Eip712V2Types): unknown {
  const split = splitType(type);
  const needsSeq = split.dims.length > 0 || Boolean(types[split.base]);
  if (needsSeq) {
    if (item.tag !== 0x01) {
      return null;
    }
    const inner = readTlvItems(item.value);
    if (!inner) {
      return null;
    }
    if (split.dims.length > 0) {
      const expected = split.dims[0];
      if (expected != null && inner.length !== expected) {
        return null;
      }
    }
    return parseSeq(type, inner, types);
  }
  if (item.tag !== 0x00) {
    return null;
  }
  return decodeV2Leaf(split.base, item.value);
}

function decodeV2Leaf(type: string, raw: Uint8Array): unknown {
  if (type === 'string') {
    return new TextDecoder().decode(raw);
  }
  if (type === 'address') {
    if (raw.length !== 20) {
      return null;
    }
    return hex0x(raw);
  }
  if (type === 'bool') {
    if (raw.length !== 1 || (raw[0] !== 0 && raw[0] !== 1)) {
      return null;
    }
    return raw[0] === 1;
  }
  if (type.startsWith('uint') || type.startsWith('int')) {
    if (raw.length === 0) {
      return null;
    }
    return hex0x(raw);
  }
  if (type === 'bytes' || type.startsWith('bytes')) {
    return hex0x(raw);
  }
  return null;
}
