import { expect, test, type Page } from '@playwright/test';
import { resetMock, startMockProxy, type MockProxy } from './harness';

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

async function openLab(page: Page): Promise<void> {
  await page.goto(mock.server.url);
  await page.getByTestId('tab-lab').click();
  await expect(page.getByTestId('lab-brand-ledger')).toBeVisible();
}

test.describe('CWS Proxy testnet host', () => {
  test('given idle proxy, when lab tab is opened, then catalogs are browsable and cases stay disabled', async ({
    page,
  }) => {
    await openLab(page);
    await expect(page.getByTestId('lab-action-dash-version')).toBeDisabled();
    await page.getByTestId('lab-brand-onekey').click();
    await expect(page.getByTestId('lab-action-ok-features')).toBeDisabled();
    await page.getByTestId('lab-brand-trezor').click();
    await expect(page.getByTestId('lab-action-tz-features')).toBeDisabled();
    await page.getByTestId('lab-brand-ledger').click();
    await page.getByTestId('lab-section-ethereum').click();
    await expect(page.getByTestId('lab-action-eth-garbage')).toBeDisabled();
    await page.getByTestId('lab-section-near').click();
    await expect(page.getByTestId('lab-faucet')).toBeVisible();
    await expect(page.getByTestId('lab-faucet')).toHaveAttribute(
      'href',
      'https://testnet.help/en/nearfaucet/testnet',
    );
  });

  test('given English UI, when 繁 is tapped, then the lab tab is 測試網主機', async ({ page }) => {
    await page.goto(mock.server.url);
    await expect(page.getByTestId('tab-lab')).toHaveText('Testnet host');
    await page.getByTestId('lang-zh').click();
    await expect(page.getByTestId('tab-lab')).toHaveText('測試網主機');
    await expect(page.getByTestId('tab-proxy')).toHaveText('代理');
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('tab-lab')).toHaveText('Testnet host');
  });

  test('given a GATT-ready mock, when GET_VERSION is tapped, then the result is shown', async ({ page }) => {
    await page.goto(mock.server.url);
    await page.getByTestId('proxy-power').click();
    await page.getByTestId('tab-lab').click();
    await expect(page.getByTestId('lab-action-dash-version')).toBeEnabled();
    await page.getByTestId('lab-action-dash-version').click();
    await expect(page.getByTestId('lab-result')).toContainText('0x33010400');
  });

  test('given a GATT-ready mock, when personal_sign is tapped, then the editor opens', async ({ page }) => {
    await page.goto(mock.server.url);
    await page.getByTestId('proxy-power').click();
    await page.getByTestId('tab-lab').click();
    await expect(page.getByTestId('lab-action-dash-version')).toBeEnabled();
    await page.getByTestId('lab-section-ethereum').click();
    await page.getByTestId('lab-action-eth-personal').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('lab-action-eth-personal')).toBeEnabled();
    await page.getByTestId('lab-action-eth-personal').click();
    await expect(page.getByTestId('lab-run')).toBeVisible();
    await expect(page.getByTestId('lab-field-utf8')).toBeVisible();
    await page.getByTestId('lab-close').click();
    await expect(page.getByTestId('lab-run')).toBeHidden();
  });
});
