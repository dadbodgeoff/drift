//! Linter configs: which of the rules Drift relates to its own conventions a
//! repo's ESLint, oxlint or Biome config sets, and how.
//!
//! Drift only reads the settings that bear on conventions it could propose:
//!
//! | Tool-neutral name | ESLint / oxlint | Biome |
//! | --- | --- | --- |
//! | `no-explicit-any` | `@typescript-eslint/no-explicit-any`, `typescript/no-explicit-any` | `noExplicitAny` |
//! | `explicit-function-return-type` | `@typescript-eslint/explicit-function-return-type`, `typescript/explicit-function-return-type` | |
//! | `no-console` | `no-console` | `noConsole` |
//! | `no-console-log` | | `noConsoleLog` (`console.log` only) |
//! | `no-process-env` | `n/no-process-env`, `node/no-process-env` | `noProcessEnv` |
//! | `rules-of-hooks` | `react-hooks/rules-of-hooks`, `react/rules-of-hooks` | `useHookAtTopLevel` |
//! | `no-restricted-imports` | `no-restricted-imports`, `import/no-restricted-paths` | `noRestrictedImports` |
//!
//! Parsing is best-effort and never fails a scan: JSON configs (with comments and
//! trailing commas) are read as data; JavaScript and TypeScript flat configs are
//! parsed with oxc and read syntactically (no code runs). Only settings that apply
//! to every file a config covers count: blocks scoped by `files` or `overrides`
//! are left out. The exception is `no-restricted-imports` in the `overrides` entries
//! of JSON configs that name directories (`LintConfig::scoped`): a restriction on one
//! part of the repo states which way a layer edge goes. Well-known presets that
//! enable a rule (`typescript-eslint`'s `recommended`, `plugin:react-hooks/recommended`, `next/core-web-vitals`, Biome's
//! recommended set) count as setting it to `error`; an explicit setting wins.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{LintConfig, LintRule, ScopedLintRules};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// Most option strings kept per rule.
const MAX_OPTIONS: usize = 64;
/// Most `overrides` entries read per config, and most file globs per entry: an entry
/// with more globs is left out (the dev repos use at most 7 entries of a few globs).
const MAX_SCOPED_ENTRIES: usize = 64;
const MAX_SCOPED_GLOBS: usize = 64;

/// ESLint and oxlint rule names (with their plugin prefixes) -> tool-neutral name.
const ESLINT_RULES: &[(&str, &str)] = &[
    ("@typescript-eslint/no-explicit-any", "no-explicit-any"),
    ("typescript-eslint/no-explicit-any", "no-explicit-any"),
    ("typescript/no-explicit-any", "no-explicit-any"),
    ("ts/no-explicit-any", "no-explicit-any"),
    (
        "@typescript-eslint/explicit-function-return-type",
        "explicit-function-return-type",
    ),
    (
        "typescript-eslint/explicit-function-return-type",
        "explicit-function-return-type",
    ),
    (
        "typescript/explicit-function-return-type",
        "explicit-function-return-type",
    ),
    (
        "ts/explicit-function-return-type",
        "explicit-function-return-type",
    ),
    ("no-console", "no-console"),
    ("eslint/no-console", "no-console"),
    ("n/no-process-env", "no-process-env"),
    ("node/no-process-env", "no-process-env"),
    ("no-process-env", "no-process-env"),
    ("react-hooks/rules-of-hooks", "rules-of-hooks"),
    ("react/rules-of-hooks", "rules-of-hooks"),
    ("no-restricted-imports", "no-restricted-imports"),
    ("eslint/no-restricted-imports", "no-restricted-imports"),
    (
        "@typescript-eslint/no-restricted-imports",
        "no-restricted-imports",
    ),
    ("typescript/no-restricted-imports", "no-restricted-imports"),
    ("import/no-restricted-paths", "no-restricted-imports"),
    ("import-x/no-restricted-paths", "no-restricted-imports"),
];

/// Biome rule names -> (group, tool-neutral name).
const BIOME_RULES: &[(&str, &str, &str)] = &[
    ("noExplicitAny", "suspicious", "no-explicit-any"),
    ("noConsole", "suspicious", "no-console"),
    // `noConsoleLog` flags `console.log` only, so it does not cover `console.*`.
    ("noConsoleLog", "suspicious", "no-console-log"),
    ("noProcessEnv", "style", "no-process-env"),
    ("useHookAtTopLevel", "correctness", "rules-of-hooks"),
    ("noRestrictedImports", "style", "no-restricted-imports"),
];

/// Rules in Biome's recommended set (on unless `recommended: false`).
const BIOME_RECOMMENDED: &[&str] = &["no-explicit-any"];

/// Preset names (in `extends`, or as strings in a flat config, e.g. via `FlatCompat`)
/// and the rules they set to `error`.
const STRING_PRESETS: &[(&str, &[&str])] = &[
    (
        "plugin:@typescript-eslint/recommended",
        &["no-explicit-any"],
    ),
    ("plugin:@typescript-eslint/strict", &["no-explicit-any"]),
    ("plugin:@typescript-eslint/all", &["no-explicit-any"]),
    (
        "plugin:@typescript-eslint/recommended-type-checked",
        &["no-explicit-any"],
    ),
    (
        "plugin:@typescript-eslint/strict-type-checked",
        &["no-explicit-any"],
    ),
    ("next/typescript", &["no-explicit-any"]),
    ("plugin:react-hooks/recommended", &["rules-of-hooks"]),
    ("plugin:react-hooks/recommended-legacy", &["rules-of-hooks"]),
    ("next", &["rules-of-hooks"]),
    ("next/core-web-vitals", &["rules-of-hooks"]),
    ("react-app", &["rules-of-hooks"]),
];

/// `<binding>.configs.<name>` presets of plugin packages, and the rules they set.
const MEMBER_PRESETS: &[(&str, &[&str], &[&str])] = &[
    (
        "typescript-eslint",
        &[
            "recommended",
            "strict",
            "all",
            "recommendedTypeChecked",
            "strictTypeChecked",
        ],
        &["no-explicit-any"],
    ),
    (
        "@typescript-eslint/eslint-plugin",
        &[
            "recommended",
            "strict",
            "all",
            "recommended-type-checked",
            "strict-type-checked",
        ],
        &["no-explicit-any"],
    ),
    (
        "eslint-plugin-react-hooks",
        &["recommended", "recommended-latest", "flat"],
        &["rules-of-hooks"],
    ),
];

/// Shareable configs imported as modules (`import next from "eslint-config-next"`).
const MODULE_PRESETS: &[(&str, &[&str])] = &[
    ("eslint-config-next", &["rules-of-hooks"]),
    ("eslint-config-next/core-web-vitals", &["rules-of-hooks"]),
    (
        "eslint-config-next/typescript",
        &["no-explicit-any", "rules-of-hooks"],
    ),
];

/// File names Drift reads as linter configs, and their tool.
pub fn config_tool(rel: &str) -> Option<&'static str> {
    let file = rel.rsplit('/').next().unwrap_or(rel);
    match file {
        ".oxlintrc.json" | "oxlintrc.json" => Some("oxlint"),
        "biome.json" | "biome.jsonc" => Some("biome"),
        ".eslintrc" | ".eslintrc.json" | ".eslintrc.js" | ".eslintrc.cjs" => Some("eslint"),
        "package.json" => Some("eslint"),
        _ if file.starts_with("eslint.config.")
            && matches!(
                file.rsplit('.').next(),
                Some("js" | "mjs" | "cjs" | "ts" | "mts" | "cts")
            ) =>
        {
            Some("eslint")
        }
        _ => None,
    }
}

/// Read one config file. `None` when it is not a linter config at all (a
/// `package.json` without `eslintConfig`); a config Drift cannot parse gives an
/// entry with no rules. `Err` for a JavaScript config no stack to parse it on could
/// be had for: what it sets is unknown.
pub fn read_config(
    rel: &str,
    text: &str,
) -> Result<Option<LintConfig>, drift_core::stack::Unavailable> {
    let Some(tool) = config_tool(rel) else {
        return Ok(None);
    };
    let file = rel.rsplit('/').next().unwrap_or(rel);
    let mut cfg = LintConfig {
        path: rel.to_string(),
        tool: tool.to_string(),
        ..Default::default()
    };
    let mut rules = Rules::default();
    let is_js = file.ends_with("js") || file.ends_with("ts");
    if is_js {
        let inherits = &mut cfg.inherits;
        let rules = &mut rules;
        drift_core::stack::with_stack_for(text.len(), || js_config(rel, text, rules, inherits))?;
    } else {
        let json = parse_jsonc(text);
        if let Some(v) = &json {
            let v = if file == "package.json" {
                v.get("eslintConfig")
            } else {
                Some(v)
            };
            if let Some(v) = v {
                cfg.scoped = scoped_overrides(rel, tool, v);
            }
        }
        match (file, json) {
            ("package.json", Some(v)) => {
                let Some(e) = v.get("eslintConfig") else {
                    return Ok(None);
                };
                eslint_json(e, &mut rules, &mut cfg.inherits);
            }
            ("package.json", None) => return Ok(None),
            (_, None) => {}
            (_, Some(v)) if tool == "biome" => biome_json(&v, &mut rules, &mut cfg.inherits),
            (_, Some(v)) if tool == "oxlint" => {
                if v.get("extends").is_some() {
                    cfg.inherits = true;
                }
                if let Some(r) = v.get("rules").and_then(|r| r.as_object()) {
                    for (k, val) in r {
                        rules.explicit_json(k, val);
                    }
                }
            }
            (_, Some(v)) => eslint_json(&v, &mut rules, &mut cfg.inherits),
        }
    }
    cfg.rules = rules.finish();
    Ok(Some(cfg))
}

#[derive(Default)]
struct Rules {
    /// Explicit settings, last one wins.
    explicit: BTreeMap<&'static str, (String, BTreeSet<String>)>,
    /// Rules a preset sets to `error`.
    presets: BTreeSet<&'static str>,
}

impl Rules {
    fn set(&mut self, rule: &'static str, level: String, options: BTreeSet<String>) {
        self.explicit.insert(rule, (level, options));
    }

    fn explicit_json(&mut self, name: &str, value: &serde_json::Value) {
        let Some(rule) = eslint_rule(name) else {
            return;
        };
        let (level, opts) = match value {
            serde_json::Value::Array(a) => (a.first().and_then(json_level), &a[a.len().min(1)..]),
            v => (json_level(v), &[][..]),
        };
        if let Some(level) = level {
            let mut options = BTreeSet::new();
            for o in opts {
                json_strings(o, &mut options);
            }
            self.set(rule, level, options);
        }
    }

    fn preset(&mut self, rules: &[&'static str]) {
        self.presets.extend(rules.iter().copied());
    }

    fn finish(self) -> Vec<LintRule> {
        let mut out: BTreeMap<&str, LintRule> = BTreeMap::new();
        for r in self.presets {
            out.insert(
                r,
                LintRule {
                    rule: r.to_string(),
                    level: "error".into(),
                    options: vec![],
                },
            );
        }
        for (r, (level, options)) in self.explicit {
            out.insert(
                r,
                LintRule {
                    rule: r.to_string(),
                    level,
                    options: options.into_iter().take(MAX_OPTIONS).collect(),
                },
            );
        }
        out.into_values().collect()
    }
}

fn eslint_rule(name: &str) -> Option<&'static str> {
    ESLINT_RULES
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, r)| *r)
}

fn level_word(s: &str) -> Option<String> {
    match s {
        "off" | "0" | "none" => Some("off".into()),
        "warn" | "1" | "warning" | "info" => Some("warn".into()),
        "error" | "2" | "on" => Some("error".into()),
        _ => None,
    }
}

fn json_level(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => level_word(s),
        serde_json::Value::Number(n) => level_word(&n.to_string()),
        _ => None,
    }
}

/// Every string value and object key inside `v` (restricted import paths live in both).
fn json_strings(v: &serde_json::Value, out: &mut BTreeSet<String>) {
    match v {
        serde_json::Value::String(s) => {
            out.insert(s.clone());
        }
        serde_json::Value::Array(a) => a.iter().for_each(|x| json_strings(x, out)),
        serde_json::Value::Object(o) => {
            for (k, x) in o {
                out.insert(k.clone());
                json_strings(x, out);
            }
        }
        _ => {}
    }
}

fn string_presets(name: &str, rules: &mut Rules) {
    if let Some((_, r)) = STRING_PRESETS.iter().find(|(n, _)| *n == name) {
        rules.preset(r);
    }
}

/// Legacy `.eslintrc` JSON (or `package.json#eslintConfig`).
fn eslint_json(v: &serde_json::Value, rules: &mut Rules, inherits: &mut bool) {
    *inherits = v.get("root").and_then(|r| r.as_bool()) != Some(true);
    match v.get("extends") {
        Some(serde_json::Value::String(s)) => string_presets(s, rules),
        Some(serde_json::Value::Array(a)) => {
            for s in a.iter().filter_map(|x| x.as_str()) {
                string_presets(s, rules);
            }
        }
        _ => {}
    }
    if let Some(r) = v.get("rules").and_then(|r| r.as_object()) {
        for (k, val) in r {
            rules.explicit_json(k, val);
        }
    }
}

/// `biome.json`: `linter.rules.<group>.<rule>`, a string level or `{ level, options }`.
fn biome_json(v: &serde_json::Value, rules: &mut Rules, inherits: &mut bool) {
    *inherits =
        v.get("extends").is_some() || v.get("root").and_then(|r| r.as_bool()) == Some(false);
    let linter = v.get("linter");
    if linter
        .and_then(|l| l.get("enabled"))
        .and_then(|e| e.as_bool())
        == Some(false)
    {
        return;
    }
    let groups = linter.and_then(|l| l.get("rules"));
    let recommended = groups
        .and_then(|g| g.get("recommended"))
        .and_then(|r| r.as_bool())
        .unwrap_or(true);
    if recommended {
        rules.preset(BIOME_RECOMMENDED);
    }
    if let Some(groups) = groups.and_then(|g| g.as_object()) {
        biome_groups(groups, rules);
    }
}

/// Biome's `linter.rules` groups: `<group>.<rule>`, or a whole group set to a level.
fn biome_groups(groups: &serde_json::Map<String, serde_json::Value>, rules: &mut Rules) {
    for (group, body) in groups {
        // A whole group set to one level (`"suspicious": "off"`).
        if let Some(level) = body.as_str().and_then(level_word) {
            for (_, g, rule) in BIOME_RULES.iter().filter(|(_, g, _)| g == group) {
                let _ = g;
                rules.set(rule, level.clone(), BTreeSet::new());
            }
            continue;
        }
        let Some(body) = body.as_object() else {
            continue;
        };
        for (name, val) in body {
            let Some((_, _, rule)) = BIOME_RULES.iter().find(|(n, _, _)| n == name) else {
                continue;
            };
            let (level, opts) = match val {
                serde_json::Value::Object(o) => (
                    o.get("level").and_then(json_level),
                    o.get("options").cloned(),
                ),
                other => (json_level(other), None),
            };
            if let Some(level) = level {
                let mut options = BTreeSet::new();
                if let Some(o) = &opts {
                    json_strings(o, &mut options);
                }
                rules.set(rule, level, options);
            }
        }
    }
}

/// `no-restricted-imports` set to `warn` or `error` by `overrides` entries of a JSON
/// config (Biome's `includes`/`include`, ESLint's and oxlint's `files`), with the
/// directories each entry's globs name. An entry whose globs name no directory
/// (`**/*.ts`, `*.test.ts`) or exclude files (`!`) is left out, and so is one with more
/// than [`MAX_SCOPED_GLOBS`] globs; at most [`MAX_SCOPED_ENTRIES`] entries are read.
fn scoped_overrides(rel: &str, tool: &str, v: &serde_json::Value) -> Vec<ScopedLintRules> {
    let base = rel.rsplit_once('/').map_or("", |(d, _)| d);
    let mut out = Vec::new();
    for o in v
        .get("overrides")
        .and_then(|o| o.as_array())
        .into_iter()
        .flatten()
        .take(MAX_SCOPED_ENTRIES)
    {
        let globs = ["includes", "include", "files"]
            .iter()
            .filter_map(|k| o.get(*k))
            .flat_map(|g| match g {
                serde_json::Value::String(s) => vec![s.as_str()],
                serde_json::Value::Array(a) => a
                    .iter()
                    .take(MAX_SCOPED_GLOBS + 1)
                    .filter_map(|x| x.as_str())
                    .collect(),
                _ => vec![],
            })
            .collect::<Vec<_>>();
        if globs.is_empty()
            || globs.len() > MAX_SCOPED_GLOBS
            || globs.iter().any(|g| g.starts_with('!'))
        {
            continue;
        }
        let Some(dirs) = globs
            .iter()
            .map(|g| glob_dir(base, g))
            .collect::<Option<BTreeSet<String>>>()
        else {
            continue;
        };
        let mut rules = Rules::default();
        if tool == "biome" {
            if let Some(groups) = o
                .get("linter")
                .and_then(|l| l.get("rules"))
                .and_then(|r| r.as_object())
            {
                biome_groups(groups, &mut rules);
            }
        } else if let Some(r) = o.get("rules").and_then(|r| r.as_object()) {
            for (k, val) in r {
                rules.explicit_json(k, val);
            }
        }
        let rules: Vec<LintRule> = rules
            .finish()
            .into_iter()
            .filter(|r| {
                r.rule == "no-restricted-imports" && matches!(r.level.as_str(), "warn" | "error")
            })
            .collect();
        if !rules.is_empty() {
            out.push(ScopedLintRules {
                dirs: dirs.into_iter().collect(),
                rules,
            });
        }
    }
    out
}

/// The directory a file glob names, relative to the repo: its literal leading
/// segments (`packages/app-store/**/*.ts` -> `packages/app-store`), joined to the
/// config's directory. `None` when the glob starts with a wildcard.
fn glob_dir(base: &str, glob: &str) -> Option<String> {
    let glob = glob.trim_start_matches("./");
    let segs: Vec<&str> = glob.split('/').collect();
    let mut lit: Vec<&str> = segs
        .iter()
        .copied()
        .take_while(|s| !s.contains(['*', '?', '{', '[']) && *s != "..")
        .collect();
    if lit.len() == segs.len() {
        lit.pop(); // a literal file name
    }
    if lit.is_empty() || lit.iter().any(|s| s.is_empty()) {
        return None;
    }
    let dir = lit.join("/");
    Some(if base.is_empty() {
        dir
    } else {
        format!("{base}/{dir}")
    })
}

/// JSON with comments and trailing commas, as linters accept it.
pub fn parse_jsonc(text: &str) -> Option<serde_json::Value> {
    if let Ok(v) = serde_json::from_str(text) {
        return Some(v);
    }
    let b = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    let mut in_str = false;
    while i < b.len() {
        let c = b[i];
        if in_str {
            out.push(c);
            if c == b'\\' && i + 1 < b.len() {
                out.push(b[i + 1]);
                i += 2;
                continue;
            }
            if c == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => {
                in_str = true;
                out.push(b'"');
                i += 1;
            }
            b'/' if b.get(i + 1) == Some(&b'/') => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                    i += 1;
                }
                i += 2;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    let cleaned = String::from_utf8(out).ok()?;
    // Trailing commas: `,` followed only by whitespace before `}` or `]`.
    let mut fixed = String::with_capacity(cleaned.len());
    let chars: Vec<char> = cleaned.chars().collect();
    let mut in_str = false;
    let mut k = 0;
    while k < chars.len() {
        let c = chars[k];
        if in_str {
            fixed.push(c);
            if c == '\\' && k + 1 < chars.len() {
                fixed.push(chars[k + 1]);
                k += 2;
                continue;
            }
            if c == '"' {
                in_str = false;
            }
            k += 1;
            continue;
        }
        if c == '"' {
            in_str = true;
        }
        if c == ',' {
            let next = chars[k + 1..].iter().find(|x| !x.is_whitespace());
            if matches!(next, Some('}' | ']')) {
                k += 1;
                continue;
            }
        }
        fixed.push(c);
        k += 1;
    }
    serde_json::from_str(&fixed).ok()
}

/// ESLint flat configs and `.eslintrc.js`, read syntactically. Only what the file
/// exports is read (`export default`, `module.exports`), following elements of the
/// exported array, arguments of calls such as `defineConfig(...)` or
/// `tseslint.config(...)`, spreads, and top-level constants they name. A `rules`
/// object anywhere else (a `settings` entry, an unused constant) is not a setting.
/// A config that costs too much to parse ([`drift_core::speculation`],
/// [`crate::arena`]) is read as having no rules.
/// Recurses once per nesting level: runs on a stack that covers `text`.
fn js_config(rel: &str, text: &str, rules: &mut Rules, inherits: &mut bool) {
    let dialect = drift_core::speculation::Dialect::of_path(rel);
    if drift_core::speculation::too_costly(text, dialect) {
        return;
    }
    let _ = crate::arena::with_arena(text.len(), |allocator| {
        js_config_in(allocator, rel, text, rules, inherits);
    });
}

fn js_config_in(
    allocator: &Allocator,
    rel: &str,
    text: &str,
    rules: &mut Rules,
    inherits: &mut bool,
) {
    let source_type = SourceType::from_path(rel).unwrap_or_else(|_| SourceType::mjs());
    let ret = Parser::new(allocator, text, source_type).parse();
    if ret.fatal_error {
        return;
    }
    let file = rel.rsplit('/').next().unwrap_or(rel);
    let legacy = file.starts_with(".eslintrc");
    let mut v = JsConfig {
        rules,
        bindings: BTreeMap::new(),
        consts: BTreeMap::new(),
        root: false,
        visits: 0,
    };
    let mut exported: Vec<&Expression> = Vec::new();
    for stmt in &ret.program.body {
        match stmt {
            Statement::ImportDeclaration(imp) => {
                let module = imp.source.value.display().to_string();
                if let Some(specs) = &imp.specifiers {
                    for sp in specs {
                        v.bindings
                            .insert(sp.local().name.to_string(), module.clone());
                    }
                }
            }
            Statement::VariableDeclaration(d) => v.declare(d),
            Statement::ExportDeclaration(e) => {
                if let Declaration::VariableDeclaration(d) = &e.declaration {
                    v.declare(d);
                }
            }
            Statement::ExportDefaultDeclaration(e) => {
                if let Some(x) = e.declaration.as_expression() {
                    exported.push(x);
                }
            }
            Statement::ExpressionStatement(es) => {
                // `module.exports = ...`
                if let Expression::AssignmentExpression(a) = &es.expression
                    && let AssignmentTarget::StaticMemberExpression(m) = &a.left
                    && m.property.name == "exports"
                    && matches!(&m.object, Expression::Identifier(id) if id.name == "module")
                {
                    exported.push(&a.right);
                }
            }
            _ => {}
        }
    }
    for e in exported {
        v.config(e, false, 0);
    }
    // Legacy configs cascade from parent directories unless `root: true`.
    *inherits = legacy && !v.root;
}

/// How deep `config` follows constants, calls and spreads.
const MAX_CONFIG_DEPTH: usize = 12;
/// How many expressions `config` visits in one file, in total. Constants can fan
/// out (`a1 = [a0, a0, ...]`, `a2 = [a1, a1, ...]`), so depth alone does not bound
/// the work on a hostile config; past the budget, what was read so far is kept.
const MAX_CONFIG_VISITS: usize = 10_000;

struct JsConfig<'r, 'b, 'a> {
    rules: &'r mut Rules,
    /// Local binding -> imported module.
    bindings: BTreeMap<String, String>,
    /// Top-level `const x = <expr>`.
    consts: BTreeMap<String, &'b Expression<'a>>,
    root: bool,
    /// Expressions visited so far (see [`MAX_CONFIG_VISITS`]).
    visits: usize,
}

fn unwrap_ts<'b, 'a>(mut e: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        e = match e {
            Expression::ParenthesizedExpression(p) => &p.expression,
            Expression::TSAsExpression(x) => &x.expression,
            Expression::TSSatisfiesExpression(x) => &x.expression,
            _ => return e,
        };
    }
}

fn prop_name(p: &ObjectProperty) -> Option<String> {
    if p.computed {
        return match &p.key {
            PropertyKey::StringLiteral(s) => Some(s.value.display().to_string()),
            _ => None,
        };
    }
    p.key
        .static_name()
        .and_then(|n| n.as_str().map(str::to_string))
}

fn find_prop<'o, 'a>(o: &'o ObjectExpression<'a>, key: &str) -> Option<&'o ObjectProperty<'a>> {
    o.properties.iter().find_map(|p| match p {
        ObjectPropertyKind::ObjectProperty(p) if prop_name(p).as_deref() == Some(key) => Some(&**p),
        _ => None,
    })
}

fn expr_strings(e: &Expression, out: &mut BTreeSet<String>) {
    match e {
        Expression::StringLiteral(s) => {
            out.insert(s.value.display().to_string());
        }
        Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
            if let Some(q) = t.quasis.first() {
                out.insert(q.value.raw.to_string());
            }
        }
        Expression::ArrayExpression(a) => {
            for el in &a.elements {
                if let Some(x) = el.as_expression() {
                    expr_strings(x, out);
                }
            }
        }
        Expression::ObjectExpression(o) => {
            for p in &o.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = p {
                    if let Some(k) = prop_name(p) {
                        out.insert(k);
                    }
                    expr_strings(&p.value, out);
                }
            }
        }
        _ => {}
    }
}

/// `files: ["**/*.ts", "**/*.{js,tsx}"]`: every source file, whatever the extension
/// list. A pattern with a directory (`src/**`) or a name (`**/*.test.ts`) is scoped.
fn catch_all_files(e: &Expression) -> bool {
    let mut globs = BTreeSet::new();
    expr_strings(e, &mut globs);
    let catch_all = |g: &str| {
        g == "**"
            || g == "**/*"
            || g.strip_prefix("**/*.").is_some_and(|ext| {
                ext.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '{' | '}' | ',' | ' '))
            })
    };
    matches!(e, Expression::ArrayExpression(_))
        && !globs.is_empty()
        && globs.iter().all(|g| catch_all(g))
}

fn expr_level(e: &Expression) -> Option<String> {
    match e {
        Expression::StringLiteral(s) => level_word(&s.value.display().to_string()),
        Expression::NumericLiteral(n) => level_word(&n.value.to_string()),
        _ => None,
    }
}

impl<'b, 'a> JsConfig<'_, 'b, 'a> {
    fn declare(&mut self, d: &'b VariableDeclaration<'a>) {
        for decl in &d.declarations {
            let (BindingPattern::BindingIdentifier(id), Some(init)) = (&decl.id, &decl.init) else {
                continue;
            };
            if let Expression::CallExpression(c) = init
                && let Expression::Identifier(callee) = &c.callee
                && callee.name == "require"
                && let Some(Argument::StringLiteral(s)) = c.arguments.first()
            {
                self.bindings
                    .insert(id.name.to_string(), s.value.display().to_string());
                continue;
            }
            self.consts.insert(id.name.to_string(), init);
        }
    }

    /// Read `e` as config: a block, an array of blocks, a call building them, a
    /// constant naming them or a preset. `scoped`: inside a block limited by `files`.
    fn config(&mut self, e: &'b Expression<'a>, scoped: bool, depth: usize) {
        if depth > MAX_CONFIG_DEPTH || self.visits >= MAX_CONFIG_VISITS {
            return;
        }
        self.visits += 1;
        match unwrap_ts(e) {
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    match el {
                        ArrayExpressionElement::SpreadElement(sp) => {
                            self.config(&sp.argument, scoped, depth + 1);
                        }
                        other => {
                            if let Some(x) = other.as_expression() {
                                self.config(x, scoped, depth + 1);
                            }
                        }
                    }
                }
            }
            Expression::CallExpression(c) => {
                // `compat.extends("next/core-web-vitals", ...)` (FlatCompat).
                if let Expression::StaticMemberExpression(m) = &c.callee
                    && m.property.name == "extends"
                {
                    if !scoped {
                        for a in &c.arguments {
                            if let Argument::StringLiteral(s) = a {
                                string_presets(&s.value.display().to_string(), self.rules);
                            }
                        }
                    }
                    return;
                }
                // `defineConfig(...)`, `tseslint.config(...)`, `fixupConfigRules(...)`.
                for a in &c.arguments {
                    match a {
                        Argument::SpreadElement(sp) => self.config(&sp.argument, scoped, depth + 1),
                        other => {
                            if let Some(x) = other.as_expression() {
                                self.config(x, scoped, depth + 1);
                            }
                        }
                    }
                }
            }
            Expression::ObjectExpression(o) => self.block(o, scoped, depth),
            Expression::Identifier(id) => {
                if let Some(init) = self.consts.get(id.name.as_str()).copied() {
                    self.config(init, scoped, depth + 1);
                } else if !scoped
                    && let Some(module) = self.bindings.get(id.name.as_str())
                    && let Some((_, r)) = MODULE_PRESETS.iter().find(|(m, _)| m == module)
                {
                    self.rules.preset(r);
                }
            }
            Expression::StaticMemberExpression(m) if !scoped => {
                let name = m.property.name.to_string();
                self.member_preset(&m.object, &name);
            }
            Expression::ComputedMemberExpression(m) if !scoped => {
                if let Expression::StringLiteral(s) = &m.expression {
                    self.member_preset(&m.object, &s.value.display().to_string());
                }
            }
            _ => {}
        }
    }

    /// One config block (`{ files, rules, extends, ... }`).
    fn block(&mut self, o: &'b ObjectExpression<'a>, scoped: bool, depth: usize) {
        if find_prop(o, "root")
            .is_some_and(|p| matches!(p.value, Expression::BooleanLiteral(ref b) if b.value))
        {
            self.root = true;
        }
        // A block scoped to some files (`files`; legacy `overrides` entries are never
        // read) does not decide for the whole config, unless its `files` is a
        // catch-all such as `["**/*.{ts,tsx}"]`.
        let scoped = scoped || find_prop(o, "files").is_some_and(|p| !catch_all_files(&p.value));
        for p in &o.properties {
            match p {
                // `{ files: [...], ...strict }`: the spread block shares this scope.
                ObjectPropertyKind::SpreadProperty(sp) => {
                    self.config(&sp.argument, scoped, depth + 1);
                }
                ObjectPropertyKind::ObjectProperty(p) if !scoped => {
                    match prop_name(p).as_deref() {
                        Some("rules") => {
                            let mut value = unwrap_ts(&p.value);
                            if let Expression::Identifier(id) = value
                                && let Some(init) = self.consts.get(id.name.as_str()).copied()
                            {
                                value = unwrap_ts(init);
                            }
                            if let Expression::ObjectExpression(r) = value {
                                self.rules_object(r);
                            }
                        }
                        Some("extends") => {
                            let mut names = BTreeSet::new();
                            expr_strings(&p.value, &mut names);
                            for n in names {
                                string_presets(&n, self.rules);
                            }
                            // Flat `extends: [js.configs.recommended, ...]`.
                            self.config(&p.value, scoped, depth + 1);
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }

    fn rules_object(&mut self, o: &ObjectExpression) {
        for p in &o.properties {
            let ObjectPropertyKind::ObjectProperty(p) = p else {
                continue;
            };
            let Some(rule) = prop_name(p).as_deref().and_then(eslint_rule) else {
                continue;
            };
            let (level, options) = match &p.value {
                Expression::ArrayExpression(a) => {
                    let level = a
                        .elements
                        .first()
                        .and_then(|e| e.as_expression())
                        .and_then(expr_level);
                    let mut options = BTreeSet::new();
                    for el in a.elements.iter().skip(1) {
                        if let Some(x) = el.as_expression() {
                            expr_strings(x, &mut options);
                        }
                    }
                    (level, options)
                }
                other => (expr_level(other), BTreeSet::new()),
            };
            if let Some(level) = level {
                self.rules.set(rule, level, options);
            }
        }
    }

    /// `<binding>.configs.<name>` (or `.configs.flat.<name>`, `.configs["name"]`).
    fn member_preset(&mut self, object: &Expression, name: &str) {
        let mut obj = object;
        // Skip one optional `.flat` level.
        if let Expression::StaticMemberExpression(m) = obj
            && m.property.name == "flat"
        {
            obj = &m.object;
        }
        let Expression::StaticMemberExpression(m) = obj else {
            return;
        };
        if m.property.name != "configs" {
            return;
        }
        let Expression::Identifier(id) = &m.object else {
            return;
        };
        let Some(module) = self.bindings.get(id.name.as_str()) else {
            return;
        };
        let presets: Vec<&'static [&'static str]> = MEMBER_PRESETS
            .iter()
            .filter(|(pkg, names, _)| pkg == module && names.contains(&name))
            .map(|(_, _, r)| *r)
            .collect();
        for r in presets {
            self.rules.preset(r);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// [`super::read_config`], with a stack always to be had here.
    fn read_config(rel: &str, text: &str) -> Option<LintConfig> {
        super::read_config(rel, text).expect("a stack")
    }

    fn levels(c: &LintConfig) -> Vec<String> {
        c.rules
            .iter()
            .map(|r| format!("{}={}", r.rule, r.level))
            .collect()
    }

    #[test]
    fn oxlint_json_with_comments_and_overrides() {
        let c = read_config(
            ".oxlintrc.json",
            r#"{
              // comment
              "rules": {
                "typescript/no-explicit-any": "off",
                "no-console": ["warn", { "allow": ["group"] }],
                "no-restricted-imports": ["error", { "paths": [{ "name": "@app/server" }] }],
              },
              "overrides": [{ "files": ["*.test.ts"], "rules": { "no-console": "off" } }]
            }"#,
        )
        .unwrap();
        assert_eq!(
            levels(&c),
            [
                "no-console=warn",
                "no-explicit-any=off",
                "no-restricted-imports=error"
            ]
        );
        let ri = c
            .rules
            .iter()
            .find(|r| r.rule == "no-restricted-imports")
            .unwrap();
        assert!(ri.options.contains(&"@app/server".to_string()));
    }

    #[test]
    fn explicit_return_types_with_every_plugin_prefix() {
        for name in [
            "@typescript-eslint/explicit-function-return-type",
            "typescript/explicit-function-return-type",
        ] {
            let c = read_config(
                ".oxlintrc.json",
                &format!(r#"{{ "rules": {{ "{name}": "off" }} }}"#),
            )
            .unwrap();
            assert_eq!(levels(&c), ["explicit-function-return-type=off"], "{name}");
        }
    }

    #[test]
    fn biome_recommended_groups_and_rules() {
        let c = read_config(
            "biome.json",
            r#"{ "linter": { "rules": { "recommended": true,
                 "suspicious": { "noConsole": { "level": "error", "options": {} } } } } }"#,
        )
        .unwrap();
        assert_eq!(levels(&c), ["no-console=error", "no-explicit-any=error"]);
        let off = read_config(
            "biome.jsonc",
            r#"{ "linter": { "rules": { "suspicious": "off" } } }"#,
        )
        .unwrap();
        assert_eq!(
            levels(&off),
            [
                "no-console=off",
                "no-console-log=off",
                "no-explicit-any=off"
            ]
        );
        // `noConsoleLog` covers `console.log` only, not `console.*`.
        let log = read_config(
            "biome.json",
            r#"{ "linter": { "rules": { "recommended": false, "suspicious": { "noConsoleLog": "error" } } } }"#,
        )
        .unwrap();
        assert_eq!(levels(&log), ["no-console-log=error"]);
        let disabled = read_config("biome.json", r#"{ "linter": { "enabled": false } }"#).unwrap();
        assert!(disabled.rules.is_empty());
    }

    #[test]
    fn overrides_scoped_to_directories_keep_restricted_imports() {
        let c = read_config(
            "biome.json",
            r#"{ "overrides": [
                 { "includes": ["packages/app-store/**/*.{ts,tsx}"], "linter": { "rules": { "style": {
                     "noRestrictedImports": { "level": "error", "options": { "patterns": [
                       { "group": ["../features/**"], "message": "no" } ] } } } } } },
                 { "includes": ["**/*.test.ts"], "linter": { "rules": { "style": {
                     "noRestrictedImports": "error" } } } },
                 { "includes": ["packages/lib/**", "!packages/lib/x.ts"], "linter": { "rules": { "style": {
                     "noRestrictedImports": "error" } } } },
                 { "includes": ["packages/ui/**"], "linter": { "rules": { "suspicious": {
                     "noConsole": "error" } } } }
               ] }"#,
        )
        .unwrap();
        assert_eq!(c.scoped.len(), 1, "a directory, no negation, a kept rule");
        assert_eq!(c.scoped[0].dirs, ["packages/app-store"]);
        assert!(
            c.scoped[0].rules[0]
                .options
                .contains(&"../features/**".to_string())
        );
        // Nothing scoped leaks into the settings for the whole config.
        assert!(
            !levels(&c)
                .iter()
                .any(|l| l.starts_with("no-restricted-imports"))
        );

        let e = read_config(
            "web/.eslintrc.json",
            r#"{ "overrides": [ { "files": ["src/server/**/*.ts"],
                 "rules": { "no-restricted-imports": ["warn", { "patterns": ["../client/*"] }] } } ] }"#,
        )
        .unwrap();
        assert_eq!(e.scoped[0].dirs, ["web/src/server"]);
        assert_eq!(e.scoped[0].rules[0].level, "warn");
    }

    #[test]
    fn oversized_overrides_are_capped() {
        // About 1 MB: one entry with 46,000 globs, then 1,000 small entries.
        let big: Vec<String> = (0..46_000)
            .map(|i| format!("\"apps/web/d{i}/**\""))
            .collect();
        let small = (0..1000)
            .map(|i| format!(r#"{{ "files": ["apps/a{i}/**"], "rules": {{ "no-restricted-imports": ["error", "../x/**"] }} }}"#))
            .collect::<Vec<_>>()
            .join(",");
        let text = format!(
            r#"{{ "overrides": [ {{ "files": [{}], "rules": {{ "no-restricted-imports": ["error", "../x/**"] }} }}, {small} ] }}"#,
            big.join(",")
        );
        assert!(text.len() > 1_000_000);
        let started = std::time::Instant::now();
        let c = read_config(".eslintrc.json", &text).unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        // The 46,000-glob entry is left out; 63 small entries fit in the entry cap.
        assert_eq!(c.scoped.len(), MAX_SCOPED_ENTRIES - 1);
        assert!(c.scoped.iter().all(|e| e.dirs.len() <= MAX_SCOPED_GLOBS));
    }

    #[test]
    fn legacy_eslint_extends_and_cascade() {
        let c = read_config(
            "web/.eslintrc.json",
            r#"{ "extends": ["next/core-web-vitals", "plugin:@typescript-eslint/recommended"],
                 "rules": { "@typescript-eslint/no-explicit-any": 0 } }"#,
        )
        .unwrap();
        assert!(c.inherits);
        assert_eq!(levels(&c), ["no-explicit-any=off", "rules-of-hooks=error"]);
        let pkg = read_config("package.json", r#"{ "name": "x" }"#);
        assert!(pkg.is_none());
    }

    #[test]
    fn flat_configs_presets_and_scoped_blocks() {
        let c = read_config(
            "web/eslint.config.js",
            r#"
            import tseslint from 'typescript-eslint';
            import reactHooks from 'eslint-plugin-react-hooks';
            const extra = { files: ['**/*.test.ts'], rules: { 'no-console': 'off' } };
            const ts = { files: ['**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { paths: ['lodash'] }] } };
            export default [
              ...tseslint.configs.recommended,
              reactHooks.configs['recommended-latest'],
              { rules: { 'no-console': ['error'], 'n/no-process-env': 1 } },
              extra,
              ts,
            ];
            "#,
        )
        .unwrap();
        assert!(!c.inherits);
        assert_eq!(
            levels(&c),
            [
                "no-console=error",
                "no-explicit-any=error",
                "no-process-env=warn",
                "no-restricted-imports=error",
                "rules-of-hooks=error"
            ]
        );
        // Explicit settings win over presets; broken configs give no rules.
        let off = read_config(
            "eslint.config.mjs",
            "import t from 'typescript-eslint'; export default t.config(t.configs.strict, { rules: { '@typescript-eslint/no-explicit-any': 'off' } });",
        )
        .unwrap();
        assert_eq!(levels(&off), ["no-explicit-any=off"]);
        // `rules` objects that are not config blocks are not settings.
        for text in [
            "export default [{ settings: { foo: { rules: { 'no-console': 'error' } } } }];",
            "const x = { rules: { 'no-console': 'error' } }; export default [];",
            // A block spread into a scoped block is scoped too.
            "const strict = { rules: { 'no-console': 'error' } }; export default [{ files: ['src/legacy/**'], ...strict }];",
        ] {
            let c = read_config("eslint.config.mjs", text).unwrap();
            assert!(c.rules.is_empty(), "{text}: {:?}", levels(&c));
        }
        // Constants the export names, `defineConfig(...)` and `module.exports` are read.
        let named = read_config(
            "eslint.config.mjs",
            "const base = { rules: { 'no-console': 'warn' } }; export default defineConfig([base]);",
        )
        .unwrap();
        assert_eq!(levels(&named), ["no-console=warn"]);
        let cjs = read_config(
            "eslint.config.cjs",
            "const ts = require('typescript-eslint'); module.exports = [...ts.configs.recommended];",
        )
        .unwrap();
        assert_eq!(levels(&cjs), ["no-explicit-any=error"]);
        // Fanned-out constants are exponential to walk; the visit budget bounds it.
        let mut text = String::from("const a0 = { rules: { 'no-console': 'warn' } };\n");
        for i in 1..=4 {
            let refs = vec![format!("a{}", i - 1); 1000].join(",");
            text.push_str(&format!("const a{i} = [{refs}];\n"));
        }
        text.push_str("export default a4;\n");
        let started = std::time::Instant::now();
        let fanned = read_config("eslint.config.mjs", &text).unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
        assert_eq!(
            levels(&fanned),
            ["no-console=warn"],
            "what was read is kept"
        );
        let broken = read_config("eslint.config.js", "export default [ {").unwrap();
        assert!(broken.rules.is_empty());
    }
}
