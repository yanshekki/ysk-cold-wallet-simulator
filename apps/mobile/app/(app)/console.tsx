import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogEditor, colors, space } from '@cws/ui';
import { copyText, exportText } from '../../src/lab/copy';
import { useAppState } from '../../src/state/AppState';

export default function ConsoleScreen() {
  const { logs, error, clearLogs } = useAppState();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.body}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <LogEditor
          entries={logs}
          onCopy={(text) => void copyText(text)}
          onClear={clearLogs}
          onExport={(text) => void exportText('cws-console.txt', text)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    gap: space.sm,
  },
  error: {
    color: colors.danger,
  },
});
