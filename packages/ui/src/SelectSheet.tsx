import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { colors, radius, space } from './theme';

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
};

export function SelectSheet({ visible, title, selectedId, options, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.kicker}>{title}</Text>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {options.map((option) => {
              const active = option.id === selectedId;
              return (
                <Pressable
                  key={option.id}
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
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
    padding: space.lg,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
    maxHeight: '72%',
  },
  kicker: {
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontSize: 12,
    fontWeight: '700',
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 6,
    paddingVertical: 4,
  },
  row: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  label: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  labelOn: {
    color: colors.bg,
  },
  chip: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  chipOn: {
    color: colors.bg,
  },
});
