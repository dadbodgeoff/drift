//! Azure Pipelines: `azure-pipelines.yml` and the YAML files of
//! `.azure-pipelines/`.
//!
//! - **A download handed to an interpreter** in a `script`, `bash`, `pwsh` or
//!   `powershell` step, or in the inline script of a `Bash`, `PowerShell` or
//!   `CmdLine` task, `piped_download`.
//! - **Text a person writes, replaced into a script before it runs**
//!   (`script_injection`): a macro `$(Name)` of a predefined variable of
//!   [`OUTSIDERS`]. The agent writes the macro's value into the script's text before
//!   the shell reads it, as GitHub writes a `${{ }}` expression; the same variable
//!   read from the environment (`$BUILD_SOURCEBRANCH`) is a value and no finding.
//!
//! Steps are read wherever the file writes them (a pipeline's own `steps:`, a job's,
//! a deployment's strategy, a template's), each in the job or deployment that holds
//! it (`default` for a pipeline's own steps). Templates from other repositories
//! (`@resource`) and `${{ }}` template expressions are not read.

use std::path::Path;

use serde_json::Value;

use super::{Read, finding, line_at};
use crate::workflows::{WorkflowFinding, piped_download};

/// Azure's predefined variables whose value is text a person writes that is not the
/// pipeline's: the branch a run builds and the branch a pull request comes from (a
/// fork's too), and the message of the commit built (as the GitHub reading reads
/// `github.head_ref` and the event's texts). Names are read without regard to case,
/// as Azure reads them; every other variable is not read as one.
const OUTSIDERS: &[&str] = &[
    "Build.SourceBranch",
    "Build.SourceBranchName",
    "Build.SourceVersionMessage",
    "System.PullRequest.SourceBranch",
];

/// The step keys whose value is a script the agent runs.
const SCRIPT_STEPS: &[&str] = &["script", "bash", "pwsh", "powershell"];

/// Tasks whose `inputs.script` is a script written in the file, where it is inline.
const SCRIPT_TASKS: &[&str] = &["Bash@", "PowerShell@", "CmdLine@"];

pub(super) fn read(root: &Path, out: &mut Read) {
    let mut files: Vec<String> = ["azure-pipelines.yml", "azure-pipelines.yaml"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if let Ok(entries) = std::fs::read_dir(root.join(".azure-pipelines")) {
        let mut more: Vec<String> = entries
            .flatten()
            .filter_map(|e| e.file_name().to_str().map(String::from))
            .filter(|n| n.ends_with(".yml") || n.ends_with(".yaml"))
            .map(|n| format!(".azure-pipelines/{n}"))
            .collect();
        more.sort();
        files.extend(more);
    }
    for rel in files {
        let Some(text) = out.load(root, &rel) else {
            continue;
        };
        let Some(doc) = out.yaml(&rel, &text) else {
            continue;
        };
        let mut steps = Vec::new();
        walk(&doc, "default", None, &mut steps);
        let mut found = Vec::new();
        for (job, step) in steps {
            step_findings(&rel, &text, job, step, &mut found);
        }
        out.add(found);
    }
}

/// Every step of `v` (a mapping with a script key, not a task's `inputs`), with the
/// job or deployment that holds it.
fn walk<'a>(v: &'a Value, job: &'a str, key: Option<&str>, out: &mut Vec<(&'a str, &'a Value)>) {
    match v {
        Value::Object(o) => {
            let job = o
                .get("job")
                .or_else(|| o.get("deployment"))
                .and_then(Value::as_str)
                .unwrap_or(job);
            if key != Some("inputs")
                && (SCRIPT_STEPS
                    .iter()
                    .any(|k| o.get(*k).is_some_and(Value::is_string))
                    || o.get("task").is_some_and(Value::is_string))
            {
                out.push((job, v));
            }
            for (k, x) in o {
                walk(x, job, Some(k), out);
            }
        }
        Value::Array(a) => {
            for x in a {
                walk(x, job, key, out);
            }
        }
        _ => {}
    }
}

/// The findings of one step.
fn step_findings(rel: &str, text: &str, job: &str, step: &Value, found: &mut Vec<WorkflowFinding>) {
    let from = job_line(text, job);
    let inline_task = step.get("task").and_then(Value::as_str).is_some_and(|t| {
        SCRIPT_TASKS.iter().any(|p| t.starts_with(p))
            && (t.starts_with("CmdLine@")
                || step
                    .get("inputs")
                    .and_then(|i| i.get("targetType"))
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.eq_ignore_ascii_case("inline")))
    });
    let script = SCRIPT_STEPS
        .iter()
        .find_map(|k| step.get(*k).and_then(Value::as_str))
        .or_else(|| {
            inline_task
                .then(|| step.get("inputs").and_then(|i| i.get("script")))
                .flatten()
                .and_then(Value::as_str)
        });
    let Some(script) = script else {
        return;
    };
    if let Some(command) = piped_download(script) {
        found.push(finding(
            "piped_download",
            rel,
            line_at(text, from, command),
            job,
            command,
        ));
    }
    for (name, written) in macros(script) {
        found.push(finding(
            "script_injection",
            rel,
            line_at(text, from, written),
            job,
            name,
        ));
    }
}

/// The macros `$(Name)` of [`OUTSIDERS`] a script writes: the variable's name as the
/// table spells it, and the macro as written.
fn macros(script: &str) -> Vec<(&'static str, &str)> {
    let mut out = Vec::new();
    for (at, _) in script.match_indices("$(") {
        let rest = &script[at + 2..];
        let Some(end) = rest.find(')') else { continue };
        let name = rest[..end].trim();
        if let Some(n) = OUTSIDERS.iter().find(|n| n.eq_ignore_ascii_case(name)) {
            out.push((*n, &script[at..at + 2 + end + 1]));
        }
    }
    out
}

/// The 0-based line that names the job or deployment `job`; 0 where none does.
fn job_line(text: &str, job: &str) -> usize {
    if job == "default" {
        return 0;
    }
    text.lines()
        .position(|l| {
            let l = l.trim_start().trim_start_matches("- ");
            ["job:", "deployment:"].iter().any(|k| {
                l.strip_prefix(k)
                    .is_some_and(|v| v.trim().trim_matches(['"', '\'']) == job)
            })
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_macro_is_read_without_regard_to_case() {
        assert_eq!(
            super::macros(
                "echo $(system.pullRequest.sourceBranch) $(Build.BuildId) $(git rev-parse HEAD)"
            ),
            [(
                "System.PullRequest.SourceBranch",
                "$(system.pullRequest.sourceBranch)"
            )]
        );
    }
}
