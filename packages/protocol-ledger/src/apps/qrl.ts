import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type QrlSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-qrl `src/app_main.h` + `app_get_version` (CLA 0x77).
 * MATCH: INS_VERSION test||maj||min||patch (4-byte; test=0 production).
 * KEEP: PUBLIC_KEY / SIGN / SIGN_NEXT / SETIDX / VIEW_ADDRESS (XMSS).
 */
export async function handleQrlApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0x77) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    const version = versionTriple(catalogVersion('qrl', '1.1.5'));
    return encodeResponse(Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
