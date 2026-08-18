import { describe, expect, it } from "vitest";
import type { AcceptedConvention } from "@drift/core";
import type { GraphEdge, GraphNode } from "@drift/factgraph";
import { resolvedHelperIdentities } from "../src/check/run-check.js";
import { graphEdge, graphScanData, importNode, moduleNode, symbolNode } from "./helpers/scan-data.js";

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
    symbolNode({
      id: "symbol:attacker-assertCsrf",
      filePath: "src/lib/attacker-controlled.ts",
      name: "assertCsrf"
    }),
    symbolNode({ id: "symbol:auth-assertCsrf", filePath: "src/lib/auth.ts", name: "assertCsrf" }),
    symbolNode({ id: "symbol:auth-requireUser", filePath: "src/lib/auth.ts", name: "requireUser" }),
    symbolNode({ id: "symbol:auth-parseBody", filePath: "src/lib/auth.ts", name: "parseBody" }),
    symbolNode({ id: "symbol:auth-toDto", filePath: "src/lib/auth.ts", name: "toDto" })
  ];

  const edges: GraphEdge[] = [
    graphEdge({ id: "r1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:barrel", to: "module:barrel" }),
    graphEdge({ id: "r2", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:auth", to: "module:auth" }),
    graphEdge({ id: "r3", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:auth-relative", to: "module:auth" }),
    graphEdge({ id: "r4", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:attacker", to: "module:attacker" }),
    // The barrel is what makes `@/lib` mean `src/lib/auth.ts` as well as `src/lib/index.ts` - but
    // only for the symbols it actually re-exports, which is why the edge carries a name and the
    // target declares what it exports. `export * from "./auth"`.
    graphEdge({ id: "x1", kind: "MODULE_REEXPORTS_MODULE", from: "module:barrel", to: "module:auth", exportedName: "*" }),
    graphEdge({ id: "x2", kind: "MODULE_EXPORTS_SYMBOL", from: "module:auth", to: "symbol:auth-requireUser" }),
    graphEdge({ id: "x3", kind: "MODULE_EXPORTS_SYMBOL", from: "module:auth", to: "symbol:auth-assertCsrf" }),
    graphEdge({ id: "x4", kind: "MODULE_EXPORTS_SYMBOL", from: "module:auth", to: "symbol:auth-parseBody" }),
    graphEdge({ id: "x5", kind: "MODULE_EXPORTS_SYMBOL", from: "module:auth", to: "symbol:auth-toDto" }),
    graphEdge({ id: "x6", kind: "MODULE_EXPORTS_SYMBOL", from: "module:attacker", to: "symbol:attacker-assertCsrf" }),
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
      requires_key: "auth_helpers",
      symbol: "requireUser",
      specifier: "@/lib",
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
     * `src/lib/auth.ts` is still here, because it arrives through the barrel's re-export chain AND
     * genuinely exports `requireUser` - facts about what the repo exports, not about how the
     * specifier is spelled. The attacker module now fails both tests: it is not named exactly by
     * the specifier, and it does not export the symbol.
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
      requires_key: "csrf_helpers",
      symbol: "assertCsrf",
      specifier: "@/lib/auth",
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
      requires_key: "auth_helpers",
      symbol: "getServerSession",
      specifier: "next-auth",
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
        moduleNode({ id: "module:mmm", filePath: "src/lib/mmm.ts" }),
        symbolNode({ id: "symbol:aaa-requireUser", filePath: "src/lib/aaa.ts", name: "requireUser" })
      ],
      edges: [
        graphEdge({ id: "u1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:one", to: "module:zzz" }),
        // Same specifier, same target file: one entry, not two.
        graphEdge({ id: "u2", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:two", to: "module:zzz" }),
        graphEdge({ id: "u3", kind: "MODULE_REEXPORTS_MODULE", from: "module:zzz", to: "module:mmm", exportedName: "*" }),
        graphEdge({ id: "u4", kind: "MODULE_REEXPORTS_MODULE", from: "module:mmm", to: "module:aaa", exportedName: "*" }),
        graphEdge({ id: "u5", kind: "MODULE_EXPORTS_SYMBOL", from: "module:aaa", to: "symbol:aaa-requireUser" })
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
      requires_key: "auth_helpers",
      symbol: "requireUser",
      specifier: "@/lib/gone",
      mode: "unresolved",
      files: []
    });
  });

  it("a_symbol_used_by_two_requires_lists_keeps_both_identities", () => {
    /**
     * B3: `symbol` is unique WITHIN a requires list, never across them. The engine keeps the lists
     * apart - `accepted_auth_helpers_for_convention`, `phase6_helpers_from_requires` and
     * `security_helpers_from_requires` each build their own map - so a name reused by an auth
     * helper and a response serializer is two helpers there and must be two here.
     *
     * Keying by symbol alone collapsed them, last list read winning. The damage is not cosmetic:
     * below, the auth helper resolves (`repo_resolved`, a real file identity) and the serializer
     * does not (`external`). Collapsing yielded the single entry
     * `{"symbol":"dup","mode":"external","files":[]}`, destroying the auth identity - so Sprint 4
     * would apply exact-specifier matching to an auth helper that had a resolved file. That is the
     * silent tier-1 retention this sprint exists to prevent, manufactured by the design itself,
     * and which list won depended on the order of a literal.
     */
    const identities = resolvedHelperIdentities(
      checkData,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:dup", symbol: "dup", import: "@/lib/auth" }],
        response_serializers: [
          { serializer_id: "serializer:dup", imported_name: "dup", import_source: "next-auth" }
        ]
      })
    );

    expect(identities).toEqual([
      {
        requires_key: "auth_helpers",
        symbol: "dup",
        specifier: "@/lib/auth",
        mode: "repo_resolved",
        files: ["src/lib/auth.ts"]
      },
      {
        requires_key: "response_serializers",
        symbol: "dup",
        specifier: "next-auth",
        mode: "external",
        files: []
      }
    ]);
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

    // Ordered by requires list, then symbol - so the grouping a consumer joins on is the grouping
    // the array already has.
    expect(identities.map((identity) => [identity.requires_key, identity.symbol, identity.mode]))
      .toEqual([
        ["auth_helpers", "requireUser", "repo_resolved"],
        ["csrf_helpers", "assertCsrf", "repo_resolved"],
        ["outbound_url_allowlist_helpers", "allowOutbound", "unresolved"],
        ["rate_limit_helpers", "ratelimit", "external"],
        ["response_serializers", "toDto", "repo_resolved"],
        ["validators", "parseBody", "repo_resolved"]
      ]);
  });
});

/**
 * B4: the barrel is the other half of the laundering surface, and the more powerful half.
 *
 * Bounding the SPECIFIER relation to exact match stopped an attacker dropping a module under an
 * accepted prefix. It did nothing about the re-export closure, which followed every
 * `MODULE_REEXPORTS_MODULE` edge out of the resolved module without regard to which SYMBOL the
 * helper is. A barrel that re-exports both the real helper and an attacker module put the attacker
 * module inside the accepted helper's own identity - and editing the barrel is strictly more
 * powerful than adding a file beside it, because the barrel is what the contract points at.
 *
 * The graph already distinguishes them. `MODULE_REEXPORTS_MODULE` carries `exported_name` - the
 * re-exported symbol, or `"*"` for a flattening `export *` - and `MODULE_EXPORTS_SYMBOL` says what
 * a module actually exports. Both were present and unread.
 */
describe("resolvedHelperIdentities re-export closure", () => {
  /**
   * A barrel over two modules:
   *   `export * from "./auth"`                -> defines `requireUser`
   *   `export * from "./attacker-controlled"` -> defines `pwn`, and NOT `requireUser`
   *
   * Star re-exports both ways, which is the hard case: the edge itself names no symbol, so only
   * what the target module exports can separate them.
   */
  const barrel = graphScanData({
    nodes: [
      importNode({ id: "import:barrel", filePath: ROUTE, source: "@/lib" }),
      moduleNode({ id: "module:index", filePath: "src/lib/index.ts" }),
      moduleNode({ id: "module:auth", filePath: "src/lib/auth.ts" }),
      moduleNode({ id: "module:attacker", filePath: "src/lib/attacker-controlled.ts" }),
      symbolNode({ id: "sym:requireUser", filePath: "src/lib/auth.ts", name: "requireUser" }),
      symbolNode({ id: "sym:pwn", filePath: "src/lib/attacker-controlled.ts", name: "pwn" })
    ],
    edges: [
      graphEdge({ id: "b1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:barrel", to: "module:index" }),
      graphEdge({ id: "b2", kind: "MODULE_REEXPORTS_MODULE", from: "module:index", to: "module:auth", exportedName: "*" }),
      graphEdge({ id: "b3", kind: "MODULE_REEXPORTS_MODULE", from: "module:index", to: "module:attacker", exportedName: "*" }),
      graphEdge({ id: "b4", kind: "MODULE_EXPORTS_SYMBOL", from: "module:auth", to: "sym:requireUser" }),
      graphEdge({ id: "b5", kind: "MODULE_EXPORTS_SYMBOL", from: "module:attacker", to: "sym:pwn" })
    ]
  });

  it("a_barrel_sibling_that_lacks_the_symbol_is_not_the_helper", () => {
    const identities = resolvedHelperIdentities(
      barrel,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:requireUser", symbol: "requireUser", import: "@/lib" }]
      })
    );

    // `src/lib/index.ts` is what the specifier literally names, so it stays. `src/lib/auth.ts` is
    // reached because the barrel really does re-export `requireUser` from it. The attacker's
    // module is re-exported by the same barrel and exports no such symbol, so it is not the helper.
    expect(identityFor(identities, "requireUser")?.files)
      .toEqual(["src/lib/auth.ts", "src/lib/index.ts"]);
  });

  it("follows a named re-export only for the symbol it actually names", () => {
    const named = graphScanData({
      nodes: [
        importNode({ id: "import:barrel", filePath: ROUTE, source: "@/lib" }),
        moduleNode({ id: "module:index", filePath: "src/lib/index.ts" }),
        moduleNode({ id: "module:auth", filePath: "src/lib/auth.ts" }),
        moduleNode({ id: "module:attacker", filePath: "src/lib/attacker-controlled.ts" })
      ],
      edges: [
        graphEdge({ id: "n1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:barrel", to: "module:index" }),
        // `export { requireUser } from "./auth"` - the edge itself is the evidence.
        graphEdge({ id: "n2", kind: "MODULE_REEXPORTS_MODULE", from: "module:index", to: "module:auth", exportedName: "requireUser" }),
        // `export { pwn } from "./attacker-controlled"` - a different symbol entirely.
        graphEdge({ id: "n3", kind: "MODULE_REEXPORTS_MODULE", from: "module:index", to: "module:attacker", exportedName: "pwn" })
      ]
    });

    const identities = resolvedHelperIdentities(
      named,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:requireUser", symbol: "requireUser", import: "@/lib" }]
      })
    );

    expect(identityFor(identities, "requireUser")?.files)
      .toEqual(["src/lib/auth.ts", "src/lib/index.ts"]);
  });

  it("follows a star chain through a module that only passes the symbol along", () => {
    // barrel -> mid -> leaf, both hops `export *`. `mid` exports nothing of its own, but a route
    // importing `mid` really would get `requireUser`, so it belongs to the identity too.
    const chain = graphScanData({
      nodes: [
        importNode({ id: "import:barrel", filePath: ROUTE, source: "@/lib" }),
        moduleNode({ id: "module:index", filePath: "src/lib/index.ts" }),
        moduleNode({ id: "module:mid", filePath: "src/lib/mid.ts" }),
        moduleNode({ id: "module:leaf", filePath: "src/lib/leaf.ts" }),
        moduleNode({ id: "module:other", filePath: "src/lib/other.ts" }),
        symbolNode({ id: "sym:requireUser", filePath: "src/lib/leaf.ts", name: "requireUser" }),
        symbolNode({ id: "sym:unrelated", filePath: "src/lib/other.ts", name: "unrelated" })
      ],
      edges: [
        graphEdge({ id: "c1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:barrel", to: "module:index" }),
        graphEdge({ id: "c2", kind: "MODULE_REEXPORTS_MODULE", from: "module:index", to: "module:mid", exportedName: "*" }),
        graphEdge({ id: "c3", kind: "MODULE_REEXPORTS_MODULE", from: "module:mid", to: "module:leaf", exportedName: "*" }),
        graphEdge({ id: "c4", kind: "MODULE_REEXPORTS_MODULE", from: "module:index", to: "module:other", exportedName: "*" }),
        graphEdge({ id: "c5", kind: "MODULE_EXPORTS_SYMBOL", from: "module:leaf", to: "sym:requireUser" }),
        graphEdge({ id: "c6", kind: "MODULE_EXPORTS_SYMBOL", from: "module:other", to: "sym:unrelated" })
      ]
    });

    const identities = resolvedHelperIdentities(
      chain,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:requireUser", symbol: "requireUser", import: "@/lib" }]
      })
    );

    expect(identityFor(identities, "requireUser")?.files)
      .toEqual(["src/lib/index.ts", "src/lib/leaf.ts", "src/lib/mid.ts"]);
  });

  it("keeps the module the specifier names even when nothing proves the symbol", () => {
    /**
     * The documented degradation. With no `MODULE_EXPORTS_SYMBOL` evidence anywhere - a language or
     * file the extractor did not produce export facts for - the transitive claims cannot be
     * checked, so they are dropped. What the specifier LITERALLY names is not a symbol claim and
     * stays, so this narrows rather than empties: a route importing the barrel still matches, and
     * no compliant route is turned into a violation.
     */
    const noSymbols = graphScanData({
      nodes: [
        importNode({ id: "import:barrel", filePath: ROUTE, source: "@/lib" }),
        moduleNode({ id: "module:index", filePath: "src/lib/index.ts" }),
        moduleNode({ id: "module:auth", filePath: "src/lib/auth.ts" })
      ],
      edges: [
        graphEdge({ id: "s1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:barrel", to: "module:index" }),
        graphEdge({ id: "s2", kind: "MODULE_REEXPORTS_MODULE", from: "module:index", to: "module:auth", exportedName: "*" })
      ]
    });

    const identities = resolvedHelperIdentities(
      noSymbols,
      conventionRequiring({
        auth_helpers: [{ guard_id: "auth:requireUser", symbol: "requireUser", import: "@/lib" }]
      })
    );

    expect(identityFor(identities, "requireUser")?.files).toEqual(["src/lib/index.ts"]);
  });
});
