import { describe, expect, it } from 'vitest';
import { isKnownUnsafeMnemonic } from './knownMnemonics';

describe('known unsafe mnemonics', () => {
  it('rejects the Foundry fixture', () => {
    expect(
      isKnownUnsafeMnemonic('test test test test test test test test test test test junk'),
    ).toBe(true);
  });

  it('allows a non-fixture phrase', () => {
    expect(isKnownUnsafeMnemonic('legal winner thank year wave sausage worth useful legal winner thank yellow')).toBe(
      true,
    );
    expect(isKnownUnsafeMnemonic('ocean dumb huge wrap isolate claim ranch inside thank volume apology around')).toBe(
      false,
    );
  });
});
