//! What an agent found while investigating (`drift investigate`), kept as local files:
//! findings (a real gap in the repository's code) under `.drift/findings/`, and gap
//! reports (a construct Drift does not read, as a minimal self-contained example) under
//! `.drift/gap-reports/`.
//!
//! - **Local only.** Each directory gets a `.gitignore` of `*` when Drift creates it (as
//!   the fact cache and the review log do), so neither is committed by accident. Nothing
//!   here makes a network call, posts an issue or pushes a branch: sharing is a person's
//!   deliberate act.
//! - **On request only.** `drift findings --issue <id>` prints an issue draft (or writes
//!   it to a file); `drift findings --branch <id>` makes a local branch with the patch the
//!   agent wrote, without touching the working tree, the index or `HEAD`.
//! - **Neutral.** A gap report carries the repository's names replaced by neutral ones
//!   (the names the agent marks, and the repository's own folder name); Drift refuses one
//!   in which a marked name remains.
//! - **Never through a link.** `.drift`, the directories and every file are refused when
//!   they are symbolic links (a repository can commit `.drift -> ~`).

use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, bail};
use serde::{Deserialize, Serialize};

use crate::setup::evidence::{self, Excerpt};
use crate::setup::investigate::{Extra, Item, ItemKind, RouteRow};
use crate::setup::{By, Given};

pub const FINDINGS_DIR: &str = ".drift/findings";
pub const GAPS_DIR: &str = ".drift/gap-reports";
pub const FINDING_SCHEMA: &str = "drift-finding";
pub const GAP_SCHEMA: &str = "drift-gap-report";
pub const VERSION: u32 = 1;

/// Most excerpts a finding quotes from what was cited.
const MAX_CITED_EXCERPTS: usize = 5;
/// Lines quoted around a cited line: before and after.
const BEFORE: usize = 3;
const AFTER: usize = 8;
/// A gap report's bounds: files, bytes of one file, bytes of them all.
const MAX_GAP_FILES: usize = 20;
const MAX_GAP_FILE: usize = 64 * 1024;
const MAX_GAP_BYTES: usize = 256 * 1024;
/// Most characters of a title, a fix, an expectation.
const MAX_TITLE: usize = 160;
const MAX_TEXT: usize = 4000;
/// Most bytes of a patch.
const MAX_PATCH: usize = 256 * 1024;

/// A real gap in the repository's code, as an agent recorded it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Finding {
    pub schema: String,
    pub version: u32,
    /// `F-` and the 6 hex digits of its item.
    pub id: String,
    /// The `drift investigate` item it was found on.
    pub item: String,
    /// The item's evidence digest when it was recorded.
    pub seen: String,
    pub title: String,
    /// `authn`, `authz` or `exposure`.
    pub concern: String,
    /// What Drift said of the routes.
    pub drift_said: String,
    /// The routes it is about (`GET /x (handler) path:line`).
    pub routes: Vec<String>,
    /// `item` when the agent named no route and none of its evidence is a route's file:
    /// `routes` are then all of the item's, not ones the agent cited. Absent otherwise.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub routes_scope: String,
    /// Why it is a gap.
    pub why: String,
    /// What would close it.
    pub fix: String,
    /// The code cited, as written.
    pub excerpts: Vec<Excerpt>,
    /// `file:line` of each place read.
    pub evidence: Vec<String>,
    /// A unified diff the agent wrote, not applied (`drift findings --branch`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub patch: String,
    /// `agent` or `person`.
    pub by: String,
    pub on: String,
}

/// A gap report's record (`gap.json` beside the fixture).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GapReport {
    pub schema: String,
    pub version: u32,
    /// `G-` and the 6 hex digits of its item.
    pub id: String,
    pub item: String,
    pub seen: String,
    /// What Drift answered in the repository: the concern and the reason, no names.
    pub drift_said: String,
    /// What the right answer is, and why (names replaced).
    pub expect: String,
    pub why: String,
    /// The fixture's files, relative to `fixture/`.
    pub files: Vec<String>,
    /// What this Drift says of the fixture now.
    pub says: Vec<String>,
    /// The Drift that wrote it.
    pub drift: String,
    pub by: String,
    pub on: String,
}

fn by_word(by: By) -> &'static str {
    match by {
        By::Agent => "agent",
        By::Person => "person",
    }
}

fn today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    crate::review_log::utc(secs)[..10].to_string()
}

fn bounded(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() > max {
        let cut: String = s.chars().take(max).collect();
        format!("{}...", cut.trim_end())
    } else {
        s.to_string()
    }
}

// ---------- the directories ----------

fn is_link(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

/// `root/<rel>` (`.drift/findings`), refusing a symbolic link on the way; created with its
/// `.gitignore` of `*` when `create`.
fn local_dir(root: &Path, rel: &str, create: bool) -> anyhow::Result<PathBuf> {
    let dir = root.join(rel);
    for p in [root.join(".drift"), dir.clone()] {
        if is_link(&p) {
            bail!(
                "{} is a symbolic link: Drift never writes its local notes through one",
                p.display()
            );
        }
    }
    if create {
        std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
        // `create_new` never follows a link and never overwrites what is there.
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(".gitignore"))
        {
            let _ = f.write_all(
                b"# Created by drift: what an agent found stays on this machine until a person shares it.\n*\n",
            );
        }
    }
    Ok(dir)
}

/// Write `bytes` to `path` (in a directory Drift made), never through a link.
fn write_file(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    if is_link(path) {
        bail!("{} is a symbolic link: refused", path.display());
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    let mut f = opts
        .open(path)
        .with_context(|| format!("writing {}", path.display()))?;
    f.write_all(bytes)?;
    Ok(())
}

/// Write an issue draft to `file` (`drift findings --issue <id> --write <file>`): never
/// into Drift's policy and state (a `.drift/` directory, a `drift.lock`), never through a
/// symbolic link (the file itself, or a directory from the repository down: a cloned
/// repository's link may lead anywhere), and never over a file that is there unless
/// `force`, a person's flag.
pub fn write_issue(root: &Path, file: &Path, text: &str, force: bool) -> anyhow::Result<()> {
    let abs = std::path::absolute(file)?;
    let (Some(dir), Some(name)) = (abs.parent(), abs.file_name()) else {
        bail!("{} is not a file path", file.display());
    };
    let real = dir
        .canonicalize()
        .with_context(|| format!("{} is not a directory", dir.display()))?
        .join(name);
    let policy = |p: &Path| {
        p.components()
            .any(|c| c.as_os_str().eq_ignore_ascii_case(".drift"))
            || p.file_name()
                .is_some_and(|f| f.eq_ignore_ascii_case(drift_mine::policy::LOCK_FILE))
    };
    if policy(&abs) || policy(&real) {
        bail!(
            "{} is Drift's policy and state (.drift/, drift.lock): an issue draft is never written there",
            file.display()
        );
    }
    let roots = [std::path::absolute(root)?, drift_core::fsutil::canonical(root)?];
    if let Some(link) = std::iter::once(abs.as_path())
        .chain(
            abs.ancestors()
                .skip(1)
                .filter(|a| roots.iter().any(|r| a.starts_with(r) && a != r)),
        )
        .find(|a| is_link(a))
    {
        bail!(
            "{} is a symbolic link: Drift never writes an issue draft through one",
            link.display()
        );
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true);
    if force {
        opts.create(true).truncate(true);
    } else {
        opts.create_new(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    let mut f = opts.open(&abs).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            anyhow::anyhow!(
                "{} exists: Drift does not replace it (--force replaces it)",
                file.display()
            )
        } else {
            anyhow::anyhow!("writing {}: {e}", file.display())
        }
    })?;
    f.write_all(text.as_bytes())?;
    Ok(())
}

/// `F-1a2b3c` of `I-1a2b3c`.
fn id_for(prefix: char, item: &str) -> String {
    format!(
        "{prefix}-{}",
        item.strip_prefix(crate::setup::investigate::PREFIX)
            .unwrap_or(item)
    )
}

/// A repository-relative path that stays inside: no `..`, not absolute.
fn inside(p: &str) -> Option<String> {
    // Windows: `\` is a separator there, never part of a name (on Unix it may be one),
    // and `:` is never in a relative path (`C:/x`).
    #[cfg(windows)]
    let owned = p.replace('\\', "/");
    #[cfg(windows)]
    let p = owned.as_str();
    let p = p.trim();
    if p.is_empty() || p.starts_with('/') || p.contains('\0') || p.contains('\\') {
        return None;
    }
    if cfg!(windows) && p.contains(':') {
        return None;
    }
    let parts: Vec<&str> = p
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();
    if parts.is_empty() || parts.contains(&"..") {
        return None;
    }
    Some(parts.join("/"))
}

/// `base/<rel>` (`rel` as [`inside`] gives it), its directories made: refused unless the
/// directory it lands in is `base` or under it once links and `..` are resolved.
fn under_dir(base: &Path, rel: &str) -> anyhow::Result<PathBuf> {
    let at = base.join(rel);
    let parent = at.parent().unwrap_or(base);
    std::fs::create_dir_all(parent)?;
    let (top, dir) = (base.canonicalize()?, parent.canonicalize()?);
    if !dir.starts_with(&top) {
        bail!("`{rel}` leaves the gap report's fixture: refused");
    }
    Ok(at)
}

/// The excerpts of what `cited` names (`file:line`), bounded.
fn cited_excerpts(root: &Path, cited: &[String]) -> Vec<Excerpt> {
    let mut out = Vec::new();
    for c in cited {
        if out.len() >= MAX_CITED_EXCERPTS {
            break;
        }
        let (file, line) = match c.rsplit_once(':') {
            Some((f, l)) => (
                f,
                l.split('-')
                    .next()
                    .and_then(|l| l.parse::<usize>().ok())
                    .unwrap_or(1),
            ),
            None => (c.as_str(), 1),
        };
        let Some(file) = inside(file) else { continue };
        let path = root.join(&file);
        if is_link(&path) || !path.is_file() {
            continue;
        }
        let lines = evidence::lines_of(root, &file);
        let at = line.saturating_sub(1);
        if let Some(e) = evidence::excerpt_of(
            "cited",
            &file,
            &lines,
            at.saturating_sub(BEFORE),
            at + AFTER,
        ) {
            out.push(e);
        }
    }
    out
}

// ---------- findings ----------

/// Write the finding for `item`: `.drift/findings/<id>.json` and `.md`. Its id and path.
pub fn write_finding(
    root: &Path,
    item: &Item,
    given: &Given,
    extra: &Extra,
) -> anyhow::Result<(String, String)> {
    if extra.patch.len() > MAX_PATCH {
        bail!("the patch is larger than {} KB", MAX_PATCH / 1024);
    }
    // One git cannot read is kept: `--branch` refuses it when it does not apply.
    if !extra.patch.trim().is_empty()
        && let Ok(touched) = patch_paths(root, &with_newline(&extra.patch))
    {
        refuse_policy_paths(&touched)?;
    }
    let row = |r: &RouteRow| format!("{} {}", r.route, r.handler);
    let (routes, routes_scope): (Vec<String>, &str) = if !extra.routes.is_empty() {
        // The routes the agent names.
        let named = item
            .routes
            .iter()
            .filter(|r| {
                extra
                    .routes
                    .iter()
                    .any(|w| r.route.contains(w.as_str()) || r.handler == *w)
            })
            .map(row)
            .collect();
        (named, "")
    } else {
        // The routes whose files the evidence names; with none, all the item's.
        let files: Vec<&str> = given
            .evidence
            .iter()
            .map(|c| {
                let c = c.trim().trim_start_matches("./");
                c.rsplit_once(':').map_or(c, |(f, _)| f)
            })
            .collect();
        let cited: Vec<String> = item
            .routes
            .iter()
            .filter(|r| {
                let file = r
                    .handler
                    .rsplit_once(':')
                    .map_or(r.handler.as_str(), |(f, _)| f);
                files.contains(&file)
            })
            .map(row)
            .collect();
        if cited.is_empty() {
            (item.routes.iter().map(row).collect(), "item")
        } else {
            (cited, "")
        }
    };
    if routes.is_empty() {
        bail!(
            "none of the routes given is one of {}'s (`drift investigate --json --item {}` lists them)",
            item.id,
            item.id
        );
    }
    let f = Finding {
        schema: FINDING_SCHEMA.into(),
        version: VERSION,
        id: id_for('F', &item.id),
        item: item.id.clone(),
        seen: item.evidence.clone(),
        title: bounded(&extra.title, MAX_TITLE),
        concern: item.concern.to_string(),
        drift_said: item.what.clone(),
        routes,
        routes_scope: routes_scope.into(),
        why: bounded(&given.reason, MAX_TEXT),
        fix: bounded(&extra.fix, MAX_TEXT),
        excerpts: cited_excerpts(root, &given.evidence),
        evidence: given.evidence.iter().take(20).cloned().collect(),
        patch: extra.patch.clone(),
        by: by_word(given.by).into(),
        on: today(),
    };
    let dir = local_dir(root, FINDINGS_DIR, true)?;
    write_file(
        &dir.join(format!("{}.json", f.id)),
        serde_json::to_string_pretty(&f)?.as_bytes(),
    )?;
    write_file(&dir.join(format!("{}.md", f.id)), markdown(&f).as_bytes())?;
    Ok((f.id.clone(), format!("{FINDINGS_DIR}/{}.md", f.id)))
}

/// Every finding written, by id. Nothing when the directory is missing or a link.
pub fn findings(root: &Path) -> Vec<Finding> {
    let Ok(dir) = local_dir(root, FINDINGS_DIR, false) else {
        return Vec::new();
    };
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<Finding> = rd
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .filter(|e| !is_link(&e.path()))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|t| serde_json::from_str::<Finding>(&t).ok())
        .filter(|f| f.schema == FINDING_SCHEMA)
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn code_block(e: &Excerpt) -> String {
    let fence = if e.text.contains("```") {
        "````"
    } else {
        "```"
    };
    format!("`{}:{}`\n\n{fence}\n{}\n{fence}\n", e.file, e.line, e.text)
}

/// The line under a finding's routes when they are all of its item's: the agent named
/// none and cited no route's file, so the list is the item's, not a claim about each.
fn routes_note(f: &Finding) -> String {
    if f.routes_scope == "item" {
        "\nThese are all the routes of the investigate item, not only ones the finding is about: the agent named none (`--routes`) and cited none of their files.\n".to_string()
    } else {
        String::new()
    }
}

/// The finding as its `.md` file reads.
pub fn markdown(f: &Finding) -> String {
    let mut out = format!(
        "# {}\n\nFinding {}, recorded by {} on {} with `drift investigate` (item {}). A local note: it is not posted anywhere.\n\n## Routes\n\n",
        f.title,
        f.id,
        if f.by == "agent" {
            "an agent"
        } else {
            "a person"
        },
        f.on,
        f.item
    );
    for r in &f.routes {
        out.push_str(&format!("- {r}\n"));
    }
    out.push_str(&routes_note(f));
    out.push_str(&format!(
        "\n## What Drift said\n\n{}\n\n## Why it is a gap\n\n{}\n\n## Suggested fix\n\n{}\n",
        f.drift_said, f.why, f.fix
    ));
    if !f.excerpts.is_empty() {
        out.push_str("\n## The code\n\n");
        for e in &f.excerpts {
            out.push_str(&code_block(e));
            out.push('\n');
        }
    }
    if !f.patch.is_empty() {
        out.push_str(&format!(
            "\n## A patch (written by the {}, not applied)\n\n```diff\n{}\n```\n",
            f.by,
            f.patch.trim_end()
        ));
    }
    out
}

/// An issue draft a person may post: what is wrong, where, why, and the fix.
pub fn issue(f: &Finding) -> String {
    let mut out = format!("# {}\n\n## Where\n\n", f.title);
    for r in &f.routes {
        out.push_str(&format!("- {r}\n"));
    }
    out.push_str(&routes_note(f));
    out.push_str(&format!("\n## What is wrong\n\n{}\n", f.why));
    if !f.excerpts.is_empty() {
        out.push_str("\n## The code\n\n");
        for e in &f.excerpts {
            out.push_str(&code_block(e));
            out.push('\n');
        }
    }
    out.push_str(&format!("\n## Suggested fix\n\n{}\n", f.fix));
    if !f.patch.is_empty() {
        out.push_str(&format!(
            "\nA patch is attached to the local finding (`drift findings --branch {}` makes a local branch of it).\n",
            f.id
        ));
    }
    out.push_str(&format!(
        "\n---\nDrafted from local finding {} (`drift investigate`, {}). Read it against the code before posting: it was written by {} and has not been reviewed.\n",
        f.id,
        f.on,
        if f.by == "agent" { "an agent" } else { "a person" }
    ));
    out
}

/// One finding by id.
pub fn finding(root: &Path, id: &str) -> anyhow::Result<Finding> {
    findings(root)
        .into_iter()
        .find(|f| f.id == id)
        .with_context(|| format!("no finding {id} in {FINDINGS_DIR} (`drift findings` lists them)"))
}

/// `drift findings`.
pub fn list_text(root: &Path) -> String {
    let all = findings(root);
    let gaps = gaps(root);
    let mut out = String::new();
    if all.is_empty() {
        out.push_str(&format!("No finding in {FINDINGS_DIR}.\n"));
    } else {
        out.push_str(&format!(
            "{} finding{} (local: {FINDINGS_DIR}, git-ignored, never posted):\n\n",
            all.len(),
            if all.len() == 1 { "" } else { "s" }
        ));
        for f in &all {
            out.push_str(&format!(
                "{} ({}, {} route{}, {} on {}): {}\n  {FINDINGS_DIR}/{}.md\n  Issue draft: drift findings --issue {}{}\n\n",
                f.id,
                f.concern,
                f.routes.len(),
                if f.routes.len() == 1 { "" } else { "s" },
                f.by,
                f.on,
                f.title,
                f.id,
                f.id,
                if f.patch.is_empty() {
                    String::new()
                } else {
                    format!("; local fix branch: drift findings --branch {}", f.id)
                }
            ));
        }
    }
    if !gaps.is_empty() {
        out.push_str(&format!(
            "{} gap report{} (local: {GAPS_DIR}, git-ignored, never sent): {}\n",
            gaps.len(),
            if gaps.len() == 1 { "" } else { "s" },
            gaps.iter()
                .map(|g| g.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    out
}

/// `drift findings --json`.
#[derive(Debug, Serialize)]
pub struct Listing {
    pub schema: &'static str,
    pub version: u32,
    pub findings: Vec<Finding>,
    pub gap_reports: Vec<GapReport>,
}

pub fn listing(root: &Path) -> Listing {
    Listing {
        schema: "drift-findings",
        version: VERSION,
        findings: findings(root),
        gap_reports: gaps(root),
    }
}

// ---------- a fix branch ----------

fn git(
    root: &Path,
    args: &[&str],
    index: Option<&Path>,
    input: Option<&str>,
) -> anyhow::Result<String> {
    let mut c = std::process::Command::new("git");
    c.arg("-C").arg(root).args(args);
    if let Some(i) = index {
        c.env("GIT_INDEX_FILE", i);
    }
    c.stdin(if input.is_some() {
        std::process::Stdio::piped()
    } else {
        std::process::Stdio::null()
    })
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());
    let mut child = c.spawn().context("running git")?;
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin.write_all(text.as_bytes())?;
    }
    let out = child.wait_with_output()?;
    if !out.status.success() {
        bail!(
            "git {}: {}",
            args.first().copied().unwrap_or_default(),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn with_newline(patch: &str) -> String {
    let mut p = patch.to_string();
    if !p.ends_with('\n') {
        p.push('\n');
    }
    p
}

/// The paths `patch` touches, as `git apply` reads them (renames on both sides).
fn patch_paths(root: &Path, patch: &str) -> anyhow::Result<Vec<String>> {
    let out = git(root, &["apply", "--numstat", "-z", "-"], None, Some(patch))?;
    // `added\tdeleted\tpath\0`, or `added\tdeleted\t\0from\0to\0` for a rename.
    Ok(out
        .split(['\0', '\t'])
        .filter(|p| !p.is_empty() && *p != "-" && !p.chars().all(|c| c.is_ascii_digit()))
        .map(str::to_string)
        .collect())
}

/// Refuse a patch that touches Drift's policy and state: `.drift/` (conventions, the
/// config a person's answers are in) and `drift.lock`, which people change, not a fix.
fn refuse_policy_paths(paths: &[String]) -> anyhow::Result<()> {
    if let Some(p) = paths.iter().find(|p| {
        p.split('/').any(|c| c.eq_ignore_ascii_case(".drift"))
            || p.rsplit('/')
                .next()
                .is_some_and(|f| f.eq_ignore_ascii_case(drift_mine::policy::LOCK_FILE))
    }) {
        bail!(
            "the patch changes `{p}`: Drift's policy and state (.drift/, drift.lock) are changed by people, never by a fix branch; take that part out of the patch"
        );
    }
    Ok(())
}

/// A local branch `drift/<id>` with the finding's patch committed on `HEAD`, made beside
/// the working tree: a throwaway index takes the patch, so the working tree, the index
/// and `HEAD` stay as they are. Never pushed. Refused when the finding has no patch, the
/// patch does not apply, or the branch exists.
pub fn branch(root: &Path, id: &str) -> anyhow::Result<String> {
    let f = finding(root, id)?;
    if f.patch.trim().is_empty() {
        bail!(
            "{id} carries no patch: only a fix the agent wrote can become a branch (`drift findings --issue {id}` drafts an issue instead)"
        );
    }
    let name = format!("drift/{}", f.id.to_lowercase());
    if git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{name}"),
        ],
        None,
        None,
    )
    .is_ok()
    {
        bail!("branch {name} exists: Drift does not replace it");
    }
    let head = git(root, &["rev-parse", "--verify", "HEAD"], None, None)?;
    let tmp = tempfile::tempdir()?;
    let index = tmp.path().join("index");
    git(root, &["read-tree", &head], Some(&index), None)?;
    let patch = with_newline(&f.patch);
    refuse_policy_paths(&patch_paths(root, &patch).context("the patch does not apply to HEAD")?)?;
    git(
        root,
        &["apply", "--cached", "--check", "-"],
        Some(&index),
        Some(&patch),
    )
    .context("the patch does not apply to HEAD")?;
    git(
        root,
        &["apply", "--cached", "-"],
        Some(&index),
        Some(&patch),
    )?;
    let tree = git(root, &["write-tree"], Some(&index), None)?;
    let message = format!(
        "{}\n\nA suggested fix for local finding {} (drift investigate), written by {} and not reviewed: read it before you merge it.\n",
        f.title,
        f.id,
        if f.by == "agent" {
            "an agent"
        } else {
            "a person"
        }
    );
    let commit = git(
        root,
        &["commit-tree", &tree, "-p", &head, "-F", "-"],
        None,
        Some(&message),
    )?;
    git(root, &["branch", &name, &commit], None, None)?;
    Ok(format!(
        "branch {name} made at {} on HEAD ({}): the working tree, the index and the current branch are as they were. Nothing was pushed.",
        &commit[..commit.len().min(12)],
        &head[..head.len().min(12)]
    ))
}

// ---------- gap reports ----------

/// The spellings of a name a gap report replaces: as given, lower, upper, and each with
/// `-` and `_` swapped.
const SPELLINGS: [fn(&str) -> String; 6] = [
    |s| s.to_string(),
    |s| s.to_lowercase(),
    |s| s.to_uppercase(),
    |s| s.replace('-', "_"),
    |s| s.replace('-', "_").to_uppercase(),
    |s| s.replace('_', "-"),
];

fn spellings(name: &str) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    for f in SPELLINGS {
        let s = f(name);
        if !v.contains(&s) {
            v.push(s);
        }
    }
    v
}

/// `text` with every marked name replaced, the longest first, each spelling by the same
/// spelling of its neutral name.
fn scrub(text: &str, names: &[(String, String)]) -> String {
    let mut out = text.to_string();
    for (from, to) in names {
        let mut done: Vec<String> = Vec::new();
        for f in SPELLINGS {
            let (a, b) = (f(from), f(to));
            if !a.is_empty() && !done.contains(&a) {
                out = out.replace(&a, &b);
                done.push(a);
            }
        }
    }
    out
}

/// The marked names still in `text` (in any case).
fn left_in<'a>(text: &str, names: &'a [(String, String)]) -> Vec<&'a str> {
    let lower = text.to_lowercase();
    names
        .iter()
        .filter(|(n, _)| {
            spellings(n)
                .iter()
                .any(|s| lower.contains(&s.to_lowercase()))
        })
        .map(|(n, _)| n.as_str())
        .collect()
}

/// What Drift says of the fixture at `dir` now: authentication, authorization and reach
/// of each entry point.
fn says(dir: &Path) -> Vec<String> {
    let opts = crate::scan::ScanOptions {
        cache_dir: None,
        threads: 0,
    };
    let Ok((facts, _)) = crate::scan::scan(dir, &opts) else {
        return vec!["Drift could not read the fixture.".into()];
    };
    let mut out = Vec::new();
    let map = drift_mine::practices::practices(
        &facts,
        &drift_mine::practices::Options {
            units: true,
            ..crate::practices::options(dir, &facts, drift_mine::practices::Scope::default())
        },
    );
    for c in map
        .concerns
        .iter()
        .filter(|c| c.id == "authn" || c.id == "authz")
    {
        for u in c.units.iter().take(15) {
            let what = match (&u.method, &u.route) {
                (Some(m), Some(r)) => format!("{m} {r}"),
                (None, Some(r)) => r.clone(),
                _ => u.symbol.clone(),
            };
            let why = u
                .reason
                .and_then(|r| serde_json::to_value(r).ok())
                .and_then(|v| v.as_str().map(str::to_string))
                .map_or_else(String::new, |r| format!(" ({r})"));
            out.push(format!(
                "{} of `{what}` ({}:{}): {}{why}",
                c.id, u.path, u.line, u.assignment
            ));
        }
    }
    let inv =
        drift_mine::security::inventory_with(&facts, drift_mine::security::Boundaries::load(dir));
    for e in inv.entry_points.iter().filter(|e| !e.local).take(15) {
        let what = match (&e.method, &e.route) {
            (Some(m), Some(r)) => format!("{m} {r}"),
            (None, Some(r)) => r.clone(),
            _ => e.symbol.clone(),
        };
        let reach = match e.exposure {
            drift_mine::security::Exposure::Public => "reachable from the internet",
            drift_mine::security::Exposure::Unknown => "unknown",
            drift_mine::security::Exposure::Internal => "reachable only from inside",
        };
        out.push(format!(
            "reach of `{what}` ({}:{}): {reach}",
            e.path, e.line
        ));
    }
    if out.is_empty() {
        out.push(
            "Drift finds no entry point in the fixture: it does not reproduce a route yet.".into(),
        );
    }
    out
}

/// Write a gap report for `item`: `.drift/gap-reports/<id>/` with `fixture/` (the files,
/// names replaced), `expect.md` and `gap.json`. Its id, path, and what Drift says of the
/// fixture now in one sentence.
pub fn write_gap(
    root: &Path,
    item: &Item,
    given: &Given,
    extra: &Extra,
) -> anyhow::Result<(String, String, String)> {
    if extra.files.is_empty() {
        bail!(
            "a gap report needs the files of a minimal example that reproduces the construct (`files`: path -> content), with what the right answer is (`expect`) and the repository's names to replace (`replace`: name -> neutral name)"
        );
    }
    if extra.expect.trim().is_empty() {
        bail!("a gap report needs `expect`: what Drift should answer, and why");
    }
    if extra.files.len() > MAX_GAP_FILES {
        bail!(
            "a gap report holds at most {MAX_GAP_FILES} files: keep only what reproduces the construct"
        );
    }
    let total: usize = extra.files.values().map(String::len).sum();
    if total > MAX_GAP_BYTES || extra.files.values().any(|c| c.len() > MAX_GAP_FILE) {
        bail!(
            "a gap report's files are at most {} KB each and {} KB in all: keep only what reproduces the construct",
            MAX_GAP_FILE / 1024,
            MAX_GAP_BYTES / 1024
        );
    }
    // The names to replace, the longest first; the repository's own folder name too.
    let mut names: Vec<(String, String)> = extra
        .replace
        .iter()
        .filter(|(k, _)| !k.trim().is_empty())
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    if let Some(own) = root
        .canonicalize()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .filter(|n| n.len() > 2 && !names.iter().any(|(k, _)| k == n))
    {
        names.push((own, "example-repo".into()));
    }
    names.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));
    // A neutral name that holds the name it replaces would leave it in; one that holds
    // a path separator or `..` would move a file out of the fixture.
    if let Some((k, v)) = names
        .iter()
        .find(|(k, v)| v.is_empty() || v.to_lowercase().contains(&k.to_lowercase()))
    {
        bail!("`{k}` is replaced by `{v}`, which is not a neutral name");
    }
    if let Some((k, v)) = names.iter().find(|(_, v)| {
        v.contains(['/', '\\', '\0']) || v.contains("..") || Path::new(v).is_absolute()
    }) {
        bail!("`{k}` is replaced by `{v}`: a neutral name holds no `/`, `\\` or `..`");
    }
    let mut files: BTreeMap<String, String> = BTreeMap::new();
    for (path, content) in &extra.files {
        // Checked again once the names are replaced: that is the path written.
        let Some(p) = inside(path).and_then(|p| inside(&scrub(&p, &names))) else {
            bail!("`{path}`: a gap report's file path is relative and stays inside it");
        };
        files.insert(p, scrub(content, &names));
    }
    let expect = bounded(&scrub(&extra.expect, &names), MAX_TEXT);
    let why = bounded(&scrub(&given.reason, &names), MAX_TEXT);
    let drift_said = format!(
        "{} {}: {}",
        item.concern,
        if item.kind == ItemKind::NothingFound {
            "none"
        } else {
            "unknown"
        },
        item.not_read.reason
    );
    // Nothing marked may remain.
    let mut left: Vec<&str> = Vec::new();
    for (p, c) in &files {
        left.extend(left_in(p, &names));
        left.extend(left_in(c, &names));
    }
    left.extend(left_in(&expect, &names));
    left.extend(left_in(&why, &names));
    left.sort();
    left.dedup();
    if !left.is_empty() {
        bail!(
            "the gap report still holds {}: mark every spelling of it in `replace`",
            left.iter()
                .map(|n| format!("`{n}`"))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    let id = id_for('G', &item.id);
    let base = local_dir(root, GAPS_DIR, true)?;
    let dir = base.join(&id);
    if is_link(&dir) {
        bail!("{} is a symbolic link: refused", dir.display());
    }
    if dir.exists() {
        std::fs::remove_dir_all(&dir).with_context(|| format!("replacing {}", dir.display()))?;
    }
    let fixture = dir.join("fixture");
    std::fs::create_dir_all(&fixture)?;
    for (p, c) in &files {
        write_file(&under_dir(&fixture, p)?, c.as_bytes())?;
    }
    // Read from a copy outside the repository: under `.drift/gap-reports/` the
    // `.gitignore` of `*` keeps every file of the fixture from the walk.
    let says = {
        let copy = tempfile::tempdir()?;
        for (p, c) in &files {
            write_file(&under_dir(copy.path(), p)?, c.as_bytes())?;
        }
        says(copy.path())
    };
    let report = GapReport {
        schema: GAP_SCHEMA.into(),
        version: VERSION,
        id: id.clone(),
        item: item.id.clone(),
        seen: item.evidence.clone(),
        drift_said,
        expect,
        why,
        files: files.keys().cloned().collect(),
        says,
        drift: env!("CARGO_PKG_VERSION").into(),
        by: by_word(given.by).into(),
        on: today(),
    };
    write_file(
        &dir.join("gap.json"),
        serde_json::to_string_pretty(&report)?.as_bytes(),
    )?;
    write_file(&dir.join("expect.md"), expect_md(&report).as_bytes())?;
    let said = report.says.first().cloned().unwrap_or_default();
    Ok((
        id.clone(),
        format!("{GAPS_DIR}/{id}/"),
        format!(
            "Drift says of the fixture now: {}.",
            said.trim_end_matches('.')
        ),
    ))
}

/// `expect.md`: what the fixture reproduces, what Drift says of it now, and what is right.
pub fn expect_md(g: &GapReport) -> String {
    let mut out = format!(
        "# A construct Drift does not read\n\nGap report {}, written on {} by {}. The files under `fixture/` are a minimal, self-contained example of it, with the names of the repository it came from replaced. Nothing was sent: a person may choose to send this directory to Drift's maintainers.\n\nIn the repository, Drift answered {}.\n\n## What Drift {} says of the fixture now\n\n",
        g.id,
        g.on,
        if g.by == "agent" {
            "an agent"
        } else {
            "a person"
        },
        g.drift_said,
        g.drift
    );
    for s in &g.says {
        out.push_str(&format!("- {s}\n"));
    }
    out.push_str(&format!(
        "\n## What the right answer is\n\n{}\n\n## Why\n\n{}\n\n## Files\n\n",
        g.expect, g.why
    ));
    for f in &g.files {
        out.push_str(&format!("- `fixture/{f}`\n"));
    }
    out
}

/// Every gap report written, by id.
pub fn gaps(root: &Path) -> Vec<GapReport> {
    let Ok(dir) = local_dir(root, GAPS_DIR, false) else {
        return Vec::new();
    };
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<GapReport> = rd
        .flatten()
        .filter(|e| !is_link(&e.path()) && e.path().is_dir())
        .filter_map(|e| std::fs::read_to_string(e.path().join("gap.json")).ok())
        .filter_map(|t| serde_json::from_str::<GapReport>(&t).ok())
        .filter(|g| g.schema == GAP_SCHEMA)
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_replaced_in_every_spelling() {
        let names = vec![("ledger-svc".to_string(), "svc-a".to_string())];
        let t = "ledger-svc ledger_svc LEDGER_SVC Ledger-Svc";
        let s = scrub(t, &names);
        assert_eq!(s, "svc-a svc_a SVC_A Ledger-Svc");
        // A spelling not marked is caught, never let through.
        assert_eq!(left_in(&s, &names), vec!["ledger-svc"]);
        assert!(left_in("svc-a svc_a", &names).is_empty());
    }

    #[test]
    fn a_path_stays_inside() {
        assert_eq!(inside("./a//b.py").as_deref(), Some("a/b.py"));
        assert_eq!(inside("../x"), None);
        assert_eq!(inside("/etc/passwd"), None);
        assert_eq!(inside("a/../../x"), None);
    }
}
