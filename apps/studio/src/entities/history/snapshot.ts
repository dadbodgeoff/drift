// Pure snapshot functions (no React, no aliases at runtime) so the fixture
// builder can use them too.
import type { CheckReport, Inventory } from "@/shared/contract/drift";
import type { Snapshot } from "@/shared/ipc/contract";

const vkey = (v: { id: string; path: string; symbol: string }) => `${v.id} ${v.path}#${v.symbol}`;

/** What a scan saw, in keys that can be compared with the next scan. */
export function makeSnapshot(input: {
  at: number;
  commit: string | null;
  files: number;
  pending: string[];
  check: CheckReport | null;
  security: Inventory | null;
}): Snapshot {
  const sec = input.security;
  const ek = (e: { path: string; symbol: string }) => `${e.path}#${e.symbol}`;
  return {
    at: input.at,
    commit: input.commit,
    files: input.files,
    pending: [...input.pending].sort(),
    newViolations: (input.check?.violations ?? []).filter((v) => !v.baselined && !v.suppressed).map(vkey).sort(),
    unguarded: (sec?.entry_points ?? []).filter((e) => !e.local && e.guards.length === 0 && !e.opaque?.length).map(ek).sort().slice(0, 20000),
    reaching: (sec?.entry_points ?? []).filter((e) => e.reaches.length > 0).map(ek).sort(),
    sinks: (sec?.sinks ?? []).map((s) => `${s.kind} ${s.path}#${s.symbol}`).sort(),
    leaks: (sec?.client_leaks ?? []).map((l) => l.reaches).sort(),
  };
}

export interface SnapshotDiff {
  newViolations: { added: string[]; removed: string[] };
  unguarded: { added: string[]; removed: string[] };
  reaching: { added: string[]; removed: string[] };
  sinks: { added: string[]; removed: string[] };
  leaks: { added: string[]; removed: string[] };
  pending: { added: string[]; removed: string[] };
}

function delta(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);
  return { added: b.filter((x) => !A.has(x)), removed: a.filter((x) => !B.has(x)) };
}

/** Changes from `prev` to `cur`. */
export function diffSnapshots(prev: Snapshot, cur: Snapshot): SnapshotDiff {
  return {
    newViolations: delta(prev.newViolations, cur.newViolations),
    unguarded: delta(prev.unguarded, cur.unguarded),
    reaching: delta(prev.reaching, cur.reaching),
    sinks: delta(prev.sinks, cur.sinks),
    leaks: delta(prev.leaks, cur.leaks),
    pending: delta(prev.pending, cur.pending),
  };
}

/** Same content (ignoring time)? Avoids recording identical snapshots on every launch. */
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  const strip = (s: Snapshot) => JSON.stringify({ ...s, at: 0 });
  return strip(a) === strip(b);
}

