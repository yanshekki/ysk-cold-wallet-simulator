import { describe, expect, it } from 'vitest';
import {
  decodeEthereumGetAddress,
  decodeEthereumAddress,
  decodeFeatures,
  encodeEthereumAddress,
  encodeFeatures,
  MessageType,
} from './messages';
import {
  decodeFields,
  encodePackedUint32,
  encodeRepeatedUint32,
  encodeString,
  encodeUint32,
  readPackedOrRepeatedUint32,
} from './proto';
import { bytesToHex } from './bytes';

describe('protobuf wire codec', () => {
  it('encodes a uint32 field as tag plus varint', () => {
    expect(bytesToHex(encodeUint32(2, 3))).toBe('1003');
  });

  it('encodes a string field as length-delimited utf8', () => {
    expect(bytesToHex(encodeString(1, 'ab'))).toBe('0a026162');
  });

  it('decodes both packed and unpacked repeated uint32', () => {
    const unpacked = encodeRepeatedUint32(1, [44, 60]);
    expect(readPackedOrRepeatedUint32(decodeFields(unpacked), 1)).toEqual([44, 60]);
    const packed = encodePackedUint32(1, [44, 60]);
    expect(readPackedOrRepeatedUint32(decodeFields(packed), 1)).toEqual([44, 60]);
  });

  it('round-trips EthereumGetAddress address_n', () => {
    const path = [0x8000002c, 0x8000003c, 0x80000000, 0, 0];
    const payload = encodeRepeatedUint32(1, path);
    expect(decodeEthereumGetAddress(payload).addressN).toEqual(path);
  });

  it('round-trips Features vendor and model', () => {
    const encoded = encodeFeatures({
      vendor: 'onekey.so',
      major: 3,
      minor: 13,
      patch: 0,
      deviceId: 'abc',
      label: 'YSK Simulator',
      model: 'classic',
      serial: 'cldeadbeef',
      bleName: 'OneKey Classic',
      onekeyVersion: '3.12.0',
      bleVersion: '1.4.1',
      bootVersion: '2.0.0',
      boardVersion: '1.0.0',
      seVersion: '1.1.7',
      sessionId: new Uint8Array(32),
      deviceType: 0,
    });
    const decoded = decodeFeatures(encoded);
    expect(decoded.vendor).toBe('onekey.so');
    expect(decoded.major).toBe(3);
    expect(decoded.model).toBe('classic');
    expect(decoded.initialized).toBe(true);
  });

  it('encodes EthereumAddress in field 2', () => {
    const encoded = encodeEthereumAddress('0xabc');
    expect(decodeEthereumAddress(encoded)).toBe('0xabc');
    expect(MessageType.EthereumAddress).toBe(57);
  });
});
