//! The repository's Terraform, as far as a tie lets Drift read it.
//!
//! Drift does not read Terraform as a deployment: what a module deploys, with which
//! variables, how many times, is not in the files. A person can say the one thing
//! that is missing (`security.terraform` in `.drift/config.yaml`,
//! [`crate::policy::TerraformTie`]): this target group forwards to this code, and
//! requests from outside reach this code, in what this Terraform deploys, only
//! through load-balancer rules that forward to that target. With that said, the
//! listener rules answer for each route of the code: every
//! `resource "aws_lb_listener_rule"` of the repository's `.tf` files, all taken as
//! the rules of one listener.
//!
//! A rule is read only in its plain form: one `action` of `type = "forward"` whose
//! `target_group_arn` is `aws_lb_target_group.<name>.id` (or `.arn`) of its own
//! module, and conditions that are `path_pattern { values = [literal strings] }`
//! (`*` any run of characters, `?` any one) or `host_header`, which only narrows and
//! is ignored. Anything else makes the rule one that is not read: another kind of
//! condition, a second action, a `dynamic` block, `count` or `for_each`, a pattern
//! that is a variable or a local, a target that is not a resource of the module.
//!
//! For a route of a tied code directory ([`Tied::verdict`]):
//!
//! - internet-facing when a rule that is read and forwards to the tied target
//!   carries it;
//! - unknown when one may carry it, when a rule that forwards to the tied target is
//!   not read, when the target of a rule cannot be read (it may be the tied one),
//!   when an `aws_lb_listener` or a load-balancer module forwards by default, when a
//!   `terragrunt.hcl` has a `generate` block (it writes Terraform that is not in the
//!   repository), or when a Terraform file cannot be parsed;
//! - internal otherwise. A rule that forwards to another target group of the
//!   repository says nothing against it.
//!
//! What else Terraform opens to the code (a second load balancer, an API gateway, a
//! public address) is not read: the tie is the person's word that there is nothing,
//! and every verdict that rests on one says so.

use std::collections::BTreeSet;
use std::path::Path;

use crate::gateway::{Gateway, Glob, Route, Rule, Target};
use crate::policy::{CONFIG_FILE, TerraformTie};
use crate::security::Exposure;

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

/// The top-level blocks of a Terraform or Terragrunt file; none when it is not read.
fn parse(text: &str) -> Option<Vec<Block>> {
    let mut hcl = Hcl {
        c: text.chars().collect(),
        at: 0,
        line: 1,
        depth: 0,
    };
    Some(
        hcl.body(false)?
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

/// `["a", "b"]`: every element a literal string.
fn literals(expr: &str) -> Option<Vec<String>> {
    let inner = expr.strip_prefix('[')?.strip_suffix(']')?;
    let mut out = Vec::new();
    let mut rest = inner.trim();
    while !rest.is_empty() {
        let end = rest.strip_prefix('"')?.find('"')? + 2;
        out.push(literal(&rest[..end])?);
        rest = rest[end..].trim_start();
        rest = match rest.strip_prefix(',') {
            Some(more) => more.trim_start(),
            None if rest.is_empty() => rest,
            None => return None,
        };
    }
    Some(out)
}

/// `aws_lb_target_group.<name>.id`, `.arn`, with or without an index
/// (`aws_lb_target_group.api[0].id`): the target group resource of the module named.
fn group_of(expr: &str) -> Option<String> {
    let rest = ["aws_lb_target_group.", "aws_alb_target_group."]
        .iter()
        .find_map(|p| expr.strip_prefix(p))?;
    let end = rest
        .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-'))
        .unwrap_or(rest.len());
    let (name, rest) = rest.split_at(end);
    let rest = match rest.strip_prefix('[') {
        Some(index) => &index[index.find(']')? + 1..],
        None => rest,
    };
    (!name.is_empty() && matches!(rest, ".id" | ".arn")).then(|| name.to_string())
}

/// One `aws_lb_listener_rule` that forwards.
#[derive(Debug, Clone, PartialEq, Eq)]
struct LbRule {
    /// `rule` (`file:line`), for messages.
    shown: String,
    /// The directory of its file: its module.
    module: String,
    /// The target group of its module it forwards to; none when that is not read.
    group: Option<String>,
    /// The path patterns it is for; empty when it has no path condition (every path).
    patterns: Vec<String>,
    /// Why it is not read.
    unread: Option<String>,
}

/// The listener rules and target groups of the repository's Terraform
/// ([`Terraform::read`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Terraform {
    rules: Vec<LbRule>,
    /// (module directory, name) of every `aws_lb_target_group`.
    groups: BTreeSet<(String, String)>,
    /// Why no route of a tied directory is said to be internal, whatever the rules
    /// say: something that may forward requests and is not a rule Drift reads.
    open: Vec<String>,
}

const RULES: &[&str] = &["aws_lb_listener_rule", "aws_alb_listener_rule"];
const LISTENERS: &[&str] = &["aws_lb_listener", "aws_alb_listener"];
const GROUPS: &[&str] = &["aws_lb_target_group", "aws_alb_target_group"];

/// The attributes of a load-balancer module that hold its listeners.
const LISTENER_ATTRIBUTES: &[&str] = &[
    "listeners",
    "http_tcp_listeners",
    "https_listeners",
    "default_action",
];

impl Terraform {
    /// Reads the Terraform `files` (repo-relative: `.tf`, `.tf.json`,
    /// `terragrunt.hcl`) under `root`.
    pub fn read(root: &Path, files: &[String]) -> Terraform {
        let mut out = Terraform::default();
        for file in files {
            let Ok(text) = std::fs::read_to_string(root.join(file)) else {
                out.open.push(format!("{file} is not read"));
                continue;
            };
            out.add(file, &text);
        }
        out
    }

    fn add(&mut self, file: &str, text: &str) {
        let module = file.rsplit_once('/').map_or("", |(d, _)| d).to_string();
        if file.ends_with(".tf.json") {
            // Terraform written as JSON is not read: one that names a load balancer
            // may hold a rule.
            if text.contains("lb_listener") || text.contains("lb_target_group") {
                self.open
                    .push(format!("{file} is Terraform as JSON, which is not read"));
            }
            return;
        }
        let Some(blocks) = parse(text) else {
            self.open.push(format!("{file} is not read (not parsed)"));
            return;
        };
        for b in &blocks {
            let label = |i: usize| b.labels.get(i).map(String::as_str).unwrap_or_default();
            match b.kind.as_str() {
                "generate" if file.ends_with("terragrunt.hcl") => self.open.push(format!(
                    "{file}:{} has a `generate` block, which writes Terraform that is not in the repository",
                    b.line
                )),
                "resource" if GROUPS.contains(&label(0)) => {
                    self.groups.insert((module.clone(), label(1).to_string()));
                }
                "resource" if LISTENERS.contains(&label(0)) => {
                    let forwards = b.blocks("default_action").any(|a| {
                        !matches!(
                            a.attr("type").and_then(literal).as_deref(),
                            Some("redirect" | "fixed-response")
                        )
                    }) || b.blocks("dynamic").next().is_some();
                    if forwards {
                        self.open.push(format!(
                            "listener `{}` ({file}:{}) may forward by default",
                            label(1),
                            b.line
                        ));
                    }
                }
                "resource" if RULES.contains(&label(0)) => {
                    let shown = format!("`{}` ({file}:{})", label(1), b.line);
                    if let Some(rule) = rule(b, shown, &module) {
                        self.rules.push(rule);
                    }
                }
                // A load-balancer module with a listener that forwards.
                "module" => {
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
                        self.open.push(format!(
                            "module `{}` ({file}:{}) has a listener that forwards by default",
                            label(0),
                            b.line
                        ));
                    }
                }
                _ => {}
            }
        }
    }

    /// What `tie` comes to, for the routes of its code; an error when it names no
    /// target group Drift finds.
    pub fn tied(&self, tie: &TerraformTie) -> Result<Tied, String> {
        let named = |name: &str| tie.group.as_deref().is_none_or(|g| g == name);
        let groups: Vec<&str> = self
            .groups
            .iter()
            .filter(|(module, name)| *module == tie.module && named(name))
            .map(|(_, name)| name.as_str())
            .collect();
        let target = match &tie.group {
            Some(g) => format!("{}#aws_lb_target_group.{g}", tie.module),
            None => format!("the target groups of {}", tie.module),
        };
        if groups.is_empty() {
            return Err(format!(
                "{CONFIG_FILE}: `security.terraform` names {target}, and no such `aws_lb_target_group` is in the repository's Terraform (the entry is ignored)"
            ));
        }
        let by = format!("tied to {} by {CONFIG_FILE}", shown_dir(&tie.code));
        let mut tied = Tied {
            tie: tie.clone(),
            target: target.clone(),
            every: None,
            gateway: None,
            globs: Vec::new(),
            unknown: None,
        };
        let mut plain: Vec<Rule> = Vec::new();
        let mut files: BTreeSet<String> = BTreeSet::new();
        let mut unknown: Vec<String> = Vec::new();
        for r in &self.rules {
            let ours =
                r.module == tie.module && r.group.as_deref().is_some_and(|g| groups.contains(&g));
            match (&r.group, &r.unread) {
                // Its target is not read: it may be the tied one.
                (None, why) => unknown.push(format!(
                    "listener rule {} is not read ({}): it may forward to {target}",
                    r.shown,
                    why.as_deref()
                        .unwrap_or("its target is not a target group of its module")
                )),
                (Some(_), _) if !ours => {}
                (Some(_), Some(why)) => unknown.push(format!(
                    "listener rule {}, which forwards to {target}, is not read ({why})",
                    r.shown
                )),
                (Some(_), None) if r.patterns.is_empty() => {
                    tied.every.get_or_insert(format!(
                        "listener rule {} forwards every path to {target} ({by})",
                        r.shown
                    ));
                }
                (Some(_), None) => {
                    files.insert(r.shown.clone());
                    for p in &r.patterns {
                        let stem = p.strip_suffix('*').unwrap_or(p);
                        if stem.contains(['*', '?']) {
                            tied.globs.push((p.clone(), r.shown.clone()));
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

/// One `aws_lb_target_group` of the repository's Terraform as it is plainly written,
/// for a person to tie code to (`drift setup`): what it says of itself, never what a
/// deployment of it would be.
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
    /// The path patterns of the listener rules that are read and forward to it.
    pub paths: Vec<String>,
}

/// The target groups of the Terraform `files` under `root`, sorted, each with the
/// path patterns of the plain listener rules of its module that forward to it.
pub fn target_groups(root: &Path, files: &[String]) -> Vec<TargetGroup> {
    let mut out: Vec<TargetGroup> = Vec::new();
    let mut rules: Vec<LbRule> = Vec::new();
    for file in files.iter().filter(|f| f.ends_with(".tf")) {
        let Ok(text) = std::fs::read_to_string(root.join(file)) else {
            continue;
        };
        let Some(blocks) = parse(&text) else {
            continue;
        };
        let module = file.rsplit_once('/').map_or("", |(d, _)| d).to_string();
        for b in &blocks {
            let label = |i: usize| b.labels.get(i).map(String::as_str).unwrap_or_default();
            if b.kind != "resource" {
                continue;
            }
            if GROUPS.contains(&label(0)) {
                out.push(TargetGroup {
                    module: module.clone(),
                    name: label(1).to_string(),
                    at: format!("{file}:{}", b.line),
                    port: b
                        .attr("port")
                        .map(str::trim)
                        .filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
                        .map(str::to_string),
                    health: b
                        .blocks("health_check")
                        .find_map(|h| h.attr("path").and_then(literal)),
                    paths: Vec::new(),
                });
            } else if RULES.contains(&label(0))
                && let Some(r) = rule(b, String::new(), &module)
                && r.unread.is_none()
            {
                rules.push(r);
            }
        }
    }
    for g in &mut out {
        for r in &rules {
            if r.module == g.module && r.group.as_deref() == Some(g.name.as_str()) {
                g.paths.extend(r.patterns.iter().cloned());
            }
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

/// The rule of a `resource "aws_lb_listener_rule"` block; none for one that forwards
/// nowhere (a redirect, a fixed response).
fn rule(b: &Block, shown: String, module: &str) -> Option<LbRule> {
    let mut unread: Option<String> = None;
    let mut note = |why: String| {
        unread.get_or_insert(why);
    };
    for meta in ["count", "for_each"] {
        if b.attr(meta).is_some() {
            note(format!("it has `{meta}`"));
        }
    }
    if b.blocks("dynamic").next().is_some() {
        note("it has a `dynamic` block".into());
    }
    let actions: Vec<&Block> = b.blocks("action").collect();
    let mut group = None;
    match actions.as_slice() {
        [action] => match action.attr("type").and_then(literal).as_deref() {
            // Nothing is forwarded.
            Some("redirect" | "fixed-response") => return None,
            Some("forward") => {
                group = action.attr("target_group_arn").and_then(group_of);
                if group.is_none() {
                    note("its target is not a target group of its module".into());
                }
            }
            _ => note("its action is not a plain forward".into()),
        },
        _ => note(format!("it has {} actions", actions.len())),
    }
    let mut patterns = Vec::new();
    for condition in b.blocks("condition") {
        for item in &condition.body {
            match item {
                Item::Block(c) if c.kind == "host_header" => {}
                Item::Block(c) if c.kind == "path_pattern" => {
                    match c.attr("values").and_then(literals) {
                        Some(values) => patterns.extend(values),
                        None => note("its path patterns are not literal strings".into()),
                    }
                }
                Item::Block(c) => note(format!("its `{}` condition is not read", c.kind)),
                Item::Attr(k, _) => note(format!("its condition `{k}` is not read")),
            }
        }
    }
    Some(LbRule {
        shown,
        module: module.to_string(),
        group,
        patterns,
        unread,
    })
}

/// One tie, with what the repository's Terraform says of the routes of its code
/// ([`Terraform::tied`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tied {
    pub tie: TerraformTie,
    /// The tied target, for messages.
    target: String,
    /// A rule that is read forwards every path to the target.
    every: Option<String>,
    /// The rules that are read and forward to the target, by path or prefix.
    gateway: Option<Gateway>,
    /// Their patterns with a `?` or a `*` inside: (pattern, rule).
    globs: Vec<(String, String)>,
    /// Why no route is said to be internal ([`Terraform::open`], a rule to the
    /// target that is not read, a rule whose target is not read).
    unknown: Option<String>,
}

impl Tied {
    /// Whether the code in `path` (a file or a directory) is the tie's.
    pub fn covers(&self, path: &str) -> bool {
        let code = &self.tie.code;
        code.is_empty() || path == code || path.starts_with(&format!("{code}/"))
    }

    /// The exposure of `route` (written `shown`), for what this Terraform deploys,
    /// and what says so.
    pub fn verdict(&self, route: &Route, shown: &str) -> (Exposure, String) {
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
        (
            Exposure::Internal,
            format!(
                "no listener rule in the repository's Terraform forwards {shown} to {target} ({by}); what else Terraform opens to it is not read, nor whether an application another rule publishes relays requests to it"
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
        assert_eq!(
            pattern.attr("values").and_then(literals),
            Some(vec!["/v1/a*".to_string(), "/v1/b".to_string()])
        );
        assert_eq!(rule.attr("policy"), Some("<<heredoc>>"));
        assert_eq!(parse("resource \"a\" \"b\" {\n"), None);
        assert_eq!(literals("[var.pattern]"), None);
        assert_eq!(literals("[\"/v1/${var.name}/*\"]"), None);
        assert_eq!(literals("var.patterns"), None);
        assert_eq!(group_of("aws_lb_target_group.api.id"), Some("api".into()));
        assert_eq!(
            group_of("aws_lb_target_group.api[0].arn"),
            Some("api".into())
        );
        assert_eq!(group_of("var.target_group_arn"), None);
        assert_eq!(group_of("module.lb.target_groups[\"api\"].arn"), None);
        assert_eq!(group_of("aws_lb_target_group.api.name"), None);
    }
}
