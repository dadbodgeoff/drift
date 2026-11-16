//! Entry points a deployment file names: serverless functions and Workers.
//!
//! No name makes a function a Lambda handler or a Worker: the deployment file says
//! which export of which file the platform invokes, and for what. So these entry
//! points come from configuration, the way a `package.json` `bin` makes a CLI entry
//! point, and each one is a function anyone who can reach its trigger can call.
//!
//! Read here, each with the file and line it is written at:
//! - the Serverless Framework (`serverless.yml|yaml|json`): `functions.<name>.handler`
//!   (`path/to/file.export`, from the service's directory) and its `events`;
//! - AWS SAM (`template.yaml|yml|json`): `AWS::Serverless::Function` with `CodeUri`,
//!   `Handler`, `Events` and `Globals`;
//! - Cloudflare Workers (`wrangler.toml|json|jsonc`): the handlers of the default
//!   export of `main`, and the Durable Object classes the Worker declares;
//! - Netlify Functions (`netlify/functions`, or the directory `netlify.toml` names);
//! - Vercel functions in `api/` beside a `vercel.json`, outside Next.js.
//!
//! The language does not matter: a Python runtime's `module.function` names a
//! Python file, and the facts of either parser are given the entry point.
//!
//! Mining is frozen at the measured build's entry points, so these are added to the
//! listed reading only ([`drift_core::Listed`]): `drift security` and the practice
//! map read them, mining does not. Whatever the configuration does not settle (a
//! handler that names no file of the repository or no export of it, a value written
//! with a variable or an intrinsic function, an event Drift does not know) is not
//! guessed: it is reported as a place that looks served and is not listed
//! ([`unlisted`]). A guard the platform applies (an API Gateway authorizer, an API
//! key, IAM authorization) is named on the entry point as what Drift did not read
//! ([`drift_core::APP_UNREAD`]): its verdict is unknown, never "no guard".

use std::collections::BTreeSet;
use std::path::Path;

use drift_core::{EntryPoint, FileFacts, Listed, MountFacts, RepoFacts};
use serde_json::Value;

use crate::security::Unlisted;

/// Adapters of the entry points this module lists, as [`EntryPoint::adapter`] names
/// them.
pub const SERVERLESS: &str = "serverless";
pub const SAM: &str = "aws-sam";
pub const WORKERS: &str = "cloudflare-workers";
pub const NETLIFY: &str = "netlify";
pub const VERCEL: &str = "vercel";
const ADAPTERS: &[&str] = &[SERVERLESS, SAM, WORKERS, NETLIFY, VERCEL];

/// `schedule(cron, handler)` of `@netlify/functions`: a scheduled function.
const NETLIFY_SCHEDULE: &str = "pkg:@netlify/functions#schedule";

/// Source extensions a JavaScript runtime's handler file may have (TypeScript is
/// built by the framework's bundler or plugin from the file of the same name).
const NODE_EXTENSIONS: &[&str] = &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

/// Build output directories a handler may be named under, built from `src/`.
const BUILD_DIRS: &[&str] = &["dist", "build", "out", "lib", "esm", "cjs"];

/// The HTTP methods a file-routed function may export.
const HTTP_METHODS: &[&str] = &["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/// Events of the Serverless Framework that hand a function what a queue, a stream,
/// a bucket, a bus or another service delivers: `consumer` entry points.
const SLS_CONSUMER_EVENTS: &[&str] = &[
    "sqs",
    "sns",
    "stream",
    "s3",
    "eventBridge",
    "cloudwatchEvent",
    "cloudwatchLog",
    "kafka",
    "msk",
    "activemq",
    "rabbitmq",
    "iot",
    "cognitoUserPool",
];

/// SAM event types that are `consumer` entry points (as above).
const SAM_CONSUMER_EVENTS: &[&str] = &[
    "SQS",
    "SNS",
    "Kinesis",
    "DynamoDB",
    "S3",
    "EventBridgeRule",
    "CloudWatchEvent",
    "CloudWatchLogs",
    "MSK",
    "MQ",
    "SelfManagedKafka",
    "IoTRule",
    "Cognito",
    "DocumentDB",
];

/// CloudFormation's short-form intrinsic functions, as YAML tags.
const CFN_TAGS: &[&str] = &[
    "!Ref",
    "!Sub",
    "!GetAtt",
    "!Join",
    "!Select",
    "!Split",
    "!FindInMap",
    "!ImportValue",
    "!If",
    "!Equals",
    "!Not",
    "!And",
    "!Or",
    "!Condition",
    "!Base64",
    "!Cidr",
    "!GetAZs",
    "!Transform",
];

/// A deployment file this module reads, by repo-relative path. Not one under a
/// hidden directory: `.aws-sam/build/template.yaml` and `.serverless/` are what a
/// build wrote from the file beside them.
pub fn is_config_path(rel: &str) -> bool {
    let mut parts = rel.split('/');
    let name = parts.next_back().unwrap_or(rel);
    if parts.any(|d| d.starts_with('.')) {
        return false;
    }
    matches!(
        name,
        "serverless.yml"
            | "serverless.yaml"
            | "serverless.json"
            | "template.yaml"
            | "template.yml"
            | "template.json"
            | "wrangler.toml"
            | "wrangler.json"
            | "wrangler.jsonc"
            | "netlify.toml"
            | "vercel.json"
    )
}

/// The texts of the deployment files among a walk's config files, by path.
pub fn read_configs(config: &[drift_core::ingest::Candidate]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = config
        .iter()
        .filter(|c| is_config_path(&c.rel_path))
        .filter_map(|c| {
            Some((
                c.rel_path.clone(),
                std::fs::read_to_string(&c.abs_path).ok()?,
            ))
        })
        .collect();
    out.sort();
    out
}

/// The deployment files of the repository at `root`, found by the walk a scan makes.
pub fn configs_of(root: &Path) -> Vec<(String, String)> {
    match drift_core::ingest::walk(root, 0, &is_config_path) {
        Ok(w) => read_configs(&w.config),
        Err(_) => Vec::new(),
    }
}

/// Adds to the inventory's places that look served and are not listed
/// ([`crate::security::Inventory::unlisted`]) what the deployment files of the
/// repository at `root` name that Drift could not list: each handler, event or value
/// that is not settled, where it is written.
pub fn add_unlisted(inv: &mut crate::security::Inventory, root: &Path, repo: &RepoFacts) {
    let configs = configs_of(root);
    inv.unlisted.extend(
        plan(repo, &configs)
            .unresolved
            .into_iter()
            .map(|u| Unlisted {
                path: u.path,
                line: u.line,
                symbol: u.what,
                reason: drift_core::UnlistedReason::DeploymentNotRead,
            }),
    );
    inv.unlisted.sort();
    inv.unlisted.dedup();
}

/// Adds the entry points the deployment files name to the listed reading of the
/// files that hold their handlers. What it decided, for [`Listing::needs_repo`].
pub fn list(repo: &mut RepoFacts, configs: &[(String, String)]) -> Listing {
    let p = plan(repo, configs);
    for (path, entry, unread) in &p.add {
        if let Some(f) = repo.files.iter_mut().find(|f| f.path == *path) {
            add(f, entry.clone(), unread);
        }
    }
    Listing { decided: p.decided }
}

/// What [`list`] decided, and which files each decision looked for.
#[derive(Debug, Default)]
pub struct Listing {
    /// (the file given the entry point, the files looked for and not found).
    decided: Vec<(String, BTreeSet<String>)>,
}

impl Listing {
    /// Whether facts of other files than those scanned could have decided otherwise
    /// for `rel`: a file looked for in deciding its entry points that is not in the
    /// facts and is in the repository at `root`. A single-file scan then needs the
    /// whole repository to say what a full scan says.
    pub fn needs_repo(&self, root: &Path, rel: &str) -> bool {
        self.decided
            .iter()
            .filter(|(path, _)| path == rel)
            .any(|(_, missing)| missing.iter().any(|m| root.join(m).is_file()))
    }
}

/// A place a deployment file names that is not listed, and what it says.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Unresolved {
    path: String,
    line: u32,
    what: String,
}

#[derive(Debug, Default)]
struct Plan {
    /// (file, entry point, the platform guards not read).
    add: Vec<(String, EntryPoint, Vec<String>)>,
    unresolved: Vec<Unresolved>,
    decided: Vec<(String, BTreeSet<String>)>,
}

/// One entry point a deployment file asks for.
#[derive(Debug, Clone)]
struct Want {
    config: String,
    line: u32,
    target: Target,
    kind: &'static str,
    method: Option<String>,
    route: String,
    adapter: &'static str,
    /// What the platform runs before the handler that Drift does not read.
    unread: Vec<String>,
}

#[derive(Debug, Clone)]
enum Target {
    /// `stem.export` of a Lambda handler: the first file found of each stem with one
    /// of the runtime's extensions. `written` is the handler as written, on `line`.
    Export {
        stems: Vec<String>,
        python: Option<bool>,
        export: String,
        written: String,
        line: u32,
    },
    /// A handler of the default export of a Worker's `main`: `fetch`, `scheduled`,
    /// `queue`, `email`. One the configuration asks for (`required`: a route, a cron
    /// trigger, a queue consumer) and that is not read is reported.
    Worker {
        main: String,
        member: &'static str,
        required: bool,
    },
    /// An export of a file the configuration names exactly.
    File { path: String, export: String },
}

/// Read every deployment file and decide each entry point against the facts.
fn plan(repo: &RepoFacts, configs: &[(String, String)]) -> Plan {
    let mut wants = Vec::new();
    let mut out = Plan::default();
    for (rel, text) in configs {
        let name = rel.rsplit('/').next().unwrap_or(rel);
        if name.starts_with("serverless.") {
            serverless(rel, text, &mut wants, &mut out.unresolved);
        } else if name.starts_with("template.") {
            sam(rel, text, &mut wants, &mut out.unresolved);
        } else if name.starts_with("wrangler.") {
            wrangler(rel, text, &mut wants, &mut out.unresolved);
        }
    }
    netlify(repo, configs, &mut wants, &mut out.unresolved);
    vercel(repo, configs, &mut wants);
    for w in wants {
        resolve(repo, w, &mut out);
    }
    out.add.sort();
    out.add.dedup();
    out.unresolved.sort();
    out.unresolved.dedup();
    out
}

fn file_of<'r>(
    repo: &'r RepoFacts,
    path: &str,
    missing: &mut BTreeSet<String>,
) -> Option<&'r FileFacts> {
    let f = repo.files.iter().find(|f| f.path == path);
    if f.is_none() {
        missing.insert(path.to_string());
    }
    f
}

/// A symbol of the file by that name, in either reading.
fn has_symbol(f: &FileFacts, name: &str) -> bool {
    let named = |s: &drift_core::Symbol| s.name == name || s.exported_as.iter().any(|e| e == name);
    f.symbols.iter().any(named)
        || f.listed
            .as_ref()
            .is_some_and(|l| l.symbols.iter().any(named))
}

/// Whether the file exports `name` (declared there or re-exported).
fn exports(f: &FileFacts, name: &str) -> bool {
    f.exports.iter().any(|x| x.name == name)
        || f.symbols
            .iter()
            .any(|s| s.exported_as.iter().any(|e| e == name))
}

/// Whether `f` lists routes of a router (an adapter other than this module's): a
/// Worker or a function that hands its requests to that router serves those routes,
/// which are listed once, where the router is.
fn serves_routes(f: &FileFacts) -> bool {
    f.listed_entry_points()
        .iter()
        .any(|e| e.kind == "http" && !ADAPTERS.contains(&e.adapter.as_str()))
}

/// The default export of `f`, when it is a router of the repository whose routes are
/// listed (`export default app`, `export default { fetch: app.fetch }`): the file
/// that lists them. The files looked for and not found go in `missing`.
fn default_router<'r>(
    repo: &'r RepoFacts,
    f: &'r FileFacts,
    missing: &mut BTreeSet<String>,
) -> Option<&'r FileFacts> {
    let x = f.exports.iter().find(|x| x.name == "default")?;
    let (path, sym) = x.origin.split_once('#')?;
    if path == f.path && sym == "default" {
        // An object written in place: a `fetch` given a router's (`app.fetch`).
        let s = f.symbols.iter().find(|s| s.name == "default")?;
        return s.calls.iter().find_map(|c| {
            let c = c.strip_suffix("(ref)")?;
            let (file, member) = c.split_once('#')?;
            member.ends_with(".fetch").then_some(())?;
            file_of(repo, file, missing).filter(|o| serves_routes(o))
        });
    }
    let origin = file_of(repo, path, missing)?;
    let s = origin.symbols.iter().find(|s| s.name == sym)?;
    (s.kind != drift_core::SymbolKind::Function && serves_routes(origin)).then_some(origin)
}

fn resolve(repo: &RepoFacts, w: Want, out: &mut Plan) {
    let mut missing = BTreeSet::new();
    let unresolved = |what: String| Unresolved {
        path: w.config.clone(),
        line: w.line,
        what,
    };
    let (file, symbol) = match &w.target {
        Target::Export {
            stems,
            python,
            export,
            written,
            line,
        } => {
            let unresolved = |what: String| Unresolved {
                path: w.config.clone(),
                line: *line,
                what,
            };
            let exts: Vec<&str> = match python {
                Some(true) => vec!["py"],
                Some(false) => NODE_EXTENSIONS.to_vec(),
                None => NODE_EXTENSIONS.iter().copied().chain(["py"]).collect(),
            };
            let found = stems.iter().find_map(|stem| {
                exts.iter()
                    .find_map(|e| file_of(repo, &format!("{stem}.{e}"), &mut missing))
            });
            match found {
                Some(f) if exports(f, export) || has_symbol(f, export) => (f, export.clone()),
                Some(f) => {
                    out.decided.push((f.path.clone(), missing));
                    out.unresolved.push(unresolved(written.clone()));
                    return;
                }
                None => {
                    out.unresolved.push(unresolved(written.clone()));
                    return;
                }
            }
        }
        Target::File { path, export } => match file_of(repo, path, &mut missing) {
            Some(f) if exports(f, export) || has_symbol(f, export) => (f, export.clone()),
            _ => {
                out.unresolved.push(unresolved(format!("{path} {export}")));
                return;
            }
        },
        Target::Worker {
            main,
            member,
            required,
        } => {
            let Some(f) = file_of(repo, main, &mut missing) else {
                if *required {
                    out.unresolved.push(unresolved(main.clone()));
                }
                return;
            };
            let own = format!("default.{member}");
            if has_symbol(f, &own) {
                (f, own)
            } else {
                // A Worker whose `fetch` is a router's: its routes are listed where
                // the router is, once.
                let tied = *member == "fetch" && default_router(repo, f, &mut missing).is_some();
                out.decided.push((f.path.clone(), missing));
                if *required && !tied {
                    out.unresolved
                        .push(unresolved(format!("{main} default.{member}")));
                }
                return;
            }
        }
    };
    // A function exported as a router's handler (`export default app`): its routes
    // are listed where the router is.
    if w.kind == "http" && symbol == "default" && default_router(repo, file, &mut missing).is_some()
    {
        out.decided.push((file.path.clone(), missing));
        return;
    }
    // A Netlify function built with `schedule(...)` runs on a schedule.
    let kind = match (w.adapter, file.symbols.iter().find(|s| s.name == symbol)) {
        (NETLIFY, Some(s))
            if s.calls.iter().any(|c| c == NETLIFY_SCHEDULE)
                || s.wraps.iter().any(|w| w.wrapper == NETLIFY_SCHEDULE) =>
        {
            "cron"
        }
        _ => w.kind,
    };
    let method = if kind == "http" {
        w.method.clone()
    } else {
        None
    };
    out.decided.push((file.path.clone(), missing));
    out.add.push((
        file.path.clone(),
        EntryPoint {
            symbol,
            kind: kind.to_string(),
            method,
            route: Some(w.route.clone()),
            adapter: w.adapter.to_string(),
        },
        w.unread.clone(),
    ));
}

/// Gives `f` the entry point in its listed reading, with what the platform runs
/// before it that is not read as an application middleware of its mount.
fn add(f: &mut FileFacts, entry: EntryPoint, unread: &[String]) {
    let l = f.listed.get_or_insert_with(|| {
        Box::new(Listed {
            entry_points: f.entry_points.clone(),
            mounts: f.mounts.clone(),
            ..Listed::default()
        })
    });
    if !unread.is_empty() {
        let route = entry.route.clone().unwrap_or_default();
        let hows = unread
            .iter()
            .map(|h| format!("{}{h}", drift_core::APP_UNREAD));
        match l
            .mounts
            .iter_mut()
            .find(|m| m.symbol == entry.symbol && m.route == route)
        {
            Some(m) => m.app_middleware.extend(hows),
            None => l.mounts.push(MountFacts {
                symbol: entry.symbol.clone(),
                route,
                app_middleware: hows.collect(),
                ..MountFacts::default()
            }),
        }
        for m in &mut l.mounts {
            m.app_middleware.sort();
            m.app_middleware.dedup();
        }
        l.mounts.sort();
    }
    l.entry_points.push(entry);
    l.entry_points.sort();
    l.entry_points.dedup();
}

// ---------------------------------------------------------------- reading the files

/// The directory of a repo-relative path (`""` at the root).
fn dir_of(rel: &str) -> &str {
    rel.rsplit_once('/').map_or("", |(d, _)| d)
}

/// `rel` from `dir`, with `.` and `..` read; none for a path that leaves the
/// repository or is absolute.
fn join(dir: &str, rel: &str) -> Option<String> {
    if rel.starts_with('/') || rel.contains('\\') {
        return None;
    }
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
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

/// The stems a handler's file may have: as written, and a build directory read as
/// `src/` (`dist/users` is built from `src/users`); for Python also a dotted module
/// path (`api.users` is `api/users`).
fn stems(dir: &str, stem: &str, python: Option<bool>) -> Vec<String> {
    let mut out = Vec::new();
    let mut push = |s: &str| {
        if let Some(j) = join(dir, s)
            && !j.is_empty()
            && !out.contains(&j)
        {
            out.push(j);
        }
    };
    push(stem);
    if python != Some(false) && !stem.contains('/') && stem.contains('.') {
        push(&stem.replace('.', "/"));
    }
    let parts: Vec<&str> = stem.split('/').collect();
    if let Some(i) = parts.iter().position(|p| BUILD_DIRS.contains(p)) {
        let mut p = parts.clone();
        p[i] = "src";
        push(&p.join("/"));
    }
    out
}

/// A value written with a variable or a function of the tool (`${self:custom.x}`,
/// `${env:X}`, `${file(...)}`): what it is depends on how the tool is run.
fn templated(s: &str) -> bool {
    s.contains("${")
}

/// A JavaScript runtime (`Some(false)`), a Python one (`Some(true)`), none named
/// (`None`, both tried), or another language (`Err`, its name).
fn runtime_of(runtime: Option<&str>) -> Result<Option<bool>, String> {
    match runtime {
        None => Ok(None),
        Some(r) if r.starts_with("nodejs") => Ok(Some(false)),
        Some(r) if r.starts_with("python") => Ok(Some(true)),
        Some(r) => Err(r.to_string()),
    }
}

fn http_route(path: &str) -> String {
    let p = path.trim();
    if p.starts_with('/') {
        p.to_string()
    } else {
        format!("/{p}")
    }
}

fn http_method(m: &str) -> String {
    match m.trim() {
        "*" => "ANY".to_string(),
        m => m.to_ascii_uppercase(),
    }
}

/// One step of a path to a node of a YAML or JSON document ([`locate`]).
#[derive(Clone, Copy)]
enum Seg<'a> {
    Key(&'a str),
    Item(usize),
}

/// The 1-based line the node at `path` is written on, and whether every step was
/// found: block YAML (keys indented under their parent, sequence items written `- `)
/// and pretty-printed JSON. Where a step is not found, the line of the last one that
/// was (the file's first line at worst).
fn locate(text: &str, path: &[Seg]) -> (u32, bool) {
    let lines: Vec<&str> = text.lines().collect();
    let mut at = 0usize;
    let mut parent: Option<usize> = None;
    let mut line = 1u32;
    for seg in path {
        let mut hit = None;
        let mut items = 0usize;
        let mut item_indent = None;
        for (i, l) in lines.iter().enumerate().skip(at) {
            let t = l.trim_start();
            if t.is_empty() || t.starts_with('#') || t.starts_with("//") {
                continue;
            }
            let ind = l.len() - t.len();
            // Left the parent's block.
            if i > at
                && let Some(p) = parent
                && (ind < p || ind == p && !t.starts_with('-') && !t.starts_with('}'))
            {
                break;
            }
            match seg {
                Seg::Key(k) => {
                    let body = t.trim_start_matches(['-', ' ']);
                    let key_ind = l.len() - body.len();
                    if parent.is_some_and(|p| key_ind <= p) {
                        continue;
                    }
                    let keyed = [
                        format!("{k}:"),
                        format!("\"{k}\":"),
                        format!("'{k}':"),
                        format!("\"{k}\" :"),
                    ];
                    if keyed.iter().any(|x| body.starts_with(x.as_str())) {
                        hit = Some((i, key_ind));
                        break;
                    }
                }
                Seg::Item(n) => {
                    if !t.starts_with('-') {
                        continue;
                    }
                    if *item_indent.get_or_insert(ind) != ind {
                        continue;
                    }
                    if items == *n {
                        hit = Some((i, ind));
                        break;
                    }
                    items += 1;
                }
            }
        }
        let Some((i, ind)) = hit else {
            return (line, false);
        };
        line = u32::try_from(i + 1).unwrap_or(u32::MAX);
        match seg {
            // The item's own keys are on its line.
            Seg::Item(_) => {
                at = i;
                parent = Some(ind);
            }
            Seg::Key(_) => {
                at = i + 1;
                parent = Some(ind);
            }
        }
    }
    (line, true)
}

/// Whether the value of the key on `line` is written with a CloudFormation tag
/// (`Handler: !Sub "${Prefix}.handler"`).
fn tagged(text: &str, line: u32) -> bool {
    text.lines()
        .nth(line.saturating_sub(1) as usize)
        .and_then(|l| l.split_once(':'))
        .is_some_and(|(_, v)| v.trim_start().starts_with('!'))
}

/// The text with CloudFormation's short-form tags taken off (each line keeps its
/// place), so it parses as plain YAML. Where a tag stood is read from the text
/// itself ([`tagged`]).
fn untagged(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for l in text.split_inclusive('\n') {
        let mut l = l.to_string();
        for t in CFN_TAGS {
            l = l
                .replace(&format!("{t} "), "")
                .replace(&format!("{t}\n"), "\n");
            if l.trim_end().ends_with(t) {
                let cut = l.trim_end().len() - t.len();
                l.replace_range(cut.., if l.ends_with('\n') { "\n" } else { "" });
            }
        }
        out.push_str(&l);
    }
    out
}

/// The 1-based line of the first line from `from` (1-based) holding `needle`.
fn line_with(text: &str, needle: &str, from: u32) -> u32 {
    text.lines()
        .enumerate()
        .skip(from.saturating_sub(1) as usize)
        .find(|(_, l)| l.contains(needle))
        .map_or(from.max(1), |(i, _)| {
            u32::try_from(i + 1).unwrap_or(u32::MAX)
        })
}

fn parse_yaml_or_json(rel: &str, text: &str) -> Option<Value> {
    if rel.ends_with(".json") {
        serde_json::from_str(text).ok()
    } else {
        serde_saphyr::from_str(text).ok()
    }
}

/// JSON with comments and trailing commas (`wrangler.jsonc`), as JSON.
fn jsonc(text: &str) -> Option<Value> {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_str = false;
    while let Some(c) = chars.next() {
        if in_str {
            out.push(c);
            if c == '\\' {
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_str = true;
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
    // Trailing commas.
    let mut clean = String::with_capacity(out.len());
    let bytes: Vec<char> = out.chars().collect();
    let mut in_str = false;
    for (i, &c) in bytes.iter().enumerate() {
        if in_str {
            if c == '"' && bytes.get(i.wrapping_sub(1)) != Some(&'\\') {
                in_str = false;
            }
        } else if c == '"' {
            in_str = true;
        } else if c == ','
            && bytes[i + 1..]
                .iter()
                .find(|n| !n.is_whitespace())
                .is_some_and(|n| *n == '}' || *n == ']')
        {
            continue;
        }
        clean.push(c);
    }
    serde_json::from_str(&clean).ok()
}

fn str_of(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str)
}

/// A string or each string of a list.
fn strings(v: Option<&Value>) -> Vec<&str> {
    match v {
        Some(Value::String(s)) => vec![s.as_str()],
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect(),
        _ => vec![],
    }
}

// ---------------------------------------------------------- the Serverless Framework

fn serverless(rel: &str, text: &str, wants: &mut Vec<Want>, unresolved: &mut Vec<Unresolved>) {
    let Some(doc) = parse_yaml_or_json(rel, text) else {
        unresolved.push(Unresolved {
            path: rel.to_string(),
            line: 1,
            what: "not parsed".to_string(),
        });
        return;
    };
    let Some(functions) = doc.get("functions") else {
        return;
    };
    let runtime = str_of(doc.pointer("/provider/runtime"));
    let dir = dir_of(rel);
    match functions {
        Value::Object(m) => {
            for (name, f) in m {
                let path = [Seg::Key("functions"), Seg::Key(name)];
                sls_function(rel, text, dir, runtime, name, f, &path, wants, unresolved);
            }
        }
        Value::Array(a) => {
            for (i, item) in a.iter().enumerate() {
                match item {
                    Value::Object(m) => {
                        for (name, f) in m {
                            let path = [Seg::Key("functions"), Seg::Item(i), Seg::Key(name)];
                            sls_function(
                                rel, text, dir, runtime, name, f, &path, wants, unresolved,
                            );
                        }
                    }
                    other => unresolved.push(Unresolved {
                        path: rel.to_string(),
                        line: locate(text, &[Seg::Key("functions"), Seg::Item(i)]).0,
                        what: other.as_str().unwrap_or("functions").to_string(),
                    }),
                }
            }
        }
        other => unresolved.push(Unresolved {
            path: rel.to_string(),
            line: locate(text, &[Seg::Key("functions")]).0,
            what: other.as_str().unwrap_or("functions").to_string(),
        }),
    }
}

/// A platform authorizer named on an event, as what is not read; `None` for none.
fn sls_authorizer(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) if s == "aws_iam" => Some("IAM authorization".to_string()),
        Value::String(s) => Some(format!("authorizer {s}")),
        Value::Object(o) => {
            if str_of(o.get("type")).is_some_and(|t| t.eq_ignore_ascii_case("aws_iam")) {
                return Some("IAM authorization".to_string());
            }
            let name = ["name", "arn", "id", "type"]
                .iter()
                .find_map(|k| str_of(o.get(*k)))
                .unwrap_or("?");
            Some(format!("authorizer {name}"))
        }
        _ => Some("authorizer ?".to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
fn sls_function(
    rel: &str,
    text: &str,
    dir: &str,
    provider_runtime: Option<&str>,
    name: &str,
    f: &Value,
    path: &[Seg],
    wants: &mut Vec<Want>,
    unresolved: &mut Vec<Unresolved>,
) {
    let at = |rest: &[Seg]| {
        let p: Vec<Seg> = path.iter().copied().chain(rest.iter().copied()).collect();
        locate(text, &p).0
    };
    let fn_line = at(&[]);
    let hline = at(&[Seg::Key("handler")]);
    let mut unread_here = |line: u32, what: String| {
        unresolved.push(Unresolved {
            path: rel.to_string(),
            line,
            what,
        });
    };
    let Some(handler) = str_of(f.get("handler")) else {
        // A container image, or no handler written: nothing of the repository to read.
        unread_here(fn_line, format!("function {name}"));
        return;
    };
    if templated(handler) {
        unread_here(hline, handler.to_string());
        return;
    }
    let python = match runtime_of(str_of(f.get("runtime")).or(provider_runtime)) {
        Ok(p) => p,
        Err(r) => {
            unread_here(hline, format!("{handler} ({r})"));
            return;
        }
    };
    let Some((stem, export)) = handler.rsplit_once('.') else {
        unread_here(hline, handler.to_string());
        return;
    };
    let target = Target::Export {
        stems: stems(dir, stem, python),
        python,
        export: export.to_string(),
        written: handler.to_string(),
        line: hline,
    };
    let want = |line: u32,
                kind: &'static str,
                method: Option<String>,
                route: String,
                unread: Vec<String>| Want {
        config: rel.to_string(),
        line,
        target: target.clone(),
        kind,
        method,
        route,
        adapter: SERVERLESS,
        unread,
    };
    let mut any = false;
    // A function URL: every path, for anyone unless IAM authorizes the call.
    if let Some(url) = f
        .get("url")
        .filter(|u| !matches!(u, Value::Bool(false) | Value::Null))
    {
        any = true;
        let line = at(&[Seg::Key("url")]);
        let unread: Vec<String> = sls_authorizer(url.get("authorizer"))
            .map(|a| format!("{a} ({rel}:{line})"))
            .into_iter()
            .collect();
        wants.push(want(line, "http", Some("ANY".into()), "/*".into(), unread));
    }
    let events: &[Value] = f
        .get("events")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice);
    for (i, ev) in events.iter().enumerate() {
        any = true;
        let line = at(&[Seg::Key("events"), Seg::Item(i)]);
        let Some((ty, v)) = ev.as_object().and_then(|o| o.iter().next()) else {
            unread_here(line, format!("{name} event"));
            continue;
        };
        let guard = |o: Option<&serde_json::Map<String, Value>>| -> Vec<String> {
            let mut g = Vec::new();
            if let Some(a) = sls_authorizer(o.and_then(|o| o.get("authorizer"))) {
                g.push(format!("{a} ({rel}:{line})"));
            }
            if o.and_then(|o| o.get("private")).and_then(Value::as_bool) == Some(true) {
                g.push(format!("an API key ({rel}:{line})"));
            }
            g
        };
        match ty.as_str() {
            "http" | "httpApi" => {
                let (method, route, o) = match v {
                    Value::String(s) if s.trim() == "*" => {
                        ("ANY".to_string(), "/*".to_string(), None)
                    }
                    Value::String(s) => match s.split_once(char::is_whitespace) {
                        Some((m, p)) => (http_method(m), http_route(p), None),
                        None => (String::new(), String::new(), None),
                    },
                    Value::Object(o) => {
                        let m = str_of(o.get("method")).map_or("ANY".to_string(), http_method);
                        match str_of(o.get("path")) {
                            Some(p) => (m, http_route(p), Some(o)),
                            // An HTTP API event with no path is every path.
                            None if ty == "httpApi" => (m, "/*".to_string(), Some(o)),
                            None => (String::new(), String::new(), Some(o)),
                        }
                    }
                    _ => (String::new(), String::new(), None),
                };
                if route.is_empty() || templated(&route) || templated(&method) {
                    unread_here(line, format!("{name} {ty}"));
                    continue;
                }
                wants.push(want(line, "http", Some(method), route, guard(o)));
            }
            "alb" => {
                let o = v.as_object();
                let cond = o.and_then(|o| o.get("conditions"));
                let paths = strings(cond.and_then(|c| c.get("path")));
                let mut methods: Vec<String> = strings(cond.and_then(|c| c.get("method")))
                    .into_iter()
                    .map(http_method)
                    .collect();
                if methods.is_empty() {
                    methods.push("ANY".into());
                }
                if paths.is_empty() || paths.iter().any(|p| templated(p)) {
                    unread_here(line, format!("{name} alb"));
                    continue;
                }
                for p in &paths {
                    for m in &methods {
                        wants.push(want(line, "http", Some(m.clone()), http_route(p), guard(o)));
                    }
                }
            }
            "websocket" => {
                let (route, o) = match v {
                    Value::String(s) => (s.clone(), None),
                    Value::Object(o) => (
                        str_of(o.get("route")).unwrap_or_default().to_string(),
                        Some(o),
                    ),
                    _ => (String::new(), None),
                };
                if route.is_empty() || templated(&route) {
                    unread_here(line, format!("{name} websocket"));
                    continue;
                }
                wants.push(want(line, "websocket", None, route, guard(o)));
            }
            "schedule" => wants.push(want(line, "cron", None, name.to_string(), vec![])),
            "eventBridge" if v.get("schedule").is_some() => {
                wants.push(want(line, "cron", None, name.to_string(), vec![]));
            }
            t if SLS_CONSUMER_EVENTS.contains(&t) => {
                wants.push(want(line, "consumer", None, name.to_string(), vec![]));
            }
            t => unread_here(line, format!("{name} {t}")),
        }
    }
    // No trigger written: what invokes it is the application or another service, by
    // the function's name.
    if !any {
        wants.push(want(fn_line, "job", None, name.to_string(), vec![]));
    }
}

// ------------------------------------------------------------------------ AWS SAM

fn sam(rel: &str, text: &str, wants: &mut Vec<Want>, unresolved: &mut Vec<Unresolved>) {
    let json = rel.ends_with(".json");
    let doc = if json {
        serde_json::from_str::<Value>(text).ok()
    } else {
        serde_saphyr::from_str::<Value>(&untagged(text)).ok()
    };
    let Some(doc) = doc else {
        // A template of anything else may not parse here; one that says it is SAM's
        // is reported.
        if text.contains("AWS::Serverless") {
            unresolved.push(Unresolved {
                path: rel.to_string(),
                line: 1,
                what: "not parsed".to_string(),
            });
        }
        return;
    };
    let Some(resources) = doc.get("Resources").and_then(Value::as_object) else {
        return;
    };
    let dir = dir_of(rel);
    let globals = doc.pointer("/Globals/Function");
    for (id, r) in resources {
        if str_of(r.get("Type")) != Some("AWS::Serverless::Function") {
            continue;
        }
        let props = r.get("Properties");
        let base = [Seg::Key("Resources"), Seg::Key(id)];
        let id_line = locate(text, &base).0;
        // A property's value, its line, and whether it is settled (written as a plain
        // value, not with an intrinsic function), from the function or the globals.
        let prop = |k: &str| -> Option<(&Value, u32, bool)> {
            let (v, path): (&Value, Vec<Seg>) = match props.and_then(|p| p.get(k)) {
                Some(v) => (
                    v,
                    base.iter()
                        .copied()
                        .chain([Seg::Key("Properties"), Seg::Key(k)])
                        .collect(),
                ),
                None => (
                    globals?.get(k)?,
                    vec![Seg::Key("Globals"), Seg::Key("Function"), Seg::Key(k)],
                ),
            };
            let (line, found) = locate(text, &path);
            let settled = match v {
                Value::String(s) => !templated(s) && (json || found && !tagged(text, line)),
                _ => false,
            };
            Some((v, line, settled))
        };
        let mut unread_here = |line: u32, what: String| {
            unresolved.push(Unresolved {
                path: rel.to_string(),
                line,
                what,
            });
        };
        if str_of(props.and_then(|p| p.get("PackageType"))) == Some("Image")
            || props.and_then(|p| p.get("InlineCode")).is_some()
        {
            unread_here(id_line, id.clone());
            continue;
        }
        let Some((handler, hline, settled)) = prop("Handler") else {
            unread_here(id_line, id.clone());
            continue;
        };
        let handler_text = handler.as_str().unwrap_or("Handler");
        if !settled {
            unread_here(hline, format!("{id} {handler_text}"));
            continue;
        }
        let code = match prop("CodeUri") {
            None => String::new(),
            Some((Value::String(s), _, true)) => s.clone(),
            Some((_, line, _)) => {
                unread_here(line, format!("{id} CodeUri"));
                continue;
            }
        };
        let python = match runtime_of(prop("Runtime").and_then(|(v, _, _)| v.as_str())) {
            Ok(p) => p,
            Err(r) => {
                unread_here(hline, format!("{id} {handler_text} ({r})"));
                continue;
            }
        };
        let Some((stem, export)) = handler_text.rsplit_once('.') else {
            unread_here(hline, format!("{id} {handler_text}"));
            continue;
        };
        let Some(code_dir) = join(dir, &code) else {
            unread_here(hline, format!("{id} CodeUri"));
            continue;
        };
        let target = Target::Export {
            stems: stems(&code_dir, stem, python),
            python,
            export: export.to_string(),
            written: format!("{id} {handler_text}"),
            line: hline,
        };
        let want = |line: u32,
                    kind: &'static str,
                    method: Option<String>,
                    route: String,
                    unread: Vec<String>| Want {
            config: rel.to_string(),
            line,
            target: target.clone(),
            kind,
            method,
            route,
            adapter: SAM,
            unread,
        };
        let mut any = false;
        if let Some(url) = props.and_then(|p| p.get("FunctionUrlConfig")) {
            any = true;
            let line = locate(
                text,
                &[
                    base[0],
                    base[1],
                    Seg::Key("Properties"),
                    Seg::Key("FunctionUrlConfig"),
                ],
            )
            .0;
            let unread = match str_of(url.get("AuthType")) {
                Some("NONE") => vec![],
                Some("AWS_IAM") => vec![format!("IAM authorization ({rel}:{line})")],
                _ => vec![format!("the function URL's AuthType ({rel}:{line})")],
            };
            wants.push(want(line, "http", Some("ANY".into()), "/*".into(), unread));
        }
        let events = props
            .and_then(|p| p.get("Events"))
            .and_then(Value::as_object);
        for (ename, ev) in events.into_iter().flatten() {
            any = true;
            let line = locate(
                text,
                &[
                    base[0],
                    base[1],
                    Seg::Key("Properties"),
                    Seg::Key("Events"),
                    Seg::Key(ename),
                ],
            )
            .0;
            let ty = str_of(ev.get("Type")).unwrap_or_default();
            let p = ev.get("Properties");
            match ty {
                "Api" | "HttpApi" => {
                    let path = str_of(p.and_then(|p| p.get("Path")));
                    let method = str_of(p.and_then(|p| p.get("Method")));
                    let (method, route) = match (path, method) {
                        (Some(path), m) => {
                            (m.map_or("ANY".to_string(), http_method), http_route(path))
                        }
                        // An HTTP API event with neither is the API's default route.
                        (None, None) if ty == "HttpApi" => ("ANY".to_string(), "/*".to_string()),
                        _ => (String::new(), String::new()),
                    };
                    let tagged_value = !json
                        && ["Path", "Method"].iter().any(|k| {
                            let (l, found) = locate(
                                text,
                                &[
                                    base[0],
                                    base[1],
                                    Seg::Key("Properties"),
                                    Seg::Key("Events"),
                                    Seg::Key(ename),
                                    Seg::Key("Properties"),
                                    Seg::Key(k),
                                ],
                            );
                            found && tagged(text, l)
                        });
                    if route.is_empty() || templated(&route) || tagged_value {
                        unread_here(line, format!("{id} {ename}"));
                        continue;
                    }
                    let unread = sam_auth(&doc, resources, ty, p, rel, line);
                    wants.push(want(line, "http", Some(method), route, unread));
                }
                "Schedule" | "ScheduleV2" => {
                    wants.push(want(line, "cron", None, id.clone(), vec![]))
                }
                t if SAM_CONSUMER_EVENTS.contains(&t) => {
                    wants.push(want(line, "consumer", None, id.clone(), vec![]));
                }
                t => unread_here(line, format!("{id} {ename} {t}")),
            }
        }
        if !any {
            wants.push(want(id_line, "job", None, id.clone(), vec![]));
        }
    }
}

/// What API Gateway runs before a SAM `Api` or `HttpApi` event's function that
/// Drift does not read: the event's authorizer or API key, the default authorizer
/// of the API it is served on (its own resource, or the implicit one `Globals`
/// configures), or that API's definition. An event whose `Authorizer` is `NONE` has
/// none of the defaults.
fn sam_auth(
    doc: &Value,
    resources: &serde_json::Map<String, Value>,
    ty: &str,
    p: Option<&Value>,
    rel: &str,
    line: u32,
) -> Vec<String> {
    let mut out = Vec::new();
    let auth = p.and_then(|p| p.get("Auth"));
    let authorizer = auth.and_then(|a| a.get("Authorizer"));
    let open = str_of(authorizer) == Some("NONE");
    if let Some(a) = authorizer.filter(|_| !open) {
        let name = a.as_str().unwrap_or("?");
        out.push(if name == "AWS_IAM" {
            format!("IAM authorization ({rel}:{line})")
        } else {
            format!("authorizer {name} ({rel}:{line})")
        });
    }
    if auth
        .and_then(|a| a.get("ApiKeyRequired"))
        .and_then(Value::as_bool)
        == Some(true)
    {
        out.push(format!("an API key ({rel}:{line})"));
    }
    if open || !out.is_empty() {
        return out;
    }
    let api_key = if ty == "Api" { "RestApiId" } else { "ApiId" };
    let api_type = if ty == "Api" {
        "AWS::Serverless::Api"
    } else {
        "AWS::Serverless::HttpApi"
    };
    let (api, where_) = match p.and_then(|p| p.get(api_key)) {
        // The API resource of the template it names (`!Ref MyApi`).
        Some(v) => match v.as_str().and_then(|id| resources.get(id).map(|r| (id, r))) {
            Some((id, r)) if str_of(r.get("Type")) == Some(api_type) => {
                (r.get("Properties"), id.to_string())
            }
            _ => {
                out.push(format!("the API it is served on ({rel}:{line})"));
                return out;
            }
        },
        None => (
            doc.pointer(&format!("/Globals/{ty}")),
            "Globals".to_string(),
        ),
    };
    let api_auth = api.and_then(|a| a.get("Auth"));
    if let Some(d) = api_auth.and_then(|a| a.get("DefaultAuthorizer")) {
        out.push(format!(
            "default authorizer {} of {where_} ({rel})",
            d.as_str().unwrap_or("?")
        ));
    }
    if api_auth
        .and_then(|a| a.get("ApiKeyRequired"))
        .and_then(Value::as_bool)
        == Some(true)
    {
        out.push(format!("an API key {where_} requires ({rel})"));
    }
    if api.is_some_and(|a| a.get("DefinitionBody").is_some() || a.get("DefinitionUri").is_some()) {
        out.push(format!("the OpenAPI definition of {where_} ({rel})"));
    }
    out
}

// ------------------------------------------------------------- Cloudflare Workers

fn wrangler(rel: &str, text: &str, wants: &mut Vec<Want>, unresolved: &mut Vec<Unresolved>) {
    let doc = if rel.ends_with(".toml") {
        toml::from_str::<Value>(text).ok()
    } else {
        jsonc(text)
    };
    let Some(doc) = doc else {
        unresolved.push(Unresolved {
            path: rel.to_string(),
            line: 1,
            what: "not parsed".to_string(),
        });
        return;
    };
    // No `main`: a Pages project, or a Worker built elsewhere; nothing named to read.
    let Some(main) = str_of(doc.get("main")) else {
        return;
    };
    let main_line = line_with(text, "main", 1);
    let Some(main_path) = join(dir_of(rel), main) else {
        unresolved.push(Unresolved {
            path: rel.to_string(),
            line: main_line,
            what: main.to_string(),
        });
        return;
    };
    let name = str_of(doc.get("name")).unwrap_or(main).to_string();
    let want = |line: u32,
                member: &'static str,
                required: bool,
                kind: &'static str,
                method: Option<String>,
                route: String| Want {
        config: rel.to_string(),
        line,
        target: Target::Worker {
            main: main_path.clone(),
            member,
            required,
        },
        kind,
        method,
        route,
        adapter: WORKERS,
        unread: vec![],
    };
    // The paths `routes` serve the Worker on (`example.com/api/*` is `/api/*`), at
    // the top level and in each environment; every path on its own domain or
    // `workers.dev`.
    let mut paths: BTreeSet<String> = BTreeSet::new();
    let mut route_lists = vec![&doc];
    if let Some(envs) = doc.get("env").and_then(Value::as_object) {
        route_lists.extend(envs.values());
    }
    for d in &route_lists {
        for key in ["routes", "route"] {
            let patterns: Vec<&Value> = match d.get(key) {
                Some(Value::Array(a)) => a.iter().collect(),
                Some(v) => vec![v],
                None => vec![],
            };
            for p in patterns {
                let pattern = match p {
                    Value::String(s) => Some(s.as_str()),
                    Value::Object(o)
                        if o.get("custom_domain").and_then(Value::as_bool) == Some(true) =>
                    {
                        Some("")
                    }
                    Value::Object(o) => str_of(o.get("pattern")),
                    _ => None,
                };
                match pattern {
                    Some(s) => {
                        let path = s
                            .split_once('/')
                            .map_or("/*".to_string(), |(_, p)| format!("/{p}"));
                        paths.insert(path);
                    }
                    None => {
                        paths.insert("/?".to_string());
                    }
                }
            }
        }
    }
    if paths.is_empty() || doc.get("workers_dev").and_then(Value::as_bool) == Some(true) {
        paths.insert("/*".to_string());
    }
    for p in paths {
        wants.push(want(
            main_line,
            "fetch",
            true,
            "http",
            Some("ANY".into()),
            p,
        ));
    }
    let crons = strings(doc.pointer("/triggers/crons"));
    let cron_line = line_with(text, "crons", 1);
    wants.push(want(
        if crons.is_empty() {
            main_line
        } else {
            cron_line
        },
        "scheduled",
        !crons.is_empty(),
        "cron",
        None,
        name.clone(),
    ));
    let consumers: Vec<&str> = doc
        .pointer("/queues/consumers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|c| str_of(c.get("queue")))
        .collect();
    if consumers.is_empty() {
        wants.push(want(
            main_line,
            "queue",
            false,
            "consumer",
            None,
            name.clone(),
        ));
    }
    for q in consumers {
        wants.push(want(
            line_with(text, q, 1),
            "queue",
            true,
            "consumer",
            None,
            q.to_string(),
        ));
    }
    wants.push(want(
        main_line,
        "email",
        false,
        "consumer",
        None,
        name.clone(),
    ));
    // A Durable Object class of this Worker: only the Worker's own code reaches it,
    // through its binding, so it is run by the application.
    for b in doc
        .pointer("/durable_objects/bindings")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if b.get("script_name").is_some() {
            continue;
        }
        let Some(class) = str_of(b.get("class_name")) else {
            continue;
        };
        wants.push(Want {
            config: rel.to_string(),
            line: line_with(text, class, 1),
            target: Target::File {
                path: main_path.clone(),
                export: class.to_string(),
            },
            kind: "job",
            method: None,
            route: class.to_string(),
            adapter: WORKERS,
            unread: vec![],
        });
    }
}

// -------------------------------------------------------------- Netlify, Vercel

/// The repository's functions under `dir`: (name, file), a function being a file
/// directly in it or `<name>/<name>.<ext>` or `<name>/index.<ext>`.
fn functions_in<'r>(repo: &'r RepoFacts, dir: &str) -> Vec<(String, &'r FileFacts)> {
    let prefix = if dir.is_empty() {
        String::new()
    } else {
        format!("{dir}/")
    };
    let mut out = Vec::new();
    for f in &repo.files {
        let Some(rest) = f.path.strip_prefix(&prefix) else {
            continue;
        };
        let Some((stem, ext)) = rest.rsplit_once('.') else {
            continue;
        };
        if !NODE_EXTENSIONS.contains(&ext) {
            continue;
        }
        let name = match stem.split_once('/') {
            None => stem,
            Some((n, file)) if file == n || file == "index" => n,
            _ => continue,
        };
        out.push((name.to_string(), f));
    }
    out
}

fn netlify(
    repo: &RepoFacts,
    configs: &[(String, String)],
    wants: &mut Vec<Want>,
    unresolved: &mut Vec<Unresolved>,
) {
    let mut dirs: BTreeSet<String> = BTreeSet::new();
    let mut root_toml = false;
    for (rel, text) in configs {
        if rel.rsplit('/').next() != Some("netlify.toml") {
            continue;
        }
        let dir = dir_of(rel);
        root_toml |= dir.is_empty();
        let doc = toml::from_str::<Value>(text).ok();
        let named = doc.as_ref().and_then(|d| {
            str_of(d.pointer("/functions/directory")).or(str_of(d.pointer("/build/functions")))
        });
        if let Some(d) = join(dir, named.unwrap_or("netlify/functions")) {
            dirs.insert(d);
        }
    }
    // Netlify's own default, where no file says otherwise.
    if !root_toml {
        dirs.insert("netlify/functions".to_string());
    }
    for dir in dirs {
        for (name, f) in functions_in(repo, &dir) {
            let route = format!("/.netlify/functions/{name}");
            let export = if exports(f, "handler") {
                "handler"
            } else if exports(f, "default") {
                // Its `config` export may give it another path or a schedule, which
                // is not read: neither its path nor its kind is known.
                if exports(f, "config") {
                    let line = f
                        .symbols
                        .iter()
                        .find(|s| s.name == "config")
                        .map_or(1, |s| s.line);
                    unresolved.push(Unresolved {
                        path: f.path.clone(),
                        line,
                        what: "default (its config is not read)".to_string(),
                    });
                    continue;
                }
                "default"
            } else {
                continue;
            };
            wants.push(Want {
                config: f.path.clone(),
                line: 1,
                target: Target::File {
                    path: f.path.clone(),
                    export: export.to_string(),
                },
                kind: "http",
                method: Some("ANY".into()),
                route,
                adapter: NETLIFY,
                unread: vec![],
            });
        }
    }
}

fn vercel(repo: &RepoFacts, configs: &[(String, String)], wants: &mut Vec<Want>) {
    for (rel, _) in configs {
        if rel.rsplit('/').next() != Some("vercel.json") {
            continue;
        }
        let dir = dir_of(rel);
        // Next.js serves its own `pages/api` and `app` routes; its adapter lists them.
        let next = repo
            .packages
            .iter()
            .any(|p| p.path == dir && p.dependencies.iter().any(|d| d.starts_with("next@")));
        if next {
            continue;
        }
        let api = if dir.is_empty() {
            "api".to_string()
        } else {
            format!("{dir}/api")
        };
        let prefix = format!("{api}/");
        for f in &repo.files {
            let Some(rest) = f.path.strip_prefix(&prefix) else {
                continue;
            };
            let Some((stem, ext)) = rest.rsplit_once('.') else {
                continue;
            };
            // Files and directories starting with `_` or `.` are not functions.
            if !NODE_EXTENSIONS.contains(&ext) || stem.split('/').any(|p| p.starts_with(['_', '.']))
            {
                continue;
            }
            let route = match stem.strip_suffix("index") {
                Some("") => "/api".to_string(),
                Some(s) if s.ends_with('/') => format!("/api/{}", s.trim_end_matches('/')),
                _ => format!("/api/{stem}"),
            };
            let methods: Vec<&str> = HTTP_METHODS
                .iter()
                .copied()
                .filter(|m| exports(f, m))
                .collect();
            let mut push = |export: &str, method: &str| {
                wants.push(Want {
                    config: f.path.clone(),
                    line: 1,
                    target: Target::File {
                        path: f.path.clone(),
                        export: export.to_string(),
                    },
                    kind: "http",
                    method: Some(method.to_string()),
                    route: route.clone(),
                    adapter: VERCEL,
                    unread: vec![],
                });
            };
            if methods.is_empty() {
                if exports(f, "default") {
                    push("default", "ANY");
                }
            } else {
                for m in methods {
                    push(m, m);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The locator finds keys under their parent and sequence items by position.
    #[test]
    fn locate_reads_block_yaml_and_json() {
        let y = "service: a\nfunctions:\n  one:\n    handler: a.b\n    events:\n      - http: GET /x\n      - schedule: rate(1 hour)\n  two:\n    handler: c.d\n";
        assert_eq!(
            locate(
                y,
                &[Seg::Key("functions"), Seg::Key("two"), Seg::Key("handler")]
            ),
            (9, true)
        );
        assert_eq!(
            locate(
                y,
                &[
                    Seg::Key("functions"),
                    Seg::Key("one"),
                    Seg::Key("events"),
                    Seg::Item(1)
                ]
            ),
            (7, true)
        );
        let j =
            "{\n  \"functions\": {\n    \"one\": {\n      \"handler\": \"a.b\"\n    }\n  }\n}\n";
        assert_eq!(
            locate(
                j,
                &[Seg::Key("functions"), Seg::Key("one"), Seg::Key("handler")]
            ),
            (4, true)
        );
    }

    /// CloudFormation tags come off with each line in its place, and are still seen
    /// in the text.
    #[test]
    fn cloudformation_tags_are_taken_off_in_place() {
        let t = "A:\n  CodeUri: !Ref Code\n  Handler: !Sub \"${P}.h\"\n  B: !GetAtt\n    - X\n";
        let u = untagged(t);
        assert_eq!(u.lines().count(), t.lines().count());
        assert!(u.contains("CodeUri: Code\n") && !u.contains('!'), "{u}");
        assert!(tagged(t, 2) && tagged(t, 3) && !tagged(t, 1));
    }

    /// Comments and trailing commas of `wrangler.jsonc` are read past.
    #[test]
    fn jsonc_is_read() {
        let v = jsonc("{\n  // the worker\n  \"main\": \"src/index.ts\", /* x */\n  \"url\": \"http://a//b\",\n}\n").unwrap();
        assert_eq!(v["main"], "src/index.ts");
        assert_eq!(v["url"], "http://a//b");
    }
}
