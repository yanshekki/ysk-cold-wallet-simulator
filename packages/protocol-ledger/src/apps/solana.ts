import { catalogVersion } from '@cws/contracts';
import { concatBytes } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_CLA_NOT_SUPPORTED,
  SW_DENY,
  SW_OK,
  SW_WRONG_LENGTH,
  SW_WRONG_P1P2,
  type Apdu,
} from '../apdu';
import { deriveEd25519PrivateKeyFromSeed, seedFor, signEd25519 } from '../crypto';
import {
  handleFamilyApdu,
  previewSolanaMessage,
  solanaTransferDetail,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';

export type SolanaSession = FamilySession;

/** @ledgerhq/hw-app-solana chunk flags. EXTEND continues a payload; MORE means another chunk follows. */
const P2_EXTEND = 0x01;
const P2_MORE = 0x02;
const MAX_SIGN_PATHS = 5;

function spec(): FamilySpec {
  return {
    name: 'Solana',
    clas: [0xe0],
    versionIns: [0x04],
    pubkeyIns: [0x05],
    // SIGN_MESSAGE 0x06 and SIGN_OFFCHAIN 0x07 are handled below. The generic
    // parser treats byte 0 as a BIP32 depth and would shift the message.
    signIns: [],
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

/**
 * First SIGN chunk: `[numPaths][path…][message]`.
 * Each path is a BIP32 length prefix plus big-endian components.
 * Later chunks (P2 EXTEND) are message bytes only.
 */
export function parseSolanaSignPayload(
  data: Uint8Array,
): { paths: string[]; message: Uint8Array } | undefined {
  if (data.length < 2) {
    return undefined;
  }
  const count = data[0]!;
  if (count < 1 || count > MAX_SIGN_PATHS) {
    return undefined;
  }
  const paths: string[] = [];
  let offset = 1;
  for (let index = 0; index < count; index += 1) {
    if (offset >= data.length) {
      return undefined;
    }
    const depth = data[offset]!;
    if (depth < 1 || offset + 1 + depth * 4 > data.length) {
      return undefined;
    }
    try {
      paths.push(parseBip32Path(data.subarray(offset)).path);
    } catch {
      return undefined;
    }
    offset += 1 + depth * 4;
  }
  return { paths, message: data.subarray(offset) };
}

/** True when this APDU is a Solana sign chunk, not an empty version probe. */
export function isSolanaSignPayload(data: Uint8Array): boolean {
  const parsed = parseSolanaSignPayload(data);
  return parsed?.paths.some((path) => path.includes("44'/501'")) ?? false;
}

export async function handleSolanaApdu(
  apdu: Apdu,
  ctx: FamilyContext,
  session: SolanaSession,
): Promise<Uint8Array | null> {
  if (!spec().clas.includes(apdu.cla)) {
    return encodeResponse(new Uint8Array(), SW_CLA_NOT_SUPPORTED);
  }
  if (apdu.ins === 0x04) {
    return encodeResponse(spec().versionBytes(), SW_OK);
  }
  if (apdu.ins === 0x06 || apdu.ins === 0x07) {
    return signSolana(apdu, ctx, session);
  }
  // P1=0 lists a public key. P1=1 is Phantom's on-device verify and must confirm.
  return handleFamilyApdu(apdu, spec(), ctx, session);
}

async function signSolana(
  apdu: Apdu,
  ctx: FamilyContext,
  session: SolanaSession,
): Promise<Uint8Array> {
  const extend = (apdu.p2 & P2_EXTEND) !== 0;
  const more = (apdu.p2 & P2_MORE) !== 0;
  if (extend && !session.pendingSign) {
    return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
  }
  if (!extend || !session.pendingSign) {
    const parsed = parseSolanaSignPayload(apdu.data);
    if (!parsed) {
      return encodeResponse(new Uint8Array(), SW_WRONG_P1P2);
    }
    const first = parsed.paths[0]!;
    session.pendingSign = {
      path: ctx.confirmation.resolvePath?.(first, ['sol-ledger', 'sol-phantom']) ?? first,
      payload: parsed.message,
    };
  } else {
    session.pendingSign.payload = concatBytes(session.pendingSign.payload, apdu.data);
  }
  if (more) {
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  const pending = session.pendingSign;
  session.pendingSign = undefined;
  if (!pending || pending.payload.length === 0) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const summary = previewSolanaMessage(pending.payload);
  const title = apdu.ins === 0x07 ? 'Sign Solana message' : 'Sign Solana';
  const ok = await ctx.confirmation.confirm({
    brand: 'ledger',
    kind: 'sign',
    title,
    path: pending.path,
    message: `${title}\n${pending.path}\n${summary}`,
    rawPayload: pending.payload,
    detail: solanaTransferDetail(pending.path, pending.payload) ?? undefined,
  });
  if (!ok) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const signature = signEd25519(deriveEd25519PrivateKeyFromSeed(seed, pending.path), pending.payload);
  return encodeResponse(signature, SW_OK);
}
