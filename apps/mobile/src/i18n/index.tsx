import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { translate as translateMessage, type AppLanguage } from './translate';

export type { MessageTree } from './translate';
export { APP_LANGUAGES, isAppLanguage, isRtl, type AppLanguage } from './translate';

export function translate(
  language: AppLanguage,
  key: string,
  vars?: Record<string, string | number>,
  os: string = Platform.OS,
): string {
  return translateMessage(language, key, vars, os);
}

type I18nValue = {
  language: AppLanguage;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue>({
  language: 'en',
  t: (key, vars) => translate('en', key, vars, Platform.OS),
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
      t: (key, vars) => translate(language, key, vars, Platform.OS),
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
