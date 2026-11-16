// Reading two of Drift's JSON documents field by field, where a view needs every row whole: `drift census --why
// --json` (crates/drift-mine/src/funnel.rs `why_json`) and `drift practices promote --list --json` (crates/drift-cli/src/
// promote.rs `list`). The IPC envelope checks only their top level. Every field a newer Drift added is optional here,
// as an older Drift does not send it: a row without it reads as before. A row that is not what Drift writes is left
// out rather than guessed at.
import type { CensusWhy, FunnelDropped, FunnelGate, FunnelStage, PracticeExample, PracticeUnknownReason, PromoteCandidate, PromoteList, PromoteListItem, PromotePlace, PromoteUnknownCause, PromoteWay } from "./drift";
import { FUNNEL_STAGES } from "./drift";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// ---------- drift census --why --json ----------

function readGate(v: unknown): FunnelGate | null {
  if (!isObj(v)) return null;
  const name = str(v.name);
  const dropped = count(v.dropped);
  if (name === null || dropped === null) return null;
  return { name, constant: str(v.constant) ?? "", passes: str(v.passes) ?? "", origin: str(v.origin) ?? "", source: str(v.source) ?? "", dropped };
}

function readDropped(v: unknown): FunnelDropped | null {
  if (!isObj(v)) return null;
  const gate = str(v.gate);
  const id = str(v.id);
  const holders = count(v.holders);
  const members = count(v.members);
  if (gate === null || id === null || holders === null || members === null) return null;
  return {
    gate,
    id,
    role: str(v.role) ?? "",
    rule: str(v.rule) ?? "",
    family: str(v.family) ?? "",
    lang: v.lang === "py" ? "py" : "ts",
    holders,
    members,
    value: numOrNull(v.value),
    threshold: numOrNull(v.threshold),
    detail: str(v.detail) ?? "",
    target: str(v.target) ?? "none",
    default_tier: v.default_tier === true,
  };
}

/** `drift census --why --json`, row by row: gates and dropped candidates as Drift wrote them, in its order. */
export function readCensusWhy(raw: unknown): CensusWhy {
  const d = isObj(raw) ? raw : {};
  const reached: Partial<Record<FunnelStage, number>> = {};
  const r = isObj(d.reached) ? d.reached : {};
  for (const s of FUNNEL_STAGES) {
    const n = count(r[s]);
    if (n !== null) reached[s] = n;
  }
  return {
    schema: typeof d.schema === "number" ? d.schema : 0,
    observation_only: d.observation_only !== false,
    gate: str(d.gate),
    reached,
    gates: (Array.isArray(d.gates) ? d.gates : []).map(readGate).filter((g): g is FunnelGate => g !== null),
    dropped: (Array.isArray(d.dropped) ? d.dropped : []).map(readDropped).filter((x): x is FunnelDropped => x !== null),
    // How many default-tier drafts mining's caps cut, said by Drift (newer drift): kept only when it is a sentence.
    ...(str(d.cap_note) ? { cap_note: str(d.cap_note) } : {}),
  };
}

// ---------- drift practices promote --list --json ----------

function readWay(v: unknown): PromoteWay | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const members = count(v.members);
  if (id === null || members === null) return null;
  const alternatives = strings(v.alternatives);
  return { id, key: str(v.key) ?? "", label: str(v.label) ?? id, members, ...(alternatives.length ? { alternatives } : {}) };
}

function readExample(v: unknown): PracticeExample | null {
  if (!isObj(v)) return null;
  const path = str(v.path);
  const symbol = str(v.symbol);
  const line = count(v.line);
  return path === null || symbol === null || line === null ? null : { path, symbol, line };
}

const ways = (v: unknown): PromoteWay[] => (Array.isArray(v) ? v.map(readWay).filter((w): w is PromoteWay => w !== null) : []);
const examples = (v: unknown): PracticeExample[] => (Array.isArray(v) ? v.map(readExample).filter((e): e is PracticeExample => e !== null) : []);

/** The one cause outside the units every unknown unit shares (`promote::UnknownCause`), or null. */
export function readUnknownCause(v: unknown): PromoteUnknownCause | null {
  if (!isObj(v)) return null;
  const reason = str(v.reason);
  const instrument = str(v.instrument);
  const units = count(v.units);
  if (reason === null || instrument === null || units === null) return null;
  const hint = str(v.hint);
  return { reason: reason as PracticeUnknownReason, instrument, units, ...(hint !== null ? { hint } : {}) };
}

/** A promote candidate (`promote::Candidate`); the fields a newer Drift adds are kept only when present and set. */
export function readCandidate(v: unknown): PromoteCandidate | null {
  if (!isObj(v)) return null;
  const concern = str(v.concern);
  const follows = count(v.follows);
  const unknown = count(v.unknown);
  const rawPlace = v.place;
  if (concern === null || follows === null || unknown === null || !isObj(rawPlace)) return null;
  const file = str(rawPlace.file);
  const route = str(rawPlace.route);
  const place: PromotePlace = { package: str(rawPlace.package) ?? "", dir: str(rawPlace.dir) ?? "", ...(file !== null ? { file } : {}), ...(route !== null ? { route } : {}) };
  const exceptions = examples(v.exceptions);
  const mechanisms = strings(v.mechanisms);
  const jobs = count(v.jobs);
  const cause = readUnknownCause(v.unknown_cause);
  const unreadRoutes = count(v.unread_routes);
  return {
    concern,
    unit: str(v.unit) ?? "unit",
    place,
    ways: ways(v.ways),
    other_ways: ways(v.other_ways),
    follows,
    exceptions,
    unknown,
    total: count(v.total) ?? follows + exceptions.length + unknown,
    example: readExample(v.example),
    forced: v.forced === true,
    ...(mechanisms.length ? { mechanisms } : {}),
    ...(v.any_enforcing === true ? { any_enforcing: true } : {}),
    ...(v.passive === true ? { passive: true } : {}),
    ...(jobs ? { jobs } : {}),
    ...(cause ? { unknown_cause: cause } : {}),
    ...(unreadRoutes ? { unread_routes: unreadRoutes } : {}),
  };
}

function readItem(v: unknown): PromoteListItem | null {
  if (!isObj(v)) return null;
  const candidate = readCandidate(v.candidate);
  const place = str(v.place);
  if (!candidate || place === null) return null;
  const departures = count(v.departures);
  return { place, command: str(v.command) ?? "", ...(departures !== null ? { departures } : {}), candidate };
}

const items = (v: unknown): PromoteListItem[] => (Array.isArray(v) ? v.map(readItem).filter((x): x is PromoteListItem => x !== null) : []);

/**
 * `drift practices promote --list --json`: the candidates in Drift's order, with how many were declined and which
 * promoted conventions cover others. A newer Drift lists the candidates followed by doing nothing apart (`passive`);
 * they are read into `candidates` after the others, each marked `passive` as Drift marks it, which is how an older
 * Drift listed them, so the view splits them the one way.
 */
export function readPromoteList(raw: unknown): PromoteList {
  const d = isObj(raw) ? raw : {};
  return {
    candidates: [...items(d.candidates), ...items(d.passive).map((x) => (x.candidate.passive ? x : { ...x, candidate: { ...x.candidate, passive: true } }))],
    declined: count(d.declined) ?? 0,
    promoted: strings(d.promoted),
  };
}
