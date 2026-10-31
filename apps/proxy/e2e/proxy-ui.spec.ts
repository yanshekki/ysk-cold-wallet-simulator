import { expect, test, type Page } from '@playwright/test';
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

  test('given English UI, when 繁 is chosen, then the lab tab is 測試網主機', async ({ page }) => {
    await page.goto(mock.server.url);
    await expectProxyTabs(page, 'en');
    await setProxyLang(page, 'zh-HK');
    await expectProxyTabs(page, 'zh-HK');
    await setProxyLang(page, 'en');
    await expectProxyTabs(page, 'en');
  });

  test('given a GATT-ready mock, when GET_VERSION is tapped, then the result is shown', async ({ page }) => {
    await page.goto(mock.server.url);
    await page.getByTestId('proxy-power').click();
    await page.getByTestId('tab-lab').click();
    await expect(page.getByTestId('lab-action-dash-version')).toBeEnabled();
    await page.getByTestId('lab-action-dash-version').click();
    await expect(page.getByTestId('lab-result')).toContainText('0x33010400');
  });

  test('given two nearby phones, when one is picked, then the proxy locks that id', async ({ page }) => {
    await page.goto(mock.server.url);
    await page.getByTestId('lang-select').selectOption('en');
    mock.bus.patch({
      running: true,
      phase: 'scanning',
      phoneName: '',
      locked: false,
      targetId: null,
      targetName: '',
      nearby: [
        {
          id: 'AAA-111',
          name: 'Nano X A',
          rssi: -61,
          services: [],
          brand: 'ledger',
          modelId: 'nano-x',
          modelName: 'Nano X',
        },
        {
          id: 'BBB-222',
          name: 'Pro 2 B',
          rssi: -88,
          services: [],
          brand: 'onekey',
          modelId: 'pro2',
          modelName: 'Pro 2',
        },
      ],
    });
    await expect(page.getByTestId('ble-pick-AAA-111')).toBeVisible();
    await expect(page.getByTestId('ble-pick-BBB-222')).toBeVisible();
    await expect(page.getByTestId('ble-pick-AAA-111')).toContainText('Nano X A');
    await expect(page.getByTestId('ble-pick-AAA-111')).toContainText('AAA-111');
    await expect(page.getByTestId('ble-pick-AAA-111')).toContainText('-61 dBm');
    await expect(page.getByTestId('proxy-lock')).toHaveText('Unlocked');
    await page.getByTestId('ble-rescan').click();
    await expect.poll(() => mock.rescans).toBe(1);
    await page.getByTestId('ble-pick-AAA-111').click();
    await expect.poll(() => mock.selectedId).toBe('AAA-111');
    await expect(page.getByTestId('proxy-lock')).toHaveText('Locked');
    await expect(page.getByTestId('proxy-target')).toContainText('Nano X A');
    await expect(page.getByTestId('proxy-target')).toContainText('AAA-111');
    await expect(page.getByTestId('ble-pick-AAA-111')).toBeDisabled();
    await page.getByTestId('ble-unlock').click();
    await expect.poll(() => mock.selectedId).toBeNull();
    await expect(page.getByTestId('proxy-lock')).toHaveText('Unlocked');
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
