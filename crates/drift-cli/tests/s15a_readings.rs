//! Readings of the practice map the first wave did not reach (stream S15a),
//! each beside a case that must stay as it was read before.
//!
//! - api: a React Router handler that returns a value is `builder:return_value`
//!   from its facts; one that returns nothing stays unknown.
//! - authn: a header compared whole with an environment value, the body left
//!   where they differ, is unknown, never `service_auth` (F9).
//! - authn: a procedure made from a guarded procedure counts the base's guard.
//! - validation: a procedure that names `input` and never reads it leaves the
//!   population; input handed to a package's call that is no validation library
//!   is unknown, never "reads input, nothing validates it".

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

const ROUTER_PACKAGE: &str =
    "{ \"name\": \"web\", \"dependencies\": { \"react-router\": \"7.1.0\", \"zod\": \"3.23.8\" } }\n";

/// Pins: epic's loaders and actions read unknown `unclassified` for API because
/// the adapter is on no list; now the facts say the router sends what they
/// return. One that returns nothing stays unknown.
#[test]
fn a_router_handler_answers_by_what_it_returns() {
    let dir = write(&[
        ("package.json", ROUTER_PACKAGE),
        (
            "app/routes/notes.ts",
            "export async function loader() {\n  const notes = await Promise.resolve([]);\n  return { notes };\n}\n",
        ),
        (
            "app/routes/ping.ts",
            "export async function action() {\n  await Promise.resolve(1);\n}\n",
        ),
    ]);
    let api = readings(dir.path(), "api");
    assert_eq!(
        of(&api, &["app/routes/notes.ts", "loader"]).as_deref(),
        Some("known builder:return_value"),
        "{api:?}"
    );
    let ping = of(&api, &["app/routes/ping.ts", "action"]).unwrap_or_default();
    assert!(ping.starts_with("unknown"), "{api:?}");
}

/// Pins: epic `admin/cache/sqlite.server.ts` read none for authn; the compare it
/// leaves by may be a sending service's check and is unknown (F9: not
/// `service_auth`, which it read after S15a). A compare with a literal is no such
/// check and is not read as one.
#[test]
fn a_shared_secret_refusal_is_not_proven() {
    let dir = write(&[
        ("package.json", ROUTER_PACKAGE),
        (
            "app/routes/admin.cache.ts",
            r#"import { redirect } from "react-router";

export async function action({ request }: { request: Request }) {
  const token = process.env.INTERNAL_COMMAND_TOKEN;
  const isAuthorized =
    request.headers.get("Authorization") === `Bearer ${token}`;
  if (!isAuthorized) {
    return redirect("/");
  }
  return { ok: true };
}
"#,
        ),
        (
            "app/routes/admin.literal.ts",
            r#"import { redirect } from "react-router";

export async function action({ request }: { request: Request }) {
  const isAuthorized = request.headers.get("Authorization") === "Bearer abc";
  if (!isAuthorized) {
    return redirect("/");
  }
  return { ok: true };
}
"#,
        ),
    ]);
    let authn = readings(dir.path(), "authn");
    // F9: the facts do not show the value is a secret, and a redirect to `/` is
    // no refusal Drift reads: found, not proven. Unknown, never `service_auth`.
    let cache = of(&authn, &["app/routes/admin.cache.ts", "action"]).unwrap_or_default();
    assert!(cache.starts_with("unknown"), "{authn:?}");
    assert!(!cache.contains("service_auth"), "{authn:?}");
    let literal = of(&authn, &["app/routes/admin.literal.ts", "action"]).unwrap_or_default();
    assert!(!literal.contains("service_auth"), "{authn:?}");
}

const TRPC_PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"@trpc/server\": \"10.45.0\", \"zod\": \"3.23.8\", \"left-pad\": \"1.3.0\" } }\n";

const TRPC: &str = r#"import { initTRPC, TRPCError } from "@trpc/server";

const t = initTRPC.context<{ user?: { id: string } }>().create();

export const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});

export const router = t.router;
export const authedProcedure = t.procedure.use(isAuthed);
"#;

/// Pins: cal.com's `createEventPbacProcedure` units read only their own step,
/// apart from the `authedProcedure` practice; the base's guard now counts. A
/// unit on the base itself reads as it did.
#[test]
fn a_derived_procedure_counts_its_base() {
    let dir = write(&[
        ("package.json", TRPC_PACKAGE),
        ("src/trpc.ts", TRPC),
        (
            "src/derived.ts",
            r#"import { TRPCError } from "@trpc/server";
import { authedProcedure } from "./trpc";

export const ownerProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user?.id !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});
"#,
        ),
        (
            "src/router.ts",
            r#"import { router, authedProcedure } from "./trpc";
import { ownerProcedure } from "./derived";

export const appRouter = router({
  mine: authedProcedure.query(() => ({ n: 1 })),
  owned: ownerProcedure.query(() => ({ n: 2 })),
});
"#,
        ),
    ]);
    let authn = readings(dir.path(), "authn");
    let mine = of(&authn, &["src/router.ts", "mine"]).unwrap_or_default();
    let owned = of(&authn, &["src/router.ts", "owned"]).unwrap_or_default();
    assert!(mine.starts_with("known") && mine.contains("isAuthed"), "{authn:?}");
    // The derived procedure carries the base's guard, so it follows the same
    // practice (the uses add up).
    assert!(owned.contains("isAuthed"), "{authn:?}");
}

/// Pins: cal.com `me/procedures/myStats.ts` read "reads input, nothing
/// validates it" though it never reads `input`; it now leaves the validation
/// population. A procedure that hands its input to a package's call that is no
/// validation library reads unknown, never none.
#[test]
fn unread_input_is_out_and_handed_input_is_unknown() {
    let dir = write(&[
        ("package.json", TRPC_PACKAGE),
        ("src/trpc.ts", TRPC),
        (
            "src/procedures.ts",
            r#"import pad from "left-pad";
import { authedProcedure } from "./trpc";
import { statsHandler } from "./statsHandler";

export const myStats = authedProcedure.query(async ({ ctx, input }) => {
  return statsHandler({ ctx });
});

export const padded = authedProcedure.mutation(async ({ input }) => {
  return { out: pad(input as string, 10) };
});
"#,
        ),
        (
            "src/router.ts",
            r#"import { router } from "./trpc";
import { myStats, padded } from "./procedures";

export const appRouter = router({ myStats, padded });
"#,
        ),
        (
            "src/statsHandler.ts",
            "export async function statsHandler(opts: { ctx: unknown }) {\n  return { n: 1 };\n}\n",
        ),
    ]);
    let validation = readings(dir.path(), "validation");
    assert_eq!(
        of(&validation, &["myStats"]),
        None,
        "{validation:?}"
    );
    let padded = of(&validation, &["padded"]).unwrap_or_default();
    assert_eq!(padded, "unknown unclassified", "{validation:?}");
}
