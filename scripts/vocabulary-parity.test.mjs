import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = join(repoRoot, "scripts/vocabulary-parity-baseline.json");
const MANIFEST = join(repoRoot, "vocabulary/vocabulary.json");
const GENERATED_TS = join(repoRoot, "packages/vocabulary/src/index.ts");
const GENERATED_RS = join(repoRoot, "crates/drift-engine/src/vocabulary.rs");
const MCP_TOOLS = join(repoRoot, "packages/mcp/src/tools.ts");
const SEMANTIC_CAPABILITIES = join(repoRoot, "packages/core/src/semantic-capabilities.ts");
const CHECK_COMMAND = join(repoRoot, "crates/drift-engine/src/check_command.rs");

const originals = new Map(
  [BASELINE, MANIFEST, GENERATED_TS, GENERATED_RS, MCP_TOOLS, SEMANTIC_CAPABILITIES, CHECK_COMMAND].map((path) => [
    path,
    readFileSync(path, "utf8")
  ])
);

function runGate() {
  try {
    return {
      exitCode: 0,
      output: execFileSync("node", ["scripts/vocabulary-parity.mjs"], {
        cwd: repoRoot,
        encoding: "utf8"
      })
    };
  } catch (error) {
    return { exitCode: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/**
 * Each case below is a defect that SHIPPED, reintroduced.
 *
 * A vocabulary gate that has never been shown to fail is the same artefact as the two hand-written
 * lists it replaces: something everyone believes and nothing exercises. The five defect classes W5
 * closed are replayed here, one per test, plus both directions of the ratchet.
 */
describe("vocabulary parity gate", () => {
  afterEach(() => {
    // Both generated files are restored, not just the one a given case edits: the no-producer case
    // runs the generator, which rewrites both, and leaving either behind makes the NEXT test fail
    // for a reason that has nothing to do with what it asserts.
    for (const [path, content] of originals) {
      writeFileSync(path, content);
    }
  });

  it("passes against the committed manifest and baseline", () => {
    const result = runGate();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("vocabulary parity:");
  });

  /**
   * D-M4b: `get_conventions` declared 9 of the 23 convention kinds.
   *
   * The shipped list included all three kinds with no evaluator and omitted 14 with working ones -
   * a snapshot of an aspirational older list, frozen in place by an MCP test that asserted the same
   * nine back.
   */
  it("fails on a hand-written enum that is a partial copy of a vocabulary", () => {
    writeFileSync(
      MCP_TOOLS,
      originals.get(MCP_TOOLS).replace(
        "kind: { type: \"string\", enum: [...CONVENTION_KINDS] },",
        'kind: {\n          type: "string",\n          enum: [\n            "api_route_no_direct_data_access",\n            "api_route_requires_service_delegation",\n            "api_route_requires_auth_helper",\n            "middleware_must_cover_routes",\n            "session_object_must_come_from_trusted_helper",\n            "api_route_requires_authorization",\n            "api_route_requires_tenant_scope",\n            "test_expected_for_changed_module",\n            "custom_briefing"\n          ]\n        },'
      )
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("NEW hand-written vocabulary subset: packages/mcp/src/tools.ts");
    expect(result.output).toContain("9 of the 23 convention_kind members");
    expect(result.output).toContain("api_route_forbids_untrusted_ssrf");
  });

  /**
   * D-S1: `BUILTIN_SEMANTIC_CAPABILITIES` named graph node kinds that do not exist.
   *
   * `role` (the real kind is `file_role`) and `import` (`import_decl`) came from a dead sixth copy
   * of the graph vocabulary. Nothing validated the field, so two wrong names sat in a contract that
   * describes what the engine emits, and were then copied into the engine's own test fixtures.
   */
  it("fails when a capability contract names a kind outside its vocabulary", () => {
    writeFileSync(
      SEMANTIC_CAPABILITIES,
      originals
        .get(SEMANTIC_CAPABILITIES)
        .replace(
          'emitted_node_kinds: ["symbol", "callsite", "route", "file_role"],',
          'emitted_node_kinds: ["symbol", "callsite", "route", "role"],'
        )
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("UNKNOWN VOCABULARY MEMBER");
    expect(result.output).toContain('emitted_node_kinds: "role"');
    expect(result.output).toContain("graph_node_kind vocabulary");
  });

  /**
   * D-S1, the other half: a capability id from a namespace nothing emits.
   *
   * Every id in this file used to look like `ts.route_flow.v1`, and none of them was ever a string
   * the engine produced. That is what made `semantic_coverage.decision` the literal "refuse".
   */
  it("fails when a capability id is not a member of the capability vocabulary", () => {
    writeFileSync(
      SEMANTIC_CAPABILITIES,
      originals
        .get(SEMANTIC_CAPABILITIES)
        .replace('capability_id: "route_flow",', 'capability_id: "ts.route_flow.v1",')
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('capability_id: "ts.route_flow.v1"');
    expect(result.output).toContain("scan_capability vocabulary");
  });

  /**
   * D-P3a: a convention kind whose dispatch names an evaluator that does not have it.
   *
   * The pre-W5 arrangement made this undetectable - three dispatch mechanisms and no list of all
   * twenty-three kinds - so "accepted and enforcing nothing" was a state `check` reported as a pass.
   * Marking an implemented kind `none` is the same disagreement seen from the other side.
   */
  it("fails when the dispatch table disagrees with the evaluator source", () => {
    writeFileSync(
      MANIFEST,
      originals
        .get(MANIFEST)
        .replace(
          '{ "wire": "api_route_requires_auth_helper", "dispatch": "engine_direct"',
          '{ "wire": "api_route_requires_auth_helper", "dispatch": "none"'
        )
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("DISPATCH MISMATCH");
    expect(result.output).toContain("api_route_requires_auth_helper");
  });

  /**
   * The generated files and the manifest are one thing. A hand edit to either restores the
   * two-hand-written-lists problem with an extra step, which is worse than it was before, because
   * the file says "@generated" and nobody reads it.
   */
  it("fails when a generated file is edited by hand", () => {
    writeFileSync(
      GENERATED_TS,
      originals.get(GENERATED_TS).replace('  "file_detected",\n', '  "file_detected",\n  "invented_kind",\n')
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("STALE GENERATED FILE: packages/vocabulary/src/index.ts");
  });

  /**
   * D-F2 / D-G5, the ratchet forward: a member with no producer must be declared reserved.
   *
   * `csrf_guard_called` and `FINDING_HAS_EVIDENCE` shipped in this state - advertised, consumed,
   * emitted by nothing - and the way that happens is one more entry added to a list with no cost.
   */
  it("fails when a new vocabulary member has no producer", () => {
    writeFileSync(
      MANIFEST,
      originals.get(MANIFEST).replace('        "route_declared",\n', '        "route_declared",\n        "graphql_resolver_declared",\n')
    );
    // Regenerate, so the failure is about the missing producer rather than about staleness.
    execFileSync("node", ["vocabulary/generate.mjs"], { cwd: repoRoot });

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(
      "NEW vocabulary member with no producer: fact_kind.graphql_resolver_declared"
    );
  });

  /**
   * The ratchet backwards. A baseline that still claims a gap which has been closed is a false
   * record, and a false record in a file nobody re-reads is how the lists got wrong in the first
   * place. `file_detected` is produced by the first fact facts.rs emits.
   */
  it("fails on a baseline entry whose gap has been closed", () => {
    writeFileSync(
      BASELINE,
      JSON.stringify({
        declared_subsets: [],
        reserved_members: [
          ...JSON.parse(originals.get(BASELINE)).reserved_members,
          {
            vocabulary: "fact_kind",
            member: "file_detected",
            gap: "no_producer",
            reason: "not actually a gap"
          }
        ]
      })
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("STALE baseline entry: fact_kind:file_detected is now referenced");
  });

  /**
   * The gate must not go quiet if the source it reads is restructured. `check_command.rs`'s match is
   * exhaustive, so every kind with no evaluator is NAMED in the arm that skips it - and searching
   * the file without excluding that arm would report every unimplemented kind as implemented, which
   * is the failure this gate exists to catch, produced by the gate itself.
   */
  it("fails loudly when it can no longer find the engine's skip arm", () => {
    writeFileSync(
      CHECK_COMMAND,
      originals.get(CHECK_COMMAND).replace("// Evaluated elsewhere, or by nobody.", "// reorganised")
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("no longer contains the marker comment");
  });
});
