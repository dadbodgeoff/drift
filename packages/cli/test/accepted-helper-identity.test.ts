import { describe, expect, it } from "vitest";
import type { AcceptedConvention } from "@drift/core";
import type { GraphEdge, GraphNode } from "@drift/factgraph";
import { resolvedHelperIdentities } from "../src/check/run-check.js";
import { graphEdge, graphScanData, importNode, moduleNode } from "./helpers/scan-data.js";

/**
 * S3-02: what an accepted security helper's import specifier actually resolves to, and how we know.
 *
 * The pipeline decides "does this call reach the accepted helper" at two strengths, both wrong in
 * opposite directions. Tier 0 compares the imported NAME alone, so a helper from
 * `@/lib/attacker-controlled` that happens to export `assertCsrf` produces a passing proof - the
 * laundering shape. Tier 1 compares the name and the specifier AS TYPED, so `../../lib/auth` and
 * `@/lib/auth` disagree about one file, a barrel import fails, and a renamed import fails outright -
 * false alarms. Tier 1 is not a stronger tier 0; only resolved module identity dominates both.
 *
 * This computes that identity. Nothing consumes it yet.
 *
 * The single hardest constraint is that emptiness is NOT a failure. The Rust `resolve_import` ends
 * by filtering to paths inside the scan snapshot, so `next-auth`, `@clerk/nextjs` and everything
 * else in `node_modules` produce no resolution edge BY DESIGN. A resolver that met an empty table
 * by falling back to string comparison would silently and permanently retain tier-1 semantics for
 * every external auth helper - the most common real-world contract - and no test would ever say so.
 * That is why the mode is computed per helper rather than per convention, and why it is recorded:
 * the degradation has to be visible rather than assumed.
 */

const ROUTE = "app/api/thing/route.ts";

/** A convention carrying only the `requires` surface the helper resolver reads. */
function conventionRequiring(requires: Record<string, unknown>): AcceptedConvention {
  return {
    id: "convention_test",
    kind: "api_route_requires_auth_helper",
    matcher: {},
    requires
  } as unknown as AcceptedConvention;
}

function identityFor(
  identities: ReturnType<typeof resolvedHelperIdentities>,
  symbol: string
): { symbol: string; mode: string; files: string[] } | undefined {
  return identities.find((identity) => identity.symbol === symbol);
}

describe("resolvedHelperIdentities", () => {
  /**
   * One graph carrying every shape at once, because a helper resolver that only works when the
   * graph contains nothing else is not the thing being built.
   *
   * `src/lib/index.ts` is a barrel re-exporting `src/lib/auth.ts`. `src/lib/attacker-controlled.ts`
   * is an unrelated module that also exports a symbol named `assertCsrf` - it resolves, it is just
   * not the accepted helper's module, which is the entire point of resolving instead of name
   * matching. `next-auth` appears as an import with no resolution edge, which is what external
   * looks like here.
   */
  const nodes: GraphNode[] = [
    importNode({ id: "import:barrel", filePath: ROUTE, source: "@/lib" }),
    importNode({ id: "import:auth", filePath: ROUTE, source: "@/lib/auth" }),
    importNode({ id: "import:auth-relative", filePath: "app/api/other/route.ts", source: "../../lib/auth" }),
    importNode({ id: "import:attacker", filePath: "app/api/evil/route.ts", source: "@/lib/attacker-controlled" }),
    importNode({ id: "import:next-auth", filePath: ROUTE, source: "next-auth" }),
    moduleNode({ id: "module:barrel", filePath: "src/lib/index.ts" }),
    moduleNode({ id: "module:auth", filePath: "src/lib/auth.ts" }),
    moduleNode({ id: "module:attacker", filePath: "src/lib/attacker-controlled.ts" }),
    {
      id: "symbol:attacker-assertCsrf",
      kind: "symbol",
      label: "assertCsrf",
      stable: true,
      evidence_ids: [],
      metadata: { file_path: "src/lib/attacker-controlled.ts", name: "assertCsrf" }
    },
    {
      id: "symbol:auth-assertCsrf",
      kind: "symbol",
      label: "assertCsrf",
      stable: true,
      evidence_ids: [],
      metadata: { file_path: "src/lib/auth.ts", name: "assertCsrf" }
    }
  ];

  const edges: GraphEdge[] = [
    graphEdge({ id: "r1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:barrel", to: "module:barrel" }),
    graphEdge({ id: "r2", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:auth", to: "module:auth" }),
    graphEdge({ id: "r3", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:auth-relative", to: "module:auth" }),
    graphEdge({ id: "r4", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:attacker", to: "module:attacker" }),
    // The barrel is what makes `@/lib` mean `src/lib/auth.ts` as well as `src/lib/index.ts`.
    graphEdge({ id: "x1", kind: "MODULE_REEXPORTS_MODULE", from: "module:barrel", to: "module:auth" }),
    // Symbol-level edges the laundering control needs: both modules really do export `assertCsrf`,
    // so name matching genuinely cannot separate them and only module identity can.
    graphEdge({ id: "s1", kind: "IMPORT_RESOLVES_TO_SYMBOL", from: "import:attacker", to: "symbol:attacker-assertCsrf" }),
    graphEdge({ id: "s2", kind: "IMPORT_RESOLVES_TO_SYMBOL", from: "import:auth", to: "symbol:auth-assertCsrf" })
    // `import:next-auth` deliberately has NO resolution edge. See the file header.
  ];

  const checkData = graphScanData({ nodes, edges });

  it("barrel_reexport_resolves_to_the_helper_module", () => {
    const identities = resolvedHelperIdentities(
      checkData,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:requireUser", symbol: "requireUser", import: "@/lib" }]
      })
    );

    // Tier 1 fails this outright: the contract says `@/lib` and the helper lives in
    // `src/lib/auth.ts`, so the strings never meet. Resolution plus the re-export chain does.
    expect(identityFor(identities, "requireUser")).toEqual({
      symbol: "requireUser",
      mode: "repo_resolved",
      files: ["src/lib/auth.ts", "src/lib/index.ts"]
    });
  });

  it("an accepted helper does not absorb the modules sitting beneath its specifier", () => {
    /**
     * The forbidden-import path matches a specifier OR anything under it at a `/` boundary, which
     * is right for a prohibition: broadening a ban only ever bans more. Reusing that relation for an
     * accepted helper inverts it. A helper accepted at `@/lib` would absorb
     * `@/lib/attacker-controlled`, so anyone who can add a module under that prefix owns the
     * accepted helper's identity and gets a passing auth proof - the laundering shape, reintroduced
     * by the very mechanism meant to close it. Acceptance matches exactly.
     *
     * `src/lib/auth.ts` is still here, because it arrives through the barrel's re-export chain -
     * a fact about what the repo exports, not about how the specifier is spelled.
     */
    const identities = resolvedHelperIdentities(
      checkData,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:requireUser", symbol: "requireUser", import: "@/lib" }]
      })
    );

    expect(identityFor(identities, "requireUser")?.files)
      .not.toContain("src/lib/attacker-controlled.ts");
  });

  it("a_same_named_export_from_an_unrelated_module_resolves_elsewhere", () => {
    const identities = resolvedHelperIdentities(
      checkData,
      conventionRequiring({
        csrf_helpers: [{ helper_id: "csrf:assertCsrf", symbol: "assertCsrf", module: "@/lib/auth" }]
      })
    );

    const identity = identityFor(identities, "assertCsrf");
    // Both spellings of the accepted module collapse onto one file...
    expect(identity).toEqual({
      symbol: "assertCsrf",
      mode: "repo_resolved",
      files: ["src/lib/auth.ts"]
    });
    // ...and the attacker's identically-named export is not in it. This is the negative control:
    // tier 0 would have accepted it on the name alone.
    expect(identity?.files).not.toContain("src/lib/attacker-controlled.ts");
  });

  it("an_external_package_helper_is_classified_external_not_empty", () => {
    const identities = resolvedHelperIdentities(
      checkData,
      conventionRequiring({
        auth_helpers: [
          { guard_id: "auth:getServerSession", symbol: "getServerSession", import: "next-auth" }
        ]
      })
    );

    // The failure this test exists to prevent is `mode: "repo_resolved", files: []`, which reads as
    // "the accepted helper resolves to nothing" and would make every compliant route a violation
    // once Sprint 4 matches on it. `external` says the opposite: the answer is unavailable here by
    // design, so match the specifier and say so.
    expect(identityFor(identities, "getServerSession")).toEqual({
      symbol: "getServerSession",
      mode: "external",
      files: []
    });
  });

  it("an_external_specifier_that_resolves_repo_locally_is_flagged", () => {
    // The tsconfig-paths hijack shape: the contract names a package, and the repo has quietly
    // pointed that package name at a file it controls. Accepting this silently is how a
    // resolution-based matcher would be worse than the string one it replaces.
    const hijacked = graphScanData({
      nodes: [
        importNode({ id: "import:hijack", filePath: ROUTE, source: "next-auth" }),
        moduleNode({ id: "module:shim", filePath: "src/shim/next-auth.ts" })
      ],
      edges: [
        graphEdge({ id: "h1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:hijack", to: "module:shim" })
      ]
    });

    const identities = resolvedHelperIdentities(
      hijacked,
      conventionRequiring({
        auth_helpers: [
          { guard_id: "auth:getServerSession", symbol: "getServerSession", import: "next-auth" }
        ]
      })
    );

    expect(identityFor(identities, "getServerSession")).toMatchObject({
      symbol: "getServerSession",
      mode: "repo_resolved",
      files: ["src/shim/next-auth.ts"]
    });
    expect(identities[0]).toHaveProperty("external_specifier_resolves_in_repo", true);
  });

  it("resolved_file_lists_are_sorted_and_deduped", () => {
    /**
     * The repo's determinism digest covers findings, never proofs, so nothing downstream would
     * catch an unstable order here. Insertion order is graph order: this graph reaches `zzz` first
     * and reaches `aaa` only by following the re-export, and two imports resolve to the same file.
     */
    const unordered = graphScanData({
      nodes: [
        importNode({ id: "import:one", filePath: ROUTE, source: "@/lib" }),
        importNode({ id: "import:two", filePath: "app/api/two/route.ts", source: "@/lib" }),
        moduleNode({ id: "module:zzz", filePath: "src/lib/zzz.ts" }),
        moduleNode({ id: "module:aaa", filePath: "src/lib/aaa.ts" }),
        moduleNode({ id: "module:mmm", filePath: "src/lib/mmm.ts" })
      ],
      edges: [
        graphEdge({ id: "u1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:one", to: "module:zzz" }),
        // Same specifier, same target file: one entry, not two.
        graphEdge({ id: "u2", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:two", to: "module:zzz" }),
        graphEdge({ id: "u3", kind: "MODULE_REEXPORTS_MODULE", from: "module:zzz", to: "module:mmm" }),
        graphEdge({ id: "u4", kind: "MODULE_REEXPORTS_MODULE", from: "module:mmm", to: "module:aaa" })
      ]
    });

    const identities = resolvedHelperIdentities(
      unordered,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:requireUser", symbol: "requireUser", import: "@/lib" }]
      })
    );

    expect(identityFor(identities, "requireUser")?.files).toEqual([
      "src/lib/aaa.ts",
      "src/lib/mmm.ts",
      "src/lib/zzz.ts"
    ]);
  });

  it("a repo-relative specifier that resolves to nothing is unresolved, not external", () => {
    // The third mode, and the one that must never be confused with the second: `@/lib/gone` is a
    // repo specifier, so resolving to nothing means the graph could not answer - a degradation to
    // record - rather than an import that lives outside the snapshot on purpose.
    const identities = resolvedHelperIdentities(
      checkData,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:requireUser", symbol: "requireUser", import: "@/lib/gone" }]
      })
    );

    expect(identityFor(identities, "requireUser")).toEqual({
      symbol: "requireUser",
      mode: "unresolved",
      files: []
    });
  });

  it("reads every accepted security helper list, whichever key its module hides under", () => {
    // Three requires keys spell the module field three different ways - `import` for auth and
    // validators, `module` for the phase 6 kinds, `import_source` for response serializers. A
    // resolver that knew only one of them would return a confident, silently partial answer.
    const identities = resolvedHelperIdentities(
      checkData,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:requireUser", symbol: "requireUser", import: "@/lib/auth" }],
        csrf_helpers: [{ helper_id: "csrf:assertCsrf", symbol: "assertCsrf", module: "@/lib/auth" }],
        rate_limit_helpers: [{ helper_id: "rl:ratelimit", symbol: "ratelimit", module: "next-auth" }],
        outbound_url_allowlist_helpers: [
          { helper_id: "ssrf:allowOutbound", symbol: "allowOutbound", module: "@/lib/gone" }
        ],
        validators: [{ validator_id: "validator:parseBody", symbol: "parseBody", import: "@/lib" }],
        response_serializers: [
          { serializer_id: "serializer:toDto", imported_name: "toDto", import_source: "@/lib/auth" }
        ]
      })
    );

    expect(identities.map((identity) => [identity.symbol, identity.mode])).toEqual([
      ["allowOutbound", "unresolved"],
      ["assertCsrf", "repo_resolved"],
      ["parseBody", "repo_resolved"],
      ["ratelimit", "external"],
      ["requireUser", "repo_resolved"],
      ["toDto", "repo_resolved"]
    ]);
  });
});
