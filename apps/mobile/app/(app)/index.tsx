import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  QR_PROFILES,
  defaultQrFormat,
  groupQrFormats,
  isQrFormatId,
  qrFormatDetail,
  qrFormatsFor,
  type EthAirgapQr,
  type QrFormatId,
  type QrProfile,
} from '@cws/protocol-qr';
import type { Brand, DeviceModel, LedgerApp } from '@cws/contracts';
import {
  ALL_MODELS,
  bleAdvertiseName,
  ledgerAppChip,
  ledgerAppLabel,
  ledgerPickerApps,
} from '@cws/contracts';
import { isSimulatable } from '@cws/sdk';
import {
  BRAND_LABEL,
  Button,
  DeviceCard,
  GroupedSelectSheet,
  Screen,
  SelectSheet,
  Sheet,
  colors,
  fonts,
  hairline,
  radius,
  space,
} from '@cws/ui';
import { copyText } from '../../src/lab/copy';
import { QrMatrix } from '../../src/qr/QrMatrix';
import { QrScanner } from '../../src/qr/QrScanner';
import { useT } from '../../src/i18n';
import { useAppState } from '../../src/state/AppState';

const BRANDS: Brand[] = ['ledger', 'trezor', 'onekey'];

export default function DeviceScreen() {
  const t = useT();
  const {
    model,
    seed,
    advertising,
    connected,
    currentApp,
    error,
    selectModel,
    startSimulation,
    stopSimulation,
    setApp,
    showToast,
    hydrated,
    sessionPassphraseApplied,
    passphraseFingerprint,
    applySessionPassphrase,
    clearSessionPassphrase,
    exportQrAccount,
    scanQrSign,
    resetQrScan,
    runWithLoading,
    pending,
  } = useAppState();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [appSheet, setAppSheet] = useState(false);
  const [appPicked, setAppPicked] = useState(false);
  const [passSheet, setPassSheet] = useState(false);
  const [passDraft, setPassDraft] = useState('');
  const [qrSheet, setQrSheet] = useState(false);
  const [qr, setQr] = useState<EthAirgapQr | null>(null);
  const [qrProfile, setQrProfile] = useState<QrProfile | null>(null);
  const [formatSheet, setFormatSheet] = useState(false);
  const [formatOpening, setFormatOpening] = useState(false);
  const [qrRefreshing, setQrRefreshing] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ received: number; expected: number } | null>(null);
  const lastPart = useRef('');

  useEffect(() => {
    if (!advertising) {
      setPassSheet(false);
      setPassDraft('');
      setAppSheet(false);
      setAppPicked(false);
    }
  }, [advertising]);

  useEffect(() => {
    if (pending) {
      setScanOpen(false);
    }
  }, [pending]);

  const isLedger = model?.protocol === 'ledger-apdu';
  const canStart = !!seed && !!model && isSimulatable(model) && !advertising;
  const pickerApps = ledgerPickerApps();

  const onSelect = (next: DeviceModel) => {
    if (!isSimulatable(next)) {
      return;
    }
    if (advertising && model?.id !== next.id) {
      void stopSimulation().then(() => {
        selectModel(next);
        setLocalError(null);
      });
      return;
    }
    selectModel(next);
    setLocalError(null);
  };

  const onCopy = async (label: string, value: string) => {
    await copyText(value);
    showToast(t('common.copied'));
    void label;
  };

  const onStart = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await startSimulation();
    } catch (err) {
      setLocalError(err instanceof Error ? t(err.message) : t('errors.advertiseFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onOpenQr = (profile: QrProfile, format?: QrFormatId) => {
    if (!seed) {
      setLocalError(t('device.qrNeedSeed'));
      return;
    }
    const nextFormat = format ?? defaultQrFormat(profile);
    void runWithLoading(t('device.qrPreparing'), () => exportQrAccount(profile, nextFormat))
      .then((next) => {
        setQr(next);
        setQrProfile(profile);
        setQrSheet(true);
        setQrRefreshing(false);
        setLocalError(null);
      })
      .catch((err) => {
        setLocalError(err instanceof Error ? t(err.message) : t('device.qrNeedSeed'));
      });
  };

  const onRefreshQrFormat = (profile: QrProfile, format: QrFormatId) => {
    if (!seed) {
      setLocalError(t('device.qrNeedSeed'));
      return;
    }
    setFormatSheet(false);
    setFormatOpening(false);
    setQrRefreshing(true);
    void exportQrAccount(profile, format)
      .then((next) => {
        setQr(next);
        setQrProfile(profile);
        setLocalError(null);
      })
      .catch((err) => {
        setLocalError(err instanceof Error ? t(err.message) : t('device.qrNeedSeed'));
      })
      .finally(() => {
        setQrRefreshing(false);
      });
  };

  const closeScan = () => {
    setScanOpen(false);
    setScanProgress(null);
    lastPart.current = '';
    resetQrScan();
  };

  const onOpenScan = () => {
    if (!seed) {
      setLocalError(t('device.qrNeedSeed'));
      return;
    }
    lastPart.current = '';
    setScanProgress(null);
    resetQrScan();
    setScanOpen(true);
    setLocalError(null);
  };

  const onScanPart = (part: string) => {
    if (part === lastPart.current) {
      return;
    }
    lastPart.current = part;
    void scanQrSign(part)
      .then((result) => {
        if (result.status === 'progress') {
          setScanProgress({ received: result.received, expected: result.expected });
          return;
        }
        closeScan();
        if (result.status === 'complete') {
          setQr(result.qr);
          setQrProfile(null);
          setQrSheet(true);
          setLocalError(null);
        }
      })
      .catch((err) => {
        closeScan();
        setLocalError(err instanceof Error ? t(err.message) : t('errors.qrBadUr'));
      });
  };

  const qrHint = (() => {
    if (qr?.urKind === 'eth-signature') {
      return t('device.qrGetSignature');
    }
    if (qr?.urKind === 'crypto-psbt' || (qr?.urKind === 'bbqr' && !qrProfile)) {
      return t('device.qrGetSignatureBtc');
    }
    if (qr?.urKind === 'sol-signature' || qr?.urKind === 'cosmos-signature' || qr?.urKind === 'btc-signature') {
      return t('device.qrGetSignatureOther');
    }
    if (!qr || !qrProfile) {
      return t('device.qrNeedSeed');
    }
    if (qr.format === 'bbqr-xpub' || qr.urKind === 'bbqr') {
      return t('device.qrHintBbqr');
    }
    if (qr.format === 'crypto-seed' || qr.urKind === 'crypto-seed') {
      return t('device.qrHintSeed');
    }
    if (qr.format === 'btc-output' || qr.urKind === 'crypto-output') {
      return t('device.qrHintOutput');
    }
    if (qr.format === 'eth-account' || qr.urKind === 'crypto-account') {
      return t('device.qrHintAccount');
    }
    if (
      qr.format === 'btc-hdkey' ||
      qr.format === 'btc-nested' ||
      qr.format === 'btc-legacy' ||
      qr.format === 'btc-taproot' ||
      qr.format === 'btc-test'
    ) {
      return t('device.qrHintBtc');
    }
    if (qr.format === 'eth-multi' || qr.urKind === 'crypto-multi-accounts') {
      return t('device.qrHintMulti');
    }
    if (qrProfile.walletHint === 'metamask') {
      return t('device.qrHintMetamask');
    }
    return t('device.qrHintRabby', { name: t(`device.qrBrand.${qrProfile.id}`) });
  })();
  const qrFormat = qr?.format ?? (qrProfile ? defaultQrFormat(qrProfile) : 'eth-hdkey');
  const showFormatPicker = Boolean(qrProfile);
  const formatDefaultId = qrProfile ? defaultQrFormat(qrProfile) : null;
  const formatBusy = formatOpening || formatSheet || qrRefreshing;

  const openFormatPicker = useCallback(() => {
    if (qrRefreshing || formatSheet || formatOpening) {
      return;
    }
    // Paint spinner/overlay first so the tap feels instant, then open the picker.
    setFormatOpening(true);
    requestAnimationFrame(() => {
      setFormatSheet(true);
      setFormatOpening(false);
    });
  }, [formatOpening, formatSheet, qrRefreshing]);

  const formatGroups = useMemo(() => {
    if (!qrProfile) {
      return [];
    }
    return groupQrFormats(qrFormatsFor(qrProfile)).map((group) => ({
      id: group.id,
      label: t(`device.qrFormatGroup.${group.id}`),
      options: group.formats.map((id) => {
        const isDefault = id === formatDefaultId;
        const chip =
          id === 'crypto-seed'
            ? t('device.qrFormatGroup.sensitive')
            : isDefault
              ? t('device.qrFormatDefault')
              : id === 'eth-multi'
                ? 'OKX'
                : id === 'eth-hdkey' || id === 'eth-account'
                  ? t('device.qrWalletsRabby')
                  : id === 'bbqr-xpub'
                    ? 'Sparrow'
                    : undefined;
        return {
          id,
          label: t(`device.qrFormatOption.${id}`),
          subtitle: qrFormatDetail(id),
          chip,
          danger: id === 'crypto-seed',
        };
      }),
    }));
  }, [formatDefaultId, qrProfile, t]);

  if (!hydrated) {
    return (
      <Screen kicker={t('device.kicker')} title={model?.name ?? 'CWS'} edges={[]}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.ok} />
          <Text style={styles.hint}>{t('common.loading')}</Text>
        </View>
        {Array.from({ length: 4 }).map((_, index) => (
          <View key={index} style={styles.skeleton} />
        ))}
      </Screen>
    );
  }

  const closePassSheet = () => {
    setPassDraft('');
    setPassSheet(false);
  };

  const onApplyPassphrase = async () => {
    const ok = await applySessionPassphrase(passDraft);
    if (ok) {
      setPassDraft('');
      setPassSheet(false);
    }
  };

  const onClearPassphrase = () => {
    Alert.alert(t('device.passphraseClearTitle'), t('device.passphraseClearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('device.passphraseClear'),
        style: 'destructive',
        onPress: clearSessionPassphrase,
      },
    ]);
  };

  return (
    <>
    <Screen kicker={t('device.kicker')} title={model?.name ?? 'CWS'} edges={[]}>
      {BRANDS.map((brand) => (
        <View key={brand} style={styles.group}>
          <Text style={styles.groupLabel}>{BRAND_LABEL[brand]}</Text>
          {ALL_MODELS.filter((item) => item.brand === brand).map((item) => {
            const ready = isSimulatable(item);
            return (
              <DeviceCard
                key={item.id}
                model={item}
                selected={model?.id === item.id}
                enabled={ready}
                badge={ready ? undefined : t('device.notImplemented')}
                onSelect={() => onSelect(item)}
                onCopyName={() => void onCopy('name', bleAdvertiseName(item))}
                onCopyUuid={() => void onCopy('uuid', item.serviceUUID)}
              >
                {model?.id === item.id ? (
                  <View style={styles.bezelActions}>
                    {!seed ? (
                      <Text style={styles.hint} testID="device-need-seed">
                        {t('device.selectSeed')}
                      </Text>
                    ) : null}
                    {seed?.backup === 'slip39' && item.brand === 'ledger' ? (
                      <Text style={styles.hint}>{t('device.slip39Ledger')}</Text>
                    ) : null}
                    {advertising ? (
                      <>
                        <Text style={styles.live}>
                          {connected
                            ? t('device.hostGatt')
                            : t('device.advertising', { name: bleAdvertiseName(item) })}
                        </Text>
                        {isLedger ? (
                          <>
                            <Button
                              testID="device-select-app"
                              label={
                                appPicked || currentApp !== 'dashboard'
                                  ? t('device.appSelected', { app: ledgerAppLabel(currentApp) })
                                  : t('device.selectApp')
                              }
                              variant="ghost"
                              onPress={() => setAppSheet(true)}
                            />
                            <SelectSheet
                              visible={appSheet}
                              title={t('device.openApp')}
                              selectedId={currentApp}
                              testIDPrefix="device-app-"
                              options={pickerApps.map((app) => ({
                                id: app,
                                label: ledgerAppLabel(app),
                                chip: ledgerAppChip(app),
                              }))}
                              onSelect={(id) => {
                                setApp(id as LedgerApp);
                                setAppPicked(true);
                                setAppSheet(false);
                              }}
                              onClose={() => setAppSheet(false)}
                              cancelLabel={t('common.cancel')}
                              searchPlaceholder={t('common.search')}
                            />
                          </>
                        ) : null}
                        {seed?.backup !== 'slip39' ? (
                          sessionPassphraseApplied ? (
                            <Button
                              testID="device-passphrase-applied"
                              label={
                                passphraseFingerprint
                                  ? t('device.fingerprint', { hex: passphraseFingerprint })
                                  : t('device.passphraseApplied')
                              }
                              variant="ghost"
                              onPress={onClearPassphrase}
                            />
                          ) : (
                            <Button
                              testID="device-passphrase"
                              label={t('device.passphrase')}
                              variant="ghost"
                              onPress={() => setPassSheet(true)}
                            />
                          )
                        ) : null}
                        <Button
                          testID="device-stop"
                          label={t('device.stop')}
                          variant="danger"
                          onPress={() => void stopSimulation()}
                        />
                      </>
                    ) : (
                      <Button
                        testID="device-start"
                        label={busy ? '…' : t('device.start')}
                        disabled={!canStart || busy}
                        onPress={() => void onStart()}
                      />
                    )}
                    {error || localError ? (
                      <Text style={styles.error} testID="device-error">
                        {localError ?? error}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </DeviceCard>
            );
          })}
        </View>
      ))}
      <View style={styles.group}>
        <Text style={styles.groupLabel}>{t('device.qrGroup')}</Text>
        <Button
          testID="device-qr-scan"
          label={t('device.qrScan')}
          variant="ghost"
          onPress={onOpenScan}
        />
        <Text style={styles.hint}>{t('device.qrScanHint')}</Text>
        <View style={styles.qrGrid}>
          {QR_PROFILES.map((profile) => {
            const selected = qrSheet && qrProfile?.id === profile.id;
            return (
              <Pressable
                key={profile.id}
                testID={`device-qr-${profile.id}`}
                accessibilityRole="button"
                accessibilityLabel={t(`device.qrBrand.${profile.id}`)}
                onPress={() => onOpenQr(profile)}
                style={[styles.qrCard, selected && styles.qrCardSelected]}
              >
                <Text style={styles.qrBrand}>{t(`device.qrBrand.${profile.id}`)}</Text>
                <Text style={styles.qrMeta}>
                  {t(profile.walletHint === 'metamask' ? 'device.qrWalletsMetamask' : 'device.qrWalletsRabby')}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {localError ? (
          <Text style={styles.error} testID="device-qr-error">
            {localError}
          </Text>
        ) : null}
      </View>
    </Screen>
    <Sheet
      visible={passSheet}
      title={t('device.passphrase')}
      onClose={closePassSheet}
      closeLabel={t('common.close')}
      closeIcon={<Ionicons name="close" size={22} color={colors.text} />}
      testID="device-passphrase-sheet"
      footer={
        <Button testID="device-passphrase-apply" label={t('device.passphraseApply')} onPress={onApplyPassphrase} />
      }
    >
      <Text style={styles.hint}>{t('device.passphraseHint')}</Text>
      <TextInput
        testID="device-passphrase-input"
        value={passDraft}
        onChangeText={setPassDraft}
        placeholder={t('device.passphrase')}
        placeholderTextColor={colors.muted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="oneTimeCode"
        importantForAutofill="no"
        spellCheck={false}
        style={styles.input}
      />
    </Sheet>
    <QrScanner
      visible={scanOpen && !pending}
      hint={t('device.qrScanHint')}
      progressLabel={
        scanProgress && scanProgress.expected > 0
          ? t('device.qrScanProgress', {
              received: scanProgress.received,
              expected: scanProgress.expected,
            })
          : undefined
      }
      deniedLabel={t('device.qrCameraDenied')}
      allowLabel={t('device.qrAllowCamera')}
      closeLabel={t('common.close')}
      onClose={closeScan}
      onPart={onScanPart}
    />
    <Sheet
      visible={qrSheet}
      title={
        qr?.urKind === 'eth-signature' ||
        qr?.urKind === 'crypto-psbt' ||
        qr?.urKind === 'sol-signature' ||
        qr?.urKind === 'cosmos-signature' ||
        qr?.urKind === 'btc-signature' ||
        (qr?.urKind === 'bbqr' && !qrProfile)
          ? t('device.qrSignTitle')
          : qrProfile
            ? t(`device.qrBrand.${qrProfile.id}`)
            : t('device.qrTitle')
      }
      onClose={() => {
        setQrSheet(false);
        setFormatSheet(false);
        setFormatOpening(false);
        setQrRefreshing(false);
        setQr(null);
        setQrProfile(null);
      }}
      closeLabel={t('common.close')}
      closeIcon={<Ionicons name="close" size={22} color={colors.text} />}
      testID="device-qr-sheet"
      overlay={
        showFormatPicker && qrProfile && formatSheet ? (
          <GroupedSelectSheet
            embedded
            visible={formatSheet}
            title={t('device.qrFormat')}
            selectedId={qrFormat}
            groups={formatGroups}
            onSelect={(id) => {
              if (!isQrFormatId(id) || !qrProfile) {
                setFormatSheet(false);
                return;
              }
              if (id === qrFormat) {
                setFormatSheet(false);
                return;
              }
              onRefreshQrFormat(qrProfile, id);
            }}
            onClose={() => setFormatSheet(false)}
            cancelLabel={t('common.cancel')}
            searchPlaceholder={t('common.search')}
            testIDPrefix="device-qr-format-"
          />
        ) : null
      }
    >
      <Text style={styles.hint}>{qrHint}</Text>
      {qr ? (
        <>
          <View style={styles.qrStage}>
            <View
              style={[
                styles.qrMatrixWrap,
                (qrRefreshing || formatOpening) && styles.qrMatrixDimmed,
              ]}
            >
              <QrMatrix
                value={qr.ur}
                parts={qr.parts}
                paused={formatBusy}
              />
            </View>
            {qrRefreshing || formatOpening ? (
              <View style={styles.qrRefreshOverlay} pointerEvents="none">
                <ActivityIndicator color={colors.ok} />
                <Text style={styles.qrRefreshLabel}>{t('device.qrPreparing')}</Text>
              </View>
            ) : null}
          </View>
          <Text
            style={styles.hint}
            onPress={() => {
              void onCopy('address', qr.address);
            }}
          >
            {qr.address}
          </Text>
          {showFormatPicker && qrProfile ? (
            <Pressable
              testID="device-qr-path"
              accessibilityRole="button"
              accessibilityLabel={t('device.qrPathHint')}
              disabled={formatBusy}
              onPress={openFormatPicker}
              style={({ pressed }) => [
                styles.pathRow,
                pressed && !formatBusy && styles.pathRowPressed,
                formatBusy && styles.rowDisabled,
              ]}
            >
              <View style={styles.pathCopy}>
                <Text style={styles.pathValue}>{qr.path}</Text>
                <Text style={styles.pathMeta}>{t('device.qrPathFollowsFormat')}</Text>
              </View>
              {formatBusy ? (
                <ActivityIndicator color={colors.ok} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              )}
            </Pressable>
          ) : (
            <Text style={styles.hint}>{qr.path}</Text>
          )}
          {showFormatPicker && qrProfile ? (
            <Pressable
              testID="device-qr-format"
              accessibilityRole="button"
              accessibilityLabel={t('device.qrFormat')}
              disabled={formatBusy}
              onPress={openFormatPicker}
              style={({ pressed }) => [
                styles.formatRow,
                pressed && !formatBusy && styles.pathRowPressed,
                formatBusy && styles.rowDisabled,
              ]}
            >
              <Text style={styles.formatLabel}>{t('device.qrFormat')}</Text>
              <View style={styles.formatValueWrap}>
                <Text style={styles.formatValue}>{t(`device.qrFormatOption.${qrFormat}`)}</Text>
                {formatBusy ? (
                  <ActivityIndicator color={colors.ok} />
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                )}
              </View>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  skeleton: {
    minHeight: 72,
    borderRadius: radius.sm,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  group: {
    gap: space.sm,
  },
  groupLabel: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  bezelActions: {
    marginTop: space.sm,
    gap: space.sm,
  },
  hint: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  live: {
    color: colors.ok,
    fontFamily: fonts.monoMedium,
    fontSize: 12,
  },
  error: {
    color: colors.danger,
  },
  input: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    fontFamily: fonts.mono,
    paddingHorizontal: space.md,
    minHeight: 40,
  },
  qrGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  qrCard: {
    flexGrow: 1,
    flexBasis: 150,
    maxWidth: '48%',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: hairline,
    borderRadius: radius.sm,
    padding: space.md,
    minHeight: 72,
    gap: 4,
  },
  qrCardSelected: {
    borderColor: colors.accent,
  },
  qrBrand: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
  },
  qrMeta: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  qrStage: {
    alignSelf: 'center',
    width: 280,
    height: 280,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrMatrixWrap: {
    width: 280,
    height: 280,
  },
  qrMatrixDimmed: {
    opacity: 0.22,
  },
  qrRefreshOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(7, 8, 10, 0.28)',
  },
  qrRefreshLabel: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  pathRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderRadius: radius.sm,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  pathRowPressed: {
    opacity: 0.85,
  },
  pathCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  pathValue: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
  pathMeta: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
  },
  formatRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderRadius: radius.sm,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  formatLabel: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 13,
  },
  formatValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  formatValue: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  rowDisabled: {
    opacity: 0.45,
  },
});
