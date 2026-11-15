// Structured local logging. Entries stay on this machine: in memory here, and
// in the app's log file via the main process. Nothing is ever sent anywhere.
import type { LogEntry } from "@/shared/ipc/contract";

type Sink = (e: LogEntry) => void;

const buf: LogEntry[] = [];
const listeners = new Set<() => void>();
let sink: Sink | null = null;

export function setLogSink(s: Sink | null) {
  sink = s;
}

export function log(level: LogEntry["level"], message: string, data?: Record<string, unknown>) {
  const e: LogEntry = { at: Date.now(), level, source: "renderer", message, data };
  buf.push(e);
  if (buf.length > 1000) buf.shift();
  try {
    sink?.(e);
  } catch {
    // logging must never throw
  }
  listeners.forEach((l) => l());
}

export function rendererLogs(): LogEntry[] {
  return buf.slice();
}

export function onLog(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
