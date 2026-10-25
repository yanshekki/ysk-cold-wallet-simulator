import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  KeyboardAwareScrollView,
  Screen,
  SelectSheet,
  colors,
  fonts,
  hairline,
  radius,
  space,
} from '@cws/ui';
import { DisclaimerBody } from '../src/disclaimer/DisclaimerBody';
import { PrivacyBody } from '../src/disclaimer/PrivacyBody';
import { APP_LANGUAGES, isAppLanguage, useT } from '../src/i18n';
import { useAppState } from '../src/state/AppState';

type LegalTab = 'disclaimer' | 'privacy';

export default function DisclaimerScreen() {
  const t = useT();
  const { settings, patchSettings, acceptDisclaimer } = useAppState();
  const [tab, setTab] = useState<LegalTab>('disclaimer');
  const [agreedDisclaimer, setAgreedDisclaimer] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const languageLabel =
    APP_LANGUAGES.find((item) => item.id === settings.language)?.label ?? settings.language;
  const done = Number(agreedDisclaimer) + Number(agreedPrivacy);
  const canContinue = done === 2 && !busy;
  const agreed = tab === 'disclaimer' ? agreedDisclaimer : agreedPrivacy;
  const agreeLabel = tab === 'disclaimer' ? t('disclaimer.agree') : t('privacy.agree');
  const agreeTestID = tab === 'disclaimer' ? 'disclaimer-agree' : 'privacy-agree';
  const status =
    done === 2
      ? t('legal.bothDone')
      : done === 1
        ? `${t('legal.needBoth')} ${t('legal.progress', { done, total: 2 })}`
        : t('legal.needBoth');

  const onToggleAgree = () => {
    if (tab === 'disclaimer') {
      const next = !agreedDisclaimer;
      setAgreedDisclaimer(next);
      if (next && !agreedPrivacy) {
        setTab('privacy');
      }
      return;
    }
    const next = !agreedPrivacy;
    setAgreedPrivacy(next);
    if (next && !agreedDisclaimer) {
      setTab('disclaimer');
    }
  };

  const onContinue = async () => {
    if (!agreedDisclaimer || !agreedPrivacy || busy) {
      return;
    }
    setBusy(true);
    try {
      await acceptDisclaimer();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll={false}
      kicker="YSK"
      title={t('legal.title')}
      footer={
        <View style={styles.footer}>
          <Text style={[styles.status, done === 2 && styles.statusDone]}>{status}</Text>
          <Pressable
            testID={agreeTestID}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel={agreeLabel}
            onPress={onToggleAgree}
            style={styles.checkRow}
          >
            <View style={[styles.box, agreed && styles.boxOn]}>
              {agreed ? <Text style={styles.tick}>✓</Text> : null}
            </View>
            <Text style={styles.agree}>{agreeLabel}</Text>
          </Pressable>
          <Button
            testID="disclaimer-continue"
            label={t('disclaimer.continue')}
            disabled={!canContinue}
            onPress={() => void onContinue()}
          />
        </View>
      }
    >
      <Pressable
        testID="disclaimer-language"
        accessibilityRole="button"
        accessibilityLabel={t('settings.language')}
        onPress={() => setLanguageOpen(true)}
        style={styles.language}
      >
        <Text style={styles.languageLabel} numberOfLines={1}>
          {languageLabel}
        </Text>
      </Pressable>
      <View style={styles.tabs}>
        <LegalTabButton
          testID="legal-tab-disclaimer"
          label={t('legal.tabDisclaimer')}
          selected={tab === 'disclaimer'}
          agreed={agreedDisclaimer}
          status={agreedDisclaimer ? t('legal.accepted') : t('legal.needed')}
          onPress={() => setTab('disclaimer')}
        />
        <LegalTabButton
          testID="legal-tab-privacy"
          label={t('legal.tabPrivacy')}
          selected={tab === 'privacy'}
          agreed={agreedPrivacy}
          status={agreedPrivacy ? t('legal.accepted') : t('legal.needed')}
          onPress={() => setTab('privacy')}
        />
      </View>
      <Text style={styles.subtitle}>
        {tab === 'disclaimer' ? t('disclaimer.subtitle') : t('privacy.subtitle')}
      </Text>
      <View style={styles.bodyFrame}>
        <KeyboardAwareScrollView key={tab} contentContainerStyle={styles.bodyContent}>
          {tab === 'disclaimer' ? <DisclaimerBody /> : <PrivacyBody />}
        </KeyboardAwareScrollView>
      </View>
      <SelectSheet
        visible={languageOpen}
        title={t('settings.language')}
        selectedId={settings.language}
        options={APP_LANGUAGES.map((item) => ({ id: item.id, label: item.label }))}
        testIDPrefix="language-"
        onSelect={(id) => {
          if (isAppLanguage(id)) {
            void patchSettings({ language: id });
          }
          setLanguageOpen(false);
        }}
        onClose={() => setLanguageOpen(false)}
        cancelLabel={t('common.cancel')}
        searchPlaceholder={t('common.search')}
      />
    </Screen>
  );
}

function LegalTabButton({
  testID,
  label,
  selected,
  agreed,
  status,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  agreed: boolean;
  status: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${status}`}
      onPress={onPress}
      style={[styles.tab, selected && styles.tabSelected, agreed && styles.tabAgreed]}
    >
      <View style={styles.tabHead}>
        {agreed ? <Text style={styles.tabTick}>✓</Text> : null}
        <Text
          style={[styles.tabLabel, selected && styles.tabLabelOn, agreed && styles.tabLabelAgreed]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </View>
      <Text style={[styles.tabStatus, agreed && styles.tabStatusAgreed]}>{status}</Text>
      <View
        style={[
          styles.tabBar,
          selected && (agreed ? styles.tabBarOk : styles.tabBarAccent),
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  language: {
    alignSelf: 'flex-end',
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    minHeight: 36,
    justifyContent: 'center',
  },
  languageLabel: {
    color: colors.text,
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  tabs: {
    flexDirection: 'row',
    gap: space.sm,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm + 3,
    gap: 2,
    overflow: 'hidden',
  },
  tabSelected: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.text,
  },
  tabAgreed: {
    borderColor: colors.ok,
  },
  tabHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabTick: {
    color: colors.ok,
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    lineHeight: 16,
  },
  tabLabel: {
    flex: 1,
    color: colors.muted,
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  tabLabelOn: {
    color: colors.text,
  },
  tabLabelAgreed: {
    color: colors.ok,
  },
  tabStatus: {
    color: colors.muted,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tabStatusAgreed: {
    color: colors.ok,
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: 'transparent',
  },
  tabBarAccent: {
    backgroundColor: colors.accent,
  },
  tabBarOk: {
    backgroundColor: colors.ok,
  },
  subtitle: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  bodyFrame: {
    flex: 1,
    minHeight: 0,
  },
  bodyContent: {
    paddingBottom: space.xl,
  },
  footer: {
    gap: space.md,
  },
  status: {
    color: colors.muted,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  statusDone: {
    color: colors.ok,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  box: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  boxOn: {
    borderColor: colors.ok,
    backgroundColor: colors.bgElevated,
  },
  tick: {
    color: colors.ok,
    fontSize: 14,
    lineHeight: 16,
    fontFamily: fonts.sansSemi,
  },
  agree: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
});
