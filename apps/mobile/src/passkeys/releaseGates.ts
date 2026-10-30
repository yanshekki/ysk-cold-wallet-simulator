/**
 * Debug skips exist only when `isDevBuild()` is true.
 * That function is Metro's `__DEV__` flag. A release build passes false.
 */
export function keychainRequiresAuthentication(devBuild: boolean): boolean {
  return devBuild === false;
}

export function androidFlagSecureOnSecretScreens(devBuild: boolean): boolean {
  return devBuild === false;
}
