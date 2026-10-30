import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { androidFlagSecureOnSecretScreens, keychainRequiresAuthentication } from './releaseGates';

describe('release secret gates', () => {
  it('requires keychain authentication and FLAG_SECURE when the build is not debug', () => {
    expect(keychainRequiresAuthentication(false)).toBe(true);
    expect(androidFlagSecureOnSecretScreens(false)).toBe(true);
    expect(keychainRequiresAuthentication(true)).toBe(false);
    expect(androidFlagSecureOnSecretScreens(true)).toBe(false);
  });

  it('ties the debug skip to __DEV__ only', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'devFlag.ts'), 'utf8');
    expect(source).toContain('__DEV__');
    expect(source).not.toContain('signReauth');
  });
});
