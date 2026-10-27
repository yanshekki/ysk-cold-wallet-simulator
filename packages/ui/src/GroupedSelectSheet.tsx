import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from './Button';
import { KeyboardAvoidingView } from './keyboard';
import { colors, fonts, hairline, radius, space } from './theme';

export type GroupedSelectOption = {
  id: string;
  label: string;
  subtitle?: string;
  chip?: string;
  /** Soft warning treatment (e.g. seed export). */
  danger?: boolean;
};

export type GroupedSelectGroup = {
  id: string;
  label: string;
  options: GroupedSelectOption[];
};

type Props = {
  visible: boolean;
  title: string;
  selectedId?: string;
  groups: GroupedSelectGroup[];
  onSelect: (id: string) => void;
  onClose: () => void;
  cancelLabel?: string;
  searchPlaceholder?: string;
  testIDPrefix?: string;
  /**
   * Render as an absolute overlay without a Modal.
   * Use inside an already-open Modal (e.g. Sheet.overlay) so iOS does not
   * nest Modal-on-Modal — nested Modals drop taps / fail to present.
   */
  embedded?: boolean;
};

export function GroupedSelectSheet({
  visible,
  title,
  selectedId,
  groups,
  onSelect,
  onClose,
  cancelLabel = 'Cancel',
  searchPlaceholder = 'Search',
  testIDPrefix,
  embedded = false,
}: Props) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) {
      setQuery('');
    }
  }, [visible]);

  const totalOptions = useMemo(
    () => groups.reduce((sum, group) => sum + group.options.length, 0),
    [groups],
  );

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        options: group.options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) ||
            option.id.toLowerCase().includes(needle) ||
            (option.subtitle ?? '').toLowerCase().includes(needle) ||
            (option.chip ?? '').toLowerCase().includes(needle) ||
            group.label.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.options.length > 0);
  }, [groups, query]);

  if (!visible) {
    return null;
  }

  const body = (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.frame}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
        onPress={onClose}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      />
      <View style={styles.sheet} onStartShouldSetResponder={() => true}>
        <View style={styles.header}>
          <Text style={styles.kicker}>{title}</Text>
          <Text style={styles.count}>{totalOptions}</Text>
        </View>
        {totalOptions > 12 ? (
          <TextInput
            testID="sheet-search"
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
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {visibleGroups.map((group, groupIndex) => (
            <View key={group.id} style={styles.section}>
              {groupIndex > 0 ? <View style={styles.separator} /> : null}
              <Text style={styles.sectionLabel}>{group.label}</Text>
              <View style={styles.sectionCard}>
                {group.options.map((option, optionIndex) => {
                  const active = option.id === selectedId;
                  const last = optionIndex === group.options.length - 1;
                  return (
                    <Pressable
                      key={option.id}
                      testID={testIDPrefix ? `${testIDPrefix}${option.id}` : undefined}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => onSelect(option.id)}
                      style={({ pressed }) => [
                        styles.row,
                        !last && styles.rowDivider,
                        option.danger && styles.rowDanger,
                        active && (option.danger ? styles.rowDangerOn : styles.rowOn),
                        pressed && styles.rowPressed,
                      ]}
                    >
                      <View style={styles.rowBody}>
                        <View style={styles.titleRow}>
                          <Text
                            style={[
                              styles.label,
                              active && styles.labelOn,
                              option.danger && styles.labelDanger,
                            ]}
                            numberOfLines={1}
                          >
                            {option.label}
                          </Text>
                          {option.chip ? (
                            <View
                              style={[
                                styles.chip,
                                active && styles.chipOn,
                                option.danger && styles.chipDanger,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.chipText,
                                  active && styles.chipTextOn,
                                  option.danger && styles.chipTextDanger,
                                ]}
                              >
                                {option.chip}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {option.subtitle ? (
                          <Text
                            style={[styles.subtitle, active && styles.subtitleOn]}
                            numberOfLines={2}
                          >
                            {option.subtitle}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.check,
                          active ? styles.checkOn : styles.checkOff,
                          option.danger && active && styles.checkDanger,
                        ]}
                      >
                        {active ? '\u2713' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
        <Button testID="sheet-cancel" label={cancelLabel} variant="ghost" onPress={onClose} />
      </View>
    </KeyboardAvoidingView>
  );

  if (embedded) {
    return <View style={styles.embeddedHost}>{body}</View>;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="overFullScreen"
    >
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  embeddedHost: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
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
    gap: space.md,
    maxHeight: '78%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  kicker: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 10,
  },
  count: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.6,
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
    gap: space.md,
    paddingBottom: space.xs,
  },
  section: {
    gap: space.sm,
  },
  separator: {
    height: hairline,
    backgroundColor: colors.border,
    opacity: 0.55,
    marginBottom: space.xs,
  },
  sectionLabel: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingHorizontal: 2,
  },
  sectionCard: {
    borderRadius: radius.sm,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  row: {
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  rowDivider: {
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  rowOn: {
    backgroundColor: 'rgba(200, 245, 66, 0.08)',
  },
  rowDanger: {
    backgroundColor: 'rgba(255, 92, 122, 0.06)',
  },
  rowDangerOn: {
    backgroundColor: 'rgba(255, 92, 122, 0.12)',
  },
  rowPressed: {
    opacity: 0.82,
  },
  rowBody: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  label: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    flexShrink: 1,
  },
  labelOn: {
    color: colors.ok,
  },
  labelDanger: {
    color: colors.danger,
  },
  subtitle: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.2,
    lineHeight: 15,
  },
  subtitleOn: {
    color: '#A8B07A',
  },
  chip: {
    borderRadius: radius.sm,
    borderWidth: hairline,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: colors.bgElevated,
  },
  chipOn: {
    borderColor: colors.ok,
    backgroundColor: 'rgba(200, 245, 66, 0.12)',
  },
  chipDanger: {
    borderColor: 'rgba(255, 92, 122, 0.45)',
    backgroundColor: 'rgba(255, 92, 122, 0.1)',
  },
  chipText: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chipTextOn: {
    color: colors.ok,
  },
  chipTextDanger: {
    color: colors.danger,
  },
  check: {
    width: 18,
    textAlign: 'center',
    fontFamily: fonts.sansSemi,
    fontSize: 16,
  },
  checkOn: {
    color: colors.ok,
  },
  checkOff: {
    color: 'transparent',
  },
  checkDanger: {
    color: colors.danger,
  },
});
