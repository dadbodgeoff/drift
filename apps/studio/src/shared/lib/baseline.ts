// The security baseline (`drift security --write-baseline`, crates/drift-cli/src/main.rs; the file is
// crates/drift-mine/src/ratchet.rs `render_lock_with`), as the Studio runs it and reads it back. One command builder for
// the main process, the fixture adapter and the confirmation, so the command a person is shown is the one that runs.

/** Where Drift writes the baseline (ratchet.rs `SECURITY_LOCK`). */
export const SECURITY_LOCK = ".drift/security.lock";

/** The command the Security view's "Write the baseline" runs (electron/ops.ts `driftArgs`, op `securityBaseline`). */
export const baselineCommand = (root: string) => `drift --root ${root} security --write-baseline`;

/** What a `.drift/security.lock` says of itself: its findings by kind, the inventory version that wrote it, and the kinds that fail. */
export interface SecurityLock {
  findings: number;
  /** Findings by kind, as the file lists them (`kind<TAB>key`). */
  byKind: Record<string, number>;
  /** `# inventory: N`, the reading that wrote it; null when the header has none (an older Drift). */
  inventory: number | null;
  /** `# fail: a,b`: the kinds that fail `drift check`; null when the header has none (every kind fails, as before). */
  fail: string[] | null;
}

/**
 * Reads a baseline as ratchet.rs `parse_lock` and `parse_baseline` do: one finding per distinct `kind<TAB>key` row
 * (two branches merged with `merge=union` may repeat one), every `# fail:` line's kinds (their union) and the newest
 * `# inventory:` stamp. Null for no file. A line of another shape is not counted: the file is Drift's to read, the
 * Studio only counts.
 */
export function readSecurityLock(text: string | null | undefined): SecurityLock | null {
  if (text === null || text === undefined) return null;
  const rows = new Set<string>();
  let inventory: number | null = null;
  let fail: Set<string> | null = null;
  for (const raw of text.replace(/^\uFEFF/, "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("#")) {
      const inv = /^# inventory: (\d+)\s*$/.exec(line);
      if (inv) inventory = Math.max(inventory ?? 0, Number(inv[1]));
      const f = /^# fail: (.*)$/.exec(line);
      if (f) for (const k of f[1].split(",").map((x) => x.trim()).filter(Boolean)) (fail ??= new Set()).add(k);
      continue;
    }
    if (line.indexOf("\t") > 0) rows.add(line);
  }
  const byKind: Record<string, number> = {};
  for (const r of rows) {
    const kind = r.slice(0, r.indexOf("\t"));
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return { findings: rows.size, byKind, inventory, fail: fail ? [...fail].sort() : null };
}
