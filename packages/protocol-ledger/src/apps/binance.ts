import { catalogVersion } from '@cws/contracts';
import { sha256 } from '@noble/hashes/sha2';
import {
  handleFamilyApdu,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
import { cosmosBech32, encodePubAndAddress } from './addresses';
import type { Apdu } from '../apdu';

export type BinanceSession = FamilySession;

/**
 * CLA/INS from LedgerHQ/app-binance `src/coin.h` (CLA 0xBC).
 * MATCH: Zondax GET_VERSION / GET_ADDR_SECP256K1 / SIGN_SECP256K1.
 * INS_PUBLIC_KEY_SECP256K1 (0x01) kept as deprecated alias of GET_ADDR path via pubkeyIns.
 * SHOW_ADDR (0x03) KEEP (UI-only confirm without returning bytes beyond standard addr).
 */
function spec(): FamilySpec {
  const version = versionTriple(catalogVersion('binance-chain', '2.1.1'));
  return {
    name: 'Binance',
    clas: [0xbc],
    versionIns: [0x00],
    pubkeyIns: [0x01, 0x04],
    signIns: [0x02],
    curve: 'secp256k1',
    versionBytes: () =>
      Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!, 0x00, 0x00, 0x00, 0x00, 0x00),
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, cosmosBech32(publicKey, 'bnb')),
    hashForSign: (message) => sha256(message),
    chunkMode: 'p1-zondax',
    signPathMode: 'zondax-fixed5',
    signPathOnlyFirst: true,
  };
}

export function handleBinanceApdu(apdu: Apdu, ctx: FamilyContext, session: BinanceSession) {
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
