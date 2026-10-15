import { useSyncExternalStore } from "react";

/**
 * Tracks API requests that are taking unusually long. On a free hosting plan the server goes to
 * sleep when idle and the first request afterwards can take 30-60 seconds, which otherwise looks
 * like a frozen app. The UI shows a "server is waking up" notice while this is true.
 */
const SLOW_AFTER_MS = 6_000;

const pending = new Map<number, number>();
const listeners = new Set<() => void>();
let seq = 0;
let slow = false;

function recompute() {
  const now = Date.now();
  const next = [...pending.values()].some((startedAt) => now - startedAt > SLOW_AFTER_MS);
  if (next !== slow) {
    slow = next;
    listeners.forEach((l) => l());
  }
}

if (typeof window !== "undefined") setInterval(recompute, 1_000);

export function trackRequestStart(): number {
  const id = ++seq;
  pending.set(id, Date.now());
  return id;
}

export function trackRequestEnd(id: number | undefined) {
  if (id === undefined) return;
  pending.delete(id);
  recompute();
}

export function useServerSlow(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slow
  );
}
