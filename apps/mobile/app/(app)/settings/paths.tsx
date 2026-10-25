import { Text, TextInput, View } from 'react-native';
import type { ChainPathId } from '@cws/contracts';
import { CHAIN_PATH_LABELS, DEFAULT_CHAIN_PATHS, isValidDerivationPath } from '@cws/contracts';
import { Button } from '@cws/ui';
import { useT } from '../../../src/i18n';
import { useAppState } from '../../../src/state/AppState';
import { SettingsScreen } from '../../../src/settings/screen';
import { settingsStyles as styles } from '../../../src/settings/styles';

export default function PathsSettingsScreen() {
  const t = useT();
  const { settings, patchSettings } = useAppState();

  return (
    <SettingsScreen title={t('settings.pathsPage')}>
      <Text style={styles.meta}>{t('settings.defaultPaths')}</Text>
      {(Object.keys(DEFAULT_CHAIN_PATHS) as ChainPathId[]).map((id) => {
        const current = settings.defaultPaths[id] ?? DEFAULT_CHAIN_PATHS[id];
        return (
          <View key={id} style={styles.pathRow}>
            <View style={styles.pathHead}>
              <Text style={styles.pathLabel}>{CHAIN_PATH_LABELS[id]}</Text>
              <Button
                label={t('settings.preset')}
                variant="ghost"
                onPress={() =>
                  void patchSettings({
                    defaultPaths: { ...settings.defaultPaths, [id]: DEFAULT_CHAIN_PATHS[id] },
                  })
                }
              />
            </View>
            <TextInput
              value={current}
              onChangeText={(value) => {
                if (!isValidDerivationPath(value) && value.length > 3) {
                  return;
                }
                void patchSettings({ defaultPaths: { ...settings.defaultPaths, [id]: value } });
              }}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>
        );
      })}
    </SettingsScreen>
  );
}
