//! Next.js adapter: execution facts only (which exports are routes, pages,
//! server actions or middleware). It never produces conventions.

use drift_core::{EntryPoint, FileFacts};

const HTTP_METHODS: &[&str] = &["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ADAPTER: &str = "nextjs";

fn stem_and_ext(file: &str) -> (&str, &str) {
    match file.rfind('.') {
        Some(i) => (&file[..i], &file[i + 1..]),
        None => (file, ""),
    }
}

/// Turn path segments after a router root into a route template.
/// Route groups `(x)` and parallel slots `@x` are dropped; dynamic segments are kept.
fn route_from(segments: &[&str]) -> String {
    let parts: Vec<&str> = segments
        .iter()
        .copied()
        .filter(|s| !(s.starts_with('(') && s.ends_with(')')) && !s.starts_with('@'))
        .collect();
    format!("/{}", parts.join("/"))
}

fn exports_named(facts: &FileFacts, name: &str) -> bool {
    facts.exports.iter().any(|e| e.name == name)
}

fn entry(symbol: &str, kind: &str, method: Option<&str>, route: Option<String>) -> EntryPoint {
    EntryPoint {
        symbol: symbol.to_string(),
        kind: kind.to_string(),
        method: method.map(str::to_string),
        route,
        adapter: ADAPTER.to_string(),
    }
}

/// Whether the package at `package` (repo-relative directory, `""` for the root) is
/// built with Next.js: its `package.json`, or one above it up to the repository root,
/// lists `next` as a dependency, dev dependency or peer dependency, or a directory on
/// the way has a `next.config.*`. It is not only when the package's own manifest
/// declares dependencies and neither it nor one above it is `next`: a manifest without
/// any (or none at all) says nothing about the framework, so it counts as Next.js and
/// routes are never dropped for lack of one. A Vite or Docusaurus app's `src/pages/Login.tsx` and a template's
/// `app/api/x/route.ts` inside a package that does not use Next.js are not Next.js
/// entry points.
pub fn package_uses_next(root: &std::path::Path, package: &str) -> bool {
    let mut dir = if package.is_empty() {
        root.to_path_buf()
    } else {
        root.join(package)
    };
    let mut declares = false;
    let mut first = true;
    loop {
        if NEXT_CONFIGS.iter().any(|c| dir.join(c).is_file()) {
            return true;
        }
        // A planted FIFO or device in place of a manifest is no manifest.
        if let Ok(text) = drift_core::fsutil::read_regular_to_string(
            &dir.join("package.json"),
            drift_core::fsutil::MAX_CONFIG_BYTES,
        ) && let Ok(json) = serde_json::from_str::<serde_json::Value>(&text)
        {
            let mut own = false;
            for k in ["dependencies", "devDependencies", "peerDependencies"] {
                let Some(deps) = json.get(k).and_then(|d| d.as_object()) else {
                    continue;
                };
                if deps.contains_key("next") {
                    return true;
                }
                own |= !deps.is_empty();
            }
            // The package's own manifest decides whether it declares its dependencies.
            if first {
                declares = own;
                first = false;
            }
        }
        if dir == root || !dir.pop() || !dir.starts_with(root) {
            return !declares;
        }
    }
}

const NEXT_CONFIGS: &[&str] = &[
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
    "next.config.mts",
];

/// Entry points for one file, derived from its path, exports and directives. `next`:
/// the file's package is built with Next.js ([`package_uses_next`]); otherwise only
/// server actions are read (a `"use server"` directive says so itself), not routes,
/// pages, layouts or middleware by file name.
pub fn entry_points(facts: &FileFacts, next: bool) -> Vec<EntryPoint> {
    let mut out = Vec::new();
    if !next {
        server_actions(facts, &mut out);
        return out;
    }
    let segs: Vec<&str> = facts.path.split('/').collect();
    let Some((file, dirs)) = segs.split_last() else {
        return out;
    };
    let (stem, ext) = stem_and_ext(file);
    if !matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs") {
        return out;
    }

    // App router: the last `app` directory in the path.
    if let Some(app_idx) = dirs.iter().rposition(|d| *d == "app") {
        let route = route_from(&dirs[app_idx + 1..]);
        match stem {
            "route" => {
                for m in HTTP_METHODS {
                    if exports_named(facts, m) {
                        out.push(entry(m, "http", Some(m), Some(route.clone())));
                    }
                }
            }
            "page" if exports_named(facts, "default") => {
                out.push(entry("default", "page", None, Some(route)))
            }
            "layout" if exports_named(facts, "default") => {
                out.push(entry("default", "layout", None, Some(route)))
            }
            _ => {}
        }
    } else if let Some(pages_idx) = dirs.iter().rposition(|d| *d == "pages") {
        // Pages router.
        let mut rest: Vec<&str> = dirs[pages_idx + 1..].to_vec();
        if stem != "index" {
            rest.push(stem);
        }
        let is_special = stem.starts_with('_');
        if exports_named(facts, "default") && !is_special {
            if rest.first() == Some(&"api") {
                out.push(entry(
                    "default",
                    "http",
                    Some("ANY"),
                    Some(route_from(&rest)),
                ));
            } else {
                out.push(entry("default", "page", None, Some(route_from(&rest))));
            }
        }
    }

    // Middleware sits next to `app`/`pages` or in `src/`.
    if stem == "middleware" {
        let sym = if exports_named(facts, "middleware") {
            "middleware"
        } else {
            "default"
        };
        if exports_named(facts, sym) {
            out.push(entry(sym, "middleware", None, None));
        }
    }

    server_actions(facts, &mut out);
    out
}

/// Server actions: every exported function of a `use server` module.
fn server_actions(facts: &FileFacts, out: &mut Vec<EntryPoint>) {
    if facts.directives.iter().any(|d| d == "use server") {
        for s in &facts.symbols {
            if matches!(s.kind, drift_core::SymbolKind::Function) {
                for name in &s.exported_as {
                    out.push(entry(name, "server_action", None, None));
                }
            }
        }
    }
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

    #[test]
    fn app_router_routes_drop_groups_and_keep_dynamic_segments() {
        let f = facts(
            "apps/web/app/(dashboard)/api/links/[linkId]/route.ts",
            &["GET", "PATCH", "helper"],
        );
        let e = entry_points(&f, true);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].route.as_deref(), Some("/api/links/[linkId]"));
        assert_eq!(e[0].method.as_deref(), Some("GET"));
        assert_eq!(e[1].method.as_deref(), Some("PATCH"));
    }

    #[test]
    fn pages_router_api_and_pages() {
        let api = entry_points(&facts("src/pages/api/users/index.ts", &["default"]), true);
        assert_eq!(api[0].kind, "http");
        assert_eq!(api[0].route.as_deref(), Some("/api/users"));
        let page = entry_points(&facts("pages/blog/[slug].tsx", &["default"]), true);
        assert_eq!(page[0].kind, "page");
        assert_eq!(page[0].route.as_deref(), Some("/blog/[slug]"));
        assert!(entry_points(&facts("pages/_app.tsx", &["default"]), true).is_empty());
    }
}
