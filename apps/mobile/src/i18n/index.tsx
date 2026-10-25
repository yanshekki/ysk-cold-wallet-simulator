import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en, type MessageTree } from './en';
import { zhHK } from './zh-HK';

export type AppLanguage = 'en' | 'zh-HK';

type Dict = MessageTree;

const DICTS: Record<AppLanguage, Dict> = {
  en,
  'zh-HK': zhHK,
};

function lookup(tree: unknown, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = tree;
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

export function translate(language: AppLanguage, key: string, vars?: Record<string, string | number>): string {
  const value = lookup(DICTS[language], key) ?? lookup(en, key) ?? key;
  return interpolate(value, vars);
}

type I18nValue = {
  language: AppLanguage;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue>({
  language: 'en',
  t: (key, vars) => translate('en', key, vars),
});

export function I18nProvider({
  language,
  children,
}: {
  language: AppLanguage;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({
      language,
      t: (key, vars) => translate(language, key, vars),
    }),
    [language],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue['t'] {
  return useContext(I18nContext).t;
}

export function useLanguage(): AppLanguage {
  return useContext(I18nContext).language;
}
