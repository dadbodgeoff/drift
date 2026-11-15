// Claude Code transcripts for a repository: ~/.claude/projects/<cwd with
// non-alphanumerics replaced by '-'>/<session>.jsonl, plus worktrees and
// subdirectories (project names that start with the repository's).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectDirName } from "./ops";

export interface SessionFile {
  id: string;
  file: string;
  project: string;
  modified: number;
  bytes: number;
}

const MAX_SESSIONS = 500;

export function listSessionFiles(projectsDir: string, repoRoot: string | null): SessionFile[] {
  if (!existsSync(projectsDir)) return [];
  const want = repoRoot ? projectDirName(repoRoot) : null;
  const out: SessionFile[] = [];
  for (const dir of readdirSync(projectsDir)) {
    if (want && dir !== want && !dir.startsWith(`${want}-`)) continue;
    const full = join(projectsDir, dir);
    let files: string[];
    try {
      files = readdirSync(full).filter((f) => /^[A-Za-z0-9_-]{1,64}\.jsonl$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const st = statSync(join(full, f));
        if (!st.isFile()) continue;
        out.push({ id: f.slice(0, -6), file: join(full, f), project: dir === want ? repoRoot! : dir, modified: st.mtimeMs, bytes: st.size });
      } catch {
        // vanished
      }
    }
  }
  return out.sort((a, b) => b.modified - a.modified).slice(0, MAX_SESSIONS);
}

/** First user prompt (cut short) as a title, read from the head of the file. */
export function sessionTitle(head: string): string | null {
  for (const line of head.split("\n")) {
    try {
      const o = JSON.parse(line) as { type?: string; message?: { content?: unknown }; isSidechain?: boolean; isMeta?: boolean };
      // `isMeta`: text Claude Code adds as a user turn (hook feedback, notifications), not typed by the person.
      if (o.type === "user" && !o.isSidechain && !o.isMeta && typeof o.message?.content === "string") {
        const t = o.message.content.trim().replace(/\s+/g, " ");
        if (t && !t.startsWith("<")) return t.length > 90 ? `${t.slice(0, 89)}…` : t;
      }
    } catch {
      // partial line
    }
  }
  return null;
}
