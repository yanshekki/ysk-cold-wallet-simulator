import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import type { FamilyContext, FamilySession } from './generic';

export type AlgorandSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-algorand `docs/APDUSPEC.md` + `app/src/apdu_handler.c` (CLA 0x80).
 * MATCH: GET_VERSION (12-byte body with u16 maj/min/patch per handle_getversion).
 * KEEP: GET_PUBLIC_KEY / SIGN_* — firmware uses HDW_NORMAL Ed25519 with non-hardened
 * path tails (`crypto.c`); CWS SLIP-10 ed25519 cannot MATCH that derivation.
 */
function versionBytes(): Uint8Array {
  const [maj, min, patch] = catalogVersion('algorand', '2.7.4')
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
    0x00,
    0x00,
    0x00,
    0x00,
  );
}

export async function handleAlgorandApdu(apdu: Apdu, _ctx: FamilyContext, _session: AlgorandSession) {
  if (apdu.cla !== 0x80) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    return encodeResponse(versionBytes(), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
