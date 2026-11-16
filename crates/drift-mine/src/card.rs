//! `drift card <path>`: one file's place in the repository, for an agent about to touch
//! it. A few hundred tokens: its package and entry points with their guards and
//! exposure, the risky operations it holds or reaches, what its siblings of the same
//! kind carry (and one to copy from), the accepted conventions that cover it, the strong
//! regularities mining found in its roles ([`Regularity`]: facts, not conventions), and
//! what Drift does not know about it. The path may be a file that does not exist yet.
//!
//! [`build`] gathers the facts ([`Card`], `drift card --json`, schema [`CARD_SCHEMA`]);
//! [`render`] writes them as the text agents read (`drift card`, MCP `drift_card`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use drift_core::RepoFacts;
use serde::Serialize;

use crate::mine::{Candidate, Evidence, MIN_ROLE_SIZE};
use crate::practices::PLACE_SHARE;
use crate::report::sanitize;
use crate::roles::{FILE_UNIT, FileKinds, Unit, View};
use crate::security::{
    APP_HOOK, EntryRow, Exposure, Inventory, LOCAL_NOTE, SinkUse, local_kind, role_dirs,
    source_line,
};

/// Version of the `drift card --json` shape ([`Card`]).
pub const CARD_SCHEMA: u32 = 1;

/// A convention that covers the file, as the caller resolved it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConventionLine {
    pub id: String,
    /// `accepted` or `proposed`.
    pub status: String,
    /// `block` or `advise`: its mode as checked.
    pub mode: String,
    pub summary: String,
    pub holders: usize,
    pub total: usize,
    pub example: String,
}

impl ConventionLine {
    pub fn blocks(&self) -> bool {
        self.mode == "block"
    }
}

/// One guard the siblings carry, and how many of them do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GuardShare {
    pub guard: String,
    pub members: usize,
}

/// A member to copy from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Example {
    pub path: String,
    pub line: u32,
    pub symbol: String,
}

/// The entry points of one kind that share a place with the file: the narrowest place
/// (directory, or the whole package) with at least [`MIN_ROLE_SIZE`] of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Siblings {
    pub kind: String,
    /// Repo-relative directory ("" for the whole package); none when fewer than
    /// [`MIN_ROLE_SIZE`] share any place with the file.
    pub dir: Option<String>,
    pub members: usize,
    /// The guards they carry (hooks the whole app runs left out), most shared first.
    pub guards: Vec<GuardShare>,
    /// A member other than the file with the most shared guard.
    pub example: Option<Example>,
}

/// One file's card ([`build`]); `drift card --json`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Card {
    pub schema: u32,
    pub path: String,
    /// Package directory ("" for the root package); for a new file, the package of the
    /// nearest files that exist.
    pub package: String,
    /// Language of the file; none when it is not in the repository yet.
    pub lang: Option<String>,
    /// The file is in the fact index.
    pub exists: bool,
    /// The file was not parsed (no stack large enough could be reserved).
    pub not_parsed: bool,
    /// Why a scan skipped the file (`too_large`, `generated`, ...); absent otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
    /// Its entry points, as `drift security --json` lists them.
    pub entry_points: Vec<EntryRow>,
    /// Risky operations written in the file.
    pub sinks: Vec<SinkUse>,
    /// Environment variables it reads, sorted.
    pub env_reads: Vec<String>,
    /// Server-only modules (or `env:NAME`) it reaches as a client file.
    pub client_leaks: Vec<String>,
    /// Per entry kind (its own, or its place's for a file with none), sorted by kind.
    pub siblings: Vec<Siblings>,
    /// The conventions covering the file, in the order to show them.
    pub conventions: Vec<ConventionLine>,
    /// The strong regularities mining found in the roles the file is in, strongest
    /// first ([`regularities`]): facts, not conventions. The same list the text card
    /// and MCP `drift_card` give an agent, so none of them is an accepted convention
    /// agents are shown; one may also be in `conventions` as a proposal (same `id`).
    pub regularities: Vec<Regularity>,
    /// What is not known about it.
    pub unknown: Vec<String>,
}

/// A regularity mining found in a role the file is in (or, for a file that does not
/// exist yet, would be in), stated as a fact: so many members of the role do it. It is
/// not a convention agents are shown, and nothing checks it: the show policy may
/// withhold its card, or no person has accepted it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Regularity {
    /// The mined card's id (`D-…`), as `drift review` and `drift review --hidden` list it.
    pub id: String,
    /// Why it is no convention agents are shown: `withheld` (the show policy, or Python
    /// proposals being off, withholds the card), `proposed` (no person has decided it)
    /// or `accepted` (a person accepted it, and its rule family is not shown to agents).
    pub status: String,
    /// The role and what its members do, as the mined card says it.
    pub summary: String,
    /// Members of the role that do it, of the members it is about.
    pub holders: usize,
    pub total: usize,
    /// A member other than the file that does it, to copy; none when none is found.
    pub example: Option<Example>,
    /// What the file's own members of the role do; none for a file that is not in the
    /// repository yet, and when the card does not say which members do it (its count
    /// is not the count of members it leaves unnamed): then nothing is said of the file.
    pub here: Option<Here>,
}

/// What a file's members of a role do about one [`Regularity`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Here {
    /// How many of them do it.
    pub follows: usize,
    /// Those that do not, by line.
    pub breaks: Vec<Member>,
}

/// A member of a role in the file.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Member {
    pub line: u32,
    pub symbol: String,
}

/// A mined card and why agents are not shown it as a convention
/// ([`Regularity::status`]).
#[derive(Debug, Clone, Copy)]
pub struct MinedCard<'a> {
    pub card: &'a Candidate,
    pub status: &'static str,
}

/// Whether a mined card is strong enough to be stated as a fact: the rule is about at
/// least [`MIN_ROLE_SIZE`] members of its role and at least [`PLACE_SHARE`] of them
/// follow it, the bar a place's dominant practice has to clear before a departure from
/// it is said ([`crate::practices::departures`]).
pub fn strong(e: &Evidence) -> bool {
    e.total >= MIN_ROLE_SIZE && e.holders as f64 >= PLACE_SHARE * e.total as f64
}

/// Whether a mined card with this evidence and rule is one the card of a file in its
/// role states: a [`strong`] one about what the role's members do. A wiring rule is
/// about a registry, not about what a member does, and is never stated; nor is a
/// promoted practice, whose role is only its place and has no members to count.
pub fn stated(evidence: &Evidence, rule: &crate::mine::Rule) -> bool {
    strong(evidence) && !rule.is_wiring() && !rule.is_practice()
}

/// The regularities to state for `rel` among `cards` (every card mining found, shown or
/// withheld): the [`strong`] ones whose role holds a unit of the file, strongest first
/// (share, then role size, then id). `kinds` is the vocabulary the cards were mined
/// with. For a file with no unit in the facts, `planned` says whether a card's role
/// would hold a file at that path (the caller knows the policy's packages), and
/// nothing is said of what the file does.
///
/// A card is left out when the file has no member the rule is about, when it is one of
/// `listed` (a convention the card already shows), and when it is weak: an agent is
/// told a regularity only as strong as a practice it would be told it departs from.
pub fn regularities(
    repo: &RepoFacts,
    kinds: &FileKinds,
    rel: &str,
    cards: &[MinedCard<'_>],
    planned: &dyn Fn(&Candidate) -> bool,
    listed: &[ConventionLine],
) -> Vec<Regularity> {
    let cards: Vec<&MinedCard> = cards
        .iter()
        .filter(|m| stated(&m.card.evidence, &m.card.rule))
        .filter(|m| listed.iter().all(|l| l.id != m.card.id))
        .collect();
    if cards.is_empty() {
        return Vec::new();
    }
    let units = crate::roles::all_units(repo, kinds);
    let paths: Vec<String> = units.iter().map(Unit::path).collect();
    let mine: Vec<usize> = (0..units.len()).filter(|&i| paths[i] == rel).collect();
    let exists = !mine.is_empty() || repo.files.iter().any(|f| f.path == rel);
    let mut out: Vec<Regularity> = Vec::new();
    for m in cards {
        let c = m.card;
        // Members the rule is about and that follow it: neither outliers nor left out.
        let apart: BTreeSet<(&str, &str)> = c
            .outliers
            .iter()
            .map(|o| (o.path.as_str(), o.symbol.as_str()))
            .chain(
                c.exempt
                    .iter()
                    .map(|e| (e.path.as_str(), e.symbol.as_str())),
            )
            .collect();
        let follows = |i: usize| {
            let u = &units[i];
            u.in_role(&c.role)
                && match u.view {
                    View::File(f) => c.rule.concerns_file(f),
                    _ => true,
                }
                && !apart.contains(&(paths[i].as_str(), u.name()))
        };
        let here = if exists {
            let mut breaks: Vec<Member> = c
                .outliers
                .iter()
                .filter(|o| o.path == rel)
                .map(|o| Member {
                    line: o.line,
                    symbol: o.symbol.clone(),
                })
                .collect();
            breaks.sort();
            breaks.dedup();
            let follows_here = mine.iter().filter(|&&i| follows(i)).count();
            // Not about this file: it has no member, or every member is left out.
            if follows_here == 0 && breaks.is_empty() {
                continue;
            }
            // Which members follow is known only when counting them this way gives the
            // card's own count: otherwise the role is stated and this file is not.
            let counted = (0..units.len()).filter(|&i| follows(i)).count();
            (counted == c.evidence.holders).then_some(Here {
                follows: follows_here,
                breaks,
            })
        } else if planned(c) {
            None
        } else {
            continue;
        };
        // The mined example, unless it is the file itself: then the first other member
        // that follows it.
        let named = c.example.split_once('#').and_then(|(path, symbol)| {
            (path != rel)
                .then(|| (0..units.len()).find(|&i| paths[i] == path && units[i].name() == symbol))
                .flatten()
        });
        let example = named
            .or_else(|| (0..units.len()).find(|&i| paths[i] != rel && follows(i)))
            .map(|i| Example {
                path: paths[i].clone(),
                line: units[i].line(),
                symbol: units[i].name().to_string(),
            });
        out.push(Regularity {
            id: c.id.clone(),
            status: m.status.to_string(),
            summary: c.summary(),
            holders: c.evidence.holders,
            total: c.evidence.total,
            example,
            here,
        });
    }
    out.sort_by(|a, b| {
        (b.holders * a.total)
            .cmp(&(a.holders * b.total))
            .then(b.total.cmp(&a.total))
            .then(a.id.cmp(&b.id))
    });
    out
}

/// Entry points, sinks, guards, conventions and regularities listed before "and N more".
const CAP: usize = 5;
/// Members of the file named in one regularity before "N more".
const NAMED: usize = 3;

/// The card's line when it knows nothing about the file.
pub const NO_ANSWER: &str = "No answer for this file: Drift knows no entry points, risky operations, siblings of its kind, accepted conventions or strong regularities for it. Read or grep it instead.";

/// The heading of the card's regularities: what they are, and what they are not.
pub const REGULARITIES_HEAD: &str =
    "Regularities here (facts, not rules; not accepted conventions, nothing checks them):";

/// The heading of the card's regularities a person accepted: conventions `drift check`
/// checks, that agents are not shown as rules while their rule family is below the
/// admission bar (`drift review --show-to-agents <id>` shows one).
pub const ACCEPTED_HEAD: &str = "Accepted conventions here (a person accepted them and `drift check` checks them; not shown to agents as rules: their rule family is below the admission bar, `drift review --show-to-agents <id>` shows one):";

/// The card for `rel`, as text. `conventions` are the accepted conventions covering it,
/// in the order to show them, `regularities` what [`regularities`] gives for it; `root`
/// lets the member to copy from be quoted.
pub fn card(
    repo: &RepoFacts,
    inv: &Inventory,
    rel: &str,
    conventions: &[ConventionLine],
    regularities: &[Regularity],
    root: Option<&Path>,
) -> String {
    let text = render(&build(repo, inv, rel, conventions, regularities), root);
    match root.and_then(|r| violations_here(repo, r, rel, conventions)) {
        Some(section) => with_section(text, &section),
        None => text,
    }
}

/// The heading of the card's new violations, each with what its rule rests on.
pub const VIOLATIONS_HEAD: &str =
    "Violations here (new: not in drift.lock, no drift-ignore), and what each rule rests on:";

/// The new violations in `rel` of the accepted conventions the card lists
/// (`listed`), each with what its rule rests on ([`crate::report::Trust`]), as a card
/// section; `None` when there are none, or the repository at `root` has no policy.
/// The policy and the lock are read from `root`, and the file checked as `drift check
/// <rel>` checks it, against the facts the card was made from. A promoted practice is
/// checked against the practice map, which the card does not read, and wiring advice
/// against files the card does not attach: neither is listed here (`drift check` lists
/// them).
fn violations_here(
    repo: &RepoFacts,
    root: &Path,
    rel: &str,
    listed: &[ConventionLine],
) -> Option<String> {
    if !listed.iter().any(|l| l.status == "accepted") {
        return None;
    }
    let policy = crate::policy::ConventionsFile::load(root).ok().flatten()?;
    let lock = crate::policy::Lock::load(root).unwrap_or_default();
    let only: BTreeSet<String> = BTreeSet::from([rel.to_string()]);
    let mut report = crate::check::check(
        repo,
        &policy,
        &lock,
        crate::check::Scope::Accepted,
        Some(&only),
    );
    crate::check::locate_imports(&mut report, root);
    let new: Vec<&crate::check::Violation> = report
        .new_violations()
        .filter(|v| v.wire.is_none() && listed.iter().any(|l| l.id == v.id))
        .collect();
    if new.is_empty() {
        return None;
    }
    let basis = crate::report::Basis::new(repo, &policy, &report);
    let section = trust_card(&new, &basis);
    (!section.is_empty()).then_some(section)
}

/// [`VIOLATIONS_HEAD`] and, for at most [`CAP`] violations, what each rule rests on in
/// the labels every other surface uses; the rest counted.
fn trust_card(new: &[&crate::check::Violation], basis: &crate::report::Basis) -> String {
    let mut out = format!("{VIOLATIONS_HEAD}\n");
    let mut shown = 0;
    for v in new {
        if shown == CAP {
            break;
        }
        let Some(t) = basis.trust(v, "") else {
            continue;
        };
        shown += 1;
        out.push_str(&format!(
            "  [{}] {} ({})\n    source: {}\n",
            t.id,
            t.rule,
            if t.blocks { "blocks" } else { "advises" },
            t.origin
        ));
        if let Some(e) = &t.evidence {
            out.push_str(&format!("    evidence: {e}\n"));
        }
        for c in &t.changed {
            out.push_str(&format!("    changed: {c}\n"));
        }
        if let Some(n) = &t.not_checked {
            out.push_str(&format!("    not checked: {n}\n"));
        }
        out.push_str(&format!("    here: {}: {}\n", t.at, t.instead));
        if !t.held.is_empty() {
            out.push_str(&format!("    holds near it: {}\n", t.held.join(", ")));
        }
        if let Some(copy) = &t.copy {
            out.push_str(&format!("    copy: {copy}\n"));
        }
        if t.blocks {
            if let Some((comment, place)) = &t.comment {
                out.push_str(&format!("    exception: add `{comment}` {place}\n"));
            }
            if let Some(cmd) = &t.mark_fine {
                out.push_str(&format!("    exception: a person runs `{cmd}`\n"));
            }
        }
        let wrong: Vec<String> = t
            .wrong_rule
            .iter()
            .map(|(cmd, what)| format!("`{cmd}` {what}"))
            .collect();
        out.push_str(&format!("    wrong rule: a person runs {}\n", wrong.join("; ")));
    }
    if shown == 0 {
        return String::new();
    }
    if new.len() > shown {
        out.push_str(&format!(
            "  and {} more: `drift check` lists them\n",
            new.len() - shown
        ));
    }
    out
}

/// The facts of the card for `rel`. `conventions` are those covering it, in the order
/// to show them; `regularities` those to state for it ([`regularities`]).
pub fn build(
    repo: &RepoFacts,
    inv: &Inventory,
    rel: &str,
    conventions: &[ConventionLine],
    regularities: &[Regularity],
) -> Card {
    let file = repo.files.iter().find(|f| f.path == rel);
    let not_parsed = repo.stack_unavailable().contains(&rel);
    let package = match file {
        Some(f) => f.package.clone(),
        // A new file: the package of the nearest files that exist.
        None => repo
            .files
            .iter()
            .filter(|f| !f.package.is_empty() && rel.starts_with(&format!("{}/", f.package)))
            .map(|f| f.package.clone())
            .max_by_key(|p| p.len())
            .unwrap_or_default(),
    };
    let mine: Vec<&EntryRow> = inv.entry_points.iter().filter(|e| e.path == rel).collect();
    let (mut env_reads, client_leaks, sinks) = match file {
        Some(f) => (
            f.symbols
                .iter()
                .flat_map(|s| s.reads.iter().cloned())
                .collect::<Vec<_>>(),
            inv.client_leaks
                .iter()
                .filter(|g| g.clients.iter().any(|c| c == rel))
                .map(|g| g.reaches.clone())
                .collect(),
            inv.sinks
                .iter()
                .filter(|s| s.path == rel)
                .cloned()
                .collect(),
        ),
        None => (Vec::new(), Vec::new(), Vec::new()),
    };
    env_reads.sort_unstable();
    env_reads.dedup();
    let skipped = repo.skipped.iter().find(|s| s.path == rel).map(|s| {
        serde_json::to_value(s.reason)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default()
    });

    // Siblings: the narrowest place with enough entry points of each kind.
    let dirs = role_dirs(&package, rel);
    let mut kinds: Vec<String> = if mine.is_empty() {
        inv.entry_points
            .iter()
            .filter(|e| e.package == package && in_dirs(&dirs, &e.package, &e.path))
            .map(|e| e.kind.clone())
            .collect()
    } else {
        mine.iter().map(|e| e.kind.clone()).collect()
    };
    kinds.sort();
    kinds.dedup();
    let siblings = kinds
        .into_iter()
        .map(|kind| siblings_of(inv, &package, rel, &dirs, kind))
        .collect();

    // What is not known.
    let mut unknown: Vec<String> = Vec::new();
    if not_parsed {
        unknown.push("what this file declares (not parsed)".to_string());
    }
    if let Some(f) = file {
        let unresolved: Vec<&str> = f
            .imports
            .iter()
            .filter_map(|i| i.module.strip_prefix("unresolved:"))
            .collect();
        if !unresolved.is_empty() {
            unknown.push(format!(
                "{} import(s) unresolved ({}{}), so what they reach is not followed",
                unresolved.len(),
                sanitize(
                    &unresolved
                        .iter()
                        .take(3)
                        .copied()
                        .collect::<Vec<_>>()
                        .join(", "),
                    200
                ),
                if unresolved.len() > 3 { ", ..." } else { "" }
            ));
        }
    }
    // Each reason exposure is unknown here, once: what the boundary says of an entry
    // point (a gateway that may route it), or that nothing covers the path.
    let reasons: BTreeSet<Option<&str>> = if mine.is_empty() {
        let (exposure, source) = inv.boundaries.of(rel);
        (exposure == Exposure::Unknown)
            .then_some(source)
            .into_iter()
            .collect()
    } else {
        mine.iter()
            .filter(|e| e.exposure == Exposure::Unknown)
            .map(|e| e.boundary.as_deref())
            .collect()
    };
    for reason in reasons {
        unknown.push(match reason {
            Some(why) => format!("exposure ({why})"),
            None => "exposure (no compose service or `security:` setting in .drift/config.yaml covers this path)"
                .to_string(),
        });
    }
    unknown.push(
        "checks inside handler bodies other than sign-in checks, and anything applied outside this repository"
            .to_string(),
    );
    Card {
        schema: CARD_SCHEMA,
        path: rel.to_string(),
        package,
        lang: file.map(|f| f.lang.clone()),
        exists: file.is_some(),
        not_parsed,
        skipped,
        entry_points: mine.into_iter().cloned().collect(),
        sinks,
        env_reads,
        client_leaks,
        siblings,
        conventions: conventions.to_vec(),
        regularities: regularities.to_vec(),
        unknown,
    }
}

/// The entry points of `kind` in the narrowest of `dirs` (deepest first, the whole
/// package last) holding at least [`MIN_ROLE_SIZE`] of them.
fn siblings_of(
    inv: &Inventory,
    package: &str,
    rel: &str,
    dirs: &[String],
    kind: String,
) -> Siblings {
    let mut found = None;
    for d in dirs.iter().rev() {
        let members: Vec<&EntryRow> = inv
            .entry_points
            .iter()
            .filter(|e| e.package == package && e.kind == kind)
            .filter(|e| d.is_empty() || role_dirs(&e.package, &e.path).contains(d))
            .collect();
        if members.len() >= MIN_ROLE_SIZE {
            found = Some((d.clone(), members));
            break;
        }
    }
    let Some((dir, members)) = found else {
        return Siblings {
            kind,
            dir: None,
            members: 0,
            guards: Vec::new(),
            example: None,
        };
    };
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for m in &members {
        let mut own: Vec<&str> = m
            .guards
            .iter()
            .map(String::as_str)
            .filter(|g| !g.ends_with(APP_HOOK))
            .collect();
        own.sort_unstable();
        own.dedup();
        for g in own {
            *counts.entry(g).or_default() += 1;
        }
    }
    let mut shares: Vec<(&str, usize)> = counts.into_iter().collect();
    shares.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    let example = shares.first().and_then(|&(top, _)| {
        members
            .iter()
            .find(|m| m.path != rel && m.guards.iter().any(|g| g == top))
            .map(|m| Example {
                path: m.path.clone(),
                line: m.line,
                symbol: m.symbol.clone(),
            })
    });
    Siblings {
        kind,
        dir: Some(dir),
        members: members.len(),
        guards: shares
            .into_iter()
            .map(|(g, n)| GuardShare {
                guard: g.to_string(),
                members: n,
            })
            .collect(),
        example,
    }
}

/// A [`Card`] as the text agents read; `root` lets the member to copy from be quoted.
pub fn render(c: &Card, root: Option<&Path>) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    // A file on disk that no parser read (`README.md`, or skipped) is not a new file, and
    // will hold no entry points: no siblings to compare.
    let on_disk = !c.exists && root.is_some_and(|r| r.join(&c.path).is_file());
    let place = if c.package.is_empty() {
        "root package".to_string()
    } else {
        format!("package {}", sanitize(&c.package, 120))
    };
    let _ = writeln!(
        out,
        "{} ({}{}{})",
        sanitize(&c.path, 160),
        place,
        c.lang
            .as_ref()
            .map(|l| format!(", {}", sanitize(l, 20)))
            .unwrap_or_default(),
        match (c.exists, c.not_parsed) {
            (false, _) if on_disk => match &c.skipped {
                Some(why) => format!(", not parsed (skipped: {})", sanitize(why, 40)),
                None => ", not a file Drift parses".to_string(),
            },
            (false, _) => ", not in the repository yet".to_string(),
            (true, true) => ", NOT PARSED: no stack large enough could be reserved".to_string(),
            _ => String::new(),
        }
    );

    if c.exists {
        if c.entry_points.is_empty() {
            let _ = writeln!(out, "Entry points: none");
        } else {
            let _ = writeln!(out, "Entry points ({}):", c.entry_points.len());
            for e in c.entry_points.iter().take(CAP) {
                let what = [e.method.as_deref(), e.route.as_deref()]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ");
                let mut bits: Vec<String> = Vec::new();
                // The inventory's own words: no remote caller, a queue, or no guard
                // found in what Drift read.
                bits.push(if e.guards.is_empty() {
                    e.has()
                } else {
                    format!("guards {}", e.guards.join(" > "))
                });
                if !e.wrappers.is_empty() {
                    bits.push(format!("wrappers {}", e.wrappers.join(" > ")));
                }
                if !e.authenticates.is_empty() {
                    bits.push(crate::practices::basis::identified(&e.authenticates));
                }
                if !e.opens.is_empty() {
                    bits.push(format!("open: {}", e.opens.join(", ")));
                }
                match e.exposure_text() {
                    Some(x) => bits.push(x),
                    // Where a local command is deployed says nothing of who runs it.
                    None if e.local => {}
                    None => bits.push("exposure unknown".to_string()),
                }
                if e.validates {
                    bits.push("validates input".to_string());
                }
                for r in e.reaches.iter().take(3) {
                    let via: Vec<&str> = r.via.iter().skip(1).map(String::as_str).collect();
                    bits.push(if via.is_empty() {
                        format!("reaches {}", r.kind)
                    } else {
                        format!("reaches {} via {}", r.kind, via.join(" -> "))
                    });
                }
                if e.reaches.len() > 3 {
                    bits.push(format!("and {} more reaches", e.reaches.len() - 3));
                }
                let _ = writeln!(
                    out,
                    "  {} [{}] {}: {}",
                    sanitize(&what, 120),
                    sanitize(&e.kind, 40),
                    sanitize(&e.symbol, 80),
                    sanitize(&bits.join("; "), 400)
                );
            }
            if c.entry_points.len() > CAP {
                let _ = writeln!(out, "  and {} more", c.entry_points.len() - CAP);
            }
        }
        // Risky operations written here.
        if !c.sinks.is_empty() {
            let sinks: Vec<String> = c
                .sinks
                .iter()
                .map(|s| format!("{} ({}:{})", s.kind, sanitize(&s.symbol, 60), s.line))
                .collect();
            let _ = writeln!(
                out,
                "Risky operations here: {}{}",
                sinks
                    .iter()
                    .take(CAP)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", "),
                if sinks.len() > CAP {
                    format!(", and {} more", sinks.len() - CAP)
                } else {
                    String::new()
                }
            );
        }
        if !c.env_reads.is_empty() {
            let _ = writeln!(
                out,
                "Env reads: {}",
                sanitize(
                    &c.env_reads
                        .iter()
                        .take(CAP)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", "),
                    300
                )
            );
        }
        if !c.client_leaks.is_empty() {
            let _ = writeln!(
                out,
                "Client file reaching server-only code or secrets: {}",
                sanitize(
                    &c.client_leaks
                        .iter()
                        .take(3)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", "),
                    300
                )
            );
        }
    }

    let siblings: &[Siblings] = if on_disk { &[] } else { &c.siblings };
    for s in siblings {
        let Some(dir) = &s.dir else {
            let _ = writeln!(
                out,
                "Siblings: fewer than {MIN_ROLE_SIZE} {} entry points share a place with this file; no shared guard to report",
                sanitize(&s.kind, 40)
            );
            continue;
        };
        let where_ = if dir.is_empty() {
            if c.package.is_empty() {
                "the repository".to_string()
            } else {
                format!("package {}", sanitize(&c.package, 120))
            }
        } else {
            format!("{}/", sanitize(dir, 160))
        };
        if s.guards.is_empty() {
            let _ = writeln!(
                out,
                "Siblings: {} {} entry points in {where_}; {}",
                s.members,
                sanitize(&s.kind, 40),
                if local_kind(&s.kind) {
                    LOCAL_NOTE
                } else if crate::security::queue_kind(&s.kind) {
                    crate::security::QUEUE_NOTE
                } else {
                    "none has a guard"
                }
            );
            continue;
        }
        let listed: Vec<String> = s
            .guards
            .iter()
            .take(CAP)
            .map(|g| format!("{} {}/{}", sanitize(&g.guard, 80), g.members, s.members))
            .collect();
        let _ = writeln!(
            out,
            "Siblings: {} {} entry points in {where_} carry {}{}",
            s.members,
            sanitize(&s.kind, 40),
            listed.join(", "),
            if s.guards.len() > CAP {
                format!(", and {} more guards", s.guards.len() - CAP)
            } else {
                String::new()
            }
        );
        if let Some(ex) = &s.example {
            let _ = writeln!(
                out,
                "  to copy: {}:{} {}",
                sanitize(&ex.path, 160),
                ex.line,
                sanitize(&ex.symbol, 80)
            );
            if let Some(src) = root.and_then(|r| source_line(r, &ex.path, ex.line)) {
                let _ = writeln!(out, "    {}", sanitize(&src, 160));
            }
        }
    }

    // Conventions.
    if !c.conventions.is_empty() {
        let _ = writeln!(out, "Conventions ({}):", c.conventions.len());
        for k in c.conventions.iter().take(CAP) {
            let _ = writeln!(
                out,
                "  [{}] {} ({}/{} follow it, {}); copy {}",
                sanitize(&k.id, 16),
                sanitize(&k.summary, 240),
                k.holders,
                k.total,
                if k.blocks() { "blocks" } else { "advises" },
                sanitize(&k.example, 160)
            );
        }
        if c.conventions.len() > CAP {
            let _ = writeln!(
                out,
                "  and {} more: `drift_rules_for` lists them",
                c.conventions.len() - CAP
            );
        }
    }

    // Regularities: what the members of the file's roles do, as facts. One a person
    // accepted is a convention `drift check` checks, not a fact nothing checks: it has
    // a heading of its own.
    for (head, accepted) in [(ACCEPTED_HEAD, true), (REGULARITIES_HEAD, false)] {
        let these: Vec<&Regularity> = c
            .regularities
            .iter()
            .filter(|r| (r.status == "accepted") == accepted)
            .collect();
        if these.is_empty() {
            continue;
        }
        let _ = writeln!(out, "{head}");
        for r in these.iter().take(CAP) {
            let _ = writeln!(out, "  {}", regularity_line(r, &c.package));
        }
        if these.len() > CAP {
            let _ = writeln!(out, "  and {} more", these.len() - CAP);
        }
    }

    // Whether any line above says something about the file.
    let known = !c.entry_points.is_empty()
        || !c.sinks.is_empty()
        || !c.env_reads.is_empty()
        || !c.client_leaks.is_empty()
        || siblings.iter().any(|s| s.dir.is_some())
        || !c.conventions.is_empty()
        || !c.regularities.is_empty();
    if !known {
        let _ = writeln!(out, "{NO_ANSWER}");
    }
    let _ = writeln!(
        out,
        "Not known: {}.",
        c.unknown
            .iter()
            .map(|u| u.as_str())
            .collect::<Vec<_>>()
            .join("; ")
    );
    out
}

/// One regularity as the card says it: the role and what its members do, how many of
/// them, a member to copy, and what the file's own members do. The summary's leading
/// `package` is left out: the card's first line names it.
fn regularity_line(r: &Regularity, package: &str) -> String {
    let summary = crate::mine::agent_summary(&r.summary);
    let summary = match summary.strip_prefix(package) {
        Some(rest) if !package.is_empty() => rest.strip_prefix(": ").unwrap_or(&summary),
        _ => &summary,
    };
    let mut line = format!("{}, {} of {}", sanitize(summary, 240), r.holders, r.total);
    match &r.example {
        // A whole file is the member: its path says all there is.
        Some(e) if e.symbol == FILE_UNIT => {
            line.push_str(&format!(" (copy {})", sanitize(&e.path, 160)));
        }
        Some(e) => line.push_str(&format!(
            " (copy {}:{} {})",
            sanitize(&e.path, 160),
            e.line,
            sanitize(&e.symbol, 80)
        )),
        None => {}
    }
    if let Some(h) = &r.here {
        let named = |ms: &[Member]| {
            let mut v: Vec<String> = ms
                .iter()
                .take(NAMED)
                .map(|m| format!("{}:{}", sanitize(&m.symbol, 80), m.line))
                .collect();
            if ms.len() > NAMED {
                v.push(format!("{} more", ms.len() - NAMED));
            }
            v.join(", ")
        };
        line.push_str(&match (h.follows, h.breaks.len()) {
            (_, 0) => "; this file: does".to_string(),
            (0, _) if h.breaks.iter().all(|m| m.symbol == FILE_UNIT) => {
                "; this file: does not".to_string()
            }
            (0, _) => format!("; this file: does not ({})", named(&h.breaks)),
            (n, _) => format!(
                "; this file: does not at {}, does at {n} other{}",
                named(&h.breaks),
                if n == 1 { "" } else { "s" }
            ),
        });
    }
    line
}

/// Whether `path` (in `package`) is under one of `dirs` (as [`role_dirs`] lists them).
fn in_dirs(dirs: &[String], package: &str, path: &str) -> bool {
    let own = role_dirs(package, path);
    dirs.iter().any(|d| own.contains(d))
}

/// `card` with the practice map's lines for the file ([`crate::practices::card_lines`])
/// as a "Practices here" section before what is not known; the card unchanged when
/// there are none.
pub fn with_practices(card: String, lines: &[String]) -> String {
    if lines.is_empty() {
        return card;
    }
    with_section(
        card,
        &format!(
            "Practices here (facts, not rules; `drift practices` has the rest):\n{}\n",
            lines.join("\n")
        ),
    )
}

/// The heading of the card's duplicate helpers.
pub const DUPLICATES_HEAD: &str =
    "Defined elsewhere too (facts, not rules; a change here does not reach the copies):";

/// Other copies of one helper named on a card line; the rest are counted.
const COPIES_LISTED: usize = 3;

/// `card` with the functions the file defines that other files define too
/// ([`crate::practices::duplicates_in`]) as a section before what is not known: the
/// function and its line, where the other copies are, and how many calls the copies
/// share. At most [`CAP`] functions; the card unchanged when there are none.
pub fn with_duplicates(card: String, duplicates: &[crate::practices::FileDuplicate]) -> String {
    if duplicates.is_empty() {
        return card;
    }
    let mut section = format!("{DUPLICATES_HEAD}\n");
    for d in duplicates.iter().take(CAP) {
        let others: Vec<String> = d
            .others
            .iter()
            .take(COPIES_LISTED)
            .map(|c| format!("{}:{}", sanitize(&c.path, 160), c.line))
            .collect();
        let more = match d.others.len().saturating_sub(COPIES_LISTED) {
            0 => String::new(),
            n => format!(" and {n} more"),
        };
        section.push_str(&format!(
            "  {}:{} is also at {}{more}; the copies share {} call(s)\n",
            sanitize(&d.name, 80),
            d.line,
            others.join(", "),
            d.shared_calls
        ));
    }
    if duplicates.len() > CAP {
        section.push_str(&format!("  and {} more\n", duplicates.len() - CAP));
    }
    with_section(card, &section)
}

/// `card` with `section` before what is not known. The section says something of the
/// file: the card is not "no answer" any more.
fn with_section(card: String, section: &str) -> String {
    let card = card.replace(&format!("{NO_ANSWER}\n"), "");
    match card.find("\nNot known: ") {
        Some(i) => format!("{}{section}{}", &card[..=i], &card[i + 1..]),
        None => format!("{card}{section}"),
    }
}

#[cfg(test)]
mod tests {
    use drift_core::{FileFacts, Symbol, SymbolKind};

    use super::*;
    use crate::mine::{MineOptions, Mined, Rule, mine};

    fn func(name: &str) -> Symbol {
        Symbol {
            name: name.into(),
            kind: SymbolKind::Function,
            exported_as: vec![name.into()],
            line: 1,
            ..Default::default()
        }
    }

    fn ts(path: &str, symbols: Vec<Symbol>) -> FileFacts {
        FileFacts {
            path: path.into(),
            hash: "0".into(),
            lang: "ts".into(),
            parse_ok: true,
            symbols,
            ..FileFacts::default()
        }
    }

    /// 40 jobs in `jobs/`, 38 named `*Job` (the show policy withholds the card: two
    /// outliers), and 20 plain helpers in `lib/`.
    fn repo() -> RepoFacts {
        let mut files = Vec::new();
        for i in 0..40 {
            let name = if i < 38 {
                format!("x{i:02}Job")
            } else {
                format!("x{i:02}Helper")
            };
            files.push(ts(&format!("jobs/m{i:02}.ts"), vec![func(&name)]));
        }
        for i in 0..20 {
            files.push(ts(&format!("lib/h{i:02}.ts"), vec![func(&format!("h{i}"))]));
        }
        let mut r = RepoFacts {
            schema_version: 1,
            files,
            skipped: vec![],
            ..Default::default()
        };
        r.normalize();
        r
    }

    /// The naming card of `jobs/`, which mining withholds.
    fn withheld_naming(mined: &Mined) -> Candidate {
        let named: Vec<&Candidate> = mined
            .withheld
            .iter()
            .map(|w| &w.candidate)
            .filter(|c| matches!(c.rule, Rule::Named { .. }) && c.role.dir == "jobs")
            .collect();
        assert_eq!(named.len(), 1, "{:#?}", mined.withheld);
        assert!(mined.candidates.iter().all(|c| c.id != named[0].id));
        named[0].clone()
    }

    fn of(repo: &RepoFacts, mined: &Mined, rel: &str, c: &Candidate) -> Vec<Regularity> {
        let cards = [MinedCard {
            card: c,
            status: "withheld",
        }];
        regularities(repo, &mined.kinds, rel, &cards, &|_| false, &[])
    }

    fn text(repo: &RepoFacts, rel: &str, regs: &[Regularity]) -> String {
        card(
            repo,
            &crate::security::inventory(repo),
            rel,
            &[],
            regs,
            None,
        )
    }

    #[test]
    fn strong_is_the_bar_of_a_place() {
        let e = |holders, total| Evidence {
            holders,
            total,
            lower_bound: 0.9,
            lift: 2.0,
            split: vec![],
            role_members: None,
            python_members: None,
        };
        assert!(strong(&e(38, 40)));
        assert!(strong(&e(8, 10)));
        assert!(strong(&e(8, 8)));
        // Under the share of a place's dominant practice, however large the role.
        assert!(!strong(&e(79, 100)));
        assert!(!strong(&e(790, 1000)));
        // A role too small to say anything of.
        assert!(!strong(&e(7, 7)));
    }

    #[test]
    fn a_withheld_card_is_stated_for_a_member_of_its_role() {
        let r = repo();
        let mined = mine(&r, &MineOptions::default());
        let c = withheld_naming(&mined);
        assert_eq!((c.evidence.holders, c.evidence.total), (38, 40));

        // A member that follows it: the example is another member.
        let regs = of(&r, &mined, "jobs/m00.ts", &c);
        assert_eq!(regs.len(), 1, "{regs:#?}");
        let g = &regs[0];
        assert_eq!(
            (g.id.as_str(), g.status.as_str()),
            (c.id.as_str(), "withheld")
        );
        assert_eq!((g.holders, g.total), (38, 40));
        assert_eq!(
            g.here,
            Some(Here {
                follows: 1,
                breaks: vec![]
            })
        );
        let example = g.example.clone().unwrap();
        assert_ne!(example.path, "jobs/m00.ts");
        assert!(example.symbol.ends_with("Job"), "{example:?}");
        let out = text(&r, "jobs/m00.ts", &regs);
        let line = format!(
            "{REGULARITIES_HEAD}\n  {}, 38 of 40 (copy {}:1 {}); this file: does\n",
            sanitize(&c.summary(), 240),
            example.path,
            example.symbol
        );
        assert!(out.contains(&line), "{out}");
        assert!(!out.contains("No answer for this file"), "{out}");
        assert!(!out.contains("Conventions ("), "{out}");

        // A member that does not.
        let regs = of(&r, &mined, "jobs/m39.ts", &c);
        assert_eq!(
            regs[0].here,
            Some(Here {
                follows: 0,
                breaks: vec![Member {
                    line: 1,
                    symbol: "x39Helper".into()
                }]
            })
        );
        let out = text(&r, "jobs/m39.ts", &regs);
        assert!(
            out.contains("; this file: does not (x39Helper:1)\n"),
            "{out}"
        );

        // A file outside the role: nothing, and the card says it knows nothing.
        let regs = of(&r, &mined, "lib/h00.ts", &c);
        assert!(regs.is_empty(), "{regs:#?}");
        let out = text(&r, "lib/h00.ts", &regs);
        assert!(!out.contains(REGULARITIES_HEAD), "{out}");
        assert!(out.contains(&format!("\n{NO_ANSWER}\n")), "{out}");
    }

    /// A regularity a person accepted is not under the heading that says nothing checks
    /// it; one still withheld or only proposed is, as before.
    #[test]
    fn an_accepted_card_is_not_called_unaccepted() {
        let r = repo();
        let mined = mine(&r, &MineOptions::default());
        let c = withheld_naming(&mined);
        for (status, accepted) in [("accepted", true), ("withheld", false), ("proposed", false)] {
            let cards = [MinedCard { card: &c, status }];
            let regs = regularities(&r, &mined.kinds, "jobs/m00.ts", &cards, &|_| false, &[]);
            assert_eq!(regs.len(), 1, "{status}");
            let out = text(&r, "jobs/m00.ts", &regs);
            assert_eq!(out.contains(ACCEPTED_HEAD), accepted, "{status}: {out}");
            assert_eq!(
                out.contains(REGULARITIES_HEAD),
                !accepted,
                "{status}: {out}"
            );
        }
    }

    #[test]
    fn a_weak_or_listed_card_is_not_stated() {
        let r = repo();
        let mined = mine(&r, &MineOptions::default());
        let c = withheld_naming(&mined);
        // The same card under the bar: 30 of 40.
        let mut weak = c.clone();
        weak.evidence.holders = 30;
        assert!(of(&r, &mined, "jobs/m00.ts", &weak).is_empty());
        // One the card already lists as a convention is not said twice.
        let listed = [ConventionLine {
            id: c.id.clone(),
            status: "accepted".into(),
            mode: "advise".into(),
            summary: c.summary(),
            holders: 38,
            total: 40,
            example: c.example.clone(),
        }];
        let cards = [MinedCard {
            card: &c,
            status: "accepted",
        }];
        let regs = regularities(&r, &mined.kinds, "jobs/m00.ts", &cards, &|_| false, &listed);
        assert!(regs.is_empty(), "{regs:#?}");
    }

    #[test]
    fn a_file_that_does_not_exist_yet_is_told_the_role_and_nothing_of_itself() {
        let r = repo();
        let mined = mine(&r, &MineOptions::default());
        let c = withheld_naming(&mined);
        let cards = [MinedCard {
            card: &c,
            status: "withheld",
        }];
        let at = |planned: bool| {
            regularities(&r, &mined.kinds, "jobs/new.ts", &cards, &|_| planned, &[])
        };
        assert!(at(false).is_empty());
        let regs = at(true);
        assert_eq!(regs.len(), 1);
        assert_eq!(regs[0].here, None);
        let out = text(&r, "jobs/new.ts", &regs);
        assert!(out.contains(REGULARITIES_HEAD), "{out}");
        assert!(out.contains(", 38 of 40 (copy jobs/"), "{out}");
        assert!(!out.contains("this file:"), "{out}");
    }

    /// The card names the members that follow by what it leaves unnamed; when that does
    /// not add up to its own count, the file is not said to follow.
    #[test]
    fn nothing_is_said_of_the_file_when_the_card_cannot_tell() {
        let r = repo();
        let mined = mine(&r, &MineOptions::default());
        let mut c = withheld_naming(&mined);
        c.evidence.holders = 37;
        let regs = of(&r, &mined, "jobs/m00.ts", &c);
        assert_eq!(regs.len(), 1);
        assert_eq!(regs[0].here, None);
        assert!(!text(&r, "jobs/m00.ts", &regs).contains("this file:"));
    }

    #[test]
    fn regularities_are_sorted_and_capped() {
        let r = repo();
        let reg = |id: &str, holders, total| Regularity {
            id: id.into(),
            status: "withheld".into(),
            summary: format!("functions in jobs/** do {id}"),
            holders,
            total,
            example: None,
            here: None,
        };
        // Strongest share first, then the larger role, then the id.
        let mined = mine(&r, &MineOptions::default());
        let base = withheld_naming(&mined);
        let variants: Vec<Candidate> = [("D-c", 36), ("D-a", 38), ("D-b", 38)]
            .into_iter()
            .map(|(id, holders)| {
                let mut c = base.clone();
                c.id = id.into();
                c.evidence.holders = holders;
                c
            })
            .collect();
        let cards: Vec<MinedCard> = variants
            .iter()
            .map(|card| MinedCard {
                card,
                status: "withheld",
            })
            .collect();
        let regs = regularities(&r, &mined.kinds, "jobs/m00.ts", &cards, &|_| false, &[]);
        let ids: Vec<&str> = regs.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, ["D-a", "D-b", "D-c"]);

        let seven: Vec<Regularity> = (0..7).map(|i| reg(&format!("D-{i}"), 9, 10)).collect();
        let out = text(&r, "jobs/m00.ts", &seven);
        let section: Vec<&str> = out
            .lines()
            .skip_while(|l| *l != REGULARITIES_HEAD)
            .skip(1)
            .take_while(|l| l.starts_with("  "))
            .collect();
        assert_eq!(section.len(), 6, "{out}");
        assert_eq!(section[0], "  functions in jobs/** do D-0, 9 of 10");
        assert_eq!(section[5], "  and 2 more");
    }

    #[test]
    fn the_line_leaves_out_the_package_and_names_what_breaks() {
        let mut g = Regularity {
            id: "D-1".into(),
            status: "withheld".into(),
            summary: "pkg/a: classes in src/** extend `Base`".into(),
            holders: 59,
            total: 62,
            example: Some(Example {
                path: "pkg/a/src/x.py".into(),
                line: 12,
                symbol: "X".into(),
            }),
            here: Some(Here {
                follows: 2,
                breaks: vec![Member {
                    line: 13,
                    symbol: "PID".into(),
                }],
            }),
        };
        assert_eq!(
            regularity_line(&g, "pkg/a"),
            "classes in src/** extend 'Base', 59 of 62 (copy pkg/a/src/x.py:12 X); this file: does not at PID:13, does at 2 others"
        );
        // Another package's name, or none, stays.
        assert!(regularity_line(&g, "pkg").starts_with("pkg/a: classes"));
        assert!(regularity_line(&g, "").starts_with("pkg/a: classes"));
        // A whole file as the member: no line, no name.
        g.example.as_mut().unwrap().symbol = FILE_UNIT.into();
        g.here = Some(Here {
            follows: 0,
            breaks: vec![Member {
                line: 1,
                symbol: FILE_UNIT.into(),
            }],
        });
        assert_eq!(
            regularity_line(&g, "pkg/a"),
            "classes in src/** extend 'Base', 59 of 62 (copy pkg/a/src/x.py); this file: does not"
        );
    }
}
