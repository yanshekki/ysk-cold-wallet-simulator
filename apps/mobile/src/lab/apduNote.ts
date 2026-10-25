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

export function describeBlePayload(hex: string, direction: 'in' | 'out'): { note: string; channel: LogChannel } {
  const clean = hex.replace(/\s+/g, '').toLowerCase();
  if (!clean) {
    return { note: direction === 'out' ? 'notify empty' : 'write empty', channel: 'ble' };
  }
  const bytes: number[] = [];
  for (let i = 0; i + 1 < Math.min(clean.length, 24); i += 2) {
    bytes.push(Number.parseInt(clean.slice(i, i + 2), 16));
  }
  const tag = bytes[0];
  if (tag === 0x05 && bytes.length >= 9) {
    const cla = bytes[5];
    const ins = bytes[6];
    const p1 = bytes[7];
    const p2 = bytes[8];
    if (direction === 'in' && Number.isFinite(cla) && Number.isFinite(ins)) {
      let note = `APDU CLA ${hexByte(cla)} INS ${hexByte(ins)} P1 ${hexByte(p1)} P2 ${hexByte(p2)}`;
      if (cla === 0xe0 && ins === 0xde) {
        note += ` LIST_APPS count=${ledgerCatalog().length}`;
      }
      return { note, channel: 'apdu' };
    }
  }
  if (direction === 'out' && clean.length >= 4) {
    const sw = clean.slice(-4);
    const name = SW_NAMES[sw];
    return { note: name ? `SW ${sw} ${name}` : `SW ${sw}`, channel: sw === '9000' ? 'apdu' : 'error' };
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
