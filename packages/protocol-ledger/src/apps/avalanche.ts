import { bech32 } from '@scure/base';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import type { BackupKind, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { catalogVersion } from '@cws/contracts';
import { concatBytes, decodeAscii, encodeAscii, hexToBytes } from '../bytes';
import {
  encodeResponse,
  parseBip32Path,
  SW_DENY,
  SW_INS_NOT_SUPPORTED,
  SW_OK,
  SW_WRONG_LENGTH,
  type Apdu,
} from '../apdu';
import {
  deriveEd25519PrivateKeyFromSeed,
  deriveHdNodeFromSeed,
  ed25519PublicKey,
  publicKeyCompressed,
  seedFor,
  signEd25519,
  signSecp256k1Recoverable,
} from '../crypto';

const INS_GET_VERSION = 0x00;
const INS_WALLET_ID = 0x01;
const INS_GET_ADDR = 0x02;
const INS_GET_XPUB = 0x03;
const INS_SIGN_HASH = 0x04;
const INS_SIGN = 0x05;
const INS_SIGN_MSG = 0x06;

const P1_SILENT = 0x00;
const P1_SHOW = 0x01;
const P1_HASH_FIRST = 0x01;
const P1_HASH_LAST = 0x02;
const P1_HASH_NEXT = 0x03;
const P1_PAYLOAD_INIT = 0x00;
const P1_PAYLOAD_ADD = 0x01;
const P1_PAYLOAD_LAST = 0x02;

const P2_ED25519 = 0x01;

const WALLET_ID_PATH = "m/44'/9000'/0'";
const DEFAULT_HRP = 'avax';
export const FUJI_HRP = 'fuji';
export const FUJI_X_CHAIN_ID = hexToBytes('ab68eb1ee142a05cfe768c36e11f0b596db5a3c6c77aabe665dad9e638ca94f7');
export const FUJI_C_CHAIN_ID = hexToBytes('7fc93d85c6d62c5b2ac0b4dd191736dd070096b5a7b468b4513ec7f6c4fcba4a');
export const MAINNET_C_CHAIN_ID = hexToBytes('0427d4b22a2a78bcddd456742caf91b56badbff985ee19aef14573e7343fd652');

export type AvaxSession = {
  pendingHash?: Uint8Array;
  rootPath?: string;
  signChunks?: Uint8Array;
};

export type AvaxContext = {
  confirmation: ConfirmationPort;
  slotId: string;
  entropy: Uint8Array;
  backup?: BackupKind;
  session: AvaxSession;
  targetId: Uint8Array;
};

export function avalancheVersionBytes(): Uint8Array {
  const version = catalogVersion('avalanche', '1.4.23');
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return Uint8Array.of(major & 0xff, minor & 0xff, patch & 0xff);
}

export function avalancheHash160(publicKey: Uint8Array): Uint8Array {
  return ripemd160(sha256(publicKey));
}

export function avalancheBech32Address(publicKey: Uint8Array, hrp = DEFAULT_HRP): string {
  return bech32.encode(hrp, bech32.toWords(avalancheHash160(publicKey)));
}

export function avalancheWalletId(publicKey: Uint8Array): Uint8Array {
  return sha256(publicKey).subarray(0, 6);
}

export async function handleAvalancheApdu(apdu: Apdu, ctx: AvaxContext): Promise<Uint8Array> {
  switch (apdu.ins) {
    case INS_GET_VERSION:
      return encodeResponse(
        concatBytes(Uint8Array.of(0x00), avalancheVersionBytes(), Uint8Array.of(0x00), ctx.targetId),
        SW_OK,
      );
    case INS_WALLET_ID:
      return handleWalletId(apdu, ctx);
    case INS_GET_ADDR:
      return handleGetAddr(apdu, ctx);
    case INS_GET_XPUB:
      return handleGetXpub(apdu, ctx);
    case INS_SIGN_HASH:
      return handleSignHash(apdu, ctx);
    case INS_SIGN:
    case INS_SIGN_MSG:
      return handleSignPayload(apdu, ctx, apdu.ins === INS_SIGN_MSG ? 'Sign Avalanche message' : 'Sign Avalanche transaction');
    default:
      return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
}

function avaxPath(ctx: AvaxContext, path: string): string {
  return ctx.confirmation.resolvePath?.(path, ['avax']) ?? path;
}

export type AvaxChain = 'P-Chain' | 'X-Chain' | 'C-Chain';

export function avalancheChainLabel(chainId: Uint8Array): AvaxChain {
  if (chainId.length === 0 || chainId.every((byte) => byte === 0)) {
    return 'P-Chain';
  }
  if (equalBytes(chainId, FUJI_C_CHAIN_ID) || equalBytes(chainId, MAINNET_C_CHAIN_ID)) {
    return 'C-Chain';
  }
  return 'X-Chain';
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

async function handleWalletId(apdu: Apdu, ctx: AvaxContext): Promise<Uint8Array> {
  const path = avaxPath(ctx, WALLET_ID_PATH);
  if (apdu.p1 === P1_SHOW) {
    const ok = await ctx.confirmation.confirm({
      brand: 'ledger',
      kind: 'address',
      title: 'Show Avalanche wallet ID',
      path,
      message: `Show Avalanche wallet ID\n${path}`,
      rawPayload: apdu.data,
    });
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const node = deriveHdNodeFromSeed(seed, path);
  return encodeResponse(avalancheWalletId(node.publicKey), SW_OK);
}

async function handleGetAddr(apdu: Apdu, ctx: AvaxContext): Promise<Uint8Array> {
  const ed25519 = apdu.p2 === P2_ED25519;
  let parsed: { hrp: string; path: string; chain: AvaxChain };
  try {
    parsed = ed25519
      ? { hrp: DEFAULT_HRP, path: parseBip32Path(apdu.data).path, chain: 'P-Chain' }
      : parseHrChainPath(apdu.data);
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  parsed = { ...parsed, path: avaxPath(ctx, parsed.path) };
  if (apdu.p1 === P1_SHOW) {
    const ok = await ctx.confirmation.confirm(
      exportRequest(`Export Avalanche ${parsed.chain} address`, parsed.path, apdu.data),
    );
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  if (ed25519) {
    const secret = deriveEd25519PrivateKeyFromSeed(seed, parsed.path);
    const pub = ed25519PublicKey(secret);
    return encodeResponse(concatBytes(Uint8Array.of(pub.length), pub, ed25519AddressBytes(pub)), SW_OK);
  }
  const node = deriveHdNodeFromSeed(seed, parsed.path);
  const pub = node.publicKey.length === 33 ? node.publicKey : publicKeyCompressed(node.privateKey);
  const hash = avalancheHash160(pub);
  const addr = encodeAscii(avalancheBech32Address(pub, parsed.hrp));
  return encodeResponse(concatBytes(Uint8Array.of(pub.length), pub, hash, addr), SW_OK);
}

async function handleGetXpub(apdu: Apdu, ctx: AvaxContext): Promise<Uint8Array> {
  let parsed;
  try {
    parsed = parseHrChainPath(apdu.data);
  } catch {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  parsed = { ...parsed, path: avaxPath(ctx, parsed.path) };
  if (apdu.p1 === P1_SHOW) {
    const ok = await ctx.confirmation.confirm(
      exportRequest(`Export Avalanche ${parsed.chain} xpub`, parsed.path, apdu.data),
    );
    if (!ok) {
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const node = deriveHdNodeFromSeed(seed, parsed.path);
  const pub = node.publicKey.length === 33 ? node.publicKey : publicKeyCompressed(node.privateKey);
  return encodeResponse(concatBytes(Uint8Array.of(pub.length), pub, node.chainCode), SW_OK);
}

async function handleSignHash(apdu: Apdu, ctx: AvaxContext): Promise<Uint8Array> {
  const ed25519 = apdu.p2 === P2_ED25519;
  if (apdu.p1 === P1_HASH_FIRST || apdu.p1 === P1_SILENT) {
    let parsed;
    try {
      parsed = parseBip32Path(apdu.data);
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    if (parsed.rest.length < 32) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    const hash = parsed.rest.subarray(0, 32);
    const path = avaxPath(ctx, parsed.path);
    const ok = await ctx.confirmation.confirm({
      brand: 'ledger',
      kind: 'sign',
      title: 'Sign Avalanche hash',
      path,
      message: `Sign Avalanche hash\n${path}`,
      rawPayload: hash,
    });
    if (!ok) {
      ctx.session.pendingHash = undefined;
      ctx.session.rootPath = undefined;
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
    ctx.session.rootPath = path;
    ctx.session.pendingHash = hash;
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  if (apdu.p1 !== P1_HASH_NEXT && apdu.p1 !== P1_HASH_LAST) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  const hash = ctx.session.pendingHash;
  const root = ctx.session.rootPath;
  if (!hash || !root) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  // Ledger hosts (and Proxy LAB) often send a zero-length BIP32 suffix on HASH_LAST
  // meaning "sign with the path from HASH_FIRST". parseBip32Path rejects count=0.
  let suffixPath = '';
  if (!(apdu.data.length === 0 || (apdu.data.length >= 1 && apdu.data[0] === 0 && apdu.data.length === 1))) {
    try {
      suffixPath = parseBip32Path(apdu.data).path;
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
  }
  const path = joinPath(root, suffixPath);
  if (apdu.p1 === P1_HASH_LAST) {
    ctx.session.pendingHash = undefined;
    ctx.session.rootPath = undefined;
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  if (ed25519) {
    const secret = deriveEd25519PrivateKeyFromSeed(seed, path);
    return encodeResponse(signEd25519(secret, hash), SW_OK);
  }
  const node = deriveHdNodeFromSeed(seed, path);
  return encodeResponse(signSecp256k1Recoverable(node.privateKey, hash), SW_OK);
}

async function handleSignPayload(apdu: Apdu, ctx: AvaxContext, title: string): Promise<Uint8Array> {
  if (apdu.p1 === P1_PAYLOAD_INIT) {
    let parsed;
    try {
      parsed = parseBip32Path(apdu.data);
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    ctx.session.rootPath = avaxPath(ctx, parsed.path);
    ctx.session.signChunks = parsed.rest;
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  if (apdu.p1 === P1_PAYLOAD_ADD) {
    ctx.session.signChunks = concatBytes(ctx.session.signChunks ?? new Uint8Array(), apdu.data);
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  if (apdu.p1 !== P1_PAYLOAD_LAST) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  const payload = concatBytes(ctx.session.signChunks ?? new Uint8Array(), apdu.data);
  ctx.session.signChunks = undefined;
  const path = ctx.session.rootPath ?? WALLET_ID_PATH;
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title,
    path,
    message: `${title}\n${path}`,
    rawPayload: payload,
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    ctx.session.pendingHash = undefined;
    ctx.session.rootPath = undefined;
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  const digest = sha256(payload);
  // Keep pendingHash so a follow-up SIGN_HASH can still sign alternate paths.
  ctx.session.pendingHash = digest;
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  const node = deriveHdNodeFromSeed(seed, path);
  return encodeResponse(signSecp256k1Recoverable(node.privateKey, digest), SW_OK);
}

function parseHrChainPath(data: Uint8Array): { hrp: string; path: string; chain: AvaxChain } {
  if (data.length < 2) {
    throw new Error('truncated Avalanche address payload');
  }
  let offset = 0;
  const hrpLen = data[offset++];
  if (hrpLen > 24 || offset + hrpLen >= data.length) {
    throw new Error('truncated Avalanche HRP');
  }
  const hrp = hrpLen === 0 ? DEFAULT_HRP : decodeAscii(data.subarray(offset, offset + hrpLen));
  offset += hrpLen;
  const chainLen = data[offset++];
  if ((chainLen !== 0 && chainLen !== 32) || offset + chainLen > data.length) {
    throw new Error('truncated Avalanche chain id');
  }
  const chainId = data.subarray(offset, offset + chainLen);
  offset += chainLen;
  return { hrp, path: parseBip32Path(data.subarray(offset)).path, chain: avalancheChainLabel(chainId) };
}

function joinPath(root: string, suffix: string): string {
  const extra = suffix.replace(/^m\/?/, '');
  if (!extra) {
    return root;
  }
  return `${root}/${extra}`;
}

function exportRequest(title: string, path: string, raw: Uint8Array): SigningRequest {
  return {
    brand: 'ledger',
    kind: 'address',
    title,
    path,
    message: `${title}\n${path}`,
    rawPayload: raw,
  };
}

function ed25519AddressBytes(publicKey: Uint8Array): Uint8Array {
  const hash = sha256(publicKey);
  const addr = concatBytes(Uint8Array.of(0x00), hash);
  const checksum = sha256(addr).subarray(28, 32);
  return concatBytes(addr, checksum);
}
