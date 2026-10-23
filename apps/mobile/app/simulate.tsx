import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApduLog, Button, Screen, SigningModal, colors, space } from '@cws/ui';
import { useAppState } from '../src/state/AppState';

export default function SimulateScreen() {
  const {
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
    startSimulation,
    stopSimulation,
    setApp,
    setPassphrase,
    resolveSigning,
  } = useAppState();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const isLedger = model?.protocol === 'ledger-apdu';
  const modelName = model?.name ?? 'device';

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
      title={`${modelName} simulation`}
      subtitle="Requires a physical Android device. Host apps may still reject this simulator if they check device certificates — transport answers are real, attestation is not faked."
    >
      <View style={styles.status}>
        <Text style={styles.meta}>
          {model?.name ?? 'No model'} · {seed?.label ?? 'No seed'}
        </Text>
        <Text style={styles.value}>
          {advertising
            ? connected
              ? `Host connected (${connectedLabel})`
              : `Advertising as ${modelName}`
            : 'Stopped'}
        </Text>
        {isLedger ? (
          <Text style={styles.meta}>
            App: {currentApp === 'ethereum' ? 'Ethereum' : 'BOLOS dashboard'}
          </Text>
        ) : (
          <Text style={styles.meta}>Firmware answers Initialize, Features, and ETH signing.</Text>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {localError ? <Text style={styles.error}>{localError}</Text> : null}
      {!advertising ? (
        <Button label={busy ? 'Starting…' : 'Start advertising'} disabled={busy} onPress={() => void onStart()} />
      ) : (
        <>
          {isLedger ? (
            <Button
              label={currentApp === 'ethereum' ? 'Return to dashboard' : 'Open Ethereum app'}
              variant="ghost"
              onPress={() => setApp(currentApp === 'ethereum' ? 'dashboard' : 'ethereum')}
            />
          ) : null}
          <Button label="Stop" variant="danger" onPress={() => void stopSimulation()} />
        </>
      )}
      <ApduLog entries={logs} emptyLabel="Waiting for host traffic…" />
      <SigningModal
        visible={!!pending}
        request={pending}
        passphrase={passphrase}
        onChangePassphrase={setPassphrase}
        onConfirm={() => resolveSigning(true)}
        onReject={() => resolveSigning(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: {
    gap: 6,
    marginBottom: space.sm,
  },
  meta: {
    color: colors.muted,
  },
  value: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  error: {
    color: colors.danger,
  },
});
