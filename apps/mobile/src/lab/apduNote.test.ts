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
    expect(describeBlePayload('05000000026985', 'out')).toEqual({
      note: 'SW 6985 DENY',
      channel: 'error',
    });
  });

  it('does not read signature tails of a chunked 9000 response as status words', () => {
    const chunks = [
      '0500000042fcca883132436c88df7de99be8656b',
      '05000140168a5faa3e299f835ced499046b535a2',
      '0500028e5be958e9d9a5b7ffa208a9a1281f8070',
      '050003f962ccc4324588e5ec159588c3d70d9000',
    ];
    expect(describeBlePayload(chunks[0]!, 'out')).toEqual({
      note: 'APDU response 66 bytes',
      channel: 'apdu',
    });
    expect(describeBlePayload(chunks[1]!, 'out')).toEqual({
      note: 'APDU response chunk 1',
      channel: 'apdu',
    });
    expect(describeBlePayload(chunks[2]!, 'out')).toEqual({
      note: 'APDU response chunk 2',
      channel: 'apdu',
    });
    expect(describeBlePayload(chunks[3]!, 'out')).toEqual({
      note: 'SW 9000 OK',
      channel: 'apdu',
    });
  });

  it('strips hex from CreateNewSession frames', () => {
    expect(redactLogHex('aabbcc', 'session create')).toBe('');
    expect(redactLogHex('aabbcc', 'ThpCreateNewSession')).toBe('');
    expect(redactLogHex('aabbcc', 'GATT write')).toBe('aabbcc');
  });
});
