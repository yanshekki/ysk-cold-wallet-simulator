import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export const SESSION_MS = 15 * 60 * 1000;

export async function authenticateUnlock(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return true;
  }
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.length === 0) {
        return true;
      }
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock YSK Cold Wallet Simulator',
      biometricsSecurityLevel: 'strong',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return true;
  }
}
