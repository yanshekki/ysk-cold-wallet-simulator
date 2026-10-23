import { HDKey } from '@scure/bip32';
import { bech32, bech32m, base58, base58check as createBase58check } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import { sha512 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import type { BackupKind } from '@cws/contracts';
import { toBip32Seed } from './seed';

export type InspectRow = {
  id: string;
  label: string;
  path: string;
  address: string;
};

const b58c = createBase58check(sha256);
const utf8 = new TextEncoder();

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
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

function ethAddress(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, false);
  const hash = keccak_256(pub.subarray(1));
  return checksumEth(bytesToHex(hash.subarray(12)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bitcoinP2pkh(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, true);
  return b58c.encode(concatBytes(Uint8Array.of(0x00), hash160(pub)));
}

function bitcoinP2shP2wpkh(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, true);
  const redeem = concatBytes(Uint8Array.of(0x00, 0x14), hash160(pub));
  return b58c.encode(concatBytes(Uint8Array.of(0x05), hash160(redeem)));
}

function bitcoinP2wpkh(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, true);
  const words = bech32.toWords(hash160(pub));
  return bech32.encode('bc', [0, ...words]);
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

export function inspectAddresses(
  secret: Uint8Array,
  backup: BackupKind = 'bip39',
  passphrase = '',
): InspectRow[] {
  const seed = toBip32Seed(secret, backup, backup === 'bip39' ? passphrase : '');
  const btcLegacy = secpKey(seed, "m/44'/0'/0'/0/0");
  const btcNested = secpKey(seed, "m/49'/0'/0'/0/0");
  const btcNative = secpKey(seed, "m/84'/0'/0'/0/0");
  const btcTaproot = secpKey(seed, "m/86'/0'/0'/0/0");
  const eth = secpKey(seed, "m/44'/60'/0'/0/0");
  const trx = secpKey(seed, "m/44'/195'/0'/0/0");
  return [
    { id: 'btc-legacy', label: 'Bitcoin Legacy', path: "m/44'/0'/0'/0/0", address: bitcoinP2pkh(btcLegacy) },
    { id: 'btc-nested', label: 'Bitcoin Nested SegWit', path: "m/49'/0'/0'/0/0", address: bitcoinP2shP2wpkh(btcNested) },
    { id: 'btc-native', label: 'Bitcoin Native SegWit', path: "m/84'/0'/0'/0/0", address: bitcoinP2wpkh(btcNative) },
    { id: 'btc-taproot', label: 'Bitcoin Taproot', path: "m/86'/0'/0'/0/0", address: bitcoinP2tr(btcTaproot) },
    { id: 'eth', label: 'Ethereum / EVM', path: "m/44'/60'/0'/0/0", address: ethAddress(eth) },
    { id: 'trx', label: 'Tron', path: "m/44'/195'/0'/0/0", address: tronAddress(trx) },
    { id: 'sol-ledger', label: 'Solana (Ledger)', path: "m/44'/501'/0'", address: solanaAddress(seed, "m/44'/501'/0'") },
    {
      id: 'sol-trezor',
      label: 'Solana (Trezor)',
      path: "m/44'/501'/0'/0'",
      address: solanaAddress(seed, "m/44'/501'/0'/0'"),
    },
  ];
}
