import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ledgerAppChip, signingHoldLabel } from '@cws/contracts';
import {
  Hud,
  PairingTakeover,
  SigningModal,
  Toast,
  colors,
  fonts,
  formatSessionRemaining,
  hairline,
  radioMode,
} from '@cws/ui';
import { useT } from '../../src/i18n';
import { useAppState } from '../../src/state/AppState';

export default function AppShell() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const {
    unlockedUntil,
    advertising,
    connected,
    connectedLabel,
    model,
    seed,
    currentApp,
    pending,
    pairingCode,
    sessionPassphraseApplied,
    passphraseFingerprint,
    toast,
    lock,
    resolveSigning,
    settings,
  } = useAppState();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  if (!unlockedUntil || unlockedUntil <= now) {
    return <Redirect href="/unlock" />;
  }

  return (
    <View style={styles.root}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.bgElevated }}>
        <Hud
          sessionLabel={formatSessionRemaining(unlockedUntil, now)}
          seedLabel={seed?.label ? seed.label.slice(0, 12) : undefined}
          radio={radioMode(advertising, connected)}
          host={connected ? connectedLabel : undefined}
          appChip={
            model?.brand === 'ledger' && (advertising || connected)
              ? ledgerAppChip(currentApp)
              : undefined
          }
          onLock={lock}
          lockLabel={t('hud.lock')}
          noHostLabel={t('hud.noHost')}
        />
      </View>
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: false,
          safeAreaInsets: { left: 0, right: 0 },
          sceneStyle: styles.scene,
          tabBarStyle: [
            styles.tabBar,
            { paddingBottom: Math.max(insets.bottom, 6), height: 48 + Math.max(insets.bottom, 6) },
          ],
          tabBarActiveTintColor: colors.ok,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: styles.tabLabel,
          tabBarIcon: ({ focused, color }) => {
            const names = {
              index: focused ? 'hardware-chip' : 'hardware-chip-outline',
              vault: focused ? 'shield-checkmark' : 'shield-checkmark-outline',
              console: focused ? 'terminal' : 'terminal-outline',
              settings: focused ? 'settings' : 'settings-outline',
            } as const;
            const name = names[route.name as keyof typeof names] ?? 'ellipse-outline';
            return <Ionicons name={name} size={20} color={color} />;
          },
        })}
      >
        <Tabs.Screen name="index" options={{ title: t('tabs.device'), tabBarButtonTestID: 'tab-device' }} />
        <Tabs.Screen name="vault" options={{ title: t('tabs.vault'), tabBarButtonTestID: 'tab-vault' }} />
        <Tabs.Screen name="console" options={{ title: t('tabs.console'), tabBarButtonTestID: 'tab-console' }} />
        <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarButtonTestID: 'tab-settings' }} />
      </Tabs>
      <PairingTakeover
        code={pairingCode}
        kicker={t('pairing.kicker')}
        hint={t('pairing.hint')}
      />
      <SigningModal
        visible={!!pending}
        request={pending}
        onConfirm={() => resolveSigning(true)}
        onReject={() => resolveSigning(false)}
        holdLabel={t(signingHoldLabel(pending?.kind ?? 'sign'))}
        holdDurationSeconds={settings.holdDurationSeconds}
        rejectLabel={t('signing.reject')}
        confirmTitle={t('signing.title')}
        verifyingLabel={t('signing.verifying')}
        sessionPassphraseApplied={sessionPassphraseApplied}
        passphraseAppliedLabel={
          passphraseFingerprint
            ? t('signing.fingerprint', { hex: passphraseFingerprint })
            : t('signing.applied')
        }
        passphraseIdleLabel={t('signing.idle')}
        passphraseHostLabel={t('signing.hostPassphrase')}
        copy={{
          decodeFailed: t('signing.decodeFailed'),
          personalMessage: t('signing.personalMessage'),
          rawMessage: t('signing.rawMessage'),
          noticeOpenApp: t('signing.noticeOpenApp'),
          noticeManager: t('signing.noticeManager'),
          noticePairing: t('signing.noticePairing'),
          noticeVerify: t('signing.noticeVerify'),
          payload: t('signing.payload'),
          purposeSign: t('signing.purposeSign'),
          purposeAddress: t('signing.purposeAddress'),
          purposeVerify: t('signing.purposeVerify'),
          purposeOpenApp: t('signing.purposeOpenApp'),
          purposeManager: t('signing.purposeManager'),
          purposePairing: t('signing.purposePairing'),
          purposeExportSeed: t('signing.purposeExportSeed'),
          headlineBtcTx: t('signing.headlineBtcTx'),
          headlineEthTx: t('signing.headlineEthTx'),
          headlineTokenTransfer: t('signing.headlineTokenTransfer'),
          headlineTokenApprove: t('signing.headlineTokenApprove'),
          headlineEip712: t('signing.headlineEip712'),
          fieldLabels: {
            CHAIN: t('signing.field.chain'),
            'CHAIN ID': t('signing.field.chainId'),
            PATH: t('signing.field.path'),
            TO: t('signing.field.to'),
            VALUE: t('signing.field.value'),
            FEE: t('signing.field.fee'),
            WEI: t('signing.field.wei'),
            NONCE: t('signing.field.nonce'),
            GAS: t('signing.field.gas'),
            'GAS PRICE': t('signing.field.gasPrice'),
            'MAX FEE': t('signing.field.maxFee'),
            'MAX PRIORITY': t('signing.field.maxPriority'),
            'ACCESS LIST': t('signing.field.accessList'),
            'BLOB FEE': t('signing.field.blobFee'),
            BLOBS: t('signing.field.blobs'),
            AUTHORIZATIONS: t('signing.field.authorizations'),
            SELECTOR: t('signing.field.selector'),
            DATA: t('signing.field.data'),
            METHOD: t('signing.field.method'),
            CONTRACT: t('signing.field.contract'),
            'AMOUNT RAW': t('signing.field.amountRaw'),
            AMOUNT: t('signing.field.amount'),
            TICKER: t('signing.field.ticker'),
            TYPE: t('signing.field.type'),
            DOMAIN: t('signing.field.domain'),
            MESSAGE: t('signing.field.message'),
            HASH: t('signing.field.hash'),
            BYTES: t('signing.field.bytes'),
            PAYLOAD: t('signing.field.payload'),
            SPENDER: t('signing.field.spender'),
          },
        }}
      />
      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  tabBar: {
    backgroundColor: colors.bgElevated,
    borderTopColor: colors.border,
    borderTopWidth: hairline,
    minHeight: 48,
  },
  tabLabel: {
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  scene: {
    backgroundColor: colors.bg,
    paddingLeft: 0,
    paddingRight: 0,
  },
});
