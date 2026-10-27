import { useEffect } from 'react';
import { Platform } from 'react-native';
import {
  addScreenshotListener,
  allowScreenCaptureAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from 'expo-screen-capture';
import { isDevBuild } from '../passkeys/devFlag';

const SECRET_KEY = 'cws-secret';

/**
 * iOS `preventScreenCaptureAsync` re-parents the window into a secure UITextField
 * and paints a black overlay while `UIScreen.isCaptured` (mirroring / USB / Control
 * Center). That blacks the live Vault tab. Warn on screenshots instead; Android
 * FLAG_SECURE still hides recents without covering the display.
 *
 * Debug builds skip Android FLAG_SECURE so `adb exec-out screencap` and other
 * screenshot-gated QA can capture Vault / seed UI. Same rationale as skipping
 * biometrics in `session.ts`. Release Android keeps FLAG_SECURE.
 */
export function lockSecretScreen(): void {
  if (Platform.OS === 'android') {
    if (isDevBuild()) {
      void allowScreenCaptureAsync(SECRET_KEY).catch(() => undefined);
    } else {
      void preventScreenCaptureAsync(SECRET_KEY).catch(() => undefined);
    }
    return;
  }
  void enableAppSwitcherProtectionAsync(0.55).catch(() => undefined);
}

export function unlockSecretScreen(): void {
  if (Platform.OS === 'android') {
    void allowScreenCaptureAsync(SECRET_KEY).catch(() => undefined);
  }
}

export function useSecretScreen(onScreenshot: () => void) {
  useEffect(() => {
    const sub = addScreenshotListener(onScreenshot);
    lockSecretScreen();
    return () => {
      sub.remove();
      unlockSecretScreen();
    };
  }, [onScreenshot]);
}

/** Native allow — undoes a leftover iOS secure-canvas from an older JS bundle. */
export function releaseCaptureOverlay(): void {
  void allowScreenCaptureAsync().catch(() => undefined);
}
