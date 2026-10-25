export const SEED_PALETTE = [
  { color: '#3DDC97', emoji: '🟢' },
  { color: '#58A6FF', emoji: '🔵' },
  { color: '#F0883E', emoji: '🟠' },
  { color: '#F85149', emoji: '🔴' },
  { color: '#D2A8FF', emoji: '🟣' },
  { color: '#E3B341', emoji: '🟡' },
] as const;

export function seedAccent(value?: string): { color?: string; emoji?: string } {
  if (!value) {
    return {};
  }
  const hit = SEED_PALETTE.find((item) => item.color === value || item.emoji === value);
  if (hit) {
    return { color: hit.color, emoji: hit.emoji };
  }
  if (value.startsWith('#')) {
    return { color: value };
  }
  return { emoji: value };
}
