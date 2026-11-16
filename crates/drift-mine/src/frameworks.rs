//! What frameworks already decide, so it is never proposed as a team convention.
//!
//! Each entry states one requirement a framework imposes on code of a kind. Rules
//! that restate one are true but trivial: the framework (or its build) already
//! fails without them. The table is data: add a framework by adding rows.

use crate::mine::{Rule, norm_ref};

/// How a mandated fact shows up as a rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    /// A class decorator (`@Injectable()`), as `WrappedBy` decorator or a call.
    Decorator,
    /// A call (`createFileRoute()`).
    Call,
    /// A rendered component or layout wrapper (`<Html>`).
    Render,
    /// A tsconfig compiler flag (`PackageHas { item: "flag:..." }`).
    Flag,
    /// A naming prefix (`use*`).
    NamePrefix,
}

/// One framework requirement.
pub struct Mandate {
    pub framework: &'static str,
    /// Package roots that provide the framework (`@nestjs/common`). For `Decorator`,
    /// `Call` and `Render` the rule's target must come from one of them; for `Flag`
    /// and `NamePrefix` the repo must use one of them.
    pub packages: &'static [&'static str],
    /// Package scopes whose every package provides the framework (`@react-email/`
    /// covers `@react-email/html`, `@react-email/components`, ...).
    pub package_prefixes: &'static [&'static str],
    pub slot: Slot,
    /// Export names (or prefixes for `NamePrefix`); `*` is every export of the packages.
    pub names: &'static [&'static str],
    /// Why the framework requires it (documentation).
    pub why: &'static str,
}

pub const MANDATES: &[Mandate] = &[
    Mandate {
        framework: "NestJS",
        packages: &["@nestjs/common"],
        package_prefixes: &[],
        slot: Slot::Decorator,
        names: &["Injectable", "Module", "Controller", "Global"],
        why: "Nest's injector only wires providers, modules and controllers so decorated",
    },
    Mandate {
        framework: "NestJS",
        packages: &["@nestjs/graphql"],
        package_prefixes: &[],
        slot: Slot::Decorator,
        names: &["Resolver"],
        why: "a GraphQL resolver class must be decorated to be registered",
    },
    Mandate {
        framework: "TypeScript decorator metadata",
        packages: &[
            "@nestjs/common",
            "@nestjs/core",
            "typeorm",
            "type-graphql",
            "inversify",
            "@angular/core",
        ],
        package_prefixes: &[],
        slot: Slot::Flag,
        names: &["emitDecoratorMetadata", "experimentalDecorators"],
        why: "constructor injection and decorators need these compiler flags",
    },
    Mandate {
        framework: "TanStack Router",
        packages: &[
            "@tanstack/react-router",
            "@tanstack/solid-router",
            "@tanstack/vue-router",
            "@tanstack/react-start",
            "@tanstack/solid-start",
        ],
        package_prefixes: &[],
        slot: Slot::Call,
        names: &[
            "createFileRoute",
            "createLazyFileRoute",
            "createRootRoute",
            "createRootRouteWithContext",
            "createAPIFileRoute",
            "createServerFileRoute",
        ],
        why: "file-based routes must export a route built by these",
    },
    Mandate {
        framework: "React",
        packages: &["react", "preact"],
        package_prefixes: &[],
        slot: Slot::NamePrefix,
        names: &["use"],
        why: "the Rules of Hooks require hook names to start with `use`",
    },
    Mandate {
        framework: "React Email",
        packages: &[],
        package_prefixes: &["@react-email/"],
        slot: Slot::Render,
        names: &["Html", "Head", "Body"],
        why: "an email document is `<Html>` with a `<Head>` and a `<Body>`; content \
              components (`<Text>`, `<Tailwind>`) are the team's choice",
    },
];

/// Package root of a canonical ref (`pkg:@a/b/c#X` -> `@a/b`).
fn package_of(r: &str) -> Option<&str> {
    let m = r.strip_prefix("pkg:")?.split('#').next()?;
    let mut parts = m.splitn(3, '/');
    let first = parts.next()?;
    if first.starts_with('@') {
        let second = parts.next()?;
        Some(&m[..first.len() + 1 + second.len()])
    } else {
        Some(first)
    }
}

/// Export name of a canonical ref, without member path or call markers.
fn export_of(r: &str) -> &str {
    let name = r.rsplit_once('#').map_or(r, |(_, n)| n);
    name.split(['.', '(']).next().unwrap_or(name)
}

fn target_matches(m: &Mandate, target: &str) -> bool {
    let target = norm_ref(target);
    let pkg = package_of(&target);
    let pkg_ok = pkg.is_some_and(|p| {
        m.packages.contains(&p) || m.package_prefixes.iter().any(|pre| p.starts_with(pre))
    });
    pkg_ok && (m.names.contains(&"*") || m.names.contains(&export_of(&target)))
}

/// The framework requirement a rule restates, if any. `uses` says whether the repo
/// uses a package (for flags and naming, whose rules do not name the framework).
pub fn mandated(rule: &Rule, uses: impl Fn(&str) -> bool) -> Option<&'static Mandate> {
    use drift_core::WrapKind;
    MANDATES.iter().find(|m| match (m.slot, rule) {
        (
            Slot::Decorator,
            Rule::WrappedBy {
                kind: WrapKind::Decorator,
                any_of,
            },
        ) => any_of.iter().all(|a| target_matches(m, a)),
        (Slot::Decorator | Slot::Call, Rule::Calls { callee })
        | (Slot::Decorator | Slot::Call, Rule::PassesKey { callee, .. }) => {
            target_matches(m, callee)
        }
        (
            Slot::Call,
            Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of,
            },
        ) => any_of.iter().all(|a| target_matches(m, a)),
        (Slot::Render, Rule::Renders { component }) => target_matches(m, component),
        (
            Slot::Render,
            Rule::WrappedBy {
                kind: WrapKind::Jsx,
                any_of,
            },
        ) => any_of.iter().all(|a| target_matches(m, a)),
        (Slot::Flag, Rule::PackageHas { item }) => item
            .strip_prefix("flag:")
            .is_some_and(|f| m.names.contains(&f) && m.packages.iter().any(|p| uses(p))),
        (Slot::NamePrefix, Rule::Named { pattern }) => pattern
            .strip_suffix('*')
            .is_some_and(|p| m.names.contains(&p) && m.packages.iter().any(|p| uses(p))),
        _ => false,
    })
}

/// The packages of the framework each entry-point adapter ([`drift_core::EntryPoint::adapter`])
/// stands for: what an entry point of that adapter is built from. A decorator of these
/// packages is part of how the framework runs a handler (`@Get()`, `@UseGuards()`), never
/// an opt-out from a team's own wrapper.
pub const ENTRY_FRAMEWORKS: &[(&str, &[&str])] = &[
    ("nestjs", &["@nestjs/common", "@nestjs/core"]),
    ("nextjs", &["next"]),
    ("trpc", &["@trpc/server"]),
    ("express", &["express"]),
    ("fastify", &["fastify"]),
    ("hono", &["hono", "@hono/zod-openapi"]),
    ("django", &["django"]),
    ("django_admin", &["django"]),
    ("drf", &["rest_framework", "django"]),
    ("flask", &["flask"]),
    (
        "flask_restx",
        &["flask_restx", "flask_restplus", "flask_restful", "flask"],
    ),
    ("fastapi", &["fastapi", "starlette"]),
    ("sanic", &["sanic"]),
    ("litestar", &["litestar"]),
    ("ninja", &["ninja", "django"]),
    ("celery", &["celery"]),
    ("dramatiq", &["dramatiq"]),
];

/// Framework packages of an entry-point adapter (none for an adapter the table lacks).
pub fn entry_framework(adapter: &str) -> &'static [&'static str] {
    ENTRY_FRAMEWORKS
        .iter()
        .find(|(a, _)| *a == adapter)
        .map_or(&[], |(_, p)| p)
}

/// Pure decorator combinators: they apply the decorators passed to them and add none
/// of their own, so a wrapper built with one wraps only what it passes.
pub const DECORATOR_COMBINATORS: &[&str] = &["pkg:@nestjs/common#applyDecorators"];
/// Extensions of the files [`root_file`] considers.
const ROOT_FILE_EXTENSIONS: &[&str] = &["tsx", "ts", "jsx", "js", "mts", "mjs"];

/// Packages whose apps are built around a `src/main.ts(x)` entry module.
const FRONTEND_PACKAGES: &[&str] = &[
    "react",
    "react-dom",
    "vue",
    "svelte",
    "solid-js",
    "preact",
    "@angular/core",
    "lit",
];

/// A barrel: every export re-exported from another module, and no statement of its
/// own (no declaration, no side-effect call).
fn is_barrel(file: &drift_core::FileFacts) -> bool {
    !file.exports.is_empty()
        && file
            .exports
            .iter()
            .all(|e| e.kind != drift_core::ExportKind::Local)
        && file.symbols.iter().all(|s| {
            s.kind == drift_core::SymbolKind::Module
                && s.calls.is_empty()
                && s.wraps.is_empty()
                && s.renders.is_empty()
        })
}

/// The framework root file `file` is, if it is one (F9), with its path below the
/// package and what it is. Each package has at most one of each, so in a role it is
/// the only one of its kind, whatever its peers are written like. At the root of the
/// package or of its `src/`:
///
/// - with `next` among the package's dependencies (`depends_on`): `app/page`,
///   `app/layout`, `pages/_app`, `pages/_document`, and `pages/index` unless it is a
///   barrel (a Vite app's `src/pages/index.ts` that re-exports its pages);
/// - with a frontend framework among them ([`FRONTEND_PACKAGES`]): `src/main` (not a
///   GitHub Action's or a server's `src/main.ts`);
/// - an `index` barrel ([`is_barrel`]).
pub fn root_file(
    file: &drift_core::FileFacts,
    depends_on: impl Fn(&str) -> bool,
) -> Option<(String, &'static str)> {
    let rel = if file.package.is_empty() {
        file.path.as_str()
    } else {
        file.path
            .strip_prefix(file.package.as_str())?
            .strip_prefix('/')?
    };
    let (stem, ext) = rel.rsplit_once('.')?;
    if !ROOT_FILE_EXTENSIONS.contains(&ext) {
        return None;
    }
    let root = stem.strip_prefix("src/").unwrap_or(stem);
    let what = match root {
        "app/page" if depends_on("next") => "the app's root page",
        "app/layout" if depends_on("next") => "the app's root layout",
        "pages/_app" if depends_on("next") => "the app's custom App",
        "pages/_document" if depends_on("next") => "the app's custom Document",
        "pages/index" if depends_on("next") && !is_barrel(file) => "the app's root page",
        "main" if stem == "src/main" && FRONTEND_PACKAGES.iter().any(|p| depends_on(p)) => {
            "the app's entry module"
        }
        "index" if is_barrel(file) => "the package's barrel",
        _ => return None,
    };
    Some((rel.to_string(), what))
}

/// Names Next.js reserves for exports of route files (`page`, `layout`, `route`, ...):
/// segment config, metadata and data-fetching hooks. The framework chose them, so
/// they neither form nor break a team's naming convention.
pub const NEXT_RESERVED_EXPORTS: &[&str] = &[
    "generateMetadata",
    "generateStaticParams",
    "generateViewport",
    "generateImageMetadata",
    "generateSitemaps",
    "metadata",
    "viewport",
    "dynamic",
    "dynamicParams",
    "revalidate",
    "fetchCache",
    "runtime",
    "preferredRegion",
    "maxDuration",
    "experimental_ppr",
    "config",
    "alt",
    "size",
    "contentType",
    "getServerSideProps",
    "getStaticProps",
    "getStaticPaths",
    "getInitialProps",
    "middleware",
    "proxy",
];

/// Verbs that name what a function does to data. A shared prefix among them says
/// the functions in a folder mostly read (or write), not that the team chose a
/// naming scheme: `createReport` among `get*` reads is correctly named.
pub const CRUD_VERBS: &[&str] = &[
    "get", "set", "create", "update", "delete", "remove", "list", "fetch", "add", "find", "insert",
    "upsert", "save", "load", "read", "write", "put", "post", "patch", "edit", "destroy", "query",
    "search", "count",
];

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::WrapKind;

    #[test]
    fn mandates_match_by_package_and_name() {
        let deco = |r: &str| Rule::WrappedBy {
            kind: WrapKind::Decorator,
            any_of: vec![r.into()],
        };
        let none = |_: &str| false;
        assert!(mandated(&deco("pkg:@nestjs/common/decorators#Injectable"), none).is_some());
        assert!(mandated(&deco("src/auth.ts#Injectable"), none).is_none());
        assert!(mandated(&deco("pkg:@nestjs/common#UseGuards"), none).is_none());
        let html = Rule::WrappedBy {
            kind: WrapKind::Jsx,
            any_of: vec!["pkg:@react-email/components#Html".into()],
        };
        assert!(mandated(&html, none).is_some());
        let call = Rule::Calls {
            callee: "pkg:@tanstack/react-router#createFileRoute".into(),
        };
        assert!(mandated(&call, none).is_some());
        let hooks = Rule::Named {
            pattern: "use*".into(),
        };
        assert!(mandated(&hooks, none).is_none(), "only when React is used");
        assert!(mandated(&hooks, |p| p == "react").is_some());
        let flag = Rule::PackageHas {
            item: "flag:emitDecoratorMetadata".into(),
        };
        assert!(mandated(&flag, |p| p == "@nestjs/core").is_some());
        assert!(mandated(&flag, none).is_none());
    }
}
