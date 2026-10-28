import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { BackupKind } from '@cws/contracts';
import { mergeChainPaths } from '@cws/contracts';
import {
  bytesToEntropyHex,
  entropyBitsForWordCount,
  generateSlip39,
  isKnownUnsafeMnemonic,
  minDiceRolls,
  minHexChars,
  mixExtraEntropy,
  mnemonicFromEntropy,
  parseCustomEntropy,
  type Bip39WordCount,
  type CustomEntropyKind,
} from '@cws/sdk';
import { Button, MnemonicGrid, Screen, colors, fonts, hairline, radius, space } from '@cws/ui';
import { useT } from '../../src/i18n';
import { unlock as requestUnlock } from '../../src/passkeys';
import { generateSecureEntropy, generateSecureSecret, newSlotId } from '../../src/seeds/generate';
import { collectMotionMix } from '../../src/seeds/motion';
import { pickVerify, type VerifyPick } from '../../src/seeds/pickVerify';
import { useSecretScreen } from '../../src/seeds/screenGuard';
import { saveSlot } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

const BIP39_COUNTS: Bip39WordCount[] = [12, 15, 18, 21, 24];

type RevealMeta = {
  bits: number;
  mixed: boolean;
  custom: boolean;
  hex: string;
};

export default function NewSeedScreen() {
  const t = useT();
  const router = useRouter();
  const { model, settings, selectSeed, runWithLoading } = useAppState();
  const [label, setLabel] = useState('Personal');
  const [backup, setBackup] = useState<BackupKind>('bip39');
  const [wordCount, setWordCount] = useState<Bip39WordCount>(24);
  const [threshold, setThreshold] = useState(2);
  const [shareCount, setShareCount] = useState(3);
  const [shake, setShake] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [shares, setShares] = useState<string[]>([]);
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyPick[]>([]);
  const [guess, setGuess] = useState<Record<number, string>>({});
  const [customOpen, setCustomOpen] = useState(false);
  const [customKind, setCustomKind] = useState<CustomEntropyKind>('hex');
  const [customDraft, setCustomDraft] = useState('');
  const [revealMeta, setRevealMeta] = useState<RevealMeta | null>(null);
  const [hexRefused, setHexRefused] = useState(false);
  const revealing = Boolean(mnemonic || shares.length);
  useSecretScreen(() => undefined);

  const slipScheme = backup === 'slip39' ? { threshold: shareCount === 1 ? 1 : threshold, count: shareCount } : null;

  const generate = async () => {
    setBusy(true);
    setError(null);
        setMnemonic(null);
        setShares([]);
        try {
      await runWithLoading(t('common.loading'), async () => {
        const extra = shake ? await collectMotionMix(1500) : undefined;
        if (backup === 'bip39') {
          const usingCustom = customOpen && customDraft.trim().length > 0;
          let next: Uint8Array;
          if (usingCustom) {
            next = parseCustomEntropy(customKind, customDraft, wordCount);
            if (extra && extra.length > 0) {
              next = mixExtraEntropy(next, extra);
            }
          } else {
            next = await generateSecureEntropy(wordCount, extra);
          }
          if (next.every((byte) => byte === 0)) {
            throw new Error('rng returned all zeros');
          }
          const phrase = mnemonicFromEntropy(next);
          if (isKnownUnsafeMnemonic(phrase)) {
            throw new Error(t('generate.knownVector'));
          }
          setSecret(next);
          setMnemonic(phrase);
          setRevealMeta({
            bits: entropyBitsForWordCount(wordCount),
            mixed: Boolean(extra && extra.length > 0),
            custom: usingCustom,
            hex: bytesToEntropyHex(next),
          });
          const picks = pickVerify(phrase.split(' '));
          setVerify(picks);
          setGuess({});
          return;
        }
        const master = await generateSecureSecret(16);
        const created = generateSlip39(master, slipScheme ?? { threshold: 1, count: 1 });
        setSecret(created.secret);
        setShares(created.shares);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'generate.failed';
      if (message === 'too few events') {
        setError(
          customKind === 'dice'
            ? t('generate.customTooShortDice', { n: minDiceRolls(wordCount) })
            : t('generate.customTooShortHex', { n: minHexChars(wordCount) }),
        );
      } else if (message === 'rng returned all zeros') {
        setError(t('generate.failed'));
      } else {
        setError(t(message));
      }
    } finally {
      setBusy(false);
    }
  };

  const verified =
    verify.length === 0 || verify.every((item) => (guess[item.index] ?? '').trim().toLowerCase() === item.word);

  const confirm = async () => {
    if (!secret || !model || !verified) {
      setError(t('generate.needSeedAndModel'));
      return;
    }
    const ok = await requestUnlock(t('unlock.prompt'));
    if (!ok) {
      return;
    }
    try {
      await runWithLoading(t('common.loading'), async () => {
        const saved = await saveSlot(
          {
            id: newSlotId(),
            label: label.trim() || t('generate.defaultName'),
            brand: model.brand,
            modelId: model.id,
            backup,
            wordCount: backup === 'slip39' ? 20 : wordCount,
            shares: slipScheme ?? undefined,
            createdAt: Date.now(),
            paths: mergeChainPaths(settings.defaultPaths),
          },
          secret,
          backup === 'slip39' ? shares : undefined,
        );
        selectSeed(saved);
      });
      if (router.canDismiss()) {
        router.dismiss();
      } else {
        router.back();
      }
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t('generate.saveFailed'));
    }
  };

  return (
    <Screen
      kicker={t('generate.kicker')}
      title={t('generate.title')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      backIcon={<Ionicons name="chevron-back" size={22} color={colors.text} />}
    >
      {!revealing ? (
        <>
          <TextInput
            testID="generate-label"
            value={label}
            onChangeText={setLabel}
            placeholder={t('generate.name')}
            placeholderTextColor={colors.muted}
            autoComplete="off"
            style={styles.input}
          />
          <View style={styles.row}>
            <Button
              testID="generate-bip39"
              label="BIP39"
              variant={backup === 'bip39' ? 'primary' : 'ghost'}
              onPress={() => setBackup('bip39')}
            />
            <Button
              testID="generate-slip39"
              label="SLIP-39"
              variant={backup === 'slip39' ? 'primary' : 'ghost'}
              onPress={() => setBackup('slip39')}
            />
          </View>
          {backup === 'bip39' ? (
            <View style={styles.row}>
              {BIP39_COUNTS.map((count) => (
                <Button
                  key={count}
                  label={`${count}`}
                  testID={`generate-words-${count}`}
                  variant={wordCount === count ? 'primary' : 'ghost'}
                  onPress={() => setWordCount(count)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.row}>
              <Button
                testID="generate-2of3"
                label="2-of-3"
                variant={shareCount === 3 ? 'primary' : 'ghost'}
                onPress={() => {
                  setShareCount(3);
                  setThreshold(2);
                }}
              />
              <Button
                testID="generate-3of5"
                label="3-of-5"
                variant={shareCount === 5 ? 'primary' : 'ghost'}
                onPress={() => {
                  setShareCount(5);
                  setThreshold(3);
                }}
              />
            </View>
          )}
          {backup === 'bip39' ? (
            <>
              <Button
                testID="generate-custom"
                label={t('generate.custom')}
                variant={customOpen ? 'primary' : 'ghost'}
                onPress={() => setCustomOpen((value) => !value)}
              />
              {customOpen ? (
                <>
                  <View style={styles.row}>
                    <Button
                      testID="generate-custom-hex"
                      label={t('generate.customHex')}
                      variant={customKind === 'hex' ? 'primary' : 'ghost'}
                      onPress={() => setCustomKind('hex')}
                    />
                    <Button
                      testID="generate-custom-dice"
                      label={t('generate.customDice')}
                      variant={customKind === 'dice' ? 'primary' : 'ghost'}
                      onPress={() => setCustomKind('dice')}
                    />
                  </View>
                  <TextInput
                    testID="generate-custom-draft"
                    value={customDraft}
                    onChangeText={setCustomDraft}
                    placeholder={
                      customKind === 'dice'
                        ? t('generate.customPlaceholderDice', { n: minDiceRolls(wordCount) })
                        : t('generate.customPlaceholderHex', { n: minHexChars(wordCount) })
                    }
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    multiline
                    style={[styles.input, styles.area]}
                  />
                </>
              ) : null}
            </>
          ) : null}
          <Button
            testID="generate-shake"
            label={busy && shake ? t('generate.shaking') : t('generate.extraShake')}
            variant={shake ? 'primary' : 'ghost'}
            onPress={() => setShake((value) => !value)}
          />
          <Button
            testID="generate-run"
            label={busy ? '…' : t('vault.generate')}
            disabled={busy}
            onPress={() => void generate()}
          />
        </>
      ) : null}
      {mnemonic && revealing ? (
        <View style={styles.words} testID="generate-reveal">
          <Text style={styles.warn}>{t('generate.reveal')}</Text>
          {revealMeta ? (
            <View style={styles.proof}>
              <Text style={styles.proofLabel}>{t('generate.bits', { n: revealMeta.bits })}</Text>
              <Text style={styles.meta}>
                {t('generate.source')}:{' '}
                {revealMeta.custom
                  ? revealMeta.mixed
                    ? t('generate.sourceCustomMixed')
                    : t('generate.sourceCustom')
                  : revealMeta.mixed
                    ? t('generate.sourceMixed')
                    : t('generate.sourceCsprng')}
              </Text>
              <Text style={styles.proofLabel}>{t('generate.hex')}</Text>
              <Text selectable={false} style={styles.hex} onPress={() => setHexRefused(true)}>
                {revealMeta.hex}
              </Text>
              {hexRefused ? (
                <Text selectable={false} style={styles.warn}>
                  {t('generate.copyTitle')}. {t('generate.copyBody')}
                </Text>
              ) : null}
            </View>
          ) : null}
          <MnemonicGrid
            phrase={mnemonic}
            labels={{
              copy: t('generate.copy'),
              copyTitle: t('generate.copyTitle'),
              copyBody: t('generate.copyBody'),
              confirm: t('common.close'),
              cancel: t('common.cancel'),
            }}
          />
          {verify.length > 0 ? (
            <>
              <Text style={styles.warn} testID="generate-verify">
                {t('generate.verify')}
              </Text>
              {verify.map((item) => (
                <TextInput
                  key={item.index}
                  testID={`generate-verify-${item.index}`}
                  value={guess[item.index] ?? ''}
                  onChangeText={(value) => setGuess((current) => ({ ...current, [item.index]: value }))}
                  placeholder={`#${item.index + 1}`}
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
              ))}
            </>
          ) : null}
          <Button testID="generate-confirm" label={t('generate.confirm')} disabled={!verified} onPress={() => void confirm()} />
        </View>
      ) : null}
      {shares.length > 0 ? (
        <View style={styles.words} testID="generate-shares">
          <Text style={styles.warn}>{t('generate.revealShares')}</Text>
          {shares.map((share, index) => (
            <Text key={index} selectable={false} style={styles.mnemonic}>
              {index + 1}. {share}
            </Text>
          ))}
          <Button testID="generate-confirm-shares" label={t('generate.confirm')} onPress={() => void confirm()} />
        </View>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="generate-error">
          {error}
        </Text>
      ) : null}
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
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: space.sm,
  },
  proof: {
    gap: 4,
  },
  proofLabel: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  hex: {
    color: colors.ok,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  words: {
    gap: space.sm,
  },
  mnemonic: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
  },
  warn: {
    color: colors.accent,
    fontFamily: fonts.sans,
  },
  meta: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 13,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.sans,
  },
});
