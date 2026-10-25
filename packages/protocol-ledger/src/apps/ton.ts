import { catalogVersion } from '@cws/contracts';
import { handleFamilyApdu, versionTriple, type FamilyContext, type FamilySession, type FamilySpec } from './generic';
import { encodePubAndAddress, tonBounceable } from './addresses';
import type { Apdu } from '../apdu';

export type TonSession = FamilySession;

function spec(): FamilySpec {
  return {
    name: 'TON',
    clas: [0xe0],
    versionIns: [0x01, 0x03],
    pubkeyIns: [0x02, 0x04],
    signIns: [0x06, 0x05],
    curve: 'ed25519',
    versionBytes: () => versionTriple(catalogVersion('ton', '2.2.0')),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, tonBounceable(publicKey)),
    exportNote: 'Bounceable v4r2 from data-cell digest (seqno||walletId||pubkey). Not full StateInit+code.',
  };
}

export function handleTonApdu(apdu: Apdu, ctx: FamilyContext, session: TonSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
