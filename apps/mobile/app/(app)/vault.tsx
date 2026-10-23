import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import type { SeedSlot } from '@cws/contracts';
import { inspectAddresses, type InspectRow } from '@cws/sdk';
import { AddressInspector, Button, Screen, SeedCard, colors } from '@cws/ui';
import { copyText } from '../../src/lab/copy';
import { deleteSlot, listSlots, loadEntropy } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

export default function VaultScreen() {
  const router = useRouter();
  const { seed, model, selectSeed } = useAppState();
  const [slots, setSlots] = useState<SeedSlot[]>([]);
  const [rows, setRows] = useState<InspectRow[]>([]);
  const [passphrase, setPassphrase] = useState('');
  const [deriveError, setDeriveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSlots(await listSlots());
    } catch {
      setSlots([]);
    }
  }, []);

  const loadInspector = useCallback(
    async (slot: SeedSlot | null, phrase: string) => {
      if (!slot) {
        setRows([]);
        setDeriveError(null);
        return;
      }
      try {
        const secret = await loadEntropy(slot.id);
        setRows(inspectAddresses(secret, slot.backup ?? 'bip39', phrase));
        setDeriveError(null);
      } catch (err) {
        setRows([]);
        setDeriveError(err instanceof Error ? err.message : 'could not derive addresses');
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void loadInspector(seed, passphrase);
    }, [loadInspector, passphrase, refresh, seed]),
  );

  const onSelect = (slot: SeedSlot) => {
    selectSeed(slot);
    void loadInspector(slot, passphrase);
  };

  const onPassphrase = (value: string) => {
    setPassphrase(value);
    void loadInspector(seed, value);
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
              setRows([]);
            }
            await refresh();
          })();
        },
      },
    ]);
  };

  const ledgerSlip39 = seed?.backup === 'slip39' && model?.brand === 'ledger';

  return (
    <Screen
      kicker="Vault"
      title="Seeds"
      subtitle="BIP39 12–24 and SLIP-39 backups. Entropy stays in SecureStore. The words are never persisted after the first reveal."
      edges={[]}
    >
      <Button label="Generate backup" onPress={() => router.push('/seeds/new')} />
      <Button label="Import backup" variant="ghost" onPress={() => router.push('/seeds/import')} />
      {slots.length === 0 ? (
        <Text style={styles.empty}>Generate a BIP39 or SLIP-39 backup, then start the radio from Device.</Text>
      ) : null}
      {deriveError ? <Text style={styles.error}>{deriveError}</Text> : null}
      {slots.map((slot) => (
        <SeedCard
          key={slot.id}
          slot={slot}
          selected={seed?.id === slot.id}
          onPress={() => onSelect(slot)}
          onDelete={() => onDelete(slot)}
        >
          <AddressInspector
            rows={rows}
            passphrase={passphrase}
            onPassphrase={onPassphrase}
            onCopy={(value) => void copyText(value)}
            warning={
              ledgerSlip39
                ? 'Ledger Live expects BIP39. A SLIP-39 secret will not match a Ledger-restored seed.'
                : null
            }
            hint={
              slot.backup === 'slip39'
                ? 'SLIP-39 passphrase is applied when combining shares, not as a BIP39 25th word.'
                : undefined
            }
          />
        </SeedCard>
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
