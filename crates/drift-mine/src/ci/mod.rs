//! What the pipelines of CI systems other than GitHub Actions do with what an
//! outsider controls, read into the findings [`crate::workflows`] makes of a GitHub
//! workflow, of the same kinds where the risk is the same and of none where it is
//! not:
//!
//! - GitLab CI (`.gitlab-ci.yml` and the files it includes from the repository,
//!   [`gitlab`]);
//! - CircleCI (`.circleci/config.yml`, [`circleci`]);
//! - Azure Pipelines (`azure-pipelines.yml`, `.azure-pipelines/*.yml`, [`azure`]);
//! - Bitbucket Pipelines (`bitbucket-pipelines.yml`, [`bitbucket`]);
//! - a `Jenkinsfile`, of which only what can be read soundly is read ([`jenkins`]).
//!
//! A file that is too large, not text, or does not parse is listed as not read
//! ([`NotRead`]), so that what its jobs run is unknown and said to be, never read as
//! nothing. Anchors, aliases and merge keys are resolved by the YAML parser, as for a
//! GitHub workflow.
//!
//! Each system's pipelines run with variables the project gives every job (GitLab
//! CI/CD variables, CircleCI project variables, Bitbucket repository variables) that
//! the file never names: so where a GitHub job holds a secret only when it reads one,
//! code of another owner a pipeline runs (an include, an orb, a pipe) is read as
//! where the secrets are.

use std::path::Path;

use serde::Serialize;

use crate::workflows::WorkflowFinding;

mod azure;
mod bitbucket;
mod circleci;
mod gitlab;
mod jenkins;

/// The largest pipeline file read.
const MAX_BYTES: u64 = 512 * 1024;

/// A CI file that was not read, or was read only in part, and why: what its jobs
/// run is unknown.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct NotRead {
    pub path: String,
    /// Drift's own words; repository text in them is sanitised
    /// ([`crate::report::sanitize`]), so it is shown as it is.
    pub why: String,
}

impl NotRead {
    /// A file that does not parse as YAML.
    pub(crate) fn unparsed(path: &str) -> NotRead {
        NotRead {
            path: path.to_string(),
            why: "does not parse as YAML".to_string(),
        }
    }
}

/// What the repository's CI files say ([`read`]).
#[derive(Debug, Clone, Default)]
pub struct Read {
    /// Sorted.
    pub findings: Vec<WorkflowFinding>,
    /// Sorted.
    pub not_read: Vec<NotRead>,
}

/// Every CI file of the repository at `root`, read: GitHub's workflows
/// ([`crate::workflows`]) and the pipelines of the systems this module reads.
pub fn read(root: &Path) -> Read {
    let (findings, not_read) = crate::workflows::read_all(root);
    let mut out = Read { findings, not_read };
    gitlab::read(root, &mut out);
    circleci::read(root, &mut out);
    azure::read(root, &mut out);
    bitbucket::read(root, &mut out);
    jenkins::read(root, &mut out);
    out.findings.sort();
    out.findings.dedup();
    out.not_read.sort();
    out.not_read.dedup();
    out
}

/// Fills the inventory's CI findings and the CI files it could not read, from the
/// repository at `root`.
pub fn fill(inv: &mut crate::security::Inventory, root: &Path) {
    let read = read(root);
    inv.workflows = read.findings;
    inv.ci_not_read = read.not_read;
}

/// The text of the file at `path` (shown as `rel`), or `None` with why it was not
/// read pushed to `not_read`. A path that is no file is `None`, and nothing is said.
pub(crate) fn load_file(path: &Path, rel: &str, not_read: &mut Vec<NotRead>) -> Option<String> {
    let meta = std::fs::metadata(path).ok().filter(|m| m.is_file())?;
    if meta.len() > MAX_BYTES {
        not_read.push(NotRead {
            path: rel.to_string(),
            why: "larger than 512 KiB".to_string(),
        });
        return None;
    }
    match std::fs::read_to_string(path) {
        Ok(text) => Some(text),
        Err(_) => {
            not_read.push(NotRead {
                path: rel.to_string(),
                why: "not UTF-8 text".to_string(),
            });
            None
        }
    }
}

impl Read {
    /// [`load_file`] of `rel` under `root`.
    fn load(&mut self, root: &Path, rel: &str) -> Option<String> {
        load_file(&root.join(rel), rel, &mut self.not_read)
    }

    /// The YAML document of `text`, or `None` with the file said not read. An empty
    /// file is `None`, and nothing is said: it runs nothing.
    fn yaml(&mut self, rel: &str, text: &str) -> Option<serde_json::Value> {
        if text.trim().is_empty() {
            return None;
        }
        match serde_saphyr::from_str::<serde_json::Value>(text) {
            Ok(v) => Some(v),
            Err(_) => {
                self.not_read.push(NotRead::unparsed(rel));
                None
            }
        }
    }

    fn not_read(&mut self, path: &str, why: String) {
        self.not_read.push(NotRead {
            path: path.to_string(),
            why,
        });
    }

    /// Adds the findings of one pipeline (one file, or files read as one): sorted,
    /// the same written twice in a job kept apart ([`crate::workflows::number_repeats`]).
    fn add(&mut self, mut found: Vec<WorkflowFinding>) {
        found.sort();
        found.dedup();
        crate::workflows::number_repeats(&mut found);
        self.findings.extend(found);
    }
}

/// A finding of a pipeline (`own_owner` is GitHub's alone).
fn finding(kind: &str, path: &str, line: u32, job: &str, detail: &str) -> WorkflowFinding {
    WorkflowFinding {
        kind: kind.to_string(),
        path: path.to_string(),
        line,
        job: job.to_string(),
        detail: detail.chars().take(160).collect(),
        own_owner: false,
    }
}

/// The 1-based line of the first line of `text`, at the 0-based line `from` or after
/// it, that holds the first line of `needle`; else the first anywhere; else 1.
fn line_at(text: &str, from: usize, needle: &str) -> u32 {
    crate::workflows::line_from(text, from, needle)
        .map_or_else(|| crate::workflows::line_of(text, needle), |i| i as u32 + 1)
}

fn indent(l: &str) -> usize {
    l.len() - l.trim_start().len()
}

/// Whether the trimmed line `l` opens the mapping key `key` (plain or quoted).
fn opens_key(l: &str, key: &str) -> bool {
    [
        format!("{key}:"),
        format!("\"{key}\":"),
        format!("'{key}':"),
    ]
    .iter()
    .any(|h| l.starts_with(h.as_str()))
}

/// The 0-based index of the line that opens the key `key` under the top-level
/// `section:`: a key at the indentation of the section's first key. The section's
/// line where it is not found; 0 where there is no such section.
pub(crate) fn key_under(text: &str, section: &str, key: &str) -> usize {
    let lines: Vec<&str> = text.lines().collect();
    let head = format!("{section}:");
    let Some(at) = lines.iter().position(|l| l.starts_with(head.as_str())) else {
        return 0;
    };
    let Some(first) = lines[at + 1..]
        .iter()
        .find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
        .map(|l| indent(l))
        .filter(|i| *i > 0)
    else {
        return at;
    };
    lines[at + 1..]
        .iter()
        .position(|l| indent(l) == first && opens_key(l.trim_start(), key))
        .map_or(at, |i| at + 1 + i)
}

/// The 0-based index of the line that opens the top-level key `key`; 0 where none.
fn top_key(text: &str, key: &str) -> usize {
    text.lines()
        .position(|l| indent(l) == 0 && opens_key(l, key))
        .unwrap_or(0)
}

/// The strings of a script as YAML writes one: a string, or a list of them, nested
/// lists flattened (GitLab and Bitbucket flatten a list an alias puts in a list).
fn script_lines(v: &serde_json::Value) -> Vec<&str> {
    fn walk<'a>(v: &'a serde_json::Value, depth: usize, out: &mut Vec<&'a str>) {
        match v {
            serde_json::Value::String(s) => out.push(s),
            serde_json::Value::Array(a) if depth < 10 => {
                for x in a {
                    walk(x, depth + 1, out);
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(v, 0, &mut out);
    out
}

/// A commit named in full: 40 hexadecimal digits (or 64, a SHA-256 repository's).
fn is_commit(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Shells that run the command string given after `-c`.
const SHELLS: &[&str] = &["sh", "bash", "zsh", "dash", "ksh"];

/// The commands of one shell line: split at `;`, `|`, `&` (and `&&`, `||`) written
/// outside quotes.
fn commands(line: &str) -> Vec<(usize, &str)> {
    let b = line.as_bytes();
    let (mut single, mut double, mut escaped) = (false, false, false);
    let mut out = Vec::new();
    let (mut start, mut i) = (0, 0);
    while i < b.len() {
        let c = b[i];
        if escaped {
            escaped = false;
        } else if c == b'\\' && !single {
            escaped = true;
        } else if c == b'\'' && !double {
            single = !single;
        } else if c == b'"' && !single {
            double = !double;
        } else if matches!(c, b';' | b'|' | b'&') && !single && !double {
            out.push((start, &line[start..i]));
            let mut j = i + 1;
            while j < b.len() && matches!(b[j], b'|' | b'&') {
                j += 1;
            }
            start = j;
            i = j;
            continue;
        }
        i += 1;
    }
    out.push((start, &line[start..]));
    out
}

/// The variables a shell command expands, with where (a byte offset) and how each is
/// quoted: `$NAME` and `${NAME...}`, outside single quotes and not escaped.
/// (in double quotes, offset, name).
fn expansions(command: &str) -> Vec<(bool, usize, &str)> {
    let b = command.as_bytes();
    let (mut single, mut double, mut escaped) = (false, false, false);
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if escaped {
            escaped = false;
        } else if c == b'\\' && !single {
            escaped = true;
        } else if c == b'\'' && !double {
            single = !single;
        } else if c == b'"' && !single {
            double = !double;
        } else if c == b'$' && !single {
            let braced = b.get(i + 1) == Some(&b'{');
            let start = i + 1 + usize::from(braced);
            let end = command[start..]
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .map_or(command.len(), |e| start + e);
            if end > start {
                out.push((double, i, &command[start..end]));
            }
        }
        i += 1;
    }
    out
}

/// The variables of `names` a shell script expands where a second shell then parses
/// the value as code, with the line each is on: in what `eval` is given (not in
/// single quotes), or in the double-quoted command string of `sh -c`. A variable the
/// shell expands only as an argument (`echo "$X"`, `echo $X`) is a value, not
/// script: the shell does not read what a value holds as commands.
fn reparsed<'a, 's>(script: &'s str, names: &[&'a str]) -> Vec<(&'a str, &'s str)> {
    let mut out = Vec::new();
    for line in script.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        for (_, command) in commands(line) {
            let program = crate::workflows::program(command);
            // Each word with its offset in the command.
            let words = || {
                command
                    .split_whitespace()
                    .map(|w| (w.as_ptr() as usize - command.as_ptr() as usize, w))
            };
            let from = if program == "eval" {
                words().find(|(_, w)| *w == "eval").map(|(at, _)| at)
            } else if SHELLS.contains(&program) {
                words()
                    .find(|(_, w)| {
                        w.len() > 1
                            && w.starts_with('-')
                            && w[1..].chars().all(|c| c.is_ascii_alphabetic())
                            && w.contains('c')
                    })
                    .map(|(at, _)| at)
            } else {
                None
            };
            let Some(from) = from else { continue };
            for (double, at, name) in expansions(command) {
                if at <= from || (program != "eval" && !double) {
                    continue;
                }
                if let Some(n) = names.iter().find(|n| **n == name) {
                    out.push((*n, line));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_variable_is_script_only_where_a_second_shell_parses_it() {
        let names = ["T"];
        let found =
            |s: &str| -> Vec<&str> { reparsed(s, &names).into_iter().map(|(n, _)| n).collect() };
        assert_eq!(found("eval \"echo $T\""), ["T"]);
        assert_eq!(found("eval echo ${T}"), ["T"]);
        assert_eq!(found("bash -c \"echo $T\""), ["T"]);
        assert_eq!(found("set -e; sh -ec \"x $T\" && true"), ["T"]);
        assert!(found("echo \"$T\"").is_empty());
        assert!(found("echo $T").is_empty());
        assert!(found("eval 'echo $T'").is_empty());
        assert!(found("sh -c 'echo $T'").is_empty());
        assert!(found("eval \"echo \\$T\"").is_empty());
        assert!(found("X=\"$T\" sh -c 'echo $X'").is_empty());
        assert!(found("eval \"$OTHER\"").is_empty());
        assert!(found("# eval \"$T\"").is_empty());
    }

    #[test]
    fn a_key_is_found_under_its_section() {
        let text = "version: 2.1\njobs:\n  build:\n    steps: []\n  test:\n    steps: []\n";
        assert_eq!(key_under(text, "jobs", "test"), 4);
        assert_eq!(key_under(text, "jobs", "none"), 1);
        assert_eq!(key_under(text, "commands", "x"), 0);
        assert_eq!(top_key("a: 1\n\"b c\":\n  x: 1\n", "b c"), 1);
    }
}
