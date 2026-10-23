import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { Brand, DeviceModel, LedgerApp } from '@cws/contracts';
import {
  ALL_MODELS,
  LEDGER_APPS,
  bleAdvertiseName,
  ledgerAppChip,
  ledgerAppLabel,
} from '@cws/contracts';
import { isSimulatable } from '@cws/sdk';
import { BRAND_LABEL, Button, DeviceCard, Screen, SelectSheet, colors, space } from '@cws/ui';
import { copyText } from '../../src/lab/copy';
import { useAppState } from '../../src/state/AppState';

const BRANDS: Brand[] = ['ledger', 'trezor', 'onekey'];

export default function DeviceScreen() {
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
  } = useAppState();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [appSheet, setAppSheet] = useState(false);

  const isLedger = model?.protocol === 'ledger-apdu';
  const canStart = !!seed && !!model && isSimulatable(model) && !advertising;

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
    setCopied(label);
    setTimeout(() => setCopied(null), 1400);
  };

  const onStart = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await startSimulation();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'failed to advertise');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      kicker="Device"
      title={model?.name ?? 'Select a model'}
      subtitle="The phone is the hardware wallet. Hosts scan this Service UUID and local name."
      edges={[]}
    >
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
                badge={ready ? undefined : 'Not implemented'}
                onSelect={() => onSelect(item)}
                onCopyName={() => void onCopy('name', bleAdvertiseName(item))}
                onCopyUuid={() => void onCopy('uuid', item.serviceUUID)}
              >
                {model?.id === item.id ? (
                  <View style={styles.bezelActions}>
                    {copied ? <Text style={styles.copied}>Copied {copied}</Text> : null}
                    {!seed ? (
                      <Text style={styles.hint}>Select a seed in Vault before starting the radio.</Text>
                    ) : null}
                    {seed?.backup === 'slip39' && item.brand === 'ledger' ? (
                      <Text style={styles.hint}>
                        Ledger Live expects BIP39. This SLIP-39 slot will not match a Ledger-restored seed.
                      </Text>
                    ) : null}
                    {advertising ? (
                      <>
                        <Text style={styles.live}>
                          {connected ? 'Host on GATT' : `Advertising as ${bleAdvertiseName(item)}`}
                        </Text>
                        {isLedger ? (
                          <>
                            <Text style={styles.appNow}>{ledgerAppLabel(currentApp)}</Text>
                            <Button
                              label="Select app"
                              variant="ghost"
                              onPress={() => setAppSheet(true)}
                            />
                            <SelectSheet
                              visible={appSheet}
                              title="Open Ledger app"
                              selectedId={currentApp}
                              options={LEDGER_APPS.map((app) => ({
                                id: app,
                                label: ledgerAppLabel(app),
                                chip: ledgerAppChip(app),
                              }))}
                              onSelect={(id) => {
                                setApp(id as LedgerApp);
                                setAppSheet(false);
                              }}
                              onClose={() => setAppSheet(false)}
                            />
                            <Text style={styles.hint}>
                              Host can OPEN_APP from Ledger Wallet. This picker is the device screen.
                            </Text>
                          </>
                        ) : null}
                        <Button label="Stop radio" variant="danger" onPress={() => void stopSimulation()} />
                      </>
                    ) : (
                      <Button
                        label={busy ? 'Starting…' : 'Start radio'}
                        disabled={!canStart || busy}
                        onPress={() => void onStart()}
                      />
                    )}
                    <Text style={styles.radioHint}>
                      {Platform.OS === 'ios'
                        ? 'iOS must stay in the foreground while advertising.'
                        : Platform.OS === 'android'
                          ? 'Android keeps advertising with a persistent notification.'
                          : 'BLE advertising needs a physical Android or iOS device.'}
                    </Text>
                    {error || localError ? (
                      <Text style={styles.error}>{localError ?? error}</Text>
                    ) : null}
                  </View>
                ) : null}
              </DeviceCard>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: space.sm,
  },
  groupLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  bezelActions: {
    marginTop: space.sm,
    gap: space.sm,
  },
  copied: {
    color: colors.ok,
    fontSize: 12,
  },
  hint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  live: {
    color: colors.ok,
    fontSize: 13,
    fontWeight: '600',
  },
  appNow: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  radioHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: colors.danger,
  },
});
