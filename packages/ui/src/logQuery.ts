import type { ApduLogEntry, LogChannel } from '@cws/contracts';
import { entryHaystack, formatLogText } from './logFormat';

export type LogFilter = 'all' | 'in' | 'out' | LogChannel;

export const LOG_CHANNELS: LogChannel[] = ['ble', 'apdu', 'app', 'sign', 'pair', 'near', 'manager', 'error'];

export const LOG_FONT_MIN = 10;
export const LOG_FONT_MAX = 16;

export type LogMatcher = {
  test: (text: string) => boolean;
  source: string | null;
  flags: string;
  error: string | null;
};

export function buildMatcher(query: string, caseSensitive: boolean, regex: boolean): LogMatcher {
  if (!query) {
    return { test: () => true, source: null, flags: 'g', error: null };
  }
  try {
    const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = new RegExp(source, flags);
    return {
      test: (text) => {
        pattern.lastIndex = 0;
        return pattern.test(text);
      },
      source,
      flags,
      error: null,
    };
  } catch {
    return { test: () => false, source: null, flags: 'g', error: 'Invalid regex' };
  }
}

export function filterEntries(entries: readonly ApduLogEntry[], filter: LogFilter): ApduLogEntry[] {
  if (filter === 'all') {
    return [...entries];
  }
  if (filter === 'in' || filter === 'out') {
    return entries.filter((entry) => entry.direction === filter);
  }
  return entries.filter((entry) => (entry.channel ?? 'ble') === filter);
}

export function matchEntries(
  filtered: readonly ApduLogEntry[],
  query: string,
  matcher: LogMatcher,
): ApduLogEntry[] {
  if (!query || matcher.error) {
    return [...filtered];
  }
  return filtered.filter((entry) => matcher.test(entryHaystack(entry)));
}

export function visibleEntries(
  filtered: readonly ApduLogEntry[],
  matched: readonly ApduLogEntry[],
  searching: boolean,
): ApduLogEntry[] {
  return searching ? [...matched] : [...filtered];
}

export function clampFontSize(value: number): number {
  return Math.min(LOG_FONT_MAX, Math.max(LOG_FONT_MIN, value));
}

export function stepMatchIndex(current: number, count: number, delta: number): number {
  if (count <= 0) {
    return 0;
  }
  return (current + delta + count * 10) % count;
}

export function copyLineText(
  visible: readonly ApduLogEntry[],
  searching: boolean,
  matchIndex: number,
): string | null {
  const line = visible[searching ? matchIndex : visible.length - 1];
  return line ? formatLogText([line]) : null;
}

export function copyMatchText(searching: boolean, matched: readonly ApduLogEntry[]): string | null {
  if (!searching || matched.length === 0) {
    return null;
  }
  return formatLogText(matched);
}

export function copyAllText(entries: readonly ApduLogEntry[]): string {
  return formatLogText(entries);
}

export function exportLogText(entries: readonly ApduLogEntry[]): string {
  return formatLogText(entries);
}
