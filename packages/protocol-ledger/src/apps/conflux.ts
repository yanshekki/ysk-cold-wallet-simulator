import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type ConfluxSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-conflux `docs/APDU.md` (CLA 0xE0).
 * MATCH: GET_APP_INFO flags||maj||min||patch (4-byte). INS table ≠ ethereum
 * (GET_PUBLIC_KEY=02, SIGN_TX=03 — not eth 04/06).
 * KEEP: GET_PUBLIC_KEY / SIGN_TX (Conflux RLP + storageLimit/epoch fields).
 */
export async function handleConfluxApdu(apdu: Apdu, _ctx: FamilyContext, _session: ConfluxSession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x01) {
    const version = versionTriple(catalogVersion('conflux', '2.2.2'));
    // flags: N=0, Y=1 detailed, X=1 blind — matches APDU.md example shape
    return encodeResponse(Uint8Array.of(0x03, version[0]!, version[1]!, version[2]!), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
