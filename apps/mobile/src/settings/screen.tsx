import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Screen, colors } from '@cws/ui';
import { useT } from '../i18n';

export function SettingsBackIcon() {
  return <Ionicons name="chevron-back" size={22} color={colors.text} />;
}

export function SettingsScreen({ title, children }: { title: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  return (
    <Screen
      kicker={null}
      title={title}
      edges={[]}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      backIcon={<SettingsBackIcon />}
    >
      {children}
    </Screen>
  );
}
