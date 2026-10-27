/**
 * Metro inlines `__DEV__` as true in Debug and false in Release.
 * Production keeps OS authentication, Android FLAG_SECURE, and the new-seed verify quiz.
 * Debug skips those so USB / screenshot-gated device tests can run.
 */
export function isDevBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}
