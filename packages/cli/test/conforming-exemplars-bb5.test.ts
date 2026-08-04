import { describe, expect, it } from "vitest";

import {
  MAX_CONFORMING_EXEMPLARS,
  conformingExemplars,
  conventionRationale,
  migrationSentence
} from "../src/domain/conforming-exemplars.js";

/**
 * BB-5. The empirically highest-leverage item in the beta set, and the reason is uncomfortable:
 * in controlled trials on 2026-08-03 an agent given a convention read the files cited alongside it,
 * found that they violate the rule themselves, and defected on the record - "the preflight's claim
 * doesn't hold up against the actual codebase". A second trial used the honest findings summary as
 * evidence *against* the rule.
 *
 * The integrity invariant is therefore the item, not a detail of it: an exemplar must never have an
 * open finding against the convention it exemplifies. It is tested first and hardest, including the
 * adversarial shape that makes it non-trivial - dub's invite routes, where the files nearest the one
 * being edited are exactly the violators.
 */

describe("BB-5 exemplar integrity", () => {
  it("never offers a file that has an open finding against the convention", () => {
    // Property-style: every subset of violators, over a fixed scope. The assertion is not "the right
    // files were picked" but "no violator was ever picked", which is the invariant that matters.
    const scopeFiles = [
      "app/api/a/route.ts",
      "app/api/b/route.ts",
      "app/api/c/route.ts",
      "app/api/d/route.ts",
      "app/api/e/route.ts"
    ];
    for (let mask = 0; mask < 1 << scopeFiles.length; mask += 1) {
      const violators = scopeFiles.filter((_, index) => (mask & (1 << index)) !== 0);
      const result = conformingExemplars({ scopeFiles, violatingFiles: violators });
      for (const exemplar of result.conforming_examples) {
        expect(violators).not.toContain(exemplar.file_path);
      }
      // And the empty case always says why.
      if (result.conforming_examples.length === 0) {
        expect(result.reason).toBe("no_conforming_examples");
      } else {
        expect(result.reason).toBeNull();
      }
    }
  });

  it("skips nearby violators in favour of farther conforming files - the dub invite-routes shape", () => {
    // The adversarial case. A naive "nearest by path" selector picks the two sibling routes, which
    // are precisely the files that violate the rule; the conforming file is three directories away.
    const result = conformingExemplars({
      scopeFiles: [
        "apps/web/app/api/workspaces/[idOrSlug]/invites/route.ts",
        "apps/web/app/api/workspaces/[idOrSlug]/invites/accept/route.ts",
        "apps/web/app/api/workspaces/[idOrSlug]/invites/resend/route.ts",
        "apps/web/app/api/health/route.ts"
      ],
      violatingFiles: [
        "apps/web/app/api/workspaces/[idOrSlug]/invites/accept/route.ts",
        "apps/web/app/api/workspaces/[idOrSlug]/invites/resend/route.ts"
      ],
      referenceFile: "apps/web/app/api/workspaces/[idOrSlug]/invites/route.ts"
    });

    expect(result.conforming_examples.map((example) => example.file_path)).toEqual([
      "apps/web/app/api/health/route.ts"
    ]);
  });

  it("never offers the file being edited as its own exemplar", () => {
    const result = conformingExemplars({
      scopeFiles: ["app/api/a/route.ts", "app/api/b/route.ts"],
      violatingFiles: [],
      referenceFile: "app/api/a/route.ts"
    });
    expect(result.conforming_examples.map((example) => example.file_path)).toEqual(["app/api/b/route.ts"]);
  });

  describe("negative controls", () => {
    it("emits an empty list with a reason when every file in scope violates", () => {
      const result = conformingExemplars({
        scopeFiles: ["app/api/a/route.ts", "app/api/b/route.ts"],
        violatingFiles: ["app/api/a/route.ts", "app/api/b/route.ts"]
      });
      expect(result.conforming_examples).toEqual([]);
      expect(result.reason).toBe("no_conforming_examples");
    });

    it("distinguishes an empty scope from a scope with no clean file", () => {
      // A consumer must be able to tell "this repo has no clean example" from "no file is in scope",
      // because the second is a contract problem and the first is a migration problem.
      expect(conformingExemplars({ scopeFiles: [], violatingFiles: [] }).reason).toBe("no_files_in_scope");
    });

    it("never reaches outside the scope for a clean file", () => {
      const result = conformingExemplars({
        scopeFiles: ["app/api/a/route.ts"],
        violatingFiles: ["app/api/a/route.ts"]
      });
      // `lib/clean.ts` is clean and would look reassuring. It is not in scope, so it is not evidence.
      expect(result.conforming_examples).toEqual([]);
    });
  });

  describe("determinism and shape", () => {
    it("caps the list at three", () => {
      const scopeFiles = Array.from({ length: 20 }, (_, index) => `app/api/r${index}/route.ts`);
      const result = conformingExemplars({ scopeFiles, violatingFiles: [] });
      expect(result.conforming_examples).toHaveLength(MAX_CONFORMING_EXEMPLARS);
    });

    it("is stable under input reordering - the packet is byte-compared by eval:determinism", () => {
      const scopeFiles = [
        "app/api/zed/route.ts",
        "app/api/alpha/route.ts",
        "app/api/mid/route.ts",
        "app/api/beta/route.ts"
      ];
      const forward = conformingExemplars({ scopeFiles, violatingFiles: [] });
      const reversed = conformingExemplars({ scopeFiles: [...scopeFiles].reverse(), violatingFiles: [] });
      expect(reversed).toEqual(forward);
      expect(forward.conforming_examples.map((example) => example.file_path)).toEqual([
        "app/api/alpha/route.ts",
        "app/api/beta/route.ts",
        "app/api/mid/route.ts"
      ]);
    });

    it("prefers a file with the same role as the file being edited", () => {
      const roleByFile = new Map([
        ["app/api/edited/route.ts", "api_route"],
        ["app/api/sibling/route.ts", "api_route"],
        ["lib/service/users.ts", "service"]
      ]);
      const result = conformingExemplars({
        scopeFiles: ["lib/service/users.ts", "app/api/sibling/route.ts"],
        violatingFiles: [],
        roleByFile,
        referenceFile: "app/api/edited/route.ts",
        limit: 1
      });
      expect(result.conforming_examples[0]).toEqual({ file_path: "app/api/sibling/route.ts", role: "api_route" });
    });

    it("reports the role it knows, and null rather than a guess when it knows none", () => {
      const result = conformingExemplars({
        scopeFiles: ["app/api/unclassified/route.ts"],
        violatingFiles: []
      });
      expect(result.conforming_examples[0]).toEqual({ file_path: "app/api/unclassified/route.ts", role: null });
    });
  });
});

describe("BB-5 migration sentence", () => {
  it("says why the existing violations are not precedent", () => {
    expect(migrationSentence(397)).toBe(
      "397 existing violations are baselined and do not block; new code is held to this rule."
    );
  });

  it("is singular for one", () => {
    expect(migrationSentence(1)).toBe(
      "1 existing violation is baselined and does not block; new code is held to this rule."
    );
  });

  it("is absent at zero rather than boilerplate", () => {
    // "0 existing violations are baselined" would train readers to skip the line that matters when
    // the count is 397.
    expect(migrationSentence(0)).toBeNull();
    expect(migrationSentence(-1)).toBeNull();
  });
});

describe("BB-5 rationale split", () => {
  it("separates how Drift found the convention from why the repo holds it", () => {
    const rationale = conventionRationale({
      kind: "api_route_no_direct_data_access",
      derivation: "18 of 20 API route files already delegate through the service layer."
    });
    expect(rationale.derivation).toContain("18 of 20");
    // The `reason` is what an agent deciding whether to comply needs; the derivation is evidence
    // about Drift's inference, which is a different question.
    expect(rationale.reason).toContain("Route modules are transport");
    expect(rationale.reason).not.toContain("18 of 20");
  });

  it("offers no invented reason for kinds it has none for", () => {
    expect(conventionRationale({ kind: "some_other_kind", derivation: "d" }).reason).toBeNull();
  });
});
