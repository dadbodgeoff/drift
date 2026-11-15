// The Studio's own data, in the app's user-data directory: settings, recent
// repositories, and per repository the fact cache (DRIFT_CACHE_DIR), the last
// slim facts, scan snapshots and the decision audit trail. Never in the repo.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type History, History as HistorySchema } from "../src/shared/ipc/contract";
import { retain } from "../src/shared/api/types";

export interface Settings {
  driftPath: string | null;
  recent: { path: string; name: string }[];
  studiesDir: string | null;
}

const DEFAULTS: Settings = { driftPath: null, recent: [], studiesDir: null };

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(p: string, v: unknown) {
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 1));
  renameSync(tmp, p);
}

export class Store {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  settings(): Settings {
    return { ...DEFAULTS, ...readJson<Partial<Settings>>(join(this.dir, "settings.json"), {}) };
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.settings(), ...patch };
    writeJson(join(this.dir, "settings.json"), next);
    return next;
  }

  addRecent(r: { path: string; name: string }): Settings {
    const recent = [r, ...this.settings().recent.filter((x) => x.path !== r.path)].slice(0, 12);
    return this.update({ recent });
  }

  /** Per-repository directory, keyed by the repository root and its remote. */
  repoDir(root: string, remote: string | null): string {
    const key = createHash("sha256").update(`${root}\n${remote ?? ""}`).digest("hex").slice(0, 24);
    const d = join(this.dir, "repos", key);
    mkdirSync(d, { recursive: true });
    return d;
  }

  history(repoDir: string): History {
    const p = join(repoDir, "history.json");
    if (!existsSync(p)) return { snapshots: [], audit: [] };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      raw = undefined;
    }
    const parsed = HistorySchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    // Unreadable history holds the audit trail: keep it aside instead of letting the next save overwrite it.
    renameSync(p, join(repoDir, `history.unreadable-${Date.now()}.json`));
    return { snapshots: [], audit: [] };
  }

  saveHistory(repoDir: string, h: History): History {
    const kept = retain(h);
    writeJson(join(repoDir, "history.json"), kept);
    return kept;
  }

  clearHistory(repoDir: string): History {
    rmSync(join(repoDir, "history.json"), { force: true });
    return { snapshots: [], audit: [] };
  }
}
