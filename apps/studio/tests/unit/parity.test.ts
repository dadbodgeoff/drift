// Studio parity for the 2026-11-06 Drift features: exemption codes, D7 tier reasons and
// per-convention language in Check, and the guard facts of #60 (rejects_caller,
// after_continuation). Each test pins the Studio to what Drift writes.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exemptions, filterExemptions } from "@/entities/check";
import { EXEMPTION_CODE, checkTierReasonText, conventionRows, exemptionKind, exemptionKinds, languageText, parseConventions } from "@/entities/convention";
import { GUARD_FACT, rejectsCaller } from "@/entities/facts";
import type { CheckConvention, CheckReport, Exempt, ExemptionCode } from "@/shared/contract/drift";
import { SHOWN_CONTROLS, slimFacts } from "@/shared/contract/slim";
import { census, check, text } from "./helpers";

const root = new URL("../../../../", import.meta.url);
const src = (p: string) => readFileSync(new URL(p, root), "utf8");

/** Every exemption code Drift writes: `Exempted::new("code", …)` in drift-mine's sources. */
function rustExemptionCodes(): string[] {
  const dir = new URL("crates/drift-mine/src/", root);
  const text = readdirSync(dir)
    .filter((f) => f.endsWith(".rs"))
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
  // Drift's own codes, and check.rs `REVIEWED` (a member a reviewer marked fine).
  // And check.rs `DIFFERENT_KIND` (a file a person set apart as a different kind, the one question).
  const reviewed = [...text.matchAll(/pub const (?:REVIEWED|DIFFERENT_KIND): &str = "([a-z_]+)"/g)].map((m) => m[1]);
  return [...new Set([...[...text.matchAll(/Exempted::new\(\s*"([a-z_]+)"/g)].map((m) => m[1]), ...reviewed])].sort();
}

describe("exemption codes (census and check exempt[].code)", () => {
  it("every code Drift writes has a label and a meaning, and no label is for a code Drift no longer writes", () => {
    const rust = rustExemptionCodes();
    // The codes the 2026-11-06 merges added or relied on, plus #45's.
    for (const c of ["another_kind", "defining_module", "enum", "named_for_base", "does_not_call", "shared_part", "no_input", "registered_key", "documented_exception", "opt_out", "own_target", "factory", "companion", "reviewed", "different_kind"]) expect(rust, c).toContain(c);
    expect(rust.filter((c) => !(c in EXEMPTION_CODE)), "add these to entities/convention/exemptions.ts EXEMPTION_CODE and to ExemptionCode").toEqual([]);
    expect(Object.keys(EXEMPTION_CODE).sort()).toEqual(rust);
    for (const [c, k] of Object.entries(EXEMPTION_CODE)) {
      expect(k.label.length, c).toBeGreaterThan(3);
      expect(k.why.length, c).toBeGreaterThan(30);
    }
    // Labels are distinct, so a tag names one kind.
    expect(new Set(Object.values(EXEMPTION_CODE).map((k) => k.label)).size).toBe(Object.keys(EXEMPTION_CODE).length);
  });

  it("an unknown code reads as Drift spells it; no code reads as none", () => {
    expect(exemptionKind("shared_part")).toMatchObject({ label: "shared part", code: "shared_part" });
    expect(exemptionKind("some_new_kind")).toMatchObject({ label: "some new kind", code: "some_new_kind" });
    expect(exemptionKind(undefined)).toBeNull();
    expect(exemptionKind("")).toBeNull();
  });

  it("counts exempt members by kind, most first, members without a code apart", () => {
    const ex: Pick<Exempt, "code">[] = [{ code: "shared_part" }, { code: "opt_out" }, { code: "shared_part" }, {}, { code: "own_target" }];
    expect(exemptionKinds(ex)).toEqual([
      { code: "shared_part", label: "shared part", n: 2 },
      { code: null, label: "no kind given", n: 1 },
      { code: "opt_out", label: "opts out", n: 1 },
      { code: "own_target", label: "the rule's own target", n: 1 },
    ]);
  });

  it("the acme fixture's exemptions carry codes the Studio labels, in census and in check", () => {
    const fromCensus = census().proposals.flatMap((p) => p.exempt ?? []);
    const fromCheck = exemptions(check());
    expect(fromCensus.length).toBeGreaterThan(0);
    expect(fromCheck.length).toBeGreaterThan(0);
    for (const e of [...fromCensus, ...fromCheck]) expect(e.code && e.code in EXEMPTION_CODE, `${e.path}#${e.symbol}: ${e.code}`).toBe(true);
  });

  it("Check's filter finds exempt members by kind, by code and by label", () => {
    const es = [
      { id: "D-aaaaaa", path: "a.ts", symbol: "A", line: 1, reason: "the rule's own target", code: "own_target" },
      { id: "D-aaaaaa", path: "b.ts", symbol: "B", line: 1, reason: "opts out with SkipAuth() (@acme/auth, the package Auth() wraps)", code: "opt_out" as ExemptionCode },
      { id: "D-aaaaaa", path: "c.ts", symbol: "C", line: 1, reason: "shared part used by 3 members" },
    ];
    expect(filterExemptions(es, "opts out").map((e) => e.symbol)).toEqual(["B"]);
    expect(filterExemptions(es, "own_target").map((e) => e.symbol)).toEqual(["A"]);
    expect(filterExemptions(es, "shared part").map((e) => e.symbol)).toEqual(["C"]);
  });

  it("a convention row keeps each exempt member's code, from census or, for a policy-only convention, from check", () => {
    const policy = parseConventions(text("acme/conventions.yaml"));
    const rows = conventionRows(policy, census(), check());
    const withExempt = rows.filter((r) => (r.exempt?.length ?? 0) > 0);
    expect(withExempt.length).toBeGreaterThan(0);
    expect(withExempt.flatMap((r) => r.exempt!).every((e) => typeof e.code === "string")).toBe(true);
    // Census does not report it: check's exempt[] (with its code) stands in.
    const id = policy.conventions[0].id;
    const r: CheckReport = { violations: [], fixed: [], exempt: [{ id, path: "x.ts", symbol: "X", line: 3, reason: "the rule's own target", code: "own_target" }] };
    expect(conventionRows(policy, null, r).find((x) => x.id === id)!.exempt).toEqual([{ path: "x.ts", symbol: "X", line: 3, reason: "the rule's own target", code: "own_target" }]);
  });
});

describe("D7 in Check: the tier reason and the convention's language (check conventions[])", () => {
  const conv = (over: Partial<CheckConvention>): CheckConvention => ({ id: "D-aaaaaa", status: "accepted", mode: "advise", effective_mode: "advise", tier: "suggestion", tier_reason: null, language: "ts", names_package: false, rule_kind: "calls", members: 40, blockable: true, ...over });

  it("says why a violation's convention is a suggestion, from the CLI's own reason", () => {
    expect(checkTierReasonText(conv({ tier_reason: "language_advise", language: "py" }))).toBe("Python conventions advise only (decision D7)");
    expect(checkTierReasonText(conv({ tier_reason: "rule_kind_d7", rule_kind: "wrapped_by:decorator" }))).toBe("decorators, base classes and JSX wrappers are suggestions since decision D7 (wrapped_by:decorator)");
    expect(checkTierReasonText(conv({ tier_reason: "rule_kind", rule_kind: "calls" }))).toBe("rule kind is suggestion-only (calls)");
    expect(checkTierReasonText(conv({ tier_reason: "names_package" }))).toBe("names a package symbol");
    expect(checkTierReasonText(conv({ tier_reason: "small_role", members: 9 }))).toBe("9 members; the default tier needs 15");
    // The default tier has no reason; neither has an unknown convention or reason.
    expect(checkTierReasonText(conv({ tier: "default" }))).toBeNull();
    expect(checkTierReasonText(null)).toBeNull();
    expect(checkTierReasonText(conv({ tier_reason: "something_new" as never }))).toBeNull();
  });

  it("every suggestion in the acme check report has a reason the Check view can show", () => {
    const r = check();
    const sugg = (r.conventions ?? []).filter((c) => c.tier === "suggestion");
    expect(sugg.length).toBeGreaterThan(0);
    for (const c of sugg) expect(checkTierReasonText(c), c.id).toBeTruthy();
    // A violation of a forced block (UseGuards, D7) has its convention's reason.
    const forced = r.violations.find((v) => v.tier === "suggestion" && v.mode === "block");
    if (forced) expect(checkTierReasonText(r.conventions!.find((c) => c.id === forced.id))).toMatch(/decision D7/);
  });

  it("names a convention's language, with how many members made it Python", () => {
    expect(languageText("py", { python_members: 3 }, 40)).toMatchObject({ label: "Python" });
    expect(languageText("py", { python_members: 3 }, 40)!.why).toMatch(/3 of its 40 members are Python.*advises only/);
    expect(languageText("py", null)!.why).toMatch(/its members are Python/);
    expect(languageText("ts")).toMatchObject({ label: "TypeScript/JavaScript" });
    expect(languageText(null)).toBeNull();
  });

  it("every convention row has the language the tier read: the CLI's, else python_members, else the example", () => {
    const policy = parseConventions(text("acme/conventions.yaml"));
    const rows = conventionRows(policy, census(), check());
    expect(rows.every((r) => r.language === "ts" || r.language === "py")).toBe(true);
    const py = rows.find((r) => r.tierReason === "language_advise")!;
    expect(py.language).toBe("py");
    // Without the CLI's language: python_members decides.
    const c = census();
    const p = { ...c.proposals[0], language: undefined, evidence: { ...c.proposals[0].evidence, python_members: 2 } };
    expect(conventionRows(null, { ...c, proposals: [p] })[0].language).toBe("py");
  });
});

describe("guard facts (#60): rejects_caller and after_continuation", () => {
  it("slim facts keep the controls the Studio shows and the callees acted on after the continuation", () => {
    const facts = src("crates/drift-core/src/facts.rs");
    for (const c of SHOWN_CONTROLS) expect(facts, c).toContain(`"${c}"`);
    expect(facts).toMatch(/pub after_continuation: Vec<String>/);
    const sym = { name: "withTiming", kind: "function" as const, exported_as: ["withTiming"], line: 1, wraps: [], controls: ["await", "rejects_caller", "try"], after_continuation: ["apps/web/lib/timing.ts#record"] };
    const out = slimFacts({ schema_version: 9, skipped: [], files: [{ path: "a.ts", lang: "ts", package: "", parse_ok: true, directives: [], imports: [], symbols: [sym, { ...sym, name: "plain", controls: ["await"], after_continuation: [] }], entry_points: [] }] });
    expect(out.files[0].symbols[0].controls).toEqual(["rejects_caller"]);
    expect(out.files[0].symbols[0].after_continuation).toEqual(["apps/web/lib/timing.ts#record"]);
    expect(out.files[0].symbols[1]).not.toHaveProperty("controls");
    expect(out.files[0].symbols[1]).not.toHaveProperty("after_continuation");
  });

  it("keeps a Python error raised only after the continuation (#79) as raised, and no other thrown class", () => {
    // facts.rs: Python lists, in after_continuation, errors of `throws` raised only there.
    expect(src("crates/drift-core/src/facts.rs")).toMatch(/Python also lists errors of\s*\/\/\/ \[`Symbol::throws`\] raised only there/);
    const sym = { name: "map_errors", kind: "function" as const, exported_as: [], line: 3, wraps: [], throws: ["global#OSError", "pkg:rest_framework#exceptions.PermissionDenied"], after_continuation: ["app/log.py#logger.error", "global#OSError"] };
    const out = slimFacts({ schema_version: 9, skipped: [], files: [{ path: "a.py", lang: "py", package: "", parse_ok: true, directives: [], imports: [], symbols: [sym, { ...sym, name: "before", after_continuation: [] }], entry_points: [] }] });
    expect(out.files[0].symbols[0].throws).toEqual(["global#OSError"]);
    expect(out.files[0].symbols[0].after_continuation).toEqual(["app/log.py#logger.error", "global#OSError"]);
    expect(out.files[0].symbols[1]).not.toHaveProperty("throws");
    expect(GUARD_FACT.raisedAfter.why).toMatch(/Raised only after .* no guard/);
  });

  it("says what each fact means for a guard", () => {
    expect(rejectsCaller({ controls: ["rejects_caller"] })).toBe(true);
    expect(rejectsCaller({ controls: ["reads_input"] })).toBe(false);
    expect(rejectsCaller({})).toBe(false);
    expect(GUARD_FACT.rejects.why).toMatch(/guard/);
    expect(GUARD_FACT.after.why).toMatch(/no guard/);
  });
});

describe("role selectors (census and conventions.yaml role)", () => {
  it("the contract's RoleSelector has every field drift-mine's RoleSelector writes", () => {
    const rust = src("crates/drift-mine/src/roles.rs");
    const body = rust.slice(rust.indexOf("pub struct RoleSelector {"), rust.indexOf("\n}\n", rust.indexOf("pub struct RoleSelector {")));
    const fields = [...body.matchAll(/^\s*pub ([a-z_]+):/gm)].map((m) => m[1]);
    expect(fields).toContain("export_name");
    const ts = src("apps/studio/src/shared/contract/drift.ts");
    const iface = ts.slice(ts.indexOf("export interface RoleSelector {"), ts.indexOf("\n}\n", ts.indexOf("export interface RoleSelector {")));
    for (const f of fields) expect(iface, f).toMatch(new RegExp(`^\\s*${f}\\??:`, "m"));
    // A convention's frozen selector version (policy.rs) is in the contract too.
    expect(src("crates/drift-mine/src/policy.rs")).toContain("pub selector_version: u32");
    expect(ts).toMatch(/^\s*selector_version\?: number;/m);
    // The role panel shows a reserved export name when the role has one.
    expect(src("apps/studio/src/features/conventions/ConventionsView.tsx")).toContain("row.role.export_name");
    // W1: a role of one member kind (a Python class's framework lineage) says which.
    expect(fields).toContain("member_kind");
    expect(src("apps/studio/src/features/conventions/ConventionsView.tsx")).toContain("row.role.member_kind");
    // D: a merged card's role lists the sibling roles it also covers.
    expect(fields).toContain("also");
    expect(src("apps/studio/src/features/conventions/ConventionsView.tsx")).toContain("row.role.also");
  });
});
