import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { HDKey } from '@scure/bip32';
import { concatBytes, encodeAscii } from '../bytes';
import { bitcoinAddressFor, type BtcCoin } from './bitcoin';
import { MerkleTree, elementHash, readVarint, writeVarint } from './merkle';

export const DEFAULT_TEMPLATES = [
  'wpkh(@0/**)',
  'sh(wpkh(@0/**))',
  'tr(@0/**)',
  'pkh(@0/**)',
  // OKX's Bitcoin client puts the wildcard on the key (`xpub…/**`) and sends
  // the template without it: `pkh(@0)`, `wpkh(@0)`, `sh(wpkh(@0))`, `tr(@0)`.
  'wpkh(@0)',
  'sh(wpkh(@0))',
  'tr(@0)',
  'pkh(@0)',
] as const;

export type WalletPolicy = {
  version: 1 | 2;
  name: string;
  descriptorTemplate: string;
  keysInfo: string[];
};

export type ParsedWalletHeader = {
  version: 1 | 2;
  name: string;
  descriptorTemplate?: string;
  descriptorTemplateHash?: Uint8Array;
  nKeys: number;
  keysRoot: Uint8Array;
  serialize: Uint8Array;
};

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

export function isDefaultTemplate(template: string): boolean {
  return (DEFAULT_TEMPLATES as readonly string[]).includes(template);
}

export function serializeWalletPolicy(policy: WalletPolicy): Uint8Array {
  const name = utf8.encode(policy.name);
  const template = utf8.encode(policy.descriptorTemplate);
  const keysRoot = new MerkleTree(policy.keysInfo.map((info) => elementHash(utf8.encode(info)))).root;
  const templateBody =
    policy.version === 1 ? template : sha256(template);
  return concatBytes(
    Uint8Array.of(policy.version),
    Uint8Array.of(name.length),
    name,
    writeVarint(template.length),
    templateBody,
    writeVarint(policy.keysInfo.length),
    keysRoot,
  );
}

export function walletIdOf(serialize: Uint8Array): Uint8Array {
  return sha256(serialize);
}

export function walletHmac(seed: Uint8Array, serialize: Uint8Array): Uint8Array {
  const key = hmac(sha256, seed, encodeAscii('CWS/ledger-wallet-hmac'));
  return hmac(sha256, key, serialize);
}

export function parseWalletHeader(bytes: Uint8Array): ParsedWalletHeader {
  if (bytes.length < 3) {
    throw new Error('truncated wallet policy');
  }
  const version = bytes[0];
  if (version !== 1 && version !== 2) {
    throw new Error('unsupported wallet policy');
  }
  const nameLen = bytes[1]!;
  let offset = 2;
  const name = utf8d.decode(bytes.subarray(offset, offset + nameLen));
  offset += nameLen;
  const templateLen = readVarint(bytes, offset);
  offset = templateLen.next;
  let descriptorTemplate: string | undefined;
  let descriptorTemplateHash: Uint8Array | undefined;
  if (version === 1) {
    descriptorTemplate = utf8d.decode(bytes.subarray(offset, offset + templateLen.value));
    offset += templateLen.value;
  } else {
    descriptorTemplateHash = bytes.subarray(offset, offset + 32);
    offset += 32;
  }
  const nKeys = readVarint(bytes, offset);
  offset = nKeys.next;
  const keysRoot = bytes.subarray(offset, offset + 32);
  if (keysRoot.length !== 32) {
    throw new Error('truncated keys root');
  }
  return {
    version,
    name,
    descriptorTemplate,
    descriptorTemplateHash,
    nKeys: nKeys.value,
    keysRoot,
    serialize: bytes,
  };
}

export function parseKeyInfo(info: string): { origin?: string; xpub: string } {
  if (info.startsWith('[')) {
    const close = info.indexOf(']');
    if (close > 0) {
      return { origin: info.slice(1, close), xpub: info.slice(close + 1) };
    }
  }
  return { xpub: info };
}

function p2ForTemplate(template: string): number {
  if (template.startsWith('tr(')) {
    return 0x04;
  }
  if (template.startsWith('sh(wpkh(')) {
    return 0x01;
  }
  if (template.startsWith('wpkh(')) {
    return 0x02;
  }
  return 0x00;
}

function accountPathFromOrigin(origin: string | undefined, coin: BtcCoin): string {
  if (!origin) {
    return coin === 'bitcoin-test' ? "m/84'/1'/0'" : "m/84'/0'/0'";
  }
  const slash = origin.indexOf('/');
  const path = slash >= 0 ? origin.slice(slash + 1) : origin;
  return path.startsWith('m/') ? path : `m/${path}`;
}

export function addressFromPolicy(
  seed: Uint8Array,
  template: string,
  keysInfo: string[],
  change: number,
  addressIndex: number,
  coin: BtcCoin = 'bitcoin',
): { address: string; path: string } {
  if (!isDefaultTemplate(template) || !keysInfo[0]) {
    throw new Error('unsupported wallet policy');
  }
  const parsed = parseKeyInfo(keysInfo[0]);
  const accountPath = accountPathFromOrigin(parsed.origin, coin);
  const path = `${accountPath}/${change}/${addressIndex}`;
  const node = HDKey.fromMasterSeed(seed).derive(path);
  if (!node.publicKey || !node.privateKey) {
    throw new Error('unable to derive wallet address');
  }
  return {
    address: bitcoinAddressFor(
      {
        publicKey: node.publicKey,
        privateKey: node.privateKey,
        chainCode: node.chainCode ?? new Uint8Array(32),
      },
      path,
      p2ForTemplate(template),
      coin,
    ),
    path,
  };
}

export function defaultKeyInfo(seed: Uint8Array, accountPath = "m/84'/0'/0'"): string {
  const master = HDKey.fromMasterSeed(seed);
  const account = master.derive(accountPath);
  const fingerprint = (master.fingerprint >>> 0).toString(16).padStart(8, '0');
  const origin = accountPath.startsWith('m/') ? accountPath.slice(2) : accountPath;
  return `[${fingerprint}/${origin}]${account.publicExtendedKey}`;
}

export function defaultWalletPolicy(seed: Uint8Array, template = 'wpkh(@0/**)', accountPath = "m/84'/0'/0'"): WalletPolicy {
  return {
    version: 2,
    name: '',
    descriptorTemplate: template,
    keysInfo: [defaultKeyInfo(seed, accountPath)],
  };
}

