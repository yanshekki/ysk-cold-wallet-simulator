import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mergeChainPaths } from '@cws/contracts';
import {
  combineSlip39,
  entropyFromMnemonic,
  isKnownUnsafeMnemonic,
  wordCountFromEntropy,
  wordCountOf,
} from '@cws/sdk';
import { Button, Screen, colors, fonts, hairline, radius, space } from '@cws/ui';
import { useT } from '../../src/i18n';
import { readClipboard } from '../../src/lab/copy';
import { unlock as requestUnlock } from '../../src/passkeys';
import { newSlotId } from '../../src/seeds/generate';
import {
  analyzeImport,
  applyLastSuggestion,
  replaceToken,
  splitShares,
  type ImportShareView,
} from '../../src/seeds/importParse';
import { useSecretScreen } from '../../src/seeds/screenGuard';
import { saveSlot } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

export default function ImportSeedScreen() {
  const t = useT();
  const router = useRouter();
  const { model, settings, selectSeed, runWithLoading } = useAppState();
  const [label, setLabel] = useState('');
  const [draft, setDraft] = useState('');
  const [extraShares, setExtraShares] = useState<string[]>([]);
  const [slipPass, setSlipPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  useSecretScreen(() => undefined);

  const analysis = useMemo(() => analyzeImport([draft, ...extraShares]), [draft, extraShares]);
  const slipMode = analysis.scheme === 'slip39';

  const applyParts = (parts: string[]) => {
    setKnown(false);
    setError(null);
    setDraft(parts[0] ?? '');
    setExtraShares(parts.slice(1));
  };

  const onDraftChange = (value: string) => {
    setKnown(false);
    if (/\n\s*\n/.test(value) || /share\s*\d+/i.test(value)) {
      const parts = splitShares(value);
      if (parts.length > 1) {
        applyParts([...parts, ...extraShares]);
        return;
      }
    }
    setDraft(value);
  };

  const onPaste = async () => {
    try {
      const parts = splitShares(await readClipboard());
      if (parts.length === 0) {
        setError(t('import.paste'));
        return;
      }
      applyParts(parts);
    } catch {
      setError(t('import.paste'));
    }
  };

  const onImport = async () => {
    setError(null);
    try {
      if (!model) {
        throw new Error(t('errors.selectSeed'));
      }
      if (!analysis.ready) {
        throw new Error(t('import.invalid'));
      }
      const filled = [draft, ...extraShares].map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const first = filled[0];
      if (!first) {
        throw new Error(t('import.paste'));
      }
      const name = label.trim() || t('import.defaultName');
      if (analysis.scheme === 'bip39') {
        if (isKnownUnsafeMnemonic(first) && !known) {
          setKnown(true);
          setError(t('generate.knownVector'));
          return;
        }
        if (!(await requestUnlock(t('unlock.prompt')))) {
          return;
        }
        const entropy = entropyFromMnemonic(first);
        await runWithLoading(t('common.loading'), async () => {
          const saved = await saveSlot(
            {
              id: newSlotId(),
              label: name,
              brand: model.brand,
              modelId: model.id,
              backup: 'bip39',
              wordCount: wordCountFromEntropy(entropy),
              createdAt: Date.now(),
              paths: mergeChainPaths(settings.defaultPaths),
            },
            entropy,
          );
          selectSeed(saved);
        });
        if (router.canDismiss()) {
          router.dismiss();
        } else {
          router.back();
        }
        return;
      }
      if (!(await requestUnlock(t('unlock.prompt')))) {
        return;
      }
      const secret = combineSlip39(filled, slipPass);
      await runWithLoading(t('common.loading'), async () => {
        const saved = await saveSlot(
          {
            id: newSlotId(),
            label: name,
            brand: model.brand,
            modelId: model.id,
            backup: 'slip39',
            wordCount: wordCountOf(first) === 33 ? 33 : 20,
            shares: { threshold: filled.length, count: filled.length },
            createdAt: Date.now(),
            paths: mergeChainPaths(settings.defaultPaths),
          },
          secret,
          filled,
        );
        selectSeed(saved);
      });
      if (router.canDismiss()) {
        router.dismiss();
      } else {
        router.back();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('import.invalid'));
    }
  };

  const status = analysis.ready
    ? t('import.ready')
    : analysis.have === 0
      ? t('import.typing')
      : `${
          analysis.scheme === 'slip39'
            ? t('import.detectedSlip39', { count: analysis.shares.length })
            : analysis.scheme === 'bip39'
              ? t('import.detectedBip39', { count: analysis.have })
              : t('import.typing')
        } · ${t('import.needWords', { have: analysis.have, need: analysis.need })}`;

  return (
    <Screen
      kicker={t('import.kicker')}
      title={t('import.title')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      backIcon={<Ionicons name="chevron-back" size={22} color={colors.text} />}
    >
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={t('import.defaultName')}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Button testID="import-paste" label={t('import.pasteClipboard')} variant="ghost" onPress={() => void onPaste()} />
          <TextInput
            testID="import-draft"
            value={draft}
            onChangeText={onDraftChange}
            placeholder={t('import.paste')}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={[styles.input, styles.area]}
          />
          {analysis.shares[0] ? (
            <ShareWords
              share={analysis.shares[0]}
              onReplace={(index, word) => setDraft(replaceToken(draft, index, word))}
            />
          ) : null}
          <SuggestionRow
            suggestions={analysis.lastSuggestions}
            onPick={(word) => setDraft(applyLastSuggestion(draft, word))}
          />
          {slipMode
            ? extraShares.map((share, index) => (
                <View key={`share-${index}`} style={styles.shareCard}>
                  <Text style={styles.shareTitle}>{t('import.shareN', { n: index + 2 })}</Text>
                  <TextInput
                    value={share}
                    onChangeText={(value) => {
                      setKnown(false);
                      setExtraShares((current) => current.map((item, i) => (i === index ? value : item)));
                    }}
                    placeholder={t('import.paste')}
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    style={[styles.input, styles.area]}
                  />
                  {analysis.shares[index + 1] ? (
                    <ShareWords
                      share={analysis.shares[index + 1] as ImportShareView}
                      onReplace={(wordIndex, word) => {
                        setExtraShares((current) =>
                          current.map((item, i) => (i === index ? replaceToken(item, wordIndex, word) : item)),
                        );
                      }}
                    />
                  ) : null}
                </View>
              ))
            : null}
          {slipMode ? (
            <>
              <Button
                label={t('import.addShare')}
                variant="ghost"
                onPress={() => setExtraShares((current) => [...current, ''])}
              />
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
            </>
          ) : null}
          <Text style={[styles.status, analysis.ready && styles.statusOk, analysis.checksumOk === false && analysis.have >= analysis.need && styles.statusBad]}>
            {analysis.scheme === 'bip39' && analysis.have >= 12
              ? `${t(analysis.checksumOk ? 'import.checksumOk' : 'import.checksumBad')} · ${status}`
              : status}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            testID="import-submit"
            label={t('vault.import')}
            disabled={!analysis.ready}
            onPress={() => void onImport()}
          />
    </Screen>
  );
}

function ShareWords({
  share,
  onReplace,
}: {
  share: ImportShareView;
  onReplace: (index: number, word: string) => void;
}) {
  const t = useT();
  if (share.words.length === 0) {
    return null;
  }
  return (
    <View style={styles.grid}>
      {share.words.map((item) => (
        <Pressable
          key={`${item.index}-${item.word}`}
          disabled={item.ok || !item.suggestion}
          onPress={() => {
            if (item.suggestion) {
              onReplace(item.index, item.suggestion);
            }
          }}
          style={[styles.cell, !item.ok && styles.cellBad]}
          accessibilityLabel={
            item.ok ? item.word : item.suggestion ? t('import.suggest', { word: item.suggestion }) : t('import.wordUnknown')
          }
        >
          <Text style={styles.index}>{item.index + 1}</Text>
          <Text style={[styles.word, !item.ok && styles.wordBad]}>{item.word}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function SuggestionRow({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (word: string) => void;
}) {
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <View style={styles.row}>
      {suggestions.map((word) => (
        <Pressable key={word} onPress={() => onPick(word)} style={styles.chip}>
          <Text style={styles.chipText}>{word}</Text>
        </Pressable>
      ))}
    </View>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  cell: {
    width: '31%',
    flexGrow: 0,
    flexBasis: '31%',
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    gap: 2,
  },
  cellBad: {
    borderColor: colors.danger,
  },
  index: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  word: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 13,
  },
  wordBad: {
    color: colors.danger,
  },
  shareCard: {
    gap: space.sm,
  },
  shareTitle: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  status: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  statusOk: {
    color: colors.ok,
    fontFamily: fonts.mono,
  },
  statusBad: {
    color: colors.danger,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.sans,
  },
});
