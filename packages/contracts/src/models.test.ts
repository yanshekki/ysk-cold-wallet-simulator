import { describe, expect, it } from 'vitest';
import {
  LEDGER_BLE_SEGMENT,
  ONEKEY_BLE,
  TREZOR_BLE,
  bleCharacteristicsMatchService,
  foldBlePeripheralIdWrite,
  formatBleIdentityToken,
  ledgerBleUuid,
  ledgerServicesAreDistinct,
  parseBlePeripheralId,
} from './bleIdentity';
import { ALL_MODELS, LEDGER_MODELS, ONEKEY_MODELS, TREZOR_MODELS, bleAdvertiseName, bleGapLocalName, bleGapNameMatches } from './models';

describe('bleAdvertiseName', () => {
  it('keeps OneKey names short enough for an iOS ADV packet', () => {
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'classic')!)).toBe('K1234');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'classic1s')!)).toBe('1S A1B2');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'pure')!)).toBe('P1234');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'touch')!)).toBe('T1234');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'pro')!)).toBe('Pro A1B2');
  });

  it('uses short Ledger local names instead of the full product title', () => {
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'nano-x')!)).toBe('Nano X');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'flex')!)).toBe('Flex');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'stax')!)).toBe('Stax');
    expect(bleAdvertiseName(ALL_MODELS.find((m) => m.id === 'gen5')!)).toBe('Nano G5');
  });

  it('puts a per-phone token inside the OneKey name and leaves the service UUID shared', () => {
    const pro2 = ONEKEY_MODELS.find((model) => model.id === 'pro2')!;
    const classic = ONEKEY_MODELS.find((model) => model.id === 'classic')!;
    expect(bleAdvertiseName(pro2, '4821')).toBe('Pro 2 4821');
    expect(bleAdvertiseName(classic, '4821')).toBe('K4821');
    expect(bleAdvertiseName(pro2, '4821')).not.toBe(bleAdvertiseName(pro2, '1093'));
    expect(pro2.serviceUUID).toBe(classic.serviceUUID);
    expect(pro2.serviceUUID).toBe(ONEKEY_BLE.serviceUUID);
    expect(bleGapNameMatches(pro2, 'Pro 2 4821')).toBe(true);
    expect(bleGapNameMatches(classic, 'Pro 2 4821')).toBe(false);
    expect(bleGapNameMatches(ONEKEY_MODELS.find((model) => model.id === 'pro')!, 'Pro 2 4821')).toBe(false);
    expect(bleGapNameMatches(ONEKEY_MODELS.find((model) => model.id === 'pro')!, 'Pro 22D8')).toBe(true);
  });

  it('does not append a suffix to Ledger names', () => {
    const nano = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    expect(bleGapLocalName(nano, { token: '4821', suffix: 'XYZ' })).toBe('Nano X');
  });
});

describe('BLE service UUIDs', () => {
  it('gives each Ledger model the official distinct service UUID', () => {
    expect(ledgerServicesAreDistinct(LEDGER_MODELS)).toBe(true);
    expect(LEDGER_MODELS.find((model) => model.id === 'nano-x')!.serviceUUID).toBe(
      '13d63400-2c97-0004-0000-4c6564676572',
    );
    expect(LEDGER_MODELS.find((model) => model.id === 'flex')!.serviceUUID).toBe(
      ledgerBleUuid(LEDGER_BLE_SEGMENT.flex, '0000'),
    );
    expect(LEDGER_MODELS.find((model) => model.id === 'flex')!.serviceUUID).toBe(
      '13d63400-2c97-3004-0000-4c6564676572',
    );
    expect(LEDGER_MODELS.find((model) => model.id === 'stax')!.serviceUUID).toBe(
      '13d63400-2c97-6004-0000-4c6564676572',
    );
    expect(LEDGER_MODELS.find((model) => model.id === 'gen5')!.serviceUUID).toBe(
      '13d63400-2c97-8004-0000-4c6564676572',
    );
    const services = LEDGER_MODELS.map((model) => model.serviceUUID);
    expect(new Set(services).size).toBe(LEDGER_MODELS.length);
    expect(services).not.toContain(ONEKEY_BLE.serviceUUID);
    expect(services).not.toContain(TREZOR_BLE.serviceUUID);
  });

  it('fails when every Ledger model is given the Nano X service UUID', () => {
    const nano = LEDGER_MODELS.find((model) => model.id === 'nano-x')!;
    const shared = LEDGER_MODELS.map((model) => ({
      ...model,
      serviceUUID: nano.serviceUUID,
      writeCharUUID: nano.writeCharUUID,
      notifyCharUUID: nano.notifyCharUUID,
      writeCmdCharUUID: nano.writeCmdCharUUID,
    }));
    expect(ledgerServicesAreDistinct(shared)).toBe(false);
    const flex = shared.find((model) => model.id === 'flex')!;
    expect(bleCharacteristicsMatchService(flex)).toBe(false);
    expect(bleCharacteristicsMatchService(nano)).toBe(true);
  });

  it('keeps OneKey on one official service and Trezor on its own', () => {
    expect(new Set(ONEKEY_MODELS.map((model) => model.serviceUUID))).toEqual(
      new Set([ONEKEY_BLE.serviceUUID]),
    );
    expect(ONEKEY_MODELS[0]?.writeCharUUID).toBe('00000002-0000-1000-8000-00805f9b34fb');
    expect(ONEKEY_MODELS[0]?.notifyCharUUID).toBe('00000003-0000-1000-8000-00805f9b34fb');
    expect(TREZOR_MODELS.map((model) => model.serviceUUID)).toEqual([TREZOR_BLE.serviceUUID]);
    expect(TREZOR_BLE.writeCharUUID).toBe('8c000002-a59b-4d58-a9ad-073df69fa1b1');
    expect(TREZOR_BLE.notifyCharUUID).toBe('8c000003-a59b-4d58-a9ad-073df69fa1b1');
    expect(ALL_MODELS.every((model) => bleCharacteristicsMatchService(model))).toBe(true);
  });

  it('formats a 4-digit identity token', () => {
    expect(formatBleIdentityToken(Uint8Array.of(0x12, 0x34))).toMatch(/^\d{4}$/);
    expect(formatBleIdentityToken(Uint8Array.of(0, 0))).toBe('0000');
  });
});

describe('peripheral lock id', () => {
  const sample = '09C9EE96-4AB6-F964-B996-9D8D4D48A870';

  it('accepts the host lock id and rejects nearby text', () => {
    expect(parseBlePeripheralId(sample)).toBe(sample);
    expect(parseBlePeripheralId(`  ${sample}  `)).toBe(sample);
    expect(parseBlePeripheralId('AA:BB:CC:DD:EE:FF')).toBe('AA:BB:CC:DD:EE:FF');
    expect(parseBlePeripheralId('hci0/dev_AA_BB_CC_DD_EE_FF')).toBe('hci0/dev_AA_BB_CC_DD_EE_FF');
    expect(parseBlePeripheralId('13d63400-2c97-0004-0000-4c6564676572')).toBe(
      '13d63400-2c97-0004-0000-4c6564676572',
    );
    expect(parseBlePeripheralId('Nano X')).toBeNull();
    expect(parseBlePeripheralId('')).toBeNull();
    expect(parseBlePeripheralId(`${sample}\nsecret`)).toBeNull();
  });

  it('reassembles a split ATT write and keeps the proxy spelling', () => {
    const bytes = new TextEncoder().encode(sample);
    const head = foldBlePeripheralIdWrite(null, 0, bytes.subarray(0, 20));
    expect(head.id).toBeNull();
    const tail = foldBlePeripheralIdWrite(head.pending, 20, bytes.subarray(20));
    expect(tail.id).toBe(sample);
    expect(tail.pending).toBeNull();
    const whole = foldBlePeripheralIdWrite(null, 0, bytes);
    expect(whole.id).toBe(sample);
  });
});
