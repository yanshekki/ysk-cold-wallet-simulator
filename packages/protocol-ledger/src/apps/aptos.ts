import { catalogVersion } from '@cws/contracts';
import { concatBytes } from '../bytes';
import { encodeResponse, SW_OK, type Apdu } from '../apdu';
import {
  handleFamilyApdu,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
export type AptosSession = FamilySession;

const APTOS_APP_NAME = Uint8Array.from('Aptos', (c) => c.charCodeAt(0));

/**
 * Official INS from aptos-labs/ledger-app-aptos `src/types.h` and
 * LedgerHQ/app-aptos `doc/COMMANDS.md` (CLA 5B).
 * Legacy CWS hosts that still send INS 00 / 0A / 02 are accepted as aliases.
 */
function spec(): FamilySpec {
  return {
    name: 'Aptos',
    clas: [0x5b],
    versionIns: [0x03, 0x00],
    pubkeyIns: [0x05],
    signIns: [0x06, 0x0a, 0x02],
    curve: 'ed25519',
    versionBytes: () => versionTriple(catalogVersion('aptos', '0.9.0')),
    // COMMANDS.md: len(pk)||pk||len(chain_code)||chain_code (chain code unused → 32 zero).
    encodePubkey: (publicKey) =>
      concatBytes(Uint8Array.of(publicKey.length), publicKey, Uint8Array.of(32), new Uint8Array(32)),
    chunkMode: 'p2-bit80',
    signPathOnlyFirst: true,
    // COMMANDS.md: len(signature)||signature
    encodeSignResponse: (signature) => concatBytes(Uint8Array.of(signature.length), signature),
  };
}

export function handleAptosApdu(apdu: Apdu, ctx: FamilyContext, session: AptosSession) {
  if (apdu.ins === 0x04 && apdu.data.length === 0) {
    return encodeResponse(APTOS_APP_NAME, SW_OK);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
