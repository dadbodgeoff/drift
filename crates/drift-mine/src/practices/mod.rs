//! The practice map: a descriptive inventory of what the codebase does for each
//! cross-cutting concern, with each variant, its share and where it lives
//! (eval/study/PLAN-R13.md §0, §1, §3). Facts, not rules: nothing here goes through
//! the show policy or the caps, and nothing here is enforced.
//!
//! This module holds the contract: the concern ids ([`CONCERNS`]), the JSON types of
//! `drift practices --json` version 1 ([`PracticesReport`]), the interface every
//! concern classifier implements ([`Concern`]) and the engine entry point
//! ([`practices`]). The engine (`engine.rs`) groups each concern's units by variant
//! key and says where each variant is, what sets it apart, an example to copy, the
//! exceptions in its places, and each package's profile.
//!
//! # Adding a concern classifier
//!
//! One file per concern, `practices/<id>.rs` (`authn.rs`, `authz.rs`, `errors.rs`,
//! `logging.rs`, `api.rs`, `validation.rs`, `config.rs`, `data.rs`, `testing.rs`), with
//! a unit struct that implements [`Concern`]:
//!
//! ```ignore
//! use super::{Assignment, Concern, Cx, UnitRef, Use, VariantSource};
//!
//! pub struct Authn;
//!
//! impl Concern for Authn {
//!     fn id(&self) -> &'static str { super::AUTHN }
//!     fn unit(&self) -> &'static str { "entry_point" }
//!     fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> { ... }
//!     fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment { ... }
//! }
//! ```
//!
//! Then add ONE line to the `concerns!` list below, `authn::Authn,`: it declares the
//! module and registers the classifier. Nothing else in this file changes. The rules:
//!
//! - [`Concern::id`] is one of the frozen ids of [`CONCERNS`], and each id is
//!   registered once (a test checks both).
//! - [`Concern::population`] returns units in a deterministic order (facts order is
//!   sorted, so iterating files and symbols in order is enough).
//! - [`Concern::assign`] is a pure function of the facts: [`Assignment::Known`] with
//!   the `mechanism:instrument` uses (the engine sorts and de-duplicates them into the
//!   variant key, so a split policy is one key), [`Assignment::None`] for a recorded
//!   absence, or [`Assignment::Unknown`] with a reason. A unit with any unparsed file
//!   or opaque instrument is `Unknown`, even if other instruments are known [STRICT];
//!   no unknown unit is ever `None`.
//! - Nothing in a classifier says what may be promoted to a rule: a person promotes a
//!   variant in a place where the counts allow it ([`promote`]), and the rule is
//!   checked by the classifier itself, never mapped to a name-matching rule.
//! - Vocabularies go in `libraries.rs` as `*_LIBRARIES` / `*_CALLEES` consts (the vocab
//!   test forbids `const *_WORDS` outside `vocab.rs`); auth decisions go through
//!   `security::authenticates` / `security::callee_is_guard`, never `grant::`.

pub mod basis;
mod common;
mod depart;
mod dupes;
mod engine;
pub mod libraries;
mod matcher;
pub mod promote;
mod py_authz;
mod render;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol};
use serde::{Deserialize, Serialize};

/// Declares each concern classifier's module and registers it, in one line per
/// concern (`authn::Authn,`). The engine orders concerns by [`CONCERNS`], not by
/// this list.
macro_rules! concerns {
    ($($module:ident :: $classifier:ident),* $(,)?) => {
        $(mod $module;)*
        /// Every registered concern classifier.
        pub fn registry() -> Vec<Box<dyn Concern>> {
            vec![$(Box::new($module::$classifier)),*]
        }
    };
}

concerns![
    // One line per concern classifier, e.g. `authn::Authn,`.
    authn::Authn,
    authz::Authz,
    errors::Errors,
    logging::Logging,
    api::Api,
    validation::Validation,
    config::Config,
    data::DataAccess,
    testing::Testing,
];

/// `drift practices --json` version.
pub const VERSION: u32 = 1;
/// The coverage each concern aims at ([`Summary::target`]).
pub const TARGET: f64 = 0.9;

/// The frozen concern ids (PLAN-R13 §0.1). Every JSON output, the MCP tool, the
/// Studio, the `.drift/config.yaml` `practices:` keys and the eval scripts use them.
pub const AUTHN: &str = "authn";
pub const AUTHZ: &str = "authz";
pub const ERRORS: &str = "errors";
pub const LOGGING: &str = "logging";
pub const API: &str = "api";
pub const VALIDATION: &str = "validation";
pub const CONFIG: &str = "config";
pub const DATA_ACCESS: &str = "data_access";
pub const TESTING: &str = "testing";

/// `(id, title)` of every concern, in slice order: the order of
/// [`PracticesReport::concerns`].
pub const CONCERNS: &[(&str, &str)] = &[
    (AUTHN, "Authentication"),
    (AUTHZ, "Authorization and tenant scoping"),
    (ERRORS, "Error handling"),
    (LOGGING, "Logging and observability"),
    (API, "API design and responses"),
    (VALIDATION, "Input validation"),
    (CONFIG, "Config, secrets, feature flags"),
    (DATA_ACCESS, "Data access"),
    (TESTING, "Testing practice"),
];

/// Output caps (PLAN-R13 §0.3).
pub mod caps {
    /// Each list of [`super::Where`].
    pub const WHERE: usize = 8;
    /// [`super::Variant::examples`] and [`super::UnknownReport::examples`].
    pub const EXAMPLES: usize = 3;
    /// [`super::Variant::exceptions`]; the rest are counted in `exceptions_more`.
    pub const EXCEPTIONS: usize = 10;
    /// [`super::Variant::sets_apart`].
    pub const SETS_APART: usize = 3;
    /// [`super::PracticesReport::recipes`].
    pub const RECIPES: usize = 20;
    /// [`super::PracticesReport::findings`].
    pub const FINDINGS: usize = 25;
    /// [`super::VariantGroup::top`].
    pub const GROUP_VARIANTS: usize = 5;
    /// [`super::Finding::copies`]; the finding's `members` counts every copy.
    pub const COPIES: usize = 8;
    /// Duplicate-helper findings in [`super::PracticesReport::findings`], one per
    /// helper name, listed after the other kinds and not counted in [`FINDINGS`]: a
    /// repository that copies has many, and they take no other finding's place.
    pub const DUPLICATE_FINDINGS: usize = 5;
}

/// The title of a concern id, `None` for an id that is no concern.
pub fn concern_title(id: &str) -> Option<&'static str> {
    CONCERNS.iter().find(|(c, _)| *c == id).map(|(_, t)| *t)
}

/// A variant's id: `P-` and 6 hex digits of blake3 of `concern + "\0" + key`.
pub fn variant_id(concern: &str, key: &str) -> String {
    let h = blake3::hash(format!("{concern}\0{key}").as_bytes());
    format!("P-{}", &h.to_hex()[..6])
}

// ---------- the classifier interface ----------

/// What the engine hands every classifier. Build one with [`Cx::new`]; the repo
/// context ([`Cx::context`]) is built on first use, once. The engine runs the
/// classifiers side by side, so what a run remembers is behind locks.
pub struct Cx<'a> {
    pub facts: &'a RepoFacts,
    /// `.drift/config.yaml` `practices:`, `concern -> canonical -> label`, written by a
    /// person: the first source of an instrument's classification.
    pub declared: &'a Declared,
    context: OnceLock<crate::context::RepoContext<'a>>,
    overrides: OnceLock<BTreeSet<(String, String)>>,
    test_files: OnceLock<Vec<&'a FileFacts>>,
    serving: OnceLock<BTreeSet<&'a str>>,
    rivals: OnceLock<Vec<testing::Rival<'a>>>,
    /// The keys this repository's own queries scope rows to the caller by
    /// (`authz::scope_keys`), learned once for the run.
    scope_keys: OnceLock<BTreeSet<String>>,
}

impl<'a> Cx<'a> {
    pub fn new(facts: &'a RepoFacts, declared: &'a Declared) -> Self {
        Cx {
            facts,
            declared,
            context: OnceLock::new(),
            overrides: OnceLock::new(),
            test_files: OnceLock::new(),
            serving: OnceLock::new(),
            rivals: OnceLock::new(),
            scope_keys: OnceLock::new(),
        }
    }

    /// The keys this repository scopes rows to the caller by, as `learn` finds them
    /// in the facts: asked for every authorization unit, answered once for the run.
    pub(super) fn scope_keys(
        &self,
        learn: impl FnOnce(&Self) -> BTreeSet<String>,
    ) -> &BTreeSet<String> {
        self.scope_keys.get_or_init(|| learn(self))
    }

    /// The facts' test files ([`crate::roles::is_test_path`]), in the facts' order.
    /// Found once for the run: a classifier that reads them for every unit (testing)
    /// would otherwise test every path of the repository once per unit.
    pub fn test_files(&self) -> &[&'a FileFacts] {
        self.test_files.get_or_init(|| {
            self.facts
                .files
                .iter()
                .filter(|f| crate::roles::is_test_path(&f.path))
                .collect()
        })
    }

    /// The packages that serve entry points the testing concern counts, as `read`
    /// finds them in the facts: asked for every unit, answered once for the run.
    pub(super) fn serving_packages(
        &self,
        read: impl FnOnce(&Self) -> BTreeSet<&'a str>,
    ) -> &BTreeSet<&'a str> {
        self.serving.get_or_init(|| read(self))
    }

    /// The routed entry points a test's request may be for, as `read` finds them in
    /// the facts: asked for every unit the testing concern matches through a
    /// parameter, answered once for the run.
    fn rivals(&self, read: impl FnOnce(&Self) -> Vec<testing::Rival<'a>>) -> &[testing::Rival<'a>] {
        self.rivals.get_or_init(|| read(self))
    }

    /// The repo context that [`crate::security::authenticates`] and
    /// [`crate::security::callee_is_guard`] read, built once for the whole run.
    pub fn context(&self) -> &crate::context::RepoContext<'a> {
        self.context.get_or_init(|| {
            crate::context::RepoContext::new(self.facts, &[]).reading_since_measured()
        })
    }

    /// A production class of the repository that extends `class` (canonical), at any
    /// depth, defines `method` itself: an instance typed by `class` may be that
    /// subclass's, and then the subclass's method runs. Classes of test files do not
    /// count (a test double overrides what it likes). Found once for the run.
    pub fn overridden(&self, class: &str, method: &str) -> bool {
        let overrides = self.overrides.get_or_init(|| {
            let ctx = self.context();
            let mut out = BTreeSet::new();
            for f in &self.facts.files {
                if crate::roles::is_test_path(&f.path) {
                    continue;
                }
                for s in f
                    .symbols
                    .iter()
                    .filter(|s| s.kind == drift_core::SymbolKind::Class)
                {
                    let own = format!("{}#{}", f.path, s.name);
                    for base in ctx.ancestors(&own) {
                        for m in &s.members {
                            out.insert((base.clone(), m.name.clone()));
                        }
                    }
                }
            }
            out
        });
        overrides.contains(&(
            crate::mine::norm_ref(class).into_owned(),
            method.to_string(),
        ))
    }

    /// The file and symbol that handle `entry` of `file`, through re-exports
    /// ([`crate::entries::entry_symbol`]).
    pub fn entry_symbol(
        &self,
        file: &'a FileFacts,
        entry: &EntryPoint,
    ) -> Option<(&'a FileFacts, &'a Symbol)> {
        crate::entries::entry_symbol(self.facts, file, entry)
    }

    /// The person's label for `canonical` under `concern` in `.drift/config.yaml`
    /// `practices:`, when there is one.
    pub fn declared_label(&self, concern: &str, canonical: &str) -> Option<&'a str> {
        let c = crate::mine::norm_ref(canonical);
        self.declared
            .get(concern)?
            .iter()
            .find(|(k, _)| crate::mine::norm_ref(k) == c)
            .map(|(_, v)| v.as_str())
    }
}

/// `.drift/config.yaml` `practices: {<concern>: {<canonical>: <label>}}`.
pub type Declared = BTreeMap<String, BTreeMap<String, String>>;

/// One unit of a concern's population. The engine derives each unit's "where"
/// (package, directory chain, roles, entry kind, method, route, language, stem) from
/// the file and symbol it points at.
#[derive(Debug, Clone, Copy)]
pub enum UnitRef<'a> {
    /// An entry point and the symbol that handles it (`None` when the resolver
    /// ([`Cx::entry_symbol`]) finds none: the engine reads the unit as unknown,
    /// `no_symbol`). The symbol may be in another file (a re-exported handler).
    Entry {
        file: &'a FileFacts,
        entry: &'a EntryPoint,
        symbol: Option<&'a Symbol>,
    },
    /// A symbol.
    Symbol {
        file: &'a FileFacts,
        symbol: &'a Symbol,
    },
    /// One catch / except clause: `symbol.catches[index]`.
    Catch {
        file: &'a FileFacts,
        symbol: &'a Symbol,
        index: usize,
    },
    /// A test file.
    TestFile { file: &'a FileFacts },
    /// A file.
    File { file: &'a FileFacts },
}

impl<'a> UnitRef<'a> {
    /// What the mount an entry unit is served through adds to it, beyond what its
    /// handler has on every mount ([`drift_core::FileFacts::mounts`]); none for most.
    pub fn mount(&self) -> Option<&'a drift_core::MountFacts> {
        match *self {
            UnitRef::Entry { file, entry, .. } => file.mount(entry),
            _ => None,
        }
    }

    /// The application middleware the unit's own mount passes through and its other
    /// mounts do not ([`drift_core::MountFacts::app_middleware`]).
    pub fn mount_middleware(&self) -> &'a [String] {
        self.mount().map_or(&[], |m| m.app_middleware.as_slice())
    }

    /// The wraps of [`UnitRef::mount`], outermost first.
    pub fn mount_wraps(&self) -> &'a [drift_core::Wrap] {
        self.mount().map_or(&[], |m| m.wraps.as_slice())
    }

    /// The file the unit is in.
    pub fn file(&self) -> &'a FileFacts {
        match *self {
            UnitRef::Entry { file, .. }
            | UnitRef::Symbol { file, .. }
            | UnitRef::Catch { file, .. }
            | UnitRef::TestFile { file }
            | UnitRef::File { file } => file,
        }
    }
}

/// One instrument a unit uses for a concern, and how it is applied: the key part
/// `mechanism:instrument` (`wrap:apps/web/lib/auth.ts#withWorkspace`).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Use {
    /// How (`wrap`, `decorator`, `dependency`, `middleware`, `body_check`, ...).
    pub mechanism: String,
    /// What: a canonical reference, or a vocabulary name.
    pub instrument: String,
}

/// A variant key: the sorted, de-duplicated uses of a unit, joined as
/// `mechanism:instrument+mechanism:instrument`.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct VariantKey {
    pub uses: Vec<Use>,
    pub key: String,
}

impl VariantKey {
    pub fn new(uses: &[Use]) -> Self {
        let mut uses = uses.to_vec();
        uses.sort();
        uses.dedup();
        let key = uses
            .iter()
            .map(|u| format!("{}:{}", u.mechanism, u.instrument))
            .collect::<Vec<_>>()
            .join("+");
        VariantKey { uses, key }
    }
}

/// How a classifier assigns one unit.
#[derive(Debug, Clone, PartialEq)]
pub enum Assignment {
    /// The unit does the concern with these uses. `label` reads as the variant's
    /// label ("wrapped in withWorkspace()").
    Known {
        uses: Vec<Use>,
        label: String,
        source: VariantSource,
    },
    /// A recorded absence: for authentication and authorization, nothing found in what
    /// Drift read ([`basis::AUTHN_NONE`]); elsewhere "not tested", "no validation".
    None { label: String },
    /// What the unit does cannot be told; counted against coverage, never hidden.
    Unknown {
        reason: UnknownReason,
        /// The instrument that could not be classified ("" when none).
        instrument: String,
    },
}

/// What stands behind one unit's assignment beyond its variant
/// ([`Concern::assign_backed`]): what the card of a file says of the unit itself.
/// Only `testing` gives one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Backing {
    /// The test files that cover the entry point, sorted.
    pub tests: Vec<String>,
    /// The cases the entry point's own profile calls for (`401`, `403`, `404`,
    /// `400/422`, in that order). Empty when it calls for none, and when its tests
    /// assert no status at all (the cases are then not worked out).
    pub required: Vec<String>,
    /// Those of `required` no covering test asserts.
    pub missing: Vec<String>,
    /// Of a unit unknown as [`UnknownReason::CheckNotProven`]: the check that was
    /// found and what is not proven of it. Authz only.
    pub unproven: Option<Unproven>,
    /// Of a unit the classifier records as an absence: what it read and what it saw and
    /// did not read ([`basis::Basis`]). Authz only; the engine asks the others through
    /// [`Concern::basis`].
    pub basis: Option<basis::Basis>,
}

/// A check found for a unit that is not proven to be the unit's practice
/// ([`UnknownReason::CheckNotProven`]): the unit stays unknown, and what was found is
/// said, never dropped and never told as a fact about the unit.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct Unproven {
    /// The check's key as it would have been named
    /// (`tenancy_check:app/services/projects.py#ProjectService._ensure_team_access`).
    pub check: String,
    /// Which obligation failed ([`obligation`]).
    pub obligation: String,
    /// The condition in the code's own words, where the facts state it (`only when
    /// principal.org_id is not None`); "" otherwise.
    pub when: String,
    /// A `practices:` line naming the check's symbol settles the unit: the symbol is
    /// called on every path of the unit, and what is not proven is inside it or about
    /// what it is. False where the unit only sometimes reaches it.
    pub declarable: bool,
}

/// The obligations a found check can fail ([`Unproven::obligation`]), a closed list.
/// `known` needs proof that the check runs on every request to the unit and compares
/// something of the caller with something of the resource or the request.
pub mod obligation {
    /// Under a branch only some requests take, or in a loop.
    pub const UNDER_BRANCH: &str = "under_branch";
    /// After a branch that returns without refusing.
    pub const AFTER_CONDITIONAL_RETURN: &str = "after_conditional_return";
    /// An operand of `and`: it decides only when the other operands hold.
    pub const AND_OPERAND: &str = "and_operand";
    /// The right side of `or`: skipped when the left side holds.
    pub const BYPASS_OPERAND: &str = "bypass_operand";
    /// The call's result is not awaited.
    pub const NOT_AWAITED: &str = "not_awaited";
    /// Its refusal may be caught by a handler that serves the request all the same.
    pub const SWALLOWED: &str = "swallowed";
    /// Only the name of what is called says it is a check.
    pub const BY_NAME_ONLY: &str = "by_name_only";
    /// The two sides compared are not proven to be the caller's and the resource's.
    pub const SIDES_NOT_CALLER_AND_RESOURCE: &str = "sides_not_caller_and_resource";
    /// A call that may change data runs before it: it refuses after the effect.
    pub const AFTER_EFFECT: &str = "after_effect";
    /// Nothing read runs it for the unit (a DRF object permission of a view that never
    /// asks for the object check).
    pub const NOT_CALLED: &str = "not_called";
    /// What it calls to decide was not read.
    pub const CALLEE_UNREAD: &str = "callee_unread";
    /// A subclass overrides the method that holds it.
    pub const OVERRIDDEN: &str = "overridden";
    /// A policy decision is computed and nothing refuses on it: its result goes to a
    /// header, a log or nowhere.
    pub const RESULT_NOT_REFUSED: &str = "result_not_refused";
    /// A filter by the caller scopes its own query, and another query of the unit
    /// selects rows by nothing of the caller.
    pub const OTHER_READ_UNSCOPED: &str = "other_read_unscoped";
    /// No path on which every request reaches it was read (a symbol a person declared
    /// in `.drift/config.yaml` that the unit is not shown to call on every path).
    pub const PATH_UNREAD: &str = "path_unread";

    /// The obligation a [`drift_core::not_always`] reason of a conditional call fails;
    /// [`PATH_UNREAD`] for one this list does not know.
    pub fn of_not_always(why: &str) -> &'static str {
        [
            UNDER_BRANCH,
            AFTER_CONDITIONAL_RETURN,
            AND_OPERAND,
            BYPASS_OPERAND,
            SWALLOWED,
            NOT_AWAITED,
        ]
        .into_iter()
        .find(|o| *o == why)
        .unwrap_or(PATH_UNREAD)
    }
}

/// What kind of check a mechanism is, in words.
fn check_words(mechanism: &str) -> &'static str {
    match mechanism {
        "tenancy_check" | "tenancy_guard" | "tenancy_filter" | "tenancy_requested" => {
            "a tenant check"
        }
        "role_check" | "role_guard" => "a role check",
        "owner_check" | "owner_filter" => "an owner check",
        "membership_guard" => "a membership check",
        "own_record" => "the caller's own record, and nothing else",
        "owner_stamp" => "rows created as the caller's own",
        "policy" => "a policy check",
        "declared" => "the check declared in .drift/config.yaml",
        _ => "an authorization check",
    }
}

/// The one line that says a check was found and is not proven, for a person to act
/// on: never worded as a fact about the unit. Every surface that names such a unit
/// uses this wording.
pub fn not_proven_line(check: &str, obligation: &str, when: &str) -> String {
    let (mechanism, instrument) = check.split_once(':').unwrap_or(("", check));
    let name = instrument.rsplit_once('#').map_or(instrument, |(_, n)| n);
    let name = name.rsplit('.').next().unwrap_or(name);
    let name = crate::report::sanitize(name, 80);
    let when = crate::report::sanitize(when, 120);
    let stated = |prefix: &str| when.strip_prefix(prefix).map(str::to_string);
    let why = match obligation {
        obligation::UNDER_BRANCH => match stated("only when ") {
            Some(w) => format!("it runs only when {w}"),
            None => "it runs only on some paths (under a branch or in a loop)".to_string(),
        },
        obligation::AFTER_CONDITIONAL_RETURN => match stated("not when ") {
            Some(w) => format!("it is skipped when {w}"),
            None => "a branch before it returns without it".to_string(),
        },
        obligation::AND_OPERAND => match stated("only when ") {
            Some(w) => format!("it decides only when {w}"),
            None => {
                "it is one operand of an `and` and decides only when the others hold".to_string()
            }
        },
        obligation::BYPASS_OPERAND => match stated("not when ") {
            Some(w) => format!("it is skipped when {w}"),
            None => "it is the right side of an `or` and is skipped when the left side holds"
                .to_string(),
        },
        obligation::SWALLOWED => {
            "its refusal may be caught by a handler that serves the request all the same"
                .to_string()
        }
        obligation::NOT_CALLED => {
            "its object check runs only where the view calls `get_object()` or `check_object_permissions()`, and none was read".to_string()
        }
        obligation::NOT_AWAITED => {
            "its call is not awaited, so its refusal does not stop the request".to_string()
        }
        obligation::PATH_UNREAD => {
            "no path on which every request reaches it was read".to_string()
        }
        obligation::AFTER_EFFECT => {
            // `when`: the call that was taken as the write, so a wrong guess shows.
            let call = if when.is_empty() {
                String::new()
            } else {
                format!(" (`{when}`)")
            };
            return format!(
                "unknown: {} was found (`{name}`) but it runs after the route has already changed data{call}",
                check_words(mechanism)
            );
        }
        obligation::RESULT_NOT_REFUSED => {
            return format!(
                "unknown: {} was found (`{name}`) but nothing read refuses the request on its decision",
                check_words(mechanism)
            );
        }
        obligation::BY_NAME_ONLY => {
            return format!(
                "unknown: {} was found by its name only (`{name}`): no comparison of the caller with what is asked for was read in it",
                check_words(mechanism)
            );
        }
        obligation::OTHER_READ_UNSCOPED => {
            // `when`: the query that selects rows by nothing of the caller.
            let other = if when.is_empty() {
                String::new()
            } else {
                format!(" (`{when}`)")
            };
            return format!(
                "unknown: a query filtered by the caller was found (`{name}`) but another query of the route selects rows by nothing of the caller{other}"
            );
        }
        obligation::SIDES_NOT_CALLER_AND_RESOURCE if mechanism.ends_with("_filter") => {
            return format!(
                "unknown: a query filtered by `{name}` was found but the value it filters by is not proven to be the caller's own"
            );
        }
        obligation::SIDES_NOT_CALLER_AND_RESOURCE => {
            return format!(
                "unknown: {} was found (`{name}`) but the two sides it compares are not proven to be the caller's and the resource's",
                check_words(mechanism)
            );
        }
        _ => format!("{obligation} is not proven"),
    };
    format!(
        "unknown: {} was found (`{name}`) but is not proven to run on every request: {why}",
        check_words(mechanism)
    )
}

/// A concern classifier (one per file, registered in `concerns!`).
pub trait Concern: Sync {
    /// One of [`CONCERNS`].
    fn id(&self) -> &'static str;
    /// What one unit of the population is (`entry_point`, `symbol`, `catch`,
    /// `test_file`): [`ConcernReport::unit`].
    fn unit(&self) -> &'static str;
    /// The units this concern describes, in a deterministic order.
    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>>;
    /// How one unit does the concern.
    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment;
    /// [`Concern::assign`] with what stands behind the assignment; nothing, unless the
    /// classifier keeps it. The engine calls this one.
    fn assign_backed<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> (Assignment, Backing) {
        (self.assign(cx, unit), Backing::default())
    }
    /// What a unit whose final answer is `none` rests on ([`basis::Basis`]): asked by
    /// the engine of authentication and authorization only, after the [STRICT] rules,
    /// with what [`Concern::assign_backed`] kept. The default is what it kept.
    fn basis<'a>(
        &self,
        _cx: &Cx<'a>,
        _unit: &UnitRef<'a>,
        backing: &Backing,
    ) -> Option<basis::Basis> {
        backing.basis.clone()
    }
    /// A tenant or owner key of the request that the unit takes and neither checks
    /// nor scopes, when the facts prove it ([`FindingKind::UnscopedKey`]; authz only,
    /// the default says none). `uses` are the unit's known uses after the engine's
    /// rules, empty for a recorded absence; `middleware` is the package's middleware
    /// symbol, which runs before the unit. Never a guess: a unit the facts do not
    /// read to the end has no such key.
    fn unscoped_key<'a>(
        &self,
        _cx: &Cx<'a>,
        _unit: &UnitRef<'a>,
        _uses: &[Use],
        _middleware: Option<&str>,
    ) -> Option<String> {
        None
    }
}

// ---------- the engine ----------

/// What `drift practices` was asked for.
#[derive(Debug, Clone, Default)]
pub struct Options {
    pub scope: Scope,
    /// The engine commit, as census gives it (`DRIFT_BUILD_COMMIT`).
    pub commit: Option<String>,
    pub declared: Declared,
    /// The file-kind vocabulary the roles are read with (as `drift map` reads them);
    /// learned from the facts when `None`.
    pub kinds: Option<crate::roles::FileKinds>,
    /// List every unit with its assignment ([`ConcernReport::units`], `--units`).
    pub units: bool,
    /// Leave the helpers defined more than once out of the findings: a pass over
    /// every symbol and call of the repository that a caller reading no findings (a
    /// card's lines, a hook's departures, `drift check`) should not pay on each edit.
    pub skip_duplicates: bool,
}

/// The practice map of a repository with the registered classifiers.
pub fn practices(facts: &RepoFacts, opts: &Options) -> PracticesReport {
    practices_with(facts, opts, &registry())
}

/// [`practices`] with the given classifiers instead of the registry.
pub fn practices_with(
    facts: &RepoFacts,
    opts: &Options,
    classifiers: &[Box<dyn Concern>],
) -> PracticesReport {
    engine::run(facts, opts, classifiers, engine::Guards::ALL).report
}

pub(crate) use authn::{
    ANSWERS_401, AppMiddleware, enforces, of_an_auth_library, of_entry as authn_of_entry,
    read_route_middleware,
};
pub use authn::{IDENTIFIED, identified_only, verified_signatures};
pub(crate) use authz::side_is_callers;
pub(crate) use common::{PARAM_CALLEE, REQUEST_KINDS, file_at, in_skipped, owning_classes};
pub use depart::{
    AddedEntry, CHECK_LISTED, CHECK_NOTICES, DepartingUnit, Departure, PLACE_SHARE, added_entries,
    added_notices, added_summary, added_text, check_text as departures_text, departures,
    github_notices as departures_notices, github_summary as departures_summary,
};
pub use dupes::{DuplicateHelper, FileDuplicate, HelperCopy, duplicate_helpers, duplicates_in};
pub use engine::{
    NOT_COVERED, PRIMARY, card_lines, card_lines_with, config_hint, config_hint_counts,
    config_hints, declared_warnings, link_conventions, package_line, package_line_with, rule_names,
};
pub(crate) use engine::{TAIL, declared_on_every_path};
pub(crate) use libraries::{NOT_AUTH_GUARD_LIBRARIES, authn_callee};
pub use render::{
    AGENT_CHARS, agent_recipe, agent_recipe_preview, plain_concern, plain_way, render,
    render_agent, render_first_run, render_recipes,
};

// ---------- `drift practices --json` version 1 (PLAN-R13 §0.3) ----------

/// `drift practices --json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PracticesReport {
    /// [`VERSION`].
    pub version: u32,
    /// The engine commit, as census gives it; null for a build without one.
    pub commit: Option<String>,
    /// The facts schema the engine reads ([`FACTS_SCHEMA_VERSION`]).
    pub facts_schema: u32,
    pub scope: Scope,
    pub summary: Summary,
    /// One per concern in scope, in [`CONCERNS`] order.
    pub concerns: Vec<ConcernReport>,
    /// What the map does not describe yet (next round's concerns).
    pub not_covered: Vec<String>,
    /// The recipe per package and kind of entry point, from the [`PRIMARY`] concerns:
    /// what new code of that kind there does, most populated first (additive to v1).
    #[serde(default)]
    pub recipes: Vec<Recipe>,
    /// What to look at first: keys a signed-in caller names that nothing scopes, then
    /// unexplained splits, then `none` in authn or validation, then unknown instruments
    /// by the units classifying them would free, then helpers defined more than once
    /// (additive to v1). At most [`caps::FINDINGS`] of the first four kinds, and at
    /// most [`caps::DUPLICATE_FINDINGS`] duplicate helpers after them.
    #[serde(default)]
    pub findings: Vec<Finding>,
    /// The message consumers in scope (entry kind `consumer`: a class or handler a
    /// broker feeds), listed as a kind of their own. No caller signs in to one, so
    /// authentication and authorization do not apply and no concern counts them:
    /// they are not HTTP routes, and what they do with a message is not classified
    /// yet. Sorted by path and symbol; omitted when empty (additive to v1).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub consumers: Vec<Consumer>,
}

/// One message consumer ([`PracticesReport::consumers`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Consumer {
    pub path: String,
    pub symbol: String,
    pub line: u32,
    /// What it consumes from, as the facts name it: a messaging library (`aio_pika`,
    /// `kombu`, `rq`, `kafkajs`), or `queue` for an in-repo base named for one.
    pub adapter: String,
}

/// What new code of one kind of entry point in one package does
/// ([`PracticesReport::recipes`]).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Recipe {
    /// `E-` and 6 hex digits of blake3 of `package + "\0" + role`.
    pub id: String,
    /// The package ("" the root).
    pub package: String,
    /// The entry role: the entry-point kind (`http`, `server_action`, `rpc`, ...).
    pub role: String,
    /// `http entry points in apps/web`.
    pub label: String,
    /// Entry points of that kind in the package, in any recipe concern's population.
    pub population: usize,
    /// One per [`PRIMARY`] concern with units here, in [`CONCERNS`] order.
    pub concerns: Vec<RecipeConcern>,
    /// What the preview concerns (logging, config, data access, testing) add for new
    /// code of this kind here, in [`CONCERNS`] order: one entry per concern whose
    /// statement holds for a clear majority, none otherwise (additive to v1).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preview: Vec<RecipePreview>,
}

/// One preview concern of a [`Recipe`]: what most of the package does, said only when
/// it holds for at least 60% of the units counted (the share a package's dominant
/// variant needs to be called its own way, [`Divergence`]). Preview: these concerns
/// are less measured than the [`PRIMARY`] ones.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RecipePreview {
    /// `logging`, `config`, `data_access` or `testing`.
    pub concern: String,
    /// What most do: the dominant variant's label (`message logs via console`), or for
    /// `testing` where the tests are (`tests in apps/web/tests/api (vitest)`).
    pub label: String,
    /// The units that do, of `total`: the concern's units in the package (logging,
    /// config, data access: symbols, whatever they serve), or the recipe's entry
    /// points (testing). Unknown units count in `total`, never in `members`.
    pub members: usize,
    pub total: usize,
    pub share: f64,
    /// The dominant variant ([`Variant::id`]); absent for `testing`, whose statement
    /// is a place, not one variant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    /// `testing`: the deepest directory whose test files cover that many of the entry
    /// points, and the runner most of those tests use (absent when none is used by
    /// most).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tests_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runner: Option<String>,
    /// A member to copy: a symbol of the variant here, or for `testing` a test file in
    /// `tests_dir` (line 0, no symbol). Null when none is known.
    pub copy: Option<Example>,
}

/// One concern of a [`Recipe`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RecipeConcern {
    pub concern: String,
    /// The concern's units in the recipe's entry points.
    pub total: usize,
    /// The top 2 known variants here (a folded policy counts as one).
    pub variants: Vec<RecipeVariant>,
    /// A member of the first variant here to copy; null when none is known.
    pub copy: Option<Example>,
    /// Units here for which nothing was found in what Drift read.
    pub none: usize,
    /// Units here whose authentication identifies the caller and turns no one away
    /// (additive to v1; omitted when zero).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub identified: usize,
    /// Units here that cannot be told: never counted as known or none.
    pub unknown: usize,
    /// How the second variant differs; null when there is no second.
    pub differs: Option<Differs>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RecipeVariant {
    /// The variant's id ([`Variant::id`]).
    pub id: String,
    pub label: String,
    /// Its members here, and their share of [`RecipeConcern::total`].
    pub members: usize,
    pub share: f64,
}

/// Where the second variant of a recipe concern is.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Differs {
    pub variant: String,
    pub members: usize,
    /// The attribute that sets it apart here (the guarded test of [`SetsApart`]); null
    /// when none does: an unexplained split.
    pub attribute: Option<String>,
    /// Members of the second variant here, to look at (at most [`caps::EXAMPLES`]).
    pub examples: Vec<Example>,
}

/// One finding ([`PracticesReport::findings`]).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub kind: FindingKind,
    pub concern: String,
    /// The package it is in; null for a repository-wide finding (an unknown instrument,
    /// a helper whose copies are in more than one package).
    pub package: Option<String>,
    /// The variants it is about: an unexplained split's top two, a `none` variant, the
    /// authz variants of an unscoped key's units.
    pub variants: Vec<String>,
    /// The units it is about: the split's second variant, the `none` units, the
    /// unknown units classifying the instrument would free, the entry points that
    /// take the unscoped key, the copies of the helper.
    pub members: usize,
    /// An unknown finding's instrument.
    pub instrument: Option<String>,
    /// An unknown finding's [`InstrumentCount::config_hint`].
    pub config_hint: Option<String>,
    /// At most [`caps::EXAMPLES`].
    pub examples: Vec<Example>,
    /// An unscoped-key finding's key, as the route or the query names it (`org_id`,
    /// `userId`); a duplicate-helper finding's function name. Omitted for the other
    /// kinds (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// A duplicate-helper finding's copies, by path and line: at most
    /// [`caps::COPIES`] (`members` counts them all). Omitted for the other kinds
    /// (additive to v1).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub copies: Vec<Example>,
    /// A duplicate-helper finding: how many callees every copy calls, the evidence
    /// that the copies are one helper. Omitted for the other kinds (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_calls: Option<usize>,
    /// A `none` finding: what its own units' readings saw and did not read, together
    /// (theirs only, never the variant's units' in other packages). Omitted when
    /// empty and for the other kinds (additive to v1).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub not_read: Vec<basis::NotRead>,
}

/// What a [`Finding`] says, in rank order.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingKind {
    /// Entry points in a package that sign the caller in, take a tenant or owner key
    /// from the request ([`Finding::key`]: a route parameter, or the parameter a query
    /// is filtered by) and neither check nor scope it, in bodies the facts read to the
    /// end: a signed-in caller can name any value of the key. First in rank: it is the
    /// most specific thing the map proves, and the costliest when true. Never said of
    /// a unit whose authz is unknown, or whose work is handed to code the facts
    /// cannot read (additive to v1).
    UnscopedKey,
    /// The top two known variants of a concern in a package each hold at least 20% of
    /// it, and nothing sets the second apart (no attribute passes the guarded test):
    /// the likely real drift.
    #[default]
    UnexplainedSplit,
    /// Units of authn or validation in a package for which nothing was found in what
    /// Drift read (the variant's `not_read` says what it saw and did not read).
    None,
    /// Units that cannot be told because of one instrument; its `config_hint`
    /// classifies it.
    Unknown,
    /// A function defined in two or more production files under one name, whose
    /// copies call the same things ([`Finding::copies`], [`Finding::shared_calls`]):
    /// its concern is `hygiene`, which is no concern of the map. Ranked by copies times
    /// shared callees. Last: every other kind is about who may call an entry point and
    /// with what, and a copied helper must not take the place of a route that signs no
    /// one in. At most [`caps::DUPLICATE_FINDINGS`] are listed, beyond
    /// [`caps::FINDINGS`] (additive to v1).
    DuplicateHelper,
}

/// What the report was narrowed to; null for all.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scope {
    pub concern: Option<String>,
    pub package: Option<String>,
    pub path: Option<String>,
}

/// Every concern together.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Summary {
    pub population: usize,
    pub known: usize,
    /// Of `known`, the units known by a person's word (`practices:` in
    /// `.drift/config.yaml`), not by proof (additive to v1).
    #[serde(default)]
    pub declared: usize,
    /// Units whose authentication identifies the caller and turns no one away
    /// (`identified`): counted apart, never in `known` (additive to v1; omitted when
    /// zero).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub identified: usize,
    /// Units for which nothing was found in what Drift read: a statement of what was
    /// read, never of the code (`basis` on each unit row says what it rests on).
    pub none: usize,
    pub unknown: usize,
    /// `(known + identified + none) / population`.
    pub coverage: f64,
    /// Concerns whose coverage is at least `target`.
    pub concerns_at_target: usize,
    pub target: f64,
}

/// One concern's profile.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ConcernReport {
    /// One of [`CONCERNS`].
    pub id: String,
    pub title: String,
    /// [`Concern::unit`].
    pub unit: String,
    pub population: Population,
    /// By members (descending), then key. Unknown is never a variant.
    pub variants: Vec<Variant>,
    pub unknown: UnknownReport,
    pub by_package: Vec<PackageProfile>,
    pub divergence: Vec<Divergence>,
    /// With `--units` only: every unit of the population with its assignment, sorted by
    /// package, variant, path, symbol and line (the measurement's sample frame).
    /// Omitted otherwise.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub units: Vec<UnitRow>,
    /// The variants grouped by the instrument they share (additive to v1; the
    /// variant rows stay as they are): one row per decisive instrument and caller
    /// class, with its sub-variants. Known groups sum to `population.known`, none
    /// groups to `population.none`. Omitted for an empty population.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<VariantGroup>,
}

/// Known variants that share their decisive instrument (authn: the proving guard or
/// wrapper; validation: the schema library; errors: the handler), or one `none`
/// variant ([`ConcernReport::groups`]).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct VariantGroup {
    /// `G-` and 6 hex digits of blake3 of `concern + "\0" + class + "\0" + instrument`
    /// (`tail` for the group of units no other unit shares an instrument with, `none:`
    /// and the label for a none variant).
    pub id: String,
    pub kind: VariantKind,
    /// The caller class (authn: `user`, `service`, `identifies` (also of an `identified` group), `opens`); "" elsewhere.
    /// A group never spans two.
    pub class: String,
    /// The shared instrument; "" for the tail and for none.
    pub instrument: String,
    /// The mechanisms its members apply it by, sorted.
    pub mechanisms: Vec<String>,
    /// `12 variants sharing withAuth`, the variant's label when there is one, or the
    /// none label.
    pub label: String,
    pub members: usize,
    /// `members / population.total`.
    pub share: f64,
    /// Distinct variant keys among the members.
    pub variants: usize,
    /// The top sub-variants by members, then key, at most [`caps::GROUP_VARIANTS`].
    pub top: Vec<GroupVariant>,
    /// At most [`caps::EXAMPLES`].
    pub examples: Vec<Example>,
}

/// One sub-variant of a [`VariantGroup`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupVariant {
    /// [`variant_id`] of its key (it may sit in the tail, with no row of its own).
    pub id: String,
    pub key: String,
    pub label: String,
    pub members: usize,
}

/// One unit of a concern's population and how it is assigned (`--units`).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct UnitRow {
    pub package: String,
    /// The top-level variant id; "" for an unknown unit.
    pub variant: String,
    /// Where the unit's code is (the origin file of a re-exported handler).
    pub path: String,
    pub symbol: String,
    pub line: u32,
    /// The entry point's method, when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// `known`, `identified` (authentication that identifies the caller and turns no
    /// one away), `none` (nothing found in what Drift read: see `basis`) or `unknown`.
    pub assignment: String,
    /// An unknown unit's reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<UnknownReason>,
    /// What the unit itself does, where its variant stands for several ways (the tail
    /// of one-off ways, a folded policy): the label of its own uses. Omitted when the
    /// variant's label is the unit's (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub does: Option<String>,
    /// The key of the unit's own uses ([`VariantKey::key`]), with `does`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// The entry point's route, when it has one: a handler mounted more than once is
    /// a unit for each mount (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    /// Of a unit known by a person's word (`practices:` in `.drift/config.yaml`), not
    /// by proof: what it says, with the symbols declared ("rule access (declared in
    /// .drift/config.yaml: RuleBook._ensure_access)"). Omitted otherwise
    /// (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declared: Option<String>,
    /// Of a unit unknown as `check_not_proven`: the check found and what is not
    /// proven of it (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_proven: Option<NotProven>,
    /// Of a `none` unit of authentication or authorization: what the answer rests on,
    /// what was read and what was seen and not read (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<basis::Basis>,
    /// The kind of the entry point, as the facts name it (`http`, `server_action`,
    /// `job`, ...), for a concern whose unit is an entry point: a background job takes
    /// no request, so it is no unit of sign-in for a promoted practice to count
    /// (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// The key of each of the unit's known uses, one per use, sorted: what
    /// [`UnitRow::key`] joins. A unit that does an accepted way and more still follows
    /// that way, which only its separate uses can show (additive to v1).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub uses: Vec<String>,
    /// Of a known unit: whether one of its uses enforces the concern, in the
    /// classifier's own sense (authentication: it turns a caller away;
    /// authorization: a check it proved). Absent where the concern has no such
    /// notion or the unit is not known (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enforces: Option<bool>,
    /// Of an authorization unit: the tenant or owner key the entry point takes from
    /// the request and neither checks nor scopes, in a body read to the end
    /// ([`FindingKind::UnscopedKey`], which lists the same units). Absent otherwise
    /// (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unscoped: Option<String>,
    /// Of an unknown unit: the instrument its reason is about (the call whose body was
    /// not read, the name that does not resolve, the check found). For `drift
    /// investigate`, in process only: never serialised, so no output changes.
    #[serde(skip)]
    pub instrument: String,
}

/// A check found for an unknown unit and what is not proven of it
/// ([`UnknownReason::CheckNotProven`]). Never a statement that the unit does it.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NotProven {
    /// The check's key as it would have been named.
    pub check: String,
    /// The obligation that failed ([`obligation`]).
    pub obligation: String,
    /// The condition in the code's own words, where the facts state it.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub when: String,
    /// The line to show ([`not_proven_line`]).
    pub line: String,
    /// The `practices:` line that settles it, where naming the check's symbol does.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub config_hint: String,
}

/// The units unknown with one found check, by what is not proven of it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotProvenCheck {
    pub check: String,
    pub obligation: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub when: String,
    pub members: usize,
    pub line: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub config_hint: String,
    /// At most [`caps::EXAMPLES`].
    pub examples: Vec<Example>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObligationCount {
    pub obligation: String,
    pub members: usize,
}

/// A concern's population by assignment.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Population {
    pub total: usize,
    pub known: usize,
    /// Of `known`, the units known by a person's word (`practices:` in
    /// `.drift/config.yaml`), not by proof (additive to v1).
    #[serde(default)]
    pub declared: usize,
    /// Authentication units that identify the caller and turn no one away
    /// ([`VariantKind::Identified`]): counted apart, never in `known` (additive to v1;
    /// omitted when zero).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub identified: usize,
    /// Units for which nothing was found in what Drift read ([`VariantKind::None`]).
    pub none: usize,
    pub unknown: usize,
    /// `(known + identified + none) / total`.
    pub coverage: f64,
    pub left_out: LeftOut,
}

/// Units outside the population.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LeftOut {
    pub tests: usize,
    pub non_production: usize,
}

/// One way the codebase does a concern.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Variant {
    /// [`variant_id`].
    pub id: String,
    /// [`VariantKey::key`].
    pub key: String,
    pub label: String,
    pub kind: VariantKind,
    pub mechanisms: Vec<String>,
    pub instruments: Vec<String>,
    pub source: VariantSource,
    pub members: usize,
    /// `members / population.total`, rounded at output.
    pub share: f64,
    #[serde(rename = "where")]
    pub placement: Where,
    /// At most [`caps::SETS_APART`].
    pub sets_apart: Vec<SetsApart>,
    /// At most [`caps::EXAMPLES`].
    pub examples: Vec<Example>,
    /// At most [`caps::EXCEPTIONS`].
    pub exceptions: Vec<Exception>,
    /// Exceptions beyond [`caps::EXCEPTIONS`].
    pub exceptions_more: usize,
    pub conventions: Vec<ConventionLink>,
    /// Null when no existing rule expresses the variant.
    pub promotable: Option<Promotable>,
    /// A folded split policy (authn, `any_of(A|B)`): its alternatives, each with its own
    /// where and sets_apart; omitted for any other variant (additive to v1).
    ///
    /// A policy is folded in a package, from that package's own units: the fold holds
    /// the units of the packages where `A` and `B` are alternatives, and so do its
    /// alternatives. Where another package uses `A` (or `B`) alone, those units stay a
    /// variant of their own in the list, with the id and key the alternative has:
    /// the same way of doing it, in another policy. A unit is in one of them only
    /// ([`UnitRow::variant`], [`PackageVariant::id`] and a recipe name the top-level
    /// one).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alternatives: Vec<Variant>,
    /// Of a `none` variant of authentication or authorization: what its members' bases
    /// list as seen and not read, together ([`basis::Basis::not_read`]; additive to v1,
    /// omitted when empty).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub not_read: Vec<basis::NotRead>,
}

/// A variant is a way of doing the concern, the caller identified and no one turned
/// away (authentication only), or nothing found in what Drift read.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VariantKind {
    #[default]
    Known,
    /// Nothing found in what Drift read: a statement of what was read, never of the
    /// code.
    None,
    /// Authentication that identifies the caller and turns no one away (a session read
    /// with no check, DRF `authentication_classes`). Never a recipe, a departure
    /// reference, a convention or a way to copy (additive to v1).
    Identified,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

/// Where a variant's classification came from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VariantSource {
    /// A library vocabulary (`libraries.rs`).
    #[default]
    Vocab,
    /// An in-repo definition, classified by what it does.
    Usage,
    /// `.drift/config.yaml` `practices:`.
    Declared,
}

/// Where a variant's members are; each list at most [`caps::WHERE`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Where {
    pub packages: Vec<WherePackage>,
    pub dirs: Vec<WhereDir>,
    pub roles: Vec<WhereRole>,
    pub entry_kinds: Vec<WhereEntryKind>,
    pub methods: Vec<WhereMethod>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WherePackage {
    pub package: String,
    pub members: usize,
    pub share_of_package: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WhereDir {
    pub dir: String,
    pub members: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WhereRole {
    pub role: String,
    pub members: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WhereEntryKind {
    pub kind: String,
    pub members: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WhereMethod {
    pub method: String,
    pub members: usize,
}

/// An attribute that sets a variant apart from the dominant one (PLAN-R13 §3).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SetsApart {
    /// `package:`, `dir:`, `role:`, `entry:`, `method:`, `stem:`, `route:`, `lang:`,
    /// `imports:` or `wrap:` and its value.
    pub attribute: String,
    /// `[k_V, n_V]`: members of the variant with the attribute, of all its members.
    pub in_variant: [usize; 2],
    /// `[k_D, n_D]`, for the dominant variant.
    pub in_dominant: [usize; 2],
    /// Wilson lower bound of `k_V/n_V` minus Wilson upper bound of `k_D/n_D`.
    pub separation: f64,
    /// `k_V / (k_V + k_D)`.
    pub purity: f64,
}

/// A unit to look at.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Example {
    pub path: String,
    pub symbol: String,
    pub line: u32,
}

/// A unit in a variant's dominant places that does it another way.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Exception {
    pub path: String,
    pub symbol: String,
    pub line: u32,
    /// The variant it uses (`P-…`), or `none` / `unknown`.
    pub variant: String,
}

/// A mined or accepted convention whose rule matches the variant's instrument.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConventionLink {
    pub id: String,
    pub status: String,
    pub mode: String,
}

/// How `drift practices promote` would turn the variant into a convention: set where
/// the variant may be promoted as the code stands ([`promote::candidates`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Promotable {
    /// The rule's type: `practice` ([`crate::mine::Rule::Practice`]).
    pub rule: String,
    /// The role it would apply to (`R-…`): empty for a `practice` rule, which holds in
    /// a place and not in a role (kept for readers of v1).
    pub role: String,
    /// The broadest place it may be promoted in, as [`promote::Place::shown`] names it
    /// (`apps/api/views`, `.` the root package): what `drift practices promote <id>`
    /// takes without `--in` (additive to v1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
}

/// A concern's unknown units.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnknownReport {
    pub members: usize,
    pub reasons: Vec<UnknownCount>,
    /// The top unclassified instruments: one line of `practices:` config each makes
    /// them known.
    pub instruments: Vec<InstrumentCount>,
    /// At most [`caps::EXAMPLES`].
    pub examples: Vec<Example>,
    /// Of `members`, those with a check found and not proven
    /// ([`UnknownReason::CheckNotProven`]), by the obligation that failed (additive to
    /// v1; omitted when empty).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub not_proven: Vec<ObligationCount>,
    /// The checks found and not proven, the one behind most units first; at most
    /// [`caps::WHERE`] (additive to v1; omitted when empty).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checks: Vec<NotProvenCheck>,
}

/// Why a unit is unknown.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum UnknownReason {
    /// A file of the unit was not parsed (skipped, `stack_unavailable`, parse errors).
    Unparsed,
    /// A wrapper Drift cannot see into.
    OpaqueWrapper,
    /// An instrument that does not resolve.
    Unresolved,
    /// The entry point's symbol is not found.
    NoSymbol,
    /// Dynamic code (computed callees, spreads).
    Dynamic,
    /// The body awaits a call whose body cannot be read (an unresolved import, an
    /// in-repo callee the facts do not define, a service built by a dependency): it may
    /// be the check, so nothing found is not an absence. The instrument is that call.
    BodyUnreadable,
    /// A value that would decide the concern (a tenant id from a header or the route) is
    /// handed to a callee whose checks are not followed: it may be enforced there. The
    /// instrument is the value's source.
    NotFollowed,
    /// A test request whose route is not a literal (`reverse()`, a variable) and names
    /// no target: it may be the one that covers this entry point.
    RouteNotMatched,
    /// An instrument no vocabulary, usage or declaration classifies.
    #[default]
    Unclassified,
    /// A check was found but is not proven to be the unit's practice: it does not run
    /// on every request, or only its name says what it is ([`Unproven`]). The
    /// instrument is where the check is. The unit is unknown, and what was found is
    /// said with it.
    CheckNotProven,
    /// A function or method of the repository the unit runs was read except for a
    /// method of a value whose type the facts do not give (a member of a parameter, an
    /// attribute of a module-level value), or a request's method in a body that also
    /// hands a value to a call the facts do not record: it may be where the concern is
    /// decided. The instrument is that function, never the method of the value (a
    /// built-in's `join`, `get` or `rstrip`). Additive.
    PartlyRead,
    /// The request is handed to another service over HTTP (`fetch`, an HTTP client),
    /// which may decide the concern. The instrument is the function of the repository
    /// that hands it on. Additive.
    Forwarded,
    /// The unit calls a webhook signature verifier (or a call named as one), and that a
    /// failed verification stops the request is not proven: its result may be ignored,
    /// what it raises swallowed or only logged, or it is called for some requests only,
    /// or it is not on the closed list of verifier call shapes whose failure is read
    /// ([`drift_core::guard_lists::SIGNATURE_VERIFIERS`]: octokit's `verify` answers a
    /// boolean the facts do not tie to a refusal). Never known, never none. The
    /// instrument is the verifier's call. Additive.
    SignatureNotProven,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnknownCount {
    pub reason: UnknownReason,
    pub members: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstrumentCount {
    pub instrument: String,
    pub members: usize,
    /// The `practices:` line for `.drift/config.yaml` that classifies it
    /// ([`config_hint`]; additive to v1). Omitted for what no such line classifies (a
    /// pseudo-instrument, an unresolved reference, or units unknown for another reason).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub config_hint: String,
}

/// A concern's profile in one package (`FileFacts::package`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PackageProfile {
    pub package: String,
    pub total: usize,
    pub coverage: f64,
    pub variants: Vec<PackageVariant>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PackageVariant {
    pub id: String,
    pub members: usize,
    pub share: f64,
}

/// A package whose dominant known variant (at least 60% of it) is not the repo's.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Divergence {
    pub package: String,
    pub dominant: String,
    pub repo_dominant: String,
    pub members: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::FACTS_SCHEMA_VERSION;

    #[test]
    fn concern_ids_are_frozen() {
        let ids: Vec<&str> = CONCERNS.iter().map(|(id, _)| *id).collect();
        assert_eq!(
            ids,
            [
                "authn",
                "authz",
                "errors",
                "logging",
                "api",
                "validation",
                "config",
                "data_access",
                "testing"
            ]
        );
        assert_eq!(concern_title("errors"), Some("Error handling"));
        assert_eq!(concern_title("nope"), None);
    }

    #[test]
    fn registered_classifiers_are_concerns_and_unique() {
        let reg = registry();
        let mut ids: Vec<&str> = reg.iter().map(|c| c.id()).collect();
        assert!(ids.iter().all(|id| concern_title(id).is_some()), "{ids:?}");
        let n = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), n, "a concern is registered twice");
    }

    #[test]
    fn variant_ids_and_keys_are_deterministic() {
        let id = variant_id(AUTHN, "wrap:apps/web/lib/auth.ts#withWorkspace");
        assert!(id.starts_with("P-") && id.len() == 8, "{id}");
        assert_eq!(
            id,
            variant_id(AUTHN, "wrap:apps/web/lib/auth.ts#withWorkspace")
        );
        assert_ne!(
            id,
            variant_id(AUTHZ, "wrap:apps/web/lib/auth.ts#withWorkspace")
        );
        let u = |m: &str, i: &str| Use {
            mechanism: m.into(),
            instrument: i.into(),
        };
        let a = VariantKey::new(&[
            u("middleware", "clerkMiddleware"),
            u("body", "auth().orgId"),
        ]);
        let b = VariantKey::new(&[
            u("body", "auth().orgId"),
            u("middleware", "clerkMiddleware"),
            u("body", "auth().orgId"),
        ]);
        assert_eq!(a, b);
        assert_eq!(a.key, "body:auth().orgId+middleware:clerkMiddleware");
    }

    struct EveryEntry;

    impl Concern for EveryEntry {
        fn id(&self) -> &'static str {
            AUTHN
        }
        fn unit(&self) -> &'static str {
            "entry_point"
        }
        fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
            cx.facts
                .files
                .iter()
                .flat_map(|file| {
                    file.entry_points.iter().map(move |entry| UnitRef::Entry {
                        file,
                        entry,
                        symbol: file.symbols.iter().find(|s| s.name == entry.symbol),
                    })
                })
                .collect()
        }
        fn assign<'a>(&self, _cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
            match unit {
                UnitRef::Entry { symbol: None, .. } => Assignment::Unknown {
                    reason: UnknownReason::NoSymbol,
                    instrument: String::new(),
                },
                UnitRef::Entry {
                    symbol: Some(s), ..
                } if s.wraps.is_empty() => Assignment::None {
                    label: "no guard".into(),
                },
                _ => Assignment::Known {
                    uses: vec![],
                    label: "wrapped".into(),
                    source: VariantSource::Usage,
                },
            }
        }
    }

    #[test]
    fn a_classifier_plugs_in_and_is_counted() {
        let file = FileFacts {
            path: "app/api/x/route.ts".into(),
            parse_ok: true,
            symbols: vec![Symbol {
                name: "GET".into(),
                ..Symbol::default()
            }],
            entry_points: ["GET", "POST"]
                .iter()
                .map(|s| EntryPoint {
                    symbol: s.to_string(),
                    kind: "http".into(),
                    method: Some(s.to_string()),
                    route: Some("/api/x".into()),
                    adapter: "nextjs".into(),
                })
                .collect(),
            ..FileFacts::default()
        };
        let facts = RepoFacts {
            schema_version: FACTS_SCHEMA_VERSION,
            files: vec![file],
            ..RepoFacts::default()
        };
        let classifiers: Vec<Box<dyn Concern>> = vec![Box::new(EveryEntry)];
        let r = practices_with(&facts, &Options::default(), &classifiers);
        assert_eq!(r.concerns.len(), 1);
        let p = &r.concerns[0].population;
        assert_eq!((p.total, p.known, p.none, p.unknown), (2, 0, 1, 1));
        assert_eq!(p.coverage, 0.5);
        assert_eq!(r.summary.population, 2);
        assert_eq!(r.summary.concerns_at_target, 0);
        // Out of scope: nothing.
        let opts = Options {
            scope: Scope {
                concern: Some(ERRORS.into()),
                ..Scope::default()
            },
            ..Options::default()
        };
        assert!(
            practices_with(&facts, &opts, &classifiers)
                .concerns
                .is_empty()
        );
    }
}
