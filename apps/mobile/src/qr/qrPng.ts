import { Buffer } from 'buffer';
import QRCode from 'qrcode';

/** ISO/IEC 18004 quiet zone: four modules of white on every side. */
export const QR_QUIET_MODULES = 4;
const DEFAULT_MODULE_PX = 8;

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function be32(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = concat([typeBytes, data]);
  return concat([be32(data.length), body, be32(crc32(body))]);
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  const max = 65535;
  for (let offset = 0; offset < data.length; offset += max) {
    const slice = data.subarray(offset, Math.min(offset + max, data.length));
    const last = offset + slice.length >= data.length ? 0x01 : 0x00;
    const len = slice.length;
    const nlen = len ^ 0xffff;
    blocks.push(
      Uint8Array.of(last, len & 0xff, (len >> 8) & 0xff, nlen & 0xff, (nlen >> 8) & 0xff),
      slice,
    );
  }
  if (data.length === 0) {
    blocks.push(Uint8Array.of(0x01, 0x00, 0x00, 0xff, 0xff));
  }
  const checksum = adler32(data);
  blocks.push(be32(checksum));
  return concat(blocks);
}

export type QrPng = {
  uri: string;
  width: number;
  modules: number;
  whitePixels: number;
  blackPixels: number;
};

/**
 * Encode a QR as an opaque PNG data URI.
 * `QRCode.toDataURL` needs a DOM canvas and blanks on React Native / iOS.
 * A View-per-module matrix can also paint as a black square on a dark sheet.
 */
export function encodeQrPng(
  value: string,
  options?: { modulePx?: number; quietModules?: number },
): QrPng {
  const modulePx = options?.modulePx ?? DEFAULT_MODULE_PX;
  const quiet = options?.quietModules ?? QR_QUIET_MODULES;
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const width = (n + quiet * 2) * modulePx;
  const raw = new Uint8Array(width * (width + 1));
  let whitePixels = 0;
  let blackPixels = 0;
  let offset = 0;
  for (let y = 0; y < width; y += 1) {
    raw[offset] = 0;
    offset += 1;
    const moduleY = Math.floor(y / modulePx) - quiet;
    for (let x = 0; x < width; x += 1) {
      const moduleX = Math.floor(x / modulePx) - quiet;
      const on =
        moduleX >= 0 && moduleY >= 0 && moduleX < n && moduleY < n
          ? Boolean(qr.modules.get(moduleX, moduleY))
          : false;
      const pixel = on ? 0x00 : 0xff;
      raw[offset] = pixel;
      offset += 1;
      if (on) {
        blackPixels += 1;
      } else {
        whitePixels += 1;
      }
    }
  }
  const ihdr = concat([be32(width), be32(width), Uint8Array.of(8, 0, 0, 0, 0)]);
  const png = concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStore(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
  return {
    uri: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    width,
    modules: n,
    whitePixels,
    blackPixels,
  };
}

export function qrPngDataUri(value: string): string {
  return encodeQrPng(value).uri;
}
