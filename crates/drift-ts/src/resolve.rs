//! Repo-level pass: resolve import specifiers to canonical module ids, follow
//! re-export chains to each name's origin, and produce final [`FileFacts`].

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use drift_core::ingest::rel_posix;
use drift_core::{
    Export, ExportKind, FileFacts, Import, ImportLoad, Registry, RegistryItem, Symbol, Wrap,
};
use oxc_resolver::{
    FileMetadata, FileSystem, FileSystemOs, ResolveError, ResolveOptions, ResolverGeneric,
    TsconfigDiscovery,
};

use crate::lower::registries::{RawList, RawSlot};
use crate::lower::{RawBase, RawExportTarget, RawFile, RawOperand, RawRef};

const NODE_BUILTINS: &[&str] = &[
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "crypto",
    "dgram",
    "dns",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "module",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "querystring",
    "readline",
    "stream",
    "stream/promises",
    "string_decoder",
    "timers",
    "tls",
    "url",
    "util",
    "v8",
    "vm",
    "worker_threads",
    "zlib",
];

/// Maximum re-export hops followed before giving up (guards cycles).
const MAX_HOPS: usize = 32;
/// Deepest chain of composed Nest decorators followed ([`Linker::composed_guards`]).
const MAX_COMPOSED_HOPS: usize = 8;
/// Nest's `UseGuards`, canonical: the key of a guard in `decorator_args`.
const NEST_USE_GUARDS: &str = "pkg:@nestjs/common#UseGuards";

/// The operating system's file system, except that a read refuses what a
/// repository can plant to hang or exhaust the resolver: a `package.json` or
/// `tsconfig.json` that is a FIFO, a link to a device (`/dev/zero`), or larger than
/// [`drift_core::fsutil::MAX_CONFIG_BYTES`]
/// ([`drift_core::fsutil::read_regular`]). The resolver sees an unreadable file.
#[derive(Clone)]
pub struct SafeFs(FileSystemOs);

impl FileSystem for SafeFs {
    fn new() -> Self {
        Self(FileSystemOs::new())
    }

    fn read(&self, path: &Path) -> std::io::Result<Vec<u8>> {
        drift_core::fsutil::read_regular(path, drift_core::fsutil::MAX_CONFIG_BYTES)
    }

    fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
        FileSystemOs::validate_string(self.read(path)?)
    }

    fn metadata(&self, path: &Path) -> std::io::Result<FileMetadata> {
        self.0.metadata(path)
    }

    fn symlink_metadata(&self, path: &Path) -> std::io::Result<FileMetadata> {
        self.0.symlink_metadata(path)
    }

    fn read_link(&self, path: &Path) -> Result<PathBuf, ResolveError> {
        self.0.read_link(path)
    }

    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf> {
        self.0.canonicalize(path)
    }
}

type Resolver = ResolverGeneric<SafeFs>;

/// Resolves specifiers from a file to canonical module ids.
pub struct ModuleResolver {
    root: PathBuf,
    resolver: Resolver,
    /// Same options without tsconfig discovery, for repos whose tsconfig cannot be loaded.
    plain: Resolver,
    /// Workspace package name -> package directory, for monorepos without `node_modules`.
    workspace: BTreeMap<String, PathBuf>,
    /// Directory (its bytes, so a lookup neither allocates nor compares path
    /// components) -> specifier -> module id.
    cache: Mutex<ByDir<String>>,
    /// Directory -> nearest tsconfig `paths`, for repos whose tsconfig the resolver cannot load.
    tsconfig_paths: Mutex<HashMap<PathBuf, Option<Arc<TsPaths>>>>,
    /// `tsconfig.json` file -> its `paths`, for [`ModuleResolver::ts_paths_for`]: every
    /// directory below one tsconfig reads the same chain.
    tsconfig_files: Mutex<HashMap<PathBuf, Option<Arc<TsPaths>>>>,
    /// Package directory -> subpath -> [`ModuleResolver::workspace_source_target`]:
    /// every unresolved import of a workspace package read and parsed its manifest.
    workspace_targets: Mutex<ByDir<Option<String>>>,
}

/// Directory (its bytes) -> string key -> answer.
type ByDir<T> = HashMap<Vec<u8>, HashMap<String, T>>;

/// `(baseUrl, paths, directory paths are relative to)` read from one tsconfig chain.
type TsconfigInfo = (Option<PathBuf>, BTreeMap<String, Vec<String>>, PathBuf);

/// `compilerOptions.paths` with absolute base directory.
#[derive(Debug, Default)]
struct TsPaths {
    base: PathBuf,
    /// `compilerOptions.baseUrl`, when set: bare-looking specifiers resolve against it.
    base_url: Option<PathBuf>,
    /// (pattern, targets), longest prefix first.
    entries: Vec<(String, Vec<String>)>,
}

/// Strip `//` and `/* */` comments and trailing commas from JSONC.
pub(crate) fn strip_jsonc(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut in_str = false;
    while i < b.len() {
        let c = b[i];
        if in_str && !c.is_ascii() {
            // Copy a full UTF-8 sequence (a `paths` target like `./src/café/*`).
            let len = text[i..].chars().next().map_or(1, char::len_utf8);
            out.push_str(&text[i..i + len]);
            i += len;
            continue;
        }
        if in_str {
            out.push(c as char);
            if c == b'\\' && i + 1 < b.len() {
                if b[i + 1].is_ascii() {
                    out.push(b[i + 1] as char);
                    i += 2;
                } else {
                    i += 1;
                }
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
                out.push('"');
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
            b',' => {
                let mut j = i + 1;
                while j < b.len() && (b[j] as char).is_whitespace() {
                    j += 1;
                }
                if !matches!(b.get(j), Some(b'}') | Some(b']')) {
                    out.push(',');
                }
                i += 1;
            }
            _ => {
                // Copy a full UTF-8 sequence.
                let len = match c {
                    0x00..=0x7f => 1,
                    0xc0..=0xdf => 2,
                    0xe0..=0xef => 3,
                    _ => 4,
                };
                let end = (i + len).min(b.len());
                out.push_str(std::str::from_utf8(&b[i..end]).unwrap_or(""));
                i = end;
            }
        }
    }
    out
}

/// True when `spec` is a syntactically valid bare npm package specifier.
pub(crate) fn bare_package(spec: &str) -> Option<&str> {
    if spec.starts_with('.')
        || spec.starts_with('/')
        || spec.starts_with('#')
        || spec.starts_with('~')
    {
        return None;
    }
    let mut parts = spec.splitn(3, '/');
    let first = parts.next()?;
    if let Some(scope) = first.strip_prefix('@') {
        let name = parts.next()?;
        if scope.is_empty() || name.is_empty() {
            return None;
        }
        Some(&spec[..first.len() + 1 + name.len()])
    } else if first.is_empty() {
        None
    } else {
        Some(first)
    }
}

impl ModuleResolver {
    pub fn new(root: &Path, workspace: BTreeMap<String, PathBuf>) -> Self {
        let options = ResolveOptions {
            tsconfig: Some(TsconfigDiscovery::Auto),
            extensions: [
                ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".d.ts",
            ]
            .map(String::from)
            .to_vec(),
            extension_alias: vec![
                (
                    ".js".into(),
                    vec![".ts".into(), ".tsx".into(), ".js".into()],
                ),
                (".mjs".into(), vec![".mts".into(), ".mjs".into()]),
                (".cjs".into(), vec![".cts".into(), ".cjs".into()]),
            ],
            condition_names: ["types", "import", "require", "node", "default"]
                .map(String::from)
                .to_vec(),
            main_fields: ["types", "module", "main"].map(String::from).to_vec(),
            ..ResolveOptions::default()
        };
        let plain = Resolver::new_with_file_system(
            SafeFs::new(),
            ResolveOptions {
                tsconfig: None,
                ..options.clone()
            },
        );
        Self {
            root: root.to_path_buf(),
            plain,
            resolver: Resolver::new_with_file_system(SafeFs::new(), options),
            workspace,
            cache: Mutex::new(HashMap::new()),
            tsconfig_paths: Mutex::new(HashMap::new()),
            tsconfig_files: Mutex::new(HashMap::new()),
            workspace_targets: Mutex::new(HashMap::new()),
        }
    }

    /// Load `paths`/`baseUrl` from a tsconfig, following `extends` inside the repo.
    fn load_tsconfig(&self, file: &Path, depth: usize) -> Option<TsconfigInfo> {
        if depth > 8 || !file.starts_with(&self.root) {
            return None;
        }
        let text = std::fs::read_to_string(file).ok()?;
        let json: serde_json::Value = serde_json::from_str(&strip_jsonc(&text)).ok()?;
        let dir = file.parent()?.to_path_buf();
        let mut base_url = None;
        let mut paths = BTreeMap::new();
        let mut paths_dir = dir.clone();
        if let Some(ext) = json.get("extends").and_then(|e| e.as_str())
            && let Some(parent) = self.tsconfig_extends(&dir, ext)
            && let Some((b, p, pd)) = self.load_tsconfig(&parent, depth + 1)
        {
            base_url = b;
            paths = p;
            paths_dir = pd;
        }
        let co = json.get("compilerOptions");
        if let Some(b) = co.and_then(|c| c.get("baseUrl")).and_then(|b| b.as_str()) {
            base_url = Some(dir.join(b));
        }
        if let Some(p) = co.and_then(|c| c.get("paths")).and_then(|p| p.as_object()) {
            paths = p
                .iter()
                .map(|(k, v)| {
                    let targets = v
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|t| t.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    (k.clone(), targets)
                })
                .collect();
            paths_dir = dir.clone();
        }
        Some((base_url, paths, paths_dir))
    }

    fn tsconfig_extends(&self, dir: &Path, ext: &str) -> Option<PathBuf> {
        let with_json = |p: PathBuf| {
            if p.extension().is_some() {
                p
            } else {
                p.with_extension("json")
            }
        };
        if ext.starts_with('.') {
            return Some(with_json(dir.join(ext)));
        }
        let pkg = bare_package(ext)?;
        let pdir = self.workspace.get(pkg)?;
        let sub = ext[pkg.len()..].trim_start_matches('/');
        Some(if sub.is_empty() {
            pdir.join("tsconfig.json")
        } else {
            with_json(pdir.join(sub))
        })
    }

    fn ts_paths_for(&self, from_dir: &Path) -> Option<Arc<TsPaths>> {
        if let Some(v) = self
            .tsconfig_paths
            .lock()
            .ok()
            .and_then(|c| c.get(from_dir).cloned())
        {
            return v;
        }
        let mut found = None;
        let mut d = Some(from_dir);
        while let Some(dir) = d {
            if !dir.starts_with(&self.root) {
                break;
            }
            let f = dir.join("tsconfig.json");
            if f.is_file() {
                found = self.tsconfig_file_paths(&f);
                break;
            }
            d = dir.parent();
        }
        if let Ok(mut c) = self.tsconfig_paths.lock() {
            c.insert(from_dir.to_path_buf(), found.clone());
        }
        found
    }

    /// The `paths` of the tsconfig file `f` (with what it extends), when it sets any.
    fn tsconfig_file_paths(&self, f: &Path) -> Option<Arc<TsPaths>> {
        if let Some(v) = self
            .tsconfig_files
            .lock()
            .ok()
            .and_then(|c| c.get(f).cloned())
        {
            return v;
        }
        let mut found = None;
        if let Some((base_url, paths, paths_dir)) = self.load_tsconfig(f, 0)
            && (!paths.is_empty() || base_url.is_some())
        {
            let mut entries: Vec<_> = paths.into_iter().collect();
            entries.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));
            found = Some(Arc::new(TsPaths {
                base: base_url.clone().unwrap_or(paths_dir),
                base_url,
                entries,
            }));
        }
        if let Ok(mut c) = self.tsconfig_files.lock() {
            c.insert(f.to_path_buf(), found.clone());
        }
        found
    }

    /// Apply tsconfig `paths` ourselves when the resolver could not load the tsconfig.
    fn resolve_ts_paths(&self, from_dir: &Path, spec: &str) -> Option<String> {
        let tp = self.ts_paths_for(from_dir)?;
        for (pattern, targets) in &tp.entries {
            let captured = match pattern.split_once('*') {
                Some((pre, post)) => {
                    let Some(rest) = spec.strip_prefix(pre) else {
                        continue;
                    };
                    let Some(mid) = rest.strip_suffix(post) else {
                        continue;
                    };
                    mid
                }
                None if pattern == spec => "",
                None => continue,
            };
            for t in targets {
                let candidate = tp.base.join(t.replace('*', captured));
                if let Ok(res) = self.plain.resolve(&tp.base, &candidate.to_string_lossy())
                    && let Some(rel) = self.in_repo(res.path())
                {
                    return Some(rel);
                }
            }
        }
        None
    }

    /// The file a relative `spec` names from `from_dir`, found from the file system
    /// alone (no manifest read): the extension aliases (`./a.js` for `a.ts`), the
    /// path itself, the path with each extension, then its `index` file.
    fn relative_by_hand(&self, from_dir: &Path, spec: &str) -> Option<String> {
        const EXTENSIONS: &[&str] = &[
            "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "d.ts",
        ];
        let base = from_dir.join(spec);
        let mut candidates = Vec::new();
        let aliases: &[&str] = match base.extension().and_then(|e| e.to_str()) {
            Some("js") => &["ts", "tsx", "js"],
            Some("mjs") => &["mts", "mjs"],
            Some("cjs") => &["cts", "cjs"],
            _ => &[],
        };
        candidates.extend(aliases.iter().map(|e| base.with_extension(e)));
        candidates.push(base.clone());
        let name = base.file_name()?.to_string_lossy().into_owned();
        candidates.extend(
            EXTENSIONS
                .iter()
                .map(|e| base.with_file_name(format!("{name}.{e}"))),
        );
        candidates.extend(EXTENSIONS.iter().map(|e| base.join(format!("index.{e}"))));
        candidates
            .into_iter()
            .find(|c| c.is_file())
            .and_then(|c| c.canonicalize().ok())
            .and_then(|c| self.in_repo(&c))
    }

    fn in_repo(&self, path: &Path) -> Option<String> {
        if path.components().any(|c| c.as_os_str() == "node_modules") {
            return None;
        }
        rel_posix(&self.root, path)
    }

    /// For a workspace package whose `exports`/`main` targets are build output that
    /// does not exist, find the source file: `./dist/icons/index.mjs` -> `src/icons/index.tsx`.
    fn workspace_source_target(&self, pkg_dir: &Path, sub: &str) -> Option<String> {
        let dir = pkg_dir.as_os_str().as_encoded_bytes();
        if let Some(v) = self
            .workspace_targets
            .lock()
            .ok()
            .and_then(|c| c.get(dir)?.get(sub).cloned())
        {
            return v;
        }
        let v = self.workspace_source_target_uncached(pkg_dir, sub);
        if let Ok(mut c) = self.workspace_targets.lock() {
            let subs = match c.get_mut(dir) {
                Some(s) => s,
                None => c.entry(dir.to_vec()).or_default(),
            };
            subs.insert(sub.to_string(), v.clone());
        }
        v
    }

    fn workspace_source_target_uncached(&self, pkg_dir: &Path, sub: &str) -> Option<String> {
        fn collect(v: &serde_json::Value, out: &mut Vec<String>) {
            match v {
                serde_json::Value::String(s) => out.push(s.clone()),
                serde_json::Value::Object(m) => m.values().for_each(|x| collect(x, out)),
                serde_json::Value::Array(a) => a.iter().for_each(|x| collect(x, out)),
                _ => {}
            }
        }
        let text = std::fs::read_to_string(pkg_dir.join("package.json")).ok()?;
        let json: serde_json::Value = serde_json::from_str(&text).ok()?;
        let key = if sub.is_empty() {
            ".".to_string()
        } else {
            format!(".{sub}")
        };
        let mut targets = Vec::new();
        match json.get("exports") {
            Some(serde_json::Value::Object(m)) if m.keys().any(|k| k.starts_with('.')) => {
                if let Some(v) = m.get(&key) {
                    collect(v, &mut targets);
                }
            }
            Some(v) if key == "." => collect(v, &mut targets),
            _ => {}
        }
        if key == "." {
            for f in ["module", "main", "types"] {
                if let Some(serde_json::Value::String(s)) = json.get(f) {
                    targets.push(s.clone());
                }
            }
        }
        for t in targets {
            let t = t.trim_start_matches("./");
            if pkg_dir.join(t).is_file() {
                continue; // a real file: the normal resolver already had its chance
            }
            let mut segs: Vec<&str> = t.split('/').collect();
            let Some(i) = segs
                .iter()
                .position(|s| matches!(*s, "dist" | "build" | "lib" | "out" | "esm" | "cjs"))
            else {
                continue;
            };
            segs[i] = "src";
            let joined = segs.join("/");
            let stem = joined
                .trim_end_matches(".d.ts")
                .trim_end_matches(".d.mts")
                .trim_end_matches(".mjs")
                .trim_end_matches(".cjs")
                .trim_end_matches(".js");
            if let Ok(res) = self.plain.resolve(pkg_dir, &format!("./{stem}"))
                && let Some(rel) = self.in_repo(res.path())
            {
                return Some(rel);
            }
        }
        None
    }

    /// tsconfig `compilerOptions` set to `true`, following `extends` (child wins).
    pub fn tsconfig_flags(&self, file: &Path) -> BTreeSet<String> {
        let mut chain = Vec::new();
        let mut cur = Some(file.to_path_buf());
        while let Some(f) = cur.take() {
            if chain.len() > 8 || !f.starts_with(&self.root) {
                break;
            }
            let Ok(text) = std::fs::read_to_string(&f) else {
                break;
            };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&strip_jsonc(&text)) else {
                break;
            };
            if let (Some(ext), Some(dir)) =
                (json.get("extends").and_then(|e| e.as_str()), f.parent())
            {
                cur = self.tsconfig_extends(dir, ext);
            }
            chain.push(json);
        }
        let mut flags: BTreeMap<String, bool> = BTreeMap::new();
        for json in chain.iter().rev() {
            if let Some(o) = json.get("compilerOptions").and_then(|c| c.as_object()) {
                for (k, v) in o {
                    if let Some(b) = v.as_bool() {
                        flags.insert(k.clone(), b);
                    }
                }
            }
        }
        flags
            .into_iter()
            .filter(|(_, v)| *v)
            .map(|(k, _)| k)
            .collect()
    }

    /// The file `spec` resolves to from `from_dir`, wherever it is (`node_modules`
    /// included), for reading type declarations. `None` when it does not resolve.
    pub(crate) fn resolve_path(&self, from_dir: &Path, spec: &str) -> Option<PathBuf> {
        self.resolver
            .resolve(from_dir, spec)
            .ok()
            .map(|r| r.path().to_path_buf())
    }

    /// Canonical module id for `spec` imported from the directory `from_dir`.
    pub fn resolve(&self, from_dir: &Path, spec: &str) -> String {
        let dir = from_dir.as_os_str().as_encoded_bytes();
        if let Some(v) = self
            .cache
            .lock()
            .ok()
            .and_then(|c| c.get(dir)?.get(spec).cloned())
        {
            return v;
        }
        let v = self.resolve_uncached(from_dir, spec);
        if let Ok(mut c) = self.cache.lock() {
            let specs = match c.get_mut(dir) {
                Some(s) => s,
                None => c.entry(dir.to_vec()).or_default(),
            };
            specs.insert(spec.to_string(), v.clone());
        }
        v
    }

    fn resolve_uncached(&self, from_dir: &Path, spec: &str) -> String {
        if let Some(b) = spec.strip_prefix("node:") {
            return format!("pkg:node:{b}");
        }
        if NODE_BUILTINS.contains(&spec) {
            return format!("pkg:node:{spec}");
        }
        let first = self.resolver.resolve(from_dir, spec);
        if let Ok(res) = &first {
            if let Some(rel) = self.in_repo(res.path()) {
                return rel;
            }
            if bare_package(spec).is_some() {
                return format!("pkg:{spec}");
            }
        }
        if !spec.starts_with('.')
            && let Some(rel) = self.resolve_ts_paths(from_dir, spec)
        {
            return rel;
        }
        // `baseUrl`: TypeScript tries it before node_modules for non-relative specifiers.
        if !spec.starts_with('.')
            && !spec.starts_with('/')
            && let Some(tp) = self.ts_paths_for(from_dir)
            && let Some(base) = &tp.base_url
            && let Ok(res) = self.plain.resolve(base, &base.join(spec).to_string_lossy())
            && let Some(rel) = self.in_repo(res.path())
        {
            return rel;
        }
        if bare_package(spec).is_none()
            && let Ok(res) = self.plain.resolve(from_dir, spec)
            && let Some(rel) = self.in_repo(res.path())
        {
            return rel;
        }
        if let Some(pkg) = bare_package(spec) {
            // Monorepo workspace package that is not installed: resolve inside its directory.
            if let Some(dir) = self.workspace.get(pkg) {
                let sub = &spec[pkg.len()..];
                // Self-reference through the package's own `exports` map first.
                if let Ok(res) = self.plain.resolve(dir, spec)
                    && let Some(rel) = self.in_repo(res.path())
                {
                    return rel;
                }
                // Built packages: `exports` points at `dist/` output that is not in a fresh
                // checkout. Map each target back to its source under `src/`.
                if let Some(rel) = self.workspace_source_target(dir, sub) {
                    return rel;
                }
                let target = if sub.is_empty() {
                    ".".to_string()
                } else {
                    format!(".{sub}")
                };
                if let Ok(res) = self.plain.resolve(dir, &target)
                    && let Some(rel) = self.in_repo(res.path())
                {
                    return rel;
                }
                for entry in [
                    "src/index.ts",
                    "src/index.tsx",
                    "index.ts",
                    "index.tsx",
                    "src/index.js",
                    "index.js",
                ] {
                    let p = dir.join(entry);
                    if sub.is_empty()
                        && p.is_file()
                        && let Some(rel) = self.in_repo(&p)
                    {
                        return rel;
                    }
                }
            }
            return format!("pkg:{spec}");
        }
        // A `package.json` on the way up that is not JSON, or cannot be read (a FIFO, a
        // link to a device): the resolver fails every specifier below it. A relative
        // one names its file without help from any manifest.
        if spec.starts_with('.')
            && matches!(first, Err(ResolveError::Json(_) | ResolveError::IOError(_)))
            && let Some(rel) = self.relative_by_hand(from_dir, spec)
        {
            return rel;
        }
        // Relative or aliased specifier that did not resolve.
        let joined =
            rel_posix(&self.root, &from_dir.join(spec)).unwrap_or_else(|| spec.to_string());
        format!("unresolved:{joined}")
    }
}

/// Find workspace packages (`package.json` with a `name`) outside `node_modules`.
pub fn discover_workspace(root: &Path) -> BTreeMap<String, PathBuf> {
    let Ok(walked) = drift_core::ingest::walk(root, 0, &crate::repo::is_config_path) else {
        return BTreeMap::new();
    };
    workspace_from(
        root,
        &crate::repo::read_config(&walked.config).package_jsons,
    )
}

/// Workspace packages from `package.json` texts. When a name is used twice, a
/// nested package wins over the repo root (in a monorepo the root manifest is
/// often named like its main package), then the first by path, so the result
/// does not depend on directory listing order.
pub fn workspace_from(
    root: &Path,
    package_jsons: &[(String, String)],
) -> BTreeMap<String, PathBuf> {
    let mut out = BTreeMap::new();
    let mut ordered: Vec<&(String, String)> = package_jsons.iter().collect();
    ordered.sort_by_key(|(rel, _)| (rel == "package.json", rel.clone()));
    for (rel, text) in ordered {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else {
            continue;
        };
        if let (Some(name), Some(dir)) = (
            json.get("name").and_then(|n| n.as_str()),
            root.join(rel).parent(),
        ) {
            out.entry(name.to_string())
                .or_insert_with(|| dir.to_path_buf());
        }
    }
    out
}

/// Every specifier a file uses: imports and re-export sources.
pub(crate) fn all_specs(f: &LoweredFile) -> BTreeSet<&str> {
    let mut out: BTreeSet<&str> = f.raw.imports.iter().map(|i| i.spec.as_str()).collect();
    out.extend(export_specs(f));
    out.extend(practice_specs(f));
    out
}

/// Specifiers the practice facts name: modules mocked and route modules a test calls.
pub(crate) fn practice_specs(f: &LoweredFile) -> impl Iterator<Item = &str> {
    f.raw
        .mocks
        .iter()
        .filter(|m| !m.starts_with(drift_core::practice::MSW_PREFIX))
        .map(String::as_str)
        .chain(
            f.raw
                .test_requests
                .iter()
                .filter_map(|t| t.target.as_deref()),
        )
}

/// The symbol a canonical reference names: `module#Name`, member paths and calls
/// cut (`src/a.ts#UsersModule.forRoot()` -> `src/a.ts#UsersModule`).
pub(crate) fn symbol_of(canonical: &str) -> String {
    match canonical.split_once('#') {
        Some((module, rest)) => {
            let name = rest.split(['.', '(']).next().unwrap_or(rest);
            format!("{module}#{name}")
        }
        None => canonical.to_string(),
    }
}

/// A glob from `import.meta.glob` or `require.context`, repo-relative: `./x/*.ts`
/// against the file's directory, `/src/x/*.ts` against its package. `None` for a
/// bare or aliased pattern, or one that leaves the repository.
pub(crate) fn discover_glob(rel: &str, package: &str, glob: &str) -> Option<String> {
    let (base, rest) = if let Some(r) = glob.strip_prefix('/') {
        (package, r)
    } else if glob.starts_with("./") || glob.starts_with("../") {
        (rel.rsplit_once('/').map_or("", |(d, _)| d), glob)
    } else {
        return None;
    };
    let mut parts: Vec<&str> = base.split('/').filter(|p| !p.is_empty()).collect();
    for seg in rest.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// Re-export sources (`export ... from "spec"`).
pub(crate) fn export_specs(f: &LoweredFile) -> BTreeSet<&str> {
    f.raw
        .exports
        .iter()
        .filter_map(|e| match &e.target {
            RawExportTarget::From { spec, .. } | RawExportTarget::All { spec } => {
                Some(spec.as_str())
            }
            RawExportTarget::Local(_) => None,
        })
        .collect()
}

/// Specifiers named by router mounts (targets and middleware).
pub(crate) fn mount_specs(f: &LoweredFile) -> BTreeSet<&str> {
    use crate::lower::RawNestRoute;
    // What a Nest module applies to the routes of other files, and to which.
    let nest = f.raw.nest_applies.iter().flat_map(|a| {
        a.middleware
            .iter()
            .chain(a.routes.iter().chain(&a.exclude).filter_map(|r| match r {
                RawNestRoute::Controller(c) => Some(c),
                RawNestRoute::Path { .. } => None,
            }))
    });
    f.raw
        .mounts
        .iter()
        .flat_map(|m| std::iter::once(&m.target).chain(&m.middleware))
        .chain(nest)
        .chain(
            f.raw
                .nest_global_guards
                .iter()
                .filter_map(|g| g.guard.as_ref()),
        )
        .chain(&f.raw.node_listener_refs)
        .filter_map(|r| match &r.base {
            RawBase::Import { spec, .. } => Some(spec.as_str()),
            _ => None,
        })
        .collect()
}

/// One lowered file plus its location, ready for the repo pass.
pub struct LoweredFile {
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub hash: String,
    pub raw: RawFile,
}

/// A module's export table with specifiers already resolved.
#[derive(Default)]
struct ModuleExports {
    /// name -> target
    named: BTreeMap<String, ResolvedTarget>,
    /// `export *` sources, in sorted order.
    all: Vec<String>,
}

/// One mount of a router: (the router it is mounted on, `module#binding`, or the
/// mounting module alone when that is not known; the prefix; the middleware).
type MountParent = (
    String,
    String,
    Vec<String>,
    Vec<String>,
    Vec<drift_core::GuardCall>,
);

/// Package calls that are handed an application and register nothing on it: they
/// start a server on it, wrap it for a platform, or drive it in a test.
const PLAIN_APP_CALLS: &[&str] = &[
    "pkg:node:http#createServer",
    "pkg:node:http#default.createServer",
    "pkg:http#createServer",
    "pkg:http#default.createServer",
    "pkg:node:https#createServer",
    "pkg:node:https#default.createServer",
    "pkg:https#createServer",
    "pkg:https#default.createServer",
    "pkg:serverless-http#default",
    "pkg:supertest#default",
    "pkg:@hono/node-server#serve",
    "pkg:@vendia/serverless-express#default",
];

/// By function and parameter: the middleware the function registers on the router
/// it is handed there (`None` where some of it is not read), and whether it is a
/// plugin `fastify-plugin` wraps ([`crate::lower::RawRegisters`]).
type Registers = BTreeMap<(String, u32), (Option<Vec<String>>, bool)>;

/// How many mounts of one router get an entry point each.
const MAX_MOUNTS: usize = 16;

/// One way a router is served: its full prefix and the middleware inherited on the
/// way, outermost first. `opaque` when two mounts under one path differ.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct MountChain {
    prefix: String,
    middleware: Vec<String>,
    opaque: bool,
    /// What runs before the routes on the way and is no wrap
    /// ([`drift_core::Symbol::app_middleware`]), outermost first.
    hooks: Vec<String>,
    /// The calls written at the guard positions on the way
    /// ([`drift_core::Listed::guard_calls`]).
    calls: Vec<drift_core::GuardCall>,
}

#[derive(Clone)]
enum ResolvedTarget {
    Local(String),
    From { module: String, name: String },
}

/// Turns lowered files into final facts with canonical references.
pub struct Linker<'r> {
    resolver: &'r ModuleResolver,
    /// rel_path -> (spec -> module id)
    specs: BTreeMap<String, BTreeMap<String, String>>,
    modules: BTreeMap<String, ModuleExports>,
    /// What mounts each router (`module#binding`), and, under a module's path alone,
    /// what mounts something of the module that is no router Drift knows (a Fastify
    /// plugin function): (the router it is mounted on, the prefix, the middleware
    /// active there, outermost first, as canonical ids).
    mount_parents: BTreeMap<String, BTreeSet<MountParent>>,
    /// What each function of the repository registers on the router it is handed
    /// as its n-th argument ([`crate::lower::RawRegisters`]): the middleware,
    /// canonical, or `None` where some of it is not read.
    registers: Registers,
    /// The function a Fastify instance is decorated with under each name
    /// ([`crate::lower::RawFile::decorated`]), canonical, where the linked files
    /// decorate the name once and with a function; `None` for a name decorated
    /// more than once or with anything else.
    decorated: BTreeMap<String, Option<String>>,
    /// The calls each of them writes where it registers a guard
    /// ([`crate::lower::RawRegisters::calls`]), canonical.
    register_calls: BTreeMap<(String, u32), Vec<drift_core::GuardCall>>,
    /// Lazy-load helpers (`path#name`) -> indexes of the parameters they load, and
    /// the helper's directory (a relative specifier loads from there).
    loaders: BTreeMap<String, (BTreeSet<u32>, PathBuf)>,
    /// One-line environment helpers (`path#name`) -> indexes of the parameters whose
    /// variable they read ([`crate::lower::RawFile::env_helpers`]).
    env_helpers: BTreeMap<String, BTreeSet<u32>>,
    /// The functions and methods the linked files define that are not `async`
    /// (`path#name`, `path#Class.method`): a call of one whose value is dropped ran
    /// to its end ([`Linker::conditional_calls`]).
    sync_defs: BTreeSet<String>,
    /// The routers the linked files bind (`path#name`), and the functions that
    /// build one ([`crate::lower::RawFile::router_factories`]).
    routers: BTreeSet<String>,
    /// Nest decorators composed with `applyDecorators` (`path#name`) -> (guard classes,
    /// decorators composed in turn), canonical ([`RawFile::composed_decorators`]).
    composed: BTreeMap<String, (Vec<String>, Vec<String>)>,
    /// tRPC instances and the procedure builders proven to come from one.
    trpc: TrpcOrigins,
    /// Package directory -> built with Next.js ([`crate::nextjs::package_uses_next`]).
    next_packages: Mutex<BTreeMap<String, bool>>,
    /// Package directory -> the file-convention router it is built with
    /// ([`crate::filerouters::framework_of`]).
    file_routers: Mutex<BTreeMap<String, Option<crate::filerouters::Framework>>>,
    /// The files that export a middleware of a file-convention route
    /// ([`crate::lower::RawFile::route_middleware`]).
    route_middleware: BTreeSet<String>,
    /// What [`Linker::origin`] answered, per module and name.
    origins: OriginMemo,
    /// The middleware applied to the routes of each Nest application beside them
    /// ([`crate::lower::RawNestApply`]), with the package it is written in.
    nest: Vec<NestApply>,
    /// The packages whose Nest application is given a global prefix or versioning
    /// ([`crate::lower::RawFile::nest_prefixed`]).
    nest_prefixed: BTreeSet<String>,
    /// The guards registered for a whole Nest application
    /// ([`crate::lower::RawFile::nest_global_guards`]): the package the call is
    /// written in, and the entry each route of that package gets
    /// ([`drift_core::Symbol::app_middleware`]).
    nest_guards: Vec<(String, String)>,
    /// The text each top-level `const NAME = "text"` holds (`path#NAME`), of the
    /// files of a repository that reads Nest route metadata
    /// ([`crate::lower::RawFile::text_consts`]); empty for any other.
    texts: BTreeMap<String, String>,
    /// The functions that turn their caller away only by a value they hand back
    /// (`path#name`; [`drift_core::controls::RETURNS_REJECTION`]).
    hands_back: BTreeSet<String>,
    /// The refusal builders of the repository (`path#name`, with the status they
    /// answer; [`crate::lower::RawSymbol::refusal_builder`]).
    builders: BTreeMap<String, drift_core::CheckOutcome>,
    /// The functions whose body returns a value of the caller (`path#name`;
    /// [`drift_core::controls::RETURNS_CALLER`]), and the keys of the
    /// request-scoped holders some body binds a value of the caller on
    /// ([`drift_core::CALLER_HOLDER_TS`]): what an entry of
    /// [`drift_core::Symbol::caller_args`] may name after `via`.
    returns_caller: BTreeSet<String>,
    held: BTreeSet<String>,
    /// Functions that may turn a caller away by answering on the response they
    /// were handed, without throwing (`path#name`): one whose own body refuses and
    /// throws nothing, one of the same file that calls such a function, and one of
    /// any file that calls one of those by an import, a few calls deep. What a
    /// caller does with the value of a call of one is recorded
    /// ([`drift_core::controls::DROPS_RESULT_OF`]).
    answers: BTreeSet<String>,
}

/// One [`crate::lower::RawNestApply`], canonical.
struct NestApply {
    package: String,
    at: String,
    middleware: Vec<String>,
    routes: Vec<NestRoute>,
    exclude: Vec<NestRoute>,
    unread: bool,
}

/// One [`crate::lower::RawNestRoute`], canonical: a binding that is no controller
/// of the linked files is not read.
enum NestRoute {
    Path { path: String, method: String },
    Controller(String),
    Unread,
}

/// Whether a middleware runs for a route: it does, it does not, or that cannot be
/// told from what is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Cover {
    No,
    Unsure,
    Yes,
}

/// Middleware of packages that turn no caller away for who they are, given to a
/// Nest application's `use` or a module's `apply` [STRICT]: a closed list. Any
/// other package's may be the guard.
const NEST_PLAIN_MIDDLEWARE: &[&str] = &[
    "helmet",
    "cors",
    "compression",
    "cookie-parser",
    "body-parser",
    "express",
    "morgan",
    "express-rate-limit",
    "hpp",
    "csurf",
    "serve-static",
    "serve-favicon",
    "response-time",
    "method-override",
    "connect-timeout",
    "express-session",
    "cookie-session",
    "pino-http",
    "nestjs-pino",
    "express-winston",
    "express-mongo-sanitize",
    "graphql-upload",
    "swagger-ui-express",
];

fn path_segments(path: &str) -> Vec<&str> {
    path.split('/').filter(|s| !s.is_empty()).collect()
}

/// A segment that is a named parameter (`:id`, `{id}`).
fn param_segment(s: &str) -> bool {
    s.starts_with(':') || (s.starts_with('{') && s.ends_with('}') && !s.starts_with("{*"))
}

/// A segment that is a pattern of its own (`*`, `(.*)`, `ab*cd`, `{*splat}`).
fn pattern_segment(s: &str) -> bool {
    !param_segment(s) && s.contains(['*', '(', ')', '?', '+', '[', ']', '{', '}'])
}

/// A path that takes every route: `*`, `/*`, `(.*)`, `*splat`, `{*splat}`.
fn every_path(path: &str) -> bool {
    let segs = path_segments(path);
    matches!(segs.as_slice(), [one] if one.starts_with('*') || *one == "(.*)" || one.starts_with("{*"))
}

/// A middleware applied for `path` and `method` runs for the route. Nest registers
/// one given for every method as Express's `use` does (the path and what is under
/// it), and one given for a method as that method's own route (the path itself).
fn nest_applies(path: &str, method: &str, route: &[&str], route_method: &str) -> Cover {
    if !(method.is_empty() || method.eq_ignore_ascii_case(route_method)) {
        return Cover::No;
    }
    if every_path(path) {
        return Cover::Yes;
    }
    let pattern = path_segments(path);
    for (i, p) in pattern.iter().enumerate() {
        if pattern_segment(p) {
            return Cover::Unsure;
        }
        let Some(r) = route.get(i) else {
            return Cover::No;
        };
        match (param_segment(p), param_segment(r)) {
            (true, _) => {}
            // A parameter of the route may be the word the path names.
            (false, true) => return Cover::Unsure,
            (false, false) if !p.eq_ignore_ascii_case(r) => return Cover::No,
            (false, false) => {}
        }
    }
    if method.is_empty() || pattern.len() == route.len() {
        Cover::Yes
    } else {
        Cover::No
    }
}

/// A middleware excluded for `path` and `method` does not run for the route: the
/// path is matched whole against the request's.
fn nest_excluded(path: &str, method: &str, route: &[&str], route_method: &str) -> Cover {
    if !(method.is_empty() || method.eq_ignore_ascii_case(route_method)) {
        return Cover::No;
    }
    if every_path(path) {
        return Cover::Yes;
    }
    let pattern = path_segments(path);
    let mut some = false;
    for (i, p) in pattern.iter().enumerate() {
        if pattern_segment(p) {
            return Cover::Unsure;
        }
        let Some(r) = route.get(i) else {
            return Cover::No;
        };
        match (param_segment(p), param_segment(r)) {
            (true, _) => {}
            // Excluded for the requests whose parameter is that word only.
            (false, true) => some = true,
            (false, false) if !p.eq_ignore_ascii_case(r) => return Cover::No,
            (false, false) => {}
        }
    }
    if pattern.len() != route.len() {
        Cover::No
    } else if some {
        Cover::Unsure
    } else {
        Cover::Yes
    }
}

/// tRPC origins across the linked files (canonical `module#binding` ids): the
/// instances (`initTRPC...create()`), and the bindings proven to be procedure
/// builders, built from an instance's `.procedure` through builder steps, imports,
/// re-exports, `const` aliases, `const { procedure } = t` and the functions proven to
/// return one ([`crate::lower::RawTrpc`]). A binding whose chain leaves the linked
/// files, or reaches anything else, is not proven.
#[derive(Default)]
struct TrpcOrigins {
    instances: BTreeSet<String>,
    builders: BTreeSet<String>,
    /// Functions every `return` of which is proven to be a procedure builder.
    factories: BTreeSet<String>,
}

impl TrpcOrigins {
    /// True when `target` (a canonical reference) is a procedure builder: an
    /// instance's `.procedure`, a binding proven to be built from one, or a call of a
    /// function proven to return one (`mod#createTeamPbacProcedure()`).
    fn proves(&self, target: &str) -> bool {
        target
            .strip_suffix(".procedure")
            .is_some_and(|i| self.instances.contains(i))
            || self.builders.contains(target)
            || target
                .strip_suffix("()")
                .is_some_and(|f| self.factories.contains(f))
    }
}

/// [`Linker::origin`]'s answers. `origin` reads only the linker's export tables, which
/// do not change once it is built, and every file importing a name from a barrel asks
/// it again; files are linked in parallel, so the memo is split into locked shards by
/// module.
#[derive(Default)]
struct OriginMemo {
    /// module -> name -> origin, in the shard [`OriginMemo::shard`] picks.
    shards: [Mutex<HashMap<String, HashMap<String, String>>>; ORIGIN_SHARDS],
}

const ORIGIN_SHARDS: usize = 16;

impl OriginMemo {
    fn shard(&self, module: &str) -> &Mutex<HashMap<String, HashMap<String, String>>> {
        // FNV-1a: any stable spread works, the shard only limits contention.
        let h = module.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
        });
        &self.shards[(h % ORIGIN_SHARDS as u64) as usize]
    }

    fn get(&self, module: &str, name: &str) -> Option<String> {
        let shard = self.shard(module).lock().ok()?;
        shard.get(module)?.get(name).cloned()
    }

    fn put(&self, module: &str, name: &str, origin: &str) {
        if let Ok(mut shard) = self.shard(module).lock() {
            let names = match shard.get_mut(module) {
                Some(n) => n,
                None => shard.entry(module.to_string()).or_default(),
            };
            names.insert(name.to_string(), origin.to_string());
        }
    }
}

impl<'r> Linker<'r> {
    pub fn new(resolver: &'r ModuleResolver, files: &[LoweredFile]) -> Self {
        Self::with_specs(resolver, files, all_specs)
    }

    /// A linker that resolves only the specifiers `wanted` selects for each file.
    /// Re-export sources must always be included; [`Linker::link`] needs all of a
    /// file's specifiers.
    pub(crate) fn with_specs<'f>(
        resolver: &'r ModuleResolver,
        files: &'f [LoweredFile],
        wanted: impl Fn(&'f LoweredFile) -> BTreeSet<&'f str> + Sync,
    ) -> Self {
        use rayon::prelude::*;
        let specs: BTreeMap<String, BTreeMap<String, String>> = files
            .par_iter()
            .map(|f| {
                let dir = f.abs_path.parent().unwrap_or(&f.abs_path);
                let map = wanted(f)
                    .into_iter()
                    .map(|s| (s.to_string(), resolver.resolve(dir, s)))
                    .collect();
                (f.rel_path.clone(), map)
            })
            .collect();

        let mut modules = BTreeMap::new();
        for f in files {
            let m = &specs[&f.rel_path];
            let mut me = ModuleExports::default();
            for e in &f.raw.exports {
                match &e.target {
                    RawExportTarget::Local(l) => {
                        me.named
                            .insert(e.name.clone(), ResolvedTarget::Local(l.clone()));
                    }
                    RawExportTarget::From { spec, name } => {
                        me.named.insert(
                            e.name.clone(),
                            ResolvedTarget::From {
                                module: m[spec].clone(),
                                name: name.clone(),
                            },
                        );
                    }
                    RawExportTarget::All { spec } => me.all.push(m[spec].clone()),
                }
            }
            me.all.sort();
            me.all.dedup();
            modules.insert(f.rel_path.clone(), me);
        }
        let mut loaders: BTreeMap<String, (BTreeSet<u32>, PathBuf)> = BTreeMap::new();
        for f in files {
            let dir = f.abs_path.parent().unwrap_or(&f.abs_path);
            for (name, i) in &f.raw.loaders {
                loaders
                    .entry(format!("{}#{name}", f.rel_path))
                    .or_insert_with(|| (BTreeSet::new(), dir.to_path_buf()))
                    .0
                    .insert(*i);
            }
        }
        let mut env_helpers: BTreeMap<String, BTreeSet<u32>> = BTreeMap::new();
        for f in files {
            for (name, i) in &f.raw.env_helpers {
                env_helpers
                    .entry(format!("{}#{name}", f.rel_path))
                    .or_default()
                    .insert(*i);
            }
        }
        let mut sync_defs: BTreeSet<String> = BTreeSet::new();
        for f in files {
            for s in &f.raw.symbols {
                if s.kind == drift_core::SymbolKind::Function && !s.is_async {
                    sync_defs.insert(format!("{}#{}", f.rel_path, s.name));
                }
                for m in s.members.iter().filter(|m| !m.is_async) {
                    sync_defs.insert(format!("{}#{}.{}", f.rel_path, s.name, m.name));
                }
            }
        }
        let mut linker = Self {
            resolver,
            specs,
            modules,
            mount_parents: BTreeMap::new(),
            registers: BTreeMap::new(),
            decorated: BTreeMap::new(),
            register_calls: BTreeMap::new(),
            loaders,
            env_helpers,
            sync_defs,
            routers: files
                .iter()
                .flat_map(|f| {
                    f.raw
                        .routers
                        .iter()
                        .chain(&f.raw.router_factories)
                        .map(|r| format!("{}#{r}", f.rel_path))
                })
                .collect(),
            composed: BTreeMap::new(),
            trpc: TrpcOrigins::default(),
            next_packages: Mutex::new(BTreeMap::new()),
            file_routers: Mutex::new(BTreeMap::new()),
            route_middleware: files
                .iter()
                .filter(|f| f.raw.route_middleware)
                .map(|f| f.rel_path.clone())
                .collect(),
            origins: OriginMemo::default(),
            nest: Vec::new(),
            nest_prefixed: BTreeSet::new(),
            nest_guards: Vec::new(),
            texts: BTreeMap::new(),
            hands_back: BTreeSet::new(),
            builders: BTreeMap::new(),
            returns_caller: BTreeSet::new(),
            held: BTreeSet::new(),
            answers: BTreeSet::new(),
        };
        linker.link_nest(files);
        linker.registers = linker.registered(files);
        let mut decorated: BTreeMap<String, Option<String>> = BTreeMap::new();
        for f in files {
            for (name, function) in &f.raw.decorated {
                let function = function.as_ref().map(|r| linker.canon(&f.rel_path, r));
                decorated
                    .entry(name.clone())
                    .and_modify(|seen| *seen = None)
                    .or_insert(function);
            }
        }
        linker.decorated = decorated;
        linker.register_calls = files
            .iter()
            .flat_map(|f| {
                f.raw
                    .registers
                    .iter()
                    .filter(|r| !r.calls.is_empty())
                    .map(|r| {
                        (
                            (format!("{}#{}", f.rel_path, r.function), r.param),
                            r.calls
                                .iter()
                                .map(|c| linker.guard_call(&f.rel_path, c))
                                .collect::<Vec<_>>(),
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .collect();
        linker.mount_parents = linker.mounts(files);
        linker.trpc = linker.trpc_origins(files);
        let composed = files
            .iter()
            .flat_map(|f| {
                let linker = &linker;
                f.raw
                    .composed_decorators
                    .iter()
                    .map(move |(name, guards, inner)| {
                        let canon = |rs: &[RawRef]| -> Vec<String> {
                            rs.iter().map(|r| linker.canon(&f.rel_path, r)).collect()
                        };
                        (
                            format!("{}#{name}", f.rel_path),
                            (canon(guards), canon(inner)),
                        )
                    })
            })
            .collect();
        linker.composed = composed;
        linker
    }

    /// [`Linker::nest`] and [`Linker::nest_prefixed`] of `files`. What a test file
    /// applies is of the application its test builds.
    fn link_nest(&mut self, files: &[LoweredFile]) {
        use crate::lower::RawNestRoute;
        let controllers: BTreeSet<String> = files
            .iter()
            .flat_map(|f| {
                f.raw
                    .nest_routes
                    .iter()
                    .map(move |(_, class)| format!("{}#{class}", f.rel_path))
            })
            .collect();
        // The classes of the linked files (`path#name`).
        let classes: BTreeSet<String> = files
            .iter()
            .flat_map(|f| {
                f.raw
                    .symbols
                    .iter()
                    .filter(|s| s.kind == drift_core::SymbolKind::Class)
                    .map(move |s| format!("{}#{}", f.rel_path, s.name))
            })
            .collect();
        let mut memo = crate::PackageMemo::new();
        let mut nest = Vec::new();
        let mut prefixed = BTreeSet::new();
        let mut guards = Vec::new();
        // The applications each package builds: with more than one, a guard
        // registered on one may not be on the one that serves a route.
        let mut built: BTreeMap<String, u32> = BTreeMap::new();
        for f in files {
            if f.raw.nest_creates > 0 && !crate::lower::is_test_file(&f.rel_path) {
                let package = crate::package_of(&self.resolver.root, &f.abs_path, &mut memo);
                *built.entry(package).or_default() += f.raw.nest_creates;
            }
        }
        for f in files {
            if (f.raw.nest_applies.is_empty()
                && !f.raw.nest_prefixed
                && f.raw.nest_global_guards.is_empty())
                || crate::lower::is_test_file(&f.rel_path)
            {
                continue;
            }
            let package = crate::package_of(&self.resolver.root, &f.abs_path, &mut memo);
            // A guard registered for the whole application: of every route of the
            // package. One whose call some starts of the application do not make may
            // run (`?`); an argument that is no class built where it is given is
            // not read.
            for g in &f.raw.nest_global_guards {
                // A binding among a module's providers that names a class of the
                // repository, or an export of one of Nest's own packages: no
                // provider of a guard.
                if g.guard.is_none()
                    && let Some(r) = &g.unless_class
                {
                    let c = self.canon(&f.rel_path, r);
                    if classes.contains(&c) || c.starts_with("pkg:@nestjs/") {
                        continue;
                    }
                }
                let entry = match &g.guard {
                    Some(class) => format!(
                        "{}{}{}",
                        if g.conditional || built.get(&package).copied() != Some(1) {
                            "?"
                        } else {
                            ""
                        },
                        drift_core::NEST_GUARD,
                        self.canon(&f.rel_path, class)
                    ),
                    None => format!("?{}what {} is given", drift_core::APP_UNREAD, g.at),
                };
                let entry = (package.clone(), entry);
                if !guards.contains(&entry) {
                    guards.push(entry);
                }
            }
            if f.raw.nest_prefixed {
                prefixed.insert(package.clone());
            }
            let route = |r: &RawNestRoute| match r {
                RawNestRoute::Path { path, method } => NestRoute::Path {
                    path: path.clone(),
                    method: method.clone(),
                },
                RawNestRoute::Controller(c) => {
                    let canonical = self.canon(&f.rel_path, c);
                    let origin = canonical
                        .split_once('#')
                        .map(|(module, name)| self.origin(module, name));
                    match origin {
                        Some(o) if controllers.contains(&o) => NestRoute::Controller(o),
                        _ if controllers.contains(&canonical) => NestRoute::Controller(canonical),
                        _ => NestRoute::Unread,
                    }
                }
            };
            for a in &f.raw.nest_applies {
                nest.push(NestApply {
                    package: package.clone(),
                    at: a.at.clone(),
                    middleware: a
                        .middleware
                        .iter()
                        .map(|m| self.canon(&f.rel_path, m))
                        .collect(),
                    routes: a.routes.iter().map(route).collect(),
                    exclude: a.exclude.iter().map(route).collect(),
                    unread: a.unread,
                });
            }
        }
        self.nest = nest;
        self.nest_prefixed = prefixed;
        self.nest_guards = guards;
        self.builders = files
            .iter()
            .flat_map(|f| {
                f.raw.symbols.iter().filter_map(move |s| {
                    s.refusal_builder
                        .map(|o| (format!("{}#{}", f.rel_path, s.name), o))
                })
            })
            .collect();
        // A function that returns a call of a refusal builder of another module
        // refuses by that response ([`crate::lower::RawSymbol::returns_builder`]).
        let hands_back: BTreeSet<String> = files
            .iter()
            .flat_map(|f| {
                f.raw
                    .symbols
                    .iter()
                    .filter(|s| {
                        s.listed_controls
                            .iter()
                            .any(|c| c.starts_with(drift_core::controls::RETURNS_REJECTION))
                            || (!s.other_rejection && self.returns_builder(&f.rel_path, s))
                    })
                    .map(move |s| format!("{}#{}", f.rel_path, s.name))
            })
            .collect();
        self.hands_back = hands_back;
        self.returns_caller = files
            .iter()
            .flat_map(|f| {
                f.raw
                    .symbols
                    .iter()
                    .filter(|s| {
                        s.listed_controls
                            .iter()
                            .any(|c| c == drift_core::controls::RETURNS_CALLER)
                    })
                    .map(move |s| format!("{}#{}", f.rel_path, s.name))
            })
            .collect();
        // A holder's key is held where some body binds on it a value that is the
        // caller's by its own source, or that such a function gives.
        self.held = files
            .iter()
            .flat_map(|f| {
                f.raw.symbols.iter().flat_map(move |s| {
                    s.caller_args
                        .iter()
                        .chain(s.members.iter().flat_map(|m| &m.caller_args))
                        .map(move |e| (f, e))
                })
            })
            .filter(|(f, (callee, via))| {
                matches!(&callee.base, RawBase::Global(g) if g == "held")
                    && via
                        .as_ref()
                        .is_none_or(|g| self.returns_caller.contains(&self.canon(&f.rel_path, g)))
            })
            .map(|(_, (callee, _))| callee.member.clone())
            .collect();
        self.answers = files
            .iter()
            .flat_map(|f| {
                let direct: BTreeSet<&str> = f
                    .raw
                    .symbols
                    .iter()
                    // A refusal builder answers on no response it was handed: it
                    // builds one, and checks no one.
                    .filter(|s| {
                        s.throws.is_empty()
                            && s.refusal_builder.is_none()
                            && s.controls
                                .iter()
                                .any(|c| c == drift_core::controls::REJECTS_CALLER)
                    })
                    .map(|s| s.name.as_str())
                    .collect();
                f.raw
                    .symbols
                    .iter()
                    .filter(move |s| {
                        direct.contains(s.name.as_str())
                            || s.calls.iter().any(|c| {
                                c.member.is_empty()
                                    && matches!(&c.base, RawBase::Local(n) if direct.contains(n.as_str()))
                            })
                    })
                    .map(move |s| format!("{}#{}", f.rel_path, s.name))
            })
            .collect();
        // And one of any file that calls such a function, a few calls deep
        // (`gate2` of one module returning what `gate` of another gave).
        for _ in 0..3 {
            let more: Vec<String> = files
                .iter()
                .flat_map(|f| f.raw.symbols.iter().map(move |s| (f, s)))
                .filter(|(f, s)| {
                    s.kind == drift_core::SymbolKind::Function
                        && s.calls.iter().any(|c| {
                            c.member.is_empty()
                                && matches!(c.base, RawBase::Import { .. })
                                && self.answers.contains(&self.canon(&f.rel_path, c))
                        })
                })
                .map(|(f, s)| format!("{}#{}", f.rel_path, s.name))
                .filter(|name| !self.answers.contains(name))
                .collect();
            if more.is_empty() {
                break;
            }
            self.answers.extend(more);
        }
        // A metadata key named by a binding is the text the binding holds.
        if files
            .iter()
            .any(|f| f.raw.symbols.iter().any(|s| !s.nest_metadata.is_empty()))
        {
            self.texts = files
                .iter()
                .flat_map(|f| {
                    f.raw
                        .text_consts
                        .iter()
                        .map(move |(name, text)| (format!("{}#{name}", f.rel_path), text.clone()))
                })
                .collect();
        }
    }

    /// What the Nest application of `package` runs before the route `path` of the
    /// controller `controller` and is no wrap of it
    /// ([`drift_core::Symbol::app_middleware`]): the middleware a module's
    /// `configure` applies for it and does not exclude it from, and what is
    /// registered with `use` on the application. After `?`, one that cannot be
    /// told to run for it: a path or an exclusion that is no literal, a pattern, a
    /// path under a global prefix or versioning.
    fn nest_middleware(
        &self,
        package: &str,
        controller: &str,
        path: &str,
        method: &str,
    ) -> Vec<String> {
        let prefixed = self.nest_prefixed.contains(package);
        let route = path_segments(path);
        // A route whose own path is not read is matched by no literal.
        let unread_route = path.contains('?');
        let other_method = |m: &str| !m.is_empty() && !m.eq_ignore_ascii_case(method);
        let mut out: Vec<String> = Vec::new();
        for a in self.nest.iter().filter(|a| a.package == package) {
            let literal = |c: Cover, every: bool| match c {
                Cover::No if !unread_route && !prefixed => Cover::No,
                Cover::Yes if every || (!unread_route && !prefixed) => Cover::Yes,
                _ => Cover::Unsure,
            };
            let applies = a
                .routes
                .iter()
                .map(|r| match r {
                    // Registered for another method.
                    NestRoute::Path { method: m, .. } if other_method(m) => Cover::No,
                    NestRoute::Path { path, method: m } => {
                        literal(nest_applies(path, m, &route, method), every_path(path))
                    }
                    NestRoute::Controller(c) if c == controller => Cover::Yes,
                    NestRoute::Controller(_) => Cover::No,
                    NestRoute::Unread => Cover::Unsure,
                })
                .max()
                .unwrap_or(Cover::No);
            let applies = match applies {
                Cover::No if a.unread => Cover::Unsure,
                c => c,
            };
            if applies == Cover::No {
                continue;
            }
            let excluded = a
                .exclude
                .iter()
                .map(|r| match r {
                    NestRoute::Path { method: m, .. } if other_method(m) => Cover::No,
                    NestRoute::Path { path, method: m } => {
                        match nest_excluded(path, m, &route, method) {
                            Cover::No if !unread_route && !prefixed => Cover::No,
                            Cover::Yes if !unread_route && !prefixed => Cover::Yes,
                            _ => Cover::Unsure,
                        }
                    }
                    _ => Cover::Unsure,
                })
                .max()
                .unwrap_or(Cover::No);
            let cover = match (applies, excluded) {
                (_, Cover::Yes) => continue,
                (Cover::Yes, Cover::No) if !a.unread => Cover::Yes,
                _ => Cover::Unsure,
            };
            let mut push = |m: String| {
                if !out.contains(&m) {
                    out.push(m);
                }
            };
            for m in &a.middleware {
                let plain = m
                    .strip_prefix("pkg:")
                    .and_then(|r| r.split_once('#'))
                    .is_some_and(|(package, _)| {
                        NEST_PLAIN_MIDDLEWARE
                            .iter()
                            .any(|p| package == *p || package.starts_with(&format!("{p}/")))
                    });
                if plain || m.starts_with("global#") {
                    continue;
                }
                push(match cover {
                    Cover::Yes => m.clone(),
                    _ => format!("?{m}"),
                });
            }
            // A middleware that could not be named may be the guard.
            if a.unread {
                push(format!("?{}what {} applies", drift_core::APP_UNREAD, a.at));
            }
        }
        out
    }

    /// The tRPC instances of `files`, and the builder bindings proven to come from one.
    fn trpc_origins(&self, files: &[LoweredFile]) -> TrpcOrigins {
        let instances: BTreeSet<String> = files
            .iter()
            .flat_map(|f| {
                f.raw
                    .trpc
                    .instances
                    .iter()
                    .map(|n| format!("{}#{n}", f.rel_path))
            })
            .collect();
        let mut origins = TrpcOrigins {
            instances,
            ..TrpcOrigins::default()
        };
        if origins.instances.is_empty() {
            return origins;
        }
        // Each candidate binding -> the canonical reference it is built from.
        let chains: BTreeMap<String, String> = files
            .iter()
            .flat_map(|f| {
                f.raw
                    .trpc
                    .builders
                    .iter()
                    .map(|(n, r)| (format!("{}#{n}", f.rel_path), self.canon(&f.rel_path, r)))
            })
            .collect();
        // Each candidate function -> the canonical references it returns. A name
        // declared twice (overloads, a redeclared `function`) needs every body proven.
        let mut factories: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for f in files {
            for fac in &f.raw.trpc.factories {
                factories
                    .entry(format!("{}#{}", f.rel_path, fac.name))
                    .or_default()
                    .extend(fac.returns.iter().map(|r| self.canon(&f.rel_path, r)));
            }
        }
        // Prove what follows from what is proven until nothing more does: a binding
        // whose reference is proven, a function whose every return is. Each round
        // proves at least one more step of a chain; a cycle is never proven.
        for _ in 0..MAX_HOPS {
            let mut grew = false;
            for (id, next) in &chains {
                if !origins.builders.contains(id) && origins.proves(next) {
                    origins.builders.insert(id.clone());
                    grew = true;
                }
            }
            for (id, returns) in &factories {
                if !origins.factories.contains(id) && returns.iter().all(|r| origins.proves(r)) {
                    origins.factories.insert(id.clone());
                    grew = true;
                }
            }
            if !grew {
                break;
            }
        }
        origins
    }

    /// The modules a proof of the builders of `rel`'s tRPC procedure candidates
    /// ([`crate::lower::RawTrpc::candidates`]), and of what `rel`'s own functions
    /// return ([`crate::lower::RawTrpc::factories`], which their `derives_from` waits
    /// on), reads that are not linked with all their specifiers (`full`) yet: each
    /// builder's module, then the module of what it is built from, to the end of the
    /// chain. For a single-file scan, to decide as a full scan does.
    pub(crate) fn trpc_files(
        &self,
        files: &[LoweredFile],
        rel: &str,
        full: &BTreeSet<String>,
    ) -> BTreeSet<String> {
        let by_path: BTreeMap<&str, &LoweredFile> =
            files.iter().map(|f| (f.rel_path.as_str(), f)).collect();
        let mut pending: Vec<String> = by_path
            .get(rel)
            .into_iter()
            .flat_map(|f| {
                f.raw.trpc.candidates.iter().map(|c| &c.base).chain(
                    f.raw
                        .trpc
                        .factories
                        .iter()
                        .flat_map(|fac| fac.returns.iter()),
                )
            })
            .map(|r| self.canon(rel, r))
            .collect();
        let mut seen = BTreeSet::new();
        let mut out = BTreeSet::new();
        while let Some(target) = pending.pop() {
            if !seen.insert(target.clone()) {
                continue;
            }
            let Some((module, rest)) = target.split_once('#') else {
                continue;
            };
            if !full.contains(module) {
                out.insert(module.to_string());
                continue;
            }
            let Some(f) = by_path.get(module) else {
                continue;
            };
            if let Some((_, r)) = f.raw.trpc.builders.iter().find(|(n, _)| n == rest) {
                pending.push(self.canon(module, r));
            }
            // `mod#createTeamPbacProcedure()`: what the function returns.
            if let Some(name) = rest.strip_suffix("()") {
                for fac in f.raw.trpc.factories.iter().filter(|fac| fac.name == name) {
                    pending.extend(fac.returns.iter().map(|r| self.canon(module, r)));
                }
            }
        }
        out
    }

    // Mining reads what this join gives a handler (the middleware every mount has),
    // where the last measured build (F12) read the first mount's: unmeasured, and
    // not held as Python's listings are (`drift_core::Listed`).
    /// What mounts each router of `files`. A mount names the router it mounts by an
    /// import or a local binding; the router it is on is a binding of the mounting
    /// file. A mount of something that is no router Drift knows (a Fastify plugin
    /// function) is kept under its module, for the routes of that module.
    fn mounts(&self, files: &[LoweredFile]) -> BTreeMap<String, BTreeSet<MountParent>> {
        let routers: BTreeSet<String> = files
            .iter()
            .flat_map(|f| f.raw.routers.iter().map(|r| format!("{}#{r}", f.rel_path)))
            .collect();
        // The functions given to `createServer` from another file: a listener such a
        // function is serves its application
        // ([`crate::lower::RawFile::listener_mounts`]).
        let listeners: BTreeSet<String> = files
            .iter()
            .flat_map(|f| {
                f.raw
                    .node_listener_refs
                    .iter()
                    .map(|r| self.canon(&f.rel_path, r))
            })
            .collect();
        // Each function with the routers it is handed (`path#fn` -> `path#app@3`).
        let mut plugins: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for f in files {
            for (function, router) in &f.raw.function_routers {
                plugins
                    .entry(format!("{}#{function}", f.rel_path))
                    .or_default()
                    .push(format!("{}#{router}", f.rel_path));
            }
        }
        let mut parents: BTreeMap<String, BTreeSet<MountParent>> = BTreeMap::new();
        for f in files {
            let given = |local: &String| {
                listeners.contains(&format!("{}#{local}", f.rel_path))
                    || f.raw.exports.iter().any(|e| {
                        matches!(&e.target, RawExportTarget::Local(l) if l == local)
                            && listeners.contains(&format!("{}#{}", f.rel_path, e.name))
                    })
            };
            let served = f
                .raw
                .listener_mounts
                .iter()
                .filter(|(local, _)| given(local))
                .map(|(_, m)| m);
            for m in f.raw.mounts.iter().chain(served) {
                let target = self.canon(&f.rel_path, &m.target);
                let (module, name) = target.split_once('#').unwrap_or((&target, ""));
                if !self.modules.contains_key(module) {
                    continue;
                }
                // The binding behind an export (`export default router`).
                let origin = self.origin(module, name);
                // A function handed the instance it is registered on (a Fastify
                // plugin): its own routers, wherever it is declared.
                let plugin: Vec<String> = [&origin, &target]
                    .into_iter()
                    .filter_map(|f| plugins.get(f.as_str()))
                    .flatten()
                    .cloned()
                    .collect();
                let nodes = match origin {
                    _ if !plugin.is_empty() && !m.tentative => plugin,
                    o if routers.contains(&o) => vec![o],
                    _ if routers.contains(&target) => vec![target.clone()],
                    // No router: a path-less `use` is middleware, and a mount within
                    // one file of something else says nothing.
                    _ if m.tentative || module == f.rel_path => continue,
                    _ => vec![module.to_string()],
                };
                let parent = if m.parent.is_empty() {
                    f.rel_path.clone()
                } else {
                    format!("{}#{}", f.rel_path, m.parent)
                };
                for node in nodes {
                    if parent == node {
                        continue;
                    }
                    let middleware = m
                        .middleware
                        .iter()
                        .map(|r| self.canon(&f.rel_path, r))
                        .collect();
                    let mut hooks: Vec<String> = m
                        .hooks
                        .iter()
                        .map(|r| self.canon(&f.rel_path, r))
                        .filter(|c| !routers.contains(c) && !self.routers.contains(c))
                        .collect();
                    let mut calls: Vec<drift_core::GuardCall> = m
                        .calls
                        .iter()
                        .map(|c| self.guard_call(&f.rel_path, c))
                        .filter(|c| !self.routers.contains(&c.callee))
                        .collect();
                    for (callee, at) in &m.passed {
                        let callee = self.canon(&f.rel_path, callee);
                        hooks.extend(self.app_passed(&callee, *at));
                        calls.extend(self.passed_calls(&callee, *at));
                    }
                    parents.entry(node).or_default().insert((
                        parent.clone(),
                        m.prefix.clone(),
                        middleware,
                        hooks,
                        calls,
                    ));
                }
            }
        }
        parents
    }

    /// Every way the router `node` (`module#binding`, or a module) is served: one
    /// chain for each mount of it and of what it is mounted on, sorted by prefix, at
    /// most [`MAX_MOUNTS`]. Never empty: a router nothing mounts is served as it is.
    fn mount_chains(&self, node: &str, depth: usize) -> Vec<MountChain> {
        let own = MountChain {
            prefix: String::new(),
            middleware: Vec::new(),
            opaque: false,
            hooks: Vec::new(),
            calls: Vec::new(),
        };
        let Some(parents) = self.mount_parents.get(node).filter(|_| depth < 16) else {
            return vec![own];
        };
        let mut out: Vec<MountChain> = Vec::new();
        for (parent, prefix, middleware, hooks, calls) in parents {
            for up in self.mount_chains(parent, depth + 1) {
                let mut inherited = up.middleware;
                inherited.extend(middleware.iter().cloned());
                let mut before = up.hooks;
                before.extend(hooks.iter().cloned());
                let mut shapes = up.calls;
                shapes.extend(calls.iter().cloned());
                out.push(MountChain {
                    prefix: crate::lower::routes::join_path(&[&up.prefix, prefix]),
                    middleware: inherited,
                    opaque: up.opaque,
                    hooks: before,
                    calls: shapes,
                });
            }
        }
        out.sort();
        out.dedup();
        // Two mounts under one path with different middleware: which one answers is
        // the order they were registered in, which is not kept. Unknown.
        let mut merged: Vec<MountChain> = Vec::new();
        for c in out {
            match merged.last_mut() {
                Some(last) if last.prefix == c.prefix && last.middleware == c.middleware => {
                    // The same but for what is no wrap: one of the two runs.
                    for h in c.hooks {
                        let h = format!("?{}", h.trim_start_matches('?'));
                        if !last.hooks.contains(&h) {
                            last.hooks.push(h);
                        }
                    }
                    for call in c.calls {
                        if !last.calls.contains(&call) {
                            last.calls.push(call);
                        }
                    }
                }
                Some(last) if last.prefix == c.prefix => last.opaque = true,
                _ => merged.push(c),
            }
        }
        merged.truncate(MAX_MOUNTS);
        merged
    }

    /// What handing a router to the call `callee` says of the routes it serves
    /// ([`crate::lower::RawSymbol::app_passed`]), as
    /// [`drift_core::Symbol::app_middleware`] holds it: nothing for a package's call
    /// known to register nothing on it ([`PLAIN_APP_CALLS`]: it starts a server on
    /// it, or tests it); for any other, that the router went where what was
    /// registered on it is not read ([`drift_core::APP_UNREAD`]).
    fn app_passed(&self, callee: &str, at: u32) -> Vec<String> {
        let (callee, plugin) = match callee.strip_suffix(crate::lower::routes::PLUGIN_PASSED) {
            Some(c) => (c, true),
            None => (callee, false),
        };
        let name = callee.trim_end_matches("(new)");
        if PLAIN_APP_CALLS.contains(&name) {
            return Vec::new();
        }
        // A function of the repository whose body registers on that parameter what
        // is written there: that middleware, read as any other.
        let origin = name
            .split_once('#')
            .map(|(module, export)| self.origin(module, export));
        let read = self
            .registers
            .get(&(name.to_string(), at))
            .or_else(|| origin.and_then(|o| self.registers.get(&(o, at))));
        // A Fastify plugin the instance is registered with keeps its hooks to
        // itself, but where `fastify-plugin` wraps it.
        if plugin {
            return match read {
                Some((Some(middleware), true)) => middleware.clone(),
                Some((None, true)) => vec![format!(
                    "?{}registered with {}",
                    drift_core::APP_UNREAD,
                    name.rsplit_once('#').map_or(name, |(_, n)| n)
                )],
                _ => Vec::new(),
            };
        }
        if let Some((Some(middleware), _)) = read {
            return middleware.clone();
        }
        let shown = name.rsplit_once('#').map_or(name, |(_, n)| n);
        vec![format!("?{}passed to {shown}", drift_core::APP_UNREAD)]
    }

    /// The calls a function the router was handed to wrote where it registered a
    /// guard on it ([`Linker::register_calls`]), where [`Linker::app_passed`] reads
    /// what it registered.
    fn passed_calls(&self, callee: &str, at: u32) -> Vec<drift_core::GuardCall> {
        let (callee, plugin) = match callee.strip_suffix(crate::lower::routes::PLUGIN_PASSED) {
            Some(c) => (c, true),
            None => (callee, false),
        };
        let name = callee.trim_end_matches("(new)");
        let origin = name
            .split_once('#')
            .map(|(module, export)| self.origin(module, export));
        let key = [Some(name.to_string()), origin]
            .into_iter()
            .flatten()
            .map(|n| (n, at))
            .find(|k| self.registers.contains_key(k));
        let Some(key) = key else {
            return Vec::new();
        };
        // A plugin keeps its hooks to itself, but where `fastify-plugin` wraps it.
        if plugin && !matches!(self.registers.get(&key), Some((_, true))) {
            return Vec::new();
        }
        self.register_calls.get(&key).cloned().unwrap_or_default()
    }

    /// [`Linker::registers`] of `files`.
    fn registered(&self, files: &[LoweredFile]) -> Registers {
        let mut out = BTreeMap::new();
        for f in files {
            for r in &f.raw.registers {
                let middleware = (!r.unread).then(|| {
                    r.middleware
                        .iter()
                        .map(|m| self.canon(&f.rel_path, m))
                        .collect()
                });
                out.insert(
                    (format!("{}#{}", f.rel_path, r.function), r.param),
                    (middleware, r.shared),
                );
            }
        }
        out
    }

    /// The chains the route symbol `symbol` of `f` is served through: those of the
    /// router it is registered on, else those of its module (a Fastify plugin).
    /// A call whose shape is recorded, canonical ([`drift_core::GuardCall`]).
    fn guard_call(&self, rel: &str, c: &crate::lower::RawGuardCall) -> drift_core::GuardCall {
        drift_core::GuardCall {
            callee: self.canon(rel, &c.callee),
            args: c
                .args
                .iter()
                .map(|list| list.iter().map(|a| self.call_arg(rel, a)).collect())
                .collect(),
        }
    }

    fn call_arg(&self, rel: &str, a: &crate::lower::RawArg) -> drift_core::CallArg {
        use crate::lower::RawArg;
        use drift_core::CallArg;
        match a {
            RawArg::Text(t) => CallArg::Text(t.clone()),
            RawArg::Bool(b) => CallArg::Bool(*b),
            RawArg::Number(n) => CallArg::Number(n.clone()),
            RawArg::Null => CallArg::Null,
            RawArg::List(l) => CallArg::List(l.iter().map(|x| self.call_arg(rel, x)).collect()),
            RawArg::Object(o) => CallArg::Object(
                o.iter()
                    .map(|(k, v)| (k.clone(), self.call_arg(rel, v)))
                    .collect(),
            ),
            RawArg::Ref(r) => CallArg::Ref(self.canon(rel, r)),
            RawArg::Call(c) => CallArg::Call(self.guard_call(rel, c)),
            RawArg::Function => CallArg::Function,
            RawArg::Spread => CallArg::Spread,
            RawArg::Unread => CallArg::Unread,
        }
    }

    fn route_chains(&self, f: &LoweredFile, symbol: &str) -> Vec<MountChain> {
        let router = f
            .raw
            .route_routers
            .iter()
            .find(|(s, _)| s == symbol)
            .map(|(_, r)| format!("{}#{r}", f.rel_path));
        match router {
            Some(node) if self.mount_parents.contains_key(&node) => self.mount_chains(&node, 0),
            _ => self.mount_chains(&f.rel_path, 0),
        }
    }

    /// Drop what [`Linker::origin`] remembered, once no more files are linked.
    pub(crate) fn forget_origins(&mut self) {
        self.origins = OriginMemo::default();
    }

    /// Canonical origin of `name` exported by `module`, following re-exports.
    pub fn origin(&self, module: &str, name: &str) -> String {
        if let Some(o) = self.origins.get(module, name) {
            return o;
        }
        let mut seen = BTreeSet::new();
        let o = self
            .origin_inner(module, name, 0, &mut seen)
            .unwrap_or_else(|| format!("{module}#{name}"));
        self.origins.put(module, name, &o);
        o
    }

    fn origin_inner(
        &self,
        module: &str,
        name: &str,
        depth: usize,
        seen: &mut BTreeSet<(String, String)>,
    ) -> Option<String> {
        if depth > MAX_HOPS || !seen.insert((module.to_string(), name.to_string())) {
            return None;
        }
        let Some(me) = self.modules.get(module) else {
            // External package or unresolved module: the name is its own origin.
            return Some(format!("{module}#{name}"));
        };
        if name == "*" {
            return Some(format!("{module}#*"));
        }
        match me.named.get(name) {
            Some(ResolvedTarget::Local(local)) => Some(format!("{module}#{local}")),
            Some(ResolvedTarget::From { module: m, name: n }) => {
                self.origin_inner(m, n, depth + 1, seen)
            }
            None if name != "default" => {
                for m in &me.all {
                    if self.module_exports(m, name, depth + 1, &mut seen.clone()) {
                        return self.origin_inner(m, name, depth + 1, seen);
                    }
                }
                // Not found: the deepest module reached is the best canonical home.
                Some(format!("{module}#{name}"))
            }
            None => Some(format!("{module}#{name}")),
        }
    }

    /// Every name `module` exports, following `export *` (bounded, cycle-safe).
    fn exported_names(
        &self,
        module: &str,
        depth: usize,
        seen: &mut BTreeSet<String>,
        out: &mut BTreeSet<String>,
    ) {
        if depth > MAX_HOPS || !seen.insert(module.to_string()) {
            return;
        }
        let Some(me) = self.modules.get(module) else {
            return;
        };
        out.extend(me.named.keys().cloned());
        for m in &me.all {
            self.exported_names(m, depth + 1, seen, out);
        }
    }

    /// True when `module` has no `default` export but does have named ones:
    /// a CommonJS `module.exports = { a, b }` object, read as `require(m).a`.
    fn is_cjs_object(&self, module: &str) -> bool {
        self.modules
            .get(module)
            .is_some_and(|me| !me.named.contains_key("default") && !me.named.is_empty())
    }

    /// True when `module` (transitively) exports `name`.
    fn module_exports(
        &self,
        module: &str,
        name: &str,
        depth: usize,
        seen: &mut BTreeSet<(String, String)>,
    ) -> bool {
        if depth > MAX_HOPS || !seen.insert((module.to_string(), format!("?{name}"))) {
            return false;
        }
        let Some(me) = self.modules.get(module) else {
            return true;
        };
        me.named.contains_key(name)
            || me
                .all
                .iter()
                .any(|m| self.module_exports(m, name, depth + 1, seen))
    }

    /// `s` returns a call of a refusal builder of 401 of another module
    /// ([`crate::lower::RawSymbol::returns_builder`]).
    fn returns_builder(&self, rel_path: &str, s: &crate::lower::RawSymbol) -> bool {
        s.refusal_builder.is_none()
            && s.returns_builder.iter().any(|r| {
                self.builders.get(&self.canon(rel_path, r))
                    == Some(&drift_core::CheckOutcome::Unauthenticated)
            })
    }

    fn canon(&self, rel_path: &str, r: &RawRef) -> String {
        match &r.base {
            // A member of a Fastify instance the repository decorates once with a
            // function is that function.
            RawBase::Global(n)
                if n == "fastify"
                    && r.member
                        .strip_prefix('.')
                        .and_then(|name| self.decorated.get(name))
                        .is_some_and(Option::is_some) =>
            {
                self.decorated[&r.member[1..]].clone().unwrap_or_default()
            }
            RawBase::Global(n) => format!("global#{n}{}", r.member),
            RawBase::Local(n) => format!("{rel_path}#{n}{}", r.member),
            RawBase::Import { spec, name } => {
                let module = self.specs[rel_path]
                    .get(spec)
                    .cloned()
                    .unwrap_or_else(|| format!("unresolved:{spec}"));
                // `const m = require("./x"); m.a()` against `module.exports = { a }` reads like a namespace.
                let as_namespace = name == "*"
                    || (name == "default" && !r.member.is_empty() && self.is_cjs_object(&module));
                if as_namespace {
                    // Namespace import: `ns.foo.bar` -> origin(module, foo) + `.bar`.
                    let member = r.member.strip_prefix('.').unwrap_or(&r.member);
                    let (first, rest) = match member.find(['.', '(']) {
                        Some(i) => (&member[..i], &member[i..]),
                        None => (member, ""),
                    };
                    if first.is_empty() {
                        return format!("{module}#*{}", r.member);
                    }
                    return format!("{}{rest}", self.origin(&module, first));
                }
                let origin = self.origin(&module, name);
                // A re-export chain can end at a CommonJS object module's `default`
                // (`module.exports.svc = require("./svc")`): read members as names.
                if let Some(m) = origin.strip_suffix("#default")
                    && r.member.starts_with('.')
                    && self.is_cjs_object(m)
                {
                    let member = &r.member[1..];
                    let (first, rest) = match member.find(['.', '(']) {
                        Some(i) => (&member[..i], &member[i..]),
                        None => (member, ""),
                    };
                    return format!("{}{rest}", self.origin(m, first));
                }
                format!("{origin}{}", r.member)
            }
        }
    }

    /// The guard classes a composed decorator (`path#name`) brings in, through the
    /// decorators it composes, at most [`MAX_COMPOSED_HOPS`] deep.
    fn composed_guards(&self, decorator: &str, depth: usize, out: &mut BTreeSet<String>) {
        if depth > MAX_COMPOSED_HOPS {
            return;
        }
        if let Some((guards, inner)) = self.composed.get(decorator) {
            out.extend(guards.iter().cloned());
            for i in inner {
                self.composed_guards(i, depth + 1, out);
            }
        }
    }

    /// A practice operand, canonical: "" for none, its text, or the reference (with
    /// `prefix`, `call:` for what a check compares with).
    fn operand(&self, rel: &str, o: &RawOperand, prefix: &str) -> String {
        match o {
            RawOperand::None => String::new(),
            RawOperand::Text(t) => t.clone(),
            RawOperand::Ref(r) => format!("{prefix}{}", self.canon(rel, r)),
        }
    }

    /// Conditional calls as [`drift_core::Symbol::conditional_calls`] writes them: of
    /// the raw list (every call with why it is conditional, empty for a call on every
    /// path), the repository's own callees and a policy library's with no call on
    /// every path, each once, by its first reason.
    ///
    /// A call whose value is dropped is conditional only where what is called is
    /// `async`: of a function or method the linked files define as not `async` it is
    /// a call as any other; of anything else of the repository (a method reached
    /// through a binding) it is kept, for a reader that resolves the callee.
    fn conditional_calls(&self, rel: &str, calls: &[(RawRef, String)]) -> Vec<String> {
        let canon: Vec<(String, &str)> = calls
            .iter()
            .map(|(r, why)| {
                let c = self.canon(rel, r);
                let plain = why == drift_core::not_always::NOT_AWAITED
                    && self.sync_defs.contains(c.trim_end_matches("(new)"));
                (c, if plain { "" } else { why.as_str() })
            })
            .collect();
        let always: BTreeSet<&str> = canon
            .iter()
            .filter(|(_, why)| why.is_empty())
            .map(|(c, _)| c.as_str())
            .collect();
        let mut seen = BTreeSet::new();
        let mut out: Vec<String> = canon
            .iter()
            .filter(|(c, why)| {
                let own = !(c.starts_with("pkg:")
                    || c.starts_with("global#")
                    || c.starts_with("unresolved:"));
                // A package's call is listed only where it is the check itself: a
                // policy library's, which decides when it is called.
                let policy = *why != drift_core::not_always::NOT_AWAITED
                    && drift_core::practice::policy_call(c);
                !why.is_empty()
                    && (own || policy)
                    && !always.contains(c.as_str())
                    && seen.insert(c.as_str())
            })
            .map(|(c, why)| format!("{why}:{c}"))
            .collect();
        out.sort();
        out
    }

    /// [`drift_core::Symbol::caller_args`] of a body: canonical, sorted. An entry
    /// that names what may give the value is kept where it may: a function of the
    /// repository whose body returns a value of the caller, a key some body binds
    /// one on.
    fn caller_args(&self, rel: &str, entries: &[(RawRef, Option<RawRef>)]) -> Vec<String> {
        let held = |r: &RawRef| matches!(&r.base, RawBase::Global(g) if g == "held");
        let mut out: Vec<String> = entries
            .iter()
            .filter_map(|(callee, via)| {
                let c = self.canon(rel, callee);
                let Some(g) = via else { return Some(c) };
                let giver = self.canon(rel, g);
                let gives = if held(g) {
                    self.held.contains(&g.member)
                } else {
                    self.returns_caller.contains(&giver)
                };
                gives.then(|| format!("{c}{}{giver}", drift_core::CALLER_ARG_VIA))
            })
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// [`drift_core::Symbol::receiver_calls`] of a body: canonical, or as written.
    fn receiver_calls(&self, rel: &str, calls: &[crate::lower::RawReceiverCall]) -> Vec<String> {
        let mut out: Vec<String> = calls
            .iter()
            .map(|c| match c {
                crate::lower::RawReceiverCall::Ref(r) => self.canon(rel, r),
                crate::lower::RawReceiverCall::Unread(label) => label.clone(),
            })
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// [`drift_core::BodyCheck::after`]: what the body calls before a check, canonical,
    /// in order, capped.
    fn after(&self, rel: &str, calls: &[RawRef]) -> Vec<String> {
        let cap = drift_core::practice::caps::CHECK_AFTER;
        let mut out: Vec<String> = Vec::new();
        for r in calls {
            let c = self.canon(rel, r);
            if out.contains(&c) {
                continue;
            }
            if out.len() == cap {
                out.push(drift_core::AFTER_MORE.to_string());
                break;
            }
            out.push(c);
        }
        out
    }

    /// The practice facts of one symbol, canonical.
    fn practice(&self, rel: &str, s: &crate::lower::RawSymbol, out: &mut Symbol) {
        // Calls through a parameter (`param:server.services.x.y`), and through its
        // in-repo type.
        out.calls.extend(s.param_calls.iter().cloned());
        out.calls
            .extend(s.typed_param_calls.iter().map(|r| self.canon(rel, r)));
        out.body_checks = s
            .body_checks
            .iter()
            .map(|c| drift_core::BodyCheck {
                source: self.operand(rel, &c.source, ""),
                reads: c.reads.clone(),
                compares: self.operand(rel, &c.compares, "call:"),
                outcome: c.outcome,
                op: c.op.clone(),
                conditional: c.conditional,
                condition: check_condition(c),
                unless: c.unless.clone(),
                compares_path: c.compares_path.clone(),
                after: self.after(rel, &c.after),
            })
            .collect();
        out.responses = s
            .responses
            .iter()
            .map(|r| drift_core::ResponseFact {
                status: r.status,
                via: r.via,
                builder: r
                    .builder
                    .as_ref()
                    .map(|b| self.canon(rel, b))
                    .unwrap_or_default(),
                model: r
                    .model
                    .as_ref()
                    .map(|m| self.canon(rel, m))
                    .unwrap_or_default(),
                keys: r.keys.clone(),
                in_catch: r.in_catch,
            })
            .collect();
        out.log_calls = s
            .log_calls
            .iter()
            .map(|l| drift_core::LogCall {
                callee: self.canon(rel, &l.callee),
                level: l.level.clone(),
                in_catch: l.in_catch,
                structured: l.structured,
                passes_error: l.passes_error,
                bound: false,
            })
            .collect();
        out.catches = s
            .catches
            .iter()
            .map(|c| drift_core::CatchFact {
                catches: c.catches.iter().map(|o| self.operand(rel, o, "")).collect(),
                does: c
                    .does
                    .iter()
                    .map(|(k, r)| match r {
                        Some(r) => format!("{k}:{}", self.canon(rel, r)),
                        None => k.clone(),
                    })
                    .collect(),
            })
            .collect();
        out.headers = s.headers.clone();
        out.inputs = s
            .inputs
            .iter()
            .map(|r| match &r.base {
                // An inline Fastify schema: validated by Fastify, whether or not the
                // file imports it.
                RawBase::Import { spec, name }
                    if (spec.as_str(), name.as_str()) == crate::lower::routes::FASTIFY_SCHEMA =>
                {
                    format!("pkg:{spec}#{name}{}", r.member)
                }
                _ => self.canon(rel, r),
            })
            .collect();
        out.handles_errors = s
            .handles_errors
            .iter()
            .map(|o| self.operand(rel, o, ""))
            .collect();
        // Environment reads through a helper (`env("DATABASE_URL")`).
        for (callee, i, name, server) in &s.env_calls {
            if !self
                .env_helpers
                .get(&self.canon(rel, callee))
                .is_some_and(|params| params.contains(i))
            {
                continue;
            }
            let var = format!("process.env.{name}");
            if *server && (!out.reads.contains(&var) || out.server_reads.contains(&var)) {
                out.server_reads.push(var.clone());
            } else if !*server {
                out.server_reads.retain(|r| *r != var);
            }
            out.reads.push(var);
        }
    }

    /// A resolved registry: its slot, and the in-repo symbols it names.
    fn registry(&self, rel: &str, l: &RawList) -> Option<Registry> {
        let mut opaque = l.opaque;
        let mut items: Vec<RegistryItem> = l
            .items
            .iter()
            .map(|(r, line)| RegistryItem {
                target: symbol_of(&self.canon(rel, r)),
                line: *line,
                spread: false,
            })
            .filter(|i| !i.target.contains(':'))
            .collect();
        for (r, line) in &l.spreads {
            let target = symbol_of(&self.canon(rel, r));
            // A spread of a package's or an unresolved list: its items are not known.
            if target.contains(':') {
                opaque = true;
            } else {
                items.push(RegistryItem {
                    target,
                    line: *line,
                    spread: true,
                });
            }
        }
        items.sort();
        // A list of nothing Drift can place is dropped, unless it is opaque: then
        // it may hold anything, and its members are unknown, not unregistered.
        if items.is_empty() && !opaque {
            return None;
        }
        let slot = match &l.slot {
            RawSlot::Arg { callee, index, key } if key.is_empty() => {
                format!("arg:{}@{index}", self.canon(rel, callee))
            }
            RawSlot::Arg { callee, index, key } => {
                format!("arg:{}@{index}:{key}", self.canon(rel, callee))
            }
            RawSlot::Binding(name) => format!("binding:{name}"),
            RawSlot::Calls(receiver) => format!("calls:{}", self.canon(rel, receiver)),
        };
        Some(Registry {
            slot,
            line: l.line,
            items,
            opaque,
        })
    }

    /// Produce final facts for one file.
    /// The package at `package` is built with Next.js, read once per package.
    fn uses_next(&self, package: &str) -> bool {
        let mut memo = self.next_packages.lock().unwrap_or_else(|e| e.into_inner());
        *memo
            .entry(package.to_string())
            .or_insert_with(|| crate::nextjs::package_uses_next(&self.resolver.root, package))
    }

    /// The file-convention router the package at `package` is built with, read once
    /// per package.
    fn file_router(&self, package: &str) -> Option<crate::filerouters::Framework> {
        let mut memo = self.file_routers.lock().unwrap_or_else(|e| e.into_inner());
        *memo
            .entry(package.to_string())
            .or_insert_with(|| crate::filerouters::framework_of(&self.resolver.root, package))
    }

    /// What a body hands the repository's code and filters its queries by, as the
    /// controls write it ([`drift_core::controls::ARG_VALUE`],
    /// [`drift_core::controls::FILTER_VALUE`]): each call of a callee of the
    /// repository with what every argument is, and each key of an object given to a
    /// callee whose value is read off a parameter.
    fn flow_controls(
        &self,
        rel: &str,
        arg_sides: &[(RawRef, Vec<(String, String)>)],
        loose_sides: &[(String, Vec<(String, String)>)],
        param_keys: &[(RawRef, String, String)],
    ) -> Vec<String> {
        // A value read off what a call handed back names the call by its
        // canonical callee ([`crate::lower::RawSymbol::loose_sides`]).
        let side = |side: &str| -> String {
            match side
                .strip_prefix("call ")
                .filter(|j| j.starts_with('{'))
                .and_then(|j| serde_json::from_str::<RawRef>(j).ok())
            {
                Some(r) => format!("call {}", self.canon(rel, &r)),
                None => side.to_string(),
            }
        };
        let control = |c: &str, given: &[(String, String)]| {
            let mut control = format!("{}{c}", drift_core::controls::ARG_VALUE);
            for (key, s) in given {
                control.push('\t');
                control.push_str(key);
                control.push('\t');
                control.push_str(&side(s));
            }
            control
        };
        let mut out: Vec<String> = arg_sides
            .iter()
            .map(|(callee, given)| (self.canon(rel, callee), given))
            // A package's call by what it is handed under the keys of an object
            // only (`db.note.findMany({ where: { userId } })` through a client
            // typed by its package): a value handed by position is not followed
            // into a package.
            .filter(|(c, given)| {
                !c.starts_with("global#")
                    && (!c.starts_with("pkg:") || given.iter().any(|(key, _)| key.contains('.')))
            })
            .map(|(c, given)| control(&c, given))
            .collect();
        out.extend(loose_sides.iter().map(|(c, given)| control(c, given)));
        out.extend(param_keys.iter().map(|(callee, key, side)| {
            format!(
                "{}{}\t{key}\t{side}",
                drift_core::controls::FILTER_VALUE,
                self.canon(rel, callee)
            )
        }));
        out.sort();
        out.dedup();
        out
    }

    pub fn link(&self, f: &LoweredFile, package: String) -> FileFacts {
        let rel = f.rel_path.as_str();
        let specs = &self.specs[rel];
        // tRPC procedures whose builder is proven to come from a tRPC instance; the
        // others stay what they were lowered as (an ordinary value, or nothing).
        let proven: Vec<&crate::lower::RawCandidate> = f
            .raw
            .trpc
            .candidates
            .iter()
            .filter(|c| self.trpc.proves(&self.canon(rel, &c.base)))
            .collect();
        let replaced: BTreeSet<&str> = proven
            .iter()
            .filter(|c| c.replaces)
            .map(|c| c.symbol.name.as_str())
            .collect();
        let raw_symbols: Vec<&crate::lower::RawSymbol> = f
            .raw
            .symbols
            .iter()
            .filter(|s| !replaced.contains(s.name.as_str()))
            .chain(proven.iter().map(|c| &c.symbol))
            .collect();
        // A function proven to return a procedure builder derives from what its one
        // `return` is built from, as a `const` builder does. A name recorded twice
        // (a redeclared `function`) derives from nothing.
        let factory_derivation = |s: &crate::lower::RawSymbol| {
            if s.kind != drift_core::SymbolKind::Function
                || !self.trpc.factories.contains(&format!("{rel}#{}", s.name))
            {
                return None;
            }
            let mut found = f.raw.trpc.factories.iter().filter(|fac| fac.name == s.name);
            match (found.next(), found.next()) {
                (Some(fac), None) => fac.derives_from.as_ref(),
                _ => None,
            }
        };
        let raw_entry_points: Vec<&drift_core::EntryPoint> = f
            .raw
            .entry_points
            .iter()
            .chain(proven.iter().map(|c| &c.entry))
            .collect();
        let mut imports: Vec<Import> = f
            .raw
            .imports
            .iter()
            .map(|i| Import {
                module: specs[&i.spec].clone(),
                names: i.names.clone(),
                type_only: i.type_only,
                load: i.load,
            })
            .collect();
        self.add_helper_loads(f, &mut imports);

        let mut exported_as: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut exports = Vec::new();
        for e in &f.raw.exports {
            let (origin, kind) = match &e.target {
                RawExportTarget::Local(l) => {
                    exported_as
                        .entry(l.clone())
                        .or_default()
                        .push(e.name.clone());
                    (format!("{rel}#{l}"), ExportKind::Local)
                }
                RawExportTarget::From { spec, name } => {
                    (self.origin(&specs[spec], name), ExportKind::ReExport)
                }
                RawExportTarget::All { spec } => {
                    (format!("{}#*", specs[spec]), ExportKind::ReExportAll)
                }
            };
            exports.push(Export {
                name: e.name.clone(),
                origin,
                kind,
            });
        }
        // Expand `export *` into the concrete names it re-exports (never `default`),
        // so barrels and re-export-only route files list what they actually export.
        let explicit: BTreeSet<String> = exports.iter().map(|e| e.name.clone()).collect();
        let mut expanded = BTreeSet::new();
        for e in &f.raw.exports {
            if let RawExportTarget::All { spec } = &e.target {
                let module = &specs[spec];
                let mut names = BTreeSet::new();
                self.exported_names(module, 0, &mut BTreeSet::new(), &mut names);
                for n in names {
                    if n != "default"
                        && n != "*"
                        && !explicit.contains(&n)
                        && expanded.insert(n.clone())
                    {
                        exports.push(Export {
                            origin: self.origin(module, &n),
                            name: n,
                            kind: ExportKind::ReExportAll,
                        });
                    }
                }
            }
        }
        // Adapter entry points found while lowering (Express routes) are exported entry symbols.
        for ep in &raw_entry_points {
            exported_as
                .entry(ep.symbol.clone())
                .or_default()
                .push(ep.symbol.clone());
        }

        let route_symbols: BTreeSet<&str> = raw_entry_points
            .iter()
            .filter(|e| matches!(e.adapter.as_str(), "express" | "hono" | "fastify"))
            .map(|e| e.symbol.as_str())
            .collect();
        // Each route with the chains it is served through. What every chain gives it
        // is the handler's own; what one adds is that mount's ([`FileFacts::mounts`]).
        let served: BTreeMap<&str, Vec<MountChain>> = route_symbols
            .iter()
            .map(|s| (*s, self.route_chains(f, s)))
            .collect();
        let common = |symbol: &str| -> Vec<String> {
            let chains = served.get(symbol).map(Vec::as_slice).unwrap_or_default();
            chains
                .first()
                .into_iter()
                .flat_map(|c| &c.middleware)
                .filter(|w| chains.iter().all(|c| c.middleware.contains(w)))
                .cloned()
                .collect()
        };
        let mut symbols: Vec<Symbol> = raw_symbols
            .iter()
            .map(|s| Symbol {
                name: s.name.clone(),
                kind: s.kind,
                exported_as: exported_as.get(&s.name).cloned().unwrap_or_default(),
                line: s.line,
                wraps: common(&s.name)
                    .into_iter()
                    .map(|w| Wrap {
                        wrapper: w,
                        kind: drift_core::WrapKind::Call,
                    })
                    .chain(s.wraps.iter().map(|(r, k)| Wrap {
                        wrapper: if *k == drift_core::WrapKind::Try {
                            "try".into()
                        } else {
                            self.canon(rel, r)
                        },
                        kind: *k,
                    }))
                    .collect(),
                calls: s.calls.iter().map(|r| self.canon(rel, r)).collect(),
                renders: s.renders.iter().map(|r| self.canon(rel, r)).collect(),
                args: s
                    .args
                    .iter()
                    .map(|(r, i, k)| format!("{}@{i}:{k}", self.canon(rel, r)))
                    .collect(),
                // With what the body hands the repository's code and which of its
                // parameters its filters read ([`Linker::flow_controls`]): facts of
                // the body as it is written, the same in both readings, and never
                // a rule (mining leaves these controls out by their prefix).
                controls: {
                    let mut controls = s.controls.clone();
                    controls.extend(self.flow_controls(
                        rel,
                        &s.arg_sides,
                        &s.loose_sides,
                        &s.param_keys,
                    ));
                    controls.sort();
                    controls.dedup();
                    controls
                },
                string_literals: s.string_literals,
                suppressions: s.suppressions.clone(),
                reads: s.reads.clone(),
                throws: s.throws.iter().map(|r| self.canon(rel, r)).collect(),
                sinks: s.sinks.clone(),
                order: s.order.iter().map(|r| self.canon(rel, r)).collect(),
                returns_calls: {
                    // A function's own: a class's methods are not its body.
                    let mut calls: Vec<String> = s
                        .returns_calls
                        .iter()
                        .filter(|_| s.kind == drift_core::SymbolKind::Function)
                        .map(|r| self.canon(rel, r))
                        .collect();
                    calls.sort();
                    calls.dedup();
                    calls
                },
                traits: s.traits.clone(),
                field_decorators: s
                    .field_decorators
                    .iter()
                    .map(|r| self.canon(rel, r))
                    .collect(),
                omits: vec![],
                declares: vec![],
                meta: vec![],
                decorator_args: s
                    .decorator_args
                    .iter()
                    .map(|(k, g)| format!("{}={}", self.operand(rel, k, ""), self.canon(rel, g)))
                    .collect(),
                disclaims: vec![],
                derives_from: s
                    .derives_from
                    .as_ref()
                    .or_else(|| factory_derivation(s))
                    .map(|r| self.canon(rel, r))
                    .unwrap_or_default(),
                arg_types: vec![],
                returns_wrapped_by: s
                    .returns_wrapped_by
                    .iter()
                    .map(|r| self.canon(rel, r))
                    .collect(),
                after_continuation: s
                    .after_continuation
                    .iter()
                    .map(|r| self.canon(rel, r))
                    .collect(),
                // A candidate until type resolution proves the callee returns a
                // function (`crate::typeres::TypeIndex::annotate`).
                made_by: s
                    .made_by
                    .as_ref()
                    .map(|r| self.canon(rel, r))
                    .unwrap_or_default(),
                members: s
                    .members
                    .iter()
                    .map(|m| drift_core::Member {
                        name: m.name.clone(),
                        calls: m.calls.iter().map(|r| self.canon(rel, r)).collect(),
                        sinks: m.sinks.clone(),
                        returns_nonconstant_bool: m.returns_nonconstant_bool,
                        returns_only_true: m.returns_only_true,
                        body_checks: m
                            .body_checks
                            .iter()
                            .map(|c| drift_core::BodyCheck {
                                source: self.operand(rel, &c.source, ""),
                                reads: c.reads.clone(),
                                compares: self.operand(rel, &c.compares, "call:"),
                                outcome: c.outcome,
                                op: c.op.clone(),
                                conditional: c.conditional,
                                condition: check_condition(c),
                                unless: c.unless.clone(),
                                compares_path: c.compares_path.clone(),
                                after: self.after(rel, &c.after),
                            })
                            .collect(),
                        throws: m.throws.iter().map(|r| self.canon(rel, r)).collect(),
                        conditional_calls: self.conditional_calls(rel, &m.conditional_calls),
                        receiver_calls: self.receiver_calls(rel, &m.receiver_calls),
                        order: self.after(rel, &m.order),
                        is_async: m.is_async,
                        args: m
                            .args
                            .iter()
                            .map(|(r, i, k)| format!("{}@{i}:{k}", self.canon(rel, r)))
                            .collect(),
                        unread: {
                            // With what the method's own body filters by and hands
                            // on ([`Linker::flow_controls`]), and the keys it
                            // filters by a value of the caller.
                            let mut unread = m.unread.clone();
                            unread.extend(self.flow_controls(
                                rel,
                                &m.arg_sides,
                                &m.loose_sides,
                                &m.param_keys,
                            ));
                            unread.extend(m.caller_keys.iter().map(|(callee, key)| {
                                format!(
                                    "{}{}\t{key}\tcaller",
                                    drift_core::controls::FILTER_VALUE,
                                    self.canon(rel, callee)
                                )
                            }));
                            unread.sort();
                            unread.dedup();
                            unread
                        },
                        caller_args: self.caller_args(rel, &m.caller_args),
                        // Python records these for a method; TypeScript does not yet.
                        scoped_queries: vec![],
                        raise_checks: vec![],
                        ..Default::default()
                    })
                    .collect(),
                truncated: vec![],
                server_reads: s.server_reads.clone(),
                body_checks: vec![],
                responses: vec![],
                log_calls: vec![],
                catches: vec![],
                headers: vec![],
                inputs: vec![],
                handles_errors: vec![],
                scoped_queries: vec![],
                raise_checks: vec![],
                alias_of: String::new(),
                receiver_calls: self.receiver_calls(rel, &s.receiver_calls),
                returns_instance: String::new(),
                // Of the listed reading only (below).
                caller_args: Vec::new(),
                returns_type: String::new(),
                attr_types: vec![],
                conditional_calls: self.conditional_calls(rel, &s.conditional_calls),
                // What is given for a path may be a router mounted there: not a
                // middleware of the routes beside it.
                app_middleware: {
                    let mut all: Vec<String> = s
                        .app_middleware
                        .iter()
                        .map(|r| self.canon(rel, r))
                        .filter(|c| !self.routers.contains(c))
                        .collect();
                    let chains = served
                        .get(s.name.as_str())
                        .map(Vec::as_slice)
                        .unwrap_or_default();
                    // What every way the route is served runs before it; what only
                    // one does is that mount's own
                    // ([`drift_core::MountFacts::app_middleware`]).
                    for h in chains.iter().flat_map(|c| &c.hooks) {
                        if chains.iter().all(|c| c.hooks.contains(h)) && !all.contains(h) {
                            all.push(h.clone());
                        }
                    }
                    for (callee, at) in &s.app_passed {
                        for h in self.app_passed(&self.canon(rel, callee), *at) {
                            if !all.contains(&h) {
                                all.push(h);
                            }
                        }
                    }
                    for how in &s.app_unread {
                        let h = format!("?{}{how}", drift_core::APP_UNREAD);
                        if !all.contains(&h) {
                            all.push(h);
                        }
                    }
                    // A Nest route: what its application runs before it.
                    if let Some((_, class)) = f
                        .raw
                        .nest_routes
                        .iter()
                        .find(|(symbol, _)| *symbol == s.name)
                        && let Some(e) = f.raw.entry_points.iter().find(|e| e.symbol == s.name)
                    {
                        for h in self.nest_middleware(
                            &package,
                            &format!("{rel}#{class}"),
                            e.route.as_deref().unwrap_or("?"),
                            e.method.as_deref().unwrap_or_default(),
                        ) {
                            if !all.contains(&h) {
                                all.push(h);
                            }
                        }
                        for (_, h) in self.nest_guards.iter().filter(|(p, _)| *p == package) {
                            if !all.contains(h) {
                                all.push(h.clone());
                            }
                        }
                    }
                    all
                },
                is_async: s.is_async,
            })
            .collect();
        for (sym, raw) in symbols.iter_mut().zip(&raw_symbols) {
            self.practice(rel, raw, sym);
            // A handler decorated with a composed decorator (`@RequireAuthentication()`
            // = `applyDecorators(UseGuards(G), ...)`) is guarded by G. Not classes:
            // their handlers carry the class's decorators already.
            if sym.kind != drift_core::SymbolKind::Class && !self.composed.is_empty() {
                let mut guards = BTreeSet::new();
                for w in sym
                    .wraps
                    .iter()
                    .filter(|w| w.kind == drift_core::WrapKind::Decorator)
                {
                    self.composed_guards(&w.wrapper, 0, &mut guards);
                }
                sym.decorator_args
                    .extend(guards.into_iter().map(|g| format!("{NEST_USE_GUARDS}={g}")));
            }
        }

        let lang = Path::new(rel)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_string();
        let discovers = f
            .raw
            .discovers
            .iter()
            .filter_map(|g| discover_glob(rel, &package, g))
            .collect();
        let mut facts = FileFacts {
            path: f.rel_path.clone(),
            hash: f.hash.clone(),
            lang,
            package,
            parse_ok: f.raw.parse_ok,
            directives: f.raw.directives.clone(),
            imports,
            exports,
            symbols,
            entry_points: vec![],
            has_test: false,
            type_only: f.raw.type_only,
            client_leaks: vec![],
            registries: f
                .raw
                .lists
                .iter()
                .filter_map(|l| self.registry(rel, l))
                .collect(),
            truncated: vec![],
            unlisted_routes: f.raw.unlisted_routes.clone(),
            discovers,
            outgoing: f.raw.outgoing.clone(),
            test_requests: f
                .raw
                .test_requests
                .iter()
                .map(|t| drift_core::TestRequest {
                    method: t.method.clone(),
                    route: t.route.clone(),
                    target: t
                        .target
                        .as_ref()
                        .map(|spec| {
                            specs
                                .get(spec)
                                .cloned()
                                .unwrap_or_else(|| format!("unresolved:{spec}"))
                        })
                        .unwrap_or_default(),
                    statuses: t.statuses.clone(),
                    dynamic: t.dynamic,
                })
                .collect(),
            mocks: f
                .raw
                .mocks
                .iter()
                .map(|m| {
                    if m.starts_with(drift_core::practice::MSW_PREFIX) {
                        m.clone()
                    } else {
                        specs
                            .get(m)
                            .cloned()
                            .unwrap_or_else(|| format!("unresolved:{m}"))
                    }
                })
                .collect(),
            route_matchers: f.raw.route_matchers.clone(),
            mounts: vec![],
            apps: vec![],
            listed: None,
        };
        // The calls whose shape is recorded: a symbol's own, and for a route those
        // of every way it is served ([`drift_core::Listed::guard_calls`]).
        let guard_calls: Vec<drift_core::SymbolCalls> = raw_symbols
            .iter()
            .map(|s| {
                let mut calls: Vec<drift_core::GuardCall> = s
                    .guard_calls
                    .iter()
                    .map(|c| self.guard_call(rel, c))
                    .filter(|c| !self.routers.contains(&c.callee))
                    .collect();
                for chain in served.get(s.name.as_str()).into_iter().flatten() {
                    calls.extend(chain.calls.iter().cloned());
                }
                for (callee, at) in &s.app_passed {
                    calls.extend(self.passed_calls(&self.canon(rel, callee), *at));
                }
                let mut caught: Vec<String> = s
                    .caught
                    .iter()
                    .map(|r| self.canon(rel, r))
                    .chain(s.caught_params.iter().cloned())
                    .collect();
                caught.sort();
                caught.dedup();
                let mut given_credential: Vec<String> = s
                    .given_credential
                    .iter()
                    .map(|r| self.canon(rel, r))
                    .collect();
                given_credential.sort();
                given_credential.dedup();
                let mut verifies = s.verifies.clone();
                verifies.sort();
                verifies.dedup();
                drift_core::SymbolCalls {
                    symbol: s.name.clone(),
                    line: s.line,
                    calls,
                    hands_on: s.hands_on,
                    returns_function: s.returns_function,
                    caught,
                    given_credential,
                    verifies,
                    param_flows: s.param_flows,
                }
            })
            .collect();
        facts.entry_points = crate::nextjs::entry_points(&facts, self.uses_next(&facts.package));
        // A route of a file-convention router other than Next.js: listed since the
        // measured build, with what runs before it (a parent route, a server hook)
        // unread.
        if f.raw.file_routes
            && let Some(framework) = self.file_router(&facts.package)
        {
            // What runs before the handler is not read, but for a React Router
            // or Remix route of a package that puts nothing there: no router of
            // its own (a server whose middleware runs first) and no route module
            // that exports a middleware.
            let within = |path: &str| {
                facts.package.is_empty()
                    || path
                        .strip_prefix(facts.package.as_str())
                        .is_some_and(|rest| rest.starts_with('/'))
            };
            let unread_before = framework != crate::filerouters::Framework::ReactRouter
                || self.routers.iter().any(|r| within(r))
                || self.route_middleware.iter().any(|f| within(f));
            for e in crate::filerouters::entry_points(&facts, framework) {
                if facts.entry_points.iter().any(|x| x.symbol == e.symbol) {
                    continue;
                }
                facts.mounts.push(drift_core::MountFacts {
                    symbol: e.symbol.clone(),
                    route: e.route.clone().unwrap_or_default(),
                    wraps: vec![],
                    opaque: unread_before,
                    elsewhere: false,
                    app_middleware: vec![],
                });
                facts.entry_points.push(e);
            }
        }
        // Route paths from adapters are file-local: one entry point for each way the
        // route's router is mounted, under that mount's prefix.
        for e in &raw_entry_points {
            let chains = served.get(e.symbol.as_str());
            let (Some(chains), Some(route)) = (chains, &e.route) else {
                facts.entry_points.push((*e).clone());
                continue;
            };
            let shared = common(&e.symbol);
            for c in chains {
                let full = match c.prefix.as_str() {
                    "" => route.clone(),
                    prefix => crate::lower::routes::join_path(&[prefix, route]),
                };
                let adds: Vec<Wrap> = c
                    .middleware
                    .iter()
                    .filter(|w| !shared.contains(w))
                    .map(|w| Wrap {
                        wrapper: w.clone(),
                        kind: drift_core::WrapKind::Call,
                    })
                    .collect();
                // What this mount runs before the route and the others do not.
                let own: Vec<String> = c
                    .hooks
                    .iter()
                    .filter(|h| !chains.iter().all(|x| x.hooks.contains(h)))
                    .cloned()
                    .collect();
                if !adds.is_empty() || c.opaque || !own.is_empty() {
                    facts.mounts.push(drift_core::MountFacts {
                        symbol: e.symbol.clone(),
                        route: full.clone(),
                        wraps: adds,
                        opaque: c.opaque,
                        elsewhere: false,
                        app_middleware: own,
                    });
                }
                facts.entry_points.push(drift_core::EntryPoint {
                    route: Some(full),
                    ..(*e).clone()
                });
            }
        }
        facts.normalize();
        // A function written in place where a middleware goes is a symbol the last
        // measured build did not list: the practice map and `drift security` read
        // it, mining does not ([`drift_core::Listed`]).
        let in_place: BTreeSet<&str> = raw_symbols
            .iter()
            .filter(|s| s.in_place)
            .map(|s| s.name.as_str())
            .collect();
        // What a symbol does that only the practice map and `drift security` read
        // ([`crate::lower::RawSymbol::listed_controls`]).
        // With the route metadata a Nest decorator sets and a guard class consults
        // ([`crate::lower::RawSymbol::nest_metadata`]), canonical.
        let listed_controls: Vec<(&str, u32, Vec<String>)> = raw_symbols
            .iter()
            .filter(|s| {
                !s.listed_controls.is_empty()
                    || !s.caller_keys.is_empty()
                    || !s.fed_sinks.is_empty()
                    || !s.param_passes.is_empty()
                    || !s.refuses_without.is_empty()
                    || !s.made_fed_sinks.is_empty()
                    || !s.made_passes.is_empty()
                    || !s.nest_metadata.is_empty()
                    || !s.result_uses.is_empty()
                    || !s.returns_builder.is_empty()
                    || !s.unread_exits.is_empty()
            })
            .map(|s| {
                // What the body does with what a function that turns callers away
                // by its value hands back ([`crate::lower::RawSymbol::result_uses`]).
                let uses = s.result_uses.iter().filter_map(|(callee, how)| {
                    let callee = self.canon(rel, callee);
                    if !self.hands_back.contains(&callee) {
                        // A function that answers on the response it was handed:
                        // only that its value is dropped.
                        return (how == "drop" && self.answers.contains(&callee))
                            .then(|| format!("{}{callee}", drift_core::controls::DROPS_RESULT_OF));
                    }
                    Some(match how.strip_prefix("return:") {
                        Some(key) => {
                            format!("{}{key}@{callee}", drift_core::controls::RETURNS_RESULT_OF)
                        }
                        None => format!("{}{callee}", drift_core::controls::DROPS_RESULT_OF),
                    })
                });
                let metadata = s.nest_metadata.iter().map(|(control, key)| {
                    let key = self.operand(rel, key, "");
                    match self.texts.get(&key) {
                        Some(text) => format!("{control}\"{text}\""),
                        None => format!("{control}{key}"),
                    }
                });
                // A call of a refusal builder of another module returned: the
                // function refuses by the response it hands back.
                let mut built = Vec::new();
                if self.returns_builder(rel, s) {
                    built.push(drift_core::controls::REJECTS_CALLER.to_string());
                    if !s.other_rejection {
                        built.push(drift_core::controls::RETURNS_REJECTION.to_string());
                    }
                }
                // What a branch on a value of the caller hands back that was not read
                // ([`crate::lower::RawSymbol::unread_exits`]): of a call, where the
                // callee is a refusal builder of 401.
                let unread: BTreeSet<String> = s
                    .unread_exits
                    .iter()
                    .filter(|(callee, _)| {
                        callee.as_ref().is_none_or(|c| {
                            self.builders.get(&self.canon(rel, c))
                                == Some(&drift_core::CheckOutcome::Unauthenticated)
                        })
                    })
                    .map(|(_, source)| {
                        format!(
                            "{}{}",
                            drift_core::controls::EXIT_UNREAD,
                            self.operand(rel, source, "")
                        )
                    })
                    .collect();
                (
                    s.name.as_str(),
                    s.line,
                    s.listed_controls
                        .iter()
                        .cloned()
                        // Where the value a query filters by comes from: the
                        // caller's own ([`crate::lower::RawSymbol::caller_keys`]).
                        .chain(s.caller_keys.iter().map(|(callee, key)| {
                            format!(
                                "{}{}\t{key}\tcaller",
                                drift_core::controls::FILTER_VALUE,
                                self.canon(rel, callee)
                            )
                        }))
                        .chain(
                            s.fed_sinks
                                .iter()
                                .map(|k| format!("{}{k}", drift_core::controls::SINK_FED)),
                        )
                        // Handed on to code of the repository: what a built-in or a
                        // package does with it is not followed.
                        .chain(
                            s.param_passes
                                .iter()
                                .map(|callee| self.canon(rel, callee))
                                .filter(|c| !c.starts_with("global#") && !c.starts_with("pkg:"))
                                .map(|c| format!("{}{c}", drift_core::controls::PASSES_PARAM)),
                        )
                        .chain(s.refuses_without.iter().map(|by| {
                            format!(
                                "{}{}",
                                drift_core::controls::REFUSES_WITHOUT,
                                by.iter()
                                    .map(|callee| self.canon(rel, callee))
                                    .collect::<Vec<_>>()
                                    .join("\t")
                            )
                        }))
                        .chain(
                            s.made_fed_sinks
                                .iter()
                                .map(|k| format!("{}{k}", drift_core::controls::SINK_FED_MADE)),
                        )
                        .chain(
                            s.made_passes
                                .iter()
                                .map(|callee| self.canon(rel, callee))
                                .filter(|c| !c.starts_with("global#") && !c.starts_with("pkg:"))
                                .map(|c| format!("{}{c}", drift_core::controls::PASSES_MADE)),
                        )
                        .chain(metadata)
                        .chain(uses)
                        .chain(built)
                        .chain(unread)
                        .collect::<Vec<String>>(),
                )
            })
            .filter(|(_, _, controls)| !controls.is_empty())
            .collect();
        // A function whose every answer of "not signed in" stands in a branch after
        // which it goes on turns no one away for the listed reading
        // ([`crate::lower::RawSymbol::rejection_goes_on`]); nor does a refusal
        // builder, which checks no one: what it builds refuses only as the exit of
        // a caller's check ([`crate::lower::RawSymbol::builder_checks`]).
        let goes_on: Vec<(&str, u32)> = raw_symbols
            .iter()
            .filter(|s| s.rejection_goes_on || s.refusal_builder.is_some())
            .map(|s| (s.name.as_str(), s.line))
            .collect();
        // The checks of branches that return a call of a refusal builder of
        // another module, with its status ([`crate::lower::RawSymbol::builder_checks`]),
        // for the listed reading.
        let built: Vec<(&str, u32, Vec<drift_core::BodyCheck>)> = raw_symbols
            .iter()
            .filter(|s| !s.builder_checks.is_empty())
            .map(|s| {
                let checks = s
                    .builder_checks
                    .iter()
                    .filter_map(|(callee, c)| {
                        let outcome = *self.builders.get(&self.canon(rel, callee))?;
                        Some(drift_core::BodyCheck {
                            source: self.operand(rel, &c.source, ""),
                            reads: c.reads.clone(),
                            compares: self.operand(rel, &c.compares, "call:"),
                            outcome,
                            op: c.op.clone(),
                            conditional: c.conditional,
                            condition: check_condition(c),
                            unless: c.unless.clone(),
                            compares_path: c.compares_path.clone(),
                            after: self.after(rel, &c.after),
                        })
                    })
                    .collect();
                (s.name.as_str(), s.line, checks)
            })
            .filter(|(_, _, checks): &(&str, u32, Vec<drift_core::BodyCheck>)| !checks.is_empty())
            .collect();
        // The wraps of a route that the listed reading does not hold
        // ([`crate::lower::RawSymbol::listed_unwraps`]).
        let unwraps: Vec<(&str, u32, Vec<String>)> = raw_symbols
            .iter()
            .filter(|s| !s.listed_unwraps.is_empty())
            .map(|s| {
                let wraps = s.listed_unwraps.iter().map(|r| self.canon(rel, r));
                (s.name.as_str(), s.line, wraps.collect())
            })
            .collect();
        // The guards a body's `useGlobalGuards(...)` names are what mining reads of
        // the call; the listed reading has the call itself, on the routes
        // ([`crate::lower::RawSymbol::measured_args`]).
        let measured_args: Vec<(&str, u32, Vec<String>)> = raw_symbols
            .iter()
            .filter(|s| !s.measured_args.is_empty())
            .map(|s| {
                let args = s
                    .measured_args
                    .iter()
                    .map(|(k, g)| format!("{}={}", self.operand(rel, k, ""), self.canon(rel, g)));
                (s.name.as_str(), s.line, args.collect())
            })
            .collect();
        // What a body does with a value of the caller, and the tags of its tagged
        // templates as calls ([`crate::lower::RawSymbol::caller_args`],
        // [`crate::lower::RawSymbol::tags`]).
        let flows: Vec<(&str, u32, Vec<String>, Vec<String>)> = raw_symbols
            .iter()
            .filter(|s| !s.caller_args.is_empty() || !s.tags.is_empty())
            .map(|s| {
                (
                    s.name.as_str(),
                    s.line,
                    self.caller_args(rel, &s.caller_args),
                    s.tags
                        .iter()
                        .map(|t| self.canon(rel, t))
                        .collect::<Vec<String>>(),
                )
            })
            .filter(|(_, _, args, tags)| !args.is_empty() || !tags.is_empty())
            .collect();
        if !in_place.is_empty()
            || !listed_controls.is_empty()
            || !flows.is_empty()
            || !measured_args.is_empty()
            || !goes_on.is_empty()
            || !unwraps.is_empty()
            || !built.is_empty()
        {
            let mut measured = facts.clone();
            for (name, line, checks) in built {
                for s in facts
                    .symbols
                    .iter_mut()
                    .filter(|s| s.name == name && s.line == line)
                {
                    for c in &checks {
                        if !s.body_checks.contains(c) {
                            s.body_checks.push(c.clone());
                        }
                    }
                }
            }
            for (name, line, wraps) in unwraps {
                for s in facts
                    .symbols
                    .iter_mut()
                    .filter(|s| s.name == name && s.line == line)
                {
                    s.wraps.retain(|w| {
                        !(w.kind == drift_core::WrapKind::Call && wraps.contains(&w.wrapper))
                    });
                }
            }
            for (name, line) in goes_on {
                for s in facts
                    .symbols
                    .iter_mut()
                    .filter(|s| s.name == name && s.line == line)
                {
                    s.controls
                        .retain(|c| c != drift_core::controls::REJECTS_CALLER);
                }
            }
            for (name, line, args, tags) in flows {
                for s in facts
                    .symbols
                    .iter_mut()
                    .filter(|s| s.name == name && s.line == line)
                {
                    s.caller_args = args.clone();
                    for t in &tags {
                        if !s.calls.contains(t) {
                            s.calls.push(t.clone());
                        }
                    }
                    s.calls.sort();
                }
            }
            for (name, line, controls) in listed_controls {
                for s in facts
                    .symbols
                    .iter_mut()
                    .filter(|s| s.name == name && s.line == line)
                {
                    s.controls.extend(controls.iter().cloned());
                    s.controls.sort();
                    s.controls.dedup();
                }
            }
            for (name, line, args) in measured_args {
                for s in facts
                    .symbols
                    .iter_mut()
                    .filter(|s| s.name == name && s.line == line)
                {
                    for a in &args {
                        if let Some(i) = s.decorator_args.iter().position(|x| x == a) {
                            s.decorator_args.remove(i);
                        }
                    }
                }
            }
            measured
                .symbols
                .retain(|s| !in_place.contains(s.name.as_str()));
            // A route of a router a function builds is listed with them.
            measured
                .entry_points
                .retain(|e| !in_place.contains(e.symbol.as_str()));
            measured
                .mounts
                .retain(|m| !in_place.contains(m.symbol.as_str()));
            measured.hold(facts);
            measured.hold_guard_calls(guard_calls);
            measured.hold_rewrites(f.raw.rewrites.clone());
            return measured;
        }
        facts.hold_guard_calls(guard_calls);
        facts.hold_rewrites(f.raw.rewrites.clone());
        facts
    }

    /// Modules `f` loads through a lazy-load helper of the repo
    /// (`optionalRequire("@scope/pkg")`): `lazy` import edges, or static ones for a
    /// call that runs when the module loads or a module `f` also re-exports. A
    /// relative specifier is resolved from the helper's file, which loads it.
    fn add_helper_loads(&self, f: &LoweredFile, imports: &mut Vec<Import>) {
        if self.loaders.is_empty() {
            return;
        }
        let rel = f.rel_path.as_str();
        let own_dir = f.abs_path.parent().unwrap_or(&f.abs_path);
        let mut loads: BTreeMap<String, ImportLoad> = BTreeMap::new();
        for c in &f.raw.loader_calls {
            let Some((params, helper_dir)) = self.loaders.get(&self.canon(rel, &c.callee)) else {
                continue;
            };
            let load = if c.eager {
                ImportLoad::Static
            } else {
                ImportLoad::Lazy
            };
            for (_, spec) in c.args.iter().filter(|(i, _)| params.contains(i)) {
                let dir = if spec.starts_with('.') {
                    helper_dir.as_path()
                } else {
                    own_dir
                };
                let module = self.resolver.resolve(dir, spec);
                let e = loads.entry(module).or_insert(load);
                *e = e.earliest(load);
            }
        }
        if loads.is_empty() {
            return;
        }
        // A module the file re-exports is already a static import of it
        // (`reexport_imports`): the load below keeps it static.
        for (module, load) in loads {
            match imports
                .iter_mut()
                .find(|i| !i.type_only && i.module == module)
            {
                Some(i) => i.load = i.load.earliest(load),
                None => imports.push(Import {
                    module,
                    names: vec!["*".into()],
                    type_only: false,
                    load,
                }),
            }
        }
    }

    /// Resolved specifiers for one file (specifier -> canonical module id).
    pub fn specs_of(&self, rel_path: &str) -> Option<&BTreeMap<String, String>> {
        self.specs.get(rel_path)
    }

    pub fn resolver(&self) -> &ModuleResolver {
        self.resolver
    }
}

/// [`drift_core::BodyCheck::condition`] of a lowered check.
fn check_condition(c: &crate::lower::RawBodyCheck) -> String {
    if !c.condition.is_empty() {
        c.condition.clone()
    } else if c.conditional {
        drift_core::not_always::UNDER_BRANCH.to_string()
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{bare_package, workspace_from};
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    #[test]
    fn bare_package_names() {
        assert_eq!(bare_package("zod"), Some("zod"));
        assert_eq!(bare_package("next/server"), Some("next"));
        assert_eq!(bare_package("@dub/utils/src/x"), Some("@dub/utils"));
        assert_eq!(bare_package("@/lib/auth"), None);
        assert_eq!(bare_package("./x"), None);
        assert_eq!(bare_package("#internal"), None);
        assert_eq!(bare_package("~/x"), None);
    }

    #[test]
    fn duplicate_workspace_names_prefer_nested_packages() {
        let root = std::path::Path::new("/r");
        let pj = |rel: &str, name: &str| (rel.to_string(), format!("{{\"name\":\"{name}\"}}"));
        let ws = workspace_from(
            root,
            &[
                pj("package.json", "@x/core"),
                pj("packages/z/package.json", "@x/z"),
                pj("packages/core/package.json", "@x/core"),
                pj("samples/z/package.json", "@x/z"),
            ],
        );
        assert_eq!(ws["@x/core"], root.join("packages/core"));
        assert_eq!(ws["@x/z"], root.join("packages/z"));
    }

    fn write(root: &std::path::Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    /// The module ids `specs` resolve to from `src/routes`, on another thread:
    /// `None` when resolving did not finish (a hang on a planted file).
    fn resolved(root: &std::path::Path, specs: &[&'static str]) -> Option<Vec<String>> {
        let root = root.canonicalize().unwrap();
        let specs = specs.to_vec();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let r = super::ModuleResolver::new(&root, Default::default());
            let from = root.join("src/routes");
            let _ = tx.send(specs.iter().map(|s| r.resolve(&from, s)).collect());
        });
        rx.recv_timeout(std::time::Duration::from_secs(20)).ok()
    }

    fn healthy(root: &std::path::Path) {
        write(root, "src/lib/auth.ts", "export const a = 1;\n");
        write(root, "src/lib/index.ts", "export * from './auth';\n");
        write(root, "src/util.js", "export const u = 1;\n");
        write(
            root,
            "src/routes/r.ts",
            "import { a } from '../lib/auth';\n",
        );
    }

    const SPECS: &[&str] = &[
        "../lib/auth",
        "../lib",
        "../util.js",
        "../lib/auth.js",
        "zod",
    ];
    const WANT: &[&str] = &[
        "src/lib/auth.ts",
        "src/lib/index.ts",
        "src/util.js",
        "src/lib/auth.ts",
        "pkg:zod",
    ];

    /// A `package.json` that is not JSON used to fail every relative import below it.
    #[test]
    fn a_malformed_package_json_does_not_unresolve_relative_imports() {
        let dir = tempfile::tempdir().unwrap();
        healthy(dir.path());
        assert_eq!(resolved(dir.path(), SPECS).unwrap(), WANT);
        write(dir.path(), "package.json", "{ not json");
        assert_eq!(resolved(dir.path(), SPECS).unwrap(), WANT);
        // One in a parent directory of the importer only.
        let nested = tempfile::tempdir().unwrap();
        healthy(nested.path());
        write(nested.path(), "src/package.json", "\u{0}\u{1}");
        assert_eq!(resolved(nested.path(), SPECS).unwrap(), WANT);
    }

    /// A `package.json` or `tsconfig.json` that is a FIFO (the resolver blocked
    /// opening it) or a link to `/dev/zero` (read until memory ran out).
    #[cfg(unix)]
    #[test]
    fn planted_manifests_do_not_hang_the_resolver() {
        for name in ["package.json", "tsconfig.json", "src/package.json"] {
            for fifo in [true, false] {
                let dir = tempfile::tempdir().unwrap();
                healthy(dir.path());
                let p = dir.path().join(name);
                if fifo {
                    let made = std::process::Command::new("mkfifo")
                        .arg(&p)
                        .status()
                        .is_ok_and(|s| s.success());
                    if !made {
                        continue;
                    }
                } else {
                    std::os::unix::fs::symlink("/dev/zero", &p).unwrap();
                }
                let got = resolved(dir.path(), SPECS)
                    .unwrap_or_else(|| panic!("{name} (fifo: {fifo}) hung the resolver"));
                assert_eq!(got, WANT, "{name} (fifo: {fifo})");
            }
        }
    }

    #[test]
    fn jsonc_strings_keep_non_ascii_text() {
        let text = "{ // c\n \"paths\": { \"@/caf\u{e9}/*\": [\"./src/\u{65e5}\u{672c}/*\", \"./\\\"\u{e9}\"], }, }";
        let v: serde_json::Value = serde_json::from_str(&super::strip_jsonc(text)).unwrap();
        let paths = v["paths"].as_object().unwrap();
        assert_eq!(paths.keys().next().unwrap(), "@/caf\u{e9}/*");
        assert_eq!(paths["@/caf\u{e9}/*"][0], "./src/\u{65e5}\u{672c}/*");
        assert_eq!(paths["@/caf\u{e9}/*"][1], "./\"\u{e9}");
    }

    /// Barrels that forward one name from one module and another from a second, and
    /// a module that renames a name another module exports under its own name.
    const BARRELS: &[(&str, &str)] = &[
        (
            "lib/a.ts",
            "export const x = 1;\nexport const shared = 1;\n",
        ),
        (
            "lib/b.ts",
            "export const y = 1;\nexport const shared = 2;\n",
        ),
        (
            "lib/index.ts",
            "export * from './a';\nexport * from './b';\nexport { y as z } from './b';\n",
        ),
        ("lib/other.ts", "export { x as y } from './a';\n"),
        ("lib/again.ts", "export * from './index';\n"),
    ];

    const ORIGINS: &[(&str, &str, &str)] = &[
        ("lib/index.ts", "x", "lib/a.ts#x"),
        ("lib/index.ts", "y", "lib/b.ts#y"),
        ("lib/index.ts", "z", "lib/b.ts#y"),
        ("lib/index.ts", "shared", "lib/a.ts#shared"),
        ("lib/index.ts", "nope", "lib/index.ts#nope"),
        ("lib/other.ts", "y", "lib/a.ts#x"),
        ("lib/other.ts", "x", "lib/other.ts#x"),
        ("lib/again.ts", "y", "lib/b.ts#y"),
        ("lib/again.ts", "z", "lib/b.ts#y"),
        ("lib/b.ts", "y", "lib/b.ts#y"),
        ("pkg:zod", "y", "pkg:zod#y"),
        ("lib/index.ts", "*", "lib/index.ts#*"),
    ];

    /// A linker over [`BARRELS`], written under `root`.
    fn barrels(root: &std::path::Path) -> (super::ModuleResolver, Vec<super::LoweredFile>) {
        for (rel, body) in BARRELS {
            write(root, rel, body);
        }
        let resolver = super::ModuleResolver::new(root, Default::default());
        let files = BARRELS
            .iter()
            .map(|(rel, body)| super::LoweredFile {
                rel_path: rel.to_string(),
                abs_path: root.join(rel),
                hash: String::new(),
                raw: crate::lower::lower_file(rel, body),
            })
            .collect();
        (resolver, files)
    }

    /// `origin` remembers its answers per module and name: one linker asked every
    /// question, in either order and from several threads at once, answers each as a
    /// fresh linker does.
    #[test]
    fn remembered_origins_are_a_fresh_linkers() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let (resolver, files) = barrels(&root);
        for (module, name, want) in ORIGINS {
            let fresh = super::Linker::new(&resolver, &files);
            assert_eq!(fresh.origin(module, name), *want, "{module} {name}");
        }
        for reversed in [false, true] {
            let linker = super::Linker::new(&resolver, &files);
            let mut asks: Vec<_> = ORIGINS.iter().chain(ORIGINS).collect();
            if reversed {
                asks.reverse();
            }
            for (module, name, want) in asks {
                assert_eq!(linker.origin(module, name), *want, "{module} {name}");
            }
        }
        let linker = super::Linker::new(&resolver, &files);
        std::thread::scope(|s| {
            for t in 0..4 {
                let linker = &linker;
                s.spawn(move || {
                    for k in 0..ORIGINS.len() * 4 {
                        let (module, name, want) = ORIGINS[(k * (t + 1) + t) % ORIGINS.len()];
                        assert_eq!(linker.origin(module, name), want, "{module} {name}");
                    }
                });
            }
        });
    }

    /// Every directory below a tsconfig reads that file's `paths` (and what it extends)
    /// from one memo, per file: each directory gets what a fresh resolver reads for it.
    #[test]
    fn tsconfig_paths_are_read_once_per_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        write(
            &root,
            "tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }"#,
        );
        write(&root, "src/a/x.ts", "export const x = 1;\n");
        write(
            &root,
            "packages/p/tsconfig.json",
            r#"{ "extends": "../../tsconfig.json", "compilerOptions": { "baseUrl": "." } }"#,
        );
        write(&root, "packages/p/lib/y.ts", "export const y = 1;\n");
        write(
            &root,
            "packages/q/tsconfig.json",
            r#"{ "compilerOptions": { "paths": { "~/*": ["lib/*"], "@/*": ["other/*"] } } }"#,
        );
        write(&root, "packages/q/lib/deep/z.ts", "export const z = 1;\n");
        write(
            &root,
            "packages/r/tsconfig.json",
            r#"{ "compilerOptions": {} }"#,
        );
        write(&root, "packages/r/src/w.ts", "export const w = 1;\n");
        let dirs = [
            "src/a",
            "packages/p/lib",
            "packages/q/lib/deep",
            "packages/r/src",
            "src",
            "packages/q/lib",
            "packages/p",
            "packages/r",
            "packages/q",
            "",
        ];
        let read =
            |r: &super::ModuleResolver, d: &str| format!("{:?}", r.ts_paths_for(&root.join(d)));
        let fresh: Vec<String> = dirs
            .iter()
            .map(|d| read(&super::ModuleResolver::new(&root, Default::default()), d))
            .collect();
        assert!(fresh[1].contains("base_url: Some") && fresh[1].contains("src/*"));
        assert!(fresh[2].contains("~/*") && fresh[2].contains("other/*"));
        assert_eq!(fresh[3], "None");
        for reversed in [false, true] {
            let r = super::ModuleResolver::new(&root, Default::default());
            let mut order: Vec<usize> = (0..dirs.len()).collect();
            if reversed {
                order.reverse();
            }
            for i in order {
                assert_eq!(read(&r, dirs[i]), fresh[i], "{}", dirs[i]);
            }
        }
    }

    /// The resolver remembers each answer per directory and specifier: one resolver
    /// asked again, in either order, answers as a fresh one does, and one specifier
    /// names a different module from each directory.
    #[test]
    fn resolved_specs_are_remembered_per_directory() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for d in ["a", "b", "a/c"] {
            write(&root, &format!("{d}/x.ts"), "export const x = 1;\n");
        }
        write(&root, "a/y.ts", "export const y = 1;\n");
        let asks = [
            ("a", "./x"),
            ("b", "./x"),
            ("a/c", "./x"),
            ("a/c", "../x"),
            ("a", "./y"),
            ("b", "./y"),
            ("a", "zod"),
            ("b", "node:fs"),
        ];
        let fresh: Vec<String> = asks
            .iter()
            .map(|(d, s)| {
                super::ModuleResolver::new(&root, Default::default()).resolve(&root.join(d), s)
            })
            .collect();
        assert_eq!(fresh[..4], ["a/x.ts", "b/x.ts", "a/c/x.ts", "a/x.ts"]);
        assert!(fresh[5].starts_with("unresolved:"));
        for reversed in [false, true] {
            let r = super::ModuleResolver::new(&root, Default::default());
            let mut order: Vec<usize> = (0..asks.len()).chain(0..asks.len()).collect();
            if reversed {
                order.reverse();
            }
            for i in order {
                let (d, s) = asks[i];
                assert_eq!(r.resolve(&root.join(d), s), fresh[i], "{d} {s}");
            }
        }
    }

    /// Imports of workspace packages whose manifests name build output map back to
    /// source, remembered per package directory and subpath: one resolver asked
    /// again, in either order, answers as a fresh one does.
    #[test]
    fn workspace_source_targets_are_remembered_per_package_and_subpath() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let manifest = r#"{ "name": "@w/NAME", "exports": { ".": "./dist/index.js", "./icons": "./dist/icons/index.js" } }"#;
        for p in ["ui", "kit"] {
            write(
                &root,
                &format!("packages/{p}/package.json"),
                &manifest.replace("NAME", p),
            );
            write(
                &root,
                &format!("packages/{p}/src/index.ts"),
                "export const a = 1;\n",
            );
        }
        write(
            &root,
            "packages/ui/src/icons/index.tsx",
            "export const i = 1;\n",
        );
        write(&root, "apps/web/page.ts", "export const p = 1;\n");
        let ws: BTreeMap<String, PathBuf> = ["ui", "kit"]
            .iter()
            .map(|p| (format!("@w/{p}"), root.join("packages").join(p)))
            .collect();
        let from = root.join("apps/web");
        let specs = ["@w/ui", "@w/ui/icons", "@w/kit", "@w/kit/icons"];
        let fresh: Vec<String> = specs
            .iter()
            .map(|s| super::ModuleResolver::new(&root, ws.clone()).resolve(&from, s))
            .collect();
        assert_eq!(
            fresh[..3],
            [
                "packages/ui/src/index.ts",
                "packages/ui/src/icons/index.tsx",
                "packages/kit/src/index.ts"
            ]
        );
        let targets = [("ui", ""), ("ui", "/icons"), ("kit", ""), ("kit", "/icons")];
        let target = |r: &super::ModuleResolver, (p, sub): (&str, &str)| {
            r.workspace_source_target(&root.join("packages").join(p), sub)
        };
        let want: Vec<_> = targets
            .iter()
            .map(|t| target(&super::ModuleResolver::new(&root, ws.clone()), *t))
            .collect();
        assert_eq!(want[1].as_deref(), Some("packages/ui/src/icons/index.tsx"));
        assert_eq!(want[3], None);
        for reversed in [false, true] {
            let r = super::ModuleResolver::new(&root, ws.clone());
            let mut order: Vec<usize> = (0..targets.len()).chain(0..targets.len()).collect();
            if reversed {
                order.reverse();
            }
            for i in order {
                assert_eq!(target(&r, targets[i]), want[i], "{:?}", targets[i]);
            }
        }
        for reversed in [false, true] {
            let r = super::ModuleResolver::new(&root, ws.clone());
            let mut order: Vec<usize> = (0..specs.len()).collect();
            if reversed {
                order.reverse();
            }
            for i in order {
                assert_eq!(r.resolve(&from, specs[i]), fresh[i], "{}", specs[i]);
            }
        }
    }
}
