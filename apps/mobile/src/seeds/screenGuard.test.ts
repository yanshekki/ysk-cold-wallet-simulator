import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { OS: 'android' };
const preventScreenCaptureAsync = vi.fn();
const allowScreenCaptureAsync = vi.fn();
const enableAppSwitcherProtectionAsync = vi.fn();
const { isDevBuild } = vi.hoisted(() => ({
  isDevBuild: vi.fn(() => false),
}));

vi.mock('../passkeys/devFlag', () => ({
  isDevBuild: () => isDevBuild(),
}));

vi.mock('react-native', () => ({
  Platform: platform,
}));

vi.mock('expo-screen-capture', () => ({
  addScreenshotListener: vi.fn(() => ({ remove: vi.fn() })),
  preventScreenCaptureAsync: (...args: unknown[]) => preventScreenCaptureAsync(...args),
  allowScreenCaptureAsync: (...args: unknown[]) => allowScreenCaptureAsync(...args),
  enableAppSwitcherProtectionAsync: (...args: unknown[]) => enableAppSwitcherProtectionAsync(...args),
}));

describe('secret screen capture lock', () => {
  beforeEach(() => {
    platform.OS = 'android';
    isDevBuild.mockReset();
    isDevBuild.mockReturnValue(false);
    preventScreenCaptureAsync.mockReset();
    allowScreenCaptureAsync.mockReset();
    enableAppSwitcherProtectionAsync.mockReset();
    preventScreenCaptureAsync.mockResolvedValue(undefined);
    allowScreenCaptureAsync.mockResolvedValue(undefined);
    enableAppSwitcherProtectionAsync.mockResolvedValue(undefined);
  });

  it('sets Android FLAG_SECURE in a release build', async () => {
    const { lockSecretScreen } = await import('./screenGuard');
    lockSecretScreen();
    expect(preventScreenCaptureAsync).toHaveBeenCalledWith('cws-secret');
    expect(allowScreenCaptureAsync).not.toHaveBeenCalled();
    expect(enableAppSwitcherProtectionAsync).not.toHaveBeenCalled();
  });

  it('clears Android FLAG_SECURE in a debug build so screencap QA can see Vault UI', async () => {
    isDevBuild.mockReturnValue(true);
    const { lockSecretScreen } = await import('./screenGuard');
    lockSecretScreen();
    expect(preventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(allowScreenCaptureAsync).toHaveBeenCalledWith('cws-secret');
    expect(enableAppSwitcherProtectionAsync).not.toHaveBeenCalled();
  });

  it('uses app-switcher blur on iOS instead of FLAG_SECURE, including debug', async () => {
    platform.OS = 'ios';
    isDevBuild.mockReturnValue(true);
    const { lockSecretScreen } = await import('./screenGuard');
    lockSecretScreen();
    expect(preventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(allowScreenCaptureAsync).not.toHaveBeenCalled();
    expect(enableAppSwitcherProtectionAsync).toHaveBeenCalledWith(0.55);
  });

  it('releases Android FLAG_SECURE on unmount in release and debug', async () => {
    const { unlockSecretScreen } = await import('./screenGuard');
    unlockSecretScreen();
    expect(allowScreenCaptureAsync).toHaveBeenCalledWith('cws-secret');
    expect(preventScreenCaptureAsync).not.toHaveBeenCalled();
  });
});
