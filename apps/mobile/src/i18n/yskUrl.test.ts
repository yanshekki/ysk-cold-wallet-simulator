import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_LANGUAGES } from './translate';
import { isChineseUiLanguage, yskCwsProxyUrl, yskHomeUrl, yskUrl } from './yskUrl';

const CWS_PROXY_ZH = 'https://ysk.hk/products/cws-cold-wallet-simulator#cws-proxy';
const CWS_PROXY_EN = 'https://ysk.hk/en/products/cws-cold-wallet-simulator#cws-proxy';
const HOME_ZH = 'https://ysk.hk';
const HOME_EN = 'https://ysk.hk/en/';

describe('locale-aware ysk.hk URLs', () => {
  it('treats zh-HK and other zh* tags as Chinese UI', () => {
    expect(isChineseUiLanguage('zh-HK')).toBe(true);
    expect(isChineseUiLanguage('zh')).toBe(true);
    expect(isChineseUiLanguage('zh-CN')).toBe(true);
    expect(isChineseUiLanguage('zh_TW')).toBe(true);
    expect(isChineseUiLanguage('en')).toBe(false);
    expect(isChineseUiLanguage('ja')).toBe(false);
  });

  it('opens the Chinese product and home URLs for zh-HK', () => {
    expect(yskCwsProxyUrl('zh-HK')).toBe(CWS_PROXY_ZH);
    expect(yskHomeUrl('zh-HK')).toBe(HOME_ZH);
    expect(yskUrl('zh-HK', '/products/cws-cold-wallet-simulator#cws-proxy')).toBe(CWS_PROXY_ZH);
  });

  it('opens the English /en/ URLs for English and every other shipped locale', () => {
    expect(yskCwsProxyUrl('en')).toBe(CWS_PROXY_EN);
    expect(yskHomeUrl('en')).toBe(HOME_EN);
    for (const { id } of APP_LANGUAGES) {
      if (id === 'zh-HK') {
        expect(yskCwsProxyUrl(id)).toBe(CWS_PROXY_ZH);
        expect(yskHomeUrl(id)).toBe(HOME_ZH);
        continue;
      }
      expect(yskCwsProxyUrl(id), id).toBe(CWS_PROXY_EN);
      expect(yskHomeUrl(id), id).toBe(HOME_EN);
    }
  });

  it('keeps the #cws-proxy fragment on both locales', () => {
    expect(yskCwsProxyUrl('zh-HK').endsWith('#cws-proxy')).toBe(true);
    expect(yskCwsProxyUrl('en').endsWith('#cws-proxy')).toBe(true);
    expect(yskCwsProxyUrl('es')).not.toContain('#cws-proxy#');
  });
});

describe('Settings outbound link wiring', () => {
  it('uses the shared helper and current UI language, not a hardcoded ZH URL', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, '../../app/(app)/settings/index.tsx'),
      'utf8',
    );
    expect(source).toContain('useLanguage()');
    expect(source).toContain('yskCwsProxyUrl(language)');
    expect(source).toContain('yskHomeUrl(language)');
    expect(source).toContain('testID="settings-link-proxy"');
    expect(source).toContain('testID="settings-link-ysk"');
    expect(source).toContain('Linking.openURL');
    expect(source).toContain('variant="ghost"');
    expect(source).not.toContain("const CWS_PROXY_PAGE = 'https://ysk.hk/products/cws-cold-wallet-simulator#cws-proxy'");
    expect(source).not.toContain("const YSK_SITE = 'https://ysk.hk'");
  });
});
