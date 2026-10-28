import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startUiServer, type UiServer } from './http';
import { createPairingGate } from './pairing';
import { createStatusBus } from './status';

function controlPost(url: string, body?: unknown, headers?: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'X-CWS-Proxy': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

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
    expect(copy).toContain('id: "zh-HK"');
    expect(copy).toContain('id: "es"');
    expect(copy).toContain('id: "ar"');
    expect(copy).toContain('id: "pt"');
    expect(copy).toContain('id: "id"');
    expect(copy).toContain('id: "fr"');
    expect(copy).toContain('id: "ja"');
    expect(copy).toContain('id: "ru"');
    expect(copy).toContain('id: "de"');
    expect(copy).toContain('lang: "Language"');
    expect(copy).toContain('lang: "語言"');
    expect(copy).toContain('labRunning');

    const script = await fetch(`${server.url}/app.js`);
    const js = await script.text();
    expect(js).toContain('bindPower');
    expect(js).toContain('lang-select');
    expect(js).toContain("post(state.status?.running ? '/stop' : '/start')");
    expect(js).toContain("'X-CWS-Proxy': '1'");
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

    const blocked = await fetch(`${server.url}/start`, { method: 'POST' });
    expect(blocked.status).toBe(403);
    expect(started).toBe(0);

    const crossSite = await controlPost(`${server.url}/lab/run`, { actionId: 'dash-version' }, {
      'Sec-Fetch-Site': 'cross-site',
      Origin: 'https://evil.example',
    });
    expect(crossSite.status).toBe(403);

    const start = await controlPost(`${server.url}/start`);
    expect(start.status).toBe(200);
    expect(started).toBe(1);
    expect(bus.snapshot().running).toBe(true);
    expect(bus.snapshot().radio).toBe('SCAN');

    const liveStatus = await fetch(`${server.url}/status`);
    expect(await liveStatus.json()).toMatchObject({ running: true, phase: 'scanning' });

    const frame = await readSseFrame(`${server.url}/events`);
    expect(frame).toContain('data:');
    expect(frame).toContain('"running":true');

    const stop = await controlPost(`${server.url}/stop`);
    expect(stop.status).toBe(200);
    expect(stopped).toBe(1);
    expect(bus.snapshot().running).toBe(false);

    bus.log('keep me');
    const cleared = await controlPost(`${server.url}/logs/clear`);
    expect(cleared.status).toBe(200);
    expect(bus.snapshot().logs).toEqual([]);

    const labRun = await controlPost(`${server.url}/lab/run`, { actionId: 'dash-version' });
    expect(labRun.status).toBe(200);
    expect(await labRun.json()).toEqual({ ok: true, result: '0x3300' });

    const labMissing = await controlPost(`${server.url}/lab/run`, {});
    expect(labMissing.status).toBe(400);

    const pair = await controlPost(`${server.url}/pairing`, { code: '123456' });
    expect(pair.status).toBe(200);
    await pending;
    expect(codes).toEqual(['123456']);
  });

  it('rejects a rebinding Host before it can read status or start a scan', async () => {
    const bus = createStatusBus();
    let started = 0;
    server = await startUiServer({
      bus,
      pairing: createPairingGate(),
      commands: {
        start() {
          started += 1;
        },
        stop() {
          return;
        },
        labCatalog() {
          return {
            ready: false,
            brand: 'ledger',
            connectedBrand: null,
            nearFaucet: '',
            sections: [],
          };
        },
        setOpenAppName() {
          return;
        },
        async runLab() {
          return '';
        },
      },
      port: 0,
    });
    const status = await rawRequest(server.port, 'GET', '/status', { host: 'evil.example:8788' });
    expect(status.status).toBe(403);
    const start = await rawRequest(server.port, 'POST', '/start', {
      host: 'evil.example',
      'x-cws-proxy': '1',
    });
    expect(start.status).toBe(403);
    expect(started).toBe(0);
  });
});

function rawRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
