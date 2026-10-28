import { afterEach, describe, expect, it } from 'vitest';
import { startUiServer, type UiServer } from './http';
import { createPairingGate } from './pairing';
import { createStatusBus } from './status';

async function readSseFrame(url: string): Promise<string> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (!response.body) {
    throw new Error('no body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!buffer.includes('\n\n')) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
  }
  controller.abort();
  return buffer;
}

describe('proxy ui http', () => {
  let server: UiServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('serves the control page and start/stop/pairing', async () => {
    const bus = createStatusBus();
    const pairing = createPairingGate();
    const codes: string[] = [];
    const pending = pairing.wait().then((code) => {
      codes.push(code);
    });
    let started = 0;
    let stopped = 0;
    server = await startUiServer({
      bus,
      pairing,
      commands: {
        start() {
          started += 1;
          bus.patch({ running: true, phase: 'scanning' });
        },
        stop() {
          stopped += 1;
          bus.idle();
        },
        labCatalog(requested) {
          return {
            ready: false,
            brand: requested ?? 'ledger',
            connectedBrand: null,
            nearFaucet: 'https://testnet.help/en/nearfaucet/testnet',
            sections: [
              {
                id: 'dashboard',
                actions: [{ id: 'dash-version', section: 'dashboard', en: 'GET_VERSION', zh: '讀取版本' }],
              },
            ],
          };
        },
        setOpenAppName() {
          return;
        },
        async runLab(actionId) {
          if (actionId === 'dash-version') {
            return '0x3300';
          }
          throw new Error('Start the proxy and wait for GATT');
        },
      },
      port: 0,
    });
    const page = await fetch(server.url);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('CWS Proxy');
    expect(html).toContain('id="power"');
    expect(html).not.toContain('id="start"');
    expect(html).not.toContain('id="stop"');
    expect(html).toContain('id="tab-lab"');
    expect(html).toContain('id="lab-brands"');
    expect(html).toContain('data-testid="lab-faucet"');
    expect(html).toContain('id="tab-console"');
    expect(html).toContain('id="lang-select"');
    expect(html).toContain('/i18n.js');
    expect(html).toContain('id="logs"');

    const i18n = await fetch(`${server.url}/i18n.js`);
    const copy = await i18n.text();
    expect(i18n.status).toBe(200);
    expect(copy).toContain('Testnet host');
    expect(copy).toContain('測試網主機');
    expect(copy).toContain('Host de testnet');
    expect(copy).toContain('テストネットホスト');
    expect(copy).toContain('id: "es"');
    expect(copy).toContain('id: "de"');
    expect(copy).toContain('labRunning');

    const script = await fetch(`${server.url}/app.js`);
    const js = await script.text();
    expect(js).toContain('bindPower');
    expect(js).toContain('lang-select');
    expect(js).toContain("post(state.status?.running ? '/stop' : '/start')");
    expect(js).not.toContain("$('clock').textContent = 'IDLE'");

    const css = await fetch(`${server.url}/styles.css`);
    const styles = await css.text();
    expect(styles).toContain('.dock .danger');
    expect(styles).toContain('#ff5c7a');
    expect(styles).toContain('html.native-shell .dock');
    expect(js).toContain("get('native')");

    const idleStatus = await fetch(`${server.url}/status`);
    expect(idleStatus.status).toBe(200);
    expect(await idleStatus.json()).toMatchObject({ running: false, phase: 'idle' });

    const catalog = await fetch(`${server.url}/lab/catalog`);
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({
      ready: false,
      brand: 'ledger',
      connectedBrand: null,
      sections: [{ id: 'dashboard', actions: [{ id: 'dash-version' }] }],
    });

    const onekeyCatalog = await fetch(`${server.url}/lab/catalog?brand=onekey`);
    expect(await onekeyCatalog.json()).toMatchObject({ brand: 'onekey' });

    const start = await fetch(`${server.url}/start`, { method: 'POST' });
    expect(start.status).toBe(200);
    expect(started).toBe(1);
    expect(bus.snapshot().running).toBe(true);
    expect(bus.snapshot().radio).toBe('SCAN');

    const liveStatus = await fetch(`${server.url}/status`);
    expect(await liveStatus.json()).toMatchObject({ running: true, phase: 'scanning' });

    const frame = await readSseFrame(`${server.url}/events`);
    expect(frame).toContain('data:');
    expect(frame).toContain('"running":true');

    const stop = await fetch(`${server.url}/stop`, { method: 'POST' });
    expect(stop.status).toBe(200);
    expect(stopped).toBe(1);
    expect(bus.snapshot().running).toBe(false);

    bus.log('keep me');
    const cleared = await fetch(`${server.url}/logs/clear`, { method: 'POST' });
    expect(cleared.status).toBe(200);
    expect(bus.snapshot().logs).toEqual([]);

    const labRun = await fetch(`${server.url}/lab/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: 'dash-version' }),
    });
    expect(labRun.status).toBe(200);
    expect(await labRun.json()).toEqual({ ok: true, result: '0x3300' });

    const labMissing = await fetch(`${server.url}/lab/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(labMissing.status).toBe(400);

    const pair = await fetch(`${server.url}/pairing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
    expect(pair.status).toBe(200);
    await pending;
    expect(codes).toEqual(['123456']);
  });
});
