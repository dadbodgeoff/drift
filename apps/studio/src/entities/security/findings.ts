// What `drift security --top`, `drift check --diff-base` (security advice) and the inventory's `unreached` say, in
// Drift's own words (crates/drift-mine/src/security_summary.rs, ratchet.rs, security.rs). Kept beside the sentences
// they mirror so the Studio and the terminal say the same thing of the same finding; a unit test keeps each string
// equal to its source.
import type { Exposure, SecurityAdvice, SecurityRanked, SecurityTop } from "@/shared/contract/drift";

/** security_summary.rs `HEADING`: what the ranked list is, and that nothing in it fails a check. */
export const TOP_HEADING = "Security findings to look at first (from the security inventory: what Drift read, in order; nothing here fails a check)";

/** security_summary.rs `PLACES_NAMED`: how many entry points one grouped finding names before "and N more". */
export const PLACES_NAMED = 3;

/** How each finding opens: who can reach the operation (security_summary.rs `caller_words`). */
export const CALLER_TEXT: Record<SecurityRanked["caller"], string> = {
  anyone: "A caller Drift found no guard for can",
  hook_not_read: "A caller, unless a hook the whole app runs turns them away, can",
  passes_guard: "A caller who passes its guard can",
  service: "A caller whose signature checks out can",
  unread: "A caller, unless something Drift did not read turns them away, can",
};

/** What a caller can do through an operation of a kind (security_summary.rs `consequence`); the fallback for any other. */
const CONSEQUENCE: Record<string, string> = {
  eval: "send text the server runs as code",
  shell_exec: "send text that becomes part of a shell command",
  unsafe_deserialize: "send data the server loads with an unsafe deserialiser",
  template_injection: "send text the server renders as a template",
  raw_sql: "send a value that goes into a raw SQL query",
  sql_string_interpolation: "send a value that is written into the text of an SQL query",
  nosql_injection: "send a value that is written into a MongoDB $where expression",
  path_traversal: "send a value that becomes part of the path of a file the server opens",
  xml_external_entities: "send XML the server parses with external entities resolved",
  jwt_decode_without_verify: "send a token the server decodes without verifying it",
  dynamic_fetch: "send a value that becomes part of the address of a request the server makes",
  raw_html: "send text the server writes into a page as raw HTML",
  mass_assignment: "send fields that are written to a row from the whole request body",
  dynamic_key_write: "send a value that becomes the key of an object the server writes to",
  dynamic_regex: "send a value that becomes part of a regular expression the server builds",
  dynamic_redirect: "send a value that becomes part of the address a redirect sends the browser to",
};
export const consequenceText = (kind: string): string => CONSEQUENCE[kind] ?? "send a value that reaches a risky operation";

/** `path#Symbol` as its two parts (security_summary.rs `split_node`). */
export function splitNode(node: string): [string, string] {
  const i = node.lastIndexOf("#");
  return i < 0 ? [node, ""] : [node.slice(0, i), node.slice(i + 1)];
}

type Place = SecurityRanked["places"][number];

/** `GET /a (server.ts:12)` (security_summary.rs `where_of`). */
export function whereOf(p: Place): string {
  const route = p.method && p.route ? `${p.method} ${p.route}` : (p.route ?? p.symbol);
  return `${route} (${p.path}:${p.line})`;
}

/** Where the operation is: `lib/db.ts:5 (find)`, or `lib/db.ts#find` with no line (security_summary.rs `sink_at`). */
export function sinkAt(r: Pick<SecurityRanked, "sink" | "sink_line">): string {
  const [path, symbol] = splitNode(r.sink);
  return r.sink_line !== undefined ? `${path}:${r.sink_line} (${symbol})` : r.sink;
}

/** What Drift read of the input's validation (security_summary.rs `finding_lines`); null when it read nothing of it. */
export function validationText(r: Pick<SecurityRanked, "validation" | "places">): string | null {
  if (r.validation === "not_found") return "no input validation found";
  if (r.validation === "not_read") return null;
  if (r.places.every((p) => p.schema_in_body)) return "a schema is read in the body";
  if (r.places.some((p) => p.schema_in_body)) return "the input is validated on the way, or a schema is read in the body";
  return "the input is validated on the way";
}

/** security.rs `Exposure`'s order: the widest of a finding's places speaks for it. */
const EXPOSURE_ORDER: Exposure[] = ["public", "unknown", "internal"];

/**
 * One ranked finding as Drift prints it (security_summary.rs `finding_lines`): what a caller can do and where, what
 * Drift read that makes it say so, and what it could not read. Three lines; none for a finding with no place.
 */
export function rankedLines(r: SecurityRanked): { head: string; read: string; notRead: string } | null {
  const first = r.places[0];
  if (!first) return null;
  const what = consequenceText(r.kind);
  let head: string;
  if (r.places.length === 1) {
    const op = first.via.length <= 1 ? "" : `; the operation is in ${sinkAt(r)}`;
    head = `${CALLER_TEXT[r.caller]} ${what} (${r.kind}): ${whereOf(first)}${op}.`;
  } else {
    const rest = r.places.length - PLACES_NAMED;
    const named = r.places.slice(0, PLACES_NAMED).map(whereOf).join("; ");
    head = `${CALLER_TEXT[r.caller]} ${what} (${r.kind}) at ${r.places.length} entry points through ${sinkAt(r)}: ${named}${rest > 0 ? `, and ${rest} more` : ""}.`;
  }
  const read: string[] = [];
  if (r.places.every((p) => p.guard === first.guard)) read.push(first.guard);
  else read.push(r.caller === "passes_guard" ? "behind guards that differ by entry point (`drift security` names each)" : "what Drift read of their guards differs by entry point (`drift security` names each)");
  const tail = (v: string[]) => v.slice(1).join("\u0000");
  if (first.via.length > 1 && !r.places.every((p) => tail(p.via) === tail(first.via))) read.push("a value the request sent reaches the operation, by a different way from each entry point");
  else if (first.via.length > 1)
    read.push(`a value the request sent reaches the operation through ${first.via.slice(1, 5).map((n) => splitNode(n)[1]).join(" > ")}${first.via.length > 5 ? " > ..." : ""}`);
  else read.push("a value the request sent reaches the operation");
  const v = validationText(r);
  if (v) read.push(v);
  const exposure = EXPOSURE_ORDER.find((e) => r.places.some((p) => p.exposure === e)) ?? "unknown";
  if (exposure === "public") read.push("internet-facing");
  if (exposure === "internal") read.push("internal in what Drift read");
  const notRead = ["whether the value is checked before the operation"];
  if (r.validation === "not_read") notRead.push("whether the input is validated");
  if (exposure === "unknown") notRead.push("where the entry point can be reached from");
  if (r.caller === "hook_not_read") notRead.push("whether the hooks the whole app runs identify or authorise the caller");
  const unread = Math.max(0, ...r.places.map((p) => p.guard_not_read ?? 0));
  if (unread > 0) notRead.push(`${unread} thing(s) on the way a guard may be in (\`drift security\` names them)`);
  return { head, read: `Read: ${read.join("; ")}.`, notRead: `Not read: ${notRead.join("; ")}.` };
}

/** Why findings are not ranked, each with its count, in Drift's order; none for a reason with none (security_summary.rs `NotRanked::parts`). */
export function notRankedParts(n: SecurityTop["not_ranked"]): string[] {
  const parts: [number, string][] = [
    [n.guard_unknown, "where Drift could not read the guard"],
    [n.not_fed, "where Drift read no request value reaching the operation"],
    [n.settings, "that are settings written in the code, not something a caller sends"],
    [n.no_caller, "started by a queue or a schedule"],
    [n.no_remote_caller, "run locally, with no remote caller"],
    [n.test_or_example, "in test or example code"],
  ];
  return parts.filter(([c]) => c > 0).map(([c, what]) => `${c} ${what}`);
}

/** The line under the shown findings when more are ranked (security_summary.rs `render`). */
export const moreRankedText = (more: number, total: number) =>
  `${more} more ranked: \`drift security --top ${total}\` lists them all; \`drift security\` lists every entry point and what it reaches.`;

// ---------- drift check --diff-base, with no security baseline (ratchet.rs `render_advice`) ----------

/** ratchet.rs `ADVICE_HEADING`. */
export const ADVICE_HEADING = "Security advice: what this change adds (no security baseline; this does not fail the check)";

/** The kinds of advice, in Drift's order, each under its heading (ratchet.rs `render_advice`). */
export const ADVICE_GROUPS: readonly { kind: string; heading: string }[] = [
  { kind: "unguarded-reaching", heading: "New entry points where Drift found no guard, reaching an operation fed by the request" },
  { kind: "no-guard", heading: "New request entry points where Drift found no guard" },
  { kind: "unscoped-key", heading: "New entry points that take a tenant or owner key nothing checks" },
];

/** How one is settled (ratchet.rs `render_advice`, its last line). */
export const ADVICE_SETTLE =
  "To settle one: add the guard or the check it lacks, or accept what the repository has with `drift security --write-baseline` (commit .drift/security.lock); `drift check` then reports only what is new.";

/** Advice grouped as Drift prints it; a kind Drift does not name (a newer one) goes last under its own kind. */
export function adviceGroups(advice: SecurityAdvice[]): { kind: string; heading: string; rows: SecurityAdvice[] }[] {
  const known = ADVICE_GROUPS.map((g) => ({ ...g, rows: advice.filter((a) => a.kind === g.kind) }));
  const other = [...new Set(advice.map((a) => a.kind).filter((k) => !ADVICE_GROUPS.some((g) => g.kind === k)))].sort();
  return [...known, ...other.map((kind) => ({ kind, heading: kind, rows: advice.filter((a) => a.kind === kind) }))].filter((g) => g.rows.length > 0);
}

/** `path:line` as its parts; the line is null when there is none. */
export function splitAt(at: string): { path: string; line: number | null } {
  const m = /^(.*):(\d+)$/.exec(at);
  return m ? { path: m[1], line: Number(m[2]) } : { path: at, line: null };
}

// ---------- the inventory's `unreached` (security.rs `UnreachedFile`, and its text line) ----------

/** What makes a file unreached, as `drift security` says it of the files it lists. */
export const UNREACHED_WHY =
  "nothing imports or registers them, no manifest names them, they list no entry point, and they import nothing or did not parse";

/** What Drift does with what an unreached file holds. */
export const UNREACHED_NOT_COUNTED = "their risky operations and route-like registrations are not counted as production code";
