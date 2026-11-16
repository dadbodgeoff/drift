//! Confidence tiers: which conventions may block, and which only suggest.
//!
//! The tier is the definition the held-out precision study measures (`eval/study/README.md`
//! rule 5 as amended by decisions D5 and D7, `eval/study/tier-d7.json`, `tierOf` in
//! `eval/study/lib.mjs`):
//!
//! - **default** (blocking-eligible): the convention is a TypeScript/JavaScript one
//!   ([`language_of`] its example is not Python), **and** its structured rule kind is
//!   one of [`DEFAULT_RULE_KINDS`] (call wrappers and layering), **and** every symbol
//!   the rule names is defined in the repository ([`names_package`] is false: no
//!   `pkg:`, `global#` or `unresolved:` target, and no `import:` avoidance of one),
//!   **and** the role has at least [`MIN_BLOCK_ROLE_SIZE`] members;
//! - **suggestion**: everything else. Every Python convention (Python advises only);
//!   decorators, base classes and JSX layout wrappers (moved by D7); generic calls,
//!   naming, absence, preferred libraries, ordering, try-wrappers, control, throws,
//!   directives, required argument keys, rendered components, and file, model and
//!   package rules; rules whose target the repository does not define; and
//!   default-tier kinds in small roles.
//!
//! D5 (lead; approved by the founder 2026-11-06, before any held-out census) replaced
//! rule 5's tier ([`RULE5_DEFAULT_RULE_KINDS`], any target) with in-repo targets and
//! [`D5_DEFAULT_RULE_KINDS`]. D7 (approved by the founder 2026-11-06, before any
//! held-out census) narrowed it after the per-violation analysis of the dev labels
//! under rubric v3: TypeScript/JavaScript keeps only call wrappers and layering, and
//! no Python rule kind is in the default tier. Both primary manifests hold the D7 block
//! (`tier-d7.json`), registered as an amendment of their frozen core in
//! `eval/study/holdout-manifests.json`; the tests require all three to agree. Under the
//! release gate the default tier ships as advise until a language measures >= 95%
//! default-tier accept on a primary held-out run.
//!
//! The tier is keyed on the structured rule ([`rule_kind`], [`names_package`]) and the
//! language of the convention's example path, never on summary text. It is computed,
//! never stored: `conventions.yaml` keeps only a person's `status` and `mode`, so
//! changing this definition later re-tiers every convention without rewriting a
//! policy or changing an id. The shared fixture `eval/study/tier-cases.json` is run
//! through this function and through `lib.mjs`'s `tierOf`, so the product and the study
//! cannot disagree.

use drift_core::WrapKind;
use drift_core::ingest::{Lang, PYTHON_EXTENSIONS};
use serde::{Deserialize, Serialize};

use crate::mine::{MIN_BLOCK_ROLE_SIZE, Rule};

/// Rule kinds of the default tier (TypeScript/JavaScript only), as [`rule_kind`] names
/// them: decision D7. The default tier is an allowlist: a kind not listed here
/// (including any added later) is a suggestion.
pub const DEFAULT_RULE_KINDS: &[&str] = &["wrapped_by:call", "avoids:import"];

/// The default-tier rule kinds of decision D5, before D7. A TypeScript/JavaScript rule
/// of one of these kinds that D7 left out has the tier reason `rule_kind_d7`.
pub const D5_DEFAULT_RULE_KINDS: &[&str] = &[
    "wrapped_by:call",
    "wrapped_by:decorator",
    "wrapped_by:extends",
    "avoids:import",
    "wrapped_by:jsx",
];

/// The default-tier rule kinds of rule 5 as pre-registered on 2026-11-05, before D5,
/// kept for the record (the selection record's `spec.tier` is that tier).
pub const RULE5_DEFAULT_RULE_KINDS: &[&str] = &[
    "wrapped_by:call",
    "wrapped_by:decorator",
    "wrapped_by:extends",
    "passes_key",
    "avoids:import",
    "renders",
    "wrapped_by:jsx",
];

/// The default tier's target condition, as `tier-d7.json` names it (`default.target`).
pub const DEFAULT_TARGET: &str = "in_repo";

/// The languages whose conventions may be in the default tier, as `tier-d7.json` names
/// them (`default.languages`). Python advises only (D7).
pub const DEFAULT_LANGUAGES: &[&str] = &["ts"];

/// The languages whose conventions are all suggestions (`suggestion.languages`).
pub const ADVISE_ONLY_LANGUAGES: &[&str] = &["py"];

/// The decision that defines the tier, as `census --json` reports it (`params.tier.decision`).
pub const DECISION: &str = "D7";

/// The language of a convention, from its example (`path#symbol`, or a path): Python for
/// a `.py`/`.pyi` file or a Python package manifest (`pyproject.toml`,
/// `requirements*.txt`, `setup.cfg`, `Pipfile`), TypeScript/JavaScript otherwise
/// (lib.mjs `languageOf`).
pub fn language_of(example: &str) -> Lang {
    let path = example.split('#').next().unwrap_or_default();
    let name = path.rsplit('/').next().unwrap_or(path);
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or_default();
    if PYTHON_EXTENSIONS.contains(&ext)
        || name == "pyproject.toml"
        || name == "setup.cfg"
        || name == "Pipfile"
        || (name.starts_with("requirements") && name.ends_with(".txt"))
    {
        Lang::Python
    } else {
        Lang::TypeScript
    }
}

/// The language the tier reads for a convention (decision D7), conservatively: Python
/// when any member of its role is Python ([`Evidence::python_members`], recorded when it
/// was mined) or when its example is ([`language_of`]); TypeScript/JavaScript otherwise.
/// So a role mixing `.ts` and `.py` members never blocks its Python members, and
/// re-picking the example on `drift init` cannot move a convention with Python members
/// into the default tier. A policy written before `python_members` existed falls back to
/// the example (lib.mjs `proposalLanguage`).
///
/// [`Evidence::python_members`]: crate::mine::Evidence::python_members
pub fn convention_language(example: &str, evidence: &crate::mine::Evidence) -> Lang {
    if evidence.python_members.unwrap_or(0) > 0 {
        Lang::Python
    } else {
        language_of(example)
    }
}

/// The short language code `tier-d7.json` uses: `ts` or `py`.
pub fn language_code(lang: Lang) -> &'static str {
    match lang {
        Lang::TypeScript => "ts",
        Lang::Python => "py",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    /// Blocking-eligible. (Declared first so the default tier sorts first.)
    Default,
    /// Advises. Blocking one needs an explicit, forced decision by a person.
    Suggestion,
}

impl Tier {
    pub fn as_str(self) -> &'static str {
        match self {
            Tier::Default => "default",
            Tier::Suggestion => "suggestion",
        }
    }
}

impl std::fmt::Display for Tier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The structured rule kind: the rule's `type`, refined by `kind` for `wrapped_by`
/// and by import vs other signals for `avoids` (lib.mjs `ruleKind`).
pub fn rule_kind(rule: &Rule) -> &'static str {
    match rule {
        Rule::WrappedBy { kind, .. } => match kind {
            WrapKind::Call => "wrapped_by:call",
            WrapKind::Decorator => "wrapped_by:decorator",
            WrapKind::Jsx => "wrapped_by:jsx",
            WrapKind::Try => "wrapped_by:try",
            WrapKind::Extends => "wrapped_by:extends",
            WrapKind::Config => "wrapped_by:config",
            WrapKind::Authenticates => "wrapped_by:authenticates",
            WrapKind::ConfigAuthenticates => "wrapped_by:config_authenticates",
            WrapKind::Opens => "wrapped_by:opens",
            WrapKind::AppHook => "wrapped_by:app_hook",
        },
        Rule::PassesKey { .. } => "passes_key",
        Rule::Calls { .. } => "calls",
        Rule::Renders { .. } => "renders",
        Rule::Directive { .. } => "directive",
        Rule::Control { .. } => "control",
        Rule::Throws { .. } => "throws",
        Rule::Named { .. } => "named",
        Rule::Before { .. } => "before",
        Rule::Avoids { signal } if signal.starts_with("import:") => "avoids:import",
        Rule::Avoids { .. } => "avoids:other",
        Rule::HasTest => "has_test",
        Rule::PrefersLibrary { .. } => "prefers_library",
        Rule::ModelHas { .. } => "model_has",
        Rule::PackageHas { .. } => "package_has",
        Rule::DependencyVersion { .. } => "dependency_version",
        Rule::RegisteredIn { .. } => "registered_in",
        Rule::MirrorsKeys { .. } => "mirrors_keys",
        Rule::ImportsFrom { .. } => "imports_from",
        Rule::Practice { .. } => "practice",
    }
}

/// Whether a linked symbol id is not defined by the repository: a package's (`pkg:`), a
/// built-in or ambient global (`global#`), or one the linker could not resolve
/// (`unresolved:`). The same prefixes `security.rs` treats as not internal.
pub fn outside_repo(id: &str) -> bool {
    id.starts_with("pkg:") || id.starts_with("global#") || id.starts_with("unresolved:")
}

/// Whether the rule names a symbol the repository does not define ([`outside_repo`]): a
/// package, built-in or unresolved wrapper, base class, callee, component or thrown class,
/// an `import:` avoidance of one (`import:pkg:`), or the source or an alternative of an
/// import-source rule (`imports_from`: a backport, or the library a team version wraps).
/// A rule with several alternatives names one if any alternative does (lib.mjs
/// `namesPackage`). A package object reached through a binding the repository defines
/// (`models.py#ma.ModelSchema` after `ma = Marshmallow()`) has an in-repo id, so it
/// counts as in-repo.
pub fn names_package(rule: &Rule) -> bool {
    let pkg = |s: &str| outside_repo(s);
    match rule {
        Rule::WrappedBy { any_of, .. } => any_of.iter().any(|s| pkg(s)),
        Rule::PassesKey { callee, .. } | Rule::Calls { callee } => pkg(callee),
        Rule::Renders { component } => pkg(component),
        Rule::Throws { class } => pkg(class),
        Rule::Before { first, then } => pkg(first) || pkg(then),
        Rule::Avoids { signal } => signal.strip_prefix("import:").is_some_and(outside_repo),
        Rule::ImportsFrom {
            source, instead_of, ..
        } => pkg(source) || instead_of.iter().any(|s| pkg(s)),
        Rule::Directive { .. }
        | Rule::Control { .. }
        | Rule::Named { .. }
        | Rule::HasTest
        | Rule::PrefersLibrary { .. }
        | Rule::ModelHas { .. }
        | Rule::PackageHas { .. }
        | Rule::DependencyVersion { .. }
        | Rule::RegisteredIn { .. }
        | Rule::MirrorsKeys { .. }
        | Rule::Practice { .. } => false,
    }
}

/// Why a convention is not in the default tier: `None` for the default tier, otherwise the
/// first default-tier condition it fails, in order: `"language_advise"` (a Python
/// convention: Python advises only, D7), `"rule_kind_d7"` (a decorator, base-class or JSX
/// wrapper rule: in D5's default tier, moved to suggestion by D7), `"rule_kind"` (any other
/// kind not in [`DEFAULT_RULE_KINDS`]), `"names_package"` ([`names_package`]),
/// `"small_role"` (fewer than [`MIN_BLOCK_ROLE_SIZE`] members). `census --json` emits it
/// per proposal as `tier_reason`; [`tier_of`] and [`describe`] are both derived from it.
pub fn tier_reason(rule: &Rule, members: usize, lang: Lang) -> Option<&'static str> {
    let kind = rule_kind(rule);
    if !DEFAULT_LANGUAGES.contains(&language_code(lang)) {
        Some("language_advise")
    } else if !DEFAULT_RULE_KINDS.contains(&kind) {
        if D5_DEFAULT_RULE_KINDS.contains(&kind) {
            Some("rule_kind_d7")
        } else {
            Some("rule_kind")
        }
    } else if names_package(rule) {
        Some("names_package")
    } else if members < MIN_BLOCK_ROLE_SIZE {
        Some("small_role")
    } else {
        None
    }
}

/// The tier of a convention with this rule, in this language, whose role has `members`
/// members.
pub fn tier_of(rule: &Rule, members: usize, lang: Lang) -> Tier {
    match tier_reason(rule, members, lang) {
        None => Tier::Default,
        Some(_) => Tier::Suggestion,
    }
}

/// Why a convention is in its tier, for people: `default`,
/// `suggestion (Python conventions advise only; decision D7)`,
/// `suggestion (rule kind wrapped_by:decorator; decision D7 keeps only call wrappers and layering)`,
/// `suggestion (rule kind calls)`, `suggestion (rule names a symbol from outside the repo)` or
/// `suggestion (9 members; the default tier needs 15)`.
pub fn describe(rule: &Rule, members: usize, lang: Lang) -> String {
    match tier_reason(rule, members, lang) {
        None => "default".to_string(),
        Some("language_advise") => {
            "suggestion (Python conventions advise only; decision D7)".to_string()
        }
        Some("rule_kind_d7") => format!(
            "suggestion (rule kind {}; decision D7 keeps only call wrappers and layering)",
            rule_kind(rule)
        ),
        Some("rule_kind") => format!("suggestion (rule kind {})", rule_kind(rule)),
        Some("names_package") => {
            "suggestion (rule names a symbol from outside the repo)".to_string()
        }
        Some(_) => {
            format!("suggestion ({members} members; the default tier needs {MIN_BLOCK_ROLE_SIZE})")
        }
    }
}

/// The decision the candidate tier belongs to, as `census --json --candidate d8` names
/// it. D8 is **pre-registered, not adopted** (`eval/study/tier-d8-candidate.json`,
/// `eval/study/README.md` decision D8): nothing but that census option reads it, so no
/// convention's tier, blocking or advice changes, and Python still advises only.
pub const D8_DECISION: &str = "D8";

/// D8's Python member floor: the role's size ([`crate::mine::Evidence::role_size`]),
/// as for [`MIN_BLOCK_ROLE_SIZE`], which TypeScript/JavaScript keeps under D8.
pub const D8_MIN_MEMBERS_PY: usize = 50;

/// Why a convention would not be in decision D8's **candidate** default tier: `None`
/// when it would be. TypeScript/JavaScript is exactly D7 ([`tier_reason`]). A Python
/// convention would be default when its kind is one of [`DEFAULT_RULE_KINDS`]
/// (otherwise `"rule_kind"`), it names no symbol from outside the repository
/// (`"names_package"`), a call wrapper's alternatives are all guards (`guards`, which
/// the caller reads from the definitions with
/// [`crate::security::every_alternative_authenticates`]; otherwise `"not_guard"`), and
/// its role has at least [`D8_MIN_MEMBERS_PY`] members (`"small_role"`). lib.mjs
/// `tierOf` under `tier-d8-candidate.json` agrees on the shared `d8_cases`.
pub fn d8_candidate_reason(
    rule: &Rule,
    members: usize,
    lang: Lang,
    guards: bool,
) -> Option<&'static str> {
    if lang != Lang::Python {
        return tier_reason(rule, members, lang);
    }
    let kind = rule_kind(rule);
    if !DEFAULT_RULE_KINDS.contains(&kind) {
        Some("rule_kind")
    } else if names_package(rule) {
        Some("names_package")
    } else if kind == "wrapped_by:call" && !guards {
        Some("not_guard")
    } else if members < D8_MIN_MEMBERS_PY {
        Some("small_role")
    } else {
        None
    }
}

/// The tier a convention would have under D8's candidate tier ([`d8_candidate_reason`]).
pub fn d8_candidate_tier(rule: &Rule, members: usize, lang: Lang, guards: bool) -> Tier {
    match d8_candidate_reason(rule, members, lang, guards) {
        None => Tier::Default,
        Some(_) => Tier::Suggestion,
    }
}

macro_rules! tiered {
    ($t:ty) => {
        impl $t {
            /// The language the tier reads ([`convention_language`]).
            pub fn language(&self) -> Lang {
                convention_language(&self.example, &self.evidence)
            }

            pub fn tier(&self) -> Tier {
                // S21 (`census --gate-candidate`, study use): a proposal only the
                // `universal` or `small-roles` candidate made advises only. With no
                // switch on (always outside that census) no id is marked.
                if crate::gate_candidates::advise_only(&self.id) {
                    return Tier::Suggestion;
                }
                tier_of(&self.rule, self.evidence.role_size(), self.language())
            }

            /// [`tier_reason`] for this convention.
            pub fn tier_reason(&self) -> Option<&'static str> {
                // S21: see `tier` above.
                if crate::gate_candidates::advise_only(&self.id) {
                    return Some("gate_candidate");
                }
                tier_reason(&self.rule, self.evidence.role_size(), self.language())
            }

            /// [`describe`] for this convention.
            pub fn describe_tier(&self) -> String {
                // S21: see `tier` above.
                if crate::gate_candidates::advise_only(&self.id) {
                    return "suggestion (study candidate: advise only)".to_string();
                }
                describe(&self.rule, self.evidence.role_size(), self.language())
            }
        }
    };
}

tiered!(crate::mine::Candidate);
tiered!(crate::policy::Convention);

/// Order proposals by tier, default first, keeping their rank within each tier.
pub fn order_by_tier<T>(items: &mut [T], tier: impl Fn(&T) -> Tier) {
    items.sort_by_key(|x| tier(x));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::Value;

    fn repo_file(rel: &str) -> String {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(rel);
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("reading {}: {e}", p.display()))
    }

    #[derive(Deserialize)]
    struct Case {
        rule: Rule,
        members: usize,
        /// The example the language is read from (`path#symbol`).
        example: String,
        /// The conventions.yaml evidence the case stands for, when the role size or the
        /// language depends on it (exempt members, Python members).
        #[serde(default)]
        evidence: Option<crate::mine::Evidence>,
        kind: String,
        tier: Tier,
        reason: Option<String>,
    }

    fn cases() -> Vec<Case> {
        let v: Value = serde_json::from_str(&repo_file("eval/study/tier-cases.json")).unwrap();
        serde_json::from_value(v["cases"].clone()).unwrap()
    }

    /// The same cases `eval/study/tier.test.mjs` runs through `lib.mjs`'s `tierOf`.
    #[test]
    fn shared_fixture_matches_the_study() {
        let cases = cases();
        assert!(cases.len() >= 40, "fixture has {} cases", cases.len());
        for c in &cases {
            let lang = match &c.evidence {
                Some(e) => {
                    // `members` is the role's size, as the tier reads it, never `total`.
                    assert_eq!(e.role_size(), c.members, "{:?}", c.rule);
                    convention_language(&c.example, e)
                }
                None => language_of(&c.example),
            };
            assert_eq!(rule_kind(&c.rule), c.kind, "{:?}", c.rule);
            assert_eq!(
                tier_of(&c.rule, c.members, lang),
                c.tier,
                "{:?} with {} members in {}",
                c.rule,
                c.members,
                c.example
            );
            assert_eq!(
                describe(&c.rule, c.members, lang)
                    .split(' ')
                    .next()
                    .unwrap(),
                c.tier.as_str()
            );
            // tier_reason agrees with the fixture, with tier_of and with describe.
            let reason = tier_reason(&c.rule, c.members, lang);
            assert_eq!(
                reason,
                c.reason.as_deref(),
                "{:?} with {} members in {}",
                c.rule,
                c.members,
                c.example
            );
            assert_eq!(reason.is_none(), c.tier == Tier::Default, "{:?}", c.rule);
            let text = describe(&c.rule, c.members, lang);
            let expected = match reason {
                None => "default".to_string(),
                Some("language_advise") => {
                    "suggestion (Python conventions advise only; decision D7)".to_string()
                }
                Some("rule_kind_d7") => format!(
                    "suggestion (rule kind {}; decision D7 keeps only call wrappers and layering)",
                    c.kind
                ),
                Some("rule_kind") => format!("suggestion (rule kind {})", c.kind),
                Some("names_package") => {
                    "suggestion (rule names a symbol from outside the repo)".to_string()
                }
                Some("small_role") => format!(
                    "suggestion ({} members; the default tier needs {MIN_BLOCK_ROLE_SIZE})",
                    c.members
                ),
                Some(other) => panic!("unknown tier reason {other}"),
            };
            assert_eq!(text, expected, "{:?} with {} members", c.rule, c.members);
        }
        // Every default kind is covered on both sides of the member threshold, and with a
        // rule that names a package in a role large enough for the default tier.
        let ts = |c: &&Case| language_of(&c.example) == Lang::TypeScript && c.evidence.is_none();
        // Exempt members count: a rule about 14 of a role of 16 is default tier, and one about
        // 12 of 14 is small; a TypeScript example with Python members advises.
        assert!(
            cases
                .iter()
                .any(|c| c.evidence.as_ref().is_some_and(
                    |e| e.total < MIN_BLOCK_ROLE_SIZE && e.role_size() >= MIN_BLOCK_ROLE_SIZE
                ) && c.tier == Tier::Default)
        );
        assert!(cases.iter().any(|c| {
            c.evidence
                .as_ref()
                .is_some_and(|e| e.python_members.is_some())
                && language_of(&c.example) == Lang::TypeScript
                && c.reason.as_deref() == Some("language_advise")
        }));
        for k in DEFAULT_RULE_KINDS {
            assert!(
                cases.iter().filter(ts).any(|c| c.kind == *k
                    && names_package(&c.rule)
                    && c.members >= MIN_BLOCK_ROLE_SIZE
                    && c.tier == Tier::Suggestion),
                "{k} naming a package is not in the fixture"
            );
            for (m, t) in [
                (MIN_BLOCK_ROLE_SIZE, Tier::Default),
                (MIN_BLOCK_ROLE_SIZE - 1, Tier::Suggestion),
            ] {
                assert!(
                    cases
                        .iter()
                        .filter(ts)
                        .any(|c| c.kind == *k && c.members == m && c.tier == t),
                    "{k} with {m} members is not in the fixture"
                );
            }
        }
        // Every kind D5 had in the default tier and D7 moved out is in the fixture as a
        // TypeScript rule that D5 would have made default, now `rule_kind_d7`.
        for k in D5_DEFAULT_RULE_KINDS
            .iter()
            .filter(|k| !DEFAULT_RULE_KINDS.contains(k))
        {
            assert!(
                cases.iter().filter(ts).any(|c| c.kind == *k
                    && !names_package(&c.rule)
                    && c.members >= MIN_BLOCK_ROLE_SIZE
                    && c.reason.as_deref() == Some("rule_kind_d7")),
                "{k}: no in-repo TypeScript case in a large role"
            );
        }
        // Every D5 default kind Python has (no JSX) has a Python case that D5 made default,
        // now `language_advise`.
        for k in D5_DEFAULT_RULE_KINDS
            .iter()
            .filter(|k| **k != "wrapped_by:jsx")
        {
            assert!(
                cases.iter().any(|c| c.kind == *k
                    && language_of(&c.example) == Lang::Python
                    && !names_package(&c.rule)
                    && c.members >= MIN_BLOCK_ROLE_SIZE
                    && c.reason.as_deref() == Some("language_advise")),
                "{k}: no in-repo Python case in a large role"
            );
        }
    }

    fn rule(json: &str) -> Rule {
        serde_json::from_str(json).unwrap()
    }

    /// D7: a TypeScript decorator rule that D5 made default is a suggestion now.
    #[test]
    fn d7_moves_a_typescript_decorator_rule_to_suggestion() {
        let r = rule(
            r#"{"type":"wrapped_by","kind":"decorator","any_of":["src/auth/guard.ts#Authed"]}"#,
        );
        let lang = language_of("src/users/users.controller.ts#UsersController.list");
        assert_eq!(lang, Lang::TypeScript);
        assert!(!names_package(&r));
        assert!(
            D5_DEFAULT_RULE_KINDS.contains(&rule_kind(&r)),
            "D5 made it default"
        );
        assert_eq!(tier_of(&r, 40, lang), Tier::Suggestion);
        assert_eq!(tier_reason(&r, 40, lang), Some("rule_kind_d7"));
        assert_eq!(
            describe(&r, 40, lang),
            "suggestion (rule kind wrapped_by:decorator; decision D7 keeps only call wrappers and layering)"
        );
        for kind in ["extends", "jsx"] {
            let r = rule(&format!(
                r#"{{"type":"wrapped_by","kind":"{kind}","any_of":["src/base.ts#Base"]}}"#
            ));
            assert_eq!(tier_reason(&r, 40, lang), Some("rule_kind_d7"), "{kind}");
        }
    }

    /// D7: a TypeScript call-wrapper rule with an in-repo target in a large role stays
    /// default, and so does layering.
    #[test]
    fn d7_keeps_typescript_call_wrappers_and_layering_default() {
        let lang = language_of("app/api/users/route.ts#GET");
        let wrapper =
            rule(r#"{"type":"wrapped_by","kind":"call","any_of":["lib/auth.ts#withAuth"]}"#);
        assert_eq!(tier_of(&wrapper, 15, lang), Tier::Default);
        assert_eq!(tier_reason(&wrapper, 15, lang), None);
        assert_eq!(
            tier_of(&wrapper, 14, lang),
            Tier::Suggestion,
            "D5's member rule"
        );
        let pkg = rule(r#"{"type":"wrapped_by","kind":"call","any_of":["pkg:next-auth#auth"]}"#);
        assert_eq!(
            tier_reason(&pkg, 40, lang),
            Some("names_package"),
            "D5's target rule"
        );
        let layering = rule(r#"{"type":"avoids","signal":"import:packages/db"}"#);
        assert_eq!(tier_of(&layering, 40, lang), Tier::Default);
        for js in [
            "src/a.js#f",
            "src/a.jsx#F",
            "src/a.mjs#f",
            "package.json",
            "",
        ] {
            assert_eq!(language_of(js), Lang::TypeScript, "{js}");
        }
    }

    /// D7, conservatively: a role with any Python member advises, even when its example is
    /// TypeScript; without the count (an older policy) the example decides.
    #[test]
    fn d7_a_role_with_any_python_member_advises() {
        let evidence = |python_members: Option<usize>| crate::mine::Evidence {
            holders: 39,
            total: 40,
            lower_bound: 0.9,
            lift: 2.0,
            split: vec![],
            role_members: None,
            python_members,
        };
        let ts = "app/api/users/route.ts#GET";
        assert_eq!(convention_language(ts, &evidence(None)), Lang::TypeScript);
        assert_eq!(convention_language(ts, &evidence(Some(1))), Lang::Python);
        assert_eq!(
            convention_language("app/views.py#index", &evidence(None)),
            Lang::Python
        );
        let wrapper =
            rule(r#"{"type":"wrapped_by","kind":"call","any_of":["lib/auth.ts#withAuth"]}"#);
        let lang = convention_language(ts, &evidence(Some(1)));
        assert_eq!(tier_reason(&wrapper, 40, lang), Some("language_advise"));
        // The count survives conventions.yaml, and is left out when no member is Python.
        let yaml = serde_saphyr::to_string(&evidence(Some(3))).unwrap();
        assert!(yaml.contains("python_members: 3"), "{yaml}");
        let back: crate::mine::Evidence = serde_saphyr::from_str(&yaml).unwrap();
        assert_eq!(back.python_members, Some(3));
        assert!(
            !serde_saphyr::to_string(&evidence(None))
                .unwrap()
                .contains("python_members")
        );
    }

    /// D7: every Python convention is a suggestion, whatever its kind, target or role size.
    #[test]
    fn d7_makes_every_python_convention_a_suggestion() {
        for example in [
            "app/views.py#UserViewSet",
            "pkg/stubs.pyi#f",
            "pyproject.toml",
            "services/api/pyproject.toml",
            "requirements-dev.txt",
            "setup.cfg",
            "Pipfile",
        ] {
            assert_eq!(language_of(example), Lang::Python, "{example}");
        }
        let lang = language_of("app/views.py#UserViewSet");
        for r in samples() {
            for members in [5, 15, 200] {
                assert_eq!(tier_of(&r, members, lang), Tier::Suggestion, "{r:?}");
                assert_eq!(
                    tier_reason(&r, members, lang),
                    Some("language_advise"),
                    "{r:?}"
                );
            }
        }
        let in_repo =
            rule(r#"{"type":"wrapped_by","kind":"call","any_of":["app/auth.py#login_required"]}"#);
        assert_eq!(
            describe(&in_repo, 40, lang),
            "suggestion (Python conventions advise only; decision D7)"
        );
    }

    /// One rule of every kind. The matches have no wildcard, so a new `Rule` variant or
    /// `WrapKind` does not compile here until it has a sample, and then a fixture case.
    fn samples() -> Vec<Rule> {
        use WrapKind::*;
        let mut out: Vec<Rule> = [
            Call,
            Decorator,
            Jsx,
            Try,
            Extends,
            Config,
            Authenticates,
            ConfigAuthenticates,
            Opens,
            AppHook,
        ]
        .into_iter()
        .map(|kind| {
            match kind {
                Call | Decorator | Jsx | Try | Extends | Config | Authenticates
                | ConfigAuthenticates | Opens | AppHook => {}
            }
            Rule::WrappedBy {
                kind,
                any_of: vec![],
            }
        })
        .collect();
        let s = String::new;
        out.extend([
            Rule::PassesKey {
                callee: s(),
                index: 0,
                key: s(),
            },
            Rule::Calls { callee: s() },
            Rule::Renders { component: s() },
            Rule::Directive { value: s() },
            Rule::Control { value: s() },
            Rule::Throws { class: s() },
            Rule::Named { pattern: s() },
            Rule::Before {
                first: s(),
                then: s(),
            },
            Rule::Avoids {
                signal: "import:x".into(),
            },
            Rule::Avoids { signal: s() },
            Rule::HasTest,
            Rule::PrefersLibrary {
                group: s(),
                preferred: s(),
            },
            Rule::ModelHas { field: s() },
            Rule::PackageHas { item: s() },
            Rule::DependencyVersion {
                name: s(),
                range: None,
            },
            Rule::RegisteredIn {
                slot: s(),
                path: s(),
                named: s(),
                reach: false,
            },
            Rule::MirrorsKeys { from: s(), to: s() },
            Rule::ImportsFrom {
                name: s(),
                source: s(),
                instead_of: vec![],
            },
        ]);
        for r in &out {
            match r {
                Rule::WrappedBy { .. }
                | Rule::PassesKey { .. }
                | Rule::Calls { .. }
                | Rule::Renders { .. }
                | Rule::Directive { .. }
                | Rule::Control { .. }
                | Rule::Throws { .. }
                | Rule::Named { .. }
                | Rule::Before { .. }
                | Rule::Avoids { .. }
                | Rule::HasTest
                | Rule::PrefersLibrary { .. }
                | Rule::ModelHas { .. }
                | Rule::PackageHas { .. }
                | Rule::DependencyVersion { .. }
                | Rule::RegisteredIn { .. }
                | Rule::MirrorsKeys { .. }
                | Rule::ImportsFrom { .. } => {}
                // Never mined (a person promotes it from the practice map), so the
                // study's tier fixture has no case for it: no sample here. Its kind is
                // not in the default tier's allowlist, so it is a suggestion.
                Rule::Practice { .. } => {}
            }
        }
        out
    }

    #[test]
    fn every_rule_kind_has_a_fixture_case() {
        let cases = cases();
        let kinds: std::collections::BTreeSet<&str> = samples().iter().map(rule_kind).collect();
        assert_eq!(kinds.len(), 28);
        for k in kinds {
            assert!(cases.iter().any(|c| c.kind == k), "{k} has no fixture case");
        }
    }

    fn kinds(v: &Value) -> Vec<&str> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap())
            .collect()
    }

    /// The product's definition is D7's block (`tier-d7.json`), and every registered held-out
    /// manifest holds that same block, word for word: the study measures the tier the product
    /// ships. The primaries by decision D7, the secondary sets by D7a (the lead's).
    #[test]
    fn definition_is_d7_in_the_product_and_every_held_out_manifest() {
        let d7: Value = serde_json::from_str(&repo_file("eval/study/tier-d7.json")).unwrap();
        let d7 = &d7["tier"];
        assert_eq!(d7["kind"], "rule_kind");
        assert_eq!(d7["decision"], DECISION);
        assert_eq!(kinds(&d7["default"]["rule_kinds"]), DEFAULT_RULE_KINDS);
        assert_eq!(kinds(&d7["default"]["languages"]), DEFAULT_LANGUAGES);
        assert_eq!(kinds(&d7["suggestion"]["languages"]), ADVISE_ONLY_LANGUAGES);
        assert_eq!(d7["default"]["target"], DEFAULT_TARGET);
        assert_eq!(
            d7["default"]["min_members"].as_u64(),
            Some(MIN_BLOCK_ROLE_SIZE as u64)
        );
        let d5: Value = serde_json::from_str(&repo_file("eval/study/tier-d5.json")).unwrap();
        let d5 = &d5["tier"];
        assert_eq!(kinds(&d5["default"]["rule_kinds"]), D5_DEFAULT_RULE_KINDS);
        let registry: Value =
            serde_json::from_str(&repo_file("eval/study/holdout-manifests.json")).unwrap();
        let manifests = registry["manifests"].as_object().unwrap();
        for p in [
            "eval/holdout-primary.json",
            "eval/holdout-primary-py.json",
            "eval/holdout.json",
            "eval/holdout-py.json",
        ] {
            assert!(manifests.contains_key(p), "{p} is not registered");
        }
        for manifest in manifests.keys() {
            let m: Value = serde_json::from_str(&repo_file(manifest)).unwrap();
            assert_eq!(&m["tier"], d7, "{manifest}: tier is not tier-d7.json's");
        }
    }

    /// An import-source rule names a package when its source or an alternative is one (a
    /// backport, or the library a team version wraps), so it is a suggestion that census
    /// and check report with `names_package`; its kind is not a default-tier kind either.
    #[test]
    fn an_import_source_rule_names_its_package() {
        let rule = |source: &str, instead_of: &[&str]| Rule::ImportsFrom {
            name: "x".into(),
            source: source.into(),
            instead_of: instead_of.iter().map(|s| s.to_string()).collect(),
        };
        for r in [
            rule(
                "pkg:typing_extensions#TypedDict",
                &["pkg:python:typing#TypedDict"],
            ),
            rule("app/ui/button.py#button", &["pkg:tagflow#tag.button"]),
            rule("pkg:tagflow#tag.button", &["app/ui/button.py#button"]),
            rule("app/a.py#x", &["app/b.py#x", "unresolved:legacy#x"]),
        ] {
            assert!(names_package(&r), "{r:?}");
            // A Python convention advises only (D7); in TypeScript the kind is not admitted.
            assert_eq!(
                tier_reason(&r, 200, Lang::Python),
                Some("language_advise"),
                "{r:?}"
            );
            assert_eq!(
                tier_reason(&r, 200, Lang::TypeScript),
                Some("rule_kind"),
                "{r:?}"
            );
            assert_eq!(tier_of(&r, 200, Lang::Python), Tier::Suggestion);
        }
        let in_repo = rule("app/a.py#x", &["app/b.py#x"]);
        assert!(!names_package(&in_repo));
        assert_eq!(
            tier_of(&in_repo, 200, Lang::TypeScript),
            Tier::Suggestion,
            "kind not admitted"
        );
    }

    #[derive(Deserialize)]
    struct D8Case {
        rule: Rule,
        members: usize,
        example: String,
        #[serde(default)]
        evidence: Option<crate::mine::Evidence>,
        kind: String,
        /// `census --json --candidate d8` `candidate.guards`; null: not a call wrapper,
        /// or nothing said (the study fails closed, and so does this).
        guards: Option<bool>,
        d8_tier: Tier,
        d8_reason: Option<String>,
    }

    /// D8's candidate tier (pre-registered, not adopted): the shared `d8_cases` that
    /// `eval/study/tier.test.mjs` runs through `lib.mjs`'s `tierOf` under
    /// `tier-d8-candidate.json`, whose constants must be this module's.
    #[test]
    fn d8_candidate_matches_the_study() {
        let v: Value = serde_json::from_str(&repo_file("eval/study/tier-cases.json")).unwrap();
        let cases: Vec<D8Case> = serde_json::from_value(v["d8_cases"].clone()).unwrap();
        assert!(cases.len() >= 20, "{} d8 cases", cases.len());
        for c in &cases {
            let lang = match &c.evidence {
                Some(e) => {
                    assert_eq!(e.role_size(), c.members, "{:?}", c.rule);
                    convention_language(&c.example, e)
                }
                None => language_of(&c.example),
            };
            assert_eq!(rule_kind(&c.rule), c.kind, "{:?}", c.rule);
            let guards = c.guards.unwrap_or(false);
            let at = format!("{:?} with {} members in {}", c.rule, c.members, c.example);
            assert_eq!(
                d8_candidate_reason(&c.rule, c.members, lang, guards),
                c.d8_reason.as_deref(),
                "{at}"
            );
            assert_eq!(
                d8_candidate_tier(&c.rule, c.members, lang, guards),
                c.d8_tier,
                "{at}"
            );
            if lang == Lang::TypeScript {
                // TypeScript/JavaScript is exactly D7.
                assert_eq!(tier_of(&c.rule, c.members, lang), c.d8_tier, "{at}");
            } else {
                // Nothing ships D8: every Python convention still advises.
                assert_eq!(tier_of(&c.rule, c.members, lang), Tier::Suggestion, "{at}");
            }
        }
        // Each Python condition is in the fixture on both sides.
        let py: Vec<&D8Case> = cases
            .iter()
            .filter(|c| match &c.evidence {
                Some(e) => convention_language(&c.example, e) == Lang::Python,
                None => language_of(&c.example) == Lang::Python,
            })
            .collect();
        for reason in ["rule_kind", "names_package", "not_guard", "small_role"] {
            assert!(
                py.iter().any(|c| c.d8_reason.as_deref() == Some(reason)),
                "{reason}"
            );
        }
        for k in DEFAULT_RULE_KINDS {
            for (m, t) in [
                (D8_MIN_MEMBERS_PY, Tier::Default),
                (D8_MIN_MEMBERS_PY - 1, Tier::Suggestion),
            ] {
                assert!(
                    py.iter()
                        .any(|c| c.kind == *k && c.members == m && c.d8_tier == t),
                    "Python {k} with {m} members is not in the fixture"
                );
            }
        }
        // The study's definition holds this module's constants.
        let file: Value =
            serde_json::from_str(&repo_file("eval/study/tier-d8-candidate.json")).unwrap();
        let t = &file["tier"];
        assert_eq!(t["decision"], D8_DECISION);
        assert_eq!(t["status"], "candidate");
        assert_eq!(
            t["default"]["rule_kinds"],
            serde_json::json!(DEFAULT_RULE_KINDS)
        );
        assert_eq!(t["default"]["languages"], serde_json::json!(["ts", "py"]));
        assert_eq!(t["default"]["target"], DEFAULT_TARGET);
        assert_eq!(t["default"]["min_members"], MIN_BLOCK_ROLE_SIZE);
        assert_eq!(
            t["default"]["by_language"]["py"]["min_members"],
            D8_MIN_MEMBERS_PY
        );
        assert_eq!(t["default"]["by_language"]["py"]["call_wrappers"], "guards");
        // The shipped tier is still D7's, which advises for Python.
        assert_eq!(DECISION, "D7");
        assert_eq!(ADVISE_ONLY_LANGUAGES, ["py"]);
    }

    #[test]
    fn order_keeps_rank_within_tier() {
        let mut v = vec![
            (1, Tier::Suggestion),
            (2, Tier::Default),
            (3, Tier::Suggestion),
            (4, Tier::Default),
        ];
        order_by_tier(&mut v, |x| x.1);
        assert_eq!(
            v.iter().map(|x| x.0).collect::<Vec<_>>(),
            [2, 4, 1, 3],
            "stable"
        );
    }
}
