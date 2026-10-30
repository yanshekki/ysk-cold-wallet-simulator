import { catalogVersion } from '@cws/contracts';
import { bech32 } from '@scure/base';
import { concatBytes } from '../bytes';
import {
  encodeResponse,
  SW_CLA_NOT_SUPPORTED,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import {
  deriveEd25519PrivateKeyFromSeed,
  ed25519PublicKey,
  seedFor,
} from '../crypto';
import { versionTriple, type FamilyContext, type FamilySession } from './generic';

export type MultiversXSession = FamilySession;

function egldBech32(ed25519Pub: Uint8Array): string {
  return bech32.encode('erd', bech32.toWords(ed25519Pub));
}

/**
 * CLA/INS from LedgerHQ/app-multiversx `src/main.c` + `get_address.c` / `get_private_key.c` (CLA 0xED).
 * MATCH: GET_APP_VERSION; GET_ADDR (account||index → 44'/508'/account'/0'/index', len||erd bech32).
 * SIGN_TX / SIGN_TX_HASH / ESDT / AUTH_TOKEN KEEP.
 */
export async function handleMultiversXApdu(apdu: Apdu, ctx: FamilyContext, _session: MultiversXSession) {
  if (apdu.cla !== 0xed) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x01) {
    return encodeResponse(versionTriple(catalogVersion('multiversx', '1.3.1')), SW_OK);
  }
  if (apdu.ins === 0x03) {
    if (apdu.data.length !== 8) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    if (apdu.p2 !== 0x00 && apdu.p2 !== 0x01) {
      return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
    }
    const account = ((apdu.data[0]! << 24) | (apdu.data[1]! << 16) | (apdu.data[2]! << 8) | apdu.data[3]!) >>> 0;
    const index = ((apdu.data[4]! << 24) | (apdu.data[5]! << 16) | (apdu.data[6]! << 8) | apdu.data[7]!) >>> 0;
    const path = `m/44'/508'/${account}'/0'/${index}'`;
    if (apdu.p1 !== 0x00) {
      const ok = await ctx.confirmation.confirm({
        brand: 'ledger',
        kind: 'address',
        title: 'Export MultiversX address',
        path,
        message: `Export MultiversX address\n${path}`,
        rawPayload: apdu.data,
      });
      if (!ok) {
        return encodeResponse(new Uint8Array(), SW_DENY);
      }
    }
    const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
    const publicKey = ed25519PublicKey(deriveEd25519PrivateKeyFromSeed(seed, path));
    if (apdu.p2 === 0x01) {
      const hex = Array.from(publicKey, (b) => b.toString(16).padStart(2, '0')).join('');
      const bytes = new TextEncoder().encode(hex);
      return encodeResponse(concatBytes(Uint8Array.of(bytes.length), bytes), SW_OK);
    }
    const address = egldBech32(publicKey);
    const bytes = new TextEncoder().encode(address);
    return encodeResponse(concatBytes(Uint8Array.of(bytes.length), bytes), SW_OK);
  }
  return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
}
