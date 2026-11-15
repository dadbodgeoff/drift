//! What an answer of absence rests on: `none` (authentication, authorization) and
//! `internal` (exposure) are statements of what Drift found in what it read, never
//! statements about the code. In open-world code no finite list of constructs proves
//! an absence, so each such answer carries its [`Basis`]: what was read, and what Drift
//! saw and did not read, so a person or an agent knows where to look.
//!
//! The basis is collected from what the readings already hold (the bodies an entry
//! point runs, the calls they make, the files the scan skipped, the deployment
//! descriptions recognised and not read); nothing here reads the code a second way,
//! and nothing here changes an answer. An empty [`Basis::not_read`] is not proof
//! either: the words still say "in what Drift read".
//!
//! Every surface words an answer of absence through the functions below
//! ([`none`], [`no_guard`], [`internal`], [`identified`]), so the CLI, the hooks, the
//! MCP tools, the cards and the annotations say one thing.

use std::collections::BTreeSet;

use drift_core::{Symbol, WrapKind};
use serde::{Deserialize, Serialize};

use super::common::{self, external};
use super::{Cx, UnitRef};
use crate::report::sanitize;

/// What an answer of absence rests on (`practices --json --units`: a unit whose
/// assignment is `none`; `security --json`: an entry point with no guard, or one that
/// is `internal`). Additive.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Basis {
    /// The bodies read for the answer: the handler's own and those followed.
    pub bodies: usize,
    /// The functions and methods of the repository followed from the entry point
    /// (its wrappers, its middleware, what its bodies call), by canonical name,
    /// sorted. Omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub followed: Vec<String>,
    /// The deployment descriptions read for an exposure (a compose file,
    /// `.drift/config.yaml`), sorted. Omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub descriptions: Vec<String>,
    /// What Drift saw and did not read, sorted. Empty when it can list nothing, which
    /// proves nothing either.
    pub not_read: Vec<NotRead>,
}

/// One thing Drift saw and did not read ([`Basis::not_read`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct NotRead {
    /// What it is ([`kind`]).
    pub kind: String,
    /// The canonical reference, the file or the construct.
    pub what: String,
    /// Why it was not read, in words.
    pub why: String,
}

/// The kinds of [`NotRead`], a closed list.
pub mod kind {
    /// A package's function no list of Drift's has an entry for: its body is not
    /// read, and nothing says what it does.
    pub const PACKAGE_FUNCTION: &str = "package_function";
    /// A body of the repository that was not followed: past the depth the reading
    /// follows.
    pub const DEPTH_LIMIT: &str = "depth_limit";
    /// A construct the facts mark and do not model (a call they do not record, a
    /// refusal on a condition they could not read).
    pub const NOT_MODELLED: &str = "not_modelled";
    /// A deployment description recognised and not read, or left out by a person.
    pub const DESCRIPTION: &str = "description";
    /// A file Drift saw and did not read or classify (skipped by the scan, not parsed,
    /// a description it did not recognise).
    pub const FILE: &str = "file";
}

/// Why a package's function with no entry is not read.
const NO_ENTRY: &str = "a package's function no list of Drift's has an entry for";
/// Why a body past the depth limit is not read.
const PAST_DEPTH: &str = "a body not followed: past the depth the reading follows";

impl Basis {
    pub fn add(&mut self, kind: &str, what: &str, why: &str) {
        self.not_read.push(NotRead {
            kind: kind.to_string(),
            what: what.to_string(),
            why: why.to_string(),
        });
    }

    /// Sorts and de-duplicates every list.
    pub fn finish(mut self) -> Self {
        self.followed.sort();
        self.followed.dedup();
        self.descriptions.sort();
        self.descriptions.dedup();
        self.not_read.sort();
        self.not_read.dedup();
        self
    }

    /// The union of several bases' unread items (a variant's members), sorted.
    pub fn union<'b>(bases: impl IntoIterator<Item = &'b Basis>) -> Vec<NotRead> {
        let set: BTreeSet<&NotRead> = bases.into_iter().flat_map(|b| &b.not_read).collect();
        set.into_iter().cloned().collect()
    }
}

// ---------- the words ----------

/// What every answer of absence says it rests on.
pub const IN_WHAT_DRIFT_READ: &str = "in what Drift read";
/// The label of an authentication unit with no guard found.
pub const AUTHN_NONE: &str = "no guard found in what Drift read";
/// The label of an authentication unit whose wrappers were read and turn no one away.
pub const AUTHN_NONE_WRAPPED: &str =
    "no guard found in what Drift read (what wraps it turns no one away)";
/// The label of an authorization unit with no check found.
pub const AUTHZ_NONE: &str = "no role check, tenant scope or owner scope found in what Drift read";
/// The identity a `none` variant had before its label said what it rests on: its key
/// is `none:<identity>` and its P- id is hashed from that key, so `.drift/config.yaml`,
/// `drift.lock`, saved answers and links that name it keep naming it. The label is
/// display only. A label with no older identity is its own.
pub fn none_identity(label: &str) -> &str {
    match label {
        AUTHN_NONE => "no guard, nothing opens it",
        AUTHN_NONE_WRAPPED => "no guard",
        AUTHZ_NONE => "no role check, no tenant scope, no owner scope",
        other => other,
    }
}

/// Unread items named in a short line before "and N more".
const NAMED: usize = 2;

/// One unread item, short: `require_scope from company_auth`, `api/big.py (too large)`.
pub fn short(n: &NotRead) -> String {
    let s = match n.kind.as_str() {
        kind::PACKAGE_FUNCTION => {
            let r = crate::mine::norm_ref(&n.what);
            match r.strip_prefix("pkg:").and_then(|r| r.split_once('#')) {
                Some((package, path)) => {
                    let name = path.rsplit('.').next().unwrap_or(path);
                    format!("{name} from {package}")
                }
                None => n.what.clone(),
            }
        }
        kind::DEPTH_LIMIT => {
            let name = common::short(&n.what);
            format!("{name} (not followed)")
        }
        _ if n.why.is_empty() => n.what.clone(),
        kind::FILE | kind::DESCRIPTION => format!("{} ({})", n.what, short_why(&n.why)),
        _ => n.what.clone(),
    };
    sanitize(&s, 120)
}

/// The reason of a file or description, in a few words: the part before a colon.
fn short_why(why: &str) -> &str {
    why.split([':', ',']).next().unwrap_or(why).trim()
}

/// `2 not read: a, b`, `5 not read: a, b and 3 more`; "" when nothing is listed.
pub fn not_read_list(not_read: &[NotRead]) -> String {
    list_across(not_read, 1)
}

/// [`not_read_list`] of what `units` units' readings saw and did not read together:
/// `5 not read across 3 units: a, b and 3 more`; as [`not_read_list`] for one unit.
fn list_across(not_read: &[NotRead], units: usize) -> String {
    if not_read.is_empty() {
        return String::new();
    }
    let named: Vec<String> = not_read.iter().take(NAMED).map(short).collect();
    let more = match not_read.len().saturating_sub(NAMED) {
        0 => String::new(),
        n => format!(" and {n} more"),
    };
    let across = if units > 1 {
        format!(" across {units} units")
    } else {
        String::new()
    };
    format!(
        "{} not read{across}: {}{more}",
        not_read.len(),
        named.join(", ")
    )
}

/// ` (2 not read)`; "" when nothing is listed.
pub fn not_read_count(not_read: &[NotRead]) -> String {
    if not_read.is_empty() {
        String::new()
    } else {
        format!(" ({} not read)", not_read.len())
    }
}

/// A `none` answer of the practice map: `none: no guard found in what Drift read (2
/// not read: require_scope from company_auth, views.py (too large))`. `label` is the
/// variant's.
pub fn none(label: &str, not_read: &[NotRead]) -> String {
    none_across(label, not_read, 1)
}

/// A `none` answer said of `units` units at once (a variant, a file's units): what
/// their readings saw and did not read together, and how many units that covers:
/// `none: no guard found in what Drift read (3 not read across 2 units: a, b and 1
/// more)`. As [`none`] for one unit. `not_read` must be of those units only: one
/// unit's line never names what another unit's reading did not read.
pub fn none_across(label: &str, not_read: &[NotRead], units: usize) -> String {
    format!("none: {}", found_none_across(label, not_read, units))
}

/// [`none_across`] without its `none: `: `no guard found in what Drift read (3 not read
/// across 2 units: a, b and 1 more)`, for a sentence that says `none` itself.
pub fn found_none_across(label: &str, not_read: &[NotRead], units: usize) -> String {
    let label = if label.contains(IN_WHAT_DRIFT_READ) {
        label.to_string()
    } else {
        format!("{label} {IN_WHAT_DRIFT_READ}")
    };
    match list_across(not_read, units).as_str() {
        "" => label,
        list => format!("{label} ({list})"),
    }
}

/// What a listing says where an entry point's guards would be named and none was
/// found: `no guard found in what Drift read (2 not read)`.
pub fn no_guard(not_read: &[NotRead]) -> String {
    format!("{AUTHN_NONE}{}", not_read_count(not_read))
}

/// An `internal` exposure: `internal in what Drift read (compose service api publishes
/// no ports; 1 not read: k8s/api.yaml (...))`.
pub fn internal(boundary: Option<&str>, not_read: &[NotRead]) -> String {
    let parts: Vec<String> = boundary
        .map(|b| sanitize(b, 240))
        .into_iter()
        .chain(Some(not_read_list(not_read)).filter(|s| !s.is_empty()))
        .collect();
    if parts.is_empty() {
        format!("internal {IN_WHAT_DRIFT_READ}")
    } else {
        format!("internal {IN_WHAT_DRIFT_READ} ({})", parts.join("; "))
    }
}

/// Authentication that identifies the caller and turns no one away:
/// `identified by SessionAuthentication, turns no one away`.
pub fn identified(by: &[String]) -> String {
    let names: Vec<String> = by
        .iter()
        .map(|i| {
            let n = common::short(i);
            sanitize(n.rsplit('.').next().unwrap_or(n), 80)
        })
        .collect();
    if names.is_empty() {
        "identified, turns no one away".to_string()
    } else {
        format!("identified by {}, turns no one away", names.join(", "))
    }
}

// ---------- the collection ----------

/// Controls of a body that mark a construct the facts do not model, with words.
const NOT_MODELLED: &[(&str, &str)] = &[
    (
        drift_core::controls::UNREAD_CALL,
        "hands a value to a call the facts do not record",
    ),
    (
        drift_core::controls::UNREAD_EXIT,
        "turns some requests away on a condition the facts do not record",
    ),
    (
        drift_core::controls::LATE_BOUND,
        "a name bound later than its definition",
    ),
    (
        drift_core::controls::METADATA_UNREAD,
        "metadata the facts do not read",
    ),
];

/// Adds what `body` (named `name`) does that the facts mark and do not model.
fn not_modelled(b: &mut Basis, name: &str, controls: &[String]) {
    for (control, words) in NOT_MODELLED {
        if controls.iter().any(|c| c == control) {
            b.add(kind::NOT_MODELLED, &format!("{name}: {words}"), words);
        }
    }
}

/// A package's export no list of Drift's has an entry for: not the runtime, not the
/// Python standard library, on no guard list, no list of what never authenticates, and
/// no vocabulary of the practice map (data, logging, validation, configuration,
/// tracing, error reports, HTTP clients).
pub fn unlisted_package(canonical: &str) -> bool {
    let r = crate::mine::norm_ref(
        canonical
            .trim_end_matches("(ref)")
            .trim_end_matches("(new)"),
    )
    .into_owned();
    let Some(rest) = r.strip_prefix("pkg:") else {
        return false;
    };
    if rest.starts_with(common::PYTHON_STDLIB) || rest.starts_with("node:") {
        return false;
    }
    use super::libraries as l;
    let listed = crate::py_guards::listed_export(&r)
        || !matches!(
            drift_core::guard_lists::library(&r, None),
            drift_core::guard_lists::Library::Unlisted
        )
        || drift_core::guard_lists::listed_guard(&r)
        || crate::security::library_guard(&r)
        || l::authn_callee(&r)
        || l::data_library(&r).is_some()
        || l::logger_library(&r).is_some()
        || l::validation_library(&r).is_some()
        || l::config_library(&r).is_some()
        || l::flag_library(&r).is_some()
        || l::tracer(&r)
        || l::error_reporter(&r)
        || l::framework_error(&r)
        || common::package_root(&r).is_some_and(|p| {
            l::HTTP_CLIENT_LIBRARIES.contains(&p.as_str())
                || l::AUTHN_LIBRARIES.contains(&p.as_str())
                || crate::mine::LIBRARY_GROUPS
                    .iter()
                    .any(|(_, members)| members.contains(&p.as_str()))
                || FRAMEWORKS.contains(&p.as_str())
        });
    !listed
}

/// Packages that serve routes, whose own functions the adapters read (a response, a
/// redirect, a router): never an unread function of an entry point.
const FRAMEWORKS: &[&str] = &[
    "next",
    "react",
    "react-dom",
    "express",
    "@nestjs/common",
    "@nestjs/core",
    "hono",
    "fastify",
    "koa",
    "@trpc/server",
    "@remix-run/node",
    "@sveltejs/kit",
    "fastapi",
    "starlette",
    "django",
    "rest_framework",
    "flask",
];

/// The skipped and unparsed source files of `dir` (the whole repository for ""),
/// tests aside: an entry point, a guard or a scope in one is not read.
pub fn skipped_in(cx: &Cx<'_>, dir: &str) -> Vec<NotRead> {
    use drift_core::SkipReason;
    let inside = |p: &str| dir.is_empty() || p.starts_with(&format!("{dir}/"));
    let mut out: Vec<NotRead> = cx
        .facts
        .skipped
        .iter()
        .filter(|s| {
            !matches!(s.reason, SkipReason::Declaration | SkipReason::Generated)
                && !crate::roles::is_test_path(&s.path)
                && inside(&s.path)
        })
        .map(|s| NotRead {
            kind: kind::FILE.to_string(),
            what: s.path.clone(),
            why: format!(
                "skipped by the scan: {}",
                serde_json::to_value(s.reason)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .unwrap_or_default()
                    .replace('_', " ")
            ),
        })
        .collect();
    out.extend(
        cx.facts
            .files
            .iter()
            .filter(|f| !f.parse_ok && !crate::roles::is_test_path(&f.path) && inside(&f.path))
            .map(|f| NotRead {
                kind: kind::FILE.to_string(),
                what: f.path.clone(),
                why: "not parsed: its facts are not read".to_string(),
            }),
    );
    out
}

/// A definition a call of `r` runs a body of: a function, a method, or a class built
/// (its constructor), not an error class only raised, nor a value (a logger, a
/// compiled pattern) whose method is a library's.
fn runs(d: &Symbol, r: &str) -> bool {
    use drift_core::SymbolKind;
    match d.kind {
        SymbolKind::Function => true,
        SymbolKind::Class => {
            let name = common::short(r);
            match name.split_once('.') {
                Some((_, method)) => d.members.iter().any(|m| m.name == method),
                None => !(name.ends_with("Error") || name.ends_with("Exception")),
            }
        }
        _ => false,
    }
}

/// What an entry point's authentication was read from, and what was seen and not read
/// ([`super::authn`]'s reading: the handler's bodies, the wrappers and middleware around
/// it, and what they call, which the guard reading follows one call deep from each
/// callee). The same basis on both surfaces: the practice map's `none` and `drift
/// security`'s row with no guard.
pub fn of_entry<'a>(cx: &Cx<'a>, unit: &UnitRef<'a>) -> Basis {
    let mut b = Basis::default();
    let Some((sfile, s)) = common::unit_symbol(cx, unit) else {
        return b;
    };
    let ctx = cx.context();
    let classes = common::owning_classes(sfile, s);
    let bodies = common::bodies(cx, s);
    b.bodies = bodies.len();
    let mut followed: BTreeSet<String> = BTreeSet::new();
    let mut level: Vec<(String, &'a Symbol)> = bodies
        .iter()
        .map(|d| (format!("{}#{}", sfile.path, d.name), *d))
        .collect();
    // The wrappers and middleware around the handler: their definitions are read.
    let around: Vec<String> = unit
        .mount_wraps()
        .iter()
        .chain(&s.wraps)
        .chain(classes.iter().flat_map(|c| &c.wraps))
        .filter(|w| !matches!(w.kind, WrapKind::Jsx | WrapKind::Try))
        .map(|w| w.wrapper.clone())
        .chain(
            s.app_middleware
                .iter()
                .chain(unit.mount_middleware())
                .map(|m| m.trim_start_matches('?').to_string()),
        )
        .collect();
    for w in &around {
        let r = crate::mine::norm_ref(w.trim_end_matches("(ref)")).into_owned();
        if external(&r) {
            if unlisted_package(&r) {
                b.add(kind::PACKAGE_FUNCTION, &r, NO_ENTRY);
            }
        } else if let Some(d) = ctx.definition(&r)
            && followed.insert(r.clone())
        {
            level.push((r, d));
        }
    }
    // Three levels: the bodies and what is around them, what they call, and what
    // those call (read one call deep by the guard reading); what the last level calls
    // in the repository is past the depth.
    for depth in 0..3 {
        let mut next: Vec<(String, &'a Symbol)> = Vec::new();
        for (name, body) in &level {
            not_modelled(&mut b, name, &body.controls);
            for c in body.calls.iter().chain(&body.receiver_calls) {
                let c = c.trim_start_matches('?');
                let r =
                    crate::mine::norm_ref(c.trim_end_matches("(ref)").trim_end_matches("(new)"))
                        .into_owned();
                if external(&r) {
                    if unlisted_package(&r) {
                        b.add(kind::PACKAGE_FUNCTION, &r, NO_ENTRY);
                    }
                    continue;
                }
                if bodies
                    .iter()
                    .any(|x| format!("{}#{}", sfile.path, x.name) == r)
                    || followed.contains(&r)
                {
                    continue;
                }
                let Some(d) = ctx.definition(&r).filter(|d| runs(d, &r)) else {
                    continue;
                };
                if depth == 2 {
                    b.add(kind::DEPTH_LIMIT, &r, PAST_DEPTH);
                } else {
                    followed.insert(r.clone());
                    next.push((r, d));
                }
            }
        }
        level = next;
    }
    b.bodies += followed.len();
    b.followed = followed.into_iter().collect();
    b.not_read.extend(skipped_in(cx, &sfile.package));
    b.finish()
}
