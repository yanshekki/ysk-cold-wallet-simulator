import type { AppLanguage } from './translate';

const YSK_ORIGIN = 'https://ysk.hk';

/** zh-HK today; any other zh* tag if a locale is added later. */
export function isChineseUiLanguage(language: string): boolean {
  return language === 'zh-HK' || /^zh(?:[-_]|$)/i.test(language);
}

/**
 * Localize a ysk.hk path for the current UI language.
 * Chinese: https://ysk.hk{path}{hash}
 * English and every other locale: https://ysk.hk/en{path}{hash} (homepage is /en/).
 */
export function yskUrl(language: AppLanguage | string, pathAndHash: string): string {
  const hashIndex = pathAndHash.indexOf('#');
  const hash = hashIndex === -1 ? '' : pathAndHash.slice(hashIndex);
  let path = hashIndex === -1 ? pathAndHash : pathAndHash.slice(0, hashIndex);
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  if (path === '/') {
    return `${YSK_ORIGIN}${isChineseUiLanguage(language) ? '' : '/en/'}${hash}`;
  }
  const localized = isChineseUiLanguage(language) ? path : `/en${path}`;
  return `${YSK_ORIGIN}${localized}${hash}`;
}

export function yskHomeUrl(language: AppLanguage | string): string {
  return yskUrl(language, '/');
}

export function yskCwsProxyUrl(language: AppLanguage | string): string {
  return yskUrl(language, '/products/cws-cold-wallet-simulator#cws-proxy');
}
