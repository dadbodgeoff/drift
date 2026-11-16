//! Python linter configurations: the restrictions on imports a team wrote down for
//! ruff, flake8-tidy-imports and import-linter, each where it is written, as
//! [`drift_core::LintConfig::declared`] (which mining never reads; the practice map
//! proposes them, `drift_mine::declared`).
//!
//! Read, from the folders that hold the scan's Python files and the folders above them:
//!
//! | File | Setting |
//! | --- | --- |
//! | `pyproject.toml` (`[tool.ruff]`), `ruff.toml`, `.ruff.toml` | `flake8-tidy-imports.banned-api` (rule `TID251`), `ban-relative-imports` (`TID252`) |
//! | `setup.cfg`, `tox.ini`, `.flake8` (`[flake8]`) | `banned-modules` (`I251`), `ban-relative-imports` (`I252`) |
//! | `pyproject.toml` (`[tool.importlinter]`), `.importlinter`, `setup.cfg` (`[importlinter:contract:*]`) | `forbidden`, `layers` and `independence` contracts |
//!
//! A ruff setting counts only when its rule is selected (`select`, `extend-select`,
//! less `ignore`; ruff's default selection has neither), a flake8 one unless its code
//! is ignored (flake8 runs every installed plugin's codes by default). A file-pattern
//! exemption of the code (`per-file-ignores`) leaves files out (`ignores`). A ruff
//! configuration that `extend`s another and selects nothing itself is not read: what it
//! selects is unknown. An import-linter `layers` or `independence` contract is listed
//! as the pairs of modules it forbids, each marked `indirect` (import-linter forbids a
//! chain of imports too), as is a `forbidden` contract unless `allow_indirect_imports`;
//! one with `ignore_imports` is marked `ignores`. Settings of import conventions
//! (`flake8-import-conventions`: how a module is aliased) are not read: Drift has no
//! rule kind for them. Parsing is best-effort and never fails a scan.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use drift_core::ingest::{PyWalked, rel_posix};
use drift_core::{DECLARED_MODULES, DECLARED_RELATIVE, DeclaredLint, LintConfig};

/// The file names read, in the order a folder's are read.
const FILES: &[&str] = &[
    "pyproject.toml",
    "ruff.toml",
    ".ruff.toml",
    "setup.cfg",
    "tox.ini",
    ".flake8",
    ".importlinter",
];

/// Most restrictions listed per configuration file.
const MAX_LISTED: usize = 256;

/// The Python linter configurations of the folders that hold `py`'s files and of the
/// folders above them, below `root`, sorted.
pub fn lint_of(root: &Path, py: &PyWalked) -> Vec<LintConfig> {
    let mut dirs: BTreeSet<PathBuf> = BTreeSet::new();
    let files = py
        .sources
        .iter()
        .map(|c| c.abs_path.clone())
        .chain(py.skipped.iter().map(|s| root.join(&s.path)));
    for f in files {
        let mut cur = f.parent().map(Path::to_path_buf);
        while let Some(d) = cur {
            if !d.starts_with(root) || !dirs.insert(d.clone()) {
                break;
            }
            cur = d.parent().map(Path::to_path_buf);
        }
    }
    let mut out = Vec::new();
    for dir in &dirs {
        let Some(rel) = rel_posix(root, dir) else {
            continue;
        };
        for name in FILES {
            let path = dir.join(name);
            let Some(text) = read_small(&path) else {
                continue;
            };
            let rel = if rel.is_empty() {
                (*name).to_string()
            } else {
                format!("{rel}/{name}")
            };
            out.extend(read_config(&rel, &text));
        }
    }
    out.sort();
    out
}

fn read_small(path: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > drift_core::ingest::MAX_FILE_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// The configurations one file holds (`rel`, repo-relative), one per tool that
/// declares something in it.
pub fn read_config(rel: &str, text: &str) -> Vec<LintConfig> {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let dir = rel.rsplit_once('/').map_or("", |(d, _)| d);
    let lines = Lines::new(text);
    let mut by_tool: BTreeMap<&'static str, Vec<DeclaredLint>> = BTreeMap::new();
    match name {
        "pyproject.toml" | "ruff.toml" | ".ruff.toml" => {
            let Ok(t) = text.parse::<toml::Table>() else {
                return Vec::new();
            };
            let (ruff, prefix) = if name == "pyproject.toml" {
                (
                    at(&t, &["tool", "ruff"]).and_then(|v| v.as_table()),
                    "tool.ruff.",
                )
            } else {
                (Some(&t), "")
            };
            if let Some(ruff) = ruff {
                by_tool.insert("ruff", ruff_settings(ruff, dir, prefix, &lines));
            }
            if name == "pyproject.toml"
                && let Some(il) = at(&t, &["tool", "importlinter"]).and_then(|v| v.as_table())
            {
                by_tool.insert("import-linter", toml_contracts(il, dir, &lines));
            }
        }
        "setup.cfg" | "tox.ini" | ".flake8" | ".importlinter" => {
            let ini = Ini::parse(text);
            if name != ".importlinter" {
                by_tool.insert("flake8", flake8_settings(&ini, dir));
            }
            if name != ".flake8" && name != "tox.ini" {
                by_tool.insert("import-linter", ini_contracts(&ini, dir));
            }
        }
        _ => {}
    }
    by_tool
        .into_iter()
        .filter(|(_, d)| !d.is_empty())
        .map(|(tool, mut declared)| {
            declared.truncate(MAX_LISTED);
            LintConfig {
                path: rel.to_string(),
                tool: tool.to_string(),
                declared,
                ..LintConfig::default()
            }
        })
        .collect()
}

/// Line numbers of a text, to say where a setting is written.
struct Lines<'t> {
    text: &'t str,
}

impl<'t> Lines<'t> {
    fn new(text: &'t str) -> Self {
        Lines { text }
    }

    /// The 1-based line of the first of `needles` found at or after the line `from`,
    /// else `from` (at least 1).
    fn find(&self, needles: &[String], from: u32) -> u32 {
        for (i, l) in self
            .text
            .lines()
            .enumerate()
            .skip(from.saturating_sub(1) as usize)
        {
            if needles.iter().any(|n| l.contains(n.as_str())) {
                return u32::try_from(i + 1).unwrap_or(u32::MAX);
            }
        }
        from.max(1)
    }

    /// The line of the table header `[name]` (or of a `[name.*]` one), else 1.
    fn header(&self, name: &str) -> u32 {
        self.find(&[format!("[{name}]"), format!("[{name}.")], 1)
    }
}

fn at<'a>(t: &'a toml::Table, path: &[&str]) -> Option<&'a toml::Value> {
    let mut cur = t.get(path[0])?;
    for k in &path[1..] {
        cur = cur.as_table()?.get(*k)?;
    }
    Some(cur)
}

fn strings(v: Option<&toml::Value>) -> Vec<String> {
    match v {
        Some(toml::Value::String(s)) => vec![s.clone()],
        Some(toml::Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

/// `code` is selected by `select` (`None`: the tool's default, `default_on`), and
/// `extend_select`, and not ignored: a code is matched by any prefix of it, or `ALL`.
fn selected(
    code: &str,
    select: Option<&[String]>,
    extend_select: &[String],
    ignore: &[String],
    default_on: bool,
) -> bool {
    let hits = |list: &[String]| {
        list.iter()
            .any(|s| s == "ALL" || (!s.is_empty() && code.starts_with(s.as_str())))
    };
    let on = match select {
        Some(s) => hits(s),
        None => default_on,
    } || hits(extend_select);
    on && !hits(ignore)
}

/// Some file pattern of `per_file` (pattern -> codes) exempts `code`.
fn exempted(code: &str, per_file: &[(String, Vec<String>)]) -> bool {
    per_file.iter().any(|(_, codes)| {
        codes
            .iter()
            .any(|c| !c.is_empty() && code.starts_with(c.as_str()))
    })
}

/// ruff's `banned-api` and `ban-relative-imports`, in a `[tool.ruff]` table (or a
/// `ruff.toml`), under `lint.` or, as older ruff reads them, at the top.
fn ruff_settings(ruff: &toml::Table, dir: &str, prefix: &str, lines: &Lines) -> Vec<DeclaredLint> {
    let lint = ruff.get("lint").and_then(|l| l.as_table());
    let pick = |key: &str| lint.and_then(|l| l.get(key)).or_else(|| ruff.get(key));
    let select = pick("select").map(|v| strings(Some(v)));
    if select.is_none() && ruff.get("extend").is_some() {
        // What an extended configuration selects is not read.
        return Vec::new();
    }
    let extend_select: Vec<String> = strings(lint.and_then(|l| l.get("extend-select")))
        .into_iter()
        .chain(strings(ruff.get("extend-select")))
        .collect();
    let ignore: Vec<String> = strings(lint.and_then(|l| l.get("ignore")))
        .into_iter()
        .chain(strings(ruff.get("ignore")))
        .collect();
    let per_file: Vec<(String, Vec<String>)> = ["per-file-ignores", "extend-per-file-ignores"]
        .iter()
        .filter_map(|k| pick(k).and_then(|v| v.as_table()))
        .flat_map(|t| t.iter().map(|(p, c)| (p.clone(), strings(Some(c)))))
        .collect();
    let (tidy, section) = match lint.and_then(|l| l.get("flake8-tidy-imports")) {
        Some(t) => (t.as_table(), format!("{prefix}lint.flake8-tidy-imports")),
        None => (
            ruff.get("flake8-tidy-imports").and_then(|t| t.as_table()),
            format!("{prefix}flake8-tidy-imports"),
        ),
    };
    let Some(tidy) = tidy else {
        return Vec::new();
    };
    let header = lines.header(&section);
    let mut out = Vec::new();
    let on = |code| selected(code, select.as_deref(), &extend_select, &ignore, false);
    if on("TID251")
        && let Some(banned) = tidy.get("banned-api").and_then(|b| b.as_table())
    {
        let limits = if exempted("TID251", &per_file) {
            vec!["ignores".to_string()]
        } else {
            vec![]
        };
        for module in banned.keys() {
            out.push(DeclaredLint {
                dir: dir.to_string(),
                rule: DECLARED_MODULES.to_string(),
                level: "error".into(),
                line: lines.find(&[format!("\"{module}\""), format!("'{module}'")], header),
                sources: vec![],
                options: vec![module.clone()],
                limits: limits.clone(),
            });
        }
    }
    if on("TID252")
        && let Some(v) = tidy.get("ban-relative-imports").and_then(|v| v.as_str())
    {
        out.push(DeclaredLint {
            dir: dir.to_string(),
            rule: DECLARED_RELATIVE.to_string(),
            level: "error".into(),
            line: lines.find(&["ban-relative-imports".to_string()], header),
            sources: vec![],
            options: vec![v.to_string()],
            limits: vec![],
        });
    }
    out
}

/// An INI file (`setup.cfg`, `tox.ini`, `.flake8`, `.importlinter`): each section's
/// keys with their values (continuation lines joined by newlines) and lines.
struct Ini {
    /// section -> key -> (value, 1-based line of the key)
    sections: BTreeMap<String, BTreeMap<String, (String, u32)>>,
    /// section -> 1-based line of its header
    headers: BTreeMap<String, u32>,
}

impl Ini {
    fn parse(text: &str) -> Ini {
        let mut ini = Ini {
            sections: BTreeMap::new(),
            headers: BTreeMap::new(),
        };
        let mut section: Option<String> = None;
        let mut key: Option<String> = None;
        for (i, raw) in text.lines().enumerate() {
            let line_no = u32::try_from(i + 1).unwrap_or(u32::MAX);
            let trimmed = raw.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
                continue;
            }
            if raw.starts_with([' ', '\t']) {
                if let (Some(s), Some(k)) = (&section, &key)
                    && let Some((v, _)) = ini.sections.get_mut(s).and_then(|m| m.get_mut(k))
                {
                    v.push('\n');
                    v.push_str(trimmed);
                }
                continue;
            }
            if let Some(name) = trimmed.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                let name = name.trim().to_string();
                ini.headers.entry(name.clone()).or_insert(line_no);
                ini.sections.entry(name.clone()).or_default();
                section = Some(name);
                key = None;
                continue;
            }
            let Some(s) = &section else { continue };
            let Some(i) = trimmed.find(['=', ':']) else {
                continue;
            };
            let k = trimmed[..i].trim().replace('_', "-");
            let v = trimmed[i + 1..].trim().to_string();
            ini.sections
                .entry(s.clone())
                .or_default()
                .insert(k.clone(), (v, line_no));
            key = Some(k);
        }
        ini
    }

    fn get(&self, section: &str, key: &str) -> Option<&(String, u32)> {
        self.sections.get(section)?.get(key)
    }
}

/// A list value: one item per line or per comma.
fn ini_list(v: &str) -> Vec<String> {
    v.split(['\n', ','])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// flake8-tidy-imports in `[flake8]`: `banned-modules` (`module = message` per line)
/// and `ban-relative-imports`.
fn flake8_settings(ini: &Ini, dir: &str) -> Vec<DeclaredLint> {
    let s = "flake8";
    let list = |k: &str| ini.get(s, k).map(|(v, _)| ini_list(v)).unwrap_or_default();
    let select = ini.get(s, "select").map(|(v, _)| ini_list(v));
    let extend_select = list("extend-select");
    let ignore: Vec<String> = list("ignore")
        .into_iter()
        .chain(list("extend-ignore"))
        .collect();
    let per_file: Vec<(String, Vec<String>)> = ["per-file-ignores", "extend-per-file-ignores"]
        .iter()
        .filter_map(|k| ini.get(s, k))
        .flat_map(|(v, _)| {
            v.split('\n')
                .filter_map(|l| l.split_once(':'))
                .map(|(p, c)| (p.trim().to_string(), ini_list(c)))
                .collect::<Vec<_>>()
        })
        .collect();
    let on = |code| selected(code, select.as_deref(), &extend_select, &ignore, true);
    let mut out = Vec::new();
    if on("I251")
        && let Some((v, line)) = ini.get(s, "banned-modules")
    {
        let limits = if exempted("I251", &per_file) {
            vec!["ignores".to_string()]
        } else {
            vec![]
        };
        for l in v.split('\n') {
            let module = l.split_once('=').map_or(l, |(m, _)| m).trim();
            // `{python2to3}`: a list the plugin keeps, not one written here.
            if module.is_empty() || module.starts_with('{') {
                continue;
            }
            out.push(DeclaredLint {
                dir: dir.to_string(),
                rule: DECLARED_MODULES.to_string(),
                level: "error".into(),
                line: *line,
                sources: vec![],
                options: vec![module.to_string()],
                limits: limits.clone(),
            });
        }
    }
    if on("I252")
        && let Some((v, line)) = ini.get(s, "ban-relative-imports")
        && !matches!(v.to_ascii_lowercase().as_str(), "false" | "0" | "no" | "")
    {
        out.push(DeclaredLint {
            dir: dir.to_string(),
            rule: DECLARED_RELATIVE.to_string(),
            level: "error".into(),
            line: *line,
            sources: vec![],
            options: vec![v.clone()],
            limits: vec![],
        });
    }
    out
}

/// One import-linter contract, as written.
#[derive(Default)]
struct Contract {
    kind: String,
    line: u32,
    sources: Vec<String>,
    forbidden: Vec<String>,
    layers: Vec<String>,
    containers: Vec<String>,
    modules: Vec<String>,
    allow_indirect: bool,
    ignores: bool,
}

/// What a contract forbids, as pairs of (source modules, modules they must not
/// import), each with its limits; a kind Drift does not read gives nothing.
fn contract_rules(c: &Contract, dir: &str) -> Vec<DeclaredLint> {
    let mut limits = Vec::new();
    if c.ignores {
        limits.push("ignores".to_string());
    }
    let mut pairs: Vec<(Vec<String>, Vec<String>)> = Vec::new();
    match c.kind.as_str() {
        "forbidden" => {
            if !c.allow_indirect {
                limits.push("indirect".to_string());
            }
            pairs.push((c.sources.clone(), c.forbidden.clone()));
        }
        "layers" => {
            limits.push("indirect".to_string());
            let containers: Vec<Option<&str>> = if c.containers.is_empty() {
                vec![None]
            } else {
                c.containers.iter().map(|s| Some(s.as_str())).collect()
            };
            for container in containers {
                let full = |m: &str| container.map_or(m.to_string(), |p| format!("{p}.{m}"));
                // Each layer line: siblings split by `|` or `:`, optional ones in parentheses.
                let layers: Vec<Vec<String>> = c
                    .layers
                    .iter()
                    .map(|l| {
                        l.split(['|', ':'])
                            .map(|m| {
                                m.trim()
                                    .trim_start_matches('(')
                                    .trim_end_matches(')')
                                    .trim()
                            })
                            .filter(|m| !m.is_empty())
                            .map(full)
                            .collect()
                    })
                    .collect();
                for (i, lower) in layers.iter().enumerate().skip(1) {
                    let higher: Vec<String> = layers[..i].iter().flatten().cloned().collect();
                    pairs.push((lower.clone(), higher));
                }
            }
        }
        "independence" => {
            limits.push("indirect".to_string());
            for m in &c.modules {
                let others: Vec<String> = c.modules.iter().filter(|o| *o != m).cloned().collect();
                pairs.push((vec![m.clone()], others));
            }
        }
        _ => {}
    }
    pairs
        .into_iter()
        .filter(|(s, f)| !s.is_empty() && !f.is_empty())
        .map(|(sources, options)| DeclaredLint {
            dir: dir.to_string(),
            rule: DECLARED_MODULES.to_string(),
            level: "error".into(),
            line: c.line,
            sources,
            options,
            limits: limits.clone(),
        })
        .collect()
}

fn truthy(v: Option<&toml::Value>) -> bool {
    match v {
        Some(toml::Value::Boolean(b)) => *b,
        Some(toml::Value::String(s)) => s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

/// `[tool.importlinter]`'s `[[tool.importlinter.contracts]]`.
fn toml_contracts(il: &toml::Table, dir: &str, lines: &Lines) -> Vec<DeclaredLint> {
    let Some(contracts) = il.get("contracts").and_then(|c| c.as_array()) else {
        return Vec::new();
    };
    let mut from = 1;
    let mut out = Vec::new();
    for c in contracts.iter().filter_map(|c| c.as_table()) {
        let line = lines.find(&["[[tool.importlinter.contracts]]".to_string()], from);
        from = line + 1;
        let contract = Contract {
            kind: c
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
            line,
            sources: strings(c.get("source_modules")),
            forbidden: strings(c.get("forbidden_modules")),
            layers: strings(c.get("layers")),
            containers: strings(c.get("containers")),
            modules: strings(c.get("modules")),
            allow_indirect: truthy(c.get("allow_indirect_imports")),
            ignores: !strings(c.get("ignore_imports")).is_empty(),
        };
        out.extend(contract_rules(&contract, dir));
    }
    out
}

/// `[importlinter:contract:<id>]` sections of an INI file.
fn ini_contracts(ini: &Ini, dir: &str) -> Vec<DeclaredLint> {
    let mut out = Vec::new();
    for (name, keys) in &ini.sections {
        if !name.starts_with("importlinter:contract:") {
            continue;
        }
        let list = |k: &str| keys.get(k).map(|(v, _)| ini_list(v)).unwrap_or_default();
        // Keys are read with `_` as `-`.
        let contract = Contract {
            kind: keys.get("type").map(|(v, _)| v.clone()).unwrap_or_default(),
            line: ini.headers.get(name).copied().unwrap_or(1),
            sources: list("source-modules"),
            forbidden: list("forbidden-modules"),
            // A layer line is whole: `a | b` stays one line.
            layers: keys
                .get("layers")
                .map(|(v, _)| {
                    v.split('\n')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            containers: list("containers"),
            modules: list("modules"),
            allow_indirect: keys
                .get("allow-indirect-imports")
                .is_some_and(|(v, _)| v.eq_ignore_ascii_case("true")),
            ignores: !list("ignore-imports").is_empty(),
        };
        out.extend(contract_rules(&contract, dir));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `(tool, rule, line, sources, options, limits)` of each listed restriction.
    #[allow(clippy::type_complexity)]
    fn listed(
        rel: &str,
        text: &str,
    ) -> Vec<(String, String, u32, Vec<String>, Vec<String>, Vec<String>)> {
        let mut out = Vec::new();
        for c in read_config(rel, text) {
            assert!(
                c.rules.is_empty() && c.scoped.is_empty(),
                "mining reads none of it"
            );
            for d in c.declared {
                assert_eq!(d.dir, rel.rsplit_once('/').map_or("", |(d, _)| d));
                out.push((
                    c.tool.clone(),
                    d.rule,
                    d.line,
                    d.sources,
                    d.options,
                    d.limits,
                ));
            }
        }
        out
    }

    /// Pins ruff's banned API and relative-import ban in `pyproject.toml`: listed with
    /// their lines when the rule is selected, nothing when it is not, and `ignores` when
    /// some files are exempted.
    #[test]
    fn ruff_banned_api_when_selected() {
        let text = "[project]\nname = \"x\"\n\n[tool.ruff.lint]\nselect = [\"E\", \"TID\"]\n\n[tool.ruff.lint.flake8-tidy-imports]\nban-relative-imports = \"all\"\n\n[tool.ruff.lint.flake8-tidy-imports.banned-api]\n\"app.legacy\".msg = \"Use app.core\"\n\"requests\".msg = \"Use httpx\"\n";
        let l = listed("backend/pyproject.toml", text);
        assert_eq!(l.len(), 3, "{l:?}");
        assert_eq!((l[0].1.as_str(), l[0].2), ("banned-modules", 11));
        assert_eq!(l[0].4, ["app.legacy"]);
        assert_eq!((l[1].2, l[1].4[0].as_str()), (12, "requests"));
        assert_eq!((l[2].1.as_str(), l[2].2), ("ban-relative-imports", 8));
        assert!(l.iter().all(|x| x.0 == "ruff" && x.5.is_empty()));

        let unselected = text.replace("select = [\"E\", \"TID\"]", "select = [\"E\"]");
        assert!(listed("pyproject.toml", &unselected).is_empty());
        let default = text.replace("select = [\"E\", \"TID\"]\n", "");
        assert!(
            listed("pyproject.toml", &default).is_empty(),
            "ruff's default selects no TID"
        );
        let exempt =
            format!("{text}\n[tool.ruff.lint.per-file-ignores]\n\"tests/*\" = [\"TID251\"]\n");
        assert!(
            listed("pyproject.toml", &exempt)[..2]
                .iter()
                .all(|x| x.5 == ["ignores"])
        );
        // `ruff.toml` has the same tables at its top, and older ruff without `lint.`.
        let ruff = "extend-select = [\"TID251\"]\n[flake8-tidy-imports.banned-api]\n\"app.old\".msg = \"no\"\n";
        assert_eq!(listed("ruff.toml", ruff)[0].4, ["app.old"]);
    }

    /// Pins flake8-tidy-imports in `setup.cfg`, `tox.ini` and `.flake8`.
    #[test]
    fn flake8_banned_modules() {
        let text = "[metadata]\nname = x\n\n[flake8]\nmax-line-length = 100\nbanned-modules =\n  app.legacy = use app.core\n  mock = use unittest.mock\n  {python2to3}\n";
        for name in ["setup.cfg", "tox.ini", ".flake8"] {
            let l = listed(name, text);
            assert_eq!(l.len(), 2, "{name}: {l:?}");
            assert_eq!((l[0].0.as_str(), l[0].2), ("flake8", 6));
            assert_eq!(l[0].4, ["app.legacy"]);
            assert_eq!(l[1].4, ["mock"]);
        }
        let ignored = text.replace("max-line-length = 100", "extend-ignore = I25");
        assert!(listed("setup.cfg", &ignored).is_empty());
    }

    /// Pins import-linter's contracts: a `forbidden` one that allows indirect imports
    /// is read whole; one that does not, `layers` and `independence` are listed as the
    /// pairs they forbid, marked `indirect`; `ignore_imports` marks `ignores`.
    #[test]
    fn import_linter_contracts() {
        let text = "[tool.importlinter]\nroot_package = \"app\"\n\n[[tool.importlinter.contracts]]\nname = \"core\"\ntype = \"forbidden\"\nsource_modules = [\"app.core\"]\nforbidden_modules = [\"app.api\", \"app.cli\"]\nallow_indirect_imports = true\n\n[[tool.importlinter.contracts]]\nname = \"layers\"\ntype = \"layers\"\nlayers = [\"app.api\", \"app.services | app.jobs\", \"app.core\"]\nignore_imports = [\"app.core.x -> app.api.y\"]\n";
        let l = listed("pyproject.toml", text);
        assert_eq!(l.len(), 3, "{l:?}");
        assert_eq!(l[0].2, 4);
        assert_eq!(
            (l[0].3.clone(), l[0].4.clone()),
            (
                vec!["app.core".to_string()],
                vec!["app.api".to_string(), "app.cli".to_string()]
            )
        );
        assert!(l[0].5.is_empty());
        assert_eq!(l[1].2, 11);
        assert_eq!(l[1].3, ["app.services", "app.jobs"]);
        assert_eq!(l[1].4, ["app.api"]);
        assert_eq!(l[2].3, ["app.core"]);
        assert_eq!(l[2].5, ["ignores", "indirect"]);

        let ini = "[importlinter]\nroot_package = app\n\n[importlinter:contract:one]\nname = One\ntype = independence\nmodules =\n    app.a\n    app.b\n";
        let l = listed(".importlinter", ini);
        assert_eq!(l.len(), 2, "{l:?}");
        assert_eq!((l[0].0.as_str(), l[0].2), ("import-linter", 4));
        assert_eq!(
            (l[0].3.clone(), l[0].4.clone()),
            (vec!["app.a".to_string()], vec!["app.b".to_string()])
        );
        assert_eq!(l[0].5, ["indirect"]);
    }
}
