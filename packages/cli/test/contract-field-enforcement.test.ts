import { describe, expect, it } from "vitest";
import {
  findContractWaiverForImport,
  isExceptedImport,
  isExceptedPath,
  waiverRequiresReapproval
} from "../src/check/waivers.js";
import type { AcceptedConvention, RepoContract } from "@drift/core";

/**
 * T27. Rewritten from the original B2 task, whose premise turned out to be false.
 *
 * B2 claimed that waivers, exceptions, scope and governance are "deserialized then discarded" at
 * check_command.rs:64-79 and should therefore be rejected fail-closed. They *are* discarded by the
 * engine - but the CLI applies them at every enforcement site, so that is layering, not a
 * fail-open. Adding a rejection would have broken working contracts.
 *
 * The risk is that the layering is undocumented and unpinned: nothing stopped someone deleting
 * the CLI-side checks while the engine still ignored the fields, at which point contracts would
 * silently stop being honoured. These tests are the guard, one per field the engine drops.
 */

const NOW = "2026-05-10T00:00:00.000Z";
const LATER = "2026-06-10T00:00:00.000Z";

function convention(overrides: Partial<AcceptedConvention> = {}): AcceptedConvention {
  return {
    id: "convention_abc",
    kind: "api_route_no_direct_data_access",
    matcher: { kind: "api_route_no_direct_data_access", forbidden_imports: ["@/lib/db"] },
    scope: { path_globs: ["**/app/api/**/route.ts"], file_roles: ["api_route"] },
    exceptions: [],
    ...overrides
  } as unknown as AcceptedConvention;
}

describe("exceptions are enforced by the CLI", () => {
  it("excludes a path covered by an active exception", () => {
    const withException = convention({
      exceptions: [
        {
          id: "exception_1",
          path_globs: ["app/api/legacy/**"],
          reason: "legacy",
          created_at: NOW
        }
      ]
    } as Partial<AcceptedConvention>);
    expect(isExceptedPath("app/api/legacy/route.ts", withException, NOW)).toBe(true);
    expect(isExceptedPath("app/api/current/route.ts", withException, NOW)).toBe(false);
  });

  it("stops honouring an exception once it expires", () => {
    const expiring = convention({
      exceptions: [
        {
          id: "exception_1",
          path_globs: ["app/api/legacy/**"],
          reason: "temporary",
          created_at: NOW,
          expires_at: "2026-05-20T00:00:00.000Z"
        }
      ]
    } as Partial<AcceptedConvention>);
    expect(isExceptedPath("app/api/legacy/route.ts", expiring, NOW)).toBe(true);
    // An exception that outlives its expiry would be a silent, permanent hole.
    expect(isExceptedPath("app/api/legacy/route.ts", expiring, LATER)).toBe(false);
  });

  it("scopes an import-level exception to the named symbol and source", () => {
    const withException = convention({
      exceptions: [
        {
          id: "exception_2",
          path_globs: ["app/api/**"],
          import_sources: ["@/lib/db"],
          symbols: ["db"],
          reason: "audited",
          created_at: NOW
        }
      ]
    } as Partial<AcceptedConvention>);
    expect(isExceptedImport("app/api/a/route.ts", "db", "@/lib/db", withException, NOW)).toBe(true);
    // A different symbol from the same module is not covered by that exception.
    expect(isExceptedImport("app/api/a/route.ts", "other", "@/lib/db", withException, NOW)).toBe(
      false
    );
  });
});

describe("contract waivers are enforced by the CLI", () => {
  const contract = (waiver: Record<string, unknown>): RepoContract =>
    ({ waivers: [waiver] }) as unknown as RepoContract;

  it("matches a waiver by path, symbol and import source", () => {
    const found = findContractWaiverForImport(
      "app/api/a/route.ts",
      "db",
      "@/lib/db",
      contract({
        id: "waiver_1",
        status: "active",
        path_globs: ["app/api/**"],
        import_sources: ["@/lib/db"],
        symbols: ["db"],
        reason: "approved",
        created_at: NOW
      }),
      NOW
    );
    expect(found?.id).toBe("waiver_1");
  });

  it("does not honour an expired waiver", () => {
    const found = findContractWaiverForImport(
      "app/api/a/route.ts",
      "db",
      "@/lib/db",
      contract({
        id: "waiver_1",
        status: "active",
        path_globs: ["app/api/**"],
        reason: "temporary",
        created_at: NOW,
        expires_at: "2026-05-20T00:00:00.000Z"
      }),
      LATER
    );
    expect(found).toBeUndefined();
  });

  it("requires reapproval once the waived file changes", () => {
    // Approval is recorded per file, so a waiver covering several paths cannot be kept alive by
    // one of them staying unchanged.
    const waiver = {
      id: "waiver_1",
      status: "active",
      requires_reapproval_on_change: true,
      approved_file_hashes: [{ file_path: "app/api/a/route.ts", content_hash: "a".repeat(64) }]
    } as unknown as RepoContract["waivers"][number];
    // Same content: the approval still describes what was reviewed.
    expect(waiverRequiresReapproval(waiver, "app/api/a/route.ts", "a".repeat(64))).toBe(false);
    // Changed content: the approval no longer describes what is there.
    expect(waiverRequiresReapproval(waiver, "app/api/a/route.ts", "b".repeat(64))).toBe(true);
    // Unknown content cannot be assumed to match.
    expect(waiverRequiresReapproval(waiver, "app/api/a/route.ts", undefined)).toBe(true);
    // A different file in the same waiver has no approval recorded for it at all.
    expect(waiverRequiresReapproval(waiver, "app/api/b/route.ts", "a".repeat(64))).toBe(true);
  });
});
