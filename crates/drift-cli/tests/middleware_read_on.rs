//! A middleware is read to the end, and what a route is given last is read
//! (TypeScript).
//!
//! A middleware every request passes was "not followed" as soon as its body did
//! anything the reading had no word for, and every route behind it was unknown.
//! The reading now follows what such a body does, by what each thing is:
//!
//! - a method of the runtime's global object under a name of the module's own
//!   (`const shared = global as ...; shared.io.emit(...)`);
//! - a method of plain data: a local read off it, the items of a loop over it,
//!   what a function that hands back only plain data gave;
//! - a method a class of the repository inherits from a package's class, and a
//!   promise's own method on a call;
//! - a verifying call made only where what another function handed back is
//!   there, where that function hands back a credential the request carries or
//!   nothing;
//! - an asynchronous function nothing waits for, and a `throw` in a function
//!   handed to a promise's method on a chain nothing waits for: what is thrown
//!   there rejects a promise nobody holds;
//! - a method of a parameter given a parameter typed as plain data.
//!
//! Each has a look-alike that can turn a request away, and stays unknown.
//!
//! What a route is given last is a function like those before it: a guard where
//! it is one (`app.get("/users", requireUser())`), the handler's body where the
//! call that built it hands back the function written in it, a function written
//! in place in what a wrapper was handed, and a middleware where it calls its
//! continuation.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// `METHOD route` -> `known`, `none`, or `unknown <reason>`.
fn authn(root: &Path) -> BTreeMap<String, String> {
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
    let concern = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .cloned()
        .unwrap();
    concern["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let said = match u["assignment"].as_str().unwrap() {
                "unknown" => format!("unknown {}", u["reason"].as_str().unwrap_or_default()),
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

const PACKAGE: &str = r#"{ "name": "api", "dependencies": { "express": "4.19.0", "jsonwebtoken": "9.0.0", "sequelize": "6.37.0", "socket.io": "4.7.0" } }
"#;

const MODELS: &str = r#"import { Model } from "sequelize";
export class Visit extends Model {
  declare path: string;
}
export class Ledger extends Model {
  async save(): Promise<this> {
    throw new Error("closed");
  }
}
"#;

const TOKEN: &str = r#"export const tokenOf = ({ headers }: { headers: any }) => {
  if (headers?.authorization) {
    const parts = headers.authorization.split(" ");
    if (parts.length === 2) {
      return parts[1];
    }
  }
  return undefined;
};
export const labelOf = (req: any) => {
  return req.query.label ?? "none";
};
"#;

const AUDIT: &str = r#"import jwt from "jsonwebtoken";
import type { Server } from "socket.io";
import { Visit, Ledger } from "./models";
import { tokenOf, labelOf } from "./token";

const shared = global as typeof globalThis & { io: Server };
const seen: Array<{ at: Date }> = [];

function previous() {
  return seen[seen.length - 1];
}

async function report(path: string) {
  const res = await fetch("https://hooks.example/visit", { method: "POST", body: path });
  if (!res.ok) {
    throw new Error("hook failed");
  }
}

function matches(found: { path: string }, wanted: string | RegExp) {
  return found?.path?.match(wanted);
}

async function tally(path: string) {
  const visit = await Visit.findOne({ where: { path } });
  if (visit === null) {
    throw new Error("no visit");
  }
  await visit.save();
}

function count() {
  Visit.findAndCountAll({ where: { path: "/" } })
    .then(({ count }) => {
      shared.io.emit("visits", count);
    })
    .catch(() => {
      throw new Error("Unable to count");
    });
}

function note(req: any, wanted: string | RegExp) {
  const token = tokenOf(req);
  if (token) {
    const decoded = jwt.decode(token);
    if (decoded === null || typeof decoded === "string") {
      return;
    }
    jwt.verify(token, "key", (err: unknown) => {
      if (err === null && matches(decoded as { path: string }, wanted)) {
        shared.io.emit("known", previous().at.getTime());
      }
    });
  }
}

// Read to the end: nothing here turns a request away.
export const audit = () => (req: any, res: any, next: any) => {
  for (const mark of seen) {
    shared.io.emit("mark", mark.at.getTime());
  }
  report(req.path).catch(() => {});
  void tally(req.path);
  count();
  note(req, /admin/);
  next();
};

// Each of these may turn a request away.
export const awaited = () => async (req: any, res: any, next: any) => {
  await tally(req.path);
  next();
};
export const unconditional = () => (req: any, res: any, next: any) => {
  jwt.verify(tokenOf(req), "key");
  next();
};
export const byLabel = () => (req: any, res: any, next: any) => {
  const label = labelOf(req);
  if (label) {
    jwt.verify(label, "key");
  }
  next();
};
export const ownMethod = () => async (req: any, res: any, next: any) => {
  const ledger = new Ledger();
  await ledger.save();
  next();
};
export const waitedChain = () => async (req: any, res: any, next: any) => {
  await Visit.findAndCountAll({ where: { path: "/" } }).catch(() => {
    throw new Error("Unable to count");
  });
  next();
};
"#;

/// An application whose every request passes the middleware `factory()` builds.
fn behind(factory: &str) -> tempfile::TempDir {
    let server = format!(
        "import express from \"express\";\nimport {{ {factory} }} from \"./audit\";\n\nconst app = express();\napp.use({factory}());\napp.get(\"/open\", (req, res) => {{\n  res.json({{ ok: true }});\n}});\napp.listen(3000);\n"
    );
    write(&[
        ("package.json", PACKAGE),
        ("src/models.ts", MODELS),
        ("src/token.ts", TOKEN),
        ("src/audit.ts", AUDIT),
        ("src/server.ts", &server),
    ])
}

#[test]
fn a_middleware_that_turns_no_one_away_is_read_to_the_end() {
    let dir = behind("audit");
    let said = authn(dir.path());
    assert_eq!(said["GET /open"], "none", "{said:?}");
}

#[test]
fn what_can_turn_a_request_away_is_never_read_as_nothing() {
    for (factory, why) in [
        (
            "awaited",
            "an asynchronous function that throws, waited for",
        ),
        ("unconditional", "a verifying call made for every request"),
        (
            "byLabel",
            "a verifying call under a value that is no credential of the request",
        ),
        ("ownMethod", "a method the repository's own class declares"),
        (
            "waitedChain",
            "a throw in a promise handler on a chain that is waited for",
        ),
    ] {
        let dir = behind(factory);
        let said = authn(dir.path());
        assert!(said["GET /open"].starts_with("unknown"), "{why}: {said:?}");
    }
}

const HANDLERS: &str = r#"import express from "express";
import { expressjwt } from "express-jwt";

const app = express();
const requireUser = () => expressjwt({ secret: process.env.KEY as string, algorithms: ["HS256"] });

function me() {
  return (req: express.Request, res: express.Response) => {
    if (!req.headers.authorization) {
      return res.status(401).end();
    }
    res.json({ ok: true });
  };
}
function open() {
  return (req: express.Request, res: express.Response) => {
    res.json({});
  };
}
function stamp() {
  return (req: any, res: express.Response, next: express.NextFunction) => {
    try {
      req.body.userId = sessions[req.headers.authorization as string].id;
      next();
    } catch (error) {
      res.status(401).json({ error: "unknown session" });
    }
  };
}
const sessions: Record<string, { id: number }> = {};
function wrap(fn: express.RequestHandler) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
function list(req: express.Request, res: express.Response) {
  res.json([]);
}

app.get("/me", me());
app.get("/open", open());
app.get("/users", requireUser());
app.get("/users/:id", requireUser(), open());
app.post("/cards", stamp());
app.get("/wrapped", wrap(list));
app.get(
  "/inline",
  wrap(async (req: express.Request, res: express.Response) => {
    if (!req.headers.authorization) {
      return res.status(401).end();
    }
    res.json({ ok: true });
  }),
);
app.get(
  "/inline-open",
  wrap(async (req: express.Request, res: express.Response) => {
    res.json({ ok: true });
  }),
);
app.listen(3000);
"#;

#[test]
fn what_a_route_is_given_last_is_read_for_what_it_is() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"express-jwt\": \"8.4.1\" } }\n",
        ),
        ("src/server.ts", HANDLERS),
    ]);
    let said = authn(dir.path());
    for (route, want) in [
        // The body of the function the call built answers 401.
        ("GET /me", "known"),
        ("GET /open", "none"),
        // The only thing the route is given is the guard.
        ("GET /users", "known"),
        ("GET /users/:id", "known"),
        // A function written in place in what the wrapper was handed.
        ("GET /inline", "known"),
        ("GET /inline-open", "none"),
        ("GET /wrapped", "none"),
    ] {
        assert_eq!(said[route], want, "{route}: {said:?}");
    }
    // It calls its continuation and answers 401 where reading the session
    // throws: a middleware, which may be the guard. Never none.
    assert!(said["POST /cards"].starts_with("unknown"), "{said:?}");
}

#[test]
fn a_library_guard_is_one_by_each_export_the_lists_read() {
    // express-jwt before version 7 exports the guard as the module itself.
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"express-jwt\": \"0.1.3\" } }\n",
        ),
        (
            "src/security.ts",
            "import expressJwt from \"express-jwt\";\nexport const publicKey = process.env.PUBLIC_KEY as string;\nexport const isAuthorized = () => expressJwt({ secret: publicKey } as any);\n",
        ),
        (
            "src/server.ts",
            "import express from \"express\";\nimport * as security from \"./security\";\n\nconst app = express();\nfunction list(req: express.Request, res: express.Response) {\n  res.json([]);\n}\napp.get(\"/users\", security.isAuthorized());\napp.get(\"/orders\", security.isAuthorized(), list);\napp.get(\"/open\", list);\napp.listen(3000);\n",
        ),
    ]);
    let said = authn(dir.path());
    assert_eq!(said["GET /users"], "known", "{said:?}");
    assert_eq!(said["GET /orders"], "known", "{said:?}");
    assert_eq!(said["GET /open"], "none", "{said:?}");
}
