//! The census's per-package report for a repository of several packages
//! ([`drift_mine::workspace`]): for each package, its languages, files, roles and
//! cards, and why a package without cards is silent. Absent (`None`) in a
//! single-package repository, whose census output is unchanged.

use std::collections::BTreeMap;
use std::path::Path;

use drift_core::RepoFacts;
use drift_mine::mine::{Candidate, MIN_ROLE_SIZE, Mined};
use drift_mine::tier::Tier;
use drift_mine::workspace::Workspace;
use serde_json::{Value, json};

/// The packages each candidate covers (its role's parts' packages).
fn packages_of(c: &Candidate) -> Vec<String> {
    let mut v: Vec<String> = c.role.parts().into_iter().map(|p| p.package).collect();
    v.sort();
    v.dedup();
    v
}

/// How many Python proposals each package had before they were withheld (decision
/// D13-py): taken from `mined` before [`crate::withhold_python`] runs.
pub fn python_by_package(mined: &Mined) -> BTreeMap<String, usize> {
    let mut out = BTreeMap::new();
    for c in &mined.candidates {
        if c.language() == drift_core::ingest::Lang::Python {
            for p in packages_of(c) {
                *out.entry(p).or_default() += 1;
            }
        }
    }
    out
}

/// One package's line of the report.
pub struct Row {
    pub path: String,
    pub languages: Vec<String>,
    pub files: usize,
    pub roles: usize,
    pub default_tier: usize,
    pub suggestions: usize,
    /// Files the scan skipped in it (by reason in [`Row::json`]).
    pub skipped: usize,
    pub silent: Option<String>,
    pub json: Value,
}

/// The per-package report, or `None` when the repository has one package
/// ([`Workspace::is_multi`]). `python_before` is [`python_by_package`] before Python
/// proposals were withheld; `python_on` whether they are on.
pub fn report(
    root: &Path,
    facts: &RepoFacts,
    mined: &Mined,
    python_before: &BTreeMap<String, usize>,
    python_on: bool,
) -> Option<(Workspace, Vec<Row>)> {
    let ws = Workspace::discover(Some(root), facts);
    if !ws.is_multi() {
        return None;
    }
    let mut cards: BTreeMap<String, (usize, usize, usize)> = BTreeMap::new();
    for c in &mined.candidates {
        for p in packages_of(c) {
            let e = cards.entry(p).or_default();
            match c.tier() {
                Tier::Default => e.0 += 1,
                Tier::Suggestion => e.1 += 1,
            }
            if c.language() == drift_core::ingest::Lang::Python {
                e.2 += 1;
            }
        }
    }
    // Files a scan skipped (generated, minified, too large, declarations, ...): never
    // lost from the report, counted in their package by reason.
    let mut skipped: BTreeMap<&str, BTreeMap<String, usize>> = BTreeMap::new();
    for s in &facts.skipped {
        let reason = serde_json::to_value(s.reason)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default();
        *skipped
            .entry(ws.package_of(&s.path))
            .or_default()
            .entry(reason)
            .or_default() += 1;
    }
    let rows = ws
        .packages
        .iter()
        .map(|p| {
            let skipped = skipped.get(p.path.as_str()).cloned().unwrap_or_default();
            let roles = mined.roles_by_package.get(&p.path).copied().unwrap_or(0);
            let (d, s, py_now) = cards.get(&p.path).copied().unwrap_or_default();
            let withheld = python_before
                .get(&p.path)
                .copied()
                .unwrap_or(0)
                .saturating_sub(py_now);
            let hidden = mined.hidden_by_package.get(&p.path).copied().unwrap_or(0);
            let silent =
                (d + s == 0).then(|| silent_reason(p.files, roles, withheld, python_on, hidden));
            let json = json!({
                "path": p.path,
                "languages": p.languages,
                "files": p.files,
                "manifests": p.manifests,
                "declared_by": p.declared_by,
                "roles": roles,
                "cards": d + s,
                "default_tier": d,
                "suggestions": s,
                "python_withheld": withheld,
                "hidden_by_show_policy": hidden,
                "skipped": skipped,
                "silent": silent,
            });
            Row {
                path: p.path.clone(),
                languages: p.languages.clone(),
                files: p.files,
                roles,
                default_tier: d,
                suggestions: s,
                skipped: skipped.values().sum(),
                silent,
                json,
            }
        })
        .collect();
    Some((ws, rows))
}

/// Why a package has no card, most specific first. `python_withheld` counts the Python
/// proposals the show policy let through and the Python switch then withheld; `hidden`
/// those the show policy itself did not let through (any language).
fn silent_reason(
    files: usize,
    roles: usize,
    python_withheld: usize,
    python_on: bool,
    hidden: usize,
) -> String {
    if files == 0 {
        "no production source files (a manifest only, or only tests and examples)".into()
    } else if roles == 0 {
        format!(
            "too small to mine: no role reaches {MIN_ROLE_SIZE} members ({files} production file(s))"
        )
    } else if python_withheld > 0 && !python_on {
        format!(
            "{python_withheld} Python proposal(s) not made: Python proposals are off (`proposals: {{python: off}}` in .drift/config.yaml)"
        )
    } else if hidden > 0 {
        format!(
            "{hidden} proposal(s) withheld by the show policy (a suggestion with more than one outlier, or of a rule family not admitted for its language)"
        )
    } else {
        format!("no rule clears the evidence bounds in its {roles} role(s)")
    }
}

/// The census JSON's `workspace` value.
pub fn json(ws: &Workspace, rows: &[Row]) -> Value {
    json!({
        "tools": ws.tools,
        "packages": rows.iter().map(|r| r.json.clone()).collect::<Vec<_>>(),
    })
}

/// The report as text lines, for `drift census` and `drift init`.
pub fn lines(rows: &[Row]) -> Vec<String> {
    let mut out = vec![format!("Packages ({}):", rows.len())];
    for r in rows {
        let name = if r.path.is_empty() {
            "(root)".to_string()
        } else {
            drift_mine::report::sanitize(&r.path, 120)
        };
        let langs = if r.languages.is_empty() {
            "-".to_string()
        } else {
            r.languages.join("+")
        };
        let what = match &r.silent {
            Some(why) => format!("silent: {why}"),
            None => format!(
                "{} card(s) ({} default tier, {} suggestions)",
                r.default_tier + r.suggestions,
                r.default_tier,
                r.suggestions
            ),
        };
        let skipped = if r.skipped > 0 {
            format!(", {} skipped", r.skipped)
        } else {
            String::new()
        };
        out.push(format!(
            "  {name}  [{langs}, {} files{skipped}, {} roles]  {what}",
            r.files, r.roles
        ));
    }
    out
}
