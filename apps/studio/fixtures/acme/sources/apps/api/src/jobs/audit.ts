export function audit(entry: { event: string; actor?: string }) {
  return entry.event;
}
