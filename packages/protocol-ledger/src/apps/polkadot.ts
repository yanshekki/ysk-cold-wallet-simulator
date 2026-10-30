import { catalogVersion } from '@cws/contracts';
import { concatBytes } from '../bytes';
import {
  handleFamilyApdu,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
import { encodePubAndAddress, ss58Encode } from './addresses';
import type { Apdu } from '../apdu';

export type PolkadotSession = FamilySession;

/**
 * CLA/INS/chunking from Zondax ledger-polkadot `docs/APDUSPEC.md` (CLA F9; 90 accepted as alias).
 * GET_VERSION: test||maj_u16||min_u16||patch_u16||locked||target_id_u32.
 * SIGN/SIGN_RAW: P1 0=init 1=add 2=last; first packet = 5×u32 path (+ blob length for SIGN).
 * ED25519 signature response is 65 bytes (type 0x00 || 64-byte sig) per APDUSPEC.
 */
function spec(): FamilySpec {
  const [maj, min, patch] = versionTriple(catalogVersion('polkadot', '100.0.11'));
  return {
    name: 'Polkadot',
    clas: [0xf9, 0x90],
    versionIns: [0x00],
    pubkeyIns: [0x01],
    signIns: [0x02, 0x03],
    curve: 'ed25519',
    versionBytes: () =>
      Uint8Array.of(
        0x00,
        0x00,
        maj!,
        0x00,
        min!,
        0x00,
        patch!,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
      ),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, ss58Encode(publicKey, 0)),
    chunkMode: 'p1-zondax',
    signPathMode: 'zondax-fixed5',
    signPathOnlyFirst: true,
    encodeSignResponse: (signature) => concatBytes(Uint8Array.of(0x00), signature),
  };
}

export function handlePolkadotApdu(apdu: Apdu, ctx: FamilyContext, session: PolkadotSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
