import { catalogVersion } from '@cws/contracts';
import { encodeResponse, SW_OK, type Apdu } from '../apdu';
import { handleFamilyApdu, versionTriple, type FamilyContext, type FamilySession, type FamilySpec } from './generic';

export type TonSession = FamilySession;

const TON_APP_NAME = Uint8Array.from('TON', (c) => c.charCodeAt(0));

function spec(): FamilySpec {
  return {
    name: 'TON',
    clas: [0xe0],
    // Official ton-blockchain app: GET_VERSION 0x03. Keep 0x01 for older builds.
    versionIns: [0x01, 0x03],
    pubkeyIns: [0x02, 0x05],
    signIns: [0x06, 0x08, 0x09],
    curve: 'ed25519',
    versionBytes: () => versionTriple(catalogVersion('ton', '2.2.0')),
    // GET_PUBLIC_KEY returns the raw 32-byte ed25519 key.
    encodePubkey: (publicKey) => publicKey,
  };
}

export function handleTonApdu(apdu: Apdu, ctx: FamilyContext, session: TonSession) {
  if (apdu.ins === 0x04 && apdu.data.length === 0) {
    return encodeResponse(TON_APP_NAME, SW_OK);
  }
  if (apdu.ins === 0x05 || apdu.ins === 0x02) {
    return handleFamilyApdu({ ...apdu, p1: 0x00 }, spec(), ctx, session);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
