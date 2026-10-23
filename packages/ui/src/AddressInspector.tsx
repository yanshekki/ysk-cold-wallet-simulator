import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, radius, space } from './theme';

export type InspectRow = {
  id: string;
  label: string;
  path: string;
  address: string;
};

type Props = {
  rows: InspectRow[];
  passphrase: string;
  onPassphrase: (value: string) => void;
  onCopy: (value: string) => void;
  warning?: string | null;
  hint?: string;
};

export function AddressInspector({ rows, passphrase, onPassphrase, onCopy, warning, hint }: Props) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Derived accounts</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        value={passphrase}
        onChangeText={onPassphrase}
        placeholder="Optional passphrase (not stored)"
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
      {warning ? <Text style={styles.warning}>{warning}</Text> : null}
      {rows.map((row) => (
        <Pressable
          key={row.id}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${row.label}`}
          onPress={() => onCopy(row.address)}
          style={styles.row}
        >
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.path}>{row.path}</Text>
          <Text style={styles.address} selectable>
            {row.address}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: space.sm,
    gap: space.sm,
  },
  title: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  warning: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space.sm,
    gap: 4,
    backgroundColor: colors.bg,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  path: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  address: {
    color: colors.ok,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
});
