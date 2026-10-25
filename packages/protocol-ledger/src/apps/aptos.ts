import { catalogVersion } from '@cws/contracts';
import { handleFamilyApdu, versionTriple, type FamilyContext, type FamilySession, type FamilySpec } from './generic';
import { aptosAuthKey, encodePubAndAddress } from './addresses';
import type { Apdu } from '../apdu';

export type AptosSession = FamilySession;

function spec(): FamilySpec {
  return {
    name: 'Aptos',
    clas: [0x5b],
    versionIns: [0x00],
    pubkeyIns: [0x05],
    signIns: [0x0a, 0x02],
    curve: 'ed25519',
    versionBytes: () => versionTriple(catalogVersion('aptos', '0.9.0')),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, aptosAuthKey(publicKey)),
  };
}

export function handleAptosApdu(apdu: Apdu, ctx: FamilyContext, session: AptosSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
