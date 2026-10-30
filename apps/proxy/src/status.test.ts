import { describe, expect, it } from 'vitest';
import { createPairingGate } from './pairing';
import { createStatusBus, redactSecrets } from './status';

describe('status bus', () => {
  it('derives SCAN then HID from phase patches', () => {
    const bus = createStatusBus();
    const seen: string[] = [];
    bus.subscribe((status) => seen.push(status.radio));
    expect(bus.snapshot().radio).toBe('IDLE');
    bus.patch({ running: true, phase: 'scanning' });
    expect(bus.snapshot().radio).toBe('SCAN');
    bus.patch({ phase: 'gatt', hid: 'skipped' });
    expect(bus.snapshot().radio).toBe('GATT');
    bus.patch({ hid: 'up', phase: 'hid' });
    expect(bus.snapshot().radio).toBe('HID');
    bus.patch({ labReady: true });
    expect(bus.snapshot().labReady).toBe(true);
    bus.log('hello');
    expect(bus.snapshot().logs[0].line).toBe('hello');
    bus.log('abandon '.repeat(11) + 'about');
    expect(bus.snapshot().logs[0].line).toBe('[redacted]');
    bus.log(`entropy ${'ab'.repeat(32)}`);
    expect(bus.snapshot().logs[0].line).toBe('entropy [redacted]');
    expect(redactSecrets('host connected')).toBe('host connected');
    bus.idle();
    expect(bus.snapshot().running).toBe(false);
    expect(bus.snapshot().radio).toBe('IDLE');
    expect(bus.snapshot().hid).toBe('up');
    expect(bus.snapshot().vendorId).toBeNull();
    expect(seen.includes('SCAN')).toBe(true);
    expect(bus.snapshot().logs.some((entry) => entry.line === 'hello')).toBe(true);
    bus.clearLogs();
    expect(bus.snapshot().logs).toEqual([]);
  });
});

describe('pairing gate', () => {
  it('resolves wait when submit is called', async () => {
    const gate = createPairingGate();
    const pending = gate.wait();
    gate.submit('12-34-56');
    await expect(pending).resolves.toBe('123456');
  });

  it('rejects wait when reset', async () => {
    const gate = createPairingGate();
    const pending = gate.wait();
    gate.reset();
    await expect(pending).rejects.toThrow('pairing cancelled');
  });
});
