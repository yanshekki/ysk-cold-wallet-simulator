import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import type { SeedSlot } from '@cws/contracts';
import { Button, Screen, SeedCard, colors } from '@cws/ui';
import { derivedEthAddress } from '../../src/lab/ethAddress';
import { deleteSlot, listSlots, loadEntropy } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

export default function VaultScreen() {
  const router = useRouter();
  const { seed, selectSeed } = useAppState();
  const [slots, setSlots] = useState<SeedSlot[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [deriveError, setDeriveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSlots(await listSlots());
  }, []);

  const loadAddress = useCallback(async (slot: SeedSlot | null) => {
    if (!slot) {
      setAddress(null);
      setDeriveError(null);
      return;
    }
    try {
      const entropy = await loadEntropy(slot.id);
      setAddress(derivedEthAddress(entropy));
      setDeriveError(null);
    } catch (err) {
      setAddress(null);
      setDeriveError(err instanceof Error ? err.message : 'could not derive address');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void loadAddress(seed);
    }, [loadAddress, refresh, seed]),
  );

  const onSelect = (slot: SeedSlot) => {
    selectSeed(slot);
    void loadAddress(slot);
  };

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
              setAddress(null);
            }
            await refresh();
          })();
        },
      },
    ]);
  };

  return (
    <Screen
      kicker="Vault"
      title="Seeds"
      subtitle="Entropy stays in SecureStore. The mnemonic is never persisted after the first reveal."
      edges={[]}
    >
      <Button label="Generate 12/24 words" onPress={() => router.push('/seeds/new')} />
      <Button label="Import mnemonic" variant="ghost" onPress={() => router.push('/seeds/import')} />
      {slots.length === 0 ? (
        <Text style={styles.empty}>No seeds yet. Generate one, then start the radio from Device.</Text>
      ) : null}
      {deriveError ? <Text style={styles.error}>{deriveError}</Text> : null}
      {slots.map((slot) => (
        <SeedCard
          key={slot.id}
          slot={slot}
          selected={seed?.id === slot.id}
          address={seed?.id === slot.id ? address : null}
          onPress={() => onSelect(slot)}
          onDelete={() => onDelete(slot)}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    color: colors.muted,
    lineHeight: 20,
  },
  error: {
    color: colors.danger,
  },
});
