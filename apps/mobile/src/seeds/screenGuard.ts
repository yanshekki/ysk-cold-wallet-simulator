import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  addScreenshotListener,
  allowScreenCaptureAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from 'expo-screen-capture';
import { isDevBuild } from '../passkeys/devFlag';

const SECRET_KEY = 'cws-secret';

let secretScreenHolders = 0;

export function resetSecretScreenHoldersForTests(): void {
  secretScreenHolders = 0;
}

/**
 * iOS `preventScreenCaptureAsync` re-parents the window into a secure UITextField
 * and paints a black overlay while `UIScreen.isCaptured` (mirroring / USB / Control
 * Center). That blacks the live Vault tab. iOS does not set FLAG_SECURE.
 * Callers pass a warning toast. Android release still sets FLAG_SECURE, which
 * hides recents without covering the display.
 *
 * Debug builds skip Android FLAG_SECURE so `adb exec-out screencap` and other
 * screenshot-gated QA can capture Vault / seed UI. The screenshot listener
 * still warns. Same rationale as skipping biometrics in `session.ts`.
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

/**
 * Nested secret screens (Vault tab still mounted under Import) share one
 * Android FLAG_SECURE. The last release is what clears it.
 */
export function retainSecretScreen(): () => void {
  secretScreenHolders += 1;
  if (secretScreenHolders === 1) {
    lockSecretScreen();
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    secretScreenHolders = Math.max(0, secretScreenHolders - 1);
    if (secretScreenHolders === 0) {
      unlockSecretScreen();
    }
  };
}

export function useSecretScreen(onScreenshot: () => void) {
  const onScreenshotRef = useRef(onScreenshot);
  onScreenshotRef.current = onScreenshot;
  useEffect(() => {
    const sub = addScreenshotListener(() => {
      onScreenshotRef.current();
    });
    const release = retainSecretScreen();
    return () => {
      sub.remove();
      release();
    };
  }, []);
}

/** Native allow — undoes a leftover iOS secure-canvas from an older JS bundle. */
export function releaseCaptureOverlay(): void {
  void allowScreenCaptureAsync().catch(() => undefined);
}
