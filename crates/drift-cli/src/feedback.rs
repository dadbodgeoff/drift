//! `drift feedback` (stream S23): a small file a beta team can read in full and choose to
//! hand over, so the beta's two questions get numbers from people who are not the builder:
//! what share of Drift's proposals a team keeps, and what share of its reports on new code
//! are true (scoreboard numbers 2 and 3, `docs/v2/ROADMAP-MAP-TO-ENFORCEMENT.md`).
//!
//! - **`drift feedback mark`** records a person's verdict on one report: a violation, named
//!   as `drift.lock` and `drift check` name it (the convention id and the member's
//!   `path#symbol`), or a finding of `drift investigate` (`F-…`). Marks are kept in
//!   [`MARKS`] under [`DIR`] (`.drift/feedback/marks.json`), one per report (marking again
//!   replaces the verdict), with a `.gitignore` of `*` so `git add -A` never commits them.
//!   **Nothing else in Drift reads that file:** a report marked wrong is reported exactly
//!   as before. Recording an exception stays the job of `drift review --exempt` and
//!   `drift-ignore` comments; a mark only prints the command for it.
//! - **`drift feedback export`** writes one JSON document, [`FeedbackExport`], whose every
//!   field is in the allowlist below and says why it is safe. No path, symbol, package or
//!   dependency name, route, repository name or remote, author, commit hash, or time finer
//!   than the day. Ids that could carry names (a convention's id is a hash of its place,
//!   which names directories, so a guess could be tested against it) are replaced by a
//!   keyed hash (blake3, keyed with 32 random bytes made once and kept in
//!   `.drift/feedback/key`, never written to the document), as `docs/v2/PLAN.md` asks of a
//!   hosted report. Free text (a mark's `--why`) is left out unless the person passes
//!   `--include-reasons`; an exception's reason is never included. Before writing, the
//!   command prints what the file holds and what it leaves out, and the path; `--dry-run`
//!   prints the document and writes nothing.
//! - **No network.** This module uses no HTTP client, socket or network library of any
//!   kind (the workspace has none, `docs/wiki/Security-and-Privacy.md`): the document is
//!   written to a local file, and sharing it is a person's act.
//! - **Never through a link.** `.drift` and `.drift/feedback` are refused when they are
//!   symbolic links (a repository can commit `.drift -> ~`); files are written with
//!   [`drift_mine::policy::write_no_follow`].
//! - **Deterministic.** The document has no time but the day each mark was made, and every
//!   list is sorted, so two exports of the same state are byte-identical.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, bail};
use drift_core::RepoFacts;
use drift_mine::check::CheckReport;
use drift_mine::policy::{
    CONVENTIONS_FILE, Convention, ConventionsFile, LOCK_FILE, Lock, Mode, Status,
};
use drift_mine::tier;
use serde::{Deserialize, Serialize};

/// The feedback directory, under the repository root. Hooks deny agent edits to it as to
/// everything under `.drift/`.
pub const DIR: &str = ".drift/feedback";
/// The marks a person recorded, in [`DIR`].
pub const MARKS: &str = "marks.json";
/// The hashing key, in [`DIR`]: 32 random bytes as hex, made once. Never exported.
pub const KEY: &str = "key";
/// Where `drift feedback export` writes without `--out`, in [`DIR`].
pub const DEFAULT_OUT: &str = "drift-feedback.json";
/// The `schema` of the marks file, and its version.
pub const MARKS_SCHEMA: &str = "drift-feedback-marks";
pub const MARKS_VERSION: u32 = 1;
/// The `schema` of an exported document, and its version.
pub const EXPORT_SCHEMA: &str = "drift-feedback";
pub const EXPORT_VERSION: u32 = 1;
/// Longest `--why` kept, in characters.
pub const MAX_WHY: usize = 300;
/// Largest file this module reads (the marks, the key, a review-log file).
const MAX_READ: u64 = 16 * 1024 * 1024;
/// The review log's two files (`review_log.rs` `OLD` and `LOG`), oldest first.
const REVIEW_LOG_FILES: [&str; 2] = ["log.1.jsonl", "log.jsonl"];

pub const MARK_HELP: &str = "Examples:
  drift feedback mark D-37416b app/api/new/route.ts#GET --true
  drift feedback mark D-37416b app/api/ping/route.ts#GET --wrong --why \"health check, public by design\"
  drift feedback mark \"D-37416b app/api/ping/route.ts#GET\" --wrong    (a line of drift.lock, quoted)
  drift feedback mark F-1a2b3c --true                                  (a finding of drift investigate)

The mark is kept in .drift/feedback/marks.json, on this machine. Nothing in Drift reads it
but `drift feedback export`: marking a report wrong changes no verdict. To make Drift stop
reporting a member that is fine, record an exception (`drift review --exempt`, or a
`drift-ignore` comment with a reason).";

pub const EXPORT_HELP: &str = "Examples:
  drift feedback export --dry-run                print what would be written; write nothing
  drift feedback export                          write .drift/feedback/drift-feedback.json
  drift feedback export --out feedback.json
  drift feedback export --include-reasons        also the --why text of each mark (read it first)

The file holds counts, rule kinds and verdicts, with ids replaced by keyed hashes. It holds
no path, symbol, package or dependency name, route, repository name or remote, author,
commit hash, or time finer than the day. Drift sends nothing: share the file by hand if you
choose to.";

/// `drift feedback`.
#[derive(clap::Subcommand, Debug, Clone)]
pub enum FeedbackAction {
    /// Record your verdict on one report (true or wrong), in .drift/feedback/marks.json.
    /// Changes no verdict of Drift's.
    #[command(after_help = MARK_HELP)]
    Mark(MarkArgs),
    /// Write the feedback file: counts, rule kinds and verdicts, nothing that names the
    /// code. Prints what it holds first; --dry-run prints it and writes nothing.
    #[command(after_help = EXPORT_HELP)]
    Export(ExportArgs),
}

/// The arguments of `drift feedback mark`.
#[derive(clap::Args, Debug, Clone)]
pub struct MarkArgs {
    /// The convention id of the violation (`D-…`, as `drift check` prints it), or a
    /// finding's id (`F-…`, as `drift findings` lists it). A whole line of drift.lock
    /// (`<id> <path#symbol>`, quoted) works too.
    #[arg(value_name = "ID")]
    pub reference: String,
    /// The member the violation is reported on, `path#symbol`, as drift check and
    /// drift.lock name it. Not given for a finding.
    #[arg(value_name = "PATH#SYMBOL")]
    pub member: Option<String>,
    /// The report is true: the code really departs from the convention.
    #[arg(long = "true", conflicts_with = "wrong")]
    pub is_true: bool,
    /// The report is wrong: Drift misread the code, or the rule does not fit it.
    #[arg(long)]
    pub wrong: bool,
    /// Why, in your words (at most 300 characters). Exported only with
    /// `drift feedback export --include-reasons`.
    #[arg(long, value_name = "TEXT")]
    pub why: Option<String>,
}

/// The arguments of `drift feedback export`.
#[derive(clap::Args, Debug, Clone)]
pub struct ExportArgs {
    /// Where to write the document (default .drift/feedback/drift-feedback.json).
    #[arg(long, value_name = "FILE")]
    pub out: Option<PathBuf>,
    /// Print the document that would be written, and write nothing.
    #[arg(long)]
    pub dry_run: bool,
    /// Also include the text of each mark's --why. Free text can hold anything: read it
    /// before you share the file.
    #[arg(long)]
    pub include_reasons: bool,
}

// ---------- the marks file ----------

/// The marks file ([`MARKS`]): what `drift feedback mark` recorded. Local; read by
/// `drift feedback export` alone.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarksFile {
    pub schema: String,
    pub version: u32,
    /// Sorted by report, id and member; one per report.
    pub marks: Vec<Mark>,
}

/// One person's verdict on one report.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Mark {
    /// `violation` or `finding`.
    pub report: String,
    /// The convention's id (a violation) or the finding's id.
    pub id: String,
    /// `path#symbol` of a violation (the lock's key); empty for a finding.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub member: String,
    /// `true` or `wrong`.
    pub verdict: String,
    /// The person's words, if they gave any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
    /// The rule kind of the convention when it was marked (`wrapped_by:call`), or
    /// `finding:<concern>`.
    pub kind: String,
    /// The convention's tier when it was marked (`default`, `suggestion`); empty for a
    /// finding.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub tier: String,
    /// Whether the violation was in drift.lock when it was marked (legacy debt, not new
    /// code).
    #[serde(default)]
    pub baselined: bool,
    /// The day it was marked, `YYYY-MM-DD` (UTC).
    pub day: String,
}

impl Mark {
    fn key(&self) -> (&str, &str, &str) {
        (self.report.as_str(), self.id.as_str(), self.member.as_str())
    }
}

// ---------- the exported document: the allowlist ----------

/// The whole of what `drift feedback export` writes. Every field is a version, a count,
/// one of Drift's own words (a rule kind, a tier, a decision), a keyed hash, or a day;
/// free text only with `--include-reasons`. Adding a field here is adding it to the
/// allowlist: say why it is safe in its doc comment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FeedbackExport {
    /// `drift-feedback`: names the format, nothing about the repository.
    pub schema: &'static str,
    /// The version of this document's shape.
    pub schema_version: u32,
    /// Drift's release version (`0.1.0-dev`): the same for every user of a build.
    pub drift_version: &'static str,
    /// The format versions of the files the numbers come from: numbers only.
    pub formats: Formats,
    /// A keyed hash of nothing: the same for every export of this checkout and unrelated
    /// to anything in it, so whoever collects files can count teams without knowing which
    /// they are. With another key (another checkout) it differs.
    pub repository: String,
    /// Whether the marks' reasons are included (`--include-reasons`), so a reader knows
    /// whether free text is in the file.
    pub include_reasons: bool,
    /// How many source files Drift read, by its own language tag (`ts`, `tsx`, `py`):
    /// numbers only, no file is named.
    pub files_by_language: BTreeMap<String, usize>,
    /// How many files Drift skipped (too large, generated, unreadable): a number.
    pub files_not_read: usize,
    /// One row per convention in `.drift/conventions.yaml`, sorted by its hashed id.
    pub conventions: Vec<ConventionRow>,
    /// One row per report a person marked, sorted.
    pub marks: Vec<MarkRow>,
    /// The marks counted by rule kind (or `finding:<concern>`): Drift's own vocabulary.
    pub marks_by_kind: BTreeMap<String, Verdicts>,
    /// One row per recorded exception, sorted: which convention (hashed), how it was
    /// recorded, and whether a reason was given. Never the member or the reason.
    pub exceptions: Vec<ExceptionRow>,
    /// Counts from the review log (`.drift/review-log/`), when it is on.
    pub review_log: ReviewCounts,
}

/// [`FeedbackExport::formats`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Formats {
    /// `.drift/conventions.yaml`'s `version` as written in this repository: a number.
    pub conventions_file: u32,
    /// The newest conventions format this Drift writes: a number.
    pub conventions_file_newest: u32,
    /// The marks file's version ([`MARKS_VERSION`]): a number.
    pub marks_file: u32,
}

/// One convention ([`FeedbackExport::conventions`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct ConventionRow {
    /// A keyed hash of the convention's id. The id itself is an unkeyed hash of the
    /// convention's place and rule, which name directories and symbols, so a guess could
    /// be tested against it; the keyed hash cannot be tested without the key, which stays
    /// on this machine. The same hash is used in `marks` and `exceptions`, so they join.
    pub id: String,
    /// The rule kind (`wrapped_by:call`, `avoids:import`, `practice`): Drift's own
    /// vocabulary, never the rule's target (the wrapper, import or package it names).
    pub rule_kind: &'static str,
    /// `ts` or `py`: the language the tier reads.
    pub language: &'static str,
    /// How it was proposed: `mined`, `promoted_hidden` (a person promoted a card mining
    /// withheld), `promoted_practice` (`drift practices promote`), or `from_map`.
    pub proposed_by: &'static str,
    /// For `from_map`: which map (`practice`, `layering`, `manifest`, `declared`; anything else is
    /// `other`). Null otherwise.
    pub map: Option<&'static str>,
    /// `default` or `suggestion`.
    pub tier: &'static str,
    /// The person's decision: `accepted`, `declined`, or `proposed` (not decided yet).
    pub decision: &'static str,
    /// `advise` or `block`.
    pub mode: &'static str,
    /// The counts a person saw when they accepted it; null when it was never accepted, or
    /// until the first `drift init` after the acceptance keeps them.
    pub at_acceptance: Option<Counts>,
    /// The counts as of the last `drift init` (the evidence in the conventions file).
    pub at_last_init: Counts,
    /// What `drift check` reads of it now: accepted conventions only, null otherwise.
    pub now: Option<NowCounts>,
    /// How many reviewer exceptions it has (`drift review --exempt`): a number.
    pub exceptions: usize,
    /// How many files a person set apart from it as a different kind: a number.
    pub files_set_apart: usize,
}

/// A convention's evidence: numbers only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Counts {
    /// Members of its role.
    pub role_size: usize,
    /// Members that followed the rule, of `total`.
    pub holders: usize,
    /// Members the rule is about.
    pub total: usize,
}

/// What `drift check` read of an accepted convention now: numbers only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct NowCounts {
    /// Members the rule is about now (mined rules; null for a promoted practice).
    pub members: Option<usize>,
    /// Members that follow it now (mined rules; null for a promoted practice).
    pub holders: Option<usize>,
    /// Members Drift could not read to the end: "not checked", never reported.
    pub not_checked: usize,
    /// Violations listed now, legacy and suppressed ones included.
    pub reported: usize,
    /// Of those, the ones on new code: not in drift.lock, not suppressed by a comment,
    /// not held back as unsure. The reports scoreboard number 3 is about.
    pub new_reports: usize,
    /// Whether it went stale (it then advises only until a person looks).
    pub stale: bool,
}

/// One marked report ([`FeedbackExport::marks`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct MarkRow {
    /// A keyed hash of the convention's id (as [`ConventionRow::id`], so they join), or of
    /// the finding's id. The member (`path#symbol`) is never exported, hashed or not.
    pub convention: String,
    /// `violation` or `finding`.
    pub report: &'static str,
    /// The rule kind when it was marked, or `finding:<concern>` (`authn`, `authz`,
    /// `exposure`). A value that is not a short lowercase token is written as `other`.
    pub kind: String,
    /// `default` or `suggestion` when marked; null for a finding.
    pub tier: Option<&'static str>,
    /// `true` or `wrong`.
    pub verdict: &'static str,
    /// For a violation: whether it was on new code (not in drift.lock when marked).
    pub new_code: Option<bool>,
    /// The day it was marked, `YYYY-MM-DD`: no finer time.
    pub day: Option<String>,
    /// Whether the person gave a reason: a yes or no.
    pub reason_given: bool,
    /// The reason as typed, only with `--include-reasons` (free text can hold anything;
    /// the summary says so). Null otherwise.
    pub reason: Option<String>,
}

/// Verdicts counted ([`FeedbackExport::marks_by_kind`]).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Verdicts {
    /// Reports marked true.
    #[serde(rename = "true")]
    pub true_: usize,
    /// Reports marked wrong.
    pub wrong: usize,
    /// Of the true ones, those on new code.
    pub true_on_new_code: usize,
    /// Of the wrong ones, those on new code.
    pub wrong_on_new_code: usize,
}

/// One recorded exception ([`FeedbackExport::exceptions`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct ExceptionRow {
    /// A keyed hash of the convention's id (as [`ConventionRow::id`]).
    pub convention: String,
    /// How it was recorded: `review` (`drift review --exempt`), `drift_ignore` (a comment
    /// above the declaration), or `different_kind` (a file set apart).
    pub source: &'static str,
    /// Whether a reason was given: a yes or no, never the reason.
    pub reason_given: bool,
}

/// Counts from the review log ([`FeedbackExport::review_log`]): numbers by Drift's own
/// words. Events are counted, so a card shown twice counts twice.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ReviewCounts {
    /// Whether a review log was found (it is off unless a person turned it on).
    pub found: bool,
    /// Lines that could not be read (cut short, edited by hand): a number.
    pub unreadable_lines: usize,
    /// Proposal cards shown, accepted and declined, in all.
    pub total: Tally,
    /// The same by rule kind.
    pub by_kind: BTreeMap<String, Tally>,
    /// The same by how the convention was proposed (`mined`, `promoted_hidden`,
    /// `promoted_practice`, `from_map:<map>`, or `unknown` when it is no longer in the
    /// conventions file).
    pub by_channel: BTreeMap<String, Tally>,
    /// The same by where the decision was made (`cli`, `interactive`, `studio`).
    pub by_via: BTreeMap<String, Tally>,
}

/// [`ReviewCounts`]: numbers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Tally {
    pub shown: usize,
    /// Accept, block, forced block, or accept and show to agents.
    pub accepted: usize,
    /// Reject.
    pub declined: usize,
}

// ---------- the command ----------

/// `drift feedback`.
pub fn run(root: &Path, no_cache: bool, action: &FeedbackAction) -> anyhow::Result<ExitCode> {
    match action {
        FeedbackAction::Mark(a) => mark(root, a)?,
        FeedbackAction::Export(a) => export(root, no_cache, a)?,
    }
    Ok(ExitCode::SUCCESS)
}

fn mark(root: &Path, a: &MarkArgs) -> anyhow::Result<()> {
    let verdict = match (a.is_true, a.wrong) {
        (true, false) => "true",
        (false, true) => "wrong",
        _ => bail!("say whether the report is true or wrong: --true or --wrong"),
    };
    let why = match a.why.as_deref() {
        Some(w) => Some(why_text(w)?),
        None => None,
    };
    let (id, member) = split_reference(&a.reference, a.member.as_deref());
    let day = today();
    let m = if member.is_none() && id.starts_with("F-") {
        let f = crate::findings::finding(root, &id)?;
        Mark {
            report: "finding".into(),
            id: f.id.clone(),
            member: String::new(),
            verdict: verdict.into(),
            why,
            kind: format!("finding:{}", concern_word(&f.concern)),
            tier: String::new(),
            baselined: false,
            day,
        }
    } else {
        let Some(member) = member else {
            bail!(
                "name the violation by its convention id and member, as drift check and drift.lock do: `drift feedback mark {id} <path#symbol> --true|--wrong`"
            );
        };
        let member = drift_mine::policy::exception_member(&member)?;
        let policy = ConventionsFile::load(root)?
            .with_context(|| format!("no {CONVENTIONS_FILE}: run `drift init` first"))?;
        let c = policy
            .conventions
            .iter()
            .find(|c| c.id == id)
            .with_context(|| {
                format!("no convention {id} in {CONVENTIONS_FILE} (`drift review --list --all` lists them)")
            })?;
        let lock = Lock::load(root)?;
        let baselined = lock.contains(&c.id, &member);
        Mark {
            report: "violation".into(),
            id: c.id.clone(),
            member,
            verdict: verdict.into(),
            why,
            kind: tier::rule_kind(&c.rule).to_string(),
            tier: c.tier().as_str().to_string(),
            baselined,
            day,
        }
    };
    let dir = feedback_dir(root, true)?;
    let mut file = load_marks(&dir)?;
    let replaced = record(&mut file, m.clone());
    let mut text = serde_json::to_string_pretty(&file)?;
    text.push('\n');
    drift_mine::policy::write_no_follow(root, &Path::new(DIR).join(MARKS), text.as_bytes())?;
    // The key is made with the first mark, so a later dry run already hashes as the
    // export will.
    key_in(&dir, true)?;
    let what = if m.member.is_empty() {
        m.id.clone()
    } else {
        format!("{} {}", m.id, m.member)
    };
    let verb = if replaced { "Replaced the mark" } else { "Marked" };
    println!("{verb}: {what} is {verdict}. Kept in {DIR}/{MARKS}, on this machine only.");
    println!(
        "This changes no verdict: Drift reports it as before. `drift feedback export` counts it."
    );
    if verdict == "wrong" && m.report == "violation" {
        println!(
            "If the code is fine as it is, record an exception the usual way, with a reason:\n  drift review --exempt {} --member {} --reason '<why it is fine>'\nor a `// drift-ignore {}: <reason>` comment (`#` in Python) directly above the declaration.",
            // Each value is one shell word: the command is meant to be pasted.
            drift_mine::report::shell_word(&m.id),
            drift_mine::report::shell_word(&m.member),
            m.id
        );
    }
    Ok(())
}

fn export(root: &Path, no_cache: bool, a: &ExportArgs) -> anyhow::Result<()> {
    let policy = ConventionsFile::load(root)?
        .with_context(|| format!("no {CONVENTIONS_FILE}: run `drift init` first"))?;
    if let Some(out) = &a.out {
        refuse_drift_state(root, out)?;
    }
    // A dry run writes nothing, the fact cache included.
    let quiet = no_cache || a.dry_run;
    let project = crate::project::Project::open(root)?;
    let facts = project.scan(quiet)?;
    let derived = if quiet {
        None
    } else {
        crate::derived::Derived::of(crate::project::cache_dir(&project.root, false), &facts)
    };
    let map = std::cell::OnceCell::new();
    let report = project.check_with_map(&facts, None, || {
        map.get_or_init(|| {
            crate::practices::report_units_kept(&project.root, &facts, derived.as_ref())
        })
    });
    let dir = feedback_dir(root, !a.dry_run)?;
    let marks = load_marks(&dir)?;
    let (key, fresh) = match key_in(&dir, !a.dry_run)? {
        Some(k) => (k, false),
        None => (random_key()?, true),
    };
    let review = review_counts(root, &policy);
    let doc = build(
        &policy,
        Some(&facts),
        Some(&report),
        &marks.marks,
        &key,
        a.include_reasons,
        review,
    );
    let mut text = serde_json::to_string_pretty(&doc)?;
    text.push('\n');
    let shown_out = match &a.out {
        Some(p) => p.clone(),
        None => root.join(DIR).join(DEFAULT_OUT),
    };
    print!("{}", summary(&doc, &shown_out, a.dry_run, fresh));
    if a.dry_run {
        print!("{text}");
        return Ok(());
    }
    match &a.out {
        Some(p) => crate::write_out(root, p, text.as_bytes())?,
        None => drift_mine::policy::write_no_follow(
            root,
            &Path::new(DIR).join(DEFAULT_OUT),
            text.as_bytes(),
        )?,
    }
    println!(
        "Wrote {}. Nothing was sent anywhere; share the file by hand if you choose to.",
        shown_out.display()
    );
    Ok(())
}

/// Refuse an `--out` that is Drift's policy or state (`.drift/` outside [`DIR`], or
/// `drift.lock`): the export never overwrites what the hooks protect.
fn refuse_drift_state(root: &Path, out: &Path) -> anyhow::Result<()> {
    let abs = std::path::absolute(out)?;
    let root_abs = std::path::absolute(root)?;
    if let Ok(rel) = abs.strip_prefix(&root_abs)
        && (rel == Path::new(LOCK_FILE) || (rel.starts_with(".drift") && !rel.starts_with(DIR)))
    {
        bail!(
            "{} is Drift's policy or state; write the feedback file somewhere else (default {DIR}/{DEFAULT_OUT})",
            out.display()
        );
    }
    Ok(())
}

/// The document for `policy`, the facts and the check report of the repository (either
/// may be absent: their fields are then empty or null), the marks, and the key.
pub fn build(
    policy: &ConventionsFile,
    facts: Option<&RepoFacts>,
    report: Option<&CheckReport>,
    marks: &[Mark],
    key: &[u8; 32],
    include_reasons: bool,
    review_log: ReviewCounts,
) -> FeedbackExport {
    let h = |what: &str, text: &str| hashed(key, what, text);
    let mut files_by_language = BTreeMap::new();
    let mut files_not_read = 0;
    if let Some(f) = facts {
        for file in &f.files {
            *files_by_language
                .entry(token(&file.lang, 8).unwrap_or("other").to_string())
                .or_insert(0usize) += 1;
        }
        files_not_read = f.skipped.len();
    }

    let mut conventions = Vec::new();
    let mut exceptions = Vec::new();
    for c in &policy.conventions {
        let (proposed_by, map) = proposed_by(c);
        let e = &c.evidence;
        let now = match report {
            Some(r) if c.status == Status::Accepted => Some(now_counts(r, &c.id)),
            _ => None,
        };
        conventions.push(ConventionRow {
            id: h("convention", &c.id),
            rule_kind: tier::rule_kind(&c.rule),
            language: tier::language_code(c.language()),
            proposed_by,
            map,
            tier: c.tier().as_str(),
            decision: decision_word(c.status),
            mode: mode_word(c.mode),
            at_acceptance: c.accepted_evidence.as_ref().map(|a| Counts {
                role_size: a.role_size,
                holders: a.holders,
                total: a.total,
            }),
            at_last_init: Counts {
                role_size: e.role_size(),
                holders: e.holders,
                total: e.total,
            },
            now,
            exceptions: c.exceptions.len(),
            files_set_apart: c.different_kind.len(),
        });
        for x in &c.exceptions {
            exceptions.push(ExceptionRow {
                convention: h("convention", &c.id),
                source: "review",
                reason_given: !x.reason.trim().is_empty(),
            });
        }
        for _ in &c.different_kind {
            exceptions.push(ExceptionRow {
                convention: h("convention", &c.id),
                source: "different_kind",
                reason_given: false,
            });
        }
    }
    if let Some(r) = report {
        // A `drift-ignore` comment suppresses only with a reason.
        for v in r.violations.iter().filter(|v| v.suppressed) {
            exceptions.push(ExceptionRow {
                convention: h("convention", &v.id),
                source: "drift_ignore",
                reason_given: true,
            });
        }
    }
    conventions.sort();
    exceptions.sort();

    let mut rows = Vec::new();
    let mut marks_by_kind: BTreeMap<String, Verdicts> = BTreeMap::new();
    for m in marks {
        let finding = m.report == "finding";
        let verdict = if m.verdict == "wrong" { "wrong" } else { "true" };
        let kind = mark_kind(&m.kind);
        let new_code = (!finding).then_some(!m.baselined);
        let t = marks_by_kind.entry(kind.clone()).or_default();
        let on_new = new_code == Some(true);
        if verdict == "true" {
            t.true_ += 1;
            t.true_on_new_code += usize::from(on_new);
        } else {
            t.wrong += 1;
            t.wrong_on_new_code += usize::from(on_new);
        }
        rows.push(MarkRow {
            convention: if finding {
                h("finding", &m.id)
            } else {
                h("convention", &m.id)
            },
            report: if finding { "finding" } else { "violation" },
            kind,
            tier: match m.tier.as_str() {
                "default" => Some("default"),
                "suggestion" => Some("suggestion"),
                _ => None,
            },
            verdict,
            new_code,
            day: is_day(&m.day).then(|| m.day.clone()),
            reason_given: m.why.as_deref().is_some_and(|w| !w.trim().is_empty()),
            reason: if include_reasons { m.why.clone() } else { None },
        });
    }
    rows.sort();

    FeedbackExport {
        schema: EXPORT_SCHEMA,
        schema_version: EXPORT_VERSION,
        drift_version: env!("CARGO_PKG_VERSION"),
        formats: Formats {
            conventions_file: policy.version,
            conventions_file_newest: drift_mine::policy::POLICY_VERSION,
            marks_file: MARKS_VERSION,
        },
        repository: h("repository", ""),
        include_reasons,
        files_by_language,
        files_not_read,
        conventions,
        marks: rows,
        marks_by_kind,
        exceptions,
        review_log,
    }
}

fn now_counts(r: &CheckReport, id: &str) -> NowCounts {
    let standing = r.standing.iter().find(|s| s.id == id);
    let practice_not_checked = r
        .practices_not_checked
        .iter()
        .filter(|n| n.id == id)
        .map(|n| n.units)
        .sum::<usize>();
    let vs: Vec<_> = r.violations.iter().filter(|v| v.id == id).collect();
    NowCounts {
        members: standing.map(|s| s.members),
        holders: standing.map(|s| s.holders),
        not_checked: standing.map_or(0, |s| s.not_checked) + practice_not_checked,
        reported: vs.len(),
        new_reports: vs
            .iter()
            .filter(|v| !v.baselined && !v.suppressed && !v.unsure && !v.suppressed_neighbour)
            .count(),
        stale: standing.is_some_and(|s| s.stale.is_some())
            || r.stale_practices.iter().any(|s| s.id == id),
    }
}

/// How `c` was proposed, and from which map.
fn proposed_by(c: &Convention) -> (&'static str, Option<&'static str>) {
    if let Some(m) = &c.from_map {
        let map = match m.as_str() {
            "practice" => "practice",
            "layering" => "layering",
            "manifest" => "manifest",
            "declared" => "declared",
            _ => "other",
        };
        ("from_map", Some(map))
    } else if c.promoted_from_practice.is_some() {
        ("promoted_practice", None)
    } else if c.promoted_from_hidden {
        ("promoted_hidden", None)
    } else {
        ("mined", None)
    }
}

fn decision_word(s: Status) -> &'static str {
    match s {
        Status::Accepted => "accepted",
        Status::Rejected => "declined",
        Status::Proposed => "proposed",
    }
}

fn mode_word(m: Mode) -> &'static str {
    match m {
        Mode::Advise => "advise",
        Mode::Block => "block",
    }
}

/// A finding's concern as exported: one of Drift's three, else `other`.
fn concern_word(c: &str) -> &'static str {
    match c {
        "authn" => "authn",
        "authz" => "authz",
        "exposure" => "exposure",
        _ => "other",
    }
}

/// A mark's kind as exported: a short lowercase token (a rule kind, `finding:<concern>`),
/// else `other` (the marks file is local and can be edited by hand).
fn mark_kind(k: &str) -> String {
    token(k, 48).unwrap_or("other").to_string()
}

/// `s` when it is a short token of Drift's vocabulary: lowercase ASCII letters, digits,
/// `_` and `:`, at most `max` bytes.
fn token(s: &str, max: usize) -> Option<&str> {
    (!s.is_empty()
        && s.len() <= max
        && s
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b':'))
    .then_some(s)
}

fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}

/// The review log's counts, read from its files as `drift review` wrote them. Only
/// Drift's words are kept: the decision, the rule kind, where it was made, and how the
/// convention was proposed (joined by id with the conventions file).
pub fn review_counts(root: &Path, policy: &ConventionsFile) -> ReviewCounts {
    let dir = root.join(crate::review_log::DIR);
    let channel: BTreeMap<&str, String> = policy
        .conventions
        .iter()
        .map(|c| {
            let ch = match proposed_by(c) {
                (by, Some(map)) => format!("{by}:{map}"),
                (by, None) => by.to_string(),
            };
            (c.id.as_str(), ch)
        })
        .collect();
    let mut out = ReviewCounts::default();
    if std::fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
        return out;
    }
    for name in REVIEW_LOG_FILES {
        let Ok(Some(text)) = read_small(&dir.join(name)) else {
            continue;
        };
        out.found = true;
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let Ok(serde_json::Value::Object(e)) = serde_json::from_str::<serde_json::Value>(line)
            else {
                out.unreadable_lines += 1;
                continue;
            };
            let s = |k: &str| e.get(k).and_then(|v| v.as_str()).unwrap_or_default();
            // 0 shown, 1 accepted, 2 declined.
            let what = match (s("event"), s("decision")) {
                ("shown", _) => 0,
                ("decision", "accept" | "block" | "force_block" | "show_to_agents") => 1,
                ("decision", "reject") => 2,
                _ => continue,
            };
            let kind = token(s("rule_kind"), 48).unwrap_or("other").to_string();
            let via = match s("via") {
                "cli" => "cli",
                "interactive" => "interactive",
                "studio" => "studio",
                _ => "other",
            }
            .to_string();
            let ch = if e.contains_key("hidden") {
                "promoted_hidden".to_string()
            } else {
                channel
                    .get(s("id"))
                    .cloned()
                    .unwrap_or_else(|| "unknown".to_string())
            };
            for t in [
                &mut out.total,
                out.by_kind.entry(kind).or_default(),
                out.by_channel.entry(ch).or_default(),
                out.by_via.entry(via).or_default(),
            ] {
                match what {
                    0 => t.shown += 1,
                    1 => t.accepted += 1,
                    _ => t.declined += 1,
                }
            }
        }
    }
    out
}

/// What the file holds and what it leaves out, in plain words, and where it goes.
pub fn summary(doc: &FeedbackExport, out: &Path, dry_run: bool, fresh_key: bool) -> String {
    let accepted = doc
        .conventions
        .iter()
        .filter(|c| c.decision == "accepted")
        .count();
    let declined = doc
        .conventions
        .iter()
        .filter(|c| c.decision == "declined")
        .count();
    let files: usize = doc.files_by_language.values().sum();
    let mut s = String::new();
    s.push_str("drift feedback: the file holds this, and nothing else:\n");
    s.push_str("  - Drift's version and the version of each file format\n");
    s.push_str(&format!(
        "  - how many files of each language Drift read ({files} in all) and skipped: numbers only\n"
    ));
    s.push_str(&format!(
        "  - {} conventions ({accepted} accepted, {declined} declined, {} still proposed): for each, a keyed hash of its id, its rule kind (never what the rule names), how it was proposed, its tier, mode, the decision, its counts at acceptance and now, and how many members were not checked\n",
        doc.conventions.len(),
        doc.conventions.len() - accepted - declined,
    ));
    s.push_str(&format!(
        "  - {} marked reports: for each, a keyed hash of its convention, the verdict, its rule kind, whether it is on new code, and the day it was marked\n",
        doc.marks.len()
    ));
    if doc.include_reasons {
        s.push_str("  - the reasons given with the marks, as typed (--include-reasons): free text can hold anything; read them before you share the file\n");
    }
    s.push_str(&format!(
        "  - {} recorded exceptions: for each, a keyed hash of its convention and whether a reason was given (never the reason)\n",
        doc.exceptions.len()
    ));
    if doc.review_log.found {
        s.push_str(&format!(
            "  - from the review log: {} cards shown, {} accepted, {} declined, by rule kind and by channel\n",
            doc.review_log.total.shown, doc.review_log.total.accepted, doc.review_log.total.declined
        ));
    } else {
        s.push_str(
            "  - no review log was found (it is off unless turned on), so no review counts\n",
        );
    }
    s.push_str("It leaves out: every path, symbol, package and dependency name, route, the repository's name and remote, authors, commit hashes, times finer than the day, the members of marks and exceptions, and the reasons of exceptions");
    if !doc.include_reasons {
        s.push_str(", and the reasons of marks (--include-reasons adds those)");
    }
    s.push_str(".\n");
    s.push_str(&format!(
        "Ids are replaced by keyed hashes. The key is in {DIR}/{KEY}, stays on this machine, and is never written to the file.\n"
    ));
    if fresh_key {
        s.push_str("No key exists yet: this dry run used a key made for it alone, so its hashes will differ from the real export's.\n");
    }
    s.push_str("Drift opens no network connection: nothing is sent. Share the file by hand if you choose to.\n");
    if dry_run {
        s.push_str(&format!(
            "Dry run: this is what {} would hold; nothing was written.\n",
            out.display()
        ));
    } else {
        s.push_str(&format!("Writing {}.\n", out.display()));
    }
    s
}

// ---------- the files ----------

/// `root/.drift/feedback`, refusing a symbolic link on the way. Created (with its
/// `.gitignore`) when `create`.
fn feedback_dir(root: &Path, create: bool) -> anyhow::Result<PathBuf> {
    let dir = root.join(DIR);
    for p in [root.join(".drift"), dir.clone()] {
        if std::fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
            bail!(
                "{} is a symbolic link: the feedback file is never written through one",
                p.display()
            );
        }
    }
    if create {
        std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
        // `create_new` never follows a link and never overwrites what is there.
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(".gitignore"))
        {
            let _ = f.write_all(
                b"# Created by drift: feedback marks and their key stay on this machine.\n*\n",
            );
        }
        // A `.gitignore` the repository brought (committed, or empty) may not ignore the
        // key and the marks; then nothing is written, so `git add -A` cannot commit them.
        let ignore = dir.join(".gitignore");
        let ignores_all = read_small(&ignore)?.is_some_and(|t| t.lines().any(|l| l.trim() == "*"));
        if !ignores_all {
            bail!(
                "{} does not ignore everything (a line `*`): the feedback key and marks are not written where git could commit them",
                ignore.display()
            );
        }
    }
    Ok(dir)
}

/// The text of `path`, `None` when there is none. A link or anything but a regular file
/// is refused (checked before opening, so a FIFO cannot hang the read).
fn read_small(path: &Path) -> anyhow::Result<Option<String>> {
    match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(anyhow::Error::new(e).context(format!("reading {}", path.display())));
        }
        Ok(m) if !m.file_type().is_file() => {
            bail!("{} is not a regular file: refused", path.display())
        }
        Ok(_) => {}
    }
    let f = std::fs::File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let mut text = String::new();
    f.take(MAX_READ)
        .read_to_string(&mut text)
        .with_context(|| format!("reading {}", path.display()))?;
    Ok(Some(text))
}

/// The marks file in `dir`, empty when there is none. One Drift cannot read is an error,
/// never overwritten.
fn load_marks(dir: &Path) -> anyhow::Result<MarksFile> {
    let p = dir.join(MARKS);
    let Some(text) = read_small(&p)? else {
        return Ok(MarksFile {
            schema: MARKS_SCHEMA.into(),
            version: MARKS_VERSION,
            marks: Vec::new(),
        });
    };
    let file: MarksFile = serde_json::from_str(&text).with_context(|| {
        format!(
            "{} is not a marks file this Drift reads; nothing was changed",
            p.display()
        )
    })?;
    if file.schema != MARKS_SCHEMA || file.version > MARKS_VERSION {
        bail!(
            "{} is a {} file of version {}; this Drift reads {MARKS_SCHEMA} version {MARKS_VERSION}",
            p.display(),
            file.schema,
            file.version
        );
    }
    Ok(file)
}

/// Record `m`, replacing an earlier mark of the same report; whether one was replaced.
/// The list stays sorted, one mark per report.
fn record(file: &mut MarksFile, m: Mark) -> bool {
    let before = file.marks.len();
    file.marks.retain(|x| x.key() != m.key());
    let replaced = file.marks.len() != before;
    file.marks.push(m);
    file.marks.sort();
    let mut seen = BTreeSet::new();
    file.marks
        .retain(|x| seen.insert((x.report.clone(), x.id.clone(), x.member.clone())));
    file.schema = MARKS_SCHEMA.into();
    file.version = MARKS_VERSION;
    replaced
}

/// The key in `dir`, made when `create` and missing.
fn key_in(dir: &Path, create: bool) -> anyhow::Result<Option<[u8; 32]>> {
    let p = dir.join(KEY);
    if let Some(text) = read_small(&p)? {
        return parse_key(text.trim())
            .map(Some)
            .with_context(|| format!("{} is not a key Drift wrote", p.display()));
    }
    if !create {
        return Ok(None);
    }
    let key = random_key()?;
    let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    // Only this user reads the key: it is what keeps the export's hashes from being
    // reversed by anyone who can guess the names.
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
    let mut f = opts
        .open(&p)
        .with_context(|| format!("creating {}", p.display()))?;
    f.write_all(format!("{hex}\n").as_bytes())?;
    Ok(Some(key))
}

fn random_key() -> anyhow::Result<[u8; 32]> {
    let mut key = [0u8; 32];
    getrandom::fill(&mut key).map_err(|e| anyhow::anyhow!("no random key: {e}"))?;
    Ok(key)
}

fn parse_key(hex: &str) -> Option<[u8; 32]> {
    if hex.len() != 64 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

/// A keyed hash of `text` (blake3 keyed with the checkout's key), 16 hex digits.
fn hashed(key: &[u8; 32], what: &str, text: &str) -> String {
    let mut h = blake3::Hasher::new_keyed(key);
    h.update(what.as_bytes());
    h.update(&[0]);
    h.update(text.as_bytes());
    let hex = h.finalize().to_hex();
    format!("h:{}", &hex[..16])
}

/// `(id, member)` of a reference: the two arguments, or one quoted line of drift.lock.
fn split_reference(reference: &str, member: Option<&str>) -> (String, Option<String>) {
    let reference = reference.trim();
    if let Some(m) = member {
        return (reference.to_string(), Some(m.trim().to_string()));
    }
    match reference.split_once(char::is_whitespace) {
        Some((id, m)) if !m.trim().is_empty() => (id.to_string(), Some(m.trim().to_string())),
        _ => (reference.to_string(), None),
    }
}

/// A `--why` as it is kept: whitespace collapsed, at most [`MAX_WHY`] characters, no
/// control characters.
fn why_text(text: &str) -> anyhow::Result<String> {
    anyhow::ensure!(
        !text.chars().any(|c| c.is_control() && !c.is_whitespace()),
        "the reason holds control characters"
    );
    let why = text.split_whitespace().collect::<Vec<_>>().join(" ");
    anyhow::ensure!(!why.is_empty(), "--why is empty: leave it out, or say why");
    let n = why.chars().count();
    anyhow::ensure!(
        n <= MAX_WHY,
        "the reason has {n} characters; keep it to {MAX_WHY}"
    );
    Ok(why)
}

/// Today, `YYYY-MM-DD` (UTC): the only time a mark keeps.
fn today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    crate::review_log::utc(secs)[..10].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reference_is_two_arguments_or_a_lock_line() {
        assert_eq!(
            split_reference("D-abc123", Some("app/a.ts#GET")),
            ("D-abc123".into(), Some("app/a.ts#GET".into()))
        );
        assert_eq!(
            split_reference("D-abc123 app/a.ts#GET", None),
            ("D-abc123".into(), Some("app/a.ts#GET".into()))
        );
        assert_eq!(split_reference("F-1a2b3c", None), ("F-1a2b3c".into(), None));
    }

    #[test]
    fn tokens_keep_only_drift_words() {
        assert_eq!(mark_kind("wrapped_by:call"), "wrapped_by:call");
        assert_eq!(mark_kind("app/api/x.ts"), "other");
        assert_eq!(mark_kind("withAuth"), "other");
        assert!(is_day("2026-11-16"));
        assert!(!is_day("2026-11-16T10:00:00Z"));
    }

    #[test]
    fn hashes_are_keyed_and_stable() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        assert_eq!(
            hashed(&a, "convention", "D-1"),
            hashed(&a, "convention", "D-1")
        );
        assert_ne!(
            hashed(&a, "convention", "D-1"),
            hashed(&b, "convention", "D-1")
        );
        assert_ne!(
            hashed(&a, "convention", "D-1"),
            hashed(&a, "finding", "D-1")
        );
        let hex: String = a.iter().map(|x| format!("{x:02x}")).collect();
        assert_eq!(parse_key(&hex), Some(a));
    }

    #[test]
    fn marking_again_replaces() {
        let m = |verdict: &str| Mark {
            report: "violation".into(),
            id: "D-1".into(),
            member: "a.ts#f".into(),
            verdict: verdict.into(),
            why: None,
            kind: "wrapped_by:call".into(),
            tier: "default".into(),
            baselined: false,
            day: "2026-11-16".into(),
        };
        let mut f = MarksFile::default();
        assert!(!record(&mut f, m("true")));
        assert!(record(&mut f, m("wrong")));
        assert_eq!(f.marks.len(), 1);
        assert_eq!(f.marks[0].verdict, "wrong");
    }

    #[test]
    fn why_is_one_line_and_capped() {
        assert_eq!(why_text("  a \n b ").unwrap(), "a b");
        assert!(why_text("").is_err());
        assert!(why_text(&"x".repeat(MAX_WHY + 1)).is_err());
        assert!(why_text("a\u{7}b").is_err());
    }
}
