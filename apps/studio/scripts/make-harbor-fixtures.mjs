// Build fixtures/harbor/ by running the real `drift` on a synthetic repository we own (scripts/synth-harbor.mjs). Nothing
// here reads a dev, blind or held-out repository, and nothing is hand-written: every JSON file is what drift printed.
//
//   node scripts/make-harbor-fixtures.mjs --drift <drift> --work <scratch dir>
//
// The scenario: harbor's three mined proposals are accepted (two layering rules, a wrapper rule on route handlers) and
// committed on `main`; a branch then adds three routes and removes most jobs (synth-harbor.mjs `changeHarbor`). Outputs
// (committed; all ours, Apache-2.0), beside acme in fixtures/index.json:
//   check.json            drift check --format json on the branch: `standing[]` (holds, breaks, a member not checked
//                         with its reason, a stale rule) and `practices.departures[].promote`
//   check-diff.json       the same with --diff-base main: `security_advice[]` (no security baseline yet)
//   security.json         drift security --json: `unreached[]`
//   security-top.json     drift security --top 0 --json: the inventory with `top`, every ranked finding (fixture mode
//                         takes the first N, as `--top N` does)
//   security-diff.json    drift security --json --diff-base main: `added_without_guard[]` and `guard_unknown[]`
//   security-baseline.json  drift security --write-baseline, run on a copy: what it printed (`stdout`) and the
//                         .drift/security.lock it wrote (`lock`); fixture mode shows them when a person writes it
//   census.json, conventions.yaml, drift.lock, facts.json.gz, sources/, version.json, history.json as for the others.
//
// Every run writes the same bytes: fixed paths (/work/harbor), fixed commit dates and names, no timestamps.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { slimFacts } from "../src/shared/contract/slim.ts";
import { HARBOR, changeHarbor, writeHarbor } from "./synth-harbor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (!arg("--drift") || !arg("--work")) throw new Error("usage: make-harbor-fixtures.mjs --drift <drift> --work <scratch dir>");
const drift = resolve(arg("--drift"));
const work = resolve(arg("--work"));
const out = join(app, "fixtures");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const ROOT = "/work/harbor";

function runner(repo) {
  const env = { ...process.env, DRIFT_CACHE_DIR: join(work, `cache-${repo.split("/").pop()}`) };
  delete env.DRIFT_NEIGHBOUR_GATE;
  delete env.DRIFT_REVIEW_VIA;
  const go = (args, allow = []) => {
    const r = spawnSync(drift, ["--root", repo, ...args], { env, encoding: "utf8", maxBuffer: 1 << 30 });
    if (r.status !== 0 && !allow.includes(r.status)) throw new Error(`drift ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
    // What drift printed, with the scratch path of the repository written as the fixture's own.
    return r.stdout.split(repo).join(ROOT);
  };
  return { out: go, json: (args, allow) => JSON.parse(go(args, allow)) };
}

function git(repo, ...a) {
  const when = "2026-11-12T12:00:00Z";
  const r = spawnSync("git", ["-c", "user.name=harbor", "-c", "user.email=harbor@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...a], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const must = (cond, what) => {
  if (!cond) throw new Error(`harbor: ${what}`);
};

const repo = join(work, "harbor");
writeHarbor(repo);
const run = runner(repo);
run.out(["init"]);
const census0 = run.json(["census", "--json"]);
const mined = (re) => {
  const p = census0.proposals.find((x) => !x.from_map && re.test(x.summary));
  must(p, `no mined proposal matches ${re}`);
  return p.id;
};
const accepted = [mined(/^files in packages\/core\/\*\* do not import from packages\/app/), mined(/^files in packages\/jobs\/\*\* do not import from packages\/app/), mined(/wrapped in withSession\(\)/)];
run.out(["review", "--accept", accepted.join(",")]);
writeFileSync(join(repo, ".gitignore"), ".drift/cache/\n");
git(repo, "init", "-q");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "harbor with its accepted conventions");
git(repo, "checkout", "-qb", "change");
changeHarbor(repo);
git(repo, "add", "-A");
git(repo, "commit", "-qm", "refunds, payouts and ledger routes; fewer jobs");

const check = run.json(["check", "--format", "json"], [1]);
const checkDiff = run.json(["check", "--format", "json", "--diff-base", "main"], [1]);
const security = run.json(["security", "--json"]);
const securityTop = run.json(["security", "--top", "0", "--json"]);
const securityDiff = run.json(["security", "--json", "--diff-base", "main"]);

// What the scenario is for: each surface has something to show.
const standing = check.standing ?? [];
must(standing.length === 3, `three standings: ${JSON.stringify(standing)}`);
must(standing.some((s) => s.stale), "a stale rule");
must(standing.some((s) => s.not_checked > 0 && s.not_checked_why), "a member not checked, with its reason");
must(standing.some((s) => s.holders < s.members - s.not_checked), "a rule some member breaks");
must((check.practices?.departures ?? []).some((d) => d.promote), "a departure with its promote hint");
must((checkDiff.security_advice ?? []).some((a) => a.at.startsWith(HARBOR.refunds)), "security advice for the unguarded route");
must((security.unreached ?? []).some((u) => u.path === "tools/sweep/sweep.ts"), "a file nothing reaches");
must((securityTop.top?.shown ?? []).length > 0 && securityTop.top.not_ranked.guard_unknown > 0, "ranked findings, and one not ranked for its unread guard");
must((securityDiff.guard_unknown ?? []).some((e) => e.path === HARBOR.payouts), "a new route whose guard is unknown");

// The baseline, written on a copy so the fixture itself has none (the Check view's advice is for a repository without one).
const copy = join(work, "harbor-baseline");
cpSync(repo, copy, { recursive: true });
const baseline = { stdout: runner(copy).out(["security", "--write-baseline"]), lock: readFileSync(join(copy, ".drift/security.lock"), "utf8") };
must(baseline.stdout.startsWith("Wrote .drift/security.lock"), `write-baseline printed: ${baseline.stdout}`);

const dir = join(out, "harbor");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const json = (name, v) => writeFileSync(join(dir, name), JSON.stringify(v, null, 1) + "\n");
const factsPath = join(work, "harbor-facts.json");
run.out(["scan", "--out", factsPath]);
writeFileSync(join(dir, "facts.json.gz"), gzipSync(JSON.stringify(slimFacts(JSON.parse(readFileSync(factsPath, "utf8")))), { level: 9, mtime: 0 }));
const census = run.json(["census", "--json"]);
census.root = ROOT;
census.commit = null;
json("census.json", census);
json("check.json", check);
json("check-diff.json", checkDiff);
json("security.json", security);
json("security-top.json", securityTop);
json("security-diff.json", securityDiff);
json("security-baseline.json", baseline);
json("version.json", { version: run.out(["--version"]).trim(), neighbourGate: "off" });
json("history.json", { snapshots: [], audit: [] });
writeFileSync(join(dir, "conventions.yaml"), readFileSync(join(repo, ".drift/conventions.yaml")));
if (existsSync(join(repo, "drift.lock"))) writeFileSync(join(dir, "drift.lock"), readFileSync(join(repo, "drift.lock")));
cpSync(repo, join(dir, "sources"), { recursive: true, filter: (p) => !p.includes(`${repo}/.drift`) && !p.includes(`${repo}/.git`) && !p.endsWith("drift.lock") });
for (const f of ["check.json", "check-diff.json", "security.json", "security-top.json", "security-diff.json", "security-baseline.json", "census.json"]) must(!readFileSync(join(dir, f), "utf8").includes(work), `${f} names the scratch directory`);

// fixtures/index.json: harbor after the others. `securityTop` and `baseline`: it has security-top.json and security-baseline.json.
const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
index.repos = [...index.repos.filter((r) => r.id !== "harbor"), { id: "harbor", path: ROOT, name: "harbor", securityTop: true, baseline: true }];
writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 1) + "\n");
console.log(`harbor: ${standing.length} standings, ${check.violations.length} violations, ${checkDiff.security_advice.length} security advice, ${security.unreached.length} unreached, ${securityTop.top.shown.length} ranked, ${securityDiff.guard_unknown.length} guard unknown`);
