// The command a promotion runs, built from typed choices (`drift practices promote`, crates/drift-cli/src/promote.rs).
// Dependency-free (type imports only) so scripts/make-promote-fixtures.mjs records the runs fixture mode serves with
// the very argv the Studio passes. The main process builds the real argv again from the same request and validates
// every piece (electron/ops.ts `promoteFlags`); a unit test keeps the two equal.
//
// The refusals here are the ones the command line itself makes before it reads anything (promote.rs `request`, the
// `--block --force` check) and the engine's that follow from the request alone (`nothing_accepted`, `no_enforcing`):
// the dialog disables such a choice and says the CLI's own sentence. Every other answer comes from running Drift.
import type { PromotePlace } from "@/shared/contract/drift";
import type { PromoteRequest } from "@/shared/ipc/contract";

/** How many units the block replay reads (drift-mine `promote::REPLAY_UNITS`, `MIN_BLOCK_ROLE_SIZE`). */
export const REPLAY_UNITS = 15;

/**
 * The concerns whose classifier has a reading of which ways enforce them (`Concern::enforces`: `authn.rs`, `authz.rs`),
 * in the map's order, as promote.rs `enforcing_concerns` names them. A unit test reads the Rust sources for the list.
 */
export const ENFORCING_CONCERNS: readonly string[] = ["authn", "authz"];

/** A concern in the CLI's words (drift-mine practices/render.rs `plain_concern`); any other id is said as it is. */
export const PLAIN_CONCERN: Readonly<Record<string, string>> = {
  authn: "sign-in",
  authz: "permissions",
  errors: "errors",
  api: "responses",
  validation: "validation",
  data_access: "data access",
  config: "configuration",
};

export const plainConcern = (id: string) => PLAIN_CONCERN[id] ?? id;

// ---------- places ----------

/** Where a promotion holds, as a person picks it: a directory (`.` the root package), one file, or a route prefix of a package. */
export type PlaceKind = "dir" | "file" | "route";
export interface PlaceChoice {
  kind: PlaceKind;
  /** dir and file: the path from the repository root (`.` the root package); route: the package (`.` the root package). */
  path: string;
  /** route only: the prefix, from `/` (`/api/workspaces/[*]`). */
  prefix?: string;
}

/** The route place separator `--in` reads (drift-mine `promote::ROUTE_SEPARATOR`). */
export const ROUTE_SEPARATOR = ":/";

const badPath = (p: string) => p.startsWith("/") || p.startsWith("-") || p.includes("\\") || /^[A-Za-z]:/.test(p) || /\p{Cc}/u.test(p) || p.split("/").some((s) => s === ".." || s === "." || s === "");

/** Why the place cannot be passed to `--in` (null: it can). Drift reads the rest: a place it read nothing of is its refusal. */
export function placeProblem(p: PlaceChoice): string | null {
  const path = p.path.trim();
  if (!path) return p.kind === "route" ? "Name the package (`.` is the root package)." : p.kind === "file" ? "Name the file, from the repository root." : "Name the directory, from the repository root (`.` is the root package).";
  if (path.length > 1024) return "The path is too long.";
  if (path !== "." && badPath(path)) return "A path from the repository root: no leading `/` or `-`, no `..`, `.` or empty segment, no backslash.";
  if (p.kind === "file" && path === ".") return "Name a file, not the root package.";
  if (p.kind === "file" && path.includes(ROUTE_SEPARATOR)) return "A file path has no `:/`.";
  if (p.kind === "route") {
    const prefix = (p.prefix ?? "").trim();
    if (!prefix.startsWith("/") || prefix === "/") return "A route prefix starts with `/` and names at least one segment (`/api/workspaces`).";
    if (prefix.length > 512 || /\p{Cc}|\s|\\/u.test(prefix) || prefix.slice(1).split("/").some((s, i, xs) => s === "" && i < xs.length - 1) || prefix.split("/").some((s) => s === ".." || s === "."))
      return "A route prefix is literal segments and parameters (`/api/[id]/projects`), with no space, `..` or empty segment.";
  }
  return null;
}

/** The place as `--in` names it: the path (`.` the root package), or `<package>:/<prefix>` for a route place. */
export function placeArg(p: PlaceChoice): string {
  const path = p.path.trim();
  if (p.kind !== "route") return path;
  return `${path}:${(p.prefix ?? "").trim().replace(/\/+$/, "")}`;
}

/** A place Drift printed (`promote::Place`) as a choice: a route place, one file, or a directory (`.` the root package). */
export function placeChoiceOf(place: PromotePlace): PlaceChoice {
  if (place.route) return { kind: "route", path: place.package || ".", prefix: place.route };
  if (place.file) return { kind: "file", path: place.file };
  const shown = [place.package, place.dir].filter(Boolean).join("/");
  return { kind: "dir", path: shown || "." };
}

/** A place as `--in` names it, read back: `<package>:/<prefix>` is a route place, anything else a directory. */
export function placeChoiceFromArg(arg: string): PlaceChoice {
  const at = arg.indexOf(ROUTE_SEPARATOR);
  if (at >= 0) return { kind: "route", path: arg.slice(0, at) || ".", prefix: arg.slice(at + 1) };
  return { kind: "dir", path: arg };
}

// ---------- the command ----------

/** The ways a request names, once each, in order: the first is the convention's `promoted_from_practice`. */
export function namedWays(req: Pick<PromoteRequest, "id" | "with">): string[] {
  return [...new Set([...(req.id ? [req.id] : []), ...req.with])];
}

/**
 * `drift practices promote` arguments after the subcommand, in the order the CLI prints a candidate's command
 * (drift-mine `promote::command`): the first way (or `--concern <id>` when no way is named), `--in <place>`,
 * `--with` each other way, `--mechanism` each mechanism accepted whole, `--any-enforcing`; then `--block`, `--force`,
 * `--dry-run` for a preview and `--json` always.
 */
export function promoteFlags(req: PromoteRequest, dryRun: boolean): string[] {
  const [first, ...rest] = namedWays(req);
  const head = first ? [first] : req.concern ? ["--concern", req.concern] : [];
  return [
    ...head,
    "--in",
    req.place,
    ...rest.flatMap((w) => ["--with", w]),
    ...[...new Set(req.mechanisms ?? [])].flatMap((m) => ["--mechanism", m]),
    ...(req.any_enforcing ? ["--any-enforcing"] : []),
    ...(req.block ? ["--block"] : []),
    ...(req.force ? ["--force"] : []),
    ...(dryRun ? ["--dry-run"] : []),
    "--json",
  ];
}

/** `w` as one shell word, as Drift prints commands (drift-mine report.rs `shell_word`). */
export function shellWord(w: string): string {
  if (w && !w.startsWith("-") && /^[A-Za-z0-9\-_./@+:,=]+$/.test(w)) return w;
  // A flag is a word the Studio wrote itself: printed as it is.
  if (/^--[a-z-]+$/.test(w)) return w;
  return `'${w.replace(/'/g, "'\\''")}'`;
}

/** The command a promotion runs, as a person would type it (each word quoted for a shell where it needs to be). */
export function promoteCommand(root: string, req: PromoteRequest, dryRun: boolean): string {
  return ["drift", "--root", shellWord(root), "practices", "promote", ...promoteFlags(req, dryRun).map(shellWord)].join(" ");
}

// ---------- what the command line refuses before reading anything ----------

/** promote.rs: the command line's sentence for `--block` with `--force`. */
export const BLOCK_FORCED = "--block and --force do not go together: a practice promoted below the share (--force) advises only and never blocks; nothing was written";

/** A refusal the CLI makes from the request alone: its code and the sentence it prints (exit 2, nothing written). */
export interface CliRefusal {
  code: "no_variant" | "no_concern" | "block_forced" | "nothing_accepted" | "no_enforcing";
  message: string;
}

/**
 * The refusal `drift practices promote` makes of `req` before it reads the code, as the CLI words it; null when the
 * request gets that far. In the CLI's order: no way and no concern (promote.rs `request`), `--block` with `--force`,
 * then the engine's refusals that follow from the request alone (`candidate_for`: nothing accepted; any enforcing way
 * of a concern with no reading of what enforces it), each with the CLI's added sentence (`refusal_message`).
 */
export function cliRefusal(req: PromoteRequest): CliRefusal | null {
  const named = namedWays(req).length > 0;
  const concern = req.concern ?? "";
  const mechanisms = req.mechanisms ?? [];
  if (!named && !concern) {
    if (mechanisms.length || req.any_enforcing)
      return {
        code: "no_concern",
        message: "--mechanism and --any-enforcing need --concern <id> when no variant is named: the concern says which units Drift reads (`drift practices --json` lists the ids, `concerns[].id`); nothing was written",
      };
    return {
      code: "no_variant",
      message: "name the variant to promote (`drift practices --all` prints the ids), or a concern with --mechanism or --any-enforcing (`--concern authn --any-enforcing`), or use --list; nothing was written",
    };
  }
  if (req.block && req.force) return { code: "block_forced", message: BLOCK_FORCED };
  if (!named && !mechanisms.length && !req.any_enforcing)
    return {
      code: "nothing_accepted",
      message:
        "Nothing to promote: name a way (a variant id), a mechanism, or any way that enforces the concern. The forms: `drift practices promote <P-id> --in <place>` (a variant id, as `drift practices --all` prints it), `--concern <id> --mechanism <name> --in <place>`, or `--concern <id> --any-enforcing --in <place>`. `drift practices promote --list` prints a command for each practice that may be promoted now.",
    };
  if (req.any_enforcing && concern && !ENFORCING_CONCERNS.includes(concern)) return { code: "no_enforcing", message: noEnforcingMessage(concern) };
  return null;
}

/** promote.rs `refusal_message` for `no_enforcing`: the engine's sentence, the concerns that have the reading, and what to name instead. */
export function noEnforcingMessage(concern: string): string {
  return `Drift has no reading of which ways enforce ${plainConcern(concern)}: name its ways instead. Drift has that reading for ${ENFORCING_CONCERNS.join(", ")} (\`--concern <id> --any-enforcing\`). For this one, name its ways (\`drift practices --concern ${concern} --all\` lists them) or a mechanism (\`--mechanism <name>\`).`;
}

/**
 * Why block mode is out of reach for a candidate before any replay (the CLI's preview, drift-mine `promote::preview`):
 * a place holding fewer units Drift can read than the replay reads can never be replayed. Null otherwise; the replay
 * itself (git history, Python advise-only) is Drift's to run and answer.
 */
export function cannotBlock(c: { follows: number; exceptions: readonly unknown[]; unit: string }): string | null {
  const readable = c.follows + c.exceptions.length;
  if (readable >= REPLAY_UNITS) return null;
  const w = c.unit.replace(/_/g, " ");
  const units = w.endsWith("s") ? w : `${w}s`;
  return `It cannot block: blocking needs a replay of the ${REPLAY_UNITS} ${units} added here most recently, and Drift can read only ${readable} here`;
}
