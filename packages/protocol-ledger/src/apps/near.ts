import type { BackupKind, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { catalogVersion } from '@cws/contracts';
import { concatBytes, readU32BE } from '../bytes';
import {
  encodeResponse,
  pathToString,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  type Apdu,
} from '../apdu';
import { deriveEd25519PrivateKey, ed25519PublicKey, signEd25519 } from '../crypto';

/** NEAR Ledger default: m/44'/397'/0'/0'/1' — five hardened components, no length prefix. */
const NEAR_PATH_BYTES = 20;

const INS_GET_PUBLIC_KEY_LEGACY = 0x00;
const INS_SIGN_TRANSACTION = 0x02;
const INS_GET_PUBLIC_KEY = 0x04;
const INS_GET_WALLET_ID = 0x05;
const INS_GET_VERSION = 0x06;

const P1_DISPLAY = 0x00;
const P1_SILENT = 0x01;
const P1_SIGN_LAST = 0x80;

export type NearSession = {
  pendingSign?: {
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
      return handleSign(apdu, ctx);
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

async function handleSign(apdu: Apdu, ctx: NearContext): Promise<Uint8Array> {
  const last = apdu.p1 === P1_SIGN_LAST;
  if (!ctx.session.pendingSign) {
    let parsed;
    try {
      parsed = parseNearHdPath(apdu.data);
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    ctx.session.pendingSign = {
      path: ctx.confirmation.resolvePath?.(parsed.path, ['near']) ?? parsed.path,
      payload: parsed.rest,
    };
  } else {
    ctx.session.pendingSign.payload = concatBytes(ctx.session.pendingSign.payload, apdu.data);
  }
  if (!last) {
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const pending = ctx.session.pendingSign;
  ctx.session.pendingSign = undefined;
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
  const passphrase = await ctx.confirmation.getPassphrase(ctx.slotId);
  const secret = deriveEd25519PrivateKey(ctx.entropy, pending.path, passphrase, ctx.backup);
  return encodeResponse(signEd25519(secret, pending.payload), SW_OK);
}

async function publicKeyAt(ctx: NearContext, path: string): Promise<Uint8Array> {
  const passphrase = await ctx.confirmation.getPassphrase(ctx.slotId);
  const secret = deriveEd25519PrivateKey(ctx.entropy, path, passphrase, ctx.backup);
  return ed25519PublicKey(secret);
}

export { P1_DISPLAY, P1_SILENT };
