import { CLA_FRAMEWORK, INS_CONTINUE, SW_DENY, SW_INTERRUPTED, SW_OK } from '@cws/protocol-ledger';

export { CLA_FRAMEWORK, INS_CONTINUE, SW_DENY, SW_INTERRUPTED, SW_OK };

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function encodeAscii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

export function decodeAscii(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

export function encodePath(components: number[]): Uint8Array {
  const out = new Uint8Array(1 + components.length * 4);
  out[0] = components.length;
  for (let i = 0; i < components.length; i++) {
    const value = components[i] >>> 0;
    const offset = 1 + i * 4;
    out[offset] = (value >>> 24) & 0xff;
    out[offset + 1] = (value >>> 16) & 0xff;
    out[offset + 2] = (value >>> 8) & 0xff;
    out[offset + 3] = value & 0xff;
  }
  return out;
}

/** NEAR Ledger path is five u32s with no length prefix. */
export function encodeNearPath(components: number[]): Uint8Array {
  const out = new Uint8Array(components.length * 4);
  for (let i = 0; i < components.length; i++) {
    const value = components[i] >>> 0;
    const offset = i * 4;
    out[offset] = (value >>> 24) & 0xff;
    out[offset + 1] = (value >>> 16) & 0xff;
    out[offset + 2] = (value >>> 8) & 0xff;
    out[offset + 3] = value & 0xff;
  }
  return out;
}

export function encodeApdu(
  cla: number,
  ins: number,
  p1: number,
  p2: number,
  data: Uint8Array = new Uint8Array(),
): Uint8Array {
  if (data.length > 255) {
    throw new Error(`APDU data ${data.length} exceeds Lc`);
  }
  return concatBytes(Uint8Array.of(cla, ins, p1, p2, data.length), data);
}

export function statusWord(payload: Uint8Array): number {
  if (payload.length < 2) {
    throw new Error('APDU response too short');
  }
  return (payload[payload.length - 2] << 8) | payload[payload.length - 1];
}

export function responseBody(payload: Uint8Array): Uint8Array {
  return payload.subarray(0, payload.length - 2);
}

export class StatusWordError extends Error {
  readonly sw: number;

  constructor(sw: number, note?: string) {
    const hex = sw.toString(16).padStart(4, '0');
    super(sw === SW_DENY ? `rejected on device (${hex})` : `${note ?? 'APDU failed'} (${hex})`);
    this.sw = sw;
  }
}

export function assertOk(payload: Uint8Array, note?: string): Uint8Array {
  const sw = statusWord(payload);
  if (sw !== SW_OK) {
    throw new StatusWordError(sw, note);
  }
  return responseBody(payload);
}

export function hardened(index: number): number {
  return (index | 0x80000000) >>> 0;
}

export const PATH_ETH = [hardened(44), hardened(60), hardened(0), 0, 0];
export const PATH_BTC = [hardened(44), hardened(0), hardened(0), 0, 0];
export const PATH_LTC = [hardened(44), hardened(2), hardened(0), 0, 0];
export const PATH_DOGE = [hardened(44), hardened(3), hardened(0), 0, 0];
export const PATH_SOL = [hardened(44), hardened(501), hardened(0)];
export const PATH_NEAR = [hardened(44), hardened(397), hardened(0), hardened(0), hardened(1)];
export const PATH_AVAX = [hardened(44), hardened(9000), hardened(0), 0, 0];
export const PATH_ADA = [hardened(1852), hardened(1815), hardened(0), 0, 0];
export const PATH_XRP = [hardened(44), hardened(144), hardened(0), 0, 0];
export const PATH_TRX = [hardened(44), hardened(195), hardened(0), 0, 0];
export const PATH_ATOM = [hardened(44), hardened(118), hardened(0), 0, 0];
export const PATH_TON = [hardened(44), hardened(607), hardened(0)];
export const PATH_APT = [hardened(44), hardened(637), hardened(0), hardened(0), hardened(0)];
export const PATH_SUI = [hardened(44), hardened(784), hardened(0), hardened(0), hardened(0)];
export const PATH_DOT = [hardened(44), hardened(354), hardened(0), hardened(0), hardened(0)];
export const PATH_XLM = [hardened(44), hardened(148), hardened(0)];
export const PATH_XTZ = [hardened(44), hardened(1729), hardened(0)];
export const PATH_BNB = [hardened(44), hardened(714), hardened(0), 0, 0];
export const PATH_TAPROOT = [hardened(86), hardened(0), hardened(0), 0, 0];

export function decodePubAndAddress(body: Uint8Array): { pub: string; address?: string } {
  if (body.length === 32) {
    return { pub: bytesToHex(body) };
  }
  if (body.length === 0) {
    return { pub: '' };
  }
  const pubLen = body[0];
  if (pubLen === 0 || 1 + pubLen > body.length) {
    return { pub: bytesToHex(body) };
  }
  const pub = bytesToHex(body.subarray(1, 1 + pubLen));
  let offset = 1 + pubLen;
  if (offset >= body.length) {
    return { pub };
  }
  const addrLen = body[offset];
  offset += 1;
  if (addrLen > 0 && offset + addrLen <= body.length) {
    return { pub, address: decodeAscii(body.subarray(offset, offset + addrLen)) };
  }
  return { pub };
}
