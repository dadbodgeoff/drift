#!/usr/bin/env node
/**
 * Two green test suites, one payload neither of them ever read.
 *
 * The engine emitted `session_not_trusted` into
 * `security_boundary_proofs[].session_trust.missing_trust[].reason`. The Zod enum that parses
 * that exact field declares four members and that is not one of them, so the parse threw and
 * the CLI died on a proof the engine considered well-formed.
 *
 * It shipped because nothing looked at both halves at once:
 *
 *   the Rust suite asserted Rust values      - it agreed with the engine, which was wrong
 *   the TypeScript suite asserted TS schemas - it agreed with the schema, which was right
 *   no test ran the engine and parsed its real output with the real schema
 *
 * A contract with a producer test and a consumer test and no test across the seam is not a
 * contract, it is two opinions. This gate is the missing third test: it drives the actual
 * engine binary, takes the bytes it actually writes, and feeds them to the actual schemas the
 * CLI actually parses them with. It closes the CLASS, not the instance -- any proof field whose
 * emitted value falls outside its declared vocabulary fails here, on every build, whether or not
 * anyone thought to write a test for that field.
 *
 * BOTH CONSUMERS, because they are separate schemas that happen to agree today:
 *
 *   parseEngineCheckResult        packages/engine-contract - the engine boundary the CLI crosses
 *   SecurityBoundaryProofSchema   packages/core            - the storage and query consumer
 *
 * They carry byte-identical copies of the reason enums. Driving only one would let the other
 * drift, which is the same defect one level up. (Sprint 2 generates both from
 * vocabulary/vocabulary.json and this duplication goes away; until then, both are checked.)
 *
 * SCENARIOS are check-repo requests, not fixture repos. The engine is spawned directly rather
 * than driven through the CLI, so a rejection names the engine's own output with nothing in
 * between to normalize, default, or swallow it.
 *
 * Each scenario declares `mustPopulate`: the field paths it exists to reach. A gate that checks
 * a vocabulary it never actually read reports success for the same reason the two suites did
 * before it -- nothing looked. Requiring only that SOME proof came back is one level too
 * shallow: the engine can answer with a well-formed document in which every constrained list is
 * empty, and an emptiness check on the document as a whole cannot tell that from a real answer.
 * These requests are hand-built fact lists that duplicate the engine's fact vocabulary and
 * matcher shape with no cross-check, so the surfaces are individually fragile -- changing a
 * source line from `await helper(request)` to a non-await form is enough to empty
 * `missing_trust`. `mustPopulate` is what makes that a failure instead of a silent pass.
 *
 * BASELINE AND RATCHET, matching scripts/vocabulary-parity.mjs. A rejection already present may
 * be recorded with a written reason; a new one fails. There is no path where a rejection is
 * simply ignored.
 *
 *   node scripts/engine-schema-parity.mjs
 *   node scripts/engine-schema-parity.mjs --update    # rewrite the baseline (reasons preserved)
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const BASELINE = join(HERE, "engine-schema-parity-baseline.json");
const UPDATE = process.argv.includes("--update");

/**
 * Each scenario is a complete check-repo request plus the route files it refers to.
 *
 * `mustEmitProof` is not decoration. These requests are hand-built, and a typo in a fact kind or
 * a convention id produces a request the engine accepts and answers with zero proofs -- which
 * would parse clean and report success while checking nothing at all.
 */
const SCENARIOS = [
  {
    name: "session_trust_unknown_helper",
    mustPopulate: ["session_trust.missing_trust", "missing_proof"],
    // The F1 reproducer. An unrecognized session helper drives the
    // `(source, Some("untrusted"))` arm of build_session_trust_proof_from_facts, which is the
    // arm that emitted a finding-level word into a proof-level field.
    why: "unrecognized session helper - the reason field that shipped an illegal value",
    files: {
      "app/api/projects/route.ts": [
        "import { requireUser } from '@/server/auth';",
        "export async function GET(request: Request) {",
        "  const session = await requireUser(request);",
        "  return Response.json({ ok: Boolean(session) });",
        "}",
        ""
      ]
    },
    facts: [
      fact("file_role_detected", "api_route", 1, 5),
      fact("import_used", "requireUser", 1, 1, "@/server/auth", "requireUser"),
      fact("route_declared", "GET", 2, 5),
      fact("symbol_called", "requireUser", 3, 3),
      fact("route_returns_response", "json", 4, 4, "Response")
    ],
    conventions: [
      {
        id: "security_session_trust",
        kind: "session_object_must_come_from_trusted_helper",
        matcher: { applies_to_file_roles: ["api_route"], required_calls: ["requireUser"] },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check"
      }
    ]
  },
  {
    name: "session_trust_derived_from_request",
    mustPopulate: ["session_trust.missing_trust", "missing_proof"],
    // The other reachable arm of the same match. Both proof-level reasons the builder can emit
    // are driven, so neither can regress unobserved.
    why: "session read straight off the request - the sibling reason on the same field",
    files: {
      "app/api/projects/route.ts": [
        "export async function GET(request: Request) {",
        "  const session = request.headers.get('x-session');",
        "  return Response.json({ ok: Boolean(session) });",
        "}",
        ""
      ]
    },
    facts: [
      fact("file_role_detected", "api_route", 1, 4),
      fact("route_declared", "GET", 1, 4),
      fact("route_returns_response", "json", 3, 3, "Response")
    ],
    conventions: [
      {
        id: "security_session_trust",
        kind: "session_object_must_come_from_trusted_helper",
        matcher: { applies_to_file_roles: ["api_route"] },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check"
      }
    ]
  },
  {
    name: "tenant_scope_missing_predicate",
    mustPopulate: ["tenant.missing", "missing_proof"],
    // tenant.missing[].reason - a different vocabulary on the same proof document.
    why: "data operation with no tenant predicate - the tenant reason vocabulary",
    files: {
      "app/api/projects/route.ts": [
        "import { requireUser } from '@/server/auth';",
        "const db = { project: { findMany: async () => [] } };",
        "export async function GET(request: Request) {",
        "  const session = await requireUser(request);",
        "  await db.project.findMany();",
        "  return Response.json({ ok: true, session: Boolean(session) });",
        "}",
        ""
      ]
    },
    facts: [
      fact("file_role_detected", "api_route", 1, 7),
      fact("import_used", "requireUser", 1, 1, "@/server/auth", "requireUser"),
      fact("route_declared", "GET", 3, 7),
      fact("symbol_called", "requireUser", 4, 4),
      fact("symbol_called", "findMany", 5, 5, "db.project"),
      fact("data_operation_detected", "findMany", 5, 5, "db.project", "read:project"),
      fact("route_returns_response", "json", 6, 6, "Response")
    ],
    conventions: [
      {
        id: "security_api_tenant_scope",
        kind: "api_route_requires_tenant_scope",
        matcher: { applies_to_file_roles: ["api_route"] },
        requires: {
          auth_helpers: [
            { guard_id: "auth_require_user", symbol: "requireUser", behavior: "returns_session" }
          ],
          tenant_helpers: ["scopeProjectToTenant"],
          tenant_keys: ["tenantId"],
          tenant_sources: ["session"],
          data_operations: ["findMany"]
        },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check"
      }
    ]
  },
  {
    name: "authorization_guard_missing",
    mustPopulate: ["authorization.missing", "missing_proof"],
    // authorization.missing[].reason - the surface whose enum legitimately DOES contain
    // `session_not_trusted`. Driving it alongside session_trust is what keeps the two
    // vocabularies from being conflated again by whoever reads only one of them.
    why: "data operation with no authorization guard - the authorization reason vocabulary",
    files: {
      "app/api/projects/route.ts": [
        "import { requireUser } from '@/server/auth';",
        "const db = { project: { findMany: async () => [] } };",
        "export async function GET(request: Request) {",
        "  const session = await requireUser(request);",
        "  await db.project.findMany();",
        "  return Response.json({ ok: true, session: Boolean(session) });",
        "}",
        ""
      ]
    },
    facts: [
      fact("file_role_detected", "api_route", 1, 7),
      fact("import_used", "requireUser", 1, 1, "@/server/auth", "requireUser"),
      fact("route_declared", "GET", 3, 7),
      fact("symbol_called", "requireUser", 4, 4),
      fact("symbol_called", "findMany", 5, 5, "db.project"),
      fact("data_operation_detected", "findMany", 5, 5, "db.project", "read:project"),
      fact("route_returns_response", "json", 6, 6, "Response")
    ],
    conventions: [
      {
        id: "security_api_authorization",
        kind: "api_route_requires_authorization",
        matcher: { applies_to_file_roles: ["api_route"] },
        requires: {
          auth_helpers: [
            { guard_id: "auth_require_user", symbol: "requireUser", behavior: "returns_session" }
          ],
          authorization_helpers: [
            {
              symbol: "requireRole",
              import: "@/server/authz",
              kind: "role_check",
              behavior: "throws_on_failure"
            }
          ],
          data_operations: ["findMany"]
        },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check"
      }
    ]
  }
];

function fact(kind, name, start_line, end_line, value = null, imported_name = null) {
  return {
    kind,
    file_path: "app/api/projects/route.ts",
    name,
    value,
    imported_name,
    start_line,
    end_line
  };
}

/**
 * Build the engine rather than trusting whichever binary happens to be on disk.
 *
 * This gate compares what the engine EMITS against what the schema ACCEPTS, so a stale binary
 * does not degrade it -- it inverts it. A binary predating the current source reports the old
 * payload: a fixed defect still looks broken, and worse, a freshly introduced one looks clean.
 * Picking `target/release` over `target/debug` by existence, as the other gates do, was enough
 * to report a two-day-old failure that had already been fixed.
 *
 * Release profile matches `pnpm build:engine`, so under verify:ci this is a cache hit rather
 * than a second compile.
 */
function engineBinary() {
  // `--engine <path>` measures a different binary instead of building one. This exists so the
  // gate's own test can point it at a proxy that reproduces a known-bad emission without
  // corrupting the shared Rust source or the shared release binary, which other harness tests
  // build and execute concurrently. CI never passes it; the flag changes what is measured, not
  // how strictly it is judged.
  const override = process.argv.indexOf("--engine");
  if (override !== -1) {
    const path = process.argv[override + 1];
    if (!path || !existsSync(path)) {
      console.error(`engine schema parity: --engine ${path ?? "<missing>"} does not exist.`);
      process.exit(1);
    }
    return path;
  }

  try {
    execFileSync("cargo", ["build", "--release", "-p", "drift-engine"], {
      cwd: REPO_ROOT,
      stdio: "inherit"
    });
  } catch {
    console.error("engine schema parity: cargo build --release -p drift-engine failed.");
    process.exit(1);
  }
  const binary = join(REPO_ROOT, "target/release/drift-engine");
  if (!existsSync(binary)) {
    console.error(`engine schema parity: cargo reported success but ${binary} is missing.`);
    process.exit(1);
  }
  return binary;
}

function runScenario(binary, scenario) {
  const root = mkdtempSync(join(tmpdir(), `drift-engine-schema-${scenario.name}-`));
  try {
    for (const [path, lines] of Object.entries(scenario.files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, lines.join("\n"));
    }
    const request = {
      repo: { repo_id: "repo_schema_parity", repo_root: root },
      scan: { scan_id: "scan_schema_parity", facts: scenario.facts },
      contract: {
        contract_id: "contract_schema_parity",
        contract_schema_version: 1,
        conventions: scenario.conventions
      },
      baseline: [],
      diff: { mode: "full", files: [] }
    };
    const stdout = execFileSync(binary, ["check-repo"], {
      input: JSON.stringify(request),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    return JSON.parse(stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A Zod issue rendered so the message names the field, the value, and the legal set. */
function describeIssue(scenarioName, consumer, issue) {
  const path = issue.path.join(".");
  const received =
    issue.received === undefined ? "" : ` received ${JSON.stringify(issue.received)}`;
  const options = issue.options ? ` options ${JSON.stringify(issue.options)}` : "";
  return {
    key: `${scenarioName} :: ${consumer} :: ${path} :: ${issue.code}`,
    detail: `${issue.message}${received}${options}`
  };
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return { rejections: {} };
  return JSON.parse(readFileSync(BASELINE, "utf8"));
}

async function main() {
  const binary = engineBinary();

  const { parseEngineCheckResult } = await import(
    join(REPO_ROOT, "packages/engine-contract/dist/index.js")
  );
  const { SecurityBoundaryProofSchema } = await import(
    join(REPO_ROOT, "packages/core/dist/index.js")
  );

  const rejections = [];
  const unpopulated = [];
  let proofsChecked = 0;
  let fieldsChecked = 0;

  for (const scenario of SCENARIOS) {
    const payload = runScenario(binary, scenario);
    const proofs = payload.security_boundary_proofs ?? [];

    if (proofs.length === 0) {
      unpopulated.push({ scenario, path: "security_boundary_proofs" });
      continue;
    }
    proofsChecked += proofs.length;

    // The liveness contract. A scenario that stopped reaching its surface still parses clean,
    // so without this the gate would report success having read no constrained value at all.
    for (const path of scenario.mustPopulate) {
      const populated = proofs.some((proof) => {
        const value = path.split(".").reduce((node, key) => node?.[key], proof);
        return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
      });
      if (populated) fieldsChecked += 1;
      else unpopulated.push({ scenario, path });
    }

    // Consumer 1: the engine boundary, on the whole document. This is the parse the CLI
    // performs, so it catches a bad value anywhere in the result, not only in a proof.
    const engineResult = safeParse(() => parseEngineCheckResult(payload));
    if (!engineResult.ok) {
      for (const issue of engineResult.issues) {
        rejections.push(describeIssue(scenario.name, "parseEngineCheckResult", issue));
      }
    }

    // Consumer 2: the storage and query schema, per proof.
    for (const proof of proofs) {
      const parsed = SecurityBoundaryProofSchema.safeParse(proof);
      if (parsed.success) continue;
      for (const issue of parsed.error.issues) {
        rejections.push(describeIssue(scenario.name, "SecurityBoundaryProofSchema", issue));
      }
    }
  }

  if (unpopulated.length > 0) {
    console.error("engine schema parity: a scenario no longer reaches the field it exists to check.");
    console.error("  An empty surface parses clean, so this would otherwise report success");
    console.error("  having read no vocabulary-constrained value at all.");
    console.error("");
    for (const { scenario, path } of unpopulated) {
      console.error(`  ${scenario.name} :: ${path} is empty`);
      console.error(`    ${scenario.why}`);
    }
    process.exit(1);
  }

  const baseline = loadBaseline();
  const seen = new Map();
  for (const rejection of rejections) {
    if (!seen.has(rejection.key)) seen.set(rejection.key, rejection.detail);
  }

  if (UPDATE) {
    const next = { rejections: {} };
    for (const [key, detail] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
      next.rejections[key] = {
        reason: baseline.rejections?.[key]?.reason ?? "TODO: why this rejection is tolerated",
        detail
      };
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`engine schema parity: baseline updated (${seen.size} rejections).`);
    return;
  }

  const baselined = new Set(Object.keys(baseline.rejections ?? {}));
  const added = [...seen.keys()].filter((key) => !baselined.has(key));
  const fixed = [...baselined].filter((key) => !seen.has(key));

  if (added.length > 0) {
    console.error("engine schema parity: the engine emitted a value its own schema rejects.");
    console.error("");
    for (const key of added) {
      console.error(`  ${key}`);
      console.error(`    ${seen.get(key)}`);
    }
    console.error("");
    console.error("  The engine and the schema disagree about a field's vocabulary. Fix the");
    console.error("  emitted value, or widen the schema -- do not baseline it without a reason.");
    process.exit(1);
  }

  if (fixed.length > 0) {
    console.error("engine schema parity: baselined rejections no longer occur.");
    for (const key of fixed) console.error(`  ${key}`);
    console.error("");
    console.error("  Run: node scripts/engine-schema-parity.mjs --update");
    process.exit(1);
  }

  console.log(
    `engine schema parity: ${proofsChecked} proofs from ${SCENARIOS.length} scenarios, ` +
      `${fieldsChecked} populated surfaces, parsed by 2 consumers` +
      `${seen.size > 0 ? `, ${seen.size} baselined` : ""}.`
  );
}

/** parseEngineCheckResult throws; safeParse does not. Normalize the two into one shape. */
function safeParse(run) {
  try {
    run();
    return { ok: true, issues: [] };
  } catch (error) {
    if (error?.issues) return { ok: false, issues: error.issues };
    return {
      ok: false,
      issues: [{ path: [], code: "throw", message: error?.message ?? String(error) }]
    };
  }
}

await main();
