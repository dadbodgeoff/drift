// Recall against the conventions each repository documents itself.
//
//   node eval/study/recall.mjs sources --run DIR [--repo NAME]   # candidate doc and lint files, per repo
//   node eval/study/recall.mjs score   --run DIR [--labels FILE] [--json OUT]
//
// Pipeline (see README.md):
//   1. `sources` lists the files an extractor should read
//      -> recall/sources/<repo>.json
//   2. extractor agents (EXTRACT-PROMPT.md) write the documented conventions
//      -> recall/docs/<repo>.jsonl
//   3. matcher agents (MATCH-PROMPT.md) judge, per documented item, whether a shown proposal (and a pool
//      proposal) states it, and whether the code follows it
//      -> recall/matches/<repo>.jsonl
//   4. `score` reports recall per repo, per source and per category, and cross-checks precision labels
//      against the repo's own policy.
//
// Denominator: documented items with enabled !== false and code_checkable === true.
//   recall@shown   matched by a proposal the user is shown (census --max)
//   recall@pool    matched by any proposal of the deeper census (--pool): misses here are mining misses,
//                  misses only at @shown are ranking misses
//   strict = FULL, lenient = FULL + PARTIAL; "followed" restricts to items the code follows (yes|mostly),
//   i.e. what can be learned from the code at all.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MATCH, ci, clusterBootstrap, cohen, die, loadRun, parseArgs, pct, readJsonl, readJsonlAll, table, uidOf, wilson } from "./lib.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (!["sources", "score"].includes(cmd) || !args.run) die("usage: recall.mjs sources|score --run DIR");
const { run, queue } = loadRun(args.run);
const okRepos = run.repos.filter((r) => r.status === "ok" && (!args.repo || r.name === args.repo));

// ---------- sources ----------

const DOC = /(^|\/)(AGENTS|CLAUDE|GEMINI|CONTRIBUTING|CONVENTIONS|STYLEGUIDE|STYLE_GUIDE|STYLE-GUIDE|CODING_GUIDELINES|CODE_STYLE|ARCHITECTURE)\.mdx?$/i;
const AGENT_RULES = /(^|\/)(\.cursorrules|\.windsurfrules|\.clinerules|\.github\/copilot-instructions\.md)$|(^|\/)(\.cursor\/rules|\.clinerules|\.github\/instructions|\.agents|\.claude\/rules)\/.+\.(mdc?|txt)$/i;
const DOCS_DIR = /(^|\/)docs?\/(.*\/)?[^/]*(convention|guideline|style-?guide|coding|contribut|standards|best-practice)[^/]*\.mdx?$/i;
const LINT = /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.(js|cjs|json|ya?ml))?|\.oxlintrc\.json|oxlint\.json|biome\.jsonc?|\.?ruff\.toml|\.flake8|\.pylintrc|pylintrc|mypy\.ini|\.importlinter|\.semgrep\.ya?ml|\.semgrep\/.+\.ya?ml)$/;
// pyproject.toml / setup.cfg / tox.ini count as lint config only when they configure a linter.
const PY_LINT_HOST = /(^|\/)(pyproject\.toml|setup\.cfg|tox\.ini)$/;
const PY_LINT_SECTION = /^\[(tool\.)?(ruff|flake8|pylint|mypy|importlinter|isort)[\].:]/m;
const CUSTOM = /(^|\/)[^/]*(eslint|oxlint|biome|lint)-(rules?|plugins?)[^/]*\/|(^|\/)eslint-plugin-[^/]+\//;
const CUSTOM_DIR = /^(.*?(?:^|\/)(?:[^/]*(?:eslint|oxlint|biome|lint)-(?:rules?|plugins?)[^/]*|eslint-plugin-[^/]+)\/)/;
const SKIP = /(^|\/)(node_modules|vendor|third[_-]party|fixtures?|__fixtures__|__tests__|test-fixtures|testdata)\//;
const EXAMPLES = /(^|\/)(examples?|templates?|app-template|playground|samples?|demo)\//;
// Translated copies of docs (docs/fr/..., i18n/ja/...): the source language copy is enough.
const LOCALE = /(^|\/)(ar|bg|ca|cs|da|de|el|es|et|fa|fi|fr|he|hi|hr|hu|id|it|ja|ko|lt|lv|nl|no|pl|pt|pt-br|pt-BR|ro|ru|sk|sl|sr|sv|th|tr|uk|vi|zh|zh-cn|zh-CN|zh-hans|zh-Hans|zh-tw|zh-TW|zh-hant)\/(.*\/)?[^/]+\.mdx?$/;
// Agent skills: only their SKILL.md (the extractor follows references from there).
const SKILLS = /(^|\/)\.(agents|claude|cursor|codex)\/skills\//;

function sources(repo) {
  const files = execFileSync("git", ["-C", repo.checkout, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean);
  const out = [];
  const lint = [];
  const custom = new Set();
  for (const f of files) {
    if (SKIP.test(f) || EXAMPLES.test(f) || LOCALE.test(f)) continue;
    if (SKILLS.test(f)) {
      if (/(^|\/)SKILL\.md$/.test(f)) out.push({ path: f, kind: "agent_skill" });
      continue;
    }
    if (DOC.test(f)) out.push({ path: f, kind: "doc" });
    else if (AGENT_RULES.test(f)) out.push({ path: f, kind: "agent_rules" });
    else if (DOCS_DIR.test(f)) out.push({ path: f, kind: "doc" });
    else if (LINT.test(f)) lint.push(f);
    else if (CUSTOM.test(f) && /\.[cm]?[jt]s$/.test(f) && !/\.(test|spec)\./.test(f)) custom.add(f.match(CUSTOM_DIR)?.[1] ?? f);
    else if (PY_LINT_HOST.test(f) && f.split("/").length <= 3) {
      try {
        if (PY_LINT_SECTION.test(readFileSync(join(repo.checkout, f), "utf8"))) out.push({ path: f, kind: "lint (python config sections)" });
      } catch {}
    } else if (/(^|\/)package\.json$/.test(f) && f.split("/").length <= 3) {
      try {
        if (JSON.parse(readFileSync(join(repo.checkout, f), "utf8")).eslintConfig) out.push({ path: f, kind: "lint (package.json eslintConfig)" });
      } catch {}
    }
  }
  // Many generated per-package lint configs (one per plugin package, say) are collapsed to the shallow ones.
  const byName = new Map();
  for (const f of lint) byName.set(f.split("/").pop(), [...(byName.get(f.split("/").pop()) ?? []), f]);
  for (const [name, fs] of byName) {
    if (fs.length <= 12) fs.forEach((f) => out.push({ path: f, kind: "lint" }));
    else {
      const shallow = fs.filter((f) => f.split("/").length <= 3);
      shallow.forEach((f) => out.push({ path: f, kind: "lint" }));
      if (fs.length > shallow.length)
        out.push({ path: `${fs.length - shallow.length} more ${name} files, e.g. ${fs.filter((f) => !shallow.includes(f)).slice(0, 3).join(", ")}`, kind: "lint (collapsed: read one or two)" });
    }
  }
  for (const d of custom) out.push({ path: d, kind: "lint_custom (custom rule implementations)" });
  return out;
}

if (cmd === "sources") {
  mkdirSync(join(args.run, "recall", "sources"), { recursive: true });
  for (const r of okRepos) {
    const files = sources(r);
    writeFileSync(join(args.run, "recall", "sources", `${r.name}.json`), JSON.stringify({ repo: r.name, files }, null, 2) + "\n");
    const c = {};
    for (const f of files) c[f.kind.split(" ")[0]] = (c[f.kind.split(" ")[0]] ?? 0) + 1;
    console.log(`${r.name}: ${files.length} sources (${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`);
  }
  process.exit(0);
}

// ---------- score ----------

const isLint = (d) => /^lint/.test(d.source_kind ?? "");
const inScope = (d) => d.enabled !== false && d.code_checkable === true;
const followed = (m) => m.followed === "yes" || m.followed === "mostly";
const notExtracted = [];
const notMatched = [];
const rows = [];
const problems = [];
for (const r of okRepos) {
  const dPath = join(args.run, "recall", "docs", `${r.name}.jsonl`);
  const mPath = join(args.run, "recall", "matches", `${r.name}.jsonl`);
  if (!existsSync(dPath)) {
    notExtracted.push(r.name);
    continue;
  }
  const docs = readJsonl(dPath).filter(inScope);
  if (docs.length && !existsSync(mPath)) {
    notMatched.push(r.name);
    continue;
  }
  const matches = docs.length ? new Map(readJsonl(mPath).map((m) => [m.ref, m])) : new Map();
  for (const d of docs) {
    const m = matches.get(d.ref);
    if (!m) {
      problems.push(`${r.name}: ${d.ref} has no match record`);
      continue;
    }
    rows.push({ repo: r.name, ...d, m });
  }
}
if (problems.length) die(`incomplete matches:\n  ${problems.join("\n  ")}`);

const level = (x) => MATCH.indexOf(x); // 0 FULL, 1 PARTIAL, 2 NONE
function rec(items) {
  const n = items.length;
  const k = (f) => items.filter(f).length;
  return {
    n,
    shown_strict: wilson(k((x) => level(x.m.match) === 0), n),
    shown_lenient: wilson(k((x) => level(x.m.match) <= 1), n),
    pool_strict: wilson(k((x) => level(x.m.pool_match) === 0), n),
    pool_lenient: wilson(k((x) => level(x.m.pool_match) <= 1), n),
  };
}
function pooledRec(items) {
  const s = rec(items);
  for (const key of ["shown_strict", "shown_lenient", "pool_strict", "pool_lenient"]) {
    s[key].boot = clusterBootstrap(okRepos.map((r) => rec(items.filter((x) => x.repo === r.name))[key]).map((w) => ({ k: w.k, n: w.n })));
  }
  return s;
}
const all = pooledRec(rows);
const fol = pooledRec(rows.filter((x) => followed(x.m)));
const bySource = { lint: rec(rows.filter(isLint)), prose: rec(rows.filter((x) => !isLint(x))) };
const cats = [...new Set(rows.map((x) => x.category))].sort().map((c) => ({ category: c, ...rec(rows.filter((x) => x.category === c)) }));
const repos = okRepos.filter((r) => !notExtracted.includes(r.name) && !notMatched.includes(r.name)).map((r) => ({ name: r.name, ...rec(rows.filter((x) => x.repo === r.name)), followed: rows.filter((x) => x.repo === r.name && followed(x.m)).length }));

// Cross-check precision labels against the repo's own policy.
const labelsPath = args.labels ?? join(args.run, "final.jsonl");
if (args.labels && !existsSync(labelsPath)) die(`no labels at ${labelsPath}`);
const labels = existsSync(labelsPath) ? new Map(readJsonlAll(labelsPath).map((l) => [uidOf(l), l])) : null;
const corroborated = new Map(); // uid -> [refs]
for (const x of rows)
  if (level(x.m.match) <= 1) for (const id of x.m.proposals ?? []) corroborated.set(`${x.repo}/${id}`, [...(corroborated.get(`${x.repo}/${id}`) ?? []), x.ref]);
const scored = new Set(repos.map((r) => r.name));
const shownScored = queue.items.filter((p) => scored.has(p.repo));
let cross = null;
if (labels) {
  const mix = (ps) => ({ n: ps.length, ACCEPT: ps.filter((p) => labels.get(p.uid)?.label === "ACCEPT").length, TRIVIAL: ps.filter((p) => labels.get(p.uid)?.label === "TRIVIAL").length, WRONG: ps.filter((p) => labels.get(p.uid)?.label === "WRONG").length });
  cross = {
    documented: mix(shownScored.filter((p) => corroborated.has(p.uid))),
    undocumented: mix(shownScored.filter((p) => !corroborated.has(p.uid))),
    conflicts: shownScored.filter((p) => corroborated.has(p.uid) && labels.get(p.uid)?.label === "WRONG").map((p) => ({ uid: p.uid, refs: corroborated.get(p.uid), reason: labels.get(p.uid).reason })),
  };
}

// Second matcher agreement, if present.
let m2 = null;
const m2pairs = [];
for (const x of rows) {
  const p = join(args.run, "recall", "matches-M2", `${x.repo}.jsonl`);
  if (!existsSync(p)) continue;
  const o = readJsonl(p).find((m) => m.ref === x.ref);
  if (o) m2pairs.push([x.m.match, o.match]);
}
if (m2pairs.length) m2 = cohen(m2pairs, MATCH);
// Second extractor: item counts only (items are free text; overlap is judged by reading both lists).
const e2 = okRepos
  .filter((r) => existsSync(join(args.run, "recall", "docs-E2", `${r.name}.jsonl`)))
  .map((r) => ({ repo: r.name, E1: rows.filter((x) => x.repo === r.name).length, E2: readJsonl(join(args.run, "recall", "docs-E2", `${r.name}.jsonl`)).filter(inScope).length }));

const R = (w) => `${ci(w)}${w.boot ? ` (repo bootstrap ${pct(w.boot.lo)}–${pct(w.boot.hi)})` : ""}`;
const out = [`# Recall against documented conventions: ${run.run}`, ""];
out.push(`- ${rows.length} documented, code-checkable, enabled items in ${repos.length} repos${notExtracted.length ? `; not extracted yet: ${notExtracted.join(", ")}` : ""}${notMatched.length ? `; not matched yet: ${notMatched.join(", ")}` : ""}`);
out.push("");
out.push(
  table(
    ["", "Items", "Recall@shown strict", "Recall@shown lenient", "Recall@pool strict", "Recall@pool lenient"],
    [
      ["All documented", all],
      ["Followed by the code", fol],
      ["From lint configs", bySource.lint],
      ["From prose (AGENTS.md, CONTRIBUTING...)", bySource.prose],
    ].map(([n, s]) => [n, s.n, R(s.shown_strict), R(s.shown_lenient), R(s.pool_strict), R(s.pool_lenient)]),
  ),
);
out.push("");
out.push("## Per repo");
out.push("");
out.push(table(["Repo", "Items", "Followed", "@shown strict", "@shown lenient", "@pool lenient"], repos.map((r) => [r.name, r.n, r.followed, ci(r.shown_strict), ci(r.shown_lenient), ci(r.pool_lenient)])));
out.push("");
out.push("## Per category");
out.push("");
out.push(table(["Category", "Items", "@shown lenient", "@pool lenient"], cats.map((c) => [c.category, c.n, ci(c.shown_lenient), ci(c.pool_lenient)])));
if (cross) {
  out.push("");
  out.push("## Precision labels against the repo's own policy");
  out.push("");
  out.push(table(["Shown proposals", "n", "ACCEPT", "TRIVIAL", "WRONG"], [["Match a documented convention", cross.documented], ["No documented counterpart", cross.undocumented]].map(([n, m]) => [n, m.n, m.ACCEPT, m.TRIVIAL, m.WRONG])));
  if (cross.conflicts.length) {
    out.push("");
    out.push("Labelled WRONG although the repo documents the convention (check the label, the match, or whether the doc is stale):");
    for (const c of cross.conflicts) out.push(`- ${c.uid} (${c.refs.join(", ")}): ${c.reason}`);
  }
}
if (m2) out.push("", `Second matcher on ${m2.n} items: agreement ${pct(m2.po)}, κ ${m2.kappa.toFixed(2)}`);
if (e2.length) out.push("", `Second extractor (in-scope items, E1/E2): ${e2.map((x) => `${x.repo} ${x.E1}/${x.E2}`).join(", ")}`);
console.log(out.join("\n"));
if (args.json) writeFileSync(args.json, JSON.stringify({ run: run.run, overall: all, followed: fol, by_source: bySource, categories: cats, repos, cross, m2, e2, not_extracted: notExtracted, not_matched: notMatched }, null, 2) + "\n");
