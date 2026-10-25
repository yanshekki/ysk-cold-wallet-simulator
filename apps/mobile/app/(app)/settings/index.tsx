import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { Button, Screen, colors } from '@cws/ui';
import { useT } from '../../../src/i18n';
import { useAppState } from '../../../src/state/AppState';
import { settingsStyles as styles } from '../../../src/settings/styles';

const LINKS = [
  { href: '/(app)/settings/language', label: 'settings.language', testID: 'settings-link-language' },
  { href: '/(app)/settings/security', label: 'settings.security', testID: 'settings-link-security' },
  { href: '/(app)/settings/accounts', label: 'settings.accounts', testID: 'settings-link-accounts' },
  { href: '/(app)/settings/catalog', label: 'settings.catalogPage', testID: 'settings-link-catalog' },
  { href: '/(app)/settings/paths', label: 'settings.pathsPage', testID: 'settings-link-paths' },
  { href: '/(app)/settings/data', label: 'settings.data', testID: 'settings-link-data' },
] as const;

export default function SettingsIndexScreen() {
  const t = useT();
  const router = useRouter();
  const { seed } = useAppState();

  return (
    <Screen kicker={t('settings.kicker')} title={t('settings.title')} edges={[]}>
      {LINKS.map((item) => (
        <Pressable
          key={item.href}
          testID={item.testID}
          accessibilityRole="button"
          accessibilityLabel={t(item.label)}
          onPress={() => router.push(item.href)}
          style={styles.link}
        >
          <Text style={styles.linkLabel}>{t(item.label)}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      ))}
      <Text style={styles.section}>{t('settings.activeSeed')}</Text>
      <Button
        label={seed?.label ?? t('settings.none')}
        variant="ghost"
        onPress={() => router.push('/(app)/vault')}
      />
    </Screen>
  );
}
