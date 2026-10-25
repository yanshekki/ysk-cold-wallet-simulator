import http from 'node:http';
import type { DeviceModel } from '@cws/contracts';
import { bytesToHex, decodeUsbProtobuf, encodeUsbProtobuf, hexToBytes } from '@cws/protocol-trezor';
import type { LogFn } from './log';
import { forwardUsb } from './adapters/trezor';
import type { ThpClient } from './adapters/thp';

const BRIDGE_VERSION = '2.0.33';

export type TrezordHandle = {
  port: number;
  close(): Promise<void>;
};

type Json = Record<string, unknown> | unknown[];

export function startTrezord(
  thp: ThpClient,
  model: DeviceModel,
  log: LogFn,
  port = 21325,
): Promise<TrezordHandle> {
  const path = `cws:${model.brand}:${model.id}`;
  let session: string | null = null;
  let nextSession = 1;
  let chain = Promise.resolve();

  function enumerate(): Json {
    return [
      {
        path,
        vendor: model.usb.vendorId,
        product: model.usb.productId,
        session,
        debug: false,
        debugSession: null,
      },
    ];
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin ?? '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      res.end();
      return;
    }
    const url = req.url ?? '/';
    readBody(req)
      .then((body) => runExclusive(() => handle(url, req.method ?? 'GET', body)))
      .then((result) => {
        if (typeof result === 'string') {
          res.setHeader('Content-Type', 'text/plain');
          res.statusCode = 200;
          res.end(result);
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      });
  });

  function runExclusive(task: () => Promise<string | Json>): Promise<string | Json> {
    const run = chain.then(task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function handle(url: string, method: string, body: string): Promise<string | Json> {
    if (method === 'GET' && (url === '/' || url.startsWith('/?'))) {
      return { version: BRIDGE_VERSION };
    }
    if (url.startsWith('/enumerate')) {
      return enumerate();
    }
    if (url.startsWith('/listen')) {
      await sleep(8_000);
      return enumerate();
    }
    const acquire = url.match(/^\/acquire\/([^/]+)\/([^/]+)/);
    if (acquire) {
      const previous = decodeURIComponent(acquire[2] ?? 'null');
      if (session && previous !== session && previous !== 'null') {
        throw new Error('wrong previous session');
      }
      session = String(nextSession);
      nextSession += 1;
      log(`trezord acquire ${session}`);
      return { session };
    }
    const release = url.match(/^\/release\/([^/]+)/);
    if (release) {
      session = null;
      log('trezord release');
      return {};
    }
    const call = url.match(/^\/(?:call|post)\/([^/]+)/);
    if (call) {
      if (!session || call[1] !== session) {
        throw new Error('wrong session');
      }
      const message = decodeUsbProtobuf(hexToBytes(body.trim()));
      if (!message) {
        throw new Error('incomplete USB protobuf');
      }
      const reply = await forwardUsb(thp, message);
      if (url.startsWith('/post/')) {
        return {};
      }
      return bytesToHex(encodeUsbProtobuf(reply.type, reply.payload));
    }
    throw new Error(`unknown trezord path ${url}`);
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      log(`trezord http://127.0.0.1:${bound}`);
      resolve({
        port: bound,
        close() {
          return new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          });
        },
      });
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
