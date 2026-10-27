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

test.describe('CWS Proxy console', () => {
  test('given no logs, when Console is opened, then the waiting copy is shown', async ({ page }) => {
    await page.goto(mock.server.url);
    await page.getByTestId('tab-console').click();
    await expect(page.getByTestId('proxy-logs')).toContainText('Waiting for the host');
    await expect(page.getByTestId('log-badge')).toBeHidden();
  });

  test('given mixed log lines, when filters and search are used, then the visible set changes', async ({ page }) => {
    await page.goto(mock.server.url);
    mock.bus.log('ble scan found Nano X');
    mock.bus.log('hid IN 0000');
    mock.bus.log('gatt notify mtu=20');
    mock.bus.log('fail gadget busy');
    await expect(page.getByTestId('log-badge')).toHaveText('4');
    await page.getByTestId('tab-console').click();
    await page.getByTestId('log-filter-ble').click();
    await expect(page.getByTestId('proxy-logs')).toContainText('ble scan found');
    await expect(page.getByTestId('proxy-logs')).not.toContainText('hid IN');
    await page.getByTestId('log-filter-hid').click();
    await expect(page.getByTestId('proxy-logs')).toContainText('hid IN');
    await page.getByTestId('log-filter-gatt').click();
    await expect(page.getByTestId('proxy-logs')).toContainText('gatt notify');
    await page.getByTestId('log-filter-error').click();
    await expect(page.getByTestId('proxy-logs')).toContainText('fail gadget');
    await page.getByTestId('log-filter-all').click();
    await page.getByTestId('log-search').fill('Nano');
    await expect(page.getByTestId('log-count')).not.toHaveText('0/0');
    await page.getByTestId('log-wrap').click();
    await page.getByTestId('log-follow').click();
    await page.getByTestId('log-case').click();
    await page.getByTestId('log-regex').click();
    await page.getByTestId('log-font-up').click();
    await page.getByTestId('log-font-down').click();
  });

  test('given logs, when Clear is tapped, then the list returns to waiting', async ({ page }) => {
    await page.goto(mock.server.url);
    mock.bus.log('ble scan found');
    await page.getByTestId('tab-console').click();
    await page.getByTestId('log-clear').click();
    await expect(page.getByTestId('proxy-logs')).toContainText('Waiting for the host');
    await expect(page.getByTestId('log-badge')).toBeHidden();
  });
});
