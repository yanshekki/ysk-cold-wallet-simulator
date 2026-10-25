import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { LedgerInstalledApp } from '@cws/contracts';
import { colors, fonts, hairline, radius, space } from './theme';

export type CatalogTableLabels = {
  search?: string;
  app?: string;
  chip?: string;
  family?: string;
  version?: string;
  empty?: string;
};

type Props = {
  apps: readonly LedgerInstalledApp[];
  labels?: CatalogTableLabels;
};

function haystack(app: LedgerInstalledApp): string {
  return `${app.openAppName} ${app.id} ${app.chip} ${app.family} ${app.version}`.toLowerCase();
}

export function CatalogTable({ apps, labels }: Props) {
  const [query, setQuery] = useState('');
  const L = {
    search: labels?.search ?? 'Search',
    app: labels?.app ?? 'App',
    chip: labels?.chip ?? 'Chip',
    family: labels?.family ?? 'Family',
    version: labels?.version ?? 'Version',
    empty: labels?.empty ?? 'No apps',
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle ? apps.filter((app) => haystack(app).includes(needle)) : [...apps];
    return filtered.sort((a, b) => {
      const family = a.family.localeCompare(b.family);
      return family !== 0 ? family : a.openAppName.localeCompare(b.openAppName);
    });
  }, [apps, query]);

  return (
    <View style={styles.root} testID="catalog-table">
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={L.search}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
        testID="catalog-search"
        accessibilityLabel={L.search}
      />
      <View style={[styles.row, styles.head]} testID="catalog-head">
        <Text style={[styles.cell, styles.app, styles.headText]}>{L.app}</Text>
        <Text style={[styles.cell, styles.chip, styles.headText]}>{L.chip}</Text>
        <Text style={[styles.cell, styles.family, styles.headText]}>{L.family}</Text>
        <Text style={[styles.cell, styles.version, styles.headText]}>{L.version}</Text>
      </View>
      {rows.length === 0 ? <Text style={styles.empty}>{L.empty}</Text> : null}
      {rows.map((app, index) => (
        <View
          key={app.id}
          accessibilityLabel={`${app.openAppName} ${app.chip} ${app.family} ${app.version}`}
          style={[styles.row, index % 2 === 1 && styles.zebra]}
        >
          <Text style={[styles.cell, styles.app]} numberOfLines={1}>
            {app.openAppName}
          </Text>
          <Text style={[styles.cell, styles.chip]} numberOfLines={1}>
            {app.chip}
          </Text>
          <Text style={[styles.cell, styles.family]} numberOfLines={1}>
            {app.family}
          </Text>
          <Text style={[styles.cell, styles.version]} numberOfLines={1}>
            {app.version}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  search: {
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
    color: colors.text,
    paddingHorizontal: space.md,
    minHeight: 40,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingHorizontal: space.sm,
    gap: space.xs,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  head: {
    backgroundColor: colors.bgElevated,
    minHeight: 32,
  },
  zebra: {
    backgroundColor: colors.bgElevated,
  },
  cell: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  headText: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontSize: 10,
  },
  app: {
    flex: 2.2,
  },
  chip: {
    flex: 0.8,
    color: colors.ok,
  },
  family: {
    flex: 1.1,
    color: colors.muted,
  },
  version: {
    flex: 0.9,
    textAlign: 'right',
  },
  empty: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 13,
    padding: space.md,
  },
});
