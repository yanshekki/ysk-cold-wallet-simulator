import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ledgerAppChip } from '@cws/contracts';
import {
  Hud,
  PairingTakeover,
  SigningModal,
  colors,
  formatSessionRemaining,
  radioMode,
} from '@cws/ui';
import { useAppState } from '../../src/state/AppState';

export default function AppShell() {
  const {
    unlockedUntil,
    advertising,
    connected,
    connectedLabel,
    model,
    currentApp,
    pending,
    pairingCode,
    passphrase,
    lock,
    setPassphrase,
    resolveSigning,
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
      <SafeAreaView edges={['top']} style={styles.top}>
        <Hud
          sessionLabel={formatSessionRemaining(unlockedUntil, now)}
          radio={radioMode(advertising, connected)}
          host={connected ? connectedLabel : undefined}
          appChip={
            model?.brand === 'ledger' && (advertising || connected)
              ? ledgerAppChip(currentApp)
              : undefined
          }
          onLock={lock}
        />
      </SafeAreaView>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: styles.tabLabel,
          tabBarIcon: ({ color }) => <View style={[styles.pip, { backgroundColor: color }]} />,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Device' }} />
        <Tabs.Screen name="vault" options={{ title: 'Vault' }} />
        <Tabs.Screen name="console" options={{ title: 'Console' }} />
      </Tabs>
      <PairingTakeover code={pairingCode} />
      <SigningModal
        visible={!!pending}
        request={pending}
        passphrase={passphrase}
        onChangePassphrase={setPassphrase}
        onConfirm={() => resolveSigning(true)}
        onReject={() => resolveSigning(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  top: {
    backgroundColor: colors.bgElevated,
  },
  tabBar: {
    backgroundColor: colors.bgElevated,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
