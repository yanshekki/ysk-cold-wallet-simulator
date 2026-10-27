import { describe, expect, it } from 'vitest';
import { copyPlatform, isPlatformCopy, resolvePlatformCopy } from './platformCopy';

describe('platform copy maps', () => {
  it('selects ios and android leaves, and default for anything else', () => {
    expect(copyPlatform('ios')).toBe('ios');
    expect(copyPlatform('android')).toBe('android');
    expect(copyPlatform('web')).toBe('default');
    expect(copyPlatform('windows')).toBe('default');
  });

  it('resolves a platform map without treating ordinary objects as copy', () => {
    const map = {
      ios: 'Face ID / Touch ID',
      android: 'Biometrics',
      default: 'Biometrics',
    };
    expect(isPlatformCopy(map)).toBe(true);
    expect(resolvePlatformCopy(map, 'ios')).toBe('Face ID / Touch ID');
    expect(resolvePlatformCopy(map, 'android')).toBe('Biometrics');
    expect(resolvePlatformCopy(map, 'web')).toBe('Biometrics');
    expect(isPlatformCopy({ title: 'Settings' })).toBe(false);
    expect(resolvePlatformCopy({ title: 'Settings' }, 'ios')).toBeUndefined();
    expect(resolvePlatformCopy('plain', 'android')).toBe('plain');
  });
});
