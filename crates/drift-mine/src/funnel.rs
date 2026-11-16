//! The yield funnel (study only): how many roles, candidate rules and drafts each gate
//! of mining lets through, by rule family and language, so a study can tell where the
//! coverage of conventions is lost. Counting is off unless [`STUDY_ENV`] names a file
//! (`census --json` then writes the counts there, `eval/study/coverage/funnel.mjs`
//! reads them). Off, nothing is counted and mining is byte for byte what it is without
//! this module: every hook below is a read of the facts mining already computed.
//!
//! Counts say how many a gate dropped, never which. The second half of this module is
//! the per-candidate record (`drift census --why`, [`record`]): every candidate a gate
//! dropped, with its role, its rule in words, holders and members, the gate's name, the
//! gate's threshold and the candidate's value, and whether the rule's target is defined
//! in the repository or comes from a dependency ([`target_of`]). Every gate is named and
//! documented once, in [`GATES`], with its constant and where the audit of the gates
//! (2026-11) found its threshold comes from: a funnel nobody can see cannot be tuned, and
//! the gates no study backs are the ones a person has to decide on. Like the counts, the
//! record only reads what mining computed: with it off (the default, and always in
//! `drift init`), nothing is recorded, and with it on every proposal is what it is off.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use crate::mine::{Candidate, Rule};
use crate::roles::RoleSelector;

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
    let drops = DROPS.with(|d| d.borrow_mut().take());
    let out = f();
    COUNTS.with(|c| *c.borrow_mut() = counts);
    DROPS.with(|d| *d.borrow_mut() = drops);
    out
}

/// Start counting on this thread (a no-op unless [`STUDY_ENV`] is set).
pub fn start() {
    if std::env::var_os(STUDY_ENV).is_some() {
        COUNTS.with(|c| *c.borrow_mut() = Some(BTreeMap::new()));
    }
}

/// Start counting on this thread whatever [`STUDY_ENV`] says: `census --why`, which
/// prints the counts instead of writing them to a file.
pub fn start_counting() {
    COUNTS.with(|c| *c.borrow_mut() = Some(BTreeMap::new()));
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
    // S21: the study candidates' stages ([`crate::gate_candidates`]) are counted only
    // while a switch is on, and are never in `STAGES`.
    debug_assert!(
        STAGES.contains(&stage) || crate::gate_candidates::is_stage(stage),
        "unknown funnel stage {stage}"
    );
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

// ---------------------------------------------------------------------------------------
// The per-candidate record (`drift census --why`).
// ---------------------------------------------------------------------------------------

/// A gate's threshold comes from a study result (the document and number are in
/// [`Gate::source`]).
pub const STUDY: &str = "study";
/// A gate's threshold was pre-registered for the study.
pub const PRE_REGISTERED: &str = "pre-registered";
/// A gate's threshold is an engineering choice with no cited evidence.
pub const ENGINEERING: &str = "engineering, no study";
/// A gate's threshold is an engineering choice with a written rationale, never measured.
pub const RATIONALE: &str = "engineering, rationale written but not measured";

/// One gate between a candidate rule and a proposal, as `census --why` names it.
#[derive(Debug, Clone, Copy)]
pub struct Gate {
    /// The gate's name: the funnel's stage name ([`STAGES`]) where mining counts it, the
    /// show policy's reason otherwise.
    pub name: &'static str,
    /// The constant (and its value) the gate compares with, or what it tests.
    pub constant: &'static str,
    /// What a candidate needs to pass, in words.
    pub passes: &'static str,
    /// [`STUDY`], [`PRE_REGISTERED`], [`ENGINEERING`] or [`RATIONALE`], as the audit of the
    /// gates (2026-11) found it.
    pub origin: &'static str,
    /// Where that origin is written down.
    pub source: &'static str,
}

/// Every gate a candidate can be dropped at, in the order mining applies them. The one
/// place their names are defined: the record ([`Dropped::gate`]), `census --why <gate>`
/// and `census --why --json` all use these.
pub const GATES: &[Gate] = &[
    // The population test, per role and candidate rule (`mine.rs`, the role loop).
    Gate {
        name: "indirect_base",
        constant: "more than half of the holders extend the base directly",
        passes: "a base class most holders extend themselves, not only through another base",
        origin: RATIONALE,
        source: "mine.rs comment (an ancestor the team's base brings along is no convention)",
    },
    Gate {
        name: "refines_base",
        constant: "Python: the outliers extend the general team base the rule's base refines",
        passes: "a base that is no refinement the outliers chose against",
        origin: RATIONALE,
        source: "mine.rs `refines_team_base`",
    },
    Gate {
        name: "optional_key",
        constant: "most holders also call the callee without the key",
        passes: "a key passed on every call of the callee",
        origin: RATIONALE,
        source: "mine.rs `optional_key`",
    },
    Gate {
        name: "universal",
        constant: "at least one outlier (holders < members)",
        passes: "a rule some member of the role does not follow; a rule that holds for every member is never proposed",
        origin: ENGINEERING,
        source: "docs/v2/PLAN.md:148 (\"shown as documentation, not as a check\"; the documentation was never built)",
    },
    Gate {
        name: "wilson",
        constant: "MIN_LOWER_BOUND = 0.75 (95% Wilson lower bound of holders / members)",
        passes: "a lower bound of at least 0.75: with one outlier, a role of 19 or more members",
        origin: ENGINEERING,
        source: "docs/v2/PLAN.md:148; TIER-ADMISSION.md finds the bound does not predict precision",
    },
    Gate {
        name: "lift",
        constant: "MIN_LIFT = 1.5; MIN_LIFT_EXTERNAL_CALL = 3.0 for calls into packages and built-ins, and directives",
        passes: "a rule the role follows at least 1.5 times (3 times) as often as all units of its kind",
        origin: ENGINEERING,
        source: "docs/v2/PLAN.md:150; the 3.0 from one labelled round, docs/v2/EVAL-2026-11-05.md:70",
    },
    // The precision filters every draft passes (`mine.rs` `unproposable`).
    Gate {
        name: "mandated",
        constant: "frameworks::MANDATES (a list of framework names)",
        passes: "a rule no framework the repository uses mandates",
        origin: ENGINEERING,
        source: "mine.rs `unproposable` (a name list)",
    },
    Gate {
        name: "tautology",
        constant: "the target is named after the role's folder or file kind",
        passes: "a rule that does not restate the role's name",
        origin: ENGINEERING,
        source: "mine.rs `is_tautology`",
    },
    Gate {
        name: "python_family_hidden",
        constant: "Python order rules, os.environ avoidance, calls on HTTP handlers",
        passes: "a Python rule of another family",
        origin: STUDY,
        source: "relabel3: 0 of 3, 0 of 3, 0 of 7 accepted (mine.rs `hidden_python_family`)",
    },
    Gate {
        name: "holders_one_file",
        constant: "ROLE_MIN_FILES = 3",
        passes: "holders in at least 3 files",
        origin: STUDY,
        source: "docs/v2/PYTHON.md:669 (one labelled failure: 20 tasks in two files)",
    },
    Gate {
        name: "how_built",
        constant: "class-name helpers in components; the calls an exported value is built with",
        passes: "a call that is no part of how the code is built",
        origin: ENGINEERING,
        source: "mine.rs `describes_how_built`",
    },
    Gate {
        name: "file_local",
        constant: "HOLDER_MIN_FILES = 3, HOLDER_FILE_DENSITY = 10",
        passes: "holders spread over enough files of the role",
        origin: RATIONALE,
        source: "mine.rs `file_local`",
    },
    Gate {
        name: "path_params",
        constant: "the rule follows the handlers' path parameters",
        passes: "a rule that is not the route's shape",
        origin: ENGINEERING,
        source: "mine.rs `follows_path_params`",
    },
    Gate {
        name: "key_structure",
        constant: "the rule follows the tables' primary keys",
        passes: "a rule that is not the table's key structure",
        origin: ENGINEERING,
        source: "mine.rs `follows_key_structure`",
    },
    Gate {
        name: "input",
        constant: "the rule follows whether the handlers take input",
        passes: "a validation rule whose outliers do take input",
        origin: ENGINEERING,
        source: "mine.rs `follows_input`",
    },
    Gate {
        name: "other_kind_outliers",
        constant: "FIELD_FRAMEWORK_SHARE = 0.9",
        passes: "a rule some outlier of which is of the role's own kind",
        origin: ENGINEERING,
        source: "mine.rs `outliers_of_another_kind`",
    },
    Gate {
        name: "lint_layering",
        constant: "the linter's import restrictions",
        passes: "a layering rule not against the direction the linter states",
        origin: ENGINEERING,
        source: "mine.rs `against_lint_layering`",
    },
    Gate {
        name: "lint",
        constant: "the linter enforces the rule (error), or the team turned it off",
        passes: "a rule the linter does not decide",
        origin: ENGINEERING,
        source: "mine.rs `unproposable`",
    },
    Gate {
        name: "uncorroborated",
        constant: "absence of console.*, bare Error, process.env, typing.Any",
        passes: "an avoidance something else in the repository corroborates",
        origin: ENGINEERING,
        source: "mine.rs `corroborated`",
    },
    Gate {
        name: "call_family_hidden",
        constant: "TypeScript calls rules whose callee is no guard",
        passes: "a calls rule on a guard, or a Python one",
        origin: STUDY,
        source: "dev relabel3: 2 of 14 accepted (mine.rs `hidden_call_rule`)",
    },
    // After the filters (`mine.rs` `dedupe`, the caps, `narrow`).
    Gate {
        name: "duplicate",
        constant: "same holders; a variant set over its members; CHILD_MARGIN = 0.05 across depths; NEAR_DUPLICATE = 0.9 outlier Jaccard",
        passes: "a rule no stronger rule of its role (or a nested role) already says",
        origin: ENGINEERING,
        source: "mine.rs `dedupe`",
    },
    Gate {
        name: "cap_role",
        constant: "MAX_PER_ROLE = 5 (counts drafts the show policy will hide)",
        passes: "one of the 5 best-scored drafts of its role",
        origin: ENGINEERING,
        source: "mine.rs; not show-aware (PLAN-R14 WS-H(a))",
    },
    Gate {
        name: "cap_avoid",
        constant: "AVOID_MAX_SHARE = 0.25 of --max (4 of 15): layering rules per repository",
        passes: "one of the best-scored layering rules within a quarter of --max; default-tier ones are cut too",
        origin: ENGINEERING,
        source: "mine.rs `cap_shown`",
    },
    Gate {
        name: "cap_repo",
        constant: "--max (DEFAULT_MAX_PER_REPO = 15) shown drafts per repository",
        passes: "one of the --max best-scored drafts the show policy shows",
        origin: ENGINEERING,
        source: "mine.rs `cap_shown`",
    },
    Gate {
        name: "narrowed_out",
        constant: "recounted over the members the rule is about: no holder left, or every member holds it",
        passes: "a rule still held, and broken, once exempt members are set aside (the bound is not checked again)",
        origin: RATIONALE,
        source: "mine.rs `narrow`, `join_siblings`; no re-check after recount (PLAN-R14 WS-H(c))",
    },
    Gate {
        name: "compiler",
        constant: "the compiler already enforces the rule",
        passes: "a rule the compiler does not check",
        origin: RATIONALE,
        source: "mine.rs `compiler_enforced`",
    },
    // The show policy (`show.rs`, data/show-policy.json) and Python proposals.
    Gate {
        name: "no_table",
        constant: "a valid show table in the build",
        passes: "any suggestion, when the table parses",
        origin: ENGINEERING,
        source: "show.rs [STRICT]",
    },
    Gate {
        name: "no_family",
        constant: "the show table maps the rule kind to a family",
        passes: "a suggestion of a rule kind the table maps",
        origin: STUDY,
        source: "data/show-policy.json (run dev-v3-relabel6-2026-11-10)",
    },
    Gate {
        name: "hidden_family",
        constant: "data/show-policy.json `hidden` (TS calls, ordering, renders; Python ordering, repo)",
        passes: "a suggestion of a family shown in its language",
        origin: STUDY,
        source: "PLAN-R10 §4, run dev-v3-relabel6-2026-11-10; the owner's decision",
    },
    Gate {
        name: "not_admitted",
        constant: "leave-one-repo-out accept at least 60% of at least 5 labelled cards",
        passes: "a suggestion of a family admitted for its language",
        origin: STUDY,
        source: "PLAN-R10 §4, run dev-v3-relabel6-2026-11-10; the owner's decision",
    },
    Gate {
        name: "max_outliers",
        constant: "data/show-policy.json `max_outliers` = 1",
        passes: "a suggestion with at most 1 outlier",
        origin: STUDY,
        source: "PLAN-R10 §4: TS 85.7% (48 of 56) in sample",
    },
    Gate {
        name: "python_off",
        constant: "`proposals: {python: off}` in .drift/config.yaml",
        passes: "any card while Python proposals are on (the default)",
        origin: STUDY,
        source: "decision D13-py (eval/study/README.md)",
    },
];

/// The gate named `name` ([`GATES`]).
pub fn gate(name: &str) -> Option<&'static Gate> {
    GATES.iter().find(|g| g.name == name)
}

/// Where a rule's target is defined, as the facts' ids say ([`crate::tier::outside_repo`]
/// reads the same prefixes): `repository` (a symbol the repository defines), `dependency`
/// (a package's, `pkg:`), `built_in` (a built-in or ambient global, `global#`),
/// `unresolved` (the linker could not tell), `mixed` (alternatives both in the
/// repository and outside it), `none` (a rule with no target: a name pattern, a control
/// fact, a model field, ...). A 12-of-12 rule about the repository's own helper is
/// another thing than one about a framework's decorator.
pub fn target_of(rule: &Rule) -> &'static str {
    let mut refs: Vec<&str> = Vec::new();
    match rule {
        Rule::WrappedBy { any_of, .. } => refs.extend(any_of.iter().map(String::as_str)),
        Rule::PassesKey { callee, .. } | Rule::Calls { callee } => refs.push(callee.as_str()),
        Rule::Renders { component } => refs.push(component.as_str()),
        Rule::Throws { class } => refs.push(class.as_str()),
        Rule::Before { first, then } => {
            refs.push(first.as_str());
            refs.push(then.as_str());
        }
        Rule::Avoids { signal } => {
            if let Some(t) = signal.strip_prefix("import:") {
                refs.push(t);
            }
        }
        Rule::ImportsFrom {
            source, instead_of, ..
        } => {
            refs.push(source.as_str());
            refs.extend(instead_of.iter().map(String::as_str));
        }
        _ => {}
    }
    if refs.is_empty() {
        return "none";
    }
    let outside = |r: &str| crate::tier::outside_repo(r);
    let inside = refs.iter().any(|r| !outside(*r));
    if inside && refs.iter().any(|r| outside(*r)) {
        "mixed"
    } else if inside {
        "repository"
    } else if refs.iter().any(|r| r.starts_with("pkg:")) {
        "dependency"
    } else if refs.iter().any(|r| r.starts_with("global#")) {
        "built_in"
    } else {
        "unresolved"
    }
}

/// [`target_of`] in words, for the text view ("" for a rule with no target).
fn target_words(target: &str) -> &'static str {
    match target {
        "repository" => "target defined in the repository",
        "dependency" => "target from a dependency",
        "built_in" => "target is a built-in",
        "unresolved" => "target not resolved",
        "mixed" => "targets in the repository and outside it",
        _ => "",
    }
}

/// One candidate a gate dropped.
#[derive(Debug, Clone)]
pub struct Dropped {
    /// The gate ([`GATES`]).
    pub gate: &'static str,
    /// The id the candidate would have had ([`crate::mine::convention_id`]).
    pub id: String,
    /// The role, in words ([`RoleSelector::describe`]).
    pub role: String,
    /// The rule, in words ([`Rule::describe`]).
    pub rule: String,
    /// The rule kind, `test:`-prefixed in the test roles' pass ([`family`]).
    pub family: String,
    /// `ts` or `py`.
    pub lang: &'static str,
    pub holders: usize,
    pub members: usize,
    /// The candidate's value at the gate, where the gate compares a number (the lower
    /// bound, the lift, the rank at a cap, the outliers).
    pub value: Option<f64>,
    /// The gate's threshold for that value.
    pub threshold: Option<f64>,
    /// The value against the threshold, in words: "lower bound 0.58 under 0.75".
    pub detail: String,
    /// [`target_of`].
    pub target: &'static str,
    /// The tier the candidate's rule would have ([`crate::tier::tier_of`]) is the default tier.
    pub default_tier: bool,
}

impl Dropped {
    /// A candidate of `role` and `rule` with `holders` of `members`, dropped at `gate`.
    pub fn new(
        gate: &'static str,
        role: &RoleSelector,
        rule: &Rule,
        (holders, members): (usize, usize),
        lang: &'static str,
        default_tier: bool,
    ) -> Self {
        debug_assert!(self::gate(gate).is_some(), "unknown gate {gate}");
        Dropped {
            gate,
            id: crate::mine::convention_id(role, rule),
            role: role.describe(),
            rule: rule.describe(),
            family: family(rule),
            lang,
            holders,
            members,
            value: None,
            threshold: None,
            detail: String::new(),
            target: target_of(rule),
            default_tier,
        }
    }

    /// With the value the gate compared and its threshold.
    pub fn measured(mut self, value: Option<f64>, threshold: Option<f64>, detail: String) -> Self {
        self.value = value;
        self.threshold = threshold;
        self.detail = detail;
        self
    }
}

/// What is recorded: every gate, or only those named.
struct Collector {
    only: Option<BTreeSet<&'static str>>,
    rows: Vec<Dropped>,
}

thread_local! {
    static DROPS: RefCell<Option<Collector>> = const { RefCell::new(None) };
}

/// Start recording dropped candidates on this thread: at every gate, or (`only`) at the
/// gates named. `census --why` records every gate; the plain `census` records only the
/// caps, to say when they cut a default-tier rule ([`cap_note`]).
pub fn record(only: Option<&[&'static str]>) {
    let only = only.map(|g| g.iter().copied().collect());
    DROPS.with(|d| {
        *d.borrow_mut() = Some(Collector {
            only,
            rows: Vec::new(),
        })
    });
}

/// True while recording at any gate.
pub fn recording() -> bool {
    DROPS.with(|d| d.borrow().is_some())
}

/// True while recording at `gate`.
pub fn wants(gate: &str) -> bool {
    DROPS.with(|d| {
        d.borrow()
            .as_ref()
            .is_some_and(|c| c.only.as_ref().is_none_or(|o| o.contains(gate)))
    })
}

/// Record one dropped candidate (nothing unless [`wants`] its gate).
pub fn note(row: Dropped) {
    DROPS.with(|d| {
        if let Some(c) = d.borrow_mut().as_mut()
            && c.only.as_ref().is_none_or(|o| o.contains(row.gate))
        {
            c.rows.push(row);
        }
    });
}

/// Stop recording and return what was recorded, sorted ([`sort`]).
pub fn take_dropped() -> Vec<Dropped> {
    let mut rows = DROPS
        .with(|d| d.borrow_mut().take())
        .map(|c| c.rows)
        .unwrap_or_default();
    sort(&mut rows);
    rows
}

/// The show policy's reason as a gate name ([`GATES`]).
pub fn show_gate(reason: crate::show::Withheld) -> &'static str {
    use crate::show::Withheld;
    match reason {
        Withheld::NoTable => "no_table",
        Withheld::NoFamily => "no_family",
        Withheld::FamilyHidden => "hidden_family",
        Withheld::FamilyNotAdmitted => "not_admitted",
        Withheld::TooManyOutliers => "max_outliers",
        Withheld::PythonOff => "python_off",
    }
}

/// A mined card the show policy (or Python proposals off) withheld, as a dropped candidate.
pub fn dropped_card(c: &Candidate, reason: crate::show::Withheld) -> Dropped {
    use crate::show::Withheld;
    let lang = crate::tier::language_code(c.language());
    let scope = if crate::shapes::is_test_role(&c.role) {
        "test:"
    } else {
        ""
    };
    let outliers = crate::show::outliers(&c.evidence);
    let family_name = crate::show::family_name(&c.rule);
    let (value, threshold, detail) = match reason {
        Withheld::TooManyOutliers => {
            let max = crate::show::table().map_or(1, |t| t.max_outliers);
            (
                Some(outliers as f64),
                Some(max as f64),
                format!("{outliers} outliers, more than {max}"),
            )
        }
        Withheld::FamilyHidden => (
            None,
            None,
            format!("family {family_name} is never shown in {lang}"),
        ),
        Withheld::FamilyNotAdmitted => (
            None,
            None,
            format!("family {family_name} is not admitted in {lang} (below the show bar on the dev labels)"),
        ),
        other => (None, None, other.text()),
    };
    Dropped {
        gate: show_gate(reason),
        id: c.id.clone(),
        role: c.role.describe(),
        rule: c.rule.describe(),
        family: format!("{scope}{}", crate::tier::rule_kind(&c.rule)),
        lang,
        holders: c.evidence.holders,
        members: c.evidence.total,
        value,
        threshold,
        detail,
        target: target_of(&c.rule),
        default_tier: c.tier() == crate::tier::Tier::Default,
    }
}

/// The position of a gate in [`GATES`].
fn gate_rank(name: &str) -> usize {
    GATES
        .iter()
        .position(|g| g.name == name)
        .unwrap_or(usize::MAX)
}

/// By gate ([`GATES`] order), then strongest first: the larger share of holders over
/// members (compared as integers), then the larger role, then the words and the id, so the
/// order is total and the same on every run.
pub fn sort(rows: &mut [Dropped]) {
    rows.sort_by(|a, b| {
        gate_rank(a.gate)
            .cmp(&gate_rank(b.gate))
            .then((b.holders * a.members).cmp(&(a.holders * b.members)))
            .then(b.members.cmp(&a.members))
            .then_with(|| a.role.cmp(&b.role))
            .then_with(|| a.rule.cmp(&b.rule))
            .then_with(|| a.id.cmp(&b.id))
            .then_with(|| a.family.cmp(&b.family))
    });
}

/// The sum of the funnel's counts ([`finish`]) at `stage`, over every family.
fn stage_total(counts: Option<&serde_json::Value>, stage: &str) -> Option<u64> {
    let rows = counts?.get("rows")?.as_array()?;
    Some(
        rows.iter()
            .filter(|r| r["stage"] == stage)
            .filter_map(|r| r["n"].as_u64())
            .sum(),
    )
}

/// The stages `census --why` states before the gates: how many reached each point.
const REACHED: &[&str] = &[
    "roles",
    "role_mined",
    "observed",
    "drafted",
    "mined",
    "proposed",
];

/// How many each gate dropped, in [`GATES`] order (gates that dropped none left out).
fn per_gate<'r>(rows: &[&'r Dropped]) -> Vec<(&'static Gate, Vec<&'r Dropped>)> {
    GATES
        .iter()
        .map(|g| {
            (
                g,
                rows.iter()
                    .copied()
                    .filter(|d| d.gate == g.name)
                    .collect::<Vec<_>>(),
            )
        })
        .filter(|(_, ds)| !ds.is_empty())
        .collect()
}

fn row_json(d: &Dropped) -> serde_json::Value {
    serde_json::json!({
        "gate": d.gate,
        "id": d.id,
        "role": d.role,
        "rule": d.rule,
        "family": d.family,
        "lang": d.lang,
        "holders": d.holders,
        "members": d.members,
        "value": d.value.map(crate::mine::r3),
        "threshold": d.threshold,
        "detail": d.detail,
        "target": d.target,
        "default_tier": d.default_tier,
    })
}

/// `census --why --json`: the gates ([`GATES`], each with how many it dropped), how many
/// reached each stage ([`finish`]'s counts, when given), and every dropped candidate,
/// sorted ([`sort`]); only `only`'s when a gate is named.
pub fn why_json(
    counts: Option<&serde_json::Value>,
    rows: &[Dropped],
    only: Option<&str>,
) -> serde_json::Value {
    let rows: Vec<&Dropped> = rows
        .iter()
        .filter(|d| only.is_none_or(|g| d.gate == g))
        .collect();
    let mut dropped: BTreeMap<&str, usize> = BTreeMap::new();
    for d in &rows {
        *dropped.entry(d.gate).or_default() += 1;
    }
    let reached: serde_json::Map<String, serde_json::Value> = REACHED
        .iter()
        .filter_map(|s| Some((s.to_string(), serde_json::json!(stage_total(counts, s)?))))
        .collect();
    serde_json::json!({
        "schema": 1,
        "observation_only": true,
        "gate": only,
        "reached": reached,
        "gates": GATES
            .iter()
            .filter(|g| only.is_none_or(|o| g.name == o))
            .map(|g| serde_json::json!({
                "name": g.name,
                "constant": g.constant,
                "passes": g.passes,
                "origin": g.origin,
                "source": g.source,
                "dropped": dropped.get(g.name).copied().unwrap_or(0),
            }))
            .collect::<Vec<_>>(),
        "dropped": rows.iter().map(|d| row_json(d)).collect::<Vec<_>>(),
    })
}

/// `12345` as `12,345`.
fn thousands(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// `census --why`: how many reached each stage, how many each gate dropped, then the
/// dropped candidates grouped by gate, strongest first, at most `per_gate_cap` per gate
/// with "and N more"; only `only`'s when a gate is named.
pub fn why_text(
    counts: Option<&serde_json::Value>,
    rows: &[Dropped],
    only: Option<&str>,
    per_gate_cap: usize,
) -> String {
    use std::fmt::Write as _;
    let rows: Vec<&Dropped> = rows
        .iter()
        .filter(|d| only.is_none_or(|g| d.gate == g))
        .collect();
    let mut out = String::new();
    out.push_str(
        "What mining dropped, gate by gate. Observation only: nothing listed here is proposed, checked or shown to agents, and the proposals are exactly those of `drift census`.\n",
    );
    let total = |s: &str| stage_total(counts, s).map(|n| thousands(n as usize));
    if let (Some(roles), Some(mined_roles), Some(observed), Some(drafted), Some(mined), Some(proposed)) = (
        total("roles"),
        total("role_mined"),
        total("observed"),
        total("drafted"),
        total("mined"),
        total("proposed"),
    ) {
        let _ = writeln!(
            out,
            "{roles} roles, {mined_roles} of them with {} or more members across files; {observed} candidate rules observed, {drafted} drafted, {mined} mined, {proposed} proposed.",
            crate::mine::MIN_ROLE_SIZE
        );
    }
    let groups = per_gate(&rows);
    if groups.is_empty() {
        match only {
            Some(g) => {
                let _ = writeln!(out, "\nNo candidate was dropped at `{g}`.");
            }
            None => out.push_str("\nNo candidate was dropped.\n"),
        }
        return out;
    }
    out.push_str("\nDropped per gate, in the order mining applies them:\n");
    let width = groups.iter().map(|(g, _)| g.name.len()).max().unwrap_or(0);
    for (g, ds) in &groups {
        let _ = writeln!(
            out,
            "  {:<width$}  {:>7}  ({})",
            g.name,
            thousands(ds.len()),
            g.origin
        );
    }
    for (g, ds) in &groups {
        let _ = writeln!(
            out,
            "\n{}: {} dropped. Passes: {}. Threshold: {} ({}; {}).",
            g.name,
            thousands(ds.len()),
            g.passes,
            g.constant,
            g.origin,
            g.source
        );
        for d in ds.iter().take(per_gate_cap) {
            let mut facts: Vec<String> = Vec::new();
            if !d.detail.is_empty() {
                facts.push(d.detail.clone());
            }
            let t = target_words(d.target);
            if !t.is_empty() {
                facts.push(t.to_string());
            }
            if d.default_tier {
                facts.push("default tier".to_string());
            }
            if d.lang == "py" {
                facts.push("Python".to_string());
            }
            let _ = writeln!(
                out,
                "  {} of {}  {}: {} ({})",
                d.holders,
                d.members,
                d.role,
                d.rule,
                facts.join("; ")
            );
        }
        if ds.len() > per_gate_cap {
            let _ = writeln!(
                out,
                "  and {} more (`drift census --why {} --json` lists every one)",
                thousands(ds.len() - per_gate_cap),
                g.name
            );
        }
    }
    out
}

/// The caps of mining that can cut a default-tier rule.
pub const CAP_GATES: &[&str] = &["cap_role", "cap_avoid", "cap_repo"];

/// What `census` says when mining's caps cut default-tier rules: how many, by which cap,
/// and how to see them. `None` when they cut none. The `--suggestions` cap never hides a
/// default-tier proposal; these caps, applied while mining, can (the layering share of
/// `--max` in particular), and the proposals are left as they are: this only says so.
pub fn cap_note(rows: &[Dropped], max: usize) -> Option<String> {
    let mut by: BTreeMap<usize, (&str, usize)> = BTreeMap::new();
    for d in rows.iter().filter(|d| d.default_tier) {
        if let Some(i) = CAP_GATES.iter().position(|g| *g == d.gate) {
            by.entry(i).or_insert((CAP_GATES[i], 0)).1 += 1;
        }
    }
    let n: usize = by.values().map(|(_, n)| n).sum();
    if n == 0 {
        return None;
    }
    let avoid = ((max as f64 * 0.25).ceil() as usize).max(1);
    let parts: Vec<String> = by
        .values()
        .map(|(g, k)| match *g {
            "cap_role" => format!(
                "{k} by the cap of {} per role",
                crate::mine::MAX_PER_ROLE
            ),
            "cap_avoid" => format!(
                "{k} by the layering share, at most {avoid} layering rules per repository (a quarter of --max {max})"
            ),
            _ => format!("{k} by the cap of {max} per repository (--max)"),
        })
        .collect();
    let see = if by.len() == 1 {
        let g = by.values().next().map_or("cap_repo", |(g, _)| *g);
        format!("`drift census --why {g}` lists them")
    } else {
        "`drift census --why` lists them under each cap".to_string()
    };
    let raise = if by.values().any(|(g, _)| *g != "cap_role") {
        ", and a larger --max proposes them"
    } else {
        ""
    };
    Some(format!(
        "{n} default-tier rule{} not proposed because of mining's caps ({}). The default tier is otherwise listed in full: {see}{raise}.",
        if n == 1 { " was" } else { "s were" },
        parts.join("; ")
    ))
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

    fn row(gate: &'static str, holders: usize, members: usize, default_tier: bool) -> Dropped {
        Dropped {
            gate,
            id: format!("D-{gate}{holders}{members}"),
            role: "app/** HTTP handlers".to_string(),
            rule: "are wrapped in `f()`".to_string(),
            family: "wrapped_by:call".to_string(),
            lang: "ts",
            holders,
            members,
            value: None,
            threshold: None,
            detail: String::new(),
            target: "repository",
            default_tier,
        }
    }

    /// Every gate name is documented once, and the funnel's own stages use the same names.
    #[test]
    fn gates_are_named_once() {
        let names: BTreeSet<&str> = GATES.iter().map(|g| g.name).collect();
        assert_eq!(names.len(), GATES.len());
        for g in GATES {
            assert!(
                STAGES.contains(&g.name) || show_gate_names().contains(&g.name),
                "{}",
                g.name
            );
        }
    }

    fn show_gate_names() -> Vec<&'static str> {
        use crate::show::Withheld::*;
        [
            NoTable,
            NoFamily,
            FamilyHidden,
            FamilyNotAdmitted,
            TooManyOutliers,
            PythonOff,
        ]
        .into_iter()
        .map(show_gate)
        .collect()
    }

    /// A rule's target: the repository's own symbol, a package's, a built-in, none.
    #[test]
    fn targets_say_where_they_are_defined() {
        let wrapped = |any_of: &[&str]| Rule::WrappedBy {
            kind: drift_core::WrapKind::Decorator,
            any_of: any_of.iter().map(|s| s.to_string()).collect(),
        };
        assert_eq!(target_of(&wrapped(&["lib/auth.ts#withAuth"])), "repository");
        assert_eq!(target_of(&wrapped(&["pkg:@nestjs/common#Injectable"])), "dependency");
        assert_eq!(target_of(&wrapped(&["global#fetch"])), "built_in");
        assert_eq!(target_of(&wrapped(&["unresolved:x#y"])), "unresolved");
        assert_eq!(
            target_of(&wrapped(&["lib/auth.ts#a", "pkg:p#b"])),
            "mixed"
        );
        assert_eq!(
            target_of(&Rule::Named {
                pattern: "use*".to_string()
            }),
            "none"
        );
        assert_eq!(
            target_of(&Rule::Avoids {
                signal: "import:lib/jobs".to_string()
            }),
            "repository"
        );
    }

    /// Recording at chosen gates keeps only those; off, nothing is kept; rows come back
    /// by gate, strongest first.
    #[test]
    fn records_only_what_was_asked_and_sorts_it() {
        DROPS.with(|d| *d.borrow_mut() = None);
        note(row("wilson", 9, 10, false));
        assert!(take_dropped().is_empty());
        record(Some(CAP_GATES));
        assert!(wants("cap_avoid") && !wants("wilson"));
        note(row("wilson", 9, 10, false));
        note(row("cap_avoid", 30, 31, true));
        assert_eq!(take_dropped().len(), 1);
        assert!(!recording());
        record(None);
        note(row("wilson", 9, 12, false));
        note(row("wilson", 18, 20, false));
        note(row("universal", 8, 8, false));
        note(row("wilson", 9, 10, false));
        let rows = take_dropped();
        let got: Vec<(&str, usize, usize)> =
            rows.iter().map(|d| (d.gate, d.holders, d.members)).collect();
        assert_eq!(
            got,
            vec![
                ("universal", 8, 8),
                ("wilson", 18, 20),
                ("wilson", 9, 10),
                ("wilson", 9, 12)
            ]
        );
    }

    /// The caps' note says how many default-tier rules each cap cut, and nothing when none.
    #[test]
    fn cap_note_counts_default_tier_cuts() {
        assert!(cap_note(&[row("cap_avoid", 30, 31, false)], 15).is_none());
        let n = cap_note(
            &[
                row("cap_avoid", 30, 31, true),
                row("cap_avoid", 20, 21, true),
                row("wilson", 9, 12, true),
            ],
            15,
        )
        .unwrap();
        assert!(
            n.starts_with("2 default-tier rules were not proposed because of mining's caps (2 by the layering share, at most 4 layering rules per repository"),
            "{n}"
        );
        assert!(n.contains("`drift census --why cap_avoid` lists them"), "{n}");
    }

    #[test]
    fn why_text_caps_each_gate() {
        let rows: Vec<Dropped> = (0..12).map(|i| row("universal", 20 - i, 20 - i, false)).collect();
        let text = why_text(None, &rows, None, 10);
        assert!(text.contains("\nuniversal: 12 dropped."), "{text}");
        assert!(text.contains("  20 of 20  "), "{text}");
        assert!(!text.contains("  9 of 9  "), "{text}");
        assert!(text.contains("  and 2 more (`drift census --why universal --json`"), "{text}");
    }
}
