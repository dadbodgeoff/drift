// What an answer of absence rests on (entities/basis), worded as Drift words it
// (crates/drift-mine/src/practices/basis.rs), and the `identified` state counted apart.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IN_WHAT_DRIFT_READ, NO_GUARD_FOUND, identifiedText, internalText, noGuardText, noneText, notReadList } from "@/entities/basis";
import { POSTURE, exposureText, guardText, postureOf } from "@/entities/security";
import { coverageBar, concernIn } from "@/features/practices/model/practices";
import type { AnswerNotRead, EntryRow, PracticeConcern } from "@/shared/contract/drift";

const rs = readFileSync(new URL("../../../../crates/drift-mine/src/practices/basis.rs", import.meta.url), "utf8");

const notRead: AnswerNotRead[] = [
  { kind: "package_function", what: "pkg:company_auth#auth.require_scope", why: "a package's function no list of Drift's has an entry for" },
  { kind: "file", what: "app/views.py", why: "skipped by the scan: too large" },
  { kind: "depth_limit", what: "app/svc.py#Service.check", why: "a body not followed: past the depth the reading follows" },
];

describe("the words of an answer of absence", () => {
  it("are basis.rs's", () => {
    expect(rs).toContain(`pub const IN_WHAT_DRIFT_READ: &str = "${IN_WHAT_DRIFT_READ}";`);
    expect(rs).toContain(`pub const AUTHN_NONE: &str = "${NO_GUARD_FOUND}";`);
  });

  it("say what was not read, two by name and the rest by count", () => {
    expect(notReadList([])).toBe("");
    expect(notReadList(notRead)).toBe("3 not read: require_scope from company_auth, app/views.py (skipped by the scan) and 1 more");
    expect(noneText(NO_GUARD_FOUND, notRead.slice(0, 1))).toBe("none: no guard found in what Drift read (1 not read: require_scope from company_auth)");
    // An empty list is no proof either: the words still say "in what Drift read".
    expect(noneText("no guard", [])).toBe("none: no guard in what Drift read");
    expect(noGuardText({ bodies: 3, not_read: notRead })).toBe("no guard found in what Drift read (3 not read)");
    expect(noGuardText(undefined)).toBe(NO_GUARD_FOUND);
  });

  it("word an internal exposure as what Drift read, with what it did not", () => {
    const e = { exposure: "internal", boundary: "compose service api publishes no ports", exposure_basis: { bodies: 0, descriptions: ["compose.yaml"], not_read: [{ kind: "file", what: "k8s/api.yaml", why: "a YAML file Drift did not recognise as a deployment description" }] } } as Pick<EntryRow, "exposure" | "boundary" | "exposure_basis">;
    expect(exposureText(e)).toBe("internal in what Drift read (compose service api publishes no ports; 1 not read: k8s/api.yaml (a YAML file Drift did not recognise as a deployment description))");
    expect(internalText(undefined, undefined)).toBe("internal in what Drift read");
    expect(exposureText({ exposure: "public", boundary: "compose service web publishes ports" })).toBe("internet-facing (compose service web publishes ports)");
  });

  it("name a row with no guard by what was found, never as a fact about the code", () => {
    const row = { guards: [], kind: "http", basis: { bodies: 2, not_read: notRead.slice(0, 2) } };
    expect(guardText(row)).toBe("no guard found in what Drift read (2 not read)");
    expect(POSTURE.unguarded.label).toBe("no guard found");
    // Identified: the caller identified, no one turned away.
    const identified = { guards: [], kind: "http", authenticates: ["authentication.SessionAuthentication"], reaches: [], wrappers: [], opens: [] } as unknown as EntryRow;
    expect(postureOf(identified)).toBe("authenticated");
    expect(POSTURE.authenticated.label).toBe("identified");
    expect(identifiedText(identified.authenticates)).toBe("identified by SessionAuthentication, turns no one away");
  });
});

describe("identified is counted apart", () => {
  it("in the coverage bar: told, but neither known nor unknown", () => {
    const bar = coverageBar({ total: 10, known: 6, identified: 2, none: 1, unknown: 1 }, 0.9);
    expect(bar.coverage).toBeCloseTo(0.9, 10);
    expect(bar.identifiedShare).toBeCloseTo(0.2, 10);
    expect(bar.atTarget).toBe(true);
  });

  it("in a package, from its identified variants, never as unknown", () => {
    const v = (id: string, kind: "known" | "none" | "identified", members: number) => ({ id, key: id, label: id, kind, members, share: 0, mechanisms: [], instruments: [], source: "vocab", where: { packages: [], dirs: [], roles: [], entry_kinds: [], methods: [] }, sets_apart: [], examples: [], exceptions: [], exceptions_more: 0, conventions: [], promotable: null });
    const c = {
      id: "authn",
      title: "Authentication",
      unit: "entry_point",
      population: { total: 10, known: 6, identified: 3, none: 1, unknown: 0, coverage: 1, left_out: { tests: 0, non_production: 0 } },
      variants: [v("P-a", "known", 6), v("P-i", "identified", 3), v("P-n", "none", 1)],
      unknown: { members: 0, reasons: [], instruments: [], examples: [] },
      by_package: [{ package: "web", total: 10, coverage: 1, variants: [{ id: "P-a", members: 6, share: 0.6 }, { id: "P-i", members: 3, share: 0.3 }, { id: "P-n", members: 1, share: 0.1 }] }],
      divergence: [],
    } as unknown as PracticeConcern;
    expect(concernIn(c, "web", 0.9)!.counts).toEqual({ total: 10, known: 6, identified: 3, none: 1, unknown: 0 });
    expect(concernIn(c, null, 0.9)!.counts).toEqual({ total: 10, known: 6, identified: 3, none: 1, unknown: 0 });
  });
});
