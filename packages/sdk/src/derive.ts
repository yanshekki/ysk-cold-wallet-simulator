import { HDKey } from '@scure/bip32';
import { bech32, bech32m, base58, base58check as createBase58check } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import { sha512 } from '@noble/hashes/sha2';
import { keccak_256, sha3_256 } from '@noble/hashes/sha3';
import { blake2b } from '@noble/hashes/blake2b';
import type { BackupKind, ChainPathMap } from '@cws/contracts';
import { CHAIN_PATH_LABELS, mergeChainPaths, type ChainPathId } from '@cws/contracts';
import { cardanoEnterprise as cardanoEnterpriseAddr, deriveIcarus, tonBounceable as tonBounceableAddr } from '@cws/protocol-ledger';
import { toBip32Seed } from './seed';

export type InspectRow = {
  id: string;
  label: string;
  path: string;
  address: string;
};

const b58c = createBase58check(sha256);
const utf8 = new TextEncoder();
const RIPPLE_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + sumLength(part), 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function sumLength(part: Uint8Array): number {
  return part.length;
}

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

function u32be(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function taggedHash(tag: string, message: Uint8Array): Uint8Array {
  const tagHash = sha256(utf8.encode(tag));
  return sha256(concatBytes(tagHash, tagHash, message));
}

function secpKey(seed: Uint8Array, path: string): Uint8Array {
  const child = HDKey.fromMasterSeed(seed).derive(path);
  if (!child.privateKey) {
    throw new Error(`no private key at ${path}`);
  }
  return child.privateKey;
}

function checksumEth(address: string): string {
  const hex = address.replace(/^0x/i, '').toLowerCase();
  const hash = keccak_256(utf8.encode(hex));
  let out = '0x';
  for (let i = 0; i < hex.length; i++) {
    out += (hash[i] >> 4) >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function ethAddress(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, false);
  const hash = keccak_256(pub.subarray(1));
  return checksumEth(bytesToHex(hash.subarray(12)));
}

function bitcoinP2pkh(privateKey: Uint8Array, version = 0x00): string {
  const pub = secp256k1.getPublicKey(privateKey, true);
  return b58c.encode(concatBytes(Uint8Array.of(version), hash160(pub)));
}

function bitcoinP2shP2wpkh(privateKey: Uint8Array, version = 0x05): string {
  const pub = secp256k1.getPublicKey(privateKey, true);
  const redeem = concatBytes(Uint8Array.of(0x00, 0x14), hash160(pub));
  return b58c.encode(concatBytes(Uint8Array.of(version), hash160(redeem)));
}

function bitcoinP2wpkh(privateKey: Uint8Array, hrp = 'bc'): string {
  const pub = secp256k1.getPublicKey(privateKey, true);
  const words = bech32.toWords(hash160(pub));
  return bech32.encode(hrp, [0, ...words]);
}

function bitcoinP2tr(privateKey: Uint8Array): string {
  let point = secp256k1.ProjectivePoint.fromPrivateKey(privateKey);
  if (point.toRawBytes(true)[0] === 0x03) {
    point = point.negate();
  }
  const xonly = point.toRawBytes(true).subarray(1);
  const tweak = taggedHash('TapTweak', xonly);
  const t = BigInt(`0x${bytesToHex(tweak)}`) % secp256k1.CURVE.n;
  if (t === 0n) {
    throw new Error('taproot tweak is zero');
  }
  const tweaked = point.add(secp256k1.ProjectivePoint.BASE.multiply(t));
  const tweakedX = tweaked.toRawBytes(true).subarray(1);
  return bech32m.encode('bc', [1, ...bech32m.toWords(tweakedX)]);
}

function tronAddress(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, false);
  const hash = keccak_256(pub.subarray(1));
  return b58c.encode(concatBytes(Uint8Array.of(0x41), hash.subarray(12)));
}

function slip10Ed25519(seed: Uint8Array, path: string): Uint8Array {
  let block = hmac(sha512, utf8.encode('ed25519 seed'), seed);
  let key = block.subarray(0, 32);
  let chain = block.subarray(32);
  const parts = path.replace(/^m\/?/, '').split('/').filter(Boolean);
  for (const part of parts) {
    if (!part.endsWith("'")) {
      throw new Error(`SLIP-10 ed25519 path must be hardened (${path})`);
    }
    const index = 0x80000000 + Number.parseInt(part.slice(0, -1), 10);
    block = hmac(sha512, chain, concatBytes(Uint8Array.of(0x00), key, u32be(index)));
    key = block.subarray(0, 32);
    chain = block.subarray(32);
  }
  return key;
}

function solanaAddress(seed: Uint8Array, path: string): string {
  const secret = slip10Ed25519(seed, path);
  return base58.encode(ed25519.getPublicKey(secret));
}

function nearImplicit(seed: Uint8Array, path: string): string {
  const secret = slip10Ed25519(seed, path);
  return bytesToHex(ed25519.getPublicKey(secret));
}

function avalancheX(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, true);
  const words = bech32.toWords(hash160(pub));
  return bech32.encode('avax', [0, ...words]);
}

function cosmosAddress(privateKey: Uint8Array, hrp = 'cosmos'): string {
  const pub = secp256k1.getPublicKey(privateKey, true);
  return bech32.encode(hrp, bech32.toWords(hash160(pub)));
}

function encodeRipple(payload: Uint8Array): string {
  const alphabet = RIPPLE_ALPHABET;
  const digits: number[] = [];
  for (const byte of payload) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let zeros = 0;
  for (const byte of payload) {
    if (byte !== 0) {
      break;
    }
    zeros += 1;
  }
  let out = alphabet[0].repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += alphabet[digits[i]];
  }
  return out;
}

function xrpAddress(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, true);
  const payload = concatBytes(Uint8Array.of(0x00), hash160(pub));
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return encodeRipple(concatBytes(payload, checksum));
}

function tonBounceable(seed: Uint8Array, path: string): string {
  const pub = ed25519.getPublicKey(slip10Ed25519(seed, path));
  return tonBounceableAddr(pub);
}

function aptosAddress(seed: Uint8Array, path: string): string {
  const pub = ed25519.getPublicKey(slip10Ed25519(seed, path));
  const auth = sha3_256(concatBytes(pub, Uint8Array.of(0x00)));
  return `0x${bytesToHex(auth)}`;
}

function suiAddress(seed: Uint8Array, path: string): string {
  const pub = ed25519.getPublicKey(slip10Ed25519(seed, path));
  const hash = blake2b(concatBytes(Uint8Array.of(0x00), pub), { dkLen: 32 });
  return `0x${bytesToHex(hash)}`;
}

function cardanoEnterprise(secret: Uint8Array, path: string, passphrase: string, backup: BackupKind): string {
  if (backup !== 'bip39') {
    const hardened = path
      .split('/')
      .map((part) => (part === 'm' || part.endsWith("'") ? part : `${part}'`))
      .join('/');
    const seed = toBip32Seed(secret, backup, '');
    const pub = ed25519.getPublicKey(slip10Ed25519(seed, hardened));
    return cardanoEnterpriseAddr(pub);
  }
  return cardanoEnterpriseAddr(deriveIcarus(secret, path, passphrase, backup).publicKey);
}

function ss58Encode(publicKey: Uint8Array, prefix = 0): string {
  const body = concatBytes(Uint8Array.of(prefix), publicKey);
  const hash = blake2b(concatBytes(utf8.encode('SS58PRE'), body), { dkLen: 64 });
  const checksumLen = publicKey.length === 32 ? 2 : 1;
  return base58.encode(concatBytes(body, hash.subarray(0, checksumLen)));
}

function polkadotAddress(seed: Uint8Array, path: string): string {
  const pub = ed25519.getPublicKey(slip10Ed25519(seed, path));
  return ss58Encode(pub, 0);
}

export const FAST_INSPECT_IDS: ChainPathId[] = [
  'btc-legacy',
  'btc-nested',
  'btc-native',
  'btc-taproot',
  'ltc',
  'doge',
  'eth',
  'avax',
  'trx',
  'atom',
  'xrp',
  'near',
  'sol-ledger',
  'sol-phantom',
  'dot',
  'ton',
  'apt',
  'sui',
];

export const SLOW_INSPECT_IDS: ChainPathId[] = ['ada'];

export const PREVIEW_INSPECT_IDS: ChainPathId[] = ['eth', 'btc-native', 'near', 'sol-ledger'];

export const INSPECT_CHUNK_SIZE = 4;

const DEFAULT_INSPECT_ORDER: ChainPathId[] = [
  'btc-legacy',
  'btc-nested',
  'btc-native',
  'btc-taproot',
  'ltc',
  'doge',
  'eth',
  'avax',
  'trx',
  'atom',
  'xrp',
  'near',
  'sol-ledger',
  'sol-phantom',
  'ada',
  'dot',
  'ton',
  'apt',
  'sui',
];

type InspectCtx = {
  secret: Uint8Array;
  seed: Uint8Array;
  backup: BackupKind;
  passphrase: string;
  map: ReturnType<typeof mergeChainPaths>;
};

function makeInspectCtx(
  secret: Uint8Array,
  backup: BackupKind,
  passphrase: string,
  paths?: ChainPathMap,
): InspectCtx {
  return {
    secret,
    seed: toBip32Seed(secret, backup, backup === 'bip39' ? passphrase : ''),
    backup,
    passphrase,
    map: mergeChainPaths(paths),
  };
}

function inspectWithCtx(ctx: InspectCtx, ids?: readonly ChainPathId[]): InspectRow[] {
  const { seed, secret, passphrase, backup, map } = ctx;
  const wanted = ids ? new Set(ids) : null;
  const include = (id: ChainPathId) => !wanted || wanted.has(id);
  const row = (id: ChainPathId, address: string): InspectRow => ({
    id,
    label: CHAIN_PATH_LABELS[id],
    path: map[id],
    address,
  });
  const rows: InspectRow[] = [];
  if (include('btc-legacy')) {
    rows.push(row('btc-legacy', bitcoinP2pkh(secpKey(seed, map['btc-legacy']))));
  }
  if (include('btc-nested')) {
    rows.push(row('btc-nested', bitcoinP2shP2wpkh(secpKey(seed, map['btc-nested']))));
  }
  if (include('btc-native')) {
    rows.push(row('btc-native', bitcoinP2wpkh(secpKey(seed, map['btc-native']))));
  }
  if (include('btc-taproot')) {
    rows.push(row('btc-taproot', bitcoinP2tr(secpKey(seed, map['btc-taproot']))));
  }
  if (include('ltc')) {
    rows.push(row('ltc', bitcoinP2wpkh(secpKey(seed, map.ltc), 'ltc')));
  }
  if (include('doge')) {
    rows.push(row('doge', bitcoinP2pkh(secpKey(seed, map.doge), 0x1e)));
  }
  if (include('eth')) {
    rows.push(row('eth', ethAddress(secpKey(seed, map.eth))));
  }
  if (include('avax')) {
    rows.push(row('avax', avalancheX(secpKey(seed, map.avax))));
  }
  if (include('trx')) {
    rows.push(row('trx', tronAddress(secpKey(seed, map.trx))));
  }
  if (include('atom')) {
    rows.push(row('atom', cosmosAddress(secpKey(seed, map.atom))));
  }
  if (include('xrp')) {
    rows.push(row('xrp', xrpAddress(secpKey(seed, map.xrp))));
  }
  if (include('near')) {
    rows.push(row('near', nearImplicit(seed, map.near)));
  }
  if (include('sol-ledger')) {
    rows.push(row('sol-ledger', solanaAddress(seed, map['sol-ledger'])));
  }
  if (include('sol-phantom')) {
    rows.push(row('sol-phantom', solanaAddress(seed, map['sol-phantom'])));
  }
  if (include('ada')) {
    rows.push(row('ada', cardanoEnterprise(secret, map.ada, passphrase, backup)));
  }
  if (include('dot')) {
    rows.push(row('dot', polkadotAddress(seed, map.dot)));
  }
  if (include('ton')) {
    rows.push(row('ton', tonBounceable(seed, map.ton)));
  }
  if (include('apt')) {
    rows.push(row('apt', aptosAddress(seed, map.apt)));
  }
  if (include('sui')) {
    rows.push(row('sui', suiAddress(seed, map.sui)));
  }
  return rows;
}

export function inspectAddresses(
  secret: Uint8Array,
  backup: BackupKind = 'bip39',
  passphrase = '',
  paths?: ChainPathMap,
  ids?: readonly ChainPathId[],
): InspectRow[] {
  return inspectWithCtx(makeInspectCtx(secret, backup, passphrase, paths), ids);
}

function yieldUi(): Promise<void> {
  return new Promise((resolve) => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
    if (typeof raf === 'function') {
      raf(() => raf(() => resolve()));
      return;
    }
    setTimeout(resolve, 0);
  });
}

export async function inspectAddressesChunked(
  secret: Uint8Array,
  backup: BackupKind = 'bip39',
  passphrase = '',
  paths?: ChainPathMap,
  ids?: readonly ChainPathId[],
  options?: {
    onChunk?: (rows: InspectRow[]) => void;
    chunkSize?: number;
    yieldFrame?: () => Promise<void>;
    shouldAbort?: () => boolean;
  },
): Promise<InspectRow[]> {
  const ctx = makeInspectCtx(secret, backup, passphrase, paths);
  const order = ids ?? DEFAULT_INSPECT_ORDER;
  const size = options?.chunkSize ?? INSPECT_CHUNK_SIZE;
  const yieldFrame = options?.yieldFrame ?? yieldUi;
  const rows: InspectRow[] = [];
  for (let i = 0; i < order.length; i += size) {
    if (options?.shouldAbort?.()) {
      return rows;
    }
    await yieldFrame();
    if (options?.shouldAbort?.()) {
      return rows;
    }
    rows.push(...inspectWithCtx(ctx, order.slice(i, i + size)));
    options?.onChunk?.([...rows]);
  }
  return rows;
}
