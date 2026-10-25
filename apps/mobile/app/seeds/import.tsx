import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { wordlist } from '@scure/bip39/wordlists/english';
import { mergeChainPaths } from '@cws/contracts';
import {
  combineSlip39,
  entropyFromMnemonic,
  inspectAddresses,
  PREVIEW_INSPECT_IDS,
  isKnownUnsafeMnemonic,
  isSlip39Mnemonic,
  isValidBip39Mnemonic,
  normalizeWords,
  wordCountFromEntropy,
  wordCountOf,
  type InspectRow,
} from '@cws/sdk';
import { AddressInspector, Button, Screen, colors, fonts, hairline, radius, space } from '@cws/ui';
import { useT } from '../../src/i18n';
import { copyText } from '../../src/lab/copy';
import { newSlotId } from '../../src/seeds/generate';
import { saveSlot } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

export default function ImportSeedScreen() {
  const t = useT();
  const router = useRouter();
  const { model, settings, selectSeed, showToast, runWithLoading } = useAppState();
  const [label, setLabel] = useState('Imported');
  const [draft, setDraft] = useState('');
  const [shares, setShares] = useState<string[]>([]);
  const [slipPass, setSlipPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  const [preview, setPreview] = useState<InspectRow[]>([]);

  const tokens = useMemo(() => normalizeWords(draft).split(' ').filter(Boolean), [draft]);
  const last = tokens[tokens.length - 1] ?? '';
  const suggestions = useMemo(() => {
    if (last.length < 2) {
      return [];
    }
    return wordlist.filter((word) => word.startsWith(last)).slice(0, 6);
  }, [last]);
  const invalid = tokens.find((word) => word.length > 2 && !wordlist.includes(word));
  const checksum = isValidBip39Mnemonic(draft);

  const onImport = async () => {
    setError(null);
    try {
      if (!model) {
        throw new Error('Select a model first');
      }
      const filled = [normalizeWords(draft), ...shares.map((item) => item.trim())].filter(Boolean);
      if (filled.length === 0) {
        throw new Error(t('import.paste'));
      }
      const first = filled[0];
      if (!first) {
        throw new Error(t('import.paste'));
      }
      if (filled.length === 1 && wordCountOf(first) !== 20 && wordCountOf(first) !== 33) {
        if (!checksum) {
          throw new Error(t('import.checksumBad'));
        }
        if (isKnownUnsafeMnemonic(first) && !known) {
          setKnown(true);
          setError(t('generate.knownVector'));
          return;
        }
        const entropy = entropyFromMnemonic(first);
        await runWithLoading(t('common.loading'), async () => {
          const slot = await saveSlot(
            {
              id: newSlotId(),
              label: label.trim() || 'Imported',
              brand: model.brand,
              modelId: model.id,
              backup: 'bip39',
              wordCount: wordCountFromEntropy(entropy),
              createdAt: Date.now(),
              paths: mergeChainPaths(settings.defaultPaths),
            },
            entropy,
          );
          selectSeed(slot);
          setPreview(inspectAddresses(entropy, 'bip39', '', slot.paths, PREVIEW_INSPECT_IDS));
        });
        return;
      }
      if (!filled.every(isSlip39Mnemonic)) {
        throw new Error('SLIP-39 shares must be 20 or 33 words from the SLIP-39 wordlist');
      }
      const secret = combineSlip39(filled, slipPass);
      await runWithLoading(t('common.loading'), async () => {
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
            paths: mergeChainPaths(settings.defaultPaths),
          },
          secret,
        );
        selectSeed(slot);
        setPreview(inspectAddresses(secret, 'slip39', '', slot.paths, PREVIEW_INSPECT_IDS));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('import.invalid'));
    }
  };

  return (
    <Screen
      kicker={t('import.kicker')}
      title={t('import.title')}
      subtitle={t('import.subtitle')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      backIcon={<Ionicons name="chevron-back" size={22} color={colors.text} />}
    >
      {preview.length === 0 ? (
        <>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={t('generate.name')}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <TextInput
            value={draft}
            onChangeText={(value) => {
              setDraft(value.replace(/\n+/g, ' '));
              setKnown(false);
            }}
            placeholder={t('import.paste')}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={[styles.input, styles.area]}
          />
          {tokens.length >= 12 ? (
            <Text style={checksum ? styles.ok : styles.error}>
              {checksum ? t('import.checksumOk') : t('import.checksumBad')}
            </Text>
          ) : null}
          {invalid ? (
            <Text style={styles.error}>
              {t('import.invalid')}: {invalid}
            </Text>
          ) : null}
          <View style={styles.row}>
            {suggestions.map((word) => (
              <Pressable
                key={word}
                onPress={() => {
                  const next = [...tokens.slice(0, -1), word].join(' ') + ' ';
                  setDraft(next);
                }}
                style={styles.chip}
              >
                <Text style={styles.chipText}>{word}</Text>
              </Pressable>
            ))}
          </View>
          {shares.map((share, index) => (
            <TextInput
              key={index}
              value={share}
              onChangeText={(value) => {
                const next = [...shares];
                next[index] = value;
                setShares(next);
              }}
              placeholder={`share ${index + 1}`}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              multiline
              style={[styles.input, styles.area]}
            />
          ))}
          {shares.length > 0 || tokens.length === 20 || tokens.length === 33 ? (
            <TextInput
              value={slipPass}
              onChangeText={setSlipPass}
              placeholder={t('import.slip39Passphrase')}
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
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label={t('import.addShare')} variant="ghost" onPress={() => setShares((current) => [...current, ''])} />
          <Button label={t('vault.import')} onPress={() => void onImport()} />
        </>
      ) : (
        <>
          <Text style={styles.ok}>{t('generate.preview')}</Text>
          <AddressInspector
            rows={preview}
            title={t('generate.preview')}
            copyPathLabel={t('vault.copyPath')}
            onCopy={(value) => {
              void copyText(value).then(() => showToast(t('common.copied')));
            }}
          />
          <Button label={t('generate.done')} onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    fontFamily: fonts.sans,
    paddingHorizontal: space.md,
    minHeight: 40,
  },
  area: {
    minHeight: 120,
    textAlignVertical: 'top',
    paddingTop: space.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
  },
  chipText: {
    color: colors.text,
    fontFamily: fonts.sans,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.sans,
  },
  ok: {
    color: colors.ok,
    fontFamily: fonts.mono,
  },
});
