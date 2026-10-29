import type { SigningDetail, SigningField } from '@cws/contracts';
import { formatHex } from './logFormat';

/** First bytes kept visible while a longer hex dump is collapsed. */
export const RAW_HEX_PREVIEW_BYTES = 8;

/** Raw hex longer than a 32-byte hash is truncated until the reader expands it. */
export const RAW_HEX_COLLAPSE_AFTER = 32;

export type RawHexRow = {
  id: string;
  label: string;
  /** Original value, including the 0x prefix when the preview used one. */
  value: string;
  bytes: number | null;
  preview: string;
  collapsed: boolean;
};

export function rawHexParts(value: string): { bytes: number; preview: string; collapsed: boolean } | null {
  const clean = value.replace(/^0x/i, '').replace(/\s+/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    return null;
  }
  const bytes = clean.length / 2;
  const collapsed = bytes > RAW_HEX_COLLAPSE_AFTER;
  const head = collapsed ? clean.slice(0, RAW_HEX_PREVIEW_BYTES * 2) : clean;
  return {
    bytes,
    collapsed,
    preview: `${formatHex(head)}${collapsed ? ' …' : ''}`,
  };
}

/**
 * Readable fields stay in order. Calldata and the raw envelope sit in a second
 * group so a long hex dump does not bury the decoded transaction.
 */
export function layoutSigningDetail(
  detail: SigningDetail,
  labels: { rawSection: string; payload: string },
): { summary: SigningField[]; rawSection: string | null; raw: RawHexRow[] } {
  const summary = detail.fields.filter((field) => !field.raw);
  const hasCalldata = detail.fields.some((field) => field.raw);
  const raw: RawHexRow[] = [];
  detail.fields.forEach((field, index) => {
    if (field.raw) {
      raw.push(toRow(`field-${index}`, field.label, field.value));
    }
  });
  if (detail.hex) {
    raw.push(toRow('payload', labels.payload, detail.hex));
  }
  return {
    summary,
    rawSection: hasCalldata ? labels.rawSection : null,
    raw,
  };
}

function toRow(id: string, label: string, value: string): RawHexRow {
  const parts = rawHexParts(value);
  if (!parts) {
    return { id, label, value, bytes: null, preview: value, collapsed: false };
  }
  return { id, label, value, bytes: parts.bytes, preview: parts.preview, collapsed: parts.collapsed };
}
