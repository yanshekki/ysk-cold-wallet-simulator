import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type { SeedSlot } from '@cws/contracts';
import {
  FAST_INSPECT_IDS,
  inspectAddresses,
  inspectAddressesChunked,
  mnemonicFromEntropy,
  SLOW_INSPECT_IDS,
  type InspectRow,
} from '@cws/sdk';
import {
  AddressInspector,
  Button,
  MnemonicGrid,
  Screen,
  SeedCard,
  Sheet,
  colors,
  fonts,
  space,
} from '@cws/ui';
import { copyText } from '../../src/lab/copy';
import { useT } from '../../src/i18n';
import { unlock as requestUnlock } from '../../src/passkeys';
import { useSecretScreen } from '../../src/seeds/screenGuard';
import { deleteSlot, listSlots, loadEntropy } from '../../src/seeds/vault';
import { useAppState } from '../../src/state/AppState';

function inspectKey(slot: SeedSlot): string {
  return `${slot.id}:${JSON.stringify(slot.paths ?? {})}`;
}

export default function VaultScreen() {
  const t = useT();
  const router = useRouter();
  const { seed, model, selectSeed, showToast, refreshNear, runWithLoading } = useAppState();
  const [slots, setSlots] = useState<SeedSlot[]>([]);
  const [rows, setRows] = useState<InspectRow[]>([]);
  const [deriveError, setDeriveError] = useState<string | null>(null);
  const [backupWords, setBackupWords] = useState<string | null>(null);
  const [accountsSlot, setAccountsSlot] = useState<SeedSlot | null>(null);
  const [slotsReady, setSlotsReady] = useState(false);
  const cache = useRef(new Map<string, InspectRow[]>());
  const inspectSeq = useRef(0);
  useSecretScreen(() => undefined);

  const refresh = useCallback(async () => {
    try {
      setSlots(await listSlots());
    } catch {
      setSlots([]);
    } finally {
      setSlotsReady(true);
    }
  }, []);

  const loadInspector = useCallback(
    async (slot: SeedSlot | null) => {
      const ticket = ++inspectSeq.current;
      if (!slot) {
        setRows([]);
        setDeriveError(null);
        return;
      }
      const key = inspectKey(slot);
      const hit = cache.current.get(key);
      if (hit) {
        setRows(hit);
        setDeriveError(null);
        return;
      }
      try {
        let fast: InspectRow[] = [];
        const secret = await runWithLoading(t('common.loading'), async () => {
          const entropy = await loadEntropy(slot.id);
          fast = await inspectAddressesChunked(
            entropy,
            slot.backup ?? 'bip39',
            '',
            slot.paths,
            FAST_INSPECT_IDS,
            {
              shouldAbort: () => ticket !== inspectSeq.current,
              onChunk: (next) => {
                if (ticket === inspectSeq.current) {
                  setRows(next);
                }
              },
            },
          );
          return entropy;
        });
        if (ticket !== inspectSeq.current) {
          return;
        }
        setDeriveError(null);
        setTimeout(() => {
          if (ticket !== inspectSeq.current) {
            return;
          }
          const slow = inspectAddresses(secret, slot.backup ?? 'bip39', '', slot.paths, SLOW_INSPECT_IDS);
          const merged = [...fast.filter((row) => row.id !== 'ada'), ...slow];
          cache.current.set(key, merged);
          setRows(merged);
        }, 0);
      } catch (err) {
        if (ticket !== inspectSeq.current) {
          return;
        }
        setRows([]);
        setDeriveError(err instanceof Error ? err.message : 'could not derive addresses');
      }
    },
    [runWithLoading, t],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    void loadInspector(accountsSlot);
  }, [accountsSlot, loadInspector]);

  const closePhrase = () => {
    setBackupWords(null);
  };

  const closeAccounts = () => {
    setAccountsSlot(null);
  };

  const onSelect = (slot: SeedSlot) => {
    selectSeed(slot);
    closePhrase();
    closeAccounts();
  };

  const onDelete = (slot: SeedSlot) => {
    Alert.alert(t('vault.delete'), t('vault.deleteConfirm', { label: slot.label }), [
      { text: t('vault.cancel'), style: 'cancel' },
      {
        text: t('vault.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteSlot(slot.id);
            if (seed?.id === slot.id) {
              selectSeed(null);
              setRows([]);
            }
            closePhrase();
            closeAccounts();
            await refresh();
          })();
        },
      },
    ]);
  };

  const onBackup = async (slot: SeedSlot) => {
    selectSeed(slot);
    if (slot.backup === 'slip39') {
      Alert.alert(t('vault.backup'), t('vault.backupSlip39'));
      return;
    }
    const ok = await requestUnlock();
    if (!ok) {
      return;
    }
    try {
      await runWithLoading(t('common.loading'), async () => {
        const entropy = await loadEntropy(slot.id);
        setBackupWords(mnemonicFromEntropy(entropy));
      });
    } catch (err) {
      setDeriveError(err instanceof Error ? err.message : 'backup failed');
    }
  };

  const onOpenAccounts = (slot: SeedSlot) => {
    selectSeed(slot);
    setAccountsSlot(slot);
  };

  const onCreateNear = (slot: SeedSlot) => {
    void runWithLoading(t('common.loading'), () => refreshNear(slot, true))
      .then(async (updated) => {
        setAccountsSlot(updated);
        await refresh();
      })
      .catch((err) => Alert.alert(t('common.error'), err instanceof Error ? err.message : 'NEAR'));
  };

  const ledgerSlip39 = accountsSlot?.backup === 'slip39' && model?.brand === 'ledger';
  const closeIcon = <Ionicons name="close" size={22} color={colors.text} />;

  return (
    <>
    <Screen kicker={t('vault.kicker')} title={t('vault.title')} subtitle={t('vault.subtitle')} edges={[]}>
      <Button label={t('vault.generate')} onPress={() => router.push('/seeds/new')} />
      <Button label={t('vault.import')} variant="ghost" onPress={() => router.push('/seeds/import')} />
      {!slotsReady ? <Text style={styles.empty}>{t('common.loading')}</Text> : null}
      {slotsReady && slots.length === 0 ? <Text style={styles.empty}>{t('vault.empty')}</Text> : null}
      {deriveError ? <Text style={styles.error}>{deriveError}</Text> : null}
      {slots.map((slot) => (
        <SeedCard
          key={slot.id}
          slot={slot}
          selected={seed?.id === slot.id}
          isDefault={seed?.id === slot.id}
          defaultLabel={t('vault.default')}
          onPress={() => onSelect(slot)}
          onDefault={() => selectSeed(slot)}
          onDelete={() => onDelete(slot)}
          deleteIcon={<Ionicons name="trash-outline" size={20} color={colors.danger} />}
        >
          <View style={styles.actions}>
            <Button
              testID={`vault-phrase-${slot.id}`}
              label={t('vault.backup')}
              variant="ghost"
              onPress={() => void onBackup(slot)}
            />
            <Button
              testID={`vault-accounts-${slot.id}`}
              label={t('vault.inspectTitle')}
              variant="ghost"
              onPress={() => onOpenAccounts(slot)}
            />
          </View>
        </SeedCard>
      ))}
      <View style={styles.tabInset} />
    </Screen>

      <Sheet
        visible={!!backupWords}
        title={t('vault.backup')}
        onClose={closePhrase}
        closeLabel={t('common.close')}
        closeIcon={closeIcon}
        testID="vault-phrase-sheet"
      >
        {backupWords ? (
          <MnemonicGrid
            phrase={backupWords}
            onCopy={(value) => {
              void copyText(value).then(() => showToast(t('common.copied')));
            }}
            labels={{
              copy: t('vault.copyPhrase'),
              copyTitle: t('vault.copyPhraseTitle'),
              copyBody: t('vault.copyPhraseBody'),
              confirm: t('common.confirm'),
              cancel: t('common.cancel'),
            }}
          />
        ) : null}
      </Sheet>

      <Sheet
        visible={!!accountsSlot}
        title={t('vault.inspectTitle')}
        onClose={closeAccounts}
        closeLabel={t('common.close')}
        closeIcon={closeIcon}
        testID="vault-accounts-sheet"
      >
        {deriveError ? <Text style={styles.error}>{deriveError}</Text> : null}
        {accountsSlot ? (
          <AddressInspector
            rows={rows}
            onCopy={(value) => {
              void copyText(value).then(() => showToast(t('common.copied')));
            }}
            warning={ledgerSlip39 ? t('vault.ledgerSlip39') : null}
            copyPathLabel={t('vault.copyPath')}
            copyIcon={<Ionicons name="copy-outline" size={14} color={colors.ok} />}
            createIcon={<Ionicons name="add" size={20} color={colors.ok} />}
            showCreateNear={!accountsSlot.nearAccountId}
            onCreateNear={() => onCreateNear(accountsSlot)}
          />
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  empty: {
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 20,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.sans,
  },
  actions: {
    gap: space.sm,
  },
  tabInset: {
    height: 180,
  },
});
