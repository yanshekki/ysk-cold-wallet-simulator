import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  encodeBleFrame,
  openBleSocket,
  resetBleSocketForTests,
  scanBleSocket,
  takeBleFrames,
  type BleFrame,
} from './bleSocket';

describe('ble socket frames', () => {
  it('round-trips length-prefixed JSON', () => {
    const packed = Buffer.concat([
      encodeBleFrame({ op: 'ok' }),
      encodeBleFrame({ op: 'notify', packet: Buffer.from('hi').toString('base64') }),
    ]);
    const { frames, rest } = takeBleFrames(packed);
    expect(rest.length).toBe(0);
    expect(frames).toEqual([
      { op: 'ok' },
      { op: 'notify', packet: Buffer.from('hi').toString('base64') },
    ]);
  });
});

describe('ble socket client', () => {
  let server: net.Server | undefined;
  let socketPath = '';

  afterEach(async () => {
    resetBleSocketForTests();
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

  it('scans, connects, writes, and receives notify', async () => {
    socketPath = path.join(os.tmpdir(), `cws-ble-test-${process.pid}-${Date.now()}.sock`);
    const seen: BleFrame[] = [];
    server = net.createServer((socket) => {
      let leftover = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        leftover = Buffer.concat([leftover, chunk]);
        const taken = takeBleFrames(leftover);
        leftover = taken.rest;
        for (const frame of taken.frames) {
          seen.push(frame);
          if (frame.op === 'scan') {
            socket.write(
              encodeBleFrame({
                op: 'found',
                id: 'AAA',
                name: 'Shek Ki的iPhone [Nano X]',
                services: [],
              }),
            );
            socket.write(encodeBleFrame({ op: 'scanDone' }));
          } else if (frame.op === 'connect') {
            socket.write(encodeBleFrame({ op: 'ok' }));
          } else if (frame.op === 'write') {
            socket.write(encodeBleFrame({ op: 'ok' }));
            socket.write(
              encodeBleFrame({
                op: 'notify',
                packet: Buffer.from([0x05, 0xb0]).toString('base64'),
              }),
            );
          } else if (frame.op === 'close') {
            socket.write(encodeBleFrame({ op: 'ok' }));
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(socketPath, resolve);
    });

    const hits = await scanBleSocket(socketPath, 400);
    expect(hits).toEqual([
      { id: 'AAA', name: 'Shek Ki的iPhone [Nano X]', services: [] },
    ]);

    const ble = await openBleSocket(socketPath, 'AAA', 'write', 'notify');
    const packets: Uint8Array[] = [];
    ble.onNotify((packet) => packets.push(packet));
    await ble.write(Uint8Array.from([0xb0, 0x01]));
    await expect.poll(() => packets.length).toBe(1);
    expect(packets[0]?.[0]).toBe(0x05);
    expect(await ble.isConnected()).toBe(true);
    expect(ble.debugInfo()).toContain('swift-cb');
    await ble.close();

    expect(seen.some((frame) => frame.op === 'scan')).toBe(true);
    expect(seen.some((frame) => frame.op === 'connect')).toBe(true);
    expect(seen.some((frame) => frame.op === 'write')).toBe(true);
    expect(seen.some((frame) => frame.op === 'close')).toBe(true);
  });
});
