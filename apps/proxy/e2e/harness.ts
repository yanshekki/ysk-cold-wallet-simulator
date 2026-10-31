import { startUiServer, type UiServer } from '../src/http';
import { labCatalogFor, type LabDraftInput } from '../src/lab';
import { createPairingGate, type PairingGate } from '../src/pairing';
import { createStatusBus, type StatusBus } from '../src/status';

export type MockProxy = {
  server: UiServer;
  bus: StatusBus;
  pairing: PairingGate;
  lastLab: { actionId: string; draft?: LabDraftInput } | null;
  selectedId: string | null;
  rescans: number;
};

export function resetMock(mock: MockProxy): void {
  mock.lastLab = null;
  mock.pairing.reset();
  mock.bus.clearLogs();
  mock.bus.patch({
    running: false,
    phase: 'idle',
    phoneName: '',
    brand: null,
    modelId: null,
    modelName: null,
    protocol: null,
    serviceUUID: null,
    vendorId: null,
    productId: null,
    mtu: null,
    hid: 'idle',
    hidError: null,
    labReady: false,
    trezord: null,
    error: null,
    pairing: false,
    nearby: [],
    targetId: null,
    targetName: '',
    locked: false,
  });
  mock.selectedId = null;
  mock.rescans = 0;
}

export async function startMockProxy(nativeOk = true): Promise<MockProxy> {
  const bus = createStatusBus(nativeOk);
  const pairing = createPairingGate();
  const mock: MockProxy = {
    server: undefined as unknown as UiServer,
    bus,
    pairing,
    lastLab: null,
    selectedId: null,
    rescans: 0,
  };
  mock.server = await startUiServer({
    bus,
    pairing,
    port: 0,
    commands: {
      start() {
        bus.patch({
          running: true,
          phase: 'gatt',
          brand: 'ledger',
          phoneName: 'Nano X',
          modelName: 'Nano X',
          modelId: 'nano-x',
          protocol: 'ledger-apdu',
          serviceUUID: '13d63400-2c97-0004-0000-4c6564676572',
          vendorId: 0x2c97,
          productId: 0x0004,
          mtu: 20,
          hid: 'up',
          labReady: true,
        });
      },
      stop() {
        bus.idle();
      },
      labCatalog(requested) {
        const snap = bus.snapshot();
        return labCatalogFor(snap.brand ?? requested ?? 'ledger', snap.labReady, snap.brand);
      },
      selectBle(id) {
        mock.selectedId = id;
        const row = bus.snapshot().nearby.find((item) => item.id === id);
        bus.patch({
          locked: true,
          targetId: id,
          targetName: row?.name || id,
        });
      },
      unlockBle() {
        mock.selectedId = null;
        bus.patch({ locked: false, targetId: null, targetName: '' });
      },
      rescanBle() {
        mock.rescans += 1;
      },
      async runLab(actionId, draft) {
        if (!bus.snapshot().labReady) {
          throw new Error('Start the proxy and wait for GATT');
        }
        mock.lastLab = { actionId, draft };
        if (actionId === 'dash-version') {
          return '0x33010400';
        }
        if (actionId === 'eth-personal') {
          return `utf8:${draft?.utf8 ?? ''}`;
        }
        if (actionId === 'eth-addr') {
          return `path:${draft?.path ?? ''}`;
        }
        if (actionId === 'eth-personal-bin') {
          return `hex:${draft?.hex ?? ''}`;
        }
        if (actionId === 'dash-open-eth') {
          return `app:${draft?.utf8 ?? ''}`;
        }
        return `ran ${actionId}`;
      },
    },
  });
  return mock;
}
