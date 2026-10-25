import { View } from 'react-native';
import { Button } from '@cws/ui';
import { useT } from '../../../src/i18n';
import { useAppState } from '../../../src/state/AppState';
import { SettingsScreen } from '../../../src/settings/screen';
import { settingsStyles as styles } from '../../../src/settings/styles';

export default function LanguageSettingsScreen() {
  const t = useT();
  const { settings, patchSettings } = useAppState();

  return (
    <SettingsScreen title={t('settings.language')}>
      <View style={styles.row}>
        <Button
          label={t('settings.english')}
          variant={settings.language === 'en' ? 'primary' : 'ghost'}
          onPress={() => void patchSettings({ language: 'en' })}
        />
        <Button
          label={t('settings.zhHk')}
          variant={settings.language === 'zh-HK' ? 'primary' : 'ghost'}
          onPress={() => void patchSettings({ language: 'zh-HK' })}
        />
      </View>
    </SettingsScreen>
  );
}
