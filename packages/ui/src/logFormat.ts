import type { ApduLogEntry } from '@cws/contracts';

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

export function formatTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function formatHex(hex: string): string {
  const clean = hex.replace(/^0x/i, '').replace(/\s+/g, '').toLowerCase();
  return clean.replace(/(.{2})/g, '$1 ').trim();
}

export function formatLogText(entries: readonly ApduLogEntry[]): string {
  return entries
    .map((entry) => {
      const dir = entry.direction === 'in' ? 'RX' : 'TX';
      const note = entry.note ? ` ${entry.note}` : '';
      const channel = entry.channel ? ` [${entry.channel}]` : '';
      return `${formatTime(entry.at)} ${dir}${channel}${note}\n${formatHex(entry.hex)}`;
    })
    .join('\n\n');
}

export function entryHaystack(entry: ApduLogEntry): string {
  const dir = entry.direction === 'in' ? 'RX' : 'TX';
  return `${formatTime(entry.at)} ${dir} ${entry.channel ?? ''} ${entry.note ?? ''} ${formatHex(entry.hex)} ${entry.hex}`;
}
