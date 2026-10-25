/** expo-secure-store only accepts alphanumeric keys plus `.`, `-`, and `_`. */
export function secureStoreKey(...parts: string[]): string {
  const key = parts
    .map((part) => part.trim().replace(/[^A-Za-z0-9._-]+/g, '_'))
    .filter(Boolean)
    .join('.');
  if (!key) {
    throw new Error('SecureStore key is empty');
  }
  return key;
}

export const SLOTS_KEY = secureStoreKey('cws', 'slots');
export const LEGACY_SLOTS_KEY = 'cws:slots';

export function entropyKey(id: string): string {
  return secureStoreKey('cws', 'entropy', id);
}

export function sharesKey(id: string): string {
  return secureStoreKey('cws', 'shares', id);
}
