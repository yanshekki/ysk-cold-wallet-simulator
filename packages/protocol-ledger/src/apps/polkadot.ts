import { catalogVersion } from '@cws/contracts';
import { handleFamilyApdu, versionTriple, type FamilyContext, type FamilySession, type FamilySpec } from './generic';
import { encodePubAndAddress, ss58Encode } from './addresses';
import type { Apdu } from '../apdu';

export type PolkadotSession = FamilySession;

function spec(): FamilySpec {
  return {
    name: 'Polkadot',
    clas: [0xf9, 0x90],
    versionIns: [0x00],
    pubkeyIns: [0x01],
    signIns: [0x02],
    curve: 'ed25519',
    versionBytes: () => versionTriple(catalogVersion('polkadot', '100.0.11')),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, ss58Encode(publicKey, 0)),
  };
}

export function handlePolkadotApdu(apdu: Apdu, ctx: FamilyContext, session: PolkadotSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
