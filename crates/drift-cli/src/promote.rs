//! `drift practices promote` and the practice step of `drift review`: a person makes a way
//! the code already does a concern the rule for new code in one place
//! (docs/v2/PROMOTE-A-PRACTICE.md). The engine decides what qualifies and what is
//! recorded ([`drift_mine::practices::promote`]); this module is the command line around
//! it: the arguments, the preview a person reads before anything is written, the write
//! itself (the convention, and one `drift.lock` line per unit that differs today), and
//! the block gate, which for a promoted practice is a replay of recent history.
//!
//! What is written is a person's decision, as `drift review --hidden --answer` writes one:
//! accepted (or, for a `n` in interactive review, rejected so it is not asked again), the
//! lock extended and never pruned.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, Write};
use std::path::Path;
use std::process::{Command, ExitCode};

use anyhow::bail;
use drift_core::RepoFacts;
use drift_core::ingest::Lang;
use drift_mine::mine::{MIN_ROLE_SIZE, Rule};
use drift_mine::policy::{
    CONVENTIONS_FILE, Convention, ConventionsFile, LOCK_FILE, Lock, Mode, Status,
};
use drift_mine::practices::PracticesReport;
use drift_mine::practices::promote::{self, Candidate, Place, Refusal, Replay};
use serde_json::{Value, json};

/// `drift practices promote`'s examples.
pub const PROMOTE_HELP: &str = "Examples:
  drift practices promote --list                        what may be promoted now, each with its command
  drift practices promote P-0f0acb --in app/api --dry-run
                                                        the preview; nothing is written
  drift practices promote P-0f0acb --in app/api         an accepted convention in advise mode, the units
                                                        that differ today recorded in drift.lock
  drift practices promote P-0f0acb --with P-3b91d2      two ways accepted as one rule
  drift practices promote P-0f0acb --in app/api --block
                                                        block mode, when the last 15 units added there
                                                        (git history) mostly follow it
  drift practices promote P-0f0acb --in app/api --json

A place qualifies with at least 8 units of the concern, the accepted ways holding 80% of
the units Drift could read, and at most 20% it could not read. Units Drift cannot read are
never reported. Promoting again in the same place updates the same convention. Run
`drift init` first; commit .drift/conventions.yaml and drift.lock afterwards.";

/// The arguments of `drift practices promote`.
#[derive(clap::Args, Debug, Clone)]
pub struct PromoteArgs {
    /// The variant to promote (`P-…`), as `drift practices --all` prints it or
    /// `concerns[].variants[].id` in `drift practices --json`.
    #[arg(value_name = "P-ID", required_unless_present = "list")]
    pub id: Option<String>,
    /// The place: a path from the repository root, a package directory or a directory
    /// inside one (`.` the root package). Default: the variant's broadest place that
    /// qualifies.
    #[arg(long = "in", value_name = "PATH")]
    pub place: Option<String>,
    /// Another variant of the same concern accepted as a way with the first
    /// (comma-separated or repeated). Nothing is added unless named.
    #[arg(long = "with", value_name = "P-ID", value_delimiter = ',')]
    pub with: Vec<String>,
    /// Write it in block mode: refused unless a replay of the last 15 units added to the
    /// place (git history) shows at least 80% of them follow it.
    #[arg(long)]
    pub block: bool,
    /// Promote although the accepted ways hold less than 80% of the units Drift could
    /// read. Advise only: a forced practice never blocks.
    #[arg(long)]
    pub force: bool,
    /// Print the preview and write nothing.
    #[arg(long)]
    pub dry_run: bool,
    /// Print JSON on standard output.
    #[arg(long)]
    pub json: bool,
    /// List every practice that may be promoted now, each with its command. Writes nothing.
    #[arg(long, conflicts_with_all = ["id", "place", "with", "block", "force", "dry_run"])]
    pub list: bool,
}

/// `drift practices promote`. `facts` is read only once the arguments and the policy
/// allow a promotion: a refusal of either costs no scan.
pub fn run(
    root: &Path,
    facts: impl FnOnce() -> anyhow::Result<RepoFacts>,
    args: &PromoteArgs,
) -> anyhow::Result<ExitCode> {
    let policy = ConventionsFile::load(root)?;
    if args.list {
        let facts = facts()?;
        let report = crate::practices::report_units_kept(root, &facts, None);
        return list(&report, policy.as_ref(), args.json);
    }
    let Some(id) = args.id.as_deref() else {
        return usage(
            args.json,
            "no_variant",
            "name the variant to promote (`drift practices --all` prints the ids) or use --list; nothing was written",
        );
    };
    if args.block && args.force {
        return usage(
            args.json,
            "block_forced",
            "--block and --force do not go together: a practice promoted below the share (--force) advises only and never blocks; nothing was written",
        );
    }
    let Some(mut policy) = policy else {
        return usage(
            args.json,
            "no_policy",
            &format!(
                "there is no {CONVENTIONS_FILE}: run `drift init` first, then promote; nothing was written"
            ),
        );
    };
    let mut lock = Lock::load(root)?;
    let facts = facts()?;
    let report = crate::practices::report_units_kept(root, &facts, None);
    drop(facts);
    let place = match args.place.as_deref() {
        None => None,
        Some(text) => match Place::parse(text, &report) {
            Some(p) => Some(p),
            None => {
                return refused(
                    args.json,
                    &Refusal::NoSuchPlace {
                        place: text.to_string(),
                    },
                );
            }
        },
    };
    let cand = match promote::candidate(&report, id, place.as_ref(), &args.with, args.force) {
        Ok(c) => c,
        Err(r) => return refused(args.json, &r),
    };
    // Another practice of the concern whose place holds this one, or that this one
    // holds: both would report the same units, so the second is refused, as the review
    // leaves it out. The same id is this practice promoted again.
    let new_id = promote::convention_id(&cand.place, &cand.concern);
    if let Some(x) = covering(&policy, &cand).filter(|x| x.id != new_id) {
        return usage(
            args.json,
            "covered",
            &format!(
                "{} already holds {} to a practice in a place that overlaps {}: `drift review --reject {}` drops it first; nothing was written",
                x.id,
                drift_mine::practices::plain_concern(&cand.concern),
                cand.place.shown(),
                x.id
            ),
        );
    }
    let mut conv = written(&policy, &cand);
    let mut replay = None;
    // A practice that blocked before is promoted again on new evidence: it keeps
    // blocking only if the gate still lets it, else it advises (and says so).
    let kept_block = !args.block && conv.mode == Mode::Block;
    let mut block_dropped = None;
    if args.block || kept_block {
        let gate = block_gate(&report, &conv, cand.forced, &first_added(root));
        replay = gate.replay;
        match gate.verdict {
            Err(why) if args.block => {
                return block_refused(args.json, &conv, gate.replay, &cand.unit, &why);
            }
            Err(why) => {
                conv.mode = Mode::Advise;
                replay = None;
                block_dropped = Some(why);
            }
            Ok(()) => conv.mode = Mode::Block,
        }
    }
    let new = new_entries(&lock, &conv.id, &cand);
    let preview = promote::preview(&cand, &conv);
    let same = same_way(&report, &policy, &cand);
    let write_it = !args.dry_run;
    if write_it {
        lock.entries.extend(new.iter().cloned());
        insert(&mut policy, conv.clone());
        policy.save(root)?;
        lock.save(root)?;
    }
    let mut stdout = std::io::stdout().lock();
    if args.json {
        let out = json!({
            "written": write_it,
            "place": cand.place.shown(),
            "convention": convention_json(&conv),
            "candidate": cand,
            "baselined": new.len(),
            "replay": replay,
            "block_dropped": block_dropped,
            "same_way": same,
            "preview": preview,
        });
        serde_json::to_writer_pretty(&mut stdout, &out)?;
        writeln!(stdout)?;
        return Ok(ExitCode::SUCCESS);
    }
    write!(stdout, "{preview}")?;
    if !same.is_empty() {
        writeln!(
            stdout,
            "Also in {CONVENTIONS_FILE}: {} name{} the same way for code of this package. Where both are accepted, new code that breaks them is reported under each; `drift review --reject <id>` drops one.",
            same.join(", "),
            if same.len() == 1 { "s" } else { "" }
        )?;
    }
    if let Some(why) = &block_dropped {
        writeln!(
            stdout,
            "It blocked before; it advises now: {why} (`drift review --block {}` asks again).",
            conv.id
        )?;
    }
    if let Some(r) = replay {
        writeln!(
            stdout,
            "Block: {}, so it blocks from now on (`drift review --advise {}` sets it back).",
            r.sentence(&cand.unit),
            conv.id
        )?;
    }
    if write_it {
        writeln!(stdout, "Wrote {CONVENTIONS_FILE} and {LOCK_FILE}.")?;
    } else {
        writeln!(stdout, "Dry run: nothing was written.")?;
    }
    Ok(ExitCode::SUCCESS)
}

/// The mined conventions (proposed or accepted) that say the same as promoting `cand`
/// would: their rule requires an instrument of one of its ways (read from the map,
/// [`drift_mine::practices::rule_names`]), for code of the same package. A person who
/// keeps both hears of one new unit twice, so the command names them. A rule that
/// forbids the instrument says the opposite and is not one. Sorted by id.
fn same_way(report: &PracticesReport, policy: &ConventionsFile, cand: &Candidate) -> Vec<String> {
    let instruments: Vec<&str> = report
        .concerns
        .iter()
        .filter(|c| c.id == cand.concern)
        .flat_map(|c| &c.variants)
        .filter(|v| cand.ways.iter().any(|w| w.id == v.id))
        .flat_map(|v| v.instruments.iter().map(String::as_str))
        .collect();
    let mut ids: Vec<String> = policy
        .conventions
        .iter()
        .filter(|c| {
            c.status != Status::Rejected
                && !c.rule.is_practice()
                && !matches!(c.rule, Rule::Avoids { .. })
                && c.role.package == cand.place.package
                && instruments
                    .iter()
                    .any(|i| drift_mine::practices::rule_names(&c.rule, i))
        })
        .map(|c| c.id.clone())
        .collect();
    ids.sort();
    ids
}

/// The convention a promotion of `cand` writes: the engine's ([`promote::convention`]),
/// accepted, with what a person decided about the one already there of the same id
/// kept (its mode, the members they marked fine, the files they set apart, its agents
/// choice). Its summary and evidence are always the new candidate's. A practice promoted
/// below the share advises, whatever mode was there.
fn written(policy: &ConventionsFile, cand: &Candidate) -> Convention {
    let mut c = promote::convention(cand);
    if let Some(old) = policy.conventions.iter().find(|x| x.id == c.id) {
        c.mode = old.mode;
        c.exceptions = old.exceptions.clone();
        c.different_kind = old.different_kind.clone();
        if old.agents.is_some() {
            c.agents = old.agents;
        }
    }
    if cand.forced {
        c.mode = Mode::Advise;
    }
    c.status = Status::Accepted;
    c
}

/// The lock lines promoting `cand` as `id` adds: one per unit that differs today, less
/// those already there. The lock only grows.
fn new_entries(lock: &Lock, id: &str, cand: &Candidate) -> BTreeSet<(String, String)> {
    cand.exceptions
        .iter()
        .map(|e| (id.to_string(), format!("{}#{}", e.path, e.symbol)))
        .filter(|k| !lock.entries.contains(k))
        .collect()
}

/// Put `c` in the policy, replacing the convention of its id, after the conventions of
/// its status (the order `drift init` writes).
fn insert(policy: &mut ConventionsFile, c: Convention) {
    policy.conventions.retain(|x| x.id != c.id);
    let at = policy
        .conventions
        .iter()
        .position(|x| x.status > c.status)
        .unwrap_or(policy.conventions.len());
    policy.conventions.insert(at, c);
}

/// `c` as the JSON output names it.
fn convention_json(c: &Convention) -> Value {
    json!({
        "id": c.id,
        "summary": c.summary,
        "status": c.status,
        "mode": c.mode,
        "promoted_from_practice": c.promoted_from_practice,
    })
}

/// A refusal of the engine's: its sentence on stderr (or the JSON on stdout), exit 2.
fn refused(json: bool, r: &Refusal) -> anyhow::Result<ExitCode> {
    if json {
        let out = json!({ "refused": r, "message": r.to_string() });
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        eprintln!("drift: {r}");
        eprintln!("Nothing was written.");
    }
    Ok(ExitCode::from(2))
}

/// A refusal of the command line's own (`code` names it in the JSON), exit 2.
fn usage(json: bool, code: &str, message: &str) -> anyhow::Result<ExitCode> {
    if json {
        let out = json!({ "refused": { "code": code }, "message": message });
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        eprintln!("drift: {message}");
    }
    Ok(ExitCode::from(2))
}

/// `--block` refused by the gate: why, and the replay as evidence when one was run.
fn block_refused(
    json: bool,
    c: &Convention,
    replay: Option<Replay>,
    unit: &str,
    why: &str,
) -> anyhow::Result<ExitCode> {
    let message = format!(
        "{}: not set to block: {why}. Nothing was written. Advise mode needs no history: run it again without --block.",
        c.id
    );
    if json {
        let out = json!({
            "refused": { "code": "block_refused", "id": c.id, "replay": replay },
            "message": message,
        });
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        eprintln!("drift: {message}");
        if let Some(r) = replay {
            eprintln!("Replay: {}.", r.sentence(unit));
        }
    }
    Ok(ExitCode::from(2))
}

// ---------- what may be promoted ----------

/// The practices a person may be offered now ([`promote::candidates`]), less those
/// already decided: one a person declined (its convention is rejected, by id), and one
/// a convention promoted earlier already covers (the same concern, accepted, in a place
/// that holds or is held by the candidate's).
#[derive(Debug, Default)]
pub struct Open {
    pub candidates: Vec<Candidate>,
    /// Candidates left out because a person declined them.
    pub declined: usize,
    /// The promoted conventions that left candidates out, sorted.
    pub promoted: BTreeSet<String>,
}

pub fn open_candidates(report: &PracticesReport, policy: Option<&ConventionsFile>) -> Open {
    let mut out = Open::default();
    for c in promote::candidates(report) {
        let Some(policy) = policy else {
            out.candidates.push(c);
            continue;
        };
        let id = promote::convention_id(&c.place, &c.concern);
        if policy
            .conventions
            .iter()
            .any(|x| x.id == id && x.status == Status::Rejected)
        {
            out.declined += 1;
            continue;
        }
        if let Some(x) = covering(policy, &c) {
            out.promoted.insert(x.id.clone());
            continue;
        }
        out.candidates.push(c);
    }
    out
}

/// Takes the offer to promote (`promotable`) off every variant a person already decided
/// on in its place, as [`open_candidates`] leaves them out of the list: `drift practices`,
/// the first run and the Studio then offer only what is still open. A variant promoted
/// in one place stays on offer in a place that does not overlap it.
pub fn drop_decided(report: &mut PracticesReport, policy: &ConventionsFile) {
    let mut decided: Vec<(usize, usize)> = Vec::new();
    for (i, c) in report.concerns.iter().enumerate() {
        for (j, v) in c.variants.iter().enumerate() {
            let Some(place) = v
                .promotable
                .as_ref()
                .and_then(|p| p.place.as_deref())
                .and_then(|shown| Place::parse(shown, report))
            else {
                continue;
            };
            let id = promote::convention_id(&place, &c.id);
            let done = policy.conventions.iter().any(|x| match &x.rule {
                Rule::Practice { concern, .. } if *concern == c.id => {
                    if x.status == Status::Rejected {
                        x.id == id
                    } else {
                        promote::place_of(x).is_some_and(|p| overlaps(&p, &place))
                    }
                }
                _ => false,
            });
            if done {
                decided.push((i, j));
            }
        }
    }
    for (i, j) in decided {
        report.concerns[i].variants[j].promotable = None;
    }
}

/// The promoted practice of `policy`, not rejected, of the candidate's concern, whose
/// place overlaps the candidate's.
fn covering<'a>(policy: &'a ConventionsFile, c: &Candidate) -> Option<&'a Convention> {
    policy.conventions.iter().find(|x| {
        x.status != Status::Rejected
            && matches!(&x.rule, Rule::Practice { concern, .. } if *concern == c.concern)
            && promote::place_of(x).is_some_and(|p| overlaps(&p, &c.place))
    })
}

/// Whether one place holds the other: the same package, one directory at or below the
/// other.
fn overlaps(a: &Place, b: &Place) -> bool {
    fn below(x: &str, y: &str) -> bool {
        x.is_empty() || x == y || y.starts_with(&format!("{x}/"))
    }
    a.package == b.package && (below(&a.dir, &b.dir) || below(&b.dir, &a.dir))
}

/// The command that promotes `c` as listed.
pub fn command(c: &Candidate) -> String {
    let mut s = format!(
        "drift practices promote {} --in {}",
        c.ways.first().map_or("", |w| w.id.as_str()),
        c.place.shown()
    );
    for w in c.ways.iter().skip(1) {
        s.push_str(&format!(" --with {}", w.id));
    }
    s
}

/// What one unit is, plural, as a person reads it (`entry_point` → `entry points`).
fn units(unit: &str) -> String {
    let w = unit.replace('_', " ");
    if w.ends_with('s') { w } else { format!("{w}s") }
}

fn percent(share: f64) -> u32 {
    (share * 100.0).round() as u32
}

/// One candidate's line, and its command on the next.
fn candidate_lines(c: &Candidate) -> [String; 2] {
    let ways: Vec<String> = c
        .ways
        .iter()
        .map(|w| drift_mine::practices::plain_way(&w.label))
        .collect();
    [
        format!(
            "  {} in {}: {} in {} of {} {}; {} {}, {} could not be read",
            drift_mine::practices::plain_concern(&c.concern),
            c.place.shown(),
            ways.join(", or "),
            c.follows,
            c.total,
            units(&c.unit),
            c.exceptions.len(),
            if c.exceptions.len() == 1 {
                "differs"
            } else {
                "differ"
            },
            c.unknown
        ),
        format!("    {}", command(c)),
    ]
}

/// `drift practices promote --list`. A promoted practice is not listed again: the note
/// names the conventions that cover what would have been, and how many a person declined.
fn list(
    report: &PracticesReport,
    policy: Option<&ConventionsFile>,
    json: bool,
) -> anyhow::Result<ExitCode> {
    let open = open_candidates(report, policy);
    let mut stdout = std::io::stdout().lock();
    if json {
        let candidates: Vec<Value> = open
            .candidates
            .iter()
            .map(|c| {
                json!({
                    "place": c.place.shown(),
                    "command": command(c),
                    "candidate": c,
                })
            })
            .collect();
        let out = json!({
            "candidates": candidates,
            "declined": open.declined,
            "promoted": open.promoted,
        });
        serde_json::to_writer_pretty(&mut stdout, &out)?;
        writeln!(stdout)?;
        return Ok(ExitCode::SUCCESS);
    }
    if open.candidates.is_empty() {
        writeln!(
            stdout,
            "No practice may be promoted now. A package or directory qualifies where Drift could read how something is done at least {MIN_ROLE_SIZE} times, one way holds {}% of those, and at most {}% could not be read (`drift practices --all` shows each way's share).",
            percent(promote::BLOCK_SHARE),
            percent(promote::MAX_UNKNOWN_SHARE)
        )?;
    } else {
        writeln!(
            stdout,
            "{} practice(s) may be promoted now. Each becomes an accepted convention in advise mode, with the code that differs today recorded in {LOCK_FILE}; the command prints what it records (--dry-run writes nothing):",
            open.candidates.len()
        )?;
        for c in &open.candidates {
            for line in candidate_lines(c) {
                writeln!(stdout, "{line}")?;
            }
        }
    }
    if !open.promoted.is_empty() {
        writeln!(
            stdout,
            "Already promoted, not listed again: {} (`drift review --list` lists the promoted practices).",
            open.promoted.iter().cloned().collect::<Vec<_>>().join(", ")
        )?;
    }
    if open.declined > 0 {
        writeln!(
            stdout,
            "{} declined earlier in `drift review` (rejected in {CONVENTIONS_FILE}), not listed; `drift practices promote <id>` promotes one all the same.",
            open.declined
        )?;
    }
    Ok(ExitCode::SUCCESS)
}

// ---------- the block gate ----------

/// Why Drift does not know when the files of a place were first committed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoHistory {
    NoRepo,
    Shallow,
    NoCommits,
    Failed,
}

impl NoHistory {
    fn why(self) -> &'static str {
        match self {
            NoHistory::NoRepo => "this is not a git repository",
            NoHistory::Shallow => {
                "this is a shallow clone, so the commits that added most files are missing (`git fetch --unshallow` reads them)"
            }
            NoHistory::NoCommits => "the repository has no commits",
            NoHistory::Failed => "git could not read the history",
        }
    }
}

/// A git command as [`crate::history`] runs one: no prompt, no fetch, no lock, no
/// replace refs, paths unquoted.
fn git_cmd(root: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root);
    for c in [
        "core.quotePath=false",
        "core.fsmonitor=false",
        "core.pager=cat",
        "color.ui=never",
        "log.showSignature=false",
        "diff.renames=false",
        "diff.relative=false",
    ] {
        cmd.args(["-c", c]);
    }
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env_remove("GIT_PAGER");
    cmd
}

fn git_line(root: &Path, args: &[&str]) -> Option<String> {
    crate::history::run_bounded(git_cmd(root, args), crate::history::GIT_TIMEOUT, 1 << 20)
        .ok()
        .map(|o| String::from_utf8_lossy(&o).trim().to_string())
}

/// When each file of the repository at `root` was first committed (committer time,
/// seconds since the epoch), keyed by its path from `root`: one `git log` over the
/// history of `HEAD` that lists the files each commit added. Outside a repository, in a
/// shallow clone (whose oldest commits are missing, so every file would look added by
/// the first one there) or when git fails, nothing is known, and why.
pub fn first_added(root: &Path) -> Result<BTreeMap<String, i64>, NoHistory> {
    if git_line(root, &["rev-parse", "--is-inside-work-tree"]).as_deref() != Some("true") {
        return Err(NoHistory::NoRepo);
    }
    match git_line(root, &["rev-parse", "--is-shallow-repository"]).as_deref() {
        Some("false") => {}
        Some("true") => return Err(NoHistory::Shallow),
        _ => return Err(NoHistory::Failed),
    }
    if git_line(root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).is_none() {
        return Err(NoHistory::NoCommits);
    }
    let out = crate::history::run_bounded(
        git_cmd(
            root,
            &[
                "log",
                "--no-renames",
                "--diff-filter=A",
                "--relative",
                "--format=%x00%ct",
                "--name-only",
                "HEAD",
            ],
        ),
        crate::history::GIT_TIMEOUT,
        crate::history::MAX_LOG_BYTES,
    )
    .map_err(|_| NoHistory::Failed)?;
    Ok(parse_added(&String::from_utf8_lossy(&out)))
}

/// `git log --format=%x00%ct --name-only` as path → the earliest time a commit added it
/// (a file deleted and added again counts from its first addition).
fn parse_added(text: &str) -> BTreeMap<String, i64> {
    let mut out: BTreeMap<String, i64> = BTreeMap::new();
    let mut at: Option<i64> = None;
    for line in text.split('\n') {
        if let Some(t) = line.strip_prefix('\0') {
            at = t.trim().parse().ok();
        } else if let Some(t) = at
            && !line.trim().is_empty()
        {
            out.entry(line.to_string())
                .and_modify(|x| *x = (*x).min(t))
                .or_insert(t);
        }
    }
    out
}

/// What the block gate says of a promoted practice: the replay, when one was run, and
/// whether it may block (`Err`: why not, the sentence a person reads).
pub struct Gate {
    pub replay: Option<Replay>,
    pub verdict: Result<(), String>,
}

/// Whether the promoted practice `c` was promoted below the share its place needs (on a
/// person's `--force`), as `drift check` reads it ([`drift_mine::check::effective_mode`]).
pub fn forced(c: &Convention) -> bool {
    c.rule.is_practice()
        && (c.evidence.holders as f64) < promote::BLOCK_SHARE * c.evidence.total as f64
}

/// What one unit of the promoted practice `c` is, from the map.
fn unit_of(report: &PracticesReport, c: &Convention) -> String {
    let concern = match &c.rule {
        Rule::Practice { concern, .. } => concern.as_str(),
        _ => "",
    };
    report
        .concerns
        .iter()
        .find(|x| x.id == concern)
        .map_or_else(|| "unit".to_string(), |x| x.unit.clone())
}

/// Whether the promoted practice `c` may block: never when it was promoted below the
/// share (`forced`) or its place is Python (decision D7, read as for every convention:
/// [`Convention::language`]); otherwise only when the replay over `added` allows it.
pub fn block_gate(
    report: &PracticesReport,
    c: &Convention,
    forced: bool,
    added: &Result<BTreeMap<String, i64>, NoHistory>,
) -> Gate {
    let no = |why: String| Gate {
        replay: None,
        verdict: Err(why),
    };
    if forced {
        return no(
            "it was promoted below the share its place needs (--force), and a forced practice advises only; --force does not lift that"
                .to_string(),
        );
    }
    if c.language() == Lang::Python {
        return no("its place is Python code, and Python conventions advise only".to_string());
    }
    let added = match added {
        Ok(a) => a,
        Err(e) => {
            return no(format!(
                "blocking needs a replay of the last {} {} added to its place, by the commit that first added each file, and Drift could not read when they were added: {}",
                promote::REPLAY_UNITS,
                units(&unit_of(report, c)),
                e.why()
            ));
        }
    };
    let r = promote::replay(report, c, &|path: &str| added.get(path).copied());
    Gate {
        replay: Some(r),
        verdict: r.allows_block(),
    }
}

/// `drift review --block` on promoted practices: each goes through the gate (`--force`
/// does not lift it). `Ok`: the evidence to print, one line per practice, and the
/// caller sets them to block; `Err`: nothing may change. `facts` is read only when one
/// of `ids` is a promoted practice.
pub fn review_block(
    root: &Path,
    facts: impl FnOnce() -> anyhow::Result<RepoFacts>,
    policy: &ConventionsFile,
    ids: &[String],
    force: bool,
) -> anyhow::Result<Vec<String>> {
    let wanted: Vec<&Convention> = ids
        .iter()
        .filter_map(|id| policy.conventions.iter().find(|c| &c.id == id))
        .filter(|c| c.rule.is_practice())
        .collect();
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let facts = facts()?;
    let report = crate::practices::report_units_kept(root, &facts, None);
    drop(facts);
    let added = first_added(root);
    let mut evidence = Vec::new();
    let mut refusals = Vec::new();
    for c in wanted {
        let unit = unit_of(&report, c);
        let gate = block_gate(&report, c, forced(c), &added);
        let seen = gate
            .replay
            .map(|r| format!(" (replay: {})", r.sentence(&unit)))
            .unwrap_or_default();
        match gate.verdict {
            Ok(()) => evidence.push(format!("{}: may block{seen}", c.id)),
            Err(why) => refusals.push(format!("{}: {why}{seen}", c.id)),
        }
    }
    if !refusals.is_empty() {
        let force_note = if force {
            " --force does not lift this for a promoted practice."
        } else {
            ""
        };
        bail!(
            "refusing to block, nothing was changed:\n  {}\nA promoted practice blocks only when the replay of recent history allows it.{force_note} Advise mode needs no history: `drift review --advise <id>` keeps it accepted and advising.",
            refusals.join("\n  ")
        );
    }
    Ok(evidence)
}

// ---------- drift review ----------

/// Where a convention came from, for `drift review --list` and the cards: a promoted
/// practice names the practice map, its variant and place, and the ways it holds to.
/// `None` for a mined convention.
pub fn origin(c: &Convention) -> Option<String> {
    let Rule::Practice { any_of, .. } = &c.rule else {
        return None;
    };
    let place = promote::place_of(c).map_or_else(String::new, |p| p.shown());
    Some(match &c.promoted_from_practice {
        Some(from) => format!(
            "promoted from the practice map, variant {from}, in {place} (ways: {})",
            any_of.join(", ")
        ),
        None => format!(
            "a practice rule in {place} written by hand (ways: {})",
            any_of.join(", ")
        ),
    })
}

/// `drift review --list`'s lines on the promoted practices of `policy` (none are
/// proposals, so the queue never holds one): each with its status, mode and origin.
pub fn listed(policy: &ConventionsFile) -> Vec<String> {
    let practices: Vec<&Convention> = policy
        .conventions
        .iter()
        .filter(|c| c.rule.is_practice())
        .collect();
    if practices.is_empty() {
        return Vec::new();
    }
    let mut out = vec![format!(
        "{} convention(s) from the practice map (`drift practices promote`; `drift review --show <id>` shows one):",
        practices.len()
    )];
    for c in practices {
        let state = match c.status {
            Status::Accepted => format!("accepted, {}", drift_mine::check::effective_mode(c)),
            Status::Proposed => "proposed".to_string(),
            Status::Rejected => "rejected".to_string(),
        };
        out.push(format!(
            "  [{}] {} ({state}): {}",
            c.id,
            c.summary,
            origin(c).unwrap_or_default()
        ));
    }
    out
}

/// The practice step of interactive `drift review`, after the proposals: every practice
/// that may be promoted now and was not decided ([`open_candidates`]), one at a time with
/// its preview. `y` promotes in advise mode, `b` promotes and blocks when the gate allows
/// it (advise when not, saying why), `n` records the person's no as the convention,
/// rejected, so it is not offered again, `s` skips, `q` stops. The policy is changed in
/// memory (the caller saves it); the lock is saved here. Returns whether anything changed.
pub fn review_step(
    root: &Path,
    report: &PracticesReport,
    policy: &mut ConventionsFile,
) -> anyhow::Result<bool> {
    let open = open_candidates(report, Some(&*policy));
    if open.candidates.is_empty() {
        return Ok(false);
    }
    let mut lock = Lock::load(root)?;
    let mut added: Option<Result<BTreeMap<String, i64>, NoHistory>> = None;
    println!();
    println!(
        "{} practice(s) may be promoted to a convention: `drift check` then reports new code in that place that does it another way. y = promote (advise), b = promote and block (if recent history follows it), n = no (not asked again), s = skip, q = quit",
        open.candidates.len()
    );
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    let mut changed = false;
    for cand in &open.candidates {
        // One promoted a moment ago may cover this one (a package and a directory of it).
        if covering(policy, cand).is_some() {
            continue;
        }
        let mut conv = written(policy, cand);
        let id = conv.id.clone();
        println!();
        print!("{}", promote::preview(cand, &conv));
        print!("  [y/b/n/s/q] > ");
        std::io::stdout().flush()?;
        let Some(line) = lines.next() else { break };
        let line = line?;
        match line.trim() {
            "y" => {
                let n = new_entries(&lock, &id, cand);
                lock.entries.extend(n);
                insert(policy, conv);
                println!("  promoted: {id}, advise");
                changed = true;
            }
            "b" => {
                let added = added.get_or_insert_with(|| first_added(root));
                let gate = block_gate(report, &conv, cand.forced, added);
                if let Some(r) = gate.replay {
                    println!("  replay: {}", r.sentence(&cand.unit));
                }
                match gate.verdict {
                    Ok(()) => {
                        conv.mode = Mode::Block;
                        println!("  promoted: {id}, block");
                    }
                    Err(why) => {
                        conv.mode = Mode::Advise;
                        println!("  not blocked: {why}. Advise mode needs no history.");
                        println!("  promoted: {id}, advise");
                    }
                }
                let n = new_entries(&lock, &id, cand);
                lock.entries.extend(n);
                insert(policy, conv);
                changed = true;
            }
            "n" => {
                conv.status = Status::Rejected;
                conv.mode = Mode::Advise;
                insert(policy, conv);
                println!(
                    "  not promoted: recorded as {id}, rejected, in {CONVENTIONS_FILE}, so it is not offered again (`drift practices promote` promotes it all the same)"
                );
                changed = true;
            }
            "q" => break,
            _ => println!("  skipped: offered again next time"),
        }
    }
    if changed {
        lock.save(root)?;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_addition_of_a_file_counts() {
        let log = "\x00300\n\nb.ts\n\x00200\n\na.ts\nb.ts\n\x00100\n\nc.ts\n";
        let added = parse_added(log);
        assert_eq!(added.get("a.ts"), Some(&200));
        assert_eq!(added.get("b.ts"), Some(&200));
        assert_eq!(added.get("c.ts"), Some(&100));
        assert_eq!(added.len(), 3);
    }

    #[test]
    fn places_overlap_only_in_one_package_one_below_the_other() {
        let p = |package: &str, dir: &str| Place {
            package: package.into(),
            dir: dir.into(),
        };
        assert!(overlaps(&p("", ""), &p("", "app/api")));
        assert!(overlaps(&p("", "app/api"), &p("", "app")));
        assert!(!overlaps(&p("", "app/api"), &p("", "app/apix")));
        assert!(!overlaps(&p("a", ""), &p("b", "")));
    }

    #[test]
    fn units_read_as_plurals() {
        assert_eq!(units("entry_point"), "entry points");
        assert_eq!(units("tests"), "tests");
    }
}
