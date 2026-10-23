import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { entropyFromMnemonic, wordCountFromEntropy } from '@cws/sdk';
import { Button, Screen, colors, radius, space } from '@cws/ui';
import { newSlotId } from '../../src/seeds/generate';
import { saveSlot } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

export default function ImportSeedScreen() {
  const router = useRouter();
  const { model, selectSeed } = useAppState();
  const [label, setLabel] = useState('Imported');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onImport = async () => {
    setError(null);
    try {
      if (!model) {
        throw new Error('Select a model first');
      }
      const entropy = entropyFromMnemonic(phrase);
      const slot = await saveSlot(
        {
          id: newSlotId(),
          label: label.trim() || 'Imported',
          brand: model.brand,
          modelId: model.id,
          wordCount: wordCountFromEntropy(entropy),
          createdAt: Date.now(),
        },
        entropy,
      );
      selectSeed(slot);
      setPhrase('');
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'import failed');
    }
  };

  return (
    <Screen title="Import mnemonic" subtitle="Validated with @scure/bip39. The words are not stored.">
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Label"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <TextInput
        value={phrase}
        onChangeText={setPhrase}
        placeholder="twelve or twenty four words"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        style={[styles.input, styles.area]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Import" onPress={() => void onImport()} />
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
    minHeight: 140,
    textAlignVertical: 'top',
    paddingTop: space.sm,
  },
  error: {
    color: colors.danger,
  },
});
