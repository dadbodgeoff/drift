//! GitLab CI: `.gitlab-ci.yml`, the files it includes from the repository
//! (`include: local`, a path), and the child pipelines a job triggers from one
//! (`trigger: include`), read as GitLab merges them.
//!
//! - **A download handed to an interpreter** in a job's `script`, `before_script` or
//!   `after_script` (and in `default:`), `piped_download`.
//! - **Text someone outside wrote, parsed as code** (`script_injection`): a
//!   predefined variable whose value a merge request's author or a commit's author
//!   writes ([`OUTSIDERS`]), expanded where a second shell parses it (`eval
//!   "$CI_MERGE_REQUEST_TITLE"`, `sh -c "... $CI_COMMIT_MESSAGE"`). GitLab hands
//!   variables to the job's shell as environment variables and does not write them
//!   into the script, so an expansion the shell makes as an argument (`echo
//!   $CI_MERGE_REQUEST_TITLE`) is a value, not script, and is no finding.
//! - **Another owner's configuration named by what that owner can move**
//!   (`unpinned_action`, job `include`): a remote include whose URL names no commit
//!   and gives no `integrity`, a project include whose `ref` is no full commit (or
//!   none: the default branch), a CI component of a version that is no full commit.
//!   What it defines runs with the CI/CD variables the project gives every job.
//!   GitLab's own templates (`include: template`) are not listed, as GitHub's own
//!   actions are not.
//!
//! A job's `image:` and `services:` named by a tag are not listed: they are the
//! counterpart of a GitHub job's `container:` and `services:`, which the GitHub
//! reading does not list either (it lists an image run as a step, `docker://`).
//!
//! A job `extends` the jobs it names (in order, its own keys last), and a hidden job
//! (`.name`) is read where a job extends it or a `!reference [.name, script]` names
//! it. A local include written with a pattern other than `*` in its last part, or
//! with a variable, is not followed, and said so.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::Value;

use super::{Read, finding, is_commit, line_at, reparsed, script_lines, top_key};
use crate::workflows::{WorkflowFinding, piped_download};

const ROOT: &str = ".gitlab-ci.yml";

/// GitLab's predefined variables whose value is text a person writes that is not
/// the project's configuration: a merge request's title, description and source
/// branch (written by whoever opens it, from a fork too), a commit's message, title,
/// description and author, and the name of the branch a pipeline runs for (as the
/// GitHub reading reads `github.head_ref` and the event's texts). Every other
/// variable is not read as one (`CI_COMMIT_REF_SLUG` is written by GitLab from the
/// name, in letters, digits and `-` only).
const OUTSIDERS: &[&str] = &[
    "CI_COMMIT_AUTHOR",
    "CI_COMMIT_BRANCH",
    "CI_COMMIT_DESCRIPTION",
    "CI_COMMIT_MESSAGE",
    "CI_COMMIT_REF_NAME",
    "CI_COMMIT_TITLE",
    "CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME",
    "CI_MERGE_REQUEST_DESCRIPTION",
    "CI_MERGE_REQUEST_SOURCE_BRANCH_NAME",
    "CI_MERGE_REQUEST_TITLE",
];

/// Top-level keys of a pipeline that are no job (GitLab's CI/CD YAML syntax).
const KEYWORDS: &[&str] = &[
    "after_script",
    "before_script",
    "cache",
    "default",
    "image",
    "include",
    "services",
    "spec",
    "stages",
    "types",
    "variables",
    "workflow",
];

/// The keys whose lines a job's shell runs.
const SCRIPTS: &[&str] = &["before_script", "script", "after_script"];

/// The most files one pipeline is read from.
const MAX_FILES: usize = 100;

pub(super) fn read(root: &Path, out: &mut Read) {
    if !root.join(ROOT).is_file() {
        return;
    }
    let mut seen = BTreeSet::new();
    let mut pipelines = vec![ROOT.to_string()];
    while let Some(rel) = pipelines.pop() {
        if !seen.insert(rel.clone()) || seen.len() > MAX_FILES {
            continue;
        }
        let mut docs = Vec::new();
        let mut found = Vec::new();
        gather(
            root,
            &rel,
            &mut docs,
            &mut seen,
            &mut found,
            &mut pipelines,
            out,
        );
        jobs_of(&docs, &mut found);
        out.add(found);
    }
}

/// One file of a pipeline.
struct Doc {
    rel: String,
    text: String,
    doc: Value,
}

/// The configuration of a pipeline file: its one document, or the second where the
/// first is a `spec:` header (a component's or a template's inputs).
fn config(rel: &str, text: &str, out: &mut Read) -> Option<Value> {
    if text.trim().is_empty() {
        return None;
    }
    let Ok(mut docs) = serde_saphyr::from_multiple::<Value>(text) else {
        out.not_read.push(super::NotRead::unparsed(rel));
        return None;
    };
    let doc = match docs.len() {
        0 => return None,
        1 => docs.pop(),
        2 if docs[0].get("spec").is_some() => docs.pop(),
        n => {
            out.not_read(rel, format!("holds {n} YAML documents"));
            return None;
        }
    };
    match doc {
        Some(v @ Value::Object(_)) => Some(v),
        Some(Value::Null) | None => None,
        Some(_) => {
            out.not_read(rel, "is not a mapping of jobs".to_string());
            None
        }
    }
}

/// Reads `rel` and, before going on, every file of the repository it includes, into
/// `docs` (the file first, then its includes in order); what an include names that
/// another owner can move into `found`; child pipelines into `children`.
fn gather(
    root: &Path,
    rel: &str,
    docs: &mut Vec<Doc>,
    seen: &mut BTreeSet<String>,
    found: &mut Vec<WorkflowFinding>,
    children: &mut Vec<String>,
    out: &mut Read,
) {
    let Some(text) = out.load(root, rel) else {
        if !root.join(rel).is_file() && rel != ROOT {
            out.not_read(rel, "is included and was not found".to_string());
        }
        return;
    };
    let Some(doc) = config(rel, &text, out) else {
        return;
    };
    let mut local = Vec::new();
    if let Some(inc) = doc.get("include") {
        includes(rel, &text, inc, root, &mut local, found, out);
    }
    // Child pipelines: what a job triggers from a file of the repository.
    if let Some(o) = doc.as_object() {
        for body in o.values() {
            if let Some(inc) = body.get("trigger").and_then(|t| t.get("include")) {
                let mut child = Vec::new();
                includes(rel, &text, inc, root, &mut child, found, out);
                children.extend(child);
            }
        }
    }
    docs.push(Doc {
        rel: rel.to_string(),
        text,
        doc,
    });
    for path in local {
        if docs.len() >= MAX_FILES {
            break;
        }
        if seen.insert(path.clone()) {
            gather(root, &path, docs, seen, found, children, out);
        }
    }
}

/// Reads an `include:` (a string, a mapping or a list of them): files of the
/// repository it names into `local`, another owner's configuration named by what
/// that owner can move into `found`.
fn includes(
    rel: &str,
    text: &str,
    inc: &Value,
    root: &Path,
    local: &mut Vec<String>,
    found: &mut Vec<WorkflowFinding>,
    out: &mut Read,
) {
    let items: Vec<&Value> = match inc {
        Value::Array(a) => a.iter().collect(),
        v => vec![v],
    };
    let mut unpinned = |detail: &str, needle: &str| {
        found.push(finding(
            "unpinned_action",
            rel,
            line_at(text, 0, needle),
            "include",
            detail,
        ));
    };
    for item in items {
        match item {
            Value::String(s) if s.starts_with("https://") || s.starts_with("http://") => {
                if !remote_pinned(s, None) {
                    unpinned(s, s);
                }
            }
            Value::String(s) => local_paths(rel, s, root, local, out),
            Value::Object(o) => {
                if let Some(p) = o.get("local").and_then(Value::as_str) {
                    local_paths(rel, p, root, local, out);
                } else if let Some(url) = o.get("remote").and_then(Value::as_str) {
                    if !remote_pinned(url, o.get("integrity")) {
                        unpinned(url, url);
                    }
                } else if let Some(project) = o.get("project").and_then(Value::as_str) {
                    let r = o.get("ref").and_then(Value::as_str);
                    // A variable is not read: what it names is unknown.
                    if project.contains('$') || r.is_some_and(|r| r.contains('$')) {
                        continue;
                    }
                    if !r.is_some_and(is_commit) {
                        let detail = match r {
                            Some(r) => format!("{project}@{r}"),
                            None => format!("{project} (default branch)"),
                        };
                        unpinned(&detail, project);
                    }
                } else if let Some(c) = o.get("component").and_then(Value::as_str) {
                    let version = c.rsplit_once('@').map(|(_, v)| v);
                    if version.is_some_and(|v| !v.contains('$') && !is_commit(v)) {
                        unpinned(c, c);
                    }
                }
                // A child pipeline a job writes while it runs: not in the repository.
                else if o.contains_key("artifact") {
                    out.not_read(
                        rel,
                        "a child pipeline it generates (`include: artifact`) is not read"
                            .to_string(),
                    );
                }
                // `template`: GitLab's own.
            }
            _ => {}
        }
    }
}

/// A remote include names a commit in its URL's path, or gives the digest of what
/// it fetches (`integrity`).
fn remote_pinned(url: &str, integrity: Option<&Value>) -> bool {
    integrity.is_some_and(|v| v.as_str().is_some_and(|s| !s.is_empty()))
        || url.split(['/', '?', '#', '&', '=']).any(is_commit)
}

/// The files of the repository a local include names: a path from the repository's
/// root, or with `*` in its last part the YAML files of that directory it matches.
fn local_paths(rel: &str, path: &str, root: &Path, local: &mut Vec<String>, out: &mut Read) {
    let path = path.trim().trim_start_matches('/');
    let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
    if path.contains('$') || dir.contains('*') {
        out.not_read(
            rel,
            format!(
                "its include `{}` is not followed (a variable or a pattern across directories)",
                crate::report::sanitize(path, 120)
            ),
        );
        return;
    }
    if !name.contains('*') {
        local.push(path.to_string());
        return;
    }
    let Some((before, after)) = name.split_once('*').filter(|(_, a)| !a.contains('*')) else {
        out.not_read(
            rel,
            format!(
                "its include `{}` is not followed (more than one `*`)",
                crate::report::sanitize(path, 120)
            ),
        );
        return;
    };
    let Ok(entries) = std::fs::read_dir(root.join(dir)) else {
        return;
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|n| {
            n.starts_with(before) && n.ends_with(after) && n.len() >= before.len() + after.len()
        })
        .collect();
    names.sort();
    for n in names {
        local.push(if dir.is_empty() {
            n
        } else {
            format!("{dir}/{n}")
        });
    }
}

/// Each job of the pipeline `docs`, read: its scripts as `extends` and the file it
/// is in give them, `default:` and the global scripts as the job `default`, and the
/// hidden jobs a `!reference` names.
fn jobs_of(docs: &[Doc], found: &mut Vec<WorkflowFinding>) {
    // Every job by name, the first file's last: GitLab merges the included files
    // into the file that includes them, which has the last word.
    let mut jobs: BTreeMap<&str, (usize, &Value)> = BTreeMap::new();
    for (i, d) in docs
        .iter()
        .enumerate()
        .skip(1)
        .chain(docs.iter().enumerate().take(1))
    {
        if let Some(o) = d.doc.as_object() {
            for (name, body) in o {
                if !KEYWORDS.contains(&name.as_str()) && body.is_object() {
                    jobs.insert(name, (i, body));
                }
            }
        }
    }
    let referenced: BTreeSet<(String, String)> =
        docs.iter().flat_map(|d| references(&d.text)).collect();
    for &name in jobs.keys() {
        let hidden = name.starts_with('.');
        for key in SCRIPTS {
            if hidden && !referenced.contains(&(name.to_string(), key.to_string())) {
                continue;
            }
            if let Some((owner, doc, value)) = resolve(&jobs, name, key, 0) {
                let d = &docs[doc];
                scripts(d, top_key(&d.text, owner), name, value, found);
            }
        }
    }
    for d in docs {
        let defaults = d.doc.get("default");
        for key in ["before_script", "after_script"] {
            for (v, from) in [
                (
                    defaults.and_then(|x| x.get(key)),
                    top_key(&d.text, "default"),
                ),
                (d.doc.get(key), top_key(&d.text, key)),
            ] {
                if let Some(v) = v {
                    scripts(d, from, "default", v, found);
                }
            }
        }
    }
}

/// The value of `key` for the job `name`: its own, else that of the last job it
/// extends that has one (the job named, its file and the value).
fn resolve<'a>(
    jobs: &BTreeMap<&'a str, (usize, &'a Value)>,
    name: &'a str,
    key: &str,
    depth: usize,
) -> Option<(&'a str, usize, &'a Value)> {
    let (doc, body) = jobs.get(name)?;
    if let Some(v) = body.get(key) {
        return Some((name, *doc, v));
    }
    if depth >= 10 {
        return None;
    }
    let bases: Vec<&str> = match body.get("extends") {
        Some(Value::String(s)) => vec![s.as_str()],
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    bases.into_iter().rev().find_map(|b| {
        let (k, _) = jobs.get_key_value(b)?;
        resolve(jobs, k, key, depth + 1)
    })
}

/// The `(job, key)` pairs `!reference [job, key]` tags of a file name: the YAML
/// parser keeps a tagged list as a list, so what it names is read off the text.
fn references(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (at, _) in text.match_indices("!reference") {
        let rest = text[at + "!reference".len()..].trim_start();
        let Some(inner) = rest
            .strip_prefix('[')
            .and_then(|r| r.split_once(']'))
            .map(|(i, _)| i)
        else {
            continue;
        };
        let parts: Vec<String> = inner
            .split(',')
            .map(|p| p.trim().trim_matches(['"', '\'']).to_string())
            .collect();
        if let [job, key, ..] = parts.as_slice() {
            out.push((job.clone(), key.clone()));
        }
    }
    out
}

/// The findings of one script of `job`, written in `d` from its 0-based line `from`.
fn scripts(d: &Doc, from: usize, job: &str, value: &Value, found: &mut Vec<WorkflowFinding>) {
    for run in script_lines(value) {
        if let Some(command) = piped_download(run) {
            found.push(finding(
                "piped_download",
                &d.rel,
                line_at(&d.text, from, command),
                job,
                command,
            ));
        }
        for (name, line) in reparsed(run, OUTSIDERS) {
            found.push(finding(
                "script_injection",
                &d.rel,
                line_at(&d.text, from, line),
                job,
                name,
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reference_names_a_job_and_a_key() {
        assert_eq!(
            references(
                "a:\n  script:\n    - !reference [.setup, script]\n    - !reference ['.x', \"before_script\"]\n"
            ),
            [
                (".setup".to_string(), "script".to_string()),
                (".x".to_string(), "before_script".to_string())
            ]
        );
    }

    #[test]
    fn a_remote_include_is_pinned_by_a_commit_or_a_digest() {
        let sha = "0123456789abcdef0123456789abcdef01234567";
        assert!(remote_pinned(
            &format!("https://gitlab.com/a/b/-/raw/{sha}/ci.yml"),
            None
        ));
        assert!(!remote_pinned(
            "https://gitlab.com/a/b/-/raw/main/ci.yml",
            None
        ));
        assert!(remote_pinned(
            "https://x/ci.yml",
            Some(&Value::String("sha256-abc".into()))
        ));
    }
}
