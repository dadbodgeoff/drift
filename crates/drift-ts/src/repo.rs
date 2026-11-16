//! Repo-level facts computed after linking: test pairing, client-bundle leaks,
//! database models (Prisma, SQL migrations), workspace package config and linter configs.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use drift_core::{FileFacts, Model, PackageFacts, RepoFacts};

/// Imports that make a module server-only: the team's own `server-only` marker,
/// Node file and process APIs, database drivers and server SDKs. A module importing
/// one, or importing a module that does, must not reach a client bundle.
/// (`@prisma/client` counts only for `PrismaClient`: its enums are shared with clients,
/// and `drizzle-orm` operators are pure functions.)
const SERVER_ROOTS: &[&str] = &[
    "pkg:server-only",
    "pkg:next/headers",
    "pkg:node:fs",
    "pkg:fs",
    "pkg:node:child_process",
    "pkg:child_process",
    "pkg:pg",
    "pkg:postgres",
    "pkg:mysql2",
    "pkg:mongoose",
    "pkg:typeorm",
    "pkg:ioredis",
    "pkg:@vercel/postgres",
    "pkg:@planetscale/database",
    "pkg:@neondatabase/serverless",
    "pkg:stripe",
];

/// Value imports client-leak analysis follows. Edges found only through a lazy-load
/// helper are not: a single-file check reads the files a client file reaches from
/// their own lowering, without linking helpers, and must reach the same answer.
pub(crate) fn leak_edge(i: &drift_core::Import) -> bool {
    !i.type_only && i.load != drift_core::ImportLoad::Lazy
}

fn is_server_root(i: &drift_core::Import) -> bool {
    leak_edge(i) && server_root(&i.module, &i.names)
}

/// `module` is a server root when these `names` of it are used.
fn server_root<N: AsRef<str>>(module: &str, names: &[N]) -> bool {
    SERVER_ROOTS.iter().any(|p| {
        module
            .strip_prefix(p)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    }) || (module == "pkg:@prisma/client" && names.iter().any(|n| n.as_ref() == "PrismaClient"))
}

/// What one file re-exports, for client leaks. A module a file imports only to
/// re-export from it (`export { x } from "./db"`, `export * from "./db"`) makes the
/// file server-only for the names it forwards from there, not as a whole: a client
/// importing `Button` from a barrel that also re-exports the database client does
/// not reach the database through it, while one importing `db` does.
#[derive(Debug, Clone, Default)]
pub struct Reexports {
    /// Modules the file imports only in re-export statements.
    pub only: BTreeSet<String>,
    /// Exported name -> (source module, name there): `export { a as b } from "s"`,
    /// `export * as ns from "s"` (name `*`), and `export { x }` of an import.
    pub named: BTreeMap<String, (String, String)>,
    /// `export * from "s"` sources.
    pub stars: Vec<String>,
    /// Every name the file exports explicitly (declared or re-exported by name).
    pub names: BTreeSet<String>,
}

impl Reexports {
    /// From a file's lowering, with `resolve` turning a specifier into a module id.
    pub(crate) fn of(raw: &crate::lower::RawFile, resolve: impl Fn(&str) -> String) -> Self {
        use crate::lower::RawExportTarget;
        let mut out = Reexports::default();
        let code: BTreeSet<String> = raw
            .imports
            .iter()
            .filter(|i| !i.type_only && !i.reexport)
            .map(|i| resolve(&i.spec))
            .collect();
        out.only = raw
            .imports
            .iter()
            .filter(|i| !i.type_only && i.reexport)
            .map(|i| resolve(&i.spec))
            .filter(|m| !code.contains(m))
            .collect();
        for e in &raw.exports {
            match &e.target {
                RawExportTarget::Local(_) => {
                    out.names.insert(e.name.clone());
                }
                RawExportTarget::From { spec, name } => {
                    out.names.insert(e.name.clone());
                    out.named
                        .insert(e.name.clone(), (resolve(spec), name.clone()));
                }
                RawExportTarget::All { spec } => out.stars.push(resolve(spec)),
            }
        }
        out
    }
}

/// Re-export chains are followed at most this deep.
const MAX_REEXPORT_HOPS: usize = 16;
// [`ExportsMemo`] keeps one bit per depth.
const _: () = assert!(MAX_REEXPORT_HOPS < 32);

/// What [`exports_name`] answered, per module, name and depth: it reads only the
/// re-exports, and a module behind many barrels is asked the same question by every
/// path to it. The depth is part of the question (a chain cut at
/// [`MAX_REEXPORT_HOPS`] from one start is not cut from a nearer one).
#[derive(Default)]
struct ExportsMemo<'r> {
    /// module -> name -> (depths answered, answers), one bit per depth.
    answers: HashMap<&'r str, HashMap<&'r str, (u32, u32)>>,
}

/// Whether the repo module `module` exports `name`, through `export *` too. A module
/// whose exports are not known (a package, an unresolved specifier) may: `export *`
/// from it is followed conservatively.
fn exports_name<'r>(
    reexports: &'r BTreeMap<String, Reexports>,
    module: &str,
    name: &'r str,
    depth: usize,
    memo: &mut ExportsMemo<'r>,
) -> bool {
    // `MAX_REEXPORT_HOPS < 32`. An answer is remembered only past the checks below,
    // whose outcome is fixed.
    let bit = 1u32 << depth.min(31);
    if depth <= MAX_REEXPORT_HOPS
        && let Some((asked, yes)) = memo.answers.get(module).and_then(|m| m.get(name))
        && asked & bit != 0
    {
        return yes & bit != 0;
    }
    let Some((key, r)) = reexports.get_key_value(module) else {
        return true;
    };
    if depth > MAX_REEXPORT_HOPS {
        return false;
    }
    if r.names.contains(name) {
        return true;
    }
    // A module that re-exports no `*` answers at once: only chains are remembered.
    if name == "default" || r.stars.is_empty() {
        return false;
    }
    let answer = r
        .stars
        .iter()
        .any(|s| exports_name(reexports, s, name, depth + 1, memo));
    let entry = memo
        .answers
        .entry(key.as_str())
        .or_default()
        .entry(name)
        .or_default();
    entry.0 |= bit;
    if answer {
        entry.1 |= bit;
    }
    answer
}

/// Env var prefixes that are exposed to the browser on purpose.
const PUBLIC_ENV_PREFIXES: &[&str] = &[
    "NEXT_PUBLIC_",
    "VITE_",
    "PUBLIC_",
    "REACT_APP_",
    "EXPO_PUBLIC_",
    "NODE_ENV",
];
const SOURCE_EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];

fn is_test_name(path: &str) -> bool {
    let f = path.rsplit('/').next().unwrap_or(path);
    f.contains(".test.") || f.contains(".spec.") || path.split('/').any(|d| d == "__tests__")
}

/// Mark files that have a matching test or spec file.
pub fn pair_tests(repo: &mut RepoFacts) {
    // A test file not parsed for lack of stack still exists: it pairs like the others.
    let all: BTreeSet<String> = repo
        .files
        .iter()
        .map(|f| f.path.clone())
        .chain(repo.stack_unavailable().into_iter().map(str::to_string))
        .collect();
    for f in &mut repo.files {
        f.has_test = has_test(&f.path, &all);
    }
}

/// True when `path` is not itself a test and `all` holds a matching test or spec file.
pub fn has_test(path: &str, all: &BTreeSet<String>) -> bool {
    if is_test_name(path) {
        return false;
    }
    let (dir, file) = path.rsplit_once('/').unwrap_or(("", path));
    let stem = file.split('.').next().unwrap_or(file);
    // Each candidate is `<dir>/[__tests__/]<stem>.<infix><ext>`, built in one buffer.
    let mut c = String::with_capacity(path.len() + 24);
    // Most files have no file of either prefix next to them: one look each, then none.
    let any_starting = |c: &mut String, tests_dir: bool| {
        c.clear();
        if !dir.is_empty() {
            c.push_str(dir);
            c.push('/');
        }
        if tests_dir {
            c.push_str("__tests__/");
        }
        c.push_str(stem);
        c.push('.');
        let prefix = c.as_str();
        all.range::<str, _>((
            std::ops::Bound::Included(prefix),
            std::ops::Bound::Unbounded,
        ))
        .next()
        .is_some_and(|f| f.starts_with(prefix))
    };
    if !any_starting(&mut c, false) && !any_starting(&mut c, true) {
        return false;
    }
    let mut has = |tests_dir: bool, infix: &str, ext: &str| {
        c.clear();
        if !dir.is_empty() {
            c.push_str(dir);
            c.push('/');
        }
        if tests_dir {
            c.push_str("__tests__/");
        }
        c.push_str(stem);
        c.push('.');
        c.push_str(infix);
        c.push_str(ext);
        all.contains(c.as_str())
    };
    SOURCE_EXTS.iter().any(|ext| {
        has(false, "test.", ext)
            || has(false, "spec.", ext)
            || has(true, "test.", ext)
            || has(true, "spec.", ext)
            || has(true, "", ext)
    })
}

/// For `"use client"` files: the server-only modules they reach (the module that
/// imports the server root, e.g. `lib/prisma.ts`, or the package itself when imported
/// directly) and the non-public env vars they read. `reexports` holds each file's
/// re-exports ([`Reexports`]): an edge made only by re-export statements is followed
/// only for the names a file imports through it.
pub fn client_leaks(repo: &mut RepoFacts, reexports: &BTreeMap<String, Reexports>) {
    let by_path: BTreeMap<&str, &FileFacts> =
        repo.files.iter().map(|f| (f.path.as_str(), f)).collect();
    let is_use_server = |f: &FileFacts| f.directives.iter().any(|d| d == "use server");
    // An edge of the file's own code (not made only by its re-exports).
    let code_edge = |f: &FileFacts, i: &drift_core::Import| {
        leak_edge(i)
            && !reexports
                .get(&f.path)
                .is_some_and(|r| r.only.contains(&i.module))
    };
    // Fixed point: a module is server-only if its own code imports a server root, a
    // server-only module, or names a barrel forwards from one. `"use server"` files
    // are RPC boundaries the client may import, so they do not propagate. `origin`
    // records the root each one reaches.
    let mut origin: BTreeMap<String, String> = BTreeMap::new();
    let mut memo = LeakMemo::default();
    for f in &repo.files {
        if !is_use_server(f)
            && f.imports
                .iter()
                .any(|i| code_edge(f, i) && is_server_root(i))
        {
            origin.insert(f.path.clone(), f.path.clone());
        }
    }
    loop {
        let mut changed = false;
        for f in &repo.files {
            if origin.contains_key(&f.path) || is_use_server(f) {
                continue;
            }
            if let Some(o) = f.imports.iter().filter(|i| code_edge(f, i)).find_map(|i| {
                origin.get(&i.module).cloned().or_else(|| {
                    forwarded(&by_path, reexports, &origin, &i.module, &i.names, &mut memo)
                })
            }) {
                origin.insert(f.path.clone(), o);
                memo.entered(&f.path);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let mut leaks: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for f in &repo.files {
        if !f.directives.iter().any(|d| d == "use client") {
            continue;
        }
        let mut found = Vec::new();
        // Every edge of a client file, its own re-exports too: they are in its bundle.
        for i in f.imports.iter().filter(|i| leak_edge(i)) {
            if is_server_root(i) {
                found.push(i.module.clone());
            } else if let Some(o) = origin.get(&i.module)
                && by_path
                    .get(i.module.as_str())
                    .is_some_and(|m| !is_use_server(m))
            {
                found.push(o.clone());
            } else if let Some(o) =
                forwarded(&by_path, reexports, &origin, &i.module, &i.names, &mut memo)
            {
                found.push(o);
            }
        }
        for s in &f.symbols {
            // Reads made only on the server (`typeof window === "undefined"`) stay there.
            for r in s.reads.iter().filter(|r| !s.server_reads.contains(r)) {
                let var = r.rsplit('.').next().unwrap_or(r);
                if r.starts_with("process.env.")
                    && !PUBLIC_ENV_PREFIXES.iter().any(|p| var.starts_with(p))
                {
                    found.push(format!("env:{var}"));
                }
            }
        }
        if !found.is_empty() {
            leaks.insert(f.path.clone(), found);
        }
    }
    for f in &mut repo.files {
        if let Some(l) = leaks.remove(&f.path) {
            f.client_leaks = l;
        }
    }
}

/// What [`forwarded`] answered, per module, name and depth (`*` for every name). The
/// answer reads `origin`, which grows while [`client_leaks`] runs to its fixed point:
/// it holds while no module whose `origin` an answer looked up (`consulted`) has
/// entered `origin` since, so [`LeakMemo::entered`] forgets every answer when one does.
#[derive(Default)]
struct LeakMemo<'r> {
    exports: ExportsMemo<'r>,
    forwarded: HashMap<(&'r str, usize), HashMap<&'r str, Option<String>>>,
    consulted: HashSet<&'r str>,
}

impl LeakMemo<'_> {
    /// `module` has just entered `origin`.
    fn entered(&mut self, module: &str) {
        if self.consulted.contains(module) {
            self.forwarded.clear();
            self.consulted.clear();
        }
    }
}

/// The server root reached through what the repo module `module` re-exports, for an
/// import of `names` from it (all of them for `*`, or for a side-effect import that
/// names none): a server root package forwarded, or a server-only module
/// (`origin`). `None` when those names are not forwarded from server-only code.
/// `export *` sources are followed for a name only when they may export it.
fn forwarded<'r>(
    by_path: &BTreeMap<&str, &FileFacts>,
    reexports: &'r BTreeMap<String, Reexports>,
    origin: &BTreeMap<String, String>,
    module: &str,
    names: &'r [String],
    memo: &mut LeakMemo<'r>,
) -> Option<String> {
    // The sources of several names are those of each name in turn.
    if names.is_empty() || names.iter().any(|n| n == "*") {
        forwarded_name(by_path, reexports, origin, module, "*", 0, memo)
    } else {
        names
            .iter()
            .find_map(|n| forwarded_name(by_path, reexports, origin, module, n, 0, memo))
    }
}

/// [`forwarded`] for one name (`*`: every name) at re-export depth `depth`.
fn forwarded_name<'r>(
    by_path: &BTreeMap<&str, &FileFacts>,
    reexports: &'r BTreeMap<String, Reexports>,
    origin: &BTreeMap<String, String>,
    module: &str,
    name: &'r str,
    depth: usize,
    memo: &mut LeakMemo<'r>,
) -> Option<String> {
    // An answer is remembered only past the checks below, whose outcome is fixed.
    if let Some(a) = memo
        .forwarded
        .get(&(module, depth))
        .and_then(|m| m.get(name))
    {
        return a.clone();
    }
    let (key, r) = reexports.get_key_value(module)?;
    if depth > MAX_REEXPORT_HOPS
        || by_path
            .get(module)
            .is_some_and(|f| f.directives.iter().any(|d| d == "use server"))
    {
        return None;
    }
    let mut sources: Vec<(&'r str, &'r str)> = Vec::new();
    if name == "*" {
        sources.extend(r.named.values().map(|(m, n)| (m.as_str(), n.as_str())));
        sources.extend(r.stars.iter().map(|m| (m.as_str(), "*")));
    } else if let Some((m, sn)) = r.named.get(name) {
        sources.push((m.as_str(), sn.as_str()));
    } else if name != "default" && !r.names.contains(name) {
        for s in &r.stars {
            if exports_name(reexports, s, name, depth + 1, &mut memo.exports) {
                sources.push((s.as_str(), name));
            }
        }
    }
    // Nothing forwarded: answered at once, not remembered.
    if sources.is_empty() {
        return None;
    }
    let answer = sources.into_iter().find_map(|(m, n)| {
        if server_root(m, &[n]) {
            return Some(m.to_string());
        }
        // `origin` never holds a `"use server"` file.
        memo.consulted.insert(m);
        if let Some(o) = origin.get(m) {
            return Some(o.clone());
        }
        forwarded_name(by_path, reexports, origin, m, n, depth + 1, memo)
    });
    let names = memo.forwarded.entry((key.as_str(), depth)).or_default();
    names.insert(name, answer.clone());
    answer
}

/// Texts of the non-source files repo passes read, from one walk.
#[derive(Debug, Default)]
pub struct ConfigTexts {
    /// `package.json` files, sorted by path.
    pub package_jsons: Vec<(String, String)>,
    pub prisma: Vec<(String, String)>,
    /// `.sql` files with `migration` in their path.
    pub sql: Vec<(String, String)>,
    /// Linter configs (`package.json` files are also listed here: they may hold `eslintConfig`).
    pub lint: Vec<(String, String)>,
}

/// Files [`read_config`] uses, by repo-relative path (for [`drift_core::ingest::walk`]).
pub fn is_config_path(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name == "package.json"
        || name.ends_with(".prisma")
        || name.ends_with(".sql")
        || crate::lint::config_tool(rel).is_some()
}

/// Read the config files found by [`drift_core::ingest::walk`].
pub fn read_config(config: &[drift_core::ingest::Candidate]) -> ConfigTexts {
    let mut out = ConfigTexts::default();
    for c in config {
        let p = c.rel_path.as_str();
        let package = p == "package.json" || p.ends_with("/package.json");
        let prisma = p.ends_with(".prisma");
        let sql = p.ends_with(".sql") && p.split('/').any(|d| d.contains("migration"));
        let lint = crate::lint::config_tool(p).is_some();
        if !(package || prisma || sql || lint) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&c.abs_path) else {
            continue;
        };
        if lint {
            out.lint.push((c.rel_path.clone(), text.clone()));
        }
        if package {
            out.package_jsons.push((c.rel_path.clone(), text));
        } else if prisma {
            out.prisma.push((c.rel_path.clone(), text));
        } else if sql {
            out.sql.push((c.rel_path.clone(), text));
        }
    }
    out
}

/// `model User { ... }` blocks: field names are the first word of each field line.
pub fn prisma_models(path: &str, text: &str) -> Vec<Model> {
    let mut out = Vec::new();
    let mut cur: Option<Model> = None;
    for (i, line) in text.lines().enumerate() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("model ") {
            let name = rest
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_string();
            cur = Some(Model {
                path: path.into(),
                name,
                source: "prisma".into(),
                line: u32::try_from(i + 1).unwrap_or(0),
                fields: vec![],
            });
            continue;
        }
        if t.starts_with('}') {
            if let Some(m) = cur.take() {
                out.push(m);
            }
            continue;
        }
        if let Some(m) = cur.as_mut()
            && !t.is_empty()
            && !t.starts_with("//")
            && !t.starts_with("@@")
            && let Some(field) = t.split_whitespace().next()
        {
            m.fields.push(field.to_string());
        }
    }
    out
}

/// `CREATE TABLE x (...)` and `ALTER TABLE x ADD [COLUMN] y` across migration files.
pub fn sql_models(files: &[(String, String)]) -> Vec<Model> {
    let ident = |s: &str| {
        s.trim_matches(|c| {
            c == '"' || c == '`' || c == '[' || c == ']' || c == '(' || c == ',' || c == ';'
        })
        .rsplit('.')
        .next()
        .unwrap_or("")
        .trim_matches('"')
        .to_string()
    };
    let mut models: BTreeMap<String, Model> = BTreeMap::new();
    for (path, text) in files {
        let mut cur: Option<String> = None;
        for (i, line) in text.lines().enumerate() {
            let t = line.trim();
            let up = t.to_ascii_uppercase();
            if let Some(pos) = up.find("CREATE TABLE") {
                let rest = t[pos + 12..].trim_start();
                let rest = if rest.to_ascii_uppercase().starts_with("IF NOT EXISTS") {
                    rest[13..].trim_start()
                } else {
                    rest
                };
                let name = ident(
                    rest.split(|c: char| c.is_whitespace() || c == '(')
                        .next()
                        .unwrap_or(""),
                );
                if !name.is_empty() {
                    models.entry(name.clone()).or_insert_with(|| Model {
                        path: path.clone(),
                        name: name.clone(),
                        source: "sql".into(),
                        line: u32::try_from(i + 1).unwrap_or(0),
                        fields: vec![],
                    });
                    cur = Some(name);
                }
                continue;
            }
            if up.starts_with("ALTER TABLE") {
                let words: Vec<&str> = t.split_whitespace().collect();
                let table = words.get(2).map(|w| ident(w)).unwrap_or_default();
                if let Some(add) = words.iter().position(|w| w.eq_ignore_ascii_case("ADD")) {
                    let mut col = words.get(add + 1).copied().unwrap_or("");
                    if col.eq_ignore_ascii_case("COLUMN") {
                        col = words.get(add + 2).copied().unwrap_or("");
                    }
                    if !col.eq_ignore_ascii_case("CONSTRAINT")
                        && !col.is_empty()
                        && let Some(m) = models.get_mut(&table)
                    {
                        m.fields.push(ident(col));
                    }
                }
                continue;
            }
            if let Some(name) = &cur {
                if t.starts_with(')') {
                    cur = None;
                    continue;
                }
                let first = t.split_whitespace().next().unwrap_or("");
                let kw = first.to_ascii_uppercase();
                if !first.is_empty()
                    && ![
                        "CONSTRAINT",
                        "PRIMARY",
                        "FOREIGN",
                        "UNIQUE",
                        "CHECK",
                        "INDEX",
                        "KEY",
                        "--",
                    ]
                    .iter()
                    .any(|k| kw.starts_with(k))
                    && let Some(m) = models.get_mut(name)
                {
                    m.fields.push(ident(first));
                }
            }
        }
    }
    models.into_values().collect()
}

/// Where each Prisma schema says its client is generated
/// ([`drift_core::RepoFacts::generated_clients`]): the `output` of a `generator`
/// block whose provider is Prisma's own client generator (`prisma-client-js`,
/// `prisma-client`), resolved from the schema's directory. A generator of anything
/// else (zod types, enums, a query builder's types) writes no client.
pub fn generated_clients(config: &ConfigTexts) -> Vec<String> {
    let mut out: Vec<String> = config
        .prisma
        .iter()
        .flat_map(|(path, text)| prisma_client_outputs(path, text))
        .collect();
    out.sort();
    out.dedup();
    out
}

fn prisma_client_outputs(path: &str, text: &str) -> Vec<String> {
    let value = |line: &str, key: &str| -> Option<String> {
        let rest = line.strip_prefix(key)?.trim_start().strip_prefix('=')?;
        let rest = rest.trim().strip_prefix('"')?;
        Some(rest[..rest.find('"')?].to_string())
    };
    let dir = path.rsplit_once('/').map_or("", |(d, _)| d);
    let mut out = Vec::new();
    // The generator block being read: its provider and its output.
    let mut block: Option<(Option<String>, Option<String>)> = None;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("generator ") && t.ends_with('{') {
            block = Some((None, None));
        } else if t.starts_with('}') {
            if let Some((Some(provider), Some(output))) = block.take()
                && matches!(provider.as_str(), "prisma-client-js" | "prisma-client")
            {
                // The output, from the schema's directory, with `.` and `..` read.
                let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
                let mut inside = true;
                for p in output.split('/') {
                    match p {
                        "" | "." => {}
                        ".." => inside &= parts.pop().is_some(),
                        p => parts.push(p),
                    }
                }
                // Not what leaves the repository, and not `node_modules`, which an
                // import names by its package.
                if inside && !parts.is_empty() && !parts.contains(&"node_modules") {
                    out.push(parts.join("/"));
                }
            }
        } else if let Some((provider, output)) = block.as_mut() {
            if let Some(v) = value(t, "provider") {
                *provider = Some(v);
            } else if let Some(v) = value(t, "output") {
                *output = Some(v);
            }
        }
    }
    out
}

/// Prisma schemas and SQL migrations in the repo.
pub fn schema_models(config: &ConfigTexts) -> Vec<Model> {
    let mut models: Vec<Model> = config
        .prisma
        .iter()
        .flat_map(|(p, t)| prisma_models(p, t))
        .collect();
    models.extend(sql_models(&config.sql));
    models
}

/// Workspace package config: scripts, dependencies, compiler flags.
pub fn packages(
    root: &Path,
    resolver: &crate::resolve::ModuleResolver,
    config: &ConfigTexts,
) -> Vec<PackageFacts> {
    let mut out = Vec::new();
    for (rel, text) in &config.package_jsons {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else {
            continue;
        };
        let dir = rel
            .strip_suffix("package.json")
            .unwrap_or("")
            .trim_end_matches('/')
            .to_string();
        let keys = |k: &str| -> Vec<String> {
            json.get(k)
                .and_then(|v| v.as_object())
                .map(|o| o.keys().cloned().collect())
                .unwrap_or_default()
        };
        let mut deps = Vec::new();
        for k in ["dependencies", "devDependencies"] {
            if let Some(o) = json.get(k).and_then(|v| v.as_object()) {
                for (n, v) in o {
                    deps.push(format!("{n}@{}", v.as_str().unwrap_or("?")));
                }
            }
        }
        let mut scripts = keys("scripts");
        scripts.sort();
        deps.sort();
        // Peers `peerDependenciesMeta` marks optional, and optionalDependencies: the
        // package runs without them.
        let optional_peer = |n: &str| {
            json.get("peerDependenciesMeta")
                .and_then(|m| m.get(n))
                .and_then(|m| m.get("optional"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
        };
        let dep =
            |(n, v): (&String, &serde_json::Value)| format!("{n}@{}", v.as_str().unwrap_or("?"));
        let object = |k: &str| {
            json.get(k)
                .and_then(|v| v.as_object())
                .into_iter()
                .flatten()
        };
        let mut peer_dependencies: Vec<String> = object("peerDependencies").map(dep).collect();
        let mut optional_dependencies: Vec<String> = object("peerDependencies")
            .filter(|(n, _)| optional_peer(n))
            .chain(object("optionalDependencies"))
            .map(dep)
            .collect();
        peer_dependencies.sort();
        optional_dependencies.sort();
        optional_dependencies.dedup();
        let tsconfig = root.join(&dir).join("tsconfig.json");
        let mut compiler_flags: Vec<String> =
            resolver.tsconfig_flags(&tsconfig).into_iter().collect();
        compiler_flags.sort();
        let entries = package_entries(root, &dir, &json);
        // Dependencies declared only for development (facts schema 11).
        let names = |k: &str| object(k).map(|(n, _)| n.clone());
        let runtime: BTreeSet<String> = names("dependencies")
            .chain(names("peerDependencies"))
            .chain(names("optionalDependencies"))
            .collect();
        let mut dev_only: Vec<String> = names("devDependencies")
            .filter(|n| !runtime.contains(n))
            .collect();
        dev_only.sort();
        dev_only.dedup();
        out.push(PackageFacts {
            path: dir,
            name: json
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default()
                .to_string(),
            scripts,
            dependencies: deps,
            peer_dependencies,
            optional_dependencies,
            compiler_flags,
            manifest: String::new(),
            entries,
            dev_only,
        });
    }
    out
}

/// Build output directories that mirror `src/` (`dist/index.js` is built from
/// `src/index.ts`).
const BUILD_DIRS: &[&str] = &["dist", "build", "out", "lib", "esm", "cjs"];

/// Source extensions tried for an entry named without one, or by its built name.
const ENTRY_EXTENSIONS: &[&str] = &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

/// Suffixes an entry's built name ends in (declarations first).
const ENTRY_SUFFIXES: &[&str] = &[
    ".d.ts", ".d.mts", ".d.cts", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
];

/// The source files a `package.json` exposes ([`PackageFacts::entries`]).
fn package_entries(root: &Path, dir: &str, json: &serde_json::Value) -> Vec<String> {
    fn strings<'v>(v: &'v serde_json::Value, out: &mut Vec<&'v str>) {
        match v {
            serde_json::Value::String(s) => out.push(s),
            serde_json::Value::Object(o) => {
                for (k, v) in o {
                    if k != "./package.json" {
                        strings(v, out);
                    }
                }
            }
            serde_json::Value::Array(a) => a.iter().for_each(|v| strings(v, out)),
            _ => {}
        }
    }
    let mut named = Vec::new();
    for k in [
        "main", "module", "types", "typings", "source", "bin", "exports",
    ] {
        if let Some(v) = json.get(k) {
            strings(v, &mut named);
        }
    }
    named
        .into_iter()
        .filter_map(|n| entry_file(root, dir, n))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// The source file a manifest path names (`./dist/cli.js` -> `src/cli.ts`), when it
/// exists.
fn entry_file(root: &Path, dir: &str, n: &str) -> Option<String> {
    let join = |rel: &str| {
        if dir.is_empty() {
            rel.to_string()
        } else {
            format!("{dir}/{rel}")
        }
    };
    let is_file = |rel: &str| root.join(rel).is_file();
    let n = n.trim_start_matches("./");
    if n.is_empty() || n.contains('*') || n.contains("..") || n.ends_with(".json") {
        return None;
    }
    let stem = ENTRY_SUFFIXES
        .iter()
        .find_map(|e| n.strip_suffix(*e))
        .unwrap_or(n);
    let mut bases = vec![stem.to_string()];
    if let Some((first, rest)) = stem.split_once('/')
        && BUILD_DIRS.contains(&first)
    {
        bases.push(format!("src/{rest}"));
    }
    bases.iter().find_map(|b| {
        ENTRY_EXTENSIONS
            .iter()
            .map(|e| join(&format!("{b}.{e}")))
            .chain(
                ["index.ts", "index.tsx", "index.js"]
                    .iter()
                    .map(|i| join(&format!("{b}/{i}"))),
            )
            .find(|c| is_file(c))
    })
}

/// Entry point kind of a package `bin` script.
pub const CLI_KIND: &str = "cli";

/// Mark the files a `package.json` `bin` names (mapped back to source as
/// [`PackageFacts::entries`] are) as `cli` entry points: the module itself runs as the
/// command, so the entry symbol is the module ([`crate::lower::MODULE_SYMBOL`]) and the
/// route is the command name (the `bin` key, or the package name for a single path).
pub fn mark_cli_entries(repo: &mut RepoFacts, root: &Path, config: &ConfigTexts) {
    let mut bins: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (rel, text) in &config.package_jsons {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else {
            continue;
        };
        let dir = rel
            .strip_suffix("package.json")
            .unwrap_or("")
            .trim_end_matches('/');
        let name = json
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or_default();
        let commands: Vec<(&str, &str)> = match json.get("bin") {
            Some(serde_json::Value::String(p)) => {
                vec![(name.rsplit('/').next().unwrap_or(name), p.as_str())]
            }
            Some(serde_json::Value::Object(o)) => o
                .iter()
                .filter_map(|(k, v)| Some((k.as_str(), v.as_str()?)))
                .collect(),
            _ => vec![],
        };
        for (cmd, path) in commands {
            if let Some(file) = entry_file(root, dir, path) {
                bins.entry(file).or_default().insert(cmd.to_string());
            }
        }
    }
    for f in &mut repo.files {
        let Some(cmds) = bins.get(&f.path) else {
            continue;
        };
        for cmd in cmds {
            f.entry_points.push(drift_core::EntryPoint {
                symbol: crate::lower::MODULE_SYMBOL.to_string(),
                kind: CLI_KIND.to_string(),
                method: None,
                route: Some(cmd.clone()),
                adapter: "npm".to_string(),
            });
        }
        f.entry_points.sort();
        f.entry_points.dedup();
    }
}

/// Linter configs (ESLint, oxlint, Biome) found in the repo, best-effort, and the
/// JavaScript configs that could not be parsed for lack of stack, as skipped.
pub fn lint_configs(
    config: &ConfigTexts,
) -> (Vec<drift_core::LintConfig>, Vec<drift_core::Skipped>) {
    let mut read = Vec::new();
    let mut unread = Vec::new();
    for (rel, text) in &config.lint {
        match crate::lint::read_config(rel, text) {
            Ok(c) => read.extend(c),
            // A JavaScript config no stack to parse it on could be had for.
            Err(_) => unread.push(drift_core::Skipped {
                path: rel.clone(),
                reason: drift_core::SkipReason::StackUnavailable,
            }),
        }
    }
    (read, unread)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_schema_says_where_its_client_is_generated() {
        let schema = "generator client {\n  provider = \"prisma-client\"\n  output   = \"./generated/prisma\"\n}\n\ngenerator zod {\n  provider = \"zod-prisma-types\"\n  output   = \"./zod\"\n}\n\nmodel A {\n  id Int @id\n}\n";
        assert_eq!(
            prisma_client_outputs("packages/prisma/schema.prisma", schema),
            ["packages/prisma/generated/prisma"]
        );
        // From the schema's directory, upwards too; never out of the repository.
        let up = "generator client {\n  provider = \"prisma-client-js\"\n  output = \"../src/generated/client\"\n}\n";
        assert_eq!(
            prisma_client_outputs("prisma/schema.prisma", up),
            ["src/generated/client"]
        );
        assert!(prisma_client_outputs("schema.prisma", up).is_empty());
        // No output named: the client is the package's, imported by its name.
        let default = "generator client {\n  provider = \"prisma-client-js\"\n}\n";
        assert!(prisma_client_outputs("prisma/schema.prisma", default).is_empty());
    }

    #[test]
    fn prisma_and_sql_models() {
        let p = prisma_models(
            "schema.prisma",
            "model Link {\n  id String @id\n  workspaceId String\n  // note\n  @@index([workspaceId])\n}\nenum X { A }\n",
        );
        assert_eq!(p[0].name, "Link");
        assert_eq!(p[0].fields, ["id", "workspaceId"]);
        let s = sql_models(&[
            ("m/001.sql".into(), "CREATE TABLE IF NOT EXISTS \"links\" (\n  \"id\" uuid PRIMARY KEY,\n  \"workspace_id\" uuid NOT NULL,\n  CONSTRAINT fk FOREIGN KEY (x)\n);\n".into()),
            ("m/002.sql".into(), "ALTER TABLE \"links\" ADD COLUMN \"created_at\" timestamp;\n".into()),
        ]);
        assert_eq!(s[0].name, "links");
        assert_eq!(s[0].fields, ["id", "workspace_id", "created_at"]);
    }

    /// [`exports_name`] as it was before [`ExportsMemo`]: the walk itself.
    fn exports_name_walk(
        reexports: &BTreeMap<String, Reexports>,
        module: &str,
        name: &str,
        depth: usize,
    ) -> bool {
        let Some(r) = reexports.get(module) else {
            return true;
        };
        depth <= MAX_REEXPORT_HOPS
            && (r.names.contains(name)
                || (name != "default"
                    && r.stars
                        .iter()
                        .any(|s| exports_name_walk(reexports, s, name, depth + 1))))
    }

    /// Two `export *` chains longer than the hop bound: `c0 -> .. -> c20`, whose end
    /// exports `x` and which loops back to `c0`, with `c5` exporting `y`; and `d0 -> ..
    /// -> d20`, whose end re-exports a package (exports unknown).
    fn chains() -> BTreeMap<String, Reexports> {
        let mut m = BTreeMap::new();
        for (p, last, end_names) in [("c", "c0", vec!["x"]), ("d", "pkg:x", vec![])] {
            for i in 0..=20 {
                let mut r = Reexports {
                    stars: vec![if i == 20 {
                        last.to_string()
                    } else {
                        format!("{p}{}", i + 1)
                    }],
                    ..Reexports::default()
                };
                if i == 20 {
                    r.names = end_names.iter().map(|n| n.to_string()).collect();
                }
                if p == "c" && i == 5 {
                    r.names.insert("y".into());
                }
                m.insert(format!("{p}{i}"), r);
            }
        }
        m
    }

    /// One memo asked every (module, name, depth), in either order, answers as the
    /// walk does: the depth and the name are both part of what is remembered.
    #[test]
    fn exports_name_memo_answers_as_the_walk() {
        let reexports = chains();
        let mut asks = Vec::new();
        for module in reexports.keys().map(String::as_str).chain(["pkg:x"]) {
            for name in ["x", "y", "z", "default"] {
                for depth in 0..=MAX_REEXPORT_HOPS + 1 {
                    asks.push((module, name, depth));
                }
            }
        }
        let mut differ = 0;
        for order in [false, true] {
            let mut memo = ExportsMemo::default();
            let mut asks = asks.clone();
            if order {
                asks.reverse();
            }
            for (module, name, depth) in asks {
                let want = exports_name_walk(&reexports, module, name, depth);
                assert_eq!(
                    exports_name(&reexports, module, name, depth, &mut memo),
                    want,
                    "{module} {name} at {depth}, reversed: {order}"
                );
                differ += usize::from(want != exports_name_walk(&reexports, module, name, 0));
            }
        }
        // The chains are long enough that the depth changes answers.
        assert!(differ > 0);
        assert!(exports_name(
            &reexports,
            "c10",
            "x",
            0,
            &mut ExportsMemo::default()
        ));
        assert!(!exports_name(
            &reexports,
            "c0",
            "x",
            0,
            &mut ExportsMemo::default()
        ));
    }

    /// [`has_test`] looks for the same candidates as a list of formatted paths would.
    #[test]
    fn has_test_finds_each_candidate() {
        let listed = |path: &str| {
            let (dir, file) = path.rsplit_once('/').unwrap_or(("", path));
            let stem = file.split('.').next().unwrap_or(file);
            let d = if dir.is_empty() {
                String::new()
            } else {
                format!("{dir}/")
            };
            SOURCE_EXTS
                .iter()
                .flat_map(|e| {
                    [
                        format!("{d}{stem}.test.{e}"),
                        format!("{d}{stem}.spec.{e}"),
                        format!("{d}__tests__/{stem}.test.{e}"),
                        format!("{d}__tests__/{stem}.spec.{e}"),
                        format!("{d}__tests__/{stem}.{e}"),
                    ]
                })
                .collect::<Vec<_>>()
        };
        for path in ["src/a.ts", "a.tsx", "src/lib/b.c.ts", "x/__tests__/d.ts"] {
            let candidates = listed(path);
            assert!(!has_test(path, &BTreeSet::new()));
            for c in &candidates {
                let all: BTreeSet<String> = [c.clone(), "src/unrelated.test.ts".into()].into();
                assert_eq!(has_test(path, &all), !is_test_name(path), "{path} with {c}");
            }
            let near: BTreeSet<String> = candidates
                .iter()
                .map(|c| c.replacen('.', "_.", 1))
                .collect();
            assert!(!has_test(path, &near), "{path}");
        }
    }

    fn import(module: &str, names: &[&str]) -> drift_core::Import {
        drift_core::Import {
            module: module.into(),
            names: names.iter().map(|n| n.to_string()).collect(),
            type_only: false,
            load: drift_core::ImportLoad::Static,
        }
    }

    /// A file asks what a barrel forwards before the module behind it is known to be
    /// server-only, and again after: the second answer is not the remembered first.
    /// (`lib/a` imports `x` from `lib/barrel`, which re-exports it from `lib/m`; `lib/m`
    /// becomes server-only in the first pass, through `lib/n`, after `lib/a` asked.)
    /// And the answer for `y`, forwarded from a harmless module, is not the one for `x`.
    #[test]
    fn a_module_entering_origin_renews_what_barrels_forward() {
        let file = |path: &str, directives: &[&str], imports: Vec<drift_core::Import>| FileFacts {
            path: path.into(),
            directives: directives.iter().map(|d| d.to_string()).collect(),
            imports,
            ..FileFacts::default()
        };
        let files = vec![
            file(
                "app/client.tsx",
                &["use client"],
                vec![import("lib/a.ts", &["a"])],
            ),
            file(
                "app/safe.tsx",
                &["use client"],
                vec![import("lib/barrel.ts", &["y"])],
            ),
            file(
                "app/direct.tsx",
                &["use client"],
                vec![import("lib/barrel.ts", &["x"])],
            ),
            file("lib/a.ts", &[], vec![import("lib/barrel.ts", &["x"])]),
            file("lib/barrel.ts", &[], vec![import("lib/m.ts", &["x"])]),
            file("lib/m.ts", &[], vec![import("lib/n.ts", &["n"])]),
            file("lib/n.ts", &[], vec![import("pkg:server-only", &[])]),
            file("lib/safe.ts", &[], vec![]),
        ];
        let mut reexports: BTreeMap<String, Reexports> = files
            .iter()
            .map(|f| (f.path.clone(), Reexports::default()))
            .collect();
        let barrel = reexports.get_mut("lib/barrel.ts").unwrap();
        barrel.only.insert("lib/m.ts".into());
        barrel.names.insert("x".into());
        barrel.only.insert("lib/safe.ts".into());
        barrel.names.insert("y".into());
        barrel
            .named
            .insert("x".into(), ("lib/m.ts".into(), "x".into()));
        barrel
            .named
            .insert("y".into(), ("lib/safe.ts".into(), "y".into()));
        let mut repo = RepoFacts {
            files,
            ..RepoFacts::default()
        };
        client_leaks(&mut repo, &reexports);
        let leaks = |p: &str| {
            repo.files
                .iter()
                .find(|f| f.path == p)
                .map(|f| f.client_leaks.clone())
                .unwrap()
        };
        assert_eq!(leaks("app/client.tsx"), ["lib/n.ts"]);
        assert_eq!(leaks("app/direct.tsx"), ["lib/n.ts"]);
        assert!(leaks("app/safe.tsx").is_empty());
    }

    /// What a barrel forwards is remembered per depth: `r0 -> .. -> r20` each forward
    /// `x` from the next, and `r20` from `lib/n`, so a client importing `x` from `r10`
    /// reaches `lib/n` within the hop bound, and one importing it from `r0` (asked
    /// after, through the same modules at greater depths) does not.
    #[test]
    fn what_barrels_forward_is_remembered_per_depth() {
        let mut files = vec![
            FileFacts {
                path: "app/near.tsx".into(),
                directives: vec!["use client".into()],
                imports: vec![import("lib/r10.ts", &["x"])],
                ..FileFacts::default()
            },
            FileFacts {
                path: "app/far.tsx".into(),
                directives: vec!["use client".into()],
                imports: vec![import("lib/r0.ts", &["x"])],
                ..FileFacts::default()
            },
            FileFacts {
                path: "lib/n.ts".into(),
                imports: vec![import("pkg:server-only", &[])],
                ..FileFacts::default()
            },
        ];
        let mut reexports = BTreeMap::new();
        for i in 0..=20 {
            let path = format!("lib/r{i}.ts");
            let next = if i == 20 {
                "lib/n.ts".to_string()
            } else {
                format!("lib/r{}.ts", i + 1)
            };
            files.push(FileFacts {
                path: path.clone(),
                imports: vec![import(&next, &["x"])],
                ..FileFacts::default()
            });
            let mut r = Reexports::default();
            r.only.insert(next.clone());
            r.names.insert("x".into());
            r.named.insert("x".into(), (next, "x".into()));
            reexports.insert(path, r);
        }
        for f in &files {
            reexports.entry(f.path.clone()).or_default();
        }
        let mut repo = RepoFacts {
            files,
            ..RepoFacts::default()
        };
        client_leaks(&mut repo, &reexports);
        let leaks = |p: &str| {
            repo.files
                .iter()
                .find(|f| f.path == p)
                .map(|f| f.client_leaks.clone())
                .unwrap()
        };
        assert_eq!(leaks("app/near.tsx"), ["lib/n.ts"]);
        assert!(leaks("app/far.tsx").is_empty());
    }
}
