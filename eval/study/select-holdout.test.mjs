// select-holdout.mjs verify: passes on the frozen primary sets, and catches tampering and dev overlap.
// Offline: reads only this repository, the selection record and the manifests (never a held-out repo).
//
//   node --test eval/study/select-holdout.test.mjs
import assert from "node:assert/strict";
import { spawnSync as rawSpawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "select-holdout.mjs");
const tmp = mkdtempSync(join(tmpdir(), "select-holdout-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// Every child process of this file runs offline and bounded:
// - no proxy, in either case (git reads the lowercase https_proxy first), a dead port instead;
// - git refuses every protocol but file (GIT_ALLOW_PROTOCOL), reads no system config and never prompts;
// - no GitHub token;
// - a timeout, so a child that would hang fails its test instead of stalling the file.
// SELECT_HOLDOUT_EXCLUSION_CACHE shares the exclusion replay across this file's many `verify` runs (select-holdout.mjs
// offlineExclusions: keyed by commits, so a replay of the same commits is the same).
const DEAD = "http://127.0.0.1:9";
const OFFLINE_ENV = {
  HTTPS_PROXY: DEAD,
  https_proxy: DEAD,
  HTTP_PROXY: DEAD,
  http_proxy: DEAD,
  ALL_PROXY: DEAD,
  all_proxy: DEAD,
  NO_PROXY: "",
  no_proxy: "",
  GH_TOKEN: "",
  GITHUB_TOKEN: "",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_ALLOW_PROTOCOL: "file",
  SELECT_HOLDOUT_EXCLUSION_CACHE: join(tmp, "exclusion-cache"),
};
const CHILD_TIMEOUT_MS = 240000;
const spawnSync = (cmd, args, opts = {}) => rawSpawnSync(cmd, args, { timeout: CHILD_TIMEOUT_MS, ...opts, env: { ...(opts.env ?? process.env), ...OFFLINE_ENV } });
const recordPath = join(here, "selection", "primary-2026-11-05.json");
const record = JSON.parse(readFileSync(recordPath, "utf8"));

// Held-out names must never reach a log, this test's included: every token that identifies a held-out repo (name,
// owner/repo, URL, sha, list names), from every registered manifest. `safe` blanks them in assertion messages;
// `leaks` counts them in an output (never printing which).
const registry = JSON.parse(readFileSync(join(here, "holdout-manifests.json"), "utf8")).manifests;
const manifests = Object.fromEntries(Object.keys(registry).map((p) => [p, JSON.parse(readFileSync(join(here, "..", "..", p), "utf8"))]));
// Every selection of the script, and its specification (offline). A blind dev pool (role "dev", PLAN-R10 section 3.1)
// is not in the held-out registry: its manifests and registry are read from its spec, when written.
const SELECTION_IDS = ["primary", "heldout2", "dev3", "dev4"];
const specs = Object.fromEntries(SELECTION_IDS.map((id) => [id, JSON.parse(spawnSync(process.execPath, [script, "spec", "--selection", id], { encoding: "utf8" }).stdout)]));
const poolFiles = Object.values(specs).filter((x) => x.role === "dev").flatMap((x) => [x.spec.sets.ts.path, x.spec.sets.py.path, x.registry]).filter((p) => existsSync(join(here, "..", "..", p)));
const poolManifests = Object.fromEntries(poolFiles.filter((p) => !/registry/.test(p)).map((p) => [p, JSON.parse(readFileSync(join(here, "..", "..", p), "utf8"))]));
// A fixture root for --manifest-root: every registered manifest and every pool file, as committed.
const fixtureRoot = (name) => {
  const fx = join(tmp, name);
  mkdirSync(join(fx, "eval"), { recursive: true });
  for (const p of [...Object.keys(registry), ...poolFiles]) cpSync(join(here, "..", "..", p), join(fx, p));
  return fx;
};
const heldTokens = [...new Set([...Object.values(manifests), ...Object.values(poolManifests)].flatMap((m) => [
  ...[...m.repos, ...(m.reserves?.repos ?? [])].flatMap((r) => [r.name, r.url, r.sha, r.url.replace(/^https:\/\/github\.com\//, ""), r.url.split("/").pop()]),
  ...[...(m.replaced ?? []), ...(m.burned ?? []), ...(m.exposed ?? [])].flatMap((e) => [e.repo, e.reserve, e.name]),
]).filter((t) => t && t.length >= 3).map((t) => t.toLowerCase()))].sort((a, b) => b.length - a.length);
const tokenRe = new RegExp(`(?<![A-Za-z0-9_.-])(${heldTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})(?![A-Za-z0-9_-])`, "gi");
const heldShas = [...Object.values(manifests), ...Object.values(poolManifests)].flatMap((m) => [...m.repos, ...(m.reserves?.repos ?? [])].map((r) => r.sha.toLowerCase()));
const hexRe = /(?<![0-9A-Za-z])[0-9a-fA-F]{7,40}(?![0-9A-Za-z])/g;
const isPrefix = (h) => heldShas.some((x) => x.startsWith(h.toLowerCase()));
const safe = (text) => String(text).replace(hexRe, (h) => (isPrefix(h) ? "<held-out-sha>" : h)).replace(tokenRe, "<held-out>");
// held-out tokens, and 7+ hex prefixes of held-out pins
const leaks = (text) => (String(text).match(tokenRe) ?? []).length + (String(text).match(hexRe) ?? []).filter(isPrefix).length;
const ok = (cond, out) => assert.ok(cond, safe(out));
// verify's output goes through the script's redactor, which replaces ANY word that is a held-out or pool repo's name
// with its slot, message words included. So an expectation also matches when, with every slot in the output and every
// such token in the expectation normalised to one placeholder, the two agree.
const slotRe = /[A-Za-z0-9_.-]+:(?:record\.)?(?:repos|reserves|primaries)\[\d+\]|[A-Za-z0-9_.-]+:name#[0-9a-f]{8}/g;
const redactionTolerant = (out, re) => re.test(out) || new RegExp(re.source.replace(tokenRe, "<held-out>"), re.flags).test(String(out).replace(slotRe, "<held-out>"));
const like = (out, re) => assert.ok(redactionTolerant(out, re), `expected ${re} in:\n${safe(out)}`);
const ref = (path, name) => {
  const m = manifests[path];
  const i = m.repos.findIndex((r) => r.name === name);
  return i >= 0 ? `${m.set_id}:repos[${i}]` : `${m.set_id}:reserves[${m.reserves.repos.findIndex((r) => r.name === name)}]`;
};
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const verify = (...extra) => {
  const r = spawnSync(process.execPath, [script, "verify", ...extra], { encoding: "utf8", env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", HTTPS_PROXY: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", all_proxy: "http://127.0.0.1:9" } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const withRecord = (edit) => {
  const rec = structuredClone(record);
  edit(rec);
  const p = join(tmp, `record-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(rec, null, 2) + "\n");
  return p;
};
// The second held-out draw (decision D11): `select-holdout.mjs --selection heldout2`.
const record2Path = join(here, "selection", "heldout2-2026-11-07.json");
const record2 = existsSync(record2Path) ? JSON.parse(readFileSync(record2Path, "utf8")) : null;
// The recorded refs are needed to replay the exclusions; a shallow CI checkout may not have them. A plain `verify`
// replays every committed selection, so it needs the refs of both records.
const refsOf = (rec) => [...new Set(Object.values(rec?.exclusions?.refs ?? {}))].every((c) => spawnSync("git", ["-C", here, "cat-file", "-e", `${c}^{commit}`]).status === 0);
const record3Path = join(here, "..", "..", specs.dev3.record);
const record3 = existsSync(record3Path) ? JSON.parse(readFileSync(record3Path, "utf8")) : null;
// Every blind dev pool's committed record (null until its draw).
const POOLS = SELECTION_IDS.filter((id) => specs[id].role === "dev");
const poolRecord = Object.fromEntries(POOLS.map((id) => [id, existsSync(join(here, "..", "..", specs[id].record)) ? JSON.parse(readFileSync(join(here, "..", "..", specs[id].record), "utf8")) : null]));
const refsPresent = refsOf(record) && refsOf(record2) && POOLS.every((id) => refsOf(poolRecord[id]));

test("verify passes on the committed record, manifests and registry (offline)", { skip: !refsPresent && "recorded refs not in this clone" }, () => {
  const r = verify();
  assert.equal(r.status, 0, safe(r.out));
  like(r.out, /no held-out repo overlaps a dev manifest/);
  if (record2) like(r.out, /verify: selection heldout2\n/);
  for (const id of POOLS) if (poolRecord[id]) like(r.out, new RegExp(`verify: selection ${id}\n`));
  assert.equal(leaks(r.out), 0, "verify names no held-out repo");
});

test("a dev manifest listing a held-out repo is an overlap, by owner/repo, sha or name", () => {
  const ts = JSON.parse(readFileSync(join(here, "..", "holdout-primary.json"), "utf8"));
  const py = JSON.parse(readFileSync(join(here, "..", "holdout-primary-py.json"), "utf8"));
  // a reserve that is still held out (a reserve that was swapped in and then replaced itself is not, rule 1)
  const released = new Set((py.replaced ?? []).map((e) => e.repo));
  const heldReserve = py.reserves.repos.findIndex((r) => !released.has(r.name));
  const dev = {
    repos: [
      { name: "renamed-mirror", url: ts.repos[0].url.replace("https://github.com/", "git@github.com:") + ".git", sha: "0".repeat(40) },
      { name: "by-sha-only", url: "https://github.com/example/unrelated", sha: py.reserves.repos[heldReserve].sha },
      { name: py.repos[1].name, url: "https://github.com/example/same-name", sha: "1".repeat(40) },
    ],
  };
  const p = join(tmp, "dev.json");
  writeFileSync(p, JSON.stringify(dev));
  const r = verify("--dev", p);
  assert.equal(r.status, 1, safe(r.out));
  // held-out repos appear only as <set_id>:repos[i] / reserves[i]
  like(r.out, new RegExp(`held-out ${esc(`${ts.set_id}:repos[0]`)} overlaps .*dev\\.json \\(--dev\\) by slug`));
  like(r.out, new RegExp(`held-out ${esc(`${py.set_id}:reserves[${heldReserve}]`)} overlaps .*by sha`));
  like(r.out, new RegExp(`held-out ${esc(`${py.set_id}:repos[1]`)} overlaps .*by name`));
  assert.equal(leaks(r.out), 0, "no held-out name in the overlap messages");
});

test("a record with another seed is refused", () => {
  const r = verify("--record", withRecord((rec) => (rec.seed = `${rec.seed}x`)));
  assert.equal(r.status, 1, safe(r.out));
  like(r.out, /record seed .* is not the pre-registered seed/);
  like(r.out, /selection\.record_sha256 does not match/);
});

test("a pool that contains an excluded repo is refused", () => {
  const r = verify(
    "--record",
    withRecord((rec) => {
      const slug = Object.keys(rec.exclusions.slugs).find((k) => rec.exclusions.slugs[k].some((s) => s.startsWith("manifest eval/repos")));
      rec.sets.ts.pool = [...rec.sets.ts.pool, slug].sort();
      rec.sets.ts.counts.eligible++;
      rec.sets.ts.counts.results++;
    }),
  );
  assert.equal(r.status, 1, safe(r.out));
  like(r.out, /ts: pool repo .* is excluded \(manifest eval\/repos/);
});

test("a re-pinned or re-bucketed walk is refused", () => {
  const r = verify(
    "--record",
    withRecord((rec) => {
      rec.sets.py.walked.find((w) => w.repo === rec.sets.py.primaries[0].repo).sha = "f".repeat(40);
      const w = rec.sets.ts.walked.find((x) => x.bucket === "other_node");
      w.bucket = "nestjs";
    }),
  );
  assert.equal(r.status, 1, safe(r.out));
  like(r.out, /py: \S+ is pinned to \S+, the walk recorded f{40}/);
  like(r.out, /ts: (primaries|reserves|walk order) differ/);
});

test("a changed exclusion list is refused when the recorded refs are present", { skip: !refsPresent && "recorded refs not in this clone" }, () => {
  const r = verify(
    "--record",
    withRecord((rec) => {
      const k = Object.keys(rec.exclusions.slugs).find((x) => rec.exclusions.slugs[x].includes("tracked files"));
      delete rec.exclusions.slugs[k];
    }),
  );
  assert.equal(r.status, 1, safe(r.out));
  like(r.out, /exclusion slug .*: the record has sources \[\], replaying the recorded refs gives/);
});

test("a dev manifest listing a SECONDARY held-out repo is an overlap, by owner/repo, sha or name", async () => {
  const { heldOutRepos } = await import("./lib.mjs");
  const reg = JSON.parse(readFileSync(join(here, "holdout-manifests.json"), "utf8")).manifests;
  const secondary = Object.keys(reg).map((p) => ({ p, m: JSON.parse(readFileSync(join(here, "..", "..", p), "utf8")) })).filter(({ m }) => m.role === "secondary");
  assert.ok(secondary.length >= 2, "both secondary sets are registered");
  for (const { p, m } of secondary) {
    const [a, b, c] = heldOutRepos(m);
    const cases = [
      ["slug", { name: "renamed-mirror", url: a.url.replace("https://github.com/", "https://www.github.com/") + ".git", sha: "0".repeat(40) }, a.name, /by slug/],
      ["sha", { name: "by-sha-only", url: "https://github.com/example/unrelated-sha", sha: b.sha }, b.name, /by sha/],
      ["name", { name: c.name, url: "https://github.com/example/same-name-elsewhere", sha: "1".repeat(40) }, c.name, /by name/],
    ];
    for (const [kind, repo, heldName, by] of cases) {
      const f = join(tmp, `dev-secondary-${kind}.json`);
      writeFileSync(f, JSON.stringify({ repos: [repo] }));
      const r = verify("--dev", f);
      assert.equal(r.status, 1, `${p} by ${kind}: ${safe(r.out)}`);
      const lines = r.out.split("\n").filter((l) => l.startsWith(`${p}: secondary held-out ${ref(p, heldName)} overlaps ${f} (--dev)`));
      ok(lines.some((l) => by.test(l)), `${p} by ${kind}: no overlap line ${by} in\n${r.out}`);
      assert.equal(leaks(r.out), 0, `${p} by ${kind}: no held-out name in the messages`);
    }
  }
  // a repo a secondary set replaced is released (rule 1): listing it in a dev manifest is not an overlap
  const py = secondary.find((x) => x.p === "eval/holdout-py.json").m;
  const out = (py.replaced ?? [])[0];
  if (out) {
    const f = join(tmp, "dev-released.json");
    writeFileSync(f, JSON.stringify({ repos: [{ name: out.repo, url: "https://github.com/example/released", sha: "2".repeat(40) }] }));
    ok(!new RegExp(`secondary held-out .* overlaps ${esc(f)}`).test(verify("--dev", f).out), "a released repo is no overlap");
  }
});

test("on tampered fixtures, no message names a held-out repo, and a misspelt exposed name fails", () => {
  // fixture manifests: copies of the registered ones, read through --manifest-root
  const fx = fixtureRoot("fixture");
  const write = (p, edit) => {
    const m = structuredClone(manifests[p]);
    edit(m);
    writeFileSync(join(fx, p), JSON.stringify(m, null, 2) + "\n");
  };
  const sec = Object.keys(registry).find((p) => (manifests[p].exposed ?? []).length);
  const prim = Object.keys(registry).find((p) => /holdout-primary-py/.test(p));
  write(sec, (m) => (m.exposed[0].name = `${m.exposed[0].name}-misspelt`));
  write(prim, (m) => {
    m.repos[0].sha = "e".repeat(40); // a re-pin: the walk check names the repo
    m.burned = [{ date: "2026-11-06", name: `${m.repos[1].name}x`, reason: "fixture" }];
  });
  const runs = [
    verify("--manifest-root", fx),
    verify("--manifest-root", fx, "--record", withRecord((rec) => {
      rec.sets.py.walked.find((w) => w.repo === rec.sets.py.primaries[0].repo).sha = "f".repeat(40);
      rec.sets.ts.pool = [...rec.sets.ts.pool, rec.sets.ts.primaries[0].repo].sort(); // duplicate pool entry
    })),
  ];
  const devHit = join(tmp, "dev-many.json");
  const py = manifests["eval/holdout-primary-py.json"];
  const s2 = manifests[sec];
  writeFileSync(devHit, JSON.stringify({ repos: [py.repos[2], s2.repos[0], { ...s2.reserves.repos[0], name: "renamed" }] }));
  runs.push(verify("--dev", devHit));
  for (const r of runs) {
    assert.equal(r.status, 1, safe(r.out));
    assert.equal(leaks(r.out), 0, `run ${runs.indexOf(r)}: ${leaks(r.out)} held-out tokens leaked; redacted lines:\n${r.out.split("\n").filter((l) => leaks(l)).map(safe).join("\n")}`);
  }
  like(runs[0].out, new RegExp(`${esc(sec)}: exposed\\[0\\]: names no occupant, reserve or replaced repo of this manifest`));
  like(runs[0].out, /burned\[0\]: names no repo or reserve of this manifest/);
  like(runs[0].out, /FIXTURE run/);
  like(runs[1].out, /is pinned to \S+, the walk recorded/);
  like(runs[2].out, /secondary held-out .* overlaps .*dev-many\.json/);
});

test("probe refuses every repo of a held-out manifest, offline and without naming it", () => {
  const py = manifests["eval/holdout-primary-py.json"];
  const sec = Object.keys(registry).find((p) => (manifests[p].replaced ?? []).length && (manifests[p].exposed ?? []).length);
  const slugOf = (r) => r.url.replace(/^https:\/\/github\.com\//, "");
  const cases = [slugOf(py.repos[0]), slugOf(py.reserves.repos[0]), `someone/${manifests[sec].exposed[0].name}`, `someone/${manifests[sec].replaced[0].repo}`];
  for (const slug of cases) {
    const r = spawnSync(process.execPath, [script, "probe", "py", slug], { encoding: "utf8", env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", HTTPS_PROXY: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", all_proxy: "http://127.0.0.1:9" } });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 2, safe(out));
    like(out, /is in a held-out manifest: probe refuses held-out repos/);
    assert.equal(leaks(out), 0, `held-out tokens in:\n${safe(out)}`);
  }
});

test("the redactor replaces 7-40 character prefixes of held-out pins, and gh-style messages", () => {
  const py = manifests["eval/holdout-primary-py.json"];
  const pin = py.repos[0].sha;
  const slug = py.repos[0].url.replace(/^https:\/\/github\.com\//, "");
  const text = [`HEAD ${pin.slice(0, 7)}`, `@ ${pin.slice(0, 12)}: x`, `full ${pin}`, `gh search/code?q=repo:${slug} failed: HTTP 502`, "unrelated deadbeefcafe"].join("\n");
  const r = spawnSync(process.execPath, [script, "redact"], { input: text, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(leaks(r.stdout), 0, safe(r.stdout));
  assert.equal(r.stdout.split("\n").length, 5);
  like(r.stdout, /unrelated deadbeefcafe/);
  like(r.stdout, new RegExp(esc(`${py.set_id}:repos[0]`)));
});

test("a malformed held-out manifest (fixture) is reported by file only: no fragment of it in any message", () => {
  const fx = fixtureRoot("fixture-bad-json");
  const sec = Object.keys(registry).find((p) => (manifests[p].exposed ?? []).length);
  const prim = "eval/holdout-primary.json";
  // a single-quoted name in a secondary set, and an unquoted pin in a primary set
  const bad = (p, edit) => writeFileSync(join(fx, p), edit(readFileSync(join(here, "..", "..", p), "utf8")));
  bad(sec, (t) => t.replace(`"name": "${manifests[sec].exposed[0].name}"`, `"name": '${manifests[sec].exposed[0].name}'`));
  const r1 = verify("--manifest-root", fx);
  bad(sec, () => readFileSync(join(here, "..", "..", sec), "utf8"));
  bad(prim, (t) => t.replace(`"sha": "${manifests[prim].repos[0].sha}"`, `"sha": ${manifests[prim].repos[0].sha}`));
  const r2 = verify("--manifest-root", fx);
  for (const [r, p] of [[r1, sec], [r2, prim]]) {
    assert.equal(r.status, 2, safe(r.out));
    like(r.out, new RegExp(`${esc(p)}: invalid JSON`));
    assert.equal(leaks(r.out), 0, `held-out tokens in:\n${safe(r.out)}`);
  }
});

test("a clean fixture run never exits 0: it is not a verification", () => {
  const fx = fixtureRoot("fixture-clean");
  const r = verify("--manifest-root", fx);
  assert.equal(r.status, 4, safe(r.out));
  like(r.out, /FIXTURE run/);
  ok(!/verify: the manifests are exactly/.test(r.out), r.out);
});

// ---- the amendments (decision D5), checked against this repository's committed history ----
const registryFile = JSON.parse(readFileSync(join(here, "holdout-manifests.json"), "utf8"));
const withRegistry = (edit) => {
  const reg = structuredClone(registryFile);
  edit(reg);
  const p = join(tmp, `registry-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(reg, null, 2) + "\n");
  return p;
};
// The amendments are committed (#28), so a full clone has the registry versions that hold them.
const fullHistory = spawnSync("git", ["-C", here, "rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).stdout.trim() === "false";

test("verify refuses a deleted amendment", { skip: !fullHistory && "shallow clone" }, () => {
  // Every amendment of the Python primary's first frozen core: D5's (amendments[1]), and D7's from the same core,
  // so that version is no longer allowed by any entry.
  const r = verify("--registry", withRegistry((reg) => {
    const first = reg.amendments[1].superseded_core;
    reg.amendments = reg.amendments.filter((a) => a.superseded_core !== first);
  }));
  assert.equal(r.status, 1, r.out);
  like(r.out, /history: amendments: the entry \["eval\/holdout-primary-py\.json",.* was removed or changed \(amendments are append-only\)/);
  like(r.out, /history: .*froze set py-primary-2026-11-05 with another core, and no registered amendment allows it/);
});

test("verify refuses a duplicate amendment entry", { skip: !fullHistory && "shallow clone" }, () => {
  const r = verify("--registry", withRegistry((reg) => reg.amendments.push(structuredClone(reg.amendments[0]))));
  assert.equal(r.status, 1, r.out);
  like(r.out, /history: amendments: \["eval\/holdout-primary\.json",.* is listed 2 times/);
});

test("verify refuses an amendment of a version that was never frozen", { skip: !fullHistory && "shallow clone" }, () => {
  const r = verify(
    "--registry",
    withRegistry((reg) => reg.amendments.push({ ...structuredClone(reg.amendments[0]), superseded_core: "a".repeat(64) })),
  );
  assert.equal(r.status, 1, r.out);
  like(r.out, /history: amendments\[\d+\]: superseded_core aaaaaaaaaaaa is not the core of any frozen version of ts-primary-2026-11-05/);
});

// No amendment after a held-out run, ordered by commit history (not dates): scratch repositories with one frozen
// manifest, held-out run records and a tier amendment, in various orders. Each scenario is its own repo.
const scratch = async (name) => {
  const { coreSha, heldOutHistoryProblems } = await import("./lib.mjs");
  const dir = join(tmp, `history-${name}`);
  mkdirSync(dir, { recursive: true });
  const g = (date, ...a) => {
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    const r = spawnSync("git", ["-C", dir, "-c", "commit.gpgsign=false", ...a], { env, encoding: "utf8" });
    assert.equal(r.status, 0, `${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const put = (f, v) => {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n");
  };
  const commit = (msg, date = "2026-01-03T12:00:00Z") => {
    g(date, "add", "-A");
    g(date, "commit", "-qm", msg);
  };
  const REG = "eval/study/holdout-manifests.json";
  const M = "eval/holdout-primary.json";
  const v1 = { set_id: "s", role: "primary", frozen_at: "2026-01-01T00:00:00Z", repos: [], reserves: { repos: [] }, tier: { kind: "min_members", value: 15 }, max: 15, pool: 200 };
  const v2 = { ...v1, tier: { kind: "min_members", value: 20 } };
  const amendment = { path: M, set_id: "s", superseded_core: coreSha(v1), core: coreSha(v2), fields: ["tier"], decision: "Dx", date: "2026-01-03" };
  g("2026-01-01T00:00:00Z", "init", "-q", "-b", "main");
  put(M, v1);
  put(REG, { manifests: { [M]: coreSha(v1) } });
  commit("freeze", "2026-01-01T00:00:00Z");
  const start = (f = "eval/study/runs/h/start.json", date) => {
    put(f, { held_out: true, status: "started", manifest: M, set_id: "s", started_at: "2026-01-03T12:00:00Z" });
    commit("held-out run start", date);
  };
  const amend = ({ date, extra = {}, reg = {}, noCommit = false } = {}) => {
    put(M, v2);
    put(REG, { manifests: { [M]: coreSha(v2) }, amendments: [{ ...amendment, ...extra }], ...reg });
    if (!noCommit) commit("amend", date);
  };
  const problems = () => heldOutHistoryProblems(dir, JSON.parse(readFileSync(join(dir, REG), "utf8")), REG);
  return { dir, g, put, commit, start, amend, problems, amendment, M };
};
const AFTER = /amendments\[0\] \(eval\/holdout-primary\.json, decision Dx\) is not in the history of the held-out run record eval\/study\/runs\/.*start\.json at [0-9a-f]{12}/;

test("history: an amendment committed before every held-out run record is accepted", async () => {
  const t = await scratch("honest");
  t.amend();
  t.start();
  assert.deepEqual(t.problems(), []);
});

test("history: an amendment after a run's start record is refused, even when the run died with only the stub", async () => {
  const t = await scratch("after");
  t.start(); // the census died: no run.json was ever written, only the committed start record
  t.amend();
  const p = t.problems();
  assert.equal(p.length, 1, p.join("\n"));
  assert.match(p[0], AFTER);
});

test("history: a back-dated amendment (date and committer date before the run) is still refused", async () => {
  const t = await scratch("backdated");
  t.start(undefined, "2026-01-03T12:00:00Z");
  t.amend({ date: "2025-12-01T00:00:00Z", extra: { date: "2025-12-01" } });
  assert.match(t.problems().join("\n"), AFTER);
});

test("history: a held-out run recorded on another branch counts", async () => {
  const t = await scratch("side");
  t.g("2026-01-02T00:00:00Z", "checkout", "-q", "-b", "side");
  t.start();
  t.g("2026-01-02T00:00:00Z", "checkout", "-q", "main");
  t.amend();
  assert.match(t.problems().join("\n"), AFTER);
});

// The ancestry walk follows every parent of a merge: an amendment reaches a run through a merge's second parent.
test("history: an amendment on a side branch merged before the run is accepted; merged after it is refused", async () => {
  const branchAmend = async (name) => {
    const t = await scratch(name);
    t.g("2026-01-02T00:00:00Z", "checkout", "-q", "-b", "amend");
    t.amend();
    t.g("2026-01-02T00:00:00Z", "checkout", "-q", "main");
    t.put("main.txt", "main\n");
    t.commit("main moves on");
    return t;
  };
  const before = await branchAmend("side-amend-before");
  before.g("2026-01-03T12:00:00Z", "merge", "-q", "--no-ff", "amend", "-m", "merge the amendment");
  before.start();
  assert.deepEqual(before.problems(), []);
  // the run starts on main, then the amendment branch is merged: the amendment is not in the run's history
  const late = await branchAmend("side-amend-after");
  late.start();
  late.g("2026-01-03T13:00:00Z", "merge", "-q", "--no-ff", "amend", "-m", "merge the amendment");
  assert.match(late.problems().join("\n"), AFTER);
  // two runs, one on each side of the merge: only the earlier one is reported
  const both = await branchAmend("side-amend-two-runs");
  both.start("eval/study/runs/early/start.json");
  both.g("2026-01-03T13:00:00Z", "merge", "-q", "--no-ff", "amend", "-m", "merge the amendment");
  both.start("eval/study/runs/late/start.json");
  const p = both.problems();
  assert.ok(p.length >= 1 && p.every((x) => x.includes("eval/study/runs/early/start.json")), p.join("\n"));
  // only a second parent leads to the amendment: the run branch merges main with -s ours (its registry is not
  // taken, so no commit on the run's first-parent line holds the amendment), yet the amendment is its ancestor
  const ours = await scratch("second-parent-only");
  ours.g("2026-01-02T00:00:00Z", "checkout", "-q", "-b", "run");
  ours.put("run.txt", "run\n");
  ours.commit("run branch");
  ours.g("2026-01-02T00:00:00Z", "checkout", "-q", "main");
  ours.amend();
  ours.g("2026-01-03T12:00:00Z", "checkout", "-q", "run");
  ours.g("2026-01-03T12:00:00Z", "merge", "-q", "-s", "ours", "main", "-m", "merge main (ours)");
  ours.start();
  ours.g("2026-01-03T12:00:00Z", "checkout", "-q", "main");
  assert.deepEqual(ours.problems(), []);
});

test("history: a run record nested deeper under eval/study/runs counts", async () => {
  const t = await scratch("nested");
  t.start("eval/study/runs/a/b/start.json");
  t.amend();
  assert.match(t.problems().join("\n"), /is not in the history of the held-out run record eval\/study\/runs\/a\/b\/start\.json/);
});

test("history: an uncommitted amendment is refused once a held-out run record exists", async () => {
  const t = await scratch("uncommitted");
  t.start();
  t.amend({ noCommit: true });
  assert.match(t.problems().join("\n"), /is not in the history of the held-out run record .*; it is not committed at all/);
});

test("history: the --only none preflight's run.json (no repo rows) is not a census", async () => {
  const t = await scratch("preflight");
  t.put("eval/study/runs/h/run.json", { manifest: { holdout: true, set_id: "s" }, prepared_at: "2026-01-02T00:00:00Z", repos: [] });
  t.commit("preflight");
  t.amend();
  assert.deepEqual(t.problems(), []);
});

test("history: a census run.json without a committed start record, or a malformed run record, is reported (not thrown)", async () => {
  const t = await scratch("worktree");
  t.amend();
  t.put("eval/study/runs/c/run.json", { manifest: { holdout: true, set_id: "s" }, prepared_at: "2026-01-04T00:00:00Z", repos: [{ name: "x" }] });
  t.put("eval/study/runs/d/run.json", "{ not json");
  const p = t.problems().join("\n");
  assert.match(p, /eval\/study\/runs\/c\/run\.json: a held-out census record whose run has no committed start record/);
  assert.match(p, /eval\/study\/runs\/d\/run\.json: a run record that is not JSON/);
});

test("history: dates must be ISO; the append-only check ignores key order", async () => {
  const t = await scratch("dates");
  t.amend({ extra: { date: "" } });
  assert.match(t.problems().join("\n"), /amendments\[0\]: date "" is not an ISO date/);
  const u = await scratch("reorder");
  u.amend();
  // Rewrite the registry with the amendment's keys in another order: the same entry.
  const reg = JSON.parse(readFileSync(join(u.dir, "eval/study/holdout-manifests.json"), "utf8"));
  reg.amendments = reg.amendments.map((a) => Object.fromEntries(Object.entries(a).reverse()));
  u.put("eval/study/holdout-manifests.json", reg);
  u.commit("reformat");
  assert.deepEqual(u.problems(), []);
});

test("history: corrections change a descriptive field of one amendment, append-only", async () => {
  const t = await scratch("corrections");
  const key = [t.amendment.path, t.amendment.superseded_core, t.amendment.core];
  const fix = { amendment: key, field: "decision", from: "Dx", to: "Dxa", date: "2026-01-04", by: "lead", reason: "attribution" };
  t.amend({ reg: { corrections: [fix] } });
  assert.deepEqual(t.problems(), []);
  const { effectiveAmendments } = await import("./lib.mjs");
  assert.equal(effectiveAmendments(JSON.parse(readFileSync(join(t.dir, "eval/study/holdout-manifests.json"), "utf8")))[0].decision, "Dxa");
  // A correction of a core field, or of a value the entry does not have, is refused; removing one is too.
  const reg = JSON.parse(readFileSync(join(t.dir, "eval/study/holdout-manifests.json"), "utf8"));
  const bad = { ...reg, corrections: [{ ...fix, field: "core", from: key[2], to: "0".repeat(64) }, { ...fix, from: "nope" }] };
  const p = (await import("./lib.mjs")).heldOutHistoryProblems(t.dir, bad, "eval/study/holdout-manifests.json").join("\n");
  assert.match(p, /corrections\[0\]: field "core" cannot be corrected/);
  assert.match(p, /corrections\[1\]: from "nope", but the amendment's decision is "Dx"/);
  assert.match(p, /corrections: the entry .* committed in [0-9a-f]{12} was removed or changed \(corrections are append-only\)/);
});

// Merges (the walks run without history simplification: --full-history -m, and read each commit's tree).
test("history: a start record added in a merge commit counts", async () => {
  const t = await scratch("merge-adds");
  t.g("2026-01-02T00:00:00Z", "checkout", "-q", "-b", "side");
  t.put("side.txt", "side\n");
  t.commit("side");
  t.g("2026-01-02T00:00:00Z", "checkout", "-q", "main");
  t.put("main.txt", "main\n");
  t.commit("main");
  t.g("2026-01-02T00:00:00Z", "merge", "-q", "--no-commit", "--no-ff", "side");
  t.start(); // the start record is added by the merge commit itself
  t.amend();
  assert.match(t.problems().join("\n"), AFTER);
});

test("history: a run branch merged with -s ours, its ref then deleted, still counts", async () => {
  const t = await scratch("merge-ours");
  t.g("2026-01-02T00:00:00Z", "checkout", "-q", "-b", "run1");
  t.start();
  t.g("2026-01-02T00:00:00Z", "checkout", "-q", "main");
  t.g("2026-01-03T13:00:00Z", "merge", "-q", "-s", "ours", "run1", "-m", "merge run1 (ours)");
  t.g("2026-01-03T13:00:00Z", "branch", "-q", "-D", "run1");
  t.amend();
  assert.match(t.problems().join("\n"), AFTER);
});

test("history: a run branch that deletes its run directory, then a normal merge, still counts", async () => {
  const t = await scratch("merge-deleted-dir");
  t.g("2026-01-02T00:00:00Z", "checkout", "-q", "-b", "run1");
  t.start();
  t.g("2026-01-03T12:30:00Z", "rm", "-rq", "eval/study/runs");
  t.commit("remove the run directory", "2026-01-03T12:30:00Z");
  t.g("2026-01-02T00:00:00Z", "checkout", "-q", "main");
  t.g("2026-01-03T13:00:00Z", "merge", "-q", "--no-ff", "run1", "-m", "merge run1");
  t.g("2026-01-03T13:00:00Z", "branch", "-q", "-D", "run1");
  t.amend();
  assert.match(t.problems().join("\n"), AFTER);
});

// Names git quotes in its default path listings (core.quotePath): the walks use -z and read raw paths.
for (const name of ["ü", 'a"b']) {
  test(`history: a run directory named ${JSON.stringify(name)} (made with raw git) counts`, async () => {
    const t = await scratch(`quoted-${Buffer.from(name).toString("hex")}`);
    t.start(`eval/study/runs/${name}/start.json`);
    t.amend();
    const p = t.problems().join("\n");
    assert.ok(p.includes(`is not in the history of the held-out run record eval/study/runs/${name}/start.json at `), p);
  });
}

test("history: a merge that takes another branch's registry and drops corrections is refused", async () => {
  const t = await scratch("merge-registry");
  t.amend();
  t.g("2026-01-03T12:00:00Z", "checkout", "-q", "-b", "side");
  t.put("side.txt", "side\n");
  t.commit("side");
  t.g("2026-01-03T12:00:00Z", "checkout", "-q", "main");
  const REG = "eval/study/holdout-manifests.json";
  const reg = JSON.parse(readFileSync(join(t.dir, REG), "utf8"));
  const key = [t.amendment.path, t.amendment.superseded_core, t.amendment.core];
  t.put(REG, { ...reg, corrections: [{ amendment: key, field: "decision", from: "Dx", to: "Dxa", date: "2026-01-04", by: "lead", reason: "attribution" }] });
  t.commit("correction");
  t.g("2026-01-04T00:00:00Z", "merge", "-q", "--no-commit", "--no-ff", "side");
  t.g("2026-01-04T00:00:00Z", "checkout", "side", "--", REG);
  t.commit("merge side, taking its registry", "2026-01-04T00:00:00Z");
  assert.equal(JSON.parse(readFileSync(join(t.dir, REG), "utf8")).corrections, undefined, "the merge dropped corrections");
  assert.match(t.problems().join("\n"), /corrections: the entry .* committed in [0-9a-f]{12} was removed or changed \(corrections are append-only\)/);
});

test("history: a run record that is a symlink, a directory named run.json, or a null start record is reported, not thrown", async () => {
  const t = await scratch("odd-records");
  mkdirSync(join(t.dir, "eval/study/runs/s"), { recursive: true });
  symlinkSync("../../../holdout-primary.json", join(t.dir, "eval/study/runs/s/start.json"));
  t.commit("symlinked start record");
  t.amend();
  mkdirSync(join(t.dir, "eval/study/runs/d/run.json"), { recursive: true });
  writeFileSync(join(t.dir, "eval/study/runs/d/run.json/x"), "x\n");
  t.put("eval/study/runs/n/start.json", "null\n");
  const p = t.problems().join("\n");
  assert.match(p, /eval\/study\/runs\/s\/start\.json at [0-9a-f]{12}: a run record that is not a regular file \(blob 120000\)/);
  assert.match(p, /eval\/study\/runs\/d\/run\.json: a run record that is not a regular file/);
  assert.match(p, /eval\/study\/runs\/n\/start\.json: a start record that is not an object/);
});

// Decision D9: a reserves amendment allows only a strict append to the reserve list (with or without the tier).
test("D9: a reserves amendment allows an append, never a removal, reorder or re-pin, nor another core field", async () => {
  const { amendmentAllows, coreSha } = await import("./lib.mjs");
  const r = (n, sha = n.repeat(40).slice(0, 40)) => ({ name: n, url: `https://github.com/x/${n}`, sha });
  const M = "eval/holdout-primary.json";
  const old = { set_id: "s", role: "primary", frozen_at: "2026-01-01T00:00:00Z", repos: [r("a")], reserves: { "//": "x", repos: [r("b"), r("c")] }, tier: { kind: "min_members", value: 15 }, max: 15, pool: 200 };
  const cur = { ...old, tier: { kind: "min_members", value: 20 }, reserves: { "//": "y", repos: [r("b"), r("c"), r("d")] } };
  const tierOnly = { ...old, tier: cur.tier };
  const reg = (fields, from = old) => ({ amendments: [{ path: M, superseded_core: coreSha(from), core: coreSha(cur), fields }] });
  assert.equal(amendmentAllows(reg(["tier", "reserves"]), M, old, cur, coreSha(cur)), true);
  assert.equal(amendmentAllows(reg(["reserves"], tierOnly), M, tierOnly, cur, coreSha(cur)), true);
  assert.equal(amendmentAllows(reg(["reserves"]), M, old, cur, coreSha(cur)), false, "the tier changed too");
  assert.equal(amendmentAllows(reg(["tier"]), M, old, cur, coreSha(cur)), false, "the reserves changed too");
  assert.equal(amendmentAllows(reg(["repos"]), M, old, cur, coreSha(cur)), false, "repos are never amendable");
  for (const [why, repos] of [
    ["reorder", [r("c"), r("b"), r("d")]],
    ["re-pin", [r("b", "f".repeat(40)), r("c"), r("d")]],
    ["removal", [r("b"), r("d")]],
    ["no change", [r("b"), r("c")]],
  ]) {
    const bad = { ...cur, reserves: { repos } };
    const rg = { amendments: [{ path: M, superseded_core: coreSha(old), core: coreSha(bad), fields: ["tier", "reserves"] }] };
    assert.equal(amendmentAllows(rg, M, old, bad, coreSha(bad)), false, why);
  }
  const moved = { ...cur, repos: [r("z")] };
  const rg = { amendments: [{ path: M, superseded_core: coreSha(old), core: coreSha(moved), fields: ["tier", "reserves"] }] };
  assert.equal(amendmentAllows(rg, M, old, moved, coreSha(moved)), false, "a repos change rides along");
});

test("D9: verify replays the extension, and refuses a re-pinned, re-bucketed or reordered one", { skip: !existsSync(join(here, "selection", "primary-2026-11-05-d9.json")) && "no D9 extension" }, () => {
  const ext = JSON.parse(readFileSync(join(here, "selection", "primary-2026-11-05-d9.json"), "utf8"));
  const tampered = (edit) => {
    const e = structuredClone(ext);
    edit(e);
    const p = join(tmp, `ext-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify(e, null, 2) + "\n");
    return p;
  };
  for (const [edit, re] of [
    [(e) => (e.sets.py.reserves[0].sha = "f".repeat(40)), /py: D9 reserve \S+ is pinned to f{40}/],
    [(e) => (e.sets.ts.reserves[0].framework_bucket = "nestjs"), /ts: the D9 reserves differ from what the extended draw gives/],
    [(e) => e.sets.ts.walked.reverse(), /ts: the D9 walk differs from the extension record/],
  ]) {
    const r = verify("--extension", tampered(edit));
    assert.equal(r.status, 1, safe(r.out));
    like(r.out, re);
    assert.equal(leaks(r.out), 0, "no held-out name in the D9 messages");
  }
});

// ---- the second held-out draw (decision D11) ----
const spec = (...a) => {
  const r = spawnSync(process.execPath, [script, "spec", ...a], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("D11: the second draw has the primary draw's buckets, quotas, filters and classifier; only the date, seed and reserves differ", () => {
  const p = spec();
  const h = spec("--selection", "heldout2");
  // a new seed, fixed in the script (committed before the draw): the branch point and 128 random bits
  assert.match(h.seed, /^drift-heldout2-2026-11-07:[0-9a-f]{40}:[0-9a-f]{32}$/);
  assert.notEqual(h.seed, p.seed);
  assert.equal(h.spec.date, "2026-11-07");
  // the same rule: pushed within 6 months of the date
  assert.equal(h.spec.pushed_since, "2026-05-07");
  assert.equal(h.spec.common_qualifiers, p.spec.common_qualifiers.replace(p.spec.pushed_since, h.spec.pushed_since));
  for (const k of ["stars", "size_kb", "osi_licences", "non_app_name", "non_app_topics", "non_product_dir", "max_per_bucket"]) assert.deepEqual(h.spec[k], p.spec[k], k);
  for (const key of ["ts", "py"]) {
    const [a, b] = [p.spec.sets[key], h.spec.sets[key]];
    assert.deepEqual(b.buckets, a.buckets, `${key}: buckets`);
    assert.equal(b.language, a.language);
    assert.deepEqual(b.queries, a.queries.map((q) => q.replace(p.spec.pushed_since, h.spec.pushed_since)), `${key}: queries`);
    // reserves: the primary order three times (18 TS/JS, 12 Python), fixed before the draw
    assert.deepEqual(b.reserve_order, [...a.reserve_order, ...a.reserve_order, ...a.reserve_order], `${key}: reserve_order`);
    assert.notEqual(b.set_id, a.set_id);
    assert.notEqual(b.path, a.path);
  }
  assert.equal(h.spec.sets.ts.reserve_order.length, 18);
  assert.equal(h.spec.sets.py.reserve_order.length, 12);
  assert.equal(h.extension, null);
});

test("D11: the second draw's exclusions take in the primary sets (its own outputs are only its own manifests and record)", () => {
  const p = spec();
  const h = spec("--selection", "heldout2");
  // the primary selection's outputs are not the second draw's own outputs, so they are sources of its exclusions
  for (const f of ["eval/holdout-primary.json", "eval/holdout-primary-py.json"]) {
    assert.ok(p.own_outputs.includes(f));
    assert.ok(!h.own_outputs.includes(f), `${f} must be a source of the second draw's exclusions`);
  }
  assert.ok(!h.own_outputs.some((f) => f.endsWith("/")), "no directory of other records is excluded from the scan");
  assert.deepEqual(h.own_outputs.sort(), [h.spec.sets.ts.path, h.spec.sets.py.path, h.record, "eval/study/select-holdout.mjs"].sort());
});

test("D11: every repo of every earlier held-out manifest and dev manifest is excluded from the second draw's pool", { skip: !record2 && "no heldout2 record yet" }, async () => {
  const { repoSlug } = await import("./lib.mjs");
  const others = Object.entries(manifests).filter(([, m]) => !/heldout2/.test(m.set_id));
  assert.ok(others.length >= 4, "the primary and secondary sets are registered");
  const dev = ["repos.json", "repos-py.json", "repos-py-2.json"].map((f) => JSON.parse(readFileSync(join(here, "..", f), "utf8")));
  const pool = new Set([...record2.sets.ts.pool, ...record2.sets.py.pool]);
  const poolNames = new Set([...pool].map((s) => s.split("/")[1]));
  let checked = 0;
  for (const m of [...others.map(([, m]) => m), ...dev]) {
    for (const r of [...m.repos, ...(m.reserves?.repos ?? [])]) {
      const slug = repoSlug(r.url);
      checked++;
      assert.ok(record2.exclusions.slugs[slug] || record2.exclusions.names[slug.split("/")[1]], safe(`${m.set_id ?? "dev"}: ${slug} is not excluded`));
      assert.ok(!pool.has(slug), safe(`${slug} is in the pool`));
      assert.ok(!poolNames.has(slug.split("/")[1]) && !poolNames.has(String(r.name).toLowerCase()), safe(`${r.name}: a pool repo has its name`));
    }
    for (const e of [...(m.replaced ?? []), ...(m.exposed ?? []), ...(m.burned ?? [])])
      for (const n of [e.repo, e.reserve, e.name].filter(Boolean)) assert.ok(!poolNames.has(n.toLowerCase()), safe(`${n}: a pool repo has this listed name`));
  }
  assert.ok(checked > 90, `${checked} repos checked`);
  // polar and CTFd (rule 6: never scanned) are excluded by owner/repo and by name
  for (const n of ["polar", "ctfd"]) assert.ok(record2.exclusions.names[n], n);
  // the primary sets are a source, as manifests
  assert.ok(Object.values(record2.exclusions.slugs).some((src) => src.includes("manifest eval/holdout-primary.json")));
  assert.ok(Object.values(record2.exclusions.slugs).some((src) => src.includes("manifest eval/holdout-primary-py.json")));
});

test("D11: verify --selection heldout2 refuses another seed, a re-pinned walk and a pool with an excluded repo", { skip: !record2 && "no heldout2 record yet" }, () => {
  const tampered = (edit) => {
    const rec = structuredClone(record2);
    edit(rec);
    const p = join(tmp, `record2-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify(rec, null, 2) + "\n");
    return p;
  };
  const cases = [
    [(rec) => (rec.seed = `${rec.seed}x`), /record seed .* is not the pre-registered seed/],
    [(rec) => (rec.sets.ts.walked.find((w) => w.repo === rec.sets.ts.primaries[0].repo).sha = "f".repeat(40)), /ts: \S+ is pinned to \S+, the walk recorded f{40}/],
    [(rec) => {
      const slug = Object.keys(rec.exclusions.slugs).find((k) => rec.exclusions.slugs[k].includes("manifest eval/holdout-primary.json"));
      rec.sets.ts.pool = [...rec.sets.ts.pool, slug].sort();
      rec.sets.ts.counts.eligible++;
      rec.sets.ts.counts.results++;
    }, /ts: pool repo .* is excluded \(.*manifest eval\/holdout-primary\.json/],
  ];
  for (const [edit, re] of cases) {
    const r = verify("--selection", "heldout2", "--record", tampered(edit));
    assert.equal(r.status, 1, safe(r.out));
    like(r.out, re);
    assert.equal(leaks(r.out), 0, "no held-out name in the messages");
  }
});

test("D11: extend refuses the second draw (its reserves were fixed before the draw)", () => {
  const r = spawnSync(process.execPath, [script, "extend", "--selection", "heldout2", "--set", "ts", "--add", "1"], { encoding: "utf8", env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", HTTPS_PROXY: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", all_proxy: "http://127.0.0.1:9" } });
  assert.equal(r.status, 2, r.stderr);
  like(r.stderr, /extend: decision D9 extends the primary sets only/);
});

test("an unknown --selection is refused", () => {
  const r = spawnSync(process.execPath, [script, "spec", "--selection", "nope"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  like(r.stderr, /--selection must be one of primary, heldout2/);
});

// ---- a blind dev pool (PLAN-R10 section 3.1): `select-holdout.mjs --selection dev3`, role dev ----
const offline = { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", HTTPS_PROXY: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", all_proxy: "http://127.0.0.1:9" };

test("dev3: the held-out draw's buckets, filters and classifier; 12 TS/JS and 8 Python primaries; reserves fixed at 18 and 12", () => {
  const h = specs.heldout2;
  const d = specs.dev3;
  assert.equal(d.role, "dev");
  assert.equal(h.role, "primary");
  assert.match(d.seed, /^drift-dev3-2026-11-08:[0-9a-f]{40}:[0-9a-f]{32}$/);
  for (const x of Object.values(specs)) if (x !== d) assert.notEqual(d.seed, x.seed);
  assert.equal(d.spec.pushed_since, "2026-05-08");
  assert.equal(d.spec.common_qualifiers, h.spec.common_qualifiers.replace(h.spec.pushed_since, d.spec.pushed_since));
  for (const k of ["stars", "size_kb", "osi_licences", "non_app_name", "non_app_topics", "non_product_dir", "max_per_bucket"]) assert.deepEqual(d.spec[k], h.spec[k], k);
  const quota = { ts: 12, py: 8 };
  for (const key of ["ts", "py"]) {
    const [a, b] = [h.spec.sets[key], d.spec.sets[key]];
    // the same buckets in the same precedence, with the same packages; only the primary quotas are smaller
    assert.deepEqual(b.buckets.map(({ primaries, ...rest }) => rest), a.buckets.map(({ primaries, ...rest }) => rest), `${key}: buckets`);
    assert.equal(b.buckets.reduce((n, x) => n + x.primaries, 0), quota[key], `${key}: primaries`);
    for (const [i, x] of b.buckets.entries()) assert.ok(x.primaries >= 2 && x.primaries <= a.buckets[i].primaries, `${key}: ${x.id} quota`);
    assert.deepEqual(b.queries, a.queries.map((q) => q.replace(h.spec.pushed_since, d.spec.pushed_since)), `${key}: queries`);
    assert.deepEqual(b.reserve_order, a.reserve_order, `${key}: reserves fixed before the draw, as heldout2's`);
    assert.notEqual(b.set_id, a.set_id);
  }
  assert.equal(d.extension, null);
});

// The size of each pool, as pre-registered (PLAN-R10 section 3.1; PLAN-R11 section 4.1).
const POOL_SIZE = { dev3: { ts: 12, py: 8 }, dev4: { ts: 36, py: 24 } };

test("dev4: the held-out draw's buckets, filters and classifier at twice the held-out quotas (36 TS/JS, 24 Python); reserves fixed at 54 and 36", () => {
  const h = specs.heldout2;
  const d = specs.dev4;
  assert.equal(d.role, "dev");
  assert.match(d.seed, /^drift-dev4-2026-11-08:[0-9a-f]{40}:[0-9a-f]{32}$/);
  for (const x of Object.values(specs)) if (x !== d) assert.notEqual(d.seed, x.seed);
  // the seed names a main commit (the branch point), never a commit of the draw itself
  assert.equal(spawnSync("git", ["-C", here, "merge-base", "--is-ancestor", d.seed.split(":")[1], "HEAD"]).status, 0, "the seed's commit is an ancestor");
  assert.equal(d.spec.pushed_since, "2026-05-08");
  assert.equal(d.spec.common_qualifiers, h.spec.common_qualifiers.replace(h.spec.pushed_since, d.spec.pushed_since));
  for (const k of ["stars", "size_kb", "osi_licences", "non_app_name", "non_app_topics", "non_product_dir"]) assert.deepEqual(d.spec[k], h.spec[k], k);
  assert.equal(d.spec.max_per_bucket, 2 * h.spec.max_per_bucket, "the hand-up cap doubles with the quotas");
  assert.equal(specs.dev3.spec.max_per_bucket, h.spec.max_per_bucket, "dev3's spec is unchanged");
  for (const key of ["ts", "py"]) {
    const [a, b] = [h.spec.sets[key], d.spec.sets[key]];
    assert.deepEqual(b.buckets.map(({ primaries, ...rest }) => rest), a.buckets.map(({ primaries, ...rest }) => rest), `${key}: buckets`);
    assert.equal(b.buckets.reduce((n, x) => n + x.primaries, 0), POOL_SIZE.dev4[key], `${key}: primaries`);
    assert.deepEqual(b.queries, a.queries.map((q) => q.replace(h.spec.pushed_since, d.spec.pushed_since)), `${key}: queries`);
    // the held-out reserve order (heldout2's is it three times) nine times: 1.5x the slots
    const base = a.reserve_order.slice(0, a.reserve_order.length / 3);
    assert.deepEqual(b.reserve_order, Array.from({ length: 9 }, () => base).flat(), `${key}: reserves fixed before the draw`);
    assert.notEqual(b.set_id, a.set_id);
  }
  // TS/JS: exactly twice the held-out quotas. Python: 24/10 of them by largest remainder (ties in bucket order).
  const quota = (sel, key) => Object.fromEntries(sel.spec.sets[key].buckets.map((x) => [x.id, x.primaries]));
  assert.deepEqual(quota(d, "ts"), Object.fromEntries(Object.entries(quota(h, "ts")).map(([k, v]) => [k, 2 * v])));
  const py = quota(h, "py");
  const exact = Object.fromEntries(Object.entries(py).map(([k, v]) => [k, (v * 24) / 10]));
  const lr = Object.fromEntries(Object.entries(exact).map(([k, v]) => [k, Math.floor(v)]));
  const left = 24 - Object.values(lr).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(exact).sort((x, y) => exact[y] - Math.floor(exact[y]) - (exact[x] - Math.floor(exact[x]))).slice(0, left)) lr[k]++;
  assert.deepEqual(quota(d, "py"), lr);
  assert.deepEqual(quota(d, "py"), { django: 7, fastapi: 7, flask: 5, other_python: 5 });
  assert.equal(d.spec.sets.ts.reserve_order.length, 54);
  assert.equal(d.spec.sets.py.reserve_order.length, 36);
  assert.equal(d.extension, null);
});

for (const id of POOLS) {
  const rec = poolRecord[id];
  const others = SELECTION_IDS.filter((x) => x !== id);

  test(`${id}: every output is isolated under eval/${id}*, and every other selection's manifests and record are sources of its exclusions`, () => {
    const d = specs[id];
    const outs = [d.spec.sets.ts.path, d.spec.sets.py.path, d.record, d.registry];
    for (const p of outs) assert.match(p, new RegExp(`^eval/${id}[-_.]`), p);
    assert.deepEqual([...d.own_outputs].sort(), [...outs, "eval/study/select-holdout.mjs"].sort());
    for (const o of others) {
      const x = specs[o];
      for (const f of [x.spec.sets.ts.path, x.spec.sets.py.path, x.record, x.registry].filter(Boolean)) assert.ok(!d.own_outputs.some((own) => f.startsWith(own)), `${f} must be a source of ${id}'s exclusions`);
    }
    for (const p of Object.keys(registry)) assert.ok(!d.own_outputs.includes(p), p);
  });

  test(`${id}: fetch and write refuse an output outside eval/${id}*, before anything is fetched or written`, () => {
    for (const mode of ["fetch", "write"]) {
      const out = join(tmp, `${id}-elsewhere-${mode}.json`);
      const r = spawnSync(process.execPath, [script, mode, "--selection", id, "--record", out], { encoding: "utf8", env: offline, timeout: 60000 });
      assert.equal(r.status, 2, `${mode}: ${safe(r.stderr)}`);
      like(r.stderr, new RegExp(`the ${id} selection is a blind dev pool: every output must be named eval/${id}\\*`));
      ok(!existsSync(out), `${mode} wrote ${out}`);
    }
    // a held-out selection is not a blind dev pool: no such rule (it fails later, on its own checks)
    const r = spawnSync(process.execPath, [script, "write", "--selection", "heldout2", "--record", join(tmp, "missing.json")], { encoding: "utf8", env: offline });
    ok(!/blind dev pool/.test(r.stderr), r.stderr);
  });

  test(`${id}: the manifests are role dev, not held-out, and registered only in the pool's own registry`, { skip: !rec && `no ${id} record yet` }, () => {
    const d = specs[id];
    for (const key of ["ts", "py"]) {
      const p = d.spec.sets[key].path;
      const m = poolManifests[p];
      assert.ok(m, `${p} written`);
      assert.equal(m.role, "dev");
      assert.equal(m.holdout, false);
      assert.equal(m.selection.registry, d.registry);
      assert.equal(m.repos.length, POOL_SIZE[id][key]);
      assert.equal(m.reserves.repos.length, d.spec.sets[key].reserve_order.length);
      assert.ok(!(p in registry), `${p} is not a held-out manifest`);
    }
  });

  test(`${id}: every dev, held-out and earlier pool repo (polar and CTFd too) is excluded from the pool`, { skip: !rec && `no ${id} record yet` }, async () => {
    const { repoSlug } = await import("./lib.mjs");
    const dev = ["repos.json", "repos-py.json", "repos-py-2.json"].map((f) => JSON.parse(readFileSync(join(here, "..", f), "utf8")));
    // the blind dev pools drawn before this one (their manifests existed at this draw's refs)
    const earlier = POOLS.slice(0, POOLS.indexOf(id)).flatMap((o) => [specs[o].spec.sets.ts.path, specs[o].spec.sets.py.path]);
    for (const p of earlier) assert.ok(poolManifests[p], `${p} is committed`);
    const pool = new Set([...rec.sets.ts.pool, ...rec.sets.py.pool]);
    const poolNames = new Set([...pool].map((x) => x.split("/")[1]));
    let checked = 0;
    for (const m of [...Object.values(manifests), ...dev, ...earlier.map((p) => poolManifests[p])]) {
      for (const r of [...m.repos, ...(m.reserves?.repos ?? [])]) {
        const slug = repoSlug(r.url);
        checked++;
        assert.ok(rec.exclusions.slugs[slug] || rec.exclusions.names[slug.split("/")[1]], safe(`${m.set_id ?? "dev"}: ${slug} is not excluded`));
        assert.ok(!pool.has(slug), safe(`${slug} is in the pool`));
        assert.ok(!poolNames.has(slug.split("/")[1]) && !poolNames.has(String(r.name).toLowerCase()), safe(`${r.name}: a pool repo has its name`));
      }
      for (const e of [...(m.replaced ?? []), ...(m.exposed ?? []), ...(m.burned ?? [])])
        for (const n of [e.repo, e.reserve, e.name].filter(Boolean)) assert.ok(!poolNames.has(n.toLowerCase()), safe(`${n}: a pool repo has this listed name`));
    }
    assert.ok(checked > 120, `${checked} repos checked`);
    for (const n of ["polar", "ctfd"]) assert.ok(rec.exclusions.names[n], n);
    for (const f of [...Object.keys(registry), ...earlier]) assert.ok(Object.values(rec.exclusions.slugs).some((src) => src.includes(`manifest ${f}`)), `${f} is a source`);
    // an earlier pool's manifests are manifest sources by NAME too (its replaced names included), not only by URL
    for (const p of earlier) {
      const m = poolManifests[p];
      for (const n of [...m.repos.map((r) => r.name), ...(m.replaced ?? []).flatMap((e) => [e.repo, e.reserve])]) assert.ok((rec.exclusions.names[n.toLowerCase()] ?? []).includes(`manifest ${p}`), safe(`${n}: not a name source from ${p}`));
    }
  });

  test(`${id}: verify refuses a tampered pool registry, a pool registered as held-out, and names no pool repo`, { skip: !(rec && refsPresent) && `no ${id} record yet, or recorded refs not in this clone` }, () => {
    const d = specs[id];
    const ts = poolManifests[d.spec.sets.ts.path];
    // 1. the pool's own registry holds another core
    const fx = fixtureRoot(`fixture-${id}-registry`);
    const reg = JSON.parse(readFileSync(join(fx, d.registry), "utf8"));
    reg.manifests[d.spec.sets.py.path] = "0".repeat(64);
    writeFileSync(join(fx, d.registry), JSON.stringify(reg, null, 2) + "\n");
    const r1 = verify("--selection", id, "--manifest-root", fx);
    assert.equal(r1.status, 1, safe(r1.out));
    like(r1.out, new RegExp(`${esc(d.spec.sets.py.path)}: not registered with its core hash in ${esc(d.registry)}`));
    // 2. a pool manifest registered in the held-out registry (prepare.mjs would run it as a held-out set)
    const r2 = verify("--selection", id, "--registry", withRegistry((g) => (g.manifests[d.spec.sets.ts.path] = "0".repeat(64))));
    assert.equal(r2.status, 1, safe(r2.out));
    like(r2.out, new RegExp(`${esc(d.spec.sets.ts.path)} is registered as a held-out manifest, but the ${id} selection has role dev`));
    // 3. a pool repo under a name only its manifest knows, overlapping a dev manifest: the message names its slot only
    // (a slot whose primary was not swapped out, and the last reserve, which no swap has used)
    const swapped = new Set((ts.replaced ?? []).map((e) => e.repo));
    const slot = ts.repos.findIndex((r) => !swapped.has(r.name));
    const last = ts.reserves.repos.length - 1;
    assert.ok(slot >= 0 && (ts.replaced ?? []).length <= last, "a kept primary and an unused reserve");
    const fx3 = fixtureRoot(`fixture-${id}-rename`);
    const renamed = structuredClone(ts);
    renamed.repos[slot].name = `zz-${id}-fixture-name`;
    writeFileSync(join(fx3, d.spec.sets.ts.path), JSON.stringify(renamed, null, 2) + "\n");
    const devHit = join(tmp, `${id}-hit.json`);
    writeFileSync(devHit, JSON.stringify({ repos: [{ name: `zz-${id}-fixture-name`, url: `https://github.com/nobody/zz-${id}-fixture-name`, sha: "1".repeat(40) }, ts.reserves.repos[last]] }));
    const r3 = verify("--selection", id, "--manifest-root", fx3, "--dev", devHit);
    assert.equal(r3.status, 1, safe(r3.out));
    like(r3.out, new RegExp(`blind-dev ${esc(ts.set_id)}:repos\\[${slot}\\] overlaps`));
    like(r3.out, new RegExp(`blind-dev ${esc(ts.set_id)}:(record\\.)?reserves\\[${last}\\] overlaps`));
    ok(!new RegExp(`zz-${id}-fixture-name`).test(r3.out), r3.out);
    for (const r of [r1, r2, r3]) assert.equal(leaks(r.out), 0, "no pool repo named");
  });
}

test("pools: a repo of one blind dev pool listed by another pool (as a reserve, or by name in its lists) is an overlap, named by slot only", { skip: !(POOLS.every((id) => poolRecord[id]) && refsPresent) && "not every pool drawn yet, or recorded refs not in this clone" }, () => {
  const [a, b] = POOLS.slice(-2); // the latest pool, and the one before it
  const ma = poolManifests[specs[b].spec.sets.ts.path];
  const pa = specs[a].spec.sets.py.path;
  const swapped = new Set((ma.replaced ?? []).map((e) => e.repo));
  const slot = ma.repos.findIndex((r) => !swapped.has(r.name));
  // 1. the earlier pool's Python manifest gets an `exposed` entry with the later pool's repo name
  const fx = fixtureRoot("fixture-pools-name");
  const other = JSON.parse(readFileSync(join(fx, pa), "utf8"));
  other.exposed = [...(other.exposed ?? []), { date: "2026-11-08", name: ma.repos[slot].name, where: "fixture" }];
  writeFileSync(join(fx, pa), JSON.stringify(other, null, 2) + "\n");
  const r1 = verify("--selection", b, "--manifest-root", fx);
  assert.equal(r1.status, 1, safe(r1.out));
  // the redactor gives a token the first slot it reads it under, which may be the fixture's listed name
  const anySlot = `(${esc(ma.set_id)}:repos\\[${slot}\\]|[A-Za-z0-9_.-]+:(record\\.)?(repos|reserves|primaries)\\[\\d+\\]|[A-Za-z0-9_.-]+:name#[0-9a-f]{8})`;
  like(r1.out, new RegExp(`${esc(specs[b].spec.sets.ts.path)}: blind-dev ${anySlot} overlaps ${esc(pa)} \\(blind dev pool of another selection\\) by name`));
  // 2. ... and the same repo as one of its reserves: an overlap by owner/repo and pin, seen from either pool
  const fx2 = fixtureRoot("fixture-pools-reserve");
  const other2 = JSON.parse(readFileSync(join(fx2, pa), "utf8"));
  other2.reserves.repos.push({ ...ma.repos[slot], name: "zz-pools-fixture-name" });
  writeFileSync(join(fx2, pa), JSON.stringify(other2, null, 2) + "\n");
  const r2 = verify("--selection", b, "--manifest-root", fx2);
  assert.equal(r2.status, 1, safe(r2.out));
  like(r2.out, new RegExp(`${esc(specs[b].spec.sets.ts.path)}: blind-dev ${anySlot} overlaps ${esc(pa)} \\(blind dev pool of another selection\\) by slug .*sha `));
  for (const r of [r1, r2]) {
    assert.equal(leaks(r.out), 0, "no pool repo named");
    ok(!/zz-pools-fixture-name/.test(r.out), r.out);
  }
});
