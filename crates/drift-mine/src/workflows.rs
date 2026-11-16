//! What a repository's CI workflows do with what an outsider controls
//! (`.github/workflows/*.yml`).
//!
//! Two things are read, each by what the workflow itself says:
//!
//! - **A workflow that runs for a pull request with the base repository's secrets
//!   and checks out the pull request's code** (`on: pull_request_target`,
//!   `workflow_run` or `issue_comment`, with a checkout whose `ref` is read off the
//!   pull request's head or number). The code that then builds or tests is whoever opened the pull
//!   request's, and runs with the repository's token and secrets.
//! - **Text of the event interpolated into a shell step** (`run: echo "${{
//!   github.event.pull_request.title }}"`). The expression is replaced before the
//!   shell reads the line: whoever wrote the title wrote part of the script.
//!   Numbers and commit ids of the event are not text anyone chooses, and an
//!   expression handed through `env:` is a value, not script. The expression is
//!   read as the platform reads it: `github.event['pull_request']['title']` is
//!   `github.event.pull_request.title`, and the whole event handed to a function
//!   (`toJSON(github.event)`) holds every text of it.
//!
//! - **An action of another owner named by a tag or a branch, in a job that holds
//!   secrets or may write** (`uses: someone/deploy@v2` beside `${{ secrets.TOKEN
//!   }}`, or under `permissions: contents: write`). A tag is whatever its owner
//!   points it at next: the code that runs with the job's secrets is not the code
//!   that was reviewed. A reusable workflow a job calls (`jobs.<id>.uses`, given
//!   `secrets: inherit` or secrets by name) is read as a step's action is. An
//!   action named by a full commit, one of the repository
//!   itself (`./`) and the platform's own (`actions/`, `github/`) are not listed.
//!   One of the repository's own owner (`acme/actions/build@v1` in a clone whose
//!   `origin` is `github.com/acme/app`) is listed and said to be the owner's own
//!   ([`WorkflowFinding::own_owner`]), never left out: the owner is read off the
//!   clone's remote, which a fork, a mirror or a clone with no remote names
//!   differently, and what the baseline holds and `drift check` fails must be the
//!   same for one commit in every clone.
//! - **A download handed to an interpreter in a shell step** (`curl ... | sh`,
//!   `bash <(curl ...)`): what the remote server sends that day is what runs.
//!
//! Nothing is run and nothing outside the repository is read. A workflow that does
//! not parse is skipped.
//!
//! The same finding written more than once in one job (two steps interpolating the
//! same expression) is one finding each: from the second on, its detail ends in
//! ` (occurrence N in the job)`, so a baseline keyed by the detail holds each,
//! while the first keeps the detail an older Drift wrote ([`number_repeats`]).

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

/// The largest workflow file read.
const MAX_BYTES: u64 = 512 * 1024;

/// One thing a workflow does ([`read`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct WorkflowFinding {
    /// `untrusted_checkout`, `script_injection`, `unpinned_action` or
    /// `piped_download`.
    pub kind: String,
    pub path: String,
    pub line: u32,
    pub job: String,
    /// What was read: the `ref` checked out, the expression interpolated, the
    /// action as it is named, or the command that downloads.
    pub detail: String,
    /// `unpinned_action`: the action's owner is the repository's own, as this
    /// clone's `origin` remote names it on GitHub ([`repository_owner`]). Said
    /// beside the finding only: it is in no key a baseline holds, so it changes
    /// nothing a check fails on. False where the owner is another or not known
    /// (no such remote). Not serialised when false (additive).
    #[serde(skip_serializing_if = "is_false")]
    pub own_owner: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// Events whose workflow runs in the base repository, with its secrets, for
/// something an outsider sent. These are GitHub's own event names (its workflow
/// schema), not names of the repository's code. `issue_comment` runs so for a
/// comment on a pull request anyone can post: a workflow that then fetches the
/// pull request's head (`/ok-to-test`, then `git fetch origin pull/<number>/head`)
/// runs the outsider's code with the secrets.
const PRIVILEGED_EVENTS: &[&str] = &["pull_request_target", "workflow_run", "issue_comment"];

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
    let owner = repository_owner(root);
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
        out.extend(read_text_of(&rel, &text, owner.as_deref()));
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

/// The part of an expression that is text someone outside wrote, and what to find
/// its line by: [`dotted_outsiders_text`] as the expression is written, else as the
/// platform reads it ([`dotted`]: `github.event['issue']['title']` is
/// `github.event.issue.title`), else the whole event or context handed to a function
/// (`toJSON(github.event)`, which writes every text of the event). The first is the
/// detail an older Drift wrote, kept as it was so a baseline's keys still match.
fn outsiders_text(expression: &str) -> Option<(String, &str)> {
    if let Some(p) = dotted_outsiders_text(expression) {
        return Some((p.to_string(), p));
    }
    let read = dotted(expression);
    if let Some(p) = dotted_outsiders_text(&read) {
        return Some((p.to_string(), expression));
    }
    whole_context_given(&read).map(|p| (p, expression))
}

/// The expression with each member named in brackets by a quoted name
/// (`['title']`, `["title"]`) or `[*]` written as a dotted member (`.title`, `.*`),
/// as GitHub's expression syntax reads both. An index of anything else (`[0]`,
/// `[matrix.x]`) is left as written.
fn dotted(expression: &str) -> String {
    let mut out = String::with_capacity(expression.len());
    let mut rest = expression;
    while let Some(open) = rest.find('[') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let member = after.find(']').and_then(|close| {
            let inner = after[..close].trim();
            let name = if inner == "*" {
                Some(inner)
            } else {
                ['\'', '"'].iter().find_map(|q| {
                    inner
                        .strip_prefix(*q)
                        .and_then(|x| x.strip_suffix(*q))
                        .filter(|x| {
                            !x.is_empty()
                                && x.chars()
                                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
                        })
                })
            };
            name.map(|n| (n, close))
        });
        match member {
            Some((name, close)) => {
                out.push('.');
                out.push_str(name);
                rest = &after[close + 1..];
            }
            None => {
                out.push('[');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The whole event (`github.event`), or the whole `github` context, given as an
/// argument of a function (`toJSON(github.event)`, `format('{0}', github)`): what
/// the function writes holds every text of the event. (Interpolated alone, an
/// object is written as `Object`.)
fn whole_context_given(expression: &str) -> Option<String> {
    for (at, _) in expression.match_indices("github") {
        let before = expression[..at].trim_end();
        if !(before.ends_with('(') || before.ends_with(',')) {
            continue;
        }
        let rest = &expression[at..];
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')))
            .unwrap_or(rest.len());
        let p = &rest[..end];
        if p == "github" || p == "github.event" {
            return Some(p.to_string());
        }
    }
    None
}

/// The part of an expression, as written with dotted members, that is text someone
/// outside wrote: a path read off the event (`github.event.issue.title`) or the
/// pull request's branch name (`github.head_ref`), where its last member is no
/// number or id the platform assigns.
fn dotted_outsiders_text(expression: &str) -> Option<&str> {
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

/// Programs that fetch what a URL serves, and the interpreters that run what they
/// are handed on standard input or as a script: the commands themselves, not
/// names of the repository.
const DOWNLOADERS: &[&str] = &[
    "curl",
    "wget",
    "iwr",
    "Invoke-WebRequest",
    "Invoke-RestMethod",
];
const INTERPRETERS: &[&str] = &[
    "sh",
    "bash",
    "zsh",
    "dash",
    "ksh",
    "python",
    "python3",
    "node",
    "perl",
    "ruby",
    "pwsh",
    "powershell",
    "iex",
    "Invoke-Expression",
];

/// The program a shell command starts: its first word, past `sudo`, `env` and
/// assignments (`FOO=1 sudo -E bash -s`).
fn program(command: &str) -> &str {
    command
        .split_whitespace()
        .find(|w| {
            !matches!(*w, "sudo" | "env" | "exec" | "command" | "time")
                && !w.starts_with('-')
                && !(w.contains('=') && !w.starts_with('='))
        })
        .map(|w| w.rsplit('/').next().unwrap_or(w))
        .unwrap_or_default()
}

/// The command of a shell step that hands a download to an interpreter: a pipe
/// from a downloader into one (`curl -fsSL https://x | sudo bash`), or an
/// interpreter given what a downloader prints (`bash <(curl ...)`, `sh -c "$(curl
/// ...)"`). The line it is on, as written.
pub(crate) fn piped_download(run: &str) -> Option<&str> {
    for line in run.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        // A pipe, not `||`.
        let parts: Vec<&str> = line.split('|').collect();
        let piped = parts.windows(2).any(|w| {
            !w[0].is_empty()
                && !w[1].is_empty()
                && DOWNLOADERS.contains(&program(w[0].rsplit(['&', ';']).next().unwrap_or(w[0])))
                && INTERPRETERS.contains(&program(w[1]))
        });
        let substituted = INTERPRETERS.contains(&program(line))
            && DOWNLOADERS
                .iter()
                .any(|d| line.contains(&format!("$({d} ")) || line.contains(&format!("<({d} ")));
        if piped || substituted {
            return Some(line);
        }
    }
    None
}

/// The permissions grant a write (`write-all`, or any scope set to `write`).
fn grants_write(permissions: Option<&Value>) -> bool {
    match permissions {
        Some(Value::String(s)) => s == "write-all",
        Some(Value::Object(o)) => o.values().any(|v| v.as_str() == Some("write")),
        _ => false,
    }
}

/// Some string of the value reads a secret (`${{ secrets.X }}`).
fn reads_secret(v: &Value) -> bool {
    match v {
        Value::String(s) => expressions(s).iter().any(|e| e.contains("secrets.")),
        Value::Array(a) => a.iter().any(reads_secret),
        Value::Object(o) => o.values().any(reads_secret),
        _ => false,
    }
}

/// The owner of the repository at `root`, as its `origin` remote names it on
/// GitHub (`https://github.com/acme/app`, `git@github.com:acme/app.git`): what
/// `github.repository_owner` is when its workflows run from this clone. None where
/// the repository has no such remote, or its git directory is not read. A fork's
/// clone names the fork's owner: what this says only labels a finding
/// ([`WorkflowFinding::own_owner`]).
pub fn repository_owner(root: &Path) -> Option<String> {
    let dot = root.join(".git");
    // A worktree or a submodule: `.git` is a file naming the git directory.
    let config = if dot.is_file() {
        let text = std::fs::read_to_string(&dot).ok()?;
        let dir = text.trim().strip_prefix("gitdir:")?.trim().to_string();
        let dir = root.join(dir);
        // A worktree's own directory holds no config: its common directory does.
        let common = std::fs::read_to_string(dir.join("commondir"))
            .ok()
            .map(|c| dir.join(c.trim()));
        std::fs::read_to_string(common.unwrap_or(dir).join("config")).ok()?
    } else {
        std::fs::read_to_string(dot.join("config")).ok()?
    };
    origin_owner(&config)
}

/// The owner a git config's `origin` remote names on GitHub.
fn origin_owner(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_origin = t == "[remote \"origin\"]";
            continue;
        }
        if !in_origin {
            continue;
        }
        let Some((key, value)) = t.split_once('=') else {
            continue;
        };
        if key.trim() != "url" {
            continue;
        }
        return github_owner(value);
    }
    None
}

/// The owner a git remote URL names on GitHub: the first part of its path, where
/// its host is `github.com` itself. A URL is read as git reads one: with a scheme
/// (`https://github.com/acme/app`, `ssh://git@github.com:22/acme/app`), the host is
/// what comes between `scheme://` (and a `user@`) and the first `/` (a `:port`
/// apart); without one, the scp-like form `[user@]host:path`
/// (`git@github.com:acme/app.git`), where no `/` comes before the `:` (else it is a
/// local path). Any other host (`notgithub.com`, an enterprise host) is None.
fn github_owner(url: &str) -> Option<String> {
    let url = url.trim();
    let (authority, path) = match url.split_once("://") {
        Some((_, rest)) => rest.split_once('/').unwrap_or((rest, "")),
        None => {
            let (host, path) = url.split_once(':')?;
            if host.contains('/') {
                return None;
            }
            (host, path)
        }
    };
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = host.split(':').next().unwrap_or(host);
    if !host.eq_ignore_ascii_case("github.com") {
        return None;
    }
    let owner = path.trim_start_matches('/').split('/').next()?;
    (!owner.is_empty()).then(|| owner.to_string())
}

/// An action as a step names it is another owner's, named by what that owner can
/// move: not a path of the repository, not the platform's own, not a full commit and
/// not an image by its digest. (Whether its owner is the repository's own is said
/// beside it, [`of_owner`]: it depends on the clone.)
fn unpinned(uses: &str) -> bool {
    if uses.is_empty() || uses.starts_with("./") || uses.starts_with("../") {
        return false;
    }
    if let Some(image) = uses.strip_prefix("docker://") {
        return !image.contains("@sha256:");
    }
    let Some((action, version)) = uses.split_once('@') else {
        return false;
    };
    let of = action.split('/').next().unwrap_or_default();
    let commit = version.len() == 40 && version.chars().all(|c| c.is_ascii_hexdigit());
    !commit && !matches!(of, "actions" | "github")
}

/// The action `uses` names is of `owner` (the repository's own, where it is known).
fn of_owner(uses: &str, owner: Option<&str>) -> bool {
    let of = uses.split('@').next().unwrap_or_default().split('/').next();
    owner.is_some_and(|o| of.is_some_and(|of| o.eq_ignore_ascii_case(of)))
}

/// The 1-based line of the first line of `text` that holds `needle`; 1 where none.
fn line_of(text: &str, needle: &str) -> u32 {
    let needle = needle.lines().next().unwrap_or(needle).trim();
    text.lines()
        .position(|l| !needle.is_empty() && l.contains(needle))
        .map_or(1, |i| i as u32 + 1)
}

/// The 0-based index of the first line of `text`, at `from` or after it, that
/// holds the first line of `needle`.
fn line_from(text: &str, from: usize, needle: &str) -> Option<usize> {
    let needle = needle.lines().next().unwrap_or(needle).trim();
    if needle.is_empty() {
        return None;
    }
    text.lines()
        .enumerate()
        .skip(from)
        .find(|(_, l)| l.contains(needle))
        .map(|(i, _)| i)
}

/// The 0-based index of the line that opens the job `job` under `jobs:`: a key
/// at the indentation of the first job. The `jobs:` line where it is not found.
fn job_line(text: &str, job: &str) -> usize {
    let lines: Vec<&str> = text.lines().collect();
    let Some(jobs) = lines.iter().position(|l| l.starts_with("jobs:")) else {
        return 0;
    };
    fn indent(l: &str) -> usize {
        l.len() - l.trim_start().len()
    }
    let Some(first) = lines[jobs + 1..]
        .iter()
        .find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
        .map(|l| indent(l))
        .filter(|i| *i > 0)
    else {
        return jobs;
    };
    let heads = [
        format!("{job}:"),
        format!("\"{job}\":"),
        format!("'{job}':"),
    ];
    lines[jobs + 1..]
        .iter()
        .position(|l| {
            indent(l) == first && heads.iter().any(|h| l.trim_start().starts_with(h.as_str()))
        })
        .map_or(jobs, |i| jobs + 1 + i)
}

/// What a step is found by in the text: what it uses, else the first line of its
/// script, else its name.
fn step_anchor(step: &Value) -> Option<&str> {
    ["uses", "run", "name"]
        .iter()
        .find_map(|k| step.get(*k).and_then(Value::as_str))
        .filter(|a| !a.trim().is_empty())
}

/// The findings of one workflow file, of a repository whose owner is not known.
pub fn read_text(rel: &str, text: &str) -> Vec<WorkflowFinding> {
    read_text_of(rel, text, None)
}

/// The findings of one workflow file of a repository of `owner`
/// ([`repository_owner`]). A finding's line is where its step writes it: what is
/// found is searched from the step's own line, inside its job, so the same
/// expression written earlier in the file (a `concurrency` group, another job) is
/// not where it points.
pub fn read_text_of(rel: &str, text: &str, owner: Option<&str>) -> Vec<WorkflowFinding> {
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
        // The job holds something worth taking: a secret it reads, or a token
        // that may write (its own permissions, else the workflow's).
        let holds = reads_secret(body)
            || grants_write(body.get("permissions").or_else(|| doc.get("permissions")));
        // A reusable workflow the job calls (`jobs.<id>.uses`) runs with what the
        // job hands it: `secrets: inherit`, or secrets by name. (`secrets` and
        // `uses` on a job are GitHub's workflow schema.)
        let holds = holds || body.get("secrets").is_some_and(|v| !v.is_null());
        if holds
            && let Some(uses) = body.get("uses").and_then(Value::as_str)
            && unpinned(uses)
        {
            let at = job_line(text, job);
            out.push(WorkflowFinding {
                kind: "unpinned_action".into(),
                path: rel.to_string(),
                line: line_from(text, at, uses)
                    .map_or_else(|| line_of(text, uses), |i| i as u32 + 1),
                job: job.clone(),
                detail: uses.to_string(),
                own_owner: of_owner(uses, owner),
            });
        }
        // Where the steps of the job are read from, one after the other: each
        // from its own line, the next after it.
        let mut cursor = job_line(text, job);
        for step in steps {
            let from = match step_anchor(step).and_then(|a| line_from(text, cursor, a)) {
                Some(at) => {
                    cursor = at + 1;
                    at
                }
                None => cursor,
            };
            let line_of = |text: &str, needle: &str| -> u32 {
                line_from(text, from, needle)
                    .map_or_else(|| line_of(text, needle), |i| i as u32 + 1)
            };
            if let Some(run) = step.get("run").and_then(Value::as_str)
                && let Some(command) = piped_download(run)
            {
                out.push(WorkflowFinding {
                    kind: "piped_download".into(),
                    path: rel.to_string(),
                    line: line_of(text, command),
                    job: job.clone(),
                    detail: command.chars().take(160).collect(),
                    own_owner: false,
                });
            }
            if holds
                && let Some(uses) = step.get("uses").and_then(Value::as_str)
                && unpinned(uses)
            {
                out.push(WorkflowFinding {
                    kind: "unpinned_action".into(),
                    path: rel.to_string(),
                    line: line_of(text, uses),
                    job: job.clone(),
                    detail: uses.to_string(),
                    own_owner: of_owner(uses, owner),
                });
            }
            // A shell step's script, and the JavaScript `actions/github-script` runs:
            // an expression is replaced in either before it is read as code.
            let uses = step.get("uses").and_then(Value::as_str).unwrap_or_default();
            let script = step.get("run").and_then(Value::as_str).or_else(|| {
                uses.starts_with("actions/github-script@")
                    .then(|| step.get("with").and_then(|w| w.get("script")))
                    .flatten()
                    .and_then(Value::as_str)
            });
            if let Some(run) = script {
                for e in expressions(run) {
                    if let Some((written, anchor)) = outsiders_text(e) {
                        out.push(WorkflowFinding {
                            kind: "script_injection".into(),
                            path: rel.to_string(),
                            line: line_of(text, anchor),
                            job: job.clone(),
                            detail: written,
                            own_owner: false,
                        });
                    }
                }
            }
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
                && expressions(r).iter().any(|e| pull_request_code(e))
            {
                out.push(WorkflowFinding {
                    kind: "untrusted_checkout".into(),
                    path: rel.to_string(),
                    line: line_of(text, r),
                    job: job.clone(),
                    detail: r.trim().to_string(),
                    own_owner: false,
                });
            }
            // A shell step that fetches the pull request's code itself
            // (`gh pr checkout ${{ github.event.number }}`, `git fetch origin
            // pull/${{ ... }}/head`).
            if privileged
                && let Some(run) = step.get("run").and_then(Value::as_str)
                && let Some(line) = run.lines().map(str::trim).find(|l| {
                    (l.contains("gh pr checkout") || l.contains("pull/${{"))
                        && expressions(l).iter().any(|e| pull_request_code(e))
                })
            {
                out.push(WorkflowFinding {
                    kind: "untrusted_checkout".into(),
                    path: rel.to_string(),
                    line: line_of(text, line),
                    job: job.clone(),
                    detail: line.chars().take(160).collect(),
                    own_owner: false,
                });
            }
        }
    }
    out.sort();
    out.dedup();
    number_repeats(&mut out);
    out.sort();
    out
}

/// Numbers the repeats of one finding in one job (the same kind and detail, at
/// another line), in the order of their lines: the first keeps its detail, the
/// second and later end in ` (occurrence N in the job)`. A baseline keys a
/// workflow finding by kind, file, job and detail (no line), so without this two
/// steps interpolating the same expression were one key, and a third added beside
/// a baselined one passed. The first's detail is the one an older Drift wrote, so
/// the keys a `security.lock` already holds still match. `out` is sorted (by
/// kind, path, line).
fn number_repeats(out: &mut [WorkflowFinding]) {
    let mut seen: std::collections::BTreeMap<(String, String, String, String), usize> =
        std::collections::BTreeMap::new();
    for f in out.iter_mut() {
        let n = seen
            .entry((
                f.kind.clone(),
                f.path.clone(),
                f.job.clone(),
                f.detail.clone(),
            ))
            .or_insert(0);
        *n += 1;
        if *n > 1 {
            f.detail = format!("{} (occurrence {n} in the job)", f.detail);
        }
    }
}

/// An expression names the pull request's code: its head (`pull_request.head.sha`,
/// `github.head_ref`, `workflow_run.head_sha`), or its number, which names it as
/// `refs/pull/<number>/head` or `/merge`. On `issue_comment` the pull request's
/// number is `github.event.issue.number` (GitHub's event payload: a pull request is
/// an issue there), and it is read only where the expression is fetched or checked
/// out as one. Read as the platform reads it ([`dotted`]).
fn pull_request_code(e: &str) -> bool {
    let e = dotted(e);
    e.contains("pull_request.head")
        || e.contains("github.head_ref")
        || e.contains("workflow_run.head")
        || e.contains("pull_request.number")
        || e.contains("github.event.number")
        || e.contains("github.event.issue.number")
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
    fn a_privileged_checkout_of_the_pull_requests_ref_by_number_is_found() {
        let found = kinds(
            "on: pull_request_target\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: refs/pull/${{ github.event.pull_request.number }}/merge\n      - run: gh pr checkout ${{ github.event.number }}\n",
        );
        assert_eq!(
            found
                .iter()
                .filter(|(k, _)| k == "untrusted_checkout")
                .count(),
            2,
            "{found:?}"
        );
    }

    #[test]
    fn text_of_the_event_in_a_github_script_is_found() {
        let found = kinds(
            "on: issues\njobs:\n  greet:\n    steps:\n      - uses: actions/github-script@v7\n        with:\n          script: console.log('${{ github.event.issue.title }}')\n",
        );
        assert_eq!(
            found,
            vec![(
                "script_injection".to_string(),
                "github.event.issue.title".to_string()
            )]
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
    fn an_action_named_by_a_tag_is_found_where_the_job_holds_a_secret_or_may_write() {
        let found = kinds(
            "on: push
jobs:
  deploy:
    steps:
      - uses: actions/checkout@v4
      - uses: someone/deploy@v2
        with:
          token: ${{ secrets.DEPLOY_TOKEN }}
      - uses: someone/pinned@0123456789abcdef0123456789abcdef01234567
      - uses: ./.github/actions/local
      - uses: docker://ghcr.io/someone/tool:1
  lint:
    steps:
      - uses: someone/lint@v1
  release:
    permissions:
      contents: write
    steps:
      - uses: someone/release@main
",
        );
        assert_eq!(
            found,
            vec![
                (
                    "unpinned_action".to_string(),
                    "someone/deploy@v2".to_string()
                ),
                (
                    "unpinned_action".to_string(),
                    "docker://ghcr.io/someone/tool:1".to_string()
                ),
                (
                    "unpinned_action".to_string(),
                    "someone/release@main".to_string()
                ),
            ]
        );
        // The workflow's own permissions hold for a job that names none.
        let found = kinds(
            "on: push
permissions: write-all
jobs:
  a:
    steps:
      - uses: someone/x@v1
  b:
    permissions:
      contents: read
    steps:
      - uses: someone/y@v1
",
        );
        assert_eq!(
            found,
            vec![("unpinned_action".to_string(), "someone/x@v1".to_string())]
        );
    }

    #[test]
    fn a_download_handed_to_an_interpreter_is_found() {
        let found = kinds(
            "on: push
jobs:
  a:
    steps:
      - run: curl -fsSL https://get.example.com/install.sh | sudo bash -s -- -y
      - run: |
          set -e
          bash <(curl -s https://example.com/x.sh)
      - run: curl -fsSL https://example.com/x.tgz | tar xz
      - run: curl -o install.sh https://example.com/x.sh || echo failed
      - run: cat list.txt | sh
",
        );
        let commands: Vec<&str> = found.iter().map(|(_, d)| d.as_str()).collect();
        assert!(
            found.iter().all(|(k, _)| k == "piped_download"),
            "{found:?}"
        );
        assert_eq!(
            commands,
            [
                "curl -fsSL https://get.example.com/install.sh | sudo bash -s -- -y",
                "bash <(curl -s https://example.com/x.sh)",
            ]
        );
    }

    /// Pins audit 5's line attribution: before, both findings pointed at line 3,
    /// the first place the file writes the expression (a `concurrency` group).
    #[test]
    fn a_finding_points_at_the_step_that_writes_it() {
        let text = "on: pull_request_target
concurrency:
  group: ${{ github.head_ref }}
  cancel-in-progress: true
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
      - run: echo ${{ github.head_ref }}
  b:
    steps:
      - uses: actions/checkout@v4
      - run: echo ${{ github.head_ref }}
";
        let lines: Vec<(String, u32)> = read_text(".github/workflows/x.yml", text)
            .into_iter()
            .filter(|f| f.kind == "script_injection")
            .map(|f| (f.job, f.line))
            .collect();
        assert_eq!(lines, [("a".to_string(), 9), ("b".to_string(), 13)]);
    }

    /// Pins the owner as a label (F3, review R3): before, an action of the owner the
    /// clone's `origin` names was left out, so a baseline written in the upstream
    /// clone did not hold it and a fork's clone (another `origin`) failed `drift
    /// check` on the same commit. Now every clone finds the same findings; the
    /// owner's own is said, never dropped.
    #[test]
    fn an_action_of_the_repositorys_own_owner_is_listed_and_said_to_be_its_own() {
        let text = "on: push
jobs:
  deploy:
    steps:
      - uses: acme/actions/build@v1
        with:
          token: ${{ secrets.TOKEN }}
      - uses: someone/deploy@v2
";
        let found = |owner: Option<&str>| -> Vec<(String, bool)> {
            read_text_of(".github/workflows/x.yml", text, owner)
                .into_iter()
                .map(|f| (f.detail, f.own_owner))
                .collect()
        };
        let both = ["acme/actions/build@v1", "someone/deploy@v2"];
        let details = |owner: Option<&str>| -> Vec<String> {
            found(owner).into_iter().map(|(d, _)| d).collect()
        };
        // The same findings in the upstream clone, a fork's and one with no remote.
        assert_eq!(details(Some("Acme")), both);
        assert_eq!(details(Some("me")), both);
        assert_eq!(details(None), both);
        assert_eq!(
            found(Some("Acme")),
            [
                ("acme/actions/build@v1".to_string(), true),
                ("someone/deploy@v2".to_string(), false)
            ]
        );
        assert!(found(None).iter().all(|(_, own)| !own));
    }

    /// Pins the remote's parse (F3, review R3): before, the host was matched as a
    /// substring (`notgithub.com/x/y` read owner `x`).
    #[test]
    fn a_remote_names_an_owner_only_on_github_itself() {
        let origin = |url: &str| origin_owner(&format!("[remote \"origin\"]\n\turl = {url}\n"));
        assert_eq!(
            origin("git@github.com:acme/app.git"),
            Some("acme".to_string())
        );
        assert_eq!(
            origin("https://github.com/makeplane/plane"),
            Some("makeplane".to_string())
        );
        assert_eq!(
            origin("ssh://git@github.com/acme/app"),
            Some("acme".to_string())
        );
        assert_eq!(
            origin("ssh://git@github.com:22/acme/app.git"),
            Some("acme".to_string())
        );
        assert_eq!(
            origin("https://user@GitHub.com/acme/app"),
            Some("acme".to_string())
        );
        assert_eq!(origin("https://notgithub.com/x/y"), None);
        assert_eq!(origin("git@notgithub.com:x/y"), None);
        assert_eq!(origin("https://github.example.com/x/y"), None);
        assert_eq!(origin("/srv/git/github.com:x/y"), None);
        assert_eq!(origin("../app"), None);
        assert_eq!(
            origin_owner(
                "[core]\n\tbare = false\n[remote \"origin\"]\n\turl = git@github.com:acme/app.git\n"
            ),
            Some("acme".to_string())
        );
        assert_eq!(
            origin_owner("[remote \"upstream\"]\n\turl = https://github.com/x/y\n"),
            None
        );
    }

    /// Pins review area 7 item 8 (a): `issue_comment` runs with the base
    /// repository's secrets for a comment anyone can post on a pull request; before,
    /// a workflow that then checked out or fetched that pull request's head by
    /// `github.event.issue.number` was not found.
    #[test]
    fn a_comment_triggered_checkout_of_the_pull_requests_head_is_found() {
        let text = "on:
  issue_comment:
    types: [created]
jobs:
  test:
    if: contains(github.event.comment.body, '/test')
    steps:
      - uses: actions/checkout@v4
        with:
          ref: refs/pull/${{ github.event.issue.number }}/head
      - run: git fetch origin pull/${{ github.event.issue.number }}/head:pr
";
        let found: Vec<(String, u32)> = read_text(".github/workflows/x.yml", text)
            .into_iter()
            .map(|f| (f.kind, f.line))
            .collect();
        assert_eq!(
            found,
            [
                ("untrusted_checkout".to_string(), 10),
                ("untrusted_checkout".to_string(), 11)
            ]
        );
        // The same steps on `issues` run for no pull request's code.
        assert!(kinds(&text.replace("issue_comment", "issues")).is_empty());
    }

    /// Pins review area 7 item 8 (b): before, an expression written with brackets
    /// (`github.event['pull_request']['title']`) or the whole event handed to
    /// `toJSON` was not found; both are read as the platform reads them.
    #[test]
    fn bracket_members_and_the_whole_event_in_a_shell_step_are_found() {
        let text = "on: pull_request
jobs:
  a:
    steps:
      - run: echo \"${{ github.event['pull_request']['title'] }}\"
      - run: echo '${{ toJSON(github.event) }}' > event.json
      - run: echo \"${{ github.event[\"issue\"].number }} ${{ github['head_ref'] }}\"
      - run: echo '${{ toJSON(github.event.pull_request.number) }}'
";
        let found: Vec<(String, u32)> = read_text(".github/workflows/x.yml", text)
            .into_iter()
            .map(|f| (f.detail, f.line))
            .collect();
        assert_eq!(
            found,
            [
                ("github.event.pull_request.title".to_string(), 5),
                ("github.event".to_string(), 6),
                ("github.head_ref".to_string(), 7),
            ]
        );
        assert_eq!(
            dotted("github.event['a'][\"b\"][*].c[0]"),
            "github.event.a.b.*.c[0]"
        );
    }

    /// Pins review area 7 item 8 (c): before, a reusable workflow a job calls with
    /// the job's secrets was never read for what names it.
    #[test]
    fn a_reusable_workflow_named_by_a_branch_with_secrets_is_found() {
        let found: Vec<(String, u32)> = read_text(
            ".github/workflows/x.yml",
            "on: push
jobs:
  call:
    uses: someone/workflows/.github/workflows/z.yml@main
    secrets: inherit
  open:
    uses: someone/workflows/.github/workflows/y.yml@v1
  local:
    uses: ./.github/workflows/local.yml
    secrets: inherit
  pinned:
    uses: someone/w/.github/workflows/z.yml@0123456789abcdef0123456789abcdef01234567
    secrets:
      token: ${{ secrets.T }}
  named:
    uses: someone/w/.github/workflows/n.yml@v2
    secrets:
      token: ${{ secrets.T }}
",
        )
        .into_iter()
        .map(|f| (f.detail, f.line))
        .collect();
        assert_eq!(
            found,
            [
                (
                    "someone/workflows/.github/workflows/z.yml@main".to_string(),
                    4
                ),
                ("someone/w/.github/workflows/n.yml@v2".to_string(), 16),
            ]
        );
    }

    /// Pins review area 7 item 8 (d): before, two steps of one job interpolating the
    /// same expression were one baseline key (kind, file, job, detail), so a second
    /// passed beside a baselined first. The first keeps the detail an older Drift
    /// wrote, so a `security.lock` it wrote still holds it.
    #[test]
    fn the_same_expression_in_two_steps_of_a_job_is_two_findings() {
        let text = "on: issues
jobs:
  a:
    steps:
      - run: echo \"${{ github.event.issue.title }}\"
      - run: echo \"${{ github.event.issue.title }}\" again
  b:
    steps:
      - run: echo \"${{ github.event.issue.title }}\"
";
        let found: Vec<(String, String, u32)> = read_text(".github/workflows/x.yml", text)
            .into_iter()
            .map(|f| (f.job, f.detail, f.line))
            .collect();
        assert_eq!(
            found,
            [
                ("a".to_string(), "github.event.issue.title".to_string(), 5),
                (
                    "a".to_string(),
                    "github.event.issue.title (occurrence 2 in the job)".to_string(),
                    6
                ),
                ("b".to_string(), "github.event.issue.title".to_string(), 9),
            ]
        );
    }

    #[test]
    fn a_file_that_is_no_workflow_says_nothing() {
        assert!(kinds("not: [a, workflow").is_empty());
        assert!(kinds("name: x\n").is_empty());
    }
}
