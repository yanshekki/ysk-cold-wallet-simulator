import { describe, expect, it } from 'vitest';
import { shouldClearConsumedClipboard } from './importPaste';

describe('shouldClearConsumedClipboard', () => {
  it('clears only the text this paste consumed', () => {
    expect(shouldClearConsumedClipboard('abandon abandon', 'abandon abandon')).toBe(true);
    expect(shouldClearConsumedClipboard('abandon abandon', '  abandon abandon  ')).toBe(true);
    expect(shouldClearConsumedClipboard('abandon abandon', 'other secret')).toBe(false);
    expect(shouldClearConsumedClipboard(null, 'abandon abandon')).toBe(false);
    expect(shouldClearConsumedClipboard('  ', '  ')).toBe(false);
  });
});
