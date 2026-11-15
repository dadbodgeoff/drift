//! File-convention routers other than Next.js: React Router and Remix route
//! modules, SvelteKit endpoints and server pages, and Nuxt (Nitro) server routes.
//! Execution facts only: which exports serve requests, and under which path. It
//! never produces conventions.
//!
//! The last measured build listed none of these, so they are in the listed reading
//! only ([`drift_core::Listed`]): the lowering marks a file that may hold one
//! ([`candidate`]), and linking lists its entry points where the file's package is
//! built with the framework ([`framework_of`]).
//!
//! What runs before a SvelteKit or Nitro route is not read: SvelteKit's
//! `hooks.server` `handle`, a Nitro server middleware or route rule. So each is
//! listed with what its mount adds unread ([`drift_core::MountFacts::opaque`]): a
//! guard found in its own body is listed, and where none is found its guard is
//! unknown, never "no guard found".
//!
//! Nothing runs before a React Router or Remix `loader` or `action` but what the
//! package itself puts there: a parent route's loader runs beside it, not before
//! it, and answers nothing in its place. So its own body decides, and a handler
//! that checks nothing has no guard, unless the package has a server of its own
//! (a router some file of it binds: its middleware runs first) or a route module
//! exports a middleware ([`exports_middleware`]); then what the mount adds is
//! unread, as above.

use drift_core::{EntryPoint, FileFacts};

const HTTP_METHODS: &[&str] = &["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/// The file-convention router a package is built with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framework {
    /// React Router 7 in framework mode, and Remix.
    ReactRouter,
    SvelteKit,
    /// Nuxt, or Nitro on its own.
    Nitro,
}

impl Framework {
    fn adapter(self) -> &'static str {
        match self {
            Framework::ReactRouter => "react-router",
            Framework::SvelteKit => "sveltekit",
            Framework::Nitro => "nitro",
        }
    }
}

/// The framework a manifest's dependencies name, if one of these.
fn framework_in(json: &serde_json::Value) -> Option<Framework> {
    let mut found = None;
    for k in ["dependencies", "devDependencies", "peerDependencies"] {
        let Some(deps) = json.get(k).and_then(|d| d.as_object()) else {
            continue;
        };
        for name in deps.keys() {
            let f = match name.as_str() {
                "@sveltejs/kit" => Framework::SvelteKit,
                "nuxt" | "nitropack" | "nitro" => Framework::Nitro,
                n if n.starts_with("@remix-run/") || n.starts_with("@react-router/") => {
                    Framework::ReactRouter
                }
                _ => continue,
            };
            // Two of them in one manifest: which serves a file is not read.
            if found.is_some_and(|x| x != f) {
                return None;
            }
            found = Some(f);
        }
    }
    found
}

/// The file-convention router the package at `package` (repo-relative directory,
/// `""` for the root) is built with: by its own `package.json`, or the nearest one
/// above it that names one.
pub fn framework_of(root: &std::path::Path, package: &str) -> Option<Framework> {
    let mut dir = if package.is_empty() {
        root.to_path_buf()
    } else {
        root.join(package)
    };
    loop {
        // A planted FIFO or device in place of a manifest is no manifest.
        if let Ok(text) = drift_core::fsutil::read_regular_to_string(
            &dir.join("package.json"),
            drift_core::fsutil::MAX_CONFIG_BYTES,
        ) && let Ok(json) = serde_json::from_str::<serde_json::Value>(&text)
            && let Some(f) = framework_in(&json)
        {
            return Some(f);
        }
        if dir == root || !dir.pop() || !dir.starts_with(root) {
            return None;
        }
    }
}

fn stem_of(file: &str) -> &str {
    file.rfind('.').map_or(file, |i| &file[..i])
}

/// A file that may hold an entry point of one of these routers, by its path and
/// the names it exports: asked by the lowering, which does not know the package.
pub fn candidate(path: &str, exports: &[&str]) -> bool {
    let file = path.rsplit('/').next().unwrap_or(path);
    let has = |n: &str| exports.contains(&n);
    let under = |dir: &str| path.starts_with(dir) || path.contains(&format!("/{dir}"));
    file.starts_with("+server.")
        || file.starts_with("+page.server.")
        || file.starts_with("+layout.server.")
        || ((under("routes/") || stem_of(file) == "root") && (has("loader") || has("action")))
        || ((under("server/api/") || under("server/routes/")) && has("default"))
}

/// A path template from the segments of a file-convention route: `[id]` and `$id`
/// are parameters, `[...rest]` and `$` take the rest, `(group)` and a segment that
/// starts with `_` name no path.
fn template(segments: &[&str]) -> String {
    let mut out: Vec<String> = Vec::new();
    for s in segments {
        let s = s.trim_end_matches('+');
        if s.is_empty()
            || (s.starts_with('(') && s.ends_with(')') && !s.starts_with("($"))
            || s.starts_with('_')
            || matches!(s, "index" | "route")
        {
            continue;
        }
        let s = s.trim_end_matches('_');
        out.push(
            if let Some(rest) = s.strip_prefix("[...").and_then(|x| x.strip_suffix(']')) {
                let _ = rest;
                "*".to_string()
            } else if let Some(name) = s.strip_prefix("[[").and_then(|x| x.strip_suffix("]]")) {
                format!(":{name}?")
            } else if let Some(name) = s.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
                format!(":{name}")
            } else if let Some(name) = s.strip_prefix("($").and_then(|x| x.strip_suffix(')')) {
                format!(":{name}?")
            } else if s == "$" {
                "*".to_string()
            } else if let Some(name) = s.strip_prefix('$') {
                format!(":{name}")
            } else {
                s.to_string()
            },
        );
    }
    format!("/{}", out.join("/"))
}

/// The names a route module exports its middleware under (React Router 7).
pub fn exports_middleware(exports: &[&str]) -> bool {
    exports
        .iter()
        .any(|e| matches!(*e, "middleware" | "unstable_middleware"))
}

fn exports_named(facts: &FileFacts, name: &str) -> bool {
    facts.exports.iter().any(|e| e.name == name)
}

/// Entry points for one file of a package built with `framework`, derived from its
/// path and exports.
pub fn entry_points(facts: &FileFacts, framework: Framework) -> Vec<EntryPoint> {
    let mut out = Vec::new();
    let segs: Vec<&str> = facts.path.split('/').collect();
    let Some((file, dirs)) = segs.split_last() else {
        return out;
    };
    let mut entry = |symbol: &str, method: &str, route: String| {
        out.push(EntryPoint {
            symbol: symbol.to_string(),
            kind: "http".to_string(),
            method: Some(method.to_string()),
            route: Some(route),
            adapter: framework.adapter().to_string(),
        });
    };
    match framework {
        Framework::ReactRouter => {
            // `app/routes/users.$id.tsx`, `app/routes/_auth/login.tsx`,
            // `app/routes/users+/$id.tsx`, and the root route.
            let route = match dirs.iter().rposition(|d| *d == "routes") {
                Some(at) => {
                    let mut parts: Vec<&str> = dirs[at + 1..].to_vec();
                    parts.extend(stem_of(file).split('.'));
                    template(&parts)
                }
                None if stem_of(file) == "root" => "/".to_string(),
                None => return out,
            };
            for (export, method) in [("loader", "GET"), ("action", "POST")] {
                if exports_named(facts, export) {
                    entry(export, method, route.clone());
                }
            }
        }
        Framework::SvelteKit => {
            let Some(at) = dirs.iter().rposition(|d| *d == "routes") else {
                return out;
            };
            let route = template(&dirs[at + 1..]);
            if file.starts_with("+server.") {
                for m in HTTP_METHODS {
                    if exports_named(facts, m) {
                        entry(m, m, route.clone());
                    }
                }
            } else if file.starts_with("+page.server.") || file.starts_with("+layout.server.") {
                for (export, method) in [("load", "GET"), ("actions", "POST")] {
                    if exports_named(facts, export) {
                        entry(export, method, route.clone());
                    }
                }
            }
        }
        Framework::Nitro => {
            // `server/api/users/[id].get.ts` -> GET /api/users/:id;
            // `server/routes/health.ts` -> ANY /health.
            let Some(at) = dirs.iter().position(|d| *d == "server") else {
                return out;
            };
            let base = match dirs.get(at + 1) {
                Some(&"api") => vec!["api"],
                Some(&"routes") => vec![],
                _ => return out,
            };
            if !exports_named(facts, "default") {
                return out;
            }
            let stem = stem_of(file);
            let (name, method) = match stem.rsplit_once('.') {
                Some((name, m)) if HTTP_METHODS.contains(&m.to_ascii_uppercase().as_str()) => {
                    (name, m.to_ascii_uppercase())
                }
                _ => (stem, "ANY".to_string()),
            };
            let mut parts = base;
            parts.extend(&dirs[at + 2..]);
            parts.push(name);
            entry("default", &method, template(&parts));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::{Export, ExportKind};

    fn facts(path: &str, exports: &[&str]) -> FileFacts {
        FileFacts {
            path: path.into(),
            exports: exports
                .iter()
                .map(|n| Export {
                    name: (*n).into(),
                    origin: format!("{path}#{n}"),
                    kind: ExportKind::Local,
                })
                .collect(),
            ..FileFacts::default()
        }
    }

    fn listed(path: &str, exports: &[&str], f: Framework) -> Vec<String> {
        entry_points(&facts(path, exports), f)
            .into_iter()
            .map(|e| {
                format!(
                    "{} {} {}",
                    e.symbol,
                    e.method.unwrap_or_default(),
                    e.route.unwrap_or_default()
                )
            })
            .collect()
    }

    #[test]
    fn react_router_route_modules() {
        use Framework::ReactRouter as R;
        assert_eq!(
            listed(
                "app/routes/users.$id.tsx",
                &["loader", "action", "default"],
                R
            ),
            ["loader GET /users/:id", "action POST /users/:id"]
        );
        assert_eq!(
            listed("app/routes/_auth/login.tsx", &["action"], R),
            ["action POST /login"]
        );
        assert_eq!(
            listed("app/routes/settings+/profile.index.tsx", &["loader"], R),
            ["loader GET /settings/profile"]
        );
        assert_eq!(listed("app/root.tsx", &["loader"], R), ["loader GET /"]);
        assert_eq!(
            listed("app/routes/files.$.tsx", &["loader"], R),
            ["loader GET /files/*"]
        );
        assert!(listed("app/utils/auth.server.ts", &["loader"], R).is_empty());
        assert!(listed("app/routes/about.tsx", &["default"], R).is_empty());
    }

    #[test]
    fn sveltekit_endpoints_and_server_pages() {
        use Framework::SvelteKit as S;
        assert_eq!(
            listed(
                "src/routes/api/items/[id]/+server.ts",
                &["GET", "DELETE"],
                S
            ),
            ["GET GET /api/items/:id", "DELETE DELETE /api/items/:id"]
        );
        assert_eq!(
            listed(
                "src/routes/(app)/settings/+page.server.ts",
                &["load", "actions"],
                S
            ),
            ["load GET /settings", "actions POST /settings"]
        );
        assert!(listed("src/routes/+page.ts", &["load"], S).is_empty());
    }

    #[test]
    fn nitro_server_routes() {
        use Framework::Nitro as N;
        assert_eq!(
            listed("server/api/users/[id].get.ts", &["default"], N),
            ["default GET /api/users/:id"]
        );
        assert_eq!(
            listed("apps/web/server/routes/health.ts", &["default"], N),
            ["default ANY /health"]
        );
        assert!(listed("server/utils/db.ts", &["default"], N).is_empty());
    }

    #[test]
    fn candidates_by_path_and_exports() {
        assert!(candidate("app/routes/users.$id.tsx", &["loader"]));
        assert!(candidate("src/routes/x/+server.ts", &["GET"]));
        assert!(candidate("server/api/x.ts", &["default"]));
        assert!(!candidate("src/routes/users.ts", &["router"]));
        assert!(!candidate("lib/loader.ts", &["loader"]));
    }
}
