import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';

/**
 * CLA/INS from LedgerHQ/app-namada `docs/APDUSPEC.md` (CLA 0x57).
 * MATCH: GET_VERSION is test || u16 major/minor/patch || locked || target id.
 * KEEP: GET_ADDR, SIGN, GET_KEYS, and the spend-rand commands.
 */
function versionBytes(targetId: Uint8Array): Uint8Array {
  const [maj, min, patch] = catalogVersion('namada', '3.0.6')
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

export async function handleNamadaApdu(apdu: Apdu, targetId: Uint8Array) {
  if (apdu.cla !== 0x57) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    return encodeResponse(versionBytes(targetId), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
