import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchesGlob } from "../src/globs.js";

/**
 * Cross-process parity for Drift's two glob engines.
 *
 * `matchesGlob` here and `path_glob_matches` in `crates/drift-engine/src/check_command.rs` decide
 * the same question — which files a convention's path scope covers — on opposite sides of the
 * CLI/engine process boundary. They share no code and cannot: the engine is a separate binary.
 * The only thing holding them together is this differential, and they have already drifted once:
 * `globs.ts` fixed the zero-segment `**\/` bug and the Rust copy stayed a prefix shim, which is
 * exactly how proposer-scoped security conventions could be accepted while being structurally
 * unable to match a file.
 *
 * This compares the two GLOB ENGINES and deliberately nothing else. The tempting version — run
 * `conventionScopeFiles` against the engine's scope narrowing — is not a glob comparison at all.
 * `convention-scope.ts:34-48` gates every api-route convention on `isNextApiRoutePath` first, and
 * `:45-47` then short-circuits the *default* api-route glob set (`API_ROUTE_SCOPE_GLOBS`, the
 * D-H2 eight) out of the comparison entirely, answering from that role check alone. Such a test
 * would compare a glob engine against a role predicate and agree for the wrong reason. Measured
 * while writing this: the security proposer's narrower three-glob `route_scope` is *not* the
 * default set, so it does not hit the short-circuit — but the role gate in front of it applies
 * either way, so the CLI scope surface is never a bare glob engine.
 *
 * `test/canary/glob-parity.json` carries the proposer's literal emitted glob set, a fixture path
 * list, and one `selected` list generated from the Rust matcher's real output. The Rust test
 * (`check_command.rs::glob_engine_parity_tests`) asserts `path_glob_matches` reproduces it; this
 * one asserts `matchesGlob` reproduces it from the same input. Neither side hard-codes the other's
 * answer, and there is no regeneration flag — a change to either matcher alone turns its own side
 * red, and the fix is to decide which matcher is wrong, not to refresh the artifact.
 */

interface GlobParityArtifact {
  globs: string[];
  files: string[];
  selected: string[];
  pattern_cases: Array<{ pattern: string; path: string; matches: boolean }>;
}

const ARTIFACT_PATH = fileURLToPath(new URL("../../../test/canary/glob-parity.json", import.meta.url));
const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as GlobParityArtifact;

describe("glob engine parity across the CLI/engine boundary", () => {
  it("matchesGlob reproduces the shared parity selection", () => {
    expect(artifact.globs.length).toBeGreaterThan(0);
    expect(artifact.files.length).toBeGreaterThan(0);

    // Input order, not sorted: a stable selection order is part of what parity means.
    const selected = artifact.files.filter((file) => artifact.globs.some((glob) => matchesGlob(file, glob)));

    expect(selected).toEqual(artifact.selected);
  });

  it("matchesGlob reproduces the shared single-pattern cases", () => {
    expect(artifact.pattern_cases.length).toBeGreaterThan(0);
    const actual = artifact.pattern_cases.map((row) => ({
      pattern: row.pattern,
      path: row.path,
      matches: matchesGlob(row.path, row.pattern)
    }));
    expect(actual).toEqual(artifact.pattern_cases);
  });

  /**
   * The one input on which the two engines were ever measured to disagree, kept as a named row so
   * a future reader can find it. `path_glob_matches` carried a widening that made a trailing `/*`
   * also match the bare directory; `matchesGlob` did not, and `matchesGlob` was right — `*` is
   * "any run of characters except `/`" in both files' own documented semantics. The widening was
   * real but belonged to phase5, which matches these patterns against *route paths*, so it moved
   * to `phase5_scope_pattern_matches` in check_command.rs rather than being deleted.
   */
  it("the trailing-slash-star divergence is closed, not papered over", () => {
    expect(matchesGlob("/api/users", "/api/users/*")).toBe(false);
    expect(matchesGlob("/api/users/detail", "/api/users/*")).toBe(true);
    expect(artifact.pattern_cases).toContainEqual({
      pattern: "/api/users/*",
      path: "/api/users",
      matches: false
    });
  });

  /**
   * The artifact is only worth anything if it carries the cases the historical bug killed. Pinned
   * so a future edit cannot quietly shrink it into a fixture that both matchers pass vacuously.
   */
  it("the parity fixture still carries the zero-segment and near-miss cases", () => {
    expect(artifact.globs).toEqual([
      "**/app/api/**/route.ts",
      "**/app/api/**/route.tsx",
      "**/pages/api/**/*.ts"
    ]);
    // Zero nesting depth under the `**/` prefix — the whole original defect.
    expect(artifact.selected).toContain("app/api/route.ts");
    expect(artifact.selected).toContain("pages/api/handler.ts");
    // Near-misses that must stay out of the selection on both sides.
    for (const excluded of [
      "app/apixyz/route.ts",
      "app/api/users/handler.ts",
      "app/api/users/route.js",
      "app/api/users/route.ts.bak",
      "notapp/api/route.ts",
      "pages/apix/handler.ts"
    ]) {
      expect(artifact.files).toContain(excluded);
      expect(artifact.selected).not.toContain(excluded);
    }
  });
});
