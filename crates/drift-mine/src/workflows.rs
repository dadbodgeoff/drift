//! What a repository's CI workflows do with what an outsider controls
//! (`.github/workflows/*.yml`).
//!
//! Two things are read, each by what the workflow itself says:
//!
//! - **A workflow that runs for a pull request with the base repository's secrets
//!   and checks out the pull request's code** (`on: pull_request_target`, or
//!   `workflow_run`, with a checkout whose `ref` is read off the pull request's
//!   head). The code that then builds or tests is whoever opened the pull
//!   request's, and runs with the repository's token and secrets.
//! - **Text of the event interpolated into a shell step** (`run: echo "${{
//!   github.event.pull_request.title }}"`). The expression is replaced before the
//!   shell reads the line: whoever wrote the title wrote part of the script.
//!   Numbers and commit ids of the event are not text anyone chooses, and an
//!   expression handed through `env:` is a value, not script.
//!
//! Nothing is run and nothing outside the repository is read. A workflow that does
//! not parse is skipped.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

/// The largest workflow file read.
const MAX_BYTES: u64 = 512 * 1024;

/// One thing a workflow does ([`read`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct WorkflowFinding {
    /// `untrusted_checkout` or `script_injection`.
    pub kind: String,
    pub path: String,
    pub line: u32,
    pub job: String,
    /// What was read: the `ref` checked out, or the expression interpolated.
    pub detail: String,
}

/// Events whose workflow runs in the base repository, with its secrets, for
/// something an outsider sent.
const PRIVILEGED_EVENTS: &[&str] = &["pull_request_target", "workflow_run"];

/// The last member of an event expression that no one writes as text: a number
/// or an id the platform assigns.
const ASSIGNED: &[&str] = &["number", "id", "node_id", "sha", "run_id", "run_number"];

/// The workflows of the repository at `root`, read.
pub fn read(root: &Path) -> Vec<WorkflowFinding> {
    let dir = root.join(".github/workflows");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut files: Vec<_> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| matches!(p.extension().and_then(|x| x.to_str()), Some("yml" | "yaml")))
        .collect();
    files.sort();
    let mut out = Vec::new();
    for p in files {
        if std::fs::metadata(&p).map_or(true, |m| m.len() > MAX_BYTES) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else {
            continue;
        };
        let rel = format!(
            ".github/workflows/{}",
            p.file_name().and_then(|n| n.to_str()).unwrap_or_default()
        );
        out.extend(read_text(&rel, &text));
    }
    out.sort();
    out.dedup();
    out
}

/// The events a workflow runs on: a name, a list of names, or a map by name.
fn events(doc: &Value) -> Vec<String> {
    // YAML 1.1 reads the key `on` as `true`.
    let on = doc
        .get("on")
        .or_else(|| doc.get("true"))
        .or_else(|| doc.as_object().and_then(|o| o.get("True")));
    match on {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        Some(Value::Object(o)) => o.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

/// The `${{ ... }}` expressions of a text, trimmed.
fn expressions(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("${{") {
        let after = &rest[start + 3..];
        let Some(end) = after.find("}}") else { break };
        out.push(after[..end].trim());
        rest = &after[end + 2..];
    }
    out
}

/// The part of an expression that is text someone outside wrote: a path read off
/// the event (`github.event.issue.title`) or the pull request's branch name
/// (`github.head_ref`), where its last member is no number or id the platform
/// assigns.
fn outsiders_text(expression: &str) -> Option<&str> {
    let path = |start: usize| {
        let rest = &expression[start..];
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '*')))
            .unwrap_or(rest.len());
        &rest[..end]
    };
    for (at, _) in expression.match_indices("github.") {
        // Not the tail of another name (`mygithub.x`).
        if expression[..at]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
        {
            continue;
        }
        let p = path(at);
        let last = p.rsplit('.').next().unwrap_or_default();
        // (A time the platform records, `published_at`, is assigned as an id is.)
        let written = p == "github.head_ref"
            || (p.starts_with("github.event.")
                && p != "github.event."
                && !ASSIGNED.contains(&last)
                && !last.ends_with("_at"));
        if written {
            return Some(p);
        }
    }
    None
}

/// The 1-based line of the first line of `text` that holds `needle`; 1 where none.
fn line_of(text: &str, needle: &str) -> u32 {
    let needle = needle.lines().next().unwrap_or(needle).trim();
    text.lines()
        .position(|l| !needle.is_empty() && l.contains(needle))
        .map_or(1, |i| i as u32 + 1)
}

/// The findings of one workflow file.
pub fn read_text(rel: &str, text: &str) -> Vec<WorkflowFinding> {
    let Ok(doc) = serde_saphyr::from_str::<Value>(text) else {
        return Vec::new();
    };
    let events = events(&doc);
    let privileged = events
        .iter()
        .any(|e| PRIVILEGED_EVENTS.contains(&e.as_str()));
    let mut out = Vec::new();
    let Some(jobs) = doc.get("jobs").and_then(Value::as_object) else {
        return out;
    };
    for (job, body) in jobs {
        let steps = body
            .get("steps")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        for step in steps {
            if let Some(run) = step.get("run").and_then(Value::as_str) {
                for e in expressions(run) {
                    if let Some(written) = outsiders_text(e) {
                        out.push(WorkflowFinding {
                            kind: "script_injection".into(),
                            path: rel.to_string(),
                            line: line_of(text, written),
                            job: job.clone(),
                            detail: written.to_string(),
                        });
                    }
                }
            }
            let uses = step.get("uses").and_then(Value::as_str).unwrap_or_default();
            // Any checkout: an action whose `with.ref` is what it fetches.
            if privileged
                && uses
                    .split('@')
                    .next()
                    .is_some_and(|a| a.ends_with("/checkout"))
                && let Some(r) = step
                    .get("with")
                    .and_then(|w| w.get("ref"))
                    .and_then(Value::as_str)
                && expressions(r).iter().any(|e| {
                    e.contains("pull_request.head")
                        || e.contains("github.head_ref")
                        || e.contains("workflow_run.head")
                })
            {
                out.push(WorkflowFinding {
                    kind: "untrusted_checkout".into(),
                    path: rel.to_string(),
                    line: line_of(text, r),
                    job: job.clone(),
                    detail: r.trim().to_string(),
                });
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(text: &str) -> Vec<(String, String)> {
        read_text(".github/workflows/x.yml", text)
            .into_iter()
            .map(|f| (f.kind, f.detail))
            .collect()
    }

    #[test]
    fn a_privileged_workflow_that_checks_out_the_pull_requests_head_is_found() {
        let found = kinds(
            "on: pull_request_target\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n      - run: npm test\n",
        );
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].0, "untrusted_checkout");
        // The same checkout for `pull_request` runs without the secrets.
        assert!(
            kinds("on: pull_request\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n")
                .is_empty()
        );
        // And the base repository's own code is its own.
        assert!(
            kinds("on:\n  pull_request_target:\n    types: [opened]\njobs:\n  label:\n    steps:\n      - uses: actions/checkout@v4\n")
                .is_empty()
        );
    }

    #[test]
    fn text_of_the_event_in_a_shell_step_is_found_and_a_number_or_an_env_value_is_not() {
        let found = kinds(
            "on: issues\njobs:\n  greet:\n    steps:\n      - run: echo \"${{ github.event.issue.title }}\"\n      - run: echo \"#${{ github.event.issue.number }} ${{ github.event.issue.created_at }}\"\n      - env:\n          TITLE: ${{ github.event.issue.title }}\n        run: echo \"$TITLE\"\n      - run: git checkout ${{ github.head_ref }}\n",
        );
        assert_eq!(
            found,
            vec![
                (
                    "script_injection".to_string(),
                    "github.event.issue.title".to_string()
                ),
                (
                    "script_injection".to_string(),
                    "github.head_ref".to_string()
                ),
            ]
        );
    }

    #[test]
    fn a_file_that_is_no_workflow_says_nothing() {
        assert!(kinds("not: [a, workflow").is_empty());
        assert!(kinds("name: x\n").is_empty());
    }
}
