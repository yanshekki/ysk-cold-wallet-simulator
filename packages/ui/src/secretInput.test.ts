import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { secretInputProps } from './secretInput';

describe('secretInputProps', () => {
  it('hides the system copy menu and does not select the secret on focus', () => {
    expect(secretInputProps.contextMenuHidden).toBe(true);
    expect(secretInputProps.selectTextOnFocus).toBe(false);
    expect(secretInputProps.autoComplete).toBe('off');
    expect(secretInputProps.importantForAutofill).toBe('no');
  });

  it('does not put a mnemonic into an accessibility label on the word grid', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'MnemonicGrid.tsx'), 'utf8');
    expect(source).toContain('selectable={false}');
    expect(source).not.toContain('accessibilityLabel');
    expect(source).not.toContain('accessibilityHint');
  });
});
