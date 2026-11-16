//! A short security summary a person can act on (`drift security --top [N]`, and the
//! first run of `drift init`).
//!
//! The inventory ([`crate::security`]) lists every fact: on seven sample repositories
//! 892 baseline findings, 287 on one of them. A person meeting Drift for the first time
//! needs the few that matter, said plainly, and none of the noise. This module ranks
//! what the inventory already holds and decides nothing from a name:
//!
//! - One finding is one entry point reaching one risky operation ([`EntryRow::reaches`]).
//! - It is ranked only when the request reaches the operation's operand
//!   ([`Reach::fed`], which follows the argument that carries it), a remote caller
//!   reaches the entry point, and Drift read what guards it, whether there is one or
//!   not. A guard Drift could not read ([`EntryRow::opaque`]) is never presented as a
//!   hole: it is counted apart, as "could not read". Guards that are only hooks the
//!   whole app runs, each read to turn callers away as not allowed and none as not
//!   signed in ([`Readings::with_hooks`]), are not read as a guard of the caller: the
//!   finding ranks with those that have none, and its line says so.
//! - Repeats through the same operation are one line with a count and the first places.
//! - The order is one documented function ([`order_key`]) of named constants, with a
//!   full tie-break, so the same inventory always reads the same.
//!
//! Nothing here is enforced: no check, exit code or baseline reads it.

use std::cmp::Reverse;
use std::collections::BTreeMap;
use std::fmt::Write as _;

use serde::Serialize;

use crate::practices::{PracticesReport, UnitRow, VALIDATION};
use crate::report::sanitize;
use crate::security::{
    APP_HOOK, EntryRow, Exposure, Inventory, Reach, queue_kind, reads_only, signature_words,
};

// ---------- what a caller can do, by the operation's kind ----------

/// The operation runs what the caller sends as code (`eval`, a shell command, an
/// unsafe deserialiser, a template rendered from text).
pub const CODE_EXECUTION: u8 = 0;
/// The caller's value goes into the text of a database query.
pub const QUERY_INJECTION: u8 = 1;
/// The caller's value names a file the server opens, or XML that can name one.
pub const FILE_ACCESS: u8 = 2;
/// A token is decoded without being verified: the caller can say who they are.
pub const IDENTITY: u8 = 3;
/// The caller's value is part of the address of a request the server makes.
pub const OUTGOING_REQUEST: u8 = 4;
/// The caller's value is written into a page as raw HTML.
pub const PAGE_CONTENT: u8 = 5;
/// The caller's value chooses what is written (a field of a row, a key of an object).
pub const DATA_WRITE: u8 = 6;
/// The caller's value is the text of a regular expression.
pub const SLOW_PATTERN: u8 = 7;
/// The caller's value is part of the address a redirect sends the browser to.
pub const REDIRECT: u8 = 8;
/// A kind of operation this table does not know yet: ranked last, never left out.
pub const OTHER: u8 = 9;

/// What a caller can do with an operation of `kind` when the request reaches it, in
/// plain words, and how much that matters ([`CODE_EXECUTION`] first). `None` for a
/// kind whose risk is how the code is set up, not what a caller sends (a cookie flag,
/// a weak hash, CORS for any origin, a secret or a debug flag written in the code, TLS
/// not verified): those stay listed by `drift security` and are not ranked here.
///
/// The keys are Drift's own sink kinds ([`crate::security::INPUT_SINKS`] and the
/// detectors' kinds), not names from the code.
pub fn consequence(kind: &str) -> Option<(u8, &'static str)> {
    Some(match kind {
        "eval" => (CODE_EXECUTION, "send text the server runs as code"),
        "shell_exec" => (
            CODE_EXECUTION,
            "send text that becomes part of a shell command",
        ),
        "unsafe_deserialize" => (
            CODE_EXECUTION,
            "send data the server loads with an unsafe deserialiser",
        ),
        "template_injection" => (CODE_EXECUTION, "send text the server renders as a template"),
        "raw_sql" => (
            QUERY_INJECTION,
            "send a value that goes into a raw SQL query",
        ),
        "sql_string_interpolation" => (
            QUERY_INJECTION,
            "send a value that is written into the text of an SQL query",
        ),
        "nosql_injection" => (
            QUERY_INJECTION,
            "send a value that is written into a MongoDB $where expression",
        ),
        "path_traversal" => (
            FILE_ACCESS,
            "send a value that becomes part of the path of a file the server opens",
        ),
        "xml_external_entities" => (
            FILE_ACCESS,
            "send XML the server parses with external entities resolved",
        ),
        "jwt_decode_without_verify" => (
            IDENTITY,
            "send a token the server decodes without verifying it",
        ),
        "dynamic_fetch" => (
            OUTGOING_REQUEST,
            "send a value that becomes part of the address of a request the server makes",
        ),
        "raw_html" => (
            PAGE_CONTENT,
            "send text the server writes into a page as raw HTML",
        ),
        "mass_assignment" => (
            DATA_WRITE,
            "send fields that are written to a row from the whole request body",
        ),
        "dynamic_key_write" => (
            DATA_WRITE,
            "send a value that becomes the key of an object the server writes to",
        ),
        "dynamic_regex" => (
            SLOW_PATTERN,
            "send a value that becomes part of a regular expression the server builds",
        ),
        "dynamic_redirect" => (
            REDIRECT,
            "send a value that becomes part of the address a redirect sends the browser to",
        ),
        "weak_hash"
        | "cookie_without_httponly"
        | "cors_any_origin"
        | "hardcoded_secret"
        | "debug_enabled"
        | "tls_verify_disabled" => return None,
        _ => (OTHER, "send a value that reaches a risky operation"),
    })
}

/// Entry kinds with no caller of their own ([`crate::security::LOCAL_KINDS`] says why):
/// a schedule starts them. With a queue's consumers ([`queue_kind`]) they are not
/// ranked: nothing says a remote caller chooses what they are handed.
pub const SCHEDULED_KINDS: &[&str] = &["cron", "job"];

// ---------- the facts each finding is ranked by ----------

/// Who reaches the entry point, as far as Drift read its guard. Ordered as ranked:
/// a caller Drift found no guard for first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Caller {
    /// No guard found in what Drift read (and nothing whose guard is unread).
    Anyone,
    /// Its only guards are hooks the whole app runs, and what Drift read of each is
    /// that it turns some callers away as not allowed (a 403), never as not signed in
    /// ([`Readings::with_hooks`]): a check that holds for every request (a CSRF token,
    /// a feature switch) refuses so too, so whether it identifies or authorises the
    /// caller is not read. Ranked with [`Caller::Anyone`] ([`order_key`]): what it
    /// rests on is no guard Drift read.
    HookNotRead,
    /// A guard Drift read turns some callers away; a caller who passes it can do this.
    PassesGuard,
    /// The body verifies a webhook's signature: a caller whose signature checks out.
    Service,
    /// No guard found in what Drift read, but Drift saw wrappers or middleware on the
    /// way that it did not read ([`EntryRow::basis`]'s `not_read`): a guard may be
    /// there. Ranked after every guard Drift read, since what it rests on is unread.
    Unread,
}

/// What the practice map read of the entry point's input validation. Ordered as
/// ranked: nothing found first, validated last.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Validation {
    /// The practice map read the entry point and found no validation.
    NotFound,
    /// Not read: neither the practice map nor the inventory says.
    #[default]
    NotRead,
    /// The input is validated on the way (the practice map, or a schema in the body).
    Found,
}

/// What `drift security --top` reads beside the inventory: the practice map's
/// validation reading per entry point, keyed by (path, symbol).
#[derive(Debug, Clone, Default)]
pub struct Readings {
    pub validation: BTreeMap<(String, String), Validation>,
    /// The entry points, by (path, symbol), whose guards are all hooks the whole app
    /// runs that Drift read to refuse only as not allowed ([`Readings::with_hooks`]).
    pub hooks_not_proven: std::collections::BTreeSet<(String, String)>,
}

impl Readings {
    /// The validation concern's units of a practice map built with `units: true`
    /// ([`crate::practices::Options::units`]). A map built without units reads nothing,
    /// and every entry point falls back to the inventory's own fact.
    pub fn from_practices(r: &PracticesReport) -> Self {
        r.concerns
            .iter()
            .find(|c| c.id == VALIDATION)
            .map(|c| Self::from_units(&c.units))
            .unwrap_or_default()
    }

    /// `known` is validated, `none` is nothing found, anything else (`unknown`) is not
    /// read. A handler mounted more than once has one unit per mount: where they
    /// disagree, it is not read.
    pub fn from_units(units: &[UnitRow]) -> Self {
        let mut validation: BTreeMap<(String, String), Validation> = BTreeMap::new();
        for u in units {
            let v = match u.assignment.as_str() {
                "known" => Validation::Found,
                "none" => Validation::NotFound,
                _ => Validation::NotRead,
            };
            validation
                .entry((u.path.clone(), u.symbol.clone()))
                .and_modify(|was| {
                    if *was != v {
                        *was = Validation::NotRead;
                    }
                })
                .or_insert(v);
        }
        Self {
            validation,
            ..Self::default()
        }
    }

    /// The entry points of `inv` whose guards ([`EntryRow::guards`]) are all hooks the
    /// whole app runs ([`EntryRow::only_app_hooks`]) where what proves each hook a
    /// guard ([`crate::security::authenticating_root`]) is a body of the repository
    /// whose every refusal is "not allowed" ([`drift_core::CheckOutcome::Forbidden`])
    /// and none says "not signed in" (no 401 answered outside a `catch`, no
    /// refusal in an `except` handler, no condition that raises an error class).
    ///
    /// Why: the inventory takes such a body for a guard (a 403 in a body that reads a
    /// session value), and Drift's own reading calls a 403 weaker evidence of one
    /// ([`drift_core::controls::Rejection::Forbidden`]). A hook every request passes
    /// through that refuses so may check a CSRF token or a switch, and say nothing of
    /// who the caller is. What the hook's body does decides, never its name. A hook
    /// Drift does not find among the entry point's own wraps, a library's, and one
    /// proven by a 401 keep the inventory's reading.
    pub fn with_hooks(mut self, facts: &drift_core::RepoFacts, inv: &Inventory) -> Self {
        let ctx = crate::context::RepoContext::new(facts, &[]).reading_since_measured();
        for e in inv.entry_points.iter().filter(|e| e.only_app_hooks()) {
            let Some(s) = facts
                .files
                .iter()
                .filter(|f| f.path == e.path)
                .flat_map(|f| f.symbols.iter())
                .find(|s| s.name == e.symbol)
            else {
                continue;
            };
            let hooks: Vec<&str> = s
                .wraps
                .iter()
                .filter(|w| w.kind == drift_core::WrapKind::AppHook)
                .map(|w| w.wrapper.as_str())
                .collect();
            let not_proven = e.guards.iter().all(|g| {
                let name = g.strip_suffix(APP_HOOK).unwrap_or(g);
                let named: Vec<&str> = hooks
                    .iter()
                    .copied()
                    .filter(|h| h.rsplit_once('#').map_or(*h, |(_, n)| n) == name)
                    .collect();
                !named.is_empty() && named.iter().all(|h| refuses_only_as_not_allowed(&ctx, h))
            });
            if not_proven {
                self.hooks_not_proven
                    .insert((e.path.clone(), e.symbol.clone()));
            }
        }
        self
    }

    /// The entry point's validation: the practice map's reading where it has the
    /// unit, else validated where the inventory saw a schema in its body, else not
    /// read (the inventory's `validates: false` proves no absence).
    pub fn validation_of(&self, e: &EntryRow) -> Validation {
        match self.validation.get(&(e.path.clone(), e.symbol.clone())) {
            Some(v) => *v,
            None if e.validates => Validation::Found,
            None => Validation::NotRead,
        }
    }
}

/// The method changes state (`POST`, `PUT`, `DELETE`, ...): ranked before one that
/// may ([`MAY_WRITE`]) and one that only reads ([`READS_ONLY`]).
pub const WRITES: u8 = 0;
/// Listed for every method, or with none (a page, a server action).
pub const MAY_WRITE: u8 = 1;
/// `GET`, `HEAD`, `OPTIONS` ([`reads_only`]).
pub const READS_ONLY: u8 = 2;

fn write_rank(method: Option<&str>) -> u8 {
    match reads_only(method) {
        Some(false) => WRITES,
        None => MAY_WRITE,
        Some(true) => READS_ONLY,
    }
}

// ---------- the summary ----------

/// One entry point of a ranked finding.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Place {
    pub path: String,
    pub line: u32,
    pub method: Option<String>,
    pub route: Option<String>,
    pub symbol: String,
    pub exposure: Exposure,
    /// What guards it, in words: the guards Drift read, a signature verified, or that
    /// no guard was found.
    pub guard: String,
    /// Of an entry point with no guard found: how many things on the way Drift saw and
    /// did not read ([`EntryRow::basis`]).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub guard_not_read: usize,
    /// Its validation is the inventory's schema seen in the body, not the practice
    /// map's reading ([`Readings::validation_of`]). Omitted when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub schema_in_body: bool,
    /// The call chain from the entry point to the operation, inclusive.
    pub via: Vec<String>,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

/// One ranked line: every entry point that reaches the same operation, of the same
/// kind, with the same kind of caller and the same validation reading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Ranked {
    pub kind: String,
    /// The operation's function (`path#Symbol`): the last step of each place's chain.
    pub sink: String,
    /// The line of the operation's function, where the inventory lists it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sink_line: Option<u32>,
    pub caller: Caller,
    pub validation: Validation,
    /// Sorted by path, line, method, route and symbol.
    pub places: Vec<Place>,
}

/// The findings the summary does not rank, by why, each counted once (the first
/// reason that applies, in this order).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct NotRanked {
    /// The entry point runs locally ([`EntryRow::local`]).
    pub no_remote_caller: usize,
    /// A queue or a schedule starts it ([`SCHEDULED_KINDS`], [`queue_kind`]).
    pub no_caller: usize,
    /// The entry point, or the operation, is in test or example code (the markers the
    /// inventory leaves such code out by).
    pub test_or_example: usize,
    /// The operation's risk is how the code is set up ([`consequence`] is `None`).
    pub settings: usize,
    /// No value of the request was read reaching the operation: what reaches it is a
    /// setting, a constant, or what Drift did not follow.
    pub not_fed: usize,
    /// Drift could not read whether a guard turns callers away ([`EntryRow::opaque`]):
    /// unknown, never a hole.
    pub guard_unknown: usize,
}

impl NotRanked {
    pub fn total(&self) -> usize {
        self.no_remote_caller
            + self.no_caller
            + self.test_or_example
            + self.settings
            + self.not_fed
            + self.guard_unknown
    }

    /// Each reason with its count, in plain words; none for a reason with none.
    fn parts(&self) -> Vec<String> {
        [
            (self.guard_unknown, "where Drift could not read the guard"),
            (
                self.not_fed,
                "where Drift read no request value reaching the operation",
            ),
            (
                self.settings,
                "that are settings written in the code, not something a caller sends",
            ),
            (self.no_caller, "started by a queue or a schedule"),
            (self.no_remote_caller, "run locally, with no remote caller"),
            (self.test_or_example, "in test or example code"),
        ]
        .into_iter()
        .filter(|(n, _)| *n > 0)
        .map(|(n, what)| format!("{n} {what}"))
        .collect()
    }
}

/// The inventory's findings, ranked ([`summarize`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Summary {
    /// Every ranked finding, in [`order_key`] order (not capped).
    pub ranked: Vec<Ranked>,
    pub not_ranked: NotRanked,
}

/// What `drift security --top N --json` adds to the inventory as `top`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Top {
    /// The first N ranked findings.
    pub shown: Vec<Ranked>,
    /// How many ranked findings are not shown.
    pub more: usize,
    pub not_ranked: NotRanked,
}

impl Summary {
    /// The first `n` ranked findings (all of them for 0).
    pub fn top(&self, n: usize) -> Top {
        let n = cap(n, self.ranked.len());
        Top {
            shown: self.ranked.iter().take(n).cloned().collect(),
            more: self.ranked.len() - n,
            not_ranked: self.not_ranked,
        }
    }
}

/// `n`, or everything for 0, never more than there is.
fn cap(n: usize, len: usize) -> usize {
    if n == 0 { len } else { n.min(len) }
}

/// Why one finding is not ranked ([`NotRanked`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reason {
    NoRemoteCaller,
    NoCaller,
    TestOrExample,
    Setting,
    NotFed,
    GuardUnknown,
}

/// What proves `hook` a guard is a body of the repository whose every refusal is
/// "not allowed" and none "not signed in" ([`Readings::with_hooks`]). False where
/// nothing proves it, the proof is a library's or by name (no body), or the body has
/// no recorded check.
fn refuses_only_as_not_allowed(ctx: &crate::context::RepoContext, hook: &str) -> bool {
    use drift_core::CheckOutcome::Forbidden;
    let Some(root) = crate::security::authenticating_root(ctx, hook) else {
        return false;
    };
    let Some(body) = ctx.definition(&root) else {
        return false;
    };
    !body.body_checks.is_empty()
        && body.body_checks.iter().all(|c| c.outcome == Forbidden)
        && !body.responses.iter().any(|r| r.status == 401 && !r.in_catch)
        && body.raise_checks.is_empty()
        // A refusal of every request for which what gives the caller gave nothing
        // is a check of who calls, whatever status it answers.
        && crate::security::refuses_without_identity(ctx, body).is_none()
        && !body
            .controls
            .iter()
            .any(|c| c == drift_core::controls::HANDLER_REJECTS)
}

/// `path#Symbol` -> (`path`, `Symbol`).
fn split_node(node: &str) -> (&str, &str) {
    node.rsplit_once('#').unwrap_or((node, ""))
}

/// Whether one finding (an entry point reaching an operation) is ranked, and with
/// which caller; else why not. Unknown is never a hole: a guard Drift could not read
/// is [`Reason::GuardUnknown`], whatever the rest says.
fn classify(e: &EntryRow, r: &Reach, readings: &Readings) -> Result<Caller, Reason> {
    use crate::roles::{is_demo_path, is_test_path};
    if e.local {
        return Err(Reason::NoRemoteCaller);
    }
    if queue_kind(&e.kind) || SCHEDULED_KINDS.contains(&e.kind.as_str()) {
        return Err(Reason::NoCaller);
    }
    let sink_path = r.via.last().map_or(e.path.as_str(), |n| split_node(n).0);
    if is_test_path(&e.path) || is_demo_path(&e.path, &e.package) || is_test_path(sink_path) {
        return Err(Reason::TestOrExample);
    }
    if consequence(&r.kind).is_none() {
        return Err(Reason::Setting);
    }
    if !r.fed {
        return Err(Reason::NotFed);
    }
    if !e.guards.is_empty() {
        // Guards that are only hooks read to refuse as not allowed: no guard of the
        // caller Drift read ([`Caller::HookNotRead`]).
        if readings
            .hooks_not_proven
            .contains(&(e.path.clone(), e.symbol.clone()))
        {
            return Ok(Caller::HookNotRead);
        }
        return Ok(Caller::PassesGuard);
    }
    if !e.opaque.is_empty() {
        return Err(Reason::GuardUnknown);
    }
    if !e.verifies_signature.is_empty() {
        return Ok(Caller::Service);
    }
    // "No guard found" only where Drift read everything on the way (the same test as
    // the session's known-bare reading): something it saw and did not read may hold
    // the guard. An explicit opening to anyone is read, so it stays `Anyone`. A row
    // with no basis at all is one the inventory computed none for (none is computed
    // only where nothing may be a guard), and is read as it was.
    if e.opens.is_empty() && e.basis.as_ref().is_some_and(|b| !b.not_read.is_empty()) {
        return Ok(Caller::Unread);
    }
    Ok(Caller::Anyone)
}

fn place(e: &EntryRow, r: &Reach, caller: Caller) -> Place {
    let guard = match caller {
        Caller::PassesGuard => format!(
            "behind {}",
            e.guards
                .iter()
                .map(|g| sanitize(g, 80))
                .collect::<Vec<_>>()
                .join(" > ")
        ),
        Caller::HookNotRead => format!(
            "guard not read: only hooks the whole app runs stand in front of it ({}), read to turn some callers away as not allowed, not that they identify or authorise the caller",
            sanitize(&e.guards.join(", "), 160)
        ),
        Caller::Service => signature_words(&e.verifies_signature),
        Caller::Anyone if !e.opens.is_empty() => format!(
            "no guard found, and opened to anyone by {}",
            sanitize(&e.opens.join(", "), 120)
        ),
        Caller::Anyone => "no guard found in what Drift read".to_string(),
        Caller::Unread => {
            "no guard found in what Drift read, and some of the way was not read".to_string()
        }
    };
    Place {
        path: e.path.clone(),
        line: e.line,
        method: e.method.clone(),
        route: e.route.clone(),
        symbol: e.symbol.clone(),
        exposure: e.exposure,
        guard,
        guard_not_read: match caller {
            Caller::Anyone | Caller::Unread => e.basis.as_ref().map_or(0, |b| b.not_read.len()),
            _ => 0,
        },
        schema_in_body: false,
        via: r.via.clone(),
    }
}

/// The line of the operation's function, as the inventory lists its operations.
fn sink_line(inv: &Inventory, kind: &str, node: &str) -> Option<u32> {
    let (path, symbol) = split_node(node);
    let top = symbol.split('.').next().unwrap_or(symbol);
    inv.sinks
        .iter()
        .filter(|s| s.kind == kind && s.path == path && (s.symbol == symbol || s.symbol == top))
        .map(|s| s.line)
        .min()
}

/// The inventory's findings, ranked, from the facts it holds and the practice map's
/// validation reading (`readings`), nothing else. Deterministic: the same inventory in
/// any order gives the same summary.
pub fn summarize(inv: &Inventory, readings: &Readings) -> Summary {
    type Key = (String, String, Caller, Validation);
    let mut groups: BTreeMap<Key, Vec<Place>> = BTreeMap::new();
    let mut not = NotRanked::default();
    for e in &inv.entry_points {
        for r in &e.reaches {
            match classify(e, r, readings) {
                Err(reason) => {
                    let n = match reason {
                        Reason::NoRemoteCaller => &mut not.no_remote_caller,
                        Reason::NoCaller => &mut not.no_caller,
                        Reason::TestOrExample => &mut not.test_or_example,
                        Reason::Setting => &mut not.settings,
                        Reason::NotFed => &mut not.not_fed,
                        Reason::GuardUnknown => &mut not.guard_unknown,
                    };
                    *n += 1;
                }
                Ok(caller) => {
                    let sink = r
                        .via
                        .last()
                        .cloned()
                        .unwrap_or_else(|| format!("{}#{}", e.path, e.symbol));
                    groups
                        .entry((r.kind.clone(), sink, caller, readings.validation_of(e)))
                        .or_default()
                        .push({
                            let mut p = place(e, r, caller);
                            // Validated only by the inventory's schema in the body: the
                            // practice map did not read the unit.
                            p.schema_in_body = e.validates
                                && !readings
                                    .validation
                                    .contains_key(&(e.path.clone(), e.symbol.clone()));
                            p
                        });
                }
            }
        }
    }
    let mut ranked: Vec<Ranked> = groups
        .into_iter()
        .map(|((kind, sink, caller, validation), mut places)| {
            places.sort();
            places.dedup();
            Ranked {
                sink_line: sink_line(inv, &kind, &sink),
                kind,
                sink,
                caller,
                validation,
                places,
            }
        })
        .collect();
    ranked.sort_by_cached_key(order_key);
    Summary {
        ranked,
        not_ranked: not,
    }
}

/// What [`order_key`] returns; lower first.
pub type OrderKey = (
    u8,
    u8,
    Exposure,
    Validation,
    u8,
    Reverse<usize>,
    String,
    String,
    String,
    u32,
    Caller,
);

/// The order ranked findings are read in, lower first. A stable order, not a
/// severity score: it says which fact to look at first and judges none.
///
/// 1. Who can do it ([`Caller`]): a caller Drift found no guard for, and one whose only
///    guards are hooks not read to identify or authorise them ([`Caller::HookNotRead`]),
///    then one who passes a guard Drift read, then a service whose signature checks
///    out, then one whose guard may be in something Drift did not read
///    ([`Caller::Unread`]).
/// 2. What the operation does with the value ([`consequence`]): code execution, then
///    query injection, files, identity, outgoing requests, page content, writes,
///    patterns, and redirects last.
/// 3. Where the entry point is reached from: internet-facing, then unknown, then
///    internal in what Drift read (the best of the line's places).
/// 4. Validation ([`Validation`]): none found, then not read, then validated.
/// 5. Whether a request writes ([`WRITES`], [`MAY_WRITE`], [`READS_ONLY`]; the best of
///    the line's places).
/// 6. Then the full tie-break: more places first, then the kind, the operation, and
///    the first place's path and line, and the caller. Two lines never compare equal:
///    a line is one (kind, operation, caller, validation).
pub fn order_key(r: &Ranked) -> OrderKey {
    let consequence = consequence(&r.kind).map_or(OTHER, |(c, _)| c);
    let exposure = r
        .places
        .iter()
        .map(|p| p.exposure)
        .min()
        .unwrap_or_default();
    let writes = r
        .places
        .iter()
        .map(|p| write_rank(p.method.as_deref()))
        .min()
        .unwrap_or(MAY_WRITE);
    let (path, line) = r
        .places
        .first()
        .map_or((String::new(), 0), |p| (p.path.clone(), p.line));
    let caller = match r.caller {
        Caller::Anyone | Caller::HookNotRead => 0,
        Caller::PassesGuard => 1,
        Caller::Service => 2,
        Caller::Unread => 3,
    };
    (
        caller,
        consequence,
        exposure,
        r.validation,
        writes,
        Reverse(r.places.len()),
        r.kind.clone(),
        r.sink.clone(),
        path,
        line,
        r.caller,
    )
}

// ---------- the text ----------

/// The findings `drift security --top` shows when no number is given.
pub const DEFAULT_TOP: usize = 10;
/// The findings the first run of `drift init` shows.
pub const FIRST_RUN_TOP: usize = 3;
/// The places a grouped line names before it counts the rest.
pub const PLACES_NAMED: usize = 3;

/// The heading of `drift security --top`.
pub const HEADING: &str = "Security findings to look at first (from the security inventory: what Drift read, in order; nothing here fails a check)";
/// The heading of the first run's part.
pub const FIRST_RUN_HEADING: &str =
    "From the security inventory (what Drift read; not conventions, and nothing here is checked)";

/// `GET /a (server.ts:12)`.
fn where_of(p: &Place) -> String {
    let route = match (&p.method, &p.route) {
        (Some(m), Some(r)) => format!("{m} {r}"),
        (None, Some(r)) => r.clone(),
        _ => p.symbol.clone(),
    };
    format!(
        "{} ({}:{})",
        sanitize(&route, 120),
        sanitize(&p.path, 160),
        p.line
    )
}

/// `routes/login.ts:12 (login)`, or `routes/login.ts#login` with no line.
fn sink_at(r: &Ranked) -> String {
    let (path, symbol) = split_node(&r.sink);
    match r.sink_line {
        Some(line) => format!("{}:{line} ({})", sanitize(path, 160), sanitize(symbol, 80)),
        None => sanitize(&r.sink, 200),
    }
}

/// What the caller is, as the line opens.
fn caller_words(c: Caller) -> &'static str {
    match c {
        Caller::Anyone => "A caller Drift found no guard for can",
        Caller::HookNotRead => "A caller, unless a hook the whole app runs turns them away, can",
        Caller::PassesGuard => "A caller who passes its guard can",
        Caller::Service => "A caller whose signature checks out can",
        Caller::Unread => "A caller, unless something Drift did not read turns them away, can",
    }
}

/// The two or three lines of one ranked finding: what a caller can do and where;
/// what Drift read that makes it say so; what it could not read.
pub fn finding_lines(r: &Ranked) -> Vec<String> {
    let what =
        consequence(&r.kind).map_or("send a value that reaches a risky operation", |(_, w)| w);
    let kind = sanitize(&r.kind, 40);
    let Some(first) = r.places.first() else {
        return Vec::new();
    };
    let at_entry = r.places.len() == 1 && first.via.len() <= 1;
    let head = if r.places.len() == 1 {
        let op = if at_entry {
            String::new()
        } else {
            format!("; the operation is in {}", sink_at(r))
        };
        format!(
            "{} {what} ({kind}): {}{op}.",
            caller_words(r.caller),
            where_of(first)
        )
    } else {
        let named: Vec<String> = r.places.iter().take(PLACES_NAMED).map(where_of).collect();
        let rest = r.places.len().saturating_sub(PLACES_NAMED);
        let more = if rest > 0 {
            format!(", and {rest} more")
        } else {
            String::new()
        };
        format!(
            "{} {what} ({kind}) at {} entry points through {}: {}{more}.",
            caller_words(r.caller),
            r.places.len(),
            sink_at(r),
            named.join("; ")
        )
    };

    // A grouped line speaks for every place: where the places read differently, it
    // says so rather than speak for all of them in the first one's words.
    let guard = if r.places.iter().all(|p| p.guard == first.guard) {
        first.guard.clone()
    } else if r.caller == Caller::PassesGuard {
        "behind guards that differ by entry point (`drift security` names each)".to_string()
    } else {
        "what Drift read of their guards differs by entry point (`drift security` names each)"
            .to_string()
    };
    let mut read: Vec<String> = vec![guard];
    // Each chain starts at its own entry point: compared from the step after it.
    let one_chain = r
        .places
        .iter()
        .all(|p| p.via.iter().skip(1).eq(first.via.iter().skip(1)));
    if first.via.len() > 1 && !one_chain {
        read.push(
            "a value the request sent reaches the operation, by a different way from each entry point"
                .to_string(),
        );
    } else if first.via.len() > 1 {
        let steps: Vec<String> = first
            .via
            .iter()
            .skip(1)
            .take(4)
            .map(|n| sanitize(split_node(n).1, 60))
            .collect();
        let longer = if first.via.len() > 5 { " > ..." } else { "" };
        read.push(format!(
            "a value the request sent reaches the operation through {}{longer}",
            steps.join(" > ")
        ));
    } else {
        read.push("a value the request sent reaches the operation".to_string());
    }
    match r.validation {
        Validation::NotFound => read.push("no input validation found".to_string()),
        // The inventory's own fact is a schema seen somewhere in the body, not that it
        // is applied on the way: said as what it is.
        Validation::Found if r.places.iter().all(|p| p.schema_in_body) => {
            read.push("a schema is read in the body".to_string())
        }
        Validation::Found if r.places.iter().any(|p| p.schema_in_body) => read
            .push("the input is validated on the way, or a schema is read in the body".to_string()),
        Validation::Found => read.push("the input is validated on the way".to_string()),
        Validation::NotRead => {}
    }
    let exposure = r
        .places
        .iter()
        .map(|p| p.exposure)
        .min()
        .unwrap_or_default();
    match exposure {
        Exposure::Public => read.push("internet-facing".to_string()),
        Exposure::Internal => read.push("internal in what Drift read".to_string()),
        Exposure::Unknown => {}
    }

    // What no fact of the inventory says: whether the value is checked (an allow
    // list, a comparison) before the operation is always among it.
    let mut not_read: Vec<String> =
        vec!["whether the value is checked before the operation".to_string()];
    if r.validation == Validation::NotRead {
        not_read.push("whether the input is validated".to_string());
    }
    if exposure == Exposure::Unknown {
        not_read.push("where the entry point can be reached from".to_string());
    }
    if r.caller == Caller::HookNotRead {
        not_read.push(
            "whether the hooks the whole app runs identify or authorise the caller".to_string(),
        );
    }
    // The most any one place left unread: the first place may have read everything.
    let guard_not_read = r.places.iter().map(|p| p.guard_not_read).max().unwrap_or(0);
    if guard_not_read > 0 {
        not_read.push(format!(
            "{} thing(s) on the way a guard may be in (`drift security` names them)",
            guard_not_read
        ));
    }
    vec![
        head,
        format!("Read: {}.", read.join("; ")),
        format!("Not read: {}.", not_read.join("; ")),
    ]
}

/// The one line said when nothing ranks: how many findings Drift could not rank, and
/// why. `None` when the inventory holds no operation an entry point reaches.
fn nothing_ranks(s: &Summary, opening: &str) -> Option<String> {
    let total = s.not_ranked.total();
    if total == 0 {
        return None;
    }
    Some(format!(
        "{opening}: nothing ranks. Drift could not rank {total} pair(s) of an entry point and a risky operation it reaches: {}.",
        s.not_ranked.parts().join(", ")
    ))
}

fn push_finding(out: &mut String, i: usize, r: &Ranked) {
    for (j, l) in finding_lines(r).iter().enumerate() {
        if j == 0 {
            let _ = writeln!(out, "  {}. {l}", i + 1);
        } else {
            let _ = writeln!(out, "     {l}");
        }
    }
}

/// `drift security --top N`: the first `n` ranked findings (all for 0), then how many
/// more and the command that lists them all, then what was not ranked and why.
pub fn render(s: &Summary, n: usize) -> String {
    let mut out = String::new();
    if s.ranked.is_empty() {
        let line = nothing_ranks(s, "Security findings").unwrap_or_else(|| {
            "Security findings: nothing ranks; no entry point reaches a risky operation in what Drift read.".to_string()
        });
        let _ = writeln!(out, "{line}");
        return out;
    }
    let shown = cap(n, s.ranked.len());
    let _ = writeln!(out, "{HEADING}");
    for (i, r) in s.ranked.iter().take(shown).enumerate() {
        push_finding(&mut out, i, r);
    }
    let more = s.ranked.len() - shown;
    if more > 0 {
        let _ = writeln!(
            out,
            "  {more} more ranked: `drift security --top {}` lists them all; `drift security` lists every entry point and what it reaches.",
            s.ranked.len()
        );
    }
    let parts = s.not_ranked.parts();
    if !parts.is_empty() {
        let _ = writeln!(out, "  Not ranked: {}.", parts.join(", "));
    }
    out
}

/// The first run's part: at most [`FIRST_RUN_TOP`] findings under a heading that says
/// they are from the security inventory and are not conventions, then the command for
/// the rest. When nothing ranks, one line with how many Drift could not rank and why;
/// empty when the inventory has no operation an entry point reaches.
pub fn render_first_run(s: &Summary) -> String {
    let mut out = String::new();
    if s.ranked.is_empty() {
        if let Some(line) = nothing_ranks(s, "From the security inventory") {
            let _ = writeln!(out, "{line}");
        }
        return out;
    }
    let _ = writeln!(out, "{FIRST_RUN_HEADING}");
    for (i, r) in s.ranked.iter().take(FIRST_RUN_TOP).enumerate() {
        push_finding(&mut out, i, r);
    }
    let more = s.ranked.len().saturating_sub(FIRST_RUN_TOP);
    let not = s.not_ranked.total();
    let rest = match (more, not) {
        (0, 0) => String::new(),
        (0, n) => format!("`drift security --top` says why {n} more are not ranked; "),
        (m, 0) => format!("{m} more ranked in `drift security --top`; "),
        (m, n) => {
            format!("{m} more ranked in `drift security --top`, which also says why {n} are not; ")
        }
    };
    let _ = writeln!(
        out,
        "  {rest}`drift security` lists every entry point and what it reaches."
    );
    out
}
