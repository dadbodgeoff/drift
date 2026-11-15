//! Conformance tests: one fixture repo exercising each parser capability.
//!
//! Each capability has an explicit assertion (so the intent is readable) and the
//! whole fact index is snapshotted (so unintended changes show up in review).

use std::path::{Path, PathBuf};

use drift_core::{FileFacts, RepoFacts, Symbol, WrapKind};
use drift_ts::{ScanOptions, scan};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn scan_fixture(name: &str, threads: usize) -> RepoFacts {
    scan(
        &fixture(name),
        &ScanOptions {
            cache_dir: None,
            threads,
        },
    )
    .expect("scan")
    .0
}

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

fn symbol<'a>(f: &'a FileFacts, name: &str) -> &'a Symbol {
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} not in {}", f.path))
}

#[test]
fn wrapper_on_exported_const_resolves_through_barrel_and_alias() {
    let r = scan_fixture("next-app", 0);
    let route = file(&r, "app/api/links/route.ts");
    let get = symbol(route, "GET");
    assert_eq!(get.exported_as, ["GET"]);
    assert_eq!(get.wraps.len(), 1);
    assert_eq!(get.wraps[0].wrapper, "lib/auth.ts#withAuth");
    assert_eq!(get.wraps[0].kind, WrapKind::Call);
    assert!(
        get.args
            .contains(&"lib/auth.ts#withAuth@1:requiredPermissions".to_string()),
        "{:?}",
        get.args
    );
    // `prisma` is `db` re-exported under another name: the member call keeps its origin.
    assert!(
        get.calls
            .contains(&"lib/db.ts#db.link.findMany".to_string()),
        "{:?}",
        get.calls
    );
    assert!(get.controls.contains(&"await".to_string()));
}

#[test]
fn suppressions_need_a_reason() {
    let r = scan_fixture("next-app", 0);
    let post = symbol(file(&r, "app/api/links/route.ts"), "POST");
    // `D-def456` has no reason, so only the explained suppression counts.
    assert_eq!(post.suppressions, ["D-abc123"]);
    assert!(
        symbol(file(&r, "app/api/links/route.ts"), "GET")
            .suppressions
            .is_empty()
    );
}

#[test]
fn calls_with_nested_calls_are_values_not_wrappers() {
    let r = scan_fixture("next-app", 0);
    let schema = symbol(file(&r, "lib/db.ts"), "linkSchema");
    assert!(schema.wraps.is_empty(), "{:?}", schema.wraps);
    assert!(
        schema.calls.contains(&"lib/db.ts#z.array".to_string()),
        "{:?}",
        schema.calls
    );
}

#[test]
fn try_body_namespace_import_and_shadowing() {
    let r = scan_fixture("next-app", 0);
    let route = file(&r, "app/api/links/route.ts");
    let post = symbol(route, "POST");
    assert!(post.wraps.iter().any(|w| w.kind == WrapKind::Try));
    assert!(
        post.calls.contains(&"pkg:zod#object().parse".to_string()),
        "{:?}",
        post.calls
    );
    assert!(
        post.calls.contains(&"pkg:zod#string".to_string()),
        "{:?}",
        post.calls
    );
    let shadowed = symbol(route, "shadowed");
    assert!(
        !shadowed.calls.iter().any(|c| c.contains("withAuth")),
        "local binding resolved to the import: {:?}",
        shadowed.calls
    );
}

#[test]
fn components_jsx_wrappers_and_directives() {
    let r = scan_fixture("next-app", 0);
    let page = file(&r, "app/(marketing)/page.tsx");
    let p = symbol(page, "Page");
    assert_eq!(p.kind, drift_core::SymbolKind::Component);
    assert_eq!(p.exported_as, ["default"]);
    assert!(
        p.wraps
            .iter()
            .any(|w| w.kind == WrapKind::Jsx && w.wrapper == "components/layout.tsx#Layout")
    );
    assert!(
        p.renders
            .contains(&"components/button.tsx#Button".to_string())
    );
    let layout = file(&r, "components/layout.tsx");
    assert_eq!(layout.directives, ["use client"]);
    assert_eq!(
        symbol(layout, "Layout").kind,
        drift_core::SymbolKind::Component
    );
    assert_eq!(
        symbol(file(&r, "components/button.tsx"), "Button").kind,
        drift_core::SymbolKind::Component
    );
}

#[test]
fn decorators_and_extends() {
    let r = scan_fixture("next-app", 0);
    let svc = symbol(file(&r, "services/user.service.ts"), "UserService");
    let wraps: Vec<_> = svc
        .wraps
        .iter()
        .map(|w| (w.kind, w.wrapper.as_str()))
        .collect();
    assert!(
        wraps.contains(&(WrapKind::Decorator, "pkg:@nestjs/common#Injectable")),
        "{wraps:?}"
    );
    assert!(
        wraps.contains(&(WrapKind::Extends, "services/base.ts#BaseService")),
        "{wraps:?}"
    );
}

#[test]
fn barrel_exports_point_at_origins() {
    let r = scan_fixture("next-app", 0);
    let idx = file(&r, "lib/index.ts");
    let origins: Vec<_> = idx
        .exports
        .iter()
        .map(|e| (e.name.as_str(), e.origin.as_str()))
        .collect();
    assert!(origins.contains(&("prisma", "lib/db.ts#db")), "{origins:?}");
    assert!(origins.contains(&("*", "lib/auth.ts#*")), "{origins:?}");
}

#[test]
fn destructured_exports_become_symbols_and_entry_points() {
    let r = scan_fixture("next-app", 0);
    let f = file(&r, "app/api/auth/route.ts");
    assert_eq!(symbol(f, "GET").exported_as, ["GET"]);
    assert_eq!(symbol(f, "POST").exported_as, ["POST"]);
}

#[test]
fn export_star_names_are_expanded_and_dts_targets_resolve() {
    let r = scan_fixture("next-app", 0);
    let idx = file(&r, "lib/index.ts");
    let origins: Vec<_> = idx
        .exports
        .iter()
        .map(|e| (e.name.as_str(), e.origin.as_str()))
        .collect();
    assert!(
        origins.contains(&("withAuth", "lib/auth.ts#withAuth")),
        "{origins:?}"
    );
    assert!(
        origins.contains(&("requireUser", "lib/auth.ts#requireUser")),
        "{origins:?}"
    );
    let page = file(&r, "app/(marketing)/page.tsx");
    assert!(
        page.imports
            .iter()
            .any(|i| i.module == "components/ui/card.tsx"),
        "baseUrl import: {:?}",
        page.imports
    );
    let na = file(&r, "lib/next-auth.ts");
    assert_eq!(na.imports[0].module, "lib/api-types.d.ts");
}

#[test]
fn workspace_subpaths_resolve_to_source_when_exports_point_at_missing_dist() {
    let r = scan_fixture("next-app", 0);
    let mods: Vec<_> = file(&r, "components/brand.tsx")
        .imports
        .iter()
        .map(|i| i.module.as_str())
        .collect();
    assert_eq!(
        mods,
        [
            "packages/ui/src/icons/index.tsx",
            "packages/ui/src/index.tsx"
        ]
    );
}

#[test]
fn base_url_and_paths_resolve_when_tsconfig_extends_is_missing() {
    let r = scan_fixture("broken-extends", 0);
    let mods: Vec<_> = file(&r, "app/page.ts")
        .imports
        .iter()
        .map(|i| i.module.as_str())
        .collect();
    assert_eq!(mods, ["lib/auth.ts", "lib/db.ts", "pkg:zod"]);
}

#[test]
fn commonjs_requires_exports_and_member_calls() {
    let r = scan_fixture("express-cjs", 0);
    let ctl = file(&r, "src/controllers/user.controller.js");
    let mods: Vec<_> = ctl.imports.iter().map(|i| i.module.as_str()).collect();
    assert!(
        mods.contains(&"src/services/index.js") && mods.contains(&"src/utils/catchAsync.js"),
        "{mods:?}"
    );
    let names: Vec<_> = ctl.exports.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["createUser", "getUsers"]);
    // Destructured require through a CommonJS barrel resolves to the defining file.
    assert_eq!(
        symbol(ctl, "createUser").calls,
        ["src/services/user.service.js#createUser"]
    );
    assert_eq!(
        symbol(ctl, "createUser").wraps[0].wrapper,
        "src/utils/catchAsync.js#default"
    );
    // `require()` itself is never recorded as a call.
    assert!(
        r.files
            .iter()
            .flat_map(|f| &f.symbols)
            .all(|s| !s.calls.iter().any(|c| c == "global#require"))
    );
    let svc = file(&r, "src/services/user.service.js");
    assert_eq!(
        svc.exports
            .iter()
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        ["createUser", "getUsers"]
    );
}

#[test]
fn express_routes_carry_their_middleware() {
    let r = scan_fixture("express-cjs", 0);
    let routes = file(&r, "src/routes/user.route.js");
    let post = symbol(routes, "POST /");
    let wraps: Vec<_> = post.wraps.iter().map(|w| w.wrapper.as_str()).collect();
    assert_eq!(
        wraps,
        [
            "src/middlewares/auth.js#auth",
            "src/middlewares/validate.js#default"
        ]
    );
    assert_eq!(
        post.calls,
        ["src/controllers/user.controller.js#createUser(ref)"]
    );
    assert!(symbol(routes, "GET /health").wraps.is_empty());
    let eps: Vec<_> = routes
        .entry_points
        .iter()
        .map(|e| {
            format!(
                "{} {}",
                e.method.as_deref().unwrap_or("-"),
                e.route.as_deref().unwrap_or("-")
            )
        })
        .collect();
    // Full paths: `/v1` (app.js) + `/users` (routes/index.js) + the route's own path.
    assert_eq!(
        eps,
        ["GET /v1/users", "GET /v1/users/health", "POST /v1/users"]
    );
    // Router-level `router.use(auth("admin"))` guards later routes.
    let admin = file(&r, "src/routes/admin.route.js");
    assert_eq!(
        symbol(admin, "DELETE /users/:id").wraps[0].wrapper,
        "src/middlewares/auth.js#auth"
    );
}

fn routes(r: &RepoFacts) -> Vec<String> {
    let mut v: Vec<String> = r
        .files
        .iter()
        .flat_map(|f| {
            f.entry_points
                .iter()
                .filter(|e| e.kind == "http")
                .map(move |e| {
                    let s = f
                        .symbols
                        .iter()
                        .find(|s| s.name == e.symbol)
                        .expect("route symbol exists");
                    let wraps: Vec<_> = s
                        .wraps
                        .iter()
                        .map(|w| w.wrapper.rsplit('#').next().unwrap_or_default())
                        .collect();
                    format!(
                        "{} {} {} [{}]",
                        e.adapter,
                        e.method.as_deref().unwrap_or("-"),
                        e.route.as_deref().unwrap_or("-"),
                        wraps.join(",")
                    )
                })
        })
        .collect();
    v.sort();
    v
}

#[test]
fn express_mount_prefixes_join_across_files() {
    let r = scan_fixture("express-cjs", 0);
    assert_eq!(
        routes(&r),
        [
            "express DELETE /v1/admin/users/:id [auth]",
            "express GET /v1/users [auth]",
            "express GET /v1/users/health []",
            "express POST /v1/users [auth,default]",
        ]
    );
}

#[test]
fn express_routers_exported_in_place_have_routes_and_mounts() {
    let r = scan_fixture("express-esm", 0);
    // `export const v1 = express.Router()`, `export const users: Router = Router()` and
    // `export default Router().get(...)` are routers like `const r = Router(); export { r }`.
    assert_eq!(
        routes(&r),
        [
            "express DELETE /api/users/:id [auth,admin]",
            "express GET /api/ping [auth]",
            "express GET /api/users [auth]",
            "express GET /health []",
            "express GET /health/ready []",
        ]
    );
    let v1 = file(&r, "src/routes/v1.ts");
    assert_eq!(v1.exports.len(), 1, "{:?}", v1.exports);
    // An empty default-exported router is still a value export, with no routes.
    let status = file(&r, "src/routes/status.ts");
    assert!(status.entry_points.is_empty());
    assert!(status.symbols.iter().any(|s| s.exported_as == ["default"]));
}

#[test]
fn nestjs_controllers_become_routes_with_class_and_method_guards() {
    let r = scan_fixture("nest-app", 0);
    assert_eq!(
        routes(&r),
        [
            "nestjs DELETE /users/:id [UseGuards,Authenticated]",
            "nestjs GET /users/:id [UseGuards,Authenticated]",
            "nestjs POST /users [UseGuards]",
        ]
    );
    let ctl = file(&r, "src/users/users.controller.ts");
    let get = symbol(ctl, "GET /users/:id");
    assert!(
        get.args
            .contains(&"src/auth/auth.guard.ts#Authenticated@0:permission".to_string()),
        "{:?}",
        get.args
    );
    // `this.users.find()` needs type information to resolve; v0 does not record it.
    // The controller class itself is still a symbol, and non-route methods add no routes.
    assert!(ctl.symbols.iter().any(|s| s.name == "UsersController"));
}

#[test]
fn linter_configs_are_repo_facts() {
    let r = scan_fixture("nest-app", 0);
    assert_eq!(r.lint.len(), 1);
    let c = &r.lint[0];
    assert_eq!(
        (c.path.as_str(), c.tool.as_str()),
        (".oxlintrc.json", "oxlint")
    );
    let rules: Vec<String> = c
        .rules
        .iter()
        .map(|r| format!("{}={}", r.rule, r.level))
        .collect();
    // Tool-neutral names; the `overrides` block for spec files does not count.
    assert_eq!(rules, ["no-console=warn", "no-explicit-any=off"]);
    // Repos without linter configs serialise exactly as before.
    let next = scan_fixture("next-app", 0);
    assert!(next.lint.is_empty());
    assert!(!serde_json::to_string(&next).unwrap().contains("\"lint\""));
}

#[test]
fn class_facts_exclude_member_decorators_and_their_arguments() {
    let r = scan_fixture("nest-app", 0);
    let class = symbol(file(&r, "src/users/users.controller.ts"), "UsersController");
    // Class decorators are the class's own facts.
    assert!(
        class
            .calls
            .contains(&"pkg:@nestjs/common#Controller".to_string()),
        "{:?}",
        class.calls
    );
    // Method and parameter decorators (`@Get`, `@Param`, `@Authenticated({ permission })`,
    // `@Endpoint({ history: new HistoryBuilder() })`) belong to the methods.
    for c in &class.calls {
        assert!(
            !c.contains("Authenticated")
                && !c.contains("HistoryBuilder")
                && !c.ends_with("#Get")
                && !c.ends_with("#Param"),
            "{c} rolled up to the class"
        );
    }
    assert!(class.args.is_empty(), "{:?}", class.args);
    // Method bodies still count.
    assert!(
        class
            .calls
            .contains(&"src/users/users.service.ts#UsersService.find".to_string()),
        "{:?}",
        class.calls
    );
}

#[test]
fn hono_openapi_routes_and_app_route_mounts() {
    let r = scan_fixture("hono-app", 0);
    assert_eq!(
        routes(&r),
        [
            "hono GET /health [withAuth]",
            "hono GET /public/status []",
            // `app.use(withAuth)` runs before `app.route("/users", ...)`, so mounted routes inherit it.
            "hono GET /users/{id} [withAuth,withRequiredScope]",
            "hono POST /users [withAuth,withRequiredScope]",
        ]
    );
}

#[test]
fn fastify_route_objects_inside_plugins_and_register_prefixes() {
    let r = scan_fixture("fastify-app", 0);
    assert_eq!(
        routes(&r),
        [
            "fastify DELETE /api/v1/secrets/:id [verifyAuth,verifySuperAdmin]",
            "fastify GET /api/v1/secrets/:id [verifyAuth]",
            "fastify GET /api/v1/secrets/public []",
            "fastify POST /api/v1/secrets [verifyAuth]",
            "fastify PUT /api/v1/secrets [verifyAuth]",
        ]
    );
}

#[test]
fn namespaces_and_dynamic_imports() {
    let r = scan_fixture("nest-app", 0);
    let svc = file(&r, "src/users/users.service.ts");
    assert!(
        svc.exports.iter().any(|e| e.name == "Users"),
        "namespace export"
    );
    assert!(
        svc.imports
            .iter()
            .any(|i| i.module == "src/users/lazy-module.ts"),
        "dynamic import"
    );
}

#[test]
fn security_signals_are_detected_and_safe_forms_are_not() {
    let r = scan_fixture("signals", 0);
    let f = file(&r, "src/handlers.tsx");
    assert_eq!(
        symbol(f, "dangerous").sinks,
        [
            "cookie_without_httponly",
            "dynamic_fetch",
            "dynamic_redirect",
            "eval",
            "jwt_decode_without_verify",
            "raw_html",
            "raw_sql",
            "shell_exec",
            "weak_hash"
        ]
    );
    assert!(
        symbol(f, "safe").sinks.is_empty(),
        "{:?}",
        symbol(f, "safe").sinks
    );
    assert_eq!(symbol(f, "Html").sinks, ["raw_html"]);
    assert_eq!(
        symbol(f, "hostOnly").sinks,
        ["dynamic_fetch"],
        "computed host is dynamic; literal host with computed path is not"
    );
    assert!(
        symbol(f, "configured").sinks.is_empty(),
        "env-configured origins are fixed: {:?}",
        symbol(f, "configured").sinks
    );
    assert_eq!(symbol(f, "app").sinks, ["cors_any_origin"]);
}

#[test]
fn env_reads_throws_validation_types_and_nested_keys() {
    let r = scan_fixture("signals", 0);
    let s = symbol(file(&r, "src/handlers.tsx"), "listLinks");
    assert_eq!(s.reads, ["process.env.DATABASE_URL"]);
    assert_eq!(s.throws, ["src/errors.ts#AppError"]);
    for c in ["validates", "typed_return"] {
        assert!(s.controls.iter().any(|x| x == c), "{c}: {:?}", s.controls);
    }
    assert!(
        s.args
            .contains(&"src/db.ts#prisma.link.findMany@0:where.workspaceId".to_string()),
        "{:?}",
        s.args
    );
    assert!(
        symbol(file(&r, "src/handlers.tsx"), "dangerous")
            .controls
            .iter()
            .any(|c| c == "uses_any")
    );
}

#[test]
fn injected_services_resolve_through_constructor_types() {
    let r = scan_fixture("nest-app", 0);
    let get = symbol(file(&r, "src/users/users.controller.ts"), "GET /users/:id");
    assert_eq!(get.calls, ["src/users/users.service.ts#UsersService.find"]);
}

fn entries(r: &RepoFacts) -> Vec<String> {
    let mut v: Vec<String> = r
        .files
        .iter()
        .flat_map(|f| {
            f.entry_points
                .iter()
                .filter(|e| e.kind != "http")
                .map(move |e| {
                    let s = f
                        .symbols
                        .iter()
                        .find(|s| s.name == e.symbol)
                        .expect("entry symbol exists");
                    let wraps: Vec<_> = s
                        .wraps
                        .iter()
                        .map(|w| w.wrapper.rsplit('#').next().unwrap_or_default())
                        .collect();
                    let validates = if s.controls.iter().any(|c| c == "validates") {
                        " validates"
                    } else {
                        ""
                    };
                    format!(
                        "{} {} {} {} [{}]{validates}",
                        e.adapter,
                        e.kind,
                        e.method.as_deref().unwrap_or("-"),
                        e.route.as_deref().unwrap_or("-"),
                        wraps.join(",")
                    )
                })
        })
        .collect();
    v.sort();
    v
}

#[test]
fn trpc_procedures_standalone_and_inline() {
    let r = scan_fixture("trpc-app", 0);
    assert_eq!(
        entries(&r),
        [
            "trpc rpc MUTATION delete [authenticatedProcedure,isAdmin]",
            "trpc rpc QUERY getTeamRoute [authenticatedProcedure] validates",
            "trpc rpc QUERY health [publicProcedure]",
        ]
    );
}

/// Procedure builders reached through a default import, an aliased or re-exported
/// binding, or a namespace are entry points even with no `.input()`/`.use()` link.
#[test]
fn trpc_procedures_through_default_aliased_and_reexported_builders() {
    let r = scan_fixture("trpc-imports", 0);
    assert_eq!(
        entries(&r),
        [
            "trpc rpc MUTATION deleteMe [authedProcedure]",
            "trpc rpc MUTATION feedback [publicProcedure]",
            "trpc rpc MUTATION rename [authedProcedure] validates",
            "trpc rpc MUTATION save [authedProcedure]",
            "trpc rpc MUTATION signup [publicProcedure]",
            "trpc rpc MUTATION wipe [authedProcedure]",
            "trpc rpc QUERY audit [authedProcedure,logged]",
            "trpc rpc QUERY health [publicProcedure]",
            "trpc rpc QUERY me [authedProcedure]",
            "trpc rpc QUERY stats [authedProcedure]",
            "trpc rpc QUERY version [publicProcedure]",
            "trpc rpc SUBSCRIPTION onEvent [authedProcedure]",
            "trpc rpc SUBSCRIPTION ticks [publicProcedure]",
        ]
    );
}

/// A procedure whose builder's name says nothing (`api.query()`) is one when the
/// builder is proven to be built from a tRPC instance's `.procedure`: through builder
/// steps, imports, aliases, barrels, namespaces and default exports. Builders whose
/// origin is anything else, or unknown, leave ordinary calls.
#[test]
fn trpc_procedures_follow_the_builders_proven_origin() {
    let r = scan_fixture("trpc-origin", 0);
    assert_eq!(
        entries(&r),
        [
            "trpc rpc MUTATION fresh [viaDefault]",
            "trpc rpc MUTATION rename [api] validates",
            "trpc rpc MUTATION save [authed]",
            "trpc rpc QUERY docs [described]",
            "trpc rpc QUERY logs [default]",
            "trpc rpc QUERY me [authed]",
            "trpc rpc QUERY open [pub]",
            "trpc rpc QUERY ping [api]",
            "trpc rpc QUERY stats [authed]",
            "trpc rpc SUBSCRIPTION events [admin]",
        ]
    );
    // Unproven: the values stay as they were lowered, and inline ones are nothing.
    let unproven = file(&r, "server/routers/unproven.ts");
    assert!(
        unproven.entry_points.is_empty(),
        "{:?}",
        unproven.entry_points
    );
    let names: Vec<&str> = unproven.symbols.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["a", "b", "unprovenRouter"]);
    let a = unproven.symbols.iter().find(|s| s.name == "a").unwrap();
    assert_eq!(a.kind, drift_core::SymbolKind::Function);
    let wraps: Vec<&str> = a.wraps.iter().map(|w| w.wrapper.as_str()).collect();
    assert_eq!(wraps, ["server/not-builders.ts#objectMember.query"]);
}

/// A builder is also what a function proven to return one returns
/// (`withPermission("me.read").query()`, `const teamApi = forTeam("a")`): a plain
/// function, never falling through, every `return` a proven builder chain. And
/// `const { procedure: api } = t` of a proven instance. Anything less, whatever the
/// function is named, leaves ordinary calls.
#[test]
fn trpc_builders_from_proven_factories_and_destructured_instances() {
    let r = scan_fixture("trpc-factories", 0);
    assert_eq!(
        entries(&r),
        [
            "trpc rpc MUTATION branch [branchy] validates",
            "trpc rpc MUTATION edit [canEdit]",
            "trpc rpc QUERY fallback [default]",
            "trpc rpc QUERY me [withPermission]",
            "trpc rpc QUERY ping [api]",
            "trpc rpc QUERY remote [viaImport]",
            "trpc rpc QUERY spaced [forTeam]",
            "trpc rpc QUERY team [teamApi]",
            "trpc rpc SUBSCRIPTION events [nested]",
        ]
    );
    let me = symbol(file(&r, "server/routers/proven.ts"), "me");
    let wraps: Vec<&str> = me.wraps.iter().map(|w| w.wrapper.as_str()).collect();
    assert_eq!(wraps, ["server/factories.ts#withPermission"]);
    // A proven function derives from what its one `return` is built from, so its
    // procedures are built on that builder; an unproven one derives from nothing.
    let factories = file(&r, "server/factories.ts");
    assert_eq!(
        symbol(factories, "withPermission").derives_from,
        "server/trpc.ts#guarded.use()"
    );
    assert_eq!(
        symbol(file(&r, "server/perms.ts"), "canEdit").derives_from,
        "server/guards.ts#editor"
    );
    // Two returns: no one binding to derive from.
    assert_eq!(symbol(factories, "branchy").derives_from, "");
    let not = file(&r, "server/not-factories.ts");
    for name in ["notTrpc", "asyncArrow", "letFactory", "reassigned"] {
        assert_eq!(symbol(not, name).derives_from, "", "{name}");
    }
    let unproven = file(&r, "server/routers/unproven.ts");
    assert!(
        unproven.entry_points.is_empty(),
        "{:?}",
        unproven.entry_points
    );
    let names: Vec<&str> = unproven.symbols.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["a", "b", "unprovenRouter"]);
    assert_eq!(symbol(unproven, "b").kind, drift_core::SymbolKind::Function);
}

#[test]
fn nestjs_resolvers_cron_jobs_and_messages() {
    let r = scan_fixture("nest-app", 0);
    assert_eq!(
        entries(&r),
        [
            "nestjs cron - Maintenance.cleanup []",
            "nestjs graphql MUTATION UsersResolver.deleteMe [UseGuards]",
            "nestjs graphql QUERY UsersResolver.me [UseGuards]",
            "nestjs job - EmailProcessor.send []",
            "nestjs message - Maintenance.onUserCreated []",
        ]
    );
}

#[test]
fn background_jobs_and_schedules() {
    let r = scan_fixture("jobs-app", 0);
    assert_eq!(
        entries(&r),
        [
            "bullmq job - emails []",
            "inngest cron - nightly-report []",
            "inngest job - send-welcome []",
            "trigger.dev cron - weekly-digest []",
            "trigger.dev job - resize-image []",
        ]
    );
}

#[test]
fn client_components_leaking_server_modules_and_secret_env() {
    let r = scan_fixture("next-app", 0);
    // `lib/users.ts` reaches `server-only` through `lib/server-db.ts`, which is the module
    // reported (the root to cut at); the server action and NEXT_PUBLIC_ variable are allowed.
    assert_eq!(
        file(&r, "components/leaky.tsx").client_leaks,
        ["env:STRIPE_SECRET_KEY", "lib/server-db.ts"]
    );
    assert!(file(&r, "components/layout.tsx").client_leaks.is_empty());
    // An import used only in type positions is erased (TypeScript import elision),
    // so a client reaching `lib/billing-types.ts` does not bundle `stripe`.
    let billing = file(&r, "lib/billing-types.ts");
    assert!(
        billing
            .imports
            .iter()
            .any(|i| i.module == "pkg:stripe" && i.type_only),
        "{:?}",
        billing.imports
    );
    assert!(file(&r, "components/billing.tsx").client_leaks.is_empty());
}

#[test]
fn test_pairing_models_and_packages() {
    let r = scan_fixture("next-app", 0);
    assert!(file(&r, "lib/auth.ts").has_test);
    assert!(!file(&r, "lib/db.ts").has_test);
    let mut models: Vec<_> = r
        .models
        .iter()
        .map(|m| format!("{} {} {}", m.source, m.name, m.fields.join(",")))
        .collect();
    models.sort();
    assert_eq!(
        models,
        [
            "drizzle domains id,workspaceId",
            "prisma Link id,url,workspaceId",
            "sql audit_logs id,workspace_id"
        ]
    );
    let root = r.packages.iter().find(|p| p.path.is_empty()).unwrap();
    assert_eq!(root.scripts, ["build", "typecheck"]);
    assert!(root.compiler_flags.contains(&"strict".to_string()));
}

#[test]
fn nextjs_entry_points() {
    let r = scan_fixture("next-app", 0);
    let mut eps: Vec<String> = r
        .files
        .iter()
        .flat_map(|f| {
            f.entry_points.iter().map(move |e| {
                format!(
                    "{} {} {} {}",
                    f.path,
                    e.kind,
                    e.method.as_deref().unwrap_or("-"),
                    e.route.as_deref().unwrap_or("-")
                )
            })
        })
        .collect();
    eps.sort();
    assert_eq!(
        eps,
        [
            "actions/save.ts server_action - -",
            "app/(marketing)/page.tsx page - /",
            "app/api/auth/route.ts http GET /api/auth",
            "app/api/auth/route.ts http POST /api/auth",
            "app/api/links/route.ts http GET /api/links",
            "app/api/links/route.ts http POST /api/links",
            "pages/api/health.ts http ANY /api/health",
        ]
    );
}

#[test]
fn output_is_deterministic_across_threads_and_checkout_paths() {
    let a = serde_json::to_string(&scan_fixture("next-app", 1)).unwrap();
    let b = serde_json::to_string(&scan_fixture("next-app", 8)).unwrap();
    assert_eq!(a, b, "thread count changed the output");

    // Same repo at a different absolute path must give byte-identical facts.
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("some/other/place");
    copy_dir(&fixture("next-app"), &dest);
    let c = serde_json::to_string(&scan(&dest, &ScanOptions::default()).unwrap().0).unwrap();
    assert_eq!(a, c, "checkout path leaked into the output");
}

#[test]
fn cache_hits_give_identical_facts() {
    let tmp = tempfile::tempdir().unwrap();
    let opts = ScanOptions {
        cache_dir: Some(tmp.path().to_path_buf()),
        threads: 0,
    };
    let (cold, s1) = scan(&fixture("next-app"), &opts).unwrap();
    let (warm, s2) = scan(&fixture("next-app"), &opts).unwrap();
    assert_eq!(s1.cache_hits, 0);
    assert_eq!(s2.cache_hits, s2.files);
    assert_eq!(cold, warm);
}

#[test]
fn snapshot() {
    let r = scan_fixture("next-app", 0);
    insta::assert_snapshot!("next_app_facts", serde_json::to_string_pretty(&r).unwrap());
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let dest = to.join(e.file_name());
        if e.file_type().unwrap().is_dir() {
            copy_dir(&e.path(), &dest);
        } else {
            std::fs::copy(e.path(), dest).unwrap();
        }
    }
}

#[test]
fn root_jsx_of_concise_arrow_bodies_is_a_wrapper() {
    // infisical's `LegacyPkiDeprecationTemplate = (props) => (<BaseEmailWrapper>...)`
    // was not wrapped by its root component: only block bodies were looked at.
    let r = scan_fixture("jsx-roots", 0);
    let f = file(&r, "emails/Templates.tsx");
    let wrapper = "emails/Wrapper.tsx#Wrapper";
    let jsx = |name: &str| -> Vec<String> {
        symbol(f, name)
            .wraps
            .iter()
            .filter(|w| w.kind == WrapKind::Jsx)
            .map(|w| w.wrapper.clone())
            .collect()
    };
    for name in ["Concise", "Bare", "Block", "default"] {
        assert_eq!(jsx(name), [wrapper], "{name}");
        assert!(
            symbol(f, name).renders.contains(&wrapper.to_string()),
            "{name}"
        );
    }
    for name in ["Nested", "Discarded"] {
        assert!(jsx(name).is_empty(), "{name}: {:?}", symbol(f, name).wraps);
    }
    // The wrapper's own root is an intrinsic element: no wrap.
    assert!(
        symbol(file(&r, "emails/Wrapper.tsx"), "Wrapper")
            .wraps
            .is_empty()
    );
}

#[test]
fn package_entries_map_build_output_back_to_sources() {
    // `@acme/ui` names `./dist/index.js` and `./dist/icons/index.d.ts`: what code
    // outside the repository can import is what `src/index.tsx` and
    // `src/icons/index.tsx` export. The private app names none.
    let r = scan_fixture("next-app", 0);
    let ui = r.packages.iter().find(|p| p.name == "@acme/ui").unwrap();
    assert_eq!(
        ui.entries,
        [
            "packages/ui/src/icons/index.tsx",
            "packages/ui/src/index.tsx"
        ]
    );
    let app = r
        .packages
        .iter()
        .find(|p| p.name == "fixture-next-app")
        .unwrap();
    assert!(app.entries.is_empty());
}

#[test]
fn a_function_that_returns_a_wrapped_function_records_its_wrappers() {
    // `return defineJob(async () => ...)`: the returned value's call wrappers, outermost
    // first, as a value's wraps are read. The function itself is not wrapped, and a
    // call to the wrapper anywhere else in its body records nothing.
    let r = scan_fixture("factories", 0);
    let f = file(&r, "jobs/factories.ts");
    let define = "jobs/define.ts#defineJob";
    let trace = "jobs/define.ts#withTrace";
    let returned = |name: &str| symbol(f, name).returns_wrapped_by.clone();
    assert_eq!(returned("makeCronJob"), [define]);
    assert_eq!(returned("makeTracedJob"), [trace, define]);
    for name in ["makeCronJob", "makeTracedJob"] {
        assert!(
            !symbol(f, name)
                .wraps
                .iter()
                .any(|w| w.kind == WrapKind::Call),
            "{name}: {:?}",
            symbol(f, name).wraps
        );
    }
    // A wrapped parameter (`defineJob(handler)`) is not known to be a function, as in a
    // value's wraps; so it records nothing.
    for name in [
        "makeFromHandler",
        "registerLater",
        "notAJob",
        "nested",
        "hourly",
    ] {
        assert!(returned(name).is_empty(), "{name}: {:?}", returned(name));
    }
    // The value is wrapped, as before.
    assert!(
        symbol(f, "hourly")
            .wraps
            .iter()
            .any(|w| w.kind == WrapKind::Call && w.wrapper == define)
    );
}
