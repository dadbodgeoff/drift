#!/usr/bin/env node
// The WS-G semantic check as a study harness, with no product code (lead decision on #139: nothing was admitted, so
// the product wiring was reverted; the implementation is at 99631796). It builds each card's payload from a census's
// own JSON and the checkout's files, runs the frozen prompt sem-v1 3 times per card on the headless CLI, and decides
// per member (2 of 3), as the reverted `drift_mine::semantic` did:
//
//   node eval/study/semantic/harness.mjs --census <census --json file> --root <checkout> --facts <scan --out file>
//        --repo <name> --model <alias> --out <dir> [--ids D-1,D-2] [--dry-run]
//
// It writes <out>/cards.jsonl, samples.jsonl and outcomes.jsonl in the shapes research/2026-11-08/sem11-score.mjs
// reads (its matchVerdicts, cardFlagEffect, admitFlags and kappa are pure and take any labels). It reads no label.
//
// Payload (harness v1). The card as `drift census` prints it (rank, tier and agents lines left out, at most 30
// outliers), then M1 = the example, then the first 12 outliers in (path, line, symbol) order, each excerpted (lines
// -3..+15, 160 characters a line). Two differences from the product payload the sem11 offline run used: no two extra
// holders (the census JSON does not list holders), and no exempt lines (it does not list them either).
//
// Protection [STRICT], structural, decided before any reply is read: a member is never set apart when the card's role
// is an entry role, when its file declares any entry point (the scan's facts), or when its file is not in the facts.
// This is stricter than the product's `protected`, which needs a guard rule to protect a non-entry member of a file
// with entry points.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const PROMPT_FILE = join(here, "semantic-prompt-v1.txt");
export const PROMPT_VERSION = "sem-v1";
export const PROMPT_SHA256 = "95ec1162366afdd669cf56739418f7cd34c0bb2130093c938e40ee0c62991752";
// sha256 of the frozen model's identifier (the verifier's small model); the identifier is never written here.
export const MODEL_SHA256 = "26f6cf65acbd60862113d9e31ae957c4adf5fb966ae79f33a6fa8ac45e228e41";
// Asked of the host; the headless CLI has no temperature option (see sem11-findings.md, determinism).
export const TEMPERATURE = 0;
export const SAMPLES = 3;
export const JUDGED_OUTLIERS = 12;
const CARD_OUTLIERS = 30;
const BEFORE = 3, AFTER = 15, LINE_CAP = 160;
export const KINDS = ["same", "other"];
export const FLAGS = ["mistake", "look", "legit", "not_violation", "one_off"];
const REAL = new Set(["mistake", "look"]);

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export function prompt() {
  const p = readFileSync(PROMPT_FILE, "utf8");
  if (sha256(p) !== PROMPT_SHA256) throw new Error(`${PROMPT_FILE}: not the frozen sem-v1 (sha256 differs)`);
  return p;
}

// ---------- payload ----------

const fix = (x, d) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d);
// The card as `drift census` prints a proposal, as the verifier's and the reverted semantic payload showed it.
export function cardBlock(p) {
  const e = p.evidence;
  const ex = typeof p.example === "object" ? `${p.example.path}#${p.example.symbol}` : p.example;
  const L = [`[${p.id}] ${p.summary}`, `    evidence: ${e.holders}/${e.total} (lower bound ${fix(e.lower_bound, 2)}, lift ${fix(e.lift, 1)})${p.blockable === false ? "  [advise only: small role]" : ""}`];
  if (e.split?.length) L.push(`    split:    ${e.split.map(([w, n]) => `${w.split("#").pop()} ${n}`).join(", ")}`);
  L.push(`    example:  ${ex}`);
  const outs = sortedOutliers(p);
  for (const o of outs.slice(0, CARD_OUTLIERS)) L.push(`    outlier:  ${o.path}:${o.line} ${o.symbol}`);
  if (outs.length > CARD_OUTLIERS) L.push(`    … and ${outs.length - CARD_OUTLIERS} more outliers`);
  return L.join("\n");
}
export const sortedOutliers = (p) => [...(p.outliers ?? [])].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)));

export function excerpt(read, rel, line) {
  const text = read(rel);
  if (text == null) return "(file not readable)";
  const lines = text.split("\n");
  const ln = Math.max(1, line);
  const lo = Math.max(1, ln - BEFORE), hi = Math.min(lines.length, ln + AFTER);
  const out = [];
  for (let i = lo; i <= hi; i++) {
    const t = [...lines[i - 1]];
    out.push(`${String(i).padStart(5)}  ${t.length > LINE_CAP ? `${t.slice(0, LINE_CAP).join("")} …` : lines[i - 1]}`);
  }
  return out.join("\n");
}

// [STRICT] The structural invariant: never set apart a reachable entry point (see the header).
export function isProtected(p, member, entryFiles) {
  if (p.role?.entry && p.role.entry !== "-") return true; // mutation:protect-role
  if (!entryFiles.has(member.path)) return true; // mutation:protect-unknown
  return entryFiles.get(member.path) > 0; // mutation:protect-file
}

// entryFiles: Map path -> number of entry points (from `drift scan --out`'s facts).
export function entryFilesOf(facts) {
  return new Map((facts.files ?? []).map((f) => [f.path, (f.entry_points ?? []).length]));
}

export function buildPayload(p, repo, read, entryFiles, system = prompt()) {
  const ex = typeof p.example === "object" ? p.example : { path: String(p.example).split("#")[0], symbol: String(p.example).split("#")[1] ?? "", line: 1 };
  const judged = sortedOutliers(p).slice(0, JUDGED_OUTLIERS);
  const members = [{ path: ex.path, symbol: ex.symbol, line: ex.line ?? 1, flagged: false, protected: false }, ...judged.map((o) => ({ path: o.path, symbol: o.symbol, line: o.line, flagged: true, protected: isProtected(p, o, entryFiles) }))].map((m) => ({ ...m, key: `${m.path}#${m.symbol}` }));
  const blocks = members.map((m, i) => `\`\`\`text\n### M${i + 1} (${m.flagged ? "breaks" : "follows"}${i === 0 ? ", the example" : ""}): ${m.path}:${m.line} ${m.symbol}\n${excerpt(read, m.path, m.line)}\n\`\`\``);
  const n = members.length, f = judged.length;
  const message = `Repository: ${repo}\n\n## The card (as the tool prints it)\n\`\`\`text\n${cardBlock(p)}\n\`\`\`\n\n## Members (${n} in all: ${n - f} that follow the rule, then ${f} of the ${(p.outliers ?? []).length} outliers)\n${blocks.join("\n\n")}\n\nReply with ${n} entries in "kinds" and ${f} in "outliers".`;
  const content_hash = sha256(["drift-semantic-study", PROMPT_VERSION, system, message, ...members.map((m) => `${m.key}\0${m.flagged}\0${m.protected}`)].join("\0"));
  return { id: p.id, uid: `${repo}/${p.id}`, repo, prompt_version: PROMPT_VERSION, prompt_sha256: sha256(system), temperature: TEMPERATURE, samples: SAMPLES, system_prompt: system, message, members, outliers_total: (p.outliers ?? []).length, content_hash };
}

// ---------- replies and the decision ----------

// A reply's JSON object (or the text holding one, first `{` to last `}`), with one kind per member and one verdict per
// flag; anything else is null (the card then gets no decision: fails closed).
export function parseSample(raw, n, f) {
  let o = raw;
  if (typeof raw === "string") {
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { o = JSON.parse(raw.slice(a, b + 1)); } catch { return null; }
  }
  if (!o || typeof o !== "object" || !Array.isArray(o.kinds) || !Array.isArray(o.outliers)) return null;
  if (o.kinds.length !== n || o.outliers.length !== f) return null;
  if (!o.kinds.every((k) => KINDS.includes(k)) || !o.outliers.every((v) => FLAGS.includes(v))) return null;
  return { kinds: o.kinds, outliers: o.outliers, why: typeof o.why === "string" ? o.why.slice(0, 400) : undefined };
}

const majority = (xs) => {
  const n = new Map();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  const top = [...n].find(([, k]) => 2 * k > xs.length);
  return { value: top ? top[0] : null, unanimous: n.size === 1 };
};

// The frozen decision (drift_mine::semantic::decide at 99631796): exactly 3 samples; per member the majority; a flag is
// set apart when it is not protected and a majority says `other`, or gives it legit / not_violation / one_off.
export function decide(members, samples) {
  if (samples.length !== SAMPLES) throw new Error(`expected ${SAMPLES} samples, got ${samples.length}`);
  const nf = members.filter((m) => m.flagged).length;
  for (const s of samples) if (s.kinds.length !== members.length || s.outliers.length !== nf) throw new Error("a reply does not match the payload's members");
  let fi = 0;
  const out = members.map((m, i) => {
    const k = majority(samples.map((s) => s.kinds[i]));
    const f = m.flagged ? majority(samples.map((s) => s.outliers[fi])) : { value: null, unanimous: true };
    if (m.flagged) fi++;
    const setApart = m.flagged && !m.protected && (k.value === "other" || (f.value != null && !REAL.has(f.value))); // mutation:decide-protected
    return { member: m.key, line: m.line, flagged: m.flagged, protected: m.protected, kind: k.value, flag: f.value, unanimous: k.unanimous && f.unanimous, set_apart: setApart };
  });
  const flags = out.filter((m) => m.flagged);
  const holdersSame = out.filter((m) => !m.flagged).every((m) => m.kind === "same");
  const nv = flags.filter((m) => m.flag === "not_violation").length;
  const counted = flags.filter((m) => m.flag !== "not_violation" && m.flag !== "one_off");
  const real = counted.filter((m) => REAL.has(m.flag) && m.kind === "same").length;
  const set_apart = out.filter((m) => m.set_apart).map((m) => m.member);
  return { members: out, set_apart, judged: flags.length, kept: flags.length - set_apart.length, card_pass: holdersSame && 2 * nv <= flags.length && (counted.length === 0 || 2 * real > counted.length) };
}

// ---------- the model calls ----------

// One sample: a fresh headless CLI process, no tools, no MCP, no settings, no persistence, in an empty directory.
export function cliCall(model, system, user, cwd) {
  return new Promise((done) => {
    const t0 = Date.now();
    const p = spawn("claude", ["-p", "--model", model, "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--setting-sources", "", "--system-prompt", system, "--output-format", "json"], { cwd });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), 300000);
    p.on("close", (code) => {
      clearTimeout(timer);
      const r = { exit: code, wall_ms: Date.now() - t0 };
      try {
        const j = JSON.parse(out);
        const u = j.usage ?? {};
        Object.assign(r, { raw: j.result, is_error: j.is_error, cost_usd: j.total_cost_usd, tokens: { input_tokens: u.input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens, cache_read_input_tokens: u.cache_read_input_tokens, output_tokens: u.output_tokens }, models_used: Object.keys(j.modelUsage ?? {}).sort() });
      } catch {
        r.error = (out + err).slice(-500);
      }
      done(r);
    });
    p.stdin.end(user);
  });
}

// Run every payload: 3 samples each, one retry for a reply that does not parse, at most `jobs` calls at once. `call`
// is injectable (tests). Returns { cards, samples, outcomes }; a card whose model is not the frozen one, or with a
// reply that never parsed, gets no outcome [STRICT].
export async function runAll(payloads, { model, call = cliCall, jobs = 3, cwd }) {
  const tasks = payloads.flatMap((y) => [0, 1, 2].map((s) => ({ y, s })));
  const res = new Map();
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      const n = t.y.members.length, f = t.y.members.filter((m) => m.flagged).length;
      const attempts = [];
      for (let a = 0; a < 2; a++) {
        const r = await call(model, t.y.system_prompt, t.y.message, cwd);
        attempts.push(r);
        if (r.exit === 0 && !r.is_error && parseSample(r.raw, n, f)) break;
      }
      res.set(`${t.y.uid}#${t.s}`, attempts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, 3) }, worker));
  const cards = [], samples = [], outcomes = [];
  for (const y of payloads) {
    const n = y.members.length, f = y.members.filter((m) => m.flagged).length;
    const parsed = [], models = new Set();
    let calls = 0;
    for (let s = 0; s < SAMPLES; s++) {
      const att = res.get(`${y.uid}#${s}`);
      calls += att.length;
      for (const a of att) for (const m of a.models_used ?? []) models.add(m);
      const last = att[att.length - 1];
      const tok = {};
      for (const a of att) for (const [k, v] of Object.entries(a.tokens ?? {})) tok[k] = (tok[k] ?? 0) + (v ?? 0);
      const p = parseSample(last.raw, n, f);
      parsed.push(p);
      samples.push({ uid: y.uid, sample: s, content_hash: y.content_hash, ok: !!p, attempts: att.length, reply: last.raw ?? null, tokens: tok, cost_usd: att.reduce((x, a) => x + (a.cost_usd ?? 0), 0), wall_ms: att.reduce((x, a) => x + (a.wall_ms ?? 0), 0) });
    }
    const modelOk = models.size === 1 && sha256([...models][0]) === MODEL_SHA256; // mutation:model
    cards.push({ uid: y.uid, repo: y.repo, id: y.id, content_hash: y.content_hash, prompt_sha256: y.prompt_sha256, message_sha256: sha256(y.message), message_chars: y.message.length, members: y.members, outliers_total: y.outliers_total, listed_outlier_symbols: sortedOutliers({ outliers: y.listedOutliers ?? [] }).map((o) => o.symbol), calls });
    if (!modelOk) outcomes.push({ uid: y.uid, error: "the replies are not all from the frozen model" });
    else if (parsed.some((p) => !p)) outcomes.push({ uid: y.uid, error: "a reply did not parse" });
    else outcomes.push({ uid: y.uid, id: y.id, content_hash: y.content_hash, ...decide(y.members, parsed) });
  }
  return { cards, samples, outcomes };
}

// ---------- CLI ----------

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument ${argv[i]}`);
    const k = argv[i].slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (k === "dryRun") a.dryRun = true;
    else a[k] = argv[++i];
  }
  return a;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const a = args(process.argv.slice(2));
  for (const k of ["census", "root", "facts", "repo", "out"]) if (!a[k]) throw new Error(`--${k} is required`);
  if (!a.dryRun && !a.model) throw new Error("--model is required (the verifier's small-model alias), or --dry-run");
  const census = JSON.parse(readFileSync(a.census, "utf8"));
  const entry = entryFilesOf(JSON.parse(readFileSync(a.facts, "utf8")));
  const root = resolve(a.root);
  const read = (rel) => { const f = join(root, rel); return existsSync(f) ? readFileSync(f, "utf8") : null; };
  const ids = a.ids ? new Set(a.ids.split(",")) : null;
  const system = prompt();
  const payloads = census.proposals.filter((p) => !ids || ids.has(p.id)).map((p) => ({ ...buildPayload(p, a.repo, read, entry, system), listedOutliers: sortedOutliers(p).slice(0, CARD_OUTLIERS) }));
  mkdirSync(a.out, { recursive: true });
  if (a.dryRun) {
    writeFileSync(join(a.out, "payloads.json"), JSON.stringify(payloads, null, 1));
    console.log(`${payloads.length} payloads written (dry run; they quote repository code: keep them out of the repository)`);
  } else {
    const empty = mkdtempSync(join(tmpdir(), "sem-empty-"));
    const r = await runAll(payloads, { model: a.model, cwd: empty });
    for (const [k, rows] of Object.entries(r)) writeFileSync(join(a.out, `${k}.jsonl`), rows.map((x) => JSON.stringify(x)).join("\n") + (rows.length ? "\n" : ""));
    console.log(`${payloads.length} cards, ${r.samples.length} samples, ${r.outcomes.filter((o) => !o.error).length} decided`);
  }
}
