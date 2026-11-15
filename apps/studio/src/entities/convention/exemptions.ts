// What each exemption code means (census and check `exempt[].code`,
// crates/drift-mine/src/mine.rs `Exempted::new`). The reason text stays Drift's own
// and is shown as given; the code only names the kind, so a reviewer can see at a
// glance which of Drift's exemption paths took a member out of a rule.
import type { Exempt, ExemptionCode } from "@/shared/contract/drift";

export interface ExemptionKind {
  /** A short name for the kind, for a tag. */
  label: string;
  /** What Drift decided and why that is not an outlier, for a tooltip. */
  why: string;
}

/**
 * Every exemption code Drift writes. tests/unit/coverage.test.ts reads mine.rs and fails
 * when Drift gains a code that is not here, or loses one that is.
 */
export const EXEMPTION_CODE: Record<ExemptionCode, ExemptionKind> = {
  another_kind: { label: "another kind of class", why: "Its base or decorator says it is another kind of class than the ones the rule is about (#45, F3)." },
  defining_module: { label: "defines the target", why: "It sits in the module that defines the rule's target, which cannot use the target the way its users do (#45, F4)." },
  enum: { label: "enum of other values", why: "An enum whose values are of another type than the base's: not one of the base's members (#45)." },
  named_for_base: { label: "named for its base", why: "A class named for the kind of its own base (ConfigValueField on Field): another kind than the rule's (#45)." },
  does_not_call: { label: "does not call it", why: "The rule is about passing a key to a callee this member never calls (#27)." },
  does_not_use: { label: "does not use it", why: "The rule is about where a name is imported from, and this member does not use the name (#35)." },
  defines_alternative: { label: "defines its own", why: "Its module defines one of the names the import-source rule names, so it is a provider, not a user (#35)." },
  no_input: { label: "reads no input", why: "A handler that reads no request input needs no input-validation step in its builder chain (F1)." },
  root_file: { label: "framework root file", why: "A framework root file (the app's root page or layout, a custom App or Document, an entry module, a barrel): the framework wires it, not the team (F9, #50)." },
  factory: { label: "factory", why: "A function that returns a function wrapped in the rule's own wrapper: what it makes carries the wrapper, so it is not a member that lacks it (never an entry point, never under a guard rule)." },
  companion: { label: "companion", why: "Under a naming rule: an export beside a member that follows the scheme, in the same file, that is something that member is built with, not a member of its kind (a helper it calls, an UPPER_SNAKE constant, a class on another line). Never an entry point or a file's default export." },
  shared_part: { label: "shared part", why: "A part shared by the role's members (used by several of them), not a member itself (F5, #52)." },
  registered_key: { label: "key already registered", why: "Its model is already registered by another class under the same registry, so a second registration would clash (F7)." },
  documented_exception: { label: "documented exception", why: "Its docstring explicitly says it is not, or does not use, the rule's target (F8)." },
  opt_out: { label: "opts out", why: "It uses another decorator of the package the rule's target comes from, one no holder uses, as several outliers do: an opt-out, not a mistake (F11a, #58)." },
  own_target: { label: "the rule's own target", why: "The rule's target itself (requireUser under \"call requireUser()\"): a rule is never about its own target (F11c, #58)." },
  does_not_override: { label: "no override", why: "Under \"call super().m()\": a class that defines no m of its own has no override to delegate from (Python)." },
  different_kind: { label: "set apart: a different kind", why: "A person answered the convention's one question \"No, these are different\" and set this file apart (different_kind in conventions.yaml, drift review --answer): drift check lists its members as exempt, by path. Never an entry point under an auth or validation rule unless that entry point was confirmed by name." },
  reviewed: { label: "marked fine", why: "A reviewer marked this outlier as a legitimate exception, with the reason shown (exceptions in conventions.yaml, drift review --exempt): drift check lists it as exempt instead of as a violation." },
  sibling_base: { label: "sibling base", why: "Under a base-class rule: it extends another base the target's own module defines beside the target, which other classes of the repo extend too, so it is the other kind on purpose (Python)." },
  plain_value: { label: "not a schema", why: "Under a naming rule whose followers are values a schema library builds (*Schema): a plain value, built from literals or built-ins only (a literal response, a registry object, Object.keys of one), is not a schema to rename. Only when none of the followers is a plain value (TypeScript)." },
  type_only: { label: "types only", why: "Under \"has a test file\": a module that declares types only (type aliases, interfaces, ambient declarations) has no code that runs, so nothing to test (TypeScript)." },
  no_counterpart: { label: "nothing to pass", why: "Under \"pass key to f()\": every member passes the class named for what it registers (CircuitFilter for Circuit), and no such class exists for this member's subject anywhere in the repo (Python)." },
};

/** The kind of an exemption code; an unknown or missing code has none (show Drift's reason alone). */
export function exemptionKind(code: string | undefined | null): (ExemptionKind & { code: string }) | null {
  if (!code) return null;
  const k = (EXEMPTION_CODE as Record<string, ExemptionKind>)[code];
  return k ? { ...k, code } : { label: code.replace(/_/g, " "), why: `Drift's exemption code "${code}"`, code };
}

/** Exempt members by kind, most first (then by label): `[{code, label, n}]`; members without a code are counted as `null`. */
export function exemptionKinds(exempt: readonly Pick<Exempt, "code">[]): { code: string | null; label: string; n: number }[] {
  const m = new Map<string | null, number>();
  for (const e of exempt) {
    const c = typeof e.code === "string" && e.code ? e.code : null;
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return [...m]
    .map(([code, n]) => ({ code, label: code ? exemptionKind(code)!.label : "no kind given", n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}
