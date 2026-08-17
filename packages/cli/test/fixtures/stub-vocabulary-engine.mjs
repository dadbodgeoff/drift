#!/usr/bin/env node
/**
 * A drift-engine stand-in that declares a vocabulary member this CLI does not know.
 *
 * The handshake exists for exactly one pairing: an engine binary newer than the TypeScript beside
 * it. That state cannot be produced from this checkout - both sides are generated from
 * vocabulary/vocabulary.json - so the only honest way to exercise the refusal is to stand in for the
 * newer engine.
 *
 * Which vocabulary it overdeclares is chosen by env, because the CLI owns the argv:
 *   DRIFT_STUB_VOCABULARY  one of "fact" | "graph_node" | "graph_edge" | "none"
 */

const SCHEMA = "engine.stream.event.v1";
const FILE_PATH = "app/api/x/route.ts";

const args = process.argv.slice(2);
const subcommand = args[0];
const overdeclare = process.env.DRIFT_STUB_VOCABULARY ?? "none";

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function flagValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (subcommand === "version") {
  process.stdout.write(
    `${JSON.stringify({ build_profile: "release", engine_version: "stub-vocabulary-engine" })}\n`
  );
  process.exit(0);
}

if (subcommand === "infer-candidates") {
  // Drained but unread. `scan` runs inference after the stream, so the accepting case needs this
  // arm to reach exit 0 - and a run that reaches exit 0 is what proves the refusal is selective.
  process.stdin.resume();
  process.stdin.on("end", () => {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "engine.candidates.result.v1",
        repo_id: "repo_stub",
        scan_id: "scan_stub",
        engine_version: "stub-vocabulary-engine",
        rule_engine_version: "stub",
        adapter_versions: { typescript: "stub" },
        candidates: [],
        diagnostics: [],
        stats: {
          files_seen: 1,
          files_skipped: 0,
          files_parsed: 1,
          facts_emitted: 0,
          graph_nodes: 0,
          graph_edges: 0,
          diagnostics_emitted: 0,
          duration_ms: 0,
          truncated: false
        },
        completeness: []
      })}\n`
    );
    process.exit(0);
  });
} else if (subcommand !== "scan-repo") {
  process.stderr.write(`stub-vocabulary-engine: unsupported subcommand ${subcommand ?? "(none)"}\n`);
  process.exit(2);
} else {

// A real handshake, plus one member from a hypothetical newer engine. `engine_version` and
// `schema_version` deliberately stay at values this CLI accepts: neither moves when the vocabulary
// changes, which is why the vocabulary itself is what gets compared.
emit({
  schema_version: SCHEMA,
  event: "scan_started",
  repo_id: flagValue("--repo-id") ?? "repo_stub",
  scan_id: flagValue("--scan-id") ?? "scan_stub",
  engine_version: "stub-vocabulary-engine",
  build_profile: "release",
  fact_kinds: ["file_detected", ...(overdeclare === "fact" ? ["graphql_resolver_declared"] : [])],
  graph_node_kinds: ["file", ...(overdeclare === "graph_node" ? ["service_boundary"] : [])],
  graph_edge_kinds: ["FILE_HAS_VERSION", ...(overdeclare === "graph_edge" ? ["ROUTE_CALLS_SERVICE"] : [])]
});

// Everything past the handshake is well-formed, so a run that reaches here proves the refusal did
// not fire rather than that something else broke.
emit({
  schema_version: SCHEMA,
  event: "file_snapshot_batch",
  file_snapshots: [
    { file_path: FILE_PATH, content_hash: "stubhash", byte_size: 64, indexed: true }
  ]
});
emit({
  schema_version: SCHEMA,
  event: "scan_completed",
  stats: {
    files_seen: 1,
    files_skipped: 0,
    files_parsed: 1,
    facts_emitted: 0,
    graph_nodes: 0,
    graph_edges: 0,
    diagnostics_emitted: 0,
    duration_ms: 0,
    truncated: false
  },
  completeness: []
});
process.stdout.end();
}
