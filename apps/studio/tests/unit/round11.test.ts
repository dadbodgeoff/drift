// Round 11 parity, on fixtures the frozen F11 binary wrote (scripts/make-fixtures.mjs from scripts/acme-seed,
// scripts/make-round11-fixtures.mjs): the candidate tier, Python proposals off with the opt-in, the show policy, the
// one-question calibration's answers as drift check applies them, the neighbour gate off by default and on, the
// beta's accuracy wording, and the empty and error states.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NEIGHBOUR_GATE_ENV, driftEnv, driftErrorLine, neighbourGate } from "../../electron/ops";
import { checkCounts, holdOf, neighbourHolds, stateOf } from "@/entities/check";
import { ACCURACY, REVIEW_FIRST_TEXT, conventionRows, exemptionKind, hiddenByShowPolicy, isBlockCandidate, parseConventions, pctOf, pythonProposals, pythonProposalsText } from "@/entities/convention";
import type { Census, CheckReport } from "@/shared/contract/drift";
import { json, text } from "./helpers";

const repo = (id: string) => ({
  census: json<Census>(`${id}/census.json`),
  check: json<CheckReport>(`${id}/check.json`),
  policy: parseConventions(text(`${id}/conventions.yaml`)),
});

describe("fixtures from the F11 binary", () => {
  it("are what the release build printed (its version) and say how the neighbour gate was set", () => {
    for (const id of ["acme", "beacon", "quiet", "broken"]) expect(json<{ version: string }>(`${id}/version.json`).version, id).toBe("drift 0.1.0-dev");
    expect(json<{ neighbourGate?: string }>("beacon/version.json").neighbourGate).toBe("on");
    expect(json<{ neighbourGate?: string }>("quiet/version.json").neighbourGate).toBe("off");
    expect(json<{ repos: { id: string }[] }>("index.json").repos.map((r) => r.id)).toEqual(["acme", "beacon", "quiet", "broken"]);
  });
});

describe("the candidate tier (D13)", () => {
  it("acme: one block candidate left proposed; beacon: none left after the answers", () => {
    const a = repo("acme");
    const rows = conventionRows(a.policy, a.census, a.check);
    expect(rows.filter(isBlockCandidate).map((r) => r.id)).toEqual(["D-50ba36"]);
    expect(a.census.agents?.candidates).toBeGreaterThan(0);
    const b = repo("beacon");
    expect(conventionRows(b.policy, b.census, b.check).filter(isBlockCandidate)).toEqual([]);
    // Every beacon card was a candidate when census ran first: census keeps reporting the default tier as candidates.
    expect(b.census.proposals.every((p) => p.agents?.reason === "candidate")).toBe(true);
  });

  it("says the beta's figure beside them, as docs/ACCURACY.md has it", () => {
    const doc = readFileSync(new URL("../../../../docs/ACCURACY.md", import.meta.url), "utf8");
    const row = (what: RegExp) => doc.split("\n").find((l) => l.startsWith("|") && what.test(l)) ?? "";
    const f = (fig: { k: number; n: number; lo: number; hi: number }) => `(${fig.k}/${fig.n})`;
    expect(row(/\*\*default tier\*\*/)).toContain(`**46.7% ${f(ACCURACY.defaultTier)}**`);
    expect(row(/\*\*default tier\*\*/)).toContain(`Wilson ${ACCURACY.defaultTier.lo.toFixed(1)}–${ACCURACY.defaultTier.hi.toFixed(1)}%`);
    expect(row(/\*\*suggestions\*\*/)).toContain(`**85.7% ${f(ACCURACY.suggestions)}**`);
    expect(row(/\*\*everything shown\*\* after the show policy: accepted/)).toContain(`**58.3% ${f(ACCURACY.shown)}**`);
    expect(row(/\*\*everything shown\*\* after the show policy: accepted/)).toContain(`${ACCURACY.shownInSample}% (43/46)`);
    expect(doc).toContain(`≥ ${ACCURACY.gate}% accepted on a held-out set`);
    expect(pctOf(ACCURACY.shown)).toBe(58);
    expect(REVIEW_FIRST_TEXT).toContain("7 of 15");
    // README's wording (#140).
    expect(readFileSync(new URL("../../../../README.md", import.meta.url), "utf8")).toContain("about half\n>   of the default-tier cards (7 of 15)");
  });
});

describe("Python proposals (D13-py)", () => {
  it("beacon: off, its one Python proposal withheld, with the opt-in Drift names; quiet: opted in", () => {
    const b = pythonProposals(json<Census>("beacon/census.json"))!;
    expect(b).toMatchObject({ state: "off", withheld: 1 });
    expect(b.state === "off" && b.optIn).toContain("proposals: {python: on}");
    expect(pythonProposalsText(b)).toMatch(/1 Python proposal/);
    expect(pythonProposals(json<Census>("quiet/census.json"))).toMatchObject({ state: "on_or_older" });
  });
});

describe("the show policy (#129)", () => {
  it("acme: proposals an older Drift wrote, of families F11 no longer shows, are no rows", () => {
    const a = repo("acme");
    const hidden = a.policy.conventions.filter((c) => hiddenByShowPolicy(c, a.census, a.check));
    expect(hidden.map((c) => c.id)).toEqual(["D-b5f755", "D-be239c"]);
    expect(hidden.every((c) => c.status === "proposed")).toBe(true);
    expect(conventionRows(a.policy, a.census, a.check).some((r) => hidden.some((c) => c.id === r.id))).toBe(false);
  });
});

describe("the one question's answers, as drift check applies them (#143)", () => {
  const b = repo("beacon");
  const rows = conventionRows(b.policy, b.census, b.check);

  it("same and different accept; not-a-convention rejects", () => {
    const by = new Map(rows.map((r) => [r.summary.match(/withSession|packages\/core|packages\/ui|packages\/jobs/)?.[0], r]));
    expect(by.get("withSession")!.status).toBe("accepted");
    expect(by.get("packages/core")!.status).toBe("accepted");
    expect(by.get("packages/ui")!.status).toBe("accepted");
    expect(by.get("packages/jobs")!.status).toBe("rejected");
  });

  it("files set apart are on the row; an entry point only when it was confirmed [STRICT]", () => {
    const route = rows.find((r) => /withSession/.test(r.summary))!;
    // The status probe was picked without its tick: Drift wrote only the health probe, with its entry point.
    expect(route.differentKind).toEqual([{ path: "apps/portal/app/api/health/route.ts", entry_points: ["GET"] }]);
    const core = rows.find((r) => /packages\/core/.test(r.summary))!;
    expect(core.differentKind.map((d) => d.path)).toEqual(["packages/core/src/fixtures.ts", "packages/core/src/seed.ts"]);
    const exempt = b.check.exempt ?? [];
    expect(exempt.filter((e) => e.code === "different_kind").map((e) => e.path).sort()).toEqual(["apps/portal/app/api/health/route.ts", "packages/core/src/fixtures.ts", "packages/core/src/seed.ts"]);
    expect(exemptionKind("different_kind")?.label).toBe("set apart: a different kind");
    // As `drift review --show` lists them: what check sets apart is no outlier (census, mining afresh, still lists it),
    // but a member the rule is not about; the unconfirmed probe and the legacy import stay outliers.
    expect(route.outliers!.map((o) => o.path)).toEqual(["apps/portal/app/api/refunds/route.ts", "apps/portal/app/api/status/route.ts"]);
    expect(route.exempt!.filter((e) => e.code === "different_kind").map((e) => e.path)).toEqual(["apps/portal/app/api/health/route.ts"]);
    expect(core.outliers!.map((o) => o.path)).toEqual(["packages/core/src/fixtures-billing.ts", "packages/core/src/late.ts", "packages/core/src/legacy.ts"]);
    expect(core.outliersTotal).toBe(3);
    // Kept flagged: the unconfirmed probe and the legacy core import are still violations.
    const flagged = b.check.violations.map((v) => v.path);
    expect(flagged).toContain("apps/portal/app/api/status/route.ts");
    expect(flagged).toContain("packages/core/src/legacy.ts");
  });
});

describe("the neighbour gate (#144)", () => {
  const on = json<CheckReport>("beacon/check.json");
  const off = json<CheckReport>("beacon/check-gate-off.json");

  it("off (the default): nothing held back, the same member is a new warning", () => {
    expect(off.suppressed_neighbour).toBeUndefined();
    expect(neighbourHolds(off)).toEqual([]);
    const v = off.violations.find((x) => x.path === "packages/core/src/fixtures-billing.ts")!;
    expect(stateOf(v)).toBe("new");
    expect(checkCounts(off).held).toBe(0);
  });

  it("on: that warning is held back and listed with its nearest set-apart member and holder; an entry point never is", () => {
    const holds = neighbourHolds(on);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ path: "packages/core/src/fixtures-billing.ts", nearest_apart: "packages/core/src/fixtures.ts#(file)", apart_code: "different_kind" });
    expect(holds[0].apart_distance).toBeLessThan(holds[0].holder_distance);
    const v = on.violations.find((x) => x.path === holds[0].path)!;
    expect(stateOf(v)).toBe("held");
    expect(holdOf(holds, v)).toEqual(holds[0]);
    expect(checkCounts(on)).toMatchObject({ held: 1, new: checkCounts(off).new - 1 });
    // The new route without the wrapper is an entry point under a guard rule: new, never held.
    expect(stateOf(on.violations.find((x) => x.path === "apps/portal/app/api/refunds/route.ts")!)).toBe("new");
    // PR mode keeps the holds of the violations it keeps.
    expect(neighbourHolds(json<CheckReport>("beacon/check-diff.json")).map((h) => h.path)).toEqual(["packages/core/src/fixtures-billing.ts"]);
  });

  it("the desktop app passes DRIFT_NEIGHBOUR_GATE through as Drift reads it: on only for `on`", () => {
    expect(NEIGHBOUR_GATE_ENV).toBe("DRIFT_NEIGHBOUR_GATE");
    for (const [v, want] of [["on", "on"], [" on\n", "on"], ["off", "off"], ["1", "off"], ["ON", "off"], [undefined, "off"]] as const) {
      const base = v === undefined ? { PATH: "/bin" } : { PATH: "/bin", DRIFT_NEIGHBOUR_GATE: v };
      expect(neighbourGate(base), String(v)).toBe(want);
      expect(driftEnv(base, "/c").DRIFT_NEIGHBOUR_GATE, String(v)).toBe(want === "on" ? "on" : undefined);
    }
  });
});

describe("empty and error states", () => {
  it("quiet: nothing proposed, no question, a clean check", () => {
    const q = repo("quiet");
    expect(q.census.conventions).toBe(0);
    expect(q.census.proposals).toEqual([]);
    expect(q.policy.conventions).toEqual([]);
    expect(conventionRows(q.policy, q.census, q.check)).toEqual([]);
    expect(json<{ candidates: unknown[] }>("quiet/review-questions.json").candidates).toEqual([]);
    expect(checkCounts(q.check)).toMatchObject({ new: 0, blocking: 0, held: 0 });
  });

  it("broken: the Studio cannot read the policy either, and a failed run says Drift's error line", () => {
    expect(() => parseConventions(text("broken/conventions.yaml"))).toThrow();
    const stderr = "drift: warning: something first\ndrift: parsing ./.drift/conventions.yaml: error: line 14 column 11: externally tagged enum\n  --> <input>:14:11\n   |\n14 |   status: [accepted\n   |           ^ externally tagged enum\n   |: externally tagged enum at line 14, column 11\n";
    expect(driftErrorLine(stderr)).toBe("parsing ./.drift/conventions.yaml: error: line 14 column 11: externally tagged enum");
    expect(driftErrorLine("plain failure\n")).toBe("plain failure");
    expect(driftErrorLine("")).toBeNull();
  });
});
