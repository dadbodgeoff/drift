//! Probation: how a promoted practice could earn block mode where there is no git history
//! to replay (a shallow CI clone, a repository without commits; audit 6 G2).
//!
//! Today a promoted practice blocks only after a replay of the units last added to its
//! place, by the commit that first added each file ([`super::promote::replay`]); without
//! history it advises, and says why. Probation is the forward version of that replay:
//! when the practice is accepted, the units of its place are recorded; from then on, each
//! new unit `drift check` sees is recorded once Drift can tell whether it follows. After
//! [`PROBATION_UNITS`] new units that all followed, the practice has held, and a person
//! could be offered block mode. One that broke ends it, naming the unit.
//!
//! Unknown is never a violation, and never evidence: a unit Drift cannot read neither
//! counts towards the K nor breaks the probation, and is recorded only once it can be
//! told. Units that were there at acceptance never count: they are what the practice was
//! promoted from, not what came after.
//!
//! **Written and switched off** ([`ENABLED`]): nothing reads or writes this state, the
//! lock, `drift check` and the block gate do not call it, and a practice without history
//! is still refused block mode. Pure logic only, so the owner can decide on it with the
//! tests in hand.
//!
//! Deterministic: units are keyed `path#symbol` and recorded in sorted order within one
//! update.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use super::PracticesReport;
use super::UnitRow;
use super::promote::Place;

/// Whether probation may lift the refusal to block without history. Off: switching it on
/// is the owner's decision, and wiring it is not done (see the module's doc).
pub const ENABLED: bool = false;

/// K: how many new units a promoted practice must hold across before it may block. The
/// owner has not approved this number; it is the replay's (15 units, decision D7's role
/// size for block mode), so the two paths ask as much of a practice until they decide.
pub const PROBATION_UNITS: usize = 15;

/// What is recorded of one promoted practice on probation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Probation {
    /// The promoted practice (`D-…`).
    pub id: String,
    /// Every unit of its place when it was accepted (`path#symbol`), whatever the map
    /// said of it: none of them ever counts.
    pub at_acceptance: BTreeSet<String>,
    /// The new units seen since, each once, in the order Drift could first tell them.
    pub seen: Vec<Seen>,
}

/// One new unit and whether it followed the practice.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Seen {
    /// `path#symbol`.
    pub unit: String,
    /// False once it has been seen breaking the practice, even if it follows later: a
    /// unit that broke it during probation is what a person has to look at.
    pub followed: bool,
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Decision {
    /// The first [`PROBATION_UNITS`] new units all followed: block mode may be offered.
    Held { seen: usize },
    /// A new unit broke it (the first that did, in the order seen).
    Broke { unit: String },
    /// Not enough new units yet: `seen` of `of`.
    Waiting { seen: usize, of: usize },
}

impl Probation {
    /// The probation of the practice `id`, accepted when its place held `units`.
    pub fn start(id: &str, units: impl IntoIterator<Item = String>) -> Self {
        Probation {
            id: id.to_string(),
            at_acceptance: units.into_iter().collect(),
            seen: Vec::new(),
        }
    }

    /// Records what one run of `drift check` observed ([`observe`]): each new unit Drift
    /// could tell, once (in sorted order, whatever the order given); a unit seen before
    /// that now breaks is marked so. A unit there at acceptance, and an unknown one, is
    /// left out. Returns how many units were recorded for the first time.
    pub fn update(&mut self, observed: &[(String, Observed)]) -> usize {
        let mut sorted: Vec<&(String, Observed)> = observed.iter().collect();
        sorted.sort();
        let mut added = 0;
        for (unit, obs) in sorted {
            if self.at_acceptance.contains(unit) || *obs == Observed::Unknown {
                continue;
            }
            match self.seen.iter_mut().find(|s| s.unit == *unit) {
                Some(s) => {
                    if *obs == Observed::Breaks {
                        s.followed = false;
                    }
                }
                None => {
                    self.seen.push(Seen {
                        unit: unit.clone(),
                        followed: *obs == Observed::Follows,
                    });
                    added += 1;
                }
            }
        }
        added
    }

    /// Where it stands, from the first [`PROBATION_UNITS`] new units seen: broken by the
    /// first of them that broke, held when there are that many and all followed,
    /// waiting otherwise.
    pub fn decision(&self) -> Decision {
        let first: Vec<&Seen> = self.seen.iter().take(PROBATION_UNITS).collect();
        if let Some(s) = first.iter().find(|s| !s.followed) {
            return Decision::Broke {
                unit: s.unit.clone(),
            };
        }
        if first.len() == PROBATION_UNITS {
            Decision::Held { seen: first.len() }
        } else {
            Decision::Waiting {
                seen: first.len(),
                of: PROBATION_UNITS,
            }
        }
    }
}

/// The units of `concern` in `place` (`path#symbol`), as `report` (made with every unit
/// listed) has them: what [`Probation::start`] records. Membership is the one `drift
/// check` and the replay read ([`super::promote::place_units`]), never the files a
/// place could hold ([`Place::holds`]): a route place holds the entry points served
/// under its prefix (and those whose route was not read and could be), not every file
/// of its package, and a background job of a concern about the caller is in no place.
pub fn units_of(report: &PracticesReport, concern: &str, place: &Place) -> BTreeSet<String> {
    super::promote::place_units(report, concern, place)
        .into_iter()
        .map(|(unit, _)| unit)
        .collect()
}

/// What one practices report says of each unit of `concern` in `place`, as
/// [`Probation::update`] takes it: `judge` says whether a row the map knows follows the
/// practice (the promoted practice's own reading; [`super::promote`] has it). A row the
/// map does not know is unknown whatever `judge` says, and so is a row in a route place
/// only as a route Drift did not read to the end. A handler mounted more than once is
/// one unit: the worst of its rows decides (one that breaks, else one unknown). The
/// units are those of [`units_of`], the check's own membership. Sorted by unit.
pub fn observe(
    report: &PracticesReport,
    concern: &str,
    place: &Place,
    judge: impl Fn(&UnitRow) -> Observed,
) -> Vec<(String, Observed)> {
    let mut out: Vec<(String, Observed)> = Vec::new();
    for (unit, rows) in super::promote::place_units(report, concern, place) {
        let worst = rows
            .iter()
            .map(|(u, not_read)| {
                if *not_read || u.assignment == "unknown" {
                    Observed::Unknown
                } else {
                    judge(u)
                }
            })
            .max();
        if let Some(obs) = worst {
            out.push((unit, obs));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::practices::ConcernReport;

    fn units(range: std::ops::Range<usize>) -> Vec<String> {
        range.map(|i| format!("app/api/r{i:02}.ts#GET")).collect()
    }

    fn all(units: &[String], obs: Observed) -> Vec<(String, Observed)> {
        units.iter().map(|u| (u.clone(), obs)).collect()
    }

    #[test]
    fn units_there_at_acceptance_never_count() {
        let mut p = Probation::start("D-1", units(0..40));
        assert_eq!(p.update(&all(&units(0..40), Observed::Breaks)), 0);
        assert_eq!(p.decision(), Decision::Waiting { seen: 0, of: 15 });
    }

    #[test]
    fn it_holds_after_k_new_units_that_all_follow() {
        let mut p = Probation::start("D-1", units(0..40));
        assert_eq!(p.update(&all(&units(40..50), Observed::Follows)), 10);
        assert_eq!(p.decision(), Decision::Waiting { seen: 10, of: 15 });
        // The same units again are not counted twice.
        assert_eq!(p.update(&all(&units(40..50), Observed::Follows)), 0);
        p.update(&all(&units(50..55), Observed::Follows));
        assert_eq!(p.decision(), Decision::Held { seen: 15 });
    }

    /// Unknown is never a violation, and never evidence either.
    #[test]
    fn an_unknown_unit_neither_counts_nor_breaks() {
        let mut p = Probation::start("D-1", Vec::new());
        assert_eq!(p.update(&all(&units(0..20), Observed::Unknown)), 0);
        assert_eq!(p.decision(), Decision::Waiting { seen: 0, of: 15 });
        // Once it can be told, it counts.
        p.update(&all(&units(0..15), Observed::Follows));
        assert_eq!(p.decision(), Decision::Held { seen: 15 });
    }

    #[test]
    fn one_new_unit_that_breaks_ends_it_and_is_named() {
        let mut p = Probation::start("D-1", Vec::new());
        let mut obs = all(&units(0..5), Observed::Follows);
        obs.push(("app/api/x.ts#POST".into(), Observed::Breaks));
        obs.push(("app/api/w.ts#POST".into(), Observed::Breaks));
        p.update(&obs);
        // In sorted order, w before x.
        assert_eq!(
            p.decision(),
            Decision::Broke {
                unit: "app/api/w.ts#POST".into()
            }
        );
    }

    /// A unit that followed and later breaks breaks the probation; one that broke and
    /// later follows does not mend it.
    #[test]
    fn a_break_seen_later_counts_and_stays() {
        let mut p = Probation::start("D-1", Vec::new());
        p.update(&all(&units(0..15), Observed::Follows));
        assert_eq!(p.decision(), Decision::Held { seen: 15 });
        p.update(&[(units(3..4)[0].clone(), Observed::Breaks)]);
        assert_eq!(
            p.decision(),
            Decision::Broke {
                unit: units(3..4)[0].clone()
            }
        );
        p.update(&[(units(3..4)[0].clone(), Observed::Follows)]);
        assert!(matches!(p.decision(), Decision::Broke { .. }));
    }

    #[test]
    fn the_order_given_does_not_change_what_is_recorded() {
        let mut obs = all(&units(0..6), Observed::Follows);
        let mut a = Probation::start("D-1", Vec::new());
        a.update(&obs);
        obs.reverse();
        let mut b = Probation::start("D-1", Vec::new());
        b.update(&obs);
        assert_eq!(a, b);
    }

    /// What a report says: only the place's units, an unknown row is unknown whatever
    /// the judge says, and a unit mounted twice is the worst of its rows.
    #[test]
    fn a_report_is_observed_unit_by_unit() {
        let row = |path: &str, assignment: &str, line: u32| UnitRow {
            path: path.into(),
            symbol: "GET".into(),
            line,
            assignment: assignment.into(),
            ..UnitRow::default()
        };
        let report = PracticesReport {
            concerns: vec![ConcernReport {
                id: "authn".into(),
                units: vec![
                    row("app/api/a.ts", "known", 1),
                    row("app/api/b.ts", "unknown", 1),
                    row("app/api/c.ts", "known", 1),
                    row("app/api/c.ts", "none", 9),
                    row("lib/d.ts", "known", 1),
                ],
                ..ConcernReport::default()
            }],
            ..PracticesReport::default()
        };
        let place = Place::parse("app/api", &report).unwrap();
        let obs = observe(&report, "authn", &place, |u| {
            if u.assignment == "known" {
                Observed::Follows
            } else {
                Observed::Breaks
            }
        });
        assert_eq!(
            obs,
            vec![
                ("app/api/a.ts#GET".to_string(), Observed::Follows),
                ("app/api/b.ts#GET".to_string(), Observed::Unknown),
                ("app/api/c.ts#GET".to_string(), Observed::Breaks),
            ]
        );
        assert_eq!(units_of(&report, "authn", &place).len(), 3);
    }

    /// Pins review item 8 (area 2): a route place's units are the ones `drift check`
    /// and the replay read there, not every file of its package. Before, probation
    /// read `Place::holds`, which is every file of the package for a route place: the
    /// job, the server action and the route served elsewhere were all its units.
    #[test]
    fn a_route_place_holds_what_the_check_reads_there() {
        let row = |path: &str, kind: &str, route: Option<&str>| UnitRow {
            path: path.into(),
            symbol: "GET".into(),
            line: 1,
            assignment: "known".into(),
            kind: Some(kind.into()),
            route: route.map(str::to_string),
            ..UnitRow::default()
        };
        let report = PracticesReport {
            concerns: vec![ConcernReport {
                id: "authn".into(),
                unit: "entry_point".into(),
                units: vec![
                    row("app/api/a/route.ts", "http", Some("/api/a")),
                    row("app/other/route.ts", "http", Some("/other")),
                    // A route Drift could not read: it could be under /api, not read.
                    row("app/x/route.ts", "http", None),
                    row("app/actions.ts", "server_action", None),
                    row("jobs/nightly.ts", "job", None),
                ],
                ..ConcernReport::default()
            }],
            ..PracticesReport::default()
        };
        let place = Place::parse(".:/api", &report).unwrap();
        assert_eq!(
            units_of(&report, "authn", &place),
            ["app/api/a/route.ts#GET", "app/x/route.ts#GET"]
                .into_iter()
                .map(str::to_string)
                .collect::<BTreeSet<_>>()
        );
        let obs = observe(&report, "authn", &place, |_| Observed::Follows);
        assert_eq!(
            obs,
            vec![
                ("app/api/a/route.ts#GET".to_string(), Observed::Follows),
                ("app/x/route.ts#GET".to_string(), Observed::Unknown),
            ]
        );
    }
}
