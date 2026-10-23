import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ApduLogEntry,
  ConfirmationPort,
  DeviceModel,
  LedgerApp,
  ProtocolHandler,
  SeedSlot,
  SigningRequest,
} from '@cws/contracts';
import { createHandler, entropyFromMnemonic, getModel, isSimulatable } from '@cws/sdk';
import { LedgerProtocolHandler } from '@cws/protocol-ledger';
import { startAdvertising } from '../ble/peripheral';
import type { PeripheralHandle } from '../ble/types';
import { isDevBuild } from '../passkeys/devFlag';
import { SESSION_MS, unlock as requestUnlock } from '../passkeys';
import { listSlots, loadEntropy, saveSlot } from '../seeds/vault';

const DEV_LAB_MNEMONIC =
  'test test test test test test test test test test test junk';

type PendingConfirm = {
  request: SigningRequest;
  resolve: (ok: boolean) => void;
};

type AppStateValue = {
  unlockedUntil: number | null;
  model: DeviceModel | null;
  seed: SeedSlot | null;
  advertising: boolean;
  connected: boolean;
  connectedLabel: string;
  currentApp: LedgerApp;
  logs: ApduLogEntry[];
  pending: SigningRequest | null;
  pairingCode: string | null;
  passphrase: string;
  error: string | null;
  unlock: () => Promise<boolean>;
  lock: () => void;
  selectModel: (model: DeviceModel) => void;
  selectSeed: (slot: SeedSlot | null) => void;
  startSimulation: () => Promise<void>;
  stopSimulation: () => Promise<void>;
  setApp: (app: LedgerApp) => void;
  setPassphrase: (value: string) => void;
  resolveSigning: (ok: boolean) => void;
  clearLogs: () => void;
};

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [unlockedUntil, setUnlockedUntil] = useState<number | null>(null);
  const [model, setModel] = useState<DeviceModel | null>(() => getModel('nano-x') ?? null);
  const [seed, setSeed] = useState<SeedSlot | null>(null);
  const [advertising, setAdvertising] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectedLabel, setConnectedLabel] = useState('');
  const [currentApp, setCurrentApp] = useState<LedgerApp>('dashboard');
  const [logs, setLogs] = useState<ApduLogEntry[]>([]);
  const [pending, setPending] = useState<SigningRequest | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const peripheralRef = useRef<PeripheralHandle | null>(null);
  const handlerRef = useRef<ProtocolHandler | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const passphraseRef = useRef('');
  const logSeq = useRef(0);

  const appendLog = useCallback((direction: 'in' | 'out', hex: string, note?: string) => {
    console.log(`[cws-ble] ${direction} ${note ?? ''} ${hex}`.trim());
    setLogs((current) => {
      const next = [
        ...current,
        {
          id: `log-${logSeq.current++}`,
          at: Date.now(),
          direction,
          hex,
          note,
        },
      ];
      return next.length > 1000 ? next.slice(next.length - 1000) : next;
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const confirmation = useMemo<ConfirmationPort>(
    () => ({
      confirm(request) {
        return new Promise<boolean>((resolve) => {
          pendingRef.current = { request, resolve };
          setPending(request);
        });
      },
      async getPassphrase() {
        return passphraseRef.current || undefined;
      },
      onPairingCode(code) {
        setPairingCode(code);
      },
    }),
    [],
  );

  const unlock = useCallback(async () => {
    try {
      const ok = await requestUnlock();
      if (ok) {
        setUnlockedUntil(Date.now() + SESSION_MS);
        setError(null);
        if (isDevBuild()) {
          const labId = 'dev-lab';
          const slots = await listSlots();
          const existing = slots.find((slot) => slot.id === labId);
          if (existing) {
            setSeed(existing);
          } else {
            setSeed(
              await saveSlot(
                {
                  id: labId,
                  label: 'DEV lab seed',
                  brand: model?.brand ?? 'ledger',
                  modelId: model?.id ?? 'nano-x',
                  wordCount: 12,
                  createdAt: Date.now(),
                },
                entropyFromMnemonic(DEV_LAB_MNEMONIC),
              ),
            );
          }
        }
      }
      return ok;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed');
      return false;
    }
  }, [model]);

  const stopSimulation = useCallback(async () => {
    await peripheralRef.current?.stop();
    peripheralRef.current = null;
    handlerRef.current = null;
    setAdvertising(false);
    setConnected(false);
    setConnectedLabel('');
    setCurrentApp('dashboard');
    if (pendingRef.current) {
      pendingRef.current.resolve(false);
      pendingRef.current = null;
    }
    setPending(null);
    passphraseRef.current = '';
    setPassphrase('');
    setPairingCode(null);
  }, []);

  const lock = useCallback(() => {
    void stopSimulation();
    setError(null);
    setUnlockedUntil(null);
  }, [stopSimulation]);

  useEffect(() => {
    if (unlockedUntil == null) {
      return;
    }
    const remaining = unlockedUntil - Date.now();
    if (remaining <= 0) {
      lock();
      return;
    }
    const timer = setTimeout(() => {
      lock();
    }, remaining);
    return () => clearTimeout(timer);
  }, [lock, unlockedUntil]);

  const startSimulation = useCallback(async () => {
    if (!model || !isSimulatable(model)) {
      throw new Error(
        'This app advertises Ledger BLE models, OneKey Classic/Touch/Pro/Pro 2/Neo/Pure, and Trezor Safe 7',
      );
    }
    if (!seed) {
      throw new Error('Select a seed first');
    }
    setError(null);
    try {
      const entropy = await loadEntropy(seed.id);
      const handler = createHandler({
        model,
        confirmation,
        slotId: seed.id,
        entropy,
        backup: seed.backup ?? 'bip39',
        onAppChange: (app) => setCurrentApp(app),
      });
      handlerRef.current = handler;
      setLogs([]);
      const handle = await startAdvertising(model, handler, {
        onConnected: (id) => {
          setConnected(true);
          setConnectedLabel(id);
        },
        onDisconnected: () => {
          setConnected(false);
          setConnectedLabel('');
        },
        onLog: appendLog,
        onError: (message) => {
          setError(message);
          setAdvertising(false);
        },
      });
      peripheralRef.current = handle;
      setAdvertising(true);
      setCurrentApp(handler instanceof LedgerProtocolHandler ? handler.getApp() : 'dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to advertise';
      setError(message);
    }
  }, [appendLog, confirmation, model, seed]);

  const setApp = useCallback((app: LedgerApp) => {
    const handler = handlerRef.current;
    if (handler instanceof LedgerProtocolHandler) {
      handler.setApp(app);
      setCurrentApp(app);
    }
  }, []);

  const resolveSigning = useCallback((ok: boolean) => {
    passphraseRef.current = passphrase;
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
    if (!ok) {
      passphraseRef.current = '';
      setPassphrase('');
    }
  }, [passphrase]);

  const value = useMemo<AppStateValue>(
    () => ({
      unlockedUntil,
      model,
      seed,
      advertising,
      connected,
      connectedLabel,
      currentApp,
      logs,
      pending,
      pairingCode,
      passphrase,
      error,
      unlock,
      lock,
      selectModel: setModel,
      selectSeed: setSeed,
      startSimulation,
      stopSimulation,
      setApp,
      setPassphrase: (value: string) => {
        passphraseRef.current = value;
        setPassphrase(value);
      },
      resolveSigning,
      clearLogs,
    }),
    [
      advertising,
      clearLogs,
      connected,
      connectedLabel,
      currentApp,
      error,
      lock,
      logs,
      model,
      pairingCode,
      passphrase,
      pending,
      resolveSigning,
      seed,
      setApp,
      startSimulation,
      stopSimulation,
      unlock,
      unlockedUntil,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return value;
}
