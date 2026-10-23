import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { Brand, DeviceModel } from '@cws/contracts';
import { ALL_MODELS } from '@cws/contracts';
import { isSimulatable } from '@cws/sdk';
import { BRAND_LABEL, Button, DeviceCard, Screen, colors, space } from '@cws/ui';
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
                onCopyName={() => void onCopy('name', item.name)}
                onCopyUuid={() => void onCopy('uuid', item.serviceUUID)}
              >
                {model?.id === item.id ? (
                  <View style={styles.bezelActions}>
                    {copied ? <Text style={styles.copied}>Copied {copied}</Text> : null}
                    {!seed ? (
                      <Text style={styles.hint}>Select a seed in Vault before starting the radio.</Text>
                    ) : null}
                    {advertising ? (
                      <>
                        <Text style={styles.live}>
                          {connected ? 'Host on GATT' : `Advertising as ${item.name}`}
                        </Text>
                        {isLedger ? (
                          <Button
                            label={currentApp === 'ethereum' ? 'BOLOS dashboard' : 'Ethereum app'}
                            variant="ghost"
                            onPress={() => setApp(currentApp === 'ethereum' ? 'dashboard' : 'ethereum')}
                          />
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
  radioHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: colors.danger,
  },
});
