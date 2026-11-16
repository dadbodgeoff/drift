//! A baseline of what the security inventory holds, and what has been added since.
//!
//! The inventory is facts: it never fails a run. `drift security --diff-base` says
//! what a change introduces, against a commit. This is the same question asked
//! against a file a person keeps (`.drift/security.lock`): every finding the
//! inventory holds when the baseline is written is recorded, by a key that does
//! not move with the lines of a file; a later run reports the findings that are
//! not in it, and those in it that are gone. So what a repository has today is
//! accepted as it is, and nothing more of it is let in without a person seeing
//! it: a route with no guard, a route lacking the guard or the scope its siblings
//! share, an unguarded route reaching a risky operation, a risky operation, a
//! CI workflow step that runs what an outsider wrote, a dependency installed from
//! a source nothing fixes, what a Kubernetes manifest opens, a client file reaching
//! server-only code.
//!
//! Nothing here judges a finding. A finding a person accepts is added to the
//! baseline by writing it again.
//!
//! The baseline says which inventory wrote it ([`INVENTORY_VERSION`]) and which
//! kinds fail `drift check` ([`Baseline::fail`]). A finding of a kind or a detector
//! newer than the baseline is what a new Drift reads, not what a change did: it is
//! reported apart and fails nothing until the baseline is written again. A kind
//! added since ([`ADVISE_FIRST`]) advises until a person sets it to fail.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::security::{EntryRow, Inventory};

/// The baseline, relative to the repository root.
pub const SECURITY_LOCK: &str = ".drift/security.lock";

/// The version of what the inventory finds, stamped in the baseline it writes.
/// Raised whenever a kind of finding ([`KINDS`]) or a detector whose findings a
/// baseline holds (a sink kind) is added, with the new one in [`KIND_SINCE`] or
/// [`DETECTOR_SINCE`]: a baseline written before it does not hold what it finds,
/// and that is no change's doing.
///
/// 1: every kind and detector before the stamp. 2: `unscoped-key`.
pub const INVENTORY_VERSION: u32 = 2;

/// The version of a baseline written before baselines were stamped.
const UNSTAMPED: u32 = 1;

/// Kinds of finding added after version 1, with the version that added them.
const KIND_SINCE: &[(&str, u32)] = &[("unscoped-key", 2)];

/// Detectors (the kind of a risky operation, as `risky` and `unguarded-reaching`
/// keys name it) added after version 1, with the version that added them.
const DETECTOR_SINCE: &[(&str, u32)] = &[];

/// Kinds that advise in `drift check` until a person sets them to fail
/// (`drift security --write-baseline --fail-on <kind>`): new kinds of enforcement
/// start in advice.
pub const ADVISE_FIRST: &[&str] = &["unscoped-key"];

/// The kinds of finding a baseline holds, in the order they are reported.
pub const KINDS: &[(&str, &str)] = &[
    (
        "unguarded-reaching",
        "entry point(s) where Drift found no guard, reaching a risky operation",
    ),
    ("no-guard", "entry point(s) where Drift found no guard"),
    (
        "guard-gap",
        "entry point(s) lacking a guard their siblings share",
    ),
    (
        "scope-gap",
        "entry point(s) reading rows their siblings scope to the caller, unscoped",
    ),
    (
        "no-authorization",
        "entry point(s) that sign the caller in and check nothing of who they are (no role, no tenant, no owner)",
    ),
    (
        "unscoped-key",
        "entry point(s) that sign the caller in and take a tenant or owner key from the request that nothing they run checks or scopes a query by",
    ),
    ("risky", "risky operation(s)"),
    (
        "whole-row",
        "bod(ies) sending rows whole where other code withholds a field",
    ),
    (
        "workflow",
        "CI workflow step(s) that run what an outsider wrote",
    ),
    (
        "dependency",
        "dependenc(ies) installed from a source nothing fixes",
    ),
    ("kubernetes", "thing(s) the Kubernetes manifests open"),
    ("leak", "client file(s) reaching server-only code"),
];

/// Entry points a caller reaches with a request: the ones whose missing guard is a
/// finding of its own.
const REQUEST_KINDS: &[&str] = &["http", "server_action", "graphql", "rpc"];

/// The findings of an inventory: (kind, key) -> where, for a person to open.
pub type Findings = BTreeMap<(String, String), String>;

/// How an entry point is keyed: its handler, its method and its route, never its
/// line.
fn entry_key(path: &str, symbol: &str, method: Option<&str>, route: Option<&str>) -> String {
    let mut key = format!("{path}#{symbol}");
    for part in [method, route].into_iter().flatten() {
        key.push(' ');
        key.push_str(part);
    }
    key
}

fn row_key(e: &EntryRow) -> String {
    entry_key(&e.path, &e.symbol, e.method.as_deref(), e.route.as_deref())
}

/// Every finding of `inv` ([`KINDS`]), read from `facts`.
pub fn findings(inv: &Inventory, facts: &drift_core::RepoFacts) -> Findings {
    // A class's risky operations are those of every member together: each is keyed
    // by the method that holds it, so one more in another method is one more.
    let classes: BTreeMap<(&str, &str), &drift_core::Symbol> = facts
        .files
        .iter()
        .flat_map(|f| {
            f.symbols
                .iter()
                .map(move |s| ((f.path.as_str(), s.name.as_str()), s))
        })
        .filter(|(_, s)| !s.members.is_empty())
        .collect();
    let mut out = Findings::new();
    let mut add = |kind: &str, key: String, path: &str, line: u32| {
        out.entry((kind.to_string(), key))
            .or_insert_with(|| format!("{path}:{line}"));
    };
    for e in &inv.entry_points {
        if e.unguarded() && !e.reaches.is_empty() {
            for r in &e.reaches {
                add(
                    "unguarded-reaching",
                    format!("{} -> {}", row_key(e), r.kind),
                    &e.path,
                    e.line,
                );
            }
        }
        if REQUEST_KINDS.contains(&e.kind.as_str())
            && e.unguarded()
            && !e.known_open
            && e.opens.is_empty()
        {
            add("no-guard", row_key(e), &e.path, e.line);
        }
    }
    for g in &inv.guard_gaps {
        for e in &g.exceptions {
            add(
                "guard-gap",
                format!(
                    "{} lacks {}",
                    entry_key(&e.path, &e.symbol, e.method.as_deref(), e.route.as_deref()),
                    g.guard
                ),
                &e.path,
                e.line,
            );
        }
    }
    for g in &inv.scope_gaps {
        for e in &g.exceptions {
            add(
                "scope-gap",
                format!(
                    "{} reads {} without {}",
                    entry_key(&e.path, &e.symbol, e.method.as_deref(), e.route.as_deref()),
                    g.resource,
                    g.key
                ),
                &e.path,
                e.line,
            );
        }
    }
    for s in &inv.sinks {
        let members: Vec<&str> = classes
            .get(&(s.path.as_str(), s.symbol.as_str()))
            .map(|c| {
                c.members
                    .iter()
                    .filter(|m| m.sinks.contains(&s.kind))
                    .map(|m| m.name.as_str())
                    .collect()
            })
            .unwrap_or_default();
        if members.is_empty() {
            add(
                "risky",
                format!("{} in {}#{}", s.kind, s.path, s.symbol),
                &s.path,
                s.line,
            );
        }
        for m in members {
            add(
                "risky",
                format!("{} in {}#{}.{m}", s.kind, s.path, s.symbol),
                &s.path,
                s.line,
            );
        }
    }
    for w in &inv.whole_rows {
        add(
            "whole-row",
            format!(
                "{}#{} sends {} whole: {}",
                w.path,
                w.symbol,
                w.rows,
                w.fields.join(", ")
            ),
            &w.path,
            w.line,
        );
    }
    for w in &inv.workflows {
        add(
            "workflow",
            format!("{} in {} job {}: {}", w.kind, w.path, w.job, w.detail),
            &w.path,
            w.line,
        );
    }
    for d in &inv.dependencies {
        // Keyed by what is installed and from where, never by its line.
        add(
            "dependency",
            format!("{} in {}: {} {}", d.kind, d.path, d.name, d.detail),
            &d.path,
            d.line,
        );
    }
    for c in &inv.cluster {
        add(
            "kubernetes",
            format!("{} in {}: {} {}", c.kind, c.path, c.object, c.detail),
            &c.path,
            c.line,
        );
    }
    for l in &inv.client_leaks {
        for c in &l.clients {
            add("leak", format!("{c} reaches {}", l.reaches), c, 1);
        }
    }
    out
}

/// Adds what the practice map says of authorization: the units it reads `none`,
/// where every body the entry point runs was read and nothing in it asks who the
/// caller is beyond being signed in. (Unknown units are not findings: what was not
/// read may be the check.)
pub fn add_unauthorized(found: &mut Findings, units: &[crate::practices::UnitRow]) {
    for u in units.iter().filter(|u| u.assignment == "none") {
        found
            .entry((
                "no-authorization".to_string(),
                entry_key(&u.path, &u.symbol, u.method.as_deref(), u.route.as_deref()),
            ))
            .or_insert_with(|| format!("{}:{}", u.path, u.line));
    }
}

/// Adds the practice map's unscoped keys ([`crate::practices::UnitRow::unscoped`]):
/// an entry point that signs the caller in, takes a tenant or owner key from the
/// request, and runs nothing, read to the end, that checks the key or scopes a query
/// by it. Keyed by the entry point and the key, so the same route taking a second
/// key is one more.
pub fn add_unscoped(found: &mut Findings, units: &[crate::practices::UnitRow]) {
    for u in units {
        let Some(key) = u.unscoped.as_deref() else {
            continue;
        };
        found
            .entry((
                "unscoped-key".to_string(),
                format!(
                    "{} takes {key}",
                    entry_key(&u.path, &u.symbol, u.method.as_deref(), u.route.as_deref())
                ),
            ))
            .or_insert_with(|| format!("{}:{}", u.path, u.line));
    }
}

/// The first line of the baseline's header that says which inventory wrote it.
const VERSION_LINE: &str = "# inventory: ";
/// The line of the header that says which kinds fail `drift check`.
const FAIL_LINE: &str = "# fail: ";

/// The kinds a new baseline sets to fail: every kind but those that advise first.
pub fn default_fail() -> BTreeSet<String> {
    KINDS
        .iter()
        .map(|(k, _)| *k)
        .filter(|k| !ADVISE_FIRST.contains(k))
        .map(str::to_string)
        .collect()
}

/// A baseline as it is read: its findings and its header.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Baseline {
    pub findings: BTreeSet<(String, String)>,
    /// The inventory version that wrote it ([`INVENTORY_VERSION`]); 1 for a baseline
    /// with no stamp.
    pub version: u32,
    /// The kinds whose findings not in it fail `drift check`, as the header says.
    /// `None` for a baseline written before the header said so: every kind of then
    /// fails, and none of [`ADVISE_FIRST`].
    pub fail: Option<BTreeSet<String>>,
}

impl Baseline {
    /// Whether a finding of `kind` that is not in the baseline fails `drift check`.
    pub fn fails(&self, kind: &str) -> bool {
        match &self.fail {
            Some(kinds) => kinds.contains(kind),
            None => !ADVISE_FIRST.contains(&kind),
        }
    }

    /// The kinds that fail, as a header would say them.
    pub fn fail_kinds(&self) -> BTreeSet<String> {
        self.fail.clone().unwrap_or_else(|| {
            KINDS
                .iter()
                .map(|(k, _)| *k)
                .filter(|k| self.fails(k))
                .map(str::to_string)
                .collect()
        })
    }
}

/// The baseline as it is written, with the kinds that fail [`default_fail`].
pub fn render_lock(found: &Findings) -> String {
    render_lock_with(found, &default_fail())
}

/// The baseline as it is written: a header (what wrote it, the inventory version,
/// the kinds that fail `drift check`), then one finding a line, kind and key
/// tab-separated, sorted. Lines only ever differ by the finding they hold, so two
/// branches that each add one merge without a conflict (`merge=union`).
pub fn render_lock_with(found: &Findings, fail: &BTreeSet<String>) -> String {
    let mut out = String::from(
        "# drift security baseline: what `drift security` found when this was written.\n\
         # `drift check` and `drift security --ratchet` report what is found now and is not here.\n\
         # Written by `drift security --write-baseline`; do not edit by hand.\n",
    );
    out.push_str(&format!("{VERSION_LINE}{INVENTORY_VERSION}\n"));
    out.push_str(FAIL_LINE);
    out.push_str(&fail.iter().cloned().collect::<Vec<_>>().join(","));
    out.push('\n');
    for (kind, key) in found.keys() {
        out.push_str(kind);
        out.push('\t');
        out.push_str(key);
        out.push('\n');
    }
    out
}

/// The findings a baseline file holds; lines that are no finding are skipped.
pub fn parse_lock(text: &str) -> BTreeSet<(String, String)> {
    text.lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| l.split_once('\t'))
        .map(|(kind, key)| (kind.to_string(), key.to_string()))
        .collect()
}

/// A baseline file, its header read too ([`Baseline`]).
pub fn parse_baseline(text: &str) -> Baseline {
    let mut version = UNSTAMPED;
    let mut fail = None;
    for l in text.lines().take_while(|l| l.starts_with('#')) {
        if let Some(v) = l.strip_prefix(VERSION_LINE) {
            // A stamp Drift cannot read is read as the oldest: what is newer than
            // that never fails.
            version = v.trim().parse().unwrap_or(UNSTAMPED);
        } else if let Some(kinds) = l.strip_prefix(FAIL_LINE.trim_end()) {
            fail = Some(
                kinds
                    .split(',')
                    .map(str::trim)
                    .filter(|k| !k.is_empty())
                    .map(str::to_string)
                    .collect(),
            );
        }
    }
    Baseline {
        findings: parse_lock(text),
        version,
        fail,
    }
}

/// The baseline of the repository at `root`; `None` where there is none.
pub fn load(root: &Path) -> std::io::Result<Option<BTreeSet<(String, String)>>> {
    Ok(load_baseline(root)?.map(|b| b.findings))
}

/// The baseline of the repository at `root`, with its header; `None` where there
/// is none.
pub fn load_baseline(root: &Path) -> std::io::Result<Option<Baseline>> {
    match std::fs::read_to_string(root.join(SECURITY_LOCK)) {
        Ok(text) => Ok(Some(parse_baseline(&text))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// The inventory version that first finds a finding of `kind` keyed `key`: its
/// kind's, or its detector's for a risky operation and what reaches one.
pub fn found_since(kind: &str, key: &str) -> u32 {
    let of = |table: &[(&str, u32)], k: &str| {
        table
            .iter()
            .find(|(x, _)| *x == k)
            .map_or(UNSTAMPED, |(_, v)| *v)
    };
    let detector = match kind {
        "risky" => key.split_once(" in ").map(|(d, _)| d),
        "unguarded-reaching" => key.rsplit_once(" -> ").map(|(_, d)| d),
        _ => None,
    };
    of(KIND_SINCE, kind).max(detector.map_or(UNSTAMPED, |d| of(DETECTOR_SINCE, d)))
}

/// What a run found against a baseline.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct Ratchet {
    /// Found now and not in the baseline, of a kind the baseline sets to fail, by
    /// kind: the key, and where. These fail `drift check`.
    pub added: BTreeMap<String, Vec<Added>>,
    /// Found now and not in the baseline, of a kind the baseline does not set to
    /// fail ([`ADVISE_FIRST`]): advice. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub advised: BTreeMap<String, Vec<Added>>,
    /// Found now and not in the baseline, of a kind or a detector newer than the
    /// inventory that wrote it ([`found_since`]): new in this version of Drift, not
    /// in this change. They fail nothing. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub new_in_drift: BTreeMap<String, Vec<Added>>,
    /// Against a diff: entry points lacking a shared guard in files the change did
    /// not touch (other entry points gained the guard): not the change's finding.
    /// They fail nothing. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub outside_change: BTreeMap<String, Vec<Added>>,
    /// In the baseline and no longer found: writing the baseline again drops them,
    /// so that they cannot come back unseen.
    pub gone: Vec<Gone>,
    /// How many findings the baseline holds that are still found.
    pub kept: usize,
}

impl Ratchet {
    /// Whether anything is found that the baseline does not hold, failing or not.
    pub fn has_news(&self) -> bool {
        [
            &self.added,
            &self.advised,
            &self.new_in_drift,
            &self.outside_change,
        ]
        .iter()
        .any(|m| m.values().any(|rows| !rows.is_empty()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Added {
    pub key: String,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Gone {
    pub kind: String,
    pub key: String,
}

/// Compares what is found now with the baseline's findings, as a current baseline
/// whose header sets no kind: every kind fails but [`ADVISE_FIRST`].
pub fn compare(found: &Findings, baseline: &BTreeSet<(String, String)>) -> Ratchet {
    compare_with(
        found,
        &Baseline {
            findings: baseline.clone(),
            version: INVENTORY_VERSION,
            fail: None,
        },
        None,
    )
}

/// Compares what is found now with `baseline`. `touched`, against a diff, says
/// whether the change added or changed a path: a guard gap elsewhere is not the
/// change's ([`Ratchet::outside_change`]), as [`crate::security::regressions`]
/// counts only exceptions in touched files.
pub fn compare_with(
    found: &Findings,
    baseline: &Baseline,
    touched: Option<&dyn Fn(&str) -> bool>,
) -> Ratchet {
    let mut out = Ratchet::default();
    for ((kind, key), at) in found {
        if baseline.findings.contains(&(kind.clone(), key.clone())) {
            out.kept += 1;
            continue;
        }
        let path = at.rsplit_once(':').map_or(at.as_str(), |(p, _)| p);
        let to = if found_since(kind, key) > baseline.version {
            &mut out.new_in_drift
        } else if kind == "guard-gap" && touched.is_some_and(|t| !t(path)) {
            &mut out.outside_change
        } else if !baseline.fails(kind) {
            &mut out.advised
        } else {
            &mut out.added
        };
        to.entry(kind.clone()).or_default().push(Added {
            key: key.clone(),
            at: at.clone(),
        });
    }
    out.gone = baseline
        .findings
        .iter()
        .filter(|k| !found.contains_key(k))
        .map(|(kind, key)| Gone {
            kind: kind.clone(),
            key: key.clone(),
        })
        .collect();
    out
}

/// The rows of `rows`, at most `max`, for [`render`].
fn rows_text(out: &mut String, rows: &[Added], max: usize) {
    for a in rows.iter().take(max) {
        out.push_str(&format!(
            "  {}  ({})\n",
            crate::report::sanitize(&a.key, 300),
            crate::report::sanitize(&a.at, 200)
        ));
    }
    if rows.len() > max {
        out.push_str(&format!("  ... and {} more\n", rows.len() - max));
    }
}

/// Plain text of a [`Ratchet`], for a terminal or a job log.
pub fn render(r: &Ratchet, max: usize) -> String {
    let mut out = String::new();
    let added: usize = r.added.values().map(Vec::len).sum();
    out.push_str(&format!(
        "Security baseline ({SECURITY_LOCK}): {added} finding(s) not in it, {} still found, {} no longer found\n",
        r.kept,
        r.gone.len()
    ));
    for (kind, what) in KINDS {
        let Some(rows) = r.added.get(*kind) else {
            continue;
        };
        out.push_str(&format!("\n{} new {what} [{kind}]\n", rows.len()));
        rows_text(&mut out, rows, max);
    }
    for (kind, what) in KINDS {
        let Some(rows) = r.advised.get(*kind) else {
            continue;
        };
        out.push_str(&format!(
            "\n{} new {what} [{kind}] (advice: the baseline does not set this kind to fail; `drift security --write-baseline --fail-on {kind}` does)\n",
            rows.len()
        ));
        rows_text(&mut out, rows, max);
    }
    for (kind, what) in KINDS {
        let Some(rows) = r.new_in_drift.get(*kind) else {
            continue;
        };
        out.push_str(&format!(
            "\n{} {what} [{kind}]: new in this version of Drift, not in this change (the baseline was written by an older Drift, which did not look for them); they fail nothing until `drift security --write-baseline` records them\n",
            rows.len()
        ));
        rows_text(&mut out, rows, max);
    }
    for (kind, what) in KINDS {
        let Some(rows) = r.outside_change.get(*kind) else {
            continue;
        };
        out.push_str(&format!(
            "\n{} {what} [{kind}] in files this change did not touch: other entry points gained the guard, so these are not this change's; they fail nothing\n",
            rows.len()
        ));
        rows_text(&mut out, rows, max);
    }
    if !r.gone.is_empty() {
        out.push_str(&format!(
            "\n{} finding(s) of the baseline are no longer found; `drift security --write-baseline` drops them, so that they cannot come back unseen\n",
            r.gone.len()
        ));
    }
    if added > 0 {
        out.push_str(
            "\nEach is a fact for a person to read, not a verdict. Fix it, or accept it by writing the baseline again (`drift security --write-baseline`).\n",
        );
    }
    out
}

/// One thing a change adds that `drift check --diff-base` advises on where the
/// repository has no baseline ([`advise`]). Never part of the exit code.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
pub struct Advice {
    /// `no-guard` (a new request entry point where Drift found no guard),
    /// `unguarded-reaching` (a new entry point where Drift found no guard, reaching
    /// an operation fed by the request), or `unscoped-key`.
    pub kind: String,
    /// The entry point, keyed as a baseline keys it.
    pub key: String,
    /// `path:line`.
    pub at: String,
    /// What Drift read: the basis of "no guard found", or of the unscoped key.
    pub read: String,
    /// The operations fed by the request it reaches, by kind. Omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reaches: Vec<String>,
}

/// What a change adds, in the files it added or changed, against the merge base's
/// inventory `base`: an entry point whose handler the base did not have where Drift
/// found no guard ([`EntryRow::unguarded`]: never one whose guard is unknown, one
/// run locally or fed by a queue, one that verifies a signature), a request entry
/// point or one reaching an operation fed by the request
/// ([`crate::security::INPUT_SINKS`]); and an authorization unit of the change's new
/// entry points with an unscoped key ([`add_unscoped`]). One the practice map knows
/// to be open on purpose, or that something opens, is not one. Sorted.
pub fn advise(
    base: &Inventory,
    head: &Inventory,
    units: &[crate::practices::UnitRow],
    touched: &dyn Fn(&str) -> bool,
    old_path: &dyn Fn(&str) -> String,
) -> Vec<Advice> {
    let base_handlers: BTreeSet<String> = base
        .entry_points
        .iter()
        .map(|e| format!("{}#{}", e.path, e.symbol))
        .collect();
    let new = |path: &str, symbol: &str| {
        touched(path) && !base_handlers.contains(&format!("{}#{symbol}", old_path(path)))
    };
    let mut out = Vec::new();
    for e in &head.entry_points {
        if !e.unguarded() || e.known_open || !e.opens.is_empty() || !new(&e.path, &e.symbol) {
            continue;
        }
        let mut reaches: Vec<String> = e
            .reaches
            .iter()
            .filter(|r| r.fed && crate::security::INPUT_SINKS.contains(&r.kind.as_str()))
            .map(|r| r.kind.clone())
            .collect();
        reaches.sort();
        reaches.dedup();
        if !REQUEST_KINDS.contains(&e.kind.as_str()) && reaches.is_empty() {
            continue;
        }
        out.push(Advice {
            kind: if reaches.is_empty() {
                "no-guard".to_string()
            } else {
                "unguarded-reaching".to_string()
            },
            key: row_key(e),
            at: format!("{}:{}", e.path, e.line),
            read: e.has(),
            reaches,
        });
    }
    for u in units {
        let Some(key) = u.unscoped.as_deref() else {
            continue;
        };
        if !new(&u.path, &u.symbol) {
            continue;
        }
        out.push(Advice {
            kind: "unscoped-key".to_string(),
            key: entry_key(&u.path, &u.symbol, u.method.as_deref(), u.route.as_deref()),
            at: format!("{}:{}", u.path, u.line),
            read: format!(
                "signs the caller in and takes `{key}` from the request; nothing it runs, read to the end, checks it or scopes a query by it"
            ),
            reaches: Vec::new(),
        });
    }
    out.sort();
    out.dedup();
    out
}

/// The heading [`render_advice`] puts over the advice.
pub const ADVICE_HEADING: &str = "Security advice: what this change adds (no security baseline; this does not fail the check)";

/// Plain text of [`advise`]'s rows, under their own heading; nothing when there are
/// none.
pub fn render_advice(advice: &[Advice]) -> String {
    use crate::report::sanitize;
    if advice.is_empty() {
        return String::new();
    }
    let mut out = format!("\n{ADVICE_HEADING}\n");
    let groups: [(&str, &str); 3] = [
        (
            "unguarded-reaching",
            "New entry points where Drift found no guard, reaching an operation fed by the request",
        ),
        ("no-guard", "New request entry points where Drift found no guard"),
        (
            "unscoped-key",
            "New entry points that take a tenant or owner key nothing checks",
        ),
    ];
    for (kind, heading) in groups {
        let rows: Vec<&Advice> = advice.iter().filter(|a| a.kind == kind).collect();
        if rows.is_empty() {
            continue;
        }
        out.push_str(&format!("  {heading}\n"));
        for a in rows {
            out.push_str(&format!(
                "    {}  ({}): {}\n",
                sanitize(&a.key, 300),
                sanitize(&a.at, 200),
                sanitize(&a.read, 300)
            ));
            if !a.reaches.is_empty() {
                out.push_str(&format!(
                    "      reaches {} (fed by the request)\n",
                    sanitize(&a.reaches.join(", "), 200)
                ));
            }
        }
    }
    out.push_str(&format!(
        "  To settle one: add the guard or the check it lacks, or accept what the repository has with `drift security --write-baseline` (commit {SECURITY_LOCK}); `drift check` then reports only what is new.\n"
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_baseline_round_trips_and_says_what_was_added_and_what_is_gone() {
        let mut before = Findings::new();
        before.insert(("no-guard".into(), "a.py#f GET /a".into()), "a.py:3".into());
        before.insert(("risky".into(), "eval in a.py#f".into()), "a.py:9".into());
        let lock = parse_lock(&render_lock(&before));
        assert_eq!(lock.len(), 2);
        let mut now = Findings::new();
        now.insert(
            ("no-guard".into(), "a.py#f GET /a".into()),
            "a.py:30".into(),
        );
        now.insert(
            ("no-guard".into(), "b.py#g POST /b".into()),
            "b.py:5".into(),
        );
        let r = compare(&now, &lock);
        assert_eq!(r.kept, 1);
        assert_eq!(r.added["no-guard"][0].key, "b.py#g POST /b");
        assert_eq!(r.gone[0].key, "eval in a.py#f");
        // A line that moved is the same finding.
        assert!(
            !r.added["no-guard"]
                .iter()
                .any(|a| a.key.starts_with("a.py"))
        );
    }

    #[test]
    fn a_risky_operation_of_a_class_is_keyed_by_its_method() {
        let member = |name: &str| drift_core::Member {
            name: name.into(),
            sinks: vec!["eval".into()],
            ..Default::default()
        };
        let class = |members: Vec<drift_core::Member>| drift_core::RepoFacts {
            files: vec![drift_core::FileFacts {
                path: "a.py".into(),
                symbols: vec![drift_core::Symbol {
                    name: "Repo".into(),
                    members,
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let inv = Inventory {
            sinks: vec![crate::security::SinkUse {
                kind: "eval".into(),
                path: "a.py".into(),
                symbol: "Repo".into(),
                line: 1,
                fed: false,
            }],
            ..Default::default()
        };
        let before = findings(&inv, &class(vec![member("find")]));
        let after = findings(&inv, &class(vec![member("find"), member("create")]));
        let lock = parse_lock(&render_lock(&before));
        let r = compare(&after, &lock);
        assert_eq!(r.added["risky"][0].key, "eval in a.py#Repo.create");
    }

    /// Pins the stamp: a baseline says which inventory wrote it and which kinds
    /// fail; one with no stamp is version 1, and a kind added since fails nothing.
    #[test]
    fn the_header_says_the_version_and_the_kinds_that_fail() {
        let text = render_lock(&Findings::new());
        let b = parse_baseline(&text);
        assert_eq!(b.version, INVENTORY_VERSION);
        assert!(b.fails("no-guard"));
        assert!(!b.fails("unscoped-key"));
        let old = parse_baseline("# drift security baseline\nno-guard\ta.py#f GET /a\n");
        assert_eq!(old.version, 1);
        assert!(old.fail.is_none());
        let mut now = Findings::new();
        now.insert(
            ("unscoped-key".into(), "a.py#f GET /a takes org_id".into()),
            "a.py:3".into(),
        );
        let r = compare_with(&now, &old, None);
        assert!(r.added.is_empty(), "{r:?}");
        assert_eq!(r.new_in_drift["unscoped-key"].len(), 1);
    }

    /// Pins the diff filter: a guard gap in a file the change did not touch is not
    /// the change's, and fails nothing.
    #[test]
    fn a_guard_gap_outside_the_change_fails_nothing() {
        let b = parse_baseline(&render_lock(&Findings::new()));
        let mut now = Findings::new();
        now.insert(
            ("guard-gap".into(), "a.ts#f GET /a lacks auth".into()),
            "a.ts:3".into(),
        );
        now.insert(
            ("guard-gap".into(), "b.ts#g GET /b lacks auth".into()),
            "b.ts:4".into(),
        );
        let touched = |p: &str| p == "b.ts";
        let r = compare_with(&now, &b, Some(&touched as &dyn Fn(&str) -> bool));
        assert_eq!(r.added["guard-gap"].len(), 1);
        assert_eq!(r.added["guard-gap"][0].at, "b.ts:4");
        assert_eq!(r.outside_change["guard-gap"][0].at, "a.ts:3");
    }
}
