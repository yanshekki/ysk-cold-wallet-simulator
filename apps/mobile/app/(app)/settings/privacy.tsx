import { PrivacyBody } from '../../../src/disclaimer/PrivacyBody';
import { useT } from '../../../src/i18n';
import { SettingsScreen } from '../../../src/settings/screen';

export default function SettingsPrivacyScreen() {
  const t = useT();
  return (
    <SettingsScreen title={t('settings.privacy')}>
      <PrivacyBody />
    </SettingsScreen>
  );
}
