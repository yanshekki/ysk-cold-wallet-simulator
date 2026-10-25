import { Alert, StyleSheet, Text, View } from 'react-native';
import { LogEditor, colors, space } from '@cws/ui';
import { copyText, exportText } from '../../src/lab/copy';
import { useT } from '../../src/i18n';
import { useAppState } from '../../src/state/AppState';

export default function ConsoleScreen() {
  const t = useT();
  const { logs, error, settings, clearLogs, showToast } = useAppState();

  const onClear = () => {
    if (!settings.confirmClearLogs) {
      clearLogs();
      return;
    }
    Alert.alert(t('console.clearTitle'), t('console.clearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('console.clear'), style: 'destructive', onPress: clearLogs },
    ]);
  };

  return (
    <View style={styles.body}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <LogEditor
        entries={logs}
        emptyLabel={t('console.waiting')}
        onCopy={(text) => {
          void copyText(text).then(() => showToast(t('common.copied')));
        }}
        onClear={onClear}
        onExport={(text) => void exportText('cws-console.txt', text)}
        labels={{
          search: t('console.search'),
          all: t('console.all'),
          rx: t('console.rx'),
          tx: t('console.tx'),
          wrap: t('console.wrap'),
          follow: t('console.follow'),
          prev: t('console.prev'),
          next: t('console.next'),
          copyLine: t('console.copyLine'),
          copyMatch: t('console.copyMatch'),
          copyAll: t('console.copyAll'),
          export: t('console.export'),
          clear: t('console.clear'),
          latest: t('console.latest'),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    gap: space.sm,
    backgroundColor: colors.bg,
  },
  error: {
    color: colors.danger,
  },
});
