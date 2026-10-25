import { describe, expect, it } from 'vitest';
import { entryHaystack, formatHex, formatLogText, formatTime } from './logFormat';

describe('logFormat', () => {
  it('groups bytes for readable hex', () => {
    expect(formatHex('0xE000')).toBe('e0 00');
    expect(formatHex('aabbcc')).toBe('aa bb cc');
  });

  it('formats a gutter plus grouped payload', () => {
    const text = formatLogText([
      { id: '1', at: Date.UTC(2026, 0, 1, 12, 0, 0, 12), direction: 'out', hex: 'e001', note: 'GET' },
    ]);
    expect(text).toContain('TX');
    expect(text).toContain('GET');
    expect(text).toContain('e0 01');
    expect(formatTime(Date.UTC(2026, 0, 1, 12, 0, 0, 12))).toMatch(/00\.012$/);
  });

  it('indexes both grouped and compact hex for search', () => {
    const haystack = entryHaystack({
      id: '1',
      at: 0,
      direction: 'in',
      hex: 'aabb',
      note: 'OK',
    });
    expect(haystack).toContain('RX');
    expect(haystack).toContain('aa bb');
    expect(haystack).toContain('aabb');
  });
});
