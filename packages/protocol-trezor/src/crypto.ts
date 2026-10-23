import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, concatBytes, encodeUtf8 } from './bytes';

export function mnemonicFromEntropy(entropy: Uint8Array): string {
  return entropyToMnemonic(entropy, wordlist);
}

export function derivePrivateKey(
  entropy: Uint8Array,
  path: string,
  passphrase?: string,
): Uint8Array {
  const mnemonic = mnemonicFromEntropy(entropy);
  const seed = mnemonicToSeedSync(mnemonic, passphrase ?? '');
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
