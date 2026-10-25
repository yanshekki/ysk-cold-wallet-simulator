import { bech32, base58, base58check as createBase58check } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256, sha3_256 } from '@noble/hashes/sha3';
import { blake2b } from '@noble/hashes/blake2b';
import { concatBytes, encodeAscii } from '../bytes';

const b58c = createBase58check(sha256);
const utf8 = new TextEncoder();
const RIPPLE_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

export function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

export function encodePubAndAddress(publicKey: Uint8Array, address: string): Uint8Array {
  const addr = encodeAscii(address);
  return concatBytes(Uint8Array.of(publicKey.length), publicKey, Uint8Array.of(addr.length), addr);
}

export function cosmosBech32(compressedPub: Uint8Array, hrp = 'cosmos'): string {
  return bech32.encode(hrp, bech32.toWords(hash160(compressedPub)));
}

export function tronBase58(uncompressedOrCompressed: Uint8Array): string {
  const pub =
    uncompressedOrCompressed.length === 33
      ? secp256k1.ProjectivePoint.fromHex(uncompressedOrCompressed).toRawBytes(false)
      : uncompressedOrCompressed;
  const hash = keccak_256(pub.subarray(1));
  return b58c.encode(concatBytes(Uint8Array.of(0x41), hash.subarray(12)));
}

function encodeRipple(payload: Uint8Array): string {
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
  let out = RIPPLE_ALPHABET[0].repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += RIPPLE_ALPHABET[digits[i]];
  }
  return out;
}

export function xrpClassic(compressedPub: Uint8Array): string {
  const payload = concatBytes(Uint8Array.of(0x00), hash160(compressedPub));
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return encodeRipple(concatBytes(payload, checksum));
}

export function ss58Encode(publicKey: Uint8Array, prefix = 0): string {
  const body = concatBytes(Uint8Array.of(prefix), publicKey);
  const hash = blake2b(concatBytes(utf8.encode('SS58PRE'), body), { dkLen: 64 });
  const checksumLen = publicKey.length === 32 ? 2 : 1;
  return base58.encode(concatBytes(body, hash.subarray(0, checksumLen)));
}

export function aptosAuthKey(ed25519Pub: Uint8Array): string {
  const auth = sha3_256(concatBytes(ed25519Pub, Uint8Array.of(0x00)));
  return `0x${Array.from(auth, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function suiAddress(ed25519Pub: Uint8Array): string {
  const hash = blake2b(concatBytes(Uint8Array.of(0x00), ed25519Pub), { dkLen: 32 });
  return `0x${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function cardanoEnterprise(ed25519Pub: Uint8Array): string {
  const keyHash = blake2b(ed25519Pub, { dkLen: 28 });
  const payload = concatBytes(Uint8Array.of(0x61), keyHash);
  return bech32.encode('addr', bech32.toWords(payload), 1023);
}

function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

/** Wallet v4r2 data-cell digest (seqno||walletId||pubkey||empty-plugins). Not full StateInit+code. */
export function tonDataCellAccountId(ed25519Pub: Uint8Array): Uint8Array {
  const bits = new Uint8Array(41);
  bits[4] = 0x29;
  bits[5] = 0xa9;
  bits[6] = 0xa3;
  bits[7] = 0x17;
  bits.set(ed25519Pub, 8);
  return sha256(concatBytes(utf8.encode('ton.wallet.v4r2.data'), bits));
}

export function tonBounceable(ed25519Pub: Uint8Array): string {
  const accountId = tonDataCellAccountId(ed25519Pub);
  const raw = concatBytes(Uint8Array.of(0x11, 0x00), accountId);
  const crc = crc16Xmodem(raw);
  return base64Url(concatBytes(raw, Uint8Array.of((crc >> 8) & 0xff, crc & 0xff)));
}

export function encodeDerSignature(compactRs: Uint8Array): Uint8Array {
  const r = trimDerInt(compactRs.subarray(0, 32));
  const s = trimDerInt(compactRs.subarray(32, 64));
  const body = concatBytes(Uint8Array.of(0x02, r.length), r, Uint8Array.of(0x02, s.length), s);
  return concatBytes(Uint8Array.of(0x30, body.length), body);
}

function trimDerInt(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start += 1;
  }
  const trimmed = bytes.subarray(start);
  if (trimmed[0] & 0x80) {
    return concatBytes(Uint8Array.of(0x00), trimmed);
  }
  return trimmed;
}
