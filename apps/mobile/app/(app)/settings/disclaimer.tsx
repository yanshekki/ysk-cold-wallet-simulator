import { DisclaimerBody } from '../../../src/disclaimer/DisclaimerBody';
import { useT } from '../../../src/i18n';
import { SettingsScreen } from '../../../src/settings/screen';

export default function SettingsDisclaimerScreen() {
  const t = useT();
  return (
    <SettingsScreen title={t('settings.disclaimer')}>
      <DisclaimerBody />
    </SettingsScreen>
  );
}
