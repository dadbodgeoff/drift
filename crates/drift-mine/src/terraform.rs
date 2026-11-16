//! The repository's Terraform, as far as a tie lets Drift read it.
//!
//! Drift does not read Terraform as a deployment on its own: which code a target
//! runs is not in the files. A person can say the one thing that is missing
//! (`security.terraform` in `.drift/config.yaml`, [`crate::policy::TerraformTie`]):
//! this target (a load balancer's target group, a Lambda function, an API Gateway
//! integration, a GCP backend service, a Cloud Run service) runs this code, and
//! requests from outside reach this code, in what this Terraform deploys, only
//! through what forwards to that target. With that said, what forwards in the
//! repository's `.tf` files ([`forward`]) answers for each route of the code.
//!
//! Each forward is read only in its plain form, its values worked out where the
//! files settle them ([`values`]: a `locals` literal, a variable's `default` that no
//! `.tfvars` file, `module` block or Terragrunt `inputs` sets again, `count` and
//! `for_each` over those). Anything else makes the forward one that is not read, and
//! the reason names the expression: a `dynamic` block, a condition of another kind,
//! a pattern or a count that is a variable a deployment chooses, a target that is
//! not a resource of the module.
//!
//! For a route of a tied code directory ([`Tied::verdict`]):
//!
//! - internet-facing when a forward that is read, takes requests from the internet
//!   and sends them to the tied target carries every path of it, as the application
//!   sees it (an API path the application may see under a stage or a base path, or
//!   through an HTTP integration's own URL, is not one it carries);
//! - unknown when one may carry it, when a forward to the tied target is not read,
//!   when the target of a forward cannot be read (it may be the tied one), when
//!   where a forward takes requests from is not settled (`internal = var.x`), when a
//!   `terragrunt.hcl` has a `generate` block (it writes Terraform that is not in the
//!   repository), or when a Terraform file cannot be parsed;
//! - internal otherwise. A forward that sends requests from inside a network only
//!   (an internal load balancer nothing outside fronts, a private REST API, an
//!   internal URL map, a Cloud Run service with internal ingress) says nothing
//!   against it, nor does one to another target.
//!
//! What else Terraform opens to the code (security groups, IAM, CloudFront
//! behaviours, Azure, a public address) is not read: the tie is the person's word
//! that there is nothing, and every verdict that rests on one says so.

mod forward;
mod values;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::gateway::{Gateway, Glob, Route, Rule, Target};
use crate::policy::{CONFIG_FILE, TerraformTie};
use crate::security::Exposure;
use forward::{Forward, From, Paths};

/// One thing of a Terraform body: an attribute with its expression as written
/// (comments taken out), or a block.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Item {
    Attr(String, String),
    Block(Block),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Block {
    kind: String,
    labels: Vec<String>,
    body: Vec<Item>,
    line: u32,
}

impl Block {
    fn attr(&self, name: &str) -> Option<&str> {
        self.body.iter().find_map(|i| match i {
            Item::Attr(k, v) if k == name => Some(v.as_str()),
            _ => None,
        })
    }

    fn blocks<'a>(&'a self, kind: &'a str) -> impl Iterator<Item = &'a Block> {
        self.body.iter().filter_map(move |i| match i {
            Item::Block(b) if b.kind == kind => Some(b),
            _ => None,
        })
    }

    /// Whether any expression of the block, at any depth, has the word `word`.
    fn says(&self, word: &str) -> bool {
        self.body.iter().any(|i| match i {
            Item::Attr(_, v) => v.contains(word),
            Item::Block(b) => b.kind == word || b.says(word),
        })
    }
}

/// A reader of HCL as far as blocks, attributes and where an expression ends.
struct Hcl {
    c: Vec<char>,
    at: usize,
    line: u32,
    depth: usize,
}

impl Hcl {
    fn peek(&self) -> Option<char> {
        self.c.get(self.at).copied()
    }

    fn next(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.at += 1;
        if c == '\n' {
            self.line += 1;
        }
        Some(c)
    }

    fn starts(&self, s: &str) -> bool {
        s.chars()
            .enumerate()
            .all(|(i, c)| self.c.get(self.at + i) == Some(&c))
    }

    /// Skips a comment that starts here; false when none does.
    fn comment(&mut self) -> bool {
        if self.starts("#") || self.starts("//") {
            while self.peek().is_some_and(|c| c != '\n') {
                self.next();
            }
            true
        } else if self.starts("/*") {
            while self.peek().is_some() && !self.starts("*/") {
                self.next();
            }
            self.next();
            self.next();
            true
        } else {
            false
        }
    }

    /// Skips white space and comments; with `lines` false, stops at the end of a line.
    fn space(&mut self, lines: bool) {
        loop {
            match self.peek() {
                Some('\n') if !lines => return,
                Some(c) if c.is_whitespace() => {
                    self.next();
                }
                Some(_) if self.comment() => {}
                _ => return,
            }
        }
    }

    fn word(&mut self) -> String {
        let mut out = String::new();
        while let Some(c) = self
            .peek()
            .filter(|c| c.is_alphanumeric() || "_-.".contains(*c))
        {
            out.push(c);
            self.next();
        }
        out
    }

    /// A quoted string that starts here, with its quotes, written to `out`.
    fn string(&mut self, out: &mut String) -> Option<()> {
        out.push(self.next()?);
        loop {
            let c = self.next()?;
            out.push(c);
            match c {
                '\\' => out.push(self.next()?),
                '"' => return Some(()),
                '$' | '%' if self.peek() == Some('{') => {
                    out.push(self.next()?);
                    let mut depth = 1;
                    while depth > 0 {
                        match self.peek()? {
                            '"' => self.string(out)?,
                            c => {
                                depth += usize::from(c == '{');
                                depth -= usize::from(c == '}');
                                out.push(c);
                                self.next();
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// The expression that starts here, to the end of its line or of the block it is
    /// in, comments taken out.
    fn expression(&mut self) -> Option<String> {
        let mut out = String::new();
        let mut depth = 0usize;
        loop {
            match self.peek() {
                None => break,
                Some('\n') if depth == 0 => break,
                Some('}') if depth == 0 => break,
                Some('"') => self.string(&mut out)?,
                Some('<') if self.starts("<<") => {
                    // A heredoc: to the line that is its marker.
                    self.next();
                    self.next();
                    if self.peek() == Some('-') {
                        self.next();
                    }
                    let marker = self.word();
                    if marker.is_empty() {
                        out.push_str("<<");
                        continue;
                    }
                    let mut line = String::new();
                    loop {
                        match self.next()? {
                            '\n' if line.trim() == marker => break,
                            '\n' => line.clear(),
                            c => line.push(c),
                        }
                        if self.peek().is_none() && line.trim() == marker {
                            break;
                        }
                    }
                    out.push_str("<<heredoc>>");
                    if depth == 0 {
                        break;
                    }
                }
                Some(_) if self.comment() => out.push(' '),
                Some(c) => {
                    match c {
                        '(' | '[' | '{' => depth += 1,
                        ')' | ']' | '}' => depth = depth.checked_sub(1)?,
                        _ => {}
                    }
                    out.push(c);
                    self.next();
                }
            }
        }
        Some(out.split_whitespace().collect::<Vec<_>>().join(" "))
    }

    /// The items to the end of the text, or (`inner`) to the `}` that ends the block.
    fn body(&mut self, inner: bool) -> Option<Vec<Item>> {
        // Deeper than anything written by hand: not read.
        self.depth += 1;
        if self.depth > 64 {
            return None;
        }
        let mut out = Vec::new();
        loop {
            self.space(true);
            match self.peek() {
                None if inner => return None,
                None => break,
                Some('}') if inner => {
                    self.next();
                    break;
                }
                _ => {}
            }
            let line = self.line;
            let key = match self.peek() {
                Some('"') => {
                    let mut quoted = String::new();
                    self.string(&mut quoted)?;
                    quoted.trim_matches('"').to_string()
                }
                _ => self.word(),
            };
            if key.is_empty() {
                return None;
            }
            self.space(false);
            if (self.peek() == Some('=') && !self.starts("==")) || self.peek() == Some(':') {
                self.next();
                self.space(false);
                out.push(Item::Attr(key, self.expression()?));
                continue;
            }
            let mut labels = Vec::new();
            loop {
                self.space(false);
                match self.peek()? {
                    '{' => break,
                    '"' => {
                        let mut quoted = String::new();
                        self.string(&mut quoted)?;
                        labels.push(quoted.trim_matches('"').to_string());
                    }
                    _ => {
                        let label = self.word();
                        if label.is_empty() {
                            return None;
                        }
                        labels.push(label);
                    }
                }
            }
            self.next();
            out.push(Item::Block(Block {
                kind: key,
                labels,
                body: self.body(true)?,
                line,
            }));
        }
        self.depth -= 1;
        Some(out)
    }
}

/// The items of a Terraform or Terragrunt file, attributes too; none when it is not
/// read.
fn parse_items(text: &str) -> Option<Vec<Item>> {
    let mut hcl = Hcl {
        c: text.chars().collect(),
        at: 0,
        line: 1,
        depth: 0,
    };
    hcl.body(false)
}

/// The top-level blocks of a Terraform or Terragrunt file; none when it is not read.
#[cfg(test)]
fn parse(text: &str) -> Option<Vec<Block>> {
    Some(
        parse_items(text)?
            .into_iter()
            .filter_map(|i| match i {
                Item::Block(b) => Some(b),
                Item::Attr(..) => None,
            })
            .collect(),
    )
}

/// `"text"` with nothing interpolated.
fn literal(expr: &str) -> Option<String> {
    let inner = expr.strip_prefix('"')?.strip_suffix('"')?;
    (!inner.contains(['"', '\\']) && !inner.contains("${") && !inner.contains("%{"))
        .then(|| inner.to_string())
}

/// The kinds of resource a tie can name as its target (`#<kind>.<name>`): what the
/// forwards Drift reads send requests to.
pub const TARGET_KINDS: &[&str] = &[
    "aws_lb_target_group",
    "aws_alb_target_group",
    "aws_lambda_function",
    "aws_lambda_alias",
    "aws_api_gateway_integration",
    "aws_apigatewayv2_integration",
    "google_compute_backend_service",
    "google_compute_region_backend_service",
    "google_cloud_run_service",
    "google_cloud_run_v2_service",
];

/// The targets `drift setup` offers a person to tie code to: the integrations are
/// left to a person who writes the tie, since one names an API path, not a service.
const OFFERED: &[&str] = &[
    "aws_lb_target_group",
    "aws_alb_target_group",
    "aws_lambda_function",
    "google_compute_backend_service",
    "google_compute_region_backend_service",
    "google_cloud_run_service",
    "google_cloud_run_v2_service",
];

/// A resource of a module: its kind and name.
type Addr = (String, String);

/// One `resource`, `data` or `module` block of a module.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Res {
    kind: String,
    name: String,
    block: Block,
    file: String,
}

impl Res {
    /// ``<noun> `name` (file:line)``.
    fn shown(&self, noun: &str) -> String {
        if noun.is_empty() {
            format!("`{}` ({})", self.name, self.at())
        } else {
            format!("{noun} `{}` ({})", self.name, self.at())
        }
    }

    fn at(&self) -> String {
        format!("{}:{}", self.file, self.block.line)
    }

    /// Its `count` or `for_each`, with the expression.
    fn meta(&self) -> Option<(&'static str, &str)> {
        ["count", "for_each"]
            .into_iter()
            .find_map(|k| self.block.attr(k).map(|e| (k, e)))
    }
}

/// One Terraform module: the `.tf` files of one directory.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Module {
    dir: String,
    resources: Vec<Res>,
    data: Vec<Res>,
    calls: Vec<Res>,
    locals: BTreeMap<String, String>,
    variables: BTreeMap<String, Option<String>>,
    /// The variables something else in the repository sets, with where.
    set_outside: BTreeMap<String, String>,
}

impl Module {
    fn env(&self) -> values::Env<'_> {
        values::Env {
            locals: &self.locals,
            variables: &self.variables,
            set_outside: &self.set_outside,
        }
    }

    fn get(&self, kind: &str, name: &str) -> Option<&Res> {
        self.resources
            .iter()
            .find(|r| r.kind == kind && r.name == name)
    }

    fn has(&self, kind: &str, name: &str) -> bool {
        self.get(kind, name).is_some()
    }

    fn of<'a>(&'a self, kinds: &'a [&'a str]) -> impl Iterator<Item = &'a Res> {
        self.resources
            .iter()
            .filter(move |r| kinds.contains(&r.kind.as_str()))
    }
}

/// The attributes of a load-balancer module that hold its listeners.
const LISTENER_ATTRIBUTES: &[&str] = &[
    "listeners",
    "http_tcp_listeners",
    "https_listeners",
    "default_action",
];

/// Parts of the provider resource types that forward requests: a file of Terraform as
/// JSON that names one is said, since it is not read.
const JSON_FORWARDING_KINDS: &[&str] = &[
    "lb_listener",
    "lb_target_group",
    "api_gateway",
    "apigatewayv2",
    "lambda_function_url",
    "url_map",
    "cloud_run",
    "backend_service",
];

/// What a `module` block sets that is not one of the module's variables.
const MODULE_META: &[&str] = &[
    "source",
    "version",
    "count",
    "for_each",
    "providers",
    "depends_on",
];

/// `rel` (`./x`, `../x`) from the directory `dir`, repo-relative; none above the root.
fn join_rel(dir: &str, rel: &str) -> Option<String> {
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

/// The keys an `inputs = { ... }` expression sets.
fn input_keys(expr: &str) -> Vec<String> {
    let c: Vec<char> = expr.chars().collect();
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut word = String::new();
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        match ch {
            '{' | '[' | '(' => depth += 1,
            '}' | ']' | ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if ch.is_alphanumeric() || ch == '_' || ch == '-' {
            word.push(ch);
        } else {
            if depth == 1 && !word.is_empty() {
                let rest: String = c[i..].iter().collect();
                let rest = rest.trim_start();
                if (rest.starts_with('=') && !rest.starts_with("==")) || rest.starts_with(':') {
                    out.push(std::mem::take(&mut word));
                }
            }
            word.clear();
        }
        i += 1;
    }
    out
}

/// The `.tfvars` files under `root`, to the depth deployment descriptions are found.
fn tfvars(root: &Path) -> Vec<String> {
    let walker = ignore::WalkBuilder::new(root)
        .max_depth(Some(crate::security::COMPOSE_DEPTH))
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
    let mut out: Vec<String> = walker
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .filter_map(|e| {
            let name = e.file_name().to_str()?;
            if !(name.ends_with(".tfvars") || name.ends_with(".tfvars.json")) {
                return None;
            }
            let rel = e.path().strip_prefix(root).ok()?;
            let parts: Option<Vec<&str>> =
                rel.components().map(|c| c.as_os_str().to_str()).collect();
            parts.map(|p| p.join("/"))
        })
        .collect();
    out.sort();
    out
}

/// The modules of the Terraform `files` under `root`, and what may forward and is not
/// read (pushed to `open`).
fn modules(root: &Path, files: &[String], open: &mut Vec<String>) -> BTreeMap<String, Module> {
    let mut out: BTreeMap<String, Module> = BTreeMap::new();
    // Variables set from outside every module (a `.tfvars` file, Terragrunt `inputs`:
    // which module they are for is not read), and those a `module` block sets.
    let mut everywhere: BTreeMap<String, String> = BTreeMap::new();
    let mut called: Vec<(String, String, String)> = Vec::new();
    for file in files {
        let Ok(text) = std::fs::read_to_string(root.join(file)) else {
            open.push(format!("{file} is not read"));
            continue;
        };
        let dir = file.rsplit_once('/').map_or("", |(d, _)| d).to_string();
        if file.ends_with(".tf.json") {
            if JSON_FORWARDING_KINDS.iter().any(|w| text.contains(w)) {
                open.push(format!("{file} is Terraform as JSON, which is not read"));
            }
            continue;
        }
        let Some(items) = parse_items(&text) else {
            open.push(format!("{file} is not read (not parsed)"));
            continue;
        };
        let terragrunt = file.ends_with("terragrunt.hcl");
        let m = out.entry(dir.clone()).or_insert_with(|| Module {
            dir: dir.clone(),
            ..Module::default()
        });
        for item in items {
            let b = match item {
                Item::Attr(k, v) if terragrunt && k == "inputs" => {
                    for key in input_keys(&v) {
                        everywhere.entry(key).or_insert_with(|| file.clone());
                    }
                    continue;
                }
                Item::Attr(..) => continue,
                Item::Block(b) => b,
            };
            let label = |i: usize| b.labels.get(i).cloned().unwrap_or_default();
            match b.kind.as_str() {
                "generate" if terragrunt => open.push(format!(
                    "{file}:{} has a `generate` block, which writes Terraform that is not in the repository",
                    b.line
                )),
                _ if terragrunt => {}
                "resource" | "data" => {
                    let r = Res {
                        kind: label(0),
                        name: label(1),
                        block: b.clone(),
                        file: file.clone(),
                    };
                    if b.kind == "resource" {
                        m.resources.push(r);
                    } else {
                        m.data.push(r);
                    }
                }
                "locals" => {
                    for i in &b.body {
                        if let Item::Attr(k, v) = i {
                            m.locals.insert(k.clone(), v.clone());
                        }
                    }
                }
                "variable" => {
                    m.variables
                        .insert(label(0), b.attr("default").map(str::to_string));
                }
                "module" => {
                    // A load-balancer module with a listener that forwards.
                    let forwards = b.body.iter().any(|i| match i {
                        Item::Attr(k, v) => {
                            LISTENER_ATTRIBUTES.contains(&k.as_str()) && v.contains("forward")
                        }
                        Item::Block(inner) => {
                            LISTENER_ATTRIBUTES.contains(&inner.kind.as_str())
                                && inner.says("forward")
                        }
                    });
                    if forwards {
                        open.push(format!(
                            "module `{}` ({file}:{}) has a listener that forwards by default",
                            label(0),
                            b.line
                        ));
                    }
                    let source = b.attr("source").and_then(literal).unwrap_or_default();
                    if (source.starts_with("./") || source.starts_with("../"))
                        && let Some(target) = join_rel(&dir, &source)
                    {
                        for i in &b.body {
                            if let Item::Attr(k, _) = i
                                && !MODULE_META.contains(&k.as_str())
                            {
                                called.push((
                                    target.clone(),
                                    k.clone(),
                                    format!("module `{}` ({file}:{})", label(0), b.line),
                                ));
                            }
                        }
                    }
                    m.calls.push(Res {
                        kind: "module".into(),
                        name: label(0),
                        block: b.clone(),
                        file: file.clone(),
                    });
                }
                _ => {}
            }
        }
    }
    for file in tfvars(root) {
        let Ok(text) = std::fs::read_to_string(root.join(&file)) else {
            everywhere.entry("*".into()).or_insert(file);
            continue;
        };
        let keys: Option<Vec<String>> = if file.ends_with(".json") {
            serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v.as_object().map(|o| o.keys().cloned().collect()))
        } else {
            parse_items(&text).map(|items| {
                items
                    .into_iter()
                    .filter_map(|i| match i {
                        Item::Attr(k, _) => Some(k),
                        Item::Block(_) => None,
                    })
                    .collect()
            })
        };
        match keys {
            Some(keys) => {
                for k in keys {
                    everywhere.entry(k).or_insert_with(|| file.clone());
                }
            }
            None => {
                everywhere.entry("*".into()).or_insert(file);
            }
        }
    }
    for m in out.values_mut() {
        m.set_outside = everywhere.clone();
        for (dir, var, by) in &called {
            if *dir == m.dir {
                m.set_outside
                    .entry(var.clone())
                    .or_insert_with(|| by.clone());
            }
        }
    }
    out
}

/// What forwards in the repository's Terraform ([`Terraform::read`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Terraform {
    forwards: Vec<Forward>,
    /// (module directory, kind, name) of every target a tie can name.
    targets: BTreeSet<(String, String, String)>,
    /// Why no route of a tied directory is said to be internal, whatever the
    /// forwards say: something that may forward requests and is not read.
    open: Vec<String>,
}

impl Terraform {
    /// Reads the Terraform `files` (repo-relative: `.tf`, `.tf.json`,
    /// `terragrunt.hcl`) under `root`, and the `.tfvars` files beside them.
    pub fn read(root: &Path, files: &[String]) -> Terraform {
        let mut out = Terraform::default();
        let modules = modules(root, files, &mut out.open);
        for m in modules.values() {
            for r in m.of(TARGET_KINDS) {
                out.targets
                    .insert((m.dir.clone(), r.kind.clone(), r.name.clone()));
            }
        }
        out.forwards = forward::read(&modules);
        out
    }

    /// What `tie` comes to, for the routes of its code; an error when it names no
    /// target Drift finds.
    pub fn tied(&self, tie: &TerraformTie) -> Result<Tied, String> {
        let kinds: Vec<&str> = match (&tie.kind, &tie.group) {
            (Some(k), _) => vec![k.as_str()],
            (None, Some(_)) => forward::TARGET_GROUPS.to_vec(),
            (None, None) => TARGET_KINDS.to_vec(),
        };
        let named = |name: &str| tie.group.as_deref().is_none_or(|g| g == name);
        let ours: BTreeSet<Addr> = self
            .targets
            .iter()
            .filter(|(module, kind, name)| {
                *module == tie.module && kinds.contains(&kind.as_str()) && named(name)
            })
            .map(|(_, kind, name)| (kind.clone(), name.clone()))
            .collect();
        let groups_only = ours
            .iter()
            .all(|(k, _)| forward::TARGET_GROUPS.contains(&k.as_str()));
        let target = match (&tie.group, &tie.kind) {
            (Some(g), Some(k)) => format!("{}#{k}.{g}", tie.module),
            (Some(g), None) => format!("{}#aws_lb_target_group.{g}", tie.module),
            (None, _) if groups_only => format!("the target groups of {}", tie.module),
            (None, _) => format!("the targets of {}", tie.module),
        };
        if ours.is_empty() {
            let kind = tie.kind.as_deref().unwrap_or("aws_lb_target_group");
            return Err(format!(
                "{CONFIG_FILE}: `security.terraform` names {target}, and no such `{kind}` is in the repository's Terraform{} (the entry is ignored)",
                if tie.group.is_none() {
                    ", nor any other target Drift reads"
                } else {
                    ""
                }
            ));
        }
        let by = format!("tied to {} by {CONFIG_FILE}", shown_dir(&tie.code));
        let mut tied = Tied {
            tie: tie.clone(),
            target: target.clone(),
            groups_only,
            every: None,
            gateway: None,
            globs: Vec::new(),
            carriers: Vec::new(),
            unknown: None,
            inside: Vec::new(),
        };
        let tied_kinds: BTreeSet<&str> = ours.iter().map(|(k, _)| k.as_str()).collect();
        let mut plain: Vec<Rule> = Vec::new();
        let mut unknown: Vec<String> = Vec::new();
        for f in &self.forwards {
            let mine = f.module == tie.module && !f.to.is_disjoint(&ours);
            let maybe = !mine
                && f.any
                    .as_ref()
                    .is_some_and(|(_, ks)| ks.iter().any(|k| tied_kinds.contains(k)));
            if !mine && !maybe {
                continue;
            }
            let detail = f
                .detail
                .as_deref()
                .map_or(String::new(), |d| format!("; {d}"));
            // From inside a network only: it says nothing against the route being
            // internal, and only a forward that names the target is worth saying.
            if let From::Inside(why) = &f.from {
                if mine {
                    tied.inside.push(format!(
                        "{} forwards to it from inside only ({why})",
                        f.shown
                    ));
                }
                continue;
            }
            if maybe {
                let why = f.any.as_ref().map_or("", |(w, _)| w.as_str());
                unknown.push(format!("{why}: it may forward to {target}{detail}"));
                continue;
            }
            if let Some(why) = &f.unread {
                unknown.push(format!(
                    "{}, which forwards to {target}, is not read ({why}){detail}",
                    f.shown
                ));
                continue;
            }
            let from = match &f.from {
                From::Unknown(w) => Some(w.clone()),
                _ => None,
            };
            let notes = if f.notes.is_empty() {
                String::new()
            } else {
                format!(", {}", f.notes.join(", "))
            };
            match &f.paths {
                Paths::Every if from.is_none() => {
                    tied.every.get_or_insert(format!(
                        "{} forwards every path to {target}{notes} ({by})",
                        f.shown
                    ));
                }
                Paths::Lb(patterns) if from.is_none() && f.notes.is_empty() => {
                    for p in patterns {
                        let stem = p.strip_suffix('*').unwrap_or(p);
                        if stem.contains(['*', '?']) {
                            tied.globs.push((p.clone(), f.shown.clone()));
                        } else {
                            plain.push(Rule {
                                host: None,
                                label: p.clone(),
                                path: stem.to_string(),
                                exact: stem.len() == p.len(),
                                target: Target::Services(vec![TARGET.to_string()]),
                                strip: false,
                                opaque: false,
                            });
                        }
                    }
                }
                paths => tied.carriers.push(Carrier {
                    shown: f.shown.clone(),
                    paths: match paths {
                        Paths::Lb(p) => Paths::Globs {
                            take: p.clone(),
                            others: Vec::new(),
                        },
                        other => other.clone(),
                    },
                    method: f.method.clone(),
                    rewrites: f.rewrites.clone(),
                    from,
                    notes,
                }),
            }
        }
        unknown.extend(self.open.iter().cloned());
        tied.unknown = unknown.into_iter().next();
        if !plain.is_empty() {
            tied.gateway = Some(Gateway::of_rules(
                &tie.module,
                Vec::new(),
                "listener rule",
                plain,
                Vec::new(),
            ));
        }
        Ok(tied)
    }
}

/// One target of the repository's Terraform as it is plainly written, for a person to
/// tie code to (`drift setup`): what it says of itself, never what a deployment of
/// it would be.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct TargetGroup {
    /// The directory of its module, repo-relative.
    pub module: String,
    /// The resource's name (`storage_service_api`).
    pub name: String,
    /// Where it is (`file:line`).
    pub at: String,
    /// `port`, where it is a number.
    pub port: Option<String>,
    /// `health_check.path`, where it is a literal string.
    pub health: Option<String>,
    /// The paths of the forwards that are read and send requests to it: listener rule
    /// patterns, API Gateway paths, URL map path rules.
    pub paths: Vec<String>,
    /// The resource's kind (`aws_lb_target_group`, `aws_lambda_function`, ...).
    pub kind: String,
}

impl TargetGroup {
    /// What it is called in words: `Target group`, `Lambda function`, ...
    pub fn noun(&self) -> &'static str {
        match self.kind.as_str() {
            "aws_lambda_function" | "aws_lambda_alias" => "Lambda function",
            "google_compute_backend_service" | "google_compute_region_backend_service" => {
                "Backend service"
            }
            "google_cloud_run_service" | "google_cloud_run_v2_service" => "Cloud Run service",
            "aws_api_gateway_integration" | "aws_apigatewayv2_integration" => {
                "API Gateway integration"
            }
            _ => "Target group",
        }
    }

    /// `<kind>.<name>`, as a tie names it after `#`.
    pub fn address(&self) -> String {
        format!("{}.{}", self.kind, self.name)
    }
}

/// The targets of the Terraform `files` under `root` a person may tie code to, sorted,
/// each with the paths the forwards that are read send to it.
pub fn target_groups(root: &Path, files: &[String]) -> Vec<TargetGroup> {
    let tf: Vec<String> = files
        .iter()
        .filter(|f| f.ends_with(".tf"))
        .cloned()
        .collect();
    let modules = modules(root, &tf, &mut Vec::new());
    let forwards = forward::read(&modules);
    let mut out: Vec<TargetGroup> = Vec::new();
    for m in modules.values() {
        for r in m.of(OFFERED) {
            let group = forward::TARGET_GROUPS.contains(&r.kind.as_str());
            let me = (r.kind.clone(), r.name.clone());
            let mut paths = Vec::new();
            for f in forwards
                .iter()
                .filter(|f| f.module == m.dir && f.to.contains(&me) && f.unread.is_none())
            {
                match &f.paths {
                    Paths::Lb(p) => paths.extend(p.iter().cloned()),
                    Paths::Globs { take, .. } => paths.extend(take.iter().cloned()),
                    Paths::Template(t) => paths.push(t.clone()),
                    Paths::Every => {}
                }
            }
            out.push(TargetGroup {
                module: m.dir.clone(),
                name: r.name.clone(),
                at: r.at(),
                port: r
                    .block
                    .attr("port")
                    .map(str::trim)
                    .filter(|p| group && !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
                    .map(str::to_string),
                health: r
                    .block
                    .blocks("health_check")
                    .find_map(|h| h.attr("path").and_then(literal))
                    .filter(|_| group),
                paths,
                kind: r.kind.clone(),
            });
        }
    }
    out.sort();
    out
}

/// What the gateway of a tie calls the tied target.
const TARGET: &str = "target";

fn shown_dir(dir: &str) -> &str {
    if dir.is_empty() {
        "the repository"
    } else {
        dir
    }
}

/// A forward to the tied target that is read and is not a plain listener rule of a
/// load balancer that takes requests from the internet.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Carrier {
    shown: String,
    paths: Paths,
    method: Option<String>,
    rewrites: Option<String>,
    /// Why where it takes requests from is not known.
    from: Option<String>,
    /// `, <fact>` for each fact said with it.
    notes: String,
}

/// One tie, with what the repository's Terraform says of the routes of its code
/// ([`Terraform::tied`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tied {
    pub tie: TerraformTie,
    /// The tied target, for messages.
    target: String,
    /// Every tied target is a load balancer's target group.
    groups_only: bool,
    /// A forward that is read sends every path to the target.
    every: Option<String>,
    /// The listener rules that are read and forward to the target, by path or prefix.
    gateway: Option<Gateway>,
    /// Their patterns with a `?` or a `*` inside: (pattern, rule).
    globs: Vec<(String, String)>,
    /// The other forwards that are read and send to the target.
    carriers: Vec<Carrier>,
    /// Why no route is said to be internal ([`Terraform::open`], a forward to the
    /// target that is not read, a forward whose target is not read).
    unknown: Option<String>,
    /// The forwards to the target that take requests from inside only.
    inside: Vec<String>,
}

impl Tied {
    /// Whether the code in `path` (a file or a directory) is the tie's.
    pub fn covers(&self, path: &str) -> bool {
        let code = &self.tie.code;
        code.is_empty() || path == code || path.starts_with(&format!("{code}/"))
    }

    /// The exposure of `route` (written `shown`, answering `method` where one is
    /// known), for what this Terraform deploys, and what says so.
    pub fn verdict(&self, route: &Route, shown: &str, method: Option<&str>) -> (Exposure, String) {
        let by = format!("tied to {} by {CONFIG_FILE}", shown_dir(&self.tie.code));
        let target = &self.target;
        if let Some(every) = &self.every {
            return (Exposure::Public, every.clone());
        }
        if let Some(pattern) = self.gateway.as_ref().and_then(|g| g.carries(TARGET, route)) {
            return (
                Exposure::Public,
                format!("a listener rule forwards {pattern} to {target} ({by})"),
            );
        }
        let globs = |want: Glob| {
            self.globs
                .iter()
                .find(|(pattern, _)| route.glob(pattern) == want)
        };
        if let Some((pattern, rule)) = globs(Glob::Every) {
            return (
                Exposure::Public,
                format!("listener rule {rule} forwards {pattern} to {target} ({by})"),
            );
        }
        let carried: Vec<(&Carrier, Glob, String)> = self
            .carriers
            .iter()
            .map(|c| {
                let (g, label) = forward::takes(&c.paths, route, shown);
                let label = match &c.method {
                    Some(m) => format!("{m} {label}"),
                    None => label,
                };
                (
                    c,
                    forward::both(g, forward::method_glob(c.method.as_deref(), method)),
                    label,
                )
            })
            .filter(|(_, g, _)| *g != Glob::None)
            .collect();
        if let Some((c, _, label)) = carried.iter().find(|(c, g, _)| {
            *g == Glob::Every
                && c.from.is_none()
                && (c.rewrites.is_none() || c.paths == Paths::Every)
        }) {
            return (
                Exposure::Public,
                format!("{} forwards {label} to {target}{} ({by})", c.shown, c.notes),
            );
        }
        if let Some(why) = &self.unknown {
            return (Exposure::Unknown, format!("{why} ({by})"));
        }
        if let Some(why) = self
            .gateway
            .as_ref()
            .and_then(|g| g.may_carry(TARGET, route))
        {
            return (
                Exposure::Unknown,
                format!("a listener rule may forward {shown} to {target}: {why} ({by})"),
            );
        }
        if let Some((pattern, rule)) = globs(Glob::Some) {
            return (
                Exposure::Unknown,
                format!(
                    "listener rule {rule} may forward {shown} to {target}: {pattern} takes some of its paths ({by})"
                ),
            );
        }
        if let Some((c, g, label)) = carried.first() {
            let why = match (&c.from, g) {
                (Some(from), _) => format!(
                    "{} forwards {label} to {target}, and whether it takes requests from outside is not known: {from}",
                    c.shown
                ),
                (None, Glob::Every) => format!(
                    "{} forwards {label} to {target}, and the path the application sees may not be that one: {}",
                    c.shown,
                    c.rewrites.as_deref().unwrap_or_default()
                ),
                (None, _) => format!(
                    "{} may forward {shown} to {target}: {label} takes some of its paths or methods",
                    c.shown
                ),
            };
            return (Exposure::Unknown, format!("{why} ({by})"));
        }
        let inside = if self.inside.is_empty() {
            String::new()
        } else {
            format!("; {}", self.inside.join("; "))
        };
        (
            Exposure::Internal,
            format!(
                "{} in the repository's Terraform forwards {shown} to {target} ({by}){inside}; what else Terraform opens to it is not read (security groups, IAM, CloudFront behaviours, Azure), nor whether an application another rule publishes relays requests to it",
                if self.groups_only {
                    "no listener rule"
                } else {
                    "nothing Drift reads"
                }
            ),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(t: &str) -> Route {
        Route::parse(t).unwrap()
    }

    #[test]
    fn a_path_pattern_takes_every_some_or_no_path_of_a_route() {
        let glob = |pattern: &str, template: &str| route(template).glob(pattern);
        assert_eq!(glob("/v1/rules*", "/v1/rules"), Glob::Every);
        assert_eq!(glob("/v1/rules*", "/v1/rules/{id}"), Glob::Every);
        assert_eq!(glob("/v1/rules/*", "/v1/rules"), Glob::None);
        assert_eq!(glob("/v1/rule?", "/v1/rules"), Glob::Every);
        assert_eq!(glob("/v1/rule?", "/v1/rule"), Glob::None);
        assert_eq!(glob("/v1/rule?", "/v1/rulers"), Glob::None);
        assert_eq!(glob("/v?/rules", "/v2/rules"), Glob::Every);
        assert_eq!(glob("/v?/rules", "/v10/rules"), Glob::None);
        // A parameter is text Drift does not know: one character, or more.
        assert_eq!(glob("/v1/rules/?", "/v1/rules/{id}"), Glob::Some);
        assert_eq!(
            glob("/v1/rules/*/audit", "/v1/rules/{id}/audit"),
            Glob::Every
        );
        assert_eq!(glob("/v1/rules/*/audit", "/v1/rules/{id}"), Glob::None);
        assert_eq!(glob("/v1/rules/7", "/v1/rules/{id}"), Glob::Some);
        assert_eq!(glob("/v1/rules/a/b", "/v1/rules/{id}"), Glob::None);
        assert_eq!(glob("/files/a/b", "/files/{rest:path}"), Glob::Some);
        assert_eq!(glob("/*", "/files/{rest:path}"), Glob::Every);
        // A route under a prefix that is not read may be anywhere.
        assert_eq!(glob("/v1/rules*", "/?/rules"), Glob::Some);
    }

    #[test]
    fn terraform_is_read_as_blocks_attributes_and_expressions() {
        let blocks = parse(
            "# a comment\nlocals {\n  tags = { Name = \"api\" } // trailing\n}\n\nresource \"aws_lb_listener_rule\" \"api\" {\n  listener_arn = data.aws_lb_listener.selected.arn\n  action { type = \"forward\" }\n  condition {\n    path_pattern {\n      values = [\n        # the first\n        \"/v1/a*\", /* and */ \"/v1/b\",\n      ]\n    }\n  }\n  tags = merge(var.tags, {\n    Name = \"${var.name}-{rule}\"\n  })\n  policy = <<-EOT\n    { \"not\": \"a block\" }\n  EOT\n}\n",
        )
        .unwrap();
        assert_eq!(blocks.len(), 2);
        let rule = &blocks[1];
        assert_eq!(rule.labels, ["aws_lb_listener_rule", "api"]);
        assert_eq!(rule.line, 6);
        assert_eq!(
            rule.attr("listener_arn"),
            Some("data.aws_lb_listener.selected.arn")
        );
        let pattern = rule
            .blocks("condition")
            .next()
            .and_then(|c| c.blocks("path_pattern").next())
            .unwrap();
        let values = pattern.attr("values").unwrap();
        assert!(
            values.contains("\"/v1/a*\",") && values.contains("\"/v1/b\""),
            "{values}"
        );
        assert!(
            !values.contains("first") && !values.contains("and"),
            "{values}"
        );
        assert_eq!(rule.attr("policy"), Some("<<heredoc>>"));
        assert_eq!(parse("resource \"a\" \"b\" {\n"), None);
        assert_eq!(
            join_rel("infra/live", "../modules/api"),
            Some("infra/modules/api".into())
        );
        assert_eq!(join_rel("", "../x"), None);
        assert_eq!(
            input_keys("{ name = \"api\" tags = { a = 1 } paths = [\"/x\"] }"),
            ["name", "tags", "paths"]
        );
    }
}
