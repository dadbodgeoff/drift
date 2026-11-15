//! One-question calibration of block candidates (round 11, WS-K).
//!
//! A default-tier card is a block candidate (decision D13): it reaches agents only once a
//! person accepts it. `drift review` and the Studio ask one question per candidate, with the
//! convention, two or three members that follow it (its holders) and the members it would
//! flag: **"Are these the same kind of thing?"**
//!
//! - **Yes**: the card is accepted.
//! - **No, these are different**: the person picks the files whose flagged members are a
//!   different kind. They are written as a structural exemption, a path list
//!   ([`crate::policy::Convention::different_kind`]), which `drift check` applies
//!   deterministically ([`set_apart`]), and the card is accepted with it.
//! - **Not a convention**: the card is rejected.
//!
//! No model, no new mining: the question is built from the card and one `drift check`.
//!
//! [STRICT] Fail closed. An unanswered question changes nothing: the card stays a candidate
//! and no agent is shown it as a convention. A file set apart never covers an entry point
//! under an auth or
//! validation rule ([`auth_or_validation`]) unless the person confirmed that entry point by
//! name, apart from setting the file apart ([`crate::policy::DifferentKind::entry_points`]).

use std::collections::{BTreeMap, BTreeSet};

use drift_core::RepoFacts;
use serde::Serialize;

use crate::check::{CheckReport, Contexts};
use crate::context::RepoContext;
use crate::mine::Rule;
use crate::policy::{Convention, ConventionsFile, Status};
use crate::roles::{Unit, View, units};
use crate::tier::Tier;
use crate::verify::Member;

/// The question, as every surface asks it.
pub const QUESTION: &str = "Are these the same kind of thing?";
/// The answers, as `drift review --answer ID=<answer>` and `--json` name them.
pub const ANSWERS: [&str; 3] = ["same", "different", "not-a-convention"];
/// Holders a question shows: the example and up to two more, one per file.
pub const HOLDERS: usize = 3;
/// The `schema` of `drift review --json`, and its version.
pub const SCHEMA: &str = "drift-review-questions";
pub const SCHEMA_VERSION: u32 = 1;

/// A rule that can be about who may run code or what input it takes: any wrapper (call,
/// decorator, base class, JSX, guard and config kinds: `withAuth()`, `@UseGuards`,
/// `<RequireAuth>`), a call a member must make (`requireUser()`), a key it must pass (a
/// schema), a control (`validates`) or a call order (`auth` before `db`). [STRICT] By rule
/// kind, not by name: a wrapper named `procedure` may authenticate, so every wrapper counts.
/// Naming, layering, tests, libraries, models, packages, renders, directives, thrown
/// classes, import sources and wiring are not.
pub fn auth_or_validation(rule: &Rule) -> bool {
    matches!(
        rule,
        Rule::WrappedBy { .. }
            | Rule::Calls { .. }
            | Rule::PassesKey { .. }
            | Rule::Control { .. }
            | Rule::Before { .. }
    )
}

/// The unit is a reachable entry point: an entry kind of its own, or one by
/// [`RepoContext::is_entry_unit`] (an entry class, a handler a route refers to); a file
/// that declares any entry point [STRICT].
fn entry_point(u: &Unit, ctx: &RepoContext) -> bool {
    match u.view {
        View::Symbol(f, s) => u.entry != "-" || ctx.is_entry_unit(f, s),
        View::File(f) => !f.entry_points.is_empty(),
        View::Model(_) | View::Package(_) => false,
    }
}

/// A member a person may set apart only with a confirmation of its own: an entry point
/// under an auth or validation rule.
fn needs_confirmation(c: &Convention, u: &Unit, ctx: &RepoContext) -> bool {
    auth_or_validation(&c.rule) && entry_point(u, ctx)
}

/// Why `u`, an outlier of `c`, is exempt as set apart by a person, if it is: its file is
/// in [`Convention::different_kind`], and it is no entry point under an auth or validation
/// rule, or one the person confirmed by name.
pub(crate) fn set_apart(c: &Convention, u: &Unit, ctx: &RepoContext) -> Option<String> {
    if c.different_kind.is_empty() {
        return None;
    }
    let d = c.different_kind_at(&u.path())?;
    if needs_confirmation(c, u, ctx) && !d.entry_points.iter().any(|s| s == u.name()) {
        return None;
    }
    Some("a person set this file apart as a different kind of thing (drift review)".into())
}

/// A member the card would flag, as the question lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Flagged {
    pub symbol: String,
    pub line: u32,
    /// A reachable entry point under an auth or validation rule: setting its file apart
    /// covers it only with `--confirm-entry path#symbol` (the Studio's separate tick).
    pub needs_confirmation: bool,
    /// Baselined in `drift.lock` (a legacy outlier).
    pub legacy: bool,
}

/// The flagged members of one file: what a person sets apart, a file at a time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FlaggedFile {
    pub path: String,
    pub members: Vec<Flagged>,
}

/// One question: a block candidate, with what a person needs to answer it.
#[derive(Debug, Clone, Serialize)]
pub struct Question {
    pub id: String,
    pub summary: String,
    pub rule_kind: &'static str,
    pub family: &'static str,
    pub holders_total: usize,
    pub members: usize,
    /// The example first, then up to two more, one per file.
    pub holders: Vec<Member>,
    /// Every member the card flags now, by file (sorted by path, then line).
    pub flagged: Vec<FlaggedFile>,
    pub flagged_total: usize,
    pub auth_or_validation: bool,
    /// Files already set apart (`different_kind` in conventions.yaml).
    pub set_apart: Vec<String>,
}

/// The block candidates `drift review` asks about: proposed default-tier conventions, in
/// policy order.
pub fn candidates(policy: &ConventionsFile) -> Vec<&Convention> {
    policy
        .conventions
        .iter()
        .filter(|c| c.status == Status::Proposed && c.tier() == Tier::Default)
        .collect()
}

/// The question about each convention of `ids` (block candidates only, others are left
/// out), from the facts and `report`, a check of every convention not rejected as review
/// shows outliers (`Scope::All`).
pub fn questions(
    repo: &RepoFacts,
    policy: &ConventionsFile,
    report: &CheckReport,
    ids: &[&str],
) -> Vec<Question> {
    let wanted: Vec<&Convention> = candidates(policy)
        .into_iter()
        .filter(|c| ids.contains(&c.id.as_str()))
        .collect();
    questions_of(repo, policy, report, wanted)
}

/// [`questions`] about `wanted`, conventions of `policy` of any tier: `drift review
/// --hidden` asks it of the cards mining withheld, added to a copy of the policy as
/// proposals for the question only.
pub fn questions_of(
    repo: &RepoFacts,
    policy: &ConventionsFile,
    report: &CheckReport,
    wanted: Vec<&Convention>,
) -> Vec<Question> {
    if wanted.is_empty() {
        return Vec::new();
    }
    let all = units(repo, &policy.file_kinds);
    let every: Vec<&Convention> = policy.conventions.iter().collect();
    let contexts = Contexts::new(repo, &all, &every);
    let mut out = Vec::new();
    for c in wanted {
        let cx = contexts.of(c);
        let flagged: BTreeSet<(&str, &str)> = report
            .violations
            .iter()
            .filter(|v| v.id == c.id)
            .map(|v| (v.path.as_str(), v.symbol.as_str()))
            .collect();
        let legacy: BTreeSet<(&str, &str)> = report
            .violations
            .iter()
            .filter(|v| v.id == c.id && v.baselined)
            .map(|v| (v.path.as_str(), v.symbol.as_str()))
            .collect();
        let exempt: BTreeSet<(&str, &str)> = report
            .exempt
            .iter()
            .filter(|e| e.id == c.id)
            .map(|e| (e.path.as_str(), e.symbol.as_str()))
            .collect();
        let mut example: Option<Member> = None;
        let mut holders: Vec<Member> = Vec::new();
        let mut files: BTreeMap<String, Vec<Flagged>> = BTreeMap::new();
        let parts = c.role.parts();
        for u in &all {
            let Some(role) = parts
                .iter()
                .find(|p| u.in_convention_role(p, c.selector_version))
            else {
                continue;
            };
            let (path, name) = (u.path(), u.name().to_string());
            let key = (path.as_str(), name.as_str());
            if flagged.contains(&key) {
                files.entry(path.clone()).or_default().push(Flagged {
                    symbol: name.clone(),
                    line: u.line(),
                    needs_confirmation: needs_confirmation(c, u, cx),
                    legacy: legacy.contains(&key),
                });
                continue;
            }
            if exempt.contains(&key)
                || !c.rule.applies_in(Some(role), &u.view, cx)
                || !c.rule.holds_in(Some(role), &u.view, cx)
            {
                continue;
            }
            let m = Member {
                line: u.line(),
                symbol: name,
                path,
            };
            if example.is_none() && format!("{}#{}", m.path, m.symbol) == c.example {
                example = Some(m);
            } else {
                holders.push(m);
            }
        }
        // Violations of members no unit of the role reads now (a file-level rule's file
        // unit is in `all` too, so this is only ever a merged card's other reading): kept,
        // as flagged, so nothing a check reports is left out of the question.
        for v in report.violations.iter().filter(|v| v.id == c.id) {
            let list = files.entry(v.path.clone()).or_default();
            if !list.iter().any(|f| f.symbol == v.symbol) {
                list.push(Flagged {
                    symbol: v.symbol.clone(),
                    line: v.line,
                    // [STRICT] Unknown: as an entry point under the rule.
                    needs_confirmation: auth_or_validation(&c.rule),
                    legacy: v.baselined,
                });
            }
        }
        let mut shown = Vec::new();
        if let Some(e) = &example {
            shown.push(e.clone());
        }
        let anchor = example.clone().unwrap_or_else(|| Member {
            path: String::new(),
            symbol: String::new(),
            line: 0,
        });
        let outliers: Vec<Member> = report
            .violations
            .iter()
            .filter(|v| v.id == c.id)
            .map(|v| Member {
                path: v.path.clone(),
                symbol: v.symbol.clone(),
                line: v.line,
            })
            .collect();
        let more = crate::verify::pick_holders(&c.id, &anchor, holders, &outliers);
        shown.extend(more.into_iter().take(HOLDERS - shown.len()));
        let flagged: Vec<FlaggedFile> = files
            .into_iter()
            .map(|(path, mut members)| {
                members.sort_by(|a, b| (a.line, &a.symbol).cmp(&(b.line, &b.symbol)));
                FlaggedFile { path, members }
            })
            .collect();
        out.push(Question {
            id: c.id.clone(),
            summary: c.summary.clone(),
            rule_kind: crate::tier::rule_kind(&c.rule),
            family: crate::rank::family(&c.rule),
            holders_total: c.evidence.holders,
            members: c.evidence.role_size(),
            holders: shown,
            flagged_total: flagged.iter().map(|f| f.members.len()).sum(),
            flagged,
            auth_or_validation: auth_or_validation(&c.rule),
            set_apart: c.different_kind.iter().map(|d| d.path.clone()).collect(),
        });
    }
    out
}

/// What a "No, these are different" answer writes, once checked against the question: the
/// files to set apart, with the entry points confirmed in each.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Different {
    pub files: Vec<(String, Vec<String>)>,
    /// Flagged members the files cover once set apart.
    pub covered: Vec<String>,
    /// Entry points under an auth or validation rule in those files, not confirmed: they
    /// stay flagged [STRICT].
    pub kept: Vec<String>,
}

/// Check a "different" answer against `q`: every file must hold a flagged member of the
/// card, and every confirmed entry point (`path#symbol`) must be one that needs a
/// confirmation, in one of the files. Refused (nothing changes) otherwise.
pub fn different(q: &Question, files: &[String], confirm: &[String]) -> anyhow::Result<Different> {
    anyhow::ensure!(
        !files.is_empty(),
        "\"different\" needs the files whose flagged members are a different kind (--set-apart PATH,...)"
    );
    let by_path: BTreeMap<&str, &FlaggedFile> =
        q.flagged.iter().map(|f| (f.path.as_str(), f)).collect();
    let mut out = Different {
        files: Vec::new(),
        covered: Vec::new(),
        kept: Vec::new(),
    };
    let mut used: BTreeSet<&str> = BTreeSet::new();
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    for p in files {
        if !seen.insert(p.as_str()) {
            continue;
        }
        let Some(f) = by_path.get(p.as_str()) else {
            anyhow::bail!(
                "{p} holds no member {} flags now (`drift review --json` lists them by file)",
                q.id
            );
        };
        let mut confirmed = Vec::new();
        let mut covers = false;
        for m in &f.members {
            let key = format!("{}#{}", f.path, m.symbol);
            if !m.needs_confirmation {
                covers = true;
                out.covered.push(key);
            } else if confirm.contains(&key) {
                used.insert(confirm.iter().find(|c| **c == key).expect("contained"));
                covers = true;
                confirmed.push(m.symbol.clone());
                out.covered.push(key);
            } else {
                out.kept.push(key);
            }
        }
        // [STRICT] A file whose flagged members all stay flagged is not written: an
        // exemption that covers nothing now would only cover members added later.
        if covers {
            out.files.push((f.path.clone(), confirmed));
        }
    }
    let stray: Vec<&str> = confirm
        .iter()
        .map(String::as_str)
        .filter(|c| !used.contains(c))
        .collect();
    anyhow::ensure!(
        stray.is_empty(),
        "--confirm-entry {} is not an entry point under an auth or validation rule in a file set apart (confirm only those `drift review --json` marks needs_confirmation)",
        stray.join(",")
    );
    Ok(out)
}
