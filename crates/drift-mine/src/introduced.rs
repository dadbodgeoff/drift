//! What an edit introduced, against what the code had when a session started: the
//! hooks' reading of the security inventory ([`crate::security`]) and of the package
//! graph ([`crate::map::package_graph`]).
//!
//! Each fact has a key. A session records the keys the code starts with
//! ([`security_keys`], [`edge_keys`]); after an edit, the facts whose keys it has not
//! recorded are the ones to say ([`introduced`], [`new_edges`]). Facts, not rules:
//! nothing here fails a check, and every line says only what the inventory or the
//! graph holds. Output is sorted and capped.

use std::collections::BTreeSet;

use drift_core::{FileFacts, PackageFacts};

use crate::map::{FileTarget, PackageGraph};
use crate::report::sanitize;
use crate::security::{EntryRow, Exposure, Inventory, Reach};

/// Lines of one message before "and N more".
pub const MAX_LINES: usize = 6;
/// Nodes of a call chain named in one line.
const MAX_VIA: usize = 3;

fn sink_key(path: &str, symbol: &str, kind: &str) -> String {
    format!("sink|{path}|{symbol}|{kind}")
}

/// An entry point reaches a risky operation of `kind`.
fn reach_key(path: &str, symbol: &str, kind: &str) -> String {
    format!("reach|{path}|{symbol}|{kind}")
}

/// An entry point with no guard reaches a risky operation of `kind`.
fn bare_key(path: &str, symbol: &str, kind: &str) -> String {
    format!("bare|{path}|{symbol}|{kind}")
}

fn leak_key(client: &str, reaches: &str) -> String {
    format!("leak|{client}|{reaches}")
}

/// The file a security key is about: the sink's, the entry point's, the client's.
pub fn key_path(key: &str) -> Option<&str> {
    key.split('|').nth(1)
}

/// The key of every security fact of `inv` a session can be told about: each risky
/// operation, each entry point reaching one (and, apart, each that does so with no
/// guard), each client file reaching server-only code or a secret.
pub fn security_keys(inv: &Inventory) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for s in &inv.sinks {
        out.insert(sink_key(&s.path, &s.symbol, &s.kind));
    }
    for e in &inv.entry_points {
        for r in &e.reaches {
            out.insert(reach_key(&e.path, &e.symbol, &r.kind));
            if e.unguarded() {
                out.insert(bare_key(&e.path, &e.symbol, &r.kind));
            }
        }
    }
    for g in &inv.client_leaks {
        for c in &g.clients {
            out.insert(leak_key(c, &g.reaches));
        }
    }
    out
}

/// The security keys one file's facts show on their own: its risky operations and,
/// for a client file, what it reaches. What a hook looks at before it pays for the
/// inventory: an entry point reaching an operation through other files is not here.
pub fn file_keys(f: &FileFacts) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for s in &f.symbols {
        for k in &s.sinks {
            out.insert(sink_key(&f.path, &s.name, k));
        }
    }
    for l in &f.client_leaks {
        out.insert(leak_key(&f.path, l));
    }
    out
}

/// Of the keys the inventory has `now`, those `told` to the agent: how many facts they
/// are, and their files. An entry point reaching an operation is one fact, whatever
/// its keys: with no guard it has a second key, and when the operation is in the entry
/// point itself the operation has its own.
pub fn still_there(
    now: &BTreeSet<String>,
    told: &dyn Fn(&str) -> bool,
) -> (usize, BTreeSet<String>) {
    let mut n = 0;
    let mut files = BTreeSet::new();
    for k in now.iter().filter(|k| told(k)) {
        if let Some(rest) = k.strip_prefix("bare|").or(k.strip_prefix("sink|")) {
            let reach = format!("reach|{rest}");
            if now.contains(&reach) && told(&reach) {
                continue;
            }
        }
        n += 1;
        if let Some(p) = key_path(k) {
            files.insert(p.to_string());
        }
    }
    (n, files)
}

/// What a symbol with a risky operation of `kind` does, as the detectors read it
/// (`drift security` lists the same kinds).
pub fn does(kind: &str) -> String {
    let what = match kind {
        "eval" => "evaluates a string as code",
        "shell_exec" => "runs a shell command",
        "raw_html" => "writes raw HTML",
        "raw_sql" => "runs raw SQL",
        "sql_string_interpolation" => "builds SQL by string interpolation",
        "dynamic_redirect" => "redirects to a computed URL",
        "dynamic_fetch" => "requests a computed URL",
        "weak_hash" => "hashes with MD5 or SHA-1",
        "jwt_decode_without_verify" => "decodes a JWT without verifying it",
        "cookie_without_httponly" => "sets a cookie without httpOnly",
        "cors_any_origin" => "allows CORS from any origin",
        "unsafe_deserialize" => "deserialises with pickle or another unsafe loader",
        "path_traversal" => "opens a file at a path built from a value",
        "template_injection" => "renders template text that is not written out",
        "nosql_injection" => "builds a MongoDB $where from a value",
        "xml_external_entities" => "parses XML with external entities resolved",
        "hardcoded_secret" => "signs with a secret written in the code",
        "debug_enabled" => "starts a server in debug mode",
        "tls_verify_disabled" => "does not verify the TLS certificate",
        "mass_assignment" => "writes a row from the whole request body",
        "dynamic_regex" => "builds a regular expression from a value",
        other => return format!("has a risky operation ({})", sanitize(other, 40)),
    };
    format!("{what} ({kind})")
}

/// What an edit of one file introduced ([`introduced`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Introduced {
    /// One line per fact, the ones that matter most first, at most [`MAX_LINES`] and a
    /// line counting the rest. Empty: nothing to say.
    pub lines: Vec<String>,
    /// The key of every fact found, listed or counted: said once.
    pub keys: BTreeSet<String>,
}

/// `path#Symbol.member` -> `path`.
fn node_path(node: &str) -> &str {
    node.rsplit_once('#').map_or(node, |(p, _)| p)
}

/// Whether the call-chain node `node` is the symbol `symbol` of `path` or a member of it.
fn node_is(node: &str, path: &str, symbol: &str) -> bool {
    node.strip_prefix(path)
        .and_then(|r| r.strip_prefix('#'))
        .and_then(|r| r.strip_prefix(symbol))
        .is_some_and(|r| r.is_empty() || r.starts_with('.'))
}

/// `POST /v2/folders/copy [http]`, `main [cli]`.
fn entry_name(e: &EntryRow) -> String {
    let mut w = String::new();
    if let Some(m) = &e.method {
        w.push_str(m);
        w.push(' ');
    }
    w.push_str(e.route.as_deref().unwrap_or(&e.symbol));
    format!("{} [{}]", sanitize(&w, 120), sanitize(&e.kind, 40))
}

/// Where the entry point is: its symbol and line in `rel` itself, its file otherwise.
fn entry_at(e: &EntryRow, rel: &str) -> String {
    if e.path == rel {
        format!("{}:{}", sanitize(&e.symbol, 80), e.line)
    } else {
        format!(
            "{}:{} {}",
            sanitize(&e.path, 160),
            e.line,
            sanitize(&e.symbol, 80)
        )
    }
}

/// What the inventory says of the entry point's guards, and of its exposure when the
/// repository says it is internet-facing. `gone`: it had a guard, or a wrapper that
/// could not be read, when the session started.
fn guard_clause(e: &EntryRow, gone: bool) -> String {
    let mut out = if e.unguarded() {
        let found = crate::practices::basis::no_guard(
            e.basis.as_ref().map_or(&[], |b| b.not_read.as_slice()),
        );
        if gone {
            format!("now has {found}")
        } else {
            format!("has {found}")
        }
    } else if e.local && e.guards.is_empty() && e.opaque.is_empty() {
        format!("is {}", crate::security::LOCAL_NOTE)
    } else if e.guards.is_empty() {
        format!(
            "is behind {} (Drift cannot read whether it turns a caller away: guarded or not is unknown)",
            sanitize(&e.opaque.join(", "), 120)
        )
    } else {
        format!("is guarded by {}", sanitize(&e.guards.join(" › "), 120))
    };
    if e.exposure == Exposure::Public {
        out.push_str(", is internet-facing");
        if let Some(b) = &e.boundary {
            out.push_str(&format!(" ({})", sanitize(b, 120)));
        }
    }
    out
}

/// `and runs a shell command (shell_exec)`, or, through calls, `and reaches
/// lib/run.py#run, which runs a shell command (shell_exec), via lib/ops.py#copy`.
fn reach_clause(r: &Reach, fresh: bool) -> String {
    let now = if fresh { "now " } else { "" };
    let (Some(last), true) = (r.via.last(), r.via.len() > 1) else {
        return format!("and {now}{}", does(&r.kind));
    };
    let between = &r.via[1..r.via.len() - 1];
    let mut via: Vec<String> = between
        .iter()
        .take(MAX_VIA)
        .map(|n| sanitize(n, 160))
        .collect();
    if between.len() > MAX_VIA {
        via.push("...".to_string());
    }
    format!(
        "and {now}reaches {}, which {}{}",
        sanitize(last, 160),
        does(&r.kind),
        if via.is_empty() {
            String::new()
        } else {
            format!(", via {}", via.join(" -> "))
        }
    )
}

/// What the edit of `rel` introduced, as `inv` (the inventory after the edit) has it:
/// the facts whose key is not `known` (recorded when the session started, or already
/// said) and that `rel` is part of. In order:
///
/// 1. entry points that reach a risky operation through a call chain with a symbol of
///    `rel` on it (the entry point's own file, the operation's, or one between): those
///    with no guard first, internet-facing ones before the others. Also an entry
///    point that reached it with a guard and has none now;
/// 2. risky operations in `rel` that no line above ends at;
/// 3. client files that reach server-only code or read a secret: `rel` itself, or
///    those reaching it.
///
/// Sorted within each; at most [`MAX_LINES`] lines, then one counting the rest.
pub fn introduced(inv: &Inventory, rel: &str, known: &dyn Fn(&str) -> bool) -> Introduced {
    let mut out = Introduced::default();
    // (rank, path, line, text): the sort key, then the line.
    let mut lines: Vec<(u8, String, u32, String)> = Vec::new();
    // Risky operations a reach line already names: (kind, the chain's last node).
    let mut named: Vec<(&str, &str)> = Vec::new();
    let mut listed: BTreeSet<(&str, &str)> = BTreeSet::new();
    for e in &inv.entry_points {
        // The same entry point listed twice (a script that is two commands) is one fact.
        if !listed.insert((e.path.as_str(), e.symbol.as_str())) {
            continue;
        }
        // One line for the entry point, with every operation it newly reaches.
        let mut clauses: Vec<String> = Vec::new();
        let mut had_guard = false;
        for r in &e.reaches {
            if !r.via.iter().any(|n| node_path(n) == rel) {
                continue;
            }
            let reach = reach_key(&e.path, &e.symbol, &r.kind);
            let bare = bare_key(&e.path, &e.symbol, &r.kind);
            let fresh = !known(&reach);
            if !(fresh || (e.unguarded() && !known(&bare))) {
                continue;
            }
            had_guard |= !fresh;
            out.keys.insert(reach);
            if e.unguarded() {
                out.keys.insert(bare);
            }
            if let Some(last) = r.via.last() {
                named.push((&r.kind, last));
            }
            clauses.push(reach_clause(r, fresh));
        }
        if clauses.is_empty() {
            continue;
        }
        let rank = match (e.unguarded(), e.exposure == Exposure::Public) {
            (true, true) => 0,
            (true, false) => 1,
            (false, _) => 2,
        };
        lines.push((
            rank,
            e.path.clone(),
            e.line,
            format!(
                "{} ({}) {} {}",
                entry_name(e),
                entry_at(e, rel),
                guard_clause(e, had_guard),
                clauses.join("; ")
            ),
        ));
    }
    for s in inv.sinks.iter().filter(|s| s.path == rel) {
        let key = sink_key(&s.path, &s.symbol, &s.kind);
        if known(&key) || !out.keys.insert(key) {
            continue;
        }
        if named
            .iter()
            .any(|(kind, last)| *kind == s.kind && node_is(last, &s.path, &s.symbol))
        {
            continue;
        }
        lines.push((
            3,
            s.path.clone(),
            s.line,
            format!("{}:{} {}", sanitize(&s.symbol, 80), s.line, does(&s.kind)),
        ));
    }
    for g in &inv.client_leaks {
        let chain = |client: &str| {
            let ours = g.clients.first().is_some_and(|c| c == client) && g.example.len() > 2;
            if ours {
                let shown: Vec<String> = g.example.iter().map(|n| sanitize(n, 160)).collect();
                format!(" (import chain: {})", shown.join(" -> "))
            } else {
                String::new()
            }
        };
        // The example chain is the first client's: only that one is known to pass here.
        let through = g.reaches == rel || g.example.iter().any(|n| n == rel);
        for (i, c) in g.clients.iter().enumerate() {
            let key = leak_key(c, &g.reaches);
            if !(c == rel || (through && (i == 0 || g.reaches == rel))) || known(&key) {
                continue;
            }
            out.keys.insert(key);
            let who = if c == rel {
                "as client code (\"use client\"), it".to_string()
            } else {
                format!("client file {} (\"use client\")", sanitize(c, 160))
            };
            let what = match g.reaches.strip_prefix("env:") {
                Some(var) => format!(
                    "now reads the env var {}, whose name has no public prefix",
                    sanitize(var, 80)
                ),
                None => format!(
                    "now reaches server-only code: {}{}",
                    sanitize(&g.reaches, 160),
                    chain(c)
                ),
            };
            lines.push((4, c.clone(), 0, format!("{who} {what}")));
        }
    }
    lines.sort();
    lines.dedup();
    let more = lines.len().saturating_sub(MAX_LINES);
    out.lines = lines
        .into_iter()
        .take(MAX_LINES)
        .map(|(_, _, _, text)| format!("- {text}"))
        .collect();
    if more > 0 {
        out.lines.push(format!("- and {more} more"));
    }
    out
}

/// The key of the production edge `from` -> `to` of the package graph.
pub fn edge_key(from: &str, to: &str) -> String {
    format!("edge|{from}|{to}")
}

/// `(from, to)` of an [`edge_key`].
pub fn edge_ends(key: &str) -> Option<(&str, &str)> {
    key.strip_prefix("edge|")?.split_once('|')
}

/// The key of every production edge of the graph ([`PackageGraph::prod`]): what
/// `drift map` lists under "depends on".
pub fn edge_keys(graph: &PackageGraph) -> BTreeSet<String> {
    graph
        .prod
        .iter()
        .flat_map(|(from, tos)| tos.keys().map(move |to| edge_key(from, to)))
        .collect()
}

/// The keys of the edges the imports of one file may make, from its facts alone: an
/// import of a workspace package by name, or of a module under another of `dirs` (the
/// package directories known: the deepest holding the module is taken as its package).
/// What a hook looks at before it pays for the graph, which decides: a key here may be
/// no edge of the graph (a test edge, a package read otherwise).
pub fn candidate_edges(
    f: &FileFacts,
    packages: &[PackageFacts],
    dirs: &BTreeSet<String>,
) -> BTreeSet<String> {
    candidate_imports(f, packages, dirs)
        .into_iter()
        .map(|(key, _)| key)
        .collect()
}

/// [`candidate_edges`] with the module of each import that may make it: `(key,
/// module)`. What a hook has looked up is an import, not a pair of packages: another
/// import of the same pair may be an edge where this one is none.
pub fn candidate_imports(
    f: &FileFacts,
    packages: &[PackageFacts],
    dirs: &BTreeSet<String>,
) -> BTreeSet<(String, String)> {
    let all: BTreeSet<&str> = dirs
        .iter()
        .map(String::as_str)
        .chain(packages.iter().map(|p| p.path.as_str()))
        .collect();
    let mut out = BTreeSet::new();
    for i in &f.imports {
        let target = if let Some(name) = crate::map::imported_package_name(&i.module) {
            packages
                .iter()
                .find(|p| !p.name.is_empty() && p.name == name)
                .map(|p| p.path.as_str())
        } else if i.module.starts_with("unresolved:") {
            None
        } else {
            Some(crate::workspace::package_of(all.iter().copied(), &i.module))
        };
        if let Some(t) = target
            && t != f.package
        {
            out.insert((edge_key(&f.package, t), i.module.clone()));
        }
    }
    out
}

/// A production edge of the package graph an edit made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEdge {
    pub from: String,
    pub to: String,
    /// The module the file imports that lands in `to`.
    pub module: String,
    /// How many production files of `to` import `from`: more than none, and the two
    /// packages now depend on each other.
    pub back: usize,
}

/// The production edges the file's imports make (`targets`, of
/// [`crate::map::file_targets`]) whose key is not `known`, with what `graph` (after
/// the edit) says of the way back. Sorted by the package imported.
pub fn new_edges(
    from: &str,
    targets: &[FileTarget],
    graph: &PackageGraph,
    known: &dyn Fn(&str) -> bool,
) -> Vec<NewEdge> {
    targets
        .iter()
        .filter(|t| !t.test && !known(&edge_key(from, &t.package)))
        .map(|t| NewEdge {
            from: from.to_string(),
            to: t.package.clone(),
            module: t.module.clone(),
            back: graph
                .prod
                .get(&t.package)
                .and_then(|m| m.get(from))
                .copied()
                .unwrap_or(0),
        })
        .collect()
}

/// A package as the messages name it: its directory, or `the root package`.
pub fn package_name(path: &str) -> String {
    if path.is_empty() {
        "the root package".to_string()
    } else {
        format!("package {}", sanitize(path, 120))
    }
}

/// An imported module as the messages name it: the path of an in-repo module, the
/// specifier of a workspace package (`@acme/ui/button`).
pub fn module_name(module: &str) -> String {
    let m = module.strip_prefix("pkg:").unwrap_or(module);
    sanitize(m.split('#').next().unwrap_or(m), 160)
}

/// The first line of `text` that imports the package called `name`: a quoted
/// specifier (`"@acme/ui"`, `'@acme/ui/button'`), or a Python `import`/`from` line
/// that names it.
fn line_naming(text: &str, name: &str) -> Option<u32> {
    let quoted = |q: char| {
        let exact = format!("{q}{name}{q}");
        let sub = format!("{q}{name}/");
        move |l: &str| l.contains(&exact) || l.contains(&sub)
    };
    let (double, single) = (quoted('"'), quoted('\''));
    let dotted = name.replace('-', "_");
    text.lines().enumerate().find_map(|(n, l)| {
        let t = l.trim_start();
        let python = (t.starts_with("import ") || t.starts_with("from "))
            && t.split([' ', ',', '.']).any(|w| w == dotted || w == name);
        (double(l) || single(l) || python).then_some(n as u32 + 1)
    })
}

/// The 1-based line of `text` (the file at `from`) that imports `module`, best effort:
/// a quoted specifier that names it ([`crate::check::find_import`]; for a package, its
/// name), a Python `import`/`from` line whose dotted name is the module's path, or a
/// line that names `package`, the workspace name of the package the module is in (an
/// import by name the scan resolved to a file). `None` when no line is found: the
/// caller then names the module only.
pub fn import_line(text: &str, from: &str, module: &str, package: Option<&str>) -> Option<u32> {
    if let Some(name) = crate::map::imported_package_name(module) {
        return line_naming(text, &name);
    }
    if let Some((line, _)) = crate::check::find_import(text, from, module) {
        return Some(line);
    }
    python_line(text, module).or_else(|| line_naming(text, package.filter(|n| !n.is_empty())?))
}

/// Python: `from quillo.model.order import Order` names `…/quillo/model/order.py`, or
/// `…/quillo/model/order/__init__.py`, or with `Order` a module, `…/order/Order.py`.
fn python_line(text: &str, module: &str) -> Option<u32> {
    let stem = module.strip_suffix(".py").or(module.strip_suffix(".pyi"))?;
    let stem = stem.strip_suffix("/__init__").unwrap_or(stem);
    let ends = |path: &str| stem == path || stem.ends_with(&format!("/{path}"));
    text.lines().enumerate().find_map(|(n, l)| {
        let t = l.trim_start();
        let hit = if let Some(rest) = t.strip_prefix("from ") {
            let (name, names) = rest.split_once(" import ")?;
            let path = name.trim().replace('.', "/");
            !name.trim().starts_with('.')
                && (ends(&path)
                    || names
                        .split(',')
                        .filter_map(|x| x.split_whitespace().next())
                        .any(|x| ends(&format!("{path}/{}", x.trim_matches(['(', ')'])))))
        } else if let Some(rest) = t.strip_prefix("import ") {
            rest.split(',')
                .filter_map(|x| x.split_whitespace().next())
                .any(|x| ends(&x.replace('.', "/")))
        } else {
            false
        };
        hit.then_some(n as u32 + 1)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::{LeakGroup, SinkUse};

    fn entry(
        path: &str,
        symbol: &str,
        line: u32,
        guards: &[&str],
        reaches: Vec<Reach>,
    ) -> EntryRow {
        EntryRow {
            path: path.into(),
            package: String::new(),
            symbol: symbol.into(),
            line,
            kind: "http".into(),
            method: Some("POST".into()),
            route: Some(format!("/{symbol}")),
            guards: guards.iter().map(|g| g.to_string()).collect(),
            wrappers: vec![],
            opaque: vec![],
            local: false,
            descriptions: Vec::new(),
            tied: false,
            basis: None,
            exposure_basis: None,
            known_open: false,
            verifies_signature: Vec::new(),
            authenticates: vec![],
            opens: vec![],
            validates: false,
            reaches,
            reads: vec![],
            exposure: Exposure::Unknown,
            boundary: None,
        }
    }

    fn reach(kind: &str, via: &[&str]) -> Reach {
        Reach {
            kind: kind.into(),
            via: via.iter().map(|v| v.to_string()).collect(),
            fed: false,
        }
    }

    fn sink(kind: &str, path: &str, symbol: &str, line: u32) -> SinkUse {
        SinkUse {
            kind: kind.into(),
            path: path.into(),
            symbol: symbol.into(),
            line,
            fed: false,
        }
    }

    /// An API file with a guarded and an unguarded route, both reaching a shell command
    /// in a helper, and a hash of its own in a third function.
    fn inventory() -> Inventory {
        Inventory {
            entry_points: vec![
                entry(
                    "api/fs.py",
                    "copy",
                    10,
                    &[],
                    vec![reach(
                        "shell_exec",
                        &["api/fs.py#copy", "lib/ops.py#cp", "lib/run.py#run"],
                    )],
                ),
                entry(
                    "api/fs.py",
                    "move",
                    20,
                    &["get_user"],
                    vec![reach("shell_exec", &["api/fs.py#move", "lib/run.py#run"])],
                ),
                entry(
                    "api/other.py",
                    "ping",
                    5,
                    &[],
                    vec![reach("dynamic_fetch", &["api/other.py#ping"])],
                ),
            ],
            sinks: vec![
                sink("dynamic_fetch", "api/other.py", "ping", 5),
                sink("shell_exec", "lib/run.py", "run", 3),
                sink("weak_hash", "api/fs.py", "etag", 30),
            ],
            ..Inventory::default()
        }
    }

    #[test]
    fn what_an_edit_introduced_is_listed_once_the_unguarded_reach_first() {
        let inv = inventory();
        let none = |_: &str| false;
        let got = introduced(&inv, "api/fs.py", &none);
        assert_eq!(
            got.lines,
            [
                "- POST /copy [http] (copy:10) has no guard found in what Drift read and now reaches lib/run.py#run, which runs a shell command (shell_exec), via lib/ops.py#cp",
                "- POST /move [http] (move:20) is guarded by get_user and now reaches lib/run.py#run, which runs a shell command (shell_exec)",
                "- etag:30 hashes with MD5 or SHA-1 (weak_hash)",
            ]
        );
        // Every key found is recorded: nothing of it is new a second time.
        let known = |k: &str| got.keys.contains(k);
        assert_eq!(introduced(&inv, "api/fs.py", &known), Introduced::default());
        // The session started with all of it: nothing to say, whichever file is edited.
        let base = security_keys(&inv);
        let known = |k: &str| base.contains(k);
        for rel in ["api/fs.py", "lib/run.py", "lib/ops.py", "api/other.py"] {
            assert_eq!(
                introduced(&inv, rel, &known),
                Introduced::default(),
                "{rel}"
            );
        }
    }

    #[test]
    fn an_operation_is_named_from_the_file_that_holds_it_and_from_one_between() {
        let inv = inventory();
        let none = |_: &str| false;
        // The helper with the operation: the entry points that end at it, then nothing
        // more for the operation itself.
        let got = introduced(&inv, "lib/run.py", &none);
        assert_eq!(
            got.lines,
            [
                "- POST /copy [http] (api/fs.py:10 copy) has no guard found in what Drift read and now reaches lib/run.py#run, which runs a shell command (shell_exec), via lib/ops.py#cp",
                "- POST /move [http] (api/fs.py:20 move) is guarded by get_user and now reaches lib/run.py#run, which runs a shell command (shell_exec)",
            ]
        );
        assert!(got.keys.contains("sink|lib/run.py|run|shell_exec"));
        // A file between: only the chain through it.
        let got = introduced(&inv, "lib/ops.py", &none);
        assert_eq!(got.lines.len(), 1, "{:?}", got.lines);
        assert!(got.lines[0].starts_with("- POST /copy [http] (api/fs.py:10 copy)"));
        // An operation in the entry point itself, and one no entry point reaches.
        let got = introduced(&inv, "api/other.py", &none);
        assert_eq!(
            got.lines,
            [
                "- POST /ping [http] (ping:5) has no guard found in what Drift read and now requests a computed URL (dynamic_fetch)"
            ]
        );
        let mut alone = Inventory::default();
        alone.sinks.push(sink("shell_exec", "lib/run.py", "run", 3));
        assert_eq!(
            introduced(&alone, "lib/run.py", &none).lines,
            ["- run:3 runs a shell command (shell_exec)"]
        );
    }

    #[test]
    fn an_entry_point_is_one_line_with_all_it_newly_reaches() {
        let mut inv = inventory();
        inv.entry_points[0]
            .reaches
            .push(reach("unsafe_deserialize", &["api/fs.py#copy"]));
        // Listed twice (one script, two commands): still one line.
        inv.entry_points.push(inv.entry_points[0].clone());
        let base = security_keys(&inventory());
        let known = |k: &str| base.contains(k) && !k.contains("|copy|");
        let got = introduced(&inv, "api/fs.py", &known);
        assert_eq!(
            got.lines,
            [
                "- POST /copy [http] (copy:10) has no guard found in what Drift read and now reaches lib/run.py#run, which runs a shell command (shell_exec), via lib/ops.py#cp; and now deserialises with pickle or another unsafe loader (unsafe_deserialize)"
            ]
        );
        assert_eq!(got.keys.len(), 4, "{:?}", got.keys);
    }

    #[test]
    fn a_guard_taken_off_an_entry_point_that_reached_an_operation_is_said() {
        let mut inv = inventory();
        let base = security_keys(&inv);
        let known = |k: &str| base.contains(k);
        // `move` loses its guard: it reached the command before, behind one.
        inv.entry_points[1].guards.clear();
        inv.entry_points[1].exposure = Exposure::Public;
        inv.entry_points[1].boundary = Some("compose service api publishes ports".into());
        let got = introduced(&inv, "api/fs.py", &known);
        assert_eq!(
            got.lines,
            [
                "- POST /move [http] (move:20) now has no guard found in what Drift read, is internet-facing (compose service api publishes ports) and reaches lib/run.py#run, which runs a shell command (shell_exec)"
            ]
        );
        assert_eq!(
            got.keys.iter().map(String::as_str).collect::<Vec<_>>(),
            [
                "bare|api/fs.py|move|shell_exec",
                "reach|api/fs.py|move|shell_exec"
            ]
        );
        // What still stands of what was told and the code did not start with: the
        // missing guard, one fact.
        let told = |k: &str| got.keys.contains(k) && !base.contains(k);
        let (n, files) = still_there(&security_keys(&inv), &told);
        assert_eq!(
            (n, files.into_iter().collect::<Vec<_>>()),
            (1, vec!["api/fs.py".to_string()])
        );
        // Guarded again: it no longer stands (that it reaches the command is the code's).
        inv.entry_points[1].guards.push("get_user".into());
        assert_eq!(still_there(&security_keys(&inv), &told).0, 0);
        // An entry point with no guard that runs a command itself has three keys (the
        // operation, the reach, the reach with no guard) and is one fact.
        let keys: BTreeSet<String> = [
            "bare|api/fs.py|copy|shell_exec",
            "reach|api/fs.py|copy|shell_exec",
            "sink|api/fs.py|copy|shell_exec",
            "sink|lib/run.py|run|shell_exec",
        ]
        .map(String::from)
        .into();
        let (n, files) = still_there(&keys, &|_: &str| true);
        assert_eq!((n, files.len()), (2, 2));
    }

    #[test]
    fn client_leaks_and_the_cap() {
        let inv = Inventory {
            client_leaks: vec![
                LeakGroup {
                    reaches: "lib/db.ts".into(),
                    clients: vec!["app/a.tsx".into(), "app/b.tsx".into()],
                    example: vec![
                        "app/a.tsx".into(),
                        "lib/users.ts".into(),
                        "lib/db.ts".into(),
                    ],
                },
                LeakGroup {
                    reaches: "env:API_SECRET".into(),
                    clients: vec!["app/a.tsx".into()],
                    example: vec!["app/a.tsx".into(), "env:API_SECRET".into()],
                },
            ],
            ..Inventory::default()
        };
        let none = |_: &str| false;
        assert_eq!(
            introduced(&inv, "app/a.tsx", &none).lines,
            [
                "- as client code (\"use client\"), it now reaches server-only code: lib/db.ts (import chain: app/a.tsx -> lib/users.ts -> lib/db.ts)",
                "- as client code (\"use client\"), it now reads the env var API_SECRET, whose name has no public prefix",
            ]
        );
        // The module that became server-only: every client that reaches it. A module
        // between: the client whose chain is known to pass through it.
        assert_eq!(introduced(&inv, "lib/db.ts", &none).lines.len(), 2);
        assert_eq!(
            introduced(&inv, "lib/users.ts", &none).lines,
            [
                "- client file app/a.tsx (\"use client\") now reaches server-only code: lib/db.ts (import chain: app/a.tsx -> lib/users.ts -> lib/db.ts)"
            ]
        );
        assert_eq!(introduced(&inv, "app/b.tsx", &none).lines.len(), 1);
        // More than the cap: the rest is counted, and every key is recorded.
        let mut many = Inventory::default();
        for i in 0..9 {
            many.sinks
                .push(sink("eval", "lib/x.ts", &format!("f{i}"), i + 1));
        }
        let got = introduced(&many, "lib/x.ts", &none);
        assert_eq!(got.lines.len(), MAX_LINES + 1);
        assert_eq!(got.lines[MAX_LINES], "- and 3 more");
        assert_eq!(got.keys.len(), 9);
    }

    #[test]
    fn one_files_own_keys_are_the_inventorys() {
        let f = FileFacts {
            path: "lib/run.py".into(),
            symbols: vec![drift_core::Symbol {
                name: "run".into(),
                sinks: vec!["shell_exec".into()],
                ..Default::default()
            }],
            client_leaks: vec!["env:API_SECRET".into()],
            ..Default::default()
        };
        let keys = file_keys(&f);
        assert!(keys.contains("leak|lib/run.py|env:API_SECRET"), "{keys:?}");
        let base = security_keys(&inventory());
        assert!(keys.iter().any(|k| base.contains(k)), "{keys:?}");
        assert_eq!(
            key_path("sink|lib/run.py|run|shell_exec"),
            Some("lib/run.py")
        );
    }

    #[test]
    fn edges_by_key_candidates_and_the_way_back() {
        let mut graph = PackageGraph::default();
        graph
            .prod
            .entry("libs/db".into())
            .or_default()
            .insert("apps/web".into(), 2);
        graph
            .test
            .entry("apps/web".into())
            .or_default()
            .insert("libs/db".into(), 1);
        let base = edge_keys(&graph);
        assert_eq!(base.iter().collect::<Vec<_>>(), ["edge|libs/db|apps/web"]);
        assert_eq!(
            edge_ends("edge|libs/db|apps/web"),
            Some(("libs/db", "apps/web"))
        );
        let import = |m: &str| drift_core::Import {
            module: m.into(),
            names: vec![],
            type_only: false,
            load: Default::default(),
        };
        let f = FileFacts {
            path: "apps/web/src/page.ts".into(),
            package: "apps/web".into(),
            imports: vec![
                import("apps/web/src/util.ts"),
                import("libs/db/src/index.ts"),
                import("pkg:@acme/ui/button"),
                import("pkg:react"),
                import("unresolved:./gone"),
            ],
            ..Default::default()
        };
        let packages = vec![PackageFacts {
            path: "libs/ui".into(),
            name: "@acme/ui".into(),
            ..Default::default()
        }];
        let dirs: BTreeSet<String> = ["apps/web", "libs/db"].map(String::from).into();
        assert_eq!(
            candidate_edges(&f, &packages, &dirs)
                .into_iter()
                .collect::<Vec<_>>(),
            ["edge|apps/web|libs/db", "edge|apps/web|libs/ui"]
        );
        // The graph decides: the test edge is none, the other is new, with its way back.
        let targets = [
            FileTarget {
                package: "libs/db".into(),
                test: false,
                module: "libs/db/src/index.ts".into(),
            },
            FileTarget {
                package: "libs/ui".into(),
                test: true,
                module: "pkg:@acme/ui/button".into(),
            },
        ];
        let known = |k: &str| base.contains(k);
        let new = new_edges("apps/web", &targets, &graph, &known);
        assert_eq!(new.len(), 1);
        assert_eq!((new[0].to.as_str(), new[0].back), ("libs/db", 2));
        let known = |_: &str| true;
        assert!(new_edges("apps/web", &targets, &graph, &known).is_empty());
        assert_eq!(package_name(""), "the root package");
        assert_eq!(package_name("libs/db"), "package libs/db");
        assert_eq!(module_name("pkg:@acme/ui/button#Button"), "@acme/ui/button");
        assert_eq!(module_name("libs/db/src/index.ts"), "libs/db/src/index.ts");
    }

    #[test]
    fn the_line_of_an_import() {
        let ts = "import { a } from \"./a\";\nimport { db } from '../../../libs/db/src/index';\nimport { Button } from \"@acme/ui/button\";\n";
        assert_eq!(
            import_line(ts, "apps/web/src/page.ts", "libs/db/src/index.ts", None),
            Some(2)
        );
        assert_eq!(
            import_line(ts, "apps/web/src/page.ts", "pkg:@acme/ui/button", None),
            Some(3)
        );
        assert_eq!(
            import_line(ts, "apps/web/src/page.ts", "pkg:@acme/other", None),
            None
        );
        let py = "import os\nfrom quillo.model.order import Order\nfrom quillo import messaging\nimport quillo.clients.http as http\nfrom . import sibling\n";
        let at = |module: &str| import_line(py, "svc/app/main.py", module, None);
        assert_eq!(at("libs/model/quillo/model/order.py"), Some(2));
        assert_eq!(at("libs/model/quillo/model/order/__init__.py"), Some(2));
        assert_eq!(at("libs/msg/quillo/messaging/__init__.py"), Some(3));
        assert_eq!(at("libs/clients/quillo/clients/http.py"), Some(4));
        assert_eq!(at("libs/other/thing.py"), None);
        assert_eq!(
            import_line("import quillo_model\n", "a.py", "pkg:quillo-model", None),
            Some(1)
        );
        // An import by name the scan resolved to a file of the package.
        assert_eq!(
            import_line(
                ts,
                "apps/web/src/page.ts",
                "libs/ui/src/button.ts",
                Some("@acme/ui")
            ),
            Some(3)
        );
        assert_eq!(
            import_line(ts, "a.ts", "libs/ui/src/button.ts", Some("")),
            None
        );
    }
}
