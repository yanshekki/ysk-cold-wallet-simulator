import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type FlowSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-flow `docs/APDUSPEC.md` + `src/coin.h` (CLA 0x33).
 * MATCH: GET_VERSION test||maj||min||patch||locked (5-byte Zondax).
 * KEEP: GET_PUBKEY / SIGN (multi-curve crypto-options path) / slot INS.
 */
export async function handleFlowApdu(apdu: Apdu, _ctx: FamilyContext, _session: FamilySession) {
  if (apdu.cla !== 0x33) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x00) {
    const version = versionTriple(catalogVersion('flow', '0.15.1'));
    return encodeResponse(Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!, 0x00), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
