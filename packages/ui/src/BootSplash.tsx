import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, hairline, space } from './theme';

type Props = {
  label?: string;
  version?: string;
};

export function BootSplash({ label = 'Loading', version }: Props) {
  return (
    <View style={styles.root} accessibilityLabel={label}>
      <Text style={styles.mark}>CWS</Text>
      <View style={styles.rule} />
      <ActivityIndicator color={colors.ok} />
      <Text style={styles.label}>{label}</Text>
      {version ? <Text style={styles.version}>{version}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
  },
  mark: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: 8,
  },
  rule: {
    width: 48,
    height: hairline,
    backgroundColor: colors.accent,
    marginBottom: space.sm,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  version: {
    color: colors.muted,
    fontSize: 11,
    marginTop: space.sm,
  },
});
