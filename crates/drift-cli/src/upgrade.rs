//! `drift upgrade` (stream S32): after someone installs a newer Drift, what that Drift
//! reads differently in the files an older one wrote, said in one place instead of in
//! warnings on unrelated commands; and, with `--apply`, only what cannot change a
//! decision a person made.
//!
//! - **Report first.** Without `--apply` nothing is written (the fact cache aside, as
//!   for `drift check`; `--no-cache` writes nothing at all). The report says, per file
//!   under `.drift/` and `drift.lock`, what the file records of the Drift that wrote it
//!   and of its format (and says so when it records nothing: Drift never guesses a
//!   writer); per accepted convention, its evidence when it was accepted against what
//!   this Drift reads now ([`drift_mine::check::Standing`]); which new violations appear
//!   only because the reading changed, apart from those in code that changed
//!   ([`classify`]); what the security baseline holds against this Drift's inventory
//!   ([`drift_mine::ratchet::Ratchet::new_in_drift`]); and which agent integrations
//!   differ from what this Drift would install.
//! - **`--apply`** baselines the violations that appear only because the reading changed
//!   (a member line and its fingerprint line in `drift.lock`, as [`Lock::baselining`]
//!   writes them) and refreshes `.claude/settings.json` entries an older Drift wrote
//!   and nobody edited ([`OLDER_SETTINGS`]). It never accepts, rejects, promotes or
//!   demotes anything, never changes a mode, never deletes a line, and never touches
//!   the security baseline unless `--security-baseline` is given; then it adds only the
//!   findings that are new in this Drift. A file that needs no change is not written,
//!   so its bytes and its modification time stay as they were.
//! - **Refusals.** A file written by a newer Drift ([`NewerPolicy`], or a security
//!   baseline stamped with a newer inventory) or one that does not parse (named with its
//!   line) stops the command before anything is read or written: exit 2.
//! - **Exit codes.** 0: nothing needs doing. [`EXIT_PENDING`] (3): something does (by
//!   `--apply` or by a person; the report says which, with the command). 2: refused.
//!   1: a write of `--apply` failed; the report says what was written before it.
//!
//! Why a violation counts as "the reading changed": the commit that first wrote its
//! convention into `.drift/conventions.yaml` also wrote `drift.lock` (every command
//! that adds a convention baselines what it breaks then: `drift init`, `drift
//! practices promote`, a card promoted in `drift review`). Checked with this Drift's
//! readings at that commit ([`crate::pr::DiffScope::check_base`], the merge-base check
//! of pull-request mode), the violation was already there, in a declaration no line of
//! which changed since ([`crate::pr::DiffScope::introduces`]), and the lock written then
//! did not hold it. So the older Drift that wrote the lock did not read it as a
//! violation, and no change made it one. Wherever one of these cannot be shown (no git,
//! a shallow clone, the policy never committed, the convention's rule or role changed
//! since, a file Drift could not parse at that commit), the violation is listed as one
//! Drift cannot tell about, for a person, and never baselined. So is one of a convention
//! that was an undecided proposal at that commit (accepting it later was a person's
//! decision, and what it breaks comes with that decision), and every one where the
//! policy at that commit names this same Drift, or no Drift, as its `engine:` (the same
//! Drift reads the code the same way: nothing it finds is a new reading).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::{Command, ExitCode, Stdio};

use drift_mine::check::{CheckReport, Scope, Violation};
use drift_mine::policy::{
    self, CONFIG_FILE, CONVENTIONS_FILE, ConventionsFile, DriftConfig, LOCK_FILE, Lock,
    NewerPolicy, POLICY_VERSION, Status,
};
use drift_mine::ratchet::{self, INVENTORY_VERSION, SECURITY_LOCK};
use drift_mine::report::sanitize;
use serde::Serialize;
use serde_json::{Value, json};

/// The `schema` of `drift upgrade --json`.
pub const SCHEMA: &str = "drift-upgrade";
/// Its version.
pub const VERSION: u32 = 1;
/// The exit code when something needs doing (by `--apply`, or by a person).
pub const EXIT_PENDING: u8 = 3;

/// `drift upgrade`'s help text.
pub const HELP: &str = "Examples:
  drift upgrade                         what this Drift reads differently in the files an older one
                                        wrote; changes nothing (exit 0: nothing to do, 3: something is)
  drift upgrade --json                  the same as data (schema drift-upgrade, version 1)
  drift upgrade --apply                 baseline the violations that appear only because the reading
                                        changed, refresh agent settings an older Drift wrote; never
                                        accepts, rejects, promotes or changes a mode
  drift upgrade --apply --security-baseline
                                        also add to .drift/security.lock the findings that are new in
                                        this Drift (and only those)

A file written by a newer Drift, or one that does not parse, stops the command with exit 2
and nothing changed. Exit 1: a write of --apply failed; the report lists what was written
before it (nothing after it was).";

/// The arguments of `drift upgrade`.
#[derive(clap::Args, Debug, Clone)]
pub struct UpgradeArgs {
    /// Do what cannot change a decision a person made: baseline the violations that
    /// appear only because this Drift reads the code differently, and refresh agent
    /// settings an older Drift wrote that nobody edited.
    #[arg(long)]
    pub apply: bool,
    /// With --apply: also add to .drift/security.lock the findings of kinds and
    /// detectors this Drift has and the Drift that wrote it did not (nothing else).
    #[arg(long, requires = "apply")]
    pub security_baseline: bool,
    /// Print the report as JSON (schema drift-upgrade).
    #[arg(long)]
    pub json: bool,
}

// ---------- the report ----------

/// One file Drift wrote, and what it records of the Drift that wrote it.
#[derive(Debug, Clone, Serialize)]
struct FileRow {
    path: String,
    present: bool,
    /// What the file records of its writer and its format, in general (the same text
    /// for every repository).
    records: &'static str,
    /// The writer, as the file says it; `None` where it records none.
    #[serde(skip_serializing_if = "Option::is_none")]
    written_by: Option<String>,
    /// Its format (or inventory) version, as the file says it.
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<String>,
    /// What this Drift reads and writes of it.
    #[serde(skip_serializing_if = "Option::is_none")]
    this_drift: Option<String>,
    notes: Vec<String>,
}

/// An accepted convention, then and now.
#[derive(Debug, Clone, Serialize)]
struct ConventionRow {
    id: String,
    summary: String,
    /// `mined`, `practice` (promoted from the practice map) or `wiring`.
    rule: &'static str,
    /// What the person saw when they accepted it; `None` where the file did not keep it
    /// (accepted before Drift kept it).
    accepted: Option<policy::AcceptedEvidence>,
    /// What this Drift reads of it now.
    now: Now,
    /// `stale`, `newly_violated_by_unchanged_code`, `no_longer_checkable`, or
    /// `unchanged`.
    classes: Vec<&'static str>,
    reading_only: usize,
    changed_code: usize,
    cannot_tell: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
struct Now {
    /// Units in its role (a mined rule).
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<usize>,
    /// Members the rule is about, those that follow it, and those Drift cannot tell.
    #[serde(skip_serializing_if = "Option::is_none")]
    members: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    holders: Option<usize>,
    not_checked: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    stale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    /// Why it is not checked at all (a wiring rule with the feature off).
    #[serde(skip_serializing_if = "Option::is_none")]
    unchecked: Option<String>,
}

/// One new violation, as `drift.lock` keys it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
struct Row {
    id: String,
    member: String,
    line: u32,
    /// The commit it was compared with (reading-only), or why Drift cannot tell.
    #[serde(skip_serializing_if = "Option::is_none")]
    base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    why: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
struct Violations {
    /// Appear only because this Drift reads the code differently.
    reading_only: Vec<Row>,
    /// In code that changed since the convention was baselined: `drift check`'s business.
    changed_code: Vec<Row>,
    /// Drift cannot tell which, and says why: for a person.
    cannot_tell: Vec<Row>,
}

#[derive(Debug, Clone, Default, Serialize)]
struct Security {
    present: bool,
    /// The inventory version the baseline says wrote it (1 for a baseline with no stamp).
    #[serde(skip_serializing_if = "Option::is_none")]
    inventory: Option<u32>,
    /// Whether it has the stamp at all.
    stamped: bool,
    this_inventory: u32,
    /// Findings of kinds and detectors newer than the baseline, by kind.
    new_in_drift: BTreeMap<String, usize>,
    new_in_drift_total: usize,
    /// Findings not in the baseline, of kinds and detectors it knows, that fail `drift
    /// check`: a change's, or this Drift reading an old kind in more places. Drift
    /// cannot tell which; never written by an upgrade.
    failing_not_in_baseline: usize,
}

#[derive(Debug, Clone, Serialize)]
struct Integration {
    path: String,
    /// `agents-md` or `claude-settings`.
    kind: &'static str,
    /// `current`, `older` (an older Drift wrote it and nobody changed it), `edited` (it
    /// differs from everything a Drift wrote), or `differs` (Drift cannot tell).
    state: &'static str,
    note: String,
}

/// Something to do, and who does it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct Todo {
    what: String,
    command: String,
    /// `apply` (`drift upgrade --apply` does it), `security_baseline` (with
    /// `--security-baseline`), or `person`.
    by: &'static str,
}

#[derive(Debug, Clone, Serialize)]
struct Report {
    schema: &'static str,
    version: u32,
    drift: &'static str,
    apply: bool,
    files: Vec<FileRow>,
    conventions: Vec<ConventionRow>,
    violations: Violations,
    security: Security,
    integrations: Vec<Integration>,
    /// What `--apply` did (empty in a dry run).
    done: Vec<String>,
    /// The write that failed, if one did: nothing after it was written (exit 1).
    #[serde(skip_serializing_if = "Option::is_none")]
    failed: Option<String>,
    /// What is left: in a dry run, everything to do.
    left: Vec<Todo>,
    /// Whether anything is left (the exit code is [`EXIT_PENDING`] then).
    pending: bool,
}

// ---------- the command ----------

pub(crate) fn run(cli: &crate::Cli, args: &UpgradeArgs) -> anyhow::Result<ExitCode> {
    let root = cli.root.as_path();

    // Everything is read, and every refusal found, before anything is written.
    let mut newer: Vec<String> = Vec::new();
    let mut unreadable: Vec<String> = Vec::new();
    let loaded = match ConventionsFile::load(root) {
        Ok(p) => p,
        Err(e) => {
            match e.downcast_ref::<NewerPolicy>() {
                Some(n) => newer.push(n.to_string()),
                // A parse error can quote the file: repository text.
                None => unreadable.push(sanitize(&format!("{e:#}"), 400)),
            }
            None
        }
    };
    // A file that cannot be read at all (not a regular file, not UTF-8) is a refusal
    // too, named, not an error after something was read.
    let mut read_or_note = |rel: &str| match read_text(root, rel) {
        Ok(t) => t,
        Err(e) => {
            unreadable.push(sanitize(&format!("{e:#}"), 400));
            None
        }
    };
    let lock_text = read_or_note(LOCK_FILE);
    let security_text = read_or_note(SECURITY_LOCK);
    if let Some(text) = &lock_text {
        unreadable.extend(lock_problems(text));
    }
    if let Some(text) = &security_text {
        let (n, u) = security_problems(text);
        newer.extend(n);
        unreadable.extend(u);
    }
    let config = match DriftConfig::load(root) {
        Ok(c) => Some(c),
        Err(e) => {
            unreadable.push(sanitize(&format!("{e:#}"), 400));
            None
        }
    };
    if !newer.is_empty() || !unreadable.is_empty() {
        return refuse(args.json, &newer, &unreadable);
    }
    let lock = Lock::load(root)?;
    let baseline = security_text.as_deref().map(ratchet::parse_baseline);

    let mut files: Vec<FileRow> = Vec::new();
    let mut todo: Vec<Todo> = Vec::new();
    files.push(conventions_row(root, loaded.as_ref(), &mut todo)?);
    files.push(lock_row(&lock, lock_text.is_some()));
    files.push(security_row(baseline.as_ref()));
    files.push(config_row(root, config.as_ref()));
    files.push(review_log_row(root));
    files.push(marks_row(root));
    files.push(cache_row(root, cli.no_cache));

    // What this Drift reads of the code, when there is a policy or a baseline to read
    // it against.
    let mut conventions: Vec<ConventionRow> = Vec::new();
    let mut violations = Violations::default();
    let mut security = Security {
        present: baseline.is_some(),
        inventory: baseline.as_ref().map(|b| b.version),
        stamped: security_text
            .as_deref()
            .is_some_and(|t| without_bom(t).lines().any(|l| l.starts_with(VERSION_LINE))),
        this_inventory: INVENTORY_VERSION,
        ..Security::default()
    };
    let mut reading: Vec<Violation> = Vec::new();
    let mut new_findings: Vec<(String, String, String)> = Vec::new();
    let mut facts_held: Option<drift_core::RepoFacts> = None;
    let mut checked_policy: Option<ConventionsFile> = None;
    if loaded.is_some() || baseline.is_some() {
        let mut facts = crate::load_facts(cli, 0)?;
        if let Some(p) = &loaded {
            let mut checked = p.clone();
            crate::wiring::gate(root, &mut checked, false)?;
            crate::history::attach_key_files(root, &checked, &mut facts);
            let report = crate::practices::check_with_practices(
                root,
                &facts,
                &checked,
                &lock,
                Scope::Accepted,
                None,
                None,
            );
            let new: Vec<Violation> = report.new_violations().cloned().collect();
            let sorted = classify(root, &checked, &lock, &new);
            for (v, base) in &sorted.reading {
                violations
                    .reading_only
                    .push(row(v, Some(short(base).to_string()), None));
                reading.push(v.clone());
            }
            for v in &sorted.changed {
                violations.changed_code.push(row(v, None, None));
            }
            for (v, why) in &sorted.unknown {
                violations.cannot_tell.push(row(v, None, Some(why.clone())));
            }
            violations.reading_only.sort();
            violations.changed_code.sort();
            violations.cannot_tell.sort();
            conventions = convention_rows(p, &checked, &report, &violations);
            checked_policy = Some(checked);
        }
        if let Some(b) = &baseline {
            let inv = crate::security_inventory(cli, root, &facts);
            let found = crate::baseline_findings(root, &facts, &inv)?;
            let r = ratchet::compare_with(&found, b, None);
            security.failing_not_in_baseline = r.added.values().map(Vec::len).sum();
            for (kind, rows) in &r.new_in_drift {
                security.new_in_drift.insert(kind.clone(), rows.len());
                security.new_in_drift_total += rows.len();
                for a in rows {
                    new_findings.push((kind.clone(), a.key.clone(), a.at.clone()));
                }
            }
        }
        facts_held = Some(facts);
    }

    // What is left for whom.
    if !violations.reading_only.is_empty() {
        todo.push(Todo {
            what: format!(
                "baseline {} violation(s) that appear only because this Drift reads the code differently",
                violations.reading_only.len()
            ),
            command: "drift upgrade --apply".into(),
            by: "apply",
        });
    }
    if !violations.cannot_tell.is_empty() {
        todo.push(Todo {
            what: format!(
                "read {} new violation(s) Drift cannot tell were caused by a change or by the new reading; for one that is old code, a person adds its line `<id> <path#symbol>` to {LOCK_FILE}",
                violations.cannot_tell.len()
            ),
            command: "drift check".into(),
            by: "person",
        });
    }
    for c in &conventions {
        if c.classes.contains(&"stale") || c.classes.contains(&"no_longer_checkable") {
            // The id is the policy file's text: shown sanitised, quoted as a shell word.
            let id = sanitize(&c.id, 80);
            todo.push(Todo {
                what: format!(
                    "look at {id}: {}",
                    if c.classes.contains(&"stale") {
                        "it is stale now (it advises until a person decides)"
                    } else {
                        "Drift cannot tell any of its members now (nothing of it is checked)"
                    }
                ),
                command: format!("drift review --show {}", crate::promote::shell_word(&id)),
                by: "person",
            });
        }
    }
    if security.new_in_drift_total > 0 {
        todo.push(Todo {
            what: format!(
                "{} security finding(s) are of kinds or detectors newer than {SECURITY_LOCK}; they fail nothing until it records them",
                security.new_in_drift_total
            ),
            command: "drift upgrade --apply --security-baseline".into(),
            by: "security_baseline",
        });
    } else if let Some(v) = security.inventory.filter(|v| *v < INVENTORY_VERSION) {
        // Nothing newer is found today, but the stamp is older: a finding of a kind or
        // detector newer than it, added later, would fail nothing. Stamping it again
        // adds no finding and keeps the kinds that fail.
        let stamp = if security.stamped {
            format!("is stamped inventory {v}")
        } else {
            format!("has no inventory stamp (read as inventory {v})")
        };
        todo.push(Todo {
            what: format!(
                "{SECURITY_LOCK} {stamp} (this Drift: {INVENTORY_VERSION}); a finding of a kind or detector newer than it fails nothing until it is stamped again"
            ),
            command: "drift upgrade --apply --security-baseline".into(),
            by: "security_baseline",
        });
    }
    if security.failing_not_in_baseline > 0 {
        todo.push(Todo {
            what: format!(
                "{} security finding(s) not in {SECURITY_LOCK}, of kinds it knows, fail `drift check`: a change's, or this Drift reading an old kind in more places, which Drift cannot tell apart; a person reads them and writes the baseline again only for what they accept",
                security.failing_not_in_baseline
            ),
            command: "drift security --ratchet".into(),
            by: "person",
        });
    }
    let (found_integrations, refresh) = integrations(root, loaded.is_some(), &mut todo);

    // `--apply`, in order: formats (no file needs one today: see the notes), the
    // violations the reading added, the integrations Drift installed itself, and the
    // security baseline only when asked.
    let mut done: Vec<String> = Vec::new();
    // The first write that failed: nothing after it is written, and the report says
    // what was (`done`) and what was not.
    let mut failed: Option<String> = None;
    if args.apply {
        if let (Some(checked), Some(facts)) = (&checked_policy, &facts_held)
            && !reading.is_empty()
        {
            let all = drift_mine::roles::all_units(facts, &checked.file_kinds);
            let by_key: BTreeMap<String, &drift_mine::roles::Unit<'_>> =
                all.iter().map(|u| (u.key(), u)).collect();
            // The fingerprint `drift init` writes for the same violation
            // ([`drift_mine::check::baseline`]).
            let add = Lock::baselining(&reading, |v| {
                let u = by_key.get(&format!("{}#{}", v.path, v.symbol))?;
                v.wire
                    .is_none()
                    .then(|| u.fingerprint(v.import.as_ref().map(|i| i.module.as_str())))
            });
            if let Some((text, n)) = lock_with(lock_text.as_deref(), &lock, &add) {
                match policy::write_no_follow(root, Path::new(LOCK_FILE), text.as_bytes()) {
                    Ok(()) => done.push(format!(
                        "baselined {n} violation(s) in {LOCK_FILE} that appear only because this Drift reads the code differently (each with its fingerprint line, added at the end; no line removed)"
                    )),
                    Err(e) => failed = Some(format!("writing {LOCK_FILE}: {e:#}")),
                }
            }
        }
        for (path, bytes) in &refresh {
            if failed.is_some() {
                break;
            }
            match crate::write_out(root, &root.join(path), bytes) {
                Ok(()) => done.push(format!(
                    "refreshed {path}: added the entries this Drift writes that the older Drift did not (nothing removed)"
                )),
                Err(e) => failed = Some(format!("writing {path}: {e:#}")),
            }
        }
        if args.security_baseline
            && failed.is_none()
            && let (Some(b), Some(text)) = (&baseline, &security_text)
        {
            let mut keys: ratchet::Findings = b
                .findings
                .iter()
                .map(|k| (k.clone(), String::new()))
                .collect();
            for (kind, key, at) in &new_findings {
                keys.insert((kind.clone(), key.clone()), at.clone());
            }
            let next = ratchet::render_lock_with(&keys, &b.fail_kinds());
            // Only ever adds: every finding it held is in `next`, and the kinds that
            // fail are the ones it said (or, unsaid, the ones it failed).
            let kept = ratchet::parse_baseline(&next);
            let safe = b.findings.is_subset(&kept.findings) && kept.fail_kinds() == b.fail_kinds();
            if !safe {
                failed = Some(format!(
                    "{SECURITY_LOCK} was not written: the baseline written again would not hold every finding and fail kind it holds"
                ));
            } else if next != *text {
                match policy::write_no_follow(root, Path::new(SECURITY_LOCK), next.as_bytes()) {
                    Ok(()) => done.push(format!(
                        "added to {SECURITY_LOCK} the {} finding(s) new in this Drift, stamped inventory {INVENTORY_VERSION}; every finding it held is kept, and the kinds that fail are as they were",
                        new_findings.len()
                    )),
                    Err(e) => failed = Some(format!("writing {SECURITY_LOCK}: {e:#}")),
                }
            }
        }
        // After a failed write, everything stays listed: `done` says what was written.
        if failed.is_none() {
            todo.retain(|t| match t.by {
                "apply" => false,
                "security_baseline" => !args.security_baseline,
                _ => true,
            });
        }
    }
    let pending = !todo.is_empty();
    let report = Report {
        schema: SCHEMA,
        version: VERSION,
        drift: env!("CARGO_PKG_VERSION"),
        apply: args.apply,
        files,
        conventions,
        violations,
        security,
        integrations: found_integrations,
        done,
        failed,
        left: todo,
        pending,
    };
    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        print!("{}", render(&report));
    }
    Ok(if report.failed.is_some() {
        ExitCode::from(1)
    } else if pending {
        ExitCode::from(EXIT_PENDING)
    } else {
        ExitCode::SUCCESS
    })
}

/// The refusal: what is newer or unreadable, and that nothing changed. Exit 2.
fn refuse(json: bool, newer: &[String], unreadable: &[String]) -> anyhow::Result<ExitCode> {
    if json {
        let v = json!({
            "schema": SCHEMA,
            "version": VERSION,
            "drift": env!("CARGO_PKG_VERSION"),
            "refused": true,
            "newer": newer,
            "unreadable": unreadable,
        });
        println!("{}", serde_json::to_string_pretty(&v)?);
    } else {
        println!("drift upgrade: nothing was read further and nothing was changed.");
        for n in newer {
            println!("  {n}");
        }
        for u in unreadable {
            println!("  {u}");
        }
        if !unreadable.is_empty() {
            println!(
                "  Restore the file from git (`git checkout -- <file>`) or finish the edit, then run `drift upgrade` again."
            );
        }
    }
    Ok(ExitCode::from(2))
}

/// The text of `rel` under `root`, `None` when there is none.
fn read_text(root: &Path, rel: &str) -> anyhow::Result<Option<String>> {
    match drift_core::fsutil::read_regular_to_string(
        &root.join(rel),
        drift_core::fsutil::MAX_CONFIG_BYTES,
    ) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(anyhow::Error::new(e).context(format!("reading {rel}"))),
    }
}

/// Lines of `drift.lock` that are neither a comment nor a line Drift writes: a
/// half-written file. [`Lock::load`] skips them; an upgrade that baselines into the
/// file must not.
fn lock_problems(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (n, raw) in text.lines().enumerate() {
        let line = raw.trim();
        // A fingerprint line written as a comment, `#~ <id> <fingerprint> <path#symbol>`.
        if let Some(rest) = line.strip_prefix("#~") {
            let mut parts = rest.trim().splitn(3, ' ');
            let ok = match (parts.next(), parts.next(), parts.next()) {
                (Some(id), Some(fp), Some(member)) => {
                    !id.is_empty()
                        && Lock::split_fingerprint(&Lock::fingerprint_key(fp, member.trim()))
                            .is_some()
                }
                _ => false,
            };
            if !ok {
                out.push(format!(
                    "{LOCK_FILE} line {}: `{}` is not a fingerprint line Drift writes (`#~ <id> <fingerprint> <path#symbol>`)",
                    n + 1,
                    sanitize(line, 120)
                ));
            }
            continue;
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let ok = match line.split_once(' ') {
            Some((id, key)) => {
                let key = key.trim();
                !id.is_empty()
                    && !key.is_empty()
                    && (!key.starts_with('~') || Lock::split_fingerprint(key).is_some())
            }
            None => false,
        };
        if !ok {
            out.push(format!(
                "{LOCK_FILE} line {}: `{}` is not a line Drift writes (`<convention id> <path#symbol>`)",
                n + 1,
                sanitize(line, 120)
            ));
        }
    }
    out
}

/// `drift.lock` as it is (`existing`, `None` when there is none) with the member lines
/// of `add` that `lock` does not hold appended at the end, each followed by its
/// fingerprint lines (`#~ <id> <fingerprint> <path#symbol>`, as [`Lock::save`] writes
/// them), and how many member lines that is; `None` when there are none. Appended, not
/// written again through [`Lock::save`]: that would drop a person's comments and any
/// fingerprint line whose member line is gone, and an upgrade deletes no line. The
/// order does not matter to [`Lock::load`].
fn lock_with(existing: Option<&str>, lock: &Lock, add: &Lock) -> Option<(String, usize)> {
    let mut out = existing.map_or_else(
        || {
            "# drift.lock: legacy violations that never block. Fix code to remove lines.\n"
                .to_string()
        },
        str::to_string,
    );
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    let mut n = 0;
    for (id, key) in &add.entries {
        if Lock::split_fingerprint(key).is_some() || lock.contains(id, key) {
            continue;
        }
        out.push_str(&format!("{id} {key}\n"));
        n += 1;
        for (fid, fkey) in &add.entries {
            if fid != id || lock.contains(fid, fkey) {
                continue;
            }
            if let Some((fp, member)) = Lock::split_fingerprint(fkey)
                && member == key.as_str()
            {
                out.push_str(&format!("#~ {id} {fp} {key}\n"));
            }
        }
    }
    (n > 0).then_some((out, n))
}

/// The header line that stamps a security baseline ([`ratchet`]'s own).
const VERSION_LINE: &str = "# inventory: ";

/// `text` without a leading byte-order mark, which a Windows editor may save:
/// [`ratchet::parse_baseline`] reads past it, so `drift check` reads such a baseline,
/// and an upgrade must not refuse it as broken.
fn without_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

/// A security baseline's stamp of a newer inventory, and lines that are no finding and
/// no comment ([`ratchet::parse_lock`] skips them; [`ratchet::parse_baseline`] reads a
/// stamp it cannot parse as the oldest).
fn security_problems(text: &str) -> (Vec<String>, Vec<String>) {
    let text = without_bom(text);
    let (mut newer, mut bad) = (Vec::new(), Vec::new());
    for (n, line) in text.lines().enumerate() {
        if let Some(v) = line.strip_prefix(VERSION_LINE) {
            match v.trim().parse::<u32>() {
                Ok(v) if v > INVENTORY_VERSION => newer.push(format!(
                    "{SECURITY_LOCK} was written by a newer Drift (inventory {v}; this Drift knows up to {INVENTORY_VERSION}). Upgrade Drift to the version that wrote it (`drift --version` shows the one installed here)"
                )),
                Ok(_) => {}
                Err(_) => bad.push(format!(
                    "{SECURITY_LOCK} line {}: the inventory stamp `{}` is not a number",
                    n + 1,
                    sanitize(line, 120)
                )),
            }
            continue;
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let ok = line
            .split_once('\t')
            .is_some_and(|(k, key)| !k.is_empty() && !key.is_empty());
        if !ok {
            bad.push(format!(
                "{SECURITY_LOCK} line {}: `{}` is not a finding (`<kind><TAB><key>`)",
                n + 1,
                sanitize(line, 120)
            ));
        }
    }
    (newer, bad)
}

// ---------- the files ----------

fn conventions_row(
    root: &Path,
    file: Option<&ConventionsFile>,
    todo: &mut Vec<Todo>,
) -> anyhow::Result<FileRow> {
    let records = "`version:` (its format) and `engine:` (the Drift that last ran `drift init` here; `drift review` and `drift practices promote` keep it as it was); per convention `selector_version` (how its role is read; absent is 1) and, for an accepted one, `accepted_evidence` once a Drift that keeps it met it. It does not record which Drift made any later change.";
    let Some(p) = file else {
        return Ok(FileRow {
            path: CONVENTIONS_FILE.into(),
            present: false,
            records,
            written_by: None,
            format: None,
            this_drift: None,
            notes: Vec::new(),
        });
    };
    let writes = policy::written_version(p);
    let mut notes = Vec::new();
    let mut selectors: BTreeMap<u32, usize> = BTreeMap::new();
    for c in &p.conventions {
        *selectors.entry(c.selector_version).or_default() += 1;
    }
    if !selectors.is_empty() {
        notes.push(format!(
            "selectors: {}",
            selectors
                .iter()
                .map(|(v, n)| format!("{n} at version {v}"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    let accepted: Vec<_> = p
        .conventions
        .iter()
        .filter(|c| c.status == Status::Accepted)
        .collect();
    let kept = accepted
        .iter()
        .filter(|c| c.accepted_evidence.is_some())
        .count();
    notes.push(format!(
        "the evidence a person accepted on is recorded for {kept} of {} accepted convention(s); Drift does not fill it in afterwards, since it would record what it reads today as what a person saw",
        accepted.len()
    ));
    // What the file holds that this Drift does not show: the show policy drops such a
    // proposal on load, so the next write of the file leaves it out.
    if let Some(text) = read_text(root, CONVENTIONS_FILE)?
        && let Ok(v) = policy::yaml_value(&text)
        && let Some(n) = v.get("conventions").and_then(Value::as_array).map(Vec::len)
        && n > p.conventions.len()
    {
        notes.push(format!(
            "{} proposal(s) in the file are not shown by this Drift (a kind it no longer proposes, or Python proposals turned off); the next `drift init` or `drift review` that writes the file leaves them out (no decision of a person is among them)",
            n - p.conventions.len()
        ));
    }
    if p.version < writes {
        notes.push(format!(
            "it holds a form a Drift that reads up to format {} would check wrong, but says format {}: this Drift writes it as format {writes} on its next write",
            writes - 1,
            p.version
        ));
        todo.push(Todo {
            what: format!(
                "raise `version: {}` to `version: {writes}` in {CONVENTIONS_FILE} once every machine and CI runs this Drift (an older Drift then refuses the file instead of checking a rule wrong; `drift upgrade --apply` leaves it, because that would stop older Drifts that pass today)",
                p.version
            ),
            command: format!("edit {CONVENTIONS_FILE}: version: {writes}"),
            by: "person",
        });
    }
    Ok(FileRow {
        path: CONVENTIONS_FILE.into(),
        present: true,
        records,
        written_by: (!p.engine.is_empty()).then(|| p.engine.clone()),
        format: Some(p.version.to_string()),
        this_drift: Some(format!(
            "reads formats up to {POLICY_VERSION}; would write this file as format {writes}"
        )),
        notes,
    })
}

fn lock_row(lock: &Lock, present: bool) -> FileRow {
    let records = "no Drift version and no format version: one line `<convention id> <path#symbol>` per baselined violation and, below each line written since fingerprints, a comment `#~ <id> <fingerprint> <path#symbol>` (the older form `<id> ~<fingerprint> <path#symbol>` is read too).";
    let mut notes = Vec::new();
    if present {
        let with_fp: BTreeSet<(&str, &str)> = lock
            .entries
            .iter()
            .filter_map(|(id, k)| Lock::split_fingerprint(k).map(|(_, m)| (id.as_str(), m)))
            .collect();
        let members = lock.members();
        let without = lock
            .entries
            .iter()
            .filter(|(id, k)| {
                Lock::split_fingerprint(k).is_none()
                    && !with_fp.contains(&(id.as_str(), k.as_str()))
            })
            .count();
        notes.push(format!(
            "{members} baselined violation(s), {} with a fingerprint line",
            members - without.min(members)
        ));
        if without > 0 {
            notes.push(format!(
                "{without} line(s) have no fingerprint line, so the debt they hold does not follow its code when it moves; `drift init` adds them (this Drift reads the lock as it is either way)"
            ));
        }
    }
    FileRow {
        path: LOCK_FILE.into(),
        present,
        records,
        written_by: None,
        format: None,
        this_drift: present.then(|| "reads it as written".to_string()),
        notes,
    }
}

fn security_row(baseline: Option<&ratchet::Baseline>) -> FileRow {
    let records = "`# inventory:` (the version of the inventory that wrote it; a baseline without the line reads as 1) and `# fail:` (the kinds that fail `drift check`); no Drift version.";
    let Some(b) = baseline else {
        return FileRow {
            path: SECURITY_LOCK.into(),
            present: false,
            records,
            written_by: None,
            format: None,
            this_drift: None,
            notes: Vec::new(),
        };
    };
    let mut notes = vec![format!("{} finding(s)", b.findings.len())];
    if b.fail.is_none() {
        notes.push(
            "no `# fail:` line: every kind of the first inventory fails, as when it was written"
                .to_string(),
        );
    }
    FileRow {
        path: SECURITY_LOCK.into(),
        present: true,
        records,
        written_by: None,
        format: Some(format!("inventory {}", b.version)),
        this_drift: Some(format!("inventory {INVENTORY_VERSION}")),
        notes,
    }
}

fn config_row(root: &Path, config: Option<&DriftConfig>) -> FileRow {
    let present = root.join(CONFIG_FILE).is_file();
    FileRow {
        path: CONFIG_FILE.into(),
        present,
        records: "no Drift version and no format version; an answer `drift setup` recorded carries the day it was given.",
        written_by: None,
        format: None,
        this_drift: present.then(|| {
            "reads it as written; a key it does not know is a warning, never an error".to_string()
        }),
        // A warning names the repository's own keys.
        notes: config
            .map(|c| c.warnings.iter().map(|w| sanitize(w, 300)).collect())
            .unwrap_or_default(),
    }
}

fn review_log_row(root: &Path) -> FileRow {
    let path = format!("{}/log.jsonl", crate::review_log::DIR);
    let text = std::fs::read_to_string(root.join(&path)).ok();
    let last = text.as_deref().and_then(|t| {
        t.lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .and_then(|l| serde_json::from_str::<Value>(l).ok())
    });
    let mut notes = Vec::new();
    if text.is_some() && last.is_none() {
        notes.push("its last event could not be read; Drift does not change the log".into());
    }
    FileRow {
        path,
        present: text.is_some(),
        records: "each event records the Drift that wrote it (`drift.version`) and the event's shape (`v`). Local, append-only; an upgrade never changes it.",
        written_by: last
            .as_ref()
            .and_then(|v| v["drift"]["version"].as_str())
            .map(|v| format!("drift {} (its last event)", sanitize(v, 80))),
        format: last
            .as_ref()
            .and_then(|v| v["v"].as_u64())
            .map(|v| format!("event {v}")),
        this_drift: None,
        notes,
    }
}

fn marks_row(root: &Path) -> FileRow {
    let path = format!("{}/{}", crate::feedback::DIR, crate::feedback::MARKS);
    let text = std::fs::read_to_string(root.join(&path)).ok();
    let v = text
        .as_deref()
        .and_then(|t| serde_json::from_str::<Value>(t).ok());
    let mut notes = Vec::new();
    if text.is_some() && v.is_none() {
        notes.push("it is not JSON Drift can read; Drift does not change it".into());
    }
    FileRow {
        path,
        present: text.is_some(),
        records: "`schema` and `version` of its shape; no Drift version. Local; an upgrade never changes it.",
        written_by: None,
        format: v
            .as_ref()
            .and_then(|v| v["version"].as_u64())
            .map(|v| v.to_string()),
        this_drift: text
            .is_some()
            .then(|| format!("version {}", crate::feedback::MARKS_VERSION)),
        notes,
    }
}

/// The fact cache's generations: a directory per facts schema, a directory per parser
/// tag in it (the tag holds the lowering version and the Drift version). Only this
/// Drift's are read; nothing is deleted.
fn cache_row(root: &Path, no_cache: bool) -> FileRow {
    let ours = format!("facts-v{}", drift_core::FACTS_SCHEMA_VERSION);
    let tags = [drift_ts::parser_tag(), drift_py::parser_tag()];
    let dir = crate::project::cache_dir(root, no_cache);
    let mut older: Vec<String> = Vec::new();
    // Whether the cache is in use, not whether its directory exists: this very run
    // (or the first `drift check` after it) creates this Drift's generation, and the
    // report must read the same before and after.
    let present = dir.is_some();
    if let Some(dir) = &dir
        && let Ok(rd) = std::fs::read_dir(dir)
    {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.starts_with("facts-v") {
                continue;
            }
            let Ok(sub) = std::fs::read_dir(e.path()) else {
                continue;
            };
            for t in sub.flatten() {
                let tag = t.file_name().to_string_lossy().into_owned();
                if name != ours || !tags.contains(&tag) {
                    older.push(format!("{name}/{tag}"));
                }
            }
        }
    }
    older.sort();
    let mut notes = Vec::new();
    if !older.is_empty() {
        notes.push(format!(
            "{} older generation(s) this Drift does not read ({}); the cache is local and safe to delete to reclaim the space. Nothing was deleted.",
            older.len(),
            sanitize(&older.join(", "), 400)
        ));
    }
    FileRow {
        path: ".drift/cache".into(),
        present,
        records: "the facts schema in its directory name (`facts-v11`) and each parser's tag below it (`ts-l84-0.1.0-dev`: the lowering version and the Drift version). A new Drift reads none of an older one's entries and parses again.",
        written_by: None,
        format: None,
        this_drift: present.then(|| format!("{ours}/{}, {ours}/{}", tags[0], tags[1])),
        notes,
    }
}

// ---------- the conventions ----------

/// A new violation, as the report lists it.
fn row(v: &Violation, base: Option<String>, why: Option<String>) -> Row {
    Row {
        id: v.id.clone(),
        member: format!("{}#{}", v.path, v.symbol),
        line: v.line,
        base,
        why,
    }
}

fn convention_rows(
    policy: &ConventionsFile,
    checked: &ConventionsFile,
    report: &CheckReport,
    violations: &Violations,
) -> Vec<ConventionRow> {
    let count = |rows: &[Row], id: &str| rows.iter().filter(|r| r.id == id).count();
    let mut out = Vec::new();
    let mut accepted: Vec<_> = policy
        .conventions
        .iter()
        .filter(|c| c.status == Status::Accepted)
        .collect();
    accepted.sort_by(|a, b| a.id.cmp(&b.id));
    for c in accepted {
        let standing = report.standing.iter().find(|s| s.id == c.id);
        let stale_practice = report.stale_practices.iter().find(|s| s.id == c.id);
        let not_checked_practice = report
            .practices_not_checked
            .iter()
            .find(|s| s.id == c.id)
            .map_or(0, |n| n.units);
        let mut now = Now::default();
        if let Some(s) = standing {
            now.role = Some(s.role);
            now.members = Some(s.members);
            now.holders = Some(s.holders);
            now.not_checked = s.not_checked;
            now.stale = s.stale.clone();
            now.mode = Some(s.mode.clone());
        } else if c.rule.is_practice() {
            now.not_checked = not_checked_practice;
            now.stale = stale_practice.map(|s| {
                format!(
                    "none of the {} unit(s) of its place uses one of its ways any more",
                    s.units
                )
            });
            now.mode = Some(drift_mine::check::effective_mode(c).to_string());
        } else if !checked.conventions.iter().any(|x| x.id == c.id) {
            now.unchecked = Some(
                "not checked: it is a wiring rule and the experimental wiring feature is off"
                    .into(),
            );
        } else {
            now.mode = Some(drift_mine::check::effective_mode(c).to_string());
        }
        let reading_only = count(&violations.reading_only, &c.id);
        let mut classes = Vec::new();
        if now.stale.is_some() {
            classes.push("stale");
        }
        if reading_only > 0 {
            classes.push("newly_violated_by_unchanged_code");
        }
        if standing.is_some_and(|s| s.not_checked > 0 && s.members == s.not_checked) {
            classes.push("no_longer_checkable");
        }
        if classes.is_empty() {
            classes.push("unchanged");
        }
        out.push(ConventionRow {
            id: c.id.clone(),
            summary: c.summary.clone(),
            rule: if c.rule.is_practice() {
                "practice"
            } else if c.rule.is_wiring() {
                "wiring"
            } else {
                "mined"
            },
            accepted: c.accepted_evidence.clone(),
            now,
            classes,
            reading_only,
            changed_code: count(&violations.changed_code, &c.id),
            cannot_tell: count(&violations.cannot_tell, &c.id),
        });
    }
    out
}

// ---------- which violations the reading added ----------

#[derive(Debug, Default)]
struct Classified {
    /// With the commit they were compared with.
    reading: Vec<(Violation, String)>,
    changed: Vec<Violation>,
    /// With why Drift cannot tell.
    unknown: Vec<(Violation, String)>,
}

/// Sorts the new violations of an accepted convention into those that appear only
/// because this Drift reads the code differently, those in code that changed, and those
/// Drift cannot tell about (module doc). Conservative: only the first is ever baselined,
/// and anything unproven goes to the last.
fn classify(root: &Path, policy: &ConventionsFile, lock: &Lock, new: &[Violation]) -> Classified {
    let mut out = Classified::default();
    if new.is_empty() {
        return out;
    }
    if let Some(why) = no_history(root) {
        out.unknown = new.iter().map(|v| (v.clone(), why.clone())).collect();
        return out;
    }
    let mut base_of: BTreeMap<String, Result<String, String>> = BTreeMap::new();
    for v in new {
        base_of
            .entry(v.id.clone())
            .or_insert_with(|| convention_base(root, policy, &v.id));
    }
    // The lock as committed at HEAD: a line taken out of the working copy since is a
    // person's doing, not the reading's.
    let head_lock: BTreeSet<(String, String)> =
        git_text(root, &["show", &format!("HEAD:./{LOCK_FILE}")])
            .map(|t| lock_entries(&t))
            .unwrap_or_default();
    let mut by_base: BTreeMap<String, Vec<&Violation>> = BTreeMap::new();
    for v in new {
        match &base_of[&v.id] {
            Ok(b) => by_base.entry(b.clone()).or_default().push(v),
            Err(why) => out.unknown.push((v.clone(), why.clone())),
        }
    }
    for (base, vs) in by_base {
        let at = short(&base).to_string();
        // The lock written with the convention ([`convention_base`] checked that the
        // commit wrote it). Unreadable there: nothing is known of what it held.
        let Some(old_lock) =
            git_text(root, &["show", &format!("{base}:./{LOCK_FILE}")]).map(|t| lock_entries(&t))
        else {
            let why = format!("{LOCK_FILE} at commit {at} could not be read");
            out.unknown
                .extend(vs.into_iter().map(|v| (v.clone(), why.clone())));
            continue;
        };
        let scope = crate::pr::DiffScope::from_git(root, &base).and_then(|mut s| {
            s.check_base(root, policy, lock)?;
            Ok(s)
        });
        let scope = match scope {
            Ok(s) => s,
            Err(e) => {
                let why = format!("commit {at} could not be checked: {e:#}");
                out.unknown
                    .extend(vs.into_iter().map(|v| (v.clone(), why.clone())));
                continue;
            }
        };
        if !scope.base_unchecked().is_empty() {
            let why = format!(
                "{} file(s) could not be parsed at commit {at}, so what was there is not known",
                scope.base_unchecked().len()
            );
            out.unknown
                .extend(vs.into_iter().map(|v| (v.clone(), why.clone())));
            continue;
        }
        let mut texts: BTreeMap<String, Option<String>> = BTreeMap::new();
        for v in vs {
            let member = format!("{}#{}", v.path, v.symbol);
            let key = (v.id.clone(), member.clone());
            if old_lock.contains(&key) {
                out.unknown.push((
                    v.clone(),
                    format!("{LOCK_FILE} held it at commit {at} and its line was taken out since"),
                ));
                continue;
            }
            // A line for it written into the lock after that commit and taken out again
            // (committed, or only in the working copy): a person's doing, perhaps on
            // purpose. Unknown when git cannot say.
            let since = git_text(
                root,
                &[
                    "log",
                    "--format=%H",
                    &format!("-S{} {member}", v.id),
                    &format!("{base}..HEAD"),
                    "--",
                    LOCK_FILE,
                ],
            );
            match since {
                Some(t) if t.trim().is_empty() && !head_lock.contains(&key) => {}
                Some(_) => {
                    out.unknown.push((
                        v.clone(),
                        format!(
                            "a line for it was in {LOCK_FILE} after commit {at} and was taken out"
                        ),
                    ));
                    continue;
                }
                None => {
                    out.unknown.push((
                        v.clone(),
                        format!("git could not say whether {LOCK_FILE} held it after commit {at}"),
                    ));
                    continue;
                }
            }
            // Its file was renamed since: what was there under the old name is not this
            // reading's business to decide.
            if scope.old_path(&v.path) != v.path {
                out.unknown.push((
                    v.clone(),
                    format!(
                        "its file was renamed since commit {at} (from {}), so Drift cannot tell it is the same code",
                        scope.old_path(&v.path)
                    ),
                ));
                continue;
            }
            let text = texts
                .entry(v.path.clone())
                .or_insert_with(|| std::fs::read_to_string(root.join(&v.path)).ok());
            if scope.introduces(v, text.as_deref(), lock) {
                out.changed.push(v.clone());
            } else {
                out.reading.push((v.clone(), base.clone()));
            }
        }
    }
    out.reading.sort();
    out.changed.sort();
    out.unknown.sort();
    out
}

/// Why the repository's history cannot say what was baselined when, or `None`.
fn no_history(root: &Path) -> Option<String> {
    match git_text(root, &["rev-parse", "--is-inside-work-tree"]) {
        Some(t) if t.trim() == "true" => {}
        _ => return Some("there is no git history to compare with".into()),
    }
    if git_text(root, &["rev-parse", "--is-shallow-repository"]).is_some_and(|t| t.trim() == "true")
    {
        return Some(
            "the clone is shallow, so the commit that baselined the convention may be missing (`git fetch --unshallow`)"
                .into(),
        );
    }
    None
}

/// The commit that first wrote convention `id` into the policy, when it can serve as
/// the point the convention's violations were baselined: it also wrote `drift.lock`,
/// the convention was not rejected then, and its role, rule and selector are what they
/// are now. Otherwise why not.
fn convention_base(root: &Path, current: &ConventionsFile, id: &str) -> Result<String, String> {
    let needle = format!("-Sid: {id}");
    let log = git_text(
        root,
        &[
            "log",
            "--reverse",
            "--format=%H",
            &needle,
            "--",
            CONVENTIONS_FILE,
        ],
    )
    .ok_or_else(|| "git log could not be read".to_string())?;
    let Some(base) = log
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
    else {
        return Err(format!(
            "{id} is in no commit of {CONVENTIONS_FILE} (commit the policy, then run `drift upgrade` again)"
        ));
    };
    let at = short(&base).to_string();
    let touched =
        git_text(root, &["log", "-1", "--format=%H", &base, "--", LOCK_FILE]).unwrap_or_default();
    if touched.trim() != base {
        return Err(format!(
            "commit {at} added {id} without writing {LOCK_FILE}, so what was baselined for it then is not known"
        ));
    }
    let then: Option<ConventionsFile> =
        git_text(root, &["show", &format!("{base}:./{CONVENTIONS_FILE}")])
            .and_then(|t| policy::yaml_value(&t).ok())
            .and_then(|v| serde_json::from_value(v).ok());
    let Some(then) = then else {
        return Err(format!(
            "{CONVENTIONS_FILE} at commit {at} could not be read"
        ));
    };
    // The same Drift on both sides reads the code the same way, so nothing can be a
    // reading change; and a file that names no Drift cannot show it was another one.
    // (`engine:` names the Drift that last ran `drift init`, which wrote the lock.)
    if then.engine.is_empty() {
        return Err(format!(
            "{CONVENTIONS_FILE} at commit {at} records no Drift that wrote it, so Drift cannot tell its reading changed since"
        ));
    }
    if then.engine == crate::engine() {
        return Err(format!(
            "{CONVENTIONS_FILE} at commit {at} was written by this same Drift ({}), so no violation can come from a new reading",
            crate::engine()
        ));
    }
    let (Some(was), Some(now)) = (
        then.conventions.iter().find(|c| c.id == id),
        current.conventions.iter().find(|c| c.id == id),
    ) else {
        return Err(format!("{id} could not be found at commit {at}"));
    };
    if was.status == Status::Rejected {
        return Err(format!(
            "{id} was rejected at commit {at}, so nothing was baselined for it then"
        ));
    }
    // Undecided then, accepted since: the acceptance is a person's decision made after
    // that commit, and what it breaks comes with that decision, not with a change in how
    // Drift reads the code (a proposal from the map had no lock line written at all).
    if was.status == Status::Proposed {
        return Err(format!(
            "{id} was an undecided proposal at commit {at} and was accepted since, so what it breaks comes with that decision, not with a new reading"
        ));
    }
    if was.role != now.role || was.rule != now.rule || was.selector_version != now.selector_version
    {
        return Err(format!(
            "{id}'s rule or role changed since commit {at}, so the lock written then was for another rule"
        ));
    }
    Ok(base)
}

/// The `(id, key)` lines of a `drift.lock` text, as [`Lock::load`] reads them.
fn lock_entries(text: &str) -> BTreeSet<(String, String)> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once(' '))
        .map(|(id, key)| (id.to_string(), key.trim().to_string()))
        .collect()
}

/// The standard output of `git -C root ARGS`, `None` when git is missing or fails.
/// Read-only commands only.
fn git_text(root: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(12)]
}

// ---------- agent integrations ----------

/// The `.claude/settings.json` entries each older Drift wrote (`drift export
/// claude-settings`), oldest first, as `(allow, deny)`: what an unedited file of an
/// older Drift holds. From the repository's history of `crates/drift-cli/src/lookup.rs`
/// (1d4f5265: no deny entry; 0f01322c added `Bash(drift practices promote:*)` to deny).
/// Written out, not computed, so a later change to the current lists does not rewrite
/// what an older Drift wrote. Add a row whenever [`crate::lookup::claude_settings`]
/// changes.
const OLDER_SETTINGS: &[(&[&str], &[&str])] = &[(
    &[
        "Bash(drift card:*)",
        "Bash(drift map:*)",
        "Bash(drift example:*)",
        "Bash(drift check:*)",
        "Bash(drift practices:*)",
        "mcp__drift__drift_rules_for",
        "mcp__drift__drift_example",
        "mcp__drift__drift_check",
        "mcp__drift__drift_explain",
        "mcp__drift__drift_map",
        "mcp__drift__drift_card",
        "mcp__drift__drift_security",
        "mcp__drift__drift_practices",
        "mcp__drift__drift_setup_questions",
        "mcp__drift__drift_investigate_items",
    ],
    &[],
)];

/// Files `drift export agents-md --write` is pointed at, as the docs name them.
const AGENTS_FILES: &[&str] = &["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md"];
/// Files `drift export claude-settings --write` is pointed at.
const SETTINGS_FILES: &[&str] = &[".claude/settings.json", ".claude/settings.local.json"];

/// The strings of `v[list]`.
fn strings(v: &Value, list: &str) -> BTreeSet<String> {
    v["permissions"][list]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// The integrations found, and the refreshes `--apply` writes (path, bytes). Compared
/// by content with what this Drift would write; an older Drift's content counts only
/// where the repository's history of Drift keeps it ([`OLDER_SETTINGS`]).
fn integrations(
    root: &Path,
    has_policy: bool,
    todo: &mut Vec<Todo>,
) -> (Vec<Integration>, Vec<(String, Vec<u8>)>) {
    let mut out = Vec::new();
    let mut refresh = Vec::new();
    // The AGENTS.md block: its text depends on the conventions and on each Drift's
    // wording, and no older wording is kept, so Drift cannot tell an older block from
    // one a person edited. Reported, never rewritten.
    let mut current: Option<Result<String, String>> = None;
    for name in AGENTS_FILES {
        let Ok(text) = std::fs::read_to_string(root.join(name)) else {
            continue;
        };
        let Some(s) = text.find(crate::export::START) else {
            continue;
        };
        let block = match text[s..].find(crate::export::END) {
            Some(e) => &text[s..s + e + crate::export::END.len()],
            None => &text[s..],
        };
        let now = current.get_or_insert_with(|| {
            if !has_policy {
                return Err(format!("there is no {CONVENTIONS_FILE}"));
            }
            crate::project::Project::open_for_agents(root)
                .map(|p| crate::export::block(&p))
                .map_err(|e| format!("{e:#}"))
        });
        let (state, note) = match now {
            // Newline-blind: a CRLF file's block is written with CRLF ([`crate::export::splice`]).
            Ok(b) if crate::export::same_block(block, b.as_str()) => ("current", "the block is what this Drift writes".to_string()),
            Ok(_) => (
                "differs",
                "the block differs from what this Drift writes; Drift cannot tell an older Drift's block from one a person edited (the older wording is not kept), so it leaves it".to_string(),
            ),
            Err(e) => (
                "differs",
                format!(
                    "what this Drift would write could not be built: {}",
                    sanitize(e, 300)
                ),
            ),
        };
        if state == "differs" {
            todo.push(Todo {
                what: format!("compare the Drift block in {name} with what this Drift writes, and refresh it if nobody edited it"),
                command: format!("drift export agents-md --write {name}"),
                by: "person",
            });
        }
        out.push(Integration {
            path: name.to_string(),
            kind: "agents-md",
            state,
            note,
        });
    }
    // Claude Code settings: Drift's entries are a known list per version.
    let entries = crate::lookup::claude_settings("drift");
    let now_allow = strings(&entries, "allow");
    let now_deny = strings(&entries, "deny");
    let mut known_allow = now_allow.clone();
    let mut known_deny = now_deny.clone();
    for (a, d) in OLDER_SETTINGS {
        known_allow.extend(a.iter().map(|s| s.to_string()));
        known_deny.extend(d.iter().map(|s| s.to_string()));
    }
    for name in SETTINGS_FILES {
        let Ok(text) = std::fs::read_to_string(root.join(name)) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            out.push(Integration {
                path: name.to_string(),
                kind: "claude-settings",
                state: "differs",
                note: "it is not JSON Drift can read; left as it is".into(),
            });
            continue;
        };
        let allow: BTreeSet<String> = strings(&v, "allow")
            .intersection(&known_allow)
            .cloned()
            .collect();
        let deny: BTreeSet<String> = strings(&v, "deny")
            .intersection(&known_deny)
            .cloned()
            .collect();
        if allow.is_empty() && deny.is_empty() {
            continue;
        }
        if now_allow.is_subset(&allow) && now_deny.is_subset(&deny) {
            out.push(Integration {
                path: name.to_string(),
                kind: "claude-settings",
                state: "current",
                note: "it holds every entry this Drift writes".into(),
            });
            continue;
        }
        let missing: Vec<String> = now_allow
            .difference(&allow)
            .chain(now_deny.difference(&deny))
            .cloned()
            .collect();
        let older = OLDER_SETTINGS.iter().any(|(a, d)| {
            let a: BTreeSet<String> = a.iter().map(|s| s.to_string()).collect();
            let d: BTreeSet<String> = d.iter().map(|s| s.to_string()).collect();
            a == allow && d == deny
        });
        let merged = crate::lookup::merge_settings(&text, &entries).and_then(|m| {
            serde_json::to_string_pretty(&m).ok().map(|mut t| {
                t.push('\n');
                t.into_bytes()
            })
        });
        match (older, merged) {
            (true, Some(bytes)) => {
                todo.push(Todo {
                    what: format!(
                        "add to {name} the entries this Drift writes that the older Drift did not: {}",
                        missing.join(", ")
                    ),
                    command: "drift upgrade --apply".into(),
                    by: "apply",
                });
                refresh.push((name.to_string(), bytes));
                out.push(Integration {
                    path: name.to_string(),
                    kind: "claude-settings",
                    state: "older",
                    note: format!(
                        "Drift's entries are exactly what an older Drift wrote; this Drift also writes {}",
                        missing.join(", ")
                    ),
                });
            }
            _ => {
                todo.push(Todo {
                    what: format!(
                        "{name} lacks entries this Drift writes ({}), and its Drift entries are not what any Drift wrote, so a person may have removed them on purpose; add them back only if not",
                        missing.join(", ")
                    ),
                    command: format!("drift export claude-settings --write {name}"),
                    by: "person",
                });
                out.push(Integration {
                    path: name.to_string(),
                    kind: "claude-settings",
                    state: "edited",
                    note: format!(
                        "it lacks {} and its Drift entries match no Drift's; left as it is",
                        missing.join(", ")
                    ),
                });
            }
        }
    }
    (out, refresh)
}

// ---------- text ----------

fn render(r: &Report) -> String {
    let mut out = String::new();
    if r.apply {
        out.push_str(&format!(
            "drift upgrade --apply: what this Drift ({}) reads in the files Drift wrote, and what was done.\n",
            r.drift
        ));
    } else {
        out.push_str(&format!(
            "drift upgrade: what this Drift ({}) reads in the files Drift wrote. Nothing was changed.\n",
            r.drift
        ));
    }
    out.push_str("\nFiles\n");
    for f in &r.files {
        if !f.present {
            out.push_str(&format!("  {}: not there\n", f.path));
            continue;
        }
        let mut line = format!("  {}:", f.path);
        match (&f.written_by, &f.format) {
            (Some(w), Some(v)) => {
                line.push_str(&format!(" {}, format {v}", sanitize(w, 120)));
            }
            (Some(w), None) => line.push_str(&format!(" {}", sanitize(w, 120))),
            (None, Some(v)) => line.push_str(&format!(" records no Drift version; format {v}")),
            (None, None) => line.push_str(" records no Drift version"),
        }
        if let Some(t) = &f.this_drift {
            line.push_str(&format!(" (this Drift: {t})"));
        }
        out.push_str(&line);
        out.push('\n');
        out.push_str(&format!("    records: {}\n", f.records));
        for n in &f.notes {
            out.push_str(&format!("    {n}\n"));
        }
    }
    if !r.conventions.is_empty() {
        out.push_str(&format!(
            "\nAccepted conventions ({}), read with this Drift\n",
            r.conventions.len()
        ));
        for c in &r.conventions {
            out.push_str(&format!(
                "  {}  {}\n",
                sanitize(&c.id, 80),
                sanitize(&c.summary, 160)
            ));
            match &c.accepted {
                Some(a) => out.push_str(&format!(
                    "    when accepted: {} of {} follow it, {} in its role\n",
                    a.holders, a.total, a.role_size
                )),
                None => out
                    .push_str("    when accepted: not recorded (accepted before Drift kept it)\n"),
            }
            let n = &c.now;
            if let Some(u) = &n.unchecked {
                out.push_str(&format!("    now: {u}\n"));
            } else if let (Some(role), Some(members), Some(holders)) =
                (n.role, n.members, n.holders)
            {
                out.push_str(&format!(
                    "    now: {holders} of {} follow it, {} not checked, {role} in its role; mode {}\n",
                    members - n.not_checked.min(members),
                    n.not_checked,
                    n.mode.as_deref().unwrap_or("advise")
                ));
            } else {
                out.push_str(&format!(
                    "    now: {} unit(s) of its place not checked; mode {}\n",
                    n.not_checked,
                    n.mode.as_deref().unwrap_or("advise")
                ));
            }
            for class in &c.classes {
                let text = match *class {
                    "stale" => format!(
                        "now stale: {}",
                        n.stale
                            .as_deref()
                            .unwrap_or("the code no longer bears it out")
                    ),
                    "newly_violated_by_unchanged_code" => format!(
                        "newly violated by code that did not change: {}",
                        c.reading_only
                    ),
                    "no_longer_checkable" => {
                        "no longer checkable: Drift cannot tell any of its members".to_string()
                    }
                    _ => "unchanged".to_string(),
                };
                out.push_str(&format!("    {text}\n"));
            }
            if c.changed_code > 0 {
                out.push_str(&format!(
                    "    new violations in code that changed: {}\n",
                    c.changed_code
                ));
            }
            if c.cannot_tell > 0 {
                out.push_str(&format!(
                    "    new violations Drift cannot tell about: {}\n",
                    c.cannot_tell
                ));
            }
        }
        let v = &r.violations;
        out.push_str("\nNew violations\n");
        out.push_str(&format!(
            "  {} appear only because this Drift reads the code differently: each was there, in a declaration no line of which changed, when its convention was baselined, and {LOCK_FILE} written then did not hold it\n",
            v.reading_only.len()
        ));
        for row in &v.reading_only {
            out.push_str(&format!(
                "    {} {} (line {}; compared with commit {})\n",
                sanitize(&row.id, 80),
                sanitize(&row.member, 200),
                row.line,
                row.base.as_deref().unwrap_or("?")
            ));
        }
        out.push_str(&format!(
            "  {} in code that changed since its convention was baselined: `drift check` reports them as before\n",
            v.changed_code.len()
        ));
        if !v.cannot_tell.is_empty() {
            out.push_str(&format!(
                "  {} Drift cannot tell about, so it leaves them to a person:\n",
                v.cannot_tell.len()
            ));
            for row in &v.cannot_tell {
                out.push_str(&format!(
                    "    {} {} (line {}): {}\n",
                    sanitize(&row.id, 80),
                    sanitize(&row.member, 200),
                    row.line,
                    sanitize(row.why.as_deref().unwrap_or(""), 400)
                ));
            }
        }
    }
    let s = &r.security;
    out.push_str("\nSecurity baseline\n");
    if s.present {
        out.push_str(&format!(
            "  {SECURITY_LOCK}: inventory {}{} (this Drift: inventory {}); {} finding(s) of kinds or detectors newer than it, which fail nothing until it records them\n",
            s.inventory.unwrap_or(1),
            if s.stamped { "" } else { " (no stamp)" },
            s.this_inventory,
            s.new_in_drift_total
        ));
        for (kind, n) in &s.new_in_drift {
            out.push_str(&format!("    {n} [{kind}]\n"));
        }
        if s.failing_not_in_baseline > 0 {
            out.push_str(&format!(
                "  {} finding(s) not in it, of kinds it knows, fail `drift check` (a change's, or an old kind read in more places: Drift cannot tell which)\n",
                s.failing_not_in_baseline
            ));
        }
    } else {
        out.push_str(&format!("  none ({SECURITY_LOCK} is not there)\n"));
    }
    out.push_str("\nAgent integrations\n");
    if r.integrations.is_empty() {
        out.push_str(&format!(
            "  none found (a Drift block in {}; Drift entries in {})\n",
            AGENTS_FILES.join(", "),
            SETTINGS_FILES.join(", ")
        ));
    }
    for i in &r.integrations {
        out.push_str(&format!(
            "  {} ({}): {}: {}\n",
            i.path, i.kind, i.state, i.note
        ));
    }
    if !r.done.is_empty() {
        out.push_str("\nDone\n");
        for d in &r.done {
            out.push_str(&format!("  - {d}\n"));
        }
    }
    if let Some(f) = &r.failed {
        out.push_str(&format!(
            "\nFailed\n  {}\n  Only what is listed under Done was written; nothing after the failure was. Fix the cause and run `drift upgrade --apply` again.\n",
            sanitize(f, 400)
        ));
    }
    out.push_str("\nLeft to do\n");
    if r.left.is_empty() {
        out.push_str("  nothing\n");
    }
    for t in &r.left {
        let who = match t.by {
            "apply" => "drift upgrade --apply does it",
            "security_baseline" => "only with --security-baseline",
            _ => "for a person",
        };
        out.push_str(&format!("  - {} ({who}): {}\n", t.what, t.command));
    }
    out.push_str(&format!(
        "\nNever done by an upgrade: accepting, rejecting, promoting or demoting a convention, changing a mode, or deleting a line. Exit {}.\n",
        if r.failed.is_some() {
            1
        } else if r.pending {
            EXIT_PENDING
        } else {
            0
        }
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins: a half-written lock line is named with its line number; a line Drift
    /// writes is not.
    #[test]
    fn a_half_written_lock_line_is_named() {
        let text = "# drift.lock: header\nD-abcdef app/a.ts#GET\nD-abcdef ~00ff app/a.ts#GET\nD-abc\nD-abcdef ~zz app/b.ts#GET\n";
        let p = lock_problems(text);
        assert_eq!(p.len(), 2, "{p:?}");
        assert!(p[0].starts_with("drift.lock line 4:"), "{p:?}");
        assert!(p[1].starts_with("drift.lock line 5:"), "{p:?}");
    }

    /// Pins: baselining into the lock only appends: a person's comment, an old-form
    /// fingerprint line and a fingerprint line whose member line is gone (which
    /// `Lock::save` would drop) are all kept byte for byte, the new member line comes
    /// with its fingerprint line, and a member the lock holds already adds nothing.
    #[test]
    fn baselining_into_the_lock_deletes_no_line() {
        let text = "# drift.lock: header\n# a person's note\nD-aaaaaa app/a.ts#GET\nD-aaaaaa ~00ff app/a.ts#GET\n#~ D-aaaaaa 0abc app/gone.ts#GET";
        let lock = Lock {
            entries: [
                ("D-aaaaaa".to_string(), "app/a.ts#GET".to_string()),
                ("D-aaaaaa".to_string(), "~00ff app/a.ts#GET".to_string()),
                ("D-aaaaaa".to_string(), "~0abc app/gone.ts#GET".to_string()),
            ]
            .into_iter()
            .collect(),
        };
        let add = Lock {
            entries: [
                ("D-aaaaaa".to_string(), "app/a.ts#GET".to_string()),
                ("D-aaaaaa".to_string(), "app/b.ts#GET".to_string()),
                ("D-aaaaaa".to_string(), "~1234 app/b.ts#GET".to_string()),
            ]
            .into_iter()
            .collect(),
        };
        let (out, n) = lock_with(Some(text), &lock, &add).unwrap();
        assert_eq!(n, 1);
        assert_eq!(
            out,
            format!("{text}\nD-aaaaaa app/b.ts#GET\n#~ D-aaaaaa 1234 app/b.ts#GET\n")
        );
        assert!(lock_with(Some(text), &lock, &lock).is_none());
    }

    /// Pins: a security baseline stamped by a newer inventory is refused as newer; a
    /// stamp that is not a number and a line that is no finding are named.
    #[test]
    fn a_newer_or_broken_security_baseline_is_refused() {
        let (newer, bad) = security_problems(&format!(
            "# header\n{VERSION_LINE}{}\nno-guard\ta.ts#GET\n",
            INVENTORY_VERSION + 1
        ));
        assert_eq!(newer.len(), 1);
        assert!(bad.is_empty());
        let (newer, bad) = security_problems("# inventory: two\nno-guard a.ts#GET\n");
        assert!(newer.is_empty());
        assert_eq!(bad.len(), 2, "{bad:?}");
        assert!(bad[0].contains("line 1"));
        assert!(bad[1].contains("line 2"));
    }

    /// Pins: the older settings table is the snapshot's list, and today's adds only
    /// the deny entry, so an unedited older file is told apart from an edited one.
    #[test]
    fn the_older_settings_differ_from_todays_by_the_deny_entry() {
        let now = crate::lookup::claude_settings("drift");
        let (allow, deny) = OLDER_SETTINGS[0];
        let allow: BTreeSet<String> = allow.iter().map(|s| s.to_string()).collect();
        assert_eq!(allow, strings(&now, "allow"));
        assert!(deny.is_empty());
        assert_eq!(
            strings(&now, "deny"),
            BTreeSet::from([crate::lookup::PROMOTE_DENY.to_string()])
        );
    }
}
