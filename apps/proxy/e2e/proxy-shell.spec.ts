import { expect, test } from '@playwright/test';
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
    await page.getByTestId('lang-zh').click();
    await page.reload();
    await expect(page.getByTestId('tab-lab')).toHaveText('測試網主機');
    await page.getByTestId('lang-en').click();
  });

  test('given native=1, when the page loads, then the native-shell class is applied', async ({ page }) => {
    await page.goto(`${mock.server.url}/?native=1`);
    await expect(page.locator('html')).toHaveClass(/native-shell/);
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
