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
    pairingCode,
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
  const isTrezor = model?.protocol === 'thp';
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
      subtitle="Android keeps advertising via a foreground notification. iOS must stay in the foreground. Host apps may still reject this simulator if they check device certificates — transport answers are real, attestation is not faked."
    >
      <View style={styles.status}>
        <Text style={styles.meta}>
          {model?.name ?? 'No model'} · {seed?.label ?? 'No seed'}
        </Text>
        <Text style={styles.value}>
          {advertising
            ? connected
              ? `Host connected (${connectedLabel})`
              : `Advertising as ${modelName} — Android shows a persistent notification`
            : 'Stopped'}
        </Text>
        {isLedger ? (
          <Text style={styles.meta}>
            App: {currentApp === 'ethereum' ? 'Ethereum' : 'BOLOS dashboard'}
          </Text>
        ) : isTrezor ? (
          <Text style={styles.meta}>
            THP: Noise XX, Code Entry pairing, then Initialize / ETH. Hosts may still reject without
            attestation.
          </Text>
        ) : (
          <Text style={styles.meta}>Firmware answers Initialize, Features, and ETH signing.</Text>
        )}
        {pairingCode ? (
          <View>
            <Text style={styles.meta}>Pairing code — type this on the host</Text>
            <Text style={styles.code}>{pairingCode}</Text>
          </View>
        ) : null}
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
  code: {
    color: colors.ok,
    fontFamily: 'Courier',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 8,
    marginTop: 4,
  },
  error: {
    color: colors.danger,
  },
});
