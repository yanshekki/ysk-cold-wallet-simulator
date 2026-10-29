import { bech32 } from '@scure/base';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import type { BackupKind, ConfirmationPort, SigningRequest } from '@cws/contracts';
import { catalogVersion } from '@cws/contracts';
import { concatBytes, decodeAscii, encodeAscii, hexToBytes, readU32BE } from '../bytes';
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
const MAINNET_X_CHAIN_ID = hexToBytes('ed5f38341e436e5d46e2bb00b45d62ae97d1b050c64bc634ae10626739e35c4b');
/** Fuji C-Chain id from the Ledger app chain table. */
const FUJI_C_CHAIN_LEDGER_ID = hexToBytes('7fc93d85c6d62c5b2ac0b519c87010ea5294012d1e407030d6acd0021cac10d5');

const AVAX_PREFIX_DEPTH = 3;
const AVAX_SUFFIX_DEPTH = 2;
const EVM_EXPORT_TX = 0x00000001;
const AVM_EXPORT_TX = 0x00000004;
const PVM_EXPORT_TX = 0x00000012;
const SECP_TRANSFER_OUTPUT = 7;
const EVM_INPUT_BYTES = 68;
const NANO_AVAX = 1_000_000_000n;

export type AvaxSession = {
  pendingHash?: Uint8Array;
  /** True only after the user confirmed this hash for rootPath. */
  hashConfirmed?: boolean;
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
      return handleSignPayload(apdu, ctx, 'tx');
    case INS_SIGN_MSG:
      return handleSignPayload(apdu, ctx, 'msg');
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
      clearAvaxSign(ctx);
      return encodeResponse(new Uint8Array(), SW_DENY);
    }
    ctx.session.rootPath = path;
    ctx.session.pendingHash = hash;
    ctx.session.hashConfirmed = true;
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  if (apdu.p1 !== P1_HASH_LAST && apdu.p1 !== P1_HASH_NEXT) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  const hash = ctx.session.pendingHash;
  const root = ctx.session.rootPath;
  if (!ctx.session.hashConfirmed || !hash || !root) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  // Core's sign() skips HASH_FIRST. After the export sheet it sends the
  // two-index suffix (P1 next, then last). An empty suffix still means the
  // path already reviewed in HASH_FIRST.
  const suffix = readAvaxSuffix(apdu.data);
  if (suffix === null) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const path = signingPath(root, suffix);
  if (!path) {
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  if (apdu.p1 === P1_HASH_LAST) {
    clearAvaxSign(ctx);
  }
  const seed = await seedFor(ctx.confirmation, ctx.slotId, ctx.entropy, ctx.backup ?? 'bip39');
  if (ed25519) {
    const secret = deriveEd25519PrivateKeyFromSeed(seed, path);
    return encodeResponse(signEd25519(secret, hash), SW_OK);
  }
  const node = deriveHdNodeFromSeed(seed, path);
  return encodeResponse(signSecp256k1Recoverable(node.privateKey, hash), SW_OK);
}

async function handleSignPayload(apdu: Apdu, ctx: AvaxContext, mode: 'tx' | 'msg'): Promise<Uint8Array> {
  if (apdu.p1 === P1_PAYLOAD_INIT) {
    let parsed;
    try {
      parsed = parseBip32Path(apdu.data);
    } catch {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    const path = avaxPath(ctx, parsed.path);
    if (pathDepth(path) !== AVAX_PREFIX_DEPTH) {
      clearAvaxSign(ctx);
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    clearAvaxSign(ctx);
    ctx.session.rootPath = path;
    ctx.session.signChunks = parsed.rest;
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  if (apdu.p1 === P1_PAYLOAD_ADD) {
    if (!ctx.session.rootPath) {
      return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
    }
    ctx.session.signChunks = concatBytes(ctx.session.signChunks ?? new Uint8Array(), apdu.data);
    return encodeResponse(new Uint8Array(), SW_OK);
  }
  if (apdu.p1 !== P1_PAYLOAD_LAST) {
    return encodeResponse(new Uint8Array(), SW_INS_NOT_SUPPORTED);
  }
  const root = ctx.session.rootPath;
  if (!root || pathDepth(root) !== AVAX_PREFIX_DEPTH) {
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const uploaded = concatBytes(ctx.session.signChunks ?? new Uint8Array(), apdu.data);
  ctx.session.signChunks = undefined;
  const body = mode === 'tx' ? unsignedTxAfterChangePaths(uploaded) : uploaded;
  if (!body || body.length === 0) {
    clearAvaxSign(ctx);
    return encodeResponse(new Uint8Array(), SW_WRONG_LENGTH);
  }
  const summary = mode === 'tx' ? describeAvaxTransaction(body) : messageSummary();
  const request: SigningRequest = {
    brand: 'ledger',
    kind: 'sign',
    title: summary.title,
    path: root,
    message: `${summary.title}\n${summary.note}\n${root}`,
    rawPayload: body,
    detail: {
      style: 'raw-sign',
      headline: summary.title,
      note: summary.note,
      fields: [
        { label: 'CHAIN', value: summary.direction },
        { label: 'PATH', value: root, mono: true },
        ...(summary.amount ? [{ label: 'AMOUNT', value: summary.amount }] : []),
      ],
    },
  };
  const ok = await ctx.confirmation.confirm(request);
  if (!ok) {
    clearAvaxSign(ctx);
    return encodeResponse(new Uint8Array(), SW_DENY);
  }
  // The Avalanche app stores this hash and returns only 9000. Core then
  // collects the signature with SIGN_HASH. Returning the signature here
  // would skip that step and still leave Core waiting on the device.
  ctx.session.rootPath = root;
  ctx.session.pendingHash = sha256(body);
  ctx.session.hashConfirmed = true;
  return encodeResponse(new Uint8Array(), SW_OK);
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

function clearAvaxSign(ctx: AvaxContext): void {
  ctx.session.pendingHash = undefined;
  ctx.session.hashConfirmed = false;
  ctx.session.rootPath = undefined;
  ctx.session.signChunks = undefined;
}

function pathDepth(path: string): number {
  if (path === 'm') {
    return 0;
  }
  return path.split('/').length - 1;
}

/** Empty suffix signs the reviewed path. A Core export sends exactly two indexes under a 3-level prefix. */
function readAvaxSuffix(data: Uint8Array): 'empty' | number[] | null {
  if (data.length === 0 || (data.length === 1 && data[0] === 0)) {
    return 'empty';
  }
  let parsed: { path: string; rest: Uint8Array };
  try {
    parsed = parseBip32Path(data);
  } catch {
    return null;
  }
  if (parsed.rest.length !== 0) {
    return null;
  }
  const count = data[0] ?? 0;
  const indexes: number[] = [];
  for (let i = 0; i < count; i++) {
    indexes.push(readU32BE(data, 1 + i * 4));
  }
  return indexes;
}

function signingPath(root: string, suffix: 'empty' | number[]): string | null {
  if (suffix === 'empty') {
    return root;
  }
  if (suffix.length !== AVAX_SUFFIX_DEPTH || pathDepth(root) !== AVAX_PREFIX_DEPTH) {
    return null;
  }
  if (suffix.some((value) => (value & 0x80000000) !== 0)) {
    return null;
  }
  return `${root}/${String(suffix[0])}/${String(suffix[1])}`;
}

/**
 * Core prefixes the unsigned transaction with a 1-byte path count and one
 * 2-index path per signer. The hash Core checks is sha256 of the bytes after that list.
 */
function unsignedTxAfterChangePaths(data: Uint8Array): Uint8Array | null {
  if (data.length < 1) {
    return null;
  }
  const count = data[0] ?? 0;
  if (count > 8) {
    return null;
  }
  let offset = 1;
  for (let i = 0; i < count; i++) {
    if (offset + 1 + AVAX_SUFFIX_DEPTH * 4 > data.length || data[offset] !== AVAX_SUFFIX_DEPTH) {
      return null;
    }
    offset += 1 + AVAX_SUFFIX_DEPTH * 4;
  }
  if (offset >= data.length) {
    return null;
  }
  return data.subarray(offset);
}

type AvaxSignSummary = {
  title: string;
  direction: string;
  note: string;
  amount?: string;
};

function messageSummary(): AvaxSignSummary {
  return {
    title: 'Sign Avalanche message',
    direction: 'Avalanche',
    note: 'Review this Avalanche message before it is signed.',
  };
}

function describeAvaxTransaction(tx: Uint8Array): AvaxSignSummary {
  const generic: AvaxSignSummary = {
    title: 'Sign Avalanche transaction',
    direction: 'Avalanche',
    note: 'Review this Avalanche transaction before it is signed.',
  };
  if (tx.length < 6 || ((tx[0] ?? 0) << 8 | (tx[1] ?? 0)) !== 0) {
    return generic;
  }
  const type = readU32BE(tx, 2);
  if (type === AVM_EXPORT_TX) {
    return {
      title: 'Sign Avalanche X-Chain export',
      direction: 'X-Chain',
      note: 'Review this X-Chain export before it is signed.',
    };
  }
  if (type === PVM_EXPORT_TX) {
    return {
      title: 'Sign Avalanche P-Chain export',
      direction: 'P-Chain',
      note: 'Review this P-Chain export before it is signed.',
    };
  }
  if (type !== EVM_EXPORT_TX || tx.length < 74) {
    return generic;
  }
  const source = chainName(tx.subarray(10, 42));
  const destination = chainName(tx.subarray(42, 74));
  const amount = exportedNanoAvax(tx.subarray(74));
  const direction = `${source} → ${destination}`;
  return {
    title: `Sign Avalanche ${source} export`,
    direction,
    amount: amount == null ? undefined : formatNanoAvax(amount),
    note: amount == null ? `Export from ${direction}.` : `Export ${formatNanoAvax(amount)} from ${direction}.`,
  };
}

function chainName(id: Uint8Array): string {
  if (id.length === 32 && id.every((byte) => byte === 0)) {
    return 'P-Chain';
  }
  if (
    equalBytes(id, MAINNET_C_CHAIN_ID) ||
    equalBytes(id, FUJI_C_CHAIN_ID) ||
    equalBytes(id, FUJI_C_CHAIN_LEDGER_ID)
  ) {
    return 'C-Chain';
  }
  if (equalBytes(id, MAINNET_X_CHAIN_ID) || equalBytes(id, FUJI_X_CHAIN_ID)) {
    return 'X-Chain';
  }
  return 'chain';
}

function exportedNanoAvax(body: Uint8Array): bigint | null {
  if (body.length < 4) {
    return null;
  }
  const inputs = readU32BE(body, 0);
  if (inputs > 64) {
    return null;
  }
  let offset = 4 + inputs * EVM_INPUT_BYTES;
  if (offset + 4 > body.length) {
    return null;
  }
  const outputs = readU32BE(body, offset);
  offset += 4;
  if (outputs > 64) {
    return null;
  }
  let total = 0n;
  for (let i = 0; i < outputs; i++) {
    if (offset + 32 + 4 + 8 > body.length) {
      return null;
    }
    if (readU32BE(body, offset + 32) !== SECP_TRANSFER_OUTPUT) {
      return null;
    }
    total += readU64BE(body, offset + 36);
    const owners = offset + 44;
    if (owners + 16 > body.length) {
      return null;
    }
    const addresses = readU32BE(body, owners + 12);
    const next = owners + 16 + addresses * 20;
    if (addresses > 64 || next > body.length) {
      return null;
    }
    offset = next;
  }
  return total;
}

function readU64BE(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) + BigInt(data[offset + i] ?? 0);
  }
  return value;
}

function formatNanoAvax(amount: bigint): string {
  const whole = amount / NANO_AVAX;
  const frac = (amount % NANO_AVAX).toString().padStart(9, '0').replace(/0+$/, '');
  return frac.length > 0 ? `${whole.toString()}.${frac} AVAX` : `${whole.toString()} AVAX`;
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
