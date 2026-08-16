// Debug-only console logger. No datastore access whatsoever.
export function dbg(...args: unknown[]) {
  console.log("[debug]", ...args);
}
