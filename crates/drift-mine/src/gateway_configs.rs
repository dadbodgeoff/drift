//! Gateways read from their own configuration files, beside nginx
//! ([`crate::gateway`]) and the Traefik labels and Caddyfile ([`crate::proxies`]):
//! HAProxy (`haproxy.cfg`), Apache httpd (`httpd.conf` and what it includes), Envoy's
//! static configuration (`envoy.yaml`), Kong's declarative configuration (DB-less
//! `kong.yml`), and Traefik's file provider. Each is read into the rules of a
//! [`Gateway`] so that exposure behind it is each route's
//! ([`crate::security::Boundaries`]).
//!
//! Sound before complete, as the other readers: a rule whose match or whose rewrite
//! of the path Drift does not evaluate (a regular expression, a header or method
//! condition, a negation, a path rewrite) is kept as a rule that may carry anything
//! and proves nothing; what may add routes that are not in what was read (a map
//! file, Lua, dynamic configuration, a directive or a key Drift does not know) is
//! recorded as unread, and then no route is internal. A rule that answers by itself
//! (`http-request deny`, `Require all denied`, a redirect, a direct response) is a
//! rule to nowhere: no route it matches is proved carried by another, and none is
//! said to be internal on its account either.
//!
//! The configuration is found where the gateway's container has it: a file or a
//! directory a compose service mounts from the repository, or one its Dockerfile
//! copies in ([`Fs::read`]), at the path the gateway reads (its documented default,
//! or the one its command or environment names). A configuration that is not found
//! leaves the gateway as before: the services behind it are taken as a whole.
//!
//! Hostile input: every file is read once, words, nesting, includes and files are
//! capped, and nothing here recurses without a bound.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::Value;

use crate::gateway::{Gateway, Rule, Target};

/// How many files of the gateway's container are read.
const MAX_FILES: usize = 64;
/// How deep a mounted directory is listed.
const MAX_DIR_DEPTH: usize = 3;
/// The largest file read.
const MAX_BYTES: u64 = 256 * 1024;
/// How deep sections, includes and YAML nest.
const MAX_DEPTH: usize = 32;
/// How many rules one gateway may come to: past it the rest is unread.
const MAX_RULES: usize = 4096;

// ---------- the gateway's container ----------

/// The files of a gateway's container that come from the repository, by their path
/// in the container: what a compose service mounts and what its Dockerfile copies.
#[derive(Debug, Clone, Default)]
pub struct Fs {
    /// Container path -> (repo-relative path, its text; none when it cannot be read).
    files: BTreeMap<String, (String, Option<String>)>,
    /// Container paths mounted from outside the repository.
    outside: Vec<String>,
    /// Directories listed only in part.
    partial: Vec<String>,
    /// Directories a volume puts in place whole: nothing of the image's own is left
    /// in them. A directory a Dockerfile copies adds to what the image has there.
    whole: Vec<String>,
}

impl Fs {
    /// The container that `mounts` (a compose service's volumes) and `copies` (its
    /// Dockerfile's `COPY`s) describe: each a repo-relative source (none when it is
    /// outside the repository) and where it is in the container. A destination that
    /// ends with `/` holds a file under its own name, as a Dockerfile's `COPY`
    /// places it.
    pub fn read(
        root: &Path,
        mounts: &[(Option<String>, String)],
        copies: &[(Option<String>, String)],
    ) -> Fs {
        let mut fs = Fs::default();
        let all = copies
            .iter()
            .map(|x| (x, false))
            .chain(mounts.iter().map(|x| (x, true)));
        for ((source, target), mounted) in all {
            if !target.starts_with('/') {
                continue;
            }
            let Some(source) = source else {
                fs.outside.push(clean(target));
                continue;
            };
            let path = root.join(source);
            if path.is_dir() {
                if mounted {
                    fs.whole.push(clean(target));
                }
                fs.list(root, source, &clean(target), 0);
            } else {
                let at = if target.ends_with('/') {
                    let name = source.rsplit('/').next().unwrap_or(source);
                    format!("{}/{name}", clean(target))
                } else {
                    clean(target)
                };
                fs.add(root, source.clone(), at);
            }
        }
        fs
    }

    fn add(&mut self, root: &Path, repo: String, at: String) {
        if self.files.len() >= MAX_FILES {
            self.partial.push(at);
            return;
        }
        let text = std::fs::metadata(root.join(&repo))
            .ok()
            .filter(|m| m.is_file() && m.len() <= MAX_BYTES)
            .and_then(|_| std::fs::read_to_string(root.join(&repo)).ok());
        self.files.insert(at, (repo, text));
    }

    fn list(&mut self, root: &Path, repo: &str, at: &str, depth: usize) {
        let mut entries: Vec<(String, bool)> = std::fs::read_dir(root.join(repo))
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter_map(|e| {
                let name = e.file_name().to_str()?.to_string();
                let dir = e.file_type().ok()?.is_dir();
                (!name.starts_with('.')).then_some((name, dir))
            })
            .collect();
        entries.sort();
        for (name, dir) in entries {
            let (repo, at) = (format!("{repo}/{name}"), format!("{at}/{name}"));
            if dir && depth + 1 >= MAX_DIR_DEPTH {
                self.partial.push(at);
            } else if dir {
                self.list(root, &repo, &at, depth + 1);
            } else {
                self.add(root, repo, at);
            }
        }
    }

    /// The text of the file at `path` in the container: Ok(None) when the repository
    /// does not put it there, Err when it does and it cannot be read.
    fn text(&self, path: &str) -> Result<Option<(&str, &str)>, String> {
        match self.files.get(&clean(path)) {
            None => Ok(None),
            Some((repo, Some(text))) => Ok(Some((repo, text))),
            Some((repo, None)) => Err(format!("{repo}, which Drift cannot read")),
        }
    }

    /// The files directly in the directory `dir`, by container path, sorted.
    fn in_dir(&self, dir: &str) -> Vec<&str> {
        let dir = format!("{}/", clean(dir));
        self.files
            .keys()
            .filter(|k| k.strip_prefix(&dir).is_some_and(|rest| !rest.contains('/')))
            .map(String::as_str)
            .collect()
    }

    /// Why what is at `path` may not be all in the repository: it is mounted from
    /// outside it, or a directory around it was listed only in part.
    fn doubt(&self, path: &str) -> Option<String> {
        let path = clean(path);
        let under = |p: &String| path == *p || path.starts_with(&format!("{p}/"));
        let over = |p: &String| p.starts_with(&format!("{path}/"));
        self.outside
            .iter()
            .find(|p| under(p) || over(p))
            .map(|p| format!("{p}, mounted from outside the repository"))
            .or_else(|| {
                self.partial
                    .iter()
                    .find(|p| under(p) || over(p))
                    .map(|p| format!("{p}, past what Drift lists of a directory"))
            })
    }

    /// Whether every file in the directory `dir` is the repository's: a volume puts
    /// it, or a directory around it, in place.
    fn whole(&self, dir: &str) -> bool {
        let dir = clean(dir);
        self.whole
            .iter()
            .any(|w| dir == *w || dir.starts_with(&format!("{w}/")))
    }

    /// Whether the repository puts anything at or under `path`.
    fn has(&self, path: &str) -> bool {
        let path = clean(path);
        self.files
            .keys()
            .any(|k| *k == path || k.starts_with(&format!("{path}/")))
    }
}

/// `/a//b/./c/` -> `/a/b/c`.
fn clean(path: &str) -> String {
    let segs: Vec<&str> = path
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();
    format!("/{}", segs.join("/"))
}

/// What a command a compose file gives a gateway asks of it: the configuration paths
/// it names (`-f`, `-c`), and the first word Drift does not know, as written.
#[derive(Debug, Default)]
struct Command {
    configs: Vec<String>,
    unknown: Option<String>,
}

/// Reads `words` (a command, the program first or left out) as `program` reads its
/// flags: `config` the flags that name a configuration file, `with` those that take
/// a value Drift need not read, `plain` those that take none.
fn command(
    words: &[String],
    program: &str,
    config: &[&str],
    with: &[&str],
    plain: &[&str],
) -> Command {
    let mut out = Command::default();
    let mut i = 0;
    if words
        .first()
        .is_some_and(|w| w == program || w.ends_with(&format!("/{program}")))
    {
        i = 1;
    }
    while i < words.len() {
        let w = words[i].as_str();
        let (flag, inline) = match w.split_once('=') {
            Some((f, v)) if f.starts_with("--") => (f, Some(v.to_string())),
            _ => (w, None),
        };
        if config.contains(&flag) || with.contains(&flag) {
            let value = inline.or_else(|| {
                i += 1;
                words.get(i).cloned()
            });
            match value {
                Some(v) if config.contains(&flag) && !v.contains('$') => out.configs.push(v),
                Some(_) if with.contains(&flag) => {}
                _ => {
                    out.unknown.get_or_insert_with(|| w.to_string());
                }
            }
        } else if !plain.contains(&flag) {
            out.unknown.get_or_insert_with(|| w.to_string());
        }
        i += 1;
    }
    out
}

/// The service a URL or an address names, as `resolve` says: an address with a
/// variable in it, a socket, or no host cannot be told.
fn host_target(addr: &str, resolve: &dyn Fn(&str) -> Target) -> Target {
    let host = if addr.starts_with('[') {
        addr.split_inclusive(']').next().unwrap_or(addr)
    } else {
        addr.split(':').next().unwrap_or(addr)
    };
    if host.is_empty() || host.contains(['$', '{', '%', '@', '/']) {
        return Target::Unresolved;
    }
    resolve(&host.to_lowercase())
}

/// The host and path of an `http://host:port/path` URL (any scheme): none when it is
/// not one.
fn split_url(url: &str) -> Option<(&str, &str)> {
    let (_, rest) = url.split_once("://")?;
    Some(match rest.find(['/', '?']) {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    })
}

/// Several services as one target: unresolved when any is, nowhere when none is a
/// service.
fn union(targets: impl IntoIterator<Item = Target>) -> Target {
    let mut services: BTreeSet<String> = BTreeSet::new();
    for t in targets {
        match t {
            Target::Unresolved => return Target::Unresolved,
            Target::Services(s) => services.extend(s),
            Target::Nowhere => {}
        }
    }
    if services.is_empty() {
        Target::Nowhere
    } else {
        Target::Services(services.into_iter().collect())
    }
}

/// A rule that matches `path` (a prefix, or exactly) for any host.
fn rule(label: String, path: &str, exact: bool, target: Target) -> Rule {
    Rule {
        host: None,
        label,
        path: path.to_string(),
        exact,
        target,
        strip: false,
        opaque: false,
    }
}

/// A rule that may match anything and proves nothing.
fn anything(label: String, target: Target) -> Rule {
    Rule {
        opaque: true,
        ..rule(label, "/", false, target)
    }
}

/// The rules of a prefix that matches only whole segments (httpd's `<Location>` and
/// `ProxyPass`, Envoy's `path_separated_prefix`): `prefix` exactly, and every path
/// under `prefix/`.
fn segments(r: Rule) -> Vec<Rule> {
    if r.exact || r.path.ends_with('/') {
        return vec![r];
    }
    let under = Rule {
        path: format!("{}/", r.path),
        ..r.clone()
    };
    vec![Rule { exact: true, ..r }, under]
}

// ---------- HAProxy ----------

/// What a condition of HAProxy (`if` / `unless` and its terms) is known to require:
/// one alternative of it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Alt {
    host: Option<String>,
    path: Option<(String, bool)>,
    /// A term Drift does not evaluate (a negation, another fetch, a file of values).
    conditional: bool,
    /// Never true (`FALSE`, or two paths that cannot both hold).
    never: bool,
}

/// What a named or an anonymous ACL tests.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Acl {
    /// The path begins with one of these, or (`true`) is one of them.
    Path(Vec<(String, bool)>),
    /// The `Host` header is one of these.
    Host(Vec<String>),
    /// The connection is TLS (`ssl_fc`).
    Tls,
    True,
    False,
    /// Anything else.
    Other,
}

/// What `acl <name> <words>` or `{ <words> }` tests.
fn acl(words: &[String]) -> Acl {
    let Some((criterion, rest)) = words.split_first() else {
        return Acl::Other;
    };
    let c = criterion.to_lowercase();
    let mut method: Option<String> = None;
    let mut values: Vec<String> = Vec::new();
    let mut i = 0;
    while i < rest.len() {
        let w = &rest[i];
        match w.as_str() {
            "-i" | "-n" => {}
            "--" => {
                values.extend(rest[i + 1..].iter().cloned());
                break;
            }
            "-m" => {
                i += 1;
                method = rest.get(i).map(|m| m.to_lowercase());
            }
            // Values from a file, or a flag Drift does not know.
            f if f.starts_with('-') => return Acl::Other,
            _ => values.push(w.clone()),
        }
        i += 1;
    }
    match (c.as_str(), method.as_deref()) {
        ("ssl_fc", None) if values.is_empty() => Acl::Tls,
        ("path_beg", None) | ("path", Some("beg")) if !values.is_empty() => {
            Acl::Path(values.into_iter().map(|v| (v, false)).collect())
        }
        ("path", None | Some("str")) if !values.is_empty() => {
            Acl::Path(values.into_iter().map(|v| (v, true)).collect())
        }
        ("hdr(host)" | "req.hdr(host)" | "hdr(host,-1)", None | Some("str"))
            if !values.is_empty() =>
        {
            Acl::Host(values.into_iter().map(|v| v.to_lowercase()).collect())
        }
        _ => Acl::Other,
    }
}

/// Both `a` and `b` hold.
fn both(a: &[Alt], b: &[Alt]) -> Vec<Alt> {
    let mut out = Vec::new();
    for x in a {
        for y in b {
            let (host, mut never) = match (&x.host, &y.host) {
                (Some(h), Some(g)) if h != g => (None, true),
                (h, g) => (h.clone().or(g.clone()), false),
            };
            // Two paths: the longer prefix when one is under the other, the exact
            // path when it is under the prefix; otherwise nothing holds both.
            let path = match (&x.path, &y.path) {
                (Some(p), Some(q)) => match (p.1, q.1) {
                    (false, false) if p.0.starts_with(&q.0) => Some(p.clone()),
                    (false, false) if q.0.starts_with(&p.0) => Some(q.clone()),
                    (true, false) if p.0.starts_with(&q.0) => Some(p.clone()),
                    (false, true) if q.0.starts_with(&p.0) => Some(q.clone()),
                    (true, true) if p.0 == q.0 => Some(p.clone()),
                    _ => {
                        never = true;
                        None
                    }
                },
                (p, q) => p.clone().or(q.clone()),
            };
            never |= x.never || y.never;
            out.push(Alt {
                host,
                path,
                conditional: x.conditional || y.conditional,
                never,
            });
            if out.len() > 64 {
                return vec![Alt {
                    conditional: true,
                    ..Alt::default()
                }];
            }
        }
    }
    out
}

/// The alternatives of a condition: the words after `if` (`unless` is its
/// negation, `negate`). `tls_only` is set when it holds only of a connection
/// that is not TLS (`unless { ssl_fc }`): a request made over TLS passes it by.
fn condition(
    words: &[String],
    acls: &BTreeMap<String, Vec<Acl>>,
    negate: bool,
) -> (Vec<Alt>, bool) {
    let tested = |a: &Acl| -> Vec<Alt> {
        match a {
            Acl::Path(ps) => ps
                .iter()
                .map(|p| Alt {
                    path: Some(p.clone()),
                    ..Alt::default()
                })
                .collect(),
            Acl::Host(hs) => hs
                .iter()
                .map(|h| Alt {
                    host: Some(h.clone()),
                    ..Alt::default()
                })
                .collect(),
            Acl::True => vec![Alt::default()],
            Acl::False => vec![Alt {
                never: true,
                ..Alt::default()
            }],
            Acl::Tls | Acl::Other => vec![Alt {
                conditional: true,
                ..Alt::default()
            }],
        }
    };
    // Each term: (what it tests, negated).
    let mut groups: Vec<Vec<(Vec<Acl>, bool)>> = vec![Vec::new()];
    let mut i = 0;
    while i < words.len() {
        let w = words[i].as_str();
        if w == "||" || w.eq_ignore_ascii_case("or") {
            groups.push(Vec::new());
            i += 1;
            continue;
        }
        let (not, w) = match w.strip_prefix('!') {
            Some("") => {
                i += 1;
                (true, words.get(i).map_or("", String::as_str))
            }
            Some(rest) => (true, rest),
            None => (false, w),
        };
        let tests: Vec<Acl> = if w == "{" {
            let end = (i + 1..words.len()).find(|j| words[*j] == "}");
            let Some(end) = end else {
                return (
                    vec![Alt {
                        conditional: true,
                        ..Alt::default()
                    }],
                    false,
                );
            };
            let inner = acl(&words[i + 1..end]);
            i = end;
            vec![inner]
        } else {
            match w {
                "TRUE" => vec![Acl::True],
                "FALSE" => vec![Acl::False],
                _ => acls.get(w).cloned().unwrap_or_else(|| vec![Acl::Other]),
            }
        };
        if let Some(g) = groups.last_mut() {
            g.push((tests, not));
        }
        i += 1;
    }
    let only_not_tls = |g: &Vec<(Vec<Acl>, bool)>| {
        g.len() == 1 && g[0].0.iter().all(|a| *a == Acl::Tls) && g[0].1 != negate
    };
    let tls_only = groups.len() == 1 && only_not_tls(&groups[0]);
    if negate {
        return (
            vec![Alt {
                conditional: true,
                ..Alt::default()
            }],
            tls_only,
        );
    }
    let mut out = Vec::new();
    for g in groups {
        let mut alts = vec![Alt::default()];
        for (tests, not) in g {
            // An ACL named more than once holds when any of its lines does.
            let of: Vec<Alt> = if not {
                vec![Alt {
                    conditional: true,
                    ..Alt::default()
                }]
            } else {
                tests.iter().flat_map(tested).collect()
            };
            alts = both(&alts, &of);
        }
        out.extend(alts);
    }
    (out, tls_only)
}

/// The words of an HAProxy configuration line: quotes and backslash escapes read,
/// a `#` outside them starts a comment.
fn haproxy_words(line: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (None, '#') => break,
            (None, c) if c.is_whitespace() => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            (None, '"' | '\'') => {
                quote = Some(c);
                started = true;
            }
            (Some(q), c) if c == q => quote = None,
            (Some('\''), c) => word.push(c),
            (_, '\\') => {
                if let Some(n) = chars.next() {
                    word.push(n);
                }
                started = true;
            }
            (_, c) => {
                word.push(c);
                started = true;
            }
        }
        if word.len() > 512 {
            return Err("a word of more than 512 characters".to_string());
        }
    }
    if quote.is_some() {
        return Err("quote not closed".to_string());
    }
    if started {
        words.push(word);
    }
    Ok(words)
}

const HAPROXY_SECTIONS: &[&str] = &[
    "global",
    "defaults",
    "frontend",
    "backend",
    "listen",
    "resolvers",
    "peers",
    "userlist",
    "mailers",
    "cache",
    "program",
    "http-errors",
    "ring",
    "crt-store",
    "traces",
    "log-forward",
    "fcgi-app",
];

/// Keywords of a proxy section that cannot change where a request goes or the path
/// it is sent with.
const HAPROXY_INERT: &[&str] = &[
    "bind",
    "mode",
    "timeout",
    "log",
    "log-format",
    "log-format-sd",
    "log-tag",
    "error-log-format",
    "maxconn",
    "backlog",
    "capture",
    "compression",
    "description",
    "id",
    "disabled",
    "enabled",
    "unique-id-format",
    "unique-id-header",
    "declare",
    "rate-limit",
    "errorfile",
    "errorfiles",
    "errorloc",
    "errorloc302",
    "errorloc303",
    "http-error",
    "email-alert",
    "http-reuse",
    "http-response",
    "http-after-response",
    "default-server",
    "balance",
    "hash-type",
    "hash-balance-factor",
    "cookie",
    "dynamic-cookie-key",
    "http-check",
    "external-check",
    "retries",
    "retry-on",
    "fullconn",
    "source",
    "server-state-file-name",
    "load-server-state-from-file",
    "persist",
    "stick",
    "stick-table",
    "force-persist",
    "ignore-persist",
    "max-keep-alive-queue",
    "max-session-srv-conns",
    "http-send-name-header",
    "grace",
    "monitor",
    "monitor-net",
    "tcp-response",
    "tcp-check",
    "use-server",
    "use-fcgi-app",
    "guid",
    "clitcpka-cnt",
    "clitcpka-idle",
    "clitcpka-intvl",
    "srvtcpka-cnt",
    "srvtcpka-idle",
    "srvtcpka-intvl",
    "acl",
    "no",
];

/// `http-request` actions that answer by themselves: the request goes nowhere.
const HAPROXY_ANSWER: &[&str] = &[
    "deny",
    "reject",
    "tarpit",
    "silent-drop",
    "redirect",
    "return",
];

/// `http-request` actions that change the path the backend is sent.
const HAPROXY_REWRITE: &[&str] = &[
    "set-path",
    "set-pathq",
    "replace-path",
    "replace-pathq",
    "set-uri",
    "replace-uri",
];

/// `http-request` actions that cannot change where a request goes or its path.
const HAPROXY_REQUEST_INERT: &[&str] = &[
    "set-header",
    "add-header",
    "del-header",
    "replace-header",
    "replace-value",
    "set-var",
    "set-var-fmt",
    "unset-var",
    "capture",
    "track-sc0",
    "track-sc1",
    "track-sc2",
    "sc-inc-gpc",
    "sc-inc-gpc0",
    "sc-inc-gpc1",
    "sc-set-gpt",
    "sc-set-gpt0",
    "sc-add-gpc",
    "set-log-level",
    "set-nice",
    "set-tos",
    "set-mark",
    "early-hint",
    "normalize-uri",
    "wait-for-body",
    "wait-for-handshake",
    "auth",
    "allow",
    "set-timeout",
    "set-bandwidth-limit",
    "set-query",
    "set-method",
    "cache-use",
    "set-priority-class",
    "set-priority-offset",
    "strict-mode",
];

#[derive(Debug, Clone, Default)]
struct Section {
    kind: String,
    name: String,
    /// `from <defaults>`.
    from: Option<String>,
    /// (file, line, words).
    lines: Vec<(String, usize, Vec<String>)>,
}

/// What a backend sends requests to, and why its rules are not evaluated.
struct Backend {
    target: Target,
    /// It rewrites the path or answers some requests itself.
    rewrites: bool,
}

/// The HAProxy gateway `name` from its configuration `files` (repo-relative path,
/// text), in the order HAProxy loads them. One [`Gateway`] for each `frontend` and
/// `listen`, each a first match ([`Gateway::first_match`]): `http-request` rules
/// that answer by themselves, then `use_backend` in order, then `default_backend`.
///
/// Read: `acl` with `path_beg`, `path`, `hdr(host)`, `ssl_fc` (and `-i`, `-m beg`,
/// `-m str`), conditions of named and anonymous ACLs with `!`, `||` and `or`,
/// `server host:port` in a `backend` or `listen`, `mode` (a `tcp` frontend carries
/// every path). Not evaluated: any other fetch, a value file (`-f`), a negation, a
/// path rewrite, a backend chosen at run time. Not read: Lua, `use-service`,
/// `option transparent`, a section or keyword Drift does not know.
pub fn haproxy(
    name: &str,
    files: &[(String, String)],
    resolve: &dyn Fn(&str) -> Target,
) -> Result<Vec<Gateway>, String> {
    let mut sections: Vec<Section> = Vec::new();
    for (file, text) in files {
        for (n, raw) in text.lines().enumerate() {
            let words = haproxy_words(raw).map_err(|e| format!("{file}: line {}: {e}", n + 1))?;
            let Some(first) = words.first() else { continue };
            if HAPROXY_SECTIONS.contains(&first.as_str()) {
                let named: Vec<&String> = words[1..].iter().collect();
                sections.push(Section {
                    kind: first.clone(),
                    name: named.first().map(|s| s.to_string()).unwrap_or_default(),
                    from: match named.as_slice() {
                        [_, from, d] if *from == "from" => Some(d.to_string()),
                        [from, d] if *from == "from" => Some(d.to_string()),
                        _ => None,
                    },
                    lines: Vec::new(),
                });
            } else if let Some(s) = sections.last_mut() {
                s.lines.push((file.clone(), n + 1, words));
            } else {
                return Err(format!(
                    "{file}: line {}: not HAProxy configuration (`{first}` outside a section)",
                    n + 1
                ));
            }
        }
    }
    let mut shared: Vec<String> = Vec::new();
    let at = |f: &str, n: usize, w: &[String], why: &str| {
        format!(
            "{f}:{n}: `{}` {why}",
            w.iter().take(2).cloned().collect::<Vec<_>>().join(" ")
        )
    };
    // Backends, and the servers of `listen` sections, by name.
    let mut backends: BTreeMap<String, Backend> = BTreeMap::new();
    for s in sections
        .iter()
        .filter(|s| s.kind == "backend" || s.kind == "listen")
    {
        let mut targets: Vec<Target> = Vec::new();
        let mut rewrites = false;
        for (f, n, w) in &s.lines {
            match w[0].as_str() {
                "server" => targets.push(match w.get(2) {
                    Some(addr) => host_target(addr, resolve),
                    None => Target::Unresolved,
                }),
                "server-template" => targets.push(Target::Unresolved),
                // In a `listen`, what its own frontend reads.
                "http-request" if s.kind == "backend" => {
                    let action = w.get(1).map_or("", String::as_str);
                    if HAPROXY_ANSWER.contains(&action) || HAPROXY_REWRITE.contains(&action) {
                        rewrites = true;
                    } else if !HAPROXY_REQUEST_INERT.contains(&action) {
                        shared.push(at(f, *n, w, "is not read"));
                        rewrites = true;
                    }
                }
                "option"
                    if w.get(1)
                        .is_some_and(|o| o == "transparent" || o == "http_proxy") =>
                {
                    shared.push(at(f, *n, w, "sends requests where the client asks"));
                    targets.push(Target::Unresolved);
                }
                k if s.kind == "backend" && !HAPROXY_INERT.contains(&k) && k != "option" => {
                    shared.push(at(f, *n, w, "is not read"));
                    rewrites = true;
                }
                _ => {}
            }
        }
        if targets.contains(&Target::Unresolved) {
            shared.push(format!(
                "{}: backend {} has a server Drift cannot resolve",
                files.first().map_or("", |(f, _)| f.as_str()),
                s.name
            ));
        }
        backends.insert(
            s.name.clone(),
            Backend {
                target: union(targets),
                rewrites,
            },
        );
    }
    for s in &sections {
        match s.kind.as_str() {
            "frontend" | "listen" | "backend" | "defaults" => {}
            "global" => {
                for (f, n, w) in &s.lines {
                    if w[0].starts_with("lua-") {
                        shared.push(at(f, *n, w, "loads Lua, which Drift does not read"));
                    }
                }
            }
            "program" => shared.push(format!(
                "`program {}` runs a program Drift does not read",
                s.name
            )),
            // Name servers, peers, users, mail, caches, error pages, logs: they
            // route nothing.
            _ => {}
        }
    }
    let files_read: Vec<String> = files.iter().map(|(f, _)| f.clone()).collect();
    let mut gateways = Vec::new();
    // The defaults section in force: the last one before, or the one named.
    let mut defaults: Option<&Section> = None;
    for s in &sections {
        if s.kind == "defaults" {
            defaults = Some(s);
            for (f, n, w) in &s.lines {
                let k = w[0].as_str();
                if !(HAPROXY_INERT.contains(&k) || k == "option" || k == "default_backend") {
                    shared.push(at(f, *n, w, "in a defaults section is not read"));
                }
            }
            continue;
        }
        if s.kind != "frontend" && s.kind != "listen" {
            continue;
        }
        let defaults = match &s.from {
            Some(d) => sections
                .iter()
                .find(|x| x.kind == "defaults" && x.name == *d),
            None => defaults,
        };
        let mut unread: Vec<String> = Vec::new();
        let inherited = defaults.into_iter().flat_map(|d| &d.lines);
        let mode = s
            .lines
            .iter()
            .rev()
            .chain(inherited.clone().rev())
            .find(|(_, _, w)| w[0] == "mode")
            .and_then(|(_, _, w)| w.get(1).cloned())
            .unwrap_or_else(|| "tcp".to_string());
        let http = mode == "http";
        let mut acls: BTreeMap<String, Vec<Acl>> = BTreeMap::new();
        for (_, _, w) in &s.lines {
            if w[0] == "acl"
                && let Some(n) = w.get(1)
            {
                acls.entry(n.clone()).or_default().push(acl(&w[2..]));
            }
        }
        let mut answers: Vec<Rule> = Vec::new();
        let mut routes: Vec<Rule> = Vec::new();
        let mut rewrites = false;
        let mut default: Option<String> = inherited
            .clone()
            .filter(|(_, _, w)| w[0] == "default_backend")
            .filter_map(|(_, _, w)| w.get(1).cloned())
            .next_back();
        // `if` / `unless` and what follows, from `from` on.
        let cond = |w: &[String], from: usize| -> Option<(Vec<Alt>, bool)> {
            let i = (from..w.len()).find(|i| w[*i] == "if" || w[*i] == "unless")?;
            Some(condition(&w[i + 1..], &acls, w[i] == "unless"))
        };
        let rules_of = |alts: &[Alt], label: &str, target: &Target, opaque: bool| -> Vec<Rule> {
            alts.iter()
                .filter(|a| !a.never)
                .map(|a| {
                    let (path, exact) = a.path.clone().unwrap_or(("/".to_string(), false));
                    Rule {
                        host: a.host.clone(),
                        label: label.to_string(),
                        path,
                        exact,
                        target: target.clone(),
                        strip: false,
                        opaque: opaque || a.conditional || !http,
                    }
                })
                .collect()
        };
        let backend = |b: &str, unread: &mut Vec<String>, label: &str| -> (Target, bool) {
            if b.contains("%[") {
                unread.push(format!("{label}: a backend chosen at run time is not read"));
                return (Target::Unresolved, true);
            }
            match backends.get(b) {
                Some(x) => (x.target.clone(), x.rewrites),
                None => {
                    unread.push(format!("{label}: backend {b} is not defined"));
                    (Target::Unresolved, true)
                }
            }
        };
        for (f, n, w) in &s.lines {
            let label = w.join(" ");
            let k = w[0].as_str();
            match k {
                "use_backend" => {
                    let Some(b) = w.get(1) else { continue };
                    let (target, opaque) = backend(b, &mut unread, &format!("{f}:{n}"));
                    let alts = match cond(w, 2) {
                        Some((alts, _)) => alts,
                        None => vec![Alt::default()],
                    };
                    routes.extend(rules_of(&alts, &label, &target, opaque));
                }
                "default_backend" => default = w.get(1).cloned(),
                "http-request" if http => {
                    let action = w.get(1).map_or("", String::as_str);
                    if HAPROXY_ANSWER.contains(&action) {
                        let (alts, tls_only) = cond(w, 2).unwrap_or((vec![Alt::default()], false));
                        // A redirect of plain HTTP to HTTPS: the same request over TLS
                        // passes.
                        if !(tls_only && action == "redirect") {
                            answers.extend(rules_of(&alts, &label, &Target::Nowhere, false));
                        }
                    } else if HAPROXY_REWRITE.contains(&action) {
                        rewrites = true;
                    } else if !HAPROXY_REQUEST_INERT.contains(&action) {
                        unread.push(at(f, *n, w, "is not read"));
                        rewrites = true;
                    }
                }
                "redirect" if http => {
                    let (alts, tls_only) = cond(w, 1).unwrap_or((vec![Alt::default()], false));
                    if !tls_only {
                        answers.extend(rules_of(&alts, &label, &Target::Nowhere, false));
                    }
                }
                "monitor-uri" if http => {
                    if let Some(p) = w.get(1) {
                        answers.push(rule(label, p, true, Target::Nowhere));
                    }
                }
                "stats" if http && w.get(1).is_some_and(|x| x == "uri" || x == "enable") => {
                    let p = if w[1] == "uri" {
                        w.get(2).cloned()
                    } else {
                        None
                    };
                    answers.push(rule(
                        label,
                        p.as_deref().unwrap_or("/haproxy?stats"),
                        false,
                        Target::Nowhere,
                    ));
                }
                "tcp-request" => {
                    if w.iter().any(|x| {
                        x == "use-service"
                            || x == "switch-mode"
                            || x.starts_with("lua.")
                            || x.starts_with("set-dst")
                    }) {
                        unread.push(at(f, *n, w, "is not read"));
                        rewrites = true;
                    }
                }
                "filter" => {
                    let kind = w.get(1).map_or("", String::as_str);
                    if !["compression", "cache", "trace", "bwlim-in", "bwlim-out"].contains(&kind) {
                        unread.push(at(f, *n, w, "is not read"));
                        rewrites = true;
                    }
                }
                "option"
                    if w.get(1)
                        .is_some_and(|o| o == "transparent" || o == "http_proxy") =>
                {
                    unread.push(at(f, *n, w, "sends requests where the client asks"));
                    routes.push(anything(label, Target::Unresolved));
                }
                "server" | "server-template" | "http-request" | "redirect" | "monitor-uri"
                | "stats" | "option" => {}
                k if HAPROXY_INERT.contains(&k) => {}
                _ => {
                    unread.push(at(f, *n, w, "is not read"));
                    rewrites = true;
                }
            }
        }
        // A `listen` with servers of its own sends there what nothing else takes.
        if default.is_none()
            && s.kind == "listen"
            && backends
                .get(&s.name)
                .is_some_and(|b| b.target != Target::Nowhere)
        {
            default = Some(s.name.clone());
        }
        if let Some(b) = &default {
            let label = format!("default_backend {b}");
            let (target, opaque) = backend(b, &mut unread, &format!("{} {}", s.kind, s.name));
            routes.push(Rule {
                opaque,
                ..rule(label, "/", false, target)
            });
        }
        let mut rules = answers;
        rules.extend(routes.into_iter().map(|r| Rule {
            opaque: r.opaque || rewrites,
            ..r
        }));
        if rules.len() > MAX_RULES {
            rules.truncate(MAX_RULES);
            unread.push(format!(
                "{} {}: more rules than Drift reads",
                s.kind, s.name
            ));
        }
        gateways
            .push(Gateway::of_rules(name, files_read.clone(), "rule", rules, unread).first_match());
    }
    Ok(with_shared(name, files_read, "rule", gateways, shared))
}

/// `gateways`, the first carrying what is not read of the configuration as a whole
/// (`shared`); one with no rules when there is none, so that it is said.
fn with_shared(
    name: &str,
    files: Vec<String>,
    noun: &'static str,
    mut gateways: Vec<Gateway>,
    shared: Vec<String>,
) -> Vec<Gateway> {
    if gateways.is_empty() {
        gateways.push(Gateway::of_rules(name, files, noun, Vec::new(), Vec::new()));
    }
    gateways[0].unread.splice(0..0, shared);
    gateways
}

/// The HAProxy gateway of a container (`fs`), started with `words` (its compose
/// `command`, when it has one): the files `-f` names (a directory for the `.cfg`
/// files in it), else `/usr/local/etc/haproxy/haproxy.cfg`, as the official image
/// starts it. None when the repository puts none of them there.
pub fn haproxy_at(
    name: &str,
    fs: &Fs,
    words: Option<&[String]>,
    resolve: &dyn Fn(&str) -> Target,
) -> Result<Option<Vec<Gateway>>, String> {
    const DEFAULT: &str = "/usr/local/etc/haproxy/haproxy.cfg";
    let mut unread = Vec::new();
    let mut paths = vec![DEFAULT.to_string()];
    if let Some(words) = words {
        let c = command(
            words,
            "haproxy",
            &["-f"],
            &["-p", "-L", "-sf", "-st"],
            &["-W", "-Ws", "-db", "-q", "-V", "-dr", "-dW"],
        );
        if let Some(w) = c.unknown {
            unread.push(format!("its command (`{w}`)"));
        }
        if !c.configs.is_empty() {
            paths = c.configs;
        }
    }
    let mut files: Vec<(String, String)> = Vec::new();
    for p in &paths {
        let listed: Vec<String> = if fs.in_dir(p).is_empty() {
            vec![p.clone()]
        } else {
            // A directory: its `.cfg` files, and the image may hold others there.
            if !fs.whole(p) {
                unread.push(format!("what else the image holds in {p}"));
            }
            fs.in_dir(p)
                .into_iter()
                .filter(|f| f.ends_with(".cfg"))
                .map(str::to_string)
                .collect()
        };
        for f in listed {
            match fs.text(&f)? {
                Some((repo, text)) => files.push((repo.to_string(), text.to_string())),
                None => unread.extend(
                    fs.doubt(&f)
                        .or_else(|| Some(format!("{f}, which is not in the repository"))),
                ),
            }
        }
        unread.extend(fs.doubt(p));
    }
    if files.is_empty() {
        return Ok(None);
    }
    let mut gateways = haproxy(name, &files, resolve)?;
    gateways[0].unread.splice(
        0..0,
        unread
            .into_iter()
            .map(|w| format!("gateway {name}: {w} is not read")),
    );
    Ok(Some(gateways))
}

// ---------- Envoy ----------

/// The last part of a typed configuration's `@type`, or of a filter's name, in lower
/// case: `type.googleapis.com/envoy...v3.HttpConnectionManager` ->
/// `httpconnectionmanager`, `envoy.filters.http.router` -> `router`.
fn kind_of(filter: &Value) -> String {
    let typed = filter
        .get("typed_config")
        .and_then(|t| t.get("@type"))
        .and_then(Value::as_str)
        .map(|t| t.rsplit('.').next().unwrap_or(t).to_string());
    typed
        .or_else(|| {
            let n = filter.get("name")?.as_str()?;
            Some(n.rsplit('.').next().unwrap_or(n).to_string())
        })
        .unwrap_or_default()
        .to_lowercase()
        .replace('_', "")
}

/// HTTP filters that cannot change where a request goes or its path.
const ENVOY_INERT_HTTP: &[&str] = &[
    "router",
    "cors",
    "jwtauthn",
    "jwtauthentication",
    "extauthz",
    "rbac",
    "buffer",
    "compressor",
    "gzip",
    "decompressor",
    "grpcweb",
    "localratelimit",
    "ratelimit",
    "fault",
    "healthcheck",
    "headertometadata",
    "grpcstats",
    "csrf",
    "oauth2",
    "admissioncontrol",
    "bandwidthlimit",
    "adaptiveconcurrency",
    "iptagging",
    "basicauth",
    "apikeyauth",
    "cache",
    "headermutation",
];

/// Network filters that cannot change where a connection goes.
const ENVOY_INERT_NETWORK: &[&str] = &[
    "rbac",
    "ratelimit",
    "localratelimit",
    "extauthz",
    "connectionlimit",
    "clientsslauth",
];

/// The Envoy gateway `name` from its static configuration `text` (YAML or JSON, the
/// file `file`). One [`Gateway`] for each listener, each a first match: its virtual
/// hosts (`domains`), and their routes in order.
///
/// Read: `match` by `prefix`, `path` and `path_separated_prefix`; `route` to a
/// `cluster` or `weighted_clusters`, with a `prefix_rewrite` that is the prefix
/// itself or takes it off; `request_mirror_policies`; `redirect` and
/// `direct_response` (they answer by themselves); a `tcp_proxy`; clusters with
/// `load_assignment` or `hosts` addresses. Not evaluated: `safe_regex` and any other
/// match, `headers`, `query_parameters`, `grpc`, `runtime_fraction`, other
/// rewrites. Not read: RDS, scoped routes, `dynamic_resources`, EDS clusters, an HTTP
/// or network filter that may route or rewrite (Lua, Wasm, external processing).
pub fn envoy(
    name: &str,
    file: &str,
    text: &str,
    resolve: &dyn Fn(&str) -> Target,
) -> Result<Vec<Gateway>, String> {
    let v: Value = serde_saphyr::from_str(text).map_err(|e| format!("{file}: {e}"))?;
    let Some(top) = v.as_object() else {
        return Err(format!("{file}: not Envoy configuration"));
    };
    let mut shared: Vec<String> = Vec::new();
    for key in ["dynamic_resources", "bootstrap_extensions"] {
        if top.contains_key(key) {
            shared.push(format!("{file}: `{key}`"));
        }
    }
    let statics = top.get("static_resources");
    let arr = |v: Option<&Value>, k: &str| -> Vec<Value> {
        v.and_then(|x| x.get(k))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    // Clusters by name: what their endpoints are.
    let mut clusters: BTreeMap<String, Target> = BTreeMap::new();
    for c in arr(statics, "clusters") {
        let Some(n) = c.get("name").and_then(Value::as_str) else {
            continue;
        };
        let kind = c
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("STATIC")
            .to_uppercase();
        let mut targets: Vec<Target> = Vec::new();
        let socket = |a: &Value| -> Target {
            match a
                .get("socket_address")
                .and_then(|s| s.get("address"))
                .and_then(Value::as_str)
            {
                Some(h) => host_target(h, resolve),
                None => Target::Unresolved,
            }
        };
        let dynamic = !["STATIC", "STRICT_DNS", "LOGICAL_DNS"].contains(&kind.as_str())
            || c.get("cluster_type").is_some();
        if dynamic {
            targets.push(Target::Unresolved);
            shared.push(format!(
                "{file}: cluster {n} (type {kind}) has endpoints Drift does not read"
            ));
        }
        for e in arr(c.get("load_assignment"), "endpoints") {
            for lb in arr(Some(&e), "lb_endpoints") {
                match lb.get("endpoint").and_then(|x| x.get("address")) {
                    Some(a) => targets.push(socket(a)),
                    None => targets.push(Target::Unresolved),
                }
            }
        }
        for h in arr(Some(&c), "hosts") {
            targets.push(socket(&h));
        }
        let t = union(targets);
        if t == Target::Unresolved && !dynamic {
            shared.push(format!(
                "{file}: cluster {n} has an endpoint Drift cannot resolve"
            ));
        }
        clusters.insert(n.to_string(), t);
    }
    let cluster = |n: Option<&str>, unread: &mut Vec<String>| -> Target {
        match n.and_then(|n| clusters.get(n)) {
            Some(t) => t.clone(),
            None => {
                unread.push(format!(
                    "{file}: cluster {} is not defined",
                    n.unwrap_or("?")
                ));
                Target::Unresolved
            }
        }
    };
    let mut gateways = Vec::new();
    for l in arr(statics, "listeners") {
        let lname = l
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("listener")
            .to_string();
        let mut unread: Vec<String> = Vec::new();
        let mut rules: Vec<Rule> = Vec::new();
        if l.get("use_original_dst").and_then(Value::as_bool) == Some(true)
            || arr(Some(&l), "listener_filters")
                .iter()
                .any(|f| kind_of(f).contains("originaldst"))
        {
            unread.push(format!(
                "{file}: listener {lname} sends connections to their original destination"
            ));
        }
        let mut chains = arr(Some(&l), "filter_chains");
        chains.extend(l.get("default_filter_chain").cloned());
        for chain in &chains {
            // A chain a client chooses by the name it asks for (SNI, ALPN) is one it
            // can reach; one chosen by address or port may not be.
            let matched = chain
                .get("filter_chain_match")
                .and_then(Value::as_object)
                .is_some_and(|m| {
                    m.keys().any(|k| {
                        ![
                            "server_names",
                            "transport_protocol",
                            "application_protocols",
                        ]
                        .contains(&k.as_str())
                    })
                });
            for f in arr(Some(chain), "filters") {
                let kind = kind_of(&f);
                let config = f.get("typed_config").or_else(|| f.get("config"));
                if kind == "httpconnectionmanager" {
                    let Some(hcm) = config else { continue };
                    for hf in arr(Some(hcm), "http_filters") {
                        let k = kind_of(&hf);
                        if !ENVOY_INERT_HTTP.contains(&k.as_str()) {
                            unread.push(format!(
                                "{file}: listener {lname}: HTTP filter {k} is not read"
                            ));
                        }
                    }
                    if hcm.get("rds").is_some() || hcm.get("scoped_routes").is_some() {
                        unread.push(format!(
                            "{file}: listener {lname}: routes from RDS are not read"
                        ));
                        rules.push(anything(
                            format!("routes of listener {lname} from RDS"),
                            Target::Unresolved,
                        ));
                        continue;
                    }
                    for vh in arr(hcm.get("route_config"), "virtual_hosts") {
                        let vname = vh
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("?")
                            .to_string();
                        let domains: Vec<Option<String>> = arr(Some(&vh), "domains")
                            .iter()
                            .filter_map(Value::as_str)
                            .map(|d| (!d.contains('*')).then(|| d.to_lowercase()))
                            .collect();
                        let domains = if domains.is_empty() || domains.contains(&None) {
                            vec![None]
                        } else {
                            domains
                        };
                        for r in arr(Some(&vh), "routes") {
                            let of = envoy_route(&r, &vname, &cluster, &mut unread);
                            for host in &domains {
                                rules.extend(of.iter().cloned().map(|x| Rule {
                                    host: host.clone(),
                                    opaque: x.opaque || matched,
                                    ..x
                                }));
                            }
                        }
                    }
                } else if kind == "tcpproxy" {
                    let Some(tp) = config else { continue };
                    let targets: Vec<Target> = match tp.get("cluster").and_then(Value::as_str) {
                        Some(c) => vec![cluster(Some(c), &mut unread)],
                        None => arr(tp.get("weighted_clusters"), "clusters")
                            .iter()
                            .map(|c| cluster(c.get("name").and_then(Value::as_str), &mut unread))
                            .collect(),
                    };
                    let label = format!("tcp_proxy of listener {lname}");
                    let target = union(targets);
                    rules.push(if matched {
                        anything(label, target)
                    } else {
                        rule(label, "/", false, target)
                    });
                } else if !ENVOY_INERT_NETWORK.contains(&kind.as_str()) {
                    unread.push(format!(
                        "{file}: listener {lname}: network filter {kind} is not read"
                    ));
                }
            }
        }
        if rules.len() > MAX_RULES {
            rules.truncate(MAX_RULES);
            unread.push(format!(
                "{file}: listener {lname}: more routes than Drift reads"
            ));
        }
        gateways.push(
            Gateway::of_rules(name, vec![file.to_string()], "route", rules, unread).first_match(),
        );
    }
    Ok(with_shared(
        name,
        vec![file.to_string()],
        "route",
        gateways,
        shared,
    ))
}

/// The rules of one Envoy route of the virtual host `vhost`.
fn envoy_route(
    r: &Value,
    vhost: &str,
    cluster: &dyn Fn(Option<&str>, &mut Vec<String>) -> Target,
    unread: &mut Vec<String>,
) -> Vec<Rule> {
    let m = r.get("match").cloned().unwrap_or(Value::Null);
    let s = |k: &str| m.get(k).and_then(Value::as_str);
    let (path, exact, segmented) = match (s("prefix"), s("path"), s("path_separated_prefix")) {
        (Some(p), None, None) => (Some(p), false, false),
        (None, Some(p), None) => (Some(p), true, false),
        (None, None, Some(p)) => (Some(p), false, true),
        _ => (None, false, false),
    };
    let conditional = path.is_none()
        || [
            "headers",
            "query_parameters",
            "grpc",
            "runtime_fraction",
            "dynamic_metadata",
            "filter_state",
            "tls_context",
        ]
        .iter()
        .any(|k| m.get(*k).is_some());
    let path = path
        .map(|p| if p.is_empty() { "/" } else { p })
        .unwrap_or("/");
    let label = format!(
        "{} (virtual host {vhost})",
        match (s("prefix"), s("path"), s("path_separated_prefix")) {
            (Some(p), _, _) => format!("prefix {p}"),
            (_, Some(p), _) => format!("path {p}"),
            (_, _, Some(p)) => format!("path_separated_prefix {p}"),
            _ => "a match Drift does not evaluate".to_string(),
        }
    );
    let made = |target: Target, strip: bool, opaque: bool| -> Vec<Rule> {
        let r = Rule {
            host: None,
            label: label.clone(),
            path: path.to_string(),
            exact,
            target,
            strip,
            opaque: opaque || conditional,
        };
        if segmented { segments(r) } else { vec![r] }
    };
    if r.get("redirect").is_some()
        || r.get("direct_response").is_some()
        || r.get("non_forwarding_action").is_some()
    {
        return made(Target::Nowhere, false, false);
    }
    let Some(action) = r.get("route") else {
        unread.push(format!("route {label}: its action is not read"));
        return made(Target::Unresolved, false, true);
    };
    let target = if let Some(c) = action.get("cluster").and_then(Value::as_str) {
        cluster(Some(c), unread)
    } else if let Some(w) = action.get("weighted_clusters") {
        union(
            w.get("clusters")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|c| cluster(c.get("name").and_then(Value::as_str), unread))
                .collect::<Vec<_>>(),
        )
    } else {
        unread.push(format!(
            "route {label}: a cluster chosen at run time is not read"
        ));
        Target::Unresolved
    };
    // The prefix it takes off, as far as it is read.
    let (strip, rewrites) = match action.get("prefix_rewrite").and_then(Value::as_str) {
        None => (false, false),
        Some(p) if p == path && !exact => (false, false),
        Some("/") if path.ends_with('/') && !exact && !segmented => (true, false),
        Some(_) => (false, true),
    };
    let rewrites = rewrites
        || ["regex_rewrite", "path_rewrite_policy"]
            .iter()
            .any(|k| action.get(*k).is_some());
    let mut out = made(target, strip, rewrites);
    // A mirror is sent a copy of what the route carries.
    for mirror in action
        .get("request_mirror_policies")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let t = cluster(mirror.get("cluster").and_then(Value::as_str), unread);
        out.extend(made(t, strip, true));
    }
    out
}

/// The Envoy gateway of a container (`fs`), started with `words`: the file `-c` or
/// `--config-path` names, else `/etc/envoy/envoy.yaml`, as the official image
/// starts it. None when the repository does not put it there.
pub fn envoy_at(
    name: &str,
    fs: &Fs,
    words: Option<&[String]>,
    resolve: &dyn Fn(&str) -> Target,
) -> Result<Option<Vec<Gateway>>, String> {
    let mut unread = Vec::new();
    let mut path = "/etc/envoy/envoy.yaml".to_string();
    if let Some(words) = words {
        let c = command(
            words,
            "envoy",
            &["-c", "--config-path"],
            &[
                "-l",
                "--log-level",
                "--service-cluster",
                "--service-node",
                "--service-zone",
                "--component-log-level",
                "--base-id",
                "--concurrency",
                "--drain-time-s",
                "--parent-shutdown-time-s",
                "--log-format",
                "--log-path",
            ],
            &[
                "--disable-hot-restart",
                "--use-dynamic-base-id",
                "--enable-fine-grain-logging",
            ],
        );
        if let Some(w) = c.unknown {
            unread.push(format!("its command (`{w}`)"));
        }
        if let Some(p) = c.configs.last() {
            path = p.clone();
        }
    }
    let Some((repo, text)) = fs.text(&path)? else {
        return Ok(None);
    };
    unread.extend(fs.doubt(&path));
    let mut gateways = envoy(name, repo, text, resolve)?;
    gateways[0].unread.splice(
        0..0,
        unread
            .into_iter()
            .map(|w| format!("gateway {name}: {w} is not read")),
    );
    Ok(Some(gateways))
}

// ---------- Kong ----------

/// Kong plugins that cannot change which upstream a request reaches or the path it
/// is sent: authentication, limits, logs, metrics, response transforms, answering
/// by itself. Their guards are not credited: a route is still forwarded.
const KONG_INERT_PLUGINS: &[&str] = &[
    "key-auth",
    "key-auth-enc",
    "jwt",
    "basic-auth",
    "hmac-auth",
    "ldap-auth",
    "ldap-auth-advanced",
    "oauth2",
    "oauth2-introspection",
    "openid-connect",
    "session",
    "acl",
    "cors",
    "ip-restriction",
    "bot-detection",
    "rate-limiting",
    "rate-limiting-advanced",
    "response-ratelimiting",
    "request-size-limiting",
    "request-termination",
    "response-transformer",
    "response-transformer-advanced",
    "correlation-id",
    "prometheus",
    "datadog",
    "statsd",
    "statsd-advanced",
    "zipkin",
    "opentelemetry",
    "file-log",
    "http-log",
    "tcp-log",
    "udp-log",
    "syslog",
    "loggly",
    "acme",
    "proxy-cache",
    "proxy-cache-advanced",
    "mtls-auth",
    "canary",
];

/// The top-level keys of a declarative configuration that route nothing.
const KONG_KEYS: &[&str] = &[
    "_format_version",
    "_transform",
    "_workspace",
    "_comment",
    "_info",
    "services",
    "routes",
    "upstreams",
    "plugins",
    "consumers",
    "consumer_groups",
    "certificates",
    "ca_certificates",
    "snis",
    "vaults",
    "keys",
    "key_sets",
];

/// The Kong gateway `name` from its declarative configuration `text` (YAML or JSON,
/// the file `file`).
///
/// Read: `services` (`url`, or `protocol`, `host`, `port`, `path`), their `routes`
/// and the top-level `routes` that name a service, `paths` (a prefix each),
/// `hosts`, `strip_path` (taken off a service that has no path), `upstreams` and
/// their `targets`. Not evaluated, so that a route may carry anything: a path with a
/// regular expression, `methods`, `headers`, `snis`, `sources`, an `expression`, a
/// protocol other than HTTP, a service path a stripped prefix would be joined to.
/// Not read: a plugin that may change the upstream or the path (any not on the list
/// of those that cannot), a reference to a vault or an environment variable, a key
/// Drift does not know. Plugins are not credited as guards.
pub fn kong(
    name: &str,
    file: &str,
    text: &str,
    resolve: &dyn Fn(&str) -> Target,
) -> Result<Gateway, String> {
    let v: Value = serde_saphyr::from_str(text).map_err(|e| format!("{file}: {e}"))?;
    let Some(top) = v.as_object() else {
        return Err(format!("{file}: not a Kong declarative configuration"));
    };
    let mut unread: Vec<String> = Vec::new();
    for k in top.keys().filter(|k| !KONG_KEYS.contains(&k.as_str())) {
        unread.push(format!("{file}: `{k}`"));
    }
    let list = |v: Option<&Value>| -> Vec<Value> {
        v.and_then(Value::as_array).cloned().unwrap_or_default()
    };
    let str_of = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    // Every plugin, wherever it is attached.
    let mut plugins: Vec<String> = list(top.get("plugins"))
        .iter()
        .filter_map(|p| str_of(p, "name"))
        .collect();
    for holder in ["services", "routes", "consumers"] {
        for x in list(top.get(holder)) {
            plugins.extend(
                list(x.get("plugins"))
                    .iter()
                    .filter_map(|p| str_of(p, "name")),
            );
            for r in list(x.get("routes")) {
                plugins.extend(
                    list(r.get("plugins"))
                        .iter()
                        .filter_map(|p| str_of(p, "name")),
                );
            }
        }
    }
    plugins.sort();
    plugins.dedup();
    for p in plugins
        .iter()
        .filter(|p| !KONG_INERT_PLUGINS.contains(&p.to_lowercase().as_str()))
    {
        unread.push(format!(
            "{file}: plugin {p} may change where a request goes or its path"
        ));
    }
    let upstreams: BTreeMap<String, Target> = list(top.get("upstreams"))
        .iter()
        .filter_map(|u| {
            let n = str_of(u, "name")?.to_lowercase();
            let t = union(list(u.get("targets")).iter().map(|t| {
                str_of(t, "target").map_or(Target::Unresolved, |a| host_target(&a, resolve))
            }));
            Some((n, t))
        })
        .collect();
    // Each service: what it sends to, and the path it adds (none: no path).
    let mut services: BTreeMap<String, (Target, Option<String>, bool)> = BTreeMap::new();
    let service_of = |s: &Value, unread: &mut Vec<String>| -> (Target, Option<String>, bool) {
        let (host, path, protocol) = match str_of(s, "url") {
            Some(u) => match split_url(&u) {
                Some((h, p)) => (
                    h.to_string(),
                    (!p.is_empty()).then(|| p.to_string()),
                    u.split("://").next().unwrap_or("").to_lowercase(),
                ),
                None => (String::new(), None, String::new()),
            },
            None => (
                str_of(s, "host").unwrap_or_default(),
                str_of(s, "path"),
                str_of(s, "protocol")
                    .unwrap_or_else(|| "http".to_string())
                    .to_lowercase(),
            ),
        };
        let h = host.split(':').next().unwrap_or("").to_lowercase();
        let target = match upstreams.get(&h) {
            Some(t) => t.clone(),
            None => host_target(&host, resolve),
        };
        if target == Target::Unresolved {
            unread.push(format!(
                "{file}: service {} names a host Drift cannot resolve",
                str_of(s, "name").unwrap_or_default()
            ));
        }
        (target, path, protocol == "http" || protocol == "https")
    };
    let mut rules: Vec<Rule> = Vec::new();
    let route_rules = |r: &Value,
                       svc: Option<(Target, Option<String>, bool)>,
                       rules: &mut Vec<Rule>| {
        let rname = str_of(r, "name").unwrap_or_else(|| "?".to_string());
        let Some((target, spath, http)) = svc else {
            rules.push(anything(format!("route {rname}"), Target::Nowhere));
            return;
        };
        let strip = r.get("strip_path").and_then(Value::as_bool).unwrap_or(true);
        let protocols: Vec<String> = list(r.get("protocols"))
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_lowercase)
            .collect();
        let conditional = !http
            || protocols.iter().any(|p| p != "http" && p != "https")
            || [
                "methods",
                "headers",
                "snis",
                "sources",
                "destinations",
                "expression",
            ]
            .iter()
            .any(|k| {
                r.get(*k)
                    .is_some_and(|x| !x.is_null() && x.as_array().is_none_or(|a| !a.is_empty()))
            });
        let mut paths: Vec<String> = list(r.get("paths"))
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        if paths.is_empty() {
            paths.push("/".to_string());
        }
        let hosts: Vec<Option<String>> = {
            let hs: Vec<Option<String>> = list(r.get("hosts"))
                .iter()
                .filter_map(Value::as_str)
                .map(|h| (!h.contains('*')).then(|| h.to_lowercase()))
                .collect();
            if hs.is_empty() || hs.contains(&None) {
                vec![None]
            } else {
                hs
            }
        };
        for p in &paths {
            let plain = p.starts_with('/')
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "/-_~%".contains(c));
            // A stripped prefix joined to a path of the service is not modelled.
            let joined = strip && spath.is_some();
            let unjoined = !strip && spath.as_deref().is_some_and(|sp| sp != p && !sp.is_empty());
            for h in &hosts {
                rules.push(Rule {
                    host: h.clone(),
                    label: format!("route {rname} ({p})"),
                    path: if plain { p.clone() } else { "/".to_string() },
                    exact: false,
                    target: target.clone(),
                    strip: strip && p != "/",
                    opaque: !plain || conditional || joined || unjoined,
                });
            }
        }
    };
    for s in list(top.get("services")) {
        let got = service_of(&s, &mut unread);
        if let Some(n) = str_of(&s, "name") {
            services.insert(n.clone(), got.clone());
        }
        for r in list(s.get("routes")) {
            route_rules(&r, Some(got.clone()), &mut rules);
        }
    }
    for r in list(top.get("routes")) {
        let named = match r.get("service") {
            Some(Value::String(n)) => Some(n.clone()),
            Some(Value::Object(o)) => o
                .get("name")
                .or_else(|| o.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string),
            _ => None,
        };
        let svc = named.as_ref().map(|n| match services.get(n) {
            Some(got) => got.clone(),
            None => {
                unread.push(format!(
                    "{file}: route names service {n}, which is not defined"
                ));
                (Target::Unresolved, None, true)
            }
        });
        route_rules(&r, svc, &mut rules);
    }
    if text.contains("{vault://") {
        unread.push(format!("{file}: a vault reference"));
    }
    if rules.len() > MAX_RULES {
        rules.truncate(MAX_RULES);
        unread.push(format!("{file}: more routes than Drift reads"));
    }
    Ok(Gateway::of_rules(
        name,
        vec![file.to_string()],
        "route",
        rules,
        unread,
    ))
}

/// The Kong gateway of a container (`fs`) with the environment `env` (its compose
/// `environment`): DB-less (`KONG_DATABASE=off`), from the file
/// `KONG_DECLARATIVE_CONFIG` names. None when it keeps its configuration in a
/// database, or the repository does not put the file there. An admin API that
/// listens beyond the container's own address may load other routes: unread.
pub fn kong_at(
    name: &str,
    fs: &Fs,
    env: &BTreeMap<String, String>,
    words: Option<&[String]>,
    resolve: &dyn Fn(&str) -> Target,
) -> Result<Option<Vec<Gateway>>, String> {
    let get = |k: &str| {
        env.iter()
            .find(|(x, _)| x.eq_ignore_ascii_case(k))
            .map(|(_, v)| v.trim().to_string())
    };
    if !get("KONG_DATABASE").is_some_and(|d| d.eq_ignore_ascii_case("off")) {
        return Ok(None);
    }
    let mut unread = Vec::new();
    if get("KONG_DECLARATIVE_CONFIG_STRING").is_some() {
        unread.push("its KONG_DECLARATIVE_CONFIG_STRING".to_string());
    }
    if let Some(admin) = get("KONG_ADMIN_LISTEN")
        && !admin.eq_ignore_ascii_case("off")
        && !admin.split(',').all(|a| {
            a.trim().starts_with("127.")
                || a.trim().starts_with("[::1]")
                || a.trim().starts_with("localhost")
        })
    {
        unread.push(format!("what its admin API ({admin}) may load"));
    }
    if let Some(words) = words
        && words.iter().map(String::as_str).collect::<Vec<_>>() != ["kong", "docker-start"]
    {
        unread.push(format!("its command (`{}`)", words.join(" ")));
    }
    let Some(path) = get("KONG_DECLARATIVE_CONFIG").filter(|p| !p.contains('$')) else {
        return Ok(None);
    };
    let Some((repo, text)) = fs.text(&path)? else {
        return Ok(None);
    };
    unread.extend(fs.doubt(&path));
    let mut g = kong(name, repo, text, resolve)?;
    g.unread.splice(
        0..0,
        unread
            .into_iter()
            .map(|w| format!("gateway {name}: {w} is not read")),
    );
    Ok(Some(vec![g]))
}

// ---------- Apache httpd ----------

#[derive(Debug, Clone)]
struct Directive {
    name: String,
    args: Vec<String>,
    /// A section (`<VirtualHost ...>`): what is inside it.
    block: Option<Vec<Directive>>,
    /// `file:line`.
    at: String,
}

/// The words of an httpd configuration line: double quotes and backslash escapes
/// read.
fn httpd_words(line: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let (mut quoted, mut started) = (false, false);
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            '\\' if quoted => {
                if let Some(n) = chars.next() {
                    word.push(n);
                }
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            c => {
                word.push(c);
                started = true;
            }
        }
        if word.len() > 512 {
            return Err("a word of more than 512 characters".to_string());
        }
    }
    if quoted {
        return Err("quote not closed".to_string());
    }
    if started {
        words.push(word);
    }
    Ok(words)
}

/// Directives of httpd that cannot change where a request goes or the path it is
/// proxied with (lower case).
const HTTPD_INERT: &[&str] = &[
    // Read where includes are resolved ([`HttpdReader::load`]).
    "serverroot",
    "listen",
    "loadmodule",
    "user",
    "group",
    "servername",
    "serveralias",
    "serveradmin",
    "servertokens",
    "serversignature",
    "documentroot",
    "directoryindex",
    "errorlog",
    "loglevel",
    "logformat",
    "customlog",
    "transferlog",
    "typesconfig",
    "addtype",
    "addencoding",
    "addcharset",
    "addlanguage",
    "addhandler",
    "addoutputfilter",
    "addoutputfilterbytype",
    "adddefaultcharset",
    "defaulttype",
    "timeout",
    "keepalive",
    "keepalivetimeout",
    "maxkeepaliverequests",
    "mutex",
    "pidfile",
    "hostnamelookups",
    "enablesendfile",
    "enablemmap",
    "header",
    "requestheader",
    "protocols",
    "usecanonicalname",
    "accessfilename",
    "options",
    "allowoverride",
    "require",
    "errordocument",
    "alias",
    "scriptalias",
    "startservers",
    "minspareservers",
    "maxspareservers",
    "minsparethreads",
    "maxsparethreads",
    "maxrequestworkers",
    "maxconnectionsperchild",
    "maxrequestsperchild",
    "serverlimit",
    "threadsperchild",
    "threadlimit",
    "maxclients",
    "listenbacklog",
    "traceenable",
    "fileetag",
    "expiresactive",
    "expiresbytype",
    "expiresdefault",
    "browsermatch",
    "setenvif",
    "setenvifnocase",
    "setenv",
    "passenv",
    "unsetenv",
    "setoutputfilter",
    "setinputfilter",
    "indexoptions",
    "indexignore",
    "readmename",
    "headername",
    "languagepriority",
    "forcelanguagepriority",
    "satisfy",
    "authtype",
    "authname",
    "authuserfile",
    "authgroupfile",
    "authbasicprovider",
    "order",
    "allow",
    "cachequickhandler",
    "cacheenable",
    "cachedisable",
    "deflatecompressionlevel",
    "limitrequestbody",
    "limitrequestfields",
    "limitrequestfieldsize",
    "limitrequestline",
    "proxypassreverse",
    "proxypassreversecookiedomain",
    "proxypassreversecookiepath",
    "proxypreservehost",
    "proxytimeout",
    "proxyset",
    "proxyaddheaders",
    "proxyvia",
    "proxyerroroverride",
    "proxyiobuffersize",
    "proxybadheader",
    "proxystatus",
    "proxysourceaddress",
    "proxyreceivebuffersize",
    "proxymaxforwards",
    "rewriteengine",
    "rewritecond",
    "rewriteoptions",
    "rewritebase",
    "rewritemap",
    "rewritelog",
    "rewriteloglevel",
    "sslengine",
    "remoteipheader",
    "remoteiptrustedproxy",
    "remoteipinternalproxy",
    "servertype",
    "scriptsock",
    "acceptfilter",
    "addicon",
    "addiconbyencoding",
    "addiconbytype",
    "addalt",
    "addaltbyencoding",
    "addaltbytype",
    "defaulticon",
    "define",
    "undefine",
    "h2direct",
    "h2push",
    "keepalivesessions",
    "extendedstatus",
    "gracefulshutdowntimeout",
    "coredumpdirectory",
    "maxmemfree",
    "scoreboardfile",
    "sendbuffersize",
    "receivebuffersize",
    "serverpath",
    "contentdigest",
    "filterprovider",
    "filterchain",
    "filterdeclare",
    "addinputfilter",
    "mimemagicfile",
    "cgidscripttimeout",
];

/// What the httpd reader keeps while it walks the configuration.
struct HttpdReader<'a> {
    fs: &'a Fs,
    resolve: &'a dyn Fn(&str) -> Target,
    root: String,
    unread: Vec<String>,
    /// Files read, repo-relative, in order.
    files: Vec<String>,
    /// `balancer://name` -> its members.
    balancers: BTreeMap<String, Target>,
    /// A `<Location>` proxies or denies: its order among the other rules is not
    /// modelled.
    located: bool,
    /// A rewrite not followed: no rule proves anything.
    rewritten: bool,
}

impl HttpdReader<'_> {
    /// The directives of the file at `path` in the container, includes put in
    /// place. `depth` counts includes and sections.
    fn load(&mut self, path: &str, depth: usize) -> Result<Vec<Directive>, String> {
        let Some((repo, text)) = self.fs.text(path)? else {
            return Ok(Vec::new());
        };
        if self.files.len() >= MAX_FILES || depth > MAX_DEPTH {
            self.unread
                .push(format!("{repo}: more includes than Drift follows"));
            return Ok(Vec::new());
        }
        let (repo, text) = (repo.to_string(), text.to_string());
        self.files.push(repo.clone());
        // Logical lines: a `\` at the end joins the next.
        let mut lines: Vec<(usize, String)> = Vec::new();
        let mut pending: Option<(usize, String)> = None;
        for (n, raw) in text.lines().enumerate() {
            let (start, mut acc) = pending.take().unwrap_or((n + 1, String::new()));
            match raw.strip_suffix('\\') {
                Some(head) => {
                    acc.push_str(head);
                    acc.push(' ');
                    pending = Some((start, acc));
                }
                None => {
                    acc.push_str(raw);
                    lines.push((start, acc));
                }
            }
        }
        lines.extend(pending);
        // Sections nest; each line is a directive, `<Name args>` opens a section and
        // `</Name>` closes it.
        let mut stack: Vec<(String, Vec<String>, String, Vec<Directive>)> =
            vec![(String::new(), Vec::new(), String::new(), Vec::new())];
        for (n, line) in lines {
            let t = line.trim();
            if t.is_empty() || t.starts_with('#') {
                continue;
            }
            let at = format!("{repo}:{n}");
            if let Some(close) = t.strip_prefix("</") {
                let name = close.trim_end_matches('>').trim().to_lowercase();
                let Some((open, args, opened_at, body)) = stack.pop().filter(|_| !stack.is_empty())
                else {
                    return Err(format!("{at}: `</{name}>` closes nothing"));
                };
                if open != name {
                    return Err(format!("{at}: `</{name}>` closes `<{open}>`"));
                }
                if let Some(top) = stack.last_mut() {
                    top.3.push(Directive {
                        name: open,
                        args,
                        block: Some(body),
                        at: opened_at,
                    });
                }
                continue;
            }
            if let Some(open) = t.strip_prefix('<') {
                let inner = open
                    .strip_suffix('>')
                    .ok_or_else(|| format!("{at}: a section not closed with `>`"))?;
                let words = httpd_words(inner).map_err(|e| format!("{at}: {e}"))?;
                if stack.len() > MAX_DEPTH {
                    return Err(format!("{at}: sections nested more than {MAX_DEPTH} deep"));
                }
                let (name, args) = words
                    .split_first()
                    .ok_or_else(|| format!("{at}: an empty section"))?;
                stack.push((name.to_lowercase(), args.to_vec(), at, Vec::new()));
                continue;
            }
            let words = httpd_words(t).map_err(|e| format!("{at}: {e}"))?;
            let Some((name, args)) = words.split_first() else {
                continue;
            };
            let lower = name.to_lowercase();
            if lower == "include" || lower == "includeoptional" {
                let included = self.include(args.first().map_or("", String::as_str), &at, depth)?;
                if let Some(top) = stack.last_mut() {
                    top.3.extend(included);
                }
                continue;
            }
            if lower == "serverroot"
                && let Some(r) = args.first()
            {
                self.root = clean(r);
            }
            if let Some(top) = stack.last_mut() {
                top.3.push(Directive {
                    name: lower,
                    args: args.to_vec(),
                    block: None,
                    at,
                });
            }
        }
        if stack.len() != 1 {
            return Err(format!("{repo}: a section is not closed"));
        }
        Ok(stack.pop().map(|s| s.3).unwrap_or_default())
    }

    /// What `Include` / `IncludeOptional` of `pattern` reads: the files of the
    /// container it names, a `*` or `?` in its last part matched against the files
    /// of that directory. One that is not in the repository is not read.
    fn include(&mut self, pattern: &str, at: &str, depth: usize) -> Result<Vec<Directive>, String> {
        let path = if pattern.starts_with('/') {
            clean(pattern)
        } else {
            clean(&format!("{}/{pattern}", self.root))
        };
        let (dir, last) = path.rsplit_once('/').unwrap_or(("", &path));
        if dir.contains(['*', '?', '[']) || pattern.contains('$') {
            self.unread
                .push(format!("{at}: `Include {pattern}` is not followed"));
            return Ok(Vec::new());
        }
        let wild = last.contains(['*', '?', '[']);
        // A directory, or a pattern of files in one: the image may hold others there
        // unless a volume puts the directory in place whole.
        let found: Vec<String> = if wild {
            self.fs
                .in_dir(dir)
                .into_iter()
                .filter(|f| glob(last, f.rsplit('/').next().unwrap_or(f)))
                .map(str::to_string)
                .collect()
        } else if !self.fs.in_dir(&path).is_empty() {
            // A directory: every file in it.
            self.fs
                .in_dir(&path)
                .into_iter()
                .map(str::to_string)
                .collect()
        } else if self.fs.has(&path) {
            vec![path.clone()]
        } else {
            Vec::new()
        };
        let listed = !wild && !self.fs.in_dir(&path).is_empty();
        let covered = if wild { dir } else { path.as_str() };
        if listed && !self.fs.whole(&path) {
            self.unread
                .push(format!("{at}: what else the image holds in {path}"));
        }
        if found.is_empty() || self.fs.doubt(covered).is_some() || (wild && !self.fs.whole(dir)) {
            self.unread.push(format!(
                "{at}: `Include {pattern}` names what the repository does not put in the image"
            ));
        }
        let mut out = Vec::new();
        for f in found {
            out.extend(self.load(&f, depth + 1)?);
        }
        Ok(out)
    }

    /// The members of every `<Proxy balancer://...>`.
    fn balancers(&mut self, ds: &[Directive]) {
        for d in ds {
            if let Some(body) = &d.block {
                if d.name == "proxy"
                    && let Some(url) = d
                        .args
                        .first()
                        .filter(|u| u.to_lowercase().starts_with("balancer://"))
                {
                    let members: Vec<Target> = body
                        .iter()
                        .filter(|x| x.name == "balancermember")
                        .map(|x| self.url(x.args.first().map_or("", String::as_str)).0)
                        .collect();
                    let key = url.trim_end_matches('/').to_lowercase();
                    self.balancers.insert(key, union(members));
                }
                self.balancers(body);
            }
        }
    }

    /// The service a URL names and its path.
    fn url(&self, url: &str) -> (Target, String) {
        let lower = url.to_lowercase();
        if let Some(rest) = lower.strip_prefix("balancer://") {
            let (name, path) = match rest.find('/') {
                Some(i) => (&rest[..i], &url["balancer://".len() + i..]),
                None => (rest, ""),
            };
            let t = self
                .balancers
                .get(&format!("balancer://{name}"))
                .cloned()
                .unwrap_or(Target::Unresolved);
            return (t, path.to_string());
        }
        if lower.starts_with("unix:") || url.contains("${") {
            return (Target::Unresolved, String::new());
        }
        match split_url(url) {
            Some((host, path)) => (host_target(host, self.resolve), path.to_string()),
            None => (Target::Unresolved, String::new()),
        }
    }

    /// The rules of `ProxyPass prefix url` (`!` for one that is not proxied): how
    /// the URL's path replaces the prefix, as far as it is read.
    fn proxy_pass(&mut self, d: &Directive, prefix: &str, url: &str) -> Vec<Rule> {
        let label = format!("ProxyPass {prefix} {url}");
        if url == "!" {
            return segments(rule(label, prefix, false, Target::Nowhere));
        }
        let (target, path) = self.url(url);
        if target == Target::Unresolved {
            self.unread.push(format!(
                "{}: `ProxyPass` names a host Drift cannot resolve",
                d.at
            ));
        }
        // The backend is sent the URL's path and what follows the prefix.
        let (strip, opaque) = if path == prefix {
            (false, false)
        } else if (path.is_empty() && !prefix.ends_with('/') && prefix != "/")
            || (path == "/" && prefix.ends_with('/'))
        {
            (true, false)
        } else {
            (false, true)
        };
        segments(Rule {
            strip,
            opaque,
            ..rule(label, prefix, false, target)
        })
    }

    /// The rules of the directives `ds` (a server, a virtual host, a section in one).
    /// `conditional`: inside a section that may not apply (`<If>`, `<IfDefine>`).
    fn rules(&mut self, ds: &[Directive], conditional: bool, location: Option<&str>) -> Vec<Rule> {
        let mut out = Vec::new();
        for d in ds {
            let mut of: Vec<Rule> = Vec::new();
            match (d.name.as_str(), &d.block) {
                // Read as a virtual host where it stands at the top or in an
                // `<IfModule>` ([`virtual_hosts`]); anywhere else it may not apply.
                ("virtualhost", Some(_)) if !conditional && location.is_none() => {}
                ("virtualhost", Some(_)) => {
                    self.unread.push(format!(
                        "{}: `<VirtualHost>` inside a section that may not apply is not read",
                        d.at
                    ));
                }
                ("location", Some(body)) => {
                    let prefix = match d.args.as_slice() {
                        [p] if !p.starts_with('~') => Some(p.as_str()),
                        _ => None,
                    };
                    let inner = self.rules(body, conditional, Some(prefix.unwrap_or("~")));
                    if !inner.is_empty() {
                        self.located = true;
                    }
                    of.extend(inner.into_iter().map(|r| Rule {
                        opaque: r.opaque || prefix.is_none(),
                        ..r
                    }));
                }
                ("locationmatch", Some(body)) => {
                    let inner = self.rules(body, conditional, Some("~"));
                    if !inner.is_empty() {
                        self.located = true;
                    }
                    of.extend(inner.into_iter().map(|r| Rule { opaque: true, ..r }));
                }
                ("ifmodule", Some(body)) => {
                    let negated = d.args.first().is_some_and(|a| a.starts_with('!'));
                    of.extend(self.rules(body, conditional || negated, location));
                }
                (
                    "if" | "elseif" | "else" | "ifdefine" | "ifversion" | "iffile" | "ifdirective"
                    | "ifsection",
                    Some(body),
                ) => {
                    of.extend(self.rules(body, true, location));
                }
                ("proxy" | "proxymatch", Some(_)) => {}
                (
                    "directory" | "directorymatch" | "files" | "filesmatch" | "limit"
                    | "limitexcept",
                    Some(body),
                ) => {
                    let routes = |x: &Directive| {
                        ["proxypass", "proxypassmatch", "rewriterule"].contains(&x.name.as_str())
                    };
                    if body.iter().any(routes) {
                        self.unread.push(format!(
                            "{}: `<{}>` that proxies or rewrites is not read",
                            d.at, d.name
                        ));
                        self.rewritten = true;
                    }
                }
                (n, Some(_)) => {
                    self.unread.push(format!("{}: `<{n}>` is not read", d.at));
                }
                ("proxypass", None) => match (location, d.args.as_slice()) {
                    (Some("~"), _) => {
                        let url = d.args.first().map_or("", String::as_str);
                        let target = if url == "!" {
                            Target::Nowhere
                        } else {
                            self.url(url).0
                        };
                        of.push(anything(format!("ProxyPass {url}"), target));
                    }
                    (Some(p), [url, ..]) => of.extend(self.proxy_pass(d, p, url)),
                    (None, [p, url, ..]) => of.extend(self.proxy_pass(d, p, url)),
                    _ => self
                        .unread
                        .push(format!("{}: `ProxyPass` is not read", d.at)),
                },
                ("proxypassmatch", None) => {
                    let url = d
                        .args
                        .get(if location.is_some() { 0 } else { 1 })
                        .map_or("", String::as_str);
                    let target = if url == "!" {
                        Target::Nowhere
                    } else {
                        self.url(url).0
                    };
                    if target == Target::Unresolved {
                        self.unread.push(format!(
                            "{}: `ProxyPassMatch` names a host Drift cannot resolve",
                            d.at
                        ));
                    }
                    of.push(anything(
                        format!("ProxyPassMatch {}", d.args.join(" ")),
                        target,
                    ));
                }
                ("proxyrequests", None)
                    if d.args.first().is_some_and(|a| a.eq_ignore_ascii_case("on")) =>
                {
                    self.unread.push(format!(
                        "{}: `ProxyRequests On` proxies to any host a client names",
                        d.at
                    ));
                    of.push(anything("ProxyRequests On".to_string(), Target::Unresolved));
                }
                ("proxyrequests", None) => {}
                ("require", None) if location.is_some_and(|l| l != "~") => {
                    let denied = d.args.iter().map(|a| a.to_lowercase()).collect::<Vec<_>>()
                        == ["all", "denied"];
                    if denied && !conditional {
                        of.extend(segments(rule(
                            format!("<Location {}> Require all denied", location.unwrap_or("")),
                            location.unwrap_or("/"),
                            false,
                            Target::Nowhere,
                        )));
                    }
                }
                ("deny", None) if location.is_some_and(|l| l != "~") => {
                    if d.args.iter().map(|a| a.to_lowercase()).collect::<Vec<_>>()
                        == ["from", "all"]
                        && !conditional
                    {
                        of.extend(segments(rule(
                            format!("<Location {}> Deny from all", location.unwrap_or("")),
                            location.unwrap_or("/"),
                            false,
                            Target::Nowhere,
                        )));
                    }
                }
                ("deny", None) => {}
                ("redirect" | "redirectpermanent" | "redirecttemp", None) => {
                    let status = |a: &String| {
                        ["permanent", "temp", "seeother", "gone"]
                            .contains(&a.to_lowercase().as_str())
                            || a.chars().all(|c| c.is_ascii_digit())
                    };
                    let path = match d.args.as_slice() {
                        [s, p, ..] if status(s) => Some(p),
                        [p, ..] => Some(p),
                        [] => None,
                    };
                    if let Some(p) = path.filter(|p| p.starts_with('/')) {
                        of.extend(segments(rule(
                            format!("{} {}", d.name, d.args.join(" ")),
                            p,
                            false,
                            Target::Nowhere,
                        )));
                    }
                }
                ("redirectmatch", None) => {
                    of.push(anything(
                        format!("RedirectMatch {}", d.args.join(" ")),
                        Target::Nowhere,
                    ));
                }
                ("rewriterule", None) => {
                    let subst = d.args.get(1).map_or("", String::as_str);
                    let flags = d
                        .args
                        .get(2)
                        .map(|f| f.trim_matches(['[', ']']).to_lowercase())
                        .unwrap_or_default();
                    let flags: Vec<&str> = flags
                        .split(',')
                        .map(|f| f.split('=').next().unwrap_or("").trim())
                        .collect();
                    let label = format!("RewriteRule {}", d.args.join(" "));
                    if flags.iter().any(|f| *f == "p" || *f == "proxy") {
                        let target = match split_url(subst) {
                            Some((host, _)) => host_target(host, self.resolve),
                            None => Target::Unresolved,
                        };
                        if target == Target::Unresolved {
                            self.unread.push(format!(
                                "{}: `RewriteRule ... [P]` proxies to a host Drift cannot resolve",
                                d.at
                            ));
                        }
                        of.push(anything(label, target));
                    } else if flags
                        .iter()
                        .any(|f| ["r", "redirect", "f", "forbidden", "g", "gone"].contains(f))
                    {
                        of.push(anything(label, Target::Nowhere));
                    } else if subst != "-" {
                        self.unread.push(format!(
                            "{}: `RewriteRule` rewrites the path, which Drift does not follow",
                            d.at
                        ));
                        self.rewritten = true;
                    }
                }
                ("balancermember", None) => {}
                (n, None)
                    if HTTPD_INERT.contains(&n)
                        || n.starts_with("ssl")
                        || n.starts_with("proxyhtml")
                        || n.starts_with("h2")
                        || n.starts_with("auth")
                        || n.starts_with("session")
                        || n.starts_with("cache") => {}
                (n, None) => self.unread.push(format!("{}: `{n}` is not read", d.at)),
            }
            out.extend(of.into_iter().map(|r| Rule {
                opaque: r.opaque || conditional,
                ..r
            }));
        }
        out
    }
}

/// The virtual hosts of `ds`: at the top, or in an `<IfModule>` that is not negated
/// (read as loaded).
fn virtual_hosts(ds: &[Directive], depth: usize) -> Vec<&Directive> {
    let mut out = Vec::new();
    for d in ds {
        match (&d.block, d.name.as_str()) {
            (Some(_), "virtualhost") => out.push(d),
            (Some(body), "ifmodule")
                if depth < MAX_DEPTH && !d.args.first().is_some_and(|a| a.starts_with('!')) =>
            {
                out.extend(virtual_hosts(body, depth + 1));
            }
            _ => {}
        }
    }
    out
}

/// Whether the file name `name` matches the shell pattern `pattern` (`*`, `?`).
fn glob(pattern: &str, name: &str) -> bool {
    fn go(p: &[char], n: &[char], steps: &mut usize) -> bool {
        *steps += 1;
        if *steps > 10_000 {
            return false;
        }
        match p.split_first() {
            None => n.is_empty(),
            Some(('*', rest)) => (0..=n.len()).any(|k| go(rest, &n[k..], steps)),
            Some(('?', rest)) => !n.is_empty() && go(rest, &n[1..], steps),
            Some((c, rest)) => n.first() == Some(c) && go(rest, &n[1..], steps),
        }
    }
    let (p, n): (Vec<char>, Vec<char>) = (pattern.chars().collect(), name.chars().collect());
    go(&p, &n, &mut 0)
}

/// The httpd gateway `name` from the configuration of its container (`fs`): the
/// main file `main` (in the official image `/usr/local/apache2/conf/httpd.conf`)
/// and what it includes, relative paths under `root` (`ServerRoot`). None when the
/// repository does not put the main file there: the image's own then decides what
/// is loaded.
///
/// Read: `ProxyPass` (a prefix, matched by whole segments, and how the URL's path
/// replaces it; `!` is not proxied), `<Location>` with `ProxyPass` and `Require all
/// denied` (not forwarded), `<VirtualHost>` with `ServerName` and `ServerAlias`,
/// `<Proxy balancer://...>` members, `Include` and `IncludeOptional` of files the
/// repository puts in the image. Not evaluated: `ProxyPassMatch`, a regular
/// expression `<Location>`, `RewriteRule ... [P]`, a section that may not apply.
/// Not read: a rewrite that changes the path, a directive or a section Drift does
/// not know, an include the repository does not provide.
pub fn httpd(
    name: &str,
    fs: &Fs,
    main: &str,
    root: &str,
    resolve: &dyn Fn(&str) -> Target,
) -> Result<Option<Gateway>, String> {
    if fs.text(main)?.is_none() {
        return Ok(None);
    }
    let mut reader = HttpdReader {
        fs,
        resolve,
        root: clean(root),
        unread: Vec::new(),
        files: Vec::new(),
        balancers: BTreeMap::new(),
        located: false,
        rewritten: false,
    };
    let ds = reader.load(main, 0)?;
    reader.balancers(&ds);
    let main_rules = reader.rules(&ds, false, None);
    let vhosts = virtual_hosts(&ds, 0);
    let mut rules: Vec<Rule> = Vec::new();
    if vhosts.is_empty() {
        rules = main_rules;
    } else {
        // Each virtual host by its names and addresses; with ports only when every
        // one names a port, so that one for any port competes with all.
        let ported = vhosts
            .iter()
            .all(|v| v.args.iter().all(|a| a.contains(':')));
        for (i, v) in vhosts.iter().enumerate() {
            let body = v.block.as_deref().unwrap_or_default();
            let mut names: Vec<String> = body
                .iter()
                .filter(|x| x.name == "servername" || x.name == "serveralias")
                .flat_map(|x| x.args.iter())
                .map(|n| n.split(':').next().unwrap_or(n).to_lowercase())
                .collect();
            names.sort();
            names.dedup();
            let wild = names.iter().any(|n| n.contains(['*', '?']));
            // A virtual host with no name of its own answers a host no other names
            // only when it is the first.
            let (host, hidden) = if names.is_empty() || wild {
                (None, i > 0)
            } else {
                let mut addrs: Vec<String> = v.args.clone();
                addrs.sort();
                (
                    Some(if ported {
                        format!("{} {}", names.join(" "), addrs.join(" "))
                    } else {
                        names.join(" ")
                    }),
                    false,
                )
            };
            let own = reader.rules(body, false, None);
            // The server's own rules are its virtual hosts' too.
            for r in main_rules.iter().cloned().chain(own) {
                rules.push(Rule {
                    host: if hidden {
                        Some(format!("virtual host {i}"))
                    } else {
                        host.clone()
                    },
                    opaque: r.opaque || hidden,
                    ..r
                });
            }
        }
        if !main_rules.is_empty() {
            reader.located = true;
        }
    }
    if reader.rewritten {
        for r in &mut rules {
            r.opaque = true;
        }
    }
    let mut unread = reader.unread;
    if rules.len() > MAX_RULES {
        rules.truncate(MAX_RULES);
        unread.push(format!(
            "{}: more rules than Drift reads",
            reader.files.first().cloned().unwrap_or_default()
        ));
    }
    let g = Gateway::of_rules(name, reader.files, "rule", rules, unread);
    Ok(Some(if reader.located { g } else { g.first_match() }))
}

// ---------- Traefik's file provider ----------

/// Every key of `v` in lower case, as Traefik reads its dynamic configuration;
/// nested at most [`MAX_DEPTH`] deep.
fn lower_keys(v: Value, depth: usize) -> Value {
    match v {
        Value::Object(m) if depth < MAX_DEPTH => Value::Object(
            m.into_iter()
                .map(|(k, v)| (k.to_lowercase(), lower_keys(v, depth + 1)))
                .collect(),
        ),
        Value::Array(a) if depth < MAX_DEPTH => {
            Value::Array(a.into_iter().map(|v| lower_keys(v, depth + 1)).collect())
        }
        Value::Object(_) | Value::Array(_) => Value::Null,
        other => other,
    }
}

/// The routers of Traefik's file provider, from its files (repo-relative path,
/// text; YAML, or TOML by the extension), as rules beside those of the labels
/// ([`crate::proxies::traefik`]), and what is not read.
///
/// Read: `http.routers.*` with `rule` (the subset of the labels' reader: `Host`,
/// `PathPrefix`, `Path`, `&&`, `||`), `service`, `middlewares`;
/// `http.middlewares.*.stripPrefix`; `http.services.*.loadBalancer.servers[].url`.
/// Not evaluated: a rule outside the subset, a middleware that changes the path
/// other than stripping the rule's own prefix, one of another provider, a service of
/// another provider, TCP and UDP routers. Not read: a template, a service that is
/// not a load balancer, a key Drift does not know.
pub fn traefik_file(
    files: &[(String, String)],
    resolve: &dyn Fn(&str) -> Target,
) -> Result<(Vec<Rule>, Vec<String>), String> {
    let mut unread: Vec<String> = Vec::new();
    let mut routers: BTreeMap<String, Value> = BTreeMap::new();
    let mut middlewares: BTreeMap<String, Value> = BTreeMap::new();
    let mut services: BTreeMap<String, Value> = BTreeMap::new();
    let mut streams: Vec<String> = Vec::new();
    for (file, text) in files {
        if text.contains("{{") {
            unread.push(format!("{file}: a template, which Drift does not fill"));
            continue;
        }
        let v: Value = if file.ends_with(".toml") {
            let t: toml::Value = toml::from_str(text).map_err(|e| format!("{file}: {e}"))?;
            serde_json::to_value(t).map_err(|e| format!("{file}: {e}"))?
        } else {
            serde_saphyr::from_str(text).map_err(|e| format!("{file}: {e}"))?
        };
        let v = lower_keys(v, 0);
        let Some(top) = v.as_object() else {
            if v.is_null() {
                continue;
            }
            return Err(format!("{file}: not Traefik dynamic configuration"));
        };
        for (k, section) in top {
            match k.as_str() {
                "http" => {
                    for (part, into) in [
                        ("routers", &mut routers),
                        ("middlewares", &mut middlewares),
                        ("services", &mut services),
                    ] {
                        for (n, x) in section
                            .get(part)
                            .and_then(Value::as_object)
                            .into_iter()
                            .flatten()
                        {
                            into.insert(n.clone(), x.clone());
                        }
                    }
                    for other in section.as_object().into_iter().flatten().map(|(k, _)| k) {
                        if !["routers", "middlewares", "services", "serverstransports"]
                            .contains(&other.as_str())
                        {
                            unread.push(format!("{file}: `http.{other}`"));
                        }
                    }
                }
                "tcp" | "udp" => {
                    for n in section
                        .get("routers")
                        .and_then(Value::as_object)
                        .into_iter()
                        .flatten()
                        .map(|(n, _)| n)
                    {
                        streams.push(format!("{k} router {n}"));
                    }
                }
                "tls" => {}
                other => unread.push(format!("{file}: `{other}`")),
            }
        }
    }
    let str_list = |v: Option<&Value>| -> Vec<String> {
        match v {
            Some(Value::String(s)) => s
                .split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect(),
            Some(Value::Array(a)) => a
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            _ => Vec::new(),
        }
    };
    // What a middleware does to the path: the prefixes it strips, or that it changes
    // the path in a way that is not read. None: it leaves the path alone.
    let middleware = |m: &str| -> Option<Result<Vec<String>, ()>> {
        let m = m.trim().to_lowercase();
        let m = match m.split_once('@') {
            Some((n, "file")) => n.to_string(),
            Some(_) => return Some(Err(())),
            None => m,
        };
        let Some(def) = middlewares.get(&m).and_then(Value::as_object) else {
            return Some(Err(()));
        };
        let mut strips = None;
        for (kind, x) in def {
            match kind.as_str() {
                "stripprefix" => strips = Some(str_list(x.get("prefixes"))),
                "stripprefixregex" | "replacepath" | "replacepathregex" | "addprefix"
                | "plugin" | "chain" => {
                    return Some(Err(()));
                }
                _ => {}
            }
        }
        strips.map(Ok)
    };
    let service = |s: &str, unread: &mut Vec<String>| -> Option<Target> {
        let s = s.trim().to_lowercase();
        let s = match s.split_once('@') {
            Some((n, "file")) => n.to_string(),
            Some((_, "internal")) => return None,
            Some(_) => return Some(Target::Unresolved),
            None => s,
        };
        let Some(def) = services.get(&s) else {
            unread.push(format!("service {s} of the file provider is not defined"));
            return Some(Target::Unresolved);
        };
        let Some(servers) = def
            .get("loadbalancer")
            .and_then(|l| l.get("servers"))
            .and_then(Value::as_array)
        else {
            unread.push(format!(
                "service {s} of the file provider is not a load balancer"
            ));
            return Some(Target::Unresolved);
        };
        let t = union(servers.iter().map(|x| {
            match x.get("url").and_then(Value::as_str).and_then(split_url) {
                Some((host, _)) => host_target(host, resolve),
                None => Target::Unresolved,
            }
        }));
        if t == Target::Unresolved {
            unread.push(format!(
                "service {s} of the file provider names a host Drift cannot resolve"
            ));
        }
        Some(t)
    };
    let mut rules: Vec<Rule> = Vec::new();
    for (r, def) in &routers {
        let Some(target) = service(
            def.get("service").and_then(Value::as_str).unwrap_or(""),
            &mut unread,
        ) else {
            continue;
        };
        let any_path = |label: String| anything(label, target.clone());
        let Some(rule_text) = def.get("rule").and_then(Value::as_str) else {
            rules.push(any_path(format!(
                "router {r} of the file provider (no rule)"
            )));
            continue;
        };
        let mut strips: Vec<String> = Vec::new();
        let mut rewrites = false;
        for m in str_list(def.get("middlewares")) {
            match middleware(&m) {
                Some(Ok(p)) => strips.extend(p),
                Some(Err(())) => rewrites = true,
                None => {}
            }
        }
        let Some(alternatives) = crate::proxies::traefik_rule(rule_text) else {
            rules.push(any_path(rule_text.to_string()));
            continue;
        };
        for a in alternatives {
            let (path, exact) = a.path.unwrap_or(("/".to_string(), false));
            let strip = strips.iter().any(|p| *p == path || format!("{p}/") == path);
            rules.push(Rule {
                host: a.host,
                label: rule_text.to_string(),
                path,
                exact,
                target: target.clone(),
                strip: strip && !exact,
                opaque: a.conditional || rewrites || (!strips.is_empty() && (!strip || exact)),
            });
        }
        if rules.len() > MAX_RULES {
            unread.push("more routers of the file provider than Drift reads".to_string());
            break;
        }
    }
    for s in streams {
        rules.push(anything(
            format!("a {s} of the file provider"),
            Target::Unresolved,
        ));
    }
    Ok((rules, unread))
}

/// The file provider of a Traefik container (`fs`) at `path` (a `directory`, or one
/// file): its rules, what is not read of it, and the repo-relative files read. None
/// when the repository does not put it there; an error when a file is not dynamic
/// configuration Drift reads.
#[allow(clippy::type_complexity)]
pub fn traefik_file_at(
    fs: &Fs,
    path: &str,
    directory: bool,
    resolve: &dyn Fn(&str) -> Target,
) -> Option<Result<(Vec<Rule>, Vec<String>, Vec<String>), String>> {
    let mut unread = Vec::new();
    let paths: Vec<String> = if directory {
        if !fs.has(path) {
            return None;
        }
        if !fs.whole(path) {
            unread.push(format!("what else the image holds in {path}"));
        }
        let dir = format!("{}/", clean(path));
        if fs
            .files
            .keys()
            .any(|k| k.strip_prefix(&dir).is_some_and(|rest| rest.contains('/')))
        {
            unread.push(format!("the directories in {path}"));
        }
        fs.in_dir(path)
            .into_iter()
            .filter(|f| [".yml", ".yaml", ".toml"].iter().any(|x| f.ends_with(x)))
            .map(str::to_string)
            .collect()
    } else {
        vec![path.to_string()]
    };
    let mut files: Vec<(String, String)> = Vec::new();
    for p in &paths {
        match fs.text(p) {
            Err(e) => return Some(Err(e)),
            Ok(None) => return None,
            Ok(Some((repo, text))) => files.push((repo.to_string(), text.to_string())),
        }
    }
    unread.extend(fs.doubt(path));
    let (rules, why) = match traefik_file(&files, resolve) {
        Ok(x) => x,
        Err(e) => return Some(Err(e)),
    };
    unread.extend(why);
    Some(Ok((
        rules,
        unread,
        files.into_iter().map(|(f, _)| f).collect(),
    )))
}
