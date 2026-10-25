import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DeviceModel } from '@cws/contracts';
import { colors, fonts, hairline, radius, space } from './theme';

type Item = {
  model: DeviceModel;
  enabled: boolean;
  badge?: string;
};

type Props = {
  items: Item[];
  selectedId?: string;
  onSelect: (model: DeviceModel) => void;
};

export function BrandGrid({ items, selectedId, onSelect }: Props) {
  return (
    <View style={styles.grid}>
      {items.map(({ model, enabled, badge }) => {
        const selected = model.id === selectedId;
        return (
          <Pressable
            key={model.id}
            disabled={!enabled}
            accessibilityRole="button"
            accessibilityLabel={model.name}
            accessibilityState={{ disabled: !enabled, selected }}
            onPress={() => onSelect(model)}
            style={[styles.card, selected && styles.selected, !enabled && styles.disabled]}
          >
            <Text style={styles.brand}>{model.brand}</Text>
            <Text style={styles.name}>{model.name}</Text>
            {badge ? <Text style={styles.badge}>{badge}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  card: {
    flexGrow: 1,
    flexBasis: 150,
    maxWidth: '48%',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: hairline,
    borderRadius: radius.sm,
    padding: space.md,
    minHeight: 96,
  },
  selected: {
    borderColor: colors.accent,
  },
  disabled: {
    opacity: 0.45,
  },
  brand: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  name: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 15,
  },
  badge: {
    marginTop: 8,
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 10,
  },
});
