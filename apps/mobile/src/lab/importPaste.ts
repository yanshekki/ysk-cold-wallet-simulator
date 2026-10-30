/**
 * Import never reads the clipboard until the user confirms Paste.
 * After a successful import, clear the clipboard only when it still holds
 * the text that paste put into the form. A later clipboard is left alone.
 * CWS does not write a recovery phrase to the clipboard.
 */
export function shouldClearConsumedClipboard(pasted: string | null, current: string | null): boolean {
  const used = pasted?.trim() ?? '';
  if (!used) {
    return false;
  }
  return (current ?? '').trim() === used;
}
