//! Structural roles.
//!
//! A role groups symbols that sit in the same place in the codebase's structure:
//! same package, same directory prefix, same kind of file, same entry-point kind
//! and same symbol kind. Roles are built from structure only, never from the
//! facts conventions are mined from, so outliers cannot form a role of their own.
//! After `drift init` a role is frozen as a [`RoleSelector`] and `check` matches
//! files against selectors instead of re-clustering.

use std::collections::BTreeMap;

use drift_core::{FileFacts, Model, PackageFacts, RepoFacts, Symbol, SymbolKind, traits};
use serde::{Deserialize, Serialize};

/// Directory depths (below the package root) at which roles are formed.
pub const ROLE_DEPTHS: std::ops::RangeInclusive<usize> = 1..=5;

/// A filename stem used by at least this many files is kept literally (`route`, `page`).
const LITERAL_STEM_MIN: usize = 5;
/// A dotted suffix used by at least this many files forms a kind (`*.service`).
const SUFFIX_MIN: usize = 3;

/// A frozen, serialisable description of a role.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct RoleSelector {
    /// Package directory ("" for the repo root package).
    pub package: String,
    /// Directory prefix below the package, dynamic segments abstracted (`app/api/[*]`).
    pub dir: String,
    /// File kind: a literal stem (`route`), a suffix kind (`*.service`) or `*`.
    pub file: String,
    /// Entry-point kind from adapters (`http`, `page`, ...) or `-`.
    pub entry: String,
    /// Symbol kind.
    pub kind: SymbolKind,
    /// For classes of a special kind (an enum, a dataclass, ...): that kind. Such
    /// classes form roles of their own, apart from the primary classes next to them
    /// ([`class_variety`]). `None` (not serialised) for everything else, so the ids
    /// of other roles do not change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variety: Option<String>,
    /// For an export whose name the file's framework reserves ([`reserved_export`]:
    /// Next.js's `generateMetadata`, `generateStaticParams`, `dynamicParams` in a route
    /// file): that name. The framework gives each reserved name its own meaning, so the
    /// exports of one name form roles of their own, apart from the other exports next
    /// to them: what every `generateMetadata` does says nothing about
    /// `generateStaticParams`. `None` (not serialised) for everything else, so the ids
    /// of other roles do not change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_name: Option<String>,
    /// For a member of a kind of its own within its symbol kind: that kind. Python
    /// classes of a framework lineage ([`drift_core::lineage`]: `serializer`, `model`,
    /// `form`, `admin`, `inline`, `mixin`, `exception`, `view`) form roles of their own, apart
    /// from the plain classes and the other kinds next to them: what most serializers
    /// in `api.py` files do says nothing about the permission classes beside them.
    /// `None` (not serialised) for everything else, so the ids of other roles do not
    /// change ([`crate::policy::SELECTOR_VERSION`] 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member_kind: Option<String>,
    /// For a test role ([`crate::shapes`], selector version 4): the shape of its members
    /// (`py:test`, `ts:fixture`). A test role is never a production role: its place
    /// roles carry the shape, and a role of one shape across the repository has the
    /// package [`crate::shapes::ANY_PACKAGE`]. `None` (not serialised) for every other
    /// role, so their ids do not change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    /// Sibling roles the convention also covers: one card for the same rule on roles
    /// beside each other (`crate::mine`'s `merge_siblings`). Each entry is a plain role
    /// (no `also` of its own) at the same package, entry, symbol kind and kinds as this
    /// one, in a sibling folder or a sibling file kind; the members are those of this
    /// role (read without `also`) and of each entry ([`RoleSelector::parts`]). Empty (not
    /// serialised) for every other role, so their ids do not change.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub also: Vec<RoleSelector>,
}

impl RoleSelector {
    /// The plain roles this selector covers: itself, or, for a merged card's role
    /// ([`RoleSelector::also`]), itself without `also`, then each sibling in `also`.
    pub fn parts(&self) -> Vec<RoleSelector> {
        if self.also.is_empty() {
            return vec![self.clone()];
        }
        let mut out = vec![RoleSelector {
            also: vec![],
            ..self.clone()
        }];
        out.extend(self.also.iter().cloned());
        out
    }

    /// Short human description, e.g. `apps/web: app/api/** route.* http handlers`.
    pub fn describe(&self) -> String {
        if let Some(shape) = &self.shape {
            let what = crate::shapes::describe_role(shape, &self.entry, self.kind);
            if self.package == crate::shapes::ANY_PACKAGE {
                return format!("{what} across the repo");
            }
            let pkg = if self.package.is_empty() {
                String::new()
            } else {
                format!("{}: ", self.package)
            };
            let place = if self.dir == PACKAGE_WIDE {
                if self.package.is_empty() {
                    "the repo".to_string()
                } else {
                    format!("{}/**", self.package)
                }
            } else if self.file == "*" {
                format!("{}/**", self.dir)
            } else {
                format!("{}/** ({} files)", self.dir, self.file)
            };
            return format!("{pkg}{what} in {place}");
        }
        let pkg = if self.package.is_empty() {
            String::new()
        } else {
            format!("{}: ", self.package)
        };
        if self.kind == SymbolKind::Model {
            return format!("{} models", self.dir);
        }
        if self.file == crate::cochange::KEYS_FILE {
            return format!("keys added to {}", self.dir);
        }
        if self.kind == SymbolKind::Package {
            return if self.file == PYTHON_PACKAGE_FILE {
                "Python packages".to_string()
            } else {
                "workspace packages".to_string()
            };
        }
        if self.dir == PACKAGE_WIDE {
            let scope = if self.package.is_empty() {
                "the repo".to_string()
            } else {
                format!("{}/**", self.package)
            };
            return format!("files in {scope}");
        }
        let place = |r: &RoleSelector| {
            if r.file == "*" {
                format!("{}/**", r.dir)
            } else {
                format!("{}/** ({} files)", r.dir, r.file)
            }
        };
        let and = |items: Vec<String>| match items.split_last() {
            Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
            _ => items.join(""),
        };
        let parts = self.parts();
        // A merged card of sibling packages (`crate::mine`'s `sibling_packages`): one
        // place, in each package.
        let packages: Vec<String> = parts
            .iter()
            .map(|p| p.package.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        let pkg = if packages.len() > 1 {
            String::new()
        } else {
            pkg
        };
        let places = if packages.len() > 1 {
            format!("{} of {}", place(&parts[0]), and(packages))
        // A merged card's places ([`RoleSelector::also`]): one folder of several file
        // kinds, several folders of one file kind, or each place in full.
        } else if parts.len() > 1 && parts.iter().all(|p| p.dir == self.dir) {
            let files = and(parts.iter().map(|p| p.file.clone()).collect());
            format!("{}/** ({files} files)", self.dir)
        } else if parts.len() > 1 && parts.iter().all(|p| p.file == self.file) {
            let dirs = and(parts.iter().map(|p| format!("{}/**", p.dir)).collect());
            if self.file == "*" {
                dirs
            } else {
                format!("{dirs} ({} files)", self.file)
            }
        } else {
            and(parts.iter().map(place).collect())
        };
        // Wiring roles hold every entry kind (`*`): described like plain symbols.
        let entry = if self.entry == crate::wiring::ANY_ENTRY {
            "-"
        } else {
            self.entry.as_str()
        };
        let what = match (entry, self.kind) {
            (_, SymbolKind::Class) if self.member_kind.is_some() => {
                match self.member_kind.as_deref().unwrap_or_default() {
                    drift_core::lineage::VIEW => "view classes".to_string(),
                    drift_core::lineage::SERIALIZER => "serializers".to_string(),
                    drift_core::lineage::MODEL => "model classes".to_string(),
                    drift_core::lineage::FORM => "forms".to_string(),
                    drift_core::lineage::ADMIN => "admin classes".to_string(),
                    drift_core::lineage::INLINE => "admin inlines".to_string(),
                    drift_core::lineage::MIXIN => "mixins".to_string(),
                    drift_core::lineage::EXCEPTION => "exceptions".to_string(),
                    other => format!("{other} classes"),
                }
            }
            (_, SymbolKind::Class) if self.variety.is_some() => {
                match self.variety.as_deref().unwrap_or_default() {
                    "enum" => "enums".to_string(),
                    "namedtuple" => "named tuples".to_string(),
                    "typeddict" => "TypedDicts".to_string(),
                    "dataclass" => "dataclasses".to_string(),
                    "protocol" => "protocols".to_string(),
                    other => format!("{other} classes"),
                }
            }
            ("http", _) => "HTTP handlers".to_string(),
            ("page", _) => "pages".to_string(),
            ("layout", _) => "layouts".to_string(),
            ("server_action", _) => "server actions".to_string(),
            ("middleware", _) => "middleware".to_string(),
            ("-", SymbolKind::Component) => "components".to_string(),
            ("-", SymbolKind::Function) => "functions".to_string(),
            ("-", SymbolKind::Class) => "classes".to_string(),
            ("-", SymbolKind::Const | SymbolKind::Variable) => "exported values".to_string(),
            (_, SymbolKind::Module) => "files".to_string(),
            (e, _) => format!("{e} entry points"),
        };
        let named = self
            .export_name
            .as_ref()
            .map_or(String::new(), |n| format!(" named `{n}`"));
        format!("{pkg}{what}{named} in {places}")
    }
}

/// `dir` of a role that covers a whole package (library preferences, file facts).
pub const PACKAGE_WIDE: &str = "**";
/// Symbol name used for file-level units.
pub const FILE_UNIT: &str = "(file)";

/// What a unit is: a symbol, a whole file, a database model or a workspace package.
#[derive(Debug, Clone, Copy)]
pub enum View<'a> {
    Symbol(&'a FileFacts, &'a Symbol),
    File(&'a FileFacts),
    Model(&'a Model),
    Package(&'a PackageFacts),
}

/// One analysable unit: an exported non-test symbol, a non-test file, a model or a package.
#[derive(Debug, Clone)]
pub struct Unit<'a> {
    pub view: View<'a>,
    /// Entry-point kind for symbols, or `-`.
    pub entry: String,
    /// Role selectors, shallowest first.
    pub roles: Vec<RoleSelector>,
    /// For a plain alias of a function (`export const generateMetadata =
    /// generateReferenceMetadata`, [`FunctionAliases`]): the function it names. The
    /// unit is a function (or component) of its own place, and what the function does
    /// is what it does ([`crate::context::RepoContext::alias_target`]).
    pub alias: Option<(&'a FileFacts, &'a Symbol)>,
}

impl Unit<'_> {
    pub fn path(&self) -> String {
        match self.view {
            View::Symbol(f, _) | View::File(f) => f.path.clone(),
            View::Model(m) => m.path.clone(),
            View::Package(p) => package_json_path(p),
        }
    }

    pub fn name(&self) -> &str {
        match self.view {
            View::Symbol(_, s) => &s.name,
            View::File(_) => FILE_UNIT,
            View::Model(m) => &m.name,
            View::Package(p) => &p.name,
        }
    }

    pub fn line(&self) -> u32 {
        match self.view {
            View::Symbol(_, s) => s.line,
            View::File(_) | View::Package(_) => 1,
            View::Model(m) => m.line,
        }
    }

    pub fn kind(&self) -> SymbolKind {
        match self.view {
            View::Symbol(_, s) => self.alias.map_or(s.kind, |(_, t)| t.kind),
            View::File(_) => SymbolKind::Module,
            View::Model(_) => SymbolKind::Model,
            View::Package(_) => SymbolKind::Package,
        }
    }

    /// `drift-ignore` suppressions the facts carry: those of a symbol, read from the
    /// comment block directly above its declaration. A file, a model or a package has
    /// none in the facts: its `drift-ignore` comments (the file's header, the line of
    /// the import a layering rule is about, the block above a model) are read from the
    /// file itself once a check is done ([`apply_file_ignores`]).
    pub fn suppressions(&self) -> &[String] {
        match self.view {
            View::Symbol(_, s) => &s.suppressions,
            _ => &[],
        }
    }

    /// Stable key `path#name`.
    pub fn key(&self) -> String {
        format!("{}#{}", self.path(), self.name())
    }

    /// A key of the unit that does not name where it is: what survives its file moving
    /// or being renamed, or the symbol being renamed, so a baselined violation that
    /// moved is still the old one ([`crate::policy::Lock::baseline_moved`]). `about` is
    /// what the rule is about in the unit, when the rule says (the module a layering
    /// rule's import names, [`crate::mine::offending_import`]).
    ///
    /// A symbol is its body as Drift read it: its kind and the facts of what it does
    /// (wrappers, calls, rendered components, keys passed, control flow, thrown classes,
    /// environment reads, risky operations, the order of its calls, decorator
    /// arguments, how many string literals), with references into its own file written
    /// without the file's path. The facts hold no text of the body, so this is the
    /// normalised body Drift has; the name and line are left out. A file is its
    /// exported names, the names of the symbols it declares, the packages it imports
    /// (`pkg:…`: a module in the repository is named by its path, which a move
    /// changes), its directives and `about`; a model its source and fields; a package
    /// its name and scripts. 16 hex digits of a BLAKE3 hash.
    ///
    /// Two units collide when Drift read the same of both: identical handlers, or two
    /// files (`page.tsx` beside `page.tsx`) that declare and import the same. So a
    /// fingerprint alone never says a unit moved: [`crate::policy::Lock::baseline_moved`]
    /// also asks for the same name, the old member known to be gone, and one gone
    /// member for one new violation.
    pub fn fingerprint(&self, about: Option<&str>) -> String {
        let mut parts: Vec<String> = Vec::new();
        match self.view {
            View::Symbol(f, s) => {
                let own = format!("{}#", f.path);
                let local = |x: &str| -> String {
                    match x.strip_prefix(own.as_str()) {
                        Some(rest) => format!("#{rest}"),
                        None => x.to_string(),
                    }
                };
                parts.push(format!("symbol {:?}", s.kind));
                for w in &s.wraps {
                    parts.push(format!("wrap {:?} {}", w.kind, local(w.wrapper.as_str())));
                }
                let lists: [(&str, &Vec<String>); 9] = [
                    ("call", &s.calls),
                    ("render", &s.renders),
                    ("arg", &s.args),
                    ("control", &s.controls),
                    ("throw", &s.throws),
                    ("read", &s.reads),
                    ("sink", &s.sinks),
                    ("order", &s.order),
                    ("decorator", &s.decorator_args),
                ];
                for (label, list) in lists {
                    for x in list {
                        parts.push(format!("{label} {}", local(x.as_str())));
                    }
                }
                parts.push(format!("strings {}", s.string_literals));
            }
            View::File(f) => {
                parts.push("file".to_string());
                let mut names: Vec<&str> = f.exports.iter().map(|e| e.name.as_str()).collect();
                names.sort_unstable();
                names.dedup();
                for n in names {
                    parts.push(format!("export {n}"));
                }
                let mut declared: Vec<&str> = f.symbols.iter().map(|s| s.name.as_str()).collect();
                declared.sort_unstable();
                declared.dedup();
                for n in declared {
                    parts.push(format!("declares {n}"));
                }
                let mut packages: Vec<&str> = f
                    .imports
                    .iter()
                    .map(|i| i.module.as_str())
                    .filter(|m| m.starts_with("pkg:"))
                    .collect();
                packages.sort_unstable();
                packages.dedup();
                for m in packages {
                    parts.push(format!("import {m}"));
                }
                for d in &f.directives {
                    parts.push(format!("directive {d}"));
                }
            }
            View::Model(m) => {
                parts.push(format!("model {}", m.source));
                for x in &m.fields {
                    parts.push(format!("field {x}"));
                }
            }
            View::Package(p) => {
                parts.push(format!("package {}", p.name));
                for x in &p.scripts {
                    parts.push(format!("script {x}"));
                }
            }
        }
        if let Some(a) = about {
            parts.push(format!("about {a}"));
        }
        let h = blake3::hash(parts.join("\n").as_bytes()).to_hex();
        h[..16].to_string()
    }

    /// True when the unit is a member of `role` ([`RoleSelector::includes`]).
    pub fn in_role(&self, role: &RoleSelector) -> bool {
        match self.view {
            View::Symbol(f, _) | View::File(f) => role.includes(&self.roles, &f.path),
            View::Model(_) | View::Package(_) => self.roles.contains(role),
        }
    }

    /// True when the unit is a member of a convention's frozen `role`, read as its
    /// `selector_version` says ([`crate::policy::Convention::selector_version`], [`Legacy`]):
    /// a selector written before reserved exports (version 1) or member kinds (version
    /// 2) had roles of their own also holds the members of those roles at its place, as
    /// it did when it was accepted.
    pub fn in_convention_role(&self, role: &RoleSelector, selector_version: u32) -> bool {
        if self.in_role(role) {
            return true;
        }
        let legacy = Legacy::of(role, selector_version);
        match self.view {
            View::Symbol(f, _) if legacy.any() => {
                legacy.applies_to(&self.roles) && role.includes(&legacy.strip(&self.roles), &f.path)
            }
            _ => false,
        }
    }
}

/// The convention id of a `drift-ignore <id>: <reason>` in `line`, when it is in a
/// comment (after `//`, `#`, `--`, `/*` or a block comment's `*`, or, `in_block`, on a
/// line inside a block comment) and gives a reason. The same form the parsers read
/// above a declaration: an id of `D-` and six hex digits, a reason that is not empty.
fn ignore_in(line: &str, in_block: bool) -> Option<String> {
    let at = line.find("drift-ignore ")?;
    let before = line[..at].trim_end();
    let in_comment = ["//", "#", "--", "/*", "*"]
        .iter()
        .any(|m| before.ends_with(m))
        || (in_block && before.is_empty());
    if !in_comment {
        return None;
    }
    let rest = &line[at + "drift-ignore ".len()..];
    let (id, reason) = rest.split_once(':')?;
    let id = id.trim();
    let reason = reason.trim().trim_end_matches("*/").trim();
    let valid = id.len() == 8
        && id.starts_with("D-")
        && id[2..].bytes().all(|b| b.is_ascii_hexdigit());
    (valid && !reason.is_empty()).then(|| id.to_string())
}

/// A line that only states a directive or a docstring (`"use client";`, `'use strict'`,
/// `"""Views."""`): part of a file's header, not its code.
fn directive_line(t: &str) -> bool {
    let t = t.trim_end_matches(';').trim_end();
    t.len() >= 2
        && ((t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')))
}

/// The convention ids a file's header suppresses: `drift-ignore <id>: <reason>` in the
/// comments before its first line of code (blank lines, a `#!` line, directives and a
/// one-line docstring may come between them). A comment that covers the whole file is
/// one a reviewer sees at the top of it. Sorted.
pub fn header_suppressions(text: &str) -> Vec<String> {
    // A byte-order mark (Windows editors write one) is not code: the header starts after it.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut out = Vec::new();
    let mut in_block = false;
    for (n, line) in text.lines().enumerate() {
        let t = line.trim();
        if in_block {
            out.extend(ignore_in(t, true));
            if t.contains("*/") {
                in_block = false;
            }
            continue;
        }
        if t.is_empty() || (n == 0 && t.starts_with("#!")) || directive_line(t) {
            continue;
        }
        if t.starts_with("//") || t.starts_with('#') || t.starts_with("--") {
            out.extend(ignore_in(t, false));
            continue;
        }
        if t.starts_with("/*") {
            out.extend(ignore_in(t, false));
            in_block = !t.contains("*/");
            continue;
        }
        break;
    }
    out.sort();
    out.dedup();
    out
}

/// The convention ids suppressed at `line` (1-based) of `text`: a `drift-ignore` comment
/// at the end of that line, or in the comment lines directly above it (the import a
/// layering rule is about, a model's declaration). Sorted.
pub fn suppressions_at(text: &str, line: u32) -> Vec<String> {
    // A byte-order mark is not code (and not a line): the comment on line 1 starts after it.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    let Some(i) = (line as usize)
        .checked_sub(1)
        .filter(|i| *i < lines.len())
    else {
        return out;
    };
    out.extend(ignore_in(lines[i], false));
    let mut j = i;
    while j > 0 {
        j -= 1;
        let t = lines[j].trim();
        let comment = t.starts_with("//")
            || t.starts_with('#')
            || t.starts_with("--")
            || t.starts_with("/*")
            || t.starts_with('*');
        if !comment {
            break;
        }
        out.extend(ignore_in(t, t.starts_with('*')));
    }
    out.sort();
    out.dedup();
    out
}

/// Mark suppressed each violation of a file, a model or a package that a `drift-ignore`
/// comment in its file covers: one in the file's header ([`header_suppressions`]), or
/// for a layering violation one on the line of the import it is about, or for a model
/// one directly above its declaration ([`suppressions_at`]). The facts carry the
/// comments of declarations only ([`Unit::suppressions`]), so these are read from the
/// files under `root`, after the check, as the imports' lines are
/// ([`crate::check::locate_imports`]). A file that cannot be read suppresses nothing; a
/// manifest without comments (`package.json`) never does. Wiring advice and promoted
/// practices are left as they are: their comments are their declarations'.
pub fn apply_file_ignores(report: &mut crate::check::CheckReport, root: &std::path::Path) {
    let mut texts: BTreeMap<String, Option<String>> = BTreeMap::new();
    for v in &mut report.violations {
        if v.suppressed
            || v.wire.is_some()
            || v.practice.is_some()
            || matches!(v.extent, crate::check::Extent::Symbol { .. })
        {
            continue;
        }
        let text = texts.entry(v.path.clone()).or_insert_with(|| {
            drift_core::fsutil::read_regular_to_string(
                &root.join(&v.path),
                drift_core::fsutil::MAX_CONFIG_BYTES,
            )
            .ok()
        });
        let Some(text) = text.as_deref() else {
            continue;
        };
        let at = match (&v.import, v.extent) {
            (Some(hit), _) if hit.line > 0 => suppressions_at(text, hit.line),
            (_, crate::check::Extent::Model { start, .. }) => suppressions_at(text, start),
            _ => Vec::new(),
        };
        if at.contains(&v.id) || header_suppressions(text).contains(&v.id) {
            v.suppressed = true;
        }
    }
}

/// How a convention's frozen `role` is read for its `selector_version`
/// ([`crate::policy::SELECTOR_VERSION`]): which roles of their own, added after it was
/// written, it still holds at its place.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct Legacy {
    /// Written before reserved exports had roles of their own (version 1): it names
    /// no reserved export, so it holds the reserved exports at its place too.
    pub export_names: bool,
    /// Written before member kinds had roles of their own (versions 1 and 2): it names
    /// no member kind, so it holds the members of every kind at its place too.
    pub member_kinds: bool,
}

impl Legacy {
    pub fn of(role: &RoleSelector, selector_version: u32) -> Self {
        Legacy {
            export_names: selector_version < 2 && role.export_name.is_none(),
            member_kinds: selector_version < 3 && role.member_kind.is_none(),
        }
    }

    /// True when the selector reads any role as it was before.
    pub fn any(self) -> bool {
        self.export_names || self.member_kinds
    }

    /// True when a unit with `roles` has one of the roles this reading sets aside.
    fn applies_to(self, roles: &[RoleSelector]) -> bool {
        roles.iter().any(|r| {
            (self.export_names && r.export_name.is_some())
                || (self.member_kinds && r.member_kind.is_some())
        })
    }

    /// `roles` as they were before: the reserved export names and member kinds this
    /// reading sets aside, cleared.
    pub fn strip(self, roles: &[RoleSelector]) -> Vec<RoleSelector> {
        roles
            .iter()
            .map(|r| RoleSelector {
                export_name: if self.export_names {
                    None
                } else {
                    r.export_name.clone()
                },
                member_kind: if self.member_kinds {
                    None
                } else {
                    r.member_kind.clone()
                },
                ..r.clone()
            })
            .collect()
    }
}

/// A convention's `role` is read as written before reserved exports or member kinds
/// had roles of their own ([`Legacy`]).
pub fn reads_as_legacy(role: &RoleSelector, selector_version: u32) -> bool {
    Legacy::of(role, selector_version).any()
}

/// `units` with the roles they had before the roles `legacy` sets aside: the members
/// of a role among them are the members a convention read that way had when it was
/// accepted, for every lookup of them (the classes that follow its rule, the members
/// that carry an opt-out decorator). `None` when no unit has such a role: the units
/// then read as they are.
pub fn units_before<'a>(units: &[Unit<'a>], legacy: Legacy) -> Option<Vec<Unit<'a>>> {
    if !legacy.any() || !units.iter().any(|u| legacy.applies_to(&u.roles)) {
        return None;
    }
    Some(
        units
            .iter()
            .map(|u| {
                if legacy.applies_to(&u.roles) {
                    Unit {
                        roles: legacy.strip(&u.roles),
                        ..u.clone()
                    }
                } else {
                    u.clone()
                }
            })
            .collect(),
    )
}

/// The manifest a package's facts come from: `<path>/package.json`, or the Python
/// manifest the facts name (`pyproject.toml`, `requirements.txt`).
pub fn package_json_path(p: &PackageFacts) -> String {
    if !p.manifest.is_empty() {
        p.manifest.clone()
    } else if p.path.is_empty() {
        "package.json".to_string()
    } else {
        format!("{}/package.json", p.path)
    }
}

fn model_role(source: &str) -> RoleSelector {
    RoleSelector {
        package: String::new(),
        dir: source.to_string(),
        file: "(model)".to_string(),
        entry: "-".to_string(),
        kind: SymbolKind::Model,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    }
}

/// `RoleSelector::file` of the Python package role. npm and Python packages are
/// separate roles: an npm convention (a `clean` script) says nothing about a
/// `pyproject.toml`, and neither ecosystem counts toward the other's evidence.
pub const PYTHON_PACKAGE_FILE: &str = "pyproject.toml";

/// True for a Python package (`pyproject.toml` or `requirements*.txt`), false for npm.
pub fn is_python_package(p: &PackageFacts) -> bool {
    !p.manifest.is_empty()
}

fn package_role(python: bool) -> RoleSelector {
    RoleSelector {
        package: String::new(),
        dir: ".".to_string(),
        file: if python {
            PYTHON_PACKAGE_FILE
        } else {
            "package.json"
        }
        .to_string(),
        entry: "-".to_string(),
        kind: SymbolKind::Package,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    }
}

/// True for test, spec, story and fixture files, which form no production role.
pub fn is_test_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let file = lower.rsplit('/').next().unwrap_or(&lower);
    file.contains(".test.")
        || file.contains(".spec.")
        // Python: pytest/unittest modules, fixtures and Django's `tests.py`.
        || (file.starts_with("test_") && file.ends_with(".py"))
        || file.ends_with("_test.py")
        || file == "conftest.py"
        || file == "tests.py"
        // A Python `testing` package holds test support (`utilities/testing/views.py`
        // with base test cases), as `django.test` and `numpy.testing` do.
        || (file.ends_with(".py")
            && lower
                .rsplit_once('/')
                .is_some_and(|(dir, _)| dir.split('/').any(|d| d == "testing")))
        || file.contains(".stories.")
        || file.contains(".e2e.")
        || lower.split('/').any(|d| {
            matches!(
                d,
                "__tests__"
                    | "__stories__"
                    | "__mocks__"
                    | "tests"
                    | "test"
                    | "e2e"
                    | "fixtures"
                    | "__fixtures__"
                    | "cypress"
                    | "playwright"
            )
        })
}

/// Directory names that hold demonstration code: example apps, samples, demos and
/// playgrounds show how to use a project, they are not the project.
const DEMO_DIRS: &[&str] = &[
    "example",
    "examples",
    "sample",
    "samples",
    "demo",
    "demos",
    "playground",
    "playgrounds",
];

/// A directory named like an integration-test suite. Many teams also use `integration/`
/// for production code (third-party integrations), so it only counts when it holds tests.
const INTEGRATION_DIR: &str = drift_core::INTEGRATION_DIR;

/// Directory segments of `path` below `package` (file name excluded), not abstracted.
fn segments_below<'p>(path: &'p str, package: &str) -> Vec<&'p str> {
    let rel = if package.is_empty() {
        path
    } else {
        path.strip_prefix(package)
            .map_or(path, |r| r.trim_start_matches('/'))
    };
    let mut segs: Vec<&str> = rel.split('/').collect();
    segs.pop();
    segs
}

/// Non-production code that is not named like a test: demonstration code and
/// integration-test fixtures. The rule, by position so that a production route or
/// component folder that happens to be called `examples` deep inside an app is kept:
///
/// - a package that lives inside an example/sample/demo/playground directory
///   (`examples/next-app`, `sample/01-cats-app`);
/// - a top-level example/sample/demo/playground directory of a package or of the
///   repo (`examples/`, `packages/sdk/examples/`), but not one deeper inside its
///   source (`apps/www/app/examples/page.tsx` is a real route);
/// - a top-level `integration/` directory of a package or of the repo whose test
///   files are mostly standalone, i.e. not unit tests next to a source file of the
///   same stem (an integration suite: its helpers and fixture apps are test code
///   too). A production `integration/slack/client.ts` with `client.test.ts` beside
///   it stays production.
///
/// Neither mining nor `check` looks at these files: accepted conventions do not
/// apply to them.
pub struct NonProduction {
    /// `integration` directories (repo-relative, with trailing `/`) that hold tests.
    integration_suites: std::collections::BTreeSet<String>,
}

impl NonProduction {
    pub fn learn(repo: &RepoFacts) -> Self {
        // Every analysed file: a single-file scan carries the other files below an
        // `integration` directory, the only ones this reads, as `integration_files`.
        let scanned: std::collections::BTreeSet<&str> =
            repo.files.iter().map(|f| f.path.as_str()).collect();
        let files: Vec<(&str, &str)> = repo
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.package.as_str()))
            .chain(
                repo.integration_files
                    .iter()
                    .filter(|f| !scanned.contains(f.path.as_str()))
                    .map(|f| (f.path.as_str(), f.package.as_str())),
            )
            .collect();
        // Source files by (directory, stem), to tell a co-located unit test
        // (`client.test.ts` next to `client.ts`) from a standalone suite test.
        let sources: std::collections::BTreeSet<(&str, &str)> = files
            .iter()
            .filter(|(path, _)| !is_test_path(path))
            .map(|(path, _)| (path.rsplit_once('/').map_or("", |(d, _)| d), stem(path)))
            .collect();
        let colocated = |path: &str| {
            let dir = path.rsplit_once('/').map_or("", |(d, _)| d);
            let parent = dir.strip_suffix("/__tests__").unwrap_or(dir);
            let stem = tested_stem(path);
            sources.contains(&(dir, stem)) || sources.contains(&(parent, stem))
        };
        // (standalone, co-located) test files per top-level integration directory.
        let mut tests: BTreeMap<String, (usize, usize)> = BTreeMap::new();
        for &(path, package) in &files {
            if !is_test_path(path) {
                continue;
            }
            let below = segments_below(path, package);
            if below.first() == Some(&INTEGRATION_DIR) {
                let prefix = if package.is_empty() {
                    format!("{INTEGRATION_DIR}/")
                } else {
                    format!("{package}/{INTEGRATION_DIR}/")
                };
                let e = tests.entry(prefix).or_default();
                if colocated(path) {
                    e.1 += 1;
                } else {
                    e.0 += 1;
                }
            }
        }
        let integration_suites = tests
            .into_iter()
            .filter(|(_, (standalone, colocated))| standalone > colocated)
            .map(|(p, _)| p)
            .collect();
        Self { integration_suites }
    }

    /// True when `path` (in workspace package `package`) is demonstration or
    /// integration-test code.
    pub fn contains(&self, path: &str, package: &str) -> bool {
        is_demo_path(path, package)
            || self
                .integration_suites
                .iter()
                .any(|p| path.starts_with(p.as_str()))
    }

    /// The non-production directory that `path` is in, with a trailing `/`
    /// (`examples/`, `packages/sdk/playground/`, `integration/`), if any.
    pub fn dir_of(&self, path: &str, package: &str) -> Option<String> {
        let demo = |d: &str| DEMO_DIRS.contains(&d.to_ascii_lowercase().as_str());
        let pkg: Vec<&str> = package.split('/').filter(|s| !s.is_empty()).collect();
        if let Some(i) = pkg.iter().position(|d| demo(d)) {
            return Some(format!("{}/", pkg[..=i].join("/")));
        }
        if let Some(d) = segments_below(path, package).first().filter(|d| demo(d)) {
            return Some(if package.is_empty() {
                format!("{d}/")
            } else {
                format!("{package}/{d}/")
            });
        }
        self.integration_suites
            .iter()
            .find(|p| path.starts_with(p.as_str()))
            .cloned()
    }
}

/// True for demonstration code by position (see [`NonProduction`]).
pub fn is_demo_path(path: &str, package: &str) -> bool {
    let demo = |d: &str| DEMO_DIRS.contains(&d.to_ascii_lowercase().as_str());
    package.split('/').any(demo)
        || segments_below(path, package)
            .first()
            .is_some_and(|d| demo(d))
}

fn stem(path: &str) -> &str {
    let file = path.rsplit('/').next().unwrap_or(path);
    match file.find('.') {
        Some(i) => &file[..i],
        None => file,
    }
}

/// The stem of the source a test file tests: `client.test.ts` -> `client`, and for
/// pytest's names (as Python test pairing reads them) `test_slack.py` and
/// `slack_test.py` -> `slack`.
fn tested_stem(path: &str) -> &str {
    let s = stem(path);
    if !path.ends_with(".py") {
        return s;
    }
    s.strip_prefix("test_")
        .or_else(|| s.strip_suffix("_test"))
        .filter(|s| !s.is_empty())
        .unwrap_or(s)
}

/// `user.service.ts` -> `service`; `route.ts` -> none.
fn dotted_suffix(path: &str) -> Option<&str> {
    let file = path.rsplit('/').next().unwrap_or(path);
    let parts: Vec<&str> = file.split('.').collect();
    (parts.len() >= 3).then(|| parts[parts.len() - 2])
}

/// Abstract a directory segment: dynamic route segments become `[*]`.
fn abstract_segment(seg: &str) -> &str {
    if seg.starts_with('[') && seg.ends_with(']') {
        "[*]"
    } else {
        seg
    }
}

/// Learned file-kind vocabulary for a repo. Frozen into `conventions.yaml` so
/// selectors keep matching the same files as the repo grows.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileKinds {
    pub literal_stems: std::collections::BTreeSet<String>,
    pub suffixes: std::collections::BTreeSet<String>,
    /// Python file kinds qualified by a layer directory (`api/views`, see
    /// [`python_layers`]). Empty (not serialised) elsewhere, so existing selectors keep
    /// matching the same files.
    #[serde(default, skip_serializing_if = "std::collections::BTreeSet::is_empty")]
    pub layers: std::collections::BTreeSet<String>,
    /// In a repository of two or more packages, with the experimental
    /// `intra_package_layering` ([`FileKinds::learn_scoped`]): each package's own vocabulary, learned
    /// from its files alone with paths below the package root, as `--root <package>`
    /// learns it, so a stem or suffix that only other packages use often enough does not
    /// give this package's files a kind of their own (formbricks: 5 files left the
    /// `modules/**` role at the root). A file's kind is read from its package's entry
    /// ([`FileKinds::kind_of`]); the top-level sets are the repository's, as before.
    /// Empty (not serialised) in a single-package repository and in vocabularies frozen
    /// before workspaces, which keep matching the files they matched.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub packages: BTreeMap<String, FileKinds>,
    /// Test roles are formed ([`crate::shapes`], selector version 4): set by
    /// [`FileKinds::learn_with_tests`] when a person or the study asks for them, and
    /// frozen with the vocabulary so `check` reads the same roles. `false` (not
    /// serialised) everywhere else, so every vocabulary written before reads as it did.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub tests: bool,
    /// Kind roles are formed ([`crate::shapes`], selector version 4): roles of one
    /// structural kind of production unit across the repository. Set and frozen as
    /// [`FileKinds::tests`] is; `false` (not serialised) everywhere else.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub kind_roles: bool,
}

/// The stem a file kind is learned from: dynamic route files (`[id].tsx`,
/// `[...slug].ts`) are one kind, `[*]`, as their directories are.
fn kind_stem(path: &str) -> &str {
    let file = path.rsplit('/').next().unwrap_or(path);
    // A catch-all `[...slug].tsx` has dots inside its brackets.
    if file.starts_with('[') && file.contains(']') {
        return "[*]";
    }
    abstract_segment(stem(path))
}

impl FileKinds {
    /// A stem is a file kind when at least [`LITERAL_STEM_MIN`] files use it and its
    /// folders look like the instances of one pattern, which is either of:
    ///
    /// - it recurs across at least as many folders as the files that typically sit
    ///   beside it (the median size of those folders): `page` in 90 route folders of
    ///   two files each;
    /// - most of its folders are siblings, under one parent: `views.py` in each app
    ///   of `shop/` (`shop/orders`, `shop/users`, ...), however many files an app has.
    ///
    /// `invoice` in five layer folders of 30 files each, under different parents
    /// (`src/trpc/routers`, `src/rest/routers`, `src/schemas`, `db/queries`), is
    /// neither: it names a domain, and those files belong with their neighbours,
    /// not in a role of their own.
    ///
    /// A file of a kind is in its kind's roles, never in the roles of the other files
    /// of its folder (`file: "*"`). So `registry.py` in each of five apps under `shop/`
    /// is the kind `registry`: each one is left out of its app's files role, which its
    /// siblings are in, and since five is below [`crate::mine::MIN_ROLE_SIZE`] the
    /// kind's own roles are too small to form, leaving it in the package-wide role only.
    /// This is intended (a kind is mined apart from its neighbours, as `views.py` is),
    /// and changing it would change mined roles and census ids; with four such apps the
    /// stem is no kind and each `registry.py` is in its app's files role. Pinned by
    /// `map::tests::a_file_of_a_kind_is_not_in_its_siblings_files_role`.
    pub fn learn(repo: &RepoFacts) -> Self {
        Self::learn_scoped(repo, crate::workspace::intra_package_layering())
    }

    /// [`FileKinds::learn`], with per-package vocabularies ([`FileKinds::packages`]) only
    /// when `per_package`: with the experimental `intra_package_layering`, whose cards must
    /// equal `--root <package>`'s. Off (the default), the repository's vocabulary, as before
    /// workspaces: on the build set, per-package kinds reshaped roles whose new drafts took
    /// cap places from 2 cards labelled ACCEPT (documenso, novu).
    pub(crate) fn learn_scoped(repo: &RepoFacts, per_package: bool) -> Self {
        let paths: Vec<&str> = repo.files.iter().map(|f| f.path.as_str()).collect();
        let mut out = Self::learn_paths(&paths);
        if !per_package {
            return out;
        }
        let mut by_package: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        for f in &repo.files {
            let rel = if f.package.is_empty() {
                f.path.as_str()
            } else {
                f.path
                    .strip_prefix(f.package.as_str())
                    .and_then(|r| r.strip_prefix('/'))
                    .unwrap_or(&f.path)
            };
            by_package.entry(f.package.as_str()).or_default().push(rel);
        }
        if by_package.len() >= 2 {
            out.packages = by_package
                .into_iter()
                .map(|(p, paths)| (p.to_string(), Self::learn_paths(&paths)))
                .collect();
        }
        out
    }

    /// [`FileKinds::learn`] over `paths` (one vocabulary, no packages).
    fn learn_paths(paths: &[&str]) -> Self {
        let mut stems: BTreeMap<&str, (usize, std::collections::BTreeSet<&str>)> = BTreeMap::new();
        let mut dir_sizes: BTreeMap<&str, usize> = BTreeMap::new();
        let mut suffixes: BTreeMap<&str, usize> = BTreeMap::new();
        for &path in paths {
            let dir = path.rsplit_once('/').map_or("", |(d, _)| d);
            *dir_sizes.entry(dir).or_default() += 1;
            if !numbered_python_stem(path) {
                let e = stems.entry(kind_stem(path)).or_default();
                e.0 += 1;
                e.1.insert(dir);
            }
            if let Some(s) = dotted_suffix(path) {
                *suffixes.entry(s).or_default() += 1;
            }
        }
        let recurs_as_kind = |dirs: &std::collections::BTreeSet<&str>| {
            let mut sizes: Vec<usize> = dirs.iter().map(|d| dir_sizes[d]).collect();
            sizes.sort_unstable();
            if dirs.len() >= sizes[(sizes.len() - 1) / 2] {
                return true;
            }
            // Folders at the repo root share the root as their parent.
            let mut parents: BTreeMap<&str, usize> = BTreeMap::new();
            for d in dirs.iter().filter(|d| !d.is_empty()) {
                *parents
                    .entry(d.rsplit_once('/').map_or("", |(p, _)| p))
                    .or_default() += 1;
            }
            parents.values().max().is_some_and(|&n| 2 * n > dirs.len())
        };
        Self {
            literal_stems: stems
                .into_iter()
                .filter(|(s, (n, dirs))| {
                    *n >= LITERAL_STEM_MIN && *s != "index" && recurs_as_kind(dirs)
                })
                .map(|(s, _)| s.to_string())
                .collect(),
            suffixes: suffixes
                .into_iter()
                .filter(|(_, n)| *n >= SUFFIX_MIN)
                .map(|(s, _)| s.to_string())
                .collect(),
            layers: python_layers(paths),
            packages: BTreeMap::new(),
            tests: false,
            kind_roles: false,
        }
    }

    /// [`FileKinds::learn`], with test roles when `tests` is set ([`crate::shapes`]).
    pub fn learn_with_tests(repo: &RepoFacts, tests: bool) -> Self {
        Self {
            tests,
            ..Self::learn(repo)
        }
    }

    /// [`FileKinds::learn`], with test roles and kind roles as asked ([`crate::shapes`]).
    pub fn learn_with(repo: &RepoFacts, tests: bool, kind_roles: bool) -> Self {
        Self {
            tests,
            kind_roles,
            ..Self::learn(repo)
        }
    }

    /// The kind of the file at `path` in package `package` (its own vocabulary in a
    /// workspace, [`FileKinds::packages`]; the repository's otherwise).
    pub fn kind_in(&self, path: &str, package: &str) -> String {
        match self.packages.get(package) {
            Some(k) => {
                let rel = if package.is_empty() {
                    path
                } else {
                    path.strip_prefix(package)
                        .and_then(|r| r.strip_prefix('/'))
                        .unwrap_or(path)
                };
                k.kind_of(rel)
            }
            None => self.kind_of(path),
        }
    }

    pub fn kind_of(&self, path: &str) -> String {
        if let Some(layered) = python_layered_kind(path)
            && self.layers.contains(&layered)
        {
            return layered;
        }
        if let Some(s) = dotted_suffix(path)
            && self.suffixes.contains(s)
        {
            return format!("*.{s}");
        }
        // The literal stem first: vocabularies frozen before stems were normalised
        // may hold `[trpc]`.
        let st = stem(path);
        if self.literal_stems.contains(st) {
            return st.to_string();
        }
        let st = kind_stem(path);
        if self.literal_stems.contains(st) {
            st.to_string()
        } else {
            "*".to_string()
        }
    }
}

/// A Python module whose name carries a zero-padded number (`tutorial004_py310.py`,
/// `0001_initial.py`) is one numbered instance (a tutorial step, a migration), not a
/// kind of file. Other numbers name things (`sha256`, `x509`, `rfc3339`).
fn numbered_python_stem(path: &str) -> bool {
    path.ends_with(".py")
        && stem(path)
            .split(|c: char| !c.is_ascii_digit())
            .any(|run| run.len() >= 2 && run.starts_with('0'))
}

/// `parent/stem` of a Python module (`dcim/api/views.py` -> `api/views`).
fn python_layered_kind(path: &str) -> Option<String> {
    if !path.ends_with(".py") {
        return None;
    }
    let mut segs = path.rsplit('/');
    let _file = segs.next()?;
    let parent = segs.next()?;
    let st = stem(path);
    (st != "__init__").then(|| format!("{parent}/{st}"))
}

/// Python file kinds split by layer. Django-style apps repeat one layout per app:
/// `dcim/views.py` holds UI views and `dcim/api/views.py` REST views, `graphql/
/// filters.py` holds GraphQL filter types and `filters.py` django-filter classes. A
/// `parent/stem` pair used by at least [`LITERAL_STEM_MIN`] modules (so the parent
/// directory recurs across apps: a layer) whose stem is also used outside that
/// parent is a kind of its own, apart from the other modules of that stem.
fn python_layers(paths: &[&str]) -> std::collections::BTreeSet<String> {
    let mut pairs: BTreeMap<String, usize> = BTreeMap::new();
    let mut stems: BTreeMap<&str, usize> = BTreeMap::new();
    for &path in paths {
        if numbered_python_stem(path) {
            continue;
        }
        if let Some(k) = python_layered_kind(path) {
            *pairs.entry(k).or_default() += 1;
            *stems.entry(stem(path)).or_default() += 1;
        }
    }
    pairs
        .into_iter()
        .filter(|(k, n)| {
            let st = k.rsplit('/').next().unwrap_or(k);
            *n >= LITERAL_STEM_MIN && stems.get(st).is_some_and(|all| all > n)
        })
        .map(|(k, _)| k)
        .collect()
}

/// Directory segments of `path` below `package`, abstracted.
pub(crate) fn dirs_below_package<'p>(path: &'p str, package: &str) -> Vec<&'p str> {
    let rel = if package.is_empty() {
        path
    } else {
        path.strip_prefix(package)
            .map_or(path, |r| r.trim_start_matches('/'))
    };
    let mut segs: Vec<&str> = rel.split('/').collect();
    segs.pop(); // file name
    segs.into_iter().map(abstract_segment).collect()
}

/// Role selectors for a symbol at each depth.
pub fn selectors_for(
    file: &FileFacts,
    entry: &str,
    kind: SymbolKind,
    kinds: &FileKinds,
) -> Vec<RoleSelector> {
    let dirs = dirs_below_package(&file.path, &file.package);
    let file_kind = kinds.kind_in(&file.path, &file.package);
    let mut out = Vec::new();
    for depth in ROLE_DEPTHS {
        if depth > dirs.len() && depth > 1 {
            break;
        }
        let dir = dirs[..depth.min(dirs.len())].join("/");
        out.push(RoleSelector {
            package: file.package.clone(),
            dir: if dir.is_empty() { ".".to_string() } else { dir },
            file: file_kind.clone(),
            entry: entry.to_string(),
            kind,
            variety: None,
            export_name: None,
            member_kind: None,
            shape: None,
            also: vec![],
        });
    }
    if kind == SymbolKind::Module {
        out.push(RoleSelector {
            package: file.package.clone(),
            dir: PACKAGE_WIDE.to_string(),
            file: "*".to_string(),
            entry: "-".to_string(),
            kind,
            variety: None,
            export_name: None,
            member_kind: None,
            shape: None,
            also: vec![],
        });
    }
    out
}

impl RoleSelector {
    /// True when `file`/`symbol` belongs to this role (used by `check` on new code).
    pub fn matches(
        &self,
        file: &FileFacts,
        entry: &str,
        kind: SymbolKind,
        kinds: &FileKinds,
    ) -> bool {
        self.includes(&selectors_for(file, entry, kind, kinds), &file.path)
    }

    /// True when a unit of the file at `path`, whose selectors are `roles`
    /// ([`Unit::roles`]), is a member of this role.
    ///
    /// Roles are formed at [`ROLE_DEPTHS`], but mining can narrow a convention's role
    /// to the subtree its holders sit in (`crate::mine`'s `subtree`), which may be
    /// deeper: `src/runner/action-handlers/**` below the depth-2 role `src/runner/**`.
    /// Such a role holds the members of its depth-5 ancestor whose file lies under its
    /// `dir`. A shallower `dir` is an ordinary selector, matched as one.
    pub fn includes(&self, roles: &[RoleSelector], path: &str) -> bool {
        // A merged card's role holds the members of each of its parts.
        if !self.also.is_empty() {
            return self.parts().iter().any(|p| p.includes(roles, path));
        }
        if roles.contains(self) {
            return true;
        }
        let deepest = *ROLE_DEPTHS.end();
        let segs: Vec<&str> = self.dir.split('/').collect();
        if segs.len() <= deepest || self.dir == PACKAGE_WIDE {
            return false;
        }
        let top = RoleSelector {
            dir: segs[..deepest].join("/"),
            ..self.clone()
        };
        roles.contains(&top) && dirs_below_package(path, &self.package).starts_with(&segs)
    }

    /// True when a selector at the same place as `s` (its `dir` and `file`) for the file
    /// at `path` is this role's place ([`RoleSelector::includes`] for a narrowed role).
    fn same_place(&self, s: &RoleSelector, path: &str) -> bool {
        let mut s = s.clone();
        s.package.clone_from(&self.package);
        s.entry.clone_from(&self.entry);
        s.kind = self.kind;
        s.variety.clone_from(&self.variety);
        s.export_name.clone_from(&self.export_name);
        s.member_kind.clone_from(&self.member_kind);
        self.includes(std::slice::from_ref(&s), path)
    }
}

/// Where a class goes among the roles, by its kind facts ([`Symbol::traits`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Variety {
    /// A primary class (or not a class): the ordinary roles.
    Primary,
    /// A class of a special kind: roles of that kind only.
    Special(&'static str),
    /// In no role: base classes, mixins and abstract classes are not peers of the
    /// classes that extend them, and a view class is represented by its handler
    /// methods. They still count in the repo-wide baseline.
    Excluded,
}

/// Kinds that form roles of their own, by precedence.
const SPECIAL_KINDS: &[&str] = &[
    traits::ENUM,
    traits::NAMEDTUPLE,
    traits::TYPEDDICT,
    traits::DATACLASS,
];

/// The [`Variety`] of a symbol. Only classes with kind facts are affected; a
/// language that records no kinds keeps every class primary.
pub fn class_variety(symbol: &Symbol) -> Variety {
    // A type variable is typing, not code: in no role, whatever its symbol kind.
    if symbol.traits.iter().any(|t| t == traits::TYPE_VAR) {
        return Variety::Excluded;
    }
    if symbol.kind != SymbolKind::Class || symbol.traits.is_empty() {
        return Variety::Primary;
    }
    let has = |t: &str| symbol.traits.iter().any(|x| x == t);
    if has(traits::VIEW) {
        return Variety::Excluded;
    }
    if has(traits::PROTOCOL) {
        return Variety::Special(traits::PROTOCOL);
    }
    if has(traits::BASE) || has(traits::ABSTRACT) {
        return Variety::Excluded;
    }
    SPECIAL_KINDS
        .iter()
        .find(|k| has(k))
        .map_or(Variety::Primary, |k| Variety::Special(k))
}

/// Role selectors of a symbol unit: [`selectors_for`], by its [`Variety`].
pub fn symbol_selectors(
    file: &FileFacts,
    symbol: &Symbol,
    entry: &str,
    kinds: &FileKinds,
) -> Vec<RoleSelector> {
    match class_variety(symbol) {
        Variety::Primary => {
            let mut out = place_selectors(file, symbol, entry, symbol.kind, kinds);
            if let Some(k) = member_kind(symbol, entry) {
                for r in &mut out {
                    r.member_kind = Some(k.to_string());
                }
            }
            out
        }
        Variety::Excluded => vec![],
        Variety::Special(v) => place_selectors(file, symbol, entry, symbol.kind, kinds)
            .into_iter()
            .map(|mut r| {
                r.variety = Some(v.to_string());
                r
            })
            .collect(),
    }
}

/// The member kind of a symbol's roles ([`RoleSelector::member_kind`]): a primary class
/// that is not an entry point, of a framework lineage its traits record
/// ([`drift_core::lineage::of_traits`]; Python only). An entry point's role is keyed by
/// its entry kind already.
pub fn member_kind(symbol: &Symbol, entry: &str) -> Option<&'static str> {
    (symbol.kind == SymbolKind::Class && entry == "-")
        .then(|| drift_core::lineage::of_traits(&symbol.traits))
        .flatten()
}

/// [`selectors_for`] a symbol of `file` as a unit of `kind`, with the reserved name it
/// is exported under, if any ([`RoleSelector::export_name`]).
fn place_selectors(
    file: &FileFacts,
    symbol: &Symbol,
    entry: &str,
    kind: SymbolKind,
    kinds: &FileKinds,
) -> Vec<RoleSelector> {
    let reserved = (entry == "-")
        .then(|| reserved_export(file, symbol))
        .flatten();
    let mut out = selectors_for(file, entry, kind, kinds);
    if let Some(n) = reserved {
        for r in &mut out {
            r.export_name = Some(n.to_string());
        }
    }
    out
}

/// The name a framework reserves for exports of `file` that `symbol` is exported
/// under: one of [`crate::frameworks::NEXT_RESERVED_EXPORTS`] in a file a Next.js
/// adapter found entry points in (as [`crate::mine::framework_reserved_name`] reads
/// one), its exported names first. An entry point is not asked: its role is keyed by
/// its entry kind already.
pub fn reserved_export<'s>(file: &FileFacts, symbol: &'s Symbol) -> Option<&'s str> {
    if !file.entry_points.iter().any(|e| e.adapter == "nextjs") {
        return None;
    }
    let reserved = |n: &&String| crate::frameworks::NEXT_RESERVED_EXPORTS.contains(&n.as_str());
    symbol
        .exported_as
        .iter()
        .find(reserved)
        .or_else(|| std::iter::once(&symbol.name).find(reserved))
        .map(String::as_str)
}

/// Entry-point kind of `symbol` in `file`, or `-`.
pub fn entry_of(file: &FileFacts, symbol: &Symbol) -> String {
    file.entry_points
        .iter()
        .find(|e| symbol.exported_as.contains(&e.symbol))
        .map_or_else(|| "-".to_string(), |e| e.kind.clone())
}

/// Model sources of Python ORMs (`Model::source`), whose models live in Python modules.
pub const PYTHON_MODEL_SOURCES: &[&str] = &["django", "sqlalchemy", "sqlmodel"];

/// Where Django and SQLAlchemy projects keep their models: a `models.py` module or a
/// module directly in a `models/` package (`models/user.py`; not deeper, so ML code
/// under `models/llama/layers.py` is not taken for ORM models).
pub fn is_python_model_path(rel: &str) -> bool {
    let mut parts = rel.rsplit('/');
    let file = parts.next().unwrap_or_default();
    file.ends_with(".py") && (file == "models.py" || parts.next() == Some("models"))
}

/// A file whose content is a package manifest: `package.json`, or a Python
/// `pyproject.toml` or `requirements*.txt`.
pub fn is_package_manifest(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name == "package.json"
        || name == "pyproject.toml"
        || (name.starts_with("requirements") && name.ends_with(".txt"))
}

/// True when a convention's role covers the file at `rel` (which may not exist yet).
/// `existing` is the file's facts and `models` the database models it declares, when
/// known (an existing file, or the planned content of a new one).
pub fn role_covers_path(
    role: &RoleSelector,
    rel: &str,
    existing: Option<&FileFacts>,
    models: Option<&[Model]>,
    kinds: &FileKinds,
) -> bool {
    covers_path(role, Legacy::default(), rel, existing, models, kinds)
}

/// [`role_covers_path`] for a convention's frozen `role`, read as its
/// `selector_version` says ([`Unit::in_convention_role`]).
pub fn convention_role_covers_path(
    role: &RoleSelector,
    selector_version: u32,
    rel: &str,
    existing: Option<&FileFacts>,
    models: Option<&[Model]>,
    kinds: &FileKinds,
) -> bool {
    covers_path(
        role,
        Legacy::of(role, selector_version),
        rel,
        existing,
        models,
        kinds,
    )
}

fn covers_path(
    role: &RoleSelector,
    legacy: Legacy,
    rel: &str,
    existing: Option<&FileFacts>,
    models: Option<&[Model]>,
    kinds: &FileKinds,
) -> bool {
    // A legacy selector holds a symbol by its selectors as they were ([`Legacy`]).
    let holds = |sel: Vec<RoleSelector>, path: &str| {
        role.includes(&sel, path) || (legacy.any() && role.includes(&legacy.strip(&sel), path))
    };
    match role.kind {
        SymbolKind::Model => {
            return match role.dir.as_str() {
                "prisma" => rel.ends_with(".prisma"),
                "sql" => rel.ends_with(".sql"),
                // Django, SQLAlchemy, SQLModel: the file declares models of the role's
                // ORM, or, when what it declares is unknown, it is where models live.
                d if PYTHON_MODEL_SOURCES.contains(&d) => match models {
                    Some(ms) => ms.iter().any(|m| m.source == d),
                    None => is_python_model_path(rel),
                },
                _ => {
                    existing.is_some_and(|f| f.symbols.iter().any(|s| s.name.ends_with("Table")))
                        || rel.contains("schema")
                }
            };
        }
        SymbolKind::Package => {
            let npm = rel == "package.json" || rel.ends_with("/package.json");
            return is_package_manifest(rel) && (npm == (role.file != PYTHON_PACKAGE_FILE));
        }
        _ => {}
    }
    // A kind role covers production files of its kind ([`crate::shapes`]). For an
    // existing file its kind is read from its facts with direct bases only (`check`
    // reads base chains through the whole repository's units); for a new file, from
    // its path.
    if role.shape.is_some() && !crate::shapes::is_test_role(role) {
        if !kinds.kind_roles || is_test_path(rel) {
            return false;
        }
        let idx = crate::shapes::ClassIndex::default();
        return match existing {
            Some(f) => {
                crate::shapes::kind_of_file(f).is_some_and(|k| {
                    role.includes(
                        &[crate::shapes::kind_selector(&k, "-", SymbolKind::Module)],
                        rel,
                    )
                }) || f.symbols.iter().any(|s| {
                    let entry = entry_of(f, s);
                    crate::shapes::kind_of_symbol(f, s, &entry, &idx).is_some_and(|k| {
                        role.includes(&[crate::shapes::kind_selector(&k, &entry, s.kind)], rel)
                    })
                })
            }
            None => {
                let probe = FileFacts {
                    path: rel.to_string(),
                    lang: if rel.ends_with(".py") { "py" } else { "ts" }.to_string(),
                    ..Default::default()
                };
                role.kind == SymbolKind::Module
                    && crate::shapes::kind_of_file(&probe).is_some_and(|k| {
                        role.includes(
                            &[crate::shapes::kind_selector(&k, "-", SymbolKind::Module)],
                            rel,
                        )
                    })
            }
        };
    }
    // A test role covers test files only, by the roles of their test units.
    if role.shape.is_some() {
        if !kinds.tests || !is_test_path(rel) {
            return false;
        }
        return match existing {
            Some(f) => {
                role.includes(&test_selectors(f, SymbolKind::Module, kinds), &f.path)
                    || f.symbols
                        .iter()
                        .any(|s| role.includes(&test_selectors(f, s.kind, kinds), &f.path))
            }
            None => {
                let probe = FileFacts {
                    path: rel.to_string(),
                    lang: if rel.ends_with(".py") { "py" } else { "ts" }.to_string(),
                    package: if role.package == crate::shapes::ANY_PACKAGE {
                        String::new()
                    } else {
                        role.package.clone()
                    },
                    ..Default::default()
                };
                (role.package == crate::shapes::ANY_PACKAGE
                    || role.package.is_empty()
                    || rel.starts_with(&format!("{}/", role.package)))
                    && test_selectors(&probe, role.kind, kinds)
                        .iter()
                        .any(|s| role.includes(std::slice::from_ref(s), rel))
            }
        };
    }
    match existing {
        Some(f) => {
            role.matches(f, "-", SymbolKind::Module, kinds)
                || f.symbols.iter().any(|s| {
                    let entry = entry_of(f, s);
                    holds(symbol_selectors(f, s, &entry, kinds), &f.path)
                        // A plain alias may be a function of the role ([`FunctionAliases`]):
                        // what it names is in another file, which these facts may not hold.
                        || (plain_alias_of(s).is_some()
                            && matches!(role.kind, SymbolKind::Function | SymbolKind::Component)
                            && holds(place_selectors(f, s, &entry, role.kind, kinds), &f.path))
                })
        }
        // New file: match on directory and file kind only.
        None => {
            let probe = FileFacts {
                path: rel.to_string(),
                package: role.package.clone(),
                ..Default::default()
            };
            (role.package.is_empty() || rel.starts_with(&format!("{}/", role.package)))
                && selectors_for(&probe, &role.entry, role.kind, kinds)
                    .iter()
                    .any(|s| role.same_place(s, rel))
        }
    }
}

/// Longest chain of plain aliases [`FunctionAliases`] follows (`a = b`, `b = f`).
const MAX_ALIAS_DEPTH: usize = 8;

/// The in-repo binding a symbol is a plain alias of: a `const` or `let` bound to a name
/// and nothing more (`export const generateMetadata = generateReferenceMetadata`), as
/// [`Symbol::derives_from`] records it. Not a binding reached through a member
/// (`handlers.GET`), built by builder steps (`authed.input(s)`) or a call, nor one of a
/// package or a global.
fn plain_alias_of(s: &Symbol) -> Option<&str> {
    if !matches!(s.kind, SymbolKind::Const | SymbolKind::Variable) {
        return None;
    }
    let (_, name) = s.derives_from.split_once('#')?;
    (!name.is_empty() && !name.contains(['.', '('])).then_some(s.derives_from.as_str())
}

/// Plain aliases of functions: an exported `const` bound to an in-repo function or
/// component, directly or through other plain aliases ([`plain_alias_of`]). Such a
/// binding is that function, exported under another name in another place: Next.js's
/// `export const generateMetadata = generateReferenceMetadata`. It is a unit of the
/// function's kind at its own place ([`units`]), so a role of functions counts it as a
/// member, and what the function does is what it does
/// ([`crate::context::RepoContext::alias_target`]). Not an entry point
/// (`export const PUT = PATCH` in a route file): that keeps its own kind and facts, so
/// it stays in the role of its route's other handlers.
///
/// Learned from the facts' files and context files: a single-file scan links the
/// files the scanned file's aliases name and returns their functions as context, so a
/// hook sees the alias as a full scan does. A function the facts do not have (a
/// file not parsed) leaves the binding a value, in both.
pub struct FunctionAliases<'a> {
    /// `path#name` and `path#<exported name>` -> the symbol, for functions,
    /// components and plain aliases only.
    defs: BTreeMap<String, (&'a FileFacts, &'a Symbol)>,
}

impl<'a> FunctionAliases<'a> {
    pub fn learn(repo: &'a RepoFacts) -> Self {
        let mut defs = BTreeMap::new();
        let any = repo
            .files
            .iter()
            .flat_map(|f| &f.symbols)
            .any(|s| plain_alias_of(s).is_some());
        if any {
            for f in repo.files.iter().chain(&repo.context_files) {
                for s in &f.symbols {
                    let target = matches!(s.kind, SymbolKind::Function | SymbolKind::Component);
                    if !target && plain_alias_of(s).is_none() {
                        continue;
                    }
                    for n in std::iter::once(&s.name).chain(&s.exported_as) {
                        defs.entry(format!("{}#{n}", f.path)).or_insert((f, s));
                    }
                }
            }
        }
        Self { defs }
    }

    /// The function or component `s` is a plain alias of, if it is one.
    pub fn target(&self, s: &Symbol) -> Option<(&'a FileFacts, &'a Symbol)> {
        let mut r = plain_alias_of(s)?;
        for _ in 0..MAX_ALIAS_DEPTH {
            let (f, t) = *self.defs.get(r)?;
            if matches!(t.kind, SymbolKind::Function | SymbolKind::Component) {
                return Some((f, t));
            }
            r = plain_alias_of(t)?;
        }
        None
    }
}

/// All analysable units of a repo, in deterministic order: symbols, files,
/// models and workspace packages.
pub fn units<'a>(repo: &'a RepoFacts, kinds: &FileKinds) -> Vec<Unit<'a>> {
    let non_production = NonProduction::learn(repo);
    let aliases = FunctionAliases::learn(repo);
    // Kind roles ([`crate::shapes`]), only when the vocabulary has them.
    let classes = kinds
        .kind_roles
        .then(|| crate::shapes::ClassIndex::learn(repo));
    let mut out = Vec::new();
    for f in &repo.files {
        if is_test_path(&f.path) || non_production.contains(&f.path, &f.package) {
            continue;
        }
        for s in &f.symbols {
            if s.exported_as.is_empty() || s.kind == SymbolKind::Module {
                continue;
            }
            let entry = entry_of(f, s);
            // An entry point keeps its own kind and facts: its role is its route's
            // (`export const GET = handler` next to `export const POST =
            // withAuth({...})`), as it was.
            let alias = (entry == "-").then(|| aliases.target(s)).flatten();
            let mut roles = match alias {
                Some((_, t)) => place_selectors(f, s, &entry, t.kind, kinds),
                None => symbol_selectors(f, s, &entry, kinds),
            };
            if let Some(idx) = &classes
                && !roles.is_empty()
                && let Some(k) = crate::shapes::kind_of_symbol(f, s, &entry, idx)
            {
                let kind = alias.map_or(s.kind, |(_, t)| t.kind);
                roles.push(crate::shapes::kind_selector(&k, &entry, kind));
            }
            out.push(Unit {
                view: View::Symbol(f, s),
                entry,
                roles,
                alias,
            });
        }
        let mut roles = selectors_for(f, "-", SymbolKind::Module, kinds);
        if classes.is_some()
            && let Some(k) = crate::shapes::kind_of_file(f)
        {
            roles.push(crate::shapes::kind_selector(&k, "-", SymbolKind::Module));
        }
        out.push(Unit {
            view: View::File(f),
            entry: "-".to_string(),
            roles,
            alias: None,
        });
    }
    for m in &repo.models {
        out.push(Unit {
            view: View::Model(m),
            entry: "-".to_string(),
            roles: vec![model_role(&m.source)],
            alias: None,
        });
    }
    // Packages of demo and test code are not peers of the workspace's packages.
    let production = |p: &PackageFacts| {
        let manifest = package_json_path(p);
        !is_test_path(&manifest) && !non_production.contains(&manifest, &p.path)
    };
    // In a monorepo the root manifest is the workspace's, not a peer (counted per
    // ecosystem: Python projects do not make the root package.json a workspace).
    let nested = |python: bool| {
        repo.packages
            .iter()
            .filter(|p| is_python_package(p) == python && !p.path.is_empty() && production(p))
            .count()
    };
    let nested = [nested(false), nested(true)];
    for p in &repo.packages {
        let python = is_python_package(p);
        if nested[usize::from(python)] >= 2 && p.path.is_empty() {
            continue;
        }
        if !production(p) {
            continue;
        }
        out.push(Unit {
            view: View::Package(p),
            entry: "-".to_string(),
            roles: vec![package_role(python)],
            alias: None,
        });
    }
    out
}

/// The units of the test roles ([`crate::shapes`]): for every test, story and fixture
/// file outside demonstration code, its exported symbols and one unit for the module
/// itself (the symbol that holds its top-level code, when the facts record one, or the
/// file). Each is in the place roles of its folder and file kind marked with the file's
/// shape, and in the role of that shape across the repository. Empty unless the
/// vocabulary has [`FileKinds::tests`].
pub fn test_units<'a>(repo: &'a RepoFacts, kinds: &FileKinds) -> Vec<Unit<'a>> {
    if !kinds.tests {
        return vec![];
    }
    let non_production = NonProduction::learn(repo);
    let mut out = Vec::new();
    for f in &repo.files {
        if !is_test_path(&f.path) || non_production.contains(&f.path, &f.package) {
            continue;
        }
        let mut module = false;
        for s in &f.symbols {
            let top = s.kind == SymbolKind::Module;
            if !top && s.exported_as.is_empty() {
                continue;
            }
            module |= top;
            out.push(Unit {
                view: View::Symbol(f, s),
                entry: "-".to_string(),
                roles: test_selectors(f, s.kind, kinds),
                alias: None,
            });
        }
        if !module {
            out.push(Unit {
                view: View::File(f),
                entry: "-".to_string(),
                roles: test_selectors(f, SymbolKind::Module, kinds),
                alias: None,
            });
        }
    }
    out
}

/// The roles of a test unit of `kind` in `file` ([`test_units`]).
pub fn test_selectors(file: &FileFacts, kind: SymbolKind, kinds: &FileKinds) -> Vec<RoleSelector> {
    let shape = crate::shapes::test_shape(file);
    let mut out: Vec<RoleSelector> = selectors_for(file, "-", kind, kinds)
        .into_iter()
        .map(|mut r| {
            r.shape = Some(shape.clone());
            r
        })
        .collect();
    out.push(crate::shapes::selector(&shape, kind));
    out
}

/// [`units`] and, when the vocabulary has them, [`test_units`]: every unit a convention
/// may be about, for `check`.
pub fn all_units<'a>(repo: &'a RepoFacts, kinds: &FileKinds) -> Vec<Unit<'a>> {
    let mut out = units(repo, kinds);
    out.extend(test_units(repo, kinds));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_paths() {
        assert!(is_test_path("src/a.test.ts"));
        assert!(is_test_path("apps/web/tests/x.ts"));
        assert!(is_test_path("src/__tests__/a.ts"));
        assert!(is_test_path("ui/button.stories.tsx"));
        assert!(is_test_path("ui/__stories__/button.tsx"));
        assert!(!is_test_path("src/testing-utils.ts"));
        assert!(is_test_path("app/test_views.py"));
        assert!(is_test_path("app/views_test.py"));
        assert!(is_test_path("conftest.py"));
        assert!(is_test_path("blog/tests.py"));
        assert!(!is_test_path("app/testing.py"));
        assert!(is_test_path("netbox/utilities/testing/views.py"));
        assert!(!is_test_path("src/testing/helpers.ts"));
        assert!(!is_test_path("src/test_utils.ts"));
    }

    #[test]
    fn demo_and_integration_paths_by_position() {
        // Top-level demo dirs of the repo or a package, and packages inside them.
        assert!(is_demo_path("examples/basic/index.ts", ""));
        assert!(is_demo_path("examples/next/app/page.tsx", "examples/next"));
        assert!(is_demo_path("sample/01-cats/src/app.ts", "sample/01-cats"));
        assert!(is_demo_path("packages/sdk/examples/a.ts", "packages/sdk"));
        assert!(is_demo_path("playground/src/main.ts", ""));
        // A production folder named like one, deeper in an app, is kept.
        assert!(!is_demo_path("apps/www/app/examples/page.tsx", "apps/www"));
        assert!(!is_demo_path("src/components/demo/Card.tsx", ""));
        assert!(!is_demo_path("packages/sdk/src/index.ts", "packages/sdk"));

        let mut repo = RepoFacts::default();
        for (path, package) in [
            ("integration/hello/e2e/app.spec.ts", ""),
            ("integration/hello/src/app.module.ts", ""),
            ("apps/web/integration/a.integration.test.ts", "apps/web"),
            ("apps/web/integration/fixture.ts", "apps/web"),
            ("packages/types/integration/slack.ts", "packages/types"),
            ("src/services/integration/slack.ts", ""),
            // A production integration folder with co-located unit tests.
            (
                "packages/hooks/integration/slack/client.ts",
                "packages/hooks",
            ),
            (
                "packages/hooks/integration/slack/client.test.ts",
                "packages/hooks",
            ),
            ("packages/hooks/integration/github/app.ts", "packages/hooks"),
            (
                "packages/hooks/integration/github/__tests__/app.test.ts",
                "packages/hooks",
            ),
        ] {
            repo.files.push(FileFacts {
                path: path.into(),
                package: package.into(),
                ..Default::default()
            });
        }
        let np = NonProduction::learn(&repo);
        assert!(np.contains("integration/hello/src/app.module.ts", ""));
        assert!(np.contains("apps/web/integration/fixture.ts", "apps/web"));
        // `integration/` without tests is production (third-party integrations).
        assert!(!np.contains("packages/types/integration/slack.ts", "packages/types"));
        assert!(!np.contains("src/services/integration/slack.ts", ""));
        assert!(!np.contains(
            "packages/hooks/integration/slack/client.ts",
            "packages/hooks"
        ));
        assert!(!np.contains("packages/hooks/integration/github/app.ts", "packages/hooks"));
        // pytest's `test_<stem>.py` and `<stem>_test.py` beside their module are
        // co-located too.
        let mut py = RepoFacts::default();
        for path in [
            "integration/slack.py",
            "integration/test_slack.py",
            "integration/github.py",
            "integration/github_test.py",
            "integration/flows/test_end_to_end.py",
        ] {
            py.files.push(FileFacts {
                path: path.into(),
                ..Default::default()
            });
        }
        assert!(!NonProduction::learn(&py).contains("integration/slack.py", ""));
        // Mostly standalone tests: a suite.
        for path in [
            "integration/flows/test_signup.py",
            "integration/flows/test_login.py",
        ] {
            py.files.push(FileFacts {
                path: path.into(),
                ..Default::default()
            });
        }
        assert!(NonProduction::learn(&py).contains("integration/slack.py", ""));
        assert_eq!(tested_stem("integration/test_slack.py"), "slack");
        assert_eq!(tested_stem("integration/slack_test.py"), "slack");
        assert_eq!(tested_stem("integration/test_.py"), "test_");
        assert_eq!(tested_stem("src/test_utils.ts"), "test_utils");
        // The directory that makes a path non-production.
        assert_eq!(
            np.dir_of("apps/web/integration/fixture.ts", "apps/web")
                .as_deref(),
            Some("apps/web/integration/")
        );
        assert_eq!(
            np.dir_of("examples/next/app/page.tsx", "examples/next")
                .as_deref(),
            Some("examples/")
        );
        assert_eq!(
            np.dir_of("packages/sdk/examples/a.ts", "packages/sdk")
                .as_deref(),
            Some("packages/sdk/examples/")
        );
        assert_eq!(np.dir_of("src/services/integration/slack.ts", ""), None);
    }

    #[test]
    fn python_model_and_manifest_paths() {
        let role = |dir: &str, kind| RoleSelector {
            package: String::new(),
            dir: dir.into(),
            file: "(model)".into(),
            entry: "-".into(),
            kind,
            variety: None,
            export_name: None,
            member_kind: None,
            shape: None,
            also: vec![],
        };
        let kinds = FileKinds::default();
        let django = role("django", SymbolKind::Model);
        for (rel, want) in [
            ("shop/models.py", true),
            ("netbox/dcim/models/devices.py", true),
            ("app/models/__init__.py", true),
            ("ml/models/llama/layers.py", false),
            ("app/views.py", false),
            ("app/models.ts", false),
            ("docs/models/readme.md", false),
        ] {
            assert_eq!(
                role_covers_path(&django, rel, None, None, &kinds),
                want,
                "{rel}"
            );
        }
        let model = |source: &str| Model {
            path: "app/db.py".into(),
            name: "User".into(),
            source: source.into(),
            line: 1,
            fields: vec![],
        };
        // Known models decide, wherever the file is.
        assert!(role_covers_path(
            &django,
            "app/db.py",
            None,
            Some(&[model("django")]),
            &kinds
        ));
        assert!(!role_covers_path(
            &django,
            "app/models.py",
            None,
            Some(&[]),
            &kinds
        ));
        assert!(!role_covers_path(
            &role("sqlalchemy", SymbolKind::Model),
            "app/models.py",
            None,
            Some(&[model("django")]),
            &kinds
        ));
        // Prisma and Drizzle are unchanged.
        assert!(role_covers_path(
            &role("prisma", SymbolKind::Model),
            "db/schema.prisma",
            None,
            None,
            &kinds
        ));
        assert!(!role_covers_path(
            &role("drizzle", SymbolKind::Model),
            "app/models.py",
            None,
            None,
            &kinds
        ));
        let npm = package_role(false);
        let python = package_role(true);
        for (rel, npm_role, python_role) in [
            ("package.json", true, false),
            ("apps/web/package.json", true, false),
            ("libs/core/pyproject.toml", false, true),
            ("requirements-dev.txt", false, true),
            ("svc/requirements.txt", false, true),
            ("setup.py", false, false),
            ("notes.txt", false, false),
        ] {
            assert_eq!(
                role_covers_path(&npm, rel, None, None, &kinds),
                npm_role,
                "{rel}"
            );
            assert_eq!(
                role_covers_path(&python, rel, None, None, &kinds),
                python_role,
                "{rel}"
            );
        }
        let py = PackageFacts {
            path: "svc".into(),
            manifest: "svc/requirements.txt".into(),
            ..Default::default()
        };
        assert_eq!(package_json_path(&py), "svc/requirements.txt");
    }

    #[test]
    fn selectors_abstract_dynamic_segments() {
        let f = FileFacts {
            path: "apps/web/app/api/links/[id]/route.ts".into(),
            package: "apps/web".into(),
            ..Default::default()
        };
        let kinds = FileKinds::default();
        let s = selectors_for(&f, "http", SymbolKind::Function, &kinds);
        let dirs: Vec<_> = s.iter().map(|r| r.dir.as_str()).collect();
        assert_eq!(
            dirs,
            ["app", "app/api", "app/api/links", "app/api/links/[*]"]
        );
        let g = FileFacts {
            path: "apps/web/app/api/links/[other]/route.ts".into(),
            package: "apps/web".into(),
            ..Default::default()
        };
        assert!(s[3].matches(&g, "http", SymbolKind::Function, &kinds));
    }

    #[test]
    fn file_kinds_are_learned() {
        let mut repo = RepoFacts::default();
        for i in 0..6 {
            repo.files.push(FileFacts {
                path: format!("app/r{i}/route.ts"),
                ..Default::default()
            });
        }
        for i in 0..3 {
            repo.files.push(FileFacts {
                path: format!("src/u{i}.service.ts"),
                ..Default::default()
            });
        }
        repo.files.push(FileFacts {
            path: "src/misc.ts".into(),
            ..Default::default()
        });
        let k = FileKinds::learn(&repo);
        assert_eq!(k.kind_of("app/x/route.ts"), "route");
        assert_eq!(k.kind_of("src/a.service.ts"), "*.service");
        assert_eq!(k.kind_of("src/misc.ts"), "*");
    }

    fn repo_of(paths: &[String]) -> RepoFacts {
        let mut repo = RepoFacts::default();
        for p in paths {
            repo.files.push(FileFacts {
                path: p.clone(),
                ..Default::default()
            });
        }
        repo
    }

    #[test]
    fn domain_names_in_layer_folders_are_not_file_kinds() {
        // Each domain has a file in each layer folder: `invoice.ts` is used five
        // times, but always as one name among many in a folder of the same layer.
        let domains = [
            "invoice",
            "tags",
            "customers",
            "inbox",
            "reports",
            "billing",
        ];
        let layers = [
            "src/trpc/routers",
            "src/rest/routers",
            "src/schemas",
            "src/mcp/tools",
            "db/queries",
        ];
        let mut paths = Vec::new();
        for l in layers {
            for d in domains {
                paths.push(format!("{l}/{d}.ts"));
            }
        }
        // Framework file names: one per route folder.
        for i in 0..5 {
            paths.push(format!("app/api/r{i}/route.ts"));
            paths.push(format!("app/p{i}/page.tsx"));
            paths.push(format!("app/p{i}/layout.tsx"));
        }
        let k = FileKinds::learn(&repo_of(&paths));
        assert_eq!(
            k.literal_stems.iter().collect::<Vec<_>>(),
            ["layout", "page", "route"]
        );
        // So every router is in one role, whatever its file is called.
        let f = |p: &str| FileFacts {
            path: p.into(),
            ..Default::default()
        };
        assert_eq!(
            selectors_for(
                &f("src/trpc/routers/invoice.ts"),
                "rpc",
                SymbolKind::Function,
                &k
            ),
            selectors_for(
                &f("src/trpc/routers/team.ts"),
                "rpc",
                SymbolKind::Function,
                &k
            )
        );
    }

    #[test]
    fn per_app_file_names_are_file_kinds_however_many_files_an_app_has() {
        // Django: 6 apps of 9 files each. Every canonical stem is in 6 folders of
        // 9 files, so the median rule alone would reject them; the app folders are
        // siblings under `shop/`, so each stem is one kind across the apps.
        let stems = [
            "__init__",
            "admin",
            "apps",
            "models",
            "views",
            "urls",
            "serializers",
            "forms",
            "tasks",
        ];
        let mut paths = Vec::new();
        for app in ["orders", "users", "billing", "catalog", "cart", "reviews"] {
            for s in stems {
                paths.push(format!("shop/{app}/{s}.py"));
            }
        }
        paths.push("manage.py".to_string());
        let k = FileKinds::learn(&repo_of(&paths));
        let mut want: Vec<&str> = stems.to_vec();
        want.sort_unstable();
        assert_eq!(k.literal_stems.iter().collect::<Vec<_>>(), want);
        assert_eq!(k.kind_of("shop/orders/views.py"), "views");
        // Flask/FastAPI feature folders, one level deeper and with a stray module.
        let mut paths = Vec::new();
        for f in ["items", "users", "auth", "orders", "invoices"] {
            for s in [
                "routes", "schemas", "crud", "models", "deps", "utils", "service",
            ] {
                paths.push(format!("app/api/features/{f}/{s}.py"));
            }
        }
        paths.push("app/core/routes.py".to_string());
        let k = FileKinds::learn(&repo_of(&paths));
        assert_eq!(k.kind_of("app/api/features/items/routes.py"), "routes");
        assert_eq!(k.kind_of("app/api/features/items/crud.py"), "crud");
    }

    #[test]
    fn dynamic_route_file_stems_are_one_kind() {
        let mut paths = Vec::new();
        for (i, p) in ["[id]", "[slug]", "[...rest]", "[[...path]]", "[trpc]"]
            .iter()
            .enumerate()
        {
            paths.push(format!("pages/s{i}/{p}.tsx"));
        }
        let k = FileKinds::learn(&repo_of(&paths));
        assert_eq!(k.literal_stems.iter().collect::<Vec<_>>(), ["[*]"]);
        assert_eq!(k.kind_of("pages/x/[uid].tsx"), "[*]");
        // A vocabulary frozen before normalisation keeps matching its literal stem.
        let frozen = FileKinds {
            literal_stems: ["[trpc]".to_string()].into(),
            ..Default::default()
        };
        assert_eq!(frozen.kind_of("pages/api/trpc/[trpc].ts"), "[trpc]");
        assert_eq!(frozen.kind_of("pages/api/[id].ts"), "*");
    }

    #[test]
    fn python_file_kinds_by_layer() {
        let mut repo = RepoFacts::default();
        let mut add = |p: String| {
            repo.files.push(FileFacts {
                path: p,
                ..Default::default()
            })
        };
        for i in 0..6 {
            add(format!("app/a{i}/views.py"));
            add(format!("app/a{i}/api/views.py"));
            add(format!("app/a{i}/api/__init__.py"));
            add(format!("app/a{i}/graphql/types.py"));
            add(format!("web/a{i}/api/views.ts"));
            add(format!("web/a{i}/views.ts"));
            add(format!("docs/t{i}/tutorial004_py310.py"));
            add(format!("app/a{i}/migrations/0001_initial.py"));
            add(format!("app/a{i}/crypto/sha256.py"));
        }
        let k = FileKinds::learn(&repo);
        assert_eq!(k.kind_of("app/x/api/views.py"), "api/views");
        assert_eq!(k.kind_of("app/x/views.py"), "views");
        // Every `types.py` is in `graphql/`: one kind, as before.
        assert_eq!(k.kind_of("app/x/graphql/types.py"), "types");
        assert_eq!(k.kind_of("app/x/api/__init__.py"), "__init__");
        // TypeScript keeps its stems.
        assert_eq!(k.kind_of("web/x/api/views.ts"), "views");
        // Numbered modules are no kind.
        assert_eq!(k.kind_of("docs/t1/tutorial004_py310.py"), "*");
        assert_eq!(k.kind_of("app/x/migrations/0001_initial.py"), "*");
        // Numbers that name a thing are no instance number.
        assert_eq!(k.kind_of("app/x/crypto/sha256.py"), "sha256");
        // Conventions files written before layers keep their shape.
        let ts = FileKinds {
            layers: Default::default(),
            ..k.clone()
        };
        let yaml = serde_json::to_string(&ts).unwrap();
        assert!(!yaml.contains("layers"), "{yaml}");
    }

    #[test]
    fn type_variables_have_no_role() {
        let t = Symbol {
            name: "T".into(),
            kind: SymbolKind::Variable,
            traits: vec![traits::TYPE_VAR.into()],
            ..Default::default()
        };
        assert_eq!(class_variety(&t), Variety::Excluded);
    }

    #[test]
    fn file_kinds_are_learned_per_package_in_a_workspace() {
        // `*.service` is a kind of package `a` (3 files) but not of `b` (2): at the root,
        // the repository's 5 files would make it one in `b` too, unlike `--root b`.
        let file = |path: &str, package: &str| FileFacts {
            path: path.to_string(),
            package: package.to_string(),
            ..Default::default()
        };
        let repo = RepoFacts {
            files: vec![
                file("a/src/x.service.ts", "a"),
                file("a/src/y.service.ts", "a"),
                file("a/src/z.service.ts", "a"),
                file("b/src/p.service.ts", "b"),
                file("b/src/q.service.ts", "b"),
            ],
            ..Default::default()
        };
        let k = FileKinds::learn_scoped(&repo, true);
        assert_eq!(k.kind_in("a/src/x.service.ts", "a"), "*.service");
        assert_eq!(k.kind_in("b/src/p.service.ts", "b"), "*");
        // Without the experimental feature: the repository's vocabulary, as before.
        let repo_wide = FileKinds::learn_scoped(&repo, false);
        assert!(repo_wide.packages.is_empty());
        assert_eq!(repo_wide.kind_in("b/src/p.service.ts", "b"), "*.service");
        // One package: no per-package vocabularies, so frozen files keep their shape.
        let one = RepoFacts {
            files: repo.files[..3].to_vec(),
            ..Default::default()
        };
        let k = FileKinds::learn_scoped(&one, true);
        assert!(k.packages.is_empty());
        assert!(!serde_json::to_string(&k).unwrap().contains("packages"));
    }
}
