import { describe, expect, it } from 'vitest';
import { isDisclaimerAccepted, parseDisclaimerRecord } from './acceptance';
import { DISCLAIMER_VERSION } from './version';

describe('disclaimer acceptance', () => {
  it('rejects a missing record', () => {
    expect(parseDisclaimerRecord(null)).toBeNull();
    expect(isDisclaimerAccepted(null)).toBe(false);
  });

  it('rejects invalid JSON and incomplete records', () => {
    expect(parseDisclaimerRecord('{')).toBeNull();
    expect(isDisclaimerAccepted('{"version":1}')).toBe(false);
    expect(isDisclaimerAccepted('{"acceptedAt":1}')).toBe(false);
  });

  it('rejects a stale version', () => {
    const raw = JSON.stringify({ version: DISCLAIMER_VERSION - 1, acceptedAt: 1 });
    expect(isDisclaimerAccepted(raw)).toBe(false);
    expect(isDisclaimerAccepted(raw, DISCLAIMER_VERSION)).toBe(false);
  });

  it('accepts a matching version', () => {
    const raw = JSON.stringify({ version: DISCLAIMER_VERSION, acceptedAt: 1_700_000_000_000 });
    expect(parseDisclaimerRecord(raw)).toEqual({
      version: DISCLAIMER_VERSION,
      acceptedAt: 1_700_000_000_000,
    });
    expect(isDisclaimerAccepted(raw)).toBe(true);
  });
});
