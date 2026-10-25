import { describe, expect, it } from 'vitest';
import { describeBlePayload, redactLogHex } from './apduNote';

describe('describeBlePayload', () => {
  it('decodes CLA/INS/P1/P2 and LIST_APPS count', () => {
    const hex = '0500000005e0de000000';
    const decoded = describeBlePayload(hex, 'in');
    expect(decoded.channel).toBe('apdu');
    expect(decoded.note).toContain('CLA e0');
    expect(decoded.note).toContain('INS de');
    expect(decoded.note).toContain('P1 00');
    expect(decoded.note).toContain('P2 00');
    expect(decoded.note).toMatch(/LIST_APPS count=\d+/);
  });

  it('names status words on notify', () => {
    expect(describeBlePayload('9000', 'out').note).toBe('SW 9000 OK');
    expect(describeBlePayload('aabb6d00', 'out').note).toBe('SW 6d00 INS_NOT_SUPPORTED');
  });

  it('strips hex from CreateNewSession frames', () => {
    expect(redactLogHex('aabbcc', 'session create')).toBe('');
    expect(redactLogHex('aabbcc', 'ThpCreateNewSession')).toBe('');
    expect(redactLogHex('aabbcc', 'GATT write')).toBe('aabbcc');
  });
});
