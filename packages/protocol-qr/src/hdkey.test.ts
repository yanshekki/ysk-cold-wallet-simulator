import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it } from 'vitest';
import { URDecoder } from '@ngraveio/bc-ur';
import { asArray, asMap, asTag, decodeCbor } from './cbor';
import { BTC_NATIVE_ADDRESS, encodeBtcHdkeyUr, encodeEthHdkeyUr, encodeEthMultiAccountsUr, encodeQrAccount } from './hdkey';
import { QR_PROFILES, qrFormatsFor, qrProfile } from './profiles';

const FOUNDATION = 'test test test test test test test test test test test junk';
const EXPECTED = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function decodeUr(ur: string) {
  const decoder = new URDecoder();
  decoder.receivePart(ur);
  expect(decoder.isComplete()).toBe(true);
  return decoder.resultUR();
}

describe('encodeEthHdkeyUr', () => {
  it('encodes a BC-UR crypto-hdkey Rabby/Keystone can decode', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const encoded = encodeEthHdkeyUr(seed, 'CWS');
    expect(encoded.address).toBe(EXPECTED);
    expect(encoded.path).toBe("m/44'/60'/0'/0/0");
    expect(encoded.name).toBe('CWS');
    expect(encoded.urKind).toBe('crypto-hdkey');
    expect(encoded.ur.startsWith('ur:crypto-hdkey/')).toBe(true);

    const ur = decodeUr(encoded.ur);
    expect(ur.type).toBe('crypto-hdkey');
    const map = asMap(decodeCbor(ur.cbor));
    expect(map.get(9)).toBe('CWS');
    expect(map.get(10)).toBe('account.standard');
    const coin = asTag(map.get(5)!);
    expect(coin.tag).toBe(305);
    expect(asMap(coin.value).get(1)).toBe(60);
    const origin = asTag(map.get(6)!);
    expect(origin.tag).toBe(304);
    const originMap = asMap(origin.value);
    expect(typeof originMap.get(2)).toBe('number');
    const children = asTag(map.get(7)!);
    expect(children.tag).toBe(304);
    const childMap = asMap(children.value);
    expect(childMap.has(2)).toBe(false);
    expect(childMap.has(3)).toBe(false);
    expect(asArray(childMap.get(1)!)).toHaveLength(4);
  });

  it('exports a single-frame OneKey crypto-hdkey Rabby can finish in one scan', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const encoded = encodeQrAccount(seed, qrProfile('onekey'));
    expect(encoded.name).toBe('OneKey');
    expect(encoded.address).toBe(EXPECTED);
    expect(encoded.urKind).toBe('crypto-hdkey');
    expect(encoded.parts).toEqual([encoded.ur]);
    expect(encoded.ur.startsWith('ur:crypto-hdkey/')).toBe(true);
    expect(/\/\d+-\d+\//.test(encoded.ur)).toBe(false);

    const ur = decodeUr(encoded.ur);
    expect(ur.type).toBe('crypto-hdkey');
    const map = asMap(decodeCbor(ur.cbor));
    expect(map.get(9)).toBe('OneKey');
    expect(map.get(10)).toBe('account.standard');
    const coin = asTag(map.get(5)!);
    expect(asMap(coin.value).get(1)).toBe(60);
  });

  it('decodes OneKey crypto-hdkey when the QR payload is uppercase alphanumeric', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const encoded = encodeQrAccount(seed, qrProfile('onekey'));
    expect(encoded.name).toBe('OneKey');
    const ur = decodeUr(encoded.ur.toUpperCase());
    expect(ur.type).toBe('crypto-hdkey');
    expect(asMap(decodeCbor(ur.cbor)).get(9)).toBe('OneKey');
  });
});

describe('encodeQrAccount', () => {
  it('uses the profile name on every catalog brand', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    expect(QR_PROFILES).toHaveLength(11);
    for (const profile of QR_PROFILES.filter((item) => item.id !== 'coldcard')) {
      const encoded = encodeQrAccount(seed, profile);
      expect(encoded.address).toBe(EXPECTED);
      expect(encoded.name).toBe(profile.name);
      expect(encoded.urKind).toBe('crypto-hdkey');
      const ur = decodeUr(encoded.ur);
      expect(ur.type).toBe('crypto-hdkey');
      expect(asMap(decodeCbor(ur.cbor)).get(9)).toBe(profile.name);
    }
  });

  it('encodes crypto-multi-accounts with the ETH hdkey and device name', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const profile = qrProfile('keystone');
    const encoded = encodeQrAccount(seed, profile, 'crypto-multi-accounts');
    expect(encoded.address).toBe(EXPECTED);
    expect(encoded.urKind).toBe('crypto-multi-accounts');
    expect(encoded.ur.startsWith('ur:crypto-multi-accounts/')).toBe(true);

    const ur = decodeUr(encoded.ur);
    expect(ur.type).toBe('crypto-multi-accounts');
    const map = asMap(decodeCbor(ur.cbor));
    expect(map.get(3)).toBe('Keystone');
    const keys = asArray(map.get(2)!);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const hdkey = asTag(keys[0]!);
    expect(hdkey.tag).toBe(303);
    const hdkeyMap = asMap(hdkey.value);
    expect(hdkeyMap.get(9)).toBe('Keystone');
    expect(hdkeyMap.get(10)).toBe('account.standard');
    const coin = asTag(hdkeyMap.get(5)!);
    expect(asMap(coin.value).get(1)).toBe(60);
    expect(encodeEthMultiAccountsUr(seed, profile).ur).toBe(encoded.ur);
  });

  it('encodes Bitcoin native SegWit crypto-hdkey', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const profile = qrProfile('keystone');
    const encoded = encodeQrAccount(seed, profile, 'btc-hdkey');
    expect(encoded.format).toBe('btc-hdkey');
    expect(encoded.urKind).toBe('crypto-hdkey');
    expect(encoded.path).toBe(BTC_NATIVE_ADDRESS);
    expect(encoded.address.startsWith('bc1q')).toBe(true);
    expect(encoded.ur.startsWith('ur:crypto-hdkey/')).toBe(true);
    expect(qrFormatsFor(profile)).toContain('btc-hdkey');
    expect(qrFormatsFor(profile)).toContain('btc-taproot');
    expect(qrFormatsFor(profile)).toContain('eth-multi');

    const ur = decodeUr(encoded.ur);
    const map = asMap(decodeCbor(ur.cbor));
    expect(map.get(10)).toBe('account.nativeSegwit');
    const coin = asTag(map.get(5)!);
    expect(coin.tag).toBe(305);
    expect(asMap(coin.value).get(1)).toBe(0);
    expect(encodeBtcHdkeyUr(seed, profile.name).address).toBe(encoded.address);
  });

  it('encodes nested, legacy, taproot, testnet, account, output, seed, and Coldcard BBQR', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const nested = encodeQrAccount(seed, qrProfile('keystone'), 'btc-nested');
    expect(nested.format).toBe('btc-nested');
    expect(nested.address.startsWith('3') || nested.address.startsWith('2')).toBe(true);
    const legacy = encodeQrAccount(seed, qrProfile('keystone'), 'btc-legacy');
    expect(legacy.address.startsWith('1') || legacy.address.startsWith('m') || legacy.address.startsWith('n')).toBe(true);
    const tap = encodeQrAccount(seed, qrProfile('keystone'), 'btc-taproot');
    expect(tap.address.startsWith('bc1p')).toBe(true);
    const testnet = encodeQrAccount(seed, qrProfile('keystone'), 'btc-test');
    expect(testnet.address.startsWith('tb1')).toBe(true);
    const account = encodeQrAccount(seed, qrProfile('keystone'), 'eth-account');
    expect(account.urKind).toBe('crypto-account');
    const output = encodeQrAccount(seed, qrProfile('keystone'), 'btc-output');
    expect(output.urKind).toBe('crypto-output');
    const cryptoSeed = encodeQrAccount(seed, qrProfile('keystone'), 'crypto-seed');
    expect(cryptoSeed.urKind).toBe('crypto-seed');
    const coldcard = encodeQrAccount(seed, qrProfile('coldcard'));
    expect(coldcard.format).toBe('bbqr-xpub');
    expect(coldcard.ur.startsWith('B$')).toBe(true);
  });
});
