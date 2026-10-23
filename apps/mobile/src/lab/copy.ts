import * as Clipboard from 'expo-clipboard';

export async function copyText(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
}
