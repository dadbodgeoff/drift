#!/usr/bin/env node
/**
 * Canary ledger checker (TDD §4.2, phase 0b).
 *
 * The ledger declares one state per (convention kind × enforcement path) cell. This script is the
 * "an undeclared cell fails CI" half: it DERIVES the cell set from the source of truth rather than
 * trusting a hand-maintained list, so adding a dispatch arm, a proposer kind, or a presence family
 * without declaring the resulting cell is a build failure rather than a silent coverage hole.
 *
 * Derivation, all by regex over the files that actually decide:
 *   - kind arms          vocabulary/vocabulary.json                 convention_kind dispatch =
 *                                                                  "engine_direct"
 *   - phase-6 arm        vocabulary/vocabulary.json                 dispatch = "engine_phase6",
 *                        cross-checked against phase6_required_capabilities in
 *                        crates/drift-engine/src/check_command.rs
 *   - presence arm       crates/drift-engine/src/candidate_command.rs FAMILY_SPECS
 *                        cross-checked against packages/core/src/capabilities.ts
 *                        PRESENCE_PROMOTABLE_CONVENTION_KINDS
 *   - proposer kinds     crates/drift-engine/src/candidate_command.rs `kind:`/`candidate_kind:`
 *
 * A regex over Rust is a weaker instrument than a parser, and it is chosen deliberately: it has no
 * build step, so it cannot go stale against a rebuilt binary the way a runtime probe can. Every
 * pattern below is anchored to a form that already exists in the file, and the script fails loudly
 * (non-zero, named reason) rather than silently matching nothing - a derivation that quietly returns
 * an empty set would declare every cell covered, which is the exact failure shape this whole ledger
 * exists to prevent.
 *
 * SCOPE OF ENFORCEMENT - INTEGRATION BRANCH ONLY (§4.2). Enforcing on track branches would break the
 * zero-file-overlap property: Track A's D1 work earns the sensitive-fields transition, but the ledger
 * is Track C's file on a branch forked before C merged. So on any other branch this reports and exits
 * 0. `DRIFT_LEDGER_ENFORCE=1` forces enforcement anywhere; `--report` prints the table and never fails.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
// Overridable so the checker's own failure paths can be tested against a deliberately broken
// ledger. A guard nobody has watched fail is a guard nobody knows works.
const LEDGER_PATH = process.env.DRIFT_LEDGER_PATH
  ? resolve(process.env.DRIFT_LEDGER_PATH)
  : join(ROOT, "test/canary/convention-cell-ledger.json");
const CHECK_COMMAND = join(ROOT, "crates/drift-engine/src/check_command.rs");
const CANDIDATE_COMMAND = join(ROOT, "crates/drift-engine/src/candidate_command.rs");
const CAPABILITIES = join(ROOT, "packages/core/src/capabilities.ts");
const VOCABULARY = join(ROOT, "vocabulary/vocabulary.json");

const VALID_STATES = new Set(["firing", "quarantined", "unimplemented", "needs-review"]);
const reportOnly = process.argv.includes("--report");

function read(path) {
  return readFileSync(path, "utf8");
}

/** Fails rather than returning an empty derivation - see the header. */
function nonEmpty(values, what, path) {
  if (values.length === 0) {
    throw new Error(
      `Derivation for ${what} matched nothing in ${path}. The pattern has gone stale against the ` +
        `source. Fix the pattern; do not let an empty derivation pass, because an empty cell set ` +
        `declares every cell covered.`
    );
  }
  return values;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function matchAll(text, pattern) {
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

function sliceBetween(text, startMarker, endMarker, label) {
  const start = text.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not locate ${label} (${startMarker}).`);
  const end = text.indexOf(endMarker, start);
  if (end === -1) throw new Error(`Could not locate the end of ${label} (${endMarker}).`);
  return text.slice(start, end);
}

/** `api_route_no_direct_data_access` -> `ApiRouteNoDirectDataAccess`. */
function pascalCase(wire) {
  return wire
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function conventionKindMembers() {
  const vocabulary = JSON.parse(read(VOCABULARY));
  const members = vocabulary?.vocabularies?.convention_kind?.members;
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error(
      `${VOCABULARY} has no convention_kind members. The vocabulary moved or its shape changed; ` +
        `re-derive which kinds each evaluator owns by reading the source before trusting this ` +
        `script again.`
    );
  }
  return members;
}

/**
 * `ConventionKind::ApiRouteRequiresAuthHelper` -> `api_route_requires_auth_helper`.
 *
 * W5/W7 replaced the string literals these patterns used to read with the generated enum, so the
 * derivations now go through the same manifest the enum is generated from. A variant with no wire
 * name is a generator/source mismatch and is refused rather than skipped - a silently dropped kind
 * is a silently undeclared cell.
 */
function wireForVariants(variants, where) {
  const byVariant = new Map(conventionKindMembers().map((m) => [pascalCase(m.wire), m.wire]));
  return variants.map((variant) => {
    const wire = byVariant.get(variant);
    if (!wire) {
      throw new Error(
        `${where} names ConventionKind::${variant}, which has no member in ${VOCABULARY}. ` +
          `The generated enum and its manifest disagree.`
      );
    }
    return wire;
  });
}

function deriveDispatch() {
  // W7 (D-P3a) replaced the `else if convention.kind == "..."` chain and the
  // `is_phase6_security_convention` helper this used to read with a single `match` that is
  // exhaustive over the generated `ConventionKind` enum, and moved the listing of which evaluator
  // owns which kind into vocabulary/vocabulary.json. So the derivation follows the listing.
  //
  // That is a stronger source than the regex it replaces, not a weaker one: a kind added without a
  // target no longer compiles, whereas the old chain would have let it fall through to `continue`
  // and report a clean pass for a contract enforcing nothing. The header's rule still holds - this
  // reads a checked-in file with no build step, and fails loudly on an empty derivation.
  const members = conventionKindMembers();
  const withDispatch = (target) =>
    unique(
      nonEmpty(
        members.filter((member) => member.dispatch === target).map((member) => member.wire),
        `convention kinds dispatched to "${target}"`,
        VOCABULARY
      )
    );

  const kindArms = withDispatch("engine_direct");
  const phase6 = withDispatch("engine_phase6");

  // Cross-check against the file that actually decides. The vocabulary says who OWNS each kind; the
  // match in check_command.rs is what routes it, and `phase6_required_capabilities` is the arm the
  // five Phase 6 kinds land in. These disagreeing means the ledger is enumerating cells against a
  // dispatch that no longer exists - the exact staleness this script exists to refuse.
  const src = read(CHECK_COMMAND);
  const phase6Block = sliceBetween(
    src,
    "fn phase6_required_capabilities",
    "\n}\n",
    "phase6_required_capabilities"
  );
  const routed = unique(
    nonEmpty(
      matchAll(phase6Block, /ConventionKind::([A-Za-z0-9]+)\s*=>/g),
      "phase-6 dispatch arms",
      CHECK_COMMAND
    )
  );
  const expected = unique(phase6.map(pascalCase));
  if (JSON.stringify(routed) !== JSON.stringify(expected)) {
    throw new Error(
      `The Phase 6 kinds in ${VOCABULARY} and the arms of phase6_required_capabilities in ` +
        `${CHECK_COMMAND} disagree.\n` +
        `  vocabulary: ${expected.join(", ")}\n` +
        `  check_command: ${routed.join(", ")}`
    );
  }

  return { kindArms, phase6 };
}

function derivePresenceKinds() {
  const src = read(CANDIDATE_COMMAND);

  // Presence is stamped inside emit_family_candidate, which is driven by FAMILY_SPECS - so the
  // presence-capable kinds are exactly the FamilySpec kinds. Verified by reading, not assumed:
  // `matcher["enforcement_semantics"] = json!("presence")` has one site and one caller.
  if (!/matcher\["enforcement_semantics"\]\s*=\s*json!\("presence"\)/.test(src)) {
    throw new Error(
      `The presence stamp is no longer at its known form in ${CANDIDATE_COMMAND}. Re-derive which ` +
        `kinds can be stamped 'presence' by reading the code before trusting this script again.`
    );
  }
  const specs = sliceBetween(src, "const FAMILY_SPECS", "\n];\n", "FAMILY_SPECS");
  const fromRust = unique(
    wireForVariants(
      nonEmpty(
        matchAll(specs, /\bkind:\s*ConventionKind::([A-Za-z0-9]+)/g),
        "FAMILY_SPECS kinds",
        CANDIDATE_COMMAND
      ),
      "FAMILY_SPECS"
    )
  );

  // Cross-check against the TypeScript allowlist. These two lists disagreeing is itself a defect:
  // one of them would be gating on a set the other does not produce.
  const caps = read(CAPABILITIES);
  const promotable = sliceBetween(
    caps,
    "export const PRESENCE_PROMOTABLE_CONVENTION_KINDS",
    "] as const;",
    "PRESENCE_PROMOTABLE_CONVENTION_KINDS"
  );
  const fromTs = unique(
    nonEmpty(matchAll(promotable, /"([a-z0-9_]+)"/g), "presence-promotable kinds", CAPABILITIES)
  );

  if (JSON.stringify(fromRust) !== JSON.stringify(fromTs)) {
    throw new Error(
      `FAMILY_SPECS kinds and PRESENCE_PROMOTABLE_CONVENTION_KINDS disagree.\n` +
        `  ${CANDIDATE_COMMAND}: ${fromRust.join(", ")}\n` +
        `  ${CAPABILITIES}: ${fromTs.join(", ")}\n` +
        `One of them gates on a set the other does not produce.`
    );
  }
  return fromRust;
}

function deriveProposerKinds() {
  const src = read(CANDIDATE_COMMAND);
  // W5 replaced every one of these string literals with the generated enum, so the patterns read
  // variants now. `kind:` covers the direct proposers (including the one with no evaluator behind
  // it, `middleware_must_cover_routes`), `candidate_kind:` the phase-4/phase-6 family specs.
  const kinds = unique(
    wireForVariants(
      nonEmpty(
        [
          ...matchAll(src, /\bkind:\s*ConventionKind::([A-Za-z0-9]+)/g),
          ...matchAll(src, /\bcandidate_kind:\s*ConventionKind::([A-Za-z0-9]+)/g)
        ],
        "proposer-emitted kinds",
        CANDIDATE_COMMAND
      ),
      "proposer kinds"
    )
  );
  return nonEmpty(kinds, "proposer-emitted kinds", CANDIDATE_COMMAND);
}

function deriveUnevaluatedKinds() {
  const caps = read(CAPABILITIES);
  const block = sliceBetween(
    caps,
    "export const UNIMPLEMENTED_CONVENTION_KINDS",
    "] as const;",
    "UNIMPLEMENTED_CONVENTION_KINDS"
  );
  return unique(nonEmpty(matchAll(block, /"([a-z0-9_]+)"/g), "unevaluated kinds", CAPABILITIES));
}

/** The (kind × enforcement path) cells the source says must exist. */
export function deriveExpectedCells() {
  const { kindArms, phase6 } = deriveDispatch();
  const presenceKinds = derivePresenceKinds();
  const proposerKinds = deriveProposerKinds();
  const unevaluated = deriveUnevaluatedKinds();

  const pathForKindArm = {
    api_route_no_direct_data_access: "materialized_and_graph",
    api_route_requires_service_delegation: "graph",
    api_route_requires_auth_helper: "auth_proof",
    api_route_requires_request_validation: "request_validation_proof",
    api_route_forbids_sensitive_response_fields: "phase5_proof",
    api_route_forbids_secret_exposure: "phase5_proof",
    api_route_requires_tenant_scope: "phase4_proof",
    api_route_requires_authorization: "phase4_proof",
    session_object_must_come_from_trusted_helper: "phase4_proof"
  };

  const cells = new Set();
  for (const kind of kindArms) {
    const path = pathForKindArm[kind];
    if (!path) {
      throw new Error(
        `check_command.rs dispatches on kind "${kind}", which this script has no enforcement-path ` +
          `name for. A new dispatch arm was added: name its path here and declare its cell in the ` +
          `ledger.`
      );
    }
    cells.add(`${kind}::${path}`);
  }
  for (const kind of phase6) cells.add(`${kind}::phase6_proof`);
  for (const kind of presenceKinds) cells.add(`${kind}::presence_findings`);

  // A kind the proposer emits but no arm handles still needs a declared cell - that gap is exactly
  // the D1 shape, and leaving it out of the ledger is how it stays invisible.
  const handled = new Set([...kindArms, ...phase6]);
  for (const kind of proposerKinds) {
    if (!handled.has(kind)) cells.add(`${kind}::no_dispatch_arm`);
  }

  return { cells: [...cells].sort(), proposerKinds, unevaluated, presenceKinds };
}

function main() {
  const ledger = JSON.parse(read(LEDGER_PATH));
  const derived = deriveExpectedCells();
  const declared = new Map(ledger.cells.map((cell) => [cell.id, cell]));
  const errors = [];

  for (const id of derived.cells) {
    if (!declared.has(id)) {
      errors.push(
        `UNDECLARED CELL: ${id}\n` +
          `  The source enumerates this (kind × enforcement path) pair and the ledger does not ` +
          `declare it. Add a row. If you cannot produce firing/quarantined/unimplemented evidence, ` +
          `the state is "needs-review" and that is a passing answer - fill in missing_evidence.`
      );
    }
  }
  for (const [id, cell] of declared) {
    if (!derived.cells.includes(id)) {
      errors.push(
        `STALE CELL: ${id}\n` +
          `  The ledger declares a cell the source no longer enumerates. Remove it, or fix the ` +
          `derivation if the cell is real.`
      );
    }
    if (!VALID_STATES.has(cell.state)) {
      errors.push(`INVALID STATE: ${id} declares "${cell.state}".`);
    }
    if (cell.state === "quarantined" && !cell.citation?.path) {
      errors.push(
        `QUARANTINED WITHOUT CITATION: ${id}\n` +
          `  "quarantined" requires a located doc path or code comment, quoted. A citation you ` +
          `cannot locate is not evidence - the state is "needs-review".`
      );
    }
    if ((cell.state === "firing" || cell.state === "unimplemented") && !cell.canary) {
      errors.push(`STATE WITHOUT A CANARY: ${id} is "${cell.state}" but names no canary test.`);
    }
    if (cell.state === "needs-review" && !cell.missing_evidence) {
      errors.push(
        `NEEDS-REVIEW WITHOUT A WORKLIST ENTRY: ${id}\n` +
          `  Every needs-review cell must record what evidence it lacked. That list is the next ` +
          `audit's worklist.`
      );
    }
  }

  const counts = {};
  for (const cell of ledger.cells) counts[cell.state] = (counts[cell.state] ?? 0) + 1;

  const branch = currentBranch();
  const integration = ledger.enforcement.integration_branches.includes(branch);
  const forced = process.env[ledger.enforcement.override_env] === "1";
  const enforcing = !reportOnly && (integration || forced);

  console.log(`convention cell ledger: ${ledger.cells.length} cells on branch ${branch}`);
  for (const state of ["firing", "quarantined", "unimplemented", "needs-review"]) {
    console.log(`  ${state.padEnd(14)} ${counts[state] ?? 0}`);
  }

  if (errors.length === 0) {
    console.log("ledger: every derived cell is declared, and every state carries its evidence field.");
    return 0;
  }

  for (const error of errors) console.error(`\n${error}`);
  if (!enforcing) {
    console.error(
      `\n${errors.length} ledger problem(s). NOT FAILING: enforcement is integration-branch only ` +
        `(${ledger.enforcement.integration_branches.join(", ")}), and this is "${branch}". ` +
        `Set ${ledger.enforcement.override_env}=1 to enforce here.`
    );
    return 0;
  }
  console.error(`\n${errors.length} ledger problem(s) on an enforcing branch.`);
  return 1;
}

function currentBranch() {
  if (process.env.DRIFT_LEDGER_BRANCH) return process.env.DRIFT_LEDGER_BRANCH;
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8"
    }).trim();
  } catch {
    return "<unknown>";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`convention cell ledger: ${error.message}`);
    process.exit(1);
  }
}
