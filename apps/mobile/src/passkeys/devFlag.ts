/**
 * Metro inlines `__DEV__` as true in Debug and false in Release.
 * Production IPAs keep Face ID; Debug skips it so USB device tests can run.
 */
export function isDevBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}
