import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { OS: 'ios' };
const getEnrolledLevelAsync = vi.fn();
const authenticateAsync = vi.fn();

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
  beforeEach(() => {
    platform.OS = 'ios';
    getEnrolledLevelAsync.mockReset();
    authenticateAsync.mockReset();
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
});
