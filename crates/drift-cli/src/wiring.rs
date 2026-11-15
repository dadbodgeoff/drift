//! The experimental `wiring` feature in the CLI: mine registry and co-change rules
//! next to the ordinary conventions, and describe what was found.
//!
//! Off unless `.drift/config.yaml` lists `experimental: [wiring]` or
//! `DRIFT_EXPERIMENTAL=wiring` is set. When off, nothing is mined, and wiring
//! conventions already in `.drift/conventions.yaml` are inert: `check`, PR mode,
//! the hooks and MCP skip them ([`gate`]) and `init` drops them. Every output is
//! then what it was before the feature existed, apart from a note on stderr.

use std::path::Path;

use drift_core::RepoFacts;
use drift_mine::cochange::{self, HistoryStatus};
use drift_mine::mine::{Candidate, Mined};
use drift_mine::policy::{ConventionsFile, DriftConfig, WIRING_FEATURE};
use drift_mine::wiring::{self, RegistryReport};
use serde_json::{Value, json};

use crate::history;

/// What wiring mining found, for the census.
pub struct WiringReport {
    pub registries: Vec<RegistryReport>,
    pub history: HistoryStatus,
    pub head: Option<String>,
    pub commits: usize,
    pub cochange_rules: usize,
}

/// Whether the wiring feature is on for the repository at `root`. Config warnings
/// (unknown keys or features) are printed on stderr once per process.
pub fn enabled(root: &Path) -> anyhow::Result<bool> {
    static WARNED: std::sync::Once = std::sync::Once::new();
    let c = DriftConfig::load(root)?;
    WARNED.call_once(|| {
        for w in &c.warnings {
            eprintln!("drift: {w}");
        }
    });
    Ok(c.enabled(WIRING_FEATURE))
}

/// With the feature off, remove wiring conventions from `policy` (in memory: the
/// file is not written) so nothing checks, reports or blocks with them. Returns how
/// many were removed; `note` says so on stderr.
pub fn gate(root: &Path, policy: &mut ConventionsFile, note: bool) -> anyhow::Result<usize> {
    let before = policy.conventions.len();
    if policy.conventions.iter().any(|c| c.rule.is_wiring()) && !enabled(root)? {
        policy.conventions.retain(|c| !c.rule.is_wiring());
    }
    let n = before - policy.conventions.len();
    if note && n > 0 {
        eprintln!("{}", off_note(n, "skipped"));
    }
    Ok(n)
}

/// `drift: 3 wiring conventions skipped: the experimental wiring feature is off (...)`.
pub fn off_note(n: usize, what: &str) -> String {
    format!(
        "drift: {n} wiring convention(s) {what}: the experimental wiring feature is off (turn it on with `experimental: [wiring]` in .drift/config.yaml or DRIFT_EXPERIMENTAL=wiring)"
    )
}

/// When the feature is on: mine wiring rules and append them to `mined` (after
/// every ordinary convention, so their ranks are unchanged), and read the key
/// files co-change rules compare into `facts`.
pub fn extend(
    root: &Path,
    facts: &mut RepoFacts,
    mined: &mut Mined,
) -> anyhow::Result<Option<WiringReport>> {
    if !enabled(root)? {
        return Ok(None);
    }
    let w = wiring::mine(facts, &mined.kinds);
    let (status, hist) = history::read(root);
    let mut co: Vec<Candidate> = Vec::new();
    let mut commits = 0;
    let mut head = None;
    if let Some(h) = &hist {
        let now = history::current_key_files(root, h);
        co = cochange::mine(h, &now, cochange::MAX_RULES);
        commits = h.commits.len();
        head = Some(h.head.clone());
        facts.key_files.extend(now);
        facts.key_files.sort();
        facts.key_files.dedup_by(|a, b| a.path == b.path);
    }
    let cochange_rules = co.len();
    mined.candidates.extend(w.candidates);
    mined.candidates.extend(co);
    Ok(Some(WiringReport {
        registries: w.registries,
        history: status,
        head,
        commits,
        cochange_rules,
    }))
}

/// The `wiring` object of `census --json`.
pub fn json(r: &WiringReport) -> Value {
    json!({
        "enabled": true,
        "params": {
            "min_coverage": wiring::MIN_COVERAGE,
            "min_members": wiring::MIN_MEMBERS,
            "min_files": wiring::MIN_FILES,
            "max_rules": wiring::MAX_WIRING_RULES,
            "cochange": {
                "min_share": cochange::MIN_SHARE,
                "min_commits": cochange::MIN_COMMITS,
                "window": cochange::WINDOW,
                "max_rules": cochange::MAX_RULES,
            },
        },
        "registries": r.registries,
        "cochange": {
            "history": r.history.as_str(),
            "head": r.head,
            "commits": r.commits,
            "rules": r.cochange_rules,
        },
    })
}

/// One summary line for the text census.
pub fn summary(r: &WiringReport) -> String {
    let proposed = r
        .registries
        .iter()
        .filter(|x| x.status == "proposed")
        .count();
    let history = match r.history {
        HistoryStatus::Read => format!("{} commits read", r.commits),
        HistoryStatus::Shallow => "shallow clone, no co-change rules".to_string(),
        HistoryStatus::Partial => "partial clone, no co-change rules".to_string(),
        HistoryStatus::NoGit => "no git history".to_string(),
        HistoryStatus::Failed => "git log failed, no co-change rules".to_string(),
        HistoryStatus::Timeout => "git log timed out, no co-change rules".to_string(),
        HistoryStatus::TooLarge => "git log output too large, no co-change rules".to_string(),
    };
    format!(
        "wiring (experimental): {} registries seen, {proposed} proposed; co-change: {history}, {} proposed",
        r.registries.len(),
        r.cochange_rules
    )
}
