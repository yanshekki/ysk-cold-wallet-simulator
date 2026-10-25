import { Switch, Text, TextInput, View } from 'react-native';
import { useT } from '../../../src/i18n';
import { useAppState } from '../../../src/state/AppState';
import { SettingsScreen } from '../../../src/settings/screen';
import { settingsStyles as styles } from '../../../src/settings/styles';

export default function SecuritySettingsScreen() {
  const t = useT();
  const { settings, patchSettings } = useAppState();

  return (
    <SettingsScreen title={t('settings.security')}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('settings.session')}</Text>
        <View style={styles.switchRow}>
          <Text style={styles.label}>{t('settings.faceId')}</Text>
          <Switch
            value={settings.faceIdEnabled}
            onValueChange={(value) => void patchSettings({ faceIdEnabled: value })}
          />
        </View>
        <Text style={styles.label}>{t('settings.autoLock')}</Text>
        <TextInput
          value={String(settings.autoLockMinutes)}
          onChangeText={(value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              void patchSettings({ autoLockMinutes: parsed });
            }
          }}
          keyboardType="number-pad"
          style={styles.input}
        />
      </View>
    </SettingsScreen>
  );
}
