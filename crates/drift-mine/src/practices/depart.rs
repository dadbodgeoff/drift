//! What a file's units do differently from the units around them: the practice map
//! read for one file, so a hook can say it when the file is written.
//!
//! The report already lists, per variant, the units in its places that do it another
//! way ([`super::Variant::exceptions`], PLAN-R13 §3): a place is a package or one of
//! its directories, of at least [`MIN_ROLE_SIZE`] units, where one variant holds at
//! least [`PLACE_SHARE`]. That list is of the code as it stands, capped, and broadest
//! place first. This reads the same definition the other way round, for the units of
//! one file: the narrowest place around a unit that has a dominant variant decides.
//! The unit departs when it is assigned (known or `none`) and does not use that
//! variant. A unit that follows the way of its own directory does not depart from the
//! package's (an `internal/` directory with its own guard), and a place whose dominant
//! variant is `none` or unknown asks for nothing.
//!
//! The file's own units are left out of its places' counts: what the others do is the
//! fact, however many units the file adds. Facts, not rules: nothing here is checked
//! or blocks, and an unknown unit is never reported.
//!
//! Deterministic: rows are read in report order, places and results are sorted.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::{
    Concern, ConcernReport, Example, PRIMARY, PracticesReport, UnitRow, Variant, VariantKind,
};
use crate::mine::MIN_ROLE_SIZE;
use crate::report::sanitize;

/// The smallest share of the other units of a place its dominant variant must hold
/// (the report's exception places use the same share).
pub const PLACE_SHARE: f64 = 0.8;

/// Units named in one line before "and N more".
const NAMED: usize = 3;

/// Units of one file that do a concern another way than the units around them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Departure {
    pub concern: String,
    /// What one unit of the concern is (`entry_point`, ...): [`ConcernReport::unit`].
    pub unit: String,
    /// The file the units are in.
    pub path: String,
    pub package: String,
    /// The place the variant is dominant in: a directory, or "" for the whole package.
    pub dir: String,
    /// The variant the other units of the place use (`P-…`), and its label.
    pub variant: String,
    pub label: String,
    /// How many of the place's other units use it, of how many.
    pub held: usize,
    pub others: usize,
    /// A unit of the place that uses it, to copy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub example: Option<Example>,
    /// The file's units that do not, sorted by line.
    pub units: Vec<DepartingUnit>,
    /// The command that makes the place's way the rule for new code there (`drift
    /// practices promote <id> --in <place>`), only when the command would take it as the
    /// code stands ([`super::promote::candidate_for`]): never one it then refuses. For
    /// people ([`Departure::line_with_promote`]); an agent may not promote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub promote: Option<String>,
}

/// One unit that departs, and what it does instead.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DepartingUnit {
    pub line: u32,
    pub symbol: String,
    /// Its own variant (`P-…`).
    pub variant: String,
    /// What it does: the variant's label, `none (…)` for a recorded absence, with
    /// what this unit's own reading saw and did not read.
    pub does: String,
    /// Of a `none` unit: its variant's label and what its own reading saw and did not
    /// read ([`super::UnitRow::basis`]), for a line that says several units at once
    /// ([`Departure::line`]). In process only, never serialised.
    #[serde(skip)]
    pub none: Option<(String, Vec<super::basis::NotRead>)>,
}

impl Departure {
    /// One key per departing unit: what a session has already seen or started with.
    pub fn keys(&self) -> Vec<String> {
        self.units
            .iter()
            .map(|u| {
                format!(
                    "practice|{}|{}|{}|{}",
                    self.concern, self.path, u.symbol, self.variant
                )
            })
            .collect()
    }

    /// What the file's units do, each way once: a unit's own words, and for the
    /// `none` units of one variant together, what their readings saw and did not
    /// read and how many units that covers ([`super::basis::none_across`]). Never
    /// what a unit of another file, or another service, did not read.
    fn does(&self) -> BTreeSet<String> {
        let mut none: BTreeMap<&str, (&str, BTreeSet<&super::basis::NotRead>, usize)> =
            BTreeMap::new();
        let mut out = BTreeSet::new();
        for u in &self.units {
            match &u.none {
                Some((label, not_read)) => {
                    let e = none.entry(u.variant.as_str()).or_insert((
                        label.as_str(),
                        BTreeSet::new(),
                        0,
                    ));
                    e.1.extend(not_read);
                    e.2 += 1;
                }
                None => {
                    out.insert(u.does.clone());
                }
            }
        }
        for (label, not_read, units) in none.into_values() {
            let not_read: Vec<super::basis::NotRead> = not_read.into_iter().cloned().collect();
            out.insert(super::basis::none_across(label, &not_read, units));
        }
        out
    }

    /// The departure in one line for an agent: the fact about the place, what the
    /// file's units do, and a unit to copy.
    pub fn line(&self) -> String {
        let place = if self.dir.is_empty() {
            if self.package.is_empty() {
                "this repository".to_string()
            } else {
                format!("package {}", sanitize(&self.package, 120))
            }
        } else {
            sanitize(&self.dir, 160)
        };
        let mut named: Vec<String> = self
            .units
            .iter()
            .take(NAMED)
            .map(|u| format!("{}:{}", sanitize(&u.symbol, 80), u.line))
            .collect();
        if self.units.len() > NAMED {
            named.push(format!("{} more", self.units.len() - NAMED));
        }
        let does = self
            .does()
            .iter()
            .map(|d| sanitize(d, 120))
            .collect::<Vec<_>>()
            .join(" / ");
        let what = if self.unit == "entry_point" {
            "entry points"
        } else {
            "units"
        };
        let mut out = format!(
            "{}: {} of the {} other {what} in {} use {} [{}]; here {} {}: {}",
            self.concern,
            self.held,
            self.others,
            place,
            sanitize(&self.label, 120),
            sanitize(&self.variant, 16),
            named.join(", "),
            if self.units.len() == 1 { "does" } else { "do" },
            does,
        );
        if let Some(e) = &self.example {
            out.push_str(&format!(
                " (copy {}:{} {})",
                sanitize(&e.path, 160),
                e.line,
                sanitize(&e.symbol, 80)
            ));
        }
        out
    }

    /// [`Departure::line`] for a person (`drift check`'s text, a pull request's notices
    /// and job summary), with how to make the place's way the rule for new code when the
    /// command would take it ([`Departure::promote`]). An agent reads [`Departure::line`]:
    /// promoting is a person's decision, and the hooks refuse the command to an agent.
    pub fn line_with_promote(&self) -> String {
        let mut out = self.line();
        if let Some(cmd) = &self.promote {
            out.push_str(&format!(
                "; to make it the rule for new code there: `{}`",
                sanitize(cmd, 240)
            ));
        }
        out
    }
}

/// The departures of `rel`'s units in a report made with every unit listed
/// ([`super::Options::units`]); of every file when `rel` is `None`. Only the concerns
/// that reach agents ([`PRIMARY`]). Empty when the report lists no units.
pub fn departures(report: &PracticesReport, rel: Option<&str>) -> Vec<Departure> {
    let probes = probes(report);
    let mut out: Vec<Departure> = report
        .concerns
        .iter()
        .filter(|c| PRIMARY.contains(&c.id.as_str()))
        .flat_map(|c| concern_departures(report, c, rel, &probes))
        .collect();
    out.sort_by(|a, b| {
        (&a.concern, &a.path, &a.dir, &a.variant).cmp(&(&b.concern, &b.path, &b.dir, &b.variant))
    });
    out
}

/// Departures `drift check` lists one by one in its text report and job summary.
pub const CHECK_LISTED: usize = 10;

/// Departures annotated one by one on a pull request: GitHub keeps about ten notices
/// per step, and violations come first.
pub const CHECK_NOTICES: usize = 5;

/// The files `deps` are in.
fn files(deps: &[Departure]) -> usize {
    deps.iter()
        .map(|d| d.path.as_str())
        .collect::<BTreeSet<_>>()
        .len()
}

/// `drift check`'s text for the departures of the files it looked at: a heading that
/// says they are facts and fail nothing, then one line each ([`Departure::line`]) for
/// the first [`CHECK_LISTED`]. Empty when nothing departs.
pub fn check_text(deps: &[Departure]) -> String {
    if deps.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "drift: practices (facts, not rules; they never fail the check): {} file(s) do a concern differently from the entry points around them\n",
        files(deps)
    );
    for d in deps.iter().take(CHECK_LISTED) {
        out.push_str(&format!("  {}: {}\n", sanitize(&d.path, 160), d.line_with_promote()));
    }
    if deps.len() > CHECK_LISTED {
        out.push_str(&format!(
            "  and {} more: `drift card <file>` has each file's\n",
            deps.len() - CHECK_LISTED
        ));
    }
    out
}

/// One `::notice` per departure for the first [`CHECK_NOTICES`], on the first unit that
/// departs, so a pull request shows the fact where the code is. `prefix` is the
/// repository's directory under the git top level (annotations name files from there).
pub fn github_notices(deps: &[Departure], prefix: &str) -> String {
    use crate::report::{github_escape_data, github_escape_property};
    let mut out = String::new();
    for d in deps.iter().take(CHECK_NOTICES) {
        let file: String = format!("{prefix}{}", d.path)
            .chars()
            .filter(|c| !c.is_control())
            .collect();
        out.push_str(&format!(
            "::notice file={},line={},title={}::{}\n",
            github_escape_property(&file),
            d.units.first().map_or(1, |u| u.line.max(1)),
            github_escape_property(&format!("drift practices: {}", sanitize(&d.concern, 32))),
            github_escape_data(&format!(
                "{}. A fact, not a rule: it does not fail the check.",
                d.line_with_promote()
            )),
        ));
    }
    out
}

/// The job summary's section for the departures (markdown); empty when nothing departs.
pub fn github_summary(deps: &[Departure]) -> String {
    use crate::report::{md, md_code};
    if deps.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "### Practices\n\nFacts, not rules: they never fail the check. {} file(s) do a concern differently from at least {}% of the entry points around them.\n\n",
        files(deps),
        (PLACE_SHARE * 100.0).round()
    );
    for d in deps.iter().take(CHECK_LISTED) {
        out.push_str(&format!(
            "- {}: {}\n",
            md_code(&sanitize(&d.path, 160)),
            md(&d.line_with_promote())
        ));
    }
    if deps.len() > CHECK_LISTED {
        out.push_str(&format!(
            "\n+{} more: `drift card <file>` has each file's.\n",
            deps.len() - CHECK_LISTED
        ));
    }
    out
}

/// An entry point a change adds, whose authentication the
/// practice map does not know to turn callers away: `none` (no guard found in what
/// Drift read), `identified` (the caller is identified and no one turned away) or
/// `unknown`. A fact for a pull request, never a violation: `drift check
/// --diff-base` lists it whatever the entry points around it do, which a departure
/// ([`Departure`]) needs a dominant way for.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct AddedEntry {
    /// The file the entry point's code is in.
    pub path: String,
    pub line: u32,
    pub symbol: String,
    /// Its kind ([`crate::security::ADDED_KINDS`]).
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    /// The practice map's answer for its authentication: `none`, `identified` or
    /// `unknown`.
    pub assignment: String,
    /// The answer in words, as the other surfaces say it.
    pub says: String,
}

impl AddedEntry {
    /// `GET /api/x [http]: no guard found in what Drift read`.
    pub fn line(&self) -> String {
        let mut what = String::new();
        if let Some(m) = &self.method {
            what.push_str(m);
            what.push(' ');
        }
        what.push_str(self.route.as_deref().unwrap_or(&self.symbol));
        format!(
            "{} [{}]: {}",
            sanitize(&what, 120),
            sanitize(&self.kind, 40),
            sanitize(&self.says, 240)
        )
    }
}

/// The entry points of `report` (made with every unit listed) whose authentication is
/// `none`, `identified` or unknown, of a kind a person's request reaches, whose
/// entry point `added` says the change adds (path, line, symbol, method, route: an
/// entry point the base does not have, not a declaration that grew). `kind_of` gives
/// an entry point's kind by its file and symbol; one it does not know is left out.
pub fn added_entries(
    report: &PracticesReport,
    kind_of: impl Fn(&str, &str) -> Option<String>,
    added: impl Fn(&str, u32, &str, Option<&str>, Option<&str>) -> bool,
) -> Vec<AddedEntry> {
    let Some(authn) = report.concerns.iter().find(|c| c.id == super::AUTHN) else {
        return Vec::new();
    };
    let mut out: Vec<AddedEntry> = authn
        .units
        .iter()
        .filter(|u| {
            u.assignment != "known"
                && added(
                    &u.path,
                    u.line,
                    &u.symbol,
                    u.method.as_deref(),
                    u.route.as_deref(),
                )
        })
        .filter_map(|u| {
            let kind = kind_of(&u.path, &u.symbol)
                .filter(|k| crate::security::ADDED_KINDS.contains(&k.as_str()))?;
            let says = match u.assignment.as_str() {
                "none" => super::basis::no_guard(
                    u.basis.as_ref().map_or(&[][..], |b| b.not_read.as_slice()),
                ),
                "identified" => authn
                    .variants
                    .iter()
                    .find(|v| v.id == u.variant)
                    .map_or_else(|| super::basis::identified(&[]), |v| v.label.clone()),
                _ => format!(
                    "unknown: Drift cannot tell whether it requires sign-in ({})",
                    unknown_words(u.reason.unwrap_or_default())
                ),
            };
            Some(AddedEntry {
                path: u.path.clone(),
                line: u.line,
                symbol: u.symbol.clone(),
                kind,
                method: u.method.clone(),
                route: u.route.clone(),
                assignment: u.assignment.clone(),
                says,
            })
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Why an [`AddedEntry`] is unknown, in a few words.
fn unknown_words(reason: super::UnknownReason) -> &'static str {
    use super::UnknownReason as R;
    match reason {
        R::Unparsed => "a file of it was not parsed",
        R::OpaqueWrapper => "a wrapper Drift cannot see into",
        R::Unresolved => "a name that does not resolve",
        R::NoSymbol => "its handler was not found",
        R::Dynamic => "code Drift cannot follow",
        R::BodyUnreadable => "a call whose body Drift cannot read",
        R::NotFollowed => "a value handed to a callee Drift does not follow",
        R::RouteNotMatched => "a route Drift cannot match",
        R::Unclassified => "a call no vocabulary, usage or declaration classifies",
        R::CheckNotProven => "a check found and not proven",
        R::PartlyRead => "a method of a value whose type Drift does not know",
        R::Forwarded => "the request handed on to another service",
        R::SignatureNotProven => "a signature check not proven to stop the request",
    }
}

/// `drift check`'s text for the entry points the change adds with no guard found or
/// an unknown one ([`added_entries`]): a heading that says they are facts and fail
/// nothing, then one line each for the first [`CHECK_LISTED`]. Empty when there is none.
pub fn added_text(added: &[AddedEntry]) -> String {
    if added.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "drift: practices (facts, not rules; they never fail the check): {} entry point(s) this change adds where Drift found no sign-in guard, or cannot tell\n",
        added.len()
    );
    for a in added.iter().take(CHECK_LISTED) {
        out.push_str(&format!(
            "  {}:{} {}\n",
            sanitize(&a.path, 160),
            a.line,
            a.line()
        ));
    }
    if added.len() > CHECK_LISTED {
        out.push_str(&format!(
            "  and {} more: `drift security --diff-base` lists each\n",
            added.len() - CHECK_LISTED
        ));
    }
    out
}

/// One `::notice` per entry point of [`added_entries`] for the first [`CHECK_NOTICES`].
/// `prefix` is the repository's directory under the git top level.
pub fn added_notices(added: &[AddedEntry], prefix: &str) -> String {
    use crate::report::{github_escape_data, github_escape_property};
    let mut out = String::new();
    for a in added.iter().take(CHECK_NOTICES) {
        let file: String = format!("{prefix}{}", a.path)
            .chars()
            .filter(|c| !c.is_control())
            .collect();
        out.push_str(&format!(
            "::notice file={},line={},title={}::{}\n",
            github_escape_property(&file),
            a.line.max(1),
            github_escape_property("drift practices: authn"),
            github_escape_data(&format!(
                "New entry point {}. A fact, not a rule: it does not fail the check.",
                a.line()
            )),
        ));
    }
    out
}

/// The job summary's section for [`added_entries`] (markdown); empty when there is none.
pub fn added_summary(added: &[AddedEntry]) -> String {
    use crate::report::{md, md_code};
    if added.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "### New entry points\n\nFacts, not rules: they never fail the check. {} entry point(s) this change adds where Drift found no sign-in guard, or cannot tell.\n\n",
        added.len()
    );
    for a in added.iter().take(CHECK_LISTED) {
        out.push_str(&format!(
            "- {}: {}\n",
            md_code(&format!("{}:{}", sanitize(&a.path, 160), a.line)),
            md(&a.line())
        ));
    }
    if added.len() > CHECK_LISTED {
        out.push_str(&format!(
            "\n+{} more: `drift security --diff-base` lists each.\n",
            added.len() - CHECK_LISTED
        ));
    }
    out
}

/// What a unit's own reading saw and did not read ([`UnitRow::basis`]).
fn unit_not_read(u: &UnitRow) -> &[super::basis::NotRead] {
    u.basis.as_ref().map_or(&[], |b| b.not_read.as_slice())
}

/// A unit by where it is: its file, symbol and line.
type UnitAt<'a> = (&'a str, &'a str, u32);

/// The liveness and readiness probes of the report: the units authn reads as open
/// because they are one ([`is_probe`]). A probe answers an orchestrator: it has no
/// caller to sign in, no input to validate and no failure to map, so it is compared
/// with the routes around it in no concern.
fn probes(report: &PracticesReport) -> BTreeSet<UnitAt<'_>> {
    let Some(authn) = report.concerns.iter().find(|c| c.id == super::AUTHN) else {
        return BTreeSet::new();
    };
    let ids: BTreeSet<&str> = authn
        .variants
        .iter()
        .filter(|v| is_probe(authn, v))
        .map(|v| v.id.as_str())
        .collect();
    authn
        .units
        .iter()
        .filter(|u| ids.contains(u.variant.as_str()))
        .map(|u| (u.path.as_str(), u.symbol.as_str(), u.line))
        .collect()
}

/// The uses a variant key names (`dependency:a+dependency:b`), cut only between uses
/// ([`super::common::split_uses`]: an instrument may hold a `+`).
fn uses(key: &str) -> BTreeSet<&str> {
    super::common::split_uses(key).into_iter().collect()
}

/// The unit does all the dominant way does, and more (`verify_api_key` and
/// `require_partner_tenant` as its neighbours, and `audit_write` besides): it follows
/// the way, it does not do another. A key that stands for several ways (the tail, a
/// folded policy) names no uses and is never followed this way.
fn follows(own: &str, dominant: &str) -> bool {
    own != super::TAIL && dominant != super::TAIL && uses(own).is_superset(&uses(dominant))
}

/// Whether the variant key `key` is what code of the concern does by doing nothing, as
/// its classifier says ([`super::Concern::passive`]: errors left to the framework): every
/// alternative of a fold is, or the key's own uses are. A key that names no use (the
/// tail) is not.
fn passive_key(k: &dyn Concern, key: &str) -> bool {
    let alternatives: Vec<&str> = match key.strip_prefix("any_of(").and_then(|k| k.strip_suffix(')')) {
        Some(inner) => inner.split('|').collect(),
        None => vec![key],
    };
    !alternatives.is_empty()
        && alternatives.iter().all(|a| {
            let uses: Vec<super::Use> = super::common::use_keys(a)
                .into_iter()
                .map(super::common::use_from_key)
                .collect();
            !uses.is_empty() && k.passive(&uses)
        })
}

/// The variants of `c` code follows by doing nothing ([`passive_key`]): never the way a
/// departure is measured against, nor one to copy. A route that handles no error is not
/// one to point another route at (audit 3 G4).
fn passive_variants(c: &ConcernReport) -> BTreeSet<&str> {
    let Some(k) = super::registry().into_iter().find(|k| k.id() == c.id) else {
        return BTreeSet::new();
    };
    c.variants
        .iter()
        .filter(|v| passive_key(k.as_ref(), &v.key))
        .map(|v| v.id.as_str())
        .collect()
}

/// The command that promotes the variant `id` in the place `shown` (a path from the
/// repository root, `.` the root package), when `drift practices promote` would take it
/// as `report` stands ([`super::promote::candidate_for`]); `None` when it would refuse.
fn promote_command(report: &PracticesReport, shown: &str, id: &str) -> Option<String> {
    let place = super::promote::Place::parse(shown, report)?;
    let req = super::promote::Request {
        ways: vec![id.to_string()],
        ..super::promote::Request::default()
    };
    let cand = super::promote::candidate_for(report, Some(&place), &req).ok()?;
    Some(format!(
        "drift practices promote {} --in {}",
        sanitize(id, 40),
        sanitize(&cand.place.shown(), 160)
    ))
}

/// A departure's place as `--in` names it: its directory, else its package, else `.`.
fn shown_place(d: &Departure) -> String {
    if !d.dir.is_empty() {
        d.dir.clone()
    } else if !d.package.is_empty() {
        d.package.clone()
    } else {
        ".".to_string()
    }
}

fn concern_departures(
    report: &PracticesReport,
    c: &ConcernReport,
    rel: Option<&str>,
    probes: &BTreeSet<UnitAt<'_>>,
) -> Vec<Departure> {
    let variants: BTreeMap<&str, &Variant> =
        c.variants.iter().map(|v| (v.id.as_str(), v)).collect();
    let passive = passive_variants(c);
    // (package, directory) -> rows, as the report's exception places.
    let mut places: BTreeMap<(&str, String), Vec<usize>> = BTreeMap::new();
    for (i, u) in c.units.iter().enumerate() {
        for d in crate::security::role_dirs(&u.package, &u.path) {
            places.entry((u.package.as_str(), d)).or_default().push(i);
        }
    }
    // (path, dir, variant) -> the departure being built.
    let mut found: BTreeMap<(&str, String, &str), Departure> = BTreeMap::new();
    for u in &c.units {
        if rel.is_some_and(|r| r != u.path) || u.assignment == "unknown" {
            continue;
        }
        let Some(own) = variants.get(u.variant.as_str()) else {
            continue;
        };
        // A liveness or readiness probe is open on purpose, and is compared with the
        // routes around it in no concern ([`probes`]).
        if is_probe(c, own) || probes.contains(&(u.path.as_str(), u.symbol.as_str(), u.line)) {
            continue;
        }
        // The unit's own uses, where its variant stands for several ways.
        let own_key = u.key.as_deref().unwrap_or(own.key.as_str());
        // What a response is shaped like goes with the method (a `DELETE` answering 204
        // declares no model where the `GET`s around it do): such a unit is compared
        // with the units of its own method only.
        let like = u.method.as_deref().filter(|_| c.id == super::API);
        let mut dirs = crate::security::role_dirs(&u.package, &u.path);
        dirs.reverse();
        for dir in dirs {
            let Some(rows) = places.get(&(u.package.as_str(), dir.clone())) else {
                continue;
            };
            let Some(top) = dominant(&c.units, rows, &u.path, like) else {
                continue;
            };
            // The narrowest place with a dominant variant decides. A way code follows by
            // doing nothing asks for nothing, as a recorded absence does.
            let Some(tv) = variants
                .get(top.variant)
                .filter(|v| asks(v) && !passive.contains(v.id.as_str()))
            else {
                break;
            };
            if top.variant == u.variant || follows(own_key, &tv.key) {
                break;
            }
            found
                .entry((u.path.as_str(), dir.clone(), top.variant))
                .or_insert_with(|| Departure {
                    concern: c.id.clone(),
                    unit: c.unit.clone(),
                    path: u.path.clone(),
                    package: u.package.clone(),
                    dir,
                    variant: tv.id.clone(),
                    label: tv.label.clone(),
                    held: top.held,
                    others: top.others,
                    example: top.example.clone(),
                    units: Vec::new(),
                    promote: None,
                })
                .units
                .push(DepartingUnit {
                    line: u.line,
                    symbol: u.symbol.clone(),
                    variant: u.variant.clone(),
                    // What the unit itself does, not the name of a group of ways; a
                    // `none` with what its own reading did not read, never the
                    // variant's list of every unit's.
                    does: u.does.clone().unwrap_or_else(|| {
                        if own.kind == VariantKind::None {
                            super::basis::none(&own.label, unit_not_read(u))
                        } else {
                            own.label.clone()
                        }
                    }),
                    none: (u.does.is_none() && own.kind == VariantKind::None)
                        .then(|| (own.label.clone(), unit_not_read(u).to_vec())),
                });
            break;
        }
    }
    // One reading of the place per (place, way), however many files depart from it.
    let mut commands: BTreeMap<(String, String), Option<String>> = BTreeMap::new();
    found
        .into_values()
        .map(|mut d| {
            d.units.sort();
            d.units.dedup();
            let shown = shown_place(&d);
            d.promote = commands
                .entry((shown.clone(), d.variant.clone()))
                .or_insert_with(|| promote_command(report, &shown, &d.variant))
                .clone();
            d
        })
        .collect()
}

/// The authn variant of a probe ([`super::authn::PROBE`]): what opens it is that it is
/// one, and nothing else was found.
fn is_probe(c: &ConcernReport, v: &Variant) -> bool {
    c.id == super::AUTHN
        && v.mechanisms == [super::authn::OPENS]
        && v.instruments == [super::authn::PROBE]
}

/// A dominant variant is something to follow: a known way, not the concern's tail of
/// one-off ways, a recorded absence or an unknown.
fn asks(v: &Variant) -> bool {
    // What a person declared is their word, not a way the code is proven to do it.
    v.kind == VariantKind::Known
        && v.key != super::TAIL
        && v.source != super::VariantSource::Declared
}

struct Dominant<'a> {
    variant: &'a str,
    held: usize,
    others: usize,
    example: Option<Example>,
}

/// The variant most of a place's rows outside `path` use, when they are at least
/// [`MIN_ROLE_SIZE`] and it holds at least [`PLACE_SHARE`] of them; ties go to the
/// smaller id. Unknown rows count as rows and are no variant. With `method`, only the
/// rows of that HTTP method are the place's.
fn dominant<'a>(
    units: &'a [UnitRow],
    rows: &[usize],
    path: &str,
    method: Option<&str>,
) -> Option<Dominant<'a>> {
    let others: Vec<&UnitRow> = rows
        .iter()
        .map(|&i| &units[i])
        .filter(|u| u.path != path && method.is_none_or(|m| u.method.as_deref() == Some(m)))
        .collect();
    if others.len() < MIN_ROLE_SIZE {
        return None;
    }
    let mut count: BTreeMap<&str, usize> = BTreeMap::new();
    for u in &others {
        *count.entry(u.variant.as_str()).or_default() += 1;
    }
    let (variant, held) = count
        .into_iter()
        .min_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)))?;
    if (held as f64) < PLACE_SHARE * others.len() as f64 {
        return None;
    }
    let example = others
        .iter()
        .filter(|u| u.variant == variant)
        .min_by_key(|u| (u.path.as_str(), u.line, u.symbol.as_str()))
        .map(|u| Example {
            path: u.path.clone(),
            symbol: u.symbol.clone(),
            line: u.line,
        });
    Some(Dominant {
        variant,
        held,
        others: others.len(),
        example,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::practices::{AUTHN, Population, UnknownReport};

    fn variant(id: &str, label: &str, kind: VariantKind) -> Variant {
        Variant {
            id: id.into(),
            key: format!("key:{id}"),
            label: label.into(),
            kind,
            ..Variant::default()
        }
    }

    fn row(path: &str, symbol: &str, line: u32, variant: &str) -> UnitRow {
        UnitRow {
            package: "svc".into(),
            variant: variant.into(),
            path: path.into(),
            symbol: symbol.into(),
            line,
            method: None,
            assignment: match variant {
                "" => "unknown",
                "P-none" => "none",
                _ => "known",
            }
            .into(),
            declared: None,
            not_proven: None,
            basis: None,
            reason: None,
            does: None,
            key: None,
            route: None,
            kind: None,
            uses: Vec::new(),
            enforces: None,
            unscoped: None,
            instrument: String::new(),
        }
    }

    fn report(units: Vec<UnitRow>) -> PracticesReport {
        PracticesReport {
            concerns: vec![ConcernReport {
                id: AUTHN.into(),
                title: String::new(),
                unit: "entry_point".into(),
                population: Population::default(),
                variants: vec![
                    variant("P-user", "dependency get_user", VariantKind::Known),
                    variant("P-key", "dependency verify_key", VariantKind::Known),
                    variant(
                        "P-none",
                        crate::practices::basis::AUTHN_NONE,
                        VariantKind::None,
                    ),
                ],
                unknown: UnknownReport::default(),
                by_package: Vec::new(),
                divergence: Vec::new(),
                units,
                groups: Vec::new(),
            }],
            ..PracticesReport::default()
        }
    }

    /// Ten routes in `svc/api`, two files of five, each with `variant`.
    fn api(variant: &str) -> Vec<UnitRow> {
        (0..10)
            .map(|i| {
                row(
                    &format!("svc/api/r{}.py", i / 5),
                    &format!("h{i}"),
                    i + 1,
                    variant,
                )
            })
            .collect()
    }

    #[test]
    fn a_new_file_without_the_guard_its_directory_uses_departs() {
        let mut units = api("P-user");
        units.push(row("svc/api/new.py", "list_widgets", 9, "P-none"));
        units.push(row("svc/api/new.py", "delete_widget", 14, "P-none"));
        let r = report(units);
        let d = departures(&r, Some("svc/api/new.py"));
        assert_eq!(d.len(), 1, "{d:?}");
        let d = &d[0];
        assert_eq!((d.dir.as_str(), d.variant.as_str()), ("svc/api", "P-user"));
        // The file's own units are not counted in what the others do.
        assert_eq!((d.held, d.others), (10, 10));
        assert_eq!(d.units.len(), 2);
        assert_eq!(
            d.line(),
            "authn: 10 of the 10 other entry points in svc/api use dependency get_user [P-user]; \
             here list_widgets:9, delete_widget:14 do: none: no guard found in what Drift read \
             (copy svc/api/r0.py:1 h0)"
        );
        assert_eq!(
            d.keys(),
            [
                "practice|authn|svc/api/new.py|list_widgets|P-user",
                "practice|authn|svc/api/new.py|delete_widget|P-user"
            ]
        );
        // Every file: the same departure, and none for the files that follow.
        assert_eq!(departures(&r, None), std::slice::from_ref(d));
    }

    /// Two services share the `none` variant, each with one unread instrument: each
    /// file's line names its own units' unread items only, never the variant's list of
    /// both services' ("34 not read: … of another service"). Several units of one file
    /// are said together, with how many units the list covers.
    #[test]
    fn a_none_line_names_what_its_own_units_did_not_read() {
        use crate::practices::basis::{Basis, NotRead, kind};
        let unread = |what: &str| NotRead {
            kind: kind::PACKAGE_FUNCTION.into(),
            what: what.into(),
            why: String::new(),
        };
        let with = |mut u: UnitRow, pkg: &str, what: &[&str]| {
            u.package = pkg.into();
            u.basis = Some(Basis {
                bodies: 1,
                not_read: what.iter().map(|w| unread(w)).collect(),
                ..Basis::default()
            });
            u
        };
        let mut units = api("P-user");
        units.extend(api("P-user").into_iter().map(|mut u| {
            u.package = "other".into();
            u.path = u.path.replace("svc/", "other/");
            u
        }));
        units.push(with(
            row("svc/api/new.py", "list_widgets", 9, "P-none"),
            "svc",
            &["pkg:acme_svc#fetch"],
        ));
        units.push(with(
            row("other/api/new.py", "list_gadgets", 4, "P-none"),
            "other",
            &["pkg:acme_other#load"],
        ));
        let mut r = report(units);
        // The variant's list is of every unit's: what older lines said for each.
        r.concerns[0].variants[2].not_read =
            vec![unread("pkg:acme_other#load"), unread("pkg:acme_svc#fetch")];
        let line = |r: &PracticesReport, path: &str| {
            let d = departures(r, Some(path));
            assert_eq!(d.len(), 1, "{d:?}");
            d[0].line()
        };
        let svc = line(&r, "svc/api/new.py");
        assert!(
            svc.contains("here list_widgets:9 does: none: no guard found in what Drift read (1 not read: fetch from acme_svc) (copy "),
            "{svc}"
        );
        assert!(!svc.contains("acme_other"), "{svc}");
        let other = line(&r, "other/api/new.py");
        assert!(
            other.contains("(1 not read: load from acme_other)"),
            "{other}"
        );
        assert!(!other.contains("acme_svc"), "{other}");
        // The unit's own words are in the JSON too.
        assert_eq!(
            departures(&r, Some("svc/api/new.py"))[0].units[0].does,
            "none: no guard found in what Drift read (1 not read: fetch from acme_svc)"
        );

        // Two units of one file: their lists together, and how many units that is.
        r.concerns[0].units.push(with(
            row("svc/api/new.py", "drop_widgets", 14, "P-none"),
            "svc",
            &["pkg:acme_svc#purge"],
        ));
        let svc = line(&r, "svc/api/new.py");
        assert!(
            svc.contains("here list_widgets:9, drop_widgets:14 do: none: no guard found in what Drift read (2 not read across 2 units: fetch from acme_svc, purge from acme_svc) (copy "),
            "{svc}"
        );
        assert!(!svc.contains("acme_other"), "{svc}");
    }

    /// A health probe among guarded routes is open on purpose: no departure. A route
    /// opened another way (a webhook signature) still is one.
    #[test]
    fn a_probe_among_guarded_routes_is_no_departure() {
        let opened = |id: &str, instrument: &str| Variant {
            mechanisms: vec![crate::practices::authn::OPENS.into()],
            instruments: vec![instrument.into()],
            ..variant(id, &format!("opens {instrument}"), VariantKind::Known)
        };
        let mut units = api("P-user");
        units.push(row("svc/api/health.py", "health_check", 3, "P-probe"));
        units.push(row("svc/api/hooks.py", "stripe_webhook", 7, "P-hook"));
        let mut r = report(units);
        r.concerns[0].variants.extend([
            opened("P-probe", crate::practices::authn::PROBE),
            opened("P-hook", "webhook"),
        ]);
        assert_eq!(departures(&r, Some("svc/api/health.py")), []);
        let d = departures(&r, None);
        assert_eq!(d.len(), 1, "{d:?}");
        assert_eq!(d[0].path, "svc/api/hooks.py");
    }

    /// A unit that does all its neighbours do and one thing more follows their way: no
    /// departure. One that does less does another way, and is one.
    #[test]
    fn doing_what_the_others_do_and_more_is_no_departure() {
        let keyed = |id: &str, key: &str| Variant {
            key: key.into(),
            ..variant(id, id, VariantKind::Known)
        };
        let mut units = api("P-both");
        units.push(row("svc/api/fenced.py", "write", 4, "P-more"));
        units.push(row("svc/api/half.py", "read", 4, "P-less"));
        let mut r = report(units);
        r.concerns[0].variants = vec![
            keyed("P-both", "dependency:verify_key+dependency:verify_org"),
            keyed(
                "P-more",
                "dependency:fence_write+dependency:verify_key+dependency:verify_org",
            ),
            keyed("P-less", "dependency:verify_key"),
        ];
        assert_eq!(departures(&r, Some("svc/api/fenced.py")), []);
        let d = departures(&r, None);
        assert_eq!(d.len(), 1, "{d:?}");
        assert_eq!(d[0].path, "svc/api/half.py");
    }

    /// A unit counted under the tail of one-off ways is said with what it does itself,
    /// not with the name of the group; and when what it does includes all the dominant
    /// way does, it follows that way.
    #[test]
    fn a_one_off_unit_is_said_with_its_own_way() {
        let keyed = |id: &str, key: &str, label: &str| Variant {
            key: key.into(),
            ..variant(id, label, VariantKind::Known)
        };
        let own = |path: &str, symbol: &str, key: &str, label: &str| UnitRow {
            does: Some(label.into()),
            key: Some(key.into()),
            ..row(path, symbol, 9, "P-tail")
        };
        let mut units = api("P-both");
        units.push(own(
            "svc/api/token.py",
            "claim",
            "dependency:verify_run_token",
            "dependency verify_run_token",
        ));
        units.push(own(
            "svc/api/extra.py",
            "claim_any",
            "dependency:verify_key+dependency:verify_org+dependency:verify_run_token",
            "dependency verify_key + dependency verify_org + dependency verify_run_token",
        ));
        let mut r = report(units);
        r.concerns[0].variants = vec![
            keyed(
                "P-both",
                "dependency:verify_key+dependency:verify_org",
                "dependency verify_key + dependency verify_org",
            ),
            keyed(
                "P-tail",
                crate::practices::TAIL,
                "other ways, one unit each (2 units)",
            ),
        ];
        let d = departures(&r, None);
        assert_eq!(d.len(), 1, "{d:?}");
        assert_eq!(d[0].path, "svc/api/token.py");
        assert!(
            d[0].line()
                .contains("here claim:9 does: dependency verify_run_token (copy "),
            "{}",
            d[0].line()
        );
        assert!(!d[0].line().contains("other ways"), "{}", d[0].line());
    }

    /// A probe is compared with the routes around it in no concern: it has no failure
    /// to map and no response model to declare. Another route that maps its errors
    /// another way still departs.
    #[test]
    fn a_probe_departs_in_no_concern() {
        let opened = Variant {
            mechanisms: vec![crate::practices::authn::OPENS.into()],
            instruments: vec![crate::practices::authn::PROBE.into()],
            ..variant("P-probe", "opens probe", VariantKind::Known)
        };
        let mut authn = api("P-user");
        authn.push(row("svc/api/health.py", "health_check", 3, "P-probe"));
        authn.push(row("svc/api/files.py", "serve_file", 5, "P-user"));
        let mut r = report(authn);
        r.concerns[0].variants.push(opened);
        // The same units under errors: the probe and one route let errors bubble.
        let mut errors = r.concerns[0].clone();
        errors.id = crate::practices::ERRORS.into();
        errors.variants = vec![
            variant("P-wrapped", "mapped by wrapper handle", VariantKind::Known),
            variant("P-bubble", "bubble framework_default", VariantKind::Known),
        ];
        for u in &mut errors.units {
            u.variant = if u.path == "svc/api/health.py" || u.path == "svc/api/files.py" {
                "P-bubble".into()
            } else {
                "P-wrapped".into()
            };
        }
        r.concerns.push(errors);
        let d = departures(&r, None);
        assert_eq!(
            d.iter()
                .map(|d| (d.concern.as_str(), d.path.as_str()))
                .collect::<Vec<_>>(),
            [("errors", "svc/api/files.py")],
            "{d:?}"
        );
    }

    #[test]
    fn following_its_own_directory_is_no_departure_from_the_package() {
        // 40 routes use the user guard; `internal/` has its own, 8 of 8.
        let mut units: Vec<UnitRow> = (0..40)
            .map(|i| {
                row(
                    &format!("svc/api/r{}.py", i / 5),
                    &format!("h{i}"),
                    i + 1,
                    "P-user",
                )
            })
            .collect();
        units.extend((0..8).map(|i| {
            row(
                &format!("svc/api/internal/i{}.py", i / 4),
                &format!("k{i}"),
                i + 1,
                "P-key",
            )
        }));
        units.push(row("svc/api/internal/new.py", "claim", 3, "P-key"));
        let r = report(units.clone());
        assert_eq!(departures(&r, Some("svc/api/internal/new.py")), []);
        // The same file with the package's guard departs from its directory's.
        units.pop();
        units.push(row("svc/api/internal/new.py", "claim", 3, "P-user"));
        let d = departures(&report(units), Some("svc/api/internal/new.py"));
        assert_eq!(d.len(), 1);
        assert_eq!(
            (d[0].dir.as_str(), d[0].variant.as_str()),
            ("svc/api/internal", "P-key")
        );
    }

    #[test]
    fn a_response_shape_is_compared_within_its_http_method() {
        // Ten `GET`s declare a model; a new `DELETE` that declares none is not told to,
        // a new `GET` that declares none is. Authn is compared across methods.
        let with_method = |mut u: UnitRow, m: &str| {
            u.method = Some(m.into());
            u
        };
        let mut units: Vec<UnitRow> = api("P-user")
            .into_iter()
            .map(|u| with_method(u, "GET"))
            .collect();
        units.push(with_method(
            row("svc/api/new.py", "drop", 5, "P-none"),
            "DELETE",
        ));
        units.push(with_method(
            row("svc/api/new.py", "list", 9, "P-none"),
            "GET",
        ));
        let mut r = report(units);
        let symbols = |r: &PracticesReport| -> Vec<String> {
            departures(r, Some("svc/api/new.py"))
                .iter()
                .flat_map(|d| d.units.iter().map(|u| u.symbol.clone()))
                .collect()
        };
        assert_eq!(symbols(&r), ["drop", "list"]);
        r.concerns[0].id = crate::practices::API.into();
        assert_eq!(symbols(&r), ["list"]);
    }

    /// Pins S17 item 6 (audit 3 G4): where most routes leave errors to the framework, a
    /// route that maps its errors is not told to copy one that handles none. The other
    /// way round is still a departure, measured against the way that does something.
    #[test]
    fn a_way_that_does_nothing_is_never_the_way_to_copy() {
        let keyed = |id: &str, key: &str| Variant {
            key: key.into(),
            ..variant(id, id, VariantKind::Known)
        };
        let errors = |units: Vec<UnitRow>| {
            let mut r = report(units);
            r.concerns[0].id = crate::practices::ERRORS.into();
            r.concerns[0].variants = vec![
                keyed("P-bubble", "bubble:framework_default"),
                keyed("P-wrapped", "wrap:lib/errors.ts#handle"),
            ];
            r
        };
        let mut units = api("P-bubble");
        units.push(row("svc/api/new.py", "mapped", 3, "P-wrapped"));
        assert_eq!(departures(&errors(units), None), []);

        let mut units = api("P-wrapped");
        units.push(row("svc/api/new.py", "bare", 3, "P-bubble"));
        let d = departures(&errors(units), None);
        assert_eq!(d.len(), 1, "{d:?}");
        assert_eq!(d[0].variant, "P-wrapped");
        assert!(d[0].example.as_ref().is_some_and(|e| e.path != "svc/api/new.py"));
    }

    /// Pins S17 item 5 and 3: a departure says how to make its place's way the rule,
    /// with the command `drift practices promote` takes; where the command would refuse
    /// (the file's own units bring the place below the share), it says none.
    #[test]
    fn a_departure_carries_its_promote_command_only_when_it_would_be_taken() {
        let mut units = api("P-user");
        units.push(row("svc/api/new.py", "list_widgets", 9, "P-none"));
        units.push(row("svc/api/new.py", "delete_widget", 14, "P-none"));
        let d = departures(&report(units.clone()), None);
        assert_eq!(d.len(), 1, "{d:?}");
        assert_eq!(
            d[0].promote.as_deref(),
            Some("drift practices promote P-user --in svc/api")
        );
        assert!(
            d[0].line_with_promote().ends_with(
                "; to make it the rule for new code there: `drift practices promote P-user --in svc/api`"
            ),
            "{}",
            d[0].line_with_promote()
        );
        // What an agent reads carries no command.
        assert!(!d[0].line().contains("drift practices promote"));
        assert!(check_text(&d).contains("drift practices promote P-user --in svc/api"));

        // 10 of the 13 in the place follow (76%): the departure is still a fact about
        // the others, but promoting there would be refused, so no command.
        units.push(row("svc/api/new.py", "drop_widget", 20, "P-none"));
        let d = departures(&report(units), None);
        assert_eq!(d.len(), 1, "{d:?}");
        assert_eq!(d[0].promote, None);
        assert!(!d[0].line_with_promote().contains("promote"));
    }

    #[test]
    fn nothing_is_said_without_a_dominant_known_way() {
        // Too few others.
        let mut few: Vec<UnitRow> = api("P-user").into_iter().take(7).collect();
        few.push(row("svc/api/new.py", "h", 1, "P-none"));
        assert_eq!(departures(&report(few), Some("svc/api/new.py")), []);
        // A split place: 6 and 4.
        let mut split = api("P-user");
        for u in split.iter_mut().take(4) {
            u.variant = "P-key".into();
        }
        split.push(row("svc/api/new.py", "h", 1, "P-none"));
        assert_eq!(departures(&report(split), Some("svc/api/new.py")), []);
        // The place has no guard: a new guarded unit is not told to drop it.
        let mut open = api("P-none");
        open.push(row("svc/api/new.py", "h", 1, "P-user"));
        assert_eq!(departures(&report(open), Some("svc/api/new.py")), []);
        // An unknown unit is never reported as a fact.
        let mut unknown = api("P-user");
        unknown.push(row("svc/api/new.py", "h", 1, ""));
        assert_eq!(departures(&report(unknown), Some("svc/api/new.py")), []);
        // A report without unit rows says nothing.
        assert_eq!(departures(&report(Vec::new()), None), []);
    }
}
