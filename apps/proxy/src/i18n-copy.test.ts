import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE_LANGS = ['en', 'zh-HK', 'es', 'ar', 'pt', 'id', 'fr', 'ja', 'ru', 'de'] as const;

type ProxyCopy = Record<string, Record<string, string>>;
type ProxyLang = { id: string; short: string; label: string };

function loadI18n(language = 'en-US', stored: string | null = null) {
  const src = readFileSync(join(ROOT, 'ui/i18n.js'), 'utf8');
  const store: Record<string, string> = {};
  if (stored) {
    store['cws-proxy-lang'] = stored;
  }
  const sandbox = {
    localStorage: {
      getItem(key: string) {
        return store[key] ?? null;
      },
      setItem(key: string, value: string) {
        store[key] = value;
      },
    },
    navigator: { language },
  };
  const context = createContext(sandbox);
  runInContext(src, context);
  return runInContext('({ PROXY_LANGS, COPY, loadLang, isProxyLang })', context) as {
    PROXY_LANGS: ProxyLang[];
    COPY: ProxyCopy;
    loadLang: () => string;
    isProxyLang: (value: string) => boolean;
  };
}

describe('proxy i18n copy', () => {
  it('covers every mobile language with the same chrome keys as English', () => {
    const { PROXY_LANGS, COPY } = loadI18n();
    expect(PROXY_LANGS.map((entry) => entry.id)).toEqual([...MOBILE_LANGS]);
    expect(Object.keys(COPY)).toEqual([...MOBILE_LANGS]);

    const en = COPY.en;
    expect(en).toBeTruthy();
    const keys = Object.keys(en);
    expect(keys).toContain('lang');
    expect(keys).toContain('tabProxy');
    expect(keys).toContain('tabLab');
    expect(keys).toContain('nativeMissing');

    for (const id of MOBILE_LANGS) {
      const locale = COPY[id];
      expect(Object.keys(locale), id).toEqual(keys);
      for (const key of keys) {
        const value = locale[key];
        expect(value, `${id}.${key}`).toEqual(expect.any(String));
        expect(value.trim(), `${id}.${key} empty`).not.toBe('');
        if (en[key] !== key) {
          expect(value, `${id}.${key} leftover key`).not.toBe(key);
        }
      }
    }
  });

  it('uses written Chinese for zh-HK and keeps 繁體中文（香港） in the picker', () => {
    const { PROXY_LANGS, COPY } = loadI18n();
    const hk = PROXY_LANGS.find((entry) => entry.id === 'zh-HK');
    expect(hk?.label).toBe('繁體中文（香港）');
    expect(COPY['zh-HK']?.tabProxy).toBe('代理');
    expect(COPY['zh-HK']?.tabLab).toBe('測試網主機');
    expect(COPY['zh-HK']?.tabConsole).toBe('紀錄');
    expect(COPY['zh-HK']?.lang).toBe('語言');
    expect(JSON.stringify(COPY['zh-HK'])).not.toMatch(/[简证网]/);
  });

  it('lists every locale on the language select', () => {
    const html = readFileSync(join(ROOT, 'ui/index.html'), 'utf8');
    const { PROXY_LANGS } = loadI18n();
    for (const entry of PROXY_LANGS) {
      expect(html).toContain(`value="${entry.id}"`);
      expect(html).toContain(entry.label);
    }
  });

  it('prefers stored language, then navigator, then English', () => {
    expect(loadI18n('fr-FR', 'ja').loadLang()).toBe('ja');
    expect(loadI18n('zh-HK').loadLang()).toBe('zh-HK');
    expect(loadI18n('zh-TW').loadLang()).toBe('zh-HK');
    expect(loadI18n('zh-CN').loadLang()).toBe('zh-HK');
    expect(loadI18n('es-MX').loadLang()).toBe('es');
    expect(loadI18n('pt-BR').loadLang()).toBe('pt');
    expect(loadI18n('ar-SA').loadLang()).toBe('ar');
    expect(loadI18n('ko-KR').loadLang()).toBe('en');
    expect(loadI18n('en-US', 'nope').loadLang()).toBe('en');
  });
});
