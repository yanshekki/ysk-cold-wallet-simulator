import { expect, test, type Page } from '@playwright/test';
import { resetMock, startMockProxy, type MockProxy } from './harness';
import { expectProxyTabs, PROXY_TAB_COPY, setProxyLang, type ProxyE2eLang } from './langs';

let mock: MockProxy;

test.beforeAll(async () => {
  mock = await startMockProxy();
});

test.afterEach(() => {
  resetMock(mock);
});

test.afterAll(async () => {
  await mock.server.close();
});

async function langControlFit(page: Page): Promise<{
  pastContent: number;
  pastPhone: number;
  selectWidth: number;
  textWidth: number;
  titleGap: number;
  edgesHitSelect: boolean;
}> {
  return page.evaluate(() => {
    const phone = document.querySelector('.phone')!.getBoundingClientRect();
    const screen = document.querySelector('#pane-proxy')!;
    const screenBox = screen.getBoundingClientRect();
    const style = getComputedStyle(screen);
    const contentLeft = screenBox.left + parseFloat(style.paddingLeft);
    const contentRight = screenBox.right - parseFloat(style.paddingRight);
    const select = document.querySelector('#lang-select') as HTMLSelectElement;
    const selectBox = select.getBoundingClientRect();
    const label = document.querySelector('.lang-label')!.getBoundingClientRect();
    const title = document.querySelector('.top > div')!.getBoundingClientRect();
    const probe = document.createElement('span');
    probe.style.font = getComputedStyle(select).font;
    probe.style.whiteSpace = 'nowrap';
    probe.textContent = select.selectedOptions[0]?.textContent ?? '';
    document.body.appendChild(probe);
    const textWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const midY = selectBox.top + selectBox.height / 2;
    const edgesHitSelect = [selectBox.left + 2, selectBox.right - 2].every((x) => {
      const hit = document.elementFromPoint(x, midY);
      return hit === select || (!!hit && select.contains(hit));
    });
    const titleGap =
      document.documentElement.dir === 'rtl' ? title.left - label.right : label.left - title.right;
    return {
      pastContent: Math.max(
        contentLeft - selectBox.left,
        selectBox.right - contentRight,
        contentLeft - label.left,
        label.right - contentRight,
      ),
      pastPhone: Math.max(
        phone.left - selectBox.left,
        selectBox.right - phone.right,
        phone.left - label.left,
        label.right - phone.right,
      ),
      selectWidth: selectBox.width,
      textWidth,
      titleGap,
      edgesHitSelect,
    };
  });
}

test.describe('CWS Proxy shell', () => {
  test('given idle proxy, when the page loads, then HUD is idle and pairing is hidden', async ({ page }) => {
    await page.goto(mock.server.url);
    await expect(page.getByTestId('tab-proxy')).toHaveText('Proxy');
    await expect(page.getByTestId('proxy-clock')).toHaveText('IDLE');
    await expect(page.getByTestId('proxy-radio')).toHaveText('IDLE');
    await expect(page.getByTestId('proxy-host')).toHaveText('NO PHONE');
    await expect(page.getByTestId('proxy-power')).toHaveText('Start');
    await expect(page.getByTestId('proxy-pairing')).toBeHidden();
    await expect(page.getByTestId('proxy-hid')).toHaveText('idle');
  });

  test('given idle proxy, when Start then Stop are tapped, then radio follows GATT then IDLE', async ({ page }) => {
    await page.goto(mock.server.url);
    await page.getByTestId('proxy-power').click();
    await expect(page.getByTestId('proxy-radio')).toHaveText('HID');
    await expect(page.getByTestId('proxy-host')).toHaveText('Nano X');
    await expect(page.getByTestId('proxy-model')).toHaveText('Nano X');
    await expect(page.getByTestId('proxy-chip')).toBeVisible();
    await expect(page.getByTestId('proxy-power')).toHaveText('Stop');
    await page.getByTestId('proxy-power').click();
    await expect(page.getByTestId('proxy-radio')).toHaveText('IDLE');
    await expect(page.getByTestId('proxy-power')).toHaveText('Start');
  });

  test('given GATT up, when pairing is requested, then a 6-digit code can be submitted', async ({ page }) => {
    await page.goto(mock.server.url);
    await page.getByTestId('proxy-power').click();
    const pending = mock.pairing.wait();
    mock.bus.patch({ pairing: true });
    await expect(page.getByTestId('proxy-pairing')).toBeVisible();
    await page.getByTestId('pairing-code').fill('654321');
    await page.getByTestId('pairing-submit').click();
    await expect(pending).resolves.toBe('654321');
  });

  test('given HID failure, when status is patched, then the error is shown', async ({ page }) => {
    await page.goto(mock.server.url);
    mock.bus.patch({ hid: 'failed', hidError: 'gadget busy' });
    await expect(page.getByTestId('proxy-hid-error')).toHaveText('gadget busy');
    await expect(page.getByTestId('proxy-hid')).toHaveText('failed');
  });

  test('given Trezor Suite, when trezord is advertised, then the trezord row is shown', async ({ page }) => {
    await page.goto(mock.server.url);
    mock.bus.patch({ trezord: '127.0.0.1:21325' });
    await expect(page.getByTestId('proxy-trezord-row')).toBeVisible();
  });

  test('given English UI, when 繁 is set and the page reloads, then language persists', async ({ page }) => {
    await page.goto(mock.server.url);
    await setProxyLang(page, 'zh-HK');
    await page.reload();
    await expectProxyTabs(page, 'zh-HK');
    await setProxyLang(page, 'en');
    await expectProxyTabs(page, 'en');
  });

  test('given the language select, when every mobile locale is chosen, then chrome copy is complete', async ({
    page,
  }) => {
    await page.goto(mock.server.url);
    for (const id of Object.keys(PROXY_TAB_COPY) as Array<keyof typeof PROXY_TAB_COPY>) {
      await setProxyLang(page, id);
      await expectProxyTabs(page, id);
      await expect(page.getByTestId('lang-label')).not.toHaveText('Lang');
      await expect(page.getByTestId('lang-label')).not.toHaveText('lang');
    }
  });

  test('given native=1, when the page loads, then the native-shell class is applied', async ({ page }) => {
    await page.goto(`${mock.server.url}/?native=1`);
    await expect(page.locator('html')).toHaveClass(/native-shell/);
  });

  test('given desktop and phone widths, when each locale is selected, then the language control stays inside the panel', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(mock.server.url);
      await expect(page.getByTestId('lang-select').locator('option')).toHaveCount(10);
      for (const id of Object.keys(PROXY_TAB_COPY) as ProxyE2eLang[]) {
        await setProxyLang(page, id);
        const fit = await langControlFit(page);
        expect(fit.pastContent, `${viewport.width}px ${id}`).toBeLessThanOrEqual(0.5);
        expect(fit.pastPhone, `${viewport.width}px ${id}`).toBeLessThanOrEqual(0.5);
        expect(fit.titleGap, `${viewport.width}px ${id}`).toBeGreaterThanOrEqual(0);
        expect(fit.selectWidth, `${viewport.width}px ${id}`).toBeGreaterThanOrEqual(fit.textWidth + 20);
        expect(fit.edgesHitSelect, `${viewport.width}px ${id}`).toBe(true);
      }
    }
  });

  test('given a phone viewport, when tabs are tapped, then Proxy / Testnet host / Console remain reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(mock.server.url);
    await page.getByTestId('tab-lab').click();
    await expect(page.getByTestId('lab-brand-ledger')).toBeVisible();
    await page.getByTestId('tab-console').click();
    await expect(page.getByTestId('log-filter-all')).toBeVisible();
    await page.getByTestId('tab-proxy').click();
    await expect(page.getByTestId('proxy-card')).toBeVisible();
  });
});

test.describe('CWS Proxy native-missing', () => {
  test('given a build without native BLE, when the page loads, then the missing-native error is shown', async ({
    page,
  }) => {
    const broken = await startMockProxy(false);
    try {
      await page.goto(broken.server.url);
      await expect(page.getByTestId('proxy-phase')).toContainText('Native Bluetooth');
    } finally {
      await broken.server.close();
    }
  });
});
