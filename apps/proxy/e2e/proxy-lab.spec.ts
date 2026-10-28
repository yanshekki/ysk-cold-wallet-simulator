import { expect, test, type Page } from '@playwright/test';
import { labCatalogFor } from '../src/lab';
import { resetMock, startMockProxy, type MockProxy } from './harness';
import { expectProxyTabs, setProxyLang } from './langs';

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

async function startLab(page: Page): Promise<void> {
  await page.goto(mock.server.url);
  await page.getByTestId('proxy-power').click();
  await page.getByTestId('tab-lab').click();
  await expect(page.getByTestId('lab-action-dash-version')).toBeEnabled();
}

test.describe('CWS Proxy catalog', () => {
  test('given idle catalog, when every brand and section is opened, then every action id is rendered disabled', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(mock.server.url);
    await page.getByTestId('tab-lab').click();
    for (const brand of ['ledger', 'onekey', 'trezor'] as const) {
      await page.getByTestId(`lab-brand-${brand}`).click();
      const catalog = labCatalogFor(brand, false, null);
      for (const section of catalog.sections) {
        await page.getByTestId(`lab-section-${section.id}`).click();
        for (const action of section.actions) {
          const button = page.getByTestId(`lab-action-${action.id}`);
          await button.scrollIntoViewIfNeeded();
          await expect(button).toBeVisible();
          await expect(button).toBeDisabled();
        }
      }
    }
  });

  test('given a Ledger GATT session, when another brand is selected, then the brand chips stay locked', async ({
    page,
  }) => {
    await startLab(page);
    await expect(page.getByTestId('lab-brand-ledger')).toBeEnabled();
    await expect(page.getByTestId('lab-brand-onekey')).toBeDisabled();
    await expect(page.getByTestId('lab-brand-trezor')).toBeDisabled();
  });

  test('given GET_VERSION, when Stop is tapped, then cases disable again', async ({ page }) => {
    await startLab(page);
    await page.getByTestId('proxy-power').click();
    await expect(page.getByTestId('lab-action-dash-version')).toBeDisabled();
  });

  test('given OPEN_APP, when the utf8 editor runs, then the draft is posted', async ({ page }) => {
    await startLab(page);
    await page.getByTestId('lab-action-dash-open-eth').click();
    await expect(page.getByTestId('lab-field-utf8')).toBeVisible();
    await expect(page.getByTestId('lab-field-path')).toBeHidden();
    await page.getByTestId('lab-field-utf8').fill('Bitcoin');
    await page.getByTestId('lab-run').click();
    await expect(page.getByTestId('lab-result')).toContainText('app:Bitcoin');
    expect(mock.lastLab).toMatchObject({ actionId: 'dash-open-eth', draft: { utf8: 'Bitcoin' } });
  });

  test('given GET_ADDRESS, when the path editor runs, then only path is shown', async ({ page }) => {
    await startLab(page);
    await page.getByTestId('lab-section-ethereum').click();
    await page.getByTestId('lab-action-eth-addr').scrollIntoViewIfNeeded();
    await page.getByTestId('lab-action-eth-addr').click();
    await expect(page.getByTestId('lab-field-path')).toBeVisible();
    await expect(page.getByTestId('lab-field-utf8')).toBeHidden();
    await page.getByTestId('lab-field-path').fill("m/44'/60'/0'/0/1");
    await page.getByTestId('lab-run').click();
    await expect(page.getByTestId('lab-result')).toContainText("path:m/44'/60'/0'/0/1");
  });

  test('given personal_sign binary, when hex is edited, then the hex draft is posted', async ({ page }) => {
    await startLab(page);
    await page.getByTestId('lab-section-ethereum').click();
    await page.getByTestId('lab-action-eth-personal-bin').scrollIntoViewIfNeeded();
    await page.getByTestId('lab-action-eth-personal-bin').click();
    await expect(page.getByTestId('lab-field-hex')).toBeVisible();
    await page.getByTestId('lab-field-hex').fill('deadbeef');
    await page.getByTestId('lab-run').click();
    await expect(page.getByTestId('lab-result')).toContainText('hex:deadbeef');
  });

  test('given 繁 UI, when dashboard is shown, then GET_VERSION is 讀取版本', async ({ page }) => {
    await page.goto(mock.server.url);
    await setProxyLang(page, 'zh-HK');
    await expectProxyTabs(page, 'zh-HK');
    await page.getByTestId('tab-lab').click();
    await expect(page.getByTestId('lab-action-dash-version')).toContainText('讀取版本');
  });

  test('given personal_sign, when the modal backdrop is unused and Close is tapped, then no run is posted', async ({
    page,
  }) => {
    await startLab(page);
    await page.getByTestId('lab-section-ethereum').click();
    await page.getByTestId('lab-action-eth-personal').scrollIntoViewIfNeeded();
    await page.getByTestId('lab-action-eth-personal').click();
    await page.getByTestId('lab-close').click();
    expect(mock.lastLab).toBeNull();
  });
});
