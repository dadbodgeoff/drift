// The verifier's first D10.3 check on the relabel5 dev cards (eval/study/PLAN-PAR.md D10.3). Run from the checkout root.
//
//   node <run>/verifier.mjs render --payloads DIR --r6-cards FILE   (writes verifier/cards.jsonl)
//   python3 -I <run>/vrun.py --model <R6's small-model alias> --payloads DIR --out PRIVATE   (the samples)
//   SCRATCH=... <run>/decide.sh <worktree> <drift binary> PRIVATE      (the product decides: verifier/outcomes.jsonl)
//   node <run>/verifier.mjs score                                       (only once the lead says labelling is final)
//
// render: for every suggestion-tier card in census-json/ (the cards the product shows; the default tier is never
// verified [STRICT]), checks the payload the product's own MCP server built (`drift mcp`, drift_verify_card with only
// `id`, restage.sh; DIR/<repo>.json, outside the repository: payloads quote the repository) and records
// verifier/cards.jsonl: per card its id, content hash, the message's sha256, the excerpted members and the R6 tag, and
// no excerpt. A card is "tuned" when R6 developed the prompt on it (its uid is in R6's tune split, cards.jsonl), else
// "untuned"; `r6_split` also marks the cards of R6's frozen test split.
//
// The samples were first rendered as 582 agent prompts; at the lead's instruction they were withdrawn unlaunched and
// replaced by vrun.py, one headless call per sample with no tools, as R6 ran them (README, Deviations).
//
// score: verifier/outcomes.jsonl (the product's decide(), via MCP) joined with <part>/final.jsonl labels.
// Writes verifier/score.{json,md}. Never metrics.json: under a run, that name is metrics.mjs --json output, which
// the Studio's Studies view and family-admission.mjs read from every directory of the run.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase())] = rest[i + 1];
const die = (m) => {
  console.error(m);
  process.exit(1);
};
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const PROMPT_SHA = "8298c26d06be051afa59585b136e4d0f122039bdbe67848097656cc28792ee1d";
const PARTS = { ts: "eval/repos.json", py: "eval/repos-py.json", py2: "eval/repos-py-2.json" };
const partOf = () => {
  const m = new Map();
  for (const part of Object.keys(PARTS)) for (const r of readJson(join(here, part, "run.json")).repos) m.set(r.name, part);
  return m;
};
const V = join(here, "verifier");

if (cmd === "render") {
  for (const k of ["payloads", "r6Cards"]) if (!args[k]) die(`--${k} is required`);
  const r6 = new Map(readJsonl(args.r6Cards).map((c) => [c.uid, c.split]));
  const parts = partOf();
  const cards = [];
  for (const f of readdirSync(join(here, "census-json")).sort()) {
    const repo = f.replace(/\.json$/, "");
    const census = readJson(join(here, "census-json", f));
    const sugg = census.proposals.filter((p) => p.tier === "suggestion");
    if (!sugg.length) continue;
    const pf = join(args.payloads, f);
    const pay = existsSync(pf) ? readJson(pf) : {};
    for (const p of sugg) {
      const uid = `${repo}/${p.id}`;
      const y = pay[p.id];
      const split = r6.get(uid) ?? null;
      const base = { uid, repo, part: parts.get(repo), id: p.id, language: p.language, rule_kind: p.rule_kind, family: p.agents?.family ?? null, family_admitted: p.agents?.shown_to_agents === true, tuned: split === "tune", r6_split: split };
      if (!y || !y.message) {
        cards.push({ ...base, payload: null, payload_error: y?.error ?? y?.text ?? "no payload" });
        continue;
      }
      if (sha(y.system_prompt) !== PROMPT_SHA) die(`${uid}: the payload's system prompt is not the frozen v3`);
      if (y.outliers_total !== p.outliers_total) die(`${uid}: payload lists ${y.outliers_total} outliers, census ${p.outliers_total}`);
      cards.push({ ...base, payload: { content_hash: y.content_hash, prompt_version: y.prompt_version, message_sha256: sha(y.message), message_chars: y.message.length, holders: y.holders, outliers: y.outliers, outliers_total: y.outliers_total } });
    }
  }
  mkdirSync(V, { recursive: true });
  writeFileSync(join(V, "cards.jsonl"), cards.map((c) => JSON.stringify(c)).join("\n") + "\n");
  const n = cards.filter((c) => c.payload).length;
  console.log(`${cards.length} suggestion-tier cards, ${n} with payloads (${cards.filter((c) => c.payload && !c.tuned).length} untuned, ${cards.filter((c) => c.payload && c.tuned).length} tuned)`);
} else if (cmd === "score") {
  const cards = readJsonl(join(V, "cards.jsonl"));
  const out = new Map(readJsonl(join(V, "outcomes.jsonl")).map((o) => [o.uid, o]));
  const labels = new Map();
  for (const part of Object.keys(PARTS)) for (const f of readJsonl(join(here, part, "final.jsonl"))) labels.set(f.uid, f.label);
  const wilson = (k, n) => {
    if (!n) return [null, null];
    const z = 1.959964, p = k / n, d = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [c - h, c + h];
  };
  const rate = (k, n) => ({ k, n, rate: n ? k / n : null, wilson95: wilson(k, n) });
  const rows = cards.map((c) => ({ ...c, label: labels.get(c.uid) ?? null, pass: out.get(c.uid)?.pass ?? false, outcome: out.get(c.uid) ?? null }));
  const unl = rows.filter((r) => !r.label);
  if (unl.length) die(`${unl.length} verifier cards have no final label, e.g. ${unl[0].uid}`);
  const sets = {
    untuned: (r) => !r.tuned,
    tuned: (r) => r.tuned,
    "r6_unseen (stricter: in neither R6 split)": (r) => !r.r6_split,
    all: () => true,
  };
  const lang = { all: () => true, ts: (r) => r.part === "ts", python: (r) => r.part !== "ts" };
  const res = {};
  for (const [sn, sf] of Object.entries(sets))
    for (const [ln, lf] of Object.entries(lang)) {
      const s = rows.filter((r) => sf(r) && lf(r));
      const passed = s.filter((r) => r.pass);
      const acc = s.filter((r) => r.label === "ACCEPT");
      res[`${sn} / ${ln}`] = {
        cards: s.length,
        no_payload: s.filter((r) => !r.payload).length,
        passed: passed.length,
        passed_precision: rate(passed.filter((r) => r.label === "ACCEPT").length, passed.length),
        coverage: rate(passed.length, s.length),
        accept_kept: rate(acc.filter((r) => r.pass).length, acc.length),
        base_accept: rate(acc.length, s.length),
      };
    }
  const prim = res["untuned / all"].passed_precision;
  const summary = { primary: "passed-card precision on untuned cards (target >= 90%, point estimate; Wilson 95% reported)", primary_value: prim, met: prim.n ? prim.rate >= 0.9 : null, lower_bound_ge_90: prim.n ? prim.wilson95[0] >= 0.9 : null, sets: res, false_passes: rows.filter((r) => r.pass && r.label !== "ACCEPT").map((r) => ({ uid: r.uid, label: r.label, tuned: r.tuned, passes: r.outcome?.passes })) };
  writeFileSync(join(V, "score.json"), JSON.stringify(summary, null, 2) + "\n");
  const pc = (x) => (x.rate == null ? "n/a" : `${(100 * x.rate).toFixed(1)}% (${x.k}/${x.n}; Wilson ${(100 * x.wilson95[0]).toFixed(0)}-${(100 * x.wilson95[1]).toFixed(0)})`);
  const lines = ["| Set | Cards | Passed | Passed-card precision | Coverage | ACCEPT kept |", "|---|---|---|---|---|---|"];
  for (const [k, v] of Object.entries(res)) lines.push(`| ${k} | ${v.cards} | ${v.passed} | ${pc(v.passed_precision)} | ${pc(v.coverage)} | ${pc(v.accept_kept)} |`);
  writeFileSync(join(V, "score.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
} else die("usage: verifier.mjs render|score ...");
