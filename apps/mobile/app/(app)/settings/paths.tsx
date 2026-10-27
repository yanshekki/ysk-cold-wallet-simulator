import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { ChainPathId, ChainPathMap } from '@cws/contracts';
import { CHAIN_PATH_LABELS, DEFAULT_CHAIN_PATHS, isValidDerivationPath } from '@cws/contracts';
import { Button } from '@cws/ui';
import { useT } from '../../../src/i18n';
import { useAppState } from '../../../src/state/AppState';
import { SettingsScreen } from '../../../src/settings/screen';
import { settingsStyles as styles } from '../../../src/settings/styles';

export default function PathsSettingsScreen() {
  const t = useT();
  const { settings, patchSettings } = useAppState();
  const pathsRef = useRef<ChainPathMap>(settings.defaultPaths);
  pathsRef.current = settings.defaultPaths;

  const savePath = (id: ChainPathId, path: string) => {
    const next = { ...pathsRef.current, [id]: path };
    pathsRef.current = next;
    void patchSettings({ defaultPaths: next });
  };

  return (
    <SettingsScreen title={t('settings.pathsPage')}>
      <Text style={styles.meta}>{t('settings.defaultPaths')}</Text>
      {(Object.keys(DEFAULT_CHAIN_PATHS) as ChainPathId[]).map((id) => (
        <PathField
          key={id}
          id={id}
          saved={settings.defaultPaths[id] ?? DEFAULT_CHAIN_PATHS[id]}
          resetLabel={t('settings.preset')}
          onSave={(path) => savePath(id, path)}
        />
      ))}
    </SettingsScreen>
  );
}

function PathField({
  id,
  saved,
  resetLabel,
  onSave,
}: {
  id: ChainPathId;
  saved: string;
  resetLabel: string;
  onSave: (path: string) => void;
}) {
  const [draft, setDraft] = useState(saved);
  useEffect(() => {
    setDraft(saved);
  }, [saved]);
  const valid = isValidDerivationPath(draft);

  return (
    <View style={styles.pathRow}>
      <View style={styles.pathHead}>
        <Text style={styles.pathLabel}>{CHAIN_PATH_LABELS[id]}</Text>
        <Button
          label={resetLabel}
          variant="ghost"
          onPress={() => {
            const next = DEFAULT_CHAIN_PATHS[id];
            setDraft(next);
            onSave(next);
          }}
        />
      </View>
      <TextInput
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          if (isValidDerivationPath(value)) {
            onSave(value.trim());
          }
        }}
        onBlur={() => {
          if (!isValidDerivationPath(draft)) {
            setDraft(saved);
          }
        }}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        style={[styles.input, !valid && styles.inputInvalid]}
      />
    </View>
  );
}
