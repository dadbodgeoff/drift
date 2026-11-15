// Indexing and summarising `drift scan` facts for display.
import type { FactSymbol, FileFacts, RepoFacts } from "@/shared/contract/drift";

export interface FactsIndex {
  facts: RepoFacts;
  byPath: Map<string, FileFacts>;
}

export function indexFacts(facts: RepoFacts): FactsIndex {
  return { facts, byPath: new Map(facts.files.map((f) => [f.path, f])) };
}

export function findSymbol(ix: FactsIndex, path: string, symbol: string): FactSymbol | undefined {
  const f = ix.byPath.get(path);
  if (!f) return undefined;
  return f.symbols.find((s) => s.name === symbol) ?? f.symbols.find((s) => s.exported_as.includes(symbol));
}

/** Line of `path#symbol`, or 1 for file-level units such as `(file)`. */
export function symbolLine(ix: FactsIndex, path: string, symbol: string): number {
  return findSymbol(ix, path, symbol)?.line ?? 1;
}

export interface Overview {
  files: number;
  packages: { path: string; name: string; files: number }[];
  symbols: number;
  entryPoints: { adapter: string; kind: string; count: number }[];
  entryPointTotal: number;
  parseErrors: string[];
  /** Files Drift did not analyse, by reason, worst first (`too_deep`, `too_costly`, `stack_unavailable` and `flow_syntax` lead: they fail closed). */
  skipped: { reason: string; count: number; paths: string[] }[];
  imports: { total: number; internal: number; external: number; unresolved: number };
  models: number;
  clientFiles: number;
  testedFiles: number;
  languages: { lang: string; count: number }[];
}

export function overview(facts: RepoFacts): Overview {
  const pk = new Map<string, number>();
  const ep = new Map<string, { adapter: string; kind: string; count: number }>();
  const langs = new Map<string, number>();
  let symbols = 0;
  let entryPointTotal = 0;
  let internal = 0;
  let external = 0;
  let unresolved = 0;
  let total = 0;
  let clientFiles = 0;
  let testedFiles = 0;
  const parseErrors: string[] = [];
  for (const f of facts.files) {
    pk.set(f.package, (pk.get(f.package) ?? 0) + 1);
    langs.set(f.lang, (langs.get(f.lang) ?? 0) + 1);
    symbols += f.symbols.length;
    if (!f.parse_ok) parseErrors.push(f.path);
    if (f.directives.includes("use client")) clientFiles++;
    if (f.has_test) testedFiles++;
    for (const e of f.entry_points) {
      const k = `${e.adapter}\u0000${e.kind}`;
      const row = ep.get(k) ?? { adapter: e.adapter, kind: e.kind, count: 0 };
      row.count++;
      ep.set(k, row);
      entryPointTotal++;
    }
    for (const i of f.imports) {
      total++;
      if (i.module.startsWith("unresolved:")) unresolved++;
      else if (i.module.includes(":")) external++;
      else internal++;
    }
  }
  const names = new Map((facts.packages ?? []).map((p) => [p.path, p.name]));
  const skipped = new Map<string, string[]>();
  for (const s of facts.skipped) skipped.set(s.reason, [...(skipped.get(s.reason) ?? []), s.path]);
  return {
    files: facts.files.length,
    packages: [...pk]
      .map(([path, files]) => ({ path, name: names.get(path) ?? (path || "(root)"), files }))
      .sort((a, b) => b.files - a.files || a.path.localeCompare(b.path)),
    symbols,
    entryPoints: [...ep.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    entryPointTotal,
    parseErrors: parseErrors.sort(),
    skipped: [...skipped]
      .map(([reason, paths]) => ({ reason, count: paths.length, paths: paths.sort().slice(0, 50) }))
      .sort((a, b) => (SKIP_REASON[b.reason]?.weight ?? 0) - (SKIP_REASON[a.reason]?.weight ?? 0) || b.count - a.count || a.reason.localeCompare(b.reason)),
    imports: { total, internal, external, unresolved },
    models: facts.models?.length ?? 0,
    clientFiles,
    testedFiles,
    languages: [...langs].map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count),
  };
}

/** Files whose path contains `q` (case-insensitive), shortest first; for the command palette. */
export function searchFiles(ix: FactsIndex, q: string, limit = 50): string[] {
  const needle = q.toLowerCase();
  const out: string[] = [];
  for (const p of ix.byPath.keys()) if (p.toLowerCase().includes(needle)) out.push(p);
  return out.sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, limit);
}

/** Skip reasons for files Drift could have analysed but did not, to be safe: no facts and no rules checked in them. */
export function failsClosed(reason: string): boolean {
  return reason === "too_deep" || reason === "too_costly" || reason === "stack_unavailable" || reason === "flow_syntax";
}

/** Why Drift skipped a file (`skipped[].reason` in drift scan, crates/drift-core/src/facts.rs `SkipReason`). */
export const SKIP_REASON: Record<string, { label: string; why: string; weight: number }> = {
  too_deep: { label: "too deeply nested", why: "Nesting beyond Drift's limit would overflow the parser, so Drift skips the file and fails closed: no facts, no rules checked in it.", weight: 3 },
  too_costly: { label: "too costly to parse", why: "Syntax that makes the parser re-read large spans of the file (such as deeply nested generic calls or comparisons) would take far more memory than the file's size, so Drift skips the file and fails closed: no facts, no rules checked in it.", weight: 3 },
  stack_unavailable: { label: "not parsed for lack of memory", why: "The scan could not reserve a stack large enough to parse this file safely (an address-space or memory limit on that run), so it skipped the file and failed closed: no facts, no rules checked in it. A scan with more memory parses it.", weight: 3 },
  flow_syntax: { label: "Flow type syntax", why: "A JavaScript file with Flow type annotations that Drift cannot read, or cannot remove with certainty to leave plain JavaScript (Flow-only syntax such as exact objects `{| |}`, `opaque type`, `%checks` or `*`), so Drift skips the file and fails closed: no facts, no rules checked in it. Annotations TypeScript shares are removed and the file is analysed.", weight: 3 },
  not_utf8: { label: "not UTF-8", why: "Not valid UTF-8 text, so it cannot be parsed.", weight: 2 },
  too_large: { label: "too large", why: "Larger than Drift's per-file limit.", weight: 1 },
  generated: { label: "generated", why: "Marked or recognised as generated code: conventions are learned from code people write.", weight: 0 },
  minified: { label: "minified", why: "Minified bundles are not source.", weight: 0 },
  declaration: { label: "declarations", why: "Type declaration files (.d.ts) declare, they do not implement.", weight: 0 },
};

/**
 * What a handler does with request input, as Drift's facts say (schema 5): `reads` (a tRPC
 * `input`, a parsed body, query or path parameters), `none` (provably reads none: no parameter,
 * or only `{ ctx }`), or `unknown` (neither fact: it may or may not).
 */
export type InputFact = "reads" | "none" | "unknown";

export function inputOf(s: Pick<FactSymbol, "controls">): InputFact {
  if (s.controls?.includes("reads_input")) return "reads";
  if (s.controls?.includes("no_input")) return "none";
  return "unknown";
}

export const INPUT_LABEL: Record<InputFact, { label: string; why: string }> = {
  reads: { label: "reads request input", why: "Drift saw it read request input (an input object, a parsed body, query or path parameters)" },
  none: { label: "reads no input", why: "Drift saw that it takes no request input (no parameter, or only context)" },
  unknown: { label: "input unknown", why: "Drift could not tell whether it reads request input" },
};

/**
 * How a wrapper treats its caller (#60, `controls` `rejects_caller` and `after_continuation`):
 * whether its body turns a caller away (401, 403 with a user or session read, a sign-in redirect)
 * before it hands control on, and which callees it calls only after it hands control on (to
 * `next()`, the wrapped handler) or on what that hands back. Drift reads a guard only into the first.
 */
export const GUARD_FACT = {
  rejects: { label: "rejects the caller", why: "Its body turns a caller away as not signed in or not allowed before it hands control on (a 401, a 403 beside a user, session or permission read, a sign-in redirect): what makes a wrapper a guard." },
  after: { label: "after handing on", why: "Called only after the body hands control on to its continuation (next(), the wrapped handler) or on what that hands back: it acts on the result, not on the caller, so Drift reads no guard into it." },
  raisedAfter: { label: "after handing on", why: "Raised only after the body hands control on to its continuation (the wrapped view or handler, call_next, next(), a dependency's yield) or around what that hands back (except AuthError: raise PermissionDenied): it maps the result or error, not the caller, so Drift reads no guard into it." },
} as const;

export function rejectsCaller(s: Pick<FactSymbol, "controls">): boolean {
  return !!s.controls?.includes("rejects_caller");
}

/**
 * What a symbol's `traits` mean (`Symbol.traits` in drift scan, crates/drift-core/src/facts.rs
 * `pub mod traits`). Kinds of class keep a class out of the roles of primary classes; the
 * purpose facts (`subclassed`, `test_helper`, #35) are facts only: no role or rule reads them.
 * A trait newer than this table is shown as Drift spells it (tests/unit/coverage.test.ts fails).
 */
export const SYMBOL_TRAIT: Record<string, { label: string; why: string; purpose?: true }> = {
  enum: { label: "enum", why: "An enumeration (Enum, Django TextChoices): kept out of the roles of primary classes." },
  namedtuple: { label: "NamedTuple", why: "A NamedTuple: kept out of the roles of primary classes." },
  typeddict: { label: "TypedDict", why: "A TypedDict: kept out of the roles of primary classes." },
  dataclass: { label: "dataclass", why: "A dataclass: kept out of the roles of primary classes." },
  protocol: { label: "Protocol", why: "A Protocol: kept out of the roles of primary classes." },
  abstract: { label: "abstract", why: "Declares abstract methods, derives from ABC, or is an abstract model." },
  declared_abstract: { label: "declared abstract", why: "A TypeScript `abstract class`: never registered itself, so wiring rules leave it out. Ordinary roles keep it, as they did before TypeScript recorded it." },
  base: { label: "base", why: "A base or mixin the repository builds on." },
  view: { label: "view", why: "A view class: its handler methods are the entry points." },
  type_var: { label: "type variable", why: "A type variable (T = TypeVar(\"T\")): a generic parameter, not a value." },
  subclassed: { label: "subclassed", why: "At least one production class of the repository extends it (subclasses in test code and test helpers do not count). A purpose fact: no rule depends on it.", purpose: true },
  test_helper: {
    label: "test helper",
    why: "Exists for tests: named for a test double (Fake…, Mock…, Stub…, Dummy…) or defined in a test-support module (fakes.py, factories.py, testutils.py). A purpose fact: no rule depends on it.",
    purpose: true,
  },
  lineage_view: { label: "view lineage", why: "Built, directly or through the repository's own classes, on a framework view (Django View, DRF APIView/ViewSet, Flask MethodView): a kind of class with roles of its own." },
  lineage_serializer: { label: "serializer", why: "Built, directly or through the repository's own classes, on a Django REST framework serializer: serializers form roles of their own, apart from the fields, permissions and helpers beside them." },
  lineage_model: { label: "model", why: "Built, directly or through the repository's own classes, on a Django model: model classes form roles of their own, apart from the managers and helpers beside them." },
  lineage_form: { label: "form", why: "Built, directly or through the repository's own classes, on a Django or WTForms form: forms form roles of their own, apart from the fields and helpers beside them." },
  lineage_admin: { label: "admin", why: "Built, directly or through the repository's own classes, on a Django model admin (ModelAdmin): model admins form roles of their own, apart from the inlines beside them." },
  lineage_inline: { label: "admin inline", why: "Built, directly or through the repository's own classes, on a Django admin inline (TabularInline, StackedInline): inlines form roles of their own, apart from the model admins that hold them." },
  lineage_mixin: { label: "mixin", why: "Named *Mixin, or built only on mixins: mixins form roles of their own." },
  lineage_exception: { label: "exception", why: "Built, directly or through the repository's own classes, on a Python or framework exception: exceptions form roles of their own." },
  forwards: { label: "forwards", why: "A function that passes one of its own parameters (an argument, *args or **kwargs) on to a call of its own name: a thin wrapper of that call, which is what makes it a team version of a library function." },
  schema_value: { label: "schema value", why: "A value a schema library builds (z.object(...), yup.string(), callbacks such as .refine(fn) included), or a chain on such a value of the same file. A naming rule over schemas leaves plain values out (TypeScript)." },
  plain_value: { label: "plain value", why: "A value built from literals and built-ins only: an object, array or primitive literal, or plain data such as Object.keys(...). Not a schema to rename under a naming rule over schema values (TypeScript)." },
};

/** A trait's label and meaning; an unknown trait reads as Drift spells it. */
export function symbolTrait(t: string): { label: string; why: string; purpose?: true } {
  return SYMBOL_TRAIT[t] ?? { label: t, why: `Drift's trait "${t}"` };
}
