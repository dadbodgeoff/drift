import { describe, expect, it } from "vitest";
import { type ConventionRow, blockDecision, blocksInNameOnly, capSuggestions, reviewOrder, undecided, conventionLanguage, conventionRows, countConventions, describeDecision, familyHint, importSource, isLayering, isUnknownBase, keyTypeText, parseConventions, parseLock, ruleFamily, ruleTargets, shortRef, sourceModule, tierLanguage, tierReason, tierReasonText, uncheckedFilesText, uncheckedMembersText, agentsHiddenText, verifyText, hiddenByShowPolicy, BLOCK_CANDIDATE_TEXT, isBlockCandidate, pythonProposals, pythonProposalsText } from "@/entities/convention";
import type { CheckReport } from "@/shared/contract/drift";
import { reviewCommand } from "@/shared/lib/review";
import precisionJson from "@/entities/convention/family-precision.json";
import { census, check, json, text } from "./helpers";

describe("policy and census", () => {
  const policy = parseConventions(text("acme/conventions.yaml"));
  const rows = conventionRows(policy, census());

  it("parses conventions.yaml as Drift writes it", () => {
    expect(policy.version).toBe(1);
    expect(policy.conventions.length).toBe(16);
    // Without check (as an older drift), the proposals the show policy hides are still rows; the server-action wrapper
    // is a block candidate (D13), left proposed.
    expect(countConventions(rows)).toMatchObject({ accepted: 12, blocking: 3, rejected: 1, proposed: 3 });
    // A reviewer's exception (round 9 F), sorted by member; absent elsewhere.
    expect(policy.conventions.find((c) => c.id === "D-b0d245")!.exceptions).toEqual([{ member: "apps/web/app/api/oauth/callback/route.ts#GET", reason: "the OAuth callback runs before any session exists" }]);
    expect(policy.conventions.filter((c) => c.exceptions).length).toBe(1);
  });

  it("joins census outliers and ranks by id", () => {
    const ws = rows.find((r) => /app\/api\/workspaces/.test(r.summary) && r.family === "Call wrappers")!;
    expect(ws.outliers?.length).toBe(ws.outliersTotal);
    expect(ws.example.line).toBeGreaterThan(0);
    expect(ws.blockable).toBe(true);
    expect(ws.rank).not.toBeNull();
  });

  it("keeps policy-only conventions and marks census-only ones", () => {
    const onlyPolicy = conventionRows(policy, null);
    expect(onlyPolicy.every((r) => r.outliers === null)).toBe(true);
    const onlyCensus = conventionRows(null, census());
    expect(onlyCensus.every((r) => r.status === "not_in_policy")).toBe(true);
  });

  it("rejects malformed policy files with a clear error", () => {
    expect(() => parseConventions("conventions: [")).toThrow(/not valid YAML/);
    expect(parseConventions("version: 1\nconventions:\n- id: nope\n").conventions).toEqual([]);
  });

  it("parses drift.lock", () => {
    const lock = parseLock(text("acme/drift.lock"));
    expect(lock.length).toBeGreaterThan(0);
    expect(lock[0].id).toMatch(/^D-[0-9a-f]{6}$/);
    expect(parseLock("# c\n\nD-aaaaaa a.ts#X\n")).toEqual([{ id: "D-aaaaaa", key: "a.ts#X" }]);
    // A fingerprint line is no second entry, in the form written now and the first one.
    expect(parseLock("D-aaaaaa a.ts#X\n#~ D-aaaaaa 0123456789abcdef a.ts#X\nD-aaaaaa ~0123456789abcdef a.ts#X\n")).toEqual([{ id: "D-aaaaaa", key: "a.ts#X" }]);
  });

  it("classifies rules into the study's families", () => {
    expect(ruleFamily({ type: "wrapped_by", kind: "call", any_of: [] })).toBe("Call wrappers");
    expect(ruleFamily({ type: "avoids", signal: "import:apps/web" })).toBe("Layering");
    expect(ruleFamily({ type: "avoids", signal: "import:pkg:react" })).toBe("Other avoidance");
    expect(isLayering("import:pkg:x")).toBe(false);
    expect(shortRef("pkg:swr#default")).toBe("swr");
    expect(shortRef("apps/web/lib/auth.ts#withWorkspace")).toBe("withWorkspace");
  });

  it("reads confidence hints from the newest study run of the convention's language", () => {
    // Relabel round 4 (#104), each language's first dev set: ts and py, adjudicated final labels.
    expect(familyHint("Call wrappers")).toMatchObject({ rate: 0.952, n: 21, source: "dev set, dev-v3-relabel4-2026-11-07/ts, rubric v3, not held-out" });
    expect(familyHint("Layering")).toMatchObject({ rate: 1, n: 10 });
    expect(familyHint("Calls")).toBeNull(); // 2 cards in relabel4/ts (14 in relabel3): fewer than 5, no hint
    expect(familyHint("Naming", "python")).toMatchObject({ rate: 0.5, n: 6, source: "dev set, dev-v3-relabel4-2026-11-07/py, Python proposals only, rubric v3, not held-out" });
    expect(familyHint("Calls", "python")).toBeNull(); // 3 cards in relabel4/py: fewer than 5, no hint
    // Python's own cards only: relabel4/py's one TypeScript card (a repo rule) would make repo rules 5 cards.
    expect(familyHint("Tests", "python")).toBeNull();
    expect(familyHint("Thrown classes")).toBeNull(); // not measured
    expect(conventionLanguage("app/models.py")).toBe("python");
    expect(conventionLanguage("app/page.tsx")).toBe("typescript");
  });

  it("explains each decision, including small roles that cannot block", () => {
    const small = { ...rows[0], blockable: false, members: 9 };
    expect(describeDecision("block", small)).toMatch(/blocking needs 15/);
    expect(describeDecision("reject", rows[0])).toMatch(/never be proposed again/);
    expect(describeDecision("accept", { ...rows[0], status: "accepted", mode: "block" })).toMatch(/stays in block mode/);
  });
});

describe("tiers and effective mode (#15, #23)", () => {
  const policy = parseConventions(text("acme/conventions.yaml"));
  const rows = conventionRows(policy, census(), check());

  it("takes each convention's tier and rule kind from census, and the reason from its JSON", () => {
    const footer = rows.find((r) => /render <Footer>/.test(r.summary))!;
    expect(footer).toMatchObject({ tier: "suggestion", ruleKind: "renders", tierReason: "rule_kind", status: "accepted", effectiveMode: "advise" });
    expect(tierReasonText(footer)).toBe("rule kind is suggestion-only (renders)");
    const ws = rows.find((r) => /app\/api\/workspaces/.test(r.summary) && r.family === "Call wrappers")!;
    expect(ws).toMatchObject({ tier: "default", tierReason: null, mode: "block", effectiveMode: "block" });
  });

  it("prefers the CLI's own tier_reason (D5) and falls back to check for conventions census no longer reports", () => {
    const c = census();
    const p = { ...c.proposals[0], tier: "suggestion" as const, tier_reason: "names_package" as const };
    expect(conventionRows(policy, { ...c, proposals: [p] }).find((r) => r.id === p.id)).toMatchObject({ tier: "suggestion", tierReason: "names_package" });
    expect(tierReasonText({ tierReason: "names_package", ruleKind: null, members: 40 })).toBe("names a package symbol");
    const fromCheck = conventionRows(policy, null, check());
    expect(fromCheck.every((r) => r.tier !== null && r.ruleKind !== null)).toBe(true);
    expect(tierReason("suggestion", "wrapped_by:call", 9, c, undefined, "ts")).toBe("small_role");
    expect(tierReason("default", "calls", 90, c)).toBeNull();
  });

  it("knows a policy block that only advises (a role under 15 members)", () => {
    const small = { ...rows.find((r) => r.mode === "block")!, members: 9 };
    const report = { ...check(), conventions: check().conventions!.map((c) => (c.id === small.id ? { ...c, members: 9, effective_mode: "advise" as const } : c)) };
    const row = conventionRows(policy, census(), report).find((r) => r.id === small.id)!;
    expect(row.effectiveMode).toBe("advise");
    expect(blocksInNameOnly(row)).toBe(true);
    // Counts follow drift check: it does not block, it blocks in policy only.
    const before = countConventions(rows);
    const after = countConventions(conventionRows(policy, census(), report));
    expect(after.blocking).toBe(before.blocking - 1);
    expect(after.blockInPolicyOnly).toBe(1);
    expect(after.accepted).toBe(before.accepted);
    // Without check's conventions (older drift), the threshold decides.
    const old = { ...check(), conventions: undefined, violations: [] };
    const c = census();
    const shrunk = { ...c, proposals: c.proposals.map((p) => (p.id === small.id ? { ...p, role: { ...p.role, members: 9 } } : p)) };
    expect(conventionRows(policy, shrunk, old).find((r) => r.id === small.id)!.effectiveMode).toBe("advise");
  });

  it("blocks a suggestion only with --force, and sets block back to advise", () => {
    const audit = rows.find((r) => /render <Footer>/.test(r.summary))!;
    const ws = rows.find((r) => r.mode === "block")!;
    expect(blockDecision(audit)).toBe("force_block");
    expect(blockDecision(ws)).toBe("block");
    expect(reviewCommand("/r", "force_block", [audit.id])).toBe(`drift --root /r review --block ${audit.id} --force`);
    expect(reviewCommand("/r", "advise", [ws.id])).toBe(`drift --root /r review --advise ${ws.id}`);
    expect(describeDecision("force_block", audit)).toMatch(/suggestion/);
    expect(describeDecision("advise", ws)).toMatch(/stays accepted/);
  });
});

describe("D5 and D7: the default tier admits only in-repo TypeScript call wrappers and layering (#28, D7)", () => {
  const policy = parseConventions(text("acme/conventions.yaml"));
  const rows = conventionRows(policy, census(), check());

  it("shows why a package's decorator is a suggestion (its kind, since D7, before its target), and that a forced block keeps blocking", () => {
    const guards = rows.find((r) => r.id === "D-ccf957")!;
    expect(guards).toMatchObject({ tier: "suggestion", tierReason: "rule_kind_d7", ruleKind: "wrapped_by:decorator", namesPackage: true, mode: "block", effectiveMode: "block" });
    expect(tierReasonText(guards)).toBe("decorators, base classes and JSX wrappers are suggestions since decision D7 (wrapped_by:decorator)");
    const footer = rows.find((r) => /render <Footer>/.test(r.summary))!;
    expect(footer).toMatchObject({ tier: "suggestion", tierReason: "rule_kind", ruleKind: "renders", namesPackage: false });
  });

  it("D7 moves the acme layout wrappers and base class to suggestion; call wrappers and layering stay default", () => {
    const c = census();
    expect(c.params.tier).toMatchObject({ decision: "D7", default_rule_kinds: ["wrapped_by:call", "avoids:import"], default_languages: ["ts"], advise_only_languages: ["py"] });
    const byKind = (k: string) => c.proposals.filter((p) => p.rule_kind === k);
    for (const p of [...byKind("wrapped_by:jsx"), ...byKind("wrapped_by:extends")]) expect(p).toMatchObject({ tier: "suggestion", tier_reason: "rule_kind_d7" });
    expect(byKind("wrapped_by:jsx").length + byKind("wrapped_by:extends").length).toBeGreaterThan(0);
    for (const p of [...byKind("wrapped_by:call"), ...byKind("avoids:import")].filter((p) => !p.names_package && p.role.members >= 15)) expect(p).toMatchObject({ tier: "default", tier_reason: null });
  });

  it("takes the reason from check for conventions census no longer reports, and reads it off params.tier otherwise", () => {
    const fromCheck = conventionRows(policy, null, check()).find((r) => r.id === "D-ccf957")!;
    expect(fromCheck).toMatchObject({ tierReason: "rule_kind_d7", namesPackage: true });
    expect(tierReason("suggestion", "wrapped_by:decorator", 48, census(), undefined, "ts")).toBe("rule_kind_d7");
    expect(tierReason("suggestion", "wrapped_by:call", 48, census(), undefined, "ts")).toBe("names_package");
    expect(tierReason("suggestion", "calls", 48, census(), undefined, "ts")).toBe("rule_kind");
    // Before D7 (no decision): a kind outside the allowlist is `rule_kind`, and D5's target rule applies.
    const d5 = { ...census(), params: { ...census().params, tier: { default_rule_kinds: ["wrapped_by:call", "wrapped_by:decorator"], min_members: 15, target: "in_repo" } } };
    expect(tierReason("suggestion", "wrapped_by:jsx", 48, d5)).toBe("rule_kind");
    expect(tierReason("suggestion", "wrapped_by:decorator", 48, d5)).toBe("names_package");
    const old = { ...census(), params: { ...census().params, tier: { default_rule_kinds: ["wrapped_by:decorator"], min_members: 15 } } };
    expect(tierReason("suggestion", "wrapped_by:decorator", 48, old)).toBeNull();
  });

  it("says that every Python convention advises only (D7), from the CLI's reason or from the convention's language", () => {
    const c = census();
    const p = { ...c.proposals[0], tier: "suggestion" as const, tier_reason: "language_advise" as const };
    const row = conventionRows(policy, { ...c, proposals: [p] }).find((r) => r.id === p.id)!;
    expect(row).toMatchObject({ tier: "suggestion", tierReason: "language_advise" });
    expect(tierReasonText(row)).toBe("Python conventions advise only (decision D7)");
    // One language helper for paths (hints and tier alike), manifests included.
    for (const path of ["app/api/views.py", "app/stubs.pyi", "pyproject.toml", "libs/a/requirements-dev.txt", "setup.cfg", "Pipfile"]) {
      expect(conventionLanguage(path)).toBe("python");
      expect(tierReason("suggestion", "wrapped_by:call", 48, c, undefined, tierLanguage(undefined, null, path))).toBe("language_advise");
    }
    for (const path of ["app/api/route.ts", "src/a.jsx", "package.json"]) expect(conventionLanguage(path)).toBe("typescript");
    // The CLI's language wins; then conventions.yaml's python_members (any Python member); then the example.
    const ev = { holders: 39, total: 40, lower_bound: 0.9, lift: 2 };
    expect(tierLanguage("py", ev, "app/a.ts")).toBe("py");
    expect(tierLanguage(undefined, { ...ev, python_members: 2 }, "app/a.ts")).toBe("py");
    expect(tierLanguage(undefined, ev, "app/a.ts")).toBe("ts");
    expect(tierLanguage(undefined, ev, null)).toBeNull();
    // An unknown language gives no reason under D7: a Python decorator must not read as rule_kind_d7.
    expect(tierReason("suggestion", "wrapped_by:decorator", 48, c, undefined, null)).toBeNull();
    expect(tierReason("suggestion", "wrapped_by:decorator", 48, c, undefined, "ts")).toBe("rule_kind_d7");
    // The product's order: target before role size.
    expect(tierReason("suggestion", "wrapped_by:call", 9, c, undefined, "ts", true)).toBe("names_package");
    expect(tierReason("suggestion", "wrapped_by:call", 9, c, undefined, "ts", false)).toBe("small_role");
    // A Python proposal in census JSON without tier_reason gets it from its language or its example.
    const py = { ...c.proposals[0], id: "D-py0001", tier: "suggestion" as const, tier_reason: undefined, language: undefined, example: { path: "app/views.py", symbol: "index", line: 1 } };
    expect(conventionRows(null, { ...c, proposals: [py] }).find((r) => r.id === "D-py0001")).toMatchObject({ tierReason: "language_advise" });
    const mixed = { ...py, id: "D-py0002", language: "py" as const, example: { path: "app/a.ts", symbol: "a", line: 1 } };
    expect(conventionRows(null, { ...c, proposals: [mixed] }).find((r) => r.id === "D-py0002")).toMatchObject({ tierReason: "language_advise" });
  });
});

describe("parameter types of passed keys (#34)", () => {
  const rows = conventionRows(parseConventions(text("acme/conventions.yaml")), census(), check());

  it("says when the callee's type already requires the key", () => {
    const key = rows.find((r) => r.rule.type === "passes_key")!;
    expect(key).toMatchObject({ keyType: "required" });
    expect(keyTypeText(key.keyType, "event")).toMatch(/requires `event`/);
    expect(keyTypeText("optional", "x")).toMatch(/optional/);
    expect(keyTypeText(null, "x")).toBeNull();
    expect(rows.filter((r) => r.rule.type !== "passes_key").every((r) => r.keyType === null)).toBe(true);
  });
});

describe("what a rule is about, and inherited declarations (#27)", () => {
  const policy = parseConventions(text("acme/conventions.yaml"));

  it("never shows the unknown-base marker as a real base", () => {
    expect(isUnknownBase("global#(base)")).toBe(true);
    expect(shortRef("global#(base)")).toBe("unknown base");
    expect(ruleTargets({ type: "wrapped_by", kind: "extends", any_of: ["global#(base)", "app/models.py#BaseModel"] })).toEqual(["unknown base", "BaseModel"]);
    expect(isUnknownBase("app/base.py#(base)")).toBe(false);
  });

  it("reads exempt members with Drift's reason, inherited holders and the role size from census", () => {
    const c = census();
    const p = {
      ...c.proposals[0],
      evidence: { ...c.proposals[0].evidence, total: 30, role_members: 34 },
      role: { ...c.proposals[0].role, members: 34 },
      exempt: [{ path: "app/admin.py", symbol: "UserAdmin", line: 4, reason: "does not call FieldSet()" }],
      inherited: [{ path: "app/admin.py", symbol: "StaffAdmin", line: 20 }],
    };
    const row = conventionRows(policy, { ...c, proposals: [p] }).find((r) => r.id === p.id)!;
    expect(row.exempt).toEqual([{ path: "app/admin.py", symbol: "UserAdmin", line: 4, reason: "does not call FieldSet()" }]);
    expect(row.inherited).toHaveLength(1);
    expect(row.members).toBe(34);
    expect(row.evidence).toMatchObject({ total: 30, role_members: 34 });
    // Without the fields (older drift, or a rule about its whole role): empty, not missing.
    expect(conventionRows(policy, c).find((r) => r.id === c.proposals[1].id)).toMatchObject({ exempt: [], inherited: [] });
    expect(conventionRows(policy, null).every((r) => r.exempt === null)).toBe(true);
  });
});

describe("members and files census could not check (#32)", () => {
  const policy = parseConventions(text("acme/conventions.yaml"));

  it("reads unchecked_members per proposal, for policy and census-only rows", () => {
    const c = census();
    const [a, b] = c.proposals;
    const ours = { ...c, proposals: [{ ...a, unchecked_members: 3 }, { ...b, unchecked_members: 1 }], unchecked: ["src/gen/huge.ts"] };
    const rows = conventionRows(policy, ours);
    expect(rows.find((r) => r.id === a.id)!.uncheckedMembers).toBe(3);
    expect(rows.find((r) => r.id === b.id)!.uncheckedMembers).toBe(1);
    expect(conventionRows(null, ours).find((r) => r.id === a.id)).toMatchObject({ status: "not_in_policy", uncheckedMembers: 3 });
    // Absent (older drift, or none): 0.
    expect(conventionRows(policy, c).every((r) => r.uncheckedMembers === 0)).toBe(true);
    expect(conventionRows(policy, null).every((r) => r.uncheckedMembers === 0)).toBe(true);
  });

  it("says how many members and files were not checked", () => {
    expect(uncheckedMembersText(3)).toBe("3 members not checked (file too large to parse)");
    expect(uncheckedMembersText(1)).toBe("1 member not checked (file too large to parse)");
    expect(uncheckedMembersText(0)).toBeNull();
    expect(uncheckedMembersText(undefined)).toBeNull();
    expect(uncheckedFilesText(["a.ts", "b.ts"])).toBe("2 files not checked (file too large to parse)");
    expect(uncheckedFilesText(["a.ts"])).toBe("1 file not checked (file too large to parse)");
    expect(uncheckedFilesText([])).toBeNull();
  });
});

describe("exemption reasons for classes of another kind and the target's module (#45)", () => {
  const policy = parseConventions(text("acme/conventions.yaml"));
  const reasons = ["another kind of class (extends EventEmitter)", "another kind of class (decorated with Injectable())", "in the module that defines BaseService"];

  it("keeps census's new reason forms verbatim", () => {
    const c = census();
    const p = { ...c.proposals[0], exempt: reasons.map((reason, i) => ({ path: `src/s${i}.ts`, symbol: `S${i}`, line: i + 1, reason })) };
    const row = conventionRows(policy, { ...c, proposals: [p] }).find((r) => r.id === p.id)!;
    expect(row.exempt!.map((e) => e.reason)).toEqual(reasons);
  });

  it("falls back to drift check's exempt members for an accepted convention census does not report", () => {
    const id = policy.conventions.find((c) => c.status === "accepted")!.id;
    const other = policy.conventions.find((c) => c.status === "accepted" && c.id !== id)?.id ?? "D-ffffff";
    const report: CheckReport = {
      violations: [],
      fixed: [],
      exempt: [
        { id, path: "src/services/s00.service.ts", symbol: "Watcher", line: 5, reason: reasons[0], code: "another_kind" },
        { id, path: "src/services/base.service.ts", symbol: "BaseService", line: 1, reason: reasons[2] },
      ],
    };
    const rows = conventionRows(policy, { ...census(), proposals: [] }, report);
    expect(rows.find((r) => r.id === id)!.exempt).toEqual([
      { path: "src/services/s00.service.ts", symbol: "Watcher", line: 5, reason: reasons[0], code: "another_kind" },
      { path: "src/services/base.service.ts", symbol: "BaseService", line: 1, reason: reasons[2] },
    ]);
    // Not reported by either: unknown, not empty.
    expect(rows.find((r) => r.id === other)?.exempt ?? null).toBeNull();
    // Census wins when it reports the id (it also lists members of other rule kinds).
    const c = census();
    const p = { ...(c.proposals.find((x) => x.id === id) ?? c.proposals[0]), id, exempt: [] };
    expect(conventionRows(policy, { ...c, proposals: [p] }, report).find((r) => r.id === id)!.exempt).toEqual([]);
  });
});

describe("import-source rules (#35)", () => {
  const rule = { type: "imports_from" as const, name: "TypedDict", source: "pkg:typing_extensions#TypedDict", instead_of: ["pkg:python:typing#TypedDict"] };

  it("have a family, and one chip that reads: imports X from S (not T)", () => {
    expect(ruleFamily(rule)).toBe("Import sources");
    expect(ruleTargets(rule)).toEqual(["imports TypedDict from typing_extensions (not typing)"]);
    expect(ruleTargets({ ...rule, instead_of: ["pkg:python:typing#TypedDict", "app/compat.py#TypedDict"] })).toEqual(["imports TypedDict from typing_extensions (not typing or app/compat.py)"]);
    expect(importSource(rule)).toEqual({ name: "TypedDict", from: "typing_extensions", not: ["typing"] });
    expect(importSource({ type: "calls", callee: "x" })).toBeNull();
  });

  it("name a module as Drift does (mine.rs source_module)", () => {
    expect(sourceModule("pkg:python:typing#TypedDict")).toBe("typing");
    expect(sourceModule("pkg:django#forms.ChoiceField")).toBe("django.forms");
    expect(sourceModule("netbox/utilities/forms/fields/choices.py#ChoiceField")).toBe("netbox/utilities/forms/fields/choices.py");
    expect(sourceModule("pkg:tagflow#tag.button")).toBe("tagflow.tag");
    expect(sourceModule("plain")).toBe("plain");
  });

  it("the acme fixture has one from the real binary: a Python suggestion (D7: Python advises only), naming a package, worded as census words it", () => {
    const p = census().proposals.find((x) => x.rule.type === "imports_from")!;
    expect(p).toBeDefined();
    expect(p.rule_kind).toBe("imports_from");
    expect([p.tier, p.tier_reason, p.names_package]).toEqual(["suggestion", "language_advise", true]);
    const s = importSource(p.rule)!;
    // The Studio's words name the same modules as Drift's summary.
    expect(p.summary).toContain(`take \`${s.name}\` from ${s.from}, not ${s.not.join(" or ")}`);
    expect(p.evidence.split?.map(([m]) => m)).toEqual([s.from, ...s.not]);
    const row = conventionRows(parseConventions(text("acme/conventions.yaml")), census()).find((r) => r.id === p.id)!;
    expect(row.family).toBe("Import sources");
    expect(tierReasonText(row)).toBe("Python conventions advise only (decision D7)");
    // In TypeScript the kind alone would make it a suggestion.
    expect(tierReasonText({ ...row, tierReason: "rule_kind" })).toBe("rule kind is suggestion-only (imports_from)");
  });
});

describe("holders through a derived wrapper (F1)", () => {
  const policy = parseConventions(text("acme/conventions.yaml"));

  it("reads census `derived`, empty when census omits it and null without census", () => {
    const c = census();
    const derived = [
      {
        path: "server/routers/bookings/_router.ts",
        symbol: "MUTATION editLocation",
        line: 42,
        wrapper: "server/routers/bookings/util.ts#bookingsProcedure",
        from: "server/procedures/authedProcedure.ts#authedProcedure",
      },
    ];
    const p = { ...c.proposals[0], derived };
    const row = conventionRows(policy, { ...c, proposals: [p] }).find((r) => r.id === p.id)!;
    expect(row.derived).toEqual(derived);
    expect(shortRef(row.derived![0].wrapper)).toBe("bookingsProcedure");
    expect(conventionRows(policy, c).find((r) => r.id === c.proposals[1].id)).toMatchObject({ derived: [] });
    expect(conventionRows(policy, null).every((r) => r.derived === null)).toBe(true);
  });
});

describe("family-precision.json `latest` (scripts/make-study-fixtures.mjs)", () => {
  it("holds, per language, the newest run's own-language family table from its metrics.json", () => {
    const precision = precisionJson as unknown as { latest: Record<string, { run: string; overall: { n: number; rate: number }; families: Record<string, { n: number; rate: number }> }> };
    for (const [lang, group] of [["typescript", "typescript/javascript"], ["python", "python"]] as const) {
      const l = precision.latest[lang];
      expect(l.run.startsWith("eval/study/runs/dev-v3-relabel4-2026-11-07/")).toBe(true);
      const m = json<{ by_language: { language: string; overall: { labelled: number; accept: { p: number } }; families: { family: string; overall: { labelled: number } }[] }[] }>(`studies/runs/${l.run.slice("eval/study/runs/".length)}/metrics.json`);
      const g = m.by_language.find((x) => x.language === group)!;
      expect(l.overall.n).toBe(g.overall.labelled);
      expect(l.overall.rate).toBeCloseTo(g.overall.accept.p, 3);
      if (lang === "python") expect(l.families.Naming.n).toBe(g.families.find((f) => f.family === "naming")!.overall.labelled);
    }
  });
});

describe("admission to agents (W0)", () => {
  const policy = parseConventions(text("acme/conventions.yaml"));
  const hidden = { shown_to_agents: false, reason: "below_bar", source: "crates/drift-mine/data/family-admission.json (eval/study/runs/dev-v3-relabel4-2026-11-07, bar 85% of 10)", family: "naming", accepted: 21, n: 37, text: "not shown to agents (family below admission bar: 56% of 37)" };
  const person = { shown_to_agents: true, reason: "person", source: "conventions.yaml agents: show", family: "naming", accepted: 21, n: 37, text: "shown to agents (a person chose to show it: `agents: show`)" };

  it("shows Drift's reason on conventions agents are not shown, from census or check", () => {
    const c = census();
    const [a, b] = c.proposals;
    const ours = { ...c, proposals: [{ ...a, agents: hidden }, { ...b, agents: { ...hidden, shown_to_agents: true, reason: "default_tier", source: "default tier", text: "shown to agents (default tier)" } }] };
    const rows = conventionRows(policy, ours);
    const ra = rows.find((r) => r.id === a.id)!;
    expect(agentsHiddenText(ra)).toBe("not shown to agents (family below admission bar: 56% of 37)");
    expect(agentsHiddenText(rows.find((r) => r.id === b.id)!)).toBeNull();
    expect(agentsHiddenText(conventionRows(null, ours).find((r) => r.id === a.id)!)).toMatch(/^not shown to agents/);
    // check's record (the person's `agents: show` included) wins over census's family verdict.
    const k = check();
    const report = { ...k, conventions: [{ id: a.id, status: "accepted", mode: "advise", effective_mode: "advise", tier: "suggestion", rule_kind: "named", members: 30, blockable: true, agents: person }] } as unknown as CheckReport;
    expect(agentsHiddenText(conventionRows(policy, ours, report).find((r) => r.id === a.id)!)).toBeNull();
  });

  it("marks a default-tier card no one accepted as a block candidate (D13), never an accepted one", () => {
    const c = census();
    const [a, b] = c.proposals;
    const candidate = { shown_to_agents: false, reason: "candidate", source: "default tier (block candidate)", text: `not shown to agents (${BLOCK_CANDIDATE_TEXT})` };
    const ours = { ...c, proposals: [{ ...a, agents: candidate }, { ...b, agents: hidden }] };
    // Census only (no policy): the candidate is marked; a suggestion below the bar is not a candidate.
    const rows = conventionRows(null, ours);
    expect(isBlockCandidate(rows.find((r) => r.id === a.id)!)).toBe(true);
    expect(isBlockCandidate(rows.find((r) => r.id === b.id)!)).toBe(false);
    expect(agentsHiddenText(rows.find((r) => r.id === a.id)!)).toBe("not shown to agents (block candidate: reaches agents once you accept it)");
    // Accepted in the policy: never a candidate, even while only census's record is at hand.
    expect(isBlockCandidate({ status: "accepted", agents: candidate })).toBe(false);
    expect(isBlockCandidate({ status: "proposed", agents: candidate })).toBe(true);
    // Rejected: no longer a proposal, so no longer a candidate (drift review --json asks proposed cards only).
    expect(isBlockCandidate({ status: "rejected", agents: candidate })).toBe(false);
    expect(isBlockCandidate({ status: "not_in_policy", agents: candidate })).toBe(true);
    // check's record after the accept (shown, default tier) wins.
    const k = check();
    const report = { ...k, conventions: [{ id: a.id, status: "accepted", mode: "advise", effective_mode: "advise", tier: "default", rule_kind: "wrapped_by:call", members: 30, blockable: true, agents: { shown_to_agents: true, reason: "default_tier", source: "default tier, accepted", text: "shown to agents (default tier)" } }] } as unknown as CheckReport;
    expect(isBlockCandidate(conventionRows(policy, ours, report).find((r) => r.id === a.id)!)).toBe(false);
    // Older drift (no reason), or a malformed record: no badge.
    expect(isBlockCandidate({ status: "proposed", agents: null })).toBe(false);
    expect(isBlockCandidate({ status: "proposed", agents: { ...candidate, shown_to_agents: true } })).toBe(false);
  });

  it("reads the Python proposals state from census (D13-py)", () => {
    const off = { python_proposals: { enabled: false as const, decision: "D13-py", withheld: 3, opt_in: "proposals: {python: on} in .drift/config.yaml (census: --python-proposals)" } };
    expect(pythonProposals(off)).toEqual({ state: "off", withheld: 3, optIn: off.python_proposals.opt_in });
    expect(pythonProposalsText(pythonProposals(off))).toBe("3 Python proposals not made: Python mined proposals are off");
    expect(pythonProposalsText(pythonProposals({ python_proposals: { ...off.python_proposals, withheld: 1 } }))).toBe("1 Python proposal not made: Python mined proposals are off");
    // Off with none withheld (a TypeScript repository): nothing to say.
    expect(pythonProposalsText(pythonProposals({ python_proposals: { ...off.python_proposals, withheld: 0 } }))).toBeNull();
    // Absent: on (the default), or an older drift; no census: unknown.
    expect(pythonProposals({})).toEqual({ state: "on_or_older" });
    // The acme fixture, from the real binary: off, none withheld (its Python card was accepted before D13-py, so it stays).
    expect(pythonProposals(census())).toMatchObject({ state: "off", withheld: 0 });
    expect(pythonProposalsText(pythonProposals(census()))).toBeNull();
    expect(pythonProposals(null)).toBeNull();
  });

  it("shows the experimental agent verifier's status from check (agents.verify: on)", () => {
    const c = census();
    const [a, b] = c.proposals;
    const verified = { shown_to_agents: true, reason: "verified", source: ".drift/verify-cache.json (agent verifier, prompt v3, 2 of 3 samples)", family: "naming", accepted: 21, n: 37, text: "shown to agents (verified by agent (2/3))" };
    const row = (id: string, verify: unknown, agents: unknown) => ({ id, status: "accepted", mode: "advise", effective_mode: "advise", tier: "suggestion", rule_kind: "named", members: 30, blockable: true, agents, verify });
    const report = { ...check(), conventions: [row(a.id, { state: "passed", passes: 2, samples: 3, text: "verified by agent (2/3)" }, verified), row(b.id, { state: "stale", text: "not verified (the card changed since it was verified)" }, hidden)] } as unknown as CheckReport;
    const rows = conventionRows(policy, c, report);
    const ra = rows.find((r) => r.id === a.id)!;
    expect(verifyText(ra)).toBe("verified by agent (2/3)");
    expect(agentsHiddenText(ra)).toBeNull();
    expect(verifyText(rows.find((r) => r.id === b.id)!)).toBe("not verified");
    // Off (no `verify` reported), census-only rows, and malformed records: nothing.
    expect(conventionRows(policy, c, check()).every((r) => r.verify === null && verifyText(r) === null)).toBe(true);
    expect(conventionRows(null, c).every((r) => verifyText(r) === null)).toBe(true);
    const bad = { ...report, conventions: [row(a.id, { state: 2 }, verified)] } as unknown as CheckReport;
    expect(verifyText(conventionRows(policy, c, bad).find((r) => r.id === a.id)!)).toBeNull();
  });

  it("says nothing when Drift did not report it (older drift) or reported something malformed", () => {
    const older = { ...census(), proposals: census().proposals.map((p) => ({ ...p, agents: undefined })) };
    expect(conventionRows(policy, older).every((r) => r.agents === null && agentsHiddenText(r) === null)).toBe(true);
    const c = census();
    const ours = { ...c, proposals: c.proposals.map((p) => ({ ...p, agents: { shown_to_agents: "no" } as never })) };
    expect(conventionRows(policy, ours).every((r) => r.agents === null)).toBe(true);
  });
});

describe("review order and suggestion cap (W4: crates/drift-mine/src/rank.rs)", () => {
  const base = conventionRows(null, census())[0]!;
  const row = (id: string, status: ConventionRow["status"], tier: ConventionRow["tier"], rank: number | null): ConventionRow => ({ ...base, id, status, tier, rank });
  const rows = [
    row("D-s00009", "proposed", "suggestion", 9),
    row("D-d00002", "proposed", "default", 2),
    row("D-acc001", "accepted", "suggestion", 3),
    row("D-s00004", "not_in_policy", "suggestion", 4),
    row("D-d00001", "proposed", "default", 1),
    row("D-s00006", "proposed", "suggestion", 6),
    row("D-rej001", "rejected", "suggestion", 5),
    row("D-s0none", "proposed", "suggestion", null),
    row("D-s00007", "proposed", "suggestion", 7),
  ];

  it("lists the default tier first in the order given, then suggestions by census rank", () => {
    expect(reviewOrder(rows).map((r) => r.id)).toEqual(["D-acc001", "D-d00002", "D-d00001", "D-s00004", "D-s00006", "D-s00007", "D-s00009", "D-s0none", "D-rej001"]);
  });

  it("caps only suggestions still to decide, never the default tier or a decision", () => {
    const { listed, hidden, suggestions } = capSuggestions(reviewOrder(rows), 2);
    expect(suggestions).toBe(5);
    expect(hidden.map((r) => r.id)).toEqual(["D-s00007", "D-s00009", "D-s0none"]);
    expect(listed.map((r) => r.id)).toEqual(["D-acc001", "D-d00002", "D-d00001", "D-s00004", "D-s00006", "D-rej001"]);
    // A cap of 0 still lists the default tier; null (all) and undefined (census before the cap) hide nothing.
    expect(capSuggestions(reviewOrder(rows), 0).listed.filter((r) => r.tier === "default")).toHaveLength(2);
    expect(capSuggestions(rows, null).hidden).toEqual([]);
    expect(capSuggestions(rows, undefined).hidden).toEqual([]);
  });

  it("caps the acme review list with the cap a newer census reports", () => {
    // A census from before the cap (no `suggestion_cap`): nothing is hidden. (The committed acme census, regenerated
    // in round 9 F, reports the cap; it is removed here to read as an older one.)
    const old = { ...census(), suggestion_cap: undefined };
    expect(census().suggestion_cap).toMatchObject({ cap: 5 });
    const policy = parseConventions(text("acme/conventions.yaml"));
    const rowsOld = reviewOrder(conventionRows(policy, old));
    expect(capSuggestions(rowsOld, undefined).hidden).toEqual([]);
    // As a newer census reports it: suggestions re-ranked (here: reversed), cap 2.
    const sugg = old.proposals.filter((p) => p.tier === "suggestion").reverse();
    const ps = [...old.proposals.filter((p) => p.tier === "default"), ...sugg].map((p, i) => ({ ...p, rank: i + 1 }));
    const c = { ...old, proposals: ps, suggestion_cap: { cap: 2, from: "conventions.yaml", suggestions: sugg.length, listed: 2 } };
    // Read without the policy, as a first census before `drift init`: every suggestion is still to review (acme's
    // policy has decided all of its own).
    const ordered = reviewOrder(conventionRows(null, c));
    const toReview = ordered.filter((r) => undecided(r) && r.tier === "suggestion");
    expect(toReview.map((r) => r.rank)).toEqual([...toReview.map((r) => r.rank)].sort((a, b) => a! - b!));
    const { listed, hidden, suggestions } = capSuggestions(ordered, c.suggestion_cap.cap);
    expect(toReview.length).toBeGreaterThan(2);
    expect(suggestions).toBe(toReview.length);
    expect(hidden.map((r) => r.id)).toEqual(toReview.slice(2).map((r) => r.id));
    expect(listed.length + hidden.length).toBe(ordered.length);
    for (const r of ordered.filter((r) => r.tier === "default" || !undecided(r))) expect(listed).toContain(r);
  });
});

describe("the show policy (PLAN-R10 §4, drift_mine::show)", () => {
  const policy = parseConventions(text("acme/conventions.yaml"));
  // A proposal check still lists (acme's others are ones the show policy already hides).
  const proposed = policy.conventions.find((c) => c.status === "proposed" && !c.agents && c.rule.type !== "registered_in" && c.rule.type !== "mirrors_keys" && check().conventions!.some((k) => k.id === c.id))!;
  const decided = policy.conventions.find((c) => c.status === "accepted")!;
  const without = (r: CheckReport, id: string): CheckReport => ({ ...r, conventions: (r.conventions ?? []).filter((k) => k.id !== id) });
  const noProposal = (id: string) => ({ ...census(), proposals: census().proposals.filter((p) => p.id !== id) });

  it("drops a proposal that a newer drift's check and census both leave out", () => {
    const k = without(check(), proposed.id);
    expect(hiddenByShowPolicy(proposed, noProposal(proposed.id), k)).toBe(true);
    expect(hiddenByShowPolicy(proposed, null, k)).toBe(true);
    const rows = conventionRows(policy, noProposal(proposed.id), k);
    expect(rows.some((r) => r.id === proposed.id)).toBe(false);
    expect(rows.length).toBe(conventionRows(policy, noProposal(proposed.id), check()).length - 1);
  });

  it("keeps what a person decided, what check or census still lists, and everything an older drift reports", () => {
    expect(hiddenByShowPolicy(decided, noProposal(decided.id), without(check(), decided.id))).toBe(false);
    expect(hiddenByShowPolicy({ ...proposed, agents: "show" }, noProposal(proposed.id), without(check(), proposed.id))).toBe(false);
    expect(check().conventions?.some((k) => k.id === proposed.id)).toBe(true);
    expect(hiddenByShowPolicy(proposed, noProposal(proposed.id), check())).toBe(false);
    // A census that still proposes it (a check from before the last `drift init`).
    expect(hiddenByShowPolicy(proposed, { ...census(), proposals: [{ ...census().proposals[0], id: proposed.id }] }, without(check(), proposed.id))).toBe(false);
    // An older drift: no `conventions[]` in check, or no check at all.
    const { conventions: _c, ...old } = check();
    expect(hiddenByShowPolicy(proposed, noProposal(proposed.id), old as CheckReport)).toBe(false);
    expect(hiddenByShowPolicy(proposed, noProposal(proposed.id), null)).toBe(false);
    const wiring = { ...proposed, rule: { type: "mirrors_keys", from: "a", to: "b" } } as typeof proposed;
    expect(hiddenByShowPolicy(wiring, noProposal(proposed.id), without(check(), proposed.id))).toBe(false);
  });
});
