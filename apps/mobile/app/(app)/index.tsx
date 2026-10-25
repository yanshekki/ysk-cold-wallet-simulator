import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
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
  } = useAppState();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [appSheet, setAppSheet] = useState(false);
  const [appPicked, setAppPicked] = useState(false);
  const [passSheet, setPassSheet] = useState(false);
  const [passDraft, setPassDraft] = useState('');

  useEffect(() => {
    if (!advertising) {
      setPassSheet(false);
      setPassDraft('');
      setAppSheet(false);
      setAppPicked(false);
    }
  }, [advertising]);

  const isLedger = model?.protocol === 'ledger-apdu';
  const canStart = !!seed && !!model && isSimulatable(model) && !advertising;
  const pickerApps = ledgerPickerApps();

  const onSelect = (next: DeviceModel) => {
    if (!isSimulatable(next)) {
      return;
    }
    if (advertising && model?.id !== next.id) {
      void stopSimulation();
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
                    {!seed ? <Text style={styles.hint}>{t('device.selectSeed')}</Text> : null}
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
                        <Button label={t('device.stop')} variant="danger" onPress={() => void stopSimulation()} />
                      </>
                    ) : (
                      <Button
                        testID="device-start"
                        label={busy ? '…' : t('device.start')}
                        disabled={!canStart || busy}
                        onPress={() => void onStart()}
                      />
                    )}
                    {error || localError ? <Text style={styles.error}>{localError ?? error}</Text> : null}
                  </View>
                ) : null}
              </DeviceCard>
            );
          })}
        </View>
      ))}
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
});
