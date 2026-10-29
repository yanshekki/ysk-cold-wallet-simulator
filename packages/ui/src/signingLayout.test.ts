import { describe, expect, it } from 'vitest';
import type { SigningDetail } from '@cws/contracts';
import { formatHex } from './logFormat';
import { layoutSigningDetail, rawHexParts } from './signingLayout';

const labels = { rawSection: 'Raw data', payload: 'Raw payload' };

describe('rawHexParts', () => {
  it('leaves a 32-byte hash expanded', () => {
    const value = `0x${'cd'.repeat(32)}`;
    expect(rawHexParts(value)).toEqual({
      bytes: 32,
      collapsed: false,
      preview: formatHex(value),
    });
  });

  it('keeps the first 8 bytes of a longer dump and records the full size', () => {
    const value = `0x${'ab'.repeat(33)}`;
    expect(rawHexParts(value)).toEqual({
      bytes: 33,
      collapsed: true,
      preview: 'ab ab ab ab ab ab ab ab …',
    });
  });

  it('does not treat a sentence as hex', () => {
    expect(rawHexParts('Calldata is not decoded.')).toBeNull();
  });
});

describe('layoutSigningDetail', () => {
  it('keeps decoded fields above collapsed calldata and the envelope', () => {
    const data = `0x${'11'.repeat(80)}`;
    const envelope = `0x${'22'.repeat(90)}`;
    const detail: SigningDetail = {
      style: 'eth-tx',
      headline: 'Avalanche C-Chain transaction',
      fields: [
        { label: 'TO', value: `0x${'ab'.repeat(20)}`, mono: true },
        { label: 'VALUE', value: '0 AVAX', mono: false },
        { label: 'DATA', value: data, mono: true, raw: true },
      ],
      hex: envelope,
    };
    const laid = layoutSigningDetail(detail, labels);
    expect(laid.summary.map((field) => field.label)).toEqual(['TO', 'VALUE']);
    expect(laid.rawSection).toBe('Raw data');
    expect(laid.raw.map((row) => row.label)).toEqual(['DATA', 'Raw payload']);
    expect(laid.raw[0]).toMatchObject({
      collapsed: true,
      bytes: 80,
      value: data,
      preview: '11 11 11 11 11 11 11 11 …',
    });
    expect(laid.raw[1]).toMatchObject({ collapsed: true, bytes: 90, value: envelope });
  });

  it('collapses a long envelope without a calldata section', () => {
    const detail: SigningDetail = {
      style: 'eth-tx',
      headline: 'Avalanche C-Chain transaction',
      fields: [{ label: 'VALUE', value: '1 AVAX' }],
      hex: `0x${'aa'.repeat(40)}`,
    };
    const laid = layoutSigningDetail(detail, labels);
    expect(laid.summary).toHaveLength(1);
    expect(laid.rawSection).toBeNull();
    expect(laid.raw).toHaveLength(1);
    expect(laid.raw[0]?.collapsed).toBe(true);
    expect(laid.raw[0]?.value).toBe(detail.hex);
  });

  it('shows a short payload in full', () => {
    const detail: SigningDetail = {
      style: 'raw-sign',
      headline: 'Sign NEAR delegate action',
      fields: [{ label: 'SENDER', value: 'alice.near' }],
      hex: '0x01020304',
    };
    const laid = layoutSigningDetail(detail, labels);
    expect(laid.rawSection).toBeNull();
    expect(laid.raw[0]).toMatchObject({
      collapsed: false,
      bytes: 4,
      preview: '01 02 03 04',
      value: '0x01020304',
    });
  });
});
