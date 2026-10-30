import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type SymbolSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-symbol `src/apdu/constants.h` + `src/types.h` + `get_app_configuration.c` (CLA 0xE0).
 * MATCH: GET_VERSION flags||maj||min||patch (4-byte).
 * KEEP: GET_PUBLIC_KEY / SIGN_TX (Symbol/XYM path + mosaic).
 */
export async function handleSymbolApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x06) {
    const version = versionTriple(catalogVersion('symbol', '1.1.12'));
    return encodeResponse(Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
