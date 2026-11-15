// Disagreements between labellers A and B, and the merge into final labels.
//
//   node eval/study/adjudicate.mjs --run DIR [--allow-missing]   # validate A and B, write adjudication/queue.json
//                                                                 # (--allow-missing: recorded in it, `allow_missing`)
//   node eval/study/adjudicate.mjs --run DIR --merge             # with labels/C, write final.jsonl
//   ... [--agreement FILE]                                       # agree.mjs's JSON (default <run>/agreement.json)
//
// Agreement comes first (README step 3): the queue is written only when agree.mjs's JSON records the sha256 of
// exactly the A and B labels being queued (lib.mjs labelSetSha256), so agreement is the figure of the labels C sees.
//   ... [--exclude-repos a,b --exclude-reason TEXT]              # leave whole repos out of adjudication and merge
//
// Excluding a repo (for example one whose labeller could not run): its proposals are left out of the missing-label
// check, the disagreements and final.jsonl, so they stay unlabelled and metrics.mjs counts them as WRONG (report the
// rates with and without them: metrics.mjs --exclude-repos, the same names). The exclusion is recorded in
// adjudication/queue.json (`excluded`: repos, uids, reason, date); --merge uses the recorded one, and refuses an
// --exclude-repos that differs from it. A reason is required; an unknown repo name is refused.
//
// Final label: A's label when A and B agree, otherwise C's. C sees both reviews, shuffled and anonymised
// (see ADJUDICATOR-PROMPT.md), and may choose any label.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkLabel, die, indexLabels, labelSetSha256, loadRun, memberFileInfo, parseArgs, readJson, readJsonlAll, shuffle, strip } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), { flags: ["merge", "allowMissing"] });
if (!args.run) die("usage: adjudicate.mjs --run DIR [--merge] [--allow-missing]");
const { run, queue, byUid } = loadRun(args.run);
const memberFiles = memberFileInfo(run, queue); // as collect.mjs validates
const otherMembers = new Map([...memberFiles].filter(([, i]) => i.bound !== null).map(([u, i]) => [u, i.bound]));
const rubric = args.rubric ?? "v2";

function load(L) {
  const recs = readJsonlAll(join(args.run, "labels", L));
  const problems = recs.flatMap((r) => checkLabel(r, { labeller: L, byUid, rubric, otherMembers, memberFiles }).map((p) => `${r._src}: ${p}`));
  if (problems.length) die(`labels ${L} fail validation:\n  ${problems.join("\n  ")}`);
  return indexLabels(recs, `labels/${L}`);
}

// ---- excluded repos (recorded in adjudication/queue.json) ----
const qPath = join(args.run, "adjudication", "queue.json");
const repoNames = new Set(queue.items.map((p) => p.repo).concat((run.repos ?? []).map((r) => r.name)));
const asked = args.excludeRepos ? [...new Set(String(args.excludeRepos).split(",").map((x) => x.trim()).filter(Boolean))].sort() : null;
if (asked) {
  const unknown = asked.filter((x) => !repoNames.has(x));
  if (unknown.length) die(`--exclude-repos names repos that are not in this run: ${unknown.join(", ")}`);
}
let excluded;
if (args.merge) {
  const rec = existsSync(qPath) ? readJson(qPath).excluded ?? null : null;
  const recRepos = rec?.repos ?? [];
  if (asked && JSON.stringify(asked) !== JSON.stringify(recRepos))
    die(`--exclude-repos ${asked.join(",")} differs from the exclusion recorded when the queue was written (${recRepos.join(",") || "none"}); rerun adjudicate.mjs without --merge to change it`);
  excluded = rec;
} else if (asked) {
  if (typeof args.excludeReason !== "string" || args.excludeReason.trim().length < 10) die("--exclude-repos needs --exclude-reason TEXT (why these repos are left out; recorded)");
  excluded = { repos: asked, uids: queue.items.filter((p) => asked.includes(p.repo)).map((p) => p.uid), reason: args.excludeReason.trim(), at: new Date().toISOString() };
} else excluded = null;
const isExcluded = (p) => Boolean(excluded?.repos.includes(p.repo));
const items = queue.items.filter((p) => !isExcluded(p));

const A = load("A");
const B = load("B");
// One rubric text per run: A and B (and C, at --merge) name the same one (collect.mjs stamps it), or none does.
const textsOf = (...Ms) => [...new Set(Ms.flatMap((M) => [...M.values()]).map((r) => r.rubric_sha256).filter(Boolean))];
const mixedText = (t, who) => t.length > 1 && die(`labels ${who} name ${t.length} rubric texts (${t.map((h) => h.slice(0, 12)).join(", ")}): one run uses one rubric text; start a new run`);
mixedText(textsOf(A, B), "A and B");
// Fingerprint of everything C will be shown (every field of every A and B record), checked again at --merge.
const prints = { A: labelSetSha256(A), B: labelSetSha256(B) };
const missing = items.filter((p) => !A.has(p.uid) || !B.has(p.uid)).map((p) => `${p.uid} (${[!A.has(p.uid) && "A", !B.has(p.uid) && "B"].filter(Boolean).join(", ")})`);
if (missing.length && !args.allowMissing) die(`${missing.length} proposals lack a label:\n  ${missing.join("\n  ")}`);

const cases = items
  .filter((p) => A.has(p.uid) && B.has(p.uid) && A.get(p.uid).label !== B.get(p.uid).label)
  .map((p) => ({ uid: p.uid, repo: p.repo, order: shuffle(["A", "B"], `adjudicate:${p.uid}`), reviews: { A: strip(A.get(p.uid)), B: strip(B.get(p.uid)) } }));

if (!args.merge) {
  const agPath = args.agreement ?? join(args.run, "agreement.json");
  if (!existsSync(agPath)) die(`no agreement at ${agPath}: run agree.mjs --run ${args.run} --json ${agPath} first (agreement is computed before adjudication, README step 3)`);
  const ag = readJson(agPath).labels_sha256 ?? {};
  if (ag.A !== prints.A || ag.B !== prints.B) die(`${agPath} is not the agreement of these A and B labels (its labels_sha256 ${ag.A ? "differs" : "is missing"}): rerun agree.mjs on them before writing the adjudication queue`);
  mkdirSync(join(args.run, "adjudication"), { recursive: true });
  writeFileSync(qPath, JSON.stringify({ labels_sha256: prints, ...(excluded ? { excluded } : {}), ...(missing.length ? { allow_missing: { uids: missing, at: new Date().toISOString() } } : {}), cases }, null, 2) + "\n");
  if (excluded) console.log(`excluded ${excluded.repos.join(", ")} (${excluded.uids.length} proposals, left unlabelled): ${excluded.reason}`);
  const both = items.filter((p) => A.has(p.uid) && B.has(p.uid)).length;
  console.log(`${both} proposals labelled by both; ${cases.length} disagreements written to ${qPath}`);
  for (const c of cases) console.log(`  ${c.uid}: A ${c.reviews.A.label}, B ${c.reviews.B.label}`);
  if (missing.length) console.log(`${missing.length} proposals still lack a label (--allow-missing)`);
  process.exit(0);
}

// ---- merge ----
if (!existsSync(qPath)) die("run without --merge first");
const savedQ = readJson(qPath);
const saved = savedQ.cases;
if (savedQ.labels_sha256?.A !== prints.A || savedQ.labels_sha256?.B !== prints.B)
  die("labels A/B changed (any field of any record) since the adjudication queue was written; rerun adjudicate.mjs and adjudicate the new cases");
const caseByUid = new Map(saved.map((c) => [c.uid, c]));
const cRecs = readJsonlAll(join(args.run, "labels", "C"));
const cProblems = cRecs.flatMap((r) => [
  ...checkLabel(r, { labeller: "C", byUid, rubric, otherMembers, memberFiles }).map((p) => `${r._src}: ${p}`),
  ...(caseByUid.has(r.uid) ? [] : [`${r._src}: ${r.uid} is not a disagreement`]),
  ...(["1", "2", "neither"].includes(String(r.sided_with)) ? [] : [`${r._src}: sided_with must be "1", "2" or "neither"`]),
  ...sidedProblems(r),
]);
// sided_with must agree with C's label: "1"/"2" means C chose that reviewer's label, "neither" a third label.
function sidedProblems(r) {
  const c = caseByUid.get(r.uid);
  if (!c || !["1", "2", "neither"].includes(String(r.sided_with))) return [];
  const shown = c.order.map((L) => c.reviews[L].label);
  if (String(r.sided_with) === "neither")
    return shown.includes(r.label) ? [`${r._src}: sided_with "neither" but ${r.label} is reviewer ${shown.indexOf(r.label) + 1}'s label`] : [];
  const want = shown[Number(r.sided_with) - 1];
  return r.label === want ? [] : [`${r._src}: sided_with "${r.sided_with}" but that reviewer said ${want}, C said ${r.label}`];
}
if (cProblems.length) die(`labels C fail validation:\n  ${cProblems.join("\n  ")}`);
const C = indexLabels(cRecs, "labels/C");
const open = saved.filter((c) => !C.has(c.uid));
if (open.length) die(`${open.length} disagreements are not adjudicated yet:\n  ${open.map((c) => c.uid).join("\n  ")}`);

// One rubric text: every A, B and C record names the same one (collect.mjs stamps it), or none does (older runs).
const texts = textsOf(A, B, C);
mixedText(texts, "A, B and C");
const final = [];
const sided = { A: 0, B: 0, neither: 0 };
for (const p of items) {
  const a = A.get(p.uid);
  const b = B.get(p.uid);
  if (!a || !b) continue;
  // F4: the models that labelled the item (collect.mjs stamps them), committed with the final labels
  const c0 = C.get(p.uid);
  const models = a.model || b.model || c0?.model ? { models: { A: a.model ?? null, B: b.model ?? null, C: a.label === b.label ? null : c0?.model ?? null } } : {};
  const base = { uid: p.uid, repo: p.repo, id: p.id, rubric: a.rubric ?? null, ...(texts.length ? { rubric_sha256: texts[0] } : {}), A: a.label, B: b.label, ...models };
  if (a.label === b.label) {
    final.push({ ...base, label: a.label, source: "agreed", C: null, sided_with: null, clear: a.clear && b.clear, trivial_by: a.trivial_by ?? null, wrong_because: a.wrong_because ?? null, reason: a.reason });
  } else {
    const c = C.get(p.uid);
    const who = c.sided_with === "neither" ? "neither" : caseByUid.get(p.uid).order[Number(c.sided_with) - 1];
    sided[who]++;
    final.push({ ...base, label: c.label, source: "adjudicated", C: c.label, sided_with: who, clear: c.clear, trivial_by: c.trivial_by ?? null, wrong_because: c.wrong_because ?? null, reason: c.reason });
  }
}
writeFileSync(join(args.run, "final.jsonl"), final.map((r) => JSON.stringify(r)).join("\n") + "\n");
if (excluded) console.log(`excluded ${excluded.repos.join(", ")} (${excluded.uids.length} proposals, not in final.jsonl): ${excluded.reason}`);
console.log(`${final.length} final labels written to ${join(args.run, "final.jsonl")} (${saved.length} adjudicated: C sided with A ${sided.A}, B ${sided.B}, neither ${sided.neither})`);
