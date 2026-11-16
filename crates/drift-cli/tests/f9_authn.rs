//! Authentication readings a review found to credit what Drift cannot prove
//! (stream F9), read end to end through `drift practices --units`.
//!
//! - authn: a request header compared with an environment value, the body
//!   refusing where they differ, is unknown, never `service_auth` (the value may
//!   be public: an `Origin` compared with the app's URL).
//! - authn: a base built by a function of the repository (`makeProcedure()`,
//!   which may add the guard) leaves the guard position unknown, never `opens`.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// `path symbol` of each unit of `concern` -> `known <key>`, `none`, or
/// `unknown <reason>`.
fn readings(root: &Path, concern: &str) -> BTreeMap<String, String> {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "practices", "--json", "--units"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let map: Value = serde_json::from_slice(&out.stdout).unwrap();
    let Some(concern) = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == concern)
        .cloned()
    else {
        return BTreeMap::new();
    };
    let variants: Vec<Value> = concern["variants"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|v| {
            std::iter::once(v.clone())
                .chain(v["alternatives"].as_array().into_iter().flatten().cloned())
        })
        .collect();
    concern["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let said = match u["assignment"].as_str().unwrap() {
                "known" => {
                    let key = u["key"]
                        .as_str()
                        .or_else(|| {
                            variants
                                .iter()
                                .find(|v| v["id"] == u["variant"])
                                .and_then(|v| v["key"].as_str())
                        })
                        .unwrap_or_default();
                    format!("known {key}")
                }
                "none" => "none".to_string(),
                _ => format!("unknown {}", u["reason"].as_str().unwrap_or_default()),
            };
            let name = format!(
                "{} {}",
                u["path"].as_str().unwrap_or_default(),
                u["symbol"].as_str().unwrap_or_default()
            );
            (name, said)
        })
        .collect()
}

/// The reading of the one unit whose `path symbol` contains every part.
fn of(units: &BTreeMap<String, String>, parts: &[&str]) -> Option<String> {
    units
        .iter()
        .find(|(k, _)| parts.iter().all(|p| k.contains(p)))
        .map(|(_, v)| v.clone())
}

fn write(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    dir
}

const NEXT_PACKAGE: &str = "{ \"name\": \"web\", \"dependencies\": { \"next\": \"14.2.3\" } }\n";

/// Pins: an `Origin` check against the app's URL read `known
/// service_auth:header:origin` after S15a, so a route no credential guards counted
/// as authenticated. It is not `service_auth` now.
#[test]
fn an_origin_compared_with_an_environment_value_is_not_service_auth() {
    let dir = write(&[
        ("package.json", NEXT_PACKAGE),
        (
            "app/api/hook/route.ts",
            r#"export async function POST(request: Request) {
  if (request.headers.get("origin") !== process.env.APP_URL) {
    return new Response(null, { status: 403 });
  }
  return Response.json({ ok: true });
}
"#,
        ),
    ]);
    let authn = readings(dir.path(), "authn");
    let post = of(&authn, &["app/api/hook/route.ts", "POST"]).unwrap_or_default();
    assert!(!post.contains("service_auth"), "{authn:?}");
}

const TRPC_PACKAGE: &str =
    "{ \"name\": \"api\", \"dependencies\": { \"@trpc/server\": \"10.45.0\" } }\n";

/// Pins: `const base = makeProcedure()` (a function of the repository, which may
/// add the guard), `publicProcedure = base`, `adminProcedure =
/// publicProcedure.use(isAdmin)` (proven): the base was read as adding no step,
/// so every route on `publicProcedure` read `opens`. What `makeProcedure` builds
/// is not read: the route is not `opens`.
#[test]
fn a_factory_built_base_leaves_the_guard_unknown() {
    let dir = write(&[
        ("package.json", TRPC_PACKAGE),
        (
            "src/trpc.ts",
            r#"import { initTRPC, TRPCError } from "@trpc/server";

const t = initTRPC.context<{ user?: { id: string } }>().create();

export const router = t.router;

export const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});

export function makeProcedure() {
  return t.procedure.use(isAuthed);
}

const base = makeProcedure();

export const publicProcedure = base;

export const adminProcedure = publicProcedure.use(isAuthed);
"#,
        ),
        (
            "src/router.ts",
            r#"import { router, publicProcedure, adminProcedure } from "./trpc";

export const appRouter = router({
  list: publicProcedure.query(() => ({ n: 1 })),
  admin: adminProcedure.query(() => ({ n: 2 })),
});
"#,
        ),
    ]);
    let authn = readings(dir.path(), "authn");
    let list = of(&authn, &["src/router.ts", "list"]).unwrap_or_default();
    assert!(!list.contains("opens"), "{authn:?}");
}
