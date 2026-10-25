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
      },
      port: 0,
    });
    const page = await fetch(server.url);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('CWS Proxy');
    expect(html).toContain('id="start"');

    const start = await fetch(`${server.url}/start`, { method: 'POST' });
    expect(start.status).toBe(200);
    expect(started).toBe(1);
    expect(bus.snapshot().running).toBe(true);
    expect(bus.snapshot().radio).toBe('SCAN');

    const frame = await readSseFrame(`${server.url}/events`);
    expect(frame).toContain('data:');
    expect(frame).toContain('"running":true');

    const stop = await fetch(`${server.url}/stop`, { method: 'POST' });
    expect(stop.status).toBe(200);
    expect(stopped).toBe(1);
    expect(bus.snapshot().running).toBe(false);

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
