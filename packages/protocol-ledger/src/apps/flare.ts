import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { NANO_X_TARGET_ID } from './dashboard';
import type { FamilyContext, FamilySession } from './generic';

export type FlareSession = FamilySession;

export type FlareContext = FamilyContext & {
  targetId?: Uint8Array;
};

/**
 * CLA/INS from Zondax/ledger-flare `docs/APDUSPEC.md` (CLA 0x58 + dual CLA E0 ETH).
 * MATCH: GET_VERSION test||u16 maj/min/patch||locked||targetId.
 * Dual CLA E0 ETH INS are routed to the ethereum handler when Flare Network is open.
 * KEEP: GET_ADDR (HRP-prefixed path) / SIGN / SIGN_HASH.
 */
function versionBytes(targetId: Uint8Array): Uint8Array {
  const [maj, min, patch] = catalogVersion('flare-network', '2.6.7')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return Uint8Array.of(
    0x00,
    (maj >> 8) & 0xff,
    maj & 0xff,
    (min >> 8) & 0xff,
    min & 0xff,
    (patch >> 8) & 0xff,
    patch & 0xff,
    0x00,
    ...targetId,
  );
}

export async function handleFlareApdu(apdu: Apdu, ctx: FlareContext, _session: FlareSession) {
  if (apdu.cla !== 0x58) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    return encodeResponse(versionBytes(ctx.targetId ?? NANO_X_TARGET_ID), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
