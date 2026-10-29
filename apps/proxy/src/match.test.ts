import { describe, expect, it } from 'vitest';
import {
  isPhantomGattError,
  isSystemOnlyServices,
  pickModel,
  probeHit,
  rankModels,
  serviceFromWriteUuid,
  serviceUuids,
} from './match';

describe('pickModel', () => {
  it('matches a Nano X by service UUID', () => {
    const picked = pickModel([
      {
        id: 'aa',
        name: 'Nano X',
        services: ['13d63400-2c97-0004-0000-4c6564676572'],
      },
    ]);
    expect(picked?.model.id).toBe('nano-x');
    expect(picked?.model.usb.vendorId).toBe(0x2c97);
    expect(picked?.model.usb.productId).toBe(0x4001);
  });

  it('prefers an advertisement name when OneKey UUIDs collide', () => {
    const picked = pickModel([
      {
        id: 'bb',
        name: 'Pro 2 A1B2',
        services: ['00000001-0000-1000-8000-00805f9b34fb'],
      },
    ]);
    expect(picked?.model.id).toBe('pro2');
    expect(picked?.model.protocol).toBe('onekey-v2');
  });

  it('prefers the model named in the GAP name when several UUIDs leak', () => {
    const picked = pickModel([
      {
        id: 'dd',
        name: 'Sample的iPhone [Trezor Safe 7]',
        services: [
          '13d63400-2c97-3004-0000-4c6564676572',
          '8c000001-a59b-4d58-a9ad-073df69fa1b1',
        ],
      },
    ]);
    expect(picked?.model.id).toBe('safe-7');
  });

  it('does not pick Ledger/Trezor from a leftover GAP name when services are empty', () => {
    expect(
      pickModel([
        {
          id: 'ee',
          name: 'Sample的iPhone [Trezor Safe 7]',
          services: [],
        },
      ]),
    ).toBeNull();
    expect(
      pickModel([
        {
          id: 'ee2',
          name: 'Sample的iPhone [Nano X]',
          services: [],
        },
      ]),
    ).toBeNull();
  });

  it('picks OneKey Classic 1s from its GAP name when the UUID is omitted', () => {
    const picked = pickModel([
      {
        id: 'ee3',
        name: 'Sample的iPhone [1S A1B2]',
        services: [],
      },
    ]);
    expect(picked?.model.id).toBe('classic1s');
  });

  it('ignores unnamed devices with empty service lists', () => {
    const picked = pickModel([
      {
        id: 'ff',
        name: 'Sample的iPhone',
        services: [],
      },
    ]);
    expect(picked).toBeNull();
  });

  it('filters by --model', () => {
    const picked = pickModel(
      [
        {
          id: 'cc',
          name: 'Trezor Safe 7',
          services: ['8c000001-a59b-4d58-a9ad-073df69fa1b1'],
        },
      ],
      'nano-x',
    );
    expect(picked).toBeNull();
  });

  it('lists every model service UUID once', () => {
    expect(serviceUuids().length).toBeGreaterThan(3);
  });

  it('picks Stax from its UUID even if the GAP name is a leftover OneKey', () => {
    const picked = pickModel([
      {
        id: 'gg',
        name: 'Sample的iPhone [Pro 2 A1B2]',
        services: [
          '13d63400-2c97-6004-0000-4c6564676572',
          '00000001-0000-1000-8000-00805f9b34fb',
        ],
      },
    ]);
    expect(picked?.model.id).toBe('stax');
    expect(picked?.model.brand).toBe('ledger');
  });

  it('still picks OneKey Pro 2 when only the OneKey UUID is present', () => {
    const picked = pickModel([
      {
        id: 'hh',
        name: 'Sample的iPhone [Pro 2 A1B2]',
        services: ['00000001-0000-1000-8000-00805f9b34fb'],
      },
    ]);
    expect(picked?.model.id).toBe('pro2');
  });

  it('picks OneKey from its UUID even if the GAP name is leftover Trezor', () => {
    const picked = pickModel([
      {
        id: 'ii',
        name: 'Sample的iPhone [Trezor Safe 7]',
        services: ['00000001-0000-1000-8000-00805f9b34fb'],
      },
    ]);
    expect(picked?.model.brand).toBe('onekey');
    expect(picked?.model.id).not.toBe('safe-7');
  });

  it('maps a GATT write UUID back to the service UUID', () => {
    expect(serviceFromWriteUuid('00000002-0000-1000-8000-00805f9b34fb')).toBe(
      '00000001-0000-1000-8000-00805f9b34fb',
    );
    expect(serviceFromWriteUuid('8c000002-a59b-4d58-a9ad-073df69fa1b1')).toBe(
      '8c000001-a59b-4d58-a9ad-073df69fa1b1',
    );
    expect(serviceFromWriteUuid('13d63400-2c97-6004-0002-4c6564676572')).toBe(
      '13d63400-2c97-6004-0000-4c6564676572',
    );
  });

  it('does not pick iOS system GATT as OneKey when another phone advertises the same GAP name', () => {
    const picked = pickModel([
      {
        id: 'iphone',
        name: 'Sample的iPhone [Pro 2 A1B2]',
        services: ['180a', 'd0611e78-848c-4dd4-bbd0-91f57c6b9aca'],
      },
      {
        id: 'android',
        name: 'Pro 2 A1B2',
        services: ['00000001-0000-1000-8000-00805f9b34fb'],
      },
    ]);
    expect(picked?.hit.id).toBe('android');
    expect(picked?.model.id).toBe('pro2');
  });

  it('ranks a bare OneKey GAP name ahead of an iPhone-wrapped leftover name', () => {
    const ranked = rankModels([
      {
        id: 'iphone',
        name: 'Sample的iPhone [Pro 2 A1B2]',
        services: [],
      },
      {
        id: 'android',
        name: 'Pro 2 A1B2',
        services: [],
      },
    ]);
    expect(ranked.map((item) => item.hit.id)).toEqual(['android', 'iphone']);
    expect(ranked[0]?.model.id).toBe('pro2');
  });

  it('still matches an optional BLE name suffix on OneKey', () => {
    const picked = pickModel([
      {
        id: 'android',
        name: 'Pro 2 A1B2 X7K',
        services: [],
      },
    ]);
    expect(picked?.model.id).toBe('pro2');
  });

  it('does not probe a system-only iPhone as CWS', () => {
    expect(isSystemOnlyServices(['180a', 'D0611E78-848C-4DD4-BBD0-91F57C6B9ACA'])).toBe(true);
    expect(
      probeHit([
        {
          id: 'iphone',
          name: 'Sample的iPhone',
          services: ['180a'],
        },
      ]),
    ).toBeUndefined();
    expect(pickModel([{ id: 'iphone', name: 'Sample的iPhone', services: ['180a'] }])).toBeNull();
  });

  it('treats missing write on 180a/Continuity as a phantom, not a CWS session', () => {
    expect(
      isPhantomGattError(
        'missing write characteristic want=00000002-0000-1000-8000-00805f9b34fb have=180a/2a29,d0611e78-848c-4dd4-bbd0-91f57c6b9aca/0001',
      ),
    ).toBe(true);
    expect(isPhantomGattError('missing write characteristic want=00000002 have=none')).toBe(true);
    expect(isPhantomGattError('no GATT services')).toBe(true);
    expect(isPhantomGattError('BLE connect timed out')).toBe(false);
  });
});
