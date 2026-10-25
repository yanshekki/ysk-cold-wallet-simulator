import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SeedSlot } from '@cws/contracts';
import { colors, fonts, hairline, radius, space } from './theme';

type Props = {
  slot: SeedSlot;
  selected?: boolean;
  isDefault?: boolean;
  badge?: string;
  onPress?: () => void;
  onDelete?: () => void;
  onDefault?: () => void;
  defaultLabel?: string;
  deleteIcon?: ReactNode;
  children?: ReactNode;
};

export function backupBadge(slot: SeedSlot): string {
  const kind = (slot.backup ?? 'bip39').toUpperCase();
  if (slot.backup === 'slip39' && slot.shares) {
    return `${kind} ${slot.shares.threshold}-of-${slot.shares.count}`;
  }
  return `${kind} ${slot.wordCount}`;
}

export function SeedCard({
  slot,
  selected,
  isDefault,
  badge,
  onPress,
  onDelete,
  onDefault,
  defaultLabel = 'Default',
  deleteIcon,
  children,
}: Props) {
  const meta = badge ?? backupBadge(slot);
  return (
    <View style={[styles.card, selected && styles.selected]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${slot.label}, ${meta}`}
          accessibilityState={{ selected: !!selected }}
          onPress={onPress}
          style={styles.copy}
        >
          <View style={styles.labelRow}>
            {slot.color?.startsWith('#') ? <View style={[styles.swatch, { backgroundColor: slot.color }]} /> : null}
            {slot.color && !slot.color.startsWith('#') ? <Text style={styles.emoji}>{slot.color}</Text> : null}
            <Text style={styles.label}>
              {slot.label}
              {isDefault ? ` · ${defaultLabel}` : ''}
            </Text>
          </View>
          <Text style={styles.meta}>
            {meta} · {slot.brand} · {slot.modelId}
          </Text>
        </Pressable>
        {onDefault ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={defaultLabel}
            onPress={onDefault}
            hitSlop={8}
          >
            <Text style={[styles.star, isDefault && styles.starOn]}>{isDefault ? '★' : '☆'}</Text>
          </Pressable>
        ) : null}
        {onDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${slot.label}`}
            onPress={onDelete}
            hitSlop={8}
          >
            {deleteIcon ?? <Text style={styles.delete}>Delete</Text>}
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
    borderWidth: hairline,
    borderRadius: radius.sm,
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 1,
    backgroundColor: colors.ok,
  },
  emoji: {
    fontSize: 14,
  },
  label: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
  },
  meta: {
    color: colors.muted,
    marginTop: 4,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  delete: {
    color: colors.danger,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
  },
  star: {
    color: colors.muted,
    fontSize: 16,
  },
  starOn: {
    color: colors.ok,
  },
  inspector: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
});
