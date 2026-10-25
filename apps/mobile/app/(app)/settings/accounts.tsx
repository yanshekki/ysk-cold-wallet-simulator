import { Switch, Text, View } from 'react-native';
import { useT } from '../../../src/i18n';
import { useAppState } from '../../../src/state/AppState';
import { SettingsScreen } from '../../../src/settings/screen';
import { settingsStyles as styles } from '../../../src/settings/styles';

export default function AccountsSettingsScreen() {
  const t = useT();
  const { settings, patchSettings } = useAppState();

  return (
    <SettingsScreen title={t('settings.accounts')}>
      <Text style={styles.meta}>{t('settings.accountsHint')}</Text>

      <View style={styles.card} testID="activation-near">
        <Text style={styles.cardTitle}>{t('settings.nearTitle')}</Text>
        <Text style={styles.meta}>{t('settings.nearBody')}</Text>
        <View style={styles.switchRow}>
          <Text style={styles.label}>{t('settings.nearAuto')}</Text>
          <Switch
            value={settings.nearAutoSponsor}
            onValueChange={(value) => void patchSettings({ nearAutoSponsor: value })}
          />
        </View>
      </View>

      <View style={styles.card} testID="activation-ton">
        <Text style={styles.cardTitle}>{t('settings.tonTitle')}</Text>
        <Text style={styles.meta}>{t('settings.tonBody')}</Text>
      </View>

      <View style={styles.card} testID="activation-xrp">
        <Text style={styles.cardTitle}>{t('settings.xrpTitle')}</Text>
        <Text style={styles.meta}>{t('settings.xrpBody')}</Text>
      </View>
    </SettingsScreen>
  );
}
