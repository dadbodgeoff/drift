//! The hosting platforms' own files, read for what they serve and to whom.
//!
//! A platform that deploys an application and gives it a public URL makes that
//! application internet-facing by construction, and its file says so: a `vercel.json`
//! is the root of a Vercel project, a `fly.toml` with an `[http_service]` is served by
//! the Fly proxy on ports 80 and 443, a `render.yaml` service of `type: web` has an
//! `onrender.com` URL. Each reader here takes the platform's file Drift recognises
//! ([`super::unread_kind`]) and gives, for each thing it deploys (a [`Unit`]: a
//! project, a service, a process, a function), its exposure and the file and line
//! that say so:
//!
//! - **internet-facing** only where the file says the thing is served publicly;
//! - **internal** only on proof the file gives (a Fly app with no service that
//!   publishes a port, a Render private service or worker, a Heroku app with no
//!   `web` process, a function no HTTP event or function URL calls), and only where
//!   nothing else Drift reads speaks for the code;
//! - **unknown** otherwise, with a reason that names the file.
//!
//! A unit is tied to the code of the repository only by what the file itself says: a
//! root directory (`rootDir`, `[build] base`, `CodeUri`), a workspace package its
//! build or start command selects (`turbo run web#start`, `--filter web`, `cd
//! apps/web`), a file its command or handler names (`gunicorn app.wsgi`, `handler:
//! src/api.main`), or the directory of the file where the platform deploys that
//! directory. Where that directory holds several packages and the file does not
//! say which it deploys, the unit is tied at the inventory, by the entry points: the
//! directory itself where it has entry points of its own (or no package has any);
//! where only packages below it have them, it is not tied, and the question goes to a
//! person (`security.platforms` in `.drift/config.yaml`, which `drift setup` asks).
//!
//! A file read to the end, every unit of it tied, is a description Drift reads, as a
//! compose file is: it no longer keeps every other route from being called internal.
//! One with something the reader does not follow (a rewrite to another host, an
//! image built elsewhere, a resource that routes requests, a function deployed on a
//! condition) is still listed as not read, as before, besides what was read of it.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use drift_core::RepoFacts;
use serde::Serialize;
use serde_json::Value;

use super::{Boundaries, BoundaryRule, Exposure, join_dir, normal_dir};
use crate::policy::PlatformTie;
use crate::roles::is_test_path;

/// One thing a platform's file deploys: what it is, how it is reached, and the code
/// of the repository it runs, as far as the file says.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Unit {
    /// The platform's file, repo-relative.
    pub file: String,
    /// The platform (`Vercel`, `Fly.io`, ...).
    pub kind: String,
    /// The service, process or function the file names; "" where it deploys one thing.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub name: String,
    pub exposure: Exposure,
    /// What says so, with the file and line (`fly.toml:12: ...`).
    pub says: String,
    /// The code directory it runs, repo-relative ("" the whole repository), once tied.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Why it is not tied, when it is not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub untied: Option<String>,
    /// The applications it may deploy, where the file does not say which
    /// ([`Boundaries::tie_platforms`]): what `drift setup` asks about.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<String>,
    /// The directory it deploys, where its application is told by the entry points.
    #[serde(skip)]
    base: Option<String>,
    /// Its file was read to the end, the tie apart.
    #[serde(skip)]
    full: bool,
}

impl Unit {
    /// `render.yaml#api`, or the file alone for a file that deploys one thing: how a
    /// tie names it (`security.platforms`).
    pub fn target(&self) -> String {
        if self.name.is_empty() {
            self.file.clone()
        } else {
            format!("{}#{}", self.file, self.name)
        }
    }
}

/// What the readers found ([`read`]).
#[derive(Debug, Default)]
struct Reading {
    units: Vec<Unit>,
    /// The files read to the end, every unit of them tied.
    read: Vec<String>,
    warnings: Vec<String>,
}

/// How a unit's code is told.
enum Tie {
    /// The file says it.
    Dir(String),
    /// The platform deploys this directory, and it holds packages besides its own:
    /// which application it is, is told by the entry points.
    Base(String),
    /// It cannot be told, and why.
    Not(String),
}

/// The packages of the repository, by directory, with the name a manifest gives.
#[derive(Default)]
struct Manifests {
    dirs: BTreeMap<String, Option<String>>,
}

/// Files that make a directory a package (as [`crate::workspace`] counts them).
const MANIFESTS: &[&str] = &[
    "package.json",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
];

impl Manifests {
    fn read(root: &Path) -> Self {
        let walker = ignore::WalkBuilder::new(root)
            .max_depth(Some(super::COMPOSE_DEPTH + 2))
            .follow_links(false)
            .hidden(true)
            .git_ignore(true)
            .git_global(false)
            .git_exclude(false)
            .require_git(false)
            .filter_entry(|e| {
                !(e.file_type().is_some_and(|t| t.is_dir()) && e.file_name() == "node_modules")
            })
            .build();
        let mut out = Self::default();
        for e in walker.filter_map(Result::ok) {
            let Some(name) = e.file_name().to_str() else {
                continue;
            };
            if !MANIFESTS.contains(&name) || !e.file_type().is_some_and(|t| t.is_file()) {
                continue;
            }
            let Ok(rel) = e.path().strip_prefix(root) else {
                continue;
            };
            let rel = rel.to_string_lossy().replace('\\', "/");
            let dir = rel.rsplit_once('/').map_or("", |(d, _)| d).to_string();
            let text = || std::fs::read_to_string(e.path()).ok();
            let named = match name {
                "package.json" => text()
                    .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                    .and_then(|v| Some(v.get("name")?.as_str()?.to_string())),
                "pyproject.toml" => text()
                    .and_then(|t| toml::from_str::<toml::Value>(&t).ok())
                    .and_then(|v| {
                        let n = v
                            .get("project")
                            .and_then(|p| p.get("name"))
                            .or_else(|| v.get("tool")?.get("poetry")?.get("name"))?;
                        Some(n.as_str()?.to_string())
                    }),
                _ => None,
            };
            let slot = out.dirs.entry(dir).or_default();
            if slot.is_none() {
                *slot = named;
            }
        }
        out
    }

    /// The package directories strictly below `dir`.
    fn below<'a>(&'a self, dir: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.dirs
            .keys()
            .map(String::as_str)
            .filter(move |d| strictly_under(d, dir))
    }

    /// The directory of the package named `name`, when exactly one has that name.
    fn named(&self, name: &str) -> Option<&str> {
        let mut found = self
            .dirs
            .iter()
            .filter(|(_, n)| n.as_deref() == Some(name))
            .map(|(d, _)| d.as_str());
        let first = found.next()?;
        found.next().is_none().then_some(first)
    }

    /// The package `file` is in, at or below `base`: its nearest manifest, or `base`.
    fn owner(&self, base: &str, file: &str) -> String {
        self.dirs
            .keys()
            .filter(|d| (d.as_str() == base || strictly_under(d, base)) && under(file, d))
            .max_by_key(|d| d.len())
            .cloned()
            .unwrap_or_else(|| base.to_string())
    }
}

/// What the readers share: the repository, and its packages, read once when a reader
/// first needs them.
struct Cx<'a> {
    root: &'a Path,
    manifests: std::cell::OnceCell<Manifests>,
}

impl Cx<'_> {
    /// [`tie`], in this repository.
    fn tie(&self, base: &str, hints: &[String]) -> Tie {
        let m = self.manifests.get_or_init(|| Manifests::read(self.root));
        tie(self.root, m, base, hints)
    }
}

/// `path` is `dir` or below it ("" holds everything).
fn under(path: &str, dir: &str) -> bool {
    dir.is_empty() || path == dir || path.starts_with(&format!("{dir}/"))
}

/// `path` is below `dir` and is not `dir`.
fn strictly_under(path: &str, dir: &str) -> bool {
    path != dir && under(path, dir)
}

/// A directory as people read it.
fn shown(dir: &str) -> String {
    if dir.is_empty() {
        "the repository root".to_string()
    } else {
        format!("`{dir}`")
    }
}

/// The first line (1-based) of `text` that `pred` holds for; 1 when none does.
fn line_of(text: &str, pred: impl Fn(&str) -> bool) -> usize {
    text.lines()
        .position(|l| pred(l.trim()))
        .map_or(1, |i| i + 1)
}

/// JSON with comments and trailing commas (`wrangler.jsonc`) as plain JSON.
fn plain_json(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if c == '\\' {
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_string = true;
                out.push(c);
            }
            ('/', Some('/')) => {
                for n in chars.by_ref() {
                    if n == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            ('/', Some('*')) => {
                chars.next();
                let mut last = ' ';
                for n in chars.by_ref() {
                    if n == '\n' {
                        out.push('\n');
                    }
                    if last == '*' && n == '/' {
                        break;
                    }
                    last = n;
                }
            }
            _ => out.push(c),
        }
    }
    // A comma before a closing bracket.
    let mut cleaned = String::with_capacity(out.len());
    let bytes: Vec<char> = out.chars().collect();
    let mut in_string = false;
    for (i, &c) in bytes.iter().enumerate() {
        if in_string {
            if c == '"' && bytes[..i].iter().rev().take_while(|b| **b == '\\').count() % 2 == 0 {
                in_string = false;
            }
            cleaned.push(c);
            continue;
        }
        if c == '"' {
            in_string = true;
        }
        if c == ','
            && bytes[i + 1..]
                .iter()
                .find(|b| !b.is_whitespace())
                .is_some_and(|b| *b == '}' || *b == ']')
        {
            continue;
        }
        cleaned.push(c);
    }
    cleaned
}

/// A CloudFormation template in YAML with its short-form functions (`!Ref Api`,
/// `!GetAtt Fn.Arn`, `!Sub "..."`) taken off, leaving their arguments: the structure
/// is what is read, never what a function computes.
fn untagged(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let starts = i == 0 || matches!(chars[i - 1], ' ' | '\t' | '[' | ',' | '\n');
        if c == '!' && starts && chars.get(i + 1).is_some_and(|n| n.is_ascii_uppercase()) {
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == ':') {
                i += 1;
            }
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

/// The words of shell commands, split at the separators a command line chains with.
fn words(commands: &[String]) -> Vec<Vec<String>> {
    commands
        .iter()
        .flat_map(|c| {
            c.split(['&', ';', '|', '\n'])
                .map(|seg| {
                    seg.split_whitespace()
                        .map(|w| w.trim_matches(['"', '\'', '(', ')']).to_string())
                        .filter(|w| !w.is_empty())
                        .collect::<Vec<_>>()
                })
                .filter(|seg| !seg.is_empty())
                .collect::<Vec<_>>()
        })
        .collect()
}

/// The workspace packages a command selects, as the tools that run workspaces
/// document them: `cd <dir>`, `--filter <pkg>` (turbo, pnpm), `turbo run <pkg>#<task>`,
/// `--workspace <pkg>` (npm), `yarn workspace <pkg>`.
fn selectors(segments: &[Vec<String>]) -> Vec<String> {
    let mut out = Vec::new();
    for seg in segments {
        let turbo = seg.iter().any(|w| w == "turbo");
        for (i, w) in seg.iter().enumerate() {
            let next = || seg.get(i + 1).cloned();
            let picked = match w.as_str() {
                "cd" if i == 0 => next().map(|d| format!("./{}", d.trim_start_matches("./"))),
                "--filter" | "-F" | "--workspace" => next(),
                "workspace" if i > 0 && seg[i - 1] == "yarn" => next(),
                _ => w
                    .strip_prefix("--filter=")
                    .or_else(|| w.strip_prefix("--workspace="))
                    .map(str::to_string)
                    .or_else(|| {
                        let (pkg, task) = w.split_once('#')?;
                        (turbo && !pkg.is_empty() && !task.is_empty() && !w.starts_with('-'))
                            .then(|| pkg.to_string())
                    }),
            };
            out.extend(picked);
        }
    }
    out
}

/// The repo-relative files a command or a handler names, below `base`: a path that
/// is a file, a Python module (`app.wsgi`, `app.main:app`) that is one, or a handler
/// (`src/api.main`, a file and the function it exports) whose file is one.
fn named_files(root: &Path, base: &str, segments: &[Vec<String>]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let is_file = |rel: &str| root.join(rel).is_file();
    for w in segments.iter().flatten() {
        if w.starts_with('-') || w.contains("://") || w.contains('=') {
            continue;
        }
        if let Some(rel) = join_dir(base, w)
            && is_file(&rel)
        {
            out.insert(rel);
            continue;
        }
        let module = w.split(':').next().unwrap_or(w);
        if module.contains('.') && !module.contains('/') {
            let path = module.replace('.', "/");
            for cand in [format!("{path}.py"), format!("{path}/__init__.py")] {
                if let Some(rel) = join_dir(base, &cand)
                    && is_file(&rel)
                {
                    out.insert(rel);
                }
            }
        }
        if let Some(rel) = handler_file(root, base, w) {
            out.insert(rel);
        }
    }
    out
}

/// The source file of a function handler (`src/handlers/api.main`: the file
/// `src/handlers/api` with an extension, and the function it exports), below `base`.
fn handler_file(root: &Path, base: &str, handler: &str) -> Option<String> {
    let (file, _) = handler.rsplit_once('.')?;
    if file.is_empty() || file.contains("${") {
        return None;
    }
    let dotted = file.replace('.', "/");
    [file, dotted.as_str()].into_iter().find_map(|f| {
        ["js", "mjs", "cjs", "ts", "mts", "py", "rb", "go"]
            .iter()
            .find_map(|ext| {
                let rel = join_dir(base, &format!("{f}.{ext}"))?;
                root.join(&rel).is_file().then_some(rel)
            })
    })
}

/// The code a unit deployed from `base` runs, as `hints` (its build and start
/// commands, its entry files) say: a package they select, the package a file they
/// name is in, or `base` where it holds no package besides its own.
fn tie(root: &Path, m: &Manifests, base: &str, hints: &[String]) -> Tie {
    let segments = words(hints);
    let mut picked = BTreeSet::new();
    for s in selectors(&segments) {
        let s = s
            .trim_start_matches("...")
            .trim_end_matches("...")
            .trim_start_matches('^')
            .trim_start_matches('{')
            .trim_end_matches('}')
            .to_string();
        let dir = if s.starts_with("./") || s.starts_with("../") {
            join_dir(base, &s).filter(|d| root.join(d).is_dir())
        } else if s.contains('*') {
            None
        } else {
            m.named(&s).map(str::to_string)
        };
        match dir {
            Some(d) => {
                picked.insert(d);
            }
            None => {
                return Tie::Not(format!(
                    "its command selects `{}`, which is no package or directory Drift found",
                    crate::report::sanitize(&s, 80)
                ));
            }
        }
    }
    match picked.len() {
        0 => {}
        1 => return Tie::Dir(picked.into_iter().next().unwrap_or_default()),
        _ => {
            return Tie::Not(format!(
                "its commands select several packages ({})",
                picked.into_iter().collect::<Vec<_>>().join(", ")
            ));
        }
    }
    if m.below(base).next().is_none() {
        return Tie::Dir(base.to_string());
    }
    let owners: BTreeSet<String> = named_files(root, base, &segments)
        .iter()
        .map(|f| m.owner(base, f))
        .collect();
    match owners.len() {
        1 => Tie::Dir(owners.into_iter().next().unwrap_or_default()),
        _ => Tie::Base(base.to_string()),
    }
}

/// A unit before it is tied.
struct Found {
    name: String,
    exposure: Exposure,
    says: String,
    tie: Tie,
}

fn found(name: &str, exposure: Exposure, says: String, tie: Tie) -> Found {
    Found {
        name: name.to_string(),
        exposure,
        says,
        tie,
    }
}

/// What one reader made of one file: its units, and whether it was read to the end.
struct Read {
    kind: &'static str,
    units: Vec<Found>,
    full: bool,
}

/// Reads the platform files among `unread` (kind and path, as [`super::deployments`]
/// lists them; those left out by `security.not_deployed` are not given) with the
/// ties a person wrote (`security.platforms`).
fn read(root: &Path, unread: &[(String, String)], ties: &[PlatformTie]) -> Reading {
    let mut out = Reading::default();
    let cx = Cx {
        root,
        manifests: std::cell::OnceCell::new(),
    };
    let mut sam_dirs = Vec::new();
    for (kind, file) in unread {
        let name = file.rsplit('/').next().unwrap_or(file);
        let dir = file.rsplit_once('/').map_or("", |(d, _)| d);
        let Some(text) = super::read_small(&root.join(file)) else {
            continue;
        };
        let got = match name {
            "vercel.json" => vercel(file, dir, &text, &cx),
            "netlify.toml" => netlify(file, dir, &text, &cx),
            "fly.toml" => fly(file, dir, &text, &cx),
            "render.yaml" => render(file, dir, &text, &cx),
            "Procfile" if root.join(dir).join("app.json").is_file() => {
                procfile(file, dir, &text, &cx)
            }
            "app.yaml" if kind == "App Engine" => app_engine(file, dir, &text, &cx),
            "serverless.yml" | "serverless.yaml" => serverless(file, dir, &text),
            "wrangler.toml" | "wrangler.json" | "wrangler.jsonc" => wrangler(file, dir, &text, &cx),
            _ if kind == "CloudFormation" && text.contains("AWS::Serverless::Function") => {
                sam(file, dir, &text)
            }
            _ if kind == "Kubernetes" && text.contains("serving.knative.dev/") => {
                cloud_run(file, &text)
            }
            _ => continue,
        };
        let got = match got {
            Ok(got) => got,
            Err(why) => {
                out.warnings.push(format!(
                    "{file}: not read as a platform's file ({why}); what it serves is unknown"
                ));
                continue;
            }
        };
        // A file that deploys nothing Drift reads is not one read to the end.
        let mut every_tied = !got.units.is_empty();
        for f in got.units {
            let target = if f.name.is_empty() {
                file.clone()
            } else {
                format!("{file}#{}", f.name)
            };
            // A person's word ties a unit the file does not tie.
            let tied = ties.iter().find(|t| t.file == target || t.file == *file);
            let (code, base, untied) = match (tied, f.tie) {
                (Some(t), _) => (Some(t.code.clone()), None, None),
                (None, Tie::Dir(d)) => (Some(d), None, None),
                (None, Tie::Base(b)) => {
                    every_tied = false;
                    (None, Some(b), None)
                }
                (None, Tie::Not(why)) => {
                    every_tied = false;
                    out.warnings.push(format!(
                        "{target}: {why}, so what it serves is unknown; security.platforms in {} can tie it to its code ({{file: {target}, code: <dir>}})",
                        crate::policy::CONFIG_FILE
                    ));
                    (None, None, Some(why))
                }
            };
            let says = match tied {
                Some(t) => format!(
                    "{}, which runs {} as {} says (security.platforms)",
                    f.says,
                    shown(&t.code),
                    crate::policy::CONFIG_FILE
                ),
                None => f.says,
            };
            out.units.push(Unit {
                file: file.clone(),
                kind: got.kind.to_string(),
                name: f.name,
                exposure: f.exposure,
                says,
                code: code.map(|c| normal_dir(&c)),
                untied,
                candidates: Vec::new(),
                base,
                full: got.full,
            });
        }
        if got.full && every_tied {
            out.read.push(file.clone());
            if got.kind == "SAM" {
                sam_dirs.push(dir.to_string());
            }
        }
    }
    // A SAM template read to the end: the samconfig beside it only gives the values
    // of its parameters to the deploy command.
    for (kind, file) in unread {
        let dir = file.rsplit_once('/').map_or("", |(d, _)| d);
        if kind == "SAM" && sam_dirs.iter().any(|d| d == dir) {
            out.read.push(file.clone());
        }
    }
    out.units.sort();
    out.read.sort();
    out.read.dedup();
    out
}

type Got = Result<Read, String>;

/// `vercel.json`: the root of a Vercel project, which Vercel serves on its public
/// deployment URLs. A rewrite or route to another host sends requests elsewhere:
/// the file is then still listed as not read.
fn vercel(file: &str, dir: &str, text: &str, cx: &Cx) -> Got {
    let v: Value = serde_json::from_str(&plain_json(text)).map_err(|e| e.to_string())?;
    let elsewhere = ["rewrites", "routes"]
        .iter()
        .filter_map(|k| v.get(*k)?.as_array())
        .flatten()
        .any(|r| {
            ["destination", "dest"]
                .iter()
                .filter_map(|k| r.get(*k)?.as_str())
                .any(|d| d.contains("://"))
        });
    let mut hints: Vec<String> = ["buildCommand", "installCommand"]
        .iter()
        .filter_map(|k| Some(v.get(*k)?.as_str()?.to_string()))
        .collect();
    hints.extend(
        v.get("builds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|b| Some(b.get("src")?.as_str()?.to_string())),
    );
    let says = format!(
        "{file}:1: Vercel serves the project rooted at {} on its public deployment URLs",
        shown(dir)
    );
    Ok(Read {
        kind: "Vercel",
        units: vec![found("", Exposure::Public, says, cx.tie(dir, &hints))],
        full: !elsewhere,
    })
}

/// `netlify.toml`: the site Netlify serves on its public URL, built in `[build] base`
/// (relative to the repository root; the file's own directory without one), with
/// the functions of `[functions] directory` (relative to the base) served under
/// `/.netlify/functions/`. A redirect that proxies to another host keeps the file
/// listed as not read.
fn netlify(file: &str, dir: &str, text: &str, cx: &Cx) -> Got {
    let v: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
    let build = v.get("build");
    let base = build
        .and_then(|b| b.get("base"))
        .and_then(toml::Value::as_str)
        .map_or_else(|| dir.to_string(), normal_dir);
    let hints: Vec<String> = build
        .and_then(|b| b.get("command"))
        .and_then(toml::Value::as_str)
        .map(str::to_string)
        .into_iter()
        .collect();
    let elsewhere = v
        .get("redirects")
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .any(|r| {
            r.get("to")
                .and_then(toml::Value::as_str)
                .is_some_and(|t| t.contains("://"))
        });
    let line = line_of(text, |l| l.starts_with("[build]"));
    let mut units = vec![found(
        "",
        Exposure::Public,
        format!(
            "{file}:{line}: Netlify serves the site built in {} on its public URL",
            shown(&base)
        ),
        cx.tie(&base, &hints),
    )];
    if let Some(fdir) = v
        .get("functions")
        .and_then(|f| f.get("directory"))
        .and_then(toml::Value::as_str)
        && let Some(fdir) = join_dir(&base, fdir)
    {
        let line = line_of(text, |l| l.starts_with("directory"));
        units.push(found(
            "functions",
            Exposure::Public,
            format!(
                "{file}:{line}: Netlify serves the functions in {} under /.netlify/functions/ on the site's public URL",
                shown(&fdir)
            ),
            Tie::Dir(fdir),
        ));
    }
    Ok(Read {
        kind: "Netlify",
        units,
        full: !elsewhere,
    })
}

/// `fly.toml`: an app the Fly proxy serves from the internet where it has an
/// `[http_service]` (ports 80 and 443) or a `[[services]]` entry with `ports`. With
/// neither, the proxy routes nothing from the internet to it: it is reached on the
/// organisation's private network only. An app that deploys an image, or builds a
/// Dockerfile of another directory, runs code the file does not tie.
fn fly(file: &str, dir: &str, text: &str, cx: &Cx) -> Got {
    let v: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
    let app = v.get("app").and_then(toml::Value::as_str).unwrap_or("");
    let build = v.get("build");
    let image = build
        .and_then(|b| b.get("image"))
        .and_then(toml::Value::as_str);
    let dockerfile = build
        .and_then(|b| b.get("dockerfile"))
        .and_then(toml::Value::as_str);
    let mut hints: Vec<String> = Vec::new();
    match v.get("processes") {
        Some(toml::Value::Table(t)) => {
            hints.extend(t.values().filter_map(|c| c.as_str().map(str::to_string)));
        }
        Some(toml::Value::Array(a)) => {
            hints.extend(a.iter().filter_map(|c| c.as_str().map(str::to_string)));
        }
        _ => {}
    }
    let tied = match (image, dockerfile) {
        (Some(image), _) => Tie::Not(format!(
            "it deploys the image `{}`, which is not built from the repository here",
            crate::report::sanitize(image, 80)
        )),
        (_, Some(d)) if d.contains("..") => Tie::Not(format!(
            "it builds `{}`, a Dockerfile outside its directory",
            crate::report::sanitize(d, 80)
        )),
        _ => cx.tie(dir, &hints),
    };
    let ported = v
        .get("services")
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|s| s.get("ports")?.as_array())
        .flatten()
        .filter_map(|p| p.get("port")?.as_integer())
        .collect::<BTreeSet<i64>>();
    let named = if app.is_empty() {
        "the app".to_string()
    } else {
        format!("app `{}`", crate::report::sanitize(app, 60))
    };
    let (exposure, says) = if v.get("http_service").is_some() {
        let line = line_of(text, |l| l.starts_with("[http_service]"));
        (
            Exposure::Public,
            format!(
                "{file}:{line}: the Fly proxy serves {named} from the internet on ports 80 and 443 ([http_service])"
            ),
        )
    } else if !ported.is_empty() {
        let line = line_of(text, |l| l.starts_with("[[services.ports]]"));
        (
            Exposure::Public,
            format!(
                "{file}:{line}: the Fly proxy serves {named} from the internet on port{} {} ([[services]])",
                if ported.len() == 1 { "" } else { "s" },
                ported
                    .iter()
                    .map(i64::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        )
    } else {
        (
            Exposure::Internal,
            format!(
                "{file}:1: {named} has no [http_service] and no [[services]] port, so the Fly proxy routes nothing from the internet to it: it is reached on its private network only"
            ),
        )
    };
    Ok(Read {
        kind: "Fly.io",
        full: !matches!(tied, Tie::Not(_)),
        units: vec![found("", exposure, says, tied)],
    })
}

/// `render.yaml`, a Render Blueprint at the repository root: each service is served on
/// its public `onrender.com` URL when it is `type: web`; a private service (`pserv`),
/// a background worker and a cron job get no public URL. Its code is its `rootDir`
/// or its `dockerContext` (both relative to the repository root), or the repository with
/// what its build and start commands select. A service of another repository (`repo`)
/// keeps the file listed as not read.
fn render(file: &str, dir: &str, text: &str, cx: &Cx) -> Got {
    let v: Value = serde_saphyr::from_str(text).map_err(|e| e.to_string())?;
    let services = v
        .get("services")
        .and_then(Value::as_array)
        .ok_or("no `services` list")?;
    let mut full = true;
    let mut units = Vec::new();
    for s in services {
        let str_of = |k: &str| s.get(k).and_then(Value::as_str);
        let name = str_of("name").unwrap_or("").to_string();
        let ty = str_of("type").unwrap_or("");
        let line = line_of(text, |l| {
            l.trim_start_matches("- ").starts_with("name:") && l.contains(name.as_str())
        });
        let who = format!(
            "{file}:{line}: Render service `{}`",
            crate::report::sanitize(&name, 60)
        );
        let (exposure, says) = match ty {
            "web" => (
                Exposure::Public,
                format!(
                    "{who} is a web service, which Render serves on its public onrender.com URL"
                ),
            ),
            "pserv" => (
                Exposure::Internal,
                format!(
                    "{who} is a private service: Render gives it no public URL, and it is reached on the private network only"
                ),
            ),
            "worker" => (
                Exposure::Internal,
                format!("{who} is a background worker: Render routes no requests to it"),
            ),
            "cron" => (
                Exposure::Internal,
                format!(
                    "{who} is a cron job: Render runs it on a schedule and routes no requests to it"
                ),
            ),
            // Datastores: no code of the repository.
            "keyvalue" | "redis" => continue,
            other => (
                Exposure::Unknown,
                format!(
                    "{who} is of type `{}`, which Drift does not read",
                    crate::report::sanitize(other, 40)
                ),
            ),
        };
        let tied = if let Some(repo) = str_of("repo").filter(|r| !r.is_empty()) {
            full = false;
            Tie::Not(format!(
                "it deploys `{}`, another repository",
                crate::report::sanitize(repo, 80)
            ))
        } else if let Some(d) = str_of("rootDir") {
            match join_dir("", d) {
                Some(d) => Tie::Dir(d),
                None => Tie::Not("its rootDir is outside the repository".to_string()),
            }
        } else if let Some(d) = str_of("dockerContext") {
            match join_dir("", d) {
                Some(d) => Tie::Dir(d),
                None => Tie::Not("its dockerContext is outside the repository".to_string()),
            }
        } else {
            let hints: Vec<String> = ["buildCommand", "startCommand", "preDeployCommand"]
                .iter()
                .filter_map(|k| str_of(k).map(str::to_string))
                .collect();
            cx.tie(dir, &hints)
        };
        units.push(found(&name, exposure, says, tied));
    }
    Ok(Read {
        kind: "Render",
        units,
        full,
    })
}

/// A `Procfile` beside an `app.json` (a Heroku app): Heroku routes requests from the
/// app's public URL to its `web` process, and to no other process type. The code is
/// the directory of the files, or what the web command selects or names.
fn procfile(file: &str, dir: &str, text: &str, cx: &Cx) -> Got {
    let processes: Vec<(usize, &str, &str)> = text
        .lines()
        .enumerate()
        .filter_map(|(i, l)| {
            let (name, cmd) = l.split_once(':')?;
            let name = name.trim();
            (!name.is_empty()
                && !l.trim_start().starts_with('#')
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
            .then(|| (i + 1, name, cmd.trim()))
        })
        .collect();
    if processes.is_empty() {
        return Err("no process types".to_string());
    }
    let unit = match processes.iter().find(|(_, n, _)| *n == "web") {
        Some((line, _, cmd)) => found(
            "",
            Exposure::Public,
            format!(
                "{file}:{line}: Heroku routes requests from the app's public URL to its web process (`{}`)",
                crate::report::sanitize(cmd, 80)
            ),
            cx.tie(dir, &[cmd.to_string()]),
        ),
        None => found(
            "",
            Exposure::Internal,
            format!(
                "{file}:1: declares no web process, and Heroku routes requests only to the web process"
            ),
            cx.tie(
                dir,
                &processes
                    .iter()
                    .map(|(_, _, c)| c.to_string())
                    .collect::<Vec<_>>(),
            ),
        ),
    };
    Ok(Read {
        kind: "Procfile",
        units: vec![unit],
        full: true,
    })
}

/// App Engine's `app.yaml`: App Engine deploys the directory of the file as a
/// service and serves it on its public `appspot.com` URL. Ingress settings are made
/// outside the file, and are not read.
fn app_engine(file: &str, dir: &str, text: &str, cx: &Cx) -> Got {
    let v: Value = serde_saphyr::from_str(text).map_err(|e| e.to_string())?;
    let service = v
        .get("service")
        .and_then(Value::as_str)
        .unwrap_or("default");
    let hints: Vec<String> = v
        .get("entrypoint")
        .and_then(Value::as_str)
        .map(str::to_string)
        .into_iter()
        .collect();
    let line = line_of(text, |l| l.starts_with("runtime:"));
    Ok(Read {
        kind: "App Engine",
        units: vec![found(
            "",
            Exposure::Public,
            format!(
                "{file}:{line}: App Engine serves service `{}` on its public appspot.com URL (ingress settings made outside the file are not read)",
                crate::report::sanitize(service, 60)
            ),
            cx.tie(dir, &hints),
        )],
        full: true,
    })
}

/// A Cloud Run service (`serving.knative.dev/v1` `Service`): served on its public
/// `run.app` URL with ingress `all` (the default when the
/// `run.googleapis.com/ingress` annotation is absent), from inside its project's
/// networks only with `internal`, and through a load balancer Drift does not read
/// with `internal-and-cloud-load-balancing`. It runs an image: which code of the
/// repository that is, is never in the file, so only a person ties it.
fn cloud_run(file: &str, text: &str) -> Got {
    let docs: Vec<&str> = text
        .split("\n---")
        .filter(|d| !d.trim().is_empty())
        .collect();
    let [doc] = docs.as_slice() else {
        return Err("more than one object in the file".to_string());
    };
    let v: Value = serde_saphyr::from_str(doc).map_err(|e| e.to_string())?;
    let api = v.get("apiVersion").and_then(Value::as_str).unwrap_or("");
    if !api.starts_with("serving.knative.dev/")
        || v.get("kind").and_then(Value::as_str) != Some("Service")
    {
        return Err("not a Cloud Run service".to_string());
    }
    let name = v
        .pointer("/metadata/name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let ingress = v
        .pointer("/metadata/annotations")
        .and_then(|a| a.get("run.googleapis.com/ingress"))
        .and_then(Value::as_str);
    let line = match ingress {
        Some(_) => line_of(text, |l| l.contains("run.googleapis.com/ingress")),
        None => line_of(text, |l| l.starts_with("kind:")),
    };
    let who = format!(
        "{file}:{line}: Cloud Run service `{}`",
        crate::report::sanitize(&name, 60)
    );
    let (exposure, says) = match ingress {
        None | Some("all") => (
            Exposure::Public,
            format!("{who} takes requests from the internet on its run.app URL (ingress all)"),
        ),
        Some("internal") => (
            Exposure::Internal,
            format!(
                "{who} takes requests only from inside its project's networks (ingress internal)"
            ),
        ),
        Some(other) => (
            Exposure::Unknown,
            format!(
                "{who} has ingress `{}`: a load balancer Drift does not read may route the internet to it",
                crate::report::sanitize(other, 60)
            ),
        ),
    };
    let image = v
        .pointer("/spec/template/spec/containers/0/image")
        .and_then(Value::as_str)
        .unwrap_or("an image");
    Ok(Read {
        kind: "Cloud Run",
        units: vec![found(
            "",
            exposure,
            says,
            Tie::Not(format!(
                "it runs `{}`, and the file does not say which code of the repository that is built from",
                crate::report::sanitize(image, 80)
            )),
        )],
        full: true,
    })
}

/// Event sources of a function that are no HTTP request: SAM event types and
/// Serverless Framework event names that a queue, a schedule, a stream, a bucket, a
/// topic or another AWS service fires.
const NOT_HTTP: &[&str] = &[
    // SAM
    "SQS",
    "SNS",
    "S3",
    "Schedule",
    "ScheduleV2",
    "CloudWatchEvent",
    "EventBridgeRule",
    "DynamoDB",
    "Kinesis",
    "MSK",
    "MQ",
    "SelfManagedKafka",
    "CloudWatchLogs",
    "IoTRule",
    "AlexaSkill",
    "Cognito",
    "DocumentDB",
    // Serverless Framework
    "sqs",
    "sns",
    "s3",
    "schedule",
    "stream",
    "eventBridge",
    "cloudwatchEvent",
    "cloudwatchLog",
    "cognitoUserPool",
    "iot",
    "alexaSkill",
    "alexaSmartHome",
    "kafka",
    "activemq",
    "rabbitmq",
    "msk",
];

/// Resource types of a template that route no request to a function and serve
/// nothing themselves: with any other, the template is listed as not read.
const QUIET_RESOURCES: &[&str] = &[
    "AWS::Serverless::Function",
    "AWS::Serverless::Api",
    "AWS::Serverless::HttpApi",
    "AWS::Serverless::SimpleTable",
    "AWS::Serverless::LayerVersion",
    "AWS::DynamoDB::Table",
    "AWS::SQS::Queue",
    "AWS::SQS::QueuePolicy",
    "AWS::SNS::Topic",
    "AWS::SNS::Subscription",
    "AWS::S3::Bucket",
    "AWS::IAM::Role",
    "AWS::IAM::Policy",
    "AWS::IAM::ManagedPolicy",
    "AWS::Logs::LogGroup",
    "AWS::Events::Rule",
    "AWS::SecretsManager::Secret",
    "AWS::SSM::Parameter",
    "AWS::KMS::Key",
    "AWS::Cognito::UserPool",
    "AWS::Cognito::UserPoolClient",
];

/// What the events of one function say.
#[derive(Default)]
struct Events {
    /// `GET /users`, for each HTTP event that routes a path or a method of its own.
    paths: Vec<String>,
    /// An HTTP event routes every path to it (`/{proxy+}`, an HTTP API with no path,
    /// `$default`, `*`), or it has a function URL.
    every: Option<String>,
    /// The authorizers its HTTP events run first.
    authorizers: BTreeSet<String>,
    /// Event types Drift does not know.
    unknown: BTreeSet<String>,
    /// The event types it has that are no HTTP request.
    quiet: BTreeSet<String>,
}

impl Events {
    /// An HTTP event at `path` (none: every path) for `method`, with `authorizer`.
    fn http(
        &mut self,
        what: &str,
        path: Option<&str>,
        method: Option<&str>,
        authorizer: Option<String>,
    ) {
        match path {
            None | Some("$default" | "*") => {
                self.every.get_or_insert_with(|| what.to_string());
            }
            Some(p)
                if p.contains("{proxy+}")
                    && method.is_none_or(|m| m.eq_ignore_ascii_case("any") || m == "*") =>
            {
                self.every.get_or_insert_with(|| format!("{what} {p}"));
            }
            Some(p) => self.paths.push(format!(
                "{} {p}",
                method.unwrap_or("ANY").to_ascii_uppercase()
            )),
        }
        if let Some(a) = authorizer.filter(|a| !a.eq_ignore_ascii_case("none")) {
            self.authorizers.insert(a);
        }
    }

    /// The exposure of the function and what says so.
    fn verdict(&self, who: &str) -> (Exposure, String) {
        let guard = if self.authorizers.is_empty() {
            String::new()
        } else {
            format!(
                "; API Gateway runs the authorizer {} first, which Drift does not read: whether it turns a caller away is not known",
                self.authorizers
                    .iter()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        if let Some(every) = &self.every {
            return (
                Exposure::Public,
                format!("{who} is served from the internet on every path by {every}{guard}"),
            );
        }
        if !self.paths.is_empty() {
            return (
                Exposure::Unknown,
                format!(
                    "{who} is served from the internet for {} only; which of the routes of its code those are is not read{guard}",
                    self.paths.join(", ")
                ),
            );
        }
        if !self.unknown.is_empty() {
            return (
                Exposure::Unknown,
                format!(
                    "{who} has events of type {}, which Drift does not read",
                    self.unknown.iter().cloned().collect::<Vec<_>>().join(", ")
                ),
            );
        }
        (
            Exposure::Internal,
            format!(
                "{who} has no HTTP event and no function URL ({}): no request from the internet is routed to it",
                if self.quiet.is_empty() {
                    "no event at all".to_string()
                } else {
                    format!(
                        "only {}",
                        self.quiet.iter().cloned().collect::<Vec<_>>().join(", ")
                    )
                }
            ),
        )
    }
}

/// The name a CloudFormation value refers to (`Ref: Api`, `!Ref Api` once untagged,
/// `Fn::GetAtt: [Api, Arn]`).
fn referred(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.split('.').next().unwrap_or(s).trim().to_string()),
        Value::Object(o) => o
            .get("Ref")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                o.get("Fn::GetAtt")?
                    .as_array()?
                    .first()?
                    .as_str()
                    .map(str::to_string)
            }),
        _ => None,
    }
}

/// An AWS SAM template: each `AWS::Serverless::Function` runs the code of its
/// `CodeUri` (relative to the template), served from the internet on the paths its
/// `Api` and `HttpApi` events (and a `FunctionUrlConfig`) route to it, and on none
/// where it has no such event. A resource that may route requests elsewhere (an API
/// with an OpenAPI definition, an API Gateway or load balancer resource of its own, a
/// function URL resource), or a function deployed on a condition, keeps the template
/// listed as not read.
fn sam(file: &str, dir: &str, text: &str) -> Got {
    let v: Value = if file.ends_with(".json") {
        serde_json::from_str(text).map_err(|e| e.to_string())?
    } else {
        serde_saphyr::from_str(&untagged(text)).map_err(|e| e.to_string())?
    };
    let resources = v
        .get("Resources")
        .and_then(Value::as_object)
        .ok_or("no `Resources`")?;
    let globals = v.pointer("/Globals/Function");
    let mut full = true;
    // The APIs of the template with a default authorizer, and the implicit ones'.
    let mut api_auth: BTreeMap<String, String> = BTreeMap::new();
    for (implicit, global) in [
        ("ServerlessRestApi", "/Globals/Api"),
        ("ServerlessHttpApi", "/Globals/HttpApi"),
    ] {
        if let Some(a) = v
            .pointer(&format!("{global}/Auth/DefaultAuthorizer"))
            .and_then(Value::as_str)
        {
            api_auth.insert(implicit.to_string(), a.to_string());
        }
    }
    for (name, r) in resources {
        let ty = r.get("Type").and_then(Value::as_str).unwrap_or("");
        if matches!(ty, "AWS::Serverless::Api" | "AWS::Serverless::HttpApi") {
            let p = r.get("Properties");
            if p.is_some_and(|p| {
                p.get("DefinitionBody").is_some() || p.get("DefinitionUri").is_some()
            }) {
                full = false;
            }
            if let Some(a) = p
                .and_then(|p| p.pointer("/Auth/DefaultAuthorizer"))
                .and_then(Value::as_str)
            {
                api_auth.insert(name.clone(), a.to_string());
            }
        } else if !QUIET_RESOURCES.contains(&ty) {
            full = false;
        }
    }
    let mut units = Vec::new();
    for (name, r) in resources {
        if r.get("Type").and_then(Value::as_str) != Some("AWS::Serverless::Function") {
            continue;
        }
        if r.get("Condition").is_some() {
            full = false;
        }
        let props = r.get("Properties");
        let prop = |k: &str| {
            props
                .and_then(|p| p.get(k))
                .or_else(|| globals.and_then(|g| g.get(k)))
        };
        let line = line_of(text, |l| {
            l == format!("{name}:") || l.starts_with(&format!("\"{name}\""))
        });
        let who = format!("{file}:{line}: function `{name}`");
        let mut ev = Events::default();
        for (_, e) in props
            .and_then(|p| p.get("Events"))
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let ty = e.get("Type").and_then(Value::as_str).unwrap_or("");
            let p = e.get("Properties");
            let s = |k: &str| p.and_then(|p| p.get(k)).and_then(Value::as_str);
            match ty {
                "Api" | "HttpApi" => {
                    let api = p
                        .and_then(|p| p.get(if ty == "Api" { "RestApiId" } else { "ApiId" }))
                        .and_then(referred)
                        .unwrap_or_else(|| {
                            if ty == "Api" {
                                "ServerlessRestApi"
                            } else {
                                "ServerlessHttpApi"
                            }
                            .to_string()
                        });
                    let authorizer = p
                        .and_then(|p| p.pointer("/Auth/Authorizer"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or_else(|| api_auth.get(&api).cloned());
                    let what = if ty == "Api" {
                        "an Api event"
                    } else {
                        "an HttpApi event"
                    };
                    ev.http(what, s("Path"), s("Method"), authorizer);
                }
                t if NOT_HTTP.contains(&t) => {
                    ev.quiet.insert(t.to_string());
                }
                t => {
                    ev.unknown.insert(t.to_string());
                }
            }
        }
        if let Some(url) = prop("FunctionUrlConfig") {
            ev.every
                .get_or_insert_with(|| "its function URL".to_string());
            if url.get("AuthType").and_then(Value::as_str) == Some("AWS_IAM") {
                ev.authorizers.insert("AWS_IAM (function URL)".to_string());
            }
        }
        let (exposure, says) = ev.verdict(&who);
        let tied = match prop("CodeUri") {
            Some(Value::String(c)) => match join_dir(dir, c) {
                Some(d) => Tie::Dir(d),
                None => Tie::Not("its CodeUri is outside the repository".to_string()),
            },
            Some(_) => Tie::Not("its CodeUri is not a directory of the repository".to_string()),
            None if prop("ImageUri").is_some()
                || prop("PackageType").and_then(Value::as_str) == Some("Image") =>
            {
                Tie::Not("it runs an image".to_string())
            }
            None => Tie::Not("it has no CodeUri".to_string()),
        };
        if matches!(tied, Tie::Not(_)) {
            full = false;
        }
        units.push(found(name, exposure, says, tied));
    }
    Ok(Read {
        kind: "SAM",
        units,
        full,
    })
}

/// A Serverless Framework service (`serverless.yml`): its functions run the code of
/// the service's directory, which the framework packages, served from the internet on
/// the paths their `http`, `httpApi` and `websocket` events route to them (and by a
/// function `url`), and on none where they have no such event. An `alb` event is a
/// load balancer listener that may or may not face the internet. Functions given as a
/// variable, and `resources` that may route requests, keep the file listed as not
/// read.
fn serverless(file: &str, dir: &str, text: &str) -> Got {
    let v: Value = serde_saphyr::from_str(text).map_err(|e| e.to_string())?;
    let mut full = true;
    for (_, r) in v
        .pointer("/resources/Resources")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if !QUIET_RESOURCES.contains(&r.get("Type").and_then(Value::as_str).unwrap_or("")) {
            full = false;
        }
    }
    let Some(functions) = v.get("functions").and_then(Value::as_object) else {
        return Err("its `functions` are not a mapping Drift reads".to_string());
    };
    let mut units = Vec::new();
    for (name, f) in functions {
        let line = line_of(text, |l| l == format!("{name}:"));
        let who = format!("{file}:{line}: function `{name}`");
        let mut ev = Events::default();
        for e in f
            .get("events")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some((ty, body)) = e.as_object().and_then(|o| o.iter().next()) else {
                continue;
            };
            match ty.as_str() {
                "http" | "httpApi" => {
                    let what = format!("an {ty} event");
                    let (method, path, authorizer) = match body {
                        Value::String(s) if s.trim() == "*" => (None, None, None),
                        Value::String(s) => match s.split_once(' ') {
                            Some((m, p)) => {
                                (Some(m.trim().to_string()), Some(p.trim().to_string()), None)
                            }
                            None => (None, Some(s.clone()), None),
                        },
                        Value::Object(o) => {
                            let s = |k: &str| o.get(k).and_then(Value::as_str).map(str::to_string);
                            let authorizer = match o.get("authorizer") {
                                Some(Value::String(a)) => Some(a.clone()),
                                Some(Value::Object(a)) => Some(
                                    a.get("name")
                                        .or_else(|| a.get("type"))
                                        .and_then(Value::as_str)
                                        .unwrap_or("an authorizer")
                                        .to_string(),
                                ),
                                _ => None,
                            }
                            .or_else(|| {
                                (o.get("private").and_then(Value::as_bool) == Some(true))
                                    .then(|| "an API key (private: true)".to_string())
                            });
                            (
                                s("method"),
                                s("path").or_else(|| (ty == "http").then(String::new)),
                                authorizer,
                            )
                        }
                        _ => (None, None, None),
                    };
                    let path = path.map(|p| {
                        if p.starts_with('/') || p.is_empty() {
                            p
                        } else {
                            format!("/{p}")
                        }
                    });
                    let path = path.as_deref().map(|p| if p.is_empty() { "/" } else { p });
                    let method = method.filter(|m| m != "*");
                    ev.http(&what, path, method.as_deref(), authorizer);
                }
                "websocket" => {
                    ev.every
                        .get_or_insert_with(|| "a websocket event".to_string());
                }
                t if NOT_HTTP.contains(&t) => {
                    ev.quiet.insert(t.to_string());
                }
                t => {
                    ev.unknown.insert(t.to_string());
                }
            }
        }
        match f.get("url") {
            None | Some(Value::Bool(false)) | Some(Value::Null) => {}
            Some(url) => {
                ev.every
                    .get_or_insert_with(|| "its function URL".to_string());
                if url.get("authorizer").and_then(Value::as_str) == Some("aws_iam") {
                    ev.authorizers.insert("aws_iam (function URL)".to_string());
                }
            }
        }
        let (exposure, says) = ev.verdict(&who);
        units.push(found(name, exposure, says, Tie::Dir(dir.to_string())));
    }
    Ok(Read {
        kind: "Serverless",
        units,
        full,
    })
}

/// A Cloudflare Worker (`wrangler.toml`, `wrangler.json`, `wrangler.jsonc`): served on
/// the zone routes and custom domains its `routes` or `route` name (at the top or in
/// an `[env.*]`), and on its `workers.dev` URL where `workers_dev = true`. Without
/// either, whether it is served on `workers.dev` is the platform's default, which
/// Drift does not read: unknown. Its code is its directory, with its `main` entry. A
/// worker may pass what it is asked on to any origin, so the file is never one read
/// to the end.
fn wrangler(file: &str, dir: &str, text: &str, cx: &Cx) -> Got {
    let v: Value = if file.ends_with(".toml") {
        let t: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
        serde_json::to_value(t).map_err(|e| e.to_string())?
    } else {
        serde_json::from_str(&plain_json(text)).map_err(|e| e.to_string())?
    };
    let mut scopes: Vec<&Value> = vec![&v];
    scopes.extend(
        v.get("env")
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|e| e.values()),
    );
    let mut routes: BTreeSet<String> = BTreeSet::new();
    let mut dev = None;
    for s in &scopes {
        let pattern = |r: &Value| match r {
            Value::String(p) => Some(p.clone()),
            Value::Object(o) => o.get("pattern").and_then(Value::as_str).map(str::to_string),
            _ => None,
        };
        routes.extend(
            s.get("routes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(pattern),
        );
        routes.extend(s.get("route").and_then(pattern));
        if let Some(b) = s.get("workers_dev").and_then(Value::as_bool) {
            dev = Some(dev.unwrap_or(false) || b);
        }
    }
    let hints: Vec<String> = v
        .get("main")
        .and_then(Value::as_str)
        .map(str::to_string)
        .into_iter()
        .collect();
    let (exposure, says) = if !routes.is_empty() {
        let line = line_of(text, |l| l.starts_with("route") || l.starts_with("\"route"));
        (
            Exposure::Public,
            format!(
                "{file}:{line}: the worker is served from the internet on {}",
                routes
                    .into_iter()
                    .map(|r| crate::report::sanitize(&r, 80))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        )
    } else if dev == Some(true) {
        let line = line_of(text, |l| l.contains("workers_dev"));
        (
            Exposure::Public,
            format!(
                "{file}:{line}: the worker is served from the internet on its workers.dev URL (workers_dev = true)"
            ),
        )
    } else {
        (
            Exposure::Unknown,
            format!(
                "{file}:1: the worker names no route{}: whether it is served on a workers.dev URL or a custom domain set outside the file is not read",
                if dev == Some(false) {
                    " and sets workers_dev = false"
                } else {
                    " and does not set workers_dev"
                }
            ),
        )
    };
    // A worker on a route sits in front of the zone's origin and may send what it is
    // asked on to any service: the file stays listed as not read, as before.
    Ok(Read {
        kind: "Cloudflare Workers",
        units: vec![found("", exposure, says, cx.tie(dir, &hints))],
        full: false,
    })
}

impl Boundaries {
    /// Reads the platforms' files among `unread` ([`read`]), those `not_deployed`
    /// leaves out apart, and takes the ones read to the end out of it: the hunk of
    /// [`Boundaries::load_with`].
    pub(super) fn read_platforms(
        &mut self,
        root: &Path,
        unread: &mut Vec<(String, String)>,
        not_deployed: &[String],
        ties: &[PlatformTie],
    ) {
        let given: Vec<(String, String)> = unread
            .iter()
            .filter(|(_, p)| {
                !not_deployed
                    .iter()
                    .any(|n| n.is_empty() || p == n || p.starts_with(&format!("{n}/")))
            })
            .cloned()
            .collect();
        if given.is_empty() {
            return;
        }
        let reading = read(root, &given, ties);
        let before = self.rules.clone();
        for u in &reading.units {
            if let Some(code) = &u.code {
                self.apply_platform(code, u, &before);
            }
        }
        self.warnings.extend(reading.warnings);
        unread.retain(|(_, p)| !reading.read.contains(p));
        self.read.extend(reading.read);
        self.platforms = reading.units;
    }

    /// Sets what `u` says of `code`. Internet-facing is the file's word, as a compose
    /// service that publishes ports is, and no gateway decides its routes one by one;
    /// internal or unknown only where no rule in `before` (a person's, a compose
    /// file's) speaks for the code.
    fn apply_platform(&mut self, code: &str, u: &Unit, before: &[BoundaryRule]) {
        if u.exposure == Exposure::Public {
            self.set(code, Exposure::Public, u.says.clone(), false);
            self.whole.insert(normal_dir(code));
        } else if !before.iter().any(|r| under(code, &r.dir)) {
            self.set(code, u.exposure, u.says.clone(), false);
        }
    }

    /// Ties, by the entry points of `repo`, the platform units whose file deploys a
    /// directory without saying which of its applications it is: the directory itself,
    /// where it has entry points of its own (or no application has any). Where only
    /// packages below it have them, the unit stays untied and is said so, with the
    /// applications `drift setup` asks about: the file deploys the directory, and does
    /// not say it builds one of them. And for every tied unit, an application below its code that is a package
    /// of its own is not said to be served by it: unknown, where nothing else speaks
    /// for it. Called before any entry point is given its exposure.
    pub(super) fn tie_platforms(&mut self, repo: &RepoFacts) {
        if self.platforms.is_empty() {
            return;
        }
        let apps: BTreeSet<&str> = repo
            .files
            .iter()
            .filter(|f| !f.entry_points.is_empty() && !is_test_path(&f.path))
            .map(|f| f.package.as_str())
            .collect();
        let ours: BTreeSet<String> = self.platforms.iter().map(|u| u.says.clone()).collect();
        let before: Vec<BoundaryRule> = self
            .rules
            .iter()
            .filter(|r| !ours.contains(&r.source))
            .cloned()
            .collect();
        let mut units = std::mem::take(&mut self.platforms);
        for u in &mut units {
            if u.code.is_none()
                && let Some(base) = u.base.clone()
            {
                // Its own: files of the directory that no package below it holds.
                let own = repo.files.iter().any(|f| {
                    !f.entry_points.is_empty()
                        && !is_test_path(&f.path)
                        && under(&f.path, &base)
                        && !strictly_under(&f.package, &base)
                });
                let nested: Vec<&str> = apps
                    .iter()
                    .copied()
                    .filter(|p| strictly_under(p, &base))
                    .collect();
                match (own, nested.as_slice()) {
                    (true, _) | (false, []) => u.code = Some(base.clone()),
                    (false, below) => {
                        let why = format!(
                            "{} has no entry points of its own, only the packages below it ({}), and the file does not say it deploys one of them",
                            shown(&base),
                            below.join(", ")
                        );
                        self.warnings.push(format!(
                            "{}: {why}, so what it serves is unknown; `drift setup` asks which, and security.platforms in {} ties it ({{file: {}, code: <dir>}})",
                            u.target(),
                            crate::policy::CONFIG_FILE,
                            u.target()
                        ));
                        u.untied = Some(why);
                        u.candidates = below.iter().map(|s| s.to_string()).collect();
                    }
                }
                if let Some(code) = u.code.clone() {
                    self.apply_platform(&code, u, &before);
                    if u.exposure == Exposure::Internal
                        && let Some(note) = self.unread_note(&code)
                        && let Some(r) = self
                            .rules
                            .iter_mut()
                            .find(|r| r.dir == normal_dir(&code) && r.source == u.says)
                    {
                        r.exposure = Exposure::Unknown;
                        r.source = format!("{}; {note}", r.source);
                    }
                }
            }
            // A cloud service a person did not tie: the applications it may run.
            if u.code.is_none()
                && u.base.is_none()
                && u.candidates.is_empty()
                && u.kind == "Cloud Run"
            {
                u.candidates = apps.iter().map(|s| s.to_string()).collect();
            }
            let Some(code) = u.code.clone() else {
                continue;
            };
            for pkg in apps.iter().filter(|p| strictly_under(p, &code)) {
                if !before.iter().any(|r| under(pkg, &r.dir))
                    && !self.rules.iter().any(|r| r.dir == *pkg)
                {
                    self.set(
                        pkg,
                        Exposure::Unknown,
                        format!(
                            "{} deploys {}; {} is an application of its own, which it does not say it serves",
                            u.target(),
                            shown(&code),
                            shown(pkg)
                        ),
                        false,
                    );
                }
            }
        }
        // A file whose every unit is tied now, read to the end: what was said of it
        // as a description not read is taken back.
        let files: BTreeSet<&str> = units.iter().map(|u| u.file.as_str()).collect();
        for file in files {
            if units
                .iter()
                .filter(|u| u.file == file)
                .all(|u| u.full && u.code.is_some())
                && !self.read.iter().any(|r| r == file)
            {
                self.settle(file);
            }
        }
        self.rules.sort();
        self.platforms = units;
    }

    /// `file` is read to the end: it leaves [`Boundaries::unread`], its warning and the
    /// unread items of a basis, and a rule it alone kept from being internal is
    /// internal again.
    fn settle(&mut self, file: &str) {
        let Some(i) = self
            .unread
            .iter()
            .position(|u| u.all.iter().any(|f| f == file))
        else {
            return;
        };
        let kind = self.unread[i].kind.clone();
        let was = format!(
            "{kind} in the repository is not read ({})",
            self.unread[i].shown()
        );
        let u = &mut self.unread[i];
        u.all.retain(|f| f != file);
        u.count = u.all.len();
        u.files = u.all.iter().take(5).cloned().collect();
        let now =
            (u.count > 0).then(|| format!("{kind} in the repository is not read ({})", u.shown()));
        if now.is_none() {
            self.unread.remove(i);
        }
        self.warnings = std::mem::take(&mut self.warnings)
            .into_iter()
            .filter_map(|w| match (w.strip_prefix(&was), &now) {
                (Some(_), None) => None,
                (Some(rest), Some(now)) => Some(format!("{now}{rest}")),
                (None, _) => Some(w),
            })
            .collect();
        self.not_read.retain(|n| n.what != file);
        self.read.push(file.to_string());
        let note =
            format!("; but {kind} ({file}) in the repository is not read and may route to it");
        for r in &mut self.rules {
            if r.exposure == Exposure::Unknown
                && let Some(source) = r.source.strip_suffix(&note)
            {
                r.source = source.to_string();
                r.exposure = Exposure::Internal;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (p, t) in files {
            let path = dir.path().join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, t).unwrap();
        }
        dir
    }

    /// The units Drift reads at `root`, as `deployments` lists the files.
    fn units(root: &Path) -> Reading {
        let found = super::super::deployments(root);
        read(root, &found.unread, &[])
    }

    fn one(r: &Reading) -> &Unit {
        assert_eq!(r.units.len(), 1, "{:?}", r.units);
        &r.units[0]
    }

    /// A Vercel project is internet-facing, tied to the directory of its file, and
    /// the file is read to the end.
    #[test]
    fn vercel_project_is_public() {
        let d = repo(&[
            (
                "apps/web/vercel.json",
                r#"{"crons": [{"path": "/api/cron", "schedule": "* * * * *"}]}"#,
            ),
            ("apps/web/package.json", r#"{"name": "web"}"#),
        ]);
        let r = units(d.path());
        let u = one(&r);
        assert_eq!(u.exposure, Exposure::Public);
        assert_eq!(u.code.as_deref(), Some("apps/web"));
        assert!(
            u.says.starts_with("apps/web/vercel.json:1: Vercel serves"),
            "{}",
            u.says
        );
        assert_eq!(r.read, vec!["apps/web/vercel.json"]);
    }

    /// A rewrite to another host: still internet-facing, but the file stays unread.
    #[test]
    fn vercel_rewrite_elsewhere_is_not_read_to_the_end() {
        let d = repo(&[(
            "vercel.json",
            r#"{"rewrites": [{"source": "/api/(.*)", "destination": "https://api.example.com/$1"}]}"#,
        )]);
        let r = units(d.path());
        assert_eq!(one(&r).exposure, Exposure::Public);
        assert!(r.read.is_empty());
    }

    /// A monorepo root with one Vercel file that selects no package is tied later, by
    /// the entry points; one whose build command selects a package is tied to it.
    #[test]
    fn vercel_monorepo_ties_by_what_the_command_selects() {
        let files = [
            (
                "package.json",
                r#"{"name": "root", "workspaces": ["apps/*"]}"#,
            ),
            ("apps/web/package.json", r#"{"name": "@acme/web"}"#),
            ("apps/docs/package.json", r#"{"name": "@acme/docs"}"#),
        ];
        let mut with = files.to_vec();
        with.push((
            "vercel.json",
            r#"{"buildCommand": "turbo run build --filter=@acme/web"}"#,
        ));
        let d = repo(&with);
        assert_eq!(one(&units(d.path())).code.as_deref(), Some("apps/web"));
        let mut without = files.to_vec();
        without.push(("vercel.json", "{}"));
        let d = repo(&without);
        let r = units(d.path());
        assert_eq!(one(&r).code, None);
        assert_eq!(one(&r).base.as_deref(), Some(""));
        assert!(r.read.is_empty(), "an untied file is not read to the end");
    }

    /// Netlify: the site of `[build] base`, and its functions directory.
    #[test]
    fn netlify_site_and_functions() {
        let d = repo(&[
            (
                "netlify.toml",
                "[build]\n  base = \"site\"\n  command = \"npm run build\"\n\n[functions]\n  directory = \"netlify/functions\"\n",
            ),
            ("site/package.json", "{}"),
        ]);
        let r = units(d.path());
        let codes: Vec<(Option<&str>, Exposure)> = r
            .units
            .iter()
            .map(|u| (u.code.as_deref(), u.exposure))
            .collect();
        assert!(
            codes.contains(&(Some("site"), Exposure::Public)),
            "{codes:?}"
        );
        assert!(
            codes.contains(&(Some("site/netlify/functions"), Exposure::Public)),
            "{codes:?}"
        );
        assert_eq!(r.read, vec!["netlify.toml"]);
    }

    /// Fly.io: `[http_service]` or a service port is internet-facing; neither is the
    /// private network only.
    #[test]
    fn fly_services() {
        let d = repo(&[(
            "fly.toml",
            "app = \"x\"\n\n[http_service]\n  internal_port = 8080\n",
        )]);
        let u = one(&units(d.path())).clone();
        assert_eq!(u.exposure, Exposure::Public);
        assert!(u.says.starts_with("fly.toml:3:"), "{}", u.says);
        let d = repo(&[(
            "fly.toml",
            "app = \"x\"\n\n[[services]]\n  internal_port = 8080\n  [[services.ports]]\n    port = 443\n",
        )]);
        assert_eq!(one(&units(d.path())).exposure, Exposure::Public);
        let d = repo(&[(
            "fly.toml",
            "app = \"worker\"\n\n[processes]\n  worker = \"node worker.js\"\n",
        )]);
        let u = one(&units(d.path())).clone();
        assert_eq!(u.exposure, Exposure::Internal);
        assert!(u.says.contains("private network only"), "{}", u.says);
        let d = repo(&[(
            "fly.toml",
            "app = \"x\"\n[build]\n  image = \"nginx:1\"\n[http_service]\n  internal_port = 80\n",
        )]);
        let r = units(d.path());
        assert_eq!(one(&r).code, None);
        assert!(r.read.is_empty());
    }

    /// Render: web is public, a private service and a worker are not; each tied by
    /// its rootDir.
    #[test]
    fn render_services() {
        let d = repo(&[(
            "render.yaml",
            "services:\n  - type: web\n    name: api\n    rootDir: api\n  - type: pserv\n    name: inner\n    rootDir: inner\n  - type: worker\n    name: jobs\n    rootDir: jobs\n",
        )]);
        let r = units(d.path());
        let got: Vec<(&str, Option<&str>, Exposure)> = r
            .units
            .iter()
            .map(|u| (u.name.as_str(), u.code.as_deref(), u.exposure))
            .collect();
        assert!(
            got.contains(&("api", Some("api"), Exposure::Public)),
            "{got:?}"
        );
        assert!(
            got.contains(&("inner", Some("inner"), Exposure::Internal)),
            "{got:?}"
        );
        assert!(
            got.contains(&("jobs", Some("jobs"), Exposure::Internal)),
            "{got:?}"
        );
        assert!(
            r.units
                .iter()
                .find(|u| u.name == "api")
                .unwrap()
                .says
                .starts_with("render.yaml:3:")
        );
        assert_eq!(r.read, vec!["render.yaml"]);
    }

    /// Heroku: a web process with app.json is public, tied by the package its command
    /// selects; a Procfile without app.json is not read here.
    #[test]
    fn procfile_web_process() {
        let d = repo(&[
            (
                "Procfile",
                "web: npx turbo run @acme/web#start\nworker: node jobs.js\n",
            ),
            ("app.json", "{}"),
            ("package.json", r#"{"name": "root"}"#),
            ("apps/web/package.json", r#"{"name": "@acme/web"}"#),
            ("apps/api/package.json", r#"{"name": "@acme/api"}"#),
        ]);
        let u = one(&units(d.path())).clone();
        assert_eq!(
            (u.exposure, u.code.as_deref()),
            (Exposure::Public, Some("apps/web"))
        );
        assert!(u.says.starts_with("Procfile:1:"), "{}", u.says);
        let d = repo(&[("Procfile", "web: gunicorn app.wsgi\n")]);
        assert!(units(d.path()).units.is_empty());
        let d = repo(&[("Procfile", "worker: python run.py\n"), ("app.json", "{}")]);
        assert_eq!(one(&units(d.path())).exposure, Exposure::Internal);
    }

    /// A Python module named by the web command ties to the package that holds it.
    #[test]
    fn procfile_module_ties_to_its_package() {
        let d = repo(&[
            ("Procfile", "web: gunicorn site.wsgi --log-file -\n"),
            ("app.json", "{}"),
            ("requirements.txt", "django\n"),
            ("site/wsgi.py", "app = 1\n"),
            ("labs/one/requirements.txt", "flask\n"),
        ]);
        assert_eq!(one(&units(d.path())).code.as_deref(), Some(""));
    }

    /// App Engine: the service is public, tied to the file's directory.
    #[test]
    fn app_engine_service() {
        let d = repo(&[("svc/app.yaml", "runtime: python312\nservice: api\n")]);
        let u = one(&units(d.path())).clone();
        assert_eq!(
            (u.exposure, u.code.as_deref()),
            (Exposure::Public, Some("svc"))
        );
        assert!(u.says.contains("service `api`"), "{}", u.says);
    }

    /// Cloud Run: ingress decides; the code is never tied by the file.
    #[test]
    fn cloud_run_ingress() {
        let svc = |ingress: &str| {
            format!(
                "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\n  annotations:\n{ingress}spec:\n  template:\n    spec:\n      containers:\n        - image: gcr.io/p/api\n"
            )
        };
        let d = repo(&[(
            "service.yaml",
            &svc("    run.googleapis.com/ingress: internal\n"),
        )]);
        let r = units(d.path());
        assert_eq!(one(&r).exposure, Exposure::Internal);
        assert_eq!(one(&r).code, None);
        assert!(r.read.is_empty());
        let d = repo(&[("service.yaml", &svc("    a: b\n"))]);
        assert_eq!(one(&units(d.path())).exposure, Exposure::Public);
    }

    /// SAM: a catch-all Api event is public, a queue-only function internal, a
    /// specific path unknown, and an authorizer is said with the verdict.
    #[test]
    fn sam_functions() {
        let t = "AWSTemplateFormatVersion: '2010-09-09'\nTransform: AWS::Serverless-2016-10-31\nResources:\n  Web:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: web/\n      Handler: app.handler\n      Events:\n        Proxy:\n          Type: Api\n          Properties:\n            Path: /{proxy+}\n            Method: ANY\n            Auth:\n              Authorizer: Cognito\n  Jobs:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: jobs/\n      Handler: app.handler\n      Events:\n        Q:\n          Type: SQS\n          Properties:\n            Queue: !GetAtt Queue.Arn\n  One:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: one/\n      Handler: app.handler\n      Events:\n        Get:\n          Type: HttpApi\n          Properties:\n            Path: /users\n            Method: get\n  Queue:\n    Type: AWS::SQS::Queue\n";
        let d = repo(&[("template.yaml", t), ("samconfig.toml", "version = 0.1\n")]);
        let r = units(d.path());
        let by = |n: &str| r.units.iter().find(|u| u.name == n).unwrap();
        assert_eq!(
            (by("Web").exposure, by("Web").code.as_deref()),
            (Exposure::Public, Some("web"))
        );
        assert!(
            by("Web").says.contains("authorizer Cognito"),
            "{}",
            by("Web").says
        );
        assert!(
            by("Web").says.starts_with("template.yaml:4:"),
            "{}",
            by("Web").says
        );
        assert_eq!(by("Jobs").exposure, Exposure::Internal);
        assert_eq!(by("One").exposure, Exposure::Unknown);
        assert!(by("One").says.contains("GET /users"), "{}", by("One").says);
        assert_eq!(r.read, vec!["samconfig.toml", "template.yaml"]);
    }

    /// Serverless: http events and a function with only a schedule.
    #[test]
    fn serverless_functions() {
        let d = repo(&[(
            "serverless.yml",
            "service: x\nprovider:\n  name: aws\nfunctions:\n  api:\n    handler: handler.app\n    events:\n      - httpApi: '*'\n  cron:\n    handler: handler.cron\n    events:\n      - schedule: rate(1 hour)\n",
        )]);
        let r = units(d.path());
        let by = |n: &str| r.units.iter().find(|u| u.name == n).unwrap();
        assert_eq!(
            (by("api").exposure, by("api").code.as_deref()),
            (Exposure::Public, Some(""))
        );
        assert_eq!(by("cron").exposure, Exposure::Internal);
        assert_eq!(r.read, vec!["serverless.yml"]);
    }

    /// Cloudflare Workers: a route is public; no route and no workers_dev is unknown.
    #[test]
    fn wrangler_routes() {
        let d = repo(&[(
            "wrangler.toml",
            "name = \"w\"\nmain = \"src/index.ts\"\nroutes = [{ pattern = \"api.example.com/*\", zone_name = \"example.com\" }]\n",
        )]);
        assert_eq!(one(&units(d.path())).exposure, Exposure::Public);
        let d = repo(&[(
            "wrangler.jsonc",
            "{\n  // the worker\n  \"name\": \"w\",\n  \"main\": \"src/index.ts\",\n  \"workers_dev\": true,\n}\n",
        )]);
        assert_eq!(one(&units(d.path())).exposure, Exposure::Public);
        let d = repo(&[("wrangler.toml", "name = \"w\"\nmain = \"src/index.ts\"\n")]);
        assert_eq!(one(&units(d.path())).exposure, Exposure::Unknown);
    }

    /// Comments and trailing commas come off; strings keep what looks like them.
    #[test]
    fn plain_json_keeps_strings() {
        let v: Value =
            serde_json::from_str(&plain_json("{\"a\": \"x // y\", /* c */ \"b\": [1,],}")).unwrap();
        assert_eq!(v["a"], "x // y");
        assert_eq!(v["b"][0], 1);
    }
}
