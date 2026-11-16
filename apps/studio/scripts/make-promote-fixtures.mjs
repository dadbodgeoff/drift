// The funnel and promotion fixtures, written by the real `drift` binary on the repositories the other fixtures were
// generated from: each fixture's `sources/` (the synthetic repository as make-fixtures.mjs and make-round11-fixtures.mjs
// left it, ours, Apache-2.0) with its committed policy, lock and `.drift/config.yaml`, committed to git once with a
// fixed date and identity so a block replay reads a history. Nothing here is written by hand.
//
//   node scripts/make-promote-fixtures.mjs --drift <drift> --work <scratch dir>
//
// Outputs (committed):
//   fixtures/acme/funnel.json         drift census --why --json
//   fixtures/acme/promote-list.json   drift practices promote --list --json
//   fixtures/acme/promote-runs.json   drift practices promote ... --json, run after run: every list candidate's command
//                                     (and with --block), each known way, mechanism and any enforcing way of every
//                                     concern in every package and in each listed place (and --force where Drift
//                                     answered below_share), a file and a route place, the command line's own
//                                     refusals, and, after one promotion is written, what Drift answers then (the
//                                     list, the same practice again, another form there, which replaces it, and an
//                                     overlapping place, which is refused). Fixture mode serves these as recorded:
//                                     `after` is the writes made before the run, `args` the argv after `promote`,
//                                     exactly as the Studio builds it (src/shared/lib/promote-args.ts).
//   fixtures/quiet/funnel.json        drift census --why --json
//   fixtures/index.json               acme gains `promoteRuns: true`; every other entry is kept as it is
//
// `census --why` prints what a normal run counts (crates/drift-mine/src/funnel.rs `why_json`); the study's extra
// counts (DRIFT_FUNNEL) are never asked for. Every run writes the same bytes: fixed paths, no timestamps.

import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promoteFlags } from "../src/shared/lib/promote-args.ts";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (!arg("--drift") || !arg("--work")) throw new Error("usage: make-promote-fixtures.mjs --drift <drift> --work <scratch dir>");
const drift = resolve(arg("--drift"));
const work = resolve(arg("--work"));
const fixtures = join(app, "fixtures");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

/**
 * Each repository's `.drift/config.yaml`, which `sources/` leaves out with the rest of `.drift`: acme's as
 * scripts/synth-repo.mjs writes it (the experimental wiring rules), quiet's as make-round11-fixtures.mjs does.
 */
const CONFIG = { acme: "experimental: [wiring]\n", quiet: "proposals:\n  python: on\n" };

function git(repo, ...a) {
  const when = "2026-11-03T17:40:00Z";
  const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...a], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
}

/** The fixture's repository in `dir`: its sources, policy, lock and config, committed once. */
function repoOf(id, dir) {
  const src = join(fixtures, id);
  cpSync(join(src, "sources"), dir, { recursive: true });
  mkdirSync(join(dir, ".drift"), { recursive: true });
  writeFileSync(join(dir, ".drift/config.yaml"), CONFIG[id]);
  copyFileSync(join(src, "conventions.yaml"), join(dir, ".drift/conventions.yaml"));
  copyFileSync(join(src, "drift.lock"), join(dir, "drift.lock"));
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", `${id} as the fixtures were made`);
  return dir;
}

/** A runner for one repository, with its own cache. `allow`: exit codes that are an answer (promote refuses with 2). */
function runner(repo) {
  const env = { ...process.env, DRIFT_CACHE_DIR: join(work, `cache-${repo.split("/").pop()}`) };
  delete env.DRIFT_FUNNEL;
  return (args, allow = []) => {
    const r = spawnSync(drift, ["--root", repo, ...args], { env, encoding: "utf8", maxBuffer: 1 << 30 });
    if (r.status !== 0 && !allow.includes(r.status)) throw new Error(`drift ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
    return { status: r.status, out: r.stdout };
  };
}

const write = (id, name, v) => writeFileSync(join(fixtures, id, name), JSON.stringify(v, null, 1) + "\n");

// ---------- quiet: what mining dropped ----------
{
  const run = runner(repoOf("quiet", join(work, "quiet")));
  write("quiet", "funnel.json", JSON.parse(run(["census", "--why", "--json"]).out));
}

// ---------- acme: what mining dropped, what may be promoted, and promotion runs ----------
const base = repoOf("acme", join(work, "acme"));
const run = runner(base);
write("acme", "funnel.json", JSON.parse(run(["census", "--why", "--json"]).out));
const list = JSON.parse(run(["practices", "promote", "--list", "--json"]).out);
write("acme", "promote-list.json", list);
const map = JSON.parse(run(["practices", "--json"]).out);

/** A promotion request (src/shared/ipc/contract.ts `PromoteRequest`) from what Drift printed of a candidate. */
function requestOf(item) {
  const c = item.candidate;
  const [first, ...rest] = c.ways.map((w) => w.id);
  return { ...(first ? { id: first } : { concern: c.concern }), place: item.place, with: rest, mechanisms: c.mechanisms ?? [], any_enforcing: !!c.any_enforcing, block: false };
}

/** Every run recorded: what Drift answered for `args` after the writes `after`, and its exit code. */
const runs = [];
const seen = new Set();
function record(go, after, req, dryRun = true) {
  const args = promoteFlags(req, dryRun);
  const key = JSON.stringify([after, args]);
  if (seen.has(key)) return null;
  seen.add(key);
  const r = go(["practices", "promote", ...args], [2]);
  const out = r.out.trim() ? JSON.parse(r.out) : null;
  if (!out) throw new Error(`drift practices promote ${args.join(" ")} printed no JSON`);
  runs.push({ after, args, exit: r.status, out });
  return out;
}
const refusedAs = (out, code) => !!out && "refused" in out && out.refused.code === code;

const items = [...list.candidates, ...(list.passive ?? [])];
const places = [...new Set([...map.concerns.flatMap((c) => c.by_package.map((p) => p.package || ".")), ...items.map((x) => x.place)])].sort();

// Before anything is written.
for (const item of items) {
  const req = requestOf(item);
  record(run, [], req);
  record(run, [], { ...req, block: true });
}
for (const c of map.concerns) {
  const known = c.variants.filter((v) => v.kind === "known");
  const mechanisms = [...new Set(known.flatMap((v) => v.mechanisms ?? []))].sort();
  // The packages the concern has units in, and the places Drift listed for it.
  const where = [...new Set([...c.by_package.filter((p) => p.total > 0).map((p) => p.package || "."), ...items.filter((x) => x.candidate.concern === c.id).map((x) => x.place)])].sort();
  for (const place of where) {
    for (const v of known) {
      const req = { id: v.id, place, with: [], block: false };
      const out = record(run, [], req);
      if (refusedAs(out, "below_share")) record(run, [], { ...req, force: true });
      else if (out && !("refused" in out)) record(run, [], { ...req, block: true });
    }
    for (const m of mechanisms) record(run, [], { concern: c.id, place, with: [], mechanisms: [m], any_enforcing: false, block: false });
    record(run, [], { concern: c.id, place, with: [], mechanisms: [], any_enforcing: true, block: false });
  }
}
// A file and a route place, from the first candidate that names a way: its example's file, and the routes of its package.
const named = items.find((x) => x.candidate.ways.length && x.candidate.example);
if (named) {
  const req = requestOf(named);
  record(run, [], { ...req, place: named.candidate.example.path });
  const pkg = named.candidate.place.package || ".";
  for (const prefix of ["/api", "/api/workspaces", "/api/admin"]) {
    const route = { ...req, place: `${pkg}:${prefix}` };
    const out = record(run, [], route);
    // Block on a route place: the replay of its own most recent units, which may refuse.
    if (out && !("refused" in out)) record(run, [], { ...route, block: true });
  }
  // The command line's own refusals: --block with --force, and a way of another concern.
  record(run, [], { ...req, block: true, force: true });
  const other = map.concerns.filter((c) => c.id !== named.candidate.concern).flatMap((c) => c.variants).find((v) => v.kind === "known");
  if (other) record(run, [], { ...req, with: [other.id] });
}

// After one promotion is written: the first candidate of named ways whose place has another form that qualifies.
for (const item of list.candidates.filter((x) => x.candidate.ways.length)) {
  const req = requestOf(item);
  const dir = join(work, `acme-after-${item.candidate.ways[0].id}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(base, dir, { recursive: true });
  const go = runner(dir);
  const c = map.concerns.find((x) => x.id === item.candidate.concern);
  const mechanisms = [...new Set((c?.variants ?? []).filter((v) => v.kind === "known").flatMap((v) => v.mechanisms ?? []))].sort();
  const forms = [...mechanisms.map((m) => ({ concern: item.candidate.concern, place: item.place, with: [], mechanisms: [m], any_enforcing: false, block: false })), { concern: item.candidate.concern, place: item.place, with: [], mechanisms: [], any_enforcing: true, block: false }];
  // A form that would replace it must qualify before the write too.
  if (!forms.some((f) => runs.some((r) => r.after.length === 0 && JSON.stringify(r.args) === JSON.stringify(promoteFlags(f, true)) && !("refused" in r.out)))) continue;
  const written = go(["practices", "promote", ...promoteFlags(req, false)]);
  const after = [promoteFlags(req, false)];
  runs.push({ after: [], args: promoteFlags(req, false), exit: written.status, out: JSON.parse(written.out) });
  runs.push({ after, args: ["--list", "--json"], exit: 0, out: JSON.parse(go(["practices", "promote", "--list", "--json"]).out) });
  record(go, after, req);
  for (const f of forms) record(go, after, f);
  // The same way under a route prefix of its package, which overlaps every directory of it: refused as covered.
  if (named) for (const r of runs.filter((x) => x.after.length === 0 && x.args[0] === req.id && x.args[2]?.includes(":/") && !("refused" in x.out))) record(go, after, { ...req, place: r.args[2] });
  // An overlapping place of the same concern (each other listed place of its package, and the package itself).
  for (const place of places.filter((p) => p !== item.place && (p === (item.candidate.place.package || ".") || p.startsWith(`${item.place}/`) || item.place.startsWith(`${p}/`))))
    for (const v of (c?.variants ?? []).filter((x) => x.kind === "known" && x.id !== req.id).slice(0, 1)) record(go, after, { id: v.id, place, with: [], block: false });
  break;
}

write("acme", "promote-runs.json", {
  "//": "drift practices promote ... --json as the real binary answered it on fixtures/acme/sources (scripts/make-promote-fixtures.mjs). `after`: the writes made before the run; `args`: the argv after `promote`, as the Studio builds it.",
  runs,
});

const index = JSON.parse(readFileSync(join(fixtures, "index.json"), "utf8"));
index.repos = index.repos.map((r) => (r.id === "acme" ? { ...r, promoteRuns: true } : r));
writeFileSync(join(fixtures, "index.json"), JSON.stringify(index, null, 1) + "\n");
console.log(`acme: ${items.length} candidates, ${runs.length} promotion runs recorded; quiet: funnel`);
