import { gcm } from '@noble/ciphers/aes';
import { x25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { asBytes, concatBytes, encodeUtf8, equalBytes } from './bytes';
import {
  decodeHandshakeCompletionPayload,
  decodePairingCredential,
  encodeAuthenticatedCredentialData,
  encodeHandshakeCompletionPayload,
  encodePairingCredential,
  TREZOR_STATE_PAIRED,
  TREZOR_STATE_UNPAIRED,
  type CredentialMetadata,
} from './messages';

export const PROTOCOL_NAME = (() => {
  const name = encodeUtf8('Noise_XX_25519_AESGCM_SHA256');
  const padded = new Uint8Array(32);
  padded.set(name);
  return padded;
})();

export type X25519KeyPair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export function generateX25519KeyPair(): X25519KeyPair {
  const privateKey = asBytes(x25519.utils.randomPrivateKey());
  return { privateKey, publicKey: asBytes(x25519.getPublicKey(privateKey)) };
}

export function x25519Dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return asBytes(x25519.scalarMult(privateKey, publicKey));
}

export function mixHash(h: Uint8Array, data: Uint8Array): Uint8Array {
  return asBytes(sha256(concatBytes(h, data)));
}

export function hkdf(chainingKey: Uint8Array, input: Uint8Array): [Uint8Array, Uint8Array] {
  const tempKey = hmac(sha256, chainingKey, input);
  const output1 = hmac(sha256, tempKey, Uint8Array.of(0x01));
  const output2 = hmac(sha256, tempKey, concatBytes(output1, Uint8Array.of(0x02)));
  return [asBytes(output1), asBytes(output2)];
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return asBytes(hmac(sha256, key, data));
}

export function nonceToIv(nonce: number): Uint8Array {
  const iv = new Uint8Array(12);
  const n = BigInt(nonce);
  for (let i = 0; i < 8; i++) {
    iv[11 - i] = Number((n >> BigInt(i * 8)) & 0xffn);
  }
  return iv;
}

export function aesGcmEncrypt(
  key: Uint8Array,
  nonce: number,
  ad: Uint8Array,
  plaintext: Uint8Array,
): Uint8Array {
  return asBytes(gcm(key, nonceToIv(nonce), ad).encrypt(plaintext));
}

export function aesGcmDecrypt(
  key: Uint8Array,
  nonce: number,
  ad: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  return asBytes(gcm(key, nonceToIv(nonce), ad).decrypt(ciphertext));
}

export function maskStaticPublicKey(staticPublicKey: Uint8Array, ephemeralPublicKey: Uint8Array): Uint8Array {
  const mask = asBytes(sha256(concatBytes(staticPublicKey, ephemeralPublicKey)));
  return x25519Dh(mask, staticPublicKey);
}

export function issueCredential(
  credAuthKey: Uint8Array,
  hostStaticPublicKey: Uint8Array,
  meta: CredentialMetadata,
): Uint8Array {
  const mac = hmacSha256(credAuthKey, encodeAuthenticatedCredentialData(hostStaticPublicKey, meta));
  return encodePairingCredential(meta, mac);
}

export function validateCredential(
  credAuthKey: Uint8Array,
  credential: Uint8Array,
  hostStaticPublicKey: Uint8Array,
): CredentialMetadata | undefined {
  try {
    const decoded = decodePairingCredential(credential);
    if (decoded.mac.length === 0) {
      return undefined;
    }
    const expected = hmacSha256(
      credAuthKey,
      encodeAuthenticatedCredentialData(hostStaticPublicKey, decoded.meta),
    );
    if (!equalBytes(expected, decoded.mac)) {
      return undefined;
    }
    return decoded.meta;
  } catch {
    return undefined;
  }
}

export class ThpNoiseResponder {
  readonly staticPublicKey: Uint8Array;
  handshakeHash: Uint8Array = new Uint8Array();
  private readonly staticPrivateKey: Uint8Array;
  private readonly deviceProperties: Uint8Array;
  private readonly credAuthKey: Uint8Array;
  private ephemeral?: X25519KeyPair;
  private chainingKey: Uint8Array = new Uint8Array();
  private handshakeKey: Uint8Array = new Uint8Array();
  private keyRequest: Uint8Array = new Uint8Array();
  private keyResponse: Uint8Array = new Uint8Array();
  private nonceRequest = 0;
  private nonceResponse = 1;
  private ready = false;

  constructor(deviceProperties: Uint8Array, credAuthKey: Uint8Array, staticKey?: X25519KeyPair) {
    this.deviceProperties = deviceProperties;
    this.credAuthKey = credAuthKey;
    const keys = staticKey ?? generateX25519KeyPair();
    this.staticPrivateKey = keys.privateKey;
    this.staticPublicKey = keys.publicKey;
  }

  handshakeInit(payload: Uint8Array): Uint8Array {
    if (payload.length < 32) {
      throw new Error('handshake init too short');
    }
    const hostEphemeral = payload.subarray(0, 32);
    const tryToUnlock = payload.length > 32 ? Uint8Array.of(payload[32] & 0x01) : Uint8Array.of(0);
    this.ephemeral = generateX25519KeyPair();
    let h = asBytes(sha256(concatBytes(PROTOCOL_NAME, this.deviceProperties)));
    h = mixHash(h, hostEphemeral);
    h = mixHash(h, tryToUnlock);
    h = mixHash(h, this.ephemeral.publicKey);
    let [ck, k] = hkdf(PROTOCOL_NAME, x25519Dh(this.ephemeral.privateKey, hostEphemeral));
    const masked = maskStaticPublicKey(this.staticPublicKey, this.ephemeral.publicKey);
    const encryptedStatic = aesGcmEncrypt(k, 0, h, masked);
    h = mixHash(h, encryptedStatic);
    const mask = asBytes(sha256(concatBytes(this.staticPublicKey, this.ephemeral.publicKey)));
    const dh2 = x25519Dh(mask, x25519Dh(this.staticPrivateKey, hostEphemeral));
    [ck, k] = hkdf(ck, dh2);
    const tag = aesGcmEncrypt(k, 0, h, new Uint8Array());
    h = mixHash(h, tag);
    this.handshakeHash = h;
    this.chainingKey = ck;
    this.handshakeKey = k;
    return concatBytes(this.ephemeral.publicKey, encryptedStatic, tag);
  }

  handshakeComplete(payload: Uint8Array): { state: number; hostStatic: Uint8Array } {
    if (!this.ephemeral) {
      throw new Error('handshake not started');
    }
    if (payload.length < 64) {
      throw new Error('handshake completion too short');
    }
    const encryptedHostStatic = payload.subarray(0, 48);
    const encryptedPayload = payload.subarray(48);
    const hostStatic = aesGcmDecrypt(this.handshakeKey, 1, this.handshakeHash, encryptedHostStatic);
    this.handshakeHash = mixHash(this.handshakeHash, encryptedHostStatic);
    const [ck, k] = hkdf(this.chainingKey, x25519Dh(this.ephemeral.privateKey, hostStatic));
    const payloadBinary = aesGcmDecrypt(k, 0, this.handshakeHash, encryptedPayload);
    this.handshakeHash = mixHash(this.handshakeHash, encryptedPayload);
    this.chainingKey = ck;
    const credential = decodeHandshakeCompletionPayload(payloadBinary);
    let state = TREZOR_STATE_UNPAIRED;
    if (credential && validateCredential(this.credAuthKey, credential, hostStatic)) {
      state = TREZOR_STATE_PAIRED;
    }
    const [keyRequest, keyResponse] = hkdf(this.chainingKey, new Uint8Array());
    this.keyRequest = keyRequest;
    this.keyResponse = keyResponse;
    this.nonceRequest = 0;
    this.nonceResponse = 1;
    this.ready = true;
    return { state, hostStatic };
  }

  completionResponse(state: number): Uint8Array {
    return aesGcmEncrypt(this.keyResponse, 0, new Uint8Array(), Uint8Array.of(state));
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    if (!this.ready) {
      throw new Error('noise not ready');
    }
    const ciphertext = aesGcmEncrypt(this.keyResponse, this.nonceResponse, new Uint8Array(), plaintext);
    this.nonceResponse += 1;
    return ciphertext;
  }

  decrypt(ciphertext: Uint8Array): Uint8Array {
    if (!this.ready) {
      throw new Error('noise not ready');
    }
    const plaintext = aesGcmDecrypt(this.keyRequest, this.nonceRequest, new Uint8Array(), ciphertext);
    this.nonceRequest += 1;
    return plaintext;
  }
}

export class ThpNoiseInitiator {
  handshakeHash: Uint8Array = new Uint8Array();
  hostStatic: X25519KeyPair;
  private readonly deviceProperties: Uint8Array;
  private ephemeral?: X25519KeyPair;
  private chainingKey: Uint8Array = new Uint8Array();
  private keyRequest: Uint8Array = new Uint8Array();
  private keyResponse: Uint8Array = new Uint8Array();
  private nonceRequest = 0;
  private nonceResponse = 1;
  private ready = false;
  private tryToUnlock = Uint8Array.of(0);

  constructor(deviceProperties: Uint8Array, hostStatic?: X25519KeyPair) {
    this.deviceProperties = deviceProperties;
    this.hostStatic = hostStatic ?? generateX25519KeyPair();
  }

  initRequest(tryToUnlock = 0): Uint8Array {
    this.ephemeral = generateX25519KeyPair();
    this.tryToUnlock = Uint8Array.of(tryToUnlock & 0x01);
    return concatBytes(this.ephemeral.publicKey, this.tryToUnlock);
  }

  completeRequest(initResponse: Uint8Array, credential?: Uint8Array): Uint8Array {
    if (!this.ephemeral) {
      throw new Error('handshake not started');
    }
    if (initResponse.length !== 96) {
      throw new Error('handshake init response must be 96 bytes');
    }
    const trezorEphemeral = initResponse.subarray(0, 32);
    const encryptedStatic = initResponse.subarray(32, 80);
    const tag = initResponse.subarray(80, 96);
    let h = asBytes(sha256(concatBytes(PROTOCOL_NAME, this.deviceProperties)));
    h = mixHash(h, this.ephemeral.publicKey);
    h = mixHash(h, this.tryToUnlock);
    h = mixHash(h, trezorEphemeral);
    let [ck, k] = hkdf(PROTOCOL_NAME, x25519Dh(this.ephemeral.privateKey, trezorEphemeral));
    const masked = aesGcmDecrypt(k, 0, h, encryptedStatic);
    h = mixHash(h, encryptedStatic);
    [ck, k] = hkdf(ck, x25519Dh(this.ephemeral.privateKey, masked));
    aesGcmDecrypt(k, 0, h, tag);
    h = mixHash(h, tag);
    const encryptedHostStatic = aesGcmEncrypt(k, 1, h, this.hostStatic.publicKey);
    h = mixHash(h, encryptedHostStatic);
    [ck, k] = hkdf(ck, x25519Dh(this.hostStatic.privateKey, trezorEphemeral));
    const encryptedPayload = aesGcmEncrypt(k, 0, h, encodeHandshakeCompletionPayload(credential));
    h = mixHash(h, encryptedPayload);
    this.handshakeHash = h;
    this.chainingKey = ck;
    return concatBytes(encryptedHostStatic, encryptedPayload);
  }

  finish(encryptedState: Uint8Array): number {
    const [keyRequest, keyResponse] = hkdf(this.chainingKey, new Uint8Array());
    this.keyRequest = keyRequest;
    this.keyResponse = keyResponse;
    this.nonceRequest = 0;
    this.nonceResponse = 1;
    this.ready = true;
    const state = aesGcmDecrypt(this.keyResponse, 0, new Uint8Array(), encryptedState);
    return state[0] ?? TREZOR_STATE_UNPAIRED;
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    if (!this.ready) {
      throw new Error('noise not ready');
    }
    const ciphertext = aesGcmEncrypt(this.keyRequest, this.nonceRequest, new Uint8Array(), plaintext);
    this.nonceRequest += 1;
    return ciphertext;
  }

  decrypt(ciphertext: Uint8Array): Uint8Array {
    if (!this.ready) {
      throw new Error('noise not ready');
    }
    const plaintext = aesGcmDecrypt(this.keyResponse, this.nonceResponse, new Uint8Array(), ciphertext);
    this.nonceResponse += 1;
    return plaintext;
  }
}
