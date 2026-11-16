//! What a body bound on the request, and what a method of the repository hands
//! back, read by what the code does (TypeScript, the listed reading).
//!
//! - **A key named for the caller bound to what the request sent is what the
//!   request chose.** A middleware that binds `req.user = req.body.user`, falls
//!   back to it (`req.user = req.user || { id: req.query.as }`), or binds the row
//!   the request names by its own key (`findUnique({ where: { id:
//!   req.headers["x-user-id"] } })`) proves nothing of who calls: a filter by
//!   `req.user.id` in a route it runs around is found, not proven. Only around
//!   the routes it runs for: a route behind a middleware that verifies stays
//!   proven, and so does one behind a lookup by a key the caller was issued
//!   (`where: { key: req.headers["x-api-key"] }`), which is no record key.
//! - **A method named like an accessor is read by its body.** `auth.getUser(req)`
//!   of an object of the repository and `sessions.getSession(req)` of an instance
//!   of one of its classes give the caller where the method's own body does, and
//!   nothing where it hands back a row the request names or what the query
//!   string says.

use std::collections::BTreeMap;
use std::process::Command;
use std::sync::LazyLock;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: LazyLock<String> = LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const PACKAGE: &str = r#"{"name":"ts9","dependencies":{"express":"^4","@prisma/client":"^5","jsonwebtoken":"^9"}}
"#;

const DB: &str = r#"import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient();
"#;

const AUTH: &str = r#"import jwt from "jsonwebtoken";
import { db } from "./db";

// Binds what a header names as the caller: anyone may send the header.
export async function trustHeader(req: any, res: any, next: any) {
  const id = req.headers["x-user-id"];
  if (!id) return res.status(401).end();
  req.user = await db.user.findUnique({ where: { id } });
  next();
}

// Binds what the body sent.
export function trustBody(req: any, res: any, next: any) {
  if (!req.body.user) return res.status(401).end();
  req.user = req.body.user;
  next();
}

// Verifies.
export function verified(req: any, res: any, next: any) {
  const token = req.headers.authorization?.slice(7);
  if (!token) return res.status(401).end();
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET!);
  } catch {
    return res.status(401).end();
  }
  next();
}

export const auth = {
  // A method named like an accessor; hands back the row the request names.
  getUser(req: any) {
    return db.user.findUnique({ where: { id: req.params.id } });
  },
  // Verifies.
  currentUser(req: any) {
    return jwt.verify(req.headers.authorization?.slice(7), process.env.JWT_SECRET!) as { id: string };
  },
};

export class Sessions {
  // A method named like an accessor; hands back what the query string names.
  getSession(req: any) {
    return { userId: req.query.as };
  }
}

// Binds the row a key the caller was issued names: a lookup by a secret.
export async function byApiKey(req: any, res: any, next: any) {
  const key = req.headers["x-api-key"];
  if (!key) return res.status(401).end();
  const row = await db.apiKey.findUnique({ where: { key } });
  if (!row) return res.status(401).end();
  req.user = row.owner;
  next();
}

// Falls back to what the query string names when nothing verified is there.
export function devFallback(req: any, res: any, next: any) {
  req.user = req.user || { id: req.query.as };
  next();
}

export class Tokens {
  // Verifies.
  getUser(req: any) {
    return jwt.verify(req.headers.authorization?.slice(7), process.env.JWT_SECRET!) as { id: string };
  }
}
"#;

const APP: &str = r#"import express from "express";
import { db } from "./db";
import { auth, byApiKey, devFallback, Sessions, Tokens, trustBody, trustHeader, verified } from "./auth";

const app = express();
app.use(express.json());
const sessions = new Sessions();
const tokens = new Tokens();

app.get("/header-notes", trustHeader, async (req: any, res) => {
  res.json(await db.note.findMany({ where: { userId: req.user.id } }));
});

app.get("/body-notes", trustBody, async (req: any, res) => {
  res.json(await db.note.findMany({ where: { userId: req.user.id } }));
});

app.get("/verified-notes", verified, async (req: any, res) => {
  res.json(await db.note.findMany({ where: { userId: req.user.id } }));
});

app.get("/nobody-notes", async (req: any, res) => {
  res.json(await db.note.findMany({ where: { userId: req.user.id } }));
});

app.get("/method-notes/:id", verified, async (req, res) => {
  const user = await auth.getUser(req);
  res.json(await db.note.findMany({ where: { userId: user.id } }));
});

app.get("/method-own-notes", verified, async (req, res) => {
  const user = auth.currentUser(req);
  res.json(await db.note.findMany({ where: { userId: user.id } }));
});

app.get("/class-notes", verified, async (req, res) => {
  const session = sessions.getSession(req);
  res.json(await db.note.findMany({ where: { userId: session.userId } }));
});

app.get("/class-own-notes", verified, async (req, res) => {
  const user = tokens.getUser(req);
  res.json(await db.note.findMany({ where: { userId: user.id } }));
});

app.get("/key-notes", byApiKey, async (req: any, res) => {
  res.json(await db.note.findMany({ where: { userId: req.user.id } }));
});

app.get("/fallback-notes", verified, devFallback, async (req: any, res) => {
  res.json(await db.note.findMany({ where: { userId: req.user.id } }));
});

app.listen(3000);
"#;

static READ: LazyLock<BTreeMap<String, String>> = LazyLock::new(|| {
    let dir = tempfile::tempdir().unwrap();
    let files: [(&str, &str); 4] = [
        ("package.json", PACKAGE),
        ("src/db.ts", DB),
        ("src/auth.ts", AUTH),
        ("src/app.ts", APP),
    ];
    for (rel, text) in &files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    let out = Command::new(&*BIN)
        .args(["--no-cache", "practices", "--json", "--units"])
        .current_dir(dir.path())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let map: Value = serde_json::from_slice(&out.stdout).unwrap();
    let concern = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .cloned()
        .unwrap();
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
                "unknown" => format!(
                    "unknown {} {}",
                    u["reason"].as_str().unwrap_or_default(),
                    u["not_proven"]["obligation"].as_str().unwrap_or_default()
                )
                .trim_end()
                .to_string(),
                other => other.to_string(),
            };
            (
                format!(
                    "{} {}",
                    u["method"].as_str().unwrap_or_default(),
                    u["route"].as_str().unwrap_or_default()
                ),
                said,
            )
        })
        .collect()
});

fn said(route: &str) -> &'static str {
    READ.get(route)
        .unwrap_or_else(|| panic!("{route} is not a unit: {:#?}", *READ))
}

const PROVEN: &str = "known owner_filter:where.userId (session)";
const NOT_PROVEN: &str = "unknown check_not_proven sides_not_caller_and_resource";

#[test]
fn a_key_bound_to_what_the_request_sent_is_no_caller() {
    // `req.user = req.body.user`.
    assert_eq!(said("GET /body-notes"), NOT_PROVEN);
    // `req.user = req.user || { id: req.query.as }`, after a middleware that
    // verifies: the fallback is what a request with no token is given.
    assert_eq!(said("GET /fallback-notes"), NOT_PROVEN);
}

#[test]
fn a_row_the_request_names_by_its_own_key_is_no_caller() {
    assert_eq!(said("GET /header-notes"), NOT_PROVEN);
}

#[test]
fn what_a_verifying_middleware_bound_is_the_caller() {
    // The binders above run around their own routes only.
    assert_eq!(said("GET /verified-notes"), PROVEN);
    // A row found by a key the caller was issued is not one the request names.
    assert_eq!(said("GET /key-notes"), PROVEN);
}

#[test]
fn a_method_named_like_an_accessor_is_read_by_its_body() {
    // Of an object of the repository.
    assert_eq!(said("GET /method-notes/:id"), NOT_PROVEN);
    assert_eq!(said("GET /method-own-notes"), PROVEN);
    // Of an instance of a class of the repository.
    assert_eq!(said("GET /class-notes"), NOT_PROVEN);
    assert_eq!(said("GET /class-own-notes"), PROVEN);
}
