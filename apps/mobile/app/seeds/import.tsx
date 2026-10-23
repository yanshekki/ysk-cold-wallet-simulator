import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  combineSlip39,
  entropyFromMnemonic,
  isSlip39Mnemonic,
  wordCountFromEntropy,
  wordCountOf,
} from '@cws/sdk';
import { Button, Screen, colors, radius, space } from '@cws/ui';
import { newSlotId } from '../../src/seeds/generate';
import { saveSlot } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

export default function ImportSeedScreen() {
  const router = useRouter();
  const { model, selectSeed } = useAppState();
  const [label, setLabel] = useState('Imported');
  const [shares, setShares] = useState<string[]>(['']);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onImport = async () => {
    setError(null);
    try {
      if (!model) {
        throw new Error('Select a model first');
      }
      const filled = shares.map((item) => item.trim()).filter(Boolean);
      if (filled.length === 0) {
        throw new Error('Paste a BIP39 mnemonic or SLIP-39 share');
      }
      const first = filled[0];
      if (!first) {
        throw new Error('Paste a BIP39 mnemonic or SLIP-39 share');
      }
      if (filled.length === 1 && wordCountOf(first) !== 20 && wordCountOf(first) !== 33) {
        const entropy = entropyFromMnemonic(first);
        const slot = await saveSlot(
          {
            id: newSlotId(),
            label: label.trim() || 'Imported',
            brand: model.brand,
            modelId: model.id,
            backup: 'bip39',
            wordCount: wordCountFromEntropy(entropy),
            createdAt: Date.now(),
          },
          entropy,
        );
        selectSeed(slot);
        router.back();
        return;
      }
      if (!filled.every(isSlip39Mnemonic)) {
        throw new Error('SLIP-39 shares must be 20 or 33 words from the SLIP-39 wordlist');
      }
      const secret = combineSlip39(filled, passphrase);
      const slot = await saveSlot(
        {
          id: newSlotId(),
          label: label.trim() || 'Imported',
          brand: model.brand,
          modelId: model.id,
          backup: 'slip39',
          wordCount: wordCountOf(first) === 33 ? 33 : 20,
          shares: { threshold: filled.length, count: filled.length },
          createdAt: Date.now(),
        },
        secret,
      );
      selectSeed(slot);
      setShares(['']);
      setPassphrase('');
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'import failed');
    }
  };

  return (
    <Screen
      kicker="Vault"
      title="Import backup"
      subtitle="BIP39 (12–24) or SLIP-39 shares. Words are not stored. SLIP-39 passphrase is applied only while combining."
    >
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Label"
        placeholderTextColor={colors.muted}
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        style={styles.input}
      />
      {shares.map((share, index) => (
        <TextInput
          key={index}
          value={share}
          onChangeText={(value) => {
            const next = [...shares];
            next[index] = value;
            setShares(next);
          }}
          placeholder={index === 0 ? 'mnemonic or SLIP-39 share' : `share ${index + 1}`}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          spellCheck={false}
          multiline
          style={[styles.input, styles.area]}
        />
      ))}
      <TextInput
        value={passphrase}
        onChangeText={setPassphrase}
        placeholder="SLIP-39 passphrase (optional)"
        placeholderTextColor={colors.muted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="oneTimeCode"
        importantForAutofill="no"
        spellCheck={false}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <Button label="Add share" variant="ghost" onPress={() => setShares((current) => [...current, ''])} />
      </View>
      <Button label="Import" onPress={() => void onImport()} />
      <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  area: {
    minHeight: 120,
    textAlignVertical: 'top',
    paddingTop: space.sm,
  },
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  error: {
    color: colors.danger,
  },
});
