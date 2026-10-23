import { x25519 } from '@noble/curves/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2';
import { asBytes, concatBytes, encodeUtf8, equalBytes, randomBytes } from './bytes';
import { ThpPairingMethod } from './messages';
import { x25519Dh } from './noise';

const P = (1n << 255n) - 19n;
const J = 486662n;
const C4 = (P - 5n) / 8n;
const PREFIX = Uint8Array.of(0x08, 0x43, 0x50, 0x61, 0x63, 0x65, 0x32, 0x35, 0x35, 0x06);
const PADDING = concatBytes(Uint8Array.of(0x6f), new Uint8Array(111), Uint8Array.of(0x20));

function mod(value: bigint): bigint {
  const reduced = value % P;
  return reduced < 0n ? reduced + P : reduced;
}

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % P;
    }
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

function bytesToField(input: Uint8Array): bigint {
  let value = 0n;
  for (let i = 31; i >= 0; i--) {
    value = (value << 8n) + BigInt(input[i]);
  }
  return mod(value & ((1n << 255n) - 1n));
}

function fieldToBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let n = mod(value);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

const SQRT_M1 = (() => {
  const candidate = modPow(2n, (P - 1n) / 4n);
  return mod(candidate * candidate) === P - 1n ? candidate : modPow(P - 1n, (P + 3n) / 8n);
})();

export function elligator2(input: Uint8Array): Uint8Array {
  const u = bytesToField(input);
  const tv1 = mod(2n * u * u);
  const xd = mod(tv1 + 1n);
  const x1n = mod(-J);
  const tv2 = mod(xd * xd);
  const gxd = mod(tv2 * xd);
  let gx1 = mod(J * tv1);
  gx1 = mod(gx1 * x1n);
  gx1 = mod(gx1 + tv2);
  gx1 = mod(gx1 * x1n);
  let tv3 = mod(gxd * gxd);
  let tv2b = mod(tv3 * tv3);
  tv3 = mod(tv3 * gxd);
  tv3 = mod(tv3 * gx1);
  tv2b = mod(tv2b * tv3);
  let y11 = modPow(tv2b, C4);
  y11 = mod(y11 * tv3);
  const y12 = mod(y11 * SQRT_M1);
  let check = mod(y11 * y11);
  check = mod(check * gxd);
  const y1 = check === gx1 ? y11 : y12;
  const x2n = mod(x1n * tv1);
  check = mod(y1 * y1);
  check = mod(check * gxd);
  const xn = check === gx1 ? x1n : x2n;
  const x = mod(xn * modPow(xd, P - 2n));
  return fieldToBytes(x);
}

export function formatPairingCode(code: number): string {
  return code.toString().padStart(6, '0');
}

export function codeEntryCode(
  handshakeHash: Uint8Array,
  secret: Uint8Array,
  challenge: Uint8Array,
): number {
  const hash = asBytes(
    sha256(concatBytes(Uint8Array.of(ThpPairingMethod.CodeEntry), handshakeHash, secret, challenge)),
  );
  let value = 0n;
  for (const byte of hash) {
    value = (value << 8n) + BigInt(byte);
  }
  return Number(value % 1_000_000n);
}

export function cpacePregenerator(handshakeHash: Uint8Array, code: string): Uint8Array {
  return asBytes(
    sha512(concatBytes(PREFIX, encodeUtf8(code), PADDING, handshakeHash, Uint8Array.of(0x00))).subarray(0, 32),
  );
}

export class Cpace {
  handshakeHash: Uint8Array;
  privateKey: Uint8Array = new Uint8Array();
  publicKey: Uint8Array = new Uint8Array();
  sharedSecret: Uint8Array = new Uint8Array();

  constructor(handshakeHash: Uint8Array) {
    this.handshakeHash = handshakeHash;
  }

  generateKeys(code: string, privateKey?: Uint8Array): void {
    const generator = elligator2(cpacePregenerator(this.handshakeHash, code));
    this.privateKey = privateKey ?? asBytes(x25519.utils.randomPrivateKey());
    this.publicKey = asBytes(x25519.scalarMult(this.privateKey, generator));
  }

  computeSharedSecret(peerPublicKey: Uint8Array): Uint8Array {
    if (equalBytes(peerPublicKey, new Uint8Array(32))) {
      throw new Error('invalid CPace public key');
    }
    this.sharedSecret = x25519Dh(this.privateKey, peerPublicKey);
    if (equalBytes(this.sharedSecret, new Uint8Array(32))) {
      throw new Error('invalid CPace shared secret');
    }
    return this.sharedSecret;
  }

  hostTag(): Uint8Array {
    return asBytes(sha256(this.sharedSecret));
  }
}

export function generateCodeEntrySecret(): Uint8Array {
  return randomBytes(16);
}

export function codeEntryCommitment(secret: Uint8Array): Uint8Array {
  return asBytes(sha256(secret));
}
