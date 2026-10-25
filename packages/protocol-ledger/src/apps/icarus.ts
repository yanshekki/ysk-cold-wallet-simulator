import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import { ed25519 } from '@noble/curves/ed25519';
import { mnemonicFromEntropy } from '../crypto';
import { concatBytes } from '../bytes';
import type { BackupKind } from '@cws/contracts';

export type IcarusNode = {
  kL: Uint8Array;
  kR: Uint8Array;
  chainCode: Uint8Array;
  publicKey: Uint8Array;
};

function u32le(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function add256le(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  let carry = 0;
  for (let i = 0; i < 32; i++) {
    const sum = (a[i] ?? 0) + (b[i] ?? 0) + carry;
    out[i] = sum & 0xff;
    carry = sum >>> 8;
  }
  return out;
}

function shl3(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  let carry = 0;
  for (let i = 0; i < 32; i++) {
    const next = (bytes[i] << 3) | carry;
    out[i] = next & 0xff;
    carry = next >>> 8;
  }
  return out;
}

function bytesToLeBig(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    value = (value << 8n) + BigInt(bytes[i]);
  }
  return value;
}

function leBigToBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let next = value;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(next & 0xffn);
    next >>= 8n;
  }
  return out;
}

function pubFromKL(kL: Uint8Array): Uint8Array {
  const reduced = bytesToLeBig(kL) % ed25519.CURVE.n;
  const scalar = reduced === 0n ? 1n : reduced;
  return ed25519.Point.BASE.multiply(scalar).toRawBytes();
}

function rootFromMnemonic(mnemonic: string, passphrase: string): IcarusNode {
  const xprv = pbkdf2(
    sha512,
    mnemonic.normalize('NFKD'),
    `mnemonic${passphrase}`.normalize('NFKD'),
    { c: 4096, dkLen: 96 },
  );
  const kL = xprv.slice(0, 32);
  const kR = xprv.slice(32, 64);
  const chainCode = xprv.slice(64, 96);
  kL[0] &= 0xf8;
  kL[31] &= 0x1f;
  kL[31] |= 0x40;
  return { kL, kR, chainCode, publicKey: pubFromKL(kL) };
}

/** 96-byte Icarus root: kL || kR || chainCode. */
export function icarusRootFromEntropy(entropy: Uint8Array, passphrase = ''): Uint8Array {
  const node = rootFromMnemonic(mnemonicFromEntropy(entropy), passphrase);
  return concatBytes(node.kL, node.kR, node.chainCode);
}

export function icarusNodeFromRoot(root: Uint8Array): IcarusNode {
  if (root.length < 96) {
    throw new Error('Icarus root is truncated');
  }
  const kL = root.subarray(0, 32).slice();
  const kR = root.subarray(32, 64).slice();
  const chainCode = root.subarray(64, 96).slice();
  return { kL, kR, chainCode, publicKey: pubFromKL(kL) };
}

export function deriveIcarusFromRoot(root: Uint8Array, path: string): IcarusNode {
  let node = icarusNodeFromRoot(root);
  const parts = path.replace(/^m\/?/, '').split('/').filter(Boolean);
  for (const part of parts) {
    const hardened = part.endsWith("'");
    const index = Number.parseInt(hardened ? part.slice(0, -1) : part, 10);
    node = deriveChild(node, (hardened ? 0x80000000 : 0) + index);
  }
  return node;
}

function deriveChild(parent: IcarusNode, index: number): IcarusNode {
  const hardened = (index & 0x80000000) !== 0;
  const data = hardened
    ? concatBytes(Uint8Array.of(0x00), parent.kL, parent.kR, u32le(index))
    : concatBytes(Uint8Array.of(0x02), parent.publicKey, u32le(index));
  const z = hmac(sha512, parent.chainCode, data);
  const zL = z.subarray(0, 32);
  const zR = z.subarray(32);
  const kL = add256le(parent.kL, shl3(concatBytes(zL.subarray(0, 28), new Uint8Array(4))));
  const kR = add256le(parent.kR, zR);
  const ccData = hardened
    ? concatBytes(Uint8Array.of(0x01), parent.kL, parent.kR, u32le(index))
    : concatBytes(Uint8Array.of(0x03), parent.publicKey, u32le(index));
  const chainCode = hmac(sha512, parent.chainCode, ccData).subarray(32);
  kL[0] &= 0xf8;
  kL[31] &= 0x1f;
  kL[31] |= 0x40;
  return { kL, kR, chainCode, publicKey: pubFromKL(kL) };
}

export function deriveIcarus(
  entropy: Uint8Array,
  path: string,
  passphrase?: string,
  backup: BackupKind = 'bip39',
  root?: Uint8Array,
): IcarusNode {
  if (backup === 'slip39') {
    throw new Error('Cardano Icarus needs BIP39');
  }
  if (root && root.length >= 96) {
    return deriveIcarusFromRoot(root, path);
  }
  return deriveIcarusFromRoot(icarusRootFromEntropy(entropy, passphrase ?? ''), path);
}

export function signIcarus(node: IcarusNode, message: Uint8Array): Uint8Array {
  const L = ed25519.CURVE.n;
  const nonce = sha512(concatBytes(node.kR, message));
  const r = bytesToLeBig(nonce) % L;
  const R = ed25519.Point.BASE.multiply(r).toRawBytes();
  const hram = sha512(concatBytes(R, node.publicKey, message));
  const S = (r + (bytesToLeBig(hram) % L) * (bytesToLeBig(node.kL) % L)) % L;
  return concatBytes(R, leBigToBytes(S));
}
