//! `drift security`: an inventory of security-relevant facts.
//!
//! Drift prescribes no security rules. This module lists what the code does
//! (entry points and their guards, risky operations they reach, server code and
//! secrets reachable from client code, environment reads) so a person can review
//! it, and so mining can learn which roles consistently avoid or guard them.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;

use drift_core::{FileFacts, RepoFacts, Symbol, WrapKind};
use serde::Serialize;

use crate::gateway::{self, Gateway, Route, Target};
use crate::roles::{NonProduction, is_test_path};
use crate::vocab::grant;
use crate::vocab::refuse::names_access_control;

/// Suffix of a guard that is a hook the whole app runs.
pub const APP_HOOK: &str = " (app hook)";

/// How many internal call hops are followed from an entry point to a sink.
pub const MAX_HOPS: usize = 4;
/// Sinks whose risk depends on request data; these are followed through calls.
/// Others (weak hashes, cookie flags, CORS) are reported where they are written.
pub const INPUT_SINKS: &[&str] = &[
    "eval",
    "shell_exec",
    "raw_html",
    "raw_sql",
    "sql_string_interpolation",
    "dynamic_redirect",
    "dynamic_fetch",
    "unsafe_deserialize",
    "path_traversal",
    "template_injection",
    "nosql_injection",
    "mass_assignment",
    "dynamic_regex",
    "dynamic_key_write",
];

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct SinkUse {
    pub kind: String,
    pub path: String,
    pub symbol: String,
    pub line: u32,
    /// The operation is given a value read off a parameter of the function it is in
    /// ([`drift_core::controls::SINK_FED`]): of a handler, what the request sent.
    /// Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fed: bool,
}

/// What a row says of an operation that is given a value read off a parameter.
pub const FED: &str = " (fed by a parameter)";

/// The symbol's operation of this kind is given a value read off a parameter of
/// its function ([`drift_core::controls::SINK_FED`]).
fn sink_fed(s: &Symbol, kind: &str) -> bool {
    use drift_core::controls::{SINK_FED, SINK_FED_MADE};
    s.controls.iter().any(|c| {
        c.strip_prefix(SINK_FED_MADE)
            .or_else(|| c.strip_prefix(SINK_FED))
            .is_some_and(|k| k == kind)
    })
}

/// The facts of a body that say what it does with its parameters: a symbol's
/// controls, or a method's own ([`drift_core::Member::unread`]).
fn flow_facts<'a>(node: &Node<'a>) -> &'a [String] {
    node.member.map_or(&node.symbol.controls, |m| &m.unread)
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Reach {
    pub kind: String,
    /// Internal call chain from the entry point to the symbol with the sink, inclusive.
    pub via: Vec<String>,
    /// The operation is given a value read off a parameter of the function it is in
    /// ([`SinkUse::fed`]). Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fed: bool,
}

/// Where an entry point is reachable from, as far as the repository says. Ordered as
/// listings sort them: internet-facing first, then unknown (it may be), then internal.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Exposure {
    /// Reachable from the internet.
    Public,
    /// Nothing in the repository says.
    #[default]
    Unknown,
    /// Reachable only from inside the deployment (behind a gateway or a private network).
    Internal,
}

impl Exposure {
    pub fn as_str(self) -> &'static str {
        match self {
            Exposure::Public => "internet-facing",
            Exposure::Internal => "internal",
            Exposure::Unknown => "unknown",
        }
    }
}

/// One registration written as a route is that Drift did not list
/// ([`Inventory::unlisted`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Unlisted {
    pub path: String,
    pub line: u32,
    /// A function that reads a request and answers it, and that no listed entry
    /// point reaches ([`unreached_handlers`]): its name. Empty for a registration
    /// found where it is written. Not serialised when empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub symbol: String,
}

/// The share of the entry points that query one thing and filter it by a value of
/// the caller, from which the ones that filter it by none are listed ([`ScopeGap`]).
pub const SCOPE_GAP_SHARE: f64 = 0.7;
/// The fewest entry points that must query the thing for that to be said.
pub const SCOPE_GAP_MIN: usize = 5;

/// One entry point named in a [`ScopeGap`].
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct ScopeRef {
    pub path: String,
    pub symbol: String,
    pub line: u32,
    pub kind: String,
    pub method: Option<String>,
    pub route: Option<String>,
}

/// What the repository does to keep callers to their own rows, learned from the
/// repository and from nothing else: most of the entry points that query one thing
/// (`resource`: what the query is called on, as the facts name it) give the query a
/// value of the caller under one key (`key`: `where.userId`), and some query it and
/// give it no value of the caller under any key. The exceptions are facts to look
/// at, not verdicts: an administrator's route, a job and a lookup that a check
/// follows are among them.
///
/// No list says which key scopes or which thing holds rows: the key is whichever
/// one the repository's own queries fill with the caller's value, and the thing is
/// whatever they are called on.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct ScopeGap {
    pub resource: String,
    pub key: String,
    /// The entry points that query the resource: those that filter it by the key,
    /// the exceptions, and those whose filter was not read.
    pub members: usize,
    pub scoped: usize,
    /// The entry points that query it and filter it by no value of the caller.
    pub exceptions: Vec<ScopeRef>,
    /// The entry points that query it with a filter whose value Drift could not read
    /// (`unread`): whether it is the caller's is unknown, so they are no exception,
    /// listed apart. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown: Vec<ScopeRef>,
    /// The first entry point (by path) that filters it by the key: one to copy from.
    pub example: ScopeRef,
}

/// A side of [`drift_core::controls::FILTER_VALUE`] that says nothing of where the
/// value comes from: what the lowering could not read, or a call it could not
/// resolve. A filter by it may be the caller's.
fn side_unread(side: &str) -> bool {
    side.is_empty() || side == "unread" || side.contains("unresolved:")
}

#[cfg(test)]
mod side_unread_tests {
    /// Pins what a scope gap holds apart: a filter by a side that says nothing of
    /// where the value comes from may be the caller's, so it is no exception.
    #[test]
    fn a_side_that_says_nothing_of_its_source_is_unread() {
        assert!(super::side_unread(""));
        assert!(super::side_unread("unread"));
        assert!(super::side_unread("call unresolved:getOrg"));
        assert!(!super::side_unread("param"));
        assert!(!super::side_unread("caller"));
    }
}

/// What a query is called on: the callee without its last member
/// (`src/db.ts#prisma.note.findMany` -> `src/db.ts#prisma.note`). None for a callee
/// that is called on nothing (a function).
fn queried(callee: &str) -> Option<&str> {
    let (_, path) = callee.split_once('#')?;
    let cut = path.trim_end_matches("()").rfind('.')?;
    (cut > 0).then(|| &callee[..callee.len() - path.len() + cut])
}

/// [`ScopeGap`]s of the repository: for each request entry point, what the bodies it
/// reaches query and what they filter by a value of the caller
/// ([`drift_core::controls::FILTER_VALUE`]); then, for each thing queried, the key
/// most of them filter it by and the entry points that filter it by none.
fn scope_gaps<'a>(
    repo: &'a RepoFacts,
    index: &Index<'a>,
    cx: &crate::practices::Cx<'a>,
) -> Vec<ScopeGap> {
    struct Seen {
        at: ScopeRef,
        queried: BTreeSet<String>,
        scoped: BTreeSet<(String, String)>,
        /// What it queries with a filter whose value was not read ([`side_unread`]).
        unread: BTreeSet<String>,
    }
    let mut entries: Vec<Seen> = Vec::new();
    for f in &repo.files {
        if is_test_path(&f.path) {
            continue;
        }
        for e in &f.entry_points {
            if !crate::practices::REQUEST_KINDS.contains(&e.kind.as_str()) || e.kind == "job" {
                continue;
            }
            let Some((origin, s)) = crate::entries::entry_symbol(repo, f, e) else {
                continue;
            };
            let mut seen = Seen {
                at: ScopeRef {
                    path: f.path.clone(),
                    symbol: e.symbol.clone(),
                    line: s.line,
                    kind: e.kind.clone(),
                    method: e.method.clone(),
                    route: e.route.clone(),
                },
                queried: BTreeSet::new(),
                scoped: BTreeSet::new(),
                unread: BTreeSet::new(),
            };
            for node in index.reach_nodes((origin, s)) {
                let args = node.member.map_or(&node.symbol.args, |m| &m.args);
                for a in args {
                    // `<callee>@<index>:<key path>`: a call given an object.
                    if let Some((callee, _)) = a.rsplit_once('@')
                        && let Some(r) = queried(callee)
                    {
                        seen.queried.insert(r.to_string());
                    }
                }
                for fact in flow_facts(&node) {
                    let Some(rest) = fact.strip_prefix(drift_core::controls::FILTER_VALUE) else {
                        continue;
                    };
                    let parts: Vec<&str> = rest.split('\t').collect();
                    let [callee, key, side] = parts.as_slice() else {
                        continue;
                    };
                    let Some(r) = queried(callee) else { continue };
                    seen.queried.insert(r.to_string());
                    if crate::practices::side_is_callers(cx, side) {
                        seen.scoped.insert((r.to_string(), key.to_string()));
                    } else if side_unread(side) {
                        seen.unread.insert(r.to_string());
                    }
                }
            }
            if !seen.queried.is_empty() {
                entries.push(seen);
            }
        }
    }
    // Each thing queried, and the keys it is filtered by with the caller's value.
    let mut keys: BTreeMap<&str, BTreeMap<&str, usize>> = BTreeMap::new();
    for e in &entries {
        for (r, k) in &e.scoped {
            *keys.entry(r).or_default().entry(k).or_default() += 1;
        }
    }
    let mut out = Vec::new();
    for (resource, by_key) in keys {
        // The key most of them use; the first by name where two tie.
        let Some((key, _)) = by_key.iter().max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0))) else {
            continue;
        };
        let with: Vec<&Seen> = entries
            .iter()
            .filter(|e| e.scoped.iter().any(|(r, k)| r == resource && k == key))
            .collect();
        let unscoped = |e: &&Seen| {
            e.queried.contains(resource) && !e.scoped.iter().any(|(r, _)| r == resource)
        };
        // Unknown is never an exception: a filter whose value was not read may be
        // the caller's.
        let mut exceptions: Vec<ScopeRef> = entries
            .iter()
            .filter(unscoped)
            .filter(|e| !e.unread.contains(resource))
            .map(|e| e.at.clone())
            .collect();
        let mut unknown: Vec<ScopeRef> = entries
            .iter()
            .filter(unscoped)
            .filter(|e| e.unread.contains(resource))
            .map(|e| e.at.clone())
            .collect();
        // Counted as before: what was not read neither makes a gap nor hides one.
        let members = with.len() + exceptions.len() + unknown.len();
        if exceptions.is_empty()
            || members < SCOPE_GAP_MIN
            || (with.len() as f64) < SCOPE_GAP_SHARE * members as f64
        {
            continue;
        }
        exceptions.sort();
        unknown.sort();
        let Some(example) = with.iter().map(|e| &e.at).min().cloned() else {
            continue;
        };
        out.push(ScopeGap {
            resource: resource.to_string(),
            key: key.to_string(),
            members,
            scoped: with.len(),
            exceptions,
            unknown,
            example,
        });
    }
    out.sort();
    out
}

/// The functions of production code that read what a request sent and answer it
/// (a response built in their own body), and that nothing listed reaches: no entry
/// point is one, calls one through any number of the repository's own calls, or
/// runs one as a wrapper, a decorator or a middleware. Whatever serves such a
/// function, Drift did not list it: a route of a framework it has no adapter for, a
/// handler registered where it does not read. Said by what the function does, never
/// by a name or a framework, so it holds for any of them.
///
/// Not a function the inventory would not list as an entry point either: a method
/// of a class, a test, demonstration code.
fn unreached_handlers(
    repo: &RepoFacts,
    index: &Index<'_>,
    non_production: &NonProduction,
) -> Vec<Unlisted> {
    use drift_core::controls::READS_INPUT;
    let shaped = |s: &Symbol| {
        s.kind == drift_core::SymbolKind::Function
            && !s.responses.is_empty()
            && s.controls.iter().any(|c| c == READS_INPUT)
    };
    let production = |f: &FileFacts| {
        !is_test_path(&f.path) && non_production.dir_of(&f.path, &f.package).is_none()
    };
    if !repo
        .files
        .iter()
        .any(|f| production(f) && f.symbols.iter().any(shaped))
    {
        return Vec::new();
    }
    // What the entry points reach: themselves, what runs around them, and every
    // function of the repository any of those calls.
    let mut reached: BTreeSet<String> = BTreeSet::new();
    let mut queue: VecDeque<Node> = VecDeque::new();
    let mut around: Vec<&str> = Vec::new();
    for f in &repo.files {
        for e in &f.entry_points {
            let Some((origin, s)) = crate::entries::entry_symbol(repo, f, e) else {
                continue;
            };
            let node = index.start(origin, s);
            if reached.insert(node.key()) {
                queue.push_back(node);
            }
            reached.insert(format!("{}#{}", origin.path, s.name));
            around.extend(s.wraps.iter().map(|w| w.wrapper.as_str()));
            around.extend(s.app_middleware.iter().map(String::as_str));
            around.extend(s.decorator_args.iter().map(String::as_str));
        }
        around.extend(
            f.mounts
                .iter()
                .flat_map(|m| m.wraps.iter().map(|w| w.wrapper.as_str())),
        );
        around.extend(
            f.mounts
                .iter()
                .flat_map(|m| m.app_middleware.iter().map(String::as_str)),
        );
    }
    for a in around {
        if let Some(node) = index.target(a)
            && reached.insert(node.key())
        {
            queue.push_back(node);
        }
    }
    while let Some(node) = queue.pop_front() {
        for c in node.calls() {
            // A function written in a value and listed under the value's name
            // (`Handler.show` of a constructor that assigns it on `this`, of an
            // object) is reached by the reference that names it.
            let named = crate::mine::norm_ref(c);
            reached.insert(
                named
                    .trim_end_matches("(ref)")
                    .trim_end_matches("()")
                    .to_string(),
            );
            if let Some(next) = index.target(c)
                && reached.insert(next.key())
            {
                // A class reached is reached with its methods' own callees.
                queue.push_back(next);
            }
        }
    }
    let mut out = Vec::new();
    for f in repo.files.iter().filter(|f| production(f)) {
        // A file that lists entry points of its own is read: what it holds beside
        // them is theirs to reach or a helper.
        if !f.entry_points.is_empty() {
            continue;
        }
        for s in f.symbols.iter().filter(|s| shaped(s)) {
            let key = format!("{}#{}", f.path, s.name);
            if !reached.contains(&key) {
                out.push(Unlisted {
                    path: f.path.clone(),
                    line: s.line,
                    symbol: s.name.clone(),
                });
            }
        }
    }
    out
}

/// Where an entry point that reaches a risky operation stands in the list a person
/// reads top down ([`render_at`]): the guard (none found, not read, a guard), then
/// where it is reachable from (internet-facing, unknown, internal), then whether an
/// operation it reaches is fed by what a request sent ([`INPUT_SINKS`]). Lower
/// first. A rank, not a verdict: it orders facts and judges none.
fn review_rank(e: &EntryRow) -> (u8, Exposure, bool, bool) {
    let guard = match (e.guards.is_empty(), e.opaque.is_empty()) {
        _ if e.local => 3,
        (true, true) => 0,
        (true, false) => 1,
        (false, _) => 2,
    };
    let input = e
        .reaches
        .iter()
        .any(|r| INPUT_SINKS.contains(&r.kind.as_str()));
    // Before all of that kind: one where the operation is given a value read off a
    // parameter, which for a handler is what the request sent.
    let fed = e.reaches.iter().any(|r| r.fed);
    (guard, e.exposure, !fed, !input)
}

/// One directory and what the repository says about its exposure.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct BoundaryRule {
    /// Repo-relative directory, no trailing slash; "" is the whole repository.
    pub dir: String,
    pub exposure: Exposure,
    /// Where this comes from: `config security.internal`, or
    /// `compose service api publishes ports`.
    pub source: String,
}

/// The deployment boundary, read from the repository: `security:` in
/// `.drift/config.yaml` ([`crate::policy::SecuritySettings`], what a person says) and
/// the compose files ([`COMPOSE_FILES`], at any depth to [`COMPOSE_DEPTH`]: a service
/// that publishes `ports` is public, one that does not is internal, and its `build`
/// directory, relative to the compose file, is the code it runs). Config wins over
/// compose; between rules, the longest directory wins. Behind an nginx gateway whose
/// configuration is read, a compose rule gives way to the gateway route by route
/// ([`Boundaries::expose`]). A route in an internal
/// service with no guard of its own is still listed as having none: the boundary is
/// named next to it, not used to hide it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Boundaries {
    /// Sorted by directory.
    pub rules: Vec<BoundaryRule>,
    /// Files that could not be read or parsed, so their part of the boundary is unknown.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    /// Deployment descriptions Drift recognises and does not read, by kind
    /// ([`unread_kind`]): while there is one, nothing is said to be internal.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unread: Vec<Unread>,
    /// The compose files `security.not_deployed` leaves out, each read apart: what it
    /// would have said of a route is said with the route.
    #[serde(skip)]
    left_out: Vec<(String, Boundaries)>,
    /// The compose files read, by the name of each stack ([`Basis::descriptions`] of an
    /// internal verdict).
    ///
    /// [`Basis::descriptions`]: crate::practices::basis::Basis::descriptions
    #[serde(skip)]
    read: Vec<String>,
    /// What was seen and not read around the boundary: descriptions of a kind Drift
    /// does not read (any left out by `security.not_deployed` among them) and YAML files
    /// it did not recognise ([`Deployments::seen`]), as unread items of a basis.
    #[serde(skip)]
    not_read: Vec<crate::practices::basis::NotRead>,
    /// The code directories a person tied to a target group of the repository's
    /// Terraform (`security.terraform`), each with what its listener rules say
    /// ([`crate::terraform`]).
    #[serde(skip)]
    tied: Vec<crate::terraform::Tied>,
    /// The gateways whose routing is read, each with the compose file it is in.
    #[serde(skip)]
    gateways: Vec<(String, Gateway)>,
    /// The services behind them: their routes are decided one by one
    /// ([`Boundaries::expose`]).
    #[serde(skip)]
    behind: Vec<Behind>,
    /// Directories a compose file says are reachable, or may be, as a whole (its
    /// service sits behind a gateway that is not read location by location): no route
    /// of them is decided on its own, whatever another compose file's gateway routes.
    #[serde(skip)]
    whole: BTreeSet<String>,
    /// The application objects of the repository ([`Boundaries::set_apps`]).
    #[serde(skip)]
    apps: Option<BTreeMap<(String, String), Vec<String>>>,
    /// The applications of the repository that may be asked from outside and share a
    /// network with a service: whether one only calls it or may relay requests to
    /// it is read from its code ([`Boundaries::set_relays`]).
    #[serde(skip)]
    callers: Vec<Caller>,
    /// The compose files left out on an agent's word alone
    /// ([`crate::policy::SecuritySettings::on_agents_word`]), with the boundary as it
    /// is without them: a route they would make reachable only from inside reads
    /// unknown ([`inventory_with`]). Serialised where there is one, so what is kept
    /// of an inventory changes with it; [`inventory_with`] takes it out.
    #[serde(skip_serializing_if = "Option::is_none")]
    cautious: Option<(Vec<String>, Box<Boundaries>)>,
    /// The symbols a person declared in `.drift/config.yaml` `practices:`, which the
    /// inventory reads as the practice map does ([`crate::policy::DriftConfig::practices`]).
    #[serde(skip)]
    declared: crate::practices::Declared,
    /// Whose word each of them rests on ([`crate::policy::DriftConfig::declared_by`]).
    #[serde(skip)]
    declared_by: BTreeMap<String, String>,
}

/// An application built from the repository (`client`, its code in `from`) that can
/// reach the compose service `service` (its code in `dir`) and is not itself known
/// to be internal.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Caller {
    compose: String,
    client: String,
    from: String,
    service: String,
    dir: String,
    /// The client's compose definition names the service as a host.
    named: bool,
    /// The names the service answers to.
    names: Vec<String>,
    root: std::path::PathBuf,
}

/// A compose service of a file whose gateways are all read ([`Gateway`]).
#[derive(Debug, Clone, PartialEq, Eq)]
struct Behind {
    /// Its code directory, as its rule has it.
    dir: String,
    service: String,
    compose: String,
    published: bool,
    /// Why a route of it is never said to be internal, whatever the gateway routes:
    /// its network mode.
    caveat: Option<String>,
    /// The repository root, when a location proxies to the service: where a root path
    /// given to its app is looked for.
    root: Option<std::path::PathBuf>,
    /// The application object its start command serves: the file and the name
    /// ([`Started::target`]).
    target: Option<(String, String)>,
    /// Its start command serves a Next.js application.
    next: bool,
    /// Why what it starts with, or the environment it is given, could not be read: a
    /// root path may be set there.
    unread_start: Option<String>,
    /// Its env files that are not in the repository: an internal verdict for a route
    /// of it is reached past them, and says so.
    absent_env: Vec<String>,
    /// The other services of the file that name it and cannot proxy: they call it,
    /// which lets no request of theirs through ([`relay`]). Said with an internal
    /// verdict.
    clients: Vec<String>,
}

/// Names of the compose files read ([`compose_files`]).
pub const COMPOSE_FILES: &[&str] = &[
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml",
];

/// How deep below the root compose files are looked for (the root's own files are at
/// depth 1).
pub const COMPOSE_DEPTH: usize = 6;

/// The deployment descriptions of a repository.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Deployments {
    /// The compose files, repo-relative with `/`, sorted.
    pub compose: Vec<String>,
    /// The descriptions Drift recognises and does not read: the kind and the file.
    pub unread: Vec<(String, String)>,
    /// The YAML files looked at that are neither: no compose file and no kind Drift
    /// recognises, with why (`not recognised`, `too large to look into`). One may still
    /// describe a deployment Drift does not know: an `internal` verdict says so.
    pub seen: Vec<(String, String)>,
}

/// The compose files under `root`: see [`deployments`].
pub fn compose_files(root: &Path) -> Vec<String> {
    deployments(root).compose
}

/// The largest YAML file looked into to tell what it is.
const MAX_DESCRIPTION: u64 = 1024 * 1024;

/// The deployment descriptions under `root`, to [`COMPOSE_DEPTH`]. Hidden
/// directories, `node_modules` and what `.gitignore` leaves out are not entered.
///
/// A compose file is known by its name ([`COMPOSE_FILES`], [`COMPOSE_OVERRIDES`]) or
/// by its content ([`crate::compose::is_compose`]: any YAML file with a `services`
/// mapping of services), so that a stack kept under another name
/// (`docker-compose.e2e.yml`, `stack.yml`) is read too.
///
/// What says who can reach a service in a form Drift does not read is listed apart
/// ([`unread_kind`]): its presence alone keeps anything from being called internal.
pub fn deployments(root: &Path) -> Deployments {
    let walker = ignore::WalkBuilder::new(root)
        .max_depth(Some(COMPOSE_DEPTH))
        .follow_links(false)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .filter_entry(|e| {
            !(e.file_type().is_some_and(|t| t.is_dir()) && e.file_name() == "node_modules")
        })
        .build();
    let mut out = Deployments::default();
    for e in walker
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
    {
        let Some(name) = e.file_name().to_str() else {
            continue;
        };
        let Ok(rel) = e.path().strip_prefix(root) else {
            continue;
        };
        let parts: Option<Vec<&str>> = rel.components().map(|c| c.as_os_str().to_str()).collect();
        let Some(rel) = parts.map(|p| p.join("/")) else {
            continue;
        };
        let yaml = name.ends_with(".yml") || name.ends_with(".yaml");
        if yaml && (COMPOSE_FILES.contains(&name) || COMPOSE_OVERRIDES.contains(&name)) {
            out.compose.push(rel);
            continue;
        }
        let text = (yaml || name == "app.json" || read_for_description(name))
            .then(|| {
                std::fs::metadata(e.path())
                    .ok()
                    .filter(|m| m.len() <= MAX_DESCRIPTION)
                    .and_then(|_| std::fs::read_to_string(e.path()).ok())
            })
            .flatten();
        if yaml
            && text
                .as_deref()
                .is_some_and(|t| crate::compose::is_compose(name, t))
        {
            out.compose.push(rel);
        } else if let Some(kind) = unread_kind(name, text.as_deref()) {
            out.unread.push((kind.to_string(), rel));
        } else if yaml {
            let why = if text.is_some() {
                "a YAML file Drift did not recognise as a deployment description"
            } else {
                "a YAML file too large to look into, or not readable"
            };
            out.seen.push((rel, why.to_string()));
        }
    }
    out.compose.sort();
    out.unread.sort();
    out.seen.sort();
    out
}

/// The kind of deployment description a file is, when it is one Drift recognises
/// and does not read: by its name, or for a YAML file by what its `text` holds. The
/// list to extend. A file of one of these kinds may route requests to any service of
/// the repository, so nothing is said to be internal while one is there and is not
/// left out (`security.not_deployed`).
pub fn unread_kind(name: &str, text: Option<&str>) -> Option<&'static str> {
    let line = |start: &str| text.is_some_and(|t| t.lines().any(|l| l.starts_with(start)));
    // A platform's file that sends requests somewhere else than the application of
    // its own directory (a rewrite to another host or service, a build of code in
    // another directory) describes infrastructure, as Terraform does.
    if let Some(kind) = routes_elsewhere(name, text) {
        return Some(kind);
    }
    match name {
        "Chart.yaml" => return Some("Helm"),
        "fly.toml" => return Some("Fly.io"),
        "render.yaml" => return Some("Render"),
        "Procfile" => return Some("Procfile"),
        "netlify.toml" => return Some("Netlify"),
        "vercel.json" => return Some("Vercel"),
        "terragrunt.hcl" => return Some("Terraform"),
        "serverless.yml" | "serverless.yaml" => return Some("Serverless"),
        "Pulumi.yaml" | "Pulumi.yml" => return Some("Pulumi"),
        _ => {}
    }
    if let Some(kind) =
        described_by_name(name).or_else(|| text.and_then(|t| described_by_content(name, t)))
    {
        return Some(kind);
    }
    if name.ends_with(".tf") || name.ends_with(".tf.json") {
        return Some("Terraform");
    }
    if name.ends_with(".nomad") || name.ends_with(".nomad.hcl") {
        return Some("Nomad");
    }
    if line("apiVersion:") && line("kind:") {
        return Some("Kubernetes");
    }
    if line("AWSTemplateFormatVersion") || text.is_some_and(|t| t.contains("Type: AWS::")) {
        return Some("CloudFormation");
    }
    if name == "app.yaml" && line("runtime:") {
        return Some("App Engine");
    }
    None
}

/// A file whose text [`deployments`] reads to tell whether it describes a
/// deployment, besides YAML: any JSON file (a CloudFormation or SAM template, an
/// ARM template, an OpenAPI document of an API gateway, a Kubernetes manifest, an
/// ECS task definition, a `package.json` that depends on an infrastructure library),
/// the TOML files of platforms, and Python dependency lists.
fn read_for_description(name: &str) -> bool {
    name.ends_with(".json")
        || name.ends_with(".jsonc")
        || matches!(
            name,
            "fly.toml" | "netlify.toml" | "wrangler.toml" | "pyproject.toml" | "Pipfile"
        )
        || (name.starts_with("requirements") && name.ends_with(".txt"))
}

/// The deployment descriptions known by their file name alone ([`unread_kind`]).
fn described_by_name(name: &str) -> Option<&'static str> {
    let yaml = |stem: &str| name == format!("{stem}.yaml") || name == format!("{stem}.yml");
    Some(match name {
        _ if name.ends_with(".bicep") || name.ends_with(".bicepparam") => "Bicep",
        "cdk.json" => "CDK",
        "cdktf.json" => "CDK for Terraform",
        "samconfig.toml" | "samconfig.yaml" | "samconfig.yml" => "SAM",
        "wrangler.toml" | "wrangler.json" | "wrangler.jsonc" => "Cloudflare Workers",
        "railway.json" | "railway.toml" => "Railway",
        "Dockerrun.aws.json" => "Elastic Beanstalk",
        "serverless.ts" | "serverless.js" | "serverless.json" => "Serverless",
        "firebase.json" => "Firebase",
        "Kustomization" => "Kubernetes",
        _ if name.starts_with("Pulumi.") && (name.ends_with(".yaml") || name.ends_with(".yml")) => {
            "Pulumi"
        }
        _ if yaml("apprunner") => "App Runner",
        _ if yaml("kustomization") => "Kubernetes",
        _ if yaml("helmfile") => "Helm",
        _ if yaml("appspec") => "CodeDeploy",
        _ => return None,
    })
}

/// The libraries a program that describes infrastructure depends on, and the kind
/// it is: a CDK app (`aws-cdk-lib`), a Pulumi program (`@pulumi/aws`, `pulumi`), a
/// CDK for Terraform app, an SST app.
const INFRASTRUCTURE_LIBRARIES: &[(&str, &str)] = &[
    ("aws-cdk-lib", "CDK"),
    ("aws-cdk", "CDK"),
    ("@aws-cdk/", "CDK"),
    ("aws-cdk.", "CDK"),
    ("cdktf", "CDK for Terraform"),
    ("cdktf-", "CDK for Terraform"),
    ("@pulumi/", "Pulumi"),
    ("pulumi", "Pulumi"),
    ("pulumi-", "Pulumi"),
    ("sst", "SST"),
    ("@serverless-stack/", "SST"),
];

/// The infrastructure library a dependency named `dep` is ([`INFRASTRUCTURE_LIBRARIES`]):
/// the whole name, or a scope or prefix that ends in `/`, `-` or `.`.
fn infrastructure_library(dep: &str) -> Option<&'static str> {
    INFRASTRUCTURE_LIBRARIES
        .iter()
        .find(|(lib, _)| {
            dep == *lib
                || (lib.ends_with(['/', '-', '.']) && dep.starts_with(lib) && dep.len() > lib.len())
        })
        .map(|(_, kind)| *kind)
}

/// The deployment descriptions known by what a file holds ([`unread_kind`]): an API
/// gateway's OpenAPI document (`x-amazon-apigateway-integration`, `x-google-backend`
/// map public paths to services), CloudFormation or SAM in JSON, an ARM template, an
/// Azure Container App, a Kubernetes manifest in JSON, an ECS task definition, an
/// AWS Copilot manifest, a Kamal deploy file, App Engine's `dispatch.yaml`, an Azure
/// Developer CLI `azure.yaml`, a Cloud Build file that deploys, and a program that
/// depends on an infrastructure library ([`INFRASTRUCTURE_LIBRARIES`]).
fn described_by_content(name: &str, text: &str) -> Option<&'static str> {
    let line = |start: &str| text.lines().any(|l| l.trim_start().starts_with(start));
    let json = name.ends_with(".json") || name.ends_with(".jsonc");
    if text.contains("x-amazon-apigateway-integration") || text.contains("x-google-backend") {
        return Some("API Gateway");
    }
    if text.contains("Microsoft.App/containerApps") {
        return Some("Azure Container Apps");
    }
    if text.contains("deploymentTemplate.json#") {
        return Some("Azure Resource Manager");
    }
    if name == "package.json" {
        let v: serde_json::Value = serde_json::from_str(text).ok()?;
        return [
            "dependencies",
            "devDependencies",
            "optionalDependencies",
            "peerDependencies",
        ]
        .iter()
        .filter_map(|k| v.get(*k)?.as_object())
        .flat_map(|deps| deps.keys())
        .find_map(|dep| infrastructure_library(dep));
    }
    if name == "pyproject.toml" || name == "Pipfile" || name.ends_with(".txt") {
        // A requirement is its name up to a version, an extra or a marker.
        return text
            .lines()
            .map(|l| l.trim().trim_matches(['"', '\'', ',']).trim())
            .filter_map(|l| {
                let end = l
                    .find(|c: char| {
                        !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
                    })
                    .unwrap_or(l.len());
                (end > 0).then(|| l[..end].to_ascii_lowercase())
            })
            .find_map(|dep| infrastructure_library(&dep));
    }
    if json {
        if text.contains("\"AWSTemplateFormatVersion\"")
            || (text.contains("\"Type\"") && text.contains("\"AWS::"))
        {
            return Some("CloudFormation");
        }
        if text.contains("\"apiVersion\"") && text.contains("\"kind\"") {
            return Some("Kubernetes");
        }
        if text.contains("\"containerDefinitions\"") {
            return Some("ECS");
        }
        return None;
    }
    if !(name.ends_with(".yml") || name.ends_with(".yaml")) {
        return None;
    }
    if line("type: Load Balanced Web Service")
        || line("type: Backend Service")
        || line("type: Request-Driven Web Service")
        || line("type: Worker Service")
    {
        return Some("AWS Copilot");
    }
    if line("service:") && line("image:") && line("servers:") {
        return Some("Kamal");
    }
    if name.starts_with("dispatch.") && line("dispatch:") {
        return Some("App Engine dispatch");
    }
    if name.starts_with("azure.") && line("services:") {
        return Some("Azure Developer CLI");
    }
    if name.starts_with("cloudbuild") && text.contains("deploy") {
        return Some("Cloud Build");
    }
    None
}

/// A platform's file ([`PLATFORM_KINDS`]) that sends requests somewhere else than
/// the application of its own directory: Vercel `rewrites` or `routes` to another
/// host, Netlify `[[redirects]]` that proxy to another host, Firebase Hosting
/// `rewrites` to a Cloud Run service or a function, a Render Blueprint that deploys
/// a `rootDir` or a Dockerfile of its own choosing, a `fly.toml` that builds a
/// Dockerfile of another directory or deploys an image. The kind it is then
/// describes infrastructure and may route to any service of the repository.
fn routes_elsewhere(name: &str, text: Option<&str>) -> Option<&'static str> {
    let text = text?;
    let to_another_host = |v: &serde_json::Value, keys: &[&str], to: &[&str]| -> bool {
        keys.iter()
            .filter_map(|k| v.get(*k)?.as_array())
            .flatten()
            .any(|r| {
                to.iter()
                    .filter_map(|t| r.get(*t)?.as_str())
                    .any(|d| d.contains("://"))
            })
    };
    match name {
        "vercel.json" => {
            let v: serde_json::Value = serde_json::from_str(text).ok()?;
            to_another_host(&v, &["rewrites", "routes"], &["destination", "dest"])
                .then_some("Vercel rewrites")
        }
        "netlify.toml" => (text.contains("[[redirects]]") && text.contains("://"))
            .then_some("Netlify proxy redirects"),
        "firebase.json" => {
            let v: serde_json::Value = serde_json::from_str(text).ok()?;
            let hostings: Vec<&serde_json::Value> = match v.get("hosting") {
                Some(serde_json::Value::Array(a)) => a.iter().collect(),
                Some(h) => vec![h],
                None => Vec::new(),
            };
            hostings
                .iter()
                .filter_map(|h| h.get("rewrites")?.as_array())
                .flatten()
                .any(|r| r.get("run").is_some() || r.get("function").is_some())
                .then_some("Firebase rewrites")
        }
        "render.yaml" => text
            .lines()
            .map(str::trim_start)
            .any(|l| {
                [
                    "rootDir:",
                    "dockerfilePath:",
                    "dockerContext:",
                    "repo:",
                    "- rootDir:",
                ]
                .iter()
                .any(|k| l.starts_with(k))
            })
            .then_some("Render Blueprint"),
        "fly.toml" => text
            .lines()
            .map(str::trim_start)
            .any(|l| {
                (l.starts_with("dockerfile") && l.contains(".."))
                    || l.starts_with("image ")
                    || l.starts_with("image=")
            })
            .then_some("Fly.io build"),
        _ => None,
    }
}

/// One description of a stack: the compose file it is named by, the text read, and
/// the files merged into it (path and text).
type Stack = (String, String, Vec<(String, String)>);

/// The files Drift recognises as deployment descriptions of one kind and does not
/// read ([`Boundaries::unread`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Unread {
    /// `Terraform`, `Kubernetes`, ...
    pub kind: String,
    /// The first five, sorted.
    pub files: Vec<String>,
    /// How many there are.
    pub count: usize,
    /// All of them.
    #[serde(skip)]
    all: Vec<String>,
}

/// The kind of [`unread_kind`] a tie lets Drift read for one code directory
/// (`security.terraform`).
const TERRAFORM: &str = "Terraform";

/// What stands for the compose files in what is said of a route
/// ([`Description::compose`]), where they speak of its service as a whole beside a
/// Terraform tie.
const COMPOSE_AS_A_WHOLE: &str = "the compose files";

/// The kinds of [`unread_kind`] that deploy the application of the directory they are
/// in to a platform, and nothing else: one of these says nothing of a service whose
/// code is elsewhere. Every other kind describes infrastructure and may route to any
/// service of the repository.
const PLATFORM_KINDS: &[&str] = &[
    "Fly.io",
    "Render",
    "Procfile",
    "Netlify",
    "Vercel",
    "Serverless",
    "App Engine",
    "App Runner",
    "Railway",
    "Firebase",
    "Elastic Beanstalk",
];

/// What one compose file says of a route, where more than one describes its service
/// ([`EntryRow::descriptions`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Description {
    /// The compose file; for a Terraform tie, the directory of the module; and
    /// [`COMPOSE_AS_A_WHOLE`] where the compose files speak of the service as a
    /// whole beside a tie.
    pub compose: String,
    pub exposure: Exposure,
    pub boundary: String,
}

impl Unread {
    /// Every file of the kind, sorted.
    pub fn all(&self) -> &[String] {
        &self.all
    }

    /// The first file, and how many more.
    fn shown(&self) -> String {
        match (self.files.first(), self.count) {
            (Some(f), 1) => f.clone(),
            (Some(f), n) => format!("{f} and {} more", n - 1),
            (None, _) => String::new(),
        }
    }
}

impl Boundaries {
    /// Reads the config and the compose files at `root`. Never fails: what cannot be
    /// read is a warning and stays unknown.
    pub fn load(root: &Path) -> Self {
        Self::load_with(root, crate::policy::DriftConfig::load(root))
    }

    /// [`Boundaries::load`] with `config` for what `.drift/config.yaml` says: what the
    /// boundary would be with other answers (`drift setup` counts what each would
    /// move).
    pub fn load_with(root: &Path, config: anyhow::Result<crate::policy::DriftConfig>) -> Self {
        // An agent's word may only make Drift more cautious, however the repository
        // changed since it was given: the boundary without what it left out is kept
        // beside, and decides every route that would otherwise read as inside.
        if let Ok(cfg) = &config
            && !cfg.security.on_agents_word.is_empty()
        {
            let mut all = cfg.clone();
            let agents = std::mem::take(&mut all.security.on_agents_word);
            let mut person = all.clone();
            person.security.not_deployed.retain(|p| !agents.contains(p));
            let mut b = Self::load_with(root, Ok(all));
            b.cautious = Some((agents, Box::new(Self::load_with(root, Ok(person)))));
            return b;
        }
        let mut b = Self::default();
        let not_deployed: Vec<String> = config
            .as_ref()
            .map(|cfg| cfg.security.not_deployed.clone())
            .unwrap_or_default();
        let ties = config
            .as_ref()
            .map(|cfg| cfg.security.terraform.clone())
            .unwrap_or_default();
        match config {
            Ok(cfg) => {
                for (list, exposure, source) in [
                    (
                        &cfg.security.public,
                        Exposure::Public,
                        "config security.public",
                    ),
                    (
                        &cfg.security.internal,
                        Exposure::Internal,
                        "config security.internal",
                    ),
                ] {
                    for d in list {
                        b.set(d, exposure, source.to_string(), true);
                    }
                }
                b.warnings.extend(
                    cfg.warnings
                        .iter()
                        .filter(|w| w.contains("security"))
                        .cloned(),
                );
                b.declared = cfg.practices.clone();
                b.declared_by = cfg.declared_by.clone();
            }
            Err(e) => b.warnings.push(format!(
                "{}: not read ({e:#}); its security settings are unknown",
                crate::policy::CONFIG_FILE
            )),
        }
        let left = |path: &str| {
            not_deployed
                .iter()
                .any(|p| p.is_empty() || path == p || path.starts_with(&format!("{p}/")))
        };
        let found = deployments(root);
        let files = found.compose;
        let dir_of = |rel: &str| rel.rsplit_once('/').map_or("", |(d, _)| d).to_string();
        let file_of = |rel: &str| rel.rsplit('/').next().unwrap_or(rel).to_string();
        let services_of = |text: &str| -> BTreeSet<String> {
            serde_saphyr::from_str::<serde_json::Value>(text)
                .ok()
                .and_then(|v| Some(v.get("services")?.as_object()?.keys().cloned().collect()))
                .unwrap_or_default()
        };
        // Each description of a stack: the file it is named by, the text read, and
        // what is merged into it.
        let mut stacks: Vec<Stack> = Vec::new();
        for rel in &files {
            let (dir, file) = (dir_of(rel), file_of(rel));
            // The first file of the directory with a name compose looks for is its
            // base: the override files are merged into it without being asked.
            let base = files
                .iter()
                .find(|f| dir_of(f) == dir && COMPOSE_FILES.contains(&file_of(f).as_str()));
            if COMPOSE_OVERRIDES.contains(&file.as_str()) && base.is_some() {
                continue;
            }
            let read = |rel: &str| match std::fs::read_to_string(root.join(rel)) {
                Ok(text) => Ok(text),
                Err(e) => Err(format!("{rel}: not read ({e}); its services are unknown")),
            };
            let text = match read(rel) {
                Ok(text) => text,
                Err(w) => {
                    b.warnings.push(w);
                    continue;
                }
            };
            let overrides = |dir: &str| -> Vec<(String, String)> {
                COMPOSE_OVERRIDES
                    .iter()
                    .filter_map(|name| {
                        let path = join_dir(dir, name)?;
                        let text = std::fs::read_to_string(root.join(&path)).ok()?;
                        Some((path, text))
                    })
                    .collect()
            };
            match base {
                Some(base) if base == rel => stacks.push((rel.clone(), text, overrides(&dir))),
                // Another compose file beside the base that names a service of it
                // (`docker-compose.prod.yml`) is laid over it, as `-f base -f this`
                // does: a stack of its own, named by this file. Files named with
                // `-f` are all compose reads: the override files are not merged in.
                Some(base)
                    if read(base)
                        .is_ok_and(|b| !services_of(&b).is_disjoint(&services_of(&text))) =>
                {
                    let over = vec![(rel.clone(), text)];
                    stacks.push((rel.clone(), read(base).unwrap_or_default(), over));
                }
                _ => stacks.push((rel.clone(), text, Vec::new())),
            }
        }
        for (name, text, overrides) in stacks {
            if !left(&name) {
                b.read.push(name.clone());
            }
            if left(&name) {
                // Read apart: what it would have said is kept, to say so.
                let mut apart = Self::default();
                apart.read_compose_with(Some(root), &name, &text, &overrides);
                apart.rules.sort();
                apart.warnings.clear();
                b.warnings.push(format!(
                    "{name}: left out by {} (security.not_deployed)",
                    crate::policy::CONFIG_FILE
                ));
                b.left_out.push((name, apart));
            } else {
                b.read_compose_with(Some(root), &name, &text, &overrides);
            }
        }
        // The Terraform a person tied code to: its listener rules are read for the
        // routes of that code.
        if !ties.is_empty() {
            let files: Vec<String> = found
                .unread
                .iter()
                .filter(|(kind, path)| kind == "Terraform" && !left(path))
                .map(|(_, path)| path.clone())
                .collect();
            let terraform = crate::terraform::Terraform::read(root, &files);
            for tie in &ties {
                match terraform.tied(tie) {
                    Ok(tied) => b.tied.push(tied),
                    Err(warning) => b.warnings.push(warning),
                }
            }
        }
        // What Drift recognises as a deployment description and does not read.
        let mut kinds: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut left_kinds: BTreeMap<String, usize> = BTreeMap::new();
        {
            use crate::practices::basis::{NotRead, kind};
            for (k, path) in &found.unread {
                b.not_read.push(NotRead {
                    kind: kind::DESCRIPTION.to_string(),
                    what: path.clone(),
                    why: if left(path) {
                        format!("a {k} description left out under security.not_deployed")
                    } else {
                        format!("a {k} description Drift recognises and does not read")
                    },
                });
            }
            for (path, why) in &found.seen {
                b.not_read.push(NotRead {
                    kind: kind::FILE.to_string(),
                    what: path.clone(),
                    why: why.clone(),
                });
            }
            for (name, _) in &b.left_out {
                b.not_read.push(NotRead {
                    kind: kind::DESCRIPTION.to_string(),
                    what: name.clone(),
                    why: "a compose file left out under security.not_deployed".to_string(),
                });
            }
        }
        for (kind, path) in found.unread {
            if left(&path) {
                *left_kinds.entry(kind).or_default() += 1;
            } else {
                kinds.entry(kind).or_default().push(path);
            }
        }
        for (kind, n) in left_kinds {
            b.warnings.push(format!(
                "{n} {kind} file{} left out by {} (security.not_deployed)",
                if n == 1 { "" } else { "s" },
                crate::policy::CONFIG_FILE
            ));
        }
        b.unread = kinds
            .into_iter()
            .map(|(kind, files)| Unread {
                kind,
                count: files.len(),
                files: files.iter().take(5).cloned().collect(),
                all: files,
            })
            .collect();
        for u in &b.unread {
            // Terraform is not left out to be read: a person ties the code a target
            // group forwards to, and its listener rules are read for that code.
            if u.kind == TERRAFORM {
                let tied: Vec<&str> = b
                    .tied
                    .iter()
                    .map(|t| match t.tie.code.as_str() {
                        "" => "the repository",
                        code => code,
                    })
                    .collect();
                b.warnings.push(format!(
                    "Terraform in the repository is not read ({}): what it routes to a service is not known, so nothing {}is said to be internal; code a target group forwards to can be tied to it under security.terraform in {} ({{target: <module dir>[#aws_lb_target_group.<name>], code: <dir>}}), and its listener rules are then read for that code",
                    u.shown(),
                    match tied.as_slice() {
                        [] => String::new(),
                        tied => format!("outside {} (tied) ", tied.join(", ")),
                    },
                    crate::policy::CONFIG_FILE
                ));
                continue;
            }
            b.warnings.push(format!(
                "{} in the repository is not read ({}): what it routes to a service is not known, so {} is said to be internal; a description that deploys nothing can be left out under security.not_deployed in {}",
                u.kind,
                u.shown(),
                if PLATFORM_KINDS.contains(&u.kind.as_str()) {
                    "nothing in its directory"
                } else {
                    "nothing"
                },
                crate::policy::CONFIG_FILE
            ));
        }
        b.rules.sort();
        // A whole service a compose file calls internal is not, while a description
        // that is not read may route to it.
        let notes: Vec<Option<String>> = b.rules.iter().map(|r| b.unread_note(&r.dir)).collect();
        for (r, note) in b.rules.iter_mut().zip(notes) {
            if let Some(note) = note
                && r.exposure == Exposure::Internal
                && !r.source.starts_with("config")
            {
                r.exposure = Exposure::Unknown;
                r.source = format!("{}; {note}", r.source);
            }
        }
        b
    }

    /// What an `internal` verdict for the row at `path` rests on: the compose files
    /// read (and `.drift/config.yaml` where a person's word decides), what was seen
    /// around the boundary and not read, and the skipped files under the row's
    /// directory (`skipped`, the inventory's).
    pub fn exposure_basis(
        &self,
        path: &str,
        boundary: Option<&str>,
        skipped: &[drift_core::Skipped],
    ) -> crate::practices::basis::Basis {
        use crate::practices::basis::{Basis, NotRead, kind};
        let mut b = Basis {
            descriptions: self.read.clone(),
            not_read: self.not_read.clone(),
            ..Basis::default()
        };
        if boundary.is_some_and(|x| x.starts_with("config")) {
            b.descriptions.push(crate::policy::CONFIG_FILE.to_string());
        }
        let dir = path.rsplit_once('/').map_or("", |(d, _)| d);
        b.not_read.extend(
            skipped
                .iter()
                .filter(|s| dir.is_empty() || s.path.starts_with(&format!("{dir}/")))
                .map(|s| NotRead {
                    kind: kind::FILE.to_string(),
                    what: s.path.clone(),
                    why: "skipped by the scan".to_string(),
                }),
        );
        b.finish()
    }

    /// What an internal verdict for the code in `dir` becomes unknown for: the
    /// deployment descriptions that are in the repository, are not read, and may
    /// route to it (any that describes infrastructure, and one that deploys a
    /// directory `dir` is in: [`PLATFORM_KINDS`]).
    fn unread_note(&self, dir: &str) -> Option<String> {
        let mut terraform = false;
        let kinds: Vec<String> = self
            .unread
            .iter()
            .filter_map(|u| {
                // A tie has the listener rules read for this code: Terraform is then
                // a description that speaks of it ([`Boundaries::expose_routes`]).
                if u.kind == TERRAFORM {
                    if self.tied.iter().any(|t| t.covers(dir)) {
                        return None;
                    }
                    terraform = true;
                }
                if !PLATFORM_KINDS.contains(&u.kind.as_str()) {
                    return Some(format!("{} ({})", u.kind, u.shown()));
                }
                let file = u.all.iter().find(|f| {
                    let at = f.rsplit_once('/').map_or("", |(d, _)| d);
                    at.is_empty() || dir == at || dir.starts_with(&format!("{at}/"))
                })?;
                Some(format!("{} ({file})", u.kind))
            })
            .collect();
        (!kinds.is_empty()).then(|| {
            format!(
                "but {} in the repository {} not read and may route to it{}",
                kinds.join(", "),
                if kinds.len() == 1 { "is" } else { "are" },
                if terraform {
                    format!(
                        "; security.terraform in {} can tie this code to the target group that forwards to it",
                        crate::policy::CONFIG_FILE
                    )
                } else {
                    String::new()
                }
            )
        })
    }

    /// Adds `dir` unless a rule a person wrote already covers that exact directory
    /// (`from_config` rules are never overridden; a compose rule is).
    fn set(&mut self, dir: &str, exposure: Exposure, source: String, from_config: bool) {
        let dir = normal_dir(dir);
        if let Some(i) = self.rules.iter().position(|r| r.dir == dir) {
            let r = &mut self.rules[i];
            if r.source.starts_with("config") && !from_config {
                return;
            }
            // Two compose services for one directory that disagree. When one of them
            // publishes ports, the code in that directory is reachable from outside
            // through it (a web service and its queue consumer built from one
            // Dockerfile): internet-facing wins, whichever is listed first.
            if !from_config && !r.source.starts_with("config") {
                // The most exposed of them speaks for it: a web service and its queue
                // consumer built from one directory, or the same code in two stacks.
                // Of two that say the same, the first; but one that publishes ports
                // speaks for every route, where one behind a gateway does not.
                let whole = |s: &str| s.ends_with("publishes ports");
                if exposure < r.exposure
                    || (exposure == r.exposure && whole(&source) && !whole(&r.source))
                {
                    r.exposure = exposure;
                    r.source = source;
                }
                return;
            }
            r.exposure = exposure;
            r.source = source;
            return;
        }
        self.rules.push(BoundaryRule {
            dir,
            exposure,
            source,
        });
    }

    /// [`Boundaries::read_compose_at`] with no repository to read a gateway's
    /// configuration from.
    pub fn read_compose(&mut self, name: &str, text: &str) {
        self.read_compose_at(None, name, text);
    }

    /// The services of the compose file at `name` (repo-relative), each keyed on its own
    /// code and its own published ports:
    ///
    /// - its code is its `build` directory (a string, or `build.context`, relative to the
    ///   compose file); a service built from an ancestor (`context: ../..`, so the image
    ///   can copy sibling packages) runs the code where its Dockerfile is, so that
    ///   directory, when it is below the context, is the service's. A service whose code
    ///   would be the whole repository, from a compose file that is not at its root,
    ///   applies to nothing, with a warning: one service never speaks for every package.
    ///   Services without a `build` run an image: no code here; a build directory outside
    ///   the repository is none of its code either. Two services that disagree about one
    ///   directory cancel out, with a warning ([`Boundaries::set`]).
    /// - a service that publishes `ports` is internet-facing; one that does not is
    ///   internal, unless a reverse-proxy gateway in the file fronts it: a service running
    ///   a [`GATEWAY_IMAGES`] image (or built from one) that publishes ports and shows it
    ///   fronts others (it mounts or copies a configuration from the repository, depends
    ///   on or links to services, or a service carries a `traefik.*` router label).
    /// - behind nginx gateways whose configuration is read under `root`
    ///   ([`nginx_gateway`]), a service a location proxies to is internet-facing, one no
    ///   location proxies to is internal when everything was read and unknown otherwise,
    ///   and each of its routes is then decided on its own ([`Boundaries::expose`]).
    /// - behind any other gateway, a service it routes to, as its configuration says (a
    ///   `traefik.*` router label on the service, or a `proxy_pass` / `reverse_proxy` to
    ///   it in a file the gateway mounts), is internet-facing, and any other is unknown.
    pub fn read_compose_at(&mut self, root: Option<&Path>, name: &str, text: &str) {
        self.read_compose_with(root, name, text, &[]);
    }

    /// [`Boundaries::read_compose_at`], with the override files (`compose.override.yaml`
    /// and its other names, as path and text) that compose merges into the file by
    /// default: a service's `ports`, `volumes` and the like are those of both, and a
    /// `command` or an `image` is the override's. An override that cannot be parsed
    /// leaves the file's services unknown: what it changes is not known.
    pub fn read_compose_with(
        &mut self,
        root: Option<&Path>,
        name: &str,
        text: &str,
        overrides: &[(String, String)],
    ) {
        let mut v: serde_json::Value = match serde_saphyr::from_str(text) {
            Ok(v) => v,
            Err(e) => {
                self.warnings.push(format!(
                    "{name}: not parsed ({e}); its services are unknown"
                ));
                return;
            }
        };
        for (path, text) in overrides {
            match serde_saphyr::from_str::<serde_json::Value>(text) {
                Ok(over) => merge_compose(&mut v, over, 0),
                Err(e) => {
                    self.warnings.push(format!(
                        "{path}: not parsed ({e}); it is merged into {name}, whose services are unknown"
                    ));
                    return;
                }
            }
        }
        // What compose reads with the file: what it includes, what its services
        // extend. What could not be put in leaves no service of it internal.
        let problems = crate::compose::resolve(root, name, &mut v);
        for p in &problems {
            self.warnings.push(format!(
                "{p}: so no service of {name} is said to be internal"
            ));
        }
        let file_caveat = problems.into_iter().next();
        // Networks that containers outside this file join.
        let external: Vec<String> = v
            .get("networks")
            .and_then(|n| n.as_object())
            .into_iter()
            .flatten()
            .filter(|(_, def)| {
                def.get("external")
                    .is_some_and(|e| e.as_bool().unwrap_or(true))
            })
            .map(|(k, _)| k.clone())
            .collect();
        let Some(services) = v.get("services").and_then(|s| s.as_object()) else {
            return;
        };
        let base = name.rsplit_once('/').map_or("", |(d, _)| d).to_string();
        let str_of = |v: Option<&serde_json::Value>| v.and_then(|x| x.as_str()).map(str::to_string);
        let strings = |v: Option<&serde_json::Value>| -> Vec<String> {
            match v {
                Some(serde_json::Value::Array(a)) => a
                    .iter()
                    .filter_map(|x| x.as_str())
                    .map(str::to_string)
                    .collect(),
                Some(serde_json::Value::Object(m)) => m.keys().cloned().collect(),
                _ => Vec::new(),
            }
        };
        let mut svcs: Vec<Svc> = Vec::new();
        for (svc, def) in services {
            let Some(def) = def.as_object() else {
                continue;
            };
            let build = match def.get("build") {
                Some(serde_json::Value::String(d)) => Some((d.clone(), None)),
                Some(serde_json::Value::Object(b)) => Some((
                    str_of(b.get("context")).unwrap_or_else(|| ".".to_string()),
                    str_of(b.get("dockerfile")),
                )),
                _ => None,
            };
            let in_repo = |d: &str| !(d.starts_with('/') || d.contains("://"));
            // The Dockerfile it is built from, and what that makes of a gateway image.
            let context = build
                .as_ref()
                .filter(|(d, _)| in_repo(d))
                .and_then(|(d, _)| join_dir(&base, d));
            let dockerfile = context.as_ref().and_then(|c| {
                let named = build.as_ref().and_then(|(_, df)| df.as_deref());
                join_dir(c, named.unwrap_or("Dockerfile"))
            });
            let dockerfile_text = root
                .zip(dockerfile.as_ref())
                .and_then(|(root, df)| read_small(&root.join(df)));
            let built = dockerfile_text.as_deref().and_then(gateway::dockerfile);
            let dir = match build {
                Some((d, _)) if !in_repo(&d) => None,
                Some((d, dockerfile)) => join_dir(&base, &d).and_then(|context| {
                    let mut dir = context.clone();
                    if let Some(df) = &dockerfile
                        && let Some((parent, _)) = df.trim().rsplit_once('/')
                        && let Some(d) = join_dir(&context, parent)
                        && d.len() > context.len()
                    {
                        dir = d;
                    }
                    // The service's directory (its Dockerfile's, else its context)
                    // above the compose file's own (the repository root, or any
                    // ancestor of `base`): it also holds the code of the compose
                    // file's other services, so one service cannot speak for it.
                    // Unknown, and said.
                    let above =
                        dir != base && (dir.is_empty() || base.starts_with(&format!("{dir}/")));
                    if above {
                        let from = if dir.is_empty() {
                            "the repository root".to_string()
                        } else {
                            format!("`{dir}`, above the compose file,")
                        };
                        self.warnings.push(format!(
                            "{name}: service {svc} builds from {from} and its Dockerfile names no directory below it, so where its code is cannot be told; its exposure is not applied",
                        ));
                        return None;
                    }
                    Some(dir)
                }),
                None => None,
            };
            let published = def
                .get("ports")
                .is_some_and(|p| p.as_array().is_some_and(|a| !a.is_empty()));
            let image = match &built {
                Some(b) => b.base.to_lowercase(),
                None => str_of(def.get("image")).unwrap_or_default().to_lowercase(),
            };
            let proxy = GATEWAY_IMAGES
                .iter()
                .find(|g| {
                    image
                        .rsplit('/')
                        .next()
                        .is_some_and(|i| i.split([':', '@']).next() == Some(**g))
                })
                .filter(|_| published)
                .copied();
            let labels: Vec<String> = match def.get("labels") {
                Some(serde_json::Value::Object(m)) => m
                    .iter()
                    .map(|(k, v)| {
                        format!("{k}={}", v.as_str().map_or(v.to_string(), str::to_string))
                    })
                    .collect(),
                other => strings(other),
            };
            // Each volume: where it comes from, and where it is in the container.
            let volumes: Vec<(String, String)> = def
                .get("volumes")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .filter_map(|m| match m {
                    serde_json::Value::String(s) => {
                        let mut parts = s.split(':');
                        let source = parts.next()?;
                        Some((source.to_string(), parts.next().unwrap_or("").to_string()))
                    }
                    serde_json::Value::Object(o) => Some((
                        str_of(o.get("source"))?,
                        str_of(o.get("target")).unwrap_or_default(),
                    )),
                    _ => None,
                })
                .collect();
            let mounts: Vec<String> = volumes
                .iter()
                .filter(|(h, _)| h.starts_with('.'))
                .filter_map(|(h, _)| join_dir(&base, h))
                .collect();
            let fronts = !mounts.is_empty()
                || built.as_ref().is_some_and(|b| !b.copies.is_empty())
                || !strings(def.get("depends_on")).is_empty()
                || !strings(def.get("links")).is_empty();
            // Every name another container reaches it by.
            let mut names = vec![svc.clone()];
            names.extend(str_of(def.get("container_name")));
            names.extend(str_of(def.get("hostname")));
            if let Some(nets) = def.get("networks").and_then(|n| n.as_object()) {
                names.extend(nets.values().flat_map(|n| strings(n.get("aliases"))));
            }
            let said: String = def.iter().map(|(k, v)| format!("{k} {v}\n")).collect();
            let volumes: Vec<(Option<String>, String)> = volumes
                .into_iter()
                .map(|(h, t)| {
                    let source = Some(h)
                        .filter(|h| h.starts_with('.'))
                        .and_then(|h| join_dir(&base, &h));
                    (source, t)
                })
                .collect();
            let who = format!("compose service {svc} in {name}");
            // Why the service is never said to be internal, whatever publishes or
            // routes: part of its definition is not read, or says that the compose
            // network is not the only way to it.
            let networks = strings(def.get("networks"));
            let mode = str_of(def.get("network_mode"));
            let caveat = file_caveat
                .clone()
                .or_else(|| {
                    let why = def.get(crate::compose::UNRESOLVED)?.as_str()?;
                    Some(format!("{who} is not all read: {why}"))
                })
                .or_else(|| {
                    let key = crate::compose::unknown_key(def)?;
                    Some(format!(
                        "{who} has `{key}`, a setting Drift does not know: who can reach it is not known"
                    ))
                })
                .or_else(|| {
                    let mode = mode.as_ref().filter(|m| {
                        *m == "host"
                            || m.starts_with("service:")
                            || m.starts_with("container:")
                            || m.contains('$')
                    })?;
                    Some(format!(
                        "{who} publishes no ports and sets network_mode {mode}: the compose network is not the only way to it"
                    ))
                })
                .or_else(|| {
                    let n = networks.iter().find(|n| n.contains('$'))?;
                    Some(format!(
                        "{who} is on the network `{n}`, whose name is not in the repository"
                    ))
                })
                .or_else(|| {
                    let on_default = networks.is_empty() && mode.is_none();
                    let n = external.iter().find(|e| {
                        networks.contains(e) || (on_default && e.as_str() == "default")
                    })?;
                    Some(format!(
                        "{who} is on the external network `{n}`, which containers outside {name} join"
                    ))
                });
            let start = match root {
                Some(root) => started(
                    root,
                    &base,
                    &who,
                    def,
                    context.as_deref().zip(dockerfile_text.as_deref()),
                    &volumes,
                    dir.as_deref(),
                ),
                None => Started::default(),
            };
            let (unread_start, absent_env) = (start.unread, start.absent_env);
            svcs.push(Svc {
                name: svc.clone(),
                dir,
                published,
                proxy,
                labels,
                mounts,
                fronts,
                image,
                volumes,
                builds: def.contains_key("build"),
                networks,
                caveat,
                unread_start,
                absent_env,
                said: said.to_lowercase(),
                built: built.zip(context),
                names: names.iter().map(|n| n.to_lowercase()).collect(),
                links: strings(def.get("links"))
                    .iter()
                    .filter_map(|l| l.split_once(':'))
                    .map(|(to, alias)| (alias.to_lowercase(), to.to_lowercase()))
                    .collect(),
                rewired: [
                    "command",
                    "entrypoint",
                    "configs",
                    "volumes_from",
                    "extends",
                ]
                .into_iter()
                .filter(|k| def.contains_key(*k))
                .collect(),
                target: start.target,
                next: start.next,
            });
        }
        let traefik = |svc: &Svc| {
            svc.labels
                .iter()
                .any(|l| l == "traefik.enable=true" || l.starts_with("traefik.http.routers."))
        };
        let any_traefik = svcs.iter().any(traefik);
        // Traefik routes by the labels of the other services, and to every container
        // by default: one that publishes ports is a gateway whatever it mounts.
        let gateways: Vec<&Svc> = svcs
            .iter()
            .filter(|s| {
                s.proxy.is_some() && (s.fronts || any_traefik || s.proxy == Some("traefik"))
            })
            .collect();
        let names: Vec<&str> = gateways.iter().map(|g| g.name.as_str()).collect();
        // Another service that may let requests in to this one and that Drift does
        // not read: one running an image it does not know (a proxy, a tunnel that
        // publishes nothing), whether or not it publishes ports; or an application of
        // the repository that can proxy and names this service ([`relay`]). Through it
        // the service may be reached, whatever the gateways that are read route.
        let stranger = |svc: &Svc| -> Option<String> {
            svcs.iter()
                .find(|p| {
                    p.name != svc.name
                        && !names.contains(&p.name.as_str())
                        && p.may_proxy()
                        && p.shares_a_network_with(svc)
                })
                .map(|p| {
                    format!(
                        "compose service {} in {name} {} to {} ({}): what it routes is not read",
                        p.name,
                        if p.published {
                            "publishes ports and may proxy"
                        } else {
                            "may let requests in"
                        },
                        svc.name,
                        if p.image.is_empty() {
                            "its image is not named".to_string()
                        } else {
                            format!("image {}", p.image)
                        }
                    )
                })
                .or_else(|| {
                    let root = root?;
                    svcs.iter()
                        .filter(|p| p.name != svc.name && p.shares_a_network_with(svc))
                        .find_map(|p| {
                            let evidence = relay(root, p, svc)?;
                            Some(format!(
                                "compose service {} in {name} may relay requests to {} ({evidence}): what it forwards is not read",
                                p.name, svc.name
                            ))
                        })
                })
        };
        // What an application sends on is asked of its code, once the facts are at
        // hand ([`Boundaries::set_relays`]): of each one that may be asked from
        // outside (it publishes ports, a gateway may route to it, or its network is
        // not known to be closed).
        if let Some(root) = root {
            for svc in &svcs {
                let Some(dir) = &svc.dir else { continue };
                for p in svcs.iter().filter(|p| {
                    p.name != svc.name
                        && p.builds
                        && p.shares_a_network_with(svc)
                        && (p.published || !gateways.is_empty() || p.caveat.is_some())
                }) {
                    let Some(from) = &p.dir else { continue };
                    self.callers.push(Caller {
                        compose: name.to_string(),
                        client: p.name.clone(),
                        from: normal_dir(from),
                        service: svc.name.clone(),
                        dir: normal_dir(dir),
                        named: names_host(&p.said, &svc.names),
                        names: svc.names.clone(),
                        root: root.to_path_buf(),
                    });
                }
            }
        }
        // The other services that name this one and cannot proxy: its clients.
        let clients = |svc: &Svc| -> Vec<String> {
            svcs.iter()
                .filter(|p| p.name != svc.name && p.builds && names_host(&p.said, &svc.names))
                .map(|p| p.name.clone())
                .collect()
        };

        // The gateways, each read rule by rule (nginx locations, Traefik routers,
        // Caddy matchers): all of them, or none.
        let mut read: Option<Vec<Gateway>> = None;
        // Traefik labels with no Traefik in the file are for one that runs elsewhere:
        // nothing here says what it routes, and the services are taken as a whole.
        let labels_read = !any_traefik || gateways.iter().any(|g| g.proxy == Some("traefik"));
        if let Some(root) = root
            && !gateways.is_empty()
            && labels_read
        {
            read = gateways
                .iter()
                .map(|g| {
                    let (kind, got) = match g.proxy {
                        Some("nginx") => ("nginx configuration", nginx_gateway(root, g, &svcs)),
                        Some("traefik") => ("Traefik labels", Ok(Some(traefik_gateway(name, g, &svcs)))),
                        Some("caddy") => ("a Caddyfile", caddy_gateway(root, g, &svcs)),
                        _ => ("", Ok(None)),
                    };
                    got.unwrap_or_else(|e| {
                        self.warnings.push(format!(
                            "{e}: not read as {kind}, so the services behind gateway {} are taken as a whole",
                            g.name
                        ));
                        None
                    })
                })
                .collect();
        }
        if let (Some(read), Some(root)) = (read, root) {
            for g in read.iter().filter(|g| !g.unread.is_empty()) {
                self.warnings.push(format!(
                    "{}{}: so what gateway {} routes is not all known, and a route it does not match is unknown, not internal",
                    g.unread[0],
                    match g.unread.len() {
                        1 => String::new(),
                        n => format!(" (and {} more not read)", n - 1),
                    },
                    g.name
                ));
            }
            let open = read.iter().any(|g| !g.unread.is_empty());
            for svc in &svcs {
                let Some(dir) = &svc.dir else {
                    continue;
                };
                let who = format!("compose service {} in {name}", svc.name);
                let routed = read.iter().any(|g| !g.locations_to(&svc.name).is_empty());
                // Said once: no route of it that the gateways do not carry is internal.
                if routed && !svc.published {
                    self.warnings.extend(svc.unread_start.clone());
                    // Not an unknown, and never silent: a root path set there is not seen.
                    self.warnings.extend(svc.absent_env.iter().map(|file| {
                        format!(
                            "{who} takes its environment from {file}, which is not in the repository; what it sets is not read"
                        )
                    }));
                }
                let network = svc.network(&who).or_else(|| stranger(svc));
                let (exposure, what) = if svc.published {
                    (Exposure::Public, format!("{who} publishes ports"))
                } else if routed {
                    (
                        Exposure::Public,
                        format!("{who} is routed by gateway {}", names.join(", ")),
                    )
                } else if let Some(network) = &network {
                    (Exposure::Unknown, network.clone())
                } else if open {
                    (
                        Exposure::Unknown,
                        format!(
                            "{who} publishes no ports; gateway {} may route to it",
                            names.join(", ")
                        ),
                    )
                } else {
                    (
                        Exposure::Internal,
                        format!(
                            "{who} publishes no ports and gateway {} routes nothing to it{}",
                            names.join(", "),
                            called_by(&clients(svc))
                        ),
                    )
                };
                self.behind.push(Behind {
                    dir: normal_dir(dir),
                    service: svc.name.clone(),
                    compose: name.to_string(),
                    published: svc.published,
                    caveat: network,
                    // A root path matters only where a location could then reach it.
                    root: (routed && !svc.published).then(|| root.to_path_buf()),
                    target: svc.target.clone(),
                    next: svc.next,
                    unread_start: svc.unread_start.clone(),
                    absent_env: svc.absent_env.clone(),
                    clients: clients(svc),
                });
                self.set(dir, exposure, what, false);
            }
            self.gateways
                .extend(read.into_iter().map(|g| (name.to_string(), g)));
            return;
        }

        // What the gateways' mounted configuration says they proxy to.
        let mut conf = String::new();
        if let Some(root) = root {
            for m in gateways.iter().flat_map(|g| &g.mounts) {
                conf.push_str(&read_config(&root.join(m)));
            }
        }
        let routed = |svc: &Svc| {
            traefik(svc)
                || [
                    format!("proxy_pass http://{}", svc.name),
                    format!("proxy_pass https://{}", svc.name),
                    format!("reverse_proxy {}", svc.name),
                    format!("reverse_proxy http://{}", svc.name),
                ]
                .iter()
                .any(|p| {
                    conf.match_indices(p.as_str()).any(|(i, _)| {
                        conf[i + p.len()..]
                            .chars()
                            .next()
                            .is_none_or(|c| !(c.is_alphanumeric() || c == '-' || c == '_'))
                    })
                })
        };
        for svc in &svcs {
            let Some(dir) = &svc.dir else {
                continue;
            };
            let who = format!("compose service {} in {name}", svc.name);
            let (exposure, what) = if svc.published {
                (Exposure::Public, format!("{who} publishes ports"))
            } else if let Some(network) = svc.network(&who) {
                (Exposure::Unknown, network)
            } else if let Some(stranger) = stranger(svc).filter(|_| !routed(svc)) {
                (Exposure::Unknown, stranger)
            } else if names.is_empty() {
                (
                    Exposure::Internal,
                    format!("{who} publishes no ports{}", called_by(&clients(svc))),
                )
            } else if routed(svc) {
                (
                    Exposure::Public,
                    format!("{who} is routed by gateway {}", names.join(", ")),
                )
            } else {
                (
                    Exposure::Unknown,
                    format!(
                        "{who} publishes no ports; gateway {} may route to it",
                        names.join(", ")
                    ),
                )
            };
            if exposure != Exposure::Internal {
                self.whole.insert(normal_dir(dir));
            }
            self.set(dir, exposure, what, false);
        }
    }

    /// Decides each route behind a read gateway on its own, where a compose rule (not
    /// a person's setting) speaks for its file. `entries` are all the entry points:
    /// the routes of a service are needed together, to see that every location to it
    /// is one of them.
    ///
    /// A route (`http` or `page`, a path) of a service that publishes no ports is:
    ///
    /// - internet-facing when a location provably delivers it ([`Gateway::carries`]);
    /// - unknown when a location may ([`Gateway::may_carry`]), when a gateway is not
    ///   fully read, when a location to the service delivers none of its routes (it
    ///   answers there on a path Drift does not read, so its routes may be mounted
    ///   under a prefix), or when the service names a root path or a network mode;
    /// - internal otherwise: the gateways are the only way in, all of what they route
    ///   is read, and nothing they send the service can be this route.
    ///
    /// A route of a service some location proxies to is said to be internal only when
    /// its adapter (`adapters`, one for each of `entries`) lists every path a handler
    /// answers ([`EVERY_MOUNT_LISTED`]).
    ///
    /// Services sharing a directory: the most exposed answer wins. Entry points that
    /// are not routes keep what the rule says of the service as a whole.
    fn expose(&self, entries: &mut [EntryRow], adapters: &[&str]) {
        // One run's worth of comparing routes with locations, and no more.
        gateway::refill();
        self.expose_routes(entries, adapters);
        // What a compose file that is left out would have said, where that is more.
        for (file, apart) in &self.left_out {
            let mut rows: Vec<EntryRow> = entries.to_vec();
            for row in &mut rows {
                let (exposure, boundary) = apart.of(&row.path);
                row.exposure = exposure;
                row.boundary = boundary.map(str::to_string);
            }
            apart.expose_routes(&mut rows, adapters);
            for (e, would) in entries.iter_mut().zip(rows) {
                if would.exposure < e.exposure {
                    e.boundary = Some(format!(
                        "{}; {file}, left out by {}, would make it {}",
                        e.boundary.as_deref().unwrap_or("nothing says"),
                        crate::policy::CONFIG_FILE,
                        would.exposure.as_str()
                    ));
                }
            }
        }
    }

    /// [`Boundaries::expose`] for the compose files that are not left out.
    fn expose_routes(&self, entries: &mut [EntryRow], adapters: &[&str]) {
        if self.behind.is_empty() && self.tied.is_empty() {
            return;
        }
        // Each entry point's directory, when the gateways decide it.
        let dirs: Vec<Option<&str>> = entries
            .iter()
            .map(|e| {
                let rule = self.rule(&e.path)?;
                let behind = || self.behind.iter().filter(|b| b.dir == rule.dir);
                (!rule.source.starts_with("config")
                    && !self.whole.contains(&rule.dir)
                    && behind().next().is_some()
                    && !behind().any(|b| b.published))
                .then_some(rule.dir.as_str())
            })
            .collect();
        let route_of = |e: &EntryRow| {
            Some(e)
                .filter(|e| e.kind == "http" || e.kind == "page")
                .and_then(|e| Route::parse(e.route.as_deref()?))
        };
        let mut routes: BTreeMap<&str, Vec<Route>> = BTreeMap::new();
        for (e, dir) in entries.iter().zip(&dirs) {
            if let (Some(dir), Some(r)) = (dir, route_of(e)) {
                routes.entry(dir).or_default().push(r);
            }
        }
        // For each service, a location to it that delivers none of its routes.
        let unexplained: Vec<Option<String>> = self
            .behind
            .iter()
            .map(|b| {
                let known = routes.get(b.dir.as_str())?;
                self.gateways_of(b).find_map(|g| {
                    let location = *g.unexplained(&b.service, known).first()?;
                    Some(format!(
                        "{} routes {location} to {}, where Drift reads no route of it: its routes may be served under a prefix",
                        g.title(),
                        b.service
                    ))
                })
            })
            .collect();
        for ((e, dir), adapter) in entries.iter_mut().zip(&dirs).zip(adapters) {
            let Some(route) = route_of(e) else {
                continue;
            };
            // The Terraform its code is tied to (the longest tied directory), unless
            // a person's own setting speaks for the code.
            let tied = self
                .tied
                .iter()
                .filter(|t| t.covers(&e.path))
                .max_by_key(|t| t.tie.code.len())
                .filter(|_| {
                    !self
                        .rule(&e.path)
                        .is_some_and(|r| r.source.starts_with("config"))
                });
            if dir.is_none() && tied.is_none() {
                continue;
            }
            let shown = e.route.as_deref().unwrap_or_default();
            // What each compose file says of it: the most exposed of its services.
            let mut said: BTreeMap<&str, (Exposure, String)> = BTreeMap::new();
            for (b, unexplained) in self
                .behind
                .iter()
                .zip(&unexplained)
                .filter(|(b, _)| Some(b.dir.as_str()) == *dir)
            {
                let verdict =
                    self.route_exposure(b, &route, shown, unexplained.as_deref(), adapter);
                match said.get_mut(b.compose.as_str()) {
                    Some(have) if have.0 <= verdict.0 => {}
                    Some(have) => *have = verdict,
                    None => {
                        said.insert(&b.compose, verdict);
                    }
                }
            }
            let mut said: Vec<(&str, (Exposure, String))> = said.into_iter().collect();
            // Where no gateway decides its routes one by one, what the compose files
            // say of the service as a whole stands beside the tie.
            if dir.is_none()
                && let Some(whole) = &e.boundary
            {
                said.push((COMPOSE_AS_A_WHOLE, (e.exposure, whole.clone())));
            }
            let composes: Vec<Exposure> = said.iter().map(|(_, (x, _))| *x).collect();
            // The tie is one more description: what the listener rules of the
            // repository's Terraform say of the route, named by the module.
            let tie = tied.map(|t| (t.tie.module.as_str(), t.verdict(&route, shown)));
            let of_tie = tie.as_ref().map(|(_, (x, _))| *x);
            said.extend(tie);
            said.sort_by(|a, b| (a.1.0, a.0).cmp(&(b.1.0, b.0)));
            let Some((_, (exposure, why))) = said.first().cloned() else {
                continue;
            };
            e.exposure = exposure;
            e.boundary = Some(why);
            // The verdict rests on the tie where the tie says it too.
            e.tied = of_tie == Some(exposure);
            // More than one stack: each is named with what it says, the most exposed
            // first, and that one decides.
            if said.len() > 1 {
                let all: Vec<String> = said
                    .iter()
                    .map(|(compose, (x, why))| format!("{} in {compose} ({why})", x.as_str()))
                    .collect();
                let differ = composes.iter().any(|x| *x != composes[0]);
                e.boundary = Some(format!(
                    "{}{}",
                    all.join("; "),
                    if differ {
                        format!(
                            "; a compose file that deploys nothing can be left out under security.not_deployed in {}",
                            crate::policy::CONFIG_FILE
                        )
                    } else {
                        String::new()
                    }
                ));
                e.descriptions = said
                    .into_iter()
                    .map(|(compose, (exposure, boundary))| Description {
                        compose: compose.to_string(),
                        exposure,
                        boundary,
                    })
                    .collect();
            }
            // A description that is not read may route to it all the same.
            if e.exposure == Exposure::Internal
                && let Some(note) = self.unread_note(dir.unwrap_or(&e.path))
            {
                e.exposure = Exposure::Unknown;
                e.boundary = Some(format!(
                    "{}; {note}",
                    e.boundary.as_deref().unwrap_or_default()
                ));
            }
        }
    }

    /// The gateways of the compose file the service `b` is in.
    fn gateways_of<'a>(&'a self, b: &'a Behind) -> impl Iterator<Item = &'a Gateway> {
        self.gateways
            .iter()
            .filter(|(compose, _)| *compose == b.compose)
            .map(|(_, g)| g)
    }

    /// The exposure of `route` (written `shown`, read by `adapter`) of the service `b`,
    /// and what says so. `unexplained` is what a location to the service that delivers
    /// none of its routes says.
    fn route_exposure(
        &self,
        b: &Behind,
        route: &Route,
        shown: &str,
        unexplained: Option<&str>,
        adapter: &str,
    ) -> (Exposure, String) {
        let gateways = || self.gateways_of(b);
        let s = &b.service;
        if let Some((g, location)) = gateways().find_map(|g| Some((g, g.carries(s, route)?))) {
            return (
                Exposure::Public,
                format!("{} routes {location} to {s}", g.title()),
            );
        }
        let may = gateways()
            .find_map(|g| {
                let why = g.may_carry(s, route)?;
                Some(format!("{} may route {shown} to {s}: {why}", g.title()))
            })
            .or_else(|| {
                let g = gateways().find(|g| !g.unread.is_empty())?;
                Some(format!(
                    "{} may route {shown} to {s}: not all of it is read ({})",
                    g.title(),
                    g.unread[0]
                ))
            })
            .or_else(|| unexplained.map(String::from))
            .or_else(|| b.caveat.clone())
            .or_else(|| {
                let g = gateways().find(|g| !g.locations_to(s).is_empty())?;
                if adapter == SERVED_ELSEWHERE {
                    return Some(format!(
                        "{} routes to {s}, and an include Drift cannot follow may serve the handler of {shown} on other paths",
                        g.title()
                    ));
                }
                (!EVERY_MOUNT_LISTED.contains(&adapter)).then(|| {
                    format!(
                        "{} routes to {s}, and a {adapter} route may be mounted on paths Drift does not read",
                        g.title()
                    )
                })
            })
            // A location proxies to the service: its routes are where Drift lists
            // them only when what it starts with is read to the end, and the
            // application it serves is one Drift knows.
            .or_else(|| b.root.as_ref().and(b.unread_start.clone()))
            .or_else(|| self.served(b, b.root.as_deref()?, adapter));
        match may {
            Some(why) => (Exposure::Unknown, why),
            None => (
                Exposure::Internal,
                format!(
                    "{} routes no {} to {shown} on {s}: reachable only inside the compose network{}{}",
                    gateways()
                        .map(Gateway::title)
                        .collect::<Vec<_>>()
                        .join(", "),
                    gateways().next().map_or("location", |g| g.noun),
                    // The condition the verdict holds under, where a location proxies
                    // to the service: a root path set in a file Drift cannot read.
                    match (&b.root, b.absent_env.as_slice()) {
                        (None, _) | (_, []) => String::new(),
                        (_, files) => format!(
                            "; not read: env file {} (not in the repository)",
                            files.join(", ")
                        ),
                    },
                    called_by(&b.clients)
                ),
            ),
        }
    }

    /// Why the routes of the service `b` that `adapter` reads may be served
    /// elsewhere than Drift lists them: what it starts is not an application Drift
    /// knows. None when it is.
    ///
    /// A Python route: the object the start command names ([`Started::target`]) is
    /// an application of the facts with nothing unknown ([`drift_core::AppFacts`]),
    /// and so is every other application object in the service's code, tests apart.
    /// A Next.js route: the command is `next start`, and no configuration or
    /// middleware file is there, since Drift reads none ([`NEXT_UNREAD`]).
    fn served(&self, b: &Behind, root: &Path, adapter: &str) -> Option<String> {
        let who = format!("compose service {} in {}", b.service, b.compose);
        if adapter == "nextjs" {
            if !b.next {
                return Some(format!(
                    "{who} does not start with `next start`: where its pages are served is not known"
                ));
            }
            return NEXT_UNREAD.iter().find_map(|file| {
                let rel = join_dir(&b.dir, file)?;
                root.join(&rel).is_file().then(|| {
                    format!("{rel} is not read: it may set a base path, rewrites or a middleware that moves the routes of {}", b.service)
                })
            });
        }
        if !PYTHON_ADAPTERS.contains(&adapter) {
            return None;
        }
        let apps = self.apps.as_ref()?;
        let Some((file, attr)) = &b.target else {
            return Some(format!(
                "{who} does not start a Python application: where its routes are served is not known"
            ));
        };
        let Some(unknown) = apps.get(&(file.clone(), attr.clone())) else {
            return Some(format!(
                "{who} starts on `{attr}` of {file}, which is not an application object Drift reads: where its routes are served is not known"
            ));
        };
        let within = |path: &str| b.dir.is_empty() || path.starts_with(&format!("{}/", b.dir));
        unknown
            .first()
            .map(|u| (u, unknown.len()))
            .or_else(|| {
                apps.iter()
                    .filter(|((path, _), _)| within(path) && !is_test_path(path))
                    .find_map(|(_, unknown)| Some((unknown.first()?, unknown.len())))
            })
            .map(|(first, n)| {
                format!(
                    "Drift does not know what {first} does to the paths of {}{}",
                    b.service,
                    match n {
                        1 => String::new(),
                        n => format!(" (and {} more it does not know)", n - 1),
                    }
                )
            })
    }

    /// The application objects of the repository ([`drift_core::FileFacts::apps`]),
    /// by file and name, each with what is not known of it: read before
    /// [`Boundaries::expose`]. Not given (the compose files read alone, with no
    /// facts): a Python route is not held to it.
    pub fn set_apps(&mut self, apps: BTreeMap<(String, String), Vec<String>>) {
        for (_, apart) in &mut self.left_out {
            apart.apps = Some(apps.clone());
        }
        self.apps = Some(apps);
    }

    /// Reads, in the facts, what each application that names a service sends on
    /// ([`drift_core::FileFacts::outgoing`]), before [`Boundaries::expose`]. An
    /// application is a client of a service only when the path of every request it
    /// sends is written out (identifiers and parameters aside). One request whose URL
    /// is built from the request being served (its path, its URL, a catch-all
    /// parameter), or is not read, and that may go to the service (not one to the
    /// application's own origin or to another host that is written out), and the
    /// application may relay to it whatever it is asked for: no route of the service is then said to be internal,
    /// and the reason names the function that sends it. Code that runs in the
    /// browser (`"use client"`) sends nothing from the application, and what a person
    /// says in `.drift/config.yaml` stands.
    pub fn set_relays(&mut self, repo: &RepoFacts) {
        for (_, apart) in &mut self.left_out {
            apart.set_relays(repo);
        }
        let callers = std::mem::take(&mut self.callers);
        for c in &callers {
            let under = |path: &str| {
                c.from.is_empty()
                    || path
                        .strip_prefix(c.from.as_str())
                        .is_some_and(|rest| rest.starts_with('/'))
            };
            let sent = repo
                .files
                .iter()
                .filter(|f| under(&f.path) && !f.directives.iter().any(|d| d == "use client"))
                .find_map(|f| {
                    let unread = f.outgoing.iter().find(|o| {
                        !o.unread.is_empty()
                            && drift_core::practice::outgoing_reaches(&o.url, &c.names)
                    })?;
                    Some((f, unread))
                });
            let Some((file, request)) = sent else {
                continue;
            };
            if !c.named && named_in_files(&c.root, &c.from, &c.names).is_none() {
                continue;
            }
            let by = match request.within.as_str() {
                "" => String::new(),
                name => format!("`{name}` "),
            };
            let why = format!(
                "compose service {} in {} may relay requests to {}: {by}({}:{}) sends a request, and {}",
                c.client, c.compose, c.service, file.path, request.line, request.unread
            );
            for r in self.rules.iter_mut().filter(|r| {
                r.dir == c.dir
                    && r.exposure == Exposure::Internal
                    && !r.source.starts_with("config")
            }) {
                r.exposure = Exposure::Unknown;
                r.source = why.clone();
            }
            for b in self
                .behind
                .iter_mut()
                .filter(|b| b.dir == c.dir && b.service == c.service && b.caveat.is_none())
            {
                b.caveat = Some(why.clone());
            }
        }
        self.callers = callers;
    }

    /// The rule that speaks for `path`: the one with the longest directory that
    /// contains it.
    fn rule(&self, path: &str) -> Option<&BoundaryRule> {
        self.rules
            .iter()
            .filter(|r| {
                r.dir.is_empty() || path == r.dir || path.starts_with(&format!("{}/", r.dir))
            })
            .max_by_key(|r| r.dir.len())
    }

    /// The exposure of `path` and its source: the rule with the longest directory
    /// that contains it, or unknown.
    pub fn of(&self, path: &str) -> (Exposure, Option<&str>) {
        self.rule(path)
            .map(|r| (r.exposure, Some(r.source.as_str())))
            .unwrap_or((Exposure::Unknown, None))
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }
}

/// Reverse-proxy images ([`Boundaries::read_compose_at`]): a service running one that
/// publishes ports fronts the services it routes to.
pub const GATEWAY_IMAGES: &[&str] = &["nginx", "traefik", "caddy", "haproxy", "envoy"];

/// What stands for the adapter of an entry point whose handler may also be served at
/// paths that are not read ([`drift_core::MountFacts::elsewhere`]).
const SERVED_ELSEWHERE: &str = "?";

/// The adapters of a Python application object ([`Boundaries::served`]).
const PYTHON_ADAPTERS: &[&str] = &["fastapi", "flask", "flask_restx", "django", "drf"];

/// Files of a Next.js application that can move its routes and that Drift does not
/// read, relative to the application's directory.
const NEXT_UNREAD: &[&str] = &[
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
    "middleware.ts",
    "middleware.js",
    "src/middleware.ts",
    "src/middleware.js",
    "proxy.ts",
    "proxy.js",
    "src/proxy.ts",
    "src/proxy.js",
];

/// The adapters whose entry points name every path a handler answers, or say that
/// they do not: a Python router or URLconf has an entry point for each mount, and one
/// whose mount is not read is under an unknown prefix (drift-py `Linker::chains`); a
/// Next.js route is its file's path. An Express, Hono or Fastify router has an entry
/// point for each mount Drift reads too (drift-ts `Linker::mount_chains`), but one
/// mounted in a way that is not read (in a callback, under a prefix that is a
/// variable) keeps its own path, and a NestJS controller's module and global
/// prefixes are not read: a route of those, in a service a gateway routes to, is
/// never said to be internal ([`Boundaries::expose`]).
pub const EVERY_MOUNT_LISTED: &[&str] =
    &["fastapi", "flask", "flask_restx", "django", "drf", "nextjs"];

/// One service of a compose file ([`Boundaries::read_compose_at`]).
struct Svc {
    name: String,
    /// Its code directory; none when it runs an image, or its code cannot be told.
    dir: Option<String>,
    published: bool,
    /// The [`GATEWAY_IMAGES`] image it runs or is built from, when it publishes ports.
    proxy: Option<&'static str>,
    labels: Vec<String>,
    /// Repo-relative paths it mounts.
    mounts: Vec<String>,
    fronts: bool,
    /// The image it runs, or the one its Dockerfile starts from; lower case.
    image: String,
    /// Each volume: its repo-relative source (none when it is not in the repository)
    /// and its path in the container.
    volumes: Vec<(Option<String>, String)>,
    /// What its Dockerfile makes of the image, and the build context.
    built: Option<(gateway::Built, String)>,
    /// Lower-case names other containers reach it by.
    names: Vec<String>,
    /// `links` aliases, lower case: (alias, service).
    links: Vec<(String, String)>,
    /// Keys of its definition that may write or mount configuration Drift does not read.
    rewired: Vec<&'static str>,
    /// Why it is never said to be internal: part of its definition is not read, or
    /// says the compose network is not the only way to it.
    caveat: Option<String>,
    /// The application object it serves ([`Started::target`]).
    target: Option<(String, String)>,
    /// It serves a Next.js application.
    next: bool,
    /// It is built from a Dockerfile (`build`), not run from an image alone.
    builds: bool,
    /// The networks it names; empty when it is on the default one.
    networks: Vec<String>,
    /// Why what it starts with, or its environment, is not read ([`started`]).
    unread_start: Option<String>,
    /// Its env files that are not in the repository ([`Started::absent_env`]).
    absent_env: Vec<String>,
    /// Its definition as text, lower case: what its command and environment say.
    said: String,
}

/// Images that serve data, not other services' HTTP: one that publishes ports is no
/// proxy ([`Svc::may_proxy`]).
const DATA_IMAGES: &[&str] = &[
    "postgres",
    "postgis",
    "pgvector",
    "timescaledb",
    "mysql",
    "mariadb",
    "mongo",
    "redis",
    "valkey",
    "memcached",
    "rabbitmq",
    "kafka",
    "redpanda",
    "zookeeper",
    "nats",
    "elasticsearch",
    "opensearch",
    "clickhouse",
    "cassandra",
    "neo4j",
    "qdrant",
    "minio",
    "localstack",
    "azurite",
    "mailhog",
    "mailpit",
];

/// Reverse-proxy and gateway images beyond [`GATEWAY_IMAGES`]: a service built from
/// one is a proxy, not an application of the repository.
const PROXY_IMAGES: &[&str] = &[
    "openresty",
    "kong",
    "httpd",
    "apache2",
    "varnish",
    "squid",
    "tengine",
    "apisix",
    "krakend",
    "tyk-gateway",
    "oauth2-proxy",
    "nginx-proxy",
    "nginx-unprivileged",
    "nginx-ingress",
];

impl Svc {
    /// The last part of its image's repository: `registry.example.com/team/nginx:prod`
    /// -> `nginx`.
    fn image_name(&self) -> &str {
        let last = self.image.rsplit('/').next().unwrap_or_default();
        last.split([':', '@']).next().unwrap_or_default()
    }

    /// Whether it may route requests to other services of the file: anything but a
    /// data store, a stock nginx image with nothing mounted and nothing rewired (what
    /// it holds proxies nothing), and an application built from the repository's code
    /// (what such an application forwards is its own entry points', which are read).
    fn may_proxy(&self) -> bool {
        let name = self.image_name();
        if DATA_IMAGES.contains(&name) {
            return false;
        }
        let stock = !self.builds
            && STOCK_NGINX.contains(&image_repository(&self.image))
            && self.volumes.is_empty()
            && self.rewired.is_empty();
        if stock {
            return false;
        }
        let proxy = GATEWAY_IMAGES.contains(&name) || PROXY_IMAGES.contains(&name);
        proxy || !self.builds
    }

    /// False only when both name their networks and name none in common.
    fn shares_a_network_with(&self, other: &Svc) -> bool {
        self.networks.is_empty()
            || other.networks.is_empty()
            || self.networks.iter().any(|n| other.networks.contains(n))
    }

    /// Why this service is not internal though it publishes no ports
    /// ([`Svc::caveat`]).
    fn network(&self, _who: &str) -> Option<String> {
        self.caveat.clone()
    }
}

/// What an internal verdict says of the services that call this one as clients.
fn called_by(clients: &[String]) -> String {
    match clients {
        [] => String::new(),
        [first, second, third, rest @ ..] if !rest.is_empty() => format!(
            "; called by {first}, {second}, {third} and {} more as clients",
            rest.len()
        ),
        names => format!("; called by {} as a client", names.join(", ")),
    }
}

/// Whether `text` names one of `names` as a host: after `://`, or before a port.
fn names_host(text: &str, names: &[String]) -> bool {
    let text = text.to_lowercase();
    let word = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.';
    names.iter().filter(|n| !n.is_empty()).any(|n| {
        text.match_indices(n.as_str()).any(|(i, _)| {
            let before = &text[..i];
            let after = &text[i + n.len()..];
            let starts = !before.ends_with(word);
            let url = before.ends_with("://") || before.ends_with('@');
            let port = after
                .strip_prefix(':')
                .is_some_and(|p| p.starts_with(|c: char| c.is_ascii_digit()));
            let ends = !after.starts_with(word);
            (url && ends) || (starts && port)
        })
    })
}

/// What can proxy requests in an application of the repository: a library among
/// its dependencies (by manifest), or a framework's own configuration file. The
/// list to extend: an application with one of these that names another service may
/// relay requests to it, and that service is then never said to be internal. An
/// application with none of them that names a service calls it as a client.
const PROXY_LIBRARIES: &[(&str, &[&str])] = &[
    (
        "package.json",
        &[
            "http-proxy-middleware",
            "http-proxy",
            "express-http-proxy",
            "@fastify/http-proxy",
            "fastify-http-proxy",
            "@fastify/reply-from",
            "koa-proxies",
            "koa-proxy",
            "next-http-proxy-middleware",
            "node-http-proxy",
            "redbird",
        ],
    ),
    (
        "pyproject.toml",
        &[
            "asgiproxy",
            "fastapi-proxy-lib",
            "django-revproxy",
            "starlette-proxy",
            "mitmproxy",
        ],
    ),
    (
        "requirements.txt",
        &[
            "asgiproxy",
            "fastapi-proxy-lib",
            "django-revproxy",
            "starlette-proxy",
            "mitmproxy",
        ],
    ),
];
/// Configuration files of a framework that can rewrite a request to another host.
const PROXY_CONFIGS: &[&str] = &[
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
    "middleware.ts",
    "middleware.js",
    "src/middleware.ts",
    "src/middleware.js",
    "proxy.ts",
    "proxy.js",
    "vercel.json",
    "nuxt.config.ts",
    "nuxt.config.js",
    "vite.config.ts",
    "vite.config.js",
];

/// Why the application `p` (built from the repository) may relay requests to `to`:
/// it can proxy ([`PROXY_LIBRARIES`], [`PROXY_CONFIGS`]) and names `to` as a host, in
/// its compose definition, in the configuration file, or in a file of its code; a
/// configuration file with a rewrite or proxy target that is not a literal
/// ([`unread_proxy_target`]) can proxy to whatever the application names. None
/// when it cannot proxy, or names it nowhere Drift looks (at most 3000 files of its
/// directory, 256 KiB each).
fn relay(root: &Path, p: &Svc, to: &Svc) -> Option<String> {
    let dir = p.dir.as_ref().filter(|_| p.builds)?;
    let at = |file: &str| join_dir(dir, file).and_then(|rel| read_small(&root.join(rel)));
    // A configuration file that names the host says so itself.
    for file in PROXY_CONFIGS {
        if at(file).is_some_and(|text| names_host(&text, &to.names)) {
            return Some(format!(
                "{} names it",
                join_dir(dir, file).unwrap_or_default()
            ));
        }
    }
    // A rewrite or proxy setting whose target is not a literal (an environment
    // variable, a template) may be any host the application is given: this one,
    // when the application names it anywhere.
    let setting = || {
        PROXY_CONFIGS.iter().find_map(|file| {
            let what = unread_proxy_target(&at(file)?)?;
            Some(format!(
                "{} sets `{what}` to a target that is not a literal",
                join_dir(dir, file)?
            ))
        })
    };
    let library = PROXY_LIBRARIES
        .iter()
        .find_map(|(manifest, libraries)| {
            let text = at(manifest)?;
            let found = libraries.iter().find(|l| {
                text.match_indices(*l).any(|(i, _)| {
                    let word =
                        |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '/';
                    !text[..i].ends_with(word) && !text[i + l.len()..].starts_with(word)
                })
            })?;
            Some(format!("{found} in {}", join_dir(dir, manifest)?))
        })
        .or_else(setting)?;
    if names_host(&p.said, &to.names) {
        return Some(format!("{library}, and its compose definition names it"));
    }
    let named = named_in_files(root, dir, &to.names)?;
    Some(format!("{library}, and {named}"))
}

/// Where the code under `dir` names one of `names` as a host: `<file> names it`, or
/// that `dir` has more files than are looked through (at most 3000, 256 KiB each),
/// which counts as naming it. None when no file does.
fn named_in_files(root: &Path, dir: &str, names: &[String]) -> Option<String> {
    const MAX_FILES: usize = 3000;
    const TEXT: &[&str] = &[
        "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "py", "toml", "yaml", "yml", "env", "conf",
    ];
    let walker = ignore::WalkBuilder::new(root.join(dir))
        .follow_links(false)
        .hidden(false)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .filter_entry(|e| e.file_name() != "node_modules" && e.file_name() != ".git")
        .sort_by_file_path(|a, b| a.cmp(b))
        .build();
    let mut seen = 0;
    for e in walker.filter_map(Result::ok) {
        let path = e.path();
        let text_file = path
            .extension()
            .and_then(|x| x.to_str())
            .is_some_and(|x| TEXT.contains(&x))
            || path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(".env"));
        if !text_file || !path.is_file() {
            continue;
        }
        seen += 1;
        if seen > MAX_FILES {
            return Some(format!(
                "{dir} has more files than Drift looks through for its name"
            ));
        }
        if read_small(path).is_some_and(|text| names_host(&text, names)) {
            let rel = path.strip_prefix(root).unwrap_or(path);
            return Some(format!(
                "{} names it",
                rel.to_string_lossy().replace('\\', "/")
            ));
        }
    }
    None
}

/// The first rewrite or proxy setting of a framework configuration file
/// ([`PROXY_CONFIGS`]) whose target is not written out: the value of a `destination`
/// or `target` key, or the argument of `rewrite(...)`, that is not a string literal
/// (a template with `${...}`, a name, a call). `new URL("/path", ...)` with a literal
/// path of the application itself is written out. None when every one is, or the
/// file has none.
fn unread_proxy_target(text: &str) -> Option<&'static str> {
    // The value starts a quoted string with nothing interpolated.
    let literal = |value: &str| {
        let value = value.trim_start();
        let value = value
            .strip_prefix("new URL(")
            .map_or(value, |inner| inner.trim_start());
        match value.chars().next() {
            Some(q @ ('"' | '\'')) => value[1..].contains(q),
            Some('`') => value[1..]
                .split_once('`')
                .is_some_and(|(body, _)| !body.contains("${")),
            _ => false,
        }
    };
    let word = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '$';
    for (key, what) in [
        ("destination", "destination"),
        ("target", "target"),
        ("rewrite(", "rewrite(...)"),
    ] {
        for (i, _) in text.match_indices(key) {
            // Part of a longer name.
            if text[..i].ends_with(word) {
                continue;
            }
            let rest = &text[i + key.len()..];
            let value = if key.ends_with('(') {
                rest
            } else {
                // `key: value`, `"key": value`.
                let rest = rest.trim_start_matches(['"', '\'']).trim_start();
                match rest.strip_prefix(':') {
                    Some(v) => v,
                    None => continue,
                }
            };
            // An object or a list holds its own keys, read where they are.
            if value.trim_start().starts_with(['{', '[']) {
                continue;
            }
            if !literal(value) {
                return Some(what);
            }
        }
    }
    None
}

/// The stock nginx images: what they hold beyond what is mounted or copied in routes
/// nothing to another service.
const STOCK_NGINX: &[&str] = &[
    "nginx",
    "library/nginx",
    "docker.io/nginx",
    "docker.io/library/nginx",
    "nginxinc/nginx-unprivileged",
    "docker.io/nginxinc/nginx-unprivileged",
];

/// An image's repository, without its tag or digest: `nginx:1.27-alpine` -> `nginx`.
fn image_repository(image: &str) -> &str {
    let image = image.split('@').next().unwrap_or_default();
    match image.rfind(':') {
        Some(i) if !image[i..].contains('/') => &image[..i],
        _ => image,
    }
}

/// How many configuration files of one directory are read.
const CONFIG_FILES: usize = 20;

/// The gateway `g` read from its nginx configuration under `root`: the `.conf` and
/// `.template` files it mounts under `/etc/nginx` and those its Dockerfile copies
/// there, a directory standing for the files directly in it. None when it is not
/// nginx or no configuration of it is in the repository; an error when a file is not
/// nginx configuration.
///
/// What may add configuration that is not in those files is recorded as unread
/// ([`Gateway::unread`]): an image other than the stock one, a Dockerfile step other
/// than a copy, a `command` or `entrypoint`, a mount from outside the repository.
///
/// A host is a service of the file (`svcs`) by its name, `container_name`,
/// `hostname`, a network alias, a `links` alias of the gateway, or the name compose
/// gives its container. The gateway itself is no service; an address, or any other
/// name when the gateway names hosts of its own, cannot be told.
fn nginx_gateway(root: &Path, g: &Svc, svcs: &[Svc]) -> Result<Option<Gateway>, String> {
    if g.proxy != Some("nginx") {
        return Ok(None);
    }
    let mut unread: Vec<String> = Vec::new();
    let mut sources: Vec<(Option<String>, &str)> = g
        .volumes
        .iter()
        .filter(|(_, target)| gateway::nginx_path(target))
        .map(|(source, target)| (source.clone(), target.as_str()))
        .collect();
    if let Some((built, context)) = &g.built {
        sources.extend(
            built
                .copies
                .iter()
                .map(|(source, target)| (join_dir(context, source), target.as_str())),
        );
        unread.extend(
            built
                .unread
                .as_ref()
                .map(|step| format!("a step of its Dockerfile (`{step}`)")),
        );
    }
    if !STOCK_NGINX.contains(&image_repository(&g.image)) {
        unread.push(format!("what the image {} holds", g.image));
    }
    unread.extend(g.rewired.iter().map(|k| format!("what its `{k}` does")));
    let is_conf = |p: &str| p.ends_with(".conf") || p.ends_with(".template");
    let mut files: Vec<(String, String)> = Vec::new();
    for (source, target) in sources {
        let Some(source) = source else {
            unread.push(format!("{target}, mounted from outside the repository"));
            continue;
        };
        let path = root.join(&source);
        let found: Vec<String> = if path.is_dir() {
            let entries: Vec<std::path::PathBuf> = std::fs::read_dir(&path)
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .map(|e| e.path())
                .collect();
            let mut names: Vec<String> = entries
                .iter()
                .filter(|p| p.is_file())
                .filter_map(|p| Some(p.file_name()?.to_str()?.to_string()))
                .filter(|n| is_conf(n))
                .collect();
            names.sort();
            if names.len() > CONFIG_FILES || entries.iter().any(|p| p.is_dir()) {
                unread.push(format!(
                    "what {source} holds beyond the first {CONFIG_FILES} files directly in it"
                ));
            }
            names
                .into_iter()
                .take(CONFIG_FILES)
                .map(|n| format!("{source}/{n}"))
                .collect()
        } else if is_conf(&source) || is_conf(target) {
            vec![source]
        } else {
            // A certificate, a password file, a page: not configuration.
            Vec::new()
        };
        for rel in found {
            match read_small(&root.join(&rel)) {
                Some(text) => files.push((rel, text)),
                None => unread.push(format!("{rel}, which is not in the repository")),
            }
        }
    }
    if files.is_empty() {
        return Ok(None);
    }
    files.sort();
    files.dedup();
    let resolve = |host: &str| resolve_host(g, svcs, host);
    let mut read = Gateway::read(&g.name, &files, &resolve)?;
    read.unread.splice(
        0..0,
        unread
            .into_iter()
            .map(|what| format!("gateway {}: {what} is not read", g.name)),
    );
    Ok(Some(read))
}

/// What the host a gateway `g` names is, among the services `svcs` of its compose
/// file: a service by its name, `container_name`, `hostname`, a network alias, a
/// `links` alias of the gateway, or the name compose gives its container. The gateway
/// itself is no service; any other name, or an address, cannot be told.
fn resolve_host(g: &Svc, svcs: &[Svc], host: &str) -> Target {
    {
        // A name with a dot at the end is the same name, and one qualified with the
        // network's (`api.services_default`) is the service its first label names.
        let host = host.to_lowercase();
        let host = host.trim_end_matches('.').to_string();
        let first = host.split('.').next().unwrap_or_default().to_string();
        let address = host.starts_with('[')
            || host
                .split('.')
                .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
        let mut found: Vec<String> = svcs
            .iter()
            .filter(|s| {
                let name = s.name.to_lowercase();
                s.names.contains(&host)
                    || (!address && s.names.contains(&first))
                    || g.links.contains(&(host.clone(), name.clone()))
                    // The name compose gives a container: `<project>-<service>-<n>`.
                    || ['-', '_'].iter().any(|sep| {
                        host.rsplit_once(*sep).is_some_and(|(left, n)| {
                            !n.is_empty()
                                && n.chars().all(|c| c.is_ascii_digit())
                                && left.ends_with(&format!("{sep}{name}"))
                        })
                    })
            })
            .map(|s| s.name.clone())
            .collect();
        found.sort();
        if !found.is_empty() {
            Target::Services(found)
        } else if host == "localhost" || host.starts_with("127.") || host == "[::1]" {
            // The gateway itself: its other servers are read as reachable already.
            Target::Nowhere
        } else {
            // An address, a socket, a name that is no service of the file: where it
            // leads is not known, and it may be a service by a name Drift does not
            // read. Never nowhere.
            Target::Unresolved
        }
    }
}

/// The stock Traefik and Caddy images: what they hold routes nothing by itself.
const STOCK_TRAEFIK: &[&str] = &[
    "traefik",
    "library/traefik",
    "docker.io/traefik",
    "docker.io/library/traefik",
];
const STOCK_CADDY: &[&str] = &[
    "caddy",
    "library/caddy",
    "docker.io/caddy",
    "docker.io/library/caddy",
];

/// The Traefik gateway `g` of the compose file `file`, read from the labels of the
/// file's services ([`crate::proxies::traefik`]). What may add routers that are not
/// on the labels is recorded as unread: a configuration file it mounts, another
/// provider, an image that is not the stock one.
fn traefik_gateway(file: &str, g: &Svc, svcs: &[Svc]) -> Gateway {
    let services: Vec<crate::proxies::Labelled> = svcs
        .iter()
        .map(|s| crate::proxies::Labelled {
            name: &s.name,
            labels: &s.labels,
        })
        .collect();
    // Anything mounted that may be configuration: not the docker socket, not
    // certificates or logs.
    let config: Vec<String> = g
        .volumes
        .iter()
        .map(|(_, target)| target.clone())
        .filter(|t| {
            let t = t.to_lowercase();
            t.ends_with(".yml")
                || t.ends_with(".yaml")
                || t.ends_with(".toml")
                || t.starts_with("/etc/traefik")
        })
        .collect();
    crate::proxies::traefik(
        &g.name,
        file,
        &g.said,
        &config,
        STOCK_TRAEFIK.contains(&image_repository(&g.image)),
        &services,
    )
}

/// The Caddy gateway `g` read from the Caddyfile it mounts from the repository
/// ([`crate::proxies::caddy`]). None when it mounts none; an error when the file is
/// not a Caddyfile Drift reads. What may configure it otherwise is recorded as
/// unread: an image that is not the stock one, a `command` or `entrypoint`, a
/// Caddyfile from outside the repository.
fn caddy_gateway(root: &Path, g: &Svc, svcs: &[Svc]) -> Result<Option<Gateway>, String> {
    let mut unread: Vec<String> = Vec::new();
    let mut files: Vec<(String, String)> = Vec::new();
    for (source, target) in &g.volumes {
        if !(target.ends_with("/Caddyfile") || target == "/etc/caddy" || target == "/etc/caddy/") {
            continue;
        }
        let rel = match source {
            Some(s) if target.ends_with("/Caddyfile") => s.clone(),
            Some(s) => format!("{s}/Caddyfile"),
            None => {
                unread.push(format!("{target}, mounted from outside the repository"));
                continue;
            }
        };
        match read_small(&root.join(&rel)) {
            Some(text) => files.push((rel, text)),
            None => unread.push(format!("{rel}, which is not in the repository")),
        }
    }
    if files.is_empty() {
        return Ok(None);
    }
    if !STOCK_CADDY.contains(&image_repository(&g.image)) {
        unread.push(format!("what the image {} holds", g.image));
    }
    unread.extend(g.rewired.iter().map(|k| format!("what its `{k}` does")));
    let resolve = |host: &str| resolve_host(g, svcs, host);
    let mut read = crate::proxies::caddy(&g.name, &files, &resolve)?;
    read.unread.splice(
        0..0,
        unread
            .into_iter()
            .map(|what| format!("gateway {}: {what} is not read", g.name)),
    );
    Ok(Some(read))
}

/// The override files compose merges into a compose file of the same directory
/// without being asked ([`Boundaries::load`]).
pub const COMPOSE_OVERRIDES: &[&str] = &[
    "compose.override.yaml",
    "compose.override.yml",
    "docker-compose.override.yaml",
    "docker-compose.override.yml",
];

/// Merges `over` into `base` as compose merges an override file: mappings key by key,
/// sequences one after the other, anything else replaced. A `command`, an
/// `entrypoint` and a health check's `test` are replaced whole.
fn merge_compose(base: &mut serde_json::Value, over: serde_json::Value, depth: usize) {
    use serde_json::Value;
    match (base, over) {
        (Value::Object(b), Value::Object(o)) if depth < 16 => {
            for (k, v) in o {
                match b.get_mut(&k) {
                    Some(slot) if !matches!(k.as_str(), "command" | "entrypoint" | "test") => {
                        merge_compose(slot, v, depth + 1);
                    }
                    _ => {
                        b.insert(k, v);
                    }
                }
            }
        }
        (Value::Array(b), Value::Array(o)) => b.extend(o),
        (slot, v) => *slot = v,
    }
}

/// What the service `who` (definition `def`, of the compose file in `base`, code in
/// `dir`) starts with: the application object it serves, or the first thing in its
/// start command or its environment that Drift does not know, as written.
///
/// The start command is compose's `entrypoint` and `command`, else the `ENTRYPOINT`
/// and `CMD` of the Dockerfile (`image`: the build context and the Dockerfile's
/// text), read word by word against lists of what is known ([`crate::start`]): the
/// server program, each option, each statement of a script it runs (found where a
/// bind mount or the Dockerfile's `COPY`s put it), each variable (from the
/// Dockerfile's `ENV`, the env files in the repository, `environment`; compose's own
/// from the `.env` beside the compose file). The module the server is started on is
/// found in the image the same way, else as the one file of that name in the
/// service's code. Not known, and said: anything that is not on a list, a variable
/// nothing in the repository sets, a setting of the server in the environment that
/// is not known, no start command at all. An env file that is not in the repository
/// is listed apart ([`Started::absent_env`]): a known limit, not an unknown.
fn started(
    root: &Path,
    base: &str,
    who: &str,
    def: &serde_json::Map<String, serde_json::Value>,
    image: Option<(&str, &str)>,
    volumes: &[(Option<String>, String)],
    dir: Option<&str>,
) -> Started {
    use serde_json::Value;
    let mut unread: Option<String> = None;
    let mut absent_env: Vec<String> = Vec::new();
    let mut env_texts: Vec<String> = Vec::new();
    let env_files: Vec<String> = match def.get("env_file") {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| match x {
                Value::String(s) => Some(s.clone()),
                Value::Object(o) => Some(o.get("path")?.as_str()?.to_string()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    for file in env_files {
        let rel = join_dir(base, &file);
        let there = rel.as_ref().is_some_and(|rel| root.join(rel).exists());
        match rel.as_ref().and_then(|rel| read_small(&root.join(rel))) {
            Some(text) => env_texts.push(text),
            // THE RULE FOR AN ENV FILE THAT IS NOT IN THE REPOSITORY (a gitignored
            // `.env`, whether compose marks it required or optional): it is outside
            // what Drift can read and does not by itself make a route unknown, or
            // hardly a compose project would have an internal route. It is never
            // silent: the caller warns of it once and every internal verdict reached
            // past it says so. To make such a file unknown instead, set `unread` here
            // as the arm below does.
            None if !there => absent_env.push(rel.unwrap_or(file)),
            // In the repository, and not read (too large, not a file).
            None => {
                unread.get_or_insert_with(|| {
                    format!(
                        "{who} takes its environment from {}, which Drift cannot read: it may set a root path",
                        rel.unwrap_or(file)
                    )
                });
            }
        }
    }
    // What the container is given as environment, as far as the repository says:
    // the Dockerfile's `ENV`s, then the env files, then `environment`.
    let mut env = crate::start::Env::default();
    let mut texts: Vec<String> = vec![def.iter().map(|(k, v)| format!("{k} {v}\n")).collect()];
    if let Some((_, text)) = image {
        env.dockerfile(text);
        texts.push(text.to_string());
    }
    for text in &env_texts {
        env.file(text);
        texts.push(text.clone());
    }
    match def.get("environment") {
        Some(Value::Object(m)) => {
            for (k, v) in m {
                let value = match v {
                    Value::String(s) => Some(s.clone()),
                    Value::Null => None,
                    other => Some(other.to_string()),
                };
                env.set(k, value.as_deref());
            }
        }
        Some(Value::Array(a)) => {
            for item in a.iter().filter_map(|x| x.as_str()) {
                match item.split_once('=') {
                    Some((k, v)) => env.set(k, Some(v)),
                    None => env.set(item, None),
                }
            }
        }
        _ => {}
    }
    let words_of = |v: Option<&Value>| -> Option<Vec<String>> {
        match v {
            Some(Value::String(s)) => Some(s.split_whitespace().map(str::to_string).collect()),
            Some(Value::Array(a)) => Some(
                a.iter()
                    .filter_map(|x| x.as_str())
                    .map(str::to_string)
                    .collect(),
            ),
            _ => None,
        }
    };
    // Compose puts its own variables into `command` and `entrypoint` before the
    // container sees them, from the `.env` beside the compose file.
    let mut dotenv = crate::start::Env::default();
    if let Some(text) = join_dir(base, ".env").and_then(|rel| read_small(&root.join(rel))) {
        dotenv.file(&text);
    }
    let mut not_interpolated: Option<String> = None;
    let mut composed = |v: Option<&Value>| -> Option<Vec<String>> {
        Some(
            words_of(v)?
                .into_iter()
                .map(|w| {
                    crate::start::interpolate(&w, &dotenv.known).unwrap_or_else(|why| {
                        not_interpolated.get_or_insert(why);
                        w
                    })
                })
                .flat_map(|w| {
                    w.split_whitespace()
                        .map(str::to_string)
                        .collect::<Vec<String>>()
                })
                .collect(),
        )
    };
    let parsed = image.and_then(|(_, text)| crate::image::Image::parse(text));
    let of_image =
        |f: fn(&crate::image::Image) -> Vec<String>| parsed.as_ref().map(f).unwrap_or_default();
    let words: Vec<String> = match (
        composed(def.get("entrypoint")),
        composed(def.get("command")),
    ) {
        (Some(mut entrypoint), command) => {
            entrypoint.extend(command.unwrap_or_default());
            entrypoint
        }
        (None, Some(command)) => {
            let mut words = of_image(crate::image::Image::entrypoint);
            words.extend(command);
            words
        }
        (None, None) => of_image(crate::image::Image::start),
    };
    let workdir = match def.get("working_dir").and_then(|w| w.as_str()) {
        Some(w) => w.to_string(),
        None => parsed.as_ref().map_or("/".to_string(), |i| i.workdir()),
    };
    // The file of the repository that is at an absolute path of the container: a
    // bind mount over the path, else what the image holds there.
    let locate = |at: &str| -> Result<String, String> {
        let mounted = volumes.iter().find_map(|(source, target)| {
            let target = target.trim_end_matches('/');
            let rest = at.strip_prefix(target)?;
            (rest.is_empty() || rest.starts_with('/')).then(|| {
                source
                    .as_ref()
                    .map(|s| format!("{s}{rest}"))
                    .ok_or_else(|| "it is on a volume that is not in the repository".to_string())
            })
        });
        mounted.unwrap_or_else(|| match (&parsed, image) {
            (Some(parsed), Some((context, _))) => parsed
                .source(at, &|p| {
                    join_dir(context, p).is_some_and(|rel| root.join(rel).is_file())
                })
                .and_then(|p| {
                    join_dir(context, &p).ok_or_else(|| "it is outside the repository".to_string())
                }),
            _ => Err("there is no Dockerfile Drift reads to say where it comes from".to_string()),
        })
    };
    let scripts: std::cell::RefCell<Vec<String>> = std::cell::RefCell::new(Vec::new());
    let file = |at: &str| -> Result<(String, String), String> {
        let rel = locate(at)?;
        let text = read_small(&root.join(&rel)).ok_or_else(|| format!("{rel} is not read"))?;
        scripts.borrow_mut().push(text.clone());
        Ok((rel, text))
    };
    let mut target = None;
    let mut next = false;
    let said: Result<(), String> = (|| {
        if let Some(why) = not_interpolated {
            return Err(format!("its start command has {why}"));
        }
        if words.is_empty() {
            return Err("what it starts with is not in the repository (no `command`, and no CMD in a Dockerfile Drift reads)".to_string());
        }
        let start = crate::start::read(&words, &env, &workdir, &file);
        let serves = start
            .serves
            .map_err(|what| format!("its start command has {what}"))?;
        texts.extend(scripts.borrow().iter().cloned());
        let all: Vec<&str> = texts.iter().map(String::as_str).collect();
        if let Some(what) = crate::start::server_env(&all) {
            return Err(format!("what it is given or starts with names {what}"));
        }
        match serves {
            crate::start::Serves::Next => next = true,
            crate::start::Serves::Python { module, attr } => {
                // gunicorn reads this file from where it starts, unasked.
                let conf = crate::image::absolute(&start.workdir, "gunicorn.conf.py");
                if words.iter().any(|w| w.contains("gunicorn")) && locate(&conf).is_ok() {
                    return Err("gunicorn reads gunicorn.conf.py, which Drift does not".to_string());
                }
                let path = module.replace('.', "/");
                let found = [format!("{path}.py"), format!("{path}/__init__.py")]
                    .iter()
                    .find_map(|p| locate(&crate::image::absolute(&start.workdir, p)).ok())
                    .map(Ok)
                    .unwrap_or_else(|| module_in(root, dir, &path));
                let file =
                    found.map_err(|why| format!("it starts on `{module}:{attr}`, and {why}"))?;
                target = Some((file, attr));
            }
        }
        Ok(())
    })();
    if let Err(why) = said {
        unread.get_or_insert_with(|| {
            format!("{who}: {why}; so where its routes are served is not known")
        });
    }
    Started {
        unread,
        absent_env,
        target,
        next,
    }
}

/// The one file under the service's directory `dir` that is the module `path`
/// (`app/main`): where an image is not read far enough to say what is at the path
/// the server looks in, the module the command names is the one file of that name in
/// the service's code. None, or more than one: not known.
fn module_in(root: &Path, dir: Option<&str>, path: &str) -> Result<String, String> {
    const MAX_FILES: usize = 20_000;
    let Some(dir) = dir else {
        return Err("where its code is cannot be told".to_string());
    };
    let wanted = [format!("{path}.py"), format!("{path}/__init__.py")];
    let walker = ignore::WalkBuilder::new(root.join(dir))
        .follow_links(false)
        .hidden(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .sort_by_file_path(|a, b| a.cmp(b))
        .build();
    let mut found: Vec<String> = Vec::new();
    for (seen, e) in walker.filter_map(Result::ok).enumerate() {
        if seen > MAX_FILES {
            return Err(format!(
                "{dir} has more files than Drift looks through for it"
            ));
        }
        let rel = e.path().strip_prefix(root).unwrap_or(e.path());
        let rel = rel.to_string_lossy().replace('\\', "/");
        let inside = rel
            .strip_prefix(dir)
            .unwrap_or(&rel)
            .trim_start_matches('/');
        if wanted
            .iter()
            .any(|w| inside == w || inside.ends_with(&format!("/{w}")))
            && !is_test_path(&rel)
        {
            found.push(rel);
        }
    }
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(format!("no such module is found in {dir}")),
        n => Err(format!("{n} files in {dir} could be that module")),
    }
}

/// What [`started`] found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Started {
    /// Why the start command, or what the service is given, is not all read: the
    /// construct Drift does not know, as written.
    unread: Option<String>,
    /// The env files that are not in the repository, repo-relative.
    absent_env: Vec<String>,
    /// The application object it serves: the file of the repository, and the name.
    target: Option<(String, String)>,
    /// It serves a Next.js application (`next start`).
    next: bool,
}

/// The text of a file of at most 256 KiB; none when it is larger or cannot be read.
fn read_small(path: &Path) -> Option<String> {
    std::fs::metadata(path)
        .ok()
        .filter(|m| m.is_file() && m.len() <= 256 * 1024)
        .and_then(|_| std::fs::read_to_string(path).ok())
}

/// Text of a gateway's mounted configuration: the file, or the files directly in the
/// directory (at most 20, 256 KiB each); nothing when it cannot be read.
fn read_config(path: &Path) -> String {
    const MAX_FILES: usize = 20;
    const MAX_BYTES: u64 = 256 * 1024;
    let read = |p: &Path| {
        std::fs::metadata(p)
            .ok()
            .filter(|m| m.is_file() && m.len() <= MAX_BYTES)
            .and_then(|_| std::fs::read_to_string(p).ok())
            .unwrap_or_default()
    };
    if path.is_dir() {
        let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(path)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_file())
            .collect();
        files.sort();
        files
            .iter()
            .take(MAX_FILES)
            .map(|p| read(p))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        read(path)
    }
}

/// `rel` (a compose `build` directory) read from the directory `base`, normalised
/// (`deploy` + `../api` -> `api`); `None` when it leaves the repository.
fn join_dir(base: &str, rel: &str) -> Option<String> {
    let mut segs: Vec<&str> = base.split('/').filter(|s| !s.is_empty()).collect();
    for seg in rel.trim().split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segs.pop()?;
            }
            s => segs.push(s),
        }
    }
    Some(segs.join("/"))
}

/// `./backend/` -> `backend`; `.` -> "".
fn normal_dir(d: &str) -> String {
    let d = d.trim().trim_start_matches("./").trim_end_matches('/');
    if d == "." {
        String::new()
    } else {
        d.to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct EntryRow {
    pub path: String,
    /// Package directory of the file ("" for the root package).
    pub package: String,
    pub symbol: String,
    pub line: u32,
    /// `http`, `page`, `server_action`, `graphql`, `cron`, `job`, ...
    pub kind: String,
    pub method: Option<String>,
    pub route: Option<String>,
    /// Guards applied, outermost first (short names): the call wrappers and decorators
    /// that turn callers away ([`authenticates`]), the guards in the handler's body (ending
    /// in ` (body call)` or ` (body check)`, as the practice map reads them), guards applied by configuration
    /// (ending in ` (settings)`: `IsAuthenticated (settings)`) and hooks the whole app
    /// runs (ending in ` (app hook)`, a Nest `APP_GUARD` among them). Nest's `@UseGuards`
    /// is listed by the guard classes it runs that prove a guard. A hook or a middleware
    /// registered beside a TypeScript route (a Fastify `addHook`, `app.use("/api/*",
    /// requireUser)`, a hook an options object spread into the route gives it) is a
    /// middleware of its application (ending in ` (middleware)`), and a method of a
    /// class is a guard by its own body. An entry point with none is unguarded.
    pub guards: Vec<String>,
    /// The other call wrappers and decorators, outermost first (short names): what wraps
    /// the entry point but turns no caller away (a FastAPI `Depends(get_db)`, an error
    /// mapper), so it is no guard. Not serialised when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub wrappers: Vec<String>,
    /// Wrappers whose guard cannot be read, so whether the entry point is guarded is
    /// unknown, never assumed: Nest's `UseGuards` with no guard class recorded, a guard
    /// class (or an `APP_GUARD`, ending in ` (app hook)`) the facts do not define, and an
    /// in-repo decorator built on `UseGuards` (`applyDecorators(UseGuards(X))`, whose class
    /// is not recorded). Also a call in the handler's body (ending in ` (body call)`)
    /// that looks like a guard and is not proven to turn a caller away
    /// ([`BodyCall::Unproven`]: `assertSession()` throwing a plain `Error`), which the
    /// practice map reads as unknown. In TypeScript also a plain value given where a
    /// handler goes, and a `try` in the handler's body whose `catch` answers 401 for
    /// some of what it catches only (ending in ` (body check)`). A Next.js page under a
    /// layout that has a guard ([`LAYOUT_MAY_REDIRECT`], [`under_guarded_layouts`]). An entry point with none of `guards`
    /// but one of these is not listed as having no guard. Not serialised when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub opaque: Vec<String>,
    /// Authentication that identifies the caller but rejects nothing on its own
    /// (`TokenAuthentication (settings)`, a session read with no check): not a guard.
    /// The practice map's `identified` state, by the same instruments.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub authenticates: Vec<String>,
    /// Markers that open the entry point to anyone (`AllowAny`, `login_not_required`):
    /// the opposite of a guard.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub opens: Vec<String>,
    /// Validates input with a schema somewhere in its body.
    pub validates: bool,
    /// Sinks reached directly or through internal calls.
    pub reaches: Vec<Reach>,
    /// Environment variables read directly.
    pub reads: Vec<String>,
    /// Where it is reachable from ([`Boundaries`]).
    #[serde(default)]
    pub exposure: Exposure,
    /// What says so: `compose service api publishes ports`, or, for a route behind a
    /// gateway that is read, the location that carries it, that none does, or why it
    /// may be routed ([`Boundaries::expose`]). None when nothing speaks for the path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary: Option<String>,
    /// Its kind is one no remote caller reaches ([`LOCAL_KINDS`]): it stays in the
    /// inventory, but is never counted or listed as having no guard. Not serialised
    /// when false.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub local: bool,
    /// What each compose file says of the route, the most exposed first, when more
    /// than one describes its service: the first decides. Not serialised when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub descriptions: Vec<Description>,
    /// The exposure rests on a Terraform tie (`security.terraform`): a person's word
    /// that the target group forwards to this code and that nothing else of that
    /// Terraform lets a request in. Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub tied: bool,
    /// Of a row a remote caller reaches with no guard and nothing that may be one: what
    /// "no guard found in what Drift read" rests on, the same basis as the practice
    /// map's authentication `none` ([`crate::practices::basis::of_entry`]). Omitted
    /// otherwise (additive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<crate::practices::basis::Basis>,
    /// Of an `internal` row: the deployment descriptions read, and what was seen and
    /// not read (a description recognised and not read or left out, a YAML file not
    /// recognised, a skipped file of its directory): `internal` is what Drift found in
    /// what it read. Omitted otherwise (additive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exposure_basis: Option<crate::practices::basis::Basis>,
    /// The practice map knows its authentication and nothing of it turns a caller away
    /// on purpose: something opens it (a liveness probe, `AllowAny`) or a service's own
    /// credential is checked (a webhook's signature). A row with no guard then lacks
    /// none by the map's reading: [`regressions`] lists no such row as an added entry
    /// point without a guard. In process only, never serialised.
    #[serde(skip)]
    pub known_open: bool,
    /// Of a request entry point with no guard: the webhook signature verifiers its body
    /// checks the sending service by, for every request, with a failure that leaves the
    /// body ([`crate::practices::verified_signatures`], `svix Webhook.verify`). No sign-in is asked of such
    /// a caller, by design: the row is listed apart from those with no guard found, and
    /// is never guarded. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verifies_signature: Vec<String>,
}

/// What a row whose body verifies a webhook's signature says where its guards would
/// be named ([`EntryRow::verifies_signature`]).
pub fn signature_words(verifiers: &[String]) -> String {
    use crate::report::sanitize;
    format!(
        "verifies a signature ({}); no sign-in by design",
        sanitize(&verifiers.join(", "), 120)
    )
}

/// The heading of the entry points whose body verifies a webhook's signature.
pub const VERIFIES_SIGNATURE_HEADING: &str =
    "Entry points that verify a webhook signature (no sign-in by design)";

/// The heading of the entry points a remote caller reaches where Drift found no guard,
/// and nothing that may be one, in what it read.
pub const NO_GUARD_FOUND: &str = "Entry points where Drift found no guard";

/// Kinds of entry point no remote caller reaches, so "no guard" says nothing about them:
/// a `cli` command (an argparse, click or typer program, a console script, an npm `bin`)
/// is started by whoever already has a shell on the machine, with that person's rights.
///
/// Everything else stays counted. A request reaches `http`, `page`, `layout`,
/// `server_action`, `graphql`, `rpc`, `websocket` and `middleware` directly, and an
/// `agent_graph` (a graph `langgraph.json` names) is what a LangGraph server runs for the
/// clients that call it. `cron`, `job` and `consumer` have no caller of their own but act
/// on what a queue or a schedule hands them, which a remote party may have written, so
/// they are not assumed local.
pub const LOCAL_KINDS: &[&str] = &["cli"];

/// Whether a kind of entry point is one no remote caller reaches ([`LOCAL_KINDS`]).
pub fn local_kind(kind: &str) -> bool {
    LOCAL_KINDS.contains(&kind)
}

/// What is said of a local entry point where a guard would be named.
pub const LOCAL_NOTE: &str = "run locally, no remote caller";

/// Kinds of entry point a queue feeds: a message `consumer` takes what a broker hands
/// it. No caller is there to sign in, so "no guard" (a route nobody has to sign in
/// for) is not what its lack of one means: it is listed with its kind, with what it
/// reaches and validates, and is not counted among the entry points with no guard.
/// It is not local either: a remote party may have written the message.
pub const QUEUE_KINDS: &[&str] = &["consumer"];

/// Whether a kind of entry point is fed by a queue ([`QUEUE_KINDS`]).
pub fn queue_kind(kind: &str) -> bool {
    QUEUE_KINDS.contains(&kind)
}

/// What is said of a queue-fed entry point where a guard would be named.
pub const QUEUE_NOTE: &str = "fed by a queue, no caller to sign in";

/// Client files that reach one server-only module (or read one secret env var).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct LeakGroup {
    /// The server-only module reached (`lib/prisma.ts`, `pkg:server-only`) or `env:NAME`.
    pub reaches: String,
    /// `"use client"` files affected, sorted.
    pub clients: Vec<String>,
    /// Shortest import chain from the first client to `reaches`: where to cut.
    pub example: Vec<String>,
}

/// Share of a role's entry points that must have a guard for the members without it
/// to be listed as a [`GuardGap`].
pub const GUARD_GAP_SHARE: f64 = 0.9;

/// One entry point named in a [`GuardGap`].
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct EntryRef {
    pub path: String,
    pub symbol: String,
    pub line: u32,
    pub kind: String,
    pub method: Option<String>,
    pub route: Option<String>,
    /// The guards it does have (none: no guard, unless `opaque` or `local` says why
    /// that cannot be said).
    pub guards: Vec<String>,
    /// Markers that open it to anyone (`AllowAny`): the exception is explicit.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub opens: Vec<String>,
    /// What may guard it and cannot be read ([`EntryRow::opaque`]): with no guard, its
    /// guard is unknown, not absent. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opaque: Vec<String>,
    /// No remote caller reaches it ([`EntryRow::local`]). Omitted when false (additive).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub local: bool,
    /// What "no guard found in what Drift read" rests on ([`EntryRow::basis`]).
    /// Omitted otherwise (additive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<crate::practices::basis::Basis>,
    /// The webhook signature verifiers its body checks ([`EntryRow::verifies_signature`]).
    /// Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verifies_signature: Vec<String>,
}

impl EntryRef {
    /// What is said where its guards would be named: the guards, that its guard cannot
    /// be read, that it runs locally, or that it has none; the same four the
    /// inventory's own listing tells apart.
    pub fn has(&self) -> String {
        if !self.guards.is_empty() {
            self.guards.join(" > ")
        } else if !self.opaque.is_empty() {
            format!("guard unknown (opaque: {})", self.opaque.join(" > "))
        } else if !self.verifies_signature.is_empty() {
            signature_words(&self.verifies_signature)
        } else if self.local {
            LOCAL_NOTE.to_string()
        } else if queue_kind(&self.kind) {
            QUEUE_NOTE.to_string()
        } else {
            crate::practices::basis::no_guard(
                self.basis.as_ref().map_or(&[], |b| b.not_read.as_slice()),
            )
        }
    }
}

/// A guard that at least [`GUARD_GAP_SHARE`] of the entry points of one kind in one
/// place share, and the members that lack it. Learned from the repository, not
/// prescribed: the exceptions may be intended (webhooks, health checks, public pages),
/// so they are listed as facts with a member to copy from, and they never fail a check.
///
/// Roles are every directory from the package root down to the entry point's own, plus
/// the whole package; a gap is reported at the broadest role where the guard reaches
/// the share, and a narrower role adds a row only when it names an exception no
/// broader row for the same guard already names.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct GuardGap {
    /// Package directory ("" for the root package).
    pub package: String,
    /// Entry kind (`http`, `page`, `server_action`, ...).
    pub kind: String,
    /// Directory the role is limited to, repo-relative ("" for the whole package).
    pub dir: String,
    /// Short guard name, as in [`EntryRow::guards`].
    pub guard: String,
    pub members: usize,
    pub with_guard: usize,
    /// Members without the guard, sorted by path: neither it nor a guard built on it
    /// ([`guard_gaps_with`]), and nothing whose guard cannot be read.
    pub exceptions: Vec<EntryRef>,
    /// Members without the guard that have something whose guard cannot be read
    /// ([`EntryRow::opaque`]): it may be the guard, so they are no exception (guard
    /// unknown), listed apart. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown: Vec<EntryRef>,
    /// The first member (by path) with the guard: one to copy from.
    pub example: EntryRef,
    /// The convention that says the same (a `wrapped_by` rule on this guard covering
    /// the place), accepted or proposed, when `.drift/conventions.yaml` has one
    /// ([`link_conventions`]). None: not a convention yet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub convention: Option<GapConvention>,
}

/// A convention a [`GuardGap`] corresponds to.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct GapConvention {
    pub id: String,
    /// `accepted` or `proposed`.
    pub status: String,
    /// `block` or `advise`.
    pub mode: String,
}

impl GapConvention {
    /// What to say next to a gap: accepted rules are what `drift check` reports;
    /// a proposal is one command from being a rule.
    pub fn note(&self) -> String {
        use crate::report::sanitize;
        match self.status.as_str() {
            "accepted" => format!(
                "convention [{}] accepted, {}",
                sanitize(&self.id, 16),
                if self.mode == "block" {
                    "blocks"
                } else {
                    "advises"
                }
            ),
            _ => format!(
                "proposed as [{id}]: `drift review --accept {id}` makes it a rule",
                id = sanitize(&self.id, 16)
            ),
        }
    }
}

/// Links each [`GuardGap`] to the convention that says the same: a `wrapped_by` rule
/// on the gap's guard among `covering(path)`, the conventions (accepted or proposed)
/// whose role covers the member to copy from. An accepted one wins over a proposal.
/// `blocks` says whether a convention blocks.
pub fn link_conventions<'a>(
    inv: &mut Inventory,
    covering: &dyn Fn(&str) -> Vec<&'a crate::policy::Convention>,
    blocks: &dyn Fn(&crate::policy::Convention) -> bool,
) {
    use crate::mine::Rule;
    use crate::policy::Status;
    for g in &mut inv.guard_gaps {
        let guard = g
            .guard
            .trim_end_matches(" (settings)")
            .trim_end_matches(APP_HOOK);
        let mut found: Vec<&crate::policy::Convention> = covering(&g.example.path)
            .into_iter()
            .filter(|c| {
                matches!(&c.rule, Rule::WrappedBy { any_of, .. }
                    if any_of.iter().any(|w| short(w) == guard))
            })
            .collect();
        found.sort_by_key(|c| (c.status != Status::Accepted, c.id.clone()));
        g.convention = found.first().map(|c| GapConvention {
            id: c.id.clone(),
            status: if c.status == Status::Accepted {
                "accepted".to_string()
            } else {
                "proposed".to_string()
            },
            mode: if blocks(c) {
                "block".to_string()
            } else {
                "advise".to_string()
            },
        });
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Inventory {
    pub entry_points: Vec<EntryRow>,
    /// Guards most entry points of a kind share, with the members lacking them.
    pub guard_gaps: Vec<GuardGap>,
    /// The deployment boundary as read from the repository.
    pub boundaries: Boundaries,
    pub sinks: Vec<SinkUse>,
    /// Largest groups first.
    pub client_leaks: Vec<LeakGroup>,
    /// Environment variable -> files reading it.
    pub env: BTreeMap<String, Vec<String>>,
    /// Non-production files left out of the inventory (tests are not counted).
    pub left_out: LeftOut,
    /// Files not parsed for lack of stack ([`crate::unchecked`]), sorted: their entry
    /// points, risky operations and env reads are unknown, and so are client leaks
    /// reached through them. Not serialised when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unchecked: Vec<String>,
    /// Source files that were not read, tests and generated files apart, with why
    /// (too large, a line too long to be written by hand, nested too deep, not UTF-8): an entry
    /// point or a risky operation in one is not in the inventory. Sorted; not
    /// serialised when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<drift_core::Skipped>,
    /// Registrations written as a route is that Drift did not list
    /// ([`drift_core::FileFacts::unlisted_routes`]), in production code: a route in
    /// one may be served and is not in the inventory. Sorted; not serialised when
    /// empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unlisted: Vec<Unlisted>,
    /// What most entry points that query it filter by a value of the caller, with
    /// the entry points that query it and filter by none ([`ScopeGap`]). Sorted; not
    /// serialised when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub scope_gaps: Vec<ScopeGap>,
    /// The bodies that send rows back whole where other code of the repository
    /// withholds a field of the same rows ([`crate::whole_rows`]). Sorted; not
    /// serialised when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub whole_rows: Vec<crate::whole_rows::WholeRow>,
    /// What the repository's CI workflows do with what an outsider controls
    /// ([`crate::workflows`]): a pull request's code checked out where the
    /// repository's secrets are, text of the event interpolated into a shell step.
    /// Filled by the caller, which knows where the repository is. Not serialised
    /// when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub workflows: Vec<crate::workflows::WorkflowFinding>,
    /// What the repository's manifests install that nothing fixes
    /// ([`crate::dependencies`]): a repository named by a branch, an archive at a
    /// URL with no digest, a source over plain HTTP, a second package index, a
    /// download handed to an interpreter while an image is built or a package is
    /// installed. Filled by the caller, which knows where the repository is. Not
    /// serialised when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub dependencies: Vec<crate::dependencies::DependencyFinding>,
    /// What the repository's Kubernetes manifests open ([`crate::kubernetes`]): a
    /// path from outside the cluster, a Service with an address outside it, a
    /// workload given the node it runs on, a Secret whose values are written in the
    /// file, a role over everything. Filled by the caller, which knows where the
    /// repository is. Not serialised when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cluster: Vec<crate::kubernetes::ClusterFinding>,
    /// What could not be read around the inventory, so a part of it is missing (a
    /// `.drift/conventions.yaml` that does not parse: shared guards are listed without
    /// their conventions). Not serialised when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

/// Non-production files (examples, samples, demos, playgrounds, integration-test
/// suites) that the inventory leaves out, so leaving them out is never silent.
#[derive(Debug, Clone, Default, Serialize)]
pub struct LeftOut {
    pub files: usize,
    /// The non-production directories they are in (`examples/`, `apps/web/integration/`), sorted.
    pub dirs: Vec<String>,
}

impl Inventory {
    pub fn unguarded(&self) -> impl Iterator<Item = &EntryRow> {
        self.entry_points.iter().filter(|e| e.unguarded())
    }

    /// Entry points whose only guards are hooks the whole app runs (CSRF checks,
    /// trackers): nothing written for the entry point itself.
    pub fn only_app_hooks(&self) -> impl Iterator<Item = &EntryRow> {
        self.entry_points.iter().filter(|e| e.only_app_hooks())
    }
}

impl EntryRow {
    /// Reachable by a remote caller ([`EntryRow::local`] is false) with no guard, and
    /// nothing whose guard cannot be read ([`EntryRow::opaque`]).
    pub fn unguarded(&self) -> bool {
        !self.local && !queue_kind(&self.kind) && self.bare() && self.verifies_signature.is_empty()
    }

    /// A queue-fed entry point ([`QUEUE_KINDS`]) with nothing that turns anyone away:
    /// left out of the unguarded count and list, and said so in the headline.
    pub fn queue_without_guard(&self) -> bool {
        queue_kind(&self.kind) && self.bare()
    }

    /// A local entry point with nothing that turns a caller away: left out of the
    /// unguarded count and list, and said so in the headline.
    pub fn local_without_guard(&self) -> bool {
        self.local && self.bare()
    }

    fn bare(&self) -> bool {
        self.guards.is_empty() && self.opaque.is_empty()
    }

    /// What is said where its guards would be named ([`EntryRef::has`]): the guards,
    /// that its guard cannot be read, that it runs locally or is fed by a queue, or
    /// that no guard was found in what Drift read, with how much was not read.
    pub fn has(&self) -> String {
        entry_ref(self).has()
    }

    /// Where it is reachable from, with what says so: `internet-facing (compose ...)`,
    /// or for an internal one what Drift read and did not ([`crate::practices::basis::internal`]).
    /// `None` when nothing speaks for its path.
    pub fn exposure_text(&self) -> Option<String> {
        let b = self.boundary.as_deref()?;
        Some(match self.exposure {
            Exposure::Internal => crate::practices::basis::internal(
                Some(b),
                self.exposure_basis
                    .as_ref()
                    .map_or(&[], |x| x.not_read.as_slice()),
            ),
            x => format!("{} ({})", x.as_str(), crate::report::sanitize(b, 240)),
        })
    }

    pub fn only_app_hooks(&self) -> bool {
        !self.guards.is_empty() && self.guards.iter().all(|g| g.ends_with(APP_HOOK))
    }
}

/// A callee is a guard when a rule that it be called ([`crate::mine::Rule::Calls`]) is a
/// security boundary: an entry point that does not call it lacks a check, whatever it
/// looks like ([`crate::mine::Rule::exemption_allowed`]). Guards done in the handler's
/// body (`authorize()`, `ensureOwnsProject()`), which no wrapper, decorator or base
/// shows. It is one when nothing in its name opens access ([`grant::auth_class`] is
/// not [`grant::AuthClass::Public`]) and:
///
/// - its name says access control ([`names_access_control`]: `authorize`,
///   `requireUser`, `ability.can`), whatever its definition, a package's or not;
/// - or its definition is shaped like a guard ([`authenticates`]: it, or what it is
///   built on or calls one call deep, rejects its caller, throws an error class named
///   for that, or is a library's own guard);
/// - or entry points call it as one: in [`crate::context::ENTRY_CALLERS`] places or
///   more, and its body can throw ([`RepoContext::called_as_guard`]).
///
/// Mining reads it as it is, so its census does not move. It grants on a name alone;
/// whatever must not take a name as proof (the practice map) uses
/// [`callee_proves_guard`].
///
/// [`RepoContext::called_as_guard`]: crate::context::RepoContext::called_as_guard
pub fn callee_is_guard(ctx: &crate::context::RepoContext, callee: &str) -> bool {
    let c = crate::mine::norm_ref(callee);
    grant::auth_class(&c) != grant::AuthClass::Public
        && (names_access_control(&c)
            || authenticates(ctx, &c)
            || ctx.called_as_guard(&c)
            // It refuses by the response it hands back, for the readings that list
            // ([`hand_back`] says where a call of it is a guard).
            || (ctx.since_measured()
                && !external(&c)
                && ctx.definition(&c).is_some_and(|d| {
                    d.controls
                        .iter()
                        .any(|x| x.starts_with(drift_core::controls::RETURNS_REJECTION))
                })))
}

/// A callee is a guard only on proof, never on its name (PLAN-R14 A3): what it does
/// rejects a caller ([`authenticates`], which reads a package's export as a library
/// guard through [`library_guard_in`]), or entry points call it as one
/// ([`RepoContext::called_as_guard`]) and its name says access control. A name may
/// still veto: one that opens access is no guard, as [`callee_is_guard`] reads it. An
/// in-repo callee the facts do not define proves nothing (where [`authenticates`] would
/// grant it by name).
///
/// Being called by entry points and able to throw is not proof by itself: it is what
/// every shared helper of a handler looks like (`_build_loop_service()` raising a 502
/// when storage is down, `load_run()` raising a 404, `parseBody()` throwing a 400). It
/// proves a guard only together with a name about access (`ensureOwnsProject`), which
/// alone would prove nothing either.
///
/// [`RepoContext::called_as_guard`]: crate::context::RepoContext::called_as_guard
pub fn callee_proves_guard(ctx: &crate::context::RepoContext, callee: &str) -> bool {
    let c = crate::mine::norm_ref(callee);
    if !external(&c) && ctx.definition(&c).is_none() {
        return false;
    }
    if builds_without_rejecting(ctx, &c) {
        return false;
    }
    callee_is_guard(ctx, &c)
        && (authenticates(ctx, &c) || (ctx.called_as_guard(&c) && names_access_control(&c)))
}

/// What a call in a handler's body is to the question "is this entry point guarded":
/// the one rule `drift security` ([`EntryRow::guards`], [`EntryRow::opaque`]) and the
/// practice map (`practices::authn`) both read ([`body_call`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BodyCall {
    /// The callee provably turns away a caller who is not signed in ([`authenticates`]:
    /// it answers 401, redirects to sign-in, throws a rejection class, or is a library's
    /// guard). A guard on both surfaces.
    Guard,
    /// It looks like a guard and nothing shows that it rejects: an in-repo helper entry
    /// points call as one, that can throw and is named for access
    /// ([`callee_proves_guard`]), whose throw is not shown to turn an unauthenticated
    /// caller away (`assertSession()` throwing a plain `Error`). Neither a guard nor
    /// nothing: the practice map reads the unit as unknown, `drift security` lists the
    /// call among the entry point's `opaque`, and a person may name it
    /// (`practices: {authn: ...}`).
    Unproven,
    /// Anything else: no guard.
    NotAGuard,
}

/// Reads a body call ([`BodyCall`]). Precision over recall: only what
/// [`callee_proves_guard`] accepts can be more than nothing, so a client factory, a
/// file loader, a request parser or a helper whose name opens access is
/// [`BodyCall::NotAGuard`].
pub fn body_call(ctx: &crate::context::RepoContext, callee: &str) -> BodyCall {
    if !callee_proves_guard(ctx, callee) {
        // It answers "not signed in" for some requests, and is not proven to for
        // every one: it may be the guard.
        let c = crate::mine::norm_ref(callee);
        if !builds_without_rejecting(ctx, &c) && may_authenticate(ctx, &c) {
            BodyCall::Unproven
        } else {
            BodyCall::NotAGuard
        }
    } else if authenticates(ctx, callee) {
        BodyCall::Guard
    } else {
        BodyCall::Unproven
    }
}

/// What a body does with what a call of a function that turns callers away only by
/// the value it hands back gave it ([`hand_back`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandBack {
    /// It returns the value when there is one, for every request
    /// ([`drift_core::controls::RETURNS_RESULT_OF`]): the call is its guard.
    Returned,
    /// Every call is a statement of its own
    /// ([`drift_core::controls::DROPS_RESULT_OF`]): nothing stops the body.
    Dropped,
    /// Anything else: whether the body leaves where the callee refused is not read.
    Unread,
}

/// `callee` turns its caller away only by a response it hands back
/// ([`drift_core::controls::RETURNS_REJECTION`]: `if (!session) return
/// NextResponse.json({ error }, { status: 401 })`), and this is what `caller`, which
/// calls it, does with that value. `None` for any other callee, and for the reading
/// mining takes.
pub fn hand_back(
    ctx: &crate::context::RepoContext,
    caller: &Symbol,
    callee: &str,
) -> Option<HandBack> {
    use drift_core::controls::{DROPS_RESULT_OF, RETURNS_REJECTION, RETURNS_RESULT_OF};
    let c = crate::mine::norm_ref(callee);
    if !ctx.since_measured() || external(&c) {
        return None;
    }
    let keys: Vec<&str> = ctx
        .definition(&c)?
        .controls
        .iter()
        .filter_map(|x| x.strip_prefix(RETURNS_REJECTION))
        .collect();
    if keys.is_empty() {
        // [STRICT] A function that refuses by answering on the response it was
        // handed, and throws nothing, stops its caller only where the caller
        // leaves on what it returned: a caller every call of which is a statement
        // of its own goes on, so the call is found and proves nothing.
        let dropped = caller
            .controls
            .iter()
            .filter_map(|x| x.strip_prefix(DROPS_RESULT_OF))
            .any(|f| f == c);
        return (dropped && answers_without_throwing(ctx, &c, 0)).then_some(HandBack::Unread);
    }
    let of = |control: &'static str| {
        caller
            .controls
            .iter()
            .filter_map(move |x| x.strip_prefix(control))
    };
    let returned = of(RETURNS_RESULT_OF)
        .filter_map(|x| x.split_once('@'))
        .any(|(key, f)| f == c && keys.contains(&key))
        // `return requireSession(req)`: the response itself, handed back by every
        // `return` of the body ([`Symbol::returns_calls`] is empty where a
        // `return` hands back anything but a call). Returned on some paths only
        // (`try { ... } catch { return requireSession(req) }`), it is not the
        // body's guard.
        || (keys.contains(&"")
            && !caller.returns_calls.is_empty()
            && caller
                .returns_calls
                .iter()
                .all(|r| crate::mine::norm_ref(r) == c));
    Some(if returned {
        HandBack::Returned
    } else if of(DROPS_RESULT_OF).any(|f| f == c) {
        HandBack::Dropped
    } else {
        HandBack::Unread
    })
}

/// `callee`, or what it calls in the repository (three calls deep), answers 401 or
/// 403 on a response (`res.status(401).end()`), and nothing among them throws or
/// redirects: what it refuses, it refuses by that response ([`hand_back`]).
fn answers_without_throwing(ctx: &crate::context::RepoContext, callee: &str, depth: usize) -> bool {
    fn read(
        ctx: &crate::context::RepoContext,
        callee: &str,
        depth: usize,
        answers: &mut bool,
    ) -> bool {
        use drift_core::ResponseVia;
        let Some(d) = ctx.definition(callee) else {
            return false;
        };
        if !d.throws.is_empty()
            || d.responses
                .iter()
                .any(|r| matches!(r.via, ResponseVia::Throw | ResponseVia::Redirect))
        {
            return false;
        }
        *answers |= d.responses.iter().any(|r| {
            matches!(r.status, 401 | 403)
                && matches!(r.via, ResponseVia::Setter | ResponseVia::Return)
        });
        depth >= 3
            || d.calls
                .iter()
                .map(|c| crate::mine::norm_ref(c))
                .filter(|c| !external(c) && ctx.definition(c).is_some())
                .all(|c| read(ctx, &c, depth + 1, answers))
    }
    let mut answers = false;
    read(ctx, callee, depth, &mut answers) && answers
}

/// `callee` names an in-repo class itself (`OrganizationsService(db)`, `new
/// Mailer()`), whose members the facts hold, and its constructor turns no one away.
/// Building an object runs its constructor and nothing else: what another method of the
/// class throws (`require_member` raising `ForbiddenError`) is on the class's own facts,
/// and says nothing about the call that builds it. A class with no member facts is read
/// as before.
fn builds_without_rejecting(ctx: &crate::context::RepoContext, callee: &str) -> bool {
    let Some(d) = ctx.definition(callee) else {
        return false;
    };
    let name = callee.rsplit_once('#').map_or(callee, |(_, n)| n);
    if d.kind != drift_core::SymbolKind::Class || d.name != name || d.members.is_empty() {
        return false;
    }
    !d.members
        .iter()
        .filter(|m| m.name == "__init__" || m.name == "constructor")
        .any(|m| {
            m.throws.iter().any(|t| grant::rejection_class(t))
                || m.body_checks.iter().any(|c| {
                    matches!(
                        c.outcome,
                        drift_core::CheckOutcome::Unauthenticated
                            | drift_core::CheckOutcome::SignInRedirect
                    )
                })
        })
}

/// Decorators that only describe an endpoint for API schemas (drf-spectacular,
/// drf-yasg): they reject nothing, so they are not guards.
pub(crate) const SCHEMA_ONLY: &[&str] = &[
    "pkg:drf_spectacular#utils.extend_schema",
    "pkg:drf_spectacular#utils.extend_schema_view",
    "pkg:drf_yasg#utils.swagger_auto_schema",
];

/// Hops followed from a call wrapper's definition to find what it does
/// ([`authenticates`]): the bindings it is built from, the middleware it is given, the
/// wrappers it is wrapped in.
const GUARD_HOPS: usize = 6;
/// Definitions read at most for one wrapper ([`authenticates`]).
const GUARD_NODES: usize = 64;

/// The call wrapper is a guard: what it runs turns away callers who are not signed in
/// or not allowed. Mining asks it of each alternative of a variant set ("wrapped in one
/// of A, B, C"): in a set with a guard, an alternative that is not one does not satisfy
/// the rule (`publicProcedure` beside `authedProcedure`).
///
/// Read from the definitions, not the names, except that a name that opens it up says
/// it is not one ([`grant::auth_class`]: `publicProcedure`, `login_required_optional`,
/// `_web_user_or_anonymous`), whatever it runs. Otherwise it is a guard when the
/// wrapper's definition, or what it is built on, is given or wrapped in:
/// - rejects a caller ([`drift_core::controls::REJECTS_CALLER`]: a 401 or 403 or an
///   `UNAUTHORIZED` error thrown, raised or returned, a sign-in redirect), or throws an
///   error class named for that ([`grant::rejection_class`]: `UnauthorizedError`,
///   `AuthenticationFailed`);
/// - or is a library's own guard ([`library_guard`]: passport, Django and DRF
///   permissions, FastAPI security schemes, ...).
///
/// What it is built on: the binding it derives from (`authedAdminProcedure =
/// publicProcedure.use(isAdmin)`), the middleware it is given by reference (`isAdmin`),
/// the wrappers and bases on its definition, and the functions its definition calls
/// (one call deep: `get_current_user` calling `decode_token`).
///
/// A package's export is a guard only when it is a known library guard
/// ([`library_guard_in`]), whatever its name says (`withIronSessionApiRoute` opens a
/// session, it rejects no one). An in-repo wrapper whose definition the facts lack is
/// a guard only when its name says it authenticates ([`grant::grants_by_name`]);
/// [`names_access_control`] includes more on purpose and is only safe for refusing
/// exemptions, never for granting a guard.
pub fn authenticates(ctx: &crate::context::RepoContext, wrapper: &str) -> bool {
    authenticating_root(ctx, wrapper).is_some()
}

/// What proves that `wrapper` turns callers away ([`authenticates`]): the wrapper
/// itself when its own body rejects, is a library's guard or a Nest guard that
/// rejects, or is granted by name; else the first thing it is built on or calls (as
/// [`authenticates`] searches) that does. None when nothing does. The root is how a
/// dependency that only passes authentication through (`get_folder_service` depending on
/// `resolve_principal`) is read as the guard it is built on.
pub fn authenticating_root(ctx: &crate::context::RepoContext, wrapper: &str) -> Option<String> {
    let w = crate::mine::norm_ref(wrapper).into_owned();
    // A name that opens access is no guard, whatever the body does: not for a
    // Python function under the reading made since the measured build, where a
    // name is evidence of nothing and the body is read
    // (`optional_user` that raises 401 for every request without a token).
    let by_body = ctx.since_measured() && w.contains(".py#");
    if !by_body && grant::auth_class(&w) == grant::AuthClass::Public {
        return None;
    }
    if ctx.is_nest_guard(&w) && nest_guard_rejects(ctx, &w) {
        return Some(w);
    }
    if external(&w) {
        return library_guard_in(ctx, &w).then_some(w);
    }
    if ctx.definition(&w).is_none() {
        return grant::grants_by_name(&w).then_some(w);
    }
    let has = |s: &Symbol, control: &str| s.controls.iter().any(|c| c == control);
    // The proofs added since the measured build, and their withdrawals: read by
    // `drift security` and the practice map, not by mining.
    let since = ctx.since_measured();
    // A dependency the repository replaces (`app.dependency_overrides[...]`): what
    // runs in its place is not this body.
    let overridden = |s: &Symbol| since && has(s, drift_core::controls::OVERRIDDEN);
    built_on(ctx, w, true, since, &|s| {
        if overridden(s) {
            return false;
        }
        // A 401 in the handler of a `try` the body cannot pass otherwise.
        (since && has(s, drift_core::controls::HANDLER_REJECTS))
            // A body that refuses some callers and lets a request through that
            // passed no refusal (`if not token: return None` before the 401) is
            // optional identity: its refusals prove no guard. Nor do refusals in
            // a function the body defines and does not hand back.
            || (!(since
                && (has(s, drift_core::controls::REJECTS_SOME)
                    || has(s, drift_core::controls::REFUSAL_NOT_RETURNED)))
                && rejects(s))
            // It throws for every request for which what gives the caller gave
            // nothing, whatever it throws.
            || (since && refuses_without_identity(ctx, s).is_some())
    })
    .filter(|root| !ctx.definition(root).is_some_and(overridden))
}

/// `giver` hands back who calls, or nothing: a library's session read
/// ([`crate::practices::libraries::authn_callee`]); a function of the repository
/// whose every return gives what was made of a credential the request carries
/// ([`drift_core::controls::RETURNS_CREDENTIAL`]) or a value of the caller
/// ([`drift_core::controls::RETURNS_CALLER`]). Read from what the function does:
/// no word of its name is asked.
fn gives_identity(ctx: &crate::context::RepoContext, giver: &str) -> bool {
    let g = crate::mine::norm_ref(giver);
    if external(&g) {
        return crate::practices::libraries::authn_callee(&g);
    }
    let name = g.rsplit_once('#').map_or(&*g, |(_, n)| n);
    ctx.definition(&g).is_some_and(|d| {
        d.name == name
            && d.controls.iter().any(|c| {
                c == drift_core::controls::RETURNS_CREDENTIAL
                    || c == drift_core::controls::RETURNS_CALLER
                    || c == drift_core::controls::GIVES_CALLER
            })
    })
}

/// The body throws for every request for which what gives the caller gave
/// nothing ([`drift_core::controls::REFUSES_WITHOUT`]): some test of it is on a
/// value each of whose givers hands back who calls or nothing
/// ([`gives_identity`]). The first such giver.
pub(crate) fn refuses_without_identity<'a>(
    ctx: &crate::context::RepoContext,
    s: &'a Symbol,
) -> Option<&'a str> {
    s.controls
        .iter()
        .filter_map(|c| c.strip_prefix(drift_core::controls::REFUSES_WITHOUT))
        .find(|by| !by.is_empty() && by.split('\t').all(|g| gives_identity(ctx, g)))
        .and_then(|by| by.split('\t').next())
}

/// The body rejects a caller ([`drift_core::controls::REJECTS_CALLER`]) or throws an
/// error class named for that ([`grant::rejection_class`]). An error raised only
/// after the continuation, or mapped from what it raised (`except AuthError: raise
/// PermissionDenied` around the wrapped view), turns no caller away.
fn rejects(s: &Symbol) -> bool {
    s.controls
        .iter()
        .any(|c| c == drift_core::controls::REJECTS_CALLER)
        || s.throws
            .iter()
            .any(|t| grant::rejection_class(t) && !s.after_continuation.iter().any(|a| a == t))
}

/// `wrapper` (in the repository, defined) answers "not signed in" where that is not
/// proven to be for every request, or is built on or calls something that does: in
/// an `except` handler ([`drift_core::controls::HANDLER_MAY_REJECT`]); in a body
/// that lets a request through that passed no refusal
/// ([`drift_core::controls::REJECTS_SOME`]: `if not token: return None` before the
/// 401); or in something it calls for some requests only (under a branch, after a
/// return that serves, in a `try` that swallows), which [`authenticates`] does not
/// follow. It may be the guard of the entry point it wraps, so `drift security` lists
/// that as [`EntryRow::opaque`] and the practice map as unknown, never as having no
/// guard. Asked where [`authenticates`] found no proof. Read only where the proofs
/// added since the measured build are
/// ([`crate::context::RepoContext::since_measured`]).
pub fn may_authenticate(ctx: &crate::context::RepoContext, wrapper: &str) -> bool {
    let w = crate::mine::norm_ref(wrapper).into_owned();
    ctx.since_measured()
        && !external(&w)
        && ctx.definition(&w).is_some()
        && built_on(ctx, w, false, false, &|s| {
            let has = |control: &str| s.controls.iter().any(|c| c == control);
            has(drift_core::controls::HANDLER_MAY_REJECT)
                || has(drift_core::controls::HANDLER_REJECTS)
                || rejects(s)
                // It calls what refuses by the value it hands back, and what it
                // does with that value is not read.
                || s.calls
                    .iter()
                    .any(|c| hand_back(ctx, s, c) == Some(HandBack::Unread))
        })
        .is_some()
}

/// [`authenticating_root`] by what the definitions do alone: no word of a name opens
/// a wrapper up (`unauthorizedGuard`, `publicApiAuth`), and none grants one the
/// facts do not define. What the reading of a TypeScript guard position takes
/// ([`crate::guard_position`]): there a name is never evidence, for a guard or
/// against one.
pub fn proving_root(ctx: &crate::context::RepoContext, wrapper: &str) -> Option<String> {
    let w = crate::mine::norm_ref(wrapper).into_owned();
    if ctx.is_nest_guard(&w) && nest_guard_rejects(ctx, &w) {
        return Some(w);
    }
    if external(&w) {
        return library_guard_in(ctx, &w).then_some(w);
    }
    ctx.definition(&w)?;
    let has = |s: &Symbol, control: &str| s.controls.iter().any(|c| c == control);
    let since = ctx.since_measured();
    built_on(ctx, w, true, since, &|s| {
        (since && has(s, drift_core::controls::HANDLER_REJECTS)) || rejects(s)
    })
}

/// The first of `w` and what it is built on or calls ([`authenticates`]) that
/// `proves` accepts, or (`libraries`) that is a library's own guard.
///
/// `every_request`: a Python body's call is followed only where every request that
/// reaches the body makes it ([`drift_core::Symbol::conditional_calls`]: `if not
/// token: return None` before `return verify(token)` calls the guard for some
/// requests only), or where what is called under a branch never returns
/// ([`drift_core::controls::REFUSES_ALL`]: `if user is None: deny()` is that
/// branch's refusal).
fn built_on(
    ctx: &crate::context::RepoContext,
    w: String,
    libraries: bool,
    every_request: bool,
    proves: &dyn Fn(&Symbol) -> bool,
) -> Option<String> {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut queue: VecDeque<(String, usize, bool)> = VecDeque::from([(w, 0, false)]);
    while let Some((r, hops, called)) = queue.pop_front() {
        if seen.len() >= GUARD_NODES || !seen.insert(r.clone()) {
            continue;
        }
        if external(&r) {
            if libraries && library_guard_in(ctx, &r) {
                return Some(r);
            }
            continue;
        }
        let Some(s) = ctx.definition(&r) else {
            continue;
        };
        // What refuses only by the value it hands back, reached through a call of a
        // body that returns that value ([`hand_back`]): the body refuses with it.
        let handed_back = called
            && libraries
            && ctx.since_measured()
            && s.controls
                .iter()
                .any(|c| c.starts_with(drift_core::controls::RETURNS_REJECTION));
        if proves(s) || handed_back {
            return Some(r);
        }
        if hops >= GUARD_HOPS {
            continue;
        }
        let mut next = |r: &str, called: bool| {
            queue.push_back((crate::mine::norm_ref(r).into_owned(), hops + 1, called));
        };
        if !s.derives_from.is_empty() {
            next(&s.derives_from, called);
        }
        // A Python body under the reading made since the measured build: what it
        // references of a package is a guard only by the closed list, in the shape
        // it is written in here ([`crate::py_guards`]), never by the lists mining
        // reads.
        let python = libraries && every_request && r.contains(".py#");
        for wrap in &s.wraps {
            if python && external(&wrap.wrapper) {
                if wrap.kind == WrapKind::Decorator
                    && crate::py_guards::classify(
                        ctx,
                        crate::py_guards::Position::Decorator,
                        &wrap.wrapper,
                        &[s],
                    )
                    .is_guard()
                {
                    return Some(crate::mine::norm_ref(&wrap.wrapper).into_owned());
                }
                if wrap.kind != WrapKind::Extends
                    || crate::py_guards::never_authenticates(&wrap.wrapper)
                {
                    continue;
                }
            }
            // An in-repo subclass of a FastAPI scheme may build it with
            // `auto_error=False` (`super().__init__(...)`) or override `__call__` to let
            // a request without credentials through: it is no scheme's guard.
            if wrap.kind == WrapKind::Extends
                && crate::mine::norm_ref(&wrap.wrapper).starts_with("pkg:fastapi#")
            {
                continue;
            }
            if matches!(
                wrap.kind,
                WrapKind::Call | WrapKind::Decorator | WrapKind::Extends
            ) {
                next(&wrap.wrapper, called);
            }
        }
        for c in &s.calls {
            if let Some(m) = c.strip_suffix("(ref)") {
                next(m, called);
            } else if let Some(class) = c.strip_suffix("(new)") {
                // A library's guard built here (`new Authenticator()` of
                // `@fastify/passport`); an in-repo class is read through what it throws.
                if external(class) {
                    next(class, called);
                }
            } else if python && external(c) {
                // A package's function called for every request of the body,
                // before it hands control on (also in a function the body calls
                // for every request: the calls followed are those).
                if !s.after_continuation.iter().any(|a| a == c)
                    && !for_some_requests(ctx, s, c)
                    && crate::py_guards::called_guard(s, c)
                {
                    return Some(crate::mine::norm_ref(c).into_owned());
                }
            } else if !called
                && !s.after_continuation.iter().any(|a| a == c)
                // Nor a call of what refuses by the value it hands back, where the
                // body does not return that value.
                && matches!(hand_back(ctx, s, c), None | Some(HandBack::Returned))
                && !(every_request && r.contains(".py#") && for_some_requests(ctx, s, c))
            {
                // Not a call made after the continuation or on its result
                // (`mapAuthErrors(await next())`): that acts on what it handed back.
                next(c, true);
            }
        }
    }
    None
}

/// The value a branch's condition reads, in a body that hands back what the facts
/// do not read from that branch ([`drift_core::controls::EXIT_UNREAD`]), is the
/// caller's: a session read, a header or a cookie, the answer of a signature or
/// secret compare. Anything else (a row, a flag) is no reason to read a guard here.
pub(crate) fn exit_unread_of_caller(source: &str) -> bool {
    use crate::practices::libraries::{authn_callee, verifier_callee};
    let lower = source.to_ascii_lowercase();
    // A header says who the caller is by what it is called (`authorization`,
    // `x-api-key`, `stripe-signature`); `content-type` or `accept` do not.
    let credential = |name: &str| {
        [
            "auth",
            "token",
            "key",
            "secret",
            "sign",
            "session",
            "cookie",
            "credential",
            "bearer",
        ]
        .iter()
        .any(|w| name.contains(w))
    };
    !source.is_empty()
        && (authn_callee(source)
            || verifier_callee(source)
            || lower.strip_prefix("header:").is_some_and(credential)
            || lower.starts_with("cookie"))
}

/// A guard `body` calls, read as one that checks only some of its requests
/// ([`for_some_requests`] for Python). TypeScript: any call the body makes under a
/// branch, in a callback run once per element, after a return that serves, or
/// without awaiting it ([`drift_core::Symbol::conditional_calls`]): a refusal is a
/// branch's exit there, written as a check, so a call of a guard under one is made
/// for the requests that take the branch (`if (req.headers["x-internal"] !== "1")
/// requireAuth(req)`).
pub(crate) fn called_for_some(
    ctx: &crate::context::RepoContext,
    python: bool,
    body: &Symbol,
    callee: &str,
) -> bool {
    if python {
        return for_some_requests(ctx, body, callee);
    }
    body.conditional_calls
        .iter()
        .filter_map(|c| c.split_once(':'))
        .any(|(_, c)| c == callee)
}

/// `body` calls `callee` for some of its requests only
/// ([`drift_core::Symbol::conditional_calls`]), and not as the refusal of a branch:
/// under a branch, what is called returns for some callers (it has no
/// [`drift_core::controls::REFUSES_ALL`]); or the call comes after a return that
/// serves, in a `try` whose handler goes on, or is a coroutine nothing awaits.
pub(crate) fn for_some_requests(
    ctx: &crate::context::RepoContext,
    body: &Symbol,
    callee: &str,
) -> bool {
    let Some(why) = body
        .conditional_calls
        .iter()
        .filter_map(|c| c.split_once(':'))
        .find(|(_, c)| *c == callee)
        .map(|(why, _)| why)
    else {
        return false;
    };
    why != drift_core::not_always::UNDER_BRANCH
        || !ctx.definition(callee).is_some_and(|d| {
            d.controls
                .iter()
                .any(|c| c == drift_core::controls::REFUSES_ALL)
        })
        // Since the measured build: only where the body's own paths were read to
        // refuse every request they let through with that call counted as a
        // refusal ([`drift_core::controls::REFUSES_EVERY`]): `if authorization:`
        // / `if bad(authorization): deny()` refuses no caller without a token.
        || (ctx.since_measured()
            && callee.contains(".py#")
            && !body
                .controls
                .iter()
                .any(|c| c == drift_core::controls::REFUSES_EVERY))
}

/// A call of `callee` in the Python body `body` that comes after the body has called
/// something other than what reads the request, and so after work it may have done
/// ([`drift_core::Symbol::order`]): a check, a guard or a verifier made there is not
/// proven to stop that work, only what follows it. Reading the request (the body of
/// it, its headers, a parse of what it sent) is not work; a log line, a lookup, a
/// helper is. Since the measured build.
pub(crate) fn after_work(ctx: &crate::context::RepoContext, body: &Symbol, callee: &str) -> bool {
    if !ctx.since_measured() {
        return false;
    }
    let at = body.order.iter().position(|c| c == callee);
    // Past the cap on the order kept ([`drift_core::AFTER_MORE`]): as many calls
    // came before it as the list holds.
    if at.is_none() && body.order.iter().any(|c| c == drift_core::AFTER_MORE) {
        return true;
    }
    work_among(body, &body.order[..at.unwrap_or(body.order.len())])
}

/// A check of the Python body `body` that follows work: some of what the body called
/// before it ([`drift_core::BodyCheck::after`]) is work, so it refuses after the work,
/// not before it ([`after_work`]).
pub(crate) fn check_after_work(
    ctx: &crate::context::RepoContext,
    body: &Symbol,
    check: &drift_core::BodyCheck,
) -> bool {
    // (The call that computes what the check tests is part of the check.)
    ctx.since_measured()
        && work_among(
            body,
            &check
                .after
                .iter()
                .filter(|c| **c != check.source)
                .cloned()
                .collect::<Vec<_>>(),
        )
}

/// Some of `calls` is work: not reading the request, and not a value the body builds
/// (an error class it raises, a response it answers with).
fn work_among(body: &Symbol, calls: &[String]) -> bool {
    calls.iter().any(|c| {
        c != drift_core::AFTER_MORE
            && !reads_request(c)
            && !body.throws.iter().any(|t| t == c)
            && !body.responses.iter().any(|r| r.builder == *c)
    }) || calls.iter().any(|c| c == drift_core::AFTER_MORE)
}

/// A call that only reads what the request carries, or converts it: the request
/// object's own methods, and a closed list of built-ins and parses.
fn reads_request(c: &str) -> bool {
    let c = crate::mine::norm_ref(c);
    const READS: &[&str] = &[
        "pkg:flask#request.",
        "pkg:flask#Request.",
        "pkg:fastapi#Request.",
        "pkg:starlette#Request.",
        "pkg:starlette.requests#Request.",
        "pkg:django#http.HttpRequest.",
        "pkg:django#http.request.HttpRequest.",
        "pkg:rest_framework#request.Request.",
    ];
    const BUILTINS: &[&str] = &[
        "bool",
        "bytes",
        "bytearray",
        "dict",
        "float",
        "getattr",
        "hasattr",
        "int",
        "isinstance",
        "len",
        "list",
        "set",
        "str",
        "tuple",
    ];
    // Building a verifier (`Webhook(secret)`) is no work: it is made to be asked.
    let built_verifier = c
        .strip_prefix("pkg:")
        .and_then(|r| r.split_once('#'))
        .is_some_and(|(module, path)| {
            drift_core::guard_lists::SIGNATURE_VERIFIERS
                .iter()
                .any(|v| {
                    module.split(['.', '/']).next() == Some(v.package)
                        && v.path.split_once("()").is_some_and(|(class, _)| {
                            path == class || path.ends_with(&format!(".{class}"))
                        })
                })
        });
    // What FastAPI's parameter defaults call (`Query(...)`, `Depends(...)`): the
    // signature, not the body.
    let parameter = c.strip_prefix("pkg:fastapi#").is_some_and(|n| {
        matches!(
            n.rsplit('.').next().unwrap_or(n),
            "Query"
                | "Header"
                | "Path"
                | "Body"
                | "Form"
                | "File"
                | "Cookie"
                | "Depends"
                | "Security"
        )
    });
    built_verifier
        || parameter
        || READS.iter().any(|p| c.starts_with(p))
        || c.strip_prefix("global#")
            .is_some_and(|b| BUILTINS.contains(&b))
        || matches!(&*c, "pkg:python:json#loads" | "pkg:python:json#load")
}

/// `@nestjs/passport`'s guard: its `canActivate` throws `UnauthorizedException` when the
/// strategy does not authenticate the request.
const PASSPORT_AUTH_GUARD: &str = "pkg:@nestjs/passport#AuthGuard";

/// How Nest runs a guard class (`@UseGuards(G)`, `APP_GUARD`): a `canActivate` that
/// returns a falsy value makes the framework answer 403, so a class used as one turns
/// callers away when its `canActivate` can return false. The facts record no return
/// values, only what the method calls ([`drift_core::Member::calls`]), so a call in its
/// body is read as a result that may be false (`Boolean(...)`, `this.auth.check()`); a
/// body that calls nothing (`return true`, or a bare comparison) proves nothing and is
/// left to the other rules. `@nestjs/passport`'s `AuthGuard(...)`, used or extended,
/// rejects as its strategy says. A throw is read by [`authenticates`] as for any wrapper.
/// Only for classes the repository uses as Nest guards ([`RepoContext::is_nest_guard`]).
///
/// [`RepoContext::is_nest_guard`]: crate::context::RepoContext::is_nest_guard
fn nest_guard_rejects(ctx: &crate::context::RepoContext, guard: &str) -> bool {
    let passport = |r: &str| crate::mine::norm_ref(r).trim_end_matches("()") == PASSPORT_AUTH_GUARD;
    if passport(guard) {
        return true;
    }
    let Some(s) = ctx.definition(guard) else {
        return false;
    };
    s.wraps
        .iter()
        .any(|w| w.kind == WrapKind::Extends && passport(&w.wrapper))
        || s.members
            .iter()
            .any(|m| m.name == "canActivate" && !m.calls.is_empty())
}

/// The rule is a call-wrapper rule (`wrapped_by` `call`) and every one of its
/// alternatives is a guard ([`authenticates`]): what decision D8's candidate tier asks
/// of a Python call wrapper (`drift_mine::tier::d8_candidate_reason`). False for any
/// other rule, and for a set with one alternative that turns no one away (`get_db`
/// beside `login_required`).
pub fn every_alternative_authenticates(
    ctx: &crate::context::RepoContext,
    rule: &crate::mine::Rule,
) -> bool {
    match rule {
        crate::mine::Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of,
        } => !any_of.is_empty() && any_of.iter().all(|w| authenticates(ctx, w)),
        _ => false,
    }
}

fn external(r: &str) -> bool {
    r.starts_with("pkg:") || r.starts_with("global#") || r.starts_with("unresolved:")
}

/// FastAPI's security schemes ([`library_guard`]).
const FASTAPI_SCHEMES: &[&str] = &[
    "OAuth2PasswordBearer",
    "OAuth2AuthorizationCodeBearer",
    "OAuth2",
    "OpenIdConnect",
    "HTTPBearer",
    "HTTPBasic",
    "HTTPDigest",
    "APIKeyHeader",
    "APIKeyCookie",
    "APIKeyQuery",
];

/// [`library_guard`] in this repo. A FastAPI scheme is one only while every build of it
/// is proven strict: no build passes `auto_error` (`OAuth2PasswordBearer(tokenUrl=...,
/// auto_error=False)`) or unpacks options (`**opts`, which may carry it). Such a scheme
/// lets a request without credentials through (optional auth), and a route's
/// dependency names the scheme's class, not the instance, so no route can be told
/// apart from one on the strict scheme. When unsure, it is no guard: that only costs
/// outliers. (An in-repo subclass of a scheme is never one: [`authenticates`].)
pub fn library_guard_in(ctx: &crate::context::RepoContext, canonical: &str) -> bool {
    // Starlette's `@requires(scopes)` answers 403, or redirects, unless the
    // connection has the scopes: read since Starlette route tables are listed, by
    // `drift security` and the practice map only.
    if ctx.since_measured()
        && crate::mine::norm_ref(canonical).trim_end_matches("()")
            == "pkg:starlette#authentication.requires"
    {
        return true;
    }
    // Every export the guard lists read the call shape of
    // ([`drift_core::guard_lists::library_guard_export`]: express-jwt's default export
    // of the versions before 7, as its `expressjwt`): one list, for the readings
    // that prove a guard by its shape.
    if ctx.since_measured()
        && drift_core::guard_lists::library_guard_export(
            crate::mine::norm_ref(canonical).trim_end_matches("()"),
        )
    {
        return true;
    }
    library_guard(canonical)
        && !(canonical.starts_with("pkg:fastapi#")
            && (ctx.passes_key(canonical, "auto_error")
                || ctx.passes_key(canonical, drift_core::SPLAT_KEY)))
}

/// A package's own guard: it turns away callers itself when it wraps, decorates or is a
/// base of an entry point (or is built where one is).
pub fn library_guard(canonical: &str) -> bool {
    let r = crate::mine::norm_ref(canonical);
    let Some((package, path)) = r.strip_prefix("pkg:").and_then(|r| r.split_once('#')) else {
        return false;
    };
    let path = path.trim_end_matches("(new)");
    let segs: Vec<&str> = path.split('.').map(|s| s.trim_end_matches("()")).collect();
    let name = segs.last().copied().unwrap_or_default();
    match package {
        // DRF permission classes; `AllowAny` lets everyone in.
        "rest_framework" => segs.contains(&"permissions") && name != "AllowAny",
        "django" => matches!(
            name,
            "login_required"
                | "permission_required"
                | "user_passes_test"
                | "staff_member_required"
                | "LoginRequiredMixin"
                | "PermissionRequiredMixin"
                | "UserPassesTestMixin"
                | "AccessMixin"
        ),
        // The security schemes, which reject a request without credentials; not the
        // request forms and credential models beside them (`OAuth2PasswordRequestForm`,
        // `HTTPBasicCredentials`, `SecurityScopes`).
        "fastapi" => FASTAPI_SCHEMES.contains(&name),
        "flask_login" => matches!(name, "login_required" | "fresh_login_required"),
        "flask_jwt_extended" => name == "jwt_required",
        "passport" => name == "authenticate",
        "@fastify/passport" => matches!(name, "Authenticator" | "authenticate"),
        "@nestjs/passport" => name == "AuthGuard",
        "next-auth" => name == "withAuth",
        "express-jwt" => matches!(name, "expressjwt" | "jwt"),
        "express-oauth2-jwt-bearer" => matches!(name, "auth" | "requiredScopes"),
        "express-openid-connect" => name == "requiresAuth",
        p if p.starts_with("@clerk/") => name == "protect",
        _ => false,
    }
}

/// What a DRF permission class does with a request that only reads ([`safe_methods`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafeMethods {
    /// It lets `GET`, `HEAD` and `OPTIONS` through for anyone, signed in or not:
    /// the class guards the other methods only.
    Open,
    /// It may: a class of the repository built on such a class that defines its
    /// own `has_permission` or sets `authenticated_users_only`, which the facts do
    /// not read.
    Unread,
}

/// DRF's permission classes that let a request with a safe method through for a
/// caller who is not signed in: `IsAuthenticatedOrReadOnly` and
/// `DjangoModelPermissionsOrAnonReadOnly`.
fn lets_reads_through(canonical: &str) -> bool {
    drf_permission(canonical).is_some_and(|n| {
        matches!(
            n,
            "IsAuthenticatedOrReadOnly" | "DjangoModelPermissionsOrAnonReadOnly"
        )
    })
}

/// The name of a permission class of DRF itself (`pkg:rest_framework#permissions.X`).
fn drf_permission(canonical: &str) -> Option<&str> {
    let path = canonical.strip_prefix("pkg:rest_framework#")?;
    let (module, name) = path.rsplit_once('.')?;
    module
        .split('.')
        .any(|s| s == "permissions")
        .then_some(name)
}

/// How the DRF permission class `class` treats the methods that only read, where
/// that is not as every other method: DRF's `IsAuthenticatedOrReadOnly` and
/// `DjangoModelPermissionsOrAnonReadOnly` let them through for anyone
/// ([`SafeMethods::Open`]), and so does a class of the repository built on one that
/// changes nothing of it. One that defines `has_permission` itself, or sets
/// `authenticated_users_only` (on any of DRF's model permission classes: `False`
/// lets anonymous reads through), is not read ([`SafeMethods::Unread`]). None for
/// every other class: it asks the same of every method, as far as this reads.
pub fn safe_methods(ctx: &crate::context::RepoContext, class: &str) -> Option<SafeMethods> {
    let c = crate::mine::norm_ref(class);
    if external(&c) {
        return lets_reads_through(&c).then_some(SafeMethods::Open);
    }
    let d = ctx.definition(&c)?;
    if d.kind != drift_core::SymbolKind::Class {
        return None;
    }
    let ancestors = ctx.ancestors(&c);
    let through = ancestors.iter().any(|a| lets_reads_through(a));
    let model = ancestors.iter().any(|a| {
        drf_permission(a)
            .is_some_and(|n| matches!(n, "DjangoModelPermissions" | "DjangoObjectPermissions"))
    });
    if !through && !model {
        return None;
    }
    let mut own = std::iter::once(d).chain(
        ancestors
            .iter()
            .filter(|a| !external(a))
            .filter_map(|a| ctx.definition(a)),
    );
    let (mut overrides, mut flag) = (false, false);
    for d in &mut own {
        overrides |= d.members.iter().any(|m| m.name == "has_permission");
        flag |= d.declares.iter().any(|x| {
            x.split_once('=').map_or(x.as_str(), |(n, _)| n) == "authenticated_users_only"
        });
    }
    match (through, overrides || flag) {
        (true, false) => Some(SafeMethods::Open),
        (true, true) => Some(SafeMethods::Unread),
        (false, _) => flag.then_some(SafeMethods::Unread),
    }
}

/// Django's decorator that runs a test on the user before the view.
const USER_PASSES_TEST: &str = "pkg:django#contrib.auth.decorators.user_passes_test";
/// Django's mixin that runs the view's `test_func` before `dispatch`.
const USER_PASSES_TEST_MIXIN: &str = "pkg:django#contrib.auth.mixins.UserPassesTestMixin";

/// The classes `class` is built on, itself first, each base before its own bases,
/// in the order they are written: where a method is looked up, nearly as Python
/// does. A class of the repository as its definition, a package's by its name.
fn class_chain<'a>(
    ctx: &crate::context::RepoContext<'a>,
    class: &'a Symbol,
) -> Vec<Result<&'a Symbol, &'a str>> {
    const MAX: usize = 16;
    let mut out: Vec<Result<&'a Symbol, &'a str>> = vec![Ok(class)];
    let mut at = 0;
    while at < out.len() && out.len() < MAX {
        let Ok(d) = out[at] else {
            at += 1;
            continue;
        };
        let mut insert = at + 1;
        for w in d.wraps.iter().filter(|w| w.kind == WrapKind::Extends) {
            let base = match (!external(&w.wrapper))
                .then(|| ctx.definition(&w.wrapper))
                .flatten()
            {
                Some(b) if b.kind == drift_core::SymbolKind::Class => Ok(b),
                _ => Err(w.wrapper.as_str()),
            };
            let seen = out.iter().any(|x| match (x, &base) {
                (Ok(a), Ok(b)) => std::ptr::eq(*a, *b),
                (Err(a), Err(b)) => a == b,
                _ => false,
            });
            if !seen {
                out.insert(insert, base);
                insert += 1;
            }
        }
        at += 1;
    }
    out
}

/// What the test `method` of `class` answers a caller who is not signed in
/// ([`drift_core::VERDICT_SIGNED_IN`]), as the first class of its chain that
/// defines the method says. `library`: what a package's class in the chain answers
/// (true: it refuses such a caller; false: it permits everyone), `None` for one
/// that does not define the test. A test that is `True` is no guard; one that asks
/// the base's (`super().has_permission(...) and ...`) is the base's where that
/// refuses, and not read where the base permits; a body that was not read, a
/// method bound to something else and a chain that never defines it are not
/// readable.
fn test_of<'a>(
    ctx: &crate::context::RepoContext<'a>,
    class: &'a Symbol,
    method: &str,
    library: &dyn Fn(&str) -> Option<bool>,
) -> Proof {
    let mut through_super = false;
    // Since the measured build, the order Python looks the method up in (C3); a
    // class that cannot be ordered, and a `test_func` that a `get_test_func` of
    // the repository may replace (`UserPassesTestMixin` runs what that returns),
    // are not read.
    let chain: Vec<Result<&Symbol, String>> = if ctx.since_measured() {
        let Some(order) = class_order(ctx, "", class) else {
            return Proof::Unreadable;
        };
        if method == "test_func" && !matches!(lookup(&order, 0, "get_test_func"), Lookup::Absent) {
            return Proof::Unreadable;
        }
        order
            .into_iter()
            .map(|c| match c {
                Mro::Repo(_, d) => Ok(d),
                Mro::Package(p) => Err(p),
            })
            .collect()
    } else {
        class_chain(ctx, class)
            .into_iter()
            .map(|c| c.map_err(str::to_string))
            .collect()
    };
    for c in chain {
        let permits = match c {
            Ok(d) => {
                let Some(m) = d.members.iter().find(|m| m.name == method) else {
                    if d.declares
                        .iter()
                        .any(|x| x.split_once('=').map_or(x.as_str(), |(n, _)| n) == method)
                    {
                        return Proof::Unreadable;
                    }
                    continue;
                };
                let says = |v: &str| m.unread.iter().any(|u| u == v);
                if says(drift_core::VERDICT_SIGNED_IN) {
                    false
                } else if says(drift_core::VERDICT_TRUE) {
                    true
                } else if says(drift_core::VERDICT_SUPER) {
                    through_super = true;
                    continue;
                } else {
                    return Proof::Unreadable;
                }
            }
            Err(package) => match library(&package) {
                Some(refuses) => !refuses,
                None => continue,
            },
        };
        return match (permits, through_super) {
            (false, _) => Proof::Guard,
            (true, false) => Proof::NotAGuard,
            // `super().has_permission(...) and <more>` over a base that permits:
            // what the rest asks is not read.
            (true, true) => Proof::Unreadable,
        };
    }
    Proof::Unreadable
}

/// The order Python looks a method up in for `class` (C3), by reference: a class of
/// the repository through the bases it is written with, a package's class as it is
/// named (its own bases are not in the facts). `class` itself is not in it. `None`
/// where the bases have no consistent order, or are too many to read.
fn method_resolution_order(
    ctx: &crate::context::RepoContext,
    class: &Symbol,
) -> Option<Vec<String>> {
    const MAX_DEPTH: usize = 8;
    fn merge(mut lists: Vec<Vec<String>>) -> Option<Vec<String>> {
        let mut out = Vec::new();
        loop {
            lists.retain(|l| !l.is_empty());
            if lists.is_empty() {
                return Some(out);
            }
            let head = lists
                .iter()
                .map(|l| &l[0])
                .find(|h| !lists.iter().any(|l| l[1..].contains(h)))?
                .clone();
            for l in &mut lists {
                l.retain(|x| *x != head);
            }
            out.push(head);
        }
    }
    fn bases(
        ctx: &crate::context::RepoContext,
        class: &Symbol,
        depth: usize,
    ) -> Option<Vec<String>> {
        if depth > MAX_DEPTH {
            return None;
        }
        let direct: Vec<String> = class
            .wraps
            .iter()
            .filter(|w| w.kind == WrapKind::Extends)
            .map(|w| crate::mine::norm_ref(&w.wrapper).into_owned())
            .collect();
        let mut lists = Vec::new();
        for b in &direct {
            let mut own = vec![b.clone()];
            if !external(b)
                && let Some(d) = ctx.definition(b)
                && d.kind == drift_core::SymbolKind::Class
            {
                own.extend(bases(ctx, d, depth + 1)?);
            }
            lists.push(own);
        }
        lists.push(direct);
        merge(lists)
    }
    bases(ctx, class, 0)
}

/// One class of the order a method is looked up in ([`class_order`]).
#[derive(Clone)]
pub(crate) enum Mro<'a> {
    /// A class of the repository, canonical, with its definition.
    Repo(String, &'a Symbol),
    /// A package's class (or one the facts do not define), by its name: what it
    /// defines is not in the facts.
    Package(String),
}

/// `class` (canonical `own`) and the classes Python looks a method up in after it,
/// in that order ([`method_resolution_order`]). `None` where the order cannot be
/// worked out.
pub(crate) fn class_order<'a>(
    ctx: &crate::context::RepoContext<'a>,
    own: &str,
    class: &'a Symbol,
) -> Option<Vec<Mro<'a>>> {
    let order = method_resolution_order(ctx, class)?;
    Some(
        std::iter::once(Mro::Repo(own.to_string(), class))
            .chain(order.into_iter().map(|r| {
                match (!external(&r))
                    .then(|| ctx.definition(&r))
                    .flatten()
                    .filter(|d| d.kind == drift_core::SymbolKind::Class && d.name == short(&r))
                {
                    Some(d) => Mro::Repo(r, d),
                    None => Mro::Package(r),
                }
            }))
            .collect(),
    )
}

/// What looking `name` up in `order` from the class at `start` on finds
/// ([`lookup`]).
pub(crate) enum Lookup<'a> {
    /// The method of a class of the repository, at that place in the order; `maybe`:
    /// a package's class before it may define the name, and then it never runs.
    Found {
        member: &'a drift_core::Member,
        at: usize,
        maybe: bool,
    },
    /// A class of the repository binds the name to something other than a `def`
    /// (`dispatch = guard(View.dispatch)`): what runs is not read.
    Unread(usize),
    /// No class of the repository defines it.
    Absent,
}

/// The package classes whose methods are known by name, with the methods each
/// defines that do not hand on to the next class's (`dispatch` of Django's access
/// mixins refuses or hands on; DRF's model mixins define their actions only). A
/// package class on no list may define any name.
const KNOWN_PACKAGE_METHODS: &[(&str, &[&str])] = &[
    (
        "pkg:django#contrib.auth.mixins.LoginRequiredMixin",
        &[
            "get_login_url",
            "get_permission_denied_message",
            "get_redirect_field_name",
            "handle_no_permission",
        ],
    ),
    (
        "pkg:django#contrib.auth.mixins.AccessMixin",
        &[
            "get_login_url",
            "get_permission_denied_message",
            "get_redirect_field_name",
            "handle_no_permission",
        ],
    ),
    (
        "pkg:django#contrib.auth.mixins.PermissionRequiredMixin",
        &[
            "get_login_url",
            "get_permission_denied_message",
            "get_redirect_field_name",
            "handle_no_permission",
            "get_permission_required",
            "has_permission",
        ],
    ),
    (
        "pkg:django#contrib.auth.mixins.UserPassesTestMixin",
        &[
            "get_login_url",
            "get_permission_denied_message",
            "get_redirect_field_name",
            "handle_no_permission",
            "test_func",
            "get_test_func",
        ],
    ),
    ("pkg:rest_framework#mixins.ListModelMixin", &["list"]),
    (
        "pkg:rest_framework#mixins.RetrieveModelMixin",
        &["retrieve"],
    ),
    (
        "pkg:rest_framework#mixins.CreateModelMixin",
        &["create", "perform_create", "get_success_headers"],
    ),
    (
        "pkg:rest_framework#mixins.UpdateModelMixin",
        &["update", "perform_update", "partial_update"],
    ),
    (
        "pkg:rest_framework#mixins.DestroyModelMixin",
        &["destroy", "perform_destroy"],
    ),
    ("global#object", &[]),
];

/// The package class `p` may define the method `name` (and its own then runs in
/// place of a later class's).
pub(crate) fn package_may_define(p: &str, name: &str) -> bool {
    let p = crate::mine::norm_ref(p);
    KNOWN_PACKAGE_METHODS
        .iter()
        .find(|(c, _)| *c == p)
        .is_none_or(|(_, own)| own.contains(&name))
}

/// Looks the method `name` up in `order` from the class at `start` on, as Python
/// does: the first class of the repository that defines it, unless a package's
/// class before it may ([`package_may_define`]), which makes it `maybe`.
pub(crate) fn lookup<'a>(order: &[Mro<'a>], start: usize, name: &str) -> Lookup<'a> {
    let mut maybe = false;
    for (at, c) in order.iter().enumerate().skip(start) {
        match c {
            Mro::Repo(_, d) => {
                if let Some(member) = d.members.iter().find(|m| m.name == name) {
                    return Lookup::Found { member, at, maybe };
                }
                if d.declares
                    .iter()
                    .any(|x| x.split_once('=').map_or(x.as_str(), |(n, _)| n) == name)
                {
                    return Lookup::Unread(at);
                }
            }
            Mro::Package(p) => maybe |= package_may_define(p, name),
        }
    }
    Lookup::Absent
}

/// Whether the guard a Django view class has among its bases runs. A mixin guards
/// through its `dispatch` (`LoginRequiredMixin`, `PermissionRequiredMixin`,
/// `UserPassesTestMixin`, a mixin of the repository whose `dispatch` refuses),
/// which Python finds only where the mixin comes before the first base that
/// defines `dispatch` and does not hand on: the generic views. `class
/// Archive(ListView, LoginRequiredMixin)` runs `View.dispatch`, and the mixin
/// never.
///
/// [`Proof::Guard`] where the first such mixin comes first in the order methods
/// are looked up in ([`method_resolution_order`]); [`Proof::NotAGuard`] where a
/// view class (a package's class named `...View` or `...ViewSet`) comes before
/// it; [`Proof::Unreadable`] where what comes before it may define `dispatch` and
/// is not read (a base that does not resolve or is not in the facts, a class of
/// the repository with a `dispatch` of its own), or the order cannot be worked
/// out. `None` for a class with no such mixin.
pub fn base_guard_runs(ctx: &crate::context::RepoContext, view: &Symbol) -> Option<Proof> {
    let last = |r: &str| short(r).rsplit('.').next().unwrap_or_default().to_string();
    let order = method_resolution_order(ctx, view);
    let Some(order) = order else {
        // No order: a guard among the bases may or may not run.
        return view
            .wraps
            .iter()
            .any(|w| w.kind == WrapKind::Extends && authenticates(ctx, &w.wrapper))
            .then_some(Proof::Unreadable);
    };
    let mut unread = false;
    for base in &order {
        if external(base) {
            let name = last(base);
            if base.starts_with("pkg:django#") && name.ends_with("Mixin") && library_guard(base) {
                return Some(if unread {
                    Proof::Unreadable
                } else {
                    Proof::Guard
                });
            }
            if name.ends_with("View") || name.ends_with("ViewSet") {
                // Whatever guards by `dispatch` after a view class never runs.
                return order
                    .iter()
                    .any(|b| authenticates(ctx, b))
                    .then_some(Proof::NotAGuard);
            }
            unread |= base.starts_with("unresolved:");
            continue;
        }
        let Some(d) = ctx.definition(base) else {
            unread = true;
            continue;
        };
        if d.members.iter().any(|m| m.name == "dispatch") {
            let has = |c: &str| d.controls.iter().any(|x| x == c);
            if has(drift_core::controls::REJECTS_CALLER) && !has(drift_core::controls::REJECTS_SOME)
            {
                return Some(if unread {
                    Proof::Unreadable
                } else {
                    Proof::Guard
                });
            }
            // Its own `dispatch`, which may hand on to the next class or not.
            unread = true;
        }
    }
    None
}

/// A DRF permission class of the repository, read from its body and not through
/// its base: `class ReadOnlyOrStaff(BasePermission)` was a guard because
/// `BasePermission` is a permission class, whatever its `has_permission` returns.
/// A guard where `has_permission`, as the class or the first of its bases defines
/// it, refuses a caller who is not signed in on every request
/// ([`drift_core::VERDICT_SIGNED_IN`], or the base's test asked of a library class
/// that requires sign-in); no guard where it is `True`, or where nothing in the
/// repository defines a method and the library base is `BasePermission`; not
/// readable otherwise (a compound, a call, only `has_object_permission`, a
/// library class with a method added). `None` for a package's class, for anything
/// that is no permission class, and for a class of the repository that defines no
/// method over a library class other than `BasePermission`: the library's meaning
/// stands ([`library_guard`], [`safe_methods`]).
pub fn repo_permission(ctx: &crate::context::RepoContext, class: &str) -> Option<Proof> {
    let c = crate::mine::norm_ref(class);
    if external(&c) {
        return None;
    }
    let d = ctx.definition(&c)?;
    if d.kind != drift_core::SymbolKind::Class {
        return None;
    }
    let chain = class_chain(ctx, d);
    let library = chain
        .iter()
        .filter_map(|c| c.err())
        .find_map(|p| drf_permission(&crate::mine::norm_ref(p)).map(str::to_string))?;
    let own = || chain.iter().filter_map(|c| c.ok());
    let defines = own().any(|d| {
        d.members.iter().any(|m| m.name == "has_permission")
            || d.declares
                .iter()
                .any(|x| x.split_once('=').map_or(x.as_str(), |(n, _)| n) == "has_permission")
    });
    if !defines {
        return if own().any(|d| !d.members.is_empty()) {
            Some(Proof::Unreadable)
        } else {
            (library == "BasePermission").then_some(Proof::NotAGuard)
        };
    }
    Some(test_of(ctx, d, "has_permission", &|package| {
        let p = crate::mine::norm_ref(package);
        match drf_permission(&p)? {
            "BasePermission" | "AllowAny" => Some(false),
            "IsAuthenticated"
            | "IsAdminUser"
            | "DjangoModelPermissions"
            | "DjangoObjectPermissions" => Some(true),
            _ => None,
        }
    }))
}

/// What a test Django runs before a view says of a caller who is not signed in,
/// where the wrap `w` of an entry point (`s`, of the classes `classes`) is one:
/// `@user_passes_test(<test>)` by what the lowering read of the test
/// ([`drift_core::controls::PASSES_TEST_SIGNED_IN`]: a guard;
/// [`drift_core::controls::PASSES_TEST_TRUE`]: none; a test that was not read, or
/// given where the facts hold none: not readable), and `UserPassesTestMixin`, as a
/// base of the view or of a mixin of the repository, by the view's `test_func`
/// ([`test_of`]). `None` for any other wrap.
pub fn django_test<'a>(
    ctx: &crate::context::RepoContext<'a>,
    w: &drift_core::Wrap,
    s: &Symbol,
    classes: &[&'a Symbol],
) -> Option<Proof> {
    use drift_core::controls::{PASSES_TEST_SIGNED_IN, PASSES_TEST_TRUE, PASSES_TEST_UNREAD};
    let n = crate::mine::norm_ref(&w.wrapper);
    if n.trim_end_matches("()") == USER_PASSES_TEST {
        let has = |control: &str| {
            std::iter::once(s)
                .chain(classes.iter().copied())
                .any(|x| x.controls.iter().any(|c| c == control))
        };
        return Some(if has(PASSES_TEST_SIGNED_IN) {
            Proof::Guard
        } else if has(PASSES_TEST_TRUE) && !has(PASSES_TEST_UNREAD) {
            Proof::NotAGuard
        } else {
            Proof::Unreadable
        });
    }
    if w.kind != WrapKind::Extends {
        return None;
    }
    let mixin = n == USER_PASSES_TEST_MIXIN
        || (!external(&n)
            && ctx.definition(&n).is_some_and(|d| {
                class_chain(ctx, d)
                    .iter()
                    .filter_map(|c| c.err())
                    .any(|p| crate::mine::norm_ref(p) == USER_PASSES_TEST_MIXIN)
            }));
    if !mixin {
        return None;
    }
    // The view's own class decides; a mixin of the repository where the handler
    // is no method of a class the facts hold.
    let view = classes
        .first()
        .copied()
        .or_else(|| (!external(&n)).then(|| ctx.definition(&n)).flatten())?;
    Some(test_of(ctx, view, "test_func", &|_| None))
}

/// What a test Django runs before a view asks of a caller who is signed in
/// ([`django_test_asks`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TestAsks {
    /// A role, a group, a permission or a staff flag
    /// ([`drift_core::ASKS_ROLE`]).
    Role,
    /// The sign-in and the account's state only ([`drift_core::ASKS_STATUS`]).
    Status,
    /// The test was not read.
    Unread,
}

/// What the test of the wrap `w` of an entry point (`s`, of the classes `classes`)
/// asks of a caller who is signed in, where the wrap is one Django runs a test for
/// ([`django_test`]): `@user_passes_test(<test>)` by what the lowering read of the
/// test ([`drift_core::controls::TEST_ASKS_ROLE`],
/// [`drift_core::controls::TEST_ASKS_STATUS`]), `UserPassesTestMixin` by the
/// `test_func` of the first class of the view's chain that defines one. A role
/// guard needs a role: a test of the account's state is none, and a test that was
/// not read is not known to be one or the other. `None` for any other wrap.
pub fn django_test_asks<'a>(
    ctx: &crate::context::RepoContext<'a>,
    w: &drift_core::Wrap,
    s: &Symbol,
    classes: &[&'a Symbol],
) -> Option<TestAsks> {
    use drift_core::controls::{TEST_ASKS_ROLE, TEST_ASKS_STATUS, TEST_ASKS_UNREAD};
    let n = crate::mine::norm_ref(&w.wrapper);
    if n.trim_end_matches("()") == USER_PASSES_TEST {
        let has = |control: &str| {
            std::iter::once(s)
                .chain(classes.iter().copied())
                .any(|x| x.controls.iter().any(|c| c == control))
        };
        // Several tests on one view: the caller passes every one.
        return Some(if has(TEST_ASKS_ROLE) {
            TestAsks::Role
        } else if has(TEST_ASKS_STATUS) && !has(TEST_ASKS_UNREAD) {
            TestAsks::Status
        } else {
            TestAsks::Unread
        });
    }
    if w.kind != WrapKind::Extends {
        return None;
    }
    let mixin = n == USER_PASSES_TEST_MIXIN
        || (!external(&n)
            && ctx.definition(&n).is_some_and(|d| {
                class_chain(ctx, d)
                    .iter()
                    .filter_map(|c| c.err())
                    .any(|p| crate::mine::norm_ref(p) == USER_PASSES_TEST_MIXIN)
            }));
    if !mixin {
        return None;
    }
    let Some(view) = classes
        .first()
        .copied()
        .or_else(|| (!external(&n)).then(|| ctx.definition(&n)).flatten())
    else {
        return Some(TestAsks::Unread);
    };
    // Since the measured build, by the order Python looks `test_func` up in (C3):
    // a `get_test_func` of the repository may hand back another test, and a
    // package's class before the first that defines it may define its own.
    if ctx.since_measured() {
        let Some(order) = class_order(ctx, "", view) else {
            return Some(TestAsks::Unread);
        };
        if !matches!(lookup(&order, 0, "get_test_func"), Lookup::Absent) {
            return Some(TestAsks::Unread);
        }
        let Lookup::Found {
            member: m,
            maybe: false,
            ..
        } = lookup(&order, 0, "test_func")
        else {
            return Some(TestAsks::Unread);
        };
        let says = |v: &str| m.unread.iter().any(|u| u == v);
        return Some(if says(drift_core::ASKS_ROLE) {
            TestAsks::Role
        } else if says(drift_core::ASKS_STATUS) {
            TestAsks::Status
        } else {
            TestAsks::Unread
        });
    }
    for c in class_chain(ctx, view) {
        let Ok(d) = c else { continue };
        let Some(m) = d.members.iter().find(|m| m.name == "test_func") else {
            if d.declares
                .iter()
                .any(|x| x.split_once('=').map_or(x.as_str(), |(n, _)| n) == "test_func")
            {
                return Some(TestAsks::Unread);
            }
            continue;
        };
        let says = |v: &str| m.unread.iter().any(|u| u == v);
        return Some(if says(drift_core::ASKS_ROLE) {
            TestAsks::Role
        } else if says(drift_core::ASKS_STATUS) {
            TestAsks::Status
        } else {
            TestAsks::Unread
        });
    }
    Some(TestAsks::Unread)
}

/// The mixins among the bases of the Django view class `view`, its own or those of
/// the classes of the repository it is built on, that check a role or a permission
/// by the closed list (`role`: [`crate::py_guards::base_authorizes`]) and run: each
/// comes, in the order methods are looked up in ([`method_resolution_order`]),
/// before the first package's view class, whose `dispatch` hands on to no mixin
/// after it. With them, whether one may run and is not proven to: the order cannot
/// be worked out, or a base before it is not read.
pub fn role_bases(
    ctx: &crate::context::RepoContext,
    view: &Symbol,
    role: &dyn Fn(&str) -> bool,
) -> (Vec<String>, bool) {
    let Some(order) = method_resolution_order(ctx, view) else {
        let any = class_chain(ctx, view)
            .iter()
            .filter_map(|c| c.err())
            .any(|p| role(&crate::mine::norm_ref(p)));
        return (Vec::new(), any);
    };
    let mut roles = Vec::new();
    let mut unread = false;
    let mut not_proven = false;
    for base in &order {
        let n = crate::mine::norm_ref(base).into_owned();
        if external(&n) {
            if role(&n) {
                if unread {
                    not_proven = true;
                } else {
                    roles.push(n);
                }
                continue;
            }
            let name = short(&n).rsplit('.').next().unwrap_or_default().to_string();
            if name.ends_with("View") || name.ends_with("ViewSet") {
                break;
            }
            unread |= n.starts_with("unresolved:");
            continue;
        }
        match ctx.definition(&n) {
            // Its own `dispatch` may hand on to the next class or not.
            Some(d) => unread |= d.members.iter().any(|m| m.name == "dispatch"),
            None => unread = true,
        }
    }
    (roles, not_proven)
}

/// Whether an entry point's method only reads (`GET`, `HEAD`, `OPTIONS`: the
/// methods DRF calls safe). None where the entry point is listed for every method
/// (`ANY`) or names none: some of its requests read and some do not.
pub fn reads_only(method: Option<&str>) -> Option<bool> {
    match method?.to_ascii_uppercase().as_str() {
        "GET" | "HEAD" | "OPTIONS" => Some(true),
        "ANY" | "*" | "" => None,
        _ => Some(false),
    }
}

/// Nest's guard decorator: the guard classes it runs are in the handler's
/// `decorator_args` as `pkg:@nestjs/common#UseGuards=<guard>` (facts schema 11).
const USE_GUARDS: &str = "pkg:@nestjs/common#UseGuards";
/// Nest's `SetMetadata`: a decorator built on it (`@Public()`) may open a route to a
/// global guard's callers.
const SET_METADATA: &str = "pkg:@nestjs/common#SetMetadata";

/// A Nest guard class is a guard when what it does proves it: it rejects a caller
/// ([`authenticates`], which applies Nest's guard contract) or is called as one
/// ([`callee_proves_guard`]). A class the facts do not define, or a package's that
/// proves nothing, cannot be read: opaque, never a guard.
fn nest_guard(ctx: &crate::context::RepoContext, guard: &str) -> Proof {
    // An in-repo class the facts do not define is read by nothing, its name included.
    if guard.starts_with("unresolved:") || (!external(guard) && ctx.definition(guard).is_none()) {
        Proof::Unreadable
    } else if authenticates(ctx, guard) || callee_proves_guard(ctx, guard) {
        Proof::Guard
    } else if external(guard) {
        Proof::Unreadable
    } else {
        Proof::NotAGuard
    }
}

/// An entry of [`drift_core::Symbol::app_middleware`] that is a guard class a Nest
/// application runs for every route ([`drift_core::NEST_GUARD`]): the class, and
/// whether every start of the application registers it.
pub fn global_guard_entry(m: &str) -> Option<(&str, bool)> {
    let (m, every) = match m.strip_prefix('?') {
        Some(m) => (m, false),
        None => (m, true),
    };
    m.strip_prefix(drift_core::NEST_GUARD).map(|g| (g, every))
}

/// What the decorators on a Nest route are to a guard class that runs for it
/// ([`nest_opt_out`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NestOptOut<'a> {
    /// No decorator of the route changes what the guard does for it.
    Applies,
    /// The guard lets the route through: its `canActivate` returns true, before it
    /// checks anything, where the route carries the metadata this decorator sets.
    Opens(&'a str),
    /// A decorator sets metadata, or is named for a public route, and the guard's
    /// body is not read to consult it or to ignore it: the guard may not run its
    /// check for this route.
    Unread,
}

/// The keys of the route metadata a decorator sets
/// ([`drift_core::controls::SETS_METADATA`]), `?` for one that is not read; none
/// for a decorator that sets no metadata. A decorator composed of others
/// (`applyDecorators(Public(), ApiTags("x"))`) sets what they set.
fn decorator_metadata<'a>(
    ctx: &crate::context::RepoContext<'a>,
    decorator: &str,
    depth: usize,
) -> Vec<&'a str> {
    let d = crate::mine::norm_ref(decorator);
    let d = d.trim_end_matches("()");
    if d == SET_METADATA {
        return vec!["?"];
    }
    let Some(def) = (!external(d)).then(|| ctx.definition(d)).flatten() else {
        return Vec::new();
    };
    let mut keys: Vec<&str> = def
        .controls
        .iter()
        .filter_map(|c| c.strip_prefix(drift_core::controls::SETS_METADATA))
        .collect();
    for c in def.calls.iter().chain(&def.returns_wrapped_by) {
        let c = crate::mine::norm_ref(c);
        let c = c.trim_end_matches("()");
        if c == SET_METADATA {
            // No key recorded for it: not read.
            if keys.is_empty() {
                keys.push("?");
            }
        } else if depth < 3 && !external(c) && c != d {
            keys.extend(decorator_metadata(ctx, c, depth + 1));
        }
    }
    keys.sort_unstable();
    keys.dedup();
    keys
}

/// What a guard class consults of the route it runs for ([`guard_metadata`]).
#[derive(Default)]
struct GuardMetadata<'a> {
    /// The keys whose presence makes the guard let the route through
    /// ([`drift_core::controls::OPENS_FOR_METADATA`]), each with where it is read
    /// (`handler`, `class`, `any`).
    opens: Vec<(&'a str, &'a str)>,
    /// The keys it reads and uses in a way that is not read
    /// ([`drift_core::controls::READS_METADATA`]), the same way.
    reads: Vec<(&'a str, &'a str)>,
    /// It reads metadata where neither the key nor the use is read
    /// ([`drift_core::controls::METADATA_UNREAD`]).
    unread: bool,
}

/// What the guard class `guard` consults of a route's metadata. A class with no
/// `canActivate` of its own runs its base's; a library's class is not read, but for
/// `@nestjs/passport`'s, whose `canActivate` reads no route metadata: what it calls
/// of the class (`getRequest`, `handleRequest`) is read with the class.
fn guard_metadata<'a>(
    ctx: &crate::context::RepoContext<'a>,
    guard: &str,
    depth: usize,
) -> GuardMetadata<'a> {
    let passport = |r: &str| r.trim_end_matches("()") == PASSPORT_AUTH_GUARD;
    let g = crate::mine::norm_ref(guard);
    let g = g.trim_end_matches("()");
    // A library's class: what it does with a route's metadata is not read.
    let Some(def) = (!external(g)).then(|| ctx.definition(g)).flatten() else {
        return GuardMetadata {
            unread: true,
            ..GuardMetadata::default()
        };
    };
    let keyed = |start: &str| -> Vec<(&'a str, &'a str)> {
        def.controls
            .iter()
            .filter_map(|c| c.strip_prefix(start))
            .filter_map(|c| c.split_once(':'))
            .collect()
    };
    let mut out = GuardMetadata {
        opens: keyed(drift_core::controls::OPENS_FOR_METADATA),
        reads: keyed(drift_core::controls::READS_METADATA),
        unread: def.kind != drift_core::SymbolKind::Class
            || def
                .controls
                .iter()
                .any(|c| c == drift_core::controls::METADATA_UNREAD),
    };
    let own = def.members.iter().any(|m| m.name == "canActivate");
    for base in def.wraps.iter().filter(|w| w.kind == WrapKind::Extends) {
        let b = crate::mine::norm_ref(&base.wrapper);
        // `@nestjs/passport`'s `canActivate` reads no route metadata: behind a
        // `canActivate` of the class's own, or run as the class's, it changes
        // nothing.
        if passport(&b) && (own || ctx.since_measured()) {
            continue;
        }
        // Its own `canActivate` may run the base's, or not: what the base consults
        // is this guard's only where the base's method is the one that runs.
        if own || depth >= 3 {
            out.unread = true;
            continue;
        }
        let inherited = guard_metadata(ctx, &b, depth + 1);
        out.opens.extend(inherited.opens);
        out.reads.extend(inherited.reads);
        out.unread |= inherited.unread;
    }
    out
}

/// The decorators written on a Nest route, each with whether it is written on the
/// controller class, and the keys `@SetMetadata(KEY, value)` sets where it is
/// written there itself ([`drift_core::controls::SETS_METADATA`] on the route's and
/// its class's own symbols). A handler's wraps hold its class's decorators too: one
/// that is on the class is taken to be written there.
pub fn route_decorators<'a>(
    wraps: impl Iterator<Item = &'a drift_core::Wrap>,
    s: &'a Symbol,
    classes: &[&'a Symbol],
) -> Vec<(&'a str, bool, Vec<&'a str>)> {
    let decorators = |wraps: &mut dyn Iterator<Item = &'a drift_core::Wrap>| -> Vec<&'a str> {
        wraps
            .filter(|w| w.kind == WrapKind::Decorator)
            .map(|w| w.wrapper.as_str())
            .collect()
    };
    let direct = |s: &'a Symbol| -> Vec<&'a str> {
        s.controls
            .iter()
            .filter_map(|c| c.strip_prefix(drift_core::controls::SETS_METADATA))
            .collect()
    };
    let on_class = decorators(&mut classes.iter().flat_map(|c| &c.wraps));
    let class_keys: Vec<&str> = classes.iter().flat_map(|c| direct(c)).collect();
    let mut wraps = wraps;
    decorators(&mut wraps)
        .into_iter()
        .filter(|d| !on_class.contains(d))
        .map(|d| (d, false, direct(s)))
        .chain(on_class.iter().map(|d| (*d, true, class_keys.clone())))
        .collect()
}

/// What the decorators on a Nest route ([`route_decorators`]) are to the guard class
/// `guard` that runs for it. `@Public()` opens a route only to a guard whose
/// `canActivate` is read to let it through for the key the decorator sets: a guard
/// that reads no metadata still turns its callers away, and one whose reads are not
/// followed may or may not.
pub fn nest_opt_out<'a>(
    ctx: &crate::context::RepoContext,
    guard: &str,
    decorators: &[(&'a str, bool, Vec<&'a str>)],
) -> NestOptOut<'a> {
    let metadata: Vec<(&str, bool, Vec<&str>)> = decorators
        .iter()
        .map(|(d, on_class, direct)| {
            // `@SetMetadata(...)` itself: the keys recorded where it is written.
            let own = crate::mine::norm_ref(d).trim_end_matches("()") == SET_METADATA;
            let keys = if own && !direct.is_empty() {
                direct.clone()
            } else {
                decorator_metadata(ctx, d, 0)
            };
            (*d, *on_class, keys)
        })
        .filter(|(_, _, keys)| !keys.is_empty())
        .collect();
    if metadata.is_empty() {
        return NestOptOut::Applies;
    }
    let GuardMetadata {
        opens,
        reads,
        unread: mut unsure,
    } = guard_metadata(ctx, guard, 0);
    for (decorator, on_class, keys) in &metadata {
        for k in keys {
            if *k == "?" {
                unsure = true;
                continue;
            }
            // `~`: the value the decorator sets is not read.
            let (k, value_read) = match k.strip_prefix('~') {
                Some(k) => (k, false),
                None => (*k, true),
            };
            for (target, key) in &opens {
                if *key == k {
                    if value_read && (*target == "any" || (*target == "class") == *on_class) {
                        return NestOptOut::Opens(decorator);
                    }
                    unsure = true;
                } else if key.starts_with('"') != k.starts_with('"') {
                    // One is a text and the other a binding: whether they are the
                    // same key is not read.
                    unsure = true;
                }
            }
            // A key the guard reads and uses in a way that is not read: what the
            // decorator sets may change what the guard does for this route.
            unsure |= reads
                .iter()
                .any(|(_, key)| *key == k || key.starts_with('"') != k.starts_with('"'));
        }
        // Written to open the route, by the decorator's name or by the text of a
        // key it sets (`@SetMetadata("isPublic", true)`): something not read may
        // honour it.
        let public = |name: &str| {
            crate::practices::libraries::key_words(name)
                .iter()
                .any(|w| crate::practices::libraries::PUBLIC_DECORATOR_NAMES.contains(&w.as_str()))
        };
        unsure |= public(&short(decorator))
            || keys
                .iter()
                .any(|k| k.trim_start_matches('~').starts_with('"') && public(k));
    }
    if unsure {
        NestOptOut::Unread
    } else {
        NestOptOut::Applies
    }
}

/// What the facts say of a Nest guard class ([`nest_guard`]), of a method used where
/// a guard goes ([`method_guard`]) and of a hook the application runs ([`app_hook`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Proof {
    Guard,
    NotAGuard,
    /// Not defined in the facts (a package's, or unresolved), or found and not proven
    /// to turn away the callers of every request: it may be the guard.
    Unreadable,
}

/// A TypeScript wrapper that names a method of a class of the repository
/// (`{ onRequest: Auth.requireUser }`, `router.use(Guards.signedIn)`): the method's own
/// body decides, not what the class does as a whole (`Auth.optional` beside
/// `Auth.requireUser`). A guard where the method has a check every request reaches
/// that answers "not signed in", throws a rejection class, or calls a guard; found
/// and not proven where its checks are conditional, or where the class turns callers
/// away and no method's own facts say where. `None` for anything else, which
/// [`authenticates`] reads.
pub fn method_guard(ctx: &crate::context::RepoContext, wrapper: &str) -> Option<Proof> {
    use drift_core::CheckOutcome::{SignInRedirect, Unauthenticated};
    let w = crate::mine::norm_ref(wrapper);
    let (module, rest) = w.split_once('#')?;
    if external(&w) || module.ends_with(".py") {
        return None;
    }
    let (class, method) = rest.split_once('.')?;
    let d = ctx.definition(&w)?;
    if d.kind != drift_core::SymbolKind::Class || d.name != class || method.contains(['.', '(']) {
        return None;
    }
    let signs_in = |m: &drift_core::Member| {
        m.body_checks
            .iter()
            .filter(|c| matches!(c.outcome, Unauthenticated | SignInRedirect))
            .map(|c| !c.conditional)
            .collect::<Vec<bool>>()
    };
    let rejects = |m: &drift_core::Member| {
        m.throws.iter().any(|t| grant::rejection_class(t))
            || m.calls
                .iter()
                .any(|c| !c.ends_with("(ref)") && !c.ends_with("(new)") && authenticates(ctx, c))
    };
    let m = d.members.iter().find(|m| m.name == method)?;
    let checks = signs_in(m);
    Some(if checks.contains(&true) || rejects(m) {
        Proof::Guard
    } else if !checks.is_empty() {
        Proof::Unreadable
    } else if authenticates(ctx, &format!("{module}#{class}"))
        && !d
            .members
            .iter()
            .any(|o| !signs_in(o).is_empty() || rejects(o))
    {
        // The class turns callers away and no method's facts say which one does.
        Proof::Unreadable
    } else {
        Proof::NotAGuard
    })
}

/// A plain value given where a handler goes in TypeScript (`app.get("/x", secured,
/// handler)`, `...apiGuards`): what it holds is not read where it is given, and may
/// be the guard, as the practice map reads it (`practices::authn`). Whether the
/// entry point is guarded is unknown.
fn value_given_as_handler(ctx: &crate::context::RepoContext, w: &drift_core::Wrap) -> bool {
    let python = w
        .wrapper
        .split('#')
        .next()
        .is_some_and(|m| m.ends_with(".py"));
    if python || external(&w.wrapper) || w.kind != WrapKind::Call {
        return false;
    }
    ctx.definition(&w.wrapper).is_some_and(|d| {
        matches!(
            d.kind,
            drift_core::SymbolKind::Const | drift_core::SymbolKind::Variable
        ) && d.name == short(&w.wrapper)
            && d.made_by.is_empty()
            && d.derives_from.is_empty()
            && d.wraps.is_empty()
            && !crate::practices::libraries::key_words(&d.name)
                .iter()
                .any(|k| crate::practices::libraries::NOT_AUTH_GUARD_NAMES.contains(&k.as_str()))
    })
}

/// Nest global guards by package: `APP_GUARD=<guard>` in the `decorator_args` of a
/// `@Module` class (`providers: [{ provide: APP_GUARD, useClass: G }]`) of a production
/// file, sorted.
fn app_guards(repo: &RepoFacts) -> BTreeMap<&str, BTreeSet<&str>> {
    let mut out: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for f in repo.files.iter().filter(|f| !is_test_path(&f.path)) {
        for s in &f.symbols {
            for (d, g) in s.decorator_args.iter().filter_map(|a| a.split_once('=')) {
                if d == "APP_GUARD" || d.ends_with("#APP_GUARD") || d.ends_with(".APP_GUARD") {
                    out.entry(f.package.as_str()).or_default().insert(g);
                }
            }
        }
    }
    out
}

/// A hook that runs before the requests of an application or a blueprint (Flask
/// `before_request`) and answers "not signed in" under a condition only (`if
/// request.path.startswith("/admin")`, `if request.blueprint == "items"`, after an
/// early return for some endpoints): it turns away the callers of some requests,
/// and which routes those are is not read. It is no proven guard of any one route,
/// and may be the guard of each.
pub fn hook_for_some_requests(ctx: &crate::context::RepoContext, hook: &str) -> bool {
    use drift_core::CheckOutcome::{SignInRedirect, Unauthenticated};
    if external(hook) {
        return false;
    }
    let Some(d) = ctx.definition(hook) else {
        return false;
    };
    let mut signs_in = d
        .body_checks
        .iter()
        .filter(|c| matches!(c.outcome, Unauthenticated | SignInRedirect))
        .peekable();
    signs_in.peek().is_some() && signs_in.all(|c| c.conditional)
}

/// The body has a check that answers "not signed in" (a 401, a sign-in redirect).
pub(crate) fn answers_not_signed_in(d: &Symbol) -> bool {
    use drift_core::CheckOutcome::{SignInRedirect, Unauthenticated};
    d.body_checks
        .iter()
        .any(|c| matches!(c.outcome, Unauthenticated | SignInRedirect))
}

/// What a hook the whole application runs before its requests (Flask
/// `before_request` on the application, `before_app_request` on a blueprint) is to
/// an entry point, as the practice map reads it: a guard where its definition, or
/// what that is built on, turns away a caller who is not signed in
/// ([`authenticates`]); not readable where it answers so for some requests only
/// ([`hook_for_some_requests`]), in an `except` handler that is not proven
/// ([`may_authenticate`]), where its body has such a check and nothing proves it,
/// where it does not resolve or is not defined, or where it is an auth library's
/// that no table classifies; no guard otherwise (it opens a database session, sets
/// `g.user = None`, logs).
fn app_hook(ctx: &crate::context::RepoContext, hook: &str) -> Proof {
    if hook_for_some_requests(ctx, hook) {
        return Proof::Unreadable;
    }
    if authenticates(ctx, hook) {
        return Proof::Guard;
    }
    let definition = (!external(hook)).then(|| ctx.definition(hook)).flatten();
    let unreadable = hook.starts_with("unresolved:")
        || member_of_a_value(ctx, hook)
        || may_authenticate(ctx, hook)
        || definition.is_some_and(answers_not_signed_in)
        || (!external(hook) && definition.is_none())
        || crate::practices::of_an_auth_library(hook);
    if unreadable {
        Proof::Unreadable
    } else {
        Proof::NotAGuard
    }
}

/// `s`'s guards and its other wrappers ([`EntryRow::guards`], [`EntryRow::wrappers`]),
/// each outermost first: a call wrapper, a decorator or a hook the whole application
/// runs ([`app_hook`]) is a guard when it turns callers away ([`authenticates`]);
/// configuration is a guard as it is.
///
/// Nest's `@UseGuards` is read through the guard classes the handler records
/// (`decorator_args`, whatever wrap delivered them: `@UseGuards(G)` or a decorator
/// composed on it): each class that proves a guard ([`nest_guard`]) is listed by its own
/// name, each that does not is a wrapper, one that cannot be read is opaque, and
/// `UseGuards` or a composed decorator with no class recorded is opaque [STRICT]. On a Nest route (`nest`), a global guard of its package (`APP_GUARD`, in
/// `app_guards`, and what `useGlobalGuards` registers) that proves one is listed as a
/// hook the whole app runs. A decorator of the route built on `SetMetadata` opens it
/// to a guard class only where that guard's `canActivate` is read to let the route
/// through for the key the decorator sets; where that is not read the guard is
/// opaque for the route, never counted and never dropped ([`nest_opt_out`]).
fn guards_and_wrappers(
    cx: &crate::practices::Cx,
    file: &FileFacts,
    s: &Symbol,
    mount: Option<&drift_core::MountFacts>,
    entry: &drift_core::EntryPoint,
    python: bool,
    app_guards: Option<&BTreeSet<&str>>,
) -> (Vec<String>, Vec<String>, Vec<String>) {
    let ctx = cx.context();
    let (nest, flask) = (
        entry.adapter == "nestjs",
        entry.adapter.starts_with("flask"),
    );
    // The permission classes a DRF view runs with could not be read
    // (`permission_classes = BASE + (...)`, `get_permissions`, an action's own): the
    // ones that were read are no proven guard of it.
    let unread_permissions = entry.adapter == "drf"
        && s.wraps
            .iter()
            .any(|w| w.kind == WrapKind::Call && w.wrapper.starts_with("unresolved:"));
    let (mut guards, mut wrappers, mut opaque) = (Vec::new(), Vec::new(), Vec::new());
    // What the entry point's own mount adds could not be read: whether it is guarded
    // is unknown, whatever the handler's other mounts add.
    if mount.is_some_and(|m| m.opaque) {
        opaque.push(MOUNT_OPAQUE.to_string());
    }
    let classes: Vec<&str> = s
        .decorator_args
        .iter()
        .filter_map(|a| a.split_once('='))
        .filter(|(d, _)| crate::mine::norm_ref(d) == USE_GUARDS)
        .map(|(_, g)| g)
        .collect();
    // The guard classes decide, whatever wrap delivered them: `@UseGuards(G)` itself
    // or a decorator composed on it (`applyDecorators(UseGuards(G))`).
    // What the route's own decorators change for a guard class ([`nest_opt_out`]):
    // the handler's, and those of its controller class.
    let controllers = if nest {
        crate::practices::owning_classes(file, s)
    } else {
        Vec::new()
    };
    // The classes a Python handler is a method of: where a view's `test_func` is.
    let owners = match crate::practices::owning_classes(file, s).first() {
        _ if !python => Vec::new(),
        Some(class) => vec![*class],
        None if s.kind == drift_core::SymbolKind::Class => vec![s],
        None => Vec::new(),
    };
    let decorators = route_decorators(
        mount.into_iter().flat_map(|m| &m.wraps).chain(&s.wraps),
        s,
        &controllers,
    );
    // What the reading of every guard position says of a guard class, where it
    // says anything ([`crate::guard_position::nest_guard`]): its body decides.
    let nest_guard = |ctx: &crate::context::RepoContext, g: &str| {
        use crate::guard_position::Verdict;
        match crate::guard_position::nest_guard(cx, &file.package, file.guard_calls_of(s), g) {
            Some(Verdict::Guard(_)) => Proof::Guard,
            Some(Verdict::Nothing) => Proof::NotAGuard,
            Some(Verdict::Unknown(_)) => Proof::Unreadable,
            None => nest_guard(ctx, g),
        }
    };
    for g in &classes {
        match (nest_guard(ctx, g), nest_opt_out(ctx, g, &decorators)) {
            (Proof::Guard, NestOptOut::Applies) => guards.push(short(g)),
            // The route's own decorator opens it to this guard.
            (Proof::Guard, NestOptOut::Opens(_)) | (Proof::NotAGuard, _) => wrappers.push(short(g)),
            (Proof::Guard, NestOptOut::Unread) | (Proof::Unreadable, _) => opaque.push(short(g)),
        }
    }
    // The application that serves it went where Drift does not read what was
    // registered on it: it may have a guard that was not seen.
    // And its middleware, as the practice map reads it
    // ([`crate::practices::read_route_middleware`]): the guard where it answers "not
    // signed in" for every request, opaque where that cannot be told. Behind one
    // that is the guard, what else the application has that was not read (the
    // wrapper it was passed to, which is that middleware) is no open question, as
    // it is none to the practice map.
    let (mut unread, mut by_middleware) = (Vec::new(), false);
    for m in mount
        .into_iter()
        .flat_map(|m| &m.app_middleware)
        .chain(&s.app_middleware)
    {
        use crate::practices::{AppMiddleware, read_route_middleware};
        if let Some(how) = m
            .trim_start_matches('?')
            .strip_prefix(drift_core::APP_UNREAD)
        {
            unread.push(how.to_string());
            continue;
        }
        // A guard class of the whole application: read with the module's below.
        if global_guard_entry(m).is_some() {
            continue;
        }
        // One that is a wrap of the route too (an Express guard registered beside
        // it) is read once, as the wrap.
        let same = crate::mine::norm_ref(m);
        if mount
            .into_iter()
            .flat_map(|x| &x.wraps)
            .chain(&s.wraps)
            .any(|w| crate::mine::norm_ref(&w.wrapper) == same)
        {
            continue;
        }
        // The call that built the route's handler, where its callee hands back the
        // function written in it and that function serves the request: the
        // handler's body, read below.
        if crate::guard_position::builds_handler(cx, m)
            && s.calls.iter().any(|c| {
                c.strip_suffix("()(ref)")
                    .is_some_and(|made_by| crate::mine::norm_ref(made_by) == same)
            })
        {
            continue;
        }
        match read_route_middleware(cx, file, s, m) {
            AppMiddleware::Guard(g, _) => {
                by_middleware = true;
                // What a wrap of the route proves too is listed once, as the wrap.
                let by = crate::mine::norm_ref(&g);
                if !mount
                    .into_iter()
                    .flat_map(|x| &x.wraps)
                    .chain(&s.wraps)
                    .any(|w| crate::mine::norm_ref(&w.wrapper) == by)
                {
                    guards.push(format!("{}{MIDDLEWARE}", short(&g)));
                }
            }
            AppMiddleware::MayGuard(_, g) => unread.push(format!("{}{MIDDLEWARE}", short(g))),
            AppMiddleware::NoGuard => {}
        }
    }
    if !by_middleware {
        opaque.extend(unread);
    }
    // The mount's own wraps are outermost: they run before the handler's.
    for w in mount.into_iter().flat_map(|m| &m.wraps).chain(&s.wraps) {
        if SCHEMA_ONLY.contains(&w.wrapper.as_str()) {
            continue;
        }
        // TypeScript: what stands where a guard goes is read by the one reading
        // every position takes ([`crate::guard_position`]): the guard, nothing, or
        // unknown, which is the default.
        if w.kind == WrapKind::Call && !python && crate::guard_position::applies(file) {
            use crate::guard_position::Verdict;
            match crate::guard_position::read(cx, file, s, &w.wrapper) {
                Verdict::Guard(_) => guards.push(short(&w.wrapper)),
                Verdict::Nothing => wrappers.push(short(&w.wrapper)),
                Verdict::Unknown(_) => opaque.push(short(&w.wrapper)),
            }
            continue;
        }
        if w.kind == WrapKind::Decorator && crate::mine::norm_ref(&w.wrapper) == USE_GUARDS {
            if classes.is_empty() {
                opaque.push(short(&w.wrapper));
            }
            continue;
        }
        let definition = (!external(&w.wrapper))
            .then(|| ctx.definition(&w.wrapper))
            .flatten();
        let calls = |name: &str| {
            definition.is_some_and(|d| {
                d.calls
                    .iter()
                    .chain(&d.returns_wrapped_by)
                    .any(|c| crate::mine::norm_ref(c).trim_end_matches("()") == name)
            })
        };
        // A DRF permission class: read by what it does for this entry point's
        // method, and not at all where the view's classes were not all read.
        if matches!(w.kind, WrapKind::Call | WrapKind::Config) {
            let label = match w.kind {
                WrapKind::Config => format!("{} (settings)", short(&w.wrapper)),
                _ => short(&w.wrapper),
            };
            let permission = drf_permission(&crate::mine::norm_ref(&w.wrapper)).is_some()
                || ctx
                    .ancestors(&crate::mine::norm_ref(&w.wrapper))
                    .iter()
                    .any(|a| drf_permission(a).is_some());
            let reads = match safe_methods(ctx, &w.wrapper) {
                // It lets a read through for anyone: no guard of one, the guard of
                // a write, and of an entry point listed for every method neither.
                Some(SafeMethods::Open) => reads_only(entry.method.as_deref()),
                Some(SafeMethods::Unread) => None,
                None => Some(false),
            };
            let unread = unread_permissions && w.wrapper.starts_with("unresolved:");
            // A class of the repository is read from its own `has_permission`.
            let own = repo_permission(ctx, &w.wrapper).filter(|_| !unread_permissions);
            if unread
                || own == Some(Proof::Unreadable)
                || reads.is_none() && own.is_none() && !(unread_permissions && permission)
            {
                opaque.push(label);
                continue;
            } else if (unread_permissions && permission)
                || own == Some(Proof::NotAGuard)
                || (reads == Some(true) && own.is_none())
            {
                wrappers.push(label);
                continue;
            }
        }
        // Django's `user_passes_test` and `UserPassesTestMixin`: by the test.
        match django_test(ctx, w, s, &owners) {
            Some(Proof::NotAGuard) => {
                wrappers.push(short(&w.wrapper));
                continue;
            }
            Some(Proof::Unreadable) => {
                opaque.push(short(&w.wrapper));
                continue;
            }
            // Read by its test: the guard.
            Some(Proof::Guard) if python && w.kind == WrapKind::Decorator => {
                guards.push(short(&w.wrapper));
                continue;
            }
            Some(Proof::Guard) | None => {}
        }
        // Python: what stands at the position is read in one place, as the
        // practice map reads it ([`crate::py_guards::classify`]).
        if python && let Some(at) = crate::py_guards::Position::of(w.kind, &entry.adapter) {
            use crate::py_guards::Verdict;
            let label = match w.kind {
                WrapKind::AppHook => format!("{}{APP_HOOK}", short(&w.wrapper)),
                _ => short(&w.wrapper),
            };
            let holders: Vec<&Symbol> = std::iter::once(s).chain(owners.iter().copied()).collect();
            let hook = at == crate::py_guards::Position::Hook;
            if hook && hook_for_some_requests(ctx, &w.wrapper) {
                opaque.push(label);
                continue;
            }
            match crate::py_guards::classify(ctx, at, &w.wrapper, &holders) {
                Verdict::Guard(_) => guards.push(label),
                Verdict::Nothing => wrappers.push(label),
                Verdict::Unknown(_) => opaque.push(label),
            }
            continue;
        }
        match w.kind {
            // Middleware of the settings that answers "not signed in" in an `except`
            // handler, not provably for every request: it may be the guard.
            WrapKind::Config
                if may_authenticate(ctx, &w.wrapper) && !authenticates(ctx, &w.wrapper) =>
            {
                opaque.push(format!("{} (settings)", short(&w.wrapper)));
            }
            WrapKind::Config => guards.push(format!("{} (settings)", short(&w.wrapper))),
            // A hook that turns callers away for some requests only: whether this
            // route is one of them is not read. Never shown as its guard.
            WrapKind::AppHook if hook_for_some_requests(ctx, &w.wrapper) => {
                opaque.push(format!("{}{APP_HOOK}", short(&w.wrapper)));
            }
            WrapKind::Call if flask && hook_for_some_requests(ctx, &w.wrapper) => {
                opaque.push(short(&w.wrapper));
            }
            // A hook the whole application runs is a guard where it turns away a
            // caller who is not signed in, as any wrapper is; one that opens a
            // database session, loads the user or logs is none, and one that cannot
            // be read may be.
            WrapKind::AppHook => {
                let label = format!("{}{APP_HOOK}", short(&w.wrapper));
                match app_hook(ctx, &w.wrapper) {
                    Proof::Guard => guards.push(label),
                    Proof::Unreadable => opaque.push(label),
                    Proof::NotAGuard => wrappers.push(label),
                }
            }
            // A method of a class: its own body decides.
            WrapKind::Call | WrapKind::Decorator if method_guard(ctx, &w.wrapper).is_some() => {
                match method_guard(ctx, &w.wrapper) {
                    Some(Proof::Guard) => guards.push(short(&w.wrapper)),
                    Some(Proof::Unreadable) => opaque.push(short(&w.wrapper)),
                    _ => wrappers.push(short(&w.wrapper)),
                }
            }
            WrapKind::Call | WrapKind::Decorator if authenticates(ctx, &w.wrapper) => {
                guards.push(short(&w.wrapper));
            }
            // A value whose contents are not read where it is given: never "no
            // guard".
            WrapKind::Call if value_given_as_handler(ctx, w) => {
                opaque.push(short(&w.wrapper));
            }
            // Built on `UseGuards`: the classes it delivers decided above; with none
            // recorded its guard cannot be read.
            WrapKind::Decorator if calls(USE_GUARDS) => {
                if classes.is_empty() {
                    opaque.push(short(&w.wrapper));
                }
            }
            // A Python dependency or decorator that could not be read
            // (`Depends(GUARDS["user"])`, an import that does not resolve, a member
            // of a module-level value): it may be the guard, as the practice map
            // reads it (unknown), never no guard.
            WrapKind::Call | WrapKind::Decorator
                if PYTHON_ADAPTERS.contains(&entry.adapter.as_str())
                    && (w.wrapper.starts_with("unresolved:")
                        || member_of_a_value(ctx, &w.wrapper)) =>
            {
                opaque.push(short(&w.wrapper));
            }
            // A dependency factory whose returned callable cannot be resolved
            // (`unresolved:<expr>(ref)`): what it runs is unknown, never no guard.
            WrapKind::Call if definition.is_some_and(returns_unresolved) => {
                opaque.push(short(&w.wrapper));
            }
            // It answers "not signed in" in an `except` handler, not provably for
            // every request: it may be the guard.
            WrapKind::Call | WrapKind::Decorator
                if may_authenticate(ctx, &w.wrapper)
                    || definition.is_some_and(answers_not_signed_in) =>
            {
                opaque.push(short(&w.wrapper));
            }
            WrapKind::Call | WrapKind::Decorator => wrappers.push(short(&w.wrapper)),
            _ => {}
        }
    }
    // (What a request handler's body may do to its caller is asked of request
    // entry points, as the practice map asks it.)
    let request = crate::practices::REQUEST_KINDS.contains(&entry.kind.as_str());
    let (in_body, unproven) = body_guards(cx, s, python, request);
    guards.extend(in_body);
    opaque.extend(unproven);
    if nest {
        // The guards of the whole application: a module's `APP_GUARD` providers and
        // what `useGlobalGuards` registers ([`global_guard_entry`]; one registered
        // under a condition may run and is not proven to).
        let global = app_guards.into_iter().flatten().map(|g| (*g, true)).chain(
            s.app_middleware
                .iter()
                .filter_map(|m| global_guard_entry(m)),
        );
        for (g, every) in global {
            let label = format!("{}{APP_HOOK}", short(g));
            match (nest_guard(ctx, g), nest_opt_out(ctx, g, &decorators)) {
                (Proof::Guard, NestOptOut::Applies) if every => guards.push(label),
                (Proof::NotAGuard, _) | (Proof::Guard, NestOptOut::Opens(_)) => {}
                (Proof::Guard, _) | (Proof::Unreadable, _) => opaque.push(label),
            }
        }
    }
    guards.dedup();
    wrappers.dedup();
    opaque.dedup();
    (guards, wrappers, opaque)
}

/// A request entry point's row says what the practice map says of its
/// authentication (`practices::authn`), where the two lists read here do not: one
/// answer on both surfaces, and never a fact on one where the other holds an
/// unknown that could change it.
///
/// - The map is unknown and the row has a guard: something that could not be read
///   may answer before the guard runs (a decorator outside it, a hook). The guard
///   is listed with what cannot be read, not counted.
/// - The map is unknown and the row has nothing: what the map could not read is
///   listed (a call of the handler's body whose definition is not in the facts, a
///   call that only its name says guards).
/// - The map has a guard the row lacks (a base class): it is listed.
///
/// True when the map knows the authentication and none of what it found turns a
/// caller away, nor only identifies one: it opens the route or checks a service's own
/// credential ([`EntryRow::known_open`]).
fn as_the_practice_map<'a>(
    cx: &crate::practices::Cx<'a>,
    declared_by: &BTreeMap<String, String>,
    file: &'a FileFacts,
    entry: &'a drift_core::EntryPoint,
    guards: &mut Vec<String>,
    opaque: &mut Vec<String>,
    identified: &mut Vec<String>,
) -> bool {
    use crate::practices::{Assignment, UnknownReason};
    let assignment = crate::practices::authn_of_entry(cx, file, entry);
    // A symbol a person declared is listed by name and whose word it rests on.
    let declared = |symbol: &str| {
        format!(
            "{} (declared by {})",
            short(symbol),
            declared_by
                .get(symbol)
                .map_or("a line of .drift/config.yaml", String::as_str)
        )
    };
    let known_open = matches!(&assignment, Assignment::Known { uses, .. }
        if !uses.is_empty()
            && !crate::practices::identified_only(uses)
            && !uses.iter().any(|u| crate::practices::enforces(&u.mechanism)));
    match assignment {
        // A unit the map does not read at all (a file that was not parsed, no
        // handler) says nothing of what was read here.
        Assignment::Unknown {
            reason: UnknownReason::Unparsed | UnknownReason::NoSymbol,
            ..
        } => {}
        Assignment::Unknown {
            instrument, reason, ..
        } => {
            if !guards.is_empty() {
                opaque.splice(0..0, guards.drain(..));
            } else if opaque.is_empty() {
                // A unit read in part is unknown for its handler's own bodies (authn
                // names the handler then).
                opaque.push(
                    if instrument.is_empty() || reason == UnknownReason::PartlyRead {
                        HANDLER_UNREAD.to_string()
                    } else {
                        short(&instrument)
                    },
                );
            }
        }
        // The caller identified and no one turned away: no guard, and said so by name.
        Assignment::Known { uses, .. } if crate::practices::identified_only(&uses) => {
            for u in &uses {
                let name = short(&u.instrument);
                if !identified.iter().any(|a| a.starts_with(&name)) {
                    identified.push(name);
                }
            }
        }
        Assignment::Known { uses, .. } if guards.is_empty() => {
            for u in uses
                .iter()
                .filter(|u| crate::practices::enforces(&u.mechanism))
            {
                if cx
                    .declared_label(crate::practices::AUTHN, &u.instrument)
                    .is_some()
                {
                    // A person's word is a guard where the route runs the symbol on
                    // every path; where it does not (under a branch, in a `try` whose
                    // handler goes on) it may be, as the map reads it (unknown).
                    if crate::practices::declared_on_every_path(
                        cx,
                        file,
                        entry,
                        crate::practices::AUTHN,
                        Some(&u.instrument),
                    )
                    .is_some()
                    {
                        guards.push(declared(&u.instrument));
                    } else {
                        opaque.push(short(&u.instrument));
                    }
                } else if u.mechanism == "base" {
                    guards.push(format!("{}{BASE}", short(&u.instrument)));
                } else {
                    guards.push(short(&u.instrument));
                }
            }
        }
        // Nothing found, and a symbol a person declared for authentication that the
        // route runs on every path through the calls the practice map follows
        // (`handler` calls `helper`, which calls `require_user`): its guard, as the
        // map reads it.
        Assignment::None { .. } if guards.is_empty() && opaque.is_empty() => {
            if let Some((symbol, _)) = crate::practices::declared_on_every_path(
                cx,
                file,
                entry,
                crate::practices::AUTHN,
                None,
            ) {
                guards.push(declared(symbol));
            }
        }
        _ => {}
    }
    known_open
}

/// Suffix of a guard that is a base class of the view (Django's
/// `LoginRequiredMixin`).
pub const BASE: &str = " (base)";
/// What [`EntryRow::opaque`] lists for an entry point the practice map cannot tell
/// and names nothing for.
pub const HANDLER_UNREAD: &str = "what its handler runs";

/// What [`EntryRow::opaque`] lists for an entry point whose mount adds dependencies
/// that could not be read ([`drift_core::MountFacts::opaque`]).
pub const MOUNT_OPAQUE: &str = "what its mount adds";

/// A factory (a FastAPI dependency built by a call, `Depends(auth_dependency())`) that
/// returns a callable the facts could not resolve (`unresolved:<expr>(ref)`).
pub(crate) fn returns_unresolved(d: &Symbol) -> bool {
    d.calls
        .iter()
        .any(|c| c.starts_with("unresolved:") && c.ends_with("(ref)"))
}

/// A wrapper that is a member of a module-level value, called or read
/// (`Depends(GUARDS.get("user"))`, `Depends(registry.current)`): what the value
/// holds there is not in its definition, so what runs is not read. It may be the
/// guard: opaque to `drift security`, unknown to the practice map.
pub fn member_of_a_value(ctx: &crate::context::RepoContext, wrapper: &str) -> bool {
    let w = crate::mine::norm_ref(wrapper);
    !external(&w)
        && ctx.definition(&w).is_some_and(|d| {
            matches!(
                d.kind,
                drift_core::SymbolKind::Const | drift_core::SymbolKind::Variable
            ) && short(&w)
                .strip_prefix(d.name.as_str())
                .is_some_and(|rest| rest.starts_with('.'))
        })
}

/// Suffix of a guard that is a middleware of the application serving the entry point
/// ([`drift_core::Symbol::app_middleware`]).
pub const MIDDLEWARE: &str = " (middleware)";
/// Suffix of a guard found in the handler's body ([`body_guards`]).
pub const BODY_CALL: &str = " (body call)";
/// Suffix of an in-body check that answers 401 or redirects to sign-in.
pub const BODY_CHECK: &str = " (body check)";

/// Guards in the handler's body, with their mechanism, as the practice map reads them
/// (`practices::authn`): the handler and the functions it passes by reference (two
/// levels: `respond(deleteHandler)`), their in-body checks that answer 401 or redirect
/// to sign-in (`body_checks`; not a check against an env secret, which is a service's
/// key) and the calls made before the continuation that [`body_call`] reads as a guard
/// by what they do, never by their name. A wrapper of the handler is not a body call.
///
/// Second, the calls that look like a guard and are not proven to reject
/// ([`BodyCall::Unproven`]): never guards, they go to [`EntryRow::opaque`].
fn body_guards(
    cx: &crate::practices::Cx<'_>,
    s: &Symbol,
    python: bool,
    request: bool,
) -> (Vec<String>, Vec<String>) {
    let ctx = cx.context();
    let mut bodies: Vec<&Symbol> = vec![s];
    let mut level: Vec<&Symbol> = vec![s];
    for _ in 0..2 {
        let mut next = Vec::new();
        for b in level {
            for c in &b.calls {
                let Some(r) = c.strip_suffix("(ref)") else {
                    continue;
                };
                // What a call of a function that hands back the function written
                // in it built: that body ([`crate::practices::common::bodies`]).
                let r = match r.strip_suffix("()") {
                    Some(made_by) if crate::guard_position::returns_function(cx, made_by) => {
                        made_by
                    }
                    _ => r,
                };
                if external(r) || bodies.len() >= 8 {
                    continue;
                }
                if let Some(d) = ctx.definition(r)
                    && d.kind == drift_core::SymbolKind::Function
                    && !bodies.iter().any(|x| std::ptr::eq(*x, d))
                {
                    bodies.push(d);
                    next.push(d);
                }
            }
        }
        level = next;
    }
    let wraps: BTreeSet<String> = s
        .wraps
        .iter()
        .map(|w| crate::mine::norm_ref(&w.wrapper).into_owned())
        .collect();
    let (mut out, mut unproven): (Vec<String>, Vec<String>) = (Vec::new(), Vec::new());
    for b in bodies {
        for c in &b.body_checks {
            if c.compares == "env"
                || !matches!(
                    c.outcome,
                    drift_core::CheckOutcome::Unauthenticated
                        | drift_core::CheckOutcome::SignInRedirect
                )
            {
                continue;
            }
            let what = if c.source.is_empty() {
                "manual".to_string()
            } else {
                format!("{}{}", short(&c.source), c.reads)
            };
            // TypeScript: a `try` whose handler answers 401 for some of what it
            // catches only, as the practice map reads it: found, not proven. Python:
            // a check only some requests reach (under a branch, after a return that
            // serves).
            if (!python
                && (c.condition == drift_core::not_always::SWALLOWED
                    || c.condition == drift_core::not_always::UNREAD_LOCAL))
                || (python && (c.conditional || check_after_work(ctx, b, c)))
            {
                unproven.push(format!("{what}{BODY_CHECK}"));
                continue;
            }
            out.push(format!("{what}{BODY_CHECK}"));
        }
        // TypeScript: the body throws where what gives the caller gave nothing.
        if !python
            && ctx.since_measured()
            && let Some(giver) = refuses_without_identity(ctx, b)
        {
            out.push(format!("{}{BODY_CHECK}", short(giver)));
        }
        // TypeScript: a branch on the caller's value hands back what was not read.
        for c in &b.controls {
            if let Some(source) = c.strip_prefix(drift_core::controls::EXIT_UNREAD)
                && !python
                && exit_unread_of_caller(source)
            {
                unproven.push(format!("{}{BODY_CHECK}", short(source)));
            }
        }
        if python && answers_401_unrecorded(b) {
            unproven.push(format!("{}{BODY_CHECK}", crate::practices::ANSWERS_401));
        }
        if python && request && crate::py_guards::verifies_uncaught(ctx, b, 0) {
            unproven.push(format!("{}{BODY_CHECK}", crate::py_guards::VERIFIES));
        }
        for c in &b.calls {
            if c.ends_with("(ref)") || c.ends_with("(new)") || not_a_body_call(b, &wraps, c) {
                continue;
            }
            // What refuses only by the value it hands back guards the body where
            // the body returns that value ([`hand_back`]).
            // (A signature verifier is a service's check, as the practice map reads it.)
            if python
                && request
                && crate::py_guards::dropped_unlisted(b, c)
                && !crate::practices::libraries::signature_callee(c)
            {
                unproven.push(format!("{}{BODY_CALL}", short(c)));
                continue;
            }
            if python && external(c) && crate::py_guards::called_guard(b, c) {
                if for_some_requests(ctx, b, c) || after_work(ctx, b, c) {
                    unproven.push(format!("{}{BODY_CALL}", short(c)));
                } else {
                    out.push(format!("{}{BODY_CALL}", short(c)));
                }
                continue;
            }
            match hand_back(ctx, b, c) {
                Some(HandBack::Returned) if python && after_work(ctx, b, c) => {
                    unproven.push(format!("{}{BODY_CALL}", short(c)));
                }
                Some(HandBack::Returned) => out.push(format!("{}{BODY_CALL}", short(c))),
                Some(HandBack::Unread) => unproven.push(format!("{}{BODY_CALL}", short(c))),
                Some(HandBack::Dropped) => {}
                None => match body_call(ctx, c) {
                    // Python: a guard the body calls for some of its requests only.
                    BodyCall::Guard
                        if called_for_some(ctx, python, b, c)
                            || (python && after_work(ctx, b, c)) =>
                    {
                        unproven.push(format!("{}{BODY_CALL}", short(c)));
                    }
                    BodyCall::Guard => out.push(format!("{}{BODY_CALL}", short(c))),
                    BodyCall::Unproven => unproven.push(format!("{}{BODY_CALL}", short(c))),
                    BodyCall::NotAGuard => {}
                },
            }
        }
    }
    out.sort();
    out.dedup();
    unproven.sort();
    unproven.dedup();
    (out, unproven)
}

/// The body answers 401 outside any `except` and no check records it
/// ([`drift_core::Symbol::body_checks`]): `if session.get("user_id"): return ...`
/// and then `abort(401)`. A refusal was found and what it is for was not read: the
/// body is never one that turns no one away.
pub(crate) fn answers_401_unrecorded(body: &Symbol) -> bool {
    body.responses
        .iter()
        .any(|r| r.status == 401 && !r.in_catch)
        && !answers_not_signed_in(body)
}

/// A call of `body` that [`body_guards`] does not read as a body call: one made only
/// after the body hands control on, one an in-body check already reads, or a wrapper
/// of the handler (`wraps`, normalised references).
pub(crate) fn not_a_body_call(body: &Symbol, wraps: &BTreeSet<String>, c: &str) -> bool {
    body.after_continuation.iter().any(|a| a == c)
        || body.body_checks.iter().any(|x| x.source == *c)
        || wraps.contains(crate::mine::norm_ref(c).as_ref())
}

/// Short names of `s`'s wraps of these kinds, outermost first; those applied by
/// configuration end in ` (settings)`.
fn wraps_of(s: &Symbol, kinds: &[WrapKind]) -> Vec<String> {
    s.wraps
        .iter()
        .filter(|w| kinds.contains(&w.kind) && !SCHEMA_ONLY.contains(&w.wrapper.as_str()))
        .map(|w| match w.kind {
            WrapKind::Config | WrapKind::ConfigAuthenticates => {
                format!("{} (settings)", short(&w.wrapper))
            }
            WrapKind::AppHook => format!("{}{APP_HOOK}", short(&w.wrapper)),
            _ => short(&w.wrapper),
        })
        .collect()
}

fn short(canonical: &str) -> String {
    let canonical = unwrapped(canonical);
    canonical
        .rsplit_once('#')
        .map_or(canonical, |(_, n)| n)
        .to_string()
}

/// What a reference names, without the wrapper the Python linker writes around a
/// decorator given to `method_decorator` for a method it does not read
/// (`unresolved:method_decorator(pkg:django#contrib.auth.decorators.login_required)`
/// names `pkg:django#contrib.auth.decorators.login_required`). Any other reference
/// is itself.
pub fn unwrapped(r: &str) -> &str {
    r.strip_prefix("unresolved:method_decorator(")
        .and_then(|x| x.strip_suffix(')'))
        .unwrap_or(r)
}

/// `lib/db.ts#runQuery.inner` -> (`lib/db.ts`, `runQuery`) for internal refs.
fn internal_target(r: &str) -> Option<(&str, &str)> {
    if r.starts_with("pkg:") || r.starts_with("global#") || r.starts_with("unresolved:") {
        return None;
    }
    let (module, rest) = r.split_once('#')?;
    let name = rest.split(['.', '(']).next()?;
    Some((module, name))
}

/// Which parameters of a body hold what an entry point was sent, as the reach
/// follows it ([`Index::reaches`]).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Carry {
    /// None of them: nothing on the way handed it on.
    None,
    /// Any of them: the entry point's own handler, or a call whose facts say
    /// only that some value read off a parameter was handed on.
    All,
    /// These positions (`#0`, `#2`), as the calls on the way handed it on.
    At(BTreeSet<String>),
}

impl Carry {
    /// Whether the parameter at `at` (`#1`, or `*` for one whose position is
    /// not read) holds it.
    fn holds(&self, at: &str) -> bool {
        match self {
            Carry::None => false,
            Carry::All => true,
            Carry::At(set) => at == "*" || set.contains(at),
        }
    }

    /// Adds what `other` holds; whether that added anything.
    fn join(&mut self, other: &Carry) -> bool {
        match other {
            Carry::None => false,
            Carry::All => {
                let changed = *self != Carry::All;
                *self = Carry::All;
                changed
            }
            Carry::At(b) => match self {
                Carry::All => false,
                Carry::None => {
                    *self = Carry::At(b.clone());
                    true
                }
                Carry::At(a) => {
                    let before = a.len();
                    a.extend(b.iter().cloned());
                    a.len() > before
                }
            },
        }
    }

    /// Holds the argument at `arg` of a call (`#1`; `*` at or after a spread).
    fn add_arg(&mut self, arg: &str) {
        if arg == "*" {
            *self = Carry::All;
            return;
        }
        match self {
            Carry::All => {}
            Carry::None => *self = Carry::At(BTreeSet::from([arg.to_string()])),
            Carry::At(set) => {
                set.insert(arg.to_string());
            }
        }
    }
}

/// Whether the body's operation of kind `kind` is given what `carried` holds: its
/// operand read off a parameter that holds it
/// ([`drift_core::controls::SINK_FED_AT`]). Where the facts say no position for
/// the kind (Python, a body read before positions were), any parameter does
/// ([`drift_core::controls::SINK_FED`]).
fn fed_through(facts: &[String], kind: &str, carried: &Carry) -> bool {
    use drift_core::controls::{SINK_FED, SINK_FED_AT};
    if *carried == Carry::None {
        return false;
    }
    let at: Vec<&str> = facts
        .iter()
        .filter_map(|c| c.strip_prefix(SINK_FED_AT))
        .filter_map(|c| c.split_once('\t'))
        .filter(|(k, _)| *k == kind)
        .map(|(_, at)| at)
        .collect();
    if at.is_empty() {
        return facts
            .iter()
            .any(|c| c.strip_prefix(SINK_FED).is_some_and(|k| k == kind));
    }
    at.iter().any(|p| *p != "-" && carried.holds(p))
}

/// Which parameters of what the call `call` runs hold what `carried` holds of the
/// calling body: the callee's parameter at each argument read off a parameter
/// that holds it ([`drift_core::controls::PASSES_AT`]), any of them where the facts
/// say no position ([`drift_core::controls::PASSES_PARAM`]). With `made` (the
/// body is the entry point's handler or what names it), the arguments read off a
/// parameter of the function the body hands back too
/// ([`drift_core::controls::PASSES_MADE_AT`], [`drift_core::controls::PASSES_MADE`]).
fn carried_into(facts: &[String], call: &str, carried: &Carry, made: bool) -> Carry {
    use drift_core::controls::{PASSES_AT, PASSES_MADE, PASSES_MADE_AT, PASSES_PARAM};
    let says = |start: &str| {
        facts
            .iter()
            .any(|c| c.strip_prefix(start).is_some_and(|x| x == call))
    };
    let mut out = Carry::None;
    if *carried != Carry::None {
        let at: Vec<(&str, &str)> = facts
            .iter()
            .filter_map(|c| c.strip_prefix(PASSES_AT))
            .filter_map(|c| {
                let mut parts = c.rsplitn(3, '\t');
                let at = parts.next()?;
                let arg = parts.next()?;
                let callee = parts.next()?;
                (callee == call).then_some((arg, at))
            })
            .collect();
        if at.is_empty() {
            if says(PASSES_PARAM) {
                out = Carry::All;
            }
        } else {
            for (arg, from) in at {
                if carried.holds(from) {
                    out.add_arg(arg);
                }
            }
        }
    }
    if made {
        let at: Vec<&str> = facts
            .iter()
            .filter_map(|c| c.strip_prefix(PASSES_MADE_AT))
            .filter_map(|c| c.rsplit_once('\t'))
            .filter(|(callee, _)| *callee == call)
            .map(|(_, arg)| arg)
            .collect();
        if at.is_empty() {
            if says(PASSES_MADE) {
                out = Carry::All;
            }
        } else {
            for arg in at {
                out.add_arg(arg);
            }
        }
    }
    out
}

struct Index<'a> {
    /// (module, exported or local name) -> symbol.
    by_name: BTreeMap<(&'a str, &'a str), (&'a FileFacts, &'a Symbol)>,
}

/// A place sinks are read from: a symbol as a whole, or one method of a class
/// ([`Symbol::members`]).
#[derive(Clone, Copy)]
struct Node<'a> {
    file: &'a FileFacts,
    symbol: &'a Symbol,
    member: Option<&'a drift_core::Member>,
}

impl<'a> Node<'a> {
    fn key(&self) -> String {
        match self.member {
            Some(m) => format!("{}#{}.{}", self.file.path, self.symbol.name, m.name),
            None => format!("{}#{}", self.file.path, self.symbol.name),
        }
    }

    fn sinks(&self) -> &'a [String] {
        self.member.map_or(&self.symbol.sinks, |m| &m.sinks)
    }

    fn calls(&self) -> &'a [String] {
        self.member.map_or(&self.symbol.calls, |m| &m.calls)
    }
}

/// In-repo base classes followed at most this deep to find an inherited method.
const MAX_BASES: usize = 4;

impl<'a> Index<'a> {
    fn new(repo: &'a RepoFacts) -> Self {
        let mut by_name = BTreeMap::new();
        for f in &repo.files {
            for s in &f.symbols {
                by_name.insert((f.path.as_str(), s.name.as_str()), (f, s));
                for e in &s.exported_as {
                    by_name
                        .entry((f.path.as_str(), e.as_str()))
                        .or_insert((f, s));
                }
            }
        }
        Self { by_name }
    }

    fn lookup(&self, r: &str) -> Option<(&'a FileFacts, &'a Symbol)> {
        let (m, n) = internal_target(r)?;
        self.by_name.get(&(m, n)).copied()
    }

    /// The method `name` of `class` or of an in-repo class it extends.
    fn method(
        &self,
        file: &'a FileFacts,
        class: &'a Symbol,
        name: &str,
        depth: usize,
    ) -> Option<Node<'a>> {
        if let Some(m) = class.members.iter().find(|m| m.name == name) {
            return Some(Node {
                file,
                symbol: class,
                member: Some(m),
            });
        }
        if depth >= MAX_BASES {
            return None;
        }
        class
            .wraps
            .iter()
            .filter(|w| w.kind == WrapKind::Extends)
            .filter_map(|w| self.lookup(&w.wrapper))
            .filter(|(_, b)| b.kind == drift_core::SymbolKind::Class)
            .find_map(|(bf, b)| self.method(bf, b, name, depth + 1))
    }

    /// What a call runs. A call of a class's method (`ProjectService.exists()`,
    /// `this.storage.upload()`, `storage.delete()` on a binding to `new StorageClient()`)
    /// runs that method alone; building an instance (`new X()`, `X()`) runs its
    /// constructor. Neither runs the class's other methods, and a member that is no
    /// method of the class or of an in-repo base (`Model.objects`, a package base's
    /// method) runs none of them. Django's `View.as_view()` dispatches to every handler,
    /// so it is the class as a whole. Classes the facts record no methods for are read
    /// as a whole.
    fn target(&self, call: &str) -> Option<Node<'a>> {
        let (f, s) = self.lookup(call)?;
        let rest = call.split_once('#')?.1;
        let after = &rest[rest.find(['.', '(']).unwrap_or(rest.len())..];
        // `X().run()`, `new X().run()`: the method called on the instance built.
        let after = after
            .strip_prefix("(new)")
            .or_else(|| after.strip_prefix("()"))
            .unwrap_or(after);
        let member = after
            .strip_prefix('.')
            .map(|m| &m[..m.find(['.', '(']).unwrap_or(m.len())]);
        let whole = Node {
            file: f,
            symbol: s,
            member: None,
        };
        let class = |cf: &'a FileFacts, cs: &'a Symbol| -> Option<Node<'a>> {
            match member {
                Some("as_view") => Some(Node {
                    file: cf,
                    symbol: cs,
                    member: None,
                }),
                Some(m) => self.method(cf, cs, m, 0),
                None => {
                    let init = if cf.lang == "py" {
                        "__init__"
                    } else {
                        "constructor"
                    };
                    self.method(cf, cs, init, 0)
                }
            }
        };
        if s.kind == drift_core::SymbolKind::Class && !s.members.is_empty() {
            return class(f, s);
        }
        // A binding to an instance: `export const storage = new StorageClient()`.
        if member.is_some()
            && matches!(
                s.kind,
                drift_core::SymbolKind::Const | drift_core::SymbolKind::Variable
            )
        {
            let built: Vec<(&'a FileFacts, &'a Symbol)> = s
                .calls
                .iter()
                .filter_map(|c| c.strip_suffix("(new)"))
                .filter_map(|c| self.lookup(c))
                .filter(|(_, c)| c.kind == drift_core::SymbolKind::Class && !c.members.is_empty())
                .collect();
            if let [(cf, cs)] = built.as_slice() {
                return class(cf, cs);
            }
        }
        Some(whole)
    }

    /// Where reading an entry point starts: a handler method of a class view
    /// (`PostView.get`) is read as that method of its class, which also records the
    /// sibling methods it calls through `self`.
    fn start(&self, f: &'a FileFacts, s: &'a Symbol) -> Node<'a> {
        if let Some((class, method)) = s.name.split_once('.')
            && let Some(&(cf, cs)) = self.by_name.get(&(f.path.as_str(), class))
            && cs.kind == drift_core::SymbolKind::Class
            && let Some(m) = cs.members.iter().find(|m| m.name == method)
        {
            return Node {
                file: cf,
                symbol: cs,
                member: Some(m),
            };
        }
        Node {
            file: f,
            symbol: s,
            member: None,
        }
    }

    /// The bodies `start` runs: itself and what it calls, through at most
    /// [`MAX_HOPS`] internal calls, each once.
    fn reach_nodes(&self, start: (&'a FileFacts, &'a Symbol)) -> Vec<Node<'a>> {
        let first = self.start(start.0, start.1);
        let mut seen: BTreeSet<String> = BTreeSet::from([first.key()]);
        let mut out = Vec::new();
        let mut queue: VecDeque<(Node, usize)> = VecDeque::from([(first, 0)]);
        while let Some((node, hops)) = queue.pop_front() {
            if hops < MAX_HOPS {
                for c in node.calls() {
                    if let Some(next) = self.target(c)
                        && seen.insert(next.key())
                    {
                        let same = std::ptr::eq(next.symbol, node.symbol);
                        queue.push_back((next, hops + usize::from(!same)));
                    }
                }
            }
            out.push(node);
        }
        out
    }

    /// Sinks reached from `start` through at most [`MAX_HOPS`] internal calls,
    /// one shortest chain per sink kind.
    fn reaches(&self, start: (&'a FileFacts, &'a Symbol)) -> Vec<Reach> {
        let first = self.start(start.0, start.1);
        let entry = format!("{}#{}", start.0.path, start.1.name);
        // One chain per kind: the shortest, and before it one whose operation is fed
        // by a parameter.
        let mut found: BTreeMap<String, (Vec<String>, bool)> = BTreeMap::new();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        // Hops are counted between symbols: a call of a sibling method of the same class
        // (`this.fetchFile()` in `download`) is no hop, as it was none while a class was
        // read as a whole.
        // `carried`: which parameters of the body hold what the entry point was
        // sent ([`Carry`]): every call on the way handed it on, at the argument
        // the callee's parameter is ([`drift_core::controls::PASSES_AT`]), or,
        // where the facts say no position, handed on some value read off a
        // parameter ([`drift_core::controls::PASSES_PARAM`]). A body is read again
        // when it is met carrying a parameter it was not read carrying, the
        // carried reading first where both are met.
        let mut queue: VecDeque<(Node, Vec<String>, usize, Carry)> = VecDeque::new();
        let mut seen_carried: BTreeMap<String, Carry> = BTreeMap::new();
        seen.insert(first.key());
        seen_carried.insert(first.key(), Carry::All);
        queue.push_back((first, vec![entry], 0, Carry::All));
        while let Some((node, chain, hops, carried)) = queue.pop_front() {
            let facts = flow_facts(&node);
            let says = |start: &str, what: &str| {
                facts
                    .iter()
                    .any(|c| c.strip_prefix(start).is_some_and(|x| x == what))
            };
            // What the entry point names as its handler may be a function that
            // makes the handler (`app.post("/login", login())`): the parameters of
            // what it makes are what the request sent.
            let made = chain.len() <= 2;
            for k in node.sinks() {
                if chain.len() == 1 || INPUT_SINKS.contains(&k.as_str()) {
                    use drift_core::controls::SINK_FED_MADE;
                    let fed = fed_through(facts, k, &carried) || (made && says(SINK_FED_MADE, k));
                    match found.get(k) {
                        Some((_, was)) if *was || !fed => {}
                        _ => {
                            found.insert(k.clone(), (chain.clone(), fed));
                        }
                    }
                }
            }
            if hops >= MAX_HOPS {
                continue;
            }
            for c in node.calls() {
                let Some(next) = self.target(c) else {
                    continue;
                };
                let key = next.key();
                let passes = carried_into(facts, c, &carried, made);
                let new = seen.insert(key.clone());
                let newly_carried = if passes == Carry::None {
                    false
                } else if let Some(was) = seen_carried.get_mut(&key) {
                    was.join(&passes)
                } else {
                    seen_carried.insert(key.clone(), passes.clone());
                    true
                };
                if new || newly_carried {
                    let same = std::ptr::eq(next.symbol, node.symbol);
                    let mut chain = chain.clone();
                    chain.push(key);
                    queue.push_back((next, chain, hops + usize::from(!same), passes));
                }
            }
        }
        found
            .into_iter()
            .map(|(kind, (via, fed))| Reach { kind, via, fed })
            .collect()
    }
}

/// Shortest chain of value imports from `from` to the module `to` (inclusive).
/// An edge a module makes to re-export ([`forwards`]) is followed only for names
/// asked of that module, as client leaks follow it: a client importing `Button` from
/// a barrel does not reach what the barrel forwards under other names.
fn import_chain(repo: &RepoFacts, from: &str, to: &str) -> Vec<String> {
    if to.starts_with("env:") {
        return vec![from.to_string(), to.to_string()];
    }
    let by_path: BTreeMap<&str, &FileFacts> =
        repo.files.iter().map(|f| (f.path.as_str(), f)).collect();
    // A step: a module and the names asked of it (`None`: all of it).
    type Step<'a> = (&'a str, Option<BTreeSet<String>>);
    let mut prev: BTreeMap<Step, Step> = BTreeMap::new();
    let start: Step = (from, None);
    let mut queue = VecDeque::from([start.clone()]);
    let mut seen = BTreeSet::from([start]);
    while let Some(step) = queue.pop_front() {
        let Some(f) = by_path.get(step.0) else {
            continue;
        };
        for i in f.imports.iter().filter(|i| !i.type_only) {
            let whole = i.names.is_empty() || i.names.iter().any(|n| n == "*");
            let asked = match (forwards(f, i), &step.1) {
                // The file's own code uses the module, or every name is asked of it.
                (None, _) | (Some(_), None) => (!whole).then(|| i.names.iter().cloned().collect()),
                (Some(fw), Some(want)) => {
                    let names: BTreeSet<String> = fw
                        .iter()
                        .filter(|(exported, _)| {
                            want.contains(exported.as_str()) || want.contains("*")
                        })
                        .map(|(_, source)| source.clone())
                        .chain(stars_for(&by_path, f, i, want))
                        .collect();
                    if names.is_empty() {
                        continue;
                    }
                    (!names.contains("*")).then_some(names)
                }
            };
            let next: Step = (i.module.as_str(), asked);
            if !seen.insert(next.clone()) {
                continue;
            }
            prev.insert(next.clone(), step.clone());
            if next.0 == to {
                let mut chain = vec![to.to_string()];
                let mut x = next;
                while let Some(y) = prev.get(&x) {
                    chain.push(y.0.to_string());
                    x = y.clone();
                }
                chain.reverse();
                return chain;
            }
            queue.push_back(next);
        }
    }
    vec![from.to_string(), to.to_string()]
}

/// When `f` imports `i` to re-export from it: each exported name with the name it
/// has in `i`'s module (`*` for `export * as ns`). `None` when `f`'s own code may use
/// the import: some name of it is not re-exported. An `export *` source is
/// [`stars_for`]'s.
fn forwards(f: &FileFacts, i: &drift_core::Import) -> Option<Vec<(String, String)>> {
    let star = format!("{}#*", i.module);
    if i.names.iter().all(|n| n == "*")
        && !i.names.is_empty()
        && f.exports.iter().any(|e| e.origin == star)
    {
        return Some(
            f.exports
                .iter()
                .filter(|e| e.origin == star && e.name != "*")
                .map(|e| (e.name.clone(), "*".to_string()))
                .collect(),
        );
    }
    let member = |e: &drift_core::Export| e.origin.rsplit_once('#').map(|(_, n)| n.to_string());
    let mut out = Vec::new();
    for n in &i.names {
        let by: Vec<(String, String)> = f
            .exports
            .iter()
            .filter(|e| e.kind == drift_core::ExportKind::ReExport)
            .filter(|e| member(e).as_deref() == Some(n.as_str()))
            .map(|e| (e.name.clone(), n.clone()))
            .collect();
        if by.is_empty() {
            return None;
        }
        out.extend(by);
    }
    (!out.is_empty()).then_some(out)
}

/// The names asked of `f` that it forwards from `i`'s module through `export *`:
/// names `f` re-exports that way (`ExportKind::ReExportAll`) whose origin is in that
/// module, or that the module exports itself.
fn stars_for(
    by_path: &BTreeMap<&str, &FileFacts>,
    f: &FileFacts,
    i: &drift_core::Import,
    want: &BTreeSet<String>,
) -> Vec<String> {
    let star = format!("{}#*", i.module);
    if !f.exports.iter().any(|e| e.name == "*" && e.origin == star) {
        return vec![];
    }
    let prefix = format!("{}#", i.module);
    let exports_it = |n: &str| match by_path.get(i.module.as_str()) {
        Some(m) => m.exports.iter().any(|e| e.name == n),
        None => true,
    };
    f.exports
        .iter()
        .filter(|e| e.kind == drift_core::ExportKind::ReExportAll && want.contains(&e.name))
        .filter(|e| e.origin.starts_with(&prefix) || exports_it(&e.name))
        .map(|e| e.name.clone())
        .collect()
}

/// Build the inventory. Test files and other non-production code (examples,
/// samples, demos, playgrounds, integration-test suites; see [`NonProduction`])
/// are left out, as mining and `check` leave them out.
/// The inventory with no boundary read: every exposure unknown.
pub fn inventory(repo: &RepoFacts) -> Inventory {
    inventory_with(repo, Boundaries::default())
}

/// The inventory, with each entry point's exposure from `boundaries`.
pub fn inventory_with(repo: &RepoFacts, boundaries: Boundaries) -> Inventory {
    let mut boundaries = boundaries;
    let cautious = boundaries.cautious.take();
    let declared = std::mem::take(&mut boundaries.declared);
    let declared_by = std::mem::take(&mut boundaries.declared_by);
    // Every entry point Drift lists, the ones mining does not read yet included
    // ([`drift_core::Listed`]).
    let listed = repo.listed();
    let repo = &*listed;
    let index = Index::new(repo);
    // The practice map's own reader, for what the inventory reads as it does (an
    // application's middleware): one reading, one answer on both surfaces.
    let cx = crate::practices::Cx::new(repo, &declared);
    let app_guards = app_guards(repo);
    let non_production = NonProduction::learn(repo);
    let mut inv = Inventory {
        boundaries,
        unchecked: repo
            .stack_unavailable()
            .into_iter()
            .map(str::to_string)
            .collect(),
        skipped: {
            use drift_core::SkipReason;
            // A declaration file holds no code, a generated one none that was
            // written here; a file with no stack to parse it is listed as not checked.
            let mut skipped: Vec<drift_core::Skipped> = repo
                .skipped
                .iter()
                .filter(|s| {
                    !matches!(
                        s.reason,
                        SkipReason::Declaration
                            | SkipReason::Generated
                            | SkipReason::StackUnavailable
                    ) && !is_test_path(&s.path)
                })
                .cloned()
                .collect();
            skipped.sort();
            skipped.dedup();
            skipped
        },
        unlisted: repo
            .files
            .iter()
            .filter(|f| {
                !is_test_path(&f.path) && non_production.dir_of(&f.path, &f.package).is_none()
            })
            .flat_map(|f| {
                f.unlisted_routes.iter().map(|line| Unlisted {
                    path: f.path.clone(),
                    line: *line,
                    symbol: String::new(),
                })
            })
            .collect(),
        ..Inventory::default()
    };
    // Before any entry point is given its service's exposure.
    inv.boundaries.set_relays(repo);
    let mut env: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut leaks: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut left_out: BTreeSet<String> = BTreeSet::new();
    // The adapter of each entry point, in the order they are pushed.
    let mut adapters: Vec<&str> = Vec::new();
    for f in &repo.files {
        if is_test_path(&f.path) {
            continue;
        }
        if let Some(dir) = non_production.dir_of(&f.path, &f.package) {
            inv.left_out.files += 1;
            left_out.insert(dir);
            continue;
        }
        for l in &f.client_leaks {
            leaks.entry(l).or_default().push(&f.path);
        }
        for s in &f.symbols {
            for k in &s.sinks {
                inv.sinks.push(SinkUse {
                    kind: k.clone(),
                    path: f.path.clone(),
                    symbol: s.name.clone(),
                    line: s.line,
                    fed: sink_fed(s, k),
                });
            }
            for r in &s.reads {
                env.entry(r.clone()).or_default().insert(f.path.clone());
            }
        }
        for e in &f.entry_points {
            // A route file may only re-export its handler (`export { GET } from
            // "../v1/route"`): the route is this file's, the code its origin's.
            let Some((origin, s)) = crate::entries::entry_symbol(repo, f, e) else {
                continue;
            };
            let (exposure, boundary) = inv.boundaries.of(&f.path);
            let (mut guards, wrappers, mut opaque) = guards_and_wrappers(
                &cx,
                origin,
                s,
                f.mount(e),
                e,
                f.lang == "py",
                app_guards.get(f.package.as_str()),
            );
            // One answer on both surfaces, for every language: where the lists
            // read above and the practice map differ, the row says what the map
            // says.
            let mut authenticates =
                wraps_of(s, &[WrapKind::Authenticates, WrapKind::ConfigAuthenticates]);
            let mut known_open = false;
            if crate::practices::REQUEST_KINDS.contains(&e.kind.as_str()) {
                known_open = as_the_practice_map(
                    &cx,
                    &declared_by,
                    f,
                    e,
                    &mut guards,
                    &mut opaque,
                    &mut authenticates,
                );
            }
            // A webhook whose body verifies the sending service's signature: no
            // sign-in by design, and not "no guard found".
            let verifies_signature = if guards.is_empty()
                && opaque.is_empty()
                && crate::practices::REQUEST_KINDS.contains(&e.kind.as_str())
            {
                crate::practices::verified_signatures(&cx, f.lang == "py", s)
            } else {
                Vec::new()
            };
            // No guard found: what that rests on, as the practice map says it.
            let basis = (guards.is_empty()
                && opaque.is_empty()
                && verifies_signature.is_empty()
                && !local_kind(&e.kind)
                && !queue_kind(&e.kind))
            .then(|| {
                crate::practices::basis::of_entry(
                    &cx,
                    &crate::practices::UnitRef::Entry {
                        file: f,
                        entry: e,
                        symbol: Some(s),
                    },
                )
            });
            adapters.push(if f.mount(e).is_some_and(|m| m.elsewhere) {
                SERVED_ELSEWHERE
            } else {
                &e.adapter
            });
            inv.entry_points.push(EntryRow {
                exposure,
                boundary: boundary.map(str::to_string),
                path: f.path.clone(),
                package: f.package.clone(),
                symbol: e.symbol.clone(),
                // The row is the route file's: a re-export has no line the facts keep.
                line: if std::ptr::eq(origin, f) { s.line } else { 1 },
                kind: e.kind.clone(),
                method: e.method.clone(),
                route: e.route.clone(),
                guards,
                wrappers,
                opaque,
                authenticates,
                opens: wraps_of(s, &[WrapKind::Opens]),
                validates: s.controls.iter().any(|c| c == "validates"),
                reaches: index.reaches((origin, s)),
                reads: s.reads.clone(),
                local: local_kind(&e.kind),
                descriptions: Vec::new(),
                tied: false,
                basis,
                exposure_basis: None,
                known_open,
                verifies_signature,
            });
        }
    }
    under_guarded_layouts(&mut inv.entry_points);
    inv.boundaries.set_apps(
        repo.files
            .iter()
            .flat_map(|f| {
                f.apps
                    .iter()
                    .map(|a| ((f.path.clone(), a.name.clone()), a.unknown.clone()))
            })
            .collect(),
    );
    inv.boundaries.expose(&mut inv.entry_points, &adapters);
    for e in &mut inv.entry_points {
        if e.exposure == Exposure::Internal {
            e.exposure_basis = Some(inv.boundaries.exposure_basis(
                &e.path,
                e.boundary.as_deref(),
                &inv.skipped,
            ));
        }
    }
    inv.entry_points.sort();
    // One row per entry point: a symbol two sources declare the same way (a console
    // script naming an argparse `main`) is one entry point, not two.
    inv.entry_points.dedup();
    if let Some((files, person)) = cautious {
        // What an agent left out may not make a route reachable only from inside:
        // where the boundary without it does not say so, the route is unknown.
        let without = inventory_with(repo, *person);
        let key = |e: &EntryRow| {
            (
                e.path.clone(),
                e.symbol.clone(),
                e.line,
                e.method.clone(),
                e.route.clone(),
            )
        };
        let then: BTreeMap<_, Exposure> = without
            .entry_points
            .iter()
            .map(|e| (key(e), e.exposure))
            .collect();
        let files: Vec<String> = files.iter().map(|f| format!("`{f}`")).collect();
        for e in &mut inv.entry_points {
            if e.exposure == Exposure::Internal && then.get(&key(e)) != Some(&Exposure::Internal) {
                e.exposure = Exposure::Unknown;
                e.boundary = Some(format!(
                    "reachable only from inside only if {} deploys nothing, which an agent answered and no person confirmed (drift setup)",
                    files.join(" and ")
                ));
            }
        }
    }
    inv.guard_gaps = guard_gaps_built_on(repo, &cx, &inv.entry_points);
    inv.scope_gaps = scope_gaps(repo, &index, &cx);
    inv.whole_rows = crate::whole_rows::read(
        repo,
        &inv.entry_points
            .iter()
            .map(|e| (e.path.clone(), e.symbol.clone()))
            .collect(),
    );
    let unreached = unreached_handlers(repo, &index, &non_production);
    inv.unlisted.extend(unreached);
    inv.unlisted.sort();
    inv.unlisted.dedup();
    // A property written under a key read off a parameter is a risk where a
    // request chooses the key. In a helper, the parameter is whatever its callers
    // pass: the write is listed where an entry point reaches it with a value each
    // call from the entry point handed on, and nowhere else.
    const KEY_WRITE: &str = "dynamic_key_write";
    for e in &mut inv.entry_points {
        e.reaches.retain(|r| r.kind != KEY_WRITE || r.fed);
    }
    let fed_writes: BTreeSet<String> = inv
        .entry_points
        .iter()
        .flat_map(|e| &e.reaches)
        .filter(|r| r.kind == KEY_WRITE)
        .filter_map(|r| r.via.last().cloned())
        .collect();
    // A method that is no symbol of its own is reached as a member of its class
    // (`path#Class.method`), while its write is a row of the class (`path#Class`).
    inv.sinks.retain(|s| {
        let key = format!("{}#{}", s.path, s.symbol);
        let member = format!("{key}.");
        s.kind != KEY_WRITE
            || fed_writes.contains(&key)
            || fed_writes
                .range(member.clone()..)
                .next()
                .is_some_and(|w| w.starts_with(&member))
    });
    inv.sinks.sort();
    inv.client_leaks = leaks
        .into_iter()
        .map(|(reaches, clients)| LeakGroup {
            reaches: reaches.to_string(),
            example: import_chain(repo, clients[0], reaches),
            clients: clients.into_iter().map(str::to_string).collect(),
        })
        .collect();
    inv.client_leaks.sort_by(|a, b| {
        b.clients
            .len()
            .cmp(&a.clients.len())
            .then(a.reaches.cmp(&b.reaches))
    });
    inv.left_out.dirs = left_out.into_iter().collect();
    inv.env = env
        .into_iter()
        .map(|(k, v)| (k, v.into_iter().collect()))
        .collect();
    inv
}

/// The reason a Next.js page under a layout that turns away whoever is not signed in
/// is unknown, not "no guard found" ([`under_guarded_layouts`]).
pub const LAYOUT_MAY_REDIRECT: &str = "layout_may_redirect";

/// The directory of a repository path ("" at the root).
fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// The App Router directory a Next.js `page` or `layout` file is in: its directory up
/// to the last `app` segment, with the file's own name (`page`, `layout`), or `None`
/// for any other file (the Pages Router has no layouts).
fn app_router_file(path: &str) -> Option<(&str, &str)> {
    let (dir, file) = path.rsplit_once('/')?;
    let stem = file.split_once('.').map_or(file, |(s, _)| s);
    // The last `app` segment, as the Next.js adapter reads the route.
    let mut end = None;
    let mut at = 0;
    for seg in dir.split('/') {
        at += seg.len();
        if seg == "app" {
            end = Some(at);
        }
        at += 1;
    }
    Some((&dir[..end?], stem))
}

/// Next.js App Router pages with no guard of their own under a layout that has one: a
/// layout that calls the auth library and redirects (or refuses) whoever is not
/// signed in. That is not proven to stop the page: a layout and its page render in
/// parallel, and a layout is not run again on a client navigation, so the page's own
/// server work may run for a caller the layout turns away (Next.js's own guidance is to
/// check in the page or its data). Such a page is never "no guard found": its guard is
/// unknown ([`EntryRow::opaque`]), named [`LAYOUT_MAY_REDIRECT`] with the nearest such
/// layout's file and line. Never known. Route handlers and server actions are not
/// under a layout: unchanged, as is a page whose layouts have no guard.
fn under_guarded_layouts(rows: &mut [EntryRow]) {
    // (package, app root, directory) -> the guarded layout's path and line.
    let layouts: BTreeMap<(String, String, String), (String, u32)> = rows
        .iter()
        .filter(|e| e.kind == "layout" && !e.guards.is_empty())
        .filter_map(|e| {
            let (root, stem) = app_router_file(&e.path)?;
            (stem == "layout").then(|| {
                (
                    (
                        e.package.clone(),
                        root.to_string(),
                        dir_of(&e.path).to_string(),
                    ),
                    (e.path.clone(), e.line),
                )
            })
        })
        .collect();
    if layouts.is_empty() {
        return;
    }
    for e in rows.iter_mut() {
        if e.kind != "page" || !e.guards.is_empty() || !e.opaque.is_empty() || e.local {
            continue;
        }
        let Some((root, "page")) = app_router_file(&e.path) else {
            continue;
        };
        // The nearest layout above the page, its own directory first, up to the
        // App Router's root.
        let mut dir = dir_of(&e.path);
        let found = loop {
            if let Some(l) = layouts.get(&(e.package.clone(), root.to_string(), dir.to_string())) {
                break Some(l);
            }
            if dir.len() <= root.len() {
                break None;
            }
            dir = dir_of(dir);
        };
        if let Some((path, line)) = found {
            e.opaque.push(format!(
                "{LAYOUT_MAY_REDIRECT}: the layout above it ({path}:{line}) turns away whoever is not signed in; Next.js does not guarantee that stops this page"
            ));
            // Not "no guard found": nothing to rest that on.
            e.basis = None;
        }
    }
}

/// One entry point a change left without a guard most of its siblings have.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct GapRegression {
    pub guard: String,
    pub kind: String,
    pub package: String,
    pub dir: String,
    pub members: usize,
    pub with_guard: usize,
    pub entry: EntryRef,
    /// A member with the guard, to copy from.
    pub example: EntryRef,
    /// The convention that says the same, when there is one ([`GuardGap::convention`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub convention: Option<GapConvention>,
}

/// What a change introduced, against the merge base's inventory: facts for a pull
/// request to review. Nothing here fails a check. Only files the diff added or changed
/// are looked at, except `now_public`, which is about the boundary moving.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Regressions {
    /// Entry points in changed files lacking a guard most of their siblings have, that
    /// did not lack it at the merge base.
    pub guard_gaps: Vec<GapRegression>,
    /// Entry points in changed files with no guard reaching a risky
    /// operation, not so at the merge base.
    pub unguarded_reaching: Vec<EntryRow>,
    /// Risky operations in changed files that were not at the merge base.
    pub sinks: Vec<SinkUse>,
    /// Client files in the change newly reaching server-only code or secrets.
    pub leaks: Vec<LeakGroup>,
    /// Entry points that were not internet-facing at the merge base and are now.
    pub now_public: Vec<EntryRef>,
    /// Entry points the change adds (in files it added or changed, of a handler the
    /// merge base did not have) that a request reaches ([`ADDED_KINDS`]) where Drift
    /// found no guard in what it read, whatever their siblings do and whatever they
    /// reach. One the map knows to be open on purpose ([`EntryRow::known_open`]) is not
    /// one, and one listed above (under `guard_gaps` or `unguarded_reaching`) is not
    /// listed again. One whose guard Drift cannot read is not one either: it is in
    /// `guard_unknown`.
    pub added_without_guard: Vec<EntryRow>,
    /// The entry points the change adds, as `added_without_guard` counts them, with
    /// no guard and something whose guard cannot be read ([`EntryRow::opaque`]): guard
    /// unknown, never a finding, listed apart. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub guard_unknown: Vec<EntryRow>,
}

/// The kinds of entry point a person's request reaches, whose lack of a sign-in check
/// a change that adds one is told ([`Regressions::added_without_guard`]). Pages and
/// layouts (public on purpose more often than not) and what a queue or a schedule
/// runs are left out.
pub const ADDED_KINDS: &[&str] = &["http", "server_action", "graphql", "rpc"];

impl Regressions {
    pub fn is_empty(&self) -> bool {
        self.guard_gaps.is_empty()
            && self.added_without_guard.is_empty()
            && self.unguarded_reaching.is_empty()
            && self.sinks.is_empty()
            && self.leaks.is_empty()
            && self.now_public.is_empty()
            && self.guard_unknown.is_empty()
    }
}

/// [`Regressions`] of `head` against `base`. `touched` says whether the diff added or
/// changed a working-tree path; `old_path` gives the path a file had at the base (a
/// rename), so a moved exception is not a new one.
pub fn regressions(
    base: &Inventory,
    head: &Inventory,
    touched: &dyn Fn(&str) -> bool,
    old_path: &dyn Fn(&str) -> String,
) -> Regressions {
    let key = |path: &str, symbol: &str| format!("{}#{symbol}", old_path(path));
    let base_key = |path: &str, symbol: &str| format!("{path}#{symbol}");
    let mut out = Regressions::default();

    let base_exceptions: BTreeSet<(String, String)> = base
        .guard_gaps
        .iter()
        .flat_map(|g| {
            g.exceptions
                .iter()
                .map(move |e| (g.guard.clone(), base_key(&e.path, &e.symbol)))
        })
        .collect();
    for g in &head.guard_gaps {
        for e in &g.exceptions {
            if !touched(&e.path) {
                continue;
            }
            if base_exceptions.contains(&(g.guard.clone(), key(&e.path, &e.symbol))) {
                continue;
            }
            out.guard_gaps.push(GapRegression {
                guard: g.guard.clone(),
                kind: g.kind.clone(),
                package: g.package.clone(),
                dir: g.dir.clone(),
                members: g.members,
                with_guard: g.with_guard,
                entry: e.clone(),
                example: g.example.clone(),
                convention: g.convention.clone(),
            });
        }
    }
    out.guard_gaps.sort();
    out.guard_gaps.dedup();

    let base_bare_reaching: BTreeSet<String> = base
        .entry_points
        .iter()
        .filter(|e| e.unguarded() && !e.reaches.is_empty())
        .map(|e| base_key(&e.path, &e.symbol))
        .collect();
    out.unguarded_reaching = head
        .entry_points
        .iter()
        .filter(|e| e.unguarded() && !e.reaches.is_empty() && touched(&e.path))
        .filter(|e| !base_bare_reaching.contains(&key(&e.path, &e.symbol)))
        .cloned()
        .collect();

    let base_sinks: BTreeSet<(String, String)> = base
        .sinks
        .iter()
        .map(|s| (s.kind.clone(), base_key(&s.path, &s.symbol)))
        .collect();
    out.sinks = head
        .sinks
        .iter()
        .filter(|s| touched(&s.path))
        .filter(|s| !base_sinks.contains(&(s.kind.clone(), key(&s.path, &s.symbol))))
        .cloned()
        .collect();

    for g in &head.client_leaks {
        let before: BTreeSet<&str> = base
            .client_leaks
            .iter()
            .filter(|b| b.reaches == g.reaches)
            .flat_map(|b| b.clients.iter().map(String::as_str))
            .collect();
        let clients: Vec<String> = g
            .clients
            .iter()
            .filter(|c| touched(c) && !before.contains(old_path(c).as_str()))
            .cloned()
            .collect();
        if !clients.is_empty() {
            out.leaks.push(LeakGroup {
                reaches: g.reaches.clone(),
                clients,
                example: g.example.clone(),
            });
        }
    }

    // Exposure is a route's: a handler mounted on two paths has one entry point each.
    // The same route at the base is compared; a route the base did not have (a new
    // mount, a renamed path) is compared with the most exposed the handler had.
    let mut base_route: BTreeMap<(String, &Option<String>), Exposure> = BTreeMap::new();
    let mut base_handler: BTreeMap<String, Exposure> = BTreeMap::new();
    for e in &base.entry_points {
        let k = base_key(&e.path, &e.symbol);
        for seen in [
            base_route
                .entry((k.clone(), &e.route))
                .or_insert(e.exposure),
            base_handler.entry(k).or_insert(e.exposure),
        ] {
            *seen = e.exposure.min(*seen);
        }
    }
    out.now_public = head
        .entry_points
        .iter()
        .filter(|e| e.exposure == Exposure::Public)
        .filter(|e| {
            let k = key(&e.path, &e.symbol);
            base_route
                .get(&(k.clone(), &e.route))
                .or_else(|| base_handler.get(&k))
                .is_some_and(|x| *x != Exposure::Public)
        })
        .map(entry_ref)
        .collect();

    // Added: no entry point of the handler at the merge base (a moved file keeps
    // its handlers, by its old path).
    let base_handlers: BTreeSet<String> = base
        .entry_points
        .iter()
        .map(|e| base_key(&e.path, &e.symbol))
        .collect();
    let listed: BTreeSet<(&str, &str, u32)> = out
        .guard_gaps
        .iter()
        .map(|g| (g.entry.path.as_str(), g.entry.symbol.as_str(), g.entry.line))
        .chain(
            out.unguarded_reaching
                .iter()
                .map(|e| (e.path.as_str(), e.symbol.as_str(), e.line)),
        )
        .collect();
    let added: Vec<EntryRow> = head
        .entry_points
        .iter()
        .filter(|e| ADDED_KINDS.contains(&e.kind.as_str()) && touched(&e.path))
        .filter(|e| {
            e.guards.is_empty()
                && !e.known_open
                && e.opens.is_empty()
                && e.verifies_signature.is_empty()
        })
        .filter(|e| !base_handlers.contains(&key(&e.path, &e.symbol)))
        .filter(|e| !listed.contains(&(e.path.as_str(), e.symbol.as_str(), e.line)))
        .cloned()
        .collect();
    // Unknown is never a finding: what could not be read may be the guard.
    let (unknown, added): (Vec<EntryRow>, Vec<EntryRow>) =
        added.into_iter().partition(|e| !e.opaque.is_empty());
    out.added_without_guard = added;
    out.guard_unknown = unknown;
    out
}

/// What is said of an entry point of [`Regressions::added_without_guard`]: that no
/// guard was found in what Drift read, or that its guard is unknown, with what may be
/// one.
fn added_has(e: &EntryRow) -> String {
    if e.opaque.is_empty() {
        e.has()
    } else {
        format!(
            "guard unknown, Drift cannot tell whether it requires sign-in (it could not read: {})",
            e.opaque.join(" > ")
        )
    }
}

/// Plain text of [`Regressions`], for a terminal or a pull request comment.
pub fn render_regressions(
    r: &Regressions,
    base: &str,
    merge_base: &str,
    files: usize,
    root: Option<&Path>,
) -> String {
    use crate::report::sanitize;
    use std::fmt::Write;
    let mut out = String::new();
    let against = format!(
        "against {}, merge base {}",
        sanitize(base, 80),
        sanitize(&merge_base[..merge_base.len().min(12)], 12)
    );
    if r.is_empty() {
        let _ = writeln!(
            out,
            "Security: this change ({files} file(s) added or changed, {against}) introduces no entry point lacking a guard its siblings share, no unguarded entry point reaching a risky operation, no new entry point where Drift found no guard, no new risky operation, no new client leak, and makes nothing internet-facing."
        );
        let _ = writeln!(
            out,
            "
{NOT_COVERED}"
        );
        return out;
    }
    let _ = writeln!(
        out,
        "Security: what this change introduces ({files} file(s) added or changed, {against}). Facts for review: nothing here fails the check."
    );
    let what = |e: &EntryRef| {
        let mut w = String::new();
        if let Some(m) = &e.method {
            w.push_str(m);
            w.push(' ');
        }
        w.push_str(e.route.as_deref().unwrap_or(&e.symbol));
        format!("{} [{}]", sanitize(&w, 120), sanitize(&e.kind, 40))
    };
    if !r.guard_gaps.is_empty() {
        let _ = writeln!(
            out,
            "
Entry points lacking a guard most of their siblings have"
        );
        for g in &r.guard_gaps {
            let place = match (g.package.as_str(), g.dir.as_str()) {
                ("", "") => "the repository".to_string(),
                (p, "") => format!("package {}", sanitize(p, 120)),
                (_, d) => format!("{}/", sanitize(d, 160)),
            };
            let have = g.entry.has();
            let _ = writeln!(
                out,
                "  {}:{} {}: {}; {} is on {} of {} {} entry points in {}",
                sanitize(&g.entry.path, 160),
                g.entry.line,
                what(&g.entry),
                sanitize(&have, 120),
                sanitize(&g.guard, 80),
                g.with_guard,
                g.members,
                sanitize(&g.kind, 40),
                place
            );
            if let Some(c) = &g.convention {
                let _ = writeln!(out, "      {}", c.note());
            }
            let _ = writeln!(
                out,
                "      to copy: {}:{} {}",
                sanitize(&g.example.path, 160),
                g.example.line,
                sanitize(&g.example.symbol, 80)
            );
            if let Some(src) = root.and_then(|r| source_line(r, &g.example.path, g.example.line)) {
                let _ = writeln!(out, "        {}", sanitize(&src, 160));
            }
        }
    }
    if !r.unguarded_reaching.is_empty() {
        let _ = writeln!(
            out,
            "
{NO_GUARD_FOUND}, reaching a risky operation"
        );
        for e in &r.unguarded_reaching {
            let kinds: Vec<&str> = e.reaches.iter().map(|x| x.kind.as_str()).collect();
            let _ = writeln!(
                out,
                "  {}:{} {}{}{}: {}",
                sanitize(&e.path, 160),
                e.line,
                what(&entry_ref(e)),
                e.basis
                    .as_ref()
                    .map(|b| crate::practices::basis::not_read_count(&b.not_read))
                    .unwrap_or_default(),
                match e.exposure_text() {
                    Some(x) => format!(" {x}"),
                    None => String::new(),
                },
                sanitize(&kinds.join(", "), 200)
            );
        }
    }
    if !r.added_without_guard.is_empty() {
        let _ = writeln!(
            out,
            "
New entry points where Drift found no guard"
        );
        for e in &r.added_without_guard {
            let _ = writeln!(
                out,
                "  {}:{} {}: {}{}",
                sanitize(&e.path, 160),
                e.line,
                what(&entry_ref(e)),
                sanitize(&added_has(e), 200),
                match e.exposure_text() {
                    Some(x) => format!("; {x}"),
                    None => String::new(),
                }
            );
        }
    }
    if !r.guard_unknown.is_empty() {
        let _ = writeln!(
            out,
            "
New entry points whose guard is unknown (Drift could not read what may be one; not findings)"
        );
        for e in &r.guard_unknown {
            let _ = writeln!(
                out,
                "  {}:{} {}: {}",
                sanitize(&e.path, 160),
                e.line,
                what(&entry_ref(e)),
                sanitize(&added_has(e), 200)
            );
        }
    }
    if !r.sinks.is_empty() {
        let _ = writeln!(
            out,
            "
Risky operations added"
        );
        for s in &r.sinks {
            let _ = writeln!(
                out,
                "  {}  {}:{} {}",
                s.kind,
                sanitize(&s.path, 160),
                s.line,
                sanitize(&s.symbol, 80)
            );
        }
    }
    if !r.leaks.is_empty() {
        let _ = writeln!(
            out,
            "
Client files newly reaching server-only code or secrets"
        );
        for l in &r.leaks {
            let _ = writeln!(
                out,
                "  {} from {}",
                sanitize(&l.reaches, 160),
                sanitize(&l.clients.join(", "), 300)
            );
        }
    }
    if !r.now_public.is_empty() {
        let _ = writeln!(
            out,
            "
Entry points now internet-facing"
        );
        for e in &r.now_public {
            let _ = writeln!(
                out,
                "  {}:{} {}{}",
                sanitize(&e.path, 160),
                e.line,
                what(e),
                if e.guards.is_empty() {
                    format!(": {}", sanitize(&e.has(), 120))
                } else {
                    String::new()
                }
            );
        }
    }
    let _ = writeln!(
        out,
        "
{NOT_COVERED}"
    );
    out
}

/// GitHub Actions annotations for [`Regressions`]: notices, since nothing fails.
pub fn github_regression_annotations(r: &Regressions) -> String {
    use crate::report::sanitize;
    use std::fmt::Write;
    let mut out = String::new();
    let esc = |s: &str| sanitize(s, 300).replace('%', "%25").replace('\n', "%0A");
    for g in &r.guard_gaps {
        let _ = writeln!(
            out,
            "::notice file={},line={},title=drift security::{} is on {} of {} {} entry points here; this one has {}. To copy: {}:{}. Facts for review; this fails nothing.",
            esc(&g.entry.path),
            g.entry.line,
            esc(&g.guard),
            g.with_guard,
            g.members,
            esc(&g.kind),
            esc(&g.entry.has()),
            esc(&g.example.path),
            g.example.line
        );
        if let Some(c) = &g.convention {
            // Added to the message's end (before its newline).
            let nl = out.pop();
            let _ = write!(out, " ({})", esc(&c.note()));
            if let Some(ch) = nl {
                out.push(ch);
            }
        }
    }
    for e in &r.unguarded_reaching {
        let kinds: Vec<&str> = e.reaches.iter().map(|x| x.kind.as_str()).collect();
        let _ = writeln!(
            out,
            "::notice file={},line={},title=drift security::Entry point where Drift found no guard in what it read{}, reaching {}{}. Facts for review; this fails nothing.",
            esc(&e.path),
            e.line,
            e.basis
                .as_ref()
                .map(|b| crate::practices::basis::not_read_count(&b.not_read))
                .unwrap_or_default(),
            esc(&kinds.join(", ")),
            match e.exposure_text() {
                Some(x) => format!("; {}", esc(&x)),
                None => String::new(),
            }
        );
    }
    // A new entry point whose guard is unknown is a notice too, said so: never a
    // finding.
    for e in r.added_without_guard.iter().chain(&r.guard_unknown) {
        let mut what = String::new();
        if let Some(m) = &e.method {
            what.push_str(m);
            what.push(' ');
        }
        what.push_str(e.route.as_deref().unwrap_or(&e.symbol));
        let _ = writeln!(
            out,
            "::notice file={},line={},title=drift security::New {} entry point {}: {}{}. Facts for review; this fails nothing.",
            esc(&e.path),
            e.line,
            esc(&e.kind),
            esc(&what),
            esc(&added_has(e)),
            match e.exposure_text() {
                Some(x) => format!("; {}", esc(&x)),
                None => String::new(),
            }
        );
    }
    for s in &r.sinks {
        let _ = writeln!(
            out,
            "::notice file={},line={},title=drift security::Risky operation added: {} in {}. Facts for review; this fails nothing.",
            esc(&s.path),
            s.line,
            esc(&s.kind),
            esc(&s.symbol)
        );
    }
    out
}

/// A job summary (Markdown) for [`Regressions`].
pub fn regressions_summary(r: &Regressions, base: &str, merge_base: &str, files: usize) -> String {
    use crate::report::sanitize;
    use std::fmt::Write;
    let mut out = String::from("## Drift security\n\n");
    let _ = writeln!(
        out,
        "What this change introduces ({files} file(s) added or changed, against `{}`, merge base `{}`). Facts for review: nothing here fails the check.\n",
        sanitize(base, 80),
        sanitize(&merge_base[..merge_base.len().min(12)], 12)
    );
    if r.is_empty() {
        out.push_str("No entry point lacking a guard its siblings share, no unguarded entry point reaching a risky operation, no new entry point where Drift found no guard, no new risky operation, no new client leak; nothing made internet-facing.\n");
    }
    if !r.guard_gaps.is_empty() {
        out.push_str("### Entry points lacking a guard most of their siblings have\n\n");
        for g in &r.guard_gaps {
            let _ = writeln!(
                out,
                "- `{}:{}` {}: `{}` is on {} of {} {} entry points here; to copy: `{}:{}`",
                sanitize(&g.entry.path, 160),
                g.entry.line,
                sanitize(g.entry.route.as_deref().unwrap_or(&g.entry.symbol), 120),
                sanitize(&g.guard, 80),
                g.with_guard,
                g.members,
                sanitize(&g.kind, 40),
                sanitize(&g.example.path, 160),
                g.example.line
            );
            if let Some(c) = &g.convention {
                let _ = writeln!(out, "  - {}", c.note().replace('`', ""));
            }
        }
        out.push('\n');
    }
    if !r.unguarded_reaching.is_empty() {
        out.push_str(&format!(
            "### {NO_GUARD_FOUND}, reaching a risky operation\n\n"
        ));
        for e in &r.unguarded_reaching {
            let kinds: Vec<&str> = e.reaches.iter().map(|x| x.kind.as_str()).collect();
            let _ = writeln!(
                out,
                "- `{}:{}` {}{}{}: {}",
                sanitize(&e.path, 160),
                e.line,
                sanitize(e.route.as_deref().unwrap_or(&e.symbol), 120),
                e.basis
                    .as_ref()
                    .map(|b| crate::practices::basis::not_read_count(&b.not_read))
                    .unwrap_or_default(),
                match e.exposure_text() {
                    Some(x) => format!(" ({x})"),
                    None => String::new(),
                },
                sanitize(&kinds.join(", "), 200)
            );
        }
        out.push('\n');
    }
    if !r.added_without_guard.is_empty() {
        out.push_str("### New entry points where Drift found no guard\n\n");
        for e in &r.added_without_guard {
            let _ = writeln!(
                out,
                "- `{}:{}` {}: {}{}",
                sanitize(&e.path, 160),
                e.line,
                sanitize(e.route.as_deref().unwrap_or(&e.symbol), 120),
                sanitize(&added_has(e), 200),
                match e.exposure_text() {
                    Some(x) => format!(" ({x})"),
                    None => String::new(),
                }
            );
        }
        out.push('\n');
    }
    if !r.guard_unknown.is_empty() {
        out.push_str("### New entry points whose guard is unknown (not findings)\n\n");
        for e in &r.guard_unknown {
            let _ = writeln!(
                out,
                "- `{}:{}` {}: {}",
                sanitize(&e.path, 160),
                e.line,
                sanitize(e.route.as_deref().unwrap_or(&e.symbol), 120),
                sanitize(&added_has(e), 200)
            );
        }
        out.push('\n');
    }
    if !r.sinks.is_empty() {
        out.push_str("### Risky operations added\n\n");
        for s in &r.sinks {
            let _ = writeln!(
                out,
                "- {} in `{}:{}` {}",
                s.kind,
                sanitize(&s.path, 160),
                s.line,
                sanitize(&s.symbol, 80)
            );
        }
        out.push('\n');
    }
    if !r.leaks.is_empty() {
        out.push_str("### Client files newly reaching server-only code or secrets\n\n");
        for l in &r.leaks {
            let _ = writeln!(
                out,
                "- `{}` from {}",
                sanitize(&l.reaches, 160),
                l.clients
                    .iter()
                    .map(|c| format!("`{}`", sanitize(c, 160)))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        out.push('\n');
    }
    if !r.now_public.is_empty() {
        out.push_str("### Entry points now internet-facing\n\n");
        for e in &r.now_public {
            let _ = writeln!(
                out,
                "- `{}:{}` {}",
                sanitize(&e.path, 160),
                e.line,
                sanitize(e.route.as_deref().unwrap_or(&e.symbol), 120)
            );
        }
        out.push('\n');
    }
    let _ = writeln!(out, "_{NOT_COVERED}_");
    out
}

fn entry_ref(e: &EntryRow) -> EntryRef {
    EntryRef {
        path: e.path.clone(),
        symbol: e.symbol.clone(),
        line: e.line,
        kind: e.kind.clone(),
        method: e.method.clone(),
        route: e.route.clone(),
        guards: e.guards.clone(),
        opens: e.opens.clone(),
        opaque: e.opaque.clone(),
        local: e.local,
        basis: e.basis.clone(),
        verifies_signature: e.verifies_signature.clone(),
    }
}

/// The roles an entry point at `path` belongs to: "" (its whole package) and every
/// directory from the package root down to its own, repo-relative.
pub(crate) fn role_dirs(package: &str, path: &str) -> Vec<String> {
    let mut dirs = vec![String::new()];
    let rel = path
        .strip_prefix(package)
        .map(|r| r.trim_start_matches('/'))
        .unwrap_or(path);
    let Some((parent, _)) = rel.rsplit_once('/') else {
        return dirs;
    };
    let mut acc = package.trim_end_matches('/').to_string();
    for seg in parent.split('/') {
        if !acc.is_empty() {
            acc.push('/');
        }
        acc.push_str(seg);
        dirs.push(acc.clone());
    }
    dirs
}

/// [`GuardGap`]s of sorted `entries`, comparing guards by name alone
/// ([`guard_gaps_with`]).
pub fn guard_gaps(entries: &[EntryRow]) -> Vec<GuardGap> {
    guard_gaps_with(entries, &|_, _, _| false)
}

/// [`GuardGap`]s of sorted `entries`. Hooks the whole app runs are not guards here:
/// every member has them by construction. Deterministic: roles are visited broadest
/// first and the output is sorted.
///
/// A member lacking the guard by name has it when `built_on(member, guard, with)`
/// says one of its own guards is built on it (`with`: the members that have it by
/// name): such a member is no exception. That only removes exceptions; the share is
/// still counted by name. A member that lacks it and has something whose guard
/// cannot be read is no exception either ([`GuardGap::unknown`]).
pub fn guard_gaps_with(
    entries: &[EntryRow],
    built_on: &dyn Fn(&EntryRow, &str, &[&EntryRow]) -> bool,
) -> Vec<GuardGap> {
    use crate::mine::MIN_ROLE_SIZE;
    let mut roles: BTreeMap<(&str, &str, String), Vec<usize>> = BTreeMap::new();
    for (i, e) in entries.iter().enumerate() {
        for d in role_dirs(&e.package, &e.path) {
            roles
                .entry((e.package.as_str(), e.kind.as_str(), d))
                .or_default()
                .push(i);
        }
    }
    let mut keys: Vec<&(&str, &str, String)> = roles.keys().collect();
    keys.sort_by_key(|k| (k.0, k.1, k.2.len(), k.2.as_str()));
    let has = |i: usize, guard: &str| entries[i].guards.iter().any(|g| g == guard);
    // Guard -> exception sets already reported, so a narrower role adds nothing it
    // has already said.
    let mut reported: BTreeMap<&str, Vec<BTreeSet<usize>>> = BTreeMap::new();
    let mut out = Vec::new();
    for key in keys {
        let members = &roles[key];
        if members.len() < MIN_ROLE_SIZE {
            continue;
        }
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for &i in members {
            let own: BTreeSet<&str> = entries[i]
                .guards
                .iter()
                .map(String::as_str)
                .filter(|g| !g.ends_with(APP_HOOK))
                .collect();
            for g in own {
                *counts.entry(g).or_default() += 1;
            }
        }
        for (guard, with_guard) in counts {
            if with_guard == members.len()
                || (with_guard as f64) < GUARD_GAP_SHARE * members.len() as f64
            {
                continue;
            }
            let with: Vec<&EntryRow> = members
                .iter()
                .copied()
                .filter(|&i| has(i, guard))
                .map(|i| &entries[i])
                .collect();
            let lacking: BTreeSet<usize> = members
                .iter()
                .copied()
                .filter(|&i| !has(i, guard))
                .filter(|&i| !built_on(&entries[i], guard, with.as_slice()))
                .collect();
            if lacking.is_empty()
                || reported
                    .get(guard)
                    .is_some_and(|sets| sets.iter().any(|s| lacking.is_subset(s)))
            {
                continue;
            }
            reported.entry(guard).or_default().push(lacking.clone());
            let Some(&example) = members.iter().find(|&&i| has(i, guard)) else {
                continue;
            };
            // Unknown is never an exception: what could not be read may be the guard.
            let (unknown, exceptions): (Vec<usize>, Vec<usize>) = lacking
                .iter()
                .copied()
                .partition(|&i| !entries[i].opaque.is_empty());
            if exceptions.is_empty() {
                continue;
            }
            out.push(GuardGap {
                package: key.0.to_string(),
                kind: key.1.to_string(),
                dir: key.2.clone(),
                guard: guard.to_string(),
                members: members.len(),
                with_guard,
                exceptions: exceptions.iter().map(|&i| entry_ref(&entries[i])).collect(),
                unknown: unknown.iter().map(|&i| entry_ref(&entries[i])).collect(),
                example: entry_ref(&entries[example]),
                convention: None,
            });
        }
    }
    out.sort();
    out
}

/// A guard's short name without what says how it is applied (` (body call)`, ` (app
/// hook)`, ...): the name of what it calls.
fn guard_name(guard: &str) -> &str {
    let mut g = guard;
    for suffix in [BODY_CALL, BODY_CHECK, MIDDLEWARE, APP_HOOK, BASE, " (settings)"] {
        g = g.strip_suffix(suffix).unwrap_or(g);
    }
    g
}

/// `own` (a reference, normalised) is built on `target`: `target` is `own`, or what
/// [`built_on`] reads `own` to rest on (the binding it derives from, what it is
/// given by reference, its wrappers and bases, what it calls one call deep) reaches
/// `target`'s definition; for a package's guard, what proves `own` a guard
/// ([`authenticating_root`], [`proving_root`]) is `target`.
fn rests_on(ctx: &crate::context::RepoContext, own: &str, target: &str) -> bool {
    if own == target {
        return true;
    }
    if external(target) {
        return authenticating_root(ctx, own).as_deref() == Some(target)
            || proving_root(ctx, own).as_deref() == Some(target);
    }
    let Some(t) = ctx.definition(target) else {
        return false;
    };
    built_on(ctx, own.to_string(), false, false, &|s| std::ptr::eq(s, t)).is_some()
}

/// [`guard_gaps_with`] for the inventory: a member has a guard when one of its own
/// guards is built on it ([`rests_on`]), the guards matched by what the members'
/// handlers reference (their wrappers and calls, and those of the functions they
/// pass by reference), never by a name alone. The epic case: a route that calls
/// `requireRecentVerification`, whose first line is `requireUserId(request)`, has
/// `requireUserId`.
fn guard_gaps_built_on(
    repo: &RepoFacts,
    cx: &crate::practices::Cx<'_>,
    entries: &[EntryRow],
) -> Vec<GuardGap> {
    let ctx = cx.context();
    // File -> handler -> what it references, normalised.
    let mut refs: BTreeMap<&str, BTreeMap<&str, BTreeSet<String>>> = BTreeMap::new();
    for f in &repo.files {
        for e in &f.entry_points {
            let Some((_, s)) = crate::entries::entry_symbol(repo, f, e) else {
                continue;
            };
            let mut bodies: Vec<&Symbol> = vec![s];
            for c in &s.calls {
                if let Some(r) = c.strip_suffix("(ref)")
                    && !external(r)
                    && let Some(d) = ctx.definition(r)
                {
                    bodies.push(d);
                }
            }
            let set = refs
                .entry(f.path.as_str())
                .or_default()
                .entry(e.symbol.as_str())
                .or_default();
            for b in bodies {
                for w in &b.wraps {
                    set.insert(crate::mine::norm_ref(unwrapped(&w.wrapper)).into_owned());
                }
                for c in &b.calls {
                    let c = c
                        .strip_suffix("(ref)")
                        .or_else(|| c.strip_suffix("(new)"))
                        .unwrap_or(c);
                    set.insert(crate::mine::norm_ref(c).into_owned());
                }
            }
        }
    }
    // The references of a member's handler that a guard of this name names.
    let named = |e: &EntryRow, name: &str| -> Vec<String> {
        refs.get(e.path.as_str())
            .and_then(|m| m.get(e.symbol.as_str()))
            .into_iter()
            .flatten()
            .filter(|r| short(r) == name)
            .cloned()
            .collect()
    };
    guard_gaps_with(entries, &|e, guard, with| {
        let targets: BTreeSet<String> = with
            .iter()
            .flat_map(|w| named(*w, guard_name(guard)))
            .collect();
        !targets.is_empty()
            && e.guards
                .iter()
                .filter(|g| !g.ends_with(APP_HOOK))
                .flat_map(|g| named(e, guard_name(g)))
                .any(|own| targets.iter().any(|t| rests_on(ctx, &own, t)))
    })
}

/// Exceptions listed per guard gap in text output; the rest are counted.
const GAP_EXCEPTIONS: usize = 10;

/// Unguarded entry points listed in text output; the rest are counted (`--json`
/// has them all).
const UNGUARDED_ROWS: usize = 50;

/// Plain-text report. `only` limits entry points, sinks and leaks to those files.
/// Repository names are sanitised: they are data, not instructions.
pub fn render(inv: &Inventory, only: Option<&BTreeSet<String>>, max_rows: usize) -> String {
    render_at(inv, only, max_rows, None)
}

/// The line `line` (1-based) of `rel` under `root`, trimmed, when it can be read.
pub fn source_line(root: &Path, rel: &str, line: u32) -> Option<String> {
    let text = std::fs::read_to_string(root.join(rel)).ok()?;
    let l = text.lines().nth(line.checked_sub(1)? as usize)?.trim();
    (!l.is_empty()).then(|| l.to_string())
}

/// [`render`], and with `root` the source line of each member to copy from, so the
/// shape to follow is in the report itself.
pub fn render_at(
    inv: &Inventory,
    only: Option<&BTreeSet<String>>,
    max_rows: usize,
    root: Option<&Path>,
) -> String {
    use crate::report::sanitize;
    use std::fmt::Write;
    let keep = |p: &str| only.is_none_or(|o| o.contains(p));
    let mut out = String::new();
    let entries: Vec<&EntryRow> = inv.entry_points.iter().filter(|e| keep(&e.path)).collect();
    let sinks: Vec<&SinkUse> = inv.sinks.iter().filter(|s| keep(&s.path)).collect();
    let leaks: Vec<&LeakGroup> = inv
        .client_leaks
        .iter()
        .filter(|l| l.clients.iter().any(|c| keep(c)))
        .collect();
    let leaking_clients: BTreeSet<&str> = leaks
        .iter()
        .flat_map(|l| l.clients.iter().map(String::as_str))
        .filter(|c| keep(c))
        .collect();
    let reaching = entries.iter().filter(|e| !e.reaches.is_empty()).count();
    let unguarded = entries.iter().filter(|e| e.unguarded()).count();
    let opaque = entries
        .iter()
        .filter(|e| e.guards.is_empty() && !e.opaque.is_empty())
        .count();
    let signed: Vec<&&EntryRow> = entries
        .iter()
        .filter(|e| e.guards.is_empty() && e.opaque.is_empty() && !e.verifies_signature.is_empty())
        .collect();
    // Local entry points are not counted as unguarded; the headline says how many
    // were left out of that count, of which kinds, and why.
    let local: Vec<&&EntryRow> = entries.iter().filter(|e| e.local_without_guard()).collect();
    let local_kinds: BTreeSet<&str> = local.iter().map(|e| e.kind.as_str()).collect();
    let _ = writeln!(
        out,
        "{} entry points ({} where Drift found no guard in what it read{}{}, {} reaching a risky operation), {} risky operations, {} client file(s) reaching server-only code or secrets, {} env vars read",
        entries.len(),
        unguarded,
        {
            let mut s = String::new();
            if opaque > 0 {
                s.push_str(&format!(", {opaque} whose guard cannot be read"));
            }
            if !signed.is_empty() {
                s.push_str(&format!(
                    ", {} that verify a webhook signature (no sign-in by design)",
                    signed.len()
                ));
            }
            s
        },
        {
            let mut notes = String::new();
            if !local.is_empty() {
                notes.push_str(&format!(
                    ", {} {} not counted: {LOCAL_NOTE}",
                    local.len(),
                    local_kinds.into_iter().collect::<Vec<_>>().join("/")
                ));
            }
            let queue_fed = entries.iter().filter(|e| e.queue_without_guard()).count();
            if queue_fed > 0 {
                notes.push_str(&format!(
                    ", {queue_fed} {} not counted: {QUEUE_NOTE}",
                    QUEUE_KINDS.join("/")
                ));
            }
            notes
        },
        reaching,
        sinks.len(),
        leaking_clients.len(),
        inv.env.len()
    );
    if inv.left_out.files > 0 {
        let shown: Vec<String> = inv
            .left_out
            .dirs
            .iter()
            .take(3)
            .map(|d| sanitize(d, 80))
            .collect();
        let more = if inv.left_out.dirs.len() > 3 {
            ", ..."
        } else {
            ""
        };
        let _ = writeln!(
            out,
            "{} files in non-production paths ({}{more}) left out",
            inv.left_out.files,
            shown.join(", ")
        );
    }
    let unchecked: Vec<&String> = inv.unchecked.iter().filter(|p| keep(p)).collect();
    if !unchecked.is_empty() {
        let shown: Vec<String> = unchecked.iter().take(5).map(|p| sanitize(p, 160)).collect();
        let _ = writeln!(
            out,
            "{} file(s) NOT CHECKED: no stack large enough to parse them could be reserved (a memory limit on this run), so what they hold (entry points, risky operations, env reads, client leaks through them) is unknown: {}{}",
            unchecked.len(),
            shown.join(", "),
            if unchecked.len() > 5 { ", ..." } else { "" }
        );
    }
    let skipped: Vec<&drift_core::Skipped> = inv.skipped.iter().filter(|s| keep(&s.path)).collect();
    if !skipped.is_empty() {
        let shown: Vec<String> = skipped
            .iter()
            .take(5)
            .map(|s| {
                format!(
                    "{} ({})",
                    sanitize(&s.path, 160),
                    serde_json::to_value(s.reason)
                        .ok()
                        .and_then(|v| v.as_str().map(|r| r.replace('_', " ")))
                        .unwrap_or_default()
                )
            })
            .collect();
        let _ = writeln!(
            out,
            "{} source file(s) NOT READ, so an entry point or a risky operation in one is not listed: {}{}",
            skipped.len(),
            shown.join(", "),
            if skipped.len() > 5 { ", ..." } else { "" }
        );
    }
    let unlisted: Vec<&Unlisted> = inv.unlisted.iter().filter(|u| keep(&u.path)).collect();
    if !unlisted.is_empty() {
        let shown: Vec<String> = unlisted
            .iter()
            .take(5)
            .map(|u| match u.symbol.is_empty() {
                true => format!("{}:{}", sanitize(&u.path, 160), u.line),
                false => format!(
                    "{}:{} {}",
                    sanitize(&u.path, 160),
                    u.line,
                    sanitize(&u.symbol, 60)
                ),
            })
            .collect();
        let _ = writeln!(
            out,
            "{} place(s) that look served are NOT LISTED (a registration written as a route is, or a function that reads a request and answers it and that no listed entry point reaches): what serves them was not read, so a route there is in no row below: {}{}",
            unlisted.len(),
            shown.join(", "),
            if unlisted.len() > 5 { ", ..." } else { "" }
        );
    }
    let app_only = entries.iter().filter(|e| e.only_app_hooks()).count();
    if app_only > 0 {
        let _ = writeln!(
            out,
            "{app_only} entry points are guarded only by hooks the whole app runs (marked \"(app hook)\")"
        );
    }
    let known = entries
        .iter()
        .filter(|e| e.exposure != Exposure::Unknown)
        .count();
    if known > 0 {
        let count = |x: Exposure| entries.iter().filter(|e| e.exposure == x).count();
        let _ = writeln!(
            out,
            "Exposure: {} internet-facing, {} internal in what Drift read, {} unknown (from {})",
            count(Exposure::Public),
            count(Exposure::Internal),
            count(Exposure::Unknown),
            {
                let has = |prefix: &str| {
                    inv.boundaries
                        .rules
                        .iter()
                        .any(|r| r.source.starts_with(prefix))
                };
                [
                    (has("config"), ".drift/config.yaml"),
                    (has("compose"), "compose files"),
                    (entries.iter().any(|e| e.tied), "Terraform ties"),
                ]
                .into_iter()
                .filter(|(present, _)| *present)
                .map(|(_, name)| name)
                .collect::<Vec<_>>()
                .join(" and ")
            }
        );
        // Counted apart: a verdict that rests on a person's tie.
        let tied = |x: Exposure| entries.iter().filter(|e| e.tied && e.exposure == x).count();
        if entries.iter().any(|e| e.tied) {
            let _ = writeln!(
                out,
                "  of which {} internet-facing, {} internal and {} unknown rest on a Terraform tie (security.terraform in {}): the listener rules are read, what else Terraform opens to the code is not, nor whether another published application relays to it",
                tied(Exposure::Public),
                tied(Exposure::Internal),
                tied(Exposure::Unknown),
                crate::policy::CONFIG_FILE
            );
        }
    }
    for w in inv.boundaries.warnings.iter().chain(&inv.warnings) {
        let _ = writeln!(out, "{}", sanitize(w, 240));
    }
    let gap_count = inv
        .guard_gaps
        .iter()
        .filter(|g| only.is_none_or(|o| g.exceptions.iter().any(|e| o.contains(&e.path))))
        .count();
    if gap_count > 0 {
        let _ = writeln!(
            out,
            "{gap_count} guard(s) shared by at least {}% of the entry points of a kind have exceptions (listed below)",
            (GUARD_GAP_SHARE * 100.0).round() as u32
        );
    }
    if !sinks.is_empty() {
        let mut by_kind: BTreeMap<&str, Vec<&SinkUse>> = BTreeMap::new();
        for s in &sinks {
            by_kind.entry(&s.kind).or_default().push(s);
        }
        let _ = writeln!(out, "\nRisky operations");
        for (k, uses) in by_kind {
            let _ = writeln!(out, "  {k} ({})", uses.len());
            for u in uses.iter().take(max_rows) {
                let _ = writeln!(
                    out,
                    "    {}:{} {}{}",
                    sanitize(&u.path, 160),
                    u.line,
                    sanitize(&u.symbol, 80),
                    if u.fed { FED } else { "" }
                );
            }
            if uses.len() > max_rows {
                let _ = writeln!(out, "    ... {} more", uses.len() - max_rows);
            }
        }
    }
    let mut risky: Vec<&&EntryRow> = entries.iter().filter(|e| !e.reaches.is_empty()).collect();
    // What most needs a person's eye first: an entry point where no guard was found
    // before one whose guard is not read and one that has a guard, one an outside
    // caller reaches before one that is internal, and one that reaches an operation
    // fed by what the request sent before one that does not. Within a rank, the
    // order they are listed in.
    risky.sort_by_key(|e| review_rank(e));
    if !risky.is_empty() {
        let _ = writeln!(out, "\nEntry points reaching risky operations");
        for e in risky.iter().take(max_rows) {
            let what = [e.method.as_deref(), e.route.as_deref()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
            let mut guards = e.has();
            if !e.wrappers.is_empty() {
                guards.push_str(&format!("; wrappers: {}", e.wrappers.join(" > ")));
            }
            if !e.authenticates.is_empty() {
                guards.push_str(&format!(
                    "; {}",
                    crate::practices::basis::identified(&e.authenticates)
                ));
            }
            if !e.opens.is_empty() {
                guards.push_str(&format!("; open: {}", e.opens.join(", ")));
            }
            if let Some(x) = e.exposure_text() {
                guards.push_str(&format!("; {x}"));
            }
            let _ = writeln!(
                out,
                "  {}:{} {} [{}] {} | {}{}",
                sanitize(&e.path, 160),
                e.line,
                sanitize(&e.symbol, 80),
                e.kind,
                sanitize(&what, 120),
                sanitize(&guards, 120),
                if e.validates { ", validates input" } else { "" }
            );
            for r in &e.reaches {
                let via = r
                    .via
                    .iter()
                    .skip(1)
                    .map(|v| sanitize(v, 120))
                    .collect::<Vec<_>>();
                let _ = writeln!(
                    out,
                    "      {}{}{}",
                    r.kind,
                    if r.fed { FED } else { "" },
                    if via.is_empty() {
                        String::new()
                    } else {
                        format!(" via {}", via.join(" -> "))
                    }
                );
            }
        }
        if risky.len() > max_rows {
            let _ = writeln!(out, "  ... {} more", risky.len() - max_rows);
        }
    }
    let gaps: Vec<&GuardGap> = inv
        .guard_gaps
        .iter()
        .filter(|g| only.is_none_or(|o| g.exceptions.iter().any(|e| o.contains(&e.path))))
        .collect();
    if !gaps.is_empty() {
        let _ = writeln!(
            out,
            "\nGuards most entry points of a kind share, and the exceptions"
        );
        for g in gaps.iter().take(max_rows) {
            let place = match (g.package.as_str(), g.dir.as_str()) {
                ("", "") => "the repository".to_string(),
                (p, "") => format!("package {}", sanitize(p, 120)),
                (_, d) => format!("{}/", sanitize(d, 160)),
            };
            let _ = writeln!(
                out,
                "  {}: {} of {} {} entry points in {} have it; {} do not",
                sanitize(&g.guard, 80),
                g.with_guard,
                g.members,
                sanitize(&g.kind, 40),
                place,
                g.exceptions.len()
            );
            if let Some(c) = &g.convention {
                let _ = writeln!(out, "      {}", c.note());
            }
            for e in g.exceptions.iter().take(GAP_EXCEPTIONS) {
                let what = match &e.method {
                    Some(m) => format!("{} {}", e.kind, m),
                    None => e.kind.clone(),
                };
                let mut have = e.has();
                if !e.opens.is_empty() {
                    have.push_str(&format!("; open: {}", e.opens.join(", ")));
                }
                let _ = writeln!(
                    out,
                    "      {} {}  {}:{}  {}",
                    sanitize(&what, 40),
                    sanitize(e.route.as_deref().unwrap_or(&e.symbol), 160),
                    sanitize(&e.path, 160),
                    e.line,
                    sanitize(&have, 120)
                );
            }
            if g.exceptions.len() > GAP_EXCEPTIONS {
                let _ = writeln!(
                    out,
                    "      ... and {} more (use --json)",
                    g.exceptions.len() - GAP_EXCEPTIONS
                );
            }
            if !g.unknown.is_empty() {
                let _ = writeln!(
                    out,
                    "      guard unknown, not exceptions ({}): {}",
                    g.unknown.len(),
                    sanitize(
                        &g.unknown
                            .iter()
                            .map(|e| format!("{}:{}", e.path, e.line))
                            .collect::<Vec<_>>()
                            .join(", "),
                        400
                    )
                );
            }
            let _ = writeln!(
                out,
                "      to copy: {}:{} {}",
                sanitize(&g.example.path, 160),
                g.example.line,
                sanitize(&g.example.symbol, 80)
            );
            if let Some(src) = root.and_then(|r| source_line(r, &g.example.path, g.example.line)) {
                let _ = writeln!(out, "        {}", sanitize(&src, 160));
            }
        }
        if gaps.len() > max_rows {
            let _ = writeln!(out, "  ... {} more", gaps.len() - max_rows);
        }
    }
    let scope_gaps: Vec<&ScopeGap> = inv
        .scope_gaps
        .iter()
        .filter(|g| only.is_none_or(|o| g.exceptions.iter().any(|e| o.contains(&e.path))))
        .collect();
    let workflows: Vec<&crate::workflows::WorkflowFinding> = inv
        .workflows
        .iter()
        .filter(|w| only.is_none_or(|o| o.contains(&w.path)))
        .collect();
    if !workflows.is_empty() {
        let _ = writeln!(out, "\nCI workflows that run what an outsider wrote");
        for w in workflows.iter().take(max_rows) {
            let what = match w.kind.as_str() {
                "untrusted_checkout" => {
                    "checks out the pull request's code where the repository's secrets are"
                }
                "unpinned_action" => {
                    "runs another owner's action by a name its owner can move, where it holds secrets or may write"
                }
                "piped_download" => "hands a download to an interpreter",
                _ => "interpolates text of the event into a shell step",
            };
            let _ = writeln!(
                out,
                "  {}:{}  job {} {what}: {}",
                sanitize(&w.path, 160),
                w.line,
                sanitize(&w.job, 80),
                sanitize(&w.detail, 120)
            );
        }
        if workflows.len() > max_rows {
            let _ = writeln!(out, "  ... and {} more", workflows.len() - max_rows);
        }
    }
    let dependencies: Vec<&crate::dependencies::DependencyFinding> = inv
        .dependencies
        .iter()
        .filter(|d| only.is_none_or(|o| o.contains(&d.path)))
        .collect();
    if !dependencies.is_empty() {
        let _ = writeln!(out, "\nDependencies installed from a source nothing fixes");
        for d in dependencies.iter().take(max_rows) {
            let what = match d.kind.as_str() {
                "mutable_git" => {
                    "is a repository named by a branch, a tag or nothing, and no lockfile records its commit"
                }
                "unpinned_url" => "is an archive at a URL, with no digest",
                "plain_http" => "is fetched over plain HTTP or with the certificate check off",
                "second_index" => {
                    "adds a second package index: a name meant for one can be answered by the other"
                }
                _ => "hands a download to an interpreter",
            };
            let name = match d.name.is_empty() {
                true => String::new(),
                false => format!("{} ", sanitize(&d.name, 80)),
            };
            let _ = writeln!(
                out,
                "  {}:{}  {name}{what}: {}",
                sanitize(&d.path, 160),
                d.line,
                sanitize(&d.detail, 120)
            );
        }
        if dependencies.len() > max_rows {
            let _ = writeln!(out, "  ... and {} more", dependencies.len() - max_rows);
        }
    }
    let cluster: Vec<&crate::kubernetes::ClusterFinding> = inv
        .cluster
        .iter()
        .filter(|c| only.is_none_or(|o| o.contains(&c.path)))
        .collect();
    if !cluster.is_empty() {
        let _ = writeln!(out, "\nWhat the Kubernetes manifests open");
        for c in cluster.iter().take(max_rows) {
            let what = match c.kind.as_str() {
                "ingress" => "routes requests from outside the cluster",
                "public_service" => "has an address outside the cluster",
                "host_access" => "is given the node it runs on",
                "secret_value" => "is a Secret whose values are written in the file",
                _ => "is a role over everything, or bound to callers with no credential",
            };
            let _ = writeln!(
                out,
                "  {}:{}  {} {what}: {}",
                sanitize(&c.path, 160),
                c.line,
                sanitize(&c.object, 100),
                sanitize(&c.detail, 200)
            );
        }
        if cluster.len() > max_rows {
            let _ = writeln!(out, "  ... and {} more", cluster.len() - max_rows);
        }
    }
    let whole_rows: Vec<&crate::whole_rows::WholeRow> = inv
        .whole_rows
        .iter()
        .filter(|w| only.is_none_or(|o| o.contains(&w.path)))
        .collect();
    if !whole_rows.is_empty() {
        let _ = writeln!(
            out,
            "\nRows sent back whole where other code withholds a field of them"
        );
        for w in whole_rows.iter().take(max_rows) {
            let more = match w.withheld_count.saturating_sub(w.withheld_at.len()) {
                0 => String::new(),
                n => format!(" and {n} more"),
            };
            let _ = writeln!(
                out,
                "  {}:{}  {} sends {} rows whole (from {}); withheld elsewhere: {} (by {}{more})",
                sanitize(&w.path, 160),
                w.line,
                sanitize(&w.symbol, 100),
                sanitize(&w.rows, 160),
                sanitize(&w.from, 120),
                sanitize(&w.fields.join(", "), 160),
                sanitize(&w.withheld_at.join(", "), 240)
            );
        }
        if whole_rows.len() > max_rows {
            let _ = writeln!(out, "  ... and {} more", whole_rows.len() - max_rows);
        }
    }
    if !scope_gaps.is_empty() {
        let _ = writeln!(
            out,
            "\nWhat most entry points filter by a value of the caller, and the ones that do not"
        );
        for g in scope_gaps.iter().take(max_rows) {
            let _ = writeln!(
                out,
                "  {} by {}: {} of {} entry points that query it give it the caller's own value; {} give it none",
                sanitize(&g.resource, 160),
                sanitize(&g.key, 80),
                g.scoped,
                g.members,
                g.exceptions.len()
            );
            for e in g.exceptions.iter().take(GAP_EXCEPTIONS) {
                let what = [e.method.as_deref(), e.route.as_deref()]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ");
                let _ = writeln!(
                    out,
                    "      {} {}  {}:{}",
                    e.kind,
                    sanitize(&what, 120),
                    sanitize(&e.path, 160),
                    e.line
                );
            }
            if g.exceptions.len() > GAP_EXCEPTIONS {
                let _ = writeln!(
                    out,
                    "      ... {} more",
                    g.exceptions.len() - GAP_EXCEPTIONS
                );
            }
            if !g.unknown.is_empty() {
                let _ = writeln!(
                    out,
                    "      filter not read, not exceptions ({}): {}",
                    g.unknown.len(),
                    sanitize(
                        &g.unknown
                            .iter()
                            .map(|e| format!("{}:{}", e.path, e.line))
                            .collect::<Vec<_>>()
                            .join(", "),
                        400
                    )
                );
            }
            let _ = writeln!(
                out,
                "      to copy: {}:{} {}",
                sanitize(&g.example.path, 160),
                g.example.line,
                sanitize(&g.example.symbol, 80)
            );
        }
        if scope_gaps.len() > max_rows {
            let _ = writeln!(out, "  ... {} more", scope_gaps.len() - max_rows);
        }
    }
    // Entry points with no guard, then those whose guard cannot be read.
    for opaque_rows in [false, true] {
        let (title, keep_row) = if opaque_rows {
            (
                "Entry points whose guard cannot be read (opaque wrappers, unproven body calls)",
                (|e: &EntryRow| e.guards.is_empty() && !e.opaque.is_empty())
                    as fn(&EntryRow) -> bool,
            )
        } else {
            (NO_GUARD_FOUND, EntryRow::unguarded as fn(&EntryRow) -> bool)
        };
        let mut bare: Vec<&&EntryRow> = entries.iter().filter(|e| keep_row(e)).collect();
        if bare.is_empty() {
            continue;
        }
        // Sorted here, not trusted from the inventory: the listing must not
        // depend on scan order.
        // Internet-facing first where the boundary is known, then by path.
        bare.sort_by(|a, b| {
            (a.exposure, &a.path, a.line, &a.symbol, &a.kind)
                .cmp(&(b.exposure, &b.path, b.line, &b.symbol, &b.kind))
        });
        let _ = writeln!(out, "\n{title}");
        for e in bare.iter().take(UNGUARDED_ROWS) {
            let what = match &e.method {
                Some(m) => format!("{} {}", e.kind, m),
                None => e.kind.clone(),
            };
            let where_ = match e.exposure_text() {
                Some(x) => format!("  {x}"),
                None => String::new(),
            };
            let mut wraps = String::new();
            // What "no guard found" rests on: how much was seen and not read.
            if let Some(b) = e.basis.as_ref().filter(|b| !b.not_read.is_empty()) {
                wraps.push_str(&format!("  {} not read", b.not_read.len()));
            }
            if !e.authenticates.is_empty() {
                wraps.push_str(&format!(
                    "  {}",
                    sanitize(&crate::practices::basis::identified(&e.authenticates), 160)
                ));
            }
            if !e.opaque.is_empty() {
                wraps.push_str(&format!(
                    "  opaque: {}",
                    sanitize(&e.opaque.join(" > "), 160)
                ));
            }
            if !e.wrappers.is_empty() {
                wraps.push_str(&format!(
                    "  wrappers: {}",
                    sanitize(&e.wrappers.join(" > "), 160)
                ));
            }
            let _ = writeln!(
                out,
                "  {} {}  {}:{}{where_}{wraps}",
                sanitize(&what, 40),
                sanitize(e.route.as_deref().unwrap_or(&e.symbol), 160),
                sanitize(&e.path, 160),
                e.line
            );
        }
        if bare.len() > UNGUARDED_ROWS {
            let _ = writeln!(
                out,
                "  ... and {} more (use --json)",
                bare.len() - UNGUARDED_ROWS
            );
        }
    }
    // Webhooks the sending service is checked by: listed apart, never as unguarded.
    if !signed.is_empty() {
        let mut signed = signed;
        signed.sort_by(|a, b| {
            (a.exposure, &a.path, a.line, &a.symbol, &a.kind)
                .cmp(&(b.exposure, &b.path, b.line, &b.symbol, &b.kind))
        });
        let _ = writeln!(out, "\n{VERIFIES_SIGNATURE_HEADING}");
        for e in signed.iter().take(UNGUARDED_ROWS) {
            let what = match &e.method {
                Some(m) => format!("{} {}", e.kind, m),
                None => e.kind.clone(),
            };
            let where_ = match e.exposure_text() {
                Some(x) => format!("  {x}"),
                None => String::new(),
            };
            let _ = writeln!(
                out,
                "  {} {}  {}:{}{where_}  {}",
                sanitize(&what, 40),
                sanitize(e.route.as_deref().unwrap_or(&e.symbol), 160),
                sanitize(&e.path, 160),
                e.line,
                signature_words(&e.verifies_signature)
            );
        }
        if signed.len() > UNGUARDED_ROWS {
            let _ = writeln!(
                out,
                "  ... and {} more (use --json)",
                signed.len() - UNGUARDED_ROWS
            );
        }
    }
    if !leaks.is_empty() {
        let _ = writeln!(out, "\nClient code reaching server-only code or secrets");
        for l in leaks.iter().take(max_rows) {
            let n = l.clients.iter().filter(|c| keep(c)).count();
            let _ = writeln!(
                out,
                "  {} from {} client file{}",
                sanitize(&l.reaches, 160),
                n,
                if n == 1 { "" } else { "s" }
            );
            let _ = writeln!(
                out,
                "      e.g. {}",
                l.example
                    .iter()
                    .map(|x| sanitize(x, 120))
                    .collect::<Vec<_>>()
                    .join(" -> ")
            );
        }
        if leaks.len() > max_rows {
            let _ = writeln!(out, "  ... {} more", leaks.len() - max_rows);
        }
    }
    if only.is_none() && !inv.env.is_empty() {
        let _ = writeln!(out, "\nEnvironment variables (files reading each)");
        let mut vars: Vec<(&String, &Vec<String>)> = inv.env.iter().collect();
        vars.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(b.0)));
        for (k, files) in vars.iter().take(max_rows) {
            let _ = writeln!(out, "  {} ({})", sanitize(k, 120), files.len());
        }
        if vars.len() > max_rows {
            let _ = writeln!(out, "  ... {} more", vars.len() - max_rows);
        }
    }
    let _ = writeln!(out, "\n{NOT_COVERED}");
    out
}

/// What the inventory does not see, printed at the end of every report so the
/// listing is never read as a clean bill.
pub const NOT_COVERED: &str = "Not covered: checks inside handler bodies other than sign-in checks (a 401, a sign-in redirect, a call of a proven guard), whether the caller may act on the record it asks for, rate limits, and anything applied outside this repository (gateways, proxies, platform settings). A shared guard is what this repository does, not a verdict on its exceptions.";

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::{EntryPoint, Wrap};

    /// A decorator given to `method_decorator` for a method the linker does not read
    /// is named by what it wraps, without the wrapper's stray parenthesis (review 5,
    /// finding 6).
    #[test]
    fn a_method_decorator_of_an_unread_method_is_named_by_what_it_wraps() {
        let w = "unresolved:method_decorator(pkg:django#contrib.auth.decorators.login_required)";
        assert_eq!(short(w), "contrib.auth.decorators.login_required");
        assert_eq!(
            unwrapped(w),
            "pkg:django#contrib.auth.decorators.login_required"
        );
        assert_eq!(unwrapped("unresolved:x"), "unresolved:x");
        assert_eq!(short("app/auth.py#require_user"), "require_user");
    }

    /// The App Router root is the last `app` segment, as the Next.js adapter reads a
    /// route; `apps/` and `myapp/` are no such segment.
    #[test]
    fn an_app_router_file_is_under_the_last_app_segment() {
        assert_eq!(
            app_router_file("web/app/dashboard/page.tsx"),
            Some(("web/app", "page"))
        );
        assert_eq!(app_router_file("app/layout.tsx"), Some(("app", "layout")));
        assert_eq!(
            app_router_file("apps/web/src/app/(signed)/a/page.js"),
            Some(("apps/web/src/app", "page"))
        );
        assert_eq!(
            app_router_file("app/x/app/y/page.tsx"),
            Some(("app/x/app", "page"))
        );
        assert_eq!(app_router_file("apps/myapp/pages/index.tsx"), None);
        assert_eq!(app_router_file("page.tsx"), None);
    }

    #[test]
    fn compose_services_set_the_boundary_and_config_wins() {
        let mut b = Boundaries::default();
        b.read_compose(
            "compose.yaml",
            "services:\n  web:\n    build: ./frontend\n    ports: [\"3000:3000\"]\n  api:\n    build:\n      context: backend/services/api\n  worker:\n    build: ./backend/services/worker/\n    ports: []\n  db:\n    image: postgres\n    ports: [\"5432:5432\"]\n  bad:\n    build: ../outside\n",
        );
        b.rules.sort();
        assert_eq!(
            b.rules,
            [
                BoundaryRule {
                    dir: "backend/services/api".into(),
                    exposure: Exposure::Internal,
                    source: "compose service api in compose.yaml publishes no ports".into(),
                },
                BoundaryRule {
                    dir: "backend/services/worker".into(),
                    exposure: Exposure::Internal,
                    source: "compose service worker in compose.yaml publishes no ports".into(),
                },
                BoundaryRule {
                    dir: "frontend".into(),
                    exposure: Exposure::Public,
                    source: "compose service web in compose.yaml publishes ports".into(),
                },
            ]
        );
        // The longest directory wins; a path outside every rule is unknown.
        assert_eq!(
            b.of("backend/services/api/app/routes.py"),
            (
                Exposure::Internal,
                Some("compose service api in compose.yaml publishes no ports")
            )
        );
        assert_eq!(b.of("frontend/app/api/x/route.ts").0, Exposure::Public);
        assert_eq!(b.of("scripts/x.py"), (Exposure::Unknown, None));
        // A person's word beats compose for the same directory, whatever the order.
        b.set(
            "frontend",
            Exposure::Internal,
            "config security.internal".into(),
            true,
        );
        b.set(
            "frontend",
            Exposure::Public,
            "compose service web publishes ports".into(),
            false,
        );
        assert_eq!(b.of("frontend/x.ts").0, Exposure::Internal);
        // Unparseable YAML is a warning, not an error.
        b.read_compose("docker-compose.yml", "services: [\n");
        assert_eq!(b.warnings.len(), 1, "{:?}", b.warnings);
        assert!(b.warnings[0].starts_with("docker-compose.yml: not parsed"));
    }

    #[test]
    fn compose_files_at_any_depth_build_relative_to_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let put = |rel: &str, body: &str| {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        };
        put(
            "docker-compose.yml",
            "services:\n  web:\n    build: ./web\n    ports: [\"80:80\"]\n",
        );
        put(
            "deploy/compose.yaml",
            "services:\n  api:\n    build:\n      context: ../services/api\n  gone:\n    build: ../../outside\n  self:\n    build: .\n    ports: [\"1:1\"]\n",
        );
        put(
            "a/b/c/d/e/compose.yml",
            "services:\n  deep:\n    build: src\n",
        );
        // Too deep, in node_modules, in a hidden directory: not read.
        put(
            "a/b/c/d/e/f/compose.yml",
            "services:\n  deeper:\n    build: .\n",
        );
        put(
            "node_modules/pkg/compose.yml",
            "services:\n  dep:\n    build: .\n",
        );
        put(
            ".devcontainer/compose.yml",
            "services:\n  dev:\n    build: .\n",
        );
        assert_eq!(
            compose_files(root),
            [
                "a/b/c/d/e/compose.yml",
                "deploy/compose.yaml",
                "docker-compose.yml"
            ]
        );
        let b = Boundaries::load(root);
        let rules: Vec<(&str, Exposure, &str)> = b
            .rules
            .iter()
            .map(|r| (r.dir.as_str(), r.exposure, r.source.as_str()))
            .collect();
        assert_eq!(
            rules,
            [
                (
                    "a/b/c/d/e/src",
                    Exposure::Internal,
                    "compose service deep in a/b/c/d/e/compose.yml publishes no ports"
                ),
                (
                    "deploy",
                    Exposure::Public,
                    "compose service self in deploy/compose.yaml publishes ports"
                ),
                (
                    "services/api",
                    Exposure::Internal,
                    "compose service api in deploy/compose.yaml publishes no ports"
                ),
                (
                    "web",
                    Exposure::Public,
                    "compose service web in docker-compose.yml publishes ports"
                ),
            ]
        );
        assert!(b.warnings.is_empty(), "{:?}", b.warnings);
    }

    /// Services that build from one context are keyed by their own Dockerfile's
    /// directory and their own ports; services that still share code and disagree make
    /// no rule. Behind a gateway that publishes ports, a service it routes to (a traefik
    /// label, a `proxy_pass` in its mounted configuration) is internet-facing and any
    /// other is unknown, not internal.
    #[test]
    fn compose_exposure_is_keyed_by_service_and_gateway() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let put = |rel: &str, body: &str| {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        };
        put(
            "deploy/compose.yaml",
            "services:\n  web:\n    build:\n      context: ..\n      dockerfile: apps/web/Dockerfile\n    ports: [\"80:80\"]\n  worker:\n    build:\n      context: ..\n      dockerfile: apps/worker/Dockerfile\n  a:\n    build:\n      context: ..\n      dockerfile: Dockerfile\n    ports: [\"1:1\"]\n  b:\n    build:\n      context: ..\n      dockerfile: Dockerfile\n",
        );
        put(
            "edge/compose.yaml",
            "services:\n  proxy:\n    image: nginx:1.27\n    ports: [\"443:443\"]\n    volumes:\n      - ./nginx.conf:/etc/nginx/nginx.conf:ro\n  api:\n    build: ../services/api\n  admin:\n    build: ../services/admin\n    labels:\n      traefik.enable: \"true\"\n  jobs:\n    build: ../services/jobs\n",
        );
        put(
            "edge/nginx.conf",
            "server {\n  location / { proxy_pass http://api:8000; }\n  location /jobs-ui { proxy_pass http://jobsui; }\n}\n",
        );
        let b = Boundaries::load(root);
        let rules: Vec<(&str, Exposure)> = b
            .rules
            .iter()
            .map(|r| (r.dir.as_str(), r.exposure))
            .collect();
        assert_eq!(
            rules,
            [
                ("apps/web", Exposure::Public),
                ("apps/worker", Exposure::Internal),
                ("services/admin", Exposure::Public),
                ("services/api", Exposure::Public),
                ("services/jobs", Exposure::Unknown),
            ],
            "{:#?}",
            b.rules
        );
        // a and b share the repository root and disagree: no repo-wide rule.
        assert_eq!(b.of("README.md"), (Exposure::Unknown, None));
        assert_eq!(
            b.of("services/api/main.py").1,
            Some("compose service api in edge/compose.yaml is routed by gateway proxy")
        );
    }

    /// What may give a gateway configuration that is not in the files read is said, and
    /// then nothing behind it is internal: an image that is not the stock one, an
    /// `entrypoint`, a mount from outside the repository, a directory with more below
    /// it. A directory stands for the `.conf` files directly in it, and a file that is
    /// not configuration (a certificate) is left alone.
    #[test]
    fn what_may_configure_a_gateway_beyond_the_files_read_is_said() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let put = |rel: &str, body: &str| {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        };
        let compose = |gateway: &str| {
            format!(
                "services:\n  edge:\n{gateway}    ports: [\"80:80\"]\n    links: [\"api:backend\"]\n  api:\n    build: ./api\n  jobs:\n    build: ./jobs\n"
            )
        };
        put(
            "conf.d/a.conf",
            "server { location /api/ { proxy_pass http://backend:8000; } }\n",
        );
        put("conf.d/b.conf", "upstream unused { server jobs:1; }\n");
        // What the routed service starts with is read too.
        put(
            "api/Dockerfile",
            "FROM python:3.12\nCMD [\"uvicorn\", \"x:app\"]\n",
        );
        put("api/x.py", "app = None\n");
        put("conf.d/notes.txt", "not configuration {\n");
        put("certs/site.pem", "-----BEGIN CERTIFICATE-----\n");
        let load = |gateway: &str| {
            put("compose.yaml", &compose(gateway));
            let b = Boundaries::load(root);
            (b.of("api/x.py").0, b.of("jobs/x.py").0, b.warnings)
        };
        // All read: the directory's two files, the `links` alias, the certificate left alone.
        let stock = "    image: nginx:1.27-alpine\n    volumes:\n      - ./conf.d:/etc/nginx/conf.d:ro\n      - ./certs/site.pem:/etc/nginx/certs/site.pem:ro\n";
        assert_eq!(load(stock), (Exposure::Public, Exposure::Internal, vec![]));
        let said = |gateway: &str| {
            let (api, jobs, warnings) = load(gateway);
            assert_eq!(
                (api, jobs),
                (Exposure::Public, Exposure::Unknown),
                "{gateway}"
            );
            assert_eq!(warnings.len(), 1, "{warnings:?}");
            warnings[0]
                .split(": so what gateway")
                .next()
                .unwrap()
                .to_string()
        };
        assert_eq!(
            said(&stock.replace("nginx:1.27-alpine", "registry.example.com/edge/nginx:7")),
            "gateway edge: what the image registry.example.com/edge/nginx:7 holds is not read"
        );
        assert_eq!(
            said(&format!(
                "{stock}    entrypoint: [\"/docker-entrypoint.d/render.sh\"]\n"
            )),
            "gateway edge: what its `entrypoint` does is not read"
        );
        assert_eq!(
            said(&format!("{stock}      - generated:/etc/nginx/templates\n")),
            "gateway edge: /etc/nginx/templates, mounted from outside the repository is not read"
        );
        put("conf.d/extra/more.conf", "server {}\n");
        assert_eq!(
            said(stock),
            "gateway edge: what conf.d holds beyond the first 20 files directly in it is not read"
        );
    }

    /// A service on the host's network is not internal for publishing no ports.
    #[test]
    fn a_service_on_the_host_network_is_not_internal() {
        let mut b = Boundaries::default();
        b.read_compose(
            "compose.yaml",
            "services:\n  api:\n    build: ./api\n    network_mode: host\n  worker:\n    build: ./worker\n    network_mode: bridge\n",
        );
        assert_eq!(
            b.of("api/main.py"),
            (
                Exposure::Unknown,
                Some(
                    "compose service api in compose.yaml publishes no ports and sets network_mode host: the compose network is not the only way to it"
                )
            )
        );
        assert_eq!(b.of("worker/main.py").0, Exposure::Internal);
    }

    /// Behind an nginx gateway that is read, a service is reached under every name
    /// compose gives it; a host that is no service routes to none, and an address may
    /// be any. A second compose file that puts the same code behind a gateway that is
    /// not read speaks for the directory as a whole: no route of it is then internal.
    #[test]
    fn a_read_gateway_decides_routes_unless_another_file_speaks_for_the_whole() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let put = |rel: &str, body: &str| {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        };
        let compose = |conf: &str| {
            format!(
                "services:\n  edge:\n    image: nginx:1.27\n    ports: [\"80:80\"]\n    volumes: [\"./{conf}:/etc/nginx/conf.d/default.conf:ro\"]\n  api:\n    build: ./api\n    container_name: backend\n  jobs:\n    build: ./jobs\n    networks:\n      inner:\n        aliases: [runner]\n  mail:\n    build: ./mail\n  host:\n    build: ./host\n    network_mode: host\n"
            )
        };
        put("compose.yaml", &compose("nginx.conf"));
        for svc in ["api", "jobs", "mail", "host"] {
            put(
                &format!("{svc}/Dockerfile"),
                "FROM python:3.12\nWORKDIR /app\nCOPY . .\nCMD [\"uvicorn\", \"main:app\"]\n",
            );
            put(&format!("{svc}/main.py"), "app = None\n");
        }
        put(
            "nginx.conf",
            "upstream workers { server runner:9000; }\nserver {\n  location /api/ { proxy_pass http://backend:8000; }\n  location /jobs/ { proxy_pass http://workers; }\n  location /mail/ { proxy_pass http://app-mail-1:25; }\n  location /out/ { proxy_pass http://127.0.0.1:8025; }\n}\n",
        );
        let row = |path: &str, route: &str| EntryRow {
            path: path.into(),
            package: String::new(),
            symbol: route.into(),
            line: 1,
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(route.into()),
            guards: vec![],
            wrappers: vec![],
            opaque: vec![],
            authenticates: vec![],
            opens: vec![],
            validates: false,
            reaches: vec![],
            reads: vec![],
            local: false,
            descriptions: Vec::new(),
            tied: false,
            basis: None,
            exposure_basis: None,
            known_open: false,
            verifies_signature: Vec::new(),
            exposure: Exposure::Unknown,
            boundary: None,
        };
        let exposed = |b: &Boundaries| -> Vec<(String, Exposure)> {
            let mut rows = vec![
                row("api/main.py", "/api/users"),
                row("api/main.py", "/internal/users"),
                row("jobs/main.py", "/jobs/run"),
                row("jobs/main.py", "/internal/run"),
                row("mail/main.py", "/mail/send"),
                row("mail/main.py", "/out/send"),
                row("host/main.py", "/anything"),
            ];
            for r in &mut rows {
                let (exposure, source) = b.of(&r.path);
                (r.exposure, r.boundary) = (exposure, source.map(String::from));
            }
            b.expose(&mut rows, &["fastapi"; 7]);
            rows.into_iter()
                .map(|r| (r.route.unwrap(), r.exposure))
                .collect()
        };
        let b = Boundaries::load(root);
        assert!(b.warnings.is_empty(), "{:?}", b.warnings);
        assert_eq!(b.of("mail/main.py").0, Exposure::Public);
        assert_eq!(
            exposed(&b),
            [
                ("/api/users".to_string(), Exposure::Public),
                ("/internal/users".to_string(), Exposure::Internal),
                ("/jobs/run".to_string(), Exposure::Public),
                ("/internal/run".to_string(), Exposure::Internal),
                ("/mail/send".to_string(), Exposure::Public),
                // To the gateway itself: it does not send it to the service.
                ("/out/send".to_string(), Exposure::Internal),
                // On the host's network: the gateway is not the only way in.
                ("/anything".to_string(), Exposure::Unknown),
            ]
        );
        assert_eq!(
            b.of("host/main.py"),
            (
                Exposure::Unknown,
                Some(
                    "compose service host in compose.yaml publishes no ports and sets network_mode host: the compose network is not the only way to it"
                )
            )
        );

        // An address may be any service, and so may a name that is no service of the
        // file: nothing is internal where its location reaches.
        for host in ["10.0.0.7:8000", "mailer.example.com", "backend-blue:8000"] {
            put(
                "nginx.conf",
                &format!(
                    "server {{\n  location /api/ {{ proxy_pass http://backend:8000; }}\n  location /internal/ {{ proxy_pass http://{host}; }}\n}}\n"
                ),
            );
            let b = Boundaries::load(root);
            assert_eq!(
                b.warnings,
                [
                    "nginx.conf:3: `proxy_pass` names a host Drift cannot resolve (a variable, an address): so what gateway edge routes is not all known, and a route it does not match is unknown, not internal"
                ],
                "{host}"
            );
            let got = exposed(&b);
            assert_eq!(got[0], ("/api/users".to_string(), Exposure::Public));
            for (route, exposure) in &got[1..] {
                assert_eq!(*exposure, Exposure::Unknown, "{host} {route}");
            }
        }
        // A service by its name with the network's, or with a dot at the end.
        for host in [
            "backend.app_default:8000",
            "api.:8000",
            "API.app_default.:8000",
        ] {
            put(
                "nginx.conf",
                &format!("server {{\n  location /internal/ {{ proxy_pass http://{host}; }}\n}}\n"),
            );
            let b = Boundaries::load(root);
            assert!(b.warnings.is_empty(), "{host}: {:?}", b.warnings);
            assert_eq!(
                exposed(&b)[1],
                ("/internal/users".to_string(), Exposure::Public),
                "{host}"
            );
        }

        // The same code behind a traefik gateway in another file: the whole directory.
        put(
            "nginx.conf",
            "server {\n  location /api/ { proxy_pass http://backend:8000; }\n}\n",
        );
        assert_eq!(exposed(&Boundaries::load(root))[1].1, Exposure::Internal);
        put(
            "deploy/compose.yaml",
            "services:\n  edge:\n    image: traefik:v3\n    ports: [\"443:443\"]\n  api:\n    build: ../api\n    labels:\n      traefik.http.routers.api.rule: PathPrefix(`/`)\n",
        );
        let b = Boundaries::load(root);
        assert_eq!(
            exposed(&b)[1],
            ("/internal/users".to_string(), Exposure::Public)
        );
        // Both files say the service is routed: the rule keeps the first.
        assert_eq!(
            b.of("api/main.py").1,
            Some("compose service api in compose.yaml is routed by gateway edge")
        );
    }

    /// A monorepo's compose file under `platform/apps/`, every service built from the
    /// repository root (`context: ../..`) with its own Dockerfile: the Dockerfile's
    /// directory is the service's. The gateway runs an image (no build): nothing. A
    /// service with no Dockerfile directory below the root applies to nothing, with a
    /// warning, so one service never speaks for the whole repository.
    #[test]
    fn compose_services_built_from_the_root_are_located_by_their_dockerfile() {
        let mut b = Boundaries::default();
        b.read_compose(
            "platform/apps/docker-compose.yml",
            "services:\n  gateway:\n    image: nginx\n    ports: [\"8080:80\"]\n  ledger-svc:\n    build:\n      context: ../..\n      dockerfile: platform/apps/ledger-svc/Dockerfile\n  keys-svc:\n    build:\n      context: ./keys-svc\n    ports: [\"8001:8001\"]\n  runner:\n    build:\n      context: ../..\n",
        );
        b.rules.sort();
        assert_eq!(
            b.rules,
            [
                BoundaryRule {
                    dir: "platform/apps/keys-svc".into(),
                    exposure: Exposure::Public,
                    source: "compose service keys-svc in platform/apps/docker-compose.yml publishes ports".into(),
                },
                BoundaryRule {
                    dir: "platform/apps/ledger-svc".into(),
                    exposure: Exposure::Internal,
                    source: "compose service ledger-svc in platform/apps/docker-compose.yml publishes no ports".into(),
                },
            ]
        );
        assert_eq!(b.warnings.len(), 1, "{:?}", b.warnings);
        assert!(
            b.warnings[0].starts_with(
                "platform/apps/docker-compose.yml: service runner builds from the repository root"
            ),
            "{:?}",
            b.warnings
        );
        // The frontend is in no service: unknown, not internal.
        assert_eq!(
            b.of("frontend/app/api/x/route.ts"),
            (Exposure::Unknown, None)
        );
        assert_eq!(
            b.of("platform/apps/ledger-svc/app/api/v2/folders.py").0,
            Exposure::Internal
        );
        // Two services built from one directory, one publishing ports (a web service
        // and its queue consumer): internet-facing, named by the one that publishes,
        // whichever is listed first, with no warning.
        for text in [
            "services:\n  a:\n    build: ./svc\n    ports: [\"1:1\"]\n  b:\n    build: ./svc\n",
            "services:\n  a:\n    build: ./svc\n  b:\n    build: ./svc\n    ports: [\"1:1\"]\n",
        ] {
            let mut b = Boundaries::default();
            b.read_compose("compose.yaml", text);
            let (exposure, source) = b.of("svc/app/main.py");
            assert_eq!(exposure, Exposure::Public, "{text}");
            assert!(source.unwrap().ends_with("publishes ports"), "{source:?}");
            assert!(b.warnings.is_empty(), "{:?}", b.warnings);
        }
        // A person's config still beats both.
        let mut b = Boundaries::default();
        b.set(
            "svc",
            Exposure::Internal,
            "config security.internal".into(),
            true,
        );
        b.read_compose(
            "compose.yaml",
            "services:\n  a:\n    build: ./svc\n  b:\n    build: ./svc\n    ports: [\"1:1\"]\n",
        );
        assert_eq!(b.of("svc/app/main.py").0, Exposure::Internal);
    }

    /// A compose file nested in the repository, a service built from an ancestor that
    /// is not the root (`context: ..`) with no Dockerfile directory below it: that
    /// ancestor holds the compose file's other services too, so it is not applied.
    /// Built from the compose file's own directory, or below it, is unchanged.
    #[test]
    fn a_service_built_from_above_its_compose_file_speaks_for_nothing() {
        let mut b = Boundaries::default();
        b.read_compose(
            "platform/deploy/compose.yaml",
            "services:\n  wide:\n    build:\n      context: ..\n    ports: [\"80:80\"]\n  web:\n    build:\n      context: ..\n      dockerfile: web/Dockerfile\n    ports: [\"81:81\"]\n  self:\n    build: .\n  api:\n    build: ./api\n",
        );
        b.rules.sort();
        let dirs: Vec<(&str, Exposure)> = b
            .rules
            .iter()
            .map(|r| (r.dir.as_str(), r.exposure))
            .collect();
        assert_eq!(
            dirs,
            [
                ("platform/deploy", Exposure::Internal),
                ("platform/deploy/api", Exposure::Internal),
                ("platform/web", Exposure::Public),
            ]
        );
        assert_eq!(b.of("platform/worker/main.py"), (Exposure::Unknown, None));
        assert_eq!(
            b.warnings,
            [
                "platform/deploy/compose.yaml: service wide builds from `platform`, above the compose file, and its Dockerfile names no directory below it, so where its code is cannot be told; its exposure is not applied"
            ]
        );
    }

    #[test]
    fn exposure_is_shown_with_unguarded_entry_points_internet_facing_first() {
        let row = |path: &str, exposure: Exposure, boundary: Option<&str>| EntryRow {
            path: path.into(),
            package: String::new(),
            symbol: "GET".into(),
            line: 1,
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(format!("/{path}")),
            guards: vec![],
            wrappers: vec![],
            opaque: vec![],
            authenticates: vec![],
            opens: vec![],
            validates: false,
            reaches: vec![],
            reads: vec![],
            local: false,
            descriptions: Vec::new(),
            tied: false,
            basis: None,
            exposure_basis: None,
            known_open: false,
            verifies_signature: Vec::new(),
            exposure,
            boundary: boundary.map(String::from),
        };
        let inv = Inventory {
            entry_points: vec![
                row(
                    "a",
                    Exposure::Internal,
                    Some("compose service api publishes no ports"),
                ),
                row("b", Exposure::Unknown, None),
                row("c", Exposure::Public, Some("config security.public")),
            ],
            boundaries: Boundaries {
                rules: vec![
                    BoundaryRule {
                        dir: "a".into(),
                        exposure: Exposure::Internal,
                        source: "compose service api publishes no ports".into(),
                    },
                    BoundaryRule {
                        dir: "c".into(),
                        exposure: Exposure::Public,
                        source: "config security.public".into(),
                    },
                ],
                ..Default::default()
            },
            ..Default::default()
        };
        let text = render(&inv, None, 20);
        assert!(
            text.contains(
                "Exposure: 1 internet-facing, 1 internal in what Drift read, 1 unknown (from .drift/config.yaml and compose files)\n"
            ),
            "{text}"
        );
        let section = &text[text.find(&format!("\n{NO_GUARD_FOUND}")).unwrap()..];
        let rows: Vec<&str> = section.lines().skip(2).take(3).collect();
        assert_eq!(
            rows,
            [
                "  http GET /c  c:1  internet-facing (config security.public)",
                "  http GET /b  b:1",
                "  http GET /a  a:1  internal in what Drift read (compose service api publishes no ports)",
            ]
        );
    }

    fn sym(name: &str, calls: &[&str], sinks: &[&str]) -> Symbol {
        Symbol {
            name: name.into(),
            exported_as: vec![name.into()],
            calls: calls.iter().map(|s| s.to_string()).collect(),
            sinks: sinks.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn sinks_are_followed_through_internal_calls() {
        let mut route = FileFacts {
            path: "app/api/x/route.ts".into(),
            symbols: vec![sym("GET", &["lib/a.ts#load"], &[])],
            entry_points: vec![EntryPoint {
                symbol: "GET".into(),
                kind: "http".into(),
                method: Some("GET".into()),
                route: Some("/api/x".into()),
                adapter: "nextjs".into(),
            }],
            ..Default::default()
        };
        route.symbols[0].wraps.push(Wrap {
            wrapper: "lib/auth.ts#withAuth".into(),
            kind: WrapKind::Call,
        });
        let a = FileFacts {
            path: "lib/a.ts".into(),
            symbols: vec![sym("load", &["lib/b.ts#db.run"], &[])],
            ..Default::default()
        };
        let b = FileFacts {
            path: "lib/b.ts".into(),
            symbols: vec![sym("db", &[], &["raw_sql"])],
            ..Default::default()
        };
        // The wrapper is a guard by what its body does, never by its name: one the
        // facts do not define would be "guard unknown".
        let mut with_auth = sym("withAuth", &[], &[]);
        with_auth.kind = drift_core::SymbolKind::Function;
        with_auth
            .controls
            .push(drift_core::controls::REJECTS_CALLER.to_string());
        let auth = FileFacts {
            path: "lib/auth.ts".into(),
            symbols: vec![with_auth],
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![route, a, b, auth],
            ..Default::default()
        };
        let inv = inventory(&repo);
        let e = &inv.entry_points[0];
        assert_eq!(e.guards, ["withAuth"]);
        assert_eq!(e.reaches.len(), 1);
        assert_eq!(e.reaches[0].kind, "raw_sql");
        assert_eq!(
            e.reaches[0].via,
            ["app/api/x/route.ts#GET", "lib/a.ts#load", "lib/b.ts#db"]
        );
        assert_eq!(inv.sinks.len(), 1);
        assert_eq!(inv.unguarded().count(), 0);
    }

    #[test]
    fn guards_from_settings_are_guards_with_their_source() {
        let mut view = FileFacts {
            path: "blog/views.py".into(),
            symbols: vec![sym("PostViewSet", &[], &[])],
            entry_points: vec![EntryPoint {
                symbol: "PostViewSet".into(),
                kind: "http".into(),
                method: Some("ANY".into()),
                route: Some("/api/posts".into()),
                adapter: "drf".into(),
            }],
            ..Default::default()
        };
        view.symbols[0].wraps = vec![
            Wrap {
                wrapper: "pkg:rest_framework#permissions.IsAuthenticated".into(),
                kind: WrapKind::Config,
            },
            Wrap {
                wrapper: "pkg:rest_framework#authentication.TokenAuthentication".into(),
                kind: WrapKind::ConfigAuthenticates,
            },
            Wrap {
                wrapper: "pkg:rest_framework#viewsets.ModelViewSet".into(),
                kind: WrapKind::Extends,
            },
        ];
        let repo = RepoFacts {
            files: vec![view],
            ..Default::default()
        };
        let inv = inventory(&repo);
        assert_eq!(
            inv.entry_points[0].guards,
            ["permissions.IsAuthenticated (settings)"]
        );
        assert_eq!(
            inv.entry_points[0].authenticates,
            ["authentication.TokenAuthentication (settings)"]
        );
        assert_eq!(inv.unguarded().count(), 0);
    }

    /// Nest guards are read through the classes `@UseGuards` and `APP_GUARD` name
    /// (`decorator_args`), as Nest runs them:
    /// - a class whose definition rejects a caller, or whose `canActivate` calls something
    ///   (its result may be false: `Boolean(header)`, acme's shape), is a guard;
    /// - one whose `canActivate` calls nothing (`return true`) is a wrapper;
    /// - one the facts do not define, `UseGuards` with no class recorded, and a decorator
    ///   built on `UseGuards` are opaque: never a guard, never "no guard";
    /// - a global guard is not counted on a route with a `SetMetadata` decorator.
    #[test]
    fn nest_guard_classes_are_read_from_decorator_args() {
        let use_guards = Wrap {
            wrapper: "pkg:@nestjs/common#UseGuards".into(),
            kind: WrapKind::Decorator,
        };
        let entry = |symbol: &str| EntryPoint {
            symbol: symbol.into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(format!("/{symbol}")),
            adapter: "nestjs".into(),
        };
        let handler = |name: &str, guards: &[&str], extra: Option<&str>| {
            let mut s = sym(name, &[], &[]);
            s.wraps = vec![use_guards.clone()];
            if let Some(d) = extra {
                s.wraps = vec![Wrap {
                    wrapper: d.into(),
                    kind: WrapKind::Decorator,
                }];
            }
            s.decorator_args = guards
                .iter()
                .map(|g| format!("pkg:@nestjs/common#UseGuards={g}"))
                .collect();
            s
        };
        let controller = FileFacts {
            path: "src/items.controller.ts".into(),
            symbols: vec![
                handler("jwt", &["src/guards.ts#JwtGuard"], None),
                handler("header", &["src/guards.ts#HeaderGuard"], None),
                handler("always", &["src/guards.ts#AlwaysGuard"], None),
                handler("ghost", &["src/missing.ts#GhostGuard"], None),
                handler("bare", &[], None),
                handler("composed", &[], Some("src/auth.ts#RequireAuth")),
                handler(
                    "delivered",
                    &["src/guards.ts#JwtGuard"],
                    Some("src/auth.ts#RequireAuth"),
                ),
                handler("open", &[], Some("src/public.ts#Public")),
            ],
            entry_points: [
                "jwt",
                "header",
                "always",
                "ghost",
                "bare",
                "composed",
                "delivered",
                "open",
            ]
            .into_iter()
            .map(entry)
            .collect(),
            ..Default::default()
        };
        let mut jwt = sym("JwtGuard", &[], &[]);
        jwt.controls = vec![drift_core::controls::REJECTS_CALLER.into()];
        // acme: `canActivate(ctx) { return Boolean(ctx...headers.authorization); }`
        let mut header = sym("HeaderGuard", &["pkg:@nestjs/common#Injectable"], &[]);
        header.members = vec![drift_core::Member {
            name: "canActivate".into(),
            calls: vec!["global#Boolean".into()],
            ..Default::default()
        }];
        // twenty's PublicEndpointGuard: `canActivate() { return true; }`
        let mut always = sym("AlwaysGuard", &["pkg:@nestjs/common#Injectable"], &[]);
        // Guards are classes: a value that is none is not read as one.
        for class in [&mut jwt, &mut header, &mut always] {
            class.kind = drift_core::SymbolKind::Class;
        }
        let guards = FileFacts {
            path: "src/guards.ts".into(),
            symbols: vec![jwt, header, always],
            ..Default::default()
        };
        let auth = FileFacts {
            path: "src/auth.ts".into(),
            symbols: vec![sym(
                "RequireAuth",
                &[
                    "pkg:@nestjs/common#applyDecorators",
                    "pkg:@nestjs/common#UseGuards",
                ],
                &[],
            )],
            ..Default::default()
        };
        let public = FileFacts {
            path: "src/public.ts".into(),
            symbols: vec![sym("Public", &["pkg:@nestjs/common#SetMetadata"], &[])],
            ..Default::default()
        };
        let mut module = sym("AppModule", &[], &[]);
        module.decorator_args = vec!["APP_GUARD=src/guards.ts#JwtGuard".into()];
        let app = FileFacts {
            path: "src/app.module.ts".into(),
            symbols: vec![module],
            ..Default::default()
        };
        let base = vec![controller, guards, auth, public];
        let inv = inventory(&RepoFacts {
            files: base.clone(),
            ..Default::default()
        });
        let row = |inv: &Inventory, s: &str| {
            let e = inv.entry_points.iter().find(|e| e.symbol == s).unwrap();
            (e.guards.clone(), e.wrappers.clone(), e.opaque.clone())
        };
        let v = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(row(&inv, "jwt"), (v(&["JwtGuard"]), v(&[]), v(&[])));
        assert_eq!(row(&inv, "header"), (v(&["HeaderGuard"]), v(&[]), v(&[])));
        assert_eq!(row(&inv, "always"), (v(&[]), v(&["AlwaysGuard"]), v(&[])));
        assert_eq!(row(&inv, "ghost"), (v(&[]), v(&[]), v(&["GhostGuard"])));
        assert_eq!(row(&inv, "bare"), (v(&[]), v(&[]), v(&["UseGuards"])));
        assert_eq!(row(&inv, "composed"), (v(&[]), v(&[]), v(&["RequireAuth"])));
        // The class a composed decorator delivers decides; the decorator is no wrapper.
        assert_eq!(row(&inv, "delivered"), (v(&["JwtGuard"]), v(&[]), v(&[])));
        // Opaque is not "no guard"; a wrapper that rejects no one is.
        let unguarded: Vec<&str> = inv.unguarded().map(|e| e.symbol.as_str()).collect();
        assert_eq!(unguarded, ["always", "open"]);
        let text = render(&inv, None, 20);
        assert!(
            text.contains("8 entry points (2 where Drift found no guard in what it read, 3 whose guard cannot be read, "),
            "{text}"
        );
        assert!(
            text.contains(
                "\nEntry points whose guard cannot be read (opaque wrappers, unproven body calls)\n"
            ),
            "{text}"
        );
        // A global guard covers the routes that declare nothing public.
        let mut files = base;
        files.push(app);
        let inv = inventory(&RepoFacts {
            files,
            ..Default::default()
        });
        assert_eq!(row(&inv, "bare").0, ["JwtGuard (app hook)"]);
        assert_eq!(row(&inv, "always").0, ["JwtGuard (app hook)"]);
        assert!(row(&inv, "open").0.is_empty(), "{:?}", row(&inv, "open"));
    }

    /// An argless `throw new UnauthorizedException()` (or `ForbiddenException`) is a
    /// rejection for `authenticates` and `callee_proves_guard`: the thrown class is named
    /// for one (`throws`, read through `grant::rejection_class`), with or without a
    /// `rejects_caller` control. `HttpException` with a 401/403 status carries that
    /// control. Mining reads the same `authenticates`, unchanged.
    #[test]
    fn nest_exceptions_thrown_without_arguments_reject() {
        let thrower = |name: &str, thrown: &str, controls: &[&str]| {
            let mut s = sym(name, &[&format!("{thrown}(new)")], &[]);
            s.throws = vec![thrown.into()];
            s.controls = controls.iter().map(|c| c.to_string()).collect();
            s
        };
        let file = FileFacts {
            path: "src/auth.ts".into(),
            symbols: vec![
                thrower(
                    "requireUser",
                    "pkg:@nestjs/common#UnauthorizedException",
                    &["throw"],
                ),
                thrower(
                    "requireAdmin",
                    "pkg:@nestjs/common#ForbiddenException",
                    &["throw"],
                ),
                thrower(
                    "requireStatus",
                    "pkg:@nestjs/common#HttpException",
                    &["rejects_caller", "throw"],
                ),
                thrower("failLoudly", "pkg:@nestjs/common#HttpException", &["throw"]),
            ],
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![file],
            ..Default::default()
        };
        let ctx = crate::context::RepoContext::new(&repo, &[]);
        for f in ["requireUser", "requireAdmin", "requireStatus"] {
            let r = format!("src/auth.ts#{f}");
            assert!(authenticates(&ctx, &r), "{f}");
            assert!(callee_proves_guard(&ctx, &r), "{f}");
        }
        // An HttpException with no rejecting status turns no caller away.
        assert!(!authenticates(&ctx, "src/auth.ts#failLoudly"));
    }

    /// `Depends(auth_dependency())`: the factory's returned callable is recorded as a
    /// reference call (`<ref>(ref)`, Python facts); `authenticates` follows it, so the
    /// dependency stays a guard. A returned callable that cannot be resolved
    /// (`unresolved:<expr>(ref)`) is opaque, never no guard.
    #[test]
    fn a_dependency_factory_is_read_through_what_it_returns() {
        let route = |name: &str, dep: &str| {
            let mut s = sym(name, &[], &[]);
            s.wraps = vec![Wrap {
                wrapper: dep.into(),
                kind: WrapKind::Call,
            }];
            s
        };
        let entry = |symbol: &str| EntryPoint {
            symbol: symbol.into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(format!("/{symbol}")),
            adapter: "fastapi".into(),
        };
        let api = FileFacts {
            path: "app/api/items.py".into(),
            lang: "py".into(),
            symbols: vec![
                route("listed", "app/auth.py#auth_dependency"),
                route("dynamic", "app/auth.py#dynamic_dependency"),
            ],
            entry_points: vec![entry("listed"), entry("dynamic")],
            ..Default::default()
        };
        let mut verify = sym("_verify", &["pkg:fastapi#HTTPException"], &[]);
        verify.controls = vec![drift_core::controls::REJECTS_CALLER.into()];
        let auth = FileFacts {
            path: "app/auth.py".into(),
            lang: "py".into(),
            symbols: vec![
                verify,
                sym("auth_dependency", &["app/auth.py#_verify(ref)"], &[]),
                sym("dynamic_dependency", &["unresolved:make_check(ref)"], &[]),
            ],
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![api, auth],
            ..Default::default()
        };
        let ctx = crate::context::RepoContext::new(&repo, &[]);
        assert!(authenticates(&ctx, "app/auth.py#auth_dependency"));
        let inv = inventory(&repo);
        let row = |n: &str| inv.entry_points.iter().find(|e| e.symbol == n).unwrap();
        assert_eq!(row("listed").guards, ["auth_dependency"]);
        assert!(row("dynamic").guards.is_empty());
        assert_eq!(row("dynamic").opaque, ["dynamic_dependency"]);
        assert_eq!(inv.unguarded().count(), 0);
    }

    /// A dependency that answers "not signed in" in the `except` handler of the
    /// token's verification ([`drift_core::controls::HANDLER_REJECTS`]) is a guard to
    /// `drift security` and the practice map, and one that only may
    /// ([`drift_core::controls::HANDLER_MAY_REJECT`]) is opaque. Mining's context
    /// reads neither: what it takes for a guard is what the measured build took.
    #[test]
    fn a_guard_that_rejects_in_a_handler_is_read_by_the_inventory_and_not_by_mining() {
        let route = |name: &str, dep: &str| {
            let mut s = sym(name, &[], &[]);
            s.wraps = vec![Wrap {
                wrapper: dep.into(),
                kind: WrapKind::Call,
            }];
            s
        };
        let entry = |symbol: &str| EntryPoint {
            symbol: symbol.into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(format!("/{symbol}")),
            adapter: "fastapi".into(),
        };
        let api = FileFacts {
            path: "app/api/items.py".into(),
            lang: "py".into(),
            symbols: vec![
                route("proven", "app/auth.py#current_principal"),
                route("through", "app/auth.py#get_tenant"),
                route("maybe", "app/auth.py#for_writes"),
            ],
            entry_points: vec![entry("proven"), entry("through"), entry("maybe")],
            ..Default::default()
        };
        let mut principal = sym("current_principal", &["pkg:jose#jwt.decode"], &[]);
        principal.controls = vec![drift_core::controls::HANDLER_REJECTS.into()];
        let mut for_writes = sym("for_writes", &["pkg:jose#jwt.decode"], &[]);
        for_writes.controls = vec![drift_core::controls::HANDLER_MAY_REJECT.into()];
        let auth = FileFacts {
            path: "app/auth.py".into(),
            lang: "py".into(),
            symbols: vec![
                principal,
                for_writes,
                sym("get_tenant", &["app/auth.py#current_principal"], &[]),
            ],
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![api, auth],
            ..Default::default()
        };
        let mining = crate::context::RepoContext::new(&repo, &[]);
        let listing = crate::context::RepoContext::new(&repo, &[]).reading_since_measured();
        for dep in ["app/auth.py#current_principal", "app/auth.py#get_tenant"] {
            assert!(authenticates(&listing, dep), "{dep}");
            assert!(!authenticates(&mining, dep), "{dep}");
        }
        assert!(may_authenticate(&listing, "app/auth.py#for_writes"));
        assert!(!authenticates(&listing, "app/auth.py#for_writes"));
        assert!(!may_authenticate(&mining, "app/auth.py#for_writes"));
        let inv = inventory(&repo);
        let row = |n: &str| inv.entry_points.iter().find(|e| e.symbol == n).unwrap();
        assert_eq!(row("proven").guards, ["current_principal"]);
        assert_eq!(row("through").guards, ["get_tenant"]);
        assert!(row("maybe").guards.is_empty());
        assert_eq!(row("maybe").opaque, ["for_writes"]);
        assert_eq!(inv.unguarded().count(), 0);
    }

    /// A dependency that refuses some callers and lets a request through that passed
    /// no refusal ([`drift_core::controls::REJECTS_SOME`]: `if not authorization:
    /// return None` before the 401), and one that calls its guard for some requests
    /// only, prove no guard to `drift security` and the practice map: "guard cannot
    /// be read", never a guard and never none. Mining reads the refusal as the
    /// measured build did: a guard, by [`drift_core::controls::REJECTS_CALLER`] and
    /// by any call one call deep.
    #[test]
    fn a_refusal_not_every_request_passes_is_no_proof_to_the_inventory_and_one_to_mining() {
        use drift_core::controls::{REFUSES_ALL, REJECTS_CALLER, REJECTS_SOME};
        let route = |name: &str, dep: &str| {
            let mut s = sym(name, &[], &[]);
            s.wraps = vec![Wrap {
                wrapper: dep.into(),
                kind: WrapKind::Call,
            }];
            s
        };
        let entry = |symbol: &str| EntryPoint {
            symbol: symbol.into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(format!("/{symbol}")),
            adapter: "fastapi".into(),
        };
        let deps = [
            "strict",
            "partial",
            "after_return",
            "under_branch",
            "by_helper",
            "by_helper_nested",
        ];
        let api = FileFacts {
            path: "app/api/items.py".into(),
            lang: "py".into(),
            symbols: deps
                .iter()
                .map(|d| route(d, &format!("app/auth.py#{d}")))
                .collect(),
            entry_points: deps.iter().map(|d| entry(d)).collect(),
            ..Default::default()
        };
        let with = |name: &str, calls: &[&str], controls: &[&str], conditional: &[&str]| {
            let mut s = sym(name, calls, &[]);
            s.controls = controls.iter().map(|c| c.to_string()).collect();
            s.conditional_calls = conditional.iter().map(|c| c.to_string()).collect();
            s
        };
        let auth = FileFacts {
            path: "app/auth.py".into(),
            lang: "py".into(),
            symbols: vec![
                with("strict", &[], &[REJECTS_CALLER], &[]),
                with("partial", &[], &[REJECTS_CALLER, REJECTS_SOME], &[]),
                with(
                    "after_return",
                    &["app/auth.py#strict"],
                    &[],
                    &["after_conditional_return:app/auth.py#strict"],
                ),
                with(
                    "under_branch",
                    &["app/auth.py#strict"],
                    &[],
                    &["under_branch:app/auth.py#strict"],
                ),
                // `if user is None: deny()`: the refusal of that branch, where the
                // body's own paths are read to refuse every request they let
                // through (Python lowering 60 records it).
                with(
                    "by_helper",
                    &["app/auth.py#deny"],
                    &[drift_core::controls::REFUSES_EVERY],
                    &["under_branch:app/auth.py#deny"],
                ),
                // `if authorization:` / `if bad(authorization): deny()`: the same
                // call, in a body that lets a caller with no token through.
                with(
                    "by_helper_nested",
                    &["app/auth.py#deny"],
                    &[],
                    &["under_branch:app/auth.py#deny"],
                ),
                with("deny", &[], &[REJECTS_CALLER, REFUSES_ALL], &[]),
            ],
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![api, auth],
            ..Default::default()
        };
        let mining = crate::context::RepoContext::new(&repo, &[]);
        let listing = crate::context::RepoContext::new(&repo, &[]).reading_since_measured();
        for d in deps {
            let dep = format!("app/auth.py#{d}");
            assert!(authenticates(&mining, &dep), "{dep}");
            assert!(!may_authenticate(&mining, &dep), "{dep}");
            let proven = matches!(d, "strict" | "by_helper");
            assert_eq!(authenticates(&listing, &dep), proven, "{dep}");
            assert!(proven || may_authenticate(&listing, &dep), "{dep}");
        }
        let inv = inventory(&repo);
        let row = |n: &str| inv.entry_points.iter().find(|e| e.symbol == n).unwrap();
        assert_eq!(row("strict").guards, ["strict"]);
        assert_eq!(row("by_helper").guards, ["by_helper"]);
        for d in ["partial", "after_return", "under_branch"] {
            assert!(row(d).guards.is_empty(), "{d}");
            assert_eq!(row(d).opaque, [d], "{d}");
        }
        assert_eq!(inv.unguarded().count(), 0);
    }

    /// A route whose body calls a helper that rejects (`await requireSession()`), or
    /// checks the session and answers 401, is guarded in its body, as the practice map
    /// reads it: listed with its mechanism. A call to its own wrapper, a check against
    /// an env secret, and a helper that rejects no one are not.
    #[test]
    fn guards_in_the_handler_body_are_guards() {
        let entry = |symbol: &str| EntryPoint {
            symbol: symbol.into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(format!("/{symbol}")),
            adapter: "next".into(),
        };
        let mut called = sym(
            "called",
            &["lib/session.ts#requireSession", "lib/db.ts#listRows"],
            &[],
        );
        called.calls.push("lib/auth.ts#withAuth".into());
        let mut checked = sym("checked", &["pkg:next-auth#auth"], &[]);
        checked.body_checks = vec![drift_core::BodyCheck {
            source: "pkg:next-auth#auth".into(),
            reads: ".user".into(),
            ..Default::default()
        }];
        let mut cron = sym("cron", &[], &[]);
        cron.body_checks = vec![drift_core::BodyCheck {
            compares: "env".into(),
            ..Default::default()
        }];
        let mut wrapped = sym("wrapped", &["lib/auth.ts#withAuth"], &[]);
        wrapped.wraps = vec![Wrap {
            wrapper: "lib/auth.ts#withAuth".into(),
            kind: WrapKind::Call,
        }];
        let route = FileFacts {
            path: "app/api/x/route.ts".into(),
            symbols: vec![called, checked, cron, wrapped],
            entry_points: ["called", "checked", "cron", "wrapped"]
                .into_iter()
                .map(entry)
                .collect(),
            ..Default::default()
        };
        let mut require = sym("requireSession", &[], &[]);
        require.controls = vec![drift_core::controls::REJECTS_CALLER.into()];
        let mut with_auth = sym("withAuth", &[], &[]);
        with_auth.controls = vec![drift_core::controls::REJECTS_CALLER.into()];
        let lib = FileFacts {
            path: "lib/session.ts".into(),
            symbols: vec![require],
            ..Default::default()
        };
        let auth = FileFacts {
            path: "lib/auth.ts".into(),
            symbols: vec![with_auth],
            ..Default::default()
        };
        let db = FileFacts {
            path: "lib/db.ts".into(),
            symbols: vec![sym("listRows", &[], &[])],
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![route, lib, auth, db],
            ..Default::default()
        };
        let inv = inventory(&repo);
        let row = |n: &str| inv.entry_points.iter().find(|e| e.symbol == n).unwrap();
        assert_eq!(
            row("called").guards,
            ["requireSession (body call)", "withAuth (body call)"]
        );
        assert_eq!(row("checked").guards, ["auth.user (body check)"]);
        assert!(row("cron").guards.is_empty());
        assert_eq!(row("wrapped").guards, ["withAuth"]);
        let card = crate::card::card(&repo, &inv, "app/api/x/route.ts", &[], &[], None);
        assert!(
            card.contains(
                "[http] called: guards requireSession (body call) › withAuth (body call);"
            ),
            "{card}"
        );
    }

    #[test]
    fn authentication_and_openings_are_not_guards() {
        let mut view = FileFacts {
            path: "api/views.py".into(),
            symbols: vec![sym("provision", &[], &[])],
            entry_points: vec![EntryPoint {
                symbol: "provision".into(),
                kind: "http".into(),
                method: Some("POST".into()),
                route: Some("/provision".into()),
                adapter: "drf".into(),
            }],
            ..Default::default()
        };
        view.symbols[0].wraps = vec![
            Wrap {
                wrapper: "pkg:rest_framework#authentication.SessionAuthentication".into(),
                kind: WrapKind::Authenticates,
            },
            Wrap {
                wrapper: "pkg:rest_framework#permissions.AllowAny".into(),
                kind: WrapKind::Opens,
            },
        ];
        let repo = RepoFacts {
            files: vec![view],
            ..Default::default()
        };
        let inv = inventory(&repo);
        let e = &inv.entry_points[0];
        assert!(e.guards.is_empty());
        assert_eq!(e.authenticates, ["authentication.SessionAuthentication"]);
        assert_eq!(e.opens, ["permissions.AllowAny"]);
        assert_eq!(inv.unguarded().count(), 1);
        let text = render(&inv, None, 20);
        assert!(
            text.contains("1 where Drift found no guard in what it read"),
            "{text}"
        );
    }

    #[test]
    fn app_hooks_are_marked_and_counted() {
        let mut view = FileFacts {
            path: "app/auth.py".into(),
            symbols: vec![sym("login", &[], &[])],
            entry_points: vec![EntryPoint {
                symbol: "login".into(),
                kind: "http".into(),
                method: Some("POST".into()),
                route: Some("/login".into()),
                adapter: "flask".into(),
            }],
            ..Default::default()
        };
        view.symbols[0].wraps = vec![
            Wrap {
                wrapper: "app/hooks.py#csrf".into(),
                kind: WrapKind::AppHook,
            },
            Wrap {
                wrapper: "pkg:drf_spectacular#utils.extend_schema".into(),
                kind: WrapKind::Decorator,
            },
        ];
        // A hook is a guard by what it does: `csrf` turns callers away, `open_db`
        // does not, and `absent` is not in the facts.
        view.symbols[0]
            .wraps
            .extend(["open_db", "absent"].map(|h| Wrap {
                wrapper: format!("app/hooks.py#{h}"),
                kind: WrapKind::AppHook,
            }));
        let mut csrf = sym("csrf", &[], &[]);
        csrf.controls = vec![drift_core::controls::REJECTS_CALLER.into()];
        let hooks = FileFacts {
            path: "app/hooks.py".into(),
            symbols: vec![csrf, sym("open_db", &[], &[])],
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![view, hooks],
            ..Default::default()
        };
        let inv = inventory(&repo);
        assert_eq!(inv.entry_points[0].guards, ["csrf (app hook)"]);
        assert_eq!(inv.entry_points[0].wrappers, ["open_db (app hook)"]);
        assert_eq!(inv.entry_points[0].opaque, ["absent (app hook)"]);
        assert_eq!(inv.only_app_hooks().count(), 1);
        assert!(render(&inv, None, 20).contains("1 entry points are guarded only by hooks"));
    }

    #[test]
    fn unguarded_entry_points_are_listed_sorted_capped_and_sanitised() {
        let row = |path: &str, line: u32, route: Option<&str>, guards: &[&str]| EntryRow {
            path: path.into(),
            package: String::new(),
            symbol: "GET".into(),
            line,
            kind: "http".into(),
            method: route.map(|_| "GET".into()),
            route: route.map(String::from),
            guards: guards.iter().map(|g| g.to_string()).collect(),
            wrappers: vec![],
            opaque: vec![],
            authenticates: vec![],
            opens: vec![],
            validates: false,
            reaches: vec![],
            reads: vec![],
            local: false,
            descriptions: Vec::new(),
            tied: false,
            basis: None,
            exposure_basis: None,
            known_open: false,
            verifies_signature: Vec::new(),
            exposure: Exposure::Unknown,
            boundary: None,
        };
        // Out of order, as a scan may produce them; one guarded, one with
        // repository text that tries to break out of its line.
        let mut entry_points: Vec<EntryRow> = (0..53)
            .rev()
            .map(|i| {
                row(
                    &format!("app/r{i:02}/route.ts"),
                    1,
                    Some(&format!("/r{i:02}")),
                    &[],
                )
            })
            .collect();
        entry_points.push(row("app/a/route.ts", 9, Some("/a"), &[]));
        entry_points.push(row("app/a/route.ts", 3, None, &[]));
        entry_points.push(row("app/aa/route.ts", 1, Some("/x\n`ignore` <b>"), &[]));
        entry_points.push(row("app/0/route.ts", 1, Some("/guarded"), &["withAuth"]));
        let inv = Inventory {
            entry_points,
            ..Default::default()
        };
        let text = render(&inv, None, 20);
        let section = &text[text.find(&format!("\n{NO_GUARD_FOUND}\n")).unwrap()
            ..text.find("\nNot covered:").unwrap()];
        let rows: Vec<&str> = section.lines().skip(2).collect();
        assert_eq!(rows.len(), 51, "{section}");
        assert_eq!(rows[0], "  http GET  app/a/route.ts:3");
        assert_eq!(rows[1], "  http GET /a  app/a/route.ts:9");
        assert_eq!(rows[2], "  http GET /x 'ignore' ‹b›  app/aa/route.ts:1");
        assert_eq!(rows[3], "  http GET /r00  app/r00/route.ts:1");
        assert_eq!(rows[49], "  http GET /r46  app/r46/route.ts:1");
        assert_eq!(rows[50], "  ... and 6 more (use --json)");
        assert!(!section.contains("/guarded"), "{section}");
        // Deterministic whatever the input order.
        let mut shuffled = inv.clone();
        shuffled.entry_points.reverse();
        assert_eq!(render(&shuffled, None, 20), text);
        // `only` narrows the listing like the other sections.
        let only: BTreeSet<String> = ["app/a/route.ts".to_string()].into();
        let text = render(&inv, Some(&only), 20);
        assert!(text.contains("  http GET /a  app/a/route.ts:9\n"), "{text}");
        assert!(!text.contains("more (use --json)"), "{text}");
    }

    /// A call of a class's method reads that method's facts ([`Symbol::members`]): one
    /// inherited from an in-repo base, a constructor, Django's `as_view()` (the class
    /// as a whole), and a class the facts record no methods for (as a whole). A member
    /// that is no method (`Model.objects`) runs none of them.
    #[test]
    fn calls_of_class_methods_read_that_method() {
        let member = |name: &str, calls: &[&str], sinks: &[&str]| drift_core::Member {
            name: name.into(),
            calls: calls.iter().map(|s| s.to_string()).collect(),
            sinks: sinks.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        };
        let class = |name: &str, members: Vec<drift_core::Member>, sinks: &[&str]| Symbol {
            kind: drift_core::SymbolKind::Class,
            members,
            ..sym(name, &[], sinks)
        };
        let mut base = class(
            "Base",
            vec![member("run", &[], &["shell_exec"])],
            &["shell_exec"],
        );
        base.line = 1;
        let mut child = class(
            "Child",
            vec![member("__init__", &[], &["eval"]), member("safe", &[], &[])],
            &["eval"],
        );
        child.wraps.push(Wrap {
            wrapper: "svc/base.py#Base".into(),
            kind: WrapKind::Extends,
        });
        let legacy = class("Legacy", vec![], &["raw_sql"]);
        let lib = FileFacts {
            path: "svc/base.py".into(),
            lang: "py".into(),
            symbols: vec![base, child, legacy],
            ..Default::default()
        };
        let entry = |name: &str, call: &str| {
            let mut s = sym(name, &[call], &[]);
            s.name = name.into();
            s
        };
        let calls = [
            ("inherited", "svc/base.py#Child.run"),
            ("own", "svc/base.py#Child.safe"),
            ("built", "svc/base.py#Child"),
            ("manager", "svc/base.py#Child.objects.filter"),
            ("view", "svc/base.py#Child.as_view"),
            ("legacy", "svc/base.py#Legacy.anything"),
        ];
        let views = FileFacts {
            path: "svc/views.py".into(),
            lang: "py".into(),
            symbols: calls.iter().map(|(n, c)| entry(n, c)).collect(),
            entry_points: calls
                .iter()
                .map(|(n, _)| EntryPoint {
                    symbol: (*n).into(),
                    kind: "http".into(),
                    method: Some("GET".into()),
                    route: Some(format!("/{n}")),
                    adapter: "django".into(),
                })
                .collect(),
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![lib, views],
            ..Default::default()
        };
        let inv = inventory(&repo);
        let got = |n: &str| -> Vec<(String, Vec<String>)> {
            inv.entry_points
                .iter()
                .find(|e| e.symbol == n)
                .unwrap()
                .reaches
                .iter()
                .map(|r| (r.kind.clone(), r.via.clone()))
                .collect()
        };
        assert_eq!(
            got("inherited"),
            [(
                "shell_exec".to_string(),
                vec![
                    "svc/views.py#inherited".to_string(),
                    "svc/base.py#Base.run".to_string()
                ]
            )]
        );
        assert!(got("own").is_empty());
        assert_eq!(got("built")[0].0, "eval");
        assert_eq!(got("built")[0].1[1], "svc/base.py#Child.__init__");
        assert!(got("manager").is_empty());
        assert_eq!(got("view")[0].0, "eval");
        assert_eq!(got("view")[0].1[1], "svc/base.py#Child");
        assert_eq!(got("legacy")[0].0, "raw_sql");
    }

    /// A call of a sibling method of the same class is no hop: four symbols deep is
    /// reached whatever the methods in between.
    #[test]
    fn sibling_method_calls_are_not_hops() {
        let member = |name: &str, calls: &[&str], sinks: &[&str]| drift_core::Member {
            name: name.into(),
            calls: calls.iter().map(|s| s.to_string()).collect(),
            sinks: sinks.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        };
        let class = |name: &str, members: Vec<drift_core::Member>| Symbol {
            kind: drift_core::SymbolKind::Class,
            members,
            ..sym(name, &[], &[])
        };
        let lib = FileFacts {
            path: "lib/a.ts".into(),
            symbols: vec![
                sym("f1", &["lib/a.ts#A.m1"], &[]),
                class(
                    "A",
                    vec![
                        member("m1", &["lib/a.ts#A.m2"], &[]),
                        member("m2", &["lib/a.ts#B.n1"], &[]),
                    ],
                ),
                class(
                    "B",
                    vec![
                        member("n1", &["lib/a.ts#B.n2"], &[]),
                        member("n2", &["lib/a.ts#f3"], &[]),
                    ],
                ),
                sym("f3", &[], &["dynamic_fetch"]),
            ],
            ..Default::default()
        };
        let route = FileFacts {
            path: "app/api/x/route.ts".into(),
            symbols: vec![sym("GET", &["lib/a.ts#f1"], &[])],
            entry_points: vec![EntryPoint {
                symbol: "GET".into(),
                kind: "http".into(),
                method: Some("GET".into()),
                route: Some("/api/x".into()),
                adapter: "nextjs".into(),
            }],
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![route, lib],
            ..Default::default()
        };
        let inv = inventory(&repo);
        let r = &inv.entry_points[0].reaches;
        assert_eq!(r.len(), 1, "{r:?}");
        assert_eq!(
            r[0].via,
            [
                "app/api/x/route.ts#GET",
                "lib/a.ts#f1",
                "lib/a.ts#A.m1",
                "lib/a.ts#A.m2",
                "lib/a.ts#B.n1",
                "lib/a.ts#B.n2",
                "lib/a.ts#f3"
            ]
        );
    }

    /// PLAN-R14 A3: an in-body call is a guard on proof, never on its name.
    #[test]
    fn callee_proves_guard_by_what_it_does() {
        let f = |name: &str, controls: &[&str], throws: &[&str]| Symbol {
            name: name.into(),
            exported_as: vec![name.into()],
            controls: controls.iter().map(|c| c.to_string()).collect(),
            throws: throws.iter().map(|c| c.to_string()).collect(),
            ..Symbol::default()
        };
        let repo = RepoFacts {
            files: vec![FileFacts {
                path: "lib/auth.ts".into(),
                parse_ok: true,
                symbols: vec![
                    f("getSessionToken", &[], &[]),
                    f("requireUser", &[drift_core::controls::REJECTS_CALLER], &[]),
                    f(
                        "verifyEmailFormat",
                        &["throw"],
                        &["lib/errors.ts#ValidationError"],
                    ),
                ],
                ..FileFacts::default()
            }],
            ..RepoFacts::default()
        };
        let ctx = crate::context::RepoContext::new(&repo, &[]);
        for name in ["verifyEmailFormat", "getSessionToken"] {
            let c = format!("lib/auth.ts#{name}");
            assert!(
                callee_is_guard(&ctx, &c),
                "{name}: mining grants it by name"
            );
            assert!(!callee_proves_guard(&ctx, &c), "{name} is not a guard");
        }
        assert!(callee_proves_guard(&ctx, "lib/auth.ts#requireUser"));
        // A library's own guard; a name with no definition proves nothing.
        assert!(callee_proves_guard(
            &ctx,
            "pkg:@clerk/nextjs/server#auth.protect"
        ));
        assert!(!callee_proves_guard(&ctx, "lib/other.ts#requireAuth"));
        assert!(!callee_proves_guard(&ctx, "pkg:next-auth#getServerSession"));
    }

    /// One rule for a call in a handler's body, three outcomes ([`BodyCall`]). A callee
    /// that entry points share and that can throw is what every helper of a handler looks
    /// like (`load_run()` raising a 404, `parseBody()` throwing a 400, a service builder
    /// raising a 502): nothing. With a name about access too it looks like a guard, and
    /// is still not one until it is shown to turn a caller away: its entry point is
    /// neither guarded nor "no guard" (`opaque`). Only a callee that rejects is a guard.
    #[test]
    fn a_body_call_is_a_guard_unproven_or_nothing() {
        // Throws, and rejects no caller: nothing `authenticates` reads.
        let thrower = |name: &str| {
            let mut s = sym(name, &["global#Error(new)"], &[]);
            s.controls = vec!["throw".into()];
            s.throws = vec!["global#Error".into()];
            s
        };
        let mut symbols: Vec<Symbol> = [
            "load_run",
            "parseBody",
            "_build_loop_service",
            "optionalSession",
            "require_tenant",
            "assertSession",
            "assertOwner",
        ]
        .iter()
        .map(|n| thrower(n))
        .collect();
        // Answers 401: what `authenticates` reads.
        let mut rejects = sym("requireSession", &[], &[]);
        rejects.controls = vec![drift_core::controls::REJECTS_CALLER.into()];
        symbols.push(rejects);
        let helpers = FileFacts {
            path: "lib/helpers.ts".into(),
            parse_ok: true,
            symbols,
            ..Default::default()
        };
        let route = |name: &str, calls: &[&str]| FileFacts {
            path: format!("app/api/{name}/route.ts"),
            parse_ok: true,
            symbols: vec![sym("GET", calls, &[])],
            entry_points: vec![EntryPoint {
                symbol: "GET".into(),
                kind: "http".into(),
                method: Some("GET".into()),
                route: Some(format!("/api/{name}")),
                adapter: "nextjs".into(),
            }],
            ..Default::default()
        };
        const PROVEN: &str = "lib/helpers.ts#requireSession";
        const UNPROVEN: [&str; 2] = [
            "lib/helpers.ts#require_tenant",
            "lib/helpers.ts#assertSession",
        ];
        // Shared and throwing, with no name about access, or with one that opens it.
        const NOTHING: [&str; 4] = [
            "lib/helpers.ts#load_run",
            "lib/helpers.ts#parseBody",
            "lib/helpers.ts#_build_loop_service",
            "lib/helpers.ts#optionalSession",
        ];
        // An access name on a callee one entry point calls.
        const OWNER: &str = "lib/helpers.ts#assertOwner";
        let mut once = NOTHING.to_vec();
        once.push(OWNER);
        let repo = RepoFacts {
            files: vec![
                helpers,
                route("proven1", &[PROVEN]),
                route("proven2", &[PROVEN]),
                route("unproven1", &UNPROVEN),
                route("unproven2", &UNPROVEN),
                route("nothing1", &once),
                route("nothing2", &NOTHING),
                // A proven guard beside an unproven one: guarded.
                route("both", &[PROVEN, UNPROVEN[1]]),
            ],
            ..Default::default()
        };
        let ctx = crate::context::RepoContext::new(&repo, &[]);
        for c in UNPROVEN.iter().chain(&NOTHING) {
            assert!(ctx.called_as_guard(c), "{c}: two entry points call it");
            assert!(!authenticates(&ctx, c), "{c}: it rejects no caller");
        }
        for c in &NOTHING[..3] {
            // Mining still reads each as a guard; the proof is what differs.
            assert!(callee_is_guard(&ctx, c), "{c}");
            assert!(!callee_proves_guard(&ctx, c), "{c}");
            assert_eq!(body_call(&ctx, c), BodyCall::NotAGuard, "{c}");
        }
        // A name that opens access is no guard, whoever calls it.
        assert!(!callee_is_guard(&ctx, NOTHING[3]));
        assert_eq!(body_call(&ctx, NOTHING[3]), BodyCall::NotAGuard);
        // An access name on a callee one entry point calls proves nothing.
        assert!(!ctx.called_as_guard(OWNER));
        assert!(!callee_proves_guard(&ctx, OWNER));
        assert_eq!(body_call(&ctx, OWNER), BodyCall::NotAGuard);
        for c in UNPROVEN {
            assert!(callee_proves_guard(&ctx, c), "{c}: shared, throws, named");
            assert_eq!(body_call(&ctx, c), BodyCall::Unproven, "{c}");
        }
        assert_eq!(body_call(&ctx, PROVEN), BodyCall::Guard);

        // The inventory: a guard only when proven, opaque when it only looks like one.
        let inv = inventory(&repo);
        let row = |name: &str| {
            let path = format!("app/api/{name}/route.ts");
            let e = inv.entry_points.iter().find(|e| e.path == path).unwrap();
            (e.guards.clone(), e.opaque.clone(), e.unguarded())
        };
        let v = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let looks = ["assertSession (body call)", "require_tenant (body call)"];
        for name in ["proven1", "proven2"] {
            assert_eq!(
                row(name),
                (v(&["requireSession (body call)"]), v(&[]), false)
            );
        }
        for name in ["unproven1", "unproven2"] {
            assert_eq!(row(name), (v(&[]), v(&looks), false), "{name}");
        }
        for name in ["nothing1", "nothing2"] {
            assert_eq!(row(name), (v(&[]), v(&[]), true), "{name}");
        }
        assert_eq!(
            row("both"),
            (v(&["requireSession (body call)"]), v(&looks[..1]), false)
        );
        let text = render(&inv, None, 20);
        assert!(
            text.contains("7 entry points (2 where Drift found no guard in what it read, 2 whose guard cannot be read, "),
            "{text}"
        );
        // Listed apart from "no guard", with what could not be proven; a guarded entry
        // point is in neither list.
        let (bare, unread) = text
            .split_once(format!("\n{NO_GUARD_FOUND}\n").as_str())
            .and_then(|(_, t)| {
                t.split_once(
                    "\nEntry points whose guard cannot be read (opaque wrappers, unproven body calls)\n",
                )
            })
            .unwrap_or_else(|| panic!("{text}"));
        assert!(bare.contains("app/api/nothing1/route.ts") && bare.contains("nothing2"));
        assert!(!bare.contains("proven") && !bare.contains("both"), "{text}");
        assert!(
            unread.contains("app/api/unproven1/route.ts") && unread.contains("unproven2"),
            "{text}"
        );
        assert!(
            unread.contains("opaque: assertSession (body call) › require_tenant (body call)"),
            "{text}"
        );
        assert!(
            !unread.contains("/proven") && !unread.contains("both"),
            "{text}"
        );
    }

    /// Where a gap or a boundary change names an entry point's guards, an unreadable
    /// guard is "unknown" and a local entry point "local", in the text and in the pull
    /// request annotation: never "no guard", which the inventory's own listing does not
    /// say of them either.
    #[test]
    fn a_gap_or_a_boundary_change_never_says_no_guard_of_an_unreadable_or_local_one() {
        let entry = |symbol: &str, opaque: &[&str], local: bool| EntryRef {
            basis: None,
            path: format!("app/{symbol}.ts"),
            symbol: symbol.into(),
            line: 3,
            kind: if local { "cli" } else { "http" }.into(),
            method: (!local).then(|| "GET".into()),
            route: (!local).then(|| format!("/{symbol}")),
            guards: vec![],
            opens: vec![],
            opaque: opaque.iter().map(|o| o.to_string()).collect(),
            local,
            verifies_signature: Vec::new(),
        };
        assert_eq!(
            entry("unread", &["requireTenant (body call)"], false).has(),
            "guard unknown (opaque: requireTenant (body call))"
        );
        assert_eq!(entry("tool", &[], true).has(), LOCAL_NOTE);
        assert_eq!(
            entry("bare", &[], false).has(),
            "no guard found in what Drift read"
        );
        let gap = |e: EntryRef| GapRegression {
            guard: "withAuth".into(),
            kind: "http".into(),
            package: String::new(),
            dir: "app".into(),
            members: 10,
            with_guard: 9,
            entry: e,
            example: entry("kept", &[], false),
            convention: None,
        };
        let r = Regressions {
            guard_gaps: vec![
                gap(entry("unread", &["requireTenant (body call)"], false)),
                gap(entry("bare", &[], false)),
            ],
            now_public: vec![
                entry("tool", &[], true),
                entry("unread", &["requireTenant (body call)"], false),
                entry("bare", &[], false),
            ],
            ..Regressions::default()
        };
        let text = render_regressions(&r, "main", "abc", 3, None);
        let line = |needle: &str| {
            text.lines()
                .filter(|l| l.contains(needle))
                .map(str::to_string)
                .collect::<Vec<_>>()
        };
        for l in line("app/unread.ts") {
            assert!(
                l.contains("guard unknown (opaque: requireTenant (body call))")
                    && !l.contains("no guard"),
                "{text}"
            );
        }
        assert_eq!(line("app/unread.ts").len(), 2, "{text}");
        assert!(
            line("app/tool.ts")[0].ends_with(&format!(": {LOCAL_NOTE}")),
            "{text}"
        );
        assert_eq!(line("app/bare.ts").len(), 2, "{text}");
        assert!(
            line("app/bare.ts").iter().all(|l| l.contains("no guard")),
            "{text}"
        );
        let notes = github_regression_annotations(&r);
        let note = |path: &str| {
            notes
                .lines()
                .find(|l| l.contains(&format!("file={path},")))
                .unwrap_or_else(|| panic!("{notes}"))
                .to_string()
        };
        assert!(
            note("app/unread.ts")
                .contains("this one has guard unknown (opaque: requireTenant (body call)). "),
            "{notes}"
        );
        assert!(
            note("app/bare.ts").contains("this one has no guard found in what Drift read. "),
            "{notes}"
        );
    }

    /// A message consumer is fed by a queue: no caller signs in, so it is listed with
    /// its kind and not counted among the entry points with no guard, and the
    /// headline says so. It is not local: a remote party may have written the message.
    #[test]
    fn a_consumer_is_listed_but_not_counted_as_an_unguarded_route() {
        let entry = |symbol: &str, kind: &str| EntryPoint {
            symbol: symbol.into(),
            kind: kind.into(),
            method: (kind == "http").then(|| "GET".into()),
            route: (kind == "http").then(|| "/x".into()),
            adapter: "x".into(),
        };
        let repo = RepoFacts {
            files: vec![
                FileFacts {
                    path: "app/consumer.py".into(),
                    symbols: vec![sym("AbConsumer", &[], &["shell_exec"])],
                    entry_points: vec![entry("AbConsumer", "consumer")],
                    ..Default::default()
                },
                FileFacts {
                    path: "app/routes.py".into(),
                    symbols: vec![sym("x", &[], &[])],
                    entry_points: vec![entry("x", "http")],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let inv = inventory(&repo);
        let rows: Vec<(&str, &str, bool, bool)> = inv
            .entry_points
            .iter()
            .map(|e| (e.symbol.as_str(), e.kind.as_str(), e.local, e.unguarded()))
            .collect();
        assert_eq!(
            rows,
            [
                ("AbConsumer", "consumer", false, false),
                ("x", "http", false, true),
            ]
        );
        let text = render(&inv, None, 20);
        assert!(
            text.starts_with(&format!(
                "2 entry points (1 where Drift found no guard in what it read, 1 consumer not counted: {QUEUE_NOTE}, 1 reaching a risky operation), "
            )),
            "{text}"
        );
        let reaching = text
            .lines()
            .find(|l| l.contains("AbConsumer [consumer]"))
            .unwrap_or_else(|| panic!("{text}"));
        assert!(
            reaching.contains(QUEUE_NOTE) && !reaching.contains("no guard"),
            "{reaching}"
        );
    }

    /// A command-line entry point has no remote caller: it stays in the inventory, marked
    /// local, and is neither counted nor listed as having no guard; the headline says how
    /// many were left out and why. A symbol declared twice the same way is one row.
    #[test]
    fn local_entry_points_are_listed_but_not_counted_as_unguarded() {
        let entry = |symbol: &str, kind: &str, adapter: &str| EntryPoint {
            symbol: symbol.into(),
            kind: kind.into(),
            method: (kind == "http").then(|| "GET".into()),
            route: (kind == "http").then(|| "/x".into()),
            adapter: adapter.into(),
        };
        let cli = FileFacts {
            path: "tools/sync.py".into(),
            symbols: vec![sym("main", &[], &["shell_exec"])],
            // The same `main`, as argparse and as a console script.
            entry_points: vec![
                entry("main", "cli", "argparse"),
                entry("main", "cli", "console_script"),
            ],
            ..Default::default()
        };
        let route = FileFacts {
            path: "app/routes.py".into(),
            symbols: vec![sym("x", &[], &[])],
            entry_points: vec![entry("x", "http", "fastapi")],
            ..Default::default()
        };
        let graph = FileFacts {
            path: "agent/graph.py".into(),
            symbols: vec![sym("graph", &[], &[])],
            entry_points: vec![entry("graph", "agent_graph", "langgraph")],
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![cli, route, graph],
            ..Default::default()
        };
        let inv = inventory(&repo);
        let rows: Vec<(&str, &str, bool, bool)> = inv
            .entry_points
            .iter()
            .map(|e| (e.symbol.as_str(), e.kind.as_str(), e.local, e.unguarded()))
            .collect();
        assert_eq!(
            rows,
            [
                ("graph", "agent_graph", false, true),
                ("x", "http", false, true),
                ("main", "cli", true, false),
            ]
        );
        let json = serde_json::to_value(&inv.entry_points).unwrap();
        assert!(json[0].get("local").is_none(), "absent when false");
        assert_eq!(json[2]["local"], true);
        let text = render(&inv, None, 20);
        assert!(
            text.starts_with(
                "3 entry points (2 where Drift found no guard in what it read, 1 cli not counted: run locally, no remote caller, 1 reaching a risky operation), "
            ),
            "{text}"
        );
        let bare = &text[text.find(&format!("\n{NO_GUARD_FOUND}\n")).unwrap()..];
        assert!(bare.contains("agent_graph graph") && bare.contains("http GET /x"));
        assert!(!bare.contains("cli main"), "{bare}");
        assert!(
            text.contains("tools/sync.py:0 main [cli]  | run locally, no remote caller\n"),
            "{text}"
        );
        // A change that adds one is not an unguarded entry point reaching a risky operation.
        let none = Inventory::default();
        let r = regressions(&none, &inv, &|_| true, &|p| p.to_string());
        assert!(r.unguarded_reaching.is_empty(), "{r:#?}");
    }

    /// D8's candidate: a call-wrapper rule counts only when every alternative is a guard.
    /// In-repo wrappers the facts do not define are guards by an authenticating name only
    /// (`login_required`), never `get_db`; any other rule kind is never one.
    #[test]
    fn every_alternative_must_authenticate() {
        let repo = RepoFacts::default();
        let ctx = crate::context::RepoContext::new(&repo, &[]);
        let call = |any_of: &[&str]| crate::mine::Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: any_of.iter().map(|s| s.to_string()).collect(),
        };
        let guard = "app/auth.py#login_required";
        let session = "app/db.py#get_db";
        assert!(authenticates(&ctx, guard));
        assert!(!authenticates(&ctx, session));
        assert!(every_alternative_authenticates(&ctx, &call(&[guard])));
        assert!(!every_alternative_authenticates(&ctx, &call(&[session])));
        assert!(
            !every_alternative_authenticates(&ctx, &call(&[guard, session])),
            "one alternative that turns no one away"
        );
        assert!(!every_alternative_authenticates(&ctx, &call(&[])));
        let decorator = crate::mine::Rule::WrappedBy {
            kind: WrapKind::Decorator,
            any_of: vec![guard.to_string()],
        };
        assert!(!every_alternative_authenticates(&ctx, &decorator));
    }
}
