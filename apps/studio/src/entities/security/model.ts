// `drift security --json`, shaped for display.
import { internalText, noGuardText } from "@/entities/basis";
import type { AnswerBasis, Boundaries, EntryRow, Exposure, FileFacts, Inventory, SecurityDiff, SinkUse } from "@/shared/contract/drift";

export interface SecurityHeadline {
  entryPoints: number;
  unguarded: number;
  reaching: number;
  unguardedReaching: number;
  sinks: number;
  leakGroups: number;
  leakClients: number;
  envVars: number;
}

/** Kinds of entry point fed by a queue (security.rs `QUEUE_KINDS`): a message consumer has no caller to sign in. */
export const QUEUE_KINDS: readonly string[] = ["consumer"];

/** Whether a kind of entry point is fed by a queue (security.rs `queue_kind`). */
export const isQueueKind = (kind: string): boolean => QUEUE_KINDS.includes(kind);

/**
 * No guard, as `drift security` counts it (security.rs `EntryRow::unguarded`): a remote caller reaches it (`local`,
 * newer drift, is absent), it is not fed by a queue, it has no guard, and nothing on it may be one that Drift cannot
 * read (`opaque`).
 */
export const isUnguarded = (e: Pick<EntryRow, "guards" | "local" | "opaque" | "kind">): boolean =>
  !e.local && !isQueueKind(e.kind) && e.guards.length === 0 && !e.opaque?.length;

/** What Drift says of a local entry point where a guard would be named (security.rs `LOCAL_NOTE`). */
export const LOCAL_NOTE = "run locally, no remote caller";

/** What Drift says of a queue-fed entry point where a guard would be named (security.rs `QUEUE_NOTE`). */
export const QUEUE_NOTE = "fed by a queue, no caller to sign in";

/**
 * What is said where an entry point's guards would be named (security.rs `EntryRef::has`, and the inventory's own
 * listing): its guards, that its guard cannot be read (`opaque`), that it runs locally, that it is fed by a queue, or
 * that no guard was found in what Drift read, with how much it saw and did not read (`basis`). One function for every
 * view, so an unreadable guard is never worded as an absent one, nor an absence as a fact about the code.
 */
export function guardText(e: { guards: string[]; opaque?: string[]; local?: boolean; kind?: string; basis?: AnswerBasis }): string {
  if (e.guards.length) return e.guards.join(" > ");
  if (e.opaque?.length) return `guard unknown (${e.opaque.join(", ")})`;
  if (e.local) return LOCAL_NOTE;
  return e.kind !== undefined && isQueueKind(e.kind) ? QUEUE_NOTE : noGuardText(e.basis);
}

export function headline(inv: Inventory): SecurityHeadline {
  const clients = new Set(inv.client_leaks.flatMap((g) => g.clients));
  return {
    entryPoints: inv.entry_points.length,
    unguarded: inv.entry_points.filter(isUnguarded).length,
    reaching: inv.entry_points.filter((e) => e.reaches.length > 0).length,
    unguardedReaching: inv.entry_points.filter((e) => isUnguarded(e) && e.reaches.length > 0).length,
    sinks: inv.sinks.length,
    leakGroups: inv.client_leaks.length,
    leakClients: clients.size,
    envVars: Object.keys(inv.env).length,
  };
}

export const SINK_LABELS: Record<string, string> = {
  eval: "eval()",
  shell_exec: "Shell commands",
  raw_html: "Raw HTML",
  raw_sql: "Raw SQL",
  sql_string_interpolation: "SQL built by interpolation",
  dynamic_redirect: "Redirect to computed URL",
  dynamic_fetch: "Request to computed URL",
  weak_hash: "MD5 / SHA-1",
  jwt_decode_without_verify: "jwt.decode() without verify",
  cookie_without_httponly: "Cookie without httpOnly",
  cors_any_origin: "CORS for any origin",
  unsafe_deserialize: "Unsafe deserialisation",
  path_traversal: "File at a path built from a value",
  template_injection: "Template built from a value",
  nosql_injection: "MongoDB $where built from a value",
  xml_external_entities: "XML external entities resolved",
  hardcoded_secret: "Signing secret written in the code",
  debug_enabled: "Server started in debug mode",
  tls_verify_disabled: "TLS certificate not verified",
  mass_assignment: "Row written from the whole request body",
  dynamic_regex: "Regular expression built from a value",
};

export const sinkLabel = (k: string) => SINK_LABELS[k] ?? k;

export function sinksByKind(sinks: SinkUse[]): { kind: string; items: SinkUse[] }[] {
  const m = new Map<string, SinkUse[]>();
  for (const s of sinks) m.set(s.kind, [...(m.get(s.kind) ?? []), s]);
  return [...m].map(([kind, items]) => ({ kind, items })).sort((a, b) => b.items.length - a.items.length || a.kind.localeCompare(b.kind));
}

export interface EntryFilter {
  q: string;
  kind: string | null;
  unguardedOnly: boolean;
  reachingOnly: boolean;
  sink: string | null;
}

export function filterEntries(rows: EntryRow[], f: EntryFilter): EntryRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    (e) =>
      (!f.kind || e.kind === f.kind) &&
      (!f.unguardedOnly || isUnguarded(e)) &&
      (!f.reachingOnly || e.reaches.length > 0) &&
      (!f.sink || e.reaches.some((r) => r.kind === f.sink)) &&
      (!q ||
        e.path.toLowerCase().includes(q) ||
        (e.route ?? "").toLowerCase().includes(q) ||
        e.guards.some((g) => g.toLowerCase().includes(q)) ||
        (e.wrappers ?? []).some((w) => w.toLowerCase().includes(q))),
  );
}

/** Entry points reaching sinks first, unguarded before guarded, then by path. */
export function sortEntries(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort(
    (a, b) =>
      b.reaches.length - a.reaches.length ||
      Number(!isUnguarded(a)) - Number(!isUnguarded(b)) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  );
}

/** A reach chain (`path#symbol` hops) as nodes and edges for the small chain graph. */
export function chainGraph(entry: EntryRow): { nodes: { id: string; label: string; path: string; sinks: string[] }[]; edges: { source: string; target: string }[] } {
  const nodes = new Map<string, { id: string; label: string; path: string; sinks: string[] }>();
  const edges = new Map<string, { source: string; target: string }>();
  for (const r of entry.reaches) {
    r.via.forEach((hop, i) => {
      const [path, symbol = ""] = splitHop(hop);
      const n = nodes.get(hop) ?? { id: hop, label: symbol || path, path, sinks: [] };
      if (i === r.via.length - 1 && !n.sinks.includes(r.kind)) n.sinks.push(r.kind);
      nodes.set(hop, n);
      if (i > 0) {
        const k = `${r.via[i - 1]}>${hop}`;
        edges.set(k, { source: r.via[i - 1], target: hop });
      }
    });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function splitHop(h: string): [string, string] {
  const i = h.lastIndexOf("#");
  return i < 0 ? [h, ""] : [h.slice(0, i), h.slice(i + 1)];
}

/** Where a guard comes from: the code itself, configuration (` (settings)`) or an app-wide hook (` (app hook)`). */
export type GuardOrigin = "code" | "settings" | "app hook";

export function parseGuard(g: string): { name: string; origin: GuardOrigin } {
  if (g.endsWith(" (settings)")) return { name: g.slice(0, -" (settings)".length), origin: "settings" };
  if (g.endsWith(" (app hook)")) return { name: g.slice(0, -" (app hook)".length), origin: "app hook" };
  return { name: g, origin: "code" };
}

/** How an entry point is protected, in one vocabulary. */
export type Posture = "guarded" | "settings" | "app-hook" | "authenticated" | "open" | "unknown" | "local" | "queue" | "unguarded";

export const POSTURE: Record<Posture, { tone: "success" | "info" | "neutral" | "warning" | "danger"; icon: "ok" | "info" | "dot" | "attention" | "blocked" | "shield"; label: string; hint: string }> = {
  guarded: { tone: "success", icon: "shield", label: "guarded in code", hint: "a wrapper or decorator on the entry point" },
  settings: { tone: "success", icon: "shield", label: "guarded by settings", hint: "a guard applied by configuration, such as a default permission" },
  "app-hook": { tone: "info", icon: "info", label: "app hooks only", hint: "only hooks the whole app runs; check they reject" },
  authenticated: { tone: "warning", icon: "attention", label: "identified", hint: "identifies the caller and turns no one away: no guard (the practice map's identified)" },
  open: { tone: "warning", icon: "attention", label: "opened to anyone", hint: "explicitly opened (AllowAny, login_not_required)" },
  unknown: { tone: "info", icon: "info", label: "guard unknown", hint: "something on it may be a guard and Drift cannot read it (a wrapper it does not hold, or a body call that looks like a guard and is not proven to reject): counted neither as guarded nor as unguarded" },
  local: { tone: "neutral", icon: "dot", label: "runs locally", hint: "a command started on the machine (cli): no remote caller reaches it, so it is not counted as unguarded" },
  queue: { tone: "neutral", icon: "dot", label: "fed by a queue", hint: "a message consumer: no caller signs in, so it is not counted as unguarded" },
  unguarded: { tone: "danger", icon: "blocked", label: "no guard found", hint: "no guard found in what Drift read: something it does not know may still guard it, and its basis lists what it saw and did not read" },
};

export function postureOf(e: EntryRow): Posture {
  if ((e.opens?.length ?? 0) > 0) return "open";
  const origins = e.guards.map((g) => parseGuard(g).origin);
  if (origins.includes("code")) return "guarded";
  if (origins.includes("settings")) return "settings";
  if (origins.includes("app hook")) return "app-hook";
  if ((e.authenticates?.length ?? 0) > 0) return "authenticated";
  if ((e.opaque?.length ?? 0) > 0) return "unknown";
  if (e.local) return "local";
  return isQueueKind(e.kind) ? "queue" : "unguarded";
}

/** Postures this inventory can express: the newer ones only when drift emits their fields. */
export function posturesIn(inv: Inventory): Posture[] {
  const es = inv.entry_points;
  const has = (p: (e: EntryRow) => boolean) => es.some(p);
  const out: Posture[] = ["guarded"];
  if (has((e) => e.guards.some((g) => parseGuard(g).origin === "settings"))) out.push("settings");
  if (has((e) => e.guards.some((g) => parseGuard(g).origin === "app hook"))) out.push("app-hook");
  if (has((e) => "authenticates" in e)) out.push("authenticated");
  if (has((e) => "opens" in e)) out.push("open");
  if (has((e) => !!e.opaque?.length)) out.push("unknown");
  if (has((e) => !!e.local)) out.push("local");
  if (has((e) => isQueueKind(e.kind))) out.push("queue");
  out.push("unguarded");
  return out;
}

// ---------- exposure, places, and what a change introduces (#167) ----------

export const EXPOSURE_LABEL: Record<Exposure, string> = { public: "internet-facing", internal: "internal in what Drift read", unknown: "exposure unknown" };

/**
 * Where an entry point is reachable from, with what says so (security.rs `EntryRow::exposure_text`): an internal one
 * says what Drift read and what it did not (`exposure_basis`). `null` when nothing in the repository speaks for it.
 */
export function exposureText(e: Pick<EntryRow, "exposure" | "boundary" | "exposure_basis">): string | null {
  if (!e.boundary) return null;
  if (e.exposure === "internal") return internalText(e.boundary, e.exposure_basis);
  return `${EXPOSURE_LABEL[e.exposure ?? "unknown"]} (${e.boundary})`;
}

/** A guard gap's place as Drift names it: `dir/`, `package P` for the whole package, or the repository. */
export function placeOf(pkg: string, dir: string): string {
  return dir ? `${dir}/` : pkg ? `package ${pkg}` : "the repository";
}

/**
 * What `drift security` does not cover, as it prints it after a diff (security.rs `NOT_COVERED`; a unit test keeps
 * the two equal).
 */
export const NOT_COVERED =
  "Not covered: checks inside handler bodies other than sign-in checks (a 401, a sign-in redirect, a call of a proven guard), whether the caller may act on the record it asks for, rate limits, and anything applied outside this repository (gateways, proxies, platform settings). A shared guard is what this repository does, not a verdict on its exceptions.";

/** Counts per section of `drift security --diff-base`, as its `--github` line counts them (leak groups, not clients). */
export function diffCounts(d: SecurityDiff) {
  const c = { guardGaps: d.guard_gaps.length, unguardedReaching: d.unguarded_reaching.length, sinks: d.sinks.length, leaks: d.leaks.length, nowPublic: d.now_public.length };
  return { ...c, total: c.guardGaps + c.unguardedReaching + c.sinks + c.leaks + c.nowPublic };
}

// ---------- one file, as `drift card <path>` prints it (crates/drift-mine/src/card.rs) ----------

/** Smallest role Drift mines (crates/drift-mine/src/mine.rs `MIN_ROLE_SIZE`): the siblings `drift card` reports need as many. */
export const MIN_ROLE_SIZE = 8;
const APP_HOOK = " (app hook)";

/** The directories a file's roles are limited to, broadest first: "" (the whole package), then each directory down to the file's own (security.rs `role_dirs`). */
export function roleDirs(pkg: string, path: string): string[] {
  const dirs = [""];
  const rel = (path.startsWith(pkg) ? path.slice(pkg.length) : path).replace(/^\/+/, "");
  const i = rel.lastIndexOf("/");
  if (i < 0) return dirs;
  let acc = pkg.replace(/\/+$/, "");
  for (const seg of rel.slice(0, i).split("/")) {
    if (acc) acc += "/";
    acc += seg;
    dirs.push(acc);
  }
  return dirs;
}

/** The exposure the boundary gives a path: the rule with the longest directory containing it (security.rs `Boundaries::of`). */
export function exposureOf(b: Boundaries, path: string): { exposure: Exposure; source: string | null } {
  let best: Boundaries["rules"][number] | null = null;
  for (const r of b.rules) if ((!r.dir || path === r.dir || path.startsWith(`${r.dir}/`)) && (!best || r.dir.length > best.dir.length)) best = r;
  return best ? { exposure: best.exposure, source: best.source } : { exposure: "unknown", source: null };
}

/**
 * What a card's Siblings line says of a kind none of whose members has a guard (card.rs): that it runs locally, that a
 * queue feeds it, or that none has a guard.
 */
export const siblingsWithoutGuard = (s: { kind: string; local?: true }): string => (s.local ? LOCAL_NOTE : isQueueKind(s.kind) ? QUEUE_NOTE : "none has a guard");

/** What the entry points of one kind around a file carry: the narrowest place with at least `MIN_ROLE_SIZE` of them. */
export type SiblingShare =
  | { kind: string; tooFew: true }
  | {
      kind: string;
      tooFew: false;
      where: string;
      members: number;
      shares: { guard: string; n: number }[];
      copy: EntryRow | null;
      /** Every member is `local` (no remote caller reaches the kind): "none has a guard" says nothing of it. */
      local?: true;
    };

export interface FileCard {
  entries: EntryRow[];
  /** Risky operations written in the file. */
  sinks: SinkUse[];
  /** Environment variables the file reads (the inventory's `env`). */
  reads: string[];
  /** For a client file: the server-only modules or secrets it reaches. */
  leaks: string[];
  siblings: SiblingShare[];
  /** What is not known about the file, as `drift card` says it (always ends with what no static fact covers). */
  unknown: string[];
}

/**
 * `drift card <path>` from the inventory and the file's facts: entry points with guards and exposure, risky operations,
 * env reads and leaks, the siblings of each kind with one to copy from, and what is not known. Mirrors card.rs (the
 * conventions covering the file are not here: no JSON output lists a rule's holders).
 */
export function fileCard(inv: Inventory, file: Pick<FileFacts, "path" | "package" | "imports">): FileCard {
  const rel = file.path;
  const pkg = file.package;
  const entries = inv.entry_points.filter((e) => e.path === rel);
  const sameKind = (e: EntryRow) => (e.package ?? "") === pkg;
  const dirs = roleDirs(pkg, rel);
  const kinds = [...new Set((entries.length ? entries : inv.entry_points.filter((e) => sameKind(e) && roleDirs(pkg, e.path).some((d) => dirs.includes(d)))).map((e) => e.kind))].sort();
  const siblings: SiblingShare[] = kinds.map((kind) => {
    let found: { dir: string; members: EntryRow[] } | null = null;
    for (const d of [...dirs].reverse()) {
      const members = inv.entry_points.filter((e) => sameKind(e) && e.kind === kind && (!d || roleDirs(e.package ?? "", e.path).includes(d)));
      if (members.length >= MIN_ROLE_SIZE) {
        found = { dir: d, members };
        break;
      }
    }
    if (!found) return { kind, tooFew: true };
    const counts = new Map<string, number>();
    for (const m of found.members) for (const g of new Set(m.guards.filter((g) => !g.endsWith(APP_HOOK)))) counts.set(g, (counts.get(g) ?? 0) + 1);
    const shares = [...counts].map(([guard, n]) => ({ guard, n })).sort((a, b) => b.n - a.n || (a.guard < b.guard ? -1 : a.guard > b.guard ? 1 : 0));
    const top = shares[0]?.guard;
    const copy = top ? (found.members.find((m) => m.path !== rel && m.guards.includes(top)) ?? null) : null;
    return { kind, tooFew: false, where: placeOf(pkg, found.dir), members: found.members.length, shares, copy, ...(found.members.every((m) => m.local) ? { local: true as const } : {}) };
  });
  const unknown: string[] = [];
  // Files not parsed for lack of stack (card.rs reads the same list from the facts).
  if (inv.unchecked?.includes(rel)) unknown.push("what this file declares (not parsed)");
  const unresolved = file.imports.flatMap((i) => (i.module.startsWith("unresolved:") ? [i.module.slice("unresolved:".length)] : []));
  if (unresolved.length) unknown.push(`${unresolved.length} import(s) unresolved (${unresolved.slice(0, 3).join(", ")}${unresolved.length > 3 ? ", ..." : ""}), so what they reach is not followed`);
  // Older drift reports no exposure at all: say nothing rather than "unknown" for every file. Otherwise each reason
  // exposure is unknown here, once (card.rs): what the boundary says of an entry point (a gateway that may route it),
  // or that nothing covers the path.
  if (inv.boundaries) {
    const of = exposureOf(inv.boundaries, rel);
    const reasons: (string | null)[] = entries.length ? entries.filter((e) => (e.exposure ?? "unknown") === "unknown").map((e) => e.boundary ?? null) : of.exposure === "unknown" ? [of.source] : [];
    const said = [...new Set(reasons)].sort((a, b) => (a === null ? -1 : b === null ? 1 : a < b ? -1 : a > b ? 1 : 0));
    for (const why of said) unknown.push(why === null ? "exposure (no compose service or `security:` setting in .drift/config.yaml covers this path)" : `exposure (${why})`);
  }
  unknown.push("checks inside handler bodies other than sign-in checks, and anything applied outside this repository");
  return {
    entries,
    sinks: inv.sinks.filter((s) => s.path === rel),
    reads: Object.entries(inv.env)
      .filter(([, files]) => files.includes(rel))
      .map(([name]) => name)
      .sort(),
    leaks: inv.client_leaks.filter((g) => g.clients.includes(rel)).map((g) => g.reaches),
    siblings,
    unknown,
  };
}
