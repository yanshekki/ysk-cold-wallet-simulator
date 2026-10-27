import { catalogVersion } from '@cws/contracts';
import { encodeResponse, SW_OK, type Apdu } from '../apdu';
import {
  handleFamilyApdu,
  previewSolanaMessage,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';

export type SolanaSession = FamilySession;

function spec(): FamilySpec {
  return {
    name: 'Solana',
    clas: [0xe0],
    versionIns: [0x04],
    pubkeyIns: [0x05],
    signIns: [0x06, 0x07],
    curve: 'ed25519',
    versionBytes: () => concatFlags(versionTriple(catalogVersion('solana', '1.16.0'))),
    encodePubkey: (publicKey) => publicKey,
    preview: previewSolanaMessage,
  };
}

function concatFlags(version: Uint8Array): Uint8Array {
  // Ledger Solana app: blind-sign, pubkey display mode, major, minor, patch.
  return Uint8Array.of(0x01, 0x00, version[0], version[1], version[2]);
}

export async function handleSolanaApdu(
  apdu: Apdu,
  ctx: FamilyContext,
  session: SolanaSession,
): Promise<Uint8Array | null> {
  if (apdu.ins === 0x04) {
    return encodeResponse(spec().versionBytes(), SW_OK);
  }
  // HOT Wallet lists accounts with GET_PUBKEY P1=1 (display). A simulator
  // should not require a slide-to-sign for every derivation index.
  if (apdu.ins === 0x05) {
    return handleFamilyApdu({ ...apdu, p1: 0x00 }, spec(), ctx, session);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
