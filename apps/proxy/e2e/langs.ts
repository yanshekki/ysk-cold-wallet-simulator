import { expect, type Page } from '@playwright/test';

export const PROXY_TAB_COPY = {
  en: { proxy: 'Proxy', lab: 'Testnet host', console: 'Console' },
  'zh-HK': { proxy: '代理', lab: '測試網主機', console: '紀錄' },
  es: { proxy: 'Proxy', lab: 'Host de testnet', console: 'Consola' },
  ar: { proxy: 'الوكيل', lab: 'مضيف الشبكة التجريبية', console: 'وحدة التحكم' },
  pt: { proxy: 'Proxy', lab: 'Host de testnet', console: 'Console' },
  id: { proxy: 'Proksi', lab: 'Host testnet', console: 'Konsol' },
  fr: { proxy: 'Proxy', lab: 'Hôte testnet', console: 'Console' },
  ja: { proxy: 'プロキシ', lab: 'テストネットホスト', console: 'コンソール' },
  ru: { proxy: 'Прокси', lab: 'Хост тестнета', console: 'Консоль' },
  de: { proxy: 'Proxy', lab: 'Testnet-Host', console: 'Konsole' },
} as const;

export type ProxyE2eLang = keyof typeof PROXY_TAB_COPY;

export async function setProxyLang(page: Page, id: ProxyE2eLang): Promise<void> {
  await page.getByTestId('lang-select').selectOption(id);
}

export async function expectProxyTabs(page: Page, id: ProxyE2eLang): Promise<void> {
  const copy = PROXY_TAB_COPY[id];
  await expect(page.getByTestId('tab-proxy')).toHaveText(copy.proxy);
  await expect(page.getByTestId('tab-lab')).toHaveText(copy.lab);
  await expect(page.getByTestId('tab-console')).toContainText(copy.console);
  await expect(page.locator('html')).toHaveAttribute('dir', id === 'ar' ? 'rtl' : 'ltr');
}
