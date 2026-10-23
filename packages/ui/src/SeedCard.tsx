import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SeedSlot } from '@cws/contracts';
import { colors, radius, space } from './theme';

type Props = {
  slot: SeedSlot;
  selected?: boolean;
  badge?: string;
  onPress?: () => void;
  onDelete?: () => void;
  children?: ReactNode;
};

export function backupBadge(slot: SeedSlot): string {
  const kind = (slot.backup ?? 'bip39').toUpperCase();
  if (slot.backup === 'slip39' && slot.shares) {
    return `${kind} ${slot.shares.threshold}-of-${slot.shares.count}`;
  }
  return `${kind} ${slot.wordCount}`;
}

export function SeedCard({ slot, selected, badge, onPress, onDelete, children }: Props) {
  return (
    <View style={[styles.card, selected && styles.selected]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={slot.label}
          accessibilityState={{ selected: !!selected }}
          onPress={onPress}
          style={styles.copy}
        >
          <Text style={styles.label}>{slot.label}</Text>
          <Text style={styles.meta}>
            {badge ?? backupBadge(slot)} · {slot.brand} · {slot.modelId}
          </Text>
        </Pressable>
        {onDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${slot.label}`}
            onPress={onDelete}
            hitSlop={8}
          >
            <Text style={styles.delete}>Delete</Text>
          </Pressable>
        ) : null}
      </View>
      {selected && children ? <View style={styles.inspector}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  selected: {
    borderColor: colors.ok,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  copy: {
    flex: 1,
  },
  label: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  meta: {
    color: colors.muted,
    marginTop: 4,
    fontSize: 13,
  },
  delete: {
    color: colors.danger,
    fontWeight: '600',
  },
  inspector: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
