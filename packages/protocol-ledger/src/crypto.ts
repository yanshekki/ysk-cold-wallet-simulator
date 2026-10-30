import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { p256 } from '@noble/curves/nist';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import type { BackupKind, ConfirmationPort } from '@cws/contracts';
import { bytesToHex, concatBytes, encodeAscii } from './bytes';

const utf8 = new TextEncoder();

function u32be(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

export function mnemonicFromEntropy(entropy: Uint8Array): string {
  return entropyToMnemonic(entropy, wordlist);
}

export type HdNode = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  chainCode: Uint8Array;
};

export function deriveHdNodeFromSeed(seed: Uint8Array, path: string): HdNode {
  const child = HDKey.fromMasterSeed(seed).derive(path);
  if (!child.privateKey || !child.publicKey || !child.chainCode) {
    throw new Error('derived key is incomplete');
  }
  return {
    privateKey: child.privateKey,
    publicKey: child.publicKey,
    chainCode: child.chainCode,
  };
}

export function deriveHdNode(
  entropy: Uint8Array,
  path: string,
  passphrase?: string,
  backup: BackupKind = 'bip39',
): HdNode {
  const seed =
    backup === 'slip39'
      ? entropy
      : mnemonicToSeedSync(mnemonicFromEntropy(entropy), passphrase ?? '');
  return deriveHdNodeFromSeed(seed, path);
}

export function derivePrivateKeyFromSeed(seed: Uint8Array, path: string): Uint8Array {
  return deriveHdNodeFromSeed(seed, path).privateKey;
}

export function derivePrivateKey(
  entropy: Uint8Array,
  path: string,
  passphrase?: string,
  backup: BackupKind = 'bip39',
): Uint8Array {
  return deriveHdNode(entropy, path, passphrase, backup).privateKey;
}

export async function seedFor(
  confirmation: ConfirmationPort,
  slotId: string,
  entropy: Uint8Array,
  backup: BackupKind = 'bip39',
): Promise<Uint8Array> {
  const cached = await confirmation.getSeed?.(slotId);
  if (cached) {
    return cached;
  }
  const pass = await confirmation.getPassphrase(slotId);
  if (backup === 'slip39') {
    return entropy;
  }
  return mnemonicToSeedSync(mnemonicFromEntropy(entropy), pass ?? '');
}

export type SeedCache = {
  seed?: Uint8Array;
  icarusRoot?: Uint8Array;
};

export function wrapSeedPort(confirmation: ConfirmationPort, cache: SeedCache): ConfirmationPort {
  return {
    confirm: (request) => confirmation.confirm(request),
    getPassphrase: (slotId) => confirmation.getPassphrase(slotId),
    getSeed: async (slotId) => cache.seed ?? (await confirmation.getSeed?.(slotId)),
    getIcarusRoot: async (slotId) => cache.icarusRoot ?? (await confirmation.getIcarusRoot?.(slotId)),
    onPairingCode: confirmation.onPairingCode ? (code) => confirmation.onPairingCode?.(code) : undefined,
    resolvePath: confirmation.resolvePath
      ? (path, chains) => confirmation.resolvePath?.(path, chains) ?? path
      : undefined,
  };
}

export function replaceSeedCache(cache: SeedCache, seed: Uint8Array, icarusRoot?: Uint8Array): void {
  cache.seed?.fill(0);
  cache.icarusRoot?.fill(0);
  cache.seed = seed.slice();
  cache.icarusRoot = icarusRoot?.slice();
}

export async function icarusRootFor(
  confirmation: ConfirmationPort,
  slotId: string,
  entropy: Uint8Array,
  backup: BackupKind = 'bip39',
): Promise<Uint8Array | undefined> {
  const cached = await confirmation.getIcarusRoot?.(slotId);
  if (cached) {
    return cached;
  }
  if (backup === 'slip39') {
    return undefined;
  }
  const pass = await confirmation.getPassphrase(slotId);
  const { icarusRootFromEntropy } = await import('./apps/icarus');
  return icarusRootFromEntropy(entropy, pass ?? '');
}

export function publicKeyUncompressed(privateKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privateKey, false);
}

export function publicKeyCompressed(privateKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privateKey, true);
}

export function ethereumAddressFromPrivateKey(privateKey: Uint8Array): string {
  const pub = publicKeyUncompressed(privateKey);
  const hash = keccak_256(pub.subarray(1));
  const addr = bytesToHex(hash.subarray(12));
  return checksumAddress(addr);
}

export function checksumAddress(address: string): string {
  const hex = address.replace(/^0x/i, '').toLowerCase();
  const hash = bytesToHex(keccak_256(encodeAscii(hex)));
  let out = '';
  for (let i = 0; i < hex.length; i++) {
    const nibble = Number.parseInt(hash[i], 16);
    out += nibble >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}

export function personalMessageHash(message: Uint8Array): Uint8Array {
  const prefix = encodeAscii(`\x19Ethereum Signed Message:\n${message.length}`);
  return keccak_256(concatBytes(prefix, message));
}

export function signPersonalMessage(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  const hash = personalMessageHash(message);
  const sig = secp256k1.sign(hash, privateKey);
  const compact = sig.toCompactRawBytes();
  const v = (sig.recovery ?? 0) + 27;
  return concatBytes(Uint8Array.of(v), compact);
}

/** Avalanche SIGN_HASH: r||s||v with v in {0,1}. */
export function signSecp256k1Recoverable(privateKey: Uint8Array, hash: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(hash, privateKey);
  return concatBytes(sig.toCompactRawBytes(), Uint8Array.of(sig.recovery ?? 0));
}

export function slip10Ed25519(seed: Uint8Array, path: string): Uint8Array {
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

export function deriveEd25519PrivateKeyFromSeed(seed: Uint8Array, path: string): Uint8Array {
  return slip10Ed25519(seed, path);
}

export function deriveEd25519PrivateKey(
  entropy: Uint8Array,
  path: string,
  passphrase?: string,
  backup: BackupKind = 'bip39',
): Uint8Array {
  const seed =
    backup === 'slip39'
      ? entropy
      : mnemonicToSeedSync(mnemonicFromEntropy(entropy), passphrase ?? '');
  return deriveEd25519PrivateKeyFromSeed(seed, path);
}

export function ed25519PublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}

export function signEd25519(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function bigIntToBytes32(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let remaining = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

/**
 * BIP32 (not SLIP-10) for NIST P-256 / CX_CURVE_256R1 — LedgerHQ/app-neo
 * `bip32_derive_get_pubkey_256(CX_CURVE_256R1, ...)`.
 */
export function deriveP256PrivateKeyFromSeed(seed: Uint8Array, path: string): Uint8Array {
  let key = hmac(sha512, utf8.encode('Bitcoin seed'), seed);
  let privateKey = key.subarray(0, 32);
  let chainCode = key.subarray(32);
  const parts = path.replace(/^m\/?/, '').split('/').filter(Boolean);
  const n = p256.CURVE.n;
  for (const part of parts) {
    const hardened = part.endsWith("'");
    const index = Number.parseInt(hardened ? part.slice(0, -1) : part, 10);
    if (!Number.isFinite(index)) {
      throw new Error(`invalid BIP32 path component: ${part}`);
    }
    const data = new Uint8Array(37);
    if (hardened) {
      data[0] = 0x00;
      data.set(privateKey, 1);
      const idx = (0x80000000 + index) >>> 0;
      data.set(u32be(idx), 33);
    } else {
      data.set(p256.getPublicKey(privateKey, true), 0);
      data.set(u32be(index >>> 0), 33);
    }
    key = hmac(sha512, chainCode, data);
    const IL = bytesToBigInt(key.subarray(0, 32));
    chainCode = key.subarray(32);
    if (IL >= n) {
      throw new Error('invalid BIP32-P256 IL');
    }
    const next = (IL + bytesToBigInt(privateKey)) % n;
    if (next === 0n) {
      throw new Error('invalid BIP32-P256 child');
    }
    privateKey = bigIntToBytes32(next);
  }
  return privateKey;
}

export function publicKeyP256Uncompressed(privateKey: Uint8Array): Uint8Array {
  return p256.getPublicKey(privateKey, false);
}
