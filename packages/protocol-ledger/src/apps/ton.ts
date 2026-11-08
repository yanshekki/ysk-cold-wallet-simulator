import { catalogVersion } from '@cws/contracts';
import { encodeResponse, parseBip32Path, SW_DENY, SW_OK, SW_WRONG_P1P2, type Apdu } from '../apdu';
import { concatBytes } from '../bytes';
import {
  deriveEd25519PrivateKeyFromSeed,
  ed25519PublicKey,
  seedFor,
  signEd25519,
} from '../crypto';
import {
  handleFamilyApdu,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';
import {
  DEFAULT_SUBWALLET_ID,
  deserializeTonSignData,
  deserializeTonTx,
  encodeTonSignResponse,
  hashTonTx,
  MAX_DATA_LEN,
  MAX_DOMAIN_LEN,
  MAX_PROOF_PAYLOAD_LEN,
  MAX_TRANSACTION_LEN,
  pubkeyToHash,
  tonConnectProofHash,
} from './tonCell';

export type TonSession = FamilySession;

const TON_APP_NAME = Uint8Array.from('TON', (c) => c.charCodeAt(0));
const TON_CHAINS = ['ton'] as const;

/** LedgerHQ/app-ton `src/sw.h`. Distinct from NEAR `0xB005`. */
export const SW_TON_WRONG_DATA_LENGTH = 0x6a87;
export const SW_TON_WRONG_TX_LENGTH = 0xb004;
export const SW_TON_WRONG_SIGN_DATA_LENGTH = 0xb005;
export const SW_TON_BAD_STATE = 0xb007;
export const SW_TON_REQUEST_TOO_LONG = 0xb00b;
export const SW_TON_TX_PARSING_FAIL = 0xb010;
export const SW_TON_SIGN_DATA_PARSING_FAIL = 0xb011;
export const SW_TON_DISPLAY_ADDRESS_FAIL = 0xb002;
export const SW_TON_BAD_BIP32_PATH = 0xb0bd;
export const SW_TON_BLIND_SIGNING_DISABLED = 0xbd00;

const P2_FIRST = 0x01;
const P2_MORE = 0x02;
const P2_ADDR_FLAG_MASTERCHAIN = 0x02;
const P2_ADDR_FLAG_WALLET_SPECIFIERS = 0x04;
const P2_ADDR_FLAGS_MAX = 0x07;

/**
 * Official INS from LedgerHQ/app-ton `src/types.h` + `doc/COMMANDS.md` (CLA E0).
 * GET_VERSION 0x01 remains as a legacy alias (not in current COMMANDS.md).
 * SIGN_TX / SIGN_DATA / GET_ADDRESS_PROOF are handled below, not via generic
 * sha256-of-APDU.
 */
function spec(): FamilySpec {
  return {
    name: 'TON',
    clas: [0xe0],
    versionIns: [0x03, 0x01],
    pubkeyIns: [0x05],
    signIns: [],
    curve: 'ed25519',
    versionBytes: () => versionTriple(catalogVersion('ton', '2.2.0')),
    encodePubkey: (publicKey) => publicKey,
  };
}

function empty(sw: number): Uint8Array {
  return encodeResponse(new Uint8Array(), sw);
}

function countPath(data: Uint8Array): number | null {
  if (data.length < 1) return null;
  const count = data[0]!;
  if (1 + count * 4 > data.length) return null;
  return count;
}

function resolveTonPath(ctx: FamilyContext, path: string): string {
  return ctx.confirmation.resolvePath?.(path, TON_CHAINS) ?? path;
}

function parseFirstPath(data: Uint8Array): { path: string; count: number } | { sw: number } {
  const count = countPath(data);
  if (count == null) return { sw: SW_TON_WRONG_DATA_LENGTH };
  if (count <= 2) return { sw: SW_TON_BAD_BIP32_PATH };
  try {
    return { path: parseBip32Path(data).path, count };
  } catch {
    return { sw: SW_TON_WRONG_DATA_LENGTH };
  }
}

async function confirmAndSign(
  ctx: FamilyContext,
  path: string,
  title: string,
  message: string,
  rawPayload: Uint8Array,
  signMessage: Uint8Array,
  hash: Uint8Array,
): Promise<Uint8Array> {
  const ok = await ctx.confirmation.confirm({
    brand: 'ledger',
    kind: 'sign',
    title,
    path,
    message,
    rawPayload,
  });
  if (!ok) return empty(SW_DENY);
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const signature = signEd25519(deriveEd25519PrivateKeyFromSeed(seed, path), signMessage);
  return encodeResponse(encodeTonSignResponse(signature, hash), SW_OK);
}

async function handleSignTx(apdu: Apdu, ctx: FamilyContext, session: TonSession): Promise<Uint8Array> {
  if (apdu.p1 !== 0x00) return empty(SW_WRONG_P1P2);
  if ((apdu.p2 & ~(P2_FIRST | P2_MORE)) !== 0) return empty(SW_WRONG_P1P2);
  if ((apdu.p2 & P2_FIRST) !== 0 && (apdu.p2 & P2_MORE) === 0) return empty(SW_WRONG_P1P2);
  const first = (apdu.p2 & P2_FIRST) !== 0;
  const more = (apdu.p2 & P2_MORE) !== 0;
  if (first) {
    const parsed = parseFirstPath(apdu.data);
    if ('sw' in parsed) return empty(parsed.sw);
    session.tonPending = { ins: 0x06, path: resolveTonPath(ctx, parsed.path), payload: new Uint8Array() };
    return empty(SW_OK);
  }
  if (!session.tonPending || session.tonPending.ins !== 0x06) return empty(SW_TON_BAD_STATE);
  if (session.tonPending.payload.length + apdu.data.length > MAX_TRANSACTION_LEN) {
    session.tonPending = undefined;
    return empty(SW_TON_WRONG_TX_LENGTH);
  }
  session.tonPending.payload = concatBytes(session.tonPending.payload, apdu.data);
  if (more) return empty(SW_OK);
  const pending = session.tonPending;
  session.tonPending = undefined;
  const tx = deserializeTonTx(pending.payload);
  if (!tx) return empty(SW_TON_TX_PARSING_FAIL);
  if (tx.isBlind) return empty(SW_TON_BLIND_SIGNING_DISABLED);
  const hash = hashTonTx(tx);
  if (!hash) return empty(SW_TON_TX_PARSING_FAIL);
  return confirmAndSign(
    ctx,
    pending.path,
    'Sign TON',
    `Sign TON\n${pending.path}`,
    pending.payload,
    hash,
    hash,
  );
}

async function handleSignData(apdu: Apdu, ctx: FamilyContext, session: TonSession): Promise<Uint8Array> {
  if (apdu.p1 !== 0x00) return empty(SW_WRONG_P1P2);
  if ((apdu.p2 & ~(P2_FIRST | P2_MORE)) !== 0) return empty(SW_WRONG_P1P2);
  if ((apdu.p2 & P2_FIRST) !== 0 && (apdu.p2 & P2_MORE) === 0) return empty(SW_WRONG_P1P2);
  const first = (apdu.p2 & P2_FIRST) !== 0;
  const more = (apdu.p2 & P2_MORE) !== 0;
  if (first) {
    const parsed = parseFirstPath(apdu.data);
    if ('sw' in parsed) return empty(parsed.sw);
    session.tonPending = { ins: 0x09, path: resolveTonPath(ctx, parsed.path), payload: new Uint8Array() };
    return empty(SW_OK);
  }
  if (!session.tonPending || session.tonPending.ins !== 0x09) return empty(SW_TON_BAD_STATE);
  if (session.tonPending.payload.length + apdu.data.length > MAX_DATA_LEN) {
    session.tonPending = undefined;
    return empty(SW_TON_WRONG_SIGN_DATA_LENGTH);
  }
  session.tonPending.payload = concatBytes(session.tonPending.payload, apdu.data);
  if (more) return empty(SW_OK);
  const pending = session.tonPending;
  session.tonPending = undefined;
  const parsed = deserializeTonSignData(pending.payload);
  if (!parsed) return empty(SW_TON_SIGN_DATA_PARSING_FAIL);
  return confirmAndSign(
    ctx,
    pending.path,
    'Sign TON data',
    `Sign TON data\n${pending.path}`,
    pending.payload,
    parsed.signMessage,
    parsed.cellHash,
  );
}

async function handleProof(apdu: Apdu, ctx: FamilyContext): Promise<Uint8Array> {
  if (apdu.p1 !== 0x01) return empty(SW_WRONG_P1P2);
  if (apdu.p2 > P2_ADDR_FLAGS_MAX) return empty(SW_WRONG_P1P2);
  const count = countPath(apdu.data);
  if (count == null) return empty(SW_TON_WRONG_DATA_LENGTH);
  let parsed;
  try {
    parsed = parseBip32Path(apdu.data);
  } catch {
    return empty(SW_TON_WRONG_DATA_LENGTH);
  }
  if (count <= 2) return empty(SW_TON_BAD_BIP32_PATH);
  const path = resolveTonPath(ctx, parsed.path);
  let rest = parsed.rest;
  let isV3r2 = false;
  let subwalletId = DEFAULT_SUBWALLET_ID;
  if ((apdu.p2 & P2_ADDR_FLAG_WALLET_SPECIFIERS) !== 0) {
    if (rest.length < 5) return empty(SW_TON_WRONG_DATA_LENGTH);
    const flag = rest[0]!;
    if (flag !== 0 && flag !== 1) return empty(SW_TON_WRONG_DATA_LENGTH);
    isV3r2 = flag === 1;
    subwalletId =
      ((rest[1]! << 24) | (rest[2]! << 16) | (rest[3]! << 8) | rest[4]!) >>> 0;
    rest = rest.subarray(5);
  }
  if (rest.length < 1) return empty(SW_TON_WRONG_DATA_LENGTH);
  const domainLen = rest[0]!;
  if (domainLen > MAX_DOMAIN_LEN) return empty(SW_TON_REQUEST_TOO_LONG);
  if (rest.length < 1 + domainLen + 8) return empty(SW_TON_WRONG_DATA_LENGTH);
  const domain = rest.subarray(1, 1 + domainLen);
  const timestampOffset = 1 + domainLen;
  let timestamp = 0n;
  for (let i = 0; i < 8; i += 1) {
    timestamp = (timestamp << 8n) | BigInt(rest[timestampOffset + i]!);
  }
  const payload = rest.subarray(timestampOffset + 8);
  if (payload.length > MAX_PROOF_PAYLOAD_LEN) return empty(SW_TON_REQUEST_TOO_LONG);

  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const publicKey = ed25519PublicKey(deriveEd25519PrivateKeyFromSeed(seed, path));
  let addressHash: Uint8Array;
  try {
    addressHash = pubkeyToHash(publicKey, subwalletId, isV3r2);
  } catch {
    return empty(SW_TON_DISPLAY_ADDRESS_FAIL);
  }
  const workchain = (apdu.p2 & P2_ADDR_FLAG_MASTERCHAIN) !== 0 ? -1 : 0;
  const hash = tonConnectProofHash({
    workchain,
    addressHash,
    domain,
    timestamp,
    payload,
  });
  return confirmAndSign(
    ctx,
    path,
    'Sign TON proof',
    `Sign TON proof\n${path}`,
    apdu.data,
    hash,
    hash,
  );
}

export async function handleTonApdu(apdu: Apdu, ctx: FamilyContext, session: TonSession) {
  if (apdu.ins === 0x04 && apdu.data.length === 0) {
    return encodeResponse(TON_APP_NAME, SW_OK);
  }
  // GET_APP_SETTINGS — flags: blind-sign | expert (COMMANDS.md). CWS reports both off.
  if (apdu.ins === 0x0a && apdu.data.length === 0) {
    return encodeResponse(Uint8Array.of(0x00), SW_OK);
  }
  if (apdu.ins === 0x05) {
    return handleFamilyApdu({ ...apdu, p1: apdu.p1 === 0x01 ? 0x01 : 0x00 }, spec(), ctx, session);
  }
  if (apdu.ins === 0x06) {
    return handleSignTx(apdu, ctx, session);
  }
  if (apdu.ins === 0x08) {
    return handleProof(apdu, ctx);
  }
  if (apdu.ins === 0x09) {
    return handleSignData(apdu, ctx, session);
  }
  return handleFamilyApdu(apdu, spec(), ctx, session);
}
