// Validate what agents wrote to the outbox and copy it into the run directory.
//
//   node eval/study/collect.mjs --run DIR [--stage label|adjudicate|extract|match] [--labeller X] [--repo NAME] [--force] [--allow-partial] [--complete]
//
// --repo NAME collects only that repo's prompts (relabel5, 2026-11-07): an orchestrator who collects one finished agent
// must not also collect another agent's output that is still being written. Without it, every output present is collected.
//
// Reads <run>/prompts/index.json (written by prompt.mjs). For each prompt whose output exists:
// validates every record, checks it covers exactly the expected uids/refs, and copies it to
//   label       -> labels/<A|B>/<repo>.jsonl
//   adjudicate  -> labels/C/<repo>.jsonl
//   extract     -> recall/docs/<repo>.jsonl          (E1; other extractors -> recall/docs-<X>/)
//   match       -> recall/matches/<repo>.jsonl       (M1; other matchers   -> recall/matches-<X>/)
// A collected file is final: it is not replaced by a different version unless --force is given.
// A valid output is MOVED: its outbox is deleted and the index entry marked collected, so finished labels
// never stay where another agent writes. Label and adjudication records get `labeller` from the index
// (prompts never tell an agent which labeller it is). A file that does not parse is INVALID, like any
// other schema problem; it does not stop the other files from being collected.
//
// Outputs that are missing, duplicated or outside their outbox (2026-11-07, after a labeller wrote a stray copy of its
// output into the orchestrator's worktree). An output is INVALID, and stays in its outbox, when:
//   - its outbox holds any other file besides out.jsonl (a second or partial copy);
//   - the agent's working directory (`cwd` in the index, a fresh empty directory from prompt.mjs) is not empty, or is
//     gone, or, for a held-out run, the prompt was rendered without one;
//   - the repo checkout gained or changed a file since the prompt was rendered (`checkout_status`);
//   - a copy of its records (any record's reason text) is in an untracked file of the Drift repository outside the run
//     directory, in another file under an outbox root, or in another agent's working directory;
//   - it is byte-identical to another prompt's output, a label record has the same reason text as another labeller's
//     collected label of the same uid, or records carry `labeller` / `rubric_sha256`, which only collect.mjs writes.
// A prompt with no output is "waiting"; it is MISSING (and counts as a failure) when its working directory holds files
// (the agent wrote there instead), or with --complete, which also fails while any repo of the run lacks a complete A or B
// label set (lib.mjs labelSetGaps) for the labellers in scope. Loose files directly in an outbox root fail the run too.
// Move a stray file aside unread, record the deviation in the run README, and relaunch the agent; never edit an output.
// Each rejection is appended to the entry's `rejected` list in prompts/index.json (when, and the problems).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { MATCH, checkLabel, checkRecallRecord, checkoutStatus, describeGap, die, labelSetGaps, loadRun, memberFileInfo, parseArgs, parseCensus, readJson, readJsonl, recordRubricShas, repoRootDir, strip, within } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["force", "allowPartial", "complete"] });
if (!args.run) die("usage: collect.mjs --run DIR [--stage S] [--labeller X] [--repo NAME] [--force] [--allow-partial] [--complete]");
const { run, queue, byUid } = loadRun(args.run);
// The "other members" rule asks for min(2, the files the role can have members in besides the example's and outliers'),
// and counts only tracked, non-config files that can hold a member of the role (lib.mjs checkLabel, memberFileInfo).
const memberFiles = memberFileInfo(run, queue);
const otherMembers = new Map([...memberFiles].filter(([, i]) => i.bound !== null).map(([u, i]) => [u, i.bound]));
const index = readJson(join(args.run, "prompts", "index.json"));
const runDir = resolve(args.run);
const checkoutOf = new Map((run.repos ?? []).map((r) => [r.name, r.checkout]));
// A practice run (F6): its match records (MA, MB, MC) are labels, collected to labels/<matcher>/ and validated by
// lib.mjs checkLabel under their rubric, like the describe records of A, B and C.
const PRACTICE = queue.kind === "practice";
const labelLike = (e) => e.stage === "label" || e.stage === "adjudicate" || (PRACTICE && ["match", "recall-list", "recall-match"].includes(e.stage));
// The variant-recall packages (recall.json): the uids of recall-list and recall-match records.
const recallByUid = PRACTICE && existsSync(join(args.run, "recall.json")) ? new Map(readJson(join(args.run, "recall.json")).items.map((q) => [q.uid, q])) : new Map();

const dest = (e) =>
  ({
    label: join(args.run, "labels", e.labeller, `${e.repo}.jsonl`),
    adjudicate: join(args.run, "labels", "C", `${e.repo}.jsonl`),
    extract: join(args.run, "recall", e.labeller === "E1" ? "docs" : `docs-${e.labeller}`, `${e.repo}.jsonl`),
    "recall-list": join(args.run, "labels", e.labeller, `${e.repo}.jsonl`),
    "recall-match": join(args.run, "labels", e.labeller, `${e.repo}.jsonl`),
    match: PRACTICE ? join(args.run, "labels", e.labeller, `${e.repo}.jsonl`) : join(args.run, "recall", e.labeller === "M1" ? "matches" : `matches-${e.labeller}`, `${e.repo}.jsonl`),
  })[e.stage];

// The run's rubric text: that of its first label or adjudication prompt (prompt.mjs refuses to render another), and
// the texts its collected records already name (stamped below), so clearing prompts/index.json hides nothing.
const runRubricSha = index.filter((e) => (e.stage === "label" || e.stage === "adjudicate") && e.rubric_sha256).sort((a, b) => String(a.rendered_at).localeCompare(String(b.rendered_at)))[0]?.rubric_sha256 ?? null;
const collectedShas = recordRubricShas(args.run);

function validate(e, recs) {
  const p = [];
  if ((e.stage === "label" || e.stage === "adjudicate") && e.rubric_sha256 && runRubricSha && e.rubric_sha256 !== runRubricSha)
    p.push(`the prompt was rendered with rubric text ${e.rubric_sha256.slice(0, 12)}, the run's is ${runRubricSha.slice(0, 12)}: two rubric texts in one run (start a new run)`);
  if (e.stage === "label" || e.stage === "adjudicate") {
    const other = collectedShas.filter((h) => h !== e.rubric_sha256);
    if (other.length)
      p.push(e.rubric_sha256
        ? `the prompt was rendered with rubric text ${e.rubric_sha256.slice(0, 12)}, but collected records of this run name ${other.map((h) => h.slice(0, 12)).join(", ")}: two rubric texts in one run (start a new run)`
        : `the prompt records no rubric text, but collected records of this run name ${other.map((h) => h.slice(0, 12)).join(", ")} (start a new run)`);
  }
  const key = (r) => (e.stage === "extract" || (e.stage === "match" && !PRACTICE) ? r.ref : r.uid);
  for (const r of recs) {
    const at = r._src.split("/").pop();
    if (labelLike(e)) {
      const recall = e.stage.startsWith("recall-");
      p.push(...checkLabel(r, { labeller: e.labeller, byUid: recall ? recallByUid : byUid, expectRubric: e.rubric ?? "v2", otherMembers, memberFiles }).map((x) => `${at}: ${x}`));
      if (e.stage === "recall-match") {
        const listPath = join(args.run, "labels", "L1", `${e.repo}.jsonl`);
        const list = existsSync(listPath) ? readJsonl(listPath).find((x) => x.uid === r.uid) : null;
        p.push(...checkRecallRecord(r, { expectRubric: e.rubric, list }).filter((x) => /answers for/.test(x)).map((x) => `${at}: ${x}`));
      }
      if (r.uid && !r.uid.startsWith(`${e.repo}/`)) p.push(`${at}: ${r.uid} is not a proposal of ${e.repo}`);
      if (e.stage === "adjudicate" && !["1", "2", "neither"].includes(String(r.sided_with))) p.push(`${at}: sided_with must be "1", "2" or "neither"`);
    } else if (e.stage === "extract") {
      if (!new RegExp(`^${e.repo.replace(/[.]/g, "\\.")}#R\\d+$`).test(r.ref ?? "")) p.push(`${at}: ref must look like ${e.repo}#R01`);
      for (const f of ["source", "statement", "scope", "category", "strength"]) if (!r[f]) p.push(`${at}: missing ${f}`);
      if (typeof r.code_checkable !== "boolean") p.push(`${at}: code_checkable must be true/false`);
    } else if (e.stage === "match") {
      if (!MATCH.includes(r.match) || !MATCH.includes(r.pool_match)) p.push(`${at}: match and pool_match must be FULL|PARTIAL|NONE`);
      if (MATCH.indexOf(r.pool_match) > MATCH.indexOf(r.match)) p.push(`${at}: pool_match cannot be worse than match`);
      if (!["yes", "mostly", "no", "unknown"].includes(r.followed)) p.push(`${at}: followed must be yes|mostly|no|unknown`);
      const shown = new Set(queue.items.filter((q) => q.repo === e.repo).map((q) => q.id));
      const poolPath = join(args.run, "pool", `${e.repo}.txt`);
      const pool = new Set([...shown, ...(existsSync(poolPath) ? parseCensus(readFileSync(poolPath, "utf8")).proposals.map((x) => x.id) : [])]);
      for (const id of r.proposals ?? []) if (!shown.has(id)) p.push(`${at}: ${id} is not a shown proposal`);
      for (const id of r.pool_proposals ?? []) if (!pool.has(id)) p.push(`${at}: ${id} is not in the pool`);
      if (r.match !== "NONE" && !(r.proposals ?? []).length) p.push(`${at}: a ${r.match} match must name its proposals`);
    }
  }
  const keys = recs.map(key);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dup.length) p.push(`duplicate records: ${[...new Set(dup)].join(", ")}`);
  if (e.expected) {
    const have = new Set(keys);
    const want = new Set(e.expected);
    const miss = e.expected.filter((k) => !have.has(k));
    const extra = keys.filter((k) => !want.has(k));
    if (miss.length && !args.allowPartial) p.push(`missing ${miss.length}: ${miss.join(", ")} (an agent that stopped early: rerun it, or --allow-partial)`);
    if (extra.length) p.push(`unexpected: ${extra.join(", ")}`);
  }
  return p;
}

// ---- where an output must not be: the agent's working directory, other files under the outbox roots, untracked
// files of the Drift repository outside the run directory ----
const listDir = (d) => {
  try {
    return readdirSync(d);
  } catch {
    return null;
  }
};
const cwdEntries = (e) => (e.cwd ? listDir(e.cwd) : null);
const names = (xs) => `${xs.slice(0, 5).join(", ")}${xs.length > 5 ? `, and ${xs.length - 5} more` : ""}`;
const outputs = new Set(index.map((x) => resolve(x.output)));
const outboxRoots = [...new Set(index.map((x) => dirname(dirname(resolve(x.output)))))];
let pool = null; // [{ path, text }]
function strayPool() {
  if (pool) return pool;
  const paths = [];
  const walk = (d, depth) => {
    for (const f of listDir(d) ?? []) {
      const p = join(d, f);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory() && depth > 0) walk(p, depth - 1);
      else if (st.isFile() && !outputs.has(p) && st.size <= 4 << 20) paths.push(p);
    }
  };
  for (const r of outboxRoots) walk(r, 2);
  for (const x of index) if (x.cwd) walk(x.cwd, 3);
  const ls = spawnSync("git", ["-C", repoRootDir, "ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (ls.status === 0)
    for (const f of ls.stdout.split("\0").filter(Boolean)) {
      const p = join(repoRootDir, f);
      try {
        if (!within(p, runDir) && statSync(p).size <= 4 << 20) paths.push(p);
      } catch {}
    }
  pool = paths.map((path) => {
    try {
      return { path, text: readFileSync(path, "utf8") };
    } catch {
      return { path, text: "" };
    }
  });
  return pool;
}
// Files outside its outbox that hold a copy of one of these records (by its reason or statement text).
function copiesElsewhere(e, recs) {
  const texts = recs.map((r) => r.reason ?? r.statement).filter((t) => typeof t === "string" && t.trim().length >= 20);
  if (!texts.length) return [];
  const needles = [...new Set(texts.flatMap((t) => [t, JSON.stringify(t).slice(1, -1)]))];
  return strayPool()
    .filter((f) => resolve(f.path) !== resolve(e.output) && needles.some((n) => f.text.includes(n)))
    .map((f) => f.path);
}
// Raw output texts of every prompt that has one, to find byte-identical outputs.
const rawOf = new Map(index.filter((x) => existsSync(x.output)).map((x) => [x, readFileSync(x.output, "utf8")]));
// Collected label records of the run, by labeller and uid, to find a record copied from another labeller.
const collectedReasons = (L, repo) => {
  const f = join(args.run, "labels", L, `${repo}.jsonl`);
  return existsSync(f) ? new Map(readJsonl(f).map((r) => [r.uid, r.reason])) : new Map();
};

function placement(e, recs) {
  const p = [];
  const tag = (x) => `${x.stage} ${x.labeller} ${x.repo}`;
  const box = dirname(e.output);
  const extra = (listDir(box) ?? []).filter((f) => f !== basename(e.output));
  if (extra.length) p.push(`its outbox holds other files besides ${basename(e.output)}: ${names(extra)} (a second or partial copy? move them aside unread and relaunch)`);
  if (e.cwd) {
    const cw = cwdEntries(e);
    if (cw === null) p.push(`its working directory ${e.cwd} is gone: nothing shows that the agent wrote only its outbox (render the prompt again and relaunch)`);
    else if (cw.length) p.push(`its working directory ${e.cwd} is not empty (${cw.length}: ${names(cw)}): the agent wrote outside its outbox (move them aside unread, record it, relaunch)`);
  } else if (run.manifest?.holdout) p.push("the prompt was rendered without a working directory (no `cwd` in the index): render it again with this prompt.mjs and relaunch the agent in that directory");
  const co = checkoutOf.get(e.repo);
  if (Array.isArray(e.checkout_status) && co) {
    const before = new Set(e.checkout_status);
    const now = checkoutStatus(co) ?? [];
    const added = now.filter((l) => !before.has(l));
    if (added.length) p.push(`the checkout ${co} changed since the prompt was rendered (${added.length}: ${names(added.map((l) => l.slice(3)))}): an agent must not write there`);
  }
  const copies = copiesElsewhere(e, recs);
  if (copies.length) p.push(`a copy of its records is outside its outbox: ${names(copies)} (move it aside unread, record it, relaunch)`);
  const raw = rawOf.get(e);
  const twins = [...rawOf].filter(([x, t]) => x !== e && t === raw).map(([x]) => tag(x));
  if (twins.length) p.push(`byte-identical to the output of ${twins.join(", ")}`);
  if (labelLike(e)) {
    const stamped = recs.filter((r) => r.labeller !== undefined || r.rubric_sha256 !== undefined || r.model !== undefined);
    if (stamped.length) p.push(`${stamped.length} records carry \`labeller\`, \`rubric_sha256\` or \`model\`, which only collect.mjs writes: a copy of a collected label file?`);
  }
  if (e.stage === "label")
    for (const L of ["A", "B"].filter((x) => x !== e.labeller)) {
      const theirs = collectedReasons(L, e.repo);
      const same = recs.filter((r) => typeof r.reason === "string" && theirs.get(r.uid) === r.reason);
      if (same.length) p.push(`${same.length} records have the same reason text as labeller ${L}'s collected label of that uid (${names(same.map((r) => r.uid))}): not an independent label`);
    }
  return p;
}

let bad = 0;
let waiting = 0;
for (const e of index) {
  if ((args.stage && e.stage !== args.stage) || (args.labeller && e.labeller !== args.labeller) || (args.repo && e.repo !== args.repo)) continue;
  const tag = `${e.stage} ${e.labeller} ${e.repo}`;
  if (!existsSync(e.output)) {
    if (e.collected) {
      console.log(`${tag}: collected ${e.collected.at}`);
      continue;
    }
    const cw = cwdEntries(e);
    if (cw?.length) {
      bad++;
      console.log(`${tag}: MISSING from its outbox, and its working directory ${e.cwd} holds ${cw.length} files (${names(cw)}): the agent wrote outside its outbox (move them aside unread, record it, relaunch)`);
    } else if (args.complete) {
      bad++;
      console.log(`${tag}: MISSING (no output in its outbox ${e.output}; --complete)`);
    } else {
      waiting++;
      console.log(`${tag}: waiting (no output in its outbox yet)`);
    }
    continue;
  }
  const parseErrors = [];
  const recs = readJsonl(e.output, { onError: (m) => parseErrors.push(m.split("/").pop()) });
  // F1: prompts show the repo's opaque key in each uid; map it back to the repo's name
  if (e.repo_key) for (const r of recs) if (typeof r.uid === "string" && r.uid.startsWith(`${e.repo_key}/`)) r.uid = `${e.repo}/${r.uid.slice(e.repo_key.length + 1)}`;
  const placed = placement(e, recs);
  // labeller and the prompt's rubric text are stamped from the index (the prompt says neither)
  // labeller, the prompt's rubric text and (F4) the model that ran it are stamped from the index
  if (labelLike(e)) for (const r of recs) Object.assign(r, { labeller: e.labeller }, e.rubric_sha256 ? { rubric_sha256: e.rubric_sha256 } : {}, e.model ? { model: e.model } : {});
  const problems = [...parseErrors, ...placed, ...validate(e, recs)];
  if (problems.length) {
    bad++;
    e.rejected = [...(e.rejected ?? []), { at: new Date().toISOString(), problems }];
    console.log(`${tag}: INVALID\n  ${problems.join("\n  ")}`);
    continue;
  }
  const out = dest(e);
  const text = recs.map((r) => JSON.stringify(strip(r))).join("\n") + "\n";
  if (existsSync(out) && readFileSync(out, "utf8") !== text && !args.force) {
    bad++;
    console.log(`${tag}: ${out} already collected with different content (final; --force to replace)`);
    continue;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  // The outbox is one fresh <uuid>/ dir per prompt (prompt.mjs); never remove anything else.
  if (/^[0-9a-f-]{36}$/.test(basename(dirname(e.output)))) rmSync(dirname(e.output), { recursive: true, force: true });
  else rmSync(e.output, { force: true });
  if (e.cwd && /^[0-9a-f-]{36}$/.test(basename(e.cwd))) rmSync(e.cwd, { recursive: true, force: true }); // empty: checked above
  e.collected = { at: new Date().toISOString(), dest: out, records: recs.length, sha256: createHash("sha256").update(text).digest("hex") };
  console.log(`${tag}: ok, ${recs.length} records -> ${out}`);
}
writeFileSync(join(args.run, "prompts", "index.json"), JSON.stringify(index, null, 2) + "\n");
// Loose files directly in an outbox root belong to no prompt: something wrote outside its own outbox.
for (const r of outboxRoots) {
  const loose = (listDir(r) ?? []).filter((f) => {
    try {
      return !statSync(join(r, f)).isDirectory();
    } catch {
      return false;
    }
  });
  if (loose.length) {
    bad++;
    console.log(`outbox root ${r}: ${loose.length} loose files that belong to no prompt (${names(loose)}): move them aside unread and record it`);
  }
}
// --complete: every repo of the run has complete label sets for the labellers in scope.
if (args.complete && (!args.stage || args.stage === "label")) {
  const gaps = labelSetGaps(args.run, queue, { labellers: args.labeller ? [args.labeller] : ["A", "B"] });
  for (const g of gaps) console.log(`INCOMPLETE ${describeGap(g)}`);
  if (gaps.length) bad++;
}
console.error(`collect: ${bad ? `${bad} problems` : "no problems"}${waiting ? `; ${waiting} waiting` : ""}`);
process.exit(bad ? 1 : 0);
