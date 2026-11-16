//! `drift security --diff-base` and `--format sarif`, and what `drift check` says of
//! the security baseline in SARIF and of the lines a change writes into it.
//!
//! What a change adds is decided once ([`drift_mine::security_diff::added`], the
//! ratchet's own comparison with the merge base as the baseline), for every kind the
//! baseline holds; [`drift_mine::security::regressions`] explains the rows it can (the
//! guard siblings share, one to copy) and is made to agree with it. The SARIF of the
//! security findings is written here once, for both commands ([`sarif_results`]).

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::Path;
use std::process::ExitCode;

use anyhow::Context;
use drift_core::RepoFacts;
use drift_mine::ratchet::{self, Added, Findings, Ratchet, SECURITY_LOCK};
use drift_mine::report::{github_escape_data, github_escape_property, sanitize};
use drift_mine::security::{Inventory, NOT_COVERED};
use drift_mine::security_diff::{self, ChangeFindings, Keys};
use serde_json::{Value, json};

use crate::{Cli, pr};

/// What `drift security --diff-base` prints.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Out {
    Text,
    Json,
    Github,
    Sarif,
}

/// The merge base's security findings and inventory, read as `drift security` reads
/// the repository now ([`findings_read`]).
pub struct BaseSecurity {
    pub found: Findings,
    pub inv: Inventory,
    /// Why the practice map could not be read there, so its kinds are not in `found`
    /// ([`security_diff::PRACTICE_MAP_KINDS`]).
    pub authz_error: Option<String>,
    /// The merge base's files not parsed for lack of stack: what they held is unknown.
    pub unparsed: BTreeSet<String>,
}

/// The findings of `inv` as the baseline holds them, with the practice map's
/// (`crate::baseline_findings`); where the map cannot be read, the rest, and why.
pub fn findings_read(
    root: &Path,
    facts: &RepoFacts,
    inv: &Inventory,
) -> (Findings, Option<String>) {
    let mut found = ratchet::findings(inv, facts);
    match crate::authz_units(root, facts) {
        Ok(units) => {
            ratchet::add_unauthorized(&mut found, &units);
            ratchet::add_unscoped(&mut found, &units);
            (found, None)
        }
        Err(e) => (found, Some(format!("{e:#}"))),
    }
}

/// The merge base of `s`, checked out and scanned ([`pr::DiffScope::with_base`]): its
/// inventory with its CI workflows, dependencies and Kubernetes manifests, and its
/// findings.
pub fn read_base(s: &pr::DiffScope, root: &Path) -> anyhow::Result<BaseSecurity> {
    s.with_base(root, |base_root, base_facts| {
        let mut inv = drift_mine::security::inventory_with(
            base_facts,
            drift_mine::security::Boundaries::load(base_root),
        );
        inv.workflows = drift_mine::workflows::read(base_root);
        inv.dependencies = drift_mine::dependencies::read(base_root);
        inv.cluster = drift_mine::kubernetes::read(base_root);
        drift_mine::hardening::fill(&mut inv, base_root);
        let (found, authz_error) = findings_read(base_root, base_facts, &inv);
        BaseSecurity {
            found,
            inv,
            authz_error,
            unparsed: drift_mine::unchecked::Unchecked::of(base_facts).files,
        }
    })
}

/// What the change of `scope` adds to the findings of `inv` (the repository now),
/// against the merge base ([`security_diff::added`]), with the merge base's inventory.
pub fn change(
    root: &Path,
    scope: &pr::DiffScope,
    facts: &RepoFacts,
    inv: &Inventory,
) -> anyhow::Result<(Inventory, ChangeFindings)> {
    let (head, head_error) = findings_read(root, facts, inv);
    let base = read_base(scope, root)?;
    let base_now = security_diff::as_now(&base.found, &base.inv, inv, scope.renamed());
    let outside = ratchet::not_the_changes_gaps(&base.inv, inv, &base_now, &|p| scope.touches(p));
    let mut cf = security_diff::added(&head, &base_now, &outside);
    security_diff::set_apart_unparsed(&mut cf, &base.unparsed, &|p| scope.old_path(p).to_string());
    let why = match (&head_error, &base.authz_error) {
        (Some(e), _) => Some(format!("the practice map could not be read ({e})")),
        (None, Some(e)) => Some(format!(
            "the practice map could not be read at the merge base ({e})"
        )),
        (None, None) => None,
    };
    if let Some(why) = why {
        security_diff::not_compared(&mut cf, security_diff::PRACTICE_MAP_KINDS, &why);
    }
    Ok((base.inv, cf))
}

/// `text` with `extra` put before its closing paragraph (`end`), or at its end.
fn before(text: String, end: &str, extra: &str) -> String {
    if extra.is_empty() {
        return text;
    }
    match text.strip_suffix(end) {
        Some(head) => format!("{head}{extra}{end}"),
        None => format!("{text}{extra}"),
    }
}

/// `drift security --diff-base REF`: what the change adds, every kind of finding the
/// baseline holds compared by its key, and what was not compared. Exit 1 only on what
/// `--fail-on` names: a finding of a named kind the change adds, or a named kind that
/// could not be compared (a gate fails closed).
#[allow(clippy::too_many_arguments)]
pub fn run(
    cli: &Cli,
    root: &Path,
    facts: &RepoFacts,
    inv: &Inventory,
    base: &str,
    out: Out,
    fail_on: &[String],
    max: usize,
) -> anyhow::Result<ExitCode> {
    let scope = pr::DiffScope::from_git(root, base)?;
    let (before_inv, cf) = change(root, &scope, facts, inv)?;
    let mut regs =
        drift_mine::security::regressions(&before_inv, inv, &|p| scope.touches(p), &|p| {
            scope.old_path(p).to_string()
        });
    let rest = security_diff::agree(&mut regs, &cf.added);
    let files = scope.added() + scope.changed();
    let named = |k: &str| fail_on.iter().any(|f| f == k || f == "any");
    if out != Out::Json {
        for w in &inv.warnings {
            eprintln!("drift security: {w}");
        }
    }
    match out {
        Out::Json => {
            let mut v = serde_json::to_value(&regs)?;
            v["diff"] = json!({
                "base": base,
                "merge_base": scope.merge_base,
                "files": files,
            });
            v["added"] = serde_json::to_value(&cf.added)?;
            if !cf.outside_change.is_empty() {
                v["outside_change"] = serde_json::to_value(&cf.outside_change)?;
            }
            if !cf.not_compared.is_empty() {
                v["not_compared"] = serde_json::to_value(&cf.not_compared)?;
            }
            if !inv.warnings.is_empty() {
                v["warnings"] = json!(inv.warnings);
            }
            println!("{}", serde_json::to_string_pretty(&v)?);
        }
        Out::Github => {
            let mut stdout = std::io::stdout().lock();
            stdout
                .write_all(drift_mine::security::github_regression_annotations(&regs).as_bytes())?;
            stdout.write_all(security_diff::github_rest(&rest, &cf.not_compared).as_bytes())?;
            writeln!(
                stdout,
                "drift security: {} entry point(s) lacking a shared guard, {} where Drift found no guard in what it read reaching a risky operation, {} new entry point(s) where Drift found no guard ({} more whose guard is unknown), {} risky operation(s) added, {} new client leak(s), {} now internet-facing; facts for review, nothing fails",
                regs.guard_gaps.len(),
                regs.unguarded_reaching.len(),
                regs.added_without_guard.len(),
                regs.guard_unknown.len(),
                regs.sinks.len(),
                regs.leaks.len(),
                regs.now_public.len()
            )?;
            if !rest.is_empty() {
                let by: Vec<String> = rest
                    .iter()
                    .map(|(k, rows)| format!("{} {k}", rows.len()))
                    .collect();
                writeln!(
                    stdout,
                    "drift security: {} other finding(s) this change adds, keyed as the security baseline holds them: {}",
                    rest.values().map(Vec::len).sum::<usize>(),
                    by.join(", ")
                )?;
            }
            if let Some(path) = std::env::var_os("GITHUB_STEP_SUMMARY").filter(|p| !p.is_empty()) {
                let md = drift_mine::security::regressions_summary(
                    &regs,
                    base,
                    &scope.merge_base,
                    files,
                );
                let md = before(
                    md,
                    &format!("_{NOT_COVERED}_\n"),
                    &security_diff::summary_rest(&rest, &cf.not_compared),
                );
                let mut f = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .with_context(|| {
                        format!("opening GITHUB_STEP_SUMMARY {}", Path::new(&path).display())
                    })?;
                f.write_all(md.as_bytes())?;
                f.write_all(b"\n")?;
            }
        }
        Out::Sarif => {
            let prefix = crate::project::git_prefix(root);
            let baseline = ratchet::load_baseline(root)
                .with_context(|| format!("reading {SECURITY_LOCK}"))?
                .unwrap_or_default();
            let mut log = sarif_log();
            let mut notes = Vec::new();
            for (kind, rows) in &cf.added {
                let level = if named(kind) || baseline.fails(kind) {
                    "error"
                } else {
                    "note"
                };
                sarif_results(&mut log, kind, rows, level, &prefix, &|a| {
                    format!(
                        "Security [{kind}]: {} is added by this change (not found at the merge base {}).",
                        sanitize(&a.key, 300),
                        &scope.merge_base[..scope.merge_base.len().min(12)]
                    )
                });
            }
            let public: Vec<Added> = regs
                .now_public
                .iter()
                .map(|e| Added {
                    key: format!("{}#{}", e.path, e.symbol),
                    at: format!("{}:{}", e.path, e.line),
                })
                .collect();
            sarif_results(
                &mut log,
                "public",
                &public,
                if named("public") { "error" } else { "note" },
                &prefix,
                &|a| {
                    format!(
                        "Security [public]: {} is internet-facing now and was not at the merge base.",
                        sanitize(&a.key, 300)
                    )
                },
            );
            for e in &regs.guard_unknown {
                notes.push(json!({
                    "level": "note",
                    "message": { "text": format!("Not checked: new entry point {}#{} whose guard Drift could not read (unknown is never a finding).", sanitize(&e.path, 160), sanitize(&e.symbol, 80)) },
                    "locations": at(&format!("{prefix}{}", e.path), e.line),
                }));
            }
            not_compared_notes(&mut notes, &cf, &prefix);
            for w in &inv.warnings {
                notes.push(json!({ "level": "warning", "message": { "text": w } }));
            }
            print_sarif(log, notes)?;
        }
        Out::Text => {
            let text = drift_mine::security::render_regressions(
                &regs,
                base,
                &scope.merge_base,
                files,
                Some(&cli.root),
            );
            print!(
                "{}",
                before(
                    text,
                    &format!("\n{NOT_COVERED}\n"),
                    &security_diff::render_rest(&rest, &cf.not_compared, max)
                )
            );
        }
    }
    // A person asked for the run to fail on what the change introduces (`--fail-on`):
    // counted by kind, said on stderr, exit 1. A kind named that could not be compared
    // fails too: a gate that cannot tell does not pass.
    let mut failing: Vec<String> = cf
        .added
        .iter()
        .filter(|(k, rows)| named(k) && !rows.is_empty())
        .map(|(k, rows)| format!("{} {k}", rows.len()))
        .collect();
    if named("public") && !regs.now_public.is_empty() {
        failing.push(format!("{} public", regs.now_public.len()));
    }
    let unknown: BTreeSet<&str> = cf
        .not_compared
        .iter()
        .filter(|n| named(&n.kind))
        .map(|n| n.kind.as_str())
        .collect();
    if !unknown.is_empty() {
        eprintln!(
            "drift security: failing as asked (--fail-on {}): {} could not be compared with the merge base, so whether this change adds any is unknown",
            fail_on.join(","),
            unknown.into_iter().collect::<Vec<_>>().join(", ")
        );
        return Ok(ExitCode::from(1));
    }
    if !failing.is_empty() {
        eprintln!(
            "drift security: failing as asked (--fail-on {}): this change introduces {}",
            fail_on.join(","),
            failing.join(", ")
        );
        return Ok(ExitCode::from(1));
    }
    Ok(ExitCode::SUCCESS)
}

/// `drift security --format sarif` of the whole inventory: every finding the baseline
/// would hold, a result each, at the level `drift check` gives a finding of its kind
/// that is not in the baseline (`error` for a kind the baseline, or a new one, sets to
/// fail; `note` for one that advises).
pub fn inventory(root: &Path, facts: &RepoFacts, inv: &Inventory) -> anyhow::Result<()> {
    let (found, not_read) = findings_read(root, facts, inv);
    let baseline = ratchet::load_baseline(root)
        .with_context(|| format!("reading {SECURITY_LOCK}"))?
        .unwrap_or_default();
    let prefix = crate::project::git_prefix(root);
    let mut by_kind: BTreeMap<&str, Vec<Added>> = BTreeMap::new();
    for ((kind, key), at) in &found {
        by_kind.entry(kind.as_str()).or_default().push(Added {
            key: key.clone(),
            at: at.clone(),
        });
    }
    let mut log = sarif_log();
    for (kind, rows) in &by_kind {
        let level = if baseline.fails(kind) {
            "error"
        } else {
            "note"
        };
        sarif_results(&mut log, kind, rows, level, &prefix, &|a| {
            format!("Security [{kind}]: {}.", sanitize(&a.key, 300))
        });
    }
    let mut notes = Vec::new();
    if let Some(e) = not_read {
        notes.push(json!({
            "level": "warning",
            "message": { "text": format!("Not read: the practice map could not be read ({}), so findings of {} are not listed.", sanitize(&e, 300), security_diff::PRACTICE_MAP_KINDS.join(", ")) },
        }));
    }
    for w in &inv.warnings {
        notes.push(json!({ "level": "warning", "message": { "text": w } }));
    }
    print_sarif(log, notes)
}

/// `drift security --ratchet --format sarif`: what `drift check --format sarif` says
/// of the baseline ([`sarif_ratchet`]), and the findings of kinds that advise as
/// notes.
pub fn ratchet_sarif(root: &Path, r: &Ratchet) -> anyhow::Result<()> {
    let prefix = crate::project::git_prefix(root);
    let mut log = sarif_log();
    let mut notes = Vec::new();
    sarif_ratchet(&mut log, &mut notes, r, &prefix);
    for (kind, rows) in &r.advised {
        sarif_results(&mut log, kind, rows, "note", &prefix, &|a| {
            format!(
                "Security [{kind}] (advice: the baseline does not set this kind to fail): {} is not in the security baseline ({SECURITY_LOCK}).",
                sanitize(&a.key, 300)
            )
        });
    }
    print_sarif(log, notes)
}

/// A SARIF log of Drift with no result yet.
fn sarif_log() -> Value {
    drift_mine::report::sarif_with_exempt(&[], &[], env!("CARGO_PKG_VERSION"))
}

/// Prints `log` with `notes` as the run's notifications.
fn print_sarif(mut log: Value, notes: Vec<Value>) -> anyhow::Result<()> {
    if !notes.is_empty() {
        log["runs"][0]["invocations"] = json!([{
            "executionSuccessful": true,
            "toolExecutionNotifications": notes,
        }]);
    }
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer_pretty(&mut stdout, &log)?;
    writeln!(stdout)?;
    Ok(())
}

/// A SARIF location list of one line of a file.
fn at(path: &str, line: u32) -> Value {
    json!([{ "physicalLocation": { "artifactLocation": { "uri": path }, "region": { "startLine": line.max(1) } } }])
}

/// What was not compared, as warnings of the run.
fn not_compared_notes(notes: &mut Vec<Value>, cf: &ChangeFindings, prefix: &str) {
    for n in &cf.not_compared {
        let text = format!(
            "Not compared [{}]: {}",
            sanitize(&n.kind, 60),
            sanitize(&n.why, 300)
        );
        if n.rows.is_empty() {
            notes.push(json!({ "level": "warning", "message": { "text": text } }));
        }
        for a in &n.rows {
            let (path, line) = a.at.rsplit_once(':').unwrap_or((a.at.as_str(), "1"));
            notes.push(json!({
                "level": "warning",
                "message": { "text": format!("{text}: {}", sanitize(&a.key, 300)) },
                "locations": at(&format!("{prefix}{path}"), line.parse().unwrap_or(1)),
            }));
        }
    }
}

/// Adds `rows` of `kind` to `log` as results at `level`, under the rule
/// `drift-security/<kind>` (added to the driver's rules on first use), each at its
/// `path:line` from the git top level (`prefix`). The one writer of security results:
/// `drift check` and `drift security` give a finding the same rule and location.
pub fn sarif_results(
    log: &mut Value,
    kind: &str,
    rows: &[Added],
    level: &str,
    prefix: &str,
    message: &dyn Fn(&Added) -> String,
) {
    if rows.is_empty() {
        return;
    }
    let rule = format!("drift-security/{kind}");
    if let Some(rules) = log["runs"][0]["tool"]["driver"]["rules"].as_array_mut()
        && !rules.iter().any(|r| r["id"] == rule.as_str())
    {
        let what = ratchet::KINDS.iter().find(|(k, _)| *k == kind).map_or(
            if kind == "public" {
                "entry point(s) made internet-facing"
            } else {
                "finding(s)"
            },
            |(_, w)| w,
        );
        rules.push(json!({
            "id": rule,
            "shortDescription": { "text": format!("Security: {what} ({kind})") },
            "defaultConfiguration": { "level": level },
        }));
    }
    if let Some(results) = log["runs"][0]["results"].as_array_mut() {
        for a in rows {
            let (path, line) = a.at.rsplit_once(':').unwrap_or((a.at.as_str(), "1"));
            results.push(json!({
                "ruleId": rule,
                "level": level,
                "message": { "text": message(a) },
                "locations": at(&format!("{prefix}{path}"), line.parse().unwrap_or(1)),
            }));
        }
    }
}

/// What `drift check --format sarif` says of the security baseline: findings of
/// readings newer than it and what its header says, as notifications; each finding
/// not in it that fails, a result (`error`); each the change adds and baselines itself
/// ([`Ratchet::baselined_by_change`]), a result too (`note`: it fails nothing, and a
/// result is what code scanning shows a reviewer).
pub fn sarif_ratchet(log: &mut Value, notes: &mut Vec<Value>, sec: &Ratchet, prefix: &str) {
    // Findings of readings newer than the baseline: said once, never results
    // ([`drift_mine::ratchet::Ratchet::new_in_drift`]).
    if let Some(line) = ratchet::newer_readings_line(sec) {
        notes.push(json!({ "level": "note", "message": { "text": line } }));
    }
    for line in crate::security_said(sec) {
        notes.push(json!({ "level": "warning", "message": { "text": line } }));
    }
    // What the security baseline does not hold fails the check: a result, so that
    // code scanning shows why, under a rule per kind.
    for (kind, rows) in &sec.added {
        sarif_results(log, kind, rows, "error", prefix, &|a| {
            format!(
                "Security [{kind}]: {} is not in the security baseline ({SECURITY_LOCK}).",
                sanitize(&a.key, 300)
            )
        });
    }
    for (kind, rows) in &sec.baselined_by_change {
        sarif_results(log, kind, rows, "note", prefix, &|a| {
            format!(
                "Security [{kind}]: {}: {}",
                sanitize(&a.key, 300),
                BASELINED
            )
        });
    }
}

/// What is said of a finding a change adds and baselines itself.
const BASELINED: &str = "this change adds the finding and baselines it (its line is new in .drift/security.lock), so it fails nothing; a reviewer accepts it by approving the lock's diff.";

/// `drift check --format github`: a notice for each finding the change adds and
/// baselines itself ([`Ratchet::baselined_by_change`]).
pub fn github_baselined(sec: &Ratchet, prefix: &str) -> String {
    let mut out = String::new();
    for (kind, rows) in &sec.baselined_by_change {
        for a in rows {
            let (path, line) = a.at.rsplit_once(':').unwrap_or((a.at.as_str(), "1"));
            out.push_str(&format!(
                "::notice file={},line={},title={}::{}\n",
                github_escape_property(&format!("{prefix}{path}")),
                github_escape_property(line),
                github_escape_property(&format!("drift security [{kind}]")),
                github_escape_data(&format!("{}: {BASELINED}", sanitize(&a.key, 300)))
            ));
        }
    }
    out
}

/// The findings a change writes into `.drift/security.lock` (lines the merge base's
/// lock did not have; all of them where it had none). A header edit, lines that only
/// moved, and a lock the change deletes write none.
pub fn lock_lines_added(root: &Path, s: &pr::DiffScope) -> Keys {
    let Ok(now) = std::fs::read_to_string(root.join(SECURITY_LOCK)) else {
        return Keys::new();
    };
    let was = pr::file_at(root, &s.merge_base, SECURITY_LOCK)
        .map(|t| ratchet::parse_lock(&t))
        .unwrap_or_default();
    ratchet::parse_lock(&now)
        .into_iter()
        .filter(|k| !was.contains(k))
        .collect()
}
