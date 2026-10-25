import { useState } from 'react';
import { Button, SelectSheet } from '@cws/ui';
import { APP_LANGUAGES, isAppLanguage, useT } from '../../../src/i18n';
import { useAppState } from '../../../src/state/AppState';
import { SettingsScreen } from '../../../src/settings/screen';

export default function LanguageSettingsScreen() {
  const t = useT();
  const { settings, patchSettings } = useAppState();
  const [open, setOpen] = useState(false);
  const current = APP_LANGUAGES.find((item) => item.id === settings.language)?.label ?? settings.language;

  return (
    <SettingsScreen title={t('settings.language')}>
      <Button testID="language-open" label={current} onPress={() => setOpen(true)} />
      <SelectSheet
        visible={open}
        title={t('settings.language')}
        selectedId={settings.language}
        options={APP_LANGUAGES.map((item) => ({ id: item.id, label: item.label }))}
        testIDPrefix="language-"
        onSelect={(id) => {
          if (isAppLanguage(id)) {
            void patchSettings({ language: id });
          }
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        cancelLabel={t('common.cancel')}
        searchPlaceholder={t('common.search')}
      />
    </SettingsScreen>
  );
}
