import type { BackupKind, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { catalogVersion, describeNearDelegate, describeNearMessage, hex0x } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import { concatBytes, readU32BE, readU32LE } from '../bytes';
import {
  encodeResponse,
  pathToString,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_TX_PARSING_FAIL,
  SW_WRONG_LENGTH,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import { deriveEd25519PrivateKeyFromSeed, ed25519PublicKey, seedFor, signEd25519 } from '../crypto';

/** NEAR Ledger default: m/44'/397'/0'/0'/1' — five hardened components, no length prefix. */
const NEAR_PATH_BYTES = 20;

const INS_GET_PUBLIC_KEY_LEGACY = 0x00;
const INS_SIGN_TRANSACTION = 0x02;
const INS_GET_PUBLIC_KEY = 0x04;
const INS_GET_WALLET_ID = 0x05;
const INS_GET_VERSION = 0x06;
/** NEP-413 off-chain message. NEAR Connector strips the prefix and sends the Borsh payload here. */
const INS_SIGN_NEP413 = 0x07;
/** NEP-366 delegate action. Same chunking as a transaction, different instruction. */
const INS_SIGN_NEP366 = 0x08;

const P1_DISPLAY = 0x00;
const P1_SILENT = 0x01;
const P1_SIGN_LAST = 0x80;

/**
 * Little-endian Borsh `u32` of `2^31 + 413`. The Ledger app feeds this into the
 * hash itself; the host does not include it in the APDU.
 */
const NEP413_PREFIX = Uint8Array.of(0x9d, 0x01, 0x00, 0x80);
/** Little-endian Borsh `u32` of `2^30 + 366`. */
const NEP366_PREFIX = Uint8Array.of(0x6e, 0x01, 0x00, 0x40);

type NearSignKind = 'transaction' | 'nep413' | 'nep366';

export type NearSession = {
  pendingSign?: {
    kind: NearSignKind;
    path: string;
    payload: Uint8Array;
  };
};

export type NearContext = {
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  session: NearSession;
};

type Nep413Message = {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string;
};

type DelegatePrefix = {
  sender: string;
  receiver: string;
  actionCount: number;
};

export function nearVersionBytes(): Uint8Array {
  const version = catalogVersion('near', '1.3.2');
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return Uint8Array.of(major & 0xff, minor & 0xff, patch & 0xff);
}

export function parseNearHdPath(data: Uint8Array): { path: string; rest: Uint8Array } {
  const take =
    data.length >= NEAR_PATH_BYTES ? NEAR_PATH_BYTES : data.length - (data.length % 4);
  if (take < 12) {
    throw new Error('NEAR HD path too short');
  }
  const components: number[] = [];
  for (let offset = 0; offset < take; offset += 4) {
    components.push(readU32BE(data, offset) >>> 0);
  }
  return { path: pathToString(components), rest: data.slice(take) };
}

export async function handleNearApdu(apdu: Apdu, ctx: NearContext): Promise<Uint8Array> {
  switch (apdu.ins) {
    case INS_GET_VERSION:
      return encodeResponse(nearVersionBytes(), SW_OK);
    case INS_GET_PUBLIC_KEY:
    case INS_GET_PUBLIC_KEY_LEGACY:
      return handleGetPublicKey(apdu, ctx, apdu.p1 !== P1_SILENT);
    case INS_GET_WALLET_ID:
      return handleGetPublicKey(apdu, ctx, false);
    case INS_SIGN_TRANSACTION:
      return handleSign(apdu, ctx, 'transaction');
    case INS_SIGN_NEP413:
      return handleSign(apdu, ctx, 'nep413');
    case INS_SIGN_NEP366:
      return handleSign(apdu, ctx, 'nep366');
    default:
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
}

async function handleGetPublicKey(
  apdu: Apdu,
  ctx: NearContext,
  display: boolean,
): Promise<Uint8Array> {
  let parsed;
  try {
    parsed = parseNearHdPath(apdu.data);
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const path = ctx.confirmation.resolvePath?.(parsed.path, ['near']) ?? parsed.path;
  if (display) {
    const request: SigningRequest = {
      brand: 'ledger',
      kind: 'address',
      title: 'Export NEAR public key',
      path,
      message: `Export NEAR public key\n${path}`,
      rawPayload: apdu.data,
    };
    const ok = await ctx.confirmation.confirm(request);
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  return encodeResponse(await publicKeyAt(ctx, path), SW_OK);
}

async function handleSign(apdu: Apdu, ctx: NearContext, kind: NearSignKind): Promise<Uint8Array> {
  if (kind !== 'transaction' && apdu.p1 !== P1_DISPLAY && apdu.p1 !== P1_SIGN_LAST) {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  const last = apdu.p1 === P1_SIGN_LAST;
  const pending = ctx.session.pendingSign;
  if (!pending || pending.kind !== kind) {
    let parsed;
    try {
      parsed = parseNearHdPath(apdu.data);
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    ctx.session.pendingSign = {
      kind,
      path: ctx.confirmation.resolvePath?.(parsed.path, ['near']) ?? parsed.path,
      payload: parsed.rest,
    };
  } else {
    pending.payload = concatBytes(pending.payload, apdu.data);
  }
  if (!last) {
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const done = ctx.session.pendingSign;
  ctx.session.pendingSign = undefined;
  if (!done) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  if (done.kind === 'nep413') {
    return finishNep413(done, ctx);
  }
  if (done.kind === 'nep366') {
    return finishNep366(done, ctx);
  }
  return finishTransaction(done, ctx);
}

async function finishTransaction(
  pending: { path: string; payload: Uint8Array },
  ctx: NearContext,
): Promise<Uint8Array> {
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign NEAR transaction',
    path: pending.path,
    message: `Sign NEAR transaction\n${pending.path}`,
    rawPayload: pending.payload,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const secret = await privateKeyAt(ctx, pending.path);
  // app-near hashes the Borsh transaction after the 20-byte path, then Ed25519-signs
  // that digest. nearcore verifies the signature over sha256(tx), not the raw bytes.
  return encodeResponse(signEd25519(secret, sha256(pending.payload)), SW_OK);
}

async function finishNep413(
  pending: { path: string; payload: Uint8Array },
  ctx: NearContext,
): Promise<Uint8Array> {
  const parsed = parseNep413(pending.payload);
  if (!parsed) {
    return refuseUnreadable(ctx, pending.path, 'Unsupported NEAR message', pending.payload);
  }
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign NEAR message',
    path: pending.path,
    message: [
      'Sign NEAR message',
      pending.path,
      parsed.message,
      `recipient ${parsed.recipient}`,
      parsed.callbackUrl ? `callback ${parsed.callbackUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    rawPayload: pending.payload,
    detail: describeNearMessage({
      path: pending.path,
      message: parsed.message,
      recipient: parsed.recipient,
      nonce: parsed.nonce,
      callbackUrl: parsed.callbackUrl,
    }),
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const secret = await privateKeyAt(ctx, pending.path);
  const digest = sha256(concatBytes(NEP413_PREFIX, pending.payload));
  return encodeResponse(signEd25519(secret, digest), SW_OK);
}

async function finishNep366(
  pending: { path: string; payload: Uint8Array },
  ctx: NearContext,
): Promise<Uint8Array> {
  const parsed = parseDelegatePrefix(pending.payload);
  if (!parsed) {
    return refuseUnreadable(ctx, pending.path, 'Unsupported NEAR delegate', pending.payload);
  }
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign NEAR delegate action',
    path: pending.path,
    message: `Sign NEAR delegate action\n${pending.path}\n${parsed.sender} → ${parsed.receiver}`,
    rawPayload: pending.payload,
    detail: describeNearDelegate({
      path: pending.path,
      sender: parsed.sender,
      receiver: parsed.receiver,
      actionCount: parsed.actionCount,
      raw: pending.payload,
    }),
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const secret = await privateKeyAt(ctx, pending.path);
  const digest = sha256(concatBytes(NEP366_PREFIX, pending.payload));
  return encodeResponse(signEd25519(secret, digest), SW_OK);
}

async function refuseUnreadable(
  ctx: NearContext,
  path: string,
  title: string,
  raw: Uint8Array,
): Promise<Uint8Array> {
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title,
    path,
    message: `${title}\n${path}\nThis payload could not be read. It will not be signed.`,
    rawPayload: raw,
    detail: {
      style: 'notice',
      headline: title,
      warning: 'This payload could not be read. It will not be signed.',
      fields: [
        { label: 'CHAIN', value: 'NEAR' },
        { label: 'PATH', value: path, mono: true },
      ],
      hex: hex0x(raw),
    },
  };
  const ok = await ctx.confirmation.confirm(request);
  return encodeResponse(new Uint8Array(), ok ? SW_TX_PARSING_FAIL : SW_DENY);
}

function readBorshString(data: Uint8Array, offset: number): { text: string; next: number } | null {
  if (offset < 0 || offset + 4 > data.length) {
    return null;
  }
  const length = readU32LE(data, offset);
  const start = offset + 4;
  if (length > data.length - start) {
    return null;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(start, start + length));
    return { text, next: start + length };
  } catch {
    return null;
  }
}

/** Borsh `NEP413Payload`: message, nonce, recipient, optional callback. No prefix, no trailing bytes. */
function parseNep413(data: Uint8Array): Nep413Message | null {
  const message = readBorshString(data, 0);
  if (!message || message.next + 32 > data.length) {
    return null;
  }
  const nonce = data.slice(message.next, message.next + 32);
  const recipient = readBorshString(data, message.next + 32);
  if (!recipient || recipient.next >= data.length) {
    return null;
  }
  const flag = data[recipient.next]!;
  let next = recipient.next + 1;
  let callbackUrl: string | undefined;
  if (flag === 0) {
    callbackUrl = undefined;
  } else if (flag === 1) {
    const callback = readBorshString(data, next);
    if (!callback) {
      return null;
    }
    callbackUrl = callback.text;
    next = callback.next;
  } else {
    return null;
  }
  if (next !== data.length) {
    return null;
  }
  return { message: message.text, nonce, recipient: recipient.text, callbackUrl };
}

/** Sender, receiver, and action count at the front of a Borsh delegate action. */
function parseDelegatePrefix(data: Uint8Array): DelegatePrefix | null {
  const sender = readBorshString(data, 0);
  if (!sender) {
    return null;
  }
  const receiver = readBorshString(data, sender.next);
  if (!receiver || receiver.next + 4 > data.length) {
    return null;
  }
  return {
    sender: sender.text,
    receiver: receiver.text,
    actionCount: readU32LE(data, receiver.next),
  };
}

async function privateKeyAt(ctx: NearContext, path: string): Promise<Uint8Array> {
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  return deriveEd25519PrivateKeyFromSeed(seed, path);
}

async function publicKeyAt(ctx: NearContext, path: string): Promise<Uint8Array> {
  return ed25519PublicKey(await privateKeyAt(ctx, path));
}

export { P1_DISPLAY, P1_SILENT };
