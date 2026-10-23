import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { mnemonicFromEntropy, type WordCount } from '@cws/sdk';
import { Button, Screen, colors, radius, space } from '@cws/ui';
import { generateSecureEntropy, newSlotId } from '../../src/seeds/generate';
import { saveSlot } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

export default function NewSeedScreen() {
  const router = useRouter();
  const { model, selectSeed } = useAppState();
  const [label, setLabel] = useState('Personal');
  const [wordCount, setWordCount] = useState<WordCount>(24);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [entropy, setEntropy] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await generateSecureEntropy(wordCount);
      setEntropy(next);
      setMnemonic(mnemonicFromEntropy(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generate failed');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!entropy || !model) {
      setError('Generate a seed and select a model first');
      return;
    }
    try {
      const slot = await saveSlot(
        {
          id: newSlotId(),
          label: label.trim() || 'Unnamed',
          brand: model.brand,
          modelId: model.id,
          wordCount,
          createdAt: Date.now(),
        },
        entropy,
      );
      selectSeed(slot);
      setMnemonic(null);
      setEntropy(null);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to store seed');
    }
  };

  return (
    <Screen
      kicker="Vault"
      title="Generate seed"
      subtitle="The words appear once. Write them down, then confirm. Only encrypted entropy is stored."
    >
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Label"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <View style={styles.row}>
        <Button label="12 words" variant={wordCount === 12 ? 'primary' : 'ghost'} onPress={() => setWordCount(12)} />
        <Button label="24 words" variant={wordCount === 24 ? 'primary' : 'ghost'} onPress={() => setWordCount(24)} />
      </View>
      <Button label={busy ? 'Generating…' : 'Generate'} disabled={busy} onPress={() => void generate()} />
      <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      {mnemonic ? (
        <View style={styles.words}>
          <Text style={styles.warn}>Shown once. This app will not display it again.</Text>
          <Text style={styles.mnemonic}>{mnemonic}</Text>
          <Button label="I wrote it down" onPress={() => void confirm()} />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  words: {
    gap: space.sm,
  },
  warn: {
    color: colors.accent,
  },
  mnemonic: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 26,
  },
  error: {
    color: colors.danger,
  },
});
