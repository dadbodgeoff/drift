//! `drift practices` (and MCP `drift_practices`): the practice map, facts not rules
//! (PLAN-R13 §4). A person may turn one way of a concern into a rule for a place
//! (`drift practices promote`, docs/v2/PROMOTE-A-PRACTICE.md): the convention it writes
//! is checked against this same map, and every path that checks code goes through
//! [`check_with_practices`] (or [`check_with_map`] where the map is already in hand) and
//! [`baseline_with_practices`], so none checks the mined conventions without it.

use std::cell::OnceCell;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::bail;
use drift_core::RepoFacts;
use drift_mine::check::{self as dcheck, CheckReport};
use drift_mine::policy::{ConventionsFile, DriftConfig, Lock};
use drift_mine::practices::promote;
use drift_mine::practices::{self, Options, PracticesReport, Scope};

use crate::derived::Derived;

/// The engine's options for `root`: the person's `practices:` vocabulary
/// (`.drift/config.yaml`; none when it cannot be read) and the file kinds as `drift map`
/// reads the roles. Without the duplicate-helper findings: only the report people
/// read ([`report_with`]) lists them, and a hook, a card or `drift check` builds the map
/// on every call.
pub fn options(root: &Path, facts: &RepoFacts, scope: Scope) -> Options {
    Options {
        scope,
        commit: option_env!("DRIFT_BUILD_COMMIT").map(str::to_string),
        declared: DriftConfig::load(root)
            .map(|c| c.practices)
            .unwrap_or_default(),
        kinds: Some(crate::map_kinds(root, facts, true)),
        units: false,
        skip_duplicates: true,
        promotable: false,
    }
}

/// What a person should hear about their `practices:` lines: what `.drift/config.yaml`
/// says that Drift did not understand there, and each line that names nothing in the
/// repository ([`practices::declared_warnings`]).
pub fn config_warnings(root: &Path, facts: &RepoFacts) -> Vec<String> {
    let Ok(cfg) = DriftConfig::load(root) else {
        return Vec::new();
    };
    let mut out: Vec<String> = cfg
        .warnings
        .iter()
        .filter(|w| w.contains("`practices"))
        .cloned()
        .collect();
    out.extend(practices::declared_warnings(facts, &cfg.practices));
    out
}

/// What `drift init` leads with ([`first_run`]).
pub struct FirstRun {
    /// What the code does at its entry points and what to look at first
    /// ([`practices::render_first_run`]); empty when the map knows neither.
    pub text: String,
    /// Some recipe is known: `drift practices` and `drift security` have more to show.
    pub known: bool,
    /// The parts of the map that are unknown behind names a person can classify, and
    /// how many names: what `drift practices --hints` settles. `None` when there are
    /// none.
    pub hints: Option<(usize, usize)>,
    /// What `drift init --explain` says about the map ([`init_note`]), read from the
    /// same report so the map is computed once.
    pub note: Option<String>,
}

/// The practice map as `drift init` opens with it: read from the code, whatever
/// conventions were mined.
pub fn first_run(root: &Path, facts: &RepoFacts) -> FirstRun {
    // The first run offers the command that promotes a finding's usual way.
    let opts = Options {
        promotable: true,
        ..options(root, facts, Scope::default())
    };
    let mut r = practices::practices(facts, &opts);
    // On a re-run, what a person already promoted or declined is not offered again.
    if let Ok(Some(policy)) = ConventionsFile::load(root) {
        crate::promote::drop_decided(&mut r, &policy);
    }
    let text = practices::render_first_run(&r);
    let known = !r.recipes.is_empty();
    let note = init_note(&r);
    without_answered(root, &mut r);
    let (units, names) = practices::config_hint_counts(&r);
    let hints = (names > 0).then_some((units, names));
    FirstRun {
        text,
        known,
        hints,
        note: note.map(|mut note| {
            // What a person can settle in a minute: Drift never names an instrument itself.
            if let Some((units, names)) = hints {
                note.push_str(&format!(
                    " {units} unit(s) of the map are unknown behind {names} name(s) Drift cannot classify alone: `drift practices --hints` prints the .drift/config.yaml lines that settle them."
                ));
            }
            note
        }),
    }
}

/// What `drift init --explain` says about the practice map: it is known whatever is
/// accepted, and where it reaches people and agents. `None` when no recipe is known (nothing to point
/// at).
fn init_note(r: &practices::PracticesReport) -> Option<String> {
    let known: Vec<_> = r
        .recipes
        .iter()
        .filter(|rc| practices::agent_recipe(rc).is_some())
        .collect();
    if known.is_empty() {
        return None;
    }
    let packages: std::collections::BTreeSet<&str> =
        known.iter().map(|rc| rc.package.as_str()).collect();
    let note = format!(
        "Known with nothing accepted (the practice map: facts, not rules): how {} kind(s) of entry point in {} package(s) do authn, authz, validation, errors and the response shape, each with a file to copy. `drift practices` shows it and `drift card <path>` answers for one file. With the hooks installed an agent gets the recipe before it writes a new entry-point file, and is told when a file it wrote does one of these another way than at least 80% of the entry points around it (advice, never a block).",
        known.len(),
        packages.len()
    );
    Some(note)
}

/// `r` without the `--hints` lines for what a `drift setup` or `drift investigate`
/// answer said is not a check or guard (a check question's `no`, `not-a-check`,
/// `not-a-guard`), or for what an agent proposed to declare and a person rejected: a
/// line would undo the answer. One comment line for each left out.
pub fn without_answered(root: &Path, r: &mut PracticesReport) -> Vec<String> {
    let text =
        std::fs::read_to_string(root.join(drift_mine::policy::CONFIG_FILE)).unwrap_or_default();
    let mut notes = Vec::new();
    for c in &mut r.concerns {
        let hints = c
            .unknown
            .checks
            .iter_mut()
            .map(|k| {
                let instrument = k.check.split_once(':').map_or("", |(_, i)| i).to_string();
                (instrument, &mut k.config_hint)
            })
            .chain(
                c.unknown
                    .instruments
                    .iter_mut()
                    .map(|i| (i.instrument.clone(), &mut i.config_hint)),
            );
        for (instrument, hint) in hints.filter(|(_, h)| !h.is_empty()) {
            let what = if c.id == "authn" {
                "a guard"
            } else {
                "a check"
            };
            let why = if let Some(id) =
                crate::setup::investigate::said_not_a(&text, &c.id, &instrument)
            {
                format!("answered not {what} by {id} (`drift setup --forget {id}` asks again)")
            } else if let Some(id) =
                crate::setup::investigate::rejected_declaring(&text, &c.id, &instrument)
            {
                format!(
                    "rejected by a person in {id}, proposed as {what} (`drift setup --forget {id}` asks again)"
                )
            } else {
                continue;
            };
            hint.clear();
            let note = format!(
                "# left out: {} under {}: {why}",
                serde_json::to_string(&instrument).unwrap_or_default(),
                c.id
            );
            if !notes.contains(&note) {
                notes.push(note);
            }
        }
    }
    notes
}

/// The practice map with every unit listed, what [`practices::departures`] reads:
/// read back from the results kept for these facts when it was built from them before
/// with the same options ([`crate::derived`]), and kept when not.
pub fn report_units_kept(
    root: &Path,
    facts: &RepoFacts,
    derived: Option<&Derived>,
) -> PracticesReport {
    report_units_kept_of(root, facts, &crate::card::Listed::of(facts), derived)
}

/// [`report_units_kept`] for a caller that reads every listing of `facts` more than
/// once: `listed` is of `facts`, copied once and shared, and asked only when the map
/// has to be built. The options and the key are of `facts`, as ever.
pub fn report_units_kept_of(
    root: &Path,
    facts: &RepoFacts,
    listed: &crate::card::Listed<'_>,
    derived: Option<&Derived>,
) -> PracticesReport {
    let mut opts = options(root, facts, Scope::default());
    opts.units = true;
    // Every option the engine reads, as it is handed over: named one by one, so an
    // option added later does not compile until it is part of the key.
    let Options {
        scope,
        commit,
        declared,
        kinds,
        units,
        skip_duplicates,
        promotable,
    } = &opts;
    let Ok(more) = serde_json::to_vec(&(
        scope,
        commit,
        declared,
        kinds,
        units,
        skip_duplicates,
        promotable,
    )) else {
        return practices::practices(listed.get(), &opts);
    };
    crate::derived::get_or(derived, crate::derived::PRACTICES, &more, || {
        practices::practices(listed.get(), &opts)
    })
}

/// `drift check` of `facts`: the conventions ([`drift_mine::check::check`]), and what
/// the promoted practices among them say ([`promote::check`]), read from the practice
/// map with units listed ([`report_units_kept`], kept in `derived` when given). The map
/// is built only when `policy` has a promoted practice in `scope`: it costs seconds on a
/// large repository, and a policy without one never pays for it.
pub fn check_with_practices(
    root: &Path,
    facts: &RepoFacts,
    policy: &ConventionsFile,
    lock: &Lock,
    scope: dcheck::Scope,
    only: Option<&BTreeSet<String>>,
    derived: Option<&Derived>,
) -> CheckReport {
    let map = OnceCell::new();
    check_with_map(facts, policy, lock, scope, only, || {
        map.get_or_init(|| report_units_kept(root, facts, derived))
    })
}

/// [`check_with_practices`] for a caller that has the practice map of `facts` (with
/// units listed) or builds it for something else too: `map` is asked only when the
/// policy has a promoted practice in `scope`.
pub fn check_with_map<'m>(
    facts: &RepoFacts,
    policy: &ConventionsFile,
    lock: &Lock,
    scope: dcheck::Scope,
    only: Option<&BTreeSet<String>>,
    map: impl FnOnce() -> &'m PracticesReport,
) -> CheckReport {
    let mut report = dcheck::check(facts, policy, lock, scope, only);
    add_practices(&mut report, facts, policy, lock, scope, only, map);
    report
}

/// Adds to `report` (a [`drift_mine::check::check`] of the same facts, policy, lock,
/// scope and paths) what the promoted practices say. `map` is asked only when there is
/// one: a caller that checks beside building the map (the SessionStart hook) adds them
/// once both are done.
pub fn add_practices<'m>(
    report: &mut CheckReport,
    facts: &RepoFacts,
    policy: &ConventionsFile,
    lock: &Lock,
    scope: dcheck::Scope,
    only: Option<&BTreeSet<String>>,
    map: impl FnOnce() -> &'m PracticesReport,
) {
    if !promote::any(policy, scope) {
        return;
    }
    // Paths named (a hook's one file): a practice that covers none of them says nothing
    // of them, and the map of facts that may be of one file is not built for it.
    if let Some(only) = only
        && !policy.conventions.iter().any(|c| {
            facts
                .files
                .iter()
                .any(|f| only.contains(&f.path) && promote::covers_file(c, f))
        })
    {
        return;
    }
    report.add_practices(promote::check(facts, map(), policy, lock, scope, only));
}

/// The lock that baselines every current violation of `policy` (every convention not
/// rejected, [`drift_mine::check::baseline`]), the units that break a promoted practice
/// included ([`promote::baseline`]). The map is built only when there is one.
pub fn baseline_with_practices(root: &Path, facts: &RepoFacts, policy: &ConventionsFile) -> Lock {
    let mut lock = dcheck::baseline(facts, policy);
    if promote::any(policy, dcheck::Scope::All) {
        let map = report_units_kept(root, facts, None);
        lock.entries.extend(promote::baseline(facts, &map, policy));
    }
    lock
}

/// The concern of each promoted practice of `policy`, by convention id.
pub fn practice_concerns(policy: &ConventionsFile) -> BTreeMap<&str, &str> {
    policy
        .conventions
        .iter()
        .filter_map(|c| match &c.rule {
            drift_mine::mine::Rule::Practice { concern, .. } => {
                Some((c.id.as_str(), concern.as_str()))
            }
            _ => None,
        })
        .collect()
}

/// The units `report` already names as breaking a promoted practice of `policy`, as
/// `(concern, path, symbol)`: listed (new, unsure, held back or suppressed), not
/// recorded in the lock. [`check_departures`] says none of them again as a departure of
/// the same concern. A recorded exception is not listed as a violation, so its
/// departure is still said, as it was before the practice was promoted.
pub fn reported_practice_units(
    report: &CheckReport,
    policy: &ConventionsFile,
) -> BTreeSet<(String, String, String)> {
    let concerns = practice_concerns(policy);
    report
        .violations
        .iter()
        .filter(|v| !v.baselined)
        .filter_map(|v| {
            concerns
                .get(v.id.as_str())
                .map(|c| (c.to_string(), v.path.clone(), v.symbol.clone()))
        })
        .collect()
}

/// What `drift check`'s text says of the promoted practices beyond their violations,
/// one line each: those that are stale (they report nothing until a person looks) and
/// how many units of each Drift could not read. Neither changes the exit code. Sorted
/// by convention id.
pub fn practice_status_lines(report: &CheckReport, policy: &ConventionsFile) -> Vec<String> {
    let concerns = practice_concerns(policy);
    let place = |id: &str| {
        policy
            .conventions
            .iter()
            .find(|c| c.id == id)
            .and_then(promote::place_of)
            .map(|p| p.shown())
    };
    let mut stale: Vec<&promote::Stale> = report.stale_practices.iter().collect();
    stale.sort();
    let mut not_checked: Vec<&promote::NotChecked> = report.practices_not_checked.iter().collect();
    not_checked.sort();
    let mut out = Vec::new();
    for s in stale {
        let at = place(&s.id).unwrap_or_else(|| "<place>".to_string());
        out.push(format!(
            "drift: [{}] promoted practice is stale: none of the {} Drift read in {at} does it an accepted way any more ({}), so it reports nothing until a person looks. To accept the way the code does it now: `drift practices promote <P-id> --in {at}` again (`drift practices promote --list` shows what may be promoted); to drop it: `drift review --reject {}`",
            s.id, s.units, s.summary, s.id
        ));
    }
    for n in not_checked {
        let concern =
            practices::plain_concern(concerns.get(n.id.as_str()).copied().unwrap_or_default());
        let at = place(&n.id).map_or_else(String::new, |p| format!(" in {p}"));
        out.push(format!(
            "drift: [{}] promoted practice ({concern}): {}{at} not checked: Drift could not read how it is done there, and never reports what it cannot read. `drift practices --hints` prints the .drift/config.yaml lines that settle it",
            n.id, n.units
        ));
    }
    out
}

/// Whether a diff adds the entry point at a file and line, by its symbol, method and
/// route ([`crate::pr::DiffScope::adds_entry`]).
pub type Adds<'a> = &'a dyn Fn(&str, u32, &str, Option<&str>, Option<&str>) -> bool;

/// What `drift check` says of the practice map: the departures of the files it looked
/// at (`looked_at`: the files named, the files a diff added or changed, or every
/// file), test files aside; and, with `added` (a diff: whether it adds the declaration
/// at a file and line), the entry points it adds where Drift found no
/// sign-in guard or cannot tell ([`practices::added_entries`]). Facts, not rules: the
/// caller lists them and never fails on them. The map (`map`: of these facts, with
/// units listed, [`report_units_kept`]) is not asked for a repository with no entry
/// points: the caller that checks promoted practices shares the one it built for them.
/// `reported`: the units the check already lists as breaking a promoted practice
/// ([`reported_practice_units`]): none is said again as a departure, or a new entry
/// point, of the same concern.
pub fn check_departures<'m>(
    facts: &RepoFacts,
    map: impl FnOnce() -> &'m PracticesReport,
    looked_at: impl Fn(&str) -> bool,
    added: Option<Adds<'_>>,
    reported: &BTreeSet<(String, String, String)>,
) -> (Vec<practices::Departure>, Vec<practices::AddedEntry>) {
    let any = facts.files.iter().any(|f| {
        !f.listed_entry_points().is_empty()
            && !drift_mine::roles::is_test_path(&f.path)
            && looked_at(&f.path)
    });
    if !any {
        return (Vec::new(), Vec::new());
    }
    let report: &PracticesReport = map();
    let new = added.map_or_else(Vec::new, |added| {
        practices::added_entries(
            report,
            |path, symbol| {
                let f = facts.files.iter().find(|f| f.path == path)?;
                f.listed_entry_points()
                    .iter()
                    .find(|e| e.symbol == symbol)
                    .map(|e| e.kind.clone())
            },
            |path, line, symbol, method, route| {
                !drift_mine::roles::is_test_path(path)
                    && looked_at(path)
                    && added(path, line, symbol, method, route)
            },
        )
    });
    let mut out = practices::departures(report, None);
    out.retain(|d| !drift_mine::roles::is_test_path(&d.path) && looked_at(&d.path));
    // A new entry point that departs from the way of its place in authentication is
    // said there, with a unit to copy: not twice.
    let mut new = new;
    new.retain(|a| {
        !out.iter().any(|d| {
            d.concern == practices::AUTHN
                && d.path == a.path
                && d.units
                    .iter()
                    .any(|u| u.symbol == a.symbol && u.line == a.line)
        })
    });
    // A unit the check lists as breaking a promoted practice is said there, as a
    // violation of the rule a person made of the practice: not again as a fact.
    let said = |concern: &str, path: &str, symbol: &str| {
        reported.contains(&(concern.to_string(), path.to_string(), symbol.to_string()))
    };
    for d in &mut out {
        let (concern, path) = (d.concern.clone(), d.path.clone());
        d.units.retain(|u| !said(&concern, &path, &u.symbol));
    }
    out.retain(|d| !d.units.is_empty());
    new.retain(|a| !said(practices::AUTHN, &a.path, &a.symbol));
    // In the map's concern order (who may call first), not the alphabet's: the first
    // few are the ones a pull request annotates.
    let rank = |c: &str| {
        practices::PRIMARY
            .iter()
            .position(|p| *p == c)
            .unwrap_or(usize::MAX)
    };
    out.sort_by(|a, b| {
        (rank(&a.concern), &a.path, &a.dir, &a.variant).cmp(&(
            rank(&b.concern),
            &b.path,
            &b.dir,
            &b.variant,
        ))
    });
    (out, new)
}

/// `scope` checked against the facts: a concern id, a package and a file that exist.
pub fn checked_scope(
    facts: &RepoFacts,
    concern: Option<&str>,
    package: Option<&str>,
    path: Option<String>,
) -> anyhow::Result<Scope> {
    if let Some(c) = concern
        && practices::concern_title(c).is_none()
    {
        let ids: Vec<&str> = practices::CONCERNS.iter().map(|(id, _)| *id).collect();
        bail!("no concern `{c}` (one of {})", ids.join(", "));
    }
    let package = package.map(|p| {
        if p == "." {
            String::new()
        } else {
            p.trim_end_matches('/').to_string()
        }
    });
    if let Some(p) = &package {
        anyhow::ensure!(
            facts.files.iter().any(|f| &f.package == p),
            "no package `{p}` (`drift map` lists them)"
        );
    }
    if let Some(p) = &path {
        anyhow::ensure!(
            facts.files.iter().any(|f| &f.path == p),
            "{p} was not scanned (not a source file, ignored, or skipped)"
        );
    }
    Ok(Scope {
        concern: concern.map(str::to_string),
        package: package.map(|p| if p.is_empty() { ".".to_string() } else { p }),
        path,
    })
}

/// The report, each variant linked to the conventions that say the same when the
/// project has conventions.
pub fn report(root: &Path, facts: &RepoFacts, scope: Scope) -> anyhow::Result<PracticesReport> {
    report_with(root, facts, scope, false)
}

/// [`report`], with every unit listed when `units` (`--units`).
pub fn report_with(
    root: &Path,
    facts: &RepoFacts,
    scope: Scope,
    units: bool,
) -> anyhow::Result<PracticesReport> {
    let opts = Options {
        units,
        // `drift practices` and MCP `drift_practices`: the findings are read.
        skip_duplicates: false,
        // And what may be promoted: `drift practices` offers the command.
        promotable: true,
        ..options(root, facts, scope)
    };
    let mut r = practices::practices(facts, &opts);
    if let Some(policy) = ConventionsFile::load(root)? {
        crate::promote::drop_decided(&mut r, &policy);
        let project = crate::project::Project::open(root)?;
        practices::link_conventions(
            &mut r,
            &|path| {
                let existing = facts.files.iter().find(|f| f.path == path);
                project.conventions_for_path(
                    path,
                    existing,
                    Some(&crate::mcp::models_in(facts, path)),
                    false,
                )
            },
            &crate::project::blocks,
        );
    }
    Ok(r)
}

/// The package of a file that does not exist yet: the deepest package of the scanned
/// files it is under (`.` for the root), as `drift card` reads it.
pub fn package_of_new(facts: &RepoFacts, rel: &str) -> Option<String> {
    let p = facts
        .files
        .iter()
        .filter(|f| !f.package.is_empty() && rel.starts_with(&format!("{}/", f.package)))
        .map(|f| f.package.as_str())
        .max_by_key(|p| p.len())
        .unwrap_or_default();
    if p.is_empty() && !facts.files.iter().any(|f| f.package.is_empty()) {
        return None;
    }
    Some(if p.is_empty() {
        ".".to_string()
    } else {
        p.to_string()
    })
}
