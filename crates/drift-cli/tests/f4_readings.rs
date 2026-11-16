//! Practice-map readings a review found to credit what does not stop the request
//! (stream F4), each read end to end through `drift practices`.
//!
//! - validation: a package call that is no validation library, handed the
//!   request's data and a value parsed with zod (`jwt.sign(body, env.SECRET)`),
//!   is found beside a schema and not proven: unknown, never `schema:zod`.
//! - authn: a middleware that hands the request on with `next(null)` where the
//!   caller is absent signs no one in.
//! - authn: a procedure whose own steps were not read is unknown, never open,
//!   though a procedure made from it is proven a guard.

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

const EXPRESS_PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.2\", \"jsonwebtoken\": \"9.0.2\", \"zod\": \"3.23.8\" } }\n";

/// Pins row 2 of the review: `jwt.sign({ id: req.body.id }, env.JWT_SECRET)`,
/// with `env` parsed by zod, read `schema:zod` (a validated route). The callee
/// is no validation library: unknown `unclassified` now.
#[test]
fn a_package_call_beside_a_parsed_value_validates_nothing() {
    let dir = write(&[
        ("package.json", EXPRESS_PACKAGE),
        (
            "src/env.ts",
            r#"import { z } from "zod";

export const env = z.object({ JWT_SECRET: z.string() }).parse(process.env);
"#,
        ),
        (
            "src/app.ts",
            r#"import express from "express";
import jwt from "jsonwebtoken";
import { env } from "./env";

const app = express();

app.post("/token", (req, res) => {
  res.json({ token: jwt.sign({ id: req.body.id }, env.JWT_SECRET) });
});

export default app;
"#,
        ),
    ]);
    let validation = readings(dir.path(), "validation");
    let token = of(&validation, &["src/app.ts"]);
    assert!(token.is_some(), "{validation:?}");
    let token = token.unwrap_or_default();
    assert!(!token.contains("schema:zod"), "{validation:?}");
    assert!(token.starts_with("unknown"), "{validation:?}");
}

/// Pins row 1 of the review, end to end: `if (!req.user) return next(null)`
/// hands the request on; the route it guards signs no one in.
#[test]
fn a_continuation_handed_null_signs_no_one_in() {
    let dir = write(&[
        ("package.json", EXPRESS_PACKAGE),
        (
            "src/mw.ts",
            r#"export function requireUser(req: any, res: any, next: any) {
  if (!req.user) {
    return next(null);
  }
  next();
}
"#,
        ),
        (
            "src/app.ts",
            r#"import express from "express";
import { requireUser } from "./mw";

const app = express();

app.get("/me", requireUser, (req: any, res: any) => {
  res.json({ id: req.user.id });
});

export default app;
"#,
        ),
    ]);
    let authn = readings(dir.path(), "authn");
    let me = of(&authn, &["src/app.ts"]);
    assert!(me.is_some(), "{authn:?}");
    assert!(!me.unwrap_or_default().starts_with("known"), "{authn:?}");
}

const TRPC_PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"@trpc/server\": \"10.45.0\", \"@acme/session\": \"1.0.0\" } }\n";

const TRPC: &str = r#"import { initTRPC, TRPCError } from "@trpc/server";
import { sessionOf } from "@acme/session";

const t = initTRPC.context<{ user?: { id: string; admin: boolean } }>().create();

export const isAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});

export const router = t.router;
export const sessionProcedure = t.procedure.use(sessionOf);
export const adminProcedure = sessionProcedure.use(isAdmin);
"#;

/// Pins the later stream's `unguarded_base`: a procedure whose own step was not
/// read (`t.procedure.use(sessionOf)` of a package) was read as open because a
/// procedure made from it is proven a guard; that step may sign in. It is not
/// open now.
#[test]
fn a_base_with_unread_steps_is_not_open() {
    let dir = write(&[
        ("package.json", TRPC_PACKAGE),
        ("src/trpc.ts", TRPC),
        (
            "src/router.ts",
            r#"import { router, sessionProcedure, adminProcedure } from "./trpc";

export const appRouter = router({
  mine: sessionProcedure.query(() => ({ n: 1 })),
  all: adminProcedure.query(() => ({ n: 2 })),
});
"#,
        ),
    ]);
    let authn = readings(dir.path(), "authn");
    let mine = of(&authn, &["mine"]);
    assert!(mine.is_some(), "{authn:?}");
    assert!(!mine.unwrap_or_default().contains("opens"), "{authn:?}");
}
