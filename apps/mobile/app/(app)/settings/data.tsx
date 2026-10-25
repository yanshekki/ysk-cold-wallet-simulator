import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { bleAdvertiseName, ledgerOsFor } from '@cws/contracts';
import { Button, colors } from '@cws/ui';
import { useT } from '../../../src/i18n';
import { wipeAllSlots } from '../../../src/seeds/vault';
import { DEFAULT_SETTINGS, detectLanguage, saveActiveSlotId } from '../../../src/settings/store';
import { useAppState } from '../../../src/state/AppState';
import { SettingsScreen } from '../../../src/settings/screen';
import { settingsStyles as styles } from '../../../src/settings/styles';

const LOG_CAPS = [200, 500, 1000, 2000];

function advertisedName(modelName: string, brand: string | undefined, suffix: string): string {
  const clean = suffix.replace(/[^A-Za-z0-9]/g, '').slice(0, 3);
  if (!clean || brand === 'ledger') {
    return modelName;
  }
  return `${modelName} ${clean}`.trim();
}

export default function DataSettingsScreen() {
  const t = useT();
  const { model, settings, patchSettings, selectSeed, showToast, clearLogs } = useAppState();
  const [wipe, setWipe] = useState('');
  const os = ledgerOsFor(model?.id ?? 'nano-x');
  const preview = advertisedName(
    model ? bleAdvertiseName(model) : 'Nano X',
    model?.brand,
    settings.bleNameSuffix,
  );

  const onWipe = async () => {
    if (wipe !== 'WIPE') {
      return;
    }
    await wipeAllSlots();
    await saveActiveSlotId(null);
    selectSeed(null);
    setWipe('');
    showToast(t('settings.wipe'));
  };

  const onReset = () => {
    Alert.alert(t('settings.reset'), t('settings.resetBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: () => {
          void patchSettings({ ...DEFAULT_SETTINGS, language: detectLanguage() }).then(() =>
            showToast(t('settings.reset')),
          );
        },
      },
    ]);
  };

  const onClearConsole = () => {
    Alert.alert(t('console.clearTitle'), t('console.clearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.clearConsole'),
        style: 'destructive',
        onPress: () => {
          clearLogs();
          showToast(t('settings.clearConsole'));
        },
      },
    ]);
  };

  return (
    <SettingsScreen title={t('settings.data')}>
      <View style={styles.card} testID="data-logs">
        <Text style={styles.cardTitle}>{t('settings.console')}</Text>
        <Text style={styles.label}>{t('settings.retention')}</Text>
        <View style={styles.row}>
          {LOG_CAPS.map((cap) => (
            <Pressable
              key={cap}
              testID={`log-cap-${cap}`}
              accessibilityRole="button"
              accessibilityState={{ selected: settings.logCap === cap }}
              onPress={() => void patchSettings({ logCap: cap })}
              style={[styles.chip, settings.logCap === cap && styles.chipOn]}
            >
              <Text style={[styles.chipLabel, settings.logCap === cap && styles.chipLabelOn]}>{cap}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.meta}>{t('settings.logCapNow', { n: settings.logCap })}</Text>
        <Text style={styles.meta}>{t('settings.logCapHelp')}</Text>
        <View style={styles.switchRow}>
          <Text style={styles.label}>{t('settings.confirmClear')}</Text>
          <Switch
            value={settings.confirmClearLogs}
            onValueChange={(value) => void patchSettings({ confirmClearLogs: value })}
          />
        </View>
        <Text style={styles.meta}>{t('settings.confirmClearHelp')}</Text>
        <Button label={t('settings.clearConsole')} variant="ghost" onPress={onClearConsole} />
      </View>

      <View style={styles.card} testID="data-ble">
        <Text style={styles.cardTitle}>{t('settings.bleSuffix')}</Text>
        <TextInput
          value={settings.bleNameSuffix}
          onChangeText={(value) => void patchSettings({ bleNameSuffix: value.slice(0, 4) })}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.meta}>{t('settings.blePreview', { name: preview })}</Text>
        <Text style={styles.meta}>{t('settings.bleLedgerHint')}</Text>
      </View>

      <View style={styles.card} testID="data-about">
        <Text style={styles.cardTitle}>{t('settings.about')}</Text>
        <Text style={styles.meta}>
          {t('settings.version')} {Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
        <Text style={styles.meta}>
          Ledger SE {os.se} / MCU {os.mcu}
        </Text>
      </View>

      <View style={styles.card} testID="data-danger">
        <Text style={[styles.cardTitle, styles.dangerTitle]}>{t('settings.danger')}</Text>
        <Button label={t('settings.reset')} variant="ghost" onPress={onReset} />
        <Text style={styles.meta}>{t('settings.resetBody')}</Text>
        <Text style={styles.meta}>{t('settings.wipeHelp')}</Text>
        <TextInput
          value={wipe}
          onChangeText={setWipe}
          placeholder={t('settings.wipeTyped')}
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          style={styles.input}
        />
        <Button label={t('settings.wipe')} variant="danger" disabled={wipe !== 'WIPE'} onPress={() => void onWipe()} />
      </View>
    </SettingsScreen>
  );
}
