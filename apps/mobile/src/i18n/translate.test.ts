import { describe, expect, it } from 'vitest';
import { APP_LANGUAGES, translate, type AppLanguage } from './translate';

const AUTH_KEYS = [
  'settings.faceId',
  'settings.signReauthHelp',
  'unlock.fallback',
  'unlock.enrolled',
  'privacy.onDeviceBody',
] as const;

const LANGUAGES = APP_LANGUAGES.map((entry) => entry.id);

function allAuthCopy(os: string): Array<{ language: AppLanguage; key: (typeof AUTH_KEYS)[number]; text: string }> {
  return LANGUAGES.flatMap((language) =>
    AUTH_KEYS.map((key) => ({ language, key, text: translate(language, key, undefined, os) })),
  );
}

describe('platform-aware authenticator copy', () => {
  it('keeps existing string keys working', () => {
    expect(translate('en', 'tabs.device', undefined, 'android')).toBe('Device');
    expect(translate('zh-HK', 'unlock.button', undefined, 'android')).toBe('解鎖');
    expect(translate('zh-HK', 'common.cancel', undefined, 'android')).toBe('取消');
    expect(translate('en', 'vault.authPrompt', { n: 1 }, 'ios')).toBe('Unlock');
  });

  it('uses Face ID and Touch ID on iOS for EN and zh-HK', () => {
    expect(translate('en', 'settings.faceId', undefined, 'ios')).toBe('Face ID / Touch ID');
    expect(translate('en', 'unlock.fallback', undefined, 'ios')).toContain('Face ID');
    expect(translate('en', 'unlock.fallback', undefined, 'ios')).toContain('Touch ID');
    expect(translate('zh-HK', 'settings.faceId', undefined, 'ios')).toBe('Face ID／Touch ID');
    expect(translate('zh-HK', 'settings.signReauthHelp', undefined, 'ios')).toContain('Touch ID');
    expect(translate('zh-HK', 'privacy.onDeviceBody', undefined, 'ios')).toContain('Face ID');
    expect(translate('zh-HK', 'privacy.onDeviceBody', undefined, 'ios')).toContain('Touch ID');
  });

  it('does not say Face ID on Android in any locale', () => {
    for (const row of allAuthCopy('android')) {
      expect(row.text, `${row.language} ${row.key}`).not.toMatch(/Face ID/);
      expect(row.text, `${row.language} ${row.key}`).not.toBe(`${row.key}`);
    }
    expect(translate('en', 'settings.faceId', undefined, 'android')).toBe('Biometrics');
    expect(translate('en', 'unlock.fallback', undefined, 'android')).toContain('fingerprint');
    expect(translate('zh-HK', 'settings.faceId', undefined, 'android')).toBe('生物識別');
    expect(translate('zh-HK', 'unlock.fallback', undefined, 'android')).toContain('指紋');
    expect(translate('zh-HK', 'privacy.onDeviceBody', undefined, 'android')).toContain('生物識別');
  });

  it('does not say Face ID on web or other non-Apple platforms', () => {
    for (const os of ['web', 'windows', 'macos', 'default']) {
      for (const row of allAuthCopy(os)) {
        expect(row.text, `${os} ${row.language} ${row.key}`).not.toMatch(/Face ID/);
      }
    }
    expect(translate('en', 'unlock.enrolled', undefined, 'web')).toBe('Biometrics or device passcode.');
  });
});
