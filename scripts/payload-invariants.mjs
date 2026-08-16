#!/usr/bin/env node
/**
 * A trust-calibration field that cannot change is not calibrating anything.
 *
 * Drift's payloads carry a layer of fields whose entire job is telling an agent how much to
 * believe the rest of the document: whether the list was truncated, whether the scan was fresh,
 * why a section is empty, whether Drift refused rather than answered. Four of them shipped as
 * values that could not move:
 *
 *   truncated.conventions      the literal `false`, while its two siblings were computed length
 *                              comparisons. 200 conventions produced 189,211 bytes against a
 *                              32,768 budget with the field still reporting false (D-M5).
 *   error.type                 the literal "refusal" on every JSON error, including
 *                              `drift frobnicate --json`, which is a usage error (W3).
 *   test_intelligence_reason   "not_implemented_for_repo" whenever the list was empty, so a repo
 *                              with no tests and a repo whose tests the matcher missed emitted
 *                              the byte-identical string (D-A3).
 *   full_list_command          named `drift doctor --repo <id> --json`, which accepts neither
 *                              flag and returns no parser_gaps key (D-A5).
 *
 * Each was found by hand, one workstream at a time. This is the gate for the class.
 *
 * TWO CHECKS, because one principle does not cover all four. `full_list_command` VARIED - it
 * embeds the repo id, so it differs on every repo - and a variance check would have passed it.
 * Its defect was that it pointed at a command that does not exist. So:
 *
 *   A. VARIANCE      a trust discriminator that is identical across the whole matrix is either a
 *                    hardcoded literal or a field with nothing behind it. Baseline it with a
 *                    reason or make it move.
 *   B. POINTERS      a field valued `drift <group> <command> ...` must name a command the router
 *                    actually routes. Checked against the router's own source, the same way the
 *                    D-CL3 command-surface test reads it - a restated list here would be the
 *                    defect this catches, one level up.
 *
 * SCOPE. Check A evaluates trust DISCRIMINATORS, not every leaf. Booleans, fields named
 * `*_reason`/`*_status`/`*_source`/`*_freshness`/`*_mode`/`decision`, and anything beneath
 * `truncated`/`redactions`/`readiness`. Ids, hashes, timestamps, paths and free-running counts
 * are out of scope BY CONSTRUCTION rather than by a several-hundred-entry baseline recording that
 * `schema_version` is constant - a baseline nobody can read is one nobody checks.
 *
 * BOTH SURFACES are driven. W6 unified `repoMapPayload` and `preparedConvention`, so those are
 * one derivation now - but 40 duplicated pairs remain across the CLI/MCP boundary (see
 * scripts/surface-parity-baseline.json), ten of them in scan-status.ts, which produces
 * `scan_status`, `readiness` and `freshness_requirement`. A field can still be live on one
 * surface and frozen on the other.
 *
 *   node scripts/payload-invariants.mjs
 *   node scripts/payload-invariants.mjs --update    # rewrite the baseline (reasons preserved)
 */

import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const BASELINE = join(HERE, "payload-invariants-baseline.json");
const ROUTER_SOURCE = join(REPO_ROOT, "packages/cli/src/app/router.ts");
const RUN_CLI_SOURCE = join(REPO_ROOT, "packages/cli/src/app/run-cli.ts");

/**
 * The matrix. Each cell must differ from the others in a dimension a trust field is supposed to
 * respond to - otherwise "this field never moved" says nothing about the field.
 *
 *   next-api-direct-db          violations present, conventions inferrable
 *   next-api-service-delegated  the clean counterpart: same shape, nothing to report
 *   no-ts-repo                  nothing indexable at all - the empty end of every count
 *   mixed-js-ts                 .js parsed as TSX (W7), so facts exist where a suffix rule said
 *                               they would not
 *   security-middleware-dynamic-parser-gap
 *                               parser gaps present, which is what `readiness` and
 *                               `parser_gap_quality` exist to report
 *   binary-and-unreadable       files the scan cannot read, so diagnostics are non-zero
 */
const FIXTURES = [
  { name: "next-api-direct-db" },
  { name: "next-api-service-delegated" },
  { name: "no-ts-repo" },
  { name: "mixed-js-ts" },
  { name: "security-middleware-dynamic-parser-gap" },
  { name: "binary-and-unreadable" },
  // Two seeded variants, because NO fixture in test/fixtures carries a test file - so without
  // these `test_intelligence_reason` reads `no_test_files_in_repo` in every cell and D-A3's whole
  // point, that "this repo has no tests" and "the matcher missed them" are different answers, goes
  // unexercised. This gate found that about itself, which is the argument for running it.
  {
    name: "next-api-direct-db",
    as: "next-api-direct-db+matching-test",
    async seed(repoRoot) {
      await writeFile(
        join(repoRoot, "apps/web/app/api/users/route.test.ts"),
        "import { GET } from \"./route\";\nexport const covered = typeof GET;\n"
      );
    }
  },
  {
    name: "next-api-direct-db",
    as: "next-api-direct-db+unrelated-test",
    // Tests exist and none of them is about the change: the `no_tests_matched_change` half.
    async seed(repoRoot) {
      await mkdir(join(repoRoot, "apps/web/lib"), { recursive: true });
      await writeFile(
        join(repoRoot, "apps/web/lib/billing-reports.test.ts"),
        "export const unrelated = 1;\n"
      );
    }
  }
];

/** Field names whose job is calibration. See SCOPE above. */
const DISCRIMINATOR_SUFFIXES = [
  "_reason",
  "_status",
  "_source",
  "_freshness",
  "_mode",
  "_decision",
  "_type"
];
const DISCRIMINATOR_NAMES = new Set(["decision", "reason", "status", "stale", "complete", "valid", "type"]);
/** Objects whose every leaf is a calibration field, whatever it is called. */
const DISCRIMINATOR_PARENTS = new Set(["truncated", "redactions", "readiness", "capability_completeness"]);

export function isTrustDiscriminator(path, value) {
  // An EMPTY list, wherever it sits. Only empty arrays ever reach here as leaves - a populated one
  // recurses into its elements - so this reads "this list was empty in the cell that produced it".
  // `covered_symbols: []` in every cell is the same defect as `snapshot_usage: false` in every
  // cell, declared shape with nothing computing it, and it is the half this gate could not see.
  if (Array.isArray(value)) return true;
  if (typeof value === "boolean") return true;
  const segments = path.split(".");
  const name = segments.at(-1) ?? "";
  if (segments.some((segment) => DISCRIMINATOR_PARENTS.has(segment))) {
    // Strings and nulls only. A COUNT beneath `readiness` (`parser_gaps_by_kind.parser_error`) is
    // data the calibration fields summarise, not a calibration field, and treating it as one
    // fills the baseline with numbers that are constant because the fixture is fixed.
    return typeof value === "string" || value === null;
  }
  if (typeof value !== "string") return false;
  return (
    DISCRIMINATOR_NAMES.has(name) || DISCRIMINATOR_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}

/**
 * Leaf paths of a payload, with array indices collapsed to `[]`.
 *
 * Collapsed because `conventions.0.enforcement_mode` and `conventions.1.enforcement_mode` are the
 * same field, and keeping them apart would let a field look varying because two array elements
 * differ while the field itself is a literal.
 *
 * An EMPTY array is a leaf in its own right, valued `[]`. Without that, an array had no path
 * unless it had elements, so a field that is `[]` in every cell emitted nothing and this gate
 * evaluated it zero times - reporting success over the exact shape it exists to catch. Three of
 * `test_intelligence`'s hardcoded fields are lists, and they sat next to two hardcoded booleans
 * the gate did catch; only the type told them apart.
 */
export function leafFields(value, path = "", out = new Map()) {
  const record = (leaf) => {
    if (!path) return;
    const existing = out.get(path);
    if (existing) existing.push(leaf);
    else out.set(path, [leaf]);
  };
  if (value === null || typeof value !== "object") {
    record(value);
    return out;
  }
  if (Array.isArray(value)) {
    // Populated arrays still RECURSE and emit no leaf of their own, which is what keeps
    // `conventions[].mode` gathering values across elements.
    if (value.length === 0) record([]);
    else for (const entry of value) leafFields(entry, `${path}[]`, out);
    return out;
  }
  for (const [key, entry] of Object.entries(value)) {
    leafFields(entry, path ? `${path}.${key}` : key, out);
  }
  return out;
}

/**
 * Every array path that some cell filled, read back off the collapsed leaf keys.
 *
 * A list that is empty HERE and populated THERE is working, not frozen, and the two states land
 * under different keys: the empty cells contribute `[]` at `conventions`, the populated ones
 * contribute `conventions[].mode`. Without this, every conditionally-populated list in the payload
 * reads as a hardcoded literal - 208 of them on the first run of this gate, swamping the 12 real
 * ones. The `[]` segment appearing anywhere in a key IS the proof that something filled that array.
 *
 * Prefix-wise, not key-wise: an array of OBJECTS never produces the bare key `conventions[]`, only
 * `conventions[].<field>`, so an exact-match test misses precisely the populated arrays that matter.
 */
export function populatedArrayPaths(keys) {
  const populated = new Set();
  for (const key of keys) {
    for (let index = key.indexOf("[]"); index !== -1; index = key.indexOf("[]", index + 2)) {
      populated.add(key.slice(0, index));
    }
  }
  return populated;
}

/**
 * Why a constant is constant, and - the distinction that matters - whether that is a guarantee or
 * a hole in the matrix.
 *
 * A flat list of reasons would let "this can never be true, by design" and "no fixture makes this
 * true" sit next to each other reading identically. They are opposite facts: the first is a
 * property worth pinning, the second is the gate admitting it did not look. `kind` separates them
 * so a reader can see at a glance which constants are promises and which are untested corners,
 * and so `matrix_gap` entries stay visible as work rather than dissolving into the baseline.
 */
export function classifyConstant(path, value) {
  const name = path.split(".").at(-1) ?? "";

  if (/(^|\.)(read_only|agent_can_mutate)$/.test(path) || name === "agent_can_mutate") {
    return {
      kind: "product_invariant",
      reason:
        "Every surface this gate drives is read-only by construction - check:surface-parity asserts " +
        "zero storage writes in packages/mcp/src, and these CLI reads mutate nothing. If this ever " +
        "varies, the STALE half of this gate fires and that is the intended alarm."
    };
  }
  if (/(snippets_included|source_content_included|graph_context_included)$/.test(name)) {
    return {
      kind: "product_invariant",
      reason:
        "Drift ships metadata about code, never the code. These are the fields that say so, and " +
        "they are false on every surface deliberately rather than incidentally."
    };
  }
  if (name === "schema_version" || name === "surface" || name === "response_schema") {
    return {
      kind: "payload_identity",
      reason:
        "Identity, not calibration: a repo-map readiness block reports surface `repo_map` in every " +
        "cell because that is what it is. Pinned so a renamed surface or a bumped schema shows up."
    };
  }
  if (/(engine_source|fallback_used|enforcement_degraded)$/.test(name)) {
    return {
      kind: "environment",
      reason:
        "Fixed by the environment this gate runs in: the engine binary is always present, so the " +
        "TypeScript fallback never engages. external-eval asserts the same two fields against the " +
        "real corpus, where a fallback would be a genuine regression."
    };
  }
  if (/^can_/.test(name) || /(^|\.)policy(_proof)?\.(allowed|reason)$/.test(path) || name === "local_only") {
    return {
      kind: "matrix_gap",
      reason:
        "The policy dimension is unexercised: no fixture sets a restrictive `context_egress` in its " +
        "contract, so authorization is granted in every cell and the whole permission matrix reads " +
        "as one value. Closing it needs a fixture whose contract denies a surface - not a bigger " +
        "repo. Known hole, not a promise that policy cannot deny."
    };
  }
  if (/(audit_integrity\.valid|audit_valid)$/.test(path)) {
    return {
      kind: "matrix_gap",
      reason:
        "The audit chain verifies in every cell because nothing tampers with it. Making this false " +
        "means corrupting a hash-linked log on purpose, which the storage suite does directly; this " +
        "matrix only ever builds intact ones."
    };
  }
  if (/(graph_available|graph_complete)$/.test(name)) {
    return {
      kind: "environment",
      reason:
        "The engine produces a graph for every fixture here, so the degraded path never engages. " +
        "The absent-graph branch is covered where it can be forced directly rather than by hoping " +
        "a fixture fails to parse."
    };
  }
  if (name === "can_block") {
    return {
      kind: "environment",
      reason:
        "Every scan in this matrix completes against a clean checkout, so the manifest reports the " +
        "same state throughout. A failed or dirty scan is a different harness."
    };
  }
  if (/test_intelligence\[\]\.(snapshot_usage|stale_test_candidate|covered_symbols|mocked_dependencies|fixture_usage)$/.test(path)) {
    return {
      kind: "unimplemented_placeholder",
      reason:
        "Hardcoded in query/src/test-intelligence.ts and never computed - nothing inspects a test " +
        "for snapshots or staleness, so these are declared shape rather than measurement. Recorded " +
        "as a placeholder rather than as an invariant, because `false` here reads to an agent as " +
        "`checked, and no` when it means `never looked`. This is the EW-3 shape and the honest fix " +
        "is to compute them or drop them, not to baseline them as properties."
    };
  }
  if (/test_intelligence\[\]\.missing_test_candidate$/.test(path)) {
    return {
      kind: "product_invariant",
      reason:
        "False by construction: an entry exists in this array only because a test was FOUND for the " +
        "subject, so a per-entry `missing` flag can never be true. The real signal is the sibling " +
        "`missing_test_candidate` on the selection itself, which does vary."
    };
  }
  if (/required_capabilities\[\]$/.test(path)) {
    return {
      kind: "payload_identity",
      reason:
        "The capability list a surface requires is a property of that surface, not of the repo it " +
        "is reporting on. Pinned so a silently narrowed requirement shows up."
    };
  }
  if (/latest_scan\.(status|dirty)$/.test(path)) {
    return {
      kind: "environment",
      reason:
        "Every scan in this matrix completes against a clean checkout, so the manifest reports the " +
        "same state throughout. A failed or dirty scan is a different harness."
    };
  }
  if (/(required_checks|risky_areas)\[\]\.reason$/.test(path)) {
    return {
      kind: "payload_identity",
      reason:
        "The default contract's own wording. Every fixture materializes the same default checks and " +
        "risky areas, so the sentence explaining each is the same sentence. Pinned so a reworded " +
        "rationale is visible rather than silent."
    };
  }
  if (/selected_contracts_reason$/.test(path)) {
    return {
      kind: "matrix_gap",
      reason:
        "`no_contracts_accepted` in every cell because no fixture carries an AGENT contract - a " +
        "different object from the repo contract the accept step materializes. Closing it needs a " +
        "fixture with one; until then this field's other values are unexercised here."
    };
  }
  if (/(proof_freshness|proof_status)$/.test(name)) {
    return {
      kind: "matrix_gap",
      reason:
        "Security boundary proofs are produced by `check`, which this matrix does not run, so route " +
        "trust reports `none`/`unknown` throughout. These are exactly the D-A2 fields the CLI used " +
        "to omit, so the hole is worth naming: they are present and correct, and only one of their " +
        "values is exercised."
    };
  }
  // ---- EMPTY LISTS ----
  //
  // Everything below is an array that was `[]` in every cell. None of it could be classified
  // before, because none of it was visible before: an array had no leaf unless it had elements, so
  // the gate evaluated every always-empty list exactly zero times. The first run that could see
  // them found 143, of which 12 are the `test_intelligence` placeholders this class was opened for
  // and the rest are lists the matrix never fills.
  //
  // Grouped rather than enumerated. 131 copies of "constant, and not yet explained" is the
  // several-hundred-entry unreadable baseline the SCOPE note at the top of this file refuses, and
  // it would bury the 12 that are a defect. Guarded on `Array.isArray` so none of these can shadow
  // a scalar rule above.
  if (Array.isArray(value)) {
    if (
      /(active_exceptions|active_waivers|import_boundaries|placement_guidance|required_flows|selected_contracts|selected_helpers|safe_commands)$/.test(path) ||
      /(selected_conventions|conventions|accepted_conventions)\[\]\.(exceptions|counterexample_ref_ids)$/.test(path) ||
      /agent_contract_packet\.required_checks$/.test(path)
    ) {
      return {
        kind: "matrix_gap",
        reason:
          "The default materialized contract declares none of these. Every fixture accepts the same " +
          "generated contract, so its optional lists - waivers, exceptions, import boundaries, " +
          "placement guidance, safe commands - are empty throughout. Closing it needs a fixture " +
          "carrying a hand-written contract, not a bigger repo."
      };
    }
    if (/(missing_capabilities|partial_capabilities|unsupported_capabilities|unsupported_pattern_ids|security_capabilities)$/.test(path)) {
      return {
        kind: "matrix_gap",
        reason:
          "The engine supports every capability these fixtures exercise, so the shortfall lists stay " +
          "empty. NOT a claim that coverage is total: it is the same absence `semantic_coverage` " +
          "exists to report, observed on a matrix small enough never to produce one."
      };
    }
    if (/change_impact\.(affected_tests|changed_symbols|changed_tests)$/.test(path)) {
      return {
        kind: "matrix_gap",
        reason:
          "Change impact is computed against `relevant_files`, which this matrix derives from a task " +
          "string rather than from a diff, so no cell presents a CHANGED symbol or test. Closing it " +
          "needs a fixture scanned twice with an edit in between."
      };
    }
    if (/(audit_integrity\.reasons|invalidation_reasons)$/.test(path)) {
      return {
        kind: "matrix_gap",
        reason:
          "Reason lists that fill only on failure. The audit chain verifies and the scan is never " +
          "invalidated in this matrix, so both stay empty - the list form of the same hole recorded " +
          "for `audit_integrity.valid`. Corrupting a hash-linked log on purpose is the storage " +
          "suite's job, not this one's."
      };
    }
    if (/changes\.(deleted|modified)$/.test(path)) {
      return {
        kind: "matrix_gap",
        reason:
          "Every cell scans a fresh copy of a fixture, so the first scan reports additions only and " +
          "the deleted/modified deltas are structurally empty. A second scan over an edited tree " +
          "would move them; this matrix edits only to make a scan STALE, then never rescans."
      };
    }
    if (/(sample_gaps\[\]\.(affected_capabilities|affected_contract_kinds)|parser_gaps\.records(\[\]\.evidence_refs)?)$/.test(path)) {
      return {
        kind: "matrix_gap",
        reason:
          "The engine reports THAT a construct defeated the parser, not which capability or contract " +
          "kind the gap costs, and attaches no evidence refs to a gap record. These are declared " +
          "attribution the engine does not currently supply - adjacent to the placeholder class " +
          "below, and recorded as a hole so that stays visible rather than reading as `nothing " +
          "affected`."
      };
    }
    if (/(diagnostics|risk_reasons|dynamic_params|unresolved_imports|parser_gap_codes)$/.test(path)) {
      return {
        kind: "matrix_gap",
        reason:
          "Per-node trouble lists. These fixtures parse cleanly and resolve their imports, so the " +
          "route flows and reachable data access carry no diagnostics - even in the parser-gap " +
          "fixture, where the gap is recorded on the scan rather than on a graph node. An unparseable " +
          "route is what fills them."
      };
    }
    if (/(findings|waivers|baseline\.by_convention|open_finding_ids|finding_ids)$/.test(path)) {
      return {
        kind: "matrix_gap",
        reason:
          "Nothing in this matrix records a finding. Conventions are accepted, but no cell runs " +
          "`check`, which is what materializes violations, waivers and the per-convention baseline. " +
          "Closing it needs the check step in the matrix, not a different fixture."
      };
    }
    if (/(topology\.(configs|external_systems|generated_zones)|topology\.areas\[\]\.external_systems)$/.test(path)) {
      return {
        kind: "matrix_gap",
        reason:
          "Repo topology beyond the source tree. These fixtures are hand-built directories with no " +
          "config files, no generated zones and no external systems to detect, so the lists naming " +
          "them are empty by fixture size rather than by any property of the detector."
      };
    }
    if (/role_layer_proof$/.test(path)) {
      return {
        kind: "matrix_gap",
        reason:
          "The role/layer proof is emitted only for files whose role the ontology resolves with " +
          "enough confidence to defend; no fixture in this matrix produces one. Present and correct, " +
          "and entirely unexercised here."
      };
    }
    return {
      kind: "matrix_gap",
      reason:
        "An empty list in every cell, and not yet explained. Either the matrix lacks the state that " +
        "fills it, or nothing computes it and this gate has found the list-typed form of the " +
        "hardcoded-literal defect."
    };
  }
  if (path.includes("truncated")) {
    return {
      kind: "matrix_gap",
      reason:
        "NOT a guarantee - the matrix never truncates. Truncation needs a guidance view over the " +
        "32,768-byte budget, which takes roughly 60 realistically-sized conventions; the largest " +
        "fixture here produces three. This is the exact field D-M5 found hardcoded to false, so it " +
        "is recorded as a known hole rather than as a property. Closing it needs a fixture built " +
        "for the budget, not a bigger repo."
    };
  }
  return {
    kind: "matrix_gap",
    reason:
      `Constant at ${JSON.stringify(value)} across the matrix, and not yet explained. Either the ` +
      "matrix lacks the state that moves it, or the field is frozen and this gate has found one."
  };
}

/** Every command the CLI dispatches, from the router and run-cli's pre-router branches. */
export function routedCommandPrefixes(routerSource, runCliSource) {
  const prefixes = new Set();
  for (const [, group, command, maybeId] of routerSource.matchAll(
    /group === "([a-z-]+)"\s*&&\s*command === "([a-z-]+)"(?:[^\n]*?maybeId === "([a-z-]+)")?/g
  )) {
    prefixes.add(maybeId ? `${group} ${command} ${maybeId}` : `${group} ${command}`);
  }
  for (const [, group] of routerSource.matchAll(/group === "([a-z-]+)"/g)) prefixes.add(group);
  for (const [, group] of runCliSource.matchAll(/parsed\.positional\[0\] === "([a-z-]+)"/g)) {
    prefixes.add(group);
  }
  return prefixes;
}


/**
 * Pointer fields in a payload, as { path, command, promises }.
 *
 * `promises` is the object key the pointer sits inside - `guidance.parser_gaps.full_list_command`
 * promises `parser_gaps` - which is what makes following it a real check rather than a spell check.
 * D-A5 is the reason: `drift doctor --repo <id> --json` is a ROUTED command that EXITS 0 and
 * simply has no `parser_gaps` key, so both "does this command exist" and "does it succeed" pass
 * it. Only asking for the data the field's own name promised finds it.
 */
export function pointerFields(payload) {
  const found = [];
  const walk = (value, path, parentKey) => {
    if (value === null || typeof value !== "object") {
      const leaf = path.split(".").at(-1) ?? "";
      if (typeof value === "string" && /^drift\s+[a-z]/.test(value) && /_commands?$/.test(leaf)) {
        // Two kinds, and conflating them produces false positives. A DATA pointer says "the rest
        // of this list lives over there" and must actually serve it. A REMEDIATION pointer
        // (`next_command`) says "here is what to run next" - `drift scan --repo-root ...` does not
        // owe anyone a `scan_status` key, and executing it would re-scan the repo as a side effect.
        const isData = /(list|records)_commands?$/.test(leaf);
        found.push({ path, command: value, promises: isData ? parentKey : null, kind: isData ? "data" : "remediation" });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, `${path}[]`, parentKey);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      walk(entry, path ? `${path}.${key}` : key, key === "" ? parentKey : path.split(".").at(-1) ?? null);
    }
  };
  walk(payload, "", null);
  return found;
}

/** Does `drift x y --flag` name something the CLI routes? */
export function pointerIsRoutable(command, prefixes) {
  const words = command
    .replace(/^drift\s+/, "")
    .split(/\s+/)
    .filter((word) => word && !word.startsWith("-") && !word.startsWith("<") && !word.startsWith('"'));
  // Longest-first: `contract waiver show` must not be satisfied by `contract` alone when the
  // router only branches on the three-word form.
  for (let length = Math.min(3, words.length); length >= 1; length--) {
    if (prefixes.has(words.slice(0, length).join(" "))) return true;
  }
  return false;
}

async function collectPayloads() {
  const { runCli } = await import(join(REPO_ROOT, "packages/cli/dist/index.js"));
  const { handleMcpJsonRpcRequest } = await import(join(REPO_ROOT, "packages/mcp/dist/index.js"));

  const engine = ["target/release/drift-engine", "target/debug/drift-engine"]
    .map((candidate) => join(REPO_ROOT, candidate))
    .find((candidate) => existsSync(candidate));
  if (!engine) {
    console.error("Missing drift-engine. Run: cargo build --release -p drift-engine");
    process.exit(1);
  }
  process.env.DRIFT_ENGINE_BIN = engine;

  const cells = [];
  const dirs = [];
  const pointerChecks = [];
  const followed = new Set();
  for (const entry of FIXTURES) {
    const fixture = entry.as ?? entry.name;
    const dir = await mkdtemp(join(tmpdir(), "drift-payload-invariants-"));
    dirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await cp(join(REPO_ROOT, "test/fixtures", entry.name), repoRoot, { recursive: true });
    if (entry.seed) await entry.seed(repoRoot);

    const scan = await runCli(["scan", "--repo-root", repoRoot, "--state-root", stateRoot, "--json"]);
    if (scan.exitCode !== 0) {
      console.error(`fixture ${fixture}: scan failed (${scan.exitCode}) ${scan.stderr.slice(0, 200)}`);
      process.exit(1);
    }
    const scanned = JSON.parse(scan.stdout);
    const repoId = scanned.repo.id;
    const databasePath = scanned.database_path;
    const cli = (args, extra = []) =>
      runCli([...args, "--repo", repoId, "--db", databasePath, "--json", ...extra]);

    const mcp = (name, args) => {
      const response = handleMcpJsonRpcRequest(
        { databasePath },
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: { repo_id: repoId, ...args } }
        }
      );
      const text = response?.result?.content?.[0]?.text;
      try {
        return text ? JSON.parse(text) : response?.error?.data ?? null;
      } catch {
        return null;
      }
    };

    const parseOr = (result) => {
      try {
        return JSON.parse(result.stdout);
      } catch {
        return null;
      }
    };

    const record = (state, surface, name, raw) => {
      if (raw) cells.push({ cell: `${fixture}/${state}/${surface}:${name}`, payload: raw });
      // Follow every pointer this payload hands an agent, once per distinct command.
      for (const pointer of raw ? pointerFields(raw) : []) {
        if (followed.has(pointer.command)) continue;
        followed.add(pointer.command);
        pointerChecks.push({ ...pointer, cell: `${fixture}/${state}/${surface}:${name}`, databasePath });
      }
    };

    const captureAll = async (state) => {
      record(state, "cli", "prepare", parseOr(await cli(["prepare", "add an endpoint that lists items"])));
      record(state, "cli", "repo_map", parseOr(await cli(["repo", "map"])));
      record(state, "cli", "scan_status", parseOr(await cli(["scan", "status"])));
      record(state, "mcp", "preflight", mcp("get_task_preflight", { task: "add an endpoint that lists items" }));
      record(state, "mcp", "repo_map", mcp("get_repo_map", {}));
      record(state, "mcp", "scan_status", mcp("get_scan_status", {}));
    };

    // STATE DIMENSIONS. The fixtures differ in CONTENT; without these every cell would share one
    // state, and a field that responds to staleness or to an accepted contract would read as
    // frozen because nothing in the matrix ever moved it. That is the failure mode a variance
    // gate has: it measures the matrix at least as much as the code.
    await captureAll("fresh");

    // 1. An accepted contract, so `contract`, the convention list and everything keyed on
    //    "does this repo enforce anything" has both states in the matrix.
    const candidates = parseOr(await cli(["conventions", "list", "--status", "candidate"]));
    for (const [index, candidate] of (candidates?.candidates ?? []).slice(0, 3).entries()) {
      // The first in BLOCK mode, deliberately. Every inferred candidate suggests `warn`, so
      // accepting them all as suggested left `enforcement_mode` and `will_this_block` reading one
      // value across the matrix - the two fields an agent uses to decide whether a violation stops
      // a merge. A matrix that only ever warns cannot show that they move.
      const blocking = index === 0 && candidate.enforcement_capability === "deterministic_check";
      await cli([
        "conventions", "accept", candidate.id,
        "--confirm",
        "--severity", blocking ? "error" : candidate.suggested_severity ?? "warning",
        "--mode", blocking ? "block" : candidate.suggested_enforcement_mode ?? "warn"
      ]);
    }
    await captureAll("accepted");

    // 2. `--require-fresh` on a current scan: the demand is recorded even when it is satisfied.
    record(
      "require_fresh",
      "cli",
      "prepare",
      parseOr(await cli(["prepare", "add an endpoint that lists items"], ["--require-fresh"]))
    );
    record("require_fresh", "mcp", "preflight", mcp("get_task_preflight", {
      task: "add an endpoint that lists items",
      require_fresh: true
    }));

    // 3. A stale scan. Editing a source file after the scan is what staleness IS, and it moves
    //    `scan_status.stale`, the readiness decision and the freshness requirement together.
    await writeFile(join(repoRoot, "drift-invariants-probe.ts"), "export const probe = 1;\n");
    await captureAll("stale");
    // 4. ... and demanding freshness against it, which is a refusal rather than an answer.
    record(
      "stale_require_fresh",
      "cli",
      "refusal",
      parseOr(await cli(["prepare", "add an endpoint that lists items"], ["--require-fresh"]))
    );

    // 5. An operational error rather than a refusal, so `error.type` has both of its values.
    record(
      "unknown_repo",
      "cli",
      "refusal",
      parseOr(await runCli(["prepare", "x", "--repo", "repo_missing", "--db", databasePath, "--json"]))
    );
  }

  // Run each distinct pointer BEFORE the temp state is removed - a pointer is only checkable
  // against the repo it was minted for.
  const pointerResults = [];
  for (const pointer of pointerChecks) {
    // Only data pointers are RUN. A remediation pointer is checked for routability alone -
    // executing `drift scan --repo-root ...` would rescan the repo, which is a side effect a gate
    // has no business causing.
    if (pointer.kind !== "data") {
      pointerResults.push({ ...pointer, exitCode: 0, served: null, stderr: "" });
      continue;
    }
    const argv = pointer.command
      .replace(/^drift\s+/, "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => !word.startsWith("<"));
    const run = await runCli([...argv, "--db", pointer.databasePath]);
    let served = null;
    if (pointer.promises) {
      try {
        served = pointer.promises in JSON.parse(run.stdout);
      } catch {
        served = false;
      }
    }
    pointerResults.push({ ...pointer, exitCode: run.exitCode, served, stderr: run.stderr.slice(0, 200) });
  }

  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  return { cells, pointerResults };
}

function main({ cells, pointerResults }) {
  const update = process.argv.includes("--update");
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const known = new Map((baseline.constants ?? []).map((entry) => [entry.path, entry]));
  const failures = [];

  // Group by payload NAME rather than by fixture, so `prepare.readiness.decision` is compared
  // across fixtures and never against `repo_map`'s.
  const byPayload = new Map();
  for (const { cell, payload } of cells) {
    const name = cell.split(":")[1];
    const leaves = leafFields(payload);
    for (const [path, values] of leaves) {
      const key = `${name}.${path}`;
      const bucket = byPayload.get(key) ?? [];
      bucket.push(...values);
      byPayload.set(key, bucket);
    }
  }

  if (cells.length === 0 || byPayload.size === 0) {
    console.error(
      `payload invariants: collected ${cells.length} payload(s) and ${byPayload.size} field(s). ` +
        `A matrix that produced nothing cannot show that anything varies.`
    );
    process.exit(1);
  }

  const prefixes = routedCommandPrefixes(
    readFileSync(ROUTER_SOURCE, "utf8"),
    readFileSync(RUN_CLI_SOURCE, "utf8")
  );
  if (prefixes.size < 8) {
    console.error(
      `payload invariants: parsed only ${prefixes.size} routed command(s) - the router source no ` +
        `longer matches, so check B would pass every pointer vacuously.`
    );
    process.exit(1);
  }

  // Check B. Three parts, because the first two both pass D-A5.
  const brokenPointers = [];
  for (const pointer of pointerResults) {
    if (!pointerIsRoutable(pointer.command, prefixes)) {
      brokenPointers.push(
        `${pointer.path} -> \`${pointer.command}\` names no routed command.`
      );
      continue;
    }
    if (pointer.exitCode !== 0) {
      brokenPointers.push(
        `${pointer.path} -> \`${pointer.command}\` exits ${pointer.exitCode}. ${pointer.stderr}`
      );
      continue;
    }
    if (pointer.served === false) {
      brokenPointers.push(
        `${pointer.path} -> \`${pointer.command}\` succeeds but returns no \`${pointer.promises}\` key.\n` +
          `    This is D-A5 exactly: the pointer named \`drift doctor --repo <id> --json\`, which is a ` +
          `real command that exits 0 and simply does not serve parser gaps. Existence and exit code ` +
          `both pass it; only asking for the data the field promised finds it.`
      );
    }
  }
  for (const broken of brokenPointers) {
    failures.push(`POINTER ${broken}`);
  }

  // Check A.
  const populated = populatedArrayPaths(byPayload.keys());
  const evaluated = [];
  const constants = [];
  for (const [path, values] of byPayload) {
    if (values.length < 2) continue;
    if (!isTrustDiscriminator(path, values[0])) continue;
    // Empty in every cell, or merely empty in this one? See populatedArrayPaths.
    if (Array.isArray(values[0]) && populated.has(path)) continue;
    evaluated.push(path);
    const distinct = new Set(values.map((value) => JSON.stringify(value)));
    if (distinct.size === 1) {
      constants.push({ path, value: values[0] });
    }
  }

  if (evaluated.length === 0) {
    console.error(
      "payload invariants: zero trust discriminators evaluated. The payload shape has changed " +
        "out from under this gate, which would otherwise report success forever."
    );
    process.exit(1);
  }

  if (process.argv.includes("--report")) {
    // Distinguishing "this field varies" from "this field is never looked at" is the whole
    // difference between a gate and a decoration.
    for (const path of evaluated.sort()) {
      const distinct = new Set((byPayload.get(path) ?? []).map((value) => JSON.stringify(value)));
      console.log(`${distinct.size === 1 ? "CONST" : `varies(${distinct.size})`}\t${path}`);
    }
    process.exit(0);
  }

  if (update) {
    writeFileSync(
      BASELINE,
      `${JSON.stringify(
        {
          constants: constants.map((entry) => ({
            ...entry,
            ...(known.get(entry.path)
              ? { kind: known.get(entry.path).kind, reason: known.get(entry.path).reason }
              : classifyConstant(entry.path, entry.value))
          }))
        },
        null,
        2
      )}\n`
    );
    console.log(`payload invariants baseline updated - ${constants.length} declared constant(s)`);
    process.exit(0);
  }

  const seen = new Set(constants.map((entry) => entry.path));
  for (const entry of constants) {
    if (!known.has(entry.path)) {
      failures.push(
        `NEW constant trust field: ${entry.path} = ${JSON.stringify(entry.value)}\n` +
          `    Identical across all ${cells.length} matrix cells. A calibration field that cannot ` +
          `move tells an agent nothing. Make it vary, or declare it in ` +
          `scripts/payload-invariants-baseline.json with a reason.`
      );
    }
  }
  for (const [path, entry] of known) {
    if (!seen.has(path)) {
      failures.push(
        `STALE baseline entry: ${path} now varies (or is gone). Remove it from ` +
          `scripts/payload-invariants-baseline.json - a field recorded as frozen that is not is a ` +
          `false record, and it is how a baseline stops describing anything.\n` +
          `    Recorded reason: ${entry.reason}`
      );
    }
  }

  if (failures.length > 0) {
    console.error("payload invariants FAILED:\n");
    for (const failure of failures) console.error(`  ${failure}\n`);
    process.exit(1);
  }

  console.log(
    `payload invariants: ${cells.length} payload(s) across ${FIXTURES.length} fixture(s), ` +
      `${evaluated.length} trust discriminator(s) evaluated, ${constants.length} declared constant, ` +
      `${pointerResults.length} pointer(s) followed.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(await collectPayloads());
}
