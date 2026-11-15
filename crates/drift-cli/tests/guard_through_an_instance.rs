//! A guard given through an instance (TypeScript and JavaScript): `const session
//! = new Session(db)`, then `app.get("/x", session.required, handler)`.
//!
//! What stood there was a member of a binding, or of a local of the function that
//! registers the routes, and was not read: every such route had a guard that was
//! unknown. It is now read as the method of the class the instance is made from,
//! by that method's own body:
//!
//! - an instance the module builds from a class of the repository and nothing
//!   else, and a binding that holds a member of one;
//! - an instance a function builds in a `const` at the top of its body, and a
//!   `const` that holds a member of one, where the function registers routes;
//! - a function a constructor function assigns on `this` at the top of its body
//!   (`function Session(db) { this.required = (req, res, next) => { ... } }`),
//!   through `require` as through an import.
//!
//! A method that refuses no one leaves the route with no guard; one that refuses
//! some requests only, an instance held in a `let`, and a member a constructor
//! assigns twice stay unknown.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// Route -> `guarded`, `none`, or `unknown` (something that may guard it was not
/// read), as `drift security` says.
fn guards(files: &[(&str, &str)]) -> BTreeMap<String, &'static str> {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    inventory(dir.path())
}

fn inventory(root: &Path) -> BTreeMap<String, &'static str> {
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

const PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n";

const SESSION: &str = r#"export class Session {
  constructor(private db: any) {}
  required = (req: any, res: any, next: any) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  };
  check(req: any, res: any, next: any) {
    if (!req.session.userId) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  }
  log(req: any, res: any, next: any) {
    console.log(req.url);
    next();
  }
  strict(req: any, res: any, next: any) {
    if (req.query.strict && !req.session.userId) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  }
}
"#;

#[test]
fn a_method_of_an_instance_the_module_builds_is_read_by_its_class() {
    let got = guards(&[
        ("package.json", PACKAGE),
        ("src/session.ts", SESSION),
        (
            "src/server.ts",
            r#"import express from "express";
import { Session } from "./session";

const app = express();
const session = new Session({});
const need = session.check;
let later = new Session({});

app.get("/property", session.required, (req, res) => { res.json({}); });
app.get("/method", session.check, (req, res) => { res.json({}); });
app.get("/alias", need, (req, res) => { res.json({}); });
app.get("/log", session.log, (req, res) => { res.json({}); });
app.get("/strict", session.strict, (req, res) => { res.json({}); });
app.get("/later", later.check, (req, res) => { res.json({}); });
app.get("/open", (req, res) => { res.json({}); });

export default app;
"#,
        ),
    ]);
    assert_eq!(got["/property"], "guarded", "{got:?}");
    assert_eq!(got["/method"], "guarded", "{got:?}");
    assert_eq!(got["/alias"], "guarded", "{got:?}");
    // The method refuses no one: nothing stands before the route.
    assert_eq!(got["/log"], "none", "{got:?}");
    assert_eq!(got["/open"], "none", "{got:?}");
    // It refuses where the request asks it to: not every request without identity.
    assert_eq!(got["/strict"], "unknown", "{got:?}");
    // A binding that may be given another value.
    assert_ne!(got["/later"], "guarded", "{got:?}");
    assert_ne!(got["/later"], "none", "{got:?}");
}

#[test]
fn a_method_of_an_instance_a_function_builds_is_read_where_it_registers_routes() {
    let got = guards(&[
        ("package.json", PACKAGE),
        ("src/session.ts", SESSION),
        (
            "src/server.ts",
            r#"import express from "express";
import { Session } from "./session";

const app = express();

export function routes(router: express.Router, db: any) {
  const session = new Session(db);
  const loggedIn = session.check;
  let later = new Session(db);
  router.get("/alias", loggedIn, (req, res) => { res.json({}); });
  router.get("/member", session.required, (req, res) => { res.json({}); });
  router.get("/log", session.log, (req, res) => { res.json({}); });
  router.get("/later", later.check, (req, res) => { res.json({}); });
}
routes(app, {});

export default app;
"#,
        ),
    ]);
    assert_eq!(got["/alias"], "guarded", "{got:?}");
    assert_eq!(got["/member"], "guarded", "{got:?}");
    assert_eq!(got["/log"], "none", "{got:?}");
    assert_eq!(got["/later"], "unknown", "{got:?}");
}

#[test]
fn a_function_a_constructor_assigns_on_this_is_read_through_require() {
    let got = guards(&[
        ("package.json", PACKAGE),
        (
            "app/session.js",
            r#"function SessionHandler(db) {
    "use strict";

    this.isLoggedIn = (req, res, next) => {
        if (req.session.userId) {
            return next();
        }
        return res.redirect("/login");
    };

    this.count = (req, res, next) => {
        console.log(req.url);
        return next();
    };

    this.twice = (req, res, next) => {
        if (req.session.userId) {
            return next();
        }
        return res.redirect("/login");
    };
    this.twice = (req, res, next) => next();
}

module.exports = SessionHandler;
"#,
        ),
        (
            "app/routes.js",
            r#"const SessionHandler = require("./session");

const index = (app, db) => {
    "use strict";

    const sessionHandler = new SessionHandler(db);
    const isLoggedIn = sessionHandler.isLoggedIn;

    app.get("/dashboard", isLoggedIn, (req, res) => { res.json({}); });
    app.get("/profile", sessionHandler.isLoggedIn, (req, res) => { res.json({}); });
    app.get("/counted", sessionHandler.count, (req, res) => { res.json({}); });
    app.get("/twice", sessionHandler.twice, (req, res) => { res.json({}); });
    app.get("/login", (req, res) => { res.json({}); });
};

module.exports = index;
"#,
        ),
        (
            "server.js",
            r#"const express = require("express");
const routes = require("./app/routes");

const app = express();
routes(app, {});
app.listen(4000);
"#,
        ),
    ]);
    assert_eq!(got["/dashboard"], "guarded", "{got:?}");
    assert_eq!(got["/profile"], "guarded", "{got:?}");
    assert_eq!(got["/counted"], "none", "{got:?}");
    assert_eq!(got["/login"], "none", "{got:?}");
    // Assigned twice: which function the member holds is not said.
    assert_eq!(got["/twice"], "unknown", "{got:?}");
}
