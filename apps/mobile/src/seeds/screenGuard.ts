import { useEffect } from 'react';
import { Platform } from 'react-native';
import {
  addScreenshotListener,
  allowScreenCaptureAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from 'expo-screen-capture';

const SECRET_KEY = 'cws-secret';

/**
 * iOS `preventScreenCaptureAsync` re-parents the window into a secure UITextField
 * and paints a black overlay while `UIScreen.isCaptured` (mirroring / USB / Control
 * Center). That blacks the live Vault tab. Warn on screenshots instead; Android
 * FLAG_SECURE still hides recents without covering the display.
 */
export function useSecretScreen(onScreenshot: () => void) {
  useEffect(() => {
    const sub = addScreenshotListener(onScreenshot);
    if (Platform.OS === 'android') {
      void preventScreenCaptureAsync(SECRET_KEY).catch(() => undefined);
    } else {
      void enableAppSwitcherProtectionAsync(0.55).catch(() => undefined);
    }
    return () => {
      sub.remove();
      if (Platform.OS === 'android') {
        void allowScreenCaptureAsync(SECRET_KEY).catch(() => undefined);
      }
    };
  }, [onScreenshot]);
}

/** Native allow — undoes a leftover iOS secure-canvas from an older JS bundle. */
export function releaseCaptureOverlay(): void {
  void allowScreenCaptureAsync().catch(() => undefined);
}
