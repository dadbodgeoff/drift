//! Gateways that are not nginx, read into the rules of a [`Gateway`] so that exposure
//! behind them is each route's ([`crate::security::Boundaries`]): Traefik's docker
//! labels in a compose file, and a Caddyfile.
//!
//! Each reader takes a subset and says what is outside it. A rule Drift cannot
//! evaluate (a regular expression, a header or method condition, a middleware or
//! directive that rewrites the path) is kept as a rule that may carry anything and
//! proves nothing; what may add rules that are not in what was read (a file provider,
//! an `import`, a directive Drift does not know) is recorded as unread, and then no
//! route is internal. Which of several matching rules wins (Traefik's priorities,
//! Caddy's directive order) is not modelled: a route is internet-facing only where
//! the rules that match its path agree.
//!
//! Hostile input: a label or a file is read once, tokens and nesting are capped, and
//! nothing here recurses without a bound.

use std::collections::BTreeMap;

use crate::gateway::{Gateway, Rule, Target};

/// How deep rule expressions and Caddyfile blocks may nest.
const MAX_DEPTH: usize = 32;
/// How many alternatives one rule expression may come to.
const MAX_ALTERNATIVES: usize = 64;
/// The longest word of a Caddyfile that is read.
const MAX_WORD: usize = 512;

// ---------- Traefik ----------

/// A compose service as Traefik's docker provider sees it: its name and its labels
/// (`key=value`).
pub struct Labelled<'a> {
    pub name: &'a str,
    pub labels: &'a [String],
}

/// One alternative of a rule expression: what a request must be for it to match.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Alternative {
    host: Option<String>,
    /// (path, exact).
    path: Option<(String, bool)>,
    /// A condition Drift does not evaluate (a method, a header, a regular expression).
    conditional: bool,
}

/// The alternatives of a Traefik rule (`Host(`a`) && (PathPrefix(`/x`) ||
/// Path(`/y`))`), each a conjunction; none when the expression is outside what is
/// read (a negation, a matcher Drift does not know, more alternatives than are kept).
fn traefik_rule(text: &str) -> Option<Vec<Alternative>> {
    #[derive(Debug, Clone, PartialEq)]
    enum Tok {
        Name(String),
        Str(String),
        Open,
        Close,
        Comma,
        And,
        Or,
        Not,
    }
    let c: Vec<char> = text.chars().collect();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < c.len() {
        match c[i] {
            x if x.is_whitespace() => i += 1,
            '(' => {
                toks.push(Tok::Open);
                i += 1;
            }
            ')' => {
                toks.push(Tok::Close);
                i += 1;
            }
            ',' => {
                toks.push(Tok::Comma);
                i += 1;
            }
            '!' => {
                toks.push(Tok::Not);
                i += 1;
            }
            '&' if c.get(i + 1) == Some(&'&') => {
                toks.push(Tok::And);
                i += 2;
            }
            '|' if c.get(i + 1) == Some(&'|') => {
                toks.push(Tok::Or);
                i += 2;
            }
            q @ ('`' | '"' | '\'') => {
                let end = (i + 1..c.len()).find(|j| c[*j] == q)?;
                toks.push(Tok::Str(c[i + 1..end].iter().collect()));
                i = end + 1;
            }
            x if x.is_ascii_alphabetic() => {
                let end = (i..c.len())
                    .find(|j| !c[*j].is_ascii_alphanumeric())
                    .unwrap_or(c.len());
                toks.push(Tok::Name(c[i..end].iter().collect()));
                i = end;
            }
            _ => return None,
        }
        if toks.len() > 4 * MAX_ALTERNATIVES {
            return None;
        }
    }
    // Both hold: the hosts and paths of each side, where they do not contradict.
    fn both(a: &[Alternative], b: &[Alternative]) -> Option<Vec<Alternative>> {
        let mut out = Vec::new();
        for x in a {
            for y in b {
                let host = match (&x.host, &y.host) {
                    (Some(h), Some(g)) if h != g => continue,
                    (h, g) => h.clone().or(g.clone()),
                };
                let (path, clash) = match (&x.path, &y.path) {
                    (Some(p), Some(q)) if p != q => (Some(p.clone()), true),
                    (p, q) => (p.clone().or(q.clone()), false),
                };
                out.push(Alternative {
                    host,
                    path,
                    conditional: x.conditional || y.conditional || clash,
                });
                if out.len() > MAX_ALTERNATIVES {
                    return None;
                }
            }
        }
        Some(out)
    }
    fn either(toks: &[Tok], i: &mut usize, depth: usize) -> Option<Vec<Alternative>> {
        let mut out = all(toks, i, depth)?;
        while toks.get(*i) == Some(&Tok::Or) {
            *i += 1;
            out.extend(all(toks, i, depth)?);
            if out.len() > MAX_ALTERNATIVES {
                return None;
            }
        }
        Some(out)
    }
    fn all(toks: &[Tok], i: &mut usize, depth: usize) -> Option<Vec<Alternative>> {
        let mut out = one(toks, i, depth)?;
        while toks.get(*i) == Some(&Tok::And) {
            *i += 1;
            out = both(&out, &one(toks, i, depth)?)?;
        }
        Some(out)
    }
    fn one(toks: &[Tok], i: &mut usize, depth: usize) -> Option<Vec<Alternative>> {
        if depth > MAX_DEPTH {
            return None;
        }
        match toks.get(*i)? {
            Tok::Open => {
                *i += 1;
                let inner = either(toks, i, depth + 1)?;
                (toks.get(*i) == Some(&Tok::Close)).then(|| *i += 1)?;
                Some(inner)
            }
            Tok::Name(name) => {
                *i += 1;
                (toks.get(*i) == Some(&Tok::Open)).then(|| *i += 1)?;
                let mut args = Vec::new();
                loop {
                    match toks.get(*i)? {
                        Tok::Str(s) => args.push(s.clone()),
                        _ => return None,
                    }
                    *i += 1;
                    match toks.get(*i)? {
                        Tok::Comma => *i += 1,
                        Tok::Close => {
                            *i += 1;
                            break;
                        }
                        _ => return None,
                    }
                }
                let conditional = || {
                    vec![Alternative {
                        conditional: true,
                        ..Alternative::default()
                    }]
                };
                Some(match name.as_str() {
                    "Host" => args
                        .into_iter()
                        .map(|h| Alternative {
                            host: Some(h.to_lowercase()),
                            ..Alternative::default()
                        })
                        .collect(),
                    // A pattern of hosts: a client chooses one that fits.
                    "HostRegexp" | "HostSNI" | "HostSNIRegexp" => vec![Alternative::default()],
                    "PathPrefix" | "Path" => args
                        .into_iter()
                        .map(|p| Alternative {
                            // Version 2 writes a parameter as `{id}` in a path.
                            conditional: p.contains(['{', '}']),
                            path: Some((p, name == "Path")),
                            ..Alternative::default()
                        })
                        .collect(),
                    "PathRegexp" | "Method" | "Headers" | "HeadersRegexp" | "Header"
                    | "HeaderRegexp" | "Query" | "QueryRegexp" | "ClientIP" => conditional(),
                    _ => return None,
                })
            }
            _ => None,
        }
    }
    let mut i = 0;
    let out = either(&toks, &mut i, 0)?;
    (i == toks.len()).then_some(out)
}

/// The Traefik gateway `name` of the compose file `file`, read from the labels of the
/// file's `services`: its routers (`traefik.http.routers.<r>.rule`: `Host`,
/// `PathPrefix`, `Path`, `&&`, `||`), their `stripprefix` middlewares, and the default
/// router every container has while `exposedByDefault` is not turned off. `said` is
/// the gateway's own definition (its command and environment) in lower case,
/// `config` what it mounts as configuration, `stock` whether it runs the stock image.
///
/// Not evaluated, so that they may carry anything: a rule outside the subset or with
/// a method, header or query condition, a middleware that changes the path other
/// than `stripprefix` of the rule's own prefix, a middleware that is not on a label,
/// a `service` that is not the container's, TCP and UDP routers. Not read, so that
/// nothing is internal: a file or other provider, a configuration file, an image
/// that is not the stock one.
pub fn traefik(
    name: &str,
    file: &str,
    said: &str,
    config: &[String],
    stock: bool,
    services: &[Labelled],
) -> Gateway {
    let mut unread: Vec<String> = Vec::new();
    let said = said.to_lowercase().replace('_', ".");
    if !stock {
        unread.push(format!("gateway {name}: what its image holds is not read"));
    }
    for c in config {
        unread.push(format!("gateway {name}: its configuration {c} is not read"));
    }
    for provider in [
        "file",
        "kubernetes",
        "consul",
        "etcd",
        "http",
        "redis",
        "zookeeper",
        "nomad",
        "ecs",
        "swarm",
        "plugin",
    ] {
        if said.contains(&format!("providers.{provider}")) {
            unread.push(format!(
                "gateway {name}: its `{provider}` provider is not read"
            ));
        }
    }
    if said.contains("configfile") {
        unread.push(format!(
            "gateway {name}: its configuration file is not read"
        ));
    }
    let exposed_by_default = !said
        .replace(['"', '\'', ' '], "")
        .replace(':', "=")
        .contains("providers.docker.exposedbydefault=false");
    // Every label of the file, by lower-case key: middlewares are shared by name.
    let split = |l: &'_ String| -> (String, String) {
        let (k, v) = l.split_once('=').unwrap_or((l, ""));
        (k.trim().to_lowercase(), v.trim().to_string())
    };
    let all: BTreeMap<String, String> = services
        .iter()
        .flat_map(|s| s.labels.iter().map(split))
        .collect();
    // What a middleware does to the path: the prefixes it strips, or that it changes
    // the path in a way that is not read. None: it leaves the path alone.
    let middleware = |m: &str| -> Option<Result<Vec<String>, ()>> {
        let m = m.trim().to_lowercase();
        let m = match m.split_once('@') {
            Some((n, "docker")) => n.to_string(),
            Some(_) => return Some(Err(())),
            None => m,
        };
        let prefix = format!("traefik.http.middlewares.{m}.");
        let mut found = false;
        let mut strips: Option<Vec<String>> = None;
        for (k, v) in all
            .range(prefix.clone()..)
            .take_while(|(k, _)| k.starts_with(&prefix))
        {
            found = true;
            let kind = k[prefix.len()..].split('.').next().unwrap_or_default();
            match kind {
                "stripprefix" if k.ends_with(".prefixes") => {
                    strips = Some(v.split(',').map(|p| p.trim().to_string()).collect());
                }
                "stripprefix" => {}
                "stripprefixregex" | "replacepath" | "replacepathregex" | "addprefix"
                | "plugin" => return Some(Err(())),
                _ => {}
            }
        }
        if !found {
            return Some(Err(()));
        }
        strips.map(Ok)
    };
    let mut rules: Vec<Rule> = Vec::new();
    for svc in services.iter().filter(|s| s.name != name) {
        let labels: BTreeMap<String, String> = svc.labels.iter().map(split).collect();
        let enabled = labels
            .get("traefik.enable")
            .map(|v| v.eq_ignore_ascii_case("true"));
        if enabled == Some(false) || (!exposed_by_default && enabled != Some(true)) {
            continue;
        }
        let target = Target::Services(vec![svc.name.to_string()]);
        let anything = |label: String| Rule {
            host: None,
            label,
            path: "/".to_string(),
            exact: false,
            target: target.clone(),
            strip: false,
            opaque: true,
        };
        if labels
            .keys()
            .any(|k| k.starts_with("traefik.tcp.") || k.starts_with("traefik.udp."))
        {
            rules.push(anything(format!("a TCP or UDP router of {}", svc.name)));
        }
        let routers: std::collections::BTreeSet<&str> = labels
            .keys()
            .filter_map(|k| k.strip_prefix("traefik.http.routers."))
            .filter_map(|k| k.split('.').next())
            .collect();
        if routers.is_empty() {
            // The default rule, `Host(`<container>`)`: every path of the container.
            if exposed_by_default || enabled == Some(true) {
                rules.push(Rule {
                    host: Some(svc.name.to_lowercase()),
                    label: format!("the default router of {}", svc.name),
                    path: "/".to_string(),
                    exact: false,
                    target: target.clone(),
                    strip: false,
                    opaque: false,
                });
            }
            continue;
        }
        for r in routers {
            let prop = |p: &str| labels.get(&format!("traefik.http.routers.{r}.{p}"));
            let Some(rule) = prop("rule") else {
                rules.push(anything(format!("router {r} (no rule on its labels)")));
                continue;
            };
            // The service it sends to: the container's own, unless it names another.
            let own_service = match prop("service") {
                None => true,
                Some(s) => {
                    let s = s.to_lowercase();
                    let s = s.strip_suffix("@docker").unwrap_or(&s);
                    labels
                        .keys()
                        .any(|k| k.starts_with(&format!("traefik.http.services.{s}.")))
                }
            };
            if !own_service {
                if prop("service").is_some_and(|s| s.to_lowercase().ends_with("@internal")) {
                    continue;
                }
                rules.push(Rule {
                    target: Target::Unresolved,
                    ..anything(format!(
                        "{rule} (router {r}, to a service that is not its container's)"
                    ))
                });
                continue;
            }
            let mut strips: Vec<String> = Vec::new();
            let mut rewrites = false;
            for m in prop("middlewares").into_iter().flat_map(|m| m.split(',')) {
                match middleware(m) {
                    Some(Ok(prefixes)) => strips.extend(prefixes),
                    Some(Err(())) => rewrites = true,
                    None => {}
                }
            }
            let Some(alternatives) = traefik_rule(rule) else {
                rules.push(anything(rule.clone()));
                continue;
            };
            for a in alternatives {
                let (path, exact) = a.path.unwrap_or(("/".to_string(), false));
                // A prefix is stripped only from a path that starts with it: the
                // rule's own prefix, or it is not followed.
                let strip = strips.iter().any(|p| *p == path || format!("{p}/") == path);
                rules.push(Rule {
                    host: a.host,
                    label: rule.clone(),
                    path,
                    exact,
                    target: target.clone(),
                    strip: strip && !exact,
                    opaque: a.conditional || rewrites || (!strips.is_empty() && (!strip || exact)),
                });
            }
        }
    }
    Gateway::of_rules(name, vec![file.to_string()], "router", rules, unread)
}

// ---------- Caddy ----------

#[derive(Debug, Clone, PartialEq, Eq)]
struct Directive {
    name: String,
    args: Vec<String>,
    block: Option<Vec<Directive>>,
    line: u32,
}

/// The directives of a Caddyfile: a line is a directive and its arguments, a `{` at
/// the end of a line opens its block, a `}` alone closes it.
fn caddyfile(text: &str) -> Result<Vec<Directive>, String> {
    // The words of each line.
    let mut lines: Vec<(u32, Vec<String>)> = Vec::new();
    for (n, raw) in text.lines().enumerate() {
        let c: Vec<char> = raw.chars().collect();
        let mut words = Vec::new();
        let mut i = 0;
        while i < c.len() {
            match c[i] {
                x if x.is_whitespace() => i += 1,
                '#' => break,
                q @ ('"' | '`') => {
                    let end = (i + 1..c.len())
                        .find(|j| c[*j] == q)
                        .ok_or_else(|| format!("line {}: quote not closed", n + 1))?;
                    words.push(c[i + 1..end].iter().collect::<String>());
                    i = end + 1;
                }
                _ => {
                    let end = (i..c.len())
                        .find(|j| c[*j].is_whitespace())
                        .unwrap_or(c.len());
                    words.push(c[i..end].iter().collect());
                    i = end;
                }
            }
        }
        if words.iter().any(|w| w.chars().count() > MAX_WORD) {
            return Err(format!("line {}: not a Caddyfile Drift reads", n + 1));
        }
        if !words.is_empty() {
            lines.push((n as u32 + 1, words));
        }
    }
    fn block(
        lines: &[(u32, Vec<String>)],
        i: &mut usize,
        depth: usize,
    ) -> Result<Vec<Directive>, String> {
        let mut out = Vec::new();
        while let Some((line, words)) = lines.get(*i) {
            *i += 1;
            if words.len() == 1 && words[0] == "}" {
                return if depth > 0 {
                    Ok(out)
                } else {
                    Err(format!("line {line}: a `}}` that closes nothing"))
                };
            }
            let mut words = words.clone();
            let opens = words.last().is_some_and(|w| w == "{");
            if opens {
                words.pop();
                if depth >= MAX_DEPTH {
                    return Err(format!(
                        "line {line}: not a Caddyfile Drift reads (blocks nested more than {MAX_DEPTH} deep)"
                    ));
                }
            }
            if words.iter().any(|w| w == "{" || w == "}") {
                return Err(format!("line {line}: not a Caddyfile Drift reads"));
            }
            let body = if opens {
                Some(block(lines, i, depth + 1)?)
            } else {
                None
            };
            let mut words = words.into_iter();
            out.push(Directive {
                name: words.next().unwrap_or_default(),
                args: words.collect(),
                block: body,
                line: *line,
            });
        }
        if depth > 0 {
            return Err("a block is not closed".to_string());
        }
        Ok(out)
    }
    block(&lines, &mut 0, 0)
}

/// What a path matcher matches: (path, exact) alternatives, and whether it holds a
/// condition that is not evaluated. None: every path.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Matcher {
    paths: Vec<(String, bool)>,
    opaque: bool,
}

/// `/api/*` -> the prefix `/api/`; `/api*` -> the prefix `/api`; `/api` -> exactly
/// that; `*` -> everything. A wildcard anywhere else is not evaluated.
fn path_matcher(token: &str) -> Matcher {
    let (body, prefix) = match token.strip_suffix('*') {
        Some(b) => (b, true),
        None => (token, false),
    };
    if body.contains(['*', '{', '%']) {
        return Matcher {
            paths: vec![("/".to_string(), false)],
            opaque: true,
        };
    }
    Matcher {
        paths: vec![(
            if body.is_empty() {
                "/".into()
            } else {
                body.to_string()
            },
            !prefix,
        )],
        opaque: false,
    }
}

/// Directives that cannot change which upstream a request reaches or the path it is
/// passed on with.
const CADDY_INERT: &[&str] = &[
    "tls",
    "log",
    "log_skip",
    "skip_log",
    "encode",
    "header",
    "request_header",
    "respond",
    "redir",
    "file_server",
    "root",
    "basicauth",
    "basic_auth",
    "forward_auth",
    "request_body",
    "templates",
    "bind",
    "abort",
    "error",
    "tracing",
    "vars",
    "metrics",
    "push",
];

struct CaddyReader<'a> {
    file: &'a str,
    resolve: &'a dyn Fn(&str) -> Target,
    rules: Vec<Rule>,
    unread: Vec<String>,
}

impl CaddyReader<'_> {
    fn unread(&mut self, d: &Directive, why: &str) {
        self.unread
            .push(format!("{}:{}: `{}` {why}", self.file, d.line, d.name));
    }

    /// The directive `d` answers what `matcher` matches by itself: a rule to nowhere,
    /// so that no other rule is taken to carry those paths.
    fn answers(&mut self, host: &Option<String>, d: &Directive, matcher: &Matcher) {
        for (path, exact) in &matcher.paths {
            self.rules.push(Rule {
                host: host.clone(),
                label: format!("{} {path}", d.name),
                path: path.clone(),
                exact: *exact,
                target: Target::Nowhere,
                strip: false,
                opaque: false,
            });
        }
    }

    /// The directives of a site or of a `handle` block. `outer` is the matcher of the
    /// blocks around them, `strip` whether the matched prefix is taken off
    /// (`handle_path`), `opaque` whether something around rewrites the path.
    fn block(
        &mut self,
        host: &Option<String>,
        ds: &[Directive],
        outer: Option<&Matcher>,
        strip: bool,
        opaque: bool,
        depth: usize,
    ) {
        // The named matchers of this block, and what changes the path in it.
        let mut named: BTreeMap<&str, Matcher> = BTreeMap::new();
        let (mut strip, mut opaque) = (strip, opaque);
        // The prefix a `uri strip_prefix` takes off: only a path that starts with it.
        let mut stripped: Option<&str> = None;
        for d in ds {
            if let Some(name) = d.name.strip_prefix('@') {
                let mut m = Matcher::default();
                let lines: Vec<(&str, &[String])> = match &d.block {
                    Some(b) => b
                        .iter()
                        .map(|x| (x.name.as_str(), x.args.as_slice()))
                        .collect(),
                    None => d
                        .args
                        .split_first()
                        .map(|(k, rest)| (k.as_str(), rest))
                        .into_iter()
                        .collect(),
                };
                for (kind, args) in lines {
                    if kind == "path" {
                        for a in args {
                            let p = path_matcher(a);
                            m.opaque |= p.opaque;
                            m.paths.extend(p.paths);
                        }
                    } else {
                        m.opaque = true;
                    }
                }
                if m.paths.is_empty() {
                    m.paths.push(("/".to_string(), false));
                }
                named.insert(name, m);
            }
            match d.name.as_str() {
                "uri"
                    if d.args.first().is_some_and(|a| a == "strip_prefix") && d.args.len() == 2 =>
                {
                    strip = true;
                    stripped = Some(d.args[1].as_str());
                }
                "uri" | "rewrite" | "try_files" | "method" | "php_fastcgi" => opaque = true,
                _ => {}
            }
        }
        for d in ds {
            // The directive's own matcher, when its first argument is one.
            let own: Option<Matcher> = match d.args.first().map(String::as_str) {
                Some("*") => Some(Matcher {
                    paths: vec![("/".to_string(), false)],
                    opaque: false,
                }),
                Some(a) if a.starts_with('/') => Some(path_matcher(a)),
                Some(a) if a.starts_with('@') => {
                    Some(named.get(&a[1..]).cloned().unwrap_or(Matcher {
                        paths: vec![("/".to_string(), false)],
                        opaque: true,
                    }))
                }
                _ => None,
            };
            let rest = &d.args[usize::from(own.is_some())..];
            // Within another matcher: both must hold, which is not worked out.
            let matcher = match (outer, &own) {
                (Some(o), Some(i)) => Matcher {
                    paths: if strip {
                        o.paths.clone()
                    } else {
                        i.paths.clone()
                    },
                    opaque: true,
                },
                (Some(m), None) | (None, Some(m)) => m.clone(),
                (None, None) => Matcher {
                    paths: vec![("/".to_string(), false)],
                    opaque: false,
                },
            };
            match d.name.as_str() {
                n if n.starts_with('@') => {}
                "reverse_proxy" => {
                    let mut upstreams: Vec<&str> = rest.iter().map(String::as_str).collect();
                    let mut rewrites = opaque;
                    for sub in d.block.iter().flatten() {
                        match sub.name.as_str() {
                            "to" => upstreams.extend(sub.args.iter().map(String::as_str)),
                            "rewrite" | "method" | "handle_response" | "dynamic" => rewrites = true,
                            _ => {}
                        }
                    }
                    let mut services: Vec<String> = Vec::new();
                    let mut unresolved = upstreams.is_empty();
                    for u in upstreams {
                        let u = u.split("://").last().unwrap_or(u);
                        let host_port = u.split('/').next().unwrap_or(u);
                        let name = if host_port.starts_with('[') {
                            host_port
                        } else {
                            host_port.split(':').next().unwrap_or(host_port)
                        };
                        match (self.resolve)(name) {
                            _ if u.contains(['{', '$']) || name.is_empty() => unresolved = true,
                            Target::Services(s) => services.extend(s),
                            Target::Nowhere => {}
                            Target::Unresolved => unresolved = true,
                        }
                    }
                    services.sort();
                    services.dedup();
                    let target = if unresolved {
                        self.unread(d, "names an upstream Drift cannot resolve");
                        Target::Unresolved
                    } else if services.is_empty() {
                        Target::Nowhere
                    } else {
                        Target::Services(services)
                    };
                    for (path, exact) in &matcher.paths {
                        // The prefix taken off is the matched one, or it is not followed.
                        let other = stripped.is_some_and(|p| p != path && format!("{p}/") != *path);
                        self.rules.push(Rule {
                            host: host.clone(),
                            label: format!(
                                "{} {}",
                                d.name,
                                if *exact {
                                    path.clone()
                                } else {
                                    format!("{path}*")
                                }
                            ),
                            path: path.clone(),
                            exact: *exact,
                            target: target.clone(),
                            strip: strip && !exact,
                            opaque: matcher.opaque || rewrites || (strip && (*exact || other)),
                        });
                    }
                }
                "handle" | "route" | "handle_path" => {
                    let Some(body) = &d.block else {
                        self.unread(d, "has no block");
                        continue;
                    };
                    if depth >= MAX_DEPTH {
                        self.unread(d, "is nested deeper than Drift reads");
                        continue;
                    }
                    let path = d.name == "handle_path";
                    let before = self.rules.len();
                    self.block(
                        host,
                        body,
                        (outer.is_some() || own.is_some()).then_some(&matcher),
                        strip || path,
                        opaque || (path && own.is_none()),
                        depth + 1,
                    );
                    // A block that proxies nothing answers by itself: what it matches
                    // does not go on to the directives after it.
                    if self.rules.len() == before {
                        self.answers(host, d, &matcher);
                    }
                }
                // These answer before `reverse_proxy` is reached, in Caddy's order.
                "respond" | "redir" | "abort" | "error" => {
                    let m = own.clone().unwrap_or(Matcher {
                        paths: vec![("/".to_string(), false)],
                        opaque: false,
                    });
                    let m = match outer {
                        Some(o) => o.clone(),
                        None => m,
                    };
                    self.answers(host, d, &m);
                }
                "uri" | "rewrite" | "try_files" | "method" => {}
                "import" | "invoke" => self.unread(d, "is not followed"),
                n if CADDY_INERT.contains(&n) => {}
                _ => self.unread(d, "is not read"),
            }
        }
    }
}

/// The Caddy gateway `name`, read from its Caddyfiles `files` (repo-relative path,
/// text): site blocks, `reverse_proxy` with a path matcher (`/api/*`, a named matcher
/// that is only `path`), `handle`, `handle_path`, `route` and `uri strip_prefix`.
/// `resolve` says what an upstream host is. An error is a file that is not a
/// Caddyfile Drift reads.
///
/// Not evaluated: a matcher with a wildcard inside it or a condition other than
/// `path`, a matcher inside another, `rewrite`, `try_files`, `uri` other than
/// `strip_prefix`. Not read, so that nothing is internal: `import`, `invoke`, a
/// directive that is not on the list of those that route nothing, an upstream that
/// is a placeholder.
pub fn caddy(
    name: &str,
    files: &[(String, String)],
    resolve: &dyn Fn(&str) -> Target,
) -> Result<Gateway, String> {
    let mut rules = Vec::new();
    let mut unread = Vec::new();
    for (file, text) in files {
        let ds = caddyfile(text).map_err(|e| format!("{file}: {e}"))?;
        let mut reader = CaddyReader {
            file,
            resolve,
            rules: Vec::new(),
            unread: Vec::new(),
        };
        // Global options and snippets first; a file whose first site has no block is
        // one site, its address on the first line.
        let sites: Vec<&Directive> = ds
            .iter()
            .filter(|d| !d.name.is_empty() && !d.name.starts_with('('))
            .collect();
        for d in ds.iter().filter(|d| d.name.starts_with('(')) {
            reader.unread(d, "is a snippet, and what imports it is not followed");
        }
        if sites.iter().all(|d| d.block.is_some()) {
            for site in sites {
                // One site for each address: a request names one host.
                let mut addresses: Vec<String> = std::iter::once(&site.name)
                    .chain(&site.args)
                    .map(|a| a.trim_end_matches(',').to_lowercase())
                    .filter(|a| !a.is_empty())
                    .collect();
                addresses.sort();
                let host = Some(addresses.join(", "));
                reader.block(
                    &host,
                    site.block.as_deref().unwrap_or_default(),
                    None,
                    false,
                    false,
                    0,
                );
            }
        } else if let Some(first) = ds
            .iter()
            .position(|d| !d.name.is_empty() && !d.name.starts_with('('))
        {
            let host = Some(ds[first].name.to_lowercase());
            reader.block(&host, &ds[first + 1..], None, false, false, 0);
        }
        rules.extend(reader.rules);
        unread.extend(reader.unread);
    }
    Ok(Gateway::of_rules(
        name,
        files.iter().map(|(f, _)| f.clone()).collect(),
        "matcher",
        rules,
        unread,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::Route;

    fn route(t: &str) -> Route {
        Route::parse(t).unwrap()
    }

    fn labelled<'a>(name: &'a str, labels: &'a [String]) -> Labelled<'a> {
        Labelled { name, labels }
    }

    fn labels(ls: &[&str]) -> Vec<String> {
        ls.iter().map(|l| l.to_string()).collect()
    }

    const OFF: &str = "command --providers.docker=true --providers.docker.exposedbydefault=false";

    #[test]
    fn traefik_rules_are_read_into_alternatives() {
        let alt = |host: Option<&str>, path: Option<(&str, bool)>, conditional: bool| Alternative {
            host: host.map(str::to_string),
            path: path.map(|(p, e)| (p.to_string(), e)),
            conditional,
        };
        assert_eq!(
            traefik_rule("Host(`a.example.com`) && PathPrefix(`/api`)"),
            Some(vec![alt(
                Some("a.example.com"),
                Some(("/api", false)),
                false
            )])
        );
        assert_eq!(
            traefik_rule("Host(`a`) && (PathPrefix(`/x`) || Path(`/y`))"),
            Some(vec![
                alt(Some("a"), Some(("/x", false)), false),
                alt(Some("a"), Some(("/y", true)), false),
            ])
        );
        assert_eq!(
            traefik_rule("PathPrefix(`/a`, `/b`) && Method(`GET`)"),
            Some(vec![
                alt(None, Some(("/a", false)), true),
                alt(None, Some(("/b", false)), true),
            ])
        );
        // Outside the subset: a negation, an unknown matcher, text that is no rule.
        for rule in ["!Host(`a`)", "Custom(`x`)", "Host(`a`) &&", "Host(a)", ""] {
            assert_eq!(traefik_rule(rule), None, "{rule}");
        }
        // Bounded: nesting without end, alternatives without end.
        assert_eq!(
            traefik_rule(&format!("{}Host(`a`)", "(".repeat(5000))),
            None
        );
        let many = ["Path(`/a`, `/b`, `/c`)"; 12].join(" && ");
        assert_eq!(traefik_rule(&many), None);
    }

    #[test]
    fn traefik_routers_decide_each_route() {
        let api = labels(&[
            "traefik.enable=true",
            "traefik.http.routers.api.rule=Host(`app.example.com`) && PathPrefix(`/v1`)",
            "traefik.http.routers.pub.rule=PathPrefix(`/public`)",
            "traefik.http.routers.pub.middlewares=strip@docker,gzip",
            "traefik.http.middlewares.strip.stripprefix.prefixes=/public",
            "traefik.http.middlewares.gzip.compress=true",
        ]);
        let worker = labels(&[]);
        let web = labels(&[
            "traefik.enable=true",
            "traefik.http.routers.web.rule=Host(`app.example.com`)",
        ]);
        let g = traefik(
            "edge",
            "compose.yaml",
            OFF,
            &[],
            true,
            &[
                labelled("api", &api),
                labelled("worker", &worker),
                labelled("web", &web),
            ],
        );
        assert!(g.unread.is_empty(), "{:?}", g.unread);
        // `/public` is stripped: the service sees `/health`, and any route of it.
        assert_eq!(
            g.carries("api", &route("/health")),
            Some("PathPrefix(`/public`)")
        );
        assert!(g.may_carry("api", &route("/internal/x")).is_some());
        // Not enabled, exposure by default turned off: no router at all.
        assert!(g.locations_to("worker").is_empty());
        assert_eq!(g.may_carry("worker", &route("/anything")), None);

        // `/v1` on the host is matched by `web`'s rule too, and which wins is a
        // priority Drift does not model: not proved, and not internal.
        let g = traefik(
            "edge",
            "compose.yaml",
            OFF,
            &[],
            true,
            &[labelled("api", &api[..2]), labelled("web", &web)],
        );
        assert_eq!(g.carries("api", &route("/v1/rules")), None);
        assert!(g.may_carry("api", &route("/v1/rules")).is_some());
        assert_eq!(g.carries("web", &route("/v1/rules")), None);
        // What only `web`'s rule matches is `web`'s.
        assert_eq!(
            g.carries("web", &route("/about")),
            Some("Host(`app.example.com`)")
        );
        assert_eq!(g.may_carry("api", &route("/internal/x")), None);

        // With nothing else on the host, the prefix carries its routes and no others.
        let g = traefik(
            "edge",
            "compose.yaml",
            OFF,
            &[],
            true,
            &[labelled("api", &api[..2])],
        );
        assert_eq!(
            g.carries("api", &route("/v1/rules/{id}")),
            Some("Host(`app.example.com`) && PathPrefix(`/v1`)")
        );
        assert_eq!(g.carries("api", &route("/internal/x")), None);
        assert_eq!(g.may_carry("api", &route("/internal/x")), None);
    }

    #[test]
    fn what_traefik_may_route_beyond_its_labels_is_said() {
        let bare = labels(&[]);
        // Exposed by default: a container with no label has a router for every path.
        let g = traefik(
            "edge",
            "compose.yaml",
            "command --providers.docker",
            &[],
            true,
            &[labelled("api", &bare)],
        );
        assert_eq!(
            g.carries("api", &route("/internal/x")),
            Some("the default router of api")
        );
        let off = labels(&["traefik.enable=false"]);
        let g = traefik(
            "edge",
            "compose.yaml",
            "",
            &[],
            true,
            &[labelled("api", &off)],
        );
        assert!(g.locations_to("api").is_empty());
        // A rule or a middleware that is not evaluated may carry anything.
        for extra in [
            "traefik.http.routers.api.rule=PathPrefix(`/v1`) && Method(`GET`)",
            "traefik.http.routers.api.rule=PathRegexp(`^/v[0-9]+/`)",
            "traefik.http.routers.api.rule=!PathPrefix(`/internal`)",
            "traefik.http.routers.api.rule=PathPrefix(`/v1`)\ntraefik.http.routers.api.middlewares=rw\ntraefik.http.middlewares.rw.replacepathregex.regex=^/v1/(.*)",
            "traefik.http.routers.api.rule=PathPrefix(`/v1`)\ntraefik.http.routers.api.middlewares=auth@file",
            "traefik.http.routers.api.rule=PathPrefix(`/v1`)\ntraefik.http.routers.api.middlewares=s\ntraefik.http.middlewares.s.stripprefix.prefixes=/other",
            "traefik.http.routers.api.rule=PathPrefix(`/v1`)\ntraefik.tcp.routers.raw.rule=HostSNI(`*`)",
        ] {
            let ls: Vec<String> = std::iter::once("traefik.enable=true")
                .chain(extra.lines())
                .map(str::to_string)
                .collect();
            let g = traefik(
                "edge",
                "compose.yaml",
                OFF,
                &[],
                true,
                &[labelled("api", &ls)],
            );
            assert_eq!(g.carries("api", &route("/internal/x")), None, "{extra}");
            assert!(
                g.may_carry("api", &route("/internal/x")).is_some(),
                "{extra}"
            );
        }
        // What is not on the labels: a file provider, a configuration file, an image.
        let g = traefik(
            "edge",
            "compose.yaml",
            "command --providers.docker --providers.file.directory=/etc/traefik/dynamic",
            &["/etc/traefik/traefik.yml".to_string()],
            false,
            &[],
        );
        assert_eq!(
            g.unread,
            [
                "gateway edge: what its image holds is not read",
                "gateway edge: its configuration /etc/traefik/traefik.yml is not read",
                "gateway edge: its `file` provider is not read",
            ]
        );
    }

    fn caddy_of(text: &str) -> Gateway {
        let resolve = |h: &str| match h {
            "api" | "web" => Target::Services(vec![h.to_string()]),
            _ => Target::Unresolved,
        };
        caddy(
            "edge",
            &[("Caddyfile".to_string(), text.to_string())],
            &resolve,
        )
        .unwrap()
    }

    #[test]
    fn caddy_matchers_decide_each_route() {
        let g = caddy_of(
            "{\n\temail ops@example.com\n}\n\nexample.com {\n\tencode gzip\n\treverse_proxy /v1/* api:8000\n\thandle_path /public/* {\n\t\treverse_proxy http://api:8000\n\t}\n\thandle /admin {\n\t\trespond 403\n\t}\n}\n",
        );
        assert!(g.unread.is_empty(), "{:?}", g.unread);
        assert_eq!(
            g.carries("api", &route("/v1/rules/{id}")),
            Some("reverse_proxy /v1/*")
        );
        // `handle_path` takes the prefix off: `/public/health` is `/health` there.
        assert_eq!(
            g.carries("api", &route("/health")),
            Some("reverse_proxy /public/*")
        );
        // Every route can be reached through the stripped prefix: never internal.
        assert!(g.may_carry("api", &route("/internal/x")).is_some());

        let g = caddy_of(
            "example.com {\n\treverse_proxy /v1/* api:8000\n\treverse_proxy web:3000\n}\n",
        );
        // The catch-all matches `/v1/` too, and the order is not modelled.
        assert_eq!(g.carries("api", &route("/v1/rules")), None);
        assert!(g.may_carry("api", &route("/v1/rules")).is_some());
        assert_eq!(g.may_carry("api", &route("/internal/x")), None);
        assert_eq!(
            g.carries("web", &route("/internal/x")),
            Some("reverse_proxy /*")
        );

        // A single site with no braces; a named matcher of paths; `uri strip_prefix`.
        let g = caddy_of(":80\n@api path /v1/* /v2/*\nreverse_proxy @api api:8000\n");
        assert_eq!(
            g.carries("api", &route("/v2/rules")),
            Some("reverse_proxy /v2/*")
        );
        assert_eq!(g.may_carry("api", &route("/internal/x")), None);
        let g = caddy_of(
            ":80 {\n\thandle /api/* {\n\t\turi strip_prefix /api\n\t\treverse_proxy api:8000\n\t}\n}\n",
        );
        assert_eq!(
            g.carries("api", &route("/health")),
            Some("reverse_proxy /api/*")
        );
    }

    #[test]
    fn what_caddy_may_route_beyond_what_is_read_is_said() {
        // Not evaluated: may carry anything, proves nothing.
        for site in [
            "\t@get {\n\t\tmethod GET\n\t\tpath /v1/*\n\t}\n\treverse_proxy @get api:8000\n",
            "\t@ws header Upgrade websocket\n\treverse_proxy @ws api:8000\n",
            "\treverse_proxy /v1/*/x api:8000\n",
            "\thandle /v1/* {\n\t\trewrite * /internal{uri}\n\t\treverse_proxy api:8000\n\t}\n",
            "\thandle /v1/* {\n\t\treverse_proxy /v1/a/* api:8000\n\t}\n",
        ] {
            let g = caddy_of(&format!(":80 {{\n{site}}}\n"));
            assert_eq!(g.carries("api", &route("/v1/rules")), None, "{site}");
            assert!(
                g.may_carry("api", &route("/internal/x")).is_some(),
                "{site}"
            );
        }
        // Not read: recorded, so nothing is internal.
        for (site, why) in [
            ("\timport common\n", "Caddyfile:2: `import` is not followed"),
            ("\tmy_plugin on\n", "Caddyfile:2: `my_plugin` is not read"),
            (
                "\treverse_proxy {$BACKEND}\n",
                "Caddyfile:2: `reverse_proxy` names an upstream Drift cannot resolve",
            ),
        ] {
            let g = caddy_of(&format!(":80 {{\n{site}}}\n"));
            assert_eq!(g.unread, [why], "{site}");
        }
        // Not a Caddyfile, or one written to break the reader.
        let resolve = |_: &str| Target::Nowhere;
        for text in [
            ":80 {\n".repeat(60_000),
            "}\n".to_string(),
            format!(
                ":80 {{\n\treverse_proxy /{} api:1\n}}\n",
                "a".repeat(MAX_WORD + 1)
            ),
            ":80 {\n\trespond \"unclosed\n}\n".to_string(),
        ] {
            assert!(caddy("edge", &[("Caddyfile".to_string(), text)], &resolve).is_err());
        }
    }
}
