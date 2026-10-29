import { Alert, Text } from 'react-native';
import { Button, CatalogTable } from '@cws/ui';
import { useT } from '../../../src/i18n';
import { useAppState } from '../../../src/state/AppState';
import { SettingsScreen } from '../../../src/settings/screen';
import { settingsStyles as styles } from '../../../src/settings/styles';

export default function CatalogSettingsScreen() {
  const t = useT();
  const { settings, catalog, catalogModelId, model, updateLedgerCatalog, selectLedgerAppVersion, showToast, runWithLoading } =
    useAppState();
  const modelId = model?.brand === 'ledger' ? model.id : 'nano-x';

  const onUpdate = async () => {
    try {
      const count = await runWithLoading(t('settings.updating'), () => updateLedgerCatalog());
      showToast(t('settings.ledgerUpdated', { count }));
    } catch {
      Alert.alert(t('common.error'), t('errors.managerFailed'));
    }
  };

  const when = settings.catalogUpdatedAt
    ? new Date(settings.catalogUpdatedAt).toISOString()
    : t('settings.bundled');

  const onSelectVersion = async (id: string, version: string) => {
    try {
      await selectLedgerAppVersion(id, version);
    } catch {
      Alert.alert(t('common.error'), t('errors.versionSaveFailed'));
    }
  };

  return (
    <SettingsScreen title={t('settings.catalogPage')}>
      <Button testID="settings-catalog-update" label={t('settings.ledgerUpdate')} onPress={() => void onUpdate()} />
      <Text style={styles.meta}>{t('settings.ledgerWhen', { when })}</Text>
      <Text style={styles.meta} testID="catalog-version-note">
        {t('settings.versionNote')}
      </Text>
      <CatalogTable
        apps={catalog}
        modelId={modelId}
        savedModelId={catalogModelId}
        onSelectVersion={(id, version) => {
          void onSelectVersion(id, version);
        }}
        labels={{
          search: t('common.search'),
          app: t('settings.colApp'),
          chip: t('settings.colChip'),
          family: t('settings.colFamily'),
          version: t('settings.colVersion'),
          empty: t('settings.catalogEmpty'),
          reported: t('settings.versionReported'),
          cancel: t('common.cancel'),
          versionPick: (app) => t('settings.versionPick', { app }),
        }}
      />
    </SettingsScreen>
  );
}
