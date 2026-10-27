import readline from 'node:readline';
import { ALL_MODELS } from '@cws/contracts';
import { type ProxyIo } from './daemon';
import { startUiServer } from './http';
import { createLog } from './log';
import { createVirtualHid, nativeOk, openBle, scanBle } from './native';
import { openBrowser } from './open';
import { createPairingGate } from './pairing';
import { createRuntime } from './runtime';
import { createStatusBus } from './status';

const log = createLog();

function usage(): string {
  return `cws-proxy — USB HID gadget that pipes to the phone over BLE

Usage:
  yarn proxy [--model <id>] [--scan-ms 4000] [--pairing-code 123456] [--trezord-port 21325] [--ui-port 8788] [--no-hid] [--no-ui]

Opens http://127.0.0.1:8788 and waits for Start. --no-ui scans immediately (headless).

Linux: copy apps/proxy/udev/99-cws-uhid.rules to /etc/udev/rules.d and re-login.
macOS HID: open the signed CWS Proxy app (apps/proxy/macos/CWSProxy), not yarn proxy.

Models: ${ALL_MODELS.map((model) => model.id).join(', ')}
Env: CWS_PAIRING_CODE`;
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

function askStdin(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question('cws-proxy: pairing code shown on the phone: ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const noUi = argv.includes('--no-ui');
  const ready = nativeOk();
  if (noUi && !ready) {
    throw new Error(
      'native-proxy is not built. Install Rust, then: yarn workspace @cws/native-proxy build',
    );
  }
  const parent = new AbortController();
  const pairing = createPairingGate();
  const bus = createStatusBus(ready);
  const provided = argValue(argv, '--pairing-code') ?? process.env.CWS_PAIRING_CODE;
  const io: ProxyIo = {
    scan: scanBle,
    openBle,
    createHid: createVirtualHid,
    askPairingCode: async () => {
      if (provided) {
        return provided;
      }
      if (noUi) {
        return askStdin();
      }
      bus.patch({ pairing: true });
      try {
        return await pairing.wait(parent.signal);
      } finally {
        bus.patch({ pairing: false });
      }
    },
  };
  const runtime = createRuntime(
    io,
    log,
    bus,
    parent.signal,
    {
      scanMs: Number(argValue(argv, '--scan-ms') ?? 4000),
      modelId: argValue(argv, '--model'),
      trezordPort: Number(argValue(argv, '--trezord-port') ?? 21325),
      skipHid: argv.includes('--no-hid'),
      nativeReady: ready || Boolean(process.env.CWS_HID_SOCKET && process.env.CWS_BLE_SOCKET),
    },
    pairing,
  );
  const stop = () => {
    runtime.stop();
    parent.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  if (noUi) {
    runtime.start();
    await runtime.wait();
    return;
  }

  const uiPort = Number(argValue(argv, '--ui-port') ?? 8788);
  const server = await startUiServer({
    bus,
    pairing,
    commands: {
      start: () => runtime.start(),
      stop: () => runtime.stop(),
      labCatalog: () => runtime.labCatalog(),
      runLab: (actionId, draft) => runtime.runLab(actionId, draft),
    },
    port: uiPort,
  });
  log(`ui ${server.url}`);
  if (process.env.CWS_NO_OPEN !== '1') {
    openBrowser(server.url);
  }
  await waitForAbort(parent.signal);
  runtime.stop();
  await runtime.wait();
  await server.close();
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
