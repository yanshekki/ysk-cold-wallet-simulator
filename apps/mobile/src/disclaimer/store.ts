import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { isDisclaimerAccepted } from './acceptance';
import { DISCLAIMER_KEY, DISCLAIMER_VERSION } from './version';

function webGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function webSet(key: string, value: string): void {
  globalThis.localStorage?.setItem(key, value);
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return webGet(key);
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSet(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteRaw(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export async function loadDisclaimerAccepted(): Promise<boolean> {
  return isDisclaimerAccepted(await readRaw(DISCLAIMER_KEY));
}

export async function saveDisclaimerAcceptance(now = Date.now()): Promise<void> {
  await writeRaw(
    DISCLAIMER_KEY,
    JSON.stringify({ version: DISCLAIMER_VERSION, acceptedAt: now }),
  );
}

export async function clearDisclaimerAcceptance(): Promise<void> {
  await deleteRaw(DISCLAIMER_KEY);
}
