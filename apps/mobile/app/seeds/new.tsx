import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { BackupKind } from '@cws/contracts';
import {
  generateSlip39,
  mnemonicFromEntropy,
  type Bip39WordCount,
} from '@cws/sdk';
import { Button, Screen, colors, radius, space } from '@cws/ui';
import { generateSecureEntropy, generateSecureSecret, newSlotId } from '../../src/seeds/generate';
import { saveSlot } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

const BIP39_COUNTS: Bip39WordCount[] = [12, 15, 18, 21, 24];

export default function NewSeedScreen() {
  const router = useRouter();
  const { model, selectSeed } = useAppState();
  const [label, setLabel] = useState('Personal');
  const [backup, setBackup] = useState<BackupKind>('bip39');
  const [wordCount, setWordCount] = useState<Bip39WordCount>(24);
  const [threshold, setThreshold] = useState(1);
  const [shareCount, setShareCount] = useState(1);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [shares, setShares] = useState<string[]>([]);
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slipScheme = backup === 'slip39' ? { threshold: shareCount === 1 ? 1 : threshold, count: shareCount } : null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    setMnemonic(null);
    setShares([]);
    try {
      if (backup === 'bip39') {
        const next = await generateSecureEntropy(wordCount);
        setSecret(next);
        setMnemonic(mnemonicFromEntropy(next));
        return;
      }
      const master = await generateSecureSecret(16);
      const created = generateSlip39(master, slipScheme ?? { threshold: 1, count: 1 });
      setSecret(created.secret);
      setShares(created.shares);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generate failed');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!secret || !model) {
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
          backup,
          wordCount: backup === 'slip39' ? 20 : wordCount,
          shares: slipScheme ?? undefined,
          createdAt: Date.now(),
        },
        secret,
      );
      selectSeed(slot);
      setMnemonic(null);
      setShares([]);
      setSecret(null);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to store seed');
    }
  };

  return (
    <Screen
      kicker="Vault"
      title="Generate backup"
      subtitle="Words appear once. Only the reconstructed secret is stored. SLIP-39 is Trezor/OneKey; Ledger Live expects BIP39."
    >
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Label"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <View style={styles.row}>
        <Button
          label="BIP39"
          variant={backup === 'bip39' ? 'primary' : 'ghost'}
          onPress={() => {
            setBackup('bip39');
            setMnemonic(null);
            setShares([]);
            setSecret(null);
          }}
        />
        <Button
          label="SLIP-39"
          variant={backup === 'slip39' ? 'primary' : 'ghost'}
          onPress={() => {
            setBackup('slip39');
            setMnemonic(null);
            setShares([]);
            setSecret(null);
          }}
        />
      </View>
      {backup === 'bip39' ? (
        <View style={styles.wrap}>
          {BIP39_COUNTS.map((count) => (
            <Button
              key={count}
              label={`${count}`}
              variant={wordCount === count ? 'primary' : 'ghost'}
              onPress={() => setWordCount(count)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.group}>
          <Text style={styles.meta}>Basic shares. Single-share is Trezor Safe 7 default.</Text>
          <View style={styles.row}>
            <Button
              label="Single"
              variant={shareCount === 1 ? 'primary' : 'ghost'}
              onPress={() => {
                setShareCount(1);
                setThreshold(1);
              }}
            />
            <Button
              label="2-of-3"
              variant={shareCount === 3 && threshold === 2 ? 'primary' : 'ghost'}
              onPress={() => {
                setShareCount(3);
                setThreshold(2);
              }}
            />
            <Button
              label="3-of-5"
              variant={shareCount === 5 && threshold === 3 ? 'primary' : 'ghost'}
              onPress={() => {
                setShareCount(5);
                setThreshold(3);
              }}
            />
          </View>
        </View>
      )}
      <Button label={busy ? 'Generating…' : 'Generate'} disabled={busy} onPress={() => void generate()} />
      <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      {mnemonic ? (
        <View style={styles.words}>
          <Text style={styles.warn}>Shown once. This app will not display it again.</Text>
          <Text style={styles.mnemonic}>{mnemonic}</Text>
          <Button label="I wrote it down" onPress={() => void confirm()} />
        </View>
      ) : null}
      {shares.length > 0 ? (
        <View style={styles.words}>
          <Text style={styles.warn}>Each share is shown once. Store them separately.</Text>
          {shares.map((share, index) => (
            <View key={index} style={styles.share}>
              <Text style={styles.meta}>
                Share {index + 1} of {shares.length}
              </Text>
              <Text style={styles.mnemonic}>{share}</Text>
            </View>
          ))}
          <Button label="I wrote them down" onPress={() => void confirm()} />
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
    flexWrap: 'wrap',
  },
  wrap: {
    flexDirection: 'row',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  group: {
    gap: space.sm,
  },
  words: {
    gap: space.sm,
  },
  share: {
    gap: 4,
  },
  warn: {
    color: colors.accent,
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
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
