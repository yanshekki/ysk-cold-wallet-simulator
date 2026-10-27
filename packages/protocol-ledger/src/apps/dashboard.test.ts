import { describe, expect, it } from 'vitest';
import { encodeResponse, SW_OK } from '../apdu';
import { concatBytes, encodeAscii } from '../bytes';
import {
  completeAppAndVersion,
  describeAppAndVersion,
  encodeAppAndVersion,
  ensureAppAndVersion,
  getFirmwareVersion,
  parseAppAndVersion,
} from './dashboard';

function nameOnly(name: string): Uint8Array {
  const nameBytes = encodeAscii(name);
  return encodeResponse(concatBytes(Uint8Array.of(0x01, nameBytes.length), nameBytes), SW_OK);
}

describe('GET_APP_AND_VERSION encoding', () => {
  it('includes format, name, version, and flags', () => {
    const payload = encodeAppAndVersion('BOLOS', '2.7.1');
    expect(payload[0]).toBe(0x01);
    expect(payload[1]).toBe(5);
    expect(parseAppAndVersion(payload)).toEqual({
      name: 'BOLOS',
      version: '2.7.1',
      flags: Uint8Array.of(0x8c),
    });
    expect(payload.length).toBe(17);
  });

  it('pads a 9-byte name-only BOLOS reply so DMK can parse a version', () => {
    const truncated = nameOnly('BOLOS');
    expect(truncated.length).toBe(9);
    const completed = completeAppAndVersion(truncated);
    expect(completed).toEqual(encodeAppAndVersion('BOLOS', '2.7.1'));
    expect(describeAppAndVersion(truncated)).toBe('BOLOS 2.7.1');
  });

  it('leaves a full reply and GET_VERSION firmware payload alone', () => {
    const full = encodeAppAndVersion('Avalanche', '1.4.23');
    expect(completeAppAndVersion(full)).toBe(full);
    const firmware = getFirmwareVersion('nano-x');
    expect(completeAppAndVersion(firmware)).toBe(firmware);
    expect(parseAppAndVersion(firmware)).toBeUndefined();
  });

  it('does not treat Solana GET_APP_CONFIGURATION as GET_APP_AND_VERSION', () => {
    const config = encodeResponse(Uint8Array.of(0x01, 0x01, 0x11, 0x01), SW_OK);
    expect(parseAppAndVersion(config)).toBeUndefined();
    expect(completeAppAndVersion(config)).toBe(config);
  });

  it('synthesizes BOLOS when GET_APP is echoed or otherwise unparseable', () => {
    const echo = Uint8Array.of(0xb0, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
    expect(parseAppAndVersion(echo)).toBeUndefined();
    expect(ensureAppAndVersion(echo)).toEqual(encodeAppAndVersion('BOLOS', '2.7.1'));
    expect(ensureAppAndVersion(echo, 'Avalanche')).toEqual(encodeAppAndVersion('Avalanche', '1.4.22'));
    const deny = encodeResponse(new Uint8Array(), 0x6985);
    expect(ensureAppAndVersion(deny)).toBe(deny);
  });
});
