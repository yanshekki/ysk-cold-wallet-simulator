import { describe, expect, it } from 'vitest';
import type { ApduLogEntry, LogChannel } from '@cws/contracts';
import {
  buildMatcher,
  clampFontSize,
  copyAllText,
  copyLineText,
  copyMatchText,
  exportLogText,
  filterEntries,
  LOG_CHANNELS,
  LOG_FONT_MAX,
  LOG_FONT_MIN,
  matchEntries,
  stepMatchIndex,
  visibleEntries,
} from './logQuery';

const at = Date.UTC(2026, 0, 1, 12, 0, 0, 0);

function entry(
  id: string,
  direction: 'in' | 'out',
  channel: LogChannel,
  hex: string,
  note?: string,
): ApduLogEntry {
  return { id, at, direction, hex, channel, note };
}

const SAMPLE: ApduLogEntry[] = [
  entry('1', 'out', 'ble', 'aabb', 'advertise start'),
  entry('2', 'in', 'apdu', 'e001', 'GET'),
  entry('3', 'out', 'app', '00', 'OPEN_APP ethereum'),
  entry('4', 'out', 'sign', 'dead', 'confirm'),
  entry('5', 'out', 'pair', '01', 'pairing 123'),
  entry('6', 'out', 'near', 'ff', 'near: exists'),
  entry('7', 'out', 'manager', '11', 'manager: fetch'),
  entry('8', 'out', 'error', '00', 'failed'),
];

describe('logQuery', () => {
  it('ALL keeps the full buffer', () => {
    expect(filterEntries(SAMPLE, 'all')).toHaveLength(SAMPLE.length);
  });

  it('RX keeps inbound lines', () => {
    expect(filterEntries(SAMPLE, 'in').map((row) => row.id)).toEqual(['2']);
  });

  it('TX keeps outbound lines', () => {
    expect(filterEntries(SAMPLE, 'out').every((row) => row.direction === 'out')).toBe(true);
  });

  it.each(LOG_CHANNELS)('filters channel %s', (channel) => {
    expect(filterEntries(SAMPLE, channel).every((row) => (row.channel ?? 'ble') === channel)).toBe(true);
  });

  it('WRAP has no query-layer mutation (visible list stays intact)', () => {
    const filtered = filterEntries(SAMPLE, 'all');
    expect(visibleEntries(filtered, filtered, false)).toEqual(filtered);
  });

  it('FOLLOW has no query-layer mutation (visible list stays intact)', () => {
    const filtered = filterEntries(SAMPLE, 'ble');
    expect(visibleEntries(filtered, filtered, false)).toEqual(filtered);
  });

  it('search is case-insensitive by default', () => {
    const filtered = filterEntries(SAMPLE, 'all');
    const matcher = buildMatcher('GET', false, false);
    expect(matchEntries(filtered, 'GET', matcher).map((row) => row.id)).toEqual(['2']);
    expect(matchEntries(filtered, 'get', matcher).map((row) => row.id)).toEqual(['2']);
  });

  it('Aa makes search case-sensitive', () => {
    const filtered = filterEntries(SAMPLE, 'all');
    const matcher = buildMatcher('get', true, false);
    expect(matchEntries(filtered, 'get', matcher)).toEqual([]);
    expect(matchEntries(filtered, 'GET', buildMatcher('GET', true, false)).map((row) => row.id)).toEqual(['2']);
  });

  it('.* treats the query as regex', () => {
    const filtered = filterEntries(SAMPLE, 'all');
    const matcher = buildMatcher('OPEN_APP|pairing', false, true);
    expect(matchEntries(filtered, 'OPEN_APP|pairing', matcher).map((row) => row.id)).toEqual(['3', '5']);
  });

  it('invalid regex does not hide rows', () => {
    const filtered = filterEntries(SAMPLE, 'all');
    const matcher = buildMatcher('(', false, true);
    expect(matcher.error).toBe('Invalid regex');
    expect(matchEntries(filtered, '(', matcher)).toEqual(filtered);
  });

  it('Prev steps the match index backward', () => {
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
  });

  it('Next steps the match index forward', () => {
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
  });

  it('Copy line dumps the formatted active/last row, not raw hex', () => {
    const text = copyLineText(SAMPLE, false, 0);
    expect(text).toContain('TX');
    expect(text).toContain('failed');
    expect(text).toContain('00');
    expect(text).not.toBe('00');
  });

  it('Copy match dumps only search hits', () => {
    const filtered = filterEntries(SAMPLE, 'all');
    const matcher = buildMatcher('near', false, false);
    const matched = matchEntries(filtered, 'near', matcher);
    const text = copyMatchText(true, matched);
    expect(text).toContain('near: exists');
    expect(text).not.toContain('advertise start');
  });

  it('Copy match is a no-op without a query', () => {
    expect(copyMatchText(false, SAMPLE)).toBeNull();
  });

  it('Copy all dumps the full buffer, ignoring the filter', () => {
    const text = copyAllText(SAMPLE);
    expect(text).toContain('advertise start');
    expect(text).toContain('failed');
    expect(text.split('\n\n')).toHaveLength(SAMPLE.length);
  });

  it('A+ / A- clamp font size', () => {
    expect(clampFontSize(LOG_FONT_MAX + 4)).toBe(LOG_FONT_MAX);
    expect(clampFontSize(LOG_FONT_MIN - 4)).toBe(LOG_FONT_MIN);
    expect(clampFontSize(12)).toBe(12);
  });

  it('Export dumps the full buffer', () => {
    expect(exportLogText(SAMPLE)).toBe(copyAllText(SAMPLE));
  });

  it('Clear is represented by an empty buffer', () => {
    expect(copyAllText([])).toBe('');
  });

  it('Latest has no query-layer mutation', () => {
    expect(visibleEntries(SAMPLE, SAMPLE, false)).toEqual(SAMPLE);
  });
});
