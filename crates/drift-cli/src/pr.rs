//! PR mode. `drift check --diff-base <ref>`: which violations a change introduces;
//! `--format github`: annotations and a job summary for GitHub Actions.
//!
//! The change is everything between the merge base of `<ref>` and `HEAD`, and the
//! working tree: `git diff --unified=0 --find-renames <merge-base>`, plus untracked
//! files. In CI the working tree is `HEAD`, so this is `git diff <ref>...HEAD`;
//! locally it also covers uncommitted edits, because `drift check` scans the
//! working tree.
//!
//! A violation is introduced when
//!
//! - its file was added (or is untracked), or
//! - it is on a declaration (symbol or model) and a changed line falls inside the
//!   declaration's extent ([`drift_mine::check::Extent`]: its line up to the next
//!   declaration, plus the decorators and comments directly above it), or
//! - it is file-level (a file, a package manifest, top-level statements) and its
//!   file has any changed line.
//!
//! A renamed file is not added: a violation in it is introduced unless it was there
//! before, under the old path (in `drift.lock`, or at the merge base when that is
//! checked), so moved legacy violations stay quiet. Deleted files have no
//! violations left to report.
//!
//! When a new violation outside the diff would fail the check, the change may have
//! caused it from another file (a deleted wrapper, a changed re-export). Then the
//! merge base is checked too, and a violation whose key was not there counts as
//! introduced as well.
//! Everything is computed from git's output, so the same commits give the same set.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{Context, bail};
use drift_mine::check::{CheckReport, Scope, Violation};
use drift_mine::policy::{CONVENTIONS_FILE, ConventionsFile, LOCK_FILE, Lock};
use drift_mine::report::{
    Basis, GithubSummary, github_annotations_with, github_summary, github_unchecked_annotations,
    github_unsure_annotations, trust_summary, trust_text,
};

/// What a diff did to one file that still exists.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Change {
    /// Added, or untracked: every violation in it is new.
    Added,
    /// Modified or renamed. Inclusive ranges of new-file lines that changed; a
    /// deletion touches the lines on both sides of it. Empty for a pure rename or a
    /// mode change.
    Lines(Vec<(u32, u32)>),
}

#[derive(Debug, Clone)]
pub struct DiffScope {
    /// The ref as given.
    pub base: String,
    /// The merge base of `base` and `HEAD` (a commit id).
    pub merge_base: String,
    files: BTreeMap<String, Change>,
    /// The change edits the policy (`.drift/conventions.yaml` or `drift.lock`): then
    /// any new violation may come from it, so every one counts as introduced.
    pub policy_changed: bool,
    /// Renamed files: new path -> old path.
    renamed_from: BTreeMap<String, String>,
    /// Of modified and renamed files: the new-file ranges of the hunks that add more
    /// lines than they remove ([`DiffScope::adds`]).
    grown: BTreeMap<String, Vec<(u32, u32)>>,
    /// Keys `(id, path#symbol)` of the violations at the merge base, when it was
    /// checked too ([`DiffScope::check_base`]).
    base_keys: Option<BTreeSet<(String, String)>>,
    /// Files of the merge base whose violations are unknown there: not parsed for lack
    /// of stack, or depending on such a file ([`drift_mine::unchecked`]). A violation
    /// in one is judged by the diff's lines alone, as if the base were not checked.
    base_uncertain: BTreeSet<String>,
    /// The merge base's files not parsed for lack of stack, sorted.
    base_unchecked: Vec<String>,
    pub deleted: usize,
    /// The merge base's facts and deployment boundary once [`DiffScope::check_base`]
    /// scanned them: [`DiffScope::base_inventory`] reads them instead of checking the
    /// merge base out and parsing it a second time. The facts carry the key files the
    /// check attached, which the security inventory never reads.
    base_scan: std::cell::OnceCell<(drift_core::RepoFacts, drift_mine::security::Boundaries)>,
}

impl DiffScope {
    /// The change from the merge base of `base` and `HEAD` to the working tree at `root`.
    pub fn from_git(root: &Path, base: &str) -> anyhow::Result<Self> {
        let inside = git(root, &["rev-parse", "--is-inside-work-tree"])
            .context("--diff-base needs git on PATH")?;
        if !inside.ok || inside.text().trim() != "true" {
            bail!(
                "--diff-base needs a git work tree, and {} is not in one",
                root.display()
            );
        }
        let shallow = git(root, &["rev-parse", "--is-shallow-repository"])?
            .text()
            .trim()
            == "true";
        let shallow_hint = if shallow {
            " The clone is shallow: fetch-depth: 0 needed (actions/checkout `with: fetch-depth: 0`)."
        } else {
            ""
        };
        if base.starts_with('-') {
            bail!("--diff-base: `{base}` is not a git ref");
        }
        let commit = format!("{base}^{{commit}}");
        let resolved = git(root, &["rev-parse", "--verify", "--quiet", &commit])?;
        if !resolved.ok {
            let mut msg = format!("--diff-base: base ref `{base}` not found.");
            let remote = format!("origin/{base}^{{commit}}");
            if !base.starts_with("origin/")
                && git(root, &["rev-parse", "--verify", "--quiet", &remote])?.ok
            {
                msg.push_str(&format!(" Did you mean `origin/{base}`?"));
            } else {
                let branch = base.strip_prefix("origin/").unwrap_or(base);
                msg.push_str(&format!(" Fetch it first (`git fetch origin {branch}`)."));
            }
            msg.push_str(shallow_hint);
            bail!("{msg}");
        }
        let mb = git(root, &["merge-base", base, "HEAD"])?;
        if !mb.ok {
            if shallow {
                bail!(
                    "--diff-base: no merge base between `{base}` and HEAD in this shallow clone: \
                     fetch-depth: 0 needed (actions/checkout `with: fetch-depth: 0`), \
                     or `git fetch --unshallow`."
                );
            }
            bail!("--diff-base: `{base}` and HEAD have no merge base (unrelated histories).");
        }
        let merge_base = mb.text().trim().to_string();

        // Exact paths and statuses, NUL-separated (no quoting).
        let status = git(
            root,
            &[
                "-c",
                "core.quotePath=false",
                "diff",
                "--name-status",
                "-z",
                "--no-color",
                "--find-renames",
                "--relative",
                "--no-ext-diff",
                "--no-textconv",
                "--ignore-submodules",
                &merge_base,
                "--",
            ],
        )?
        .required("git diff --name-status")?;
        // Changed lines, per new path.
        let patch = git(
            root,
            &[
                "-c",
                "core.quotePath=false",
                "diff",
                "--unified=0",
                "--find-renames",
                "--relative",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--ignore-submodules",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                &merge_base,
                "--",
            ],
        )?
        .required("git diff")?;
        // Untracked files under `root`, relative to it (like `--relative` above).
        let untracked = git(root, &["ls-files", "-z", "--others", "--exclude-standard"])?
            .required("git ls-files")?;

        let mut scope = parse(base, &merge_base, &status, &patch);
        for p in untracked.split(|b| *b == 0).filter(|p| !p.is_empty()) {
            let p = String::from_utf8_lossy(p);
            // Drift's own fact cache is not part of the change.
            if !p.starts_with(".drift/cache/") {
                scope.files.insert(p.into_owned(), Change::Added);
            }
        }
        Ok(scope)
    }

    /// Whether the diff introduces `v`. `text` is the file's current content, read
    /// for declarations in changed files: a declaration also owns the lines directly
    /// above it ([`leading_start`]), so editing a decorator or a `drift-ignore`
    /// comment counts.
    ///
    /// Either rule makes a violation introduced: the line rule (added file, changed
    /// lines in its declaration, a touched file for file-level rules), or, when the
    /// merge base was checked, its key (mapped through renames) not being there.
    /// A renamed file's violation is introduced unless it was there before: in
    /// `drift.lock` under the old path, or at the checked merge base.
    pub fn introduces(&self, v: &Violation, text: Option<&str>, lock: &Lock) -> bool {
        let old = self.renamed_from.get(&v.path);
        let base_key = format!("{}#{}", old.unwrap_or(&v.path), v.symbol);
        if old.is_some() && lock.contains(&v.id, &base_key) {
            // A legacy violation that moved with its file.
            return false;
        }
        let base_path = old.unwrap_or(&v.path);
        let at_base = self
            .base_keys
            .as_ref()
            .filter(|_| !self.base_uncertain.contains(base_path))
            .map(|k| k.contains(&(v.id.clone(), base_key)));
        // A renamed file whose violations at the checked merge base are unknown is
        // judged by its lines, like any other ([`DiffScope::filter`] lists the rest as
        // unsure), not blamed on the rename.
        if at_base == Some(false) || (old.is_some() && at_base.is_none() && !self.base_unknown(v)) {
            return true;
        }
        match self.files.get(&v.path) {
            None => false,
            Some(Change::Added) => true,
            Some(Change::Lines(ranges)) => match v.extent.lines() {
                None => !ranges.is_empty(),
                Some((a, b)) => {
                    let a = text.map_or(a, |t| leading_start(t, a));
                    ranges.iter().any(|&(s, e)| s <= b && a <= e)
                }
            },
        }
    }

    /// The merge base was checked, and `v`'s file (under its old name, if renamed) is
    /// one whose violations there are unknown.
    fn base_unknown(&self, v: &Violation) -> bool {
        let path = self.renamed_from.get(&v.path).unwrap_or(&v.path);
        self.base_keys.is_some() && self.base_uncertain.contains(path)
    }

    /// The merge base's files not parsed for lack of stack (empty unless it was checked).
    pub fn base_unchecked(&self) -> &[String] {
        &self.base_unchecked
    }

    /// The report restricted to what the diff introduces, plus the baselined
    /// (legacy) violations, which never fail and keep the legacy count right.
    /// Suppressed violations in the diff keep their flag. `fixed` is kept: it
    /// describes the lock. Files of declarations in changed files are read from `root`.
    pub fn filter(&self, root: &Path, report: &CheckReport, lock: &Lock) -> CheckReport {
        if self.policy_changed {
            return report.clone();
        }
        let mut texts: BTreeMap<&str, Option<String>> = BTreeMap::new();
        let mut violations = Vec::new();
        for v in &report.violations {
            let needs_text = v.extent.lines().is_some()
                && matches!(self.files.get(&v.path), Some(Change::Lines(r)) if !r.is_empty());
            let text = if needs_text {
                texts
                    .entry(v.path.as_str())
                    .or_insert_with(|| std::fs::read_to_string(root.join(&v.path)).ok())
                    .as_deref()
            } else {
                None
            };
            if v.baselined || self.introduces(v, text, lock) {
                violations.push(v.clone());
            } else if !v.suppressed && self.base_unknown(v) {
                // Outside the diff, in a file whose violations at the merge base are
                // unknown: the change may have caused it. Listed as unsure, not dropped.
                let mut u = v.clone();
                u.unsure = true;
                violations.push(u);
            }
        }
        // The neighbour gate's holds of the violations kept, and only those.
        let suppressed_neighbour = report
            .suppressed_neighbour
            .iter()
            .filter(|h| violations.iter().any(|v| v.suppressed_neighbour && h.of(v)))
            .cloned()
            .collect();
        CheckReport {
            violations,
            suppressed_neighbour,
            fixed: report.fixed.clone(),
            unchecked: report.unchecked.clone(),
            exempt: report
                .exempt
                .iter()
                .filter(|e| self.files.contains_key(&e.path))
                .cloned()
                .collect(),
            stale_practices: report.stale_practices.clone(),
            practices_not_checked: report.practices_not_checked.clone(),
            standing: report.standing.clone(),
        }
    }

    /// Check the merge base too, with the current policy and lock, so violations
    /// caused from elsewhere (a deleted wrapper, a changed re-export) count as
    /// introduced. The merge base is checked out into a temporary directory
    /// ([`BaseTree`]), with its own fact cache, and removed on every path out of here.
    pub fn check_base(
        &mut self,
        root: &Path,
        policy: &ConventionsFile,
        lock: &Lock,
    ) -> anyhow::Result<()> {
        let prefix = git(root, &["rev-parse", "--show-prefix"])?.required("git rev-parse")?;
        let prefix = String::from_utf8_lossy(&prefix).trim_end().to_string();
        let tree = BaseTree::create(root, &self.merge_base)?;
        let base_root = tree.path.join(&prefix);
        let opts = crate::scan::ScanOptions {
            cache_dir: Some(tree.cache.clone()),
            threads: 0,
        };
        let (mut facts, _) = crate::scan::scan(&base_root, &opts)
            .with_context(|| format!("scanning the merge base {}", short(&self.merge_base)))?;
        crate::history::attach_key_files(&base_root, policy, &mut facts);
        // The promoted practices too: a unit that broke one at the merge base was not
        // introduced by the change. Their map is of the base's own facts and config.
        let report = crate::practices::check_with_practices(
            &base_root,
            &facts,
            policy,
            lock,
            Scope::Accepted,
            None,
            None,
        );
        // Read while the checkout is there, for [`DiffScope::base_inventory`].
        let boundaries = drift_mine::security::Boundaries::load(&base_root);
        drop(tree);
        let unchecked = drift_mine::unchecked::Unchecked::of(&facts);
        self.base_unchecked = unchecked.files.iter().cloned().collect();
        self.base_uncertain = unchecked
            .files
            .into_iter()
            .chain(unchecked.dependents.into_keys())
            .collect();
        self.base_keys = Some(
            report
                .violations
                .into_iter()
                .filter(|v| !v.suppressed)
                .map(|v| (v.id, format!("{}#{}", v.path, v.symbol)))
                .collect(),
        );
        let _ = self.base_scan.set((facts, boundaries));
        Ok(())
    }

    /// The `diff` object of `--format json`.
    pub fn json(&self, outside: usize) -> serde_json::Value {
        let mut v = serde_json::json!({
            "base": self.base,
            "merge_base": self.merge_base,
            "files_added": self.added(),
            "files_changed": self.changed(),
            "files_renamed": self.renamed_from.len(),
            "base_checked": self.base_keys.is_some(),
            "policy_changed": self.policy_changed,
            "files_deleted": self.deleted,
            "new_outside_diff": outside,
        });
        if !self.base_unchecked.is_empty() {
            v["base_unchecked"] = serde_json::json!(self.base_unchecked);
        }
        v
    }

    /// The first line of text output: what was compared, and what was left out.
    pub fn print_header(&self, outside: usize) {
        println!(
            "drift: diff against {} (merge base {}): {} added, {} changed, {} deleted file(s){}",
            self.base,
            short(&self.merge_base),
            self.added(),
            self.changed(),
            self.deleted,
            if self.policy_changed {
                "; the policy changed, so every new violation is reported".to_string()
            } else if outside > 0 {
                format!(
                    "; {outside} new violation(s) outside the diff not shown (`drift check` lists them)"
                )
            } else {
                String::new()
            }
        );
        if !self.base_unchecked.is_empty() {
            println!(
                "drift: {} file(s) of the merge base not parsed (no stack could be reserved for them): violations there are judged by the diff's lines only",
                self.base_unchecked.len()
            );
        }
    }

    /// Whether the diff adds the declaration at `line` (1-based) of `path`: the file
    /// was added, or the line is in a hunk that adds more lines than it removes. A
    /// declaration edited in place (a guard taken off a handler that was there) is not
    /// added; what the change does to it is a violation's or a shared guard's to say.
    pub fn adds(&self, path: &str, line: u32) -> bool {
        match self.files.get(path) {
            None => false,
            Some(Change::Added) => true,
            Some(Change::Lines(_)) => self
                .grown
                .get(path)
                .is_some_and(|r| r.iter().any(|&(s, e)| s <= line && line <= e)),
        }
    }

    /// Whether the diff adds the entry point `(symbol, method, route)` declared at
    /// `(path, line)`: its file was added, or the merge base has no entry point of that
    /// symbol, method and route in the file (as it was named there). A method added to
    /// a class that already served the route is an addition though the class's own line
    /// did not change. `base` keeps the merge base's entry points once they are read;
    /// where they cannot be, the declaration's line decides ([`DiffScope::adds`]).
    pub fn adds_entry(
        &self,
        root: &Path,
        base: &std::cell::OnceCell<Option<BaseEntries>>,
        at: (&str, u32),
        entry: (&str, Option<&str>, Option<&str>),
    ) -> bool {
        let (path, line) = at;
        match self.files.get(path) {
            None => false,
            Some(Change::Added) => true,
            Some(Change::Lines(_)) => {
                let keys = base.get_or_init(|| {
                    self.base_inventory(root).ok().map(|inv| {
                        inv.entry_points
                            .iter()
                            .map(|e| {
                                (
                                    e.path.clone(),
                                    e.symbol.clone(),
                                    e.method.clone(),
                                    e.route.clone(),
                                )
                            })
                            .collect()
                    })
                });
                match keys {
                    Some(keys) => !keys.contains(&(
                        self.old_path(path).to_string(),
                        entry.0.to_string(),
                        entry.1.map(str::to_string),
                        entry.2.map(str::to_string),
                    )),
                    None => self.adds(path, line),
                }
            }
        }
    }

    pub fn added(&self) -> usize {
        self.files.values().filter(|c| **c == Change::Added).count()
    }

    /// Whether the diff added or changed `path` (a working-tree path).
    pub fn touches(&self, path: &str) -> bool {
        self.files.contains_key(path)
    }

    /// The path `path` had at the merge base: the old name of a renamed file, else itself.
    pub fn old_path<'a>(&'a self, path: &'a str) -> &'a str {
        self.renamed_from.get(path).map_or(path, String::as_str)
    }

    /// The security inventory of the merge base, scanned in a temporary checkout with
    /// its own fact cache ([`BaseTree`]); its compose files and `.drift/config.yaml`
    /// are read there, so a boundary the change moved is seen moving.
    pub fn base_inventory(&self, root: &Path) -> anyhow::Result<drift_mine::security::Inventory> {
        // Scanned already by the check of the merge base: the same commit, read the same
        // way, so the same facts and boundary.
        if let Some((facts, boundaries)) = self.base_scan.get() {
            return Ok(drift_mine::security::inventory_with(facts, boundaries.clone()));
        }
        let prefix = git(root, &["rev-parse", "--show-prefix"])?.required("git rev-parse")?;
        let prefix = String::from_utf8_lossy(&prefix).trim_end().to_string();
        let tree = BaseTree::create(root, &self.merge_base)?;
        let base_root = tree.path.join(&prefix);
        let opts = crate::scan::ScanOptions {
            cache_dir: Some(tree.cache.clone()),
            threads: 0,
        };
        let (facts, _) = crate::scan::scan(&base_root, &opts)
            .with_context(|| format!("scanning the merge base {}", short(&self.merge_base)))?;
        let boundaries = drift_mine::security::Boundaries::load(&base_root);
        drop(tree);
        Ok(drift_mine::security::inventory_with(&facts, boundaries))
    }

    pub fn changed(&self) -> usize {
        self.files.len() - self.added()
    }
}

/// The entry points of the merge base: file, symbol, method, route
/// ([`DiffScope::adds_entry`]).
pub type BaseEntries = std::collections::BTreeSet<(String, String, Option<String>, Option<String>)>;

/// The first line of the run of non-blank lines that ends just above line `start`
/// (1-based), or `start` itself. Facts place a TypeScript declaration on its
/// `export`/`class` line, below its decorators and comments; this takes them in.
fn leading_start(text: &str, start: u32) -> u32 {
    let lines: Vec<&str> = text.lines().collect();
    let mut k = (start as usize).saturating_sub(1).min(lines.len());
    while k > 0 && !lines[k - 1].trim().is_empty() {
        k -= 1;
    }
    u32::try_from(k + 1).unwrap_or(start).min(start)
}

/// `; N file(s) not checked, M unsure`, or nothing.
pub fn unchecked_suffix(unchecked: usize, unsure: usize) -> String {
    let mut out = String::new();
    if unchecked > 0 {
        out.push_str(&format!(
            "; {unchecked} file(s) not checked (no stack for them)"
        ));
    }
    if unsure > 0 {
        out.push_str(&format!(
            "; {unsure} violation(s) unsure (they depend on a file not checked)"
        ));
    }
    out
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(12)]
}

/// `--format github`: annotations on stdout, a summary line, and the job summary
/// appended to `GITHUB_STEP_SUMMARY` when it is set.
pub fn github_output(
    report: &CheckReport,
    scope: Option<&DiffScope>,
    prefix: &str,
    outside: usize,
    strict: bool,
    departures: &[drift_mine::practices::Departure],
    added: &[drift_mine::practices::AddedEntry],
) -> anyhow::Result<()> {
    github_output_with(
        report,
        scope,
        prefix,
        outside,
        strict,
        departures,
        added,
        &Basis::default(),
    )
}

/// `drift check`'s text after its list of new violations: what
/// each rule that reported one rests on ([`drift_mine::report::trust_text`]), read from
/// `facts` (those `report` was checked on), `policy` and `report`. Printed only when
/// there is a new violation of a convention of `policy`; the lines before it are
/// unchanged, and it changes no verdict and no exit code.
pub fn print_trust(facts: &drift_core::RepoFacts, policy: &ConventionsFile, report: &CheckReport) {
    let new: Vec<&Violation> = report.new_violations().collect();
    if new.is_empty() {
        return;
    }
    let basis = Basis::new(facts, policy, report);
    print!("{}", trust_text(&new, &basis));
}

/// [`github_output`], each annotation and the job summary also saying what each rule
/// rests on ([`Basis`]: read from the check of the policy's root, before its paths were
/// given `prefix`). The first lines of each annotation, the summary line and the
/// summary's own sections are as [`github_output`] writes them; this changes no verdict
/// and no exit code.
#[allow(clippy::too_many_arguments)]
pub fn github_output_with(
    report: &CheckReport,
    scope: Option<&DiffScope>,
    prefix: &str,
    outside: usize,
    strict: bool,
    departures: &[drift_mine::practices::Departure],
    added: &[drift_mine::practices::AddedEntry],
    basis: &Basis,
) -> anyhow::Result<()> {
    let new: Vec<_> = report.new_violations().collect();
    let suppressed: Vec<_> = report.suppressed().collect();
    let mut stdout = std::io::stdout().lock();
    stdout.write_all(github_annotations_with(&new, basis, prefix).as_bytes())?;
    stdout.write_all(github_unchecked_annotations(&report.unchecked, false).as_bytes())?;
    let base_unchecked: Vec<String> = scope
        .map_or(&[][..], |s| s.base_unchecked())
        .iter()
        .map(|p| format!("{prefix}{p}"))
        .collect();
    let base_unchecked = base_unchecked.as_slice();
    stdout.write_all(github_unchecked_annotations(base_unchecked, true).as_bytes())?;
    let unsure_list: Vec<_> = report.unsure().collect();
    stdout.write_all(github_unsure_annotations(&unsure_list).as_bytes())?;
    let unsure = unsure_list.len();
    // After the unchecked and unsure annotations: GitHub keeps about ten notices per
    // step, and those may be real violations; the practice map's facts and exemptions
    // only explain.
    stdout.write_all(drift_mine::practices::added_notices(added, prefix).as_bytes())?;
    stdout.write_all(drift_mine::practices::departures_notices(departures, prefix).as_bytes())?;
    let exempt: Vec<_> = report.exempt.iter().collect();
    stdout.write_all(drift_mine::report::github_exempt_notices(&exempt).as_bytes())?;
    // What the promoted practices could not say: a stale one fires on nothing, and units
    // Drift could not read are not checked. Notices of the run, never a failure.
    for s in &report.stale_practices {
        writeln!(
            stdout,
            "::notice title={}::{}",
            drift_mine::report::github_escape_property(&format!("drift [{}] stale", s.id)),
            drift_mine::report::github_escape_data(&format!(
                "Promoted practice {} is stale: no unit of its place does it an accepted way any more, so it reports nothing until a person promotes the way the code uses now or rejects it.",
                s.id
            ))
        )?;
    }
    for n in &report.practices_not_checked {
        writeln!(
            stdout,
            "::notice title={}::{}",
            drift_mine::report::github_escape_property(&format!("drift [{}] not checked", n.id)),
            drift_mine::report::github_escape_data(&format!(
                "{} unit(s) of promoted practice {} were not checked: Drift could not read how they do it (`drift practices --hints` settles them).",
                n.units, n.id
            ))
        )?;
    }
    writeln!(
        stdout,
        "drift: {} new violation(s){}, {} in block mode{}",
        new.len(),
        match scope {
            Some(s) if s.policy_changed => " (the policy changed: full check)",
            Some(_) => " introduced by the diff",
            None => "",
        },
        report.blocking().count(),
        unchecked_suffix(report.unchecked.len() + base_unchecked.len(), unsure)
    )?;
    if let Some(path) = std::env::var_os("GITHUB_STEP_SUMMARY").filter(|p| !p.is_empty()) {
        let md = github_summary(&GithubSummary {
            new: &new,
            suppressed: &suppressed,
            legacy: report.violations.iter().filter(|v| v.baselined).count(),
            // A policy change is checked like the whole repository.
            diff: scope
                .filter(|s| !s.policy_changed)
                .map(|s| (s.base.as_str(), s.merge_base.as_str(), outside)),
            strict,
            unchecked: &report.unchecked,
            base_unchecked,
            unsure,
        });
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| {
                format!("opening GITHUB_STEP_SUMMARY {}", Path::new(&path).display())
            })?;
        f.write_all(md.as_bytes())?;
        f.write_all(b"\n")?;
        let rests_on = trust_summary(&new, basis, prefix);
        if !rests_on.is_empty() {
            f.write_all(rests_on.as_bytes())?;
            f.write_all(b"\n")?;
        }
        let practices = [
            drift_mine::practices::added_summary(added),
            drift_mine::practices::departures_summary(departures),
        ]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
        if !practices.is_empty() {
            f.write_all(practices.as_bytes())?;
            f.write_all(b"\n")?;
        }
    }
    Ok(())
}

/// Parse `git diff --name-status -z` and `git diff --unified=0` output.
fn parse(base: &str, merge_base: &str, status: &[u8], patch: &[u8]) -> DiffScope {
    let mut scope = DiffScope {
        base: base.to_string(),
        merge_base: merge_base.to_string(),
        files: BTreeMap::new(),
        renamed_from: BTreeMap::new(),
        grown: BTreeMap::new(),
        policy_changed: false,
        base_keys: None,
        base_uncertain: BTreeSet::new(),
        base_unchecked: Vec::new(),
        deleted: 0,
        base_scan: std::cell::OnceCell::new(),
    };
    let mut fields = status
        .split(|b| *b == 0)
        .map(|f| String::from_utf8_lossy(f).into_owned());
    while let Some(code) = fields.next() {
        if code.is_empty() {
            continue;
        }
        // Renames and copies carry two paths (old, new); everything else one.
        let (old, path) = match code.as_bytes()[0] {
            b'R' | b'C' => (fields.next(), fields.next()),
            _ => (None, fields.next()),
        };
        let Some(path) = path else { break };
        scope.policy_changed |= [Some(&path), old.as_ref()]
            .into_iter()
            .flatten()
            .any(|p| p == CONVENTIONS_FILE || p == LOCK_FILE);
        if code.starts_with('R')
            && let Some(old) = old
        {
            scope.renamed_from.insert(path.clone(), old);
        }
        match code.as_bytes()[0] {
            b'A' => {
                scope.files.insert(path, Change::Added);
            }
            b'D' => scope.deleted += 1,
            _ => {
                scope.files.insert(path, Change::Lines(Vec::new()));
            }
        }
    }
    let mut current: Option<String> = None;
    // `---`/`+++` are file headers only between `diff --git` and the file's first
    // hunk: inside a hunk, an added line `++ x` reads as `+++ x`.
    let mut in_header = false;
    for line in patch.split(|b| *b == b'\n') {
        if line.starts_with(b"diff --git ") {
            current = None;
            in_header = true;
            continue;
        }
        if in_header {
            if let Some(rest) = line.strip_prefix(b"+++ ") {
                current = if rest == b"/dev/null" {
                    None
                } else {
                    unquote(rest).strip_prefix("b/").map(str::to_string)
                };
                continue;
            }
            if !line.starts_with(b"@@ ") {
                continue;
            }
            in_header = false;
        }
        // Hunk bodies are `+`, `-` or `\` lines; only `@@ ` starts a hunk.
        if !line.starts_with(b"@@ ") {
            continue;
        }
        let Some(path) = &current else { continue };
        let Some((start, count)) = new_range(line) else {
            continue;
        };
        let range = if count == 0 {
            // A pure deletion after line `start`: it touches both neighbours.
            (start.max(1), start + 1)
        } else {
            (start, start + count - 1)
        };
        if old_count(line).is_some_and(|removed| count > removed) {
            scope
                .grown
                .entry(path.clone())
                .or_default()
                .push((start, start + count - 1));
        }
        match scope.files.get_mut(path) {
            Some(Change::Lines(r)) => r.push(range),
            Some(Change::Added) => {}
            None => {
                // Not in --name-status (should not happen): count it as modified.
                scope.files.insert(path.clone(), Change::Lines(vec![range]));
            }
        }
    }
    scope
}

/// The `+c,d` range of a hunk header `@@ -a,b +c,d @@`; `d` defaults to 1.
fn new_range(header: &[u8]) -> Option<(u32, u32)> {
    let text = std::str::from_utf8(header).ok()?;
    let plus = text.split(' ').find(|t| t.starts_with('+'))?;
    let mut parts = plus[1..].splitn(2, ',');
    let start: u32 = parts.next()?.parse().ok()?;
    let count: u32 = match parts.next() {
        Some(c) => c.parse().ok()?,
        None => 1,
    };
    Some((start, count))
}

/// The `-a,b` count of a hunk header `@@ -a,b +c,d @@`; `b` defaults to 1.
fn old_count(header: &[u8]) -> Option<u32> {
    let text = std::str::from_utf8(header).ok()?;
    let minus = text.split(' ').find(|t| t.starts_with('-'))?;
    match minus[1..].split_once(',') {
        Some((_, c)) => c.parse().ok(),
        None => Some(1),
    }
}

/// A path from a diff header, which git C-quotes when it has special characters.
fn unquote(raw: &[u8]) -> String {
    // git ends a header path that contains a space with a TAB; a real trailing tab
    // would have been C-quoted.
    let raw = raw.strip_suffix(b"\t").unwrap_or(raw);
    let Some(inner) = raw.strip_prefix(b"\"").and_then(|r| r.strip_suffix(b"\"")) else {
        return String::from_utf8_lossy(raw).into_owned();
    };
    let mut out = Vec::with_capacity(inner.len());
    let mut i = 0;
    while i < inner.len() {
        let b = inner[i];
        if b != b'\\' || i + 1 == inner.len() {
            out.push(b);
            i += 1;
            continue;
        }
        let e = inner[i + 1];
        i += 2;
        out.push(match e {
            b'a' => 0x07,
            b'b' => 0x08,
            b't' => b'\t',
            b'n' => b'\n',
            b'v' => 0x0b,
            b'f' => 0x0c,
            b'r' => b'\r',
            b'0'..=b'7' => {
                let mut v = u32::from(e - b'0');
                for _ in 0..2 {
                    match inner.get(i) {
                        Some(d @ b'0'..=b'7') => {
                            v = v * 8 + u32::from(d - b'0');
                            i += 1;
                        }
                        _ => break,
                    }
                }
                u8::try_from(v).unwrap_or(b'?')
            }
            other => other,
        });
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// One commit's files, checked out into a fresh temporary directory that is removed
/// on drop, with a throwaway fact cache beside them.
///
/// Nothing is registered in the repository: a temporary index (`GIT_INDEX_FILE`)
/// gets the commit's tree with `git read-tree`, and `git checkout-index --prefix`
/// writes its files. An interrupted run leaves at most the temporary directory, and
/// the user's working tree, index and `.git/worktrees` are never touched. Hooks are
/// off (an empty `core.hooksPath`); attributes come from the empty tree
/// (`--attr-source`, where git supports it) and no attributes file, and Git LFS does
/// not download, so the checkout runs no hooks or filters shipped by the repository.
struct BaseTree {
    path: std::path::PathBuf,
    cache: std::path::PathBuf,
    _dir: tempfile::TempDir,
}

/// The empty tree's id (SHA-1 repositories).
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

impl BaseTree {
    fn create(repo: &Path, commit: &str) -> anyhow::Result<Self> {
        let dir = tempfile::Builder::new()
            .prefix("drift-base-")
            .tempdir()
            .context("creating a temporary directory for the merge base")?;
        let hooks = dir.path().join("no-hooks");
        std::fs::create_dir(&hooks)?;
        let attributes = dir.path().join("no-attributes");
        drift_core::fsutil::write_atomic(&attributes, ".no-attributes.tmp", b"")?;
        let index = dir.path().join("index");
        let tree = BaseTree {
            path: dir.path().join("tree"),
            cache: dir.path().join("cache"),
            _dir: dir,
        };
        let hooks_path = format!("core.hooksPath={}", hooks.display());
        let attributes_file = format!("core.attributesFile={}", attributes.display());
        let env = [("GIT_INDEX_FILE", index.as_path())];
        git_with(repo, &["-c", &hooks_path, "read-tree", commit], &env)?
            .required("git read-tree")?;
        let attr_source = format!("--attr-source={EMPTY_TREE}");
        let supports_attr_source = git(repo, &[&attr_source, "rev-parse", "--git-dir"])?.ok;
        let prefix = format!("--prefix={}/", tree.path.display());
        let mut args = vec![
            "-c",
            &hooks_path,
            "-c",
            &attributes_file,
            "-c",
            "core.autocrlf=false",
        ];
        if supports_attr_source {
            args.push(&attr_source);
        }
        args.extend(["checkout-index", "-a", "-f", &prefix]);
        git_with(repo, &args, &env)?.required("git checkout-index")?;
        Ok(tree)
    }
}

struct GitOut {
    ok: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl GitOut {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    fn required(self, what: &str) -> anyhow::Result<Vec<u8>> {
        if !self.ok {
            bail!(
                "--diff-base: `{what}` failed: {}",
                String::from_utf8_lossy(&self.stderr).trim()
            );
        }
        Ok(self.stdout)
    }
}

fn git(root: &Path, args: &[&str]) -> anyhow::Result<GitOut> {
    git_with(root, args, &[])
}

fn git_with(root: &Path, args: &[&str], env: &[(&str, &Path)]) -> anyhow::Result<GitOut> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .envs(env.iter().map(|(k, v)| (*k, *v)))
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .env_remove("GIT_EXTERNAL_DIFF")
        .stdin(Stdio::null())
        .output()
        .context("running git")?;
    Ok(GitOut {
        ok: out.status.success(),
        stdout: out.stdout,
        stderr: out.stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_mine::check::Extent;

    fn lines(scope: &DiffScope, path: &str) -> Option<Change> {
        scope.files.get(path).cloned()
    }

    #[test]
    fn parses_statuses_and_hunks() {
        let status = b"M\0src/a.ts\0A\0src/new.ts\0D\0src/gone.ts\0R087\0old/b.ts\0new/b.ts\0R100\0x.ts\0y.ts\0";
        let patch = b"diff --git a/src/a.ts b/src/a.ts\n\
index 1..2 100644\n\
--- a/src/a.ts\n\
+++ b/src/a.ts\n\
@@ -3 +3 @@ export\n\
-x\n\
+y\n\
@@ -10,2 +9,0 @@\n\
-a\n\
-b\n\
@@ -20,0 +19,3 @@\n\
+c\n\
diff --git a/src/gone.ts b/src/gone.ts\n\
deleted file mode 100644\n\
--- a/src/gone.ts\n\
+++ /dev/null\n\
@@ -1,2 +0,0 @@\n\
-gone\n\
diff --git a/old/b.ts b/new/b.ts\n\
similarity index 87%\n\
rename from old/b.ts\n\
rename to new/b.ts\n\
--- a/old/b.ts\n\
+++ b/new/b.ts\n\
@@ -5 +5,2 @@\n\
+z\n\
diff --git a/x.ts b/y.ts\n\
similarity index 100%\n\
rename from x.ts\n\
rename to y.ts\n";
        let s = parse("main", "abc", status, patch);
        assert_eq!(
            lines(&s, "src/a.ts"),
            Some(Change::Lines(vec![(3, 3), (9, 10), (19, 21)]))
        );
        assert_eq!(lines(&s, "src/new.ts"), Some(Change::Added));
        assert_eq!(lines(&s, "src/gone.ts"), None);
        assert_eq!(lines(&s, "old/b.ts"), None);
        assert_eq!(lines(&s, "new/b.ts"), Some(Change::Lines(vec![(5, 6)])));
        assert_eq!(lines(&s, "y.ts"), Some(Change::Lines(vec![])));
        assert_eq!(
            (s.renamed_from.len(), s.deleted, s.added(), s.changed()),
            (2, 1, 1, 3)
        );
        assert_eq!(s.renamed_from["new/b.ts"], "old/b.ts");
    }

    fn violation(path: &str, extent: Extent) -> Violation {
        Violation {
            id: "D-abc123".into(),
            path: path.into(),
            symbol: "GET".into(),
            line: extent.lines().map_or(1, |l| l.0),
            summary: String::new(),
            evidence: "40/43".into(),
            example: String::new(),
            mode: "block".into(),
            tier: drift_mine::tier::Tier::Default,
            baselined: false,
            suppressed: false,
            unsure: false,
            suppressed_neighbour: false,
            extent,
            wire: None,
            import: None,
            practice: None,
        }
    }

    #[test]
    fn introduced_by_added_files_declaration_extents_and_touched_files() {
        let status = b"M\0a.ts\0A\0new.ts\0R100\0old.ts\0moved.ts\0";
        let patch = b"diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -12,0 +12,1 @@\n+x\n";
        let s = parse("main", "abc", status, patch);
        let sym = |start, end| Extent::Symbol { start, end };
        // A changed line inside the declaration, not only on its first line.
        let none = Lock::default();
        let yes = |v: Violation| s.introduces(&v, None, &none);
        assert!(yes(violation("a.ts", sym(10, 20))));
        assert!(yes(violation("a.ts", sym(12, 12))));
        assert!(!yes(violation("a.ts", sym(1, 11))));
        assert!(!yes(violation("a.ts", sym(13, u32::MAX))));
        // A decorator or comment directly above the declaration line belongs to it.
        let text = "a\n".repeat(10) + "\n@Controller(\"x\")\n// note\nexport class C {}\n";
        assert_eq!(leading_start(&text, 14), 12);
        assert!(s.introduces(&violation("a.ts", sym(14, u32::MAX)), Some(&text), &none));
        assert!(!s.introduces(&violation("a.ts", sym(14, u32::MAX)), None, &none));
        // File-level rules on a touched file.
        assert!(yes(violation("a.ts", Extent::File)));
        // Anything in an added file.
        assert!(yes(violation("new.ts", sym(1, 3))));
        // A renamed file's violation is new unless it was recorded under the old path.
        assert!(yes(violation("moved.ts", sym(1, 3))));
        let mut lock = Lock::default();
        lock.entries
            .insert(("D-abc123".to_string(), "old.ts#GET".to_string()));
        assert!(!s.introduces(&violation("moved.ts", sym(1, 3)), None, &lock));
        // An untouched file is out of scope...
        assert!(!yes(violation("other.ts", Extent::File)));
        // ...unless the merge base was checked and the violation was not there.
        let mut s = s.clone();
        s.base_keys = Some(BTreeSet::from([(
            "D-abc123".to_string(),
            "kept.ts#GET".to_string(),
        )]));
        assert!(s.introduces(&violation("other.ts", sym(1, 3)), None, &none));
        assert!(!s.introduces(&violation("kept.ts", sym(1, 3)), None, &none));
        // With the base checked, a renamed file's violation that was there under its
        // old path is not new; one that was not is.
        s.base_keys = Some(BTreeSet::from([(
            "D-abc123".to_string(),
            "old.ts#GET".to_string(),
        )]));
        assert!(!s.introduces(&violation("moved.ts", sym(1, 3)), None, &none));
        let mut other = violation("moved.ts", sym(1, 3));
        other.id = "D-000000".into();
        assert!(s.introduces(&other, None, &none));
    }

    #[test]
    fn content_lines_that_look_like_headers_and_paths_with_spaces() {
        // git ends a `+++` path containing a space with a TAB; an added line `++ x`
        // shows as `+++ x` inside a hunk and is content, not a header.
        let status = b"M\0app/my route.ts\0M\0b.ts\0";
        let patch = b"diff --git a/app/my route.ts b/app/my route.ts\n\
index 1..2 100644\n\
--- a/app/my route.ts\t\n\
+++ b/app/my route.ts\t\n\
@@ -2 +2 @@\n\
-x\n\
+y\n\
diff --git a/b.ts b/b.ts\n\
--- a/b.ts\n\
+++ b/b.ts\n\
@@ -1,0 +2,2 @@\n\
+++ b/other.ts\n\
+--- a/b.ts\n\
@@ -9 +10 @@\n\
-z\n\
+w\n";
        let s = parse("main", "abc", status, patch);
        assert_eq!(
            lines(&s, "app/my route.ts"),
            Some(Change::Lines(vec![(2, 2)]))
        );
        assert_eq!(
            lines(&s, "b.ts"),
            Some(Change::Lines(vec![(2, 3), (10, 10)]))
        );
        assert_eq!(s.files.len(), 2, "{:?}", s.files);
    }

    #[test]
    fn leading_lines_stop_at_a_blank_line() {
        let text = "x\n\n/** doc */\n@A()\nexport class C {}\n";
        assert_eq!(leading_start(text, 5), 3);
        assert_eq!(leading_start(text, 1), 1);
        assert_eq!(leading_start("a\nb\n", 2), 1);
        // A stale line number past the end never moves forward.
        assert_eq!(leading_start("a\n", 9), 1);
        assert_eq!(leading_start("", 3), 1);
    }

    #[test]
    fn quoted_paths_round_trip() {
        assert_eq!(unquote(b"\"b/a\\tb\\\"c\\\\d.ts\""), "b/a\tb\"c\\d.ts");
        assert_eq!(unquote(b"\"b/caf\\303\\251.ts\""), "b/café.ts");
        assert_eq!(unquote(b"b/plain path.ts"), "b/plain path.ts");
    }

    #[test]
    fn hunk_ranges() {
        assert_eq!(new_range(b"@@ -1,2 +3,4 @@ fn"), Some((3, 4)));
        assert_eq!(new_range(b"@@ -1 +3 @@"), Some((3, 1)));
        assert_eq!(new_range(b"@@ -5,2 +4,0 @@"), Some((4, 0)));
        assert_eq!(new_range(b"@@ garbage"), None);
    }
}
