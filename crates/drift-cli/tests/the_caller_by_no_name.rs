//! Who calls, by what the code does and never by what anything is called
//! (TypeScript, the listed reading).
//!
//! - **A function of the repository named like an accessor is read by its body.**
//!   `getUser(req)` that hands back the row the request names, and
//!   `getSession(req)` that hands back what the body sent, give no caller: rows
//!   filtered by what they returned are not proven the caller's. One that
//!   verifies the request's credential does, under any name.
//! - **A parameter named for the caller is whatever was passed.** `listFor(user)`
//!   filters by the caller where every call of the route passes one
//!   (`listFor(req.user)`), and by anyone where one passes what the request sent
//!   (`listFor(req.body.user)`); the same under a key of an object
//!   (`listByOptions({ user, limit })`). A callback's parameter is what the list
//!   held, and a name bound out of the body is the body's.
//! - **A wrapper hands its handler what it hands it.** `withUser(handler)` that
//!   calls `handler(req, res, currentUser(req))` gives the handler's third
//!   parameter the caller; `withBodyUser`, which passes `req.body.user` there,
//!   does not, whatever the handler calls it.
//! - **What a keyed store of the file kept is what the file put there.** A
//!   function that memoises the verified claims under their own key gives the
//!   caller; over a store another body fills with what the request sent, or one
//!   the module exports, it does not.

use std::collections::BTreeMap;
use std::process::Command;
use std::sync::LazyLock;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: LazyLock<String> = LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const PACKAGE: &str = r#"{"name":"ts8","dependencies":{"express":"^4","@prisma/client":"^5","jsonwebtoken":"^9"}}
"#;

const DB: &str = r#"import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient();
"#;

const AUTH: &str = r#"import jwt from "jsonwebtoken";
import { db } from "./db";

// Named like an accessor; hands back the row the request names.
export async function getUser(req: any) {
  return db.user.findUnique({ where: { id: req.params.id } });
}

// Named like an accessor; hands back what the body sent.
export function getSession(req: any) {
  return req.body.session;
}

// Named like an accessor; really verifies.
export function currentUser(req: any) {
  const token = req.headers.authorization?.slice(7);
  return jwt.verify(token, process.env.JWT_SECRET!) as { id: string };
}

export function requireAuth(req: any, res: any, next: any) {
  const token = req.headers.authorization?.slice(7);
  if (!token) return res.status(401).end();
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET!);
  } catch {
    return res.status(401).end();
  }
  next();
}

const SEEN = new Map<string, { id: string }>();

// Kept per caller: the store holds, under what was verified, what was verified.
export function getViewer(req: any) {
  const claims = jwt.verify(req.headers.authorization?.slice(7), process.env.JWT_SECRET!) as { id: string };
  const seen = SEEN.get(claims.id);
  if (seen) return seen;
  SEEN.set(claims.id, claims);
  return claims;
}

const ROWS = new Map<string, { id: string }>();

// The same shape, over a store another body fills with what the request sent.
export function getActor(req: any) {
  const claims = jwt.verify(req.headers.authorization?.slice(7), process.env.JWT_SECRET!) as { id: string };
  const row = ROWS.get(claims.id);
  if (row) return row;
  ROWS.set(claims.id, claims);
  return claims;
}

export function remember(req: any) {
  ROWS.set(req.params.id, req.body);
}

// The same shape, over a store any module may fill.
export const SHARED = new Map<string, { id: string }>();

export function getPrincipal(req: any) {
  const claims = jwt.verify(req.headers.authorization?.slice(7), process.env.JWT_SECRET!) as { id: string };
  const kept = SHARED.get(claims.id);
  if (kept) return kept;
  SHARED.set(claims.id, claims);
  return claims;
}
"#;

const APP: &str = r#"import express from "express";
import { db } from "./db";
import { currentUser, getActor, getPrincipal, getSession, getUser, getViewer, remember, requireAuth } from "./auth";

const app = express();
app.use(express.json());
app.use(requireAuth);

app.get("/users/:id/notes", async (req, res) => {
  const user = await getUser(req);
  res.json(await db.note.findMany({ where: { userId: user.id } }));
});

app.get("/session-notes", async (req, res) => {
  const session = getSession(req);
  res.json(await db.note.findMany({ where: { userId: session.userId } }));
});

app.get("/my-notes", async (req, res) => {
  const me = currentUser(req);
  res.json(await db.note.findMany({ where: { userId: me.id } }));
});

app.get("/req-notes", async (req: any, res) => {
  res.json(await db.note.findMany({ where: { userId: req.user.id } }));
});

function listFor(user: { id: string }) {
  return db.note.findMany({ where: { userId: user.id } });
}

app.get("/param-notes", async (req, res) => {
  res.json(await listFor(req.body.user));
});

app.get("/param-notes-own", async (req: any, res) => {
  res.json(await listFor(req.user));
});

// A callback's parameter is whatever the list held, whatever it is called.
app.get("/each-user-notes", async (req, res) => {
  const users = await db.user.findMany();
  res.json(await Promise.all(users.map((user: any) => db.note.findMany({ where: { userId: user.id } }))));
});

// Bound out of what the body sent.
app.post("/bound-notes", async (req, res) => {
  const { user } = req.body;
  res.json(await db.note.findMany({ where: { userId: user.id } }));
});

function listByOptions({ user, limit }: { user: { id: string }; limit: number }) {
  return db.note.findMany({ where: { userId: user.id }, take: limit });
}

app.get("/options-notes", async (req, res) => {
  res.json(await listByOptions({ user: req.body.user, limit: 5 }));
});

app.get("/options-notes-own", async (req: any, res) => {
  res.json(await listByOptions({ user: req.user, limit: 5 }));
});

// A wrapper of the repository that hands its handler the caller it verified.
function withUser(handler: (req: any, res: any, user: { id: string }) => unknown) {
  return (req: any, res: any) => handler(req, res, currentUser(req));
}

app.get(
  "/wrapped-notes",
  withUser(async (req, res, user) => {
    res.json(await db.note.findMany({ where: { userId: user.id } }));
  }),
);

// A wrapper that hands its handler what the body sent under the same name.
function withBodyUser(handler: (req: any, res: any, user: { id: string }) => unknown) {
  return (req: any, res: any) => handler(req, res, req.body.user);
}

app.get(
  "/wrapped-body-notes",
  withBodyUser(async (req, res, user) => {
    res.json(await db.note.findMany({ where: { userId: user.id } }));
  }),
);

app.get("/viewer-notes", async (req, res) => {
  const viewer = getViewer(req);
  res.json(await db.note.findMany({ where: { userId: viewer.id } }));
});

app.get("/actor-notes", async (req, res) => {
  const actor = getActor(req);
  res.json(await db.note.findMany({ where: { userId: actor.id } }));
});

app.post("/remember/:id", (req, res) => {
  remember(req);
  res.end();
});

app.get("/principal-notes", async (req, res) => {
  const principal = getPrincipal(req);
  res.json(await db.note.findMany({ where: { userId: principal.id } }));
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
fn an_accessor_by_name_that_returns_what_the_request_chose_gives_no_caller() {
    // `getUser(req)` hands back the row `req.params.id` names; `getSession(req)`
    // hands back `req.body.session`.
    assert_eq!(said("GET /users/:id/notes"), NOT_PROVEN);
    assert_eq!(said("GET /session-notes"), NOT_PROVEN);
}

#[test]
fn an_accessor_that_verifies_the_credential_gives_the_caller() {
    assert_eq!(said("GET /my-notes"), PROVEN);
    // And what a middleware that verified it bound on the request.
    assert_eq!(said("GET /req-notes"), PROVEN);
}

#[test]
fn a_parameter_named_for_the_caller_is_what_each_call_passes() {
    assert_eq!(said("GET /param-notes-own"), PROVEN);
    assert_eq!(said("GET /param-notes"), NOT_PROVEN);
    // The same under a key of the object the helper is handed.
    assert_eq!(said("GET /options-notes-own"), PROVEN);
    assert_eq!(said("GET /options-notes"), NOT_PROVEN);
}

#[test]
fn a_callbacks_parameter_and_a_name_bound_out_of_the_body_are_no_caller() {
    assert_eq!(said("GET /each-user-notes"), NOT_PROVEN);
    assert_eq!(said("POST /bound-notes"), NOT_PROVEN);
}

#[test]
fn a_wrapper_gives_its_handler_what_it_hands_it() {
    assert_eq!(said("GET /wrapped-notes"), PROVEN);
    // The same handler, under a wrapper that passes what the body sent.
    assert_eq!(said("GET /wrapped-body-notes"), NOT_PROVEN);
}

#[test]
fn a_keyed_store_gives_what_the_file_put_in_it() {
    assert_eq!(said("GET /viewer-notes"), PROVEN);
    // `remember(req)` puts `req.body` under `req.params.id` in the same store.
    assert_eq!(said("GET /actor-notes"), NOT_PROVEN);
    // An exported store is filled by whoever imports it.
    assert_eq!(said("GET /principal-notes"), NOT_PROVEN);
}
