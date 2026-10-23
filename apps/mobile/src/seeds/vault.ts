import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { SeedSlot } from '@cws/contracts';
import { wordCountFromEntropy } from '@cws/sdk';
import { isDevBuild } from '../passkeys/devFlag';
import { entropyKey, LEGACY_SLOTS_KEY, SLOTS_KEY } from './vaultKeys';

export { entropyKey, secureStoreKey, SLOTS_KEY } from './vaultKeys';

const BASE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

function authOptions() {
  return {
    ...BASE_OPTIONS,
    requireAuthentication: true,
    authenticationPrompt: 'Unlock seed',
  };
}

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

function webDelete(key: string): void {
  globalThis.localStorage?.removeItem(key);
}

async function readSlotsRaw(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return webGet(SLOTS_KEY) ?? webGet(LEGACY_SLOTS_KEY);
  }
  try {
    return await SecureStore.getItemAsync(SLOTS_KEY);
  } catch {
    return null;
  }
}

export async function listSlots(): Promise<SeedSlot[]> {
  try {
    const raw = await readSlotsRaw();
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as SeedSlot[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((slot) => ({
      ...slot,
      backup: slot.backup ?? 'bip39',
    }));
  } catch {
    return [];
  }
}

async function writeSlots(slots: SeedSlot[]): Promise<void> {
  const value = JSON.stringify(slots);
  if (Platform.OS === 'web') {
    webSet(SLOTS_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(SLOTS_KEY, value, BASE_OPTIONS);
}

async function writeSecret(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSet(key, value);
    return;
  }
  // WHEN_UNLOCKED_THIS_DEVICE_ONLY is the device-side gate. The 15-minute
  // session already required the platform authenticator. Extra
  // requireAuthentication prompts fail under iPhone Mirroring ("continue on iPhone").
  await SecureStore.setItemAsync(key, value, BASE_OPTIONS);
}

async function readSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return webGet(key);
  }
  try {
    const stored = await SecureStore.getItemAsync(key, BASE_OPTIONS);
    if (stored) {
      return stored;
    }
  } catch {
    // Fall through to the authenticated copy of older slots.
  }
  if (isDevBuild()) {
    // Debug builds skip Face ID; authenticated SecureStore copies stay unread.
    return null;
  }
  try {
    return await SecureStore.getItemAsync(key, authOptions());
  } catch {
    return null;
  }
}

export async function saveSlot(slot: SeedSlot, entropy: Uint8Array): Promise<SeedSlot> {
  if ((slot.backup ?? 'bip39') === 'bip39') {
    wordCountFromEntropy(entropy);
  }
  const stored: SeedSlot = { ...slot, backup: slot.backup ?? 'bip39' };
  const slots = await listSlots();
  const next = [...slots.filter((item) => item.id !== stored.id), stored];
  await writeSlots(next);
  await writeSecret(entropyKey(stored.id), bytesToBase64(entropy));
  return stored;
}

export async function loadEntropy(id: string): Promise<Uint8Array> {
  const raw = await readSecret(entropyKey(id));
  if (!raw) {
    throw new Error('seed entropy not found');
  }
  return base64ToBytes(raw);
}

export async function deleteSlot(id: string): Promise<void> {
  const slots = (await listSlots()).filter((slot) => slot.id !== id);
  await writeSlots(slots);
  if (Platform.OS === 'web') {
    webDelete(entropyKey(id));
    return;
  }
  try {
    await SecureStore.deleteItemAsync(entropyKey(id));
  } catch {
    // Missing or previously invalid keys should not block delete.
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
