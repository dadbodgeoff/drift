//! What a reverse-proxy gateway routes, read from its configuration, so that the
//! exposure of a service behind it is decided route by route and not for the service
//! as a whole ([`crate::security::Boundaries`]).
//!
//! nginx only. Read: `server`, `location` (prefix, `^~`, `=`), `proxy_pass` (its host,
//! through an `upstream` block too, and its URI part), `rewrite ... break` (a small
//! subset of regular expressions, see [`Pattern`]), `return`, and `try_files` /
//! `error_page` that fall back to a fixed path. A regular-expression location is never
//! evaluated: it may route anything. A host that cannot be told (a variable, an
//! address) and everything that is not on the list of directives that cannot change
//! where a request goes ([`inert`]) are recorded in [`Gateway::unread`], and then no
//! route is said to be internal.
//!
//! Two questions are asked of a route, and they err in opposite directions:
//!
//! - [`Gateway::carries`] proves a route public: it builds a request path, picks the
//!   location nginx would (an exact match, else the longest prefix), applies what the
//!   location does to the path and checks the result is the route.
//! - [`Gateway::may_carry`] is what stands between a route and "internal": it holds
//!   whenever any location to the service could produce a path the route answers,
//!   whichever location nginx would pick, comparing without regard to case.

use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};

/// How many characters of a route template are read ([`Route::parse`]): what follows
/// is taken as anything.
const MAX_TEMPLATE: usize = 256;
/// The longest word of a configuration file that is read ([`parse`]).
const MAX_WORD: usize = 512;
/// How many tokens of a `rewrite` expression are evaluated ([`Pattern::parse`]).
const MAX_PATTERN: usize = 64;
/// How many steps of comparing routes with locations one run takes ([`refill`]).
const BUDGET: u64 = 20_000_000;
/// How many pairs of a route and a location one run compares: with thousands of
/// each, the pairs alone are the cost, whatever each comparison takes.
const PAIRS: u64 = 2_000_000;

thread_local! {
    /// The steps left to this thread's run.
    static STEPS: Cell<u64> = const { Cell::new(BUDGET) };
    /// The pairs left to it.
    static LEFT: Cell<u64> = const { Cell::new(PAIRS) };
}

/// Takes one pair of a route and a location; false when none is left, and then
/// the run counts as spent.
fn pair() -> bool {
    LEFT.with(|s| match s.get() {
        0 => false,
        n => {
            s.set(n - 1);
            true
        }
    })
}

/// Starts a run: comparing routes with locations is bounded for each one, so a
/// repository written to make it slow costs a fixed amount of work and no more. When
/// the steps are used up nothing more is proved to be carried ([`Gateway::carries`])
/// and everything may be ([`Gateway::may_carry`]): unknown, never internal.
pub fn refill() {
    STEPS.set(BUDGET);
    LEFT.set(PAIRS);
}

/// Takes one step; false when none is left.
fn step() -> bool {
    STEPS.with(|s| match s.get() {
        0 => false,
        n => {
            s.set(n - 1);
            true
        }
    })
}

fn spent() -> bool {
    STEPS.get() == 0 || LEFT.get() == 0
}

/// What a host named in the configuration is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// Not a service of the compose file: the request goes elsewhere, or nowhere.
    Nowhere,
    /// Compose services (several when they sit behind one `upstream`).
    Services(Vec<String>),
    /// Cannot be told (a variable, an address): it may be any service.
    Unresolved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Match {
    Prefix,
    Exact,
    Regex,
}

/// The `server` of a rule that names no host: it competes with the rules of every host.
const ANY_SERVER: usize = usize::MAX;

/// How a gateway chooses between the rules that match one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pick {
    /// nginx: an exact location, else the longest matching prefix.
    Nginx,
    /// By priorities Drift does not model (Traefik's rule length, Caddy's directive
    /// order): a request is known to go where a rule sends it only when every rule
    /// that matches it sends it to the same place.
    Agreed,
    /// In the order written, the first that matches wins (HAProxy's `use_backend`,
    /// Envoy's routes, httpd's `ProxyPass`): a request is known to go where a rule
    /// sends it when every rule before it that matches it sends it to the same place.
    First,
}

/// One rule of a gateway that is not nginx ([`Gateway::of_rules`]): a Traefik router,
/// a Caddy matcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    /// The host or site it is for; none when it is for any.
    pub host: Option<String>,
    /// As written, for messages: ``PathPrefix(`/api`)``, `handle_path /api/*`.
    pub label: String,
    /// The path it matches: a prefix, or exactly (`exact`). `/` as a prefix is every path.
    pub path: String,
    pub exact: bool,
    pub target: Target,
    /// The matched prefix is taken off before the request is passed on.
    pub strip: bool,
    /// Why what it matches or passes on is not read (a regular expression, a header
    /// condition, a middleware that rewrites the path): it may carry anything, and
    /// proves nothing.
    pub opaque: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Location {
    /// Index of its `server` block: nginx picks among one server's locations.
    server: usize,
    kind: Match,
    /// As written, for messages: `/v1/rules`, `= /health`, `~ ^/api/`.
    label: String,
    path: String,
    target: Target,
    /// The URI part of `proxy_pass`: it replaces the part of the path the location matched.
    uri: Option<String>,
    rewrites: Vec<Rewrite>,
    /// What is passed on starts with a `/`, added when taking the prefix off left none
    /// (a stripped prefix, [`Rule::strip`]).
    slash: bool,
    /// nginx `^~`: a request this prefix is the longest match of is not looked up
    /// among the regular-expression locations.
    stop: bool,
    /// A regular-expression location that is a plain anchored prefix (`~ ^/api/`),
    /// which `path` then holds: evaluated, with or without regard to case (`~*`).
    /// None for any other regular expression, which is not evaluated.
    literal: Option<bool>,
}

impl Location {
    fn proxies_to(&self, service: &str) -> bool {
        matches!(&self.target, Target::Services(s) if s.iter().any(|x| x == service))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Flag {
    /// The rewritten path is what the service is sent.
    Break,
    /// The client is sent elsewhere: nothing reaches the service.
    Redirect,
    /// `last` or no flag: nginx looks the location up again. Not followed.
    Again,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Rewrite {
    /// None when the expression is outside what [`Pattern`] reads.
    pattern: Option<Pattern>,
    /// None when the replacement names a variable other than a capture.
    pieces: Option<Vec<Piece>>,
    /// The literal start of the replacement: every path it produces starts with it.
    head: String,
    flag: Flag,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Piece {
    Lit(String),
    Cap(usize),
}

/// One gateway's routing, as far as it is read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gateway {
    /// The compose service that runs it.
    pub name: String,
    /// Repo-relative configuration files read.
    pub files: Vec<String>,
    locations: Vec<Location>,
    /// What was not read (`file:line: ...`): while any is listed, the gateway may route
    /// what its locations do not show.
    pub unread: Vec<String>,
    pick: Pick,
    /// What one of its rules is called: `location`, `router`, `matcher`.
    pub noun: &'static str,
}

impl Gateway {
    /// Reads the configuration `files` (repo-relative path, text) of the gateway `name`:
    /// all of them, as nginx reads its main file and every file of `conf.d`, so an
    /// `include` of that directory adds nothing. `resolve` says what a host is. An
    /// error is a file that is not nginx configuration.
    pub fn read(
        name: &str,
        files: &[(String, String)],
        resolve: &dyn Fn(&str) -> Target,
    ) -> Result<Gateway, String> {
        let mut parsed = Vec::new();
        for (file, text) in files {
            parsed.push((file, parse(text).map_err(|e| format!("{file}: {e}"))?));
        }
        let mut upstreams: BTreeMap<String, Target> = BTreeMap::new();
        for (_, ds) in &parsed {
            collect_upstreams(ds, resolve, &mut upstreams);
        }
        let mut reader = Reader {
            gateway: Gateway {
                name: name.to_string(),
                files: files.iter().map(|(f, _)| f.clone()).collect(),
                locations: Vec::new(),
                unread: Vec::new(),
                pick: Pick::Nginx,
                noun: "location",
            },
            servers: 0,
            resolve,
            upstreams,
        };
        for (file, ds) in &parsed {
            reader.top(file, ds);
        }
        Ok(reader.gateway)
    }

    /// A gateway that is not nginx, from the rules read of it (`noun`: what one is
    /// called). Rules of one host compete with each other and with those of no host;
    /// which of several matching rules wins is not modelled, so a route is proved
    /// carried only where the matching rules agree ([`Pick::Agreed`]).
    pub fn of_rules(
        name: &str,
        files: Vec<String>,
        noun: &'static str,
        rules: Vec<Rule>,
        unread: Vec<String>,
    ) -> Gateway {
        let mut hosts: Vec<&str> = rules.iter().filter_map(|r| r.host.as_deref()).collect();
        hosts.sort_unstable();
        hosts.dedup();
        let locations = rules
            .iter()
            .map(|r| Location {
                server: match &r.host {
                    Some(h) => hosts.binary_search(&h.as_str()).unwrap_or(ANY_SERVER),
                    None => ANY_SERVER,
                },
                kind: match (r.opaque, r.exact) {
                    (true, _) => Match::Regex,
                    (false, true) => Match::Exact,
                    (false, false) => Match::Prefix,
                },
                label: r.label.clone(),
                path: r.path.clone(),
                target: r.target.clone(),
                uri: r.strip.then(String::new),
                rewrites: Vec::new(),
                slash: r.strip,
                stop: false,
                literal: None,
            })
            .collect();
        Gateway {
            name: name.to_string(),
            files,
            locations,
            unread,
            pick: Pick::Agreed,
            noun,
        }
    }

    /// The same gateway, its rules taken in the order written: the first that
    /// matches a request wins ([`Pick::First`]).
    pub fn first_match(mut self) -> Gateway {
        self.pick = Pick::First;
        self
    }

    /// `gateway edge (deploy/nginx.conf)`.
    pub fn title(&self) -> String {
        format!("gateway {} ({})", self.name, self.files.join(", "))
    }

    /// The locations that proxy to `service`, as written, in the order of the files.
    pub fn locations_to(&self, service: &str) -> Vec<&str> {
        self.to(service)
            .into_iter()
            .map(|i| self.locations[i].label.as_str())
            .collect()
    }

    fn to(&self, service: &str) -> Vec<usize> {
        (0..self.locations.len())
            .filter(|i| self.locations[*i].proxies_to(service))
            .collect()
    }

    /// The location that provably delivers `route` to `service`, as written: a request
    /// path exists that nginx gives to that location, and what the location makes of
    /// it is a path the route answers.
    pub fn carries(&self, service: &str, route: &Route) -> Option<&str> {
        self.to(service)
            .into_iter()
            .find(|i| self.delivers(*i, route))
            .map(|i| self.locations[i].label.as_str())
    }

    fn delivers(&self, i: usize, route: &Route) -> bool {
        if !pair() {
            return false;
        }
        let loc = &self.locations[i];
        route.exact
            && candidates(loc, route).iter().any(|e| {
                self.picks(i, e)
                    && matches!(deliver(loc, e), Delivered::Path(p) if route.matches(&p))
            })
    }

    /// Whether the request path `e` is known to be given to the location `i`.
    fn picks(&self, i: usize, e: &str) -> bool {
        let loc = &self.locations[i];
        match self.pick {
            Pick::Nginx => self.select(loc.server, e) == Some(i),
            Pick::Agreed | Pick::First => {
                // Under the first match, only the rules written before it compete.
                let rivals_of = match self.pick {
                    Pick::First => &self.locations[..i],
                    _ => &self.locations[..],
                };
                let matches = |l: &Location| match l.kind {
                    Match::Exact => l.path == e,
                    Match::Prefix => e.starts_with(&l.path),
                    Match::Regex => true,
                };
                let sent = |l: &Location| match deliver(l, e) {
                    Delivered::Path(p) => Some(p),
                    _ => None,
                };
                matches(loc)
                    && rivals_of.iter().all(|other| {
                        // A rule for a host competes with that host's and with those
                        // for any host. One for any host is asked with a host no
                        // other rule names, where only its like compete.
                        let rivals = other.server == loc.server || other.server == ANY_SERVER;
                        !rivals
                            || !matches(other)
                            || (other.kind != Match::Regex
                                && other.target == loc.target
                                && sent(other) == sent(loc))
                    })
            }
        }
    }

    /// The locations to `service` that deliver none of `routes`: the service answers
    /// there on a path that is not among them, so they are not all its paths.
    /// One directive read as several locations (an httpd `ProxyPass /v1` is the exact
    /// `/v1` and the prefix `/v1/`) is judged as one: it is unexplained only when none
    /// of its locations delivers a route.
    pub fn unexplained(&self, service: &str, routes: &[Route]) -> Vec<&str> {
        let to = self.to(service);
        let delivering = |i: usize| !spent() && routes.iter().any(|r| self.delivers(i, r));
        let explained: BTreeSet<&str> = to
            .iter()
            .filter(|i| delivering(**i))
            .map(|i| self.locations[*i].label.as_str())
            .collect();
        let mut found: Vec<&str> = to
            .into_iter()
            .filter(|i| {
                let l = &self.locations[*i];
                l.kind != Match::Regex || l.literal.is_some()
            })
            .map(|i| self.locations[i].label.as_str())
            .filter(|label| !spent() && !explained.contains(label))
            .collect();
        found.dedup();
        // Not all compared: nothing is known to deliver none ([`Gateway::may_carry`]
        // says that the run was too short).
        if spent() { Vec::new() } else { found }
    }

    /// Why the gateway may deliver `route` to `service` though no location provably
    /// does; none when no location to it, or to a host that cannot be told, can.
    pub fn may_carry(&self, service: &str, route: &Route) -> Option<String> {
        let to = |l: &Location| l.target == Target::Unresolved || l.proxies_to(service);
        let found = self.may_carry_through(service, route);
        found.or_else(|| {
            (spent() && self.locations.iter().any(to)).then(|| {
                "there are more routes and locations than Drift compares in one run".to_string()
            })
        })
    }

    fn may_carry_through(&self, service: &str, route: &Route) -> Option<String> {
        self.locations.iter().find_map(|l| {
            if !pair() {
                return None;
            }
            let unresolved = l.target == Target::Unresolved;
            if !(unresolved || l.proxies_to(service)) {
                return None;
            }
            let to = if unresolved {
                " proxies to a host Drift cannot resolve and"
            } else {
                ""
            };
            if l.kind == Match::Regex && l.literal.is_none() {
                return Some(match self.pick {
                    Pick::Nginx => format!(
                        "location {}{to} is a regular expression, which Drift does not evaluate",
                        l.label
                    ),
                    Pick::Agreed | Pick::First => {
                        format!("{} {}{to} is not one Drift evaluates", self.noun, l.label)
                    }
                });
            }
            let can = |p: &str| route.fit(p, true, true).is_some();
            let direct = can(l.uri.as_deref().unwrap_or(&l.path));
            let rewritten = l
                .rewrites
                .iter()
                .any(|r| r.flag != Flag::Redirect && can(&r.head));
            (direct || rewritten).then(|| {
                format!(
                    "{} {}{to} may carry it, which Drift could not confirm",
                    self.noun, l.label
                )
            })
        })
    }

    /// The location of `server` nginx gives `path` to: an exact match, else the longest
    /// matching prefix, unless it is `^~` and a regular-expression location that is a
    /// plain anchored prefix matches first, in the order written. Other regular
    /// expressions are not evaluated: one written before such a prefix leaves the
    /// longest prefix chosen, as when there is none.
    fn select(&self, server: usize, path: &str) -> Option<usize> {
        let of_server = || {
            self.locations
                .iter()
                .enumerate()
                .filter(move |(_, l)| l.server == server)
        };
        if let Some((i, _)) = of_server().find(|(_, l)| l.kind == Match::Exact && l.path == path) {
            return Some(i);
        }
        let prefix = of_server()
            .filter(|(_, l)| l.kind == Match::Prefix && path.starts_with(&l.path))
            .max_by_key(|(_, l)| l.path.len());
        if prefix.is_some_and(|(_, l)| l.stop) {
            return prefix.map(|(i, _)| i);
        }
        let regex = of_server()
            .filter(|(_, l)| l.kind == Match::Regex)
            .take_while(|(_, l)| l.literal.is_some())
            .find(|(_, l)| {
                let fold = l.literal == Some(true);
                path.get(..l.path.len()).is_some_and(|head| {
                    head == l.path || (fold && head.eq_ignore_ascii_case(&l.path))
                })
            });
        regex.or(prefix).map(|(i, _)| i)
    }
}

/// Request paths worth trying for `route` through `loc`: the route itself where the
/// location matches it, and what `proxy_pass` with a URI or a rewrite would have to be
/// given to produce it. Each is then checked forwards, so a wrong guess costs nothing.
fn candidates(loc: &Location, route: &Route) -> Vec<String> {
    let mut out = Vec::new();
    match loc.kind {
        Match::Prefix => {
            out.extend(route.fit(&loc.path, true, false));
            if let Some(u) = &loc.uri
                && let Some(s) = route.fit(u, true, false)
            {
                // A prefix written with a `/` at the end, taken off a path that keeps
                // its own.
                let rest = &s[u.len()..];
                let rest = match (loc.slash && loc.path.ends_with('/'), rest.strip_prefix('/')) {
                    (true, Some(r)) => r,
                    _ => rest,
                };
                out.push(format!("{}{rest}", loc.path));
            }
        }
        Match::Exact => out.push(loc.path.clone()),
        Match::Regex if loc.literal.is_some() => out.extend(route.fit(&loc.path, true, false)),
        Match::Regex => {}
    }
    for r in &loc.rewrites {
        let (Some(pattern), Some(pieces)) = (&r.pattern, &r.pieces) else {
            continue;
        };
        let Some(s) = route.fit(&r.head, true, false) else {
            continue;
        };
        let caps: Vec<usize> = pieces
            .iter()
            .filter_map(|p| match p {
                Piece::Cap(n) => Some(*n),
                Piece::Lit(_) => None,
            })
            .collect();
        let fill = match (caps.as_slice(), pieces.last()) {
            ([], _) => None,
            ([n], Some(Piece::Cap(_))) => Some((*n, s[r.head.len()..].to_string())),
            ([n], Some(Piece::Lit(tail))) if s.len() >= r.head.len() + tail.len() => s
                [r.head.len()..]
                .strip_suffix(tail.as_str())
                .map(|mid| (*n, mid.to_string())),
            _ => continue,
        };
        for optional in [false, true] {
            out.push(pattern.build(fill.as_ref(), optional));
        }
    }
    out
}

enum Delivered {
    /// The path the service is sent.
    Path(String),
    Nothing,
    Unknown,
}

/// What `loc` sends its service for the request path `e` (one it matches).
fn deliver(loc: &Location, e: &str) -> Delivered {
    for r in &loc.rewrites {
        let Some(pattern) = &r.pattern else {
            return Delivered::Unknown;
        };
        let Some(caps) = pattern.captures(e) else {
            continue;
        };
        return match (r.flag, &r.pieces) {
            (Flag::Redirect, _) => Delivered::Nothing,
            (Flag::Break, Some(pieces)) => Delivered::Path(
                pieces
                    .iter()
                    .map(|p| match p {
                        Piece::Lit(s) => s.as_str(),
                        Piece::Cap(n) => caps.get(*n).map_or("", String::as_str),
                    })
                    .collect(),
            ),
            _ => Delivered::Unknown,
        };
    }
    let sent = match (&loc.uri, loc.kind) {
        (None, _) => e.to_string(),
        (Some(u), Match::Exact) => u.clone(),
        (Some(u), _) => format!("{u}{}", e.get(loc.path.len()..).unwrap_or("")),
    };
    Delivered::Path(if loc.slash && !sent.starts_with('/') {
        format!("/{sent}")
    } else {
        sent
    })
}

// ---------- routes ----------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Tok {
    Lit(String),
    /// A parameter: one or more characters, none a `/`.
    Seg,
    /// A catch-all: anything.
    Any,
}

/// A route template as a pattern over request paths: `/users/{id}`, `/users/:id`,
/// `/users/[id]`, `/users/<int:id>`, and the catch-alls `{rest:path}`, `[...rest]`,
/// `[[...rest]]`, `<path:rest>`, `*`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    toks: Vec<Tok>,
    /// False when the template holds syntax not read (a regular expression, an optional
    /// parameter, a prefix Drift could not resolve, written `?`): the pattern then stops
    /// at that point and allows anything after it, so it can only say what the route
    /// cannot be.
    exact: bool,
}

impl Route {
    /// None when `template` is not a path (the name of a job, a command).
    pub fn parse(template: &str) -> Option<Route> {
        if !template.starts_with('/') {
            return None;
        }
        // A template longer than any route is written is read to that length, and
        // may be anything after it.
        let mut c: Vec<char> = template.chars().take(MAX_TEMPLATE + 1).collect();
        let mut exact = c.len() <= MAX_TEMPLATE;
        c.truncate(MAX_TEMPLATE);
        let mut toks: Vec<Tok> = Vec::new();
        let mut lit = String::new();
        let mut i = 0;
        let ident =
            |s: &[char]| !s.is_empty() && s.iter().all(|c| c.is_alphanumeric() || *c == '_');
        let closing = |from: usize, close: char| (from..c.len()).find(|j| c[*j] == close);
        while i < c.len() {
            // (token, characters consumed), or none: not read from here on.
            let read: Option<(Option<Tok>, usize)> = match c[i] {
                '{' => closing(i, '}').and_then(|j| {
                    let inner: String = c[i + 1..j].iter().collect();
                    let (name, conv) = inner.split_once(':').unwrap_or((&inner, ""));
                    let name: Vec<char> = name.chars().collect();
                    ident(&name).then(|| {
                        let tok = if conv == "path" { Tok::Any } else { Tok::Seg };
                        (Some(tok), j + 1 - i)
                    })
                }),
                '[' => closing(i, ']').and_then(|j| {
                    let inner = &c[i + 1..j];
                    if inner.starts_with(&['[', '.', '.', '.']) && c.get(j + 1) == Some(&']') {
                        // Optional catch-all: the route also answers without the `/`.
                        ident(&inner[4..]).then(|| {
                            if lit.ends_with('/') {
                                lit.pop();
                            }
                            (Some(Tok::Any), j + 2 - i)
                        })
                    } else if inner.starts_with(&['.', '.', '.']) {
                        ident(&inner[3..]).then_some((Some(Tok::Any), j + 1 - i))
                    } else {
                        ident(inner).then_some((Some(Tok::Seg), j + 1 - i))
                    }
                }),
                '<' => closing(i, '>').and_then(|j| {
                    let inner: String = c[i + 1..j].iter().collect();
                    let (conv, name) = inner.split_once(':').unwrap_or(("", &inner));
                    let name: Vec<char> = name.chars().collect();
                    ident(&name).then(|| {
                        let tok = if conv == "path" { Tok::Any } else { Tok::Seg };
                        (Some(tok), j + 1 - i)
                    })
                }),
                ':' if c.get(i + 1).is_some_and(|n| n.is_alphabetic() || *n == '_') => {
                    let end = (i + 1..c.len())
                        .find(|j| !(c[*j].is_alphanumeric() || c[*j] == '_'))
                        .unwrap_or(c.len());
                    // `:id?`, `:id(\d+)`, `:id{...}`, `:id*`: not read.
                    (!c.get(end).is_some_and(|n| "?({*+".contains(*n)))
                        .then_some((Some(Tok::Seg), end - i))
                }
                '*' => Some((Some(Tok::Any), 1)),
                '(' | ')' | '?' | '+' | '^' | '$' | '\\' | '|' | '}' | ']' | '>' => None,
                _ => Some((None, 1)),
            };
            match read {
                Some((None, _)) => {
                    lit.push(c[i]);
                    i += 1;
                }
                Some((Some(tok), n)) => {
                    if !lit.is_empty() {
                        toks.push(Tok::Lit(std::mem::take(&mut lit)));
                    }
                    toks.push(tok);
                    i += n;
                }
                None => {
                    exact = false;
                    break;
                }
            }
        }
        if !lit.is_empty() {
            toks.push(Tok::Lit(lit));
        }
        if !exact && toks.last() != Some(&Tok::Any) {
            toks.push(Tok::Any);
        }
        Some(Route { toks, exact })
    }

    /// How a path pattern of an AWS load balancer takes the route: `*` is any run of
    /// characters and `?` any one, and every other character is itself. A parameter
    /// of the route is some text Drift does not know (one character or more, none a
    /// `/`), so only a `*` is known to take all of it.
    pub fn glob(&self, pattern: &str) -> Glob {
        let p: Vec<char> = pattern.chars().collect();
        // Each character of a literal is a token of its own.
        let toks: Vec<Tok> = self
            .toks
            .iter()
            .flat_map(|t| match t {
                Tok::Lit(l) => l.chars().map(|c| Tok::Lit(c.to_string())).collect(),
                other => vec![other.clone()],
            })
            .collect();
        if glob_every(&p, &toks, &mut BTreeSet::new()) {
            Glob::Every
        } else if glob_some(&p, &toks, false, &mut BTreeSet::new()) {
            Glob::Some
        } else {
            Glob::None
        }
    }

    /// Whether the route answers `path`.
    fn matches(&self, path: &str) -> bool {
        self.fit(path, false, false).is_some()
    }

    /// A path the route answers that is `path` (`open` false) or starts with it (`open`
    /// true, parameters past it filled with `x`). `loose` compares as a service may,
    /// though nginx does not: without regard to case, and with or without a `/` at
    /// the end.
    fn fit(&self, path: &str, open: bool, loose: bool) -> Option<String> {
        let path: Vec<char> = path.chars().collect();
        let mut out = String::new();
        let mut dead = BTreeSet::new();
        fit(&self.toks, &path, (open, loose), &mut out, &mut dead).then_some(out)
    }
}

/// What a path pattern takes of the paths a route answers ([`Route::glob`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Glob {
    /// Every path the route answers.
    Every,
    /// Some path it answers, or one it may answer: not known to be all of them.
    Some,
    /// No path it answers.
    None,
}

/// Every path of `toks` (one character to a literal) is one `p` takes: a parameter or
/// a catch-all is under a `*`. `dead`: what is left of each that was found not to be.
fn glob_every(p: &[char], toks: &[Tok], dead: &mut BTreeSet<(usize, usize)>) -> bool {
    let Some((tok, rest)) = toks.split_first() else {
        return p.iter().all(|c| *c == '*');
    };
    if dead.contains(&(p.len(), toks.len())) {
        return false;
    }
    let found = match (p.first(), tok) {
        (Some('*'), _) => glob_every(p, rest, dead) || glob_every(&p[1..], toks, dead),
        (Some('?'), Tok::Lit(_)) => glob_every(&p[1..], rest, dead),
        (Some(c), Tok::Lit(l)) => l.starts_with(*c) && glob_every(&p[1..], rest, dead),
        _ => false,
    };
    if !found {
        dead.insert((p.len(), toks.len()));
    }
    found
}

/// Some path of `toks` is one `p` takes. `open`: the first token is a parameter that
/// already holds a character, and may end here.
fn glob_some(
    p: &[char],
    toks: &[Tok],
    open: bool,
    dead: &mut BTreeSet<(usize, usize, bool)>,
) -> bool {
    let Some((tok, rest)) = toks.split_first() else {
        return p.iter().all(|c| *c == '*');
    };
    // A state met again on the way to itself adds nothing: it is dead while tried.
    if !dead.insert((p.len(), toks.len(), open)) {
        return false;
    }
    let found = match tok {
        Tok::Lit(l) => match p.first() {
            Some('*') => glob_some(&p[1..], toks, false, dead) || glob_some(p, rest, false, dead),
            Some('?') => glob_some(&p[1..], rest, false, dead),
            Some(c) => l.starts_with(*c) && glob_some(&p[1..], rest, false, dead),
            None => false,
        },
        Tok::Seg => {
            (open && glob_some(p, rest, false, dead))
                || match p.first() {
                    Some('*') => {
                        glob_some(&p[1..], toks, open, dead) || glob_some(p, toks, true, dead)
                    }
                    Some('/') | None => false,
                    Some(_) => glob_some(&p[1..], toks, true, dead),
                }
        }
        Tok::Any => {
            glob_some(p, rest, false, dead)
                || (!p.is_empty() && glob_some(&p[1..], toks, false, dead))
        }
    };
    if found {
        dead.remove(&(p.len(), toks.len(), open));
    }
    found
}

/// Whether `toks` fit `path`, the fitting path written to `out`. What is left of the
/// tokens and of the path decides it, so a pair found not to fit is remembered in
/// `dead` and not tried again: adjacent parameters cannot make the search exponential.
fn fit(
    toks: &[Tok],
    path: &[char],
    mode: (bool, bool),
    out: &mut String,
    dead: &mut BTreeSet<(usize, usize)>,
) -> bool {
    let (open, loose) = mode;
    let Some((tok, rest)) = toks.split_first() else {
        return path.is_empty() || (loose && path == ['/']);
    };
    let state = (toks.len(), path.len());
    if dead.contains(&state) || !step() {
        return false;
    }
    let mark = out.len();
    match tok {
        Tok::Lit(l) => {
            let l: Vec<char> = l.chars().collect();
            let n = l.len().min(path.len());
            let same = |a: &char, b: &char| a == b || (loose && a.eq_ignore_ascii_case(b));
            if !l[..n].iter().zip(&path[..n]).all(|(a, b)| same(a, b)) || (n < l.len() && !open) {
                return false;
            }
            out.extend(&path[..n]);
            out.extend(&l[n..]);
            if fit(rest, &path[n..], mode, out, dead) {
                return true;
            }
        }
        Tok::Seg if path.is_empty() => {
            out.push('x');
            if open && fit(rest, path, mode, out, dead) {
                return true;
            }
        }
        Tok::Seg => {
            let max = path.iter().take_while(|c| **c != '/').count();
            for k in (1..=max).rev() {
                out.extend(&path[..k]);
                if !step() {
                    break;
                }
                if fit(rest, &path[k..], mode, out, dead) {
                    return true;
                }
                out.truncate(mark);
            }
        }
        Tok::Any => {
            // Looking for a path that starts with `path`, the catch-all takes all of it.
            let least = if open { path.len() } else { 0 };
            for k in (least..=path.len()).rev() {
                out.extend(&path[..k]);
                if !step() {
                    break;
                }
                if fit(rest, &path[k..], mode, out, dead) {
                    return true;
                }
                out.truncate(mark);
            }
        }
    }
    out.truncate(mark);
    dead.insert(state);
    false
}

// ---------- rewrite expressions ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Atom {
    Lit(char),
    Any,
    NotSlash,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PTok {
    atom: Atom,
    min: usize,
    many: bool,
    /// The capture group this is the whole of.
    group: Option<usize>,
}

/// The regular expressions of `rewrite` that are evaluated: anchored at the start
/// (`^`), made of literal characters (escaped punctuation too), `.` and `[^/]`, each
/// with an optional `?`, `*` or `+`, the groups `(.*)`, `(.+)`, `([^/]*)`, `([^/]+)`,
/// and an optional `$` at the end. Anything else is not evaluated.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Pattern {
    toks: Vec<PTok>,
    /// Ends with `$`.
    end: bool,
}

impl Pattern {
    fn parse(re: &str) -> Option<Pattern> {
        let c: Vec<char> = re.strip_prefix('^')?.chars().collect();
        let mut toks = Vec::new();
        let mut groups = 0;
        let mut i = 0;
        // An atom at `i`: (atom, characters consumed).
        let atom = |i: usize| -> Option<(Atom, usize)> {
            match c.get(i)? {
                '.' => Some((Atom::Any, 1)),
                '[' => c[i..]
                    .starts_with(&['[', '^', '/', ']'])
                    .then_some((Atom::NotSlash, 4)),
                '\\' => c
                    .get(i + 1)
                    .filter(|n| n.is_ascii_punctuation())
                    .map(|n| (Atom::Lit(*n), 2)),
                x if "()]{}*+?|^$".contains(*x) => None,
                x => Some((Atom::Lit(*x), 1)),
            }
        };
        // A quantifier at `i`: (min, many, characters consumed).
        let quantifier = |i: usize| -> Option<(usize, bool, usize)> {
            let q = match c.get(i) {
                Some('?') => (0, false, 1),
                Some('*') => (0, true, 1),
                Some('+') => (1, true, 1),
                _ => return Some((1, false, 0)),
            };
            // Lazy and possessive forms are not read.
            (!matches!(c.get(i + 1), Some('?' | '+'))).then_some(q)
        };
        while i < c.len() {
            if c[i] == '$' && i + 1 == c.len() {
                return Some(Pattern { toks, end: true });
            }
            let group = c[i] == '(';
            let (a, n) = atom(i + usize::from(group))?;
            let (min, many, q) = quantifier(i + usize::from(group) + n)?;
            i += usize::from(group) + n + q;
            if group {
                if c.get(i) != Some(&')') || !many || matches!(a, Atom::Lit(_)) {
                    return None;
                }
                i += 1;
                groups += 1;
            }
            toks.push(PTok {
                atom: a,
                min,
                many,
                group: group.then_some(groups),
            });
            if toks.len() > MAX_PATTERN {
                return None;
            }
        }
        Some(Pattern { toks, end: false })
    }

    /// The captures when the expression matches `path` (index 0 unused), as a
    /// backtracking engine finds them: each quantifier takes all it can first.
    fn captures(&self, path: &str) -> Option<Vec<String>> {
        let path: Vec<char> = path.chars().collect();
        let groups = self.toks.iter().filter(|t| t.group.is_some()).count();
        let mut caps = vec![String::new(); groups + 1];
        let mut dead = BTreeSet::new();
        self.walk(0, &path, &mut caps, &mut dead).then_some(caps)
    }

    /// `dead` holds the (token, rest of the path) pairs found not to match, as in
    /// [`fit`].
    fn walk(
        &self,
        t: usize,
        path: &[char],
        caps: &mut [String],
        dead: &mut BTreeSet<(usize, usize)>,
    ) -> bool {
        let Some(tok) = self.toks.get(t) else {
            return !self.end || path.is_empty();
        };
        if dead.contains(&(t, path.len())) || !step() {
            return false;
        }
        let fits = |c: &char| match tok.atom {
            Atom::Lit(l) => *c == l,
            Atom::Any => true,
            Atom::NotSlash => *c != '/',
        };
        let run = path.iter().take_while(|c| fits(c)).count();
        let most = if tok.many { run } else { run.min(1) };
        for k in (tok.min..=most).rev() {
            if !step() {
                break;
            }
            if self.walk(t + 1, &path[k..], caps, dead) {
                if let Some(g) = tok.group {
                    caps[g] = path[..k].iter().collect();
                }
                return true;
            }
        }
        dead.insert((t, path.len()));
        false
    }

    /// A string the expression is written to match, with the group `fill.0` holding
    /// `fill.1`; `optional` includes what a `?` or `*` makes optional.
    fn build(&self, fill: Option<&(usize, String)>, optional: bool) -> String {
        let mut out = String::new();
        for t in &self.toks {
            match (t.group, fill) {
                (Some(g), Some((n, value))) if g == *n => out.push_str(value),
                _ if t.min == 0 && !optional => {}
                _ => out.push(match t.atom {
                    Atom::Lit(c) => c,
                    Atom::Any | Atom::NotSlash => 'x',
                }),
            }
        }
        out
    }
}

/// The replacement of a `rewrite`: its literal start and, when every variable in it is
/// a capture (`$1`), its pieces. The query string it may set is not part of the path.
fn replacement(text: &str) -> (String, Option<Vec<Piece>>) {
    let text = text.split('?').next().unwrap_or("");
    let head = text.split('$').next().unwrap_or("").to_string();
    let mut pieces = Vec::new();
    let mut lit = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '$' {
            lit.push(ch);
            continue;
        }
        let Some(n) = chars.next().and_then(|d| d.to_digit(10)) else {
            return (head, None);
        };
        if !lit.is_empty() {
            pieces.push(Piece::Lit(std::mem::take(&mut lit)));
        }
        pieces.push(Piece::Cap(n as usize));
    }
    if !lit.is_empty() {
        pieces.push(Piece::Lit(lit));
    }
    (head, Some(pieces))
}

// ---------- reading the configuration ----------

#[derive(Debug, Clone, PartialEq, Eq)]
struct Directive {
    name: String,
    args: Vec<String>,
    block: Option<Vec<Directive>>,
    line: u32,
}

/// How deep the blocks of a configuration file may nest ([`parse`]).
const MAX_DEPTH: usize = 32;

/// A word longer than any path or expression nginx is given: the file is not read,
/// so no route is compared with it.
fn long_word(line: u32) -> String {
    format!("line {line}: not nginx configuration (a word of more than {MAX_WORD} characters)")
}

/// The directives of an nginx configuration file.
fn parse(text: &str) -> Result<Vec<Directive>, String> {
    #[derive(PartialEq)]
    enum T {
        Word(String),
        Open,
        Close,
        End,
    }
    let mut toks: Vec<(T, u32)> = Vec::new();
    let c: Vec<char> = text.chars().collect();
    let (mut i, mut line) = (0, 1u32);
    while i < c.len() {
        match c[i] {
            '\n' => {
                line += 1;
                i += 1;
            }
            x if x.is_whitespace() => i += 1,
            '#' => {
                while i < c.len() && c[i] != '\n' {
                    i += 1;
                }
            }
            '{' => {
                toks.push((T::Open, line));
                i += 1;
            }
            '}' => {
                toks.push((T::Close, line));
                i += 1;
            }
            ';' => {
                toks.push((T::End, line));
                i += 1;
            }
            q @ ('"' | '\'') => {
                let start = line;
                let mut word = String::new();
                i += 1;
                loop {
                    match c.get(i) {
                        None => return Err(format!("line {start}: quote not closed")),
                        Some(x) if *x == q => break,
                        Some('\\') if c.get(i + 1).is_some_and(|n| *n == q || *n == '\\') => {
                            word.push(c[i + 1]);
                            i += 2;
                        }
                        Some(x) => {
                            if *x == '\n' {
                                line += 1;
                            }
                            word.push(*x);
                            i += 1;
                        }
                    }
                }
                i += 1;
                if word.chars().count() > MAX_WORD {
                    return Err(long_word(start));
                }
                toks.push((T::Word(word), start));
            }
            _ => {
                // A bare word ends at a space, `;` or `{`, except the `{` of `${name}`.
                let mut word = String::new();
                while let Some(x) = c.get(i) {
                    if x.is_whitespace() || *x == ';' || (*x == '{' && !word.ends_with('$')) {
                        break;
                    }
                    if *x == '\\' && i + 1 < c.len() {
                        word.push(*x);
                        i += 1;
                    }
                    word.push(c[i]);
                    i += 1;
                }
                if word.chars().count() > MAX_WORD {
                    return Err(long_word(line));
                }
                toks.push((T::Word(word), line));
            }
        }
    }
    fn block(toks: &[(T, u32)], i: &mut usize, depth: usize) -> Result<Vec<Directive>, String> {
        let nested = depth > 0;
        let mut out = Vec::new();
        loop {
            let mut words: Vec<String> = Vec::new();
            let line = toks.get(*i).map_or(0, |t| t.1);
            loop {
                let Some((t, at)) = toks.get(*i) else {
                    return if words.is_empty() && !nested {
                        Ok(out)
                    } else {
                        Err("ends inside a directive or a block".to_string())
                    };
                };
                *i += 1;
                match t {
                    T::Word(w) => words.push(w.clone()),
                    T::Close if words.is_empty() && nested => return Ok(out),
                    T::End | T::Open if !words.is_empty() => {
                        let body = if *t == T::Open {
                            // nginx nests a handful of blocks. A file that nests more
                            // is not one Drift reads, and must not be walked to the
                            // end of the stack.
                            if depth >= MAX_DEPTH {
                                return Err(format!(
                                    "line {at}: not nginx configuration (blocks nested more than {MAX_DEPTH} deep)"
                                ));
                            }
                            Some(block(toks, i, depth + 1)?)
                        } else {
                            None
                        };
                        out.push(Directive {
                            name: words.remove(0),
                            args: words,
                            block: body,
                            line,
                        });
                        break;
                    }
                    _ => return Err(format!("line {at}: not nginx configuration")),
                }
            }
        }
    }
    block(&toks, &mut 0, 0)
}

/// Directives that cannot change which service a request reaches or the path it is
/// sent: headers, timeouts, buffers, logs, limits, access rules, static files, TLS.
/// A directive not listed here and not read is unknown, and recorded as unread.
fn inert(name: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "proxy_",
        "client_",
        "gzip",
        "ssl_",
        "keepalive_",
        "send",
        "tcp_",
        "limit_",
        "auth_basic",
        "open_file_cache",
        "http2",
        "worker_",
        "lingering_",
        "autoindex",
        "access_log",
        "error_log",
        "log_",
        "real_ip_",
        "server_name",
        "server_tokens",
        "types_hash_",
        "variables_hash_",
        "map_hash_",
    ];
    const NAMES: &[&str] = &[
        "absolute_redirect",
        "add_header",
        "add_trailer",
        "aio",
        "alias",
        "allow",
        "charset",
        "chunked_transfer_encoding",
        "daemon",
        "default_type",
        "deny",
        "directio",
        "etag",
        "events",
        "expires",
        "geo",
        "if_modified_since",
        "ignore_invalid_headers",
        "index",
        "large_client_header_buffers",
        "listen",
        "map",
        "max_ranges",
        "multi_accept",
        "output_buffers",
        "pid",
        "port_in_redirect",
        "postpone_output",
        "reset_timedout_connection",
        "resolver",
        "resolver_timeout",
        "root",
        "satisfy",
        "set",
        "set_real_ip_from",
        "split_clients",
        "stub_status",
        "types",
        "underscores_in_headers",
        "user",
    ];
    name != "proxy_pass" && (NAMES.contains(&name) || PREFIXES.iter().any(|p| name.starts_with(p)))
}

fn collect_upstreams(
    ds: &[Directive],
    resolve: &dyn Fn(&str) -> Target,
    out: &mut BTreeMap<String, Target>,
) {
    for d in ds {
        let Some(body) = &d.block else { continue };
        match d.name.as_str() {
            "http" => collect_upstreams(body, resolve, out),
            "upstream" => {
                let mut services: Vec<String> = Vec::new();
                let mut unresolved = false;
                for s in body.iter().filter(|s| s.name == "server") {
                    match s.args.first().map(|a| resolve(host_of(a))) {
                        Some(Target::Services(x)) => services.extend(x),
                        Some(Target::Nowhere) => {}
                        _ => unresolved = true,
                    }
                }
                services.sort();
                services.dedup();
                let target = if unresolved {
                    Target::Unresolved
                } else if services.is_empty() {
                    Target::Nowhere
                } else {
                    Target::Services(services)
                };
                if let Some(name) = d.args.first() {
                    out.insert(name.to_lowercase(), target);
                }
            }
            _ => {}
        }
    }
}

/// `api:8000` -> `api`; `[::1]:80` -> `[::1]`.
fn host_of(addr: &str) -> &str {
    if addr.starts_with('[') {
        return addr.split_inclusive(']').next().unwrap_or(addr);
    }
    addr.split(':').next().unwrap_or(addr)
}

struct Reader<'a> {
    gateway: Gateway,
    servers: usize,
    resolve: &'a dyn Fn(&str) -> Target,
    upstreams: BTreeMap<String, Target>,
}

impl Reader<'_> {
    fn unread(&mut self, file: &str, d: &Directive, why: &str) {
        self.gateway
            .unread
            .push(format!("{file}:{}: `{}` {why}", d.line, d.name));
    }

    /// A directive that is the same wherever it stands. False when it is not one.
    fn common(&mut self, file: &str, d: &Directive) -> bool {
        match d.name.as_str() {
            // The types file, and the directory whose files the caller hands over
            // ([`Gateway::read`]).
            "include"
                if d.args.first().is_some_and(|a| {
                    a.rsplit('/').next() == Some("mime.types")
                        || a == "/etc/nginx/conf.d/*.conf"
                        || a == "conf.d/*.conf"
                }) => {}
            "include" => self.unread(file, d, "is not followed"),
            // A fixed path is one a client can ask for itself: nothing new is reached.
            "error_page" | "try_files" => {
                let last = d.args.last().map_or("", String::as_str);
                let path = last.split('?').next().unwrap_or("");
                if last.starts_with('@') || path.contains('$') {
                    self.unread(file, d, "falls back to a location Drift does not follow");
                }
            }
            // A header that tells the service which prefix was cut off: some servers
            // then answer their routes under it.
            "proxy_set_header"
                if d.args.first().is_some_and(|h| {
                    ["script_name", "x-script-name", "x-forwarded-prefix"]
                        .contains(&h.to_lowercase().as_str())
                }) =>
            {
                self.unread(file, d, "may move the service's routes under a prefix");
            }
            n if inert(n) => {}
            _ => return false,
        }
        true
    }

    fn top(&mut self, file: &str, ds: &[Directive]) {
        for d in ds {
            match (d.name.as_str(), &d.block) {
                ("http", Some(body)) => self.top(file, body),
                ("server", Some(body)) => self.server(file, body),
                ("upstream", Some(_)) => {}
                _ if self.common(file, d) => {}
                _ => self.unread(file, d, "is not read"),
            }
        }
    }

    fn server(&mut self, file: &str, body: &[Directive]) {
        let server = self.servers;
        self.servers += 1;
        // A server that answers by itself (`return 301 https://...`) proxies nothing,
        // unless a `rewrite ... break` before the `return` stops it for some paths:
        // such a server is read, and its `rewrite` and `return` recorded as unread.
        let has = |name: &str| body.iter().any(|d| d.name == name);
        if has("return") && !has("rewrite") {
            return;
        }
        for d in body {
            match (d.name.as_str(), &d.block) {
                ("location", Some(inner)) => self.location(file, server, d, inner),
                _ if self.common(file, d) => {}
                _ => self.unread(file, d, "is not read"),
            }
        }
    }

    fn location(&mut self, file: &str, server: usize, d: &Directive, body: &[Directive]) {
        let (kind, path) = match d.args.as_slice() {
            [m, p] if m == "=" => (Match::Exact, p.as_str()),
            [m, p] if m == "^~" => (Match::Prefix, p.as_str()),
            [m, p] if m == "~" || m == "~*" => (Match::Regex, p.as_str()),
            [p] if p.starts_with("^~") => (Match::Prefix, &p[2..]),
            [p] if p.starts_with('~') => (Match::Regex, p.trim_start_matches(['~', '*'])),
            [p] if p.starts_with('=') => (Match::Exact, &p[1..]),
            // Reached only through a fallback, which is recorded where it is written.
            [p] if p.starts_with('@') => return,
            [p] => (Match::Prefix, p.as_str()),
            _ => return self.unread(file, d, "is not read"),
        };
        let mut loc = Location {
            server,
            kind,
            label: d.args.join(" "),
            path: path.to_string(),
            target: Target::Nowhere,
            uri: None,
            rewrites: Vec::new(),
            slash: false,
            stop: d.args.first().is_some_and(|a| a.starts_with("^~")),
            literal: None,
        };
        let has = |name: &str| body.iter().any(|x| x.name == name);
        // `return` answers before anything is proxied, unless a `rewrite ... break`
        // stops it first; a file `try_files` finds is sent on with its own path.
        if has("proxy_pass") && ((has("return") && has("rewrite")) || has("try_files")) {
            self.unread(file, d, "mixes `proxy_pass` with `return` or `try_files`");
        }
        for x in body {
            match x.name.as_str() {
                "proxy_pass" if !has("return") => {
                    (loc.target, loc.uri) =
                        self.proxy_pass(x.args.first().map_or("", String::as_str));
                    // It may be any service, on paths Drift does not know it by.
                    if loc.target == Target::Unresolved {
                        self.unread(
                            file,
                            x,
                            "names a host Drift cannot resolve (a variable, an address)",
                        );
                    }
                }
                "proxy_pass" | "return" => {}
                "rewrite" => {
                    let re = x.args.first().map_or("", String::as_str);
                    let to = x.args.get(1).map_or("", String::as_str);
                    let flag = match x.args.get(2).map(String::as_str) {
                        _ if ["http://", "https://", "$scheme"]
                            .iter()
                            .any(|p| to.starts_with(p)) =>
                        {
                            Flag::Redirect
                        }
                        Some("break") => Flag::Break,
                        Some("redirect" | "permanent") => Flag::Redirect,
                        _ => Flag::Again,
                    };
                    if flag == Flag::Again {
                        self.unread(
                            file,
                            x,
                            "without `break` looks the location up again, which Drift does not follow",
                        );
                    }
                    let (head, pieces) = replacement(to);
                    loc.rewrites.push(Rewrite {
                        pattern: Pattern::parse(re),
                        pieces,
                        head,
                        flag,
                    });
                }
                _ if self.common(file, x) => {}
                _ => self.unread(file, x, "is not read"),
            }
        }
        // A plain anchored prefix is evaluated; nginx refuses a URI part in
        // `proxy_pass` there, so one that has it is left as written.
        if kind == Match::Regex
            && loc.uri.is_none()
            && let Some(prefix) = literal_prefix(path)
        {
            loc.path = prefix;
            loc.literal = Some(d.args.iter().any(|a| a.starts_with("~*")));
        }
        self.gateway.locations.push(loc);
    }

    /// The service `proxy_pass` names and its URI part.
    fn proxy_pass(&self, url: &str) -> (Target, Option<String>) {
        let lower = url.to_lowercase();
        let Some(rest) = ["http://", "https://"]
            .iter()
            .find_map(|s| lower.strip_prefix(s).map(|_| &url[s.len()..]))
            .filter(|_| !url.contains('$'))
        else {
            return (Target::Unresolved, None);
        };
        let (addr, uri) = match rest.find('/') {
            Some(i) => (&rest[..i], Some(rest[i..].to_string())),
            None => (rest, None),
        };
        let host = host_of(addr).to_lowercase();
        let target = match self.upstreams.get(&host) {
            Some(t) => t.clone(),
            None => (self.resolve)(&host),
        };
        (target, uri)
    }
}

/// The prefix a regular expression matches when it is one: `^` and then only
/// characters that stand for themselves (letters, digits, `/`, `-`, `_`, and
/// punctuation escaped with a backslash), so it matches exactly the paths that start
/// with them. None for anything else.
fn literal_prefix(re: &str) -> Option<String> {
    let c: Vec<char> = re.strip_prefix('^')?.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < c.len() {
        match c[i] {
            '\\' if c.get(i + 1).is_some_and(|n| n.is_ascii_punctuation()) => {
                out.push(c[i + 1]);
                i += 2;
                continue;
            }
            x if x.is_ascii_alphanumeric() || "/-_".contains(x) => out.push(x),
            _ => return None,
        }
        i += 1;
    }
    out.starts_with('/').then_some(out)
}

// ---------- a gateway built from a Dockerfile ----------

/// What the last stage of a Dockerfile makes of a gateway image.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Built {
    /// The image the last stage starts from.
    pub base: String,
    /// What it copies under `/etc/nginx` from the build context: (source, destination).
    pub copies: Vec<(String, String)>,
    /// Everything it copies from the build context to an absolute path, nginx's
    /// configuration too: (source, destination). Where another gateway's
    /// configuration is found ([`crate::gateway_configs`]).
    pub files: Vec<(String, String)>,
    /// A step that may write configuration Drift does not read.
    pub unread: Option<String>,
}

/// Whether a path in the gateway's container is nginx configuration.
pub fn nginx_path(path: &str) -> bool {
    path == "/etc/nginx" || path.starts_with("/etc/nginx/")
}

/// The last stage of the Dockerfile `text`; none when it has no `FROM`.
pub fn dockerfile(text: &str) -> Option<Built> {
    let mut built: Option<Built> = None;
    // Earlier stages by name, each with the image it starts from.
    let mut stages: Vec<(String, String)> = Vec::new();
    let joined = text.replace("\\\r\n", " ").replace("\\\n", " ");
    for line in joined.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut words = line.split_whitespace();
        let instruction = words.next().unwrap_or("").to_uppercase();
        let args: Vec<&str> = words.collect();
        if instruction == "FROM" {
            let named: Vec<&str> = args
                .iter()
                .filter(|a| !a.starts_with("--"))
                .copied()
                .collect();
            let image = named.first().copied().unwrap_or_default();
            // `FROM base AS final`: the image the named stage started from.
            let base = stages
                .iter()
                .find(|(name, _)| name == image)
                .map_or(image, |(_, base)| base)
                .to_string();
            if let [_, word, name] = named.as_slice()
                && word.eq_ignore_ascii_case("as")
            {
                stages.push((name.to_string(), base.clone()));
            }
            built = Some(Built {
                base,
                ..Built::default()
            });
            continue;
        }
        let Some(b) = built.as_mut() else { continue };
        let plain = |args: &[&str]| {
            !args
                .iter()
                .any(|a| a.contains(['&', '|', ';', '>', '<', '$', '`']))
        };
        let ok = match instruction.as_str() {
            "COPY" => {
                let from_stage = args.iter().any(|a| a.starts_with("--from"));
                let paths: Vec<&str> = args
                    .iter()
                    .filter(|a| !a.starts_with("--"))
                    .copied()
                    .collect();
                if let Some((dst, srcs)) = paths.split_last()
                    && dst.starts_with('/')
                    && !from_stage
                    && !srcs.iter().any(|s| s.contains(['*', '?', '[']))
                {
                    b.files
                        .extend(srcs.iter().map(|s| (s.to_string(), dst.to_string())));
                }
                match paths.split_last() {
                    Some((dst, srcs)) if nginx_path(dst) => {
                        let read = !from_stage && !srcs.iter().any(|s| s.contains(['*', '?', '[']));
                        if read {
                            b.copies
                                .extend(srcs.iter().map(|s| (s.to_string(), dst.to_string())));
                        }
                        read
                    }
                    // Elsewhere in the image: not configuration. A relative
                    // destination depends on the working directory.
                    Some((dst, _)) => dst.starts_with('/'),
                    None => false,
                }
            }
            "RUN" => args.first() == Some(&"rm") && plain(&args),
            "CMD" => {
                let said: String = line[3..]
                    .chars()
                    .filter(|c| !"[],\"'".contains(*c))
                    .collect();
                said.split_whitespace().collect::<Vec<_>>() == ["nginx", "-g", "daemon", "off;"]
            }
            "EXPOSE" | "LABEL" | "ENV" | "ARG" | "USER" | "HEALTHCHECK" | "STOPSIGNAL"
            | "VOLUME" | "MAINTAINER" | "WORKDIR" => true,
            _ => false,
        };
        if !ok && b.unread.is_none() {
            b.unread = Some(line.chars().take(60).collect());
        }
    }
    built
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gateway(conf: &str) -> Gateway {
        let resolve = |h: &str| match h {
            "api" | "web" | "jobs" => Target::Services(vec![h.to_string()]),
            "10.0.0.5" => Target::Unresolved,
            _ => Target::Nowhere,
        };
        Gateway::read(
            "edge",
            &[("nginx.conf".to_string(), conf.to_string())],
            &resolve,
        )
        .unwrap()
    }

    fn route(t: &str) -> Route {
        Route::parse(t).unwrap()
    }

    #[test]
    fn the_longest_prefix_and_an_exact_location_decide() {
        let g = gateway(
            "server {\n  location / { proxy_pass http://web:3000; }\n  location /api { proxy_pass http://api:8000; }\n  location /api/admin { return 403; }\n  location = /api/admin/ping { proxy_pass http://api:8000; }\n}\n",
        );
        assert!(g.unread.is_empty(), "{:?}", g.unread);
        assert_eq!(g.carries("api", &route("/api/users/{id}")), Some("/api"));
        // nginx matches a prefix as a string: `/apiary` is under `/api`.
        assert_eq!(g.carries("api", &route("/apiary")), Some("/api"));
        // The longer prefix takes it and answers by itself: not delivered, but the
        // shorter location could, so it is not said to be internal either.
        assert_eq!(g.carries("api", &route("/api/admin/users")), None);
        assert!(g.may_carry("api", &route("/api/admin/users")).is_some());
        assert_eq!(
            g.carries("api", &route("/api/admin/ping")),
            Some("= /api/admin/ping")
        );
        // No location to api matches: it cannot be delivered.
        assert_eq!(g.carries("api", &route("/internal/users")), None);
        assert_eq!(g.may_carry("api", &route("/internal/users")), None);
        // `/` takes it, to another service.
        assert_eq!(g.carries("web", &route("/internal/users")), Some("/"));
        // A parameter can take the value a location names.
        assert_eq!(g.carries("api", &route("/{service}/health")), Some("/api"));
        // Case: nginx compares exactly, the service may not, so only "internal" is withheld.
        assert_eq!(g.carries("api", &route("/API/users")), None);
        assert!(g.may_carry("api", &route("/API/users")).is_some());
        // The same of a slash at the end, which a service may answer with or without.
        assert_eq!(g.carries("api", &route("/api/admin/ping/")), None);
        assert!(g.may_carry("api", &route("/api/admin/ping/")).is_some());
        let slash = gateway("server { location /internal/x/ { proxy_pass http://api:1; } }");
        assert!(slash.may_carry("api", &route("/internal/x")).is_some());
        assert_eq!(slash.may_carry("api", &route("/internal/xy")), None);
        assert_eq!(g.locations_to("api"), ["/api", "= /api/admin/ping"]);
    }

    #[test]
    fn the_path_the_service_sees_is_what_is_compared() {
        // A URI on proxy_pass replaces the matched prefix.
        let g = gateway(
            "upstream backend { server api:8000; }\nserver {\n  location /public/ { proxy_pass http://backend/v1/; }\n}\n",
        );
        assert_eq!(g.carries("api", &route("/v1/users")), Some("/public/"));
        assert_eq!(g.carries("api", &route("/public/users")), None);
        assert_eq!(g.may_carry("api", &route("/public/users")), None);
        assert_eq!(g.may_carry("api", &route("/internal/users")), None);

        // rewrite ... break: the replacement is what the service sees.
        let g = gateway(
            "server {\n  location /api/ {\n    rewrite ^/api/(.*)$ /$1 break;\n    proxy_pass http://api:8000;\n  }\n}\n",
        );
        assert_eq!(g.carries("api", &route("/internal/users")), Some("/api/"));

        // The rewrites of the measured repository keep the path.
        let g = gateway(
            "server {\n  location /v1/rules {\n    rewrite ^/v1/rules/?(.+)$ /v1/rules/$1 break;\n    rewrite ^/v1/rules/?$ /v1/rules break;\n    proxy_pass http://api:8000;\n  }\n}\n",
        );
        assert!(g.unread.is_empty(), "{:?}", g.unread);
        assert_eq!(g.carries("api", &route("/v1/rules")), Some("/v1/rules"));
        assert_eq!(
            g.carries("api", &route("/v1/rules/{id}")),
            Some("/v1/rules")
        );
        assert_eq!(g.carries("api", &route("/internal/v1/runs")), None);
        assert_eq!(g.may_carry("api", &route("/internal/v1/runs")), None);
        assert_eq!(
            g.unexplained("api", &[route("/internal/v1/runs")]),
            ["/v1/rules"]
        );
        assert!(g.unexplained("api", &[route("/v1/rules/{id}")]).is_empty());

        // An expression outside the subset is not evaluated: neither public nor internal.
        let g = gateway(
            "server {\n  location /a/ {\n    rewrite ^/a/(?<rest>\\d+)$ /b/$rest break;\n    proxy_pass http://api:8000;\n  }\n}\n",
        );
        assert_eq!(g.carries("api", &route("/b/{id}")), None);
        assert!(g.may_carry("api", &route("/b/{id}")).is_some());
        assert_eq!(g.may_carry("api", &route("/c/{id}")), None);
    }

    #[test]
    fn what_is_not_read_is_recorded_and_never_internal() {
        let g = gateway(
            "include extra/*.conf;\nserver {\n  location ~ ^/(a|b)/ { proxy_pass http://api:8000; }\n  location /x { proxy_pass http://$backend; }\n  location /y { proxy_pass http://10.0.0.5:80; }\n  location /z { if ($arg_a) { proxy_pass http://api:1; } }\n  location /w { rewrite ^/w/(.*)$ /$1 last; }\n  location /s { try_files $uri @app; }\n  location /t { try_files $uri /index.html; root /srv; }\n  location /p { proxy_set_header X-Forwarded-Prefix /p; proxy_pass http://web:1; }\n}\n",
        );
        assert_eq!(
            g.unread,
            [
                "nginx.conf:1: `include` is not followed",
                "nginx.conf:4: `proxy_pass` names a host Drift cannot resolve (a variable, an address)",
                "nginx.conf:5: `proxy_pass` names a host Drift cannot resolve (a variable, an address)",
                "nginx.conf:6: `if` is not read",
                "nginx.conf:7: `rewrite` without `break` looks the location up again, which Drift does not follow",
                "nginx.conf:8: `try_files` falls back to a location Drift does not follow",
                "nginx.conf:10: `proxy_set_header` may move the service's routes under a prefix",
            ]
        );
        // A regular expression to the service may route anything to it.
        assert_eq!(g.carries("api", &route("/internal")), None);
        assert!(
            g.may_carry("api", &route("/internal"))
                .unwrap()
                .contains("regular expression")
        );
        // A host that cannot be told may be any service, for the paths its location takes.
        assert!(
            g.may_carry("jobs", &route("/x/run"))
                .unwrap()
                .contains("cannot resolve")
        );
        assert!(g.may_carry("jobs", &route("/y/run")).is_some());
        assert_eq!(g.may_carry("jobs", &route("/q/run")), None);
    }

    /// A whole `nginx.conf` as the stock image writes it, a redirecting server and a
    /// static site with its fallbacks: all of it is read, and it proxies one prefix.
    /// A file that nests blocks without end is refused, not walked: the caller then
    /// takes the services behind the gateway as a whole, and nothing aborts.
    #[test]
    fn blocks_nested_without_end_are_not_nginx_configuration() {
        let resolve = |_: &str| Target::Nowhere;
        for text in ["a {\n".repeat(60_000), "server { ".repeat(60_000)] {
            let err =
                Gateway::read("edge", &[("nginx.conf".to_string(), text)], &resolve).unwrap_err();
            assert!(err.contains("not nginx configuration"), "{err}");
        }
        // What nginx itself nests is read.
        let deep = format!(
            "{}{}",
            "if ($a) { ".repeat(MAX_DEPTH),
            "}".repeat(MAX_DEPTH)
        );
        assert!(Gateway::read("edge", &[("nginx.conf".to_string(), deep)], &resolve).is_ok());
    }

    /// Comparing a route with a location is bounded: adjacent parameters, or a
    /// `rewrite` of many `.*`, do not make it exponential, and a run takes a fixed
    /// number of steps at most, after which a route is unknown and never internal.
    #[test]
    fn comparing_routes_with_locations_is_bounded() {
        let started = std::time::Instant::now();
        let params: String = (0..40).map(|i| format!("{{p{i}}}")).collect();
        let long = "a".repeat(120);
        let g = gateway(&format!(
            "server {{\n  location /{long}/ {{ proxy_pass http://api:8000; }}\n  location /re/ {{\n    rewrite ^/re/{}x$ /internal/$1 break;\n    proxy_pass http://api:8000;\n  }}\n}}\n",
            "(.*)".repeat(30)
        ));
        // No parameter can hold the `/` the location ends with; a service that answers
        // with or without one at the end may still be given it.
        let adjacent = route(&format!("/{params}"));
        assert_eq!(g.carries("api", &adjacent), None);
        assert!(g.may_carry("api", &adjacent).is_some());
        assert_eq!(g.may_carry("api", &route(&format!("/b{params}"))), None);
        let some: String = (0..20).map(|i| format!("{{p{i}}}")).collect();
        assert_eq!(
            g.carries("api", &route(&format!("/{long}/{some}"))),
            Some(&*format!("/{long}/"))
        );
        // Thirty `(.*)` and a path of two hundred characters: matched, and found not
        // to match (no `x` at the end), without trying every way to split it.
        assert_eq!(
            g.carries("api", &route(&format!("/internal/{}", "b".repeat(200)))),
            Some("/re/")
        );
        let pattern = Pattern::parse(&format!("^/re/{}x$", "(.*)".repeat(30))).unwrap();
        assert!(
            pattern
                .captures(&format!("/re/{}", "b".repeat(400)))
                .is_none()
        );
        assert!(
            pattern
                .captures(&format!("/re/{}x", "b".repeat(400)))
                .is_some()
        );
        assert!(Pattern::parse(&format!("^/{}$", "a?".repeat(MAX_PATTERN + 1))).is_none());
        assert!(started.elapsed() < std::time::Duration::from_secs(20));

        // A template longer than a route is written: read to its limit, then anything.
        let endless = route(&format!("/v1/{}", "x/".repeat(4000)));
        assert!(!endless.exact);
        assert!(endless.toks.len() <= 2);
        // A word no configuration holds is not read.
        let resolve = |_: &str| Target::Nowhere;
        let text = format!("server {{ location /{} {{ }} }}", "a".repeat(MAX_WORD + 1));
        let err = Gateway::read("edge", &[("nginx.conf".to_string(), text)], &resolve).unwrap_err();
        assert!(err.contains("not nginx configuration"), "{err}");

        // With no step left, nothing is proved and a location to the service may
        // carry anything; a service no location names is still not carried.
        let g = gateway("server { location /v1/ { proxy_pass http://api:8000; } }");
        assert_eq!(g.carries("api", &route("/v1/rules")), Some("/v1/"));
        assert_eq!(g.may_carry("api", &route("/internal/x")), None);
        STEPS.set(0);
        assert_eq!(g.carries("api", &route("/v1/rules")), None);
        assert!(g.may_carry("api", &route("/internal/x")).is_some());
        assert_eq!(g.may_carry("jobs", &route("/internal/x")), None);
        refill();
        assert_eq!(g.carries("api", &route("/v1/rules")), Some("/v1/"));
    }

    /// A `return` at the level of the server answers every request, and the server
    /// proxies nothing; but a `rewrite ... break` written before it stops it for the
    /// paths it matches, which then reach the locations.
    #[test]
    fn a_server_level_return_after_a_rewrite_does_not_hide_the_locations() {
        let redirect = gateway(
            "server {\n  return 301 https://$host$request_uri;\n  location /internal/ { proxy_pass http://api:8000; }\n}\n",
        );
        assert!(redirect.unread.is_empty(), "{:?}", redirect.unread);
        assert_eq!(redirect.may_carry("api", &route("/internal/v1/x")), None);
        let g = gateway(
            "server {\n  rewrite ^/pub/(.*)$ /internal/v1/$1 break;\n  return 404;\n  location /internal/ { proxy_pass http://api:8000; }\n}\n",
        );
        assert_eq!(g.locations_to("api"), ["/internal/"]);
        assert!(g.may_carry("api", &route("/internal/v1/x")).is_some());
        assert_eq!(g.unread.len(), 2, "{:?}", g.unread);
        assert!(
            g.unread[0].contains("`rewrite` is not read"),
            "{:?}",
            g.unread
        );
    }

    #[test]
    fn a_main_configuration_with_static_files_is_read_in_full() {
        let g = gateway(
            "user nginx;\nworker_processes auto;\nerror_log /var/log/nginx/error.log notice;\nevents { worker_connections 1024; }\nhttp {\n  include /etc/nginx/mime.types;\n  default_type application/octet-stream;\n  log_format main '$remote_addr \"$request\" {$status}';\n  sendfile on;\n  gzip on;\n  map $http_upgrade $connection_upgrade { default upgrade; '' close; }\n  include /etc/nginx/conf.d/*.conf;\n  server {\n    listen 80;\n    return 301 https://$host$request_uri;\n  }\n  server {\n    listen 443 ssl;\n    ssl_certificate /etc/nginx/certs/site.pem;\n    root /usr/share/nginx/html;\n    index index.html;\n    error_page 500 502 503 504 /50x.html;\n    location = /50x.html { root /usr/share/nginx/html; }\n    location / { try_files $uri $uri/ /index.html; }\n    location ~* \\.(js|css)$ { expires 1y; add_header Cache-Control \"public\"; }\n    location ^~ /api/ {\n      limit_except GET POST { deny all; }\n      proxy_http_version 1.1;\n      proxy_set_header Upgrade $http_upgrade;\n      proxy_pass http://api:8000;\n    }\n  }\n}\n",
        );
        assert!(g.unread.is_empty(), "{:?}", g.unread);
        assert_eq!(g.locations_to("api"), ["^~ /api/"]);
        assert_eq!(g.carries("api", &route("/api/users")), Some("^~ /api/"));
        assert_eq!(g.may_carry("api", &route("/internal/users")), None);
        assert_eq!(g.carries("web", &route("/")), None);
    }

    #[test]
    fn route_templates_of_each_framework_are_read() {
        let fits = |t: &str, p: &str| route(t).matches(p);
        assert!(fits("/users/{id}", "/users/7"));
        assert!(!fits("/users/{id}", "/users/7/posts"));
        assert!(fits("/files/{rest:path}", "/files/a/b"));
        assert!(fits("/users/:id/posts", "/users/7/posts"));
        assert!(fits("/users/[id]", "/users/7"));
        assert!(fits("/api/[...path]", "/api/a/b"));
        assert!(fits("/api/rules/[[...path]]", "/api/rules"));
        assert!(fits("/api/rules/[[...path]]", "/api/rules/a"));
        assert!(fits("/blog/<int:pk>", "/blog/3"));
        assert!(fits("/static/<path:name>", "/static/a/b.css"));
        assert!(fits("/items:batch", "/items:batch"));
        // Not read from the first sign of other syntax: anything may follow.
        for t in [
            "/blog/(?P<year>[0-9]{4})",
            "/?/items",
            "/users/:id?",
            "/{{name}}/x",
        ] {
            assert!(!route(t).exact, "{t}");
        }
        assert!(
            route("/blog/(?P<year>[0-9]{4})")
                .fit("/blog/", true, true)
                .is_some()
        );
        assert!(
            route("/blog/(?P<year>[0-9]{4})")
                .fit("/shop/", true, true)
                .is_none()
        );
        assert_eq!(Route::parse("app.worker.cleanup"), None);
    }

    #[test]
    fn a_dockerfile_says_what_configuration_the_image_holds() {
        let b = dockerfile(
            "FROM node:22 AS build\nRUN npm ci && npm run build\nFROM nginx:1.27-alpine\nRUN rm /etc/nginx/conf.d/default.conf\nCOPY nginx.conf /etc/nginx/conf.d/app.conf\nCOPY --from=build /app/dist /usr/share/nginx/html\nEXPOSE 80\nCMD [\"nginx\", \"-g\", \"daemon off;\"]\n",
        )
        .unwrap();
        assert_eq!(b.base, "nginx:1.27-alpine");
        assert_eq!(
            b.copies,
            [(
                "nginx.conf".to_string(),
                "/etc/nginx/conf.d/app.conf".to_string()
            )]
        );
        assert_eq!(b.unread, None);
        let b = dockerfile("FROM nginx\nCOPY nginx.conf /etc/nginx/nginx.conf\nRUN envsubst < /t > /etc/nginx/conf.d/x.conf\n").unwrap();
        assert_eq!(
            b.unread.as_deref(),
            Some("RUN envsubst < /t > /etc/nginx/conf.d/x.conf")
        );
        assert_eq!(dockerfile("# nothing\n"), None);
        let b = dockerfile(
            "FROM nginx:alpine AS base\nFROM base AS final\nCOPY a.conf /etc/nginx/conf.d/\n",
        );
        assert_eq!(b.unwrap().base, "nginx:alpine");
    }
}
