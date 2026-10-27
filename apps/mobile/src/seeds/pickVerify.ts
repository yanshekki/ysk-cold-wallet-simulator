import { isDevBuild } from '../passkeys/devFlag';

export type VerifyPick = { index: number; word: string };

/**
 * Release builds quiz three random mnemonic words before the new seed can be
 * saved. Debug skips the quiz so screenshot-gated device tests can finish
 * without typing secrets — same `isDevBuild()` gate as Face ID in `session.ts`.
 */
export function pickVerify(words: string[]): VerifyPick[] {
  if (isDevBuild()) {
    return [];
  }
  const indexes = [...words.keys()].sort(() => 0.5 - Math.random()).slice(0, 3);
  return indexes.map((index) => ({ index, word: words[index] ?? '' }));
}
