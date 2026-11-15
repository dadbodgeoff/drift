//! Routes of file-convention routers other than Next.js (React Router and Remix,
//! SvelteKit, Nuxt's Nitro) and of `@koa/router`, which the last measured build did
//! not list at all: `drift security` had no row for them.
//!
//! They are listed with their path. What runs before one (a parent route, a server
//! hook, a Koa middleware) is not read, so a route with no guard found in its own
//! body reads guard unknown, never "no guard found". Nothing runs before a React
//! Router or Remix handler but what the package itself puts there (a server of its
//! own, a route middleware): without one, its own body decides.

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
            ("GET /notes/:id", "none"),
            ("POST /login", "none"),
            ("POST /notes/:id", "none"),
        ],
    );
}

const RR_PACKAGE: &str = "{ \"name\": \"web\", \"dependencies\": { \"react-router\": \"7.1.0\", \"@react-router/node\": \"7.1.0\", \"express\": \"4.19.0\" } }\n";

/// A helper that throws for every request with no caller: where a value of the
/// caller is absent it leaves by a `throw`, whatever it throws and wherever a
/// redirect sends them. One that throws where the caller is present, or where a
/// row is absent, refuses no caller.
const RR_AUTH: &str = r#"import { redirect } from "react-router";

declare function sessionOf(request: Request): Promise<{ userId?: string } | null>;
declare function noteOf(id: string): Promise<{ title: string } | null>;

export async function getUserId(request: Request) {
  const session = await sessionOf(request);
  return session?.userId ?? null;
}

export async function requireUserId(request: Request) {
  const userId = await getUserId(request);
  if (!userId) {
    const target = ["/welcome", new URL(request.url).pathname].join("?");
    throw redirect(target);
  }
  return userId;
}

export async function requireAnonymous(request: Request) {
  const userId = await getUserId(request);
  if (userId) {
    throw redirect("/");
  }
}

export async function requireNote(id: string) {
  const note = await noteOf(id);
  if (!note) {
    throw new Response("no such note", { status: 410 });
  }
  return note;
}
"#;

const RR_ROUTES: &[(&str, &str)] = &[
    (
        "app/routes/mine.tsx",
        "import { requireUserId } from \"../utils/auth.server\";\n\nexport async function loader({ request }: any) {\n  const userId = await requireUserId(request);\n  return { userId };\n}\n",
    ),
    (
        "app/routes/join.tsx",
        "import { requireAnonymous } from \"../utils/auth.server\";\n\nexport async function loader({ request }: any) {\n  await requireAnonymous(request);\n  return {};\n}\n",
    ),
    (
        "app/routes/notes.$id.tsx",
        "import { requireNote } from \"../utils/auth.server\";\n\nexport async function loader({ params }: any) {\n  return requireNote(params.id);\n}\n",
    ),
];

#[test]
fn a_react_router_handler_is_guarded_by_what_its_own_body_calls() {
    let mut files = vec![
        ("package.json", RR_PACKAGE),
        ("app/utils/auth.server.ts", RR_AUTH),
    ];
    files.extend_from_slice(RR_ROUTES);
    let dir = write(&files);
    expect(
        &routes(dir.path()),
        &[
            ("GET /join", "none"),
            ("GET /mine", "guarded"),
            ("GET /notes/:id", "none"),
        ],
    );
}

/// A package with a server of its own puts its middleware before every route: a
/// handler that checks nothing has a guard that is unknown, not none.
#[test]
fn a_react_router_package_with_its_own_server_has_its_mounts_unread() {
    let mut files = vec![
        ("package.json", RR_PACKAGE),
        ("app/utils/auth.server.ts", RR_AUTH),
        (
            "server/index.ts",
            "import express from \"express\";\n\nexport const app = express();\napp.use(express.json());\n",
        ),
    ];
    files.extend_from_slice(RR_ROUTES);
    let dir = write(&files);
    let got = routes(dir.path());
    assert_eq!(got["GET /join"], "unknown", "{got:?}");
    assert_eq!(got["GET /notes/:id"], "unknown", "{got:?}");
    assert_ne!(got["GET /mine"], "none", "{got:?}");
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

/// What gives the caller is read from what it does. A function whose every
/// return gives what a lookup made of the request's `Cookie` header gives who
/// calls, or nothing: a helper that throws where it gave nothing turns away
/// every request with no caller. A function that looks up what the URL names
/// gives a row, and one that returns before its test lets requests through that
/// passed none.
const RR_CREDENTIAL: &str = r#"import { redirect } from "react-router";

declare const store: { open(cookie: string | null): Promise<{ get(key: string): string | undefined }> };
declare const db: {
  seat: { findUnique(q: unknown): Promise<{ holder: string } | null> };
  draft: { findUnique(q: unknown): Promise<{ title: string } | null> };
};

export async function whoIs(request: Request) {
  const jar = await store.open(request.headers.get("cookie"));
  const seatId = jar.get("seat");
  if (!seatId) return null;
  const seat = await db.seat.findUnique({ where: { id: seatId } });
  return seat?.holder ?? null;
}

export async function mustBeSeated(request: Request) {
  const holder = await whoIs(request);
  if (holder == null) {
    throw redirect("/");
  }
  return holder;
}

export async function draftOf(request: Request) {
  const id = new URL(request.url).searchParams.get("draft");
  if (!id) return null;
  return db.draft.findUnique({ where: { id } });
}

export async function mustHaveDraft(request: Request) {
  const draft = await draftOf(request);
  if (!draft) {
    throw redirect("/drafts");
  }
  return draft;
}

export async function seatedUnlessPreview(request: Request) {
  if (new URL(request.url).searchParams.has("preview")) return null;
  const holder = await whoIs(request);
  if (!holder) {
    throw redirect("/");
  }
  return holder;
}
"#;

#[test]
fn what_gives_the_caller_is_read_from_the_credential_it_looks_up() {
    let route = |helper: &str| {
        format!(
            "import {{ {helper} }} from \"../utils/seat.server\";\n\nexport async function loader({{ request }}: any) {{\n  const got = await {helper}(request);\n  return {{ got }};\n}}\n"
        )
    };
    let (seated, draft, preview, asked) = (
        route("mustBeSeated"),
        route("mustHaveDraft"),
        route("seatedUnlessPreview"),
        route("whoIs"),
    );
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"web\", \"dependencies\": { \"react-router\": \"7.1.0\", \"@react-router/node\": \"7.1.0\" } }\n",
        ),
        ("app/utils/seat.server.ts", RR_CREDENTIAL),
        ("app/routes/seated.tsx", &seated),
        ("app/routes/draft.tsx", &draft),
        ("app/routes/preview.tsx", &preview),
        ("app/routes/asked.tsx", &asked),
    ]);
    let got = routes(dir.path());
    assert_eq!(got["GET /seated"], "guarded", "{got:?}");
    // A row the URL names is no caller.
    assert_eq!(got["GET /draft"], "none", "{got:?}");
    // Asking who calls turns no one away.
    assert_eq!(got["GET /asked"], "none", "{got:?}");
    // Some requests leave before the test: never a guard.
    assert_ne!(got["GET /preview"], "guarded", "{got:?}");
}
