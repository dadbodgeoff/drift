// Build the Studio's round-11 fixtures by running the real, shipped `drift` (a release build; the frozen F11 binary
// for this round) on synthetic repositories we own. Nothing here reads a dev, blind or held-out repository.
//
//   node scripts/make-round11-fixtures.mjs --drift <release drift> --work <scratch dir>
//
// Outputs (committed; all ours, Apache-2.0), each beside acme in fixtures/index.json:
//   fixtures/beacon/   scripts/synth-beacon.mjs after a person answered every block candidate's one question
//                      (`drift review --answer`: same, different with files set apart and one entry point confirmed,
//                      not-a-convention) with the review log on, then three new files. Its check runs with the
//                      neighbour gate on (`DRIFT_NEIGHBOUR_GATE=on`), so one warning is held back
//                      (`suppressed_neighbour`); check-gate-off.json is the same check with the gate off, the default.
//                      Census withholds its one Python proposal (D13-py, `python_proposals.withheld: 1`).
//                      security-diff.json is `drift security --diff-base main` after the three new files.
//   fixtures/quiet/    a small Python repository with Python proposals turned on (`proposals: {python: on}`) where
//                      Drift proposes nothing: the empty states (no conventions, no question, a clean check).
//   fixtures/broken/   a repository whose .drift/conventions.yaml a person broke by hand: `drift check`,
//                      `drift review --json` and (since #167, which links shared guards to conventions)
//                      `drift security --json` refuse it (exit 2), and errors.json keeps what they printed.
//
// Every run writes the same bytes: fixed paths (/work/<repo>), no timestamps, no salts (the review-log export keeps
// ids and paths, and its times are replaced by their order).

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { slimFacts } from "../src/shared/contract/slim.ts";
import { driftErrorLine } from "../electron/ops.ts";
import { BEACON, FIXTURE, UNGUARDED, writeBeacon } from "./synth-beacon.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (!arg("--drift") || !arg("--work")) throw new Error("usage: make-round11-fixtures.mjs --drift <release drift> --work <scratch dir>");
const drift = resolve(arg("--drift"));
const work = resolve(arg("--work"));
const out = join(app, "fixtures");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const write = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/** One repository's runner: its own cache, the neighbour gate as asked (unset is the default, off). */
function runner(repo, { gate = null } = {}) {
  const base = { ...process.env, DRIFT_CACHE_DIR: join(work, `cache-${repo.split("/").pop()}`) };
  delete base.DRIFT_NEIGHBOUR_GATE;
  delete base.DRIFT_REVIEW_VIA;
  const go = (args, { allow = [], env = {} } = {}) => {
    const r = spawnSync(drift, ["--root", repo, ...args], { env: { ...base, ...(gate ? { DRIFT_NEIGHBOUR_GATE: gate } : {}), ...env }, encoding: "utf8", maxBuffer: 1 << 30 });
    if (r.status !== 0 && !allow.includes(r.status)) throw new Error(`drift ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
    return r;
  };
  return { go, out: (args, opts) => go(args, opts).stdout };
}

function git(repo, ...a) {
  const when = "2026-11-08T12:00:00Z";
  const r = spawnSync("git", ["-c", "user.name=beacon", "-c", "user.email=beacon@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...a], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** The files every repository fixture has, as make-fixtures.mjs writes acme's. */
function outputs(id, repo, run, { gate, extra = {}, security = true }) {
  const dir = join(out, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const root = `/work/${id}`;
  const json = (name, v) => writeFileSync(join(dir, name), JSON.stringify(v, null, 1) + "\n");
  const factsPath = join(work, `${id}-facts.json`);
  run.out(["scan", "--out", factsPath]);
  const facts = slimFacts(JSON.parse(readFileSync(factsPath, "utf8")));
  writeFileSync(join(dir, "facts.json.gz"), gzipSync(JSON.stringify(facts), { level: 9, mtime: 0 }));
  const census = JSON.parse(run.out(["census", "--json"]));
  census.root = root;
  census.commit = null;
  json("census.json", census);
  if (security) json("security.json", JSON.parse(run.out(["security", "--json"])));
  // `neighbourGate`: how DRIFT_NEIGHBOUR_GATE was set for this fixture's check (the fixture API reports it as the
  // desktop app does, from its environment).
  json("version.json", { version: run.out(["--version"]).trim(), neighbourGate: gate });
  json("history.json", { snapshots: [], audit: [] });
  for (const [name, v] of Object.entries(extra)) json(name, v);
  if (existsSync(join(repo, ".drift/conventions.yaml"))) writeFileSync(join(dir, "conventions.yaml"), readFileSync(join(repo, ".drift/conventions.yaml")));
  if (existsSync(join(repo, "drift.lock"))) writeFileSync(join(dir, "drift.lock"), readFileSync(join(repo, "drift.lock")));
  cpSync(repo, join(dir, "sources"), { recursive: true, filter: (p) => !p.includes(`${repo}/.drift`) && !p.includes(`${repo}/.git`) && !p.endsWith("drift.lock") });
  return { dir, json, census, facts, root };
}

const repos = [];

// ---------- beacon: every block candidate answered, the review log on, the neighbour gate on ----------
{
  const repo = join(work, "beacon");
  writeBeacon(repo);
  const run = runner(repo);
  run.out(["init"]);
  const census0 = JSON.parse(run.out(["census", "--json"]));
  const card = (re) => {
    const p = census0.proposals.find((x) => x.agents?.reason === "candidate" && re.test(x.summary));
    if (!p) throw new Error(`beacon: no block candidate matches ${re}`);
    return p.id;
  };
  const route = card(/wrapped in withSession\(\)/);
  const core = card(/packages\/core\/\*\* do not import from packages\/app/);
  const ui = card(/packages\/ui\/\*\* do not import from apps\/portal/);
  const jobs = card(/packages\/jobs\/\*\* do not import from packages\/app/);
  if (census0.python_proposals?.withheld !== 1) throw new Error(`beacon: census should withhold its one Python proposal: ${JSON.stringify(census0.python_proposals)}`);
  // The questions as a person first sees them, before any answer.
  const asked = JSON.parse(run.out(["review", "--json"]));
  if (asked.candidates.length !== 4) throw new Error(`beacon: ${asked.candidates.length} questions, expected 4`);
  run.out(["review", "--set-log", "on"]);
  // The health probe is set apart with its entry point confirmed; the status probe is picked but its entry point is
  // not ticked, so it stays flagged (kept_flagged_members) [STRICT].
  run.out(["review", `--answer=${route}=different`, `--set-apart=${BEACON.health},${BEACON.status}`, `--confirm-entry=${BEACON.health}#GET`]);
  // Test data and seeds are a different kind of file from core code; the legacy import stays flagged.
  run.out(["review", `--answer=${core}=different`, `--set-apart=${BEACON.fixtures},${BEACON.seed}`]);
  run.out(["review", `--answer=${ui}=same`]);
  run.out(["review", `--answer=${jobs}=not-a-convention`]);
  writeFileSync(join(repo, ".gitignore"), ".drift/cache/\n");
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "beacon with its answers");
  // After the answers: a file of the same kind as the set-apart fixtures (the gate holds it back), a core file like
  // the holders but for its import of the app (new), and an unwrapped route (new; an entry point is never held back).
  write(repo, BEACON.moreFixtures, FIXTURE("billingFixtures"));
  write(repo, BEACON.late, 'import { app } from "@beacon/app";\n\nexport const late = app.name;\n');
  write(repo, BEACON.route, UNGUARDED);
  const on = runner(repo, { gate: "on" });
  const check = JSON.parse(on.out(["check", "--format", "json"], { allow: [1] }));
  const diff = JSON.parse(on.out(["check", "--format", "json", "--diff-base", "main"], { allow: [1] }));
  const off = JSON.parse(run.out(["check", "--format", "json"], { allow: [1] }));
  const held = check.suppressed_neighbour ?? [];
  if (held.length !== 1 || held[0].path !== BEACON.moreFixtures) throw new Error(`beacon: the gate should hold back ${BEACON.moreFixtures} only: ${JSON.stringify(held)}`);
  if (off.suppressed_neighbour || off.violations.some((v) => v.suppressed_neighbour)) throw new Error("beacon: with the gate off nothing is held back");
  if (!check.exempt?.some((e) => e.code === "different_kind" && e.path === BEACON.health)) throw new Error("beacon: the confirmed health probe is set apart");
  if (!check.violations.some((v) => v.path === BEACON.status)) throw new Error("beacon: the unconfirmed status probe stays flagged");
  // The review log as a study file, ids and paths kept (no salt); each event's time replaced by its order.
  const logPath = join(work, "beacon-review-log.json");
  run.out(["review", "--export-log", logPath, "--include-paths"]);
  const log = JSON.parse(readFileSync(logPath, "utf8"));
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^(at|ts|time|exported_at)$/.test(k) && typeof x !== "object" ? "(time)" : k === "repo" && typeof x === "string" ? "(this repository's salted hash)" : stable(x)]));
    return v;
  };
  const f = outputs("beacon", repo, on, {
    gate: "on",
    extra: {
      "check.json": check,
      "check-diff.json": diff,
      "security-diff.json": JSON.parse(on.out(["security", "--json", "--diff-base", "main"])),
      "check-gate-off.json": off,
      "review-questions.json": JSON.parse(run.out(["review", "--json"])),
      "review-questions-before.json": asked,
      "review-log.json": stable(log),
    },
  });
  repos.push({ id: "beacon", path: f.root, name: "beacon" });
  console.log(`beacon: ${f.census.proposals.length} proposals, ${check.violations.length} violations, ${held.length} held back, ${check.exempt?.length ?? 0} exempt`);
}

// ---------- quiet: Python proposals on, nothing proposed ----------
{
  const repo = join(work, "quiet");
  write(repo, "pyproject.toml", '[project]\nname = "quiet"\nversion = "0.1.0"\n');
  write(repo, "quiet/__init__.py", "");
  write(repo, "quiet/cli.py", "import sys\n\n\ndef main(argv=None):\n    return len(argv or sys.argv)\n");
  write(repo, "quiet/text.py", "def shout(s):\n    return s.upper()\n\n\ndef whisper(s):\n    return s.lower()\n");
  write(repo, ".drift/config.yaml", "proposals:\n  python: on\n");
  const run = runner(repo);
  run.out(["init"]);
  const check = JSON.parse(run.out(["check", "--format", "json"], { allow: [1] }));
  const f = outputs("quiet", repo, run, { gate: "off", extra: { "check.json": check, "review-questions.json": JSON.parse(run.out(["review", "--json"])) } });
  if (f.census.proposals.length || f.census.python_proposals) throw new Error(`quiet: expected no proposal and Python proposals on: ${JSON.stringify(f.census.python_proposals)}`);
  repos.push({ id: "quiet", path: f.root, name: "quiet" });
  console.log(`quiet: ${f.census.units} units, nothing proposed`);
}

// ---------- broken: a policy a person broke by hand ----------
{
  const repo = join(work, "broken");
  write(repo, "package.json", JSON.stringify({ name: "broken", private: true }, null, 2) + "\n");
  write(repo, "src/index.ts", 'export { greet } from "./greet";\n');
  write(repo, "src/greet.ts", "export function greet(name: string) {\n  return `hello ${name}`;\n}\n");
  const run = runner(repo);
  run.out(["init"]);
  // A hand edit that left a bracket open: neither Drift nor the Studio can read the policy.
  const before = readFileSync(join(repo, ".drift/conventions.yaml"), "utf8");
  const yaml = before.replace(/^version: 1$/m, "version: [1");
  if (yaml === before) throw new Error("broken: the policy has no `version: 1` line to break");
  writeFileSync(join(repo, ".drift/conventions.yaml"), yaml);
  const err = (args) => {
    const r = run.go(args, { allow: [2] });
    if (r.status !== 2) throw new Error(`broken: drift ${args.join(" ")} should refuse the policy (exit ${r.status})`);
    // As the desktop app reports a failed run (electron/drift.ts, `driftErrorLine`).
    return { exit: r.status, message: driftErrorLine(r.stderr.split(repo).join("/work/broken")) };
  };
  const errors = { check: err(["check", "--format", "json"]), questions: err(["review", "--json"]), security: err(["security", "--json"]) };
  const f = outputs("broken", repo, run, { gate: "off", extra: { "errors.json": errors }, security: false });
  repos.push({ id: "broken", path: f.root, name: "broken", errors: true });
  console.log(`broken: drift check failed: ${errors.check.message}`);
}

// fixtures/index.json: acme first (make-fixtures.mjs), then these.
const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
index.repos = [...index.repos.filter((r) => !repos.some((x) => x.id === r.id)), ...repos];
writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 1) + "\n");
console.log(`fixtures written to ${out}: ${repos.map((r) => r.id).join(", ")}`);
