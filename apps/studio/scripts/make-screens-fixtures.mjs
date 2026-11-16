// Fixtures for the Proposals from the map, Upgrade and Feedback views, written by running the real `drift` binary.
//
//   node scripts/make-screens-fixtures.mjs --drift <drift> --work <scratch dir>
//
// Each repository is rebuilt in the scratch directory from what fixtures/<id>/ already holds: its sources (the whole
// repository as scripts/make-fixtures.mjs left it), `.drift/conventions.yaml` and `drift.lock`. Run this again after
// make-fixtures.mjs (or make-round11-fixtures.mjs) rewrites fixtures/acme or fixtures/quiet.
//
// acme is a team whose files an older Drift wrote, so `drift upgrade` has something to say:
// - its conventions file is the committed one (format 1, written before proposals from the map);
// - `.claude/settings.json` holds exactly the entries an older Drift's `drift export claude-settings` wrote, read from
//   crates/drift-cli/src/upgrade.rs `OLDER_SETTINGS` (the list `drift upgrade` itself compares with);
// - `.drift/security.lock` is what `drift security --write-baseline` writes, less its `# inventory:` line: a baseline
//   from before baselines were stamped (ratchet.rs reads one without the line as inventory 1).
// All of it is committed on branch `main`, as a team would have it. Then, each written as Drift printed it (the scratch
// path replaced by /work/<id>, the build's commit left out):
//   fixtures/screens/<id>/from-map.json             drift census --from-map --json
//   fixtures/screens/<id>/upgrade.json              drift upgrade --json (exit 3: something is left; 0: nothing)
//   fixtures/screens/acme/upgrade-apply.json        drift upgrade --apply --json, on a copy
//   fixtures/screens/acme/upgrade-apply-security.json   drift upgrade --apply --security-baseline --json, on a copy
//   fixtures/screens/acme/feedback-marks.json       .drift/feedback/marks.json after two `drift feedback mark` runs:
//                                                   the first new violation of `drift check` marked true, the first
//                                                   baselined one marked wrong with a reason
//   fixtures/screens/index.json                     which repository has which file (the fixture adapter reads it)
// quiet has nothing to upgrade and nothing from the map; beacon has none of these files (the views' error state).

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const driftRoot = resolve(app, "../..");
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const drift = resolve(arg("--drift") ?? "");
const work = resolve(arg("--work") ?? "");
if (!arg("--drift") || !arg("--work")) throw new Error("usage: node scripts/make-screens-fixtures.mjs --drift <drift> --work <scratch dir>");
const fixtures = join(app, "fixtures");
const out = join(fixtures, "screens");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const GIT_ENV = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-11-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-11-01T00:00:00Z",
};
function git(repo, args) {
  const r = spawnSync("git", args, { cwd: repo, env: { ...process.env, ...GIT_ENV }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

/** The repository as fixtures/<id>/ holds it, committed on `main`. */
function rebuild(id) {
  const src = join(fixtures, id);
  const repo = join(work, id);
  cpSync(join(src, "sources"), repo, { recursive: true });
  mkdirSync(join(repo, ".drift"), { recursive: true });
  cpSync(join(src, "conventions.yaml"), join(repo, ".drift", "conventions.yaml"));
  cpSync(join(src, "drift.lock"), join(repo, "drift.lock"));
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "the team's repository"]);
  return repo;
}

function runner(id, repo) {
  const env = { ...process.env, DRIFT_CACHE_DIR: join(work, `cache-${id}`) };
  for (const k of ["DRIFT_EXPERIMENTAL", "DRIFT_NEIGHBOUR_GATE", "DRIFT_NO_FROM_MAP"]) delete env[k];
  return (args, allow = [0], root = repo) => {
    const r = spawnSync(drift, ["--root", root, ...args], { env, encoding: "utf8", maxBuffer: 1 << 30 });
    if (!allow.includes(r.status)) throw new Error(`drift ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
    // The scratch path is not part of a fixture: the repository is /work/<id>, as the other fixtures name it.
    return r.stdout.split(root).join(`/work/${id}`);
  };
}

const save = (id, name, v) => {
  mkdirSync(join(out, id), { recursive: true });
  writeFileSync(join(out, id, name), JSON.stringify(v, null, 1) + "\n");
};

/** `census --from-map --json`, without the build's commit. */
function fromMap(id, run) {
  const doc = JSON.parse(run(["census", "--from-map", "--json"]));
  doc.commit = null;
  save(id, "from-map.json", doc);
  return doc;
}

/** The `.claude/settings.json` an older Drift wrote: upgrade.rs `OLDER_SETTINGS`, the oldest row's allow list. */
function olderSettings() {
  const rs = readFileSync(join(driftRoot, "crates/drift-cli/src/upgrade.rs"), "utf8");
  let body = rs.slice(rs.indexOf("const OLDER_SETTINGS"));
  body = body.slice(body.indexOf("= &[(") + 5, body.indexOf(")];"));
  const allow = [...body.slice(0, body.indexOf("],")).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (allow.length < 5) throw new Error("could not read OLDER_SETTINGS from upgrade.rs");
  return JSON.stringify({ permissions: { allow } }, null, 2) + "\n";
}

const index = { repos: {} };

// ---------- acme ----------
{
  const id = "acme";
  const repo = rebuild(id);
  const run = runner(id, repo);
  const fm = fromMap(id, run);
  // What an older Drift left: its agent settings, and a security baseline from before baselines were stamped.
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".claude", "settings.json"), olderSettings());
  run(["security", "--write-baseline"]);
  const lock = join(repo, ".drift", "security.lock");
  writeFileSync(
    lock,
    readFileSync(lock, "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("# inventory: "))
      .join("\n"),
  );
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "agent settings and the security baseline, as an older Drift wrote them"]);
  const up = JSON.parse(run(["upgrade", "--json"], [0, 3]));
  save(id, "upgrade.json", up);
  for (const [name, flags] of [
    ["upgrade-apply.json", ["--apply"]],
    ["upgrade-apply-security.json", ["--apply", "--security-baseline"]],
  ]) {
    const copy = join(work, `${id}-${name.replace(/\.json$/, "")}`);
    cpSync(repo, copy, { recursive: true });
    save(id, name, JSON.parse(run(["upgrade", ...flags, "--json"], [0, 3], copy)));
  }
  // Feedback: the first new violation marked true, the first baselined one marked wrong, as a person would.
  const check = JSON.parse(run(["check", "--format", "json"], [0, 1]));
  const fresh = check.violations.find((v) => !v.baselined && v.symbol);
  const legacy = check.violations.find((v) => v.baselined && v.symbol);
  if (!fresh || !legacy) throw new Error("acme's check has no new or no baselined violation to mark");
  run(["feedback", "mark", "--true", "--", fresh.id, `${fresh.path}#${fresh.symbol}`]);
  run(["feedback", "mark", "--wrong", "--why=health check, public by design", "--", legacy.id, `${legacy.path}#${legacy.symbol}`]);
  // A mark keeps the day it was made (feedback.rs `today`); the fixture keeps the commits' day, so a rerun writes the same bytes.
  const marks = JSON.parse(readFileSync(join(repo, ".drift", "feedback", "marks.json"), "utf8"));
  for (const m of marks.marks) m.day = GIT_ENV.GIT_AUTHOR_DATE.slice(0, 10);
  save(id, "feedback-marks.json", marks);
  index.repos[id] = { fromMap: true, upgrade: true, upgradeApply: true, marks: true };
  console.log(`acme: ${fm.from_map.length} entries from the map, upgrade pending ${up.pending} (${up.left.length} left), 2 marks`);
}

// ---------- quiet ----------
{
  const id = "quiet";
  const repo = rebuild(id);
  const run = runner(id, repo);
  const fm = fromMap(id, run);
  const up = JSON.parse(run(["upgrade", "--json"], [0, 3]));
  save(id, "upgrade.json", up);
  index.repos[id] = { fromMap: true, upgrade: true, upgradeApply: false, marks: false };
  console.log(`quiet: ${fm.from_map.length} entries from the map, upgrade pending ${up.pending}`);
}

writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 1) + "\n");
if (!existsSync(join(out, "acme", "upgrade.json"))) throw new Error("nothing written");
