//! Shared parts of a role: the helpers and fragments the members are built from,
//! which sit beside them but are not members themselves.
//!
//! "Templates in `emails/` render inside `<BaseEmailWrapper>`" is about the templates,
//! not about `BaseButton` and `BaseLink`, the fragments every template renders, nor
//! about `BaseEmailWrapper` itself. "Codemods in `codemods/**` are wrapped in
//! `createTransformer()`" is not about the `lib/` helpers the codemods call. Such a
//! symbol is a *part* of the role: rules about what a member is or does do not apply
//! to it ([`crate::mine::Rule::part_exemption`]).
//!
//! A part is an exported symbol of the role that
//!
//! - is no entry point and its role holds none: a route, handler, server action, job
//!   or page is reached from outside the code, so it is a member however many other
//!   members call it (a server action other actions reuse still needs its auth
//!   client). A file's default export is what a loader or runner picks up (a page, an
//!   email template, a codemod, a command), so it is never a part either;
//! - is used only where Drift sees every use, and only from inside the role's scope
//!   (the same package, directory, file kind and entry kind, whatever the symbol
//!   kind). Every production file that imports it counts, whatever it does with it
//!   (calls it, passes it as a value, `export const DELETE = deleteUser`), and so does
//!   module-level code: a file that imports it from outside the scope, or that holds
//!   an entry point, makes it a member in its own right. So does another file that
//!   re-exports it (`export { deleteUser as DELETE } from ...`), and a package entry
//!   (`main`, `exports`) that exposes it, since its users there are out of sight;
//! - and is used by at least [`MIN_PART_USERS`] units of the scope.
//!
//! Tests, stories and other non-production files neither make a symbol shared nor
//! keep it from being a part.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{ExportKind, FileFacts, RepoFacts, Symbol, SymbolKind, WrapKind};

use crate::roles::{NonProduction, RoleSelector, Unit, View, is_test_path};

/// Units of a role's scope that must use a symbol for it to be a shared part.
pub const MIN_PART_USERS: usize = 2;

/// Where a role's members sit, without their symbol kind: the units of one scope are
/// built together (`(package, dir, file kind, entry kind)`).
type Scope = (String, String, String, String);

fn scope_of(r: &RoleSelector) -> Scope {
    (
        r.package.clone(),
        r.dir.clone(),
        r.file.clone(),
        r.entry.clone(),
    )
}

#[derive(Debug, Clone, Default)]
struct PartUnit {
    /// Neither an entry point nor a default export, nor exposed where Drift cannot see
    /// its users: it may be a part.
    candidate: bool,
    /// The file it is defined in.
    file: usize,
    /// The scopes its roles sit in (interned), sorted.
    scopes: Vec<u32>,
    /// Units that use it, other than itself.
    users: BTreeSet<usize>,
    /// Other production files that import it.
    importers: BTreeSet<usize>,
}

/// Who uses each exported symbol of the repo, and where those users sit.
#[derive(Debug, Clone, Default)]
pub struct Parts {
    /// Symbol units by `path#name`.
    by_name: BTreeMap<String, usize>,
    units: Vec<PartUnit>,
    scopes: BTreeMap<Scope, u32>,
    /// Per production file (index into the repo's files): the scopes its units sit in,
    /// sorted; `None` for a file that holds an entry point (it is outside every scope).
    file_scopes: BTreeMap<usize, Option<Vec<u32>>>,
}

/// The symbol a canonical reference names, as `path#name`: member paths
/// (`lib/db.ts#db.link.findMany`), call suffixes (`#default(...)`) and `(ref)` markers
/// are dropped. `None` for packages, globals and unresolved references.
fn referenced(r: &str) -> Option<(&str, &str)> {
    let (module, name) = r.split_once('#')?;
    if module.starts_with("pkg:") || module == "global" || module.starts_with("unresolved:") {
        return None;
    }
    let end = name.find(['.', '(']).unwrap_or(name.len());
    Some((module, &name[..end]))
}

/// What each module exports, by name, for following imports to the symbol they name.
struct Exports<'a> {
    files: BTreeMap<&'a str, &'a FileFacts>,
}

impl<'a> Exports<'a> {
    /// The `path#name` keys an import of `name` from `module` can reach: through named
    /// and `export *` re-exports, and every export of the module for a namespace import.
    fn reach(&self, module: &str, name: &str, out: &mut BTreeSet<String>) {
        let mut seen = BTreeSet::new();
        self.reach_in(module, name, out, &mut seen, 0);
    }

    fn reach_in(
        &self,
        module: &str,
        name: &str,
        out: &mut BTreeSet<String>,
        seen: &mut BTreeSet<(String, String)>,
        depth: usize,
    ) {
        if depth > 8 || !seen.insert((module.to_string(), name.to_string())) {
            return;
        }
        let Some(f) = self.files.get(module) else {
            return;
        };
        // A namespace import, and `default`: drift-ts records a dynamic `import()` and a
        // `require()` of a module as an import of `default`, after which any of its
        // exports may be used (`m.deleteUser(req)`, `require(...).deleteUser`). So an
        // import of `default` uses every export of the module too.
        if name == "*" || name == "default" {
            for e in &f.exports {
                self.export(e, out, seen, depth);
            }
            for s in f.symbols.iter().filter(|s| !s.exported_as.is_empty()) {
                out.insert(format!("{module}#{}", s.name));
            }
            return;
        }
        let mut found = false;
        for e in f.exports.iter().filter(|e| e.name == name) {
            found = true;
            self.export(e, out, seen, depth);
        }
        if !found {
            out.insert(format!("{module}#{name}"));
            for e in f
                .exports
                .iter()
                .filter(|e| e.kind == ExportKind::ReExportAll)
            {
                if let Some((m, _)) = e.origin.split_once('#') {
                    self.reach_in(m, name, out, seen, depth + 1);
                }
            }
        }
    }

    /// An export names `path#name` (re-exports are followed to their origin, and
    /// `export *` is expanded by name), or `path#*` for all of a module.
    fn export(
        &self,
        e: &drift_core::Export,
        out: &mut BTreeSet<String>,
        seen: &mut BTreeSet<(String, String)>,
        depth: usize,
    ) {
        match e.origin.split_once('#') {
            Some((m, "*")) => self.reach_in(m, "*", out, seen, depth + 1),
            Some(_) => {
                out.insert(e.origin.clone());
            }
            None => {}
        }
    }
}

impl Parts {
    pub fn new(repo: &RepoFacts, units: &[Unit]) -> Self {
        let mut parts = Parts::default();
        let file_index: BTreeMap<&str, usize> = repo
            .files
            .iter()
            .enumerate()
            .map(|(i, f)| (f.path.as_str(), i))
            .collect();
        let non_production = NonProduction::learn(repo);
        let production =
            |f: &FileFacts| !is_test_path(&f.path) && !non_production.contains(&f.path, &f.package);
        // Symbol units, the canonical names they are referenced by, and the scopes of
        // each production file.
        let mut slot: BTreeMap<String, usize> = BTreeMap::new();
        let mut file_scopes: BTreeMap<usize, BTreeSet<u32>> = BTreeMap::new();
        for u in units {
            let (View::Symbol(f, _) | View::File(f)) = u.view else {
                continue;
            };
            let Some(&fi) = file_index.get(f.path.as_str()) else {
                continue;
            };
            let mut scopes: BTreeSet<u32> = BTreeSet::new();
            for r in &u.roles {
                let next = parts.scopes.len() as u32;
                scopes.insert(*parts.scopes.entry(scope_of(r)).or_insert(next));
            }
            file_scopes.entry(fi).or_default().extend(&scopes);
            let View::Symbol(_, s) = u.view else {
                continue;
            };
            if s.kind == SymbolKind::Module {
                continue;
            }
            let idx = parts.units.len();
            parts.units.push(PartUnit {
                candidate: may_be_part(u),
                file: fi,
                scopes: scopes.into_iter().collect(),
                users: BTreeSet::new(),
                importers: BTreeSet::new(),
            });
            parts
                .by_name
                .entry(format!("{}#{}", f.path, s.name))
                .or_insert(idx);
            for n in std::iter::once(&s.name).chain(&s.exported_as) {
                slot.entry(format!("{}#{n}", f.path)).or_insert(idx);
            }
        }
        parts.file_scopes = repo
            .files
            .iter()
            .enumerate()
            .filter(|(_, f)| production(f))
            .map(|(i, f)| {
                let scopes = (f.entry_points.is_empty()).then(|| {
                    file_scopes
                        .remove(&i)
                        .unwrap_or_default()
                        .into_iter()
                        .collect()
                });
                (i, scopes)
            })
            .collect();
        // Who uses whom, unit by unit.
        let mut user = 0usize;
        for u in units {
            let View::Symbol(_, s) = u.view else {
                continue;
            };
            if s.kind == SymbolKind::Module {
                continue;
            }
            for r in uses(s) {
                let Some((module, name)) = referenced(r) else {
                    continue;
                };
                // `m.deleteUser(req)` on a module loaded with `import()` or `require()`
                // is recorded as `users.ts#default.deleteUser`.
                let member = (name == "default")
                    .then(|| r.split_once('#').map(|(_, n)| n))
                    .flatten()
                    .and_then(|n| n.strip_prefix("default."))
                    .map(|m| m.split(['.', '(']).next().unwrap_or(m));
                for key in std::iter::once(format!("{module}#{name}"))
                    .chain(member.map(|m| format!("{module}#{m}")))
                {
                    if let Some(&t) = slot.get(&key)
                        && t != user
                    {
                        parts.units[t].users.insert(user);
                    }
                }
            }
            user += 1;
        }
        // Who imports or re-exports whom, file by file: every use from another file
        // goes through one, whatever the code does with the binding.
        let exports = Exports {
            files: repo.files.iter().map(|f| (f.path.as_str(), f)).collect(),
        };
        let mut exposed: BTreeSet<usize> = BTreeSet::new();
        // What an import of a name reaches depends on the module and the name only:
        // worked out once for every file that imports it.
        let mut reached: BTreeMap<(&str, &str), BTreeSet<String>> = BTreeMap::new();
        for (fi, f) in repo.files.iter().enumerate() {
            if !production(f) {
                continue;
            }
            for i in f.imports.iter().filter(|i| !i.type_only) {
                let mut keys = BTreeSet::new();
                for n in &i.names {
                    let r = reached
                        .entry((i.module.as_str(), n.as_str()))
                        .or_insert_with(|| {
                            let mut r = BTreeSet::new();
                            exports.reach(&i.module, n, &mut r);
                            r
                        });
                    keys.extend(r.iter().cloned());
                }
                for k in keys {
                    if let Some(&t) = slot.get(&k)
                        && parts.units[t].file != fi
                    {
                        parts.units[t].importers.insert(fi);
                    }
                }
            }
            let mut keys = BTreeSet::new();
            for e in &f.exports {
                exports.export(e, &mut keys, &mut BTreeSet::new(), 0);
            }
            for k in keys {
                if let Some(&t) = slot.get(&k)
                    && parts.units[t].file != fi
                {
                    exposed.insert(t);
                }
            }
        }
        // What package entries expose: its users there are out of sight.
        for p in &repo.packages {
            for entry in &p.entries {
                let mut keys = BTreeSet::new();
                exports.reach(entry, "*", &mut keys);
                for k in keys {
                    if let Some(&t) = slot.get(&k) {
                        exposed.insert(t);
                    }
                }
            }
        }
        for t in exposed {
            parts.units[t].candidate = false;
        }
        parts
    }

    /// How many units use this symbol when it may be a part of `role`: it is a
    /// candidate (no entry point, no default export, not re-exported elsewhere or by a
    /// package entry), the role holds no entry points, and every unit and every
    /// production file that uses it sits in the role's scope. `None` otherwise, and for
    /// symbols these facts do not have.
    pub fn users_within(&self, role: &RoleSelector, path: &str, symbol: &Symbol) -> Option<usize> {
        if role.entry != "-" {
            return None;
        }
        let &idx = self.by_name.get(&format!("{path}#{}", symbol.name))?;
        let unit = &self.units[idx];
        if !unit.candidate {
            return None;
        }
        let scope = *self.scopes.get(&scope_of(role))?;
        let units_inside = unit
            .users
            .iter()
            .all(|&u| self.units[u].scopes.binary_search(&scope).is_ok());
        let files_inside = unit.importers.iter().all(|f| {
            self.file_scopes
                .get(f)
                .is_some_and(|s| s.as_ref().is_some_and(|s| s.binary_search(&scope).is_ok()))
        });
        (units_inside && files_inside).then_some(unit.users.len())
    }
}

/// Everything a symbol uses by name: its callees, the components it renders, and its
/// wrappers, decorators and bases.
fn uses(s: &Symbol) -> impl Iterator<Item = &str> {
    s.calls.iter().chain(&s.renders).map(String::as_str).chain(
        s.wraps
            .iter()
            .filter(|w| {
                matches!(
                    w.kind,
                    WrapKind::Call | WrapKind::Decorator | WrapKind::Jsx | WrapKind::Extends
                )
            })
            .map(|w| w.wrapper.as_str()),
    )
}

/// A symbol that could be a part of a role with no entry points: neither an entry
/// point nor a default export. Whether it is one depends on who uses it, which a
/// single-file scan does not know ([`crate::check::needs_full_scan`]).
pub fn may_be_part(unit: &Unit) -> bool {
    match unit.view {
        View::Symbol(_, s) => {
            s.kind != SymbolKind::Module
                && unit.entry == "-"
                && !s.exported_as.iter().any(|e| e == "default")
        }
        _ => false,
    }
}
