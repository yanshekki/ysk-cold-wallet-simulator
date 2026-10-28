import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it } from 'vitest';
import { encodeQrAccount, qrProfile } from '@cws/protocol-qr';
import { encodeQrPng, QR_QUIET_MODULES } from './qrPng';

const FOUNDATION = 'test test test test test test test test test test test junk';
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(uri: string): Uint8Array {
  const b64 = uri.replace(/^data:image\/png;base64,/, '');
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

describe('encodeQrPng', () => {
  it('renders an opaque OneKey UR with a 4-module white quiet zone', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const encoded = encodeQrAccount(seed, qrProfile('onekey'));
    const png = encodeQrPng(encoded.ur, { modulePx: 4, quietModules: QR_QUIET_MODULES });
    expect(png.uri.startsWith('data:image/png;base64,')).toBe(true);
    expect(png.modules).toBeGreaterThan(20);
    expect(png.width).toBe((png.modules + QR_QUIET_MODULES * 2) * 4);
    expect(png.blackPixels).toBeGreaterThan(0);
    expect(png.whitePixels).toBeGreaterThan(png.blackPixels);

    const bytes = pngBytes(png.uri);
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIG);
    const ihdrWidth =
      (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
    expect(ihdrWidth).toBe(png.width);
  });

  it('is not an all-black bitmap', () => {
    const png = encodeQrPng('ur:crypto-hdkey/test', { modulePx: 2, quietModules: 4 });
    const total = png.whitePixels + png.blackPixels;
    expect(png.whitePixels / total).toBeGreaterThan(0.4);
  });
});
