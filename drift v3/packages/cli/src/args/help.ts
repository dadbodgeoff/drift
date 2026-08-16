import { ParsedArgs } from "../app/command-types.js";

export function isHelpRequest(parsed: ParsedArgs): boolean {
  return parsed.flags.has("help") || parsed.positional[0] === "help" || parsed.positional.length === 0;
}

export function isVersionRequest(parsed: ParsedArgs): boolean {
  return parsed.flags.has("version") || parsed.positional[0] === "version";
}

export function helpText(parsed: ParsedArgs): string {
  if (parsed.positional[0] === "doctor") {
    return [
      "Check whether a repo is ready for Drift",
      "",
      "Usage:",
      "  drift doctor --repo-root .",
      "  drift doctor --repo-root . --state-root ~/.drift/repos --json",
      "",
      "What doctor checks:",
      "  repo path, Git state, package manifest, TS/JS files, API routes, local state,",
      "  migration compatibility, contract compatibility, scan freshness, audit-chain integrity,",
      "  and tracked backup artifacts.",
      "  after onboarding, doctor prints upkeep commands for preflight, audit, backup, and scan status.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "init") {
    return [
      "Create local Drift state",
      "",
      "Usage:",
      "  drift init --repo-root . --json",
      "  drift init --repo-root . --state-root ~/.drift/repos --json",
      "",
      "Notes:",
      "  init creates or opens the local SQLite database and registers the repo.",
      "  without --db, Drift stores state under ~/.drift/repos/<repo_id>/drift.sqlite.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "scan") {
    if (parsed.positional[1] === "status") {
      return [
        "Show scan status",
        "",
        "Usage:",
        "  drift scan status --repo <repo_id> --json",
        "  drift --db <path> scan status --repo <repo_id> --json",
        "",
      "What status does:",
      "  shows the latest scan and compares stored file hashes to the current repo files.",
      "  returns no-approval governance metadata, audit validity, stable summary counts, and next commands.",
      ""
    ].join("\n");
  }

    return [
      "Scan a repo",
      "",
      "Usage:",
      "  drift scan --repo-root . --json",
      "  drift scan --repo-root . --state-root ~/.drift/repos --json",
      "",
      "What scan does:",
      "  registers the repo, snapshots TS/JS files, stores facts, and proposes deterministic convention candidates.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "start") {
    return [
      "Start Drift onboarding",
      "",
      "Usage:",
      "  drift start --repo-root .",
      "  drift start --repo-root . --state-root ~/.drift/repos",
      "",
      "What start does:",
      "  creates local state, scans the repo, stores facts, proposes candidates, and prints next commands.",
      "  --accept-defaults is confirmation-equivalent: it accepts the deterministic default convention, materializes a contract, and baselines existing findings.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "capabilities") {
    return [
      "Show Drift V1 capability metadata",
      "",
      "Usage:",
      "  drift capabilities --json",
      "",
      "What capabilities returns:",
      "  runtime versions, supported V1 wedge, no-approval CLI surfaces, human-confirmed governance surfaces, MCP tools, and deferred surfaces.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "prepare") {
    return [
      "Prepare an agent preflight packet",
      "",
      "Usage:",
      "  drift --db <path> prepare \"add user search endpoint\" --repo <repo_id> --json",
      "  drift --db <path> prepare \"add user search endpoint\" --repo <repo_id> --path apps/web/app/api/users/route.ts --require-fresh --json",
      "",
      "What prepare returns:",
      "  accepted conventions, baseline summary, open findings, relevant files, policy metadata, and next commands.",
      "  prepare does not mutate Drift state or include source snippets. Use --require-fresh to fail closed on stale scan context.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "ask") {
    return [
      "Ask Drift for deterministic local repo guidance",
      "",
      "Usage:",
      "  drift --db <path> ask \"what should I know before changing users api routes?\" --repo <repo_id> --json",
      "  drift --db <path> ask \"what applies here?\" --repo <repo_id> --path apps/web/app/api/users/route.ts --require-fresh --json",
      "",
      "What ask returns:",
      "  matching accepted conventions, open findings, relevant files, policy metadata, and next commands.",
      "  ask does not mutate Drift state, stays local-only, and does not include source snippets. Use --require-fresh to fail closed on stale scan context.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "repo") {
    return [
      "Inspect the latest indexed repo map",
      "",
      "Usage:",
      "  drift --db <path> repo map --repo <repo_id> --json",
      "  drift --db <path> repo map --repo <repo_id> --limit 50 --offset 0 --json",
      "  drift --db <path> repo map --repo <repo_id> --role api_route --path apps/web/app/api/users/route.ts --json",
      "  drift --db <path> repo map --repo <repo_id> --require-fresh --json",
      "",
      "What repo map returns:",
      "  latest scanned files, detected roles, imports, exports, calls, scan fingerprint, policy metadata, freshness metadata, and no source snippets.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "security") {
    return [
      "Audit repo security architecture",
      "",
      "Usage:",
      "  drift --db <path> security audit --repo <repo_id> --json",
      "",
      "What security audit returns:",
      "  proof-safe inventory of observed security patterns across auth, middleware, data access, request validation, session trust, authorization, tenant scope, response safety, SSRF, SQL, CORS, CSRF, and rate limits.",
      "  candidate-only patterns are labeled as inventory and never treated as blocking proof.",
      "  output includes file paths and line numbers, not source snippets or raw fact values.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "checks") {
    return [
      "List repo checks and safe commands",
      "",
      "Usage:",
      "  drift --db <path> checks list --repo <repo_id> [--kind required|safe|all] [--path <file>] --json",
      "  drift --db <path> checks list --repo <repo_id> --limit 20 --offset 0 --json",
      "  drift --db <path> checks run --repo <repo_id> --command \"pnpm test\" [--timeout-ms 120000] --json",
      "",
      "What checks list returns:",
      "  human-approved required checks and safe commands from the repo contract.",
      "  results are sorted by command and can be paginated for bounded automation output.",
      "  checks list does not mutate Drift state and does not run commands.",
      "  checks run executes only commands that are both required by the active contract and approved as safe.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "policy") {
    return [
      "Inspect and govern context egress policy",
      "",
      "Usage:",
      "  drift --db <path> policy show --repo <repo_id> --json",
      "  drift --db <path> policy check-context --repo <repo_id> --path <file> --surface cli-preflight [--snippet-chars <n>] [--full-file] --json",
      "  drift --db <path> policy set-egress --repo <repo_id> --default-mode redacted --max-snippet-chars 1200 --deny-glob \"secrets/**\" --confirm --json",
      "  drift --db <path> policy agent grant --repo <repo_id> --agent codex --permission request_preflight --confirm --json",
      "  drift --db <path> policy agent revoke --repo <repo_id> --agent codex --permission request_preflight --confirm --json",
      "",
      "What policy does:",
      "  shows repo context-egress settings, checks outward context surfaces, and returns governance metadata, summaries, and next commands.",
      "  policy and agent-permission changes require --confirm.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "contract") {
    return [
      "Inspect and move repo contracts",
      "",
      "Usage:",
      "  drift --db <path> contract show --repo <repo_id> --json",
      "  drift --db <path> contract validate --repo <repo_id> --json",
      "  drift --db <path> contract export --repo <repo_id> --format json --confirm --json",
      "  drift --db <path> contract export --repo <repo_id> --format json --output ./repo-contract.json --confirm --json",
      "  drift --db <path> contract import <path> --dry-run --json",
      "  drift --db <path> contract import <path> --checksum <sha256> --dry-run --json",
      "  drift --db <path> contract import <path> --checksum <sha256> --require-checksum --dry-run --json",
      "  drift --db <path> contract import <path> --confirm --json",
      "  drift --db <path> contract waivers list --repo <repo_id> --status active --json",
      "  drift --db <path> contract waiver add --repo <repo_id> --path <glob> --reason \"...\" --confirm --json",
      "  drift --db <path> contract waiver show <waiver_id> --repo <repo_id> --json",
      "  drift --db <path> contract waiver remove <waiver_id> --repo <repo_id> --confirm --json",
      "",
      "Notes:",
      "  dry-run validates portable contract JSON without mutating state.",
      "  export, confirmed import, and waiver changes write audit events.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "check") {
    return [
      "Run deterministic checks",
      "",
      "Usage:",
      "  drift --db <path> check --repo <repo_id> --diff main...HEAD --scope changed-hunks --json",
      "  drift --db <path> check --repo <repo_id> --diff-file <patch> --scope changed-hunks --json",
      "",
      "Options:",
      "  --repo <repo_id>       Repo id in Drift storage.",
      "  --diff <range>         Git diff range to evaluate, for example main...HEAD.",
      "  --diff-file <patch>    Read a unified diff from a file.",
      "  --scope changed-hunks  Check only findings on changed lines.",
      "  --scope changed-files  Check findings anywhere in changed files.",
      "  --scope full           Classify all evaluated findings as full-scope.",
      "  --json                 Emit machine-readable JSON.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "conventions") {
    return [
      "Review inferred conventions",
      "",
      "Usage:",
      "  drift --db <path> conventions list --repo <repo_id> --status candidate --json",
      "  drift --db <path> conventions list --repo <repo_id> --kind api_route_no_direct_data_access --capability deterministic_check --limit 20 --offset 0 --json",
      "  drift --db <path> conventions accepted --repo <repo_id> --kind api_route_no_direct_data_access --capability deterministic_check --limit 20 --offset 0 --json",
      "  drift --db <path> conventions show <candidate_id> --json",
      "  drift --db <path> conventions accept <candidate_id> --severity warning --mode warn --confirm --json",
      "  drift --db <path> conventions reject <candidate_id> --reason \"false inference\" --confirm --json",
      "  drift --db <path> conventions edit <candidate_id> --statement \"...\" --confirm --json",
      "  drift --db <path> conventions exception add <convention_id> --repo <repo_id> --path <glob> --reason \"...\" --confirm --json",
      "  drift --db <path> conventions exception add <convention_id> --repo <repo_id> --endpoint /api/health --method GET --reason \"...\" --confirm --json",
      "  drift --db <path> conventions exception add <convention_id> --repo <repo_id> --operation-kind read --reason \"...\" --confirm --json",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "findings") {
    return [
      "Review findings",
      "",
      "Usage:",
      "  drift --db <path> findings list --repo <repo_id> --json",
      "  drift --db <path> findings list --repo <repo_id> --status new --severity error --diff-status new_in_diff --json",
      "  drift --db <path> findings list --repo <repo_id> --convention <convention_id> --json",
      "  drift --db <path> findings list --repo <repo_id> --path apps/web/app/api/users/route.ts --require-fresh --json",
      "  drift --db <path> findings list --repo <repo_id> --limit 25 --offset 0 --json",
      "  drift --db <path> findings show <finding_id> --repo <repo_id> --json",
      "  drift --db <path> findings mark-fixed <finding_id> --repo <repo_id> --evidence <file:line> --confirm --json",
      "  drift --db <path> findings mark-needs-review <finding_id> --repo <repo_id> --reason \"...\" --confirm --json",
      "  drift --db <path> findings suppress <finding_id> --repo <repo_id> --reason \"...\" --confirm --json",
      "  drift --db <path> findings accept-drift <finding_id> --repo <repo_id> --reason \"...\" --confirm --json",
      "  drift --db <path> findings mark-false-positive <finding_id> --repo <repo_id> --reason \"...\" --confirm --json",
      "",
      "Notes:",
      "  review actions require evidence or a reason and write append-only audit events.",
      "  finding state changes require --confirm because they change enforcement posture or review state.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "audit") {
    return [
      "Inspect audit log",
      "",
      "Usage:",
      "  drift --db <path> audit list --repo <repo_id> --json",
      "  drift --db <path> audit verify --repo <repo_id> --json",
      "  drift --db <path> audit list --repo <repo_id> --limit 20 --offset 0 --json",
      "  drift --db <path> audit list --repo <repo_id> --action policy_changed --json",
      "  drift --db <path> audit list --repo <repo_id> --actor geoff --json",
      "  drift --db <path> audit list --repo <repo_id> --target-type finding --json",
      "  drift --db <path> audit list --repo <repo_id> --target-id finding_abc --json",
      "  drift --db <path> audit list --repo <repo_id> --since 2026-05-10T00:00:00.000Z --until 2026-05-11T00:00:00.000Z --json",
      "",
      "Notes:",
      "  audit list does not mutate Drift state and can filter append-only governance events by action, actor, target type, or target id.",
      "  audit list and audit verify return integrity summaries and next commands without exporting source code.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "backup") {
    return [
      "Back up Drift state",
      "",
      "Usage:",
      "  drift --db <path> backup create --repo <repo_id> --confirm --json",
      "  drift --db <path> backup create --repo <repo_id> --output ./backups --confirm --json",
      "  drift --db <path> backup list --repo <repo_id> --json",
      "  drift --db <path> backup list --repo <repo_id> --limit 20 --offset 0 --json",
      "  drift --db <path> backup list --repo <repo_id> --artifact-status missing --json",
      "  drift backup verify <backup.sqlite> --repo <repo_id> --checksum <sha256> --json",
      "  drift backup verify <backup.sqlite> --repo <repo_id> --checksum <sha256> --require-checksum --json",
      "  drift backup verify <backup.sqlite> --repo <repo_id> --expect-repo-fingerprint <fingerprint> --json",
      "",
      "Notes:",
      "  backup create writes one SQLite backup artifact containing Drift state, not source code, and requires --confirm.",
      "  backup list does not mutate Drift state and can filter artifact status by present, missing, or checksum_mismatch.",
      "  backup verify validates schema, repo identity, and optional checksum without requiring --db.",
      "  it appends a backup_created audit event before copying the database.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "restore") {
    return [
      "Restore Drift state",
      "",
      "Usage:",
      "  drift --db <target.sqlite> restore <backup.sqlite> --repo <repo_id> --confirm --json",
      "  drift --db <target.sqlite> restore <backup.sqlite> --repo <repo_id> --dry-run --json",
      "  drift --db <target.sqlite> restore <backup.sqlite> --repo <repo_id> --checksum <sha256> --require-checksum --dry-run --json",
      "  drift --db <target.sqlite> restore <backup.sqlite> --repo <repo_id> --expect-repo-fingerprint <fingerprint> --dry-run --json",
      "",
      "Notes:",
      "  restore validates the backup schema and repo id, copies the SQLite backup into the target database,",
      "  non-dry-run restores require --confirm; use --dry-run to validate without writing.",
      "  runs current migrations, and appends a restore_completed audit event.",
      ""
    ].join("\n");
  }

  if (parsed.positional[0] === "baseline") {
    return [
      "Manage baselines",
      "",
      "Usage:",
      "  drift --db <path> baseline create --repo <repo_id> --from main --confirm --json",
      "  drift --db <path> baseline status --repo <repo_id> --json",
      "  drift --db <path> baseline clear --repo <repo_id> --convention <convention_id> --confirm --json",
      "",
      "Notes:",
      "  create baselines currently stored findings so existing violations do not block future checks.",
      "  create and clear require --confirm because they change future enforcement behavior.",
      "  clear marks matching baseline rows resolved; it does not delete history.",
      ""
    ].join("\n");
  }

  return [
    "Drift local repo intelligence",
    "",
    "Usage:",
    "  drift --db <path> <command> [options]",
    "",
    "First run:",
    "  drift doctor --repo-root .",
    "  drift start --repo-root . --accept-defaults",
    "  drift capabilities --json",
    "",
    "Core commands:",
    "  drift scan status --repo <repo_id> --json",
    "  drift ask \"topic\" --repo <repo_id> --json",
    "  drift prepare \"task\" --repo <repo_id> --json",
    "  drift repo map --repo <repo_id> --json",
    "  drift repo map --repo <repo_id> --limit 50 --offset 0 --json",
    "  drift checks list --repo <repo_id> --json",
    "  drift checks list --repo <repo_id> --limit 20 --offset 0 --json",
    "  drift check --repo <repo_id> --diff main...HEAD --scope changed-hunks --json",
    "  drift check --repo <repo_id> --diff-file <patch> --scope changed-hunks --json",
    "  drift findings list --repo <repo_id> --json",
    "  drift findings mark-fixed <finding_id> --repo <repo_id> --evidence <file:line> --confirm --json",
    "  drift findings mark-needs-review <finding_id> --repo <repo_id> --reason \"...\" --confirm --json",
    "  drift findings suppress <finding_id> --repo <repo_id> --reason \"...\" --confirm --json",
    "  drift audit list --repo <repo_id> --json",
    "  drift audit verify --repo <repo_id> --json",
    "  drift audit list --repo <repo_id> --limit 20 --offset 0 --json",
    "  drift audit list --repo <repo_id> --since <iso-time> --until <iso-time> --json",
    "  drift backup create --repo <repo_id> --confirm --json",
    "  drift backup list --repo <repo_id> --json",
    "  drift backup list --repo <repo_id> --limit 20 --offset 0 --json",
    "  drift backup list --repo <repo_id> --artifact-status missing --json",
    "  drift backup verify <backup.sqlite> --repo <repo_id> --checksum <sha256> --json",
    "  drift backup verify <backup.sqlite> --repo <repo_id> --checksum <sha256> --require-checksum --json",
    "  drift backup verify <backup.sqlite> --repo <repo_id> --expect-repo-fingerprint <fingerprint> --json",
    "  drift restore <backup.sqlite> --repo <repo_id> --confirm --json",
    "  drift restore <backup.sqlite> --repo <repo_id> --checksum <sha256> --require-checksum --dry-run --json",
    "  drift restore <backup.sqlite> --repo <repo_id> --expect-repo-fingerprint <fingerprint> --dry-run --json",
    "  drift contract validate --repo <repo_id> --json",
    "  drift contract export --repo <repo_id> --format json --confirm --json",
    "  drift contract export --repo <repo_id> --format json --output ./repo-contract.json --confirm --json",
    "  drift contract import <path> --dry-run --json",
    "  drift contract import <path> --checksum <sha256> --dry-run --json",
    "  drift contract import <path> --checksum <sha256> --require-checksum --dry-run --json",
    "  drift contract import <path> --confirm --json",
    "  drift contract waivers list --repo <repo_id> --status active --json",
    "  drift contract waiver add --repo <repo_id> --path <glob> --reason \"...\" --confirm --json",
    "  drift contract waiver show <waiver_id> --repo <repo_id> --json",
    "  drift contract waiver remove <waiver_id> --repo <repo_id> --confirm --json",
    "  drift baseline create --repo <repo_id> --from main --confirm --json",
    "  drift baseline status --repo <repo_id> --json",
    "  drift policy show --repo <repo_id> --json",
    "  drift policy check-context --repo <repo_id> --path <file> --surface cli-preflight --json",
    "  drift contract show --repo <repo_id> --json",
    "",
    "Convention review:",
    "  drift conventions list --repo <repo_id> --status candidate --json",
    "  drift conventions list --repo <repo_id> --kind api_route_no_direct_data_access --capability deterministic_check --limit 20 --offset 0 --json",
    "  drift conventions accepted --repo <repo_id> --kind api_route_no_direct_data_access --capability deterministic_check --limit 20 --offset 0 --json",
    "  drift conventions show <candidate_id> --json",
    "  drift conventions accept <candidate_id> --severity warning --mode warn --confirm --json",
    "  drift conventions reject <candidate_id> --reason \"false inference\" --confirm --json",
    "  drift conventions edit <candidate_id> --statement \"...\" --confirm --json",
    "  drift conventions exception add <convention_id> --repo <repo_id> --path <glob> --reason \"...\" --confirm --json",
    "",
    "Global options:",
    "  --db <path>      SQLite database path. Can also use DRIFT_DB.",
    "  --state-root     Local Drift state root for init, scan, start, and doctor.",
    "  --json           Emit machine-readable JSON.",
    "  --help           Show this help.",
    ""
  ].join("\n");
}
