import { describe, expect, it } from "vitest";
import { FactKindSchema } from "@drift/core";
import { MIGRATIONS } from "@drift/storage";
import {
  CHECK_EXIT_BLOCKED,
  CHECK_EXIT_ERROR,
  CHECK_EXIT_PASS,
  CHECK_EXIT_REFUSED
} from "../src/check/run-check.js";
import {
  agentContractFindingFingerprint,
  canonicalHelperReuseFindingFingerprint,
  findingFingerprint
} from "../src/check/finding-fingerprint.js";

/**
 * Contracts that are cheap to change today and expensive once anyone depends on them.
 *
 * Two things are pinned here, both for the same reason: a change to either is silent. Nothing else
 * in the suite fails, the change ships, and the damage lands on a user's CI config or a user's
 * stored baseline rather than on a red test.
 */
describe("frozen contracts", () => {
  /**
   * Exit codes are a CI integration surface. Renumbering them turns "this diff violates the
   * contract" into "passed" for every pipeline keyed on the old numbers, with no error anywhere.
   *
   * The values, not just their distinctness, are the contract - documented in run-check.ts and
   * docs/reference/errors.md.
   */
  it("pins the drift check exit-code contract", () => {
    expect(CHECK_EXIT_PASS).toBe(0);
    expect(CHECK_EXIT_ERROR).toBe(1);
    expect(CHECK_EXIT_BLOCKED).toBe(2);
    expect(CHECK_EXIT_REFUSED).toBe(3);
  });

  /**
   * Finding fingerprints are what a baseline row is keyed on. Change any hash input - the salt, the
   * field list, the order, the separator, the path normalisation - and every stored baseline
   * orphans at once: findings that were `pre_existing` come back `new`, and a user's first check
   * after upgrading floods with violations for code they did not write.
   *
   * These are the exact five inputs as of this commit. A deliberate change means updating the
   * expected digests here AND populating `legacyFingerprints` (run-check.ts) so old baselines still
   * match - that parameter exists and is currently never passed a non-default value.
   */
  it("pins findingFingerprint inputs and digest", () => {
    expect(
      findingFingerprint("convention_x", "apps/web/app/api/users/route.ts", "prisma", "@/lib/prisma")
    ).toBe("f89345641d5764b90d14c8ce1f569170c0d67bc6788356ba11764a17f83a36a5");
  });

  it("pins canonicalHelperReuseFindingFingerprint inputs and digest", () => {
    expect(
      canonicalHelperReuseFindingFingerprint(
        "agent_contract_x",
        "helper_x",
        "apps/web/app/api/users/route.ts",
        "getSession"
      )
    ).toBe("dd33bdee2934310b7fbee964d75ad7b611acff7e25bee347fae3a602bd703fe1");
  });

  it("pins agentContractFindingFingerprint inputs and digest", () => {
    expect(
      agentContractFindingFingerprint(
        "module_placement",
        "agent_contract_x",
        "apps/web/app/api/users/route.ts",
        "handler",
        "service"
      )
    ).toBe("6781cc5e1c94fdff24b89c6d57e587c27dc38c097a140d9097b25dfe5b0bb0da");
  });


  /**
   * The fact vocabulary and the migration list move together.
   *
   * `facts.kind` is plain TEXT with no CHECK, so SQLite stores any value - but `factFromRow` parses
   * every row through `FactRecordSchema`, whose `kind` is a closed enum. A database written by a
   * build that knows a newer kind is therefore UNREADABLE by one that does not: not a degraded
   * read, a throw on every `listFacts` for that scan.
   *
   * The only thing that stops that is the migration gate - `assertSupportedLocalDatabase` refuses a
   * database with more migrations than the build knows. So a vocabulary addition MUST be
   * accompanied by a migration, even one that changes no columns. Measured before that gate
   * existed: a database holding 1,572 rows of a new kind still reported exactly the 33 migrations
   * the older build supported, so the gate passed and the failure surfaced later as a Zod error.
   *
   * Nothing else ties these together, so this test does. If it fails because you added a fact kind,
   * add a migration alongside it; if it fails because you added a migration, update both counts.
   */
  it("pins the fact vocabulary to the migration count", () => {
    expect(FactKindSchema.options).toHaveLength(36);
    expect(MIGRATIONS).toHaveLength(34);
    expect(FactKindSchema.options).toContain("data_model_declared");
  });

  /**
   * Windows-style separators must normalise to the posix form, or the same finding fingerprints
   * differently depending on the platform that produced the baseline.
   */
  it("normalises path separators before hashing", () => {
    expect(findingFingerprint("c", "a\\b\\route.ts", "s", "src")).toBe(
      findingFingerprint("c", "a/b/route.ts", "s", "src")
    );
  });
});
