// Provenance from .git, by reading files (Drift and the Studio never run git).
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

function gitDir(root: string): string | null {
  const dot = join(root, ".git");
  try {
    const text = readFileSync(dot, "utf8");
    // A worktree or submodule: `.git` is a file pointing at the real directory.
    const m = /^gitdir:\s*(.+)$/m.exec(text);
    if (m) return isAbsolute(m[1].trim()) ? m[1].trim() : resolve(root, m[1].trim());
  } catch {
    // `.git` is a directory (or absent)
  }
  try {
    readFileSync(join(dot, "HEAD"), "utf8");
    return dot;
  } catch {
    return null;
  }
}

function commonDir(dir: string): string {
  try {
    const c = readFileSync(join(dir, "commondir"), "utf8").trim();
    return isAbsolute(c) ? c : resolve(dir, c);
  } catch {
    return dir;
  }
}

export interface GitInfo {
  commit: string | null;
  branch: string | null;
  remote: string | null;
}

export function gitInfo(root: string): GitInfo {
  const dir = gitDir(root);
  if (!dir) return { commit: null, branch: null, remote: null };
  const common = commonDir(dir);
  let head: string;
  try {
    head = readFileSync(join(dir, "HEAD"), "utf8").trim();
  } catch {
    return { commit: null, branch: null, remote: null };
  }
  let commit: string | null = null;
  let branch: string | null = null;
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
  if (ref) {
    branch = ref.replace(/^refs\/heads\//, "");
    for (const d of [dir, common]) {
      try {
        commit = readFileSync(join(d, ref), "utf8").trim();
        break;
      } catch {
        // try packed refs
      }
    }
    if (!commit) {
      try {
        const packed = readFileSync(join(common, "packed-refs"), "utf8");
        commit = packed.split("\n").find((l) => l.endsWith(` ${ref}`))?.split(" ")[0] ?? null;
      } catch {
        commit = null;
      }
    }
  } else if (/^[0-9a-f]{40,64}$/.test(head)) commit = head;
  let remote: string | null;
  try {
    const cfg = readFileSync(join(common, "config"), "utf8");
    remote = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(cfg)?.[1] ?? null;
  } catch {
    remote = null;
  }
  return { commit: commit ? commit.slice(0, 7) : null, branch, remote };
}
