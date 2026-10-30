import { catalogVersion } from '@cws/contracts';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  type Apdu,
} from '../apdu';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type MinaSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-mina `src/main.c` (CLA 0xE0).
 * MATCH: GET_CONF (INS 0x01) catalog version triple.
 * KEEP: GET_ADDR / SIGN_* — Mina derives secp256k1 then maps into the Mina field
 * (`crypto.c`); not FamilySpec ed25519.
 */
export async function handleMinaApdu(apdu: Apdu, _ctx: FamilyContext, _session: MinaSession) {
  if (apdu.cla !== 0xe0) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x01) {
    return encodeResponse(versionTriple(catalogVersion('mina', '1.6.10')), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
