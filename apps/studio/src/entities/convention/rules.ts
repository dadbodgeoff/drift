// Presentation helpers for Drift's rule and reference strings. No analysis:
// these only name and group what Drift already decided.
import type { Rule } from "@/shared/contract/drift";
import ruleKindFamily from "./rule-kind-family.json";

/**
 * The marker Drift writes when a class's base expression names no class (`class X(*BASES)`,
 * or a class defined again with other bases): its ancestry is unknown
 * (crates/drift-core/src/facts.rs `UNKNOWN_BASE_NAME`). Never a real base.
 */
export const UNKNOWN_BASE = "global#(base)";
export const isUnknownBase = (ref: string) => ref === UNKNOWN_BASE;
export const UNKNOWN_BASE_TITLE = "Unknown base: the class's base expression names no class, so Drift does not know what it extends";

/** `apps/web/lib/auth.ts#withWorkspace` -> `withWorkspace`; `pkg:swr#default` -> `swr`; the unknown-base marker -> `unknown base`. */
export function shortRef(ref: string): string {
  if (isUnknownBase(ref)) return "unknown base";
  const i = ref.lastIndexOf("#");
  if (i < 0) return ref;
  const name = ref.slice(i + 1);
  if (name === "default" || name.startsWith("default.") || name.startsWith("default(")) {
    const mod = ref.slice(0, i).replace(/^pkg:/, "");
    return mod.split("/").pop() ?? mod;
  }
  return name;
}

/**
 * A value made by a factory proven to return a function (facts `made_by`, #91): the tag the code drawer shows beside
 * "built on", and why. `apps/web/lib/api.ts#defaultResponderForAppDir` -> `made by defaultResponderForAppDir()`.
 */
export function madeByTag(ref: string): { label: string; title: string } {
  return {
    label: `made by ${shortRef(ref)}()`,
    title: `made by: ${ref}. A function: the value is bound to a call of this factory, which Drift proved returns a function (its declared return type, or every return of its body), so it is read as a function`,
  };
}

/** Split a `path#symbol` key. */
export function splitKey(key: string): { path: string; symbol: string } {
  const i = key.lastIndexOf("#");
  return i < 0 ? { path: key, symbol: "" } : { path: key.slice(0, i), symbol: key.slice(i + 1) };
}

/**
 * The rule families of the precision study (docs/v2/STUDY-2026-11-05.md,
 * "By rule kind"). Layering is internal import avoidance.
 */
export type RuleFamily =
  | "Call wrappers"
  | "Base classes"
  | "Decorators"
  | "Layout wrappers"
  | "Try bodies"
  | "Argument keys"
  | "Layering"
  | "Other avoidance"
  | "Rendered components"
  | "Calls"
  | "Naming"
  | "Call order"
  | "Thrown classes"
  | "Directives"
  | "Control flow"
  | "Tests"
  | "Libraries"
  | "Models"
  | "Packages"
  | "Dependency versions"
  | "Guards"
  | "Wiring"
  | "Import sources"
  | "Other";

const WRAP_FAMILY: Record<string, RuleFamily> = {
  call: "Call wrappers",
  extends: "Base classes",
  decorator: "Decorators",
  jsx: "Layout wrappers",
  try: "Try bodies",
  // Guards applied by configuration, app-wide hooks or authentication-only markers (Python adapters).
  config: "Guards",
  authenticates: "Guards",
  config_authenticates: "Guards",
  opens: "Guards",
  app_hook: "Guards",
};

export function ruleFamily(rule: Rule): RuleFamily {
  switch (rule.type) {
    case "wrapped_by":
      return WRAP_FAMILY[rule.kind] ?? "Other";
    case "passes_key":
      return "Argument keys";
    case "avoids":
      return isLayering(rule.signal) ? "Layering" : "Other avoidance";
    case "renders":
      return "Rendered components";
    case "calls":
      return "Calls";
    case "named":
      return "Naming";
    case "before":
      return "Call order";
    case "throws":
      return "Thrown classes";
    case "directive":
      return "Directives";
    case "control":
      return "Control flow";
    case "has_test":
      return "Tests";
    case "prefers_library":
      return "Libraries";
    case "model_has":
      return "Models";
    case "package_has":
      return "Packages";
    case "dependency_version":
      return "Dependency versions";
    case "registered_in":
    case "mirrors_keys":
      return "Wiring";
    case "imports_from":
      return "Import sources";
    default:
      // A rule kind newer than this Studio: shown as data (CI fails until it is handled).
      return "Other";
  }
}

/**
 * Every structured rule kind Drift emits (`tier::rule_kind` in crates/drift-mine/src/tier.rs,
 * `rule_kind` in census --json), mapped to the family the Studio shows it under. A test
 * (tests/unit/coverage.test.ts) fails when Drift has a kind this table lacks. The table is
 * data (`rule-kind-family.json`): Drift reads the same file (crates/drift-mine/src/rank.rs
 * `family`), so there is one family mapping.
 */
export const RULE_KIND_FAMILY = ruleKindFamily as Record<string, RuleFamily>;

/**
 * Where a reference is taken from, for people, as Drift words it (`source_module` in
 * crates/drift-mine/src/mine.rs, which `imports_from` summaries use): `pkg:python:typing#TypedDict`
 * -> `typing`, `pkg:django#forms.ChoiceField` -> `django.forms`, an in-repo
 * `app/forms/fields.py#ChoiceField` -> that file.
 */
export function sourceModule(ref: string): string {
  const i = ref.indexOf("#");
  if (i < 0) return ref;
  const module = ref.slice(0, i);
  const name = ref.slice(i + 1);
  if (!module.startsWith("pkg:")) return module;
  const pkg = module.slice("pkg:".length).replace(/^python:/, "");
  const dot = name.lastIndexOf(".");
  return dot < 0 ? pkg : `${pkg}.${name.slice(0, dot)}`;
}

/** An import-source rule in words: "imports `TypedDict` from typing_extensions (not typing)"; null for other kinds. */
export function importSource(rule: Rule): { name: string; from: string; not: string[] } | null {
  return rule.type === "imports_from" ? { name: rule.name, from: sourceModule(rule.source), not: (rule.instead_of ?? []).map(sourceModule) } : null;
}

/** `import:<area>` signals (not `import:pkg:`) are layering rules. */
export function isLayering(signal: string): boolean {
  return signal.startsWith("import:") && !signal.startsWith("import:pkg:");
}

/** The area a layering rule forbids importing (`packages/features`), or null. */
export function layeringTarget(rule: Rule): string | null {
  return rule.type === "avoids" && isLayering(rule.signal) ? rule.signal.slice("import:".length) : null;
}

/** Short labels of what a rule names, for chips. */
export function ruleTargets(rule: Rule): string[] {
  switch (rule.type) {
    case "wrapped_by":
      return rule.any_of.map(shortRef);
    case "passes_key":
      return [`${shortRef(rule.callee)}({ ${rule.key} })`];
    case "calls":
      return [shortRef(rule.callee)];
    case "renders":
      return [`<${shortRef(rule.component)}>`];
    case "throws":
      return [shortRef(rule.class)];
    case "before":
      return [shortRef(rule.first), shortRef(rule.then)];
    case "avoids":
      return [rule.signal];
    case "named":
      return [rule.pattern];
    case "directive":
    case "control":
      return [rule.value];
    case "prefers_library":
      return [rule.preferred];
    case "model_has":
      return [rule.field];
    case "package_has":
      return [rule.item];
    case "dependency_version":
      return [rule.range ? `${rule.name}@${rule.range}` : `${rule.name} (the range most packages use)`];
    case "registered_in":
      return [`registered in ${rule.path || "a list of its kind"}`, ...(rule.named ? [`names ${rule.named}`] : [])];
    case "mirrors_keys":
      return [`keys of ${rule.from} also in ${rule.to}`];
    case "imports_from": {
      const s = importSource(rule)!;
      return [`imports ${s.name} from ${s.from}${s.not.length ? ` (not ${s.not.join(" or ")})` : ""}`];
    }
    case "has_test":
      return [];
    default:
      return [];
  }
}
