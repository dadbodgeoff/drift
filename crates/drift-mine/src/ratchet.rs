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
//! kinds fail `drift check` ([`Baseline::fail`]). A finding may fail a check against
//! a baseline only where the baseline was written by an inventory at least as new as
//! the reading that finds it: a finding of a kind, a detector or a reading newer than
//! the baseline ([`KIND_SINCE`], [`DETECTOR_SINCE`], [`READ_SINCE`]) may be what a new
//! Drift reads, not what a change did. It is reported apart and fails nothing until
//! the baseline is written again only where Drift shows the code under it did not
//! change ([`Since`]); where it cannot show that, it fails (fail closed). A kind added since ([`ADVISE_FIRST`])
//! advises until a person sets it to fail.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::security::{EntryRow, Inventory};

/// The baseline, relative to the repository root.
pub const SECURITY_LOCK: &str = ".drift/security.lock";

/// The version of what the inventory finds, stamped in the baseline it writes.
/// Raised whenever a kind of finding ([`KINDS`]) or a detector whose findings a
/// baseline holds (a sink kind) is added, or a reading finds more of a kind that
/// was there, with the kind in [`KIND_SINCE`], [`DETECTOR_SINCE`] or [`READ_SINCE`]:
/// a baseline written before it does not hold what it finds, and that is no
/// change's doing.
///
/// 1: every kind, detector and reading before the stamp. 2: `unscoped-key`, and the
/// readings of [`READ_SINCE`]. (No build stamped 2 before those readings: the stamp
/// and they ship together.) 3: tRPC procedures keyed by their dotted path;
/// `workflow-hardening` and `image-hardening` ([`crate::hardening`]); `workflow`
/// findings of CI systems other than GitHub Actions ([`crate::ci`]).
pub const INVENTORY_VERSION: u32 = 3;

/// The version of a baseline written before baselines were stamped.
const UNSTAMPED: u32 = 1;

/// Kinds of finding added after version 1, with the version that added them.
///
/// `workflow-hardening` and `image-hardening` read files an older Drift read for
/// other kinds only: a baseline stamped 2 or less holds none of them, so what an
/// unchanged repository has is new in Drift, not a change's.
const KIND_SINCE: &[(&str, u32)] = &[
    ("unscoped-key", 2),
    ("workflow-hardening", 3),
    ("image-hardening", 3),
];

/// Detectors (the kind of a risky operation, as `risky` and `unguarded-reaching`
/// keys name it) added after version 1, with the version that added them.
///
/// Empty, because no sink kind was added: a MongoDB `$where` built in a helper
/// function is the `nosql_injection` sink read in more places, and routes listed
/// through a factory mount (`use("/x", factory())`) are more entry points. Both are
/// more rows of old kinds and old detectors, keyed as a change's would be, so neither
/// table can tell them apart: naming `nosql_injection` here would let every new
/// `$where` a change adds through as "new in Drift". Telling them apart needs the
/// reading that found a row to carry the version that added it.
const DETECTOR_SINCE: &[(&str, u32)] = &[];

/// Kinds of finding whose reading a version widened (it finds more of the kind, or
/// keys some differently), with that version: a baseline written before it does
/// not hold what the wider reading finds, and a finding of the kind cannot be told
/// apart from one a change added by its key. So against an older baseline a
/// finding of the kind it does not hold is new in Drift ([`Ratchet::new_in_drift`])
/// until the baseline is written again only where this Drift finds it at the commit
/// compared with, in a file unchanged since ([`Since`]); elsewhere it fails as the
/// kind did before (holding it apart would let every finding a change adds through
/// after an upgrade).
///
/// 2:
/// - `no-guard`, `unguarded-reaching`: entry points read through a wrapper a call
///   builds (`asyncHandler(searchProducts())`), Python permission classes read on
///   any base, more of what the bodies reach, `fed` read by argument position;
/// - `guard-gap`: more guards read (a role can cross the share, a guard be named
///   anew), guards built on another, unknown guards set apart;
/// - `scope-gap`, `no-authorization`: authorization read through module
///   constructors and more sides of a filter;
/// - `risky`: a `$where` built in a helper, a Python file path bound to a name
///   first, a property written under a key read off a parameter;
/// - `whole-row`: read for every entry point, so for those newly listed too;
/// - `workflow`: runs a comment starts, expressions in bracket form, reusable
///   workflows a job calls, and a second step of a job with the same expression
///   keyed apart (` (occurrence N in the job)`).
///
/// 3:
/// - `workflow`: the pipelines of GitLab CI, CircleCI, Azure Pipelines, Bitbucket
///   Pipelines and a `Jenkinsfile` ([`crate::ci`]). A baseline stamped 2 holds none
///   of them, and a repository with one must not start failing because Drift learned
///   to read its CI.
///
/// `dependency`, `kubernetes` and `leak` read as before. Every later
/// change to what a reading finds adds its kinds here with the new version.
///
/// 3: a tRPC procedure is keyed by its dotted path (`user.byId`), once for each
/// path it is mounted at, where 2 keyed it by its key alone: `no-guard`,
/// `unguarded-reaching`, `guard-gap`, `scope-gap` and `no-authorization` of a
/// procedure key it anew.
const READ_SINCE: &[(&str, u32)] = &[
    ("guard-gap", 3),
    ("no-authorization", 3),
    ("no-guard", 3),
    ("risky", 2),
    ("scope-gap", 3),
    ("unguarded-reaching", 3),
    ("whole-row", 2),
    ("workflow", 3),
];

/// Kinds that advise in `drift check` until a person sets them to fail
/// (`drift security --write-baseline --fail-on <kind>`): new kinds of enforcement
/// start in advice.
pub const ADVISE_FIRST: &[&str] = &["unscoped-key", "workflow-hardening", "image-hardening"];

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
        "workflow-hardening",
        "CI workflow job(s) an outsider can start that state no token permissions or run on a self-hosted runner",
    ),
    (
        "image-hardening",
        "image(s) built to deploy that run as root or hold a secret in a layer",
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
pub(crate) fn entry_key(
    path: &str,
    symbol: &str,
    method: Option<&str>,
    route: Option<&str>,
) -> String {
    let mut key = format!("{path}#{symbol}");
    for part in [method, route].into_iter().flatten() {
        key.push(' ');
        key.push_str(part);
    }
    key
}

pub(crate) fn row_key(e: &EntryRow) -> String {
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
    // Keyed as a workflow finding is, under their own kind, so they advise.
    for w in &inv.workflow_hardening {
        add(
            "workflow-hardening",
            format!("{} in {} job {}: {}", w.kind, w.path, w.job, w.detail),
            &w.path,
            w.line,
        );
    }
    for i in &inv.image_hardening {
        add(
            "image-hardening",
            format!("{} in {} for {}: {}", i.kind, i.path, i.built_by, i.detail),
            &i.path,
            i.line,
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
///
/// Two branches that each wrote the header merge (`merge=union`) into a file with
/// both sides' lines. Read so that neither side's lines weaken the other's: every
/// `# fail:` line's kinds fail (the union), and of several stamps the newest is the
/// version (a newer stamp holds less apart as new in Drift). A stamp Drift cannot
/// read is read as the oldest; [`header_problems`] says so.
pub fn parse_baseline(text: &str) -> Baseline {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text); // a Windows editor's byte-order mark
    let mut version: Option<u32> = None;
    let mut fail: Option<BTreeSet<String>> = None;
    for l in text.lines().take_while(|l| l.starts_with('#')) {
        if let Some(v) = l.strip_prefix(VERSION_LINE) {
            if let Ok(v) = v.trim().parse::<u32>() {
                version = Some(version.map_or(v, |was| was.max(v)));
            }
        } else if let Some(kinds) = l.strip_prefix(FAIL_LINE.trim_end()) {
            fail.get_or_insert_with(BTreeSet::new).extend(
                kinds
                    .split(',')
                    .map(str::trim)
                    .filter(|k| !k.is_empty())
                    .map(str::to_string),
            );
        }
    }
    Baseline {
        findings: parse_lock(text),
        version: version.unwrap_or(UNSTAMPED),
        fail,
    }
}

/// Whether two copies of a baseline file hold the same lines: a byte-order mark and the
/// line endings aside. A checkout with `core.autocrlf` (Git for Windows' default) has
/// CRLF where `git show` gives the committed LF, so a byte comparison took an unchanged
/// file for a changed one.
pub fn same_lines(a: &str, b: &str) -> bool {
    fn body(t: &str) -> &str {
        t.strip_prefix('\u{feff}').unwrap_or(t)
    }
    body(a).lines().eq(body(b).lines())
}

/// What the header of a baseline file says that a person should know, since it
/// changes what is checked: a stamp Drift cannot read (read as version 1, so a
/// finding of a newer reading is held apart only where Drift shows it old), and
/// more than one stamp or `# fail:` line (what a `merge=union` of two branches
/// leaves). Plain sentences, sorted as found.
pub fn header_problems(text: &str) -> Vec<String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut out = Vec::new();
    let (mut stamps, mut fails) = (0, 0);
    for l in text.lines().take_while(|l| l.starts_with('#')) {
        if let Some(v) = l.strip_prefix(VERSION_LINE) {
            stamps += 1;
            if v.trim().parse::<u32>().is_err() {
                out.push(format!(
                    "{SECURITY_LOCK}: the stamp `{}` cannot be read, so the baseline is read as inventory {UNSTAMPED}; `drift upgrade --apply --security-baseline` on the default branch writes it again",
                    crate::report::sanitize(l.trim(), 80)
                ));
            }
        } else if l.starts_with(FAIL_LINE.trim_end()) {
            fails += 1;
        }
    }
    if stamps > 1 {
        out.push(format!(
            "{SECURITY_LOCK} has {stamps} `# inventory:` lines (two branches' headers merged); the newest is read"
        ));
    }
    if fails > 1 {
        out.push(format!(
            "{SECURITY_LOCK} has {fails} `# fail:` lines (two branches' headers merged); every kind any of them names fails"
        ));
    }
    out
}

/// The baseline a change's check enforces: the change's own (`head`, its findings
/// are what a person accepted in it), with a header no weaker than the one at the
/// commit it is compared with (`base`). A change that takes a kind off `# fail:`, or
/// lowers or removes `# inventory:`, would decide by its own edit what checks it;
/// the stricter of the two is kept, and each weakening is said.
pub fn stricter(head: &Baseline, base: &Baseline) -> (Baseline, Vec<String>) {
    let mut out = head.clone();
    let mut said = Vec::new();
    let (now, was) = (head.fail_kinds(), base.fail_kinds());
    let dropped: Vec<&str> = was.difference(&now).map(String::as_str).collect();
    if !dropped.is_empty() {
        said.push(format!(
            "this change takes {} off `# fail:` in {SECURITY_LOCK}; this check still fails on them, as the baseline the change starts from says",
            crate::report::sanitize(&dropped.join(", "), 300)
        ));
        out.fail = Some(now.union(&was).cloned().collect());
    }
    if head.version < base.version {
        said.push(format!(
            "this change lowers `# inventory:` in {SECURITY_LOCK} from {} to {}{}; this check reads it as {}, as the baseline the change starts from says",
            base.version,
            head.version,
            if head.version == UNSTAMPED {
                " (no stamp, or one that cannot be read)"
            } else {
                ""
            },
            base.version
        ));
        out.version = base.version;
    }
    (out, said)
}

/// What changed in a baseline's header from `was` to `now` that checks less: kinds
/// taken off `# fail:`, a stamp lowered or removed. Said where Drift has no commit
/// to enforce the older header against (a check of no diff); empty when nothing
/// weakened.
pub fn header_weakened(was: &Baseline, now: &Baseline) -> Vec<String> {
    let mut said = Vec::new();
    let dropped: Vec<String> = was
        .fail_kinds()
        .difference(&now.fail_kinds())
        .cloned()
        .collect();
    if !dropped.is_empty() {
        said.push(format!(
            "{SECURITY_LOCK} was edited to take {} off `# fail:`: findings of those kinds no longer fail",
            crate::report::sanitize(&dropped.join(", "), 300)
        ));
    }
    if now.version < was.version {
        said.push(format!(
            "{SECURITY_LOCK} was edited to lower `# inventory:` from {} to {}",
            was.version, now.version
        ));
    }
    said
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

/// The inventory version from which a finding of `kind` keyed `key` is found as it
/// is now: the newest of its kind's, its detector's (for a risky operation and what
/// reaches one) and its kind's reading's ([`READ_SINCE`]).
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
    of(KIND_SINCE, kind)
        .max(detector.map_or(UNSTAMPED, |d| of(DETECTOR_SINCE, d)))
        .max(of(READ_SINCE, kind))
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
    /// Found now and not in the baseline, of a kind, a detector or a reading newer
    /// than the inventory that wrote it ([`found_since`]), and shown to be old code
    /// read anew: found by this Drift at the commit compared with ([`Since`]), in a
    /// file unchanged since. What this version of Drift reads, which the baseline
    /// could not hold. They fail nothing until the baseline is written again.
    /// Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub new_in_drift: BTreeMap<String, Vec<Added>>,
    /// Against a diff: entry points lacking a shared guard or scope in files the
    /// change did not touch, that lacked it before the change too
    /// ([`not_the_changes_gaps`]): not the change's finding. They fail nothing.
    /// Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub outside_change: BTreeMap<String, Vec<Added>>,
    /// In the baseline and no longer found: writing the baseline again drops them,
    /// so that they cannot come back unseen.
    pub gone: Vec<Gone>,
    /// How many findings the baseline holds that are still found.
    pub kept: usize,
    /// The commit the findings were compared with to tell old code read anew from a
    /// change's ([`Since::commit`]). Omitted when none was (additive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    /// Of `added`: findings of a reading newer than the baseline that Drift could not
    /// show to be old code read anew (not found at [`Ratchet::since`], in a file
    /// changed since then, or no commit to compare with). They fail. Omitted when 0
    /// (additive).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub unshown: usize,
    /// Why no commit could be compared with, where `unshown` counts any. Omitted
    /// otherwise (additive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unshown_why: Option<String>,
    /// What the baseline's header says or a change did to it that changes what is
    /// checked ([`header_problems`], [`stricter`], [`header_weakened`]). Omitted when
    /// empty (additive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub header: Vec<String>,
    /// Against a diff: entry points the change adds whose guard Drift could not read
    /// ([`crate::security::Regressions::guard_unknown`]). Not checked: unknown is never
    /// a finding, and these fail nothing. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub guard_unknown: Vec<Unknown>,
    /// Against a diff: findings the change adds to the code (not at the merge base)
    /// and also writes into the baseline itself (lines of `.drift/security.lock` the
    /// merge base's did not have), by kind
    /// ([`crate::security_diff::baselined_by_change`]). They are in the baseline, so
    /// they fail nothing; listed so that a reviewer sees them where the check is read,
    /// not only in the lock's diff. Omitted when empty (additive).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub baselined_by_change: BTreeMap<String, Vec<Added>>,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

/// An entry point whose guard Drift could not read ([`Ratchet::guard_unknown`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
pub struct Unknown {
    /// The entry point, keyed as a baseline keys it.
    pub key: String,
    /// `path:line`.
    pub at: String,
    /// What may be its guard and could not be read ([`EntryRow::has`]).
    pub read: String,
}

impl Ratchet {
    /// Whether anything is found that the baseline does not hold, failing or not, or
    /// anything is said of what was not checked or of the header.
    pub fn has_news(&self) -> bool {
        [
            &self.added,
            &self.advised,
            &self.new_in_drift,
            &self.outside_change,
            &self.baselined_by_change,
        ]
        .iter()
        .any(|m| m.values().any(|rows| !rows.is_empty()))
            || !self.header.is_empty()
            || !self.guard_unknown.is_empty()
    }
}

/// What shows, of the findings a baseline does not hold, which are old code read
/// anew and which a change could have added: what this Drift finds at a commit
/// before the change (a diff's merge base, or with no diff the commit that last
/// wrote the baseline), with the files changed since. A finding may be held apart
/// as new in this Drift only where it was found there and its file is unchanged;
/// with no `Since` nothing is held apart, and every finding the baseline does not
/// hold is checked (fail closed).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Since {
    /// The commit.
    pub commit: String,
    /// What this Drift finds at the commit, keyed as now. A renamed file's findings
    /// are keyed by its old path there, so they are not matched: they fail, as one
    /// in a changed file does.
    pub found: BTreeSet<(String, String)>,
    /// The paths, as now, that were added or changed since the commit.
    pub touched: BTreeSet<String>,
    /// Gap exceptions (`guard-gap`, `scope-gap`) found now that are not the change's
    /// ([`not_the_changes_gaps`]).
    pub outside: BTreeSet<(String, String)>,
}

/// Of the gap exceptions found now (`head`), those that are not the change's: in a
/// file the change did not touch, and either found at the commit compared with
/// (`base_found`) or, for a guard gap, an entry point the commit has with the same
/// guards, nothing more opaque and nothing more open, so that what it lacks it
/// lacked before and the gap appeared because other entry points gained the guard.
/// The guards read at the commit come through every file the entry point's guard
/// chain passes (a mount, a router's middleware, an app hook), so a guard removed
/// from any of them is a change of its guards, and is the change's.
///
/// A scope gap is not the change's only where it was found at the commit: whether
/// an entry point filtered a query by the caller is not listed where no gap was, so
/// that the scope was gained elsewhere cannot be shown.
pub fn not_the_changes_gaps(
    base: &Inventory,
    head: &Inventory,
    base_found: &BTreeSet<(String, String)>,
    touched: &dyn Fn(&str) -> bool,
) -> BTreeSet<(String, String)> {
    let mut out = BTreeSet::new();
    for g in &head.guard_gaps {
        for e in &g.exceptions {
            if touched(&e.path) {
                continue;
            }
            let key = (
                "guard-gap".to_string(),
                format!(
                    "{} lacks {}",
                    entry_key(&e.path, &e.symbol, e.method.as_deref(), e.route.as_deref()),
                    g.guard
                ),
            );
            let same_guards = base.entry_points.iter().any(|b| {
                b.path == e.path
                    && b.symbol == e.symbol
                    && b.method == e.method
                    && b.route == e.route
                    && b.guards == e.guards
                    && b.opaque == e.opaque
                    && b.opens == e.opens
            });
            if same_guards || base_found.contains(&key) {
                out.insert(key);
            }
        }
    }
    for g in &head.scope_gaps {
        for e in &g.exceptions {
            if touched(&e.path) {
                continue;
            }
            let key = (
                "scope-gap".to_string(),
                format!(
                    "{} reads {} without {}",
                    entry_key(&e.path, &e.symbol, e.method.as_deref(), e.route.as_deref()),
                    g.resource,
                    g.key
                ),
            );
            if base_found.contains(&key) {
                out.insert(key);
            }
        }
    }
    out
}

/// Whether comparing `found` with `baseline` could hold anything apart, so that the
/// findings at a commit ([`Since`]) are worth reading: a finding the baseline does
/// not hold of a reading newer than it, or (against a diff) a gap exception, in a
/// file not `touched`.
pub fn needs_since(
    found: &Findings,
    baseline: &Baseline,
    diff: bool,
    touched: &dyn Fn(&str) -> bool,
) -> bool {
    found.iter().any(|((kind, key), at)| {
        let path = at.rsplit_once(':').map_or(at.as_str(), |(p, _)| p);
        !baseline.findings.contains(&(kind.clone(), key.clone()))
            && !touched(path)
            && (found_since(kind, key) > baseline.version
                || (diff && (kind == "guard-gap" || kind == "scope-gap")))
    })
}

/// [`Ratchet::guard_unknown`] of a diff: the entry points the change adds whose
/// guard cannot be read, as [`crate::security::regressions`] lists them.
pub fn guard_unknown(rows: &[EntryRow]) -> Vec<Unknown> {
    let mut out: Vec<Unknown> = rows
        .iter()
        .map(|e| Unknown {
            key: row_key(e),
            at: format!("{}:{}", e.path, e.line),
            read: e.has(),
        })
        .collect();
    out.sort();
    out.dedup();
    out
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

/// Compares what is found now with `baseline`. A finding the baseline does not
/// hold is held apart only on what `since` shows ([`Since`]): as new in this Drift
/// ([`Ratchet::new_in_drift`]) where it is of a reading newer than the baseline, was
/// found at the commit and its file did not change since; as not the change's
/// ([`Ratchet::outside_change`]) where it is a gap exception `since` says other entry
/// points made. With `since` `None` nothing shows either, so every finding the
/// baseline does not hold is checked: a baseline an older Drift wrote (unstamped)
/// must not let a change's own unguarded route through because nothing could be
/// compared.
pub fn compare_with(found: &Findings, baseline: &Baseline, since: Option<&Since>) -> Ratchet {
    let mut out = Ratchet {
        since: since.map(|s| s.commit.clone()),
        ..Ratchet::default()
    };
    for ((kind, key), at) in found {
        let k = (kind.clone(), key.clone());
        if baseline.findings.contains(&k) {
            out.kept += 1;
            continue;
        }
        let path = at.rsplit_once(':').map_or(at.as_str(), |(p, _)| p);
        let newer = found_since(kind, key) > baseline.version;
        // Old code read anew: there at the commit, in a file unchanged since. A
        // newer reading's finding in a changed file fails as its kind did before the
        // reading widened (keys do not say what in a unit changed).
        let shown_old = since.is_some_and(|s| s.found.contains(&k) && !s.touched.contains(path));
        let to = if newer && shown_old {
            &mut out.new_in_drift
        } else if since.is_some_and(|s| s.outside.contains(&k)) {
            &mut out.outside_change
        } else if !baseline.fails(kind) {
            &mut out.advised
        } else {
            if newer {
                out.unshown += 1;
            }
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
    // Composed by Drift; the repository's text in them is sanitized where it is put.
    for line in &r.header {
        out.push_str(&format!("  {line}\n"));
    }
    if let Some(line) = unshown_line(r) {
        out.push_str(&format!("  {line}\n"));
    }
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
        let Some(rows) = r.baselined_by_change.get(*kind) else {
            continue;
        };
        out.push_str(&format!(
            "\n{} {what} [{kind}] this change adds and also writes into {SECURITY_LOCK} itself: it baselines them, so they fail nothing; a reviewer accepts them by approving the lock's diff\n",
            rows.len()
        ));
        rows_text(&mut out, rows, max);
    }
    if let Some(line) = newer_readings_line(r) {
        out.push_str(&format!("\n{line}\n"));
    }
    for (kind, what) in KINDS {
        let Some(rows) = r.new_in_drift.get(*kind) else {
            continue;
        };
        out.push_str(&format!(
            "\n{} {what} [{kind}], from a reading newer than the baseline\n",
            rows.len()
        ));
        rows_text(&mut out, rows, max);
    }
    for (kind, what) in KINDS {
        let Some(rows) = r.outside_change.get(*kind) else {
            continue;
        };
        let gained = if *kind == "scope-gap" {
            "the scope"
        } else {
            "the guard"
        };
        out.push_str(&format!(
            "\n{} {what} [{kind}] in files this change did not touch, lacking what they lacked before it (other entry points gained {gained}, or the gap was there already): not this change's; they fail nothing\n",
            rows.len()
        ));
        rows_text(&mut out, rows, max);
    }
    if !r.guard_unknown.is_empty() {
        out.push_str(&format!(
            "\n{} new entry point(s) whose guard Drift could not read: not checked (unknown is never a finding); they fail nothing\n",
            r.guard_unknown.len()
        ));
        for u in r.guard_unknown.iter().take(max) {
            out.push_str(&format!(
                "  {}  ({}): {}\n",
                crate::report::sanitize(&u.key, 300),
                crate::report::sanitize(&u.at, 200),
                crate::report::sanitize(&u.read, 300)
            ));
        }
        if r.guard_unknown.len() > max {
            out.push_str(&format!("  ... and {} more\n", r.guard_unknown.len() - max));
        }
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

/// The one line that says what [`Ratchet::new_in_drift`] holds; None where it holds
/// nothing. Said once, before those findings are listed, in every format that
/// shows the baseline's comparison as text.
pub fn newer_readings_line(r: &Ratchet) -> Option<String> {
    let n: usize = r.new_in_drift.values().map(Vec::len).sum();
    (n > 0).then(|| {
        format!(
            "{n} finding(s) come from readings newer than this baseline; they are listed and do not fail the check; write the baseline again to start checking them: `drift security --write-baseline`"
        )
    })
}

/// The one line that says why findings of readings newer than the baseline fail
/// ([`Ratchet::unshown`]); None where none do.
pub fn unshown_line(r: &Ratchet) -> Option<String> {
    (r.unshown > 0).then(|| {
        let why = match (&r.unshown_why, &r.since) {
            (Some(why), _) => format!(": {why}"),
            (None, Some(commit)) => format!(
                " (not found at commit {}, or in a file changed since)",
                &commit[..commit.len().min(12)]
            ),
            (None, None) => String::new(),
        };
        format!(
            "{} of them come from readings newer than this baseline and fail: Drift could not show that the code under them did not change{why}. Where they are old code, `drift upgrade --apply --security-baseline` run on the default branch records them and stamps the baseline",
            r.unshown
        )
    })
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
pub const ADVICE_HEADING: &str =
    "Security advice: what this change adds (no security baseline; this does not fail the check)";

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
        (
            "no-guard",
            "New request entry points where Drift found no guard",
        ),
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
    /// fail; one with no stamp is version 1, and a kind added since is held apart
    /// only where a commit shows it there before (review of PR 148, area 7 item 1:
    /// before, with nothing to compare with, every such finding was held).
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
        let since = Since {
            commit: "c0ffee".into(),
            found: now.keys().cloned().collect(),
            ..Since::default()
        };
        let r = compare_with(&now, &old, Some(&since));
        assert!(r.added.is_empty(), "{r:?}");
        assert_eq!(r.new_in_drift["unscoped-key"].len(), 1);
        // Nothing to compare with: not held apart (it advises, as its kind does).
        let r = compare_with(&now, &old, None);
        assert!(r.new_in_drift.is_empty(), "{r:?}");
        assert_eq!(r.advised["unscoped-key"].len(), 1);
    }

    /// Pins review of PR 148, area 7 item 1: against an unstamped baseline, with
    /// nothing that shows the code is old, a new route where Drift found no guard
    /// fails, and the run says why and what re-stamps the baseline. Before, with no
    /// diff, it was held as new in Drift and the check passed.
    #[test]
    fn a_newer_reading_is_held_only_where_a_commit_shows_it_old() {
        let old = parse_baseline("# drift security baseline\nno-guard\ta.ts#f GET /a\n");
        let mut now = Findings::new();
        now.insert(("no-guard".into(), "a.ts#f GET /a".into()), "a.ts:1".into());
        now.insert(
            ("no-guard".into(), "run.ts#POST /run POST /run".into()),
            "run.ts:2".into(),
        );
        now.insert(
            ("no-guard".into(), "old.ts#GET /o GET /o".into()),
            "old.ts:2".into(),
        );
        let mut r = compare_with(&now, &old, None);
        assert_eq!(r.kept, 1);
        assert_eq!(r.added["no-guard"].len(), 2, "{r:?}");
        assert_eq!(r.unshown, 2);
        r.unshown_why = Some("the baseline is in no commit".into());
        let line = unshown_line(&r).unwrap();
        assert!(line.contains("the baseline is in no commit"), "{line}");
        assert!(
            line.contains("`drift upgrade --apply --security-baseline` run on the default branch"),
            "{line}"
        );
        assert!(render(&r, 20).contains(&line));

        // At the commit that wrote the baseline, this Drift finds `old.ts`'s route
        // and not the one added since: only the first is held.
        let since = Since {
            commit: "c0ffee".into(),
            found: [("no-guard".to_string(), "old.ts#GET /o GET /o".to_string())]
                .into_iter()
                .collect(),
            touched: ["run.ts".to_string()].into_iter().collect(),
            ..Since::default()
        };
        let r = compare_with(&now, &old, Some(&since));
        assert_eq!(r.new_in_drift["no-guard"][0].at, "old.ts:2", "{r:?}");
        assert_eq!(r.added["no-guard"].len(), 1, "{r:?}");
        assert_eq!(r.added["no-guard"][0].at, "run.ts:2");
        assert_eq!(r.unshown, 1);
        // Found there, but its file changed since: not shown old.
        let since = Since {
            touched: ["old.ts".to_string()].into_iter().collect(),
            ..since
        };
        let r = compare_with(&now, &old, Some(&since));
        assert!(r.new_in_drift.is_empty(), "{r:?}");
        assert_eq!(r.added["no-guard"].len(), 2, "{r:?}");
    }

    fn row(path: &str, guards: &[&str]) -> EntryRow {
        EntryRow {
            path: path.into(),
            package: String::new(),
            symbol: "GET /x".into(),
            line: 1,
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some("/x".into()),
            guards: guards.iter().map(|g| g.to_string()).collect(),
            wrappers: Vec::new(),
            opaque: Vec::new(),
            authenticates: Vec::new(),
            opens: Vec::new(),
            validates: false,
            reaches: Vec::new(),
            reads: Vec::new(),
            exposure: crate::security::Exposure::Unknown,
            boundary: None,
            local: false,
            descriptions: Vec::new(),
            tied: false,
            basis: None,
            exposure_basis: None,
            known_open: false,
            verifies_signature: Vec::new(),
        }
    }

    fn eref(e: &EntryRow) -> crate::security::EntryRef {
        crate::security::EntryRef {
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
            basis: None,
            verifies_signature: Vec::new(),
        }
    }

    fn gap(exception: &EntryRow, example: &EntryRow) -> crate::security::GuardGap {
        crate::security::GuardGap {
            package: String::new(),
            kind: "http".into(),
            dir: String::new(),
            guard: "requireAdmin (middleware)".into(),
            members: 10,
            with_guard: 9,
            exceptions: vec![eref(exception)],
            unknown: Vec::new(),
            example: eref(example),
            convention: None,
        }
    }

    /// Pins review of PR 148, area 7 items 2 and 3: a guard gap in a file the change
    /// did not touch is not the change's only where its entry point read the same at
    /// the commit (other entry points gained the guard). Removing the guard from a
    /// router in another file changes what the entry point's guards are, so the gap
    /// is the change's and fails. Before, any gap outside the touched files passed.
    #[test]
    fn a_guard_gap_outside_the_change_is_not_the_changes_only_where_its_guards_held() {
        let b = parse_baseline(&render_lock(&Findings::new()));
        let users = row("admin/users.ts", &[]);
        let example = row("admin/roles.ts", &["requireAdmin (middleware)"]);
        let head = Inventory {
            entry_points: vec![users.clone(), example.clone()],
            guard_gaps: vec![gap(&users, &example)],
            ..Inventory::default()
        };
        let mut now = Findings::new();
        now.insert(
            (
                "guard-gap".into(),
                "admin/users.ts#GET /x GET /x lacks requireAdmin (middleware)".into(),
            ),
            "admin/users.ts:1".into(),
        );
        let touched = |p: &str| p == "app.ts";
        // At the commit it had the guard, through the router `app.ts` mounted.
        let base = Inventory {
            entry_points: vec![
                row("admin/users.ts", &["requireAdmin (middleware)"]),
                example.clone(),
            ],
            ..Inventory::default()
        };
        let since = Since {
            commit: "c0ffee".into(),
            outside: not_the_changes_gaps(&base, &head, &BTreeSet::new(), &touched),
            ..Since::default()
        };
        assert!(since.outside.is_empty(), "{since:?}");
        let r = compare_with(&now, &b, Some(&since));
        assert_eq!(r.added["guard-gap"].len(), 1, "{r:?}");
        // It lacked it at the commit too: other entry points gained it.
        let base = Inventory {
            entry_points: vec![users.clone(), example],
            ..Inventory::default()
        };
        let since = Since {
            outside: not_the_changes_gaps(&base, &head, &BTreeSet::new(), &touched),
            ..since
        };
        let r = compare_with(&now, &b, Some(&since));
        assert!(r.added.is_empty(), "{r:?}");
        assert_eq!(r.outside_change["guard-gap"][0].at, "admin/users.ts:1");
        // In a file the change touched it is the change's whatever it read before.
        let touched = |p: &str| p == "admin/users.ts";
        assert!(not_the_changes_gaps(&base, &head, &BTreeSet::new(), &touched).is_empty());
        // Nothing to compare with: it fails.
        let r = compare_with(&now, &b, None);
        assert_eq!(r.added["guard-gap"].len(), 1, "{r:?}");
    }

    /// Pins review of PR 148, area 7 item 4 and area 1 item 6: two branches' headers
    /// merged by `merge=union` leave two `# fail:` lines and two stamps; neither
    /// side's weakens the other's (before, the last line won). A stamp that cannot be
    /// read is said. A change's own edit of the header is not what checks it: the
    /// stricter of its header and the base's is enforced, and the edit is said.
    #[test]
    fn a_header_a_change_weakens_is_said_and_the_stricter_is_kept() {
        let merged = parse_baseline(
            "# drift security baseline\n# inventory: 2\n# fail: no-guard,risky\n# inventory: 1\n# fail: workflow\nno-guard\ta.ts#f GET /a\n",
        );
        assert_eq!(merged.version, 2);
        assert_eq!(
            merged.fail_kinds(),
            ["no-guard", "risky", "workflow"]
                .into_iter()
                .map(str::to_string)
                .collect::<BTreeSet<String>>()
        );
        let said = header_problems("# x\n# inventory: two\n# fail: a\n# fail: b\n");
        assert_eq!(said.len(), 2, "{said:?}");
        assert!(said[0].contains("cannot be read"), "{said:?}");
        assert!(said[1].contains("2 `# fail:` lines"), "{said:?}");
        assert_eq!(parse_baseline("# inventory: two\n").version, 1);

        let base = parse_baseline(&render_lock(&Findings::new()));
        let head = parse_baseline("# drift security baseline\n# fail: \n");
        assert!(!head.fails("no-guard"));
        let (kept, said) = stricter(&head, &base);
        assert_eq!(kept.version, INVENTORY_VERSION);
        assert!(kept.fails("no-guard") && kept.fails("risky"));
        assert!(!kept.fails("unscoped-key"));
        assert_eq!(said.len(), 2, "{said:?}");
        assert!(said[0].contains("takes dependency, guard-gap"), "{said:?}");
        assert!(said[1].contains("lowers `# inventory:`"), "{said:?}");
        // A header made stricter is kept as it is, and nothing is said.
        let (kept, said) = stricter(&base, &head);
        assert_eq!(kept, base);
        assert!(said.is_empty());
        assert_eq!(header_weakened(&base, &head).len(), 2);
        assert!(header_weakened(&head, &base).is_empty());
    }
}
