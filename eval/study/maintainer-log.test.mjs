// maintainer-log.mjs: study files from `drift review --export-log` (round 9, G) are read, merged per
// repository, and scored per family and for what agents are shown; D10.3 is met only with enough
// verifier-passed cards in enough repositories and a Wilson lower bound of at least 90%.
//
//   node --test eval/study/maintainer-log.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { D10_3, calibration, cards, readExport, render, summarize } from "./maintainer-log.mjs";
import { repoRootDir } from "./lib.mjs";

let clock = 0;
function ev(id, decision, o = {}) {
  clock++;
  const ts = `2026-11-07T10:${String(Math.floor(clock / 60) % 60).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}Z`;
  return {
    v: 1,
    ts,
    event: decision === "shown" ? "shown" : "decision",
    decision,
    via: o.via ?? "cli",
    id,
    rule_kind: o.rule_kind ?? "wrapped_by:call",
    family: o.family ?? "Call wrappers",
    tier: o.tier ?? "default",
    language: "ts",
    evidence: { holders: 37, total: 40, members: 40, outliers: 3, wilson: 0.8, lift: 1.8 },
    rank: 1,
    listed: true,
    agents: { shown: o.agents ?? (o.tier ?? "default") === "default", reason: "default_tier" },
    verify: o.verify ?? null,
    drift: { version: "0.1.0-dev", commit: null },
  };
}

function exp(repo, events, extra = {}) {
  return { schema: "drift-review-log", schema_version: 1, exported_at: "2026-11-07T11:00:00Z", repo, include_paths: false, drift: { version: "0.1.0-dev", commit: null }, skipped_lines: 0, events, ...extra };
}

test("a study file is checked: schema, version, repo token and events", () => {
  const good = exp("h:1", [ev("h:a", "shown")]);
  assert.equal(readExport(JSON.stringify(good)).repo, "h:1");
  assert.throws(() => readExport("{"), /not JSON/);
  assert.throws(() => readExport(JSON.stringify({ ...good, schema: "x" })), /schema/);
  assert.throws(() => readExport(JSON.stringify({ ...good, schema_version: 2 })), /schema_version 2/);
  assert.throws(() => readExport(JSON.stringify({ ...good, repo: "" })), /repo token/);
  assert.throws(() => readExport(JSON.stringify(exp("h:1", [{ ...ev("h:a", "shown"), decision: "delete" }]))), /unknown decision/);
  assert.throws(() => readExport(JSON.stringify(exp("h:1", [{ ...ev("h:a", "shown"), tier: "gold" }]))), /unknown tier/);
});

test("the verdict is the last accept or reject; shown, skip and exceptions are none", () => {
  const x = exp("h:1", [
    ev("h:a", "shown"),
    ev("h:a", "reject"),
    ev("h:a", "accept"),
    ev("h:b", "shown", { tier: "suggestion", family: "Naming" }),
    ev("h:b", "skip", { tier: "suggestion", family: "Naming" }),
    ev("h:c", "shown"),
    ev("h:c", "block"),
    ev("h:c", "exempt"),
    ev("h:c", "reject"),
    ev("h:d", "force_block", { tier: "suggestion", family: "Naming" }),
  ]);
  const byId = Object.fromEntries(cards([x]).map((c) => [c.id, c]));
  assert.equal(byId["h:a"].verdict, "accepted");
  assert.equal(byId["h:b"].verdict, null);
  assert.equal(byId["h:c"].verdict, "rejected");
  assert.equal(byId["h:d"].verdict, "accepted");
  assert.equal(byId["h:d"].shown, 0, "decided without being shown");
  const s = summarize([x]);
  assert.equal(s.all.decided, 3);
  assert.equal(s.all.accepted, 2);
  assert.equal(s.all.shown, 3);
  assert.deepEqual(s.all.accepted_of_shown, { k: 1, n: 3, p: 1 / 3 });
  const naming = s.by_family.find((f) => f.family === "Naming");
  assert.equal(naming.tier, "suggestion");
  assert.equal(naming.decided, 1);
  assert.equal(naming.accept_rate.p, 1);
  const calls = s.by_family.find((f) => f.family === "Call wrappers");
  assert.equal(calls.accepted, 1);
  assert.equal(calls.rejected, 1);
  assert.ok(calls.accept_rate.lo < 0.5 && calls.accept_rate.hi > 0.5);
});

test("precision of what agents are shown, as the person saw the card", () => {
  const x = exp("h:1", [
    // Shown to agents when the person saw it; the person then showed another one themselves.
    ev("h:a", "shown", { tier: "suggestion", agents: true }),
    ev("h:a", "accept", { tier: "suggestion", agents: true }),
    ev("h:b", "shown", { tier: "suggestion", agents: false }),
    ev("h:b", "show_to_agents", { tier: "suggestion", agents: false }),
    ev("h:c", "shown", { tier: "suggestion", agents: true }),
    ev("h:c", "reject", { tier: "suggestion", agents: true }),
    ev("h:d", "shown"),
    ev("h:d", "accept"),
  ]);
  const s = summarize([x]);
  assert.equal(s.agent_shown.decided, 3);
  assert.equal(s.agent_shown.accepted, 2);
  assert.equal(s.agent_shown_suggestions.decided, 2);
  assert.equal(s.agent_shown_suggestions.accept_rate.p, 0.5);
  assert.equal(s.by_tier.suggestion.decided, 3);
});

test("exports of one repository merge, each event once; repositories are counted by token", () => {
  const events = [ev("h:a", "shown"), ev("h:a", "accept")];
  const later = [...events, ev("h:a", "reject")];
  const s = summarize([exp("h:1", events), exp("h:1", later), exp("h:2", [ev("h:a", "shown")])]);
  assert.equal(s.repos, 2);
  assert.equal(s.all.cards, 2, "the same id in two repositories is two cards");
  const one = cards([exp("h:1", events), exp("h:1", later)]);
  assert.equal(one.length, 1);
  assert.equal(one[0].verdict, "rejected");
  assert.equal(one[0].shown, 1, "the shown event exported twice counts once");
});

test("D10.3 needs 100 decided verifier-passed cards in 10 repositories and a lower bound of 90%", () => {
  const build = (repos, perRepo, rejectEvery) => {
    let n = 0;
    return Array.from({ length: repos }, (_, r) =>
      exp(
        `h:r${r}`,
        Array.from({ length: perRepo }, (_, i) => {
          n++;
          const o = { tier: "suggestion", verify: "passed", agents: true };
          return [ev(`h:${i}`, "shown", o), ev(`h:${i}`, rejectEvery && n % rejectEvery === 0 ? "reject" : "accept", o)];
        }).flat(),
      ),
    );
  };
  const all = summarize(build(10, 10, 0));
  assert.equal(all.d10_3.passed_decided, 100);
  assert.equal(all.d10_3.passed_repos, 10);
  assert.equal(all.d10_3.volume_met, true);
  assert.equal(all.d10_3.met, true, JSON.stringify(all.verifier_passed));
  // 95% accepted of 100: the point estimate passes 90%, the lower bound does not [STRICT].
  const most = summarize(build(10, 10, 20));
  assert.equal(most.verifier_passed.accept_rate.p, 0.95);
  assert.ok(most.verifier_passed.accept_rate.lo < D10_3.min_lower_bound);
  assert.equal(most.d10_3.met, false);
  // Too few repositories.
  const few = summarize(build(9, 12, 0));
  assert.equal(few.d10_3.passed_decided, 108);
  assert.equal(few.d10_3.volume_met, false);
  assert.equal(few.d10_3.met, false);
  // Unverified cards never count.
  const unverified = build(10, 10, 0).map((x) => ({ ...x, events: x.events.map((e) => ({ ...e, verify: "unverified" })) }));
  assert.equal(summarize(unverified).d10_3.passed_decided, 0);
  assert.match(render(all), /D10\.3: 100 decided verifier-passed cards in 10 repositories .*: met/);
});

test("block candidates' answers: the flags kept as the same kind over the cards whose flags were judged", () => {
  const q = (answer, o = {}) => ({ v: 1, answer, auth_or_validation: true, holders_shown: 3, flagged: 3, flagged_files: 3, set_apart: 0, set_apart_files: 0, entry_confirmed: 0, kept_flagged: 0, needs_confirmation: 0, ...o });
  const x = exp("h:1", [
    { ...ev("h:a", "accept"), question: q("same") },
    { ...ev("h:b", "accept"), question: q("different", { set_apart: 1, set_apart_files: 1 }), set_apart_members: ["h:m1"] },
    // An entry point picked but not confirmed stays flagged; it still counts as set apart by the person.
    { ...ev("h:c", "accept"), question: q("different", { set_apart: 0, kept_flagged: 2, needs_confirmation: 2 }), kept_flagged_members: ["h:m2", "h:m3"] },
    // Not a convention: its flags are not judged.
    { ...ev("h:d", "reject"), question: q("not-a-convention") },
    // A plain accept (no question) and a skip: not answers.
    ev("h:e", "accept"),
    { ...ev("h:f", "skip") },
    // The last answer counts: h:g said same, then (re-proposed) not a convention.
    { ...ev("h:g", "accept"), question: q("same") },
    { ...ev("h:g", "reject"), question: q("not-a-convention") },
  ]);
  const c = calibration(cards([readExport(JSON.stringify(x))]));
  assert.deepEqual(c.by_answer, { same: 1, different: 2, "not-a-convention": 2 });
  assert.equal(c.answered, 5);
  assert.equal(c.flags_judged, 9);
  assert.equal(c.flags_set_apart, 1);
  assert.equal(c.entry_points_kept_flagged, 2);
  assert.equal(c.flags_same_kind, 6);
  assert.ok(Math.abs(c.flag_precision.p - 6 / 9) < 1e-9);
  const s = summarize([x]);
  assert.equal(s.all.accepted, 4);
  assert.match(render(s), /Block candidates answered: 5 in 1 repository \(same 1, different 2, not-a-convention 2\); flags kept as the same kind: 6 of 9/);
  // A later accept without a question replaces the answer.
  const y = exp("h:1", [{ ...ev("h:a", "accept"), question: q("same") }, ev("h:a", "reject")]);
  assert.equal(calibration(cards([y])).answered, 0);
  assert.equal(calibration([]).flag_precision, null);
});

test("withheld cards from `drift review --hidden` are reported apart, by show family, not in any rate", () => {
  const hid = (reason, family, promoted) => ({ hidden: { reason, show_family: family, promoted } });
  const x = exp("h:1", [
    ev("h:a", "shown"),
    ev("h:a", "accept"),
    { ...ev("h:w", "shown", { tier: "suggestion", family: "Naming", rule_kind: "named" }), ...hid("too_many_outliers", "naming", false) },
    { ...ev("h:w", "accept", { tier: "suggestion", family: "Naming", rule_kind: "named" }), ...hid("too_many_outliers", "naming", true) },
    { ...ev("h:j", "shown", { tier: "suggestion", family: "Layout wrappers" }), ...hid("family_not_admitted", "jsx_wrapper", false) },
    { ...ev("h:j", "reject", { tier: "suggestion", family: "Layout wrappers" }), ...hid("family_not_admitted", "jsx_wrapper", false) },
    { ...ev("h:k", "shown", { tier: "suggestion", family: "Naming", rule_kind: "named" }), ...hid("python_off", "naming", false) },
  ]);
  const s = summarize([x]);
  assert.equal(s.all.cards, 1);
  assert.equal(s.all.accepted, 1);
  assert.equal(s.by_tier.suggestion, undefined);
  assert.deepEqual(s.hidden, [
    { family: "jsx_wrapper", language: "ts", shown: 1, promoted: 0, rejected: 1, by_reason: { family_not_admitted: 1 } },
    { family: "naming", language: "ts", shown: 2, promoted: 1, rejected: 0, by_reason: { python_off: 1, too_many_outliers: 1 } },
  ]);
  assert.deepEqual(summarize([exp("h:1", [ev("h:a", "accept")])]).hidden, []);
});

test("the command line reads files and prints a table or JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintainer-log-"));
  const p = join(dir, "a.json");
  writeFileSync(p, JSON.stringify(exp("h:1", [ev("h:a", "shown"), ev("h:a", "accept")])));
  const text = spawnSync(process.execPath, ["eval/study/maintainer-log.mjs", p], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /1 export\(s\), 1 repository, 2 events/);
  assert.match(text.stdout, /Call wrappers \(default\)/);
  const json = spawnSync(process.execPath, ["eval/study/maintainer-log.mjs", "--json", p], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(JSON.parse(json.stdout).all.accepted, 1);
  writeFileSync(p, "{ not json");
  const bad = spawnSync(process.execPath, ["eval/study/maintainer-log.mjs", p], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not JSON/);
  assert.doesNotMatch(bad.stderr, /not json/, "the file's text is never echoed");
});
