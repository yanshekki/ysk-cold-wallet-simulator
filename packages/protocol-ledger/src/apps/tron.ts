import { secp256k1 } from '@noble/curves/secp256k1';
import { catalogVersion } from '@cws/contracts';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  handleFamilyApdu,
  previewTronTransfer,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
import { encodePubAndAddress, tronBase58 } from './addresses';
import { concatBytes } from '../bytes';
import { derivePrivateKeyFromSeed, seedFor, signSecp256k1Recoverable } from '../crypto';
import { encodeResponse, pathToString, SW_DENY, SW_OK, SW_WRONG_LENGTH, type Apdu } from '../apdu';

export type TronSession = FamilySession;

/**
 * CLA/INS from @ledgerhq/hw-app-trx `Trx.ts` (Ledger Live develop).
 * SIGN chunking uses P1 startBytes (0x10/0x00/0x80/0x90), not P2 bit 0x02.
 */
function spec(): FamilySpec {
  return {
    name: 'Tron',
    clas: [0xe0],
    versionIns: [0x06],
    pubkeyIns: [0x02],
    // ADDRESS 02, SIGN 04, SIGN_HASH 05, SIGN_MESSAGE 08.
    // ECDH 0A and TIP-712 0C are handled below.
    signIns: [0x04, 0x05, 0x08],
    curve: 'secp256k1',
    versionBytes: () => {
      const version = versionTriple(catalogVersion('tron', '0.8.3'));
      return Uint8Array.of(0x00, version[0]!, version[1]!, version[2]!);
    },
    encodePubkey: (publicKey) => encodePubAndAddress(publicKey, tronBase58(publicKey)),
    hashForSign: (message) => keccak_256(message),
    preview: previewTronTransfer,
    chunkMode: 'p1-tron',
  };
}

const SW_INCORRECT_DATA = 0x6a80;
const SW_INCORRECT_P1P2 = 0x6b00;
const SW_INCORRECT_BIP32_PATH = 0x6a8a;
const SW_SECURITY_STATUS = 0x6982;
/** app-tron `helpers.h`: BIP44 `44'/195'`. */
const TRON_PURPOSE = 0x8000002c;
const TRON_COIN_TYPE = 0x800000c3;
const TIP712_MAGIC = Uint8Array.of(0x19, 0x01);

export function handleTronApdu(apdu: Apdu, ctx: FamilyContext, session: TronSession) {
  if (apdu.ins === 0x0a) {
    return handleTronEcdh(apdu, ctx);
  }
  if (apdu.ins === 0x0c) {
    return handleTronTip712(apdu, ctx);
  }
  if (spec().pubkeyIns.includes(apdu.ins)) {
    return handleFamilyApdu({ ...apdu, p1: 0x00 }, spec(), ctx, session);
  }
  // SIGN_HASH (05): path||32-byte hash — treat payload as already hashed (identity).
  if (apdu.ins === 0x05) {
    const hashSpec: FamilySpec = {
      ...spec(),
      hashForSign: (message) => (message.length === 32 ? message : keccak_256(message)),
      chunkMode: 'p1-tron',
    };
    return handleFamilyApdu(apdu, hashSpec, ctx, session);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}

type TronPath = { components: number[]; rest: Uint8Array };

function readTronPath(data: Uint8Array): TronPath | undefined {
  if (data.length < 1) {
    return undefined;
  }
  const count = data[0]!;
  if (count < 1 || count > 10 || data.length < 1 + count * 4) {
    return undefined;
  }
  const components: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 1 + index * 4;
    components.push(
      ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0,
    );
  }
  return { components, rest: data.subarray(1 + count * 4) };
}

/**
 * INS `0A`. `get_ecdh_secret.c` requires P1 `00` and P2 `01`, then a BIP32 path
 * and a 65-byte peer key. `ui_callback_ecdh_ok` returns `cx_ecdh` `CX_ECDH_POINT`
 * (uncompressed, 65 bytes) after the sheet. Deny is `6985`.
 */
async function handleTronEcdh(apdu: Apdu, ctx: FamilyContext): Promise<Uint8Array> {
  if (apdu.p1 !== 0x00 || apdu.p2 !== 0x01) {
    return encodeResponse(new Uint8Array(), SW_INCORRECT_P1P2);
  }
  const parsed = readTronPath(apdu.data);
  if (!parsed) {
    return encodeResponse(new Uint8Array(), SW_INCORRECT_BIP32_PATH);
  }
  if (parsed.rest.length !== 65) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  try {
    secp256k1.ProjectivePoint.fromHex(parsed.rest);
  } catch {
    return encodeResponse(new Uint8Array(), SW_SECURITY_STATUS);
  }
  const path = pathToString(parsed.components);
  const ok = await ctx.confirmation.confirm({
    brand: 'ledger',
    kind: 'sign',
    title: 'Share Tron ECDH secret',
    path,
    message: `Share Tron ECDH secret\n${path}`,
    rawPayload: parsed.rest,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const shared = secp256k1.getSharedSecret(derivePrivateKeyFromSeed(seed, path), parsed.rest, false);
  return encodeResponse(shared, SW_OK);
}

/**
 * INS `0C`. `sign_tip712_message.c` takes `44'/195'/…`, a 32-byte domain hash,
 * and a 32-byte message hash. The signed digest is keccak256(`0x1901` ‖ domain ‖ message).
 * `format_signature_out` is `r‖s‖v` with `v` in {0, 1}.
 * Firmware returns `6A8C` when sign-by-hash is off. CWS has no separate setting;
 * the sheet is the gate, so that word is not returned.
 */
async function handleTronTip712(apdu: Apdu, ctx: FamilyContext): Promise<Uint8Array> {
  if (apdu.p1 !== 0x00 || apdu.p2 !== 0x00) {
    return encodeResponse(new Uint8Array(), SW_INCORRECT_P1P2);
  }
  const parsed = readTronPath(apdu.data);
  if (!parsed || parsed.components.length < 2 || parsed.rest.length < 64) {
    return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
  }
  if (parsed.components[0] !== TRON_PURPOSE || parsed.components[1] !== TRON_COIN_TYPE) {
    return encodeResponse(new Uint8Array(), SW_INCORRECT_DATA);
  }
  const domain = parsed.rest.subarray(0, 32);
  const message = parsed.rest.subarray(32, 64);
  const path = pathToString(parsed.components);
  const ok = await ctx.confirmation.confirm({
    brand: 'ledger',
    kind: 'sign',
    title: 'Sign Tron TIP-712',
    path,
    message: `Sign Tron TIP-712\n${path}`,
    rawPayload: concatBytes(domain, message),
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const digest = keccak_256(concatBytes(TIP712_MAGIC, domain, message));
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const signature = signSecp256k1Recoverable(derivePrivateKeyFromSeed(seed, path), digest);
  return encodeResponse(signature, SW_OK);
}
