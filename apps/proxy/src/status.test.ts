import { describe, expect, it } from 'vitest';
import { createPairingGate } from './pairing';
import { createStatusBus } from './status';

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
    bus.log('hello');
    expect(bus.snapshot().logs[0].line).toBe('hello');
    bus.idle();
    expect(bus.snapshot().running).toBe(false);
    expect(bus.snapshot().radio).toBe('IDLE');
    expect(seen.includes('SCAN')).toBe(true);
    expect(bus.snapshot().logs[0].line).toBe('hello');
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
