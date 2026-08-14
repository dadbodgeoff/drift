#!/usr/bin/env node
/**
 * A drift-engine stand-in whose only interesting property is the SIZE of the stream it emits.
 *
 * T-01 needs an engine payload above the ingest ceiling. The real thing requires lobe-chat
 * (11,932 files, 183 MB of JSONL, minutes per run), which is neither cloneable in CI nor
 * deterministic. This emits a schema-valid stream of a requested byte size instead, so the gate
 * is exercised at its real seam - `collectScanData` -> `runScanRepo` - in about a second.
 *
 * Controlled by env, because the CLI owns the argv it passes to the engine:
 *   DRIFT_STUB_ENGINE_PAYLOAD_BYTES  approximate stdout bytes to emit for `scan-repo`
 */

const SCHEMA = "engine.stream.event.v1";
const FILE_PATH = "app/api/x/route.ts";

const args = process.argv.slice(2);
const subcommand = args[0];

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function flagValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (subcommand === "version") {
  process.stdout.write(
    `${JSON.stringify({ build_profile: "release", engine_version: "stub-payload-engine" })}\n`
  );
  process.exit(0);
}

if (subcommand === "infer-candidates") {
  // Drained but unread: this stub proposes nothing, which is a legitimate engine answer and
  // keeps the under-ceiling case a real end-to-end onboarding.
  process.stdin.resume();
  process.stdin.on("end", () => {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "engine.candidates.result.v1",
        repo_id: "repo_stub",
        scan_id: "scan_stub",
        engine_version: "stub-payload-engine",
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
} else if (subcommand === "scan-repo") {
  const targetBytes = Number(process.env.DRIFT_STUB_ENGINE_PAYLOAD_BYTES ?? 4096);

  emit({
    schema_version: SCHEMA,
    event: "scan_started",
    repo_id: flagValue("--repo-id") ?? "repo_stub",
    scan_id: flagValue("--scan-id") ?? "scan_stub",
    engine_version: "stub-payload-engine",
    build_profile: "release"
  });
  emit({
    schema_version: SCHEMA,
    event: "file_snapshot_batch",
    file_snapshots: [
      { file_path: FILE_PATH, content_hash: "stubhash", byte_size: 64, indexed: true }
    ]
  });

  // Bulk is carried by fact `value` strings, batched one megabyte to a line.
  //
  // The size of an individual value matters to what a test can conclude. Few-and-huge is cheap to
  // parse and fine for a test about STREAM size (T-01), but a single 8 MB value is itself a large
  // string, so a test asserting "no serialization is proportional to repo size" (T-02) cannot tell
  // the fixture's own leaf apart from a whole-graph string. Many-and-small costs more objects and
  // makes that distinction real, which is why the caller chooses.
  const VALUE_BYTES = Number(process.env.DRIFT_STUB_ENGINE_FACT_VALUE_BYTES ?? 1024 * 1024);
  const LINE_BYTES = 1024 * 1024;
  const factsPerLine = Math.max(1, Math.floor(LINE_BYTES / (VALUE_BYTES + 128)));
  const padding = "x".repeat(VALUE_BYTES);
  let emitted = 0;
  let index = 0;
  while (emitted < targetBytes) {
    const facts = [];
    for (let n = 0; n < factsPerLine; n += 1) {
      facts.push({
        kind: "file_detected",
        file_path: FILE_PATH,
        name: `stub_${index}_${n}`,
        value: padding,
        start_line: 1,
        end_line: 1,
        start_column: 0,
        end_column: 0
      });
    }
    const line = JSON.stringify({ schema_version: SCHEMA, event: "fact_batch", facts });
    process.stdout.write(`${line}\n`);
    emitted += Buffer.byteLength(line) + 1;
    index += 1;
  }

  emit({
    schema_version: SCHEMA,
    event: "scan_completed",
    stats: {
      files_seen: 1,
      files_skipped: 0,
      files_parsed: 1,
      facts_emitted: index,
      graph_nodes: 0,
      graph_edges: 0,
      diagnostics_emitted: 0,
      duration_ms: 0,
      truncated: false
    },
    completeness: []
  });
  process.stdout.end();
} else {
  process.stderr.write(`stub-payload-engine: unsupported subcommand ${subcommand ?? "(none)"}\n`);
  process.exit(2);
}
