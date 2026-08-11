import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { optionalFileRoleFlag,optionalNonNegativeIntegerFlag,optionalPositiveIntegerFlag,optionalRepoRelativeFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { repoMapPayload } from "../domain/repo-map.js";
import { formatRepoMapText } from "../formatters/repo-map.js";

export function showRepoMap(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const role = optionalFileRoleFlag(parsed, "role");
  const path = optionalRepoRelativeFlag(parsed, "path");
  const limit = optionalPositiveIntegerFlag(parsed, "limit");
  const offset = optionalNonNegativeIntegerFlag(parsed, "offset") ?? 0;
  const payload = repoMapPayload(storage, repoId, {
    surface: "cli-preflight",
    role,
    path,
    requireFresh: parsed.flags.has("require-fresh"),
    limit,
    offset
  });
  return {
    payload: parsed.flags.has("json") ? payload : formatRepoMapText(payload)
  };
}
