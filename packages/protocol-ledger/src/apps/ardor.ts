import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type ArdorSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-ardor `src/ardor.h` + `src/getVersion.c` + `src/config.c` (CLA 0xE0).
 * MATCH: GET_VERSION maj||min||patch||flags||0xBA 0xBE 0x00 (7-byte).
 * KEEP: AUTH_SIGN_TXN / ENCRYPT_DECRYPT_MSG / SHOW_ADDRESS / GET_PUBLIC_KEY_AND_CHAIN_CODE / SIGN_TOKEN.
 */
export async function handleArdorApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x01) {
    const version = versionTriple(catalogVersion('ardor', '1.1.1'));
    return encodeResponse(
      Uint8Array.of(version[0]!, version[1]!, version[2]!, 0x00, 0xba, 0xbe, 0x00),
      SW_OK,
    );
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
