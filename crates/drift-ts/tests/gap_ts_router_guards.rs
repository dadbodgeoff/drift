//! The facts the reading of guards before Koa, SvelteKit and Nitro routes rests on
//! (`drift-cli/tests/gap_ts_router_guards.rs` pins the verdicts `drift security`
//! makes of them):
//!
//! - a Koa middleware's `ctx.throw(401)` leaves the function, so its check is not
//!   swallowed, and `ctx.status = 401` before a `return` is a check;
//! - a SvelteKit hook that tests the path is lowered once per way the test comes
//!   out, and each route's mount holds the view its path makes;
//! - a `+layout.server` load stands before a page's load, never before a
//!   `+server` endpoint below it;
//! - a Nitro server middleware stands before every route, and a hook whose path
//!   test is not read stands as unread.
//!
//! All of it is in the listed reading only ([`RepoFacts::listed`]): mining's
//! reading is left as it was, which the Koa test pins too.

use std::fs;
use std::path::Path;

use drift_core::{CheckOutcome, FileFacts, RepoFacts, Symbol};
use drift_ts::{ScanOptions, scan};

/// The facts of the repository written from `files`, in the listed reading.
fn repo(files: &[(&str, &str)]) -> RepoFacts {
    measured(files).into_listed()
}

/// The facts of the repository written from `files`, as mining reads them.
fn measured(files: &[(&str, &str)]) -> RepoFacts {
    let dir = tempfile::tempdir().expect("tempdir");
    for (path, text) in files {
        let p = dir.path().join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
    scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
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
        .unwrap_or_else(|| {
            let names: Vec<&str> = f.symbols.iter().map(|s| s.name.as_str()).collect();
            panic!("{name} not in {}: {names:?}", f.path)
        })
}

/// What the mount of `symbol` in `f` runs before it.
fn before<'a>(f: &'a FileFacts, symbol: &str) -> Vec<&'a str> {
    f.mounts
        .iter()
        .filter(|m| m.symbol == symbol)
        .flat_map(|m| m.app_middleware.iter().map(String::as_str))
        .collect()
}

fn refuses_unconditionally(s: &Symbol) -> bool {
    s.body_checks
        .iter()
        .any(|c| matches!(c.outcome, CheckOutcome::Unauthenticated) && !c.conditional)
}

#[test]
fn a_koa_refusal_leaves_the_middleware() {
    let files = [
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"koa\": \"2.15.0\" } }",
        ),
        (
            "src/auth.ts",
            "export async function requireUser(ctx: any, next: any) {\n  if (!ctx.state.user) {\n    ctx.throw(401, \"sign in\");\n  }\n  await next();\n}\n\nexport async function requireSession(ctx: any, next: any) {\n  if (!ctx.cookies.get(\"sid\")) {\n    ctx.status = 401;\n    return;\n  }\n  await next();\n}\n",
        ),
    ];
    let r = repo(&files);
    let f = file(&r, "src/auth.ts");
    assert!(refuses_unconditionally(symbol(f, "requireUser")));
    assert!(refuses_unconditionally(symbol(f, "requireSession")));
    // Mining reads neither as a refusal that leaves: it is frozen.
    let m = measured(&files);
    let f = file(&m, "src/auth.ts");
    assert!(!refuses_unconditionally(symbol(f, "requireUser")));
    assert!(!refuses_unconditionally(symbol(f, "requireSession")));
}

const SVELTE_HOOKS: &str = r#"import { redirect, type Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/admin") && !event.locals.user) {
    redirect(303, "/login");
  }
  return resolve(event);
};
"#;

#[test]
fn a_sveltekit_hook_is_given_in_the_view_the_route_makes() {
    let r = repo(&[
        (
            "package.json",
            "{ \"name\": \"web\", \"devDependencies\": { \"@sveltejs/kit\": \"2.5.0\" } }",
        ),
        ("src/hooks.server.ts", SVELTE_HOOKS),
        (
            "src/routes/admin/+server.ts",
            "export async function GET() {\n  return new Response(\"x\");\n}\n",
        ),
        (
            "src/routes/about/+server.ts",
            "export async function GET() {\n  return new Response(\"x\");\n}\n",
        ),
        (
            "src/routes/account/+layout.server.ts",
            "export async function load({ locals }: any) {\n  return { user: locals.user };\n}\n",
        ),
        (
            "src/routes/account/me/+page.server.ts",
            "export async function load() {\n  return {};\n}\n",
        ),
        (
            "src/routes/account/me/export/+server.ts",
            "export async function GET() {\n  return new Response(\"x\");\n}\n",
        ),
    ]);
    let hooks = file(&r, "src/hooks.server.ts");
    let under = symbol(hooks, "handle where path starts with /admin");
    let outside = symbol(hooks, "handle where path does not start with /admin");
    assert!(
        refuses_unconditionally(under)
            || under
                .body_checks
                .iter()
                .any(|c| matches!(c.outcome, CheckOutcome::SignInRedirect) && !c.conditional),
        "{under:?}"
    );
    assert!(outside.body_checks.is_empty(), "{outside:?}");
    assert_eq!(
        before(file(&r, "src/routes/admin/+server.ts"), "GET"),
        ["src/hooks.server.ts#handle where path starts with /admin"]
    );
    assert_eq!(
        before(file(&r, "src/routes/about/+server.ts"), "GET"),
        ["src/hooks.server.ts#handle where path does not start with /admin"]
    );
    // The layout's load before the page's, not before the endpoint below it.
    assert!(
        before(file(&r, "src/routes/account/me/+page.server.ts"), "load")
            .contains(&"src/routes/account/+layout.server.ts#load")
    );
    assert!(
        !before(file(&r, "src/routes/account/me/export/+server.ts"), "GET")
            .iter()
            .any(|h| h.contains("+layout.server"))
    );
}

#[test]
fn a_nitro_middleware_stands_before_every_route_or_is_unread() {
    let r = repo(&[
        (
            "package.json",
            "{ \"name\": \"web\", \"dependencies\": { \"nuxt\": \"3.13.0\" } }",
        ),
        (
            "server/middleware/auth.ts",
            "export default defineEventHandler((event) => {\n  if (!event.context.user) {\n    throw createError({ statusCode: 401 });\n  }\n});\n",
        ),
        (
            "server/middleware/odd.ts",
            "export default defineEventHandler((event) => {\n  if (event.path.includes(\"/admin\")) {\n    throw createError({ statusCode: 401 });\n  }\n});\n",
        ),
        (
            "server/api/items.get.ts",
            "export default defineEventHandler(() => ({ ok: 1 }));\n",
        ),
    ]);
    let got = before(file(&r, "server/api/items.get.ts"), "default");
    assert_eq!(got.len(), 2, "{got:?}");
    assert_eq!(got[0], "server/middleware/auth.ts#default");
    assert!(got[1].starts_with("global#a hook that tests"), "{got:?}");
}
