import { describe, expect, it } from "vitest";
import { authorizeContextExport, matchesPolicyGlob } from "../src/policy.js";
import type { RepoContract } from "../src/domain.js";

/**
 * T29. Context egress is the highest-severity claim in the product: Drift reads a whole
 * repository and hands excerpts to an agent, so a policy that is declared but not applied would
 * leak secrets while reporting that it had not.
 *
 * Two layers protect this. Only TS/JS files are indexed at all, which is why a `.env` or `.pem`
 * is normally never touched - but that is incidental, not the policy. The deny-glob filter is the
 * actual mechanism, and it is what F9 broke: the old glob compiler made `** /*.pem` require a
 * leading slash, so a root-level `server.pem` was NOT denied. These cases pin the shapes that bug
 * let through.
 */

const contract = (deniedGlobs: string[]): RepoContract =>
  ({
    context_egress: {
      default_mode: "local_only",
      denied_globs: deniedGlobs,
      max_snippet_chars: 1200,
      allow_full_file_content: false
    }
  }) as unknown as RepoContract;

const DEFAULT_DENIED = [
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.crt",
  "**/*.p12",
  "**/id_rsa",
  "**/id_ed25519"
];

describe("denied paths are refused, not merely flagged", () => {
  for (const path of [
    "server.pem", // root level - the exact shape F9 let through
    "certs/server.pem",
    ".env",
    ".env.production",
    "apps/web/.env", // nested - where monorepo secrets actually live
    "packages/db/private.key",
    "id_rsa"
  ]) {
    it(`denies ${path}`, () => {
      const decision = authorizeContextExport(contract(DEFAULT_DENIED), "cli-preflight", { path });
      expect(decision.allowed).toBe(false);
      expect(decision.mode).toBe("denied");
      // A refusal must carry no snippet budget at all.
      expect(decision.max_snippet_chars).toBe(0);
      expect(decision.approved_snippet_chars).toBe(0);
    });
  }

  for (const path of ["src/env.ts", "src/lib/keyboard.ts", "docs/environment.md"]) {
    it(`allows ${path}`, () => {
      expect(
        authorizeContextExport(contract(DEFAULT_DENIED), "cli-preflight", { path }).allowed
      ).toBe(true);
    });
  }
});

describe("escaping the repo is refused", () => {
  for (const path of ["/etc/passwd", "../../../.ssh/id_rsa", "..\\..\\secrets"]) {
    it(`refuses ${path}`, () => {
      const decision = authorizeContextExport(contract([]), "cli-preflight", { path });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/repo-relative/);
    });
  }
});

describe("full file content stays behind its own switch", () => {
  it("refuses full content when the contract does not allow it", () => {
    const decision = authorizeContextExport(contract([]), "cli-preflight", {
      path: "src/lib/db.ts",
      request_full_file_content: true
    });
    expect(decision.allowed).toBe(false);
    expect(decision.max_snippet_chars).toBe(0);
  });
});

describe("policy glob matching is the shared implementation", () => {
  it("uses globstar semantics that match zero leading segments", () => {
    // The F9 regression in one assertion.
    expect(matchesPolicyGlob("server.pem", "**/*.pem")).toBe(true);
    expect(matchesPolicyGlob("apps/web/.env", "**/.env")).toBe(true);
  });
});
