//! Bitbucket Pipelines: `bitbucket-pipelines.yml`.
//!
//! - **A download handed to an interpreter** in a step's `script` or
//!   `after-script`, `piped_download`.
//! - **A pipe named by a tag, handed the pipeline's variables**
//!   (`unpinned_action`): a pipe is an image run as a step, as GitHub's `docker://`
//!   action is, and runs with the variables its `variables:` hand it. Listed where
//!   one of them reads a variable of the repository or the workspace (`$TOKEN`; the
//!   platform's own `BITBUCKET_` ones apart) and the image is not named by its
//!   digest. Atlassian's own pipes (`atlassian/`) are not listed, as GitHub's own
//!   actions are not.
//!
//! Steps are read wherever the pipelines write them (`default`, `branches`,
//! `pull-requests`, `tags`, `custom`, in `parallel` and `stage`, and the
//! `definitions` an alias names), each as the job its `name` gives (`step` where it
//! has none).

use std::path::Path;

use serde_json::Value;

use super::{Read, finding, line_at, script_lines};
use crate::workflows::{WorkflowFinding, piped_download};

const FILE: &str = "bitbucket-pipelines.yml";

pub(super) fn read(root: &Path, out: &mut Read) {
    let Some(text) = out.load(root, FILE) else {
        return;
    };
    let Some(doc) = out.yaml(FILE, &text) else {
        return;
    };
    let mut steps = Vec::new();
    if let Some(p) = doc.get("pipelines") {
        walk(p, &mut steps);
    }
    let mut found = Vec::new();
    for step in steps {
        step_findings(&text, step, &mut found);
    }
    out.add(found);
}

/// Every `step:` mapping under `v`.
fn walk<'a>(v: &'a Value, out: &mut Vec<&'a Value>) {
    match v {
        Value::Object(o) => {
            for (k, x) in o {
                if k == "step" && x.is_object() {
                    out.push(x);
                } else {
                    walk(x, out);
                }
            }
        }
        Value::Array(a) => {
            for x in a {
                walk(x, out);
            }
        }
        _ => {}
    }
}

fn step_findings(text: &str, step: &Value, found: &mut Vec<WorkflowFinding>) {
    let name = step.get("name").and_then(Value::as_str);
    let job = name.unwrap_or("step");
    let from = name
        .and_then(|n| crate::workflows::line_from(text, 0, &format!("name: {n}")))
        .unwrap_or(0);
    for key in ["script", "after-script"] {
        let Some(items) = step.get(key) else { continue };
        for run in script_lines(items) {
            if let Some(command) = piped_download(run) {
                found.push(finding(
                    "piped_download",
                    FILE,
                    line_at(text, from, command),
                    job,
                    command,
                ));
            }
        }
        for item in items.as_array().into_iter().flatten() {
            let Some(pipe) = item.get("pipe").and_then(Value::as_str) else {
                continue;
            };
            if unpinned_pipe(pipe) && hands_variables(item.get("variables")) {
                found.push(finding(
                    "unpinned_action",
                    FILE,
                    line_at(text, from, pipe),
                    job,
                    pipe,
                ));
            }
        }
    }
}

/// A pipe of another owner than Atlassian not named by its digest.
fn unpinned_pipe(pipe: &str) -> bool {
    let image = pipe.strip_prefix("docker://").unwrap_or(pipe);
    !image.starts_with("atlassian/") && !image.contains("@sha256:")
}

/// Some value of a pipe's `variables` reads a variable that is not the platform's
/// own (`BITBUCKET_...`).
fn hands_variables(v: Option<&Value>) -> bool {
    fn reads(s: &str) -> bool {
        super::expansions(s)
            .iter()
            .any(|(_, _, name)| !name.starts_with("BITBUCKET_"))
    }
    match v {
        Some(Value::String(s)) => reads(s),
        Some(Value::Array(a)) => a.iter().any(|x| hands_variables(Some(x))),
        Some(Value::Object(o)) => o.values().any(|x| hands_variables(Some(x))),
        _ => false,
    }
}
