import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ApduLogEntry } from '@cws/contracts';
import { colors, radius, space } from './theme';

type Props = {
  entries: ApduLogEntry[];
};

export function ApduLog({ entries }: Props) {
  return (
    <ScrollView style={styles.box} contentContainerStyle={styles.inner}>
      {entries.length === 0 ? (
        <Text style={styles.empty}>Waiting for host APDUs…</Text>
      ) : (
        entries.map((entry) => (
          <View key={entry.id} style={styles.row}>
            <Text style={[styles.dir, entry.direction === 'in' ? styles.in : styles.out]}>
              {entry.direction === 'in' ? 'RX' : 'TX'}
            </Text>
            <View style={styles.copy}>
              {entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}
              <Text style={styles.hex}>{entry.hex}</Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: 180,
    maxHeight: 320,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  inner: {
    padding: space.sm,
    gap: 8,
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  dir: {
    fontSize: 11,
    fontWeight: '700',
    width: 24,
    marginTop: 2,
  },
  in: {
    color: colors.ok,
  },
  out: {
    color: colors.accent,
  },
  copy: {
    flex: 1,
  },
  note: {
    color: colors.muted,
    fontSize: 11,
  },
  hex: {
    color: colors.text,
    fontFamily: 'Courier',
    fontSize: 11,
  },
});
