import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { LEDGER_MODELS } from '@cws/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeHidFrame, openHidSocket, takeHidFrames, type HidFrame } from './hidSocket';

const FLEX = LEDGER_MODELS.find((model) => model.id === 'flex')!;

describe('hid socket frames', () => {
  it('round-trips length-prefixed JSON', () => {
    const packed = Buffer.concat([
      encodeHidFrame({ op: 'ok' }),
      encodeHidFrame({ op: 'input', report: Buffer.from('hi').toString('base64') }),
    ]);
    const { frames, rest } = takeHidFrames(packed);
    expect(rest.length).toBe(0);
    expect(frames).toEqual([
      { op: 'ok' },
      { op: 'input', report: Buffer.from('hi').toString('base64') },
    ]);
  });

  it('keeps a partial frame in the remainder', () => {
    const full = encodeHidFrame({ op: 'error', message: 'nope' });
    const { frames, rest } = takeHidFrames(full.subarray(0, 6));
    expect(frames).toEqual([]);
    expect(rest.length).toBe(6);
  });
});

describe('openHidSocket', () => {
  let server: net.Server | undefined;
  let socketPath = '';

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    server = undefined;
    if (socketPath && fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  });

  it('opens, writes, receives input, then closes', async () => {
    socketPath = path.join(os.tmpdir(), `cws-hid-test-${process.pid}-${Date.now()}.sock`);
    const seen: HidFrame[] = [];
    server = net.createServer((socket) => {
      let leftover = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        leftover = Buffer.concat([leftover, chunk]);
        const taken = takeHidFrames(leftover);
        leftover = taken.rest;
        for (const frame of taken.frames) {
          seen.push(frame);
          if (frame.op === 'open') {
            socket.write(encodeHidFrame({ op: 'ok' }));
          } else if (frame.op === 'write') {
            socket.write(
              encodeHidFrame({ op: 'input', report: Buffer.alloc(64, 0x3f).toString('base64') }),
            );
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(socketPath, resolve);
    });

    const hid = await openHidSocket(socketPath, FLEX);
    const inputs: Uint8Array[] = [];
    hid.onInput((report) => inputs.push(report));
    hid.write(Uint8Array.from([0x3f, 1, 2, 3]));
    await expect.poll(() => inputs.length).toBe(1);
    hid.close();
    await expect.poll(() => seen.some((frame) => frame.op === 'close')).toBe(true);

    expect(seen[0]?.op).toBe('open');
    expect(seen[0]?.vid).toBe(FLEX.usb.vendorId);
    expect(seen[0]?.pid).toBe(FLEX.usb.productId);
    expect(seen[0]?.name).toBe(FLEX.name);
    expect(seen[0]?.descriptor).toBeTruthy();
    expect(seen.some((frame) => frame.op === 'write')).toBe(true);
    expect(seen.some((frame) => frame.op === 'close')).toBe(true);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.[0]).toBe(0x3f);
  });

  it('aborts an in-flight open', async () => {
    socketPath = path.join(os.tmpdir(), `cws-hid-abort-${Date.now()}.sock`);
    server = net.createServer(() => undefined);
    await new Promise<void>((resolve, reject) => {
      server!.listen(socketPath, () => resolve());
      server!.once('error', reject);
    });
    const abort = new AbortController();
    const pending = openHidSocket(socketPath, FLEX, abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
