/**
 * Release asks the OS authenticator before a seed is revealed, imported, or
 * saved. Debug stays on the session that already skipped the prompt.
 * Sign and QR seed-export use `needsSignReauth` instead.
 */
export function revealNeedsOsReauth(devBuild: boolean): boolean {
  return !devBuild;
}
