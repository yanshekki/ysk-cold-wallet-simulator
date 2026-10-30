import { catalogVersion } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import { concatBytes } from '../bytes';
import { encodeResponse, SW_OK, type Apdu } from '../apdu';
import {
  handleFamilyApdu,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';

export type TonSession = FamilySession;

const TON_APP_NAME = Uint8Array.from('TON', (c) => c.charCodeAt(0));

/**
 * Official INS from LedgerHQ/app-ton `src/types.h` + `doc/COMMANDS.md` (CLA E0).
 * GET_VERSION 0x01 remains as a legacy alias (not in current COMMANDS.md).
 */
function spec(): FamilySpec {
  return {
    name: 'TON',
    clas: [0xe0],
    versionIns: [0x03, 0x01],
    pubkeyIns: [0x05],
    signIns: [0x06, 0x08, 0x09],
    curve: 'ed25519',
    versionBytes: () => versionTriple(catalogVersion('ton', '2.2.0')),
    encodePubkey: (publicKey) => publicKey,
    chunkMode: 'p2-ton',
    signPathOnlyFirst: true,
    // COMMANDS.md SIGN_TX/SIGN_DATA/PROOF: len(sig)||sig||len(hash)||hash
    // Hash is sha256 of the uploaded bytes here — not the BOC/cell hash (KEEP cell parse).
    encodeSignResponse: (signature, message) => {
      const digest = sha256(message);
      return concatBytes(
        Uint8Array.of(signature.length),
        signature,
        Uint8Array.of(digest.length),
        digest,
      );
    },
  };
}

export function handleTonApdu(apdu: Apdu, ctx: FamilyContext, session: TonSession) {
  if (apdu.ins === 0x04 && apdu.data.length === 0) {
    return encodeResponse(TON_APP_NAME, SW_OK);
  }
  // GET_APP_SETTINGS — flags: blind-sign | expert (COMMANDS.md). CWS reports both off.
  if (apdu.ins === 0x0a && apdu.data.length === 0) {
    return encodeResponse(Uint8Array.of(0x00), SW_OK);
  }
  if (apdu.ins === 0x05) {
    return handleFamilyApdu({ ...apdu, p1: apdu.p1 === 0x01 ? 0x01 : 0x00 }, spec(), ctx, session);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
