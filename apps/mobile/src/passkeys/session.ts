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

export const NOT_ENROLLED_MESSAGE = 'unlock.notEnrolled';
export const WEB_DEV_MESSAGE = 'unlock.webDev';
export const DEV_SKIP_MESSAGE = 'unlock.devSkip';
export const ENROLLED_MESSAGE = 'unlock.enrolled';

export type UnlockKind = 'web-dev' | 'dev-skip' | 'enrolled' | 'not-enrolled';

export type UnlockStatus = {
  kind: UnlockKind;
  message: string;
};

export type SessionHref = '/unlock' | '/(app)' | '/disclaimer';

/** Expo Router groups hide `(app)` from the URL, so Device is also `/`. Unlock lives at `/unlock`. */
export function sessionRedirect(
  unlocked: boolean,
  rootSegment: string | undefined,
  accepted: boolean,
): SessionHref | null {
  if (!accepted) {
    return rootSegment === 'disclaimer' ? null : '/disclaimer';
  }
  if (rootSegment === 'disclaimer') {
    return unlocked ? '/(app)' : '/unlock';
  }
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

let faceIdEnabled = true;

export function setFaceIdEnabled(value: boolean): void {
  faceIdEnabled = value;
}

export async function unlock(promptMessage = 'Unlock'): Promise<boolean> {
  if (Platform.OS === 'web' || isDevBuild() || !faceIdEnabled) {
    return true;
  }
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level < LocalAuthentication.SecurityLevel.SECRET) {
    throw new Error(NOT_ENROLLED_MESSAGE);
  }
  const prompt = {
    promptMessage,
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
    throw err instanceof Error ? err : new Error('unlock.failed');
  }
}
