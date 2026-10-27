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
import {
  BbqrDecoder,
  FountainUrDecoder,
  assertEthSignMatchesSeed,
  decodeBtcSignRequest,
  decodeCosmosSignRequest,
  decodeEthSignRequest,
  decodeSolSignRequest,
  encodeBbqr,
  encodeQrAccount,
  isBbqrPart,
  previewCryptoPsbt,
  previewPsbt,
  signBtcMessage,
  signCosmosRequest,
  signCryptoPsbt,
  signEthRequest,
  signPsbtBytes,
  signSolRequest,
  type EthAirgapQr,
  type QrFormatId,
  type QrProfile,
  type QrUrKind,
} from '@cws/protocol-qr';
import {
  btcMessageToSigningRequest,
  cosmosSignToSigningRequest,
  ethSignToSigningRequest,
  psbtToSigningRequest,
  solSignToSigningRequest,
} from '../qr/signingRequest';
import { createHandler, fetchManagerCatalog, getModel, isSimulatable, toBip32Seed } from '@cws/sdk';
import { startAdvertising } from '../ble/peripheral';
import type { PeripheralHandle } from '../ble/types';
import { clearDisclaimerAcceptance, loadDisclaimerAccepted, saveDisclaimerAcceptance } from '../disclaimer/store';
import { I18nProvider, translate } from '../i18n';
import { describeBlePayload, redactLogHex } from '../lab/apduNote';
import { expoRng } from '../lab/polyfillCrypto';
import { ensureNearAccount } from '../near/service';
import { setFaceIdEnabled, unlock as requestUnlock } from '../passkeys';
import { SecretSession } from '../seeds/secretSession';
import { listSlots, loadEntropy, setVaultAuthPrompt, updateSlotMeta, wipeAllSlots } from '../seeds/vault';
import {
  DEFAULT_SETTINGS,
  clearCatalogOverlay,
  detectLanguage,
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

export type QrScanStatus =
  | { status: 'progress'; received: number; expected: number }
  | { status: 'complete'; qr: EthAirgapQr }
  | { status: 'rejected' };

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
  passphraseFingerprint: string | null;
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
  applySessionPassphrase: (value: string) => Promise<boolean>;
  clearSessionPassphrase: () => void;
  resolveSigning: (ok: boolean) => void;
  clearLogs: () => void;
  appendAppLog: (channel: LogChannel, note: string, hex?: string) => void;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  updateLedgerCatalog: () => Promise<number>;
  refreshNear: (slot: SeedSlot) => Promise<SeedSlot>;
  exportQrAccount: (profile: QrProfile, format?: QrFormatId | QrUrKind) => Promise<EthAirgapQr>;
  scanQrSign: (part: string) => Promise<QrScanStatus>;
  resetQrScan: () => void;
  showToast: (message: string) => void;
  loading: string | null;
  hydrated: boolean;
  disclaimerAccepted: boolean;
  acceptDisclaimer: () => Promise<void>;
  clearAllData: () => Promise<void>;
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
  const [passphraseFingerprint, setPassphraseFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [catalog, setCatalog] = useState<readonly LedgerInstalledApp[]>(() => [...ledgerCatalog()]);
  const [loading, setLoading] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);

  const peripheralRef = useRef<PeripheralHandle | null>(null);
  const handlerRef = useRef<ProtocolHandler | null>(null);
  const currentAppRef = useRef<LedgerApp>('dashboard');
  const connectedRef = useRef(false);
  const entropyRef = useRef<Uint8Array | null>(null);
  const spawnHandlerRef = useRef<() => ProtocolHandler>(() => {
    throw new Error('handler factory not ready');
  });
  const pendingRef = useRef<PendingConfirm | null>(null);
  const secretSession = useRef(new SecretSession());
  const qrDecoder = useRef(new FountainUrDecoder());
  const bbqrDecoder = useRef(new BbqrDecoder());
  const qrScanBusy = useRef(false);
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

  const acceptDisclaimer = useCallback(async () => {
    await saveDisclaimerAcceptance();
    setDisclaimerAccepted(true);
  }, []);

  const patchSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    setFaceIdEnabled(next.faceIdEnabled);
    setVaultAuthPrompt(translate(next.language, 'vault.authPrompt'));
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
        return undefined;
      },
      async getSeed() {
        return secretSession.current.copySeed();
      },
      async getIcarusRoot() {
        return secretSession.current.copyIcarusRoot();
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
        setVaultAuthPrompt(translate(loaded.language, 'vault.authPrompt'));
        await loadCatalogOverlay();
        setCatalog([...ledgerCatalog()]);
        const slots = await listSlots();
        const activeId = await loadActiveSlotId();
        const resolved = resolveDefaultSlot(slots, activeId);
        if (resolved) {
          setSeed(resolved);
          seedRef.current = resolved;
        }
        setDisclaimerAccepted(await loadDisclaimerAccepted());
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const unlock = useCallback(async () => {
    try {
      const ok = await requestUnlock(translate(settingsRef.current.language, 'unlock.prompt'));
      if (ok) {
        setUnlockedUntil(Date.now() + settingsRef.current.autoLockMinutes * 60 * 1000);
        setError(null);
      }
      return ok;
    } catch (err) {
      setError(translate(settingsRef.current.language, err instanceof Error ? err.message : 'unlock.failed'));
      return false;
    }
  }, []);

  const stopSimulation = useCallback(async () => {
    await peripheralRef.current?.stop();
    peripheralRef.current = null;
    handlerRef.current = null;
    entropyRef.current = null;
    connectedRef.current = false;
    currentAppRef.current = 'dashboard';
    setCurrentApp('dashboard');
    setAdvertising(false);
    setConnected(false);
    setConnectedLabel('');
    if (pendingRef.current) {
      pendingRef.current.resolve(false);
      pendingRef.current = null;
    }
    setPending(null);
    secretSession.current.wipe();
    setSessionPassphraseApplied(false);
    setPassphraseFingerprint(null);
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
    async (slot: SeedSlot) => {
      appendAppLog('near', 'near: derive');
      try {
        const entropy = await loadEntropy(slot.id);
        const seedBytes =
          secretSession.current.copySeed() ?? toBip32Seed(entropy, slot.backup ?? 'bip39', '');
        const status = ensureNearAccount(seedBytes, slot);
        const updated = await updateSlotMeta({
          ...slot,
          nearAccountId: status.accountId,
          nearPublicKey: status.publicKey,
          nearPath: slot.nearPath ?? slot.paths?.near,
        });
        if (seedRef.current?.id === updated.id) {
          setSeed(updated);
          seedRef.current = updated;
        }
        appendAppLog('near', 'near: derived');
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'NEAR failed';
        appendAppLog('error', `near: ${message}`);
        throw err;
      }
    },
    [appendAppLog],
  );

  const clearAllData = useCallback(async () => {
    await stopSimulation();
    await wipeAllSlots();
    await saveActiveSlotId(null);
    await clearCatalogOverlay();
    await clearDisclaimerAcceptance();
    const next = { ...DEFAULT_SETTINGS, language: detectLanguage() };
    settingsRef.current = next;
    setSettings(next);
    setFaceIdEnabled(next.faceIdEnabled);
    setVaultAuthPrompt(translate(next.language, 'vault.authPrompt'));
    await saveSettings(next);
    setSeed(null);
    seedRef.current = null;
    setCatalog([...ledgerCatalog()]);
    setLogs([]);
    setDisclaimerAccepted(false);
    setError(null);
    setUnlockedUntil(null);
    currentAppRef.current = 'dashboard';
    setCurrentApp('dashboard');
  }, [stopSimulation]);

  const updateLedgerCatalog = useCallback(async () => {
    const modelId = model?.brand === 'ledger' ? model.id : 'nano-x';
    appendAppLog('manager', 'manager: fetch');
    const apps = await fetchManagerCatalog(modelId);
    await saveCatalogOverlay(apps);
    setCatalog(apps);
    await patchSettings({ catalogUpdatedAt: Date.now() });
    appendAppLog('manager', `manager: updated ${apps.length} apps`);
    return apps.length;
  }, [appendAppLog, model, patchSettings]);

  const spawnHandler = useCallback(() => {
    const currentModel = model;
    const active = seedRef.current;
    const entropy = entropyRef.current;
    if (!currentModel || !active || !entropy) {
      throw new Error('handler spawn missing session');
    }
    const handler = createHandler({
      model: currentModel,
      confirmation,
      slotId: active.id,
      entropy,
      backup: active.backup ?? 'bip39',
      onAppChange: (app) => {
        currentAppRef.current = app;
        setCurrentApp(app);
        appendAppLog('app', `OPEN_APP ${app}`);
      },
      rng: expoRng,
      onTrace: (note) => appendAppLog('pair', note),
    });
    const seedBytes = secretSession.current.copySeed();
    if (seedBytes) {
      handler.replaceSeed?.(seedBytes, secretSession.current.copyIcarusRoot());
    }
    return handler;
  }, [appendAppLog, confirmation, model]);
  spawnHandlerRef.current = spawnHandler;

  const startSimulation = useCallback(async () => {
    if (!model || !isSimulatable(model)) {
      throw new Error('errors.advertiseUnsupported');
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
      throw new Error('errors.selectSeed');
    }
    setError(null);
    await peripheralRef.current?.stop();
    peripheralRef.current = null;
    secretSession.current.wipe();
    setSessionPassphraseApplied(false);
    setPassphraseFingerprint(null);
    try {
      const entropy = await loadEntropy(active.id);
      entropyRef.current = entropy;
      secretSession.current.load(entropy, active.backup ?? 'bip39');
      handlerRef.current = spawnHandlerRef.current();
      currentAppRef.current = 'dashboard';
      setCurrentApp('dashboard');
      appendAppLog('app', 'handler ready (dashboard; HOT probes)');
      appendAppLog('ble', 'advertise start');
      const handle = await startAdvertising(model, () => handlerRef.current!, {
        onConnected: (id) => {
          if (!connectedRef.current) {
            handlerRef.current = spawnHandlerRef.current();
            currentAppRef.current = 'dashboard';
            setCurrentApp('dashboard');
            appendAppLog('app', 'handler ready (dashboard; HOT probes)');
          }
          connectedRef.current = true;
          setConnected(true);
          setConnectedLabel(id);
          appendAppLog('ble', `host ${id}`);
        },
        onDisconnected: () => {
          connectedRef.current = false;
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
      setCurrentApp(handlerRef.current?.getApp?.() ?? currentAppRef.current);
    } catch (err) {
      secretSession.current.wipe();
      handlerRef.current = null;
      const message = err instanceof Error ? err.message : 'errors.advertiseFailed';
      const shown = translate(settingsRef.current.language, message);
      setError(shown);
      appendAppLog('error', shown);
    }
  }, [appendAppLog, appendLog, confirmation, model, selectSeed]);

  const exportQrAccount = useCallback(async (profile: QrProfile, format?: QrFormatId | QrUrKind) => {
    const active = seedRef.current;
    if (!active) {
      throw new Error('errors.selectSeed');
    }
    let seedBytes = secretSession.current.copySeed();
    if (!seedBytes) {
      const entropy = await loadEntropy(active.id);
      seedBytes = toBip32Seed(entropy, active.backup ?? 'bip39', '');
    }
    try {
      return encodeQrAccount(seedBytes, profile, format ?? profile.defaultUr);
    } finally {
      seedBytes.fill(0);
    }
  }, []);

  const resetQrScan = useCallback(() => {
    qrDecoder.current.reset();
    bbqrDecoder.current.reset();
    qrScanBusy.current = false;
  }, []);

  const scanQrSign = useCallback(
    async (part: string): Promise<QrScanStatus> => {
      if (qrScanBusy.current) {
        return { status: 'progress', received: 0, expected: 0 };
      }
      if (isBbqrPart(part)) {
        const progress = bbqrDecoder.current.receive(part);
        if (!progress.complete) {
          return { status: 'progress', received: progress.received, expected: progress.expected };
        }
        qrScanBusy.current = true;
        try {
          if (!progress.success || !progress.payload || progress.type !== 'P') {
            throw new Error(progress.error || 'errors.qrWrongType');
          }
          const active = seedRef.current;
          if (!active) {
            throw new Error('errors.selectSeed');
          }
          let seedBytes = secretSession.current.copySeed();
          if (!seedBytes) {
            const entropy = await loadEntropy(active.id);
            seedBytes = toBip32Seed(entropy, active.backup ?? 'bip39', '');
          }
          try {
            const preview = previewPsbt(seedBytes, progress.payload);
            const ok = await confirmation.confirm(psbtToSigningRequest(preview));
            if (!ok) {
              return { status: 'rejected' };
            }
            const signed = signPsbtBytes(seedBytes, progress.payload);
            const frames = encodeBbqr('P', signed.psbt).frames;
            appendAppLog('sign', `qr bbqr-psbt ${preview.path}`);
            return {
              status: 'complete',
              qr: {
                ur: frames[0] ?? '',
                parts: frames,
                path: preview.path,
                address: preview.address,
                fingerprint: preview.fingerprint,
                name: 'CWS',
                urKind: 'bbqr',
              },
            };
          } finally {
            seedBytes.fill(0);
          }
        } finally {
          bbqrDecoder.current.reset();
          qrScanBusy.current = false;
        }
      }
      const progress = qrDecoder.current.receive(part);
      if (!progress.complete) {
        return { status: 'progress', received: progress.received, expected: progress.expected };
      }
      qrScanBusy.current = true;
      try {
        if (!progress.success || !progress.cbor || !progress.type) {
          throw new Error(progress.error || 'errors.qrBadUr');
        }
        const active = seedRef.current;
        if (!active) {
          throw new Error('errors.selectSeed');
        }
        let seedBytes = secretSession.current.copySeed();
        if (!seedBytes) {
          const entropy = await loadEntropy(active.id);
          seedBytes = toBip32Seed(entropy, active.backup ?? 'bip39', '');
        }
        try {
          if (progress.type === 'crypto-psbt') {
            const preview = previewCryptoPsbt(seedBytes, progress.cbor);
            const ok = await confirmation.confirm(psbtToSigningRequest(preview));
            if (!ok) {
              return { status: 'rejected' };
            }
            const qr = signCryptoPsbt(seedBytes, progress.cbor);
            appendAppLog('sign', `qr crypto-psbt ${preview.path}`);
            return { status: 'complete', qr };
          }
          if (progress.type === 'sol-sign-request') {
            const request = decodeSolSignRequest(progress.cbor);
            const ok = await confirmation.confirm(solSignToSigningRequest(request));
            if (!ok) {
              return { status: 'rejected' };
            }
            const qr = signSolRequest(seedBytes, request);
            appendAppLog('sign', `qr sol ${request.path}`);
            return { status: 'complete', qr };
          }
          if (progress.type === 'cosmos-sign-request') {
            const request = decodeCosmosSignRequest(progress.cbor);
            const ok = await confirmation.confirm(cosmosSignToSigningRequest(request));
            if (!ok) {
              return { status: 'rejected' };
            }
            const qr = signCosmosRequest(seedBytes, request);
            appendAppLog('sign', `qr cosmos ${request.path}`);
            return { status: 'complete', qr };
          }
          if (progress.type === 'btc-sign-request') {
            const request = decodeBtcSignRequest(progress.cbor);
            const ok = await confirmation.confirm(btcMessageToSigningRequest(request));
            if (!ok) {
              return { status: 'rejected' };
            }
            const qr = signBtcMessage(seedBytes, request);
            appendAppLog('sign', `qr btc-msg ${request.path}`);
            return { status: 'complete', qr };
          }
          if (progress.type !== 'eth-sign-request') {
            throw new Error('errors.qrWrongType');
          }
          const request = decodeEthSignRequest(progress.cbor);
          assertEthSignMatchesSeed(seedBytes, request);
          const signing = ethSignToSigningRequest(request);
          const ok = await confirmation.confirm(signing);
          if (!ok) {
            return { status: 'rejected' };
          }
          const signed = signEthRequest(seedBytes, request, request.origin ?? 'CWS');
          appendAppLog('sign', `qr ${request.dataType} ${request.path}`);
          return { status: 'complete', qr: signed.qr };
        } finally {
          seedBytes.fill(0);
        }
      } finally {
        qrDecoder.current.reset();
        qrScanBusy.current = false;
      }
    },
    [appendAppLog, confirmation],
  );

  const setApp = useCallback((app: LedgerApp) => {
    currentAppRef.current = app;
    handlerRef.current?.setApp?.(app);
    setCurrentApp(app);
    appendAppLog('app', `OPEN_APP ${app}`);
  }, [appendAppLog]);

  const applySessionPassphrase = useCallback(async (value: string) => {
    try {
      if (!(await requestUnlock(translate(settingsRef.current.language, 'unlock.prompt')))) {
        return false;
      }
    } catch (err) {
      setError(translate(settingsRef.current.language, err instanceof Error ? err.message : 'unlock.failed'));
      return false;
    }
    try {
      secretSession.current.applyPassphraseText(value);
    } catch (err) {
      setError(translate(settingsRef.current.language, err instanceof Error ? err.message : 'errors.passphraseFailed'));
      return false;
    }
    const seedBytes = secretSession.current.copySeed();
    if (seedBytes) {
      handlerRef.current?.replaceSeed?.(seedBytes, secretSession.current.copyIcarusRoot());
    }
    setSessionPassphraseApplied(secretSession.current.passphraseApplied);
    setPassphraseFingerprint(
      secretSession.current.passphraseApplied ? secretSession.current.fingerprint : null,
    );
    return true;
  }, []);

  const clearSessionPassphrase = useCallback(() => {
    secretSession.current.clearPassphrase();
    const seedBytes = secretSession.current.copySeed();
    if (seedBytes) {
      handlerRef.current?.replaceSeed?.(seedBytes, secretSession.current.copyIcarusRoot());
    }
    setSessionPassphraseApplied(false);
    setPassphraseFingerprint(null);
  }, []);

  const resolveSigning = useCallback(async (ok: boolean) => {
    const request = pendingRef.current?.request;
    if (
      ok &&
      request?.kind === 'sign' &&
      settingsRef.current.signReauth
    ) {
      try {
        if (!(await requestUnlock(translate(settingsRef.current.language, 'unlock.prompt')))) {
          pendingRef.current?.resolve(false);
          pendingRef.current = null;
          setPending(null);
          appendAppLog('sign', 'reject');
          return;
        }
      } catch (err) {
        pendingRef.current?.resolve(false);
        pendingRef.current = null;
        setPending(null);
        appendAppLog('sign', 'reject');
        setError(translate(settingsRef.current.language, err instanceof Error ? err.message : 'unlock.failed'));
        return;
      }
    }
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
    appendAppLog(ok ? 'sign' : 'sign', ok ? 'confirm' : 'reject');
  }, [appendAppLog]);

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
      passphraseFingerprint,
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
      exportQrAccount,
      scanQrSign,
      resetQrScan,
      showToast,
      loading,
      hydrated,
      disclaimerAccepted,
      acceptDisclaimer,
      clearAllData,
      runWithLoading,
    }),
    [
      acceptDisclaimer,
      advertising,
      clearAllData,
      appendAppLog,
      catalog,
      clearLogs,
      connected,
      connectedLabel,
      currentApp,
      exportQrAccount,
      scanQrSign,
      resetQrScan,
      disclaimerAccepted,
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
      passphraseFingerprint,
      applySessionPassphrase,
      clearSessionPassphrase,
      setApp,
      settings,
      showToast,
      startSimulation,
      stopSimulation,
      toast,
      unlock,
      updateLedgerCatalog,
      unlockedUntil,
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
