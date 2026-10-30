import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { clipboardWriteAllowed, type ClipboardKind } from './secretClipboard';

export async function copyText(value: string, kind: ClipboardKind = 'public'): Promise<boolean> {
  if (!clipboardWriteAllowed(kind)) {
    return false;
  }
  await Clipboard.setStringAsync(value);
  return true;
}

export async function readClipboard(): Promise<string> {
  return Clipboard.getStringAsync();
}

export async function clearClipboard(): Promise<void> {
  await Clipboard.setStringAsync('');
}

export async function exportText(filename: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) {
      await copyText(value);
      return;
    }
    const blob = new Blob([value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ message: value, title: filename });
}
