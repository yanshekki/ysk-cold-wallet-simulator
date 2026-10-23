/**
 * Platform-authenticator unlock layer (ARCHITECTURE §5 / §9.9).
 *
 * Full WebAuthn passkeys need a relying-party domain plus hosted
 * AASA / Digital Asset Links files. This repo has no associated domain,
 * so unlock uses the OS authenticator (biometric / device PIN) and
 * SecureStore `requireAuthentication` remains the second gate on entropy.
 */

import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export const SESSION_MS = 15 * 60 * 1000;

export const NOT_ENROLLED_MESSAGE =
  'Set a lock screen PIN or biometric in system settings.';

export const WEB_DEV_MESSAGE = 'Web skip — use an Android/iOS device for real unlock.';

export const ENROLLED_MESSAGE =
  'Platform authenticator (biometric / device PIN) unlocks a 15-minute session. Seeds stay in SecureStore.';

export type UnlockKind = 'web-dev' | 'enrolled' | 'not-enrolled';

export type UnlockStatus = {
  kind: UnlockKind;
  message: string;
};

export async function describeUnlock(): Promise<UnlockStatus> {
  if (Platform.OS === 'web') {
    return { kind: 'web-dev', message: WEB_DEV_MESSAGE };
  }
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level < LocalAuthentication.SecurityLevel.SECRET) {
    return { kind: 'not-enrolled', message: NOT_ENROLLED_MESSAGE };
  }
  return { kind: 'enrolled', message: ENROLLED_MESSAGE };
}

export async function unlock(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return true;
  }
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level < LocalAuthentication.SecurityLevel.SECRET) {
    throw new Error(NOT_ENROLLED_MESSAGE);
  }
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock YSK Cold Wallet Simulator',
      biometricsSecurityLevel: 'strong',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch (err) {
    throw err instanceof Error ? err : new Error('Unlock failed');
  }
}
