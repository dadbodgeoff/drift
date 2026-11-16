//! The practice map as text: the recipe and findings people read by default
//! ([`render_recipes`]), every concern's variant table ([`render`], `--all`), and the
//! bounded text agents get ([`render_agent`], the hook line). Repository names are
//! sanitised: they are data, not instructions.
//!
//! Agent text follows the lead's trust rules (round 13): only known variants (never an
//! unknown presented as a fact, never a `none`), every line names a member to copy as
//! `path:line`, and it stays under [`AGENT_CHARS`]. The recipe is the [`PRIMARY`]
//! concerns ([`agent_recipe`]); what the other concerns add for new code of the kind
//! is a separate text, each clause marked `(preview)` ([`agent_recipe_preview`]), given
//! where there is room for it and never in place of a primary line.

use std::fmt::Write;

use super::basis::{self, IN_WHAT_DRIFT_READ};
use super::engine::{ratio, shown_package};
use super::*;
use crate::report::sanitize;

/// The most text an agent gets from the practice map at once (about 300 tokens).
pub const AGENT_CHARS: usize = 1200;
/// Variants listed per concern in the table before "and N more".
const TEXT_VARIANTS: usize = 5;

fn pct(x: f64) -> String {
    format!("{}%", (x * 100.0).round())
}

fn preview(id: &str) -> &'static str {
    if PRIMARY.contains(&id) {
        ""
    } else {
        " (preview)"
    }
}

fn reason_name(r: UnknownReason) -> String {
    serde_json::to_value(r)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn at(e: &Example) -> String {
    format!(
        "{}:{} {}",
        sanitize(&e.path, 160),
        e.line,
        sanitize(&e.symbol, 80)
    )
}

/// `drift practices --all`: per concern, its coverage, then the variant table, sorted
/// as the JSON is (`all` lists every variant).
pub fn render(r: &PracticesReport, all: bool) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Practices (facts, not rules): {} unit(s) across {} concern(s), {} told: known, identified, or nothing found {IN_WHAT_DRIFT_READ} ({} at the {} target).",
        r.summary.population,
        r.concerns.len(),
        pct(r.summary.coverage),
        r.summary.concerns_at_target,
        pct(r.summary.target),
    );
    if r.concerns.is_empty() {
        let _ = writeln!(out, "No concern classifier is registered yet.");
    }
    for c in &r.concerns {
        let p = &c.population;
        let unit = c.unit.replace('_', " ");
        // What a person declared is counted apart from what was proven.
        let declared = if p.declared > 0 {
            format!(
                " ({} of them declared in {}, not proven)",
                p.declared,
                crate::policy::CONFIG_FILE
            )
        } else {
            String::new()
        };
        // Identified is counted apart from known: it turns no one away.
        let identified = if p.identified > 0 {
            format!(", identified {}", pct(ratio(p.identified, p.total)))
        } else {
            String::new()
        };
        // A none says what it rests on.
        let none_words = if p.none > 0 {
            format!(" (nothing found {IN_WHAT_DRIFT_READ})")
        } else {
            String::new()
        };
        let _ = writeln!(
            out,
            "\n{}{} ({unit}s {}, coverage {}, known {}{declared}{identified}, none {}{none_words}, unknown {}):",
            c.title,
            preview(&c.id),
            p.total,
            pct(p.coverage),
            pct(ratio(p.known, p.total)),
            pct(ratio(p.none, p.total)),
            pct(ratio(p.unknown, p.total)),
        );
        let shown = if all {
            c.variants.len()
        } else {
            TEXT_VARIANTS.min(c.variants.len())
        };
        for (i, v) in c.variants.iter().take(shown).enumerate() {
            let letter = if i < 26 {
                char::from(b'A' + i as u8).to_string()
            } else {
                format!("{}", i + 1)
            };
            variant_line(&mut out, &format!("  {letter}"), v);
            for (j, a) in v.alternatives.iter().enumerate() {
                variant_line(&mut out, &format!("    {letter}{}", j + 1), a);
            }
        }
        let grouped: Vec<&VariantGroup> = c
            .groups
            .iter()
            .filter(|g| g.kind == VariantKind::Known && g.variants > 1)
            .take(TEXT_VARIANTS)
            .collect();
        if !grouped.is_empty() {
            let _ = writeln!(out, "  grouped by the instrument they share:");
            for g in grouped {
                let top: Vec<String> = g
                    .top
                    .iter()
                    .take(3)
                    .map(|t| format!("{} {}", sanitize(&t.label, 80), t.members))
                    .collect();
                let class = if g.class.is_empty() {
                    String::new()
                } else {
                    format!(" [{}]", g.class)
                };
                let _ = writeln!(
                    out,
                    "    {} {}{class} {} ({}): {}",
                    g.id,
                    sanitize(&g.label, 120),
                    pct(g.share),
                    g.members,
                    top.join("; ")
                );
            }
        }
        if c.variants.len() > shown {
            let _ = writeln!(
                out,
                "  and {} more (--all, or --json)",
                c.variants.len() - shown
            );
        }
        if c.unknown.members > 0 {
            let reasons: Vec<String> = c
                .unknown
                .reasons
                .iter()
                .map(|r| format!("{} {}", reason_name(r.reason), r.members))
                .collect();
            let _ = writeln!(
                out,
                "  unknown {} ({}): {}",
                pct(ratio(c.unknown.members, p.total)),
                c.unknown.members,
                reasons.join(", ")
            );
            if !c.unknown.not_proven.is_empty() {
                let by: Vec<String> = c
                    .unknown
                    .not_proven
                    .iter()
                    .map(|o| format!("{} {}", o.obligation, o.members))
                    .collect();
                let _ = writeln!(
                    out,
                    "      check found, not proven {}: {}",
                    c.unknown
                        .not_proven
                        .iter()
                        .map(|o| o.members)
                        .sum::<usize>(),
                    by.join(", ")
                );
                for k in c.unknown.checks.iter().take(5) {
                    let at = k.examples.first().map(at).unwrap_or_default();
                    let _ = writeln!(
                        out,
                        "      {} unit(s), e.g. {at}: {}{}",
                        k.members,
                        k.line,
                        hint_clause(Some(k.config_hint.as_str()))
                    );
                }
            }
            for i in c.unknown.instruments.iter().take(3) {
                let _ = writeln!(
                    out,
                    "      {} unit(s) use {}{}",
                    i.members,
                    sanitize(crate::security::unwrapped(&i.instrument), 120),
                    hint_clause(Some(i.config_hint.as_str()))
                );
            }
        }
        for d in &c.divergence {
            let _ = writeln!(
                out,
                "  {} does it its own way: {} for {} unit(s), not {}",
                sanitize(shown_package(&d.package), 80),
                d.dominant,
                d.members,
                d.repo_dominant
            );
        }
    }
    not_covered(&mut out, r);
    out
}

fn variant_line(out: &mut String, lead: &str, v: &Variant) {
    // A variant is many units: what their readings did not read together, and how
    // many units that is.
    let label = if v.kind == VariantKind::None {
        basis::none_across(&v.label, &v.not_read, v.members)
    } else {
        v.label.clone()
    };
    let mut place: Vec<String> = v
        .placement
        .packages
        .iter()
        .take(2)
        .map(|w| sanitize(shown_package(&w.package), 80))
        .collect();
    if let Some(s) = v.sets_apart.first() {
        let (kind, value) = s.attribute.split_once(':').unwrap_or((&s.attribute, ""));
        place.push(format!(
            "sets apart: {kind} {} {}/{} vs {}/{}",
            sanitize(value, 120),
            s.in_variant[0],
            s.in_variant[1],
            s.in_dominant[0],
            s.in_dominant[1]
        ));
    }
    let _ = writeln!(
        out,
        "{lead} {} {} {} ({}) [{}]",
        v.id,
        sanitize(&label, 160),
        pct(v.share),
        v.members,
        place.join("; ")
    );
    if let Some(e) = v.examples.first() {
        let _ = writeln!(out, "      e.g. {}", at(e));
    }
}

/// Message consumers shown at most in the text.
const MAX_CONSUMERS: usize = 8;

fn not_covered(out: &mut String, r: &PracticesReport) {
    if !r.consumers.is_empty() {
        let shown: Vec<String> = r
            .consumers
            .iter()
            .take(MAX_CONSUMERS)
            .map(|c| {
                format!(
                    "{}:{} {} ({})",
                    sanitize(&c.path, 160),
                    c.line,
                    sanitize(&c.symbol, 80),
                    sanitize(&c.adapter, 40)
                )
            })
            .collect();
        let _ = writeln!(
            out,
            "\nMessage consumers ({}): fed by a queue, so no caller signs in and authn and authz do not apply; listed, not classified: {}{}.",
            r.consumers.len(),
            shown.join("; "),
            if r.consumers.len() > MAX_CONSUMERS {
                "; ..."
            } else {
                ""
            }
        );
    }
    let _ = writeln!(
        out,
        "\nNot covered yet: {}.",
        r.not_covered
            .iter()
            .map(|s| sanitize(s, 120))
            .collect::<Vec<_>>()
            .join("; ")
    );
}

/// `; classify it in .drift/config.yaml: <hint>`, or nothing when there is no hint.
fn hint_clause(hint: Option<&str>) -> String {
    match hint.filter(|h| !h.is_empty()) {
        Some(h) => format!("; classify it in .drift/config.yaml: {}", sanitize(h, 240)),
        None => String::new(),
    }
}

fn finding_line(r: &PracticesReport, f: &Finding) -> String {
    let label = |vid: &str| {
        r.concerns
            .iter()
            .find(|c| c.id == f.concern)
            .and_then(|c| c.variants.iter().find(|v| v.id == vid))
            .map(|v| sanitize(&v.label, 100))
            .unwrap_or_default()
    };
    let pkg = f
        .package
        .as_deref()
        .map(|p| format!(" in {}", sanitize(shown_package(p), 80)))
        .unwrap_or_default();
    let eg = f
        .examples
        .first()
        .map(|e| format!(" (e.g. {})", at(e)))
        .unwrap_or_default();
    match f.kind {
        FindingKind::UnscopedKey => {
            let key = sanitize(f.key.as_deref().unwrap_or_default(), 80);
            let examples: Vec<String> = f.examples.iter().take(caps::EXAMPLES).map(at).collect();
            format!(
                "{} unscoped key{pkg}: {} signed-in entry point(s) take `{key}` from the request and nothing read checks or scopes it, so a signed-in caller can name any {key} ({})",
                f.concern,
                f.members,
                examples.join("; "),
            )
        }
        FindingKind::UnexplainedSplit => format!(
            "unexplained split, {}{pkg}: {} unit(s) {} [{}] beside {} [{}], and nothing sets them apart{eg}",
            f.concern,
            f.members,
            label(&f.variants[1]),
            f.variants[1],
            label(&f.variants[0]),
            f.variants[0],
        ),
        FindingKind::DuplicateHelper => {
            let name = sanitize(f.key.as_deref().unwrap_or_default(), 80);
            let shown: Vec<String> = f
                .copies
                .iter()
                .take(caps::COPIES)
                .map(|c| format!("{}:{}", sanitize(&c.path, 160), c.line))
                .collect();
            let more = match f.members.saturating_sub(shown.len()) {
                0 => String::new(),
                n => format!("; and {n} more"),
            };
            let place = if f.package.is_some() {
                pkg
            } else {
                " across packages".to_string()
            };
            format!(
                "duplicate helper{place}: `{name}` is defined in {} files and the copies share {} call(s) ({}{more})",
                f.members,
                f.shared_calls.unwrap_or_default(),
                shown.join("; "),
            )
        }
        FindingKind::None => {
            // What the finding's own units did not read, never the variant's list of
            // every package's.
            let not_read = basis::not_read_count(&f.not_read);
            format!(
                "{} none{pkg}: {} unit(s) with {}{not_read}{eg}",
                f.concern,
                f.members,
                label(&f.variants[0]),
            )
        }
        FindingKind::Unknown => format!(
            "{} unknown: {} unit(s) use {}{}",
            f.concern,
            f.members,
            sanitize(
                crate::security::unwrapped(f.instrument.as_deref().unwrap_or_default()),
                120
            ),
            hint_clause(f.config_hint.as_deref()),
        ),
    }
}

/// One recipe concern for people: the top variant with its share and a member to
/// copy, the second and where it differs, the none and unknown counts.
fn recipe_concern_line(c: &RecipeConcern) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let (Some(v), Some(e)) = (c.variants.first(), &c.copy) {
        parts.push(format!(
            "{} {}/{} (copy {})",
            sanitize(&v.label, 100),
            v.members,
            c.total,
            at(e)
        ));
    }
    if let (Some(v), Some(d)) = (c.variants.get(1), &c.differs) {
        let where_ = match &d.attribute {
            Some(a) => format!("where {}", sanitize(&a.replacen(':', " ", 1), 120)),
            None => "nothing sets it apart".to_string(),
        };
        let eg = d
            .examples
            .first()
            .map(|e| format!(", e.g. {}", at(e)))
            .unwrap_or_default();
        parts.push(format!(
            "or {} {}/{} ({where_}{eg})",
            sanitize(&v.label, 100),
            v.members,
            c.total
        ));
    }
    if c.identified > 0 {
        parts.push(format!(
            "identified {}/{} (turns no one away)",
            c.identified, c.total
        ));
    }
    if c.none > 0 {
        parts.push(format!(
            "none {}/{} (nothing found {IN_WHAT_DRIFT_READ})",
            c.none, c.total
        ));
    }
    if c.unknown > 0 {
        parts.push(format!("{} unknown (not counted)", c.unknown));
    }
    // Every unit here is known by a person's word or in a way of its own: no way to
    // copy, and the line still says so.
    if parts.is_empty() && c.total > 0 {
        parts.push(format!(
            "known {t}/{t}, nothing to copy (declared in {}, or one-off ways)",
            crate::policy::CONFIG_FILE,
            t = c.total
        ));
    }
    format!("{}: {}", c.concern, parts.join("; "))
}

/// `drift practices`: the findings, then the recipe per package and kind of entry
/// point, then the preview concerns' coverage. `--all` has the full tables.
pub fn render_recipes(r: &PracticesReport) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Practices (facts, not rules): {} unit(s) across {} concern(s), {} told: known, identified, or nothing found {IN_WHAT_DRIFT_READ}.",
        r.summary.population,
        r.concerns.len(),
        pct(r.summary.coverage),
    );
    if r.concerns.is_empty() {
        let _ = writeln!(out, "No concern classifier is registered yet.");
    }
    if !r.findings.is_empty() {
        let _ = writeln!(out, "\nFindings:");
        for f in &r.findings {
            let _ = writeln!(out, "  - {}", finding_line(r, f));
        }
    }
    if !r.recipes.is_empty() {
        let _ = writeln!(out, "\nRecipes (what new code of each kind does here):");
        for rc in &r.recipes {
            let _ = writeln!(out, "  {} ({}):", sanitize(&rc.label, 160), rc.population);
            for c in &rc.concerns {
                let _ = writeln!(out, "    {}", recipe_concern_line(c));
            }
            for p in &rc.preview {
                let _ = writeln!(out, "    {}", preview_clause(p));
            }
        }
    }
    let previews: Vec<String> = r
        .concerns
        .iter()
        .filter(|c| !PRIMARY.contains(&c.id.as_str()))
        .map(|c| format!("{} {} covered", c.id, pct(c.population.coverage)))
        .collect();
    if !previews.is_empty() {
        let _ = writeln!(
            out,
            "\nPreview (in a recipe only where at least 60% of the package does the same): {}.",
            previews.join(", ")
        );
    }
    let _ = writeln!(
        out,
        "\n`drift practices --all` has every concern's variant table; --json all of it."
    );
    not_covered(&mut out, r);
    out
}

/// How many kinds of entry point the first run shows before "and N more".
const FIRST_RUN_RECIPES: usize = 3;
/// How many findings the first run shows.
const FIRST_RUN_FINDINGS: usize = 5;

/// A concern as the first run names it: the word a newcomer would use.
fn plain_concern(id: &str) -> &str {
    match id {
        AUTHN => "sign-in",
        AUTHZ => "permissions",
        ERRORS => "errors",
        API => "responses",
        VALIDATION => "validation",
        DATA_ACCESS => "data access",
        CONFIG => "configuration",
        other => other,
    }
}

/// A variant's label as the first run words it. A label is its uses joined by ` + `,
/// each a mechanism of Drift's own vocabulary and the instrument read from the code;
/// only the mechanism words a newcomer would not know are reworded, and the
/// instrument is kept as the code names it.
fn plain_way(label: &str) -> String {
    label
        .split(" + ")
        .map(|part| {
            if part == "bubble framework_default" {
                "left to the framework".to_string()
            } else if part == "builder return_value" {
                "the value returned".to_string()
            } else if part == "manual body_check" {
                "checked by hand".to_string()
            } else if let Some(i) = part.strip_prefix("builder ") {
                format!("built with {i}")
            } else if let Some(i) = part.strip_prefix("body call ") {
                format!("calls {i}")
            } else if let Some(i) = part.strip_prefix("body check ") {
                format!("checks {i}")
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

/// Where a first-run finding ranks: what a signed-in caller can reach that is not
/// theirs, then entry points nothing signs a caller in to or validates, then two
/// ways side by side in what an entry point does, then in the rest, then copies.
fn first_run_rank(f: &Finding) -> u8 {
    match (f.kind, f.concern.as_str()) {
        (FindingKind::UnscopedKey, _) => 0,
        (FindingKind::None, AUTHN) => 1,
        (FindingKind::None, _) => 2,
        (FindingKind::UnexplainedSplit, c) if PRIMARY.contains(&c) => 3,
        (FindingKind::UnexplainedSplit, _) => 4,
        _ => 5,
    }
}

/// One recipe concern for the first run: each way with the number that do it, then
/// what nothing was found for and what could not be told. Counts only: where to copy
/// from is `drift practices`.
fn first_run_concern(c: &RecipeConcern) -> Option<String> {
    let mut parts: Vec<String> = c
        .variants
        .iter()
        .map(|v| format!("{} in {}", plain_way(&sanitize(&v.label, 80)), v.members))
        .collect();
    // The recipe names its two largest ways: the units of the others are counted, so
    // the line adds up to its total.
    let named: usize = c.variants.iter().map(|v| v.members).sum();
    let other = c
        .total
        .saturating_sub(named + c.identified + c.none + c.unknown);
    if other > 0 {
        parts.push(format!("other ways in {other}"));
    }
    if c.identified > 0 {
        parts.push(format!(
            "caller known, no one turned away in {}",
            c.identified
        ));
    }
    if c.none > 0 {
        parts.push(format!("nothing found in {}", c.none));
    }
    if c.unknown > 0 {
        parts.push(format!("could not tell in {}", c.unknown));
    }
    if parts.is_empty() {
        return None;
    }
    Some(format!(
        "{:<12} {} (of {})",
        format!("{}:", plain_concern(&c.concern)),
        parts.join("; "),
        c.total
    ))
}

/// One finding for the first run, in a newcomer's words. `None` for what a person
/// settles in `.drift/config.yaml` (an unknown instrument): the first run points at
/// `drift practices --hints` for those.
fn first_run_finding(r: &PracticesReport, f: &Finding) -> Option<String> {
    // The way a finding names, by position; `None` where it names fewer, so a finding
    // built short is left out rather than panicking the first run.
    let label = |i: usize| {
        let vid = f.variants.get(i)?;
        Some(
            r.concerns
                .iter()
                .find(|c| c.id == f.concern)
                .and_then(|c| c.variants.iter().find(|v| &v.id == vid))
                .map(|v| plain_way(&sanitize(&v.label, 100)))
                .unwrap_or_default(),
        )
    };
    let pkg = match f.package.as_deref() {
        Some("") | None => String::new(),
        Some(p) => format!(" in {}", sanitize(p, 80)),
    };
    let eg = f
        .examples
        .first()
        .map(|e| format!(" (e.g. {})", at(e)))
        .unwrap_or_default();
    let places = |n: usize| if n == 1 { "place" } else { "places" };
    Some(match f.kind {
        FindingKind::UnscopedKey => {
            let key = sanitize(f.key.as_deref().unwrap_or_default(), 80);
            format!(
                "{} signed-in entry point(s){pkg} take `{key}` from the request and nothing read checks it is the caller's own, so a signed-in caller can name any {key}{eg}",
                f.members
            )
        }
        FindingKind::UnexplainedSplit => format!(
            "{}{pkg}: two ways side by side, {} and {} ({} {}), and nothing sets them apart{eg}",
            plain_concern(&f.concern),
            label(0)?,
            label(1)?,
            f.members,
            places(f.members),
        ),
        FindingKind::None => format!(
            "{}{pkg}: {}, in {} {}{eg}",
            plain_concern(&f.concern),
            label(0)?,
            f.members,
            places(f.members),
        ),
        FindingKind::DuplicateHelper => {
            let name = sanitize(f.key.as_deref().unwrap_or_default(), 80);
            let at: Vec<String> = f
                .copies
                .iter()
                .take(2)
                .map(|c| format!("{}:{}", sanitize(&c.path, 160), c.line))
                .collect();
            format!(
                "`{name}` is written {} times and the copies make the same calls ({})",
                f.members,
                at.join("; ")
            )
        }
        FindingKind::Unknown => return None,
    })
}

/// What `drift init` leads with: what the code does at its entry points, by kind, and
/// what to look at first. Facts read from the code, whatever conventions were mined
/// or accepted. Empty when the map knows no entry point and has no finding.
pub fn render_first_run(r: &PracticesReport) -> String {
    let mut out = String::new();
    let recipes: Vec<(&Recipe, Vec<String>)> = r
        .recipes
        .iter()
        .map(|rc| {
            (
                rc,
                rc.concerns
                    .iter()
                    .filter_map(first_run_concern)
                    .collect::<Vec<_>>(),
            )
        })
        .filter(|(_, lines)| !lines.is_empty())
        .collect();
    if !recipes.is_empty() {
        let _ = writeln!(
            out,
            "What the code does (read from the code: facts, not rules)"
        );
        for (rc, lines) in recipes.iter().take(FIRST_RUN_RECIPES) {
            // `http entry points in .` is the root package's: said without the dot.
            let label = match rc.package.is_empty() {
                true => rc.label.strip_suffix(" in .").unwrap_or(&rc.label),
                false => &rc.label,
            };
            let _ = writeln!(out, "  {} {}", rc.population, sanitize(label, 160));
            for l in lines {
                let _ = writeln!(out, "    {l}");
            }
        }
        if recipes.len() > FIRST_RUN_RECIPES {
            let _ = writeln!(
                out,
                "  ... and {} more kind(s) of entry point: `drift practices`",
                recipes.len() - FIRST_RUN_RECIPES
            );
        }
    }
    // Only what the first run says counts toward a rank's turn: an unknown instrument
    // it leaves to `--hints` must not take the place of a copy.
    let mut ranked: Vec<(u8, String)> = r
        .findings
        .iter()
        .filter_map(|f| Some((first_run_rank(f), first_run_finding(r, f)?)))
        .collect();
    ranked.sort_by_key(|(rank, _)| *rank);
    // No more than two of a kind before the others have had their turn: a
    // repository of many packages would list one thing five times.
    let mut seen: std::collections::BTreeMap<u8, usize> = std::collections::BTreeMap::new();
    let (first, later): (Vec<(u8, String)>, Vec<(u8, String)>) =
        ranked.into_iter().partition(|(rank, _)| {
            let n = seen.entry(*rank).or_default();
            *n += 1;
            *n <= 2
        });
    let findings: Vec<String> = first.into_iter().chain(later).map(|(_, f)| f).collect();
    if !findings.is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        let _ = writeln!(out, "Worth a look first");
        for (i, f) in findings.iter().take(FIRST_RUN_FINDINGS).enumerate() {
            let _ = writeln!(out, "  {}. {f}", i + 1);
        }
        let more = match findings.len().saturating_sub(FIRST_RUN_FINDINGS) {
            0 => String::new(),
            n => format!("{n} more in `drift practices`. "),
        };
        let _ = writeln!(
            out,
            "  {more}`drift security` lists every entry point with its guard and what it reaches."
        );
    }
    out
}

/// One recipe concern for an agent: known variants only, each with a member to copy.
/// `None` when nothing is known.
fn agent_concern(c: &RecipeConcern) -> Option<String> {
    let v = c.variants.first()?;
    let e = c.copy.as_ref()?;
    let mut s = format!(
        "{}: {} ({} of {}; copy {}:{})",
        c.concern,
        sanitize(&v.label, 100),
        v.members,
        c.total,
        sanitize(&e.path, 160),
        e.line
    );
    if let (Some(v2), Some(d)) = (c.variants.get(1), &c.differs)
        && let Some(e2) = d.examples.first()
    {
        let where_ = d
            .attribute
            .as_deref()
            .map(|a| format!(" where {}", sanitize(&a.replacen(':', " ", 1), 100)))
            .unwrap_or_default();
        s.push_str(&format!(
            "; {} differ{where_}: {} (copy {}:{})",
            v2.members,
            sanitize(&v2.label, 100),
            sanitize(&e2.path, 160),
            e2.line
        ));
    }
    Some(s)
}

/// The recipe of one entry role for an agent: `new http entry points in apps/web: authn:
/// … (40 of 52; copy path:line); validation: …`. `None` when nothing is known.
pub fn agent_recipe(rc: &Recipe) -> Option<String> {
    let parts: Vec<String> = rc
        .concerns
        .iter()
        .filter(|c| PRIMARY.contains(&c.concern.as_str()))
        .filter_map(agent_concern)
        .collect();
    (!parts.is_empty()).then(|| format!("new {}: {}", sanitize(&rc.label, 160), parts.join("; ")))
}

/// One preview concern of a recipe, for people and agents alike: the concern marked
/// `(preview)`, what most do with the count, and the member or test file to copy.
fn preview_clause(p: &RecipePreview) -> String {
    let head = format!(
        "{}{}: {}",
        p.concern,
        preview(&p.concern),
        sanitize(&p.label, 160)
    );
    if p.concern == TESTING {
        // The label is a place ("tests in apps/web/tests/api (vitest)"), the copy a file.
        let copy = p
            .copy
            .as_ref()
            .map(|e| format!(" (copy {})", sanitize(&e.path, 160)))
            .unwrap_or_default();
        return format!("{head} cover {} of {}{copy}", p.members, p.total);
    }
    let copy = p
        .copy
        .as_ref()
        .map(|e| format!("; copy {}:{}", sanitize(&e.path, 160), e.line))
        .unwrap_or_default();
    format!("{head} ({} of {}{copy})", p.members, p.total)
}

/// What the preview concerns add to [`agent_recipe`] for new code of the recipe's
/// kind: the package's dominant logger, config read and data access, and where the
/// tests of such entry points are, each marked `(preview)` and with something to copy.
/// Only what a clear majority does is in the recipe at all ([`RecipePreview`]). `None`
/// when there is nothing to add.
pub fn agent_recipe_preview(rc: &Recipe) -> Option<String> {
    let parts: Vec<String> = rc
        .preview
        .iter()
        .filter(|p| p.copy.is_some())
        .map(preview_clause)
        .collect();
    (!parts.is_empty()).then(|| parts.join("; "))
}

/// What `drift_practices` gives an agent: the recipes of the report (of `roles` when
/// given: the entry kinds of the file it is about), facts not rules, under
/// [`AGENT_CHARS`]; then, in what room is left, what the preview concerns add to each
/// ([`agent_recipe_preview`]). Says so plainly when nothing is known.
pub fn render_agent(r: &PracticesReport, roles: &[String]) -> String {
    let head =
        "drift practices (facts, not rules; how this codebase does it, with a file to copy):";
    let lines: Vec<(String, Option<String>)> = r
        .recipes
        .iter()
        .filter(|rc| roles.is_empty() || roles.contains(&rc.role))
        .filter_map(|rc| Some((agent_recipe(rc)?, agent_recipe_preview(rc))))
        .collect();
    if lines.is_empty() {
        return "drift practices: no recipe is known here yet; read neighbouring files.\n"
            .to_string();
    }
    // The primary lines first: a preview never takes the room of one.
    let mut used = head.len() + 1;
    let mut kept: Vec<&(String, Option<String>)> = Vec::new();
    let mut left = 0;
    for l in &lines {
        if used + l.0.len() + 3 > AGENT_CHARS {
            left += 1;
            continue;
        }
        used += l.0.len() + 3;
        kept.push(l);
    }
    let more = if left > 0 {
        format!("+{left} more: `drift practices`\n")
    } else {
        String::new()
    };
    used += more.len();
    let mut out = format!("{head}\n");
    for (line, preview) in kept {
        match preview {
            Some(p) if used + p.len() + 2 <= AGENT_CHARS => {
                used += p.len() + 2;
                let _ = writeln!(out, "- {line}; {p}");
            }
            _ => {
                let _ = writeln!(out, "- {line}");
            }
        }
    }
    out.push_str(&more);
    out
}

/// The hook's line for `package` from a report scoped to it: each [`PRIMARY`]
/// concern's dominant known variant with a member to copy (`path:line`).
pub(super) fn package_line_of(r: &PracticesReport, package: &str) -> Option<String> {
    let parts: Vec<String> = r
        .concerns
        .iter()
        .filter(|c| PRIMARY.contains(&c.id.as_str()))
        .filter_map(|c| {
            // A person's word is no way of doing it to copy.
            let v = c.variants.iter().find(|v| {
                v.kind == VariantKind::Known
                    && v.key != "tail"
                    && v.source != super::VariantSource::Declared
            })?;
            let e = v.examples.first()?;
            Some(format!(
                "{} {} ({} of {}; copy {}:{})",
                c.id,
                sanitize(&v.label, 100),
                v.members,
                c.population.total,
                sanitize(&e.path, 160),
                e.line
            ))
        })
        .take(5)
        .collect();
    (!parts.is_empty()).then(|| {
        format!(
            "drift: practices in {} (facts, not rules): {}",
            sanitize(shown_package(package), 120),
            parts.join("; ")
        )
    })
}

#[cfg(test)]
mod first_run_tests {
    use super::*;

    fn variant(id: &str, label: &str) -> Variant {
        Variant {
            id: id.into(),
            label: label.into(),
            kind: VariantKind::Known,
            ..Default::default()
        }
    }

    fn finding(kind: FindingKind, concern: &str, package: &str, variants: &[&str]) -> Finding {
        Finding {
            kind,
            concern: concern.into(),
            package: Some(package.into()),
            variants: variants.iter().map(|v| v.to_string()).collect(),
            members: 2,
            examples: vec![Example {
                path: format!("{package}/a.ts"),
                symbol: "GET".into(),
                line: 3,
            }],
            ..Default::default()
        }
    }

    fn recipe(package: &str, population: usize) -> Recipe {
        Recipe {
            package: package.into(),
            role: "http".into(),
            label: format!(
                "http entry points in {}",
                if package.is_empty() { "." } else { package }
            ),
            population,
            concerns: vec![
                RecipeConcern {
                    concern: AUTHN.into(),
                    total: population,
                    variants: vec![RecipeVariant {
                        id: "P-a".into(),
                        label: "body call requireUser".into(),
                        members: population - 4,
                        share: 0.0,
                    }],
                    none: 2,
                    unknown: 1,
                    ..Default::default()
                },
                RecipeConcern {
                    concern: ERRORS.into(),
                    total: population,
                    variants: vec![RecipeVariant {
                        id: "P-b".into(),
                        label: "bubble framework_default".into(),
                        members: population,
                        share: 1.0,
                    }],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    /// Nothing known: nothing printed, so `drift init` goes straight to conventions.
    #[test]
    fn an_empty_map_prints_nothing() {
        assert_eq!(render_first_run(&PracticesReport::default()), "");
    }

    /// The recipes in a newcomer's words, the root package without its dot, and no
    /// more than [`FIRST_RUN_RECIPES`] of them.
    #[test]
    fn the_map_is_counts_in_plain_words() {
        let r = PracticesReport {
            recipes: vec![
                recipe("", 10),
                recipe("apps/a", 9),
                recipe("apps/b", 8),
                recipe("apps/c", 7),
                recipe("apps/d", 6),
            ],
            ..Default::default()
        };
        let out = render_first_run(&r);
        assert!(
            out.starts_with(
                "What the code does (read from the code: facts, not rules)\n  10 http entry points\n    sign-in:     calls requireUser in 6; other ways in 1; nothing found in 2; could not tell in 1 (of 10)\n    errors:      left to the framework in 10 (of 10)\n  9 http entry points in apps/a\n"
            ),
            "{out}"
        );
        assert!(
            out.ends_with("  ... and 2 more kind(s) of entry point: `drift practices`\n"),
            "{out}"
        );
        assert!(!out.contains("apps/c"), "{out}");
        assert!(!out.contains("Worth a look first"), "{out}");
    }

    /// A finding naming fewer ways than its kind needs is left out of the first run,
    /// not a panic; findings the first run leaves to `--hints` take no copy's turn.
    #[test]
    fn short_findings_are_skipped_and_unknowns_take_no_turn() {
        let dup = |p: &str| {
            let mut f = finding(FindingKind::DuplicateHelper, DATA_ACCESS, p, &[]);
            f.key = Some(format!("helper_{p}"));
            f
        };
        let r = PracticesReport {
            findings: vec![
                finding(FindingKind::UnexplainedSplit, DATA_ACCESS, "a", &["P-x"]),
                finding(FindingKind::None, AUTHN, "b", &[]),
                finding(FindingKind::Unknown, AUTHN, "c", &[]),
                finding(FindingKind::Unknown, AUTHN, "d", &[]),
                dup("e"),
                dup("f"),
            ],
            ..Default::default()
        };
        let out = render_first_run(&r);
        assert!(out.contains("`helper_e`"), "{out}");
        assert!(out.contains("`helper_f`"), "{out}");
        assert!(!out.contains("two ways side by side"), "{out}");
        assert_eq!(out.matches(". ").count(), 2, "{out}");
    }

    /// What a signed-in caller can reach first, then entry points with no sign-in,
    /// then the rest; at most two of a kind before another kind has had its turn; an
    /// unknown instrument is `drift practices --hints`', never listed here.
    #[test]
    fn findings_are_ranked_by_what_they_cost_and_capped() {
        let split = |p: &str| {
            finding(
                FindingKind::UnexplainedSplit,
                DATA_ACCESS,
                p,
                &["P-x", "P-y"],
            )
        };
        let none = |c: &str, p: &str| finding(FindingKind::None, c, p, &["P-n"]);
        let mut key = finding(FindingKind::UnscopedKey, AUTHZ, "api", &[]);
        key.key = Some("orgId".into());
        let r = PracticesReport {
            concerns: vec![
                ConcernReport {
                    id: DATA_ACCESS.into(),
                    variants: vec![
                        variant("P-x", "service pg"),
                        variant("P-y", "entry direct pg"),
                    ],
                    ..Default::default()
                },
                ConcernReport {
                    id: AUTHN.into(),
                    variants: vec![variant("P-n", basis::AUTHN_NONE)],
                    ..Default::default()
                },
                ConcernReport {
                    id: VALIDATION.into(),
                    variants: vec![variant("P-n", "reads input, nothing validates it")],
                    ..Default::default()
                },
            ],
            findings: vec![
                finding(FindingKind::Unknown, AUTHN, "p0", &[]),
                split("p1"),
                none(AUTHN, "p2"),
                none(AUTHN, "p3"),
                none(AUTHN, "p4"),
                none(VALIDATION, "p5"),
                key,
                split("p6"),
            ],
            ..Default::default()
        };
        let out = render_first_run(&r);
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[0], "Worth a look first", "{out}");
        assert!(
            lines[1].starts_with(
                "  1. 2 signed-in entry point(s) in api take `orgId` from the request"
            ),
            "{out}"
        );
        assert_eq!(
            lines[2],
            "  2. sign-in in p2: no guard found in what Drift read, in 2 places (e.g. p2/a.ts:3 GET)",
            "{out}"
        );
        assert!(lines[3].starts_with("  3. sign-in in p3:"), "{out}");
        // The third entry point without sign-in waits for the other kinds.
        assert!(
            lines[4].starts_with("  4. validation in p5: reads input, nothing validates it"),
            "{out}"
        );
        assert_eq!(
            lines[5],
            "  5. data access in p1: two ways side by side, service pg and entry direct pg (2 places), and nothing sets them apart (e.g. p1/a.ts:3 GET)",
            "{out}"
        );
        assert_eq!(
            lines[6],
            "  2 more in `drift practices`. `drift security` lists every entry point with its guard and what it reaches.",
            "{out}"
        );
        assert_eq!(lines.len(), 7, "{out}");
        assert!(!out.contains("p0"), "{out}");
    }
}
