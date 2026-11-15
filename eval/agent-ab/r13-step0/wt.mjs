// Checkouts for step 0 without copying objects. The dev clones are shallow, so `git clone
// --shared` silently copies every object (a 1.1 GB pack per run on infisical). Instead: a bare
// repo whose objects come from the dev clone through alternates, and `git worktree add` per run,
// sparse like the v2 harness (no media). At most `cap` checkouts exist at once.

import { existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sh } from "../v2/lib.mjs";

const SPARSE = ["/*", "!*.png", "!*.jpg", "!*.jpeg", "!*.gif", "!*.webp", "!*.mp4", "!*.mov", "!*.pdf", "!*.ico", "!*.woff", "!*.woff2", "!*.ttf", "!*.mp3", "!*.wav", "!*.zip"];

/** A bare repo at `dir` reading `src`'s objects through alternates (nothing copied). */
export function bareFrom(src, dir) {
  mkdirSync(dirname(dir), { recursive: true });
  sh("git", ["init", "-q", "--bare", dir]);
  writeFileSync(join(dir, "objects/info/alternates"), join(src, ".git/objects") + "\n");
  if (existsSync(join(src, ".git/shallow"))) copyFileSync(join(src, ".git/shallow"), join(dir, "shallow"));
}

let live = 0;
const waiters = [];
export async function withCheckout(bare, wt, fn, cap = 2) {
  while (live >= cap) await new Promise((r) => waiters.push(r));
  live++;
  try {
    if (existsSync(wt)) remove(bare, wt);
    mkdirSync(dirname(wt), { recursive: true });
    sh("git", ["-C", bare, "worktree", "add", "-q", "--no-checkout", "--detach", wt, "HEAD"]);
    sh("git", ["-C", wt, "sparse-checkout", "set", "--no-cone", ...SPARSE]);
    sh("git", ["-C", wt, "read-tree", "-mu", "HEAD"]);
    return await fn(wt);
  } finally {
    remove(bare, wt);
    live--;
    waiters.shift()?.();
  }
}

function remove(bare, wt) {
  rmSync(wt, { recursive: true, force: true });
  sh("git", ["-C", bare, "worktree", "prune"]);
}
