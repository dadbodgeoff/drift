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

use std::cmp::Reverse;
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
use drift_mine::practices::promote::{self, Candidate, Place, Refusal, Replay, Request};
use serde_json::{Value, json};

/// `drift practices promote`'s examples.
pub const PROMOTE_HELP: &str = "Examples:
  drift practices promote --list                        what may be promoted now, each with its command
  drift practices promote P-0f0acb --in app/api --dry-run
                                                        the preview; nothing is written
  drift practices promote P-0f0acb --in app/api         an accepted convention in advise mode, the units
                                                        that differ today recorded in drift.lock
  drift practices promote P-0f0acb --with P-3b91d2      two ways accepted as one rule
  drift practices promote --concern authz --mechanism membership_guard --in app/api
                                                        one mechanism accepted whole, whichever
                                                        instrument a unit names
  drift practices promote --concern authn --any-enforcing --in app/api
                                                        any way Drift reads as turning an unsigned
                                                        caller away (a route opened on purpose is not)
  drift practices promote P-0f0acb --in app/api --block
                                                        block mode, when the last 15 units added there
                                                        (git history) mostly follow it
  drift practices promote P-0f0acb --in app/api --json
  drift practices promote --list --concern authn        what may be promoted for one concern

A place qualifies with at least 8 units of the concern, the accepted ways holding 80% of
the units Drift could read, and at most 20% it could not read. Units Drift cannot read are
never reported. --concern is needed when no variant is named (`drift practices --json`
lists the concern ids, `concerns[].id`, and each unit's uses, whose part before the `:` is
its mechanism). Promoting again in the same place updates the same convention. Run
`drift init` first; commit .drift/conventions.yaml and drift.lock afterwards.";

/// The arguments of `drift practices promote`.
#[derive(clap::Args, Debug, Clone)]
pub struct PromoteArgs {
    /// The variant to promote (`P-…`), as `drift practices --all` prints it or
    /// `concerns[].variants[].id` in `drift practices --json`.
    /// Optional with --concern and --mechanism or --any-enforcing.
    #[arg(value_name = "P-ID")]
    pub id: Option<String>,
    /// The concern (`authn`, `authz`, `errors`, ...): needed when no variant is named,
    /// to accept a mechanism (--mechanism) or any enforcing way (--any-enforcing). With
    /// --list, only that concern's practices are listed.
    #[arg(long, value_name = "ID")]
    pub concern: Option<String>,
    /// A mechanism accepted whole, in the map's own words (`dependency`, `wrap`,
    /// `membership_guard`, ...: the part before the `:` of a unit's uses in `drift
    /// practices --units --json`): a unit that does the concern by it follows, whichever
    /// instrument it names (comma-separated or repeated).
    #[arg(long = "mechanism", value_name = "NAME", value_delimiter = ',')]
    pub mechanisms: Vec<String>,
    /// Accept any way Drift reads as enforcing the concern (sign-in: any way that turns
    /// an unsigned caller away; permissions: any check Drift proved compares the caller
    /// with what is asked for). A way that opens a route on purpose is not one.
    #[arg(long)]
    pub any_enforcing: bool,
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
    #[arg(long, conflicts_with_all = ["id", "place", "with", "block", "force", "dry_run", "mechanisms", "any_enforcing"])]
    pub list: bool,
}

/// What `args` ask to promote, as the engine reads it ([`Request`]); `Err`: the code and
/// sentence of a refusal of the command line's own, before anything is read.
fn request(args: &PromoteArgs) -> Result<Request, (&'static str, String)> {
    let concern = args.concern.clone().unwrap_or_default();
    let named = args.id.is_some() || !args.with.is_empty();
    if !named && concern.is_empty() {
        if !args.mechanisms.is_empty() || args.any_enforcing {
            return Err((
                "no_concern",
                "--mechanism and --any-enforcing need --concern <id> when no variant is named: the concern says which units Drift reads (`drift practices --json` lists the ids, `concerns[].id`); nothing was written".to_string(),
            ));
        }
        return Err((
            "no_variant",
            "name the variant to promote (`drift practices --all` prints the ids), or a concern with --mechanism or --any-enforcing (`--concern authn --any-enforcing`), or use --list; nothing was written".to_string(),
        ));
    }
    Ok(Request {
        concern,
        ways: args.id.iter().cloned().collect(),
        with: args.with.clone(),
        mechanisms: args.mechanisms.clone(),
        any_enforcing: args.any_enforcing,
        force: args.force,
    })
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
        return list_of(&report, policy.as_ref(), args.concern.as_deref(), args.json);
    }
    let req = match request(args) {
        Ok(r) => r,
        Err((code, message)) => return usage(args.json, code, &message),
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
                return refused_in(
                    args.json,
                    &report,
                    &Refusal::NoSuchPlace {
                        place: text.to_string(),
                    },
                );
            }
        },
    };
    let cand = match promote::candidate_for(&report, place.as_ref(), &req) {
        Ok(c) => c,
        Err(r) => return refused_in(args.json, &report, &r),
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
                drift_mine::report::sanitize(&x.id, 40),
                drift_mine::practices::plain_concern(&cand.concern),
                drift_mine::report::sanitize(&cand.place.shown(), 160),
                drift_mine::report::sanitize(&x.id, 40)
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
/// [`refused_in`] says more where the map is in hand; kept for a refusal made without it.
#[allow(dead_code)]
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

/// [`refused`] with the sentence [`refusal_message`] makes of `r` for `report`: what
/// Drift read and what the person can do, beside the engine's reason.
fn refused_in(json: bool, report: &PracticesReport, r: &Refusal) -> anyhow::Result<ExitCode> {
    let message = refusal_message(report, r);
    if json {
        let out = json!({ "refused": r, "message": message });
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        eprintln!("drift: {message}");
        eprintln!("Nothing was written.");
    }
    Ok(ExitCode::from(2))
}

/// The sentence a person reads for a refusal: the engine's ([`Refusal`]'s `Display`),
/// and for the refusals of what to accept, what Drift read in `report` that the person
/// can name instead (the concerns, a concern's mechanisms, the concerns with a reading of
/// what enforces them) and the command forms. Deterministic: lists are sorted.
pub fn refusal_message(report: &PracticesReport, r: &Refusal) -> String {
    let base = r.to_string();
    match r {
        Refusal::NothingAccepted => format!(
            "{base} The forms: `drift practices promote <P-id> --in <place>` (a variant id, as `drift practices --all` prints it), `--concern <id> --mechanism <name> --in <place>`, or `--concern <id> --any-enforcing --in <place>`. `drift practices promote --list` prints a command for each practice that may be promoted now."
        ),
        Refusal::UnknownConcern { .. } => {
            let ids: Vec<&str> = report.concerns.iter().map(|c| c.id.as_str()).collect();
            if ids.is_empty() {
                format!("{base} Drift read no concern in this repository.")
            } else {
                format!("{base} The concerns Drift read here: {}.", ids.join(", "))
            }
        }
        Refusal::NotAMechanism { concern, .. } => {
            let read = mechanisms_read(report, concern);
            if read.is_empty() {
                format!(
                    "{base} Drift could tell how no unit of it does it here, so there is no mechanism to name."
                )
            } else {
                let named: Vec<String> = read
                    .iter()
                    .take(MECHANISMS_NAMED)
                    .map(|(m, n)| {
                        format!(
                            "{} ({n} {})",
                            drift_mine::report::sanitize(m, 60),
                            if *n == 1 { "unit" } else { "units" }
                        )
                    })
                    .collect();
                let more = match read.len().saturating_sub(MECHANISMS_NAMED) {
                    0 => String::new(),
                    n => format!(", and {n} more"),
                };
                format!(
                    "{base} The mechanisms Drift read for it here: {}{more} (`--mechanism <name>`; `drift practices --units --json` lists each unit's uses).",
                    named.join(", ")
                )
            }
        }
        Refusal::NoEnforcing { concern } => {
            let with = enforcing_concerns();
            let others = if with.is_empty() {
                String::new()
            } else {
                format!(
                    " Drift has that reading for {} (`--concern <id> --any-enforcing`).",
                    with.join(", ")
                )
            };
            format!(
                "{base}{others} For this one, name its ways (`drift practices --concern {} --all` lists them) or a mechanism (`--mechanism <name>`).",
                drift_mine::report::sanitize(concern, 40)
            )
        }
        Refusal::TooUnknown { unknown, total, .. } => format!(
            "{base} Drift read how the other {} do it; --force does not lift this.",
            total.saturating_sub(*unknown)
        ),
        _ => base,
    }
}

/// Mechanisms a refusal names before "and N more".
const MECHANISMS_NAMED: usize = 8;

/// The mechanisms the units of `concern` that Drift could tell use, each with how many
/// units use it (a unit once per mechanism), most used first, then by name. A unit's uses
/// are its own (`UnitRow::uses`), else read from its key; a key that stands for several
/// ways names none.
fn mechanisms_read(report: &PracticesReport, concern: &str) -> Vec<(String, usize)> {
    let Some(c) = report.concerns.iter().find(|c| c.id == concern) else {
        return Vec::new();
    };
    let mut by: BTreeMap<&str, BTreeSet<(&str, &str)>> = BTreeMap::new();
    for u in c.units.iter().filter(|u| u.assignment == "known") {
        let key = u
            .key
            .as_deref()
            .or_else(|| {
                c.variants
                    .iter()
                    .find(|v| v.id == u.variant)
                    .map(|v| v.key.as_str())
            })
            .unwrap_or("");
        let uses: Vec<&str> = if !u.uses.is_empty() {
            u.uses.iter().map(String::as_str).collect()
        } else if key.is_empty() || key.starts_with("any_of(") || !key.contains(':') {
            Vec::new()
        } else {
            key.split('+').collect()
        };
        for k in uses {
            by.entry(drift_mine::practices::mechanism_of(k))
                .or_default()
                .insert((u.path.as_str(), u.symbol.as_str()));
        }
    }
    let mut out: Vec<(String, usize)> = by
        .into_iter()
        .map(|(m, units)| (m.to_string(), units.len()))
        .collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    out
}

/// The concerns whose classifier has a reading of which ways enforce them
/// ([`drift_mine::practices::Concern::enforces`]), in the map's concern order.
fn enforcing_concerns() -> Vec<&'static str> {
    use drift_mine::practices::Concern;
    let registered = drift_mine::practices::registry();
    drift_mine::practices::CONCERNS
        .iter()
        .map(|(id, _)| *id)
        .filter(|id| {
            registered
                .iter()
                .any(|c| c.id() == *id && c.enforces(&[]).is_some())
        })
        .collect()
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
                Rule::Practice { concern, .. } if *concern == c.id => match x.status {
                    Status::Rejected => x.id == id,
                    // Only proposed: nobody decided it.
                    Status::Proposed => false,
                    Status::Accepted => promote::place_of(x).is_some_and(|p| overlaps(&p, &place)),
                },
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

/// The promoted practice of `policy`, accepted, of the candidate's concern, whose
/// place overlaps the candidate's. One only proposed (`drift init`'s, from the map) is
/// no decision: a person has not promoted it.
pub(crate) fn covering<'a>(policy: &'a ConventionsFile, c: &Candidate) -> Option<&'a Convention> {
    policy.conventions.iter().find(|x| {
        x.status == Status::Accepted
            && matches!(&x.rule, Rule::Practice { concern, .. } if *concern == c.concern)
            && promote::place_of(x).is_some_and(|p| overlaps(&p, &c.place))
    })
}

/// Whether one place holds the other: the same package, one directory at or below the
/// other.
fn overlaps(a: &Place, b: &Place) -> bool {
    a.overlaps(b)
}

/// The command that promotes `c` as listed: its first way, `--in` its place, `--with`
/// each other way, `--mechanism` each mechanism accepted whole and `--any-enforcing`;
/// `--concern` in place of a way when it names none (a mechanism or any-enforcing
/// candidate). Each word is quoted for a shell where it needs to be (a place such as
/// `app/(auth)/api`).
pub fn command(c: &Candidate) -> String {
    let mut s = String::from("drift practices promote");
    match c.ways.first() {
        Some(w) => {
            s.push(' ');
            s.push_str(&shell_word(&w.id));
        }
        None => {
            s.push_str(" --concern ");
            s.push_str(&shell_word(&c.concern));
        }
    }
    // A place that starts with `-` would be read by the command line as a flag.
    let place = c.place.shown();
    s.push_str(if place.starts_with('-') {
        " --in="
    } else {
        " --in "
    });
    s.push_str(&shell_word(&place));
    for w in c.ways.iter().skip(1) {
        s.push_str(" --with ");
        s.push_str(&shell_word(&w.id));
    }
    for m in &c.mechanisms {
        s.push_str(" --mechanism ");
        s.push_str(&shell_word(m));
    }
    if c.any_enforcing {
        s.push_str(" --any-enforcing");
    }
    s
}

/// `w` as one shell word: as it is when it holds only characters no shell reads
/// specially, else in single quotes.
pub fn shell_word(w: &str) -> String {
    let plain = !w.is_empty()
        && w.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./@+:,=".contains(c));
    if plain {
        w.to_string()
    } else {
        format!("'{}'", w.replace('\'', "'\\''"))
    }
}

/// Takes the offer to promote off every variant of `shown` that `drift practices promote
/// <id> --in <place>` would refuse as the code stands, read in `full` (the map of every
/// unit, [`crate::practices::report_units_kept`]). A view of one file (`drift practices
/// --path`) reads only that file's units, so a way all of them use looks promotable in a
/// package where it is rare (pygoat: two such commands, both refused). Returns how many
/// offers it took off.
pub fn keep_offers_that_qualify(full: &PracticesReport, shown: &mut PracticesReport) -> usize {
    let mut dropped = 0;
    for c in &mut shown.concerns {
        for v in &mut c.variants {
            dropped += keep_offer(full, v);
            for a in &mut v.alternatives {
                dropped += keep_offer(full, a);
            }
        }
    }
    dropped
}

/// [`keep_offers_that_qualify`] of one variant: 1 when its offer was taken off.
fn keep_offer(full: &PracticesReport, v: &mut drift_mine::practices::Variant) -> usize {
    let holds = v.promotable.as_ref().map(|p| {
        let place = match p.place.as_deref() {
            Some(text) => match Place::parse(text, full) {
                Some(place) => Some(place),
                None => return false,
            },
            None => None,
        };
        let req = Request {
            ways: vec![v.id.clone()],
            ..Request::default()
        };
        promote::candidate_for(full, place.as_ref(), &req).is_ok()
    });
    if holds == Some(false) {
        v.promotable = None;
        1
    } else {
        0
    }
}

/// Clears the promote command ([`drift_mine::practices::Departure::promote`]) of every
/// departure whose place a person already decided on for its concern: a promoted practice
/// (not rejected) whose place holds or is held by the departure's, or a rejected one of
/// that very place. `report` is the map the departures were read from. Called by
/// `crate::practices::check_departures`, with the policy.
pub fn drop_decided_departures(
    report: &PracticesReport,
    policy: &ConventionsFile,
    deps: &mut [drift_mine::practices::Departure],
) {
    for d in deps.iter_mut().filter(|d| d.promote.is_some()) {
        let shown = match (d.package.is_empty(), d.dir.is_empty()) {
            (true, true) => ".".to_string(),
            (false, true) => d.package.clone(),
            _ => d.dir.clone(),
        };
        let Some(place) = Place::parse(&shown, report) else {
            continue;
        };
        let id = promote::convention_id(&place, &d.concern);
        let decided = policy.conventions.iter().any(|x| match &x.rule {
            Rule::Practice { concern, .. } if *concern == d.concern => match x.status {
                Status::Rejected => x.id == id,
                // Only proposed: nobody decided it.
                Status::Proposed => false,
                Status::Accepted => promote::place_of(x).is_some_and(|p| overlaps(&p, &place)),
            },
            _ => false,
        });
        if decided {
            d.promote = None;
        }
    }
}

/// A candidate of `--list` with how many of the units that differ from it are
/// departures `drift check` points out today ([`drift_mine::practices::departures`]):
/// what promoting it would turn from a fact into a checked rule.
#[derive(Debug, Clone)]
pub struct RankedCandidate {
    pub candidate: Candidate,
    pub departures: usize,
}

/// `--list`'s candidates in their order: the ones that hold code to something, then
/// apart those code follows by doing nothing ([`Candidate::passive`]), never first.
#[derive(Debug, Clone, Default)]
pub struct Ranked {
    pub active: Vec<RankedCandidate>,
    pub passive: Vec<RankedCandidate>,
}

/// `candidates` ranked for `--list` (audit 3 G3): by how many current departures each
/// would settle (its units that differ and that a departure names, outside tests), then
/// by how many units it reads (that follow or differ), then in the engine's order
/// ([`promote::candidates`]: concern, place, breadth, first way), which the stable sort
/// keeps. Passive candidates are ranked the same way, in their own list.
pub fn ranked(report: &PracticesReport, candidates: Vec<Candidate>) -> Ranked {
    let deps = drift_mine::practices::departures(report, None);
    let departing: BTreeSet<(&str, &str, &str)> = deps
        .iter()
        .filter(|d| !drift_mine::roles::is_test_path(&d.path))
        .flat_map(|d| {
            d.units
                .iter()
                .map(move |u| (d.concern.as_str(), d.path.as_str(), u.symbol.as_str()))
        })
        .collect();
    let mut out = Ranked::default();
    for c in candidates {
        let departures = c
            .exceptions
            .iter()
            .filter(|e| {
                departing.contains(&(c.concern.as_str(), e.path.as_str(), e.symbol.as_str()))
            })
            .count();
        let r = RankedCandidate {
            candidate: c,
            departures,
        };
        if r.candidate.passive {
            out.passive.push(r);
        } else {
            out.active.push(r);
        }
    }
    let key = |r: &RankedCandidate| {
        (
            Reverse(r.departures),
            Reverse(r.candidate.follows + r.candidate.exceptions.len()),
        )
    };
    out.active.sort_by_key(&key);
    out.passive.sort_by_key(&key);
    out
}

/// What `c` accepts, as a person reads it: its ways in the first run's words
/// ([`drift_mine::practices::plain_way`]), each mechanism whole, any enforcing way.
fn accepted(c: &Candidate) -> String {
    let mut parts: Vec<String> = c
        .ways
        .iter()
        .map(|w| drift_mine::practices::plain_way(&w.label))
        .collect();
    for m in &c.mechanisms {
        parts.push(format!("by any {}", m.replace('_', " ")));
    }
    if c.any_enforcing {
        parts.push("any way Drift reads as enforcing it".to_string());
    }
    parts.join(", or ")
}

/// What one unit is, plural, as a person reads it (`entry_point` → `entry points`).
fn units(unit: &str) -> String {
    let w = unit.replace('_', " ");
    if w.ends_with('s') { w } else { format!("{w}s") }
}

fn percent(share: f64) -> u32 {
    (share * 100.0).round() as u32
}

/// One candidate's line, and its command on the next. `departures`: how many of the units
/// that differ are departures `drift check` points out today.
fn candidate_lines(c: &Candidate, departures: usize) -> [String; 2] {
    let of_them = match departures {
        0 => String::new(),
        n => format!(
            " ({n} of them {} `drift check` points out today)",
            if n == 1 { "a departure" } else { "departures" }
        ),
    };
    [
        format!(
            "  {} in {}: {} in {} of {} {}; {} {}{of_them}, {} could not be read",
            drift_mine::practices::plain_concern(&c.concern),
            drift_mine::report::sanitize(&c.place.shown(), 160),
            drift_mine::report::sanitize(&accepted(c), 240),
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
        format!("    {}", drift_mine::report::sanitize(&command(c), 480)),
    ]
}

/// `drift practices promote --list` (of `concern` only, when named): the candidates
/// ranked ([`ranked`]), those code follows by doing nothing apart and last. A promoted
/// practice is not listed again: the note names the conventions that cover what would
/// have been, and how many a person declined.
fn list_of(
    report: &PracticesReport,
    policy: Option<&ConventionsFile>,
    concern: Option<&str>,
    json: bool,
) -> anyhow::Result<ExitCode> {
    if let Some(id) = concern
        && !report.concerns.iter().any(|c| c.id == id)
    {
        return refused_in(
            json,
            report,
            &Refusal::UnknownConcern {
                concern: id.to_string(),
            },
        );
    }
    let mut open = open_candidates(report, policy);
    if let Some(id) = concern {
        open.candidates.retain(|c| c.concern == id);
    }
    let ranked = ranked(report, std::mem::take(&mut open.candidates));
    let mut stdout = std::io::stdout().lock();
    if json {
        let entry = |r: &RankedCandidate| {
            json!({
                "place": r.candidate.place.shown(),
                "command": command(&r.candidate),
                "departures": r.departures,
                "candidate": r.candidate,
            })
        };
        let out = json!({
            "candidates": ranked.active.iter().map(&entry).collect::<Vec<Value>>(),
            "passive": ranked.passive.iter().map(&entry).collect::<Vec<Value>>(),
            "declined": open.declined,
            "promoted": open.promoted,
        });
        serde_json::to_writer_pretty(&mut stdout, &out)?;
        writeln!(stdout)?;
        return Ok(ExitCode::SUCCESS);
    }
    if ranked.active.is_empty() && ranked.passive.is_empty() {
        writeln!(
            stdout,
            "No practice may be promoted now. A package or directory qualifies where Drift could read how something is done at least {MIN_ROLE_SIZE} times, one way holds {}% of those, and at most {}% could not be read (`drift practices --all` shows each way's share).",
            percent(promote::BLOCK_SHARE),
            percent(promote::MAX_UNKNOWN_SHARE)
        )?;
    } else {
        if ranked.active.is_empty() {
            writeln!(
                stdout,
                "No practice that holds new code to something may be promoted now; only what code here does by doing nothing, below."
            )?;
        } else {
            writeln!(
                stdout,
                "{} practice(s) may be promoted now, those that would turn the most departures `drift check` points out today into a checked rule first. Each becomes an accepted convention in advise mode, with the code that differs today recorded in {LOCK_FILE}; the command prints what it records (--dry-run writes nothing):",
                ranked.active.len()
            )?;
            for r in &ranked.active {
                for line in candidate_lines(&r.candidate, r.departures) {
                    writeln!(stdout, "{line}")?;
                }
            }
        }
        if !ranked.passive.is_empty() {
            writeln!(
                stdout,
                "{} more that code here follows by doing nothing (errors left to the framework): new code follows them without trying, so as a rule each holds it to little. Listed apart:",
                ranked.passive.len()
            )?;
            for r in &ranked.passive {
                for line in candidate_lines(&r.candidate, r.departures) {
                    writeln!(stdout, "{line}")?;
                }
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
        // A proposal from the map of this place and concern was just asked about in
        // the step before (`crate::from_map_cli::review_step`): skipped there, it is
        // not asked again here under another preview.
        let cand_id = promote::convention_id(&cand.place, &cand.concern);
        if policy
            .conventions
            .iter()
            .any(|x| x.id == cand_id && crate::from_map_cli::undecided(x))
        {
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
            ..Place::default()
        };
        assert!(overlaps(&p("", ""), &p("", "app/api")));
        assert!(overlaps(&p("", "app/api"), &p("", "app")));
        assert!(!overlaps(&p("", "app/api"), &p("", "app/apix")));
        assert!(!overlaps(&p("a", ""), &p("b", "")));
    }

    /// A candidate of `concern` in `place` with these ways, mechanisms and any enforcing way.
    fn cand(
        concern: &str,
        place: &str,
        ways: &[&str],
        mechanisms: &[&str],
        enforcing: bool,
    ) -> Candidate {
        Candidate {
            concern: concern.into(),
            place: Place::parse(place, &PracticesReport::default()).unwrap(),
            ways: ways
                .iter()
                .map(|id| promote::Way {
                    id: id.to_string(),
                    ..promote::Way::default()
                })
                .collect(),
            mechanisms: mechanisms.iter().map(|m| m.to_string()).collect(),
            any_enforcing: enforcing,
            ..Candidate::default()
        }
    }

    /// Pins S17 item 2: every kind of candidate prints a command the CLI parses, never
    /// `promote  --in` (before: a mechanism or any-enforcing candidate, which has no way,
    /// printed an empty id).
    #[test]
    fn the_command_of_every_kind_of_candidate() {
        let cases = [
            (
                cand("authn", "app/api", &["P-a"], &[], false),
                "drift practices promote P-a --in app/api",
            ),
            (
                cand("authn", "app/api", &["P-a", "P-b", "P-c"], &[], false),
                "drift practices promote P-a --in app/api --with P-b --with P-c",
            ),
            (
                cand("authz", "app/api", &[], &["membership_guard"], false),
                "drift practices promote --concern authz --in app/api --mechanism membership_guard",
            ),
            (
                cand("authz", ".", &[], &["dependency", "wrap"], false),
                "drift practices promote --concern authz --in . --mechanism dependency --mechanism wrap",
            ),
            (
                cand("authn", "svc", &[], &[], true),
                "drift practices promote --concern authn --in svc --any-enforcing",
            ),
            (
                cand("authn", "svc", &["P-a"], &["wrap"], true),
                "drift practices promote P-a --in svc --mechanism wrap --any-enforcing",
            ),
            (
                cand("authn", "app/(auth)/api", &["P-a"], &[], false),
                "drift practices promote P-a --in 'app/(auth)/api'",
            ),
        ];
        for (c, want) in cases {
            let got = command(&c);
            assert_eq!(got, want);
            assert!(!got.contains("promote  "), "{got}");
            // The command, read as a shell reads it and parsed as the CLI parses it,
            // asks for the same candidate again.
            assert_round_trip(&got, &c);
        }
    }

    /// The words a POSIX shell reads in `s`, for the quoting [`shell_word`] writes:
    /// words split on spaces, single quotes kept literally, a backslash outside quotes
    /// taking the next character as it is.
    fn shell_split(s: &str) -> Vec<String> {
        let mut out = Vec::new();
        let mut cur = String::new();
        let (mut any, mut quoted, mut escaped) = (false, false, false);
        for ch in s.chars() {
            if escaped {
                cur.push(ch);
                escaped = false;
                any = true;
            } else if ch == '\'' {
                quoted = !quoted;
                any = true;
            } else if ch == '\\' && !quoted {
                escaped = true;
            } else if ch == ' ' && !quoted {
                if any {
                    out.push(std::mem::take(&mut cur));
                    any = false;
                }
            } else {
                cur.push(ch);
                any = true;
            }
        }
        if any {
            out.push(cur);
        }
        out
    }

    /// `drift practices promote`'s arguments alone, for clap to parse.
    #[derive(clap::Parser, Debug)]
    struct PromoteOnly {
        #[command(flatten)]
        args: PromoteArgs,
    }

    /// Pins the round trip a person pastes: `command` read by a shell, parsed by clap
    /// and turned into a request ([`request`]) names the candidate's ways, mechanisms,
    /// any enforcing way, its place as shown, and its concern when no way is named.
    fn assert_round_trip(got: &str, c: &Candidate) {
        let words = shell_split(got);
        assert_eq!(words[..3].join(" "), "drift practices promote", "{got}");
        let argv = std::iter::once("promote".to_string()).chain(words[3..].iter().cloned());
        let parsed = <PromoteOnly as clap::Parser>::try_parse_from(argv)
            .unwrap_or_else(|e| panic!("{got}: {e}"));
        assert_eq!(
            parsed.args.place.as_deref(),
            Some(c.place.shown().as_str()),
            "{got}"
        );
        let r = request(&parsed.args).unwrap_or_else(|(code, m)| panic!("{got}: {code}: {m}"));
        if c.ways.is_empty() {
            assert_eq!(r.concern, c.concern, "{got}");
        }
        assert_eq!(
            r.ways.iter().chain(&r.with).cloned().collect::<Vec<_>>(),
            c.ways.iter().map(|w| w.id.clone()).collect::<Vec<_>>(),
            "{got}"
        );
        assert_eq!(r.mechanisms, c.mechanisms, "{got}");
        assert_eq!(r.any_enforcing, c.any_enforcing, "{got}");
    }

    /// Pins the quoting of places a shell or clap would misread (a space, `(`, `[`, a
    /// route place, a file place): each command round-trips to its candidate.
    #[test]
    fn a_command_of_any_place_round_trips() {
        let mut places = vec![
            cand("authn", "apps/my app", &["P-a"], &[], false),
            cand("authn", "app/(auth)/[id]", &["P-a"], &[], false),
            cand("authn", ".:/api/[*]", &["P-a"], &[], false),
        ];
        let mut file = cand("authn", "app", &["P-a"], &[], false);
        file.place = Place::file_of("", "app/(auth)/api/route.ts").unwrap();
        places.push(file);
        for c in places {
            assert_round_trip(&command(&c), &c);
        }
    }

    #[test]
    fn a_word_a_shell_reads_specially_is_quoted() {
        assert_eq!(shell_word("app/api"), "app/api");
        assert_eq!(shell_word("app/[id]"), "'app/[id]'");
        assert_eq!(shell_word("it's"), "'it'\\''s'");
        assert_eq!(shell_word(""), "''");
    }

    /// The new refusals say what Drift read: the concerns there are, a concern's
    /// mechanisms with their counts, the concerns with a reading of enforcing.
    #[test]
    fn a_refusal_of_what_to_accept_says_what_drift_read() {
        use drift_mine::practices::{ConcernReport, UnitRow};
        let row = |path: &str, uses: &[&str]| UnitRow {
            path: path.into(),
            symbol: "GET".into(),
            assignment: "known".into(),
            uses: uses.iter().map(|u| u.to_string()).collect(),
            ..UnitRow::default()
        };
        let report = PracticesReport {
            concerns: vec![ConcernReport {
                id: "authz".into(),
                units: vec![
                    row("a.ts", &["membership_guard:lib/a.ts#can"]),
                    row("b.ts", &["membership_guard:lib/a.ts#can", "dependency:x"]),
                    UnitRow {
                        assignment: "unknown".into(),
                        ..row("c.ts", &["wrap:y"])
                    },
                ],
                ..ConcernReport::default()
            }],
            ..PracticesReport::default()
        };
        let m = refusal_message(
            &report,
            &Refusal::NotAMechanism {
                concern: "authz".into(),
                mechanism: "wrap".into(),
            },
        );
        assert!(
            m.contains("The mechanisms Drift read for it here: membership_guard (2 units), dependency (1 unit)"),
            "{m}"
        );
        let m = refusal_message(
            &report,
            &Refusal::UnknownConcern {
                concern: "auth".into(),
            },
        );
        assert!(m.contains("The concerns Drift read here: authz."), "{m}");
        let m = refusal_message(
            &report,
            &Refusal::NoEnforcing {
                concern: "errors".into(),
            },
        );
        assert!(m.contains("authn, authz"), "{m}");
        let m = refusal_message(&report, &Refusal::NothingAccepted);
        assert!(m.contains("--any-enforcing"), "{m}");
    }

    #[test]
    fn units_read_as_plurals() {
        assert_eq!(units("entry_point"), "entry points");
        assert_eq!(units("tests"), "tests");
    }

    /// Pins that a practice only proposed (`drift init`'s, from the map) is no decision:
    /// it covers no candidate (so `--list` lists it, not "Already promoted"), takes no
    /// variant's offer and no departure's command. Before, every convention not
    /// rejected did. Accepted, it does all three.
    #[test]
    fn a_practice_only_proposed_is_not_promoted() {
        use drift_mine::practices::{ConcernReport, Departure, Promotable, Variant};
        let c = cand("authn", "app/api", &["P-a"], &[], false);
        let mut proposed = promote::convention(&c);
        proposed.status = Status::Proposed;
        proposed.from_map = Some("practice".into());
        let file = |conv: Convention| ConventionsFile {
            version: drift_mine::policy::POLICY_VERSION_SINGLE,
            engine: String::new(),
            file_kinds: drift_mine::roles::FileKinds::default(),
            suggestion_cap: None,
            agents: Default::default(),
            review_log: Default::default(),
            packages: Vec::new(),
            conventions: vec![conv],
        };
        let report = || PracticesReport {
            concerns: vec![ConcernReport {
                id: "authn".into(),
                variants: vec![Variant {
                    id: "P-a".into(),
                    promotable: Some(Promotable {
                        rule: "practice".into(),
                        role: String::new(),
                        place: Some("app/api".into()),
                    }),
                    ..Variant::default()
                }],
                ..ConcernReport::default()
            }],
            ..PracticesReport::default()
        };
        let departure = || Departure {
            concern: "authn".into(),
            path: "app/api/x/route.ts".into(),
            dir: "app/api".into(),
            promote: Some("drift practices promote P-a --in app/api".into()),
            ..Departure::default()
        };
        for (conv, decided) in [(proposed.clone(), false), (promote::convention(&c), true)] {
            let policy = file(conv);
            assert_eq!(covering(&policy, &c).is_some(), decided);
            let mut r = report();
            drop_decided(&mut r, &policy);
            assert_eq!(r.concerns[0].variants[0].promotable.is_none(), decided);
            let mut deps = vec![departure()];
            drop_decided_departures(&report(), &policy, &mut deps);
            assert_eq!(deps[0].promote.is_none(), decided);
        }
    }
}
