import { describe, expect, it } from 'vitest';
import { bytesToHex, equalBytes } from './bytes';
import { Cpace, codeEntryCode, codeEntryCommitment, formatPairingCode, generateCodeEntrySecret } from './pairing';

describe('THP Code Entry', () => {
  it('formats a 6-digit code with leading zeros', () => {
    expect(formatPairingCode(42)).toBe('000042');
  });

  it('commits to a 16-byte secret with SHA-256', () => {
    const secret = generateCodeEntrySecret();
    expect(secret.length).toBe(16);
    expect(codeEntryCommitment(secret).length).toBe(32);
  });

  it('derives a 6-digit code from the handshake hash', () => {
    const hash = new Uint8Array(32).map((_, i) => i);
    const secret = new Uint8Array(16).map((_, i) => 16 - i);
    const challenge = new Uint8Array(16).map((_, i) => i + 3);
    const code = codeEntryCode(hash, secret, challenge);
    expect(code).toBeGreaterThanOrEqual(0);
    expect(code).toBeLessThan(1_000_000);
    expect(formatPairingCode(code).length).toBe(6);
  });

  it('agrees on a CPace shared secret for a known code', () => {
    const handshakeHash = new Uint8Array(32).fill(7);
    const code = '123456';
    const device = new Cpace(handshakeHash);
    const host = new Cpace(handshakeHash);
    device.generateKeys(code);
    host.generateKeys(code);
    const deviceSecret = device.computeSharedSecret(host.publicKey);
    const hostSecret = host.computeSharedSecret(device.publicKey);
    expect(bytesToHex(deviceSecret)).toBe(bytesToHex(hostSecret));
    expect(equalBytes(device.hostTag(), host.hostTag())).toBe(true);
    expect(device.publicKey.length).toBe(32);
  });
});
