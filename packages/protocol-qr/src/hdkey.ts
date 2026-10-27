import { bech32, bech32m, base58check as createBase58check } from '@scure/base';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { HDKey } from '@scure/bip32';
import { encodeUr } from './bytewords';
import { cborArray, cborBool, cborBytes, cborMap, cborTag, cborText, cborUint } from './cbor';
import { resolveQrFormat, type QrFormatId, type QrProfile, type QrUrKind } from './profiles';
import { encodeFountainParts } from './ur';
import { encodeBbqr, encodeBbqrParts } from './bbqr';

const CRYPTO_HDKEY = 303;
const CRYPTO_KEYPATH = 304;
const CRYPTO_COIN_INFO = 305;
const CRYPTO_OUTPUT = 307;
const SCRIPT_WPKH = 404;
const SCRIPT_PKH = 403;
const SCRIPT_SH = 400;
const SCRIPT_TR = 409;
const ETH_COIN_TYPE = 60;
const ETH_ACCOUNT = "m/44'/60'/0'";
const ETH_ADDRESS = "m/44'/60'/0'/0/0";
const ACCOUNT_STANDARD = 'account.standard';
const b58c = createBase58check(sha256);

export const BTC_NATIVE_ACCOUNT = "m/84'/0'/0'";
export const BTC_NATIVE_ADDRESS = "m/84'/0'/0'/0/0";
export const BTC_NESTED_ACCOUNT = "m/49'/0'/0'";
export const BTC_NESTED_ADDRESS = "m/49'/0'/0'/0/0";
export const BTC_LEGACY_ACCOUNT = "m/44'/0'/0'";
export const BTC_LEGACY_ADDRESS = "m/44'/0'/0'/0/0";
export const BTC_TAPROOT_ACCOUNT = "m/86'/0'/0'";
export const BTC_TAPROOT_ADDRESS = "m/86'/0'/0'/0/0";
export const BTC_TEST_ACCOUNT = "m/84'/1'/0'";
export const BTC_TEST_ADDRESS = "m/84'/1'/0'/0/0";

export type EthAirgapQr = {
  ur: string;
  parts?: string[];
  path: string;
  address: string;
  fingerprint: string;
  name: string;
  urKind: QrUrKind | 'eth-signature' | 'crypto-psbt' | 'sol-signature' | 'cosmos-signature' | 'btc-signature' | 'bbqr';
  format?: QrFormatId;
};

type BuiltHdkey = {
  cbor: Uint8Array;
  masterFp: number;
  path: string;
  address: string;
  fingerprint: string;
  name: string;
  format: QrFormatId;
};

type BtcScript = {
  format: Extract<QrFormatId, 'btc-hdkey' | 'btc-nested' | 'btc-legacy' | 'btc-taproot' | 'btc-test'>;
  account: string;
  address: string;
  purpose: number;
  coin: number;
  network: number;
  note: string;
  hrp: string;
};

const BTC_SCRIPTS: Record<BtcScript['format'], BtcScript> = {
  'btc-hdkey': {
    format: 'btc-hdkey',
    account: BTC_NATIVE_ACCOUNT,
    address: BTC_NATIVE_ADDRESS,
    purpose: 84,
    coin: 0,
    network: 0,
    note: 'account.nativeSegwit',
    hrp: 'bc',
  },
  'btc-nested': {
    format: 'btc-nested',
    account: BTC_NESTED_ACCOUNT,
    address: BTC_NESTED_ADDRESS,
    purpose: 49,
    coin: 0,
    network: 0,
    note: 'account.nestedSegwit',
    hrp: 'bc',
  },
  'btc-legacy': {
    format: 'btc-legacy',
    account: BTC_LEGACY_ACCOUNT,
    address: BTC_LEGACY_ADDRESS,
    purpose: 44,
    coin: 0,
    network: 0,
    note: 'account.standard',
    hrp: 'bc',
  },
  'btc-taproot': {
    format: 'btc-taproot',
    account: BTC_TAPROOT_ACCOUNT,
    address: BTC_TAPROOT_ADDRESS,
    purpose: 86,
    coin: 0,
    network: 0,
    note: 'account.taproot',
    hrp: 'bc',
  },
  'btc-test': {
    format: 'btc-test',
    account: BTC_TEST_ACCOUNT,
    address: BTC_TEST_ADDRESS,
    purpose: 84,
    coin: 1,
    network: 1,
    note: 'account.nativeSegwit',
    hrp: 'tb',
  },
};

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

export function masterFingerprint(publicKey: Uint8Array): number {
  const hash = hash160(publicKey);
  return ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0;
}

function checksumEth(address: string): string {
  const hex = address.replace(/^0x/i, '').toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(hex));
  let out = '0x';
  for (let index = 0; index < hex.length; index += 1) {
    const nibble = index % 2 === 0 ? hash[index >> 1] >> 4 : hash[index >> 1] & 0x0f;
    out += nibble >= 8 ? hex[index].toUpperCase() : hex[index];
  }
  return out;
}

function ethAddress(publicKeyUncompressed: Uint8Array): string {
  const hash = keccak_256(publicKeyUncompressed.subarray(1));
  let hex = '';
  for (const byte of hash.subarray(12)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return checksumEth(hex);
}

export function bitcoinP2wpkh(publicKey: Uint8Array, hrp = 'bc'): string {
  const words = bech32.toWords(hash160(publicKey));
  return bech32.encode(hrp, [0, ...words]);
}

export function bitcoinP2tr(outputXOnly: Uint8Array, hrp = 'bc'): string {
  return bech32m.encode(hrp, [1, ...bech32m.toWords(outputXOnly)]);
}

function taggedHash(tag: string, data: Uint8Array): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag));
  const out = new Uint8Array(tagHash.length * 2 + data.length);
  out.set(tagHash, 0);
  out.set(tagHash, tagHash.length);
  out.set(data, tagHash.length * 2);
  return sha256(out);
}

function taprootOutputXOnly(priv: Uint8Array): Uint8Array {
  const pub = secp256k1.getPublicKey(priv, true);
  const xOnly = pub.subarray(1);
  const n = secp256k1.CURVE.n;
  let d = 0n;
  for (const byte of priv) {
    d = (d << 8n) + BigInt(byte);
  }
  if (pub[0] === 0x03) {
    d = (n - d) % n;
  }
  let t = 0n;
  for (const byte of taggedHash('TapTweak', xOnly)) {
    t = (t << 8n) + BigInt(byte);
  }
  const tweaked = (d + t) % n;
  const hex = tweaked.toString(16).padStart(64, '0');
  const tweakedPriv = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    tweakedPriv[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return schnorr.getPublicKey(tweakedPriv);
}

export function bitcoinP2pkh(publicKey: Uint8Array, version = 0x00): string {
  return b58c.encode(Uint8Array.of(version, ...hash160(publicKey)));
}

export function bitcoinP2shP2wpkh(publicKey: Uint8Array, version = 0x05): string {
  const redeem = Uint8Array.of(0x00, 0x14, ...hash160(publicKey));
  return b58c.encode(Uint8Array.of(version, ...hash160(redeem)));
}

function taprootAddress(privateKey: Uint8Array, hrp = 'bc'): string {
  return bitcoinP2tr(taprootOutputXOnly(privateKey), hrp);
}

function pathComponent(index: number | undefined, hardened: boolean): Uint8Array[] {
  if (index === undefined) {
    return [cborArray([]), cborBool(hardened)];
  }
  return [cborUint(index), cborBool(hardened)];
}

function encodeKeypath(indexes: Array<{ index?: number; hardened: boolean }>, source: number, depth: number): Uint8Array {
  const components = indexes.flatMap((item) => pathComponent(item.index, item.hardened));
  return cborTag(
    CRYPTO_KEYPATH,
    cborMap([
      [1, cborArray(components)],
      [2, cborUint(source)],
      [3, cborUint(depth)],
    ]),
  );
}

function encodeCoinInfo(type: number, network?: number): Uint8Array {
  const entries: Array<[number, Uint8Array]> = [[1, cborUint(type)]];
  if (network != null) {
    entries.push([2, cborUint(network)]);
  }
  return cborTag(CRYPTO_COIN_INFO, cborMap(entries));
}

function wrapEncoded(built: BuiltHdkey, type: string, cbor: Uint8Array, urKind: EthAirgapQr['urKind']): EthAirgapQr {
  const ur = encodeUr(type, cbor);
  const parts = encodeFountainParts(type, cbor);
  return {
    ur,
    parts: parts.length > 1 ? parts : [ur],
    path: built.path,
    address: built.address,
    fingerprint: built.fingerprint,
    name: built.name,
    urKind,
    format: built.format,
  };
}

function buildEthHdkey(seed: Uint8Array, name: string): BuiltHdkey {
  const master = HDKey.fromMasterSeed(seed);
  if (!master.publicKey) {
    throw new Error('master public key missing');
  }
  const account = master.derive(ETH_ACCOUNT);
  if (!account.publicKey || !account.chainCode) {
    throw new Error('account key missing');
  }
  const addressNode = master.derive(ETH_ADDRESS);
  if (!addressNode.privateKey) {
    throw new Error('address key missing');
  }
  const masterFp = masterFingerprint(master.publicKey);
  const origin = encodeKeypath(
    [
      { index: 44, hardened: true },
      { index: ETH_COIN_TYPE, hardened: true },
      { index: 0, hardened: true },
    ],
    masterFp,
    3,
  );
  const children = encodeKeypath(
    [
      { index: 0, hardened: false },
      { hardened: false },
    ],
    masterFp,
    2,
  );
  const cbor = cborMap([
    [3, cborBytes(account.publicKey)],
    [4, cborBytes(account.chainCode)],
    [5, encodeCoinInfo(ETH_COIN_TYPE)],
    [6, origin],
    [7, children],
    [8, cborUint(account.parentFingerprint ?? 0)],
    [9, cborText(name)],
    [10, cborText(ACCOUNT_STANDARD)],
  ]);
  const uncompressed = secp256k1.getPublicKey(addressNode.privateKey, false);
  return {
    cbor,
    masterFp,
    path: ETH_ADDRESS,
    address: ethAddress(uncompressed),
    fingerprint: masterFp.toString(16).padStart(8, '0'),
    name,
    format: 'eth-hdkey',
  };
}

function btcAddress(script: BtcScript, addressNode: HDKey): string {
  if (!addressNode.publicKey) {
    throw new Error('address key missing');
  }
  if (script.format === 'btc-nested') {
    return bitcoinP2shP2wpkh(addressNode.publicKey);
  }
  if (script.format === 'btc-legacy') {
    return bitcoinP2pkh(addressNode.publicKey);
  }
  if (script.format === 'btc-taproot') {
    if (!addressNode.privateKey) {
      throw new Error('address key missing');
    }
    return taprootAddress(addressNode.privateKey, script.hrp);
  }
  return bitcoinP2wpkh(addressNode.publicKey, script.hrp);
}

function buildBtcHdkey(seed: Uint8Array, name: string, format: BtcScript['format'] = 'btc-hdkey'): BuiltHdkey {
  const script = BTC_SCRIPTS[format];
  const master = HDKey.fromMasterSeed(seed);
  if (!master.publicKey) {
    throw new Error('master public key missing');
  }
  const account = master.derive(script.account);
  if (!account.publicKey || !account.chainCode) {
    throw new Error('account key missing');
  }
  const addressNode = master.derive(script.address);
  const masterFp = masterFingerprint(master.publicKey);
  const origin = encodeKeypath(
    [
      { index: script.purpose, hardened: true },
      { index: script.coin, hardened: true },
      { index: 0, hardened: true },
    ],
    masterFp,
    3,
  );
  const children = encodeKeypath(
    [
      { index: 0, hardened: false },
      { hardened: false },
    ],
    masterFp,
    2,
  );
  const cbor = cborMap([
    [3, cborBytes(account.publicKey)],
    [4, cborBytes(account.chainCode)],
    [5, encodeCoinInfo(script.coin, script.network)],
    [6, origin],
    [7, children],
    [8, cborUint(account.parentFingerprint ?? 0)],
    [9, cborText(name)],
    [10, cborText(script.note)],
  ]);
  return {
    cbor,
    masterFp,
    path: script.address,
    address: btcAddress(script, addressNode),
    fingerprint: masterFp.toString(16).padStart(8, '0'),
    name,
    format: script.format,
  };
}

function wrapOutput(hdkey: Uint8Array, scriptTag: number, innerTag?: number): Uint8Array {
  const key = cborTag(CRYPTO_HDKEY, hdkey);
  const inner = innerTag != null ? cborTag(innerTag, key) : key;
  return cborTag(CRYPTO_OUTPUT, cborTag(scriptTag, inner));
}

function outputTagFor(format: QrFormatId): { script: number; inner?: number } {
  if (format === 'btc-nested') {
    return { script: SCRIPT_SH, inner: SCRIPT_WPKH };
  }
  if (format === 'btc-legacy') {
    return { script: SCRIPT_PKH };
  }
  if (format === 'btc-taproot') {
    return { script: SCRIPT_TR };
  }
  return { script: SCRIPT_WPKH };
}

export function encodeEthHdkeyUr(seed: Uint8Array, name = 'CWS'): EthAirgapQr {
  const built = buildEthHdkey(seed, name);
  return wrapEncoded(built, 'crypto-hdkey', built.cbor, 'crypto-hdkey');
}

export function encodeEthMultiAccountsUr(seed: Uint8Array, profile: QrProfile | string): EthAirgapQr {
  const name = typeof profile === 'string' ? profile : profile.name;
  const eth = buildEthHdkey(seed, name);
  const btc = buildBtcHdkey(seed, name, 'btc-hdkey');
  eth.format = 'eth-multi';
  const cbor = cborMap([
    [1, cborUint(eth.masterFp)],
    [2, cborArray([cborTag(CRYPTO_HDKEY, eth.cbor), cborTag(CRYPTO_HDKEY, btc.cbor)])],
    [3, cborText(name)],
  ]);
  return wrapEncoded(eth, 'crypto-multi-accounts', cbor, 'crypto-multi-accounts');
}

export function encodeBtcHdkeyUr(seed: Uint8Array, name = 'CWS', format: BtcScript['format'] = 'btc-hdkey'): EthAirgapQr {
  const built = buildBtcHdkey(seed, name, format);
  return wrapEncoded(built, 'crypto-hdkey', built.cbor, 'crypto-hdkey');
}

export function encodeCryptoAccountUr(seed: Uint8Array, name = 'CWS'): EthAirgapQr {
  const built = buildEthHdkey(seed, name);
  built.format = 'eth-account';
  const output = wrapOutput(built.cbor, SCRIPT_WPKH);
  const cbor = cborMap([
    [1, cborUint(built.masterFp)],
    [2, cborArray([output])],
  ]);
  return wrapEncoded(built, 'crypto-account', cbor, 'crypto-account');
}

export function encodeCryptoOutputUr(seed: Uint8Array, name = 'CWS', format: BtcScript['format'] = 'btc-hdkey'): EthAirgapQr {
  const built = buildBtcHdkey(seed, name, format);
  built.format = 'btc-output';
  const tags = outputTagFor(format);
  const cbor = wrapOutput(built.cbor, tags.script, tags.inner);
  return wrapEncoded(built, 'crypto-output', cbor, 'crypto-output');
}

export function encodeCryptoSeedUr(seed: Uint8Array, name = 'CWS'): EthAirgapQr {
  const master = HDKey.fromMasterSeed(seed);
  if (!master.publicKey) {
    throw new Error('master public key missing');
  }
  const masterFp = masterFingerprint(master.publicKey);
  const cbor = cborMap([
    [1, cborBytes(seed.subarray(0, 32))],
    [3, cborText(name)],
  ]);
  const built: BuiltHdkey = {
    cbor,
    masterFp,
    path: 'm',
    address: masterFp.toString(16).padStart(8, '0'),
    fingerprint: masterFp.toString(16).padStart(8, '0'),
    name,
    format: 'crypto-seed',
  };
  return wrapEncoded(built, 'crypto-seed', cbor, 'crypto-seed');
}

export function encodeBbqrXpub(seed: Uint8Array, name = 'CWS'): EthAirgapQr {
  const built = buildBtcHdkey(seed, name, 'btc-hdkey');
  const master = HDKey.fromMasterSeed(seed);
  const account = master.derive(BTC_NATIVE_ACCOUNT);
  const xpub = account.publicExtendedKey;
  const payload = `[{ "fingerprint": "${built.fingerprint}", "type": "p2wpkh", "xpub": "${xpub}", "name": "${name}" }]`;
  const encoded = encodeBbqr('U', new TextEncoder().encode(payload));
  return {
    ur: encoded.frames[0] ?? '',
    parts: encoded.frames,
    path: built.path,
    address: built.address,
    fingerprint: built.fingerprint,
    name,
    urKind: 'bbqr',
    format: 'bbqr-xpub',
  };
}

export function encodeQrAccount(
  seed: Uint8Array,
  profile: QrProfile,
  format: QrFormatId | QrUrKind = profile.id === 'coldcard' ? 'bbqr-xpub' : profile.defaultUr,
): EthAirgapQr {
  const resolved = resolveQrFormat(format);
  if (resolved === 'eth-multi') {
    return encodeEthMultiAccountsUr(seed, profile);
  }
  if (resolved === 'eth-account') {
    return encodeCryptoAccountUr(seed, profile.name);
  }
  if (resolved === 'crypto-seed') {
    return encodeCryptoSeedUr(seed, profile.name);
  }
  if (resolved === 'btc-output') {
    return encodeCryptoOutputUr(seed, profile.name, 'btc-hdkey');
  }
  if (resolved === 'bbqr-xpub') {
    return encodeBbqrXpub(seed, profile.name);
  }
  if (resolved === 'btc-hdkey' || resolved === 'btc-nested' || resolved === 'btc-legacy' || resolved === 'btc-taproot' || resolved === 'btc-test') {
    return encodeBtcHdkeyUr(seed, profile.name, resolved);
  }
  return encodeEthHdkeyUr(seed, profile.name);
}

export function encodeUrParts(type: string, cbor: Uint8Array, maxFragment = 200): string[] {
  const ur = encodeUr(type, cbor);
  const parts = encodeFountainParts(type, cbor, maxFragment);
  return parts.length > 1 ? parts : [ur];
}

export { encodeBbqrParts };
