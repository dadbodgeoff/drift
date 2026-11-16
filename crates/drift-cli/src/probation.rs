//! Probation on the command line ([`drift_mine::practices::probation`]): with
//! `experimental: [probation]` in `.drift/config.yaml`, `drift practices promote …
//! --block` where there is no history to replay puts the practice on probation in advise
//! mode, `drift check` and `drift practices promote --list` count the units added to its
//! place since, and the block gate lets it block once they are enough and all follow.
//! Without the setting nothing here runs, and every command says what it said before.
//!
//! Which change a unit came from is read from git where it can be: against a diff, the
//! merge base; with none, `HEAD` (an edit of the record not committed yet). A change
//! that edits the record has its own units held back ([`probation::count`]).

use std::path::Path;

use drift_mine::mine::Rule;
use drift_mine::policy::{Convention, ConventionsFile, Mode, Status};
use drift_mine::practices::PracticesReport;
use drift_mine::practices::probation::{self, Count, PROBATION_FILE, Probations, Record};
use drift_mine::practices::promote;
use serde::Serialize;

use crate::pr;

/// Whether probation is on for the repository at `root`.
pub fn on(root: &Path) -> bool {
    drift_mine::policy::probation(root)
}

/// One practice on probation as `--json` gives it: the count, the sentence a person
/// reads, and the command that sets it to block once it is eligible.
#[derive(Debug, Clone, Serialize)]
pub struct Listed {
    #[serde(flatten)]
    pub count: Count,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

impl Listed {
    fn of(count: Count, unit: &str) -> Self {
        let command = count.eligible().then(|| {
            format!(
                "drift review --block {}",
                drift_mine::report::shell_word(&count.id)
            )
        });
        Listed {
            message: count.sentence(unit),
            count,
            command,
        }
    }
}

/// What one unit of the promoted practice `c` is (`entry_point`, ...).
fn unit_of(c: &Convention) -> &'static str {
    match &c.rule {
        Rule::Practice { concern, .. } => promote::unit_of(concern).unwrap_or("unit"),
        _ => "unit",
    }
}

/// The practices `probation` judges: accepted promoted practices in advise mode with a
/// record. One that blocks already is past probation; one rejected is not checked.
fn on_probation<'p>(policy: &'p ConventionsFile, records: &Probations) -> Vec<&'p Convention> {
    policy
        .conventions
        .iter()
        .filter(|c| {
            c.rule.is_practice()
                && c.status == Status::Accepted
                && c.mode == Mode::Advise
                && records.records.contains_key(&c.id)
        })
        .collect()
}

/// The change a count reads, for [`probation::count`]: the record it starts from and the
/// files it touches.
enum Change<'s> {
    /// No change is known (no git, no commit): the record as it is judges, and every
    /// unit counts.
    None,
    /// Against a diff: its merge base.
    Diff(&'s pr::DiffScope),
    /// With no diff: what is not committed yet, against `HEAD` (read when needed).
    Head,
}

/// Whether the repository at `root` has a commit at `HEAD`.
fn has_head(root: &Path) -> bool {
    crate::promote::git_line(root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
        .is_some_and(|s| !s.is_empty())
}

/// The counts of the practices of `policy` on probation, sorted by id. Empty when
/// probation is off or nothing is on probation; then `map` is never asked for. `scope`:
/// the diff a check reads, if any.
pub fn counts<'m>(
    root: &Path,
    policy: &ConventionsFile,
    scope: Option<&pr::DiffScope>,
    map: impl FnOnce() -> &'m PracticesReport,
) -> anyhow::Result<Vec<Listed>> {
    if !on(root) {
        return Ok(Vec::new());
    }
    let now = Probations::load(root)?;
    let judged = on_probation(policy, &now);
    if judged.is_empty() {
        return Ok(Vec::new());
    }
    counts_of(root, &now, &judged, scope, map())
}

/// [`counts`] of the practices `judged`, each of which has a record in `now`.
fn counts_of(
    root: &Path,
    now: &Probations,
    judged: &[&Convention],
    scope: Option<&pr::DiffScope>,
    report: &PracticesReport,
) -> anyhow::Result<Vec<Listed>> {
    let change = match scope {
        Some(s) => Change::Diff(s),
        None if has_head(root) => Change::Head,
        None => Change::None,
    };
    // The record the change starts from: at the merge base, or at `HEAD`.
    let before: Option<Probations> = match &change {
        Change::None => None,
        Change::Diff(s) => Some(Probations::parse(
            &pr::file_at(root, &s.merge_base, PROBATION_FILE).unwrap_or_default(),
        )),
        Change::Head => Some(Probations::parse(
            &pr::file_at(root, "HEAD", PROBATION_FILE).unwrap_or_default(),
        )),
    };
    // The files of what is not committed yet, read once and only when a record was
    // edited there. When they cannot be read, every file is held back.
    let uncommitted: std::cell::OnceCell<Option<pr::DiffScope>> = std::cell::OnceCell::new();
    let mut out = Vec::new();
    for &c in judged {
        let record = &now.records[&c.id];
        let was = before.as_ref().and_then(|b| b.records.get(&c.id));
        let edited = before.is_some() && was != Some(record);
        // The record the change starts from judges, unless it is of another rule (the
        // change promoted it again on purpose): then the record as it is, with the
        // change's own units held back all the same.
        let digest = probation::rule_digest(c);
        let judging: &Record = match was {
            Some(w) if edited && w.rule.as_deref() == Some(digest.as_str()) => w,
            _ => record,
        };
        let held: Box<dyn Fn(&str) -> bool> = match (&change, edited) {
            (_, false) | (Change::None, _) => Box::new(|_| false),
            (Change::Diff(s), true) => {
                let s = *s;
                Box::new(move |p| s.touches(p))
            }
            (Change::Head, true) => {
                let scope = uncommitted.get_or_init(|| pr::DiffScope::from_git(root, "HEAD").ok());
                match scope {
                    Some(s) => Box::new(move |p| s.touches(p)),
                    None => Box::new(|_| true),
                }
            }
        };
        let count = probation::count(report, c, judging, &*held);
        out.push(Listed::of(count, unit_of(c)));
    }
    out.sort_by(|a, b| a.count.id.cmp(&b.count.id));
    Ok(out)
}

/// The count of the one practice `c`, read as a check of the whole tree reads it; `None`
/// when probation is off or `c` has no record. The block gate reads it: `c` may be in
/// any mode there.
pub fn count_of(
    root: &Path,
    report: &PracticesReport,
    c: &Convention,
) -> anyhow::Result<Option<Listed>> {
    if !on(root) {
        return Ok(None);
    }
    let now = Probations::load(root)?;
    if !now.records.contains_key(&c.id) {
        return Ok(None);
    }
    Ok(counts_of(root, &now, &[c], None, report)?.pop())
}

/// The count of `c` as if it were put on probation now (a dry run writes no record):
/// nothing counted yet.
pub fn fresh(report: &PracticesReport, c: &Convention) -> Listed {
    let record = probation::start(report, c);
    Listed::of(probation::count(report, c, &record, &|_| false), unit_of(c))
}

/// Puts the promoted practice `c` on probation: its record written to
/// [`PROBATION_FILE`], unless one of its rule is there already (then its count goes on).
/// Records of practices `policy` no longer holds in advise mode are dropped. Returns
/// whether a new record was written.
pub fn put_on(
    root: &Path,
    report: &PracticesReport,
    policy: &ConventionsFile,
    c: &Convention,
) -> anyhow::Result<bool> {
    let mut file = Probations::load(root)?;
    let digest = probation::rule_digest(c);
    let kept = file
        .records
        .get(&c.id)
        .is_some_and(|r| r.rule.as_deref() == Some(digest.as_str()));
    if !kept {
        file.records
            .insert(c.id.clone(), probation::start(report, c));
    }
    file.records.retain(|id, _| {
        id == &c.id
            || policy.conventions.iter().any(|x| {
                &x.id == id
                    && x.rule.is_practice()
                    && x.status == Status::Accepted
                    && x.mode == Mode::Advise
            })
    });
    file.save(root)?;
    Ok(!kept)
}

/// The one line `--block` adds where there is no history to replay: with probation off,
/// the setting that would let the practice earn block mode without it; for a shallow
/// clone, first how to read the history.
pub fn hint(missing: crate::promote::NoHistory, unit: &str) -> String {
    let earn = format!(
        "Where there is no history to replay, `experimental: [probation]` in .drift/config.yaml lets it earn block mode on the {} {} added to its place from now on",
        probation::PROBATION_UNITS,
        units(unit)
    );
    match missing {
        crate::promote::NoHistory::Shallow => format!(
            "A full clone lets the replay run: `git fetch --unshallow` (in CI, `fetch-depth: 0` with actions/checkout). {earn}."
        ),
        _ => format!("{earn}."),
    }
}

fn units(unit: &str) -> String {
    match unit {
        "entry_point" => "entry points".to_string(),
        other => format!("{}s", other.replace('_', " ")),
    }
}
