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
    expect(source).toContain('accessibilityLabel={`Recovery word ${index + 1}`}');
    expect(source).not.toContain('accessibilityLabel={word}');
    expect(source).not.toContain('accessibilityHint');
  });

  it('does not offer a copy control for the recovery words', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'MnemonicGrid.tsx'), 'utf8');
    expect(source).not.toContain('setRefused');
    expect(source).not.toContain('<Button');
    expect(source).not.toContain('Clipboard');
    expect(source).not.toContain('copyText');
  });
});
