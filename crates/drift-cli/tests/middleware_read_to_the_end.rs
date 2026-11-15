//! A middleware of the repository that turns no one away is read to the end
//! (TypeScript): the routes behind it have no guard, not a guard that is unknown.
//!
//! What stands where a guard goes is the guard, nothing, or unknown, and unknown
//! is the default. Three things a body does kept it unknown though nothing in
//! them can refuse a request that carries no credential:
//!
//! - a method of a plain value the module holds (`const seen = []`, `const cache =
//!   { get(k) { ... } }`), which runs a built-in's method or a function written in
//!   that value;
//! - a method of a local that holds a value of a parameter (`const path =
//!   req.url.split("?")[0]`), which is a method of the parameter's value;
//! - a call that verifies a token, in a branch taken only where the request
//!   carries one (`if (token && ...) { jwt.verify(token, key) }`): a request with
//!   no credential runs past it.
//!
//! A verification every request reaches, one under a test that is no presence of
//! a credential, and a method of a value that answers the request stay what they
//! were.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// Route -> what `drift security` says of its guard: `guarded`, `none`, or
/// `unknown` (something that may guard it was not read).
fn guards(root: &Path) -> BTreeMap<String, &'static str> {
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
    let inv: Value = serde_json::from_slice(&out.stdout).unwrap();
    inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let some = |k: &str| e[k].as_array().is_some_and(|a| !a.is_empty());
            let said = match (some("guards"), some("opaque")) {
                (true, _) => "guarded",
                (false, true) => "unknown",
                (false, false) => "none",
            };
            (e["route"].as_str().unwrap_or_default().to_string(), said)
        })
        .collect()
}

const MIDDLEWARE: &str = r#"import jwt from "jsonwebtoken";

const seen: string[] = [];
const key = process.env.PUBLIC_KEY ?? "";

export const cache = {
  byToken: {} as Record<string, unknown>,
  get(token: string) {
    return this.byToken[token];
  },
  put(token: string, who: unknown) {
    this.byToken[token] = who;
  },
  remember(token: string, who: unknown) {
    this.put(token, who);
  },
};

// Counts what was asked for: a method of a list the module holds, and of a
// value of the request.
export const track = () => (req: any, res: any, next: any) => {
  const path = req.url.split("?")[0].toLowerCase();
  seen.forEach((fragment) => {
    if (path.endsWith(fragment)) {
      seen.push(path);
    }
  });
  next();
};

// Verifies the token of a request that carries one, and remembers who it names.
export const refresh = () => (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (token && cache.get(token) === undefined) {
    const who = jwt.verify(token, key);
    cache.remember(token, who);
  }
  next();
};

// Verifies whatever the request carries: one with no token does not pass.
export const verified = () => (req: any, res: any, next: any) => {
  const who = jwt.verify(req.cookies.token, key);
  cache.put(req.cookies.token, who);
  next();
};

// Verifies where the request carries none: no presence of a credential.
export const backwards = () => (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (!token) {
    jwt.verify(req.query.t, key);
  }
  next();
};

// Verifies where a flag of the request is set.
export const flagged = () => (req: any, res: any, next: any) => {
  if (req.query.strict) {
    jwt.verify(req.cookies.token, key);
  }
  next();
};

const gate = {
  check(req: any, res: any) {
    if (!req.cookies.token) {
      res.status(401).end();
    }
  },
};

// Hands the request to a method of a value that answers it.
export const gated = () => (req: any, res: any, next: any) => {
  gate.check(req, res);
  next();
};
"#;

fn app(uses: &str) -> String {
    format!(
        r#"import express from "express";
import {{ backwards, flagged, gated, refresh, track, verified }} from "./middleware";

const app = express();
{uses}
app.get("/things", (req, res) => {{
  res.json([]);
}});

export default app;
"#
    )
}

fn route(uses: &str) -> &'static str {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in [
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"jsonwebtoken\": \"9.0.2\" } }\n"
                .to_string(),
        ),
        ("src/middleware.ts", MIDDLEWARE.to_string()),
        ("src/server.ts", app(uses)),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    let got = guards(dir.path());
    got.get("/things").unwrap_or_else(|| panic!("{got:?}"))
}

#[test]
fn a_middleware_that_turns_no_one_away_leaves_the_route_with_no_guard() {
    // Nothing before the route at all.
    assert_eq!(route(""), "none");
    // A method of a list the module holds, and of a value of the request.
    assert_eq!(route("app.use(track());"), "none");
    // A token verified only where the request carries one.
    assert_eq!(route("app.use(refresh());"), "none");
    assert_eq!(route("app.use(track());\napp.use(refresh());"), "none");
}

#[test]
fn a_middleware_that_may_turn_a_request_away_is_never_read_as_nothing() {
    // Every request reaches the verification.
    assert_ne!(route("app.use(verified());"), "none");
    // Under a test that is no presence of a credential.
    assert_ne!(route("app.use(backwards());"), "none");
    assert_ne!(route("app.use(flagged());"), "none");
    // The request handed to a method of a value that answers it.
    assert_ne!(route("app.use(gated());"), "none");
}
