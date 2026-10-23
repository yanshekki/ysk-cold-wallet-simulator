/**
 * Platform-authenticator unlock layer (ARCHITECTURE §5 / §9.9).
 *
 * Full WebAuthn passkeys need a relying-party domain plus hosted
 * AASA / Digital Asset Links files. This repo has no associated domain,
 * so unlock uses the OS authenticator (biometric / device PIN).
 * Debug builds skip the OS prompt so USB-device tests can proceed.
 */

import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { isDevBuild } from './devFlag';

export const SESSION_MS = 15 * 60 * 1000;

export const NOT_ENROLLED_MESSAGE =
  'Set a lock screen PIN or biometric in system settings.';

export const WEB_DEV_MESSAGE = 'Web skip — use an Android/iOS device for real unlock.';

export const DEV_SKIP_MESSAGE =
  'DEV build — Unlock skips Face ID. Release still requires biometric / device PIN.';

export const ENROLLED_MESSAGE =
  'Platform authenticator (biometric / device PIN) unlocks a 15-minute session. Seeds stay in SecureStore.';

export type UnlockKind = 'web-dev' | 'dev-skip' | 'enrolled' | 'not-enrolled';

export type UnlockStatus = {
  kind: UnlockKind;
  message: string;
};

export type SessionHref = '/unlock' | '/(app)';

/** Expo Router groups hide `(app)` from the URL, so Device is also `/`. Unlock lives at `/unlock`. */
export function sessionRedirect(unlocked: boolean, rootSegment: string | undefined): SessionHref | null {
  const inApp = rootSegment === '(app)' || rootSegment === 'seeds';
  if (unlocked) {
    return inApp ? null : '/(app)';
  }
  return rootSegment === 'unlock' ? null : '/unlock';
}

export async function describeUnlock(): Promise<UnlockStatus> {
  if (Platform.OS === 'web') {
    return { kind: 'web-dev', message: WEB_DEV_MESSAGE };
  }
  if (isDevBuild()) {
    return { kind: 'dev-skip', message: DEV_SKIP_MESSAGE };
  }
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level < LocalAuthentication.SecurityLevel.SECRET) {
    return { kind: 'not-enrolled', message: NOT_ENROLLED_MESSAGE };
  }
  return { kind: 'enrolled', message: ENROLLED_MESSAGE };
}

export async function unlock(): Promise<boolean> {
  if (Platform.OS === 'web' || isDevBuild()) {
    return true;
  }
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level < LocalAuthentication.SecurityLevel.SECRET) {
    throw new Error(NOT_ENROLLED_MESSAGE);
  }
  const prompt = {
    promptMessage: 'Unlock YSK Cold Wallet Simulator',
    biometricsSecurityLevel: 'strong' as const,
  };

  try {
    const biometric = await LocalAuthentication.authenticateAsync({
      ...prompt,
      disableDeviceFallback: true,
    });
    if (biometric.success) {
      return true;
    }
    if (biometric.error === 'user_cancel') {
      return false;
    }
    const fallback = await LocalAuthentication.authenticateAsync({
      ...prompt,
      disableDeviceFallback: false,
    });
    return fallback.success;
  } catch (err) {
    throw err instanceof Error ? err : new Error('Unlock failed');
  }
}
