import type { BackupKind, ChainPathId, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { concatBytes, bytesToHex } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_CLA_NOT_SUPPORTED,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import {
  deriveEd25519PrivateKey,
  derivePrivateKey,
  ed25519PublicKey,
  publicKeyCompressed,
  signEd25519,
  signSecp256k1Recoverable,
} from '../crypto';

export type FamilyContext = {
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
};

export type FamilySession = {
  pendingSign?: { path: string; payload: Uint8Array };
};

export type FamilySpec = {
  name: string;
  clas: number[];
  versionIns: number[];
  pubkeyIns: number[];
  signIns: number[];
  curve: 'ed25519' | 'secp256k1';
  versionBytes: () => Uint8Array;
  encodePubkey: (publicKey: Uint8Array, path: string) => Uint8Array;
  hashForSign?: (message: Uint8Array) => Uint8Array;
  /** Extra confirm copy for encodings that are not a full on-chain StateInit. */
  exportNote?: string;
};

const FAMILY_PATHS: Record<string, readonly ChainPathId[]> = {
  Solana: ['sol-ledger', 'sol-phantom'],
  XRP: ['xrp'],
  Tron: ['trx'],
  Cosmos: ['atom'],
  TON: ['ton'],
  Aptos: ['apt'],
  Sui: ['sui'],
  Polkadot: ['dot'],
};

function familyPath(ctx: FamilyContext, spec: FamilySpec, path: string): string {
  const chains = FAMILY_PATHS[spec.name];
  if (!chains) {
    return path;
  }
  return ctx.confirmation.resolvePath?.(path, chains) ?? path;
}

function preview(message: Uint8Array): string {
  return `0x${bytesToHex(message).slice(0, 96)}`;
}

export async function handleFamilyApdu(
  apdu: Apdu,
  spec: FamilySpec,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array | null> {
  if (!spec.clas.includes(apdu.cla)) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (spec.versionIns.includes(apdu.ins)) {
    return encodeResponse(spec.versionBytes(), SW_OK);
  }
  if (spec.pubkeyIns.includes(apdu.ins)) {
    return exportKey(apdu, spec, ctx);
  }
  if (spec.signIns.includes(apdu.ins)) {
    return signPayload(apdu, spec, ctx, session);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}

async function exportKey(apdu: Apdu, spec: FamilySpec, ctx: FamilyContext): Promise<Uint8Array> {
  let path: string;
  try {
    path = familyPath(ctx, spec, parseBip32Path(apdu.data).path);
  } catch {
    path = 'm';
  }
  const ok = await ctx.confirmation.confirm({
    brand: 'ledger',
    kind: 'address',
    title: `Export ${spec.name} key`,
    path,
    message: spec.exportNote
      ? `Export ${spec.name} public key\n${path}\n${spec.exportNote}`
      : `Export ${spec.name} public key\n${path}`,
    rawPayload: apdu.data,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const passphrase = await ctx.confirmation.getPassphrase(ctx.slotId);
  const publicKey =
    spec.curve === 'ed25519'
      ? ed25519PublicKey(deriveEd25519PrivateKey(ctx.entropy, path, passphrase, ctx.backup))
      : publicKeyCompressed(derivePrivateKey(ctx.entropy, path, passphrase, ctx.backup));
  return encodeResponse(spec.encodePubkey(publicKey, path), SW_OK);
}

async function signPayload(
  apdu: Apdu,
  spec: FamilySpec,
  ctx: FamilyContext,
  session: FamilySession,
): Promise<Uint8Array | null> {
  const hasMore = (apdu.p2 & 0x02) !== 0;
  if (!session.pendingSign || apdu.p1 === 0x00) {
    let path = 'm';
    let rest = apdu.data;
    try {
      const parsed = parseBip32Path(apdu.data);
      path = familyPath(ctx, spec, parsed.path);
      rest = parsed.rest;
    } catch {
      rest = apdu.data;
    }
    session.pendingSign = { path, payload: rest };
  } else {
    session.pendingSign.payload = concatBytes(session.pendingSign.payload, apdu.data);
  }
  if (hasMore) {
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const pending = session.pendingSign;
  session.pendingSign = undefined;
  if (!pending) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: `Sign ${spec.name}`,
    path: pending.path,
    message: `Sign ${spec.name}\n${pending.path}\n${preview(pending.payload)}`,
    rawPayload: pending.payload,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const passphrase = await ctx.confirmation.getPassphrase(ctx.slotId);
  const message = spec.hashForSign ? spec.hashForSign(pending.payload) : pending.payload;
  const signature =
    spec.curve === 'ed25519'
      ? signEd25519(deriveEd25519PrivateKey(ctx.entropy, pending.path, passphrase, ctx.backup), message)
      : signSecp256k1Recoverable(derivePrivateKey(ctx.entropy, pending.path, passphrase, ctx.backup), message);
  return encodeResponse(signature, SW_OK);
}

export function versionTriple(version: string): Uint8Array {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return Uint8Array.of(major & 0xff, minor & 0xff, patch & 0xff);
}

export function lengthPrefixed(data: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(data.length), data);
}
