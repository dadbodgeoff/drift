// Real-maintainer evidence (round 9, workstream G; decision D10.3 in PLAN-PAR.md): reads the study
// files `drift review --export-log` writes from maintainers' opt-in, local review logs, and computes
// per-family accept rates and the precision of what agents are shown, as maintainers judged it.
//
//   node eval/study/maintainer-log.mjs [--json] EXPORT.json [EXPORT.json ...]
//
// One export is one repository's log (`repo` is a token derived from that repository's random salt:
// it identifies the repository across its own exports and nothing else). Several exports of one
// repository are merged, each event counted once.
//
// Per card (a convention in a repository) the verdict is the person's last accept or reject:
// accept, block, force_block, advise (back from block) and show_to_agents accept it; reject rejects
// it; skip, shown and exceptions are no verdict. Rates are over decided cards, with Wilson intervals;
// `accepted_of_shown` also counts cards shown but never decided (as not accepted).
//
// Block candidates' one question (round 11, WS-K: "Are these the same kind of thing?"): an event with
// a `question` record is the person's answer (`same` and `different` accept the card, `not-a-convention`
// rejects it). `calibration` counts the answers, and over the cards answered `same` or `different` the
// flags the person kept as the same kind against those they set apart (`set_apart`, plus the entry
// points they picked but did not confirm, `kept_flagged`): the precision of a card's flags as
// maintainers judge it, the real-maintainer measure PLAN-PAR's G asks for. The last answer per card
// counts.
//
// D10.3: no external precision claim until maintainers' decisions on >= 100 verifier-passed cards
// across >= 10 repositories agree. `d10_3.met` needs both counts and a Wilson lower bound of at least
// 90% accepted [STRICT: the lower bound, not the point estimate].
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { die, parseArgs, wilson } from "./lib.mjs";

export const SCHEMA = "drift-review-log";
export const SCHEMA_VERSIONS = [1];
export const ACCEPTS = new Set(["accept", "block", "force_block", "advise", "show_to_agents"]);
export const REJECTS = new Set(["reject"]);
export const D10_3 = { cards: 100, repos: 10, min_lower_bound: 0.9 };

const DECISIONS = new Set([...ACCEPTS, ...REJECTS, "shown", "skip", "exempt", "unexempt"]);

/** A study file's contents, checked: the schema and version, a repository token and well-formed events. */
export function readExport(text, where = "export") {
  let d;
  try {
    d = JSON.parse(text);
  } catch (e) {
    throw new Error(`${where}: not JSON`, { cause: e });
  }
  if (!d || typeof d !== "object") throw new Error(`${where}: not an object`);
  if (d.schema !== SCHEMA) throw new Error(`${where}: schema is ${JSON.stringify(d.schema)}, not ${SCHEMA}`);
  if (!SCHEMA_VERSIONS.includes(d.schema_version)) throw new Error(`${where}: schema_version ${d.schema_version} is not one this script reads (${SCHEMA_VERSIONS.join(", ")})`);
  if (typeof d.repo !== "string" || !d.repo) throw new Error(`${where}: no repo token`);
  if (!Array.isArray(d.events)) throw new Error(`${where}: no events`);
  d.events.forEach((e, i) => {
    const bad = (why) => {
      throw new Error(`${where}: event ${i} ${why}`);
    };
    if (!e || typeof e !== "object") bad("is not an object");
    if (typeof e.id !== "string" || !e.id) bad("has no id");
    if (!DECISIONS.has(e.decision)) bad(`has an unknown decision ${JSON.stringify(e.decision)}`);
    if (typeof e.ts !== "string") bad("has no ts");
    if (e.tier !== "default" && e.tier !== "suggestion") bad(`has an unknown tier ${JSON.stringify(e.tier)}`);
  });
  return d;
}

/** The cards of one or more exports, keyed by repository and id, each with its verdict and how it was shown. */
export function cards(exports) {
  const seen = new Map(); // repo -> Set of event JSON (an event exported twice counts once)
  const events = [];
  for (const x of exports) {
    const s = seen.get(x.repo) ?? new Set();
    seen.set(x.repo, s);
    for (const e of x.events) {
      const k = JSON.stringify(e);
      if (s.has(k)) continue;
      s.add(k);
      events.push({ e, repo: x.repo });
    }
  }
  // In time order.
  // A stable sort: events of one second keep the order they were logged (and exported) in.
  events.sort((a, b) => (a.e.ts < b.e.ts ? -1 : a.e.ts > b.e.ts ? 1 : 0));
  const out = new Map();
  for (const { e, repo } of events) {
    const key = `${repo}\u0000${e.id}`;
    let c = out.get(key);
    if (!c) {
      c = { repo, id: e.id, family: e.family ?? "Other", tier: e.tier, language: e.language ?? null, rule_kind: e.rule_kind ?? null, shown: 0, via: new Set(), agents_shown: null, verify: null, verdict: null, decisions: 0, question: null, hidden: null };
      out.set(key, c);
    }
    c.via.add(e.via ?? "cli");
    // A card mining withheld, seen or decided in `drift review --hidden`: its reason and show family.
    if (e.hidden && typeof e.hidden === "object") c.hidden = { reason: e.hidden.reason ?? null, family: e.hidden.show_family ?? null };
    // What agents were shown, and the verifier's standing, as of the last time the person saw the card
    // (or, never shown, as the first decision on it found it).
    if (e.decision === "shown") {
      c.shown++;
      c.agents_shown = e.agents?.shown === true;
      c.verify = e.verify ?? null;
    } else if (c.agents_shown === null) {
      c.agents_shown = e.agents?.shown === true;
      c.verify = e.verify ?? null;
    }
    if (e.question && typeof e.question === "object" && (ACCEPTS.has(e.decision) || REJECTS.has(e.decision))) c.question = e.question;
    else if (ACCEPTS.has(e.decision) || REJECTS.has(e.decision)) c.question = null;
    if (ACCEPTS.has(e.decision)) {
      c.verdict = "accepted";
      c.decisions++;
    } else if (REJECTS.has(e.decision)) {
      c.verdict = "rejected";
      c.decisions++;
    }
  }
  return [...out.values()];
}

function rate(list) {
  const shown = list.filter((c) => c.shown > 0).length;
  const accepted = list.filter((c) => c.verdict === "accepted").length;
  const rejected = list.filter((c) => c.verdict === "rejected").length;
  const decided = accepted + rejected;
  const w = wilson(accepted, decided);
  const ofShown = wilson(list.filter((c) => c.shown > 0 && c.verdict === "accepted").length, shown);
  return {
    cards: list.length,
    shown,
    decided,
    accepted,
    rejected,
    repos: new Set(list.filter((c) => c.verdict).map((c) => c.repo)).size,
    accept_rate: decided ? { p: w.p, lo: w.lo, hi: w.hi } : null,
    accepted_of_shown: shown ? { k: ofShown.k, n: ofShown.n, p: ofShown.p } : null,
  };
}

function groupBy(list, key) {
  const m = new Map();
  for (const c of list) {
    const k = key(c);
    m.set(k, [...(m.get(k) ?? []), c]);
  }
  return [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export const ANSWERS = ["same", "different", "not-a-convention"];

/** The block candidates' answers, and the flags kept as the same kind over the cards whose flags were judged. */
export function calibration(list) {
  const answered = list.filter((c) => c.question && ANSWERS.includes(c.question.answer));
  const judged = answered.filter((c) => c.question.answer !== "not-a-convention");
  const n = (c, k) => (Number.isInteger(c.question[k]) && c.question[k] >= 0 ? c.question[k] : 0);
  const flagged = judged.reduce((t, c) => t + n(c, "flagged"), 0);
  const setApart = judged.reduce((t, c) => t + n(c, "set_apart"), 0);
  const kept = judged.reduce((t, c) => t + n(c, "kept_flagged"), 0);
  const same = Math.max(0, flagged - setApart - kept);
  const w = wilson(same, flagged);
  return {
    answered: answered.length,
    repos: new Set(answered.map((c) => c.repo)).size,
    by_answer: Object.fromEntries(ANSWERS.map((a) => [a, answered.filter((c) => c.question.answer === a).length])),
    flags_judged: flagged,
    flags_set_apart: setApart,
    entry_points_kept_flagged: kept,
    entry_points_confirmed: judged.reduce((t, c) => t + n(c, "entry_confirmed"), 0),
    flags_same_kind: same,
    flag_precision: flagged ? { p: w.p, lo: w.lo, hi: w.hi } : null,
  };
}

/** The withheld cards people saw in `drift review --hidden`, by show family and language: how many were shown, promoted (accepted) and rejected. */
export function hiddenCards(list) {
  return groupBy(list, (c) => `${c.hidden.family}\u0000${c.language}`).map(([k, v]) => ({
    family: k.split("\u0000")[0],
    language: k.split("\u0000")[1],
    shown: v.filter((c) => c.shown > 0).length,
    promoted: v.filter((c) => c.verdict === "accepted").length,
    rejected: v.filter((c) => c.verdict === "rejected").length,
    by_reason: Object.fromEntries(groupBy(v, (c) => c.hidden.reason).map(([r, x]) => [r, x.length])),
  }));
}

/** Everything the study reports from a set of exports. */
export function summarize(exports) {
  const every = cards(exports);
  // [STRICT] Withheld cards (`drift review --hidden`) are reported apart: they never reach agents unless promoted,
  // so they stay out of every rate of the cards Drift proposes.
  const all = every.filter((c) => !c.hidden);
  const withheld = every.filter((c) => c.hidden);
  const repos = new Set(exports.map((x) => x.repo));
  const passed = all.filter((c) => c.verify === "passed");
  const passedRate = rate(passed);
  const volume = passedRate.decided >= D10_3.cards && passedRate.repos >= D10_3.repos;
  return {
    exports: exports.length,
    repos: repos.size,
    events: exports.reduce((n, x) => n + x.events.length, 0),
    skipped_lines: exports.reduce((n, x) => n + (Number(x.skipped_lines) || 0), 0),
    include_paths: exports.some((x) => x.include_paths === true),
    all: rate(all),
    by_tier: Object.fromEntries(groupBy(all, (c) => c.tier).map(([k, v]) => [k, rate(v)])),
    by_family: groupBy(all, (c) => `${c.family}\u0000${c.tier}`).map(([k, v]) => ({ family: k.split("\u0000")[0], tier: k.split("\u0000")[1], ...rate(v) })),
    // What agents are shown as the person found it (admitted families, a person's choice, a verified card; and,
    // logged by a Drift before decision D13, the default tier, which is now a block candidate until accepted):
    // its precision as maintainers judged it.
    agent_shown: rate(all.filter((c) => c.agents_shown)),
    agent_shown_suggestions: rate(all.filter((c) => c.agents_shown && c.tier === "suggestion")),
    verifier_passed: passedRate,
    d10_3: {
      needs: D10_3,
      passed_decided: passedRate.decided,
      passed_repos: passedRate.repos,
      volume_met: volume,
      met: volume && passedRate.accept_rate !== null && passedRate.accept_rate.lo >= D10_3.min_lower_bound,
    },
    calibration: calibration(all),
    hidden: hiddenCards(withheld),
    by_via: Object.fromEntries(groupBy(all.flatMap((c) => [...c.via].map((v) => ({ v }))), (x) => x.v).map(([k, v]) => [k, v.length])),
  };
}

const pct = (r) => (r ? `${(100 * r.p).toFixed(1)}% [${(100 * r.lo).toFixed(1)}–${(100 * r.hi).toFixed(1)}]` : "–");

export function render(s) {
  const line = (name, r) => `${name.padEnd(34)} ${String(r.shown).padStart(5)} ${String(r.decided).padStart(7)} ${String(r.accepted).padStart(8)}  ${pct(r.accept_rate)}`;
  const out = [
    `Maintainer review log: ${s.exports} export(s), ${s.repos} repositor${s.repos === 1 ? "y" : "ies"}, ${s.events} events${s.skipped_lines ? ` (${s.skipped_lines} unreadable lines skipped)` : ""}`,
    ...(s.include_paths ? ["note: an export includes raw ids and paths (--include-paths); do not commit it"] : []),
    "",
    `${"".padEnd(34)} ${"shown".padStart(5)} ${"decided".padStart(7)} ${"accepted".padStart(8)}  accept rate [Wilson 95%]`,
    line("all cards", s.all),
    ...Object.entries(s.by_tier).map(([t, r]) => line(`tier ${t}`, r)),
    line("shown to agents", s.agent_shown),
    line("shown to agents (suggestions)", s.agent_shown_suggestions),
    line("verifier passed", s.verifier_passed),
    "",
    "By family:",
    ...s.by_family.map((f) => line(`  ${f.family} (${f.tier})`, f)),
    "",
    `Block candidates answered: ${s.calibration.answered} in ${s.calibration.repos} repositor${s.calibration.repos === 1 ? "y" : "ies"} (${ANSWERS.map((a) => `${a} ${s.calibration.by_answer[a]}`).join(", ")}); flags kept as the same kind: ${s.calibration.flags_same_kind} of ${s.calibration.flags_judged}, ${pct(s.calibration.flag_precision)} (${s.calibration.flags_set_apart} set apart, ${s.calibration.entry_points_kept_flagged} entry points kept flagged unconfirmed)`,
    `D10.3: ${s.d10_3.passed_decided} decided verifier-passed cards in ${s.d10_3.passed_repos} repositories (needs ${D10_3.cards} in ${D10_3.repos}, lower bound >= ${100 * D10_3.min_lower_bound}%): ${s.d10_3.met ? "met" : "not met"}`,
  ];
  return out.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2), { flags: ["json"] });
  if (args._.length === 0) die("usage: node eval/study/maintainer-log.mjs [--json] EXPORT.json [EXPORT.json ...]");
  let exports;
  try {
    exports = args._.map((p) => readExport(readFileSync(p, "utf8"), p));
  } catch (e) {
    die(e.message);
  }
  const s = summarize(exports);
  console.log(args.json ? JSON.stringify(s, null, 2) : render(s));
}
