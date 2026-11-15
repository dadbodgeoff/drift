//! Git history for co-change rules, and the key files those rules compare.
//!
//! History is read over `HEAD` resolved to a commit id, in two steps: the files
//! each of the newest [`WALK`] commits changed (`--name-only`, cheap), then the
//! patches of at most [`cochange::WINDOW`] of them that touched a key file, for
//! those files only (literal pathspecs). Merges are left out and renames are off.
//! The same commit always gives the same rules.
//!
//! Every git call is bounded: a wall-clock timeout ([`GIT_TIMEOUT`], the process
//! is killed) and a cap on output ([`MAX_LOG_BYTES`], read through a pipe). Output
//! does not depend on user or system git config: the settings that change `log -p`
//! are pinned on the command line, replace refs are ignored, and no lock is taken.
//!
//! A shallow clone, a partial clone, a missing git, a failed, slow or oversized
//! read gives no rules and says why ([`HistoryStatus`]). Git never fetches:
//! `GIT_NO_LAZY_FETCH` keeps a partial clone off the network, and a partial clone
//! is not read at all.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Component, Path};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use drift_core::{KeyFile, RepoFacts};
use drift_mine::cochange::{self, History, HistoryStatus};
use drift_mine::mine::Rule;
use drift_mine::policy::{ConventionsFile, Status};

/// Largest key file read.
const MAX_KEY_FILE_BYTES: u64 = 1 << 20;
/// Most commits walked back from `HEAD` to find key-file commits.
pub const WALK: usize = 5000;
/// Longest any one git call may run.
pub const GIT_TIMEOUT: Duration = Duration::from_secs(10);
/// Most bytes of `git log -p` read; more is `too_large`.
pub const MAX_LOG_BYTES: usize = 32 << 20;
/// Most bytes of any other git call's output.
const MAX_SMALL_BYTES: usize = 1 << 20;

/// Git settings that would change what `log -p` prints, pinned.
const PINNED: &[&str] = &[
    "core.quotePath=false",
    "core.fsmonitor=false",
    "core.pager=cat",
    "color.ui=never",
    "diff.algorithm=myers",
    "diff.renames=false",
    "diff.relative=false",
    "diff.noprefix=false",
    "diff.mnemonicPrefix=false",
    "log.showSignature=false",
    "log.decorate=false",
    "log.follow=false",
    "log.showRoot=true",
];

/// Why a git call gave nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitError {
    /// Not run, or exited with an error.
    Failed,
    Timeout,
    TooLarge,
}

/// Run `cmd`, reading at most `cap` bytes of stdout, for at most `timeout`.
pub fn run_bounded(mut cmd: Command, timeout: Duration, cap: usize) -> Result<Vec<u8>, GitError> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| GitError::Failed)?;
    let mut stdout = child.stdout.take().ok_or(GitError::Failed)?;
    // Read on a thread so a full pipe never stalls the child, and a stalled child
    // never stalls us.
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 64 * 1024];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => return (buf, false),
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    if buf.len() > cap {
                        return (buf, true);
                    }
                }
            }
        }
    });
    let deadline = Instant::now() + timeout;
    let mut reader = Some(reader);
    let mut out: Option<(Vec<u8>, bool)> = None;
    let stop = |child: &mut std::process::Child| {
        let _ = child.kill();
        let _ = child.wait();
    };
    loop {
        // The reader ends when the child closes its stdout, which can be just
        // before it exits: then wait for the exit, unless the output is over the cap.
        if reader.as_ref().is_some_and(|r| r.is_finished()) {
            let joined = reader.take().map(|r| r.join());
            match joined {
                Some(Ok((buf, over))) => {
                    if over {
                        stop(&mut child);
                        return Err(GitError::TooLarge);
                    }
                    out = Some((buf, over));
                }
                _ => {
                    stop(&mut child);
                    return Err(GitError::Failed);
                }
            }
        }
        match child.try_wait() {
            Ok(Some(st)) => {
                let (buf, over) = match out.take() {
                    Some(o) => o,
                    // Exited first: the reader sees the end of the pipe next.
                    None => reader
                        .take()
                        .map(|r| r.join())
                        .and_then(Result::ok)
                        .ok_or(GitError::Failed)?,
                };
                if over {
                    return Err(GitError::TooLarge);
                }
                return if st.success() {
                    Ok(buf)
                } else {
                    Err(GitError::Failed)
                };
            }
            Ok(None) if Instant::now() >= deadline => {
                stop(&mut child);
                if let Some(r) = reader.take() {
                    let _ = r.join();
                }
                return Err(GitError::Timeout);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
            Err(_) => {
                stop(&mut child);
                return Err(GitError::Failed);
            }
        }
    }
}

fn git_cmd(root: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root);
    for c in PINNED {
        cmd.args(["-c", c]);
    }
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .env_remove("GIT_EXTERNAL_DIFF")
        .env_remove("GIT_DIFF_OPTS")
        .env_remove("GIT_PAGER");
    cmd
}

fn git(root: &Path, args: &[&str]) -> Option<Vec<u8>> {
    run_bounded(git_cmd(root, args), GIT_TIMEOUT, MAX_SMALL_BYTES).ok()
}

/// Step 1: the files each of the newest [`WALK`] commits from `head` changed
/// (stopping at `stop`, the commit just past the walk, when history is longer).
pub fn names_args(head: &str, stop: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = [
        "log",
        "--no-merges",
        "--no-renames",
        "--relative",
        "--format=%x00%H",
        "--name-only",
        head,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if let Some(stop) = stop {
        args.push(format!("^{stop}"));
    }
    args
}

/// The commits of a `--name-only` listing that touched a key file, newest first,
/// at most [`cochange::WINDOW`], and the key files they touched.
pub fn select_commits(out: &[u8]) -> (Vec<String>, BTreeSet<String>) {
    let text = String::from_utf8_lossy(out);
    let mut ids = Vec::new();
    let mut paths = BTreeSet::new();
    let mut current: Option<&str> = None;
    let mut hit = false;
    for line in text.split('\n') {
        if let Some(id) = line.strip_prefix('\0') {
            if hit && let Some(c) = current {
                ids.push(c.to_string());
            }
            if ids.len() >= cochange::WINDOW {
                current = None;
                break;
            }
            current = Some(id.trim());
            hit = false;
        } else if current.is_some() && cochange::key_class(line.trim_end()).is_some() {
            paths.insert(line.trim_end().to_string());
            hit = true;
        }
    }
    if hit
        && let Some(c) = current
        && ids.len() < cochange::WINDOW
    {
        ids.push(c.to_string());
    }
    (ids, paths)
}

/// Step 2: the patches of exactly those commits, for exactly those files
/// (literal pathspecs: no glob work, no pathspec magic from file names).
pub fn patch_args(ids: &[String], paths: &BTreeSet<String>) -> Vec<String> {
    let mut args: Vec<String> = [
        "log",
        "--no-walk=unsorted",
        "--no-renames",
        "--relative",
        "--format=%x00%H",
        "-p",
        "--unified=0",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.extend(ids.iter().cloned());
    args.push("--".into());
    args.extend(paths.iter().map(|p| format!(":(literal){p}")));
    args
}

/// Read the key-file history of the repository at `root`.
pub fn read(root: &Path) -> (HistoryStatus, Option<History>) {
    let inside = git(root, &["rev-parse", "--is-inside-work-tree"]);
    if inside
        .as_deref()
        .map(|o| String::from_utf8_lossy(o).trim() == "true")
        != Some(true)
    {
        return (HistoryStatus::NoGit, None);
    }
    // Fails closed: when git cannot say whether the clone is shallow, nothing is read.
    let Some(shallow) = git(root, &["rev-parse", "--is-shallow-repository"]) else {
        return (HistoryStatus::Failed, None);
    };
    if String::from_utf8_lossy(&shallow).trim() == "true" {
        return (HistoryStatus::Shallow, None);
    }
    // A partial clone (`--filter=blob:none`) lacks the old blobs a patch needs, and
    // git before 2.44 would fetch them from the network: treat it like a shallow one.
    let set =
        |o: Option<Vec<u8>>| o.is_some_and(|o| !String::from_utf8_lossy(&o).trim().is_empty());
    let promisor =
        git(root, &["config", "--get-regexp", r"^remote\..*\.promisor$"]).is_some_and(|o| {
            String::from_utf8_lossy(&o)
                .lines()
                .any(|l| l.ends_with(" true"))
        });
    if promisor || set(git(root, &["config", "--get", "extensions.partialclone"])) {
        return (HistoryStatus::Partial, None);
    }
    let Some(head) = git(root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]) else {
        return (HistoryStatus::NoGit, None);
    };
    let head = String::from_utf8_lossy(&head).trim().to_string();
    // The WALKth commit back bounds the walk (`git log` with a pathspec would
    // otherwise read the whole history to find its matches).
    let skip = format!("--skip={}", WALK);
    let stop = git(root, &["rev-list", "--max-count=1", &skip, &head])
        .map(|o| String::from_utf8_lossy(&o).trim().to_string())
        .filter(|s| !s.is_empty());
    let status = |e: GitError| match e {
        GitError::Timeout => HistoryStatus::Timeout,
        GitError::TooLarge => HistoryStatus::TooLarge,
        GitError::Failed => HistoryStatus::Failed,
    };
    let names = names_args(&head, stop.as_deref());
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    let listing = match run_bounded(git_cmd(root, &names), GIT_TIMEOUT, MAX_LOG_BYTES) {
        Ok(out) => out,
        Err(e) => return (status(e), None),
    };
    let (ids, paths) = select_commits(&listing);
    if ids.is_empty() {
        return (
            HistoryStatus::Read,
            Some(History {
                commits: vec![],
                head,
            }),
        );
    }
    let args = patch_args(&ids, &paths);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match run_bounded(git_cmd(root, &args), GIT_TIMEOUT, MAX_LOG_BYTES) {
        Ok(out) => (
            HistoryStatus::Read,
            Some(History {
                commits: cochange::parse_log(&out),
                head,
            }),
        ),
        Err(e) => (status(e), None),
    }
}

/// A repo-relative path that stays inside the repository: no `..`, not absolute.
fn safe_rel(rel: &str) -> bool {
    !rel.is_empty()
        && Path::new(rel)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

/// The key file at `root/rel` as it is now, when it is a regular file (never
/// through a link) of reasonable size.
pub fn key_file(root: &Path, rel: &str) -> Option<KeyFile> {
    if !safe_rel(rel) {
        return None;
    }
    let mut p = root.to_path_buf();
    for part in rel.split('/') {
        p.push(part);
        if std::fs::symlink_metadata(&p).ok()?.file_type().is_symlink() {
            return None;
        }
    }
    let meta = std::fs::metadata(&p).ok()?;
    if !meta.is_file() || meta.len() > MAX_KEY_FILE_BYTES {
        return None;
    }
    let text = std::fs::read_to_string(&p).ok()?;
    cochange::key_file(rel, &text)
}

/// The key files history mentions, as they are now.
pub fn current_key_files(root: &Path, h: &History) -> Vec<KeyFile> {
    let paths: BTreeSet<&str> = h
        .commits
        .iter()
        .flat_map(|c| c.added.keys().map(String::as_str))
        .collect();
    paths
        .into_iter()
        .filter_map(|p| key_file(root, p))
        .collect()
}

/// Read the key files that `policy`'s co-change rules compare (rejected ones
/// aside) into `facts`, so `check` can evaluate them. A no-op without such rules.
pub fn attach_key_files(root: &Path, policy: &ConventionsFile, facts: &mut RepoFacts) {
    let paths: BTreeSet<&str> = policy
        .conventions
        .iter()
        .filter(|c| c.status != Status::Rejected)
        .flat_map(|c| match &c.rule {
            Rule::MirrorsKeys { from, to } => vec![from.as_str(), to.as_str()],
            _ => vec![],
        })
        .collect();
    if paths.is_empty() {
        return;
    }
    facts
        .key_files
        .extend(paths.into_iter().filter_map(|p| key_file(root, p)));
    facts.key_files.sort();
    facts.key_files.dedup_by(|a, b| a.path == b.path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_is_capped_and_bounded() {
        let a = names_args("abc", Some("def"));
        assert!(
            a.contains(&"^def".to_string()),
            "the walk stops past the WALKth commit"
        );
        assert!(!names_args("abc", None).iter().any(|x| x.starts_with('^')));
        // 600 key-file commits listed: only the newest WINDOW (500) are read.
        let mut out = String::new();
        for i in 0..600 {
            out.push_str(&format!("\0c{i}\n\n.env.example\nsrc/a.ts\n"));
            out.push_str(&format!("\0n{i}\n\nsrc/b.ts\n"));
        }
        let (ids, paths) = select_commits(out.as_bytes());
        assert_eq!(ids.len(), cochange::WINDOW);
        assert_eq!(cochange::WINDOW, 500);
        assert_eq!(ids[0], "c0");
        assert_eq!(ids[499], "c499");
        assert_eq!(paths.into_iter().collect::<Vec<_>>(), [".env.example"]);
        let p = patch_args(&ids, &[".env.example".to_string()].into());
        assert!(p.contains(&":(literal).env.example".to_string()));
        assert!(p.contains(&"--no-walk=unsorted".to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn slow_and_large_commands_are_cut_off() {
        let mut sleep = Command::new("sleep");
        sleep.arg("5");
        let t = Instant::now();
        assert_eq!(
            run_bounded(sleep, Duration::from_millis(200), 1024),
            Err(GitError::Timeout)
        );
        assert!(t.elapsed() < Duration::from_secs(2));
        let mut yes = Command::new("yes");
        yes.arg("x");
        assert_eq!(
            run_bounded(yes, Duration::from_secs(5), 4096),
            Err(GitError::TooLarge)
        );
        // Closes stdout, then exits a little later: a success, not a kill.
        let mut late = Command::new("sh");
        late.args(["-c", "echo ok; exec >&-; sleep 0.3; exit 0"]);
        assert_eq!(
            run_bounded(late, Duration::from_secs(5), 4096),
            Ok(b"ok\n".to_vec())
        );
        let mut fail = Command::new("sh");
        fail.args(["-c", "echo no; exit 3"]);
        assert_eq!(
            run_bounded(fail, Duration::from_secs(5), 4096),
            Err(GitError::Failed)
        );
        let mut echo = Command::new("echo");
        echo.arg("ok");
        assert_eq!(
            run_bounded(echo, Duration::from_secs(5), 4096),
            Ok(b"ok\n".to_vec())
        );
    }

    #[test]
    fn only_paths_inside() {
        assert!(safe_rel("apps/web/.env.example"));
        assert!(!safe_rel("../x/.env"));
        assert!(!safe_rel("/etc/passwd"));
        assert!(!safe_rel("a/../../b"));
        assert!(!safe_rel(""));
    }
}
