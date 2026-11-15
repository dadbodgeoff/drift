// The tier the product computes (crates/drift-mine/src/tier.rs, decision D7: tier-d7.json) and the
// tier the study applies (lib.mjs tierOf under the primary manifests' `tier`, which is D7's block) on the
// same cases. `tier` is the expected D7 tier, `reason` the product's tier_reason, `d5_tier` the tier under
// D5 (the secondary sets' tier), `rule5_tier` the tier under rule 5 as pre-registered. The Rust test
// `tier::tests::shared_fixture_matches_the_study` reads the same file.
//
//   node --test eval/study/tier.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HELD_OUT_TIER_FILES, RULE_KINDS, checkTier, describeTier, heldOutTierFile, languageOf, namesPackage, proposalLanguage, ruleKind, tierMembers, tierOf } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => JSON.parse(readFileSync(join(here, rel), "utf8"));
const { cases } = read("tier-cases.json");
const d7 = read("tier-d7.json").tier;
const d5 = read("tier-d5.json").tier;
// Rule 5 as pre-registered, as the dev runs' rule-5 views copied it.
const rule5 = read("runs/dev-py-r2-2026-11-05/views/rule5/run.json").params.tier;
const item = (c) => ({ rule: c.rule, members: c.members, example: c.example, python_members: c.evidence?.python_members ?? null });
const at = (c) => `${JSON.stringify(c.rule)} with ${c.members} members, example ${c.example}`;

test("shared tier cases under D7 (tier-d7.json), the product's definition", () => {
  assert.deepEqual(checkTier(d7), []);
  for (const c of cases) {
    assert.equal(ruleKind(c.rule), c.kind, JSON.stringify(c.rule));
    assert.equal(tierOf(item(c), d7), c.tier, at(c));
    assert.equal(c.reason === null, c.tier === "default", `${at(c)}: reason (tier_reason) agrees with tier`);
    if (proposalLanguage(item(c)) === "py") assert.equal(c.reason, "language_advise", at(c));
    if (c.evidence) assert.equal(tierMembers(c.evidence), c.members, `${at(c)}: members is the role's size`);
  }
});

test("the tier counts the role, exempt members included (role_members), and any Python member makes a convention Python", () => {
  const call = { type: "wrapped_by", kind: "call", any_of: ["app/api/_lib/auth.ts#withAuth"] };
  const ev = { holders: 13, total: 14, role_members: 16, lower_bound: 0.8, lift: 2 };
  assert.equal(tierMembers(ev), 16);
  assert.equal(tierMembers({ total: 20 }), 20);
  assert.equal(tierMembers(null), null);
  // 16 role members, 2 exempt: the product says default; so must the study (prepare.mjs copies role_members).
  assert.equal(tierOf({ rule: call, members: tierMembers(ev), example: "app/api/a/route.ts#GET" }, d7), "default");
  assert.equal(tierOf({ rule: call, members: ev.total, example: "app/api/a/route.ts#GET" }, d7), "suggestion", "evidence.total alone would disagree");
  assert.equal(proposalLanguage({ example: "app/api/a/route.ts#GET", python_members: 1 }), "py");
  assert.equal(proposalLanguage({ example: "app/api/a/route.ts#GET", python_members: null }), "ts");
  assert.equal(proposalLanguage({ example: "app/views.py#v" }), "py");
  assert.equal(tierOf({ rule: call, members: 40, example: "app/api/a/route.ts#GET", python_members: 2 }, d7), "suggestion");
  for (const c of cases.filter((c) => c.evidence)) assert.equal(tierOf(item(c), d7), c.tier, at(c));
});

test("prepare.mjs takes the tier's member count and Python members from conventions.yaml", () => {
  const src = readFileSync(join(here, "prepare.mjs"), "utf8");
  assert.match(src, /members: c\?\.evidence\?\.role_members \?\? p\.evidence\?\.total/);
  assert.match(src, /python_members: c\?\.evidence\?\.python_members \?\? null/);
});

test("shared tier cases under D5 and under rule 5 as pre-registered (language plays no part)", () => {
  assert.deepEqual(checkTier(d5), []);
  assert.deepEqual(checkTier(rule5), []);
  for (const c of cases) {
    assert.equal(tierOf(item(c), d5), c.d5_tier, at(c));
    assert.equal(tierOf({ rule: c.rule, members: c.members }, d5), c.d5_tier, `${at(c)}, without its example`);
    assert.equal(tierOf(item(c), rule5), c.rule5_tier, at(c));
  }
});

test("D5 is rule 5 with passes_key and renders moved to suggestion and target in_repo, nothing else", () => {
  const moved = ["passes_key", "renders"];
  assert.deepEqual(d5.default.rule_kinds, rule5.default.rule_kinds.filter((k) => !moved.includes(k)));
  assert.deepEqual(d5.suggestion.rule_kinds, [...rule5.suggestion.rule_kinds, ...moved]);
  assert.equal(d5.default.min_members, rule5.default.min_members);
  assert.equal(d5.default.target, "in_repo");
  assert.equal(rule5.default.target, undefined);
  assert.equal(d5.kind, rule5.kind);
  assert.equal(d5.not_wrong_over, rule5.not_wrong_over);
  assert.match(describeTier(d5), /names no symbol from outside the repository/);
  assert.doesNotMatch(describeTier(rule5), /package/);
  assert.deepEqual(checkTier({ ...d5, default: { ...d5.default, target: "anywhere" } }), ['unknown default.target "anywhere"']);
});

test("D7 is D5 with only call wrappers and layering in the default tier, for TypeScript/JavaScript only", () => {
  const moved = ["wrapped_by:decorator", "wrapped_by:extends", "wrapped_by:jsx"];
  assert.deepEqual(d7.default.rule_kinds, ["wrapped_by:call", "avoids:import"]);
  assert.deepEqual(d7.default.rule_kinds, d5.default.rule_kinds.filter((k) => !moved.includes(k)));
  assert.deepEqual(d7.suggestion.rule_kinds, [...d5.suggestion.rule_kinds, ...moved]);
  assert.deepEqual(d7.default.languages, ["ts"]);
  assert.deepEqual(d7.suggestion.languages, ["py"]);
  assert.equal(d7.decision, "D7");
  // D5's conditions still apply on top of the rule kind.
  assert.equal(d7.default.min_members, d5.default.min_members);
  assert.equal(d7.default.target, d5.default.target);
  assert.equal(d7.kind, d5.kind);
  assert.equal(d7.not_wrong_over, d5.not_wrong_over);
  assert.match(describeTier(d7), /TypeScript\/JavaScript, rule kind in \{wrapped_by:call, avoids:import\}, the rule names no symbol from outside the repository/);
  assert.match(describeTier(d7), /Python: advise only/);
  for (const [bad, problem] of [
    [{ ...d7, default: { ...d7.default, languages: [] } }, "default.languages must be a non-empty list"],
    [{ ...d7, default: { ...d7.default, languages: ["go"] } }, 'unknown language "go"'],
    [{ ...d7, suggestion: { ...d7.suggestion, languages: ["ts", "py"] } }, "language ts is in both tiers"],
    [{ ...d5, suggestion: { ...d5.suggestion, languages: ["py"] } }, "suggestion.languages needs default.languages"],
  ])
    assert.deepEqual(checkTier(bad), [problem]);
});

test("D7: a TypeScript decorator rule that was default is a suggestion; a call wrapper is still default; every Python proposal is a suggestion", () => {
  const decorator = { rule: { type: "wrapped_by", kind: "decorator", any_of: ["src/auth/guard.ts#Authed"] }, members: 40, example: "src/users/users.controller.ts#UsersController" };
  assert.equal(tierOf(decorator, d5), "default");
  assert.equal(tierOf(decorator, d7), "suggestion");
  const wrapper = { rule: { type: "wrapped_by", kind: "call", any_of: ["lib/auth.ts#withAuth"] }, members: 40, example: "app/api/users/route.ts#GET" };
  assert.equal(tierOf(wrapper, d7), "default");
  assert.equal(tierOf({ ...wrapper, members: 14 }, d7), "suggestion");
  assert.equal(tierOf({ ...wrapper, rule: { ...wrapper.rule, any_of: ["pkg:next-auth#auth"] } }, d7), "suggestion");
  for (const example of ["app/views.py#index", "app/stubs.pyi#f", "pyproject.toml", "libs/a/pyproject.toml", "requirements-dev.txt", "setup.cfg", "Pipfile"]) {
    assert.equal(languageOf(example), "py", example);
    for (const rule of [wrapper.rule, decorator.rule, { type: "avoids", signal: "import:app/legacy" }]) assert.equal(tierOf({ rule, members: 200, example }, d7), "suggestion", `${example} ${rule.kind ?? rule.type}`);
  }
  for (const example of ["src/a.ts#f", "src/a.tsx#F", "src/a.js#f", "src/a.mjs#f", "package.json", "", undefined]) assert.equal(languageOf(example), "ts", String(example));
});

test("namesPackage: pkg: targets and import:pkg: avoidance, any alternative", () => {
  const yes = [
    { type: "wrapped_by", kind: "decorator", any_of: ["pkg:@nestjs/common#UseGuards"] },
    { type: "wrapped_by", kind: "call", any_of: ["lib/auth.ts#withAuth", "pkg:next-auth#auth"] },
    { type: "wrapped_by", kind: "extends", any_of: ["pkg:python:enum#StrEnum"] },
    { type: "passes_key", callee: "pkg:drizzle-orm#pgTable", index: 1, key: "id" },
    { type: "renders", component: "pkg:@react-email/components#Text" },
    { type: "calls", callee: "pkg:fastapi#Depends" },
    { type: "throws", class: "pkg:http-errors#HttpError" },
    { type: "before", first: "lib/auth.ts#auth", then: "pkg:drizzle-orm#query" },
    { type: "avoids", signal: "import:pkg:@prisma/client" },
    // built-ins and ambient globals, and ids the linker could not resolve, are not defined by the repo either
    { type: "wrapped_by", kind: "extends", any_of: ["global#Error"] },
    { type: "wrapped_by", kind: "extends", any_of: ["global#Exception"] },
    { type: "wrapped_by", kind: "call", any_of: ["unresolved:~/lib/auth#withAuth"] },
    { type: "wrapped_by", kind: "decorator", any_of: ["unresolved:app.auth#login_required"] },
    { type: "avoids", signal: "import:unresolved:~/legacy" },
    // an import-source rule names a package through its source or any alternative
    { type: "imports_from", name: "TypedDict", source: "pkg:typing_extensions#TypedDict", instead_of: ["pkg:python:typing#TypedDict"] },
    { type: "imports_from", name: "button", source: "backoffice/components/_button.py#button", instead_of: ["pkg:tagflow#tag.button"] },
    { type: "imports_from", name: "actor", source: "pkg:dramatiq#actor", instead_of: ["polar/worker/__init__.py#actor"] },
  ];
  const no = [
    { type: "wrapped_by", kind: "call", any_of: ["apps/web/lib/actions/safe-action.ts#actionClient.inputSchema().action"] },
    // A package object reached through a binding the repo defines (`ma = Marshmallow()`) has an in-repo id: it
    // counts as in-repo. A known limit of D5 (TIER-ADMISSION.md §5); the one Python D5 miss is this rule.
    { type: "wrapped_by", kind: "extends", any_of: ["CTFd/models/__init__.py#ma.ModelSchema"] },
    { type: "wrapped_by", kind: "call", any_of: ["backend/src/server/routes/v1/sso-router.ts#passport.authenticate"] },
    { type: "avoids", signal: "import:packages/pkg:odd" },
    { type: "wrapped_by", kind: "try", any_of: [] },
    { type: "avoids", signal: "import:packages/features" },
    { type: "avoids", signal: "console" },
    { type: "named", pattern: "pkg*" },
    { type: "prefers_library", group: "icons", preferred: "lucide-react" },
    { type: "dependency_version", name: "zod" },
    { type: "imports_from", name: "x", source: "app/a.py#x", instead_of: ["app/b.py#x"] },
    {},
  ];
  for (const r of yes) assert.equal(namesPackage(r), true, JSON.stringify(r));
  for (const r of no) assert.equal(namesPackage(r), false, JSON.stringify(r));
});

test("each registered held-out manifest holds the product's tier verbatim: D7's (the primaries by D7, the secondaries by D7a)", () => {
  const registered = Object.keys(read("holdout-manifests.json").manifests);
  const primary = ["eval/holdout-primary.json", "eval/holdout-primary-py.json"];
  for (const p of [...primary, "eval/holdout.json", "eval/holdout-py.json"]) assert.ok(registered.includes(p), `${p} is not registered`);
  assert.deepEqual(HELD_OUT_TIER_FILES, { primary: "tier-d7.json", secondary: "tier-d7.json" });
  for (const p of registered) {
    const m = read(`../../${p}`);
    const file = heldOutTierFile(m);
    assert.equal(file, "tier-d7.json", `${p}: role`);
    assert.deepEqual(checkTier(m.tier), [], p);
    assert.ok(JSON.stringify(m.tier) === JSON.stringify(read(file).tier), `${p}: tier is not ${file}'s`);
  }
  const t = read("../../eval/holdout-primary.json").tier;
  for (const c of cases) assert.equal(tierOf(item(c), t), c.tier, at(c));
});

test("the fixture covers exactly the rule kinds the study knows", () => {
  const kinds = new Set(cases.map((c) => c.kind));
  for (const k of RULE_KINDS) assert.ok(kinds.has(k), `${k} has no case`);
  for (const k of kinds) assert.ok(RULE_KINDS.includes(k), `${k} is not in lib.mjs RULE_KINDS`);
});

test("parseCensus keeps the product's tier label out of what labellers see", async () => {
  const { parseCensus } = await import("./lib.mjs");
  const text = [
    "2 conventions from 90 units in 4 roles (1 default tier, 1 suggestions)",
    "",
    "Default tier: may block once accepted (`drift review`, b)",
    "",
    " 1. [D-aaaaaa] HTTP handlers in app/api/** are wrapped in withAuth()",
    "    evidence: 37/40 (lower bound 0.80, lift 2.0)",
    "    tier:     default",
    "    example:  app/api/a/route.ts#GET",
    "",
    "Suggestions: advice only; blocking one needs `drift review --block <id> --force`",
    "",
    " 2. [D-bbbbbb] functions in lib/** call log()",
    "    evidence: 29/30 (lower bound 0.83, lift 1.7)",
    "    tier:     suggestion (rule kind calls)",
    "    example:  lib/u.ts#util",
    "",
  ].join("\n");
  const { header, proposals } = parseCensus(text);
  assert.deepEqual(header, { conventions: 2, units: 90, roles: 4 });
  assert.deepEqual(proposals.map((p) => [p.rank, p.id, p.census_tier, p.example]), [
    [1, "D-aaaaaa", "default", "app/api/a/route.ts#GET"],
    [2, "D-bbbbbb", "suggestion", "lib/u.ts#util"],
  ]);
  for (const p of proposals) assert.ok(!/tier/.test(p.block), p.block);
});

test("parseCensus reads an outlier path that holds spaces", async () => {
  const { parseCensus } = await import("./lib.mjs");
  const text = [
    " 1. [D-aaaaaa] classes in ** extend Base",
    "    evidence: 37/40 (lower bound 0.80, lift 2.0)",
    "    example:  skills/Academic Writing/a/main.py#Tool",
    "    outlier:  skills/Data Analysis/b [Part 1]/main.py:12 Other",
    "    outlier:  lib/c.py:3 Third",
    "    outlier:  lib/d.py (file)",
    "    ... 2 more outliers",
    "",
  ].join("\n");
  const [p] = parseCensus(text).proposals;
  assert.deepEqual(p.outliers, [
    { path: "skills/Data Analysis/b [Part 1]/main.py", line: 12, symbol: "Other" },
    { path: "lib/c.py", line: 3, symbol: "Third" },
    { path: "lib/d.py", line: null, symbol: "(file)" },
  ]);
  assert.equal(p.example, "skills/Academic Writing/a/main.py#Tool");
  assert.equal(p.more_outliers, 2);
});

test("prompt order is not grouped by tier (census rank is in tier order)", async () => {
  const { promptOrder } = await import("./lib.mjs");
  // One repo's items in census rank order: 8 default-tier, then 7 suggestions.
  const ranked = Array.from({ length: 15 }, (_, i) => ({ uid: `r/D-${String(i).padStart(6, "0")}`, tier: i < 8 ? "default" : "suggestion" }));
  const grouped = (xs) => xs.slice(0, 8).every((x) => x.tier === "default");
  let pairs = 0, defaultFirst = 0;
  for (const labeller of ["A", "B", "C", "M1"])
    for (const list of labeller === "M1" ? ["shown", "pool"] : [null])
      for (let r = 0; r < 16; r++) {
        const key = { run: "eval/study/runs/held-out", labeller, repo: `repo${r}`, list };
        const order = promptOrder(ranked, key);
        assert.deepEqual([...order].sort((a, b) => a.uid.localeCompare(b.uid)), ranked, "a permutation");
        assert.deepEqual(promptOrder(ranked, key), order, "deterministic");
        assert.ok(!grouped(order), `${JSON.stringify(key)}: default tier first`);
        for (let i = 0; i < order.length; i++)
          for (let j = i + 1; j < order.length; j++)
            if (order[i].tier !== order[j].tier) {
              pairs++;
              if (order[i].tier === "default") defaultFirst++;
            }
      }
  // Across repos and stages, a default-tier item is as likely to come before a suggestion as after.
  const share = defaultFirst / pairs;
  assert.ok(share > 0.4 && share < 0.6, `default before suggestion in ${(100 * share).toFixed(0)}% of pairs`);
});

test("prompt.mjs renders every stage through promptOrder, never in rank order", () => {
  const src = readFileSync(join(here, "prompt.mjs"), "utf8");
  assert.ok(!/\bshuffle\(/.test(src), "stages use promptOrder, not ad-hoc shuffles");
  for (const re of [/order = promptOrder\(props, \{ run: run\.run, labeller, repo: r\.name \}\)/, /cases = promptOrder\(/, /promptOrder\(props, \{[^}]*list: "shown"/, /promptOrder\(pool, \{[^}]*list: "pool"/])
    assert.ok(re.test(src), `prompt.mjs: ${re}`);
});

// Decision D8, pre-registered and NOT adopted (tier-d8-candidate.json): the same d8_cases the Rust test
// tier::tests::d8_candidate_matches_the_study runs through drift_mine::tier::d8_candidate_reason.
test("D8 candidate: shared d8_cases, TypeScript/JavaScript exactly D7, Python guard call wrappers and layering in roles of >= 50", () => {
  const file = read("tier-d8-candidate.json");
  const d8 = file.tier;
  const { d8_cases } = read("tier-cases.json");
  assert.deepEqual(checkTier(d8), []);
  assert.equal(d8.decision, "D8");
  assert.equal(d8.status, "candidate");
  assert.ok(d8_cases.length >= 20);
  for (const c of d8_cases) {
    const p = { ...item(c), guards: c.guards };
    assert.equal(ruleKind(c.rule), c.kind, JSON.stringify(c.rule));
    assert.equal(tierOf(p, d8), c.d8_tier, at(c));
    assert.equal(c.d8_reason === null, c.d8_tier === "default", at(c));
    if (proposalLanguage(p) === "ts") assert.equal(tierOf(p, d7), c.d8_tier, `${at(c)}: TypeScript/JavaScript is D7`);
    else assert.equal(tierOf(p, d7), "suggestion", `${at(c)}: D7 (what ships) keeps every Python proposal a suggestion`);
  }
  // D7's cases are D8's too, for every TypeScript/JavaScript proposal (guards play no part there).
  for (const c of cases) if (proposalLanguage(item(c)) === "ts") for (const guards of [true, false, undefined]) assert.equal(tierOf({ ...item(c), guards }, d8), c.tier, at(c));
  // Python call wrappers fail closed: only guards === true (the product's word) admits one.
  const guard = { rule: { type: "wrapped_by", kind: "call", any_of: ["app/deps.py#get_current_user"] }, members: 60, example: "app/routes/items.py#read" };
  assert.equal(tierOf({ ...guard, guards: true }, d8), "default");
  for (const guards of [false, null, undefined, "true", 1]) assert.equal(tierOf({ ...guard, guards }, d8), "suggestion", String(guards));
  // Layering needs no guard; the floor applies to it too.
  const layering = { rule: { type: "avoids", signal: "import:events" }, members: 50, example: "app/abuser.py" };
  assert.equal(tierOf(layering, d8), "default");
  assert.equal(tierOf({ ...layering, members: 49 }, d8), "suggestion");
  assert.match(describeTier(d8), /Python: role has ≥ 50 members, a call wrapper only when every alternative is a guard/);
  for (const [bad, problem] of [
    [{ ...d8, default: { ...d8.default, by_language: { go: {} } } }, "default.by_language.go: not a default.languages language"],
    [{ ...d8, default: { ...d8.default, by_language: { py: { min_members: 10 } } } }, "default.by_language.py.min_members must be an integer no lower than default.min_members"],
    [{ ...d8, default: { ...d8.default, by_language: { py: { call_wrappers: "any" } } } }, 'default.by_language.py.call_wrappers must be "guards"'],
    [{ ...d8, default: { ...d8.default, by_language: { py: { floor: 3 } } } }, "default.by_language.py: unknown key floor"],
    [{ ...d8, default: { ...d8.default, by_language: [] } }, "default.by_language must be an object"],
  ])
    assert.deepEqual(checkTier(bad), [problem]);
});

test("D8 is a candidate only: no held-out set measures it and the product ships D7", () => {
  assert.deepEqual(HELD_OUT_TIER_FILES, { primary: "tier-d7.json", secondary: "tier-d7.json" });
  const src = readFileSync(join(here, "..", "..", "crates", "drift-mine", "src", "tier.rs"), "utf8");
  assert.match(src, /pub const DECISION: &str = "D7";/);
  assert.match(src, /pub const ADVISE_ONLY_LANGUAGES: &\[&str\] = &\["py"\];/);
  assert.match(src, /pub const D8_MIN_MEMBERS_PY: usize = 50;/);
});

test("censusListAll passes --all only to a binary whose census has it (W4 cap)", async () => {
  const { censusListAll } = await import("./lib.mjs");
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "drift-listall-"));
  try {
    const fake = (name, help) => {
      const p = join(dir, name);
      writeFileSync(p, `#!/bin/sh\ncat <<'EOT'\n${help}\nEOT\n`);
      chmodSync(p, 0o755);
      return p;
    };
    const now = fake("new", "Usage: drift census [OPTIONS]\n\nOptions:\n      --all-outliers  Show every outlier\n      --suggestions <N>  Suggestions to list\n      --all  List every suggestion");
    const frozen = fake("old", "Usage: drift census [OPTIONS]\n\nOptions:\n      --all-outliers  Show every outlier\n      --json  Print JSON\n\nNext: `drift census --all` is not a flag here");
    assert.deepEqual(censusListAll(now), ["--all"]);
    assert.deepEqual(censusListAll(frozen), [], "--all-outliers and prose are not the flag");
    assert.deepEqual(censusListAll(join(dir, "missing")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
