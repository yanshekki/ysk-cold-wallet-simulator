import type { LogChannel } from '@cws/contracts';
import { ledgerCatalog } from '@cws/contracts';

const SW_NAMES: Record<string, string> = {
  '9000': 'OK',
  '6700': 'WRONG_LENGTH',
  '6985': 'DENY',
  '6a86': 'WRONG_P1P2',
  '6d00': 'INS_NOT_SUPPORTED',
  '6e00': 'CLA_NOT_SUPPORTED',
};

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function parseHex(clean: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const value = Number.parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isFinite(value)) {
      break;
    }
    bytes.push(value);
  }
  return bytes;
}

function swNote(sw: string): { note: string; channel: LogChannel } {
  const name = SW_NAMES[sw];
  return { note: name ? `SW ${sw} ${name}` : `SW ${sw}`, channel: sw === '9000' ? 'apdu' : 'error' };
}

/**
 * A 64-byte signature plus 9000 is four 20-byte notifies. Only the last one
 * ends in the status word; earlier tails are signature bytes.
 */
function describeOutgoingFrame(bytes: number[]): { note: string; channel: LogChannel } | null {
  if (bytes[0] !== 0x05 || bytes.length < 5) {
    return null;
  }
  const seq = ((bytes[1] ?? 0) << 8) | (bytes[2] ?? 0);
  if (seq === 0) {
    const length = ((bytes[3] ?? 0) << 8) | (bytes[4] ?? 0);
    const payload = bytes.slice(5);
    if (length >= 2 && payload.length >= length) {
      const swIndex = 5 + length - 2;
      return swNote(hexByte(bytes[swIndex] ?? 0) + hexByte(bytes[swIndex + 1] ?? 0));
    }
    if (length > payload.length) {
      return { note: `APDU response ${length} bytes`, channel: 'apdu' };
    }
    return null;
  }
  const tail = hexByte(bytes[bytes.length - 2] ?? 0) + hexByte(bytes[bytes.length - 1] ?? 0);
  if (SW_NAMES[tail]) {
    return swNote(tail);
  }
  return { note: `APDU response chunk ${seq}`, channel: 'apdu' };
}

export function describeBlePayload(hex: string, direction: 'in' | 'out'): { note: string; channel: LogChannel } {
  const clean = hex.replace(/\s+/g, '').toLowerCase();
  if (!clean) {
    return { note: direction === 'out' ? 'notify empty' : 'write empty', channel: 'ble' };
  }
  const bytes = parseHex(clean);
  const tag = bytes[0];
  const seq = ((bytes[1] ?? 0) << 8) | (bytes[2] ?? 0);
  if (direction === 'in' && tag === 0x05 && bytes.length >= 9) {
    if (seq === 0 && Number.isFinite(bytes[5]) && Number.isFinite(bytes[6])) {
      const cla = bytes[5] ?? 0;
      const ins = bytes[6] ?? 0;
      let note = `APDU CLA ${hexByte(cla)} INS ${hexByte(ins)} P1 ${hexByte(bytes[7] ?? 0)} P2 ${hexByte(bytes[8] ?? 0)}`;
      if (cla === 0xe0 && ins === 0xde) {
        note += ` LIST_APPS count=${ledgerCatalog().length}`;
      }
      return { note, channel: 'apdu' };
    }
    return { note: 'GATT write', channel: 'apdu' };
  }
  if (direction === 'out') {
    const framed = describeOutgoingFrame(bytes);
    if (framed) {
      return framed;
    }
    if (clean.length >= 4) {
      return swNote(clean.slice(-4));
    }
  }
  return { note: direction === 'in' ? 'GATT write' : 'GATT notify', channel: 'ble' };
}

export function redactLogHex(hex: string, note?: string): string {
  const label = (note ?? '').toLowerCase();
  if (label.includes('session create') || label.includes('thpcreatenewsession') || label.includes('create new session')) {
    return '';
  }
  return hex;
}
