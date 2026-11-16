//! Wiring regularities from the map ("every view in `app/views` is listed in
//! `urlpatterns`", "every `*.service` is in `AppModule`'s providers"), shown as
//! information with the channel name [`WIRING`].
//!
//! The wiring miner ([`crate::wiring::mine`]) computes these on every repository, but
//! only while the experimental `wiring` feature is on does anything show them; with it
//! off they were computed nowhere and shown nowhere (the structure audit counted 21 on
//! three of seven repositories, several unanimous). This module runs that computation
//! as it is, with its own thresholds ([`crate::wiring::MIN_COVERAGE`] of at least
//! [`crate::wiring::MIN_MEMBERS`] members over [`crate::wiring::MIN_FILES`] files, at most
//! [`crate::wiring::MAX_WIRING_RULES`]), and lists each regularity it finds.
//!
//! **Information, never a convention.** A rule kind exists that says it
//! (`Rule::RegisteredIn`) and `drift check` evaluates it, but only while the feature is
//! on: with it off the CLI removes wiring conventions before checking and `drift init`
//! drops them from the conventions file (one person's experiment must not become
//! everyone's check). So, with the feature off, no rule Drift checks can hold one of
//! these: each is listed as "cannot be checked yet", is never written to
//! `.drift/conventions.yaml`, never reaches the lock or an agent. What would make one
//! checkable is not a new rule kind but the owner's decision to check `registered_in`
//! without the flag ([`NEEDS`]). With the feature on, the miner proposes each itself,
//! under the id [`WiringInfo::mined_id`], and the listing says so instead.
//!
//! **Unknown is never "unregistered".** A registration site Drift could not read (a
//! file of the registry, beside it, or of its kind, whose parse failed or was skipped,
//! [`crate::declared::unread_paths`]) may hold the members that look missing: they are
//! then counted as unknown, and the sites as "not read", never as members left out.

use std::collections::BTreeSet;

use drift_core::RepoFacts;
use serde::Serialize;
use serde_json::json;

use crate::declared::{Note, unread_paths};
use crate::from_map::{MAX_OFFERED, MinedRule};
use crate::mine::Rule;
use crate::report::{MAX_PATH, sanitize};
use crate::roles::{FileKinds, RoleSelector};
use crate::wiring::{EXPORTS_SLOT, family_of};

/// The channel name of wiring regularities from the map (as [`crate::declared::DECLARED`]
/// and [`crate::from_map::LAYERING`] are of theirs). Never a [`crate::policy::Convention::from_map`]
/// value: nothing of this channel is written.
pub const WIRING: &str = "wiring";

/// What would make a wiring regularity checkable, for people.
pub const NEEDS: &str = "cannot be checked yet: Drift's `registered_in` rule checks this only while the experimental wiring feature is on (`experimental: [wiring]` in .drift/config.yaml), and checking it for everyone is the owner's decision; no new rule kind is needed";

/// Registration sites not read named per regularity.
const MAX_NAMED: usize = 3;

/// One wiring regularity: what it says, how many members are registered, which are not,
/// and what Drift could not read.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WiringInfo {
    /// `W-` and 6 hex digits of the mined id ([`wiring_id`]): never a convention id.
    pub id: String,
    /// The id the miner gives this rule with the wiring feature on.
    pub mined_id: String,
    /// The miner's summary of the rule.
    pub summary: String,
    pub role: RoleSelector,
    /// The `registered_in` rule it would be.
    pub rule: Rule,
    /// The file of the list that names the most members (empty when unknown).
    pub registry: String,
    /// 1-based line of that list (0 when unknown).
    pub line: u32,
    /// `Module() providers`, `` `urlpatterns` ``, `re-exports`.
    pub label: String,
    /// Lists that make up the registry (a family's size, or one file's lists).
    pub lists: usize,
    /// Members that need registering.
    pub members: usize,
    /// Members registered.
    pub registered: usize,
    /// Members not registered, `path#symbol`, sorted: only when every registration site
    /// was read (else they are [`WiringInfo::unknown`]).
    pub unregistered: Vec<String>,
    /// Members that look unregistered while a registration site was not read.
    pub unknown: usize,
    /// Registration sites Drift could not read.
    pub not_read: usize,
    /// The first [`MAX_NAMED`] of them, sorted.
    pub not_read_files: Vec<String>,
    /// The miner already proposes it (the feature is on): its id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub same_as_mined: Option<String>,
    /// Always false today ([`NEEDS`]).
    pub checkable: bool,
}

/// The wiring regularities of `repo`, in the wiring miner's order (strongest first).
/// `mined`: the rules Drift already has; one of the same id is marked
/// [`WiringInfo::same_as_mined`].
pub fn wiring(repo: &RepoFacts, kinds: &FileKinds, mined: &[MinedRule<'_>]) -> Vec<WiringInfo> {
    let w = crate::wiring::mine(repo, kinds);
    if w.candidates.is_empty() {
        return Vec::new();
    }
    let unread = unread_paths(repo);
    let mut out = Vec::new();
    for c in &w.candidates {
        let Rule::RegisteredIn { slot, path, .. } = &c.rule else {
            continue;
        };
        // The files that hold the registry's lists: the rule's own file, or every file
        // with a list of the family; and the fullest list's file.
        let mut sites: BTreeSet<&str> = BTreeSet::new();
        if !path.is_empty() {
            sites.insert(path.as_str());
        } else {
            for f in &repo.files {
                if f.registries
                    .iter()
                    .any(|r| family_of(&f.path, &r.slot) == *slot)
                {
                    sites.insert(f.path.as_str());
                }
            }
        }
        let (registry, line, label, lists) = match &c.wiring {
            Some(e) => (
                e.registry.path.clone(),
                e.registry.line,
                e.registry.label.clone(),
                e.lists,
            ),
            None => (String::new(), 0, crate::wiring::slot_label(slot), 0),
        };
        if !registry.is_empty() {
            sites.insert(registry.as_str());
        }
        // A site not read: one of those files, or a file beside one of them or of the
        // same file kind (another module, another urls file) that a list reaches. A
        // barrel's re-exports are its own file's only.
        let barrel = slot == EXPORTS_SLOT;
        let dirs: BTreeSet<&str> = sites.iter().map(|&p| dir_of(p)).collect();
        let site_kinds: BTreeSet<String> = sites
            .iter()
            .map(|&p| kinds.kind_of(p))
            .filter(|k| k != "*")
            .collect();
        let not_read_files: Vec<String> = unread
            .iter()
            .filter(|u| {
                sites.contains(u.as_str())
                    || (!barrel
                        && (dirs.contains(dir_of(u)) || {
                            let k = kinds.kind_of(u);
                            k != "*" && site_kinds.contains(&k)
                        }))
            })
            .cloned()
            .collect();
        let mut missing: Vec<String> = c
            .outliers
            .iter()
            .map(|o| format!("{}#{}", o.path, o.symbol))
            .collect();
        missing.sort();
        let (unregistered, unknown) = if not_read_files.is_empty() {
            (missing, 0)
        } else {
            let n = missing.len();
            (Vec::new(), n)
        };
        out.push(WiringInfo {
            id: wiring_id(&c.id),
            mined_id: c.id.clone(),
            summary: c.summary(),
            role: c.role.clone(),
            rule: c.rule.clone(),
            registry,
            line,
            label,
            lists,
            members: c.evidence.total,
            registered: c.evidence.holders,
            unregistered,
            unknown,
            not_read: not_read_files.len(),
            not_read_files: not_read_files.into_iter().take(MAX_NAMED).collect(),
            same_as_mined: mined
                .iter()
                .find(|m| m.id == c.id)
                .map(|m| m.id.to_string()),
            checkable: false,
        });
    }
    out
}

/// The id of a wiring regularity: `W-` and 6 hex digits of the miner's id for it (which
/// is of its role and rule, never of its counts). The prefix is no convention's (mined
/// and layering ids are `D-`, practices `P-`), so it can never name one; it is never
/// written.
pub fn wiring_id(mined_id: &str) -> String {
    let h = blake3::hash(format!("wiring\0{mined_id}").as_bytes());
    format!("W-{}", &h.to_hex()[..6])
}

/// The notes `drift census --from-map` lists: at most [`MAX_OFFERED`] regularities (the
/// cap layering proposals are offered under), then how many more; one the miner
/// already proposes is said to be its.
pub fn notes(infos: &[WiringInfo]) -> Vec<Note> {
    let mut out = Vec::new();
    for w in infos.iter().take(MAX_OFFERED) {
        let mut lines = vec![format!(
            "  [{}] {} (wiring, from the map): {} of {} member(s) registered in {}{}; {} registration site(s) could not be read (never reported)",
            w.id,
            sanitize(&w.summary, 240),
            w.registered,
            w.members,
            sanitize(&w.label, MAX_PATH),
            if w.registry.is_empty() {
                String::new()
            } else {
                format!(" ({})", sanitize(&w.registry, MAX_PATH))
            },
            w.not_read
        )];
        if !w.unregistered.is_empty() {
            let more = w.unregistered.len().saturating_sub(MAX_NAMED);
            lines.push(format!(
                "    not registered: {}{}",
                w.unregistered
                    .iter()
                    .take(MAX_NAMED)
                    .map(|u| sanitize(u, MAX_PATH))
                    .collect::<Vec<_>>()
                    .join(", "),
                if more > 0 {
                    format!(", and {more} more")
                } else {
                    String::new()
                }
            ));
        }
        if w.unknown > 0 {
            lines.push(format!(
                "    {} member(s) not found in a list may be registered in a file Drift could not read ({}): unknown, not unregistered",
                w.unknown,
                w.not_read_files
                    .iter()
                    .map(|u| sanitize(u, MAX_PATH))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        lines.push(match &w.same_as_mined {
            Some(id) => {
                format!("    the wiring feature is on: the miner proposes this itself as {id}")
            }
            None => format!("    {NEEDS}; listed only, never written"),
        });
        out.push(Note {
            id: w.id.clone(),
            kind: WIRING,
            lines,
            json: json!({
                "proposed": false,
                "note": "wiring",
                "kind": WIRING,
                "id": w.id,
                "checkable": w.checkable,
                "needs": NEEDS,
                "wiring": w,
            }),
        });
    }
    if infos.len() > MAX_OFFERED {
        let more = infos.len() - MAX_OFFERED;
        out.push(Note {
            id: String::new(),
            kind: WIRING,
            lines: vec![format!(
                "  and {more} more wiring regularit{} (`DRIFT_EXPERIMENTAL=wiring drift census --json` lists every registry)",
                if more == 1 { "y" } else { "ies" }
            )],
            json: json!({
                "proposed": false,
                "note": "wiring_more",
                "kind": WIRING,
                "more": more,
            }),
        });
    }
    out
}

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_never_convention_ids() {
        let id = wiring_id("D-abc123");
        assert!(id.starts_with("W-") && id.len() == 8, "{id}");
        assert_eq!(id, wiring_id("D-abc123"));
        assert_ne!(id, wiring_id("D-abc124"));
    }
}
