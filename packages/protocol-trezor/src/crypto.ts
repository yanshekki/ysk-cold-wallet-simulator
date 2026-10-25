import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import type { BackupKind } from '@cws/contracts';
import { bytesToHex, concatBytes, encodeUtf8 } from './bytes';

export function mnemonicFromEntropy(entropy: Uint8Array): string {
  return entropyToMnemonic(entropy, wordlist);
}

export function derivePrivateKey(
  entropy: Uint8Array,
  path: string,
  passphrase?: string,
  backup: BackupKind = 'bip39',
): Uint8Array {
  const seed =
    backup === 'slip39'
      ? entropy
      : mnemonicToSeedSync(mnemonicFromEntropy(entropy), passphrase ?? '');
  const child = HDKey.fromMasterSeed(seed).derive(path);
  if (!child.privateKey) {
    throw new Error('derived key has no private key');
  }
  return child.privateKey;
}

export function publicKeyUncompressed(privateKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privateKey, false);
}

export function checksumAddress(address: string): string {
  const hex = address.replace(/^0x/i, '').toLowerCase();
  const hash = bytesToHex(keccak_256(encodeUtf8(hex)));
  let out = '0x';
  for (let i = 0; i < hex.length; i++) {
    const nibble = Number.parseInt(hash[i], 16);
    out += nibble >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}

export function ethereumAddressFromPrivateKey(privateKey: Uint8Array): string {
  const pub = publicKeyUncompressed(privateKey);
  const hash = keccak_256(pub.subarray(1));
  return checksumAddress(bytesToHex(hash.subarray(12)));
}

export function personalMessageHash(message: Uint8Array): Uint8Array {
  const prefix = encodeUtf8(`\x19Ethereum Signed Message:\n${message.length}`);
  return keccak_256(concatBytes(prefix, message));
}

export function signPersonalMessage(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  const hash = personalMessageHash(message);
  const sig = secp256k1.sign(hash, privateKey);
  const compact = sig.toCompactRawBytes();
  const v = (sig.recovery ?? 0) + 27;
  return concatBytes(compact, Uint8Array.of(v));
}

export function pathToString(components: number[]): string {
  if (components.length === 0) {
    return 'm';
  }
  const parts = components.map((value) => {
    const hardened = (value & 0x80000000) !== 0;
    const index = value & 0x7fffffff;
    return hardened ? `${index}'` : String(index);
  });
  return `m/${parts.join('/')}`;
}

function rlpHeader(length: number, offset: number): Uint8Array {
  if (length < 56) {
    return Uint8Array.of(offset + length);
  }
  const lenBytes: number[] = [];
  let n = length;
  while (n > 0) {
    lenBytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Uint8Array.from([offset + 55 + lenBytes.length, ...lenBytes]);
}

function rlpEncodeBytes(data: Uint8Array): Uint8Array {
  if (data.length === 1 && data[0] < 0x80) {
    return data;
  }
  return concatBytes(rlpHeader(data.length, 0x80), data);
}

function rlpEncodeList(items: Uint8Array[]): Uint8Array {
  const body = concatBytes(...items.map((item) => rlpEncodeBytes(item)));
  return concatBytes(rlpHeader(body.length, 0xc0), body);
}

function rlpInteger(value: number): Uint8Array {
  if (value === 0) {
    return new Uint8Array();
  }
  const bytes: number[] = [];
  let n = value;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Uint8Array.from(bytes);
}

export function signLegacyTx(
  privateKey: Uint8Array,
  tx: {
    nonce: Uint8Array;
    gasPrice: Uint8Array;
    gasLimit: Uint8Array;
    to: Uint8Array;
    value: Uint8Array;
    data: Uint8Array;
    chainId: number;
  },
): { v: number; r: Uint8Array; s: Uint8Array } {
  const unsigned = rlpEncodeList([
    tx.nonce,
    tx.gasPrice,
    tx.gasLimit,
    tx.to,
    tx.value,
    tx.data,
    rlpInteger(tx.chainId),
    new Uint8Array(),
    new Uint8Array(),
  ]);
  const sig = secp256k1.sign(keccak_256(unsigned), privateKey);
  const compact = sig.toCompactRawBytes();
  return {
    v: (sig.recovery ?? 0) + tx.chainId * 2 + 35,
    r: compact.subarray(0, 32),
    s: compact.subarray(32),
  };
}

export function signEip1559Tx(
  privateKey: Uint8Array,
  tx: {
    nonce: Uint8Array;
    maxPriorityFee: Uint8Array;
    maxFee: Uint8Array;
    gasLimit: Uint8Array;
    to: Uint8Array;
    value: Uint8Array;
    data: Uint8Array;
    chainId: number;
  },
): { v: number; r: Uint8Array; s: Uint8Array } {
  const items = [
    rlpEncodeBytes(rlpInteger(tx.chainId)),
    rlpEncodeBytes(tx.nonce),
    rlpEncodeBytes(tx.maxPriorityFee),
    rlpEncodeBytes(tx.maxFee),
    rlpEncodeBytes(tx.gasLimit),
    rlpEncodeBytes(tx.to),
    rlpEncodeBytes(tx.value),
    rlpEncodeBytes(tx.data),
    Uint8Array.of(0xc0),
  ];
  const body = concatBytes(...items);
  const encoded = concatBytes(rlpHeader(body.length, 0xc0), body);
  const sig = secp256k1.sign(keccak_256(concatBytes(Uint8Array.of(0x02), encoded)), privateKey);
  const compact = sig.toCompactRawBytes();
  return { v: sig.recovery ?? 0, r: compact.subarray(0, 32), s: compact.subarray(32) };
}

export function signTypedHash(privateKey: Uint8Array, domain: Uint8Array, structHash: Uint8Array): Uint8Array {
  const digest = keccak_256(concatBytes(Uint8Array.of(0x19, 0x01), domain, structHash));
  const sig = secp256k1.sign(digest, privateKey);
  return concatBytes(sig.toCompactRawBytes(), Uint8Array.of((sig.recovery ?? 0) + 27));
}
