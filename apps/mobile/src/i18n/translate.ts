import { ar } from './locales/ar';
import { de } from './locales/de';
import { en, type MessageTree } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { id } from './locales/id';
import { ja } from './locales/ja';
import { pt } from './locales/pt';
import { ru } from './locales/ru';
import { zhHK } from './locales/zh-HK';
import { resolvePlatformCopy } from './platformCopy';

export type { MessageTree };

export const APP_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'zh-HK', label: '繁體中文（香港）' },
  { id: 'es', label: 'Español' },
  { id: 'ar', label: 'العربية' },
  { id: 'pt', label: 'Português' },
  { id: 'id', label: 'Bahasa Indonesia' },
  { id: 'fr', label: 'Français' },
  { id: 'ja', label: '日本語' },
  { id: 'ru', label: 'Русский' },
  { id: 'de', label: 'Deutsch' },
] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number]['id'];

export function isAppLanguage(value: string): value is AppLanguage {
  return APP_LANGUAGES.some((entry) => entry.id === value);
}

export function isRtl(language: AppLanguage): boolean {
  return language === 'ar';
}

const DICTS: Record<AppLanguage, MessageTree> = {
  en,
  'zh-HK': zhHK,
  es,
  ar,
  pt,
  id,
  fr,
  ja,
  ru,
  de,
};

function lookup(tree: unknown, path: string, os: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = tree;
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return resolvePlatformCopy(current, os);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

export function translate(
  language: AppLanguage,
  key: string,
  vars?: Record<string, string | number>,
  os = 'default',
): string {
  const value = lookup(DICTS[language], key, os) ?? lookup(en, key, os) ?? key;
  return interpolate(value, vars);
}
