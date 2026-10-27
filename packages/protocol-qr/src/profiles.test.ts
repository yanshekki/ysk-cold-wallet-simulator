import { describe, expect, it } from 'vitest';
import {
  defaultQrFormat,
  groupQrFormats,
  qrFormatDetail,
  qrFormatPath,
  qrFormatsFor,
  qrProfile,
} from './profiles';

describe('groupQrFormats', () => {
  it('groups Keystone formats into eth / btc / sensitive without drops', () => {
    const formats = qrFormatsFor(qrProfile('keystone'));
    expect(formats).toHaveLength(10);
    const groups = groupQrFormats(formats);
    expect(groups.map((group) => group.id)).toEqual(['eth', 'btc', 'sensitive']);
    expect(groups.flatMap((group) => group.formats)).toEqual(formats);
    expect(groups[0]?.formats).toEqual(['eth-hdkey', 'eth-multi', 'eth-account']);
    expect(groups.at(-1)?.formats).toEqual(['crypto-seed']);
  });

  it('groups NGRAVE ZERO without eth extras or seed', () => {
    const formats = qrFormatsFor(qrProfile('ngrave-zero'));
    expect(formats).toHaveLength(7);
    const groups = groupQrFormats(formats);
    expect(groups.map((group) => group.id)).toEqual(['eth', 'btc']);
    expect(groups.flatMap((group) => group.formats)).toEqual(formats);
  });

  it('groups Coldcard as bbqr + btc', () => {
    const formats = qrFormatsFor(qrProfile('coldcard'));
    expect(formats).toHaveLength(5);
    const groups = groupQrFormats(formats);
    expect(groups.map((group) => group.id)).toEqual(['btc', 'bbqr']);
    // bbqr stays its own section; relative order within each group preserved
    expect(groups.find((group) => group.id === 'bbqr')?.formats).toEqual(['bbqr-xpub']);
    expect(groups.find((group) => group.id === 'btc')?.formats).toEqual([
      'btc-hdkey',
      'btc-nested',
      'btc-legacy',
      'btc-taproot',
    ]);
  });
});

describe('qrFormatPath / detail / default', () => {
  it('exposes the encode path used on the QR', () => {
    expect(qrFormatPath('eth-hdkey')).toBe("m/44'/60'/0'/0/0");
    expect(qrFormatPath('btc-hdkey')).toBe("m/84'/0'/0'/0/0");
    expect(qrFormatPath('crypto-seed')).toBe('m');
    expect(qrFormatDetail('bbqr-xpub')).toContain('BBQr');
    expect(qrFormatDetail('bbqr-xpub')).toContain("m/84'/0'/0'/0/0");
  });

  it('defaults Coldcard to bbqr and others to eth-hdkey', () => {
    expect(defaultQrFormat(qrProfile('coldcard'))).toBe('bbqr-xpub');
    expect(defaultQrFormat(qrProfile('keystone'))).toBe('eth-hdkey');
  });
});
