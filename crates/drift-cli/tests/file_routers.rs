//! Routes of file-convention routers other than Next.js (React Router and Remix,
//! SvelteKit, Nuxt's Nitro) and of `@koa/router`, which the last measured build did
//! not list at all: `drift security` had no row for them.
//!
//! They are listed with their path. What runs before one (a parent route, a server
//! hook, a Koa middleware) is not read, so a route with no guard found in its own
//! body reads guard unknown, never "no guard found".

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

/// `METHOD route` -> `guarded`, `unknown` or `none`, as `drift security` says.
fn routes(root: &Path) -> BTreeMap<String, String> {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "security", "--json"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let some = |key: &str| e[key].as_array().is_some_and(|a| !a.is_empty());
            let verdict = match (some("guards"), some("opaque")) {
                (true, _) => "guarded",
                (false, true) => "unknown",
                (false, false) => "none",
            };
            (
                format!(
                    "{} {}",
                    e["method"].as_str().unwrap_or_default(),
                    e["route"].as_str().unwrap_or_default()
                ),
                verdict.to_string(),
            )
        })
        .collect()
}

fn expect(got: &BTreeMap<String, String>, want: &[(&str, &str)]) {
    let want: BTreeMap<String, String> = want
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    assert_eq!(*got, want);
}

#[test]
fn react_router_route_modules_are_listed() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"web\", \"dependencies\": { \"react-router\": \"7.1.0\", \"@react-router/node\": \"7.1.0\" } }\n",
        ),
        (
            "app/routes/notes.$id.tsx",
            "export async function loader({ params }: any) {\n  return { id: params.id };\n}\n\nexport async function action({ request }: any) {\n  return { ok: true };\n}\n\nexport default function Note() {\n  return null;\n}\n",
        ),
        (
            "app/routes/_auth/login.tsx",
            "export async function action({ request }: any) {\n  return { ok: true };\n}\n",
        ),
        (
            "app/utils/misc.ts",
            "export function loader() {\n  return 1;\n}\n",
        ),
    ]);
    expect(
        &routes(dir.path()),
        &[
            ("GET /notes/:id", "unknown"),
            ("POST /login", "unknown"),
            ("POST /notes/:id", "unknown"),
        ],
    );
}

#[test]
fn sveltekit_and_nitro_routes_are_listed() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"web\", \"devDependencies\": { \"@sveltejs/kit\": \"2.0.0\" } }\n",
        ),
        (
            "src/routes/api/items/[id]/+server.ts",
            "export async function GET({ params }: any) {\n  return new Response(params.id);\n}\n",
        ),
        (
            "src/routes/(app)/settings/+page.server.ts",
            "export async function load() {\n  return {};\n}\n",
        ),
    ]);
    expect(
        &routes(dir.path()),
        &[
            ("GET /api/items/:id", "unknown"),
            ("GET /settings", "unknown"),
        ],
    );
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"web\", \"dependencies\": { \"nuxt\": \"3.13.0\" } }\n",
        ),
        (
            "server/api/users/[id].get.ts",
            "export default defineEventHandler(async (event) => {\n  return { id: 1 };\n});\n",
        ),
    ]);
    expect(&routes(dir.path()), &[("GET /api/users/:id", "unknown")]);
}

/// The same file names in a package that is built with none of them list nothing.
#[test]
fn a_package_built_with_none_of_them_lists_nothing() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"lib\", \"dependencies\": { \"lodash\": \"4.17.21\" } }\n",
        ),
        (
            "app/routes/notes.tsx",
            "export async function loader() {\n  return 1;\n}\n",
        ),
        (
            "server/api/users.ts",
            "export default function users() {\n  return 1;\n}\n",
        ),
    ]);
    expect(&routes(dir.path()), &[]);
}

#[test]
fn koa_router_routes_are_listed_with_their_middleware_unread() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"koa\": \"2.15.0\", \"@koa/router\": \"12.0.0\" } }\n",
        ),
        (
            "src/routes.ts",
            "import Router from \"@koa/router\";\n\nexport const router = new Router();\n\nrouter.get(\"/items\", async (ctx, next) => {\n  ctx.body = [];\n});\n\nrouter.post(\"/items\", async (ctx, next) => {\n  ctx.body = {};\n});\n",
        ),
    ]);
    expect(
        &routes(dir.path()),
        &[("GET /items", "unknown"), ("POST /items", "unknown")],
    );
}
