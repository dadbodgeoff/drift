// D5 — `@prisma/client` finding granularity (D5.1) and invocation evidence (D5.2). TDD §5.5.
//
// Two things this file is careful NOT to claim.
//
// 1. It does not book the `import type` skip as a fix. `facts.rs` already returns no bindings
//    for `import type …` and already erases a value import whose binding only ever appears in
//    a type position. Both are PINNED here, at their pre-existing behaviour, because the
//    measured 35 papermark findings are plain value imports of generated enums and neither
//    skip removes one of them. A test that pins is worth having; a changelog entry claiming
//    those two lines as D5.1's win is not.
//
// 2. It does not treat "zero findings" as the target for the ambiguous routes. D5.2's rule is
//    suppress-on-absence, retain-on-ambiguity. Every route below that stays flagged is
//    asserted to *say why* it stayed flagged, because a retained finding with no cited
//    evidence is a defect in the classifier and a retained finding with cited evidence is a
//    correct conservative call. The assertion has to be able to tell those apart.
//
// The fixture is `gt-prisma-imports`, not an extension of `gt-data-access`. TDD §5.5 asks for
// the new routes to be added to `gt-data-access`, but §5.4's suite asserts
// `expect(flagged).toEqual(GENUINE)` on that fixture — an exact list of four. Four of the
// routes §5.5 asks for must STAY FLAGGED, so adding them there breaks another track's suite by
// construction. Separate fixture; `gt-data-access` is still exercised below, read-only, as the
// control that D5.2 does not silence the audit's true positives.

import { afterEach, describe, expect, it } from "vitest";
import { cleanupGtTempDirs, flaggedPaths, readFindings, runGtWorkflow } from "./gt-harness.js";

afterEach(cleanupGtTempDirs);

const DATA_ACCESS_KIND = "api_route_no_direct_data_access";
const FIXTURE = "gt-prisma-imports";

interface Finding {
  file_path: string | undefined;
  message: string;
}

async function prismaImportFindings(): Promise<Finding[]> {
  const run = await runGtWorkflow({ fixture: FIXTURE, acceptKinds: [DATA_ACCESS_KIND] });
  return readFindings(run.databasePath, run.repoId)
    .filter((finding) => finding.kind === DATA_ACCESS_KIND)
    .map((finding) => ({ file_path: finding.file_path, message: finding.message }));
}

function forRoute(findings: Finding[], route: string): Finding[] {
  return findings.filter((finding) => finding.file_path === `pages/api/${route}`);
}

/** Every finding, one per line, so a failure names what was actually produced. */
function render(findings: Finding[]): string {
  if (findings.length === 0) return "(none)";
  return findings.map((finding) => `  ${finding.file_path} :: ${finding.message}`).join("\n");
}

describe("D5.1 — one finding per import statement", () => {
  it("collapses a multi-specifier import line into a single finding naming every specifier", async () => {
    const findings = await prismaImportFindings();
    const route = forRoute(findings, "route-multi-specifier.ts");

    expect(
      route.length,
      "D5.1 DEFECT: `import { prismaClient, auditLog } from \"../../lib/prisma\"` is ONE import " +
        "statement and must produce ONE finding listing both offending specifiers. The rule fans " +
        `out one finding per specifier instead. Got ${route.length}:\n${render(route)}`
    ).toBe(1);

    // Sorted, not source-ordered. The specifier order in a finding must not depend on the order
    // facts happened to be emitted in — that is a determinism input, and `eval:determinism` is a
    // release gate. Asserted as the exact joined string so a change to that decision is visible
    // here rather than only in a nightly.
    expect(
      route[0].message,
      `D5.1 DEFECT: the grouped finding must name every offending specifier on the line, sorted. Message was:\n  ${route[0].message}`
    ).toContain("imports auditLog, prismaClient from ../../lib/prisma");
  }, 180000);

  it("collapses the three-specifier enum line the same way, before D5.2 has an opinion", async () => {
    const findings = await prismaImportFindings();
    const route = forRoute(findings, "route-enum-multi-specifier.ts");

    // D5.2 later takes this to zero. Asserted as "at most one" so the two phases can land in
    // either order without this test having to be rewritten between them, while still failing
    // at baseline, where it is three.
    expect(
      route.length,
      "D5.1 DEFECT: three specifiers on one `@prisma/client` import line produced " +
        `${route.length} findings; one import statement is one finding.\n${render(route)}`
    ).toBeLessThanOrEqual(1);
  }, 180000);

  // --- PINS. These already hold. They are here so a later change cannot quietly remove them,
  // --- and they are labelled as pins so nobody books them as D5.1's reduction.
  it("PIN: `import type` produces no finding — pre-existing behaviour, not a D5.1 change", async () => {
    const findings = await prismaImportFindings();

    expect(
      forRoute(findings, "route-type-only-import.ts"),
      "PIN BROKEN: `import type { DocumentVersion } from \"@prisma/client\"` binds nothing at " +
        "runtime and facts.rs already emits no import_used fact for it. This has never produced " +
        "a finding; if it does now, something upstream regressed."
    ).toHaveLength(0);
  }, 180000);

  it("PIN: a value import used only in a type position produces no finding — also pre-existing", async () => {
    const findings = await prismaImportFindings();

    expect(
      forRoute(findings, "route-type-position.ts"),
      "PIN BROKEN: `import { ItemType }` used only as `const kind: ItemType` is erased at " +
        "runtime, and apply_runtime_use_analysis already drops the fact. This is why the type " +
        "skip removes zero of papermark's 35 — those are value-position enum reads, below."
    ).toHaveLength(0);
  }, 180000);
});

describe("D5.2 — invocation evidence", () => {
  it("suppresses a specifier with no invocation evidence at all", async () => {
    const findings = await prismaImportFindings();

    expect(
      forRoute(findings, "route-enum-comparison.ts"),
      "D5.2 DEFECT: `LinkType` is imported from @prisma/client and only ever READ as a member " +
        "(`req.query.kind === LinkType.GROUP`). A member read cannot touch the datastore, there " +
        "is no symbol_called fact, no `new`, and no member call — absence of evidence, so the " +
        "finding must be suppressed. It is being flagged on the import alone. This is the shape " +
        "of all 35 papermark @prisma/client findings."
    ).toHaveLength(0);

    expect(
      forRoute(findings, "route-enum-multi-specifier.ts"),
      "D5.2 DEFECT: ItemType, ViewType and LinkAudienceType are all member-read enum constants " +
        "with no invocation evidence; all three must be suppressed."
    ).toHaveLength(0);
  }, 180000);

  it("retains a `new` instantiation — the one genuine violation shape", async () => {
    const findings = await prismaImportFindings();
    const route = forRoute(findings, "route-new-client.ts");

    expect(
      route.length,
      "D5.2 REGRESSION: `new PrismaClient()` is the genuine violation shape §5.5 names. The " +
        "engine emits NO fact for a `new_expression` — walk_node handles call_expression only — " +
        "so a classifier reading symbol_called facts alone sees the same nothing here as it sees " +
        "for an inert enum, and silently suppresses a real datastore client. It must stay flagged.\n" +
        render(route)
    ).toBe(1);
  }, 180000);

  it("retains an invocation reached through an import alias", async () => {
    const findings = await prismaImportFindings();

    expect(
      forRoute(findings, "route-aliased-invocation.ts").length,
      "D5.2 REGRESSION: `import { prismaClient as db }` then `db.user.findMany()` is a member " +
        "CALL on the imported binding under its local name. Must stay flagged."
    ).toBe(1);
  }, 180000);

  it("retains a member read whose result is later invoked", async () => {
    const findings = await prismaImportFindings();

    expect(
      forRoute(findings, "route-reassignment.ts").length,
      "D5.2 REGRESSION: `const q = prismaClient.user.findMany; await q()` — §5.5's reassignment " +
        "case. The read produces no fact and `q()` names a local, so a fact-only classifier sees " +
        "no evidence and suppresses a real query. Must stay flagged."
    ).toBe(1);
  }, 180000);

  // --- The retain-on-AMBIGUITY branch, asserted as a distinct branch rather than as a count.
  // --- The gate in §7 is not "how many are left" but "does each survivor cite the evidence
  // --- that kept it". A survivor with no cited evidence is a classifier defect.
  it("retains dynamic member access AND says that ambiguity is why", async () => {
    const findings = await prismaImportFindings();
    const route = forRoute(findings, "route-dynamic-member.ts");

    expect(
      route.length,
      "D5.2 REGRESSION: `prismaClient[store].findMany()` computes the member, so no syntactic " +
        "classification of the use exists. Retain-on-ambiguity: must stay flagged."
    ).toBe(1);

    expect(
      route[0].message,
      "D5.2 DEFECT: this finding was retained because its use could not be CLASSIFIED, not " +
        "because a datastore access was PROVEN, and the message must say which. A retained " +
        "finding that cites no ambiguous-use evidence is indistinguishable from the pre-D5.2 " +
        `flag-on-import behaviour. Message was:\n  ${route[0].message}`
    ).toMatch(/could not be classified \(dynamic_member_access\)/);
  }, 180000);

  it("retains an escaping reference AND says that ambiguity is why", async () => {
    const findings = await prismaImportFindings();
    const route = forRoute(findings, "route-escaping-read.ts");

    expect(
      route.length,
      "D5.2 REGRESSION: `countUsers(prismaClient)` hands the client to a callee this rule does " +
        "not follow. Whether the datastore is touched is unresolved, not absent. Must stay flagged."
    ).toBe(1);

    expect(
      route[0].message,
      "D5.2 DEFECT: an escaping reference is the ambiguity branch, and the finding must cite it " +
        `rather than read as a proven violation. Message was:\n  ${route[0].message}`
    ).toMatch(/could not be classified \(reference_escapes\)/);
  }, 180000);

  // Not a hypothetical. Measured by running this classifier over the local papermark checkout
  // against the audit's own 35 recorded `@prisma/client` findings: two of them are this shape.
  // The audit hand-checked all 35 as inert enum imports; `Prisma.sql` is a tagged template,
  // which parses as a call_expression, and the fragments it builds are executed by
  // `prisma.$queryRaw`. Pinned so a later precision refinement cannot quietly suppress raw-SQL
  // construction on its way to making a predicted number land.
  it("retains a `Prisma.sql` tagged template — a member call, not an enum read", async () => {
    const findings = await prismaImportFindings();
    // Two import statements in this route, so two findings; the `@prisma/client` one is the
    // subject here.
    const route = forRoute(findings, "route-tagged-template-sql.ts").filter((finding) =>
      finding.message.includes("from @prisma/client")
    );

    expect(
      route.length,
      "D5.2 REGRESSION: `Prisma.sql`...`` invokes `sql` on the imported `Prisma` namespace. " +
        `It must stay flagged, and as proven invocation rather than ambiguity.\n${render(route)}`
    ).toBe(1);

    expect(
      route[0].message,
      "D5.2 DEFECT: this is a PROVEN member call. Labelling it unclassified would make the " +
        `ambiguity clause meaningless on the findings that really are ambiguous.\n  ${route[0].message}`
    ).not.toMatch(/could not be classified/);
  }, 180000);

  it("leaves exactly the seven routes with invocation or ambiguity evidence", async () => {
    const findings = await prismaImportFindings();
    const flagged = [
      ...new Set(findings.map((finding) => finding.file_path ?? "(no path)"))
    ].sort();

    expect(
      flagged,
      `D5 DEFECT: after grouping and invocation evidence the fixture's flagged routes should be ` +
        `exactly the five with proven invocation and the two with unresolvable use. Got:\n${render(findings)}`
    ).toEqual([
      "pages/api/route-aliased-invocation.ts",
      "pages/api/route-dynamic-member.ts",
      "pages/api/route-escaping-read.ts",
      "pages/api/route-multi-specifier.ts",
      "pages/api/route-new-client.ts",
      "pages/api/route-reassignment.ts",
      "pages/api/route-tagged-template-sql.ts"
    ]);

    // Seven routes, eight findings: the tagged-template route imports from two different
    // forbidden modules, which is two import statements and therefore two findings.
    expect(
      findings.length,
      `D5 DEFECT: one finding per offending import statement.\n${render(findings)}`
    ).toBe(8);
  }, 180000);
});

describe("D5.2 control — the audit's true positives are not silenced", () => {
  // §7 holds papermark's 229 `@/lib/prisma` findings at "unchanged". The synthetic stand-in for
  // that row is `gt-data-access`: its four genuine routes are exactly the invoked shapes those
  // 229 are (`prisma.user.findMany()`, `rawQuery(...)`). Read-only here — the fixture and the
  // assertions on it belong to D4's suite; this is a second, independent statement of the same
  // requirement, inside the track that could break it.
  it("keeps every genuine gt-data-access route flagged under invocation evidence", async () => {
    const run = await runGtWorkflow({ fixture: "gt-data-access", acceptKinds: [DATA_ACCESS_KIND] });
    const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), DATA_ACCESS_KIND);

    expect(
      flagged,
      "D5.2 REGRESSION: invocation-evidence classification suppressed a genuine data-access " +
        "route. Every one of these calls its import — `loadOrders()`, `connect()`, " +
        "`rawQuery(...)`, `prismaClient.user.findMany()` — so all four carry proven invocation " +
        `evidence and must survive. Got: ${JSON.stringify(flagged)}`
    ).toEqual([
      "pages/api/route-data-access.ts",
      "pages/api/route-database.ts",
      "pages/api/route-db.ts",
      "pages/api/route-prisma.ts"
    ]);
  }, 180000);
});
