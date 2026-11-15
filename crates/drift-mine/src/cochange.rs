//! Co-change rules from git history: "commits that added a key to X also added it to Y".
//!
//! Narrow on purpose: the only change mined is **keys added** (environment variable
//! names) to key files: env schemas (`env.ts`, `env.mjs`, `settings.py`), dotenv
//! templates (`.env.example`) and `turbo.json` (`globalEnv`, task `env`). For each
//! pair of key files X and Y, the qualifying commits are those that added a key to
//! X; the rule "keys added to X are added to Y" is proposed when at least
//! [`MIN_SHARE`] of at least [`MIN_COMMITS`] qualifying commits added every one of
//! those keys to Y as well.
//!
//! History is read by the caller with `git log` over an explicit commit (`HEAD`
//! resolved to its id) and a commit limit ([`WINDOW`]), so the result is a function
//! of that commit. A shallow clone has too little history to say anything: it
//! yields no rules, never a guess. The check compares the files as they are: a key
//! of X that Y does not have is a violation (legacy ones are baselined).
//!
//! Everything here is pure (text in, rules out); running git is the CLI's job.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{KeyFile, SymbolKind};

use crate::check::{WireHint, WireLike};
use crate::mine::{
    Candidate, Evidence, HistoryWindow, Outlier, Rule, WiringEvidence, convention_id,
    wilson_lower_bound,
};
use crate::roles::{RoleSelector, is_test_path};

/// Share of qualifying commits that must also change the other file.
pub const MIN_SHARE: f64 = 0.9;
/// Qualifying commits needed.
pub const MIN_COMMITS: usize = 5;
/// Most commits read (newest first, among those touching a key file).
pub const WINDOW: usize = 500;
/// Most co-change rules proposed.
pub const MAX_RULES: usize = 5;
/// `RoleSelector::file` of a co-change rule's role (its `dir` is the source file).
pub const KEYS_FILE: &str = "(keys)";

/// Pathspecs for `git log`: every file [`key_class`] may accept, and more (the class
/// decides).
pub const PATHSPECS: &[&str] = &[
    // Dotenv templates only: the history of real `.env` files is never read.
    ":(glob)**/.env*example*",
    ":(glob)**/.env*sample*",
    ":(glob)**/.env*template*",
    ":(glob)**/.env*.dist",
    ":(glob)**/.env.defaults",
    ":(glob)**/*.env.example",
    ":(glob)**/turbo.json",
    ":(glob)**/*env*.ts",
    ":(glob)**/*env*.mts",
    ":(glob)**/*env*.js",
    ":(glob)**/*env*.mjs",
    ":(glob)**/*env*.cjs",
    ":(glob)**/env/*.ts",
    ":(glob)**/settings.py",
    ":(glob)**/settings/*.py",
    ":(glob)**/config.py",
    ":(glob)**/env.py",
];

/// What kind of key file a path is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum KeyClass {
    /// `.env.example`, `.env.sample`, `apps/api/.env.development`.
    Dotenv,
    /// `turbo.json`.
    Turbo,
    /// A TypeScript/JavaScript env schema (`env.ts`, `env.server.mjs`, `env/index.ts`).
    ScriptEnv,
    /// Python settings (`settings.py`, `settings/base.py`, `config.py`, `env.py`).
    PythonSettings,
}

/// The key class of a repo-relative path, if it is a key file.
pub fn key_class(path: &str) -> Option<KeyClass> {
    if is_test_path(path) || path.split('/').any(|s| s == "node_modules") {
        return None;
    }
    let mut parts = path.rsplit('/');
    let name = parts.next().unwrap_or(path);
    let parent = parts.next().unwrap_or("");
    if name == "turbo.json" {
        return Some(KeyClass::Turbo);
    }
    // Dotenv templates only (`.env.example`, `.env.local.sample`, `prod.env.example`):
    // a real `.env` holds secrets, so neither it nor its history is read.
    let dotenv = (name.starts_with(".env") && name != ".envrc" && !script_ext(name))
        || name.contains(".env.");
    let template = ["example", "sample", "template"]
        .iter()
        .any(|t| name.contains(t))
        || name.ends_with(".dist")
        || name == ".env.defaults";
    if dotenv && template && !name.ends_with(".py") && !name.ends_with(".json") {
        return Some(KeyClass::Dotenv);
    }
    if script_ext(name) && !name.ends_with(".d.ts") {
        let stem = name.split('.').next().unwrap_or(name);
        let env_stem = stem == "env"
            || stem.ends_with("-env")
            || stem.ends_with("_env")
            || stem.starts_with("env-")
            || stem.starts_with("env_");
        // `env.server.ts`, `server-env.mjs`, `env/index.ts`.
        if env_stem || (parent == "env" && stem == "index") {
            return Some(KeyClass::ScriptEnv);
        }
    }
    if name.ends_with(".py")
        && (matches!(name, "settings.py" | "config.py" | "env.py") || parent == "settings")
    {
        return Some(KeyClass::PythonSettings);
    }
    None
}

fn script_ext(name: &str) -> bool {
    [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]
        .iter()
        .any(|e| name.ends_with(e))
}

/// An environment variable name: upper case, digits and underscores, at least one
/// underscore (`DATABASE_URL`, `NEXT_PUBLIC_APP_URL`).
fn env_like(s: &str) -> bool {
    s.len() >= 3
        && s.starts_with(|c: char| c.is_ascii_uppercase())
        && s.contains('_')
        && !s.ends_with('_')
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// Identifiers in a line with their byte offsets.
fn idents(line: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_alphabetic() || b[i] == b'_' || b[i] == b'$' {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'$') {
                i += 1;
            }
            out.push((start, &line[start..i]));
        } else {
            i += 1;
        }
    }
    out
}

/// Keys a line of a key file declares or mentions.
pub fn keys_in_line(class: KeyClass, line: &str) -> Vec<String> {
    let t = line.trim_start();
    match class {
        KeyClass::Dotenv => {
            // `KEY=`, `export KEY=`, and documented-but-unset `# KEY=`.
            let t = t.trim_start_matches('#').trim_start();
            let t = t.strip_prefix("export ").unwrap_or(t).trim_start();
            match t.split_once('=') {
                Some((k, _))
                    if !k.trim().is_empty()
                        && k.trim()
                            .chars()
                            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
                        && k.trim().starts_with(|c: char| c.is_ascii_uppercase()) =>
                {
                    vec![k.trim().to_string()]
                }
                _ => vec![],
            }
        }
        KeyClass::Turbo => {
            // Quoted env names, also the old `"$KEY"` form; wildcards are patterns.
            let mut out = Vec::new();
            for part in line.split('"').skip(1).step_by(2) {
                let k = part.strip_prefix('$').unwrap_or(part);
                if env_like(k) {
                    out.push(k.to_string());
                }
            }
            out
        }
        KeyClass::ScriptEnv => {
            // Object keys (`KEY: z.string()`) and reads (`process.env.KEY`, `env.KEY`).
            let mut out = Vec::new();
            for (at, id) in idents(line) {
                if !env_like(id) {
                    continue;
                }
                let after = line[at + id.len()..].trim_start();
                let before = &line[..at];
                let key = after.starts_with(':')
                    || after.starts_with("?:")
                    || before.ends_with("env.")
                    || before.ends_with("env?.")
                    || ((before.ends_with('"') || before.ends_with('\''))
                        && (after.starts_with("\":")
                            || after.starts_with("':")
                            || before.contains("env")));
                if key {
                    out.push(id.to_string());
                }
            }
            out
        }
        KeyClass::PythonSettings => {
            // Quoted names read from the environment: `os.environ["KEY"]`,
            // `os.getenv("KEY")`, `env("KEY")`, `env.str("KEY")`.
            if !line.contains("env") && !line.contains("ENV") {
                return vec![];
            }
            let mut out = Vec::new();
            for q in ['"', '\''] {
                for part in line.split(q).skip(1).step_by(2) {
                    if env_like(part) {
                        out.push(part.to_string());
                    }
                }
            }
            out
        }
    }
}

/// Keys of a whole file, with the line of their first mention, sorted by key.
pub fn keys_in_text(class: KeyClass, text: &str) -> Vec<(String, u32)> {
    let mut out: BTreeMap<String, u32> = BTreeMap::new();
    for (i, line) in text.lines().enumerate() {
        for k in keys_in_line(class, line) {
            out.entry(k)
                .or_insert(u32::try_from(i + 1).unwrap_or(u32::MAX));
        }
    }
    out.into_iter().collect()
}

/// [`KeyFile`] for a file's text, when its path is a key file.
pub fn key_file(path: &str, text: &str) -> Option<KeyFile> {
    let class = key_class(path)?;
    Some(KeyFile {
        path: path.to_string(),
        keys: keys_in_text(class, text),
    })
}

/// The keys one commit added to each key file it touched.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommitDelta {
    pub id: String,
    /// Path -> keys added (in `+` lines and not in `-` lines of the same file).
    pub added: BTreeMap<String, BTreeSet<String>>,
}

/// History read for co-change mining.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct History {
    /// The commit the window ends at.
    pub head: String,
    /// Newest first.
    pub commits: Vec<CommitDelta>,
}

/// Why there are no co-change rules, or that history was read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryStatus {
    Read,
    /// `git rev-parse --is-shallow-repository` says true.
    Shallow,
    /// A partial clone (`extensions.partialClone`): old blobs are missing.
    Partial,
    /// No git, not a work tree, or no commits.
    NoGit,
    /// `git log` failed (a partial clone with blobs missing, a broken repository).
    Failed,
    /// `git log` ran past its time limit and was stopped.
    Timeout,
    /// `git log` printed more than its output cap.
    TooLarge,
}

impl HistoryStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            HistoryStatus::Read => "read",
            HistoryStatus::Shallow => "shallow",
            HistoryStatus::Partial => "partial_clone",
            HistoryStatus::NoGit => "no_git",
            HistoryStatus::Failed => "failed",
            HistoryStatus::Timeout => "timeout",
            HistoryStatus::TooLarge => "too_large",
        }
    }
}

/// Parse `git log --format=%x00%H -p --unified=0 --no-renames` output.
pub fn parse_log(out: &[u8]) -> Vec<CommitDelta> {
    let text = String::from_utf8_lossy(out);
    let mut commits: Vec<CommitDelta> = Vec::new();
    // (path, class, added keys, removed keys) of the file being read.
    let mut cur: Option<(String, KeyClass, BTreeSet<String>, BTreeSet<String>)> = None;
    let flush =
        |commits: &mut Vec<CommitDelta>,
         cur: &mut Option<(String, KeyClass, BTreeSet<String>, BTreeSet<String>)>| {
            if let (Some((path, _, add, del)), Some(c)) = (cur.take(), commits.last_mut()) {
                let added: BTreeSet<String> = add.difference(&del).cloned().collect();
                if !added.is_empty() {
                    c.added.entry(path).or_default().extend(added);
                }
            }
        };
    for line in text.split('\n') {
        if let Some(id) = line.strip_prefix('\0') {
            flush(&mut commits, &mut cur);
            commits.push(CommitDelta {
                id: id.trim().to_string(),
                added: BTreeMap::new(),
            });
            continue;
        }
        if let Some(rest) = line.strip_prefix("diff --git ") {
            flush(&mut commits, &mut cur);
            // `a/<path> b/<path>` (no renames, so both sides are the same path).
            let path = rest
                .rsplit_once(" b/")
                .map(|(_, p)| p.to_string())
                .unwrap_or_default();
            cur = key_class(&path).map(|c| (path, c, BTreeSet::new(), BTreeSet::new()));
            continue;
        }
        let Some((_, class, add, del)) = cur.as_mut() else {
            continue;
        };
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if let Some(l) = line.strip_prefix('+') {
            add.extend(keys_in_line(*class, l));
        } else if let Some(l) = line.strip_prefix('-') {
            del.extend(keys_in_line(*class, l));
        }
    }
    flush(&mut commits, &mut cur);
    commits
}

/// The role of a co-change rule: the keys of one file.
pub fn keys_role(path: &str) -> RoleSelector {
    RoleSelector {
        package: String::new(),
        dir: path.to_string(),
        file: KEYS_FILE.to_string(),
        entry: "-".to_string(),
        kind: SymbolKind::Module,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    }
}

/// Mine co-change rules from `history`; `key_files` are the key files as they are
/// now (rules are proposed only between files that still exist), and give the
/// keys missing today as outliers.
pub fn mine(history: &History, key_files: &[KeyFile], max: usize) -> Vec<Candidate> {
    let now: BTreeMap<&str, &KeyFile> = key_files.iter().map(|k| (k.path.as_str(), k)).collect();
    let mut files: BTreeSet<&str> = BTreeSet::new();
    for c in &history.commits {
        files.extend(c.added.keys().map(String::as_str));
    }
    let mut found: Vec<(f64, Candidate)> = Vec::new();
    for &x in &files {
        let Some(src) = now.get(x) else { continue };
        let qualifying: Vec<&CommitDelta> = history
            .commits
            .iter()
            .filter(|c| c.added.contains_key(x))
            .collect();
        if qualifying.len() < MIN_COMMITS {
            continue;
        }
        for &y in &files {
            if x == y {
                continue;
            }
            let Some(dst) = now.get(y) else { continue };
            let hits = qualifying
                .iter()
                .filter(|c| {
                    let to = c.added.get(y);
                    c.added[x].iter().all(|k| to.is_some_and(|t| t.contains(k)))
                })
                .count();
            let n = qualifying.len();
            if (hits as f64) < MIN_SHARE * n as f64 {
                continue;
            }
            let have: BTreeMap<&str, u32> =
                dst.keys.iter().map(|(k, l)| (k.as_str(), *l)).collect();
            let outliers: Vec<Outlier> = src
                .keys
                .iter()
                .filter(|(k, _)| !have.contains_key(k.as_str()))
                .map(|(k, l)| Outlier {
                    path: x.to_string(),
                    symbol: k.clone(),
                    line: *l,
                })
                .collect();
            let like = src.keys.iter().find_map(|(k, _)| {
                have.get(k.as_str()).map(|l| WireLike {
                    name: k.clone(),
                    line: *l,
                    path: y.to_string(),
                })
            });
            let role = keys_role(x);
            let rule = Rule::MirrorsKeys {
                from: x.to_string(),
                to: y.to_string(),
            };
            let lb = wilson_lower_bound(hits, n);
            let score = lb * (1.0 + n as f64).log2();
            found.push((
                score,
                Candidate {
                    id: convention_id(&role, &rule),
                    example: like
                        .as_ref()
                        .map_or_else(|| y.to_string(), |l| format!("{y}#{}", l.name)),
                    role,
                    rule,
                    evidence: Evidence {
                        holders: hits,
                        total: n,
                        lower_bound: (lb * 1000.0).round() / 1000.0,
                        lift: 1.0,
                        split: vec![],
                        role_members: None,
                        // Wiring rules are suggestions by kind; the example gives the language.
                        python_members: None,
                    },
                    score: (score * 1000.0).round() / 1000.0,
                    outliers,
                    can_block: false,
                    exempt: vec![],
                    inherited: vec![],
                    derived: vec![],
                    wiring: Some(WiringEvidence {
                        registry: WireHint {
                            action: "mirror".into(),
                            path: y.to_string(),
                            line: dst.keys.iter().map(|(_, l)| *l).min().unwrap_or(1),
                            label: "keys".into(),
                            like,
                            entry: None,
                        },
                        lists: 0,
                        history: Some(HistoryWindow {
                            head: history.head.clone(),
                            commits: history.commits.len(),
                            max: WINDOW,
                        }),
                    }),
                },
            ));
        }
    }
    found.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    found.truncate(max);
    found.into_iter().map(|(_, c)| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classes() {
        assert_eq!(key_class(".env.example"), Some(KeyClass::Dotenv));
        assert_eq!(
            key_class("apps/web/.env.local.example"),
            Some(KeyClass::Dotenv)
        );
        assert_eq!(key_class("deploy/prod.env.example"), Some(KeyClass::Dotenv));
        assert_eq!(key_class(".env.sample"), Some(KeyClass::Dotenv));
        // Real env files hold secrets: never read.
        assert_eq!(key_class(".env"), None);
        assert_eq!(key_class(".env.local"), None);
        assert_eq!(key_class(".env.production"), None);
        assert_eq!(key_class("deploy/prod.env"), None);
        assert_eq!(key_class(".envrc"), None);
        assert_eq!(key_class("turbo.json"), Some(KeyClass::Turbo));
        assert_eq!(key_class("apps/web/env.ts"), Some(KeyClass::ScriptEnv));
        assert_eq!(key_class("src/env.server.mjs"), Some(KeyClass::ScriptEnv));
        assert_eq!(key_class("lib/server-env.ts"), Some(KeyClass::ScriptEnv));
        assert_eq!(key_class("src/env/index.ts"), Some(KeyClass::ScriptEnv));
        assert_eq!(key_class("src/environment.ts"), None);
        assert_eq!(key_class("src/envelope.ts"), None);
        assert_eq!(
            key_class("proj/settings.py"),
            Some(KeyClass::PythonSettings)
        );
        assert_eq!(
            key_class("proj/settings/base.py"),
            Some(KeyClass::PythonSettings)
        );
        assert_eq!(key_class("tests/env.ts"), None);
    }

    #[test]
    fn keys_by_class() {
        assert_eq!(
            keys_in_line(KeyClass::Dotenv, "DATABASE_URL=postgres://"),
            ["DATABASE_URL"]
        );
        assert_eq!(
            keys_in_line(KeyClass::Dotenv, "# SENTRY_DSN="),
            ["SENTRY_DSN"]
        );
        assert_eq!(keys_in_line(KeyClass::Dotenv, "export PORT=3000"), ["PORT"]);
        assert!(keys_in_line(KeyClass::Dotenv, "# Set this to the URL").is_empty());
        assert_eq!(
            keys_in_line(
                KeyClass::Turbo,
                r#"  "globalEnv": ["DATABASE_URL", "$NEXT_PUBLIC_X", "NEXT_PUBLIC_*"],"#
            ),
            ["DATABASE_URL", "NEXT_PUBLIC_X"]
        );
        assert!(
            keys_in_line(KeyClass::Turbo, r#"  "build": { "dependsOn": ["^build"] }"#).is_empty()
        );
        assert_eq!(
            keys_in_line(KeyClass::ScriptEnv, "    STRIPE_KEY: z.string(),"),
            ["STRIPE_KEY"]
        );
        assert_eq!(
            keys_in_line(KeyClass::ScriptEnv, "  STRIPE_KEY: process.env.STRIPE_KEY,"),
            ["STRIPE_KEY", "STRIPE_KEY"]
        );
        assert!(keys_in_line(KeyClass::ScriptEnv, "const MAX_RETRIES = 3;").is_empty());
        assert_eq!(
            keys_in_line(
                KeyClass::PythonSettings,
                r#"SECRET_KEY = os.environ.get("DJANGO_SECRET")"#
            ),
            ["DJANGO_SECRET"]
        );
        assert!(keys_in_line(KeyClass::PythonSettings, r#"LANGUAGE_CODE = "EN_US""#).is_empty());
    }

    /// (path, added lines, removed lines) of one file in a commit.
    type FileChange<'a> = (&'a str, &'a [&'a str], &'a [&'a str]);

    fn log(commits: &[(&str, &[FileChange])]) -> Vec<u8> {
        let mut out = String::new();
        for (id, files) in commits {
            out.push_str(&format!("\0{id}\n\n"));
            for (path, add, del) in *files {
                out.push_str(&format!(
                    "diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -1 +1 @@\n"
                ));
                for d in *del {
                    out.push_str(&format!("-{d}\n"));
                }
                for a in *add {
                    out.push_str(&format!("+{a}\n"));
                }
            }
        }
        out.into_bytes()
    }

    #[test]
    fn parses_added_keys_net_of_removed() {
        let out = log(&[(
            "c1",
            &[
                (".env.example", &["A_KEY=1", "B_KEY=2"], &["B_KEY=old"]),
                ("src/app.ts", &["X_KEY: 1"], &[]),
            ],
        )]);
        let c = parse_log(&out);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].id, "c1");
        assert_eq!(
            c[0].added
                .get(".env.example")
                .map(|s| s.iter().cloned().collect::<Vec<_>>()),
            Some(vec!["A_KEY".to_string()])
        );
        assert!(!c[0].added.contains_key("src/app.ts"), "not a key file");
    }

    fn kf(path: &str, keys: &[&str]) -> KeyFile {
        KeyFile {
            path: path.into(),
            keys: keys
                .iter()
                .enumerate()
                .map(|(i, k)| (k.to_string(), u32::try_from(i + 1).unwrap()))
                .collect(),
        }
    }

    fn history(n_mirrored: usize, n_alone: usize) -> History {
        let mut commits = Vec::new();
        for i in 0..n_mirrored {
            let k = format!("KEY_{i}");
            commits.push(CommitDelta {
                id: format!("m{i}"),
                added: [
                    ("env.ts".to_string(), [k.clone()].into()),
                    (".env.example".to_string(), [k].into()),
                ]
                .into(),
            });
        }
        for i in 0..n_alone {
            commits.push(CommitDelta {
                id: format!("a{i}"),
                added: [("env.ts".to_string(), [format!("SOLO_{i}")].into())].into(),
            });
        }
        History {
            head: "abc".into(),
            commits,
        }
    }

    #[test]
    fn mines_mirrored_keys_above_the_bar_only() {
        let now = [
            kf("env.ts", &["KEY_0", "NEW_KEY"]),
            kf(".env.example", &["KEY_0"]),
        ];
        let c = mine(&history(9, 1), &now, 5);
        let rules: Vec<_> = c.iter().map(|c| &c.rule).collect();
        assert!(rules.contains(&&Rule::MirrorsKeys {
            from: "env.ts".into(),
            to: ".env.example".into()
        }));
        let r = c.iter().find(|c| c.role.dir == "env.ts").unwrap();
        assert_eq!((r.evidence.holders, r.evidence.total), (9, 10));
        assert_eq!(r.outliers.len(), 1);
        assert_eq!(r.outliers[0].symbol, "NEW_KEY");
        // 8 of 10 is under 90%.
        assert!(
            mine(&history(8, 2), &now, 5)
                .iter()
                .all(|c| c.role.dir != "env.ts")
        );
        // Too few commits.
        assert!(
            mine(&history(4, 0), &now, 5)
                .iter()
                .all(|c| c.role.dir != "env.ts")
        );
        // A file that no longer exists gets no rule.
        assert!(mine(&history(9, 1), &now[..1], 5).is_empty());
    }
}
