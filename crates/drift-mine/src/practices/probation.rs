//! Probation: how a promoted practice earns block mode where there is no git history
//! to replay (a shallow CI clone, a repository without commits; audit 6 G2).
//!
//! A promoted practice blocks only after a replay of the units last added to its place,
//! by the commit that first added each file ([`super::promote::replay`]); without
//! history it advises, and says why. Probation is the forward version of that replay,
//! switched on with `experimental: [probation]` in `.drift/config.yaml`
//! ([`crate::policy::PROBATION_FEATURE`]): `drift practices promote … --block` with no
//! history to replay accepts the practice in advise mode and records, in
//! [`PROBATION_FILE`], every unit of its place at that moment. From then on each `drift
//! check` counts the units of the place that are not in that record: the units added
//! since. Once [`PROBATION_UNITS`] of them can be told and all follow, the practice is
//! eligible, and the check prints the command that sets it to block. A person runs it;
//! nothing ever starts blocking by itself.
//!
//! The count is read from the code each time, never stored: the record is written once,
//! when the practice is put on probation, and a reviewer sees it in that change's diff;
//! every unit counted after is code in the diff of the change that added it. So the
//! count is deterministic, two branches never write the same counter, and merging them
//! is merging their code.
//!
//! What a change cannot do is promote its own rule ([`count`]): a record whose rule is
//! not the convention's rule any more counts nothing, and a check of a change that edits
//! the record reads the record it starts from and counts no unit in a file the change
//! touches.
//!
//! Unknown is never a violation, and never evidence: a unit Drift cannot tell neither
//! counts towards the K nor breaks the probation; it is counted apart, and counts once it
//! can be told. Units there at acceptance never count: they are what the practice was
//! promoted from, not what came after. A unit added since that breaks the practice makes
//! it not eligible while it does (it is reported by the check as any departure from an
//! advise-mode practice is).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::PracticesReport;
use super::promote;
use crate::policy::Convention;

/// K: how many units added since a practice was put on probation must be told, and all
/// follow it, before it may block. The owner has not approved this number; it is the
/// replay's ([`promote::REPLAY_UNITS`], decision D7's role size for block mode), so the
/// two paths read as many units until they decide. Unlike the replay, which lets 12 of
/// its 15 differ by [`promote::BLOCK_SHARE`], every one of these must follow: they are
/// units written after the rule was in place, not before.
pub const PROBATION_UNITS: usize = promote::REPLAY_UNITS;

/// Where the practices on probation are recorded, committed beside the policy.
pub const PROBATION_FILE: &str = ".drift/probation.lock";

/// What is recorded of one promoted practice on probation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Record {
    /// [`rule_digest`] of the convention when it was put on probation; `None` when the
    /// file has no such line for it (then nothing counts).
    pub rule: Option<String>,
    /// Every unit of its place when it was put on probation (`path#symbol`), whatever
    /// the map said of it: none of them ever counts.
    pub at_start: BTreeSet<String>,
}

/// [`PROBATION_FILE`]: the records by convention id.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Probations {
    pub records: BTreeMap<String, Record>,
}

impl Probations {
    /// The file as written: `<id> rule <digest>` and one `<id> <path#symbol>` per unit
    /// there at the start; `#` lines are comments. A line that is neither is skipped: a
    /// record it belonged to then has no rule, or fewer units, and its count says so or
    /// is the stricter for it, never the looser.
    pub fn parse(text: &str) -> Self {
        let mut out = Self::default();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((id, rest)) = line.split_once(' ') else {
                continue;
            };
            let rest = rest.trim();
            if rest.contains('#') {
                let r = out.records.entry(id.to_string()).or_default();
                r.at_start.insert(rest.to_string());
            } else if let Some(d) = rest.strip_prefix("rule ") {
                let r = out.records.entry(id.to_string()).or_default();
                let d = d.trim().to_string();
                // Two different rule lines (a merge that kept both): it judges no rule.
                r.rule = match &r.rule {
                    Some(was) if *was != d => Some(String::new()),
                    _ => Some(d),
                };
            }
        }
        out
    }

    /// The file at `root`; empty when there is none. A file that cannot be read is an
    /// error, never an empty file.
    pub fn load(root: &Path) -> anyhow::Result<Self> {
        let p = root.join(PROBATION_FILE);
        match drift_core::fsutil::read_regular_to_string(&p, drift_core::fsutil::MAX_CONFIG_BYTES) {
            Ok(text) => Ok(Self::parse(&text)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(anyhow::Error::new(e).context(format!("reading {PROBATION_FILE}"))),
        }
    }

    /// The text [`Self::save`] writes: sorted by id, the rule line first, then the units.
    pub fn render(&self) -> String {
        let mut out = format!(
            "# {PROBATION_FILE}: promoted practices on probation (experimental `probation` in .drift/config.yaml).\n# Written by `drift practices promote --block` where there is no history to replay. A unit listed here was in the practice's place when it was put on probation and never counts towards block mode.\n"
        );
        for (id, r) in &self.records {
            if let Some(d) = &r.rule {
                out.push_str(&format!("{id} rule {d}\n"));
            }
            for u in &r.at_start {
                out.push_str(&format!("{id} {u}\n"));
            }
        }
        out
    }

    pub fn save(&self, root: &Path) -> anyhow::Result<()> {
        crate::policy::write_no_follow(root, Path::new(PROBATION_FILE), self.render().as_bytes())
    }
}

/// What a record names of the rule it judges: a hash of the convention's rule and role.
/// A record of another rule (more ways accepted, another place) counts nothing.
pub fn rule_digest(c: &Convention) -> String {
    let text = serde_json::to_string(&(&c.rule, &c.role)).unwrap_or_default();
    blake3::hash(text.as_bytes()).to_hex()[..16].to_string()
}

/// The record of putting the promoted practice `c` on probation now: its rule, and every
/// unit of its place as `report` (made with every unit listed) has them.
pub fn start(report: &PracticesReport, c: &Convention) -> Record {
    Record {
        rule: Some(rule_digest(c)),
        at_start: promote::observed(report, c)
            .into_iter()
            .map(|(u, _)| u)
            .collect(),
    }
}

/// What the map says of one unit against the practice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Observed {
    Follows,
    /// Drift cannot tell: neither counts nor breaks.
    Unknown,
    Breaks,
}

/// Where a probation stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// Fewer than [`PROBATION_UNITS`] units added since can be told.
    Waiting,
    /// At least [`PROBATION_UNITS`] units added since can be told and all follow: block
    /// mode may be offered to a person.
    Eligible,
    /// A unit added since breaks it: not eligible while one does.
    Broken,
    /// The record does not judge this rule (it was changed after, or the record has no
    /// rule line): nothing counts until it is put on probation again.
    Void,
}

/// What `drift check` counts of one practice on probation ([`count`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Count {
    /// The promoted practice (`D-…`).
    pub id: String,
    pub state: State,
    /// [`PROBATION_UNITS`].
    pub of: usize,
    /// Units added since that Drift can tell and that count.
    pub counted: usize,
    /// Of those, the ones that follow it.
    pub followed: usize,
    /// Of those, the ones that break it (`path#symbol`, sorted).
    pub broke: Vec<String>,
    /// Units added since that Drift cannot tell: counted for neither side.
    pub unknown: usize,
    /// Units added since that Drift can tell but that do not count: in a file the change
    /// that edits the record touches ([`count`]).
    pub held_back: usize,
    /// Units there when it was put on probation (never counted).
    pub at_start: usize,
}

impl Count {
    pub fn eligible(&self) -> bool {
        self.state == State::Eligible
    }

    /// The sentence a person reads, `unit` what one unit is (`entry_point`, ...).
    pub fn sentence(&self, unit: &str) -> String {
        let id = crate::report::sanitize(&self.id, 40);
        let since = format!(
            "{} added to its place since it was put on probation",
            promote::units_word(unit, 2)
        );
        let mut s = match self.state {
            State::Void => format!(
                "{id} is on probation, but its rule or place changed after it was put on probation, so nothing counts; `drift practices promote` with --block puts it on probation again"
            ),
            State::Broken => format!(
                "{id} is on probation: of the {since}, {} of {} Drift can tell break it ({}), so it may not block while one does",
                self.broke.len(),
                self.counted,
                self.broke
                    .iter()
                    .take(3)
                    .map(|u| crate::report::sanitize(u, 200))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            State::Eligible => format!(
                "{id} is on probation and may block: the {} {since} that Drift can tell all follow it (block mode needs {}); `drift review --block {}` sets it to block",
                self.counted,
                self.of,
                crate::report::shell_word(&self.id)
            ),
            State::Waiting => format!(
                "{id} is on probation: {} of the {} {since} that block mode needs, all following it, so far",
                self.counted, self.of
            ),
        };
        if self.unknown > 0 {
            s.push_str(&format!(
                "; {} more Drift cannot tell (counted for neither side)",
                self.unknown
            ));
        }
        if self.held_back > 0 {
            s.push_str(&format!(
                "; {} in files this change touches do not count, because it also edits {PROBATION_FILE}",
                self.held_back
            ));
        }
        s
    }
}

/// What `report` (made with every unit listed) says of the promoted practice `c` on
/// probation under `record`: the units of its place not in the record, each counted
/// once, as [`promote::check`] reads it.
///
/// A change cannot promote its own rule:
/// - a record whose [`Record::rule`] is not the rule of `c` now (the rule, its ways or
///   its place were edited) counts nothing, in every mode: [`State::Void`];
/// - `held(path)` is true for a file touched by a change that also edits the record
///   (the caller knows the change: the diff against the merge base, or against `HEAD`
///   for an edit not committed yet); no unit in such a file counts ([`Count::held_back`]).
///   The caller passes the record the change starts from, where there is one, so an
///   edit that drops units from the record cannot make them count.
pub fn count(
    report: &PracticesReport,
    c: &Convention,
    record: &Record,
    held: &dyn Fn(&str) -> bool,
) -> Count {
    let mut out = Count {
        id: c.id.clone(),
        state: State::Waiting,
        of: PROBATION_UNITS,
        counted: 0,
        followed: 0,
        broke: Vec::new(),
        unknown: 0,
        held_back: 0,
        at_start: record.at_start.len(),
    };
    if record.rule.as_deref() != Some(rule_digest(c).as_str()) {
        out.state = State::Void;
        return out;
    }
    for (unit, seen) in promote::observed(report, c) {
        if record.at_start.contains(&unit) {
            continue;
        }
        if seen == Observed::Unknown {
            out.unknown += 1;
            continue;
        }
        let path = unit.rsplit_once('#').map_or(unit.as_str(), |(p, _)| p);
        if held(path) {
            out.held_back += 1;
            continue;
        }
        out.counted += 1;
        match seen {
            Observed::Follows => out.followed += 1,
            _ => out.broke.push(unit),
        }
    }
    out.state = if !out.broke.is_empty() {
        State::Broken
    } else if out.followed >= PROBATION_UNITS {
        State::Eligible
    } else {
        State::Waiting
    };
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mine::Rule;
    use crate::practices::{AUTHN, ConcernReport, UnitRow, Variant, VariantKind};

    const AUTH: &str = "wrap:lib/auth.ts#withAuth";

    /// A unit at `app/api/r<i>/route.ts`: guarded, unguarded or unknown.
    fn row(i: usize, how: &str) -> UnitRow {
        UnitRow {
            path: format!("app/api/r{i:02}/route.ts"),
            symbol: "GET".into(),
            line: 1,
            variant: match how {
                "follows" => "P-auth".into(),
                "breaks" => "P-none".into(),
                _ => String::new(),
            },
            assignment: match how {
                "follows" => "known",
                "breaks" => "none",
                _ => "unknown",
            }
            .into(),
            ..UnitRow::default()
        }
    }

    fn report(rows: Vec<UnitRow>) -> PracticesReport {
        let v = |id: &str, key: &str, kind| Variant {
            id: id.into(),
            key: key.into(),
            label: id.into(),
            kind,
            ..Variant::default()
        };
        PracticesReport {
            concerns: vec![ConcernReport {
                id: AUTHN.into(),
                unit: "entry_point".into(),
                variants: vec![
                    v("P-auth", AUTH, VariantKind::Known),
                    v("P-none", "none", VariantKind::None),
                ],
                units: rows,
                ..ConcernReport::default()
            }],
            ..PracticesReport::default()
        }
    }

    /// The practice `drift practices promote P-auth --in app/api` writes.
    fn practice() -> Convention {
        let r = report(rows(0..20, "follows"));
        let place = promote::Place::parse("app/api", &r).unwrap();
        let req = promote::Request {
            ways: vec!["P-auth".into()],
            ..promote::Request::default()
        };
        promote::convention(&promote::candidate_for(&r, Some(&place), &req).unwrap())
    }

    fn rows(range: std::ops::Range<usize>, how: &str) -> Vec<UnitRow> {
        range.map(|i| row(i, how)).collect()
    }

    const NOTHING_HELD: &dyn Fn(&str) -> bool = &|_| false;

    /// Pins: units there when it was put on probation never count, whatever they do.
    #[test]
    fn units_there_at_the_start_never_count() {
        let c = practice();
        let mut at = rows(0..20, "follows");
        at.extend(rows(20..22, "breaks"));
        let rec = start(&report(at.clone()), &c);
        assert_eq!(rec.at_start.len(), 22);
        let n = count(&report(at), &c, &rec, NOTHING_HELD);
        assert_eq!((n.state, n.counted, n.at_start), (State::Waiting, 0, 22));
    }

    /// Pins: K new units that all follow make it eligible, and not one fewer.
    #[test]
    fn it_is_eligible_after_k_new_units_that_all_follow() {
        let c = practice();
        let rec = start(&report(rows(0..10, "follows")), &c);
        let n = count(&report(rows(0..24, "follows")), &c, &rec, NOTHING_HELD);
        assert_eq!((n.state, n.counted, n.followed), (State::Waiting, 14, 14));
        let n = count(&report(rows(0..25, "follows")), &c, &rec, NOTHING_HELD);
        assert_eq!((n.state, n.counted), (State::Eligible, PROBATION_UNITS));
        let said = n.sentence("entry_point");
        assert!(
            said.contains(&format!("`drift review --block {}`", c.id)),
            "{said}"
        );
    }

    /// Pins: unknown is never a violation, and never evidence either.
    #[test]
    fn an_unknown_unit_neither_counts_nor_breaks() {
        let c = practice();
        let rec = start(&report(Vec::new()), &c);
        let mut now = rows(0..14, "follows");
        now.extend(rows(14..30, "unknown"));
        let n = count(&report(now), &c, &rec, NOTHING_HELD);
        assert_eq!((n.state, n.counted, n.unknown), (State::Waiting, 14, 16));
    }

    /// Pins: one new unit that breaks it makes it not eligible, named.
    #[test]
    fn a_new_unit_that_breaks_it_is_named_and_stops_it() {
        let c = practice();
        let rec = start(&report(Vec::new()), &c);
        let mut now = rows(0..20, "follows");
        now.push(row(20, "breaks"));
        let n = count(&report(now), &c, &rec, NOTHING_HELD);
        assert_eq!(n.state, State::Broken);
        assert_eq!(n.broke, vec!["app/api/r20/route.ts#GET".to_string()]);
    }

    /// Pins: a record of another rule (another way accepted, another place) counts
    /// nothing, and neither does one without a rule line.
    #[test]
    fn a_record_of_another_rule_counts_nothing() {
        let c = practice();
        let rec = start(&report(Vec::new()), &c);
        let mut wider = c.clone();
        if let Rule::Practice { any_of, .. } = &mut wider.rule {
            any_of.push("wrap:lib/other.ts#other".into());
        }
        let n = count(&report(rows(0..20, "follows")), &wider, &rec, NOTHING_HELD);
        assert_eq!((n.state, n.counted), (State::Void, 0));
        let bare = Record { rule: None, ..rec };
        let n = count(&report(rows(0..20, "follows")), &c, &bare, NOTHING_HELD);
        assert_eq!(n.state, State::Void);
    }

    /// Pins: units in files the caller holds back (a change that edits the record)
    /// do not count, and are said apart.
    #[test]
    fn units_in_held_files_do_not_count() {
        let c = practice();
        let rec = start(&report(Vec::new()), &c);
        let held = |p: &str| p >= "app/api/r10";
        let n = count(&report(rows(0..20, "follows")), &c, &rec, &held);
        assert_eq!((n.state, n.counted, n.held_back), (State::Waiting, 10, 10));
    }

    /// Pins: the file reads back as written, sorted whatever the order of the lines, and
    /// a line it does not understand is dropped, never read as a unit.
    #[test]
    fn the_file_reads_back_as_written() {
        let c = practice();
        let mut p = Probations::default();
        p.records
            .insert(c.id.clone(), start(&report(rows(0..3, "follows")), &c));
        let text = p.render();
        assert_eq!(Probations::parse(&text), p);
        let mut lines: Vec<&str> = text.lines().collect();
        lines.reverse();
        let mut shuffled = lines.join("\n");
        shuffled.push_str(&format!("\n{} garbage\n", c.id));
        assert_eq!(Probations::parse(&shuffled).render(), text);
    }
}
