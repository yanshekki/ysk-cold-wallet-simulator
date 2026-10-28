import type { SigningKind } from '@cws/contracts';

/**
 * Release always re-checks the OS authenticator after hold for a signature
 * or a seed export. Hold alone is not enough if another app can drive the
 * press. Debug builds honor the Settings toggle so lab runs can proceed.
 */
export function needsSignReauth(input: {
  kind: SigningKind | undefined;
  signReauth: boolean;
  devBuild: boolean;
}): boolean {
  if (input.kind !== 'sign' && input.kind !== 'export-seed') {
    return false;
  }
  return input.signReauth || !input.devBuild;
}
