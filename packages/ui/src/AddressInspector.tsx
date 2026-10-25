import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, hairline, radius, space } from './theme';

export type InspectRow = {
  id: string;
  label: string;
  path: string;
  address: string;
};

type Props = {
  rows: InspectRow[];
  passphrase?: string;
  onPassphrase?: (value: string) => void;
  onCopy: (value: string) => void;
  warning?: string | null;
  hint?: string;
  title?: string;
  copyPathLabel?: string;
  copyIcon?: ReactNode;
  createIcon?: ReactNode;
  passphrasePlaceholder?: string;
  showCreateNear?: boolean;
  onCreateNear?: () => void;
};

export function AddressInspector({
  rows,
  passphrase = '',
  onPassphrase,
  onCopy,
  warning,
  hint,
  title,
  copyPathLabel = 'path',
  copyIcon,
  createIcon,
  passphrasePlaceholder = 'Passphrase',
  showCreateNear = false,
  onCreateNear,
}: Props) {
  return (
    <View style={styles.box}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {onPassphrase ? (
        <TextInput
          value={passphrase}
          onChangeText={onPassphrase}
          placeholder={passphrasePlaceholder}
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
      ) : null}
      {warning ? <Text style={styles.warning}>{warning}</Text> : null}
      {rows.map((row) => {
        const nearCreate = row.id === 'near' && showCreateNear && onCreateNear;
        return (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${row.label}`}
            onPress={() => onCopy(row.address)}
            style={styles.row}
          >
            <View style={styles.rowHead}>
              <Text style={styles.label}>{row.label}</Text>
              <View style={styles.copyHit}>
                {nearCreate ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Derive NEAR account"
                    onPress={onCreateNear}
                    hitSlop={8}
                    style={styles.iconHit}
                  >
                    {createIcon ?? <Text style={styles.plus}>+</Text>}
                  </Pressable>
                ) : null}
                <Pressable onPress={() => onCopy(row.path)} hitSlop={8} style={styles.iconHit}>
                  {copyIcon ?? <Text style={styles.copyPath}>{copyPathLabel}</Text>}
                </Pressable>
              </View>
            </View>
            <Text style={styles.path}>{row.path}</Text>
            <Text style={styles.address} selectable>
              {row.address}
            </Text>
          </Pressable>
        );
      })}
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
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  hint: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  warning: {
    color: colors.accent,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    fontFamily: fonts.mono,
    paddingHorizontal: space.md,
    minHeight: 40,
  },
  row: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space.sm,
    gap: 4,
    backgroundColor: colors.bg,
  },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  copyHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconHit: {
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    color: colors.ok,
    fontFamily: fonts.monoBold,
    fontSize: 18,
  },
  copyPath: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
  },
  label: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 13,
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
