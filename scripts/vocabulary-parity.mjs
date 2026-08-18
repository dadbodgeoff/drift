#!/usr/bin/env node
/**
 * One vocabulary per cross-boundary concept, generated, with a producer and a consumer for every
 * member.
 *
 * Ten closed vocabularies cross the TypeScript <-> Rust process boundary and, before W5, every one
 * of them was two hand-written lists and hope. What that cost, measured:
 *
 *   - `SCAN_CAPABILITY_TO_SEMANTIC_CAPABILITY` (semantic-coverage.ts) mapped scan capabilities onto
 *     `ts.*.v1` ids. Four of its seven keys are strings the engine has never emitted, three the
 *     engine emits on every scan were absent, and `ts.route_flow.v1` - required on every preflight -
 *     was in no certified list by construction. `semantic_coverage.decision` was the literal
 *     "refuse" on every repo, against synthetic perfect readiness.
 *   - `fact_kind_from_str` (check_command.rs) named 30 of 36 fact kinds and dropped the rest through
 *     a `_ => None` arm into a `filter_map`.
 *   - `get_repo_map`'s `role` enum: 17 of 21. `get_conventions`' `kind` enum: 9 of 23, and all three
 *     kinds with NO evaluator were in it while 14 with working evaluators were not.
 *   - Graph node and edge kinds were `String` on the engine side, so a kind the CLI did not know
 *     failed as a Zod enum error mid-stream instead of the exit-3 refusal the fact-kind handshake
 *     gives for the same problem.
 *   - Three dead-but-wrong copies (`GraphNodeRecordSchema`, `AdapterCapabilityIdSchema`) named two
 *     graph node kinds that do not exist, `import` and `role`, and those two names then turn up in
 *     `BUILTIN_SEMANTIC_CAPABILITIES` and in the engine's own test fixtures. A dead declaration is
 *     read and copied precisely because nothing exercises it.
 *
 * WHAT THIS GATE CHECKS
 *
 *   1. The generated files match vocabulary/vocabulary.json. Editing one side of a mirror is what
 *      this whole change exists to make impossible, and a stale generated file restores it.
 *   2. No hand-written list anywhere is a proper subset of a vocabulary. This is the D-M4 / D-M4b /
 *      GraphNodeRecordSchema shape: a closed enum written from memory, always short, always stale.
 *      A legitimate subset is baselined WITH ITS REASON.
 *   3. The convention dispatch table matches the two evaluators' source. `engine_direct` and
 *      `engine_phase6` kinds must appear in check_command.rs, `cli` kinds in run-check.ts, and
 *      `none` kinds in neither - which is what makes "accepted and enforcing nothing" detectable.
 *   4. Every id in `BUILTIN_SEMANTIC_CAPABILITIES` is a real capability, and every fact, node, edge
 *      and parser-gap kind those contracts name is a real member of its vocabulary.
 *   5. Every member has a producer and a consumer, or is baselined as reserved with a reason.
 *
 * RATCHET, both directions, matching scripts/storage-invariants.mjs: a new offender fails, and so
 * does a baseline entry whose gap has been fixed, so the baseline cannot keep claiming something
 * that is no longer true.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizedMembers, readManifest, renderRust, renderTypeScript, RUST_OUTPUT_PATH, TS_OUTPUT_PATH } from "../vocabulary/generate.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = join(repoRoot, "scripts/vocabulary-parity-baseline.json");
const CHECK_COMMAND = join(repoRoot, "crates/drift-engine/src/check_command.rs");
const RUN_CHECK = join(repoRoot, "packages/cli/src/check/run-check.ts");
const SEMANTIC_CAPABILITIES = join(repoRoot, "packages/core/src/semantic-capabilities.ts");
const FACTS_SOURCE = join(repoRoot, "crates/drift-engine/src/facts.rs");
const SECURITY_FACTS_SOURCE = join(repoRoot, "crates/drift-engine/src/security_facts.rs");
const PRISMA_SOURCE = join(repoRoot, "crates/drift-engine/src/prisma.rs");
const MAIN_SOURCE = join(repoRoot, "crates/drift-engine/src/main.rs");
const FACTGRAPH_SOURCE = join(repoRoot, "packages/factgraph/src/index.ts");
const SECURITY_PROOF_SOURCE = join(repoRoot, "crates/drift-engine/src/security_proof.rs");

/**
 * The comment that opens the arm in `check_repo`'s match which skips kinds the engine does not own.
 *
 * The match is exhaustive by design, so every `none` kind is named inside it. Searching for the
 * variant without excluding this arm would report every unimplemented kind as implemented.
 */
const SKIP_ARM_MARKER = "// Evaluated elsewhere, or by nobody.";

/** Directories whose sources declare or use vocabulary members. */
const SOURCE_ROOTS = [join(repoRoot, "packages"), join(repoRoot, "crates")];
const SKIP_DIRS = new Set(["node_modules", "dist", "target", ".git", "fixtures"]);

/** The generated files are the source of truth; scanning them for copies of themselves is circular. */
const GENERATED = new Set([RUST_OUTPUT_PATH, TS_OUTPUT_PATH]);

function* sourceFiles() {
  for (const root of SOURCE_ROOTS) {
    yield* walk(root);
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (/\.(ts|mjs|rs)$/.test(entry.name) && !GENERATED.has(path)) {
      yield path;
    }
  }
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** 1. The committed generated files must be what the manifest renders. */
function checkGeneratedFilesAreCurrent(manifest, failures) {
  for (const [path, content] of [
    [RUST_OUTPUT_PATH, renderRust(manifest)],
    [TS_OUTPUT_PATH, renderTypeScript(manifest)]
  ]) {
    let committed;
    try {
      committed = readFileSync(path, "utf8");
    } catch {
      committed = null;
    }
    if (committed !== content) {
      failures.push(
        `STALE GENERATED FILE: ${relative(repoRoot, path)} does not match vocabulary/vocabulary.json. ` +
          "Run `node vocabulary/generate.mjs`. A generated file edited by hand, or a manifest edited " +
          "without regenerating, is the two-hand-written-lists problem with an extra step."
      );
    }
  }
}

/**
 * 2. Hand-written enum literals that are proper subsets of a vocabulary.
 *
 * Matches TypeScript `z.enum([...])`, JSON-schema `enum: [...]` and Rust `matches!(x, "a" | "b")`.
 * Three or more members, because a two-member list is as likely to be an unrelated pair as a stale
 * copy, and a gate that cries wolf gets muted.
 */
function subsetOffenders(vocabularies) {
  const offenders = [];
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    const patterns = file.endsWith(".rs")
      ? [/matches!\(\s*[a-z_.&]+,([^)]*)\)/g]
      : [/(?:z\.enum\(\[|enum:\s*\[)([^\]]*)\]/g];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const members = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
        if (members.length < 3) {
          continue;
        }
        for (const [name, set] of vocabularies) {
          if (members.every((member) => set.has(member)) && members.length !== set.size) {
            offenders.push({
              key: `${relative(repoRoot, file)}:${name}`,
              file: relative(repoRoot, file),
              line: lineOf(source, match.index),
              vocabulary: name,
              declared: members.length,
              total: set.size,
              missing: [...set].filter((member) => !members.includes(member))
            });
          }
        }
      }
    }
  }
  return offenders;
}

/**
 * 3. The dispatch table against the two evaluators.
 *
 * The engine's match is exhaustive over the enum, so a `none` kind is NAMED there - in the arm that
 * skips it. That arm is excluded before searching, or every `none` kind would look like it had an
 * evaluator and the check would assert the opposite of what it means to.
 */
function dispatchOffenders(manifest) {
  const members = normalizedMembers(manifest.vocabularies.convention_kind);
  const rawEngineSource = readFileSync(CHECK_COMMAND, "utf8");
  const skipArmStart = rawEngineSource.indexOf(SKIP_ARM_MARKER);
  if (skipArmStart === -1) {
    return [
      {
        key: "dispatch:skip-arm",
        detail:
          `check_command.rs no longer contains the marker comment "${SKIP_ARM_MARKER}", so this gate ` +
          "cannot tell an evaluator arm from the arm that skips kinds it does not own. Restore the " +
          "comment or update the marker - failing here is deliberate, because silently searching the " +
          "whole file would make every `none` kind look implemented."
      }
    ];
  }
  const skipArmEnd = rawEngineSource.indexOf("=> continue,", skipArmStart);
  const engineSource =
    rawEngineSource.slice(0, skipArmStart) + rawEngineSource.slice(skipArmEnd);
  const cliSource = readFileSync(RUN_CHECK, "utf8");
  const offenders = [];

  for (const member of members) {
    const variant = member.wire
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    // The engine dispatches on the enum; the CLI still compares wire strings, because its evaluator
    // is TypeScript and the union is structural there.
    const inEngine = new RegExp(`ConventionKind::${variant}\\b`).test(engineSource);
    const inCli = cliSource.includes(`"${member.wire}"`);

    const expectedEngine = member.dispatch === "engine_direct" || member.dispatch === "engine_phase6";
    const expectedCli = member.dispatch === "cli";

    if (expectedEngine && !inEngine) {
      offenders.push({
        key: `dispatch:${member.wire}`,
        detail: `${member.wire}: dispatch is "${member.dispatch}" but ConventionKind::${variant} appears nowhere in check_command.rs`
      });
    }
    if (expectedCli && !inCli) {
      offenders.push({
        key: `dispatch:${member.wire}`,
        detail: `${member.wire}: dispatch is "cli" but it appears nowhere in run-check.ts`
      });
    }
    if (member.dispatch === "none" && (inEngine || inCli)) {
      offenders.push({
        key: `dispatch:${member.wire}`,
        detail:
          `${member.wire}: dispatch is "none" - meaning accepting it enforces nothing - but it appears in ` +
          `${inEngine ? "check_command.rs" : ""}${inEngine && inCli ? " and " : ""}${inCli ? "run-check.ts" : ""}. ` +
          "Either it has an evaluator and the manifest is stale, or the reference is dead."
      });
    }
  }
  return offenders;
}

/** 4. Semantic capability contracts must name real vocabulary members. */
function semanticCapabilityOffenders(vocabularies) {
  const source = readFileSync(SEMANTIC_CAPABILITIES, "utf8");
  const offenders = [];
  const fields = [
    ["capability_id", "scan_capability", /capability_id:\s*"([^"]+)"/g],
    ["emitted_fact_kinds", "fact_kind", /emitted_fact_kinds:\s*\[([^\]]*)\]/g],
    ["emitted_node_kinds", "graph_node_kind", /emitted_node_kinds:\s*\[([^\]]*)\]/g],
    ["emitted_edge_kinds", "graph_edge_kind", /emitted_edge_kinds:\s*\[([^\]]*)\]/g],
    ["parser_gap_kinds", "parser_gap_kind", /parser_gap_kinds:\s*\[([^\]]*)\]/g]
  ];

  for (const [field, vocabulary, pattern] of fields) {
    const known = vocabularies.get(vocabulary);
    for (const match of source.matchAll(pattern)) {
      const values = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
      const declared = field === "capability_id" ? [match[1]] : values;
      for (const value of declared) {
        if (!known.has(value)) {
          offenders.push({
            key: `semantic_capability:${field}:${value}`,
            detail:
              `packages/core/src/semantic-capabilities.ts:${lineOf(source, match.index)} declares ` +
              `${field}: "${value}", which is not a member of the ${vocabulary} vocabulary.`
          });
        }
      }
    }
  }
  return offenders;
}

/**
 * 5. Producer and consumer coverage.
 *
 * A vocabulary member that nothing emits is a claim the system cannot keep, and one that nothing
 * reads is a claim nobody checks. Both are baselineable, because a reserved member is a legitimate
 * thing to have - but only with the reason written down, which is what stops the list growing by
 * accretion the way `EMITTABLE_FACT_KINDS` did.
 *
 * PRODUCERS are detected precisely for the three vocabularies where the question is decidable from
 * source: a fact kind is produced by a `kind: FactKind::X` field in a `Fact` literal, a graph node
 * kind by `insert_node(.., GraphNodeKind::X, ..)` or factgraph's `addNode({ kind: "x" })`, an edge
 * kind by `insert_edge(.., GraphEdgeKind::X, ..)` or `edge("X", ..)`. These are the vocabularies
 * D-G5 and D-F2 are about, and they are the ones with a single well-defined construction site.
 *
 * For the rest - capabilities, convention kinds, file roles, route flavours, parser gap kinds -
 * production is spread across schema defaults, contract files and CLI flags with no single
 * constructor, so the gate asks the weaker question it can answer honestly: is this member
 * referenced anywhere at all? Claiming a precise producer analysis for those would be the same kind
 * of overstatement this gate exists to catch. That check under-reports and never over-reports: it
 * fires only when the string occurs nowhere in either language.
 *
 * There is deliberately no automatic CONSUMER check. Vocabulary members are short common words -
 * `package`, `artifact`, `finding`, `test`, `config` - and every one of those three graph node kinds
 * occurs in this repo inside an unrelated enum (`specifier_kind: "package"`, `surface: "artifact"`,
 * `target_type: "finding"`). A text search would have called all three consumed, which is the false
 * positive that makes a gate get muted. Consumers are recorded by hand in the baseline reason for
 * each reserved member, where a human has looked.
 */
const PRODUCER_PATTERNS = {
  // `kind: FactKind::X` is the extractor form; `=> FactKind::X` is the mapping form main.rs uses to
  // turn a Prisma fact into an engine fact. Both construct a fact of that kind; neither of the two
  // patterns alone covers the producers that exist.
  fact_kind: (variant) => [
    { file: FACTS_SOURCE, pattern: new RegExp(`(?:kind:\\s*|=>\\s*)FactKind::${variant}\\b`) },
    { file: SECURITY_FACTS_SOURCE, pattern: new RegExp(`(?:kind:\\s*|=>\\s*)FactKind::${variant}\\b`) },
    { file: PRISMA_SOURCE, pattern: new RegExp(`(?:kind:\\s*|=>\\s*)FactKind::${variant}\\b`) },
    { file: MAIN_SOURCE, pattern: new RegExp(`(?:kind:\\s*|=>\\s*)FactKind::${variant}\\b`) }
  ],
  graph_node_kind: (variant, member) => [
    { file: MAIN_SOURCE, pattern: new RegExp(`GraphNodeKind::${variant}\\b`) },
    { file: FACTGRAPH_SOURCE, pattern: new RegExp(`kind:\\s*"${member}"`) }
  ],
  graph_edge_kind: (variant, member) => [
    { file: MAIN_SOURCE, pattern: new RegExp(`GraphEdgeKind::${variant}\\b`) },
    { file: FACTGRAPH_SOURCE, pattern: new RegExp(`edge\\(\\s*"${member}"`) }
  ],
  // The proof-level session trust reason has exactly one construction site:
  // `build_session_trust_proof_from_facts` in security_proof.rs. That makes the producer
  // question decidable here in the strong sense, unlike the vocabularies that fall through
  // to the reference check - so this one is asked precisely, and two of its four members
  // answer "nobody", which is the honest answer and is baselined as such.
  //
  // Deliberately NOT a repo-wide search for the variant. `phase4_missing_code` matches on
  // every member exhaustively, so a whole-repo search would report all four as produced and
  // the gate would assert the opposite of what it means to - the same shape as the skip-arm
  // problem in rule 3.
  session_trust_reason: (variant) => [
    { file: SECURITY_PROOF_SOURCE, pattern: new RegExp(`SessionTrustReason::${variant}\\b`) }
  ],
  authorization_missing_reason: (variant) => [
    {
      file: SECURITY_PROOF_SOURCE,
      pattern: new RegExp(`AuthorizationMissingProof\\s*\\{\\s*reason:\\s*AuthorizationMissingReason::${variant}\\b`)
    }
  ]
};

/**
 * A Rust source with its `#[cfg(test)]` modules removed.
 *
 * A test that CONSTRUCTS a vocabulary member is not a producer of it. Without this, the producer
 * question answers itself: `security_proof.rs` asserts on `SessionTrustReason::UnknownHelper` in its
 * own test module, so deleting the real emission site left the gate still reporting the member as
 * produced - a gate that cannot fail, which is the artefact this whole file exists to not be. It is
 * the same shape as the skip-arm exclusion in rule 3, and it is excluded for the same reason.
 *
 * Brace-matched rather than "everything after the first #[cfg(test)]", because a test module is only
 * conventionally last, and a gate that silently stops reading the second half of a file when someone
 * moves one is worse than one that never read it.
 */
function withoutTestModules(source) {
  let result = "";
  let index = 0;
  for (;;) {
    const marker = source.indexOf("#[cfg(test)]", index);
    if (marker === -1) {
      return result + source.slice(index);
    }
    const open = source.indexOf("{", marker);
    if (open === -1) {
      return result + source.slice(index);
    }
    let depth = 0;
    let cursor = open;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "{") depth += 1;
      else if (source[cursor] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    result += source.slice(index, marker);
    index = cursor === source.length ? cursor : cursor + 1;
  }
}

function rustVariantOf(member) {
  return member
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function coverageOffenders(vocabularies) {
  const sources = [...sourceFiles()].map((file) => {
    const raw = readFileSync(file, "utf8");
    return { path: file, text: file.endsWith(".rs") ? withoutTestModules(raw) : raw };
  });
  const byPath = new Map(sources.map((entry) => [entry.path, entry.text]));
  const offenders = [];

  for (const [name, set] of vocabularies) {
    for (const member of set) {
      const variant = rustVariantOf(member);
      const producers = PRODUCER_PATTERNS[name];
      if (producers) {
        const produced = producers(variant, member).some((site) => {
          const text = byPath.get(site.file);
          return text !== undefined && site.pattern.test(text);
        });
        if (!produced) {
          offenders.push({ key: `${name}:${member}`, vocabulary: name, member, gap: "no_producer" });
        }
        continue;
      }

      const referenced = sources.some(
        (entry) =>
          entry.text.includes(`"${member}"`) || new RegExp(`::${variant}\\b`).test(entry.text)
      );
      if (!referenced) {
        offenders.push({ key: `${name}:${member}`, vocabulary: name, member, gap: "unreferenced" });
      }
    }
  }
  return offenders;
}

function main() {
  const manifest = readManifest();
  const vocabularies = new Map(
    Object.entries(manifest.vocabularies).map(([name, vocabulary]) => [
      name,
      new Set(normalizedMembers(vocabulary).map((member) => member.wire))
    ])
  );
  const baseline = readBaseline();
  const failures = [];

  checkGeneratedFilesAreCurrent(manifest, failures);

  // --- 2. subsets ---
  const baselinedSubsets = new Map(
    (baseline.declared_subsets ?? []).map((entry) => [`${entry.file}:${entry.vocabulary}`, entry])
  );
  const subsets = subsetOffenders(vocabularies);
  const subsetKeys = new Set(subsets.map((offender) => offender.key));
  for (const offender of subsets) {
    if (!baselinedSubsets.has(offender.key)) {
      failures.push(
        `NEW hand-written vocabulary subset: ${offender.file}:${offender.line} declares ` +
          `${offender.declared} of the ${offender.total} ${offender.vocabulary} members, missing ` +
          `${offender.missing.join(", ")}. Build it from the generated list, or baseline it with the ` +
          "reason the subset is deliberate."
      );
    }
  }
  for (const key of baselinedSubsets.keys()) {
    if (!subsetKeys.has(key)) {
      failures.push(
        `STALE baseline entry: ${key} is no longer a partial copy of that vocabulary. Remove it from ` +
          "scripts/vocabulary-parity-baseline.json - a baseline that still claims a fixed gap is a false record."
      );
    }
  }

  // --- 3. dispatch ---
  for (const offender of dispatchOffenders(manifest)) {
    failures.push(`DISPATCH MISMATCH: ${offender.detail}`);
  }

  // --- 4. semantic capability contracts ---
  for (const offender of semanticCapabilityOffenders(vocabularies)) {
    failures.push(`UNKNOWN VOCABULARY MEMBER: ${offender.detail}`);
  }

  // --- 5. reserved members ---
  const baselinedReserved = new Map(
    (baseline.reserved_members ?? []).map((entry) => [`${entry.vocabulary}:${entry.member}`, entry])
  );
  const unreferenced = coverageOffenders(vocabularies);
  const unreferencedKeys = new Set(unreferenced.map((entry) => entry.key));
  for (const entry of unreferenced) {
    const baselined = baselinedReserved.get(entry.key);
    if (!baselined) {
      failures.push(
        entry.gap === "unreferenced"
          ? `NEW unreferenced vocabulary member: ${entry.vocabulary}.${entry.member} is declared and ` +
              "referenced by nothing at all. Wire it up, remove it, or baseline it as reserved with " +
              "the reason it is being held."
          : `NEW vocabulary member with no producer: ${entry.vocabulary}.${entry.member} is consumed ` +
              "somewhere but nothing emits it. Either the producer is missing, or the member is " +
              "reserved and the baseline must say so."
      );
      continue;
    }
    if (baselined.gap !== entry.gap) {
      failures.push(
        `STALE baseline entry: ${entry.key} is baselined as "${baselined.gap}" but is now ` +
          `"${entry.gap}". The reason recorded for it no longer describes the gap.`
      );
    }
  }
  for (const key of baselinedReserved.keys()) {
    if (!unreferencedKeys.has(key)) {
      failures.push(
        `STALE baseline entry: ${key} is now referenced. Remove it from ` +
          "scripts/vocabulary-parity-baseline.json - a reserved entry that is no longer reserved is a false record."
      );
    }
  }

  const memberCount = [...vocabularies.values()].reduce((total, set) => total + set.size, 0);
  console.log(
    `vocabulary parity: ${vocabularies.size} vocabularies, ${memberCount} members, ` +
      `${subsets.length} declared subset(s), ${unreferenced.length} reserved, ` +
      `${baselinedSubsets.size + baselinedReserved.size} baselined.`
  );
  for (const entry of unreferenced) {
    console.log(
      `  - reserved ${entry.key} (${entry.gap})${baselinedReserved.has(entry.key) ? "" : "  <-- NEW"}`
    );
  }

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

main();
