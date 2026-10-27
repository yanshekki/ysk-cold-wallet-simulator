import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from './Button';
import { KeyboardAvoidingView } from './keyboard';
import { colors, fonts, hairline, radius, space } from './theme';

export type SelectSheetOption = {
  id: string;
  label: string;
  chip?: string;
};

type Props = {
  visible: boolean;
  title: string;
  selectedId?: string;
  options: SelectSheetOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
  cancelLabel?: string;
  searchPlaceholder?: string;
  testIDPrefix?: string;
};

export function SelectSheet({
  visible,
  title,
  selectedId,
  options,
  onSelect,
  onClose,
  cancelLabel = 'Cancel',
  searchPlaceholder = 'Search',
  testIDPrefix,
}: Props) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) {
      setQuery('');
    }
  }, [visible]);
  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.id.toLowerCase().includes(needle) ||
        (option.chip ?? '').toLowerCase().includes(needle),
    );
  }, [options, query]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.frame}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <View style={styles.sheet}>
          <Text style={styles.kicker}>{title}</Text>
          {options.length > 12 ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.search}
            />
          ) : null}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {visibleOptions.map((option) => {
              const active = option.id === selectedId;
              return (
                <Pressable
                  key={option.id}
                  testID={testIDPrefix ? `${testIDPrefix}${option.id}` : undefined}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => onSelect(option.id)}
                  style={[styles.row, active && styles.rowOn]}
                >
                  <Text style={[styles.label, active && styles.labelOn]}>{option.label}</Text>
                  {option.chip ? (
                    <Text style={[styles.chip, active && styles.chipOn]}>{option.chip}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Button label={cancelLabel} variant="ghost" onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: space.lg,
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
    maxHeight: '72%',
  },
  kicker: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 10,
  },
  search: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    fontFamily: fonts.mono,
    paddingHorizontal: space.md,
    minHeight: 40,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 6,
    paddingVertical: 4,
  },
  row: {
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: hairline,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowOn: {
    borderColor: colors.ok,
    backgroundColor: colors.bg,
  },
  label: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
  },
  labelOn: {
    color: colors.ok,
  },
  chip: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  chipOn: {
    color: colors.ok,
  },
});
