import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';

/**
 * CLA/INS from LedgerHQ/app-spacemesh `docs/APDUSPEC.md` (CLA 0x45).
 * MATCH: GET_VERSION is test || u16 major/minor/patch || locked. No target id in that table.
 * Test mode byte is 0. The spec uses 0xFF only when test mode is enabled.
 * KEEP: GET_ADDR, SIGN, multisig / vesting / vault, SIGN_MESSAGE.
 */
function versionBytes(): Uint8Array {
  const [maj, min, patch] = catalogVersion('spacemesh', '0.0.16')
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
  );
}

export async function handleSpacemeshApdu(apdu: Apdu) {
  if (apdu.cla !== 0x45) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    return encodeResponse(versionBytes(), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
