//! Parameter-type facts, part 2: whether a callee's declared parameter type
//! requires each object key a call passes.
//!
//! For each `callee@index:key` in [`Symbol::args`](drift_core::Symbol::args), the
//! callee's declaration is found (in-repo source, a workspace package, or a
//! `.d.ts` file: in the repo or in an installed `node_modules`), the parameter at
//! `index` is resolved to its property set, and the key is recorded in
//! [`Symbol::arg_types`](drift_core::Symbol::arg_types) as `=required`,
//! `=optional` or `=unknown`. Anything the resolver cannot decide from the
//! declarations as written is unknown, and an unknown key changes nothing downstream.
//!
//! A key is **optional** when its property is declared with `?`, its declared
//! type has an `undefined` (or `void`) member, or the callee's destructuring
//! pattern gives it a default value (`{ a = 1 }: Opts`). It is **required** when
//! it is declared without `?`, with no default, and its declared type is known
//! not to include `undefined`: a primitive, an object or function type, an
//! interface, class or enum, a known TypeScript lib type (`Date`, `Promise`, ...),
//! the callee's own type parameter, or an alias of one of these. A declaration's
//! type parameter takes its argument or its default (`<T = undefined>`).
//! `Partial`, `Readonly` and `Required` keep the `undefined` of their argument. A property whose type is a name
//! Drift cannot see (an uninstalled package's type, an unknown global) is
//! unknown: the name may alias a type that includes `undefined` (`ReactNode`).
//! A nested key `a.b` is required when every segment is, optional when every
//! segment resolves and one is optional.
//!
//! Shapes read: object type literals; local and imported interfaces (with
//! `extends` and merged declarations), type aliases and classes (instance members;
//! a class with private or protected members is unknown); `Partial`, `Required`,
//! `Readonly`, `Pick` and `Omit` over those (`Pick`/`Omit` with string literal
//! keys); intersections; generic declarations whose type arguments are given or
//! do not decide the property set. Unions, mapped, conditional and indexed types,
//! overloaded callees, unannotated parameters and rest parameters are unknown.
//!
//! Only exported declarations answer for a module's exports, and a name two
//! `export *` sources both provide is unknown. Every walk is bounded by a step
//! budget and a set of the declarations being expanded, so cycles (`export *`
//! loops, interfaces that extend each other) end in unknown, not in a hang.
//!
//! Declaration files are read only inside the repository root, after resolving
//! symlinks: a package linked from outside the checkout (`npm link`) or an
//! absolute specifier that leaves it is unknown, never read.
//!
//! The result for a key depends only on the declarations, never on the order
//! files are visited in, so output is deterministic.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use drift_core::FileFacts;
use drift_core::cache::FactCache;
use drift_core::ingest::{MAX_FILE_BYTES, hash_bytes, rel_posix};

use crate::resolve::ModuleResolver;
use crate::types::{FnSig, RawTypes, TExpr, TParam, TRef, TypeDecl};

/// Most steps one question may take (types visited, declarations expanded).
const MAX_STEPS: usize = 4096;
/// Most (module, name) pairs one export lookup may visit.
const MAX_EXPORT_VISITS: usize = 4096;
/// Deepest `export *` nesting followed when building a module's export table.
const MAX_STAR_DEPTH: usize = 4096;

/// TypeScript lib types that are never `undefined`. Other unseen globals are unknown.
/// (`Partial`, `Readonly` and `Required` keep their argument's `undefined`; they and
/// `Pick`/`Omit` are read, not listed.)
const DEFINED_GLOBALS: &[&str] = &[
    "Array",
    "ArrayBuffer",
    "BigInt",
    "Blob",
    "Boolean",
    "Buffer",
    "Date",
    "Error",
    "File",
    "FormData",
    "Function",
    "Headers",
    "Map",
    "Number",
    "Object",
    "Promise",
    "PromiseLike",
    "ReadonlyArray",
    "ReadonlyMap",
    "ReadonlySet",
    "Record",
    "RegExp",
    "Request",
    "Response",
    "Set",
    "String",
    "Symbol",
    "URL",
    "URLSearchParams",
    "Uint8Array",
    "WeakMap",
    "WeakSet",
];

/// What a callee's parameter type says about one passed key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Requirement {
    Required,
    Optional,
}

impl Requirement {
    pub fn as_str(self) -> &'static str {
        match self {
            Requirement::Required => "required",
            Requirement::Optional => "optional",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum ModId {
    /// A scanned file, by repo-relative path.
    Repo(String),
    /// A declaration file read on demand (canonical absolute path, inside the root).
    Ext(PathBuf),
}

struct Module {
    id: ModId,
    dir: PathBuf,
    types: Arc<RawTypes>,
}

impl Module {
    /// A top-level declaration of this name, exported or not.
    fn declares(&self, n: &str) -> bool {
        let t = &self.types;
        let prefix = format!("{n}.");
        t.decls.contains_key(n)
            || t.fns.contains_key(n)
            || t.fns
                .range(prefix.clone()..)
                .next()
                .is_some_and(|(k, _)| k.starts_with(&prefix))
    }
}

/// A type expression in the module it was written in, with its type-parameter bindings.
#[derive(Clone)]
struct Ty {
    m: Arc<Module>,
    e: TExpr,
    env: Env,
}

type Env = Arc<BTreeMap<String, Ty>>;

/// Bounds one question: a step budget and the declarations being expanded.
#[derive(Default)]
struct Walk {
    steps: usize,
    expanding: Vec<(ModId, String)>,
}

impl Walk {
    fn step(&mut self) -> Option<()> {
        self.steps += 1;
        (self.steps <= MAX_STEPS).then_some(())
    }

    /// Run `f` with the declaration `(m, name)` marked as being expanded; a
    /// declaration that is already being expanded (a cycle) is unknown.
    fn expand<T>(
        &mut self,
        m: &ModId,
        name: &str,
        f: impl FnOnce(&mut Self) -> Option<T>,
    ) -> Option<T> {
        let key = (m.clone(), name.to_string());
        if self.expanding.contains(&key) {
            return None;
        }
        self.expanding.push(key);
        let out = f(self);
        self.expanding.pop();
        out
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Opt {
    /// Declared with `?` (or made optional by `Partial`).
    Question,
    /// Declared without `?`: required unless its type includes `undefined`.
    Declared,
    /// Required whatever its type (an intersection where one side requires it).
    Required,
    Unknown,
}

#[derive(Clone)]
struct Prop {
    opt: Opt,
    /// The property's type; `None` when it cannot be followed.
    ty: Option<Ty>,
}

#[derive(Clone, Default)]
struct Shape {
    props: BTreeMap<String, Prop>,
    /// Has an index signature: keys it does not list are allowed.
    open: bool,
    /// Built from an interface that a module augmentation may extend (with an index
    /// signature, say): `Pick` and `Omit` over it are unknown.
    augmented: bool,
}

/// Whether a type includes `undefined`, with `any` and `unknown` kept apart: they
/// absorb a union, `any` absorbs an intersection and `unknown` is its identity.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Undef {
    Yes,
    No,
    Any,
    Top,
}

impl Undef {
    fn union(xs: impl IntoIterator<Item = Option<Undef>>) -> Option<Undef> {
        let (mut any, mut top, mut yes, mut unknown) = (false, false, false, false);
        for x in xs {
            match x {
                Some(Undef::Any) => any = true,
                Some(Undef::Top) => top = true,
                Some(Undef::Yes) => yes = true,
                Some(Undef::No) => {}
                None => unknown = true,
            }
        }
        if any {
            Some(Undef::Any)
        } else if top {
            Some(Undef::Top)
        } else if yes {
            Some(Undef::Yes)
        } else if unknown {
            None
        } else {
            Some(Undef::No)
        }
    }

    fn intersection(xs: impl IntoIterator<Item = Option<Undef>>) -> Option<Undef> {
        let (mut any, mut no, mut unknown, mut seen) = (false, false, false, false);
        for x in xs {
            match x {
                Some(Undef::Any) => any = true,
                // `unknown` is the identity of an intersection.
                Some(Undef::Top) => {}
                Some(Undef::No) => {
                    no = true;
                    seen = true;
                }
                Some(Undef::Yes) => seen = true,
                None => unknown = true,
            }
        }
        if any {
            Some(Undef::Any)
        } else if no {
            Some(Undef::No)
        } else if unknown {
            None
        } else if seen {
            Some(Undef::Yes)
        } else {
            Some(Undef::Top)
        }
    }
}

/// A module's exports: each name with every declaration (or re-export still to
/// follow) that provides it. Built once per module.
struct Table {
    names: BTreeMap<String, Vec<Cand>>,
}

#[derive(Clone)]
enum Cand {
    /// A declaration of this module, by local name.
    Decl(Arc<Module>, String),
    /// `export { name } from` that module: look `name` up there.
    Re(Arc<Module>, String),
    /// A namespace re-export, or a module that does not resolve.
    Unknown,
}

/// A table cut short in one walk: (table, the modules cut, whether it overflowed).
type Partial = (Arc<Table>, BTreeSet<ModId>, bool);

/// A table being built: modules cut short because they were already on the stack.
struct Building {
    table: Arc<Table>,
    cuts: BTreeSet<ModId>,
    overflow: bool,
}

/// A parameter resolved to its property set, with the keys its pattern defaults.
struct ParamShape {
    shape: Shape,
    defaults: Vec<String>,
}

/// A callee's parameter: (module, local name or `Class.method`, argument index).
type ParamKey = (ModId, String, u32);

/// A module loaded on demand, or `None` when it cannot be read.
type Loaded = Option<Arc<Module>>;

/// Where an export resolves: the declaring module and its local name.
type Found = Option<(Arc<Module>, String)>;

/// Loads a scanned file's type declarations by repo-relative path.
pub(crate) type RepoTypes<'a> = dyn Fn(&str) -> Option<Arc<RawTypes>> + Sync + 'a;

pub(crate) struct TypeIndex<'a> {
    root: &'a Path,
    /// `root` with symlinks resolved: declaration files are read only below it.
    real_root: PathBuf,
    resolver: &'a ModuleResolver,
    repo: &'a RepoTypes<'a>,
    modules: Mutex<HashMap<ModId, Option<Arc<Module>>>>,
    params: Mutex<HashMap<ParamKey, Option<Arc<ParamShape>>>>,
    /// [`TypeIndex::requirement`]'s answers, per callee parameter and passed key: it
    /// reads only the parameter's shape and the declarations it reaches, and every
    /// call passing that key asks again (nested keys walk the shapes anew).
    requirements: Mutex<HashMap<(ParamKey, String), Option<Requirement>>>,
    exports: Mutex<HashMap<(ModId, String), Found>>,
    tables: Mutex<HashMap<ModId, Arc<Table>>>,
    resolved: Mutex<HashMap<(ModId, String), Loaded>>,
    /// A package's declarations as a callee's package specifier names them from a
    /// directory ([`TypeIndex::package_module`]): (directory, specifier) -> module.
    packages: Mutex<HashMap<(PathBuf, String), Loaded>>,
    /// Interface names some module augmentation in the repository names.
    augmented: BTreeSet<String>,
    /// Where the declarations of files outside the scan are cached ([`declared_types`]).
    cache: Option<FactCache>,
}

/// Cache tag of [`declared_types`]: what it stores is a lowering's type declarations.
fn types_tag() -> String {
    format!(
        "ts-types-l{}-{}",
        crate::lower::LOWERING_VERSION,
        env!("CARGO_PKG_VERSION")
    )
}

/// The cache key of [`declared_types`]: the file's name and its content.
fn types_key(name: &str, text: &str) -> String {
    hash_bytes(&[name.as_bytes(), b"\0", text.as_bytes()].concat())
}

/// The fact cache of [`declared_types`], below the cache directory `dir`.
pub(crate) fn types_cache(dir: &Path) -> FactCache {
    FactCache::new(dir, &types_tag())
}

/// The type declarations of a file outside the scan (a declaration file, or a
/// TypeScript source an installed package ships) named `name`, with content `text`:
/// lowered, or read from `cache`, where every lowering is kept as other lowered files
/// are. Lowering reads only the file's name (for its source type) and its text, so
/// the entry is keyed by the hash of both, under the lowering version ([`types_tag`]).
pub(crate) fn declared_types(cache: Option<&FactCache>, name: &str, text: &str) -> Arc<RawTypes> {
    let key = cache.map(|_| types_key(name, text));
    if let (Some(c), Some(k)) = (cache, &key)
        && let Some(t) = c.get::<RawTypes>(k)
    {
        return Arc::new(t);
    }
    let types = crate::lower::lower_file(name, text).types;
    if let (Some(c), Some(k)) = (cache, &key) {
        c.put(k, &*types);
    }
    types
}

/// Interface names that module augmentations in the repository name: in scanned
/// files and in the repository's declaration files, which are not scanned (only
/// those that say `declare module` or `declare global` are read).
pub(crate) fn augmented_names<'x>(
    root: &Path,
    scanned: impl Iterator<Item = &'x RawTypes>,
    skipped: &[drift_core::Skipped],
    cache: Option<&FactCache>,
) -> BTreeSet<String> {
    let mut out: BTreeSet<String> = scanned.flat_map(|t| t.augments.iter().cloned()).collect();
    for s in skipped {
        // Declaration files are skipped from scans, as declarations or as generated.
        if !is_declaration_file(&s.path) {
            continue;
        }
        let path = root.join(&s.path);
        let small = std::fs::symlink_metadata(&path)
            .is_ok_and(|m| m.is_file() && m.len() <= MAX_FILE_BYTES);
        let Some(text) = small.then(|| std::fs::read_to_string(&path).ok()).flatten() else {
            continue;
        };
        if text.contains("declare module") || text.contains("declare global") {
            let name = s.path.rsplit('/').next().unwrap_or(&s.path);
            out.extend(declared_types(cache, name, &text).augments.iter().cloned());
        }
    }
    out
}

fn is_declaration_file(name: &str) -> bool {
    name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts")
}

impl<'a> TypeIndex<'a> {
    pub(crate) fn new(
        root: &'a Path,
        resolver: &'a ModuleResolver,
        repo: &'a RepoTypes<'a>,
        augmented: BTreeSet<String>,
        cache: Option<FactCache>,
    ) -> Self {
        Self {
            root,
            real_root: root.canonicalize().unwrap_or_else(|_| root.to_path_buf()),
            resolver,
            repo,
            modules: Mutex::new(HashMap::new()),
            params: Mutex::new(HashMap::new()),
            requirements: Mutex::new(HashMap::new()),
            exports: Mutex::new(HashMap::new()),
            tables: Mutex::new(HashMap::new()),
            resolved: Mutex::new(HashMap::new()),
            packages: Mutex::new(HashMap::new()),
            augmented,
            cache,
        }
    }

    /// Fill [`drift_core::Symbol::arg_types`] for every symbol of `facts`: one entry
    /// per [`drift_core::Symbol::args`] entry, sorted. Keep
    /// [`drift_core::Symbol::made_by`] only where the callee is proven to return a
    /// function, and make that value a function.
    pub(crate) fn annotate(&self, facts: &mut FileFacts) {
        let abs = self.root.join(&facts.path);
        let dir = abs.parent().unwrap_or(self.root).to_path_buf();
        for s in &mut facts.symbols {
            let mut out: Vec<String> = s
                .args
                .iter()
                .map(|a| {
                    let r = a
                        .rsplit_once('@')
                        .and_then(|(callee, rest)| {
                            let (idx, key) = rest.split_once(':')?;
                            self.requirement(&dir, callee, idx.parse().ok()?, key)
                        })
                        .map_or("unknown", Requirement::as_str);
                    format!("{a}={r}")
                })
                .collect();
            out.sort();
            out.dedup();
            s.arg_types = out;
            // A value bound to a call is a function only when the callee is proven to
            // return one; otherwise it stays the value it was.
            if !s.made_by.is_empty() {
                if self.returns_function(&dir, &s.made_by) {
                    s.kind = drift_core::SymbolKind::Function;
                } else {
                    s.made_by.clear();
                }
            }
        }
    }

    /// Whether `callee`'s parameter `index` requires `key`, called from a file in `dir`.
    pub(crate) fn requirement(
        &self,
        dir: &Path,
        callee: &str,
        index: u32,
        key: &str,
    ) -> Option<Requirement> {
        let (m, name) = self.callee_module(dir, callee)?;
        let memo_key = ((m.id.clone(), name.to_string(), index), key.to_string());
        if let Some(v) = self.requirements.lock().ok()?.get(&memo_key) {
            return *v;
        }
        let v = self.compute_requirement(&m, name, index, key);
        if let Ok(mut memo) = self.requirements.lock() {
            memo.insert(memo_key, v);
        }
        v
    }

    /// [`TypeIndex::requirement`] of the callee `name` of `m`.
    fn compute_requirement(
        &self,
        m: &Arc<Module>,
        name: &str,
        index: u32,
        key: &str,
    ) -> Option<Requirement> {
        let p = self.param_shape(m, name, index)?;
        let mut w = Walk::default();
        let mut cur = &p.shape;
        let mut next;
        let mut result = Requirement::Required;
        let segs: Vec<&str> = key.split('.').collect();
        for (i, seg) in segs.iter().enumerate() {
            // A key a type with an index signature does not list is allowed, not required.
            let prop = cur.props.get(*seg)?;
            let r = if i == 0 && p.defaults.iter().any(|d| d == seg) {
                Requirement::Optional
            } else {
                self.classify(prop, &mut w)?
            };
            if r == Requirement::Optional {
                result = Requirement::Optional;
            }
            if i + 1 < segs.len() {
                next = self.shape(prop.ty.as_ref()?, &mut w)?;
                cur = &next;
            }
        }
        Some(result)
    }

    /// The module whose declarations answer for `callee` (`path#name`,
    /// `pkg:spec#name`), called from a file in `dir`, and the name in it.
    fn callee_module<'c>(&self, dir: &Path, callee: &'c str) -> Option<(Arc<Module>, &'c str)> {
        let (module, name) = callee.split_once('#')?;
        if name.contains(['(', '[']) || name.matches('.').count() > 1 {
            return None;
        }
        let m = if let Some(spec) = module.strip_prefix("pkg:") {
            if spec.starts_with("node:") {
                return None;
            }
            self.package_module(dir, spec)?
        } else if module == "global" || module.starts_with("unresolved:") {
            return None;
        } else {
            self.load_rel(module)?
        };
        Some((m, name))
    }

    /// The one call signature the declarations give `name` of `m` (a declaration of
    /// `m`, or an export it reaches; `Class.method` for a method), if they decide it.
    fn signature(&self, m: &Arc<Module>, name: &str) -> Option<(Arc<Module>, FnSig)> {
        let (head, member) = match name.split_once('.') {
            Some((h, t)) => (h, Some(t)),
            None => (name, None),
        };
        // The linker names a callee by its declaring module and local name, which
        // may be a declaration the module does not export (a call in the same file).
        let (m, local) = if m.declares(head) {
            (m.clone(), head.to_string())
        } else {
            self.find_export(m, head)?
        };
        let key = match member {
            Some(t) => format!("{local}.{t}"),
            None => local,
        };
        let sig = m.types.fns.get(&key)?.as_ref()?.clone();
        Some((m, sig))
    }

    /// Calling `callee` (from a file in `dir`) is proven to return a function
    /// ([`FnSig::returns_function`]).
    pub(crate) fn returns_function(&self, dir: &Path, callee: &str) -> bool {
        self.callee_module(dir, callee)
            .and_then(|(m, name)| self.signature(&m, name))
            .is_some_and(|(_, sig)| sig.returns_function)
    }

    fn param_shape(&self, m: &Arc<Module>, name: &str, index: u32) -> Option<Arc<ParamShape>> {
        let memo_key = (m.id.clone(), name.to_string(), index);
        if let Some(v) = self.params.lock().ok()?.get(&memo_key) {
            return v.clone();
        }
        let v = self.compute_param(m, name, index).map(Arc::new);
        if let Ok(mut memo) = self.params.lock() {
            memo.insert(memo_key, v.clone());
        }
        v
    }

    fn compute_param(&self, m: &Arc<Module>, name: &str, index: u32) -> Option<ParamShape> {
        let (m, sig) = self.signature(m, name)?;
        let i = usize::try_from(index).ok()?;
        let param = sig.params.get(i)?;
        if param.rest {
            return None;
        }
        let ty = Ty {
            m: m.clone(),
            e: param.ty.clone()?,
            env: Arc::new(BTreeMap::new()),
        };
        Some(ParamShape {
            shape: self.shape(&ty, &mut Walk::default())?,
            defaults: param.defaults.clone(),
        })
    }

    // ------------------------------------------------------------------ modules

    /// The declarations the package specifier `spec` resolves to from `dir`
    /// (memoised): every call to a package's function from the files of one
    /// directory resolves the same specifier, and resolving it is a walk of the
    /// file system.
    fn package_module(&self, dir: &Path, spec: &str) -> Option<Arc<Module>> {
        let key = (dir.to_path_buf(), spec.to_string());
        if let Some(v) = self.packages.lock().ok()?.get(&key) {
            return v.clone();
        }
        let v = self.types_path(dir, spec).and_then(|p| self.load_path(&p));
        if let Ok(mut c) = self.packages.lock() {
            c.insert(key, v.clone());
        }
        v
    }

    fn load_rel(&self, rel: &str) -> Option<Arc<Module>> {
        let id = ModId::Repo(rel.to_string());
        if let Some(v) = self.modules.lock().ok()?.get(&id) {
            return v.clone();
        }
        let v = match (self.repo)(rel) {
            Some(types) => Some(Arc::new(Module {
                dir: self
                    .root
                    .join(rel)
                    .parent()
                    .unwrap_or(self.root)
                    .to_path_buf(),
                id: id.clone(),
                types,
            })),
            // In-repo declaration files are not scanned; read them on demand.
            None if is_declaration_file(rel) => self.load_path(&self.root.join(rel)),
            None => None,
        };
        if let Ok(mut c) = self.modules.lock() {
            c.insert(id, v.clone());
        }
        v
    }

    /// A declaration (or TypeScript source) file outside the scanned set. Only a
    /// file whose real path (symlinks resolved) is inside the root is read.
    fn load_path(&self, path: &Path) -> Option<Arc<Module>> {
        let real = path.canonicalize().ok()?;
        if !real.starts_with(&self.real_root) {
            return None;
        }
        if let Some(rel) = self.scanned_rel(&real) {
            return self.load_rel(&rel);
        }
        let id = ModId::Ext(real.clone());
        if let Some(v) = self.modules.lock().ok()?.get(&id) {
            return v.clone();
        }
        let name = real.file_name()?.to_str()?;
        let typed = is_declaration_file(name)
            || [".ts", ".tsx", ".mts", ".cts"]
                .iter()
                .any(|e| name.ends_with(e));
        let v = typed
            .then(|| {
                let meta = std::fs::metadata(&real).ok()?;
                if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
                    return None;
                }
                let text = std::fs::read_to_string(&real).ok()?;
                Some(Arc::new(Module {
                    id: id.clone(),
                    dir: real.parent()?.to_path_buf(),
                    types: declared_types(self.cache.as_ref(), name, &text),
                }))
            })
            .flatten();
        if let Ok(mut c) = self.modules.lock() {
            c.insert(id, v.clone());
        }
        v
    }

    /// The repo-relative path of `real` (a resolved path) when it is a scanned file.
    fn scanned_rel(&self, real: &Path) -> Option<String> {
        if real.components().any(|c| c.as_os_str() == "node_modules") {
            return None;
        }
        let rel = rel_posix(&self.real_root, real)?;
        (self.repo)(&rel).is_some().then_some(rel)
    }
    /// The file a package specifier's types resolve to from `dir`, preferring a
    /// declaration file next to a resolved `.js` file.
    fn types_path(&self, dir: &Path, spec: &str) -> Option<PathBuf> {
        let Some(p) = self.resolver.resolve_path(dir, spec) else {
            // `./table.js` in a package that ships only `table.d.ts`.
            if !spec.starts_with('.') {
                return None;
            }
            return [(".js", ".d.ts"), (".mjs", ".d.mts"), (".cjs", ".d.cts")]
                .iter()
                .find_map(|(js, dts)| {
                    let d = dir.join(format!("{}{dts}", spec.strip_suffix(js)?));
                    d.is_file().then_some(d)
                });
        };
        let name = p.file_name()?.to_str()?.to_string();
        for (js, dts) in [(".js", ".d.ts"), (".mjs", ".d.mts"), (".cjs", ".d.cts")] {
            if let Some(stem) = name.strip_suffix(js) {
                let d = p.with_file_name(format!("{stem}{dts}"));
                return d.is_file().then_some(d);
            }
        }
        Some(p)
    }

    /// The module `spec` names, imported from `m` (memoised).
    fn resolve(&self, m: &Module, spec: &str) -> Option<Arc<Module>> {
        let key = (m.id.clone(), spec.to_string());
        if let Some(v) = self.resolved.lock().ok()?.get(&key) {
            return v.clone();
        }
        let v = self.resolve_uncached(m, spec);
        if let Ok(mut c) = self.resolved.lock() {
            c.insert(key, v.clone());
        }
        v
    }

    fn resolve_uncached(&self, m: &Module, spec: &str) -> Option<Arc<Module>> {
        match &m.id {
            ModId::Repo(_) => {
                let canon = self.resolver.resolve(&m.dir, spec);
                if canon.starts_with("pkg:") {
                    if canon.starts_with("pkg:node:") {
                        return None;
                    }
                    self.load_path(&self.types_path(&m.dir, spec)?)
                } else if canon.starts_with("unresolved:") {
                    None
                } else {
                    self.load_rel(&canon)
                }
            }
            ModId::Ext(_) => self.load_path(&self.types_path(&m.dir, spec)?),
        }
    }

    /// The module and local name an export of `m` comes from, following re-exports
    /// and `export *`, from the modules' export tables. Only exported declarations
    /// count. A name that two `export *` sources provide differently is unknown:
    /// in a `.ts` file tsc reports the conflict, and in a `.d.ts` under
    /// `skipLibCheck` it takes the first source, which an unknown never contradicts.
    /// Memoised per (module, name).
    fn find_export(&self, m: &Arc<Module>, name: &str) -> Found {
        let key = (m.id.clone(), name.to_string());
        if let Some(v) = self.exports.lock().ok()?.get(&key) {
            return v.clone();
        }
        let mut seen = BTreeSet::new();
        let mut found: BTreeMap<(ModId, String), Arc<Module>> = BTreeMap::new();
        let complete = self.collect(m, name, &mut seen, &mut found);
        let v = match (complete, found.len()) {
            (true, 1) => found
                .into_iter()
                .next()
                .map(|((_, local), module)| (module, local)),
            _ => None,
        };
        if let Ok(mut c) = self.exports.lock() {
            c.insert(key, v.clone());
        }
        v
    }

    /// Every declaration `name` reaches from `m`'s export table, re-exports
    /// followed. False when it cannot be completed (a namespace re-export, an
    /// unresolved module, too long a chain).
    fn collect(
        &self,
        m: &Arc<Module>,
        name: &str,
        seen: &mut BTreeSet<(ModId, String)>,
        found: &mut BTreeMap<(ModId, String), Arc<Module>>,
    ) -> bool {
        // A re-export cycle adds nothing (tsc reports it).
        if !seen.insert((m.id.clone(), name.to_string())) {
            return true;
        }
        if seen.len() > MAX_EXPORT_VISITS {
            return false;
        }
        let Some(table) = self.table(m) else {
            return false;
        };
        for c in table.names.get(name).into_iter().flatten() {
            match c {
                Cand::Decl(dm, local) => {
                    found.insert((dm.id.clone(), local.clone()), dm.clone());
                }
                Cand::Re(rm, n) => {
                    if !self.collect(rm, n, seen, found) {
                        return false;
                    }
                }
                Cand::Unknown => return false,
            }
        }
        true
    }

    /// `m`'s export table, built once (`None` when `export *` nests too deep).
    fn table(&self, m: &Arc<Module>) -> Option<Arc<Table>> {
        if let Some(t) = self.tables.lock().ok()?.get(&m.id) {
            return Some(t.clone());
        }
        let mut local = HashMap::new();
        let mut stack = Vec::new();
        let b = self.build_table(m, &mut local, &mut stack);
        // At the top of the walk every cut module is `m` itself or below it, and
        // their names are in: the table is complete.
        (!b.overflow).then_some(b.table)
    }

    /// Build `m`'s table depth first over `export *`, like tsc's `getExportsOfModule`.
    /// A table cut short by a module still on the stack is kept only for this walk;
    /// a complete one is memoised, so the result never depends on visiting order.
    fn build_table(
        &self,
        m: &Arc<Module>,
        local: &mut HashMap<ModId, Partial>,
        stack: &mut Vec<ModId>,
    ) -> Building {
        if let Some(t) = self.tables.lock().ok().and_then(|c| c.get(&m.id).cloned()) {
            return Building {
                table: t,
                cuts: BTreeSet::new(),
                overflow: false,
            };
        }
        if let Some((t, cuts, overflow)) = local.get(&m.id) {
            return Building {
                table: t.clone(),
                cuts: cuts.clone(),
                overflow: *overflow,
            };
        }
        let empty = || {
            Arc::new(Table {
                names: BTreeMap::new(),
            })
        };
        if stack.contains(&m.id) {
            return Building {
                table: empty(),
                cuts: std::iter::once(m.id.clone()).collect(),
                overflow: false,
            };
        }
        if stack.len() >= MAX_STAR_DEPTH {
            return Building {
                table: empty(),
                cuts: BTreeSet::new(),
                overflow: true,
            };
        }
        stack.push(m.id.clone());
        let t = &m.types;
        let mut names: BTreeMap<String, Vec<Cand>> = BTreeMap::new();
        for (exported, l) in &t.aliases {
            if m.declares(l) {
                names.insert(exported.clone(), vec![Cand::Decl(m.clone(), l.clone())]);
            }
        }
        let own: BTreeSet<String> = if t.all_exported {
            t.decls
                .keys()
                .cloned()
                .chain(
                    t.fns
                        .keys()
                        .map(|k| k.split('.').next().unwrap_or(k).to_string()),
                )
                .collect()
        } else {
            t.exported
                .iter()
                .filter(|n| m.declares(n))
                .cloned()
                .collect()
        };
        for n in own {
            names
                .entry(n.clone())
                .or_insert_with(|| vec![Cand::Decl(m.clone(), n)]);
        }
        for (exported, (spec, n)) in &t.reexports {
            let c = match (n.as_str(), self.resolve(m, spec)) {
                ("*", _) | (_, None) => Cand::Unknown,
                (_, Some(rm)) => Cand::Re(rm, n.clone()),
            };
            names.insert(exported.clone(), vec![c]);
        }
        let explicit: BTreeSet<String> = names.keys().cloned().collect();
        let mut cuts = BTreeSet::new();
        let mut overflow = false;
        for spec in &t.star {
            let Some(sm) = self.resolve(m, spec) else {
                continue;
            };
            let b = self.build_table(&sm, local, stack);
            cuts.extend(b.cuts);
            overflow |= b.overflow;
            for (n, cands) in &b.table.names {
                if n == "default" || explicit.contains(n) {
                    continue;
                }
                names
                    .entry(n.clone())
                    .or_default()
                    .extend(cands.iter().cloned());
            }
        }
        stack.pop();
        cuts.remove(&m.id);
        let table = Arc::new(Table { names });
        if cuts.is_empty() && !overflow {
            if let Ok(mut c) = self.tables.lock() {
                c.insert(m.id.clone(), table.clone());
            }
        } else {
            local.insert(m.id.clone(), (table.clone(), cuts.clone(), overflow));
        }
        Building {
            table,
            cuts,
            overflow,
        }
    }

    /// The declaration a type reference in `m` names, with its local name.
    fn find_decl(&self, m: &Arc<Module>, target: &TRef) -> Option<(Arc<Module>, String, TypeDecl)> {
        match target {
            TRef::Local(n) => Some((m.clone(), n.clone(), m.types.decls.get(n)?.clone())),
            TRef::Import { spec, name, member } => {
                let m2 = self.resolve(m, spec)?;
                let name = if name == "*" {
                    member.strip_prefix('.')?
                } else if member.is_empty() {
                    name.as_str()
                } else {
                    return None;
                };
                let (m3, local) = self.find_export(&m2, name)?;
                let d = m3.types.decls.get(&local)?.clone();
                Some((m3, local, d))
            }
            TRef::Global(_) => None,
        }
    }

    // ------------------------------------------------------------------ shapes

    fn classify(&self, p: &Prop, w: &mut Walk) -> Option<Requirement> {
        match p.opt {
            Opt::Question => Some(Requirement::Optional),
            Opt::Required => Some(Requirement::Required),
            Opt::Unknown => None,
            Opt::Declared => match self.undef(p.ty.as_ref()?, w)? {
                Undef::Yes => Some(Requirement::Optional),
                // `any` and `unknown` do not make a key optional: tsc requires it.
                Undef::No | Undef::Any | Undef::Top => Some(Requirement::Required),
            },
        }
    }

    /// A property's part in an intersection: whether its type includes `undefined`
    /// (`?` adds it).
    fn prop_undef(&self, p: &Prop, w: &mut Walk) -> Option<Undef> {
        match p.opt {
            Opt::Question => Some(Undef::Yes),
            Opt::Required => Some(Undef::No),
            Opt::Unknown => None,
            Opt::Declared => self.undef(p.ty.as_ref()?, w),
        }
    }

    fn sub(t: &Ty, e: &TExpr) -> Ty {
        Ty {
            m: t.m.clone(),
            e: e.clone(),
            env: t.env.clone(),
        }
    }

    /// Bind a generic declaration's parameters: to the reference's arguments, else to
    /// their defaults (read in the declaration's module, after the earlier
    /// parameters), else to an unknown type.
    fn bind(&self, t: &Ty, decl: &Arc<Module>, params: &[TParam], args: &[TExpr]) -> Option<Env> {
        if args.len() > params.len() {
            return None;
        }
        let mut env = BTreeMap::new();
        for (i, p) in params.iter().enumerate() {
            let ty = match (args.get(i), &p.default) {
                (Some(a), _) => Self::sub(t, a),
                (None, Some(d)) => Ty {
                    m: decl.clone(),
                    e: d.clone(),
                    env: Arc::new(env.clone()),
                },
                // A missing argument without a default is a type error: nothing to read.
                (None, None) => Ty {
                    m: decl.clone(),
                    e: TExpr::Unknown,
                    env: Arc::new(BTreeMap::new()),
                },
            };
            env.insert(p.name.clone(), ty);
        }
        Some(Arc::new(env))
    }

    /// Whether the type `t` has an `undefined` member; `None` when Drift cannot tell.
    fn undef(&self, t: &Ty, w: &mut Walk) -> Option<Undef> {
        w.step()?;
        match &t.e {
            TExpr::Undefined => Some(Undef::Yes),
            TExpr::Other | TExpr::Str(_) | TExpr::Object(_) => Some(Undef::No),
            TExpr::Any => Some(Undef::Any),
            TExpr::Top => Some(Undef::Top),
            TExpr::Unknown => None,
            TExpr::Union(xs) => {
                let parts: Vec<Option<Undef>> =
                    xs.iter().map(|x| self.undef(&Self::sub(t, x), w)).collect();
                Undef::union(parts)
            }
            TExpr::Intersection(xs) => {
                let parts: Vec<Option<Undef>> =
                    xs.iter().map(|x| self.undef(&Self::sub(t, x), w)).collect();
                Undef::intersection(parts)
            }
            TExpr::Param(p) => match t.env.get(p) {
                Some(bound) => {
                    let bound = bound.clone();
                    self.undef(&bound, w)
                }
                // Only the callee's own type parameters are unbound (a declaration's are
                // bound to an argument, a default or an unknown type): a type the
                // caller chooses.
                None => Some(Undef::No),
            },
            TExpr::Ref { target, args } => {
                if let TRef::Global(n) = target {
                    return match (n.as_str(), args.as_slice()) {
                        // Homomorphic mapped types keep `undefined`: `Readonly<string | undefined>`.
                        // Over `any` or `unknown` they are not read.
                        ("Partial" | "Readonly" | "Required", [a]) => {
                            match self.undef(&Self::sub(t, a), w)? {
                                u @ (Undef::Yes | Undef::No) => Some(u),
                                Undef::Any | Undef::Top => None,
                            }
                        }
                        // `Pick` and `Omit` map over keys, so they are always objects, even
                        // over a type with an `undefined` member (`Pick<X | undefined, never>`).
                        ("Pick" | "Omit", [_, _]) => Some(Undef::No),
                        _ => DEFINED_GLOBALS.contains(&n.as_str()).then_some(Undef::No),
                    };
                }
                // A name with no declaration Drift reads (`import X = NS.Y`, an
                // uninstalled package's type) is unknown.
                let (m2, name, decl) = self.find_decl(&t.m, target)?;
                match decl {
                    TypeDecl::Interface { .. } | TypeDecl::Class { .. } | TypeDecl::Enum => {
                        Some(Undef::No)
                    }
                    TypeDecl::Alias { params, ty } => {
                        let env = self.bind(t, &m2, &params, args)?;
                        let id = m2.id.clone();
                        w.expand(&id, &name, |w| self.undef(&Ty { m: m2, e: ty, env }, w))
                    }
                    TypeDecl::Opaque => None,
                }
            }
        }
    }

    /// The string literal keys of a `Pick`/`Omit` key argument.
    fn key_set(&self, t: &Ty, w: &mut Walk) -> Option<Vec<String>> {
        w.step()?;
        match &t.e {
            TExpr::Str(s) => Some(vec![s.clone()]),
            TExpr::Union(xs) => {
                let mut out = Vec::new();
                for x in xs {
                    out.extend(self.key_set(&Self::sub(t, x), w)?);
                }
                Some(out)
            }
            TExpr::Param(p) => {
                let bound = t.env.get(p)?.clone();
                self.key_set(&bound, w)
            }
            TExpr::Ref { target, args } if !matches!(target, TRef::Global(_)) => {
                match self.find_decl(&t.m, target)? {
                    (m2, name, TypeDecl::Alias { params, ty }) => {
                        let env = self.bind(t, &m2, &params, args)?;
                        let id = m2.id.clone();
                        w.expand(&id, &name, |w| self.key_set(&Ty { m: m2, e: ty, env }, w))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn object_shape(t: &Ty, o: &crate::types::ObjType) -> Shape {
        Shape {
            props: o
                .props
                .iter()
                .map(|(k, p)| {
                    (
                        k.clone(),
                        Prop {
                            opt: if p.optional {
                                Opt::Question
                            } else {
                                Opt::Declared
                            },
                            ty: Some(Self::sub(t, &p.ty)),
                        },
                    )
                })
                .collect(),
            open: o.open,
            augmented: false,
        }
    }

    /// Combine the sides of an intersection (or an interface and what it extends).
    fn merge(&self, parts: Vec<Shape>, w: &mut Walk) -> Shape {
        let mut out = Shape::default();
        let mut seen: BTreeMap<String, Vec<Prop>> = BTreeMap::new();
        for p in parts {
            out.open |= p.open;
            out.augmented |= p.augmented;
            for (k, v) in p.props {
                seen.entry(k).or_default().push(v);
            }
        }
        for (k, mut props) in seen {
            let prop = if props.len() == 1 {
                props.pop().expect("one")
            } else {
                // The property's type is the intersection of the sides' types:
                // `undefined` survives only if every side has it, and `unknown` is
                // the identity (`{ a?: string } & { a: unknown }` keeps `undefined`).
                let us: Vec<Option<Undef>> = props.iter().map(|p| self.prop_undef(p, w)).collect();
                let opt = match Undef::intersection(us) {
                    Some(Undef::Yes) => Opt::Question,
                    Some(Undef::No | Undef::Any | Undef::Top) => Opt::Required,
                    None => Opt::Unknown,
                };
                Prop { opt, ty: None }
            };
            out.props.insert(k, prop);
        }
        out
    }

    /// The property set of type `t`; `None` when it is not an object type Drift can read.
    fn shape(&self, t: &Ty, w: &mut Walk) -> Option<Shape> {
        w.step()?;
        match &t.e {
            TExpr::Object(o) => Some(Self::object_shape(t, o)),
            TExpr::Param(p) => {
                let bound = t.env.get(p)?.clone();
                self.shape(&bound, w)
            }
            TExpr::Intersection(xs) => {
                let mut parts = Vec::new();
                for x in xs {
                    let x = Self::sub(t, x);
                    // `X & unknown` is `X`.
                    if self.undef(&x, w) == Some(Undef::Top) {
                        continue;
                    }
                    parts.push(self.shape(&x, w)?);
                }
                if parts.is_empty() {
                    return None;
                }
                Some(self.merge(parts, w))
            }
            TExpr::Ref { target, args } => self.ref_shape(t, target, args, w),
            _ => None,
        }
    }

    fn ref_shape(&self, t: &Ty, target: &TRef, args: &[TExpr], w: &mut Walk) -> Option<Shape> {
        if let TRef::Global(g) = target {
            let inner = |w: &mut Walk| self.shape(&Self::sub(t, args.first()?), w);
            return match (g.as_str(), args.len()) {
                ("Partial", 1) => {
                    let mut s = inner(w)?;
                    for p in s.props.values_mut() {
                        p.opt = Opt::Question;
                    }
                    Some(s)
                }
                ("Required", 1) => {
                    let mut s = inner(w)?;
                    for p in s.props.values_mut() {
                        // `-?` also strips the `undefined` that `?` adds; a declared
                        // `undefined` member is left to the type checker.
                        let plain = match &p.ty {
                            Some(ty) => self.undef(ty, w) == Some(Undef::No),
                            None => false,
                        };
                        p.opt = if plain { Opt::Required } else { Opt::Unknown };
                    }
                    Some(s)
                }
                ("Readonly", 1) => inner(w),
                ("Pick", 2) => {
                    let s = inner(w)?;
                    // An augmentation may give the interface an index signature.
                    if s.augmented {
                        return None;
                    }
                    let keys = self.key_set(&Self::sub(t, &args[1]), w)?;
                    let mut out = Shape::default();
                    for k in keys {
                        // Picking a key the type does not list is a type error.
                        out.props.insert(k.clone(), s.props.get(&k)?.clone());
                    }
                    Some(out)
                }
                ("Omit", 2) => {
                    let mut s = inner(w)?;
                    // Over an index signature, `keyof` is `string`: `Omit` keeps only
                    // the index signature, and no named property. An augmentation may
                    // add one.
                    if s.open || s.augmented {
                        return None;
                    }
                    for k in self.key_set(&Self::sub(t, &args[1]), w)? {
                        s.props.remove(&k);
                    }
                    Some(s)
                }
                _ => None,
            };
        }
        let (m2, name, decl) = self.find_decl(&t.m, target)?;
        let id = m2.id.clone();
        match decl {
            TypeDecl::Alias { params, ty } => {
                let env = self.bind(t, &m2, &params, args)?;
                w.expand(&id, &name, |w| self.shape(&Ty { m: m2, e: ty, env }, w))
            }
            TypeDecl::Interface {
                params,
                extends,
                body,
            } => {
                let env = self.bind(t, &m2, &params, args)?;
                let own = Ty {
                    m: m2,
                    e: TExpr::Object(body.clone()),
                    env,
                };
                let augmented = self.augmented.contains(&name);
                w.expand(&id, &name, |w| {
                    let mut parts = Vec::new();
                    for e in &extends {
                        parts.push(self.shape(&Self::sub(&own, e), w)?);
                    }
                    let mut s = self.with_own(parts, Self::object_shape(&own, &body), w);
                    s.augmented |= augmented;
                    Some(s)
                })
            }
            TypeDecl::Class {
                params,
                extends,
                body,
            } => {
                let body = body?;
                let env = self.bind(t, &m2, &params, args)?;
                let own = Ty {
                    m: m2,
                    e: TExpr::Object(body.clone()),
                    env,
                };
                // An interface of the class's name merges into the class.
                let augmented = self.augmented.contains(&name);
                w.expand(&id, &name, |w| {
                    let mut parts = Vec::new();
                    if let Some(e) = &extends {
                        parts.push(self.shape(&Self::sub(&own, e), w)?);
                    }
                    let mut s = self.with_own(parts, Self::object_shape(&own, &body), w);
                    s.augmented |= augmented;
                    Some(s)
                })
            }
            TypeDecl::Enum | TypeDecl::Opaque => None,
        }
    }

    /// Inherited members overridden by a declaration's own members.
    fn with_own(&self, inherited: Vec<Shape>, own: Shape, w: &mut Walk) -> Shape {
        let mut s = self.merge(inherited, w);
        s.open |= own.open;
        s.props.extend(own.props);
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A declaration file's types are lowered once and then read from the cache, under
    /// a key of its name and content: the same text means other declarations under a
    /// `.ts` name (only a `.d.ts` file exports what it does not mark exported).
    #[test]
    fn declared_types_are_cached_by_name_and_content() {
        let dir = tempfile::tempdir().unwrap();
        let cache = types_cache(dir.path());
        let text = "interface Opts { a: string }\ndeclare function f(o: Opts): void;\n";
        let lowered = |name: &str| crate::lower::lower_file(name, text).types;
        assert_ne!(lowered("opts.d.ts"), lowered("opts.ts"));
        for name in ["opts.d.ts", "opts.ts"] {
            assert_eq!(declared_types(Some(&cache), name, text), lowered(name));
            assert_eq!(declared_types(None, name, text), lowered(name));
        }
        // Entries are read back: a planted one is what a later call gets, for its own
        // name and content only.
        let planted = RawTypes {
            star: vec!["./planted".into()],
            ..RawTypes::default()
        };
        let fresh = tempfile::tempdir().unwrap();
        let cache = types_cache(fresh.path());
        cache.put(&types_key("opts.d.ts", text), &planted);
        assert_eq!(*declared_types(Some(&cache), "opts.d.ts", text), planted);
        assert_eq!(
            declared_types(Some(&cache), "opts.ts", text),
            lowered("opts.ts")
        );
        let edited = format!("{text}// edited\n");
        assert_ne!(*declared_types(Some(&cache), "opts.d.ts", &edited), planted);
    }
}
