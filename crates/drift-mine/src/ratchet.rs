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
//! client file reaching server-only code.
//!
//! Nothing here judges a finding. A finding a person accepts is added to the
//! baseline by writing it again.

use std::collections::BTreeMap;
use std::path::Path;

use crate::security::{EntryRow, Inventory};

/// The baseline, relative to the repository root.
pub const SECURITY_LOCK: &str = ".drift/security.lock";

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
    ("risky", "risky operation(s)"),
    (
        "workflow",
        "CI workflow step(s) that run what an outsider wrote",
    ),
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
        .flat_map(|f| f.symbols.iter().map(move |s| ((f.path.as_str(), s.name.as_str()), s)))
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
    for w in &inv.workflows {
        add(
            "workflow",
            format!("{} in {} job {}: {}", w.kind, w.path, w.job, w.detail),
            &w.path,
            w.line,
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

/// The baseline as it is written: a header, then one finding a line, kind and key
/// tab-separated, sorted. Lines only ever differ by the finding they hold, so two
/// branches that each add one merge without a conflict (`merge=union`).
pub fn render_lock(found: &Findings) -> String {
    let mut out = String::from(
        "# drift security baseline: what `drift security` found when this was written.\n\
         # `drift security --ratchet` reports what is found now and is not here.\n\
         # Written by `drift security --write-baseline`; do not edit by hand.\n",
    );
    for (kind, key) in found.keys() {
        out.push_str(kind);
        out.push('\t');
        out.push_str(key);
        out.push('\n');
    }
    out
}

/// The findings a baseline file holds; lines that are no finding are skipped.
pub fn parse_lock(text: &str) -> std::collections::BTreeSet<(String, String)> {
    text.lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| l.split_once('\t'))
        .map(|(kind, key)| (kind.to_string(), key.to_string()))
        .collect()
}

/// The baseline of the repository at `root`; `None` where there is none.
pub fn load(root: &Path) -> std::io::Result<Option<std::collections::BTreeSet<(String, String)>>> {
    match std::fs::read_to_string(root.join(SECURITY_LOCK)) {
        Ok(text) => Ok(Some(parse_lock(&text))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// What a run found against a baseline.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct Ratchet {
    /// Found now and not in the baseline, by kind: the key, and where.
    pub added: BTreeMap<String, Vec<Added>>,
    /// In the baseline and no longer found: writing the baseline again drops them,
    /// so that they cannot come back unseen.
    pub gone: Vec<Gone>,
    /// How many findings the baseline holds that are still found.
    pub kept: usize,
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

/// Compares what is found now with the baseline.
pub fn compare(
    found: &Findings,
    baseline: &std::collections::BTreeSet<(String, String)>,
) -> Ratchet {
    let mut out = Ratchet::default();
    for ((kind, key), at) in found {
        if baseline.contains(&(kind.clone(), key.clone())) {
            out.kept += 1;
        } else {
            out.added.entry(kind.clone()).or_default().push(Added {
                key: key.clone(),
                at: at.clone(),
            });
        }
    }
    out.gone = baseline
        .iter()
        .filter(|k| !found.contains_key(k))
        .map(|(kind, key)| Gone {
            kind: kind.clone(),
            key: key.clone(),
        })
        .collect();
    out
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
}
