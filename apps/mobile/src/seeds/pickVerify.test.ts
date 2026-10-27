import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isDevBuild } = vi.hoisted(() => ({
  isDevBuild: vi.fn(() => false),
}));

vi.mock('../passkeys/devFlag', () => ({
  isDevBuild: () => isDevBuild(),
}));

const WORDS = [
  'abandon',
  'ability',
  'able',
  'about',
  'above',
  'absent',
  'absorb',
  'abstract',
  'absurd',
  'abuse',
  'access',
  'accident',
];

describe('pickVerify', () => {
  beforeEach(() => {
    isDevBuild.mockReset();
    isDevBuild.mockReturnValue(false);
  });

  it('quizzes three mnemonic words in a release build', async () => {
    const { pickVerify } = await import('./pickVerify');
    const picks = pickVerify(WORDS);
    expect(picks).toHaveLength(3);
    const indexes = picks.map((item) => item.index);
    expect(new Set(indexes).size).toBe(3);
    for (const pick of picks) {
      expect(pick.index).toBeGreaterThanOrEqual(0);
      expect(pick.index).toBeLessThan(WORDS.length);
      expect(pick.word).toBe(WORDS[pick.index]);
    }
  });

  it('skips the quiz in a debug build so device tests need not type secrets', async () => {
    isDevBuild.mockReturnValue(true);
    const { pickVerify } = await import('./pickVerify');
    expect(pickVerify(WORDS)).toEqual([]);
  });
});
