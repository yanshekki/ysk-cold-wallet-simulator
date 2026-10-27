import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { HOLD_CONFIRM_SECONDS } from '@cws/contracts';
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
            testID="security-faceid"
            value={settings.faceIdEnabled}
            onValueChange={(value) => void patchSettings({ faceIdEnabled: value })}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.label}>{t('settings.signReauth')}</Text>
          <Switch
            testID="security-sign-reauth"
            value={settings.signReauth}
            onValueChange={(value) => void patchSettings({ signReauth: value })}
          />
        </View>
        <Text style={styles.meta}>{t('settings.signReauthHelp')}</Text>
        <Text style={styles.label}>{t('settings.autoLock')}</Text>
        <TextInput
          testID="security-autolock"
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
        <Text style={styles.label}>{t('settings.holdDuration')}</Text>
        <View testID="security-hold-duration" style={styles.row}>
          {HOLD_CONFIRM_SECONDS.map((seconds) => (
            <Pressable
              key={seconds}
              testID={`hold-duration-${seconds}`}
              accessibilityRole="button"
              accessibilityState={{ selected: settings.holdDurationSeconds === seconds }}
              onPress={() => void patchSettings({ holdDurationSeconds: seconds })}
              style={[styles.chip, settings.holdDurationSeconds === seconds && styles.chipOn]}
            >
              <Text
                style={[styles.chipLabel, settings.holdDurationSeconds === seconds && styles.chipLabelOn]}
              >
                {seconds}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.meta}>{t('settings.holdDurationHelp')}</Text>
      </View>
    </SettingsScreen>
  );
}
