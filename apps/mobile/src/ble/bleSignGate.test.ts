import { describe, expect, it } from 'vitest';
import { BleSignHostGate, bleHostLabel, centralHasLinkKey, linkKeySatisfiesBleSign } from './bleSignGate';

describe('linkKeySatisfiesBleSign', () => {
  it('treats only a bonded link as a link key', () => {
    expect(linkKeySatisfiesBleSign('bonded')).toBe(true);
    expect(linkKeySatisfiesBleSign('bonding')).toBe(false);
    expect(linkKeySatisfiesBleSign('none')).toBe(false);
    expect(linkKeySatisfiesBleSign('unsupported')).toBe(false);
    expect(linkKeySatisfiesBleSign(null)).toBe(false);
  });
});

describe('centralHasLinkKey', () => {
  it('accepts a bonded central and ignores an unknown bond', async () => {
    await expect(centralHasLinkKey('central-a', async () => 'bonded')).resolves.toBe(true);
    await expect(centralHasLinkKey('central-a', async () => 'unsupported')).resolves.toBe(false);
    await expect(centralHasLinkKey(null, async () => 'bonded')).resolves.toBe(false);
    await expect(centralHasLinkKey('central-a', async () => Promise.reject(new Error('off')))).resolves.toBe(false);
  });
});

describe('bleHostLabel', () => {
  it('shortens a central id for the sheet', () => {
    expect(bleHostLabel('ABCDEF12-0000-0000-0000-00000000WXYZ')).toBe('ABCDEF12…WXYZ');
    expect(bleHostLabel('host')).toBe('host');
    expect(bleHostLabel('  ')).toBe('');
  });
});

describe('BleSignHostGate', () => {
  it('asks before a sign write from an unconfirmed central', () => {
    const gate = new BleSignHostGate();
    gate.setCentral('central-a');
    gate.beginWrite();
    expect(gate.needsConfirm('sign', false)).toBe(true);
    expect(gate.needsConfirm('export-seed', false)).toBe(true);
  });

  it('does not ask for account, app, or non-BLE confirms', () => {
    const gate = new BleSignHostGate();
    gate.setCentral('central-a');
    gate.beginWrite();
    expect(gate.needsConfirm('address', false)).toBe(false);
    expect(gate.needsConfirm('verify', false)).toBe(false);
    expect(gate.needsConfirm('open-app', false)).toBe(false);
    expect(gate.needsConfirm('allow-manager', false)).toBe(false);
    gate.endWrite();
    expect(gate.needsConfirm('sign', false)).toBe(false);
  });

  it('skips the sheet when the central has a link key', () => {
    const gate = new BleSignHostGate();
    gate.setCentral('central-a');
    gate.beginWrite();
    expect(gate.needsConfirm('sign', true)).toBe(false);
  });

  it('keeps an allowed central for later signs and asks a different central', () => {
    const gate = new BleSignHostGate();
    gate.setCentral('central-a');
    gate.beginWrite();
    expect(gate.needsConfirm('sign', false)).toBe(true);
    gate.allowCurrent();
    expect(gate.needsConfirm('sign', false)).toBe(false);
    gate.endWrite();
    gate.setCentral(null);
    gate.setCentral('central-a');
    gate.beginWrite();
    expect(gate.needsConfirm('sign', false)).toBe(false);
    gate.setCentral('central-b');
    expect(gate.needsConfirm('sign', false)).toBe(true);
  });

  it('forgets allows when advertising stops', () => {
    const gate = new BleSignHostGate();
    gate.setCentral('central-a');
    gate.allowCurrent();
    gate.reset();
    gate.setCentral('central-a');
    gate.beginWrite();
    expect(gate.needsConfirm('sign', false)).toBe(true);
  });
});
