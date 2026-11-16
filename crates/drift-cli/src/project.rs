//! Shared helpers: locating the project, loading facts and policy, running checks.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::scan::{ScanOptions, scan, scan_file};
use anyhow::Context;
use drift_core::{FileFacts, Model, RepoFacts, SymbolKind};
use drift_mine::check::{CheckReport, Scope, check};
use drift_mine::policy::{CONVENTIONS_FILE, Convention, ConventionsFile, Lock, Mode, Status};
use drift_mine::report::sanitize;
use drift_mine::roles::RoleSelector;
use drift_mine::tier::Tier;

/// Rules for a file that does not exist yet.
pub enum NewFileRules<'a> {
    /// The content is known: only conventions whose role matches what it declares.
    Matched(Vec<&'a Convention>),
    /// No content: conventions grouped by what they apply to (`None`: any file there).
    Grouped(Vec<(Option<String>, Vec<&'a Convention>)>),
}

/// The condition under which a role applies to a new file at a covered path,
/// e.g. "if it exports HTTP handlers"; `None` when it applies to any file there.
pub fn applies_to(role: &RoleSelector) -> Option<String> {
    let s = match (role.entry.as_str(), role.kind) {
        (_, SymbolKind::Module | SymbolKind::Package) => return None,
        (_, SymbolKind::Model) => "if it defines database models",
        ("http", _) => "if it exports HTTP handlers",
        ("page", _) => "if it is a page",
        ("layout", _) => "if it is a layout",
        ("server_action", _) => "if it exports server actions",
        ("middleware", _) => "if it exports middleware",
        ("-", SymbolKind::Component) => "if it exports components",
        ("-", SymbolKind::Function) => "if it exports functions",
        ("-", SymbolKind::Class) => "if it exports classes",
        ("-", SymbolKind::Const | SymbolKind::Variable) => "if it exports values",
        (e, _) => return Some(format!("if it exports {} entry points", sanitize(e, 32))),
    };
    Some(s.to_string())
}

/// The condition under which convention `c` applies to a new file at a covered path
/// whose content is unknown: its role's ([`applies_to`]), or, for a file-level rule
/// about some files only, the rule's ([`drift_mine::mine::Rule::file_condition`]: "if it
/// imports one of uuid, nanoid, ..."). `None`: any file there.
pub fn condition(c: &Convention) -> Option<String> {
    // A promoted practice's role says nothing of a file: it holds the units of its
    // concern ("for its entry points").
    if c.rule.is_practice() {
        return drift_mine::practices::promote::condition(c);
    }
    applies_to(&c.role).or_else(|| {
        (c.role.kind == SymbolKind::Module)
            .then(|| c.rule.file_condition())
            .flatten()
    })
}

/// A suggestion-tier convention that advises (one a person forced to block is not
/// labelled: it blocks like any other).
pub fn is_suggestion(c: &Convention) -> bool {
    c.tier() == Tier::Suggestion && c.mode != Mode::Block
}

/// Whether a convention blocks once accepted: its mode as checked (a small role or a
/// wiring rule advises whatever the policy says).
pub fn blocks(c: &Convention) -> bool {
    drift_mine::check::effective_mode(c) == "block"
}

/// `[id] summary (holders/total follow it); copy example`, sanitized for an agent;
/// suggestions are marked `(suggestion)` and rules that block `(blocks)`. The evidence
/// is the rule's reason; its known exceptions are in its statement (", except ...").
pub fn rule_line(c: &Convention) -> String {
    format!(
        "[{}] {}{} ({}/{} follow it){}",
        sanitize(&c.id, 16),
        if is_suggestion(c) {
            "(suggestion) "
        } else if blocks(c) {
            "(blocks) "
        } else {
            ""
        },
        sanitize(&drift_mine::mine::agent_summary(&c.summary), 240),
        c.evidence.holders,
        c.evidence.total,
        copy_hint(c)
    )
}

/// `; copy <example>`, or nothing for a layering rule: a file that avoids an import is
/// no model to copy for one that has it.
pub fn copy_hint(c: &Convention) -> String {
    if drift_mine::tier::rule_kind(&c.rule) == "avoids:import" {
        String::new()
    } else {
        format!("; copy {}", sanitize(&c.example, 160))
    }
}

pub struct Project {
    pub root: PathBuf,
    pub policy: ConventionsFile,
    pub lock: Lock,
    /// With `agents.verify: on` ([`drift_mine::verify`], experimental): the accepted
    /// suggestions agents are not shown that the host agent may verify (no verdict, or a
    /// stale one). Empty otherwise.
    pub unverified: Vec<String>,
}

/// Directory for the fact cache (or `None` when disabled).
///
/// The in-repo cache (`.drift/cache`) is not used, with one warning, when:
/// - it has a symbolic link in `.drift`, `.drift/cache` or its directories:
///   writing through one would create files outside the repository;
/// - git tracks anything under it: facts are keyed by content hash only, so a
///   committed entry could carry forged facts that hide a violation from
///   `drift check`. (Without git this check is skipped.)
pub fn cache_dir(root: &Path, disabled: bool) -> Option<PathBuf> {
    if disabled {
        return None;
    }
    if let Ok(dir) = std::env::var("DRIFT_CACHE_DIR") {
        return Some(PathBuf::from(dir));
    }
    let dir = root.join(".drift").join("cache");
    // Decided once per process: the hooks ask several times.
    static REFUSED: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    let refused = REFUSED.get_or_init(|| {
        if let Some(link) = link_under_drift(&dir).or_else(|| link_inside(&dir, CACHE_LINK_DEPTH)) {
            return Some(format!("{} is a symbolic link", link.display()));
        }
        cache_tracked_by_git(root).then(|| "git tracks files under .drift/cache".to_string())
    });
    if let Some(why) = refused {
        static WARNED: std::sync::Once = std::sync::Once::new();
        WARNED.call_once(|| eprintln!("drift: {why}; running without the fact cache"));
        return None;
    }
    ignore_in_git(&dir);
    Some(dir)
}

/// Whether git tracks anything under `root/.drift/cache`. False when git is
/// missing or `root` is not in a work tree.
fn cache_tracked_by_git(root: &Path) -> bool {
    std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "-c",
            "core.fsmonitor=false",
            "ls-files",
            "-z",
            "--",
            ".drift/cache",
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .is_ok_and(|o| o.status.success() && !o.stdout.is_empty())
}

/// How deep `cache_dir` looks for links: the cache's own directories
/// (`facts-v*/<parser>/<shard>`, `sessions`). Files deeper down are only ever
/// replaced by rename, which replaces a link instead of following it.
const CACHE_LINK_DEPTH: usize = 3;

/// The first symbolic link among `path` and its parents up to and including the
/// repository's `.drift` directory (only components that exist). `None` when
/// `path` is not under a `.drift` directory.
pub fn link_under_drift(path: &Path) -> Option<PathBuf> {
    let drift = path
        .ancestors()
        .position(|p| p.file_name() == Some(".drift".as_ref()))?;
    path.ancestors()
        .take(drift + 1)
        .find(|p| std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()))
        .map(Path::to_path_buf)
}

/// The first symbolic link inside `dir`, looking `depth` levels down without
/// following links.
fn link_inside(dir: &Path, depth: usize) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for e in entries.flatten() {
        let Ok(t) = e.file_type() else { continue };
        if t.is_symlink() {
            return Some(e.path());
        }
        if t.is_dir()
            && depth > 1
            && let Some(link) = link_inside(&e.path(), depth - 1)
        {
            return Some(link);
        }
    }
    None
}

/// Make the cache directory with a `.gitignore` of `*` inside, so `git add -A`
/// never commits it. Best effort: without it the cache still works. The marker
/// is created only if nothing is there (`create_new` never follows a link and
/// never overwrites a file).
pub(crate) fn ignore_in_git(dir: &Path) {
    use std::io::Write;
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join(".gitignore"))
    {
        let _ = f.write_all(b"# Created by drift: the fact cache is local.\n*\n");
    }
}

/// Repo-relative POSIX path for an absolute path, or a path relative to `root` (the
/// canonical repository root), if inside it. The file (and its directories) may not
/// exist yet; `..`, `.`, repeated slashes and links in existing directories resolve.
pub fn rel_in(root: &Path, path: &str) -> Option<String> {
    let p = Path::new(path);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        root.join(p)
    };
    // Canonicalize the nearest existing ancestor, then re-append the rest.
    let mut existing = abs.as_path();
    let mut rest = Vec::new();
    while !existing.exists() {
        rest.push(existing.file_name()?.to_os_string());
        existing = existing.parent()?;
    }
    let mut resolved = existing.canonicalize().ok()?;
    for part in rest.iter().rev() {
        if part == ".." {
            return None;
        }
        resolved.push(part);
    }
    drift_core::ingest::rel_posix(root, &resolved)
}

/// Where `root` is in its git work tree: `web/` for a `--root web` at the top level,
/// "" at the top level, outside git, or when git is missing.
pub fn git_prefix(root: &Path) -> String {
    std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["-c", "core.fsmonitor=false", "rev-parse", "--show-prefix"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim_end_matches(['\n', '\r']).to_string())
        .filter(|s| s.is_empty() || s.ends_with('/'))
        .unwrap_or_default()
}

/// `report` with every file path counted from the git top level (`prefix` from
/// [`git_prefix`]): GitHub annotations and SARIF results must name files as the
/// repository does, or a `--root web` run points at `lib/x.ts`, which does not exist
/// at the top (pilot G1). Unchanged when `prefix` is empty.
pub fn at_git_top(report: &CheckReport, prefix: &str) -> CheckReport {
    let mut r = report.clone();
    if prefix.is_empty() {
        return r;
    }
    let fix = |p: &mut String| *p = format!("{prefix}{p}");
    r.violations.iter_mut().for_each(|v| fix(&mut v.path));
    r.exempt.iter_mut().for_each(|e| fix(&mut e.path));
    r.unchecked.iter_mut().for_each(fix);
    r.suppressed_neighbour
        .iter_mut()
        .for_each(|n| fix(&mut n.path));
    r
}

/// Walk up from `start` to the directory holding `.drift/conventions.yaml`.
pub fn find_root(start: &Path) -> Option<PathBuf> {
    let mut d = Some(start);
    while let Some(dir) = d {
        if dir.join(CONVENTIONS_FILE).is_file() {
            return Some(dir.to_path_buf());
        }
        d = dir.parent();
    }
    None
}

impl Project {
    pub fn open(root: &Path) -> anyhow::Result<Self> {
        Self::with_policy(root, ConventionsFile::load(root)?)
    }

    fn with_policy(root: &Path, policy: Option<ConventionsFile>) -> anyhow::Result<Self> {
        let mut policy =
            policy.with_context(|| format!("no {CONVENTIONS_FILE}: run `drift init` first"))?;
        // Hooks and MCP: wiring conventions are inert while the feature is off.
        crate::wiring::gate(root, &mut policy, false)?;
        let lock = Lock::load(root)?;
        let root = root
            .canonicalize()
            .with_context(|| format!("opening {}", root.display()))?;
        Ok(Self {
            root,
            policy,
            lock,
            unverified: Vec::new(),
        })
    }

    /// The project as agents see it (the hooks, the MCP tools, `drift example`, the
    /// AGENTS.md export): only conventions shown to agents
    /// ([`drift_mine::admission::shown_to_agents`]: the default tier once a person accepted
    /// it (until then a block candidate, decision D13), suggestions of an
    /// admitted rule family, and those a person chose to show or forced to block). The
    /// others stay in `.drift/conventions.yaml` for people; nothing is written.
    ///
    /// With `agents.verify: on`, a suggestion the host agent verified is shown too (a
    /// fresh cached pass, [`drift_mine::verify::WithVerifier`]): comparing a cached
    /// verdict with its card as it is now takes a scan, done only when there is one.
    ///
    /// [STRICT] A policy that cannot be read shows agents nothing, and its error does not
    /// quote it either: the error names the file and the command that says why, never the
    /// lines a parser would quote (they hold convention summaries).
    pub fn open_for_agents(root: &Path) -> anyhow::Result<Self> {
        let policy = ConventionsFile::load(root).map_err(|e| {
            // A file in a newer format quotes nothing of the file: say what to do.
            if let Some(newer) = e.downcast_ref::<drift_mine::policy::NewerPolicy>() {
                return anyhow::anyhow!("{}", newer.for_agents());
            }
            anyhow::anyhow!(
                "{CONVENTIONS_FILE} could not be read, so no convention is shown to agents until it is fixed (`drift review --list` says why)"
            )
        })?;
        let mut p = Self::with_policy(root, policy)?;
        let statuses = drift_mine::verify::statuses(&p.root, &p.policy, || p.scan(false).ok());
        let shown =
            |c: &Convention| drift_mine::verify::convention_view(c, statuses.as_ref()).shown;
        if let Some(st) = &statuses {
            p.unverified = p
                .policy
                .conventions
                .iter()
                .filter(|c| {
                    st.get(&c.id).is_some_and(|s| {
                        matches!(
                            s.state,
                            drift_mine::verify::State::Unverified
                                | drift_mine::verify::State::Stale
                        )
                    }) && !shown(c)
                })
                .map(|c| c.id.clone())
                .collect();
        }
        p.policy.conventions.retain(|c| shown(c));
        Ok(p)
    }

    pub fn scan(&self, no_cache: bool) -> anyhow::Result<RepoFacts> {
        let opts = ScanOptions {
            cache_dir: cache_dir(&self.root, no_cache),
            threads: 0,
        };
        let mut facts = scan(&self.root, &opts)?.0;
        crate::history::attach_key_files(&self.root, &self.policy, &mut facts);
        Ok(facts)
    }

    /// Facts sufficient to check the file `rel`: computed for that file alone from
    /// the scan index when possible (same result as a full scan), else a full scan.
    /// With them, whether they are the whole repository's (the full scan was made).
    pub fn scan_for_file(&self, rel: &str) -> anyhow::Result<(RepoFacts, bool)> {
        let opts = ScanOptions {
            cache_dir: cache_dir(&self.root, false),
            threads: 0,
        };
        // A promoted practice is checked against the practice map, which one file's facts
        // cannot draw: `needs_full_scan` asks for the repository only when a practice
        // covers the file, so an edit anywhere else keeps the one-file check.
        match scan_file(&self.root, &opts, rel) {
            Ok(Some(facts)) if !drift_mine::check::needs_full_scan(&facts, &self.policy) => {
                crate::agent::trace::took("single_file");
                Ok((facts, false))
            }
            Ok(Some(_)) => {
                crate::agent::trace::took("full_scan:needs_full_scan");
                Ok((self.scan(false)?, true))
            }
            Ok(None) => {
                crate::agent::trace::took("full_scan:no_single_file_scan");
                Ok((self.scan(false)?, true))
            }
            Err(_) => {
                crate::agent::trace::took("full_scan:single_file_error");
                Ok((self.scan(false)?, true))
            }
        }
    }

    /// What the accepted conventions say of `facts`, the promoted practices among them
    /// included ([`crate::practices::check_with_practices`]). The practice map they are
    /// read from is kept beside the fact cache ([`crate::derived`]): the hook or tool
    /// that asks for it next for the same facts reads it back.
    pub fn check(&self, facts: &RepoFacts, only: Option<&BTreeSet<String>>) -> CheckReport {
        let map = std::cell::OnceCell::new();
        self.check_with_map(facts, only, || {
            map.get_or_init(|| {
                let kept = crate::derived::Derived::of(cache_dir(&self.root, false), facts);
                crate::practices::report_units_kept(&self.root, facts, kept.as_ref())
            })
        })
    }

    /// [`Project::check`] for a caller that has the practice map of `facts` (with units
    /// listed) or builds it for something else too: `map` is asked only when an
    /// accepted convention is a promoted practice.
    pub fn check_with_map<'m>(
        &self,
        facts: &RepoFacts,
        only: Option<&BTreeSet<String>>,
        map: impl FnOnce() -> &'m drift_mine::practices::PracticesReport,
    ) -> CheckReport {
        let mut report = self.check_conventions(facts, only);
        self.add_practices(&mut report, facts, only, map);
        report
    }

    /// The mined conventions' part of [`Project::check`], without the promoted
    /// practices: for a caller that adds them once the map is built beside it
    /// ([`Project::add_practices`]), or that reads only what the role conventions say
    /// (their exempt members).
    pub fn check_conventions(
        &self,
        facts: &RepoFacts,
        only: Option<&BTreeSet<String>>,
    ) -> CheckReport {
        let mut report = check(facts, &self.policy, &self.lock, Scope::Accepted, only);
        drift_mine::check::locate_imports(&mut report, &self.root);
        report
    }

    /// Adds to `report` ([`Project::check_conventions`] of the same facts and paths)
    /// what the accepted promoted practices say; `map` is asked only when there is one.
    pub fn add_practices<'m>(
        &self,
        report: &mut CheckReport,
        facts: &RepoFacts,
        only: Option<&BTreeSet<String>>,
        map: impl FnOnce() -> &'m drift_mine::practices::PracticesReport,
    ) {
        crate::practices::add_practices(
            report,
            facts,
            &self.policy,
            &self.lock,
            Scope::Accepted,
            only,
            map,
        );
    }

    pub fn accepted(&self) -> impl Iterator<Item = &Convention> {
        self.policy
            .conventions
            .iter()
            .filter(|c| c.status == Status::Accepted)
    }

    /// The workspace package of the file at `rel` ([`drift_mine::workspace::package_of`]
    /// over the policy's packages; `(root)` for the root package), or `None` in a
    /// single-package policy, whose agent text does not change.
    pub fn package_label(&self, rel: &str) -> Option<String> {
        if self.policy.packages.is_empty() {
            return None;
        }
        let p = self.package_of(rel);
        Some(if p.is_empty() {
            "(root)".to_string()
        } else {
            p.to_string()
        })
    }

    /// The package of `rel` among the policy's packages ("" when it has none).
    pub fn package_of(&self, rel: &str) -> &str {
        drift_mine::workspace::package_of(self.policy.packages.iter().map(String::as_str), rel)
    }

    /// Whether convention `c` is scoped to the package of `rel` (some part of its role
    /// is in that package). Always true in a single-package policy.
    fn in_scope(&self, c: &Convention, rel: &str) -> bool {
        if self.policy.packages.is_empty() {
            return true;
        }
        let pkg = self.package_of(rel);
        c.role.kind == SymbolKind::Package
            || c.role.kind == SymbolKind::Model
            || c.role.parts().iter().any(|p| p.package == pkg)
    }

    /// Repo-relative POSIX path for an absolute or relative path, if inside the root.
    /// The file (and its directories) may not exist yet.
    pub fn rel(&self, path: &str) -> Option<String> {
        rel_in(&self.root, path)
    }

    /// Whether the promoted practice `c` applies to the file at `rel`
    /// ([`drift_mine::practices::promote::covers`]): its place holds the file and, with
    /// the file's facts (`existing`: read, or lowered from the content about to be
    /// written), the file declares a unit of its concern. Without them the file is
    /// held to it as one that will declare one ([`condition`] says so where the rules
    /// are listed): a rule shown for a helper costs a line, one left out is never heard.
    fn practice_covers(&self, c: &Convention, rel: &str, existing: Option<&FileFacts>) -> bool {
        use drift_mine::practices::promote;
        match existing {
            Some(f) => promote::covers_file(c, f),
            None => promote::covers(c, self.package_of(rel), rel, |_| true),
        }
    }

    /// Conventions (not rejected) whose role covers a file at `rel` (which may not exist
    /// yet), and the promoted practices that apply to it (their place holds it and it
    /// declares, or may declare, a unit of their concern).
    /// `existing` and `models` are the file's facts and the models it declares, when
    /// known.
    pub fn conventions_for_path<'a>(
        &'a self,
        rel: &str,
        existing: Option<&FileFacts>,
        models: Option<&[Model]>,
        only_accepted: bool,
    ) -> Vec<&'a Convention> {
        self.policy
            .conventions
            .iter()
            .filter(|c| {
                if only_accepted {
                    c.status == Status::Accepted
                } else {
                    c.status != Status::Rejected
                }
            })
            // Nearest scope: only conventions of the file's own package.
            .filter(|c| self.in_scope(c, rel))
            .filter(|c| {
                // A promoted practice's role holds no file: its place and the file's
                // units say whether it applies.
                if c.rule.is_practice() {
                    return self.practice_covers(c, rel, existing);
                }
                drift_mine::roles::convention_role_covers_path(
                    &c.role,
                    c.selector_version,
                    rel,
                    existing,
                    models,
                    &self.policy.file_kinds,
                )
            })
            // A file-level rule that can say nothing about this file (a library
            // preference for a file that imports none of its group) is not its rule.
            .filter(|c| {
                c.role.kind != SymbolKind::Module
                    || existing.is_none_or(|f| c.rule.concerns_file(f))
            })
            .collect()
    }

    /// Conventions for a file about to be created at `rel`. With its content, the
    /// file is lowered in memory and only roles matching its symbols, entry points
    /// and models are kept; without it, the rules are grouped by what they apply to.
    /// TypeScript content a scan would skip or cannot lower gets no rules; Python
    /// content a scan would skip gets none, and content that does not parse gets the
    /// grouped rules (it will still be checked, but what it declares is unknown).
    pub fn rules_for_new_file<'a>(
        &'a self,
        rel: &str,
        content: Option<&str>,
        only_accepted: bool,
    ) -> NewFileRules<'a> {
        let ext = Path::new(rel)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default();
        let is_source = drift_core::ingest::SOURCE_EXTENSIONS.contains(&ext);
        let is_python = ext == "py";
        if !is_source && !is_python {
            // Only workspace packages and schema files have rules among non-source files.
            let name = rel.rsplit('/').next().unwrap_or(rel);
            let config = drift_mine::roles::is_package_manifest(rel)
                || name.ends_with(".prisma")
                || name.ends_with(".sql");
            return NewFileRules::Matched(
                self.conventions_for_path(rel, None, None, only_accepted)
                    .into_iter()
                    .filter(|c| {
                        config && matches!(c.role.kind, SymbolKind::Model | SymbolKind::Package)
                    })
                    .collect(),
            );
        }
        match content {
            Some(text) if is_python => match drift_py::preview_file(&self.root, rel, text) {
                drift_py::Preview::Skipped => return NewFileRules::Matched(Vec::new()),
                drift_py::Preview::Lowered { facts, models } => {
                    return NewFileRules::Matched(self.conventions_for_path(
                        rel,
                        Some(facts.as_ref()),
                        Some(&models),
                        only_accepted,
                    ));
                }
                drift_py::Preview::Unparsed => {}
            },
            Some(text) => match drift_ts::preview_file(&self.root, rel, text) {
                // Content a scan would skip gets no rules.
                Ok(None) => return NewFileRules::Matched(Vec::new()),
                Ok(Some(facts)) => {
                    return NewFileRules::Matched(self.conventions_for_path(
                        rel,
                        Some(&facts),
                        None,
                        only_accepted,
                    ));
                }
                // No stack to lower it on: what it declares is unknown, so the rules
                // by path, as for a file whose content is not given.
                Err(_) => {}
            },
            None => {}
        }
        let mut groups: std::collections::BTreeMap<Option<String>, Vec<&Convention>> =
            std::collections::BTreeMap::new();
        for c in self.conventions_for_path(rel, None, None, only_accepted) {
            groups.entry(condition(c)).or_default().push(c);
        }
        // `None` (any file) sorts first.
        NewFileRules::Grouped(groups.into_iter().collect())
    }
}
