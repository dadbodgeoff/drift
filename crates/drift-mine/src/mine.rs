//! Convention mining.
//!
//! For each structural role with enough members, every fact held by most of
//! the role becomes a candidate convention when:
//!
//! - the role has at least [`MIN_ROLE_SIZE`] members and at least one outlier;
//! - the 95% Wilson lower bound of `holders / members` is at least [`MIN_LOWER_BOUND`];
//! - lift (share in the role over share in the whole repo) is at least [`MIN_LIFT`].
//!
//! Alternative wrappers that fill the same slot (`withWorkspace` or `withSession`)
//! are counted together as one variant-set convention. Candidates are ranked by a
//! deterministic score and capped. All arithmetic that affects ordering is exact
//! or correctly rounded, so results are identical on every platform.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, WrapKind};
use serde::{Deserialize, Serialize};

use crate::context::{LintVerdict, RepoContext, split_dep};
use crate::frameworks::{self, CRUD_VERBS, NEXT_RESERVED_EXPORTS};
use crate::roles::{FileKinds, RoleSelector, Unit, View, units};
use crate::security;
use crate::vocab::{grant, refuse};

pub const MIN_ROLE_SIZE: usize = 8;
/// Conventions in smaller roles may advise but not block.
pub const MIN_BLOCK_ROLE_SIZE: usize = 15;
pub const MIN_LOWER_BOUND: f64 = 0.75;
pub const MIN_LIFT: f64 = 1.5;
/// Higher bar for calls into external packages and built-ins.
pub const MIN_LIFT_EXTERNAL_CALL: f64 = 3.0;
pub const MAX_PER_ROLE: usize = 5;
pub const DEFAULT_MAX_PER_REPO: usize = 15;
/// A deeper role's convention is kept over its parent's only if its bound is this much higher.
const CHILD_MARGIN: f64 = 0.05;
/// Control facts that are never conventions on their own.
/// (`uses_any` is only ever learned as something a role avoids.)
const NON_CONVENTION_CONTROLS: &[&str] = &[
    "await",
    "return_jsx",
    "uses_any",
    drift_core::controls::READS_INPUT,
    drift_core::controls::NO_INPUT,
    // What a guard does, read to tell guards apart (`crate::security::authenticates`).
    drift_core::controls::REJECTS_CALLER,
    // What a registry decorator's definition does, read to tell it from a wrapper
    // (`RepoContext::is_registry_function`).
    drift_core::controls::REGISTERS_ARG,
    // What the facts did not read of a body, read to say nothing of it
    // (`practices::authz`'s unscoped key).
    drift_core::controls::UNREAD_CALL,
    // What a module-level name does not hold yet, read to say nothing of a call on it
    // (`practices::authz`).
    drift_core::controls::LATE_BOUND,
    drift_core::controls::UNREAD_EXIT,
    drift_core::controls::SCOPE_UNREAD,
    // What a guard does in an `except` handler, read by `drift security` and the
    // practice map only (`RepoContext::since_measured`).
    drift_core::controls::HANDLER_REJECTS,
    drift_core::controls::HANDLER_MAY_REJECT,
    // Whether a body that refuses does so for every request, read the same way.
    drift_core::controls::REJECTS_SOME,
    drift_core::controls::REFUSES_ALL,
    // What the test given to Django's `user_passes_test` answers, read the same way.
    drift_core::controls::PASSES_TEST_SIGNED_IN,
    drift_core::controls::PASSES_TEST_TRUE,
    drift_core::controls::PASSES_TEST_UNREAD,
    // What the test asks of a caller who is signed in (`practices::authz`).
    drift_core::controls::TEST_ASKS_ROLE,
    drift_core::controls::TEST_ASKS_STATUS,
    drift_core::controls::TEST_ASKS_UNREAD,
    // What a helper hands back of the caller, read where its value is used
    // (`practices::authz`).
    drift_core::controls::RETURNS_CALLER,
    // What a body does with its parameters, read where a call hands it a value of
    // the caller (`practices::authz`).
    drift_core::controls::PARAM_FLOWS,
    // What a function called where a guard goes hands back that the facts do not
    // name, read by `drift security` and the practice map only (`crate::py_guards`).
    // How a thing at a guard position is written (`shape:...`) is left out by its
    // prefix, where controls become rules.
    drift_core::controls::RETURNS_UNREAD,
    drift_core::controls::CALLS_UNNAMED,
    drift_core::controls::RETURNS_REFUSING,
    drift_core::controls::REFUSES_EVERY,
    drift_core::controls::REFUSAL_NOT_RETURNED,
    // What a helper or a dependency hands back of the request, read where its value
    // is compared or filtered by (`practices::authz`). Where the sides of a
    // comparison and the value of a filter come from (`sides:...`,
    // `filter_value:...`) is left out by its prefix, where controls become rules.
    drift_core::controls::RETURNS_REQUEST,
    // A filter a data library adds to every query, configured below any one query
    // (`practices::authz`).
    drift_core::controls::ORM_FILTER,
    // A dependency replaced by `dependency_overrides`, read by `drift security` and
    // the practice map only (`crate::py_guards`).
    drift_core::controls::OVERRIDDEN,
    drift_core::controls::HANDS_BACK_PARAM,
    drift_core::controls::KEEPS_VALUE,
    // For whom a body returns early, read with the checks that follow
    // (`practices::authz`).
    drift_core::controls::RETURNS_EARLY_FOR_OWN,
];
/// Rules in one role whose holder sets overlap this much are reported once.
const NEAR_DUPLICATE: f64 = 0.9;

/// What a convention requires of each member of its role.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Rule {
    /// The symbol is wrapped by one of these (outermost-first wrappers of this kind).
    WrappedBy { kind: WrapKind, any_of: Vec<String> },
    /// The symbol passes this object key to this callee (e.g. `requiredPermissions`).
    PassesKey {
        callee: String,
        index: u32,
        key: String,
    },
    /// The symbol calls this function.
    Calls { callee: String },
    /// The symbol renders this component.
    Renders { component: String },
    /// The file declares this directive (`use client`).
    Directive { value: String },
    /// The symbol has this control-flow fact (`await`, `throw`, `try`).
    Control { value: String },
    /// The symbol throws this class (`lib/errors.ts#AppError`).
    Throws { class: String },
    /// The symbol's name follows this pattern (`use*`, `*Service`).
    Named { pattern: String },
    /// When the symbol calls `then`, it calls `first` before it.
    Before { first: String, then: String },
    /// The unit never has this signal (`sink:raw_sql`, `env`, `import:pkg:@prisma/client`).
    Avoids { signal: String },
    /// The file has a matching test file.
    HasTest,
    /// Files use `preferred` and none of the other libraries of `group`.
    PrefersLibrary { group: String, preferred: String },
    /// The model has this field (compared case- and underscore-insensitively).
    ModelHas { field: String },
    /// The package defines this item (`script:lint`, `flag:strict`).
    PackageHas { item: String },
    /// Packages depending on `name` agree on its range. Mined as `range: None`:
    /// "the range most workspace packages use", re-evaluated by `check`, so the rule
    /// follows the workspace when it upgrades instead of going stale (the ranges at
    /// mining time are evidence). `Some(range)` is a pin, as conventions accepted
    /// before this change say; it keeps its id and its meaning.
    DependencyVersion {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        range: Option<String>,
    },
    /// The symbol is named by the registry at `slot` in the file `path`, or, when
    /// `path` is empty, by some list of the family `slot` (each `@Module`'s
    /// `providers`). Mined by [`crate::wiring`]; checked against the registry as it
    /// is now, so moving lines never changes the rule.
    RegisteredIn {
        slot: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        path: String,
        /// Only members named like this (`*_JOB_DEFINITION`); empty for all.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        named: String,
        /// Mined with members registered in lists reachable from `path`'s list
        /// (modules it imports, urlconfs it includes, routers it mounts). Only the
        /// summary differs: `check` always counts those lists.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        reach: bool,
    },
    /// Every key (environment variable name) of `from` is also in `to`: in the
    /// commits that added keys to `from`, the same keys were added to `to`. Mined
    /// from git history by [`crate::cochange`]; checked on the files as they are now.
    MirrorsKeys { from: String, to: String },
    /// Members that use `name` take it from `source`, not from the other places that
    /// provide the same thing (`instead_of`): `TypedDict` from typing_extensions, not
    /// typing; the team's `actor` wrapper, not `dramatiq.actor`. `source` and
    /// `instead_of` are canonical references ([`import_source_key`]). Python only.
    ImportsFrom {
        name: String,
        source: String,
        instead_of: Vec<String>,
    },
}

impl Rule {
    /// A wiring rule ([`Rule::RegisteredIn`], [`Rule::MirrorsKeys`]): checked
    /// against other files than the unit's own, so `check` evaluates it apart.
    pub fn is_wiring(&self) -> bool {
        matches!(self, Rule::RegisteredIn { .. } | Rule::MirrorsKeys { .. })
    }

    /// Whether a file-level rule can say anything about the file `f` of its role: a
    /// library preference ("use cuid2 for ids, not uuid/nanoid") only about a file that
    /// imports a library of its group, since it holds vacuously for every other file
    /// (an agent writing a health route needs no rule about id libraries, nor a React
    /// modal to copy for it). Every other rule: yes. What agents are told before writing
    /// a file ([`Rule::file_condition`] when the content is unknown).
    pub fn concerns_file(&self, f: &FileFacts) -> bool {
        match self {
            Rule::PrefersLibrary { group, .. } => {
                !group_libraries(f, group_members(group)).is_empty()
            }
            _ => true,
        }
    }

    /// When the file a new file will be is unknown, the condition under which a
    /// file-level rule is about it ([`Rule::concerns_file`]): "if it imports
    /// uuid/nanoid/…". `None`: any file of the role.
    pub fn file_condition(&self) -> Option<String> {
        match self {
            Rule::PrefersLibrary { group, .. } => Some(format!(
                "if it imports one of {}",
                group_members(group).join(", ")
            )),
            _ => None,
        }
    }
}

/// Library groups whose members fill the same slot; a package usually picks one.
pub const LIBRARY_GROUPS: &[(&str, &[&str])] = &[
    ("dates", &["date-fns", "dayjs", "moment", "luxon"]),
    (
        "http client",
        &["axios", "ky", "got", "node-fetch", "superagent"],
    ),
    (
        "validation",
        &["zod", "yup", "joi", "valibot", "superstruct"],
    ),
    (
        "state",
        &[
            "zustand",
            "jotai",
            "@reduxjs/toolkit",
            "redux",
            "mobx",
            "recoil",
            "valtio",
        ],
    ),
    (
        "data fetching",
        &["@tanstack/react-query", "swr", "@apollo/client", "urql"],
    ),
    (
        "icons",
        &[
            "lucide-react",
            "react-icons",
            "@heroicons/react",
            "@tabler/icons-react",
            "@radix-ui/react-icons",
            "@phosphor-icons/react",
        ],
    ),
    (
        "css-in-js",
        &[
            "styled-components",
            "@emotion/styled",
            "@emotion/react",
            "@stitches/react",
        ],
    ),
    (
        "utilities",
        &[
            "lodash",
            "lodash-es",
            "underscore",
            "ramda",
            "remeda",
            "radash",
        ],
    ),
    (
        "ids",
        &["uuid", "nanoid", "cuid", "@paralleldrive/cuid2", "ulid"],
    ),
    (
        "logging",
        &["pino", "winston", "bunyan", "consola", "loglevel"],
    ),
    (
        "database",
        &[
            "@prisma/client",
            "drizzle-orm",
            "typeorm",
            "sequelize",
            "mongoose",
            "kysely",
            "knex",
        ],
    ),
    ("class names", &["clsx", "classnames"]),
    ("toasts", &["sonner", "react-hot-toast", "react-toastify"]),
    (
        "forms",
        &["react-hook-form", "formik", "@tanstack/react-form"],
    ),
];

/// A package export compared by package root: `pkg:@nestjs/common/decorators#Controller`
/// and `pkg:@nestjs/common#Controller` are the same decorator re-exported. Facts keep
/// the subpath; rules and comparisons use this form.
pub fn norm_ref(r: &str) -> std::borrow::Cow<'_, str> {
    let Some((module, rest)) = r.split_once('#') else {
        return r.into();
    };
    match package_name(module) {
        Some(root) if module.len() > "pkg:".len() + root.len() && !root.starts_with("node:") => {
            format!("pkg:{root}#{rest}").into()
        }
        _ => r.into(),
    }
}

pub(crate) fn same_ref(fact: &str, rule: &str) -> bool {
    norm_ref(fact) == norm_ref(rule)
}

/// Package name of a canonical module id (`pkg:@a/b/c` -> `@a/b`), if external.
fn package_name(module: &str) -> Option<&str> {
    let m = module.strip_prefix("pkg:")?;
    let mut parts = m.splitn(3, '/');
    let first = parts.next()?;
    if first.starts_with('@') {
        let second = parts.next()?;
        Some(&m[..first.len() + 1 + second.len()])
    } else {
        Some(first)
    }
}

/// Libraries of `group` imported (not type-only) by a file.
fn group_libraries<'f>(file: &'f FileFacts, members: &[&str]) -> BTreeSet<&'f str> {
    file.imports
        .iter()
        .filter(|i| !i.type_only)
        .filter_map(|i| package_name(&i.module))
        .filter(|p| members.contains(p))
        .collect()
}

fn group_members(group: &str) -> &'static [&'static str] {
    LIBRARY_GROUPS
        .iter()
        .find(|(g, _)| *g == group)
        .map_or(&[], |(_, m)| m)
}

/// Field names compare case- and underscore-insensitively (`created_at` = `createdAt`).
fn norm_field(f: &str) -> String {
    f.chars()
        .filter(|c| *c != '_')
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Naming patterns of a symbol: a lowercase verb prefix (`use*`, `get*`) and a
/// capitalised noun suffix (`*Service`), for camelCase and PascalCase names alike
/// (`cityTimezonesSchema` is `city*` and `*Schema`).
pub fn name_patterns(name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let Some(first) = name.chars().next() else {
        return out;
    };
    if !first.is_ascii_alphabetic() {
        return out;
    }
    if first.is_ascii_lowercase()
        && let Some(end) = name.find(|c: char| !c.is_ascii_lowercase())
        && (2..=8).contains(&end)
        && name[end..].starts_with(|c: char| c.is_ascii_uppercase())
    {
        out.push(format!("{}*", &name[..end]));
    }
    // A trailing version is not the noun: `EnvironmentsControllerV1` is a `*Controller`.
    let noun = strip_version(name);
    if let Some(start) = noun.rfind(|c: char| c.is_ascii_uppercase()) {
        let suffix = &noun[start..];
        if start > 0 && suffix.len() >= 3 && suffix[1..].chars().all(|c| c.is_ascii_lowercase()) {
            out.push(format!("*{suffix}"));
        }
    }
    out
}

/// Name prefixes that mark a release stage, not what a symbol is:
/// `experimental_generateImage` is a `generate*`, `unstable_cache` a `cache`.
const STAGE_PREFIXES: &[&str] = &["experimental_", "unstable_"];

/// A name with a leading [`STAGE_PREFIXES`] or `_` (any number, any case) set aside:
/// `experimental_useChat` -> `useChat`, `__harnessThing` -> `harnessThing`.
fn strip_stage(name: &str) -> &str {
    let mut n = name;
    loop {
        // `get`, not `[..]`: the prefix's length need not end on a character boundary of
        // the name (`créerUnÉlément`), and an index that does not panics.
        if let Some(rest) = STAGE_PREFIXES.iter().find_map(|p| {
            n.get(..p.len())
                .filter(|head| head.eq_ignore_ascii_case(p) && n.len() > p.len())
                .map(|_| &n[p.len()..])
        }) {
            n = rest;
        } else if let Some(rest) = n.strip_prefix('_') {
            n = rest;
        } else {
            return n;
        }
    }
}

/// Whether a name follows a naming pattern of [`name_patterns`] (`use*`, `*Schema`),
/// with a release-stage prefix or a leading `_` set aside ([`strip_stage`]):
/// `experimental_useChat` follows `use*`. A name written in another case style than
/// camel or Pascal case cannot carry the pattern as written, so its words are compared
/// without case: `HARNESS_V1_TOOLS` (upper snake case) follows `harness*`, and
/// `user_schema` follows `*Schema`. A camel or Pascal name is compared as written, so
/// `MemberInviteDTO` does not follow `*Dto`, nor `ErrorCodes` `*Code`: those could be
/// written the team's way. A name of one word follows no pattern, as before.
pub fn name_matches(name: &str, pattern: &str) -> bool {
    let n = strip_stage(name);
    if !n.contains('_') {
        return name_patterns(n).iter().any(|p| p == pattern);
    }
    let mut w = words(n);
    if w.len() > 2
        && w.last().is_some_and(|l| {
            l.len() > 1 && l.starts_with('v') && l[1..].chars().all(|c| c.is_ascii_digit())
        })
    {
        w.pop();
    }
    if w.len() < 2 {
        return false;
    }
    match (pattern.strip_suffix('*'), pattern.strip_prefix('*')) {
        (Some(prefix), _) => w[0] == prefix.to_ascii_lowercase(),
        (_, Some(suffix)) => w[w.len() - 1] == suffix.to_ascii_lowercase(),
        _ => false,
    }
}

/// `ControllerV1` -> `Controller`, `EmailV2` -> `Email`: a trailing `V<digits>` after a
/// lowercase letter. Other names are returned as they are.
fn strip_version(name: &str) -> &str {
    let digits = name.trim_end_matches(|c: char| c.is_ascii_digit());
    match digits.strip_suffix('V') {
        Some(rest)
            if digits.len() < name.len() && rest.ends_with(|c: char| c.is_ascii_lowercase()) =>
        {
            rest
        }
        _ => name,
    }
}

/// Export names a framework chose for the file (Next.js `generateMetadata`,
/// `maxDuration`, `runtime` in route files): not the team's naming.
pub fn framework_reserved_name(file: &FileFacts, symbol: &Symbol) -> bool {
    file.entry_points.iter().any(|e| e.adapter == "nextjs")
        && (NEXT_RESERVED_EXPORTS.contains(&symbol.name.as_str())
            || symbol
                .exported_as
                .iter()
                .any(|n| NEXT_RESERVED_EXPORTS.contains(&n.as_str())))
}

/// Signals a unit may be expected to avoid. Facts, not judgements: a role only
/// gets an `Avoids` rule when it clearly avoids a signal the rest of the code uses.
/// An import of a workspace package the file's package declares as a dependency is
/// intended, so it is no layering signal: the declared dependency graph, not import
/// frequency, says which way layers may depend. So is a deferred load (`import()`, a
/// `require()` inside a function, a lazy-load helper) of a package it declares as a
/// peer or optional dependency: that is how a package uses what it may run without.
/// A static import of one still counts.
pub fn signals(view: &View, ctx: &RepoContext) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    match view {
        View::Symbol(f, s) => {
            // A plain alias of a function does what the function does ([`features`]).
            let (f, s) = ctx.alias_target(f, s).unwrap_or((f, s));
            for k in &s.sinks {
                out.insert(format!("sink:{k}"));
            }
            if s.reads.iter().any(|r| r.starts_with("process.env.")) {
                out.insert("env".into());
            }
            if s.reads.iter().any(|r| r.starts_with("os.environ.")) {
                out.insert("os_environ".into());
            }
            if s.calls.iter().any(|c| c.starts_with("global#console.")) {
                out.insert("console".into());
            }
            if s.throws.iter().any(|t| t == "global#Error") {
                out.insert("throw_error".into());
            }
            if s.controls.iter().any(|c| c == "uses_any") {
                // Python's `typing.Any` is a different thing from TypeScript's `any`.
                out.insert(if f.lang == "py" { "typing_any" } else { "any" }.into());
            }
        }
        View::File(f) => {
            if !f.client_leaks.is_empty() {
                out.insert("client_leak".into());
            }
            // Avoiding a *package* was accepted for 2 of 11 proposals in the labelled
            // evaluation (it mostly restates what a layer is), so only internal areas count.
            out.extend(layer_signals(f, ctx).map(|(g, _)| g));
        }
        View::Model(_) | View::Package(_) => {}
    }
    out
}

/// A file's layering signals, each with the import's module (`import:app/board`,
/// `app/board/board-context.ts`). Avoiding a *package* was accepted for 2 of 11
/// proposals in the labelled evaluation (it mostly restates what a layer is), so only
/// internal areas count.
fn layer_signals<'a>(
    f: &'a FileFacts,
    ctx: &'a RepoContext,
) -> impl Iterator<Item = (String, &'a str)> + 'a {
    f.imports
        .iter()
        .filter(|i| !i.type_only)
        .filter_map(move |i| {
            let (own, target) = edge_areas(&f.package, &f.path, &i.module)?;
            (target != own
                && !ctx.declares_module(&f.package, &i.module)
                && !(!i.load.is_static() && ctx.declares_optional_module(&f.package, &i.module)))
            .then(|| (format!("import:{target}"), i.module.as_str()))
        })
}

/// The first module a file imports that breaks a layering rule (`avoids:import`), for
/// the advice that names the import to change; `None` for any other rule or unit.
pub fn offending_import(rule: &Rule, view: &View, ctx: &RepoContext) -> Option<String> {
    let (Rule::Avoids { signal }, View::File(f)) = (rule, view) else {
        return None;
    };
    if !signal.starts_with("import:") || signal.starts_with("import:pkg:") {
        return None;
    }
    layer_signals(f, ctx)
        .find(|(g, _)| g == signal)
        .map(|(_, m)| m.to_string())
}

/// The layering clause every `avoids:import` summary ends with: kept in the summary
/// and in `drift_explain`, left out of the one-line rules agents read.
pub const LAYERING_CLAUSE: &str =
    " (declared dependencies, and lazy loads of peer or optional dependencies, excepted)";

/// A summary as an agent's one-line rule: without [`LAYERING_CLAUSE`].
pub fn agent_summary(summary: &str) -> String {
    summary.replace(LAYERING_CLAUSE, "")
}

/// Units a signal can apply to: only client files can leak server code to the client.
fn signal_applies(signal: &str, view: &View) -> bool {
    match (signal, view) {
        ("client_leak", View::File(f)) => f.directives.iter().any(|d| d == "use client"),
        _ => true,
    }
}

/// Stricter bound for import avoidance: big roles only, almost no exceptions.
const AVOID_IMPORT_MIN_LOWER_BOUND: f64 = 0.9;
/// At most this share of a repo's conventions are avoidance rules.
const AVOID_MAX_SHARE: f64 = 0.25;

/// Area of a repo path: its first two segments (`packages/ui`, `apps/web`, `src/lib`).
fn area(path: &str) -> String {
    let segs: Vec<&str> = path.split('/').collect();
    segs[..segs.len().saturating_sub(1).clamp(1, 2)].join("/")
}

/// The import of `module` stays inside the file's own workspace package.
fn same_package(package: &str, module: &str) -> bool {
    !package.is_empty() && module.starts_with(&format!("{package}/"))
}

/// Area of `path` counted from the root of its package `package` (non-empty):
/// `web/lib/a.ts` in package `web` is `web/lib`, `apps/web/app/x/page.tsx` in
/// `apps/web` is `apps/web/app/x`. The areas a run with `--root <package>` would see,
/// prefixed by the package, so a package's internal layers are the same from the root.
fn package_area(package: &str, path: &str) -> String {
    let rest = path
        .strip_prefix(package)
        .and_then(|r| r.strip_prefix('/'))
        .unwrap_or(path);
    format!("{package}/{}", area(rest))
}

/// The areas of one import edge, `(the file's, the target's)`, or `None` when the
/// target has no area (a package, an unresolved specifier). Between packages (and in
/// the repo root package) areas count from the repository root, as they always have
/// (`packages/ui` -> `packages/lib`). Inside one workspace package an import is no layer
/// edge, as before workspaces, unless the experimental `intra_package_layering` is on
/// ([`crate::workspace::intra_package_layering`]); then areas count from the package's
/// root ([`package_area`]): `web/lib` -> `web/app/dash` is a layer edge of the app in
/// `web/`, as with `--root web` (pilot G1). Off by default: on the build set its cards were
/// 1 ACCEPT, 6 WRONG and 1 TRIVIAL (not admitted under the fold rule).
fn edge_areas(package: &str, path: &str, module: &str) -> Option<(String, String)> {
    import_area(module)?;
    if same_package(package, module) {
        // Experimental, off by default: not admitted under the fold rule.
        crate::workspace::intra_package_layering()
            .then(|| (package_area(package, path), package_area(package, module)))
    } else {
        Some((area(path), area(module)))
    }
}

/// The area of a role member for an `import:<target>` signal: from its package's root
/// when the target is inside that package ([`edge_areas`]), else from the repo root.
fn member_area(package: &str, path: &str, target: &str) -> String {
    if !package.is_empty() && (target == package || target.starts_with(&format!("{package}/"))) {
        package_area(package, path)
    } else {
        area(path)
    }
}

/// Area of an internal import target; `None` for packages and unresolved specifiers.
fn import_area(module: &str) -> Option<String> {
    (package_name(module).is_none() && !module.starts_with("unresolved:") && module.contains('/'))
        .then(|| area(module))
}

fn signal_label(signal: &str) -> String {
    if let Some(k) = signal.strip_prefix("sink:") {
        let what = match k {
            "eval" => "eval()",
            "shell_exec" => "shell commands",
            "raw_html" => "raw HTML (innerHTML, dangerouslySetInnerHTML)",
            "raw_sql" => "raw SQL",
            "sql_string_interpolation" => "SQL built from string interpolation",
            "dynamic_redirect" => "redirects to computed URLs",
            "dynamic_fetch" => "requests to computed URLs",
            "weak_hash" => "MD5/SHA-1",
            "jwt_decode_without_verify" => "jwt.decode() without verify",
            "cookie_without_httponly" => "cookies without httpOnly",
            "cors_any_origin" => "CORS for any origin",
            "unsafe_deserialize" => "unsafe deserialisation (pickle, yaml.load)",
            "path_traversal" => "files at paths built from values",
            "template_injection" => "templates built from values",
            "nosql_injection" => "MongoDB $where built from values",
            "xml_external_entities" => "XML parsers that resolve external entities",
            "hardcoded_secret" => "signing secrets written in the code",
            "debug_enabled" => "servers started in debug mode",
            "tls_verify_disabled" => "TLS without certificate verification",
            "mass_assignment" => "rows written from the whole request body",
            "dynamic_regex" => "regular expressions built from values",
            other => other,
        };
        return format!("do not use {what}");
    }
    if let Some(t) = signal.strip_prefix("import:pkg:") {
        return format!("do not import {t}");
    }
    if let Some(t) = signal.strip_prefix("import:") {
        return format!("do not import from {t}/**{LAYERING_CLAUSE}");
    }
    match signal {
        "env" => "do not read process.env directly".into(),
        "os_environ" => "do not read os.environ directly".into(),
        "console" => "do not call console.*".into(),
        "throw_error" => "do not throw a bare Error".into(),
        "any" => "do not use `any`".into(),
        "typing_any" => "do not use `Any` (typing)".into(),
        "client_leak" => "do not reach server-only code or secrets from client code".into(),
        other => format!("avoid {other}"),
    }
}

/// A ref to a package or a built-in: its bases are not in the facts.
fn is_external(r: &str) -> bool {
    r.starts_with("pkg:") || r.starts_with("global#") || r.starts_with("unresolved:")
}

/// The symbol is wrapped by one of `any_of`; a class extends what its in-repo bases
/// extend.
fn wrapped_by(s: &Symbol, kind: WrapKind, any_of: &[String], ctx: &RepoContext) -> bool {
    s.wraps.iter().any(|w| {
        w.kind == kind
            && any_of.iter().any(|a| {
                same_ref(&w.wrapper, a)
                    || (w.kind == WrapKind::Extends
                        && ctx
                            .ancestors(&norm_ref(&w.wrapper))
                            .iter()
                            .any(|b| same_ref(b, a)))
            })
    }) || (kind == WrapKind::Call && matches!(call_match(s, any_of, ctx), CallMatch::Holds(_)))
}

/// Longest chain of bindings followed from one wrapper ([`derived_forms`]).
const MAX_DERIVATION_DEPTH: usize = 8;

/// A call wrapper with its additive builder steps taken out, and those steps in
/// order: `lib/a.ts#client.use().inputSchema().action` -> (`lib/a.ts#client.action`,
/// [`use`, `inputSchema`]). The binding, the terminal method and any other call stay,
/// so `client.inputSchema().action` and `client.action` share a key.
fn builder_key(w: &str) -> (String, Vec<String>) {
    let w = norm_ref(w);
    let Some((module, rest)) = w.split_once('#') else {
        return (w.into_owned(), Vec::new());
    };
    let mut kept: Vec<&str> = Vec::new();
    let mut steps = Vec::new();
    for seg in rest.split('.') {
        match seg.strip_suffix("()") {
            Some(step)
                if !kept.is_empty() && drift_core::builders::ADDITIVE_STEPS.contains(&step) =>
            {
                steps.push(step.to_string());
            }
            _ => kept.push(seg),
        }
    }
    (format!("{module}#{}", kept.join(".")), steps)
}

/// Whether a chain with the steps `have` takes the rule chain's steps `want`, and if
/// not, which steps it lacks (`Some(lacks)`; empty: it takes them all). `None` when it
/// cannot hold whatever it adds.
///
/// Steps count with multiplicity, in any order. A rule chain with a middleware step
/// ([`drift_core::builders::MIDDLEWARE_STEPS`]) is compared exactly, as before F1: Drift
/// does not record which middleware an inline `.use()` adds, and that middleware may be
/// the rule's authentication, so only the member's own chain with exactly the same steps
/// holds it. No extra step, no step of a binding the wrapper is built on (`own` false),
/// and no missing input step (no exemption).
fn chain_lacks(want: &[String], have: &[String], own: bool) -> Option<Vec<String>> {
    let middleware = |s: &String| drift_core::builders::MIDDLEWARE_STEPS.contains(&s.as_str());
    if want.iter().any(middleware) {
        return (own && want == have).then(Vec::new);
    }
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for h in have {
        *counts.entry(h.as_str()).or_default() += 1;
    }
    let mut lacks = Vec::new();
    for w in want {
        match counts.get_mut(w.as_str()) {
            Some(n) if *n > 0 => *n -= 1,
            _ => lacks.push(w.clone()),
        }
    }
    Some(lacks)
}

/// What a wrapper is, followed through the bindings it is built from
/// ([`RepoContext::derives_from`]): for `b.ts#bookingsProcedure`, the form
/// `p.ts#authedProcedure.input().use()` reached through `b.ts#bookingsProcedure`, then
/// what that derives from. The binding is the longest prefix of the wrapper (`x.ts#t`,
/// `x.ts#t.procedure`) that derives from something; the rest of the wrapper follows it.
struct Derivations {
    /// Each form, with the bindings passed to reach it.
    forms: Vec<(String, Vec<String>)>,
    /// The chain ends at an in-repo binding whose file the facts lack (a hook's
    /// single-file scan that did not load it): it may go on.
    open: bool,
}

fn derived_forms(w: &str, ctx: &RepoContext) -> Derivations {
    let mut forms = Vec::new();
    let mut via: Vec<String> = Vec::new();
    let mut cur = norm_ref(w).into_owned();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut open = false;
    for _ in 0..MAX_DERIVATION_DEPTH {
        let Some((module, rest)) = cur.split_once('#') else {
            break;
        };
        let segs: Vec<&str> = rest.split('.').collect();
        let found = (1..=segs.len()).rev().find_map(|k| {
            if segs[..k].iter().any(|s| s.contains('(')) {
                return None;
            }
            let binding = format!("{module}#{}", segs[..k].join("."));
            let from = ctx.derives_from(&binding)?;
            Some((binding, from.to_string(), k))
        });
        let Some((binding, from, k)) = found else {
            open = !is_external(&cur) && !ctx.has_module(module);
            break;
        };
        let tail: String = segs[k..].iter().map(|s| format!(".{s}")).collect();
        let next = format!("{from}{tail}");
        if !seen.insert(next.clone()) {
            break;
        }
        via.push(binding);
        forms.push((next.clone(), via.clone()));
        cur = next;
    }
    Derivations { forms, open }
}

/// How a symbol's call wrappers stand to a call-wrapper rule beyond an exact match.
enum CallMatch {
    /// A wrapper is a target with more builder steps (`client.inputSchema().metadata().action`
    /// for `client.inputSchema().action`), or is built on a target
    /// (`bookingsProcedure = authedProcedure.use(...)`). Holds the wrapper and the target.
    Holds(Option<(String, String)>),
    /// A wrapper is a target without some of its input steps
    /// (`client.action` for `client.inputSchema().action`): the wrapper and those steps.
    MissingInput(String, Vec<String>),
    None,
}

fn call_match(s: &Symbol, any_of: &[String], ctx: &RepoContext) -> CallMatch {
    let mut missing: Option<(String, Vec<String>)> = None;
    for w in s.wraps.iter().filter(|w| w.kind == WrapKind::Call) {
        if any_of.iter().any(|a| same_ref(&w.wrapper, a)) {
            return CallMatch::Holds(None);
        }
        let derived = derived_forms(&w.wrapper, ctx);
        let forms = std::iter::once((w.wrapper.clone(), Vec::new())).chain(derived.forms);
        for (form, via) in forms {
            // A wrapper built on another counts as it only while no binding on the way
            // says it opens up (`publicBookingsProcedure = authedProcedure.use(...)`,
            // `publicTeamProcedure = teamProcedure.use(...)`), whatever the target is
            // named: the chain only adds middleware, but its name contradicts the rule.
            if via
                .iter()
                .any(|b| grant::auth_class(b) == grant::AuthClass::Public)
            {
                continue;
            }
            let (key, steps) = builder_key(&form);
            for a in any_of {
                let (want_key, want_steps) = builder_key(a);
                if key != want_key {
                    continue;
                }
                let Some(lacks) = chain_lacks(&want_steps, &steps, via.is_empty()) else {
                    continue;
                };
                if lacks.is_empty() {
                    return CallMatch::Holds(Some((w.wrapper.clone(), a.clone())));
                }
                if missing.is_none()
                    && lacks
                        .iter()
                        .all(|l| drift_core::builders::INPUT_STEPS.contains(&l.as_str()))
                {
                    missing = Some((w.wrapper.clone(), lacks));
                }
            }
        }
    }
    match missing {
        Some((w, lacks)) => CallMatch::MissingInput(w, lacks),
        None => CallMatch::None,
    }
}

/// The symbol has a call wrapper whose chain of bindings ends at an in-repo file the
/// facts lack ([`Derivations::open`]): whether it is built on a rule's wrapper is
/// unknown here. TypeScript only: Python records no derivations.
fn derivation_open(f: &FileFacts, s: &Symbol, ctx: &RepoContext) -> bool {
    f.lang != "py"
        && s.wraps
            .iter()
            .filter(|w| w.kind == WrapKind::Call)
            .any(|w| derived_forms(&w.wrapper, ctx).open)
}

/// The symbol calls `callee`, is wrapped by it (a decorator or wrapper call), or
/// passes it a key (which only a call does).
fn calls_callee(s: &Symbol, callee: &str) -> bool {
    s.calls.iter().any(|c| same_ref(c, callee))
        || s.wraps.iter().any(|w| same_ref(&w.wrapper, callee))
        || s.args
            .iter()
            .any(|a| a.rsplit_once('@').is_some_and(|(c, _)| same_ref(c, callee)))
}

/// What a symbol refers to by name: its wrappers (other than those applied by
/// configuration), callees and references, and the classes it throws.
fn references(s: &Symbol) -> impl Iterator<Item = String> + '_ {
    s.wraps
        .iter()
        .filter(|w| {
            !matches!(
                w.kind,
                WrapKind::Config | WrapKind::ConfigAuthenticates | WrapKind::AppHook
            )
        })
        .map(|w| w.wrapper.as_str())
        .chain(s.calls.iter().map(String::as_str))
        .chain(s.throws.iter().map(String::as_str))
        .map(|r| norm_ref(r.strip_suffix("(ref)").unwrap_or(r)).into_owned())
}

/// [`references`], and the bases a class extends through its in-repo bases: a
/// subclass of the team's `AgentState(TypedDict)` uses `TypedDict` too. It takes it
/// from wherever its base does, so only its own references can break an
/// [`Rule::ImportsFrom`].
fn inherited_references<'s>(
    s: &'s Symbol,
    ctx: &'s RepoContext,
) -> impl Iterator<Item = String> + 's {
    references(s).chain(
        s.wraps
            .iter()
            .filter(|w| w.kind == WrapKind::Extends)
            .flat_map(|w| ctx.ancestors(&norm_ref(&w.wrapper)).to_vec()),
    )
}

/// The file at `path` defines one of `alternatives` (`netbox/utilities/forms/fields.py`
/// for `...fields.py#ChoiceField`): it is the layer that wraps the library's version,
/// and uses it by design.
fn provides_alternative(path: &str, alternatives: &[&str]) -> bool {
    alternatives
        .iter()
        .any(|a| a.split_once('#').is_some_and(|(m, _)| m == path))
}

/// Backports: a package that provides what a standard-library module provides, under
/// the same names (`typing_extensions.TypedDict` for `typing.TypedDict`). Language
/// facts, like [`VALUE_TYPED_BASES`].
const BACKPORTS: &[(&str, &str)] = &[
    ("pkg:typing_extensions#", "pkg:python:typing#"),
    ("pkg:tomli#", "pkg:python:tomllib#"),
    ("pkg:importlib_metadata#", "pkg:python:importlib#metadata."),
    ("pkg:mock#", "pkg:python:unittest#mock."),
];

/// What a reference is, whichever place it is taken from: the same key for
/// `typing.TypedDict` and `typing_extensions.TypedDict`, and for a library class or
/// function and the team's wrapper of the same name ([`RepoContext::team_version`]).
/// `None` for references with one source only.
pub(crate) fn import_source_key(r: &str, ctx: &RepoContext) -> Option<String> {
    if let Some(team) = ctx.team_version(r) {
        return Some(team.to_string());
    }
    BACKPORTS.iter().find_map(|(backport, std)| {
        let name = r.strip_prefix(backport).or_else(|| r.strip_prefix(std))?;
        (!name.is_empty() && !name.contains(['.', '('])).then(|| format!("{std}{name}"))
    })
}

/// Where a reference is taken from, for people: `pkg:python:typing#TypedDict` ->
/// `typing`, `pkg:django#forms.ChoiceField` -> `django.forms`, an in-repo
/// `netbox/utilities/forms/fields/choices.py#ChoiceField` -> that file.
fn source_module(r: &str) -> String {
    let Some((module, name)) = r.split_once('#') else {
        return r.to_string();
    };
    let Some(package) = module.strip_prefix("pkg:") else {
        return module.to_string();
    };
    let package = package.strip_prefix("python:").unwrap_or(package);
    match name.rsplit_once('.') {
        Some((path, _)) => format!("{package}.{path}"),
        None => package.to_string(),
    }
}

/// A reference as code spells it: `pkg:tagflow#tag.button` -> `tagflow.tag.button`,
/// `pkg:python:typing#TypedDict` -> `typing.TypedDict`; an in-repo reference as is.
fn dotted_ref(r: &str) -> String {
    match r.split_once('#') {
        Some((module, name)) if module.starts_with("pkg:") => {
            let package = &module["pkg:".len()..];
            let package = package.strip_prefix("python:").unwrap_or(package);
            format!("{package}.{name}")
        }
        _ => r.to_string(),
    }
}

/// Bases that fix the type of an enum's values: a `StrEnum` holds strings, an
/// `IntEnum` or a `Flag` integers, and so does an enum mixing in `str` or `int`.
const VALUE_TYPED_BASES: &[(&str, &str)] = &[
    ("pkg:python:enum#StrEnum", "str"),
    ("global#str", "str"),
    ("pkg:django#db.models.TextChoices", "str"),
    ("pkg:django#db.models.enums.TextChoices", "str"),
    ("pkg:python:enum#IntEnum", "int"),
    ("pkg:python:enum#IntFlag", "int"),
    ("pkg:python:enum#Flag", "int"),
    ("global#int", "int"),
    ("pkg:django#db.models.IntegerChoices", "int"),
    ("pkg:django#db.models.enums.IntegerChoices", "int"),
];

/// The value type a base class fixes, directly or through in-repo classes.
fn value_type_of(base: &str, ctx: &RepoContext) -> Option<&'static str> {
    let base = norm_ref(base);
    std::iter::once(base.as_ref())
        .chain(ctx.ancestors(&base).iter().map(String::as_str))
        .find_map(|b| {
            VALUE_TYPED_BASES
                .iter()
                .find(|(r, _)| *r == b)
                .map(|(_, t)| *t)
        })
}

/// The one value type the targets of a base-class rule fix, if they agree on one.
fn targets_value_type(any_of: &[String], ctx: &RepoContext) -> Option<&'static str> {
    let types: BTreeSet<Option<&str>> = any_of.iter().map(|t| value_type_of(t, ctx)).collect();
    match types.into_iter().collect::<Vec<_>>()[..] {
        [Some(t)] => Some(t),
        _ => None,
    }
}

/// The value type of an enum, from its bases; `None` for other classes, plain `Enum`s
/// (their values can be anything) and enums whose bases disagree.
fn enum_value_type(s: &Symbol, ctx: &RepoContext) -> Option<&'static str> {
    if !s.traits.iter().any(|t| t == drift_core::traits::ENUM) {
        return None;
    }
    let types: BTreeSet<&str> = s
        .wraps
        .iter()
        .filter(|w| w.kind == WrapKind::Extends)
        .filter_map(|w| value_type_of(&w.wrapper, ctx))
        .collect();
    match types.into_iter().collect::<Vec<_>>()[..] {
        [t] => Some(t),
        _ => None,
    }
}

/// The kind of thing a class name says it is: the last word of its name, singular,
/// leaving out words that say how a class is built rather than what it is
/// (`validate.Validator` -> `validator`, `ModelSchema` -> `schema`, `RepositoryBase`
/// and `BaseRepository` -> `repository`).
fn kind_word(canonical: &str) -> Option<String> {
    let name = short(canonical);
    let name = name.rsplit('.').next().unwrap_or(&name);
    name_kind(name)
}

fn name_kind(name: &str) -> Option<String> {
    words(name)
        .iter()
        .rev()
        .map(|w| singular(w))
        .find(|w| !matches!(w.as_str(), "base" | "abstract" | "mixin"))
}

/// `base` names a kind other than the targets' and is neither a target nor an
/// ancestor of one (as far as the facts know).
fn other_kind(any_of: &[String], base: &str, kind: &str, ctx: &RepoContext) -> bool {
    let kinds: Vec<String> = any_of.iter().filter_map(|t| kind_word(t)).collect();
    !kinds.is_empty()
        && !kinds.iter().any(|k| k == kind)
        && !any_of.iter().any(|t| {
            same_ref(base, t)
                || ctx
                    .ancestors(&norm_ref(t))
                    .iter()
                    .any(|a| same_ref(base, a))
        })
}

/// The in-repo target of a class rule that `f` defines (the base's or the
/// decorator's own module). That module is not a peer of the classes built on the
/// target: it holds the target itself and its helpers (netbox's `Choice` tuple next to
/// `ChoiceSet`, the nested GraphQL type beside `register_type`), so the rule is not
/// about anything in it.
fn defining_module<'r>(f: &FileFacts, any_of: &'r [String]) -> Option<&'r str> {
    any_of
        .iter()
        .find(|t| {
            !is_external(t)
                && norm_ref(t)
                    .split_once('#')
                    .is_some_and(|(module, _)| module == f.path)
        })
        .map(String::as_str)
}

/// `f` is the module that defines `callee`, an in-repo function (`src/trpc/init.ts` for
/// `src/trpc/init.ts#createTRPCRouter`). Packages, built-ins and unresolved callees
/// have no module in the repo.
fn callee_module(f: &FileFacts, callee: &str) -> bool {
    module_and_dir(&norm_ref(callee)).is_some_and(|(module, _)| module == f.path)
}

/// `s` is the target itself (`BaseProvider` in `base.provider.ts`), or the base class
/// the module defines for it, named `Base<Target>` or `<Target>Base`
/// (`BaseMetadataSideEffectHandlerService` beside `MetadataSideEffectHandler()`).
fn defines_target(f: &FileFacts, s: &Symbol, any_of: &[String]) -> bool {
    any_of.iter().any(|t| {
        let t = norm_ref(t);
        let Some((module, name)) = t.split_once('#') else {
            return false;
        };
        if module != f.path {
            return false;
        }
        let stem = name.trim_end_matches("()");
        std::iter::once(&s.name)
            .chain(&s.exported_as)
            .any(|n| n == stem || *n == format!("Base{stem}") || *n == format!("{stem}Base"))
    })
}

/// The unit is the rule's own target (`requireUser` under "call `requireUser()`",
/// `BaseService` under "extend `BaseService`"): its `path#name`, or `path#<exported
/// name>`, is one of the rule's targets ([`rule_targets`]).
fn is_own_target(rule: &Rule, f: &FileFacts, s: &Symbol) -> bool {
    let targets = rule_targets(rule);
    !targets.is_empty()
        && std::iter::once(&s.name).chain(&s.exported_as).any(|n| {
            let own = format!("{}#{n}", f.path);
            targets.iter().any(|t| norm_ref(t) == own)
        })
}

/// `s` is one of the rule's targets: the class the module defines under that name.
fn is_target_itself(f: &FileFacts, s: &Symbol, any_of: &[String]) -> bool {
    any_of.iter().any(|t| {
        norm_ref(t).split_once('#').is_some_and(|(module, name)| {
            module == f.path
                && std::iter::once(&s.name)
                    .chain(&s.exported_as)
                    .any(|n| n == name)
        })
    })
}

/// The kinds the classes that follow a rule are of: what the targets, their ancestors,
/// the packages and built-ins in the followers' lineage and their class decorators are
/// named for, the kind most of their files or folders name (`*.service.ts`,
/// `services/`), and the role's own kind words.
fn followers_kinds(
    kind: WrapKind,
    any_of: &[String],
    followers: &crate::context::ClassProfile,
    role: Option<&RoleSelector>,
    ctx: &RepoContext,
) -> BTreeSet<String> {
    let _ = kind;
    let role_kinds = role
        .map(kind_words)
        .unwrap_or_default()
        .into_iter()
        .flat_map(|w| {
            let last = kind_of_word(&w);
            [w, last]
        });
    // What they are built on: the targets and their ancestors, and the packages and
    // built-ins in their lineage. A class of the repo between them and the target is
    // one of them, not what they are built on.
    let targets: BTreeSet<String> = any_of
        .iter()
        .flat_map(|t| {
            let t = norm_ref(t).into_owned();
            let mut up = ctx.ancestors(&t).to_vec();
            up.push(t);
            up
        })
        .collect();
    followers
        .lineage
        .iter()
        .filter(|l| targets.contains(*l) || is_external(l) || !ctx.knows_class(l))
        .chain(&followers.decorators)
        .chain(any_of)
        .filter(|l| !is_mixin(l))
        .filter_map(|l| kind_word(l))
        .chain(followers.place_kinds())
        .chain(role_kinds)
        .filter(|k| !k.is_empty())
        .collect()
}

/// A class of the followers' own kind, whatever it is built on: named for it
/// (`RefundService` among services on `BaseService`), or in a file or folder named for it
/// (`Refunds` in `refund.service.ts`, `RefundManager` in `services/`). A class whose name
/// is the kind of its own base (`ChallengeRequirementsValidator(validate.Validator)`) says
/// what it is, wherever it sits.
fn of_followers_kind(f: &FileFacts, s: &Symbol, kinds: &BTreeSet<String>) -> bool {
    if name_kind(&s.name).is_some_and(|k| kinds.contains(&k)) {
        return true;
    }
    let placed = crate::context::suffix_kind(&f.path)
        .into_iter()
        .chain(crate::context::dir_kind(&f.path))
        .any(|k| kinds.contains(&k));
    placed && !own_kind_base(s).is_some_and(|(_, k)| !kinds.contains(&k))
}

/// Kind words of bases that may be what any class is built on (`BaseModel`, `Base`,
/// `Object`): a class on one of them may have skipped a package team base built on it.
const GENERIC_KINDS: &[&str] = &[
    "model", "object", "entity", "type", "class", "record", "data",
];

/// A class built on a package, a built-in or a class the facts lack (`tuple`,
/// `forms.Form`, `validate.Validator`), or carrying a package's class decorator
/// (`@QuestionSet()`): what decides whether it is of another kind than the classes
/// that follow a rule ([`another_kind`]).
fn built_on_others(s: &Symbol, ctx: &RepoContext) -> bool {
    s.kind == SymbolKind::Class
        && (ctx
            .lineage(s)
            .iter()
            .any(|l| (is_external(l) || !ctx.knows_class(l)) && !is_mixin(l))
            || s.wraps
                .iter()
                .any(|w| w.kind == WrapKind::Decorator && is_external(&norm_ref(&w.wrapper))))
}

/// A class that does not follow a base-class or class-decorator rule is not about it
/// when it is the target itself (or the `Base<Target>` beside it), or when it is of
/// another kind than the classes of the rule's role that follow it:
///
/// - **F4:** a class in the module that defines the target;
/// - **F3:** a class built on a package, a built-in or a class the facts lack, or
///   carrying a package's class decorator ([`built_on_others`]), whose bases and
///   decorators are named for none of the followers' kinds: an `Error` among providers,
///   a Django model or form among search indexes, a marshmallow validator or field among
///   schemas, a nest-commander `@QuestionSet()` among commands.
///
/// Neither applies under a guard rule or to an entry point ([`Rule::exemption_allowed`],
/// checked before every exemption), and the class is an outlier, when:
///
/// - it is of the followers' kind ([`of_followers_kind`]): named for it, or in a file or
///   folder named for it (`refund.service.ts`, `services/`), unless its name is the kind
///   of its own base of another kind (a `*Validator` on `validate.Validator` in
///   `schemas/`);
/// - it shares a class of its lineage or a class decorator with the followers (it is on
///   their line: a variant of the team's runner, a view on `MethodView`, `@Command()`
///   without the team's decorator);
/// - (F3) its base is unresolved, a package default export, a package ref named like
///   another class of the repo (an unmapped alias), only a `*Mixin`, or named for one of
///   the followers' kinds; or, when the followers' line ends in a class the facts lack,
///   for a kind any class may build on ([`GENERIC_KINDS`]: `BaseModel`).
fn class_of_another_kind(
    f: &FileFacts,
    s: &Symbol,
    kind: WrapKind,
    any_of: &[String],
    role: Option<&RoleSelector>,
    ctx: &RepoContext,
) -> Option<Exempted> {
    if s.kind != SymbolKind::Class {
        return None;
    }
    let module = defining_module(f, any_of);
    if let Some(t) = module
        && defines_target(f, s, any_of)
    {
        return Some(Exempted::new(
            "defining_module",
            format!("in the module that defines {}", short(t)),
        ));
    }
    let followers = ctx.carriers(kind == WrapKind::Extends, any_of, role);
    if followers.lineage.is_empty() && followers.decorators.is_empty() {
        return None;
    }
    let kinds = followers_kinds(kind, any_of, &followers, role, ctx);
    another_kind_than(f, s, module, &followers, &kinds, ctx)
}

/// The part of [`class_of_another_kind`] that compares `s` with the classes that follow
/// a rule (`followers`, of `kinds`), once those are known; `module` is the target `f`
/// defines, if any.
fn another_kind_than(
    f: &FileFacts,
    s: &Symbol,
    module: Option<&str>,
    followers: &crate::context::ClassProfile,
    kinds: &BTreeSet<String>,
    ctx: &RepoContext,
) -> Option<Exempted> {
    if of_followers_kind(f, s, kinds) {
        return None;
    }
    let lineage = ctx.lineage(s);
    let decorators = class_decorators(s);
    if shares_followers_line(&lineage, &decorators, followers) {
        return None;
    }
    if let Some(t) = module {
        return Some(Exempted::new(
            "defining_module",
            format!("in the module that defines {}", short(t)),
        ));
    }
    if !built_on_others(s, ctx) {
        return None;
    }
    // An unresolved base, a package's default export, or a package ref named like a
    // class of the repo (an alias the resolver did not map, `misago/components/form`)
    // names no other kind.
    if lineage.iter().any(|l| {
        l.starts_with("unresolved:")
            || (l.starts_with("pkg:")
                && (l.ends_with("#default")
                    || (short(l) != s.name && ctx.defines_class_named(&short(l)))))
    }) {
        return None;
    }
    let opaque = |r: &str| is_external(r) || !ctx.knows_class(r);
    let roots: Vec<&String> = lineage
        .iter()
        .filter(|l| opaque(l) && !is_mixin(l))
        .collect();
    let foreign_decorators: Vec<&String> = decorators.iter().filter(|d| is_external(d)).collect();
    if roots.is_empty() && foreign_decorators.is_empty() {
        return None;
    }
    let unknown_line = followers.lineage.iter().any(|l| opaque(l));
    let may_be_theirs = |r: &&String| {
        kind_word(r).is_none_or(|k| {
            kinds.contains(&k) || (unknown_line && GENERIC_KINDS.contains(&k.as_str()))
        })
    };
    if roots.iter().any(may_be_theirs)
        || foreign_decorators
            .iter()
            .any(|d| kind_word(d).is_none_or(|k| kinds.contains(&k)))
    {
        return None;
    }
    // Named by the first direct base the reason comes through, not the first in order.
    let direct_root = s
        .wraps
        .iter()
        .filter(|w| w.kind == WrapKind::Extends)
        .map(|w| norm_ref(&w.wrapper).into_owned())
        .find_map(|b| {
            if opaque(&b) && !is_mixin(&b) {
                Some(b)
            } else {
                ctx.ancestors(&b)
                    .iter()
                    .find(|a| opaque(a) && !is_mixin(a))
                    .cloned()
            }
        });
    let what = match (
        direct_root.as_ref().or(roots.first().copied()),
        foreign_decorators.first(),
    ) {
        (Some(r), _) => format!("extends {}", short(r)),
        (None, Some(d)) => format!("decorated with {}()", short(d)),
        (None, None) => return None,
    };
    Some(Exempted::new(
        "another_kind",
        format!("another kind of class ({what})"),
    ))
}

/// A Python class that extends a sibling of the rule's one in-repo target (code
/// `sibling_base`): another class the target's own module defines, neither the target
/// nor one of its ancestors or descendants, that at least [`SIBLING_BASE_MIN`]
/// production classes of the repo extend. The module offers both on purpose:
/// `misago`'s `plugins/hooks.py` defines `FilterHook` and `ActionHook`, and an action
/// hook among filter hooks is the other kind of hook, as a save serializer on
/// `RalphAPISaveSerializer` is beside the read serializers on `RalphAPISerializer`.
/// Only a direct base of the class; behind [`Rule::exemption_allowed`] like every
/// exemption. A single-file scan may lack the sibling's other subclasses, so a hook
/// sends any class exempt here to a full scan ([`Rule::exemption_undecided`]).
fn sibling_base_exemption(
    f: &FileFacts,
    s: &Symbol,
    any_of: &[String],
    ctx: &RepoContext,
) -> Option<Exempted> {
    if f.lang != "py" || s.kind != SymbolKind::Class {
        return None;
    }
    let [target] = any_of else {
        return None;
    };
    let target = norm_ref(target).into_owned();
    let (module, _) = target.split_once('#')?;
    if is_external(&target) {
        return None;
    }
    let related = |b: &str| {
        b == target
            || ctx.ancestors(&target).iter().any(|a| a == b)
            || ctx.ancestors(b).contains(&target)
    };
    s.wraps
        .iter()
        .filter(|w| w.kind == WrapKind::Extends)
        .map(|w| norm_ref(&w.wrapper).into_owned())
        .find(|b| {
            !is_external(b)
                && b.split_once('#').is_some_and(|(m, _)| m == module)
                && ctx.knows_class(b)
                && !related(b)
                && ctx.carriers_count(true, std::slice::from_ref(b), None) >= SIBLING_BASE_MIN
        })
        .map(|b| {
            Exempted::new(
                "sibling_base",
                format!(
                    "extends {}, which the module of {} defines beside it",
                    short(&b),
                    short(&target)
                ),
            )
        })
}

/// Production classes that must extend a sibling base before it counts as one
/// ([`sibling_base_exemption`]).
const SIBLING_BASE_MIN: usize = 2;

/// "Call `super().m()`" is about the classes that override `m` (code
/// `does_not_override`): a class that defines no `m` of its own has no override to
/// delegate from. `misago`'s hooks call `super().__call__()` from their `__call__`; a
/// result class or a queryset filter beside them defines none. Python only (the call
/// is `global#super().m`).
fn super_override_exemption(s: &Symbol, callee: &str) -> Option<Exempted> {
    let method = norm_ref(callee)
        .strip_prefix("global#super().")
        .filter(|m| !m.is_empty() && !m.contains(['.', '(']))
        .map(str::to_string)?;
    let own = s
        .declares
        .iter()
        .any(|d| d.split_once('=').map_or(d.as_str(), |(a, _)| a) == method);
    (!own).then(|| {
        Exempted::new(
            "does_not_override",
            format!(
                "defines no {method}() of its own, so has no override that calls super().{method}()"
            ),
        )
    })
}

/// A Python class of another kind than the classes that follow a naming or call rule
/// of their role (`another_kind`, `defining_module`), as [`class_of_another_kind`]
/// decides it for base-class rules: "classes in serializers files are named
/// `*Serializer`" is not about `ContentTypeField(serializers.ChoiceField)` beside them,
/// "classes in models files call `gettext_lazy()`" not about the model manager
/// `AuditLogEntryManager(models.Manager)`, and neither is about the tuple subclass or
/// metaclass in the module that defines the base most of them extend.
///
/// The followers are the class members of the role that hold the rule (`follows`).
/// What they are built on is their lineage and class decorators; the in-repo classes
/// more than half of them extend stand for the rule's targets (the module that
/// defines one is [`defining_module`]); their kinds are those of [`followers_kinds`]
/// plus the kind a naming rule's suffix names (`serializer` for `*Serializer`). A
/// class is still an outlier when it holds the rule itself, is of the followers'
/// kind, shares a class of their lineage or a class decorator (`OrderModel(BaseModel)`
/// among `*Schema(BaseModel)` is a misnamed schema, #27), or is built on a kind any
/// class may build on while their line ends in a class the facts lack (`BaseModel`
/// under a package schema base, [`GENERIC_KINDS`]). A class with neither a base nor a
/// class decorator is never of another kind.
///
/// Python only (#27 measured the naming case on Python; TypeScript has
/// [`companion_exemption`] for naming rules). Behind [`Rule::exemption_allowed`] like
/// every exemption: never for an entry point, never under a guard rule. In facts of
/// one file the followers are those of that file only, so a hook sends any class
/// exempt here to a full scan ([`Rule::exemption_undecided`]).
fn py_class_of_another_kind(
    f: &FileFacts,
    s: &Symbol,
    role: &RoleSelector,
    suffix_kind: Option<String>,
    follows: impl Fn(&FileFacts, &Symbol) -> bool,
    ctx: &RepoContext,
) -> Option<Exempted> {
    if f.lang != "py" || s.kind != SymbolKind::Class || follows(f, s) {
        return None;
    }
    if !s
        .wraps
        .iter()
        .any(|w| matches!(w.kind, WrapKind::Extends | WrapKind::Decorator))
    {
        return None;
    }
    let mut followers = crate::context::ClassProfile::default();
    let mut held: BTreeMap<String, usize> = BTreeMap::new();
    for (mf, m) in ctx.role_members(role) {
        if m.kind != SymbolKind::Class || (mf.path == f.path && m.name == s.name) || !follows(mf, m)
        {
            continue;
        }
        let lineage = ctx.lineage(m);
        for l in &lineage {
            if !is_external(l) && ctx.knows_class(l) {
                *held.entry(l.clone()).or_default() += 1;
            }
        }
        followers.lineage.extend(lineage);
        followers.decorators.extend(class_decorators(m));
        if let Some(k) = crate::context::suffix_kind(&mf.path) {
            *followers.suffixes.entry(k).or_default() += 1;
        }
        if let Some(k) = crate::context::dir_kind(&mf.path) {
            *followers.dirs.entry(k).or_default() += 1;
        }
        followers.count += 1;
    }
    if followers.count == 0 {
        return None;
    }
    let targets: Vec<String> = held
        .into_iter()
        .filter(|(_, n)| n * 2 > followers.count)
        .map(|(t, _)| t)
        .collect();
    let module = defining_module(f, &targets);
    if let Some(t) = module
        && defines_target(f, s, &targets)
    {
        return Some(Exempted::new(
            "defining_module",
            format!("in the module that defines {}", short(t)),
        ));
    }
    let mut kinds = followers_kinds(WrapKind::Extends, &targets, &followers, Some(role), ctx);
    kinds.extend(suffix_kind);
    another_kind_than(f, s, module, &followers, &kinds, ctx)
}

/// A companion of a naming rule's followers (code `companion`): an export that sits in
/// the same file as a member that follows the name scheme, and is not one of that
/// member's kind but something it is built with. "Handlers are named `*Handler`" is
/// about `addGuestsHandler`, not about `getBooking` and `validateUserPermissions`
/// beside it, which the handler calls; "classes in `*.provider` files are named
/// `*Provider`" is not about the `Error` subclass a provider throws. It is
///
/// - a function, component or value that a follower in its file uses (calls, wraps
///   with or refers to by reference): a helper of that follower;
/// - an `UPPER_SNAKE` constant beside a follower (`ADMIN_SEARCH_MAX_QUERY_LENGTH` next
///   to the schemas it bounds): a constant has a naming scheme of its own;
/// - a class on another line than every follower in its file: it has a base or a class
///   decorator none of them shares (`EmailWebhookUrlBlockedError extends Error` among
///   providers, a `@ValidatorConstraint()` among DTOs), or it has none while each of
///   them extends a base (a nested payload class beside a command on the team's
///   command base).
///
/// Never for:
///
/// - a member that follows the scheme, or its file's default export (what a loader or
///   router picks up is the file's own member, whatever its name);
/// - a peer of the same shape: an unused value or function beside the followers
///   (`copyText = register({...})` among `actionCopy = register({...})`), or a class on
///   a follower's line, including a plain class beside a plain follower
///   (`TriggerOverrides` beside `TopicPayloadDto`): such a member is what the rule is
///   for, misnamed;
/// - a member in a file without a follower: whether it is a helper or a misnamed member
///   then depends on what other files hold, which a hook's single-file scan cannot see.
///
/// TypeScript and JavaScript only, as measured on the TypeScript dev set alone. Python's
/// name-suffix rules exempt a class of another kind than their followers instead
/// ([`py_class_of_another_kind`], round 6; #27 had them exempt nobody), and a plain
/// class among schemas stays an outlier there.
///
/// Behind [`Rule::exemption_allowed`] like every exemption: never for an entry point.
/// In facts of one file the gate cannot see a route in another file that refers to the
/// member, so a single-file scan must not decide it: it does not, because the exemption
/// is for a member of a role only, so the member does not hold the rule on its own
/// ([`Rule::holds`]) and `check::needs_full_scan` sends the hook to a full scan as for
/// any symbol that may be a shared part.
fn companion_exemption(
    f: &FileFacts,
    s: &Symbol,
    pattern: &str,
    ctx: &RepoContext,
) -> Option<Exempted> {
    let follows = |x: &Symbol| {
        !x.exported_as.is_empty()
            && !framework_reserved_name(f, x)
            && name_matches(&x.name, pattern)
    };
    if f.lang == "py"
        || s.exported_as.is_empty()
        || follows(s)
        || s.exported_as.iter().any(|e| e == "default")
    {
        return None;
    }
    let followers: Vec<&Symbol> = f
        .symbols
        .iter()
        .filter(|x| x.kind == s.kind && x.name != s.name && follows(x))
        .collect();
    let first = followers.first()?;
    if s.kind == SymbolKind::Class {
        let line = |c: &Symbol| (ctx.lineage(c), class_decorators(c));
        let (lineage, decorators) = line(s);
        let plain = lineage.is_empty() && decorators.is_empty();
        let on_line = |h: &&Symbol| {
            let (l, d) = line(h);
            !lineage.is_disjoint(&l) || !decorators.is_disjoint(&d) || (plain && l.is_empty())
        };
        if followers.iter().any(on_line) {
            return None;
        }
        let what = if plain {
            "a plain class".to_string()
        } else if let Some(base) = s
            .wraps
            .iter()
            .find(|w| w.kind == WrapKind::Extends)
            .map(|w| short(&w.wrapper))
            .or_else(|| lineage.iter().next().map(|l| short(l)))
        {
            format!("another kind of class (extends {base})")
        } else {
            let d = decorators.iter().next()?;
            format!("another kind of class (decorated with {}())", short(d))
        };
        let beside = if plain {
            format!(
                "beside {}, which follows the scheme on its base",
                first.name
            )
        } else {
            format!("beside {}, which follows the scheme", first.name)
        };
        return Some(Exempted::new("companion", format!("{what} {beside}")));
    }
    let own = format!("{}#{}", f.path, s.name);
    let names_it = |r: &str| {
        r == own
            || r.strip_prefix(own.as_str())
                .is_some_and(|rest| rest.starts_with(['.', '(']))
    };
    if let Some(user) = followers
        .iter()
        .find(|h| references(h).any(|r| names_it(&r)))
    {
        return Some(Exempted::new(
            "companion",
            format!("a helper of {}, which uses it in its file", user.name),
        ));
    }
    if s.kind == SymbolKind::Const && is_upper_snake(&s.name) {
        return Some(Exempted::new(
            "companion",
            format!("a constant beside {}, which follows the scheme", first.name),
        ));
    }
    None
}

/// `MAX_QUERY_LENGTH`, `HARNESS_V1_TOOLS`: upper case letters, digits and underscores,
/// with at least two letters.
/// A naming rule over values that schema libraries build is not about a plain value
/// ([`drift_core::traits::PLAIN_VALUE`]: an object, array or primitive literal, or plain
/// data from a built-in such as `Object.keys(...)`): `*Schema` names schemas, and a
/// literal response, a tool registry or an array of schemas is not one, so it could not
/// follow the rule by being renamed. Only when most of the members that follow the rule
/// are values a schema library builds ([`drift_core::traits::SCHEMA_VALUE`]) and none is
/// a plain value: a role whose followers include plain values names those too. For a
/// member of a role only, and a value that does not follow the rule.
fn plain_value_exemption(
    role: &RoleSelector,
    s: &Symbol,
    pattern: &str,
    ctx: &RepoContext,
) -> Option<Exempted> {
    let has = |x: &Symbol, t: &str| x.traits.iter().any(|y| y == t);
    if !matches!(s.kind, SymbolKind::Const | SymbolKind::Variable)
        || !has(s, drift_core::traits::PLAIN_VALUE)
        || name_matches(&s.name, pattern)
    {
        return None;
    }
    let (mut followers, mut schemas) = (0usize, 0usize);
    for (mf, m) in ctx.role_members(role) {
        if framework_reserved_name(mf, m) || !name_matches(&m.name, pattern) {
            continue;
        }
        if has(m, drift_core::traits::PLAIN_VALUE) {
            return None;
        }
        followers += 1;
        schemas += usize::from(has(m, drift_core::traits::SCHEMA_VALUE));
    }
    (schemas * 2 > followers).then(|| {
        Exempted::new(
            "plain_value",
            format!(
                "a plain value (literals or built-ins only), not a schema like the members named `{pattern}`"
            ),
        )
    })
}

/// The class a member would pass under "pass `key` to `callee()`", by the name every
/// follower's passes: the subject the member registers with `callee`
/// ([`drift_core::Symbol::decorator_args`]: `@register_type(ContentType, ...)`) followed
/// by the key's noun (`filters` -> `ContentTypeFilter`, or `ContentTypeFilters`).
fn counterparts(s: &Symbol, callee: &str, key: &str) -> Option<Vec<String>> {
    let subject = s.decorator_args.iter().find_map(|a| {
        let (d, arg) = a.split_once('=')?;
        same_ref(d, callee).then_some(arg)
    })?;
    let name = subject.rsplit_once('#').map_or(subject, |(_, n)| n);
    let name = name.rsplit('.').next().unwrap_or(name);
    let mut w = words(key);
    if name.is_empty() || w.is_empty() {
        return None;
    }
    let pascal = |w: &[String]| -> String {
        w.iter()
            .map(|x| {
                let mut c = x.chars();
                c.next()
                    .map(|f| f.to_ascii_uppercase().to_string() + c.as_str())
                    .unwrap_or_default()
            })
            .collect()
    };
    let mut out = vec![format!("{name}{}", pascal(&w))];
    let last = w.pop().expect("non-empty");
    let one = singular(&last);
    if one != last {
        w.push(one);
        out.push(format!("{name}{}", pascal(&w)));
    }
    Some(out)
}

/// "Pass `key` to `callee()`" is not about a class that has nothing to pass: every
/// member that passes the key registers a subject with `callee` that has a class named
/// for it and the key ([`counterparts`]: `CircuitType` registers `Circuit` and
/// `CircuitFilter` exists), and no class of that name exists for this member's subject
/// anywhere in the facts. At least [`MIN_ROLE_SIZE`] followers, all with a subject and a
/// counterpart; a follower without one, or a member whose subject is unknown, decides
/// nothing, and the member stays an outlier.
fn no_counterpart_exemption(
    role: &RoleSelector,
    s: &Symbol,
    callee: &str,
    key: &str,
    ctx: &RepoContext,
) -> Option<Exempted> {
    if s.kind != SymbolKind::Class {
        return None;
    }
    let own = counterparts(s, callee, key)?;
    if own.iter().any(|c| ctx.defines_class_named(c)) {
        return None;
    }
    let passes = |m: &Symbol| {
        m.args.iter().any(|a| {
            a.rsplit_once('@').is_some_and(|(c, rest)| {
                same_ref(c, callee) && rest.split_once(':').is_some_and(|(_, k)| k == key)
            })
        })
    };
    let mut followers = 0usize;
    for (_, m) in ctx.role_members(role) {
        if !passes(m) {
            continue;
        }
        let found = counterparts(m, callee, key)
            .is_some_and(|cs| cs.iter().any(|c| ctx.defines_class_named(c)));
        if !found {
            return None;
        }
        followers += 1;
    }
    (followers >= MIN_ROLE_SIZE).then(|| {
        Exempted::new(
            "no_counterpart",
            format!(
                "no {} exists to pass as `{key}`, as each member passes the class named for what it registers",
                own.last().expect("non-empty")
            ),
        )
    })
}

fn is_upper_snake(name: &str) -> bool {
    name.chars().filter(|c| c.is_ascii_uppercase()).count() >= 2
        && name
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// The class's own class decorators, package-normalised.
fn class_decorators(s: &Symbol) -> BTreeSet<String> {
    s.wraps
        .iter()
        .filter(|w| w.kind == WrapKind::Decorator)
        .map(|w| norm_ref(&w.wrapper).into_owned())
        .collect()
}

/// A class of the lineage or a class decorator is one the followers have too: the class
/// is on their line (a view on `MethodView` beside them, `@Command()` without the team's
/// decorator), not another kind.
fn shares_followers_line(
    lineage: &BTreeSet<String>,
    decorators: &BTreeSet<String>,
    followers: &crate::context::ClassProfile,
) -> bool {
    lineage.iter().any(|l| followers.lineage.contains(l))
        || decorators.iter().any(|d| followers.decorators.contains(d))
}

/// [`shares_followers_line`] for `s` against the role's followers of the rule.
fn on_followers_line(
    s: &Symbol,
    kind: WrapKind,
    any_of: &[String],
    role: Option<&RoleSelector>,
    ctx: &RepoContext,
) -> bool {
    let followers = ctx.carriers(kind == WrapKind::Extends, any_of, role);
    shares_followers_line(&ctx.lineage(s), &class_decorators(s), &followers)
}

/// A mixin (`CacheMixin`) adds behaviour to a class of any kind; it says nothing about
/// what the class is.
fn is_mixin(r: &str) -> bool {
    let name = short(r);
    let name = name.rsplit('.').next().unwrap_or(&name);
    words(name).last().is_some_and(|w| w == "mixin")
}

/// A class named for the kind of its own base: `ConfigValueField(fields.Field)`,
/// `PrefixAvailableIPsView(AvailableIPsView)`. Returns that base and the kind.
fn own_kind_base(s: &Symbol) -> Option<(&str, String)> {
    if s.kind != SymbolKind::Class {
        return None;
    }
    let own = name_kind(&s.name)?;
    s.wraps
        .iter()
        .filter(|w| w.kind == WrapKind::Extends)
        .find(|w| kind_word(&w.wrapper).is_some_and(|k| k == own))
        .map(|w| (w.wrapper.as_str(), own))
}

/// `written` (a name as a docstring spells it, dotted or not) names `target`: its
/// segments are the end of the target's full dotted path (module and export), and
/// cover at least the whole export name. `ChoiceSet` and `choices.ChoiceSet` name
/// `netbox/utilities/choices.py#ChoiceSet`; `models.Model` does not name
/// `pkg:django#db.models.Model` (its export is `db.models.Model`), nor does `Set`. A
/// target with call arguments (`Depends(get_db)`) is named by nothing.
fn names_target(written: &str, target: &str) -> bool {
    let t = norm_ref(target);
    let Some((module, export)) = t.split_once('#') else {
        return false;
    };
    if export.contains('(') {
        return false;
    }
    let module = module.strip_prefix("pkg:").unwrap_or(module);
    let module = module.strip_prefix("python:").unwrap_or(module);
    let module = module.strip_suffix("/__init__.py").unwrap_or(module);
    let module = module.strip_suffix(".py").unwrap_or(module);
    let full: Vec<&str> = module
        .split(['/', '.'])
        .chain(export.split('.'))
        .filter(|x| !x.is_empty())
        .collect();
    let want: Vec<&str> = written.split('.').collect();
    want.len() >= export.split('.').count() && full.ends_with(&want)
}

/// The phrase of `s`'s docstring that disclaims `target` by name, if any.
fn disclaimed<'s>(s: &'s Symbol, target: &str) -> Option<&'s str> {
    s.disclaims.iter().find_map(|d| {
        d.split_once('=')
            .filter(|(n, _)| names_target(n, target))
            .map(|(_, p)| p)
    })
}

/// A target that guards code: it wraps an entry point somewhere in the facts (what
/// `drift security` lists as a guard; a class view's handlers carry its bases), or
/// its name names access control ([`refuse::names_access_control`], the refuse
/// vocabulary: `LoginRequiredMixin`, `AdminOnlyView`). F7/F8 run behind
/// the exemption gate, which also refuses them under [`RepoContext::is_guard`] and for
/// [`RepoContext::is_entry_unit`].
fn guard_shaped(target: &str, ctx: &RepoContext) -> bool {
    ctx.wraps_entry_point(target) || refuse::names_access_control(&target_name(target))
}

/// The last segment of a target's short name (`db.models.Model` -> `Model`).
fn target_name(canonical: &str) -> String {
    let name = short(canonical);
    let name = name.split('(').next().unwrap_or(&name);
    name.rsplit('.').next().unwrap_or(name).to_string()
}

/// F8 ([`Rule::documented_or_registered`]): a class whose docstring disclaims the one
/// target of a base-class rule, outside entry points and guards.
fn documented_exception(
    role: Option<&RoleSelector>,
    f: &FileFacts,
    s: &Symbol,
    any_of: &[String],
    ctx: &RepoContext,
) -> Option<String> {
    let [target] = any_of else {
        return None;
    };
    if role.is_some_and(|r| r.entry != "-")
        || f.entry_points.iter().any(|e| e.symbol == s.name)
        || guard_shaped(target, ctx)
    {
        return None;
    }
    disclaimed(s, target).map(|phrase| format!("documented exception: \"{phrase}\""))
}

/// Short display name: `apps/web/lib/auth.ts#withAuth` -> `withAuth`;
/// default exports use the module name (`pkg:swr#default` -> `swr`).
pub(crate) fn short(canonical: &str) -> String {
    let Some((module, name)) = canonical.rsplit_once('#') else {
        return canonical.to_string();
    };
    if name == "default" || name.starts_with("default.") || name.starts_with("default(") {
        let stem = module
            .trim_start_matches("pkg:")
            .rsplit('/')
            .next()
            .unwrap_or(module);
        let stem = stem.split('.').next().unwrap_or(stem);
        return format!("{stem}{}", &name["default".len()..]);
    }
    name.to_string()
}

/// Why a rule is not about a member ([`Rule::exemption`]): a stable `code` for tools
/// (`another_kind`, `defining_module`, `enum`, `named_for_base`, `does_not_call`,
/// `companion`, ...) and
/// a `reason` for people.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Exempted {
    pub code: String,
    pub reason: String,
}

impl Exempted {
    pub(crate) fn new(code: &str, reason: String) -> Self {
        Self {
            code: code.to_string(),
            reason,
        }
    }
}

impl Rule {
    /// Is this unit one the rule is about? A rule holds vacuously on the others, and
    /// mining counts its evidence over the units it applies to only. See
    /// [`Rule::exemption`].
    pub fn applies(&self, view: &View, ctx: &RepoContext) -> bool {
        self.applies_in(None, view, ctx)
    }

    /// [`Rule::applies`] for a member of `role` (the convention's role): what decides
    /// whether a class is of another kind is counted within it ([`another_kind`]).
    pub fn applies_in(&self, role: Option<&RoleSelector>, view: &View, ctx: &RepoContext) -> bool {
        self.exemption_in(role, view, ctx).is_none()
    }

    /// Why the rule is not about this unit, if it is not:
    ///
    /// - "pass `k` to `f()`" is about calls to `f`: code that never calls `f` (itself,
    ///   or through a plain alias of a function that does) passes nothing to it. A
    ///   member that reaches `f` through a helper (`getPageLayoutId()` calling
    ///   `computeId({ appId })`) follows the rule there, and one that needs no `f` at
    ///   all (a table with no timestamp column under "pass `withTimezone` to
    ///   `timestamp()`") has nothing to follow. A handler that skips the team's
    ///   wrapper is still an outlier: the gate refuses every exemption for an entry
    ///   point and under a guard callee;
    /// - a call or argument-key rule about an in-repo callee is not about the other
    ///   exports of the module that defines the callee ([`callee_module`]) when no
    ///   member of the role there follows the rule: the siblings of the definition
    ///   (`publicProcedure` beside `createTRPCRouter` in a tRPC `init.ts`, the
    ///   `build*Route` helpers beside `registerEndpoints`) are its infrastructure, not
    ///   code that forgot to call it. For a member of a role only;
    /// - a base that fixes the type of an enum's values (`StrEnum`, `IntEnum`) is
    ///   about enums of that value type: an integer enum cannot be a `StrEnum`;
    /// - a base-class rule is not about a class named for its own base of another
    ///   kind: `ChoiceField(forms.ChoiceField)` next to `ChoiceSet`s is a form field,
    ///   not a choice set that forgot its base. Only when that base is certainly
    ///   neither the target nor one of its ancestors: the target and all its
    ///   ancestors are classes of the facts ([`RepoContext::ancestry_known`]). A
    ///   package base (django-ninja's `Schema`, sqlmodel's `SQLModel`) may build on the
    ///   class's own base (`OrderModel(BaseModel)` skipped the team's base), and so may
    ///   a team base whose file a hook did not load; then the class is an outlier, as
    ///   before ([`Rule::exemption_undecided`] sends hooks to a full scan). A Python
    ///   name-suffix or call rule on a class role gets the line-based test instead
    ///   ([`py_class_of_another_kind`]): `OrderModel(BaseModel)` among schemas on
    ///   `BaseModel` stays an outlier, since whether it is a helper or a misnamed schema
    ///   depends on what the other members extend;
    /// - a base-class rule is not about a Python class on a sibling base the target's
    ///   own module defines beside it ([`sibling_base_exemption`]); "call `super().m()`"
    ///   is not about a class that defines no `m` ([`super_override_exemption`]);
    /// - a base-class or class-decorator rule is not about the module that defines its
    ///   target ([`defining_module`]), nor about a class of another kind than the
    ///   classes that follow it ([`another_kind`]);
    /// - "decorated with `T`" is not about a member of the role that opts out of `T`
    ///   with a decorator of the one package `T` wraps, which no holder and other
    ///   outliers carry ([`crate::opt_out`], F11a); never for a guard- or auth-shaped
    ///   `T`;
    /// - a rule is never about its own target (F11c): `requireUser` is not an outlier
    ///   of "call `requireUser()`";
    /// - a naming rule is not about a companion of its followers: an export in a
    ///   follower's file that the follower uses, an `UPPER_SNAKE` constant beside it, or
    ///   a class on another line than every follower there ([`companion_exemption`]).
    ///
    /// The reason is shown with the proposal (`census --json`, `exempt`).
    /// The one invariant every exemption keeps: **no exemption under a guard rule, and
    /// none for an entry point.** Every exemption path ([`Rule::exemption_in`]: value-typed
    /// enums, classes named for their own base, classes of another kind, the target's
    /// module, keys to a callee never called, and any later one) asks this first. The
    /// one path that does not is a call-wrapper member wrapped in the rule's own chain
    /// without its input step, that reads no input: the guard is not missing from it.
    ///
    /// - A guard rule: a target of the rule wraps, decorates or is a base of an entry
    ///   point somewhere in the facts, as `drift security` reads guards; for a route that
    ///   is a method, the class it belongs to counts (a Nest controller's base)
    ///   ([`RepoContext::is_guard`]). Or its name says access control
    ///   ([`refuse::names_access_control`]: `LoginRequiredMixin`,
    ///   `TenantScopedModel`, `RowLevelSecurityModel`). An unguarded member there is what
    ///   the rule is for, whatever kind it looks like.
    /// - A call rule ("calls `authorize()`") whose callee is a guard done in the
    ///   handler's body ([`crate::security::callee_is_guard`]): named for access control,
    ///   shaped like a guard by its definition, or called by entry points as one.
    /// - An entry point: the member is one, a handler a route refers to by reference
    ///   (`router.get("/x", handler)`), or (a class) one of its methods is a route or is
    ///   referred to by one (`ctrl.list`) ([`RepoContext::is_entry_unit`]).
    ///
    /// The target's own class is not a member it guards, so only the entry-point
    /// condition applies to it. Conditions that only some exemptions need (sharing the
    /// followers' line, sitting in their kind of file) stay with those exemptions.
    pub fn exemption_allowed(&self, view: &View, ctx: &RepoContext) -> bool {
        let View::Symbol(f, s) = view else {
            return true;
        };
        if ctx.is_entry_unit(f, s) && !self.registers_only(f, s, ctx) {
            return false;
        }
        // The target's own definition is the guard, not a member it guards.
        if let Rule::WrappedBy { any_of, .. } = self
            && is_target_itself(f, s, any_of)
        {
            return true;
        }
        let guard = |t: &str| ctx.is_guard(t) || refuse::names_access_control(t);
        let guarded = match self {
            Rule::WrappedBy { any_of, .. } => any_of.iter().any(|t| guard(t)),
            Rule::PassesKey { callee, .. } => guard(callee),
            Rule::Calls { callee } => {
                guard(callee) || crate::security::callee_is_guard(ctx, callee)
            }
            _ => false,
        };
        !guarded
    }

    /// A class-decorator rule whose every target is a registry function of the facts
    /// ([`RepoContext::is_registry_function`]: files the class at import and hands it
    /// back unchanged), about a class that is an entry unit only because a route's
    /// handler constructs it or calls it ([`RepoContext::entry_only_as_reached`]:
    /// netbox's `SearchForm(request.GET)`, `filtersets.X(request.POST, qs)`). Such a
    /// class is an entry class (#64) because what it is built on runs with the route;
    /// nothing of a registry function does, so a class that leaves it off guards the
    /// route no less. The rule is still refused when a target guards an entry point
    /// some other way (the guard check after this), and a route's own class, a class
    /// a route method belongs to or one a route refers to stays an entry point.
    fn registers_only(&self, f: &FileFacts, s: &Symbol, ctx: &RepoContext) -> bool {
        matches!(
            self,
            Rule::WrappedBy {
                kind: WrapKind::Decorator,
                any_of,
            } if !any_of.is_empty() && any_of.iter().all(|t| ctx.is_registry_function(t))
        ) && ctx.entry_only_as_reached(f, s)
    }

    /// The rule's wrapper declares the input its handlers take
    /// (`client.inputSchema().action`): a handler wrapped in the same chain without that
    /// step (`client.action`) that provably reads no input has none to declare
    /// ([`CallMatch::MissingInput`]: same root binding and terminal method, only input
    /// steps missing).
    fn missing_input_exemption(&self, s: &Symbol, ctx: &RepoContext) -> Option<Exempted> {
        let Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of,
        } = self
        else {
            return None;
        };
        if !s
            .controls
            .iter()
            .any(|c| c == drift_core::controls::NO_INPUT)
        {
            return None;
        }
        match call_match(s, any_of, ctx) {
            CallMatch::MissingInput(w, lacks) => Some(Exempted::new(
                "no_input",
                format!(
                    "reads no input, so needs no {} ({}() without it)",
                    lacks
                        .iter()
                        .map(|l| format!(".{l}()"))
                        .collect::<Vec<_>>()
                        .join(" or "),
                    short(&w)
                ),
            )),
            _ => None,
        }
    }

    /// Whether this rule may take over, for an outlier `view` of `role`, an exemption a
    /// sibling rule of the role gives it for what it is ([`ROLE_EXEMPTION_CODES`]). Behind
    /// the exemption gate ([`Rule::exemption_allowed`]: never an entry point, never under
    /// a guard), and never for a rule whose target names access control or says who may
    /// pass ([`refuse::guard_shaped`]), an absence (`avoids`: raw SQL, secrets, layering),
    /// a control fact (input validation), an import source, a package or version rule or
    /// a wiring rule: what a member is says nothing about whether it may skip those.
    pub fn takes_role_exemptions(
        &self,
        role: Option<&RoleSelector>,
        view: &View,
        ctx: &RepoContext,
    ) -> bool {
        let targets: Vec<&str> = match self {
            Rule::WrappedBy { kind, any_of } if *kind != WrapKind::Try => {
                any_of.iter().map(String::as_str).collect()
            }
            Rule::PassesKey { callee, key, .. } => vec![callee, key],
            Rule::Calls { callee } => vec![callee],
            Rule::Before { first, then } => vec![first, then],
            Rule::Renders { component } => vec![component],
            Rule::Throws { class } => vec![class],
            Rule::Named { pattern } => vec![pattern],
            Rule::Directive { value } => vec![value],
            Rule::ModelHas { field } => vec![field],
            Rule::HasTest | Rule::PrefersLibrary { .. } => vec![],
            Rule::WrappedBy { .. }
            | Rule::Avoids { .. }
            | Rule::Control { .. }
            | Rule::PackageHas { .. }
            | Rule::DependencyVersion { .. }
            | Rule::RegisteredIn { .. }
            | Rule::MirrorsKeys { .. }
            | Rule::ImportsFrom { .. } => return false,
        };
        let callee = matches!(
            self,
            Rule::Calls { .. } | Rule::PassesKey { .. } | Rule::Before { .. }
        );
        role.is_some()
            && self.exemption_allowed(view, ctx)
            && !targets.iter().any(|t| {
                ctx.is_guard(t)
                    || refuse::names_access_control(t)
                    || refuse::guard_shaped(t)
                    || (callee && crate::security::callee_is_guard(ctx, t))
            })
    }

    pub fn exemption(&self, view: &View, ctx: &RepoContext) -> Option<Exempted> {
        self.exemption_in(None, view, ctx)
    }

    /// [`Rule::exemption`] for a member of `role`, the convention's role: the classes
    /// that follow the rule are those of the role ([`RepoContext::carriers`]).
    pub fn exemption_in(
        &self,
        role: Option<&RoleSelector>,
        view: &View,
        ctx: &RepoContext,
    ) -> Option<Exempted> {
        let View::Symbol(f, s) = view else {
            // A framework root file's module (F9, #50), through the gate like every exemption.
            if !self.exemption_allowed(view, ctx) {
                return None;
            }
            // "Has a test" is not about a module of types only: nothing in it runs.
            if let (Rule::HasTest, View::File(f)) = (self, view)
                && f.type_only
                && !f.has_test
            {
                return Some(Exempted::new(
                    "type_only",
                    "declares types only: no code that runs to test".into(),
                ));
            }
            return self
                .root_file_exemption(view, ctx)
                .map(|why| Exempted::new("root_file", why));
        };
        // Decided before the gate below, which refuses any exemption for an entry point or
        // under a guard: this one is for handlers (entry points) under the rule's own
        // guard. It never hides a missing guard: the member's chain must have the rule
        // chain's root binding and terminal method ([`builder_key`]), and lack only input
        // steps; a rule chain with a middleware step is compared exactly and exempts no
        // one ([`chain_lacks`]).
        if let Some(e) = self.missing_input_exemption(s, ctx) {
            return Some(e);
        }
        if !self.exemption_allowed(view, ctx) {
            return None;
        }
        // F7/F8 go through the gate too: never for an entry point or under a guard.
        if let Some(why) = self.documented_or_registered(role, f, s, ctx) {
            return Some(why);
        }
        // F9 (#50) too: a framework root file's root page, layout or entry module is an
        // entry point, so the gate leaves only its other root exports to F9.
        if let Some(why) = self.root_file_exemption(view, ctx) {
            return Some(Exempted::new("root_file", why));
        }
        // A factory of the rule's wrapped functions, through the gate too: never for an
        // entry point or under a guard rule.
        if let Some(why) = self.factory_exemption(view, ctx) {
            return Some(Exempted::new("factory", why));
        }
        // F11a (#58) too: an opt-out from a decorator rule ([`crate::opt_out`]). The gate
        // above has already refused it for an entry point and under a guard rule.
        if let (
            Some(role),
            Rule::WrappedBy {
                kind: WrapKind::Decorator,
                any_of,
            },
        ) = (role, self)
            && let [target] = &any_of[..]
            && let Some(why) = crate::opt_out::exemption(target, role, s, ctx)
        {
            return Some(Exempted::new("opt_out", why));
        }
        // The callee's own module, before what a member calls: a sibling of the
        // definition is infrastructure whether or not it calls the callee. Only when no
        // member of the role there follows the rule: a module whose exports call their
        // own helper holds members, not just the helper.
        if let (Some(r), Rule::Calls { callee } | Rule::PassesKey { callee, .. }) = (role, self)
            && callee_module(f, callee)
            && !is_own_target(self, f, s)
            && !self.satisfied(view, ctx)
            && !ctx
                .role_members(r)
                .iter()
                .any(|(mf, m)| mf.path == f.path && self.satisfied(&View::Symbol(mf, m), ctx))
        {
            return Some(Exempted::new(
                "defining_module",
                format!("in the module that defines {}", short(callee)),
            ));
        }
        let found = match self {
            Rule::PassesKey { callee, key, .. } => {
                let (_, does) = ctx.alias_target(f, s).unwrap_or((f, s));
                (!calls_callee(s, callee) && !calls_callee(does, callee))
                    .then(|| {
                        Exempted::new(
                            "does_not_call",
                            format!("does not call {}()", short(callee)),
                        )
                    })
                    .or_else(|| {
                        let r = role?;
                        (!self.satisfied(view, ctx))
                            .then(|| no_counterpart_exemption(r, s, callee, key, ctx))
                            .flatten()
                    })
            }
            Rule::WrappedBy {
                kind: kind @ (WrapKind::Extends | WrapKind::Decorator),
                any_of,
            } => {
                if wrapped_by(s, *kind, any_of, ctx) {
                    return None;
                }
                if *kind == WrapKind::Extends
                    && let Some(e) = sibling_base_exemption(f, s, any_of, ctx)
                {
                    return Some(e);
                }
                if *kind == WrapKind::Extends {
                    if let (Some(want), Some(have)) =
                        (targets_value_type(any_of, ctx), enum_value_type(s, ctx))
                        && want != have
                    {
                        return Some(Exempted::new(
                            "enum",
                            format!("an enum of {have} values (the base holds {want} values)"),
                        ));
                    }
                    if let Some((base, kind)) = own_kind_base(s).filter(|(base, kind)| {
                        other_kind(any_of, base, kind, ctx)
                            && any_of.iter().all(|t| ctx.ancestry_known(&norm_ref(t)))
                            && !on_followers_line(s, WrapKind::Extends, any_of, role, ctx)
                    }) {
                        return Some(Exempted::new(
                            "named_for_base",
                            format!("a {kind}, named for its base {}", short(base)),
                        ));
                    }
                }
                class_of_another_kind(f, s, *kind, any_of, role, ctx)
            }
            // For a member of a role only, as F11c below: a shared part of the role (#52)
            // keeps that reason ([`Rule::part_exemption`] reads whether the part holds the
            // rule without a role).
            Rule::Named { pattern }
                if role.is_some_and(|r| {
                    !(self.parts_apply(r, ctx)
                        && ctx
                            .part_users(r, &f.path, s)
                            .is_some_and(|n| n >= crate::parts::MIN_PART_USERS))
                }) =>
            {
                companion_exemption(f, s, pattern, ctx)
                    .or_else(|| plain_value_exemption(role?, s, pattern, ctx))
                    .or_else(|| {
                        let r = role?;
                        py_class_of_another_kind(
                            f,
                            s,
                            r,
                            pattern.strip_prefix('*').and_then(name_kind),
                            |mf, m| {
                                !framework_reserved_name(mf, m) && name_matches(&m.name, pattern)
                            },
                            ctx,
                        )
                    })
            }
            // A Python class of a class role, for a member of the role only (a shared
            // part keeps that reason, as above): a `super().m()` call is made from an
            // override of `m`, and a class of another kind than the callers is not
            // about the call.
            Rule::Calls { callee }
                if f.lang == "py"
                    && s.kind == SymbolKind::Class
                    && role.is_some_and(|r| {
                        r.kind == SymbolKind::Class
                            && !(self.parts_apply(r, ctx)
                                && ctx
                                    .part_users(r, &f.path, s)
                                    .is_some_and(|n| n >= crate::parts::MIN_PART_USERS))
                    }) =>
            {
                super_override_exemption(s, callee).or_else(|| {
                    py_class_of_another_kind(
                        f,
                        s,
                        role?,
                        None,
                        |mf, m| self.satisfied(&View::Symbol(mf, m), ctx),
                        ctx,
                    )
                })
            }
            Rule::ImportsFrom {
                name,
                source,
                instead_of,
            } => {
                let alternatives: Vec<&str> = std::iter::once(source.as_str())
                    .chain(instead_of.iter().map(String::as_str))
                    .collect();
                if provides_alternative(&f.path, &alternatives) {
                    Some(Exempted::new(
                        "defines_alternative",
                        format!("its module defines a `{name}` the rule names"),
                    ))
                } else if !inherited_references(s, ctx)
                    .any(|r| alternatives.iter().any(|a| same_ref(&r, a)))
                {
                    Some(Exempted::new(
                        "does_not_use",
                        format!("does not use `{name}`"),
                    ))
                } else {
                    None
                }
            }
            _ => None,
        };
        // F11c (#58): a rule is never about its own target (`requireUser` under "call
        // `requireUser()`"), behind the gate like every exemption: under a guard rule the
        // gate already refused it, except for a wrapper's own definition, which is the
        // guard, not a member it guards ([`Rule::exemption_allowed`]).
        // For a member of a role only, like the opt-out; a shared part of the role (#52,
        // F5) keeps that reason ([`Rule::part_exemption`], asked after this, which reads
        // whether the part holds the rule without a role).
        found.or_else(|| {
            (is_own_target(self, f, s)
                && role.is_some_and(|r| {
                    !(self.parts_apply(r, ctx)
                        && ctx
                            .part_users(r, &f.path, s)
                            .is_some_and(|n| n >= crate::parts::MIN_PART_USERS))
                }))
            .then(|| Exempted::new("own_target", "the rule's own target".into()))
        })
    }

    /// A rule about what a member is or does: its wrapper, decorator or base, a call,
    /// a key it passes, what it renders, throws or awaits, its name, the order of its
    /// calls. The shared parts of a role are exempt from these
    /// ([`Rule::part_exemption`]). Rules about where code sits (layering, directives,
    /// tests) and about files, models and packages hold for parts as for members.
    pub fn about_members(&self) -> bool {
        matches!(
            self,
            Rule::WrappedBy { .. }
                | Rule::PassesKey { .. }
                | Rule::Calls { .. }
                | Rule::Renders { .. }
                | Rule::Control { .. }
                | Rule::Throws { .. }
                | Rule::Named { .. }
                | Rule::Before { .. }
        )
    }

    /// Whether the shared parts of `role` ([`crate::parts`]) can be exempt from this
    /// rule at all: a rule about members ([`Rule::about_members`]), in a role with no
    /// entry points, that guards nothing. A rule whose target (a wrapper, decorator,
    /// root component or callee) is named like a guard ([`refuse::part_guard_shaped`]:
    /// `withAuth`, `requireSession`, `ensureTeamAccess`) or guards an entry point
    /// anywhere in the repo ([`RepoContext::is_guard`], as `drift security` reads
    /// guards; a callee, when an entry point calls it: [`RepoContext::is_guard_call`])
    /// is a security boundary: an unwrapped symbol under it is reported, whoever uses
    /// it. Base-class
    /// and class-decorator rules on classes are left to the class-kind exemptions.
    pub fn parts_apply(&self, role: &RoleSelector, ctx: &RepoContext) -> bool {
        if !self.about_members() || role.entry != "-" {
            return false;
        }
        if role.kind == SymbolKind::Class
            && matches!(
                self,
                Rule::WrappedBy {
                    kind: WrapKind::Extends | WrapKind::Decorator,
                    ..
                }
            )
        {
            return false;
        }
        let (targets, calls): (Vec<&String>, bool) = match self {
            Rule::WrappedBy { any_of, .. } => (any_of.iter().collect(), false),
            Rule::PassesKey { callee, .. } | Rule::Calls { callee } => (vec![callee], true),
            Rule::Renders { component } => (vec![component], false),
            Rule::Throws { class } => (vec![class], false),
            Rule::Before { first, then } => (vec![first, then], true),
            _ => (vec![], false),
        };
        !targets.iter().any(|t| {
            refuse::part_guard_shaped(t) || ctx.is_guard(t) || (calls && ctx.is_guard_call(t))
        })
    }

    /// Why the rule is not about this symbol of `role`, when it is a shared part of the
    /// role rather than a member ([`crate::parts`]): it breaks the rule, the rule's parts
    /// may be exempt ([`Rule::parts_apply`]), and it is used only from inside the role's
    /// scope, by at least [`crate::parts::MIN_PART_USERS`] units (`BaseButton`, which
    /// every email template renders). The reason is shown with the proposal (`exempt`).
    pub fn part_exemption(
        &self,
        role: &RoleSelector,
        view: &View,
        ctx: &RepoContext,
    ) -> Option<String> {
        let View::Symbol(f, s) = view else {
            return None;
        };
        // The one gate every exemption keeps (#45, hardened by #62): never for an entry
        // point (a handler registered by reference included), never under a guard rule (a
        // calls rule on a guard callee included).
        if !self.exemption_allowed(view, ctx) || !self.parts_apply(role, ctx) {
            return None;
        }
        let n = ctx.part_users(role, &f.path, s)?;
        if n < crate::parts::MIN_PART_USERS || self.holds(view, ctx) {
            return None;
        }
        Some(format!("shared part used by {n} members"))
    }

    /// A factory of the members a call-wrapper rule is about: a function that is not
    /// wrapped in the rule's wrapper but returns a function wrapped in it
    /// (`return createTransformer((file, api) => ...)`,
    /// [`drift_core::Symbol::returns_wrapped_by`]). What it makes carries the wrapper,
    /// so it is not a member that lacks it. Only an exact target counts, not a binding
    /// built on one, and only the returned value: a call to the wrapper anywhere else in
    /// the body is a call. Callers ask the gate first ([`Rule::exemption_allowed`]).
    fn factory_exemption(&self, view: &View, ctx: &RepoContext) -> Option<String> {
        let (
            Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of,
            },
            View::Symbol(_, s),
        ) = (self, view)
        else {
            return None;
        };
        if s.kind != SymbolKind::Function || self.satisfied(view, ctx) {
            return None;
        }
        let target = s
            .returns_wrapped_by
            .iter()
            .find(|w| any_of.iter().any(|a| same_ref(w, a)))?;
        Some(format!(
            "a factory: returns a function wrapped in {}()",
            short(target)
        ))
    }

    /// Exemptions decided by a member's own facts and the repo's registrations:
    ///
    /// - **a documented exception** (base-class rules only): a class that does not
    ///   extend the rule's one target and whose docstring explicitly says it is not, or
    ///   does not use, that target by name ([`drift_core::Symbol::disclaims`]: `"Not a
    ///   ChoiceSet: ..."`). Never for a rule with several targets (one disclaimed
    ///   alternative says nothing about the others), a guard-shaped target
    ///   ([`guard_shaped`]), a role of entry points or an entry point: a docstring must
    ///   never switch off a check that stands between a request and the code;
    /// - **a registry key already taken** (class-decorator rules): the decorator files
    ///   classes in a registry keyed by model ([`RepoContext::registered_key`]), and
    ///   the class's own `Meta.model` is already registered by another class.
    ///   Decorating it would replace that class's registration (netbox's connection
    ///   filtersets reuse the models of the primary ones).
    fn documented_or_registered(
        &self,
        role: Option<&RoleSelector>,
        f: &FileFacts,
        s: &Symbol,
        ctx: &RepoContext,
    ) -> Option<Exempted> {
        let Rule::WrappedBy { kind, any_of } = self else {
            return None;
        };
        if s.kind != SymbolKind::Class || wrapped_by(s, *kind, any_of, ctx) {
            return None;
        }
        match kind {
            WrapKind::Extends => documented_exception(role, f, s, any_of, ctx)
                .map(|why| Exempted::new("documented_exception", why)),
            WrapKind::Decorator
                if role.is_none_or(|r| r.entry == "-")
                    && !f.entry_points.iter().any(|e| e.symbol == s.name) =>
            {
                any_of.iter().find_map(|t| {
                    ctx.registered_key(t, s).map(|(key, holder)| {
                        Exempted::new(
                            "registered_key",
                            format!(
                                "its model {} is already registered with {}() by {}",
                                short(key),
                                short(t),
                                holder.rsplit_once('#').map_or(holder, |(_, n)| n)
                            ),
                        )
                    })
                })
            }
            _ => None,
        }
    }

    /// Whether a member's documented exception or taken registry key
    /// ([`Rule::documented_or_registered`]) is undecided because the facts hold fewer
    /// classes that follow the rule than the `holders` mining counted (a hook's
    /// single-file scan): the class that holds the key, the guards that make a target
    /// guard-shaped, or whether the registry is keyed at all may be in files the scan
    /// did not load. Whatever the local answer is, callers then scan the repo, so the
    /// hook decides as `drift check` does.
    pub fn documented_or_registered_undecided(
        &self,
        role: Option<&RoleSelector>,
        view: &View,
        ctx: &RepoContext,
        holders: usize,
    ) -> bool {
        let (Rule::WrappedBy { kind, any_of }, View::Symbol(_, s)) = (self, view) else {
            return false;
        };
        if s.kind != SymbolKind::Class || wrapped_by(s, *kind, any_of, ctx) {
            return false;
        }
        match kind {
            WrapKind::Decorator => {
                s.meta.iter().any(|m| m.starts_with("model="))
                    && any_of.iter().any(|t| ctx.registered_count(t) < holders)
            }
            WrapKind::Extends => {
                any_of.len() == 1
                    && disclaimed(s, &any_of[0]).is_some()
                    && ctx.carriers_count(true, any_of, role) < holders
            }
            _ => false,
        }
    }

    /// Whether this unit would be exempt from a base-class rule is undecided because the
    /// facts lack the in-repo target's class (a hook's single-file scan): it is named
    /// for a base of another kind, but the target's ancestry is unknown here and would
    /// be known in a full scan. Callers then scan the repo.
    ///
    /// Whether a class is of another kind ([`another_kind`]) is decided against the
    /// classes that follow the rule across the repo, which a single-file scan does not
    /// have: a class that does not follow the rule and is built on a package, a
    /// built-in or a class the facts lack, or carries a package's class decorator, is
    /// undecided when the facts hold fewer followers than the `followers` mining
    /// counted (the convention's holders).
    ///
    /// A key rule's member that does not call the callee, and a call or key rule's
    /// member in the callee's module, are exempt only where the gate lets them through,
    /// and whether the callee guards an entry point is read from every file: in facts of
    /// one file they are undecided.
    ///
    /// For a call-wrapper rule, the same holds of a symbol whose wrapper is built on
    /// another binding in a file the facts lack: whether it is built on the rule's
    /// wrapper ([`Rule::holds`]) is known only once that file is read.
    ///
    /// Whether a route runs a class ([`RepoContext::is_entry_class`]), and so whether the
    /// rule guards the routes that run its followers ([`RepoContext::is_guard`]), is read
    /// from every route of the repo, and a route in another file can construct the class,
    /// call it or refer to it by reference (`router.get("/x", ctrl.list)`, the one entry
    /// class set). A single-file scan has the routes of its file only, so in facts of one
    /// file ([`RepoContext::holds_one_file`]) any class exempt under any rule is
    /// undecided. More facts can only refuse an exemption, never grant one, so a class
    /// the gate refuses there is decided.
    pub fn exemption_undecided(
        &self,
        role: Option<&RoleSelector>,
        view: &View,
        ctx: &RepoContext,
        followers: usize,
    ) -> bool {
        if let View::Symbol(_, s) = view
            && s.kind == SymbolKind::Class
            && ctx.holds_one_file()
            && self.exemption_in(role, view, ctx).is_some()
        {
            return true;
        }
        // A class a route of this file constructs is refused any exemption under a
        // decorator rule whose targets these facts do not show to be registry functions
        // ([`Rule::registers_only`]); the full facts may hold their definitions.
        if let (
            View::Symbol(f, s),
            Rule::WrappedBy {
                kind: WrapKind::Decorator,
                ..
            },
        ) = (view, self)
            && s.kind == SymbolKind::Class
            && ctx.holds_one_file()
            && ctx.entry_only_as_reached(f, s)
            && !self.registers_only(f, s, ctx)
        {
            return true;
        }
        // A Python call rule a member breaks in facts of one file while it calls an
        // in-repo function those facts lack: the call may be made in that function's
        // body ([`RepoContext::calls_through_helpers`]). A full scan decides.
        if let (Rule::Calls { .. }, View::Symbol(f, s)) = (self, view)
            && f.lang == "py"
            && ctx.holds_one_file()
            && !self.holds_in(role, view, ctx)
            && s.calls.iter().any(|c| {
                !is_external(&norm_ref(c)) && !c.ends_with("(ref)") && ctx.definition(c).is_none()
            })
        {
            return true;
        }
        // A plain value under a naming rule, or a class with no counterpart to pass, in
        // facts of one file: whether the role's followers are schemas, or all have a
        // counterpart, is counted over the whole role, and the counterpart may be defined
        // in a file the scan lacks. A full scan decides.
        if ctx.holds_one_file()
            && self
                .exemption_in(role, view, ctx)
                .is_some_and(|e| e.code == "plain_value" || e.code == "no_counterpart")
        {
            return true;
        }
        // A factory ([`Rule::factory_exemption`]) in facts of one file: a route in another
        // file may refer to it by reference, and its target may guard an entry point
        // elsewhere, both of which the gate reads from every file. A full scan decides.
        if ctx.holds_one_file() && self.factory_exemption(view, ctx).is_some() {
            return true;
        }
        // A member that does not call a key rule's callee, or sits in a call or key rule's
        // callee's module, in facts of one file: whether the callee guards an entry point
        // (the gate refuses the exemption then) is read from every file.
        if matches!(self, Rule::PassesKey { .. } | Rule::Calls { .. })
            && ctx.holds_one_file()
            && self
                .exemption_in(role, view, ctx)
                .is_some_and(|e| e.code == "does_not_call" || e.code == "defining_module")
        {
            return true;
        }
        if let (
            Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of,
            },
            View::Symbol(f, s),
        ) = (self, view)
        {
            return !wrapped_by(s, WrapKind::Call, any_of, ctx) && derivation_open(f, s, ctx);
        }
        // An opt-out from a decorator rule (F11a, #58) is counted over the whole role, and
        // an in-repo target's body may be in a file the scan lacks. Only where the gate
        // would let it through, and only when the facts are not the whole role.
        if let (
            Some(r),
            Rule::WrappedBy {
                kind: WrapKind::Decorator,
                any_of,
            },
            View::Symbol(_, s),
        ) = (role, self, view)
            && let [target] = &any_of[..]
            && self.exemption_allowed(view, ctx)
            && crate::opt_out::undecided(target, r, s, ctx)
            // Fewer holders in these facts than mining counted: a single-file scan. A
            // full scan decides it.
            && ctx
                .role_members(r)
                .iter()
                .filter(|(_, m)| wrapped_by(m, WrapKind::Decorator, any_of, ctx))
                .count()
                < followers
        {
            return true;
        }
        let (
            Rule::WrappedBy {
                kind: kind @ (WrapKind::Extends | WrapKind::Decorator),
                any_of,
            },
            View::Symbol(f, s),
        ) = (self, view)
        else {
            return false;
        };
        if wrapped_by(s, *kind, any_of, ctx)
            || s.kind != SymbolKind::Class
            || !self.exemption_allowed(view, ctx)
        {
            return false;
        }
        let named = *kind == WrapKind::Extends
            && own_kind_base(s).is_some_and(|(base, kind)| other_kind(any_of, base, &kind, ctx))
            && any_of.iter().any(|t| {
                let t = norm_ref(t);
                !is_external(&t) && !ctx.knows_class(&t)
            });
        // Whether the rule is a guard, and what its followers are built on, is read from
        // the whole repo: with fewer followers than mining counted (a single-file scan),
        // any class that is or could be exempt is decided by a full scan.
        let may = defining_module(f, any_of).is_some()
            || built_on_others(s, ctx)
            || own_kind_base(s).is_some()
            || self.exemption_in(role, view, ctx).is_some();
        named || (may && ctx.carriers_count(*kind == WrapKind::Extends, any_of, role) < followers)
    }

    /// A rule about how members are built is not about a framework root file
    /// ([`frameworks::root_file`]) that does not follow it: the app's root page, root
    /// layout or entry module is the one file of its kind, a one-off among the pages,
    /// layouts or modules beside it (the docs home page among the guide pages). Only
    /// the file's root exports are exempt (its default export, Next's reserved exports
    /// such as `generateMetadata`, the module itself), never a helper in it. Never for
    /// a rule whose target says who may pass ([`refuse::guard_shaped`]: the wrapper,
    /// the callee, the rendered component, the callee or key passed, the class thrown,
    /// the name): a root page that skips `auth()`, `<RequireAuth>` or the app's auth
    /// wrapper is an outlier to review like any other.
    fn root_file_exemption(&self, view: &View, ctx: &RepoContext) -> Option<String> {
        let (f, root_export) = match view {
            View::File(f) => (*f, true),
            View::Symbol(f, s) => (
                *f,
                s.kind == SymbolKind::Module
                    || s.exported_as
                        .iter()
                        .any(|e| e == "default" || NEXT_RESERVED_EXPORTS.contains(&e.as_str())),
            ),
            _ => return None,
        };
        if !root_export {
            return None;
        }
        let targets: Vec<&str> = match self {
            Rule::WrappedBy { kind, any_of } if *kind != WrapKind::Try => {
                any_of.iter().map(String::as_str).collect()
            }
            Rule::Calls { callee } => vec![callee],
            Rule::Renders { component } => vec![component],
            Rule::PassesKey { callee, key, .. } => vec![callee, key],
            Rule::Throws { class } => vec![class],
            Rule::Named { pattern } => vec![pattern],
            _ => return None,
        };
        if targets.iter().any(|t| refuse::guard_shaped(t)) {
            return None;
        }
        let (rel, what) = frameworks::root_file(f, |dep| ctx.package_depends_on(&f.package, dep))?;
        (!self.satisfied(view, ctx)).then(|| format!("{what} ({rel}), a framework root file"))
    }

    /// Does this unit satisfy the rule? Rules about another kind of unit hold vacuously,
    /// and so do units the rule does not apply to ([`Rule::applies`]).
    /// `ctx` gives what a rule needs beyond the unit (the workspace's agreed versions).
    pub fn holds(&self, view: &View, ctx: &RepoContext) -> bool {
        self.holds_in(None, view, ctx)
    }

    /// [`Rule::holds`] for a member of `role`, the convention's role
    /// ([`Rule::exemption_in`]).
    pub fn holds_in(&self, role: Option<&RoleSelector>, view: &View, ctx: &RepoContext) -> bool {
        if !self.applies_in(role, view, ctx) {
            return true;
        }
        self.satisfied(view, ctx)
    }

    /// [`Rule::holds`], for a unit the rule applies to.
    fn satisfied(&self, view: &View, ctx: &RepoContext) -> bool {
        match (self, view) {
            (Rule::Avoids { signal }, v) => {
                let sigs = signals(v, ctx);
                // Conventions accepted before `typing.Any` had its own signal say
                // "avoids any" for Python code too: they keep meaning `typing.Any`.
                !sigs.contains(signal) && !(signal == "any" && sigs.contains("typing_any"))
            }
            (Rule::Directive { value }, View::Symbol(f, _) | View::File(f)) => {
                f.directives.iter().any(|d| d == value)
            }
            (Rule::HasTest, View::File(f)) => f.has_test,
            (Rule::PrefersLibrary { group, preferred }, View::File(f)) => {
                group_libraries(f, group_members(group))
                    .iter()
                    .all(|l| l == preferred)
            }
            (Rule::ModelHas { field }, View::Model(m)) => {
                let want = norm_field(field);
                m.fields.iter().any(|f| norm_field(f) == want)
            }
            (Rule::PackageHas { item }, View::Package(p)) => match item.split_once(':') {
                Some(("script", n)) => p.scripts.iter().any(|s| s == n),
                Some(("flag", n)) => p.compiler_flags.iter().any(|s| s == n),
                _ => true,
            },
            (Rule::DependencyVersion { name, range }, View::Package(p)) => {
                // A pin, or the strict majority now; with no majority (a tie, or an
                // upgrade halfway through) nothing is agreed, so nothing is broken.
                let python = crate::roles::is_python_package(p);
                let Some(range) = range
                    .as_deref()
                    .or_else(|| ctx.majority_range_in(python, name))
                else {
                    return true;
                };
                p.dependencies
                    .iter()
                    .filter_map(|d| split_dep(d))
                    .filter(|(n, _)| n == name)
                    .all(|(_, r)| r == range)
            }
            (Rule::Named { .. }, View::Symbol(f, symbol)) if framework_reserved_name(f, symbol) => {
                true
            }
            (Rule::Named { pattern }, View::Symbol(_, symbol)) => {
                name_matches(&symbol.name, pattern)
            }
            (Rule::ImportsFrom { instead_of, .. }, View::Symbol(_, symbol)) => {
                !references(symbol).any(|r| instead_of.iter().any(|a| same_ref(&r, a)))
            }
            (_, View::Symbol(file, own)) => {
                // A plain alias of a function does what the function does ([`features`]).
                let (file, symbol) = ctx.alias_target(file, own).unwrap_or((file, own));
                self.satisfied_by(file, symbol, ctx)
            }
            _ => true,
        }
    }

    /// [`Rule::satisfied`] for the facts of a symbol of `file`: what it is wrapped in,
    /// passes, calls, renders, controls, throws and does in order.
    fn satisfied_by(&self, file: &FileFacts, symbol: &Symbol, ctx: &RepoContext) -> bool {
        match self {
            Rule::WrappedBy { kind, any_of } => wrapped_by(symbol, *kind, any_of, ctx),
            Rule::PassesKey { callee, index, key } => symbol.args.iter().any(|a| {
                a.rsplit_once('@').is_some_and(|(c, rest)| {
                    same_ref(c, callee) && rest == format!("{index}:{key}")
                })
            }),
            Rule::Calls { callee } => {
                symbol.calls.iter().any(|c| same_ref(c, callee))
                    || (symbol.kind == SymbolKind::Class && ctx.inherits_call(symbol, callee))
                    // Python: through an in-repo helper function it calls.
                    || (file.lang == "py" && ctx.calls_through_helpers(symbol, callee))
            }
            Rule::Renders { component } => renders_through_file(file, symbol)
                .iter()
                .any(|c| same_ref(c, component)),
            Rule::Control { value } => symbol.controls.iter().any(|c| c == value),
            Rule::Throws { class } => symbol.throws.iter().any(|c| same_ref(c, class)),
            Rule::Before { first, then } => {
                let pos = |x: &str| symbol.order.iter().position(|c| same_ref(c, x));
                match pos(then) {
                    None => true,
                    Some(j) => pos(first).is_some_and(|i| i < j),
                }
            }
            _ => true,
        }
    }

    /// Imperative, human-readable form.
    pub fn describe(&self) -> String {
        match self {
            Rule::WrappedBy { kind, any_of } => {
                if *kind == WrapKind::Try {
                    return "wrap their body in try/catch".to_string();
                }
                // Calls and decorators read as calls; base classes and components do not.
                let call = matches!(kind, WrapKind::Call | WrapKind::Decorator);
                let names: Vec<_> = any_of
                    .iter()
                    .map(|a| {
                        let n = short(a);
                        match kind {
                            WrapKind::Jsx => format!("<{n}>"),
                            _ if call => format!("{n}()"),
                            _ => n,
                        }
                    })
                    .collect();
                let verb = match kind {
                    WrapKind::Call => "are wrapped in",
                    WrapKind::Decorator => "are decorated with",
                    WrapKind::Jsx => "render inside",
                    WrapKind::Extends => "extend",
                    WrapKind::Authenticates => "authenticate with",
                    WrapKind::Opens => "are opened to anyone with",
                    WrapKind::Config | WrapKind::ConfigAuthenticates => "are configured with",
                    WrapKind::AppHook => "run after the app hook",
                    WrapKind::Try => unreachable!(),
                };
                format!("{verb} {}", names.join(" or "))
            }
            Rule::PassesKey { callee, key, .. } => format!("pass `{key}` to {}()", short(callee)),
            Rule::Calls { callee } => format!("call {}()", short(callee)),
            Rule::Renders { component } => format!("render <{}>", short(component)),
            Rule::Directive { value } => format!("declare \"{value}\""),
            Rule::Control { value } => match value.as_str() {
                "validates" => "validate their input with a schema".to_string(),
                "typed_return" => "declare their return type".to_string(),
                "throw" => "throw on failure".to_string(),
                _ => format!("use `{value}`"),
            },
            Rule::Throws { class } => format!("throw {}", short(class)),
            Rule::Named { pattern } => format!("are named `{pattern}`"),
            Rule::Before { first, then } => {
                format!("call {}() before {}()", short(first), short(then))
            }
            Rule::Avoids { signal } => signal_label(signal),
            Rule::HasTest => "have a test file".to_string(),
            Rule::PrefersLibrary { group, preferred } => {
                let others: Vec<&str> = group_members(group)
                    .iter()
                    .copied()
                    .filter(|m| m != preferred)
                    .collect();
                format!("use {preferred} for {group}, not {}", others.join("/"))
            }
            Rule::ModelHas { field } => format!("have a `{field}` field"),
            Rule::PackageHas { item } => match item.split_once(':') {
                Some(("script", n)) => format!("define a `{n}` script"),
                Some(("flag", n)) => format!("enable `{n}` in tsconfig"),
                _ => format!("have `{item}`"),
            },
            Rule::DependencyVersion { name, range: None } => {
                format!("use the {name} version most workspace packages use")
            }
            Rule::DependencyVersion {
                name,
                range: Some(range),
            } => format!("depend on {name}@{range}"),
            Rule::RegisteredIn {
                slot,
                path,
                named,
                reach,
            } => {
                let label = crate::wiring::slot_label(slot);
                let named = if named.is_empty() {
                    String::new()
                } else {
                    format!("named `{named}` ")
                };
                named
                    + &match (slot == crate::wiring::EXPORTS_SLOT, path.is_empty()) {
                        (true, false) => format!("are re-exported by {path}"),
                        (true, true) => "are re-exported by a barrel file".to_string(),
                        (false, false) if *reach => format!(
                            "are registered in {label} of {path}, directly or in the lists it reaches"
                        ),
                        (false, false) => format!("are registered in {label} of {path}"),
                        (false, true) => format!("are registered in some {label} list"),
                    }
            }
            Rule::MirrorsKeys { to, .. } => format!("are added to {to} in the same change"),
            Rule::ImportsFrom {
                name,
                source,
                instead_of,
            } if !source.starts_with("pkg:") => {
                // The team's version: named by the file that defines it, against the
                // library references it stands in for.
                let others: Vec<String> = instead_of
                    .iter()
                    .map(|r| format!("`{}`", dotted_ref(r)))
                    .collect();
                format!(
                    "use the team's `{name}` ({}), not {}",
                    source_module(source),
                    others.join(" or ")
                )
            }
            Rule::ImportsFrom {
                name,
                source,
                instead_of,
            } => {
                let others: Vec<String> = instead_of.iter().map(|r| source_module(r)).collect();
                format!(
                    "take `{name}` from {}, not {}",
                    source_module(source),
                    others.join(" or ")
                )
            }
        }
    }

    /// Calling a library (`useState`, `z.object`) is everywhere; it only counts as a
    /// role's convention when it is far more common in the role than elsewhere.
    fn min_lift(&self) -> f64 {
        match self {
            Rule::Calls { callee } | Rule::PassesKey { callee, .. }
                if callee.starts_with("pkg:") || callee.starts_with("global#") =>
            {
                MIN_LIFT_EXTERNAL_CALL
            }
            // Framework directives (`use client`) are spread by need, not by team choice,
            // unless a role uses them far more than the rest of the code.
            Rule::Directive { .. } => MIN_LIFT_EXTERNAL_CALL,
            // Models and packages form one role each: the whole population, so lift is 1.
            Rule::ModelHas { .. } | Rule::PackageHas { .. } => 0.0,
            Rule::RegisteredIn { .. } | Rule::MirrorsKeys { .. } => 0.0,
            _ => MIN_LIFT,
        }
    }

    fn priority(&self) -> u8 {
        match self {
            Rule::WrappedBy { .. } => 0,
            Rule::PassesKey { .. } => 1,
            Rule::Calls { .. } => 2,
            Rule::Renders { .. } => 3,
            Rule::Directive { .. } => 4,
            Rule::Control { .. } => 5,
            Rule::Before { .. } => 1,
            Rule::Avoids { .. } => 2,
            Rule::Throws { .. } => 3,
            Rule::PrefersLibrary { .. } | Rule::DependencyVersion { .. } => 3,
            // Over the same holders, where the outliers take the thing from says more
            // than that the holders call it.
            Rule::ImportsFrom { .. } => 1,
            Rule::HasTest | Rule::ModelHas { .. } | Rule::PackageHas { .. } => 4,
            Rule::Named { .. } => 6,
            Rule::RegisteredIn { .. } | Rule::MirrorsKeys { .. } => 2,
        }
    }

    /// How specific the referenced thing is: internal code beats packages beats built-ins.
    fn specificity(&self) -> f64 {
        let target = match self {
            Rule::WrappedBy { any_of, .. } => any_of.first().map_or("", String::as_str),
            Rule::PassesKey { callee, .. } | Rule::Calls { callee } => callee,
            Rule::Renders { component } => component,
            Rule::Directive { .. } => return 0.8,
            Rule::Control { value } if value == "validates" => return 0.8,
            Rule::Control { .. } => return 0.4,
            Rule::Throws { class } => class,
            Rule::Before { first, then } => {
                let internal = |c: &str| !c.starts_with("pkg:") && !c.starts_with("global#");
                return if internal(first) || internal(then) {
                    1.0
                } else {
                    0.6
                };
            }
            Rule::Avoids { signal } if signal.starts_with("sink:") || signal == "client_leak" => {
                return 1.0;
            }
            Rule::Avoids { .. } => return 0.7,
            Rule::PrefersLibrary { .. } | Rule::DependencyVersion { .. } => return 0.8,
            Rule::ImportsFrom { source, .. } => source,
            Rule::HasTest | Rule::ModelHas { .. } | Rule::PackageHas { .. } => return 0.6,
            Rule::Named { .. } => return 0.5,
            Rule::RegisteredIn { .. } | Rule::MirrorsKeys { .. } => return 1.0,
        };
        let external = target.starts_with("pkg:") || target.starts_with("unresolved:");
        match self {
            _ if target.starts_with("global#") || target == "try" => 0.3,
            // Calling a library primitive (`useState`) is rarely a team convention.
            Rule::Calls { .. } | Rule::PassesKey { .. } if external => 0.3,
            _ if external => 0.6,
            _ => 1.0,
        }
    }
}

/// How many in-file components deep [`renders_through_file`] follows.
const IN_FILE_RENDER_DEPTH: usize = 4;

/// What a symbol renders, including what the unexported components of its own file
/// that it renders do: a page split into in-file parts (`ChangelogPage` rendering a
/// local `ChangelogIndex` that renders `<DefaultLayout>`) renders what its parts do.
/// Exported components are units of their own and are not followed.
pub fn renders_through_file<'f>(file: &'f FileFacts, symbol: &'f Symbol) -> Vec<&'f str> {
    let mut out: Vec<&str> = symbol.renders.iter().map(String::as_str).collect();
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    let mut frontier: Vec<&str> = out.clone();
    for _ in 0..IN_FILE_RENDER_DEPTH {
        let mut next = Vec::new();
        for r in frontier {
            let Some((path, name)) = r.split_once('#') else {
                continue;
            };
            if path != file.path || !seen.insert(r) {
                continue;
            }
            let part = file.symbols.iter().find(|t| {
                t.name == name && t.exported_as.is_empty() && t.kind == SymbolKind::Component
            });
            for c in part.into_iter().flat_map(|t| &t.renders) {
                if !out.contains(&c.as_str()) {
                    out.push(c);
                    next.push(c.as_str());
                }
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }
    out
}

/// The base of a class whose base expression names no class (`class X(*BASES)`):
/// it only makes the class's ancestry unknown, and is no rule of its own.
fn is_unknown_base(r: &str) -> bool {
    r.strip_prefix("global#") == Some(drift_core::UNKNOWN_BASE_NAME)
}

/// A call of a Python built-in (`str()`, `len()`, `isinstance()`, a bare `super()`),
/// or of a name nothing binds: what the code needs, never a team's choice ("functions in
/// `garmin/` call `str()`", "classes call `super()`"). A method called on `super()`
/// (`super().__call__()`) is the call an override makes, and stays a rule.
fn is_py_builtin_call(callee: &str) -> bool {
    callee
        .strip_prefix("global#")
        .is_some_and(|n| !n.is_empty() && !n.contains(['.', '(']))
}

/// Facts of one unit as single-item rules.
fn features(view: &View, ctx: &RepoContext) -> BTreeSet<Rule> {
    let mut out = BTreeSet::new();
    match view {
        View::Symbol(own_file, own) => {
            // What a plain alias of a function does is what the function does: its
            // wrappers, keys, calls, renders, controls and throws. Its name is its own.
            let (file, s) = ctx.alias_target(own_file, own).unwrap_or((own_file, own));
            // Wraps applied by configuration are not written by anyone at the symbol.
            for w in s.wraps.iter().filter(|w| {
                !matches!(
                    w.kind,
                    WrapKind::Config | WrapKind::ConfigAuthenticates | WrapKind::AppHook
                )
            }) {
                if !is_unknown_base(&w.wrapper) {
                    out.insert(Rule::WrappedBy {
                        kind: w.kind,
                        any_of: vec![norm_ref(&w.wrapper).into_owned()],
                    });
                }
                // A class extends what its in-repo base extends, at any depth.
                if w.kind == WrapKind::Extends {
                    for a in ctx
                        .ancestors(&norm_ref(&w.wrapper))
                        .iter()
                        .filter(|a| !is_unknown_base(a))
                    {
                        out.insert(Rule::WrappedBy {
                            kind: WrapKind::Extends,
                            any_of: vec![a.clone()],
                        });
                    }
                }
            }
            for a in &s.args {
                if let Some((callee, rest)) = a.rsplit_once('@')
                    && let Some((idx, key)) = rest.split_once(':')
                    && let Ok(index) = idx.parse()
                    // An unpacked `**opts` is no key a team passes.
                    && key != drift_core::SPLAT_KEY
                {
                    out.insert(Rule::PassesKey {
                        callee: norm_ref(callee).into_owned(),
                        index,
                        key: key.to_string(),
                    });
                }
            }
            for c in &s.calls {
                if !c.ends_with("(ref)") && !(file.lang == "py" && is_py_builtin_call(c)) {
                    out.insert(Rule::Calls {
                        callee: norm_ref(c).into_owned(),
                    });
                }
            }
            for r in renders_through_file(file, s) {
                out.insert(Rule::Renders {
                    component: norm_ref(r).into_owned(),
                });
            }
            // Directives (`"use client"`) are added where a file needs them, not chosen
            // by a team: never proposed (0 of 3 accepted in the labelled evaluation).
            for c in &s.controls {
                // `await` and `return_jsx` describe what code is, not a team decision.
                if !NON_CONVENTION_CONTROLS.contains(&c.as_str())
                    && !c.starts_with(drift_core::controls::SHAPE)
                    && !c.starts_with(drift_core::controls::SIDES)
                    && !c.starts_with(drift_core::controls::REFUSES_ABSENT)
                    && !c.starts_with(drift_core::controls::CALLED_LEAVING)
                    && !c.starts_with(drift_core::controls::CALLER_FROM)
                    && !c.starts_with(drift_core::controls::HOLDS_SENT)
                    && !c.starts_with(drift_core::controls::READS_HELD)
                    && !c.starts_with(drift_core::controls::FILTER_OWN)
                    && !c.starts_with(drift_core::controls::ROW_SET)
                    && !c.starts_with(drift_core::controls::PKG_ARG_VALUE)
                    && !c.starts_with(drift_core::controls::FILTER_EVERY)
                    && !c.starts_with(drift_core::controls::FILTER_VALUE)
                    && !c.starts_with(drift_core::controls::ARG_VALUE)
                    && !c.starts_with(drift_core::controls::ATTR_PARAM)
                    && !c.starts_with(drift_core::controls::RETURNS_REJECTION)
                    && !c.starts_with(drift_core::controls::RETURNS_RESULT_OF)
                    && !c.starts_with(drift_core::controls::DROPS_RESULT_OF)
                    && !c.starts_with(drift_core::controls::EXIT_UNREAD)
                    && !c.starts_with(drift_core::controls::VERIFIES_SIGNATURE)
                    // What a body does with what it is given, and what its returns
                    // give: read by `drift security` and the practice map only.
                    && !c.starts_with(drift_core::controls::SINK_FED)
                    && !c.starts_with(drift_core::controls::SINK_FED_MADE)
                    && !c.starts_with(drift_core::controls::PASSES_PARAM)
                    && !c.starts_with(drift_core::controls::PASSES_MADE)
                    && !c.starts_with(drift_core::controls::RETURNS_GIVEN)
                    && !c.starts_with(drift_core::controls::REFUSES_WITHOUT)
                    && c != drift_core::controls::RETURNS_CREDENTIAL
                    && c != drift_core::controls::GIVES_CALLER
                    && !c.starts_with(drift_core::controls::RETURNS_BUILT)
                    && !c.starts_with(drift_core::controls::ROWS)
                    && !c.starts_with(drift_core::controls::HANDED_AFTER)
                    && !c.starts_with(drift_core::controls::LEAVES_AFTER)
                    && !c.starts_with(drift_core::controls::TRUE_AFTER)
                {
                    out.insert(Rule::Control { value: c.clone() });
                }
            }
            for t in &s.throws {
                out.insert(Rule::Throws {
                    class: norm_ref(t).into_owned(),
                });
            }
            if !framework_reserved_name(own_file, own) {
                for pattern in name_patterns(&own.name) {
                    out.insert(Rule::Named { pattern });
                }
            }
        }
        View::File(f) => {
            if f.has_test {
                out.insert(Rule::HasTest);
            }
        }
        View::Model(m) => {
            for f in &m.fields {
                out.insert(Rule::ModelHas {
                    field: norm_field(f),
                });
            }
        }
        View::Package(p) => {
            for s in &p.scripts {
                out.insert(Rule::PackageHas {
                    item: format!("script:{s}"),
                });
            }
            for f in &p.compiler_flags {
                out.insert(Rule::PackageHas {
                    item: format!("flag:{f}"),
                });
            }
        }
    }
    out
}

/// 95% Wilson score lower bound for `k` successes out of `n`.
pub fn wilson_lower_bound(k: usize, n: usize) -> f64 {
    if n == 0 {
        return 0.0;
    }
    let z = 1.959_963_984_540_054_f64;
    let n_f = n as f64;
    let p = k as f64 / n_f;
    let z2 = z * z;
    let centre = p + z2 / (2.0 * n_f);
    let margin = z * ((p * (1.0 - p) + z2 / (4.0 * n_f)) / n_f).sqrt();
    (centre - margin) / (1.0 + z2 / n_f)
}

/// The upper bound of the 95% Wilson interval of `k/n`: the twin of
/// [`wilson_lower_bound`] (1 for `n == 0`, where nothing is known).
pub fn wilson_upper_bound(k: usize, n: usize) -> f64 {
    if n == 0 {
        return 1.0;
    }
    let z = 1.959_963_984_540_054_f64;
    let n_f = n as f64;
    let p = k as f64 / n_f;
    let z2 = z * z;
    let centre = p + z2 / (2.0 * n_f);
    let margin = z * ((p * (1.0 - p) + z2 / (4.0 * n_f)) / n_f).sqrt();
    (centre + margin) / (1.0 + z2 / n_f)
}

/// Integer bit length of `n + 1`: a platform-exact stand-in for `log2(1 + n)`.
fn size_weight(n: usize) -> f64 {
    f64::from(usize::BITS - (n + 1).leading_zeros())
}

/// Round to 3 decimals for stable serialised output.
pub fn r3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// A unit that breaks a convention.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Outlier {
    pub path: String,
    pub symbol: String,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Evidence {
    pub holders: usize,
    pub total: usize,
    pub lower_bound: f64,
    pub lift: f64,
    /// For variant sets: how many members use each alternative.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub split: Vec<(String, usize)>,
    /// The role's size when the rule applies to only part of it ([`Rule::applies`]):
    /// `total` counts the members it is about, the tier counts the role.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_members: Option<usize>,
    /// How many of the role's members are Python (`.py`/`.pyi` files or Python package
    /// manifests); absent when none is. The tier reads it (decision D7): a convention with any
    /// Python member advises only, whatever its example's language
    /// ([`crate::tier::convention_language`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub python_members: Option<usize>,
}

impl Evidence {
    /// Members of the role, which decide the tier and whether it may block.
    pub fn role_size(&self) -> usize {
        self.role_members.unwrap_or(self.total)
    }
}

/// A member of a role that a convention is not about ([`Rule::exemption`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Exempt {
    pub path: String,
    pub symbol: String,
    pub line: u32,
    /// Why, for tools: `another_kind`, `defining_module`, `enum`, `named_for_base`,
    /// `does_not_call`, `companion` and the others [`Exempted`] lists.
    #[serde(default)]
    pub code: String,
    pub reason: String,
}

/// What a wiring rule's evidence points at, for people and tools.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WiringEvidence {
    /// The registry (the family's fullest list), or the file keys are mirrored to,
    /// and a member already there.
    pub registry: crate::check::WireHint,
    /// Lists that make up the registry: one file's lists of the slot (1, or more:
    /// two `@Module`s, a router nested in a router), or a family's size; 0 for
    /// co-change.
    pub lists: usize,
    /// For co-change rules: the history window the evidence comes from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history: Option<HistoryWindow>,
}

/// The git history a co-change rule was mined from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryWindow {
    /// The commit the window ends at.
    pub head: String,
    /// Commits read (those that touched a key file), at most `max`.
    pub commits: usize,
    pub max: usize,
}

/// A mined convention, before a person has reviewed it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Candidate {
    pub id: String,
    pub role: RoleSelector,
    pub rule: Rule,
    pub evidence: Evidence,
    pub score: f64,
    /// `path#symbol` of a typical member to copy from.
    pub example: String,
    pub outliers: Vec<Outlier>,
    /// Large enough role to be allowed to block.
    pub can_block: bool,
    /// Wiring rules only: the registry and a registered sibling.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wiring: Option<WiringEvidence>,
    /// Role members the rule is not about, with why: not outliers, not in `total`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exempt: Vec<Exempt>,
    /// Holders that hold the rule through an in-repo base's declaration
    /// ([`RepoContext::inherits_call`]), not in their own body.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inherited: Vec<Outlier>,
    /// Holders of a call-wrapper rule wrapped in another binding that is built on the
    /// rule's wrapper (`bookingsProcedure = authedProcedure.use(...)`), or in the rule's
    /// builder chain with more steps.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub derived: Vec<DerivedHolder>,
}

/// Who an exemption code leaves out and why, as the rule statement says it
/// ([`except_clause`]): (one member, several members, the reason).
fn exemption_words(code: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match code {
        "another_kind" => ("a class", "classes", "of another kind"),
        "enum" => ("an enum", "enums", "of values of another type"),
        "named_for_base" => ("a class", "classes", "named for a base of another kind"),
        "sibling_base" => (
            "a class",
            "classes",
            "on a sibling base the target's module defines",
        ),
        "documented_exception" => ("a member", "members", "documented as an exception"),
        "defining_module" => (
            "a member",
            "members",
            "of the module that defines a rule's target",
        ),
        "root_file" => (
            "a framework root file",
            "framework root files",
            "wired by the framework",
        ),
        "companion" => (
            "a companion",
            "companions",
            "a helper or constant beside the members that follow it",
        ),
        "shared_part" => (
            "a shared part",
            "shared parts",
            "used by several members, not a member",
        ),
        "does_not_call" => ("a member", "members", "not calling the callee"),
        "does_not_use" => ("a member", "members", "not using the name"),
        "defines_alternative" => ("a module", "modules", "defining the name itself"),
        "no_input" => ("a handler", "handlers", "reading no input"),
        "factory" => (
            "a factory",
            "factories",
            "returning functions wrapped in it",
        ),
        "registered_key" => ("a class", "classes", "whose model is already registered"),
        "opt_out" => (
            "a member",
            "members",
            "opting out with the wrapped package's own decorator",
        ),
        "own_target" => (
            "its own target",
            "its own targets",
            "a rule is never about its target",
        ),
        "does_not_override" => ("a class", "classes", "with no override"),
        "plain_value" => ("a plain value", "plain values", "not a schema"),
        "type_only" => (
            "a module of types",
            "modules of types",
            "with no code to test",
        ),
        "no_counterpart" => ("a class", "classes", "with nothing of the kind to pass"),
        _ => return None,
    })
}

/// The members the rule leaves out, folded into its statement: ", except 2 classes (of
/// another kind) and a shared part (used by several members, not a member)". Grouped by
/// code, most first; empty when none is.
pub fn except_clause(exempt: &[Exempt]) -> String {
    let mut by_code: BTreeMap<&str, usize> = BTreeMap::new();
    for e in exempt {
        *by_code.entry(e.code.as_str()).or_default() += 1;
    }
    let mut groups: Vec<(&str, usize)> = by_code.into_iter().collect();
    groups.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let parts: Vec<String> = groups
        .into_iter()
        .map(|(code, n)| match exemption_words(code) {
            Some((one, _, why)) if n == 1 => format!("{one} ({why})"),
            Some((_, many, why)) => format!("{n} {many} ({why})"),
            None if n == 1 => format!("a member ({})", code.replace('_', " ")),
            None => format!("{n} members ({})", code.replace('_', " ")),
        })
        .collect();
    match parts.len() {
        0 => String::new(),
        1 => format!(", except {}", parts[0]),
        _ => {
            let (last, rest) = parts.split_last().expect("two or more");
            format!(", except {} and {last}", rest.join(", "))
        }
    }
}

impl Candidate {
    /// The rule statement agents and people read: the role, the rule and the members it
    /// leaves out ([`except_clause`]).
    pub fn summary(&self) -> String {
        let mut rule = self.rule.describe();
        // Layering inside one package: the target as the role's place is, from the
        // package root (`apps/web: files in modules/** do not import from lib/jobs/**`),
        // as `--root <package>` writes it.
        let pkg = self.role.package.as_str();
        if let Rule::Avoids { signal } = &self.rule
            && !pkg.is_empty()
            && let Some(t) = signal.strip_prefix("import:")
            && let Some(rest) = t.strip_prefix(&format!("{pkg}/"))
        {
            rule = rule.replacen(&format!("from {t}/**"), &format!("from {rest}/**"), 1);
        }
        format!(
            "{} {rule}{}",
            self.role.describe(),
            except_clause(&self.exempt)
        )
    }
}

/// A holder of a call-wrapper rule through a wrapper built on the rule's
/// ([`Candidate::derived`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DerivedHolder {
    pub path: String,
    pub symbol: String,
    pub line: u32,
    /// The member's wrapper (canonical): `.../bookings/util.ts#bookingsProcedure`.
    pub wrapper: String,
    /// The rule's wrapper it is built on (one of `any_of`).
    pub from: String,
}

/// Stable short id for a (role, rule) pair.
pub fn convention_id(role: &RoleSelector, rule: &Rule) -> String {
    // `reach` only describes how a wiring rule was mined (the summary says
    // "directly or in the lists it reaches"): it is not part of the rule's identity,
    // so a rule whose evidence moves between direct and reached keeps its id.
    let cleared;
    let rule = match rule {
        Rule::RegisteredIn {
            slot,
            path,
            named,
            reach: true,
        } => {
            cleared = Rule::RegisteredIn {
                slot: slot.clone(),
                path: path.clone(),
                named: named.clone(),
                reach: false,
            };
            &cleared
        }
        r => r,
    };
    let bytes = serde_json::to_vec(&(role, rule)).unwrap_or_default();
    let h = blake3::hash(&bytes).to_hex();
    format!("D-{}", &h[..6])
}

#[derive(Debug, Clone)]
pub struct MineOptions {
    pub max_per_repo: usize,
}

impl Default for MineOptions {
    fn default() -> Self {
        Self {
            max_per_repo: DEFAULT_MAX_PER_REPO,
        }
    }
}

/// The result of mining a repository.
#[derive(Debug, Clone)]
pub struct Mined {
    pub candidates: Vec<Candidate>,
    pub kinds: FileKinds,
    pub units: usize,
    pub roles_considered: usize,
    /// Cards mining found and withheld, in the order mined: those the show policy hides
    /// ([`crate::show`]) and, after [`withhold_python`], the Python ones while Python
    /// proposals are off. Never proposed: `init` does not write them, and no `check`,
    /// hook, MCP rule, export or SARIF surface reads them. Counted by `init`, `census`
    /// and `review`, and listed for people by `drift review --hidden`. Agents are told
    /// the strong ones as facts about the code, never as conventions, on the card of a
    /// file in their role ([`crate::card::regularities`]).
    pub withheld: Vec<WithheldCard>,
    /// [`Mined::roles_considered`] per package (a role's `package`, "" for the root
    /// and for repo-wide roles of models and workspace packages): what the census
    /// reports for each package of a workspace ([`crate::workspace`]).
    pub roles_by_package: BTreeMap<String, usize>,
    /// Proposals the show policy ([`crate::show`]) did not let through, per package of
    /// their role (each part's): what the census says of a package whose rules clear
    /// the bounds but are not shown.
    pub hidden_by_package: BTreeMap<String, usize>,
}

/// A card mining withheld ([`Mined::withheld`]), with why.
#[derive(Debug, Clone)]
pub struct WithheldCard {
    pub candidate: Candidate,
    pub reason: crate::show::Withheld,
}

struct Draft {
    role: RoleSelector,
    rule: Rule,
    holders: BTreeSet<usize>,
    n: usize,
    lb: f64,
    lift: f64,
    split: Vec<(String, usize)>,
    score: f64,
    members: Vec<usize>,
    /// Filled by [`narrow`]: role members the rule is not about, with the reason;
    /// members that hold it only through a base's declaration; the role's size.
    exempt: Vec<(usize, Exempted)>,
    inherited: Vec<usize>,
    /// Members holding a call-wrapper rule through a derived wrapper: (member, its
    /// wrapper, the target).
    derived: Vec<(usize, String, String)>,
    role_n: Option<usize>,
    /// The rule's rate among all units of the role's symbol kind, which lift is counted
    /// against ([`draft_of`]); `None` where the lift is a contrast of another kind
    /// ([`draft_over`]). [`merge_siblings`] recounts a merged card's lift with it.
    base: Option<f64>,
    /// Kept by hysteresis ([`Keep`]): a convention already accepted in the policy, or a
    /// part of an accepted merged card. Set before [`dedupe`].
    accepted: bool,
    /// The draft's id as the caps see it (its role and rule before [`subtree`] or a
    /// merge reshape them), so the show policy's verdict on the card it becomes can be
    /// carried back to the caps ([`cap_shown`]). Set just before the caps.
    origin: String,
}

/// Mine candidate conventions from repo facts: what the product proposes, after the show
/// policy ([`crate::show`]: a suggestion it hides is not proposed).
pub fn mine(repo: &RepoFacts, opts: &MineOptions) -> Mined {
    mine_with_kinds(repo, opts, FileKinds::learn(repo))
}

/// [`mine`] over a given file-kind vocabulary: the one frozen in an existing
/// conventions file, so that evidence is counted over the files `check` will
/// enforce the conventions on.
pub fn mine_with_kinds(repo: &RepoFacts, opts: &MineOptions, kinds: FileKinds) -> Mined {
    mine_families(repo, opts, kinds, true, &Keep::default(), true)
}

/// [`mine`] before the show policy ([`crate::show`]): every proposal the miner's own
/// filters let through, also those the product never shows (several outliers, a family
/// not admitted). For tests of the miner; the product never calls it.
pub fn mine_unshown(repo: &RepoFacts, opts: &MineOptions) -> Mined {
    mine_before_show(repo, opts, FileKinds::learn(repo), &[])
}

/// [`mine_keeping`] before the show policy ([`mine_unshown`]): for tests of the miner's
/// hysteresis; the product never calls it.
pub fn mine_before_show(
    repo: &RepoFacts,
    opts: &MineOptions,
    kinds: FileKinds,
    accepted: &[(RoleSelector, Rule)],
) -> Mined {
    mine_families(repo, opts, kinds, true, &Keep::new(accepted), false)
}

/// [`mine_with_kinds`] with hysteresis: `accepted` is the `(role, rule)` of every
/// convention a person accepted in the policy (`drift init` on an existing
/// `.drift/conventions.yaml`). Where a small change (one new file, one new holder) would
/// have mining drop such a convention for another of its role, a parent or child role or
/// a reshaped role, the accepted one is kept instead ([`Keep`]). Mining is otherwise
/// unchanged: with no accepted convention this is [`mine_with_kinds`], so a first
/// `init` is unaffected. Hysteresis never keeps a rule that mining did not draft on
/// its own evidence (one whose lower bound or lift fell below the bar, or whose role
/// fell below its size), never changes a convention's evidence or tier, and never hides
/// a default-tier proposal.
pub fn mine_keeping(
    repo: &RepoFacts,
    opts: &MineOptions,
    kinds: FileKinds,
    accepted: &[(RoleSelector, Rule)],
) -> Mined {
    mine_families(repo, opts, kinds, true, &Keep::new(accepted), true)
}

/// Python proposals off (decision D13-py, [`crate::policy::python_proposals`]): remove
/// every Python candidate ([`Candidate::language`]: the language the tier reads, so a role
/// with any Python member counts as Python) from `mined`, except one a person accepted
/// (`accepted`, as [`mine_keeping`] takes it), which stays as hysteresis keeps it. Runs
/// after mining, so every other candidate, its id, evidence and order are exactly what
/// they were. Returns how many were withheld.
pub fn withhold_python(mined: &mut Mined, accepted: &[(RoleSelector, Rule)]) -> usize {
    let keep = Keep::new(accepted);
    let before = mined.candidates.len();
    let all = std::mem::take(&mut mined.candidates);
    for c in all {
        if c.language() != drift_core::ingest::Lang::Python || keep.accepted_card(&c) {
            mined.candidates.push(c);
        } else {
            crate::funnel::card(&c, "python_off");
            mined.withheld.push(WithheldCard {
                candidate: c,
                reason: crate::show::Withheld::PythonOff,
            });
        }
    }
    before - mined.candidates.len()
}

/// What hysteresis keeps ([`mine_keeping`]): the ids of accepted conventions, and of
/// the parts of accepted merged cards ([`RoleSelector::also`]), whose drafts are kept
/// where mining would drop them for another draft (in [`dedupe`], the caps, sibling
/// joins and [`subtree`]), and the accepted merged cards themselves, which
/// [`merge_siblings`] forms again from their parts.
#[derive(Debug, Clone, Default)]
struct Keep {
    /// Accepted conventions that are no merged card.
    ids: BTreeSet<String>,
    /// Parts of accepted merged cards.
    parts: BTreeSet<String>,
    /// Accepted merged cards: their role (with `also`) and rule.
    merged: Vec<(RoleSelector, Rule)>,
}

impl Keep {
    fn new(accepted: &[(RoleSelector, Rule)]) -> Self {
        let mut k = Keep::default();
        for (role, rule) in accepted {
            if role.also.is_empty() {
                k.ids.insert(convention_id(role, rule));
            } else {
                for part in role.parts() {
                    k.parts.insert(convention_id(&part, rule));
                }
                k.merged.push((role.clone(), rule.clone()));
            }
        }
        k.merged.sort();
        k.merged.dedup();
        k
    }

    /// The draft is kept by hysteresis: accepted itself, or a part of an accepted card.
    fn holds(&self, d: &Draft) -> bool {
        if self.ids.is_empty() && self.parts.is_empty() {
            return false;
        }
        let id = convention_id(&d.role, &d.rule);
        self.ids.contains(&id)
            || self.parts.contains(&id)
            // A pooled role's draft ([`pooled_roles`]) is the accepted merged card itself.
            || (!d.role.also.is_empty()
                && self
                    .merged
                    .iter()
                    .any(|(role, rule)| role == &d.role && rule == &d.rule))
    }

    /// The candidate is an accepted convention: one of its own or an accepted merged card.
    fn accepted_card(&self, c: &Candidate) -> bool {
        self.ids.contains(&c.id)
            || self
                .merged
                .iter()
                .any(|(role, rule)| role == &c.role && rule == &c.rule)
    }

    /// The draft is an accepted convention of its own (not only a part of a card).
    fn accepted_alone(&self, d: &Draft) -> bool {
        !self.ids.is_empty() && self.ids.contains(&convention_id(&d.role, &d.rule))
    }
}

/// [`mine`] with every rule family, including those never proposed
/// ([`hidden_call_rule`]): for tests of what a hidden family's rules are about (their
/// exemptions still decide `check` on conventions accepted before, and on Python and
/// guard callees).
pub fn mine_every_family(repo: &RepoFacts, opts: &MineOptions) -> Mined {
    mine_families(
        repo,
        opts,
        FileKinds::learn(repo),
        false,
        &Keep::default(),
        false,
    )
}

fn mine_families(
    repo: &RepoFacts,
    opts: &MineOptions,
    kinds: FileKinds,
    hide: bool,
    keep: &Keep,
    show: bool,
) -> Mined {
    let units = units(repo, &kinds);
    // Where member kinds split roles (W1), what the unsplit roles propose: the rules a
    // split role may carry when they hold for all its members ([`carried_universal`]).
    let unsplit = crate::roles::units_before(
        &units,
        crate::roles::Legacy {
            export_names: false,
            member_kinds: true,
        },
    )
    .map(|before| {
        mine_units(
            repo,
            opts,
            kinds.clone(),
            hide,
            before,
            None,
            true,
            &Keep::default(),
        )
        .candidates
        .into_iter()
        .map(|c| (c.role, c.rule))
        .collect::<BTreeSet<_>>()
    });
    // Test roles ([`crate::shapes`]), when the vocabulary has them: mined in a pass of
    // their own, over test units only (their own lift baseline and repo context), so
    // every production card is exactly what it is without them.
    let tested = kinds.tests.then(|| {
        let tests = crate::roles::test_units(repo, &kinds);
        crate::funnel::scoped("test:", || {
            mine_units(repo, opts, kinds.clone(), hide, tests, None, false, keep)
        })
    });
    // The caps count shown cards only (round 11, recall11 P1): a card the show policy
    // hides takes no slot of the 15 per repo, nor of the layering share. So mining runs
    // once with no cap, to learn which drafts become cards the policy hides, then with
    // the caps, which skip those drafts ([`cap_shown`]). Without the show policy (the
    // study's unshown mining, tests) there is one pass, capped as before.
    let hidden = (show && crate::show::enforced()).then(|| {
        let wide = MineOptions {
            max_per_repo: UNCAPPED,
        };
        // Not counted by the yield funnel: the capped pass below counts every stage.
        let (pre, origins) = crate::funnel::paused(|| {
            mine_units_traced(
                repo,
                &wide,
                kinds.clone(),
                hide,
                units.clone(),
                unsplit.as_ref(),
                false,
                keep,
                None,
            )
        });
        pre.candidates
            .iter()
            .filter(|c| !(keep.accepted_card(c) || crate::show::candidate_shown(c)))
            .filter_map(|c| origins.get(&c.id))
            .flatten()
            .cloned()
            .collect::<BTreeSet<String>>()
    });
    let (mut mined, _) = mine_units_traced(
        repo,
        opts,
        kinds,
        hide,
        units,
        unsplit.as_ref(),
        false,
        keep,
        hidden.as_ref(),
    );
    if let Some(t) = tested {
        mined.candidates.extend(t.candidates);
        mined.units += t.units;
        mined.roles_considered += t.roles_considered;
    }
    // What the product shows at all (`crate::show`): a suggestion the show policy hides
    // is not proposed. A convention a person accepted is kept (hysteresis), whatever
    // its family; the default tier is never affected.
    // The cards it hides are kept aside with their reason ([`Mined::withheld`]), so
    // people can be told what was withheld and why; the proposals are exactly those kept.
    if show && crate::show::enforced() {
        let mut hidden: BTreeMap<String, usize> = BTreeMap::new();
        let all = std::mem::take(&mut mined.candidates);
        for c in all {
            match crate::show::candidate_withheld(&c) {
                Some(reason) if !keep.accepted_card(&c) => {
                    crate::funnel::card(&c, "show_policy");
                    let mut packages: Vec<String> =
                        c.role.parts().into_iter().map(|p| p.package).collect();
                    packages.sort();
                    packages.dedup();
                    for p in packages {
                        *hidden.entry(p).or_default() += 1;
                    }
                    mined.withheld.push(WithheldCard {
                        candidate: c,
                        reason,
                    })
                }
                _ => mined.candidates.push(c),
            }
        }
        mined.hidden_by_package = hidden;
    }
    for c in &mined.candidates {
        crate::funnel::card(c, "proposed");
    }
    mined
}

/// The lift baseline: how many units of each symbol kind hold each rule, and how many
/// units of each kind there are.
type LiftBase<'b, 'r> = (
    &'b BTreeMap<(SymbolKind, &'r Rule), usize>,
    &'b BTreeMap<SymbolKind, usize>,
);

/// Roles at one place (the same folder, file kind, entry kind, symbol kind and kinds)
/// of sibling workspace packages, pooled into one role: packages in one parent folder
/// (`backend/services/billing`, `backend/services/catalog`, ...), as N FastAPI services
/// with the same router layout are. Each package's role may be too small for the
/// bounds on its own; together their members are one population, so one convention
/// with members from all of them. The pooled role is a merged card's role
/// ([`RoleSelector::also`]): its parts are the packages' own roles, so `check` judges
/// every member in its own package's role and ids depend only on which roles it
/// covers. Only plain roles of a non-root package; never a package-wide role, a
/// package's root folder, models or workspace packages. In code-point order of the
/// pooled selector; none in a single-package repository.
fn pooled_roles(roles: &BTreeMap<&RoleSelector, Vec<usize>>) -> Vec<(RoleSelector, Vec<usize>)> {
    let parent = |p: &str| p.rsplit_once('/').map_or("", |(d, _)| d).to_string();
    // (parent folder of the package, the place) -> the packages' roles there.
    type Places<'r> = BTreeMap<(String, RoleSelector), Vec<(&'r RoleSelector, &'r Vec<usize>)>>;
    let mut groups: Places = BTreeMap::new();
    for (r, members) in roles {
        if r.package.is_empty()
            || !r.also.is_empty()
            || matches!(r.kind, SymbolKind::Model | SymbolKind::Package)
            || r.dir == crate::roles::PACKAGE_WIDE
            || r.dir == "."
        {
            continue;
        }
        let place = RoleSelector {
            package: String::new(),
            ..(*r).clone()
        };
        groups
            .entry((parent(&r.package), place))
            .or_default()
            .push((r, members));
    }
    let mut out = Vec::new();
    for (_, parts) in groups {
        if parts.len() < 2 {
            continue;
        }
        let mut sels: Vec<RoleSelector> = parts.iter().map(|(r, _)| (*r).clone()).collect();
        sels.sort();
        let mut role = sels[0].clone();
        role.also = sels[1..].to_vec();
        let mut members: Vec<usize> = parts.iter().flat_map(|(_, m)| m.iter().copied()).collect();
        members.sort_unstable();
        members.dedup();
        out.push((role, members));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Drafts of the rules a pooled role's members follow ([`pooled_roles`]), with the lift
/// counted as for any role (`global`, `kind_totals`: the repository's). Only plain rules of
/// the role's members ([`consider`]): no naming, variant sets, ordering, library,
/// dependency or layering rules, no `extends` rules (their direct-base test reads
/// one package's classes), and none in the default tier [STRICT].
fn pooled_drafts(
    pooled: &[(RoleSelector, Vec<usize>)],
    units: &[Unit],
    feats: &[BTreeSet<Rule>],
    (global, kind_totals): LiftBase,
) -> Vec<Draft> {
    let mut out = Vec::new();
    for (role, members) in pooled {
        if members.len() < MIN_ROLE_SIZE || !spans_files(members, units) {
            continue;
        }
        let mut counts: BTreeMap<&Rule, BTreeSet<usize>> = BTreeMap::new();
        for &m in members {
            for r in &feats[m] {
                counts.entry(r).or_default().insert(m);
            }
        }
        let total = kind_totals.get(&role.kind).copied().unwrap_or(0);
        let python = python_units(members, units);
        for (rule, holders) in counts {
            if matches!(
                rule,
                Rule::Named { .. }
                    | Rule::WrappedBy {
                        kind: WrapKind::Extends,
                        ..
                    }
            ) || optional_key(rule, &holders, units)
                // [STRICT] Pooling never makes a card that may block: as merged sibling
                // cards ([`merge_siblings`]), a pooled one is a suggestion or nothing.
                || (!python
                    && crate::tier::tier_of(rule, members.len(), drift_core::ingest::Lang::TypeScript)
                        == crate::tier::Tier::Default)
            {
                continue;
            }
            let count = global.get(&(role.kind, rule)).copied().unwrap_or(0);
            out.extend(consider(
                role,
                rule.clone(),
                holders,
                members,
                count,
                total,
                units,
                vec![],
            ));
        }
    }
    out
}

/// A draft only a workspace makes: a pooled role's ([`pooled_roles`]), or an avoidance
/// of an area inside the role's own package ([`edge_areas`]). None in a single-package
/// repository. Kept by hysteresis like any other (`accepted` is checked by the caps).
fn workspace_draft(d: &Draft) -> bool {
    if !d.role.also.is_empty() {
        return true;
    }
    let pkg = d.role.package.as_str();
    matches!(&d.rule, Rule::Avoids { signal } if !pkg.is_empty()
        && signal
            .strip_prefix("import:")
            .is_some_and(|t| t == pkg || t.starts_with(&format!("{pkg}/"))))
}

/// The share of pooled draft `d` in its part `part` (the members in that part's package),
/// as a draft of the part's own role.
fn part_draft(d: &Draft, part: &RoleSelector, units: &[Unit]) -> Draft {
    let in_part = |m: &usize| match units[*m].view {
        View::Symbol(f, _) | View::File(f) => f.package == part.package,
        _ => false,
    };
    let members: Vec<usize> = d.members.iter().copied().filter(in_part).collect();
    Draft {
        role: part.clone(),
        rule: d.rule.clone(),
        holders: d.holders.iter().copied().filter(in_part).collect(),
        n: members.len(),
        lb: d.lb,
        lift: d.lift,
        split: d.split.clone(),
        score: d.score,
        exempt: d
            .exempt
            .iter()
            .filter(|(m, _)| in_part(m))
            .cloned()
            .collect(),
        inherited: d.inherited.iter().copied().filter(in_part).collect(),
        derived: d
            .derived
            .iter()
            .filter(|(m, ..)| in_part(m))
            .cloned()
            .collect(),
        members,
        role_n: None,
        base: d.base,
        accepted: d.accepted,
        origin: String::new(),
    }
}

/// A pooled role's draft of a rule is the convention of its parts: the parts' own
/// drafts of that rule are dropped ([`pooled_roles`]).
fn supersede_parts(drafts: &mut Vec<Draft>) {
    let covered: BTreeSet<(RoleSelector, Rule)> = drafts
        .iter()
        .filter(|d| !d.role.also.is_empty())
        .flat_map(|d| d.role.parts().into_iter().map(|p| (p, d.rule.clone())))
        .collect();
    if covered.is_empty() {
        return;
    }
    drafts.retain(|d| {
        !d.role.also.is_empty() || !covered.contains(&(d.role.clone(), d.rule.clone()))
    });
}

/// [`mine_families`] over `units`; `proposed_unsplit` is what the unsplit roles
/// propose, where member kinds split roles. `unsplit` mines the unsplit roles
/// themselves, as before member kinds: naming rules on plain Python classes too.
#[allow(clippy::too_many_arguments)]
fn mine_units<'a>(
    repo: &'a RepoFacts,
    opts: &MineOptions,
    kinds: FileKinds,
    hide: bool,
    units: Vec<Unit<'a>>,
    proposed_unsplit: Option<&Proposed>,
    unsplit_pass: bool,
    keep: &Keep,
) -> Mined {
    mine_units_traced(
        repo,
        opts,
        kinds,
        hide,
        units,
        proposed_unsplit,
        unsplit_pass,
        keep,
        None,
    )
    .0
}

/// [`mine_units`], with the caps skipping the drafts whose origin is in `hidden`
/// ([`cap_shown`]), and returning, per candidate id, the origins of the drafts it was
/// made from (one, or a merged card's parts).
#[allow(clippy::too_many_arguments)]
fn mine_units_traced<'a>(
    repo: &'a RepoFacts,
    opts: &MineOptions,
    kinds: FileKinds,
    hide: bool,
    units: Vec<Unit<'a>>,
    proposed_unsplit: Option<&Proposed>,
    unsplit_pass: bool,
    keep: &Keep,
    hidden: Option<&BTreeSet<String>>,
) -> (Mined, BTreeMap<String, Vec<String>>) {
    let ctx = RepoContext::new(repo, &units);
    let feats: Vec<BTreeSet<Rule>> = units.iter().map(|u| features(&u.view, &ctx)).collect();
    let total_units = units.len();

    // Lift baseline: frequency among units of the *same symbol kind*. Comparing
    // components with all code would make every hook look special; comparing
    // components with components keeps only what is specific to a role.
    // Across the repository, as before workspaces: counted per package, the lift of a
    // rule that most of one package follows is about 1, and on the build clones that
    // lost cards labelled ACCEPT (eval/study/research/2026-11-09/monorepo11.md).
    let mut global: BTreeMap<(SymbolKind, &Rule), usize> = BTreeMap::new();
    let mut kind_totals: BTreeMap<SymbolKind, usize> = BTreeMap::new();
    for (i, f) in feats.iter().enumerate() {
        let k = units[i].kind();
        *kind_totals.entry(k).or_default() += 1;
        for r in f {
            *global.entry((k, r)).or_default() += 1;
        }
    }

    // Members of each role.
    let mut roles: BTreeMap<&RoleSelector, Vec<usize>> = BTreeMap::new();
    for (i, u) in units.iter().enumerate() {
        for r in &u.roles {
            roles.entry(r).or_default().push(i);
        }
    }
    // A role is a pattern across files: members of one or two files share facts
    // because they sit together (saleor's 20 email tasks in two `tasks.py` files).
    // The yield funnel (study only, [`crate::funnel`]): off, nothing is counted.
    let count = !unsplit_pass && crate::funnel::on();
    if count {
        for (r, members) in &roles {
            let lang = units_lang(members, &units);
            let keying = crate::funnel::keying(r);
            crate::funnel::add("-", keying, lang, "roles", 1);
            let stage = if members.len() < MIN_ROLE_SIZE {
                "role_small"
            } else if !spans_files(members, &units) {
                "role_one_file"
            } else {
                "role_mined"
            };
            crate::funnel::add("-", keying, lang, stage, 1);
        }
    }
    roles.retain(|_, members| spans_files(members, &units));
    // The unsplit roles of the places where member kinds split a role (W1): every
    // member at the place, of any kind ([`carried_universal`]).
    let mut unsplit: BTreeMap<RoleSelector, Vec<usize>> = BTreeMap::new();
    if proposed_unsplit.is_some() {
        for (i, u) in units.iter().enumerate() {
            for r in &u.roles {
                unsplit.entry(unsplit_key(r)).or_default().push(i);
            }
        }
    }
    // One place in sibling workspace packages, pooled ([`pooled_roles`]).
    let pooled = pooled_roles(&roles);
    let roles_considered = roles.values().filter(|m| m.len() >= MIN_ROLE_SIZE).count()
        + pooled
            .iter()
            .filter(|(_, m)| m.len() >= MIN_ROLE_SIZE)
            .count();
    let mut roles_by_package: BTreeMap<String, usize> = BTreeMap::new();
    for (r, _) in roles.iter().filter(|(_, m)| m.len() >= MIN_ROLE_SIZE) {
        *roles_by_package.entry(r.package.clone()).or_default() += 1;
    }

    let mut drafts: Vec<Draft> = Vec::new();
    for (role, members) in &roles {
        let n = members.len();
        if n < MIN_ROLE_SIZE {
            continue;
        }
        let mut counts: BTreeMap<&Rule, BTreeSet<usize>> = BTreeMap::new();
        for &m in members {
            for r in &feats[m] {
                counts.entry(r).or_default().insert(m);
            }
        }
        for (rule, holders) in &counts {
            // Naming has its own population (see `naming_drafts`).
            if matches!(rule, Rule::Named { .. }) {
                continue;
            }
            let lang = if count {
                units_lang(members, &units)
            } else {
                "-"
            };
            if count {
                crate::funnel::rule(role, rule, lang, "observed");
            }
            // A class extends what its in-repo base extends, so holders are counted
            // through base chains (`X(TransactionRepository)` extends `RepositoryBase`).
            // But a base is a candidate only when most of its holders extend it
            // directly: resolving chains finds the members that follow the team's
            // rule, it does not make every ancestor (a mixin or library root that the
            // team's own base brings along) a convention of its own.
            if let Rule::WrappedBy {
                kind: WrapKind::Extends,
                any_of,
            } = rule
            {
                let direct = holders
                    .iter()
                    .filter(|&&m| {
                        wraps(&units[m]).iter().any(|w| {
                            w.kind == WrapKind::Extends
                                && any_of.iter().any(|a| same_ref(&w.wrapper, a))
                        })
                    })
                    .count();
                if direct * 2 <= holders.len() {
                    if count {
                        crate::funnel::rule(role, rule, lang, "indirect_base");
                    }
                    continue;
                }
                if python_units(members, &units)
                    && refines_team_base(any_of, holders, members, &units, &ctx)
                {
                    if count {
                        crate::funnel::rule(role, rule, lang, "refines_base");
                    }
                    continue;
                }
            }
            if optional_key(rule, holders, &units) {
                if count {
                    crate::funnel::rule(role, rule, lang, "optional_key");
                }
                continue;
            }
            if let Some(d) = consider(
                role,
                (*rule).clone(),
                holders.clone(),
                members,
                global[&(role.kind, *rule)],
                kind_totals[&role.kind],
                &units,
                vec![],
            )
            .or_else(|| {
                carried_universal(
                    role,
                    rule,
                    holders,
                    members,
                    unsplit.get(&unsplit_key(role))?,
                    proposed_unsplit?,
                    global[&(role.kind, *rule)],
                    kind_totals[&role.kind],
                    &units,
                )
            }) {
                drafts.push(d);
            } else if count {
                let stage = rejected_at(
                    rule,
                    holders.len(),
                    n,
                    global[&(role.kind, *rule)],
                    kind_totals[&role.kind],
                );
                crate::funnel::rule(role, rule, lang, stage);
            }
        }
        drafts.extend(variant_set(
            role,
            members,
            &units,
            &feats,
            kind_totals[&role.kind],
            &ctx,
        ));
        drafts.extend(naming_drafts(
            role,
            members,
            unsplit
                .get(&unsplit_key(role))
                .map(Vec::as_slice)
                .zip(proposed_unsplit),
            &units,
            &feats,
            &global,
            kind_totals[&role.kind],
            unsplit_pass,
        ));
        drafts.extend(before_drafts(role, members, &units, &ctx));
        if python_units(members, &units) {
            drafts.extend(imports_from_drafts(role, members, &units, &ctx));
        }
        drafts.extend(library_drafts(role, members, &units, &ctx));
        drafts.extend(dependency_drafts(role, members, &units, &ctx));
    }
    let pooled_from = drafts.len();
    drafts.extend(pooled_drafts(
        &pooled,
        &units,
        &feats,
        (&global, &kind_totals),
    ));
    // [STRICT] A pooled draft is proposed only when each part's share of it would pass
    // the precision filters ([`unproposable`]) in that part's own role: pooling never
    // brings back a rule a package's own outliers say is no convention there.
    let mut i = 0;
    drafts.retain(|d| {
        i += 1;
        i <= pooled_from
            || d.role.parts().iter().all(|p| {
                let part = part_draft(d, p, &units);
                part.holders.len() == part.members.len()
                    || unproposable(&part, &units, &ctx).is_none()
            })
    });
    drafts.extend(avoid_drafts(&roles, &units, &ctx));
    // What a framework, the linter or the folder name already says is not a convention.
    if count {
        for d in &drafts {
            crate::funnel::rule(&d.role, &d.rule, units_lang(&d.members, &units), "drafted");
        }
    }
    drafts.retain(|d| {
        let why = unproposable(d, &units, &ctx).or_else(|| {
            (hide && hidden_call_rule(d, &units, &ctx)).then_some("call_family_hidden")
        });
        if count && let Some(stage) = why {
            crate::funnel::rule(&d.role, &d.rule, units_lang(&d.members, &units), stage);
        }
        why.is_none()
    });
    supersede_parts(&mut drafts);
    for d in &mut drafts {
        display_field(d, &units, keep);
        d.accepted = keep.holds(d);
    }

    let before = count.then(|| tally(&drafts, &units));
    let mut drafts = dedupe(drafts, &units);
    if let Some(b) = before {
        dropped(&b, &drafts, &units, "duplicate");
    }
    for d in &mut drafts {
        d.origin = convention_id(&d.role, &d.rule);
    }

    // Cap per role, then per repo, by score (ties broken by id for determinism). An
    // accepted convention past a cap is kept too (hysteresis), and takes no other
    // draft's place: the caps keep what they kept without it.
    let mut by_role: BTreeMap<RoleSelector, Vec<Draft>> = BTreeMap::new();
    for d in drafts {
        by_role.entry(d.role.clone()).or_default().push(d);
    }
    let mut kept: Vec<Draft> = Vec::new();
    // What only a workspace adds (layering inside one package, pooled sibling roles)
    // comes after everything else at each cap ([`workspace_draft`]), so it fills only
    // the places left over and never displaces a convention mined as before.
    for (_, mut ds) in by_role {
        ds.sort_by(|a, b| {
            workspace_draft(a)
                .cmp(&workspace_draft(b))
                .then(b.score.total_cmp(&a.score))
                .then_with(|| a.rule.cmp(&b.rule))
        });
        let before = count.then(|| tally(&ds, &units));
        truncate_keeping(&mut ds, MAX_PER_ROLE);
        if let Some(b) = before {
            dropped(&b, &ds, &units, "cap_role");
        }
        kept.extend(ds);
    }
    kept.sort_by(|a, b| {
        workspace_draft(a)
            .cmp(&workspace_draft(b))
            .then(b.score.total_cmp(&a.score))
            .then_with(|| convention_id(&a.role, &a.rule).cmp(&convention_id(&b.role, &b.rule)))
    });
    let max_avoid = ((opts.max_per_repo as f64 * AVOID_MAX_SHARE).ceil() as usize).max(1);
    // Kind roles ([`crate::shapes`], off by default) are additive: their drafts are
    // capped on their own, so they never take a per-repo or layering-share slot from a
    // place role's draft, and with kind roles on every other draft meets exactly the caps
    // it meets without them. (Nothing else can displace one: the near-duplicate and
    // same-holder steps of [`dedupe`] compare drafts of one role, and no kind role is
    // nested in a place role.)
    let (kind_kept, place_kept): (Vec<Draft>, Vec<Draft>) = kept
        .into_iter()
        .partition(|d| d.role.shape.is_some() && !crate::shapes::is_test_role(&d.role));
    let mut capped: Vec<Draft> = Vec::new();
    for (place, mut kept) in [(true, place_kept), (false, kind_kept)] {
        if kept.is_empty() {
            continue;
        }
        if place {
            // Show before the caps ([`cap_shown`]) applies to place roles only; kind roles
            // (opt-in) keep cap-before-show below: the combination is unmeasured.
            let drops = cap_shown(&mut kept, opts.max_per_repo, hidden);
            if count {
                let (avoid, repo): (Vec<_>, Vec<_>) =
                    drops.into_iter().partition(|(_, c)| *c == CapDrop::Avoid);
                for (stage, ds) in [("cap_avoid", avoid), ("cap_repo", repo)] {
                    let ds: Vec<Draft> = ds.into_iter().map(|(d, _)| d).collect();
                    for ((family, keying, lang), n) in tally(&ds, &units) {
                        crate::funnel::add(&family, keying, lang, stage, n);
                    }
                }
            }
            capped.extend(kept);
            continue;
        }
        let mut avoids = 0;
        let before = count.then(|| tally(&kept, &units));
        kept.retain(|d| {
            if matches!(d.rule, Rule::Avoids { .. }) {
                avoids += 1;
                avoids <= max_avoid || d.accepted
            } else {
                true
            }
        });
        if let Some(b) = before {
            dropped(&b, &kept, &units, "cap_avoid");
        }
        let before = count.then(|| tally(&kept, &units));
        truncate_keeping(&mut kept, opts.max_per_repo);
        if let Some(b) = before {
            dropped(&b, &kept, &units, "cap_repo");
        }
        capped.extend(kept);
    }
    let mut kept = capped;
    kept.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| convention_id(&a.role, &a.rule).cmp(&convention_id(&b.role, &b.rule)))
    });

    // Whether a rule is a convention of its role is decided over the whole role, as
    // above; its evidence and outliers are then counted over the members it is about
    // ([`Rule::applies`]), as `check` enforces it. So members a rule is not about
    // never create a proposal: they only stop being reported as its outliers.
    // An outlier on a sibling of the rule's wrapper (defined beside it, used elsewhere,
    // no weaker on security) follows the rule another way: the sibling joins its set.
    // Like `narrow`, this refines the kept proposals and never brings in another one.
    // An accepted convention keeps its rule: a joined set would be another convention.
    kept.retain_mut(|d| {
        let stage = if !(d.accepted || join_siblings(d, &units, &ctx)) || !narrow(d, &units, &ctx) {
            Some("narrowed_out")
        } else if compiler_enforced(d, repo) {
            Some("compiler")
        } else {
            None
        };
        if count && let Some(stage) = stage {
            crate::funnel::rule(&d.role, &d.rule, units_lang(&d.members, &units), stage);
        }
        stage.is_none()
    });
    // A rule whose holders all sit in one subtree of the role, with its outliers in
    // folders of their own elsewhere, is a convention of that subtree (F10).
    let mut taken: BTreeSet<(RoleSelector, Rule)> = kept
        .iter()
        .map(|d| (d.role.clone(), d.rule.clone()))
        .collect();
    for d in &mut kept {
        // An accepted convention keeps its role: a narrowed one would be another. A
        // pooled role ([`pooled_roles`]) is not narrowed to one package's subtree.
        if d.accepted || !d.role.also.is_empty() {
            continue;
        }
        if let Some(role) = subtree(d, &units, &ctx, &taken) {
            taken.insert((role, d.rule.clone()));
        }
    }
    // A member a rule of its role leaves out for what the member is (another kind of
    // class, a documented exception, the module that defines the role's target...) is
    // not an outlier of the role's sibling rules either.
    share_role_exemptions(&mut kept, &units, &ctx);
    // The unsplit pass says which (role, rule) the unsplit roles propose
    // ([`carried_universal`]): card by card, never merged.
    let candidates: Vec<Candidate> = if unsplit_pass {
        kept.iter()
            .map(|d| finish(d, &kept, &units, &ctx))
            .collect()
    } else {
        merge_siblings(&kept, &units, &ctx, keep)
    };
    if count {
        let mut out: BTreeMap<(String, &'static str, &'static str), usize> = BTreeMap::new();
        for c in &candidates {
            let lang = crate::tier::language_code(c.language());
            let key = (
                crate::funnel::family(&c.rule),
                crate::funnel::keying(&c.role),
                lang,
            );
            *out.entry(key).or_default() += 1;
        }
        for (key, n) in tally(&kept, &units) {
            let left = out.get(&key).copied().unwrap_or(0);
            crate::funnel::add(&key.0, key.1, key.2, "merged", n.saturating_sub(left));
        }
        for ((family, keying, lang), n) in out {
            crate::funnel::add(&family, keying, lang, "mined", n);
        }
    }
    // Each candidate's drafts, by the (role, rule) they ended with: a card's own, or a
    // merged card's parts.
    let by_shape: BTreeMap<(&RoleSelector, &Rule), &str> = kept
        .iter()
        .map(|d| ((&d.role, &d.rule), d.origin.as_str()))
        .collect();
    let origins = candidates
        .iter()
        .map(|c| {
            let parts = if c.role.also.is_empty() {
                vec![c.role.clone()]
            } else {
                c.role.parts()
            };
            let o = parts
                .iter()
                .filter_map(|p| by_shape.get(&(p, &c.rule)).map(|o| o.to_string()))
                .collect();
            (c.id.clone(), o)
        })
        .collect();
    (
        Mined {
            candidates,
            kinds,
            units: total_units,
            roles_considered,
            withheld: Vec::new(),
            roles_by_package,
            hidden_by_package: BTreeMap::new(),
        },
        origins,
    )
}

/// No per-repo cap: the first of [`mine_families`]' two passes.
const UNCAPPED: usize = usize::MAX / 4;

/// The per-repo caps, by score order: at most [`AVOID_MAX_SHARE`] of `max` avoidance
/// rules, then at most `max` drafts; an accepted draft past a cap is kept and counted
/// (hysteresis, [`truncate_keeping`]).
///
/// With `hidden` (the origins of drafts that become cards the show policy hides), the
/// caps count only the other drafts, so a hidden card never takes a shown card's slot.
/// A hidden draft itself is kept exactly when the caps without `hidden` keep it: the
/// show policy drops its card afterwards, and what it shares with its role's other
/// drafts first ([`share_role_exemptions`], [`merge_siblings`]) is as before.
///
/// Returns the drafts it dropped, each with the cap that dropped it (for the funnel).
fn cap_shown(
    kept: &mut Vec<Draft>,
    max: usize,
    hidden: Option<&BTreeSet<String>>,
) -> Vec<(Draft, CapDrop)> {
    let max_avoid = ((max as f64 * AVOID_MAX_SHARE).ceil() as usize).max(1);
    let caps = |counted: &dyn Fn(&Draft) -> bool| {
        let (mut avoids, mut n) = (0usize, 0usize);
        kept.iter()
            .map(|d| {
                if !counted(d) {
                    return None;
                }
                if matches!(d.rule, Rule::Avoids { .. }) {
                    avoids += 1;
                    if avoids > max_avoid && !d.accepted {
                        return Some(Err(CapDrop::Avoid));
                    }
                }
                n += 1;
                Some(if n <= max || d.accepted {
                    Ok(())
                } else {
                    Err(CapDrop::Repo)
                })
            })
            .collect::<Vec<_>>()
    };
    let all = caps(&|_| true);
    let verdicts: Vec<Result<(), CapDrop>> = match hidden {
        None => all
            .iter()
            .map(|k| k.unwrap_or(Err(CapDrop::Repo)))
            .collect(),
        Some(h) => {
            let shown = caps(&|d| !h.contains(&d.origin)); // mutation:cap-shown
            all.iter()
                .zip(&shown)
                .map(|(a, s)| s.unwrap_or(a.unwrap_or(Err(CapDrop::Repo))))
                .collect()
        }
    };
    let mut out = Vec::with_capacity(kept.len());
    let mut drops = Vec::new();
    for (d, v) in std::mem::take(kept).into_iter().zip(verdicts) {
        match v {
            Ok(()) => out.push(d),
            Err(cap) => drops.push((d, cap)),
        }
    }
    *kept = out;
    drops
}

/// The cap of [`cap_shown`] that dropped a draft: the layering (avoidance) share, or
/// the per-repo cap. The funnel counts them as `cap_avoid` and `cap_repo`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CapDrop {
    Avoid,
    Repo,
}

/// `ts` or `py` for the funnel ([`crate::funnel`]): `py` when every member is Python.
fn units_lang(members: &[usize], units: &[Unit]) -> &'static str {
    if !members.is_empty() && python_units(members, units) {
        "py"
    } else {
        "ts"
    }
}

/// Drafts by (family, language), for the funnel's counts of what a gate dropped.
type Tally = BTreeMap<(String, &'static str, &'static str), usize>;

fn tally(drafts: &[Draft], units: &[Unit]) -> Tally {
    let mut out = BTreeMap::new();
    for d in drafts {
        let key = (
            crate::funnel::family(&d.rule),
            crate::funnel::keying(&d.role),
            units_lang(&d.members, units),
        );
        *out.entry(key).or_default() += 1;
    }
    out
}

/// Count at `stage` what a gate dropped: `before` less what is left in `after`.
fn dropped(before: &Tally, after: &[Draft], units: &[Unit], stage: &str) {
    let after = tally(after, units);
    for (key, n) in before {
        let left = after.get(key).copied().unwrap_or(0);
        crate::funnel::add(&key.0, key.1, key.2, stage, n.saturating_sub(left));
    }
}

/// The gate of [`consider`] (or [`carried_universal`]) that rejected a candidate rule,
/// for the funnel: universal in its role, below the Wilson bound, or below the lift bar.
fn rejected_at(
    rule: &Rule,
    holders: usize,
    n: usize,
    global_count: usize,
    total_units: usize,
) -> &'static str {
    if holders >= n {
        return "universal";
    }
    if wilson_lower_bound(holders, n) < MIN_LOWER_BOUND {
        return "wilson";
    }
    let p_global = global_count as f64 / total_units.max(1) as f64;
    let lift = if p_global > 0.0 {
        (holders as f64 / n as f64) / p_global
    } else {
        0.0
    };
    if lift < rule.min_lift() {
        "lift"
    } else {
        // `draft_of` drafts every other rule: a carried universal its unsplit role did
        // not propose is counted as universal above.
        "universal"
    }
}

/// A key the members pass on some calls of a callee and leave out on others is
/// optional per call (`FieldSet(name=...)` names every group but the first): passing it
/// says which calls the members make, not how they make them. So when most holders
/// also call the callee without the key ([`drift_core::Symbol::omits`]), "pass the key"
/// is no convention. A key passed on every call (`Column(verbose_name=...)`) is one.
fn optional_key(rule: &Rule, holders: &BTreeSet<usize>, units: &[Unit]) -> bool {
    let Rule::PassesKey { callee, index, key } = rule else {
        return false;
    };
    let omitting = holders
        .iter()
        .filter(|&&h| match units[h].view {
            View::Symbol(_, s) => s.omits.iter().any(|o| {
                o.rsplit_once('@').is_some_and(|(c, rest)| {
                    same_ref(c, callee) && rest == format!("{index}:{key}")
                })
            }),
            _ => false,
        })
        .count();
    omitting * 2 > holders.len()
}

/// The module of an in-repo ref and its directory: `src/a/init.ts#x` ->
/// (`src/a/init.ts`, `src/a`). `None` for packages, built-ins and unresolved refs.
fn module_and_dir(r: &str) -> Option<(&str, &str)> {
    if is_external(r) {
        return None;
    }
    let module = r.split_once('#').map(|(m, _)| m)?;
    Some((module, module.rsplit_once('/').map_or("", |(d, _)| d)))
}

/// The binding a wrapper ref starts from: `a.ts#authenticatedActionClient.inputSchema().action`
/// -> `authenticatedActionClient`.
fn root_binding(r: &str) -> &str {
    let name = r.rsplit_once('#').map_or(r, |(_, n)| n);
    name.split(['.', '(']).next().unwrap_or(name)
}

/// `candidate`'s binding is a strict suffix of `target`'s, word by word: the bare
/// builder the target is built from (`procedure` in `adminProcedure`, `actionClient`
/// in `authenticatedActionClient`).
fn base_of(candidate: &str, target: &str) -> bool {
    let c = words(root_binding(candidate));
    let t = words(root_binding(target));
    !c.is_empty() && c.len() < t.len() && t.ends_with(&c)
}

/// An outlier's wrapper that is an alternative to the rule's targets (F6): a
/// wrapper or decorator of the same kind (the same wrap kind, and a name ending in
/// the word the targets' names end in), defined in the same module or directory as
/// a target (an `@CoreResolver()` next to `@MetadataResolver()` in `decorators/`),
/// that code other than the rule's outliers uses too (`users`), so it is an
/// established alternative and not a one-off. Never one weaker on security
/// ([`grant::auth_strength`], [`refuse::guard_shaped`]):
///
/// - never the bare builder a target is built from (`procedure` next to
///   `adminProcedure`, `actionClient` next to `authenticatedActionClient`);
/// - when the targets' names state one strength, the sibling's must state the same.
///   A weaker one (`procedure` or `maybeAuthenticatedProcedure` next to
///   `authenticatedProcedure`) would weaken the rule, and a name cannot rank
///   authentication against authorisation (`withSession` skips the membership checks
///   `withWorkspace` makes, though only one says "session");
/// - names that state no strength match only off entry points and only when neither
///   says who may pass: "unknown" holds bare builders (`procedure`) and privilege or
///   scope guards (`adminProcedure`, `admin_required`, `orgProcedure`) alike;
/// - when the set already holds several strengths (`actionClient` and
///   `authenticatedActionClient`), a sibling no weaker than the weakest joins: the set
///   accepts that much already.
fn sibling_of(
    candidate: &str,
    kind: WrapKind,
    any_of: &[String],
    users: usize,
    entry_role: bool,
) -> bool {
    let Some((module, dir)) = module_and_dir(candidate) else {
        return false;
    };
    if users == 0
        || !matches!(kind, WrapKind::Call | WrapKind::Decorator)
        || any_of
            .iter()
            .any(|t| same_ref(candidate, t) || base_of(candidate, t))
    {
        return false;
    }
    let beside = any_of
        .iter()
        .any(|t| module_and_dir(&norm_ref(t)).is_some_and(|(tm, td)| tm == module || td == dir));
    // The same kind of thing: the targets' names agree on what they are and the
    // sibling's says the same (`CoreResolver` among `MetadataResolver`s, a procedure
    // among procedures), not another permission beside them (`IsPortalContact` next to
    // `HasOrgContext`, `withSession` next to `withWorkspace`).
    let kinds: BTreeSet<Option<String>> = any_of.iter().map(|t| kind_word(t)).collect();
    let same_kind = kinds.len() == 1
        && kinds
            .first()
            .and_then(Option::as_ref)
            .is_some_and(|k| kind_word(candidate).as_ref() == Some(k));
    use grant::AuthStrength::Unknown;
    let strengths: BTreeSet<grant::AuthStrength> =
        any_of.iter().map(|t| grant::auth_strength(t)).collect();
    let strength = grant::auth_strength(candidate);
    let unknown_ok = !entry_role
        && !refuse::guard_shaped(candidate)
        && !any_of.iter().any(|t| refuse::guard_shaped(t));
    let safe = (strength != Unknown || unknown_ok)
        && match strengths.len() {
            0 => false,
            1 => strengths.contains(&strength),
            _ => strengths
                .first()
                .is_some_and(|weakest| strength >= *weakest),
        };
    beside && same_kind && safe
}

/// Add to a wrapper or decorator rule's set the siblings its outliers use instead
/// ([`sibling_of`]), with the members they wrap as holders. The split then shows how
/// many members use each alternative. Returns false when every member then holds the
/// rule: it is universal in the role, documentation rather than a check.
///
/// In a set with a guard among its targets ([`security::authenticates`]), a sibling
/// joins only if it is one too: its name alone never makes it satisfy an auth rule.
fn join_siblings(d: &mut Draft, units: &[Unit], ctx: &RepoContext) -> bool {
    let Rule::WrappedBy { kind, any_of } = &d.rule else {
        return true;
    };
    let kind = *kind;
    if !matches!(kind, WrapKind::Call | WrapKind::Decorator) {
        return true;
    }
    let outliers: BTreeSet<usize> = d
        .members
        .iter()
        .copied()
        .filter(|m| !d.holders.contains(m))
        .collect();
    // Candidates: the outliers' wrappers of the rule's kind, in-repo.
    let mut candidates: BTreeSet<String> = BTreeSet::new();
    for &o in &outliers {
        for w in wraps(&units[o]).iter().filter(|w| w.kind == kind) {
            let w = norm_ref(&w.wrapper);
            if module_and_dir(&w).is_some() {
                candidates.insert(w.into_owned());
            }
        }
    }
    if candidates.is_empty() {
        return true;
    }
    let guarded = kind == WrapKind::Call && any_of.iter().any(|t| security::authenticates(ctx, t));
    let wrapped_by_one = |i: usize, c: &str| {
        wraps(&units[i])
            .iter()
            .any(|w| w.kind == kind && same_ref(&w.wrapper, c))
    };
    let joined: Vec<String> = candidates
        .into_iter()
        .filter(|c| {
            // Units of the role's symbol kind it wraps, anywhere in the repo, that are
            // not outliers of this rule: two outliers on a one-off wrapper do not make
            // it established.
            let users = (0..units.len())
                .filter(|&i| {
                    !outliers.contains(&i) && units[i].kind() == d.role.kind && wrapped_by_one(i, c)
                })
                .count();
            sibling_of(c, kind, any_of, users, d.role.entry != "-")
                && (!guarded || security::authenticates(ctx, c))
        })
        .collect();
    if joined.is_empty() {
        return true;
    }
    let mut set = any_of.clone();
    if d.split.is_empty() {
        d.split = set
            .iter()
            .map(|t| {
                let n = d.holders.iter().filter(|&&h| wrapped_by_one(h, t)).count();
                (t.clone(), n)
            })
            .collect();
    }
    for c in joined {
        let users: Vec<usize> = outliers
            .iter()
            .copied()
            .filter(|&o| wrapped_by_one(o, &c))
            .collect();
        d.split.push((c.clone(), users.len()));
        d.holders.extend(users);
        set.push(c);
    }
    set.sort();
    d.split
        .sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    d.rule = Rule::WrappedBy { kind, any_of: set };
    d.lb = wilson_lower_bound(d.holders.len(), d.n);
    d.holders.len() < d.n
}

/// Count a kept draft's evidence as `check` enforces it: over the members its rule
/// applies to ([`Rule::applies`]), with a class that inherits a declared call from an
/// in-repo base ([`RepoContext::inherits_call`]) among the holders. Its score, and so
/// its rank, stay those of the whole role. The role's shared parts ([`crate::parts`])
/// are set aside like the members a rule is not about, with their reason. Returns false
/// when no member holds the rule any more, or when every member holds it once inherited
/// declarations count: then it is universal in the role, documentation rather than a
/// check.
fn narrow(d: &mut Draft, units: &[Unit], ctx: &RepoContext) -> bool {
    let role_n = d.members.len();
    let mut population = Vec::with_capacity(role_n);
    for &m in &d.members {
        let view = &units[m].view;
        match d.rule.exemption_in(Some(&d.role), view, ctx).or_else(|| {
            d.rule
                .part_exemption(&d.role, view, ctx)
                .map(|why| Exempted::new("shared_part", why))
        }) {
            Some(why) => d.exempt.push((m, why)),
            None => population.push(m),
        }
    }
    if matches!(d.rule, Rule::Calls { .. }) {
        for &m in &population {
            if !d.holders.contains(&m) && d.rule.holds_in(Some(&d.role), &units[m].view, ctx) {
                d.holders.insert(m);
                d.inherited.push(m);
            }
        }
    }
    // A member wrapped in a binding built on the rule's wrapper holds it, as `check`
    // says ([`Rule::holds`]); mining counted only its own wrapper.
    if let Rule::WrappedBy {
        kind: WrapKind::Call,
        any_of,
    } = &d.rule
    {
        for &m in &population {
            if d.holders.contains(&m) {
                continue;
            }
            if let View::Symbol(_, s) = units[m].view
                && let CallMatch::Holds(Some((wrapper, from))) = call_match(s, any_of, ctx)
            {
                d.holders.insert(m);
                d.derived.push((m, wrapper, from));
            }
        }
    }
    let applies: BTreeSet<usize> = population.iter().copied().collect();
    d.holders.retain(|h| applies.contains(h));
    d.derived.retain(|(m, ..)| applies.contains(m));
    d.n = population.len();
    d.lb = wilson_lower_bound(d.holders.len(), d.n);
    d.members = population;
    if d.n != role_n {
        d.role_n = Some(role_n);
    }
    // Only calls rules gain inherited holders. A rule whose last outlier was exempt (a
    // framework root file) or whose only outliers were shared parts is no less a rule of
    // the members it is about: it stays proposed, with nothing to count (that the parts
    // break it says nothing about the members, and a new member that breaks it is still
    // reported); only one held through inheritance by every member is documentation. A
    // call-wrapper rule every member holds once derived wrappers count is universal too.
    let universal = (!d.inherited.is_empty() || !d.derived.is_empty()) && d.holders.len() == d.n;
    !d.holders.is_empty() && !universal
}

/// Exemption codes that say what a member is within its role, whatever the rule: of
/// another kind than the role's members (`another_kind`, `enum`, `named_for_base`,
/// `sibling_base`), documented as not one of them (`documented_exception`), part of what
/// the role's convention is built on (`defining_module`: the module that defines a
/// rule's target), a framework root file (`root_file`), or a companion of the members
/// (`companion`: a helper, constant or class beside them, for naming rules only:
/// [`shares_code`]). A sibling rule of the same role takes such an exemption over for an
/// outlier ([`Rule::takes_role_exemptions`]).
///
/// Never a code about one rule only (a member that never calls the rule's callee, reads
/// no input, is a factory of the rule's wrapper, holds a registry key, is the rule's own
/// target, has no override), a statistical one (an opt-out counted over the role's
/// holders), or a shared part (decided per rule, [`Rule::parts_apply`]).
pub const ROLE_EXEMPTION_CODES: &[&str] = &[
    "another_kind",
    "enum",
    "named_for_base",
    "sibling_base",
    "documented_exception",
    "defining_module",
    "root_file",
    "companion",
];

/// Whether a sibling's exemption with `code` applies to `rule` too: a code of
/// [`ROLE_EXEMPTION_CODES`], and a companion only under another naming rule. A companion
/// is not a member of the followers' naming kind; a plain class beside a follower on the
/// team's base is exactly what a base-class rule flags.
pub fn shares_code(code: &str, rule: &Rule) -> bool {
    ROLE_EXEMPTION_CODES.contains(&code)
        && (code != "companion" || matches!(rule, Rule::Named { .. }))
}

/// The exemption a sibling rule's (`rule`) of the same role gives `e`, said as such.
pub fn role_exemption(e: &Exempted, rule: &Rule) -> Exempted {
    Exempted::new(
        &e.code,
        format!(
            "{} (as for the role's rule \"{}\")",
            e.reason,
            rule.describe()
        ),
    )
}

/// Give each kept draft's outliers the exemptions its sibling drafts (same role) give
/// them for what they are ([`ROLE_EXEMPTION_CODES`]), as `check` does. From each
/// sibling's own exemptions only (never one it took over), the sibling with the least
/// convention id first. Only outliers move; holders stay.
fn share_role_exemptions(kept: &mut [Draft], units: &[Unit], ctx: &RepoContext) {
    let own: Vec<(String, RoleSelector, Rule, BTreeMap<usize, Exempted>)> = kept
        .iter()
        .map(|d| {
            let ex = d
                .exempt
                .iter()
                .filter(|(_, e)| ROLE_EXEMPTION_CODES.contains(&e.code.as_str()))
                .map(|(m, e)| (*m, e.clone()))
                .collect();
            (
                convention_id(&d.role, &d.rule),
                d.role.clone(),
                d.rule.clone(),
                ex,
            )
        })
        .collect();
    for (i, d) in kept.iter_mut().enumerate() {
        let mut siblings: Vec<&(String, RoleSelector, Rule, BTreeMap<usize, Exempted>)> = own
            .iter()
            .enumerate()
            .filter(|&(j, o)| j != i && o.1 == d.role && !o.3.is_empty())
            .map(|(_, o)| o)
            .collect();
        if siblings.is_empty() {
            continue;
        }
        siblings.sort_by(|a, b| a.0.cmp(&b.0));
        let outliers: Vec<usize> = d
            .members
            .iter()
            .copied()
            .filter(|m| !d.holders.contains(m))
            .collect();
        let mut gone = BTreeSet::new();
        for o in outliers {
            if !d
                .rule
                .takes_role_exemptions(Some(&d.role), &units[o].view, ctx)
            {
                continue;
            }
            if let Some((rule, e)) = siblings.iter().find_map(|s| {
                s.3.get(&o)
                    .filter(|e| shares_code(&e.code, &d.rule))
                    .map(|e| (&s.2, e))
            }) {
                d.exempt.push((o, role_exemption(e, rule)));
                gone.insert(o);
            }
        }
        if gone.is_empty() {
            continue;
        }
        let role_n = d.role_n.unwrap_or(d.n);
        d.members.retain(|m| !gone.contains(m));
        d.n = d.members.len();
        d.lb = wilson_lower_bound(d.holders.len(), d.n);
        if d.n != role_n {
            d.role_n = Some(role_n);
        }
    }
}

/// A key rule with nothing to report: every member it is about passes the key, and the
/// callee's declared parameter type requires it at every call that passes it
/// ([`crate::keytypes::key_type`]). The compiler already rejects a call without the key,
/// and no member skips it, so the rule restates the type. A key rule with an outlier
/// (a handler that never calls the team's client, which the gate keeps) is still about
/// something the type does not catch, and so is a key the type leaves optional or
/// unknown.
fn compiler_enforced(d: &Draft, repo: &RepoFacts) -> bool {
    matches!(d.rule, Rule::PassesKey { .. })
        && d.holders.len() == d.n
        && crate::keytypes::key_type(repo, &d.rule) == Some("required")
}

/// Share of a rule's holders (percent) that must sit in one subtree of the role for the
/// rule to be narrowed to it ([`subtree`]).
const SUBTREE_SHARE_PERCENT: usize = 90;

/// What a rule names, for [`subtree`]'s guard test; `None` for rules it never narrows:
/// absences (`avoids`: raw SQL, secrets, layering) and control facts (input
/// validation) guard what is outside a subtree as much as what is in it, and package,
/// model and library rules have no folder to narrow to.
fn narrowable_targets(rule: &Rule) -> Option<Vec<&str>> {
    Some(match rule {
        Rule::WrappedBy { any_of, .. } => any_of.iter().map(String::as_str).collect(),
        Rule::PassesKey { callee, key, .. } => vec![callee, key],
        Rule::Calls { callee } => vec![callee],
        Rule::Renders { component } => vec![component],
        Rule::Throws { class } => vec![class],
        Rule::Named { pattern } => vec![pattern],
        Rule::Before { first, then } => vec![first, then],
        Rule::Directive { value } => vec![value],
        Rule::HasTest => vec![],
        Rule::Avoids { .. }
        | Rule::Control { .. }
        | Rule::PrefersLibrary { .. }
        | Rule::ModelHas { .. }
        | Rule::PackageHas { .. }
        | Rule::DependencyVersion { .. }
        // Wiring rules (#38) read other files than the member's; import sources (#35)
        // say where a name comes from, not where its users sit.
        | Rule::RegisteredIn { .. }
        | Rule::MirrorsKeys { .. }
        | Rule::ImportsFrom { .. } => return None,
    })
}

/// Share of a rule's holders (percent) that must carry a base or class decorator for
/// it to be characteristic of them ([`followers_marks`]).
const FOLLOWERS_MARK_PERCENT: usize = 90;

/// The class a unit is, if it is one.
fn class_unit<'a>(u: &Unit<'a>) -> Option<&'a Symbol> {
    match u.view {
        View::Symbol(_, s) if s.kind == SymbolKind::Class => Some(s),
        _ => None,
    }
}

/// A class's bases (its lineage, in-repo ancestors included) and class decorators,
/// tagged so that a base and a decorator of the same name stay apart.
fn class_marks(s: &Symbol, ctx: &RepoContext) -> BTreeSet<String> {
    ctx.lineage(s)
        .into_iter()
        .map(|l| format!("extends {l}"))
        .chain(
            class_decorators(s)
                .into_iter()
                .map(|d| format!("decorated {d}")),
        )
        .collect()
}

/// What is characteristic of a rule's class holders: the bases and class decorators
/// ([`class_marks`]) that at least [`FOLLOWERS_MARK_PERCENT`] of them carry, and that
/// they carry more often than the repo's classes do (lift above 1) and that fewer than
/// [`FOLLOWERS_MARK_PERCENT`] of the repo's classes carry, so a decorator on nearly
/// every class is not one. For a role of one file kind (`*.service`), the repo's
/// classes are those in files of that kind: a mark nearly every class of the kind
/// carries (Nest's `@Injectable()` on twenty's services) says what the role's selector
/// already says, not which of its classes follow the rule. Empty when the holders are
/// not classes.
fn followers_marks(d: &Draft, units: &[Unit], ctx: &RepoContext) -> BTreeSet<String> {
    let holders: Vec<BTreeSet<String>> = d
        .holders
        .iter()
        .filter_map(|&h| class_unit(&units[h]))
        .map(|s| class_marks(s, ctx))
        .collect();
    if holders.is_empty() {
        return BTreeSet::new();
    }
    let of_kind =
        |u: &&Unit| d.role.file == "*" || u.roles.first().is_some_and(|r| r.file == d.role.file);
    let all: Vec<BTreeSet<String>> = units
        .iter()
        .filter(of_kind)
        .filter_map(class_unit)
        .map(|s| class_marks(s, ctx))
        .collect();
    let mut counts: BTreeMap<&String, usize> = BTreeMap::new();
    for m in holders.iter().flatten() {
        *counts.entry(m).or_default() += 1;
    }
    counts
        .into_iter()
        .filter(|&(m, n)| {
            let in_repo = all.iter().filter(|a| a.contains(m)).count();
            n * 100 >= holders.len() * FOLLOWERS_MARK_PERCENT
                // n / holders > in_repo / all
                && n * all.len() > in_repo * holders.len()
                // Not on nearly every class of the kind.
                && in_repo * 100 < all.len() * FOLLOWERS_MARK_PERCENT
        })
        .map(|(m, _)| m.clone())
        .collect()
}

/// Narrow a kept draft's role to the subtree its holders sit in (F10): when at least
/// [`SUBTREE_SHARE_PERCENT`] of the holders are under one folder deeper than the
/// role's (the deepest such folder), and every outlier outside it sits in a folder
/// that holds no holder, neither itself nor below it, those outliers are another
/// context, not violations: the deferred handlers, registries and runner services
/// next to `action-handlers/`, whose handlers all extend the action-handler base. The
/// rule then applies to that folder only: its role's `dir` becomes the folder (deeper
/// than [`crate::roles::ROLE_DEPTHS`] if need be; [`RoleSelector::includes`]), which
/// `check` and the hooks match, and its evidence is counted there. Returns the new
/// role.
///
/// Never narrowed, so that an outlier elsewhere stays reported:
///
/// - a guard rule, as the exemption gate reads one: a target wraps, decorates or is a
///   base of an entry point somewhere in the facts ([`RepoContext::is_guard`]), names
///   access control ([`refuse::names_access_control`]: `requireAuth`,
///   `permission`), or is a callee called as a guard
///   ([`crate::security::callee_is_guard`]: `authorize()`, `loadProject()`);
/// - a role of entry points, or one whose outlier outside the folder is an entry point
///   (a handler registered by reference included: [`RepoContext::is_entry_unit`]) or
///   sits in a file that declares any: an unguarded route elsewhere is judged by the
///   rule that covers it;
/// - an outside outlier on the holders' line: a class that carries a base or class
///   decorator characteristic of them ([`followers_marks`]) is the same kind of class
///   (#45's followers' line);
/// - absences and control facts ([`narrowable_targets`]), variant sets (their split
///   is the whole role's), a folder that names what the rule requires
///   ([`is_tautology`]), and a folder with too few members to be a role.
///
/// The outliers in the folder, and a folder holding holders and outliers side by side,
/// keep the role as it is: a missing base next to the classes that have it is a
/// mistake, not a context.
fn subtree(
    d: &mut Draft,
    units: &[Unit],
    ctx: &RepoContext,
    taken: &BTreeSet<(RoleSelector, Rule)>,
) -> Option<RoleSelector> {
    if d.role.entry != "-"
        || matches!(d.role.kind, SymbolKind::Model | SymbolKind::Package)
        || d.role.dir == crate::roles::PACKAGE_WIDE
        || d.role.dir == "."
        || !d.split.is_empty()
    {
        return None;
    }
    let targets = narrowable_targets(&d.rule)?;
    // The gate's reading of guards (#45, #62): a target that guards an entry point in
    // the facts, names access control, or, for a callee, is called as a guard.
    let callee = matches!(
        d.rule,
        Rule::Calls { .. } | Rule::PassesKey { .. } | Rule::Before { .. }
    );
    if targets.iter().any(|t| {
        ctx.is_guard(t)
            || refuse::names_access_control(t)
            || (callee && crate::security::callee_is_guard(ctx, t))
    }) {
        return None;
    }
    let package = d.role.package.clone();
    let dirs = |m: usize| match units[m].view {
        View::Symbol(f, _) | View::File(f) => {
            Some(crate::roles::dirs_below_package(&f.path, &package))
        }
        View::Model(_) | View::Package(_) => None,
    };
    let holder_dirs: Vec<Vec<&str>> = d.holders.iter().map(|&h| dirs(h)).collect::<Option<_>>()?;
    let mut folder: Option<&[&str]> = None;
    for len in d.role.dir.split('/').count() + 1.. {
        let mut counts: BTreeMap<&[&str], usize> = BTreeMap::new();
        for h in holder_dirs.iter().filter(|h| h.len() >= len) {
            *counts.entry(&h[..len]).or_default() += 1;
        }
        // More than half the holders: at most one folder qualifies.
        match counts
            .into_iter()
            .find(|&(_, n)| n * 100 >= holder_dirs.len() * SUBTREE_SHARE_PERCENT)
        {
            Some((f, _)) => folder = Some(f),
            None => break,
        }
    }
    let folder = folder?.to_vec();
    let under = |m: usize| dirs(m).is_some_and(|ds| ds.starts_with(&folder));
    let outside: Vec<usize> = d
        .members
        .iter()
        .copied()
        .filter(|&m| !d.holders.contains(&m) && !under(m))
        .collect();
    if outside.is_empty() {
        return None;
    }
    // An outside class on the holders' line (#45's followers' line: a base of their
    // lineage or a class decorator they carry) is the same kind of class, so it stays
    // an outlier of the whole role (`@Command()` without the team's decorator). Only
    // what is characteristic of the holders counts ([`followers_marks`]), so a
    // decorator on nearly every class of the repo (Nest's `@Injectable()`) does not.
    let marks = followers_marks(d, units, ctx);
    if outside.iter().any(|&o| {
        class_unit(&units[o]).is_some_and(|s| class_marks(s, ctx).iter().any(|m| marks.contains(m)))
    }) {
        return None;
    }
    for &o in &outside {
        let od = dirs(o)?;
        // An outlier that is an entry point (a handler registered by reference
        // included: [`RepoContext::is_entry_unit`]) or sits in a file declaring one.
        let entry = match units[o].view {
            View::Symbol(f, s) => !f.entry_points.is_empty() || ctx.is_entry_unit(f, s),
            View::File(f) => !f.entry_points.is_empty(),
            View::Model(_) | View::Package(_) => true,
        };
        if entry || holder_dirs.iter().any(|h| h.starts_with(&od)) {
            return None;
        }
    }
    let members: Vec<usize> = d.members.iter().copied().filter(|&m| under(m)).collect();
    let role = RoleSelector {
        dir: folder.join("/"),
        ..d.role.clone()
    };
    if members.len() < MIN_ROLE_SIZE
        || !spans_files(&members, units)
        || is_tautology(&role, &d.rule)
        || taken.contains(&(role.clone(), d.rule.clone()))
    {
        return None;
    }
    let holders: BTreeSet<usize> = d.holders.iter().copied().filter(|&h| under(h)).collect();
    let inherited: Vec<usize> = d.inherited.iter().copied().filter(|&m| under(m)).collect();
    // As in `narrow`: a rule every member holds once inherited declarations count is
    // documentation, so the role keeps its outliers instead.
    if !inherited.is_empty() && holders.len() == members.len() {
        return None;
    }
    d.exempt.retain(|&(m, _)| under(m));
    d.n = members.len();
    d.role_n = (!d.exempt.is_empty()).then_some(d.n + d.exempt.len());
    d.lb = wilson_lower_bound(holders.len(), d.n);
    d.holders = holders;
    d.inherited = inherited;
    d.members = members;
    d.role = role.clone();
    Some(role)
}

/// What a unit is wrapped in: a plain alias of a function, what the function is.
fn wraps<'a>(u: &Unit<'a>) -> &'a [drift_core::Wrap] {
    match (u.view, u.alias) {
        (View::Symbol(..), Some((_, t))) => &t.wraps,
        (View::Symbol(_, s), None) => &s.wraps,
        _ => &[],
    }
}

/// Share of a role's members that must call both functions before an order is learned.
const BEFORE_MIN_SHARE: f64 = 0.6;
/// An avoided signal must be used at least this often outside the role.
const AVOID_MIN_OUTSIDE_RATE: f64 = 0.1;
const AVOID_MIN_OUTSIDE_COUNT: usize = 3;
/// ... and this many times more often than inside it.
const AVOID_MIN_CONTRAST: f64 = 3.0;

/// Build a draft for a rule evaluated over `population` (a subset of the role),
/// counting holders with [`Rule::holds`]. That is vacuously true for members the rule
/// does not apply to ([`Rule::applies`]), so a rule that can exempt members (`PassesKey`,
/// `WrappedBy` extends) would count them as holders here: such rules are drafted from
/// features (`consider`) and narrowed after ranking (`narrow`).
/// without a lift test. Used where lift has no meaning (orderings, preferences).
fn draft_over(
    role: &RoleSelector,
    rule: Rule,
    population: Vec<usize>,
    units: &[Unit],
    ctx: &RepoContext,
    contrast: f64,
    split: Vec<(String, usize)>,
) -> Option<Draft> {
    let n = population.len();
    if n < MIN_ROLE_SIZE {
        return None;
    }
    let holders: BTreeSet<usize> = population
        .iter()
        .copied()
        .filter(|&m| rule.holds_in(Some(role), &units[m].view, ctx))
        .collect();
    let k = holders.len();
    if k >= n {
        return None;
    }
    let lb = wilson_lower_bound(k, n);
    if lb < MIN_LOWER_BOUND {
        return None;
    }
    let score = lb * size_weight(n) * contrast.min(5.0) * rule.specificity();
    Some(Draft {
        role: role.clone(),
        rule,
        holders,
        n,
        lb,
        lift: contrast,
        split,
        score,
        members: population,
        exempt: vec![],
        inherited: vec![],
        derived: vec![],
        role_n: None,
        base: None,
        accepted: false,
        origin: String::new(),
    })
}

/// `Before { first, then }`: among members calling both often, `first` comes first.
/// Only for code that runs as one sequence of steps (functions, handlers, values): a
/// class's calls come from its attribute declarations and from several methods, so
/// which comes first is the order they are written in (`fieldsets` above a tag field),
/// not a step that must precede another.
fn before_drafts(
    role: &RoleSelector,
    members: &[usize],
    units: &[Unit],
    ctx: &RepoContext,
) -> Vec<Draft> {
    if role.kind == SymbolKind::Class {
        return vec![];
    }
    let orders: Vec<(usize, &[String])> = members
        .iter()
        .filter_map(|&m| match units[m].view {
            View::Symbol(_, s) => Some((m, s.order.as_slice())),
            _ => None,
        })
        .collect();
    if orders.len() < MIN_ROLE_SIZE {
        return vec![];
    }
    let mut freq: BTreeMap<&str, usize> = BTreeMap::new();
    for (_, o) in &orders {
        let distinct: BTreeSet<&str> = o.iter().map(String::as_str).collect();
        for c in distinct {
            *freq.entry(c).or_default() += 1;
        }
    }
    let min = (orders.len() as f64 * BEFORE_MIN_SHARE).ceil() as usize;
    let common: Vec<&str> = freq
        .into_iter()
        .filter(|(c, n)| *n >= min && !c.starts_with("global#") && !c.ends_with("(ref)"))
        .map(|(c, _)| c)
        .collect();
    let mut out = Vec::new();
    for &first in &common {
        for &then in &common {
            if first == then {
                continue;
            }
            let population: Vec<usize> = orders
                .iter()
                .filter(|(_, o)| o.iter().any(|c| c == then))
                .map(|(m, _)| *m)
                .collect();
            let rule = Rule::Before {
                first: first.to_string(),
                then: then.to_string(),
            };
            out.extend(draft_over(role, rule, population, units, ctx, 1.0, vec![]));
        }
    }
    out
}

/// `ImportsFrom`: the members that use a thing provided in two places (a standard
/// library name and its backport, a library class and the team's wrapper of the same
/// name) mostly take it from one. Counted over those members only, outside the files
/// that define the team's version; with no lift test, since the choice is between
/// sources of one thing. Python only.
fn imports_from_drafts(
    role: &RoleSelector,
    members: &[usize],
    units: &[Unit],
    ctx: &RepoContext,
) -> Vec<Draft> {
    // Per thing: the members taking it from each source.
    let mut sources: BTreeMap<String, BTreeMap<String, BTreeSet<usize>>> = BTreeMap::new();
    for &m in members {
        let View::Symbol(_, s) = units[m].view else {
            continue;
        };
        for r in inherited_references(s, ctx) {
            if let Some(key) = import_source_key(&r, ctx) {
                sources
                    .entry(key)
                    .or_default()
                    .entry(r)
                    .or_default()
                    .insert(m);
            }
        }
    }
    let mut out = Vec::new();
    for (key, by_source) in sources {
        if by_source.len() < 2 {
            continue;
        }
        let alternatives: Vec<&str> = by_source.keys().map(String::as_str).collect();
        let population: BTreeSet<usize> = members
            .iter()
            .copied()
            .filter(|&m| {
                by_source.values().any(|users| users.contains(&m))
                    && !provides_alternative(&units[m].path(), &alternatives)
            })
            .collect();
        let users = |r: &str| by_source[r].intersection(&population).count();
        // The source most of them use; ties by reference, for determinism.
        let Some(source) = alternatives
            .iter()
            .copied()
            .max_by(|a, b| users(a).cmp(&users(b)).then(b.cmp(a)))
        else {
            continue;
        };
        // A team version is a rule only where the team mostly uses it: "use the
        // library, not the team's version of it" says the team's version is the
        // outlier, which a same-name helper does not make it.
        let team = ctx.team_version(&key) == Some(key.as_str());
        if team && source != key {
            continue;
        }
        let instead_of: Vec<String> = alternatives
            .iter()
            .filter(|a| **a != source)
            .map(|a| a.to_string())
            .collect();
        let name = source
            .split_once('#')
            .map_or(source, |(_, n)| n)
            .rsplit('.')
            .next()
            .unwrap_or(source)
            .to_string();
        let rule = Rule::ImportsFrom {
            name,
            source: source.to_string(),
            instead_of,
        };
        // Each member once, as `holds` judges it: holders under the source, an outlier
        // under the first alternative it takes the thing from, so the split adds up to
        // the evidence.
        let Rule::ImportsFrom { instead_of, .. } = &rule else {
            unreachable!()
        };
        let mut counts = vec![0usize; instead_of.len() + 1];
        for &m in &population {
            let View::Symbol(_, s) = units[m].view else {
                continue;
            };
            let refs: Vec<String> = references(s).collect();
            let slot = instead_of
                .iter()
                .position(|a| refs.iter().any(|r| same_ref(r, a)))
                .map_or(0, |i| i + 1);
            counts[slot] += 1;
        }
        let split = std::iter::once(source)
            .chain(instead_of.iter().map(String::as_str))
            .zip(counts)
            .map(|(r, c)| {
                let label = if team && r.starts_with("pkg:") {
                    dotted_ref(r)
                } else {
                    source_module(r)
                };
                (label, c)
            })
            .collect();
        out.extend(draft_over(
            role,
            rule,
            population.into_iter().collect(),
            units,
            ctx,
            1.0,
            split,
        ));
    }
    out
}

/// `PrefersLibrary`: in a package-wide file role, one library of a group dominates.
fn library_drafts(
    role: &RoleSelector,
    members: &[usize],
    units: &[Unit],
    ctx: &RepoContext,
) -> Vec<Draft> {
    if role.kind != SymbolKind::Module || role.dir != crate::roles::PACKAGE_WIDE {
        return vec![];
    }
    let mut out = Vec::new();
    for (group, libs) in LIBRARY_GROUPS {
        let mut users: Vec<usize> = Vec::new();
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for &m in members {
            if let View::File(f) = units[m].view {
                let used = group_libraries(f, libs);
                if !used.is_empty() {
                    users.push(m);
                }
                for l in used {
                    *counts.entry(l).or_default() += 1;
                }
            }
        }
        if counts.len() < 2 {
            continue;
        }
        let mut split: Vec<(String, usize)> =
            counts.iter().map(|(l, c)| ((*l).to_string(), *c)).collect();
        split.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let rule = Rule::PrefersLibrary {
            group: (*group).to_string(),
            preferred: split[0].0.clone(),
        };
        out.extend(draft_over(role, rule, users, units, ctx, 1.0, split));
    }
    out
}

/// `DependencyVersion`: packages that depend on a library mostly agree on its range.
/// The rule is "the range most workspace packages use", re-evaluated by `check`; the
/// ranges at mining time are its evidence (`split`).
fn dependency_drafts(
    role: &RoleSelector,
    members: &[usize],
    units: &[Unit],
    ctx: &RepoContext,
) -> Vec<Draft> {
    if role.kind != SymbolKind::Package {
        return vec![];
    }
    let mut by_dep: BTreeMap<&str, BTreeMap<&str, Vec<usize>>> = BTreeMap::new();
    for &m in members {
        if let View::Package(p) = units[m].view {
            for d in &p.dependencies {
                if let Some((n, r)) = split_dep(d) {
                    by_dep.entry(n).or_default().entry(r).or_default().push(m);
                }
            }
        }
    }
    let mut out = Vec::new();
    for (name, ranges) in by_dep {
        if ranges.len() < 2 {
            continue;
        }
        let mut split: Vec<(String, usize)> = ranges
            .iter()
            .map(|(r, ms)| ((*r).to_string(), ms.len()))
            .collect();
        split.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let mut population: Vec<usize> = ranges.values().flatten().copied().collect();
        population.sort_unstable();
        population.dedup();
        let rule = Rule::DependencyVersion {
            name: name.to_string(),
            range: None,
        };
        out.extend(draft_over(role, rule, population, units, ctx, 1.0, split));
    }
    out
}

/// `Avoids`: a role (almost) never has a signal that the rest of the same kind of
/// code uses regularly. Without the contrast, every role would "avoid eval".
fn avoid_drafts(
    roles: &BTreeMap<&RoleSelector, Vec<usize>>,
    units: &[Unit],
    ctx: &RepoContext,
) -> Vec<Draft> {
    let sigs: Vec<BTreeSet<String>> = units.iter().map(|u| signals(&u.view, ctx)).collect();
    let mut totals: BTreeMap<SymbolKind, usize> = BTreeMap::new();
    let mut global: BTreeMap<(SymbolKind, &str), usize> = BTreeMap::new();
    for (i, s) in sigs.iter().enumerate() {
        let k = units[i].kind();
        *totals.entry(k).or_default() += 1;
        for g in s {
            *global.entry((k, g.as_str())).or_default() += 1;
        }
    }
    // Units a signal can apply to (the denominator of its rates).
    let client_files = units
        .iter()
        .filter(|u| signal_applies("client_leak", &u.view) && matches!(u.view, View::File(_)))
        .count();
    let applicable = |k: SymbolKind, g: &str| {
        if g == "client_leak" {
            client_files
        } else {
            totals[&k]
        }
    };
    // Which areas import which, in how many files: avoiding an area is a layering
    // rule only when that area depends on the role's own area (importing it would
    // close a cycle) more than the role's area depends on it, since in a cycle the
    // dominant direction is the layering and the role must be on the lower side; or
    // when the target's package declares the role's package as a dependency (an
    // upward edge against a declared layer).
    // Avoiding a shared foundation (`packages/shared`, a logger) was always wrong.
    let mut area_deps: BTreeMap<(String, String), usize> = BTreeMap::new();
    for u in units {
        if let View::File(f) = u.view {
            let edges: BTreeSet<(String, String)> = f
                .imports
                .iter()
                .filter(|i| !i.type_only)
                .filter_map(|i| edge_areas(&f.package, &f.path, &i.module))
                .filter(|(own, t)| own != t)
                .collect();
            for e in edges {
                *area_deps.entry(e).or_default() += 1;
            }
        }
    }
    let deps = |from: &str, to: &str| {
        area_deps
            .get(&(from.to_string(), to.to_string()))
            .copied()
            .unwrap_or(0)
    };
    let mut out = Vec::new();
    for (role, members) in roles {
        if members.len() < MIN_ROLE_SIZE {
            continue;
        }
        let mut inside: BTreeMap<&str, usize> = BTreeMap::new();
        for &m in members {
            for g in &sigs[m] {
                *inside.entry(g.as_str()).or_default() += 1;
            }
        }
        for (signal, h) in inside {
            let population: Vec<usize> = members
                .iter()
                .copied()
                .filter(|&m| signal_applies(signal, &units[m].view))
                .collect();
            let n = population.len();
            let outside_n = applicable(role.kind, signal).saturating_sub(n);
            if n < MIN_ROLE_SIZE || outside_n == 0 {
                continue;
            }
            if let Some(target) = signal.strip_prefix("import:") {
                // The members' areas as the target's edges count them ([`edge_areas`]).
                let role_areas: BTreeSet<String> = members
                    .iter()
                    .map(|&m| member_area(&role.package, &units[m].path(), target))
                    .collect();
                // A role whose scope contains the target area is not a layer apart
                // from it ("files in the repo", "files in saleor/**" avoiding
                // `saleor/csv`): the role spans the target's siblings, so every area
                // the target imports is "the role's area" and the cycle test below
                // always passes, and the target's own files would count as holders
                // although they cannot break the rule.
                let scope = role_scope(role);
                if role_areas.contains(target)
                    || scope.is_empty()
                    || target == scope
                    || target.starts_with(&format!("{scope}/"))
                    // ... nor is a role inside the target's directory (`saleor/graphql`
                    // and the modules at the top of `saleor/`).
                    || scope.starts_with(&format!("{target}/"))
                {
                    continue;
                }
                let upward = role_areas.iter().any(|a| {
                    ctx.declares_area(target, a)
                        || (deps(target, a) > 0 && deps(target, a) > deps(a, target))
                });
                if !upward || wilson_lower_bound(n - h, n) < AVOID_IMPORT_MIN_LOWER_BOUND {
                    continue;
                }
                if python_units(members, units)
                    && entangled_with_peers(&role_areas, target, &area_deps)
                {
                    continue;
                }
            }
            let outside = global[&(role.kind, signal)] - h;
            let in_rate = h as f64 / n as f64;
            let out_rate = outside as f64 / outside_n as f64;
            // Layering rules are justified by the dependency direction checked above;
            // the target's own files never "import" it, so there is nothing to contrast.
            let contrast = if signal.starts_with("import:") {
                AVOID_MIN_CONTRAST
            } else if outside < AVOID_MIN_OUTSIDE_COUNT
                || out_rate < AVOID_MIN_OUTSIDE_RATE
                || out_rate < AVOID_MIN_CONTRAST * in_rate
            {
                continue;
            } else {
                out_rate / in_rate
            };
            let rule = Rule::Avoids {
                signal: signal.to_string(),
            };
            out.extend(draft_over(
                role,
                rule,
                population,
                units,
                ctx,
                contrast,
                vec![],
            ));
        }
    }
    out
}

/// Every unit is in a Python file. The Python-only rules below were measured on the
/// Python dev set; TypeScript keeps its own.
fn python_units(members: &[usize], units: &[Unit]) -> bool {
    members.iter().all(|&m| match units[m].view {
        View::Symbol(f, _) | View::File(f) => f.lang == "py",
        _ => false,
    })
}

/// A team base class that refines another team base (`RecordModel` adds ids and
/// timestamps to `Model`): when most of the role's outliers extend the general base,
/// directly or through other classes, they chose the other variant the team offers
/// (association tables extend `Model`), so extending the refinement is no rule.
fn refines_team_base(
    any_of: &[String],
    holders: &BTreeSet<usize>,
    members: &[usize],
    units: &[Unit],
    ctx: &RepoContext,
) -> bool {
    let [base] = any_of else { return false };
    let outliers: Vec<usize> = members
        .iter()
        .copied()
        .filter(|m| !holders.contains(m))
        .collect();
    if outliers.is_empty() {
        return false;
    }
    ctx.ancestors(base)
        .iter()
        .filter(|a| !a.starts_with("pkg:") && !a.starts_with("global#"))
        .any(|general| {
            let extending = outliers
                .iter()
                .filter(|&&m| {
                    wraps(&units[m]).iter().any(|w| {
                        w.kind == WrapKind::Extends
                            && (same_ref(&w.wrapper, general)
                                || ctx
                                    .ancestors(&norm_ref(&w.wrapper))
                                    .iter()
                                    .any(|x| x == general))
                    })
                })
                .count();
            extending >= REFINEMENT_MIN_OUTLIERS && extending * 2 > outliers.len()
        })
}

/// Outliers that must extend the general base before a refinement is no rule: one
/// class extending `Model` is an outlier, not a variant the team offers.
const REFINEMENT_MIN_OUTLIERS: usize = 3;

/// A layering rule says the role's area sits below the target area, as a layer
/// below the areas next to the target. It is incidental when the role's area depends
/// both ways on several of those peers ([`ENTANGLED_MIN_PEERS`]): it imports each from
/// more than one file (not a stray import) and each imports it back. Such an area is
/// entangled with the apps around the target rather than below them, so the one it
/// does not import is a coincidence, not a boundary (`utilities` and `core` import
/// most of their sibling apps, which import them). One two-way edge (`core` and
/// `users` through the user model) is normal for a foundation app and keeps its other
/// boundaries.
fn entangled_with_peers(
    role_areas: &BTreeSet<String>,
    target: &str,
    area_deps: &BTreeMap<(String, String), usize>,
) -> bool {
    let deps = |from: &str, to: &str| {
        area_deps
            .get(&(from.to_string(), to.to_string()))
            .copied()
            .unwrap_or(0)
    };
    let parent = |a: &str| a.rsplit_once('/').map_or("", |(p, _)| p).to_string();
    let entangled: BTreeSet<&str> = area_deps
        .iter()
        .filter(|((from, peer), out)| {
            role_areas.contains(from)
                && peer != target
                && !role_areas.contains(peer)
                && parent(peer) == parent(target)
                && **out >= 2
                && deps(peer, from) >= 1
        })
        .map(|((_, peer), _)| peer.as_str())
        .collect();
    entangled.len() >= ENTANGLED_MIN_PEERS
}

/// Peers of the target an area must depend on both ways to be entangled with them.
const ENTANGLED_MIN_PEERS: usize = 2;

/// Python roles need members from at least this many files (as naming rules do in
/// every language, [`NAMING_MIN_FILES`]).
const ROLE_MIN_FILES: usize = 3;

/// The role's members come from at least [`ROLE_MIN_FILES`] files, or the role is not
/// a Python role (TypeScript keeps its own bar: naming rules only).
fn spans_files(members: &[usize], units: &[Unit]) -> bool {
    let python = members.iter().all(|&m| match units[m].view {
        View::Symbol(f, _) | View::File(f) => f.lang == "py",
        _ => false,
    });
    if !python {
        return true;
    }
    let mut files: BTreeSet<String> = BTreeSet::new();
    for &m in members {
        files.insert(units[m].path());
        if files.len() >= ROLE_MIN_FILES {
            return true;
        }
    }
    false
}

/// A naming rule needs members from at least this many files: one file's exports
/// share a prefix because they sit together, not because the team chose a scheme.
const NAMING_MIN_FILES: usize = 3;

/// `Named`: members whose names the team chose (framework-reserved export names are
/// left out) share a prefix or suffix. CRUD verb prefixes describe what functions do
/// (`get*` reads next to a `create*` write), so they are not naming conventions.
#[allow(clippy::too_many_arguments)]
fn naming_drafts(
    role: &RoleSelector,
    members: &[usize],
    parent: Option<(&[usize], &Proposed)>,
    units: &[Unit],
    feats: &[BTreeSet<Rule>],
    global: &BTreeMap<(SymbolKind, &Rule), usize>,
    kind_total: usize,
    unsplit_pass: bool,
) -> Vec<Draft> {
    let named_population = |members: &[usize]| -> Vec<usize> {
        members
            .iter()
            .copied()
            .filter(|&m| match units[m].view {
                View::Symbol(f, s) => !framework_reserved_name(f, s),
                _ => false,
            })
            .collect()
    };
    let population = named_population(members);
    let parent_population = parent.map(|(p, proposed)| (named_population(p), proposed));
    let files: BTreeSet<String> = population.iter().map(|&m| units[m].path()).collect();
    if population.len() < MIN_ROLE_SIZE || files.len() < NAMING_MIN_FILES {
        return vec![];
    }
    // W3: a naming rule over plain Python classes (no framework lineage, W1) is not
    // proposed: their role may mix kinds Drift cannot tell apart (dev relabel 4: most
    // Python naming WRONGs were such mixes). Classes of one lineage kind, of a special
    // kind (enums, dataclasses) and entry points keep their naming rules.
    if !unsplit_pass
        && role.kind == SymbolKind::Class
        && role.entry == "-"
        && role.member_kind.is_none()
        && role.variety.is_none()
        && python_units(&population, units)
    {
        return vec![];
    }
    let kept: BTreeSet<&Rule> = population
        .iter()
        .flat_map(|&m| feats[m].iter().filter(|r| matches!(r, Rule::Named { .. })))
        .collect();
    let mut out = Vec::new();
    for rule in kept {
        let Rule::Named { pattern } = rule else {
            continue;
        };
        if pattern
            .strip_suffix('*')
            .is_some_and(|p| CRUD_VERBS.contains(&p))
        {
            continue;
        }
        // Whether the pattern is a convention of the role is decided on the names as
        // written, as before; its holders and outliers are then the names that follow
        // it with a release-stage prefix set aside or in another case style
        // ([`name_matches`]). So a `HARNESS_V1_TOOLS` among `harness*` values is no
        // outlier, and a rule whose last outliers only wrote it that way stays proposed,
        // with none.
        let written: BTreeSet<usize> = population
            .iter()
            .copied()
            .filter(|&m| feats[m].contains(rule))
            .collect();
        let holders: BTreeSet<usize> = population
            .iter()
            .copied()
            .filter(|&m| match units[m].view {
                View::Symbol(_, s) => name_matches(&s.name, pattern),
                _ => false,
            })
            .collect();
        let carried = || {
            let (parent, proposed) = parent_population.as_ref()?;
            carried_universal(
                role,
                rule,
                &written,
                &population,
                parent,
                proposed,
                global[&(role.kind, rule)],
                kind_total,
                units,
            )
        };
        let draft = consider(
            role,
            rule.clone(),
            written.clone(),
            &population,
            global[&(role.kind, rule)],
            kind_total,
            units,
            vec![],
        )
        .map(|d| {
            if holders == written {
                return d;
            }
            draft_of(
                role,
                rule.clone(),
                holders.clone(),
                &population,
                global[&(role.kind, rule)],
                kind_total,
                units,
                vec![],
            )
            .unwrap_or(d)
        });
        out.extend(draft.or_else(carried));
    }
    out
}

/// What mining proposed, by role and rule ([`carried_universal`]).
type Proposed = BTreeSet<(RoleSelector, Rule)>;

/// A role with its member kind set aside: the key of its place's unsplit role
/// ([`carried_universal`]).
fn unsplit_key(role: &RoleSelector) -> RoleSelector {
    RoleSelector {
        member_kind: None,
        shape: None,
        ..role.clone()
    }
}

/// Directory names that are source roots, not a kind of thing (`src/`, `app/`).
const SOURCE_ROOT_DIRS: &[&str] = &[
    "src", "lib", "libs", "app", "apps", "packages", "pages", "source",
];

/// Lowercase words of an identifier: `ToolLoopAgent` -> `tool`, `loop`, `agent`.
pub(crate) fn words(name: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let chars: Vec<char> = name.chars().collect();
    let mut cur = String::new();
    for (i, &c) in chars.iter().enumerate() {
        if !c.is_ascii_alphanumeric() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            continue;
        }
        let boundary = c.is_ascii_uppercase()
            && i > 0
            && (chars[i - 1].is_ascii_lowercase()
                || chars[i - 1].is_ascii_digit()
                || (chars[i - 1].is_ascii_uppercase()
                    && chars.get(i + 1).is_some_and(|n| n.is_ascii_lowercase())));
        if boundary && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        cur.push(c.to_ascii_lowercase());
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// The kind a file or folder name says: its last word, singular
/// (`action-handlers` -> `handler`, `service` -> `service`).
pub(crate) fn kind_of_word(name: &str) -> String {
    words(name).last().map(|w| singular(w)).unwrap_or_default()
}

/// `dialogs` -> `dialog`, `categories` -> `category`.
pub(crate) fn singular(w: &str) -> String {
    if let Some(stem) = w.strip_suffix("ies") {
        format!("{stem}y")
    } else if w.ends_with('s') && !w.ends_with("ss") && w.len() > 3 {
        w[..w.len() - 1].to_string()
    } else {
        w.to_string()
    }
}

/// The kind of thing a role's folder or file suffix names (`dialogs/` -> `dialog`,
/// `*.agent.ts` -> `agent`). Source roots and framework file names (`route`,
/// `page`, `layout`) name no kind.
fn kind_words(role: &RoleSelector) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(last) = role.dir.rsplit('/').next()
        && !matches!(last, "." | "[*]")
        && last != crate::roles::PACKAGE_WIDE
        && !SOURCE_ROOT_DIRS.contains(&last.to_ascii_lowercase().as_str())
    {
        out.push(singular(&words(last).concat()));
    }
    if let Some(suffix) = role.file.strip_prefix("*.") {
        out.push(singular(&words(suffix).concat()));
    }
    out.retain(|w| !w.is_empty());
    out
}

/// Things a rule says members use.
fn rule_targets(rule: &Rule) -> Vec<&str> {
    match rule {
        Rule::WrappedBy { kind, any_of } if *kind != WrapKind::Try => {
            any_of.iter().map(String::as_str).collect()
        }
        Rule::Calls { callee } | Rule::PassesKey { callee, .. } => vec![callee],
        Rule::Renders { component } => vec![component],
        Rule::Throws { class } => vec![class],
        _ => vec![],
    }
}

/// A rule whose target is named after the kind of thing the role's folder holds
/// restates the folder name: "dialogs render `<Dialog>`", "`agent/**` builds a
/// `ToolLoopAgent`". The target is the kind itself (`Dialog`), a component part of
/// it (`<DialogFooter>`), or, for a library class, a variety of it (`ToolLoopAgent`;
/// a library function such as `createZodDto` in `*.dto` files is a real choice).
/// A team's own helper that merely mentions the kind (`BaseService`,
/// `identitiesKeys` in `identities/**`) is a real choice.
pub fn is_tautology(role: &RoleSelector, rule: &Rule) -> bool {
    let targets = rule_targets(rule);
    if crate::shapes::restates_shape(role, rule, &targets) {
        return true;
    }
    if restates_variety(role, &targets) {
        return true;
    }
    let kinds = kind_words(role);
    if kinds.is_empty() || targets.is_empty() {
        return false;
    }
    let component = matches!(
        rule,
        Rule::Renders { .. }
            | Rule::WrappedBy {
                kind: WrapKind::Jsx,
                ..
            }
    );
    targets.iter().all(|t| {
        let external = t.starts_with("pkg:") || t.starts_with("global#");
        let name = short(t);
        let name = name.split(['.', '(']).next().unwrap_or(&name);
        let w = words(name);
        let joined = singular(&w.concat());
        kinds.iter().any(|k| {
            joined == *k
                || (component && w.first().is_some_and(|f| singular(f) == *k))
                || (external
                    && name.starts_with(|c: char| c.is_ascii_uppercase())
                    && w.last().is_some_and(|l| singular(l) == *k))
        })
    })
}

/// A role of classes of a special kind (TypedDicts, enums, named tuples) was formed by
/// the base or decorator that makes a class that kind, so "TypedDicts extend
/// `TypedDict`" says nothing about the code, whichever module the base comes from. A
/// refinement of the kind (`StrEnum` for enums) or a team's own base is a choice.
///
/// So does a role of a member kind ([`RoleSelector::member_kind`]): it was formed by the
/// framework bases that make a class that kind, so "serializers extend
/// `serializers.ModelSerializer`" says nothing either; a team's own base is a choice.
fn restates_variety(role: &RoleSelector, targets: &[&str]) -> bool {
    if let Some(kind) = role.member_kind.as_deref() {
        return !targets.is_empty()
            && targets
                .iter()
                .all(|t| drift_core::lineage::framework_kind(&norm_ref(t)) == Some(kind));
    }
    let Some(variety) = role.variety.as_deref() else {
        return false;
    };
    !targets.is_empty()
        && targets.iter().all(|t| {
            let name = short(t);
            let name = name.rsplit('.').next().unwrap_or(&name);
            words(name).concat() == variety
        })
}

/// Part of the repo a role's files are in, for finding the linter config that covers it.
fn role_scope(role: &RoleSelector) -> String {
    // A role across the repository is in every package: the repo's own lint config.
    if role.package == crate::shapes::ANY_PACKAGE {
        return String::new();
    }
    let dir = match role.dir.as_str() {
        "." => "",
        d if d == crate::roles::PACKAGE_WIDE => "",
        d => d,
    };
    match (role.package.is_empty(), dir.is_empty()) {
        (true, _) => dir.to_string(),
        (false, true) => role.package.clone(),
        (false, false) => format!("{}/{dir}", role.package),
    }
}

/// The lint rule equivalent to a Drift rule, if any. (`rules-of-hooks` checks where
/// hooks are called, not what they are named, so it decides no naming rule; React's
/// `use*` naming is a framework mandate instead.)
fn lint_equivalent(rule: &Rule) -> Option<&'static str> {
    match rule {
        Rule::Avoids { signal } => match signal.as_str() {
            // `typing_any` has none until Python lint configs (ruff `ANN401`, mypy
            // `disallow_any_explicit`) are read: ESLint's `no-explicit-any` is about
            // TypeScript and says nothing about Python code next to it.
            "any" => Some("no-explicit-any"),
            "console" => Some("no-console"),
            "env" => Some("no-process-env"),
            _ => None,
        },
        Rule::Control { value } if value == "typed_return" => Some("explicit-function-return-type"),
        _ => None,
    }
}

fn lint_verdict(rule: &Rule, role: &RoleSelector, ctx: &RepoContext) -> LintVerdict {
    let scope = role_scope(role);
    if let Rule::Avoids { signal } = rule
        && let Some(area) = signal.strip_prefix("import:")
    {
        return ctx.import_restriction(&scope, area);
    }
    lint_equivalent(rule).map_or(LintVerdict::Silent, |l| ctx.lint_verdict(l, &scope))
}

/// Members needed to show a team-made alternative to what a role avoids.
const ALTERNATIVE_MIN_MEMBERS: usize = 3;

/// A logging call (`logger.info`, `log()`, `pino`): an alternative to `console.*`.
fn is_logger_call(callee: &str) -> bool {
    if callee.starts_with("global#") {
        return false;
    }
    let path = callee.rsplit_once('#').map_or(callee, |(_, p)| p);
    path.split(['.', '(']).any(|seg| {
        words(seg)
            .iter()
            .any(|w| matches!(w.as_str(), "log" | "logger" | "logging"))
    }) || package_name(callee.split('#').next().unwrap_or(""))
        .is_some_and(|p| group_members("logging").contains(&p))
}

/// Packages whose job is validated access to the environment.
const ENV_PACKAGES: &[&str] = &[
    "@t3-oss/env-core",
    "@t3-oss/env-nextjs",
    "@t3-oss/env-nuxt",
    "envalid",
    "@nestjs/config",
];

/// An import of the team's env or config module, or of an env-validation package:
/// an alternative to reading `process.env`. The *module* decides, not the imported
/// name (`siteConfig`, `ConfigService`, `SettingsPage` are not env modules): it is a
/// file named for env or config (`env.ts`, `lib/config.ts`, `app-settings.ts`) that
/// itself reads `process.env`.
fn is_config_import(i: &drift_core::Import, ctx: &RepoContext) -> bool {
    if i.type_only {
        return false;
    }
    if let Some(p) = package_name(&i.module) {
        return ENV_PACKAGES.contains(&p);
    }
    let file = i.module.rsplit('/').next().unwrap_or(&i.module);
    let named = words(file.split('.').next().unwrap_or(file))
        .iter()
        .any(|w| matches!(w.as_str(), "env" | "config" | "settings"));
    named && ctx.reads_env(&i.module)
}

/// Avoiding `console.*`, bare `Error` or direct `process.env` reads is only a team
/// policy when something corroborates it: a lint rule set to warn, or members using
/// a team alternative (a logger, an error class, an env/config module). Without it
/// the absence is incidental (most code has no reason to log or throw).
fn corroborated(d: &Draft, units: &[Unit], verdict: LintVerdict, ctx: &RepoContext) -> bool {
    let Rule::Avoids { signal } = &d.rule else {
        return true;
    };
    let count = |f: &dyn Fn(&FileFacts, &Symbol) -> bool| {
        d.members
            .iter()
            .filter(|&&m| match units[m].view {
                View::Symbol(file, s) => f(file, s),
                _ => false,
            })
            .count()
    };
    match signal.as_str() {
        "console" => {
            verdict == LintVerdict::Warned
                || count(&|_, s| s.calls.iter().any(|c| is_logger_call(c)))
                    >= ALTERNATIVE_MIN_MEMBERS
        }
        "throw_error" => {
            count(&|_, s| s.throws.iter().any(|t| !t.starts_with("global#")))
                >= ALTERNATIVE_MIN_MEMBERS
        }
        "env" => {
            verdict == LintVerdict::Warned
                || count(&|f, _| f.imports.iter().any(|i| is_config_import(i, ctx)))
                    >= ALTERNATIVE_MIN_MEMBERS
        }
        // Python code uses `typing.Any` for what is free-form by design (JSON payloads,
        // `**kwargs: Any`, generic helpers), so avoiding it is a team policy only when
        // a Python linter says so (ruff `ANN401`, mypy `disallow_any_explicit`). Python
        // lint configs are not read yet, so this is not proposed.
        "typing_any" => false,
        _ => true,
    }
}

/// Python rule families that are never proposed: every card of theirs on the Python dev
/// sets was WRONG under rubric v3 (relabel 3, 2026-11-07), for reasons no fact
/// separates, so they are hidden rather than shown as advice.
///
/// - **Call order** (`Before`): 0 of 3, all `incidental` (Flask handlers flash before
///   they redirect or render only when they have a message).
/// - **"Do not read `os.environ` directly"** (`Avoids` `os_environ`): 0 of 3 in 3 repos
///   (`incidental` or `legit_outliers`): the members are constants with no reason to be
///   configurable, and the outliers are the settings and tunables the team does read
///   from the environment, the house way.
/// - **Calls on HTTP handler functions** (`Calls`, role of `http` functions): 0 of 7 in
///   2 repos (`false_outliers`, `legit_outliers`, `incidental`): what a handler calls
///   (`Response()`, `jsonify()`, `redirect()`, `flash()`) follows from what it answers.
///
/// TypeScript keeps all three; a Python security sink (`Avoids` `sink:*`) and call
/// wrappers on handlers are unaffected.
fn hidden_python_family(role: &RoleSelector, rule: &Rule) -> bool {
    match rule {
        Rule::Before { .. } => true,
        Rule::Avoids { signal } => signal == "os_environ",
        Rule::Calls { .. } => role.entry == "http" && role.kind == SymbolKind::Function,
        _ => false,
    }
}

/// Precision filters every draft passes before it is proposed:
///
/// - not something a framework mandates ([`frameworks::MANDATES`]);
/// - not a tautology of the role's folder or file kind ([`is_tautology`]);
/// - not already enforced by the repo's linter (`error`: trivial). A rule the team
///   turned `off` or set to `warn` does not stop a proposal;
/// - absence of `console.*`, bare `Error` or `process.env` reads (and, in Python,
///   `typing.Any`) only when corroborated;
/// - for Python, holders from at least [`ROLE_MIN_FILES`] files;
/// - no calls rule on code that is built rather than run ([`describes_how_built`]),
///   no rule that describes one or two files of a role ([`file_local`]), no rule
///   that follows the handlers' path parameters ([`follows_path_params`]), the
///   tables' key structure ([`follows_key_structure`]) or whether handlers take input
///   ([`follows_input`]), no rule whose every outlier is a class of another kind
///   ([`outliers_of_another_kind`]), and no layering rule against the direction the
///   linter states ([`against_lint_layering`]).
///
/// [`unproposable`] names the first filter that stops a draft (the yield funnel's gate,
/// [`crate::funnel`]), or `None` when it is proposable.
fn unproposable(d: &Draft, units: &[Unit], ctx: &RepoContext) -> Option<&'static str> {
    if frameworks::mandated(&d.rule, |p| ctx.uses(p)).is_some() {
        return Some("mandated");
    }
    if is_tautology(&d.role, &d.rule) {
        return Some("tautology");
    }
    if python_units(&d.members, units) && hidden_python_family(&d.role, &d.rule) {
        return Some("python_family_hidden");
    }
    // The members that follow a Python rule must come from several files too: 20
    // tasks in two files that compress their payloads are one pattern written twice.
    let holders: Vec<usize> = d.holders.iter().copied().collect();
    if !spans_files(&holders, units) {
        return Some("holders_one_file");
    }
    if describes_how_built(d, units, ctx) {
        return Some("how_built");
    }
    if file_local(d, units) {
        return Some("file_local");
    }
    if follows_path_params(d, units) {
        return Some("path_params");
    }
    if follows_key_structure(d, units) {
        return Some("key_structure");
    }
    if follows_input(d, units) {
        return Some("input");
    }
    if outliers_of_another_kind(d, units) {
        return Some("other_kind_outliers");
    }
    if against_lint_layering(d, ctx) {
        return Some("lint_layering");
    }
    let verdict = lint_verdict(&d.rule, &d.role, ctx);
    // A lint rule the team turned off for this code says it allows what the rule
    // forbids (`no-explicit-any: off`, `explicit-function-return-type: off`): the parts
    // that happen to avoid it state no team choice (proposal, dev relabel 3). An import
    // restriction turned off names no direction, so it decides nothing.
    let disabled = verdict == LintVerdict::Disabled && lint_equivalent(&d.rule).is_some();
    if verdict.decides() || disabled {
        return Some("lint");
    }
    if !corroborated(d, units, verdict, ctx) {
        return Some("uncorroborated");
    }
    None
}

/// A TypeScript/JavaScript call rule ("functions in `x/**` call `f()`") whose callee is
/// not a guard is not proposed (proposal: demote the family to hidden, dev relabel 3).
/// What a member calls follows from what it does: a dialog calls `useToast()` when it
/// shows toasts, a table calls `uuid()` when it has a uuid column, and the members that
/// do not lack the need rather than the convention. On the TypeScript dev labels
/// (`eval/study/runs/dev-v3-relabel3-2026-11-07/ts`) the family read 2 ACCEPT of 14
/// suggestion cards, 12 WRONG, 9 of them because the call is incidental or the
/// outliers are legitimate. A callee that is a guard done in the handler's body
/// ([`security::callee_is_guard`], [`RepoContext::is_guard`]) stays: a member that does
/// not call it lacks a check. Python call rules, which advise only, are unchanged.
fn hidden_call_rule(d: &Draft, units: &[Unit], ctx: &RepoContext) -> bool {
    let Rule::Calls { callee } = &d.rule else {
        return false;
    };
    let python = d.members.iter().any(|&m| match units[m].view {
        View::Symbol(f, _) | View::File(f) => f.lang == "py",
        _ => false,
    });
    !python
        && !security::callee_is_guard(ctx, callee)
        && !ctx.is_guard(callee)
        && !refuse::names_access_control(callee)
}

/// Calls that describe how code is built rather than a convention it follows:
///
/// - A component's call of a class-name helper (`cn()`, `clsx()`, `twMerge()`, `cva()`,
///   or an in-repo function that only wraps them) happens where the component merges
///   classes, which depends on its props, not on a team rule. Other component calls
///   (`useAuth()`, `trackPageView()` in screens) are conventions like any other.
/// - An exported value is built by its calls: the order of those calls is its shape,
///   and so is the call itself when every outlier is built with a sibling of it
///   instead (`z.enum()` or `z.array()` next to `z.object()`). A value built by the
///   same call in every member but a few that call nothing like it (FastAPI
///   dependencies declared with `Depends()`) keeps the rule.
fn describes_how_built(d: &Draft, units: &[Unit], ctx: &RepoContext) -> bool {
    match (&d.rule, d.role.kind) {
        (Rule::Calls { callee }, SymbolKind::Component) => ctx.is_class_name_helper(callee),
        (Rule::Before { first, then }, SymbolKind::Component) => {
            ctx.is_class_name_helper(first) || ctx.is_class_name_helper(then)
        }
        (Rule::Before { .. }, SymbolKind::Const | SymbolKind::Variable) => true,
        (Rule::Calls { callee }, SymbolKind::Const | SymbolKind::Variable) => {
            let mut outliers = d
                .members
                .iter()
                .filter(|m| !d.holders.contains(m))
                .peekable();
            outliers.peek().is_some()
                && outliers.all(|&m| match units[m].view {
                    View::Symbol(_, s) => s.calls.iter().any(|c| sibling_callee(c, callee)),
                    _ => false,
                })
        }
        _ => false,
    }
}

/// `other` is another export of the package or module that provides `callee`
/// (`zod#z.enum` for `zod#z.object`); the same export reached through another path
/// (`fastapi#params.Depends` for `fastapi#Depends`) is not a sibling.
fn sibling_callee(other: &str, callee: &str) -> bool {
    let (Some((om, on)), Some((cm, cn))) = (other.split_once('#'), callee.split_once('#')) else {
        return false;
    };
    let root = |m: &'_ str| package_name(m).map_or_else(|| m.to_string(), str::to_string);
    // The export's own name: `z.object` -> `object`, `params.Depends` -> `Depends`.
    let base = |n: &'_ str| {
        let n = n.split('(').next().unwrap_or(n);
        n.rsplit('.').next().unwrap_or(n).to_string()
    };
    // In-repo modules count too: the tRPC procedures of one `init.ts`
    // (`protectedProcedure` next to `publicProcedure`) are alternatives as much as
    // `z.enum()` is to `z.object()`.
    root(om) == root(cm) && base(on) != base(cn)
}

/// The linter states which way a layer edge goes: when it forbids the target area to
/// import the role's area (`packages/app-store` must not import `../features`), the
/// role importing the target is the intended direction, and "the role does not import
/// the target" says the opposite.
fn against_lint_layering(d: &Draft, ctx: &RepoContext) -> bool {
    let Rule::Avoids { signal } = &d.rule else {
        return false;
    };
    let Some(target) = signal.strip_prefix("import:") else {
        return false;
    };
    let scope = role_scope(&d.role);
    let own: Vec<&str> = scope.split('/').filter(|s| !s.is_empty()).take(2).collect();
    !target.starts_with("pkg:") && !own.is_empty() && ctx.forbids_import(target, &own.join("/"))
}

/// Holders from fewer files than this, with outliers elsewhere, may describe those files.
const HOLDER_MIN_FILES: usize = 3;
/// ... when their files hold this many times more members each than the outliers' files.
const HOLDER_FILE_DENSITY: usize = 10;

/// A rule whose holders sit in one or two files dense with members, while its outliers
/// sit in other, sparse files, describes how the dense files are written, not the
/// role: the 150 icons of an `icons.tsx` next to the one-export component files of
/// their folder, the 300 calls of a generated client next to the hand-written helpers
/// that use it. Files of the same make (`users.ts` and `orgs.ts` with 20 services
/// each) next to a new `billing.ts` that skipped the convention are a real outlier,
/// and a role that is itself one or two files (a schema file's tables) is judged
/// within them.
fn file_local(d: &Draft, units: &[Unit]) -> bool {
    let holder_files: BTreeSet<String> = d.holders.iter().map(|&h| units[h].path()).collect();
    if holder_files.len() >= HOLDER_MIN_FILES {
        return false;
    }
    let mut in_holder_files = 0;
    let mut other: BTreeMap<String, usize> = BTreeMap::new();
    for &m in &d.members {
        let path = units[m].path();
        if holder_files.contains(&path) {
            in_holder_files += 1;
        } else {
            *other.entry(path).or_default() += 1;
        }
    }
    let other_members: usize = other.values().sum();
    // Members per holder file >= DENSITY x members per other file, in integers.
    !other.is_empty()
        && in_holder_files * other.len() >= HOLDER_FILE_DENSITY * other_members * holder_files.len()
}

/// True when the route of an HTTP entry point has a path parameter (`/users/:id`,
/// `/links/[id]`, `/items/{id}`, `/pets/<int:id>`).
fn has_path_params(route: &str) -> bool {
    route
        .split('/')
        .any(|s| s.starts_with([':', '[', '{', '<']))
}

/// The route of a handler unit, if an adapter recorded one.
fn route_of<'a>(u: &Unit<'a>) -> Option<&'a str> {
    let View::Symbol(f, s) = u.view else {
        return None;
    };
    f.entry_points
        .iter()
        .find(|e| s.exported_as.contains(&e.symbol))
        .and_then(|e| e.route.as_deref())
}

/// A rule held by exactly the handlers that take path parameters holds because of them
/// (`@ApiParam()` documents a path parameter): its outliers, the handlers without
/// one, are legitimately different. It is "handlers with path parameters do X", and
/// as such it has no outlier to report. This holds for any rule kind, by intent: a
/// guard or a call that exactly the parameterised handlers make follows the
/// parameters just as much (a lookup by id that throws when the id is unknown).
fn follows_path_params(d: &Draft, units: &[Unit]) -> bool {
    let params = |m: usize| route_of(&units[m]).map(has_path_params);
    d.members.iter().all(|&m| params(m).is_some())
        && d.holders.iter().all(|&h| params(h) == Some(true))
        && d.members
            .iter()
            .filter(|m| !d.holders.contains(m))
            .all(|&m| params(m) == Some(false))
}

/// Drizzle's table builders (`pgTable("t", { id: ... })`), whose column object is
/// argument 1.
const DRIZZLE_TABLE_BUILDERS: &[&str] =
    &["pgTable", "mysqlTable", "sqliteTable", "singlestoreTable"];

/// The symbol declares a primary key: a composite `primaryKey({ columns })`, or a
/// column built with `.primaryKey()` (`text("slug").primaryKey()`).
fn declares_primary_key(s: &Symbol) -> bool {
    s.calls.iter().any(|c| {
        c.split_once('#').is_some_and(|(module, name)| {
            package_name(module).is_some_and(|p| p == "drizzle-orm")
                && (name == "primaryKey" || name.ends_with(".primaryKey"))
        })
    })
}

/// "Tables pass `id`" holds for the tables keyed by an `id` column. A table that
/// declares its primary key another way (a join table's composite key, a lookup table
/// keyed by its slug) has no `id` by design, so when every outlier does, the rule
/// follows the key structure and has no outlier to report. An outlier with no primary
/// key at all is still one, and so is any other column (`createdAt`) a keyed table
/// leaves out.
fn follows_key_structure(d: &Draft, units: &[Unit]) -> bool {
    let Rule::PassesKey {
        callee,
        index: 1,
        key,
    } = &d.rule
    else {
        return false;
    };
    let drizzle_table = callee.split_once('#').is_some_and(|(module, name)| {
        package_name(module).is_some_and(|p| p == "drizzle-orm")
            && DRIZZLE_TABLE_BUILDERS.contains(&name)
    });
    if !drizzle_table || key != "id" {
        return false;
    }
    let mut outliers = d
        .members
        .iter()
        .filter(|m| !d.holders.contains(m))
        .peekable();
    outliers.peek().is_some()
        && outliers.all(|&m| matches!(units[m].view, View::Symbol(_, s) if declares_primary_key(s)))
}

/// Argument keys that name an input schema whatever the callee
/// (`authenticatedApiClient({ schemas })`, `createRoute({ inputSchema })`).
const INPUT_SCHEMA_KEYS: &[&str] = &[
    "schemas",
    "schema",
    "inputSchema",
    "bodySchema",
    "querySchema",
    "paramsSchema",
];

/// Argument keys that carry input to validate only when the callee is a validation
/// library's (`validator({ body, query })`); elsewhere they are data (a router link's
/// `params`).
const INPUT_KEYS: &[&str] = &["input", "body", "query", "params"];

/// Validation and schema libraries.
const VALIDATION_PACKAGES: &[&str] = &[
    "zod",
    "yup",
    "joi",
    "valibot",
    "superstruct",
    "class-validator",
    "ajv",
    "@sinclair/typebox",
    "arktype",
    "@hono/zod-validator",
    "@effect/schema",
    "io-ts",
    "runtypes",
    "@vinejs/vine",
    "express-validator",
    "celebrate",
];

/// The rule is about validating input: the `validates` control, or passing a schema
/// key ([`INPUT_SCHEMA_KEYS`], or [`INPUT_KEYS`] to a validation library's callee).
pub(crate) fn is_input_validation(rule: &Rule) -> bool {
    match rule {
        Rule::Control { value } => value == "validates",
        Rule::PassesKey { callee, key, .. } => {
            INPUT_SCHEMA_KEYS.contains(&key.as_str())
                || (INPUT_KEYS.contains(&key.as_str())
                    && callee.split_once('#').is_some_and(|(module, _)| {
                        package_name(module).is_some_and(|p| VALIDATION_PACKAGES.contains(&p))
                    }))
        }
        _ => false,
    }
}

/// A rule about validating input holds for the handlers that take input: when every
/// outlier provably reads none (`no_input`: a `me` endpoint working from the session
/// only, a tRPC query with no `.input()`), there is nothing for them to validate, so
/// the rule follows the input and has no outlier to report. An outlier that reads its
/// input without validating it is still one, and so is one Drift cannot tell about (a
/// request handed to a helper, a handler defined elsewhere). Rules about anything else
/// (a guard every handler needs) are not conditional on input.
fn follows_input(d: &Draft, units: &[Unit]) -> bool {
    if !is_input_validation(&d.rule) {
        return false;
    }
    let mut outliers = d
        .members
        .iter()
        .filter(|m| !d.holders.contains(m))
        .peekable();
    outliers.peek().is_some()
        && outliers.all(|&m| {
            matches!(units[m].view, View::Symbol(_, s)
                if s.controls.iter().any(|c| c == drift_core::controls::NO_INPUT))
        })
}

/// The package (`pkg:@nestjs/graphql`) or in-repo module a canonical ref comes from.
pub(crate) fn ref_root(r: &str) -> String {
    let module = r.split_once('#').map_or(r, |(m, _)| m);
    package_name(module).map_or_else(|| module.to_string(), |p| format!("pkg:{p}"))
}

/// Share of a class role's holders that must decorate fields from one package before
/// that package says what the role's classes are built for.
const FIELD_FRAMEWORK_SHARE: f64 = 0.9;

/// Outliers of a class rule that are classes of another kind:
///
/// - built for another framework: the holders' fields are decorated from one package
///   (`@Field()` of `@nestjs/graphql` on GraphQL types) and the outlier's fields only
///   from others (class-validator on a REST body);
/// - decorated with another class decorator of the rule's package that no holder
///   carries (`@InputType()` among `@ObjectType()`s, `@ViewEntity()` among `@Entity()`s).
///
/// When every outlier is one, the rule describes the classes of the holders' kind and
/// has no outlier to report. A class that forgot the decorator but has the holders'
/// fields (`@Field()` with no `@ObjectType()`) is still an outlier, and so is one with
/// no decorated fields at all.
fn outliers_of_another_kind(d: &Draft, units: &[Unit]) -> bool {
    if d.role.kind != SymbolKind::Class {
        return false;
    }
    let symbol = |m: usize| match units[m].view {
        View::Symbol(_, s) => Some(s),
        _ => None,
    };
    let holders: Vec<&Symbol> = d.holders.iter().filter_map(|&h| symbol(h)).collect();
    if holders.is_empty() {
        return false;
    }
    let mut field_roots: BTreeMap<String, usize> = BTreeMap::new();
    for h in &holders {
        let roots: BTreeSet<String> = h.field_decorators.iter().map(|f| ref_root(f)).collect();
        for r in roots {
            *field_roots.entry(r).or_default() += 1;
        }
    }
    let frameworks: BTreeSet<&str> = field_roots
        .iter()
        .filter(|(_, n)| **n as f64 >= FIELD_FRAMEWORK_SHARE * holders.len() as f64)
        .map(|(r, _)| r.as_str())
        .collect();
    let target = match &d.rule {
        Rule::WrappedBy {
            kind: WrapKind::Decorator,
            any_of,
        } if any_of.len() == 1 => Some(norm_ref(&any_of[0]).into_owned()),
        _ => None,
    };
    let holder_decorators: BTreeSet<String> = holders
        .iter()
        .flat_map(|h| h.wraps.iter())
        .filter(|w| w.kind == WrapKind::Decorator)
        .map(|w| norm_ref(&w.wrapper).into_owned())
        .collect();
    let another_framework = |s: &Symbol| {
        !frameworks.is_empty()
            && !s.field_decorators.is_empty()
            && s.field_decorators
                .iter()
                .all(|f| !frameworks.contains(ref_root(f).as_str()))
    };
    let competing_decorator = |s: &Symbol| {
        target.as_ref().is_some_and(|t| {
            s.wraps
                .iter()
                .filter(|w| w.kind == WrapKind::Decorator)
                .any(|w| {
                    let w = norm_ref(&w.wrapper);
                    ref_root(&w) == ref_root(t)
                        && *w != **t
                        && !holder_decorators.contains(w.as_ref())
                })
        })
    };
    let mut outliers = d
        .members
        .iter()
        .filter(|m| !d.holders.contains(m))
        .peekable();
    outliers.peek().is_some()
        && outliers
            .all(|&m| symbol(m).is_some_and(|s| another_framework(s) || competing_decorator(s)))
}

/// Show a model field in the spelling most holders use (`createdAt`, not `createdat`).
fn display_field(d: &mut Draft, units: &[Unit], keep: &Keep) {
    let Rule::ModelHas { field } = &d.rule else {
        return;
    };
    let mut spellings: BTreeMap<&str, usize> = BTreeMap::new();
    for &h in &d.holders {
        if let View::Model(m) = units[h].view {
            for f in m.fields.iter().filter(|f| norm_field(f) == *field) {
                *spellings.entry(f.as_str()).or_default() += 1;
            }
        }
    }
    let role = d.role.clone();
    let spelled = |f: &str| Rule::ModelHas {
        field: f.to_string(),
    };
    // Hysteresis: a spelling some holders use that an accepted convention already
    // names keeps that convention, whichever spelling most holders use now.
    let accepted = spellings
        .keys()
        .find(|f| keep.ids.contains(&convention_id(&role, &spelled(f))));
    if let Some(f) = accepted {
        d.rule = spelled(f);
    } else if let Some((best, _)) = spellings
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(a.0)))
    {
        d.rule = spelled(best);
    }
}

#[allow(clippy::too_many_arguments)]
fn consider(
    role: &RoleSelector,
    rule: Rule,
    holders: BTreeSet<usize>,
    members: &[usize],
    global_count: usize,
    total_units: usize,
    units: &[Unit],
    split: Vec<(String, usize)>,
) -> Option<Draft> {
    if holders.len() >= members.len() {
        return None; // universal in the role: documentation, not a check
    }
    draft_of(
        role,
        rule,
        holders,
        members,
        global_count,
        total_units,
        units,
        split,
    )
}

/// [`consider`] without its universal check: the draft of a rule its holders follow
/// in a role of `members`, when its evidence and lift are enough.
#[allow(clippy::too_many_arguments)]
fn draft_of(
    role: &RoleSelector,
    rule: Rule,
    holders: BTreeSet<usize>,
    members: &[usize],
    global_count: usize,
    total_units: usize,
    units: &[Unit],
    split: Vec<(String, usize)>,
) -> Option<Draft> {
    let n = members.len();
    let k = holders.len();
    let lb = wilson_lower_bound(k, n);
    if lb < MIN_LOWER_BOUND {
        return None;
    }
    let p_role = k as f64 / n as f64;
    let p_global = global_count as f64 / total_units.max(1) as f64;
    let lift = if p_global > 0.0 {
        p_role / p_global
    } else {
        0.0
    };
    if lift < rule.min_lift() {
        return None;
    }
    // Guards on entry points matter more than conventions on internal helpers.
    let entry = units[members[0]].entry != "-";
    let risk = if entry
        && matches!(
            rule,
            Rule::WrappedBy {
                kind: WrapKind::Call | WrapKind::Decorator,
                ..
            }
        ) {
        1.5
    } else {
        1.0
    };
    let score = lb * size_weight(n) * lift.min(5.0) * rule.specificity() * risk;
    Some(Draft {
        role: role.clone(),
        rule,
        holders,
        n,
        lb,
        lift,
        split,
        score,
        members: members.to_vec(),
        exempt: vec![],
        inherited: vec![],
        derived: vec![],
        role_n: None,
        base: Some(p_global),
        accepted: false,
        origin: String::new(),
    })
}

/// A rule held by every member of a role split off by member kind (W1), carried over
/// from the place's unsplit role: "classes in search files are decorated with
/// `register_search()`" held by 98 of 100 classes, and the two that did not are a form
/// and a model, so it holds for all 98 plain classes once the kinds are apart. A rule
/// universal in its role is otherwise no candidate ([`consider`]); here it is the
/// convention the unsplit role proposed, with the members of other kinds moved out,
/// so it stays one (with no outlier, `check` still holds new members to it). Only when
/// the unsplit role (`parent`: every member at the role's place, of any kind) has more
/// members than the role, and mining the unsplit roles proposed the same rule on that
/// role (`proposed`, [`unsplit_proposed`]): a property every member of a role has, and
/// that its unsplit role did not propose, stays no rule.
#[allow(clippy::too_many_arguments)]
fn carried_universal(
    role: &RoleSelector,
    rule: &Rule,
    holders: &BTreeSet<usize>,
    members: &[usize],
    parent: &[usize],
    proposed: &Proposed,
    global_count: usize,
    total_units: usize,
    units: &[Unit],
) -> Option<Draft> {
    if holders.len() < members.len()
        || parent.len() <= members.len()
        || !unsplit_proposed(proposed, role, rule)
    {
        return None;
    }
    draft_of(
        role,
        rule.clone(),
        holders.clone(),
        members,
        global_count,
        total_units,
        units,
        vec![],
    )
}

/// Mining the unsplit roles proposed `rule` on `role`'s unsplit role itself: not on
/// another role at a deeper or shallower place, so a carried rule never reaches
/// further than the one proposed before the split.
fn unsplit_proposed(proposed: &Proposed, role: &RoleSelector, rule: &Rule) -> bool {
    proposed.contains(&(unsplit_key(role), rule.clone()))
}

/// "Wrapped by one of these": the alternatives are the wrappers in the outermost
/// call-wrapper slot that at least two members share.
///
/// In a set with a guard among them ([`crate::security::authenticates`]), an alternative
/// that is no guard does not satisfy the rule and is left out of it: "rpc entry points
/// are wrapped in `authedProcedure()` or `adminProcedure()`", not "... or
/// `publicProcedure()`", so a new public procedure is an outlier, not a holder. With
/// fewer than two guards left, the set says no more than the single-wrapper rule.
/// What was left out is mined on its own evidence, as any wrapper is: it is no member
/// of the set ([`dedupe`]).
///
/// Holders, and each alternative's share, are counted over every call-wrapper slot, as
/// [`Rule::holds`] reads a member: a handler with `Depends(get_db)` before
/// `Depends(get_current_user)` holds a set of `get_current_user()`; so is a member
/// wrapped in a binding built on an alternative (`bookingsProcedure =
/// authedProcedure.use(...)`), which counts toward the alternative it is built on.
fn variant_set(
    role: &RoleSelector,
    members: &[usize],
    units: &[Unit],
    feats: &[BTreeSet<Rule>],
    total_units: usize,
    ctx: &RepoContext,
) -> Option<Draft> {
    let outer = |i: usize| {
        wraps(&units[i])
            .iter()
            .find(|w| w.kind == WrapKind::Call)
            .map(|w| norm_ref(&w.wrapper))
    };
    let mut counts: BTreeMap<std::borrow::Cow<str>, usize> = BTreeMap::new();
    for &m in members {
        if let Some(w) = outer(m) {
            *counts.entry(w).or_default() += 1;
        }
    }
    let mut alts: Vec<std::borrow::Cow<str>> = counts
        .into_iter()
        .filter(|(_, c)| *c >= 2)
        .map(|(w, _)| w)
        .collect();
    if alts.len() < 2 {
        return None;
    }
    let guards: Vec<bool> = alts
        .iter()
        .map(|w| crate::security::authenticates(ctx, w))
        .collect();
    if guards.iter().any(|g| *g) {
        let mut g = guards.iter();
        alts.retain(|_| *g.next().unwrap_or(&false));
        if alts.len() < 2 {
            return None;
        }
    }
    let set: BTreeSet<&str> = alts.iter().map(|w| w.as_ref()).collect();
    // The first slot that holds the set, outermost first.
    let slot = |i: usize| {
        wraps(&units[i])
            .iter()
            .filter(|w| w.kind == WrapKind::Call)
            .map(|w| norm_ref(&w.wrapper))
            .find(|w| set.contains(w.as_ref()))
    };
    let any_of: Vec<String> = {
        let mut v: Vec<String> = alts.iter().map(|w| w.to_string()).collect();
        v.sort();
        v
    };
    let mut shares: BTreeMap<String, usize> = BTreeMap::new();
    let mut holders: BTreeSet<usize> = BTreeSet::new();
    let mut derived: Vec<(usize, String, String)> = Vec::new();
    for &m in members {
        if let Some(w) = slot(m) {
            *shares.entry(w.into_owned()).or_default() += 1;
            holders.insert(m);
        } else if let View::Symbol(_, s) = units[m].view
            && let CallMatch::Holds(Some((wrapper, from))) = call_match(s, &any_of, ctx)
        {
            *shares.entry(norm_ref(&from).into_owned()).or_default() += 1;
            holders.insert(m);
            derived.push((m, wrapper, from));
        }
    }
    let global = feats
        .iter()
        .enumerate()
        .filter(|(i, _)| {
            units[*i].kind() == role.kind
                && wraps(&units[*i]).iter().any(|w| {
                    w.kind == WrapKind::Call && set.contains(norm_ref(&w.wrapper).as_ref())
                })
        })
        .count();
    let mut split: Vec<(String, usize)> = shares.into_iter().collect();
    split.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let mut d = consider(
        role,
        Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of,
        },
        holders,
        members,
        global,
        total_units,
        units,
        split,
    )?;
    d.derived = derived;
    Some(d)
}

/// `child` is a role below `parent`: the same package, file kind, entry and symbol
/// kind, in a directory under `parent`'s (any directory, for a package-wide parent).
fn nested_role(child: &RoleSelector, parent: &RoleSelector) -> bool {
    let package_wide = parent.dir == crate::roles::PACKAGE_WIDE;
    child.package == parent.package
        && (child.file == parent.file || package_wide)
        && child.entry == parent.entry
        && child.kind == parent.kind
        && child.export_name == parent.export_name
        && child.dir != parent.dir
        && (package_wide || parent.dir == "." || child.dir.starts_with(&format!("{}/", parent.dir)))
}

/// How deep a role's directory is: package-wide, then the package root, then one
/// level per directory.
fn role_depth(r: &RoleSelector) -> usize {
    if r.dir == crate::roles::PACKAGE_WIDE {
        0
    } else if r.dir == "." {
        1
    } else {
        2 + r.dir.matches('/').count()
    }
}

/// [`dedupe`] step 3: of nested roles with the same rule family, keep the ancestor
/// unless a descendant's bound is clearly higher (by [`CHILD_MARGIN`]), then keep the
/// descendants instead. Returns, per `(role, family, lower bound)`, whether it is kept.
///
/// Each parent is decided against all of its nearest kept descendants at once, the
/// deepest parents first, so the outcome depends on no order: with `app/a` (0.95)
/// and `app/b` (0.80) under `app` (0.85), `a` is clearly higher, so `app` is dropped
/// and both `a` and `b` are kept (nothing covers `b` any more). Deciding each pair
/// alone can drop a whole chain instead: `lib` (0.81), `lib/actions` (0.85) and
/// `lib/actions/partners` (0.87) each lose to one of the others; here `partners`
/// loses to `lib/actions`, which loses to `lib`, which is kept.
fn across_depths(items: &[(&RoleSelector, Rule, f64)]) -> Vec<bool> {
    let n = items.len();
    let related = |child: usize, parent: usize| {
        items[child].1 == items[parent].1 && nested_role(items[child].0, items[parent].0)
    };
    let mut keep = vec![true; n];
    let mut parents: Vec<usize> = (0..n).collect();
    parents.sort_by_key(|&j| std::cmp::Reverse(role_depth(items[j].0)));
    for j in parents {
        if !keep[j] {
            continue;
        }
        // The nearest kept descendants: no kept role of the family lies between.
        let kids: Vec<usize> = (0..n)
            .filter(|&i| keep[i] && related(i, j))
            .filter(|&i| {
                !(0..n).any(|k| k != i && k != j && keep[k] && related(i, k) && related(k, j))
            })
            .collect();
        if kids.is_empty() {
            continue;
        }
        if kids
            .iter()
            .any(|&i| items[i].2 >= items[j].2 + CHILD_MARGIN)
        {
            keep[j] = false;
        } else {
            for i in kids {
                keep[i] = false;
            }
        }
    }
    keep
}

/// Remove redundant drafts: identical or near-identical holder sets in a role,
/// single wrappers subsumed by a variant set, and nested roles saying the same thing.
///
/// Hysteresis ([`Keep`]): at each step, an accepted draft ([`Draft::accepted`]) that
/// would be dropped is kept, and the draft it would have given way to gives way
/// instead, unless that draft is accepted too or in the default tier
/// ([`default_tier_draft`]): a default-tier proposal is never hidden for an accepted
/// one. No other draft is kept or dropped for it.
fn dedupe(mut drafts: Vec<Draft>, units: &[Unit]) -> Vec<Draft> {
    let yields = |d: &Draft| !d.accepted && !default_tier_draft(d, units);
    // 1. Within a role, keep one rule per identical holder set (highest priority rule).
    drafts.sort_by(|a, b| {
        a.role
            .cmp(&b.role)
            .then(a.rule.priority().cmp(&b.rule.priority()))
            .then(a.rule.cmp(&b.rule))
    });
    let mut winner: BTreeMap<(RoleSelector, Vec<usize>), usize> = BTreeMap::new();
    let mut drop = vec![false; drafts.len()];
    for (i, d) in drafts.iter().enumerate() {
        let key = (d.role.clone(), d.holders.iter().copied().collect());
        match winner.get(&key) {
            None => {
                winner.insert(key, i);
            }
            Some(&w) if d.accepted => {
                if yields(&drafts[w]) {
                    drop[w] = true;
                }
            }
            Some(_) => drop[i] = true,
        }
    }
    let mut drop = drop.into_iter();
    drafts.retain(|_| !drop.next().unwrap_or(false));

    // 2. A variant set beats any of its single members in the same role.
    let sets: BTreeSet<(RoleSelector, String)> = drafts
        .iter()
        .filter_map(|d| match &d.rule {
            Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of,
            } if any_of.len() > 1 => Some(
                any_of
                    .iter()
                    .map(|a| (d.role.clone(), a.clone()))
                    .collect::<Vec<_>>(),
            ),
            _ => None,
        })
        .flatten()
        .collect();
    // An accepted single stays, and the sets that would replace it give way.
    let accepted_singles: BTreeSet<(RoleSelector, String)> = drafts
        .iter()
        .filter(|d| d.accepted)
        .filter_map(|d| match &d.rule {
            Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of,
            } if any_of.len() == 1 => Some((d.role.clone(), any_of[0].clone())),
            _ => None,
        })
        .collect();
    drafts.retain(|d| match &d.rule {
        Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of,
        } if any_of.len() == 1 => {
            d.accepted || !sets.contains(&(d.role.clone(), any_of[0].clone()))
        }
        Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of,
        } if any_of.len() > 1 => {
            !yields(d)
                || !any_of
                    .iter()
                    .any(|a| accepted_singles.contains(&(d.role.clone(), a.clone())))
        }
        _ => true,
    });

    // 3. Across depths: of two nested roles with the same rule family, keep the
    //    ancestor unless the descendant's bound is clearly higher, then keep only it.
    let family = |r: &Rule| match r {
        Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of,
        } if any_of.len() > 1 => Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: vec![],
        },
        other => other.clone(),
    };
    let items: Vec<(&RoleSelector, Rule, f64)> = drafts
        .iter()
        .map(|d| (&d.role, family(&d.rule), d.lb))
        .collect();
    let mut keep = across_depths(&items);
    rescue_across_depths(
        &items,
        &mut keep,
        &drafts.iter().map(|d| d.accepted).collect::<Vec<_>>(),
        &drafts.iter().map(|d| !yields(d)).collect::<Vec<_>>(),
    );
    let mut drafts: Vec<Draft> = drafts
        .into_iter()
        .zip(keep)
        .filter_map(|(d, k)| k.then_some(d))
        .collect();

    // 4. Within a role, rules broken by nearly the same members say the same thing:
    //    keep the strongest of any group whose outlier sets have Jaccard similarity
    //    >= NEAR_DUPLICATE. (Holder sets of strong rules always overlap heavily, so
    //    comparing them would merge unrelated rules.)
    drafts.sort_by(|a, b| {
        a.role
            .cmp(&b.role)
            .then(b.score.total_cmp(&a.score))
            .then(a.rule.cmp(&b.rule))
    });
    // A draft that gives way to an accepted one still counts here, so that it lets no
    // other draft in.
    let mut out: Vec<(Draft, bool)> = Vec::new();
    for d in drafts {
        let dups: Vec<usize> = (0..out.len())
            .filter(|&i| {
                let o = &out[i].0;
                o.role == d.role && jaccard(&outlier_set(o), &outlier_set(&d)) >= NEAR_DUPLICATE
            })
            .collect();
        if dups.is_empty() {
            out.push((d, false));
        } else if d.accepted {
            for i in dups {
                if yields(&out[i].0) {
                    out[i].1 = true;
                }
            }
            out.push((d, false));
        }
    }
    out.into_iter()
        .filter_map(|(d, dropped)| (!dropped).then_some(d))
        .collect()
}

/// Hysteresis for [`across_depths`] ([`dedupe`] step 3): an accepted item (`pinned`)
/// it dropped is kept, and every item of its family nested above or below it that it
/// kept is dropped instead, unless that item is accepted too or `protected` (in the
/// default tier). Depends on no order: the rescued items are decided from `keep` as
/// [`across_depths`] left it.
fn rescue_across_depths(
    items: &[(&RoleSelector, Rule, f64)],
    keep: &mut [bool],
    pinned: &[bool],
    protected: &[bool],
) {
    let related = |child: usize, parent: usize| {
        items[child].1 == items[parent].1 && nested_role(items[child].0, items[parent].0)
    };
    let rescued: Vec<usize> = (0..items.len())
        .filter(|&i| pinned[i] && !keep[i])
        .collect();
    if rescued.is_empty() {
        return;
    }
    let give_way: Vec<usize> = (0..items.len())
        .filter(|&j| keep[j] && !pinned[j] && !protected[j])
        .filter(|&j| rescued.iter().any(|&i| related(i, j) || related(j, i)))
        .collect();
    for i in rescued {
        keep[i] = true;
    }
    for j in give_way {
        keep[j] = false;
    }
}

/// Keep the first `cap` drafts, and any accepted one past them ([`Keep`]).
fn truncate_keeping(ds: &mut Vec<Draft>, cap: usize) {
    let mut i = 0;
    ds.retain(|d| {
        i += 1;
        i <= cap || d.accepted
    });
}

/// Whether a draft is a default-tier proposal, as [`crate::tier::tier_of`] reads its
/// rule, its role's size and its language: Python when any member is (the tier reads
/// that too, [`crate::tier::convention_language`]). Hysteresis never hides one.
fn default_tier_draft(d: &Draft, units: &[Unit]) -> bool {
    let python = d
        .members
        .iter()
        .chain(d.exempt.iter().map(|(m, _)| m))
        .any(|&m| crate::tier::language_of(&units[m].path()) == drift_core::ingest::Lang::Python);
    let lang = if python {
        drift_core::ingest::Lang::Python
    } else {
        drift_core::ingest::Lang::TypeScript
    };
    crate::tier::tier_of(&d.rule, d.role_n.unwrap_or(d.n), lang) == crate::tier::Tier::Default
}

fn outlier_set(d: &Draft) -> BTreeSet<usize> {
    d.members
        .iter()
        .copied()
        .filter(|m| !d.holders.contains(m))
        .collect()
}

fn jaccard(a: &BTreeSet<usize>, b: &BTreeSet<usize>) -> f64 {
    let inter = a.intersection(b).count();
    let union = a.len() + b.len() - inter;
    if union == 0 {
        1.0
    } else {
        inter as f64 / union as f64
    }
}

/// The example of a kept draft: the holder that satisfies the most kept conventions of
/// its role, one wrapped in the rule's own wrapper before one wrapped in a derived one.
///
/// Only a holder every convention of the role is about counts: never one exempt from
/// one of them, nor the own target of one ([`is_own_target`]). A rule holds vacuously
/// for a member it is not about ([`Rule::holds_in`]), so `BaseEmail`, exempt from
/// "extend `BaseEmail`" as its own target, would otherwise satisfy that rule and win
/// the example of "named `*Email`" over the templates that follow both. When no holder
/// is clean, a holder that is not the draft's own target; never the target itself.
fn pick_example(d: &Draft, all: &[Draft], units: &[Unit], ctx: &RepoContext) -> String {
    let role_drafts: Vec<&Draft> = all.iter().filter(|o| o.role == d.role).collect();
    let own_target = |rule: &Rule, view: &View| match view {
        View::Symbol(f, s) => is_own_target(rule, f, s),
        _ => false,
    };
    let clean = |h: usize| {
        let view = &units[h].view;
        role_drafts.iter().all(|o| {
            !o.exempt.iter().any(|(m, _)| *m == h)
                && !own_target(&o.rule, view)
                && o.rule.exemption_in(Some(&o.role), view, ctx).is_none()
                && o.rule.part_exemption(&o.role, view, ctx).is_none()
        })
    };
    let ranked = |pool: &mut dyn Iterator<Item = usize>| {
        pool.map(|h| {
            let u = &units[h];
            let score = role_drafts
                .iter()
                .filter(|o| o.rule.holds_in(Some(&d.role), &u.view, ctx))
                .count();
            let derived = d.derived.iter().any(|(m, ..)| *m == h);
            (std::cmp::Reverse(score), derived, u.key())
        })
        .min()
        .map(|(_, _, k)| k)
    };
    ranked(&mut d.holders.iter().copied().filter(|&h| clean(h)))
        .or_else(|| {
            ranked(
                &mut d
                    .holders
                    .iter()
                    .copied()
                    .filter(|&h| !own_target(&d.rule, &units[h].view)),
            )
        })
        .unwrap_or_default()
}

/// The parent folder of a role's `dir` (`.` for a folder at the package root).
fn parent_dir(dir: &str) -> &str {
    dir.rsplit_once('/').map_or(".", |(p, _)| p)
}

/// Two plain roles are siblings ([`merge_siblings`]): the same package, entry, symbol
/// kind, variety, reserved export name and member kind, and either sibling folders (the
/// same parent folder and file kind) or sibling file kinds (the same folder, two file
/// kinds, neither `*`). Never a package-wide role, the package root, a model or a
/// package role, or a merged one.
fn sibling_roles(a: &RoleSelector, b: &RoleSelector) -> bool {
    let plain = |r: &RoleSelector| {
        r.also.is_empty()
            && !matches!(r.kind, SymbolKind::Model | SymbolKind::Package)
            && r.dir != crate::roles::PACKAGE_WIDE
            && r.dir != "."
    };
    plain(a)
        && plain(b)
        && a.package == b.package
        && a.entry == b.entry
        && a.kind == b.kind
        && a.variety == b.variety
        && a.export_name == b.export_name
        && a.member_kind == b.member_kind
        && ((a.file == b.file && a.dir != b.dir && parent_dir(&a.dir) == parent_dir(&b.dir))
            || (a.dir == b.dir && a.file != b.file && a.file != "*" && b.file != "*"))
}

/// The members a draft's role holds: those its rule is about and those it leaves out.
fn role_units(d: &Draft) -> BTreeSet<usize> {
    d.members
        .iter()
        .chain(d.exempt.iter().map(|(m, _)| m))
        .copied()
        .collect()
}

/// One card for the same rule on sibling roles ([`sibling_roles`]): "HTTP handlers in
/// `leads/**` and `cases/**` are wrapped in `HasOrgContext()`" instead of a card per
/// folder. The merged card's role is the least of the parts' roles (in their order) with
/// the others, sorted, in [`RoleSelector::also`], so its id ([`convention_id`]) depends
/// only on which roles it covers, never on their sizes; a role that covers no sibling
/// keeps its id. Its members, holders, outliers, exempt members, inherited and derived
/// holders are the parts' together, and its evidence is counted on the union: the
/// Wilson lower bound of all holders over all members, and the lift of that rate over
/// the rule's rate among all units of the symbol kind (the parts share it). Its example
/// is the example of the part with the most holders (the least id on a tie).
///
/// Merged only when every part was drafted on its own evidence with that rate
/// ([`draft_of`]), holds no variant split, and the parts' members do not overlap; when
/// the union still clears [`MIN_LOWER_BOUND`] and the rule's minimum lift; and when every
/// part is in the suggestion tier: default-tier cards are never merged [STRICT]. Nor does
/// a merge make one: the union has the parts' rule, package names and language, and the
/// tier's only other condition, the role's size, holds already for any TypeScript call
/// wrapper part, since none with fewer members clears the lower bound. Hysteresis ([`Keep`]): a convention accepted on
/// its own is never merged, and an accepted merged card is formed again from its parts
/// when all of them are drafted (else they stay apart). Siblings group transitively
/// (three sibling folders, one card); groups are formed in the order of `kept`, and the
/// merged card takes the place of its first part.
fn merge_siblings(
    kept: &[Draft],
    units: &[Unit],
    ctx: &RepoContext,
    keep: &Keep,
) -> Vec<Candidate> {
    let finished: Vec<Candidate> = kept.iter().map(|d| finish(d, kept, units, ctx)).collect();
    let n = kept.len();
    let mergeable = |i: usize| {
        let d = &kept[i];
        d.split.is_empty()
            && d.base.is_some_and(|b| b > 0.0)
            && !d.rule.is_wiring()
            && finished[i].tier() == crate::tier::Tier::Suggestion
    };
    let mut group: Vec<Option<usize>> = vec![None; n];
    let mut groups: Vec<Vec<usize>> = Vec::new();
    // Accepted merged cards first, from exactly their parts.
    for (role, rule) in &keep.merged {
        let parts: Option<Vec<usize>> = role
            .parts()
            .iter()
            .map(|p| {
                (0..n).find(|&i| {
                    group[i].is_none()
                        && &kept[i].role == p
                        && &kept[i].rule == rule
                        && mergeable(i)
                })
            })
            .collect();
        if let Some(parts) = parts {
            for &i in &parts {
                group[i] = Some(groups.len());
            }
            groups.push(parts);
        }
    }
    let free = |i: usize, group: &[Option<usize>]| {
        group[i].is_none() && mergeable(i) && !keep.accepted_alone(&kept[i])
    };
    for i in 0..n {
        if !free(i, &group) {
            continue;
        }
        // The siblings of the group so far, transitively, in the order of `kept`.
        let mut members = vec![i];
        let mut units_of = role_units(&kept[i]);
        let mut changed = true;
        while changed {
            changed = false;
            for j in i + 1..n {
                if members.contains(&j) || !free(j, &group) || kept[j].rule != kept[i].rule {
                    continue;
                }
                let theirs = role_units(&kept[j]);
                if members
                    .iter()
                    .any(|&m| sibling_roles(&kept[m].role, &kept[j].role))
                    && units_of.is_disjoint(&theirs)
                {
                    members.push(j);
                    units_of.extend(theirs);
                    changed = true;
                }
            }
        }
        if members.len() > 1 {
            for &m in &members {
                group[m] = Some(groups.len());
            }
            groups.push(members);
        }
    }
    let mut merged: BTreeMap<usize, Candidate> = BTreeMap::new();
    let mut absorbed: BTreeSet<usize> = BTreeSet::new();
    for parts in &groups {
        if let Some(c) = merged_card(parts, kept, &finished) {
            let first = *parts.iter().min().expect("a group has parts");
            merged.insert(first, c);
            absorbed.extend(parts.iter().copied());
        }
    }
    finished
        .into_iter()
        .enumerate()
        .filter_map(|(i, c)| match merged.remove(&i) {
            Some(m) => Some(m),
            None if absorbed.contains(&i) => None,
            None => Some(c),
        })
        .collect()
}

/// The card [`merge_siblings`] makes of `parts` (indices into `kept`), or `None` when
/// the union fails a condition there.
fn merged_card(parts: &[usize], kept: &[Draft], finished: &[Candidate]) -> Option<Candidate> {
    let first = &kept[parts[0]];
    let base = first.base?;
    if parts
        .iter()
        .any(|&i| kept[i].base.is_none_or(|b| (b - base).abs() > 1e-12))
    {
        return None;
    }
    let mut roles: Vec<RoleSelector> = parts.iter().map(|&i| kept[i].role.clone()).collect();
    roles.sort();
    let mut role = roles[0].clone();
    role.also = roles[1..].to_vec();
    let holders: usize = parts.iter().map(|&i| finished[i].evidence.holders).sum();
    let total: usize = parts.iter().map(|&i| finished[i].evidence.total).sum();
    let role_size: usize = parts
        .iter()
        .map(|&i| finished[i].evidence.role_size())
        .sum();
    if total == 0 {
        return None;
    }
    let lb = wilson_lower_bound(holders, total);
    let lift = (holders as f64 / total as f64) / base;
    if lb < MIN_LOWER_BOUND || lift < first.rule.min_lift() {
        return None;
    }
    let python: usize = parts
        .iter()
        .map(|&i| finished[i].evidence.python_members.unwrap_or(0))
        .sum();
    let collect = |f: &dyn Fn(&Candidate) -> Vec<Outlier>| {
        let mut v: Vec<Outlier> = parts.iter().flat_map(|&i| f(&finished[i])).collect();
        v.sort();
        v
    };
    let mut exempt: Vec<Exempt> = parts
        .iter()
        .flat_map(|&i| finished[i].exempt.clone())
        .collect();
    exempt.sort();
    let mut derived: Vec<DerivedHolder> = parts
        .iter()
        .flat_map(|&i| finished[i].derived.clone())
        .collect();
    derived.sort();
    // The example of the part with the most holders, the least id on a tie.
    let example = parts
        .iter()
        .map(|&i| &finished[i])
        .min_by(|a, b| {
            b.evidence
                .holders
                .cmp(&a.evidence.holders)
                .then_with(|| a.id.cmp(&b.id))
        })
        .map(|c| c.example.clone())
        .unwrap_or_default();
    let entry = first.role.entry != "-";
    let risk = if entry
        && matches!(
            first.rule,
            Rule::WrappedBy {
                kind: WrapKind::Call | WrapKind::Decorator,
                ..
            }
        ) {
        1.5
    } else {
        1.0
    };
    let score = lb * size_weight(role_size) * lift.min(5.0) * first.rule.specificity() * risk;
    Some(Candidate {
        id: convention_id(&role, &first.rule),
        role,
        rule: first.rule.clone(),
        evidence: Evidence {
            holders,
            total,
            lower_bound: r3(lb),
            lift: r3(lift),
            split: vec![],
            role_members: (role_size != total).then_some(role_size),
            python_members: (python > 0).then_some(python),
        },
        score: r3(score),
        example,
        outliers: collect(&|c| c.outliers.clone()),
        can_block: role_size >= MIN_BLOCK_ROLE_SIZE,
        wiring: None,
        exempt,
        inherited: collect(&|c| c.inherited.clone()),
        derived,
    })
}

fn finish(d: &Draft, all: &[Draft], units: &[Unit], ctx: &RepoContext) -> Candidate {
    let example = pick_example(d, all, units, ctx);
    let mut outliers: Vec<Outlier> = d
        .members
        .iter()
        .filter(|m| !d.holders.contains(m))
        .map(|&m| Outlier {
            path: units[m].path(),
            symbol: units[m].name().to_string(),
            line: units[m].line(),
        })
        .collect();
    outliers.sort();
    Candidate {
        id: convention_id(&d.role, &d.rule),
        role: d.role.clone(),
        rule: d.rule.clone(),
        evidence: Evidence {
            holders: d.holders.len(),
            total: d.n,
            lower_bound: r3(d.lb),
            lift: r3(d.lift),
            split: d.split.clone(),
            role_members: d.role_n,
            // Over the whole role: the members the rule is about and the exempt ones.
            python_members: Some(
                d.members
                    .iter()
                    .chain(d.exempt.iter().map(|(m, _)| m))
                    .filter(|&&m| {
                        crate::tier::language_of(&units[m].path())
                            == drift_core::ingest::Lang::Python
                    })
                    .count(),
            )
            .filter(|&n| n > 0),
        },
        score: r3(d.score),
        example,
        outliers,
        can_block: d.role_n.unwrap_or(d.n) >= MIN_BLOCK_ROLE_SIZE,
        exempt: {
            let mut e: Vec<Exempt> = d
                .exempt
                .iter()
                .map(|(m, why)| Exempt {
                    path: units[*m].path(),
                    symbol: units[*m].name().to_string(),
                    line: units[*m].line(),
                    code: why.code.clone(),
                    reason: why.reason.clone(),
                })
                .collect();
            e.sort();
            e
        },
        inherited: {
            let mut v: Vec<Outlier> = d
                .inherited
                .iter()
                .map(|&m| Outlier {
                    path: units[m].path(),
                    symbol: units[m].name().to_string(),
                    line: units[m].line(),
                })
                .collect();
            v.sort();
            v
        },
        wiring: None,
        derived: {
            let mut v: Vec<DerivedHolder> = d
                .derived
                .iter()
                .map(|(m, wrapper, from)| DerivedHolder {
                    path: units[*m].path(),
                    symbol: units[*m].name().to_string(),
                    line: units[*m].line(),
                    wrapper: wrapper.clone(),
                    from: from.clone(),
                })
                .collect();
            v.sort();
            v
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn role(dir: &str) -> RoleSelector {
        RoleSelector {
            package: String::new(),
            dir: dir.into(),
            file: "*".into(),
            entry: "server_action".into(),
            kind: SymbolKind::Function,
            variety: None,
            export_name: None,
            member_kind: None,
            shape: None,
            also: vec![],
        }
    }

    /// Which of `(dir, lower bound)` [`across_depths`] keeps, in every input order.
    fn kept(roles: &[(&str, f64)]) -> Vec<String> {
        let family = Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: vec![],
        };
        let rs: Vec<RoleSelector> = roles.iter().map(|(d, _)| role(d)).collect();
        let mut seen: Option<Vec<String>> = None;
        let mut order: Vec<usize> = (0..roles.len()).collect();
        for _ in 0..roles.len() {
            order.rotate_left(1);
            let items: Vec<(&RoleSelector, Rule, f64)> = order
                .iter()
                .map(|&i| (&rs[i], family.clone(), roles[i].1))
                .collect();
            let keep = across_depths(&items);
            let mut out: Vec<String> = order
                .iter()
                .zip(keep)
                .filter(|(_, k)| *k)
                .map(|(&i, _)| roles[i].0.to_string())
                .collect();
            out.sort();
            if let Some(s) = &seen {
                assert_eq!(s, &out, "order-dependent");
            }
            seen = Some(out);
        }
        seen.unwrap_or_default()
    }

    /// A repo of `n` exported functions, one per file under `src/`, and its units.
    fn function_repo(n: usize) -> RepoFacts {
        let mut r = RepoFacts {
            files: (0..n)
                .map(|i| FileFacts {
                    path: format!("src/f{i:02}.ts"),
                    lang: "ts".into(),
                    parse_ok: true,
                    symbols: vec![Symbol {
                        name: format!("f{i}"),
                        kind: SymbolKind::Function,
                        exported_as: vec![format!("f{i}")],
                        line: 1,
                        ..Default::default()
                    }],
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        r.normalize();
        r
    }

    /// [`cap_shown`]: without `hidden` it is the old pair of caps (layering share, then
    /// per repo); with it, hidden drafts take no slot and are kept as the old caps keep
    /// them.
    #[test]
    fn the_caps_count_shown_drafts_only() {
        let named = |i: usize| {
            let mut d = draft(
                Rule::Named {
                    pattern: format!("*X{i}"),
                },
                &[0],
                10,
                100.0 - i as f64,
                false,
            );
            d.origin = format!("N{i}");
            d
        };
        let avoid = |i: usize| {
            let mut d = draft(
                Rule::Avoids {
                    signal: format!("s{i}"),
                },
                &[0],
                10,
                50.0 - i as f64,
                false,
            );
            d.origin = format!("A{i}");
            d
        };
        let ids = |ds: &[Draft]| ds.iter().map(|d| d.origin.clone()).collect::<Vec<_>>();
        // 6 named drafts, then 6 avoid drafts; a cap of 8 keeps at most 2 avoids.
        let all = || -> Vec<Draft> { (0..6).map(named).chain((0..6).map(avoid)).collect() };
        let drops = |ds: &[(Draft, CapDrop)]| {
            ds.iter()
                .map(|(d, c)| (d.origin.clone(), *c))
                .collect::<Vec<_>>()
        };
        let mut old = all();
        let dropped = cap_shown(&mut old, 8, None);
        assert_eq!(ids(&old), ["N0", "N1", "N2", "N3", "N4", "N5", "A0", "A1"]);
        // Each dropped draft is reported with the cap that dropped it (the funnel's
        // `cap_avoid` and `cap_repo`).
        assert_eq!(
            drops(&dropped),
            ["A2", "A3", "A4", "A5"].map(|o| (o.to_string(), CapDrop::Avoid))
        );
        let mut many: Vec<Draft> = (0..10).map(named).collect();
        let dropped = cap_shown(&mut many, 8, None);
        assert_eq!(ids(&many), ["N0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"]);
        assert_eq!(
            drops(&dropped),
            ["N8", "N9"].map(|o| (o.to_string(), CapDrop::Repo))
        );
        // N0..N3 and A0 become hidden cards: they keep their old place, and take no slot.
        let hidden: BTreeSet<String> = ["N0", "N1", "N2", "N3", "A0"].map(String::from).into();
        let mut new = all();
        cap_shown(&mut new, 8, Some(&hidden));
        assert_eq!(
            ids(&new),
            ["N0", "N1", "N2", "N3", "N4", "N5", "A0", "A1", "A2"],
            "the shown drafts fill the slots: N4 N5, and two avoids A1 A2 (the share)"
        );
        // A hidden draft past the old caps stays out.
        let late: BTreeSet<String> = ["A5"].map(String::from).into();
        let mut l = all();
        cap_shown(&mut l, 8, Some(&late));
        assert_eq!(ids(&l), ids(&old));
    }

    /// A draft of `rule` on `src/**` functions (`members` of them; `holders` hold it).
    fn draft(rule: Rule, holders: &[usize], members: usize, score: f64, accepted: bool) -> Draft {
        let mut role = role("src");
        role.entry = "-".into();
        Draft {
            role,
            rule,
            holders: holders.iter().copied().collect(),
            n: members,
            lb: 0.8,
            lift: 2.0,
            split: vec![],
            score,
            members: (0..members).collect(),
            exempt: vec![],
            inherited: vec![],
            derived: vec![],
            role_n: None,
            base: Some(0.4),
            accepted,
            origin: String::new(),
        }
    }

    fn call(targets: &[&str]) -> Rule {
        Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: targets.iter().map(|t| t.to_string()).collect(),
        }
    }

    fn rules(ds: &[Draft]) -> Vec<Rule> {
        let mut v: Vec<Rule> = ds.iter().map(|d| d.rule.clone()).collect();
        v.sort();
        v
    }

    /// Hysteresis in [`dedupe`]: at each step the accepted draft stays and the one it
    /// would have given way to gives way, unless that one is in the default tier.
    #[test]
    fn dedupe_keeps_accepted_drafts_at_each_step() {
        let repo = function_repo(20);
        let units = crate::roles::units(&repo, &FileKinds::learn(&repo));
        let holders: Vec<usize> = (1..10).collect();
        let calls = Rule::Calls {
            callee: "src/lib.ts#track".into(),
        };
        // 1. Identical holder sets: the wrapper rule (first by priority) wins...
        let pair = |acc: bool, members: usize| {
            vec![
                draft(call(&["src/w.ts#a"]), &holders, members, 1.0, false),
                draft(calls.clone(), &holders, members, 1.0, acc),
            ]
        };
        assert_eq!(
            rules(&dedupe(pair(false, 10), &units)),
            [call(&["src/w.ts#a"])]
        );
        // ...unless the other is accepted: then it stays and the wrapper gives way...
        assert_eq!(
            rules(&dedupe(pair(true, 10), &units)),
            std::slice::from_ref(&calls)
        );
        // ...except a default-tier wrapper (20 members), which stays beside it.
        let both = dedupe(pair(true, 20), &units);
        assert_eq!(both.len(), 2);

        // 2. A variant set beats its single member, unless the single is accepted.
        let set = |acc: bool, members: usize| {
            vec![
                draft(call(&["src/w.ts#a"]), &[1, 2, 3], members, 1.0, acc),
                draft(
                    call(&["src/w.ts#a", "src/w.ts#b"]),
                    &holders,
                    members,
                    1.0,
                    false,
                ),
            ]
        };
        assert_eq!(
            rules(&dedupe(set(false, 10), &units)),
            [call(&["src/w.ts#a", "src/w.ts#b"])]
        );
        assert_eq!(
            rules(&dedupe(set(true, 10), &units)),
            [call(&["src/w.ts#a"])]
        );
        assert_eq!(dedupe(set(true, 20), &units).len(), 2);

        // 4. Near-identical outlier sets (10 and 11 of 30, Jaccard 10/11): the higher
        // score wins, unless the other is accepted.
        let extends = |t: &str| Rule::WrappedBy {
            kind: WrapKind::Extends,
            any_of: vec![t.into()],
        };
        let near = |acc: bool| {
            vec![
                draft(
                    extends("src/b.ts#A"),
                    &(10..30).collect::<Vec<_>>(),
                    30,
                    2.0,
                    false,
                ),
                draft(
                    extends("src/b.ts#B"),
                    &(11..30).collect::<Vec<_>>(),
                    30,
                    1.0,
                    acc,
                ),
            ]
        };
        let repo = function_repo(30);
        let units = crate::roles::units(&repo, &FileKinds::learn(&repo));
        assert_eq!(rules(&dedupe(near(false), &units)), [extends("src/b.ts#A")]);
        assert_eq!(rules(&dedupe(near(true), &units)), [extends("src/b.ts#B")]);
    }

    /// The caps keep an accepted draft past them, and take no other draft's place.
    #[test]
    fn caps_keep_accepted_drafts_past_them() {
        let mut ds: Vec<Draft> = (0..6)
            .map(|i| draft(call(&[&format!("src/w.ts#w{i}")]), &[1], 10, 1.0, i == 5))
            .collect();
        truncate_keeping(&mut ds, 3);
        let kept: Vec<Rule> = ds.iter().map(|d| d.rule.clone()).collect();
        assert_eq!(
            kept,
            [
                call(&["src/w.ts#w0"]),
                call(&["src/w.ts#w1"]),
                call(&["src/w.ts#w2"]),
                call(&["src/w.ts#w5"])
            ]
        );
    }

    /// [`rescue_across_depths`] depends on no order.
    #[test]
    fn rescued_depths_are_decided_whatever_the_order() {
        let family = call(&[]);
        let roles = [role("app"), role("app/a"), role("app/b")];
        // `app` wins over both; `app/a` is accepted.
        let lbs = [0.85, 0.86, 0.80];
        let mut seen: Option<Vec<String>> = None;
        let mut order: Vec<usize> = (0..3).collect();
        for _ in 0..3 {
            order.rotate_left(1);
            let items: Vec<(&RoleSelector, Rule, f64)> = order
                .iter()
                .map(|&i| (&roles[i], family.clone(), lbs[i]))
                .collect();
            let mut keep = across_depths(&items);
            let pinned: Vec<bool> = order.iter().map(|&i| i == 1).collect();
            rescue_across_depths(&items, &mut keep, &pinned, &[false; 3]);
            let mut out: Vec<String> = order
                .iter()
                .zip(keep)
                .filter(|(_, k)| *k)
                .map(|(&i, _)| roles[i].dir.clone())
                .collect();
            out.sort();
            if let Some(s) = &seen {
                assert_eq!(s, &out, "order-dependent");
            }
            seen = Some(out);
        }
        // The accepted child stays, the parent gives way, and `app/b` (dropped for the
        // parent) is not brought back.
        assert_eq!(seen.unwrap(), ["app/a"]);
    }

    #[test]
    fn nested_roles_are_decided_whatever_the_order() {
        // Two roles: the ancestor unless the descendant is clearly higher.
        assert_eq!(kept(&[("app", 0.85), ("app/a", 0.88)]), ["app"]);
        assert_eq!(kept(&[("app", 0.85), ("app/a", 0.95)]), ["app/a"]);
        // Siblings: one clearly higher drops the parent, and the other is kept too.
        assert_eq!(
            kept(&[("app", 0.85), ("app/a", 0.95), ("app/b", 0.80)]),
            ["app/a", "app/b"]
        );
        // A chain where each pair alone drops all three (dub's `lib/actions` sets).
        assert_eq!(
            kept(&[
                ("lib", 0.81),
                ("lib/actions", 0.85),
                ("lib/actions/partners", 0.87)
            ]),
            ["lib"]
        );
        // A grandchild clearly higher than both keeps only itself.
        assert_eq!(
            kept(&[("lib", 0.80), ("lib/x", 0.82), ("lib/x/y", 0.95)]),
            ["lib/x/y"]
        );
    }

    #[test]
    fn builder_chains_are_keyed_by_binding_and_terminal_method() {
        let key = |w: &str| {
            let (k, steps) = builder_key(w);
            (k, steps.into_iter().collect::<Vec<_>>())
        };
        assert_eq!(
            key("lib/a.ts#client.inputSchema().action"),
            (
                "lib/a.ts#client.action".to_string(),
                vec!["inputSchema".to_string()]
            )
        );
        assert_eq!(
            key("lib/a.ts#client.action"),
            ("lib/a.ts#client.action".to_string(), vec![])
        );
        // The binding's own path and other calls stay; only additive steps go.
        assert_eq!(
            key("lib/t.ts#t.procedure.use().input()"),
            (
                "lib/t.ts#t.procedure".to_string(),
                vec!["use".to_string(), "input".to_string()]
            )
        );
        // Metadata is no additive step: `.meta()` stays in the key.
        assert_eq!(
            key("lib/t.ts#authed.meta().query").0,
            "lib/t.ts#authed.meta().query"
        );
        assert_eq!(
            key("lib/a.ts#client.unstable_skip().action").0,
            "lib/a.ts#client.unstable_skip().action"
        );
        // A binding named like a step is still the binding.
        assert_eq!(key("lib/a.ts#use").0, "lib/a.ts#use");
        assert_eq!(
            key("pkg:@x/y/z#client.schema().action").0,
            "pkg:@x/y#client.action"
        );
    }

    #[test]
    fn chains_take_the_rules_steps_with_multiplicity_and_its_middleware_in_place() {
        let v = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let lacks = |want: &[&str], have: &[&str], own: bool| chain_lacks(&v(want), &v(have), own);
        // No middleware in the rule: a multiset, in any order, with extra steps.
        assert_eq!(
            lacks(&["inputSchema"], &["use", "inputSchema"], false),
            Some(vec![])
        );
        assert_eq!(
            lacks(&["input", "output"], &["output", "input"], true),
            Some(vec![])
        );
        assert_eq!(
            lacks(&["input", "input"], &["input"], true),
            Some(v(&["input"]))
        );
        assert_eq!(
            lacks(&["inputSchema"], &[], true),
            Some(v(&["inputSchema"]))
        );
        // Middleware in the rule: only the member's own chain with exactly the same steps.
        assert_eq!(
            lacks(&["use", "inputSchema"], &["use", "inputSchema"], true),
            Some(vec![])
        );
        // N4: anonymous inline middleware takes no extra step and exempts nothing.
        assert_eq!(
            lacks(
                &["use", "inputSchema"],
                &["use", "inputSchema", "use"],
                true
            ),
            None
        );
        assert_eq!(lacks(&["use", "inputSchema"], &["use"], true), None);
        // C2: one `.use()` for the rule's two.
        assert_eq!(
            lacks(
                &["use", "use", "inputSchema"],
                &["use", "inputSchema"],
                true
            ),
            None
        );
        // B2: the order of a middleware step matters.
        assert_eq!(
            lacks(&["use", "inputSchema"], &["inputSchema", "use"], true),
            None
        );
        // A2, E3: a `.use()` of a binding the wrapper is built on stands for nothing.
        assert_eq!(
            lacks(&["use", "inputSchema"], &["use", "inputSchema"], false),
            None
        );
        assert_eq!(lacks(&["use"], &["use"], false), None);
        assert_eq!(lacks(&["concat"], &["use"], true), None);
    }

    #[test]
    fn wilson_matches_reference_values() {
        // Values from the plan's review: 7/8 -> ~0.53, 40/43 -> ~0.81, 19/20 -> ~0.76.
        assert!((wilson_lower_bound(7, 8) - 0.529).abs() < 0.005);
        assert!((wilson_lower_bound(40, 43) - 0.814).abs() < 0.005);
        assert!((wilson_lower_bound(19, 20) - 0.764).abs() < 0.005);
        assert_eq!(wilson_lower_bound(0, 0), 0.0);
    }

    #[test]
    fn wilson_upper_bound_is_the_twin() {
        // 0/170 -> ~0.022; 9/9 -> 1; symmetric with the lower bound.
        assert!((wilson_upper_bound(0, 170) - 0.022).abs() < 0.001);
        assert!((wilson_upper_bound(9, 9) - 1.0).abs() < 1e-9);
        for (k, n) in [(3, 10), (7, 8), (40, 43)] {
            let twin = 1.0 - wilson_lower_bound(n - k, n);
            assert!((wilson_upper_bound(k, n) - twin).abs() < 1e-9);
        }
        assert_eq!(wilson_upper_bound(0, 0), 1.0);
    }

    #[test]
    fn guards_from_configuration_are_not_features() {
        let file = FileFacts::default();
        let s = drift_core::Symbol {
            wraps: vec![
                drift_core::Wrap {
                    wrapper: "pkg:rest_framework#permissions.IsAuthenticated".into(),
                    kind: WrapKind::Config,
                },
                drift_core::Wrap {
                    wrapper: "app/auth.py#require_scope".into(),
                    kind: WrapKind::Call,
                },
            ],
            ..Default::default()
        };
        let rules: Vec<Rule> = features(&View::Symbol(&file, &s), &RepoContext::default())
            .into_iter()
            .filter(|r| matches!(r, Rule::WrappedBy { .. }))
            .collect();
        assert_eq!(
            rules,
            [Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of: vec!["app/auth.py#require_scope".into()],
            }]
        );
    }

    #[test]
    fn size_weight_is_integer_log() {
        assert_eq!(size_weight(7), 4.0);
        assert_eq!(size_weight(8), 4.0);
        assert_eq!(size_weight(43), 6.0);
    }
}
