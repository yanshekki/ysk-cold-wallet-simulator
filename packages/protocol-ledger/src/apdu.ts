export const SW_OK = 0x9000;
export const SW_WRONG_LENGTH = 0x6700;
export const SW_DENY = 0x6985;
export const SW_WRONG_P1P2 = 0x6a86;
export const SW_INS_NOT_SUPPORTED = 0x6d00;
export const SW_CLA_NOT_SUPPORTED = 0x6e00;
/** Ledger app-near `AppSW::TxParsingFail`. */
export const SW_TX_PARSING_FAIL = 0xb005;
export const SW_INTERRUPTED = 0xe000;

export type Apdu = {
  cla: number;
  ins: number;
  p1: number;
  p2: number;
  data: Uint8Array;
};

export function parseApdu(bytes: Uint8Array): Apdu {
  if (bytes.length < 4) {
    throw new Error('APDU too short');
  }
  const cla = bytes[0];
  const ins = bytes[1];
  const p1 = bytes[2];
  const p2 = bytes[3];
  if (bytes.length === 4) {
    return { cla, ins, p1, p2, data: new Uint8Array() };
  }
  const lc = bytes[4];
  if (bytes.length === 5) {
    return { cla, ins, p1, p2, data: new Uint8Array() };
  }
  if (5 + lc > bytes.length) {
    throw new Error('APDU length byte exceeds buffer');
  }
  return { cla, ins, p1, p2, data: bytes.slice(5, 5 + lc) };
}

export function encodeSw(sw: number): Uint8Array {
  return Uint8Array.of((sw >> 8) & 0xff, sw & 0xff);
}

export function encodeResponse(data: Uint8Array, sw = SW_OK): Uint8Array {
  const out = new Uint8Array(data.length + 2);
  out.set(data);
  out.set(encodeSw(sw), data.length);
  return out;
}

export function pathToString(components: number[]): string {
  if (components.length === 0) {
    return 'm';
  }
  const parts = components.map((value) => {
    const hardened = (value & 0x80000000) !== 0;
    const index = value & 0x7fffffff;
    return hardened ? `${index}'` : `${String(index)}`;
  });
  return `m/${parts.join('/')}`;
}

export function parseBip32Path(data: Uint8Array): { path: string; rest: Uint8Array } {
  if (data.length < 1) {
    throw new Error('missing BIP32 path');
  }
  const count = data[0];
  if (count < 1) {
    throw new Error('empty BIP32 path');
  }
  const needed = 1 + count * 4;
  if (data.length < needed) {
    throw new Error('truncated BIP32 path');
  }
  const components: number[] = [];
  for (let i = 0; i < count; i++) {
    const offset = 1 + i * 4;
    components.push(
      ((data[offset] << 24) |
        (data[offset + 1] << 16) |
        (data[offset + 2] << 8) |
        data[offset + 3]) >>>
        0,
    );
  }
  return { path: pathToString(components), rest: data.slice(needed) };
}

/** Mysten / Ledger Sui `buildBip32KeyPayload` writes each component as little-endian u32. */
export function parseBip32PathLE(data: Uint8Array): { path: string; rest: Uint8Array } {
  if (data.length < 1) {
    throw new Error('missing BIP32 path');
  }
  const count = data[0];
  if (count < 1) {
    throw new Error('empty BIP32 path');
  }
  const needed = 1 + count * 4;
  if (data.length < needed) {
    throw new Error('truncated BIP32 path');
  }
  const components: number[] = [];
  for (let i = 0; i < count; i++) {
    const offset = 1 + i * 4;
    components.push(
      (data[offset] |
        (data[offset + 1] << 8) |
        (data[offset + 2] << 16) |
        (data[offset + 3] << 24)) >>>
        0,
    );
  }
  return { path: pathToString(components), rest: data.slice(needed) };
}
