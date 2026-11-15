//! What a repository installs that nothing fixes.
//!
//! A dependency named by a version of a registry, with a lockfile that records
//! its digest, is the code that was reviewed every time it installs. Four things a
//! manifest can say instead are read, each by what the file itself says:
//!
//! - **A repository named by a branch, a tag or nothing** (`"lib":
//!   "github:someone/lib"`, `lib @ git+https://host/someone/lib@main`, `lib = {
//!   git = "..." }`). What installs is whatever its owner pushes next. Not listed
//!   where the name is a full commit, or where a lockfile beside the manifest (or
//!   above it) records the commit that was resolved: the install is then that
//!   commit.
//! - **An archive at a URL with no digest** (`"lib": "https://host/lib.tgz"`,
//!   `https://host/lib.whl` in a requirements file with no `--hash`, `ADD
//!   https://host/tool /bin/tool` in a Dockerfile with no `--checksum`): what the
//!   server sends that day is what installs. Not listed where a lockfile records
//!   the URL with a digest.
//! - **A source fetched over plain HTTP, or with the certificate check turned
//!   off** (`registry=http://...`, `--index-url http://...`, `--trusted-host`,
//!   `strict-ssl=false`): whoever is on the path chooses the bytes. A source on
//!   the machine itself (`localhost`) is not listed.
//! - **A second package index beside the first** (`--extra-index-url`): pip takes
//!   a name from whichever index has the higher version, so a name meant for one
//!   can be answered by the other.
//! - **A download handed to an interpreter** while an image is built or a package
//!   is installed (`RUN curl ... | sh`, a `postinstall` script that does): as in a
//!   workflow ([`crate::workflows`]).
//!
//! Read: `package.json` with the npm, Yarn, pnpm and Bun lockfiles, `.npmrc` and
//! `.yarnrc.yml`; `requirements*.txt` and the files of a `requirements`
//! directory, `pyproject.toml` (PEP 508 strings, Poetry and uv tables) and
//! `Pipfile` with their lockfiles; `Cargo.toml` with `Cargo.lock`; Dockerfiles.
//! A path of the repository itself (`file:`, `workspace:`, `path = "..."`) is the
//! repository's code and is not listed. Nothing is installed and nothing outside
//! the repository is read; a file that does not parse is skipped.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

/// The largest manifest read.
const MAX_BYTES: u64 = 2 * 1024 * 1024;
/// The largest lockfile read.
const MAX_LOCK_BYTES: u64 = 48 * 1024 * 1024;
/// The most manifests read in one repository.
const MAX_FILES: usize = 2_000;
/// The directories below the root that are walked.
const MAX_DEPTH: usize = 8;
/// How far below the line that names a repository a lockfile writes its commit
/// (`remote:` then `revision:`, `url =` then `resolved_reference =`).
const LOCK_REACH: usize = 8;

/// One thing a manifest installs that nothing fixes ([`read`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct DependencyFinding {
    /// `mutable_git`, `unpinned_url`, `plain_http`, `second_index` or
    /// `piped_download`.
    pub kind: String,
    pub path: String,
    pub line: u32,
    /// The dependency as the manifest names it; empty where the file says it of
    /// every dependency (a registry, an index) or of none (a build step).
    pub name: String,
    /// What was read: the source as written, or the command that downloads.
    pub detail: String,
}

/// The lockfiles of each ecosystem, by the manifest they stand beside.
const NODE_LOCKS: &[&str] = &[
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
];
const PYTHON_LOCKS: &[&str] = &["poetry.lock", "uv.lock", "pdm.lock", "Pipfile.lock"];
const CARGO_LOCKS: &[&str] = &["Cargo.lock"];

/// The scripts of a `package.json` that run when the package is installed.
const INSTALL_SCRIPTS: &[&str] = &["preinstall", "install", "postinstall", "prepare"];

/// The manifests of the repository at `root`, read.
pub fn read(root: &Path) -> Vec<DependencyFinding> {
    let mut out = Vec::new();
    let mut seen = 0usize;
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .max_depth(Some(MAX_DEPTH))
        .filter_entry(|e| {
            !matches!(
                e.file_name().to_str(),
                Some(".git" | "node_modules" | ".venv" | "venv" | "target" | "vendor")
            )
        })
        .build();
    let mut files: Vec<std::path::PathBuf> = walker
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .map(|e| e.into_path())
        .collect();
    files.sort();
    for p in files {
        let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(kind) = manifest_kind(&p, name) else {
            continue;
        };
        if seen >= MAX_FILES {
            break;
        }
        seen += 1;
        if std::fs::metadata(&p).map_or(true, |m| m.len() > MAX_BYTES) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else {
            continue;
        };
        let Some(rel) = drift_core::ingest::rel_posix(root, &p) else {
            continue;
        };
        // Read with no lockfile first: most manifests name nothing a lockfile
        // would have to fix, and a lockfile is the largest file of a repository.
        let mut found = read_text(&rel, &text, "");
        let names = match kind {
            Manifest::Package => NODE_LOCKS,
            Manifest::Pyproject | Manifest::Pipfile => PYTHON_LOCKS,
            Manifest::Cargo => CARGO_LOCKS,
            _ => &[],
        };
        if !names.is_empty()
            && found
                .iter()
                .any(|f| matches!(f.kind.as_str(), "mutable_git" | "unpinned_url"))
        {
            found = read_text(&rel, &text, &locks(root, &p, names));
        }
        out.extend(found);
    }
    out.sort();
    out.dedup();
    out
}

/// What kind of manifest a file is, by its name and where it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Manifest {
    Package,
    NodeConfig,
    Requirements,
    Pyproject,
    Pipfile,
    Cargo,
    Dockerfile,
}

fn manifest_kind(path: &Path, name: &str) -> Option<Manifest> {
    let lower = name.to_ascii_lowercase();
    let in_requirements = path
        .parent()
        .and_then(|d| d.file_name())
        .and_then(|d| d.to_str())
        .is_some_and(|d| d.eq_ignore_ascii_case("requirements"));
    Some(match name {
        "package.json" => Manifest::Package,
        ".npmrc" | ".yarnrc.yml" => Manifest::NodeConfig,
        "pyproject.toml" => Manifest::Pyproject,
        "Pipfile" => Manifest::Pipfile,
        "Cargo.toml" => Manifest::Cargo,
        _ if lower.ends_with(".txt")
            && (lower.starts_with("requirements")
                || lower.starts_with("constraints")
                || in_requirements) =>
        {
            Manifest::Requirements
        }
        _ if lower == "dockerfile"
            || lower == "containerfile"
            || lower.starts_with("dockerfile.")
            || lower.ends_with(".dockerfile") =>
        {
            Manifest::Dockerfile
        }
        _ => return None,
    })
}

/// The text of the lockfiles that fix what the manifest at `manifest` installs:
/// those beside it and above it, up to the root (a workspace's lockfile is at its
/// root).
fn locks(root: &Path, manifest: &Path, names: &[&str]) -> String {
    let mut text = String::new();
    let mut dir = manifest.parent();
    while let Some(d) = dir {
        for n in names {
            let p = d.join(n);
            if std::fs::metadata(&p).is_ok_and(|m| m.is_file() && m.len() <= MAX_LOCK_BYTES)
                && let Ok(t) = std::fs::read_to_string(&p)
            {
                text.push_str(&t);
                text.push('\n');
            }
        }
        if d == root {
            break;
        }
        dir = d.parent();
    }
    text
}

/// The findings of one manifest, with the text of the lockfiles that stand for it
/// (`lock`; empty where there is none).
pub fn read_text(rel: &str, text: &str, lock: &str) -> Vec<DependencyFinding> {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let Some(kind) = manifest_kind(Path::new(rel), name) else {
        return Vec::new();
    };
    let lock = Lock::new(lock);
    let mut out = Found {
        rel,
        text,
        lock: &lock,
        out: Vec::new(),
    };
    match kind {
        Manifest::Package => package_json(&mut out),
        Manifest::NodeConfig => node_config(&mut out),
        Manifest::Requirements => requirements(&mut out),
        Manifest::Pyproject => pyproject(&mut out),
        Manifest::Pipfile => pipfile(&mut out),
        Manifest::Cargo => cargo(&mut out),
        Manifest::Dockerfile => dockerfile(&mut out),
    }
    out.out.sort();
    out.out.dedup();
    out.out
}

/// The lockfiles of a manifest, as lines.
struct Lock {
    lines: Vec<String>,
}

impl Lock {
    fn new(text: &str) -> Self {
        Lock {
            lines: text.lines().map(str::to_ascii_lowercase).collect(),
        }
    }

    /// A line names `needle`, and that line or one of the few below it in the same
    /// entry holds what `fixes` reads as a fixed content (a full commit, a digest).
    /// An entry ends at an empty line or at a closing brace: what the next entry
    /// records is of another dependency.
    fn fixes(&self, needle: &str, fixes: impl Fn(&str) -> bool) -> bool {
        let needle = needle.to_ascii_lowercase();
        !needle.is_empty()
            && self.lines.iter().enumerate().any(|(i, l)| {
                l.contains(&needle)
                    && (fixes(l)
                        || self.lines[i + 1..]
                            .iter()
                            .take(LOCK_REACH)
                            .take_while(|x| {
                                let x = x.trim();
                                !x.is_empty() && !x.starts_with('}')
                            })
                            .any(|x| fixes(x)))
            })
    }

    /// The lockfile records the commit a repository was resolved to.
    fn commit_of(&self, repo: &str) -> bool {
        self.fixes(repo, has_commit)
    }

    /// The lockfile records a digest for an archive's URL, in one of the ways a
    /// lockfile writes one (`sha512-...`, `sha256:...`, `checksum`).
    fn digest_of(&self, url: &str) -> bool {
        const DIGESTS: &[&str] = &[
            "sha1-",
            "sha256-",
            "sha384-",
            "sha512-",
            "sha1:",
            "sha256:",
            "sha384:",
            "sha512:",
            "checksum:",
            "checksum =",
        ];
        self.fixes(url, |l| DIGESTS.iter().any(|d| l.contains(d)))
    }
}

/// A run of forty or more hexadecimal digits that stands by itself: a full commit
/// or a digest.
fn has_commit(text: &str) -> bool {
    text.split(|c: char| !c.is_ascii_hexdigit())
        .any(|run| run.len() >= 40)
}

/// The whole of `reference` is a full commit.
fn full_commit(reference: &str) -> bool {
    reference.len() >= 40 && reference.chars().all(|c| c.is_ascii_hexdigit())
}

/// Where a dependency comes from, when it is not a version of a registry.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Source {
    /// A repository: the last two segments of its path (`someone/lib`), by which a
    /// lockfile names it, and the reference it is named by.
    Git {
        repo: String,
        reference: Option<String>,
        plain: bool,
    },
    /// An archive at a URL.
    Url { url: String, plain: bool },
}

/// The host of a URL is the machine itself.
fn local_host(url: &str) -> bool {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let host = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(v6),
        None => host.split(':').next().unwrap_or(host),
    };
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "0.0.0.0")
}

/// Fetched over plain HTTP from another machine.
fn plain_http(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.contains("+http://") || lower.starts_with("git://"))
        && !local_host(url)
}

/// The last two segments of a repository's path, lower-case, without `.git`
/// (`someone/lib` of `git+ssh://git@host:someone/lib.git#main`).
fn repo_path(url: &str) -> String {
    let rest = url.split(['#', '?']).next().unwrap_or(url);
    let rest = rest.split_once("://").map_or(rest, |(_, r)| r);
    // `git@host:someone/lib`: the colon stands for a slash.
    let rest = rest.replace(':', "/");
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut segs: Vec<&str> = rest.rsplit('/').take(2).collect();
    segs.reverse();
    segs.join("/").to_ascii_lowercase()
}

/// The source a `package.json` dependency is given by, where it is no version
/// range of a registry and no path of the repository.
fn node_source(spec: &str) -> Option<Source> {
    let spec = spec.trim();
    let lower = spec.to_ascii_lowercase();
    const LOCAL: &[&str] = &[
        "file:",
        "link:",
        "portal:",
        "workspace:",
        "catalog:",
        "npm:",
        "patch:",
        "jsr:",
        "exec:",
    ];
    if spec.is_empty() || LOCAL.iter().any(|p| lower.starts_with(p)) {
        return None;
    }
    let reference = |s: &str| {
        s.split_once('#')
            .map(|(_, r)| r.strip_prefix("commit=").unwrap_or(r).to_string())
            .filter(|r| !r.is_empty())
    };
    if lower.starts_with("git+")
        || lower.starts_with("git://")
        || lower.starts_with("git@")
        || lower.starts_with("ssh://")
    {
        return Some(Source::Git {
            repo: repo_path(spec),
            reference: reference(spec),
            plain: plain_http(spec),
        });
    }
    for host in ["github:", "gitlab:", "bitbucket:", "gist:"] {
        if let Some(rest) = lower.strip_prefix(host) {
            return Some(Source::Git {
                repo: repo_path(rest),
                reference: reference(spec),
                plain: false,
            });
        }
    }
    if lower.starts_with("http://") || lower.starts_with("https://") {
        // A repository's own address ends in `.git`; anything else is an archive.
        let path = spec.split(['#', '?']).next().unwrap_or(spec);
        return Some(match path.ends_with(".git") {
            true => Source::Git {
                repo: repo_path(spec),
                reference: reference(spec),
                plain: plain_http(spec),
            },
            false => Source::Url {
                url: spec.to_string(),
                plain: plain_http(spec),
            },
        });
    }
    // `someone/lib` and `someone/lib#main`: a repository on GitHub. A version
    // range, a tag and a path hold no single slash between two plain names.
    let (path, _) = spec.split_once('#').unwrap_or((spec, ""));
    let plain_name = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
            && !s.starts_with('.')
    };
    match path.split_once('/') {
        Some((owner, repo)) if plain_name(owner) && plain_name(repo) => Some(Source::Git {
            repo: repo_path(path),
            reference: reference(spec),
            plain: false,
        }),
        _ => None,
    }
}

/// The source a Python requirement is given by (PEP 508 `name @ url`, or the
/// URL itself), where it is no version of an index and no path of the repository:
/// the name, where one is written, and the source.
fn python_source(requirement: &str) -> Option<(String, Source)> {
    let requirement = requirement.split(';').next().unwrap_or(requirement).trim();
    let (name, url) = match requirement.split_once('@') {
        // `name @ url`; a URL's own `@` (`git+ssh://git@host/...`) follows `://`.
        Some((name, url)) if !name.contains("://") && !name.trim().is_empty() => {
            (name.trim().to_string(), url.trim())
        }
        _ => (String::new(), requirement),
    };
    let lower = url.to_ascii_lowercase();
    let vcs = ["git+", "hg+", "svn+", "bzr+"]
        .iter()
        .any(|p| lower.starts_with(p));
    if !vcs && !lower.starts_with("http://") && !lower.starts_with("https://") {
        return None;
    }
    let egg = url
        .split_once('#')
        .and_then(|(_, frag)| {
            frag.split('&')
                .find_map(|kv| kv.strip_prefix("egg=").map(str::to_string))
        })
        .unwrap_or_default();
    let name = match name.is_empty() {
        true => egg,
        false => name,
    };
    let bare = url.split('#').next().unwrap_or(url);
    if !vcs {
        return Some((
            name,
            Source::Url {
                url: bare.to_string(),
                plain: plain_http(url),
            },
        ));
    }
    // The reference follows the last `@` of the path, past the host.
    let after_scheme = bare.split_once("://").map_or(bare, |(_, r)| r);
    let (host, path) = after_scheme.split_once('/').unwrap_or((after_scheme, ""));
    let (path, reference) = match path.rsplit_once('@') {
        Some((p, r)) => (p, Some(r.to_string())),
        None => (path, None),
    };
    Some((
        name,
        Source::Git {
            repo: repo_path(&format!("{host}/{path}")),
            reference,
            plain: plain_http(url),
        },
    ))
}

/// The findings of one file as they are gathered.
struct Found<'a> {
    rel: &'a str,
    text: &'a str,
    lock: &'a Lock,
    out: Vec<DependencyFinding>,
}

impl Found<'_> {
    /// The 1-based line of the first line that holds `needle`; 1 where none.
    fn line_of(&self, needle: &str) -> u32 {
        let needle = needle.lines().next().unwrap_or(needle).trim();
        self.text
            .lines()
            .position(|l| !needle.is_empty() && l.contains(needle))
            .map_or(1, |i| i as u32 + 1)
    }

    fn push(&mut self, kind: &str, line: u32, name: &str, detail: &str) {
        self.out.push(DependencyFinding {
            kind: kind.to_string(),
            path: self.rel.to_string(),
            line,
            name: name.to_string(),
            detail: detail.trim().chars().take(200).collect(),
        });
    }

    /// One dependency with its source, as written (`detail`): what it is fetched
    /// over, then whether anything fixes what is fetched. `fixed` says the
    /// manifest itself fixes it (a digest on the line, a full commit in a key of
    /// its own).
    fn source(&mut self, name: &str, source: &Source, detail: &str, line: u32, fixed: bool) {
        match source {
            Source::Git {
                repo,
                reference,
                plain,
            } => {
                if *plain {
                    self.push("plain_http", line, name, detail);
                }
                let named = reference.as_deref().is_some_and(full_commit);
                if !fixed && !named && !self.lock.commit_of(repo) {
                    self.push("mutable_git", line, name, detail);
                }
            }
            Source::Url { url, plain } => {
                if *plain {
                    self.push("plain_http", line, name, detail);
                }
                if !fixed && !self.lock.digest_of(url) {
                    self.push("unpinned_url", line, name, detail);
                }
            }
        }
    }
}

/// The keys of a `package.json` that name what is installed.
const NODE_SECTIONS: &[&str] = &[
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "overrides",
    "resolutions",
];

fn package_json(f: &mut Found) {
    let Ok(doc) = serde_json::from_str::<Value>(f.text) else {
        return;
    };
    for section in NODE_SECTIONS {
        let Some(deps) = doc.get(section).and_then(Value::as_object) else {
            continue;
        };
        for (name, spec) in deps {
            let Some(spec) = spec.as_str() else {
                continue;
            };
            if let Some(source) = node_source(spec) {
                let line = f.line_of(&format!("\"{spec}\""));
                f.source(name, &source, spec, line, false);
            }
        }
    }
    let scripts = doc.get("scripts").and_then(Value::as_object);
    for script in INSTALL_SCRIPTS {
        if let Some(run) = scripts.and_then(|s| s.get(*script)).and_then(Value::as_str)
            && let Some(command) = crate::workflows::piped_download(run)
        {
            let line = f.line_of(&format!("\"{script}\""));
            f.push("piped_download", line, script, command);
        }
    }
}

/// `.npmrc` and `.yarnrc.yml`: a registry over plain HTTP, the certificate
/// check turned off.
fn node_config(f: &mut Found) {
    for (i, raw) in f.text.lines().enumerate() {
        let line = raw.trim();
        if line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        let Some((key, value)) = line.split_once(['=', ':']) else {
            continue;
        };
        // A scoped registry's key holds a colon of its own (`@scope:registry=`).
        let (key, value) = match line.split_once('=') {
            Some((k, v)) => (k, v),
            None => (key, value),
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim().trim_matches(['"', '\'']);
        let off = matches!(value, "false" | "0");
        let plain = key.contains("registry") && plain_http(value);
        let unchecked = (key == "strict-ssl" || key == "enablestrictssl") && off;
        if plain || unchecked {
            f.push("plain_http", i as u32 + 1, "", line);
        }
    }
}

/// A requirements file: each logical line (a `\` at the end joins the next).
fn requirements(f: &mut Found) {
    let mut logical: Vec<(u32, String)> = Vec::new();
    let mut open: Option<(u32, String)> = None;
    for (i, raw) in f.text.lines().enumerate() {
        // A comment starts the line or follows white space: a URL's `#egg=` does
        // neither.
        let mut line = raw;
        if let Some(at) = raw
            .char_indices()
            .find(|(at, c)| {
                *c == '#' && (*at == 0 || raw[..*at].ends_with(|p: char| p.is_whitespace()))
            })
            .map(|(at, _)| at)
        {
            line = &raw[..at];
        }
        let line = line.trim();
        let (body, more) = match line.strip_suffix('\\') {
            Some(b) => (b.trim(), true),
            None => (line, false),
        };
        let (start, mut text) = open.take().unwrap_or((i as u32 + 1, String::new()));
        if !text.is_empty() {
            text.push(' ');
        }
        text.push_str(body);
        match more {
            true => open = Some((start, text)),
            false if !text.is_empty() => logical.push((start, text)),
            false => {}
        }
    }
    logical.extend(open);
    for (line, text) in logical {
        let hashed = text.contains("--hash=") || text.contains("--hash ");
        let words: Vec<&str> = text.split_whitespace().collect();
        let option = |names: &[&str]| -> Option<String> {
            words.iter().enumerate().find_map(|(i, w)| {
                names.iter().find_map(|n| {
                    if w == n {
                        words.get(i + 1).map(|v| v.to_string())
                    } else {
                        w.strip_prefix(&format!("{n}=")).map(str::to_string)
                    }
                })
            })
        };
        if let Some(index) = option(&["--extra-index-url"]) {
            f.push("second_index", line, "", &text);
            if plain_http(&index) {
                f.push("plain_http", line, "", &text);
            }
            continue;
        }
        if let Some(index) = option(&["--index-url", "-i", "--find-links", "-f"]) {
            if plain_http(&index) {
                f.push("plain_http", line, "", &text);
            }
            continue;
        }
        if option(&["--trusted-host"]).is_some() {
            f.push("plain_http", line, "", &text);
            continue;
        }
        // The requirement itself: past `-e`, up to the first option.
        let requirement: Vec<&str> = words
            .iter()
            .copied()
            .skip_while(|w| matches!(*w, "-e" | "--editable"))
            .take_while(|w| !w.starts_with("--"))
            .collect();
        let requirement = requirement.join(" ");
        if let Some((name, source)) = python_source(&requirement) {
            f.source(&name, &source, &requirement, line, hashed);
        }
    }
}

/// A table of a TOML manifest that names what is installed (Poetry's, uv's,
/// Pipenv's, Cargo's): each entry that is a table with a `git` or a `url`.
fn toml_table(f: &mut Found, table: &toml::Table) {
    for (name, spec) in table {
        let Some(spec) = spec.as_table() else {
            continue;
        };
        let text = |key: &str| spec.get(key).and_then(toml::Value::as_str);
        if let Some(git) = text("git") {
            // The reference is a key of its own; a full commit there fixes it.
            let reference = ["rev", "ref", "commit"]
                .iter()
                .find_map(|k| text(k))
                .map(str::to_string);
            let fixed = reference.as_deref().is_some_and(full_commit);
            let source = Source::Git {
                repo: repo_path(git),
                reference,
                plain: plain_http(git),
            };
            let line = f.line_of(git);
            f.source(name, &source, git, line, fixed);
        } else if let Some(url) = text("url") {
            let source = Source::Url {
                url: url.to_string(),
                plain: plain_http(url),
            };
            let line = f.line_of(url);
            f.source(name, &source, url, line, false);
        }
    }
}

/// The tables of `doc` reached by `path`, a `*` standing for every key.
fn tables<'a>(doc: &'a toml::Table, path: &[&str]) -> Vec<&'a toml::Table> {
    let Some((first, rest)) = path.split_first() else {
        return vec![doc];
    };
    match *first {
        "*" => doc
            .values()
            .filter_map(toml::Value::as_table)
            .flat_map(|t| tables(t, rest))
            .collect(),
        key => doc
            .get(key)
            .and_then(toml::Value::as_table)
            .map(|t| tables(t, rest))
            .unwrap_or_default(),
    }
}

/// The PEP 508 strings of a list.
fn requirement_strings(f: &mut Found, list: Option<&toml::Value>) {
    for requirement in list
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(toml::Value::as_str)
    {
        if let Some((name, source)) = python_source(requirement) {
            let line = f.line_of(requirement);
            f.source(&name, &source, requirement, line, false);
        }
    }
}

fn pyproject(f: &mut Found) {
    let Ok(doc) = f.text.parse::<toml::Table>() else {
        return;
    };
    for t in tables(&doc, &["project"]) {
        requirement_strings(f, t.get("dependencies"));
    }
    for path in [
        &["project", "optional-dependencies"][..],
        &["dependency-groups"][..],
    ] {
        for t in tables(&doc, path) {
            for list in t.values() {
                requirement_strings(f, Some(list));
            }
        }
    }
    for t in tables(&doc, &["build-system"]) {
        requirement_strings(f, t.get("requires"));
    }
    for path in [
        &["tool", "poetry", "dependencies"][..],
        &["tool", "poetry", "dev-dependencies"][..],
        &["tool", "poetry", "group", "*", "dependencies"][..],
        &["tool", "uv", "sources"][..],
        &["tool", "pdm", "dev-dependencies"][..],
    ] {
        for t in tables(&doc, path) {
            toml_table(f, t);
        }
    }
}

fn pipfile(f: &mut Found) {
    let Ok(doc) = f.text.parse::<toml::Table>() else {
        return;
    };
    for section in ["packages", "dev-packages"] {
        for t in tables(&doc, &[section]) {
            toml_table(f, t);
        }
    }
    for source in doc
        .get("source")
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(toml::Value::as_table)
    {
        let url = source.get("url").and_then(toml::Value::as_str);
        let unchecked = source.get("verify_ssl").and_then(toml::Value::as_bool) == Some(false);
        if let Some(url) = url
            && (plain_http(url) || (unchecked && !local_host(url)))
        {
            let line = f.line_of(url);
            f.push("plain_http", line, "", url);
        }
    }
}

fn cargo(f: &mut Found) {
    let Ok(doc) = f.text.parse::<toml::Table>() else {
        return;
    };
    const SECTIONS: &[&str] = &["dependencies", "dev-dependencies", "build-dependencies"];
    for section in SECTIONS {
        for path in [
            &[*section][..],
            &["workspace", *section][..],
            &["target", "*", *section][..],
        ] {
            for t in tables(&doc, path) {
                toml_table(f, t);
            }
        }
    }
    for t in tables(&doc, &["patch", "*"]) {
        toml_table(f, t);
    }
}

/// A Dockerfile: each instruction (a `\` at the end joins the next line).
fn dockerfile(f: &mut Found) {
    let mut open: Option<(u32, String)> = None;
    let mut instructions: Vec<(u32, String)> = Vec::new();
    for (i, raw) in f.text.lines().enumerate() {
        let line = raw.trim();
        if line.starts_with('#') {
            continue;
        }
        let (body, more) = match line.strip_suffix('\\') {
            Some(b) => (b.trim_end(), true),
            None => (line, false),
        };
        let (start, mut text) = open.take().unwrap_or((i as u32 + 1, String::new()));
        if !text.is_empty() {
            text.push(' ');
        }
        text.push_str(body);
        match more {
            true => open = Some((start, text)),
            false if !text.trim().is_empty() => instructions.push((start, text)),
            false => {}
        }
    }
    instructions.extend(open);
    for (line, text) in instructions {
        let (word, rest) = text
            .trim()
            .split_once(char::is_whitespace)
            .unwrap_or((text.trim(), ""));
        match word.to_ascii_uppercase().as_str() {
            "RUN" => {
                // Each command of the instruction, as a shell reads them.
                for command in rest.split("&&").flat_map(|c| c.split(';')) {
                    if let Some(found) = crate::workflows::piped_download(command) {
                        f.push("piped_download", line, "", found);
                    }
                    // A repository an installer is handed in the command itself
                    // (`pip install git+https://host/someone/lib@main`): no
                    // lockfile stands for a command.
                    for word in command.split_whitespace() {
                        let word = word.trim_matches(['"', '\'']);
                        if word.to_ascii_lowercase().starts_with("git+")
                            && let Some((
                                name,
                                Source::Git {
                                    reference, plain, ..
                                },
                            )) = python_source(word)
                        {
                            if plain {
                                f.push("plain_http", line, &name, word);
                            }
                            if !reference.as_deref().is_some_and(full_commit) {
                                f.push("mutable_git", line, &name, word);
                            }
                        }
                    }
                }
            }
            "ADD" => {
                let checked = rest.contains("--checksum=");
                for url in rest.split_whitespace().filter(|w| {
                    let w = w.to_ascii_lowercase();
                    w.starts_with("http://") || w.starts_with("https://")
                }) {
                    // A repository's own address is cloned, not downloaded: what
                    // is cloned is its default branch.
                    let bare = url.split('#').next().unwrap_or(url);
                    if plain_http(url) {
                        f.push("plain_http", line, "", url);
                    }
                    if bare.ends_with(".git") {
                        if !url
                            .split_once('#')
                            .is_some_and(|(_, r)| full_commit(r.split(':').next().unwrap_or(r)))
                        {
                            f.push("mutable_git", line, "", url);
                        }
                    } else if !checked {
                        f.push("unpinned_url", line, "", url);
                    }
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kind and name of each finding, in that order (the findings themselves are
    /// in the order of the file's lines).
    fn kinds(rel: &str, text: &str, lock: &str) -> Vec<(String, String)> {
        let mut found: Vec<(String, String)> = read_text(rel, text, lock)
            .into_iter()
            .map(|f| (f.kind, f.name))
            .collect();
        found.sort();
        found
    }

    fn pair(kind: &str, name: &str) -> (String, String) {
        (kind.to_string(), name.to_string())
    }

    #[test]
    fn a_repository_by_a_branch_or_nothing_is_found_and_one_by_a_full_commit_is_not() {
        let text = r#"{
  "dependencies": {
    "ranged": "^1.2.3",
    "aliased": "npm:@scope/other@^2",
    "local": "file:../local",
    "shared": "workspace:*",
    "moving": "github:someone/moving#main",
    "bare": "someone/bare",
    "tagged": "git+https://example.com/someone/tagged.git#v1.0.0",
    "fixed": "git+ssh://git@example.com:someone/fixed.git#0123456789abcdef0123456789abcdef01234567"
  }
}"#;
        assert_eq!(
            kinds("package.json", text, ""),
            vec![
                pair("mutable_git", "bare"),
                pair("mutable_git", "moving"),
                pair("mutable_git", "tagged"),
            ]
        );
    }

    #[test]
    fn a_lockfile_that_records_the_commit_fixes_a_repository() {
        let text = r#"{ "dependencies": { "moving": "github:someone/moving#main", "other": "someone/other" } }"#;
        // npm's, Yarn's and Bundler's ways of writing the same thing.
        for lock in [
            r#""node_modules/moving": { "resolved": "git+ssh://git@github.com/Someone/moving.git#0123456789abcdef0123456789abcdef01234567" }"#,
            "moving@github:someone/moving#main:\n  version \"1.0.0\"\n  resolved \"https://codeload.github.com/someone/moving/tar.gz/0123456789abcdef0123456789abcdef01234567\"",
            "GIT\n  remote: https://github.com/someone/moving\n  revision: 0123456789abcdef0123456789abcdef01234567\n  branch: main",
        ] {
            assert_eq!(
                kinds("package.json", text, lock),
                vec![pair("mutable_git", "other")],
                "{lock}"
            );
        }
    }

    #[test]
    fn an_archive_at_a_url_is_found_unless_a_lockfile_records_its_digest() {
        let text = r#"{ "dependencies": { "packed": "https://example.com/packed-1.0.0.tgz", "plain": "http://example.com/plain.tgz" } }"#;
        assert_eq!(
            kinds("package.json", text, ""),
            vec![
                pair("plain_http", "plain"),
                pair("unpinned_url", "packed"),
                pair("unpinned_url", "plain"),
            ]
        );
        let lock = "\"resolved\": \"https://example.com/packed-1.0.0.tgz\",\n\"integrity\": \"sha512-abc\"";
        assert_eq!(
            kinds("package.json", text, lock),
            vec![pair("plain_http", "plain"), pair("unpinned_url", "plain")]
        );
    }

    #[test]
    fn what_the_next_entry_of_a_lockfile_records_fixes_nothing_of_this_one() {
        let text = r#"{ "dependencies": { "packed": "https://example.com/packed.tgz", "moving": "someone/moving" } }"#;
        let lock = "packed@https://example.com/packed.tgz:\n  version \"1.0.0\"\n  resolved \"https://example.com/packed.tgz\"\n\nother@^1.0.0:\n  version \"1.0.0\"\n  integrity sha512-abc\n\n\"moving@someone/moving\":\n  version \"1.0.0\"\n\nthird@github:else/third:\n  resolved \"https://codeload.github.com/else/third/tar.gz/0123456789abcdef0123456789abcdef01234567\"\n";
        assert_eq!(
            kinds("package.json", text, lock),
            vec![
                pair("mutable_git", "moving"),
                pair("unpinned_url", "packed")
            ]
        );
    }

    #[test]
    fn an_install_script_that_pipes_a_download_is_found() {
        let text = r#"{ "scripts": { "postinstall": "curl -fsSL https://example.com/setup.sh | sh", "test": "curl https://example.com | sh" } }"#;
        assert_eq!(
            kinds("package.json", text, ""),
            vec![pair("piped_download", "postinstall")]
        );
    }

    #[test]
    fn a_registry_over_plain_http_or_with_the_check_off_is_found() {
        let text = "registry=http://registry.example.com/\n@scope:registry=https://npm.example.com/\nstrict-ssl=false\n# registry=http://commented.example.com\n";
        let found = read_text(".npmrc", text, "");
        assert_eq!(
            found
                .iter()
                .map(|f| (f.kind.as_str(), f.line))
                .collect::<Vec<_>>(),
            vec![("plain_http", 1), ("plain_http", 3)]
        );
        // A registry on the machine itself is no one else's path.
        assert!(read_text(".npmrc", "registry=http://localhost:4873/\n", "").is_empty());
        assert_eq!(
            kinds(
                ".yarnrc.yml",
                "npmRegistryServer: \"http://registry.example.com\"\nenableStrictSsl: false\n",
                ""
            ),
            vec![pair("plain_http", ""), pair("plain_http", "")]
        );
    }

    #[test]
    fn a_requirements_file_is_read_line_by_line() {
        let text = "\
# pinned by version: an index's
requests==2.32.0
--extra-index-url https://pypi.example.com/simple
--index-url http://pypi.example.com/simple
--trusted-host pypi.example.com
-e git+https://example.com/someone/moving.git@main#egg=moving
fixed @ git+https://example.com/someone/fixed.git@0123456789abcdef0123456789abcdef01234567
wheel @ https://example.com/wheel-1.0-py3-none-any.whl
hashed @ https://example.com/hashed-1.0.tar.gz \\
    --hash=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
./local
";
        let found = read_text("requirements/prod.txt", text, "");
        assert_eq!(
            found
                .iter()
                .map(|f| (f.kind.as_str(), f.name.as_str(), f.line))
                .collect::<Vec<_>>(),
            vec![
                ("mutable_git", "moving", 6),
                ("plain_http", "", 4),
                ("plain_http", "", 5),
                ("second_index", "", 3),
                ("unpinned_url", "wheel", 8),
            ]
        );
    }

    #[test]
    fn a_pyproject_is_read_in_its_three_dialects() {
        let text = r#"
[project]
dependencies = ["requests>=2", "moving @ git+https://example.com/someone/moving.git@main"]

[project.optional-dependencies]
extra = ["packed @ https://example.com/packed-1.0.tar.gz"]

[tool.poetry.dependencies]
python = "^3.12"
branch = { git = "https://example.com/someone/branch.git", branch = "main" }
pinned = { git = "https://example.com/someone/pinned.git", rev = "0123456789abcdef0123456789abcdef01234567" }
here = { path = "../here" }

[tool.uv.sources]
sourced = { git = "https://example.com/someone/sourced", tag = "v1" }
"#;
        assert_eq!(
            kinds("pyproject.toml", text, ""),
            vec![
                pair("mutable_git", "branch"),
                pair("mutable_git", "moving"),
                pair("mutable_git", "sourced"),
                pair("unpinned_url", "packed"),
            ]
        );
        // Poetry's and uv's lockfiles record what each was resolved to.
        let lock = "url = \"https://example.com/someone/branch.git\"\nreference = \"main\"\nresolved_reference = \"0123456789abcdef0123456789abcdef01234567\"\nsource = { git = \"https://example.com/someone/sourced?tag=v1#0123456789abcdef0123456789abcdef01234567\" }\n";
        assert_eq!(
            kinds("pyproject.toml", text, lock),
            vec![
                pair("mutable_git", "moving"),
                pair("unpinned_url", "packed")
            ]
        );
    }

    #[test]
    fn a_cargo_manifest_is_read_with_its_lockfile() {
        let text = r#"
[dependencies]
serde = "1"
moving = { git = "https://example.com/someone/moving" }
pinned = { git = "https://example.com/someone/pinned", rev = "0123456789abcdef0123456789abcdef01234567" }
here = { path = "../here" }

[workspace.dependencies]
shared = { git = "https://example.com/someone/shared", branch = "main" }
"#;
        assert_eq!(
            kinds("Cargo.toml", text, ""),
            vec![pair("mutable_git", "moving"), pair("mutable_git", "shared")]
        );
        let lock = "source = \"git+https://example.com/someone/moving#0123456789abcdef0123456789abcdef01234567\"\n";
        assert_eq!(
            kinds("crates/x/Cargo.toml", text, lock),
            vec![pair("mutable_git", "shared")]
        );
    }

    #[test]
    fn a_dockerfile_that_downloads_what_nothing_fixes_is_found() {
        let text = "\
FROM node:22
# RUN curl https://commented.example.com | sh
RUN apt-get update && \\
    curl -fsSL https://example.com/install.sh | bash
ADD https://example.com/tool /usr/local/bin/tool
ADD --checksum=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef https://example.com/checked /usr/local/bin/checked
ADD http://example.com/plain.tar.gz /opt/
ADD https://example.com/someone/repo.git /src
COPY . /app
RUN curl -fsSL https://example.com/file.tar.gz -o /tmp/file.tar.gz
RUN pip install git+https://example.com/someone/moving.git@main requests==2.32.0
RUN pip install git+https://example.com/someone/fixed.git@0123456789abcdef0123456789abcdef01234567
";
        let found = read_text("docker/Dockerfile.web", text, "");
        assert_eq!(
            found
                .iter()
                .map(|f| (f.kind.as_str(), f.line))
                .collect::<Vec<_>>(),
            vec![
                ("mutable_git", 8),
                ("mutable_git", 11),
                ("piped_download", 3),
                ("plain_http", 7),
                ("unpinned_url", 5),
                ("unpinned_url", 7),
            ]
        );
    }

    #[test]
    fn a_file_that_is_no_manifest_or_does_not_parse_says_nothing() {
        assert!(read_text("notes.txt", "git+https://example.com/x/y", "").is_empty());
        assert!(read_text("package.json", "{ not json", "").is_empty());
        assert!(read_text("pyproject.toml", "[project", "").is_empty());
    }
}
