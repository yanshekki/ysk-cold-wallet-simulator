import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PairingGate } from './pairing';
import type { StatusBus } from './status';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const FILES: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/styles.css': 'styles.css',
  '/app.js': 'app.js',
};

export type UiCommands = {
  start(): void;
  stop(): void;
};

export type UiServer = {
  port: number;
  url: string;
  close(): Promise<void>;
};

function uiDirFromImportMeta(): string | undefined {
  try {
    const url = import.meta.url;
    if (!url) {
      return undefined;
    }
    return fileURLToPath(new URL('../ui', url));
  } catch {
    return undefined;
  }
}

export function defaultUiDir(): string {
  const execDir = path.dirname(process.execPath);
  const fromEnv = process.env.CWS_UI_DIR?.trim();
  const fromMeta = uiDirFromImportMeta();
  const candidates = [
    ...(fromEnv ? [fromEnv] : []),
    path.join(execDir, 'ui'),
    path.join(execDir, '..', 'Resources', 'ui'),
    path.join(execDir, '..', '..', '..', '..', 'Resources', 'ui'),
    ...(fromMeta ? [fromMeta] : []),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return candidates[0];
}

export function startUiServer(opts: {
  bus: StatusBus;
  commands: UiCommands;
  pairing: PairingGate;
  port: number;
  uiDir?: string;
}): Promise<UiServer> {
  const uiDir = opts.uiDir ?? defaultUiDir();
  const clients = new Set<http.ServerResponse>();

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (method === 'GET' && url.pathname === '/events') {
      writeSse(res, opts.bus, clients);
      return;
    }
    if (method === 'POST' && url.pathname === '/start') {
      opts.commands.start();
      json(res, 200, { ok: true, running: true });
      return;
    }
    if (method === 'POST' && url.pathname === '/stop') {
      opts.commands.stop();
      json(res, 200, { ok: true, running: false });
      return;
    }
    if (method === 'POST' && url.pathname === '/logs/clear') {
      opts.bus.clearLogs();
      json(res, 200, { ok: true });
      return;
    }
    if (method === 'POST' && url.pathname === '/pairing') {
      void readBody(req).then((body) => {
        let code = '';
        try {
          const parsed = body ? (JSON.parse(body) as { code?: unknown }) : {};
          code = typeof parsed.code === 'string' ? parsed.code : '';
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        const digits = code.replace(/\D/g, '');
        if (digits.length !== 6) {
          json(res, 400, { ok: false, error: 'pairing code must be 6 digits' });
          return;
        }
        opts.pairing.submit(digits);
        json(res, 200, { ok: true });
      });
      return;
    }
    if (method === 'GET') {
      const name = FILES[url.pathname];
      if (!name) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      const file = path.join(uiDir, name);
      fs.readFile(file, (error, data) => {
        if (error) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', MIME[path.extname(name)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(data);
      });
      return;
    }
    res.statusCode = 405;
    res.end('method not allowed');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : opts.port;
      resolve({
        port: bound,
        url: `http://127.0.0.1:${bound}`,
        close() {
          for (const client of clients) {
            client.end();
          }
          clients.clear();
          return new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          });
        },
      });
    });
  });
}

function writeSse(res: http.ServerResponse, bus: StatusBus, clients: Set<http.ServerResponse>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('\n');
  clients.add(res);
  const ping = setInterval(() => {
    res.write(': ping\n\n');
  }, 15_000);
  const unsubscribe = bus.subscribe((status) => {
    res.write(`data: ${JSON.stringify(status)}\n\n`);
  });
  const cleanup = () => {
    clearInterval(ping);
    unsubscribe();
    clients.delete(res);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
