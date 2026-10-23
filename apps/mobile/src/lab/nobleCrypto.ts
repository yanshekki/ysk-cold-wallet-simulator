/** Browser/RN WebCrypto alias for @noble/hashes (package exports "./crypto.js" is not listed). */
export const crypto =
  typeof globalThis === 'object' && 'crypto' in globalThis ? globalThis.crypto : undefined;
