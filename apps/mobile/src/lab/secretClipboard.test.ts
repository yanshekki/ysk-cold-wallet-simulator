import { describe, expect, it } from 'vitest';
import { clipboardWriteAllowed } from './secretClipboard';

describe('clipboardWriteAllowed', () => {
  it('refuses recovery material', () => {
    expect(clipboardWriteAllowed('secret')).toBe(false);
  });

  it('allows public text', () => {
    expect(clipboardWriteAllowed('public')).toBe(true);
  });
});
