import type { SigningRequest } from '@cws/contracts';
import { catalogVersion } from '@cws/contracts';
import { concatBytes } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_CLA_NOT_SUPPORTED,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';
import { cardanoEnterprise, encodePubAndAddress } from './addresses';
import { deriveIcarus, signIcarus } from './icarus';

export type CardanoSession = FamilySession;

function versionBytes(): Uint8Array {
  return versionTriple(catalogVersion('cardano', '7.2.1'));
}

export async function handleCardanoApdu(
  apdu: Apdu,
  ctx: FamilyContext,
  session: CardanoSession,
): Promise<Uint8Array | null> {
  if (apdu.cla !== 0xd7 && apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    return encodeResponse(versionBytes(), SW_OK);
  }
  if (apdu.ins === 0x10) {
    return exportExtPubkey(apdu, ctx);
  }
  if (apdu.ins === 0x11) {
    return exportAddress(apdu, ctx);
  }
  if (apdu.ins === 0x21 || apdu.ins === 0x15) {
    return signPayload(apdu, ctx, session);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}

async function exportExtPubkey(apdu: Apdu, ctx: FamilyContext): Promise<Uint8Array> {
  const path = parsePath(apdu, ctx);
  const ok = await confirm(ctx, {
    kind: 'address',
    title: 'Export Cardano key',
    path,
    message: `Export Cardano extended public key (CIP-3 Icarus)\n${path}`,
    rawPayload: apdu.data,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const node = await icarusAt(ctx, path);
  return encodeResponse(concatBytes(node.publicKey, node.chainCode), SW_OK);
}

async function exportAddress(apdu: Apdu, ctx: FamilyContext): Promise<Uint8Array> {
  const path = parsePath(apdu, ctx);
  const ok = await confirm(ctx, {
    kind: 'address',
    title: 'Export Cardano address',
    path,
    message: `Export Cardano enterprise address (CIP-3 Icarus)\n${path}`,
    rawPayload: apdu.data,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const node = await icarusAt(ctx, path);
  return encodeResponse(encodePubAndAddress(node.publicKey, cardanoEnterprise(node.publicKey)), SW_OK);
}

async function signPayload(
  apdu: Apdu,
  ctx: FamilyContext,
  session: CardanoSession,
): Promise<Uint8Array | null> {
  const hasMore = (apdu.p2 & 0x02) !== 0;
  if (!session.pendingSign || apdu.p1 === 0x00) {
    const parsed = parseBip32PathSafe(apdu.data);
    session.pendingSign = {
      path: ctx.confirmation.resolvePath?.(parsed.path, ['ada']) ?? parsed.path,
      payload: parsed.rest,
    };
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
  const ok = await confirm(ctx, {
    kind: 'sign',
    title: 'Sign Cardano',
    path: pending.path,
    message: `Sign Cardano\n${pending.path}`,
    rawPayload: pending.payload,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const node = await icarusAt(ctx, pending.path);
  return encodeResponse(signIcarus(node, pending.payload), SW_OK);
}

function parsePath(apdu: Apdu, ctx: FamilyContext): string {
  const path = parseBip32PathSafe(apdu.data).path;
  return ctx.confirmation.resolvePath?.(path, ['ada']) ?? path;
}

function parseBip32PathSafe(data: Uint8Array): { path: string; rest: Uint8Array } {
  try {
    return parseBip32Path(data);
  } catch {
    return { path: "m/1852'/1815'/0'/0/0", rest: data };
  }
}

async function icarusAt(ctx: FamilyContext, path: string) {
  const passphrase = await ctx.confirmation.getPassphrase(ctx.slotId);
  return deriveIcarus(ctx.entropy, path, passphrase, ctx.backup);
}

async function confirm(
  ctx: FamilyContext,
  request: Omit<SigningRequest, 'brand'>,
): Promise<boolean> {
  return ctx.confirmation.confirm({ brand: 'ledger', ...request });
}
