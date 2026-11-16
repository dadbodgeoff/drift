//! What a CI workflow an outsider can start, or an image the repository deploys,
//! leaves open where one stated setting would close it. Each finding is read off
//! what the files themselves say, never off a name:
//!
//! - **The token's permissions are not stated** (`unstated_permissions`): a
//!   workflow that runs on an event an outsider sends with the base repository's
//!   token ([`crate::workflows`]' privileged events: `pull_request_target`,
//!   `workflow_run`, `issue_comment`), where neither the workflow nor the job says
//!   `permissions:`. The job's token then has what the repository's default gives.
//!   Drift cannot read that setting, so the finding says the permissions are not
//!   stated, never that the token may write. It is graded by what the job does with
//!   the outsider's input ([`WorkflowHardening::grade`]). A job that calls a reusable
//!   workflow hands it its token: a workflow of the repository (`./...`) is read, and
//!   narrows where it or each of its jobs states `permissions:`; one of another
//!   repository is not read, and is not checked.
//! - **A self-hosted runner on an event a fork can start** (`self_hosted_runner`):
//!   `runs-on` names the `self-hosted` label, alone, in a list of labels, in a
//!   `labels:` of a group, or in the values a `matrix` gives it. A pull request from a
//!   fork then runs on a machine the repository keeps. An expression Drift does not
//!   evaluate, and a label that is neither `self-hosted` nor a GitHub-hosted image's,
//!   is not checked: it may name either kind of runner.
//! - **The final stage of a deployed image runs as root** (`root_user`): for each
//!   compose service that builds from a Dockerfile of the repository (the tie
//!   [`crate::security::Boundaries`] makes), the stage it builds (its `target`, else
//!   the last) has no `USER`, or its last `USER` is `root` or `0`, followed through
//!   `FROM <earlier stage>`. The service's own `user:` decides first. A base image
//!   Drift cannot read may set a user: that is not checked, and said, never reported
//!   as root (except `FROM scratch`, which sets none).
//! - **A secret written into an image's layers** (`build_secret`): a build argument
//!   given a secret by construction (a workflow's `${{ secrets.X }}`, directly or
//!   through `env:`, as a `--build-arg`, `build-args` of `docker/build-push-action` or
//!   a compose `build.args` the step builds; a compose `build.args` that is the
//!   variable a top-level compose `secrets:` entry reads its value from), to an `ARG`
//!   that a stage the image ships then reads in `ENV`, or in a `RUN` that mounts no
//!   secret. What `docker history` and the image's configuration show is then the
//!   secret. The variable's name decides nothing.
//!
//! All of these advise (`ADVISE_FIRST` in [`crate::ratchet`]). Nothing is run and
//! nothing outside the repository is read.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::report::sanitize;
use crate::workflows::{PRIVILEGED_EVENTS, events, expressions, job_line, line_from};

/// The largest file read.
const MAX_BYTES: u64 = 512 * 1024;
/// How many reusable workflows deep a call is followed.
const MAX_CALLS: usize = 4;
/// How many `FROM <stage>` hops a stage is followed through.
const MAX_STAGES: usize = 32;

/// Events a pull request from a fork starts, beside the privileged ones: GitHub's
/// own event names (its workflow schema), not names of the repository.
const FORK_EVENTS: &[&str] = &[
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
];

/// What a workflow leaves unstated on an event an outsider starts.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct WorkflowHardening {
    /// `unstated_permissions` or `self_hosted_runner`.
    pub kind: String,
    pub path: String,
    pub line: u32,
    pub job: String,
    /// What was read: `permissions not stated` (with the reusable workflow that
    /// states none either), or the runner's labels as `runs-on` gives them.
    pub detail: String,
    /// The events of the workflow that an outsider starts, as written.
    pub on: String,
    /// `unstated_permissions`: what the job does with the outsider's input, as the
    /// workflow findings of the same job say: `runs_pull_request_code` (it checks out
    /// or fetches the pull request's code), `event_text_in_script` (it writes text of
    /// the event into a script), else none read. In no key a baseline holds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grade: Option<String>,
}

/// What an image the repository builds leaves in it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct ImageHardening {
    /// `root_user` or `build_secret`.
    pub kind: String,
    /// Where it is said: the Dockerfile, or the compose file whose `user:` decides.
    pub path: String,
    pub line: u32,
    /// What builds the image: `compose.yaml service api`, or
    /// `.github/workflows/release.yml job build`.
    pub built_by: String,
    /// `root_user`: the `USER` as written, or `no USER, FROM scratch`.
    /// `build_secret`: the argument, the secret it is given, and what reads it.
    pub detail: String,
}

/// What one of these readings met and could not read: not checked, never a finding.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct NotChecked {
    /// The kind of finding that could not be told.
    pub kind: String,
    pub path: String,
    pub line: u32,
    /// `job test`, or `compose.yaml service api`.
    pub subject: String,
    pub why: String,
}

/// What [`read`] finds.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Read {
    pub workflows: Vec<WorkflowHardening>,
    pub images: Vec<ImageHardening>,
    pub not_checked: Vec<NotChecked>,
}

/// Reads the repository at `root` into the inventory: the fields
/// `workflow_hardening`, `image_hardening` and `hardening_not_checked`.
pub fn fill(inv: &mut crate::security::Inventory, root: &Path) {
    let read = read(root);
    inv.workflow_hardening = read.workflows;
    inv.image_hardening = read.images;
    inv.hardening_not_checked = read.not_checked;
}

/// The workflows and the deployed images of the repository at `root`, read.
pub fn read(root: &Path) -> Read {
    let mut out = Read::default();
    let load = |rel: &str| read_file(root, rel);
    let workflows = workflow_files(root);
    for (rel, text) in &workflows {
        read_workflow(rel, text, &load, &mut out);
    }
    for (rel, text) in &workflows {
        workflow_builds(rel, text, &load, &mut out);
    }
    compose_images(root, &load, &mut out);
    out.workflows.sort();
    out.workflows.dedup();
    out.images.sort();
    out.images.dedup();
    out.not_checked.sort();
    out.not_checked.dedup();
    out
}

fn read_file(root: &Path, rel: &str) -> Option<String> {
    let p = root.join(rel);
    std::fs::metadata(&p)
        .ok()
        .filter(|m| m.is_file() && m.len() <= MAX_BYTES)
        .and_then(|_| std::fs::read_to_string(&p).ok())
}

/// The workflow files, repo-relative, sorted, with their text.
fn workflow_files(root: &Path) -> Vec<(String, String)> {
    let Ok(entries) = std::fs::read_dir(root.join(".github/workflows")) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| n.ends_with(".yml") || n.ends_with(".yaml"))
        .collect();
    names.sort();
    names
        .into_iter()
        .filter_map(|n| {
            let rel = format!(".github/workflows/{n}");
            read_file(root, &rel).map(|t| (rel, t))
        })
        .collect()
}

// ---------- workflows: the token, the runner ----------

/// What a reusable workflow a job calls does with the token it is handed.
enum Callee {
    /// The job calls none.
    None,
    /// It, or each of its jobs, states `permissions:`.
    Narrows,
    /// A job of it states none: where.
    Leaves(String),
    /// It is not read: why.
    Unread(String),
}

/// The path of a workflow of the repository a job calls (`./.github/workflows/x.yml`).
fn local_call(uses: &str) -> Option<&str> {
    uses.strip_prefix("./")
        .map(|p| p.split('@').next().unwrap_or(p))
}

fn callee_token(body: &Value, load: &dyn Fn(&str) -> Option<String>, depth: usize) -> Callee {
    let Some(uses) = body.get("uses").and_then(Value::as_str) else {
        return Callee::None;
    };
    let Some(path) = local_call(uses) else {
        return Callee::Unread(format!(
            "it calls {uses}, a workflow of another repository that Drift does not read: it may state permissions"
        ));
    };
    if depth >= MAX_CALLS {
        return Callee::Unread(format!(
            "it calls {uses} through more reusable workflows than Drift follows"
        ));
    }
    let Some(doc) = load(path).and_then(|t| serde_saphyr::from_str::<Value>(&t).ok()) else {
        return Callee::Unread(format!("it calls {uses}, which Drift could not read"));
    };
    if doc.get("permissions").is_some() {
        return Callee::Narrows;
    }
    let Some(jobs) = doc.get("jobs").and_then(Value::as_object) else {
        return Callee::Unread(format!("it calls {uses}, which has no jobs Drift reads"));
    };
    for (job, b) in jobs {
        if b.get("permissions").is_some() {
            continue;
        }
        match callee_token(b, load, depth + 1) {
            Callee::None => return Callee::Leaves(format!("./{path} job {job}")),
            Callee::Narrows => {}
            leaves => return leaves,
        }
    }
    Callee::Narrows
}

/// Where a job runs, as `runs-on` says it.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Runner {
    /// The `self-hosted` label is named: the labels, as read.
    SelfHosted(String),
    /// A GitHub-hosted image's label.
    Hosted,
    /// Not told: why.
    Unknown(String),
}

/// A label of a GitHub-hosted runner image (`ubuntu-latest`, `ubuntu-24.04`,
/// `windows-2022`, `macos-14-large`): the platform's documented label form, an
/// operating system and a version or `latest`.
fn hosted(label: &str) -> bool {
    let l = label.to_ascii_lowercase();
    let Some((os, rest)) = l.split_once('-') else {
        return false;
    };
    matches!(os, "ubuntu" | "windows" | "macos")
        && (rest == "latest"
            || rest == "slim"
            || rest.starts_with("latest-")
            || rest.starts_with(|c: char| c.is_ascii_digit()))
}

/// One label, or one expression in place of the labels.
fn label(s: &str, matrix: Option<&Value>) -> Runner {
    let s = s.trim();
    if s.contains("${{") {
        let es = expressions(s);
        if es.len() == 1
            && s.starts_with("${{")
            && s.ends_with("}}")
            && let Some(key) = es[0].strip_prefix("matrix.")
            && !key.is_empty()
            && key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
        {
            return matrix_values(matrix, key);
        }
        return Runner::Unknown(format!(
            "runs-on is `{s}`, an expression Drift does not evaluate"
        ));
    }
    if s.eq_ignore_ascii_case("self-hosted") {
        Runner::SelfHosted(s.to_string())
    } else if hosted(s) {
        Runner::Hosted
    } else {
        Runner::Unknown(format!(
            "the runner label `{s}` may name a self-hosted runner or a larger GitHub-hosted one"
        ))
    }
}

/// What `runs-on` gives: a label, a list of labels (all of which the runner has), a
/// group with labels.
fn labels(v: &Value, matrix: Option<&Value>) -> Runner {
    match v {
        Value::String(s) => label(s, matrix),
        Value::Array(a) => {
            let each: Vec<Runner> = a
                .iter()
                .map(|x| match x.as_str() {
                    Some(s) => label(s, matrix),
                    None => Runner::Unknown("runs-on lists a value that is no label".into()),
                })
                .collect();
            if each.iter().any(|r| matches!(r, Runner::SelfHosted(_))) {
                let read: Vec<String> = each
                    .iter()
                    .zip(a)
                    .map(|(r, x)| match r {
                        Runner::SelfHosted(d) => d.clone(),
                        _ => x.as_str().unwrap_or_default().to_string(),
                    })
                    .collect();
                Runner::SelfHosted(read.join(", "))
            } else if each.contains(&Runner::Hosted) {
                Runner::Hosted
            } else {
                each.into_iter()
                    .next()
                    .unwrap_or_else(|| Runner::Unknown("runs-on lists no label".into()))
            }
        }
        Value::Object(o) => {
            let by_labels = o.get("labels").map(|l| labels(l, matrix));
            match by_labels {
                Some(r @ Runner::SelfHosted(_)) => r,
                Some(Runner::Hosted) => Runner::Hosted,
                _ => Runner::Unknown(match o.get("group").and_then(Value::as_str) {
                    Some(g) => format!(
                        "runs-on names the runner group `{g}`, which may hold self-hosted runners"
                    ),
                    None => "runs-on is a mapping Drift does not read".into(),
                }),
            }
        }
        _ => Runner::Unknown("runs-on is no label Drift reads".into()),
    }
}

/// The values a job's matrix gives `matrix.<key>`: its list, and its `include`
/// entries'.
fn matrix_values(matrix: Option<&Value>, key: &str) -> Runner {
    let Some(Value::Object(m)) = matrix else {
        return Runner::Unknown(format!(
            "runs-on is matrix.{key}, and the job has no matrix Drift reads"
        ));
    };
    let mut values: Vec<&Value> = match m.get(key) {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(other) => vec![other],
        None => Vec::new(),
    };
    if let Some(Value::Array(include)) = m.get("include") {
        values.extend(include.iter().filter_map(|i| i.get(key)));
    }
    if values.is_empty() {
        return Runner::Unknown(format!(
            "runs-on is matrix.{key}, which the matrix gives no value Drift reads"
        ));
    }
    let each: Vec<Runner> = values.iter().map(|v| labels(v, None)).collect();
    if let Some(Runner::SelfHosted(d)) = each.iter().find(|r| matches!(r, Runner::SelfHosted(_))) {
        Runner::SelfHosted(format!("matrix.{key}: {d}"))
    } else if let Some(u) = each.iter().find(|r| matches!(r, Runner::Unknown(_))) {
        u.clone()
    } else {
        Runner::Hosted
    }
}

/// Where a job runs: its `runs-on`, with its own matrix.
fn runner_of(body: &Value) -> Option<Runner> {
    let matrix = body.get("strategy").and_then(|s| s.get("matrix"));
    let matrix = match matrix {
        Some(Value::String(s)) if s.contains("${{") => None,
        m => m,
    };
    body.get("runs-on").map(|r| labels(r, matrix))
}

/// Where the jobs of a workflow of the repository a job calls run: the first that
/// names `self-hosted`, else the first that cannot be told.
fn callee_runner(
    body: &Value,
    load: &dyn Fn(&str) -> Option<String>,
    depth: usize,
) -> Option<Runner> {
    let uses = body.get("uses").and_then(Value::as_str)?;
    let Some(path) = local_call(uses) else {
        return Some(Runner::Unknown(format!(
            "it calls {uses}, a workflow of another repository that Drift does not read: where it runs is not known"
        )));
    };
    if depth >= MAX_CALLS {
        return Some(Runner::Unknown(format!(
            "it calls {uses} through more reusable workflows than Drift follows"
        )));
    }
    let Some(doc) = load(path).and_then(|t| serde_saphyr::from_str::<Value>(&t).ok()) else {
        return Some(Runner::Unknown(format!(
            "it calls {uses}, which Drift could not read"
        )));
    };
    let mut unknown = None;
    for (job, b) in doc
        .get("jobs")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let r = runner_of(b).or_else(|| callee_runner(b, load, depth + 1));
        match r {
            Some(Runner::SelfHosted(d)) => {
                return Some(Runner::SelfHosted(format!("./{path} job {job}: {d}")));
            }
            Some(Runner::Unknown(why)) => {
                unknown.get_or_insert(Runner::Unknown(format!("./{path} job {job}: {why}")));
            }
            _ => {}
        }
    }
    Some(unknown.unwrap_or(Runner::Hosted))
}

/// The hardening findings of one workflow file (`load` reads a file of the
/// repository by its path, for the reusable workflows a job calls).
fn read_workflow(rel: &str, text: &str, load: &dyn Fn(&str) -> Option<String>, out: &mut Read) {
    let Ok(doc) = serde_saphyr::from_str::<Value>(text) else {
        return;
    };
    let events = events(&doc);
    let privileged: Vec<&str> = events
        .iter()
        .map(String::as_str)
        .filter(|e| PRIVILEGED_EVENTS.contains(e))
        .collect();
    let outsiders: Vec<&str> = events
        .iter()
        .map(String::as_str)
        .filter(|e| PRIVILEGED_EVENTS.contains(e) || FORK_EVENTS.contains(e))
        .collect();
    if outsiders.is_empty() {
        return;
    }
    let Some(jobs) = doc.get("jobs").and_then(Value::as_object) else {
        return;
    };
    // What each job does with the outsider's input, as the workflow findings say.
    let found = crate::workflows::read_text(rel, text);
    for (job, body) in jobs {
        let at = job_line(text, job);
        let job_at = at as u32 + 1;
        if !privileged.is_empty()
            && doc.get("permissions").is_none()
            && body.get("permissions").is_none()
        {
            let detail = match callee_token(body, load, 0) {
                Callee::None => Some("permissions not stated".to_string()),
                Callee::Leaves(w) => Some(format!("permissions not stated, nor by {w}")),
                Callee::Narrows => None,
                Callee::Unread(why) => {
                    out.not_checked.push(NotChecked {
                        kind: "unstated_permissions".into(),
                        path: rel.to_string(),
                        line: job_at,
                        subject: format!("job {job}"),
                        why,
                    });
                    None
                }
            };
            if let Some(detail) = detail {
                let of_job = |k: &str| found.iter().any(|f| f.job == *job && f.kind == k);
                let grade = if of_job("untrusted_checkout") {
                    Some("runs_pull_request_code")
                } else if of_job("script_injection") {
                    Some("event_text_in_script")
                } else {
                    None
                };
                out.workflows.push(WorkflowHardening {
                    kind: "unstated_permissions".into(),
                    path: rel.to_string(),
                    line: job_at,
                    job: job.clone(),
                    detail,
                    on: privileged.join(", "),
                    grade: grade.map(str::to_string),
                });
            }
        }
        let (runner, line) = match runner_of(body) {
            Some(r) => (
                Some(r),
                line_from(text, at, "runs-on").map_or(job_at, |i| i as u32 + 1),
            ),
            None => (callee_runner(body, load, 0), job_at),
        };
        match runner {
            Some(Runner::SelfHosted(detail)) => out.workflows.push(WorkflowHardening {
                kind: "self_hosted_runner".into(),
                path: rel.to_string(),
                line,
                job: job.clone(),
                detail,
                on: outsiders.join(", "),
                grade: None,
            }),
            Some(Runner::Unknown(why)) => out.not_checked.push(NotChecked {
                kind: "self_hosted_runner".into(),
                path: rel.to_string(),
                line,
                subject: format!("job {job}"),
                why,
            }),
            _ => {}
        }
    }
}

// ---------- Dockerfiles ----------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Op {
    User(String, u32),
    Arg(Vec<String>),
    Env(String, u32),
    /// The command, whether it mounts a secret, its line.
    Run(String, bool, u32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Stage {
    name: Option<String>,
    base: String,
    line: u32,
    ops: Vec<Op>,
}

/// The stages of a Dockerfile, as far as these readings need: `FROM`, `USER`, `ARG`,
/// `ENV`, `RUN` (heredocs taken in). An error says why it is not read.
fn stages(text: &str) -> Result<Vec<Stage>, String> {
    let lines: Vec<&str> = text.lines().collect();
    if lines
        .iter()
        .take_while(|l| l.trim_start().starts_with('#'))
        .any(|l| {
            let l = l.trim_start_matches('#').trim().to_ascii_lowercase();
            l.starts_with("escape=") && !l.ends_with('\\')
        })
    {
        return Err("it sets another escape character, which Drift does not read".into());
    }
    let mut out: Vec<Stage> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let start = i as u32 + 1;
        let first = lines[i].trim();
        i += 1;
        if first.is_empty() || first.starts_with('#') {
            continue;
        }
        let mut joined = String::new();
        let mut line = first.to_string();
        loop {
            match line.trim_end().strip_suffix('\\') {
                Some(head) => {
                    joined.push_str(head);
                    joined.push(' ');
                    // Comment lines inside a continued instruction are dropped.
                    while i < lines.len() && lines[i].trim_start().starts_with('#') {
                        i += 1;
                    }
                    if i >= lines.len() {
                        break;
                    }
                    line = lines[i].trim().to_string();
                    i += 1;
                }
                None => {
                    joined.push_str(&line);
                    break;
                }
            }
        }
        // A heredoc (`RUN <<EOF`): its lines up to the delimiter are the command's.
        if let Some(at) = joined.find("<<") {
            let word = joined[at + 2..]
                .trim_start_matches('-')
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .trim_matches(['"', '\''])
                .to_string();
            if !word.is_empty() && word.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                while i < lines.len() {
                    let l = lines[i];
                    i += 1;
                    if l.trim() == word {
                        break;
                    }
                    joined.push('\n');
                    joined.push_str(l);
                }
            }
        }
        let (instruction, rest) = joined
            .split_once(char::is_whitespace)
            .unwrap_or((joined.as_str(), ""));
        let rest = rest.trim();
        let instruction = instruction.to_ascii_uppercase();
        if instruction == "FROM" {
            let words: Vec<&str> = rest
                .split_whitespace()
                .filter(|w| !w.starts_with("--"))
                .collect();
            let name = words
                .iter()
                .position(|w| w.eq_ignore_ascii_case("as"))
                .and_then(|i| words.get(i + 1))
                .map(|n| n.to_lowercase());
            out.push(Stage {
                name,
                base: words.first().unwrap_or(&"").to_lowercase(),
                line: start,
                ops: Vec::new(),
            });
            continue;
        }
        let Some(stage) = out.last_mut() else {
            continue;
        };
        match instruction.as_str() {
            "USER" => stage.ops.push(Op::User(
                rest.split_whitespace()
                    .next()
                    .unwrap_or_default()
                    .to_string(),
                start,
            )),
            "ARG" => stage.ops.push(Op::Arg(
                rest.split_whitespace()
                    .map(|w| w.split('=').next().unwrap_or(w).to_string())
                    .collect(),
            )),
            "ENV" => stage.ops.push(Op::Env(rest.to_string(), start)),
            "RUN" => {
                let secret = rest
                    .split_whitespace()
                    .take_while(|w| w.starts_with("--"))
                    .any(|w| w.starts_with("--mount=") && w.contains("type=secret"));
                stage.ops.push(Op::Run(rest.to_string(), secret, start));
            }
            _ => {}
        }
    }
    if out.is_empty() {
        return Err("it has no FROM".into());
    }
    Ok(out)
}

/// The stage built: the one `target` names, else the last. None when `target`
/// names no stage.
fn built_stage(stages: &[Stage], target: Option<&str>) -> Option<usize> {
    match target {
        Some(t) => {
            let t = t.to_lowercase();
            stages
                .iter()
                .position(|s| s.name.as_deref() == Some(t.as_str()))
        }
        None => Some(stages.len() - 1),
    }
}

/// The earlier stage a stage is built `FROM`, by its name or its number.
fn parent(stages: &[Stage], i: usize) -> Option<usize> {
    let base = &stages[i].base;
    stages[..i]
        .iter()
        .position(|s| s.name.as_deref() == Some(base.as_str()))
        .or_else(|| base.parse::<usize>().ok().filter(|n| *n < i))
}

/// The stages an image of stage `i` holds the layers of: it, and those it is built
/// `FROM`, nearest first.
fn chain(stages: &[Stage], i: usize) -> Vec<usize> {
    let mut out = vec![i];
    let mut at = i;
    while let Some(p) = parent(stages, at) {
        if out.len() > MAX_STAGES || out.contains(&p) {
            break;
        }
        out.push(p);
        at = p;
    }
    out
}

/// Who a `USER` (or compose `user:`) value runs as.
#[derive(Debug, Clone, PartialEq, Eq)]
enum User {
    Root,
    Other,
    Unknown(String),
}

fn user(value: &str) -> User {
    let v = value.trim().trim_matches(['"', '\'']);
    let name = v.split(':').next().unwrap_or(v);
    if name.contains('$') {
        User::Unknown(format!("the user is `{v}`, set by a variable"))
    } else if name.is_empty() {
        User::Unknown("the user is empty".into())
    } else if name == "root" || name == "0" {
        User::Root
    } else {
        User::Other
    }
}

/// Who the built stage runs as: root, with the line and what was read; another user;
/// or not told, with why.
fn runs_as(stages: &[Stage], target: usize) -> Result<Option<(u32, String)>, String> {
    for i in chain(stages, target) {
        let last = stages[i].ops.iter().rev().find_map(|op| match op {
            Op::User(u, line) => Some((u.clone(), *line)),
            _ => None,
        });
        if let Some((u, line)) = last {
            return match user(&u) {
                User::Root => Ok(Some((line, format!("USER {u}")))),
                User::Other => Ok(None),
                User::Unknown(why) => Err(why),
            };
        }
        if parent(stages, i).is_some() {
            continue;
        }
        let base = &stages[i].base;
        if base == "scratch" {
            return Ok(Some((stages[target].line, "no USER, FROM scratch".into())));
        }
        return Err(if base.contains('$') {
            format!("no USER, and the base image `{base}` is set by a build argument")
        } else {
            format!("no USER, and the base image {base} may set one: Drift does not read images")
        });
    }
    Err("its stages are built from each other further than Drift follows".into())
}

/// The text names the variable `name` (`$NAME`, `${NAME}`, `${NAME:-x}`).
fn names_variable(text: &str, name: &str) -> bool {
    let bytes = text.as_bytes();
    for (at, _) in text.match_indices('$') {
        let rest = &text[at + 1..];
        let (inner, braced) = match rest.strip_prefix('{') {
            Some(r) => (r, true),
            None => (rest, false),
        };
        if let Some(after) = inner.strip_prefix(name) {
            let next = after.chars().next();
            let ends = match braced {
                true => matches!(next, Some('}' | ':' | '-' | '+' | '?')),
                false => !next.is_some_and(|c| c.is_ascii_alphanumeric() || c == '_'),
            };
            // Not `$$NAME`, which is a literal dollar in compose.
            if ends && !(at > 0 && bytes[at - 1] == b'$') {
                return true;
            }
        }
    }
    false
}

/// Where the built stage's layers read the build argument `arg`: the first line, and
/// `ENV`, `RUN` or both. None when nothing it ships reads it.
fn reads_arg(stages: &[Stage], target: usize, arg: &str) -> Option<(u32, String)> {
    let mut first: Option<u32> = None;
    let mut what: BTreeSet<&str> = BTreeSet::new();
    for i in chain(stages, target) {
        let mut declared = false;
        for op in &stages[i].ops {
            match op {
                Op::Arg(names) if names.iter().any(|n| n == arg) => declared = true,
                Op::Env(text, line) if declared && names_variable(text, arg) => {
                    first = Some(first.map_or(*line, |f| f.min(*line)));
                    what.insert("ENV");
                }
                Op::Run(text, false, line) if declared && names_variable(text, arg) => {
                    first = Some(first.map_or(*line, |f| f.min(*line)));
                    what.insert("RUN");
                }
                _ => {}
            }
        }
    }
    first.map(|l| (l, what.into_iter().collect::<Vec<_>>().join(" and ")))
}

/// An image build Drift found, and what it gives the build.
struct Build {
    /// The Dockerfile, repo-relative.
    dockerfile: String,
    target: Option<String>,
    built_by: String,
    /// Build arguments given a secret: the name, and the secret as read.
    secret_args: Vec<(String, String)>,
}

/// Reads one build for `build_secret` (the arguments it is given a secret in).
fn check_build(b: &Build, load: &dyn Fn(&str) -> Option<String>, out: &mut Read) {
    if b.secret_args.is_empty() {
        return;
    }
    let read = load(&b.dockerfile)
        .ok_or_else(|| format!("{} is not in the repository or is not read", b.dockerfile))
        .and_then(|t| stages(&t));
    let st = match read {
        Ok(st) => st,
        Err(why) => {
            out.not_checked.push(NotChecked {
                kind: "build_secret".into(),
                path: b.dockerfile.clone(),
                line: 1,
                subject: b.built_by.clone(),
                why,
            });
            return;
        }
    };
    let Some(target) = built_stage(&st, b.target.as_deref()) else {
        return;
    };
    for (arg, secret) in &b.secret_args {
        if let Some((line, what)) = reads_arg(&st, target, arg) {
            out.images.push(ImageHardening {
                kind: "build_secret".into(),
                path: b.dockerfile.clone(),
                line,
                built_by: b.built_by.clone(),
                detail: format!("ARG {arg} given {secret}, read by {what}"),
            });
        }
    }
}

/// `rel` read from the directory `dir`, normalised; None when it is absolute, a URL,
/// holds a variable or leaves the repository.
fn join(dir: &str, rel: &str) -> Option<String> {
    let rel = rel.trim();
    if rel.starts_with('/') || rel.contains("://") || rel.contains('$') || rel.contains("${{") {
        return None;
    }
    let mut parts: Vec<&str> = dir
        .split('/')
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    for p in rel.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

// ---------- compose services ----------

fn str_of(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::to_string)
}

/// The 1-based line of the first line holding `needle` at or after the line that
/// holds `after` (the first that does); 1 where none.
fn line_after(text: &str, after: &str, needle: &str) -> u32 {
    let from = line_from(text, 0, after).unwrap_or(0);
    line_from(text, from, needle).map_or(from as u32 + 1, |i| i as u32 + 1)
}

/// The variables a compose file's top-level `secrets:` read their values from
/// (`secrets: { npm: { environment: NPM_TOKEN } }`), each with the secret's name.
fn compose_secret_vars(doc: &Value) -> BTreeMap<String, String> {
    doc.get("secrets")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(name, def)| {
            let var = def.get("environment")?.as_str()?;
            Some((var.to_string(), format!("compose secret {name}")))
        })
        .collect()
}

/// A compose service's build arguments that `secret` says are a secret: a value that
/// names a variable it knows (`TOKEN: ${NPM_TOKEN}`), or a name given with no value,
/// which compose takes from the variable of that name.
fn secret_args(build: &Value, secret: &dyn Fn(&str) -> Option<String>) -> Vec<(String, String)> {
    let pairs: Vec<(String, Option<String>)> = match build.get("args") {
        Some(Value::Object(m)) => m
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().map(str::to_string)))
            .collect(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(Value::as_str)
            .map(|s| match s.split_once('=') {
                Some((k, v)) => (k.to_string(), Some(v.to_string())),
                None => (s.to_string(), None),
            })
            .collect(),
        _ => Vec::new(),
    };
    let mut out = Vec::new();
    for (k, v) in pairs {
        match v {
            None => {
                if let Some(s) = secret(&k) {
                    out.push((k, s));
                }
            }
            Some(v) => {
                if let Some(s) = shell_vars(&v).iter().find_map(|var| secret(var)) {
                    out.push((k, s));
                }
            }
        }
    }
    out
}

/// The variables a text names (`$X`, `${X}`, `${X:-y}`), in order.
fn shell_vars(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (at, _) in text.match_indices('$') {
        let rest = &text[at + 1..];
        let rest = rest.strip_prefix('{').unwrap_or(rest);
        let name: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if !name.is_empty() && !name.starts_with(|c: char| c.is_ascii_digit()) {
            out.push(name);
        }
    }
    out
}

/// The builds of the compose file `rel`: each service with a `build` of the
/// repository, with the arguments `secret` (and the file's own secrets) make secret.
/// `only` keeps the services named, where any is.
#[allow(clippy::too_many_arguments)]
fn compose_builds(
    root: Option<&Path>,
    rel: &str,
    text: &str,
    secret: &dyn Fn(&str) -> Option<String>,
    built_by: &dyn Fn(&str) -> String,
    only: &[String],
    out: &mut Read,
    root_user: bool,
    load: &dyn Fn(&str) -> Option<String>,
) -> Vec<Build> {
    let Ok(mut doc) = serde_saphyr::from_str::<Value>(text) else {
        return Vec::new();
    };
    // What the file includes and extends, put in; a root decides where from.
    let _ = crate::compose::resolve(root, rel, &mut doc);
    let own = compose_secret_vars(&doc);
    let secret = |var: &str| -> Option<String> {
        own.get(var)
            .map(|s| format!("{s} (variable {var})"))
            .or_else(|| secret(var))
    };
    let base = rel.rsplit_once('/').map_or("", |(d, _)| d);
    let mut builds = Vec::new();
    for (svc, def) in doc
        .get("services")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if !only.is_empty() && !only.contains(svc) {
            continue;
        }
        let Some(build) = def.get("build") else {
            continue;
        };
        let who = built_by(svc);
        let (context, dockerfile, target) = match build {
            Value::String(c) => (c.clone(), None, None),
            Value::Object(b) => (
                str_of(b.get("context")).unwrap_or_else(|| ".".into()),
                str_of(b.get("dockerfile")),
                str_of(b.get("target")),
            ),
            _ => continue,
        };
        let df = join(base, &context)
            .and_then(|c| join(&c, dockerfile.as_deref().unwrap_or("Dockerfile")));
        let Some(df) = df else {
            if root_user {
                out.not_checked.push(NotChecked {
                    kind: "root_user".into(),
                    path: rel.to_string(),
                    line: line_after(text, &format!("{svc}:"), "build"),
                    subject: who,
                    why: format!(
                        "it builds from `{context}`{}, which is not a path of the repository",
                        dockerfile
                            .map(|d| format!(" with `{d}`"))
                            .unwrap_or_default()
                    ),
                });
            }
            continue;
        };
        if root_user {
            service_user(rel, text, svc, def, &df, target.as_deref(), &who, load, out);
        }
        builds.push(Build {
            dockerfile: df,
            target,
            built_by: who,
            secret_args: secret_args(build, &secret),
        });
    }
    builds
}

/// The `root_user` reading of one compose service.
#[allow(clippy::too_many_arguments)]
fn service_user(
    rel: &str,
    text: &str,
    svc: &str,
    def: &Value,
    dockerfile: &str,
    target: Option<&str>,
    who: &str,
    load: &dyn Fn(&str) -> Option<String>,
    out: &mut Read,
) {
    let not_checked = |out: &mut Read, path: &str, line: u32, why: String| {
        out.not_checked.push(NotChecked {
            kind: "root_user".into(),
            path: path.to_string(),
            line,
            subject: who.to_string(),
            why,
        });
    };
    // The service's own `user:` decides over the image's.
    if let Some(u) = def.get("user") {
        let u = u.as_str().map_or_else(|| u.to_string(), str::to_string);
        let line = line_after(text, &format!("{svc}:"), "user:");
        match user(&u) {
            User::Root => out.images.push(ImageHardening {
                kind: "root_user".into(),
                path: rel.to_string(),
                line,
                built_by: who.to_string(),
                detail: format!("user: {u}"),
            }),
            User::Other => {}
            User::Unknown(why) => not_checked(out, rel, line, why),
        }
        return;
    }
    let st = match load(dockerfile)
        .ok_or_else(|| format!("{dockerfile} is not in the repository or is not read"))
        .and_then(|t| stages(&t))
    {
        Ok(st) => st,
        Err(why) => return not_checked(out, dockerfile, 1, why),
    };
    let Some(i) = built_stage(&st, target) else {
        let t = target.unwrap_or_default();
        return not_checked(
            out,
            dockerfile,
            1,
            format!("its target `{t}` is no stage of it"),
        );
    };
    match runs_as(&st, i) {
        Ok(Some((line, detail))) => out.images.push(ImageHardening {
            kind: "root_user".into(),
            path: dockerfile.to_string(),
            line,
            built_by: who.to_string(),
            detail,
        }),
        Ok(None) => {}
        Err(why) => not_checked(out, dockerfile, st[i].line, why),
    }
}

/// The compose files that deploy a service: every one Drift reads, but those
/// `security.not_deployed` leaves out.
fn compose_images(root: &Path, load: &dyn Fn(&str) -> Option<String>, out: &mut Read) {
    let not_deployed = crate::policy::DriftConfig::load(root)
        .map(|c| c.security.not_deployed)
        .unwrap_or_default();
    for rel in crate::security::compose_files(root) {
        let left = not_deployed
            .iter()
            .any(|p| p.is_empty() || rel == *p || rel.starts_with(&format!("{p}/")));
        if left {
            continue;
        }
        let Some(text) = load(&rel) else {
            continue;
        };
        let built_by = |svc: &str| format!("{rel} service {svc}");
        let builds = compose_builds(
            Some(root),
            &rel,
            &text,
            &|_| None,
            &built_by,
            &[],
            out,
            true,
            load,
        );
        for b in &builds {
            check_build(b, load, out);
        }
    }
}

// ---------- builds a workflow runs ----------

/// The `env:` of a mapping, as names and values.
fn env_of(v: &Value) -> BTreeMap<String, String> {
    v.get("env")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
        .collect()
}

/// The secret an expression text reads (`secrets.NPM_TOKEN`), or an `env.X` it reads
/// that `env` gives a secret.
fn secret_in(text: &str, env: &BTreeMap<String, String>) -> Option<String> {
    for e in expressions(text) {
        if let Some(at) = e.find("secrets.") {
            let name: String = e[at..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
                .collect();
            return Some(name);
        }
        if let Some(var) = e.strip_prefix("env.")
            && let Some(s) = env.get(var.trim()).and_then(|v| secret_in(v, env))
        {
            return Some(format!("{s} through env {}", var.trim()));
        }
    }
    None
}

/// A secret a shell value carries: one interpolated into it, or a variable it names
/// that `env` gives a secret.
fn secret_value(v: &str, env: &BTreeMap<String, String>) -> Option<String> {
    secret_in(v, env).or_else(|| {
        shell_vars(v).iter().find_map(|var| {
            env.get(var)
                .and_then(|x| secret_in(x, env))
                .map(|s| format!("{s} through env {var}"))
        })
    })
}

/// The text with the spaces inside each `${{ ... }}` taken out, so that an
/// expression is one word of a shell line.
fn tight(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("${{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 3..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            return out;
        };
        out.push_str("${{");
        out.extend(after[..end].chars().filter(|c| !c.is_whitespace()));
        out.push_str("}}");
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

/// The words of a shell command line, quotes taken off a word.
fn shell_words(line: &str) -> Vec<String> {
    line.split_whitespace()
        .map(|w| w.trim_matches(['"', '\'']).to_string())
        .collect()
}

/// Flags of `docker build` that take a value as the next word.
const VALUED: &[&str] = &[
    "-t",
    "--tag",
    "--platform",
    "--label",
    "--cache-from",
    "--cache-to",
    "--secret",
    "-o",
    "--output",
    "--progress",
    "--network",
    "--builder",
    "--iidfile",
    "--metadata-file",
    "--ssh",
    "--build-context",
    "--annotation",
    "--attest",
    "--add-host",
    "--shm-size",
    "--ulimit",
    "-m",
    "--memory",
];

/// The builds of one workflow file that hand an image build a secret.
fn workflow_builds(rel: &str, text: &str, load: &dyn Fn(&str) -> Option<String>, out: &mut Read) {
    let Ok(doc) = serde_saphyr::from_str::<Value>(text) else {
        return;
    };
    let wf_env = env_of(&doc);
    let run_dir = |v: &Value| {
        v.get("defaults")
            .and_then(|d| d.get("run"))
            .and_then(|r| r.get("working-directory"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let wf_dir = run_dir(&doc);
    for (job, body) in doc
        .get("jobs")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let job_dir = run_dir(body).or_else(|| wf_dir.clone());
        let mut job_env = wf_env.clone();
        job_env.extend(env_of(body));
        let built_by = format!("{rel} job {job}");
        for step in body
            .get("steps")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let mut env = job_env.clone();
            env.extend(env_of(step));
            let uses = step.get("uses").and_then(Value::as_str).unwrap_or_default();
            if uses.split('@').next() == Some("docker/build-push-action") {
                let with = step.get("with");
                let input = |k: &str| with.and_then(|w| w.get(k)).and_then(Value::as_str);
                let args: Vec<(String, String)> = input("build-args")
                    .unwrap_or_default()
                    .lines()
                    .filter_map(|l| l.trim().split_once('='))
                    .filter_map(|(k, v)| Some((k.trim().to_string(), secret_in(v, &env)?)))
                    .collect();
                if args.is_empty() {
                    continue;
                }
                let context = input("context").unwrap_or(".");
                // The file is read from the workspace; by default, the context's.
                let df = match input("file") {
                    Some(f) => join("", f),
                    None => join("", context).and_then(|c| join(&c, "Dockerfile")),
                };
                push_build(df, input("target"), &built_by, args, rel, out, load);
                continue;
            }
            let Some(run) = step.get("run").and_then(Value::as_str) else {
                continue;
            };
            let dir = step
                .get("working-directory")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| job_dir.clone())
                .unwrap_or_default();
            let script = tight(&run.replace("\\\r\n", " ").replace("\\\n", " "));
            for line in script.lines() {
                for part in line.split(['&', ';', '|']) {
                    let words = shell_words(part);
                    shell_build(&words, &dir, &env, &built_by, rel, load, out);
                }
            }
        }
    }
}

fn push_build(
    dockerfile: Option<String>,
    target: Option<&str>,
    built_by: &str,
    secret_args: Vec<(String, String)>,
    rel: &str,
    out: &mut Read,
    load: &dyn Fn(&str) -> Option<String>,
) {
    match dockerfile {
        Some(df) => check_build(
            &Build {
                dockerfile: df,
                target: target.map(str::to_string),
                built_by: built_by.to_string(),
                secret_args,
            },
            load,
            out,
        ),
        None => out.not_checked.push(NotChecked {
            kind: "build_secret".into(),
            path: rel.to_string(),
            line: 1,
            subject: built_by.to_string(),
            why: "it builds an image given a secret from a Dockerfile whose path Drift cannot tell"
                .into(),
        }),
    }
}

/// One command of a shell step: `docker build` / `docker buildx build` /
/// `podman build` with `--build-arg`s, or `docker compose build` / `up` with a
/// secret in the step's environment.
fn shell_build(
    words: &[String],
    dir: &str,
    env: &BTreeMap<String, String>,
    built_by: &str,
    rel: &str,
    load: &dyn Fn(&str) -> Option<String>,
    out: &mut Read,
) {
    let Some(prog) = words.iter().position(|w| {
        let p = w.rsplit('/').next().unwrap_or(w);
        matches!(p, "docker" | "podman" | "docker-compose")
    }) else {
        return;
    };
    let rest = &words[prog + 1..];
    let compose =
        words[prog].ends_with("docker-compose") || rest.first().is_some_and(|w| w == "compose");
    if compose {
        let mut files: Vec<String> = Vec::new();
        let mut sub: Option<usize> = None;
        let mut i = usize::from(!words[prog].ends_with("docker-compose"));
        while i < rest.len() {
            let w = rest[i].as_str();
            if w == "-f" || w == "--file" {
                files.extend(rest.get(i + 1).cloned());
                i += 2;
                continue;
            }
            if let Some(f) = w.strip_prefix("--file=") {
                files.push(f.to_string());
            } else if !w.starts_with('-') && sub.is_none() {
                sub = Some(i);
                if !matches!(w, "build" | "up") {
                    return;
                }
            }
            i += 1;
        }
        let Some(sub) = sub else {
            return;
        };
        let services: Vec<String> = rest[sub + 1..]
            .iter()
            .filter(|w| !w.starts_with('-'))
            .cloned()
            .collect();
        let secret = |var: &str| -> Option<String> {
            env.get(var)
                .and_then(|v| secret_in(v, env))
                .map(|s| format!("{s} through env {var}"))
        };
        if !env.keys().any(|k| secret(k).is_some()) {
            return;
        }
        let paths: Vec<String> = if files.is_empty() {
            crate::security::COMPOSE_FILES
                .iter()
                .filter_map(|n| join(dir, n))
                .find(|p| load(p).is_some())
                .into_iter()
                .collect()
        } else {
            files.iter().filter_map(|f| join(dir, f)).collect()
        };
        for path in paths {
            let Some(text) = load(&path) else {
                continue;
            };
            let by = |svc: &str| format!("{built_by} (docker compose, {path} service {svc})");
            let builds = compose_builds(
                None, &path, &text, &secret, &by, &services, out, false, load,
            );
            for b in &builds {
                check_build(b, load, out);
            }
        }
        return;
    }
    let Some(build) = rest.iter().position(|w| w == "build").filter(|b| {
        rest[..*b]
            .iter()
            .all(|w| matches!(w.as_str(), "buildx" | "image"))
    }) else {
        return;
    };
    let mut args: Vec<(String, String)> = Vec::new();
    let mut file: Option<String> = None;
    let mut target: Option<String> = None;
    let mut positional: Vec<String> = Vec::new();
    let flags = &rest[build + 1..];
    let mut i = 0;
    while i < flags.len() {
        let w = flags[i].as_str();
        let (flag, value, step) = match w.split_once('=') {
            Some((f, v)) if f.starts_with('-') => (f, Some(v.to_string()), 1),
            _ if w.starts_with('-') => (w, flags.get(i + 1).cloned(), 2),
            _ => {
                positional.push(w.to_string());
                i += 1;
                continue;
            }
        };
        match flag {
            "--build-arg" => {
                if let Some(v) = &value {
                    match v.split_once('=') {
                        Some((k, val)) => {
                            if let Some(s) = secret_value(val, env) {
                                args.push((k.to_string(), s));
                            }
                        }
                        None => {
                            if let Some(s) = env.get(v.as_str()).and_then(|x| secret_in(x, env)) {
                                args.push((v.clone(), format!("{s} through env {v}")));
                            }
                        }
                    }
                }
                i += step;
            }
            "-f" | "--file" => {
                file = value;
                i += step;
            }
            "--target" => {
                target = value;
                i += step;
            }
            f if VALUED.contains(&f) => i += step,
            _ => i += 1,
        }
    }
    if args.is_empty() {
        return;
    }
    let context = positional.last().cloned().unwrap_or_else(|| ".".into());
    let df = match file.as_deref() {
        Some("-") => None,
        Some(f) => join(dir, f),
        None => join(dir, &context).and_then(|c| join(&c, "Dockerfile")),
    };
    push_build(df, target.as_deref(), built_by, args, rel, out, load);
}

// ---------- what `drift security` prints ----------

/// The sections of `drift security`'s text for these readings, after the workflow
/// findings: what is found, then what is not checked. `only` keeps the files named.
pub fn render(
    out: &mut String,
    inv: &crate::security::Inventory,
    only: Option<&BTreeSet<String>>,
    max_rows: usize,
) {
    let keep = |p: &str| only.is_none_or(|o| o.contains(p));
    let workflows: Vec<&WorkflowHardening> = inv
        .workflow_hardening
        .iter()
        .filter(|w| keep(&w.path))
        .collect();
    if !workflows.is_empty() {
        let _ = writeln!(
            out,
            "\nCI workflows an outsider can start, with what they leave unstated (advice)"
        );
        for w in workflows.iter().take(max_rows) {
            let what = match w.kind.as_str() {
                "unstated_permissions" => {
                    let grade = match w.grade.as_deref() {
                        Some("runs_pull_request_code") => "; the job runs the pull request's code",
                        Some("event_text_in_script") => {
                            "; the job writes text of the event into a script"
                        }
                        _ => "",
                    };
                    format!(
                        "states no permissions, so its token has what the repository's default gives (Drift cannot read that setting){grade}"
                    )
                }
                _ => "runs on a self-hosted runner".to_string(),
            };
            let _ = writeln!(
                out,
                "  {}:{}  job {} on {} {what}: {}",
                sanitize(&w.path, 160),
                w.line,
                sanitize(&w.job, 80),
                sanitize(&w.on, 80),
                sanitize(&w.detail, 160)
            );
        }
        if workflows.len() > max_rows {
            let _ = writeln!(out, "  ... and {} more", workflows.len() - max_rows);
        }
    }
    let images: Vec<&ImageHardening> = inv
        .image_hardening
        .iter()
        .filter(|i| keep(&i.path))
        .collect();
    if !images.is_empty() {
        let _ = writeln!(out, "\nImages built to deploy, and what they hold (advice)");
        for i in images.iter().take(max_rows) {
            let what = match i.kind.as_str() {
                "root_user" => "runs as root",
                _ => "writes a secret into the image's layers",
            };
            let _ = writeln!(
                out,
                "  {}:{}  for {} {what}: {}",
                sanitize(&i.path, 160),
                i.line,
                sanitize(&i.built_by, 160),
                sanitize(&i.detail, 160)
            );
        }
        if images.len() > max_rows {
            let _ = writeln!(out, "  ... and {} more", images.len() - max_rows);
        }
    }
    let unknown: Vec<&NotChecked> = inv
        .hardening_not_checked
        .iter()
        .filter(|n| keep(&n.path))
        .collect();
    if !unknown.is_empty() {
        let _ = writeln!(
            out,
            "\nNot checked for a stated token, a self-hosted runner, a root user or a baked secret ({}): unknown, not findings",
            unknown.len()
        );
        for n in unknown.iter().take(max_rows) {
            let _ = writeln!(
                out,
                "  {}:{}  {} [{}]: {}",
                sanitize(&n.path, 160),
                n.line,
                sanitize(&n.subject, 160),
                n.kind,
                sanitize(&n.why, 200)
            );
        }
        if unknown.len() > max_rows {
            let _ = writeln!(out, "  ... and {} more", unknown.len() - max_rows);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files<'a>(list: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |p| {
            list.iter()
                .find(|(n, _)| *n == p)
                .map(|(_, t)| t.to_string())
        }
    }

    fn workflow(text: &str, others: &[(&str, &str)]) -> Read {
        let mut out = Read::default();
        read_workflow(".github/workflows/x.yml", text, &files(others), &mut out);
        out
    }

    fn kinds(r: &Read) -> Vec<(String, String, String)> {
        let mut out: Vec<_> = r
            .workflows
            .iter()
            .map(|w| (w.kind.clone(), w.job.clone(), w.detail.clone()))
            .collect();
        out.sort();
        out
    }

    /// Pins the token reading: a workflow on an event that runs with the base
    /// repository's token, where neither it nor the job states `permissions`, is a
    /// finding graded by what the job does; a job or a workflow that states any
    /// (even `{}`) is not, and an event that runs without the base token is not.
    #[test]
    fn a_privileged_job_with_no_stated_permissions_is_found_and_graded() {
        let text = "on: pull_request_target
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - run: npm test
  label:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
  narrow:
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - run: echo hi
";
        let r = workflow(text, &[]);
        assert_eq!(
            kinds(&r),
            [
                (
                    "unstated_permissions".to_string(),
                    "label".to_string(),
                    "permissions not stated".to_string()
                ),
                (
                    "unstated_permissions".to_string(),
                    "test".to_string(),
                    "permissions not stated".to_string()
                ),
            ]
        );
        let test = r.workflows.iter().find(|w| w.job == "test").unwrap();
        assert_eq!(test.grade.as_deref(), Some("runs_pull_request_code"));
        assert_eq!(test.line, 3);
        assert_eq!(test.on, "pull_request_target");
        assert_eq!(
            r.workflows.iter().find(|w| w.job == "label").unwrap().grade,
            None
        );
        // Stated by the workflow: every job narrows.
        assert!(
            workflow(
                &text.replace("jobs:", "permissions:\n  contents: read\njobs:"),
                &[]
            )
            .workflows
            .is_empty()
        );
        // `pull_request` runs with a read-only token for a fork: not this finding.
        assert!(
            workflow(&text.replace("pull_request_target", "pull_request"), &[])
                .workflows
                .is_empty()
        );
        assert!(
            workflow(&text.replace("pull_request_target", "push"), &[])
                .workflows
                .is_empty()
        );
    }

    /// Pins the reusable call: the token is handed to the workflow called, so a
    /// workflow of the repository that states permissions narrows it, one that does
    /// not is named, and one of another repository is not checked.
    #[test]
    fn a_reusable_workflow_call_is_followed_for_the_token() {
        let caller = "on: issue_comment
jobs:
  call:
    uses: ./.github/workflows/ci.yml
  remote:
    uses: someone/w/.github/workflows/ci.yml@v1
";
        let open = workflow(
            caller,
            &[(
                ".github/workflows/ci.yml",
                "on: workflow_call\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n",
            )],
        );
        assert_eq!(
            kinds(&open),
            [(
                "unstated_permissions".to_string(),
                "call".to_string(),
                "permissions not stated, nor by ./.github/workflows/ci.yml job build".to_string()
            )]
        );
        let mut unread: Vec<_> = open
            .not_checked
            .iter()
            .map(|n| (n.kind.as_str(), n.subject.as_str()))
            .collect();
        unread.sort();
        assert_eq!(
            unread,
            [
                ("self_hosted_runner", "job remote"),
                ("unstated_permissions", "job remote")
            ]
        );
        let narrow = workflow(
            caller,
            &[(
                ".github/workflows/ci.yml",
                "on: workflow_call\njobs:\n  build:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: make\n",
            )],
        );
        assert!(narrow.workflows.is_empty(), "{:?}", narrow.workflows);
    }

    /// Pins the runner reading: `self-hosted` named alone, in a list, in a group's
    /// labels or in a matrix's values is found on an event a fork starts; a hosted
    /// image's label is not; an expression and a custom label are not checked.
    #[test]
    fn a_self_hosted_runner_on_a_fork_event_is_found_and_an_expression_is_unknown() {
        let text = "on: pull_request
jobs:
  a:
    runs-on: self-hosted
    steps: [{run: make}]
  b:
    runs-on: [self-hosted, linux, x64]
    steps: [{run: make}]
  c:
    runs-on:
      group: big
      labels: [self-hosted]
    steps: [{run: make}]
  d:
    strategy:
      matrix:
        os: [ubuntu-latest, self-hosted]
    runs-on: ${{ matrix.os }}
    steps: [{run: make}]
  e:
    runs-on: ubuntu-24.04
    steps: [{run: make}]
  f:
    runs-on: ${{ inputs.runner }}
    steps: [{run: make}]
  g:
    runs-on: gpu-box
    steps: [{run: make}]
  h:
    strategy:
      matrix: ${{ fromJSON(needs.plan.outputs.m) }}
    runs-on: ${{ matrix.os }}
    steps: [{run: make}]
";
        let r = workflow(text, &[]);
        assert_eq!(
            kinds(&r),
            [
                (
                    "self_hosted_runner".to_string(),
                    "a".to_string(),
                    "self-hosted".to_string()
                ),
                (
                    "self_hosted_runner".to_string(),
                    "b".to_string(),
                    "self-hosted, linux, x64".to_string()
                ),
                (
                    "self_hosted_runner".to_string(),
                    "c".to_string(),
                    "self-hosted".to_string()
                ),
                (
                    "self_hosted_runner".to_string(),
                    "d".to_string(),
                    "matrix.os: self-hosted".to_string()
                ),
            ]
        );
        assert_eq!(r.workflows.iter().find(|w| w.job == "a").unwrap().line, 4);
        let mut unknown: Vec<&str> = r.not_checked.iter().map(|n| n.subject.as_str()).collect();
        unknown.sort();
        assert_eq!(unknown, ["job f", "job g", "job h"]);
        // On `push` only the repository's own people start it: nothing.
        let push = workflow(&text.replace("on: pull_request", "on: push"), &[]);
        assert!(push.workflows.is_empty() && push.not_checked.is_empty());
    }

    const SERVICE: &str = "services:\n  api:\n    build: ./api\n    ports: [\"80:80\"]\n";

    fn images(list: &[(&str, &str)]) -> Read {
        let mut out = Read::default();
        let load = files(list);
        let text = load("compose.yaml").unwrap();
        let by = |svc: &str| format!("compose.yaml service {svc}");
        let builds = compose_builds(
            None,
            "compose.yaml",
            &text,
            &|_| None,
            &by,
            &[],
            &mut out,
            true,
            &load,
        );
        for b in &builds {
            check_build(b, &load, &mut out);
        }
        out
    }

    /// Pins the root reading: the built stage's last `USER` decides, followed through
    /// `FROM <earlier stage>`; no `USER` over a base image Drift cannot read is not
    /// checked (never root), over `scratch` it is root; a build-only stage says
    /// nothing; the service's own `user:` decides first.
    #[test]
    fn the_final_stage_of_a_deployed_image_running_as_root_is_found() {
        let root = images(&[
            ("compose.yaml", SERVICE),
            (
                "api/Dockerfile",
                "FROM node:20 AS build\nUSER node\nRUN npm ci\nFROM build AS run\nUSER root\nCMD [\"node\", \"x\"]\n",
            ),
        ]);
        assert_eq!(
            root.images
                .iter()
                .map(|i| (i.kind.as_str(), i.path.as_str(), i.line, i.detail.as_str()))
                .collect::<Vec<_>>(),
            [("root_user", "api/Dockerfile", 5, "USER root")]
        );
        // Through the earlier stage: its USER holds.
        let inherited = images(&[
            ("compose.yaml", SERVICE),
            (
                "api/Dockerfile",
                "FROM node:20 AS base\nUSER 0:0\nFROM base\nCMD [\"x\"]\n",
            ),
        ]);
        assert_eq!(inherited.images[0].detail, "USER 0:0");
        // A user that is not root, in the last stage only: nothing.
        let fine = images(&[
            ("compose.yaml", SERVICE),
            (
                "api/Dockerfile",
                "FROM node:20 AS build\nRUN npm ci\nFROM node:20-slim\nUSER node\n",
            ),
        ]);
        assert!(
            fine.images.is_empty() && fine.not_checked.is_empty(),
            "{fine:?}"
        );
        // No USER over a base Drift cannot read: unknown, said, not root.
        let unknown = images(&[
            ("compose.yaml", SERVICE),
            ("api/Dockerfile", "FROM python:3.13\nCMD [\"x\"]\n"),
        ]);
        assert!(unknown.images.is_empty());
        assert_eq!(unknown.not_checked.len(), 1);
        assert!(
            unknown.not_checked[0]
                .why
                .contains("python:3.13 may set one")
        );
        // FROM scratch sets no user.
        let scratch = images(&[
            ("compose.yaml", SERVICE),
            (
                "api/Dockerfile",
                "FROM golang:1 AS b\nUSER nobody\nFROM scratch\nCOPY --from=b /x /x\n",
            ),
        ]);
        assert_eq!(scratch.images[0].detail, "no USER, FROM scratch");
        // A target names the stage built: the root build stage is not it.
        let target = images(&[
            (
                "compose.yaml",
                "services:\n  api:\n    build:\n      context: api\n      target: run\n",
            ),
            (
                "api/Dockerfile",
                "FROM node:20 AS run\nUSER node\nFROM run AS debug\nUSER root\n",
            ),
        ]);
        assert!(target.images.is_empty(), "{target:?}");
        // The service's `user:` decides over the image.
        let said = images(&[
            (
                "compose.yaml",
                "services:\n  api:\n    build: ./api\n    user: \"1000\"\n",
            ),
            ("api/Dockerfile", "FROM node:20\nUSER root\n"),
        ]);
        assert!(said.images.is_empty() && said.not_checked.is_empty());
        let said = images(&[
            (
                "compose.yaml",
                "services:\n  api:\n    build: ./api\n    user: root\n",
            ),
            ("api/Dockerfile", "FROM node:20\nUSER node\n"),
        ]);
        assert_eq!(
            said.images
                .iter()
                .map(|i| (i.path.as_str(), i.line))
                .collect::<Vec<_>>(),
            [("compose.yaml", 4)]
        );
        // An image a service runs without building it is not this repository's.
        let pulled = images(&[("compose.yaml", "services:\n  db:\n    image: postgres:16\n")]);
        assert_eq!(pulled, Read::default());
    }

    /// Pins the secret reading: a build argument given a secret by construction and
    /// read by `ENV`, or by a `RUN` that mounts no secret, in a stage the image ships,
    /// is found; a name alone decides nothing, and a stage that is not shipped or a
    /// `RUN` that mounts the secret is not.
    #[test]
    fn a_secret_given_as_a_build_argument_and_read_into_a_layer_is_found() {
        let dockerfile = "FROM node:20 AS deps\nARG NPM_TOKEN\nRUN npm ci --token $NPM_TOKEN\nFROM node:20\nARG NPM_TOKEN\nARG SENTRY\nENV TOKEN=${NPM_TOKEN}\nRUN --mount=type=secret,id=s echo $SENTRY\nUSER node\n";
        let wf = "on: push
env:
  SENTRY: ${{ secrets.SENTRY_DSN }}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: |
          docker build \\
            --build-arg NPM_TOKEN=${{ secrets.NPM_TOKEN }} \\
            --build-arg SENTRY=$SENTRY \\
            --build-arg API_KEY=not-a-secret \\
            -t app -f docker/Dockerfile .
";
        let mut out = Read::default();
        let only_dockerfile = [("docker/Dockerfile", dockerfile)];
        let load = files(&only_dockerfile);
        workflow_builds(".github/workflows/x.yml", wf, &load, &mut out);
        assert_eq!(
            out.images
                .iter()
                .map(|i| (i.kind.as_str(), i.path.as_str(), i.line, i.detail.as_str()))
                .collect::<Vec<_>>(),
            [(
                "build_secret",
                "docker/Dockerfile",
                7,
                "ARG NPM_TOKEN given secrets.NPM_TOKEN, read by ENV"
            )]
        );
        assert_eq!(out.images[0].built_by, ".github/workflows/x.yml job build");

        // docker/build-push-action, through `env:`.
        let action = "on: push
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      TOKEN: ${{ secrets.NPM_TOKEN }}
    steps:
      - uses: docker/build-push-action@v6
        with:
          context: docker
          build-args: |
            NPM_TOKEN=${{ env.TOKEN }}
";
        let mut out = Read::default();
        workflow_builds(".github/workflows/x.yml", action, &load, &mut out);
        assert_eq!(out.images.len(), 1, "{out:?}");
        assert_eq!(
            out.images[0].detail,
            "ARG NPM_TOKEN given secrets.NPM_TOKEN through env TOKEN, read by ENV"
        );

        // A compose file whose own secret's variable is given as a build argument.
        let compose = images(&[
            (
                "compose.yaml",
                "services:\n  api:\n    build:\n      context: .\n      dockerfile: docker/Dockerfile\n      args:\n        NPM_TOKEN: ${NPM}\n        SENTRY: ${SENTRY}\nsecrets:\n  npm:\n    environment: NPM\n",
            ),
            ("docker/Dockerfile", dockerfile),
        ]);
        let secrets: Vec<&str> = compose
            .images
            .iter()
            .filter(|i| i.kind == "build_secret")
            .map(|i| i.detail.as_str())
            .collect();
        assert_eq!(
            secrets,
            ["ARG NPM_TOKEN given compose secret npm (variable NPM), read by ENV"]
        );

        // A workflow that runs `docker compose build` with the secret in its env.
        let up = "on: push
jobs:
  ship:
    runs-on: ubuntu-latest
    steps:
      - env:
          SENTRY: ${{ secrets.SENTRY_DSN }}
          NPM: ${{ secrets.NPM_TOKEN }}
        run: docker compose -f compose.yaml build api
";
        let mut out = Read::default();
        let with_compose = [
            (
                "compose.yaml",
                "services:\n  api:\n    build:\n      context: .\n      dockerfile: docker/Dockerfile\n      args:\n        NPM_TOKEN: ${NPM}\n  web:\n    build:\n      context: .\n      dockerfile: docker/Dockerfile\n      args: [NPM_TOKEN=$NPM]\n",
            ),
            ("docker/Dockerfile", dockerfile),
        ];
        let load = files(&with_compose);
        workflow_builds(".github/workflows/x.yml", up, &load, &mut out);
        assert_eq!(
            out.images
                .iter()
                .map(|i| (i.built_by.as_str(), i.detail.as_str()))
                .collect::<Vec<_>>(),
            [(
                ".github/workflows/x.yml job ship (docker compose, compose.yaml service api)",
                "ARG NPM_TOKEN given secrets.NPM_TOKEN through env NPM, read by ENV"
            )]
        );
    }

    #[test]
    fn a_dockerfile_is_read_through_continuations_and_heredocs() {
        let st = stages("# syntax=docker/dockerfile:1\nFROM --platform=$BUILDPLATFORM node:20 AS a\nRUN <<EOF\nUSER root\nEOF\nRUN echo \\\n  # a comment\n  $X\nUSER app\n").unwrap();
        assert_eq!(st.len(), 1);
        assert_eq!(st[0].base, "node:20");
        assert_eq!(
            st[0]
                .ops
                .iter()
                .filter(|o| matches!(o, Op::User(..)))
                .count(),
            1,
            "{st:?}"
        );
        assert!(names_variable("echo ${X:-y}", "X"));
        assert!(!names_variable("echo $XY", "X"));
        assert!(!names_variable("echo $$X", "X"));
        assert!(stages("# escape=`\nFROM a\n").is_err());
    }
}
