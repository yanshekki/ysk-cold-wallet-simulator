import { inflateSync } from 'node:zlib';
import QRCode from 'qrcode';
import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it } from 'vitest';
import { encodeQrAccount, qrProfile } from '@cws/protocol-qr';
import { encodeQrPng, payloadForQr, QR_QUIET_MODULES } from './qrPng';

const FOUNDATION = 'test test test test test test test test test test test junk';
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(uri: string): Uint8Array {
  const b64 = uri.replace(/^data:image\/png;base64,/, '');
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

function readBe32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function grayRows(uri: string, width: number): Uint8Array[] {
  const bytes = pngBytes(uri);
  const parts: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const len = readBe32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === 'IDAT') {
      parts.push(Buffer.from(data));
    }
    if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width + 1;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < width; y += 1) {
    expect(raw[y * stride]).toBe(0);
    rows.push(raw.subarray(y * stride + 1, y * stride + 1 + width));
  }
  return rows;
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

  it('paints BitMatrix.get(row, col), not the transposed get(col, row)', () => {
    const value = payloadForQr('ur:crypto-hdkey/example-payload-for-layout');
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const png = encodeQrPng(value, { modulePx: 1, quietModules: 0 });
    const rows = grayRows(png.uri, png.width);
    expect(rows).toHaveLength(qr.modules.size);
    let sawAsymmetry = false;
    for (let row = 0; row < qr.modules.size; row += 1) {
      expect(rows[row]).toHaveLength(qr.modules.size);
      for (let col = 0; col < qr.modules.size; col += 1) {
        const dark = Boolean(qr.modules.get(row, col));
        expect(rows[row]![col]).toBe(dark ? 0 : 255);
        if (qr.modules.get(row, col) !== qr.modules.get(col, row)) {
          sawAsymmetry = true;
        }
      }
    }
    expect(sawAsymmetry).toBe(true);
  });

  it('uppercases OneKey UR so the symbol is smaller than lowercase byte-mode', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const encoded = encodeQrAccount(seed, qrProfile('onekey'));
    const lower = QRCode.create(encoded.ur, { errorCorrectionLevel: 'M' });
    const png = encodeQrPng(encoded.ur);
    expect(payloadForQr(encoded.ur)).toBe(encoded.ur.toUpperCase());
    expect(png.modules).toBe(QRCode.create(payloadForQr(encoded.ur), { errorCorrectionLevel: 'M' }).modules.size);
    expect(png.modules).toBeLessThan(lower.modules.size);
  });
});
