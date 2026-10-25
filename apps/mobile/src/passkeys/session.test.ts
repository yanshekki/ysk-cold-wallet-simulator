import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { OS: 'ios' };
const getEnrolledLevelAsync = vi.fn();
const authenticateAsync = vi.fn();
const { isDevBuild } = vi.hoisted(() => ({
  isDevBuild: vi.fn(() => false),
}));

vi.mock('./devFlag', () => ({
  isDevBuild: () => isDevBuild(),
}));

vi.mock('react-native', () => ({
  Platform: platform,
}));

vi.mock('expo-local-authentication', () => ({
  SecurityLevel: {
    NONE: 0,
    SECRET: 1,
    BIOMETRIC_WEAK: 2,
    BIOMETRIC_STRONG: 3,
  },
  getEnrolledLevelAsync: (...args: unknown[]) => getEnrolledLevelAsync(...args),
  authenticateAsync: (...args: unknown[]) => authenticateAsync(...args),
}));

describe('passkeys session', () => {
  beforeEach(async () => {
    platform.OS = 'ios';
    isDevBuild.mockReset();
    isDevBuild.mockReturnValue(false);
    getEnrolledLevelAsync.mockReset();
    authenticateAsync.mockReset();
    const session = await import('./session');
    session.setFaceIdEnabled(true);
  });

  it('skips Face ID when the production toggle is off', async () => {
    getEnrolledLevelAsync.mockResolvedValue(1);
    const { unlock, setFaceIdEnabled } = await import('./session');
    setFaceIdEnabled(false);
    await expect(unlock()).resolves.toBe(true);
    expect(authenticateAsync).not.toHaveBeenCalled();
    setFaceIdEnabled(true);
  });

  it('skips Face ID in a DEV build without calling the platform authenticator', async () => {
    isDevBuild.mockReturnValue(true);
    const { unlock, describeUnlock, DEV_SKIP_MESSAGE } = await import('./session');
    await expect(unlock()).resolves.toBe(true);
    expect(getEnrolledLevelAsync).not.toHaveBeenCalled();
    expect(authenticateAsync).not.toHaveBeenCalled();
    await expect(describeUnlock()).resolves.toEqual({
      kind: 'dev-skip',
      message: DEV_SKIP_MESSAGE,
    });
  });

  it('unlocks on web without calling the platform authenticator', async () => {
    platform.OS = 'web';
    const { unlock, describeUnlock } = await import('./session');
    await expect(unlock()).resolves.toBe(true);
    expect(getEnrolledLevelAsync).not.toHaveBeenCalled();
    expect(authenticateAsync).not.toHaveBeenCalled();
    await expect(describeUnlock()).resolves.toMatchObject({ kind: 'web-dev' });
  });

  it('unlocks when a lock screen is enrolled and authentication succeeds', async () => {
    getEnrolledLevelAsync.mockResolvedValue(1);
    authenticateAsync.mockResolvedValue({ success: true });
    const { unlock } = await import('./session');
    await expect(unlock()).resolves.toBe(true);
    expect(authenticateAsync).toHaveBeenCalledTimes(1);
    expect(authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: true }),
    );
  });

  it('falls back to device passcode when biometrics are unavailable', async () => {
    getEnrolledLevelAsync.mockResolvedValue(1);
    authenticateAsync
      .mockResolvedValueOnce({ success: false, error: 'not_available' })
      .mockResolvedValueOnce({ success: true });
    const { unlock } = await import('./session');
    await expect(unlock()).resolves.toBe(true);
    expect(authenticateAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });

  it('returns false when the user cancels', async () => {
    getEnrolledLevelAsync.mockResolvedValue(1);
    authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' });
    const { unlock } = await import('./session');
    await expect(unlock()).resolves.toBe(false);
  });

  it('throws when nothing is enrolled', async () => {
    getEnrolledLevelAsync.mockResolvedValue(0);
    const { unlock, describeUnlock, NOT_ENROLLED_MESSAGE } = await import('./session');
    await expect(unlock()).rejects.toThrow(NOT_ENROLLED_MESSAGE);
    expect(authenticateAsync).not.toHaveBeenCalled();
    await expect(describeUnlock()).resolves.toMatchObject({ kind: 'not-enrolled' });
  });

  it('does not unlock when the native authenticator throws', async () => {
    getEnrolledLevelAsync.mockResolvedValue(1);
    authenticateAsync.mockRejectedValue(new Error('keystore exploded'));
    const { unlock } = await import('./session');
    await expect(unlock()).rejects.toThrow('keystore exploded');
  });

  it('sends a locked Device tab to /unlock because (app) shares the / URL', async () => {
    const { sessionRedirect } = await import('./session');
    expect(sessionRedirect(false, '(app)')).toBe('/unlock');
    expect(sessionRedirect(false, 'seeds')).toBe('/unlock');
    expect(sessionRedirect(false, undefined)).toBe('/unlock');
    expect(sessionRedirect(false, 'unlock')).toBeNull();
    expect(sessionRedirect(true, 'unlock')).toBe('/(app)');
    expect(sessionRedirect(true, undefined)).toBe('/(app)');
    expect(sessionRedirect(true, '(app)')).toBeNull();
    expect(sessionRedirect(true, 'seeds')).toBeNull();
  });
});
