import {
  createContext,
  useCallback,
  useContext,
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
  SeedSlot,
  SigningRequest,
} from '@cws/contracts';
import { createLedgerHandler, getModel } from '@cws/sdk';
import { LedgerProtocolHandler } from '@cws/protocol-ledger';
import { startAdvertising } from '../ble/peripheral';
import type { PeripheralHandle } from '../ble/types';
import { loadEntropy } from '../seeds/vault';
import { authenticateUnlock, SESSION_MS } from '../unlock/session';

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
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const peripheralRef = useRef<PeripheralHandle | null>(null);
  const handlerRef = useRef<LedgerProtocolHandler | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const passphraseRef = useRef('');

  const appendLog = useCallback((direction: 'in' | 'out', hex: string, note?: string) => {
    setLogs((current) =>
      [
        {
          id: `${Date.now()}-${current.length}`,
          at: Date.now(),
          direction,
          hex,
          note,
        },
        ...current,
      ].slice(0, 80),
    );
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
    }),
    [],
  );

  const unlock = useCallback(async () => {
    const ok = await authenticateUnlock();
    if (ok) {
      setUnlockedUntil(Date.now() + SESSION_MS);
      setError(null);
    }
    return ok;
  }, []);

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
  }, []);

  const lock = useCallback(() => {
    void stopSimulation();
    setUnlockedUntil(null);
  }, [stopSimulation]);

  const startSimulation = useCallback(async () => {
    if (!model || model.id !== 'nano-x') {
      throw new Error('This slice only advertises Ledger Nano X');
    }
    if (!seed) {
      throw new Error('Select a seed first');
    }
    setError(null);
    const entropy = await loadEntropy(seed.id);
    const handler = createLedgerHandler({
      model,
      confirmation,
      slotId: seed.id,
      entropy,
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
    });
    peripheralRef.current = handle;
    setAdvertising(true);
    setCurrentApp(handler.getApp());
  }, [appendLog, confirmation, model, seed]);

  const setApp = useCallback((app: LedgerApp) => {
    handlerRef.current?.setApp(app);
    setCurrentApp(app);
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
    }),
    [
      advertising,
      connected,
      connectedLabel,
      currentApp,
      error,
      lock,
      logs,
      model,
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
