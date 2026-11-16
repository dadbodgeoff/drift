//! What a change adds to the security findings, by the keys the security baseline
//! holds them under ([`crate::ratchet`]).
//!
//! `drift check --diff-base` asks whether a finding of the code as it is now is in
//! `.drift/security.lock`; `drift security --diff-base` asks whether it was at the
//! merge base. Both answer with [`crate::ratchet::compare_with`]: here the merge
//! base's own findings stand in for the baseline ([`added`]), so a finding is the
//! change's by the same key, for every kind the baseline holds (and any kind a newer
//! reading adds, with no edit here), with the same rule for a gap exception that other
//! entry points made ([`crate::ratchet::not_the_changes_gaps`]). Two answers that
//! could disagree would let a pull request pass one and fail the other.
//!
//! A finding that only moved with a renamed file is keyed as now first
//! ([`as_now`]); a finding in a file the merge base could not parse is not compared
//! ([`set_apart_unparsed`]): unknown is never a finding.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::ratchet::{self, Added, Baseline, Findings, Since, entry_key, row_key};
use crate::report::sanitize;
use crate::security::{Inventory, Regressions};

/// Findings by `(kind, key)`, as a baseline holds them.
pub type Keys = BTreeSet<(String, String)>;

/// The kinds the practice map's units add to the findings
/// ([`crate::ratchet::add_unauthorized`], [`crate::ratchet::add_unscoped`]): where the
/// map cannot be read on one side, these are not compared.
pub const PRACTICE_MAP_KINDS: &[&str] = &["no-authorization", "unscoped-key"];

/// Findings of a kind that were not compared with the merge base, and why: a change
/// cannot be said to add them, nor to add none of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NotCompared {
    pub kind: String,
    pub why: String,
    /// The findings found now that could not be compared, where the reason is theirs
    /// (a file not parsed at the merge base). Omitted when the whole kind was not.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<Added>,
}

/// What a change adds, by kind, against the merge base ([`added`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ChangeFindings {
    /// Found now and not at the merge base (keyed as now), by kind: the key and where.
    pub added: BTreeMap<String, Vec<Added>>,
    /// Gap exceptions found now and not at the merge base, in files the change did not
    /// touch, that other entry points made ([`crate::ratchet::Ratchet::outside_change`]).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub outside_change: BTreeMap<String, Vec<Added>>,
    /// What was not compared ([`NotCompared`]). Omitted when everything was.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub not_compared: Vec<NotCompared>,
}

impl ChangeFindings {
    /// The number of findings added.
    pub fn count(&self) -> usize {
        self.added.values().map(Vec::len).sum()
    }
}

/// What `head` holds that `base` (the merge base's findings, keyed as now) does not,
/// set apart as the ratchet sets it apart: [`crate::ratchet::compare_with`] with the
/// merge base as the baseline, every kind set to fail and stamped by this inventory,
/// so nothing is advice and nothing is held as new in this Drift. `outside` is the
/// gap exceptions that are not the change's
/// ([`crate::ratchet::not_the_changes_gaps`]).
pub fn added(head: &Findings, base: &Keys, outside: &Keys) -> ChangeFindings {
    let baseline = Baseline {
        findings: base.clone(),
        version: ratchet::INVENTORY_VERSION,
        fail: Some(
            ratchet::KINDS
                .iter()
                .map(|(k, _)| (*k).to_string())
                .chain(head.keys().map(|(k, _)| k.clone()))
                .collect(),
        ),
    };
    let since = Since {
        commit: String::new(),
        found: base.clone(),
        touched: BTreeSet::new(),
        outside: outside.clone(),
    };
    let r = ratchet::compare_with(head, &baseline, Some(&since));
    ChangeFindings {
        added: r.added,
        outside_change: r.outside_change,
        not_compared: Vec::new(),
    }
}

/// The parts of a key that follow an entry point's key ([`crate::ratchet::findings`]):
/// a key that starts with an entry point's key and goes on with one of these (or
/// ends) is that entry point's.
const AFTER_ENTRY: &[&str] = &[" -> ", " lacks ", " reads ", " takes "];

/// The merge base's findings keyed as they would be now, where a file was renamed
/// (`renamed`: new path -> old path): an entry point of a renamed file is keyed as the
/// one entry point of the same handler and method there now (its route may move with
/// the file, as a file route's does), and every other path in a key is the new one.
/// So a finding that only moved with its file is not one the change adds.
pub fn as_now(
    base: &Findings,
    base_inv: &Inventory,
    head_inv: &Inventory,
    renamed: &BTreeMap<String, String>,
) -> Keys {
    if renamed.is_empty() {
        return base.keys().cloned().collect();
    }
    let old_to_new: BTreeMap<&str, &str> = renamed
        .iter()
        .map(|(new, old)| (old.as_str(), new.as_str()))
        .collect();
    // (path as now, symbol, method) -> the entry keys of that handler, on each side.
    type Handler = (String, String, Option<String>);
    let mut was: BTreeMap<Handler, Vec<String>> = BTreeMap::new();
    for e in &base_inv.entry_points {
        if let Some(new) = old_to_new.get(e.path.as_str()) {
            was.entry((new.to_string(), e.symbol.clone(), e.method.clone()))
                .or_default()
                .push(row_key(e));
        }
    }
    let mut now: BTreeMap<Handler, Vec<String>> = BTreeMap::new();
    for e in &head_inv.entry_points {
        if renamed.contains_key(&e.path) {
            now.entry((e.path.clone(), e.symbol.clone(), e.method.clone()))
                .or_default()
                .push(row_key(e));
        }
    }
    let mut moves: Vec<(String, String)> = was
        .iter()
        .filter_map(
            |(h, old)| match (old.as_slice(), now.get(h).map(Vec::as_slice)) {
                ([old], Some([new])) => Some((old.clone(), new.clone())),
                _ => None,
            },
        )
        .collect();
    // The longest first, so that `a#GET GET /x` is not read as `a#GET GET` followed by
    // a route.
    moves.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.cmp(b)));
    let mut paths: Vec<(&str, &str)> = old_to_new.into_iter().collect();
    paths.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.cmp(b)));
    base.keys()
        .map(|(kind, key)| {
            let moved = moves.iter().find_map(|(old, new)| {
                let rest = key.strip_prefix(old.as_str())?;
                (rest.is_empty() || AFTER_ENTRY.iter().any(|a| rest.starts_with(a)))
                    .then(|| format!("{new}{rest}"))
            });
            (kind.clone(), moved.unwrap_or_else(|| repath(key, &paths)))
        })
        .collect()
}

/// `key` with each old path of `paths` that stands as a word of it (at its start or
/// after a space, and followed by its end, `#`, a space or `:`) replaced by the new.
fn repath(key: &str, paths: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(key.len());
    let mut i = 0;
    while i < key.len() {
        if i == 0 || key.as_bytes()[i - 1] == b' ' {
            let rest = &key[i..];
            if let Some((old, new)) = paths.iter().find(|(old, _)| {
                rest.strip_prefix(old).is_some_and(|after| {
                    matches!(after.chars().next(), None | Some('#' | ' ' | ':'))
                })
            }) {
                out.push_str(new);
                i += old.len();
                continue;
            }
        }
        let c = key[i..].chars().next().unwrap_or(' ');
        out.push(c);
        i += c.len_utf8();
    }
    out
}

/// The path of a finding's `path:line`.
fn path_of(at: &str) -> &str {
    at.rsplit_once(':').map_or(at, |(p, _)| p)
}

/// Moves the findings added in a file the merge base could not parse (`unparsed`, by
/// the file's path there, `old_path`) to [`ChangeFindings::not_compared`]: what the
/// file held there is unknown, so they may have been there.
pub fn set_apart_unparsed(
    cf: &mut ChangeFindings,
    unparsed: &BTreeSet<String>,
    old_path: &dyn Fn(&str) -> String,
) {
    if unparsed.is_empty() {
        return;
    }
    for (kind, rows) in cf.added.iter_mut() {
        let (unknown, kept): (Vec<Added>, Vec<Added>) = std::mem::take(rows)
            .into_iter()
            .partition(|a| unparsed.contains(&old_path(path_of(&a.at))));
        *rows = kept;
        if !unknown.is_empty() {
            cf.not_compared.push(NotCompared {
                kind: kind.clone(),
                why: "its file could not be parsed at the merge base, so whether it was there is unknown".to_string(),
                rows: unknown,
            });
        }
    }
    cf.added.retain(|_, rows| !rows.is_empty());
    cf.not_compared
        .sort_by(|a, b| (&a.kind, &a.why).cmp(&(&b.kind, &b.why)));
}

/// Sets `kinds` apart as not compared, for `why`: their findings are dropped from
/// [`ChangeFindings::added`] (with one side unread, every one would look added, or
/// none would).
pub fn not_compared(cf: &mut ChangeFindings, kinds: &[&str], why: &str) {
    for kind in kinds {
        cf.added.remove(*kind);
        cf.outside_change.remove(*kind);
        cf.not_compared.push(NotCompared {
            kind: (*kind).to_string(),
            why: why.to_string(),
            rows: Vec::new(),
        });
    }
    cf.not_compared
        .sort_by(|a, b| (&a.kind, &a.why).cmp(&(&b.kind, &b.why)));
}

/// Makes `regs` ([`crate::security::regressions`], which explains a finding: the guard
/// its siblings share, one to copy, what it reaches) say only what [`added`] says the
/// change adds, so that the two never disagree: a row whose finding is not added is
/// dropped. Returns the findings added that no row of `regs` shows, by kind: those of
/// the kinds it does not explain (scope gaps, authorization, workflows, dependencies,
/// Kubernetes, rows sent whole, and any kind added later), and those it keys
/// differently (a guard taken off a route that was there, a risky operation in
/// another member of a class).
pub fn agree(
    regs: &mut Regressions,
    added: &BTreeMap<String, Vec<Added>>,
) -> BTreeMap<String, Vec<Added>> {
    let found: Keys = added
        .iter()
        .flat_map(|(k, rows)| rows.iter().map(move |a| (k.clone(), a.key.clone())))
        .collect();
    let has = |kind: &str, key: &str| found.contains(&(kind.to_string(), key.to_string()));
    let mut shown: Keys = BTreeSet::new();
    let mut show = |kind: &str, key: String| {
        if has(kind, &key) {
            shown.insert((kind.to_string(), key));
        }
    };
    regs.guard_gaps.retain(|g| {
        let e = &g.entry;
        let entry = entry_key(&e.path, &e.symbol, e.method.as_deref(), e.route.as_deref());
        let key = format!("{entry} lacks {}", g.guard);
        let keep = has("guard-gap", &key);
        if keep {
            show("guard-gap", key);
            // Its row says what it has, so no guard found is said there too.
            show("no-guard", entry);
        }
        keep
    });
    regs.unguarded_reaching.retain(|e| {
        let keys: Vec<String> = e
            .reaches
            .iter()
            .map(|r| format!("{} -> {}", row_key(e), r.kind))
            .collect();
        let keep = keys.iter().any(|k| has("unguarded-reaching", k));
        if keep {
            for k in keys {
                show("unguarded-reaching", k);
            }
            show("no-guard", row_key(e));
        }
        keep
    });
    regs.added_without_guard.retain(|e| {
        let keep = has("no-guard", &row_key(e));
        if keep {
            show("no-guard", row_key(e));
        }
        keep
    });
    let risky: Vec<&str> = added
        .get("risky")
        .map(|rows| rows.iter().map(|a| a.key.as_str()).collect())
        .unwrap_or_default();
    regs.sinks.retain(|s| {
        // A class's risky operation is keyed by the member that holds it.
        let of = format!("{} in {}#{}", s.kind, s.path, s.symbol);
        let keys: Vec<&str> = risky
            .iter()
            .copied()
            .filter(|k| {
                k.strip_prefix(of.as_str())
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with('.'))
            })
            .collect();
        for k in &keys {
            show("risky", (*k).to_string());
        }
        !keys.is_empty()
    });
    for g in &mut regs.leaks {
        g.clients
            .retain(|c| has("leak", &format!("{c} reaches {}", g.reaches)));
        for c in &g.clients {
            show("leak", format!("{c} reaches {}", g.reaches));
        }
    }
    regs.leaks.retain(|g| !g.clients.is_empty());
    added
        .iter()
        .map(|(kind, rows)| {
            (
                kind.clone(),
                rows.iter()
                    .filter(|a| !shown.contains(&(kind.clone(), a.key.clone())))
                    .cloned()
                    .collect::<Vec<_>>(),
            )
        })
        .filter(|(_, rows)| !rows.is_empty())
        .collect()
}

/// What a kind's findings are, as [`crate::ratchet::KINDS`] says; a kind it does not
/// name is said by its name.
fn what(kind: &str) -> &str {
    ratchet::KINDS
        .iter()
        .find(|(k, _)| *k == kind)
        .map_or("finding(s)", |(_, w)| w)
}

/// The kinds of `rows`, in the order [`crate::ratchet::KINDS`] reports them, then any
/// other by name.
fn in_order(rows: &BTreeMap<String, Vec<Added>>) -> Vec<(&str, &[Added])> {
    let known = ratchet::KINDS
        .iter()
        .filter_map(|(k, _)| rows.get_key_value(*k));
    let other = rows
        .iter()
        .filter(|(k, _)| !ratchet::KINDS.iter().any(|(x, _)| *x == k.as_str()));
    known
        .chain(other)
        .map(|(k, v)| (k.as_str(), v.as_slice()))
        .collect()
}

/// The heading over [`render_rest`]'s findings.
pub const REST_HEADING: &str =
    "Other findings this change adds (keyed as the security baseline holds them; facts for review)";

/// Plain text of the findings [`agree`] leaves, and of what was not compared, for
/// `drift security --diff-base`; nothing when there are none.
pub fn render_rest(rest: &BTreeMap<String, Vec<Added>>, not: &[NotCompared], max: usize) -> String {
    let mut out = String::new();
    if !rest.is_empty() {
        out.push_str(&format!("\n{REST_HEADING}\n"));
        for (kind, rows) in in_order(rest) {
            out.push_str(&format!("  {} {} [{kind}]\n", rows.len(), what(kind)));
            for a in rows.iter().take(max) {
                out.push_str(&format!(
                    "    {}  ({})\n",
                    sanitize(&a.key, 300),
                    sanitize(&a.at, 200)
                ));
            }
            if rows.len() > max {
                out.push_str(&format!("    ... and {} more\n", rows.len() - max));
            }
        }
    }
    for n in not {
        out.push_str(&format!(
            "\nNot compared [{}]: {}{}\n",
            sanitize(&n.kind, 60),
            sanitize(&n.why, 300),
            if n.rows.is_empty() {
                String::new()
            } else {
                format!(" ({} found now)", n.rows.len())
            }
        ));
        for a in n.rows.iter().take(max) {
            out.push_str(&format!(
                "  {}  ({})\n",
                sanitize(&a.key, 300),
                sanitize(&a.at, 200)
            ));
        }
    }
    out
}

/// GitHub Actions notices for the findings [`agree`] leaves, and one log line per kind
/// not compared.
pub fn github_rest(rest: &BTreeMap<String, Vec<Added>>, not: &[NotCompared]) -> String {
    use crate::report::{github_escape_data, github_escape_property};
    let mut out = String::new();
    for (kind, rows) in in_order(rest) {
        for a in rows {
            let (path, line) = a.at.rsplit_once(':').unwrap_or((a.at.as_str(), "1"));
            out.push_str(&format!(
                "::notice file={},line={},title={}::{}\n",
                github_escape_property(&sanitize(path, 300)),
                github_escape_property(line),
                github_escape_property(&format!("drift security [{kind}]")),
                github_escape_data(&format!(
                    "{}: added by this change ({}). Facts for review.",
                    sanitize(&a.key, 300),
                    what(kind)
                ))
            ));
        }
    }
    for n in not {
        out.push_str(&format!(
            "drift security: not compared [{}]: {}\n",
            sanitize(&n.kind, 60),
            github_escape_data(&sanitize(&n.why, 300))
        ));
    }
    out
}

/// The job summary's section (Markdown) for the findings [`agree`] leaves and what was
/// not compared; nothing when there are none.
pub fn summary_rest(rest: &BTreeMap<String, Vec<Added>>, not: &[NotCompared]) -> String {
    let mut out = String::new();
    if !rest.is_empty() {
        out.push_str(&format!("### {REST_HEADING}\n\n"));
        for (kind, rows) in in_order(rest) {
            for a in rows {
                out.push_str(&format!(
                    "- [{kind}] {} (`{}`)\n",
                    sanitize(&a.key, 300).replace('`', ""),
                    sanitize(&a.at, 200).replace('`', "")
                ));
            }
        }
        out.push('\n');
    }
    if !not.is_empty() {
        out.push_str("### Not compared\n\n");
        for n in not {
            out.push_str(&format!(
                "- [{}] {}\n",
                sanitize(&n.kind, 60),
                sanitize(&n.why, 300).replace('`', "")
            ));
        }
        out.push('\n');
    }
    out
}

/// The findings a change both adds to the code and writes into the baseline itself
/// ([`crate::ratchet::Ratchet::baselined_by_change`]): of `lock_added` (the lines the
/// change adds to `.drift/security.lock`), those found now (`found`) and not at the
/// merge base (`base`, keyed as now, [`as_now`]). A line written for code that was
/// there (a lock written again, `drift upgrade --apply`, a finding that moved with its
/// file) is at the merge base, so it is not one.
pub fn baselined_by_change(
    found: &Findings,
    lock_added: &Keys,
    base: &Keys,
) -> BTreeMap<String, Vec<Added>> {
    let mut out: BTreeMap<String, Vec<Added>> = BTreeMap::new();
    for ((kind, key), at) in found {
        let k = (kind.clone(), key.clone());
        if lock_added.contains(&k) && !base.contains(&k) {
            out.entry(kind.clone()).or_default().push(Added {
                key: key.clone(),
                at: at.clone(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(rows: &[(&str, &str, &str)]) -> Findings {
        rows.iter()
            .map(|(k, key, at)| ((k.to_string(), key.to_string()), at.to_string()))
            .collect()
    }

    /// A renamed file's paths are replaced only where they stand as a word of a key.
    #[test]
    fn a_key_is_moved_with_its_file_only_where_the_path_is_a_word() {
        let paths = [("a/b.ts", "c/b.ts")];
        assert_eq!(repath("eval in a/b.ts#run", &paths), "eval in c/b.ts#run");
        assert_eq!(repath("eval in a/b.tsx#run", &paths), "eval in a/b.tsx#run");
        assert_eq!(repath("x in xa/b.ts#run", &paths), "x in xa/b.ts#run");
        assert_eq!(repath("a/b.ts reaches s.ts", &paths), "c/b.ts reaches s.ts");
        assert_eq!(repath("pin in a/b.ts: n 1", &paths), "pin in c/b.ts: n 1");
    }

    /// The merge base as the baseline: what it holds is not added, every kind is
    /// compared, and nothing is advice.
    #[test]
    fn what_the_merge_base_has_is_not_added_and_every_kind_is() {
        let head = f(&[
            ("no-guard", "a.ts#GET GET /a", "a.ts:1"),
            ("unscoped-key", "a.ts#GET GET /a takes orgId", "a.ts:1"),
            ("some-new-kind", "x", "b.ts:2"),
        ]);
        let base: Keys = [("no-guard".to_string(), "a.ts#GET GET /a".to_string())].into();
        let cf = added(&head, &base, &Keys::new());
        assert_eq!(
            cf.added.keys().collect::<Vec<_>>(),
            ["some-new-kind", "unscoped-key"]
        );
        assert_eq!(cf.count(), 2);
    }

    /// Only lines new in the lock, found now and not at the merge base, are the
    /// change's own baselining.
    #[test]
    fn a_line_for_code_that_was_there_is_not_baselined_by_the_change() {
        let found = f(&[
            ("risky", "eval in a.ts#run", "a.ts:3"),
            ("risky", "eval in b.ts#old", "b.ts:3"),
        ]);
        let lock_added: Keys = [
            ("risky".to_string(), "eval in a.ts#run".to_string()),
            ("risky".to_string(), "eval in b.ts#old".to_string()),
        ]
        .into();
        let base: Keys = [("risky".to_string(), "eval in b.ts#old".to_string())].into();
        let out = baselined_by_change(&found, &lock_added, &base);
        assert_eq!(out["risky"].len(), 1);
        assert_eq!(out["risky"][0].key, "eval in a.ts#run");
    }
}
