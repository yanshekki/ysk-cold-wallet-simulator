import { catalogVersion } from '@cws/contracts';
import { encodeResponse, SW_OK, type Apdu } from '../apdu';
import {
  handleFamilyApdu,
  previewStellarEnvelope,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';

export type StellarSession = FamilySession;

function spec(): FamilySpec {
  return {
    name: 'Stellar',
    clas: [0xe0],
    versionIns: [0x06],
    pubkeyIns: [0x02],
    signIns: [0x04, 0x08, 0x0a, 0x0c],
    curve: 'ed25519',
    versionBytes: () => {
      const version = versionTriple(catalogVersion('stellar', '6.1.0'));
      // hw-app-str: hashSigningEnabled || major || minor || patch
      return Uint8Array.of(0x00, version[0], version[1], version[2]);
    },
    encodePubkey: (publicKey) => publicKey,
    preview: previewStellarEnvelope,
  };
}

export function handleStellarApdu(apdu: Apdu, ctx: FamilyContext, session: StellarSession) {
  // Confirm flag is P2 on the real Stellar app. HOT lists accounts without a slide.
  if (spec().pubkeyIns.includes(apdu.ins)) {
    return handleFamilyApdu({ ...apdu, p1: 0x00 }, spec(), ctx, session);
  }
  if (spec().versionIns.includes(apdu.ins) && apdu.data.length === 0) {
    return encodeResponse(spec().versionBytes(), SW_OK);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
