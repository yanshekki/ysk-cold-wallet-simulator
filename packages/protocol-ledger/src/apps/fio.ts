import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type FioSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-fio `src/main.c` (CLA 0xD7) + `src/handlers.c` / `src/getVersion.c`.
 * MATCH: getVersion maj||min||patch||flags (4-byte; flags=0 production).
 * KEEP: getPublicKey / signTransaction / decodeDH.
 */
export async function handleFioApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0xd7) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    const version = versionTriple(catalogVersion('fio', '1.0.9'));
    return encodeResponse(Uint8Array.of(version[0]!, version[1]!, version[2]!, 0x00), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
