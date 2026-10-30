import { catalogVersion } from '@cws/contracts';
import { concatBytes } from '../bytes';
import {
  handleFamilyApdu,
  previewTezosOperation,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
import { tezosTz1 } from './addresses';
import type { Apdu } from '../apdu';

export type TezosSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-tezos `app/docs/apdu.md` (CLA 0x80).
 * MATCH: VERSION / GET_PUBLIC_KEY response shape (len||pk).
 * SIGN / SIGN_WITH_HASH use FamilySpec chunking; full Micheline parse remains KEEP.
 */
function spec(): FamilySpec {
  const version = versionTriple(catalogVersion('tezos-wallet', '3.2.4'));
  return {
    name: 'Tezos',
    clas: [0x80],
    versionIns: [0x00],
    pubkeyIns: [0x02, 0x03],
    signIns: [0x04, 0x0f],
    curve: 'ed25519',
    // apdu.md INS_VERSION: wallet_tag(0)||maj||min||patch
    versionBytes: () => Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!),
    encodePubkey: (publicKey) => concatBytes(Uint8Array.of(publicKey.length), publicKey),
    preview: previewTezosOperation,
    chunkMode: 'p2-bit02',
  };
}

export function handleTezosApdu(apdu: Apdu, ctx: FamilyContext, session: TezosSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}

/** Expose tz1 for tests / hosts that want the derived address string. */
export function tezosAddressFromPub(publicKey: Uint8Array): string {
  return tezosTz1(publicKey);
}
