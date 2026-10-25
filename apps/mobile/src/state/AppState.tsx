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
  LedgerInstalledApp,
  LogChannel,
  ProtocolHandler,
  SeedSlot,
  SigningRequest,
} from '@cws/contracts';
import { ledgerCatalog } from '@cws/contracts';
import { createHandler, fetchManagerCatalog, getModel, isSimulatable } from '@cws/sdk';
import { LedgerProtocolHandler } from '@cws/protocol-ledger';
import { startAdvertising } from '../ble/peripheral';
import type { PeripheralHandle } from '../ble/types';
import { describeBlePayload, redactLogHex } from '../lab/apduNote';
import { expoRng } from '../lab/polyfillCrypto';
import { I18nProvider } from '../i18n';
import { ensureNearAccount } from '../near/service';
import { isDevBuild } from '../passkeys/devFlag';
import { setFaceIdEnabled, unlock as requestUnlock } from '../passkeys';
import { ensureDevLocalSeed } from '../seeds/labSeed';
import { listSlots, loadEntropy, updateSlotMeta } from '../seeds/vault';
import {
  DEFAULT_SETTINGS,
  loadActiveSlotId,
  loadCatalogOverlay,
  loadSettings,
  resolveDefaultSlot,
  saveActiveSlotId,
  saveCatalogOverlay,
  saveSettings,
  type AppSettings,
} from '../settings/store';

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
  sessionPassphraseApplied: boolean;
  error: string | null;
  toast: string | null;
  settings: AppSettings;
  catalog: readonly LedgerInstalledApp[];
  unlock: () => Promise<boolean>;
  lock: () => void;
  selectModel: (model: DeviceModel) => void;
  selectSeed: (slot: SeedSlot | null) => void;
  startSimulation: () => Promise<void>;
  stopSimulation: () => Promise<void>;
  setApp: (app: LedgerApp) => void;
  applySessionPassphrase: (value: string) => void;
  clearSessionPassphrase: () => void;
  resolveSigning: (ok: boolean) => void;
  clearLogs: () => void;
  appendAppLog: (channel: LogChannel, note: string, hex?: string) => void;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  updateLedgerCatalog: () => Promise<number>;
  refreshNear: (slot: SeedSlot, sponsor: boolean) => Promise<SeedSlot>;
  showToast: (message: string) => void;
  loading: string | null;
  hydrated: boolean;
  runWithLoading: <T>(label: string, work: () => Promise<T>) => Promise<T>;
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
  const [sessionPassphraseApplied, setSessionPassphraseApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [catalog, setCatalog] = useState<readonly LedgerInstalledApp[]>(() => [...ledgerCatalog()]);
  const [loading, setLoading] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const peripheralRef = useRef<PeripheralHandle | null>(null);
  const handlerRef = useRef<ProtocolHandler | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const passphraseRef = useRef('');
  const logSeq = useRef(0);
  const settingsRef = useRef(settings);
  const seedRef = useRef(seed);
  settingsRef.current = settings;
  seedRef.current = seed;

  const appendLog = useCallback(
    (direction: 'in' | 'out', hex: string, note?: string, channel?: LogChannel) => {
      const decoded = describeBlePayload(hex, direction);
      const entryNote = note && note !== 'GATT write' && note !== 'GATT notify' ? note : decoded.note;
      const entryChannel = channel ?? decoded.channel;
      const storedHex = redactLogHex(hex, entryNote);
      console.log(`[cws-${entryChannel}] ${direction} ${entryNote} ${storedHex}`.trim());
      setLogs((current) => {
        const cap = settingsRef.current.logCap || 1000;
        const next = [
          ...current,
          {
            id: `log-${logSeq.current++}`,
            at: Date.now(),
            direction,
            hex: storedHex,
            note: entryNote,
            channel: entryChannel,
          },
        ];
        return next.length > cap ? next.slice(next.length - cap) : next;
      });
    },
    [],
  );

  const appendAppLog = useCallback((channel: LogChannel, note: string, hex = '') => {
    appendLog(channel === 'error' ? 'out' : 'out', hex, note, channel);
  }, [appendLog]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 1600);
  }, []);

  const runWithLoading = useCallback(async <T,>(label: string, work: () => Promise<T>): Promise<T> => {
    setLoading(label);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    try {
      return await work();
    } finally {
      setLoading(null);
    }
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const patchSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    setFaceIdEnabled(next.faceIdEnabled);
    await saveSettings(next);
  }, []);

  const selectSeed = useCallback((slot: SeedSlot | null) => {
    setSeed(slot);
    seedRef.current = slot;
    void saveActiveSlotId(slot?.id ?? null);
  }, []);

  const confirmation = useMemo<ConfirmationPort>(
    () => ({
      confirm(request) {
        return new Promise<boolean>((resolve) => {
          pendingRef.current = { request, resolve };
          setPending(request);
          appendLog('out', '', `${request.kind} ${request.title}`, request.kind === 'open-app' ? 'app' : 'sign');
        });
      },
      async getPassphrase() {
        return passphraseRef.current || undefined;
      },
      onPairingCode(code) {
        setPairingCode(code);
        if (code) {
          appendLog('out', '', `pairing ${code}`, 'pair');
        }
      },
    }),
    [appendLog],
  );

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await loadSettings();
        settingsRef.current = loaded;
        setSettings(loaded);
        setFaceIdEnabled(loaded.faceIdEnabled);
        await loadCatalogOverlay();
        setCatalog([...ledgerCatalog()]);
        const slots = await listSlots();
        const activeId = await loadActiveSlotId();
        const resolved = resolveDefaultSlot(slots, activeId);
        if (resolved) {
          setSeed(resolved);
          seedRef.current = resolved;
        }
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const unlock = useCallback(async () => {
    try {
      const ok = await requestUnlock();
      if (ok) {
        setUnlockedUntil(Date.now() + settingsRef.current.autoLockMinutes * 60 * 1000);
        setError(null);
        if (isDevBuild()) {
          const lab = await ensureDevLocalSeed(model?.brand ?? 'ledger', model?.id ?? 'nano-x');
          if (!seedRef.current) {
            selectSeed(lab);
          }
        }
      }
      return ok;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed');
      return false;
    }
  }, [model, selectSeed]);

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
    setSessionPassphraseApplied(false);
    setPairingCode(null);
    appendAppLog('ble', 'advertise stop');
  }, [appendAppLog]);

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

  const refreshNear = useCallback(
    async (slot: SeedSlot, sponsor: boolean) => {
      appendAppLog('near', sponsor ? 'near: lookup+sponsor' : 'near: lookup');
      try {
        const entropy = await loadEntropy(slot.id);
        const status = await ensureNearAccount(entropy, slot, passphraseRef.current, sponsor);
        const updated = await updateSlotMeta({
          ...slot,
          nearAccountId: status.accountId,
          nearPublicKey: status.publicKey,
          nearCreatedAt: status.exists ? Date.now() : slot.nearCreatedAt,
          nearPath: slot.nearPath ?? slot.paths?.near,
        });
        if (seedRef.current?.id === updated.id) {
          setSeed(updated);
          seedRef.current = updated;
        }
        appendAppLog(
          'near',
          status.exists
            ? status.created
              ? 'near: create sponsored'
              : 'near: exists'
            : 'near: missing',
        );
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'NEAR failed';
        appendAppLog('error', `near: ${message}`);
        throw err;
      }
    },
    [appendAppLog],
  );

  const startSimulation = useCallback(async () => {
    if (!model || !isSimulatable(model)) {
      throw new Error(
        'This app advertises Ledger BLE models, OneKey Classic/Touch/Pro/Pro 2/Neo/Pure, and Trezor Safe 7',
      );
    }
    let active = seedRef.current;
    if (!active) {
      const slots = await listSlots();
      active = resolveDefaultSlot(slots, await loadActiveSlotId());
      if (active) {
        selectSeed(active);
      }
    }
    if (!active) {
      throw new Error('Select a seed first');
    }
    setError(null);
    passphraseRef.current = '';
    setSessionPassphraseApplied(false);
    try {
      const entropy = await loadEntropy(active.id);
      const handler = createHandler({
        model,
        confirmation,
        slotId: active.id,
        entropy,
        backup: active.backup ?? 'bip39',
        onAppChange: (app) => {
          setCurrentApp(app);
          appendAppLog('app', `OPEN_APP ${app}`);
        },
        rng: expoRng,
        onTrace: (note) => appendAppLog('pair', note),
      });
      handlerRef.current = handler;
      appendAppLog('ble', 'advertise start');
      const handle = await startAdvertising(model, handler, {
        onConnected: (id) => {
          setConnected(true);
          setConnectedLabel(id);
          appendAppLog('ble', `host ${id}`);
        },
        onDisconnected: () => {
          setConnected(false);
          setConnectedLabel('');
          appendAppLog('ble', 'host disconnected');
        },
        onLog: appendLog,
        onError: (message) => {
          setError(message);
          setAdvertising(false);
          appendAppLog('error', message);
        },
      }, { nameSuffix: settingsRef.current.bleNameSuffix });
      peripheralRef.current = handle;
      setAdvertising(true);
      setCurrentApp(handler instanceof LedgerProtocolHandler ? handler.getApp() : 'dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to advertise';
      setError(message);
      appendAppLog('error', message);
    }
  }, [appendAppLog, appendLog, confirmation, model, selectSeed]);

  const setApp = useCallback((app: LedgerApp) => {
    const handler = handlerRef.current;
    if (handler instanceof LedgerProtocolHandler) {
      handler.setApp(app);
      setCurrentApp(app);
      appendAppLog('app', `OPEN_APP ${app}`);
    }
  }, [appendAppLog]);

  const applySessionPassphrase = useCallback((value: string) => {
    passphraseRef.current = value;
    setSessionPassphraseApplied(true);
  }, []);

  const clearSessionPassphrase = useCallback(() => {
    passphraseRef.current = '';
    setSessionPassphraseApplied(false);
  }, []);

  const resolveSigning = useCallback((ok: boolean) => {
    const request = pendingRef.current?.request;
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
    appendAppLog(ok ? 'sign' : 'sign', ok ? 'confirm' : 'reject');
    if (!ok) {
      return;
    }
    if (
      ok &&
      request?.kind === 'address' &&
      request.path.includes("397'") &&
      settingsRef.current.nearAutoSponsor &&
      seedRef.current
    ) {
      void refreshNear(seedRef.current, true).catch((err) => {
        setError(err instanceof Error ? err.message : 'NEAR sponsor failed');
      });
    }
  }, [appendAppLog, refreshNear]);

  const updateLedgerCatalog = useCallback(async () => {
    const modelId = model?.id ?? 'nano-x';
    appendAppLog('manager', 'manager: fetch');
    const apps = await fetchManagerCatalog(modelId);
    await saveCatalogOverlay(apps);
    setCatalog(apps);
    await patchSettings({ catalogUpdatedAt: Date.now() });
    appendAppLog('manager', `manager: updated ${apps.length} apps`);
    return apps.length;
  }, [appendAppLog, model, patchSettings]);

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
      sessionPassphraseApplied,
      error,
      toast,
      settings,
      catalog,
      unlock,
      lock,
      selectModel: setModel,
      selectSeed,
      startSimulation,
      stopSimulation,
      setApp,
      applySessionPassphrase,
      clearSessionPassphrase,
      resolveSigning,
      clearLogs,
      appendAppLog,
      patchSettings,
      updateLedgerCatalog,
      refreshNear,
      showToast,
      loading,
      hydrated,
      runWithLoading,
    }),
    [
      advertising,
      appendAppLog,
      catalog,
      clearLogs,
      connected,
      connectedLabel,
      currentApp,
      error,
      hydrated,
      loading,
      lock,
      logs,
      model,
      pairingCode,
      patchSettings,
      pending,
      refreshNear,
      resolveSigning,
      runWithLoading,
      seed,
      selectSeed,
      sessionPassphraseApplied,
      applySessionPassphrase,
      clearSessionPassphrase,
      setApp,
      settings,
      showToast,
      startSimulation,
      stopSimulation,
      toast,
      unlock,
      unlockedUntil,
      updateLedgerCatalog,
    ],
  );

  return (
    <AppStateContext.Provider value={value}>
      <I18nProvider language={settings.language}>{children}</I18nProvider>
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return value;
}

export function useSessionMs(): number {
  const { settings } = useAppState();
  return settings.autoLockMinutes * 60 * 1000;
}
