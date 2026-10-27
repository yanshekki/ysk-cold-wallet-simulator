import { useSyncExternalStore } from 'react';
import type { ApduLogEntry } from '@cws/contracts';

type Listener = () => void;

let entries: ApduLogEntry[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getLogEntries(): readonly ApduLogEntry[] {
  return entries;
}

export function subscribeLogs(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function appendLogEntry(entry: ApduLogEntry, cap: number): void {
  const limit = cap > 0 ? cap : 1000;
  const next = [...entries, entry];
  entries = next.length > limit ? next.slice(next.length - limit) : next;
  emit();
}

export function clearLogEntries(): void {
  entries = [];
  emit();
}

export function useAppLogs(): readonly ApduLogEntry[] {
  return useSyncExternalStore(subscribeLogs, getLogEntries, getLogEntries);
}
