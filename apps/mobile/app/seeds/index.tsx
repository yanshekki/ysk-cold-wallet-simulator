import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import type { SeedSlot } from '@cws/contracts';
import { Button, Screen, SeedCard, colors } from '@cws/ui';
import { deleteSlot, listSlots } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

export default function SeedsScreen() {
  const router = useRouter();
  const { seed, selectSeed } = useAppState();
  const [slots, setSlots] = useState<SeedSlot[]>([]);

  const refresh = useCallback(async () => {
    setSlots(await listSlots());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onDelete = (slot: SeedSlot) => {
    Alert.alert('Delete seed', `Remove “${slot.label}”? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteSlot(slot.id);
            if (seed?.id === slot.id) {
              selectSeed(null);
            }
            await refresh();
          })();
        },
      },
    ]);
  };

  return (
    <Screen
      title="Seed vault"
      subtitle="Entropy is stored in SecureStore. The mnemonic is never persisted."
    >
      <Button label="Generate 12/24 words" onPress={() => router.push('/seeds/new')} />
      <Button label="Import mnemonic" variant="ghost" onPress={() => router.push('/seeds/import')} />
      {slots.length === 0 ? <Text style={styles.empty}>No seeds yet.</Text> : null}
      {slots.map((slot) => (
        <SeedCard
          key={slot.id}
          slot={slot}
          selected={seed?.id === slot.id}
          onPress={() => selectSeed(slot)}
          onDelete={() => onDelete(slot)}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    color: colors.muted,
  },
});
