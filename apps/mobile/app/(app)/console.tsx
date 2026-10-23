import { StyleSheet, Text } from 'react-native';
import { ApduLog, Screen, colors } from '@cws/ui';
import { copyText } from '../../src/lab/copy';
import { useAppState } from '../../src/state/AppState';

export default function ConsoleScreen() {
  const { model, seed, advertising, connected, connectedLabel, logs, error } = useAppState();
  const host = connected ? connectedLabel : advertising ? `ADV ${model?.name ?? ''}` : 'Idle';

  return (
    <Screen
      kicker="Console"
      title={host}
      subtitle={
        seed
          ? `${model?.name ?? 'Device'} · ${seed.label}`
          : 'Select a seed in Vault, then advertise from Device.'
      }
      scroll={false}
      edges={[]}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ApduLog
        fill
        entries={logs}
        emptyLabel="Waiting for host… advertise from Device."
        onCopyLast={(hex) => void copyText(hex)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: {
    color: colors.danger,
  },
});
