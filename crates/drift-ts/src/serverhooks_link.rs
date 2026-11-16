//! Which of the hooks SvelteKit and Nitro run before a route stand before it
//! ([`crate::lower::serverhooks`]), as linking gives them to the route's mount
//! ([`drift_core::MountFacts::app_middleware`]).
//!
//! - SvelteKit runs `handle` of `hooks.server` (next to the `routes` directory)
//!   before every endpoint and page, and the `load` of every `+layout.server`
//!   above a page before that page's `load`. Not before a `+server` endpoint or a
//!   form action: SvelteKit runs no layout load for them, so a layout's guard is
//!   never credited to them.
//! - Nitro runs every file of `server/middleware/` before every route, and a
//!   route's own `onRequest` hooks before its handler.
//!
//! A hook that tests the path is given in the view the route's path makes; where
//! the path does not settle the test, or a file that may hold a hook is not
//! read, what stands before the route is unread, never nothing.

use super::*;
use crate::lower::serverhooks::{RawServerHook, RawServerHooks};

const SCRIPT_EXTENSIONS: &[&str] = &["ts", "js", "mts", "mjs", "cts", "cjs"];

/// The canonical value of what is not read, as the mount reading takes it.
fn unread(how: &str) -> String {
    format!("global#{how}")
}

/// Whether every request a route template takes has a path that starts with
/// `prefix`: `None` where some do and some do not (`/users/:id` against `/users/a`).
fn path_starts_with(template: &str, prefix: &str) -> Option<bool> {
    let fixed = template.find([':', '*']).unwrap_or(template.len());
    let lit = &template[..fixed];
    if fixed == template.len() {
        return Some(template.starts_with(prefix));
    }
    if lit.starts_with(prefix) {
        Some(true)
    } else if prefix.starts_with(lit) {
        None
    } else {
        Some(false)
    }
}

fn join(dir: &str, name: &str) -> String {
    match dir {
        "" => name.to_string(),
        d => format!("{d}/{name}"),
    }
}

impl Linker<'_> {
    /// The hooks SvelteKit or Nitro runs before the entry point `symbol` of the
    /// file `f` at `route`, canonical, in the order they run.
    pub(super) fn server_hooks_before(
        &self,
        f: &LoweredFile,
        framework: crate::filerouters::Framework,
        symbol: &str,
        route: &str,
    ) -> Vec<String> {
        use crate::filerouters::Framework;
        let segs: Vec<&str> = f.rel_path.split('/').collect();
        let Some((file, dirs)) = segs.split_last() else {
            return Vec::new();
        };
        match framework {
            // Astro's middleware is put before its endpoints where they are listed.
            Framework::ReactRouter | Framework::Astro => Vec::new(),
            Framework::SvelteKit => {
                let Some(at) = dirs.iter().rposition(|d| *d == "routes") else {
                    return Vec::new();
                };
                let route_id = format!("/{}", dirs[at + 1..].join("/"));
                let mut out = self.svelte_handle(&dirs[..at].join("/"), route, &route_id);
                let page = file.starts_with("+page.server.");
                let layout = file.starts_with("+layout.server.");
                if symbol == "load" && (page || layout) {
                    out.extend(self.layout_loads_above(&dirs[..=at].join("/"), dirs, page));
                }
                out
            }
            Framework::Nitro => {
                let Some(at) = dirs.iter().position(|d| *d == "server") else {
                    return Vec::new();
                };
                let mut out = self.nitro_middleware(&dirs[..=at].join("/"), route);
                for h in &f.raw.server_hooks.route {
                    out.extend(self.hook_entries(&f.rel_path, h, route, ""));
                }
                out
            }
        }
    }

    /// What `handle` of the `hooks.server` file in `base` (the directory that
    /// holds `routes`) runs before the route.
    fn svelte_handle(&self, base: &str, route: &str, route_id: &str) -> Vec<String> {
        let candidates: Vec<String> = SCRIPT_EXTENSIONS
            .iter()
            .flat_map(|ext| {
                [
                    join(base, &format!("hooks.server.{ext}")),
                    join(base, &format!("hooks.server/index.{ext}")),
                ]
            })
            .collect();
        let read: Vec<(&String, &RawServerHooks)> = candidates
            .iter()
            .filter_map(|c| self.server_hooks.get_key_value(c))
            .filter(|(_, h)| h.kind == "sveltekit")
            .collect();
        let on_disk = candidates
            .iter()
            .filter(|c| self.resolver.root.join(c).is_file())
            .count();
        match read.as_slice() {
            [(file, hooks)] if on_disk <= 1 => hooks
                .hooks
                .iter()
                .flat_map(|h| self.hook_entries(file, h, route, route_id))
                .collect(),
            [] if on_disk == 0 => Vec::new(),
            _ => vec![unread("a hooks.server file that is not read")],
        }
    }

    /// The `load` of each `+layout.server` file from the `routes` directory
    /// `routes` down to the directory of the file whose path is `dirs`: for a
    /// page's `load` (`page`), every one of them; for a layout's own, those above
    /// it. A page or layout that resets the layouts it is under (`+page@.svelte`)
    /// or a universal `+layout.ts` above it, whose load may refuse too, is unread.
    fn layout_loads_above(&self, routes: &str, dirs: &[&str], page: bool) -> Vec<String> {
        let start = routes.split('/').count();
        let mut out = Vec::new();
        let own = dirs.join("/");
        let entries = |dir: &str| -> Vec<String> {
            let Ok(read) = std::fs::read_dir(self.resolver.root.join(dir)) else {
                return Vec::new();
            };
            let mut names: Vec<String> = read
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect();
            names.sort();
            names
        };
        let reset = if page { "+page@" } else { "+layout@" };
        if entries(&own).iter().any(|n| n.starts_with(reset)) {
            return vec![unread("a route that resets the layouts above it")];
        }
        let last = if page { dirs.len() } else { dirs.len() - 1 };
        for end in start..=last {
            let dir = dirs[..end].join("/");
            for name in entries(&dir) {
                let path = join(&dir, &name);
                let universal = name.starts_with("+layout.")
                    && !name.starts_with("+layout.server.")
                    && !name.ends_with(".svelte")
                    && name
                        .rsplit_once('.')
                        .is_some_and(|(_, e)| SCRIPT_EXTENSIONS.contains(&e));
                if universal {
                    out.push(unread("a universal layout load above the page"));
                } else if name.starts_with("+layout.server.") {
                    match self.layout_servers.get(&path) {
                        Some(true) => out.push(format!("{path}#load")),
                        // It exports no `load`: it runs none.
                        Some(false) => {}
                        None => out.push(unread("a layout server file that is not read")),
                    }
                }
            }
        }
        out
    }

    /// What the files of `server/middleware/` under the Nitro directory `server`
    /// run before the route.
    fn nitro_middleware(&self, server: &str, route: &str) -> Vec<String> {
        let dir = join(server, "middleware");
        let Ok(read) = std::fs::read_dir(self.resolver.root.join(&dir)) else {
            return Vec::new();
        };
        let mut found: Vec<(String, bool)> = read
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let is_dir = e.file_type().ok()?.is_dir();
                Some((e.file_name().into_string().ok()?, is_dir))
            })
            .collect();
        found.sort();
        let mut out = Vec::new();
        for (name, is_dir) in found {
            if is_dir {
                out.push(unread("a server middleware directory that is not read"));
                continue;
            }
            if !name
                .rsplit_once('.')
                .is_some_and(|(_, e)| SCRIPT_EXTENSIONS.contains(&e))
            {
                continue;
            }
            let path = join(&dir, &name);
            match self.server_hooks.get(&path).filter(|h| h.kind == "nitro") {
                Some(hooks) => {
                    for h in &hooks.hooks {
                        out.extend(self.hook_entries(&path, h, route, ""));
                    }
                }
                None => out.push(unread("a server middleware that is not read")),
            }
        }
        out
    }

    /// What one hook of the file `file` is before the route at `route` (route id
    /// `route_id`, SvelteKit's): the view its path tests make, nothing where that
    /// view hands every request on untouched, unread where the path does not
    /// settle a test.
    fn hook_entries(
        &self,
        file: &str,
        hook: &RawServerHook,
        route: &str,
        route_id: &str,
    ) -> Vec<String> {
        if !hook.unread.is_empty() {
            return vec![unread(&hook.unread)];
        }
        let mut mask = 0usize;
        for (i, t) in hook.tests.iter().enumerate() {
            let holds = match t.route_id {
                true => Some(route_id.starts_with(&t.prefix)),
                false => path_starts_with(route, &t.prefix),
            };
            match holds {
                Some(true) => mask |= 1 << i,
                Some(false) => {}
                None => {
                    return vec![unread(
                        "a hook that tests the path, which may cover the route",
                    )];
                }
            }
        }
        match hook.views.get(mask) {
            Some(view) => vec![self.canon(file, view)],
            None => vec![unread("a hook that is not read")],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::path_starts_with;

    #[test]
    fn a_literal_prefix_is_settled_by_the_fixed_part_of_the_route() {
        assert_eq!(path_starts_with("/admin/users", "/admin"), Some(true));
        assert_eq!(path_starts_with("/administrator", "/admin/"), Some(false));
        assert_eq!(path_starts_with("/api/items/:id", "/api/"), Some(true));
        assert_eq!(path_starts_with("/users/:id", "/users/a"), None);
        assert_eq!(path_starts_with("/settings", "/admin"), Some(false));
        assert_eq!(path_starts_with("/:lang/admin", "/admin"), None);
    }
}
