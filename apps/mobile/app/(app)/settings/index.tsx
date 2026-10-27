import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Linking, Pressable, Text } from 'react-native';
import { Button, Screen, colors } from '@cws/ui';
import { useT } from '../../../src/i18n';
import { settingsStyles as styles } from '../../../src/settings/styles';

const YSK_SITE = 'https://ysk.hk';

const LINKS = [
  { href: '/(app)/settings/language', label: 'settings.language', testID: 'settings-link-language' },
  { href: '/(app)/settings/security', label: 'settings.security', testID: 'settings-link-security' },
  { href: '/(app)/settings/catalog', label: 'settings.catalogPage', testID: 'settings-link-catalog' },
  { href: '/(app)/settings/paths', label: 'settings.pathsPage', testID: 'settings-link-paths' },
  { href: '/(app)/settings/data', label: 'settings.data', testID: 'settings-link-data' },
] as const;

export default function SettingsIndexScreen() {
  const t = useT();
  const router = useRouter();

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
      <Button
        testID="settings-link-privacy"
        label={t('settings.privacy')}
        variant="ghost"
        onPress={() => router.push('/(app)/settings/privacy')}
      />
      <Button
        testID="settings-link-disclaimer"
        label={t('settings.disclaimer')}
        variant="ghost"
        onPress={() => router.push('/(app)/settings/disclaimer')}
      />
      <Button
        testID="settings-link-ysk"
        label={t('settings.poweredBy')}
        variant="ghost"
        onPress={() => void Linking.openURL(YSK_SITE)}
      />
    </Screen>
  );
}
