//! File-convention routers other than Next.js: React Router and Remix route
//! modules, SvelteKit endpoints and server pages, Nuxt (Nitro) server routes and
//! Astro endpoints.
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
//!
//! An Astro endpoint (`src/pages/**/*.ts` exporting `GET`, `POST`, ... or `ALL`) runs
//! after the package's middleware only (`onRequest` of `src/middleware.ts`, or of
//! `src/middleware/index.ts`): where there is one, it is what runs before every
//! endpoint, read as any middleware is ([`astro_middleware`]); where there is
//! none, the endpoint's own body decides.

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
    /// Astro's endpoints.
    Astro,
}

impl Framework {
    fn adapter(self) -> &'static str {
        match self {
            Framework::ReactRouter => "react-router",
            Framework::SvelteKit => "sveltekit",
            Framework::Nitro => "nitro",
            Framework::Astro => "astro",
        }
    }
}

/// A package of React Router's framework mode or of Remix: the framework itself,
/// its build and its server adapters.
fn react_router_package(name: &str) -> bool {
    name.starts_with("@remix-run/") || name.starts_with("@react-router/")
}

impl Framework {
    /// Whether a call of the package `spec` hands back the framework's own request
    /// handler, which serves the routes its files declare: a package of the
    /// framework, for one whose server is an application's own
    /// (`createRequestHandler` of `@react-router/express`).
    pub fn hands_requests(self, spec: &str) -> bool {
        match self {
            Framework::ReactRouter => react_router_package(spec),
            Framework::SvelteKit | Framework::Nitro | Framework::Astro => false,
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
                "astro" => Framework::Astro,
                n if react_router_package(n) => Framework::ReactRouter,
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
        || (under("src/pages/")
            && astro_endpoint_file(file)
            && (HTTP_METHODS.iter().any(|m| has(m)) || has("ALL")))
        || astro_middleware(path, exports)
}

/// A file Astro's server can load as a module: not a page or a component, which
/// the reader does not parse.
fn script(file: &str) -> bool {
    [".ts", ".js", ".mts", ".mjs"]
        .iter()
        .any(|ext| file.ends_with(ext))
}

/// A file Astro routes as an endpoint: `.js` or `.ts` only (`validEndpointExtensions`
/// of `dist/core/routing/create-manifest.js`, `astro` 7.4.12); a `.mjs` or `.mts`
/// file under `src/pages` is no route.
fn astro_endpoint_file(file: &str) -> bool {
    file.ends_with(".ts") || file.ends_with(".js")
}

/// The path of an Astro endpoint from the directories under `src/pages` and the
/// file's name without its extension, as Astro's route manifest builds it: a file or
/// directory whose name starts with `_` (or with `.`, but `.well-known`) is no route
/// at all; `index` names its directory; `[x]` is a parameter and `[...x]` the rest,
/// also within a segment (`[id].json`). Nothing else is special: no route groups,
/// no pathless segments.
fn astro_route(parts: &[&str]) -> Option<String> {
    let mut out: Vec<String> = Vec::new();
    let last = parts.len().saturating_sub(1);
    for (i, s) in parts.iter().enumerate() {
        if s.starts_with('_') || (s.starts_with('.') && *s != ".well-known") {
            return None;
        }
        if i == last && *s == "index" {
            continue;
        }
        let mut seg = String::new();
        let mut rest = *s;
        while let Some(open) = rest.find('[') {
            let Some(close) = rest[open..].find(']') else {
                break;
            };
            seg.push_str(&rest[..open]);
            let inner = &rest[open + 1..open + close];
            if inner.starts_with("...") {
                seg.push('*');
            } else {
                seg.push(':');
                seg.push_str(inner);
            }
            rest = &rest[open + close + 1..];
        }
        seg.push_str(rest);
        out.push(seg);
    }
    Some(format!("/{}", out.join("/")))
}

/// An Astro middleware: `onRequest` exported by `src/middleware.ts` or
/// `src/middleware/index.ts` (any script extension).
pub fn astro_middleware(path: &str, exports: &[&str]) -> bool {
    let file = path.rsplit('/').next().unwrap_or(path);
    let dir = &path[..path.len() - file.len()];
    let at = |d: &str| dir == d || dir.ends_with(&format!("/{d}"));
    script(file)
        && exports.contains(&"onRequest")
        && ((stem_of(file) == "middleware" && at("src/"))
            || (stem_of(file) == "index" && at("src/middleware/")))
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
        Framework::Astro => {
            // `src/pages/api/users/[id].ts` -> /api/users/:id; `src/pages/index.ts`
            // -> /; `src/pages/feed.xml.ts` -> /feed.xml.
            let Some(at) = dirs.windows(2).rposition(|w| w == ["src", "pages"]) else {
                return out;
            };
            if !astro_endpoint_file(file) {
                return out;
            }
            let mut parts: Vec<&str> = dirs[at + 2..].to_vec();
            parts.push(stem_of(file));
            let Some(route) = astro_route(&parts) else {
                return out;
            };
            for m in HTTP_METHODS.iter().chain(&["ALL"]) {
                if exports_named(facts, m) {
                    entry(m, m, route.clone());
                }
            }
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
    fn astro_endpoints() {
        use Framework::Astro as A;
        assert_eq!(
            listed(
                "src/pages/api/users/[id].ts",
                &["GET", "DELETE", "prerender"],
                A
            ),
            ["GET GET /api/users/:id", "DELETE DELETE /api/users/:id"]
        );
        assert_eq!(listed("src/pages/index.ts", &["ALL"], A), ["ALL ALL /"]);
        assert_eq!(
            listed("apps/web/src/pages/files/[...path].js", &["GET"], A),
            ["GET GET /files/*"]
        );
        assert_eq!(
            listed("src/pages/feed.xml.ts", &["GET"], A),
            ["GET GET /feed.xml"]
        );
        assert!(listed("src/lib/api.ts", &["GET"], A).is_empty());
        // As Astro's route manifest builds them (`astro` 7.4.12): a name that starts
        // with `_` is no route, nor is a `.mjs` or `.mts` file; `route`, `(x)`
        // and a trailing `_` are plain segments, and `[id]` is a parameter within
        // a segment too.
        assert!(listed("src/pages/api/_helpers.ts", &["GET"], A).is_empty());
        assert!(listed("src/pages/_lib/users.ts", &["GET"], A).is_empty());
        assert!(listed("src/pages/api/x.mjs", &["GET"], A).is_empty());
        assert!(!candidate("src/pages/api/x.mts", &["GET"]));
        assert_eq!(
            listed("src/pages/api/route.ts", &["POST"], A),
            ["POST POST /api/route"]
        );
        assert_eq!(
            listed("src/pages/(admin)/stats_.ts", &["GET"], A),
            ["GET GET /(admin)/stats_"]
        );
        assert_eq!(
            listed("src/pages/users/[id].json.ts", &["GET"], A),
            ["GET GET /users/:id.json"]
        );
        assert!(candidate("src/pages/api/x.ts", &["POST"]));
        assert!(!candidate("src/pages/about.astro", &["GET"]));
        assert!(astro_middleware("src/middleware.ts", &["onRequest"]));
        assert!(astro_middleware(
            "web/src/middleware/index.js",
            &["onRequest"]
        ));
        assert!(!astro_middleware("src/lib/middleware.ts", &["onRequest"]));
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
