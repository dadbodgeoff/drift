//! Routes a function registers on a router of the module without being handed it
//! (`function setup() { app.get(...) }`, `ready.then(() => { ... })`), routes the
//! module registers under a condition, and routes of a function whose parameter a
//! call in the file hands a router, whatever the parameter's type says. The last
//! measured build listed none of them, so `drift security` did not know they were
//! served.
//!
//! The rule for their guards: what the function registers before a route, in the
//! order written, runs before it. What is registered on the router anywhere else
//! may run before it or not, depending on when the function is called: the route's
//! guard is then unknown, never "no guard found". And a route the module registers
//! itself, on a router a function registers a middleware on, is unknown the same
//! way.

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

fn drift(root: &Path, args: &[&str]) -> Value {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

/// What `drift security` says of each route: `guarded by <names>`, `unknown` (a
/// guard that is not read) or `none`.
fn routes(root: &Path) -> BTreeMap<String, String> {
    let v = drift(root, &["security", "--json"]);
    v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let names = |key: &str| -> Vec<String> {
                e[key]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|g| g.as_str().map(String::from))
                    .collect()
            };
            let (guards, opaque) = (names("guards"), names("opaque"));
            let verdict = match (guards.is_empty(), opaque.is_empty()) {
                (false, _) => format!("guarded by {}", guards.join(", ")),
                (true, false) => "unknown".to_string(),
                (true, true) => "none".to_string(),
            };
            (
                format!(
                    "{} {}",
                    e["method"].as_str().unwrap_or_default(),
                    e["route"].as_str().unwrap_or_default()
                ),
                verdict,
            )
        })
        .collect()
}

fn verdicts(files: &[(&str, &str)]) -> BTreeMap<String, String> {
    let dir = write(files);
    routes(dir.path())
}

fn expect(got: &BTreeMap<String, String>, want: &[(&str, &str)]) {
    let want: BTreeMap<String, String> = want
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    assert_eq!(*got, want);
}

const PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n";

const AUTH: &str = r#"import { Request, Response, NextFunction } from "express";

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) {
    res.status(401).json({ error: "sign in" });
    return;
  }
  next();
}
"#;

#[test]
fn a_function_that_registers_on_the_modules_router_lists_its_routes() {
    let got = verdicts(&[
        ("package.json", PACKAGE),
        ("src/auth.ts", AUTH),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireUser } from "./auth";

const app = express();

function routes() {
  app.get("/open", (req, res) => { res.json({}); });
  app.use(requireUser);
  app.get("/closed", (req, res) => { res.json({}); });
  app.get("/inline", requireUser, (req, res) => { res.json({}); });
}

routes();
app.listen(3000);
"#,
        ),
    ]);
    // In the order the function registers them: `/open` is registered before the
    // guard and `/closed` after it.
    expect(
        &got,
        &[
            ("GET /closed", "guarded by requireUser"),
            ("GET /inline", "guarded by requireUser"),
            ("GET /open", "none"),
        ],
    );
}

#[test]
fn a_callback_and_a_condition_list_their_routes() {
    let got = verdicts(&[
        ("package.json", PACKAGE),
        ("src/auth.ts", AUTH),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireUser } from "./auth";

const app = express();
declare function ready(): Promise<void>;

ready().then(() => {
  app.get("/then", requireUser, (req, res) => { res.json({}); });
});

if (process.env.DEBUG_ROUTES) {
  app.get("/debug", (req, res) => { res.json({}); });
}

try {
  app.post("/tried", requireUser, (req, res) => { res.json({}); });
} catch {
  // ignored
}
"#,
        ),
    ]);
    expect(
        &got,
        &[
            ("GET /debug", "none"),
            ("GET /then", "guarded by requireUser"),
            ("POST /tried", "guarded by requireUser"),
        ],
    );
}

/// What the module registers on the router may run before a route a function
/// registers, or not: the function may be called before the middleware is added.
#[test]
fn a_guard_registered_elsewhere_leaves_the_functions_routes_unknown() {
    let got = verdicts(&[
        ("package.json", PACKAGE),
        ("src/auth.ts", AUTH),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireUser } from "./auth";

const app = express();

function routes() {
  app.get("/late", (req, res) => { res.json({}); });
  app.get("/own", requireUser, (req, res) => { res.json({}); });
}

app.use(requireUser);
routes();
"#,
        ),
    ]);
    assert_eq!(got["GET /late"], "unknown");
    assert_eq!(got["GET /own"], "guarded by requireUser");
}

/// And the other way: a middleware a function registers may run before a route the
/// module registers itself.
#[test]
fn a_guard_a_function_registers_leaves_the_modules_routes_unknown() {
    let got = verdicts(&[
        ("package.json", PACKAGE),
        ("src/auth.ts", AUTH),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireUser } from "./auth";

const app = express();

function secure() {
  app.use(requireUser);
}

secure();
app.get("/items", (req, res) => { res.json({}); });
"#,
        ),
    ]);
    expect(&got, &[("GET /items", "unknown")]);
}

/// A middleware that never authenticates (a logger, a body parser), registered
/// anywhere, is no guard of any route: it leaves nothing unknown.
#[test]
fn what_never_authenticates_leaves_nothing_unknown() {
    let got = verdicts(&[
        ("package.json", PACKAGE),
        (
            "src/server.ts",
            r#"import express from "express";
import morgan from "morgan";

const app = express();

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}
app.use(express.json());

function routes() {
  app.get("/items", (req, res) => { res.json({}); });
}

routes();
app.get("/health", (req, res) => { res.json({}); });
"#,
        ),
    ]);
    expect(&got, &[("GET /health", "none"), ("GET /items", "none")]);
}

/// A parameter a call in the file hands a router is one, whatever its type says.
#[test]
fn a_parameter_handed_a_router_is_one() {
    let got = verdicts(&[
        ("package.json", PACKAGE),
        ("src/auth.ts", AUTH),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireUser } from "./auth";

const app = express();

function configure(app: ReturnType<typeof express>, name: string) {
  app.get("/typed-by-return", (req, res) => { res.json({ name }); });
  app.use(requireUser);
  app.get("/after-guard", (req, res) => { res.json({}); });
}

export function register(server: express.Express) {
  server.get("/qualified", (req, res) => { res.json({}); });
}

configure(app, "api");
"#,
        ),
    ]);
    expect(
        &got,
        &[
            ("GET /after-guard", "guarded by requireUser"),
            ("GET /qualified", "none"),
            ("GET /typed-by-return", "none"),
        ],
    );
}

/// A route a function registers on a router another file mounts is under that
/// mount's path and behind its middleware, as the router's other routes are.
#[test]
fn a_functions_route_is_mounted_as_its_router_is() {
    let got = verdicts(&[
        ("package.json", PACKAGE),
        ("src/auth.ts", AUTH),
        (
            "src/items.ts",
            r#"import { Router } from "express";

export const items = Router();

function routes() {
  items.get("/list", (req, res) => { res.json([]); });
}

routes();
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireUser } from "./auth";
import { items } from "./items";

const app = express();
app.use("/items", requireUser, items);
"#,
        ),
    ]);
    expect(&got, &[("GET /items/list", "guarded by requireUser")]);
}

/// Mining reads what the measured build listed: none of these routes.
#[test]
fn mining_does_not_read_the_routes_listed_since() {
    let dir = write(&[
        ("package.json", PACKAGE),
        (
            "src/server.ts",
            r#"import express from "express";

const app = express();
app.get("/module", (req, res) => { res.json({}); });

function routes() {
  app.get("/function", (req, res) => { res.json({}); });
}

routes();
"#,
        ),
    ]);
    let facts = drift(dir.path(), &["facts", "src/server.ts"]);
    let names = |v: &Value| -> Vec<String> {
        v.as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| e["route"].as_str().map(String::from))
            .collect()
    };
    assert_eq!(names(&facts["entry_points"]), ["/module"]);
    let mut listed = names(&facts["listed"]["entry_points"]);
    listed.sort();
    assert_eq!(listed, ["/function", "/module"]);
}
