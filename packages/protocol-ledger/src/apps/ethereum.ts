import { concatBytes, encodeAscii, readU32BE } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
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
import { catalogVersion, describeEthMessage, describeSigning } from '@cws/contracts';
import { keccak_256 } from '@noble/hashes/sha3';

function ethAppVersionBytes(): Uint8Array {
  const version = catalogVersion('ethereum', '1.23.0');
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return Uint8Array.of(0x00, major & 0xff, minor & 0xff, patch & 0xff);
}

export const ETH_APP_VERSION = ethAppVersionBytes();

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
};

export type EthContext = {
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  session: EthSession;
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
      return handleEip712Hashed(apdu, ctx);
    default:
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
}

function ethPath(ctx: EthContext, path: string): string {
  return ctx.confirmation.resolvePath?.(path, ['eth']) ?? path;
}

async function handleGetAddress(apdu: Apdu, ctx: EthContext): Promise<Uint8Array> {
  const { path: apduPath } = parseBip32Path(apdu.data);
  const path = ethPath(ctx, apduPath);
  if (apdu.p1 === 0x01) {
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
    const { path: apduPath, rest } = parseBip32Path(apdu.data);
    if (rest.length < 4) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    const expected = readU32BE(rest, 0);
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
  if (!pending || pending.message.length < pending.expected) {
    return null;
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
  if (needed == null || pending.payload.length < needed) {
    return null;
  }

  const raw = pending.payload.slice(0, needed);
  ctx.session.pendingTx = undefined;
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign Ethereum transaction',
    path: pending.path,
    message: `Sign Ethereum transaction\n${pending.path}\n0x${Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 96)}`,
    rawPayload: raw,
  };
  request.detail = describeSigning(request);
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const privateKey = derivePrivateKeyFromSeed(seed, pending.path);
  const hash = keccak_256(raw);
  const sig = signSecp256k1Recoverable(privateKey, hash);
  const typed = raw[0] <= 0x03;
  const v = typed ? sig[64] : (sig[64] ?? 0) + 27;
  return encodeResponse(concatBytes(Uint8Array.of(v), sig.subarray(0, 64)), SW_OK);
}

async function handleEip712Hashed(apdu: Apdu, ctx: EthContext): Promise<Uint8Array> {
  let path: string;
  let rest: Uint8Array;
  try {
    const parsed = parseBip32Path(apdu.data);
    path = ethPath(ctx, parsed.path);
    rest = parsed.rest;
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  if (rest.length < 64) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const domain = rest.subarray(0, 32);
  const structHash = rest.subarray(32, 64);
  const digest = keccak_256(concatBytes(Uint8Array.of(0x19, 0x01), domain, structHash));
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign EIP-712 typed data',
    path,
    message: `Sign EIP-712 hashed message\n${path}`,
    rawPayload: rest.subarray(0, 64),
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

function rlpFullLength(bytes: Uint8Array): number | null {
  if (bytes.length === 0) {
    return null;
  }
  let offset = 0;
  if (bytes[0] <= 0x7f && bytes[0] <= 0x03) {
    offset = 1;
    if (bytes.length < 2) {
      return null;
    }
  }
  const inner = rlpLengthAt(bytes, offset);
  return inner == null ? null : inner + offset;
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
