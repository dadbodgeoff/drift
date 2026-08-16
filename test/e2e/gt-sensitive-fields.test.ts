// D1 — the sensitive-response-fields dead path (TDD §5.1).
//
// Three tests already covered this convention kind before this file existed, and a P0 shipped
// under all three: two hand-build the contract with `"source": "contract"`, and the third writes
// the convention straight into the state DB with `upsertAcceptedConvention`. Every one of them
// starts *downstream* of the seam that was broken — the proposer stamped a `source` the prover
// discards — so none of them could observe it.
//
// Therefore the defining property of this file is negative: it never calls
// `upsertAcceptedConvention` and never hand-writes a `requires` block. The convention comes out
// of `drift start` and is accepted by the real `drift conventions accept` command, every time.

import { afterEach, describe, expect, it } from "vitest";
import { cleanupGtTempDirs, flaggedPaths, readFindings, runGtWorkflow } from "./gt-harness.js";

afterEach(cleanupGtTempDirs);

const SENSITIVE_KIND = "api_route_forbids_sensitive_response_fields";
const LEAK_ROUTE = "pages/api/route-leak.ts";
const SAFE_ROUTE = "pages/api/route-safe.ts";

interface AcceptedField {
  field_path: string;
  classification: string;
  source: string;
}

function acceptedSensitiveFields(run: { acceptPayloads: any[] }): AcceptedField[] {
  expect(run.acceptPayloads, "the proposer must yield exactly one candidate of this kind").toHaveLength(1);
  const fields = run.acceptPayloads[0].accepted?.requires?.sensitive_response_fields;
  expect(Array.isArray(fields), `accepted.requires.sensitive_response_fields was ${JSON.stringify(fields)}`).toBe(true);
  expect(fields.length).toBeGreaterThan(0);
  return fields as AcceptedField[];
}

describe("D1 marker path — gt-sensitive-fields-schema", () => {
  // The user wrote `driftSensitive: "credential"` on the field. Extraction records that as
  // provenance `"schema"`. Pre-fix, candidate_command.rs:642 hardcoded `"source": "candidate"`
  // into every proposed field, which destroyed it; security_proof.rs:784 then dropped the field
  // as an unreviewed guess and `check` reported zero findings on a route that leaks a password.
  it("preserves schema provenance through proposal and acceptance", async () => {
    const run = await runGtWorkflow({
      fixture: "gt-sensitive-fields-schema",
      acceptKinds: [SENSITIVE_KIND]
    });

    const fields = acceptedSensitiveFields(run);
    expect(
      fields.map((field) => field.source),
      "the driftSensitive marker is schema-declared provenance and must survive proposal"
    ).not.toContain("candidate");
    expect(fields.some((field) => field.source === "schema")).toBe(true);
    // The marker was read for classification even at baseline — it is only `source` that was
    // destroyed, which is why the failure was invisible in every other field of the payload.
    expect(fields.every((field) => field.classification === "credential")).toBe(true);
    expect(fields.every((field) => field.field_path === "password")).toBe(true);
  });

  it("flags the leaking route and only the leaking route", async () => {
    const run = await runGtWorkflow({
      fixture: "gt-sensitive-fields-schema",
      acceptKinds: [SENSITIVE_KIND]
    });

    const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), SENSITIVE_KIND);
    expect(flagged.filter((path) => path === LEAK_ROUTE)).toEqual([LEAK_ROUTE]);
    expect(flagged).not.toContain(SAFE_ROUTE);
  });
});

describe("D1 inference path — gt-sensitive-fields", () => {
  // No marker anywhere in this fixture: `password` is name-inferred, so extraction records
  // provenance `"candidate"` — an unreviewed guess, which security_proof.rs:784 correctly drops.
  // Running `drift conventions accept` is the human review that guess was missing, and the accept
  // path records that as `"accepted_inference"`: a heuristic guess a human signed off on.
  it("promotes a name-inferred field to accepted_inference on acceptance", async () => {
    const run = await runGtWorkflow({
      fixture: "gt-sensitive-fields",
      acceptKinds: [SENSITIVE_KIND]
    });

    const fields = acceptedSensitiveFields(run);
    expect(
      fields.map((field) => field.source),
      "acceptance is the human review that a candidate-sourced field was waiting on"
    ).not.toContain("candidate");
    expect(fields.every((field) => field.source === "accepted_inference")).toBe(true);
    expect(fields.every((field) => field.field_path === "password")).toBe(true);
  });

  it("flags the leaking route and only the leaking route", async () => {
    const run = await runGtWorkflow({
      fixture: "gt-sensitive-fields",
      acceptKinds: [SENSITIVE_KIND]
    });

    const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), SENSITIVE_KIND);
    expect(flagged.filter((path) => path === LEAK_ROUTE)).toEqual([LEAK_ROUTE]);
    expect(flagged).not.toContain(SAFE_ROUTE);
  });
});

describe("D1 dead-config diagnostic", () => {
  // §5.1.4. Both allowlists in security_patterns.rs fail closed and *silent*: an entry the parser
  // cannot read is dropped with no error, which is exactly what let the P0's first proposed fix
  // look like it worked. A healthy run must report no such gap — the negative half of the
  // diagnostic, and the half that proves the field is actually wired through the CLI.
  it("stays quiet when every accepted field is enforceable", async () => {
    const run = await runGtWorkflow({
      fixture: "gt-sensitive-fields",
      acceptKinds: [SENSITIVE_KIND]
    });

    expect(run.checkPayload.summary.unenforceable_conventions ?? []).toEqual([]);
  });
});
