import { Text } from 'react-native';
import { CatalogTable } from '@cws/ui';
import { useT } from '../../../src/i18n';
import { useAppState } from '../../../src/state/AppState';
import { SettingsScreen } from '../../../src/settings/screen';
import { settingsStyles as styles } from '../../../src/settings/styles';

export default function CatalogSettingsScreen() {
  const t = useT();
  const { catalog } = useAppState();

  return (
    <SettingsScreen title={t('settings.catalogPage')}>
      <Text style={styles.meta}>{t('settings.ledgerWhen', { when: t('settings.bundled') })}</Text>
      <CatalogTable
        apps={catalog}
        labels={{
          search: t('common.search'),
          app: t('settings.colApp'),
          chip: t('settings.colChip'),
          family: t('settings.colFamily'),
          version: t('settings.colVersion'),
          empty: t('settings.catalogEmpty'),
        }}
      />
    </SettingsScreen>
  );
}
