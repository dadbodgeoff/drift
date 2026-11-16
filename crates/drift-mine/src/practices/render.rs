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
    if let Some(cmd) = promote_command(v) {
        let _ = writeln!(out, "      make it the rule for new code: {cmd}");
    }
}

/// The command that makes `v` a convention, where the map says it may be promoted as
/// the code stands ([`Variant::promotable`]): `--in` its place, or none when the
/// command finds the place itself.
fn promote_command(v: &Variant) -> Option<String> {
    let p = v.promotable.as_ref()?;
    Some(match &p.place {
        Some(place) => format!(
            "drift practices promote {} --in {}",
            sanitize(&v.id, 40),
            sanitize(place, 160)
        ),
        None => format!("drift practices promote {}", sanitize(&v.id, 40)),
    })
}

/// A variant of `concern` by id, a folded policy's alternatives included.
fn find_variant<'r>(r: &'r PracticesReport, concern: &str, id: &str) -> Option<&'r Variant> {
    r.concerns
        .iter()
        .filter(|c| c.id == concern)
        .flat_map(|c| c.variants.iter())
        .flat_map(|v| std::iter::once(v).chain(v.alternatives.iter()))
        .find(|v| v.id == id)
}

/// Whether any variant of the report may be promoted now.
fn any_promotable(r: &PracticesReport) -> bool {
    r.concerns
        .iter()
        .flat_map(|c| c.variants.iter())
        .any(|v| v.promotable.is_some() || v.alternatives.iter().any(|a| a.promotable.is_some()))
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
                // The ways the line names (the first with its copy, the second where it
                // differs), each with its command where it may be promoted.
                let first = c.variants.first().filter(|_| c.copy.is_some());
                let second = c.variants.get(1).filter(|_| c.differs.is_some());
                for v in first.into_iter().chain(second) {
                    if let Some(cmd) = find_variant(r, &c.concern, &v.id).and_then(promote_command)
                    {
                        let _ = writeln!(
                            out,
                            "      make {} the rule for new code: {cmd}",
                            sanitize(&v.label, 100)
                        );
                    }
                }
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
pub fn plain_concern(id: &str) -> &str {
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

/// The mechanisms of the concern classifiers, as their labels write them (a use's
/// mechanism with `_` as a space, then its instrument), and how the first run says
/// each to a newcomer: `{}` is the instrument, kept as the code names it. A row with
/// no `{}` is a whole use whose instrument is Drift's own word too
/// (`bubble framework_default`). Drift's closed vocabulary, read from the classifiers:
/// authn (`authn.rs`: wrap, decorator, dependency, base, config, app_hook, app_guard,
/// middleware, body_call, body_check, opens, identifies, service_auth), authz
/// (`authz.rs`), errors, api, validation, config, data access, logging (whose labels
/// are `message logs via <logger>`) and testing. A mechanism not listed is left as
/// it is.
const PLAIN_USES: &[(&str, &str)] = &[
    // authn
    ("wrap", "wrapped in {}"),
    ("decorator", "decorated with {}"),
    ("dependency", "depends on {}"),
    ("base", "inherits from {}"),
    ("config", "configured with {}"),
    ("app hook", "run through the app hook {}"),
    ("app guard", "behind the app-wide guard {}"),
    ("middleware", "behind the middleware {}"),
    ("body call", "calls {}"),
    ("body check", "checks {}"),
    ("opens probe", "public on purpose: a health probe"),
    ("opens", "public on purpose through {}"),
    ("identifies", "identifies the caller with {}"),
    ("service auth", "checks the sender with {}"),
    // authz
    ("role guard", "behind the role guard {}"),
    ("membership guard", "behind the membership guard {}"),
    ("tenancy guard", "behind the tenant guard {}"),
    ("permission", "behind the permission class {}"),
    ("role check", "checks the caller's role in {}"),
    ("tenancy check", "checks the caller's tenant in {}"),
    ("owner check", "checks the caller owns the record in {}"),
    (
        "tenancy filter",
        "queries scoped to the caller's tenant by {}",
    ),
    ("owner filter", "queries scoped to the caller by {}"),
    (
        "tenancy requested",
        "queries scoped to the tenant the request names by {}",
    ),
    ("tenancy literal", "queries scoped to a fixed tenant by {}"),
    ("own record", "acts on the caller's own record from {}"),
    ("owner stamp", "records the caller as owner with {}"),
    ("policy", "checked by the policy {}"),
    // errors
    ("mapped by wrapper", "turned into responses by {}"),
    ("base handler", "turned into responses by the base view's {}"),
    ("in body try return", "caught in the handler, which returns"),
    ("in body try swallow", "caught in the handler and dropped"),
    (
        "in body try respond",
        "caught in the handler and answered there",
    ),
    ("in body try", "caught in the handler and answered with {}"),
    ("app handler", "handled app-wide by {}"),
    ("throw", "throws {}"),
    ("bubble framework default", "left to the framework"),
    ("bubble", "left to {}"),
    // api
    ("builder return value", "the value returned"),
    ("builder", "built with {}"),
    ("model declared", "a declared response model"),
    ("model", "the response model {}"),
    ("envelope", "in the shape {}"),
    // validation
    (
        "typed model unchecked",
        "typed with {}, not checked when a request comes in",
    ),
    ("typed model", "parsed into a typed model by {}"),
    ("typed param", "parameters parsed by their declared types by {}"),
    (
        "schema repo schema",
        "checked against a schema of the repository",
    ),
    ("schema", "checked against a {} schema"),
    ("manual body check", "checked by hand"),
    // config
    ("config module", "read through the module {}"),
    ("in place", "read in place from {}"),
    ("env flag", "an environment flag {}"),
    ("secret client", "secrets fetched with {}"),
    ("env schema", "the environment checked with {}"),
    ("flag sdk", "flags from {}"),
    // data access
    ("entry direct", "the handler queries {} itself"),
    ("repository", "through a repository with {}"),
    ("service", "through a service with {}"),
    ("script", "in a script with {}"),
    // logging
    (
        "message logs via repo logger",
        "logs messages with the repository's logger {}",
    ),
    (
        "structured logs via repo logger",
        "logs structured records with the repository's logger {}",
    ),
    ("message logs via", "logs messages with {}"),
    ("structured logs via", "logs structured records with {}"),
    // testing
    ("tested none asserted", "tested with {}, no status asserted"),
    (
        "tested all required",
        "tested with {}, every case it needs asserted",
    ),
    (
        "tested some",
        "tested with {}, some cases it needs asserted",
    ),
];

/// One use as the first run words it ([`PLAIN_USES`]): the longest mechanism phrase
/// the use starts with, so `body call` is never read as `body`. A label writes a
/// mechanism with `_` as a space and the engine's relabelled uses keep the `_`
/// (`body_call auth`): both read the same. Anything else is left as it is.
fn plain_use(part: &str) -> String {
    let mut rows: Vec<&(&str, &str)> = PLAIN_USES.iter().collect();
    rows.sort_by_key(|(phrase, _)| std::cmp::Reverse(phrase.len()));
    for (phrase, plain) in rows {
        let Some(head) = part.get(..phrase.len()) else {
            continue;
        };
        if head.replace('_', " ") != *phrase {
            continue;
        }
        let rest = &part[phrase.len()..];
        let templated = plain.contains("{}");
        if rest.is_empty() && !templated {
            return plain.to_string();
        }
        if templated
            && let Some(instrument) = rest.strip_prefix(' ')
            && !instrument.is_empty()
        {
            return plain.replacen("{}", instrument, 1);
        }
    }
    part.to_string()
}

/// A variant's label as the first run words it. A label is its uses joined by ` + `
/// (a folded policy, its alternatives joined by `, or `), each a mechanism of Drift's
/// own vocabulary and the instrument read from the code; the mechanism words are
/// reworded ([`plain_use`]), and the instrument is kept as the code names it.
pub fn plain_way(label: &str) -> String {
    label
        .split(", or ")
        .map(|alt| {
            alt.split(" + ")
                .map(plain_use)
                .collect::<Vec<_>>()
                .join(" + ")
        })
        .collect::<Vec<_>>()
        .join(", or ")
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
fn first_run_concern(r: &PracticesReport, rc: &Recipe, c: &RecipeConcern) -> Option<String> {
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
        "{:<12} {} ({})",
        format!("{}:", plain_concern(&c.concern)),
        parts.join("; "),
        of_total(r, rc, c)
    ))
}

/// What a first-run concern line counts, said where it is not the heading's count of
/// entry points. The heading counts distinct entry points (path, symbol and method)
/// across the recipe's concerns; a concern counts its own units, one per entry point
/// and route it is mounted on (`Placed::ident`), and only of the entry points it
/// applies to (authz: where a caller is or may be signed in; validation: where input
/// may be read). More units than entry points is a handler mounted on more than one
/// route; fewer, entry points the concern does not count.
fn of_total(r: &PracticesReport, rc: &Recipe, c: &RecipeConcern) -> String {
    let n = c.total;
    if n == rc.population {
        return format!("of {n}");
    }
    let unit = r
        .concerns
        .iter()
        .find(|x| x.id == c.concern)
        .map(|x| x.unit.as_str());
    match unit {
        Some("entry_point") if n > rc.population => format!("of {n} route mounts"),
        Some("entry_point") => match c.concern.as_str() {
            AUTHZ => format!("of {n} where a caller is or may be signed in"),
            VALIDATION => format!("of {n} that may read input"),
            _ => format!("of {n} entry points it applies to"),
        },
        Some(u) if !u.is_empty() => format!("of {n} {}s", u.replace('_', " ")),
        _ => format!("of {n} units"),
    }
}

/// One finding for the first run, in a newcomer's words. `None` for what a person
/// settles in `.drift/config.yaml` (an unknown instrument): the first run points at
/// `drift practices --hints` for those.
fn first_run_finding(r: &PracticesReport, f: &Finding) -> Option<String> {
    let label = |vid: &str| {
        r.concerns
            .iter()
            .find(|c| c.id == f.concern)
            .and_then(|c| c.variants.iter().find(|v| v.id == vid))
            .map(|v| plain_way(&sanitize(&v.label, 100)))
            .unwrap_or_default()
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
    let line = match f.kind {
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
            label(&f.variants[0]),
            label(&f.variants[1]),
            f.members,
            places(f.members),
        ),
        FindingKind::None => format!(
            "{}{pkg}: {}, in {} {}{eg}",
            plain_concern(&f.concern),
            label(&f.variants[0]),
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
    };
    Some(format!("{line}{}", promotion_clause(r, f)))
}

/// The known variant most of `package`'s units of the concern use, by its row in the
/// package's profile (fewest id on a tie).
fn leading_in<'r>(c: &'r ConcernReport, package: &str) -> Option<&'r Variant> {
    let profile = c.by_package.iter().find(|p| p.package == package)?;
    profile
        .variants
        .iter()
        .filter_map(|pv| {
            c.variants
                .iter()
                .find(|v| v.id == pv.id && v.kind == VariantKind::Known)
                .map(|v| (pv.members, v))
        })
        .max_by(|a, b| a.0.cmp(&b.0).then(b.1.id.cmp(&a.1.id)))
        .map(|(_, v)| v)
}

/// `; make the usual way the rule for new code: <command>` where the way most of the
/// finding's package does its concern may be promoted; nothing otherwise. Only for
/// units nothing was found for: there the usual way is the answer. Never for an
/// unexplained split (the code has not chosen between its two ways), nor for a key
/// nothing scopes or a copied helper, which no way of the map settles.
fn promotion_clause(r: &PracticesReport, f: &Finding) -> String {
    if f.kind != FindingKind::None {
        return String::new();
    }
    let Some(package) = f.package.as_deref() else {
        return String::new();
    };
    r.concerns
        .iter()
        .find(|c| c.id == f.concern)
        .and_then(|c| leading_in(c, package))
        .and_then(promote_command)
        .map(|cmd| format!("; make the usual way the rule for new code: {cmd}"))
        .unwrap_or_default()
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
                    .filter_map(|c| first_run_concern(r, rc, c))
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
    let mut ranked: Vec<&Finding> = r.findings.iter().collect();
    ranked.sort_by_key(|f| first_run_rank(f));
    // No more than two of a kind before the others have had their turn: a
    // repository of many packages would list one thing five times.
    let mut seen: std::collections::BTreeMap<u8, usize> = std::collections::BTreeMap::new();
    let (first, later): (Vec<&Finding>, Vec<&Finding>) = ranked.into_iter().partition(|f| {
        let n = seen.entry(first_run_rank(f)).or_default();
        *n += 1;
        *n <= 2
    });
    let findings: Vec<String> = first
        .into_iter()
        .chain(later)
        .filter_map(|f| first_run_finding(r, f))
        .collect();
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
        let promote = if any_promotable(r) {
            " `drift practices promote --list` lists the practices you can make a rule for new code."
        } else {
            ""
        };
        let _ = writeln!(
            out,
            "  {more}`drift security` lists every entry point with its guard and what it reaches.{promote}"
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
            "  5. data access in p1: two ways side by side, through a service with pg and the handler queries pg itself (2 places), and nothing sets them apart (e.g. p1/a.ts:3 GET)",
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

    /// Every mechanism phrase of [`PLAIN_USES`] in plain words, the instrument kept as
    /// the code names it; the engine's relabelled form (`body_call`) reads the same.
    #[test]
    fn every_mechanism_phrase_reads_as_plain_words() {
        let cases: &[(&str, &str)] = &[
            ("wrap withAuth", "wrapped in withAuth"),
            ("decorator login_required", "decorated with login_required"),
            ("dependency get_current_user", "depends on get_current_user"),
            (
                "base LoginRequiredMixin",
                "inherits from LoginRequiredMixin",
            ),
            (
                "config SessionMiddleware",
                "configured with SessionMiddleware",
            ),
            (
                "app hook before_request",
                "run through the app hook before_request",
            ),
            ("app guard AuthGuard", "behind the app-wide guard AuthGuard"),
            (
                "middleware clerkMiddleware",
                "behind the middleware clerkMiddleware",
            ),
            ("body call requireUser", "calls requireUser"),
            ("body_call auth", "calls auth"),
            ("body check verifyToken", "checks verifyToken"),
            ("opens probe", "public on purpose: a health probe"),
            ("opens AllowAny", "public on purpose through AllowAny"),
            (
                "identifies SessionAuthentication",
                "identifies the caller with SessionAuthentication",
            ),
            (
                "service auth constructEvent",
                "checks the sender with constructEvent",
            ),
            ("role guard RolesGuard", "behind the role guard RolesGuard"),
            (
                "membership guard requireMember",
                "behind the membership guard requireMember",
            ),
            (
                "tenancy guard require_tenant",
                "behind the tenant guard require_tenant",
            ),
            ("permission IsOwner", "behind the permission class IsOwner"),
            ("role check isAdmin", "checks the caller's role in isAdmin"),
            (
                "tenancy check ensureOrg",
                "checks the caller's tenant in ensureOrg",
            ),
            (
                "owner check ensureOwner",
                "checks the caller owns the record in ensureOwner",
            ),
            (
                "tenancy filter orgId (session)",
                "queries scoped to the caller's tenant by orgId (session)",
            ),
            (
                "owner filter where.userId (session)",
                "queries scoped to the caller by where.userId (session)",
            ),
            (
                "tenancy requested orgId (param)",
                "queries scoped to the tenant the request names by orgId (param)",
            ),
            (
                "tenancy literal orgId (literal)",
                "queries scoped to a fixed tenant by orgId (literal)",
            ),
            (
                "own record getUser",
                "acts on the caller's own record from getUser",
            ),
            (
                "owner stamp createdBy",
                "records the caller as owner with createdBy",
            ),
            ("policy can", "checked by the policy can"),
            (
                "mapped by wrapper withErrors",
                "turned into responses by withErrors",
            ),
            ("in body try return", "caught in the handler, which returns"),
            ("in body try swallow", "caught in the handler and dropped"),
            (
                "in body try respond",
                "caught in the handler and answered there",
            ),
            (
                "in body try NextResponse.json",
                "caught in the handler and answered with NextResponse.json",
            ),
            (
                "app handler auth_exception_handler",
                "handled app-wide by auth_exception_handler",
            ),
            ("throw HTTPException", "throws HTTPException"),
            ("bubble framework_default", "left to the framework"),
            ("bubble onError", "left to onError"),
            ("builder return_value", "the value returned"),
            ("builder Response.json", "built with Response.json"),
            ("model declared", "a declared response model"),
            ("model UserOut", "the response model UserOut"),
            ("envelope {error}", "in the shape {error}"),
            (
                "typed model unchecked class-validator",
                "typed with class-validator, not checked when a request comes in",
            ),
            (
                "typed model rest_framework",
                "parsed into a typed model by rest_framework",
            ),
            (
                "schema repo_schema",
                "checked against a schema of the repository",
            ),
            ("schema zod", "checked against a zod schema"),
            ("manual body_check", "checked by hand"),
            (
                "config module lib/env.ts",
                "read through the module lib/env.ts",
            ),
            ("in place process.env", "read in place from process.env"),
            ("env flag FEATURE_X", "an environment flag FEATURE_X"),
            (
                "secret client SecretManager",
                "secrets fetched with SecretManager",
            ),
            ("env schema config", "the environment checked with config"),
            ("flag sdk launchdarkly", "flags from launchdarkly"),
            ("entry direct pg", "the handler queries pg itself"),
            ("repository pg", "through a repository with pg"),
            ("service pg", "through a service with pg"),
            ("script pg", "in a script with pg"),
            (
                "message logs via repo logger lib/log.ts#logger (pino)",
                "logs messages with the repository's logger lib/log.ts#logger (pino)",
            ),
            (
                "structured logs via repo logger lib/log.ts#logger (pino)",
                "logs structured records with the repository's logger lib/log.ts#logger (pino)",
            ),
            ("message logs via print", "logs messages with print"),
            (
                "structured logs via tslog",
                "logs structured records with tslog",
            ),
            (
                "tested none asserted vitest",
                "tested with vitest, no status asserted",
            ),
            (
                "tested all required vitest",
                "tested with vitest, every case it needs asserted",
            ),
            (
                "tested some pytest",
                "tested with pytest, some cases it needs asserted",
            ),
        ];
        for (label, plain) in cases {
            assert_eq!(plain_way(label), *plain, "{label}");
        }
        // Every row of the table is read by at least one case.
        for (phrase, _) in PLAIN_USES {
            assert!(
                cases.iter().any(|(label, _)| {
                    label
                        .get(..phrase.len())
                        .is_some_and(|h| h.replace('_', " ") == *phrase)
                }),
                "no case for {phrase}"
            );
        }
    }

    /// A phrase Drift's vocabulary does not have, a mechanism with no instrument and a
    /// person's own words are left as they are.
    #[test]
    fn an_unknown_phrase_is_left_unchanged() {
        for label in [
            "frobnicate withThing",
            "wrap",
            "wrapper withAuth",
            "rule access (declared in .drift/config.yaml: RuleBook._ensure_access)",
        ] {
            assert_eq!(plain_way(label), label);
        }
    }

    /// Each use of a compound label is reworded on its own, and so is each side of a
    /// folded policy.
    #[test]
    fn compound_labels_and_policies_are_reworded_use_by_use() {
        assert_eq!(
            plain_way("manual body_check + typed model rest_framework"),
            "checked by hand + parsed into a typed model by rest_framework"
        );
        assert_eq!(
            plain_way("wrap withAuth + body call audit, or dependency get_user"),
            "wrapped in withAuth + calls audit, or depends on get_user"
        );
        assert_eq!(
            plain_way("frobnicate x + wrap withAuth"),
            "frobnicate x + wrapped in withAuth"
        );
    }

    fn concern(id: &str, unit: &str) -> ConcernReport {
        ConcernReport {
            id: id.into(),
            unit: unit.into(),
            ..Default::default()
        }
    }

    /// A line whose total is the heading's says nothing more; one that counts more says
    /// it counts route mounts, and one that counts fewer says which entry points.
    #[test]
    fn a_line_says_what_it_counts_where_the_heading_counts_otherwise() {
        let mut rc = recipe("apps/api", 10);
        rc.concerns[0].total = 14;
        rc.concerns[0].variants[0].members = 10;
        rc.concerns.push(RecipeConcern {
            concern: VALIDATION.into(),
            total: 6,
            variants: vec![RecipeVariant {
                id: "P-v".into(),
                label: "schema zod".into(),
                members: 6,
                share: 1.0,
            }],
            ..Default::default()
        });
        rc.concerns.push(RecipeConcern {
            concern: AUTHZ.into(),
            total: 7,
            none: 7,
            ..Default::default()
        });
        let r = PracticesReport {
            concerns: vec![
                concern(AUTHN, "entry_point"),
                concern(AUTHZ, "entry_point"),
                concern(ERRORS, "entry_point"),
                concern(VALIDATION, "entry_point"),
            ],
            recipes: vec![rc],
            ..Default::default()
        };
        let out = render_first_run(&r);
        assert!(
            out.contains(
                "  10 http entry points in apps/api\n    sign-in:     calls requireUser in 10; other ways in 1; nothing found in 2; could not tell in 1 (of 14 route mounts)\n"
            ),
            "{out}"
        );
        assert!(
            out.contains("    errors:      left to the framework in 10 (of 10)\n"),
            "{out}"
        );
        assert!(
            out.contains(
                "    validation:  checked against a zod schema in 6 (of 6 that may read input)\n"
            ),
            "{out}"
        );
        assert!(
            out.contains(
                "    permissions: nothing found in 7 (of 7 where a caller is or may be signed in)\n"
            ),
            "{out}"
        );
        assert_eq!(out.matches("route mounts").count(), 1, "{out}");
    }

    /// The report of a package `p2` whose sign-in is mostly `P-a`, promotable when
    /// `place` is given.
    fn promotable_report(
        promotable: Option<Promotable>,
        findings: Vec<Finding>,
    ) -> PracticesReport {
        let mut lead = variant("P-a", "wrap withAuth");
        lead.promotable = promotable;
        let mut other = variant("P-b", "body call requireUser");
        other.members = 1;
        let mut none = variant("P-n", basis::AUTHN_NONE);
        none.kind = VariantKind::None;
        PracticesReport {
            concerns: vec![ConcernReport {
                id: AUTHN.into(),
                unit: "entry_point".into(),
                variants: vec![lead, other, none],
                by_package: vec![PackageProfile {
                    package: "p2".into(),
                    total: 12,
                    variants: vec![
                        PackageVariant {
                            id: "P-n".into(),
                            members: 2,
                            share: 0.0,
                        },
                        PackageVariant {
                            id: "P-a".into(),
                            members: 9,
                            share: 0.0,
                        },
                        PackageVariant {
                            id: "P-b".into(),
                            members: 1,
                            share: 0.0,
                        },
                    ],
                    ..Default::default()
                }],
                ..Default::default()
            }],
            findings,
            ..Default::default()
        }
    }

    fn place(p: Option<&str>) -> Option<Promotable> {
        Some(Promotable {
            rule: "practice".into(),
            role: String::new(),
            place: p.map(str::to_string),
        })
    }

    const SECURITY: &str =
        "`drift security` lists every entry point with its guard and what it reaches.";
    const LIST: &str =
        "`drift practices promote --list` lists the practices you can make a rule for new code.";

    /// A `none` finding in a package whose usual way may be promoted ends with the
    /// command, once; the closing line points at `--list` beside `drift security`.
    #[test]
    fn a_none_finding_points_at_promoting_the_usual_way() {
        let r = promotable_report(
            place(Some("p2/app")),
            vec![finding(FindingKind::None, AUTHN, "p2", &["P-n"])],
        );
        let out = render_first_run(&r);
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(
            lines[1],
            "  1. sign-in in p2: no guard found in what Drift read, in 2 places (e.g. p2/a.ts:3 GET); make the usual way the rule for new code: drift practices promote P-a --in p2/app",
            "{out}"
        );
        assert_eq!(
            out.matches("drift practices promote P-").count(),
            1,
            "{out}"
        );
        assert_eq!(lines[2], format!("  {SECURITY} {LIST}"), "{out}");
        // No place: the command finds it.
        let r = promotable_report(
            place(None),
            vec![finding(FindingKind::None, AUTHN, "p2", &["P-n"])],
        );
        let out = render_first_run(&r);
        assert!(
            out.contains("(e.g. p2/a.ts:3 GET); make the usual way the rule for new code: drift practices promote P-a\n"),
            "{out}"
        );
    }

    /// An unexplained split gets no command: the code has not chosen. Nothing
    /// promotable: no command and no `--list`.
    #[test]
    fn no_promotion_on_a_split_or_when_nothing_is_promotable() {
        let split = finding(FindingKind::UnexplainedSplit, AUTHN, "p2", &["P-a", "P-b"]);
        let r = promotable_report(place(Some("p2")), vec![split.clone()]);
        let out = render_first_run(&r);
        assert!(!out.contains("make the usual way"), "{out}");
        assert!(out.ends_with(&format!("  {SECURITY} {LIST}\n")), "{out}");
        let r = promotable_report(
            None,
            vec![finding(FindingKind::None, AUTHN, "p2", &["P-n"]), split],
        );
        let out = render_first_run(&r);
        assert!(!out.contains("drift practices promote"), "{out}");
        assert!(out.ends_with(&format!("  {SECURITY}\n")), "{out}");
    }

    /// `drift practices` and `--all` give the command under a promotable variant,
    /// leaving the lines around it as they were.
    #[test]
    fn practices_text_gives_the_command_under_a_promotable_variant() {
        let mut r = promotable_report(place(Some("p2")), Vec::new());
        r.concerns[0].variants[0].members = 9;
        r.recipes = vec![Recipe {
            package: "p2".into(),
            role: "http".into(),
            label: "http entry points in p2".into(),
            population: 12,
            concerns: vec![RecipeConcern {
                concern: AUTHN.into(),
                total: 12,
                variants: vec![RecipeVariant {
                    id: "P-a".into(),
                    label: "wrap withAuth".into(),
                    members: 9,
                    share: 0.75,
                }],
                copy: Some(Example {
                    path: "p2/a.ts".into(),
                    symbol: "GET".into(),
                    line: 3,
                }),
                none: 2,
                unknown: 1,
                ..Default::default()
            }],
            ..Default::default()
        }];
        let out = render_recipes(&r);
        assert!(
            out.contains(
                "    authn: wrap withAuth 9/12 (copy p2/a.ts:3 GET); none 2/12 (nothing found in what Drift read); 1 unknown (not counted)\n      make wrap withAuth the rule for new code: drift practices promote P-a --in p2\n"
            ),
            "{out}"
        );
        let all = render(&r, true);
        assert_eq!(
            all.matches(
                "      make it the rule for new code: drift practices promote P-a --in p2\n"
            )
            .count(),
            1,
            "{all}"
        );
    }
}
