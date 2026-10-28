/** Recovery phrases, SLIP-39 shares, and entropy hex are `secret`. Addresses and logs are `public`. */
export type ClipboardKind = 'secret' | 'public';

export function clipboardWriteAllowed(kind: ClipboardKind): boolean {
  return kind === 'public';
}
