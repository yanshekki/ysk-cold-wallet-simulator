import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { SeedSlot } from '@cws/contracts';
import { wordCountFromEntropy } from '@cws/sdk';

const SLOTS_KEY = 'cws:slots';

function entropyKey(id: string): string {
  return `cws:entropy:${id}`;
}

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

export async function listSlots(): Promise<SeedSlot[]> {
  const raw = Platform.OS === 'web' ? webGet(SLOTS_KEY) : await SecureStore.getItemAsync(SLOTS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as SeedSlot[];
    return Array.isArray(parsed) ? parsed : [];
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
  try {
    await SecureStore.setItemAsync(key, value, authOptions());
  } catch {
    await SecureStore.setItemAsync(key, value, BASE_OPTIONS);
  }
}

async function readSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return webGet(key);
  }
  try {
    return await SecureStore.getItemAsync(key, authOptions());
  } catch {
    return SecureStore.getItemAsync(key, BASE_OPTIONS);
  }
}

export async function saveSlot(slot: SeedSlot, entropy: Uint8Array): Promise<SeedSlot> {
  wordCountFromEntropy(entropy);
  const slots = await listSlots();
  const next = [...slots.filter((item) => item.id !== slot.id), slot];
  await writeSlots(next);
  await writeSecret(entropyKey(slot.id), bytesToBase64(entropy));
  return slot;
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
  await SecureStore.deleteItemAsync(entropyKey(id));
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
