//! What a careful reader looks at before answering a setup question
//! (`drift setup --json --evidence`, and the MCP tool): excerpts of the repository with
//! file and line, and what Drift read and could not, in words. Taken from what the
//! question already rests on (the inventory's descriptions, the target groups, the
//! practice map's units) and from the files themselves as written: no reading of its
//! own. Bounded: every excerpt, line and list has a cap, and what is left out is
//! counted.

use std::collections::BTreeSet;
use std::path::Path;

use drift_mine::practices::UnitRow;
use drift_mine::security::{Exposure, Inventory};
use drift_mine::terraform::TargetGroup;
use serde::Serialize;
use serde_json::Value;

/// Most lines of one excerpt.
pub const MAX_EXCERPT_LINES: usize = 40;
/// Most characters of one line shown.
pub const MAX_LINE: usize = 200;
/// Most excerpts of one question.
pub const MAX_EXCERPTS: usize = 40;
/// Most facts of one question.
pub const MAX_FACTS: usize = 40;
/// Most routes listed for one check.
pub const MAX_ROUTES: usize = 60;
/// Most bytes of excerpt text for one question.
pub const MAX_BYTES: usize = 64 * 1024;
/// Most places listed that name a compose file.
const MAX_MENTIONS: usize = 25;

/// One piece of the repository, as written.
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct Excerpt {
    /// What it is: "compose service `api`", "names the file", "target group `api`".
    pub what: String,
    pub file: String,
    /// Its first line (1-based).
    pub line: usize,
    /// The lines, as written (each cut at [`MAX_LINE`] characters).
    pub text: String,
}

/// A route that reaches a check, and whether it does on every request.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RouteCall {
    /// `GET /rules/a`, or the handler's name where it has no route.
    pub route: String,
    /// `file:line` of its handler.
    pub handler: String,
    /// A "yes" counts it: it reaches the check on every request.
    pub every_request: bool,
    /// Why it stays unknown after a "yes", where it does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stays_because: Option<String>,
}

/// Everything shown for one question.
#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct Context {
    /// What Drift read and what it could not, in words: what matched and what did
    /// not, the other descriptions of the same code, the reason a check is not counted.
    pub facts: Vec<String>,
    pub excerpts: Vec<Excerpt>,
    /// For a check: each route that reaches it.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<RouteCall>,
    /// Excerpts, facts or routes left out to keep this bounded.
    pub omitted: usize,
}

impl Context {
    pub(crate) fn fact(&mut self, f: impl Into<String>) {
        if self.facts.len() < MAX_FACTS {
            self.facts.push(f.into());
        } else {
            self.omitted += 1;
        }
    }

    fn bytes(&self) -> usize {
        self.excerpts.iter().map(|e| e.text.len()).sum()
    }

    pub(crate) fn excerpt(&mut self, e: Option<Excerpt>) {
        let Some(e) = e else {
            return;
        };
        if self
            .excerpts
            .iter()
            .any(|x| x.file == e.file && x.line == e.line && x.what == e.what)
        {
            return;
        }
        if self.excerpts.len() >= MAX_EXCERPTS || self.bytes() + e.text.len() > MAX_BYTES {
            self.omitted += 1;
            return;
        }
        self.excerpts.push(e);
    }
}

/// Files with their lines, read once.
pub type Files = std::rc::Rc<Vec<(String, Vec<String>)>>;

/// What a question is about, kept to show its context.
#[derive(Debug, Clone, Default)]
pub enum Subject {
    #[default]
    None,
    /// A compose file and the code directories it starts.
    Deployment { file: String, dirs: Vec<String> },
    /// A code directory and the target groups, best first, each with what matched.
    Tie {
        dir: String,
        ranked: Vec<(TargetGroup, Vec<String>)>,
        others: Vec<TargetGroup>,
        routes: Vec<String>,
    },
    /// A code directory and the workloads of the Kubernetes manifests tied to no
    /// code, the likely first.
    Workload {
        dir: String,
        workloads: Vec<drift_mine::security::Workload>,
        routes: Vec<String>,
    },
    /// Code directories no target group looks like.
    Reach {
        dirs: Vec<String>,
        groups: Vec<TargetGroup>,
        terraform: Vec<String>,
    },
    /// A helper with a check found in it, the routes that reach it (and whether a
    /// "yes" counts each), and why it is not counted.
    Check {
        instrument: String,
        kind: String,
        units: Vec<(UnitRow, bool)>,
        why: String,
        obligation: String,
        when: String,
    },
}

/// Two or three plain sentences: what would settle the question, and what would not.
pub fn how_to_decide(kind: super::Kind, reach: bool) -> &'static str {
    match kind {
        super::Kind::Deployment => {
            "A CI workflow, Makefile target or script that starts this file for a test run (`docker compose -f <file> up` before the tests), and no deploy job, release script or deployment doc that names it, suggests tests or local only. A file or folder name alone (e2e, test, local, dev) is not enough, and neither is what it publishes. If anything deploys with it, or you cannot tell, answer skip."
        }
        super::Kind::Terraform if reach => {
            "Answer that nothing outside reaches these services only where the deployment itself shows it (no load balancer, target group, ingress or public address leads to them, for example they run in private subnets only): a compose file that publishes no port says nothing about production. Ports or names that do not match a target group are not enough. If you cannot tell, answer skip."
        }
        super::Kind::Terraform => {
            "The tie is right when this target group's port and health check are the service's, its listener rules carry the service's routes, and no other target group of this Terraform sends requests to the same service. A name that looks alike is not enough. If two target groups could be it, or you cannot find what runs behind it, answer skip."
        }
        super::Kind::Kubernetes => {
            "The workload runs this code when its image is the one built from this directory (a CI job or a script that builds and pushes it from here, a Dockerfile here that produces it) and the routes it answers are this code's. A name that looks alike is not enough. If two workloads could be it, or the image is built elsewhere, answer skip."
        }
        super::Kind::Investigate => super::investigate::HOW_TO_DECIDE,
        super::Kind::Check => {
            "Read the whole function: it is your check when it refuses the request (raises or returns an error) unless the record's organization, owner or role matches the caller's, and the caller comes from the authenticated request, not from what the caller sent. Its name alone is not enough. What it lets through (the condition Drift names) stays let through after a yes, and routes that reach it only for some requests stay unknown either way."
        }
    }
}

// ---------- reading files ----------

pub(crate) fn lines_of(root: &Path, file: &str) -> Vec<String> {
    std::fs::read_to_string(root.join(file))
        .map(|t| t.lines().map(str::to_string).collect())
        .unwrap_or_default()
}

fn cut(l: &str) -> String {
    if l.chars().count() > MAX_LINE {
        let c: String = l.chars().take(MAX_LINE).collect();
        format!("{c}...")
    } else {
        l.to_string()
    }
}

fn indent(l: &str) -> usize {
    l.len() - l.trim_start().len()
}

/// Lines `[from, to)` (0-based) of `lines` as an excerpt, at most
/// [`MAX_EXCERPT_LINES`], with a last line that says how many more there are.
pub(crate) fn excerpt_of(
    what: &str,
    file: &str,
    lines: &[String],
    from: usize,
    to: usize,
) -> Option<Excerpt> {
    if from >= lines.len() || to <= from {
        return None;
    }
    let to = to.min(lines.len());
    let shown = (to - from).min(MAX_EXCERPT_LINES);
    let mut text: Vec<String> = lines[from..from + shown].iter().map(|l| cut(l)).collect();
    if to - from > shown {
        text.push(format!("... ({} more lines)", to - from - shown));
    }
    Some(Excerpt {
        what: what.to_string(),
        file: file.to_string(),
        line: from + 1,
        text: text.join("\n"),
    })
}

/// The end (exclusive) of the block that starts on line `i`: by braces where the line
/// opens one, else by indentation (Python, YAML).
pub(crate) fn block_end(lines: &[String], i: usize) -> usize {
    let head = &lines[i];
    if head.contains('{') {
        let mut depth = 0i32;
        for (j, l) in lines.iter().enumerate().skip(i) {
            for c in l.chars() {
                match c {
                    '{' => depth += 1,
                    '}' => depth -= 1,
                    _ => {}
                }
            }
            if depth <= 0 && j >= i {
                return j + 1;
            }
        }
        return lines.len();
    }
    let ind = indent(head);
    let mut end = i + 1;
    // A Python definition may span lines before its body: up to the line ending `:`.
    let mut j = i + 1;
    while j < lines.len() {
        let l = &lines[j];
        if l.trim().is_empty() || l.trim_start().starts_with('#') {
            j += 1;
            continue;
        }
        if indent(l) > ind || l.trim_start().starts_with(')') {
            end = j + 1;
            j += 1;
        } else {
            break;
        }
    }
    end
}

pub(crate) fn block(what: &str, file: &str, lines: &[String], at: usize) -> Option<Excerpt> {
    if at >= lines.len() {
        return None;
    }
    excerpt_of(what, file, lines, at, block_end(lines, at))
}

/// `file:line` split, the line 0-based.
pub(crate) fn at(loc: &str) -> Option<(&str, usize)> {
    let (f, l) = loc.rsplit_once(':')?;
    Some((f, l.parse::<usize>().ok()?.checked_sub(1)?))
}

fn under(path: &str, dir: &str) -> bool {
    dir.is_empty() || path == dir || path.starts_with(&format!("{dir}/"))
}

/// `a/b/../c` as `a/c`.
fn normal(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for p in path.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            p => out.push(p),
        }
    }
    out.join("/")
}

/// The services of compose file `file` that start code in one of `dirs`, each with
/// the excerpt of its block; a service is matched by its `build` directory.
fn compose_services(root: &Path, file: &str, dirs: &[String]) -> Vec<(String, Option<Excerpt>)> {
    let lines = lines_of(root, file);
    let Ok(v) = drift_mine::policy::yaml_value(&lines.join("\n")) else {
        return Vec::new();
    };
    let base = file.rsplit_once('/').map_or("", |(d, _)| d);
    let mut out = Vec::new();
    let mut code = false;
    let Some(services) = v.get("services").and_then(Value::as_object) else {
        return out;
    };
    for (name, s) in services {
        let (context, dockerfile) = match s.get("build") {
            Some(Value::String(b)) => (Some(b.clone()), None),
            Some(b) => (
                b.get("context").and_then(Value::as_str).map(str::to_string),
                b.get("dockerfile")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            ),
            None => (None, None),
        };
        // The code it builds: the build directory, or, for a build from a directory
        // above (`context: ../..`), the Dockerfile's.
        let built = context.map(|c| normal(&format!("{base}/{c}")));
        let from_dockerfile = dockerfile.as_ref().and_then(|f| {
            let at = normal(&format!("{}/{f}", built.as_deref().unwrap_or(base)));
            at.rsplit_once('/').map(|(d, _)| d.to_string())
        });
        let starts = |d: &String| {
            let by = |b: &str| under(b, d) || (!b.is_empty() && under(d, b));
            from_dockerfile.as_deref().map_or_else(
                || built.as_deref().is_some_and(|b| !b.is_empty() && by(b)),
                by,
            )
        };
        // A gateway it runs from an image (`nginx`) sends requests to the code.
        let gateway = built.is_none()
            && s.get("image").and_then(Value::as_str).is_some_and(|i| {
                ["nginx", "traefik", "caddy", "envoy", "haproxy", "kong"]
                    .iter()
                    .any(|g| i.starts_with(g) || i.contains(&format!("/{g}")))
            });
        if !(gateway || dirs.iter().any(starts)) {
            continue;
        }
        // Its line: a key at the first indent below `services:`.
        let top = lines.iter().position(|l| l.trim_end() == "services:");
        let found = top.and_then(|t| {
            let child = lines[t + 1..]
                .iter()
                .find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
                .map(|l| indent(l))?;
            (t + 1..lines.len()).find(|&i| {
                indent(&lines[i]) == child
                    && (lines[i].trim_start().strip_prefix(name.as_str()))
                        .is_some_and(|r| r.trim_end() == ":" || r.starts_with(": "))
            })
        });
        let what = if gateway {
            format!("compose service `{name}`, the gateway")
        } else {
            format!("compose service `{name}`")
        };
        code |= !gateway;
        out.push((
            name.clone(),
            found.and_then(|i| block(&what, file, &lines, i)),
        ));
    }
    // A gateway only beside the code it sends requests to.
    if !code {
        out.clear();
    }
    out
}

/// The `CMD` / `ENTRYPOINT` lines of the Dockerfile in `dir`: what the service starts.
fn start_command(root: &Path, dir: &str) -> Option<Excerpt> {
    let file = if dir.is_empty() {
        "Dockerfile".to_string()
    } else {
        format!("{dir}/Dockerfile")
    };
    let lines = lines_of(root, &file);
    let i = lines.iter().rposition(|l| {
        let t = l.trim_start().to_uppercase();
        t.starts_with("CMD") || t.starts_with("ENTRYPOINT")
    })?;
    let from = (0..=i)
        .rev()
        .take(3)
        .take_while(|&j| {
            let t = lines[j].trim_start().to_uppercase();
            t.starts_with("CMD") || t.starts_with("ENTRYPOINT") || t.starts_with("EXPOSE")
        })
        .last()
        .unwrap_or(i);
    excerpt_of("what the service starts", &file, &lines, from, i + 1)
}

/// What Drift read of how the routes of `dirs` are reached, per directory: how many
/// routes read each way, and the reasons most of them read so; then what Drift does
/// not read at all.
pub(crate) fn read_of(inv: &Inventory, dirs: &[String], ctx: &mut Context) {
    let word = |e: Exposure| match e {
        Exposure::Public => "reachable from the internet",
        Exposure::Unknown => "unknown",
        Exposure::Internal => "reachable only from inside",
    };
    for d in dirs {
        let rows: Vec<_> = inv
            .entry_points
            .iter()
            .filter(|e| !e.local && under(&e.path, d))
            .collect();
        if rows.is_empty() {
            continue;
        }
        let mut by: std::collections::BTreeMap<&str, usize> = Default::default();
        let mut why: std::collections::BTreeMap<String, usize> = Default::default();
        for e in &rows {
            *by.entry(word(e.exposure)).or_default() += 1;
            *why.entry(format!(
                "{}: {}",
                word(e.exposure),
                e.boundary
                    .as_deref()
                    .unwrap_or("nothing says how it is reached")
            ))
            .or_default() += 1;
        }
        let mut why: Vec<(String, usize)> = why.into_iter().collect();
        why.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let reasons: Vec<String> = why
            .iter()
            .take(3)
            .map(|(w, n)| format!("{} ({n})", cut(w)))
            .collect();
        ctx.fact(format!(
            "{} ({} route{}): {}. What Drift read: {}{}.",
            super::shown(d),
            rows.len(),
            if rows.len() == 1 { "" } else { "s" },
            by.iter()
                .map(|(w, n)| format!("{n} {w}"))
                .collect::<Vec<_>>()
                .join(", "),
            reasons.join("; "),
            if why.len() > 3 {
                format!("; and {} other reasons", why.len() - 3)
            } else {
                String::new()
            }
        ));
    }
    for u in &inv.boundaries.unread {
        ctx.fact(format!(
            "Drift does not read {} ({} file{}: {}{})",
            u.kind,
            u.count,
            if u.count == 1 { "" } else { "s" },
            u.files.join(", "),
            if u.count > u.files.len() { ", ..." } else { "" }
        ));
    }
}

// ---------- the places that name a file ----------

/// Files a person or a pipeline runs or reads: where a compose file is named.
fn names_files(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let lower = name.to_lowercase();
    rel.starts_with(".github/workflows/")
        || rel.starts_with(".circleci/")
        || rel.starts_with(".buildkite/")
        || lower == ".gitlab-ci.yml"
        || lower.starts_with("jenkinsfile")
        || lower.starts_with("azure-pipelines")
        || lower.starts_with("buildspec")
        || matches!(
            lower.as_str(),
            "makefile"
                | "gnumakefile"
                | "justfile"
                | "taskfile.yml"
                | "taskfile.yaml"
                | "package.json"
                | "procfile"
                | "tox.ini"
                | "noxfile.py"
                | "skaffold.yaml"
                | "tiltfile"
        )
        || lower.ends_with(".mk")
        || lower.ends_with(".md")
        || lower.ends_with(".rst")
        || lower.starts_with("dockerfile")
        || lower.ends_with(".dockerfile")
        || lower.ends_with(".sh")
        || lower.ends_with(".bash")
        || lower.ends_with(".ps1")
        || rel.starts_with("scripts/")
        || rel.contains("/scripts/")
}

/// The files that may name a compose file, read once per run.
pub fn mention_files(root: &Path) -> Vec<(String, Vec<String>)> {
    let Ok(walked) = drift_core::ingest::walk(root, 0, &names_files) else {
        return Vec::new();
    };
    walked
        .config
        .iter()
        .filter_map(|c| {
            let text = std::fs::read_to_string(&c.abs_path).ok()?;
            Some((
                c.rel_path.clone(),
                text.lines().map(str::to_string).collect(),
            ))
        })
        .collect()
}

/// Each line of `files` that names `file` (its path, or its name where that is not a
/// name every compose file has), with a line around it; the ones that name the path
/// first.
fn mentions(file: &str, files: &[(String, Vec<String>)], ctx: &mut Context) {
    let name = file.rsplit('/').next().unwrap_or(file);
    // The names every compose file may have say nothing alone.
    let generic = matches!(
        name,
        "docker-compose.yml"
            | "docker-compose.yaml"
            | "compose.yml"
            | "compose.yaml"
            | "docker-compose.override.yml"
            | "docker-compose.override.yaml"
            | "compose.override.yml"
            | "compose.override.yaml"
    );
    let mut found: Vec<(bool, Excerpt)> = Vec::new();
    for (rel, lines) in files {
        if rel == file {
            continue;
        }
        for (i, l) in lines.iter().enumerate() {
            let full = l.contains(file);
            // A bare `docker-compose.yml` names any of them: only with its folder.
            let by_name = !generic && l.contains(name);
            let with_dir = generic
                && file
                    .rsplit('/')
                    .nth(1)
                    .is_some_and(|d| l.contains(&format!("{d}/{name}")));
            if full || by_name || with_dir {
                let what = if full {
                    "names the file"
                } else {
                    "names a file by this name"
                };
                if let Some(e) = excerpt_of(what, rel, lines, i.saturating_sub(1), i + 2) {
                    found.push((full, e));
                }
            }
        }
    }
    // The path first, then pipelines, then the rest, each in path order.
    found.sort_by_key(|(full, e)| {
        (
            !*full,
            !(e.file.starts_with(".github/") || e.file.to_lowercase().contains("makefile")),
            e.file.clone(),
            e.line,
        )
    });
    let total = found.len();
    if total == 0 {
        ctx.fact(format!(
            "No workflow, Makefile, justfile, package.json, script, Dockerfile or doc in the repository names `{name}`."
        ));
    } else {
        ctx.fact(format!(
            "{total} line{} in workflows, scripts, Dockerfiles and docs name{} it (the first {} shown).",
            if total == 1 { "" } else { "s" },
            if total == 1 { "s" } else { "" },
            total.min(MAX_MENTIONS)
        ));
    }
    for (_, e) in found.into_iter().take(MAX_MENTIONS) {
        ctx.excerpt(Some(e));
    }
    ctx.omitted += total.saturating_sub(MAX_MENTIONS);
}

// ---------- per kind ----------

pub struct Reading<'a> {
    pub root: &'a Path,
    pub inv: &'a Inventory,
    pub compose: &'a [String],
    pub mentions: &'a dyn Fn() -> Files,
    /// Every source file's path, for a check's callers.
    pub sources: &'a [String],
}

pub fn context(r: &Reading<'_>, subject: &Subject) -> Context {
    let mut ctx = Context::default();
    match subject {
        Subject::None => {}
        Subject::Deployment { file, dirs } => deployment(r, file, dirs, &mut ctx),
        Subject::Tie {
            dir,
            ranked,
            others,
            routes,
        } => tie(r, dir, ranked, others, routes, &mut ctx),
        Subject::Reach {
            dirs,
            groups,
            terraform,
        } => reach(r, dirs, groups, terraform, &mut ctx),
        Subject::Workload {
            dir,
            workloads,
            routes,
        } => workload(r, dir, workloads, routes, &mut ctx),
        Subject::Check {
            instrument,
            kind,
            units,
            why,
            obligation,
            when,
        } => check(r, instrument, kind, units, why, obligation, when, &mut ctx),
    }
    ctx
}

fn deployment(r: &Reading<'_>, file: &str, dirs: &[String], ctx: &mut Context) {
    let lines = lines_of(r.root, file);
    let name = file.rsplit('/').next().unwrap_or(file);
    ctx.fact(format!("The file is `{file}` (its name: `{name}`)."));
    // Its header: the comment lines before anything else.
    let head = lines
        .iter()
        .position(|l| !(l.trim().is_empty() || l.trim_start().starts_with('#')))
        .unwrap_or(lines.len());
    let comments = lines
        .iter()
        .filter(|l| l.trim_start().starts_with('#'))
        .count();
    let in_head = lines[..head]
        .iter()
        .filter(|l| l.trim_start().starts_with('#'))
        .count();
    if comments == 0 {
        ctx.fact("The file has no comments.");
    } else {
        if in_head > 0 {
            ctx.excerpt(excerpt_of("the file's own comments", file, &lines, 0, head));
        }
        if comments > in_head {
            ctx.fact(format!(
                "The file has {} more comment line{} below its header; those inside a service are in that service's block.",
                comments - in_head,
                if comments - in_head == 1 { "" } else { "s" }
            ));
        }
    }
    mentions(file, &(r.mentions)(), ctx);
    let services = compose_services(r.root, file, dirs);
    for (svc, e) in &services {
        if e.is_none() {
            ctx.fact(format!(
                "Service `{svc}` starts this code; its block was not found as written."
            ));
        }
    }
    for (_, e) in services {
        ctx.excerpt(e);
    }
    read_of(r.inv, dirs, ctx);
    // What else describes the same code.
    let mut elsewhere = Vec::new();
    for other in r.compose.iter().filter(|c| *c != file) {
        let found: Vec<(String, Option<Excerpt>)> = compose_services(r.root, other, dirs)
            .into_iter()
            .filter(|(_, e)| e.as_ref().is_none_or(|e| !e.what.ends_with("the gateway")))
            .collect();
        if !found.is_empty() {
            elsewhere.push(format!(
                "`{other}` ({})",
                found
                    .iter()
                    .map(|(n, _)| n.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        for (_, e) in found {
            ctx.excerpt(e.map(|mut e| {
                e.what = format!("the same code in another compose file: {}", e.what);
                e
            }));
        }
    }
    ctx.fact(if elsewhere.is_empty() {
        "No other compose file starts this code.".to_string()
    } else {
        format!(
            "Other compose files start the same code: {}.",
            elsewhere.join("; ")
        )
    });
}

/// What did not match between `g` and the service.
fn unmatched(g: &TargetGroup, svc: &str, routes: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    match g.health.as_deref() {
        None => out.push("Drift reads no health check path of it".to_string()),
        Some("/") => out.push("its health check is `/`, which any service answers".to_string()),
        Some(h) if !routes.iter().any(|r| r == h) => {
            out.push(format!("its health check {h} is not a route of {svc}"))
        }
        Some(_) => {}
    }
    if g.paths.is_empty() {
        out.push("no listener rule Drift reads sends requests to it".to_string());
    }
    out
}

fn group_facts(g: &TargetGroup, svc: &str, routes: &[String], why: &[String]) -> String {
    let port = g
        .port
        .as_deref()
        .map_or_else(String::new, |p| format!(", port {p}"));
    let health = g
        .health
        .as_deref()
        .map_or_else(String::new, |h| format!(", health check {h}"));
    let paths = if g.paths.is_empty() {
        String::new()
    } else {
        format!(", rules send {}", g.paths.join(", "))
    };
    let no = unmatched(g, svc, routes);
    format!(
        "Target group `{}` ({}{port}{health}{paths}). Matched: {}. Did not match: {}.",
        g.name,
        g.at,
        if why.is_empty() {
            "nothing".to_string()
        } else {
            why.join("; ")
        },
        if no.is_empty() {
            "nothing".to_string()
        } else {
            no.join("; ")
        }
    )
}

/// The target group's resource and the listener rules of its module that name it.
fn group_excerpts(r: &Reading<'_>, g: &TargetGroup, ctx: &mut Context) {
    if let Some((file, i)) = at(&g.at) {
        let lines = lines_of(r.root, file);
        ctx.excerpt(block(
            &format!("target group `{}`", g.name),
            file,
            &lines,
            i,
        ));
    }
    let needle = format!("aws_lb_target_group.{}", g.name);
    let mut files: BTreeSet<String> = BTreeSet::new();
    if let Ok(rd) = std::fs::read_dir(r.root.join(&g.module)) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.ends_with(".tf") {
                files.insert(if g.module.is_empty() {
                    n
                } else {
                    format!("{}/{n}", g.module)
                });
            }
        }
    }
    let mut rules = 0;
    for file in files {
        let lines = lines_of(r.root, &file);
        for (i, l) in lines.iter().enumerate() {
            let t = l.trim_start();
            if !(t.starts_with("resource \"aws_lb_listener_rule\"")
                || t.starts_with("resource \"aws_lb_listener\"")
                || t.starts_with("resource \"aws_alb_listener"))
            {
                continue;
            }
            let end = block_end(&lines, i);
            if lines[i..end].iter().any(|l| l.contains(&needle)) && rules < 4 {
                rules += 1;
                ctx.excerpt(excerpt_of(
                    &format!("a listener rule that sends to `{}`", g.name),
                    &file,
                    &lines,
                    i,
                    end,
                ));
            }
        }
    }
    if rules == 0 {
        ctx.fact(format!(
            "No listener rule in `{}` names `{needle}`.",
            if g.module.is_empty() { "." } else { &g.module }
        ));
    }
}

pub(crate) fn service_excerpts(r: &Reading<'_>, dirs: &[String], ctx: &mut Context) {
    for c in r.compose {
        for (_, e) in compose_services(r.root, c, dirs) {
            ctx.excerpt(e);
        }
    }
    for d in dirs {
        ctx.excerpt(start_command(r.root, d));
    }
}

fn tie(
    r: &Reading<'_>,
    dir: &str,
    ranked: &[(TargetGroup, Vec<String>)],
    others: &[TargetGroup],
    routes: &[String],
    ctx: &mut Context,
) {
    let svc = super::shown(dir);
    let mut listed: Vec<&str> = routes.iter().map(String::as_str).collect();
    listed.sort();
    listed.dedup();
    let n = listed.len();
    ctx.fact(format!(
        "The routes of {svc} ({n}): {}{}",
        listed
            .iter()
            .take(MAX_ROUTES)
            .copied()
            .collect::<Vec<_>>()
            .join(", "),
        if n > MAX_ROUTES {
            format!(" and {} more", n - MAX_ROUTES)
        } else {
            String::new()
        }
    ));
    for (k, (g, why)) in ranked.iter().enumerate() {
        ctx.fact(format!(
            "{}{}",
            if k == 0 {
                "Most likely: "
            } else {
                "Another candidate: "
            },
            group_facts(g, svc, routes, why)
        ));
    }
    for g in others {
        ctx.fact(format!(
            "Not a candidate: {}",
            group_facts(g, svc, routes, &[])
        ));
    }
    for (g, _) in ranked.iter().take(3) {
        group_excerpts(r, g, ctx);
    }
    service_excerpts(r, &[dir.to_string()], ctx);
    read_of(r.inv, &[dir.to_string()], ctx);
}

/// A code directory and the workloads that may run it: each with its images, whether
/// something reaches it from outside, and its manifest.
fn workload(
    r: &Reading<'_>,
    dir: &str,
    workloads: &[drift_mine::security::Workload],
    routes: &[String],
    ctx: &mut Context,
) {
    let svc = super::shown(dir);
    let mut listed: Vec<&str> = routes.iter().map(String::as_str).collect();
    listed.sort();
    listed.dedup();
    ctx.fact(format!(
        "The routes of {svc} ({}): {}",
        listed.len(),
        listed
            .iter()
            .take(MAX_ROUTES)
            .copied()
            .collect::<Vec<_>>()
            .join(", ")
    ));
    for w in workloads {
        ctx.fact(format!(
            "Workload {} ({}) runs {}{}",
            w.object,
            w.at,
            w.images.join(", "),
            if w.reached {
                "; something in the manifests reaches it from outside"
            } else {
                "; nothing in the manifests reaches it from outside"
            }
        ));
    }
    for w in workloads.iter().take(3) {
        if let Some((file, i)) = at(&w.at) {
            let lines = lines_of(r.root, file);
            // Its document: from a little above its name to the next `---`.
            let from = i.saturating_sub(3);
            let to = (i..lines.len())
                .find(|j| lines[*j].starts_with("---"))
                .unwrap_or(lines.len())
                .min(from + 40);
            ctx.excerpt(excerpt_of(
                &format!("workload `{}`", w.object),
                file,
                &lines,
                from,
                to,
            ));
        }
    }
    service_excerpts(r, &[dir.to_string()], ctx);
    read_of(r.inv, &[dir.to_string()], ctx);
}

fn reach(
    r: &Reading<'_>,
    dirs: &[String],
    groups: &[TargetGroup],
    terraform: &[String],
    ctx: &mut Context,
) {
    // What the entry points are: a queue consumer is reached by messages, not by
    // requests.
    for d in dirs {
        let rows: Vec<String> = r
            .inv
            .entry_points
            .iter()
            .filter(|e| !e.local && under(&e.path, d))
            .map(|e| {
                let what = match (&e.method, &e.route) {
                    (Some(m), Some(route)) => format!("{m} {route}"),
                    (None, Some(route)) => route.clone(),
                    _ => format!("`{}`", e.symbol),
                };
                format!("{what} ({}, {}:{})", e.kind, e.path, e.line)
            })
            .collect();
        if !rows.is_empty() {
            ctx.fact(format!(
                "The entry points of {}: {}.",
                super::shown(d),
                rows.join("; ")
            ));
        }
    }
    read_of(r.inv, dirs, ctx);
    let modules: BTreeSet<&str> = terraform
        .iter()
        .map(|f| f.rsplit_once('/').map_or(".", |(d, _)| d))
        .collect();
    ctx.fact(format!(
        "Drift does not read Terraform on its own: {} file{} in {} director{}: {}{}",
        terraform.len(),
        if terraform.len() == 1 { "" } else { "s" },
        modules.len(),
        if modules.len() == 1 { "y" } else { "ies" },
        modules
            .iter()
            .take(30)
            .copied()
            .collect::<Vec<_>>()
            .join(", "),
        if modules.len() > 30 {
            format!(" and {} more", modules.len() - 30)
        } else {
            String::new()
        }
    ));
    if groups.is_empty() {
        ctx.fact("Drift found no target group in that Terraform.");
    }
    for g in groups {
        let port = g
            .port
            .as_deref()
            .map_or_else(String::new, |p| format!(", port {p}"));
        let health = g
            .health
            .as_deref()
            .map_or_else(String::new, |h| format!(", health check {h}"));
        ctx.fact(format!(
            "Target group `{}` ({}{port}{health}): none of these services' routes matched it.",
            g.name, g.at
        ));
    }
    service_excerpts(r, dirs, ctx);
}

#[allow(clippy::too_many_arguments)]
fn check(
    r: &Reading<'_>,
    instrument: &str,
    kind: &str,
    units: &[(UnitRow, bool)],
    why: &str,
    obligation: &str,
    when: &str,
    ctx: &mut Context,
) {
    let Some((file, name)) = instrument.split_once('#') else {
        return;
    };
    let short = name.rsplit('.').next().unwrap_or(name);
    ctx.fact(format!(
        "Drift found {kind} in `{name}`, and cannot count it: {why}."
    ));
    ctx.fact(format!(
        "What failed, as Drift names it: `{obligation}`{}.",
        if when.is_empty() {
            String::new()
        } else {
            format!(" ({when})")
        }
    ));
    let lines = lines_of(r.root, file);
    let (loc, _) = super::source_of(r.root, instrument);
    if let Some((_, i)) = at(&loc) {
        ctx.excerpt(block("the function, in full", file, &lines, i));
    }
    // Its class, and how the class gets the caller.
    if let Some((class, _)) = name.rsplit_once('.') {
        let (loc, _) = super::source_of(r.root, &format!("{file}#{class}"));
        if let Some((_, i)) = at(&loc) {
            let end = block_end(&lines, i);
            let head_end = (i + 1..end)
                .find(|&j| {
                    let t = lines[j].trim_start();
                    t.starts_with("def ") || t.starts_with("async def ")
                })
                .unwrap_or((i + 6).min(end));
            ctx.excerpt(excerpt_of("its class", file, &lines, i, head_end));
        }
        let (loc, _) = super::source_of(r.root, &format!("{file}#{class}.__init__"));
        if let Some((_, i)) = at(&loc) {
            ctx.excerpt(block("how its class is given the caller", file, &lines, i));
        } else {
            let (loc, _) = super::source_of(r.root, &format!("{file}#{class}.constructor"));
            if let Some((_, i)) = at(&loc) {
                ctx.excerpt(block("how its class is given the caller", file, &lines, i));
            }
        }
        let class_short = class.rsplit('.').next().unwrap_or(class);
        let made = format!("{class_short}(");
        let mut shown = 0;
        for src in r.sources {
            let ls = lines_of(r.root, src);
            for (i, l) in ls.iter().enumerate() {
                let t = l.trim_start();
                if l.contains(&made)
                    && !t.starts_with("class ")
                    && !t.starts_with("export class ")
                    && !t.starts_with('#')
                    && !t.starts_with("//")
                {
                    if shown < 5 {
                        ctx.excerpt(excerpt_of(
                            &format!("where `{class_short}` is made"),
                            src,
                            &ls,
                            i.saturating_sub(3),
                            i + 2,
                        ));
                    } else {
                        ctx.omitted += 1;
                    }
                    shown += 1;
                }
            }
        }
    }
    // Where it is used (called, or given as a dependency), with the lines around it:
    // a method in its own file (`self.check(...)`; another class's method of the same
    // name is another function).
    let mut uses = 0;
    let own = [file.to_string()];
    let searched: &[String] = if name.contains('.') { &own } else { r.sources };
    for src in searched {
        let ls = lines_of(r.root, src);
        for (i, l) in ls.iter().enumerate() {
            let t = l.trim_start();
            let def = t.starts_with("def ")
                || t.starts_with("async def ")
                || t.starts_with("function ")
                || t.starts_with("export function ")
                || t.starts_with("export async function ")
                || t.starts_with("import ")
                || t.starts_with("from ")
                || t.starts_with('#')
                || t.starts_with("//");
            let word = |c: char| c.is_alphanumeric() || c == '_';
            let used = l
                .match_indices(short)
                .any(|(k, _)| !l[..k].ends_with(word) && !l[k + short.len()..].starts_with(word));
            if used && !def {
                if uses < 10 {
                    ctx.excerpt(excerpt_of(
                        &format!("a use of `{short}` (line {})", i + 1),
                        src,
                        &ls,
                        i.saturating_sub(3),
                        i + 3,
                    ));
                } else {
                    ctx.omitted += 1;
                }
                uses += 1;
            }
        }
    }
    ctx.fact(format!(
        "`{short}` is used on {uses} line{} of {} (the first {} shown).",
        if uses == 1 { "" } else { "s" },
        if name.contains('.') {
            format!("`{file}`")
        } else {
            "the repository's source outside tests".to_string()
        },
        uses.min(10)
    ));
    for (k, (u, every)) in units.iter().enumerate() {
        if k >= MAX_ROUTES {
            ctx.omitted += 1;
            continue;
        }
        ctx.routes.push(RouteCall {
            route: super::route_name(u),
            handler: format!("{}:{}", u.path, u.line),
            every_request: *every,
            stays_because: (!every).then(|| {
                u.not_proven
                    .as_ref()
                    .map_or("it does not reach the check on every request", |n| {
                        super::stays_because(&n.obligation)
                    })
                    .to_string()
            }),
        });
    }
    // The handlers of the first routes, the ones that stay unknown first.
    let mut handlers: Vec<&(UnitRow, bool)> = units.iter().collect();
    handlers.sort_by_key(|(_, every)| *every);
    for (u, every) in handlers.into_iter().take(6) {
        let ls = lines_of(r.root, &u.path);
        let Some(i) = (u.line as usize).checked_sub(1).filter(|&i| i < ls.len()) else {
            continue;
        };
        // From its decorators, where it has any, to the end of its body.
        let from = (0..i)
            .rev()
            .take_while(|&j| ls[j].trim_start().starts_with('@'))
            .last()
            .unwrap_or(i);
        let def = (i..ls.len().min(i + 15))
            .find(|&j| {
                let t = ls[j].trim_start();
                t.starts_with("def ")
                    || t.starts_with("async def ")
                    || t.starts_with("function ")
                    || t.starts_with("export ")
            })
            .unwrap_or(i);
        let end = block_end(&ls, def).min(def + 15);
        ctx.excerpt(excerpt_of(
            &format!(
                "the handler of {} ({})",
                super::route_name(u),
                if *every {
                    "reaches the check on every request"
                } else {
                    "stays unknown after a yes"
                }
            ),
            &u.path,
            &ls,
            from,
            end,
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ls(s: &str) -> Vec<String> {
        s.lines().map(str::to_string).collect()
    }

    #[test]
    fn a_block_ends_by_braces_or_indentation() {
        let tf = ls(
            "resource \"a\" \"b\" {\n  x = 1\n  y {\n    z = 2\n  }\n}\nresource \"c\" \"d\" {\n}\n",
        );
        assert_eq!(block_end(&tf, 0), 6);
        let py = ls("def f(a,\n      b):\n    if a:\n        return\n\n    g()\nx = 1\n");
        assert_eq!(block_end(&py, 0), 6);
    }

    #[test]
    fn an_excerpt_is_bounded() {
        let long: Vec<String> = (0..500)
            .map(|i| format!("{i} {}", "x".repeat(400)))
            .collect();
        let e = excerpt_of("w", "f", &long, 0, 500).unwrap();
        assert_eq!(e.text.lines().count(), MAX_EXCERPT_LINES + 1);
        assert!(e.text.ends_with("(460 more lines)"));
        assert!(e.text.lines().all(|l| l.chars().count() <= MAX_LINE + 3));
        let mut ctx = Context::default();
        for k in 0..100 {
            ctx.excerpt(excerpt_of(&format!("w{k}"), "f", &long, 0, 500));
        }
        assert!(ctx.excerpts.len() <= MAX_EXCERPTS);
        assert!(ctx.bytes() <= MAX_BYTES);
        assert!(ctx.omitted > 0);
    }

    #[test]
    fn a_service_built_from_above_is_known_by_its_dockerfile() {
        let dir = tempfile::tempdir().unwrap();
        let compose = "services:\n  gateway:\n    image: nginx:alpine\n  ledger:\n    build:\n      context: ../..\n      dockerfile: platform/apps/ledger/Dockerfile\n  other:\n    build:\n      context: ../..\n      dockerfile: platform/apps/other/Dockerfile\n  local:\n    build: ./local\n";
        std::fs::create_dir_all(dir.path().join("platform/apps")).unwrap();
        std::fs::write(dir.path().join("platform/apps/docker-compose.yml"), compose).unwrap();
        let found = compose_services(
            dir.path(),
            "platform/apps/docker-compose.yml",
            &["platform/apps/ledger".to_string()],
        );
        let names: Vec<(&str, &str, usize)> = found
            .iter()
            .map(|(n, e)| {
                let e = e.as_ref().unwrap();
                (n.as_str(), e.what.as_str(), e.line)
            })
            .collect();
        assert_eq!(
            names,
            [
                ("gateway", "compose service `gateway`, the gateway", 2),
                ("ledger", "compose service `ledger`", 4)
            ]
        );
        // Without the code it sends to, a gateway is not shown.
        let none = compose_services(
            dir.path(),
            "platform/apps/docker-compose.yml",
            &["frontend".to_string()],
        );
        assert!(none.is_empty(), "{none:?}");
    }

    #[test]
    fn a_path_is_normal() {
        assert_eq!(normal("e2e/../svc"), "svc");
        assert_eq!(normal("./a/./b"), "a/b");
    }
}
