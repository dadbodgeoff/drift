import type { SqliteDriftStorage } from "@drift/storage";
import { requiredValue } from "../args/flag-readers.js";
import { askRepo } from "../commands/ask.js";
import { listAudit,verifyAudit } from "../commands/audit.js";
import { createBackup,listBackups } from "../commands/backup.js";
import { baselineStatus,clearBaseline,createBaseline } from "../commands/baseline.js";
import { runCheck } from "../commands/check.js";
import { listChecks } from "../commands/checks.js";
import { addContractWaiver,exportContract,importContractDryRun,listContractWaivers,removeContractWaiver,showContract,showContractWaiver,validateContract } from "../commands/contract.js";
import { acceptCandidate,addConventionException,editCandidate,listConventionCandidates,rejectCandidate,showConventionCandidate } from "../commands/conventions.js";
import { listFindings,markFindingFixed,resolveFindingWithReason,showFinding } from "../commands/findings.js";
import { initRepo } from "../commands/init.js";
import { checkPolicyContext,grantAgentPermission,revokeAgentPermission,setEgressPolicy,showPolicy } from "../commands/policy.js";
import { prepareTask } from "../commands/prepare.js";
import { showRepoMap } from "../commands/repo-map.js";
import { scanRepo,scanStatus } from "../commands/scan.js";
import { startRepo } from "../commands/start.js";
import { CommandPayload,ParsedArgs } from "./command-types.js";

export async function runCommand(storage: SqliteDriftStorage, parsed: ParsedArgs): Promise<unknown | CommandPayload> {
  const [group, command, maybeId] = parsed.positional;

  if (group === "scan" && command === "status") {
    return scanStatus(storage, parsed);
  }

  if (group === "init") {
    return initRepo(storage, parsed);
  }

  if (group === "scan") {
    return scanRepo(storage, parsed);
  }

  if (group === "start") {
    return startRepo(storage, parsed);
  }

  if (group === "prepare") {
    return prepareTask(storage, parsed);
  }

  if (group === "ask") {
    return askRepo(storage, parsed);
  }

  if (group === "repo" && command === "map") {
    return showRepoMap(storage, parsed);
  }

  if (group === "checks" && command === "list") {
    return listChecks(storage, parsed);
  }

  if (group === "policy" && command === "show") {
    return showPolicy(storage, parsed);
  }

  if (group === "policy" && command === "check-context") {
    return checkPolicyContext(storage, parsed);
  }

  if (group === "policy" && command === "set-egress") {
    return setEgressPolicy(storage, parsed);
  }

  if (group === "policy" && command === "agent" && maybeId === "grant") {
    return grantAgentPermission(storage, parsed);
  }

  if (group === "policy" && command === "agent" && maybeId === "revoke") {
    return revokeAgentPermission(storage, parsed);
  }

  if (group === "conventions" && command === "list") {
    return listConventionCandidates(storage, parsed);
  }

  if (group === "conventions" && command === "show") {
    const id = requiredValue(maybeId, "candidate id");
    return showConventionCandidate(storage, parsed, id);
  }

  if (group === "conventions" && command === "accept") {
    const id = requiredValue(maybeId, "candidate id");
    return acceptCandidate(storage, parsed, id);
  }

  if (group === "conventions" && command === "reject") {
    const id = requiredValue(maybeId, "candidate id");
    return rejectCandidate(storage, parsed, id);
  }

  if (group === "conventions" && command === "edit") {
    const id = requiredValue(maybeId, "candidate id");
    return editCandidate(storage, parsed, id);
  }

  if (group === "conventions" && command === "exception" && maybeId === "add") {
    const conventionId = requiredValue(parsed.positional[3], "convention id");
    return addConventionException(storage, parsed, conventionId);
  }

  if (group === "contract" && command === "show") {
    return showContract(storage, parsed);
  }

  if (group === "contract" && command === "validate") {
    return validateContract(storage, parsed);
  }

  if (group === "contract" && command === "export") {
    return exportContract(storage, parsed);
  }

  if (group === "contract" && command === "import") {
    return importContractDryRun(storage, parsed, requiredValue(maybeId, "contract path"));
  }

  if (group === "contract" && command === "waivers" && maybeId === "list") {
    return listContractWaivers(storage, parsed);
  }

  if (group === "contract" && command === "waiver" && maybeId === "add") {
    return addContractWaiver(storage, parsed);
  }

  if (group === "contract" && command === "waiver" && maybeId === "show") {
    return showContractWaiver(storage, parsed, requiredValue(parsed.positional[3], "waiver id"));
  }

  if (group === "contract" && command === "waiver" && maybeId === "remove") {
    return removeContractWaiver(storage, parsed, requiredValue(parsed.positional[3], "waiver id"));
  }

  if (group === "findings" && command === "list") {
    return listFindings(storage, parsed);
  }

  if (group === "findings" && command === "show") {
    const findingId = requiredValue(maybeId, "finding id");
    return showFinding(storage, parsed, findingId);
  }

  if (group === "findings" && command === "mark-fixed") {
    const findingId = requiredValue(maybeId, "finding id");
    return markFindingFixed(storage, parsed, findingId);
  }

  if (group === "findings" && command === "mark-needs-review") {
    const findingId = requiredValue(maybeId, "finding id");
    return resolveFindingWithReason(storage, parsed, findingId, "needs_review");
  }

  if (group === "findings" && command === "suppress") {
    const findingId = requiredValue(maybeId, "finding id");
    return resolveFindingWithReason(storage, parsed, findingId, "suppressed");
  }

  if (group === "findings" && command === "accept-drift") {
    const findingId = requiredValue(maybeId, "finding id");
    return resolveFindingWithReason(storage, parsed, findingId, "accepted_drift");
  }

  if (group === "findings" && command === "mark-false-positive") {
    const findingId = requiredValue(maybeId, "finding id");
    return resolveFindingWithReason(storage, parsed, findingId, "false_positive");
  }

  if (group === "audit" && command === "list") {
    return listAudit(storage, parsed);
  }

  if (group === "audit" && command === "verify") {
    return verifyAudit(storage, parsed);
  }

  if (group === "backup" && command === "create") {
    return createBackup(storage, parsed);
  }

  if (group === "backup" && command === "list") {
    return listBackups(storage, parsed);
  }

  if (group === "check") {
    return runCheck(storage, parsed);
  }

  if (group === "baseline" && command === "create") {
    return createBaseline(storage, parsed);
  }

  if (group === "baseline" && command === "status") {
    return baselineStatus(storage, parsed);
  }

  if (group === "baseline" && command === "clear") {
    return clearBaseline(storage, parsed);
  }

  throw new Error(`Unknown command: ${parsed.positional.join(" ")}. Run drift --help.`);
}
