import { catalogVersion } from '@cws/contracts';
import { blake2b } from '@noble/hashes/blake2b';
import { handleFamilyApdu, versionTriple, type FamilyContext, type FamilySession, type FamilySpec } from './generic';
import { encodePubAndAddress, suiAddress } from './addresses';
import type { Apdu } from '../apdu';

export type SuiSession = FamilySession;

function spec(): FamilySpec {
  return {
    name: 'Sui',
    clas: [0x00],
    versionIns: [0x00],
    pubkeyIns: [0x01],
    signIns: [0x02],
    curve: 'ed25519',
    versionBytes: () => versionTriple(catalogVersion('sui', '0.9.2')),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, suiAddress(publicKey)),
    hashForSign: (message) => blake2b(message, { dkLen: 32 }),
  };
}

export function handleSuiApdu(apdu: Apdu, ctx: FamilyContext, session: SuiSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
