//! Test roles (selector version 4, off unless asked for).
//!
//! Test, story and fixture files form no production role ([`crate::roles::is_test_path`]),
//! so in an application repository, where tests are often 30 to 45% of the files, nearly
//! every file Drift leaves out of every role is a test. The test-role family groups them
//! by a *shape* read from structure only, never from a name the repository chose:
//!
//! - `test`: a test module (`*.test.ts`, `test_*.py`, a file under `tests/`);
//! - `fixture`: shared test setup (`conftest.py`, `fixtures/`, `__mocks__/`);
//! - `e2e`: end-to-end tests (`*.e2e.*`, `e2e/`, `cypress/`, `playwright/`);
//! - `story`: component stories (`*.stories.*`, `__stories__/`).
//!
//! One language per shape (`py:test`, `ts:test`). A test unit (an exported test
//! function, fixture or test class, and one unit for the module itself) is in the place
//! roles of its folder and file kind, each marked with its shape, and in one role of its
//! shape across the whole repository. A shape role is never a production role, so no
//! production convention ever counts a test, and test roles are mined in a pass of their
//! own ([`crate::mine`]), with their own lift baseline: the production cards are exactly
//! what they are without them. What they can find is what agents need when they write a
//! test: the shared fixtures, factories and helpers the test modules of a folder use.
//!
//! They are learned only when [`crate::roles::FileKinds::tests`] is set (the study flag
//! `census --test-roles`, or `roles: {tests: on}` in `.drift/config.yaml`), and a
//! vocabulary frozen without them never forms them: every convention written before
//! (selector version 3 or lower) reads exactly as it did.

//! # Kind roles (also selector version 4, off unless asked for)
//!
//! A production unit's roles are places: a package, a folder, a file kind. In an app
//! monorepo of many small packages most places are too small to be roles, and the
//! places that are roles group code by folder rather than by what it is. A kind role
//! groups the production units of one structural kind across the whole repository
//! ([`kind_of_symbol`], [`kind_of_file`]): React components, custom hooks, schema
//! values, pydantic models, ORM models, framework member kinds and special classes,
//! service classes, entry points of each kind, FastAPI router modules, LangGraph
//! modules, server-action modules, Next app-router files, CLI scripts, migrations,
//! configuration modules, barrels, type modules, library modules. A kind is read from
//! structure only: the symbol kind, the framework a class derives from through the
//! repo's own bases, the framework a module imports or calls, the export shape of a
//! file, and path roles that mean the same across repositories (`migrations/`,
//! `scripts/`, `lib/`, `*.config.*`, `__init__.py`); never a name the repository chose.
//! Kind roles are additional roles on production units, learned only when
//! [`crate::roles::FileKinds::kind_roles`] is set (`census --kind-roles`, or
//! `kind_roles` in `experimental`); every place role stays as it is.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, WrapKind, traits};

use crate::roles::{PACKAGE_WIDE, RoleSelector};

/// The selector version of a convention on a test role: a Drift that reads selectors of
/// version 3 or lower knows no shape, so it must not take one for a production role.
pub const SHAPE_SELECTOR_VERSION: u32 = 4;

/// `RoleSelector::package` of a role of one shape across the repository.
pub const ANY_PACKAGE: &str = "*";

/// The language prefix of a file's shape: `py`, or `ts` for TypeScript and JavaScript.
pub fn lang_prefix(file: &FileFacts) -> &'static str {
    if file.lang == "py" { "py" } else { "ts" }
}

fn file_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase()
}

fn dirs(path: &str) -> Vec<String> {
    let lower = path.to_ascii_lowercase();
    let mut segs: Vec<String> = lower.split('/').map(str::to_string).collect();
    segs.pop();
    segs
}

/// The shape of a test, story or fixture file ([`crate::roles::is_test_path`]).
pub fn test_shape(file: &FileFacts) -> String {
    let name = file_name(&file.path);
    let segs = dirs(&file.path);
    let any = |names: &[&str]| segs.iter().any(|d| names.contains(&d.as_str()));
    let shape = if name.contains(".stories.") || any(&["__stories__"]) {
        "story"
    } else if name == "conftest.py" || any(&["fixtures", "__fixtures__", "__mocks__"]) {
        "fixture"
    } else if name.contains(".e2e.") || any(&["e2e", "cypress", "playwright"]) {
        "e2e"
    } else {
        "test"
    };
    format!("{}:{shape}", lang_prefix(file))
}

/// The selector of the role of `shape` across the repository.
pub fn selector(shape: &str, kind: SymbolKind) -> RoleSelector {
    RoleSelector {
        package: ANY_PACKAGE.to_string(),
        dir: PACKAGE_WIDE.to_string(),
        file: "*".to_string(),
        entry: "-".to_string(),
        kind,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: Some(shape.to_string()),
        also: vec![],
    }
}

/// True for a test shape ([`test_shape`]); false for a kind ([`kind_of_symbol`]).
pub fn is_test_shape(shape: &str) -> bool {
    matches!(
        shape.split_once(':').map_or(shape, |(_, s)| s),
        "test" | "fixture" | "e2e" | "story"
    )
}

/// True for a test role: a role whose shape is a test shape.
pub fn is_test_role(role: &RoleSelector) -> bool {
    role.shape.as_deref().is_some_and(is_test_shape)
}

/// What the members of a role of `shape` with entry kind `entry` are, in words.
pub fn describe_role(shape: &str, entry: &str, kind: SymbolKind) -> String {
    if shape.ends_with(":entry") {
        let lang = if shape.starts_with("py:") {
            "Python"
        } else {
            "TypeScript"
        };
        let what = match entry {
            "http" => "HTTP handlers".to_string(),
            "page" => "pages".to_string(),
            "layout" => "layouts".to_string(),
            "server_action" => "server actions".to_string(),
            "middleware" => "middleware".to_string(),
            "rpc" => "RPC procedures".to_string(),
            "job" => "jobs".to_string(),
            e => format!("{e} entry points"),
        };
        return format!("{lang} {what}");
    }
    describe(shape, kind)
}

/// What the members of a role of `shape` are, in words (`Python test modules`).
pub fn describe(shape: &str, kind: SymbolKind) -> String {
    if !is_test_shape(shape) {
        return describe_kind(shape, kind);
    }
    let (lang, s) = shape.split_once(':').unwrap_or(("", shape));
    let lang = if lang == "py" { "Python" } else { "TypeScript" };
    let what = match s {
        "test" => "test",
        "fixture" => "test fixture",
        "e2e" => "end-to-end test",
        "story" => "story",
        other => other,
    };
    let unit = match kind {
        SymbolKind::Module => "modules",
        SymbolKind::Class => "classes",
        SymbolKind::Component => "components",
        SymbolKind::Const | SymbolKind::Variable => "values",
        _ => "functions",
    };
    format!("{lang} {what} {unit}")
}

/// Test frameworks and the libraries every test of a kind uses: a rule that names only
/// them restates that the members are tests ("test modules call `vi.fn()`", "fixtures are
/// decorated with `pytest.fixture`").
const TEST_PACKAGES: &[&str] = &[
    "pytest",
    "python:unittest",
    "python:doctest",
    "vitest",
    "jest",
    "@jest/globals",
    "@testing-library",
    "@playwright/test",
    "playwright",
    "cypress",
    "@storybook",
    "mocha",
    "chai",
    "node:test",
    "node:assert",
];

/// `pkg:<name>` or a module of it (`pkg:<name>.sub`, `pkg:<name>/sub`), any export.
fn from_package(id: &str, name: &str) -> bool {
    id.strip_prefix("pkg:")
        .and_then(|r| r.strip_prefix(name))
        .is_some_and(|r| r.is_empty() || r.starts_with(['#', '.', '/']))
}

/// A rule that restates what makes the members of a test role tests: one whose targets
/// are all test frameworks ([`TEST_PACKAGES`]), or a name pattern the test runner
/// requires (`test_*`, `Test*`, `*Test`, `*.test`). Such a rule holds by construction.
pub fn restates_shape(role: &RoleSelector, rule: &crate::mine::Rule, targets: &[&str]) -> bool {
    use crate::mine::Rule;
    let Some(shape) = role.shape.as_deref() else {
        return false;
    };
    if !is_test_shape(shape) {
        return restates_kind(shape, rule, targets);
    }
    if let Rule::Named { pattern } = rule {
        let p = pattern.to_ascii_lowercase();
        return p.starts_with("test") || p.ends_with("test") || p.ends_with("tests");
    }
    !targets.is_empty()
        && targets
            .iter()
            .all(|t| TEST_PACKAGES.iter().any(|p| from_package(t, p)))
}

// ---------------------------------------------------------------------------------------
// Kind roles.
// ---------------------------------------------------------------------------------------

/// Longest chain of in-repo bases followed to find a framework base.
const MAX_BASE_DEPTH: usize = 8;

/// The in-repo classes and bindings a base chain is followed through: each class's
/// `extends` wrappers, and each binding's calls (`Base = declarative_base()`); and the
/// ORM models the facts record (`path#Name`).
#[derive(Debug, Default)]
pub struct ClassIndex<'a> {
    bases: BTreeMap<String, Vec<&'a str>>,
    calls: BTreeMap<String, &'a [String]>,
    models: BTreeSet<String>,
}

impl<'a> ClassIndex<'a> {
    pub fn learn(repo: &'a RepoFacts) -> Self {
        let mut idx = ClassIndex::default();
        for f in &repo.files {
            for s in &f.symbols {
                let id = format!("{}#{}", f.path, s.name);
                match s.kind {
                    SymbolKind::Class => {
                        idx.bases.insert(id, extends(s).collect());
                    }
                    SymbolKind::Const | SymbolKind::Variable => {
                        idx.calls.insert(id, &s.calls);
                    }
                    _ => {}
                }
            }
        }
        idx.models = repo
            .models
            .iter()
            .map(|m| format!("{}#{}", m.path, m.name))
            .collect();
        idx
    }

    /// True when a base of `symbol`, directly or through in-repo bases, is one `pred` takes.
    fn derives(&self, symbol: &Symbol, pred: &dyn Fn(&str) -> bool) -> bool {
        let mut todo: Vec<(String, usize)> = extends(symbol).map(|b| (b.to_string(), 0)).collect();
        let mut seen = BTreeSet::new();
        while let Some((b, depth)) = todo.pop() {
            if pred(&b) {
                return true;
            }
            if depth >= MAX_BASE_DEPTH || !seen.insert(b.clone()) {
                continue;
            }
            if let Some(next) = self.bases.get(&b) {
                todo.extend(next.iter().map(|n| (n.to_string(), depth + 1)));
            }
            if let Some(calls) = self.calls.get(&b) {
                todo.extend(calls.iter().map(|n| (n.clone(), depth + 1)));
            }
        }
        false
    }
}

fn extends(symbol: &Symbol) -> impl Iterator<Item = &str> {
    symbol
        .wraps
        .iter()
        .filter(|w| w.kind == WrapKind::Extends)
        .map(|w| w.wrapper.as_str())
}

fn last_name(id: &str) -> &str {
    let name = id.split_once('#').map_or(id, |(_, n)| n);
    let name = name.split('(').next().unwrap_or(name);
    name.rsplit('.').next().unwrap_or(name)
}

fn pydantic_base(id: &str) -> bool {
    (from_package(id, "pydantic") || from_package(id, "pydantic_settings"))
        && matches!(last_name(id), "BaseModel" | "RootModel" | "BaseSettings")
}

fn orm_base(id: &str) -> bool {
    (from_package(id, "sqlalchemy")
        && matches!(
            last_name(id),
            "DeclarativeBase" | "declarative_base" | "DeclarativeBaseNoMeta" | "as_declarative"
        ))
        || (from_package(id, "sqlmodel") && last_name(id) == "SQLModel")
}

/// Packages whose import makes a module a command-line program.
const CLI_PACKAGES: &[&str] = &[
    "python:argparse",
    "click",
    "typer",
    "commander",
    "yargs",
    "cac",
    "meow",
    "clipanion",
];
/// Packages that build schema values (`traits::SCHEMA_VALUE`).
const SCHEMA_PACKAGES: &[&str] = &[
    "zod",
    "yup",
    "valibot",
    "joi",
    "@sinclair/typebox",
    "superstruct",
];
/// LangGraph.
const GRAPH_PACKAGES: &[&str] = &["langgraph"];
/// Folder names whose files are utilities by convention across repositories.
const LIB_DIRS: &[&str] = &[
    "lib", "libs", "utils", "util", "helpers", "helper", "shared", "common",
];
/// Folder names whose files are command-line programs by convention.
const CLI_DIRS: &[&str] = &["scripts", "script", "bin", "cli", "commands"];
/// Next.js app-router file names a folder of `app/` gives a meaning to.
const NEXT_ROUTE_FILES: &[&str] = &[
    "page",
    "layout",
    "route",
    "loading",
    "error",
    "not-found",
    "template",
    "default",
    "global-error",
];

fn stem(path: &str) -> String {
    file_name(path)
        .split('.')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn imports_from(file: &FileFacts, packages: &[&str]) -> bool {
    file.imports
        .iter()
        .any(|i| packages.iter().any(|p| from_package(&i.module, p)))
}

/// A service or repository module by path role: `services/`, `repositories/`,
/// `service.py`, `user_service.py`, `user.service.ts`, `user-repository.ts`.
fn service_path(path: &str) -> bool {
    let st = stem(path);
    let name = file_name(path);
    let dotted: Vec<&str> = name.split('.').collect();
    let word =
        |w: &str| w == "service" || w == "services" || w == "repository" || w == "repositories";
    dirs(path).iter().any(|d| word(d))
        || word(&st)
        || st.rsplit(['_', '-']).next().is_some_and(word)
        || (dotted.len() >= 3 && word(dotted[dotted.len() - 2]))
}

/// The kind of a production file (its file unit), if it has one. One kind per file, by
/// the precedence below, so the result never depends on iteration order.
pub fn kind_of_file(file: &FileFacts) -> Option<String> {
    let p = &file.path;
    let py = file.lang == "py";
    let segs = dirs(p);
    let name = file_name(p);
    let st = stem(p);
    let any = |names: &[&str]| segs.iter().any(|d| names.contains(&d.as_str()));
    let kind = if any(&["migrations", "alembic"]) {
        "migration"
    } else if name.contains(".config.")
        || matches!(
            st.as_str(),
            "config" | "settings" | "conf" | "configuration"
        )
        || any(&["config", "configs", "settings"])
    {
        "config"
    } else if py && name == "__init__.py" {
        "package_init"
    } else if any(CLI_DIRS)
        || matches!(st.as_str(), "cli" | "__main__" | "manage")
        || imports_from(file, CLI_PACKAGES)
    {
        "cli"
    } else if py && imports_from(file, GRAPH_PACKAGES) {
        "graph"
    } else if py
        && file.symbols.iter().any(|s| {
            s.calls
                .iter()
                .any(|c| from_package(c, "fastapi") && last_name(c) == "APIRouter")
        })
    {
        "router"
    } else if !py && file.directives.iter().any(|d| d == "use server") {
        "server_actions"
    } else if !py && segs.iter().any(|d| d == "app") && NEXT_ROUTE_FILES.contains(&st.as_str()) {
        "next_route"
    } else if !file.entry_points.is_empty() {
        "entries"
    } else if !py
        && st == "index"
        && !file.exports.is_empty()
        && file
            .exports
            .iter()
            .all(|e| e.kind != drift_core::ExportKind::Local)
    {
        "barrel"
    } else if !py
        && (file.type_only
            || name.ends_with(".d.ts")
            || st == "types"
            || name.contains(".types.")
            || name.contains(".type.")
            || name.contains(".interface."))
    {
        "types"
    } else if service_path(p) {
        "service"
    } else if py && crate::roles::is_python_model_path(p) {
        "models"
    } else if any(LIB_DIRS) || matches!(st.as_str(), "utils" | "util" | "helpers" | "helper") {
        "lib"
    } else {
        return None;
    };
    Some(format!("{}:{kind}", lang_prefix(file)))
}

/// The kind of a production symbol unit, if it has one. `entry` is its entry kind (or `-`).
pub fn kind_of_symbol(
    file: &FileFacts,
    symbol: &Symbol,
    entry: &str,
    index: &ClassIndex,
) -> Option<String> {
    let py = file.lang == "py";
    let kind: String = if entry != "-" {
        "entry".into()
    } else if !py && symbol.kind == SymbolKind::Component {
        "component".into()
    } else if !py && symbol.kind == SymbolKind::Function && hook_name(&symbol.name) {
        "hook".into()
    } else if symbol.traits.iter().any(|t| t == traits::SCHEMA_VALUE) {
        "schema".into()
    } else if symbol.kind == SymbolKind::Class {
        match crate::roles::class_variety(symbol) {
            crate::roles::Variety::Excluded => return None,
            crate::roles::Variety::Special(v) => v.to_string(),
            crate::roles::Variety::Primary => {
                let lineage = drift_core::lineage::of_traits(&symbol.traits);
                if index
                    .models
                    .contains(&format!("{}#{}", file.path, symbol.name))
                    || lineage == Some(drift_core::lineage::MODEL)
                    || (py && index.derives(symbol, &orm_base))
                {
                    "orm_model".into()
                } else if let Some(k) = lineage {
                    k.to_string()
                } else if py && index.derives(symbol, &pydantic_base) {
                    "pydantic_model".into()
                } else if service_path(&file.path) {
                    "service".into()
                } else {
                    return None;
                }
            }
        }
    } else {
        return None;
    };
    Some(format!("{}:{kind}", lang_prefix(file)))
}

/// React's naming rule for hooks: `use` and then an upper-case letter or a digit.
fn hook_name(name: &str) -> bool {
    name.strip_prefix("use")
        .and_then(|r| r.chars().next())
        .is_some_and(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// The selector of the kind role of `kind` across the repository.
pub fn kind_selector(kind_name: &str, entry: &str, kind: SymbolKind) -> RoleSelector {
    RoleSelector {
        entry: entry.to_string(),
        ..selector(kind_name, kind)
    }
}

fn describe_kind(shape: &str, kind: SymbolKind) -> String {
    let (lang, s) = shape.split_once(':').unwrap_or(("", shape));
    let lang = if lang == "py" { "Python" } else { "TypeScript" };
    let what = match s {
        "entry" => return format!("{lang} entry points"),
        "component" => "React components",
        "hook" => "custom hooks",
        "schema" => "schema values",
        "orm_model" => "ORM model classes",
        "pydantic_model" => "pydantic models",
        "service" if kind == SymbolKind::Module => "service and repository modules",
        "service" => "service and repository classes",
        "migration" => "migrations",
        "config" => "configuration modules",
        "package_init" => "package `__init__` modules",
        "cli" => "command-line scripts",
        "graph" => "LangGraph modules",
        "router" => "FastAPI router modules",
        "server_actions" => "server action modules",
        "next_route" => "Next.js app-router files",
        "entries" => "modules with entry points",
        "barrel" => "barrel modules",
        "types" => "type modules",
        "models" => "model modules",
        "lib" => "library and utility modules",
        "enum" => "enums",
        "dataclass" => "dataclasses",
        "typeddict" => "TypedDicts",
        "namedtuple" => "named tuples",
        "protocol" => "protocols",
        other => return format!("{lang} {other} classes"),
    };
    format!("{lang} {what}")
}

/// Packages whose use makes a unit the kind it is.
fn defining_packages(kind: &str) -> &'static [&'static str] {
    match kind {
        "pydantic_model" => &["pydantic", "pydantic_settings"],
        "orm_model" => &["sqlalchemy", "sqlmodel", "django"],
        "router" => &["fastapi"],
        "graph" => GRAPH_PACKAGES,
        "cli" => CLI_PACKAGES,
        "schema" => SCHEMA_PACKAGES,
        _ => &[],
    }
}

/// A rule that restates what makes the members of a kind role that kind: the framework
/// base, call or import that defines it, a hook's `use*` name, the `use server`
/// directive, the base or decorator of a special class kind or framework member kind.
fn restates_kind(shape: &str, rule: &crate::mine::Rule, targets: &[&str]) -> bool {
    use crate::mine::Rule;
    let s = shape.split_once(':').map_or(shape, |(_, s)| s);
    match rule {
        Rule::Named { .. } if s == "hook" => return true,
        Rule::Directive { value } if s == "server_actions" && value == "use server" => return true,
        _ => {}
    }
    if targets.is_empty() {
        return false;
    }
    let packages = defining_packages(s);
    if !packages.is_empty()
        && targets
            .iter()
            .all(|t| packages.iter().any(|p| from_package(t, p)))
    {
        return true;
    }
    targets.iter().all(|t| {
        drift_core::lineage::framework_kind(&crate::mine::norm_ref(t)) == Some(s)
            || (s != "orm_model" && crate::mine::words(last_name(t)).concat() == s)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mine::Rule;
    use drift_core::WrapKind;

    fn file(path: &str) -> FileFacts {
        FileFacts {
            path: path.into(),
            lang: if path.ends_with(".py") { "py" } else { "ts" }.into(),
            ..Default::default()
        }
    }

    #[test]
    fn shapes_by_path_role() {
        assert_eq!(
            test_shape(&file("svc/quokka/tests/conftest.py")),
            "py:fixture"
        );
        assert_eq!(
            test_shape(&file("svc/quokka/tests/test_burrows.py")),
            "py:test"
        );
        assert_eq!(
            test_shape(&file("apps/web/src/burrow-card.test.tsx")),
            "ts:test"
        );
        assert_eq!(
            test_shape(&file("apps/web/src/card.stories.tsx")),
            "ts:story"
        );
        assert_eq!(test_shape(&file("apps/web/e2e/dig.spec.ts")), "ts:e2e");
        assert_eq!(
            test_shape(&file("apps/web/src/__mocks__/burrow.ts")),
            "ts:fixture"
        );
    }

    #[test]
    fn restated_rules() {
        let role = selector("py:test", SymbolKind::Function);
        let fixture = Rule::WrappedBy {
            kind: WrapKind::Decorator,
            any_of: vec!["pkg:pytest#fixture".into()],
        };
        assert!(restates_shape(&role, &fixture, &["pkg:pytest#fixture"]));
        assert!(restates_shape(
            &role,
            &Rule::Calls {
                callee: "pkg:@testing-library/react#render".into()
            },
            &["pkg:@testing-library/react#render"]
        ));
        // A shared factory or helper of the repo's own is what the tests choose.
        assert!(!restates_shape(
            &role,
            &Rule::Calls {
                callee: "svc/quokka/tests/factories.py#BurrowFactory".into()
            },
            &["svc/quokka/tests/factories.py#BurrowFactory"]
        ));
        assert!(restates_shape(
            &role,
            &Rule::Named {
                pattern: "test_*".into()
            },
            &[]
        ));
        assert!(!restates_shape(
            &role,
            &Rule::Named {
                pattern: "*_factory".into()
            },
            &[]
        ));
        // A production role is never a test role.
        let mut place = role.clone();
        place.shape = None;
        assert!(!restates_shape(&place, &fixture, &["pkg:pytest#fixture"]));
        assert_eq!(
            describe("py:fixture", SymbolKind::Function),
            "Python test fixture functions"
        );
    }

    #[test]
    fn kinds_by_structure() {
        use drift_core::{Import, Wrap};
        let k = |f: &FileFacts| kind_of_file(f);
        assert_eq!(
            k(&file("svc/otter/alembic/versions/a1.py")).as_deref(),
            Some("py:migration")
        );
        assert_eq!(
            k(&file("apps/web/next.config.mjs")).as_deref(),
            Some("ts:config")
        );
        assert_eq!(
            k(&file("libs/pond/pond/__init__.py")).as_deref(),
            Some("py:package_init")
        );
        assert_eq!(k(&file("tools/scripts/seed.py")).as_deref(), Some("py:cli"));
        let mut g = file("svc/agent/flow.py");
        g.imports.push(Import {
            module: "pkg:langgraph.graph".into(),
            names: vec![],
            type_only: false,
            load: Default::default(),
        });
        assert_eq!(k(&g).as_deref(), Some("py:graph"));
        assert_eq!(
            k(&file("apps/web/app/dens/[id]/loading.tsx")).as_deref(),
            Some("ts:next_route")
        );
        assert_eq!(k(&file("apps/web/src/views/page.tsx")), None);
        assert_eq!(
            k(&file("svc/otter/den_service.py")).as_deref(),
            Some("py:service")
        );
        assert_eq!(
            k(&file("apps/web/src/lib/format.ts")).as_deref(),
            Some("ts:lib")
        );
        // A name the repository chose is no kind.
        assert_eq!(k(&file("svc/otter/den.py")), None);

        let mut repo = RepoFacts::default();
        let mut base = file("libs/core/schemas.py");
        let mut s = Symbol {
            name: "Schema".into(),
            kind: SymbolKind::Class,
            ..Default::default()
        };
        s.wraps.push(Wrap {
            wrapper: "pkg:pydantic#BaseModel".into(),
            kind: WrapKind::Extends,
        });
        base.symbols.push(s);
        repo.files.push(base);
        let idx = ClassIndex::learn(&repo);
        let f = file("svc/otter/schemas/den.py");
        let mut den = Symbol {
            name: "DenIn".into(),
            kind: SymbolKind::Class,
            ..Default::default()
        };
        den.wraps.push(Wrap {
            wrapper: "libs/core/schemas.py#Schema".into(),
            kind: WrapKind::Extends,
        });
        assert_eq!(
            kind_of_symbol(&f, &den, "-", &idx).as_deref(),
            Some("py:pydantic_model")
        );
        let t = file("apps/web/src/dens.ts");
        let hook = Symbol {
            name: "useDens".into(),
            kind: SymbolKind::Function,
            ..Default::default()
        };
        assert_eq!(
            kind_of_symbol(&t, &hook, "-", &idx).as_deref(),
            Some("ts:hook")
        );
        let user = Symbol {
            name: "user".into(),
            kind: SymbolKind::Function,
            ..Default::default()
        };
        assert_eq!(kind_of_symbol(&t, &user, "-", &idx), None);
        assert_eq!(
            kind_of_symbol(&t, &user, "http", &idx).as_deref(),
            Some("ts:entry")
        );

        let role = kind_selector("py:pydantic_model", "-", SymbolKind::Class);
        let ext = Rule::WrappedBy {
            kind: WrapKind::Extends,
            any_of: vec!["pkg:pydantic#BaseModel".into()],
        };
        assert!(restates_shape(&role, &ext, &["pkg:pydantic#BaseModel"]));
        assert!(!restates_shape(
            &role,
            &ext,
            &["libs/core/schemas.py#Schema"]
        ));
        assert!(!is_test_role(&role));
        assert!(is_test_role(&selector("py:test", SymbolKind::Function)));
    }
}
