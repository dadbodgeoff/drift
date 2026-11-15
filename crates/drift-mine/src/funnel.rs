//! The yield funnel (study only): how many roles, candidate rules and drafts each gate
//! of mining lets through, by rule family and language, so a study can tell where the
//! coverage of conventions is lost. Counting is off unless [`STUDY_ENV`] names a file
//! (`census --json` then writes the counts there, `eval/study/coverage/funnel.mjs`
//! reads them). Off, nothing is counted and mining is byte for byte what it is without
//! this module: every hook below is a read of the facts mining already computed.

use std::cell::RefCell;
use std::collections::BTreeMap;

use crate::mine::Rule;

/// The environment variable naming the file `census --json` writes the funnel to.
pub const STUDY_ENV: &str = "DRIFT_FUNNEL";

/// The gates, in the order mining applies them. A count at a gate is the number of
/// items the gate dropped there, except the `*_in` and `out` stages, which count what
/// reached a point.
pub const STAGES: &[&str] = &[
    // Roles (family `-`).
    "roles",
    "role_small",
    "role_one_file",
    "role_mined",
    // Candidate rules: a rule some member of a role of at least `MIN_ROLE_SIZE` has.
    "observed",
    "indirect_base",
    "refines_base",
    "optional_key",
    "universal",
    "wilson",
    "lift",
    // Drafts, from every generator (the plain rules above, and the variant sets,
    // naming, order, import, library, dependency and layering generators, which apply
    // their own population tests first).
    "drafted",
    "mandated",
    "tautology",
    "python_family_hidden",
    "holders_one_file",
    "how_built",
    "file_local",
    "path_params",
    "key_structure",
    "input",
    "other_kind_outliers",
    "lint_layering",
    "lint",
    "uncorroborated",
    "call_family_hidden",
    "duplicate",
    "cap_role",
    "cap_avoid",
    "cap_repo",
    "narrowed_out",
    "compiler",
    "merged",
    "mined",
    "show_policy",
    "proposed",
    "python_off",
    "not_listed",
    "shown",
];

/// (family, keying, language, stage).
type Key = (String, String, String, String);

/// How a role is keyed: `kind` when a structural kind defines it (a file kind such as
/// `route` or `*.service`, an entry kind, a class variety or framework member kind, a
/// reserved export name, a test shape, database models), `path` when only a folder
/// below its package does, `package` for the whole package or its top level (`**`, `.`)
/// and for package manifests.
pub fn keying(role: &crate::roles::RoleSelector) -> &'static str {
    use drift_core::SymbolKind;
    if role.kind == SymbolKind::Package {
        return "package";
    }
    if role.kind == SymbolKind::Model
        || role.file != "*"
        || role.entry != "-"
        || role.variety.is_some()
        || role.member_kind.is_some()
        || role.export_name.is_some()
        || role.shape.is_some()
    {
        return "kind";
    }
    if role.dir == crate::roles::PACKAGE_WIDE || role.dir == "." {
        "package"
    } else {
        "path"
    }
}

thread_local! {
    static COUNTS: RefCell<Option<BTreeMap<Key, usize>>> = const { RefCell::new(None) };
    /// The prefix of the families counted now: `test:` while the test roles are mined.
    static SCOPE: RefCell<&'static str> = const { RefCell::new("") };
}

/// Run `f` with the families it counts prefixed by `scope` (`test:`).
pub fn scoped<T>(scope: &'static str, f: impl FnOnce() -> T) -> T {
    let before = SCOPE.with(|s| std::mem::replace(&mut *s.borrow_mut(), scope));
    let out = f();
    SCOPE.with(|s| *s.borrow_mut() = before);
    out
}

/// Run `f` without counting: what it would count is left out (a pass whose stages
/// another pass counts, as [`crate::mine`]'s uncapped show-before-cap pass).
pub fn paused<T>(f: impl FnOnce() -> T) -> T {
    let counts = COUNTS.with(|c| c.borrow_mut().take());
    let out = f();
    COUNTS.with(|c| *c.borrow_mut() = counts);
    out
}

/// Start counting on this thread (a no-op unless [`STUDY_ENV`] is set).
pub fn start() {
    if std::env::var_os(STUDY_ENV).is_some() {
        COUNTS.with(|c| *c.borrow_mut() = Some(BTreeMap::new()));
    }
}

/// True while counting.
pub fn on() -> bool {
    COUNTS.with(|c| c.borrow().is_some())
}

/// The family a rule is counted under: its rule kind (`wrapped_by:call`, `avoids`, ...).
pub fn family(rule: &Rule) -> String {
    let scope = SCOPE.with(|s| *s.borrow());
    format!("{scope}{}", crate::tier::rule_kind(rule))
}

/// Count one proposal at `stage`, under `test:` when its role is a test role.
pub fn card(c: &crate::mine::Candidate, stage: &str) {
    if on() {
        let scope = if crate::shapes::is_test_role(&c.role) {
            "test:"
        } else {
            ""
        };
        let lang = crate::tier::language_code(c.language());
        add(
            &format!("{scope}{}", crate::tier::rule_kind(&c.rule)),
            keying(&c.role),
            lang,
            stage,
            1,
        );
    }
}

/// Count `n` at `stage` for `family`, a role `keying` ([`keying`]) and `lang` (`ts`, `py`).
pub fn add(family: &str, keying: &str, lang: &str, stage: &str, n: usize) {
    if n == 0 {
        return;
    }
    debug_assert!(STAGES.contains(&stage), "unknown funnel stage {stage}");
    COUNTS.with(|c| {
        if let Some(m) = c.borrow_mut().as_mut() {
            *m.entry((
                family.to_string(),
                keying.to_string(),
                lang.to_string(),
                stage.to_string(),
            ))
            .or_default() += n;
        }
    });
}

/// Count one rule of `role` at `stage`.
pub fn rule(role: &crate::roles::RoleSelector, rule: &Rule, lang: &str, stage: &str) {
    if on() {
        add(&family(rule), keying(role), lang, stage, 1);
    }
}

/// Stop counting and return the counts as JSON rows `{family, lang, stage, n}`, in a
/// fixed order (`None` when counting was off).
pub fn finish() -> Option<serde_json::Value> {
    let counts = COUNTS.with(|c| c.borrow_mut().take())?;
    let order = |s: &str| STAGES.iter().position(|x| *x == s).unwrap_or(usize::MAX);
    let mut rows: Vec<_> = counts.into_iter().collect();
    rows.sort_by(|((fa, ka, la, sa), _), ((fb, kb, lb, sb), _)| {
        (fa, ka, la, order(sa)).cmp(&(fb, kb, lb, order(sb)))
    });
    Some(serde_json::json!({
        "schema": 1,
        "stages": STAGES,
        "rows": rows
            .into_iter()
            .map(|((family, keying, lang, stage), n)| serde_json::json!({
                "family": family, "keying": keying, "lang": lang, "stage": stage, "n": n
            }))
            .collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_counts_nothing() {
        COUNTS.with(|c| *c.borrow_mut() = None);
        add("calls", "kind", "ts", "observed", 3);
        assert!(!on());
        assert!(finish().is_none());
    }

    #[test]
    fn rows_follow_stage_order() {
        COUNTS.with(|c| *c.borrow_mut() = Some(BTreeMap::new()));
        add("calls", "kind", "ts", "lift", 2);
        add("calls", "kind", "ts", "observed", 5);
        add("calls", "kind", "ts", "observed", 1);
        add("calls", "kind", "ts", "shown", 0);
        let v = finish().unwrap();
        let rows = v["rows"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["stage"], "observed");
        assert_eq!(rows[0]["n"], 6);
        assert_eq!(rows[1]["stage"], "lift");
        assert!(!on());
    }
}
