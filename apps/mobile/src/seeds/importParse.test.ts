import { describe, expect, it } from 'vitest';
import {
  analyzeImport,
  applyLastSuggestion,
  closestWord,
  replaceToken,
  sanitizePaste,
  splitShares,
} from './importParse';

const BIP39_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const SLIP_A =
  'shadow pistol academic always adequate wildlife fancy gross oasis cylinder mustang wrist rescue view short owner flip making coding armed';
const SLIP_B =
  'shadow pistol academic acid actress prayer class unknown daughter sweater depict flip twice unkind craft early superior advocate guest smoking';

describe('importParse', () => {
  it('sanitizes numbered lists and commas', () => {
    expect(sanitizePaste('1. Abandon, 2) abandon 3. about')).toBe('abandon abandon about');
  });

  it('splits blank-line shares and share headers', () => {
    expect(splitShares(`${SLIP_A}\n\n${SLIP_B}`)).toEqual([SLIP_A, SLIP_B]);
    expect(splitShares(`Share 1:\n${SLIP_A}\nShare 2:\n${SLIP_B}`)).toEqual([SLIP_A, SLIP_B]);
  });

  it('marks a valid BIP39 phrase ready', () => {
    const analysis = analyzeImport([BIP39_12]);
    expect(analysis.scheme).toBe('bip39');
    expect(analysis.have).toBe(12);
    expect(analysis.need).toBe(12);
    expect(analysis.checksumOk).toBe(true);
    expect(analysis.ready).toBe(true);
    expect(analysis.shares[0]?.words.every((item) => item.ok)).toBe(true);
  });

  it('suggests a close BIP39 word', () => {
    expect(closestWord('abandn', ['abandon', 'ability', 'able'])).toBe('abandon');
    const analysis = analyzeImport(['abandon abandon abandn']);
    expect(analysis.ready).toBe(false);
    expect(analysis.shares[0]?.words[2]?.ok).toBe(false);
    expect(analysis.shares[0]?.words[2]?.suggestion).toBe('abandon');
  });

  it('counts incomplete BIP39 toward the next length', () => {
    const analysis = analyzeImport(['abandon abandon abandon']);
    expect(analysis.scheme).toBe('unknown');
    expect(analysis.have).toBe(3);
    expect(analysis.need).toBe(12);
    expect(analysis.ready).toBe(false);
  });

  it('combines two valid SLIP-39 shares', () => {
    const analysis = analyzeImport([SLIP_A, SLIP_B]);
    expect(analysis.scheme).toBe('slip39');
    expect(analysis.shares).toHaveLength(2);
    expect(analysis.ready).toBe(true);
    expect(analysis.checksumOk).toBe(true);
  });

  it('does not mark a single 2-of-3 share ready', () => {
    const analysis = analyzeImport([SLIP_A]);
    expect(analysis.scheme).toBe('slip39');
    expect(analysis.shares[0]?.valid).toBe(true);
    expect(analysis.ready).toBe(false);
  });

  it('replaces a token and applies a last-word suggestion', () => {
    expect(replaceToken('abandon abandn about', 1, 'abandon')).toBe('abandon abandon about');
    expect(applyLastSuggestion('abandon aba', 'abandon')).toBe('abandon abandon ');
  });
});
